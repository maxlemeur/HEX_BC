import type { TakeoffDpgfComparisonSummary, TakeoffDpgfReviewDecision } from "@/lib/takeoff/types";

export function canRetainDpgfQuantity(decision: TakeoffDpgfReviewDecision, dpgfQuantity: number | null, takeoffQuantity: number | null) {
  return (decision !== "keep_dpgf" || dpgfQuantity !== null) &&
    (decision !== "keep_takeoff" || takeoffQuantity !== null) &&
    (dpgfQuantity === null || takeoffQuantity === null
      || (decision !== "keep_dpgf" || dpgfQuantity >= takeoffQuantity)
        && (decision !== "keep_takeoff" || takeoffQuantity >= dpgfQuantity));
}

export function hasBlockingTakeoffDpgfExceptions(
  summary: TakeoffDpgfComparisonSummary | null
): boolean {
  if (!summary) return false;

  const hasTargetDpgfLines = summary.total_lines > 0;

  return (
    summary.to_confirm > 0 ||
    summary.significant_gaps > 0 ||
    summary.lines_without_proof > 0 ||
    summary.forced_manual > 0 ||
    (hasTargetDpgfLines && summary.unused_takeoff_items > 0)
  );
}
