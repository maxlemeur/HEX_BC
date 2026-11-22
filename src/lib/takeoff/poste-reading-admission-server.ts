import "server-only";

import type { TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { describeTakeoffLaunchReason, type AnyTakeoffLaunchManifest, type TakeoffLaunchPiece } from "@/lib/takeoff/launch-request";
import { posteReadingBoundsOfManifest, posteReadingRefusal } from "@/lib/takeoff/poste-reading-bounds";
import { posteReadingBoundsDetails, type PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";

/**
 * Lot 4: the admission of a request that reads its plans against a list of items, bounded on the whole request with the
 * reservations of the ledger (`TAKEOFF_PAID_CALL_ESTIMATE_TOKENS`) before anything is admitted. Each seal calls it on the
 * manifest it is about to admit; the free extraction is never bounded here (nothing is read for it).
 */
export type TakeoffItemListReadingRefusal = {
  state: "blocked";
  reason: "PLAN_SET_TOO_LARGE";
  pieces: TakeoffLaunchPiece[];
  readingBounds: PosteReadingBoundsFacts;
};

export async function itemListReadingRefusal(manifest: AnyTakeoffLaunchManifest,
  chunking: () => Promise<TakeoffChunkingRuntimeConfig>): Promise<TakeoffItemListReadingRefusal | null> {
  if (manifest.order.kind !== "item_list") return null;
  const bounds = posteReadingBoundsOfManifest(manifest, await chunking(), TAKEOFF_PAID_CALL_ESTIMATE_TOKENS);
  const refusal = bounds ? posteReadingRefusal(bounds) : null;
  return bounds && refusal ? { state: "blocked", ...refusal, readingBounds: bounds } : null;
}

/** What an evaluation records with the refusal: the plans named, and the bounds' numbers (never a text). */
export function itemListReadingRefusalDetails(refusal: { pieces: TakeoffLaunchPiece[]; readingBounds?: PosteReadingBoundsFacts }) {
  return { pieces: refusal.pieces, ...(refusal.readingBounds ? { reading_bounds: posteReadingBoundsDetails(refusal.readingBounds) } : {}) };
}

/** A member's command past its bounds: refused before the database sees it, the plans and the limits named. */
export function itemListReadingTooLarge(refusal: TakeoffItemListReadingRefusal) {
  return new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false,
    message: describeTakeoffLaunchReason(refusal.reason, refusal.pieces, refusal.readingBounds) });
}
