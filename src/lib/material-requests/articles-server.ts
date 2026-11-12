import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { canAddToCatalogue } from "@/lib/catalogue/access";
import { PRODUCT_REFERENCE_TAKEN, PRODUCT_WRITE_REFUSAL, catalogueStatusError } from "@/lib/catalogue/product-writes";
import { badRequest, conflict, forbidden, mapSupabaseError, notFound } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";

import type {
  CreateMaterialRequestLineArticleData,
  LinkMaterialRequestLineArticleData,
  MaterialRequest,
  MaterialRequestArticleCandidate,
  MaterialRequestArticleSummary,
  MaterialRequestLine,
  MaterialRequestLineArticleResult,
  MaterialRequestProductMatch,
} from "./contracts";
import { MATERIAL_REQUEST_LINE_CHANGED } from "./contracts";
import {
  aliasKey,
  matchLine,
  prepareCatalogue,
  type MatchArticle,
  type MatchOptions,
  type MatchRequestLine,
  type PreparedCatalogue,
  unitsDiffer,
} from "./matching";
import {
  DUPLICATE_KEYS,
  LINE_COLUMNS,
  requireProjectAccess,
  requireRequest,
  type MaterialRequestAccess,
  type MaterialRequestContext,
} from "./server-shared";

/**
 * Lines and catalogue articles (TI-690, delivery 3, « le rapprochement »). The office links each line to an
 * article; nothing is linked without its gesture.
 *  - Proposals come from matching.ts, over the active articles of the tenant (drafts included).
 *  - Linking writes the catalogue's wording into the line (type, material, precision, size, unit); the
 *    technician's own words stay in original_text (filled from them when the line had none) and the
 *    reference they wrote stays in reference. A column the article leaves blank keeps the line's own value.
 *    The line's own wording before its first link is remembered (pre_link_wording, never sent to the
 *    browser): an unlink gives it back, and a relink keeps it.
 *  - Each link teaches the article a usual name: the technician's type words (remembered, or the line's
 *    when nothing is), when they are not already the article's type or designation.
 *  - A unit replaced by another asks the office to check the quantity (quantity_doubtful).
 *  - A link or an unlink is written only over the line as it was read: an edit made in between answers 409.
 *  - A validated line that is linked, relinked or unlinked returns to draft (the line trigger holds it too).
 * Reading follows the affaire; writing asks for the writers of material requests. Creating an article also
 * asks for the catalogue's insert right (TI-689: admins and engineers), checked again by the policies.
 */

const ARTICLE_COLUMNS =
  "id, reference, designation, product_type, material, grade, dimensions, standard, unit, catalogue_status, created_from_material_request, supply_type_id";

const LINE_NOT_FOUND = "Ligne introuvable dans cette demande.";
const ARTICLE_NOT_FOUND = "Article introuvable dans le catalogue.";
const SUPPLY_TYPE_NOT_FOUND = "Ce type de fourniture n’existe pas dans votre référentiel.";
const ALIAS_DELETE_REFUSAL = "Un nom usuel est retiré par un administrateur ou par le membre qui l’a appris.";
const LINE_CHANGED = "La ligne a changé entre-temps : rechargez la demande, puis rattachez-la à nouveau.";
/** What the link reads of a line beyond the contract: its version and its wording before the link. */
const STORED_LINE_COLUMNS = `${LINE_COLUMNS}, updated_at, pre_link_wording`;
/** One line searched by hand: the matcher answers at most five proposals (MAX_CANDIDATES in matching.ts). */
const SEARCH_LIMIT = 10;

type ArticleRow = {
  id: string;
  reference: string | null;
  designation: string;
  product_type: string | null;
  material: string | null;
  grade: string | null;
  dimensions: string | null;
  standard: string | null;
  unit: string;
  catalogue_status: "draft" | "validated";
  created_from_material_request: boolean;
  supply_type_id: string | null;
};

function summaryOf(row: ArticleRow, supplyTypeName: string | null): MaterialRequestArticleSummary {
  return {
    id: row.id,
    reference: row.reference,
    designation: row.designation,
    product_type: row.product_type,
    material: row.material,
    dimensions: row.dimensions,
    unit: row.unit,
    catalogue_status: row.catalogue_status,
    created_from_material_request: row.created_from_material_request,
    supply_type_name: supplyTypeName,
  };
}

