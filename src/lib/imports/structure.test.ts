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
  totalHt?: unknown;
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
      ...(input.totalHt === undefined ? {} : { total_ht: input.totalHt }),
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

  it("still starts a classic footer at its first Sous-total when no line content follows", () => {
    const preview = analyzeImportStructure([
      row({ rowIndex: 0, title: "Tube acier", quantity: 2, unit: "ml", unitPrice: 10 }),
      row({ rowIndex: 1, title: "Collier", quantity: 4, unit: "u", unitPrice: 3 }),
      row({ rowIndex: 2, title: "Sous-total HT" }),
      row({ rowIndex: 3, title: "TVA 20 %" }),
      row({ rowIndex: 4, title: "Total TTC" }),
      row({ rowIndex: 5, title: "Conditions générales de vente" }),
    ]);

    expect(preview.footer_row_indexes).toEqual([2, 3, 4, 5]);
    expect(preview.summary.footer_start_row_index).toBe(2);
    expect(preview.candidates.map((candidate) => candidate.row_index)).not.toContain(3);
  });

  // Independent review of 2.8: a priced footer and options after the total keep the previous behaviour.
  it("starts a priced footer at its Sous-total HT: the VAT and TTC amounts are not lines", () => {
    const preview = analyzeImportStructure([
      row({ rowIndex: 0, title: "Tube acier", quantity: 2, unit: "ml", unitPrice: 10 }),
      row({ rowIndex: 1, title: "Sous-total HT", totalHt: 100_000 }),
      row({ rowIndex: 2, title: "TVA 20 %", totalHt: 20_000 }),
      row({ rowIndex: 3, title: "Total TTC", totalHt: 120_000 }),
    ]);

    expect(preview.footer_row_indexes).toEqual([1, 2, 3]);
    expect(preview.summary.footer_start_row_index).toBe(1);
  });

  it("keeps options listed after Total HT in the footer, as before", () => {
    const preview = analyzeImportStructure([
      row({ rowIndex: 0, title: "Tube acier", quantity: 2, unit: "ml", unitPrice: 10 }),
      row({ rowIndex: 1, title: "Total HT", totalHt: 20 }),
      row({ rowIndex: 2, title: "PSE 1 : robinet thermostatique", quantity: 4, unit: "u", unitPrice: 50 }),
    ]);

    expect(preview.footer_row_indexes).toEqual([1, 2]);
    expect(preview.summary.footer_start_row_index).toBe(1);
  });

  it("keeps options listed right after a Sous-total HT in the footer, as before", () => {
    const preview = analyzeImportStructure([
      row({ rowIndex: 0, title: "Tube acier", quantity: 2, unit: "ml", unitPrice: 10 }),
      row({ rowIndex: 1, title: "Sous-total HT", totalHt: 100_000 }),
      row({ rowIndex: 2, title: "PSE 1 : robinet thermostatique", quantity: 4, unit: "u", unitPrice: 50 }),
      row({ rowIndex: 3, title: "Total HT", totalHt: 100_200 }),
    ]);

    expect(preview.footer_row_indexes).toEqual([1, 2, 3]);
    expect(preview.summary.footer_start_row_index).toBe(1);
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
