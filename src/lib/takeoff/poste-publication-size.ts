import type { PosteAnswerOutcome, PosteObservationMethod } from "@/lib/takeoff/poste-exchange";
import type { PosteObservationRole, PosteReadingObservation, PosteReason, PosteReasonCode } from "@/lib/takeoff/poste-exchange-merge";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";

/**
 * The shapes the publication of the second measuring order sends in `p_answers` (public.publish_takeoff_item_answers), and
 * their size as the command measures it (`octet_length(p_answers::text)`, `jsonbTextBytes`). The merge attaches vector
 * readings within that size, the admission bounds it, and the builder sends exactly these shapes.
 */

export type TakeoffItemAnswerObservation = {
  page: number;
  evidence: string;
  method: PosteObservationMethod | "vector_reading";
  confidence: number;
  quantity: number | null;
  unit: string | null;
  measurement_basis: string | null;
  role: PosteObservationRole;
  source: "model" | "vector";
  chunk_id: string | null;
  /** A vector observation: the vector row (`p_vector.items[].id`) this publication inserts. */
  vector_key: string | null;
  /** A contribution: the positive `takeoff_items` row (`p_items[].id`) the existing readers use. None for any other role. */
  takeoff_item_id: string | null;
};

export type TakeoffItemAnswerReason = { code: PosteReasonCode; by: "model" | "worker"; text: string | null; chunk_id: string | null };

export type TakeoffItemAnswer = {
  item_id: string;
  outcome: PosteAnswerOutcome;
  /** Ordered: the first is the primary reason. Empty only for a measured answer. */
  reasons: TakeoffItemAnswerReason[];
  searched_pages: number[];
  unreadable_pages: number[];
  /** Measured only: the sum of its contributions. */
  quantity: { value: number; unit: string } | null;
  /** Uncertain only: the value its readings suggest. */
  candidate: { value: number; unit: string } | null;
  observations: TakeoffItemAnswerObservation[];
};

/** A row's id in a publication (a contribution's row, a vector row): a UUID, 36 characters whatever its value. */
export const PUBLISHED_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

/** The longest call key of an admitted reading (`f{fragment}-b{batch}`), as the exchange's own worst case writes it. */
export const PUBLISHED_CHUNK_PLACEHOLDER = "f999-b9999";

/** An observation as the publication sends it, its rows' ids given (a role the builder changes, given too). */
export function publishedObservation(entry: PosteReadingObservation, ids: { takeoffItemId: string | null; vectorKey: string | null },
  role: PosteObservationRole = entry.role): TakeoffItemAnswerObservation {
  return { page: entry.page, evidence: entry.evidence, method: entry.method, confidence: entry.confidence, quantity: entry.quantity,
    unit: entry.unit, measurement_basis: entry.measurementBasis, role, source: entry.source, chunk_id: entry.chunkId,
    vector_key: ids.vectorKey, takeoff_item_id: ids.takeoffItemId };
}

export function publishedReason(reason: PosteReason): TakeoffItemAnswerReason {
  return { code: reason.code, by: reason.by, text: reason.text, chunk_id: reason.chunkId };
}

/**
 * The most bytes an observation takes in `p_answers`, whatever the builder makes of it: a reading of the model as a
 * contribution naming its row (the longest role, and the only one with a row), a vector reading naming its vector row.
 */
export function publishedObservationMaxBytes(entry: PosteReadingObservation) {
  return entry.source === "model"
    ? jsonbTextBytes(publishedObservation(entry, { takeoffItemId: PUBLISHED_ID_PLACEHOLDER, vectorKey: null }, "contribution"))
    : jsonbTextBytes(publishedObservation(entry, { takeoffItemId: null, vectorKey: PUBLISHED_ID_PLACEHOLDER }));
}

/**
 * The most bytes an answer takes without its reasons, pages and observations (each list empty): its item's id, the
 * longest outcome, and both a quantity and a candidate value at their longest (an answer carries one at most), the unit
 * at its bound in three-byte characters.
 */
export const PUBLISHED_ANSWER_FRAME_MAX_BYTES = (() => {
  const value = { value: 999_999_999.999, unit: "€".repeat(32) };
  return jsonbTextBytes({ item_id: PUBLISHED_ID_PLACEHOLDER, outcome: "uncertain", reasons: [], searched_pages: [], unreadable_pages: [],
    quantity: value, candidate: value, observations: [] } satisfies TakeoffItemAnswer);
})();

/** What an entry of a list adds at most: itself and the « , » before the next (an upper bound of the list's own bytes). */
export const listEntryBytes = (bytes: number) => bytes + 2;
