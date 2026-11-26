import { Worker } from "node:worker_threads";

import { zipSync } from "fflate";
import { utils, type CellObject, type WorkBook, type WorkSheet } from "xlsx";

import { readXlsxArchiveWithinBudget } from "@/lib/affaires/intake-office-archive";
import { parseDecimalInput } from "@/lib/numeric-input/parsers";
import { foldWords } from "@/lib/text/fold";

import { MATERIAL_REQUEST_MAX_LINES, materialRequestLineInputSchema } from "./contracts";
import type { MaterialRequestWorkbookPreview } from "./workbook-preview-contract";

const HEADER_SCAN_ROWS = 50;
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
const HEADERS = {
  designation: ["designation", "libelle", "article", "description", "materiel", "produit", "designation article"],
  quantity: ["quantite", "qte", "qty", "quantity", "quantite demandee"],
  unit: ["unite", "unite de mesure", "u", "unit"],
  dimension: ["dimension", "dimensions", "diametre", "dn"],
  reference: ["reference", "ref", "code article", "reference article"],
  material: ["matiere", "materiau", "material"],
  zone: ["zone", "localisation", "emplacement"],
} as const;

type Field = keyof typeof HEADERS;
type Columns = Partial<Record<Field, number>>;
type Cells = Map<number, CellObject>;
const fieldByLabel = new Map<string, Field>(
  (Object.keys(HEADERS) as Field[]).flatMap((field) => HEADERS[field].map((label) => [label, field] as const)),
);

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

function cellText(cell: CellObject | undefined) {
  if (typeof cell?.v === "string" && cell.t === "s") return cell.v.trim();
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
    const columns: Columns = {};
    let ambiguous = false;
    for (const [column, cell] of cells) {
      const field = fieldByLabel.get(foldWords(cellText(cell)));
      if (!field) continue;
      if (columns[field] !== undefined) ambiguous = true;
      columns[field] = column;
    }
    if (!ambiguous && columns.designation !== undefined && Object.keys(columns).length > 1) return { row, columns };
  }
  return null;
}

export async function previewMaterialRequestWorkbook(bytes: Buffer, requestedSheet?: string, signal?: AbortSignal): Promise<MaterialRequestWorkbookPreview> {
  if (activePreviews >= MAX_CONCURRENT_PREVIEWS) {
    throw new MaterialRequestWorkbookBusyError("La lecture d’autres classeurs est en cours. Rouvrez l’aperçu dans quelques instants.");
  }
  activePreviews += 1;
  try {
    return await buildPreview(bytes, requestedSheet, signal);
  } finally {
    activePreviews -= 1;
  }
}

async function buildPreview(bytes: Buffer, requestedSheet?: string, signal?: AbortSignal): Promise<MaterialRequestWorkbookPreview> {
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
  const table = requestedSheet === undefined ? tables[0] : tables.find(({ name }) => name === requestedSheet);
  if (!table) throw new MaterialRequestWorkbookError("Cette feuille ne contient pas de tableau reconnu.");

  const { row: headerRow, columns } = table.header;
  const included = new Set(Object.values(columns));
  const preview: MaterialRequestWorkbookPreview = {
    sheet_name: table.name, sheet_names: tables.map(({ name }) => name), rows: [], issues: [], omitted_rows: 0,
  };
  let seen = 0;
  for (const [row, cells] of collectRows(table.sheet, (r, c) => r > headerRow && included.has(c))) {
    const cell = (field: Field) => columns[field] === undefined ? undefined : cells.get(columns[field]);
    const text = (field: Field) => cellText(cell(field)) || undefined;
    if (![...cells.values()].some((entry) => cellText(entry) || entry.t === "e" || entry.f)) continue;
    const designation = text("designation");
    if (designation && fieldByLabel.get(foldWords(designation)) === "designation" && Object.keys(columns).some((key) => {
      const field = key as Field;
      return field !== "designation" && fieldByLabel.get(foldWords(cellText(cell(field)))) === field;
    })) continue;
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
    const quantity = quantityCell?.t === "n" || quantityCell?.t === "s" ? parseDecimalInput(quantityCell.v) : null;
    const parsedQuantity = materialRequestLineInputSchema.shape.quantity.safeParse(quantity);
    const line = materialRequestLineInputSchema.safeParse({
      original_text: designation,
      product_type: designation,
      quantity: parsedQuantity.success ? parsedQuantity.data ?? undefined : undefined,
      unit: text("unit"),
      dimension: text("dimension"),
      reference: text("reference"),
      material: text("material"),
      zone: text("zone"),
    });
    if (!line.success) {
      preview.issues.push({ row_number, message: "Une cellule dépasse la longueur autorisée. Ligne écartée." });
      continue;
    }
    if (line.data.quantity === undefined) {
      preview.issues.push({ row_number, message: "Quantité à compléter ou à corriger." });
    }
    preview.rows.push({ row_number, line: line.data });
  }
  return preview;
}
