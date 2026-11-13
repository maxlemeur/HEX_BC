import { describe, expect, it } from "vitest";

import {
  EMPTY_TARGETED_REVIEW_FILTERS,
  filterTargetedReview,
  largeAmounts,
  readTargetedReviewFilters,
  takeoffPricingIndex,
  targetedReviewLineValues,
  writeTargetedReviewFilters,
  type TargetedReviewFacts,
  type TargetedReviewFilters,
} from "@/lib/takeoff/targeted-review-filters";

// TI-701 (D13), the targeted review's filters. Ways they fail, written before the code:
// - gros montants: a fixed share cut through a tie keeps one of two equal lines by the order they came in, so a reload
//   or another sort shows other lines; an unpriced line or one priced at zero counts as a large amount, or in the total
//   the 80 % is read from; amounts read in floating point cross the cut wrongly;
// - réseau ou lot, niveau ou zone, plan et indice: two values of one kind narrow the list (AND) instead of widening it
//   (OR), two kinds widen it instead of narrowing it; a count ignores the other filters, or counts its own kind;
// - a line being edited leaves the list when a filter drops it, or a filter whose data the job lacks still hides lines;
// - the address loses a filter, its other parameters (versionId, line) or a value with a « + », or keeps stale ones.

const money = (id: string, amount_cents: number | null) => ({ id, amount_cents });

describe("largeAmounts: the lines that make 80 % of the priced amount, largest first", () => {
  it("takes the largest lines until they make 80 % of the priced amount", () => {
    const large = largeAmounts([money("c", 1000), money("a", 5000), money("e", 500), money("b", 3000), money("d", 500)]);
    expect([...large.ids].sort()).toEqual(["a", "b"]);
    expect(large).toMatchObject({ covered_cents: 8000, total_cents: 10_000, covered_percent: 80 });
  });

  it("keeps lines of the same amount together at the cut, whatever their order", () => {
    // 6 000 makes 60 %; one of the two 2 000 would reach 80 %, so both are large: a tie never depends on the order.
    const lines = [money("a", 6000), money("b", 2000), money("c", 2000)];
    expect([...largeAmounts(lines).ids].sort()).toEqual(["a", "b", "c"]);
    expect([...largeAmounts([...lines].reverse()).ids].sort()).toEqual(["a", "b", "c"]);
    expect(largeAmounts(lines)).toMatchObject({ covered_cents: 10_000, covered_percent: 100 });
    // A tie reached once the cut is made is left out.
    expect([...largeAmounts([money("a", 4000), money("b", 4000), money("c", 1000), money("d", 1000)]).ids].sort()).toEqual(["a", "b"]);
  });

  it("never counts an unpriced line nor a line priced at zero, in the large lines or in the total", () => {
    const large = largeAmounts([money("unpriced", null), money("zero", 0), money("big", 1000), money("small", 250)]);
    expect([...large.ids]).toEqual(["big"]);
    expect(large).toMatchObject({ covered_cents: 1000, total_cents: 1250, covered_percent: 80 });
  });

  it("finds no large line without a priced amount", () => {
    expect(largeAmounts([money("a", null), money("b", 0)])).toMatchObject({ covered_cents: 0, total_cents: 0, covered_percent: 0 });
    expect(largeAmounts([]).ids.size).toBe(0);
  });

  it("reads the cut exactly in integer cents, and floors the share it shows", () => {
    // 2 of 3 equal cents make 66,67 %: all three are needed, and 79,99 % is not 80 %.
    expect(largeAmounts([money("a", 1), money("b", 1), money("c", 1)]).ids.size).toBe(3);
    const large = largeAmounts([money("a", 7999), money("b", 2001)]);
    expect([...large.ids].sort()).toEqual(["a", "b"]);
    expect(largeAmounts([money("a", 8000), money("b", 1001), money("c", 999)])).toMatchObject({ covered_cents: 8000, covered_percent: 80 });
    expect(largeAmounts([money("a", 9_007_199_254_740), money("b", 9_007_199_254_740), money("c", 1)]))
      .toMatchObject({ covered_percent: 99 });
  });
});

function facts(id: string, overrides: Partial<TargetedReviewFacts> = {}): TargetedReviewFacts {
  return { id, blocked: false, rule_failed: false, uncertain: true, large: false, hypotheses: false, unpriced: false,
    network: null, location: null, plan: null, ...overrides };
}

