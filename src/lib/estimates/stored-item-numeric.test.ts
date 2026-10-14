import { describe, expect, it } from "vitest";

import { multiplyToStoredEstimateNumeric, normalizeStoredItemNumerics, toStoredEstimateNumeric } from "./stored-item-numeric";

describe("estimate numeric storage parity", () => {
  it.each([
    [1.005, 0.1, 3, 0.101],
    [-1.005, 0.1, 3, -0.101],
    [-1.005, -0.1, 3, 0.101],
    [5e-5, 10, 3, 0.001],
    [5e-5, 1, 4, 0.0001],
    [999999999.999, 1, 3, 999999999.999],
    [1e-100, 1e-100, 3, 0],
  ] as const)("multiplies JSON decimals %s × %s at scale %s to %s", (left, right, scale, expected) => {
    expect(multiplyToStoredEstimateNumeric(left, right, scale)).toBe(expected);
  });

  it.each([
    [999999999.999, 2],
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    [0, Number.NEGATIVE_INFINITY],
  ])("rejects an unrepresentable decimal product %s × %s", (left, right) => {
    expect(() => multiplyToStoredEstimateNumeric(left, right, 3)).toThrow();
  });

  it.each([
    [1.0005, 3, 1.001],
    [-1.0005, 3, -1.001],
    [1.00005, 4, 1.0001],
    [0.0005, 3, 0.001],
    [5e-5, 4, 0.0001],
    [4.999e-7, 3, 0],
    [-4.999e-7, 3, 0],
    [999999999.9994, 3, 999999999.999],
    [99999999.99994, 4, 99999999.9999],
  ] as const)("coerces %s at scale %s to %s", (value, scale, expected) => {
    expect(toStoredEstimateNumeric(value, scale)).toBe(expected);
  });

  it.each([
    [999999999.9995, 3],
    [-999999999.9995, 3],
    [99999999.99995, 4],
    [1e21, 3],
    [Number.NaN, 3],
    [Number.POSITIVE_INFINITY, 3],
  ] as const)("rejects unrepresentable %s at scale %s", (value, scale) => {
    expect(() => toStoredEstimateNumeric(value, scale)).toThrow();
  });

  it("normalizes every stored decimal without changing null or unrelated values", () => {
    expect(normalizeStoredItemNumerics({
      quantity: 1.0005, k_fo: 1.0005, h_mo: 1.0005, k_mo: 1.0005,
      h_mo_atelier: 1.0005, k_mo_atelier: 1.0005,
      h_mo_chantier: 1.0005, k_mo_chantier: 1.0005,
      h_mo_majoration: 1.00005, unit_price_ht_cents: 100000,
    })).toEqual({
      quantity: 1.001, k_fo: 1.001, h_mo: 1.001, k_mo: 1.001,
      h_mo_atelier: 1.001, k_mo_atelier: 1.001,
      h_mo_chantier: 1.001, k_mo_chantier: 1.001,
      h_mo_majoration: 1.0001, unit_price_ht_cents: 100000,
    });
    expect(normalizeStoredItemNumerics({ h_mo_atelier: null, title: "Ligne" }))
      .toEqual({ h_mo_atelier: null, title: "Ligne" });
  });
});
