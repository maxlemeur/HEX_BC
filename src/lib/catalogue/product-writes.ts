import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/http/api-response";
import type { Database } from "@/types/database";

import { getCatalogueWriterClient } from "./access-server";
import type { CreateProductInput, UpdateProductInput } from "./directory-schemas";
import { proposeProductReference } from "./product-reference-naming";
import { readProductReferenceNaming } from "./product-reference-naming-server";
import {
  PRODUCT_UNIT_HAS_PACKAGINGS,
  PRODUCT_UNIT_HAS_PACKAGINGS_MESSAGE,
  isProductUnitHeldByPackagings,
} from "./packagings";
import {
  PRODUCT_SUPPLY_TYPE_INVALID,
  PRODUCT_VALIDATION_INCOMPLETE,
  productValidationFieldsFromDetail,
  productValidationMessage,
} from "./product-validation";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export function compactRecord<T extends Record<string, unknown>>(payload: T): T {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    next[key] = value;
  }
  return next as T;
}

export const PRODUCT_WRITE_REFUSAL =
  "L'ajout et la modification d'articles sont réservés aux administrateurs et aux ingénieurs.";
export const SHARED_PRODUCT_REFUSAL =
  "Cet article fait partie de la base commune : vous modifiez seulement les articles que vous avez ajoutés. Un administrateur peut ouvrir la base commune aux ingénieurs.";

/**
 * TI-689: admins write every item; engineers add some and change the ones they added, or all of them when their
 * admin opened the shared base (RLS: "Catalogue editors can insert/update products"). A reference price still
 * changes only through its validation, an admin act.
 */
function getWriterClient() {
  return getCatalogueWriterClient(PRODUCT_WRITE_REFUSAL);
}

/** Refusal of the trigger protect_product_catalogue_validation (TI-689): a draft is validated by an admin. */
const PRODUCT_VALIDATION_ADMIN_ONLY = "PRODUCT_VALIDATION_ADMIN_ONLY";

/** A reference already held by another item of the tenant (unique index, case-insensitive). */
export const PRODUCT_REFERENCE_TAKEN =
  "Cette référence interne existe déjà. Choisissez une autre référence ou laissez le champ vide.";

export const PRODUCT_REFERENCE_LOCKED = "PRODUCT_REFERENCE_LOCKED";
const PRODUCT_REFERENCE_LOCKED_MESSAGE =
  "La référence d’un article est figée après sa création : devis, demandes et commandes s’y rattachent. Un administrateur peut la corriger.";

type WriterSupabase = Awaited<ReturnType<typeof getCatalogueWriterClient>>["supabase"];

/**
 * A reference already taken, said with the article that holds it: with a format built from the article's
 * characteristics, the same reference is most often the same article entered twice.
 */
async function referenceTaken(supabase: WriterSupabase, tenantId: string, reference: string | null | undefined, fallback: string) {
  const wanted = reference?.trim();
  if (!wanted) return conflict(fallback);
  const { data } = await supabase.from("products").select("id, reference, designation")
    .eq("tenant_id", tenantId).eq("reference_normalized", wanted.toLowerCase()).maybeSingle();
  if (!data?.designation) return conflict(fallback);
  return conflict(
    `La référence « ${data.reference ?? wanted} » est déjà celle de l’article « ${data.designation} ». S’il s’agit du même article, utilisez sa fiche ; sinon complétez la fiche ou saisissez une autre référence.`,
    { product_id: data.id, reference: data.reference ?? wanted },
    "PRODUCT_REFERENCE_TAKEN",
  );
}

/** Refusals of the triggers that guard an item's catalogue status, as sentences. */
export function catalogueStatusError(error: { message: string; details?: string | null }) {
  if (error.message.includes(PRODUCT_VALIDATION_INCOMPLETE)) {
    const missing = productValidationFieldsFromDetail(error.details);
    return unprocessableEntity(
      productValidationMessage(missing),
      { missing },
      PRODUCT_VALIDATION_INCOMPLETE,
    );
  }
  if (error.message.includes(PRODUCT_VALIDATION_ADMIN_ONLY)) {
    return forbidden("La validation d’un article en brouillon est réservée aux administrateurs.");
  }
  if (error.message.includes(PRODUCT_SUPPLY_TYPE_INVALID)) {
    return badRequest("Ce type de fourniture n’existe pas dans votre référentiel.");
  }
  return null;
}

