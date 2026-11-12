import { describe, expect, it } from "vitest";

import {
  assemblyTargetPriceCents,
  formatAssemblyTargetPrice,
} from "@/lib/estimates/assembly-target-price";
import { formatEUR } from "@/lib/money";

// A library ouvrage stores indicative_target_price_cents as `not null default 0`: an ouvrage built
// by hand keeps that 0, which is not a price. Only the review of a generated ouvrage computes one
// (direct cost × margin), so its 0 is a real 0 € target price.
describe("assemblyTargetPriceCents", () => {
  it("reads no target price on a hand-made ouvrage, whatever its direct cost", () => {
    const handMade = { pricing_source: "manual", indicative_target_price_cents: 0, ds_cents: 13800 };
    expect(assemblyTargetPriceCents(handMade)).toBeNull();
  });

  it("reads no target price on an ouvrage without a pricing source", () => {
    expect(assemblyTargetPriceCents({ pricing_source: null, indicative_target_price_cents: 0 })).toBeNull();
    expect(assemblyTargetPriceCents({ indicative_target_price_cents: 0 })).toBeNull();
  });

  it("keeps the 0 € a generated ouvrage computed from a zero direct cost", () => {
    const generated = { pricing_source: "generated_ouvrage_review", indicative_target_price_cents: 0, ds_cents: 0 };
    expect(assemblyTargetPriceCents(generated)).toBe(0);
  });

  it("keeps a positive target price from any source", () => {
    expect(assemblyTargetPriceCents({ pricing_source: "generated_ouvrage_review", indicative_target_price_cents: 16560 })).toBe(16560);
    expect(assemblyTargetPriceCents({ pricing_source: "manual", indicative_target_price_cents: 4200 })).toBe(4200);
  });

  it("reads no target price when the value is absent or not a whole number of cents", () => {
    expect(assemblyTargetPriceCents({ pricing_source: "generated_ouvrage_review" })).toBeNull();
    expect(assemblyTargetPriceCents({ pricing_source: "generated_ouvrage_review", indicative_target_price_cents: null })).toBeNull();
    expect(assemblyTargetPriceCents({ pricing_source: "generated_ouvrage_review", indicative_target_price_cents: "abc" })).toBeNull();
    expect(assemblyTargetPriceCents({ pricing_source: "generated_ouvrage_review", indicative_target_price_cents: 12.5 })).toBeNull();
  });
});

describe("formatAssemblyTargetPrice", () => {
  it("says « sans prix cible » instead of 0,00 € when the ouvrage has no target price", () => {
    expect(formatAssemblyTargetPrice(null)).toBe("sans prix cible");
    expect(formatAssemblyTargetPrice(undefined)).toBe("sans prix cible");
  });

  it("still prints a real 0 € target price and a positive one as amounts", () => {
    expect(formatAssemblyTargetPrice(0)).toBe(formatEUR(0));
    expect(formatAssemblyTargetPrice(0)).toMatch(/^0,00\s€$/u);
    expect(formatAssemblyTargetPrice(16560)).toBe(formatEUR(16560));
  });
});
