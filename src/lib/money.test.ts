import { describe, expect, it } from "vitest";

import { parseCurrencyToCents } from "@/lib/money";

describe("money helpers", () => {

  it("parses EUR formats with comma decimals and code/symbol", () => {
    expect(parseCurrencyToCents("1 234,56 €", "EUR")).toBe(123_456);
    expect(parseCurrencyToCents("EUR 1.234,56", "EUR")).toBe(123_456);
    expect(parseCurrencyToCents("1234,56", "EUR")).toBe(123_456);
  });

  it("keeps EUR precision strictly at the cent while accepting commas", () => {
    expect(parseCurrencyToCents("12,01", "EUR")).toBe(1201);
    expect(parseCurrencyToCents("12.01", "EUR")).toBe(1201);
    expect(parseCurrencyToCents("12,001", "EUR")).toBeNull();
  });

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
