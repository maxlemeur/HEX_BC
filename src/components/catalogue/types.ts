export type CatalogueItem = {
  id: string;
  created_at?: string;
  updated_at?: string;
  reference: string;
  hex_code?: string | null;
  designation: string;
  unit?: string | null;
  unit_price_cents?: number | null;
  tax_rate_bp?: number | null;
  is_active?: boolean;
  [key: string]: unknown;
};

export type SupplierPrice = {
  id: string;
  created_at?: string;
  updated_at?: string;
  supplier_id: string;
  supplier_catalog_item_id?: string | null;
  product_url?: string | null;
  product_id: string;
  catalogue_item_id?: string | null;
  supplier_sku?: string | null;
  unit?: string | null;
  min_quantity?: number | null;
  unit_price_cents: number;
  currency?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
  source_import_id?: string | null;
  source_mapped_row_id?: string | null;
  source?: string | null;
  notes?: string | null;
  transport_mode?: "included" | "excluded" | null;
  /** A7: an offer at 0 € marked as included or free; null otherwise. */
  zero_price_kind?: "included" | "free" | null;
  /** 2.9: an offer sold in another purchase unit (e.g. 3 ml per bar). */
  estimate_unit_code?: string | null;
  estimate_units_per_purchase_unit?: number | null;
  purchase_rounding?: "none" | "ceil" | null;
  [key: string]: unknown;
};

export type SupplierCatalogItem = {
  id: string;
  created_at?: string;
  updated_at?: string;
  tenant_id?: string;
  supplier_id: string;
  product_id: string;
  supplier_sku?: string | null;
  product_url?: string | null;
  is_active?: boolean;
  created_by?: string | null;
};

export type MaterialIndex = {
  id: string;
  created_at?: string;
  updated_at?: string;
  index_code: string;
  code?: string | null;
  label: string;
  index_value: number;
  value?: number | null;
  index_date?: string | null;
  effective_date?: string | null;
  unit?: string | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
};
