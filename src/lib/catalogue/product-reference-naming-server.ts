import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { conflict, mapSupabaseError } from "@/lib/http/api-response";

import type { ProductReferenceIdentity } from "./product-reference-identity";
import {
  UNSAVED_PRODUCT_REFERENCE_NAMING, proposeProductReference, storedProductReferenceNamingSchema,
  type ProductReferenceNaming,
} from "./product-reference-naming";

type TenantSupabase = AuthenticatedTenantContext["supabase"];

export type StoredProductReferenceNaming = {
  /** False while the database does not hold the setting yet (migration not applied). */
  available: boolean;
  /** True when the company's administrator saved a naming: only then does it apply to new articles. */
  saved: boolean;
  naming: ProductReferenceNaming;
};

/**
 * The company's naming. A company that saved none keeps the automatic numbers: the default formats are a
 * proposal its administrator turns on, never a change applied on its behalf.
 */
export async function readProductReferenceNaming(
  supabase: TenantSupabase, tenantId: string,
): Promise<StoredProductReferenceNaming> {
  const { data, error } = await supabase.from("tenant_catalogue_policies")
    .select("product_reference_naming").eq("tenant_id", tenantId).maybeSingle();
  if (error?.code === "42703" || error?.code === "PGRST204") {
    return { available: false, saved: false, naming: UNSAVED_PRODUCT_REFERENCE_NAMING };
  }
  if (error) throw mapSupabaseError(error, "Impossible de lire la nomenclature des références.");
  // Read as it was saved: a format older than the prefix rule keeps applying, and the form asks for the prefix at
  // the next save. A value no save could have stored is not applied.
  const naming = storedProductReferenceNamingSchema.safeParse(data?.product_reference_naming);
  return naming.success
    ? { available: true, saved: true, naming: naming.data }
    : { available: true, saved: false, naming: UNSAVED_PRODUCT_REFERENCE_NAMING };
}

/**
 * The reference the company's naming gives a new article whose reference is blank, or null: no naming saved,
 * naming switched off, or a sheet that lacks what its format names. The database then assigns the number.
 */
export async function proposeStoredProductReference(
  supabase: TenantSupabase, tenantId: string, article: ProductReferenceIdentity,
): Promise<string | null> {
  const stored = await readProductReferenceNaming(supabase, tenantId);
  return stored.saved ? proposeProductReference(stored.naming, article) : null;
}

export const PRODUCT_REFERENCE_TAKEN_CODE = "PRODUCT_REFERENCE_TAKEN";

/**
 * A reference already taken, said with the article that holds it: with a format built from the article's
 * characteristics, the same reference is most often the same article entered twice.
 */
export async function productReferenceTaken(
  supabase: TenantSupabase, tenantId: string, reference: string | null | undefined, fallback: string,
) {
  const wanted = reference?.trim();
  if (!wanted) return conflict(fallback);
  const { data } = await supabase.from("products").select("id, reference, designation")
    .eq("tenant_id", tenantId).eq("reference_normalized", wanted.toLowerCase()).maybeSingle();
  if (!data?.designation) return conflict(fallback);
  return conflict(
    `La référence « ${data.reference ?? wanted} » est déjà celle de l’article « ${data.designation} ». S’il s’agit du même article, utilisez sa fiche ; sinon complétez la fiche ou saisissez une autre référence.`,
    { product_id: data.id, reference: data.reference ?? wanted },
    PRODUCT_REFERENCE_TAKEN_CODE,
  );
}
