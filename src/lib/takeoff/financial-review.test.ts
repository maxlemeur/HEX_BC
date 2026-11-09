import { describe, expect, it } from "vitest";
import { buildFinancialReviewPosts } from "@/lib/takeoff/financial-review";

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
