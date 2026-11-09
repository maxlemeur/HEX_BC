import type { TakeoffDpgfComparisonSummary, TakeoffDpgfReviewDecision } from "@/lib/takeoff/types";

export function canRetainDpgfQuantity(decision: TakeoffDpgfReviewDecision, dpgfQuantity: number | null, takeoffQuantity: number | null) {
  return (decision !== "keep_dpgf" || dpgfQuantity !== null) &&
    (decision !== "keep_takeoff" || takeoffQuantity !== null) &&
    (dpgfQuantity === null || takeoffQuantity === null
      || (decision !== "keep_dpgf" || dpgfQuantity >= takeoffQuantity)
        && (decision !== "keep_takeoff" || takeoffQuantity >= dpgfQuantity));
}

export function hasBlockingTakeoffDpgfExceptions(
  _summary: TakeoffDpgfComparisonSummary | null
): boolean {
  // TI-681: these counters describe review recommendations. Comparability,
  // authorization and snapshot integrity are enforced by the apply transaction.
  void _summary;
  return false;
}
