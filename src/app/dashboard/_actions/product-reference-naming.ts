"use server";

import { revalidatePath } from "next/cache";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import {
  compactReferenceAbbreviations, productReferenceNamingSchema, type ProductReferenceNaming,
} from "@/lib/catalogue/product-reference-naming";

type SaveResult = { ok: true; naming: ProductReferenceNaming } | { ok: false; message: string };

const SAVE_FAILED = "Impossible d’enregistrer la nomenclature.";

/** The naming of the company's new references, saved by one of its administrators. */
export async function saveProductReferenceNaming(input: unknown): Promise<SaveResult> {
  const parsed = productReferenceNamingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "La nomenclature est invalide." };
  const abbreviations = compactReferenceAbbreviations(parsed.data.abbreviations);
  const naming: ProductReferenceNaming = {
    enabled: parsed.data.enabled, patterns: parsed.data.patterns, ...(abbreviations ? { abbreviations } : {}),
  };
  try {
    const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
    if (tenantRole !== "admin") return { ok: false, message: "Ce réglage est réservé aux administrateurs de l’entreprise." };
    const { error } = await supabase.rpc("set_tenant_product_reference_naming", { p_tenant_id: tenantId, p_naming: naming });
    if (error) {
      console.error("The product reference naming could not be saved", { code: error.code });
      // A database that predates the abbreviations refuses them and still saves the formats.
      return {
        ok: false,
        message: abbreviations && error.code === "22023"
          ? "Les abréviations ne peuvent pas encore être enregistrées sur cette base. Rétablissez les abréviations par défaut pour enregistrer les formats."
          : SAVE_FAILED,
      };
    }
    revalidatePath("/dashboard/admin/catalogue-rights");
    return { ok: true, naming };
  } catch {
    return { ok: false, message: SAVE_FAILED };
  }
}
