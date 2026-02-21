import * as XLSX from "xlsx";

export type ImportSourceFormat = "json" | "csv" | "xlsx";
export type SimpleJsonValue = string | number | boolean | null;
export type NormalizedImportRow = Record<string, SimpleJsonValue>;

export type ParsedImportFile = {
  sourceFormat: "csv" | "xlsx";
  headers: string[];
  rows: NormalizedImportRow[];
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeHeaderValue(value: unknown, index: number) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
        ? ""
        : String(value).trim();

  if (raw.length === 0) {
    return `column_${index + 1}`;
  }

  const sanitized = raw
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized.length > 0 ? sanitized : `column_${index + 1}`;
}

function dedupeHeaders(headers: string[]) {
  const counts = new Map<string, number>();

  return headers.map((header) => {
    const count = counts.get(header) ?? 0;
    const nextCount = count + 1;
    counts.set(header, nextCount);
    return nextCount === 1 ? header : `${header}_${nextCount}`;
  });
}

function normalizeCellValue(value: unknown): SimpleJsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value) || isPlainObject(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function normalizeRowObject(row: Record<string, unknown>) {
  const normalized: NormalizedImportRow = {};
  const counts = new Map<string, number>();

  Object.entries(row).forEach(([rawKey, rawValue], index) => {
    const baseKey = normalizeHeaderValue(rawKey, index);
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    const key = count === 1 ? baseKey : `${baseKey}_${count}`;
    normalized[key] = normalizeCellValue(rawValue);
  });

  return normalized;
}

function hasNonNullValue(row: NormalizedImportRow) {
  return Object.values(row).some((value) => value !== null);
}

function buildHeaders(firstRow: unknown[], columnCount: number) {
  const rawHeaders: string[] = [];

  for (let index = 0; index < columnCount; index += 1) {
    rawHeaders.push(normalizeHeaderValue(firstRow[index], index));
  }

  return dedupeHeaders(rawHeaders);
}

export function detectImportSourceFormat(
  filename: string,
  mimeType: string | null | undefined
): "csv" | "xlsx" {
  const lowerName = filename.toLowerCase();
  const lowerType = (mimeType ?? "").toLowerCase();

  if (lowerName.endsWith(".csv") || lowerType.includes("csv")) {
    return "csv";
  }

  if (
    lowerName.endsWith(".xlsx") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xlsm") ||
    lowerType.includes("spreadsheet") ||
    lowerType.includes("excel")
  ) {
    return "xlsx";
  }

  return "csv";
}

export async function parseImportFile(file: File): Promise<ParsedImportFile> {
  const sourceFormat = detectImportSourceFormat(file.name, file.type);
  const fileBytes = await file.arrayBuffer();

  if (fileBytes.byteLength === 0) {
    throw new Error("Le fichier est vide.");
  }

  const workbook = XLSX.read(fileBytes, {
    type: "array",
    raw: true,
    cellDates: false,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      sourceFormat,
      headers: [],
      rows: [],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  if (matrix.length === 0) {
    return {
      sourceFormat,
      headers: [],
      rows: [],
    };
  }

  const columnCount = matrix.reduce((max, row) => {
    if (!Array.isArray(row)) return max;
    return Math.max(max, row.length);
  }, 0);

  if (columnCount === 0) {
    return {
      sourceFormat,
      headers: [],
      rows: [],
    };
  }

  const firstRow = Array.isArray(matrix[0]) ? matrix[0] : [];
  const headers = buildHeaders(firstRow, columnCount);
  const bodyRows = matrix.slice(1);

  const rows: NormalizedImportRow[] = [];
  for (const row of bodyRows) {
    const values = Array.isArray(row) ? row : [];
    const normalizedRow: NormalizedImportRow = {};

    headers.forEach((header, index) => {
      normalizedRow[header] = normalizeCellValue(values[index]);
    });

    if (hasNonNullValue(normalizedRow)) {
      rows.push(normalizedRow);
    }
  }

  return {
    sourceFormat,
    headers,
    rows,
  };
}

export function normalizeRowsFromJson(rows: unknown[]): NormalizedImportRow[] {
  const normalizedRows = rows.map((row, index) => {
    if (!isPlainObject(row)) {
      throw new Error(`La ligne ${index + 1} n'est pas un objet JSON valide.`);
    }

    return normalizeRowObject(row);
  });

  return normalizedRows.filter((row) => hasNonNullValue(row));
}
