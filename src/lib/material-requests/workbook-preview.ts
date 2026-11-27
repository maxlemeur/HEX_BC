import { Worker } from "node:worker_threads";

import { zipSync } from "fflate";
import { utils, type CellObject, type WorkBook, type WorkSheet } from "xlsx";

import { readXlsxArchiveWithinBudget } from "@/lib/affaires/intake-office-archive";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input/parsers";
import { foldWords } from "@/lib/text/fold";

import {
  MATERIAL_REQUEST_MAX_LINES,
  MATERIAL_REQUEST_ORIGINAL_TEXT_MAX as ORIGINAL_TEXT_MAX,
  MATERIAL_REQUEST_QUANTITY_MAX,
  materialRequestLineInputSchema,
  type MaterialRequestLine,
} from "./contracts";
import {
  WORKBOOK_ROLES,
  WORKBOOK_ROLE_LABELS,
  detectWorkbookColumns,
  hasWrittenDoubt,
  isWorkbookHeaderRow,
  isWorkbookHeaderText,
  roundUpWorkbookQuantity,
  workbookColumnIndex,
  hasWorkbookDimensionParts,
  splitWorkbookDimension,
  workbookColumnLetter,
  workbookNumericReferenceText,
  workbookReferenceCode,
  type WorkbookMapping,
  type WorkbookRole,
} from "./workbook-mapping";
import {
  MATERIAL_REQUEST_WORKBOOK_FIRST_ROW_CELLS,
  MATERIAL_REQUEST_WORKBOOK_FIRST_ROWS,
  MATERIAL_REQUEST_WORKBOOK_HEADER_SCAN_ROWS as HEADER_SCAN_ROWS,
  type MaterialRequestWorkbookColumns,
  type MaterialRequestWorkbookPreview,
  type MaterialRequestWorkbookRow,
} from "./workbook-preview-contract";

