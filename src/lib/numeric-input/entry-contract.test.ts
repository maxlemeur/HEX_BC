import { describe, expect, it } from "vitest";

import { parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import { normalizeMappedRowsForEstimateCreation, parseLocalizedNumber } from "@/lib/affaires/import-flow";
import { parseClipboardNumber } from "@/lib/estimates/clipboard";
import { parseNullableNumberInput, parseNumberInput } from "@/lib/estimates/editor-values";
import { parseCurrencyToCents } from "@/lib/money";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input/parsers";

// Parser edge cases absent from the finite UI journey; rationale precedes this
// regression in docs/testing/tech-debt-numeric-entry.md.
const quantityParsers = {
  settings: parseLocalizedNumberInput,
  grid: parseNullableNumberInput,
  import: parseLocalizedNumber,
  clipboard: (value: string) => parseClipboardNumber(value, "quantity"),
};

describe("numeric entry contract across entry paths", () => {
  it.each([0.001, 1.234, 1e-7, 1e21])("keeps native %s editable without ambiguous text", (value) => {
    expect(parseDecimalInput(formatDecimalInput(value))).toBe(value);
  });
  for (const [entry, parse] of Object.entries(quantityParsers)) {
    it(`${entry}: preserves decimal comma and valid grouping`, () => {
      for (const text of ["1 234,56", "1\u00a0234,56", "1\u202f234,56", "1'234,56", "1.234,56", "1,234.56"]) {
        expect(parse(text), text).toBe(1234.56);
      }
      expect(parse("1,234")).toBe(1.234);
      expect(parse("0")).toBe(0);
      expect(parse("")).toBeNull();
    });

    it(`${entry}: refuses partial, ambiguous and malformed numbers`, () => {
      for (const text of ["12abc", "abc12", "12 m2", "12 34", "1.2.3", "1,2,3", "1.250", "1,23.45", "1e3", "Infinity", "--12"]) {
        expect(parse(text), text).toBeNull();
      }
    });
  }

  it("never turns invalid grid text into zero", () => {
    expect(parseNumberInput("12abc")).toBeNull();
    expect(parseNumberInput("abc")).toBeNull();
    expect(parseNumberInput("")).toBe(0);
  });

  it("does not infer thousands from three decimal money digits", () => {
    expect(parseClipboardNumber("1,234", "money")).toBeNull();
    expect(parseClipboardNumber("2,500", "money")).toBe(2.5);
    expect(parseClipboardNumber("1.250", "money")).toBeNull();
    expect(parseCurrencyToCents("1.250", "EUR")).toBeNull();
    expect(parseCurrencyToCents("2,500", "EUR")).toBe(250);
  });

  it("retains native table numbers without localized text heuristics", () => {
    expect(parseLocalizedNumber(1.234)).toBe(1.234);
    expect(parseClipboardNumber(1.234, "quantity")).toBe(1.234);
  });

  it.each(["k_fo", "k_mo", "labor_hours", "h_mo_majoration", "tax_rate_bp"])("rejects an invalid imported %s instead of its default", (field) => {
    const result = normalizeMappedRowsForEstimateCreation([{ id: "invalid", payload: { mapped_row: {
      designation: "Numeric witness", quantity: "1", unit_price_ht: "10", [field]: "12abc",
    } } }], { marginMultiplier: 1, defaultTaxRateBp: 2000 });
    expect(result.validLines).toHaveLength(0);
    expect(result.invalidLines).toHaveLength(1);
  });
});
