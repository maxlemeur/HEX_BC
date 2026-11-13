import { quantityAmountCents } from "@/lib/money";
import { takeoffHypothesisCause } from "@/lib/takeoff/hypothesis";
import { TAKEOFF_PAGE_TRIAGE_UNKNOWN } from "@/lib/takeoff/page-triage";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import { takeoffItemLocation } from "@/lib/takeoff/scope-location";
import type { TargetedReviewLine } from "@/lib/takeoff/targeted-review";
import type { ApplyGuardItem } from "@/lib/takeoff/guards";

// TI-701 (D13): the targeted review is read affaire by affaire with these filters, each with its count, kept in the
// address (a reload or a shared link shows the same lines):
// - the view, one choice: À revoir (every line), Blocages (the lines the apply guard stops, reviewBlockReasons),
//   Règle en échec, Incertaines;
// - Gros montants: the lines that together make 80 % of the takeoff's priced amount, largest first (Pareto), each at
//   its quantity × its estimate line's unit price, in integer cents (money.ts). No euro threshold: 80 % of the amount
//   reads the same on a small or a large affaire. An unpriced line is never one: it has its own filter;
// - Hypothèses: the lines whose quantity is one of TI-682's hypotheses (takeoffHypothesisCause), not a confidence;
// - Non chiffré: the lines the review context links to no estimate line, or only to a line « Non chiffrée »;
// - Réseau ou lot, Niveau ou zone, Plan et indice: values the lines hold (network class, else the lot of the priced
//   line; the page's level and zone from the triage, else the line's own location; the source plan and its revision),
//   never free text. Several values of one kind widen the list (OR), the kinds narrow it (AND). Each line holds at most
//   one value of a kind, so a value is a set of lines and the choices of a kind add up.
// A filter whose data the job lacks (no priced line, no line with a network or a lot…) is not offered, and one the
// address still holds is ignored, which the screen says. A value of a kind the lines hold stays a choice even once its
// own lines are gone (decided): the list then says it has no line for these filters. The line being edited is never hidden: dropped by a filter,
// it stays listed in its place, with a notice (TI-721's rule).

export const TARGETED_REVIEW_VIEWS = ["all", "blocked", "rule_failed", "uncertain"] as const;
export type TargetedReviewView = (typeof TARGETED_REVIEW_VIEWS)[number];
export const TARGETED_REVIEW_FLAGS = ["large", "hypotheses", "unpriced"] as const;
export type TargetedReviewFlag = (typeof TARGETED_REVIEW_FLAGS)[number];
export const TARGETED_REVIEW_FACETS = ["network", "location", "plan"] as const;
export type TargetedReviewFacet = (typeof TARGETED_REVIEW_FACETS)[number];

export type TargetedReviewFilters = {
  view: TargetedReviewView;
} & Record<TargetedReviewFlag, boolean> & Record<TargetedReviewFacet, readonly string[]>;

export const EMPTY_TARGETED_REVIEW_FILTERS: TargetedReviewFilters = Object.freeze({
  view: "all", large: false, hypotheses: false, unpriced: false, network: [], location: [], plan: [],
});

/** What the filters read of one line of the review. */
export type TargetedReviewFacts = {
  id: string;
  blocked: boolean;
  rule_failed: boolean;
  uncertain: boolean;
} & Record<TargetedReviewFlag, boolean> & Record<TargetedReviewFacet, string | null>;

// ---------------------------------------------------------------------------------------------------------------------
// Gros montants
// ---------------------------------------------------------------------------------------------------------------------

/** The share of the priced amount the large lines make at least, in basis points. */
export const LARGE_AMOUNT_SHARE_BP = 8000;

export type LargeAmounts = {
  ids: ReadonlySet<string>;
  /** What the large lines make together, and the priced amount of the takeoff. */
  covered_cents: number;
  total_cents: number;
  /** covered / total, floored: never more than they make. */
  covered_percent: number;
};

/**
 * The lines that together make `shareBp` of the priced amount, largest first. Lines of one amount are taken together:
 * cut through a tie, the lines kept would depend on the order they came in. A line without an amount, or priced at
 * zero, is neither large nor part of the total. Exact in integer cents.
 */
