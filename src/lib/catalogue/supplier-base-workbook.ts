import "server-only";

import { Worker } from "node:worker_threads";
import { zipSync } from "fflate";
import { SSF } from "xlsx";

import { readXlsxArchiveWithinBudget } from "@/lib/affaires/intake-office-archive";
import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import { ApiError, badRequest } from "@/lib/http/api-error";
import { formatDecimalInput, parseAmountCents, parseDecimalInput } from "@/lib/numeric-input/parsers";
import { foldWords } from "@/lib/text/fold";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

import type { SupplierBaseRow } from "./supplier-base-contract";

const PARSE_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_PREVIEWS = 2;
let activePreviews = 0;

const limits = { sheets: 48, rowsPerSheet: 1000, columns: 60, cells: 120_000, text: 4000, textTotal: 4_000_000 };
const HEADER_SCAN_ROWS = 12;
const HEADER_ROW = 4;
const SKIPPED = ["sommaire", "recap", "location"];

type Cell = { value: string | number | null; display?: string };
type RawSheet = { name: string; rows: Array<[number, Array<[number, Cell]>]> };
type WorkbookRead = { sheets: RawSheet[]; skipped: string[]; date1904: boolean };

// Project only bounded cell values across the worker boundary. Links, styles and formulas stay in the worker.
const WORKER_SCRIPT = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { bytes, limits, skipped } = workerData;
const xlsx = require("xlsx");
try {
  const options = { type: "array", cellHTML: false, cellDates: false };
  const names = xlsx.read(bytes, { ...options, bookSheets: true }).SheetNames;
  if (names.length > limits.sheets) throw new Error("sheet limit");
  const skipName = (name) => skipped.includes(name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase());
  const selected = names.flatMap((name, index) => skipName(name) ? [] : [index]);
  const workbook = xlsx.read(bytes, { ...options, sheets: selected, sheetStubs: true });
  const result = { sheets: [], skipped: [], date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
  let cellCount = 0;
  let textCount = 0;
  names.forEach((name, index) => {
    if (skipName(name) || workbook.Workbook?.Sheets?.[index]?.Hidden) {
      result.skipped.push(name);
      return;
    }
    const sheet = workbook.Sheets?.[name];
    if (!sheet) throw new Error("missing sheet");
    const rows = new Map();
    for (const address of Object.keys(sheet)) {
      if (address.startsWith("!")) continue;
      const cell = sheet[address];
      if (cell.t === "z" && !cell.f) continue;
      const value = typeof cell.v === "number" && cell.t === "n" || typeof cell.v === "string" && cell.t === "s" ? cell.v : null;
      if (typeof value === "string" && !value.trim()) continue;
      const { r, c } = xlsx.utils.decode_cell(address);
      if (r >= limits.rowsPerSheet || c >= limits.columns || ++cellCount > limits.cells) throw new Error("cell limit");
      const projected = { value };
      if (typeof value === "string") {
        if (value.length > limits.text || (textCount += value.length) > limits.textTotal) throw new Error("text limit");
      }
      if (typeof value === "number" && typeof cell.w === "string" && /^0\d+$/.test(cell.w) && cell.w.length <= 64) {
        projected.display = cell.w;
      }
      if (!rows.has(r + 1)) rows.set(r + 1, []);
      rows.get(r + 1).push([c, projected]);
    }
    result.sheets.push({ name, rows: [...rows].sort(([a], [b]) => a - b) });
  });
  parentPort.postMessage(result);
} catch {
  parentPort.postMessage(null);
}
`;

async function readWorkbook(bytes: Buffer, signal?: AbortSignal): Promise<WorkbookRead> {
  signal?.throwIfAborted();
  // Repack validated archive members so the parser sees the same headers as the archive budget check.
  const archive = zipSync(readXlsxArchiveWithinBudget(bytes), { level: 0 });
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      // Keep xlsx in Next's deployment trace for the evaluated worker, as for material request previews.
      workerData: { bytes: archive, limits, skipped: SKIPPED, tracedModule: require.resolve("xlsx") },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const fail = () => finish(null);
    const timer = setTimeout(fail, PARSE_TIMEOUT_MS);
    function finish(result: WorkbookRead | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      void worker.terminate().then(() => {
        if (result) resolve(result);
        else reject(new Error("Workbook parsing failed."));
      }, reject);
    }
    signal?.addEventListener("abort", fail, { once: true });
    worker.once("message", finish);
    worker.once("messageerror", fail);
    worker.once("error", fail);
    worker.once("exit", fail);
  });
}

const HEADERS = {
  supplier: "Fournisseur",
  designation: "Désignation",
  reference: "Réf.",
  price: "Prix unitaire",
  unit: "Unité de prix",
  packaging: "Conditionnement",
  quantity: "Qté par cond.",
  date: "Date du prix",
  document: "Document",
  observations: "Observations",
  source: "Fichier source",
} as const;

type Field = keyof typeof HEADERS;
const FIELD_BY_HEADER = new Map(Object.entries(HEADERS).map(([key, label]) => [foldWords(label), key as Field]));

function cellText(cell: Cell | undefined): string | null {
  if (typeof cell?.value === "string") return cell.value.trim() || null;
  if (typeof cell?.value === "number") return cell.display ?? formatDecimalInput(cell.value).replace(",", ".");
  return null;
}

function findHeader(sheet: RawSheet, grouped: boolean) {
  const candidates = sheet.rows.filter(([row]) => row <= HEADER_SCAN_ROWS)
    .sort(([a], [b]) => Math.abs(a - HEADER_ROW) - Math.abs(b - HEADER_ROW));
  for (const [row, cells] of candidates) {
    const fields = new Map<Field, number>();
    let repeated = false;
    for (const [column, cell] of cells) {
      const field = FIELD_BY_HEADER.get(foldWords(cellText(cell) ?? ""));
      if (!field) continue;
      if (fields.has(field)) {
        repeated = true;
        break;
      }
      fields.set(field, column);
    }
    if (!repeated && fields.size === Object.keys(HEADERS).length - (grouped ? 0 : 1) && fields.has("supplier") === grouped) {
      return { row, fields };
    }
  }
  throw badRequest(`Vérifiez les en-têtes de la feuille « ${sheet.name} ». Ils sont attendus près de la ligne 4.`);
}

function excelDate(cell: Cell | undefined, date1904: boolean) {
  if (typeof cell?.value !== "number" || cell.value < 0 || (!date1904 && Math.floor(cell.value) === 60)) return null;
  const date = SSF.parse_date_code(cell.value, { date1904 });
  if (!date || date.y < 1900 || date.y > 9999 || date.m < 1 || date.d < 1) return null;
  return [String(date.y), String(date.m).padStart(2, "0"), String(date.d).padStart(2, "0")].join("-");
}

function readDocument(text: string | null): SupplierBaseRow["document"] {
  if (!text) return null;
  const match = /^(bon\s+de\s+livraison|accusé\s+de\s+réception|devis|facture|commande|a\.?r\.?|b\.?l\.?)(?:\s*[:#]\s*|\s+)(.+)$/iu.exec(text);
  return { text, kind: match?.[1] ?? null, number: match?.[2]?.trim() || null };
}

function fragileReasons(observations: string | null): SupplierBaseRow["fragile_reasons"] {
  const text = foldWords(observations ?? "");
  const reasons: SupplierBaseRow["fragile_reasons"] = [];
  const oldVersion = /\b(?:ancien(?:ne)? (?:version|fichier|base|classeur)|(?:version|fichier|base|classeur) (?:ancien(?:ne)?|precedent(?:e)?))\b/u.test(text);
  const missingDocument = /\b(?:(?:sans|aucun) (?:le )?(?:doc(?:ument)?|justificatif|source)|(?:doc(?:ument)?|justificatif|source)(?: d origine)? (?:manquant(?:e)?|absent(?:e)?|indisponible|introuvable|non (?:retrouve(?:e)?|disponible)))\b/u.test(text);
  if (oldVersion && missingDocument) reasons.push("old_version_missing_document");
  if (/\bocr\b/u.test(text)) reasons.push("ocr_scan");
  if (/\b(?:prix|tarif)\b.{0,55}\b(?:pour|par|aux?|les) (?:lot de )?100\b|\b(?:prix|tarif) 100 (?:unites|pieces|pcs)\b|\b100 (?:unites|pieces|pcs)\b.{0,35}\b(?:prix|tarif)\b/u.test(text)) {
    reasons.push("price_per_100");
  }
  return reasons;
}

function readSheet(sheet: RawSheet, date1904: boolean): SupplierBaseRow[] {
  const grouped = foldWords(sheet.name) === "divers";
  const header = findHeader(sheet, grouped);
  const readColumns = new Set(header.fields.values());
  return sheet.rows.flatMap(([row, entries]) => {
    if (row <= header.row || !entries.some(([column]) => readColumns.has(column))) return [];
    const cells = new Map(entries);
    const cell = (field: Field) => cells.get(header.fields.get(field) ?? -1);
    const value = (field: Field) => cellText(cell(field));
    const supplier = grouped ? value("supplier") : sheet.name.trim();
    const designation = value("designation");
    const reference = value("reference");
    const price = cell("price");
    const cents = parseAmountCents(price?.value);
    const unitPriceCents = cents !== null && cents >= 0 && cents <= 2147483647 && !(typeof price?.value === "number" && price.value < 0) ? cents : null;
    const date = excelDate(cell("date"), date1904);
    const priceUnit = value("unit");
    const priceUnitCode = normalizeMeasurementUnit(priceUnit).unitCode;
    const quantity = parseDecimalInput(cell("quantity")?.value);
    const packagingQuantity = quantity !== null && quantity > 0 ? quantity : null;
    const observations = value("observations");
    const fragile = fragileReasons(observations);
    const issues: SupplierBaseRow["issues"] = [];
    if (!supplier) issues.push("missing_supplier");
    if (!designation) issues.push("missing_designation");
    if (!reference) issues.push("missing_reference");
    if (price && unitPriceCents === null) issues.push("invalid_price");
    if (price && !cell("date")) issues.push("missing_price_date");
    if (cell("date") && !date) issues.push("invalid_price_date");
    if ((price || cell("unit")) && !priceUnitCode) issues.push("unknown_price_unit");
    if (cell("quantity") && packagingQuantity === null) issues.push("invalid_packaging_quantity");
    return [{
      sheet: sheet.name, row, supplier_name: supplier || null, designation, supplier_reference: reference,
      unit_price_cents: unitPriceCents, price_unit: priceUnit, price_unit_code: priceUnitCode,
      packaging_label: value("packaging"), packaging_quantity: packagingQuantity, price_date: date,
      document: readDocument(value("document")), observations, source_file_text: value("source"),
      fragile: fragile.length > 0, fragile_reasons: fragile, issues,
    }];
  });
}

export const supplierBaseReferenceKey = (reference: string) => reference.trim().toLocaleLowerCase("fr-FR");

export function flagDuplicateSupplierReferences(rows: SupplierBaseRow[], supplierKey: (name: string) => string) {
  const keys = rows.map(({ supplier_name, supplier_reference }) => supplier_name && supplier_reference
    ? JSON.stringify([supplierKey(supplier_name), supplierBaseReferenceKey(supplier_reference)]) : null);
  const counts = new Map<string, number>();
  for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  return rows.map((row, index): SupplierBaseRow => {
    const key = keys[index];
    return key && (counts.get(key) ?? 0) > 1 && !row.issues.includes("duplicate_reference")
      ? { ...row, issues: [...row.issues, "duplicate_reference"] }
      : row;
  });
}

export async function readSupplierBaseWorkbook(bytes: Buffer, signal?: AbortSignal) {
  if (activePreviews >= MAX_CONCURRENT_PREVIEWS) {
    throw new ApiError({ status: 503, code: "SUPPLIER_BASE_BUSY", message: "D’autres classeurs sont en cours de lecture. Réessayez dans un instant." });
  }
  activePreviews += 1;
  try {
    let workbook: WorkbookRead;
    try {
      workbook = await readWorkbook(bytes, signal);
    } catch {
      throw badRequest("Ce classeur Excel est illisible ou dépasse les limites de l’aperçu.");
    }
    const rows = workbook.sheets.flatMap((sheet) => readSheet(sheet, workbook.date1904));
    if (rows.length > 4000) throw badRequest("Le classeur dépasse les 4 000 lignes de l’aperçu.");
    if (rows.length === 0) throw badRequest("Aucun article à lire dans ce classeur.");
    return { rows: flagDuplicateSupplierReferences(rows, workbookSupplierNameKey), skipped_sheets: workbook.skipped };
  } finally {
    activePreviews -= 1;
  }
}
