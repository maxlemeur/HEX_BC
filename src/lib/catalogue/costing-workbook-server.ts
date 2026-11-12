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
} from "@/lib/estimates/errors";
import { readAllRows } from "@/lib/supabase/read-all";
import type { Database } from "@/types/database";

/**
 * The office's costing workbook becomes catalogue drafts (TI-690, lot 1). Only articles the catalogue does not
 * hold yet are created, as drafts the office then checks and validates one by one in the catalogue:
 *  - an article whose reference the company already holds (any status, active or archived, or under an earlier
 *    import's « DB_<sheet>__ » prefix: workbookReferenceKey) is skipped and never modified, so running the same
 *    workbook again creates nothing;
 *  - its supply type is the company's own with the code the reader proposes, or none (counted): supply types
 *    carry the estimate's FO provision and are never created here;
 *  - its supplier references are counted, not imported: they come with purchasing (lot 2), together with dated
 *    prices (the workbook's supplier prices are undated).
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

type Plan = { read: CostingWorkbookReadResult; drafts: PlannedDraft[] };

type Company = {
  references: ReadonlySet<string>;
  supplyTypeIdOf: ReadonlyMap<string, string>;
};

function readSheet(rows: CostingWorkbookImportInput["rows"]): CostingWorkbookReadResult {
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
    readAllRows(() => supabase.from("products").select("id, reference", { count: "exact" })
      .eq("tenant_id", tenantId).not("reference", "is", null), { concurrency: 4 }),
    readAllRows(() => supabase.from("supply_types").select("id, code", { count: "exact" }).eq("tenant_id", tenantId)),
  ]);
  if (products.error) throw mapSupabaseError(products.error, "Impossible de lire les articles du catalogue.");
  if (supplyTypes.error) throw mapSupabaseError(supplyTypes.error, "Impossible de lire les types de fourniture.");
  return {
    references: new Set((products.data ?? []).flatMap((product) => product.reference ? [workbookReferenceKey(product.reference)] : [])),
    supplyTypeIdOf: new Map((supplyTypes.data ?? []).map((supplyType) => [supplyType.code, supplyType.id])),
  };
}

function planImport(read: CostingWorkbookReadResult, company: Company): Plan {
  const drafts = read.articles
    .filter((article) => !company.references.has(workbookReferenceKey(article.reference)))
    .map((article) => ({ article, supplyTypeId: company.supplyTypeIdOf.get(article.supply_type_code) ?? null }));
  return { read, drafts };
}

function reportOf(plan: Plan, confirmed: boolean, drafts: readonly PlannedDraft[]): Report {
  return {
    confirmed,
    articles: plan.read.articles.length,
    new_articles: drafts.length,
    already_in_catalogue: plan.read.articles.length - plan.drafts.length,
    without_supply_type: drafts.filter((draft) => draft.supplyTypeId === null).length,
    supplier_references_not_imported: drafts.reduce((sum, draft) => sum + draft.article.supplier_references.length, 0),
    issues: plan.read.issues.slice(0, COSTING_WORKBOOK_REPORTED_ISSUES),
    issue_count: plan.read.issues.length,
    sections: plan.read.sections,
  };
}

function productRow({ article, supplyTypeId }: PlannedDraft): ProductInsert {
  return {
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
 */
async function writeDrafts({ supabase }: AuthenticatedTenantContext, plan: Plan): Promise<Report> {
  const created: PlannedDraft[] = [];

  const stopped = (error: SupabaseErrorLike) => {
    const mapped = error.code === "42501"
      ? forbidden(PRODUCT_WRITE_REFUSAL)
      // A reference of the chunk was added between the read and the write: the whole statement failed.
      : error.code === "23505" ? conflict(REFERENCE_ADDED_MEANWHILE) : mapSupabaseError(error, "Impossible de créer les articles du classeur.");
    if (created.length === 0) return mapped;
    const count = (value: number) => value.toLocaleString("fr-FR");
    const details: CostingWorkbookImportIncompleteDetails = { report: reportOf(plan, true, created) };
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
    const { error } = await supabase.from("products").insert(chunk.map(productRow));
    if (error) throw stopped(error);
    created.push(...chunk);
  }
  return reportOf(plan, true, created);
}

export async function importCostingWorkbook(input: CostingWorkbookImportInput): Promise<Report> {
  const context = await getAuthenticatedTenantContext();
  if (!canAddToCatalogue(context.tenantRole)) throw forbidden(PRODUCT_WRITE_REFUSAL);

  // The sheet first: a sheet of another shape is refused without reading the catalogue.
  const read = readSheet(input.rows);
  const plan = planImport(read, await readCompany(context));
  if (!input.confirm) return reportOf(plan, false, plan.drafts);
  return writeDrafts(context, plan);
}