/** Columns read from a sheet, from A: enough for any needs list, bounded for a sheet with stray far cells. */
const MAX_COLUMNS = 200;
/** The longest supplier name kept, as a supplier's own name column. */
const SUPPLIER_NAME_MAX = 255;
const EXAMPLE_SCAN_ROWS = 20;
const EXAMPLE_MAX_LENGTH = 60;
const PARSE_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_PREVIEWS = 2;
let activePreviews = 0;
const WORKER_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const xlsx = require("xlsx");
try {
  const workbook = xlsx.read(workerData.bytes, { type: "array", cellHTML: false, cellDates: true, cellNF: true, sheetStubs: true });
  parentPort.postMessage(workbook);
} catch {
  parentPort.postMessage(null);
}
`;

type Columns = Partial<Record<WorkbookRole, number>>;
type Cells = Map<number, CellObject>;

/** What a row of the request is compared on to say a workbook row is already there. */
export type MaterialRequestWorkbookExistingLine = Pick<MaterialRequestLine, "original_text" | "product_type" | "dimension" | "material" | "quantity" | "unit">;

export type MaterialRequestWorkbookPreviewOptions = {
  /** Exact sheet name; the first recognized sheet otherwise, else the first visible sheet. */
  sheet?: string;
  /** Excel number of the header row, chosen by hand; recognized automatically otherwise. */
  headerRow?: number;
  /** Split the dimension cell into dimension, precision and dropped doubts; kept whole otherwise. */
  splitDimension?: boolean;
  /** Explicit columns by role; automatic recognition otherwise. */
  mapping?: WorkbookMapping;
  /** The lines the request holds: a row matching one is proposed unticked. */
  existingLines?: readonly MaterialRequestWorkbookExistingLine[];
};

/** The preview before its supplier names are resolved against the company's suppliers. */
export type MaterialRequestWorkbookReading = Omit<MaterialRequestWorkbookPreview, "suppliers" | "supplier_rights">;

export class MaterialRequestWorkbookError extends Error {}
export class MaterialRequestWorkbookBusyError extends Error {}

function readWorkbook(bytes: Uint8Array, signal?: AbortSignal): Promise<WorkBook> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      // Next traces the dependency here because the worker source is evaluated as a string.
      workerData: { bytes, tracedModule: require.resolve("xlsx") },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
    });
    const fail = () => finish(null);
    const timer = setTimeout(fail, PARSE_TIMEOUT_MS);
    let settled = false;
    const finish = (workbook: WorkBook | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      void worker.terminate().then(() => {
        if (workbook) resolve(workbook);
        else reject(new Error("Excel parsing failed or exceeded its budget."));
      }, reject);
    };
    signal?.addEventListener("abort", fail, { once: true });
    worker.once("message", finish);
    worker.once("messageerror", fail);
    worker.once("error", fail);
    worker.once("exit", fail);
  });
}

/** The text of a cell; a formula is read through its cached value. */
function cellText(cell: CellObject | undefined) {
  if (typeof cell?.v === "string" && cell.t === "s") return cell.v.replace(/\s+/g, " ").trim();
  if (cell?.t === "n" && typeof cell.v === "number") return (cell.w ?? String(cell.v)).trim();
  return "";
}

/** Iterate stored cells instead of expanding Excel's declared rectangle, which can include formatted empty cells. */
function collectRows(sheet: WorkSheet, include: (row: number, column: number) => boolean) {
  const rows = new Map<number, Cells>();
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) continue;
    const { r, c } = utils.decode_cell(address);
    if (!include(r, c)) continue;
    const cell = sheet[address] as CellObject;
    if (!cell || cell.v === undefined && !cell.f) continue;
    const cells = rows.get(r) ?? new Map<number, CellObject>();
    cells.set(c, cell);
    rows.set(r, cells);
  }
  return [...rows].sort(([a], [b]) => a - b);
}

/** A reference cell: a stored whole number is read as its digits, unless its format pads it with zeros. */
function referenceText(cell: CellObject | undefined) {
  if (cell?.t === "n" && typeof cell.v === "number") {
    return workbookNumericReferenceText(cell.v, typeof cell.z === "string" ? cell.z : undefined, cell.w);
  }
  return cellText(cell);
}

function headersOf(cells: Cells) {
  return [...cells].map(([column, cell]) => ({ column, text: cellText(cell) })).filter(({ text }) => text);
}

function findHeader(sheet: WorkSheet) {
  for (const [row, cells] of collectRows(sheet, (r, c) => r < HEADER_SCAN_ROWS && c < MAX_COLUMNS)) {
    const headers = headersOf(cells);
    const columns = detectWorkbookColumns(headers);
    if (isWorkbookHeaderRow(columns)) return { row, headers, columns };
  }
  return null;
}

function hasCells(sheet: WorkSheet) {
  return Object.keys(sheet).some((address) => !address.startsWith("!"));
}

function shorten(text: string) {
  return text.length > EXAMPLE_MAX_LENGTH ? `${text.slice(0, EXAMPLE_MAX_LENGTH - 1)}…` : text;
}

const NO_COLUMNS: Columns = {};

function toLetters(columns: Columns): MaterialRequestWorkbookColumns {
  return Object.fromEntries(WORKBOOK_ROLES.map((role) => [role, columns[role] === undefined ? null : workbookColumnLetter(columns[role])])) as MaterialRequestWorkbookColumns;
}

function toIndexes(mapping: WorkbookMapping): Columns {
  return Object.fromEntries(Object.entries(mapping).flatMap(([role, letter]) => (letter ? [[role, workbookColumnIndex(letter)]] : [])));
}

/** The line field a schema refusal names, back to the role whose column holds it. */
const ROLE_OF_FIELD: Record<string, WorkbookRole> = {
  original_text: "designation", product_type: "designation", dimension: "dimension", unit: "unit",
  material: "material", reference: "reference", zone: "zone",
};

function existingKey(designation: string | null | undefined, dimension: string | null | undefined) {
  return `${foldWords(designation ?? "")}|${foldWords(dimension ?? "")}`;
}

function sameMaterial(left: string | null | undefined, right: string | null | undefined) {
  return !left || !right || foldWords(left) === foldWords(right);
}

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });

function tooLong(role: WorkbookRole, column: number, limit: number) {
  return `La cellule « ${WORKBOOK_ROLE_LABELS[role]} » (colonne ${workbookColumnLetter(column)}) dépasse ${limit} caractères. Raccourcissez-la dans le classeur. Ligne écartée.`;
}

export async function previewMaterialRequestWorkbook(
  bytes: Buffer,
  options: MaterialRequestWorkbookPreviewOptions = {},
  signal?: AbortSignal,
): Promise<MaterialRequestWorkbookReading> {
  if (activePreviews >= MAX_CONCURRENT_PREVIEWS) {
    throw new MaterialRequestWorkbookBusyError("La lecture d’autres classeurs est en cours. Rouvrez l’aperçu dans quelques instants.");
  }
  activePreviews += 1;
  try {
    return await buildPreview(bytes, options, signal);
  } finally {
    activePreviews -= 1;
  }
}

async function buildPreview(bytes: Buffer, options: MaterialRequestWorkbookPreviewOptions, signal?: AbortSignal): Promise<MaterialRequestWorkbookReading> {
  let workbook: WorkBook;
  try {
    // Repack the decoded parts so the worker cannot interpret a different set of archive headers.
    const archive = zipSync(readXlsxArchiveWithinBudget(bytes), { level: 0 });
    workbook = await readWorkbook(archive, signal);
  } catch {
    throw new MaterialRequestWorkbookError("Ce classeur Excel est illisible ou trop volumineux pour l’aperçu.");
  }

  const sheets = workbook.SheetNames.flatMap((name, index) => {
    const sheet = workbook.Sheets[name];
    return sheet && !workbook.Workbook?.Sheets?.[index]?.Hidden && hasCells(sheet) ? [{ name, sheet }] : [];
  });
  if (!sheets.length) throw new MaterialRequestWorkbookError("Ce classeur ne contient aucune feuille visible avec des cellules.");
  const table = options.sheet === undefined
    ? sheets.find(({ sheet }) => findHeader(sheet)) ?? sheets[0]
    : sheets.find(({ name }) => name === options.sheet);
  if (!table) throw new MaterialRequestWorkbookError("Cette feuille n’existe pas ou est masquée.");

  const scanned = collectRows(table.sheet, (r, c) => r < HEADER_SCAN_ROWS && c < MAX_COLUMNS);
  const nonEmptyRows = scanned.flatMap(([row, cells]) => {
    const texts = [...cells].sort(([a], [b]) => a - b).flatMap(([column, cell]) => {
      const text = cellText(cell);
      return text ? [{ column: workbookColumnLetter(column), text: shorten(text) }] : [];
    }).slice(0, MATERIAL_REQUEST_WORKBOOK_FIRST_ROW_CELLS);
    return texts.length ? [{ row_number: row + 1, cells: texts }] : [];
  });

  // The header row: the one chosen by hand, else the one recognized; without either, the user chooses it.
  const chosenRow = options.headerRow === undefined ? undefined : options.headerRow - 1;
  const header = chosenRow === undefined
    ? findHeader(table.sheet)
    : (() => {
      const headers = headersOf(scanned.find(([row]) => row === chosenRow)?.[1] ?? new Map());
      return { row: chosenRow, headers, columns: detectWorkbookColumns(headers) };
    })();

  // The rows offered as header: the first ones, and always the header row in use, even below them.
  let first_rows = nonEmptyRows.slice(0, MATERIAL_REQUEST_WORKBOOK_FIRST_ROWS);
  const headerEntry = header ? nonEmptyRows.find((entry) => entry.row_number === header.row + 1) : undefined;
  if (headerEntry && !first_rows.includes(headerEntry)) {
    first_rows = [...first_rows.slice(0, MATERIAL_REQUEST_WORKBOOK_FIRST_ROWS - 1), headerEntry];
  }

  const preview: MaterialRequestWorkbookReading = {
    sheet_name: table.name,
    sheet_names: sheets.map(({ name }) => name),
    header_row: header ? header.row + 1 : null,
    header_detected: header !== null && chosenRow === undefined,
    first_rows,
    columns: [],
    split_dimension: options.splitDimension === true,
    detected_columns: toLetters(header?.columns ?? NO_COLUMNS),
    mapped_columns: toLetters(NO_COLUMNS),
    rows: [],
    issues: [],
    omitted_rows: 0,
  };
  if (!header) return preview;

  const { row: headerRow, headers, columns: detected } = header;
  const columns = options.mapping ? toIndexes(options.mapping) : detected;
  preview.mapped_columns = toLetters(columns);

  // The columns to choose from: those with a header cell and those with values under the header row without one,
  // each with example values from the first data rows.
  const headerByColumn = new Map(headers.map(({ column, text }) => [column, text]));
  const examples = new Map<number, string[]>(headers.map(({ column }) => [column, []]));
  const withParts = new Set<number>();
  for (const [, cells] of collectRows(table.sheet, (r, c) => r > headerRow && r <= headerRow + EXAMPLE_SCAN_ROWS && c < MAX_COLUMNS)) {
    for (const [column, cell] of cells) {
      const text = cellText(cell);
      if (!text) continue;
      const list = examples.get(column) ?? [];
      examples.set(column, list);
      if (hasWorkbookDimensionParts(text)) withParts.add(column);
      if (list.length < 3) list.push(shorten(text));
    }
  }
  preview.columns = [...examples.keys()].sort((a, b) => a - b)
    .map((column) => ({ column: workbookColumnLetter(column), header: shorten(headerByColumn.get(column) ?? ""), examples: examples.get(column) ?? [],
      has_parts: withParts.has(column) }));
  if (columns.designation === undefined) return preview;
  const included = new Set(Object.values(columns));

  const existing = new Map<string, MaterialRequestWorkbookExistingLine[]>();
  for (const line of options.existingLines ?? []) {
    for (const designation of new Set([line.product_type, line.original_text].filter(Boolean))) {
      const key = existingKey(designation, line.dimension);
      existing.set(key, [...(existing.get(key) ?? []), line]);
    }
  }

  let seen = 0;
  for (const [row, cells] of collectRows(table.sheet, (r, c) => r > headerRow && included.has(c))) {
    const cell = (role: WorkbookRole) => columns[role] === undefined ? undefined : cells.get(columns[role]);
    const text = (role: WorkbookRole) => cellText(cell(role)) || undefined;
    if (![...cells.values()].some((entry) => cellText(entry) || entry.t === "e" || entry.f)) continue;
    const designation = text("designation");
    if (designation && isWorkbookHeaderText(designation, "designation") && WORKBOOK_ROLES.some((role) =>
      role !== "designation" && columns[role] !== undefined && isWorkbookHeaderText(cellText(cell(role)), role))) continue;
    if (designation && /^(?:sous )?total(?: general| ht| ttc)?$/u.test(foldWords(designation))) continue;

    if (++seen > MATERIAL_REQUEST_MAX_LINES) {
      preview.omitted_rows += 1;
      continue;
    }
    const row_number = row + 1;
    if (!designation) {
      preview.issues.push({ row_number, message: "Désignation manquante ou illisible. Ligne écartée." });
      continue;
    }
    const quantityCell = cell("quantity");
    const rounding = roundUpWorkbookQuantity(
      quantityCell?.t === "n" || quantityCell?.t === "s" ? parseDecimalInput(quantityCell.v) : null,
    );
    // A quantity past the ceiling of a line is imported without quantity, and the row says so with the limit.
    const tooLarge = rounding.quantity !== null && rounding.quantity > MATERIAL_REQUEST_QUANTITY_MAX ? rounding.quantity : null;
    const { quantity, roundedFrom } = tooLarge === null ? rounding : { quantity: null, roundedFrom: null };
    const supplierName = text("supplier");
    if (supplierName && supplierName.length > SUPPLIER_NAME_MAX && columns.supplier !== undefined) {
      preview.issues.push({ row_number, message: tooLong("supplier", columns.supplier, SUPPLIER_NAME_MAX) });
      continue;
    }
    const writtenReference = referenceText(cell("reference")) || undefined;
    const reference = workbookReferenceCode(writtenReference);
    // The dimension cell, split when asked: first part the dimension, the rest the precision, doubts dropped. The
    // untouched cell then follows the designation in the original text, when both fit its limit.
    const dimensionCell = text("dimension");
    const split = options.splitDimension && dimensionCell ? splitWorkbookDimension(dimensionCell) : null;
    const reshaped = split !== null && (split.precision !== null || split.dropped.length > 0);
    const withCell = reshaped ? `${designation} ${dimensionCell}` : designation;
    const line = materialRequestLineInputSchema.safeParse({
      original_text: withCell.length <= ORIGINAL_TEXT_MAX ? withCell : designation,
      product_type: designation,
      quantity: quantity ?? undefined,
      unit: text("unit"),
      dimension: split ? split.dimension ?? undefined : dimensionCell,
      material_precision: split?.precision ?? undefined,
      reference: reference ?? undefined,
      material: text("material"),
      zone: text("zone"),
    });
    if (!line.success) {
      const precisionIssue = line.error.issues.find((issue) => issue.path[0] === "material_precision" && issue.code === "too_big");
      if (precisionIssue?.code === "too_big" && columns.dimension !== undefined) {
        preview.issues.push({
          row_number,
          message: `La précision tirée de la cellule « Dimension » (colonne ${workbookColumnLetter(columns.dimension)}) dépasse ${Number(precisionIssue.maximum)} caractères. Raccourcissez-la dans le classeur. Ligne écartée.`,
        });
        continue;
      }
      const tooBig = line.error.issues.flatMap((issue) => {
        const role = ROLE_OF_FIELD[String(issue.path[0])];
        return issue.code === "too_big" && role ? [{ role, limit: Number(issue.maximum) }] : [];
      });
      const role = tooBig[0]?.role;
      // A column can feed two fields (the designation: original text and type): the smallest limit is the one to meet.
      const limit = Math.min(...tooBig.filter((entry) => entry.role === role).map((entry) => entry.limit));
      const column = role === undefined ? undefined : columns[role];
      preview.issues.push({
        row_number,
        message: role && column !== undefined && Number.isFinite(limit)
          ? tooLong(role, column, limit)
          : "Une cellule de cette ligne est illisible. Ligne écartée.",
      });
      continue;
    }

    const remarks: MaterialRequestWorkbookRow["remarks"] = [];
    let selected = true;
    if (roundedFrom !== null) remarks.push({ code: "rounded", message: `Arrondi de ${formatDecimalInput(roundedFrom)}` });
    if (tooLarge !== null) {
      remarks.push({
        code: "quantity_too_large",
        message: `Quantité ${quantityFormat.format(tooLarge)} au-delà de la limite de ${quantityFormat.format(MATERIAL_REQUEST_QUANTITY_MAX)} : importée sans quantité`,
      });
      selected = false;
    } else if (quantity === null) {
      remarks.push({ code: "no_quantity", message: "Sans quantité" });
      selected = false;
    }
    if (writtenReference && !reference) remarks.push({ code: "reference_dropped", message: "Référence écartée" });
    if (split?.dropped.length) remarks.push({ code: "dimension_part_dropped", message: `Écarté : ${split.dropped.join(" ; ")}` });
    if (hasWrittenDoubt(line.data.product_type, line.data.dimension)) {
      remarks.push({ code: "written_doubt", message: "Doute écrit dans le libellé, à retirer" });
    }
    const twin = existing.get(existingKey(designation, line.data.dimension))?.find((entry) => sameMaterial(entry.material, line.data.material));
    if (twin) {
      const held = twin.quantity === null ? "aucune" : `${quantityFormat.format(twin.quantity)}${twin.unit ? ` ${twin.unit}` : ""}`;
      remarks.push({
        code: "already_present",
        message: twin.quantity === quantity ? "Déjà présente dans la demande" : `Déjà présente dans la demande (quantité existante : ${held})`,
      });
      selected = false;
    }
    preview.rows.push({ row_number, line: line.data, supplier_name: supplierName ?? null, selected, remarks });
  }
  return preview;
}
