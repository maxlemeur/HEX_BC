"use client";

export const IMPORT_WIZARD_ACCEPTED_FILE_TYPES =
  ".csv,.xlsx,.xls,.pdf,text/csv,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const IMPORT_WIZARD_VALID_EXTENSIONS = new Set([
  "csv",
  "xlsx",
  "xls",
  "pdf",
]);

export type ImportWizardFileScanResult = {
  headers: string[];
  headerRow: number;
};

export function getFileExtension(name: string): string | null {
  const ext = name.split(".").pop()?.trim().toLowerCase();
  return ext && ext.length > 0 ? ext : null;
}

export async function scanFileHeaders(
  file: File,
  ext: string
): Promise<ImportWizardFileScanResult> {
  const buffer = await file.arrayBuffer();

  if (ext === "csv") {
    const decoder = new TextDecoder("utf-8");
    const text = decoder.decode(buffer.slice(0, 8192));
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length === 0) return { headers: [], headerRow: 1 };

    const firstLine = lines[0];
    const semicolons = (firstLine.match(/;/g) ?? []).length;
    const commas = (firstLine.match(/,/g) ?? []).length;
    const delimiter = semicolons > commas ? ";" : ",";

    return {
      headers: firstLine
        .split(delimiter)
        .map((header) => header.trim().replace(/^"|"$/g, ""))
        .filter((header) => header.length > 0),
      headerRow: 1,
    };
  }

  const XLSX = (await import("xlsx")).default;
  const workbook = XLSX.read(buffer, { sheetRows: 10 });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) return { headers: [], headerRow: 1 };

  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, {
    header: 1,
  });

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;

    const cells = row
      .map((cell) => String(cell ?? "").trim())
      .filter((cell) => cell.length > 0);
    const textCells = cells.filter((cell) => Number.isNaN(Number(cell)));

    if (textCells.length >= 3) {
      return {
        headers: row
          .map((cell) => String(cell ?? "").trim())
          .filter((cell) => cell.length > 0),
        headerRow: index + 1,
      };
    }
  }

  return { headers: [], headerRow: 1 };
}
