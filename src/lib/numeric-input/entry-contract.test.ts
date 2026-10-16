import { describe, expect, it } from "vitest";

import { parseMajorationPercentToCoefficient } from "@/components/estimates/components/estimate-editor-row/shared";
import { parseLocalizedNumberInput } from "@/components/ui-legacy/NumberInput";
import { normalizeMappedRowsForEstimateCreation, parseLocalizedNumber } from "@/lib/affaires/import-flow";
import {
  buildClipboardPreviewRows,
  parseClipboardNumber,
  parseTsvMatrix,
  suggestClipboardColumnMapping,
  type ClipboardPreviewValues,
} from "@/lib/estimates/clipboard";
import {
  parseCoefficientDraft,
  parseLineHoursDraft,
  parseNullableNumberInput,
  parseNumberInput,
  parseQuantityInput,
  parseRatePercentDraft,
} from "@/lib/estimates/editor-values";
import { majorationPercentToCoefficient } from "@/lib/estimates/majoration";
import { parseCurrencyToCents, parseEuroToCents } from "@/lib/money";
import {
  formatDecimalInput,
  parseAmountCents,
  parseCoefficient,
  parseDecimalInput,
  parseHoursPerUnit,
  parseMajorationPercent,
  parseQuantity,
  parseRateBp,
  parseStoredCoefficient,
} from "@/lib/numeric-input/parsers";

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

// Sub-lot 2.3 (A8, D11): one table read by the five entry points, then one table per quantity
// kind. Failure modes, the reconciled "empty" contract and the isolation rationale are in
// docs/testing/estimate-input-import-2.3.md; these cases were written red before 2.3.
type EntryParser = (text: string) => number | null;

const FIVE_ENTRY_POINTS: Record<string, EntryParser> = {
  "réglages (NumberInput)": parseLocalizedNumberInput,
  "grille (cellule décimale)": parseNullableNumberInput,
  "import (cellule texte)": parseLocalizedNumber,
  "collage (quantité)": (text) => parseClipboardNumber(text, "quantity"),
  "montants (money.ts)": (text) => {
    const cents = parseEuroToCents(text);
    return cents === null ? null : cents / 100;
  },
};

// `amount` overrides the expectation of money.ts, which refuses a third decimal and
// accepts a currency marker; every other entry point shares `value`.
const GRAMMAR_CASES: Array<{ text: string; value: number | null; amount?: number | null }> = [
  { text: "1 000", value: 1000 },
  { text: "1 250,50", value: 1250.5 },
  { text: "1\u00a0250,50", value: 1250.5 },
  { text: "1\u202f250,50", value: 1250.5 },
  { text: "1'250,50", value: 1250.5 },
  { text: "1’250,50", value: 1250.5 },
  { text: "1.250,50", value: 1250.5 },
  { text: "1,250.50", value: 1250.5 },
  { text: "1.234.567", value: 1234567 },
  { text: "12 345 678,9", value: 12345678.9 },
  { text: "1,875", value: 1.875, amount: null },
  { text: "0,001", value: 0.001, amount: null },
  { text: "1.5", value: 1.5 },
  { text: "1.25", value: 1.25 },
  { text: "+12,5", value: 12.5 },
  { text: "−12,5", value: -12.5 },
  { text: ",5", value: 0.5 },
  { text: "1.250", value: null },
  { text: "0.125", value: null },
  { text: "12abc", value: null },
  { text: "1.2.3", value: null },
  { text: "1,2,3", value: null },
  { text: "12 34", value: null },
  { text: "1 2345", value: null },
  { text: "1,23.45", value: null },
  { text: "12,", value: null },
  { text: "1e3", value: null },
  { text: "Infinity", value: null },
  { text: "--12", value: null },
  { text: "12 m2", value: null },
  // "%" belongs to rates and majorations only: « 12,5 % » → 1 250 pb is in the rate table below,
  // read by the settings and the import (2.3 review).
  { text: "12 %", value: null },
  { text: "1 000 €", value: null, amount: 1000 },
  { text: "1 000,5", value: 1000.5 },
  { text: "1 000 000,25", value: 1000000.25 },
  { text: "1'000'000", value: 1000000 },
  { text: "1 000.5", value: 1000.5 },
  { text: "12.50", value: 12.5 },
  { text: " 12,5 ", value: 12.5 },
  { text: "-0,5", value: -0.5 },
  { text: "12.", value: null },
  { text: "0x10", value: null },
  // Empty means "not provided": never 0 at an entry point. Field defaults stay in each field.
  { text: "", value: null },
  { text: "   ", value: null },
];

