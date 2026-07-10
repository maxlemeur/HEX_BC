import * as XLSX from "xlsx";

export const TEMPLATE_VERSION = "1.0";
export const TEMPLATE_FILE_URL = "/templates/hex-bc-produits-tarifs-v1.xlsx";

const INSTRUCTIONS_SHEET = "Mode d'emploi" as const;
const PRODUCTS_SHEET = "Produits" as const;
const PRICES_SHEET = "Tarifs fournisseurs" as const;

const PRODUCT_HEADERS = [
  "reference",
  "designation",
  "famille",
  "type_produit",
  "matiere",
  "nuance",
  "dimensions",
  "norme",
  "unite",
  "prix_reference_ht",
  "tva",
] as const;

const PRICE_HEADERS = [
  "reference_produit",
  "fournisseur",
  "reference_fournisseur",
  "prix_unitaire_ht",
  "unite",
  "devise",
  "date_prix",
  "quantite_minimale",
  "url_source",
  "commentaire",
] as const;

type ProductPriceTemplateSheet =
  | typeof INSTRUCTIONS_SHEET
  | typeof PRODUCTS_SHEET
  | typeof PRICES_SHEET;

export type ProductTemplateRow = {
  reference: string;
  designation: string;
  category: string | null;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  unit: string;
  unit_price_cents: number;
  tax_rate_bp: number;
  is_active: true;
};

export type SupplierPriceTemplateRow = {
  product_reference: string;
  supplier_name: string;
  supplier_sku: string | null;
  unit_price_cents: number;
  unit: string;
  currency: string;
  valid_from: string;
  min_quantity: number;
  source_url: string | null;
  comment: string | null;
};

export type ProductPriceTemplateIssue = {
  sheet: ProductPriceTemplateSheet;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
  blocking: boolean;
};

export type ProductPriceTemplateParseResult = {
  products: ProductTemplateRow[];
  prices: SupplierPriceTemplateRow[];
  issues: ProductPriceTemplateIssue[];
  hasBlockingIssues: boolean;
  version: string | null;
};

type WorkbookCell = string | number | boolean | Date | null | undefined;

function addBlockingIssue(
  issues: ProductPriceTemplateIssue[],
  issue: Omit<ProductPriceTemplateIssue, "blocking">
) {
  issues.push({ ...issue, blocking: true });
}

function textValue(value: WorkbookCell): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return formatDate(value);
  return String(value).trim();
}

function optionalText(value: WorkbookCell): string | null {
  return textValue(value) || null;
}

function isEmptyRow(row: WorkbookCell[]): boolean {
  return row.every((cell) => textValue(cell) === "");
}

function parseLocalizedNumber(value: WorkbookCell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const compact = value
    .trim()
    .replace(/[€%]/g, "")
    .replace(/[\s\u00A0\u202F]/g, "");
  if (!compact) return null;

  const decimalSeparator = compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
  const normalized = compact
    .replace(decimalSeparator === "," ? /\./g : /,/g, "")
    .replace(decimalSeparator, ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isRealIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseDate(value: WorkbookCell): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const formatted = formatDate(value);
    return isRealIsoDate(formatted) ? formatted : null;
  }

  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const formatted = `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    return isRealIsoDate(formatted) ? formatted : null;
  }

  const text = textValue(value);
  return isRealIsoDate(text) ? text : null;
}

function normalizedReference(value: string): string {
  return value.toLocaleLowerCase("fr-FR");
}

function sheetRows(sheet: XLSX.WorkSheet): WorkbookCell[][] {
  return XLSX.utils.sheet_to_json<WorkbookCell[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: true,
  });
}

function validateHeaders(
  sheet: XLSX.WorkSheet,
  sheetName: ProductPriceTemplateSheet,
  expectedHeaders: readonly string[],
  issues: ProductPriceTemplateIssue[]
): WorkbookCell[][] | null {
  const rows = sheetRows(sheet);
  const rawHeaders = rows[0] ?? [];
  const headers = rawHeaders.map(textValue);
  while (headers.at(-1) === "") headers.pop();

  const areExact =
    headers.length === expectedHeaders.length &&
    expectedHeaders.every((expected, index) => headers[index] === expected);

  if (!areExact) {
    const mismatchIndex = expectedHeaders.findIndex((expected, index) => headers[index] !== expected);
    const column =
      mismatchIndex >= 0
        ? expectedHeaders[mismatchIndex]
        : headers.length > expectedHeaders.length
          ? headers[expectedHeaders.length]
          : null;
    addBlockingIssue(issues, {
      sheet: sheetName,
      row: 1,
      column,
      code: "INVALID_HEADERS",
      message: `Les en-tetes de la feuille \"${sheetName}\" doivent etre exactement : ${expectedHeaders.join(", ")}.`,
    });
    return null;
  }

  return rows;
}

