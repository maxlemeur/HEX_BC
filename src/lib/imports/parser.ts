import { resolveHeaderRowIndex } from "./header-row";
import { attachImportRowStructure } from "./payload";
import { selectDpgfSheetIndex } from "./sheet-selection";
import {
  hasNonReservedValue,
  normalizeRowObject as normalizeTabularRowObject,
  type NormalizedImportRow,
  type SimpleJsonValue,
} from "./tabular-normalization";

export type ImportSourceFormat = "json" | "csv" | "xlsx";
export type { ImportJsonValue, NormalizedImportRow, SimpleJsonValue } from "./tabular-normalization";

export type ParsedImportFile = {
  sourceFormat: "csv" | "xlsx";
  headers: string[];
  rows: NormalizedImportRow[];
};

export type ParseImportFileOptions = {
  headerRowNumber?: number | null;
};

type ParsedWorkbookRowStyle = {
  source_row_number: number;
  bold_column_indexes: number[];
  merged_column_indexes: number[];
  outline_level: number | null;
};

type ParseWorkbookResult = {
  sheetName: string | null;
  matrix: unknown[][];
  rowStyles: ParsedWorkbookRowStyle[];
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

  const sanitized = stripAccents(raw)
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
  return normalizeTabularRowObject(row);
}

function hasNonNullValue(row: NormalizedImportRow) {
  return hasNonReservedValue(row);
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
const DPGF_SHEET_SELECTOR_SOURCE = selectDpgfSheetIndex.toString();
const WORKER_PARSE_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require("xlsx");
const __name = (target) => target;
const selectDpgfSheetIndex = (${DPGF_SHEET_SELECTOR_SOURCE});

(async () => {
  try {
    const fileBuffer = Buffer.from(workerData.fileBytes);
    const workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      raw: true,
      cellDates: false,
    });
    const sheetMatrices = workbook.SheetNames.map((candidateSheetName) => {
      const candidateSheet = workbook.Sheets[candidateSheetName];
      if (!candidateSheet) return [];

      return XLSX.utils.sheet_to_json(candidateSheet, {
        header: 1,
        raw: true,
        defval: null,
        blankrows: true,
      });
    });
    const selectedSheetIndex = selectDpgfSheetIndex(
      workbook.SheetNames,
      sheetMatrices
    );
    const sheetName = workbook.SheetNames[selectedSheetIndex] ?? null;
    const matrix = selectedSheetIndex >= 0 ? sheetMatrices[selectedSheetIndex] ?? [] : [];

    const rowStyles = Array.from({ length: matrix.length }, (_, index) => ({
      source_row_number: index + 1,
      bold_column_indexes: [],
      merged_column_indexes: [],
      outline_level: null,
    }));

    if (sheetName) {
      try {
        const ExcelJS = require("exceljs");
        const styleWorkbook = new ExcelJS.Workbook();
        await styleWorkbook.xlsx.load(fileBuffer);
        const styleSheet =
          styleWorkbook.getWorksheet(sheetName) ?? styleWorkbook.worksheets[0];

        if (styleSheet) {
          for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
            const styleRow = styleSheet.getRow(rowIndex + 1);
            const matrixRow = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
            const columnCount = Math.max(matrixRow.length, styleSheet.columnCount);
            const boldColumnIndexes = [];
            const mergedColumnIndexes = [];

            for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
              const cell = styleRow.getCell(columnIndex + 1);
              if (cell.font && cell.font.bold === true) boldColumnIndexes.push(columnIndex);
              if (cell.isMerged === true) mergedColumnIndexes.push(columnIndex);
            }

            rowStyles[rowIndex] = {
              source_row_number: rowIndex + 1,
              bold_column_indexes: boldColumnIndexes,
              merged_column_indexes: mergedColumnIndexes,
              outline_level:
                Number.isInteger(styleRow.outlineLevel) && styleRow.outlineLevel > 0
                  ? styleRow.outlineLevel
                  : null,
            };
          }
        }
      } catch {
        // Legacy XLS files still use the value parser without style metadata.
      }
    }

    parentPort.postMessage({ ok: true, sheetName, matrix, rowStyles });
  } catch (error) {
    parentPort.postMessage({
      ok: false,
      error:
        error && typeof error === "object" && typeof error.message === "string"
          ? error.message
          : "Impossible de parser le fichier.",
    });
  }
})();
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
        const rawRowStyles = Array.isArray(record.rowStyles) ? record.rowStyles : [];
        const rowStyles = Array.from({ length: matrix.length }, (_, index) => {
          const rawStyle = isPlainObject(rawRowStyles[index]) ? rawRowStyles[index] : null;
          const normalizeIndexes = (value: unknown) =>
            Array.isArray(value)
              ? value.flatMap((entry) => {
                  const parsed = Number(entry);
                  return Number.isInteger(parsed) && parsed >= 0 ? [parsed] : [];
                })
              : [];
          const sourceRowNumber = Number(rawStyle?.source_row_number);
          const outlineLevel = Number(rawStyle?.outline_level);

          return {
            source_row_number:
              Number.isInteger(sourceRowNumber) && sourceRowNumber > 0
                ? sourceRowNumber
                : index + 1,
            bold_column_indexes: normalizeIndexes(rawStyle?.bold_column_indexes),
            merged_column_indexes: normalizeIndexes(rawStyle?.merged_column_indexes),
            outline_level:
              Number.isInteger(outlineLevel) && outlineLevel > 0
                ? outlineLevel
                : null,
          } satisfies ParsedWorkbookRowStyle;
        });
        const sheetName =
          typeof record.sheetName === "string" && record.sheetName.trim().length > 0
            ? record.sheetName
            : null;

        resolve({
          sheetName,
          matrix,
          rowStyles,
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

  const { sheetName, matrix, rowStyles } = await parseWorkbookMatrixWithTimeout(fileBytes);
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
  for (let bodyIndex = 0; bodyIndex < bodyRows.length; bodyIndex += 1) {
    const row = bodyRows[bodyIndex];
    const values = Array.isArray(row) ? row : [];
    const normalizedRow: NormalizedImportRow = {};

    headers.forEach((header, index) => {
      normalizedRow[header] = normalizeCellValue(values[index]);
    });

    if (!hasNonNullValue(normalizedRow)) continue;

    const sourceMatrixIndex = headerRowIndex + bodyIndex + 1;
    const rowStyle = rowStyles[sourceMatrixIndex];
    const structure =
      sourceFormat === "xlsx"
        ? {
            sheet_name: sheetName,
            source_row_number: rowStyle?.source_row_number ?? sourceMatrixIndex + 1,
            bold_columns: (rowStyle?.bold_column_indexes ?? []).flatMap(
              (index) => headers[index] ?? []
            ),
            merged_columns: (rowStyle?.merged_column_indexes ?? []).flatMap(
              (index) => headers[index] ?? []
            ),
            outline_level: rowStyle?.outline_level ?? null,
            column_order: headers,
          }
        : null;

    rows.push(attachImportRowStructure(normalizedRow, structure));
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
