import { describe, expect, it } from "vitest";

import {
  isRecord,
  parseNullableNumericValue,
  toFiniteNumber,
  toNonEmptyString,
  toNullableFiniteNumber,
} from "@/lib/estimates/editor-values";

describe("estimate editor value normalization", () => {
  it("accepts records and rejects arrays and null", () => {
    expect(isRecord({ value: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("value")).toBe(false);
  });

  it("normalizes non-empty strings", () => {
    expect(toNonEmptyString("  value  ")).toBe("value");
    expect(toNonEmptyString("   ")).toBeNull();
    expect(toNonEmptyString(42)).toBeNull();
  });

  it("normalizes finite numbers without accepting invalid values", () => {
    expect(toFiniteNumber(12.5, 0)).toBe(12.5);
    expect(toFiniteNumber(Number.NaN, 3)).toBe(3);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY, 3)).toBe(3);
    expect(toFiniteNumber("12", 3)).toBe(3);
    expect(toNullableFiniteNumber("12.5")).toBe(12.5);
    expect(toNullableFiniteNumber(0)).toBe(0);
    expect(toNullableFiniteNumber("")).toBe(0);
    expect(toNullableFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(toNullableFiniteNumber("not-a-number")).toBeNull();
  });

  it("parses localized nullable numeric values", () => {
    expect(parseNullableNumericValue("12,5")).toBe(12.5);
    expect(parseNullableNumericValue("12,5 kg")).toBe(12.5);
    expect(parseNullableNumericValue(7.25)).toBe(7.25);
    expect(parseNullableNumericValue("  ")).toBeNull();
    expect(parseNullableNumericValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseNullableNumericValue("invalid")).toBeNull();
  });
});
