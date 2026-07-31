import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";

import { parseWorkbook } from "@/workers/xlsx-parser.worker";

function createWorkbookBuffer(matrix: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(workbook, worksheet, "DPGF");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}

describe("xlsx parser worker", () => {
  let buffer: ArrayBuffer;

  beforeAll(() => {
    buffer = createWorkbookBuffer([
      ["Projet de renovation"],
      ["Alias", "Alias", ""],
      ["Description", "Description", "Quantite"],
      ["Tube", "Cuivre", 2],
      [],
      ["Bride", "Acier", 1],
    ]);
  });

  it("detects a shifted header, deduplicates columns, and skips blank rows", () => {
    expect(parseWorkbook(buffer)).toEqual([
      {
        Description: "Tube",
        Description_2: "Cuivre",
        Quantite: "2",
      },
      {
        Description: "Bride",
        Description_2: "Acier",
        Quantite: "1",
      },
    ]);
  });

  it("honors a manual header-row override", () => {
    expect(parseWorkbook(buffer, 2)[0]).toEqual({
      Alias: "Description",
      Alias_2: "Description",
      col_3: "Quantite",
    });
  });
});