describe("2.3 grammar shared by the five entry points (D11)", () => {
  it.each(GRAMMAR_CASES.map((entry) => ({ ...entry, label: JSON.stringify(entry.text) })))(
    "$label reads the same at every entry point",
    ({ text, value, amount }) => {
      const actual = Object.fromEntries(
        Object.entries(FIVE_ENTRY_POINTS).map(([entry, parse]) => [entry, parse(text)]),
      );
      const expected = Object.fromEntries(
        Object.keys(FIVE_ENTRY_POINTS).map((entry) => [
          entry,
          entry === "montants (money.ts)" && amount !== undefined ? amount : value,
        ]),
      );
      expect(actual).toEqual(expected);
    },
  );
});

// D11 names one parser per quantity kind in parsers.ts (looked up at run time while 2.3 was red).
type KindParser = (input: unknown) => number | null;

type ImportedLineKey = "unitPriceHtCents" | "quantity" | "taxRateBp" | "kFo" | "kMo" | "hMo" | "hMoMajoration";

function importedLineValue(fields: Record<string, unknown>, key: ImportedLineKey): number | null {
  const result = normalizeMappedRowsForEstimateCreation([{ id: "entry", payload: { mapped_row: {
    designation: "Témoin de saisie", quantity: "1", unit_price_ht: "10", ...fields,
  } } }], { marginMultiplier: 1, defaultTaxRateBp: 2000 });
  return result.validLines.length === 1 ? result.validLines[0][key] : null;
}

/** The value the paste preview keeps for one cell under `header` (null when the row refuses it). */
function pastedValue(header: string, input: unknown, field: keyof ClipboardPreviewValues): number | null {
  const matrix = parseTsvMatrix([`Désignation\t${header}`, `Témoin de saisie\t${String(input)}`].join("\n"));
  const mapping = suggestClipboardColumnMapping(matrix.headers);
  if (!Object.values(mapping).includes(field)) throw new Error(`« ${header} » is not proposed as ${field}.`);
  const value = buildClipboardPreviewRows(matrix, mapping).rows[0]?.values[field];
  return typeof value === "number" ? value : null;
}

