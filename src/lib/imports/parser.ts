import * as XLSX from "xlsx";

import { resolveHeaderRowIndex } from "./header-row";

export type ImportSourceFormat = "json" | "csv" | "xlsx";
export type SimpleJsonValue = string | number | boolean | null;
export type NormalizedImportRow = Record<string, SimpleJsonValue>;

export type ParsedImportFile = {
  sourceFormat: "csv" | "xlsx";
  headers: string[];
  rows: NormalizedImportRow[];
};

export type ParseImportFileOptions = {
  headerRowNumber?: number | null;
};

type ParseWorkbookResult = {
  sheetName: string | null;
  matrix: unknown[][];
};

type ParseWorkbookRunner = (
  fileBytes: ArrayBuffer,
  signal: AbortSignal
) => Promise<ParseWorkbookResult>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  return Object.prototype.toString.call(value) === "[object Object]";
}

function stripAccents(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeOptimaHeader(raw: string): string | null {
  const normalized = stripAccents(raw.toLowerCase()).replace(/[^a-z0-9]+/g, " ");
  const words = normalized.split(" ").filter(Boolean);
  const wordSet = new Set(words);
  const hasWordPrefix = (prefix: string) => words.some((word) => word.startsWith(prefix));

  if (
    (wordSet.has("type") && wordSet.has("fo")) ||
    (wordSet.has("famille") && wordSet.has("fo"))
  ) {
    return "Type_FO";
  }

  if (
    (wordSet.has("majoration") && wordSet.has("mo")) ||
    (wordSet.has("temps") && hasWordPrefix("major"))
  ) {
    return "Majoration_MO";
  }

  return null;
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

  const optimaHeader = normalizeOptimaHeader(raw);
  if (optimaHeader) {
    return optimaHeader;
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

// K-02: Parse timeout (30s) to prevent malicious files from blocking the server
const PARSE_TIMEOUT_MS = 30_000;
const WORKER_PARSE_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require("xlsx");

try {
  const workbook = XLSX.read(workerData.fileBytes, {
    type: "buffer",
    raw: true,
    cellDates: false,
  });
  const sheetName = workbook.SheetNames[0] ?? null;
  let matrix = [];

  if (sheetName) {
    const sheet = workbook.Sheets[sheetName];
    matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
  }

  parentPort.postMessage({ ok: true, sheetName, matrix });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error:
      error && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : "Impossible de parser le fichier.",
  });
}
`;

function buildParseTimeoutError(timeoutMs: number) {
  const timeoutSeconds = Math.max(1, Math.round(timeoutMs / 1000));
  return new Error(
    `Delai de traitement depasse (${timeoutSeconds}s). Le fichier est peut-etre trop volumineux ou corrompu.`
  );
}

async function runWorkbookParseInWorker(
  fileBytes: ArrayBuffer,
  signal: AbortSignal
): Promise<ParseWorkbookResult> {
  const { Worker } = await import("node:worker_threads");

  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PARSE_SCRIPT, {
      eval: true,
      workerData: {
        fileBytes: Buffer.from(fileBytes),
      },
    });

    let settled = false;

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      void worker.terminate();
      callback();
    };

    const onAbort = () => {
      settle(() => {
        reject(new Error("Parsing interrompu."));
      });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    worker.once("message", (message: unknown) => {
      settle(() => {
        if (!message || typeof message !== "object") {
          reject(new Error("Reponse de parsing invalide."));
          return;
        }

        const record = message as Record<string, unknown>;
        if (record.ok !== true) {
          const errorMessage =
            typeof record.error === "string" && record.error.trim().length > 0
              ? record.error
              : "Impossible de parser le fichier.";
          reject(new Error(errorMessage));
          return;
        }

        const matrix = Array.isArray(record.matrix) ? (record.matrix as unknown[][]) : [];
        const sheetName =
          typeof record.sheetName === "string" && record.sheetName.trim().length > 0
            ? record.sheetName
            : null;

        resolve({
          sheetName,
          matrix,
        });
      });
    });

    worker.once("error", (error: Error) => {
      settle(() => {
        reject(error);
      });
    });

    worker.once("exit", (code) => {
      if (settled || code === 0) return;
      settle(() => {
        reject(new Error(`Le worker de parsing s'est arrete avec le code ${code}.`));
      });
    });
  });
}

export async function parseWorkbookMatrixWithTimeout(
  fileBytes: ArrayBuffer,
  timeoutMs = PARSE_TIMEOUT_MS,
  runParse: ParseWorkbookRunner = runWorkbookParseInWorker
): Promise<ParseWorkbookResult> {
  const effectiveTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : PARSE_TIMEOUT_MS;
  const abortController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      abortController.abort();
      reject(buildParseTimeoutError(effectiveTimeoutMs));
    }, effectiveTimeoutMs);
  });

  try {
    return await Promise.race([
      runParse(fileBytes, abortController.signal),
      timeoutPromise,
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function parseImportFile(
  file: File,
  options?: ParseImportFileOptions
): Promise<ParsedImportFile> {
  const sourceFormat = detectImportSourceFormat(file.name, file.type);
  const fileBytes = await file.arrayBuffer();

  if (fileBytes.byteLength === 0) {
    throw new Error("Le fichier est vide.");
  }

  const { sheetName, matrix } = await parseWorkbookMatrixWithTimeout(fileBytes);
  if (!sheetName) {
    return {
      sourceFormat,
      headers: [],
      rows: [],
    };
  }

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

  const headerRowIndex = resolveHeaderRowIndex(matrix, {
    headerRowNumber: options?.headerRowNumber ?? null,
  });
  const headerRow = Array.isArray(matrix[headerRowIndex])
    ? matrix[headerRowIndex]
    : [];
  const headers = buildHeaders(headerRow, columnCount);
  const bodyRows = matrix.slice(headerRowIndex + 1);

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
