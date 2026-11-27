import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { buildCatalogueAccess, canAddToCatalogue, canEditCatalogueRecord } from "@/lib/catalogue/access";
import { readEngineersCanEditShared } from "@/lib/catalogue/access-server";
import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import {
  CATALOGUE_IMPORT_BATCH_PAGE_SIZE,
  REFERENCE_QUEUE_CHANGED,
  REVIEW_REFERENCES_MAX,
  type BulkProductsInput,
  type BulkProductsResult,
  type CatalogueImportBatchPage,
  type CatalogueImportBatchPosition,
  type CreateSupplierAliasInput,
  type PendingReferencesQuery,
  type PendingSupplierReferencePage,
  type ReviewReferencesInput,
  type ReviewReferencesResult,
  type SupplierAlias,
  type UndoImportResult,
} from "@/lib/catalogue/import-review-contract";
import { bulkValidationSummary, CATALOGUE_BULK_INCOMPLETE } from "@/lib/catalogue/import-review-feedback";
import { catalogueStatusError, PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { ApiError, badRequest, conflict, forbidden, mapSupabaseError, notFound, type SupabaseErrorLike } from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";

/**
 * Server side of what follows an import of the costing workbook (TI-711). The database functions decide who
 * may do what and what is left out (review_supplier_references, validate_draft_products,
 * assign_products_supply_type, undo_catalogue_import_batch); this module scopes every read to the active
 * company, turns a filter into the rows it names, and words the refusals.
 */

type Context = AuthenticatedTenantContext;

async function editorContext(): Promise<Context> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);
  return context;
}

const ALIAS_TAKEN = "Ce nom est déjà associé à un autre fournisseur. Retirez d’abord cette association.";
const SUPPLIER_GONE = "Ce fournisseur est introuvable ou archivé.";

export async function listSupplierAliases(): Promise<{ items: SupplierAlias[] }> {
  const { supabase, tenantId } = await getAuthenticatedTenantContext();
  const { data, error } = await readAllRows(() => supabase.from("supplier_aliases")
    .select("id, supplier_id, alias, created_at, suppliers!inner(name)", { count: "exact" }).eq("tenant_id", tenantId));
  if (error) throw mapSupabaseError(error, "Impossible de lire les noms associés aux fournisseurs.");
  const items = (data ?? []).map((row) => ({
    id: row.id, supplier_id: row.supplier_id, supplier_name: row.suppliers.name, alias: row.alias, created_at: row.created_at,
  }));
  return { items: items.sort((left, right) => left.alias.localeCompare(right.alias, "fr")) };
}

/**
 * Remembers that the workbook writes this name for this supplier: the next previews attach its references
 * without a correction. Asking again for the same pair changes nothing; a name already given to another
 * supplier is refused, since one name must stand for one supplier.
 */
export async function createSupplierAlias(input: CreateSupplierAliasInput): Promise<{ item: SupplierAlias }> {
  const { supabase, tenantId } = await editorContext();
  const supplier = await supabase.from("suppliers").select("id, name")
    .eq("tenant_id", tenantId).eq("id", input.supplier_id).eq("is_active", true).maybeSingle();
  if (supplier.error) throw mapSupabaseError(supplier.error, "Impossible de lire le fournisseur.");
  if (!supplier.data) throw notFound(SUPPLIER_GONE);

  const aliasKey = workbookSupplierNameKey(input.alias);
  if (!aliasKey) throw badRequest("Le nom à associer est requis.");
  const select = "id, supplier_id, alias, created_at";
  const inserted = await supabase.from("supplier_aliases")
    .insert({ tenant_id: tenantId, supplier_id: input.supplier_id, alias: input.alias, alias_key: aliasKey })
    .select(select).single();
  let row = inserted.data;
  if (inserted.error) {
    if (inserted.error.code === "42501") throw forbidden(PRODUCT_WRITE_REFUSAL);
    if (inserted.error.code !== "23505") throw mapSupabaseError(inserted.error, "Impossible d’associer ce nom au fournisseur.");
    const existing = await supabase.from("supplier_aliases").select(select)
      .eq("tenant_id", tenantId).eq("alias_key", aliasKey).maybeSingle();
    if (existing.error) throw mapSupabaseError(existing.error, "Impossible d’associer ce nom au fournisseur.");
    if (existing.data?.supplier_id !== input.supplier_id) throw conflict(ALIAS_TAKEN);
    row = existing.data;
  }
  if (!row) throw conflict(ALIAS_TAKEN);
  return { item: { ...row, supplier_name: supplier.data.name } };
}