const LINES = [
  facts("l1", { network: "EF", location: "RDC|Z1", plan: "A.pdf|B", large: true }),
  facts("l2", { network: "EF", location: "R+1|Z1", plan: "A.pdf|B", blocked: true, uncertain: false }),
  facts("l3", { network: "EU", location: "RDC|Z1", plan: "B.pdf|", large: true, hypotheses: true }),
  facts("l4", { network: "ECS", location: "RDC|Z2", unpriced: true, rule_failed: true }),
  facts("l5", { plan: "A.pdf|B", blocked: true, uncertain: false, rule_failed: true }),
];
const ALL = { large: true, unpriced: true, hypotheses: true } as const;
const filters = (overrides: Partial<TargetedReviewFilters>): TargetedReviewFilters => ({ ...EMPTY_TARGETED_REVIEW_FILTERS, ...overrides });
const visible = (current: TargetedReviewFilters, kept: string | null = null) =>
  filterTargetedReview(LINES, current, { available: ALL, kept }).visible;

describe("filterTargetedReview: OR within a kind, AND across kinds", () => {
  it("lists every line without a filter, in the review's order", () => {
    expect(visible(EMPTY_TARGETED_REVIEW_FILTERS)).toEqual(["l1", "l2", "l3", "l4", "l5"]);
  });

  it("widens with two values of one kind and narrows with each other kind", () => {
    expect(visible(filters({ network: ["EF", "EU"] }))).toEqual(["l1", "l2", "l3"]);
    expect(visible(filters({ network: ["EF", "EU"], location: ["RDC|Z1"] }))).toEqual(["l1", "l3"]);
    expect(visible(filters({ network: ["EF", "EU"], location: ["RDC|Z1", "R+1|Z1"] }))).toEqual(["l1", "l2", "l3"]);
    expect(visible(filters({ network: ["EF", "EU"], location: ["RDC|Z1"], plan: ["A.pdf|B"] }))).toEqual(["l1"]);
    expect(visible(filters({ network: ["EF", "EU"], large: true }))).toEqual(["l1", "l3"]);
    expect(visible(filters({ view: "blocked", network: ["EF"] }))).toEqual(["l2"]);
    expect(visible(filters({ view: "rule_failed", unpriced: true }))).toEqual(["l4"]);
    expect(visible(filters({ hypotheses: true, large: true }))).toEqual(["l3"]);
    expect(visible(filters({ large: true, unpriced: true }))).toEqual([]);
    // A line without a value of a kind is never one of its values.
    expect(visible(filters({ location: ["RDC|Z1", "R+1|Z1", "RDC|Z2"] }))).toEqual(["l1", "l2", "l3", "l4"]);
  });

  it("counts each choice with the other kinds' filters, never its own", () => {
    const result = filterTargetedReview(LINES, filters({ network: ["EF"], large: true }), { available: ALL, kept: null });
    expect(result.visible).toEqual(["l1"]);
    // The network's values, read with « gros montants » only: EF 1 (l1), EU 1 (l3), ECS 0.
    expect(result.counts.facets.network).toEqual([{ value: "ECS", count: 0 }, { value: "EF", count: 1 }, { value: "EU", count: 1 }]);
    // « Gros montants », read with EF only: l1 of l1 and l2.
    expect(result.counts.large).toBe(1);
    expect(result.counts.unpriced).toBe(0);
    expect(result.counts.view).toEqual({ all: 1, blocked: 0, rule_failed: 0, uncertain: 1 });
    // Without « gros montants », l2 counts too.
    expect(filterTargetedReview(LINES, filters({ network: ["EF"] }), { available: ALL, kept: null }).counts.view)
      .toEqual({ all: 2, blocked: 1, rule_failed: 0, uncertain: 1 });
    expect(result.counts.facets.location).toEqual([{ value: "R+1|Z1", count: 0 }, { value: "RDC|Z1", count: 1 }, { value: "RDC|Z2", count: 0 }]);
  });

  it("offers only the values the lines hold, and a value still chosen once its lines are gone", () => {
    const result = filterTargetedReview(LINES, filters({ plan: ["C.pdf|A"] }), { available: ALL, kept: null });
    expect(result.counts.facets.plan).toEqual([{ value: "A.pdf|B", count: 3 }, { value: "B.pdf|", count: 1 }, { value: "C.pdf|A", count: 0 }]);
    expect(result.visible).toEqual([]);
    expect(filterTargetedReview([facts("x")], EMPTY_TARGETED_REVIEW_FILTERS, { available: ALL, kept: null }).counts.facets)
      .toEqual({ network: [], location: [], plan: [] });
  });

  it("ignores a filter whose data the job does not hold, and says so", () => {
    const result = filterTargetedReview(LINES, filters({ large: true, unpriced: true, network: ["EU"] }),
      { available: { large: false, unpriced: false, hypotheses: true }, kept: null });
    expect(result.visible).toEqual(["l3"]);
    expect(result.ignored).toEqual(["large", "unpriced"]);
    // A kind no line holds (no level nor zone anywhere): its values from the address are ignored, not an empty list.
    const unplaced = LINES.map((line) => ({ ...line, location: null }));
    const kind = filterTargetedReview(unplaced, filters({ location: ["RDC|Z1"], network: ["EF"] }), { available: ALL, kept: null });
    expect(kind).toMatchObject({ visible: ["l1", "l2"], ignored: ["location"] });
    expect(kind.counts.facets.location).toEqual([]);
  });

  it("keeps the line being edited when the filters drop it, in its place, and names it", () => {
    const result = filterTargetedReview(LINES, filters({ network: ["EU"] }), { available: ALL, kept: "l1" });
    expect(result.visible).toEqual(["l1", "l3"]);
    expect(result.kept).toBe("l1");
    // A line the filters list anyway is no exception; a line the review no longer lists is not brought back.
    expect(filterTargetedReview(LINES, filters({ network: ["EU"] }), { available: ALL, kept: "l3" }).kept).toBeNull();
    expect(filterTargetedReview(LINES, filters({ network: ["EU"] }), { available: ALL, kept: "gone" }))
      .toMatchObject({ visible: ["l3"], kept: null });
    // Counts are the filters' own: the kept line is not one of their lines.
    expect(filterTargetedReview(LINES, filters({ network: ["EU"] }), { available: ALL, kept: "l1" }).counts.view.all).toBe(1);
  });
});