async function readSupplyTypeNames(context: MaterialRequestContext, ids: ReadonlyArray<string | null>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await context.supabase
    .from("supply_types")
    .select("id, name")
    .eq("tenant_id", context.tenantId)
    .in("id", wanted);
  if (error) throw mapSupabaseError(error, "Impossible de charger les types de fourniture.");
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/** The summary of every article named, by id: those of the active tenant, archived ones included. */
export async function readArticleSummaries(
  context: MaterialRequestContext,
  productIds: ReadonlyArray<string | null>,
): Promise<Record<string, MaterialRequestArticleSummary>> {
  const ids = [...new Set(productIds.filter((id): id is string => typeof id === "string"))];
  if (ids.length === 0) return {};
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase
    .from("products")
    .select(ARTICLE_COLUMNS, { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .in("id", chunk));
  if (error) throw mapSupabaseError(error, "Impossible de charger les articles des lignes.");
  const rows = (data ?? []) as ArticleRow[];
  const names = await readSupplyTypeNames(context, rows.map((row) => row.supply_type_id));
  return Object.fromEntries(rows.map((row) => [row.id, summaryOf(row, row.supply_type_id ? (names.get(row.supply_type_id) ?? null) : null)]));
}

type LoadedCatalogue = { prepared: PreparedCatalogue; summaries: ReadonlyMap<string, MaterialRequestArticleSummary> };

/**
 * The catalogue of the active tenant, read once per call and prepared once for every line: its active
 * articles (drafts included), their supplier references, their usual names and their supply type.
 *
 * Why on the server: about 2,600 articles with their supplier references and usual names would be sent to
 * every browser that opens a request, and read again whenever the office teaches a name. Here they are read
 * under the caller's own rights (RLS), for the tenant of the URL only, and a name another member just taught
 * is proposed at the next call.
 */
async function loadCatalogue(context: MaterialRequestContext): Promise<LoadedCatalogue> {
  const { supabase, tenantId } = context;
  const [products, skus, aliases, supplyTypes] = await Promise.all([
    readAllRows(() => supabase.from("products").select(ARTICLE_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId).eq("is_active", true), { concurrency: 4 }),
    readAllRows(() => supabase.from("supplier_catalog_items").select("id, product_id, supplier_sku", { count: "exact" })
      .eq("tenant_id", tenantId).not("supplier_sku", "is", null), { concurrency: 4 }),
    readAllRows(() => supabase.from("product_aliases").select("id, product_id, alias", { count: "exact" })
      .eq("tenant_id", tenantId), { concurrency: 4 }),
    readAllRows(() => supabase.from("supply_types").select("id, name", { count: "exact" }).eq("tenant_id", tenantId)),
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de charger le catalogue.");
  if (skus.error) throw mapSupabaseError(skus.error, "Impossible de charger les références fournisseurs.");
  if (aliases.error) throw mapSupabaseError(aliases.error, "Impossible de charger les noms usuels.");
  if (supplyTypes.error) throw mapSupabaseError(supplyTypes.error, "Impossible de charger les types de fourniture.");

  const skusOf = new Map<string, string[]>();
  for (const item of skus.data ?? []) {
    if (!item.supplier_sku) continue;
    const list = skusOf.get(item.product_id) ?? [];
    list.push(item.supplier_sku);
    skusOf.set(item.product_id, list);
  }
  const aliasesOf = new Map<string, string[]>();
  for (const alias of aliases.data ?? []) {
    const list = aliasesOf.get(alias.product_id) ?? [];
    list.push(alias.alias);
    aliasesOf.set(alias.product_id, list);
  }
  const supplyTypeNames = new Map((supplyTypes.data ?? []).map((row) => [row.id, row.name]));

  const rows = (products.data ?? []) as ArticleRow[];
  const articles: MatchArticle[] = rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    designation: row.designation,
    product_type: row.product_type,
    material: row.material,
    grade: row.grade,
    dimensions: row.dimensions,
    standard: row.standard,
    unit: row.unit,
    catalogue_status: row.catalogue_status,
    supplier_skus: skusOf.get(row.id) ?? [],
    // The words as taught: the matcher keys them as it keys the line.
    aliases: aliasesOf.get(row.id) ?? [],
  }));
  const summaries = new Map(rows.map((row) => [
    row.id,
    summaryOf(row, row.supply_type_id ? (supplyTypeNames.get(row.supply_type_id) ?? null) : null),
  ]));
  return { prepared: prepareCatalogue(articles), summaries };
}

/**
 * What the matcher reads of a line. Its material, else the request's presumed one, confirmed or not: a hint,
 * not a decision. Overhead (PPE, small tooling) is not ordered in the request's material, as for validation.
 */
function matchInput(line: MaterialRequestLine, request: MaterialRequest, productType: string | null = line.product_type): MatchRequestLine {
  const ownMaterial = line.material?.trim() ? line.material : null;
  return {
    reference: line.reference,
    product_type: productType,
    material: ownMaterial ?? (line.imputation === "project" ? request.presumed_material : null),
    material_precision: line.material_precision,
    dimension: line.dimension,
    unit: line.unit,
  };
}

function candidatesFor(
  input: MatchRequestLine,
  catalogue: LoadedCatalogue,
  options?: MatchOptions,
): MaterialRequestArticleCandidate[] {
  return matchLine(input, catalogue.prepared, options).flatMap((candidate) => {
    const article = catalogue.summaries.get(candidate.product_id);
    return article
      ? [{ article, score: candidate.score, via: candidate.via, reasons: candidate.reasons, warnings: candidate.warnings }]
      : [];
  });
}

/** The columns of a line that say what it is, as remembered before its first link. */
type LineWording = {
  product_type: string | null;
  material: string | null;
  material_precision: string | null;
  dimension: string | null;
  no_dimension: boolean;
  unit: string | null;
  quantity_doubtful: boolean;
};

/** A line as the link reads it: the contract, its version for the compare-and-set, its remembered wording. */
type StoredLine = { line: MaterialRequestLine; updatedAt: string; preLinkWording: LineWording | null };

function wordingFromLine(line: MaterialRequestLine): LineWording {
  return {
    product_type: line.product_type,
    material: line.material,
    material_precision: line.material_precision,
    dimension: line.dimension,
    no_dimension: line.no_dimension,
    unit: line.unit,
    quantity_doubtful: line.quantity_doubtful,
  };
}

function readWording(value: unknown): LineWording | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stored = value as Record<string, unknown>;
  const text = (entry: unknown) => (typeof entry === "string" ? entry : null);
  return {
    product_type: text(stored.product_type),
    material: text(stored.material),
    material_precision: text(stored.material_precision),
    dimension: text(stored.dimension),
    no_dimension: stored.no_dimension === true,
    unit: text(stored.unit),
    quantity_doubtful: stored.quantity_doubtful === true,
  };
}

