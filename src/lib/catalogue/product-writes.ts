import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

import type { CreateProductInput, UpdateProductInput } from "./directory-schemas";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

function compactRecord<T extends Record<string, unknown>>(payload: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    next[key] = value;
  }
  return next as T;
}

/**
 * Catalogue writes are admin-only (RLS: "Admins can insert/update products").
 * Checking the role here turns a silent zero-row RLS update into an explicit 403.
 */
async function getAdminClient() {
  const { supabase, userId, isTenantAdmin } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) {
    throw forbidden("La gestion du catalogue est reservee aux administrateurs.");
  }
  return { supabase, userId };
}

export async function createProduct(input: CreateProductInput) {
  const { supabase } = await getAdminClient();
  const payload = compactRecord<ProductInsert>({
    reference: input.reference,
    designation: input.designation,
    category: input.category,
    product_type: input.product_type,
    material: input.material,
    grade: input.grade,
    dimensions: input.dimensions,
    standard: input.standard,
    unit: input.unit,
    unit_price_cents: input.unit_price_cents,
    is_active: input.is_active,
  });

  const { data, error } = await supabase
    .from("products")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer le produit.");
  }

  return { item: data };
}

export async function updateProduct(input: UpdateProductInput) {
  const { supabase } = await getAdminClient();
  const payload = compactRecord<ProductUpdate>({ ...input.item });

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ de mise a jour fourni.");
  }

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le produit.");
  }

  if (!data) {
    throw notFound("Produit introuvable.");
  }

  return { item: data };
}
