import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import type { TakeoffPreviewConversionResponse } from "@/lib/takeoff/types";

// The lines a takeoff's application leaves out of the estimate, computed once for the application (apply-server.ts) and
// for the proposal of the « Pages déjà au devis » step (page-replacement-server.ts), so that both read the same lines.

type ComparisonContext = { comparisonInput: Parameters<typeof computeTakeoffDpgfRows>[0] & { takeoffLines: Array<{ item_id: string }> } };

/**
 * On a DPGF version, the lines of a row the reconciliation decided out of scope are skipped by the mapping plan, and the
 * lines the plan skips or folds into an assembly leave the reconciliation. Mutates both, as the application always did.
 */
export function excludeDpgfOutOfScope(mappingPreview: TakeoffPreviewConversionResponse, comparisonContext: ComparisonContext | null) {
  if (!comparisonContext) return;
  const outOfScope = new Set(computeTakeoffDpgfRows(comparisonContext.comparisonInput).rows
    .filter(row => row.applied_decision?.decision === "out_of_scope")
    .flatMap(row => row.linked_takeoff_items.map(item => item.item_id)));
  mappingPreview.items = mappingPreview.items.map(item => outOfScope.has(item.item_id)
    ? { ...item, action: "skip", transformed: { ...item.transformed, is_excluded: true } } : item);
  const excluded = plannedExclusions(mappingPreview);
  comparisonContext.comparisonInput.takeoffLines = comparisonContext.comparisonInput.takeoffLines.filter(item => !excluded.has(item.item_id));
}

/** The lines the mapping plan skips or folds into an assembly: they bring nothing of their page to the estimate. */
export function plannedExclusions(mappingPreview: Pick<TakeoffPreviewConversionResponse, "items">) {
  return new Set(mappingPreview.items.filter(item => item.action === "skip" || item.action === "apply_assembly").map(item => item.item_id));
}