async function requireLine(access: MaterialRequestAccess, requestId: string, lineId: string): Promise<StoredLine> {
  const { data, error } = await access.context.supabase
    .from("material_request_lines")
    .select(STORED_LINE_COLUMNS)
    .eq("id", lineId)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger la ligne.");
  if (!data) throw notFound(LINE_NOT_FOUND);
  const { updated_at: updatedAt, pre_link_wording: preLinkWording, ...line } = data;
  return { line, updatedAt, preLinkWording: readWording(preLinkWording) };
}

/** Proposals for every line of the request that has no article yet, draft or validated. */
export async function listMaterialRequestCandidates(
  projectId: string,
  requestId: string,
): Promise<{ lines: Record<string, MaterialRequestArticleCandidate[]> }> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  const { data, error } = await readAllRows(() => access.context.supabase
    .from("material_request_lines")
    .select(LINE_COLUMNS, { count: "exact" })
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", request.id)
    .is("product_id", null));
  if (error) throw mapSupabaseError(error, "Impossible de charger les lignes de la demande.");
  const pending = data ?? [];
  if (pending.length === 0) return { lines: {} };

  const catalogue = await loadCatalogue(access.context);
  return {
    lines: Object.fromEntries(pending.map((line) => [line.id, candidatesFor(matchInput(line, request), catalogue)])),
  };
}

/**
 * Proposals for one line, linked or not. Words searched by hand replace the line's type words for this
 * search only; its size, material and reference still guide it.
 */
