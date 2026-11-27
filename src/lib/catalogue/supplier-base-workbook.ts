import "server-only";

import { Worker } from "node:worker_threads";
import { zipSync } from "fflate";
import { SSF } from "xlsx";

import { readXlsxArchiveWithinBudget } from "@/lib/affaires/intake-office-archive";
import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import { ApiError, badRequest, payloadTooLarge } from "@/lib/http/api-error";
import { formatDecimalInput, parseDecimalInput } from "@/lib/numeric-input/parsers";
import { acquireWorkbookParseSlot } from "@/lib/spreadsheet-workbook-parse-pool";
import { foldWords } from "@/lib/text/fold";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

import type { SupplierBaseRow, SupplierBaseWorkbook } from "./supplier-base-contract";
import { packagingPriceIssue, readSupplierBasePrice } from "./supplier-base-prices";

const PARSE_TIMEOUT_MS = 10_000;
const limits = { sheets: 48, rowsPerSheet: 1000, columns: 60, cells: 120_000, text: 4000, textTotal: 4_000_000 };
const HEADER_SCAN_ROWS = 12;
const HEADER_ROW = 4;
const SKIPPED = { sommaire: "index", recap: "summary", location: "rental" };
const WORKER_LIMITS = {
  sheets: "Le classeur dépasse la limite de 48 feuilles.",
  rows: "Une feuille dépasse la limite de 1 000 lignes.",
  columns: "Une feuille dépasse la limite de 60 colonnes.",
  cells: "Le classeur dépasse la limite de 120 000 cellules.",
  cell_text: "Une cellule dépasse la limite de 4 000 caractères.",
  total_text: "Le texte du classeur dépasse la limite de 4 000 000 de caractères.",
  time: "Le délai de lecture du classeur a dépassé 10 secondes.",
  memory: "Le classeur dépasse le budget mémoire de lecture.",
} as const;

type Cell = { value: string | number | null; display?: string };
type RawSheet = { name: string; rows: Array<[number, Array<[number, Cell]>]> };
type WorkbookRead = { sheets: RawSheet[]; skipped: SupplierBaseWorkbook["skipped_sheets"]; date1904: boolean };
type WorkerResult = WorkbookRead | { limit: keyof typeof WORKER_LIMITS };

// Project only bounded cell values across the worker boundary. Links, styles and formulas stay in the worker.
const WORKER_SCRIPT = String.raw`
const { parentPort, workerData } = require("node:worker_threads");
const { bytes, limits, skipped } = workerData;
const xlsx = require("xlsx");
try {
  const options = { type: "array", cellHTML: false, cellDates: false, cellNF: true };
  const names = xlsx.read(bytes, { ...options, bookSheets: true }).SheetNames;
  if (names.length > limits.sheets) throw "sheets";
  const skipReason = (name) => {
    const key = name.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
    return Object.hasOwn(skipped, key) ? skipped[key] : undefined;
  };
  const selected = names.flatMap((name, index) => skipReason(name) ? [] : [index]);
  const workbook = xlsx.read(bytes, { ...options, sheets: selected, sheetStubs: true });
  const result = { sheets: [], skipped: [], date1904: Boolean(workbook.Workbook?.WBProps?.date1904) };
  let cellCount = 0;
  let textCount = 0;
  names.forEach((name, index) => {
    const reason = skipReason(name) ?? (workbook.Workbook?.Sheets?.[index]?.Hidden ? "hidden" : undefined);
    if (reason) {
      result.skipped.push({ name, reason });
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
      if (r >= limits.rowsPerSheet) throw "rows";
      if (c >= limits.columns) throw "columns";
      if (++cellCount > limits.cells) throw "cells";
      const projected = { value };
      if (typeof value === "string") {
        if (value.length > limits.text) throw "cell_text";
        if ((textCount += value.length) > limits.textTotal) throw "total_text";
      }
      if (typeof value === "number" && cell.z && cell.z !== "General" && typeof cell.w === "string") {
        const display = cell.w.trim();
        // Numeric identifiers saved in scientific format still use their full digits.
        if (display && !/^[+-]?\d+(?:[.,]\d+)?e[+-]?\d+$/i.test(display)) {
          if (display.length > limits.text) throw "cell_text";
          if ((textCount += display.length) > limits.textTotal) throw "total_text";
          projected.display = display;
        }
      }
      if (!rows.has(r + 1)) rows.set(r + 1, []);
      rows.get(r + 1).push([c, projected]);
    }
    result.sheets.push({ name, rows: [...rows].sort(([a], [b]) => a - b) });
  });
  parentPort.postMessage(result);
} catch (error) {
  parentPort.postMessage(typeof error === "string" ? { limit: error } : null);
}
`;

