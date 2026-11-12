import "server-only";

import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { excludeDpgfOutOfScope, plannedExclusions } from "@/lib/takeoff/apply-plan-exclusions";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import {
  takeoffPageReplacementRequestSchema,
  takeoffPageReplacementResponseSchema,
  type TakeoffPageReplacementResponse,
} from "@/lib/takeoff/page-replacement-contracts";
import {
  buildPageReplacementProposal,
  sourceItemIdsOf,
  type EstimateLineRow,
  type JobRow,
  type TakeoffLineRow,
} from "@/lib/takeoff/page-replacement-proposal";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step. For each page of this takeoff the estimate
// already holds from another takeoff, the earlier estimate lines (what their sources give, whether the estimator changed
// the quantity by hand), the new lines and the pairs proposed between them. It reads the version the application writes
// into (the takeoff's own), with the lines the mapping plan leaves out set aside as the application sets them aside. Read
// with the user's session only (RLS of the version, its lines and the takeoffs); never the service role. The database
// checks every decision again under the version's lock: this proposal decides nothing.

type Context = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId">;


const TAKEOFF_LINE_SELECT = "id,job_id,designation,unit,quantity,is_excluded,created_at,source_file_name,source_page,"
  + "source_document:metadata->source_document,rule_inputs:metadata->rule_inputs";
const ESTIMATE_LINE_SELECT = "id,title,unit_code,description,pricing_status,quantity,updated_at,unit_price_ht_cents,parent_id,position,item_type,"
  + "source_provider,source_job_id,source_file_name,source_page,"
  + "takeoff_item_id:source_metadata->>takeoff_item_id,"
  + "rounding_item_ids:source_metadata->takeoff_length_rounding->item_ids,rounding_job_id:source_metadata->takeoff_length_rounding->>job_id,"
  + "policy_item_ids:source_metadata->takeoff_quantity_policy->item_ids,policy_job_id:source_metadata->takeoff_quantity_policy->>job_id,"
  + "replacement_item_ids:source_metadata->takeoff_page_replacement->item_ids,replacement_job_id:source_metadata->takeoff_page_replacement->>job_id,"
  + "mapping_action:source_metadata->>mapping_action";
const JOB_SELECT = "id,created_at,level,source_file_name,sources:preparation_snapshot->preparation->sources";

function readFailed(error: unknown, message: string, jobId?: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

async function readTakeoffLines(context: Context, filter: { jobId?: string; ids?: readonly string[] }) {
  if (filter.ids) {
    if (!filter.ids.length) return [];
    const { data, error } = await readAllRowsInChunks(filter.ids, (chunk) => context.supabase.from("takeoff_items" as never)
      .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
      .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
    if (error) readFailed(error, "Impossible de lire les lignes des métrés déjà au devis.");
    return (data ?? []) as unknown as TakeoffLineRow[];
  }
  const { data, error } = await readAllRows(() => context.supabase.from("takeoff_items" as never)
    .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, filter.jobId as never) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire les lignes du métré.", filter.jobId);
  return (data ?? []) as unknown as TakeoffLineRow[];
}

async function readEstimateLines(context: Context, versionId: string) {
  const { data, error } = await readAllRows(() => context.supabase.from("estimate_items" as never)
    .select(ESTIMATE_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("version_id" as never, versionId as never)
    .eq("item_type" as never, "line" as never) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire les lignes du devis.");
  return (data ?? []) as unknown as EstimateLineRow[];
}

async function readEngine(context: Context, versionId: string) {
  const { data, error } = await context.supabase.from("estimate_versions" as never).select("calc_engine_version" as never)
    .eq("tenant_id" as never, context.tenantId as never).eq("id" as never, versionId as never).single();
  if (error) readFailed(error, "Impossible de lire la version du devis.");
  return requireEstimateEngineVersion(data as object | null);
}

async function readJobs(context: Context, ids: readonly string[]) {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_jobs" as never)
    .select(JOB_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les métrés déjà au devis.");
  return (data ?? []) as unknown as JobRow[];
}

/**
 * POST /api/takeoff/jobs/[jobId]/page-replacement: what applying this takeoff would replace, page by page, with the
 * mapping overrides of the wizard (`{ strategy, target_section_id, overrides }`).
 */
export async function getTakeoffJobPageReplacement(jobId: string, body: unknown): Promise<TakeoffPageReplacementResponse> {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  const context = { supabase, tenantId };
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const request = parseWithSchema(takeoffPageReplacementRequestSchema, body, "Proposition des pages déjà au devis invalide.");
  const applyRequest = parseApplyTakeoffPayload({ strategy: request.strategy, target_section_id: request.target_section_id ?? null,
    ...(request.overrides?.length ? { overrides: request.overrides } : {}) });
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase, tenantId, jobId: normalizedJobId });
  // The application writes into the takeoff's own version (apply_takeoff_job_atomic reads takeoff_jobs.estimate_version_id).
  const versionId = job.estimate_version_id;

  // The lines that reach the estimate, as the application computes them: the plan's skips and assemblies, and on a DPGF
  // version the lines its reconciliation decided out of scope.
  const mergeRequired = await hasTakeoffDpgfTargetLines({ supabase, tenantId, versionId });
  const mappingPreview = await buildTakeoffMappingPreviewForJob({ supabase, tenantId, jobId: normalizedJobId, request: applyRequest });
  const comparisonContext = mergeRequired ? await loadTakeoffDpgfComparisonContext({
    auth: { supabase, tenantId, userId }, jobId: normalizedJobId, versionId }) : null;
  excludeDpgfOutOfScope(mappingPreview, comparisonContext);
  const leftOut = plannedExclusions(mappingPreview);

  const [ownLines, estimateRows] = await Promise.all([readTakeoffLines(context, { jobId: normalizedJobId }), readEstimateLines(context, versionId)]);
  const sourceIds = sourceItemIdsOf(estimateRows);
  const own = new Set(ownLines.map((line) => line.id));
  const referencedLines = await readTakeoffLines(context, { ids: [...new Set([...sourceIds.values()].flat())].filter((id) => !own.has(id)) });
  const jobs = await readJobs(context, [...new Set([normalizedJobId, ...[...ownLines, ...referencedLines].map((line) => line.job_id),
    ...estimateRows.flatMap((line) => (line.source_job_id ? [line.source_job_id] : []))])]);
  // « Fusionner » on a DPGF version: the lines its writer matches by title in the target section are imposed, replayed
  // from the writer of the version's engine on what it is handed (renamed designations, its source order).
  const merge = mergeRequired && applyRequest.strategy === "merge"
    ? { mappingItems: mappingPreview.items, targetSectionId: applyRequest.target_section_id ?? null, engine: await readEngine(context, versionId) }
    : null;
  // The DPGF targets this takeoff's lines feed (its reconciliation), to refuse keeping both where one is fed again (D-6).
  const fedTargets = comparisonContext ? new Map(computeTakeoffDpgfRows(comparisonContext.comparisonInput).rows
    .flatMap((row) => row.linked_takeoff_items.map((item) => [item.item_id, row.dpgf.estimate_item_id] as const))) : new Map<string, string>();
  return parseWithSchema(takeoffPageReplacementResponseSchema, buildPageReplacementProposal({ jobId: normalizedJobId, versionId, mergeRequired,
    ownLines, referencedLines, estimateRows, jobs, leftOut, merge, fedTargets }), "Proposition des pages déjà au devis invalide.");
}
