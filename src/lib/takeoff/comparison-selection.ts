import type { TakeoffItemPatchEntry, TakeoffJobItem } from "@/lib/takeoff/types";

/** The reason « Appliquer la sélection » writes on a line not retained when two extractions are compared. */
export const COMPARISON_EXCLUSION_REASON = "Non retenue à la comparaison des extractions";

/** The same reason as written before 2026-11-18, still stored on the lines left out until then. */
const LEGACY_COMPARISON_EXCLUSION_REASON = "Cherry-pick diff TKF-032";

const isComparisonExclusion = (reason: string | null) =>
  reason === COMPARISON_EXCLUSION_REASON || reason === LEGACY_COMPARISON_EXCLUSION_REASON;

/** A line's exclusion reason as the review shows it: the comparison's in its current wording, any other as written. */
export function exclusionReasonText(reason: string): string {
  return reason === LEGACY_COMPARISON_EXCLUSION_REASON ? COMPARISON_EXCLUSION_REASON : reason;
}

/**
 * What applying a selection of the comparison writes: each line selected included, each other one left out with the
 * comparison's reason. A line already in that state is not written, a line left out by an earlier selection included,
 * whichever of the two wordings it was stored with.
 */
export function comparisonSelectionPatches(
  items: ReadonlyArray<Pick<TakeoffJobItem, "id" | "updated_at" | "is_excluded" | "exclusion_reason">>,
  selectedIds: ReadonlySet<string>
): TakeoffItemPatchEntry[] {
  return items.flatMap((item) => {
    const excluded = !selectedIds.has(item.id);
    const unchanged = excluded
      ? item.is_excluded && isComparisonExclusion(item.exclusion_reason)
      : !item.is_excluded && item.exclusion_reason === null;
    if (unchanged) return [];
    return [{ item_id: item.id, updated_at: item.updated_at,
      fields: { is_excluded: excluded, exclusion_reason: excluded ? COMPARISON_EXCLUSION_REASON : null } }];
  });
}
