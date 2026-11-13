import { describe, expect, it } from "vitest";

import { parseCurrencyToCents, roundHalfAwayFromZero } from "@/lib/money";

describe("money helpers", () => {

  it("parses USD and GBP dot-decimal formats with code/symbol", () => {
    expect(parseCurrencyToCents("$1,234.56", "USD")).toBe(123_456);
    expect(parseCurrencyToCents("USD 1234.56", "USD")).toBe(123_456);
    expect(parseCurrencyToCents("£1,234.56", "GBP")).toBe(123_456);
    expect(parseCurrencyToCents("GBP 1234.56", "GBP")).toBe(123_456);
  });

  it("rejects EUR-like comma decimals for USD/GBP", () => {
    expect(parseCurrencyToCents("1234,56", "USD")).toBeNull();
    expect(parseCurrencyToCents("1234,56", "GBP")).toBeNull();
  });
});

/**
 * TI-691, delivery 3a: the cents of a price given for a lot. Failure modes:
 *  1. 2,5 cents rounds to 2 (half to even, Math.round on negatives) instead of 3, as PostgreSQL numeric round() does;
 *  2. a negative amount (a discount) rounds towards zero, or differently from its positive twin;
 *  3. a large amount loses precision through floating point.
 */
describe("half away from zero", () => {
  it("1 rounds halves away from zero and the rest to the nearest cent", () => {
    expect(roundHalfAwayFromZero(BigInt(5), BigInt(2))).toBe(BigInt(3));
    expect(roundHalfAwayFromZero(BigInt(4), BigInt(2))).toBe(BigInt(2));
    expect(roundHalfAwayFromZero(BigInt(1), BigInt(3))).toBe(BigInt(0));
    expect(roundHalfAwayFromZero(BigInt(2), BigInt(3))).toBe(BigInt(1));
    // 1 500 screws at 3,40 € per 100, in milliunits: 1 500 000 x 340 / 100 000.
    expect(roundHalfAwayFromZero(BigInt(1_500_000 * 340), BigInt(100_000))).toBe(BigInt(5100));
  });

  it("2 rounds a negative amount as its positive twin, negated", () => {
    expect(roundHalfAwayFromZero(BigInt(-5), BigInt(2))).toBe(BigInt(-3));
    expect(roundHalfAwayFromZero(BigInt(-5), BigInt(10))).toBe(BigInt(-1));
    expect(roundHalfAwayFromZero(BigInt(-4), BigInt(10))).toBe(BigInt(0));
  });

  it("3 stays exact beyond the safe integers and refuses a divisor that is not positive", () => {
    expect(roundHalfAwayFromZero(BigInt("4611686014132420609500"), BigInt(1000))).toBe(BigInt("4611686014132420610"));
    expect(() => roundHalfAwayFromZero(BigInt(1), BigInt(0))).toThrow(RangeError);
  });
});
