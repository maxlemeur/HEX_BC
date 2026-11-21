import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseImportFile } from "@/lib/imports/parser";
import { readImportRowStructure } from "@/lib/imports/payload";
import { analyzeImportStructure } from "@/lib/imports/structure";
import { createDpgfPosteClassifier } from "@/lib/takeoff/poste-list-dpgf-structure";
import { parseWorkbook, parseWorkbookWithOrigin } from "@/workers/xlsx-parser.worker";

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
 * One fictional DPGF table written from the sheet cell (`firstRowNumber`, `firstColumnNumber`): rows above
 * it and columns left of it stay empty, so the sheet's used range (its `<dimension>`) starts there and the
 * value matrix both parsers read starts at that row and that column, not at A1.
 */
async function createSectionedWorkbookBuffer(firstRowNumber: number, firstColumnNumber = 1) {
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
      worksheet.getCell(firstRowNumber + offset, firstColumnNumber + column).value = value;
    });
  });

  const lastColumnNumber = firstColumnNumber + 3;
  const headerRow = worksheet.getRow(firstRowNumber);
  for (let column = firstColumnNumber; column <= lastColumnNumber; column += 1) {
    headerRow.getCell(column).font = { bold: true };
  }
  const sectionRow = worksheet.getRow(firstRowNumber + 1);
  sectionRow.getCell(firstColumnNumber).font = { bold: true };
  sectionRow.outlineLevel = 1;
  worksheet.mergeCells(firstRowNumber + 1, firstColumnNumber, firstRowNumber + 1, lastColumnNumber);
  const subsectionRow = worksheet.getRow(firstRowNumber + 4);
  subsectionRow.getCell(firstColumnNumber).font = { bold: true };
  subsectionRow.outlineLevel = 2;

  const content = await workbook.xlsx.writeBuffer();
  return Uint8Array.from(content as unknown as Uint8Array).buffer;
}

async function parseWithBothParsers(buffer: ArrayBuffer) {
  const file = new File([buffer], "fixture-dpgf.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const [serverResult, workerRows] = await Promise.all([parseImportFile(file), parseWorkbook(buffer)]);
  // The used range both parsers read the values from, so a fixture cannot silently start at A1.
  const usedRange = XLSX.read(new Uint8Array(buffer), { type: "array" }).Sheets.DPGF?.["!ref"];
  return { serverRows: serverResult.rows, workerRows, usedRange };
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

  it("gives the sheet row where the table starts, so a row is found in Excel by its own number", async () => {
    // The table starts on sheet row 3 and column B: the table's row 3 (« Tube cuivre 16 mm ») is sheet row 5.
    const buffer = await createSectionedWorkbookBuffer(3, 2);
    const file = new File([buffer], "fixture-dpgf.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const [server, worker] = await Promise.all([parseImportFile(file), parseWorkbookWithOrigin(buffer)]);
    expect(server.sheetFirstRow).toBe(3);
    expect(worker.sheetFirstRow).toBe(3);
    // The row of the table each row stores keeps its meaning (from the first row of the range read).
    const tube = server.rows.find((row) => row.Designation === "Tube cuivre 16 mm");
    expect(readImportRowStructure(tube ?? {})?.source_row_number).toBe(3);
    expect(worker.rows).toEqual(server.rows);
    // A sheet whose table starts at A1 gives 1: the table's row is the sheet's.
    const atOne = await parseWorkbookWithOrigin(await createSectionedWorkbookBuffer(1));
    expect(atOne.sheetFirstRow).toBe(1);
  });

  it("reads each cell's styles from its own sheet column when the table does not start in column A", async () => {
    const [atA1, atB1, atB3] = await Promise.all([
      createSectionedWorkbookBuffer(1).then(parseWithBothParsers),
      createSectionedWorkbookBuffer(1, 2).then(parseWithBothParsers),
      createSectionedWorkbookBuffer(3, 2).then(parseWithBothParsers),
    ]);
    expect([atA1.usedRange, atB1.usedRange, atB3.usedRange]).toEqual(["A1:D6", "B1:E6", "B3:E8"]);

    // Parity: the browser worker and the server parser return the same rows for each workbook.
    expect(atB1.workerRows).toEqual(atB1.serverRows);
    expect(atB3.workerRows).toEqual(atB3.serverRows);

    // The bold and merged cells of column B belong to « Désignation », the first column of the table, not to
    // the next header; the merged heading covers the four columns of the table and nothing beyond.
    const allColumns = ["Designation", "Qte", "U", "PU_HT"];
    const stylesOf = (rows: typeof atB1.serverRows) => rows.map((row) => {
      const structure = readImportRowStructure(row);
      return [row.Designation, structure?.bold_columns, structure?.merged_columns, structure?.outline_level];
    });
    const expectedStyles = [
      ["Plomberie sanitaire", allColumns, allColumns, 1],
      ["Tube cuivre 16 mm", [], [], null],
      ["Essais d'étanchéité", [], [], null],
      ["Réseau d'eau froide", ["Designation"], [], 2],
      ["Robinet d'arrêt", [], [], null],
    ];
    expect(stylesOf(atB1.serverRows)).toEqual(expectedStyles);
    expect(stylesOf(atB3.serverRows)).toEqual(expectedStyles);
    // Moving the table to column B, or to column B and row 3, changes nothing in what an import stores:
    // same values, same headers, same styles, same `source_row_number` as the table written from A1.
    expect(atB1.serverRows).toEqual(atA1.serverRows);
    expect(atB3.serverRows).toEqual(atA1.serverRows);

    // The import's structure review proposes the two bold headings as sections again.
    const preview = analyzeImportStructure(
      atB1.serverRows.map((row, rowIndex) => ({
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

    // The takeoff's item list reads the same structure: the two headings are sections, not items to measure.
    const classify = createDpgfPosteClassifier({ Designation: "designation", Qte: "quantity", U: "unit" });
    expect(atB1.serverRows.map((row) => [
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

  it("reads a table's styles up to its last column only, even when it ends in the sheet's last column", async () => {
    // Columns XFA to XFD: reading a cell beyond the table's last column goes past XFD, where ExcelJS throws.
    const [atA1, atLastColumns] = await Promise.all([
      createSectionedWorkbookBuffer(1).then(parseWithBothParsers),
      createSectionedWorkbookBuffer(1, 16381).then(parseWithBothParsers),
    ]);
    expect(atLastColumns.usedRange).toBe("XFA1:XFD6");

    expect(atLastColumns.workerRows).toEqual(atLastColumns.serverRows);
    expect(atLastColumns.serverRows).toEqual(atA1.serverRows);
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
