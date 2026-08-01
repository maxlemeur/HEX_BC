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

  it("accepts missing or zero quantities when a supply price is available", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-missing-quantity",
          payload: {
            mapped_row: {
              designation: "Tube acier",
              unit_price_ht: "40,74",
            },
          },
        },
        {
          id: "row-zero-quantity",
          payload: {
            mapped_row: {
              designation: "Coude acier",
              quantity: "0",
              unit_price_ht: "24,38",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.3,
        defaultTaxRateBp: 2000,
      },
    );

    expect(normalized.invalidLines).toHaveLength(0);
    expect(normalized.validLines).toEqual([
      expect.objectContaining({
        mappedRowId: "row-missing-quantity",
        quantity: 0,
        unitPriceHtCents: 4074,
        lineTotalHtCents: 0,
      }),
      expect.objectContaining({
        mappedRowId: "row-zero-quantity",
        quantity: 0,
        unitPriceHtCents: 2438,
        lineTotalHtCents: 0,
      }),
    ]);
  });

  it("still rejects negative quantities and totals that cannot be divided by zero", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-negative-quantity",
          payload: {
            mapped_row: {
              designation: "Tube cuivre",
              quantity: "-1",
              unit_price_ht: "15",
            },
          },
        },
        {
          id: "row-zero-with-total-only",
          payload: {
            mapped_row: {
              designation: "Robinet",
              quantity: "0",
              total_ht: "120",
            },
          },
        },
        {
          id: "row-malformed-quantity",
          payload: {
            mapped_row: {
              designation: "Vanne",
              quantity: "inconnue",
              unit_price_ht: "30",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.3,
        defaultTaxRateBp: 2000,
      },
    );

    expect(normalized.validLines).toHaveLength(0);
    expect(normalized.invalidLines).toEqual([
      expect.objectContaining({
        mappedRowId: "row-negative-quantity",
        reason: "invalid_quantity",
      }),
      expect.objectContaining({
        mappedRowId: "row-zero-with-total-only",
        reason: "invalid_unit_price",
      }),
      expect.objectContaining({
        mappedRowId: "row-malformed-quantity",
        reason: "invalid_quantity",
      }),
    ]);
  });
});

