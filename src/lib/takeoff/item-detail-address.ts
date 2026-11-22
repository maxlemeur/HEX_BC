import {
  TAKEOFF_ITEM_DETAIL_PARAMS as P,
  takeoffItemDetailHref,
  takeoffReviewHref,
  withoutTakeoffItemDetail,
  type TakeoffReviewHrefInput,
} from "@/lib/takeoff/review-href";

/**
 * The address of the detail of an item on its plan (lot 5, second depth of the review), read the same way by the
 * affaire's takeoff page, its server resolution and the screen: `?poste={item}&plan={plan}&lecture={job}&page={n}`,
 * `source={piece}&generation={g}` for a plan no analysis sealed yet, and optionally the answer, the observation and the
 * estimate version a link was followed from. The table's own parameters (`poste…`) and the page's others stay beside it,
 * so that coming back to the items restores the table as it was.
 *
 * An address selects a view, never a gesture, a payer or a right; anything it carries is checked again by the server.
 * A value that cannot be an identifier, a parameter given twice or a combination with two meanings makes the address
 * invalid, shown as « not found », never guessed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A plan's logical identity as the table of items names it (lot 4's contract: at most 200 characters). */
const PLAN_KEY_MAX = 200;
const OPAQUE_MAX = 200;
const PAGE_MAX = 10_000;

export type ItemDetailAddress = {
  itemId: string;
  planKey: string | null;
  jobId: string | null;
  page: number | null;
  source: { documentId: string; generation: string | null } | null;
  answerId: string | null;
  observationId: string | null;
  versionId: string | null;
};

export type ItemDetailAddressRead = { kind: "none" } | { kind: "invalid" } | { kind: "detail"; address: ItemDetailAddress };

type Params = { getAll(name: string): string[] };

class InvalidAddress extends Error {}

function one(params: Params, name: string): string | null {
  const values = params.getAll(name);
  if (values.length > 1) throw new InvalidAddress(name);
  const value = values[0]?.trim();
  return value ? value : null;
}

function uuid(params: Params, name: string) {
  const value = one(params, name);
  if (value === null) return null;
  if (!UUID.test(value)) throw new InvalidAddress(name);
  return value.toLowerCase();
}

function opaque(params: Params, name: string, max: number) {
  const value = one(params, name);
  if (value !== null && value.length > max) throw new InvalidAddress(name);
  return value;
}

/** The detail an address asks for: none without an item, invalid when what it names cannot be resolved as written. */
export function readItemDetailAddress(params: Params): ItemDetailAddressRead {
  if (params.getAll(P.itemId).length === 0) return { kind: "none" };
  try {
    const itemId = uuid(params, P.itemId);
    if (!itemId) return { kind: "invalid" };
    const rawPage = one(params, P.page);
    const page = rawPage === null ? null : Number(rawPage);
    if (page !== null && !(Number.isSafeInteger(page) && page >= 1 && page <= PAGE_MAX && String(page) === rawPage)) {
      return { kind: "invalid" };
    }
    const documentId = uuid(params, P.sourceId);
    const generation = opaque(params, P.generation, OPAQUE_MAX);
    const address: ItemDetailAddress = {
      itemId,
      planKey: opaque(params, P.planKey, PLAN_KEY_MAX),
      jobId: uuid(params, P.jobId),
      page,
      source: documentId ? { documentId, generation } : null,
      answerId: uuid(params, P.answerId),
      observationId: opaque(params, P.observationId, OPAQUE_MAX),
      versionId: uuid(params, P.versionId),
    };
    // A generation names the bytes of a dossier piece; a dossier piece is named only before any reading sealed the plan
    // (a reading resolves its own copy), and never beside a plan named otherwise; an observation belongs to an answer.
    if (generation !== null && !documentId) return { kind: "invalid" };
    if (address.source && (address.jobId || address.planKey)) return { kind: "invalid" };
    if (address.observationId && !address.answerId) return { kind: "invalid" };
    if (page !== null && !address.planKey && !address.source) return { kind: "invalid" };
    return { kind: "detail", address };
  } catch (error) {
    if (error instanceof InvalidAddress) return { kind: "invalid" };
    throw error;
  }
}

/** The address of a detail, from the query of the page it is opened on (the table's parameters kept). */
export function itemDetailHref(projectId: string, address: ItemDetailAddress, from?: string | URLSearchParams) {
  return takeoffItemDetailHref({ projectId, ...address, from });
}