export async function deleteSupplierAlias(aliasId: string): Promise<{ id: string }> {
  const { supabase, tenantId } = await editorContext();
  const { data, error } = await supabase.from("supplier_aliases").delete()
    .eq("tenant_id", tenantId).eq("id", aliasId).select("id").maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de retirer cette association.");
  // The policy lets an administrator or the author delete: nothing deleted is a refusal, not a success.
  if (!data) throw notFound("Cette association est introuvable, ou seul son auteur ou un administrateur peut la retirer.");
  return { id: data.id };
}

type ReferenceFilter = Pick<PendingReferencesQuery, "supplier_id" | "import_batch_id" | "q">;

/** `%` and `_` typed by the office are characters to find, not wildcards. */
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

async function catalogueAccessOf({ supabase, tenantId, tenantRole, userId }: Context) {
  const engineersCanEditShared = tenantRole === "engineer" ? await readEngineersCanEditShared(supabase, tenantId) : false;
  return buildCatalogueAccess({ userId, role: tenantRole, engineersCanEditShared });
}

function pendingReferencesQuery<Columns extends string>({ supabase, tenantId }: Context, filter: ReferenceFilter, columns: Columns) {
  let request = supabase.from("supplier_catalog_items").select(columns, { count: "exact" })
    .eq("tenant_id", tenantId).eq("reference_needs_review", true);
  if (filter.supplier_id) request = request.eq("supplier_id", filter.supplier_id);
  if (filter.import_batch_id) request = request.eq("import_batch_id", filter.import_batch_id);
  if (filter.q) request = request.ilike("supplier_sku", likePattern(filter.q));
  return request;
}

function referenceSelectionSignature(ids: readonly string[]): string {
  return createHash("sha256").update(ids.toSorted().join("\n")).digest("hex");
}

/** The references an import left to check, the latest first: the office reads them together instead of article by article. */
export async function listPendingSupplierReferences(query: PendingReferencesQuery): Promise<PendingSupplierReferencePage> {
  const context = await getAuthenticatedTenantContext();
  const from = (query.page - 1) * query.size;
  const request = pendingReferencesQuery(context, query,
    "id, product_id, supplier_id, supplier_sku, product_url, created_at, import_batch_id, products!inner(reference, designation, created_by), suppliers!inner(name)");
  const [{ data, error, count }, access] = await Promise.all([
    request.order("created_at", { ascending: false }).order("id").range(from, from + query.size - 1),
    catalogueAccessOf(context),
  ]);
  if (error) throw mapSupabaseError(error, "Impossible de lire les références à vérifier.");
  const totalItems = count ?? 0;
  const rows = data ?? [];
  // A single page can supply its own IDs without another query. On larger lists, compare the two reads
  // before offering a confirmation. A failed scan leaves the page readable, but prevents bulk approval.
  const ids = rows.length === totalItems
    ? rows.map((row) => row.id)
    : await pendingReferenceIds(context, query).catch(() => null);
  const idSet = new Set(ids);
  const selection_signature = ids?.length === totalItems && rows.every((row) => idSet.has(row.id))
    ? referenceSelectionSignature(ids)
    : null;
  return {
    selection_signature,
    items: rows.map((row) => ({
      id: row.id,
      product_id: row.product_id,
      product_reference: row.products.reference,
      product_designation: row.products.designation,
      supplier_id: row.supplier_id,
      supplier_name: row.suppliers.name,
      supplier_sku: row.supplier_sku,
      product_url: row.product_url,
      created_at: row.created_at,
      import_batch_id: row.import_batch_id,
      can_review: canEditCatalogueRecord(access, row.products.created_by),
    })),
    pagination: { page: query.page, size: query.size, totalItems, totalPages: Math.ceil(totalItems / query.size) },
  };
}

async function pendingReferenceIds(context: Context, filter: ReferenceFilter): Promise<string[]> {
  // Apply the same joins as the page so relation visibility cannot change what a confirmation covers.
  const { data, error } = await readAllRows(
    () => pendingReferencesQuery(context, filter, "id, products!inner(), suppliers!inner()"),
    { concurrency: 4, pageSize: 1000 },
  );
  if (error) throw mapSupabaseError(error, "Impossible de lire les références à vérifier.");
  return (data ?? []).map((row) => row.id);
}

const reviewAnswerSchema = z.object({ reviewed: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() });

/**
 * Checks references together. What the member may not review (another's article for an engineer without the
 * shared base, an archived article or supplier) is left as it is and counted, never an error.
 */
