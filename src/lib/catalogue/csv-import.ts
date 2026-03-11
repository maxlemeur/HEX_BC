import {
  bulkCreateSupplierPricesSchema,
  type BulkCreateSupplierPricesInput,
} from "@/lib/catalogue/schemas";
import { parseEuroToCents } from "@/lib/money";

export type CsvImportScalar = string | number | boolean | null | undefined;
export type CsvImportRow = Record<string, CsvImportScalar>;

export type PriceBookCsvTargetField =
  | "supplier_name"
  | "product_reference"
  | "product_designation"
  | "unit_price"
  | "currency";

export type PriceBookColumnMapping = Record<string, PriceBookCsvTargetField>;

export type PriceBookProfile = "generic" | "mm_bdc";

export type PriceBookMappedValues = {
  supplier_name: string;
  product_reference: string;
  product_designation: string;
  unit_price: string;
  currency: string;
};

export type PriceBookRowIssueCode =
  | "SUPPLIER_REQUIRED"
  | "SUPPLIER_UNKNOWN"
  | "SUPPLIER_AMBIGUOUS"
  | "PRODUCT_REQUIRED"
  | "PRODUCT_UNKNOWN"
  | "PRODUCT_AMBIGUOUS"
  | "PRICE_REQUIRED"
  | "PRICE_INVALID"
  | "PRICE_NON_POSITIVE"
  | "DUPLICATE_CANDIDATE"
  | "ZOD_VALIDATION_ERROR"
  | "NO_SUPPLIER_PRICE";

export type PriceBookRowIssue = {
  code: PriceBookRowIssueCode;
  message: string;
};

export type PriceBookIssueRow = {
  lineNumber: number;
  reason: string;
  errorCode: PriceBookRowIssueCode;
  rawSupplier: string;
  rawProduct: string;
  rawPrice: string;
  suggestedFix: string | null;
  issues: PriceBookRowIssue[];
};

export type PriceBookPreviewRow = {
  lineNumber: number;
  status: "valid" | "invalid" | "ignored";
  reason: string | null;
  values: PriceBookMappedValues;
  resolved?: {
    supplier_name?: string;
    product_name?: string;
  };
  metadata?: {
    supplierSource?: "F1" | "F2" | "F3" | null;
    autofilledSupplier?: boolean;
  };
};

export type PriceBookRejectedRow = PriceBookIssueRow;
export type PriceBookIgnoredRow = PriceBookIssueRow;

export type PriceBookValidationProgress = {
  processed: number;
  total: number;
  percentage: number;
};

export type PriceBookValidationResult = {
  acceptedItems: BulkCreateSupplierPricesInput;
  previewRows: PriceBookPreviewRow[];
  rejectedRows: PriceBookRejectedRow[];
  ignoredRows: PriceBookIgnoredRow[];
  totalRows: number;
  acceptedRows: number;
  rejectedRowsCount: number;
  ignoredRowsCount: number;
  autofilledSupplierCount: number;
  duplicateCandidatesCount: number;
  profile: PriceBookProfile;
};

export type PriceBookLookups = {
  suppliers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; reference?: string | null; designation: string }>;
};

export type ResolvedIdentifiers = {
  supplier_id: string | null;
  product_id: string | null;
  supplier_match: "exact" | "ambiguous" | "not_found";
  product_match: "exact" | "ambiguous" | "not_found";
  supplier_display?: string;
  product_display?: string;
};

export type ValidatePriceBookRowsOptions = {
  previewLimit?: number;
  chunkSize?: number;
  rowLineNumbers?: number[];
  lookups?: PriceBookLookups;
  profile?: PriceBookProfile;
  sourceImportId?: string | null;
  includeSupplierAlternatives?: boolean;
  autoFillSingleSupplier?: boolean;
  onProgress?: (progress: PriceBookValidationProgress) => void;
};

type NormalizedCandidate = {
  lineNumber: number;
  values: PriceBookMappedValues;
  metadata?: {
    supplierSource?: "F1" | "F2" | "F3" | null;
    autofilledSupplier?: boolean;
  };
};

type NormalizedPriceBookRowsResult = {
  candidates: NormalizedCandidate[];
  ignoredRows: PriceBookIgnoredRow[];
  autofilledSupplierCount: number;
};

