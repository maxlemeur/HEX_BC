import "server-only";

import type { AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";

import {
  UNSAVED_PRODUCT_REFERENCE_NAMING, productReferenceNamingSchema, type ProductReferenceNaming,
} from "./product-reference-naming";

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
  supabase: AuthenticatedTenantContext["supabase"], tenantId: string,
): Promise<StoredProductReferenceNaming> {
  const { data, error } = await supabase.from("tenant_catalogue_policies")
    .select("product_reference_naming").eq("tenant_id", tenantId).maybeSingle();
  if (error?.code === "42703" || error?.code === "PGRST204") {
    return { available: false, saved: false, naming: UNSAVED_PRODUCT_REFERENCE_NAMING };
  }
  if (error) throw mapSupabaseError(error, "Impossible de lire la nomenclature des références.");
  const naming = productReferenceNamingSchema.safeParse(data?.product_reference_naming);
  // A stored value the current rules refuse is not applied: the automatic numbers stay until it is saved again.
  return naming.success
    ? { available: true, saved: true, naming: naming.data }
    : { available: true, saved: false, naming: UNSAVED_PRODUCT_REFERENCE_NAMING };
}
