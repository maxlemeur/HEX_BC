import type { SupabaseClient } from "@supabase/supabase-js";
import { mapSupabaseError } from "@/lib/estimates/errors";

export type SelectedSupplierDetails = {
  price_id: string;
  name: string | null;
  reference: string | null;
};

/** Resolve identity for the selected offers only; never replace a line's cost. */
export async function readSelectedSupplierDetails(
  supabase: SupabaseClient,
  tenantId: string,
  priceIds: string[],
): Promise<Map<string, SelectedSupplierDetails>> {
  if (priceIds.length === 0) return new Map();
  const { data, error } = await supabase.from("supplier_pricebook")
    .select("id, supplier_catalog_items(supplier_sku, suppliers(name))")
    .eq("tenant_id", tenantId)
    .in("id", Array.from(new Set(priceIds)));
  if (error) throw mapSupabaseError(error, "Impossible de charger les offres retenues.");
  const rows = (data ?? []) as unknown as Array<{
    id: string;
    supplier_catalog_items: { supplier_sku: string | null; suppliers: { name: string } | null } | null;
  }>;
  return new Map(rows.map((row) => [row.id, {
    price_id: row.id,
    name: row.supplier_catalog_items?.suppliers?.name ?? null,
    reference: row.supplier_catalog_items?.supplier_sku ?? null,
  }]));
}

export type SupplierOfferConditions = {
  unit?: string | null;
  min_quantity?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active?: boolean;
};

/** Read only the offers already being compared, with an explicit tenant fence. */
export async function readSupplierOfferConditions(
  supabase: SupabaseClient,
  tenantId: string,
  priceIds: string[],
): Promise<Map<string, SupplierOfferConditions>> {
  if (priceIds.length === 0) return new Map<string, SupplierOfferConditions>();
  const { data, error } = await supabase.from("supplier_pricebook")
    .select("id, unit, min_quantity, valid_from, valid_to, is_active")
    .eq("tenant_id", tenantId)
    .in("id", Array.from(new Set(priceIds)));
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les conditions fournisseurs.");
  return new Map<string, SupplierOfferConditions>((data ?? []).map((row) => [row.id, {
    unit: row.unit,
    min_quantity: Number(row.min_quantity),
    valid_from: row.valid_from,
    valid_to: row.valid_to,
    is_active: row.is_active,
  }]));
}