const DEFAULT_CURRENCY = "EUR";
const DEFAULT_PREVIEW_LIMIT = 10;
const DEFAULT_CHUNK_SIZE = 250;
const MM_BDC_SIGNATURE_COLUMNS = ["ID", "F1_nom", "F1_prix", "F1_ref", "F1_URL"];

const PRICE_FIELD_LABELS: Record<string, string> = {
  supplier_id: "Fournisseur",
  product_id: "Produit",
  catalogue_item_id: "Article catalogue",
  unit_price_cents: "Prix unitaire",
  unit_price: "Prix unitaire",
  currency: "Devise",
  valid_from: "Date de debut",
  valid_to: "Date de fin",
};

const TARGET_FIELD_ALIASES: Record<PriceBookCsvTargetField, string[]> = {
  supplier_name: [
    "fournisseur",
    "supplier",
    "supplier_name",
    "nom fournisseur",
    "supplier name",
    "supplier id",
    "supplier_id",
    "supplier uuid",
    "fournisseur id",
    "id fournisseur",
    "id_fournisseur",
    "f1_nom",
    "f2_nom",
    "f3_nom",
  ],
  product_reference: [
    "reference",
    "ref",
    "product_ref",
    "reference produit",
    "ref produit",
    "product_id",
    "product id",
    "produit id",
    "sku",
    "code article",
    "id",
  ],
  product_designation: [
    "designation",
    "produit",
    "product",
    "product name",
    "nom produit",
    "article",
    "libelle",
    "materiau",
  ],
  unit_price: [
    "unit_price",
    "unit price",
    "unit price ht",
    "price",
    "prix",
    "prix unitaire",
    "prix ht",
    "tarif",
    "montant",
    "f1_prix",
    "f2_prix",
    "f3_prix",
    "pr fo",
  ],
  currency: ["currency", "currency code", "devise", "code devise", "devise code"],
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeHeaderToken(value: string): string {
  return stripAccents(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function coerceCellToString(value: CsvImportScalar): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  return "";
}

function readCellByHeader(row: CsvImportRow, header: string): string {
  if (Object.prototype.hasOwnProperty.call(row, header)) {
    return coerceCellToString(row[header]);
  }

  const normalizedHeader = normalizeHeaderToken(header);
  if (!normalizedHeader) return "";

  for (const [sourceColumn, value] of Object.entries(row)) {
    if (normalizeHeaderToken(sourceColumn) !== normalizedHeader) continue;
    return coerceCellToString(value);
  }

  return "";
}

function ensureCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  return normalized || DEFAULT_CURRENCY;
}

function buildTargetToSourceMap(
  mapping: PriceBookColumnMapping
): Partial<Record<PriceBookCsvTargetField, string>> {
  const targetToSource: Partial<Record<PriceBookCsvTargetField, string>> = {};

  for (const [sourceColumn, targetField] of Object.entries(mapping)) {
    if (!sourceColumn) continue;
    if (!targetField) continue;
    if (targetToSource[targetField]) continue;
    targetToSource[targetField] = sourceColumn;
  }

  return targetToSource;
}

function readMappedCell(
  row: CsvImportRow,
  targetToSource: Partial<Record<PriceBookCsvTargetField, string>>,
  target: PriceBookCsvTargetField
): string {
  const sourceColumn = targetToSource[target];
  if (!sourceColumn) return "";
  return coerceCellToString(row[sourceColumn]);
}

function scoreAliasMatch(normalizedHeader: string, alias: string): number {
  const normalizedAlias = normalizeHeaderToken(alias);
  if (!normalizedAlias) return 0;

  if (normalizedHeader === normalizedAlias) {
    return 120 + normalizedAlias.length;
  }

  if (normalizedHeader.includes(normalizedAlias)) {
    const totalPenalty = normalizedHeader.includes("total") ? 10 : 0;
    return 85 + normalizedAlias.length - totalPenalty;
  }

  const headerWords = normalizedHeader.split(" ").filter(Boolean);
  const aliasWords = normalizedAlias.split(" ").filter(Boolean);

  if (aliasWords.length > 1 && aliasWords.every((word) => headerWords.includes(word))) {
    return 70 + aliasWords.length;
  }

  return 0;
}

function waitForNextTick() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function resolveRowLineNumber(index: number, rowLineNumbers?: number[]): number {
  const candidate = rowLineNumbers?.[index];
  if (typeof candidate === "number" && Number.isInteger(candidate) && candidate > 0) {
    return candidate;
  }
  return index + 2;
}

const UUID_FIELDS = new Set(["supplier_id", "product_id", "catalogue_item_id"]);

function normalizeForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function joinNonEmpty(values: string[], separator = " - "): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(separator);
}

