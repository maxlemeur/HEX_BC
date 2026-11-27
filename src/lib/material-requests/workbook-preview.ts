import { Worker } from "node:worker_threads";

import { zipSync } from "fflate";
import { utils, type CellObject, type WorkBook, type WorkSheet } from "xlsx";

import { readXlsxArchiveWithinBudget } from "@/lib/affaires/intake-office-archive";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input/parsers";
import { foldWords } from "@/lib/text/fold";

import { MATERIAL_REQUEST_MAX_LINES, materialRequestLineInputSchema, type MaterialRequestLine } from "./contracts";
import {
  WORKBOOK_ROLES,
  WORKBOOK_ROLE_LABELS,
  detectWorkbookColumns,
  hasWrittenDoubt,
  isWorkbookHeaderRow,
  isWorkbookHeaderText,
  roundUpWorkbookQuantity,
  workbookColumnIndex,
  workbookColumnLetter,
  workbookReferenceCode,
  type WorkbookMapping,
  type WorkbookRole,
} from "./workbook-mapping";
import type { MaterialRequestWorkbookColumns, MaterialRequestWorkbookPreview, MaterialRequestWorkbookRow } from "./workbook-preview-contract";

const HEADER_SCAN_ROWS = 50;
const EXAMPLE_SCAN_ROWS = 20;
const EXAMPLE_MAX_LENGTH = 60;
const PARSE_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_PREVIEWS = 2;
let activePreviews = 0;
const WORKER_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");
const xlsx = require("xlsx");
try {
  const workbook = xlsx.read(workerData.bytes, { type: "array", cellHTML: false, cellDates: true, sheetStubs: true });
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
  /** Exact sheet name; the first recognized sheet otherwise. */
  sheet?: string;
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

function findHeader(sheet: WorkSheet) {
  for (const [row, cells] of collectRows(sheet, (r) => r < HEADER_SCAN_ROWS)) {
    const headers = [...cells].map(([column, cell]) => ({ column, text: cellText(cell) })).filter(({ text }) => text);
    const columns = detectWorkbookColumns(headers);
    if (isWorkbookHeaderRow(columns)) return { row, headers, columns };
  }
  return null;
}

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

  const tables = workbook.SheetNames.flatMap((name, index) => {
    const sheet = workbook.Sheets[name];
    if (!sheet || workbook.Workbook?.Sheets?.[index]?.Hidden) return [];
    const header = findHeader(sheet);
    return header ? [{ name, sheet, header }] : [];
  });
  if (!tables.length) {
    throw new MaterialRequestWorkbookError("Ajoutez une colonne « Désignation » et au moins une autre colonne reconnue, par exemple « Quantité », dans les 50 premières lignes d’une feuille.");
  }
  const table = options.sheet === undefined ? tables[0] : tables.find(({ name }) => name === options.sheet);
  if (!table) throw new MaterialRequestWorkbookError("Cette feuille ne contient pas de tableau reconnu.");

  const { row: headerRow, headers, columns: detected } = table.header;
  const columns = options.mapping ? toIndexes(options.mapping) : detected;
  const included = new Set(Object.values(columns));

  // Example values for the mapping step: the first non-empty cells under each header.
  const examples = new Map<number, string[]>(headers.map(({ column }) => [column, []]));
  for (const [, cells] of collectRows(table.sheet, (r, c) => r > headerRow && r <= headerRow + EXAMPLE_SCAN_ROWS && examples.has(c))) {
    for (const [column, cell] of cells) {
      const text = cellText(cell);
      const list = examples.get(column);
      if (text && list && list.length < 3) list.push(text.length > EXAMPLE_MAX_LENGTH ? `${text.slice(0, EXAMPLE_MAX_LENGTH - 1)}…` : text);
    }
  }

  const existing = new Map<string, MaterialRequestWorkbookExistingLine[]>();
  for (const line of options.existingLines ?? []) {
    for (const designation of new Set([line.product_type, line.original_text].filter(Boolean))) {
      const key = existingKey(designation, line.dimension);
      existing.set(key, [...(existing.get(key) ?? []), line]);
    }
  }

  const preview: MaterialRequestWorkbookReading = {
    sheet_name: table.name,
    sheet_names: tables.map(({ name }) => name),
    header_row: headerRow + 1,
    columns: headers.map(({ column, text }) => ({ column: workbookColumnLetter(column), header: text, examples: examples.get(column) ?? [] })),
    detected_columns: toLetters(detected),
    mapped_columns: toLetters(columns),
    rows: [],
    issues: [],
    omitted_rows: 0,
  };
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
    // A quantity the request cannot hold (past its ceiling) is one to complete, as an unreadable one.
    const { quantity, roundedFrom } = materialRequestLineInputSchema.shape.quantity.safeParse(rounding.quantity).success
      ? rounding : { quantity: null, roundedFrom: null };
    const writtenReference = text("reference");
    const reference = workbookReferenceCode(writtenReference);
    const line = materialRequestLineInputSchema.safeParse({
      original_text: designation,
      product_type: designation,
      quantity: quantity ?? undefined,
      unit: text("unit"),
      dimension: text("dimension"),
      reference: reference ?? undefined,
      material: text("material"),
      zone: text("zone"),
    });
    if (!line.success) {
      const issue = line.error.issues[0];
      const role = ROLE_OF_FIELD[String(issue?.path[0])];
      const limit = issue?.code === "too_big" ? Number(issue.maximum) : null;
      preview.issues.push({
        row_number,
        message: role && limit && columns[role] !== undefined
          ? `La cellule « ${WORKBOOK_ROLE_LABELS[role]} » (colonne ${workbookColumnLetter(columns[role])}) dépasse ${limit} caractères. Raccourcissez-la dans le classeur. Ligne écartée.`
          : "Une cellule de cette ligne est illisible. Ligne écartée.",
      });
      continue;
    }

    const remarks: MaterialRequestWorkbookRow["remarks"] = [];
    let selected = true;
    if (roundedFrom !== null) remarks.push({ code: "rounded", message: `Arrondi de ${formatDecimalInput(roundedFrom)}` });
    if (quantity === null) {
      remarks.push({ code: "no_quantity", message: "Sans quantité" });
      selected = false;
    }
    if (writtenReference && !reference) remarks.push({ code: "reference_dropped", message: "Référence écartée" });
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
    preview.rows.push({ row_number, line: line.data, supplier_name: text("supplier") ?? null, selected, remarks });
  }
  return preview;
}
