import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

import { getCatalogueWriterClient, readCatalogueAccess } from "./access-server";
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

const SUPPLIER_WRITE_REFUSAL =
  "L'ajout et la modification de fournisseurs sont réservés aux administrateurs et aux ingénieurs.";
const SHARED_SUPPLIER_REFUSAL =
  "Ce fournisseur fait partie de la base commune : vous modifiez seulement les fournisseurs que vous avez ajoutés. Un administrateur peut ouvrir la base commune aux ingénieurs.";

/**
 * TI-689: admins write every supplier; engineers add some and change the ones they added, or all of them when
 * their admin opened the shared base (RLS: "Catalogue editors can insert/update/delete suppliers").
 */
function getWriterClient() {
  return getCatalogueWriterClient(SUPPLIER_WRITE_REFUSAL);
}

type WriterClient = Awaited<ReturnType<typeof getWriterClient>>;

/**
 * A write filtered by RLS affects zero rows without raising. For an engineer, a supplier that still reads is one
 * they may not change: say so instead of « introuvable ».
 */
async function supplierWriteRefusal(writer: WriterClient, supplierId: string) {
  if (!writer.isTenantAdmin) {
    const { data } = await writer.supabase.from("suppliers").select("id").eq("id", supplierId).maybeSingle();
    if (data) return forbidden(SHARED_SUPPLIER_REFUSAL);
  }
  return notFound("Fournisseur introuvable.");
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

  // TI-689: the page shows its write buttons from this, the database decides.
  const access = await readCatalogueAccess();

  return {
    items: data ?? [],
    access: { user_id: access.userId, can_add: access.canAdd, can_edit_shared: access.canEditShared },
  };
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
      "Impossible de vérifier l'utilisation du fournisseur."
    );
  }

  return { linked_orders_count: count ?? 0 };
}

export async function createSupplier(input: CreateSupplierInput) {
  const { supabase } = await getWriterClient();
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
    throw mapSupabaseError(error, "Impossible de créer le fournisseur.");
  }

  return { item: data };
}

export async function updateSupplier(input: UpdateSupplierInput) {
  const writer = await getWriterClient();
  const { supabase } = writer;
  const payload = compactRecord<SupplierUpdate>({ ...input.item });

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ de mise à jour fourni.");
  }

  const { data, error } = await supabase
    .from("suppliers")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre à jour le fournisseur.");
  }

  if (!data) {
    throw await supplierWriteRefusal(writer, input.id);
  }

  return { item: data };
}

async function archiveSupplier(writer: WriterClient, supplierId: string) {
  const { supabase } = writer;
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
    throw await supplierWriteRefusal(writer, supplierId);
  }

  return { id: supplierId, mode: "archived" as const };
}

export async function deleteSupplier(supplierId: string) {
  const writer = await getWriterClient();
  const { supabase } = writer;
  const { linked_orders_count } = await getSupplierUsage(supplierId);

  if (linked_orders_count > 0) {
    return archiveSupplier(writer, supplierId);
  }

  const { data, error } = await supabase
    .from("suppliers")
    .delete()
    .eq("id", supplierId)
    .select("id");

  if (error?.code === "23503") {
    return archiveSupplier(writer, supplierId);
  }

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer le fournisseur.");
  }

  if (!data || data.length === 0) {
    throw await supplierWriteRefusal(writer, supplierId);
  }

  return { id: supplierId, mode: "deleted" as const };
}
