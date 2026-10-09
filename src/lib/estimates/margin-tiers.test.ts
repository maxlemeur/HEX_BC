import { describe, expect, it } from "vitest";

import {
  getMarginTiers,
  resolveMarginMultiplier,
  type MarginTier,
} from "@/lib/estimates/margin-tiers";

describe("resolveMarginMultiplier", () => {
  it("falls back to default tiers when tiers array is empty", () => {
    const result = resolveMarginMultiplier(5_000_00, []);
    const defaults = getMarginTiers();
    const expected = resolveMarginMultiplier(5_000_00, defaults);
    expect(result).toBe(expected);
  });

  it("returns tier of lower threshold when cost is between two thresholds", () => {
    const tiers: MarginTier[] = [
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 10_000_00, multiplier: 1.45, position: 1 },
      { threshold_cents: 100_000_00, multiplier: 1.3, position: 2 },
    ];
    expect(resolveMarginMultiplier(50_000_00, tiers)).toBe(1.45);
  });

  it("returns last tier when cost exceeds all thresholds", () => {
    const tiers: MarginTier[] = [
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 10_000_00, multiplier: 1.45, position: 1 },
    ];
    expect(resolveMarginMultiplier(999_999_99, tiers)).toBe(1.45);
  });

  it("sorts unsorted tiers before resolving", () => {
    const tiers: MarginTier[] = [
      { threshold_cents: 10_000_00, multiplier: 1.45, position: 1 },
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 100_000_00, multiplier: 1.3, position: 2 },
    ];
    expect(resolveMarginMultiplier(50_000_00, tiers)).toBe(1.45);
  });

  it("normalizes negative cost to 0", () => {
    const tiers: MarginTier[] = [
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 10_000_00, multiplier: 1.45, position: 1 },
    ];
    expect(resolveMarginMultiplier(-5000, tiers)).toBe(1.6);
  });

  it("normalizes NaN cost to 0", () => {
    const tiers: MarginTier[] = [
      { threshold_cents: 0, multiplier: 1.6, position: 0 },
      { threshold_cents: 10_000_00, multiplier: 1.45, position: 1 },
    ];
    expect(resolveMarginMultiplier(NaN, tiers)).toBe(1.6);
  });
});
