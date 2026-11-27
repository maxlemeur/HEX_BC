export const TEMPLATE_VERSION = "3.0";
/**
 * Le gabarit v1 portait une colonne "tva" par produit, aujourd'hui sans usage. Les gabarits v1 et v2 portaient
 * une famille en texte libre et une colonne "type_produit" : depuis le v3, "famille" nomme une famille du
 * catalogue de l'entreprise et la colonne s'appelle "type". Ils restent acceptes a l'import pour ne pas
 * invalider les fichiers deja remplis ; leur famille n'est plus reprise.
 */
export const SUPPORTED_TEMPLATE_VERSIONS = ["1.0", "2.0", "3.0"] as const;
export const TEMPLATE_FILE_URL = "/templates/hex-bc-produits-tarifs-v3.xlsx";
/** Les lignes d'exemple du gabarit : leur reference commence ainsi, et l'import les ignore. */
export const TEMPLATE_EXAMPLE_PREFIX = "EXEMPLE-";

export function isTemplateExampleReference(reference: string): boolean {
  return reference.trim().toUpperCase().startsWith(TEMPLATE_EXAMPLE_PREFIX);
}

export type ProductPriceTemplateSheet =
  | "Mode d'emploi"
  | "Produits"
  | "Tarifs fournisseurs";

export type ProductTemplateRow = {
  reference: string;
  designation: string;
  /** Nom d'une famille du catalogue de l'entreprise (un type de fourniture), tel que saisi. */
  family: string | null;
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
  /** Lignes d'exemple du gabarit laissees dans le fichier, ignorees. */
  ignoredExampleRows: number;
};

/** The key that matches a product reference of the template with a catalogue product: trimmed, lower case (fr-FR). */
export function normalizedReference(value: string): string {
  return value.trim().toLocaleLowerCase("fr-FR");
}
