import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { writeEstimateV3Csv } from "@/lib/estimates/v3-csv-export";

// The browser journey checks the export's business values. Spreadsheet formula
// interpretation happens after download, so this checks the serialized cells.
describe("v3 estimate CSV spreadsheet boundary", () => {
  it("keeps formula-like titles inert and preserves ordinary cells", () => {
    const csv = writeEstimateV3Csv([
      ["Désignation", "Quantité", "Total HT"],
      ["=1+1", 2, 12.5],
      [" \t@SUM(1)", 3, 0],
      ["\u200b+1+2", 4, 7],
      ["-1+2", 5, 8],
      ["Normal; \"devis\"", 6, 9],
    ]);
    const workbook = XLSX.read(csv.slice(1), { type: "string", raw: true, FS: ";" });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
    });

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(rows).toEqual([
      ["Désignation", "Quantité", "Total HT"],
      ["'=1+1", "2", "12.5"],
      ["' \t@SUM(1)", "3", "0"],
      ["'\u200b+1+2", "4", "7"],
      ["'-1+2", "5", "8"],
      ["Normal; \"devis\"", "6", "9"],
    ]);
    expect(csv).toContain('"Normal; ""devis""";6;9');
  });

  it("keeps carriage returns inside quoted cells so they cannot create formula rows", () => {
    const csv = writeEstimateV3Csv([
      ["Désignation", "Quantité"],
      ["Avant\r=1+1", 2],
      ["\r@SUM(1)", 3],
    ]);
    const workbook = XLSX.read(csv.slice(1), { type: "string", raw: true, FS: ";" });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
    });

    expect(rows).toEqual([
      ["Désignation", "Quantité"],
      ["Avant\r=1+1", "2"],
      ["'\r@SUM(1)", "3"],
    ]);
    expect(csv).toContain('"Avant\r=1+1";"2"');
  });
});
