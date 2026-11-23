/**
 * What a takeoff's review renders for its address (TakeoffReviewPage), decided once and read by the review and by the
 * review link's resolver (review-link.ts) alike: its mode (`reviewMode`, « Validation » by default), the tab it asks for
 * (`view`, « Items » by default) and the tab shown — the simplified (« Assisté ») review and a review without an estimate
 * version show the items whatever the tab asked; only « Production » shows the tabs (the comparison of two readings
 * among them). Values are read exactly as written: anything else is the default.
 */

export const TAKEOFF_REVIEW_MODES = ["assisted", "production", "validation"] as const;
export type TakeoffReviewMode = (typeof TAKEOFF_REVIEW_MODES)[number];
export const TAKEOFF_REVIEW_TABS = ["tables", "items", "compare", "dpgf"] as const;
export type TakeoffReviewTab = (typeof TAKEOFF_REVIEW_TABS)[number];

export function takeoffReviewMode(value: string | null | undefined): TakeoffReviewMode {
  return TAKEOFF_REVIEW_MODES.find((mode) => mode === value) ?? "validation";
}

export function takeoffReviewRequestedTab(value: string | null | undefined): TakeoffReviewTab {
  return TAKEOFF_REVIEW_TABS.find((tab) => tab === value) ?? "items";
}

/** The tab the review shows: the items in the simplified review, or without a version for the DPGF and the comparison. */
export function takeoffReviewActiveTab(input: { reviewMode: string | null | undefined; view: string | null | undefined;
  versionId: string | null | undefined }): TakeoffReviewTab {
  const requested = takeoffReviewRequestedTab(input.view);
  return takeoffReviewMode(input.reviewMode) === "assisted" || (!input.versionId && (requested === "dpgf" || requested === "compare"))
    ? "items" : requested;
}

/** Whether the review renders the comparison of two readings: « Production » (the only mode showing tabs) on that tab. */
export function takeoffReviewRendersComparison(input: { reviewMode: string | null | undefined; view: string | null | undefined;
  versionId: string | null | undefined }) {
  return takeoffReviewMode(input.reviewMode) === "production" && takeoffReviewActiveTab(input) === "compare";
}
