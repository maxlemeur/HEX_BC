import "server-only";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildCatalogueAccess, canAddToCatalogue, canEditCatalogueRecord } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { PRODUCT_WRITE_REFUSAL, SHARED_PRODUCT_REFUSAL } from "@/lib/catalogue/product-writes";
import {
  conflict,
  forbidden,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
  type SupabaseErrorLike,
} from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";

import {
  PRODUCT_PACKAGING_DUPLICATE,
  PRODUCT_PACKAGING_UNIT_REQUIRED,
  PRODUCT_PACKAGING_UNIT_REQUIRED_MESSAGE,
  type CreateProductPackagingData,
  type ProductPackaging,
  type ProductPackagings,
  type UpdateProductPackagingData,
} from "./packagings";

/**
 * Sale packagings of a catalogue article (see ./packagings.ts). Every member of the active tenant reads them;
 * those who may change the article write them (TI-689 rule, `public.can_edit_catalogue_record`, which the
 * policies of `product_packagings` apply too). Each write answers the whole list, since marking a packaging usual
 * takes the mark from another one.
 */

const ARTICLE_NOT_FOUND = "Article introuvable.";
const PACKAGING_NOT_FOUND = "Conditionnement introuvable.";
const USUAL_TAKEN = "Un autre conditionnement vient d’être marqué usuel. Rechargez l’article puis réessayez.";

type Article = { id: string; created_by: string | null; unit: string };
type PackagingRow = { id: string; label: string; quantity: number | string; is_usual: boolean; unit: string; position: number };

async function requireArticle(context: AuthenticatedTenantContext, productId: string): Promise<Article> {
  const { data, error } = await context.supabase
    .from("products")
    .select("id, created_by, unit")
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger l'article.");
  if (!data) throw notFound(ARTICLE_NOT_FOUND);
  return data;
}

/** The application's copy of the rule the policies apply: it only decides what to show and which refusal to word. */
async function canEditArticle(context: AuthenticatedTenantContext, article: Article): Promise<boolean> {
  if (!canAddToCatalogue(context.tenantRole)) return false;
  const engineersCanEditShared = context.tenantRole === "engineer"
    ? await readEngineersCanEditShared(context.supabase, context.tenantId)
    : false;
  const access = buildCatalogueAccess({ userId: context.userId, role: context.tenantRole, engineersCanEditShared });
  return canEditCatalogueRecord(access, article.created_by);
}

/** 404 for an article of another tenant, then 403 before any write for a member who may not change it. */
async function requireArticleEditor(productId: string) {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);
  const article = await requireArticle(context, productId);
  if (!(await canEditArticle(context, article))) throw forbidden(SHARED_PRODUCT_REFUSAL);
  return { context, article };
}

const unitRequired = () => unprocessableEntity(PRODUCT_PACKAGING_UNIT_REQUIRED_MESSAGE, undefined, PRODUCT_PACKAGING_UNIT_REQUIRED);

async function readPackagings(context: AuthenticatedTenantContext, productId: string): Promise<ProductPackaging[]> {
  const { data, error } = await readAllRows(() => context.supabase
    .from("product_packagings")
    .select("id, label, quantity, is_usual, unit, position", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId));
  if (error) throw mapSupabaseError(error, "Impossible de charger les conditionnements.");
  return [...((data ?? []) as PackagingRow[])]
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id))
    .map((row) => ({ id: row.id, label: row.label, quantity: Number(row.quantity), is_usual: row.is_usual, unit: row.unit }));
}

function writeError(error: SupabaseErrorLike, fallback: string) {
  if (error.code === "23505") {
    return conflict(error.message.includes("product_packagings_one_usual_idx") ? USUAL_TAKEN : PRODUCT_PACKAGING_DUPLICATE);
  }
  if (error.message.includes("PRODUCT_PACKAGING_PRODUCT_NOT_FOUND")) return notFound(ARTICLE_NOT_FOUND);
  if (error.message.includes(PRODUCT_PACKAGING_UNIT_REQUIRED)) return unitRequired();
  // A refusal of the policies after the application's own check: the rights changed in between.
  if (error.code === "42501") return forbidden(SHARED_PRODUCT_REFUSAL);
  return mapSupabaseError(error, fallback);
}

/** The packagings of an article in the order they were added (position), and whether the caller may change them. */
export async function listProductPackagings(productId: string): Promise<ProductPackagings> {
  const context = await getAuthenticatedTenantContext();
  const article = await requireArticle(context, productId);
  const [items, canEdit] = await Promise.all([readPackagings(context, productId), canEditArticle(context, article)]);
  return { items, can_edit: canEdit };
}

export async function createProductPackaging(
  productId: string,
  input: CreateProductPackagingData,
): Promise<ProductPackagings> {
  const { context, article } = await requireArticleEditor(productId);
  if (!article.unit.trim()) throw unitRequired();
  // The trigger enforce_product_packaging_write gives the tenant and the unit of the article, the label key, the
  // position, the author and the date.
  const { error } = await context.supabase
    .from("product_packagings")
    .insert({ product_id: productId, label: input.label, quantity: input.quantity, is_usual: input.is_usual ?? false })
    .select("id")
    .single();
  if (error) throw writeError(error, "Impossible d’ajouter le conditionnement.");
  return { items: await readPackagings(context, productId), can_edit: true };
}

export async function updateProductPackaging(
  productId: string,
  packagingId: string,
  input: UpdateProductPackagingData,
): Promise<ProductPackagings> {
  const { context } = await requireArticleEditor(productId);
  const changes: { label?: string; quantity?: number; is_usual?: boolean } = {};
  if (input.label !== undefined) changes.label = input.label;
  if (input.quantity !== undefined) changes.quantity = input.quantity;
  if (input.is_usual !== undefined) changes.is_usual = input.is_usual;
  const { data, error } = await context.supabase
    .from("product_packagings")
    .update(changes)
    .eq("id", packagingId)
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();
  if (error) throw writeError(error, "Impossible de modifier le conditionnement.");
  if (!data) throw notFound(PACKAGING_NOT_FOUND);
  return { items: await readPackagings(context, productId), can_edit: true };
}

export async function deleteProductPackaging(productId: string, packagingId: string): Promise<ProductPackagings> {
  const { context } = await requireArticleEditor(productId);
  const { data, error } = await context.supabase
    .from("product_packagings")
    .delete()
    .eq("id", packagingId)
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();
  if (error) throw writeError(error, "Impossible de retirer le conditionnement.");
  if (!data) throw notFound(PACKAGING_NOT_FOUND);
  return { items: await readPackagings(context, productId), can_edit: true };
}
