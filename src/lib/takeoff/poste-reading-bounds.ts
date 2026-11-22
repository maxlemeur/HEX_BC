import { buildPdfChunks, type TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import {
  TAKEOFF_LAUNCH_VECTOR_PAGES, takeoffPlanWeights, type AnyTakeoffLaunchManifest, type TakeoffLaunchPiece,
} from "@/lib/takeoff/launch-request";
import { planPosteBatches, posteExchangeOutputMaxBytes } from "@/lib/takeoff/poste-exchange";
import type { Poste } from "@/lib/takeoff/poste-list";
import type { PosteReadingBoundsFacts } from "@/lib/takeoff/poste-reading-bounds-text";

export { describePosteReadingBounds } from "@/lib/takeoff/poste-reading-bounds-text";

/**
 * The bounds of a request that reads its plans against a list of items (lot 4), checked on the whole request before its
 * admission: the calls its reading makes (each plan's fragments times the batches of items), the reservations of those
 * calls in the request's ledger and the largest answers they can return. The ledger's rule (lot 3) decides the budget: a
 * paid call starts only while its plan's share and its request still have a positive balance, so the last call of a plan
 * must start before its share is spent at the ledger's estimate of a call. Beyond any bound the member is asked to
 * reduce the scope: nothing is sampled, no item or page is left out silently.
 */
export const POSTE_READING_LIMITS = {
  /** The calls one plan's reading makes at most (about one hour on a Mac at a minute and a half a call). */
  callsPerUnit: 40,
  callsPerRequest: 200,
  /** The largest answers of one plan's calls together: what its publication may carry. */
  unitAnswerBytes: 8 * 1024 * 1024,
  requestAnswerBytes: 64 * 1024 * 1024,
} as const;

export type PosteReadingLimit = "calls" | "budget" | "answer_bytes";

/**
 * A unit of the request: one plan (or, for a grouped analysis, all of them), its pages read (retained pages, else its
 * page count) and its share of the budget.
 */
export type PosteReadingUnitInput = {
  key: string; pieces: TakeoffLaunchPiece[]; pages: number; budgetTokens: number;
  /** The most paid calls its vector classifier may make (none when it does not run). */
  vectorCalls?: number;
};

export type PosteReadingBounds = PosteReadingBoundsFacts & {
  answerBytes: number;
  units: Array<{ key: string; fragments: number; batches: number; calls: number; tokens: number; answerBytes: number;
    exceeded: PosteReadingLimit[] }>;
  /** The request's own bounds exceeded. */
  exceeded: PosteReadingLimit[];
  /** The plans a refusal names: those past a bound of their own, else all of them. Empty when the request is within bounds. */
  pieces: TakeoffLaunchPiece[];
};

/**
 * The request's reading planned as the worker will make it (`planPosteExchangeCalls`), and each bound checked: its calls
 * (every fragment of each plan times the batches of its items, plus the vector classifier's), its reservations
 * (`estimateTokensPerCall`: the ledger's TAKEOFF_PAID_CALL_ESTIMATE_TOKENS) and its answers' bytes, per plan against its
 * share and for the request against its envelope. `batches`: the sizes of the batches `planPosteBatches` makes.
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
    const calls = fragments.length * batchSizes.length + (unit.vectorCalls ?? 0);
    const tokens = calls * input.estimateTokensPerCall;
    const answerBytes = fragments.reduce((total, fragment) => total + batchSizes.reduce((sum, size) =>
      sum + posteExchangeOutputMaxBytes(size, fragment.endPage - fragment.startPage + 1), 0), 0);
    const exceeded: PosteReadingLimit[] = [];
    if (calls > POSTE_READING_LIMITS.callsPerUnit) exceeded.push("calls");
    if (cannotStart(calls, unit.budgetTokens)) exceeded.push("budget");
    if (answerBytes > POSTE_READING_LIMITS.unitAnswerBytes) exceeded.push("answer_bytes");
    return { key: unit.key, fragments: fragments.length, batches: batchSizes.length, calls, tokens, answerBytes, exceeded };
  });
  const calls = units.reduce((total, unit) => total + unit.calls, 0);
  const tokens = units.reduce((total, unit) => total + unit.tokens, 0);
  const answerBytes = units.reduce((total, unit) => total + unit.answerBytes, 0);
  const exceeded: PosteReadingLimit[] = [];
  if (calls > POSTE_READING_LIMITS.callsPerRequest) exceeded.push("calls");
  if (cannotStart(calls, input.requestBudgetTokens)) exceeded.push("budget");
  if (answerBytes > POSTE_READING_LIMITS.requestAnswerBytes) exceeded.push("answer_bytes");
  const ownExceeded = input.units.filter((_, index) => units[index].exceeded.length > 0);
  const named = ownExceeded.length ? ownExceeded : exceeded.length ? input.units : [];
  const ok = exceeded.length === 0 && ownExceeded.length === 0;
  return {
    ok, items: batchSizes.reduce((total, size) => total + size, 0), plans: input.units.reduce((total, unit) => total + unit.pieces.length, 0), calls, tokens,
    requestBudgetTokens: input.requestBudgetTokens, answerBytes, units, exceeded, pieces: named.flatMap((unit) => unit.pieces),
  };
}

/**
 * The bounds of a sealed manifest that orders a list of items (none for the free extraction): each unit of one analysis
 * per plan with the share it sealed, or a grouped analysis as one unit holding every plan with the request's envelope.
 * A unit's pages are its retained pages, else its page count, else weighed as lot 3 weighs a plan of unknown count.
 * `items`: the sealed revision's items (their batches are counted by their bytes); `vectorCalls`: the most calls the
 * vector classifier may make on a unit of so many vector pages.
 */
export function posteReadingBoundsOfManifest(manifest: AnyTakeoffLaunchManifest, chunking: TakeoffChunkingRuntimeConfig,
  estimateTokensPerCall: number, items: readonly Poste[], vectorCalls: (vectorPages: number) => number = () => 0): PosteReadingBounds | null {
  if (manifest.order.kind !== "item_list") return null;
  if (items.length !== manifest.order.list.item_count) throw new Error("The items bounded are not the list the manifest sealed.");
  const pagesOf = new Map(manifest.plans.map((plan, index) => [plan.entry_key, takeoffPlanWeights(manifest.plans)[index]]));
  const piece = (entryKey: string) => {
    const plan = manifest.plans.find((entry) => entry.entry_key === entryKey);
    return { id: plan?.plan_file_id ?? entryKey, name: plan?.name ?? entryKey };
  };
  const units: PosteReadingUnitInput[] = manifest.format_version === 2
    ? manifest.units.map((unit) => ({ key: unit.key, pieces: unit.plans.map(piece), budgetTokens: unit.budget.tokens,
      pages: unit.plans.reduce((total, key) => total + (pagesOf.get(key) ?? 1), 0), vectorCalls: vectorCalls(unit.vector_pages) }))
    : manifest.units.map((unit) => ({ key: unit.key, pieces: unit.plans.map(piece), budgetTokens: manifest.budget.tokens,
      pages: unit.plans.reduce((total, key) => total + (pagesOf.get(key) ?? 1), 0), vectorCalls: vectorCalls(TAKEOFF_LAUNCH_VECTOR_PAGES) }));
  return boundPosteReadingRequest({ batches: planPosteBatches(items).map((batch) => batch.length), units,
    requestBudgetTokens: manifest.budget.tokens, chunking, estimateTokensPerCall });
}

/** The refusal of a request past its bounds: the plans to restrict, with the launch reason the member already reads. */
export function posteReadingRefusal(bounds: PosteReadingBounds): { reason: "PLAN_SET_TOO_LARGE"; pieces: TakeoffLaunchPiece[] } | null {
  return bounds.ok ? null : { reason: "PLAN_SET_TOO_LARGE", pieces: bounds.pieces };
}
