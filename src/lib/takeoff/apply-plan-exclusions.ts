import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/types";

// The lines a takeoff's application leaves out of the estimate, computed once for the application (apply-server.ts) and
// for the proposal of the « Pages déjà au devis » step (page-replacement-server.ts), so that both read the same lines.

type ComparisonContext = {
  comparisonInput: Parameters<typeof computeTakeoffDpgfRows>[0] & { takeoffLines: Array<{ item_id: string }> };
  /** TI-696: the earlier lines on the pages read again by the lines the application brings, those `leftOut` set aside. */
  readAgainItemIdsOf?: (leftOut: ReadonlySet<string>) => ReadonlySet<string>;
};

/** The lines of each row the reconciliation decided out of scope (an out-of-scope decision stands whatever the totals). */
function outOfScopeLinesByRow(comparisonContext: ComparisonContext) {
  return new Map(computeTakeoffDpgfRows(comparisonContext.comparisonInput).rows
    .filter(row => row.applied_decision?.decision === "out_of_scope")
    .map(row => [row.line_id, new Set(row.linked_takeoff_items.map(item => item.item_id))] as const));
}

function outOfScopeItemIds(comparisonContext: ComparisonContext) {
  return new Set([...outOfScopeLinesByRow(comparisonContext).values()].flatMap(ids => [...ids]));
}

/**
 * TI-696: at the review, the pages read again by the lines the application would bring: the lines of every row decided
 * out of scope are left out, as the mapping plan skips them at the application (its other exclusions are known only
 * there). Each such row is judged as it would be fed (`readAgainIfFed`: its own lines back), so that a decision changed
 * from « hors périmètre » stays current once saved. Nothing changes without an out-of-scope decision. Mutates the input.
 */
export function readAgainLeavingOutOfScope(comparisonContext: ComparisonContext) {
  const readAgainOf = comparisonContext.readAgainItemIdsOf;
  const input = comparisonContext.comparisonInput;
  if (!readAgainOf || ![...(input.reviewDecisions ?? []), ...(input.carriedReviewDecisions?.values() ?? [])]
    .some(decision => decision.decision === "out_of_scope")) return;
  const byRow = outOfScopeLinesByRow(comparisonContext);
  if (byRow.size === 0) return;
  const all = new Set([...byRow.values()].flatMap(ids => [...ids]));
  input.readAgainItemIds = readAgainOf(all);
  input.readAgainIfFed = new Map([...byRow].map(([lineId, ids]) => [lineId, readAgainOf(new Set([...all].filter(id => !ids.has(id))))]));
}

/**
 * On a DPGF version, the lines of a row the reconciliation decided out of scope are skipped by the mapping plan, and the
 * lines the plan skips or folds into an assembly leave the reconciliation, and read no page again. Mutates both, as the
 * application always did.
 */
export function excludeDpgfOutOfScope(mappingPreview: TakeoffPreviewConversionResponse, comparisonContext: ComparisonContext | null) {
  if (!comparisonContext) return;
  const outOfScope = outOfScopeItemIds(comparisonContext);
  mappingPreview.items = mappingPreview.items.map(item => outOfScope.has(item.item_id)
    ? { ...item, action: "skip", transformed: { ...item.transformed, is_excluded: true } } : item);
  const excluded = plannedExclusions(mappingPreview);
  comparisonContext.comparisonInput.takeoffLines = comparisonContext.comparisonInput.takeoffLines.filter(item => !excluded.has(item.item_id));
  // TI-696: a page whose lines the plan all leaves out is not read again: its earlier part stays in the DPGF totals. A
  // review decision stays judged on the pages the review reads again, where it was recorded.
  if (comparisonContext.readAgainItemIdsOf) {
    const input = comparisonContext.comparisonInput;
    input.decisionReadAgainItemIds = input.decisionReadAgainItemIds ?? input.readAgainItemIds ?? new Set<string>();
    input.readAgainItemIds = comparisonContext.readAgainItemIdsOf(excluded);
    // At the application an out-of-scope row is not fed: no view of it fed (its decision stands whatever the totals).
    input.readAgainIfFed = undefined;
  }
}

/** The lines the mapping plan skips or folds into an assembly: they bring nothing of their page to the estimate. */
export function plannedExclusions(mappingPreview: Pick<TakeoffPreviewConversionResponse, "items">) {
  return new Set(mappingPreview.items.filter(item => item.action === "skip" || item.action === "apply_assembly").map(item => item.item_id));
}
