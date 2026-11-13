import { describe, expect, it } from "vitest";
import { buildFinancialReviewPosts, buildTakeoffItemPricing, engineTwoUnitPrice } from "@/lib/takeoff/financial-review";

describe("TI-681 financial review across priced lots", () => {
  it("uses the post's own lot and includes priced manual lines without a DPGF", () => {
    const items = [
      { id: "lot1", parent_id: null, item_type: "section", title: "Lot 1", quantity: null, pricing_status: null },
      { id: "lot2", parent_id: null, item_type: "section", title: "Lot 2", quantity: null, pricing_status: null },
      { id: "post", parent_id: "lot1", item_type: "line", title: "Tube manuel", quantity: 20, pricing_status: "priced" },
      { id: "rest", parent_id: "lot1", item_type: "line", title: "Autres postes", quantity: 1, pricing_status: "priced" },
      { id: "other", parent_id: "lot2", item_type: "line", title: "Autre lot", quantity: 1, pricing_status: "priced" },
    ] as const;
    const result = buildFinancialReviewPosts(items, new Map([["post", 60_000], ["rest", 4_940_000], ["other", 45_000_000]]), []);
    expect(result.find(post => post.line_id === "post")).toMatchObject({ amount_cents: 60_000, lot_amount_cents: 5_000_000, recommend_review: true });
  });
  it("keeps an unpriced post unknown and an unattached post's impact unknown", () => {
    const items = [{ id: "line", parent_id: null, item_type: "line", title: "À chiffrer", quantity: 10, pricing_status: "not_priced" }] as const;
    expect(buildFinancialReviewPosts(items, new Map([["line", 0]]), [])[0])
      .toMatchObject({ amount_cents: null, impact_cents: null, recommend_review: null });
  });
  it("values an alternative-reading gap once per group using the priced line", () => {
    const items = [{ id: "line", parent_id: null, item_type: "line", title: "EF cuivre", quantity: 5, pricing_status: "priced" }] as const;
    const gap = { group: "one-reading", vector: 5, model: 7, delta: -2, unit: "ml" };
    const result = buildFinancialReviewPosts(items, new Map([["line", 5000]]),
      [{ line_id: "line", item_ids: ["v1", "v2"], delta_absolute: 0 }], new Map([["v1", gap], ["v2", gap]]));
    expect(result[0].impact_cents).toBe(2000);
  });
});

