import * as XLSX from "xlsx";

import { resolveHeaderRowIndex } from "../lib/imports/header-row";

type ParsedImportScalar = string | number | boolean | null;
type ParsedImportRow = Record<string, ParsedImportScalar>;

type ParseWorkerRequest = {
  requestId: string;
  buffer: ArrayBuffer;
  headerRowNumber?: number | null;
};

type ParseWorkerSuccessResponse = {
  requestId: string;
  ok: true;
  rows: ParsedImportRow[];
};

type ParseWorkerErrorResponse = {
  requestId: string;
  ok: false;
  error: string;
};

type ParseWorkerResponse = ParseWorkerSuccessResponse | ParseWorkerErrorResponse;

function sanitizeHeader(value: string, index: number): string {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : `col_${index + 1}`;
}

function buildHeaders(rawHeaders: string[]): string[] {
  const collisions = new Map<string, number>();

  return rawHeaders.map((value, index) => {
    const base = sanitizeHeader(value, index);
    const nextCount = (collisions.get(base) ?? 0) + 1;
    collisions.set(base, nextCount);
    return nextCount === 1 ? base : `${base}_${nextCount}`;
  });
}

function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function rowHasValues(row: string[]): boolean {
  return row.some((cell) => cell.trim().length > 0);
}

function toImportRows(
  matrix: unknown[][],
  headerRowNumber?: number | null
): ParsedImportRow[] {
  if (matrix.length === 0) return [];

  const headerRowIndex = resolveHeaderRowIndex(matrix, { headerRowNumber });
  const rawHeaderRow = Array.isArray(matrix[headerRowIndex])
    ? matrix[headerRowIndex]
    : [];
  const headers = buildHeaders(rawHeaderRow.map((cell) => cellToString(cell)));

  const rows: ParsedImportRow[] = [];
  for (
    let sourceIndex = headerRowIndex + 1;
    sourceIndex < matrix.length;
    sourceIndex += 1
  ) {
    const sourceRow = Array.isArray(matrix[sourceIndex])
      ? matrix[sourceIndex].map((cell) => cellToString(cell))
      : [];
    if (!rowHasValues(sourceRow)) continue;

    const row: ParsedImportRow = {};
    const maxLength = Math.max(headers.length, sourceRow.length);

    for (let index = 0; index < maxLength; index += 1) {
      const key = headers[index] ?? `col_${index + 1}`;
      row[key] = sourceRow[index] ?? "";
    }

    const hasValues = Object.values(row).some(
      (value) => String(value ?? "").trim().length > 0
    );
    if (!hasValues) continue;

    rows.push(row);
  }

  return rows;
}

export function parseWorkbook(
  buffer: ArrayBuffer,
  headerRowNumber?: number | null
): ParsedImportRow[] {
  const workbook = XLSX.read(buffer, {
    type: "array",
    raw: false,
    cellDates: false,
  });

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const firstSheet = workbook.Sheets[firstSheetName];
  if (!firstSheet) return [];

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    defval: "",
    blankrows: true,
    raw: false,
  });

  return toImportRows(matrix as unknown[][], headerRowNumber);
}

function postResponse(response: ParseWorkerResponse) {
  self.postMessage(response);
}

if (typeof self !== "undefined") {
  self.onmessage = (event: MessageEvent<ParseWorkerRequest>) => {
    const payload = event.data;
    const requestId = payload?.requestId;

    if (!requestId || !(payload.buffer instanceof ArrayBuffer)) {
      postResponse({
        requestId: requestId ?? "unknown",
        ok: false,
        error: "Requete worker invalide.",
      });
      return;
    }

    try {
      const rows = parseWorkbook(payload.buffer, payload.headerRowNumber ?? null);
      postResponse({
        requestId,
        ok: true,
        rows,
      });
    } catch (error) {
      postResponse({
        requestId,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Le parsing XLSX a echoue dans le worker.",
      });
    }
  };
}