function suggestFixForIssue(code: PriceBookRowIssueCode): string | null {
  switch (code) {
    case "SUPPLIER_REQUIRED":
      return "Renseigner le fournisseur ou utiliser le bouton de resolution automatique.";
    case "SUPPLIER_UNKNOWN":
      return "Verifier le nom fournisseur ou creer le fournisseur manquant.";
    case "SUPPLIER_AMBIGUOUS":
      return "Preciser le nom exact du fournisseur pour lever l'ambiguite.";
    case "PRODUCT_REQUIRED":
      return "Renseigner une reference ou une designation produit.";
    case "PRODUCT_UNKNOWN":
      return "Verifier la reference produit ou creer le produit manquant.";
    case "PRODUCT_AMBIGUOUS":
      return "Preciser la reference produit pour lever l'ambiguite.";
    case "PRICE_REQUIRED":
      return "Renseigner un prix fournisseur positif.";
    case "PRICE_INVALID":
      return "Saisir un prix numerique (virgule ou point).";
    case "PRICE_NON_POSITIVE":
      return "Le prix doit etre strictement superieur a zero.";
    case "DUPLICATE_CANDIDATE":
      return "Doublon detecte dans ce fichier d'import.";
    case "NO_SUPPLIER_PRICE":
      return "Aucun prix fournisseur sur cette ligne.";
    case "ZOD_VALIDATION_ERROR":
      return "Verifier les champs obligatoires de la ligne.";
    default:
      return null;
  }
}

function buildIssueRow(input: {
  lineNumber: number;
  issues: PriceBookRowIssue[];
  values: PriceBookMappedValues;
}): PriceBookIssueRow {
  const uniqueIssues = input.issues.filter(
    (issue, index, list) => list.findIndex((entry) => entry.code === issue.code) === index
  );
  const firstIssue = uniqueIssues[0];
  const rawProduct = input.values.product_reference || input.values.product_designation;

  return {
    lineNumber: input.lineNumber,
    reason: uniqueIssues.map((issue) => issue.message).join(" "),
    errorCode: firstIssue?.code ?? "ZOD_VALIDATION_ERROR",
    rawSupplier: input.values.supplier_name,
    rawProduct,
    rawPrice: input.values.unit_price,
    suggestedFix: firstIssue ? suggestFixForIssue(firstIssue.code) : null,
    issues: uniqueIssues,
  };
}

function resolveIdentifiers(
  values: PriceBookMappedValues,
  lookups: PriceBookLookups
): ResolvedIdentifiers {
  const supplierToken = normalizeForMatch(values.supplier_name);
  let supplier_id: string | null = null;
  let supplier_match: ResolvedIdentifiers["supplier_match"] = "not_found";
  let supplier_display: string | undefined;

  if (supplierToken) {
    const matches = lookups.suppliers.filter(
      (supplier) => normalizeForMatch(supplier.name) === supplierToken
    );
    if (matches.length === 1) {
      supplier_id = matches[0].id;
      supplier_match = "exact";
      supplier_display = matches[0].name;
    } else if (matches.length > 1) {
      supplier_match = "ambiguous";
    }
  }

  const refToken = normalizeForMatch(values.product_reference);
  const designationToken = normalizeForMatch(values.product_designation);
  let product_id: string | null = null;
  let product_match: ResolvedIdentifiers["product_match"] = "not_found";
  let product_display: string | undefined;

  if (refToken) {
    const matches = lookups.products.filter(
      (product) => normalizeForMatch(product.reference ?? "") === refToken
    );
    if (matches.length === 1) {
      product_id = matches[0].id;
      product_match = "exact";
      product_display = matches[0].designation;
    } else if (matches.length > 1) {
      product_match = "ambiguous";
    }
  }

  if (!product_id && designationToken && product_match !== "ambiguous") {
    const matches = lookups.products.filter(
      (product) => normalizeForMatch(product.designation) === designationToken
    );
    if (matches.length === 1) {
      product_id = matches[0].id;
      product_match = "exact";
      product_display = matches[0].designation;
    } else if (matches.length > 1) {
      product_match = "ambiguous";
    }
  }

  return { supplier_id, product_id, supplier_match, product_match, supplier_display, product_display };
}

