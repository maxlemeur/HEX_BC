import "server-only";

import type { TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { TAKEOFF_PAID_CALL_ESTIMATE_TOKENS } from "@/lib/takeoff/launch-call-ledger";
import { describeTakeoffLaunchReason, type AnyTakeoffLaunchManifest, type TakeoffLaunchPiece } from "@/lib/takeoff/launch-request";
import type { Poste } from "@/lib/takeoff/poste-list";
import { posteReadingRefusal, sizePosteReadingManifest } from "@/lib/takeoff/poste-reading-bounds";
import { takeoffVectorGroupCallsBound } from "@/lib/takeoff/vectors/worker-server";
import { posteReadingBoundsDetails, type PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";

/**
 * Lot 4: the admission of a request that reads its plans against a list of items, bounded on the whole request before
 * anything is admitted, its budget sized from the calls it is admitted for at the ledger's reservations
 * (`TAKEOFF_PAID_CALL_ESTIMATE_TOKENS`). Each seal calls it on the manifest it is about to admit; the free extraction is
 * never bounded here, and keeps the tenant's budget (nothing is read for it).
 */
export type TakeoffItemListReadingRefusal = {
  state: "blocked";
  reason: "PLAN_SET_TOO_LARGE";
  pieces: TakeoffLaunchPiece[];
  readingBounds: PosteReadingBoundsFacts;
};

/**
 * The manifest a request admits: for a reading against the list, its budget sized from its calls and the ceilings
 * checked, or the refusal that names the plans (the manifest given back as it came, never to admit); the free extraction
 * as sealed. `items`: the sealed revision's items (their batches are counted by their bytes); each unit also counts the
 * calls its vector classifier may make (`takeoffVectorGroupCallsBound`), as the worker counts them before its first paid
 * call.
 */
export async function sealItemListReading<T extends AnyTakeoffLaunchManifest>(manifest: T,
  chunking: () => Promise<TakeoffChunkingRuntimeConfig>, items: readonly Poste[]): Promise<{ manifest: T; refusal: TakeoffItemListReadingRefusal | null }> {
  if (manifest.order.kind !== "item_list") return { manifest, refusal: null };
  const sized = sizePosteReadingManifest(manifest, await chunking(), TAKEOFF_PAID_CALL_ESTIMATE_TOKENS, items, takeoffVectorGroupCallsBound);
  const refusal = sized.bounds ? posteReadingRefusal(sized.bounds) : null;
  return sized.bounds && refusal ? { manifest, refusal: { state: "blocked", ...refusal, readingBounds: sized.bounds } }
    : { manifest: sized.manifest, refusal: null };
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
