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

export type PriceBookMappedValues = {
  supplier_name: string;
  product_reference: string;
  product_designation: string;
  unit_price: string;
  currency: string;
};

export type PriceBookPreviewRow = {
  lineNumber: number;
  status: "valid" | "invalid";
  reason: string | null;
  values: PriceBookMappedValues;
  resolved?: {
    supplier_name?: string;
    product_name?: string;
  };
};

export type PriceBookRejectedRow = {
  lineNumber: number;
  reason: string;
};

export type PriceBookValidationProgress = {
  processed: number;
  total: number;
  percentage: number;
};

export type PriceBookValidationResult = {
  acceptedItems: BulkCreateSupplierPricesInput;
  previewRows: PriceBookPreviewRow[];
  rejectedRows: PriceBookRejectedRow[];
  totalRows: number;
  acceptedRows: number;
  rejectedRowsCount: number;
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
  onProgress?: (progress: PriceBookValidationProgress) => void;
};

const DEFAULT_CURRENCY = "EUR";
const DEFAULT_PREVIEW_LIMIT = 10;
const DEFAULT_CHUNK_SIZE = 250;

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
  ],
  product_designation: [
    "designation",
    "produit",
    "product",
    "product name",
    "nom produit",
    "article",
    "libelle",
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
    return 85 + normalizedAlias.length;
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

function resolveIdentifiers(
  values: PriceBookMappedValues,
  lookups: PriceBookLookups
): ResolvedIdentifiers {
  // --- Fournisseur ---
  const supplierToken = normalizeForMatch(values.supplier_name);
  let supplier_id: string | null = null;
  let supplier_match: ResolvedIdentifiers["supplier_match"] = "not_found";
  let supplier_display: string | undefined;

  if (supplierToken) {
    const matches = lookups.suppliers.filter(
      (s) => normalizeForMatch(s.name) === supplierToken
    );
    if (matches.length === 1) {
      supplier_id = matches[0].id;
      supplier_match = "exact";
      supplier_display = matches[0].name;
    } else if (matches.length > 1) {
      supplier_match = "ambiguous";
    }
  }

  // --- Produit : reference > designation ---
  const refToken = normalizeForMatch(values.product_reference);
  const desigToken = normalizeForMatch(values.product_designation);
  let product_id: string | null = null;
  let product_match: ResolvedIdentifiers["product_match"] = "not_found";
  let product_display: string | undefined;

  if (refToken) {
    const matches = lookups.products.filter(
      (p) => normalizeForMatch(p.reference ?? "") === refToken
    );
    if (matches.length === 1) {
      product_id = matches[0].id;
      product_match = "exact";
      product_display = matches[0].designation;
    } else if (matches.length > 1) {
      product_match = "ambiguous";
    }
  }

  if (!product_id && desigToken && product_match !== "ambiguous") {
    const matches = lookups.products.filter(
      (p) => normalizeForMatch(p.designation) === desigToken
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
  const totalRows = rows.length;
  const acceptedItems: BulkCreateSupplierPricesInput = [];
  const previewRows: PriceBookPreviewRow[] = [];
  const rejectedRows: PriceBookRejectedRow[] = [];

  options.onProgress?.({
    processed: 0,
    total: totalRows,
    percentage: totalRows === 0 ? 100 : 0,
  });

  for (let start = 0; start < totalRows; start += chunkSize) {
    const end = Math.min(start + chunkSize, totalRows);

    for (let index = start; index < end; index += 1) {
      const row = rows[index];
      const lineNumber = resolveRowLineNumber(index, options.rowLineNumbers);
      const mappedValues = mapRowToPriceBookValues(row, mapping);
      const reasons: string[] = [];

      // --- Resolution par noms metier ---
      let resolvedSupplierId: string | undefined;
      let resolvedProductId: string | undefined;
      let resolvedInfo: ResolvedIdentifiers | undefined;

      if (options.lookups) {
        const hasSupplierInput = !!mappedValues.supplier_name;
        const hasProductInput = !!mappedValues.product_reference || !!mappedValues.product_designation;

        if (!hasSupplierInput) {
          reasons.push("Fournisseur requis.");
        }
        if (!hasProductInput) {
          reasons.push("Produit requis (reference ou designation).");
        }

        if (hasSupplierInput || hasProductInput) {
          resolvedInfo = resolveIdentifiers(mappedValues, options.lookups);

          if (hasSupplierInput) {
            if (resolvedInfo.supplier_match === "not_found") {
              reasons.push(`Fournisseur inconnu : "${mappedValues.supplier_name}". Verifiez le nom dans la page Fournisseurs.`);
            } else if (resolvedInfo.supplier_match === "ambiguous") {
              reasons.push(`Fournisseur ambigu : "${mappedValues.supplier_name}". Plusieurs fournisseurs correspondent.`);
            } else {
              resolvedSupplierId = resolvedInfo.supplier_id!;
            }
          }

          if (hasProductInput) {
            if (resolvedInfo.product_match === "not_found") {
              const searchValue = mappedValues.product_reference || mappedValues.product_designation;
              reasons.push(`Produit inconnu : "${searchValue}". Verifiez la reference ou designation dans la page Produits.`);
            } else if (resolvedInfo.product_match === "ambiguous") {
              const searchValue = mappedValues.product_reference || mappedValues.product_designation;
              reasons.push(`Produit ambigu : "${searchValue}". Plusieurs produits correspondent.`);
            } else {
              resolvedProductId = resolvedInfo.product_id!;
            }
          }
        }
      }

      if (!mappedValues.unit_price) {
        reasons.push("Prix unitaire manquant.");
      }

      const parsedPriceCents = mappedValues.unit_price
        ? parseEuroToCents(mappedValues.unit_price)
        : null;

      if (mappedValues.unit_price && parsedPriceCents === null) {
        reasons.push("Prix non numerique.");
      }

      if (typeof parsedPriceCents === "number" && parsedPriceCents <= 0) {
        reasons.push("Prix doit etre strictement positif.");
      }

      const rowCurrency = ensureCurrency(mappedValues.currency);
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
        source_import_id: null,
        source_mapped_row_id: null,
        source: null,
        notes: null,
        external_ref: null,
      };

      // Only run Zod validation if resolution passed (we have IDs)
      if (reasons.length === 0) {
        const parseResult = bulkCreateSupplierPricesSchema.safeParse({
          action: "bulk-create",
          items: [item],
        });

        if (!parseResult.success) {
          reasons.push(...formatZodIssueMessages(parseResult.error.issues));
        }
      }

      const uniqueReasons = Array.from(new Set(reasons));
      const isValid = uniqueReasons.length === 0;

      if (isValid) {
        acceptedItems.push(item);
      } else {
        rejectedRows.push({
          lineNumber,
          reason: uniqueReasons.join(" "),
        });
      }

      if (previewRows.length < previewLimit) {
        previewRows.push({
          lineNumber,
          status: isValid ? "valid" : "invalid",
          reason: isValid ? null : uniqueReasons.join(" "),
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
        });
      }
    }

    const processed = end;
    options.onProgress?.({
      processed,
      total: totalRows,
      percentage: totalRows === 0 ? 100 : Math.round((processed / totalRows) * 100),
    });

    if (end < totalRows) {
      await waitForNextTick();
    }
  }

  return {
    acceptedItems,
    previewRows,
    rejectedRows,
    totalRows,
    acceptedRows: acceptedItems.length,
    rejectedRowsCount: rejectedRows.length,
  };
}
