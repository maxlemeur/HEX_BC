"use client";

import type {
  TakeoffMappingOverride,
  TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export type WizardStep = 1 | 2 | 3 | 4;

export type SectionOption = {
  id: string;
  label: string;
  summaryLabel: string;
};

export type TakeoffApplyStrategy = "append" | "replace" | "merge";

export type TakeoffApplyWizardSubmitPayload = {
  targetSectionId: string | null;
  targetSectionLabel: string;
  strategy: TakeoffApplyStrategy;
  overrides: TakeoffMappingOverride[];
  override?: boolean;
  overrideJustification?: string;
};

export const ROOT_SECTION_VALUE = "__takeoff_root_section__";
export const ROOT_SECTION_LABEL = "Racine du devis";
export const AUTO_OVERRIDE_VALUE = "__takeoff_override_auto__";

export const STRATEGY_OPTIONS: Array<{
  value: TakeoffApplyStrategy;
  label: string;
  description: string;
  impactLabel: string;
  caution: string;
}> = [
  {
    value: "append",
    label: "Ajouter sans effacer",
    description: "Ajoute les lignes extraites dans la zone cible sans toucher au contenu deja en place.",
    impactLabel: "Le plus sur pour enrichir un devis existant.",
    caution: "Aucune ligne existante n'est supprimee.",
  },
  {
    value: "replace",
    label: "Remplacer la zone cible",
    description: "Remplace le contenu actuel de la zone cible par les lignes issues du metre retenu.",
    impactLabel: "Impact fort sur la zone choisie.",
    caution: "Le contenu existant de la zone cible sera remplace.",
  },
  {
    value: "merge",
    label: "Fusionner avec l'existant",
    description: "Tente de rapprocher les lignes existantes et les lignes extraites selon les regles serveur.",
    impactLabel: "Bon compromis quand la zone est deja structuree.",
    caution: "Relisez l'impact avant confirmation.",
  },
];

export const OVERRIDE_ACTION_OPTIONS: Array<{
  value: TakeoffMappingOverride["action"];
  label: string;
}> = [
  { value: "none", label: "Aucune transformation" },
  { value: "rename", label: "rename" },
  { value: "set_price", label: "set_price" },
  { value: "set_category", label: "set_category" },
  { value: "apply_assembly", label: "apply_assembly" },
  { value: "skip", label: "skip" },
];

function toPosition(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return Number.MAX_SAFE_INTEGER;
}

function normalizeSectionTitle(title: string | null): string {
  const normalized = title?.trim();
  if (!normalized) return "Section sans titre";
  return normalized;
}

function compareSections(left: EstimateItem, right: EstimateItem): number {
  const positionDiff = toPosition(left.position) - toPosition(right.position);
  if (positionDiff !== 0) return positionDiff;

  const titleDiff = normalizeSectionTitle(left.title).localeCompare(
    normalizeSectionTitle(right.title),
    "fr-FR"
  );
  if (titleDiff !== 0) return titleDiff;

  return left.id.localeCompare(right.id);
}

export function buildSectionOptions(items: EstimateItem[]): SectionOption[] {
  const sections = items.filter((item) => item.item_type === "section");
  const sectionIds = new Set(sections.map((section) => section.id));
  const childrenByParent = new Map<string | null, EstimateItem[]>();

  for (const section of sections) {
    const parentId =
      section.parent_id && sectionIds.has(section.parent_id)
        ? section.parent_id
        : null;
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(section);
    childrenByParent.set(parentId, siblings);
  }

  for (const siblings of childrenByParent.values()) {
    siblings.sort(compareSections);
  }

  const visited = new Set<string>();
  const ordered: SectionOption[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = childrenByParent.get(parentId) ?? [];

    for (const section of children) {
      if (visited.has(section.id)) continue;
      visited.add(section.id);
      const summaryLabel = normalizeSectionTitle(section.title);
      const indent = depth > 0 ? `${"  ".repeat(depth)}- ` : "";
      ordered.push({
        id: section.id,
        label: `${indent}${summaryLabel}`,
        summaryLabel,
      });
      visit(section.id, depth + 1);
    }
  };

  visit(null, 0);

  for (const section of sections) {
    if (visited.has(section.id)) continue;
    ordered.push({
      id: section.id,
      label: normalizeSectionTitle(section.title),
      summaryLabel: normalizeSectionTitle(section.title),
    });
  }

  return ordered;
}

export function strategyDescription(strategy: TakeoffApplyStrategy) {
  return STRATEGY_OPTIONS.find((option) => option.value === strategy)?.description ?? "-";
}

export function strategyLabel(strategy: TakeoffApplyStrategy) {
  return STRATEGY_OPTIONS.find((option) => option.value === strategy)?.label ?? strategy;
}

export function strategyCaution(strategy: TakeoffApplyStrategy) {
  return STRATEGY_OPTIONS.find((option) => option.value === strategy)?.caution ?? "";
}

export function toOverrideList(overridesByItemId: Record<string, TakeoffMappingOverride>) {
  return Object.values(overridesByItemId);
}

export function summarizeAction(item: TakeoffPreviewConversionResponse["items"][number]) {
  if (item.action === "none") {
    return "Aucune";
  }

  if (item.rule_name) {
    return `${item.action} (${item.rule_name})`;
  }

  return item.action;
}

export function buildOverrideFromAction(input: {
  item: TakeoffPreviewConversionResponse["items"][number];
  action: TakeoffMappingOverride["action"];
}): TakeoffMappingOverride {
  if (input.action === "rename") {
    return {
      item_id: input.item.item_id,
      action: "rename",
      action_params: {
        designation: input.item.transformed.designation,
      },
    };
  }

  if (input.action === "set_price") {
    return {
      item_id: input.item.item_id,
      action: "set_price",
      action_params: {
        unit_price_cents: input.item.transformed.unit_price_cents ?? 0,
      },
    };
  }

  if (input.action === "set_category") {
    return {
      item_id: input.item.item_id,
      action: "set_category",
      action_params: {
        category_id: input.item.transformed.category_id ?? "",
      },
    };
  }

  if (input.action === "apply_assembly") {
    return {
      item_id: input.item.item_id,
      action: "apply_assembly",
      action_params: {
        assembly_id: input.item.transformed.assembly_id ?? "",
      },
    };
  }

  if (input.action === "skip") {
    return {
      item_id: input.item.item_id,
      action: "skip",
      action_params: {},
    };
  }

  return {
    item_id: input.item.item_id,
    action: "none",
    action_params: {},
  };
}

export function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "text-[var(--danger)]";
  if (confidence < 0.3) return "text-[var(--danger)]";
  if (confidence < 0.5) return "text-[var(--warning)]";
  if (confidence < 0.8) return "text-[var(--info)]";
  return "text-[var(--success)]";
}

export function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null) return "N/A";
  return `${Math.round(confidence * 100)}%`;
}
