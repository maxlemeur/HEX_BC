import { describe, expect, it } from "vitest";

import { readCostingWorkbookRows } from "./costing-workbook";
import {
  applyWorkbookEdits,
  mergeWorkbookEdits,
  parseWorkbookCellAddress,
  supplierCodeEdits,
  supplierNameEdits,
  workbookCellAddress,
  workbookEditEntries,
} from "./costing-workbook-edits";

/**
 * Failure modes of the corrections made in the import screen (TI-711), written before the screen. Rows are
 * invented, in the shape of the workbook's « All_data » sheet.
 *  1. A correction changes the rows the file was read into: undoing it could not give the sheet's value back, and
 *     the journal's « before » would lie.
 *  2. A correction lands in another cell than the one Excel shows under that address, or outside the sheet the
 *     import reads.
 *  3. The journal keeps two entries for one cell, or keeps a correction that gives the cell its own value back.
 *  4. Associating a supplier renames another supplier's cells, or misses a cell that differs by case or accents.
 *  5. Keeping one code among competing ones rewrites the cells that already hold it.
 */

const HEADERS = ["ID", "Caractéristique", "Matériau", "F1_nom", "F1_ref", "F2_nom", "F2_ref", "Type_ligne"];
const base = [
  HEADERS,
  ["TUBE-1", "Tube", "Inox", "Pt.P", "A-1", "Comptoir Atlas", "C-1", "Art"],
  ["TUBE-2", "Tube", "Inox", "pt.p ", 4205, "PT.P", "A-2", "Art"],
];

describe("workbook cell addresses", () => {
  it("names a cell as Excel does, and reads it back (2)", () => {
    expect([workbookCellAddress(4, 1), workbookCellAddress(1, 0), workbookCellAddress(12, 26), workbookCellAddress(7, 59)])
      .toEqual(["B4", "A1", "AA12", "BH7"]);
    expect(parseWorkbookCellAddress(" b4 ")).toEqual({ row: 4, column: 1 });
    expect(parseWorkbookCellAddress("$AA$12")).toEqual({ row: 12, column: 26 });
    for (const refused of ["", "B", "4", "B0", "B4:C5", "Feuil1!B4", "BI7", "A6001"]) {
      expect(parseWorkbookCellAddress(refused)).toBeNull();
    }
  });
});

describe("applyWorkbookEdits", () => {
  it("corrects a copy of the rows, at the address Excel shows (1, 2)", () => {
    const frozen = structuredClone(base);
    const rows = applyWorkbookEdits(base, [
      { row: 2, column: 3, value: " Point P " },
      { row: 3, column: 4, value: null },
      // Past the last row and the last cell: the sheet grows with empty cells.
      { row: 5, column: 2, value: "Cuivre" },
      // Outside the sheet the import reads.
      { row: 0, column: 0, value: "x" }, { row: 2, column: 60, value: "x" }, { row: 6001, column: 0, value: "x" },
    ]);
    expect(base).toEqual(frozen);
    expect(rows[1]).toEqual(["TUBE-1", "Tube", "Inox", "Point P", "A-1", "Comptoir Atlas", "C-1", "Art"]);
    expect(rows[2][4]).toBeNull();
    expect(rows[3]).toEqual([]);
    expect(rows[4]).toEqual([null, null, "Cuivre"]);
    expect(rows).toHaveLength(5);
    // Untouched rows are the sheet's own.
    expect(rows[0]).toBe(base[0]);
    expect(applyWorkbookEdits(base, [])).toBe(base);
  });
});

describe("mergeWorkbookEdits", () => {
  it("keeps one entry per cell, and drops a correction that restores the sheet's value (3)", () => {
    const first = mergeWorkbookEdits(base, [], [{ row: 2, column: 3, value: "Point P" }, { row: 3, column: 4, value: "004205" }]);
    expect(first).toEqual([{ row: 2, column: 3, value: "Point P" }, { row: 3, column: 4, value: "004205" }]);
    const second = mergeWorkbookEdits(base, first, [
      { row: 2, column: 3, value: "Point P Matériaux" },
      // The number 4205 shows as « 4205 »: typing it back is no correction.
      { row: 3, column: 4, value: " 4205 " },
      { row: 3, column: 6, value: "" },
    ]);
    expect(second).toEqual([{ row: 2, column: 3, value: "Point P Matériaux" }, { row: 3, column: 6, value: null }]);
    expect(workbookEditEntries(base, second, 1)).toEqual([
      { address: "D2", row: 2, column: 3, header: "F1_nom", before: "Pt.P", after: "Point P Matériaux" },
      { address: "G3", row: 3, column: 6, header: "F2_ref", before: "A-2", after: "" },
    ]);
  });
});

describe("supplier corrections", () => {
  const { supplierReferenceOccurrences } = readCostingWorkbookRows(base);

  it("renames every cell of a supplier name, whatever its case, and no other supplier (4)", () => {
    expect(supplierNameEdits(supplierReferenceOccurrences, "PT.P", "Point P")).toEqual([
      { row: 2, column: 3, value: "Point P" },
      { row: 3, column: 3, value: "Point P" },
      { row: 3, column: 5, value: "Point P" },
    ]);
    expect(supplierNameEdits(supplierReferenceOccurrences, "Inconnu", "Point P")).toEqual([]);
  });

  it("writes the code kept in the cells that hold another (5)", () => {
    const cells = supplierReferenceOccurrences.filter((occurrence) => occurrence.supplier_name.trim().toLowerCase() === "pt.p");
    expect(cells.map((cell) => cell.supplier_sku)).toEqual(["A-1", "4205", "A-2"]);
    expect(supplierCodeEdits(cells, "A-1")).toEqual([{ row: 3, column: 4, value: "A-1" }, { row: 3, column: 6, value: "A-1" }]);
  });
});
