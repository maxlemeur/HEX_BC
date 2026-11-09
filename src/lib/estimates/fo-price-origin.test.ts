import { describe, expect, it } from "vitest";
import { clearStaleFoPriceOrigin, readFoPriceOrigin, sameFoPriceSelection } from "./fo-price-origin";

const origin = { selection_id: "53400000-0000-4000-8000-000000000001", kind: "supplier", source_id: "53400000-0000-4000-8000-000000000002", transport_mode: "included" } as const;
const source = { unit_price_ht_cents: 10000, product_id: "product", selected_supplier_price_id: origin.source_id, fo_price_origin: origin };

describe("TI-534 retained price origin", () => {
  it("rejects incomplete or invalid origin metadata", () => {
    for (const value of [null, {}, { ...origin, transport_mode: "yes" }, { ...origin, selection_id: "arbitrary" }]) {
      expect(readFoPriceOrigin(value)).toBeNull();
    }
    expect(readFoPriceOrigin(origin)).toEqual(origin);
  });
  it("clears a retained transport when the price is edited manually even if the product remains", () => {
    expect(clearStaleFoPriceOrigin(source, { ...source, unit_price_ht_cents: 20000 }).fo_price_origin).toBeNull();
    expect(clearStaleFoPriceOrigin(source, { ...source, selected_supplier_price_id: null }).fo_price_origin).toBeNull();
    expect(clearStaleFoPriceOrigin(source, { ...source, fo_price_origin: null }).fo_price_origin).toBeNull();
  });
  it("keeps a deliberately refreshed offer even when its identifiers are unchanged", () => {
    const refreshed = { ...source, unit_price_ht_cents: 20000, fo_price_origin: { ...origin, selection_id: "53400000-0000-4000-8000-000000000003" } };
    expect(sameFoPriceSelection(source, refreshed)).toBe(false);
    expect(clearStaleFoPriceOrigin(source, refreshed)).toEqual(refreshed);
  });
  it("keeps the saved origin through quantity and unrelated edits", () => {
    const edited = { ...source, quantity: 10, k_fo: 0.9 };
    expect(clearStaleFoPriceOrigin(source, edited)).toBe(edited);
  });
});
