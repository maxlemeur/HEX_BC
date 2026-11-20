import { describe, expect, it } from "vitest";

import { classifyMappedRows, type MappedRowClassification } from "@/lib/imports/mapped-row-structure";

import { projectDpgfPostes, type MappedDpgfPosteRow } from "./poste-list-dpgf";

describe("DPGF item projection", () => {
  it("keeps confirmed structure and excludes a sparse PDF subtotal without pricing a line", () => {
    const titles = [
      { designation: "Sanitaires" },
      { designation: "Lavabo", unit: "u", unit_price_ht: "illisible" },
      { designation: "Ancienne option" },
      { designation: "55,75", hex_code: "Sous-total" },
    ];
    const rows = titles.map((mappedRow, rowIndex) => ({ id: String(rowIndex), rowIndex, mappedRow, rawRow: {} }));
    const classifications = classifyMappedRows(rows, [
      { rowIndex: 0, kind: "section", level: 1 },
      { rowIndex: 2, kind: "ignore", level: null },
      { rowIndex: 3, kind: "line", level: null },
    ], {});
    expect([...classifications.values()]).toEqual([
      { kind: "section", level: 1 }, { kind: "line" }, { kind: "ignore" }, { kind: "footer" },
    ]);
  });

  it("accounts for each raw line in physical order and preserves both homonyms", () => {
    const physicalRows: { id: string; designation?: string; unit?: string; quantity?: string; structure?: MappedRowClassification }[] = [
      { id: "lot", designation: "Bâtiment A", structure: { kind: "section", level: 1 } },
      { id: "a", designation: "Lavabo", unit: "unité", quantity: "2", structure: { kind: "line" } },
      { id: "other-lot", designation: "Bâtiment B", structure: { kind: "section", level: 1 } },
      { id: "b", designation: "Lavabo", unit: "u", structure: { kind: "line" } },
      { id: "subtotal", designation: "Sous-total", structure: { kind: "footer" } },
      { id: "ambiguous", designation: "Autres prestations", structure: { kind: "ambiguous" } },
      { id: "missing" },
      { id: "duplicate", designation: "WC", structure: { kind: "line" } },
    ];
    const rawRows = physicalRows.map(({ id }, rowIndex) => ({
      id, rowIndex, sheetName: "Plomberie", sourceRowNumber: rowIndex + 3,
      sourcePage: null, tableIndex: null, documentId: null,
    }));
    const mappedRows = physicalRows.flatMap(({ id, designation, unit, quantity, structure }) =>
      structure ? [{
        id: `mapped-${id}`, rawRowId: id, designation, unit, quantity, classification: structure,
      }] : []
    );

    const projection = projectDpgfPostes({
      importId: "import", mappingId: "mapping", rawRows: rawRows.toReversed(),
      mappedRows: [...mappedRows.toReversed(), { ...mappedRows.at(-1)!, id: "duplicate-mapping" }],
    });

    expect(projection.counts).toEqual({ source: 8, useful: 2, ambiguous: 2, missing: 1, omitted: 3, orphaned: 0 });
    expect(projection.items.map((item) => [item.label, item.expectedUnit, item.referenceQuantity, item.sections[0]?.title]))
      .toEqual([["Lavabo", "u", 2, "Bâtiment A"], ["Lavabo", "u", null, "Bâtiment B"]]);
    expect(projection.items[1].origin).toMatchObject({ rawRowId: "b", mappedRowId: "mapped-b", sourceRowNumber: 6 });
    expect(projection.issues.map(({ rawRowId, reason }) => [rawRowId, reason])).toEqual([
      ["lot", "section"], ["other-lot", "section"], ["subtotal", "footer"], ["ambiguous", "ambiguous"],
      ["missing", "missing_mapping"], ["duplicate", "multiple_mappings"],
    ]);
  });

  it("orders equivalent inputs identically and leaves unreadable quantities unknown", () => {
    const rawRows = ["section", "line"].map((id, rowIndex) => ({
      id, rowIndex, sheetName: null, sourceRowNumber: null, sourcePage: null, tableIndex: null, documentId: null,
    }));
    const mappedRows: MappedDpgfPosteRow[] = [
      { id: "orphan-z", rawRowId: "unread-raw-row", classification: { kind: "line" } },
      { id: "mapped-section", rawRowId: "section", classification: { kind: "section", level: 1 } },
      { id: "orphan-a", rawRowId: null, classification: { kind: "line" } },
      { id: "mapped-line", rawRowId: "line", designation: "Lavabo", unit: "illisible", quantity: "illisible", classification: { kind: "line" } },
    ];
    const scope = { importId: "import", mappingId: "mapping" };
    const result = projectDpgfPostes({ ...scope, rawRows, mappedRows });
    const reordered = projectDpgfPostes({ ...scope, rawRows: rawRows.toReversed(), mappedRows: mappedRows.toReversed() });

    expect(reordered).toEqual(result);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ sections: [], expectedUnit: null, referenceQuantity: null });
    expect(result.issues.map(({ reason }) => reason)).toEqual([
      "unattested_mapping", "unattested_mapping", "ambiguous", "invalid_quantity",
    ]);
  });
});
