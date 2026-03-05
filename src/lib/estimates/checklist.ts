import type {
  EstimateQualityFlagKey,
  EstimateQualityFlagsByItemId,
} from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export const ESTIMATE_CHECKLIST_CRITERIA_KEYS = [
  "prices",
  "quantities",
  "labor_roles",
  "margin_defined",
  "validity_dates",
] as const;

export type EstimateChecklistCriterionKey =
  (typeof ESTIMATE_CHECKLIST_CRITERIA_KEYS)[number];
export type EstimateChecklistSeverity = "blocking" | "warning";
export type EstimateChecklistStatus = "complete" | "blocking" | "warning";

export type EstimateChecklistCriterion = {
  key: EstimateChecklistCriterionKey;
  label: string;
  description: string;
  severity: EstimateChecklistSeverity;
  status: EstimateChecklistStatus;
  isComplete: boolean;
  missingCount: number;
  totalCount: number;
  targetItemId: string | null;
  qualityFlag: EstimateQualityFlagKey | null;
};

export type EstimateChecklistResult = {
  criteria: EstimateChecklistCriterion[];
  totalCount: number;
  completedCount: number;
  progressPercent: number;
  status: EstimateChecklistStatus;
  blockingCount: number;
  warningCount: number;
};

export type EstimateChecklistSettingsInput = {
  margin_multiplier: number | null | undefined;
  margin_mode?: "fixed" | "tiered" | null | undefined;
  margin_tiers?: ReadonlyArray<unknown> | null | undefined;
  date_devis: string | null | undefined;
  validite_jours: number | null | undefined;
};

export type ComputeEstimateChecklistInput = {
  items: EstimateItem[];
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  settings: EstimateChecklistSettingsInput | null;
};

type ChecklistCriterionDefinition = {
  key: EstimateChecklistCriterionKey;
  label: string;
  description: string;
  severity: EstimateChecklistSeverity;
  qualityFlag: EstimateQualityFlagKey | null;
};

const CHECKLIST_CRITERION_DEFINITIONS: ChecklistCriterionDefinition[] = [
  {
    key: "prices",
    label: "Prix",
    description: "Toutes les lignes ont un prix FO valide.",
    severity: "blocking",
    qualityFlag: "missing_price",
  },
  {
    key: "quantities",
    label: "Quantites",
    description: "Toutes les lignes ont une quantite valide.",
    severity: "blocking",
    qualityFlag: "missing_quantity",
  },
  {
    key: "labor_roles",
    label: "Roles MO",
    description: "Chaque ligne avec du temps MO a un role selectionne.",
    severity: "warning",
    qualityFlag: "missing_labor_role",
  },
  {
    key: "margin_defined",
    label: "Marge definie",
    description: "Le multiplicateur de marge est renseigne.",
    severity: "blocking",
    qualityFlag: null,
  },
  {
    key: "validity_dates",
    label: "Dates de validite",
    description: "Date devis et validite (jours) sont renseignees.",
    severity: "warning",
    qualityFlag: null,
  },
];

function toCriterionStatus(
  isComplete: boolean,
  severity: EstimateChecklistSeverity
): EstimateChecklistStatus {
  if (isComplete) return "complete";
  return severity === "blocking" ? "blocking" : "warning";
}

function isPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasNonEmptyDate(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasDefinedMargin(settings: EstimateChecklistSettingsInput | null) {
  if (!settings) return false;
  if (settings.margin_mode === "tiered") {
    return Array.isArray(settings.margin_tiers) && settings.margin_tiers.length > 0;
  }
  return isPositiveNumber(settings.margin_multiplier);
}

function countLines(items: EstimateItem[]) {
  return items.reduce((count, item) => {
    if (item.item_type !== "line") return count;
    return count + 1;
  }, 0);
}

function collectFlagStats(input: {
  items: EstimateItem[];
  qualityFlagsByItemId: EstimateQualityFlagsByItemId;
  qualityFlag: EstimateQualityFlagKey;
}) {
  let missingCount = 0;
  let targetItemId: string | null = null;

  input.items.forEach((item) => {
    if (item.item_type !== "line") return;
    const flags = input.qualityFlagsByItemId[item.id] ?? [];
    if (!flags.includes(input.qualityFlag)) return;
    missingCount += 1;
    if (!targetItemId) {
      targetItemId = item.id;
    }
  });

  return {
    missingCount,
    targetItemId,
  };
}

export function computeEstimateChecklist({
  items,
  qualityFlagsByItemId,
  settings,
}: ComputeEstimateChecklistInput): EstimateChecklistResult {
  const lineCount = countLines(items);

  const criteria = CHECKLIST_CRITERION_DEFINITIONS.map((definition) => {
    if (definition.qualityFlag) {
      const { missingCount, targetItemId } = collectFlagStats({
        items,
        qualityFlagsByItemId,
        qualityFlag: definition.qualityFlag,
      });
      // An empty estimate (0 data lines) should never be considered complete
      const isComplete = lineCount > 0 && missingCount === 0;

      return {
        ...definition,
        status: toCriterionStatus(isComplete, definition.severity),
        isComplete,
        missingCount,
        totalCount: lineCount,
        targetItemId,
      } satisfies EstimateChecklistCriterion;
    }

    if (definition.key === "margin_defined") {
      const isComplete = hasDefinedMargin(settings);
      return {
        ...definition,
        status: toCriterionStatus(isComplete, definition.severity),
        isComplete,
        missingCount: isComplete ? 0 : 1,
        totalCount: 1,
        targetItemId: null,
      } satisfies EstimateChecklistCriterion;
    }

    const hasValidityDate =
      hasNonEmptyDate(settings?.date_devis) &&
      isPositiveNumber(settings?.validite_jours);
    return {
      ...definition,
      status: toCriterionStatus(hasValidityDate, definition.severity),
      isComplete: hasValidityDate,
      missingCount: hasValidityDate ? 0 : 1,
      totalCount: 1,
      targetItemId: null,
    } satisfies EstimateChecklistCriterion;
  });

  const completedCount = criteria.filter((criterion) => criterion.isComplete).length;
  const totalCount = criteria.length;
  const blockingCount = criteria.filter(
    (criterion) => criterion.status === "blocking"
  ).length;
  const warningCount = criteria.filter(
    (criterion) => criterion.status === "warning"
  ).length;
  const status: EstimateChecklistStatus =
    blockingCount > 0 ? "blocking" : warningCount > 0 ? "warning" : "complete";

  return {
    criteria,
    totalCount,
    completedCount,
    progressPercent:
      totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 100,
    status,
    blockingCount,
    warningCount,
  };
}
