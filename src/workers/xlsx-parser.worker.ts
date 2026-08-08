import { Workbook } from "exceljs";
import * as XLSX from "xlsx";

import { resolveHeaderRowIndex } from "../lib/imports/header-row";
import { attachImportRowStructure } from "../lib/imports/payload";
import { selectDpgfSheetIndex } from "../lib/imports/sheet-selection";
import {
  buildHeaders,
  hasNonReservedValue,
  normalizeCellValue,
  type NormalizedImportRow,
} from "../lib/imports/tabular-normalization";

type ParsedImportRow = NormalizedImportRow;

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

type ParsedWorkbookRowStyle = {
  sourceRowNumber: number;
  boldColumnIndexes: number[];
  mergedColumnIndexes: number[];
  outlineLevel: number | null;
};

async function extractRowStyles(
  buffer: ArrayBuffer,
  sheetName: string,
  matrix: unknown[][]
): Promise<ParsedWorkbookRowStyle[]> {
  const fallback = Array.from({ length: matrix.length }, (_, index) => ({
    sourceRowNumber: index + 1,
    boldColumnIndexes: [],
    mergedColumnIndexes: [],
    outlineLevel: null,
  }));

  try {
    const styleWorkbook = new Workbook();
    await styleWorkbook.xlsx.load(buffer as never);
    const styleSheet =
      styleWorkbook.getWorksheet(sheetName) ?? styleWorkbook.worksheets[0];
    if (!styleSheet) return fallback;

    return fallback.map((entry, rowIndex) => {
      const styleRow = styleSheet.getRow(rowIndex + 1);
      const matrixRow = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];
      const columnCount = Math.max(matrixRow.length, styleSheet.columnCount);
      const boldColumnIndexes: number[] = [];
      const mergedColumnIndexes: number[] = [];

      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const cell = styleRow.getCell(columnIndex + 1);
        if (cell.font?.bold === true) boldColumnIndexes.push(columnIndex);
        if (cell.isMerged) mergedColumnIndexes.push(columnIndex);
      }

      const outlineLevel = styleRow.outlineLevel;
      return {
        sourceRowNumber: entry.sourceRowNumber,
        boldColumnIndexes,
        mergedColumnIndexes,
        outlineLevel:
          typeof outlineLevel === "number" && Number.isInteger(outlineLevel) && outlineLevel > 0
            ? outlineLevel
            : null,
      };
    });
  } catch {
    return fallback;
  }
}

function toImportRows(
  matrix: unknown[][],
  sheetName: string,
  rowStyles: ParsedWorkbookRowStyle[],
  headerRowNumber?: number | null
): ParsedImportRow[] {
  if (matrix.length === 0) return [];

  const columnCount = matrix.reduce(
    (max, row) => Math.max(max, Array.isArray(row) ? row.length : 0),
    0
  );
  const headerRowIndex = resolveHeaderRowIndex(matrix, { headerRowNumber });
  const rawHeaderRow = Array.isArray(matrix[headerRowIndex])
    ? matrix[headerRowIndex]
    : [];
  const headers = buildHeaders(rawHeaderRow, columnCount);

  const rows: ParsedImportRow[] = [];
  for (
    let sourceIndex = headerRowIndex + 1;
    sourceIndex < matrix.length;
    sourceIndex += 1
  ) {
    const sourceRow = Array.isArray(matrix[sourceIndex]) ? matrix[sourceIndex] : [];
    const row: ParsedImportRow = {};

    headers.forEach((header, columnIndex) => {
      row[header] = normalizeCellValue(sourceRow[columnIndex]);
    });

    if (!hasNonReservedValue(row)) continue;

    const rowStyle = rowStyles[sourceIndex];
    rows.push(
      attachImportRowStructure(row, {
        sheet_name: sheetName,
        source_row_number: rowStyle?.sourceRowNumber ?? sourceIndex + 1,
        bold_columns: (rowStyle?.boldColumnIndexes ?? []).flatMap(
          (index) => headers[index] ?? []
        ),
        merged_columns: (rowStyle?.mergedColumnIndexes ?? []).flatMap(
          (index) => headers[index] ?? []
        ),
        outline_level: rowStyle?.outlineLevel ?? null,
        column_order: headers,
      })
    );
  }

  return rows;
}

export async function parseWorkbook(
  buffer: ArrayBuffer,
  headerRowNumber?: number | null
): Promise<ParsedImportRow[]> {
  const workbook = XLSX.read(buffer, {
    type: "array",
    raw: true,
    cellDates: false,
  });

  const sheetMatrices = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];

    return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: true,
      raw: true,
    }) as unknown[][];
  });
  const selectedSheetIndex = selectDpgfSheetIndex(
    workbook.SheetNames,
    sheetMatrices
  );
  const selectedSheetName = workbook.SheetNames[selectedSheetIndex];
  const matrix = sheetMatrices[selectedSheetIndex];
  if (!selectedSheetName || !matrix) return [];

  const rowStyles = await extractRowStyles(buffer, selectedSheetName, matrix);

  return toImportRows(matrix, selectedSheetName, rowStyles, headerRowNumber);
}

function postResponse(response: ParseWorkerResponse) {
  self.postMessage(response);
}

if (typeof self !== "undefined") {
  self.onmessage = async (event: MessageEvent<ParseWorkerRequest>) => {
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
      const rows = await parseWorkbook(payload.buffer, payload.headerRowNumber ?? null);
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
