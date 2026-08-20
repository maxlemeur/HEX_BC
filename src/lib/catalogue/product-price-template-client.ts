export const TEMPLATE_VERSION = "2.0";
/**
 * Le gabarit v1 portait une colonne "tva" par produit, aujourd'hui sans usage.
 * Il reste accepte a l'import pour ne pas invalider les fichiers deja remplis.
 */
export const SUPPORTED_TEMPLATE_VERSIONS = ["1.0", "2.0"] as const;
export const TEMPLATE_FILE_URL = "/templates/hex-bc-produits-tarifs-v2.xlsx";

export type ProductPriceTemplateSheet =
  | "Mode d'emploi"
  | "Produits"
  | "Tarifs fournisseurs";

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
