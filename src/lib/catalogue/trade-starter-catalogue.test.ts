import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { parseProductCsv } from "@/components/products/product-csv";

describe("TI-583 plumbing pilot import", () => {
  it("previews the real catalogue with unique internal references and no invented prices", () => {
    const csv = readFileSync(resolve("docs/catalogues-metiers/plomberie-pilote.csv"), "utf8");
    const result = parseProductCsv(csv);
    expect(result.rejectedRows).toEqual([]);
    expect(result.ignoredColumns).toEqual([]);
    expect(result.acceptedRows).toHaveLength(12);
    const references = result.acceptedRows.map((row) => row.reference?.toLowerCase());
    expect(new Set(references).size).toBe(result.acceptedRows.length);
    expect(result.acceptedRows.every((row) => row.reference && row.designation && row.category && row.dimensions)).toBe(true);
    expect(result.acceptedRows.every((row) => row.unit === "m" || row.unit === "u")).toBe(true);
    expect(result.acceptedRows.every((row) => row.unit_price_cents === 0)).toBe(true);
  });
});
