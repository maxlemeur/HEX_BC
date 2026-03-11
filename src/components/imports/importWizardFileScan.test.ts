import { describe, expect, it, vi } from "vitest";

const readMock = vi.fn();
const sheetToJsonMock = vi.fn();

vi.mock("xlsx", () => ({
  default: {
    read: readMock,
    utils: {
      sheet_to_json: sheetToJsonMock,
    },
  },
}));

import {
  getFileExtension,
  scanFileHeaders,
} from "@/components/imports/importWizardFileScan";

describe("importWizardFileScan", () => {
  it("detects csv headers with semicolon delimiter", async () => {
    const file = new File(
      ['"Code";"Description";"Prix"\nA1;"Ligne";12'],
      "devis.csv",
      { type: "text/csv" }
    );

    await expect(scanFileHeaders(file, "csv")).resolves.toEqual({
      headers: ["Code", "Description", "Prix"],
      headerRow: 1,
    });
  });

  it("detects the first spreadsheet row with at least three text cells", async () => {
    readMock.mockReturnValue({
      SheetNames: ["Feuil1"],
      Sheets: { Feuil1: {} },
    });
    sheetToJsonMock.mockReturnValue([
      [2024, 1, 17],
      ["Code", "Description", "Prix"],
      ["A1", "Ligne", 12],
    ]);

    const file = new File(["xlsx-data"], "devis.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });

    await expect(scanFileHeaders(file, "xlsx")).resolves.toEqual({
      headers: ["Code", "Description", "Prix"],
      headerRow: 2,
    });
  });

  it("returns the normalized extension when present", () => {
    expect(getFileExtension("Mon.Fichier.XLSX")).toBe("xlsx");
    expect(getFileExtension("sans-extension")).toBe("sans-extension");
    expect(getFileExtension("devis.")).toBeNull();
  });
});
