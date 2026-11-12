import "server-only";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { badRequest, conflict, forbidden, mapSupabaseError, notFound } from "@/lib/estimates/errors";

import { canAddToCatalogue } from "./access";
import {
  supplyTypeCodeFromName,
  type CreateSupplyTypeInput,
  type SupplyTypeListItem,
  type SupplyTypeRecord,
} from "./supply-types";

type TenantContext = Awaited<ReturnType<typeof getAuthenticatedTenantContext>>;
type SupplyTypeRow = SupplyTypeRecord & { preferred_supplier_id: string | null };

const SUPPLY_TYPE_COLUMNS = "id, code, name, preferred_supplier_id";
const SUPPLY_TYPE_NOT_FOUND = "Type de fourniture introuvable.";
const SUPPLIER_NOT_FOUND = "Fournisseur introuvable.";
/** TI-691: like the article's suppliers, a purchasing decision of the catalogue's editors. */
const PREFERRED_SUPPLIER_REFUSAL =
  "Le fournisseur préféré d’un type de fourniture est choisi par un administrateur ou un ingénieur.";

/** The rows with the name of the supplier each prefers (one query for all of them, none when no type prefers one). */
async function withSupplierNames(context: TenantContext, rows: readonly SupplyTypeRow[]): Promise<SupplyTypeListItem[]> {
  const supplierIds = [...new Set(rows.map((row) => row.preferred_supplier_id).filter((id): id is string => Boolean(id)))];
  let names = new Map<string, string>();
  if (supplierIds.length > 0) {
    const { data, error } = await context.supabase
      .from("suppliers")
      .select("id, name")
      .eq("tenant_id", context.tenantId)
      .in("id", supplierIds);
    if (error) throw mapSupabaseError(error, "Impossible de charger les fournisseurs préférés.");
    names = new Map((data ?? []).map((row) => [row.id, row.name]));
  }
  return rows.map((row) => {
    const preferred = row.preferred_supplier_id ?? null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      preferred_supplier_id: preferred,
      preferred_supplier_name: preferred ? (names.get(preferred) ?? null) : null,
    };
  });
}

export async function listSupplyTypes(): Promise<{ items: SupplyTypeListItem[] }> {
  const context = await getAuthenticatedTenantContext();
  const { data, error } = await context.supabase
    .from("supply_types")
    .select(SUPPLY_TYPE_COLUMNS)
    .eq("tenant_id", context.tenantId)
    .order("name", { ascending: true });
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les types de fourniture.");
  }
  return { items: await withSupplierNames(context, data ?? []) };
}

/**
 * The preferred supplier of a supply type (null removes it): admins and engineers of the active tenant, while any
 * member still writes the type's name (a trigger of the database guards this column only, and has the last word).
 */
export async function setSupplyTypePreferredSupplier(
  supplyTypeId: string,
  preferredSupplierId: string | null,
): Promise<{ item: SupplyTypeListItem }> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PREFERRED_SUPPLIER_REFUSAL);
  const { supabase, tenantId } = context;

  const { data: existing, error: readError } = await supabase
    .from("supply_types")
    .select("id")
    .eq("id", supplyTypeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (readError) throw mapSupabaseError(readError, "Impossible de charger le type de fourniture.");
  if (!existing) throw notFound(SUPPLY_TYPE_NOT_FOUND);
  if (preferredSupplierId) {
    const { data: supplier, error: supplierError } = await supabase
      .from("suppliers")
      .select("id")
      .eq("id", preferredSupplierId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (supplierError) throw mapSupabaseError(supplierError, "Impossible de vérifier le fournisseur.");
    if (!supplier) throw notFound(SUPPLIER_NOT_FOUND);
  }

  const { data, error } = await supabase
    .from("supply_types")
    .update({ preferred_supplier_id: preferredSupplierId })
    .eq("id", supplyTypeId)
    .eq("tenant_id", tenantId)
    .select(SUPPLY_TYPE_COLUMNS)
    .maybeSingle();
  if (error) {
    if (error.message?.includes("SUPPLY_TYPE_PREFERRED_SUPPLIER_EDITORS_ONLY")) throw forbidden(PREFERRED_SUPPLIER_REFUSAL);
    // The supplier was deleted, or moved out of reach, since it was checked.
    if (error.message?.includes("PREFERRED_SUPPLIER_TENANT_MISMATCH")) throw notFound(SUPPLIER_NOT_FOUND);
    throw mapSupabaseError(error, "Impossible d'enregistrer le fournisseur préféré.");
  }
  if (!data) throw notFound(SUPPLY_TYPE_NOT_FOUND);
  const [item] = await withSupplierNames(context, [data]);
  return { item };
}

/**
 * RLS lets any member write supply types (they predate roles). The referential is shared by every estimate
 * of the tenant, so the application reserves its growth to administrators, like the rest of the catalogue.
 */
export async function createSupplyType(input: CreateSupplyTypeInput): Promise<{ item: SupplyTypeRecord }> {
  const { supabase, isTenantAdmin } = await getAuthenticatedTenantContext();
  if (!isTenantAdmin) {
    throw forbidden("La gestion du catalogue est réservée aux administrateurs.");
  }
  if (!supplyTypeCodeFromName(input.name)) {
    throw badRequest("Le nom du type de fourniture doit contenir une lettre ou un chiffre.");
  }

  // The duplicate check and the insert are one database call, under a lock per tenant: two administrators
  // creating "Tube" and "Tubes" at the same moment cannot both succeed.
  const { data, error } = await supabase.rpc("create_supply_type", { p_name: input.name }).single();
  if (error) {
    if (error.message.includes("SUPPLY_TYPE_NAME_TAKEN")) {
      throw conflict(
        error.details
          ? `Ce type de fourniture existe déjà : « ${error.details} ».`
          : "Ce type de fourniture existe déjà.",
      );
    }
    if (error.message.includes("SUPPLY_TYPE_ADMIN_REQUIRED")) {
      throw forbidden("La gestion du catalogue est réservée aux administrateurs.");
    }
    if (error.message.includes("SUPPLY_TYPE_NAME_INVALID")) {
      throw badRequest("Le nom du type de fourniture doit contenir une lettre ou un chiffre.");
    }
    throw mapSupabaseError(error, "Impossible de créer le type de fourniture.");
  }
  return { item: data };
}
