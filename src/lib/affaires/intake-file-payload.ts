import { validateXlsxArchiveBudget } from "@/lib/affaires/intake-office-archive";
export { SPREADSHEET_MAX_ARCHIVE_ENTRIES } from "@/lib/affaires/intake-office-archive";
import * as XLSX from "xlsx";
import { getAffaireIntakeFileExtension, isMimeTypeSupportedForAiClassification } from "@/lib/affaires/intake";
import type { GeminiStructuredFile } from "@/lib/takeoff/gemini-client";
import { readWordText, WordReadError, isWordFile } from "@/lib/affaires/intake-word-reader";

const TEXT_SNIPPET_MAX_LENGTH = 12_000;
const SPREADSHEET_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const SPREADSHEET_MAX_SHEETS = 32;
const SPREADSHEET_MAX_ROWS_PER_SHEET = 20;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

export function validateSpreadsheetBudget(fileName: string, bytes: ArrayBuffer) {
  if (bytes.byteLength > SPREADSHEET_MAX_INPUT_BYTES) {
    throw new Error("Le classeur depasse la taille maximale d'analyse de 10 Mo.");
  }

  const buffer = Buffer.from(bytes);
  const extension = getAffaireIntakeFileExtension(fileName);
  const isZipWorkbook =
    buffer.length >= 4 &&
    buffer.readUInt32LE(0) === ZIP_LOCAL_FILE_HEADER_SIGNATURE;
  if (extension === "xlsx" && !isZipWorkbook) {
    throw new Error("Archive XLSX invalide.");
  }
  if (isZipWorkbook) {
    validateXlsxArchiveBudget(buffer);
  }
}

export async function buildSpreadsheetSnippet(fileName: string, bytes: ArrayBuffer) {
  validateSpreadsheetBudget(fileName, bytes);
  const workbook = XLSX.read(Buffer.from(bytes), {
    type: "buffer",
    sheetRows: SPREADSHEET_MAX_ROWS_PER_SHEET,
  });
  if (workbook.SheetNames.length > SPREADSHEET_MAX_SHEETS) {
    throw new Error(`Le classeur depasse ${SPREADSHEET_MAX_SHEETS} feuilles.`);
  }
  const lines: string[] = [`Workbook: ${fileName}`];

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
      worksheet,
      {
        header: 1,
        blankrows: false,
      }
    );

    lines.push(`Sheet: ${sheetName}`);

    for (const row of rows.slice(0, 12)) {
      const normalizedRow = row
        .map((cell) =>
          cell === null || cell === undefined ? "" : String(cell).trim()
        )
        .filter((cell) => cell.length > 0)
        .join(" | ");

      if (normalizedRow.length > 0) {
        lines.push(normalizedRow);
      }
    }
  }

  return lines.join("\n").slice(0, TEXT_SNIPPET_MAX_LENGTH);
}

function buildTextFilePayload(text: string, mimeType = "text/plain"): GeminiStructuredFile | null {
  const snippet = text.trim().slice(0, TEXT_SNIPPET_MAX_LENGTH);
  if (snippet.length === 0) {
    return null;
  }

  return {
    data: Buffer.from(snippet, "utf8").toString("base64"),
    mimeType,
  };
}

export async function buildClassificationFilePayload(input: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<(GeminiStructuredFile & { issues?: string[] }) | null> {
  const normalizedMimeType = input.mimeType.trim().toLowerCase();
  const extension = getAffaireIntakeFileExtension(input.fileName);

  if (isWordFile(input.fileName, normalizedMimeType)) {
    const extracted = await readWordText(input.bytes);
    const file = buildTextFilePayload(extracted.text);
    if (!file) throw new WordReadError("WORD_EMPTY");
    return { ...file, issues: ["Analyse fondée sur le texte Word extrait ; les images et certaines zones de texte ne sont pas lues.",
      ...(extracted.truncated ? ["Analyse Word limitée aux 12 000 premiers caractères lisibles."] : [])] };
  }

  if (
    normalizedMimeType === "application/vnd.ms-excel" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === "xls" ||
    extension === "xlsx"
  ) {
    const snippet = await buildSpreadsheetSnippet(input.fileName, input.bytes);
    return buildTextFilePayload(snippet);
  }

  if (
    normalizedMimeType === "text/plain" ||
    normalizedMimeType === "text/csv" ||
    normalizedMimeType === "message/rfc822" ||
    extension === "txt" ||
    extension === "csv" ||
    extension === "eml"
  ) {
    const text = Buffer.from(input.bytes).toString("utf8");
    return buildTextFilePayload(
      text,
      normalizedMimeType === "text/csv" ? "text/csv" : "text/plain"
    );
  }

  if (isMimeTypeSupportedForAiClassification(normalizedMimeType)) {
    return {
      data: Buffer.from(input.bytes).toString("base64"),
      mimeType: normalizedMimeType,
    };
  }

  return null;
}
