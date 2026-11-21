import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildSpreadsheetSnippet, validateSpreadsheetBudget } from "@/lib/affaires/intake-file-payload";

function toArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

describe("affaire intake resource budgets", () => {
  it("preflights XLSX expansion metadata before SheetJS parsing", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Code", "Description", "Qte"],
        ["A-001", "Cable cuivre", 12],
      ]),
      "DPGF"
    );
    const legitimate = Buffer.from(
      XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
    );

    await expect(
      buildSpreadsheetSnippet(
        "dpgf.xlsx",
        toArrayBuffer(legitimate)
      )
    ).resolves.toContain("A-001");

    const malicious = Buffer.from(legitimate);
    const centralEntryOffset = malicious.indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02])
    );
    expect(centralEntryOffset).toBeGreaterThanOrEqual(0);
    malicious.writeUInt32LE(0x7fffffff, centralEntryOffset + 24);

    expect(() =>
      validateSpreadsheetBudget(
        "dpgf.xlsx",
        toArrayBuffer(malicious)
      )
    ).toThrow(/depasse la taille autorisee|ratio de decompression/);
    expect(() =>
      validateSpreadsheetBudget(
        "dpgf.xls",
        toArrayBuffer(malicious)
      )
    ).toThrow(/depasse la taille autorisee|ratio de decompression/);
  });
});
