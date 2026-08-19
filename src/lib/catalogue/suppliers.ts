import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

import type {
  CreateSupplierInput,
  UpdateSupplierInput,
} from "./directory-schemas";

type SupplierInsert = Database["public"]["Tables"]["suppliers"]["Insert"];
type SupplierUpdate = Database["public"]["Tables"]["suppliers"]["Update"];

function compactRecord<T extends Record<string, unknown>>(payload: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    next[key] = value;
  }
  return next as T;
}

async function getAuthenticatedClient() {
  const { supabase, userId } = await getAuthenticatedTenantContext();
  return { supabase, userId };
}

/**
 * Supplier writes are admin-only (RLS: "Admins can insert/update/delete suppliers").
 * Checking the role here turns a silent zero-row RLS update into an explicit 403.
 */
async function getAdminClient() {
  const { supabase, userId, isTenantAdmin } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) {
    throw forbidden(
      "La gestion des fournisseurs est reservee aux administrateurs."
    );
  }
  return { supabase, userId };
}

export async function listSuppliers() {
  const { supabase } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les fournisseurs.");
  }

  return { items: data ?? [] };
}

export async function getSupplierUsage(supplierId: string) {
  const { supabase } = await getAuthenticatedClient();
  const { count, error } = await supabase
    .from("purchase_orders")
    .select("id", { count: "exact", head: true })
    .eq("supplier_id", supplierId);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de verifier l'utilisation du fournisseur."
    );
  }

  return { linked_orders_count: count ?? 0 };
}

export async function createSupplier(input: CreateSupplierInput) {
  const { supabase } = await getAdminClient();
  const payload = compactRecord<SupplierInsert>({
    name: input.name,
    address: input.address,
    city: input.city,
    postal_code: input.postal_code,
    country: input.country,
    email: input.email,
    phone: input.phone,
    contact_name: input.contact_name,
    siret: input.siret,
    vat_number: input.vat_number,
    payment_terms: input.payment_terms,
    is_active: input.is_active,
  });

  const { data, error } = await supabase
    .from("suppliers")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer le fournisseur.");
  }

  return { item: data };
}

export async function updateSupplier(input: UpdateSupplierInput) {
  const { supabase } = await getAdminClient();
  const payload = compactRecord<SupplierUpdate>({ ...input.item });

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ de mise a jour fourni.");
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le fournisseur.");
  }

  if (!data) {
    throw notFound("Fournisseur introuvable.");
  }

  return { item: data };
}

async function archiveSupplier(
  supabase: Awaited<ReturnType<typeof getAuthenticatedClient>>["supabase"],
  supplierId: string
) {
  const { data, error } = await supabase
    .from("suppliers")
    .update({ is_active: false })
    .eq("id", supplierId)
    .select("id");

  if (error) {
    throw mapSupabaseError(error, "Impossible d'archiver le fournisseur.");
  }

  // A RLS-filtered update affects zero rows without raising: do not report success.
  if (!data || data.length === 0) {
    throw notFound("Fournisseur introuvable.");
  }

  return { id: supplierId, mode: "archived" as const };
}

export async function deleteSupplier(supplierId: string) {
  const { supabase } = await getAdminClient();
  const { linked_orders_count } = await getSupplierUsage(supplierId);

  if (linked_orders_count > 0) {
    return archiveSupplier(supabase, supplierId);
  }

  const { data, error } = await supabase
    .from("suppliers")
    .delete()
    .eq("id", supplierId)
    .select("id");

  if (error?.code === "23503") {
    return archiveSupplier(supabase, supplierId);
  }

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer le fournisseur.");
  }

  if (!data || data.length === 0) {
    throw notFound("Fournisseur introuvable.");
  }

  return { id: supplierId, mode: "deleted" as const };
}
