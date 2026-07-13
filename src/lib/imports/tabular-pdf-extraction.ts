import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  TabularPdfDetectedRow,
  TabularPdfDetectedTable,
} from "@/lib/imports/tabular-pdf";

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

type PdfTextContent = {
  items: unknown[];
};

type PdfJsPage = {
  getTextContent(params?: {
    disableNormalization?: boolean;
  }): Promise<PdfTextContent>;
};

type PdfJsDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy(): Promise<void>;
};

type PdfJsLoadingTask = {
  promise: Promise<PdfJsDocument>;
  destroy(): void;
};

type PdfJsModule = {
  getDocument(input: {
    data: Uint8Array;
    disableWorker?: boolean;
    isEvalSupported?: boolean;
    standardFontDataUrl?: string;
    useWorkerFetch?: boolean;
  }): PdfJsLoadingTask;
};

type LayoutLine = {
  y: number;
  items: PdfTextItem[];
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
const execFileAsync = promisify(execFile);
const PDF_EXTRACTION_MAX_PAGES = 200;
const PDF_EXTRACTION_MAX_ITEMS_PER_PAGE = 20_000;
const PDF_EXTRACTION_MAX_TOTAL_ITEMS = 100_000;
const PDF_EXTRACTION_MAX_LAYOUT_BYTES = 5 * 1024 * 1024;
const PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS = 20_000;
const PDF_EXTRACTION_MAX_RAW_ITEM_CHARS = 20_000;
const PDF_EXTRACTION_TIMEOUT_MS = 15_000;

class PdfExtractionBudgetError extends Error {}

class PdfExtractionOutputBudget {
  private consumedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  reserveAscii(length: number) {
    this.reserveBytes(length);
  }

  reserveText(value: string) {
    this.reserveBytes(Buffer.byteLength(value, "utf8"));
  }

  private reserveBytes(length: number) {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.consumedBytes + length > this.maxBytes
    ) {
      throw budgetError("Le texte extrait du PDF depasse la limite autorisee.");
    }
    this.consumedBytes += length;
  }
}

function budgetError(message: string) {
  return new PdfExtractionBudgetError(message);
}

function assertWithinDeadline(deadline: number) {
  if (Date.now() >= deadline) {
    throw budgetError("Le delai maximal d'analyse PDF est depasse.");
  }
}

async function waitWithinDeadline<T>(
  promise: Promise<T>,
  deadline: number
): Promise<T> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw budgetError("Le delai maximal d'analyse PDF est depasse.");
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(budgetError("Le delai maximal d'analyse PDF est depasse.")),
          remainingMs
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
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

function asPdfTextItem(value: unknown): PdfTextItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<PdfTextItem>;
  if (
    typeof candidate.str !== "string" ||
    !Array.isArray(candidate.transform) ||
    typeof candidate.width !== "number" ||
    typeof candidate.height !== "number" ||
    typeof candidate.hasEOL !== "boolean"
  ) {
    return null;
  }

  if (candidate.str.length > PDF_EXTRACTION_MAX_RAW_ITEM_CHARS) {
    throw budgetError(
      "Un element texte du PDF depasse la taille maximale autorisee."
    );
  }

  const transform = candidate.transform.map((entry) => Number(entry));
  if (
    transform.length < 6 ||
    transform.some((entry) => !Number.isFinite(entry)) ||
    !Number.isFinite(candidate.width) ||
    !Number.isFinite(candidate.height)
  ) {
    return null;
  }

  return {
    str: candidate.str,
    transform,
    width: candidate.width,
    height: candidate.height,
    hasEOL: candidate.hasEOL,
  };
}

function median(values: number[]) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle] ?? null;
}

function estimateCharacterUnit(items: PdfTextItem[]) {
  const units = items
    .filter((item) => item.str.trim().length > 0 && item.width > 0)
    .map((item) => item.width / item.str.length)
    .filter((width) => Number.isFinite(width) && width > 0);

  const medianUnit = median(units);
  if (medianUnit === null) {
    return 4;
  }

  return Math.min(Math.max(medianUnit * 0.9, 2.5), 12);
}

function getItemX(item: PdfTextItem) {
  return Number(item.transform[4] ?? 0);
}

function getItemY(item: PdfTextItem) {
  return Number(item.transform[5] ?? 0);
}

function buildLayoutLines(items: PdfTextItem[]) {
  const sorted = [...items].sort((left, right) => {
    const deltaY = getItemY(right) - getItemY(left);
    if (Math.abs(deltaY) > 2) {
      return deltaY;
    }
    return getItemX(left) - getItemX(right);
  });

  const lines: LayoutLine[] = [];

  for (const item of sorted) {
    const itemY = getItemY(item);
    const existing = lines.at(-1);
    if (existing) {
      if (Math.abs(existing.y - itemY) <= 2) {
        existing.items.push(item);
        continue;
      }
    }

    lines.push({
      y: itemY,
      items: [item],
    });
  }

  return lines
    .sort((left, right) => right.y - left.y)
    .map((line) => ({
      ...line,
      items: line.items.sort((left, right) => getItemX(left) - getItemX(right)),
    }));
}