export function largeAmounts(lines: ReadonlyArray<{ id: string; amount_cents: number | null }>, shareBp = LARGE_AMOUNT_SHARE_BP): LargeAmounts {
  const priced = lines.filter((line): line is { id: string; amount_cents: number } => line.amount_cents !== null && line.amount_cents > 0)
    .sort((left, right) => right.amount_cents - left.amount_cents);
  const total = priced.reduce((sum, line) => sum + BigInt(line.amount_cents), BigInt(0));
  const ids = new Set<string>();
  let covered = BigInt(0);
  for (let index = 0; index < priced.length && covered * BigInt(10_000) < total * BigInt(shareBp);) {
    const amount = priced[index].amount_cents;
    for (; index < priced.length && priced[index].amount_cents === amount; index += 1) {
      ids.add(priced[index].id);
      covered += BigInt(amount);
    }
  }
  return { ids, covered_cents: Number(covered), total_cents: Number(total),
    covered_percent: total > BigInt(0) ? Number((covered * BigInt(100)) / total) : 0 };
}

/** One takeoff line as the review context links it to an estimate line (review-context-contracts.ts). */
export type TakeoffItemPricing = {
  item_id: string;
  line_id: string;
  pricing_status: string | null;
  unit_price_cents: number | null;
  lot: { id: string; title: string } | null;
};

type PricedLine = { id: string; quantity: number; is_excluded: boolean };

/** A line priced at its unit price: a line « Chiffrée » (or of an engine without statuses) with its unit price. */
function isPriced(entry: TakeoffItemPricing) {
  return entry.unit_price_cents !== null && (entry.pricing_status === null || entry.pricing_status === "priced");
}

/**
 * The amounts and the unpriced lines of a takeoff, from its review context. Only included lines are linked: an
 * excluded line is neither priced nor unpriced. Unpriced is the codebase's notion: no estimate line holds the line
 * (« sans rattachement chiffré ») or only one « Non chiffrée »; a line « Inclus » or « Pour mémoire » has no price by
 * choice and is neither. Without any link nor unlinked line (a sealed version, an unreadable context), the job holds
 * no pricing.
 */
export function takeoffPricingIndex(context: { unlinked_item_ids: readonly string[]; item_pricing: readonly TakeoffItemPricing[] } | null,
  items: readonly PricedLine[]) {
  const amounts = new Map<string, number>();
  const unpriced = new Set<string>();
  const lots = new Map<string, { id: string; title: string }>();
  const available = context !== null && (context.unlinked_item_ids.length > 0 || context.item_pricing.length > 0);
  if (context && available) {
    const included = new Map(items.filter((item) => !item.is_excluded).map((item) => [item.id, item]));
    for (const id of context.unlinked_item_ids) if (included.has(id)) unpriced.add(id);
    for (const entry of context.item_pricing) {
      const item = included.get(entry.item_id);
      if (!item) continue;
      if (entry.lot) lots.set(item.id, entry.lot);
      if (isPriced(entry)) {
        // Beyond exact cents (a quantity of a billion at 100 000 €), the line has no amount rather than a wrong one.
        try {
          amounts.set(item.id, quantityAmountCents(item.quantity, entry.unit_price_cents as number));
        } catch {
          continue;
        }
      } else if (entry.pricing_status === "not_priced" || entry.pricing_status === null || entry.pricing_status === "priced") unpriced.add(item.id);
    }
  }
  const large = largeAmounts([...amounts].map(([id, amount_cents]) => ({ id, amount_cents })));
  return { available, amounts, unpriced, lots, large };
}

export type TakeoffPricingIndex = ReturnType<typeof takeoffPricingIndex>;

// ---------------------------------------------------------------------------------------------------------------------
// Réseau ou lot, niveau ou zone, plan et indice
// ---------------------------------------------------------------------------------------------------------------------

/** A source of the takeoff's preparation, as its snapshot holds it (preparation.ts). */
export type TargetedReviewSource = {
  document_name: string;
  revision: string | null;
  page_triage?: { pages: ReadonlyArray<{ page: number; level: string | null; zone: string | null }> } | null;
};

type ValuedLine = { designation: string; source_file_name: string | null; source_page: number | null; metadata: unknown };

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const token = (value: string | null | undefined) => {
  const text = value?.trim();
  return text && text.toLowerCase() !== TAKEOFF_PAGE_TRIAGE_UNKNOWN ? text : null;
};

