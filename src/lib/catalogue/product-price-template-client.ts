export const TEMPLATE_VERSION = "1.0";
export const TEMPLATE_FILE_URL = "/templates/hex-bc-produits-tarifs-v1.xlsx";

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
