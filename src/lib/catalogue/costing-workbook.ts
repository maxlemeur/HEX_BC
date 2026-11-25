import { parseAmountCents } from "@/lib/numeric-input/parsers";
import { foldText, foldWords } from "@/lib/text/fold";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

/**
 * Reads the office's costing workbook (« bible de chiffrage », sheet « All_data ») into catalogue drafts
 * (TI-690, lot 1). Pure: the browser reads the file and hands its rows here, the server reads them again
 * before writing. Nothing is validated here: every article becomes a draft that the office checks and
 * validates one by one in the catalogue.
 *
 * What the workbook does not say is never invented: an empty price is 0 (to be filled), an empty mark has
 * no reliability, an unclassified article is « divers ». The labour columns (h MO, K MO) and the per-line
 * FO coefficient have no place in the catalogue and are not read.
 */

export const COSTING_WORKBOOK_SHEET = "All_data";

/** Codes of the supply types every company has (seeded with their K FO base: 1,13 tube, 1,02 the others). */
export const COSTING_WORKBOOK_SUPPLY_KINDS = [
  "tube",
  "raccord",
  "vanne",
  "robinetterie",
  "support",
  "calorifuge",
  "divers",
] as const;
export type CostingWorkbookSupplyKind = (typeof COSTING_WORKBOOK_SUPPLY_KINDS)[number];

export type CostingWorkbookSupplierReference = {
  supplier_name: string;
  supplier_sku: string;
  product_url: string | null;
};

export type CostingWorkbookPriceSourceKind = "quote" | "document" | "order" | "regression";

export type CostingWorkbookSupplierOccurrence = {
  row: number;
  slot: number;
  /** Zero-based position of the reference column as it appears in Excel. */
  column: number;
  article_column?: number;
  supplier_name_column?: number;
  article_reference: string;
  article_wording: string;
  article_material: string;
  article_dimension: string;
  supplier_name: string;
  supplier_sku: string;
  article_reference_valid: boolean;
  supplier_name_valid: boolean;
  supplier_sku_valid: boolean;
  price_source_kind: CostingWorkbookPriceSourceKind | null;
};

export type CostingWorkbookArticle = {
  /** Row of the sheet, counted from 1 as the spreadsheet shows it. */
  row: number;
  reference: string;
  designation: string;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  category: string;
  unit: string;
  unit_price_cents: number;
  reliability_score: number | null;
  /** Code of the supply type proposed for the draft; the office confirms it when validating. */
  supply_type_code: CostingWorkbookSupplyKind;
  /** The workbook's own family code (« I4L », « ROB »…), kept for the record. */
  family_code: string | null;
  supplier_references: CostingWorkbookSupplierReference[];
  /** The sheet gives no unit for this article: « u » is a default the office checks. */
  unit_defaulted: boolean;
  /** Neither its family, its wording nor its material classify the article: « divers » is a default. */
  supply_type_defaulted: boolean;
};

export type CostingWorkbookIssue = { row: number; reference: string | null; message: string };

export type CostingWorkbookReadResult = {
  articles: CostingWorkbookArticle[];
  supplierReferenceOccurrences: CostingWorkbookSupplierOccurrence[];
  issues: CostingWorkbookIssue[];
  /** Section title rows (« Rub »), not articles. */
  sections: number;
};

export class CostingWorkbookFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CostingWorkbookFormatError";
  }
}

type Cell = unknown;

const REQUIRED = ["ID", "Caractéristique", "Matériau", "Type_ligne"] as const;
const OPTIONAL = [
  "Fiabilité (/10)", "Dimension", "Précision", "norme", "Unité", "PR. FO", "Type FO",
  "F1_nom", "F1_ref", "F1_URL", "F2_nom", "F2_ref", "F2_URL", "F3_nom", "F3_ref", "F3_URL",
] as const;
type Column = (typeof REQUIRED)[number] | (typeof OPTIONAL)[number];
export type CostingWorkbookColumn = Column;
export const COSTING_WORKBOOK_REQUIRED_COLUMNS: readonly Column[] = REQUIRED;
export const COSTING_WORKBOOK_OPTIONAL_COLUMNS: readonly Column[] = OPTIONAL;

