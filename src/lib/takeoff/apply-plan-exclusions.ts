import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/types";

// The lines a takeoff's application leaves out of the estimate, computed once for the application (apply-server.ts) and
// for the proposal of the « Pages déjà au devis » step (page-replacement-server.ts), so that both read the same lines.

type ComparisonContext = {
  comparisonInput: Parameters<typeof computeTakeoffDpgfRows>[0] & { takeoffLines: Array<{ item_id: string }> };
  /** TI-696: the earlier lines on the pages read again by the lines the application brings, those `leftOut` set aside. */
  readAgainItemIdsOf?: (leftOut: ReadonlySet<string>) => ReadonlySet<string>;
};

/**
 * On a DPGF version, the lines of a row the reconciliation decided out of scope are skipped by the mapping plan, and the
 * lines the plan skips or folds into an assembly leave the reconciliation, and read no page again. Mutates both, as the
 * application always did.
 */
/** The lines of the rows the reconciliation decided out of scope (an out-of-scope decision stands whatever the totals). */
function outOfScopeItemIds(comparisonContext: ComparisonContext) {
  return new Set(computeTakeoffDpgfRows(comparisonContext.comparisonInput).rows
    .filter(row => row.applied_decision?.decision === "out_of_scope")
    .flatMap(row => row.linked_takeoff_items.map(item => item.item_id)));
}

/**
 * TI-696: at the review, the pages read again by the lines the application would bring: the lines of a row decided out of
 * scope are left out, as the mapping plan skips them at the application (the plan's other exclusions are known only
 * there). Mutates the comparison input.
 */
export function readAgainLeavingOutOfScope(comparisonContext: ComparisonContext) {
  if (!comparisonContext.readAgainItemIdsOf) return;
  const outOfScope = outOfScopeItemIds(comparisonContext);
  if (outOfScope.size > 0) comparisonContext.comparisonInput.readAgainItemIds = comparisonContext.readAgainItemIdsOf(outOfScope);
}

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
  }
}

/** The lines the mapping plan skips or folds into an assembly: they bring nothing of their page to the estimate. */
export function plannedExclusions(mappingPreview: Pick<TakeoffPreviewConversionResponse, "items">) {
  return new Set(mappingPreview.items.filter(item => item.action === "skip" || item.action === "apply_assembly").map(item => item.item_id));
}
