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
  [key: string]: unknown;
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
