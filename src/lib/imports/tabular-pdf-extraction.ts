import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  TabularPdfDetectedRow,
  TabularPdfDetectedTable,
} from "@/lib/imports/tabular-pdf";

const execFileAsync = promisify(execFile);
const PDFTOTEXT_MAX_BUFFER_BYTES = 16 * 1024 * 1024;

function sanitizeTempFileName(fileName: string) {
  return fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function splitLayoutPages(layoutText: string) {
  return layoutText
    .split("\f")
    .map((page) => page.replace(/\r/g, "").replace(/\s+$/u, ""))
    .filter((page) => page.trim().length > 0);
}

function splitColumns(rawLine: string) {
  const line = rawLine.trim();
  if (line.length === 0) {
    return [];
  }

  const pipeColumns = line
    .split("|")
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
  if (pipeColumns.length >= 2) {
    return pipeColumns;
  }

  return line
    .split(/\s{2,}/)
    .map((column) => column.trim())
    .filter((column) => column.length > 0);
}

function isLikelyTabularLine(rawLine: string) {
  return splitColumns(rawLine).length >= 2;
}

function toDetectedRows(lines: string[]): TabularPdfDetectedRow[] {
  return lines.map((line, rowIndex) => ({
    row_index: rowIndex,
    cells: splitColumns(line),
  }));
}

function buildDetectedTable(input: {
  pageNumber: number;
  tableIndex: number;
  title: string | null;
  lines: string[];
}): TabularPdfDetectedTable | null {
  if (input.lines.length < 2) {
    return null;
  }

  const rows = toDetectedRows(input.lines);
  const headerRow = rows[0];
  const dataRows = rows
    .slice(1)
    .filter((row) => row.cells.some((cell) => cell.trim().length > 0))
    .map((row, index) => ({
      ...row,
      row_index: index,
    }));

  if (!headerRow || headerRow.cells.length < 2 || dataRows.length === 0) {
    return null;
  }

  return {
    source_page: input.pageNumber,
    table_index: input.tableIndex,
    title: input.title,
    headers: headerRow.cells,
    rows: dataRows,
  };
}

function detectTablesOnPage(pageText: string, pageNumber: number) {
  const lines = pageText
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .filter((line, index, source) => !(line.trim().length === 0 && source[index - 1]?.trim().length === 0));

  const detectedTables: TabularPdfDetectedTable[] = [];
  let currentLines: string[] = [];
  let lastNonEmptyLine: string | null = null;

  const flush = () => {
    if (currentLines.length === 0) {
      return;
    }

    const titleCandidate =
      lastNonEmptyLine && !isLikelyTabularLine(lastNonEmptyLine)
        ? lastNonEmptyLine.trim()
        : null;
    const nextTable = buildDetectedTable({
      pageNumber,
      tableIndex: detectedTables.length,
      title: titleCandidate,
      lines: currentLines,
    });
    if (nextTable) {
      detectedTables.push(nextTable);
    }
    currentLines = [];
  };

  for (const line of lines) {
    if (isLikelyTabularLine(line)) {
      currentLines.push(line);
      continue;
    }

    flush();
    if (line.trim().length > 0) {
      lastNonEmptyLine = line;
    }
  }

  flush();

  return detectedTables;
}

export function detectTabularPdfTablesFromLayout(layoutText: string) {
  return splitLayoutPages(layoutText).flatMap((pageText, index) =>
    detectTablesOnPage(pageText, index + 1)
  );
}

export async function extractTabularPdfTablesFromFile(file: File) {
  const tempDirectory = await mkdtemp(join(tmpdir(), "timax-tabular-pdf-"));
  const tempFilePath = join(
    tempDirectory,
    sanitizeTempFileName(file.name.trim() || "import.pdf")
  );

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(tempFilePath, buffer);

    const { stdout } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", tempFilePath, "-"],
      { maxBuffer: PDFTOTEXT_MAX_BUFFER_BYTES }
    );

    return detectTabularPdfTablesFromLayout(stdout);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Extraction PDF tabulaire indisponible.";
    throw new Error(
      `Impossible d'analyser le PDF tabulaire. ${message}`
    );
  } finally {
    await rm(tempDirectory, { force: true, recursive: true });
  }
}