/**
 * What the sheet's header row gives the reader, without refusing anything: the screen shows it so that a renamed
 * column (« PR FO » for « PR. FO », every price then read as 0 €) is seen before the import, and can be pointed
 * to its header. `headerRow` is the row the spreadsheet shows, counted from 1; null on a sheet without a row.
 */
export type CostingWorkbookColumnInspection = {
  headerRow: number | null;
  found: Array<{ column: Column; index: number }>;
  missingRequired: Column[];
  missingOptional: Column[];
  /** Header cells of that row that name no column the reader knows, in sheet order. */
  unrecognised: Array<{ index: number; text: string }>;
};

const HEADER_SEARCH_ROWS = 10;

/** Materials that name a trade, not a material: never repeated in a designation. */
const GENERIC_MATERIALS = new Set(["divers", "robinetterie", "supportage", "consommables", "calorifuge", "collier"]);
/** Workbook families that are materials: the piece itself says whether it is a tube or a fitting. */
const MATERIAL_FAMILIES = new Set(["I4L", "I6L", "T10", "AN", "MC", "PVCP", "SMU", "PVCE", "FPH", "PER"]);
/** First words of a tube: a tube whatever its family, but insulation, support, valves and consumables. */
const TUBE_WORDS = new Set(["tube", "tubes", "tuyau", "tuyaux"]);
/** Materials that name the trade of an article the workbook does not classify. */
const INSULATION_MATERIALS = ["calorifuge", "isolant", "kooltherm", "armaflex", "rockwool"];
const SUPPORT_MATERIALS = ["supportage", "collier"];
/** products.unit_price_cents is a PostgreSQL integer: a larger price would fail its whole chunk of drafts. */
const MAX_PRICE_CENTS = 2_147_483_647;
/** products.reference, compared case-insensitively: a cut reference could collide with another one. */
const MAX_REFERENCE_LENGTH = 255;
/**
 * Error values a spreadsheet shows in place of a result (Excel in English and in French, LibreOffice), compared
 * without accents nor case. The browser sends an error cell as this displayed text.
 */
const ERROR_TOKENS = new Set([
  "#NULL!", "#NUL!", "#DIV/0!", "#VALUE!", "#VALEUR!", "#REF!", "#NAME?", "#NOM?", "#NUM!", "#NOMBRE!", "#N/A", "#N/D",
  "#GETTING_DATA", "#ATTENTE_DONNEES", "#SPILL!", "#PROPAGATION!", "#CALC!", "#FIELD!", "#CHAMP!", "#BLOCKED!",
  "#BLOQUE!", "#CONNECT!", "#CONNEXION!", "#BUSY!", "#OCCUPE!", "#UNKNOWN!", "#INCONNU!", "#EXTERNAL!", "#ERROR!",
  "#ERREUR", "#ERREUR!",
]);
/** Text columns where an error is read as empty, and reported. */
const SECONDARY_TEXT_COLUMNS = ["Matériau", "Dimension", "Précision", "norme", "Unité", "Type FO"] as const;

const CATEGORY_OF_KIND: Record<CostingWorkbookSupplyKind, string> = {
  tube: "Tuyauterie",
  raccord: "Raccords",
  vanne: "Robinetterie",
  robinetterie: "Robinetterie",
  support: "Autres",
  calorifuge: "Autres",
  divers: "Autres",
};

const headerKey = (value: Cell) => foldText(text(value)).replace(/\s+/g, " ").trim();