function humanizeZodMessage(rawField: string, message: string): string {
  if (
    UUID_FIELDS.has(rawField) &&
    message.toLowerCase().includes("identifiant invalide")
  ) {
    return "la valeur doit etre un UUID existant (voir pages Fournisseurs / Produits)";
  }
  return message;
}

function formatZodIssueMessages(
  issues: ReadonlyArray<{ path: Array<PropertyKey>; message: string }>
): string[] {
  return issues.map((issue) => {
    const path = issue.path.filter(
      (part) => part !== "items" && part !== 0 && part !== "action"
    );
    if (path.length === 0) return issue.message;
    const rawField = path.map(String).join(".");
    const label = PRICE_FIELD_LABELS[rawField] ?? rawField;
    return `${label}: ${humanizeZodMessage(rawField, issue.message)}`;
  });
}

function normalizeMMBdcSupplierNames(
  rows: CsvImportRow[],
  includeSupplierAlternatives: boolean
): { singleSupplierName: string | null } {
  const supplierNames = new Set<string>();
  const prefixes = includeSupplierAlternatives ? (["F1", "F2", "F3"] as const) : (["F1"] as const);

  for (const row of rows) {
    for (const prefix of prefixes) {
      const supplier = readCellByHeader(row, `${prefix}_nom`);
      const price = readCellByHeader(row, `${prefix}_prix`);
      if (!price || !supplier) continue;
      supplierNames.add(supplier);
    }
  }

  if (supplierNames.size !== 1) {
    return { singleSupplierName: null };
  }

  return { singleSupplierName: Array.from(supplierNames)[0] };
}

function normalizeGenericSupplierNames(
  rows: CsvImportRow[],
  mapping: PriceBookColumnMapping
): { singleSupplierName: string | null } {
  const supplierNames = new Set<string>();

  for (const row of rows) {
    const values = mapRowToPriceBookValues(row, mapping);
    if (!values.unit_price || !values.supplier_name) continue;
    supplierNames.add(values.supplier_name);
  }

  if (supplierNames.size !== 1) {
    return { singleSupplierName: null };
  }

  return { singleSupplierName: Array.from(supplierNames)[0] };
}

function normalizeMMBdcRows(
  rows: CsvImportRow[],
  options: Required<Pick<ValidatePriceBookRowsOptions, "rowLineNumbers">> & {
    includeSupplierAlternatives: boolean;
    autoFillSingleSupplier: boolean;
  }
): NormalizedPriceBookRowsResult {
  const candidates: NormalizedCandidate[] = [];
  const ignoredRows: PriceBookIgnoredRow[] = [];
  let autofilledSupplierCount = 0;

  const { singleSupplierName } = normalizeMMBdcSupplierNames(
    rows,
    options.includeSupplierAlternatives
  );
  const canAutofill = options.autoFillSingleSupplier && !!singleSupplierName;
  const prefixes = options.includeSupplierAlternatives
    ? (["F1", "F2", "F3"] as const)
    : (["F1"] as const);

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lineNumber = resolveRowLineNumber(index, options.rowLineNumbers);
    const productReference = readCellByHeader(row, "ID");
    const productDesignation = joinNonEmpty([
      readCellByHeader(row, "Materiau"),
      readCellByHeader(row, "Dimension"),
      readCellByHeader(row, "Caracteristique"),
      readCellByHeader(row, "Precision"),
    ]);

    let hasAtLeastOneSupplierPrice = false;

    for (const prefix of prefixes) {
      const unitPrice = readCellByHeader(row, `${prefix}_prix`);
      if (!unitPrice) continue;
      hasAtLeastOneSupplierPrice = true;

      const sourceSupplier = readCellByHeader(row, `${prefix}_nom`);
      const supplierName = sourceSupplier || (canAutofill ? singleSupplierName ?? "" : "");
      const autofilledSupplier = !sourceSupplier && !!supplierName && canAutofill;

      if (autofilledSupplier) {
        autofilledSupplierCount += 1;
      }

      candidates.push({
        lineNumber,
        values: {
          supplier_name: supplierName,
          product_reference: productReference,
          product_designation: productDesignation,
          unit_price: unitPrice,
          currency: readCellByHeader(row, "Devise"),
        },
        metadata: {
          supplierSource: prefix,
          autofilledSupplier,
        },
      });
    }

    if (!hasAtLeastOneSupplierPrice) {
      const ignored = buildIssueRow({
        lineNumber,
        issues: [{
          code: "NO_SUPPLIER_PRICE",
          message: "Ligne ignoree: aucun prix fournisseur renseigne.",
        }],
        values: {
          supplier_name: "",
          product_reference: productReference,
          product_designation: productDesignation,
          unit_price: "",
          currency: "",
        },
      });

      ignoredRows.push(ignored);
    }
  }

  return {
    candidates,
    ignoredRows,
    autofilledSupplierCount,
  };
}

