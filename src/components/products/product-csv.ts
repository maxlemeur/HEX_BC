export type ProductCsvRow = {
  reference: string | null;
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

export type RejectedProductCsvRow = {
  line: number;
  designation: string;
  reasons: string[];
};

export type ProductCsvParseResult = {
  delimiter: "," | ";";
  acceptedRows: ProductCsvRow[];
  rejectedRows: RejectedProductCsvRow[];
  ignoredColumns: string[];
};

type ProductField =
  | "reference"
  | "designation"
  | "category"
  | "product_type"
  | "material"
  | "grade"
  | "dimensions"
  | "standard"
  | "unit"
  | "unit_price"
  | "tax_rate";

const HEADER_ALIASES: Record<string, ProductField> = {
  reference: "reference",
  ref: "reference",
  sku: "reference",
  designation: "designation",
  description: "designation",
  nom: "designation",
  name: "designation",
  category: "category",
  categorie: "category",
  famille: "category",
  family: "category",
  product_type: "product_type",
  type_produit: "product_type",
  type_de_produit: "product_type",
  type: "product_type",
  material: "material",
  matiere: "material",
  grade: "grade",
  nuance: "grade",
  dimension: "dimensions",
  dimensions: "dimensions",
  standard: "standard",
  norme: "standard",
  unit: "unit",
  unite: "unit",
  unit_price: "unit_price",
  unit_price_ht: "unit_price",
  prix_unitaire: "unit_price",
  prix_unitaire_ht: "unit_price",
  prix_ht: "unit_price",
  tax_rate: "tax_rate",
  tax_rate_percent: "tax_rate",
  tva: "tax_rate",
  taux_tva: "tax_rate",
  taux_de_tva: "tax_rate",
};

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function countDelimiter(line: string, delimiter: "," | ";"): number {
  let count = 0;
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && line[index] === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return countDelimiter(firstLine, ";") > countDelimiter(firstLine, ",") ? ";" : ",";
}

function parseRecords(text: string, delimiter: "," | ";"): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && character === delimiter) {
      record.push(value);
      value = "";
      continue;
    }

    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      record.push(value);
      records.push(record);
      record = [];
      value = "";
      continue;
    }

    value += character;
  }

  if (quoted) {
    throw new Error("Le fichier contient une valeur entre guillemets non terminée.");
  }

  if (value.length > 0 || record.length > 0) {
    record.push(value);
    records.push(record);
  }

  return records;
}

function parseLocalizedNumber(value: string): number | null {
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

function optionalValue(value: string | undefined): string | null {
  return value?.trim() || null;
}

export function parseProductCsv(text: string): ProductCsvParseResult {
  if (!text.trim()) {
    throw new Error("Le fichier CSV est vide.");
  }

  const delimiter = detectDelimiter(text);
  const records = parseRecords(text, delimiter);
  const headers = records[0] ?? [];
  const mappedHeaders = new Map<ProductField, number>();
  const ignoredColumns: string[] = [];

  headers.forEach((header, index) => {
    const field = HEADER_ALIASES[normalizeHeader(header)];
    if (!field) {
      if (header.trim()) ignoredColumns.push(header.trim());
      return;
    }
    if (!mappedHeaders.has(field)) mappedHeaders.set(field, index);
  });

  if (!mappedHeaders.has("designation")) {
    throw new Error("La colonne obligatoire désignation (ou designation/description/nom) est absente.");
  }

  const acceptedRows: ProductCsvRow[] = [];
  const rejectedRows: RejectedProductCsvRow[] = [];
  const seenReferences = new Set<string>();

  records.slice(1).forEach((record, rowIndex) => {
    if (record.every((cell) => !cell.trim())) return;

    const getValue = (field: ProductField) => {
      const index = mappedHeaders.get(field);
      return index === undefined ? "" : (record[index] ?? "");
    };
    const line = rowIndex + 2;
    const designation = getValue("designation").trim();
    const reference = optionalValue(getValue("reference"));
    const unitPriceRaw = getValue("unit_price").trim();
    const taxRateRaw = getValue("tax_rate").trim();
    const reasons: string[] = [];

    if (!designation) reasons.push("Désignation obligatoire");

    const normalizedReference = reference?.toLocaleLowerCase("fr-FR") ?? null;
    if (normalizedReference && seenReferences.has(normalizedReference)) {
      reasons.push("Référence en double dans le fichier");
    }

    const parsedPrice = unitPriceRaw ? parseLocalizedNumber(unitPriceRaw) : 0;
    if (parsedPrice === null || parsedPrice < 0) {
      reasons.push("Prix unitaire HT invalide");
    }

    const parsedTaxRate = taxRateRaw ? parseLocalizedNumber(taxRateRaw) : 20;
    if (parsedTaxRate === null || parsedTaxRate < 0 || parsedTaxRate > 100) {
      reasons.push("TVA invalide (valeur attendue entre 0 et 100)");
    }

    if (reasons.length > 0 || parsedPrice === null || parsedTaxRate === null) {
      rejectedRows.push({ line, designation, reasons });
      return;
    }

    if (normalizedReference) seenReferences.add(normalizedReference);
    acceptedRows.push({
      reference,
      designation,
      category: optionalValue(getValue("category")),
      product_type: optionalValue(getValue("product_type")),
      material: optionalValue(getValue("material")),
      grade: optionalValue(getValue("grade")),
      dimensions: optionalValue(getValue("dimensions")),
      standard: optionalValue(getValue("standard")),
      unit: optionalValue(getValue("unit")) ?? "u",
      unit_price_cents: Math.round(parsedPrice * 100),
      tax_rate_bp: Math.round(parsedTaxRate * 100),
      is_active: true,
    });
  });

  return { delimiter, acceptedRows, rejectedRows, ignoredColumns };
}
