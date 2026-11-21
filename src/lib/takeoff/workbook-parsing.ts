import * as XLSX from "xlsx";

import { resolveHeaderRowIndex } from "@/lib/imports/header-row";
import { dedupeHeaders } from "@/lib/imports/tabular-normalization";
import {
  TakeoffError,
  TakeoffErrorCode,
} from "@/lib/takeoff/errors";
import { warning } from "@/lib/takeoff/exchange-normalization";
import type { TakeoffWarning } from "@/lib/takeoff/types";

export type ParsedTakeoffSheet = {
  sheetName: string;
  headers: string[];
  rows: string[][];
  csvText: string;
  headerRowIndex: number;
};

type ParsedTakeoffWorkbook = {
  sheets: ParsedTakeoffSheet[];
  warnings: TakeoffWarning[];
};

function toCsvCell(value: string) {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, "\"\"")}"`;
}

function csvRowsToText(rows: string[][]) {
  return rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
}

function normalizeHeaderCell(value: unknown, index: number) {
  const raw =
    typeof value === "string"
      ? value.trim()
      : value === null || value === undefined
      ? ""
      : String(value).trim();

  if (raw.length === 0) {
    return `column_${index + 1}`;
  }

  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized.length > 0 ? normalized : `column_${index + 1}`;
}

function normalizeSheetCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value).trim();
}

function rowHasValues(row: string[]) {
  return row.some((cell) => cell.trim().length > 0);
}

function getColumnCount(matrix: unknown[][]) {
  return matrix.reduce((max, row) => {
    if (!Array.isArray(row)) return max;
    return Math.max(max, row.length);
  }, 0);
}

export function parseTakeoffWorkbook(input: {
  bytes: ArrayBuffer;
  fileName: string;
}): ParsedTakeoffWorkbook {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(input.bytes, {
      type: "array",
      raw: false,
      cellDates: false,
    });
  } catch (error) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Impossible de parser le fichier source takeoff.",
      details: error,
      retryable: false,
    });
  }

  const sheets: ParsedTakeoffSheet[] = [];
  const warnings: TakeoffWarning[] = [];

  workbook.SheetNames.forEach((sheetName, sheetIndex) => {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      warnings.push(
        warning({
          code: "SHEET_NOT_FOUND",
          message: `La feuille ${sheetName} est introuvable dans le classeur.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      raw: false,
      defval: null,
      blankrows: true,
    }) as unknown[][];

    if (matrix.length === 0) {
      warnings.push(
        warning({
          code: "SHEET_EMPTY",
          message: `La feuille ${sheetName} est vide et a été ignoree.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const columnCount = getColumnCount(matrix);
    if (columnCount === 0) {
      warnings.push(
        warning({
          code: "SHEET_NO_COLUMNS",
          message: `La feuille ${sheetName} ne contient aucune colonne exploitable.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const headerRowIndex = resolveHeaderRowIndex(matrix);
    const headerRow = Array.isArray(matrix[headerRowIndex])
      ? matrix[headerRowIndex]
      : [];
    const headers = dedupeHeaders(
      Array.from({ length: columnCount }, (_, index) =>
        normalizeHeaderCell(headerRow[index], index)
      )
    );
    const bodyRows = matrix.slice(headerRowIndex + 1);

    const rows = bodyRows
      .map((row) => {
        const values = Array.isArray(row) ? row : [];
        return Array.from({ length: columnCount }, (_, index) =>
          normalizeSheetCell(values[index])
        );
      })
      .filter((row) => rowHasValues(row));

    if (rows.length === 0) {
      warnings.push(
        warning({
          code: "SHEET_NO_DATA_ROWS",
          message: `La feuille ${sheetName} ne contient pas de données exploitables.`,
          severity: "warning",
          tableIndex: sheetIndex,
        })
      );
      return;
    }

    const csvText = csvRowsToText([headers, ...rows]);
    sheets.push({
      sheetName,
      headers,
      rows,
      csvText,
      headerRowIndex,
    });
  });

  if (sheets.length === 0) {
    throw new TakeoffError({
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: "Le fichier ne contient aucune feuille exploitable.",
      retryable: false,
    });
  }

  return { sheets, warnings };
}