export async function reviewSupplierReferences(input: ReviewReferencesInput): Promise<ReviewReferencesResult> {
  const context = await editorContext();
  // Accept the old request shape for a clear refusal, including when the count still matches.
  if ("filter" in input && !input.expected_selection) throw conflict(REFERENCE_QUEUE_CHANGED);
  const ids = "ids" in input ? input.ids : await pendingReferenceIds(context, input.filter);
  if ("filter" in input && (input.expected_count !== ids.length || input.expected_selection !== referenceSelectionSignature(ids))) {
    throw conflict(REFERENCE_QUEUE_CHANGED);
  }
  const result = { reviewed: 0, skipped: 0 };
  for (let start = 0; start < ids.length; start += REVIEW_REFERENCES_MAX) {
    const { data, error } = await context.supabase.rpc("review_supplier_references", {
      p_item_ids: ids.slice(start, start + REVIEW_REFERENCES_MAX),
      p_validate: input.action === "validate",
    });
    if (error) {
      const refusal = error.code === "42501" ? forbidden(PRODUCT_WRITE_REFUSAL) : mapSupabaseError(error, "Impossible de vérifier ces références.");
      const verb = input.action === "validate" ? "validées" : "retirées";
      throw bulkRefusal(start, refusal, result, `${result.reviewed.toLocaleString("fr-FR")} références ${verb}. ${result.skipped.toLocaleString("fr-FR")} laissées en attente.`);
    }
    const answer = reviewAnswerSchema.parse(data);
    result.reviewed += answer.reviewed;
    result.skipped += answer.skipped;
  }
  return result;
}

const validateAnswerSchema = z.object({
  validated: z.number().int().nonnegative(), incomplete: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
});

function productBulkError(error: SupabaseErrorLike, fallback: string) {
  return catalogueStatusError(error) ?? (error.code === "42501" ? forbidden(PRODUCT_WRITE_REFUSAL) : mapSupabaseError(error, fallback));
}

function bulkRefusal(start: number, refusal: ApiError, committed: BulkProductsResult | ReviewReferencesResult, summary: string) {
  if (start === 0) return refusal;
  return new ApiError({
    status: refusal.status,
    code: CATALOGUE_BULK_INCOMPLETE,
    message: `${summary} ${refusal.message} Actualisez la liste avant de réessayer.`,
    details: { committed },
  });
}

async function draftIdsOfBatch({ supabase, tenantId }: Context, batchId: string): Promise<string[]> {
  const { data, error } = await readAllRows(() => supabase.from("products").select("id", { count: "exact" })
    .eq("tenant_id", tenantId).eq("import_batch_id", batchId).eq("catalogue_status", "draft"), { concurrency: 4 });
  if (error) throw mapSupabaseError(error, "Impossible de lire les brouillons de cet import.");
  return (data ?? []).map((row) => row.id);
}

/**
 * Articles one statement edits. The database accepts 5 000, but each article passes its row policy and its
 * triggers: measured locally, 5 000 take 1,2 to 2,4 s, too close to the API roles' 8 s once the planning factor
 * of the statement budget is applied. 1 000 stay far from it.
 */
const PRODUCTS_PER_STATEMENT = 1000;

/** Validates the complete drafts together (an administrator's act), or gives one supply type to several articles. */
export async function bulkUpdateProducts(input: BulkProductsInput): Promise<BulkProductsResult> {
  const context = await editorContext();
  if (input.action === "assign-supply-type") {
    let updated = 0;
    for (let start = 0; start < input.ids.length; start += PRODUCTS_PER_STATEMENT) {
      const { data, error } = await context.supabase.rpc("assign_products_supply_type", {
        p_product_ids: input.ids.slice(start, start + PRODUCTS_PER_STATEMENT), p_supply_type_id: input.supply_type_id,
      });
      if (error) {
        throw bulkRefusal(start, productBulkError(error, "Impossible de donner cette famille aux articles."),
          { action: "assign-supply-type", updated }, `Famille appliquée à ${updated.toLocaleString("fr-FR")} articles.`);
      }
      updated += data ?? 0;
    }
    return { action: "assign-supply-type", updated };
  }

  if (context.tenantRole !== "admin") throw forbidden("La validation d’un article en brouillon est réservée aux administrateurs.");
  const ids = "ids" in input ? input.ids : await draftIdsOfBatch(context, input.import_batch_id);
  const result = { action: "validate" as const, validated: 0, incomplete: 0, skipped: 0 };
  for (let start = 0; start < ids.length; start += PRODUCTS_PER_STATEMENT) {
    const { data, error } = await context.supabase.rpc("validate_draft_products", {
      p_product_ids: ids.slice(start, start + PRODUCTS_PER_STATEMENT),
    });
    if (error) {
      throw bulkRefusal(start, productBulkError(error, "Impossible de valider ces articles."), result, bulkValidationSummary(result));
    }
    const answer = validateAnswerSchema.parse(data);
    result.validated += answer.validated;
    result.incomplete += answer.incomplete;
    result.skipped += answer.skipped;
  }
  return result;
}