function normalizeGenericRows(
  rows: CsvImportRow[],
  mapping: PriceBookColumnMapping,
  options: Required<Pick<ValidatePriceBookRowsOptions, "rowLineNumbers">> & {
    autoFillSingleSupplier: boolean;
  }
): NormalizedPriceBookRowsResult {
  const candidates: NormalizedCandidate[] = [];
  const ignoredRows: PriceBookIgnoredRow[] = [];
  let autofilledSupplierCount = 0;

  const { singleSupplierName } = normalizeGenericSupplierNames(rows, mapping);
  const canAutofill = options.autoFillSingleSupplier && !!singleSupplierName;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lineNumber = resolveRowLineNumber(index, options.rowLineNumbers);
    const values = mapRowToPriceBookValues(row, mapping);
    const shouldAutofill = !values.supplier_name && !!values.unit_price && canAutofill;

    if (shouldAutofill) {
      values.supplier_name = singleSupplierName ?? "";
      autofilledSupplierCount += 1;
    }

    candidates.push({
      lineNumber,
      values,
      metadata: {
        supplierSource: null,
        autofilledSupplier: shouldAutofill,
      },
    });
  }

  return {
    candidates,
    ignoredRows,
    autofilledSupplierCount,
  };
}

function normalizePriceBookRows(
  rows: CsvImportRow[],
  mapping: PriceBookColumnMapping,
  options: Required<Pick<ValidatePriceBookRowsOptions, "rowLineNumbers">> & {
    profile: PriceBookProfile;
    includeSupplierAlternatives: boolean;
    autoFillSingleSupplier: boolean;
  }
): NormalizedPriceBookRowsResult {
  if (options.profile === "mm_bdc") {
    return normalizeMMBdcRows(rows, {
      rowLineNumbers: options.rowLineNumbers,
      includeSupplierAlternatives: options.includeSupplierAlternatives,
      autoFillSingleSupplier: options.autoFillSingleSupplier,
    });
  }

  return normalizeGenericRows(rows, mapping, {
    rowLineNumbers: options.rowLineNumbers,
    autoFillSingleSupplier: options.autoFillSingleSupplier,
  });
}

function pushPreviewRow(
  previewRows: PriceBookPreviewRow[],
  previewLimit: number,
  row: PriceBookPreviewRow
) {
  if (previewRows.length >= previewLimit) return;
  previewRows.push(row);
}

export function extractPriceBookSourceColumns(rows: CsvImportRow[]): string[] {
  const columns: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push(key);
    }
  }

  return columns;
}

export function detectPriceBookProfile(sourceColumns: string[]): PriceBookProfile {
  const normalized = new Set(sourceColumns.map((column) => normalizeHeaderToken(column)));

  const hits = MM_BDC_SIGNATURE_COLUMNS.reduce((count, signatureColumn) => {
    const signatureToken = normalizeHeaderToken(signatureColumn);
    return count + (normalized.has(signatureToken) ? 1 : 0);
  }, 0);

  return hits >= 3 ? "mm_bdc" : "generic";
}

