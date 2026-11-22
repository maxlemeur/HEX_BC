import { ITEM_AGGREGATE_STATES, type ItemAggregateState } from "./item-answer-aggregation";
import { ITEM_LINE_DECISIONS, type ItemLineDecision, type ItemTableFilter, type ItemTableScope } from "./item-table";
import { ITEM_TABLE_PAGE_SIZES } from "./item-table-contracts";

/**
 * The address of a view of the table of items, read by its API and written by the screen alike: its scope (one plan or
 * the affaire), its filters, its page and the item in focus. An address selects a view, never a gesture, a payer or a
 * right. On the page of the affaire's takeoff each parameter carries the prefix « poste ».
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_VALUES = 50;

export type ItemTableAddress = {
  scope: ItemTableScope;
  filter: ItemTableFilter;
  offset: number;
  limit: (typeof ITEM_TABLE_PAGE_SIZES)[number];
  focusItemId: string | null;
};

type Params = { getAll(name: string): string[]; get(name: string): string | null };

const values = (params: Params, name: string) => params.getAll(name).flatMap((value) => value.split(","))
  .map((value) => value.trim()).filter(Boolean).slice(0, MAX_VALUES);
const oneOf = <T extends string>(allowed: readonly T[], list: string[]) =>
  [...new Set(list.filter((value): value is T => (allowed as readonly string[]).includes(value)))];

/** The view an address names; anything it does not understand is left out, never an error. */
export function readItemTableAddress(params: Params, prefix = ""): ItemTableAddress {
  const key = (name: string) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  const plan = params.get(key("plan"))?.trim();
  const states = oneOf<ItemAggregateState>(ITEM_AGGREGATE_STATES, values(params, key("state")));
  const decisions = oneOf<ItemLineDecision>(ITEM_LINE_DECISIONS, values(params, key("decision")));
  const families = [...new Set(params.getAll(key("family")).filter(Boolean))].slice(0, MAX_VALUES);
  const locations = [...new Set(values(params, key("location")))];
  const offset = Number(params.get(key("offset")));
  const limit = Number(params.get(key("limit")));
  const focus = params.get(key("focus"));
  return {
    scope: plan && plan.length <= 200 ? { kind: "plan", planKey: plan } : { kind: "affaire" },
    filter: {
      ...(states.length ? { states } : {}),
      ...(families.length ? { families } : {}),
      ...(locations.length ? { locations } : {}),
      ...(decisions.length ? { decisions } : {}),
    },
    offset: Number.isSafeInteger(offset) && offset > 0 ? offset : 0,
    limit: (ITEM_TABLE_PAGE_SIZES as readonly number[]).includes(limit) ? limit as ItemTableAddress["limit"] : ITEM_TABLE_PAGE_SIZES[1],
    focusItemId: focus && UUID.test(focus) ? focus.toLowerCase() : null,
  };
}

/** The parameters of a view, to merge into an address (an absent value removes its parameter). */
export function itemTableAddressParams(address: Partial<ItemTableAddress>, prefix = ""): Record<string, string[] | null> {
  const key = (name: string) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
  const list = (items: readonly string[] | undefined) => items?.length ? [...items] : null;
  const out: Record<string, string[] | null> = {};
  if ("scope" in address) out[key("plan")] = address.scope?.kind === "plan" ? [address.scope.planKey] : null;
  if ("filter" in address) {
    out[key("state")] = list(address.filter?.states);
    out[key("family")] = list(address.filter?.families);
    out[key("location")] = list(address.filter?.locations);
    out[key("decision")] = list(address.filter?.decisions);
  }
  if ("offset" in address) out[key("offset")] = address.offset ? [String(address.offset)] : null;
  if ("limit" in address) out[key("limit")] = address.limit && address.limit !== ITEM_TABLE_PAGE_SIZES[1] ? [String(address.limit)] : null;
  if ("focusItemId" in address) out[key("focus")] = address.focusItemId ? [address.focusItemId] : null;
  return out;
}

/** An address with these parameters set or removed, the others kept. */
export function withItemTableParams(search: string, params: Record<string, string[] | null>) {
  const next = new URLSearchParams(search);
  for (const [name, list] of Object.entries(params)) {
    next.delete(name);
    for (const value of list ?? []) next.append(name, value);
  }
  return next;
}