// TI-701 (D13), the unit price each takeoff line is priced at for « Gros montants » and « Non chiffré ». Ways it
// fails: a line linked twice takes the unpriced estimate line over the priced one, or the last link read; a line
// « Non chiffrée » passes its engine's zero for a unit price; the lot is a sub-section, or another lot's.
describe("TI-701 takeoff line pricing", () => {
  const items = [
    { id: "lot", parent_id: null, item_type: "section", title: "Plomberie", quantity: null, pricing_status: null },
    { id: "sub", parent_id: "lot", item_type: "section", title: "Réseaux", quantity: null, pricing_status: null },
    { id: "priced", parent_id: "sub", item_type: "line", title: "EF cuivre", quantity: 10, pricing_status: "priced" },
    { id: "todo", parent_id: "sub", item_type: "line", title: "EF à chiffrer", quantity: 3, pricing_status: "not_priced" },
    { id: "legacy", parent_id: null, item_type: "line", title: "Ligne v2", quantity: 2, pricing_status: null },
    { id: "included", parent_id: "lot", item_type: "line", title: "Inclus", quantity: 1, pricing_status: "included" },
  ] as const;
  const prices = new Map<string, number | null>([["priced", 1250], ["todo", 0], ["legacy", 800], ["included", 0]]);

  it("prices each linked line at its estimate line's unit price, with the line's lot", () => {
    const pricing = buildTakeoffItemPricing(items, prices, [
      { line_id: "todo", item_ids: ["a", "b"], delta_absolute: null },
      { line_id: "priced", item_ids: ["a"], delta_absolute: null },
      { line_id: "legacy", item_ids: ["c"], delta_absolute: null },
      { line_id: "included", item_ids: ["d"], delta_absolute: null },
    ]);
    expect(pricing).toEqual([
      { item_id: "a", line_id: "priced", pricing_status: "priced", unit_price_cents: 1250, lot: { id: "lot", title: "Plomberie" } },
      { item_id: "b", line_id: "todo", pricing_status: "not_priced", unit_price_cents: null, lot: { id: "lot", title: "Plomberie" } },
      { item_id: "c", line_id: "legacy", pricing_status: null, unit_price_cents: 800, lot: null },
      { item_id: "d", line_id: "included", pricing_status: "included", unit_price_cents: null, lot: { id: "lot", title: "Plomberie" } },
    ]);
  });

  it("keeps the first priced link of a line linked twice, and skips a link to anything but a line", () => {
    const pricing = buildTakeoffItemPricing(items, prices, [
      { line_id: "priced", item_ids: ["a"], delta_absolute: null },
      { line_id: "legacy", item_ids: ["a"], delta_absolute: null },
      { line_id: "lot", item_ids: ["e"], delta_absolute: null },
      { line_id: "missing", item_ids: ["f"], delta_absolute: null },
    ]);
    expect(pricing).toEqual([{ item_id: "a", line_id: "priced", pricing_status: "priced", unit_price_cents: 1250,
      lot: { id: "lot", title: "Plomberie" } }]);
  });

  // Review of TI-701: the best link did depend on the order of the links, and a zero price hid a real one.
  it("keeps a line's best link whatever their order: a price, a price left out on purpose, a zero price, none", () => {
    const more = [...items, { id: "zero", parent_id: null, item_type: "line", title: "Gratuit", quantity: 1, pricing_status: "priced" },
      { id: "discount", parent_id: null, item_type: "line", title: "Remise", quantity: 1, pricing_status: "priced" }] as const;
    const withZero = new Map([...prices, ["zero", 0], ["discount", -500]]);
    const best = (lines: string[]) => buildTakeoffItemPricing(more, withZero, lines.map(line_id => ({ line_id, item_ids: ["a"], delta_absolute: null })))[0];
    for (const order of [["todo", "included"], ["included", "todo"]]) expect(best(order)).toMatchObject({ line_id: "included", unit_price_cents: null });
    for (const order of [["zero", "priced"], ["priced", "zero"]]) expect(best(order)).toMatchObject({ line_id: "priced", unit_price_cents: 1250 });
    for (const order of [["todo", "zero"], ["zero", "todo"]]) expect(best(order)).toMatchObject({ line_id: "zero", unit_price_cents: 0 });
    // A price below zero (a discount line) is a price: it ranks with zero, never with « Non chiffrée ».
    for (const order of [["todo", "discount"], ["discount", "todo"]]) expect(best(order)).toMatchObject({ line_id: "discount" });
    for (const order of [["discount", "priced"], ["priced", "discount"]]) expect(best(order)).toMatchObject({ line_id: "priced" });
  });

  // Review of TI-701: engine 2 reads every line « Chiffrée » (the column defaults to it) and gives 0 as the unit price
  // of a line without quantity, which read as a free line: neither large nor unpriced.
  it("gives an engine 2 line without quantity no unit price", () => {
    expect(engineTwoUnitPrice(3, 1250)).toBe(1250);
    expect(engineTwoUnitPrice(0, 0)).toBeNull();
    expect(engineTwoUnitPrice(null, 0)).toBeNull();
    const legacy = [{ id: "legacy0", parent_id: null, item_type: "line", title: "Ligne v2 sans quantité", quantity: 0, pricing_status: "priced" }] as const;
    expect(buildTakeoffItemPricing(legacy, new Map([["legacy0", engineTwoUnitPrice(0, 0)]]),
      [{ line_id: "legacy0", item_ids: ["a"], delta_absolute: null }])[0]).toMatchObject({ pricing_status: "priced", unit_price_cents: null });
  });
});
