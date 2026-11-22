import { buildPdfChunks, type TakeoffChunkingRuntimeConfig } from "@/lib/takeoff/chunking";
import type { TakeoffLaunchPiece } from "@/lib/takeoff/launch-request";
import { POSTE_EXCHANGE_LIMITS, posteExchangeOutputMaxBytes } from "@/lib/takeoff/poste-exchange";

/**
 * The bounds of a request that reads its plans against a list of items (lot 4), checked on the whole request before its
 * admission: the calls its reading makes (each plan's fragments times the batches of items), the reservations of those
 * calls in the request's ledger (lot 3: every paid call reserves the ledger's estimate before it is sent, against its
 * plan's share and against the request) and the largest answers they can return. Beyond any bound the member is asked
 * to reduce the scope: nothing is sampled, no item or page is left out silently.
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

/** A unit of the request: one plan, its pages read (retained pages, else its page count) and its share of the budget. */
export type PosteReadingUnitInput = { key: string; planId: string; name: string; pages: number; budgetTokens: number };

export type PosteReadingBounds = {
  ok: boolean;
  items: number;
  plans: number;
  calls: number;
  /** The tokens the calls reserve together: calls times the ledger's estimate. */
  tokens: number;
  requestBudgetTokens: number;
  answerBytes: number;
  units: Array<{ key: string; fragments: number; batches: number; calls: number; tokens: number; answerBytes: number;
    exceeded: PosteReadingLimit[] }>;
  /** The request's own bounds exceeded. */
  exceeded: PosteReadingLimit[];
  /** The plans a refusal names: those past a bound of their own, else all of them. Empty when the request is within bounds. */
  pieces: TakeoffLaunchPiece[];
};

/**
 * The request's reading planned as the worker will make it (`planPosteExchangeCalls`), and each bound checked: its calls,
 * its reservations (`estimateTokensPerCall`: the ledger's TAKEOFF_PAID_CALL_ESTIMATE_TOKENS) and its answers' bytes, per
 * plan against its share and for the request against its envelope.
 */
export function boundPosteReadingRequest(input: {
  items: number;
  units: readonly PosteReadingUnitInput[];
  requestBudgetTokens: number;
  chunking: TakeoffChunkingRuntimeConfig;
  estimateTokensPerCall: number;
}): PosteReadingBounds {
  if (!Number.isInteger(input.items) || input.items < 0) throw new Error("The items of a request are counted by a whole number.");
  const batchSizes = Array.from({ length: Math.ceil(input.items / POSTE_EXCHANGE_LIMITS.itemsPerCall) }, (_, index) =>
    Math.min(POSTE_EXCHANGE_LIMITS.itemsPerCall, input.items - index * POSTE_EXCHANGE_LIMITS.itemsPerCall));
  const units = input.units.map((unit) => {
    const fragments = buildPdfChunks(unit.pages, input.chunking);
    const calls = fragments.length * batchSizes.length;
    const tokens = calls * input.estimateTokensPerCall;
    const answerBytes = fragments.reduce((total, fragment) => total + batchSizes.reduce((sum, size) =>
      sum + posteExchangeOutputMaxBytes(size, fragment.endPage - fragment.startPage + 1), 0), 0);
    const exceeded: PosteReadingLimit[] = [];
    if (calls > POSTE_READING_LIMITS.callsPerUnit) exceeded.push("calls");
    if (tokens > unit.budgetTokens) exceeded.push("budget");
    if (answerBytes > POSTE_READING_LIMITS.unitAnswerBytes) exceeded.push("answer_bytes");
    return { key: unit.key, fragments: fragments.length, batches: batchSizes.length, calls, tokens, answerBytes, exceeded };
  });
  const calls = units.reduce((total, unit) => total + unit.calls, 0);
  const tokens = units.reduce((total, unit) => total + unit.tokens, 0);
  const answerBytes = units.reduce((total, unit) => total + unit.answerBytes, 0);
  const exceeded: PosteReadingLimit[] = [];
  if (calls > POSTE_READING_LIMITS.callsPerRequest) exceeded.push("calls");
  if (tokens > input.requestBudgetTokens) exceeded.push("budget");
  if (answerBytes > POSTE_READING_LIMITS.requestAnswerBytes) exceeded.push("answer_bytes");
  const ownExceeded = input.units.filter((_, index) => units[index].exceeded.length > 0);
  const named = ownExceeded.length ? ownExceeded : exceeded.length ? input.units : [];
  const ok = exceeded.length === 0 && ownExceeded.length === 0;
  return {
    ok, items: input.items, plans: input.units.length, calls, tokens, requestBudgetTokens: input.requestBudgetTokens, answerBytes,
    units, exceeded, pieces: named.map((unit) => ({ id: unit.planId, name: unit.name })),
  };
}

/** The refusal of a request past its bounds: the plans to restrict, with the launch reason the member already reads. */
export function posteReadingRefusal(bounds: PosteReadingBounds): { reason: "PLAN_SET_TOO_LARGE"; pieces: TakeoffLaunchPiece[] } | null {
  return bounds.ok ? null : { reason: "PLAN_SET_TOO_LARGE", pieces: bounds.pieces };
}

const count = (value: number, one: string, many: string) => `${value.toLocaleString("fr-FR")} ${value > 1 ? many : one}`;

/** The effective limits of a request, in French, as the member reads them before confirming or after a refusal. */
export function describePosteReadingBounds(bounds: PosteReadingBounds): string {
  const text = `Lecture de ${count(bounds.items, "poste", "postes")} sur ${count(bounds.plans, "plan", "plans")} : `
    + `${count(bounds.calls, "appel prévu", "appels prévus")}, ${bounds.tokens.toLocaleString("fr-FR")} jetons réservés pour un budget `
    + `de ${bounds.requestBudgetTokens.toLocaleString("fr-FR")}.`;
  return bounds.ok ? text : `${text} Réduisez les plans ou les pages à lire.`;
}
