import { describe, expect, it } from "vitest";
import { dpgfReviewQuantitySnapshot, sameQuantitySnapshot } from "@/lib/takeoff/dpgf-review-quantity";

describe("TI-680 decision freshness", () => {
  const source = { item_id: "one", designation: "EF cuivre DN 22", unit: "ml", quantity: 3060,
    source_file_name: "fictif-ind-B.pdf", source_page: 1, metadata: {} };
  it("invalidates a review when the quantity, diameter or source index changes", () => {
    const row = { dpgf_quantity: 3000, dpgf: { unit: "ml" }, linked_takeoff_items: [source] };
    const snapshot = dpgfReviewQuantitySnapshot(row);
    expect(sameQuantitySnapshot(snapshot, dpgfReviewQuantitySnapshot(row))).toBe(true);
    for (const patch of [{ quantity: 6000 }, { designation: "EF cuivre DN 28" }, { source_file_name: "fictif-ind-C.pdf" }]) {
      expect(sameQuantitySnapshot(snapshot, dpgfReviewQuantitySnapshot({ ...row, linked_takeoff_items: [{ ...source, ...patch }] }))).toBe(false);
    }
  });
});
