import { utils, write } from "xlsx";
import { describe, expect, it } from "vitest";

import { previewMaterialRequestWorkbook } from "./workbook-preview";

function workbook(sheets: Record<string, unknown[][]>) {
  const result = utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    utils.book_append_sheet(result, utils.aoa_to_sheet(rows), name);
  }
  return Buffer.from(write(result, { type: "buffer", bookType: "xlsx" }));
}

describe("material request workbook preview", () => {
  it("keeps the source row numbers, decimal quantities, references and optional fields below a title", async () => {
    const input = workbook({ Matériel: [
      ["Demande de matériel fictive"], [],
      ["Référence", "Désignation", "Dimension", "Quantité", "Unité", "Zone", "Matière"],
      ["00025", "Tube inox 316L", "Ø 28 mm", 12.5, "m", "Local technique", "Inox"],
      [],
      ["TEST-02", "Coude inox", "Ø 28 mm", "2,750", "pièce"],
      [null, "Total", null, 15.25],
    ] });
    expect(await previewMaterialRequestWorkbook(input)).toMatchObject({
      sheet_name: "Matériel", sheet_names: ["Matériel"], header_row: 3, omitted_rows: 0, issues: [],
      rows: [
        { row_number: 4, line: { original_text: "Tube inox 316L", product_type: "Tube inox 316L", reference: "00025",
          dimension: "Ø 28 mm", quantity: 13, unit: "m", zone: "Local technique", material: "Inox" },
        selected: true, remarks: [{ code: "rounded", message: "Arrondi de 12,5" }] },
        { row_number: 6, line: { original_text: "Coude inox", product_type: "Coude inox", reference: "TEST-02",
          dimension: "Ø 28 mm", quantity: 3, unit: "pièce" },
        selected: true, remarks: [{ code: "rounded", message: "Arrondi de 2,75" }] },
      ],
    });
  });

  it("allows a different recognized sheet and reports incomplete rows without inventing a quantity", async () => {
    const input = workbook({ Notes: [["Désignation"], ["Brève description"]], Tube: [["Article", "Qté"], ["Tube", 1]],
      Raccords: [["Libellé", "Qty", "Unité"], ["Coude", "4,1234", "pièce"], [null, 3, "pièce"], ["Té", null, "pièce"]] });
    const preview = await previewMaterialRequestWorkbook(input, { sheet: "Raccords" });
    expect(preview.sheet_names).toEqual(["Notes", "Tube", "Raccords"]);
    expect(preview.rows.map(({ row_number, line, selected }) => [row_number, line.quantity, selected])).toEqual([[2, 5, true], [4, undefined, false]]);
    expect(preview.rows[1]?.remarks).toEqual([{ code: "no_quantity", message: "Sans quantité" }]);
    expect(preview.issues).toEqual([
      { row_number: 3, message: "Désignation manquante ou illisible. Ligne écartée." },
    ]);
  });

  it("does not treat dates as quantities or repeated headers as articles", async () => {
    const input = workbook({ Matériel: [
      ["Désignation", "Quantité"], ["Coude", new Date("2026-11-26T00:00:00Z")],
      ["Désignation", "Quantité"], ["Tube", 5],
    ] });
    const preview = await previewMaterialRequestWorkbook(input);
    expect(preview.rows.map(({ row_number, line }) => [row_number, line.quantity])).toEqual([[2, undefined], [4, 5]]);
    expect(preview.issues).toEqual([]);
  });

  it("reports rows beyond the request limit and lets the header row of an unrecognized table be chosen", async () => {
    const input = workbook({ Matériel: [["Article", "Quantité"], ...Array.from({ length: 302 }, (_, i) => ["Tube " + i, 1])] });
    const preview = await previewMaterialRequestWorkbook(input);
    expect(preview.rows).toHaveLength(300);
    expect(preview.omitted_rows).toBe(2);
    await expect(previewMaterialRequestWorkbook(workbook({ Notes: [["Titre"], ["abc"]] }))).resolves.toMatchObject({
      sheet_name: "Notes", header_row: null, columns: [], rows: [], first_rows: [{ row_number: 1 }, { row_number: 2 }],
    });
  });

  it("limits concurrent readers and releases the slot after the work completes", async () => {
    const input = workbook({ Matériel: [["Article", "Quantité"], ["Tube", 1]] });
    const pending = [previewMaterialRequestWorkbook(input), previewMaterialRequestWorkbook(input)];
    await expect(previewMaterialRequestWorkbook(input)).rejects.toThrow(/est en cours/);
    await Promise.all(pending);
    await expect(previewMaterialRequestWorkbook(input)).resolves.toMatchObject({ sheet_name: "Matériel" });
  });
});
