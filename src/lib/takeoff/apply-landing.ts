import type { TakeoffApplySummary } from "@/lib/takeoff/apply-response-contracts";

/**
 * Where the estimator lands once a takeoff is sent to the estimate table: the version's editor, on the first line the
 * application created, else on the first line it fed or updated in place (a DPGF line, a page replaced line by line),
 * else on the table alone. The editor scrolls to `focusItemId` and highlights it.
 */
export function takeoffApplyLandingHref(versionId: string,
  summary: Pick<TakeoffApplySummary, "created_ids" | "item_links">): string {
  const editor = `/dashboard/estimates/${encodeURIComponent(versionId)}/edit`;
  const lineId = summary.created_ids[0] ?? summary.item_links[0]?.estimate_item_id;
  return lineId ? `${editor}?focusItemId=${encodeURIComponent(lineId)}` : editor;
}