function text(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isErrorToken(value: string): boolean {
  const folded = foldText(value.trim()).toUpperCase();
  return ERROR_TOKENS.has(folded) || /^ERR:\d{3}$/.test(folded);
}

/** A size column: the workbook's placeholders (« - », « / ») say nothing. */
function sizeText(value: Cell): string {
  const raw = text(value);
  return /^[-–—/\\]+$/.test(raw) ? "" : raw;
}

/** How a reference is compared: case and spaces aside, and without the « DB_<sheet>__ » prefix of an earlier import. */
export function workbookReferenceKey(reference: string): string {
  return reference.trim().replace(/^db_.*?__/i, "").toLocaleLowerCase("fr-FR");
}

export function workbookSupplierNameKey(name: string): string {
  return foldText(name).trim().replace(/\s+/g, " ");
}

/** Whole words that name where a price comes from: followed by a space or by nothing, they are never a product code. */
const PRICE_SOURCE_WORDS: Record<string, CostingWorkbookPriceSourceKind> = {
  devis: "quote", offre: "quote", cotation: "quote", commande: "order",
  document: "document", facture: "document", tarif: "document", catalogue: "document", prix: "document",
};
/** Abbreviations that are also the start of product codes (« DOC 42 »): a source only with a number or date marker. */
const PRICE_SOURCE_ABBREVIATIONS: Record<string, CostingWorkbookPriceSourceKind> = {
  doc: "document", fact: "document", bl: "document", cde: "order", cmd: "order", bc: "order",
};

/**
 * A supplier « reference » that names where a price comes from, not a product: « Devis n° 70102 », « Devis 70102 »,
 * « voir devis », « Tarif 2025 », « Cde n° 4412 », « BL du 12/03/2025 ». The word stands alone: « DOC-0042 » and
 * « DEVIS-DN40 » stay product references.
 */
function workbookPriceSource(value: string): CostingWorkbookPriceSourceKind | null {
  const normalized = foldText(value).replace(/\s+/g, " ").trim();
  if (/^(?:estimation par )?regression(?: |$)/.test(normalized)) return "regression";
  const match = /^(?:voir |cf\.? |selon |suivant |sur )?(?:bon de )?([a-z]+)(?: (.*))?$/.exec(normalized);
  if (!match) return null;
  const [, word, rest = ""] = match;
  if (PRICE_SOURCE_WORDS[word]) return PRICE_SOURCE_WORDS[word];
  const marked = /^(?:n ?[°ºo.]|num|numero|du |#)/.test(rest);
  return (marked && PRICE_SOURCE_ABBREVIATIONS[word]) || null;
}

/** Words the office writes where it has no reference: never a supplier's product code. */
const NO_REFERENCE_WORDS = new Set([
  "idem", "nc", "n c", "na", "n a", "neant", "aucun", "aucune", "inconnu", "inconnue", "rien", "a definir", "a voir",
  "a completer", "a preciser", "en attente", "tbd", "x", "xx", "xxx", "sans ref", "sans reference",
]);

/** « ? », « - », « / » and the like say nothing; « idem » or « N/C » say there is no code. */
function supplierCodeShape(value: string): "code" | "placeholder" | "word" {
  if (!/[\p{L}\p{N}]/u.test(value)) return "placeholder";
  return NO_REFERENCE_WORDS.has(foldWords(value)) ? "word" : "code";
}

type WorkbookSupplierValue = Pick<CostingWorkbookSupplierOccurrence, "supplier_sku" | "price_source_kind"> & {
  locations: Array<Pick<CostingWorkbookSupplierOccurrence, "row" | "slot" | "column">>;
};

/** Keeps the workbook comparison available even when the article or supplier is absent from the catalogue. */
export function compareCostingWorkbookSupplierValues(occurrences: readonly CostingWorkbookSupplierOccurrence[]) {
  const pairs = new Map<string, {
    articleReference: string;
    supplierName: string;
    values: Map<string, WorkbookSupplierValue>;
  }>();
  for (const entry of occurrences) {
    if (!entry.article_reference_valid || !entry.supplier_name_valid || !entry.supplier_sku_valid) continue;
    const key = JSON.stringify([workbookReferenceKey(entry.article_reference), workbookSupplierNameKey(entry.supplier_name)]);
    let pair = pairs.get(key);
    if (!pair) {
      pair = { articleReference: entry.article_reference, supplierName: entry.supplier_name, values: new Map() };
      pairs.set(key, pair);
    }
    let value = pair.values.get(entry.supplier_sku);
    if (!value) {
      value = { supplier_sku: entry.supplier_sku, price_source_kind: entry.price_source_kind, locations: [] };
      pair.values.set(entry.supplier_sku, value);
    }
    value.locations.push({ row: entry.row, slot: entry.slot, column: entry.column });
  }
  return [...pairs.entries()]
    .filter(([, pair]) => pair.values.size > 1)
    .map(([key, pair]) => ({ ...pair, key, values: [...pair.values.values()] }));
}

type HeaderScan = { index: number; columns: Map<Column, number>; missing: Column[]; labels: number };

/**
 * The first row that names every required column, else the row that names the most of them; between two such
 * rows, the one with the most labels: a title row above the headers holds one cell.
 */
function scanHeader(rows: readonly Cell[][]): HeaderScan | null {
  let best: HeaderScan | null = null;
  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index += 1) {
    const keys = (rows[index] ?? []).map(headerKey);
    const columns = new Map<Column, number>();
    for (const column of [...REQUIRED, ...OPTIONAL]) {
      const position = keys.indexOf(headerKey(column));
      if (position >= 0) columns.set(column, position);
    }
    const missing = REQUIRED.filter((column) => !columns.has(column));
    const labels = keys.filter(Boolean).length;
    if (missing.length === 0) return { index, columns, missing, labels };
    if (!best || missing.length < best.missing.length || (missing.length === best.missing.length && labels > best.labels)) {
      best = { index, columns, missing, labels };
    }
  }
  return best;
}

function findHeader(rows: readonly Cell[][]): { index: number; columns: Map<Column, number> } {
  const header = scanHeader(rows);
  if (header && header.missing.length === 0) return header;
  const missing = header?.missing ?? [...REQUIRED];
  throw new CostingWorkbookFormatError(
    `Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « ${COSTING_WORKBOOK_SHEET} ») : ${missing.join(", ")} manquantes.`,
  );
}

export function inspectCostingWorkbookColumns(rows: readonly Cell[][]): CostingWorkbookColumnInspection {
  const header = scanHeader(rows);
  if (!header) {
    return { headerRow: null, found: [], missingRequired: [...REQUIRED], missingOptional: [...OPTIONAL], unrecognised: [] };
  }
  const known = new Set(header.columns.values());
  return {
    headerRow: header.index + 1,
    found: [...header.columns.entries()].map(([column, index]) => ({ column, index })).sort((left, right) => left.index - right.index),
    missingRequired: header.missing,
    missingOptional: OPTIONAL.filter((column) => !header.columns.has(column)),
    unrecognised: (rows[header.index] ?? []).flatMap((value, index) => {
      const label = text(value);
      return label && !known.has(index) && !isErrorToken(label) ? [{ index, text: label }] : [];
    }),
  };
}

/** Reference cells are identifiers. Excel's number formatting can give them leading zeros. */
export function costingWorkbookReferenceColumns(rows: readonly Cell[][]): { headerRow: number; columns: number[] } | null {
  try {
    const header = findHeader(rows);
    return {
      headerRow: header.index,
      columns: (["ID", "F1_ref", "F2_ref", "F3_ref"] as const)
        .flatMap((column) => header.columns.get(column) ?? []),
    };
  } catch (error) {
    if (!(error instanceof CostingWorkbookFormatError)) throw error;
    return null;
  }
}

/**
 * The type of article: the wording before its details (« Bouchon mâle – fonte malléable » → « Bouchon mâle »,
 * « Mise en place - élément » → « Mise en place »). Only a spaced dash cuts: « T-Rex » stays whole.
 */
function productTypeOf(wording: string): string {
  const [head] = wording.split(/\s+[-–—]\s+/);
  return head.trim().slice(0, 200);
}

function contains(haystack: string, needle: string) {
  return foldText(haystack).replace(/\s+/g, "").includes(foldText(needle).replace(/\s+/g, ""));
}

/**
 * The wording, then « — material » unless it is a trade or already said, then the size unless already said,
 * then « (precision) » unless already said: two reduced tees of the same size differ by their precision alone.
 */
function designationOf(wording: string, material: string, dimension: string, precision: string): string {
  let designation = wording;
  if (material && !GENERIC_MATERIALS.has(foldText(material)) && !contains(wording, material)) {
    designation += ` — ${material}`;
  }
  if (dimension && !contains(designation, dimension)) designation += ` ${dimension}`;
  if (precision && !contains(designation, precision)) designation += ` (${precision})`;
  return designation.slice(0, 500);
}

/**
 * The supply type sets the estimate line's automatic K FO once the draft is validated (base 1,13 for tubes, 1,02
 * otherwise, insulation included): the families of insulation, support and valves decide; a tube is a tube in any other family
 * but consumables; a material family tells a fitting from a valve or a collar; an article of no family the reader
 * knows is classified by its material, else « divers ».
 */
function supplyKindOf(family: string, productType: string, material: string): { kind: CostingWorkbookSupplyKind; defaulted: boolean } {
  const decided = (kind: CostingWorkbookSupplyKind) => ({ kind, defaulted: false });
  const head = foldText(productType).split(/[^a-z0-9]+/).find(Boolean) ?? "";
  if (family === "CAL") return decided("calorifuge");
  if (family === "SUP") return decided("support");
  if (family === "ROB") return decided(head === "vanne" ? "vanne" : "robinetterie");
  if (family === "CONS") return decided("divers");
  if (TUBE_WORDS.has(head)) return decided("tube");
  if (MATERIAL_FAMILIES.has(family)) {
    if (head === "collier") return decided("support");
    if (head === "vanne") return decided("vanne");
    return decided("raccord");
  }
  const trade = foldText(material);
  if (INSULATION_MATERIALS.some((word) => trade.includes(word))) return decided("calorifuge");
  if (SUPPORT_MATERIALS.some((word) => trade.includes(word))) return decided("support");
  if (trade.includes("robinetterie")) return decided(head === "vanne" ? "vanne" : "robinetterie");
  return { kind: "divers", defaulted: true };
}

function gradeOf(material: string): string | null {
  if (!foldText(material).includes("inox")) return null;
  const match = /\b(\d{3})\s*(l|ti)?\b/i.exec(material);
  if (!match) return null;
  return `${match[1]}${match[2] ? (match[2].toLowerCase() === "ti" ? "Ti" : "L") : ""}`;
}

/**
 * A number is read natively, rounded half away from zero to the cent from its shortest decimal digits (Excel's
 * ROUND, PostgreSQL's round(numeric)): a formula's 12.345 is 12,35 €, its 3491.8000000000002 is 3 491,80 €. It
 * is how the application reads every spreadsheet amount (parseAmountCents, the DPGF import's unit prices too).
 * Text keeps the entry grammar: « 12,345 » is refused, not guessed.
 */
function priceOf(value: Cell): { cents: number; unreadable: boolean } {
  if (value === null || value === undefined || text(value) === "") return { cents: 0, unreadable: false };
  const cents = parseAmountCents(typeof value === "number" ? value : text(value));
  return cents === null || cents < 0 || cents > MAX_PRICE_CENTS ? { cents: 0, unreadable: true } : { cents, unreadable: false };
}

function reliabilityOf(value: Cell): { score: number | null; invalid: boolean } {
  if (value === null || value === undefined || text(value) === "") return { score: null, invalid: false };
  const score = typeof value === "number" ? value : Number(text(value).replace(",", "."));
  return Number.isInteger(score) && score >= 0 && score <= 10 ? { score, invalid: false } : { score: null, invalid: true };
}

function supplierReferencesOf(cell: (column: Column) => Cell): CostingWorkbookSupplierReference[] {
  const references: CostingWorkbookSupplierReference[] = [];
  const seen = new Set<string>();
  for (const slot of [1, 2, 3] as const) {
    const name = text(cell(`F${slot}_nom`));
    const sku = text(cell(`F${slot}_ref`));
    // A number alone is a placeholder of the workbook (« 1 », « 2 »), not a supplier.
    if (!name || !sku || /^\d+$/.test(name) || supplierCodeShape(sku) !== "code" || workbookPriceSource(sku)) continue;
    const key = `${foldText(name)}|${sku.toLocaleLowerCase("fr-FR")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const url = text(cell(`F${slot}_URL`));
    references.push({ supplier_name: name.slice(0, 255), supplier_sku: sku.slice(0, 255), product_url: /^https?:\/\//i.test(url) ? url.slice(0, 2000) : null });
  }
  return references;
}

export function readCostingWorkbookRows(rows: readonly Cell[][]): CostingWorkbookReadResult {
  const { index: headerIndex, columns } = findHeader(rows);
  const articles: CostingWorkbookArticle[] = [];
  const issues: CostingWorkbookIssue[] = [];
  const supplierReferenceOccurrences: CostingWorkbookSupplierOccurrence[] = [];
  const firstRowOf = new Map<string, number>();
  let sections = 0;

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const values = rows[index] ?? [];
    const cell = (column: Column): Cell => {
      const position = columns.get(column);
      return position === undefined ? null : values[position];
    };
    const sheetRow = index + 1;
    if (values.every((value) => text(value) === "")) continue;

    const kind = foldText(text(cell("Type_ligne")));
    if (kind === "rub") {
      sections += 1;
      continue;
    }
    const reference = text(cell("ID"));
    if (kind !== "art") {
      issues.push({ row: sheetRow, reference: reference || null, message: `Ligne de type « ${text(cell("Type_ligne")) || "vide"} » : ignorée.` });
      continue;
    }
    const wording = text(cell("Caractéristique"));
    const materialWording = text(cell("Matériau"));
    const dimensionWording = sizeText(cell("Dimension"));
    // Supplier identity depends on the article ID, even when the draft reader skips a repeated ID
    // or cannot use its designation. Keep every source cell for the decision report.
    for (const slot of [1, 2, 3] as const) {
      const name = text(cell(`F${slot}_nom`));
      const column = columns.get(`F${slot}_ref`);
      if (column === undefined) continue;
      const sku = text(values[column]);
      const shape = sku ? supplierCodeShape(sku) : "placeholder";
      if (shape === "placeholder") continue;
      supplierReferenceOccurrences.push({
        row: sheetRow,
        slot,
        column,
        article_column: columns.get("ID"),
        supplier_name_column: columns.get(`F${slot}_nom`),
        article_reference: reference,
        article_wording: isErrorToken(wording) ? "" : wording,
        article_material: isErrorToken(materialWording) ? "" : materialWording,
        article_dimension: isErrorToken(dimensionWording) ? "" : dimensionWording,
        supplier_name: name,
        supplier_sku: sku,
        article_reference_valid: reference.length > 0 && reference.length <= MAX_REFERENCE_LENGTH && !isErrorToken(reference),
        supplier_name_valid: Boolean(name) && !/^\d+$/.test(name) && !isErrorToken(name),
        supplier_sku_valid: sku.length <= 255 && !isErrorToken(sku) && shape === "code",
        price_source_kind: workbookPriceSource(sku),
      });
    }
    if (!reference) {
      issues.push({ row: sheetRow, reference: null, message: "Ligne sans référence (colonne ID) : ignorée." });
      continue;
    }
    if (isErrorToken(reference)) {
      issues.push({ row: sheetRow, reference: null, message: `Référence en erreur dans le classeur (${reference}) : ignorée.` });
      continue;
    }
    if (reference.length > MAX_REFERENCE_LENGTH) {
      issues.push({ row: sheetRow, reference, message: `Référence de plus de ${MAX_REFERENCE_LENGTH} caractères : ignorée.` });
      continue;
    }
    if (!wording) {
      issues.push({ row: sheetRow, reference, message: "Ligne sans caractéristique : ignorée." });
      continue;
    }
    if (isErrorToken(wording)) {
      issues.push({ row: sheetRow, reference, message: `Caractéristique en erreur dans le classeur (${wording}) : ignorée.` });
      continue;
    }
    const key = workbookReferenceKey(reference);
    const first = firstRowOf.get(key);
    if (first !== undefined) {
      issues.push({ row: sheetRow, reference, message: `Référence déjà lue ligne ${first} : ignorée.` });
      continue;
    }
    firstRowOf.set(key, sheetRow);

    // An error in a secondary column is read as empty; the row says so once, naming every such cell.
    const secondary = new Map<(typeof SECONDARY_TEXT_COLUMNS)[number], string>();
    const errorCells: string[] = [];
    for (const column of SECONDARY_TEXT_COLUMNS) {
      const raw = text(cell(column));
      if (isErrorToken(raw)) errorCells.push(`${column} : ${raw}`);
      secondary.set(column, isErrorToken(raw) ? "" : raw);
    }
    if (errorCells.length > 0) {
      issues.push({ row: sheetRow, reference, message: `Cellule en erreur dans le classeur (${errorCells.join(", ")}) : ignorée.` });
    }
    const material = secondary.get("Matériau") ?? "";
    const dimension = sizeText(secondary.get("Dimension"));
    const precision = sizeText(secondary.get("Précision"));
    const family = secondary.get("Type FO") ?? "";
    const productType = productTypeOf(wording);
    const { kind: supplyKind, defaulted: supplyTypeDefaulted } = supplyKindOf(family, productType, material);

    const price = priceOf(cell("PR. FO"));
    if (price.unreadable) {
      issues.push({ row: sheetRow, reference, message: `Prix « ${text(cell("PR. FO"))} » illisible : article importé sans prix.` });
    }
    const reliability = reliabilityOf(cell("Fiabilité (/10)"));
    if (reliability.invalid) {
      issues.push({ row: sheetRow, reference, message: `Fiabilité « ${text(cell("Fiabilité (/10)"))} » hors de 0 à 10 : ignorée.` });
    }
    const rawUnit = secondary.get("Unité") ?? "";
    if (!rawUnit) issues.push({ row: sheetRow, reference, message: "Unité absente : « u » retenue." });
    const unit = rawUnit ? (normalizeMeasurementUnit(rawUnit).unitCode ?? rawUnit).slice(0, 50) : "u";
    const dimensions = [dimension, precision].filter(Boolean).join(" — ").slice(0, 255) || null;

    articles.push({
      row: sheetRow,
      reference,
      designation: designationOf(wording, material, dimension, precision),
      product_type: productType || null,
      material: material.slice(0, 255) || null,
      grade: gradeOf(material),
      dimensions,
      standard: (secondary.get("norme") ?? "").slice(0, 255) || null,
      category: family === "CONS" ? "Consommables" : CATEGORY_OF_KIND[supplyKind],
      unit,
      unit_price_cents: price.cents,
      reliability_score: reliability.score,
      supply_type_code: supplyKind,
      family_code: family || null,
      supplier_references: supplierReferencesOf(cell),
      unit_defaulted: !rawUnit,
      supply_type_defaulted: supplyTypeDefaulted,
    });
  }

  return { articles, issues, sections, supplierReferenceOccurrences };
}