/** The key of a plan and its revision, « file|revision » (no revision: « file| »). */
export function planValue(file: string, revision: string | null) {
  return `${file}|${revision ?? ""}`;
}
/** The key of a level and a zone, « level|zone », either one empty. */
export function locationValue(level: string | null, zone: string | null) {
  return `${level ?? ""}|${zone ?? ""}`;
}
export const LOT_VALUE_PREFIX = "lot:";

/**
 * The network, location and plan of a line: its network class (rule inputs), else the lot of its priced estimate line;
 * its page's level and zone in the triage, else the line's own location (takeoffItemLocation: its rule inputs, its
 * vector page, its designation or file name); its source plan, with the revision its preparation gives.
 */
export function targetedReviewLineValues(item: ValuedLine, context: { sources: readonly TargetedReviewSource[]; lot: { id: string } | null }) {
  const network = readRuleInputs(item.metadata)?.network ?? (context.lot ? `${LOT_VALUE_PREFIX}${context.lot.id}` : null);
  const file = item.source_file_name?.trim() || null;
  const source = file ? context.sources.find((entry) => entry.document_name === file) ?? null : null;
  const page = source && item.source_page !== null ? source.page_triage?.pages.find((entry) => entry.page === item.source_page) ?? null : null;
  let level = token(page?.level);
  let zone = token(page?.zone);
  if (!level && !zone) {
    const own = takeoffItemLocation({ designation: item.designation, source_file_name: item.source_file_name, metadata: record(item.metadata) });
    if (!own.ambiguous) {
      level = own.level;
      zone = own.zone;
    }
  }
  return {
    network,
    location: level || zone ? locationValue(level, zone) : null,
    plan: file ? planValue(file, token(source?.revision)) : null,
  };
}

/** What the filters read of the review's lines. */
export function targetedReviewFacts<T extends ApplyGuardItem & ValuedLine & { quantity_entry_category?: string | null }>(
  lines: readonly TargetedReviewLine<T>[], context: { pricing: TakeoffPricingIndex; sources: readonly TargetedReviewSource[] }): TargetedReviewFacts[] {
  return lines.map((line) => ({
    id: line.item.id,
    blocked: line.tier === "rejected",
    rule_failed: line.reasons.includes("rule_failed"),
    uncertain: line.tier === "uncertain",
    large: context.pricing.large.ids.has(line.item.id),
    hypotheses: takeoffHypothesisCause(line.item) !== null,
    unpriced: context.pricing.unpriced.has(line.item.id),
    ...targetedReviewLineValues(line.item, { sources: context.sources, lot: context.pricing.lots.get(line.item.id) ?? null }),
  }));
}

// ---------------------------------------------------------------------------------------------------------------------
// Filtering and counts
// ---------------------------------------------------------------------------------------------------------------------

type Kind = "view" | TargetedReviewFlag | TargetedReviewFacet;

function viewMatches(line: TargetedReviewFacts, view: TargetedReviewView) {
  return view === "all" || line[view];
}

function matches(line: TargetedReviewFacts, filters: TargetedReviewFilters, except: Kind | null) {
  if (except !== "view" && !viewMatches(line, filters.view)) return false;
  for (const flag of TARGETED_REVIEW_FLAGS) if (except !== flag && filters[flag] && !line[flag]) return false;
  for (const facet of TARGETED_REVIEW_FACETS) {
    const chosen = filters[facet];
    if (except !== facet && chosen.length > 0 && (line[facet] === null || !chosen.includes(line[facet] as string))) return false;
  }
  return true;
}

const compare = (left: string, right: string) => left.localeCompare(right, "fr", { numeric: true });

export type TargetedReviewFilterResult = {
  /** The ids listed, in the review's order: the lines the filters keep, and the kept line. */
  visible: string[];
  /** The line being edited, listed although the filters drop it; null when they keep it. */
  kept: string | null;
  /** The filters the address holds but the job has no data for (no amount, no line holding the kind): ignored. */
  ignored: Array<TargetedReviewFlag | TargetedReviewFacet>;
  /** Each choice's count, with the other kinds' filters. */
  counts: { view: Record<TargetedReviewView, number> } & Record<TargetedReviewFlag, number>
    & { facets: Record<TargetedReviewFacet, Array<{ value: string; count: number }>> };
};