export function suggestPriceBookColumnMapping(
  sourceColumns: string[]
): PriceBookColumnMapping {
  type Candidate = {
    sourceColumn: string;
    sourceIndex: number;
    target: PriceBookCsvTargetField;
    score: number;
  };

  const candidates: Candidate[] = [];

  sourceColumns.forEach((sourceColumn, sourceIndex) => {
    const normalizedHeader = normalizeHeaderToken(sourceColumn);
    if (!normalizedHeader) return;

    (Object.keys(TARGET_FIELD_ALIASES) as PriceBookCsvTargetField[]).forEach((target) => {
      const aliases = TARGET_FIELD_ALIASES[target];
      let bestScore = 0;

      aliases.forEach((alias) => {
        bestScore = Math.max(bestScore, scoreAliasMatch(normalizedHeader, alias));
      });

      if (bestScore > 0) {
        candidates.push({ sourceColumn, sourceIndex, target, score: bestScore });
      }
    });
  });

  candidates.sort((left, right) => {
    if (left.score !== right.score) return right.score - left.score;
    return left.sourceIndex - right.sourceIndex;
  });

  const mapping: PriceBookColumnMapping = {};
  const usedSources = new Set<string>();
  const usedTargets = new Set<PriceBookCsvTargetField>();

  for (const candidate of candidates) {
    if (usedSources.has(candidate.sourceColumn)) continue;
    if (usedTargets.has(candidate.target)) continue;

    mapping[candidate.sourceColumn] = candidate.target;
    usedSources.add(candidate.sourceColumn);
    usedTargets.add(candidate.target);
  }

  return mapping;
}

export function suggestPriceBookColumnMappingForProfile(
  sourceColumns: string[],
  profile: PriceBookProfile
): PriceBookColumnMapping {
  const baseMapping = suggestPriceBookColumnMapping(sourceColumns);
  if (profile !== "mm_bdc") {
    return baseMapping;
  }

  const sourceSet = new Set(sourceColumns);

  const defaults: Array<[string, PriceBookCsvTargetField]> = [
    ["F1_nom", "supplier_name"],
    ["ID", "product_reference"],
    ["F1_prix", "unit_price"],
  ];

  const mapping = { ...baseMapping };
  const usedTargets = new Set(Object.values(mapping));

  for (const [sourceColumn, target] of defaults) {
    if (!sourceSet.has(sourceColumn)) continue;
    if (usedTargets.has(target)) continue;
    mapping[sourceColumn] = target;
    usedTargets.add(target);
  }

  if (sourceSet.has("Devise") && !usedTargets.has("currency")) {
    mapping.Devise = "currency";
  }

  return mapping;
}

export function hasMinimumPriceBookMapping(mapping: PriceBookColumnMapping): boolean {
  const targets = new Set(Object.values(mapping));
  const hasSupplier = targets.has("supplier_name");
  const hasPrice = targets.has("unit_price");
  const hasProduct = targets.has("product_reference") || targets.has("product_designation");
  return hasSupplier && hasPrice && hasProduct;
}

export function mapRowToPriceBookValues(
  row: CsvImportRow,
  mapping: PriceBookColumnMapping
): PriceBookMappedValues {
  const targetToSource = buildTargetToSourceMap(mapping);

  return {
    supplier_name: readMappedCell(row, targetToSource, "supplier_name"),
    product_reference: readMappedCell(row, targetToSource, "product_reference"),
    product_designation: readMappedCell(row, targetToSource, "product_designation"),
    unit_price: readMappedCell(row, targetToSource, "unit_price"),
    currency: readMappedCell(row, targetToSource, "currency"),
  };
}