export async function createProduct(input: CreateProductInput) {
  const { supabase, tenantId } = await getWriterClient();
  // A typed reference is kept as typed. A blank one takes the company's format when its administrator saved
  // one and the article states what the format needs; otherwise the database assigns the automatic number.
  const naming = input.reference ? null : await readProductReferenceNaming(supabase, tenantId);
  const proposed = naming?.saved ? proposeProductReference(naming.naming, input) : null;
  const payload = compactRecord<ProductInsert>({
    reference: proposed ?? input.reference,
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
    supply_type_id: input.supply_type_id,
    catalogue_status: input.catalogue_status,
  });

  const { data, error } = await supabase
    .from("products")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw await referenceTaken(supabase, tenantId, proposed ?? input.reference, PRODUCT_REFERENCE_TAKEN);
    }
    throw catalogueStatusError(error) ?? mapSupabaseError(error, "Impossible de créer le produit.");
  }

  return { item: data };
}

export async function suggestProductReference() {
  const { supabase, tenantId } = await getWriterClient();
  const [{ data, error }, naming] = await Promise.all([
    supabase.rpc("suggest_product_reference"),
    readProductReferenceNaming(supabase, tenantId),
  ]);
  if (error) {
    throw mapSupabaseError(error, "Impossible de proposer une référence interne.");
  }
  if (typeof data !== "string" || !data.trim()) {
    throw badRequest("Aucune référence interne n’a pu être proposée.");
  }
  // The form builds the proposal of the company's format from what is typed; the number stays the fallback.
  return { reference: data, ...(naming.saved && naming.naming.enabled ? { naming: naming.naming } : {}) };
}

export async function updateProduct(input: UpdateProductInput) {
  const writer = await getWriterClient();
  const { supabase } = writer;
  const payload = compactRecord<ProductUpdate>({ ...input.item });

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ de mise à jour fourni.");
  }

  // A reference identifies the article wherever it was used: once given it does not change with the rest of
  // the sheet. An administrator corrects a mistake; anyone who edits the sheet gives one to an article without.
  if (typeof payload.reference === "string" && !writer.isTenantAdmin) {
    const { data: current } = await supabase.from("products").select("id, reference").eq("id", input.id).maybeSingle();
    const held = current?.reference?.trim();
    if (held && held !== payload.reference.trim()) {
      throw forbidden(PRODUCT_REFERENCE_LOCKED_MESSAGE, undefined, PRODUCT_REFERENCE_LOCKED);
    }
  }

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      throw await referenceTaken(
        supabase, writer.tenantId, payload.reference, "Cette référence interne existe déjà. Choisissez une autre référence.",
      );
    }
    if (isProductUnitHeldByPackagings(error)) {
      throw conflict(PRODUCT_UNIT_HAS_PACKAGINGS_MESSAGE, undefined, PRODUCT_UNIT_HAS_PACKAGINGS);
    }
    if (error.message.includes("REFERENCE_PRICE_VALIDATION_REQUIRED")) {
      throw conflict("Le prix de référence doit être validé depuis « Examiner le prix ». Une référence validée ne peut pas changer d’unité sans nouvelle validation.");
    }
    throw catalogueStatusError(error) ?? mapSupabaseError(error, "Impossible de mettre à jour le produit.");
  }

  if (!data) {
    // A write filtered by RLS affects zero rows without raising: an item that still reads is one the engineer
    // may not change.
    if (!writer.isTenantAdmin) {
      const { data: readable } = await supabase.from("products").select("id").eq("id", input.id).maybeSingle();
      if (readable) throw forbidden(SHARED_PRODUCT_REFUSAL);
    }
    throw notFound("Produit introuvable.");
  }

  return { item: data };
}
