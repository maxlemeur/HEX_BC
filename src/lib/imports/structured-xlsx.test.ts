import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import { normalizeRowsFromJson, parseImportFile } from "@/lib/imports/parser";
import { readImportRowStructure } from "@/lib/imports/payload";
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

describe("structured XLSX parsing", () => {
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

  it("preserves reserved structure objects through JSON normalization", () => {
    const structure = {
      sheet_name: "plb Z3-5",
      source_row_number: 12,
      bold_columns: ["Designation"],
      merged_columns: [],
      outline_level: null,
      column_order: ["Designation", "Qte"],
    };

    expect(
      normalizeRowsFromJson([
        {
          Designation: "Eaux usées",
          _timax_structure: structure,
        },
      ])[0],
    ).toEqual({
      Designation: "Eaux usées",
      _timax_structure: structure,
    });
    expect(
      normalizeRowsFromJson([{ _timax_structure: structure }]),
    ).toEqual([]);
  });
});