describe("the filters in the address", () => {
  const chosen = filters({ view: "blocked", large: true, hypotheses: true, unpriced: true, network: ["EU", "lot:5c6f1a8e-1111-4111-8111-111111111111"],
    location: ["R+1|Z2", "|Z1"], plan: ["Plan R+1 Z2.pdf|B", "Plan & coupe ?.pdf|"] });

  it("survives a reload: written to the address, read back the same, the other parameters kept", () => {
    const written = writeTargetedReviewFilters(new URLSearchParams("versionId=v1&line=l1"), chosen);
    const reloaded = new URLSearchParams(`?${written.toString()}`);
    expect(reloaded.get("versionId")).toBe("v1");
    expect(reloaded.get("line")).toBe("l1");
    const sorted = (list: readonly string[]) => [...list].sort((left, right) => left.localeCompare(right, "fr", { numeric: true }));
    expect(readTargetedReviewFilters(reloaded)).toEqual({ ...chosen, network: sorted(chosen.network),
      location: sorted(chosen.location), plan: sorted(chosen.plan) });
    // The same filters, chosen in another order, write the same address: a shared link is the same view.
    const again = writeTargetedReviewFilters(new URLSearchParams("versionId=v1&line=l1"),
      { ...chosen, network: [...chosen.network].reverse(), plan: [...chosen.plan].reverse() });
    expect(again.toString()).toBe(written.toString());
  });

  it("writes nothing for no filter, and clears the filters an earlier address held", () => {
    expect(writeTargetedReviewFilters(new URLSearchParams("versionId=v1&view=blocked&large=1&network=EF&plan=A"), EMPTY_TARGETED_REVIEW_FILTERS)
      .toString()).toBe("versionId=v1");
    expect(readTargetedReviewFilters(new URLSearchParams("versionId=v1"))).toEqual(EMPTY_TARGETED_REVIEW_FILTERS);
  });

  it("reads an edited address safely: unknown view, other flag values, duplicates and blanks", () => {
    expect(readTargetedReviewFilters(new URLSearchParams("view=all-lines&large=yes&unpriced=1&network=EF&network=EF&network=&network=%20EU%20")))
      .toEqual(filters({ unpriced: true, network: ["EF", "EU"] }));
    expect(readTargetedReviewFilters(new URLSearchParams(`plan=${"x".repeat(400)}`)).plan).toEqual(["x".repeat(400)]);
    expect(readTargetedReviewFilters(new URLSearchParams(`network=${"x".repeat(600)}`)).network).toEqual([]);
    expect(readTargetedReviewFilters(new URLSearchParams(Array.from({ length: 80 }, (_, index) => `plan=${index}`).join("&"))).plan).toHaveLength(50);
  });
});