function readOrReason(parse: KindParser, input: unknown): number | null | string {
  try {
    return parse(input);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

const IMPORT_PRICE = "import (prix unitaire)";
const IMPORT_QUANTITY = "import (quantité)";
const IMPORT_LINE_HOURS = "import (heures de ligne)";
const IMPORT_RATE = "import (taux de TVA)";
const IMPORT_K_FO = "import (K FO)";
const IMPORT_K_MO = "import (K MO)";
const IMPORT_MAJORATION = "import (Majoration MO (%))";
const GRID_QUANTITY = "grille (cellule quantité)";
const GRID_LINE_HOURS = "grille (cellule h MO)";
const GRID_COEFFICIENT = "grille (cellules K FO, K MO)";
const PASTE_QUANTITY = "collage (Quantité)";
const PASTE_LINE_HOURS = "collage (h MO)";
const PASTE_K_FO = "collage (K FO)";
const PASTE_K_MO = "collage (K MO)";
const TEXT_ONLY = [GRID_QUANTITY, GRID_LINE_HOURS, GRID_COEFFICIENT, PASTE_QUANTITY, PASTE_LINE_HOURS, PASTE_K_FO, PASTE_K_MO];

// `skip` names an entry point that does not read this input: an empty cell answered by the
// field's documented default (an unpriced DPGF line stays a zero-price line, an empty quantity or
// h MO stays 0, an empty rate takes the version rate, an empty K FO, K MO or majoration stays 1;
// tech-debt-numeric-entry.md), a native spreadsheet number at a text-only entry point, or a sign
// that parsers.ts leaves to the field.
type KindCase = { input: unknown; expected: number | null; skip?: string[] };

// 2.3 review: the grid, the paste and the settings read each kind with the parser of the import,
// at the precision of the v1/v2 storage (quantity, h MO, K FO, K MO: numeric(12,3)); excess
// decimals are refused there too instead of being rounded by PostgreSQL on write.
const QUANTITY_KINDS: Array<{ kind: string; parsers: Record<string, KindParser>; cases: KindCase[] }> = [
  {
    kind: "montant en centimes",
    parsers: {
      "parseAmountCents (parsers.ts)": parseAmountCents,
      "montants (money.ts : réglages)": (input) => parseEuroToCents(String(input)),
      "grille (cellule PR FO)": (input) => parseCurrencyToCents(String(input), "EUR"),
      "collage (Prix unitaire HT)": (input) => {
        const value = pastedValue("Prix unitaire HT", input, "unit_price_ht");
        return value === null ? null : Math.round(value * 100);
      },
      [IMPORT_PRICE]: (input) => importedLineValue({ unit_price_ht: input }, "unitPriceHtCents"),
    },
    cases: [
      { input: "1 250,50", expected: 125050 },
      { input: "1,875", expected: null },
      { input: "2,500", expected: 250 },
      { input: "1 000 €", expected: 100000 },
      { input: "€ 12,50", expected: 1250 },
      { input: "0,5", expected: 50 },
      { input: "1.250", expected: null },
      { input: "12abc", expected: null },
      { input: "", expected: null, skip: [IMPORT_PRICE] },
    ],
  },
  {
    kind: "quantité (3 décimales)",
    parsers: {
      "parseQuantity (parsers.ts)": parseQuantity,
      [IMPORT_QUANTITY]: (input) => importedLineValue({ quantity: input }, "quantity"),
      [GRID_QUANTITY]: (input) => parseQuantityInput(String(input)),
      [PASTE_QUANTITY]: (input) => pastedValue("Quantité", input, "quantity"),
    },
    cases: [
      { input: "1,875", expected: 1.875 },
      { input: "1 234,567", expected: 1234.567 },
      // Today the grid and the paste keep 1,2345 and PostgreSQL stores 1,235.
      { input: "1,2345", expected: null },
      { input: "0", expected: 0 },
      { input: "1.250", expected: null },
      { input: "-1", expected: null, skip: ["parseQuantity (parsers.ts)"] },
      { input: 0.125, expected: 0.125, skip: TEXT_ONLY },
      { input: "", expected: null, skip: [IMPORT_QUANTITY, GRID_QUANTITY] },
    ],
  },
  {
    // v1/v2 store the line's total hours, h_mo numeric(12,3), read as a quantity (P-16, D11).
    kind: "heures de ligne h MO (3 décimales)",
    parsers: {
      [IMPORT_LINE_HOURS]: (input) => importedLineValue({ labor_hours: input }, "hMo"),
      [GRID_LINE_HOURS]: (input) => parseLineHoursDraft(String(input)),
      [PASTE_LINE_HOURS]: (input) => pastedValue("h MO", input, "h_mo"),
    },
    cases: [
      { input: "2,125", expected: 2.125 },
      { input: "1 234,5", expected: 1234.5 },
      // Today the grid and the paste keep 2,1234 and PostgreSQL stores 2,123.
      { input: "2,1234", expected: null },
      { input: "0", expected: 0 },
      { input: "1.250", expected: null },
      { input: "-2", expected: null },
      { input: "", expected: null, skip: [IMPORT_LINE_HOURS] },
    ],
  },
  {
    kind: "heures par unité (4 décimales)",
    parsers: { "parseHoursPerUnit (parsers.ts)": parseHoursPerUnit },
    cases: [
      { input: "1,991", expected: 1.991 },
      { input: "0,998", expected: 0.998 },
      { input: "0,1234", expected: 0.1234 },
      { input: "6", expected: 6 },
      { input: "0,12345", expected: null },
      // A dotted three-decimal text stays ambiguous; OPTIMA transmits native numbers.
      { input: "0.125", expected: null },
      { input: 1.991, expected: 1.991 },
      { input: "", expected: null },
    ],
  },
  {
    kind: "taux en points de base (2 décimales de %)",
    parsers: {
      "parseRateBp (parsers.ts)": parseRateBp,
      [IMPORT_RATE]: (input) => importedLineValue({ tax_rate_bp: input }, "taxRateBp"),
      // Settings « TVA unique »: the field shows percent; the panel stores round(percent × 100).
      "réglages (TVA unique)": (input) => {
        const percent = parseRatePercentDraft(String(input));
        return percent === null ? null : Math.round(percent * 100);
      },
    },
    cases: [
      { input: "12,5 %", expected: 1250 },
      { input: "12,5", expected: 1250 },
      { input: "20 %", expected: 2000 },
      { input: "20", expected: 2000 },
      { input: "5,5", expected: 550 },
      { input: "2,1 %", expected: 210 },
      // Today the settings store 1 256 pb for « 12,555 » and 0 for « -5 ».
      { input: "12,555", expected: null },
      { input: "-5", expected: null },
      { input: "100,01", expected: null },
      { input: "1.250", expected: null },
      { input: "abc", expected: null },
      { input: "", expected: null, skip: [IMPORT_RATE] },
    ],
  },
  {
    // D11's coefficient for the workbook parameters (and v3): four decimals.
    kind: "coefficient (4 décimales)",
    parsers: { "parseCoefficient (parsers.ts)": parseCoefficient },
    cases: [
      { input: "1,3", expected: 1.3 },
      { input: "1,2345", expected: 1.2345 },
      { input: "0", expected: 0 },
      { input: "1,23456", expected: null },
      { input: "1.250", expected: null },
      { input: "", expected: null },
    ],
  },
  {
    // K FO and K MO of v1/v2 lines are numeric(12,3): a fourth decimal cannot be stored.
    kind: "coefficient K FO / K MO stocké v1/v2 (3 décimales)",
    parsers: {
      "parseStoredCoefficient (parsers.ts)": parseStoredCoefficient,
      [IMPORT_K_FO]: (input) => importedLineValue({ k_fo: input }, "kFo"),
      [IMPORT_K_MO]: (input) => importedLineValue({ k_mo: input }, "kMo"),
      [GRID_COEFFICIENT]: (input) => parseCoefficientDraft(String(input)),
      [PASTE_K_FO]: (input) => pastedValue("K FO", input, "k_fo"),
      [PASTE_K_MO]: (input) => pastedValue("K MO", input, "k_mo"),
    },
    cases: [
      { input: "1,3", expected: 1.3 },
      { input: "1,235", expected: 1.235 },
      // Today the import, the grid and the paste keep 1,2345 and PostgreSQL stores 1,235.
      { input: "1,2345", expected: null },
      { input: "0", expected: 0 },
      { input: "1.250", expected: null },
      { input: "-1", expected: null },
      // A native spreadsheet number is rounded at the stored precision, never refused.
      { input: 1.2345, expected: 1.235, skip: TEXT_ONLY },
      { input: "", expected: null, skip: [IMPORT_K_FO, IMPORT_K_MO] },
    ],
  },
  {
    // P-11: « Majoration MO (%) », 100 = neutral, stored as a coefficient within [0 ; 10].
    kind: "majoration MO en % (coefficient stocké)",
    parsers: {
      "parseMajorationPercent (parsers.ts)": parseMajorationPercent,
      "grille (Majoration MO %)": (input) => parseMajorationPercentToCoefficient(String(input)),
      "action groupée (Majoration MO %)": (input) => majorationPercentToCoefficient(String(input)),
      "collage (Majoration MO (%))": (input) => pastedValue("Majoration MO (%)", input, "h_mo_majoration"),
      [IMPORT_MAJORATION]: (input) =>
        importedLineValue({ labor_hours: "1", h_mo_majoration_percent: input }, "hMoMajoration"),
    },
    cases: [
      { input: "100", expected: 1 },
      { input: "112,5", expected: 1.125 },
      { input: "112,5 %", expected: 1.125 },
      { input: "8", expected: 0.08 },
      { input: "0", expected: 0 },
      { input: "1 000", expected: 10 },
      { input: "1 001", expected: null },
      { input: "112,555", expected: null },
      { input: "1.250", expected: null },
      { input: "abc", expected: null },
      // Before 2.3 the grid turned an emptied majoration into ×0 and erased the labour cost.
      { input: "", expected: null, skip: [IMPORT_MAJORATION] },
    ],
  },
];

describe.each(QUANTITY_KINDS)("2.3 $kind", ({ parsers, cases }) => {
  it.each(cases.map((entry) => ({ ...entry, label: JSON.stringify(entry.input) })))(
    "$label",
    ({ input, expected, skip = [] }) => {
      const entries = Object.entries(parsers).filter(([entry]) => !skip.includes(entry));
      const actual = Object.fromEntries(entries.map(([entry, parse]) => [entry, readOrReason(parse, input)]));
      expect(actual).toEqual(Object.fromEntries(entries.map(([entry]) => [entry, expected])));
    },
  );
});
