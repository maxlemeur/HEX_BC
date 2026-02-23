import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";

import {
  detectHeaderRowIndex,
  normalizeHeaderRowNumber,
  resolveHeaderRowIndex,
} from "./header-row";
import { parseImportFile, parseWorkbookMatrixWithTimeout } from "./parser";

function createWorkbookFile(matrix: unknown[][]): File {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const content = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  return new File([content], "sample.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("header-row detection", () => {
  it("detects a real header row after title and blank lines", () => {
    const matrix = [
      ["COLT PAR2 LOT05 - DPGF TUYAUTERIE LOT 04"],
      [],
      ["Description", "Famille Achat", "FO / MO", "QtE Atelier", "PU FO", "TOTAL HT"],
      ["Tube DN15", "Tube", "FOURNITURE", "", "", "0.00 EUR"],
    ];

    expect(detectHeaderRowIndex(matrix)).toBe(2);
  });

  it("resolves a manual header row when provided", () => {
    const matrix = [["Titre"], ["Description", "PU HT"], ["Tube DN15", "10"]];
    expect(resolveHeaderRowIndex(matrix, { headerRowNumber: 2 })).toBe(1);
  });

  it("rejects an out-of-range manual header row", () => {
    const matrix = [["Description", "PU HT"], ["Tube DN15", "10"]];
    expect(() =>
      resolveHeaderRowIndex(matrix, { headerRowNumber: 7 })
    ).toThrow("hors limites");
  });
});

describe("header-row input normalization", () => {
  it("normalizes valid values and rejects invalid ones", () => {
    expect(normalizeHeaderRowNumber(1)).toBe(1);
    expect(normalizeHeaderRowNumber("3")).toBe(3);
    expect(normalizeHeaderRowNumber("  5 ")).toBe(5);

    expect(normalizeHeaderRowNumber(0)).toBeNull();
    expect(normalizeHeaderRowNumber(-1)).toBeNull();
    expect(normalizeHeaderRowNumber("abc")).toBeNull();
    expect(normalizeHeaderRowNumber("1.5")).toBeNull();
    expect(normalizeHeaderRowNumber("")).toBeNull();
  });
});

describe("parseImportFile with header-row options", () => {
  it("uses automatic detection by default", async () => {
    const file = createWorkbookFile([
      ["COLT PAR2 LOT05 - DPGF TUYAUTERIE LOT 04"],
      [],
      ["Description", "Famille Achat", "PU FO"],
      ["Tube DN15", "Tube", 10],
      ["Tube DN20", "Tube", 12],
    ]);

    const parsed = await parseImportFile(file);

    expect(parsed.headers).toEqual(["Description", "Famille_Achat", "PU_FO"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.Description).toBe("Tube DN15");
  });

  it("respects a manual header row override", async () => {
    const file = createWorkbookFile([
      ["COLT PAR2 LOT05 - DPGF TUYAUTERIE LOT 04"],
      [],
      ["Description", "Famille Achat", "PU FO"],
      ["Tube DN15", "Tube", 10],
      ["Tube DN20", "Tube", 12],
    ]);

    const parsed = await parseImportFile(file, { headerRowNumber: 3 });
    expect(parsed.headers).toEqual(["Description", "Famille_Achat", "PU_FO"]);
    expect(parsed.rows).toHaveLength(2);
  });

  it("times out when workbook parsing does not complete in time", async () => {
    vi.useFakeTimers();

    const parsingPromise = parseWorkbookMatrixWithTimeout(
      new ArrayBuffer(16),
      250,
      async () =>
        new Promise(() => {
          // keep pending on purpose
        })
    );

    const rejection = expect(parsingPromise).rejects.toThrow("Delai de traitement depasse");
    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    vi.useRealTimers();
  });
});