export async function validatePriceBookRows(
  rows: CsvImportRow[],
  mapping: PriceBookColumnMapping,
  options: ValidatePriceBookRowsOptions = {}
): Promise<PriceBookValidationResult> {
  const previewLimit = Math.max(0, options.previewLimit ?? DEFAULT_PREVIEW_LIMIT);
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
  const profile = options.profile ?? "generic";
  const includeSupplierAlternatives =
    options.includeSupplierAlternatives ?? profile === "mm_bdc";
  const autoFillSingleSupplier = options.autoFillSingleSupplier ?? true;

  const normalizedRows = normalizePriceBookRows(rows, mapping, {
    rowLineNumbers: options.rowLineNumbers ?? [],
    profile,
    includeSupplierAlternatives,
    autoFillSingleSupplier,
  });

  const acceptedItems: BulkCreateSupplierPricesInput = [];
  const previewRows: PriceBookPreviewRow[] = [];
  const rejectedRows: PriceBookRejectedRow[] = [];
  const ignoredRows: PriceBookIgnoredRow[] = [...normalizedRows.ignoredRows];
  const baseIgnoredRowsCount = ignoredRows.length;
  const dedupeKeys = new Set<string>();
  let duplicateCandidatesCount = 0;

  const totalRows = normalizedRows.candidates.length + baseIgnoredRowsCount;

  options.onProgress?.({
    processed: 0,
    total: totalRows,
    percentage: totalRows === 0 ? 100 : 0,
  });

  ignoredRows.slice(0, previewLimit).forEach((ignoredRow) => {
    pushPreviewRow(previewRows, previewLimit, {
      lineNumber: ignoredRow.lineNumber,
      status: "ignored",
      reason: ignoredRow.reason,
      values: {
        supplier_name: ignoredRow.rawSupplier,
        product_reference: ignoredRow.rawProduct,
        product_designation: "",
        unit_price: ignoredRow.rawPrice,
        currency: DEFAULT_CURRENCY,
      },
      metadata: {
        supplierSource: null,
        autofilledSupplier: false,
      },
    });
  });

  for (let start = 0; start < normalizedRows.candidates.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, normalizedRows.candidates.length);

    for (let index = start; index < end; index += 1) {
      const candidate = normalizedRows.candidates[index];
      const mappedValues = candidate.values;
      const issues: PriceBookRowIssue[] = [];
      let resolvedSupplierId: string | undefined;
      let resolvedProductId: string | undefined;
      let resolvedInfo: ResolvedIdentifiers | undefined;

      if (options.lookups) {
        const hasSupplierInput = !!mappedValues.supplier_name;
        const hasProductInput = !!mappedValues.product_reference || !!mappedValues.product_designation;

        if (!hasSupplierInput) {
          issues.push({ code: "SUPPLIER_REQUIRED", message: "Fournisseur requis." });
        }
        if (!hasProductInput) {
          issues.push({
            code: "PRODUCT_REQUIRED",
            message: "Produit requis (reference ou designation).",
          });
        }

        if (hasSupplierInput || hasProductInput) {
          resolvedInfo = resolveIdentifiers(mappedValues, options.lookups);

          if (hasSupplierInput) {
            if (resolvedInfo.supplier_match === "not_found") {
              issues.push({
                code: "SUPPLIER_UNKNOWN",
                message: `Fournisseur inconnu : "${mappedValues.supplier_name}". Verifiez le nom dans la page Fournisseurs.`,
              });
            } else if (resolvedInfo.supplier_match === "ambiguous") {
              issues.push({
                code: "SUPPLIER_AMBIGUOUS",
                message: `Fournisseur ambigu : "${mappedValues.supplier_name}". Plusieurs fournisseurs correspondent.`,
              });
            } else {
              resolvedSupplierId = resolvedInfo.supplier_id ?? undefined;
            }
          }

          if (hasProductInput) {
            if (resolvedInfo.product_match === "not_found") {
              const searchValue = mappedValues.product_reference || mappedValues.product_designation;
              issues.push({
                code: "PRODUCT_UNKNOWN",
                message: `Produit inconnu : "${searchValue}". Verifiez la reference ou designation dans la page Produits.`,
              });
            } else if (resolvedInfo.product_match === "ambiguous") {
              const searchValue = mappedValues.product_reference || mappedValues.product_designation;
              issues.push({
                code: "PRODUCT_AMBIGUOUS",
                message: `Produit ambigu : "${searchValue}". Plusieurs produits correspondent.`,
              });
            } else {
              resolvedProductId = resolvedInfo.product_id ?? undefined;
            }
          }
        }
      }

      if (!mappedValues.unit_price) {
        issues.push({ code: "PRICE_REQUIRED", message: "Prix unitaire manquant." });
      }

      const parsedPriceCents = mappedValues.unit_price
        ? parseEuroToCents(mappedValues.unit_price)
        : null;

      if (mappedValues.unit_price && parsedPriceCents === null) {
        issues.push({ code: "PRICE_INVALID", message: "Prix non numerique." });
      }

      if (typeof parsedPriceCents === "number" && parsedPriceCents <= 0) {
        issues.push({ code: "PRICE_NON_POSITIVE", message: "Prix doit etre strictement positif." });
      }

      const rowCurrency = ensureCurrency(mappedValues.currency);

      if (
        issues.length === 0 &&
        resolvedSupplierId &&
        resolvedProductId &&
        typeof parsedPriceCents === "number"
      ) {
        const dedupeKey = [resolvedSupplierId, resolvedProductId, rowCurrency, parsedPriceCents].join("|");
        if (dedupeKeys.has(dedupeKey)) {
          issues.push({
            code: "DUPLICATE_CANDIDATE",
            message: "Doublon detecte dans le fichier d'import.",
          });
        } else {
          dedupeKeys.add(dedupeKey);
        }
      }

      const item: BulkCreateSupplierPricesInput[number] = {
        supplier_id: resolvedSupplierId ?? "",
        product_id: resolvedProductId ?? undefined,
        catalogue_item_id: undefined,
        supplier_sku: null,
        unit: null,
        min_quantity: null,
        unit_price_cents: typeof parsedPriceCents === "number" ? parsedPriceCents : 0,
        currency: rowCurrency,
        valid_from: null,
        valid_to: null,
        source_import_id: options.sourceImportId ?? null,
        source_mapped_row_id: null,
        source: null,
        notes: null,
        external_ref: null,
      };

      if (issues.length === 0) {
        const parseResult = bulkCreateSupplierPricesSchema.safeParse({
          action: "bulk-create",
          items: [item],
        });

        if (!parseResult.success) {
          const zodMessage = formatZodIssueMessages(parseResult.error.issues).join(" ");
          issues.push({
            code: "ZOD_VALIDATION_ERROR",
            message: zodMessage || "Validation impossible.",
          });
        }
      }

      const hasIssues = issues.length > 0;
      const issueRow = hasIssues
        ? buildIssueRow({
            lineNumber: candidate.lineNumber,
            issues,
            values: {
              ...mappedValues,
              currency: rowCurrency,
            },
          })
        : null;

      if (!hasIssues) {
        acceptedItems.push(item);
      } else if (issueRow?.errorCode === "DUPLICATE_CANDIDATE") {
        duplicateCandidatesCount += 1;
        ignoredRows.push(issueRow);
      } else if (issueRow) {
        rejectedRows.push(issueRow);
      }

      const status: PriceBookPreviewRow["status"] = !hasIssues
        ? "valid"
        : issueRow?.errorCode === "DUPLICATE_CANDIDATE"
          ? "ignored"
          : "invalid";

      pushPreviewRow(previewRows, previewLimit, {
        lineNumber: candidate.lineNumber,
        status,
        reason: issueRow?.reason ?? null,
        values: {
          ...mappedValues,
          currency: rowCurrency,
        },
        resolved: resolvedInfo
          ? {
              supplier_name: resolvedInfo.supplier_display,
              product_name: resolvedInfo.product_display,
            }
          : undefined,
        metadata: candidate.metadata,
      });
    }

    const processed = end + baseIgnoredRowsCount;
    options.onProgress?.({
      processed,
      total: totalRows,
      percentage: totalRows === 0 ? 100 : Math.min(100, Math.round((processed / totalRows) * 100)),
    });

    if (end < normalizedRows.candidates.length) {
      await waitForNextTick();
    }
  }

  options.onProgress?.({
    processed: totalRows,
    total: totalRows,
    percentage: 100,
  });

  return {
    acceptedItems,
    previewRows,
    rejectedRows,
    ignoredRows,
    totalRows,
    acceptedRows: acceptedItems.length,
    rejectedRowsCount: rejectedRows.length,
    ignoredRowsCount: ignoredRows.length,
    autofilledSupplierCount: normalizedRows.autofilledSupplierCount,
    duplicateCandidatesCount,
    profile,
  };
}
