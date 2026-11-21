import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { parseImportFile } from "@/lib/imports/parser";
import { readImportRowStructure } from "@/lib/imports/payload";
import { analyzeImportStructure } from "@/lib/imports/structure";
import { createDpgfPosteClassifier } from "@/lib/takeoff/poste-list-dpgf-structure";
import { parseWorkbook } from "@/workers/xlsx-parser.worker";

async function createStructuredWorkbookBuffer() {
  const workbook = new Workbook();
  const informationWorksheet = workbook.addWorksheet("Renseignement");
  informationWorksheet.addRow(["Nom du projet", "Fixture"]);
  informationWorksheet.addRow(["Marge", 1.3]);
  informationWorksheet.addRow(["Prix MO", 45]);
  const worksheet = workbook.addWorksheet("plb Z3-5");

  worksheet.addRow([
    "Désignation",
    "Qte",
    "U",
    "PR. FO",
    "h MO",
    "commentaire",
  ]);
  worksheet.addRow(["Eaux usées"]);
  worksheet.addRow(["EUEV"]);
  worksheet.addRow(["Tube acier", 200, "ml", 40.74, 1.2, "Sous-sol"]);
  worksheet.addRow(["Poste hors lot", "—", "ens", "—", 0, "À chiffrer"]);
  worksheet.addRow(["TOTAL HT", null, null, null, null, null]);
  worksheet.addRow(["Les prix restent valables pendant 30 jours"]);

  worksheet.getCell("A2").font = { bold: true };
  worksheet.getCell("A3").font = { bold: true };
  worksheet.getRow(2).outlineLevel = 1;
  worksheet.getRow(3).outlineLevel = 2;
  worksheet.mergeCells("A2:F2");
  worksheet.mergeCells("A3:F3");

  const content = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(content as unknown as Uint8Array).buffer;
}

/**
 * One fictional DPGF table written from the sheet row `firstRowNumber`: rows above it stay empty, so
 * the sheet's used range (its `<dimension>`) starts there and the value matrix both parsers read
 * starts at that row, not at row 1.
 */
async function createSectionedWorkbookBuffer(firstRowNumber: number) {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("DPGF");
  const table = [
    ["Désignation", "Qte", "U", "PU HT"],
    ["Plomberie sanitaire"],
    ["Tube cuivre 16 mm", 12, "ml", 8.5],
    ["Essais d'étanchéité"],
    ["Réseau d'eau froide"],
    ["Robinet d'arrêt", 4, "u", 35],
  ];
  table.forEach((values, offset) => {
    values.forEach((value, column) => {
      worksheet.getCell(firstRowNumber + offset, column + 1).value = value;
    });
  });

  const headerRow = worksheet.getRow(firstRowNumber);
  for (let column = 1; column <= 4; column += 1) headerRow.getCell(column).font = { bold: true };
  const sectionRow = worksheet.getRow(firstRowNumber + 1);
  sectionRow.getCell(1).font = { bold: true };
  sectionRow.outlineLevel = 1;
  worksheet.mergeCells(firstRowNumber + 1, 1, firstRowNumber + 1, 4);
  const subsectionRow = worksheet.getRow(firstRowNumber + 4);
  subsectionRow.getCell(1).font = { bold: true };
  subsectionRow.outlineLevel = 2;

  const content = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(content as unknown as Uint8Array).buffer;
}