/**
 * The lines the filters keep, the line being edited kept in its place, and each choice's count: the lines it would
 * list with the other kinds' filters, never its own (a value of a kind adds lines to the others).
 */
export function filterTargetedReview(lines: readonly TargetedReviewFacts[], requested: TargetedReviewFilters,
  context: { available: Record<TargetedReviewFlag, boolean>; kept: string | null }): TargetedReviewFilterResult {
  const held = new Set(TARGETED_REVIEW_FACETS.filter((facet) => lines.some((line) => line[facet] !== null)));
  const ignored = [...TARGETED_REVIEW_FLAGS.filter((flag) => requested[flag] && !context.available[flag]),
    ...TARGETED_REVIEW_FACETS.filter((facet) => requested[facet].length > 0 && !held.has(facet))];
  const filters: TargetedReviewFilters = { ...requested, ...Object.fromEntries(ignored.map((kind) =>
    [kind, (TARGETED_REVIEW_FLAGS as readonly string[]).includes(kind) ? false : []])) };
  const kept = lines.find((line) => line.id === context.kept && !matches(line, filters, null))?.id ?? null;
  const count = (kind: Kind, test: (line: TargetedReviewFacts) => boolean) =>
    lines.filter((line) => matches(line, filters, kind) && test(line)).length;
  return {
    visible: lines.filter((line) => line.id === kept || matches(line, filters, null)).map((line) => line.id),
    kept,
    ignored,
    counts: {
      view: Object.fromEntries(TARGETED_REVIEW_VIEWS.map((view) => [view, count("view", (line) => viewMatches(line, view))])) as Record<TargetedReviewView, number>,
      large: count("large", (line) => line.large),
      hypotheses: count("hypotheses", (line) => line.hypotheses),
      unpriced: count("unpriced", (line) => line.unpriced),
      facets: Object.fromEntries(TARGETED_REVIEW_FACETS.map((facet) => {
        const values = new Set([...lines.flatMap((line) => (line[facet] === null ? [] : [line[facet] as string])), ...filters[facet]]);
        return [facet, [...values].sort(compare).map((value) => ({ value, count: count(facet, (line) => line[facet] === value) }))];
      })) as Record<TargetedReviewFacet, Array<{ value: string; count: number }>>,
    },
  };
}

export function hasTargetedReviewFilters(filters: TargetedReviewFilters) {
  return filters.view !== "all" || TARGETED_REVIEW_FLAGS.some((flag) => filters[flag])
    || TARGETED_REVIEW_FACETS.some((facet) => filters[facet].length > 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// The address
// ---------------------------------------------------------------------------------------------------------------------

const VALUE_MAX = 512;
const VALUES_MAX = 50;

function values(params: URLSearchParams, name: TargetedReviewFacet) {
  return [...new Set(params.getAll(name).map((value) => value.trim()).filter((value) => value.length > 0 && value.length <= VALUE_MAX))]
    .sort(compare).slice(0, VALUES_MAX);
}

/** The filters an address holds; anything else it holds is no filter. */
export function readTargetedReviewFilters(params: URLSearchParams): TargetedReviewFilters {
  const view = params.get("view");
  return {
    view: TARGETED_REVIEW_VIEWS.includes(view as TargetedReviewView) ? view as TargetedReviewView : "all",
    ...Object.fromEntries(TARGETED_REVIEW_FLAGS.map((flag) => [flag, params.get(flag) === "1"])) as Record<TargetedReviewFlag, boolean>,
    ...Object.fromEntries(TARGETED_REVIEW_FACETS.map((facet) => [facet, values(params, facet)])) as Record<TargetedReviewFacet, string[]>,
  };
}

/** The address with these filters, in one order (the same filters, one address); its other parameters kept. */
export function writeTargetedReviewFilters(params: URLSearchParams, filters: TargetedReviewFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of ["view", ...TARGETED_REVIEW_FLAGS, ...TARGETED_REVIEW_FACETS]) next.delete(name);
  if (filters.view !== "all") next.set("view", filters.view);
  for (const flag of TARGETED_REVIEW_FLAGS) if (filters[flag]) next.set(flag, "1");
  for (const facet of TARGETED_REVIEW_FACETS) for (const value of [...new Set(filters[facet])].sort(compare)) next.append(facet, value);
  return next;
}
