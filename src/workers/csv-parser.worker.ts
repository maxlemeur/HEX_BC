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
  rowLineNumbers?: number[];
  detectedEncoding: CsvDetectedEncoding;
};

type ParseWorkerErrorResponse = {
  requestId: string;
  ok: false;
  error: string;
};

type ParseWorkerResponse = ParseWorkerSuccessResponse | ParseWorkerErrorResponse;

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"];
const REPLACEMENT_CHAR = "\uFFFD";

export type CsvDetectedEncoding = "utf-8" | "windows-1252";

function removeBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function sanitizeHeader(value: string, index: number): string {
  const normalized = removeBom(value).trim();
  return normalized.length > 0 ? normalized : `col_${index + 1}`;
}

function buildHeaders(rawHeaders: string[]): string[] {
  const collisionCount = new Map<string, number>();

  return rawHeaders.map((value, index) => {
    const base = sanitizeHeader(value, index);
    const nextCount = (collisionCount.get(base) ?? 0) + 1;
    collisionCount.set(base, nextCount);
    return nextCount === 1 ? base : `${base}_${nextCount}`;
  });
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim().length === 0);
}

function countDelimiterOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && character === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text: string): string {
  const firstDataLine =
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";

  let bestDelimiter = ",";
  let bestScore = -1;

  for (const delimiter of CANDIDATE_DELIMITERS) {
    const score = countDelimiterOutsideQuotes(firstDataLine, delimiter);
    if (score > bestScore) {
      bestDelimiter = delimiter;
      bestScore = score;
    }
  }

  return bestDelimiter;
}

function parseCsvMatrix(rawText: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const character = rawText[index];

    if (inQuotes) {
      if (character === "\"") {
        if (rawText[index + 1] === "\"") {
          currentCell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentCell += character;
      }
      continue;
    }

    if (character === "\"") {
      inQuotes = true;
      continue;
    }

    if (character === delimiter) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (character === "\n") {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    if (character === "\r") {
      continue;
    }

    currentCell += character;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);

  return rows;
}

function countReplacementChars(value: string): number {
  let count = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === REPLACEMENT_CHAR) {
      count += 1;
    }
  }

  return count;
}

export function decodeCsvBuffer(
  buffer: ArrayBuffer
): { text: string; detectedEncoding: CsvDetectedEncoding } {
  const utf8Text = new TextDecoder("utf-8").decode(buffer);
  const utf8ReplacementCount = countReplacementChars(utf8Text);

  if (utf8ReplacementCount === 0) {
    return {
      text: utf8Text,
      detectedEncoding: "utf-8",
    };
  }

  try {
    const cp1252Text = new TextDecoder("windows-1252").decode(buffer);
    const cp1252ReplacementCount = countReplacementChars(cp1252Text);

    if (cp1252ReplacementCount <= utf8ReplacementCount) {
      return {
        text: cp1252Text,
        detectedEncoding: "windows-1252",
      };
    }
  } catch {
    // Browser/runtime does not support windows-1252; keep UTF-8 fallback.
  }

  return {
    text: utf8Text,
    detectedEncoding: "utf-8",
  };
}

function toImportRows(
  matrix: string[][],
  headerRowNumber?: number | null
): { rows: ParsedImportRow[]; rowLineNumbers: number[] } {
  if (matrix.length === 0) {
    return {
      rows: [],
      rowLineNumbers: [],
    };
  }

  const headerIndex = resolveHeaderRowIndex(matrix, { headerRowNumber });
  const headers = buildHeaders(matrix[headerIndex] ?? []);
  const rows: ParsedImportRow[] = [];
  const rowLineNumbers: number[] = [];

  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const sourceRow = matrix[rowIndex] ?? [];
    if (isEmptyRow(sourceRow)) continue;

    const row: ParsedImportRow = {};
    const maxLength = Math.max(headers.length, sourceRow.length);

    for (let cellIndex = 0; cellIndex < maxLength; cellIndex += 1) {
      const key = headers[cellIndex] ?? `col_${cellIndex + 1}`;
      row[key] = (sourceRow[cellIndex] ?? "").trim();
    }

    const hasValues = Object.values(row).some(
      (value) => String(value ?? "").trim().length > 0
    );
    if (!hasValues) continue;

    rows.push(row);
    rowLineNumbers.push(rowIndex + 1);
  }

  return {
    rows,
    rowLineNumbers,
  };
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
      const { text, detectedEncoding } = decodeCsvBuffer(payload.buffer);
      const delimiter = detectDelimiter(text);
      const matrix = parseCsvMatrix(text, delimiter);
      const parsed = toImportRows(matrix, payload.headerRowNumber ?? null);

      postResponse({
        requestId,
        ok: true,
        rows: parsed.rows,
        rowLineNumbers: parsed.rowLineNumbers,
        detectedEncoding,
      });
    } catch (error) {
      postResponse({
        requestId,
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Le parsing CSV a echoue dans le worker.",
      });
    }
  };
}

export {};
