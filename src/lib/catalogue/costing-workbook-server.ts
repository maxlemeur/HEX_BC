import "server-only";

import { getAuthenticatedTenantContext, type AuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { canAddToCatalogue } from "@/lib/catalogue/access";
import {
  CostingWorkbookFormatError,
  readCostingWorkbookRows,
  workbookReferenceKey,
  type CostingWorkbookArticle,
  type CostingWorkbookReadResult,
} from "@/lib/catalogue/costing-workbook";
import {
  COSTING_WORKBOOK_FORMAT,
  COSTING_WORKBOOK_IMPORT_INCOMPLETE,
  COSTING_WORKBOOK_REPORTED_ISSUES,
  COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN,
  type CostingWorkbookArticlesInput,
  type CostingWorkbookImportIncompleteDetails,
  type CostingWorkbookImportInput,
  type CostingWorkbookImportReport,
} from "@/lib/catalogue/costing-workbook-contract";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import {
  ApiError,
  conflict,
  forbidden,
  mapSupabaseError,
  unprocessableEntity,
  type SupabaseErrorLike,
} from "@/lib/http/api-response";
import { readAllRows } from "@/lib/supabase/read-all";
import type { Database } from "@/types/database";

/**
 * The office's costing workbook becomes catalogue drafts (TI-690, lot 1). Only articles the catalogue does not
 * hold yet are created, as drafts the office then checks and validates one by one in the catalogue:
 *  - an article whose reference the company already holds (any status, active or archived, or under an earlier
 *    import's « DB_<sheet>__ » prefix: workbookReferenceKey) is skipped and never modified, so running the same
 *    workbook again creates nothing;
 *  - its supply type is the one the office chose in the screen for the code the reader proposes, else the
 *    company's own with that code, else none (counted): supply types carry the estimate's FO provision and are
 *    never created here;
 *  - the draft import only counts supplier references. Supplier references have their own confirmed import;
 *    supplier prices are undated and never written by either action.
 * Whoever may add articles to the catalogue imports (TI-689); the drafts are written with their own client, so
 * the catalogue policies have the last word. Every read is scoped to the active company: a member of two
 * companies must not see the other's references or supply types.
 */

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"];
type Report = CostingWorkbookImportReport;

/** Drafts per statement: each insert stays far from the API roles' 8 s statement timeout. */
const WRITE_CHUNK = 500;

const REFERENCE_ADDED_MEANWHILE =
  "Un article de ce classeur vient d’être ajouté au catalogue : relancez l’import, il ignore les articles déjà présents.";

type PlannedDraft = { article: CostingWorkbookArticle; supplyTypeId: string | null };

const IMPORT_NOT_STARTED = "L’import n’a pas pu être ouvert. Réessayez dans un instant.";

type CatalogueArticle = { id: string; unit_price_cents: number; unit: string | null; is_active: boolean };
type SupplyType = { id: string; code: string; name: string };
type Difference = NonNullable<Report["catalogue_differences"]>[number];

type Plan = { read: CostingWorkbookReadResult; drafts: PlannedDraft[]; supplyTypes: SupplyType[]; differences: Difference[] };

type Company = {
  /** By compared reference; the first article read when an earlier import left a prefixed twin. */
  articles: ReadonlyMap<string, CatalogueArticle>;
  supplyTypes: SupplyType[];
};

const UNKNOWN_SUPPLY_TYPE = "Un type de fourniture choisi n’existe plus dans l’entreprise. Actualisez l’aperçu, puis choisissez-le à nouveau.";

export function readCostingWorkbookImportSheet(rows: CostingWorkbookImportInput["rows"]): CostingWorkbookReadResult {
  try {
    return readCostingWorkbookRows(rows);
  } catch (error) {
    if (error instanceof CostingWorkbookFormatError) {
      throw unprocessableEntity(error.message, undefined, COSTING_WORKBOOK_FORMAT);
    }
    throw error;
  }
}

async function readCompany({ supabase, tenantId }: AuthenticatedTenantContext): Promise<Company> {
  const [products, supplyTypes] = await Promise.all([
    readAllRows(() => supabase.from("products").select("id, reference, unit_price_cents, unit, is_active", { count: "exact" })
      .eq("tenant_id", tenantId).not("reference", "is", null), { concurrency: 4 }),
    readAllRows(() => supabase.from("supply_types").select("id, code, name", { count: "exact" }).eq("tenant_id", tenantId)),
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de lire les articles du catalogue.");
  if (supplyTypes.error) throw mapSupabaseError(supplyTypes.error, "Impossible de lire les types de fourniture.");
  const articles = new Map<string, CatalogueArticle>();
  for (const product of products.data ?? []) {
    if (!product.reference) continue;
    const key = workbookReferenceKey(product.reference);
    const known = articles.get(key);
    // An active article speaks for its reference before an archived twin.
    if (!known || (!known.is_active && product.is_active)) {
      articles.set(key, { id: product.id, unit_price_cents: product.unit_price_cents, unit: product.unit, is_active: product.is_active });
    }
  }
  return {
    articles,
    supplyTypes: [...(supplyTypes.data ?? [])].sort((left, right) => left.name.localeCompare(right.name, "fr")),
  };
}

const unitKey = (unit: string | null) => (unit ?? "").trim().toLocaleLowerCase("fr-FR");

function planImport(
  read: CostingWorkbookReadResult,
  company: Company,
  { supply_types: chosen, supply_type_rows: chosenRows = [] }: Pick<CostingWorkbookArticlesInput, "supply_types" | "supply_type_rows">,
): Plan {
  const known = new Set(company.supplyTypes.map((supplyType) => supplyType.id));
  if ([...Object.values(chosen ?? {}), ...chosenRows.map((choice) => choice.supply_type_id)].some((id) => !known.has(id))) {
    throw unprocessableEntity(UNKNOWN_SUPPLY_TYPE, undefined, COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN);
  }
  const ofRow = new Map(chosenRows.map((choice) => [choice.row, choice.supply_type_id]));
  const ownByCode = new Map(company.supplyTypes.map((supplyType) => [supplyType.code, supplyType.id]));
  const drafts: PlannedDraft[] = [];
  const differences: Difference[] = [];
  for (const article of read.articles) {
    const existing = company.articles.get(workbookReferenceKey(article.reference));
    if (!existing) {
      drafts.push({
        article,
        supplyTypeId: ofRow.get(article.row) ?? chosen?.[article.supply_type_code] ?? ownByCode.get(article.supply_type_code) ?? null,
      });
      continue;
    }
    // An empty workbook price says nothing about the catalogue's; a defaulted unit neither.
    const priceDiffers = article.unit_price_cents > 0 && article.unit_price_cents !== existing.unit_price_cents;
    const unitDiffers = !article.unit_defaulted && unitKey(article.unit) !== unitKey(existing.unit);
    if (priceDiffers || unitDiffers) {
      differences.push({
        row: article.row, product_id: existing.id, unit_price_cents: existing.unit_price_cents, unit: existing.unit,
        is_active: existing.is_active,
      });
    }
  }
  return { read, drafts, supplyTypes: company.supplyTypes, differences };
}

function reportOf(plan: Plan, confirmed: boolean, drafts: readonly PlannedDraft[], batchId: string | null = null): Report {
  return {
    confirmed,
    ...(confirmed ? { import_batch_id: drafts.length > 0 ? batchId : null } : {}),
    articles: plan.read.articles.length,
    new_articles: drafts.length,
    ...(!confirmed ? {
      proposed_articles: drafts.map(({ article, supplyTypeId }) => ({
        row: article.row,
        without_supply_type: supplyTypeId === null,
      })),
      supply_types: plan.supplyTypes,
      catalogue_differences: plan.differences,
    } : {}),
    already_in_catalogue: plan.read.articles.length - plan.drafts.length,
    without_supply_type: drafts.filter((draft) => draft.supplyTypeId === null).length,
    supplier_references_not_imported: drafts.reduce((sum, draft) => sum + draft.article.supplier_references.length, 0),
    issues: plan.read.issues.slice(0, COSTING_WORKBOOK_REPORTED_ISSUES),
    issue_count: plan.read.issues.length,
    sections: plan.read.sections,
  };
}

function productRow({ article, supplyTypeId }: PlannedDraft, batchId: string): ProductInsert {
  return {
    import_batch_id: batchId,
    reference: article.reference,
    designation: article.designation,
    category: article.category,
    product_type: article.product_type,
    material: article.material,
    grade: article.grade,
    dimensions: article.dimensions,
    standard: article.standard,
    unit: article.unit,
    unit_price_cents: article.unit_price_cents,
    reliability_score: article.reliability_score,
    supply_type_id: supplyTypeId,
    catalogue_status: "draft",
    is_active: true,
  };
}

/**
 * Not one transaction (Supabase REST): drafts are written in chunks of WRITE_CHUNK, one statement each. A refused
 * chunk writes nothing and stops the import; the chunks before it stand, and the error says how many drafts they
 * created. Running the same workbook again completes the rest, since it skips what exists.
 *
 * Every draft carries the import it comes from (TI-711): the office validates the drafts of an import together,
 * or undoes the import while its drafts are untouched.
 */
async function writeDrafts({ supabase }: AuthenticatedTenantContext, plan: Plan, sourceName: string | undefined): Promise<Report> {
  const created: PlannedDraft[] = [];
  if (plan.drafts.length === 0) return reportOf(plan, true, created);

  const batch = await supabase.rpc("start_workbook_article_import", { p_source_name: sourceName ?? null });
  if (batch.error?.code === "42501") throw forbidden(PRODUCT_WRITE_REFUSAL);
  if (batch.error || !batch.data) throw mapSupabaseError(batch.error ?? { code: "XX000", message: IMPORT_NOT_STARTED }, IMPORT_NOT_STARTED);
  const batchId = batch.data;

  const stopped = (error: SupabaseErrorLike) => {
    const mapped = error.code === "42501"
      ? forbidden(PRODUCT_WRITE_REFUSAL)
      // A reference of the chunk was added between the read and the write: the whole statement failed.
      : error.code === "23505" ? conflict(REFERENCE_ADDED_MEANWHILE) : mapSupabaseError(error, "Impossible de créer les articles du classeur.");
    if (created.length === 0) return mapped;
    const count = (value: number) => value.toLocaleString("fr-FR");
    const details: CostingWorkbookImportIncompleteDetails = { report: reportOf(plan, true, created, batchId) };
    return new ApiError({
      status: mapped.status,
      code: COSTING_WORKBOOK_IMPORT_INCOMPLETE,
      message: `L’import s’est arrêté : ${count(created.length)} brouillons créés sur ${count(plan.drafts.length)}. `
        + "Relancez l’import du même classeur : il ne crée que les articles qui manquent encore au catalogue.",
      details,
    });
  };

  for (let start = 0; start < plan.drafts.length; start += WRITE_CHUNK) {
    const chunk = plan.drafts.slice(start, start + WRITE_CHUNK);
    const { error } = await supabase.from("products").insert(chunk.map((draft) => productRow(draft, batchId)));
    if (error) throw stopped(error);
    created.push(...chunk);
  }
  return reportOf(plan, true, created, batchId);
}

export async function importCostingWorkbook(input: CostingWorkbookArticlesInput): Promise<Report> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);

  // The sheet first: a sheet of another shape is refused without reading the catalogue.
  const read = readCostingWorkbookImportSheet(input.rows);
  const plan = planImport(read, await readCompany(context), input);
  if (!input.confirm) return reportOf(plan, false, plan.drafts);
  return writeDrafts(context, plan, input.source_name);
}