function parseProducts(
  rows: WorkbookCell[][],
  issues: ProductPriceTemplateIssue[]
): ProductTemplateRow[] {
  const products: ProductTemplateRow[] = [];
  const referenceRows = new Map<string, number>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (isEmptyRow(row)) return;

    const reference = textValue(row[0]);
    const designation = textValue(row[1]);
    const unit = textValue(row[8]) || "u";
    const priceCell = row[9];
    const taxCell = row[10];
    const unitPrice = textValue(priceCell) === "" ? 0 : parseLocalizedNumber(priceCell);
    const taxRate = textValue(taxCell) === "" ? 20 : parseLocalizedNumber(taxCell);
    const rowIssuesBefore = issues.length;

    if (!reference) {
      addBlockingIssue(issues, {
        sheet: PRODUCTS_SHEET,
        row: rowNumber,
        column: "reference",
        code: "PRODUCT_REFERENCE_REQUIRED",
        message: "La reference du produit est obligatoire.",
      });
    } else {
      const normalized = normalizedReference(reference);
      const firstRow = referenceRows.get(normalized);
      if (firstRow !== undefined) {
        addBlockingIssue(issues, {
          sheet: PRODUCTS_SHEET,
          row: rowNumber,
          column: "reference",
          code: "PRODUCT_REFERENCE_COLLISION",
          message: `La reference \"${reference}\" entre en collision, sans distinction de casse, avec la ligne ${firstRow}.`,
        });
      } else {
        referenceRows.set(normalized, rowNumber);
      }
    }

    if (!designation) {
      addBlockingIssue(issues, {
        sheet: PRODUCTS_SHEET,
        row: rowNumber,
        column: "designation",
        code: "PRODUCT_DESIGNATION_REQUIRED",
        message: "La designation du produit est obligatoire.",
      });
    }

    if (unitPrice === null || unitPrice < 0) {
      addBlockingIssue(issues, {
        sheet: PRODUCTS_SHEET,
        row: rowNumber,
        column: "prix_reference_ht",
        code: "PRODUCT_PRICE_INVALID",
        message: "Le prix de reference HT doit etre un nombre superieur ou egal a 0.",
      });
    }

    if (taxRate === null || taxRate < 0 || taxRate > 100) {
      addBlockingIssue(issues, {
        sheet: PRODUCTS_SHEET,
        row: rowNumber,
        column: "tva",
        code: "PRODUCT_TAX_INVALID",
        message: "La TVA doit etre un nombre compris entre 0 et 100.",
      });
    }

    if (issues.length !== rowIssuesBefore || unitPrice === null || taxRate === null) return;

    products.push({
      reference,
      designation,
      category: optionalText(row[2]),
      product_type: optionalText(row[3]),
      material: optionalText(row[4]),
      grade: optionalText(row[5]),
      dimensions: optionalText(row[6]),
      standard: optionalText(row[7]),
      unit,
      unit_price_cents: Math.round(unitPrice * 100),
      tax_rate_bp: Math.round(taxRate * 100),
      is_active: true,
    });
  });

  return products;
}

