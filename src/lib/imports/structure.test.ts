import { describe, expect, it } from "vitest";

import { attachImportRowStructure } from "@/lib/imports/payload";
import {
  analyzeImportStructure,
  resolveImportStructure,
  type ImportStructureRow,
} from "@/lib/imports/structure";

function row(input: {
  rowIndex: number;
  title: string;
  quantity?: unknown;
  unit?: unknown;
  unitPrice?: unknown;
  bold?: boolean;
}): ImportStructureRow {
  const rawRow = attachImportRowStructure(
    {
      Désignation: input.title,
      Qte: input.quantity ?? null,
      U: input.unit ?? null,
      "PR._FO": input.unitPrice ?? null,
    },
    {
      sheet_name: "plb Z3-5",
      source_row_number: input.rowIndex + 2,
      bold_columns: input.bold ? ["Désignation"] : [],
      merged_columns: [],
      outline_level: null,
      column_order: ["Désignation", "Qte", "U", "PR._FO"],
    },
  );

  return {
    id: `row-${input.rowIndex}`,
    rowIndex: input.rowIndex,
    rawRow,
    mappedRow: {
      designation: input.title,
      quantity: input.quantity ?? null,
      unit: input.unit ?? null,
      unit_price_ht: input.unitPrice ?? null,
    },
  };
}

describe("DPGF structure analysis", () => {
  const rows = [
    row({ rowIndex: 0, title: "Eaux usées", bold: true }),
    row({ rowIndex: 1, title: "Tube hors lot", quantity: "—", unit: "ml" }),
    row({ rowIndex: 2, title: "EUEV" }),
    row({ rowIndex: 3, title: "Ventilation primaire", bold: true }),
    row({ rowIndex: 4, title: "TOTAL HT" }),
    row({ rowIndex: 5, title: "Les prix sont valables pendant 30 jours" }),
  ];

  it("classifies bold XLSX titles, leaves semantic candidates as lines, and stops at TOTAL", () => {
    const preview = analyzeImportStructure(rows);

    expect(preview.candidates).toEqual([
      expect.objectContaining({
        row_index: 0,
        title: "Eaux usées",
        confidence: "high",
        suggested_kind: "section",
        suggested_level: 1,
      }),
      expect.objectContaining({
        row_index: 2,
        title: "EUEV",
        confidence: "medium",
        suggested_kind: "line",
        suggested_level: null,
      }),
      expect.objectContaining({
        row_index: 3,
        title: "Ventilation primaire",
        confidence: "high",
        suggested_kind: "section",
      }),
    ]);
    expect(preview.footer_row_indexes).toEqual([4, 5]);
    expect(preview.summary).toMatchObject({
      high_confidence_candidates: 2,
      medium_confidence_candidates: 1,
      zero_price_rows: 2,
      ignored_footer_rows: 2,
      footer_start_row_index: 4,
    });
  });

  it("starts the footer at legal text even when no TOTAL row exists", () => {
    const preview = analyzeImportStructure([
      row({
        rowIndex: 0,
        title: "Tube acier",
        quantity: 1,
        unit: "u",
        unitPrice: 10,
      }),
      row({ rowIndex: 1, title: "Conditions générales de vente" }),
      row({ rowIndex: 2, title: "Les prix restent valables pendant 30 jours" }),
    ]);

    expect(preview.footer_row_indexes).toEqual([1, 2]);
    expect(preview.summary.footer_start_row_index).toBe(1);
  });

  it("accepts a reviewed level-two section after level one", () => {
    const resolved = resolveImportStructure(rows, [
      { rowIndex: 0, kind: "section", level: 1 },
      { rowIndex: 2, kind: "section", level: 2 },
      { rowIndex: 3, kind: "line", level: null },
    ]);

    expect(resolved.decisionsByRowIndex.get(2)).toEqual({
      rowIndex: 2,
      kind: "section",
      level: 2,
    });
  });

  it("rejects a level-two section without a preceding level-one section", () => {
    expect(() =>
      resolveImportStructure(rows, [
        { rowIndex: 0, kind: "line", level: null },
        { rowIndex: 2, kind: "section", level: 2 },
      ]),
    ).toThrow("doit suivre une section de niveau 1");
  });

  it("rejects decisions for rows that are not reviewable candidates", () => {
    expect(() =>
      resolveImportStructure(rows, [
        { rowIndex: 1, kind: "ignore", level: null },
      ]),
    ).toThrow("n'est pas un titre révisable");
  });
});
