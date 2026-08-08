import * as XLSX from "xlsx";
import { beforeAll, describe, expect, it } from "vitest";

import { parseWorkbook } from "@/workers/xlsx-parser.worker";

function createWorkbookBuffer(matrix: unknown[][]): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(workbook, worksheet, "DPGF");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}

function createMultiSheetWorkbookBuffer(): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Nom du projet", "Fixture"],
      ["Marge", 1.3],
      ["Prix MO", 45],
    ]),
    "Renseignement"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Ouvrages", "commentaire", "Qte", "U", "PR. FO", "h MO"],
      ["Tube", "Sous-sol", 200, "ml", 40.74, 1.2],
    ]),
    "plb Z3-5"
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Ouvrages", "commentaire", "Qte", "U", "PR. FO", "h MO"],
      ["Autre tube", null, 900, "ml", 99, 9],
      ["Autre bride", null, 50, "U", 12, 1],
    ]),
    "Autre DPGF"
  );
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

  it("detects a shifted header, deduplicates columns, and skips blank rows", async () => {
    const rows = await parseWorkbook(buffer);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        Description: "Tube",
        Description_2: "Cuivre",
        Quantite: 2,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        Description: "Bride",
        Description_2: "Acier",
        Quantite: 1,
      }),
    );
    expect(rows[0]?._timax_structure).toEqual(
      expect.objectContaining({
        sheet_name: "DPGF",
        source_row_number: 4,
        column_order: ["Description", "Description_2", "Quantite"],
      }),
    );
  });

  it("honors a manual header-row override", async () => {
    const rows = await parseWorkbook(buffer, 2);

    expect(rows[0]).toEqual(expect.objectContaining({
      Alias: "Description",
      Alias_2: "Description",
      column_3: "Quantite",
    }));
  });

  it("selects the first eligible DPGF worksheet after an information sheet", async () => {
    const rows = await parseWorkbook(createMultiSheetWorkbookBuffer());

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        Ouvrages: "Tube",
        commentaire: "Sous-sol",
        Qte: 200,
        U: "ml",
        "PR._FO": 40.74,
        h_MO: 1.2,
        _timax_structure: expect.objectContaining({
          sheet_name: "plb Z3-5",
          source_row_number: 2,
        }),
      })
    );
  });
});
