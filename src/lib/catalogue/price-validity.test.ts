import { describe, expect, it } from "vitest";
import { maxPriceValidTo, resolvePriceValidity } from "@/lib/catalogue/price-validity";
import { pricesActionSchema } from "@/lib/catalogue/schemas";

describe("supplier price validity", () => {
  it.each([
    ["2026-09-06", "2027-03-06"],
    ["2026-08-31", "2027-02-28"],
    ["2023-08-31", "2024-02-29"],
    ["2024-02-29", "2024-08-29"],
  ])("caps %s at %s", (start, end) => {
    expect(maxPriceValidTo(start)).toBe(end);
    expect(resolvePriceValidity(start, null)).toEqual({ valid_from: start, valid_to: end });
  });

  it("preserves shorter validity and rejects dates outside the window", () => {
    expect(resolvePriceValidity("2026-09-06", "2026-09-06").valid_to).toBe("2026-09-06");
    expect(() => resolvePriceValidity("2026-09-06", "2027-03-07")).toThrow("six mois");
    expect(() => resolvePriceValidity("2026-09-06", "2026-09-05")).toThrow("six mois");
    expect(() => resolvePriceValidity("2026-02-30")).toThrow("invalide");
  });

  it.each(["create", "bulk-create", "bulk-create-atomic"])("rejects excessive validity in %s", (action) => {
    const item = {
      supplier_id: "22222222-2222-4222-8222-222222222222",
      product_id: "33333333-3333-4333-8333-333333333333",
      unit_price_cents: 100, valid_from: "2026-09-06", valid_to: "2027-03-07",
    };
    expect(pricesActionSchema.safeParse(action === "create" ? { action, item } : { action, items: [item] }).success).toBe(false);
  });
});