const ITEM = {
  id: "i1", designation: "EF cuivre DN 22", quantity: 2.5, unit: "ml", source_file_name: "Plan R+1.pdf", source_page: 2,
  is_excluded: false, metadata: {} as Record<string, unknown>,
};
const ruleInputs = (network: string) => ({ rule_inputs: { version: 2, source: "designation", kind: "network", network, material: "cuivre",
  dn: "DN 22", non_observable: null, model_quantity: 2.5 } });
const triage = (pages: Array<{ page: number; level: string | null; zone: string | null }>) => ({ pages: pages.map((entry) => ({ ...entry,
  request_fingerprint: null, type: "reseau", confidence: 0.9, proposal: "keep", status: "proposed", reason: null })) });

describe("what each line holds for the filters", () => {
  const LOT = { id: "lot-1", title: "Plomberie" };

  it("reads the network class, else the lot of its priced line", () => {
    expect(targetedReviewLineValues({ ...ITEM, metadata: ruleInputs("EF") }, { sources: [], lot: LOT }).network).toBe("EF");
    expect(targetedReviewLineValues(ITEM, { sources: [], lot: LOT }).network).toBe("lot:lot-1");
    expect(targetedReviewLineValues(ITEM, { sources: [], lot: null }).network).toBeNull();
  });

  it("reads the page's level and zone from the triage, else the line's own location", () => {
    const sources = [{ document_name: "Plan R+1.pdf", revision: "C", page_triage: triage([{ page: 1, level: "RDC", zone: null }, { page: 2, level: "R+1", zone: "Z2" }]) }];
    expect(targetedReviewLineValues(ITEM, { sources, lot: null })).toMatchObject({ location: "R+1|Z2", plan: "Plan R+1.pdf|C" });
    // « inconnu » is no level: the line's own location (its file name) answers.
    const unknown = [{ document_name: "Plan R+1.pdf", revision: null, page_triage: triage([{ page: 2, level: "inconnu", zone: null }]) }];
    expect(targetedReviewLineValues(ITEM, { sources: unknown, lot: null })).toMatchObject({ location: "R+1|", plan: "Plan R+1.pdf|" });
    expect(targetedReviewLineValues({ ...ITEM, source_file_name: "plan.pdf", designation: "Tube" }, { sources: [], lot: null }))
      .toMatchObject({ location: null, plan: "plan.pdf|" });
    expect(targetedReviewLineValues({ ...ITEM, source_file_name: null, designation: "Tube" }, { sources: [], lot: null }))
      .toMatchObject({ location: null, plan: null });
  });
});

describe("takeoffPricingIndex: the line's amount and whether it is priced", () => {
  const items = [
    { ...ITEM, id: "priced", quantity: 2.5 },
    { ...ITEM, id: "unlinked", quantity: 4 },
    { ...ITEM, id: "not-priced", quantity: 1 },
    { ...ITEM, id: "included", quantity: 1 },
    { ...ITEM, id: "excluded", quantity: 9, is_excluded: true },
  ];
  const context = {
    unlinked_item_ids: ["unlinked"],
    item_pricing: [
      { item_id: "priced", line_id: "l1", pricing_status: "priced", unit_price_cents: 1999, lot: null },
      { item_id: "not-priced", line_id: "l2", pricing_status: "not_priced", unit_price_cents: null, lot: null },
      { item_id: "included", line_id: "l3", pricing_status: "included", unit_price_cents: null, lot: null },
    ],
  };

  it("prices quantity × unit price in cents and tells the unpriced lines apart", () => {
    const index = takeoffPricingIndex(context, items);
    expect(index.available).toBe(true);
    // 2,5 × 19,99 € = 49,975 €: 4 998 cents, half away from zero.
    expect(index.amounts.get("priced")).toBe(4998);
    expect([...index.unpriced].sort()).toEqual(["not-priced", "unlinked"]);
    // A line « Inclus » has no price by choice: neither unpriced nor a large amount. An excluded line is not priced.
    expect(index.amounts.get("included") ?? null).toBeNull();
    expect(index.unpriced.has("excluded")).toBe(false);
    expect([...index.large.ids]).toEqual(["priced"]);
  });

  it("holds no pricing when the review context is unknown or says nothing of the lines", () => {
    expect(takeoffPricingIndex(null, items).available).toBe(false);
    expect(takeoffPricingIndex({ unlinked_item_ids: [], item_pricing: [] }, items).available).toBe(false);
  });
});