export async function searchMaterialRequestLineCandidates(
  projectId: string,
  requestId: string,
  lineId: string,
  query?: string,
): Promise<{ candidates: MaterialRequestArticleCandidate[] }> {
  const access = await requireProjectAccess(projectId, "read");
  const request = await requireRequest(access, requestId);
  const { line } = await requireLine(access, request.id, lineId);
  const catalogue = await loadCatalogue(access.context);
  const input = matchInput(line, request, query ?? line.product_type);
  // Searched by hand, another size or material is proposed too, flagged and after the matching ones.
  return { candidates: candidatesFor(input, catalogue, { limit: SEARCH_LIMIT, byHand: query !== undefined }) };
}

function filled(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The catalogue's wording, in the line's columns and within their lengths. A column the article leaves
 * blank keeps what the line says: an article whose size is in its designation does not erase the size the
 * technician gave. The precision is the article's grade and standard. A size given by the article unchecks
 * « sans dimension ».
 */
function wordingOf(line: MaterialRequestLine, article: ArticleRow) {
  const precision = [...new Set([article.grade, article.standard].map((value) => value?.trim()).filter(Boolean))].join(" ");
  const dimension = filled(article.dimensions, 80) ?? line.dimension;
  return {
    product_type: filled(article.product_type, 200) ?? filled(article.designation, 200) ?? line.product_type,
    material: filled(article.material, 120) ?? line.material,
    material_precision: filled(precision, 120) ?? line.material_precision,
    dimension,
    no_dimension: dimension?.trim() ? false : line.no_dimension,
    unit: filled(article.unit, 20) ?? line.unit,
  };
}

/**
 * The quantity was counted in the line's unit: another unit (« 3 barres » becoming « 3 ml ») makes it
 * doubtful. Units are compared by their code, or as written when one of them has none.
 */
/** The technician's type words, as a usual name of the article, unless the article already says them. */
function aliasToLearn(words: string | null, article: ArticleRow): { alias: string; alias_key: string } | null {
  const alias = words?.trim() ?? "";
  const key = aliasKey(alias);
  if (!key || key.length > 200 || alias.length > 200) return null;
  if (key === aliasKey(article.product_type) || key === aliasKey(article.designation)) return null;
  return { alias, alias_key: key };
}

async function learnAlias(context: MaterialRequestContext, article: ArticleRow, learned: { alias: string; alias_key: string }) {
  const { error } = await context.supabase
    .from("product_aliases")
    .insert({ product_id: article.id, alias: learned.alias, alias_key: learned.alias_key });
  if (!error) return learned.alias;
  // Already taught for this article: nothing new is learned.
  if (error.code !== "23505") {
    console.error("A usual name could not be learned for a catalogue article", { productId: article.id, error });
  }
  return null;
}

type LineWrite = Partial<Pick<MaterialRequestLine,
  | "product_type" | "material" | "material_precision" | "dimension" | "no_dimension" | "unit" | "quantity_doubtful"
  | "original_text" | "product_id" | "product_match" | "status" | "duplicate_acknowledged">> & {
  pre_link_wording?: LineWording | null;
};

/**
 * One write of the line, of the columns that change only, and only over the line as it was read: an edit
 * made in between by another session is never overwritten (409 MATERIAL_REQUEST_LINE_CHANGED). A validated
 * line returns to draft once what it says changes (the trigger does it too); a kept duplicate is asked again
 * once the piece it was said of changes.
 */
async function writeLine(access: MaterialRequestAccess, stored: StoredLine, next: LineWrite): Promise<MaterialRequestLine> {
  const { line } = stored;
  const patch: LineWrite = {};
  const changed: string[] = [];
  for (const [key, value] of Object.entries(next) as Array<[keyof LineWrite, unknown]>) {
    const before = key === "pre_link_wording" ? stored.preLinkWording : line[key];
    if (JSON.stringify(before ?? null) === JSON.stringify(value ?? null)) continue;
    (patch as Record<string, unknown>)[key] = value;
    changed.push(key);
  }
  if (changed.length === 0) return line;
  if (line.status === "validated") patch.status = "draft";
  if (line.duplicate_acknowledged && DUPLICATE_KEYS.some((key) => changed.includes(key))) {
    patch.duplicate_acknowledged = false;
  }
  const { data, error } = await access.context.supabase
    .from("material_request_lines")
    .update(patch)
    .eq("id", line.id)
    .eq("tenant_id", access.context.tenantId)
    .eq("project_id", access.project.id)
    .eq("request_id", line.request_id)
    .eq("updated_at", stored.updatedAt)
    .select(LINE_COLUMNS)
    .maybeSingle();
  if (error) {
    // The article was deleted, or moved out of reach, since it was read.
    if (error.code === "23514" && error.message === "MATERIAL_REQUEST_TENANT_MISMATCH") throw notFound(ARTICLE_NOT_FOUND);
    throw mapSupabaseError(error, "Impossible d'enregistrer la ligne.");
  }
  if (data) return data;
  // Nothing reached: the line is gone (404), or it changed since it was read (409).
  await requireLine(access, line.request_id, line.id);
  throw conflict(LINE_CHANGED, undefined, MATERIAL_REQUEST_LINE_CHANGED);
}

/**
 * Links the line, then teaches the usual name. One logical operation for the office, two statements here:
 * the link is what the office asked for, so it stands even when the name cannot be learned (the failure is
 * logged, and the next link of the same words teaches it again). A name already taught is not an error, and
 * nothing is learned when the link itself is refused.
 *
 * The technician's words are those remembered at the first link, kept on every relink (directly from one
 * article to another, or after an unlink, which gives them back): a relink teaches the new article what the
 * technician wrote, never the former article's wording.
 */
async function linkLine(
  access: MaterialRequestAccess,
  stored: StoredLine,
  article: ArticleRow,
  supplyTypeName: string | null,
  match: MaterialRequestProductMatch,
): Promise<MaterialRequestLineArticleResult> {
  const { line } = stored;
  const own = stored.preLinkWording ?? wordingFromLine(line);
  const wording = wordingOf(line, article);
  const next: LineWrite = { ...wording, product_id: article.id, product_match: match };
  // Remembered with the first link (the database accepts it only in the statement that sets the article).
  if (stored.preLinkWording === null && line.product_id !== article.id) next.pre_link_wording = own;
  if (!line.original_text?.trim()) {
    const words = [own.product_type, own.dimension, own.material].map((part) => part?.trim()).filter(Boolean).join(" ");
    if (words) next.original_text = words.slice(0, 500);
  }
  if (!line.quantity_doubtful && unitsDiffer(line.unit, wording.unit)) next.quantity_doubtful = true;

  const learned = aliasToLearn(own.product_type, article);
  const written = await writeLine(access, stored, next);
  const aliasLearned = learned ? await learnAlias(access.context, article, learned) : null;
  return { line: written, article: summaryOf(article, supplyTypeName), alias_learned: aliasLearned };
}

async function readActiveArticle(context: MaterialRequestContext, productId: string): Promise<ArticleRow> {
  const { data, error } = await context.supabase
    .from("products")
    .select(ARTICLE_COLUMNS)
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger l'article.");
  if (!data) throw notFound(ARTICLE_NOT_FOUND);
  return data as ArticleRow;
}

export async function linkMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
  input: LinkMaterialRequestLineArticleData,
): Promise<MaterialRequestLineArticleResult> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const line = await requireLine(access, request.id, lineId);
  const article = await readActiveArticle(access.context, input.product_id);
  const names = await readSupplyTypeNames(access.context, [article.supply_type_id]);
  return linkLine(access, line, article, article.supply_type_id ? (names.get(article.supply_type_id) ?? null) : null, input.via);
}

