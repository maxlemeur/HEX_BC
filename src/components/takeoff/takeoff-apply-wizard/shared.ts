"use client";

import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/client";
import type { ForcedOverride } from "@/lib/takeoff/force-reasons";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD, MEDIUM_CONFIDENCE_CEILING } from "@/lib/takeoff/guards";
import { isLeftOutByMappingPlan } from "@/lib/takeoff/mapping-engine";
import type { MergeSentLine } from "@/lib/takeoff/merge-overwrites";
import type { TakeoffPageDecision } from "@/lib/takeoff/page-replacement-contracts";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

export type SectionOption = {
  id: string;
  label: string;
  summaryLabel: string;
};

/**
 * What the screen sends. The API also accepts « replace » (the section emptied first), which the screen no longer offers
 * since 2026-11-18: the server's refusals around it stay covered by its own tests.
 */
export type TakeoffApplyStrategy = "append" | "merge";

export type TakeoffApplyWizardSubmitPayload = {
  targetSectionId: string | null;
  targetSectionLabel: string;
  strategy: TakeoffApplyStrategy;
  override?: boolean;
  /** TI-686 D10: each blocked line's coded reason, its justification stored once (with override). */
  forced?: ForcedOverride;
  /** TI-682 lot D: the decision for each page another takeoff already brought into the estimate. */
  pageDecisions?: TakeoffPageDecision[];
};

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

/**
 * The strategy the screen computes and sends (2026-11-18: no longer chosen by hand). A version that holds DPGF lines
 * (`isDpgfTargetLine`) merges, so that its reconciled DPGF lines keep their place; any other version appends, a page
 * another takeoff already brought into the estimate updating its earlier lines in place. The server's proposal says
 * whether the version holds DPGF lines when it is read (`merge_required`): the dialog follows it.
 */
export function takeoffApplyStrategyFor(input: { holdsDpgfLines: boolean }): TakeoffApplyStrategy {
  return input.holdsDpgfLines ? "merge" : "append";
}

/**
 * The lines the application hands the writer, read from the impact preview: still included once the mapping plan left out
 * what it skips or folds into an ouvrage (apply_takeoff_job_atomic excludes them before the writer runs), each with the
 * designation a « rename » gave it and its source order. On a DPGF version the application also skips the lines the
 * reconciliation decided out of scope, which the preview does not know: these are more lines than the writer is handed,
 * never fewer (mergeOverwrites reaches no fewer lines for it).
 */
export function mergeSentLinesOf(preview: Pick<TakeoffPreviewConversionResponse, "items">): MergeSentLine[] {
  return preview.items
    .filter((item) => !item.transformed.is_excluded && !isLeftOutByMappingPlan(item))
    .map((item) => ({ id: item.item_id, designation: item.transformed.designation, unit: item.transformed.unit,
      quantity: item.transformed.quantity, sourceOrder: item.source_order }));
}

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

/** A quantity as the send screen writes it: French digits, up to three decimals. */
export function formatTakeoffQuantity(value: number): string {
  return quantityFormat.format(value);
}

/** What the administrator's mapping rule did to a line, in words; null when no rule touched it. */
export function mappingRuleEffect(item: Pick<TakeoffPreviewConversionResponse["items"][number], "action" | "rule_name">): string | null {
  const by = item.rule_name ? `par la règle « ${item.rule_name} »` : "par une règle";
  switch (item.action) {
    case "none":
      return null;
    case "rename":
      return `Renommée ${by}`;
    case "set_price":
      return `Prix fixé ${by}`;
    case "set_category":
      return `Catégorie fixée ${by}`;
    case "apply_assembly":
      return item.rule_name ? `Remplacée par un ouvrage (règle « ${item.rule_name} »)` : "Remplacée par un ouvrage";
    case "skip":
      return `Laissée de côté ${by}`;
  }
}

export function confidenceColor(confidence: number | null): string {
  if (confidence === null) return "text-danger";
  if (confidence < 0.3) return "text-danger";
  if (confidence < DEFAULT_LOW_CONFIDENCE_THRESHOLD) return "text-warning";
  if (confidence < MEDIUM_CONFIDENCE_CEILING) return "text-info";
  return "text-success";
}

export function formatConfidencePercent(confidence: number | null): string {
  if (confidence === null) return "N/A";
  return confidence >= MEDIUM_CONFIDENCE_CEILING ? "Élevée" : confidence >= DEFAULT_LOW_CONFIDENCE_THRESHOLD ? "Moyenne" : "Faible";
}