export async function listCatalogueImportBatches(position?: CatalogueImportBatchPosition): Promise<CatalogueImportBatchPage> {
  const { supabase, tenantId, tenantRole, userId } = await getAuthenticatedTenantContext();
  const query = supabase.from("catalogue_import_batches")
    .select("id, kind, source_name, created_at, created_by, undo_started_at, undone_at, products!products_import_batch_fkey()")
    .eq("tenant_id", tenantId)
    // An empty article import is visible once its undo has started. The FK includes the tenant.
    .or("kind.neq.workbook_articles,undo_started_at.not.is.null,undone_at.not.is.null,products.not.is.null")
    .limit(1, { referencedTable: "products" })
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(CATALOGUE_IMPORT_BATCH_PAGE_SIZE + 1);
  if (position) {
    const [createdAt, id] = position;
    query.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`);
  }
  const batches = await query;
  if (batches.error) throw mapSupabaseError(batches.error, "Impossible de lire les imports du catalogue.");

  const rows = batches.data ?? [];
  const counted = ({ count: rows, error }: { count: number | null; error: SupabaseErrorLike | null }) => {
    if (error) throw mapSupabaseError(error, "Impossible de lire les imports du catalogue.");
    return rows ?? 0;
  };
  /** What the import created that still exists, and among it what is still a draft, or still to check. */
  const articles = (batchId: string) => supabase.from("products").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("import_batch_id", batchId);
  const references = (batchId: string) => supabase.from("supplier_catalog_items").select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId).eq("import_batch_id", batchId);
  const items = await Promise.all(rows.slice(0, CATALOGUE_IMPORT_BATCH_PAGE_SIZE).map(async (batch) => {
    const kind = batch.kind;
    const [total, open] = kind === "workbook_articles"
      ? await Promise.all([articles(batch.id).then(counted), articles(batch.id).eq("catalogue_status", "draft").then(counted)])
      : await Promise.all([references(batch.id).then(counted), references(batch.id).eq("reference_needs_review", true).then(counted)]);
    return {
      id: batch.id, kind, source_name: batch.source_name, created_at: batch.created_at,
      undo_started_at: batch.undo_started_at, undone_at: batch.undone_at, total, open,
      can_undo: !batch.undone_at && canAddToCatalogue(tenantRole) && (tenantRole === "admin" || batch.created_by === userId),
    };
  }));
  const last = items.at(-1);
  return { items, next_cursor: last && rows.length > CATALOGUE_IMPORT_BATCH_PAGE_SIZE ? `${last.created_at},${last.id}` : null };
}

const undoAnswerSchema = z.object({
  deleted: z.number().int().nonnegative(), kept: z.number().int().nonnegative(), done: z.boolean(),
});

/** Rows one call of the database function examines, and calls one request makes: 20 000 rows, well within its time. */
const UNDO_PAGE = 500;
const UNDO_MAX_CALLS = 40;

/**
 * Undoes an import: removes the drafts and the pending references it created that nobody touched since. What
 * was validated, checked or is used elsewhere is kept and counted.
 */
export async function undoCatalogueImportBatch(batchId: string): Promise<UndoImportResult> {
  const { supabase } = await editorContext();
  const result = { deleted: 0, kept: 0 };
  for (let call = 0; call < UNDO_MAX_CALLS; call += 1) {
    const { data, error } = await supabase.rpc("undo_catalogue_import_batch", { p_batch_id: batchId, p_limit: UNDO_PAGE });
    if (error?.code === "P0002") throw notFound("Cet import est introuvable.");
    if (error?.code === "42501") throw forbidden("Seul un administrateur ou l’auteur de l’import peut l’annuler.");
    if (error) throw mapSupabaseError(error, "Impossible d’annuler cet import.");
    const answer = undoAnswerSchema.parse(data);
    result.deleted += answer.deleted;
    result.kept += answer.kept;
    if (answer.done) return result;
  }
  throw conflict(`L’annulation est en cours : ${result.deleted.toLocaleString("fr-FR")} éléments retirés. Relancez-la pour la terminer.`);
}
