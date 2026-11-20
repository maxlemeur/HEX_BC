import { describe, expect, it } from "vitest";

import { normalizeRowsFromJson } from "@/lib/imports/parser";
import { projectDpgfPostes, type MappedDpgfPosteRow } from "./poste-list-dpgf";

const scope = { importId: "import", mappingId: "mapping", columnMapping: {} };

function standaloneRow(id: string, rowIndex: number, sourcePage: number | null = null) {
  return { id, rowIndex, sheetName: null, sourceRowNumber: null, sourcePage, tableIndex: null, documentId: null };
}

describe("DPGF item projection", () => {
  it("uses stored designation styling for an indicative section and keeps measured rows", () => {
    const structure = {
      sheet_name: "DPGF", source_row_number: 2, bold_columns: ["Désignation"],
      merged_columns: [], outline_level: null, column_order: ["Désignation"],
    };
    const result = projectDpgfPostes({
      ...scope, columnMapping: { Designation: "designation" },
      rawRows: [{ ...standaloneRow("r1", 0), structure }, { ...standaloneRow("r2", 1), structure }],
      mappedRows: [
        { id: "m1", rawRowId: "r1", designation: "Sanitaires" },
        { id: "m2", rawRowId: "r2", designation: "Lavabo", unit: "u", quantity: 2 },
      ],
    });
    expect(result.items).toMatchObject([{ label: "Lavabo", sections: [{ title: "Sanitaires" }] }]);
    expect(result.issues).toMatchObject([{ reason: "section" }]);
  });

  it("reports the location and reason of a shifted PDF subtotal without exposing its amount", () => {
    const row = { designation: "55,75", hex_code: "Sous-total" };
    const projected = projectDpgfPostes({
      ...scope, rawRows: [standaloneRow("r1", 6, 2)],
      mappedRows: [{ ...row, id: "m1", rawRowId: "r1" }],
    });

    expect(projected.items).toEqual([]);
    expect(JSON.stringify(projected)).not.toMatch(/55,75|Sous-total/);
    expect(projected.issues[0]).toMatchObject({ reason: "footer", rowIndex: 6, sourcePage: 2 });
  });

  it("withholds a subtotal with a currency unit and an amount-only designation", () => {
    const rows = [
      { id: "r1", rowIndex: 6, mappedRow: { designation: "55,75", reference: "Sous-total", unit: "€" } },
      { id: "r2", rowIndex: 7, mappedRow: { designation: "1 249,50 EUR", unit: "u" } },
      { id: "r3", rowIndex: 8, mappedRow: { designation: "129.40", unit: "m" } },
      { id: "r4", rowIndex: 9, mappedRow: { designation: "320 € TTC", unit: "m" } },
    ];
    const result = projectDpgfPostes({
      ...scope, rawRows: rows.map(({ id, rowIndex }) => standaloneRow(id, rowIndex, 2)),
      mappedRows: rows.map(({ id, mappedRow }) => ({
        ...mappedRow, id: `mapped-${id}`, rawRowId: id,
      })),
    });

    expect(result.items).toEqual([]);
    expect(result.issues).toMatchObject([
      { reason: "footer", rowIndex: 6, sourcePage: 2 },
      { reason: "unreadable_designation", rowIndex: 7, sourcePage: 2 },
      { reason: "unreadable_designation", rowIndex: 8, sourcePage: 2 },
      { reason: "unreadable_designation", rowIndex: 9, sourcePage: 2 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/55,75|Sous-total|249,50|129\.40|EUR|320/);
  });

  it("keeps an unquantified unlabelled-unit prestation ambiguous regardless of price", () => {
    const mapped = { id: "m1", rawRowId: "r1", designation: "Pose lavabo" };
    const variants = [mapped, { ...mapped, unit_price_ht: "14,50" }, { ...mapped, total_ht: "19,20" }];
    const results = variants.map((row) => projectDpgfPostes({
      ...scope, rawRows: [standaloneRow("r1", 0)], mappedRows: [row],
    }));

    expect(results[0].items).toEqual([]);
    expect(results[0].issues).toMatchObject([{ reason: "ambiguous", title: "Pose lavabo" }]);
    expect(results).toEqual([results[0], results[0], results[0]]);
  });

  it("omits a repeated accented French header after import normalisation", () => {
    const source = normalizeRowsFromJson([
      { Désignation: "Lavabo", Unité: "u", Quantité: "2" },
      { Désignation: "Désignation", Unité: "Unité", Quantité: "Quantité" },
    ]);
    const mapping = { Designation: "designation", Unite: "unit", Quantite: "quantity" };
    const rows = source.map((rawRow, rowIndex) => ({
      id: String(rowIndex), rowIndex, rawRow,
      mappedRow: Object.fromEntries(Object.entries(mapping).map(([column, target]) => [target, rawRow[column]])),
    }));
    const projected = projectDpgfPostes({
      ...scope, columnMapping: mapping,
      rawRows: rows.map(({ id, rowIndex }) => standaloneRow(id, rowIndex)),
      mappedRows: rows.map(({ id, mappedRow }) => ({
        id: `mapped-${id}`, rawRowId: id, ...mappedRow,
      })),
    });

    expect(projected.items.map(({ label }) => label)).toEqual(["Lavabo"]);
    expect(projected.issues.map(({ reason }) => reason)).toEqual(["header"]);
  });

  it("accounts for each raw line in physical order and preserves both homonyms", () => {
    const physicalRows = [
      { id: "lot", designation: "Bâtiment A" },
      { id: "a", designation: "Lavabo", unit: "unité", quantity: "2" },
      { id: "other-lot", designation: "Bâtiment B" },
      { id: "b", designation: "Lavabo", unit: "u" },
      { id: "subtotal", designation: "Sous-total" },
      { id: "ambiguous", designation: "Autres prestations" },
      { id: "missing" },
      { id: "duplicate", designation: "WC", unit: "u" },
    ];
    const rawRows = physicalRows.map(({ id }, rowIndex) => ({
      id, rowIndex, sheetName: "Plomberie", sourceRowNumber: rowIndex + 3,
      sourcePage: null, tableIndex: null, documentId: null,
    }));
    const mappedRows = physicalRows.flatMap(({ id, designation, unit, quantity }) =>
      designation ? [{ id: `mapped-${id}`, rawRowId: id, designation, unit, quantity }] : []
    );

    const projection = projectDpgfPostes({
      ...scope, rawRows: rawRows.toReversed(),
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
      { id: "orphan-z", rawRowId: "unread-raw-row" },
      { id: "mapped-section", rawRowId: "section", designation: "Titre sans style" },
      { id: "orphan-a", rawRowId: null },
      { id: "mapped-line", rawRowId: "line", designation: "Lavabo", unit: "illisible", quantity: "illisible" },
    ];
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
