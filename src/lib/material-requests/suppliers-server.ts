import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { canAddToCatalogue, canEditCatalogueRecord, buildCatalogueAccess } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { PRODUCT_WRITE_REFUSAL, SHARED_PRODUCT_REFUSAL } from "@/lib/catalogue/product-writes";
import { type ApiError, type SupabaseErrorLike, badRequest, forbidden, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";

import { requireProjectAccess, requireRequest, type MaterialRequestContext } from "./server-shared";
import type {
  ArticleSupplierItem,
  ArticleSupplierItemSaved,
  ArticleSuppliers,
  LineSupplierProposal,
  LineSupplierProposals,
  LineSupplierReason,
  LineSupplierReference,
  SaveArticleSupplierItemData,
} from "./supplier-contracts";

/**
 * Suppliers of material request lines (TI-691, lot 2 « l'achat », delivery 1).
 *  - Proposals: for each line with an article and no supplier, the first active supplier of the tenant among the
 *    technician's (the request's presumed supplier), the article's exception, its supply type's preferred supplier
 *    and its last purchase (public.last_purchase_suppliers), in that order (owner's decision). A proposal is never
 *    written: the office sets the line's supplier with the line PATCH, which keeps a validated line validated.
 *    Read with the rights of the affaire, in a bounded number of queries for the whole request.
 *  - An article's suppliers: its supplier items (reference and address at each supplier, no price), read by every
 *    member of the tenant, written through public.save_supplier_catalog_item by whoever may change the article.
 *  - The article's supplier exception: written like any field of the article (TI-689 rule, its update policy).
 * Every query names the active tenant. The rights are checked here to answer a status and a sentence, and again by
 * the database (policies, the definer functions' own checks), which has the last word.
 */

const ARTICLE_NOT_FOUND = "Article introuvable.";
const SUPPLIER_NOT_FOUND = "Fournisseur introuvable.";

type ArticleRow = { id: string; created_by: string | null; preferred_supplier_id: string | null };

function uniqueIds(values: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string"))];
}

async function readActiveSupplierNames(context: MaterialRequestContext, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase
    .from("suppliers")
    .select("id, name", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true)
    .in("id", chunk));
  if (error) throw mapSupabaseError(error, "Impossible de charger les fournisseurs.");
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/** The proposal of every line of the request that has an article and no supplier, null when no source has one. */
export async function listLineSupplierProposals(projectId: string, requestId: string): Promise<LineSupplierProposals> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  const { context } = access;
  const { supabase, tenantId } = context;

  const { data: lineRows, error: linesError } = await readAllRows(() => supabase
    .from("material_request_lines")
    .select("id, product_id, supplier_id", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", request.id)
    .not("product_id", "is", null));
  if (linesError) throw mapSupabaseError(linesError, "Impossible de charger les lignes de la demande.");
  const linked = (lineRows ?? []).filter((row): row is { id: string; product_id: string; supplier_id: string | null } =>
    typeof row.product_id === "string");
  const lines = linked.filter((row) => row.supplier_id === null);
  const supplied = linked.filter((row): row is { id: string; product_id: string; supplier_id: string } => row.supplier_id !== null);
  if (linked.length === 0) return { lines: {}, references: {} };

  // The article's active item at a supplier: the reference proposed with it, or the one of the line's own supplier.
  const { data: itemRows, error: itemsError } = await readAllRowsInChunks(uniqueIds(linked.map((row) => row.product_id)), (chunk) => supabase
    .from("supplier_catalog_items")
    .select("id, product_id, supplier_id, supplier_sku, product_url", { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .in("product_id", chunk));
  if (itemsError) throw mapSupabaseError(itemsError, "Impossible de charger les références fournisseurs.");
  const itemOf = new Map((itemRows ?? []).map((row) => [`${row.product_id}|${row.supplier_id}`, row]));
  const referenceAt = (productId: string, supplierId: string): LineSupplierReference => {
    const item = itemOf.get(`${productId}|${supplierId}`);
    return { supplier_sku: item?.supplier_sku ?? null, product_url: item?.product_url ?? null };
  };
  const references = Object.fromEntries(supplied.map((row) => [row.id, referenceAt(row.product_id, row.supplier_id)]));
  if (lines.length === 0) return { lines: {}, references };

  // A request holds 300 lines at most, so its articles fit in one call of last_purchase_suppliers (500 ids).
  const productIds = uniqueIds(lines.map((row) => row.product_id));
  const [products, supplyTypes, lastPurchases] = await Promise.all([
    readAllRowsInChunks(productIds, (chunk) => supabase
      .from("products")
      .select("id, preferred_supplier_id, supply_type_id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .in("id", chunk)),
    readAllRows(() => supabase
      .from("supply_types")
      .select("id, preferred_supplier_id", { count: "exact" })
      .eq("tenant_id", tenantId)
      .not("preferred_supplier_id", "is", null)),
    supabase.rpc("last_purchase_suppliers", { p_product_ids: productIds }),
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de charger les articles des lignes.");
  if (supplyTypes.error) throw mapSupabaseError(supplyTypes.error, "Impossible de charger les types de fourniture.");
  if (lastPurchases.error) throw mapSupabaseError(lastPurchases.error, "Impossible de charger les derniers achats.");

  const articles = new Map((products.data ?? []).map((row) => [row.id, row]));
  const typeSuppliers = new Map((supplyTypes.data ?? []).map((row) => [row.id, row.preferred_supplier_id]));
  const lastSuppliers = new Map((lastPurchases.data ?? []).map((row) => [row.product_id, row.supplier_id]));

  const sourcesOf = (productId: string): Array<[LineSupplierReason, string | null | undefined]> => {
    const article = articles.get(productId);
    return [
      ["technician", request.presumed_supplier_id],
      ["article", article?.preferred_supplier_id],
      ["supply_type", article?.supply_type_id ? typeSuppliers.get(article.supply_type_id) : null],
      ["last_purchase", lastSuppliers.get(productId)],
    ];
  };
  // An archived supplier is not proposed: the office cannot pick it, and the next source applies.
  const names = await readActiveSupplierNames(
    context,
    uniqueIds(productIds.flatMap((productId) => sourcesOf(productId).map(([, supplierId]) => supplierId))),
  );

  const proposalFor = (productId: string): LineSupplierProposal | null => {
    for (const [reason, supplierId] of sourcesOf(productId)) {
      const name = supplierId ? names.get(supplierId) : undefined;
      if (!supplierId || name === undefined) continue;
      return { supplier_id: supplierId, supplier_name: name, reason, ...referenceAt(productId, supplierId) };
    }
    return null;
  };
  return { lines: Object.fromEntries(lines.map((row) => [row.id, proposalFor(row.product_id)])), references };
}

/** An article of the active tenant, or 404: an article of another tenant does not exist here. */
async function requireArticle(context: MaterialRequestContext, productId: string): Promise<ArticleRow> {
  const { data, error } = await context.supabase
    .from("products")
    .select("id, created_by, preferred_supplier_id")
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger l'article.");
  if (!data) throw notFound(ARTICLE_NOT_FOUND);
  return data;
}

async function requireSupplier(context: MaterialRequestContext, supplierId: string) {
  const { data, error } = await context.supabase
    .from("suppliers")
    .select("id")
    .eq("id", supplierId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de vérifier le fournisseur.");
  if (!data) throw notFound(SUPPLIER_NOT_FOUND);
}

/**
 * The application's copy of the TI-689 rule (public.can_edit_catalogue_record): admins write every article,
 * engineers the ones they added, or all of them once their admin opened the shared base. 403 before any write.
 */
async function requireArticleEditor(context: MaterialRequestContext, productId: string): Promise<ArticleRow> {
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);
  const article = await requireArticle(context, productId);
  const engineersCanEditShared = context.tenantRole === "engineer"
    ? await readEngineersCanEditShared(context.supabase, context.tenantId)
    : false;
  const catalogueAccess = buildCatalogueAccess({ userId: context.userId, role: context.tenantRole, engineersCanEditShared });
  if (!canEditCatalogueRecord(catalogueAccess, article.created_by)) throw forbidden(SHARED_PRODUCT_REFUSAL);
  return article;
}

type ItemRow = {
  id: string;
  supplier_id: string;
  supplier_sku: string | null;
  product_url: string | null;
  is_active: boolean;
};

const ITEM_COLUMNS = "id, supplier_id, supplier_sku, product_url, is_active";

/** Items as the screen shows them: with their supplier's name and whether a price of the price book uses them. */
async function describeItems(context: MaterialRequestContext, rows: readonly ItemRow[]): Promise<ArticleSupplierItem[]> {
  if (rows.length === 0) return [];
  const [suppliers, prices] = await Promise.all([
    readAllRowsInChunks(uniqueIds(rows.map((row) => row.supplier_id)), (chunk) => context.supabase
      .from("suppliers")
      .select("id, name", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .in("id", chunk)),
    readAllRowsInChunks(rows.map((row) => row.id), (chunk) => context.supabase
      .from("supplier_pricebook")
      .select("id, supplier_catalog_item_id", { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .in("supplier_catalog_item_id", chunk)),
  ]);
  if (suppliers.error) throw mapSupabaseError(suppliers.error, "Impossible de charger les fournisseurs.");
  if (prices.error) throw mapSupabaseError(prices.error, "Impossible de charger les prix des fournisseurs.");
  const names = new Map((suppliers.data ?? []).map((row) => [row.id, row.name]));
  const priced = new Set((prices.data ?? []).map((row) => row.supplier_catalog_item_id));
  return rows
    .map((row) => ({
      id: row.id,
      supplier_id: row.supplier_id,
      supplier_name: names.get(row.supplier_id) ?? "",
      supplier_sku: row.supplier_sku,
      product_url: row.product_url,
      is_active: row.is_active,
      has_price: priced.has(row.id),
    }))
    .sort((left, right) =>
      Number(right.is_active) - Number(left.is_active)
      || left.supplier_name.localeCompare(right.supplier_name, "fr")
      || left.id.localeCompare(right.id));
}

/** The suppliers of an article, active ones first, for every member of the tenant (catalogue readers). */
export async function listArticleSupplierItems(productId: string): Promise<ArticleSuppliers> {
  const context = await getAuthenticatedTenantContext();
  const article = await requireArticle(context, productId);
  const { data, error } = await readAllRows(() => context.supabase
    .from("supplier_catalog_items")
    .select(ITEM_COLUMNS, { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId));
  if (error) throw mapSupabaseError(error, "Impossible de charger les fournisseurs de l'article.");
  return { items: await describeItems(context, data ?? []), preferred_supplier_id: article.preferred_supplier_id };
}

/** Refusals of public.save_supplier_catalog_item, as statuses and sentences. */
function saveRefusal(error: SupabaseErrorLike): ApiError | null {
  const message = error.message ?? "";
  if (message.includes("SUPPLIER_CATALOG_ITEM_EDITORS_ONLY")) return forbidden(PRODUCT_WRITE_REFUSAL);
  if (message.includes("SUPPLIER_CATALOG_ITEM_PRODUCT_LOCKED")) return forbidden(SHARED_PRODUCT_REFUSAL);
  if (message.includes("SUPPLIER_CATALOG_ITEM_PRODUCT_NOT_FOUND")) return notFound(ARTICLE_NOT_FOUND);
  if (message.includes("SUPPLIER_CATALOG_ITEM_SUPPLIER_NOT_FOUND")) return notFound(SUPPLIER_NOT_FOUND);
  if (message.includes("SUPPLIER_CATALOG_ITEM_SKU_INVALID")) return badRequest("La référence chez le fournisseur compte 255 caractères au plus.");
  if (message.includes("SUPPLIER_CATALOG_ITEM_URL_INVALID")) {
    return badRequest("L’adresse doit commencer par http:// ou https://, sans espace, en 2 000 caractères au plus.");
  }
  if (message.includes("SUPPLIER_CATALOG_ITEM_IDENTIFIER_REQUIRED")) {
    return badRequest("Renseignez la référence chez le fournisseur ou l’adresse de l’article.");
  }
  return null;
}

/**
 * What the database function receives for a value of the request: null keeps the stored one, a blank clears it.
 * A key the caller left out (undefined) keeps it; an explicit null clears it.
 */
function storedValueArgument(value: string | null | undefined): string | null {
  if (value === undefined) return null;
  return value ?? "";
}

/**
 * Adds or changes the reference of an article at a supplier, without any price, and answers the item and the
 * article's exception after it. Value by value: a key left out keeps the stored value, null clears it.
 * `is_active` (true when left out) withdraws or restores the supplier; withdrawing the supplier of the article's
 * exception clears the exception (in the same database call).
 */
export async function saveArticleSupplierItem(
  productId: string,
  input: SaveArticleSupplierItemData,
): Promise<ArticleSupplierItemSaved> {
  const context = await getAuthenticatedTenantContext();
  await requireArticleEditor(context, productId);
  await requireSupplier(context, input.supplier_id);

  const { data: itemId, error } = await context.supabase.rpc("save_supplier_catalog_item", {
    p_product_id: productId,
    p_supplier_id: input.supplier_id,
    p_supplier_sku: storedValueArgument(input.supplier_sku),
    p_product_url: storedValueArgument(input.product_url),
    p_is_active: input.is_active ?? true,
  });
  if (error) throw saveRefusal(error) ?? mapSupabaseError(error, "Impossible d'enregistrer la référence du fournisseur.");

  const [{ data: row, error: readError }, article] = await Promise.all([
    context.supabase
      .from("supplier_catalog_items")
      .select(ITEM_COLUMNS)
      .eq("id", itemId)
      .eq("tenant_id", context.tenantId)
      .maybeSingle(),
    requireArticle(context, productId),
  ]);
  if (readError) throw mapSupabaseError(readError, "Impossible de relire la référence du fournisseur.");
  if (!row) throw notFound("Référence du fournisseur introuvable.");
  const [item] = await describeItems(context, [row]);
  return { item, preferred_supplier_id: article.preferred_supplier_id };
}

/** The supplier exception of an article (null removes it), written like any field of the article. */
export async function setProductPreferredSupplier(
  productId: string,
  preferredSupplierId: string | null,
): Promise<{ preferred_supplier_id: string | null }> {
  const context = await getAuthenticatedTenantContext();
  await requireArticleEditor(context, productId);
  if (preferredSupplierId) await requireSupplier(context, preferredSupplierId);

  const { data, error } = await context.supabase
    .from("products")
    .update({ preferred_supplier_id: preferredSupplierId })
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .select("id, preferred_supplier_id")
    .maybeSingle();
  if (error) {
    // The supplier was deleted, or moved out of reach, since it was checked.
    if (error.message?.includes("PREFERRED_SUPPLIER_TENANT_MISMATCH")) throw notFound(SUPPLIER_NOT_FOUND);
    throw mapSupabaseError(error, "Impossible d'enregistrer le fournisseur de l'article.");
  }
  // A write filtered by the update policy reaches no row without raising: the article is one the caller may not change.
  if (!data) throw forbidden(SHARED_PRODUCT_REFUSAL);
  return { preferred_supplier_id: data.preferred_supplier_id };
}