/**
 * Only the link goes: the line gets back the wording it had before its first link (and the proposals are
 * computed on it again). A line linked without remembered wording keeps its columns.
 */
export async function unlinkMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
): Promise<{ line: MaterialRequestLine }> {
  const access = await requireProjectAccess(projectId, "write");
  const request = await requireRequest(access, requestId);
  const stored = await requireLine(access, request.id, lineId);
  if (stored.line.product_id === null) return { line: stored.line };
  const restored: LineWrite = stored.preLinkWording ? { ...stored.preLinkWording, pre_link_wording: null } : {};
  const written = await writeLine(access, stored, { ...restored, product_id: null, product_match: null });
  return { line: written };
}

/**
 * Creates the article the line names, as a draft marked as created from a request, then links it. The
 * article is written with the caller's own client: the catalogue policies (TI-689) have the last word. If the
 * link then fails, the new article is removed again (its author may delete it), so that no orphan draft is
 * left behind.
 */
export async function createMaterialRequestLineArticle(
  projectId: string,
  requestId: string,
  lineId: string,
  input: CreateMaterialRequestLineArticleData,
): Promise<MaterialRequestLineArticleResult> {
  const access = await requireProjectAccess(projectId, "write");
  const { context } = access;
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);
  const request = await requireRequest(access, requestId);
  const line = await requireLine(access, request.id, lineId);

  const { data: supplyType, error: supplyTypeError } = await context.supabase
    .from("supply_types")
    .select("id, name")
    .eq("id", input.supply_type_id)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (supplyTypeError) throw mapSupabaseError(supplyTypeError, "Impossible de vérifier le type de fourniture.");
  if (!supplyType) throw badRequest(SUPPLY_TYPE_NOT_FOUND);

  const designation = input.designation
    ?? [input.product_type, input.material, input.dimensions].filter((part): part is string => Boolean(part)).join(" ");
  const { data, error } = await context.supabase
    .from("products")
    .insert({
      reference: input.reference ?? null,
      designation,
      product_type: input.product_type,
      material: input.material,
      dimensions: input.dimensions ?? null,
      unit: input.unit,
      supply_type_id: supplyType.id,
      unit_price_cents: 0,
      is_active: true,
      catalogue_status: "draft",
      created_from_material_request: true,
    })
    .select(ARTICLE_COLUMNS)
    .single();
  if (error) {
    if (error.code === "23505") throw conflict(PRODUCT_REFERENCE_TAKEN);
    if (error.code === "42501") throw forbidden(PRODUCT_WRITE_REFUSAL);
    throw catalogueStatusError(error) ?? mapSupabaseError(error, "Impossible de créer l'article.");
  }
  const article = data as ArticleRow;

  try {
    return await linkLine(access, line, article, supplyType.name, "created");
  } catch (linkError) {
    const { error: undoError } = await context.supabase
      .from("products")
      .delete()
      .eq("id", article.id)
      .eq("tenant_id", context.tenantId);
    if (undoError) console.error("An article created from a request line could not be removed after a failed link", { productId: article.id, error: undoError });
    throw linkError;
  }
}