async function readWorkbook(bytes: Buffer, signal?: AbortSignal): Promise<WorkbookRead> {
  signal?.throwIfAborted();
  // Repack validated archive members so the parser sees the same headers as the archive budget check.
  let archive: Uint8Array;
  try {
    archive = zipSync(readXlsxArchiveWithinBudget(bytes), { level: 0 });
  } catch (error) {
    // The archive reader names its budgets and emits fixed messages for malformed entries.
    if (error instanceof Error && /depasse|dépasse/u.test(error.message)) {
      throw payloadTooLarge(error.message, undefined, "SUPPLIER_BASE_ARCHIVE_LIMIT");
    }
    throw badRequest("Ce classeur Excel est illisible.", undefined, "SUPPLIER_BASE_INVALID_WORKBOOK");
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SCRIPT, {
      eval: true,
      // Keep xlsx in Next's deployment trace for the evaluated worker, as for material request previews.
      workerData: { bytes: archive, limits, skipped: SKIPPED, tracedModule: require.resolve("xlsx") },
      resourceLimits: { maxOldGenerationSizeMb: 96, maxYoungGenerationSizeMb: 16 },
    });
    let settled = false;
    const fail = () => finish(null);
    const timer = setTimeout(() => finish({ limit: "time" }), PARSE_TIMEOUT_MS);
    function finish(result: WorkerResult | null) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", fail);
      void worker.terminate().then(() => {
        if (result && "sheets" in result) resolve(result);
        else if (result && Object.hasOwn(WORKER_LIMITS, result.limit)) {
          reject(payloadTooLarge(WORKER_LIMITS[result.limit], undefined, `SUPPLIER_BASE_${result.limit.toUpperCase()}_LIMIT`));
        } else reject(badRequest("Ce classeur Excel est illisible.", undefined, "SUPPLIER_BASE_INVALID_WORKBOOK"));
      }, reject);
    }
    signal?.addEventListener("abort", fail, { once: true });
    worker.once("message", finish);
    worker.once("messageerror", fail);
    worker.once("error", (error: NodeJS.ErrnoException) => {
      finish(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? { limit: "memory" } : null);
    });
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
  packPrice: "Prix du cond.",
  date: "Date du prix",
  document: "Document",
  observations: "Observations",
  source: "Fichier source",
} as const;

type Field = keyof typeof HEADERS;
const REQUIRED_FIELDS = ["designation", "reference", "price", "unit", "date"] as const satisfies readonly Field[];
const OPTIONAL_FIELDS = ["packaging", "quantity", "packPrice", "document", "observations", "source"] as const satisfies readonly Field[];
const FIELD_BY_HEADER = new Map(Object.entries(HEADERS).map(([key, label]) => [foldWords(label), key as Field]));

function cellText(cell: Cell | undefined): string | null {
  if (typeof cell?.value === "string") return cell.value.trim() || null;
  if (typeof cell?.value === "number") return cell.display ?? formatDecimalInput(cell.value).replace(",", ".");
  return null;
}

function findHeader(sheet: RawSheet) {
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
    if (!repeated && REQUIRED_FIELDS.every((field) => fields.has(field))) {
      return { row, fields };
    }
  }
  throw badRequest(
    `En-têtes introuvables ou en double dans « ${sheet.name} ». Les ${HEADER_SCAN_ROWS} premières lignes doivent contenir : ${REQUIRED_FIELDS.map((field) => HEADERS[field]).join(", ")}.`,
    undefined,
    "SUPPLIER_BASE_HEADER_NOT_FOUND",
  );
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
  const number = match?.[2]?.trim();
  return match && number ? { kind: match[1], number } : { text };
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

