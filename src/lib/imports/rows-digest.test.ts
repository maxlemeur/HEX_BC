import { describe, expect, it } from "vitest";

import { dpgfImportRowsDigest } from "./rows-digest";

// The rows of supabase/tests/database/takeoff-item-lists.test.sql (« the digest the database computes »): an older
// flat payload, a mapped row whose reference only the payload's top level holds, and a row not mapped.
const rows = [
  { raw_row_id: "a1900000-0000-4000-8000-000000000002", status: "mapped",
    payload: { row_index: 1, designation: "Évier inox", quantity: "1,5", hex_code: "H-2" } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000001", status: "mapped",
    payload: { row_index: 0, reference: "R-1",
      mapped_row: { designation: "Lavabo céramique", quantity: 2, unit: "u", notes: null } } },
  { raw_row_id: "a1900000-0000-4000-8000-000000000003", status: "rejected", payload: { designation: "Ignorée" } },
];

describe("the digest of the rows a member reviews", () => {
  it("is the digest the database computes for the same rows (one value, pinned on both sides)", () => {
    // By raw row; designation, reference, HEX code, unit, quantity, notes; typed, length in UTF-8 bytes; the mapped
    // row first, else the payload's top level. Hashed independently of this code.
    expect(dpgfImportRowsDigest(rows)).toBe("654bc190a206940c4ebf7d208d5e749af5aa735c655312cebb04e15421fee19b");
  });

  it("changes with any reviewed value, not with the order the rows are read in", () => {
    const digest = dpgfImportRowsDigest(rows);
    expect(dpgfImportRowsDigest([...rows].reverse())).toBe(digest);
    const changed = rows.map((row, index) => index === 1
      ? { ...row, payload: { ...row.payload, mapped_row: { ...(row.payload as { mapped_row: object }).mapped_row, quantity: 3 } } }
      : row);
    expect(dpgfImportRowsDigest(changed)).not.toBe(digest);
    expect(dpgfImportRowsDigest(rows.slice(1))).not.toBe(digest);
  });
});