async function requireTenantProduct(context: MaterialRequestContext, productId: string) {
  const { data, error } = await context.supabase
    .from("products")
    .select("id")
    .eq("id", productId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger l'article.");
  if (!data) throw notFound("Article introuvable.");
}

/** The usual names of an article, for every member of the tenant (catalogue screen). */
export async function listProductAliases(productId: string): Promise<{ items: Array<{ id: string; alias: string; created_at: string }> }> {
  const context = await getAuthenticatedTenantContext();
  await requireTenantProduct(context, productId);
  const { data, error } = await readAllRows(() => context.supabase
    .from("product_aliases")
    .select("id, alias, created_at", { count: "exact" })
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId));
  if (error) throw mapSupabaseError(error, "Impossible de charger les noms usuels.");
  const items = [...(data ?? [])].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id));
  return { items: items.map((row) => ({ id: row.id, alias: row.alias, created_at: row.created_at })) };
}

/** An admin withdraws any usual name; another member, those they taught (policy of product_aliases). */
export async function deleteProductAlias(productId: string, aliasId: string): Promise<{ deleted: true }> {
  const context = await getAuthenticatedTenantContext();
  await requireTenantProduct(context, productId);
  const { data: alias, error } = await context.supabase
    .from("product_aliases")
    .select("id, created_by")
    .eq("id", aliasId)
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error, "Impossible de charger le nom usuel.");
  if (!alias) throw notFound("Nom usuel introuvable.");
  if (context.tenantRole !== "admin" && alias.created_by !== context.userId) throw forbidden(ALIAS_DELETE_REFUSAL);

  const { data: deleted, error: deleteError } = await context.supabase
    .from("product_aliases")
    .delete()
    .eq("id", alias.id)
    .eq("tenant_id", context.tenantId)
    .eq("product_id", productId)
    .select("id")
    .maybeSingle();
  if (deleteError) throw mapSupabaseError(deleteError, "Impossible de retirer le nom usuel.");
  if (!deleted) throw forbidden(ALIAS_DELETE_REFUSAL);
  return { deleted: true };
}