function readSheet(sheet: RawSheet, date1904: boolean, today: string) {
  const header = findHeader(sheet);
  const grouped = header.fields.has("supplier");
  const missingOptionalColumns = OPTIONAL_FIELDS.filter((field) => !header.fields.has(field)).map((field) => HEADERS[field]);
  const readColumns = new Set(header.fields.values());
  const rows = sheet.rows.flatMap(([row, entries]): SupplierBaseRow[] => {
    if (row <= header.row || !entries.some(([column]) => readColumns.has(column))) return [];
    const cells = new Map(entries);
    const cell = (field: Field) => cells.get(header.fields.get(field) ?? -1);
    const value = (field: Field) => cellText(cell(field));
    const supplier = grouped ? value("supplier") : sheet.name.trim();
    const designation = value("designation");
    const reference = value("reference");
    const priceCell = cell("price");
    const date = excelDate(cell("date"), date1904);
    const priceUnit = value("unit");
    const priceUnitCode = normalizeMeasurementUnit(priceUnit).unitCode;
    const quantity = parseDecimalInput(cell("quantity")?.value);
    const packagingQuantity = quantity !== null && quantity > 0 ? quantity : null;
    const observations = value("observations");
    const fragile = fragileReasons(observations);
    const priceValue = priceCell?.value;
    const parsedPrice = typeof priceValue === "number"
      ? readSupplierBasePrice(priceValue, fragile.includes("price_per_100") ? 100 : 1) : null;
    const priceText = typeof priceValue === "string" ? priceValue.trim() : undefined;
    const packPrice = cell("packPrice");
    const issues: SupplierBaseRow["issues"] = [];
    if (!supplier) issues.push("missing_supplier");
    if (!designation) issues.push("missing_designation");
    if (!reference) issues.push("missing_reference");
    if (priceText !== undefined) issues.push("text_price");
    else if (priceCell && !parsedPrice) issues.push("invalid_price");
    if (parsedPrice?.issue) issues.push(parsedPrice.issue);
    if (priceCell && !cell("date")) issues.push("missing_price_date");
    if (cell("date") && !date) issues.push("invalid_price_date");
    if (date && date > today) issues.push("future_price_date");
    if ((priceCell || cell("unit")) && !priceUnitCode) issues.push("unknown_price_unit");
    if (cell("quantity") && packagingQuantity === null) issues.push("invalid_packaging_quantity");
    if (parsedPrice && packagingQuantity !== null && packPrice) {
      const issue = packagingPriceIssue(parsedPrice.price.unit_decimal, packagingQuantity, packPrice.value);
      if (issue) issues.push(issue);
    }
    return [{
      sheet: sheet.name, row, supplier_name: supplier || null, designation, supplier_reference: reference,
      price: parsedPrice?.price ?? null, price_text: priceText, price_unit: priceUnit, price_unit_code: priceUnitCode,
      packaging_label: value("packaging"), packaging_quantity: packagingQuantity, price_date: date,
      document: readDocument(value("document")), observations, source_file_text: value("source"),
      fragile: fragile.length > 0, fragile_reasons: fragile, issues,
    }];
  });
  return { rows, missingOptionalColumns, grouped };
}

export const supplierBaseReferenceKey = (reference: string) => reference.trim().replace(/\s+/gu, " ").toLocaleLowerCase("fr-FR");

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

export async function readSupplierBaseWorkbook(bytes: Buffer, signal?: AbortSignal): Promise<SupplierBaseWorkbook> {
  const release = acquireWorkbookParseSlot();
  if (!release) {
    throw new ApiError({ status: 503, code: "SUPPLIER_BASE_BUSY", message: "D’autres classeurs sont en cours de lecture. Réessayez dans un instant." });
  }
  try {
    const workbook = await readWorkbook(bytes, signal);
    const today = new Date().toISOString().slice(0, 10);
    const rows: SupplierBaseRow[] = [];
    const grouped_sheets: string[] = [];
    const sheet_warnings: SupplierBaseWorkbook["sheet_warnings"] = [];
    for (const sheet of workbook.sheets) {
      const parsed = readSheet(sheet, workbook.date1904, today);
      if (parsed.grouped) grouped_sheets.push(sheet.name);
      rows.push(...parsed.rows);
      if (parsed.missingOptionalColumns.length > 0) {
        sheet_warnings.push({ sheet: sheet.name, missing_optional_columns: parsed.missingOptionalColumns });
      }
    }
    if (rows.length > 4000) throw payloadTooLarge("Le classeur dépasse les 4 000 lignes utiles de l’aperçu.", undefined, "SUPPLIER_BASE_ROW_LIMIT");
    if (rows.length === 0) throw badRequest("Aucun article à lire dans ce classeur.");
    return {
      rows: flagDuplicateSupplierReferences(rows, workbookSupplierNameKey), skipped_sheets: workbook.skipped,
      sheet_warnings, grouped_sheets, today,
    };
  } finally {
    release();
  }
}
