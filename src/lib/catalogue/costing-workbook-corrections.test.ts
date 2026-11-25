import { describe, expect, it } from "vitest";

import { workbookCorrectionRows } from "./costing-workbook-corrections";
import { readCostingWorkbookRows } from "./costing-workbook";

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
