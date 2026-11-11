import {
  badRequest,
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

import { getCatalogueWriterClient } from "./access-server";
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

const PRODUCT_WRITE_REFUSAL =
  "L'ajout et la modification d'articles sont réservés aux administrateurs et aux ingénieurs.";
const SHARED_PRODUCT_REFUSAL =
  "Cet article fait partie de la base commune : vous modifiez seulement les articles que vous avez ajoutés. Un administrateur peut ouvrir la base commune aux ingénieurs.";

/**
 * TI-689: admins write every item; engineers add some and change the ones they added, or all of them when their
 * admin opened the shared base (RLS: "Catalogue editors can insert/update products"). A reference price still
 * changes only through its validation, an admin act.
 */
function getWriterClient() {
  return getCatalogueWriterClient(PRODUCT_WRITE_REFUSAL);
}

export async function createProduct(input: CreateProductInput) {
  const { supabase } = await getWriterClient();
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
    if (error.code === "23505") {
      throw conflict("Cette référence interne existe déjà. Choisissez une autre référence ou laissez le champ vide.");
    }
    throw mapSupabaseError(error, "Impossible de créer le produit.");
  }

  return { item: data };
}

export async function suggestProductReference() {
  const { supabase } = await getWriterClient();
  const { data, error } = await supabase.rpc("suggest_product_reference");
  if (error) {
    throw mapSupabaseError(error, "Impossible de proposer une référence interne.");
  }
  if (typeof data !== "string" || !data.trim()) {
    throw badRequest("Aucune référence interne n’a pu être proposée.");
  }
  return { reference: data };
}

export async function updateProduct(input: UpdateProductInput) {
  const writer = await getWriterClient();
  const { supabase } = writer;
  const payload = compactRecord<ProductUpdate>({ ...input.item });

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ de mise à jour fourni.");
  }

  const { data, error } = await supabase
    .from("products")
    .update(payload)
    .eq("id", input.id)
    .select("*")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      throw conflict("Cette référence interne existe déjà. Choisissez une autre référence.");
    }
    if (error.message.includes("REFERENCE_PRICE_VALIDATION_REQUIRED")) {
      throw conflict("Le prix de référence doit être validé depuis « Examiner le prix ». Une référence validée ne peut pas changer d’unité sans nouvelle validation.");
    }
    throw mapSupabaseError(error, "Impossible de mettre à jour le produit.");
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
