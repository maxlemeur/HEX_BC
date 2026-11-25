import { describe, expect, it, vi } from "vitest";

import * as XLSX from "xlsx";

vi.mock("xlsx", async (importOriginal) => ({
  ...await importOriginal<typeof XLSX>(),
  writeFile: vi.fn(),
}));

import {
  CORRECTION_HEADERS,
  exportWorkbookEdits,
  readWorkbookCorrectionsFile,
  workbookCorrectionRows,
  WorkbookCorrectionsFileError,
} from "./costing-workbook-corrections";
import { readCostingWorkbookRows } from "./costing-workbook";
import { workbookEditEntries } from "./costing-workbook-edits";

const header = ["F2_ref", "F1_nom", "ID", "Caractéristique", "Matériau", "Type_ligne", "F1_ref"];
const { supplierReferenceOccurrences } = readCostingWorkbookRows([
  header,
  ["000096", "Fournitures Exemple", "TUBE-01", "Tube", "Inox", "Art", "000042"],
]);
const sources = new Map(supplierReferenceOccurrences.map((source) => [`${source.row}-${source.slot}`, source]));

describe("workbookCorrectionRows", () => {
  it("exports one correction for an article cell with several supplier occurrences", () => {
    const rows = workbookCorrectionRows([
      { row: 2, slot: 1, reason: "article_not_found" },
      { row: 2, slot: 2, reason: "article_not_found" },
    ], sources);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ address: "C2", field: "ID", value: "TUBE-01", codes: "000042\n000096", sourceCells: "G2\nA2" });
  });

  it("does not invent a correction cell for a missing header or a catalogue-only action", () => {
    const rows = workbookCorrectionRows([
      { row: 2, slot: 2, reason: "invalid_supplier_name" },
      { row: 2, slot: 1, reason: "article_locked" },
    ], sources);

    expect(rows).toMatchObject([
      { address: "", field: "F2_nom", advice: "Ajouter la colonne F2_nom au classeur et renseigner le fournisseur.", sourceCells: "A2" },
      { address: "", field: "Catalogue", sourceCells: "G2" },
    ]);
  });
});

/**
 * (TI-711) The corrections file is filled by the office in Excel, then read back. Failure modes:
 *  1. A correction is applied to another cell than the one its line names.
 *  2. A code typed with leading zeros loses them on the way back.
 *  3. A line written for another state of the workbook (its cell no longer holds the exported value) is applied.
 *  4. A file of another shape is read as corrections, or refused without saying which columns are expected.
 */
describe("readWorkbookCorrectionsFile", () => {
  const rows = [header, ["000096", "Fournitures Exemple", "TUBE-01", "Tube", "Inox", "Art", "000042"]];
  const file = (lines: unknown[][], sheet = "Corrections") => {
    const book = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(lines);
    XLSX.utils.book_append_sheet(book, worksheet, sheet);
    return XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  };
  const headers = ["Motif", CORRECTION_HEADERS.address, "Colonne", CORRECTION_HEADERS.original, CORRECTION_HEADERS.correction, "Article"];

  it("reads each filled line as a correction of its cell, and keeps the text as typed (1, 2)", async () => {
    const read = await readWorkbookCorrectionsFile(file([
      headers,
      ["Fournisseur actif introuvable", "B2", "F1_nom", "Fournitures Exemple", "Fournitures Exemple SAS", "TUBE-01"],
      ["Référence fournisseur illisible ou sans code", "g2", "F1_ref", "000042", "004205", "TUBE-01"],
      ["Article actif introuvable", "C2", "ID", "TUBE-01", ""],
    ]), rows);
    expect(read).toEqual({
      edits: [{ row: 2, column: 1, value: "Fournitures Exemple SAS" }, { row: 2, column: 6, value: "004205" }],
      skipped: [],
    });
  });

  it("leaves out a line written for another value of the cell, or without a cell (3)", async () => {
    const read = await readWorkbookCorrectionsFile(file([
      headers,
      ["", "C2", "ID", "TUBE-00", "TUBE-02", "TUBE-01"],
      ["", "", "Catalogue", "", "à voir"],
      ["", "ZZZ9", "ID", "", "x"],
      ["", "A2", "F2_ref", "000096", "000097", "TUBE-01"],
    ]), rows);
    expect(read.edits).toEqual([{ row: 2, column: 0, value: "000097" }]);
    expect(read.skipped).toEqual([
      { line: 2, address: "C2", reason: "changed" },
      { line: 3, address: "", reason: "address" },
      { line: 4, address: "ZZZ9", reason: "address" },
    ]);
  });

  it("rejects a missing original-value column", async () => {
    await expect(readWorkbookCorrectionsFile(file([
      ["Cellule à vérifier", "Colonne", "Correction à renseigner", "Article"],
      ["G2", "F1_ref", "004205", "TUBE-01"],
    ]), rows)).rejects.toThrow("Valeur d’origine");
  });

  it("leaves a correction out when a different article or field has the same original value", async () => {
    const read = await readWorkbookCorrectionsFile(file([
      headers,
      ["", "G2", "F1_ref", "000042", "004205", "TUBE-02"],
      ["", "G2", "F2_ref", "000042", "004205", "TUBE-01"],
    ]), rows);
    expect(read.edits).toEqual([]);
    expect(read.skipped.map(({ reason }) => reason)).toEqual(["article", "field"]);
  });

  it("reads a declared clear but leaves an unfilled correction alone", async () => {
    const read = await readWorkbookCorrectionsFile(file([
      [...headers, "Effacer la cellule"],
      ["", "G2", "F1_ref", "000042", "", "TUBE-01", "Oui"],
      ["", "A2", "F2_ref", "000096", "", "TUBE-01", ""],
    ]), rows);
    expect(read).toEqual({ edits: [{ row: 2, column: 6, value: null }], skipped: [] });
  });

  it("round-trips a deliberate supplier code clear through the exported journal", async () => {
    const edit = { row: 2, column: 6, value: null };
    await exportWorkbookEdits(workbookEditEntries(rows, [edit], 1), rows, rows);
    const [book] = vi.mocked(XLSX.writeFile).mock.lastCall!;
    const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    expect(await readWorkbookCorrectionsFile(bytes, rows)).toEqual({ edits: [edit], skipped: [] });
  });

  it("refuses a file that is not a corrections file, naming the columns it expects (4)", async () => {
    await expect(readWorkbookCorrectionsFile(file([["Référence", "Prix"], ["A", 1]]), rows)).rejects.toThrow(
      "Ce fichier doit contenir les colonnes « Cellule à vérifier », « Valeur d’origine », « Correction à renseigner », « Colonne » et « Article ».",
    );
    await expect(readWorkbookCorrectionsFile(new TextEncoder().encode("pas un classeur").buffer, rows))
      .rejects.toBeInstanceOf(WorkbookCorrectionsFileError);
  });
});