function parsePrices(
  rows: WorkbookCell[][],
  issues: ProductPriceTemplateIssue[]
): SupplierPriceTemplateRow[] {
  const prices: SupplierPriceTemplateRow[] = [];
  const priceKeys = new Map<string, number>();

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    if (isEmptyRow(row)) return;

    const productReference = textValue(row[0]);
    const supplierName = textValue(row[1]);
    const unitPrice = parseLocalizedNumber(row[3]);
    const unit = textValue(row[4]) || "u";
    const rawCurrency = textValue(row[5]);
    const currency = (rawCurrency || "EUR").toUpperCase();
    const validFrom = parseDate(row[6]);
    const rawMinQuantity = textValue(row[7]);
    const minQuantity = rawMinQuantity === "" ? 1 : parseLocalizedNumber(row[7]);
    const rowIssuesBefore = issues.length;

    if (!productReference) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "reference_produit",
        code: "PRICE_PRODUCT_REFERENCE_REQUIRED",
        message: "La reference produit est obligatoire.",
      });
    }

    if (!supplierName) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "fournisseur",
        code: "PRICE_SUPPLIER_REQUIRED",
        message: "Le fournisseur est obligatoire.",
      });
    }

    if (textValue(row[3]) === "" || unitPrice === null || unitPrice <= 0) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "prix_unitaire_ht",
        code: "SUPPLIER_PRICE_INVALID",
        message: "Le prix fournisseur HT doit etre un nombre strictement superieur a 0.",
      });
    }

    if (!/^[A-Z]{3}$/.test(currency)) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "devise",
        code: "PRICE_CURRENCY_INVALID",
        message: "La devise doit contenir exactement 3 lettres (par exemple EUR).",
      });
    }

    if (textValue(row[6]) === "" || validFrom === null) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "date_prix",
        code: "PRICE_DATE_INVALID",
        message: "La date du prix est obligatoire et doit respecter le format YYYY-MM-DD.",
      });
    }

    if (minQuantity === null || minQuantity <= 0) {
      addBlockingIssue(issues, {
        sheet: PRICES_SHEET,
        row: rowNumber,
        column: "quantite_minimale",
        code: "PRICE_MIN_QUANTITY_INVALID",
        message: "La quantite minimale doit etre un nombre strictement superieur a 0.",
      });
    }

    if (
      issues.length === rowIssuesBefore &&
      productReference &&
      supplierName &&
      unitPrice !== null &&
      validFrom !== null &&
      minQuantity !== null
    ) {
      const duplicateKey = [
        normalizedReference(productReference),
        supplierName.toLocaleLowerCase("fr-FR"),
        currency,
        validFrom,
        String(minQuantity),
      ].join("|");
      const firstRow = priceKeys.get(duplicateKey);
      if (firstRow !== undefined) {
        addBlockingIssue(issues, {
          sheet: PRICES_SHEET,
          row: rowNumber,
          column: null,
          code: "SUPPLIER_PRICE_DUPLICATE",
          message: `Ce tarif fournisseur est deja present a la ligne ${firstRow}.`,
        });
      } else {
        priceKeys.set(duplicateKey, rowNumber);
      }
    }

    if (
      issues.length !== rowIssuesBefore ||
      unitPrice === null ||
      validFrom === null ||
      minQuantity === null
    ) {
      return;
    }

    prices.push({
      product_reference: productReference,
      supplier_name: supplierName,
      supplier_sku: optionalText(row[2]),
      unit_price_cents: Math.round(unitPrice * 100),
      unit,
      currency,
      valid_from: validFrom,
      min_quantity: minQuantity,
      source_url: optionalText(row[8]),
      comment: optionalText(row[9]),
    });
  });

  return prices;
}

export async function parseProductPriceTemplateWorkbook(
  input: ArrayBuffer
): Promise<ProductPriceTemplateParseResult> {
  const workbook = XLSX.read(new Uint8Array(input), {
    type: "array",
    cellDates: true,
  });
  const issues: ProductPriceTemplateIssue[] = [];
  let version: string | null = null;
  let products: ProductTemplateRow[] = [];
  let prices: SupplierPriceTemplateRow[] = [];

  const instructionsSheet = workbook.Sheets[INSTRUCTIONS_SHEET];
  if (!instructionsSheet) {
    addBlockingIssue(issues, {
      sheet: INSTRUCTIONS_SHEET,
      row: null,
      column: null,
      code: "SHEET_MISSING",
      message: `La feuille \"${INSTRUCTIONS_SHEET}\" est absente.`,
    });
  } else {
    version = textValue(instructionsSheet.B2?.v as WorkbookCell) || null;
    if (version !== TEMPLATE_VERSION) {
      addBlockingIssue(issues, {
        sheet: INSTRUCTIONS_SHEET,
        row: 2,
        column: "B",
        code: "TEMPLATE_VERSION_INVALID",
        message: `Version de template invalide : ${version ?? "absente"}. Version attendue : ${TEMPLATE_VERSION}.`,
      });
    }
  }

  const productsSheet = workbook.Sheets[PRODUCTS_SHEET];
  if (!productsSheet) {
    addBlockingIssue(issues, {
      sheet: PRODUCTS_SHEET,
      row: null,
      column: null,
      code: "SHEET_MISSING",
      message: `La feuille \"${PRODUCTS_SHEET}\" est absente.`,
    });
  } else {
    const rows = validateHeaders(productsSheet, PRODUCTS_SHEET, PRODUCT_HEADERS, issues);
    if (rows) products = parseProducts(rows, issues);
  }

  const pricesSheet = workbook.Sheets[PRICES_SHEET];
  if (!pricesSheet) {
    addBlockingIssue(issues, {
      sheet: PRICES_SHEET,
      row: null,
      column: null,
      code: "SHEET_MISSING",
      message: `La feuille \"${PRICES_SHEET}\" est absente.`,
    });
  } else {
    const rows = validateHeaders(pricesSheet, PRICES_SHEET, PRICE_HEADERS, issues);
    if (rows) prices = parsePrices(rows, issues);
  }

  return {
    products,
    prices,
    issues,
    hasBlockingIssues: issues.some((issue) => issue.blocking),
    version,
  };
}