async function parseWithBothParsers(buffer: ArrayBuffer) {
  const file = new File([buffer], "fixture-dpgf.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const [serverResult, workerRows] = await Promise.all([parseImportFile(file), parseWorkbook(buffer)]);
  return { serverRows: serverResult.rows, workerRows };
}

describe("structured XLSX parsing", () => {
  it("reads each row's styles from its own sheet row when the used range starts below row 1", async () => {
    const [atRowOne, atRowThree] = await Promise.all([
      createSectionedWorkbookBuffer(1).then(parseWithBothParsers),
      createSectionedWorkbookBuffer(3).then(parseWithBothParsers),
    ]);

    // Parity: the browser worker and the server parser return the same rows for each workbook.
    expect(atRowOne.workerRows).toEqual(atRowOne.serverRows);
    expect(atRowThree.workerRows).toEqual(atRowThree.serverRows);

    const allColumns = ["Designation", "Qte", "U", "PU_HT"];
    const structureOf = (
      sourceRowNumber: number,
      style: { bold?: string[]; merged?: string[]; outline?: number | null } = {},
    ) => ({
      sheet_name: "DPGF",
      // Unchanged by the style fix: it still counts from the first row of the used range.
      source_row_number: sourceRowNumber,
      bold_columns: style.bold ?? [],
      merged_columns: style.merged ?? [],
      outline_level: style.outline ?? null,
      column_order: allColumns,
    });
    expect(atRowThree.serverRows.map((row) => [row.Designation, readImportRowStructure(row)])).toEqual([
      ["Plomberie sanitaire", structureOf(2, { bold: allColumns, merged: allColumns, outline: 1 })],
      ["Tube cuivre 16 mm", structureOf(3)],
      ["Essais d'étanchéité", structureOf(4)],
      ["Réseau d'eau froide", structureOf(5, { bold: ["Designation"], outline: 2 })],
      ["Robinet d'arrêt", structureOf(6)],
    ]);
    // Two empty rows above the table change nothing in what an import stores.
    expect(atRowThree.serverRows).toEqual(atRowOne.serverRows);

    // The import's structure review proposes the two bold headings as sections, and the line without a
    // price as a line to qualify.
    const preview = analyzeImportStructure(
      atRowThree.serverRows.map((row, rowIndex) => ({
        id: `row-${rowIndex}`,
        rowIndex,
        rawRow: row,
        mappedRow: { designation: row.Designation, quantity: row.Qte, unit: row.U, unit_price_ht: row.PU_HT },
      })),
    );
    expect(preview.candidates.map((candidate) => [candidate.title, candidate.suggested_kind, candidate.confidence]))
      .toEqual([
        ["Plomberie sanitaire", "section", "high"],
        ["Essais d'étanchéité", "line", "medium"],
        ["Réseau d'eau froide", "section", "high"],
      ]);

    // The takeoff's item list reads the same structure: two sections, the line without a price left to decide.
    const classify = createDpgfPosteClassifier({ Designation: "designation", Qte: "quantity", U: "unit" });
    expect(atRowThree.serverRows.map((row) => [
      row.Designation,
      classify({ designation: row.Designation, quantity: row.Qte, unit: row.U }, readImportRowStructure(row)),
    ])).toEqual([
      ["Plomberie sanitaire", { kind: "section", level: 1 }],
      ["Tube cuivre 16 mm", { kind: "line" }],
      ["Essais d'étanchéité", { kind: "ambiguous" }],
      ["Réseau d'eau froide", { kind: "section", level: 2 }],
      ["Robinet d'arrêt", { kind: "line" }],
    ]);
  });

  it("selects the DPGF sheet and keeps identical structure metadata in both parsers", async () => {
    const buffer = await createStructuredWorkbookBuffer();
    const file = new File([buffer], "fixture-dpgf.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    const [serverResult, workerRows] = await Promise.all([
      parseImportFile(file, { headerRowNumber: 1 }),
      parseWorkbook(buffer, 1),
    ]);

    expect(workerRows).toEqual(serverResult.rows);
    expect(serverResult.rows).toHaveLength(6);
    expect(serverResult.rows[2]).toEqual(
      expect.objectContaining({
        Designation: "Tube acier",
        Qte: 200,
        U: "ml",
        "PR._FO": 40.74,
        h_MO: 1.2,
        commentaire: "Sous-sol",
      }),
    );

    const structure = readImportRowStructure(serverResult.rows[0]);
    expect(structure).toEqual({
      sheet_name: "plb Z3-5",
      source_row_number: 2,
      bold_columns: ["Designation", "Qte", "U", "PR._FO", "h_MO", "commentaire"],
      merged_columns: ["Designation", "Qte", "U", "PR._FO", "h_MO", "commentaire"],
      outline_level: 1,
      column_order: ["Designation", "Qte", "U", "PR._FO", "h_MO", "commentaire"],
    });
    expect(readImportRowStructure(serverResult.rows[1])).toEqual(
      expect.objectContaining({
        source_row_number: 3,
        outline_level: 2,
      }),
    );
  });
});
