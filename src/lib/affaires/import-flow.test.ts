import { describe, expect, it } from "vitest";

import {
  buildImportFlowStats,
  normalizeMappedRowsForEstimateCreation,
  parseLocalizedNumber,
} from "@/lib/affaires/import-flow";

describe("import-flow helpers", () => {
  it("parses localized numbers in FR/EN formats", () => {
    expect(parseLocalizedNumber("1 234,56")).toBe(1234.56);
    expect(parseLocalizedNumber("1,234.56")).toBe(1234.56);
    expect(parseLocalizedNumber("99.5")).toBe(99.5);
    expect(parseLocalizedNumber("99,5")).toBe(99.5);
    expect(parseLocalizedNumber("")).toBeNull();
    expect(parseLocalizedNumber("abc")).toBeNull();
  });

  it("normalizes mapped rows into valid and invalid estimate lines", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-1",
          payload: {
            row_index: 7,
            mapped_row: {
              designation: "Cable cuivre",
              quantity: "2",
              unit_price_ht: "10,50",
              labor_hours: "1,5",
              h_mo_majoration: "1,1",
            },
          },
        },
        {
          id: "row-2",
          payload: {
            row_index: 8,
            mapped_row: {
              quantity: "2",
              unit_price_ht: "5",
            },
          },
        },
        {
          id: "row-3",
          payload: {
            mapped_row: {
              designation: "Tube acier",
              quantity: "4",
              total_ht: "100.00",
              notes: "Ligne derivee depuis total HT",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.2,
        defaultTaxRateBp: 2000,
      }
    );

    expect(normalized.totalRows).toBe(3);
    expect(normalized.validLines).toHaveLength(2);
    expect(normalized.invalidLines).toHaveLength(1);

    expect(normalized.invalidLines[0]).toMatchObject({
      mappedRowId: "row-2",
      rowIndex: 8,
      reason: "missing_title",
    });

    expect(normalized.validLines[0]).toMatchObject({
      mappedRowId: "row-1",
      rowIndex: 7,
      title: "Cable cuivre",
      quantity: 2,
      unitPriceHtCents: 1050,
      taxRateBp: 2000,
      hMo: 1.5,
      hMoMajoration: 1.1,
    });

    expect(normalized.validLines[1]).toMatchObject({
      mappedRowId: "row-3",
      title: "Tube acier",
      quantity: 4,
      unitPriceHtCents: 2500,
      description: "Ligne derivee depuis total HT",
    });

    const stats = buildImportFlowStats(normalized, 2);
    expect(stats).toEqual({
      totalRows: 3,
      validRows: 2,
      invalidRows: 1,
      insertedRows: 2,
      skippedRows: 1,
    });
  });
});

