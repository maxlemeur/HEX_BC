import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { resolveSheetMatrixOrigin } from "@/lib/imports/sheet-matrix-origin";

describe("resolveSheetMatrixOrigin", () => {
  it("names the sheet cell that `sheet_to_json` returns as the matrix's first cell", () => {
    for (const range of ["A1:D6", "B3:E8", "Z9:AB12", "AA12:AD20", "AZ2:BA3", "XFA1:XFD6", "XFD1048576", "C7"]) {
      const origin = resolveSheetMatrixOrigin({ "!ref": range });
      const address = XLSX.utils.encode_cell({ r: origin.row - 1, c: origin.column - 1 });
      const sheet = { "!ref": range, [address]: { t: "s", v: "origine" } };
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, blankrows: true });
      expect(matrix[0]?.[0], range).toBe("origine");
    }
  });

  it("starts at A1 when the sheet has no readable range", () => {
    for (const sheet of [{}, { "!ref": null }, { "!ref": "" }, { "!ref": 12 }]) {
      expect(resolveSheetMatrixOrigin(sheet)).toEqual({ row: 1, column: 1 });
    }
  });
});