function renderLayoutLine(
  line: LayoutLine,
  outputBudget: PdfExtractionOutputBudget
) {
  const positionedItems = line.items.filter(
    (item) => item.str.length > 0 || item.hasEOL
  );
  if (positionedItems.length === 0) {
    return "";
  }

  const firstTextItem = positionedItems.find((item) => item.str.length > 0);
  if (!firstTextItem) {
    return "";
  }

  const charUnit = estimateCharacterUnit(positionedItems);
  const baseX = getItemX(firstTextItem);
  let renderedCursor = 0;
  let output = "";

  for (const item of positionedItems) {
    const targetColumn = Math.max(
      0,
      Math.round((getItemX(item) - baseX) / charUnit)
    );
    if (targetColumn > PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS) {
      throw budgetError("Une ligne du PDF depasse la largeur maximale autorisee.");
    }

    if (targetColumn > renderedCursor) {
      const gap = targetColumn - renderedCursor;
      if (output.length + gap > PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS) {
        throw budgetError("Une ligne du PDF depasse la largeur maximale autorisee.");
      }
      outputBudget.reserveAscii(gap);
      output += " ".repeat(gap);
      renderedCursor += gap;
    }

    const renderedSpan = item.width > 0
      ? Math.max(1, Math.round(item.width / charUnit))
      : Math.max(1, item.str.length);
    if (
      renderedSpan > PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS ||
      output.length + (item.str.trim().length === 0
        ? renderedSpan
        : item.str.length) > PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS
    ) {
      throw budgetError("Une ligne du PDF depasse la largeur maximale autorisee.");
    }

    if (item.str.trim().length === 0) {
      outputBudget.reserveAscii(renderedSpan);
      output += " ".repeat(renderedSpan);
    } else {
      outputBudget.reserveText(item.str);
      output += item.str;
    }

    renderedCursor = Math.max(renderedCursor, targetColumn + renderedSpan);
  }

  return output.trimEnd();
}

function estimateLineUnit(lines: LayoutLine[]) {
  const yGaps = lines
    .slice(1)
    .map((line, index) => lines[index].y - line.y)
    .filter((gap) => Number.isFinite(gap) && gap > 0);
  const medianGap = median(yGaps);
  if (medianGap !== null) {
    return Math.max(medianGap, 1);
  }

  const textHeights = lines
    .flatMap((line) => line.items)
    .map((item) => item.height)
    .filter((height) => Number.isFinite(height) && height > 0);
  const medianHeight = median(textHeights);
  if (medianHeight !== null) {
    return Math.max(medianHeight * 1.25, 1);
  }

  return 14;
}

function buildPageLayoutText(
  content: PdfTextContent,
  outputBudget = new PdfExtractionOutputBudget(PDF_EXTRACTION_MAX_LAYOUT_BYTES)
) {
  if (content.items.length > PDF_EXTRACTION_MAX_ITEMS_PER_PAGE) {
    throw budgetError(
      `Le PDF depasse ${PDF_EXTRACTION_MAX_ITEMS_PER_PAGE} elements texte sur une page.`
    );
  }

  const textItems = content.items
    .map(asPdfTextItem)
    .filter((item): item is PdfTextItem => item !== null);

  const layoutLines = buildLayoutLines(textItems);
  const lineUnit = estimateLineUnit(layoutLines);
  let pageOutput = "";

  layoutLines.forEach((line, index) => {
    const renderedLine = renderLayoutLine(line, outputBudget);
    pageOutput += renderedLine;
    const nextLine = layoutLines[index + 1];
    if (!nextLine) {
      return;
    }

    const yGap = line.y - nextLine.y;
    const blankLineCount = Math.max(
      0,
      Math.min(1, Math.round(yGap / lineUnit) - 1)
    );
    const separatorLength = 1 + blankLineCount;
    outputBudget.reserveAscii(separatorLength);
    pageOutput += "\n".repeat(separatorLength);
  });

  return pageOutput;
}

function getStandardFontDataUrl() {
  return `${join(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts"
  )}/`;
}

async function loadPdfJs() {
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }

  return pdfJsModulePromise;
}

