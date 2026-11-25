import { buildPdfChunks, type TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import { TAKEOFF_ITEM_ANSWER_LIMITS } from "@/lib/takeoff/item-answer-limits";
import {
  TAKEOFF_LAUNCH_VECTOR_PAGES, takeoffPlanWeights, type AnyTakeoffLaunchManifest, type TakeoffLaunchPiece,
} from "@/lib/takeoff/launch-request";
import {
  planPosteBatches, POSTE_EXCHANGE_LIMITS, POSTE_NOT_FOUND_REASONS, POSTE_OBSERVATION_METHODS, POSTE_UNCERTAIN_REASONS,
  posteExchangeOutputMaxBytes,
} from "@/lib/takeoff/poste-exchange";
import { POSTE_MERGE_REASONS, POSTE_WORKER_REASONS_RESERVED_BYTES } from "@/lib/takeoff/poste-exchange-merge";
import type { Poste } from "@/lib/takeoff/poste-list";
import type { PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";
import {
  listEntryBytes, PUBLISHED_ANSWER_FRAME_MAX_BYTES, PUBLISHED_CHUNK_PLACEHOLDER, PUBLISHED_ID_PLACEHOLDER,
  type TakeoffItemAnswerObservation, type TakeoffItemAnswerReason,
} from "@/lib/takeoff/poste-publication-size";
import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";

export { describePosteReadingBounds } from "@/lib/takeoff/poste-reading-bounds-text";

/**
 * The bounds of a request that reads its plans against a list of items (lot 4), checked on the whole request before its
 * admission: the calls its reading makes (each plan's fragments times the batches of items, plus the vector classifier's),
 * the reservations of those calls in the request's ledger and the largest answers they can return. The guard is the count
 * of the reading's calls (owner, 2026-11-22): the budget is then sized from the calls admitted (`sizePosteReadingManifest`),
 * so that the ledger's rule (lot 3: a paid call starts only while its plan's share and its request still have a positive
 * balance) lets every admitted call start. Beyond any bound the member is asked to reduce the scope: nothing is sampled,
 * no item or page is left out silently.
 *
 * The ceilings count the reading's calls, which hold the Mac (an estimated minute and a half each, `POSTE_READING_DURATION`):
 * 40 for a plan (an hour), 480 for a request (twelve hours: the 20 plans a request may seal, each of 20 pages read against
 * 300 items, the owner's high range). The vector classifier keeps its own limits (40 calls a plan and 25 a vector page, on
 * the dossier's 60 vector pages): its calls count in the budget and the duration, not against these ceilings, which a
 * dossier of short plans would otherwise pass on calls of a few seconds.
 */
export const POSTE_READING_LIMITS = {
  /** The reading's calls of one plan at most. */
  callsPerUnit: 40,
  /** The reading's calls of a request at most. */
  callsPerRequest: 480,
  /**
   * The largest answers of one plan's calls together (what its publication may carry), and of the request's: above what
   * the ceilings of the calls admit at the largest answer of a call, a guard if that answer's bounds grow.
   */
  unitAnswerBytes: 16 * 1024 * 1024,
  requestAnswerBytes: 128 * 1024 * 1024,
} as const;

/**
 * The fragments of one plan at most: what one answer of an item may hold once its fragments are merged, within what the
 * publication command stores of an answer (TAKEOFF_ITEM_ANSWER_LIMITS). Each fragment gives an item at most one reason
 * of the model and POSTE_EXCHANGE_LIMITS.observationsPerAnswer observations; the worker adds at most one reason of each
 * merge code or one publication reason to an otherwise measured answer. The vector reading gives one observation of each vector page (more are left unattached,
 * `VECTOR_READINGS_UNATTACHED`). 19 fragments: a plan of up to 154 pages with the tenant's default fragmenting.
 */
export const POSTE_READING_MAX_FRAGMENTS = Math.min(TAKEOFF_ITEM_ANSWER_LIMITS.reasons - POSTE_MERGE_REASONS.length,
  Math.floor((TAKEOFF_ITEM_ANSWER_LIMITS.observations - TAKEOFF_LAUNCH_VECTOR_PAGES) / POSTE_EXCHANGE_LIMITS.observationsPerAnswer));

const longest = <T extends string>(values: readonly T[]) => values.reduce((left, right) => right.length > left.length ? right : left);
/** A text at its bound in three-byte characters: what a text the exchange admits writes at most (exchange `text`). */
const threeBytes = (chars: number) => "€".repeat(chars);

/** The most bytes a reason of the model takes in a publication: its longest code, its text at its bound. */
const MODEL_REASON_MAX_BYTES = jsonbTextBytes({ code: longest([...POSTE_UNCERTAIN_REASONS, ...POSTE_NOT_FOUND_REASONS]), by: "model",
  text: threeBytes(POSTE_EXCHANGE_LIMITS.reasonChars), chunk_id: PUBLISHED_CHUNK_PLACEHOLDER } satisfies TakeoffItemAnswerReason);

/**
 * The most bytes an observation of the model takes in a publication, on a plan whose highest page is `maxPage`: every text
 * at its bound, its confidence and quantity at their longest writings at the stored precision (« 0.1234 »,
 * « 999999999.999 »), the longest method, as a contribution naming its row.
 */
const modelObservationMaxBytes = (maxPage: number) => jsonbTextBytes({ page: maxPage,
  evidence: threeBytes(POSTE_EXCHANGE_LIMITS.evidenceChars), method: longest(POSTE_OBSERVATION_METHODS), confidence: 0.1234,
  quantity: 999_999_999.999, unit: threeBytes(POSTE_EXCHANGE_LIMITS.unitChars), measurement_basis: threeBytes(POSTE_EXCHANGE_LIMITS.basisChars),
  role: "contribution", source: "model", chunk_id: PUBLISHED_CHUNK_PLACEHOLDER, vector_key: null,
  takeoff_item_id: PUBLISHED_ID_PLACEHOLDER } satisfies TakeoffItemAnswerObservation);

/**
 * The most bytes the answers of one plan take in its publication without its vector readings, as the command measures them
 * (`octet_length(p_answers::text)`), from what the admission knows: the sizes of the batches of items, the plan's fragments,
 * its pages and its highest page. Proof, entry by entry: each item has one answer, its frame at most
 * PUBLISHED_ANSWER_FRAME_MAX_BYTES; it holds at most one reason of the model per fragment that asks it (the merge keeps a
 * repeated one once) and one reason of the worker per code; its searched and its unreadable pages are each a subset of the
 * plan's pages; a call answers with at most POSTE_EXCHANGE_LIMITS.observationsPerAnswer observations per item and
 * observationsPerCall in all, each at most `modelObservationMaxBytes`; every text the exchange admits is well formed and
 * without control characters, three bytes a character at most (exchange `text`); confidences and quantities are at their
 * stored precision; and an entry of a list adds at most itself and « , ». The vector readings are attached within what this
 * leaves (`mergePosteReadings`).
 */
export function posteAnswersMaxBytes(input: { batches: readonly number[]; fragments: number; pages: number; maxPage: number }) {
  const items = input.batches.reduce((sum, size) => sum + size, 0);
  const observations = input.fragments * input.batches.reduce((sum, size) => sum + Math.min(POSTE_EXCHANGE_LIMITS.observationsPerCall,
    POSTE_EXCHANGE_LIMITS.observationsPerAnswer * size), 0);
  const answer = listEntryBytes(PUBLISHED_ANSWER_FRAME_MAX_BYTES) + POSTE_WORKER_REASONS_RESERVED_BYTES
    + input.fragments * listEntryBytes(MODEL_REASON_MAX_BYTES) + 2 * input.pages * listEntryBytes(String(input.maxPage).length);
  return 2 + items * answer + observations * listEntryBytes(modelObservationMaxBytes(input.maxPage));
}

/** The most pages of a plan read in at most POSTE_READING_MAX_FRAGMENTS fragments with this fragmenting (`buildPdfChunks`). */
export function posteReadingMaxPlanPages(chunking: TakeoffChunkingRuntimeConfig) {
  const step = chunking.chunkSizePages - chunking.overlapPages;
  return Math.max(chunking.thresholdPages, chunking.chunkSizePages + step * (POSTE_READING_MAX_FRAGMENTS - 1));
}

/**
 * The share of a request's budget that reads against the list, over the reservations of its admitted calls at the
 * ledger's estimate: twice. The last admitted call of a plan starts even when every call before it cost twice the estimate
 * (the ledger reserves each call at the largest of its branch observed so far, so one costly call raises every later
 * reservation); and the margin is all a reading that retries can spend beyond its admitted calls.
 */
export const POSTE_READING_BUDGET_MARGIN = 2;

/**
 * The time of a call on the Mac, as the member is told (estimates, to measure on the bench before the second order is
 * activated): a reading call (a fragment of up to 15 pages and a batch of 40 items), a classifier call (TI-704 aims at
 * 15 s for a page's groups, 4 requests at a time).
 */
export const POSTE_READING_DURATION = { readingCallSeconds: 90, classifierCallSeconds: 15 } as const;

export type PosteReadingLimit = "calls" | "fragments" | "budget" | "answer_bytes" | "publication_bytes";

/**
 * A unit of the request: one plan (or, for a grouped analysis, all of them), its pages read (retained pages, else its
 * page count) and its share of the budget.
 */
export type PosteReadingUnitInput = {
  key: string; pieces: TakeoffLaunchPiece[]; pages: number; budgetTokens: number;
  /** Its highest original page (its pages 1 to `pages` when not given). */
  maxPage?: number;
  /** The most paid calls its vector classifier may make (none when it does not run). */
  vectorCalls?: number;
};

export type PosteReadingBounds = PosteReadingBoundsFacts & {
  /** Every paid call (the reading's and the classifier's), and their reservations at the ledger's estimate. */
  calls: number;
  tokens: number;
  requestBudgetTokens: number;
  answerBytes: number;
  units: Array<{ key: string; fragments: number; batches: number; readingCalls: number; classifierCalls: number; calls: number;
    tokens: number; answerBytes: number;
    /** The most bytes of its answers in its publication, without vector readings (`posteAnswersMaxBytes`). */
    publicationBytes: number;
    exceeded: PosteReadingLimit[] }>;
  /** The request's own bounds exceeded. */
  exceeded: PosteReadingLimit[];
  /** The plans a refusal names: those past a bound of their own, else all of them. Empty when the request is within bounds. */
  pieces: TakeoffLaunchPiece[];
};

/**
 * The request's reading planned as the worker will make it (`planPosteExchangeCalls`), and each bound checked: its reading's
 * calls (every fragment of each plan times the batches of its items) against the ceilings, each plan's fragments against
 * what one answer holds (POSTE_READING_MAX_FRAGMENTS), each plan's answers against the bytes its publication stores
 * (`posteAnswersMaxBytes`), every paid call (the vector
 * classifier's too) reserved at `estimateTokensPerCall` (the ledger's TAKEOFF_PAID_CALL_ESTIMATE_TOKENS) per plan against
 * its share and for the request against its envelope, and its answers' bytes. `batches`: the sizes of the batches
 * `planPosteBatches` makes.
 */
export function boundPosteReadingRequest(input: {
  batches: readonly number[];
  units: readonly PosteReadingUnitInput[];
  requestBudgetTokens: number;
  chunking: TakeoffChunkingRuntimeConfig;
  estimateTokensPerCall: number;
}): PosteReadingBounds {
  if (input.batches.some((size) => !Number.isInteger(size) || size < 1)) throw new Error("A batch holds at least one item.");
  const batchSizes = input.batches;
  // The last of `calls` calls starts only while the balance is still positive after the others took their estimate.
  const cannotStart = (calls: number, budget: number) => calls > 0 && (calls - 1) * input.estimateTokensPerCall >= budget;
  const units = input.units.map((unit) => {
    const fragments = buildPdfChunks(unit.pages, input.chunking);
    const readingCalls = fragments.length * batchSizes.length;
    const classifierCalls = unit.vectorCalls ?? 0;
    const calls = readingCalls + classifierCalls;
    const tokens = calls * input.estimateTokensPerCall;
    const answerBytes = fragments.reduce((total, fragment) => total + batchSizes.reduce((sum, size) =>
      sum + posteExchangeOutputMaxBytes(size, fragment.endPage - fragment.startPage + 1), 0), 0);
    const publicationBytes = posteAnswersMaxBytes({ batches: batchSizes, fragments: fragments.length, pages: unit.pages,
      maxPage: Math.max(unit.maxPage ?? unit.pages, 1) });
    const exceeded: PosteReadingLimit[] = [];
    if (readingCalls > POSTE_READING_LIMITS.callsPerUnit) exceeded.push("calls");
    if (fragments.length > POSTE_READING_MAX_FRAGMENTS) exceeded.push("fragments");
    if (cannotStart(calls, unit.budgetTokens)) exceeded.push("budget");
    if (answerBytes > POSTE_READING_LIMITS.unitAnswerBytes) exceeded.push("answer_bytes");
    if (publicationBytes > TAKEOFF_ITEM_ANSWER_LIMITS.answersBytes) exceeded.push("publication_bytes");
    return { key: unit.key, fragments: fragments.length, batches: batchSizes.length, readingCalls, classifierCalls, calls, tokens,
      answerBytes, publicationBytes, exceeded };
  });
  const total = (field: "readingCalls" | "classifierCalls" | "calls" | "tokens" | "answerBytes") =>
    units.reduce((sum, unit) => sum + unit[field], 0);
  const [readingCalls, classifierCalls, calls, tokens, answerBytes] =
    (["readingCalls", "classifierCalls", "calls", "tokens", "answerBytes"] as const).map(total);
  const exceeded: PosteReadingLimit[] = [];
  if (readingCalls > POSTE_READING_LIMITS.callsPerRequest) exceeded.push("calls");
  if (cannotStart(calls, input.requestBudgetTokens)) exceeded.push("budget");
  if (answerBytes > POSTE_READING_LIMITS.requestAnswerBytes) exceeded.push("answer_bytes");
  const ownExceeded = input.units.filter((_, index) => units[index].exceeded.length > 0);
  const named = ownExceeded.length ? ownExceeded : exceeded.length ? input.units : [];
  const ok = exceeded.length === 0 && ownExceeded.length === 0;
  const seconds = readingCalls * POSTE_READING_DURATION.readingCallSeconds + classifierCalls * POSTE_READING_DURATION.classifierCallSeconds;
  return {
    ok, items: batchSizes.reduce((sum, size) => sum + size, 0), plans: input.units.reduce((sum, unit) => sum + unit.pieces.length, 0),
    readingCalls, classifierCalls, minutes: Math.ceil(seconds / 60), maxRequestCalls: POSTE_READING_LIMITS.callsPerRequest,
    maxPlanCalls: POSTE_READING_LIMITS.callsPerUnit, maxPlanPages: posteReadingMaxPlanPages(input.chunking), calls, tokens, requestBudgetTokens: input.requestBudgetTokens, answerBytes, units,
    exceeded, pieces: named.flatMap((unit) => unit.pieces),
  };
}

/**
 * The bounds of a sealed manifest that orders a list of items (none for the free extraction): each unit of one analysis
 * per plan with the share it sealed, or a grouped analysis as one unit holding every plan with the request's envelope.
 * A unit's pages are its retained pages, else its page count, else weighed as lot 3 weighs a plan of unknown count;
 * `countedPages` gives the pages a worker counted on a unit's own PDF (by unit key), in their place. `items`: the items
 * the order asks (its asked_item_ids when it names some, else every item of the sealed revision; their batches are
 * counted by their bytes); `vectorCalls`: the most calls the vector classifier may make on a unit of so many vector pages.
 */
export function posteReadingBoundsOfManifest(manifest: AnyTakeoffLaunchManifest, chunking: TakeoffChunkingRuntimeConfig,
  estimateTokensPerCall: number, items: readonly Poste[], vectorCalls: (vectorPages: number) => number = () => 0,
  countedPages: ReadonlyMap<string, number> = new Map()): PosteReadingBounds | null {
  if (manifest.order.kind !== "item_list") return null;
  const asked = manifest.order.list.asked_item_ids;
  if (asked ? items.length !== asked.length || items.some((item) => !asked.includes(item.id.toLowerCase()))
    : items.length !== manifest.order.list.item_count) {
    throw new Error("The items bounded are not the ones the manifest asks.");
  }
  const pagesOf = new Map(manifest.plans.map((plan, index) => [plan.entry_key, takeoffPlanWeights(manifest.plans)[index]]));
  const piece = (entryKey: string) => {
    const plan = manifest.plans.find((entry) => entry.entry_key === entryKey);
    return { id: plan?.plan_file_id ?? entryKey, name: plan?.name ?? entryKey };
  };
  const pages = (unit: { key: string; plans: string[] }) => countedPages.get(unit.key)
    ?? unit.plans.reduce((total, key) => total + (pagesOf.get(key) ?? 1), 0);
  // A plan's highest original page: its last retained page, else its page count (else its weight).
  const maxPage = (unit: { plans: string[] }) => Math.max(1, ...unit.plans.map((key) => {
    const plan = manifest.plans.find((entry) => entry.entry_key === key);
    return plan?.pages.length ? Math.max(...plan.pages) : plan?.page_count ?? pagesOf.get(key) ?? 1;
  }));
  const units: PosteReadingUnitInput[] = manifest.format_version === 2
    ? manifest.units.map((unit) => ({ key: unit.key, pieces: unit.plans.map(piece), budgetTokens: unit.budget.tokens,
      pages: pages(unit), maxPage: maxPage(unit), vectorCalls: vectorCalls(unit.vector_pages) }))
    : manifest.units.map((unit) => ({ key: unit.key, pieces: unit.plans.map(piece), budgetTokens: manifest.budget.tokens,
      pages: pages(unit), maxPage: maxPage(unit), vectorCalls: vectorCalls(TAKEOFF_LAUNCH_VECTOR_PAGES) }));
  return boundPosteReadingRequest({ batches: planPosteBatches(items).map((batch) => batch.length), units,
    requestBudgetTokens: manifest.budget.tokens, chunking, estimateTokensPerCall });
}

/**
 * The budget of a sealed manifest that orders a list of items, sized from the calls it is admitted for: each unit's share
 * of tokens is what its paid calls reserve at `estimateTokensPerCall`, times POSTE_READING_BUDGET_MARGIN, and the
 * envelope their sum (the seal's rule: the shares add up to the envelope); the cost envelope and its shares stay as
 * sealed (the tenant's, split by pages): the local reader's calls cost no cent. Then the bounds of the sized manifest:
 * within its ceilings, every admitted call can start. The free extraction is left as sealed, its budget the tenant's.
 */
export function sizePosteReadingManifest<T extends AnyTakeoffLaunchManifest>(manifest: T, chunking: TakeoffChunkingRuntimeConfig,
  estimateTokensPerCall: number, items: readonly Poste[], vectorCalls: (vectorPages: number) => number = () => 0):
  { manifest: T; bounds: PosteReadingBounds | null } {
  const planned = posteReadingBoundsOfManifest(manifest, chunking, estimateTokensPerCall, items, vectorCalls);
  if (!planned) return { manifest, bounds: null };
  const share = (calls: number) => calls * estimateTokensPerCall * POSTE_READING_BUDGET_MARGIN;
  const shares = planned.units.map((unit) => share(unit.calls));
  const sized = (manifest.format_version === 2
    ? { ...manifest, units: manifest.units.map((unit, index) => ({ ...unit, budget: { ...unit.budget, tokens: shares[index] } })),
      budget: { ...manifest.budget, tokens: shares.reduce((sum, tokens) => sum + tokens, 0) } }
    : { ...manifest, budget: { ...manifest.budget, tokens: shares.reduce((sum, tokens) => sum + tokens, 0) } }) as T;
  return { manifest: sized, bounds: posteReadingBoundsOfManifest(sized, chunking, estimateTokensPerCall, items, vectorCalls)! };
}

/**
 * The items a sealed order asks, in the sealed list's order: those its `asked_item_ids` names (a new measure of a
 * selection, which names them by identifier), else every item. What the admission and its preview size and what the
 * worker reads, its batches split on count and on bytes in that order: one order for all three. Null when an item it
 * names is not in the list, or is named twice.
 */
export function postesAskedBy<T extends Poste>(items: readonly T[], askedItemIds: readonly string[] | null | undefined): T[] | null {
  if (!askedItemIds) return [...items];
  const asked = new Set(askedItemIds.map((id) => id.toLowerCase()));
  const kept = items.filter((item) => asked.has(item.id.toLowerCase()));
  return asked.size === askedItemIds.length && kept.length === asked.size ? kept : null;
}

/** The refusal of a request past its bounds: the plans to restrict, with the launch reason the member already reads. */
export function posteReadingRefusal(bounds: PosteReadingBounds): { reason: "PLAN_SET_TOO_LARGE"; pieces: TakeoffLaunchPiece[] } | null {
  return bounds.ok ? null : { reason: "PLAN_SET_TOO_LARGE", pieces: bounds.pieces };
}
