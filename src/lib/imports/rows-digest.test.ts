import { describe, expect, it } from "vitest";

import { dpgfImportRowsDigest } from "./rows-digest";

// The rows of supabase/tests/database/takeoff-item-lists.test.sql (« the digest the database computes »): a mapped row
// with its raw row's structure facts and a reference only the payload's top level holds, an older flat payload, a
// rejected row (the estimate's normaliser reads it too), numbers the database writes without an exponent or a scale
// (there 1.50, 2.000 and -0), and an object as its type.
const rows = [
  { raw_row_id: "a1900000-0000-4000-8000-000000000002", status: "mapped",
    payload: { row_index: 1, designation: "Évier inox", quantity: "1,5", hex_code: "H-2" } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000001", status: "mapped",
    payload: { row_index: 0, reference: "R-1",
      raw_row: { _timax_structure: { sheet_name: "DPGF", source_row_number: 3, bold_columns: ["Designation"],
        merged_columns: [], outline_level: 1, column_order: ["Designation", "Qte"] } },
      mapped_row: { designation: "Lavabo céramique", quantity: 2, unit: "u", notes: null } } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000003", status: "rejected",
    payload: { row_index: 2, designation: "Option rejetée", quantity: 4 } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000004", status: "mapped",
    payload: { row_index: 3,
      mapped_row: { designation: "Résidu de formule", quantity: 1e-7, hex_code: 1e21, notes: { cell: "B4" } } } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000005", status: "mapped",
    payload: { row_index: 4,
      mapped_row: { designation: "Échelles", quantity: 1.5, unit: 2, reference: -0, hex_code: 123456789012345680000 } } },
];

describe("the digest of the rows a member reviews", () => {
  it("is the digest the database computes for the same rows (one value, pinned on both sides)", () => {
    // Every row by its raw row; its index; designation, reference, HEX code, unit, quantity, notes; its raw row's
    // structure facts; typed, length in UTF-8 bytes. Hashed independently of this code.
    expect(dpgfImportRowsDigest(rows)).toBe("6dac77128d18a518d247cd6c2f456573edec1576c32239bc5337c9e786eb5894");
  });

  it("changes with any fact the confirmation uses, not with the order the rows are read in", () => {
    const digest = dpgfImportRowsDigest(rows);
    expect(dpgfImportRowsDigest([...rows].reverse())).toBe(digest);
    const withRow = (index: number, payload: object) => rows.map((row, position) => position === index ? { ...row, payload } : row);
    expect(dpgfImportRowsDigest(withRow(1, { ...rows[1].payload, mapped_row: { ...(rows[1].payload as { mapped_row: object }).mapped_row,
      quantity: 3 } }))).not.toBe(digest);
    expect(dpgfImportRowsDigest(withRow(1, { ...rows[1].payload, row_index: 7 }))).not.toBe(digest);
    expect(dpgfImportRowsDigest(withRow(1, { ...rows[1].payload, raw_row: { _timax_structure: { sheet_name: "DPGF",
      source_row_number: 3, bold_columns: [], merged_columns: [], outline_level: 1, column_order: ["Designation", "Qte"] } } })))
      .not.toBe(digest);
    expect(dpgfImportRowsDigest(withRow(2, { ...rows[2].payload, quantity: 5 }))).not.toBe(digest);
    expect(dpgfImportRowsDigest(rows.slice(1))).not.toBe(digest);
  });
});