async function extractLayoutTextFromPdfWithPdfJs(file: File) {
  const deadline = Date.now() + PDF_EXTRACTION_TIMEOUT_MS;
  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableWorker: true,
    isEvalSupported: false,
    standardFontDataUrl: getStandardFontDataUrl(),
    useWorkerFetch: false,
  });

  let document: PdfJsDocument | null = null;

  try {
    document = await waitWithinDeadline(loadingTask.promise, deadline);
    if (document.numPages > PDF_EXTRACTION_MAX_PAGES) {
      throw budgetError(
        `Le PDF depasse la limite de ${PDF_EXTRACTION_MAX_PAGES} pages.`
      );
    }

    let layoutText = "";
    let totalItemCount = 0;
    const outputBudget = new PdfExtractionOutputBudget(
      PDF_EXTRACTION_MAX_LAYOUT_BYTES
    );

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      assertWithinDeadline(deadline);
      const page = await waitWithinDeadline(document.getPage(pageNumber), deadline);
      const content = await waitWithinDeadline(
        page.getTextContent({
          disableNormalization: true,
        }),
        deadline
      );
      totalItemCount += content.items.length;
      if (totalItemCount > PDF_EXTRACTION_MAX_TOTAL_ITEMS) {
        throw budgetError(
          `Le PDF depasse la limite de ${PDF_EXTRACTION_MAX_TOTAL_ITEMS} elements texte.`
        );
      }

      if (pageNumber > 1) {
        outputBudget.reserveAscii(1);
        layoutText += "\f";
      }
      const pageText = buildPageLayoutText(content, outputBudget);
      layoutText += pageText;
    }

    return layoutText;
  } finally {
    if (document) {
      await document.destroy();
    } else {
      loadingTask.destroy();
    }
  }
}

type PdftotextRunner = (
  executable: string,
  args: string[],
  options: {
    encoding: "utf8";
    maxBuffer: number;
    timeout: number;
    windowsHide: true;
  }
) => Promise<{ stdout: string | Buffer }>;

const runPdftotext: PdftotextRunner = async (executable, args, options) => {
  const result = await execFileAsync(executable, args, options);
  return { stdout: result.stdout };
};

function isChildProcessOutputOverflow(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  );
}

async function extractLayoutTextFromPdfWithPdftotext(
  file: File,
  runner: PdftotextRunner = runPdftotext
) {
  const tempDir = await mkdtemp(join(tmpdir(), "timax-tabular-pdf-"));
  const pdfPath = join(tempDir, "input.pdf");

  try {
    await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
    let result: { stdout: string | Buffer };
    try {
      result = await runner(
        "pdftotext",
        [
        "-f",
        "1",
        "-l",
        String(PDF_EXTRACTION_MAX_PAGES),
        "-layout",
        "-enc",
        "UTF-8",
        pdfPath,
          "-",
        ],
        {
          encoding: "utf8",
          maxBuffer: PDF_EXTRACTION_MAX_LAYOUT_BYTES,
          timeout: PDF_EXTRACTION_TIMEOUT_MS,
          windowsHide: true,
        }
      );
    } catch (error) {
      if (isChildProcessOutputOverflow(error)) {
        throw budgetError("Le texte extrait du PDF depasse la limite autorisee.");
      }
      throw error;
    }

    const layoutText = typeof result.stdout === "string"
      ? result.stdout
      : result.stdout.toString("utf8");
    if (Buffer.byteLength(layoutText, "utf8") > PDF_EXTRACTION_MAX_LAYOUT_BYTES) {
      throw budgetError("Le texte extrait du PDF depasse la limite autorisee.");
    }
    return layoutText;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function extractLayoutTextFromPdf(file: File) {
  try {
    return await extractLayoutTextFromPdfWithPdfJs(file);
  } catch (pdfJsError) {
    if (pdfJsError instanceof PdfExtractionBudgetError) {
      throw pdfJsError;
    }

    try {
      return await extractLayoutTextFromPdfWithPdftotext(file);
    } catch (fallbackError) {
      if (fallbackError instanceof PdfExtractionBudgetError) {
        throw fallbackError;
      }
      throw pdfJsError;
    }
  }
}

export function detectTabularPdfTablesFromLayout(layoutText: string) {
  return splitLayoutPages(layoutText).flatMap((pageText, index) =>
    detectTablesOnPage(pageText, index + 1)
  );
}

export async function extractTabularPdfTablesFromFile(file: File) {
  try {
    const layoutText = await extractLayoutTextFromPdf(file);
    return detectTabularPdfTablesFromLayout(layoutText);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Extraction PDF tabulaire indisponible.";
    throw new Error(
      `Impossible d'analyser le PDF tabulaire. ${message}`
    );
  }
}

export const __testing__ = {
  buildPageLayoutText,
  extractLayoutTextFromPdfWithPdftotext,
  waitWithinDeadline,
  PDF_EXTRACTION_MAX_LAYOUT_BYTES,
  PDF_EXTRACTION_MAX_ITEMS_PER_PAGE,
  PDF_EXTRACTION_MAX_RAW_ITEM_CHARS,
  PDF_EXTRACTION_MAX_RENDERED_LINE_CHARS,
  PDF_EXTRACTION_TIMEOUT_MS,
};