/**
 * The parameters of the table of items on the affaire's takeoff page (lot 4: `readItemTableAddress(params, "poste")`)
 * that the way back sets: the item to focus and the table's page that holds it.
 */
export const ITEM_TABLE_RETURN_PARAMS = { focus: "posteFocus", offset: "posteOffset" } as const;

/**
 * The way back to the items: the detail's parameters removed, the table's filter, sort and page size kept as they were,
 * the item last shown in focus on the page of the table that holds it (its place in the frozen queue). The selection
 * lives in the tab (lot 4) and is not in the address.
 */
export function itemTableReturnHref(projectId: string, query: string | URLSearchParams,
  focus: { itemId: string; offset: number } | null) {
  const next = withoutTakeoffItemDetail(query);
  if (focus) {
    next.set(ITEM_TABLE_RETURN_PARAMS.focus, focus.itemId);
    if (focus.offset > 0) next.set(ITEM_TABLE_RETURN_PARAMS.offset, String(focus.offset));
    else next.delete(ITEM_TABLE_RETURN_PARAMS.offset);
  }
  const search = next.toString();
  return `/dashboard/affaires/${projectId}/takeoff${search ? `?${search}` : ""}`;
}

/** The first line of the table's page that holds the item at `index` of the queue (pages of `limit` lines). */
export function itemTablePageOffset(index: number, limit: number) {
  return index > 0 && limit > 0 ? Math.floor(index / limit) * limit : 0;
}

/**
 * What the `line` of an old review link designates, by the contract of the screen it was written for: the targeted
 * review's line is a takeoff line (a takeoff item of its job), the full review's (from the exceptions and the risk
 * radar) is an estimate line. Neither is an item of the affaire's list: it is resolved in the link's context.
 */
export function historicalLineContract(link: TakeoffReviewHrefInput): "takeoff_line" | "estimate_line" | null {
  if (!link.line) return null;
  return link.targeted ? "takeoff_line" : "estimate_line";
}

/** An item of the affaire's list that an old link's line is evidence for, as the stored answers tell it. */
export type HistoricalLineMatch = { itemId: string; planKey: string | null; answerId: string | null };

export type HistoricalReviewResolution =
  | { kind: "historical"; href: string }
  | { kind: "detail"; href: string }
  | { kind: "choice"; historicalHref: string; options: Array<{ itemId: string; href: string }> };

/**
 * Where an old review link leads now. It keeps opening what it opened (the historical reader, its version, carry-over,
 * mode and view, as the same string) unless its line is known as the evidence of items of the list: one item opens its
 * detail on that reading, with the link's version as context; several are offered to choose, the historical reader
 * among them. No item identifier is ever made up from a line.
 */
export function resolveHistoricalReviewLink(link: TakeoffReviewHrefInput, matches: readonly HistoricalLineMatch[]): HistoricalReviewResolution {
  const historicalHref = takeoffReviewHref(link);
  const unique = [...new Map(matches.map((match) => [`${match.itemId}:${match.planKey ?? ""}:${match.answerId ?? ""}`, match])).values()];
  if (!historicalLineContract(link) || unique.length === 0) return { kind: "historical", href: historicalHref };
  const href = (match: HistoricalLineMatch) => takeoffItemDetailHref({ projectId: link.projectId, itemId: match.itemId,
    planKey: match.planKey, jobId: link.jobId, answerId: match.answerId, versionId: link.versionId ?? null });
  if (unique.length === 1) return { kind: "detail", href: href(unique[0]!) };
  return { kind: "choice", historicalHref, options: unique.map((match) => ({ itemId: match.itemId, href: href(match) })) };
}

/** A stand-in item, so that a plan request is read by the address's rules: the request names no item. */
const PLAN_REQUEST_ITEM = "00000000-0000-4000-8000-000000000000";

/**
 * The plan a detail asks the server to resolve (GET …/takeoff/item-detail/plan), read from the same parameters as the
 * detail's address: a plan and its reading, a plan of the dossier, or a dossier piece and its generation. Null when the
 * combination is invalid by the address's own rules.
 */
export function readItemDetailPlanRequest(params: Params): { planKey: string | null; jobId: string | null;
  source: { documentId: string; generation: string | null } | null } | null {
  const read = readItemDetailAddress({ getAll: (name) => (name === P.itemId ? [PLAN_REQUEST_ITEM] : params.getAll(name)) });
  if (read.kind !== "detail") return null;
  const { planKey, jobId, source } = read.address;
  if (!planKey && !source) return null;
  if (jobId && !planKey) return null;
  return { planKey, jobId, source };
}
