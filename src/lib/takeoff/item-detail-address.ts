import type { ItemTableResponseLine } from "@/lib/takeoff/item-table-contracts";
import { normalizePlanKey, itemTableAddressParams, readItemTableAddress, withItemTableParams } from "@/lib/takeoff/item-table-query";
import { type TakeoffItemDetailHrefInput, TAKEOFF_ITEM_DETAIL_PARAMS as P, takeoffItemDetailHref, withoutTakeoffItemDetail } from "@/lib/takeoff/review-href";
import { UUID_PATTERN as UUID } from "@/lib/value-guards";

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
  receipt?: TakeoffItemDetailHrefInput["receipt"];
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
    const requestId = uuid(params, P.measureRequestId);
    const jobId = uuid(params, P.measureJobId);
    const namesReceipt = params.getAll(P.measureRequestId).length + params.getAll(P.measureJobId).length > 0;
    if (namesReceipt && !(requestId && jobId)) return { kind: "invalid" };
    const planKey = opaque(params, P.planKey, PLAN_KEY_MAX);
    const address: ItemDetailAddress = {
      itemId,
      planKey: planKey && normalizePlanKey(planKey),
      jobId: uuid(params, P.jobId),
      page,
      source: documentId ? { documentId, generation } : null,
      answerId: uuid(params, P.answerId),
      observationId: opaque(params, P.observationId, OPAQUE_MAX),
      versionId: uuid(params, P.versionId),
      ...(requestId && jobId && { receipt: { requestId, jobId } }),
    };
    // A generation names the bytes of a dossier piece; a dossier piece is named only before any reading sealed the plan
    // (a reading resolves its own copy), and never beside a plan named otherwise; an observation belongs to an answer.
    if (generation !== null && !documentId) return { kind: "invalid" };
    if (address.source && (address.jobId || address.planKey)) return { kind: "invalid" };
    if (address.observationId && !address.answerId) return { kind: "invalid" };
    // A reading is a reading of a plan: a job alone would let the screen pick another plan than the one it read.
    if (address.jobId && !address.planKey) return { kind: "invalid" };
    if ((page !== null || address.receipt) && !address.planKey && !address.source) return { kind: "invalid" };
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

/** The prefix of the table of items' parameters on the affaire's takeoff page (TakeoffItemTable). */
export const ITEM_TABLE_PARAM_PREFIX = "poste";

/**
 * The way back to the items: the detail's parameters removed, the table's filter, sort and page size kept as they were,
 * the item last shown in focus on the page of the table that holds it (its place in the frozen queue), by the table's own
 * parameters (itemTableAddressParams). The selection lives in the tab (lot 4) and is not in the address.
 */
export function itemTableReturnHref(projectId: string, query: string | URLSearchParams,
  focus: { itemId: string; offset: number } | null) {
  const kept = withoutTakeoffItemDetail(query).toString();
  const next = focus ? withItemTableParams(kept, itemTableAddressParams({ focusItemId: focus.itemId, offset: focus.offset },
    ITEM_TABLE_PARAM_PREFIX)) : new URLSearchParams(kept);
  const search = next.toString();
  return `/dashboard/affaires/${projectId}/takeoff${search ? `?${search}` : ""}`;
}

/**
 * The detail of a line of the table (its « Détail »), on the page's address as it is: the plan the table is filtered on
 * when the item has it, else the first plan that answered for it, else its first reading or none (the detail then opens
 * the dossier's plan to measure); the reading of that plan's answer. The table's parameters stay, the way back reads them.
 */
export function itemTableLineDetailHref(projectId: string, line: Pick<ItemTableResponseLine, "itemId" | "readings" | "remeasurePlans">,
  query: string | URLSearchParams) {
  const scope = readItemTableAddress(new URLSearchParams(query), ITEM_TABLE_PARAM_PREFIX).scope;
  const scoped = scope.kind === "plan" ? scope.planKey : null;
  const reading = scoped ? line.readings.find(({ planKey }) => planKey === scoped) ?? null
    : line.readings.find(({ answer }) => answer !== null) ?? line.readings[0] ?? null;
  const planKey = reading?.planKey ?? (scoped && line.remeasurePlans.includes(scoped) ? scoped : null);
  return takeoffItemDetailHref({ projectId, itemId: line.itemId, planKey, jobId: reading?.answer?.jobId ?? null, from: query });
}

/** The first line of the table's page that holds the item at `index` of the queue (pages of `limit` lines). */
export function itemTablePageOffset(index: number, limit: number) {
  return index > 0 && limit > 0 ? Math.floor(index / limit) * limit : 0;
}

/** A stand-in item, so that a plan request naming no item (the dossier's plan) is read by the address's rules. */
const PLAN_REQUEST_ITEM = "00000000-0000-4000-8000-000000000000";

/**
 * The plan a detail asks the server to resolve (GET …/takeoff/item-detail/plan), read from the same parameters as the
 * detail's address: a plan and its reading, a plan of the dossier, or a dossier piece and its generation, and the item
 * shown (`poste`), required with a reading. Null when the combination is invalid by the address's own rules.
 */
export function readItemDetailPlanRequest(params: Params): { itemId: string | null; planKey: string | null; jobId: string | null;
  source: { documentId: string; generation: string | null } | null } | null {
  const named = params.getAll(P.itemId).length > 0;
  const read = readItemDetailAddress(named ? params : { getAll: (name) => (name === P.itemId ? [PLAN_REQUEST_ITEM] : params.getAll(name)) });
  if (read.kind !== "detail") return null;
  const { planKey, jobId, source } = read.address;
  if (!planKey && !source) return null;
  if (jobId && (!planKey || !named)) return null;
  return { itemId: named ? read.address.itemId : null, planKey, jobId, source };
}
