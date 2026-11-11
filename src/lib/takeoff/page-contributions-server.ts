import "server-only";

import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import {
  estimateLineTakeoffItemIds,
  findPagesAlreadyInEstimate,
  launchLinesOf,
  takeoffLinePageIdentity,
  type EarlierTakeoffLine,
  type EstimateLineProvenance,
  type NewTakeoffLine,
  type PageDocumentSource,
} from "@/lib/takeoff/page-contributions";
import {
  takeoffLaunchPageContributionsRequestSchema,
  takeoffPageContributionsResponseSchema,
  type TakeoffPageContributionsResponse,
} from "@/lib/takeoff/page-contributions-contracts";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";
import { getEstimateVersionProjectIdOrThrow } from "@/lib/takeoff/version-access-server";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

// TI-682 lot D, PR 1: which pages a takeoff reads that another takeoff already brought into the estimate version under
// review: its own version, or a copy it was carried over into (the review, the wizard and its draft lock work on that
// copy). Read with the user's session only: the active tenant, the version's read and the takeoffs it holds (404 for a
// version the user cannot read or a takeoff that is not part of it) and the RLS of estimate_items, takeoff_items and
// takeoff_jobs bound it; never the service role. Every read is narrow
// (the provenance columns, the source document of a line, the sources of a preparation) and paged: no read per line.

type Supabase = AuthenticatedTakeoffContext["supabase"];
type Context = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId">;

type TakeoffLineRow = { id: string; job_id: string; source_file_name: string | null; source_page: number | null; source_document: unknown };
type EstimateLineRow = Omit<EstimateLineProvenance, "source_metadata"> & { takeoff_item_id: unknown; rounding_item_ids: unknown; rounding_job_id: unknown;
  policy_item_ids: unknown; policy_job_id: unknown; replacement_item_ids: unknown; replacement_job_id: unknown };
type JobRow = { id: string; estimate_version_id: string; created_at: string; source_file_name: string | null; sources: unknown };

const TAKEOFF_LINE_SELECT = "id,job_id,source_file_name,source_page,source_document:metadata->source_document";
// Only the provenance keys estimateLineTakeoffItemIds reads, never the whole source_metadata.
const ESTIMATE_LINE_SELECT = "id,source_provider,source_job_id,source_file_name,source_page,"
  + "takeoff_item_id:source_metadata->>takeoff_item_id,"
  + "rounding_item_ids:source_metadata->takeoff_length_rounding->item_ids,"
  + "rounding_job_id:source_metadata->takeoff_length_rounding->>job_id,"
  + "policy_item_ids:source_metadata->takeoff_quantity_policy->item_ids,"
  + "policy_job_id:source_metadata->takeoff_quantity_policy->>job_id,"
  + "replacement_item_ids:source_metadata->takeoff_page_replacement->item_ids,"
  + "replacement_job_id:source_metadata->takeoff_page_replacement->>job_id";
const JOB_SELECT = "id,estimate_version_id,created_at,source_file_name,sources:preparation_snapshot->preparation->sources";

const sourcesSchema = z.array(z.object({
  document_id: z.string(),
  kind: z.string().nullish(),
  active: z.boolean().nullish(),
  content_hash: z.string().nullish(),
  logical_document_id: z.string().nullish(),
}));

function readFailed(error: unknown, message: string, jobId?: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

async function readTakeoffLinesById(context: Context, ids: readonly string[]) {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_items" as never)
    .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les lignes des métrés déjà au devis.");
  return (data ?? []) as unknown as TakeoffLineRow[];
}

/** The version's lines that came from a takeoff: a line without takeoff (manual, pasted, an unmeasured DPGF line) is never a contribution. */
async function readEstimateProvenance(context: Context, versionId: string): Promise<EstimateLineProvenance[]> {
  const { data, error } = await readAllRows(() => context.supabase.from("estimate_items" as never)
    .select(ESTIMATE_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("version_id" as never, versionId as never)
    // PR 2: a line only; an ouvrage's section carries its source line too, but holds no quantity of the page.
    .eq("item_type" as never, "line" as never)
    .not("source_job_id" as never, "is", null) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire la provenance des lignes du devis.");
  return ((data ?? []) as unknown as EstimateLineRow[]).map(({ takeoff_item_id, rounding_item_ids, rounding_job_id, policy_item_ids, policy_job_id,
    replacement_item_ids, replacement_job_id, ...line }) => ({
    ...line,
    source_metadata: { takeoff_item_id, takeoff_length_rounding: { job_id: rounding_job_id, item_ids: rounding_item_ids },
      takeoff_quantity_policy: { job_id: policy_job_id, item_ids: policy_item_ids },
      takeoff_page_replacement: { job_id: replacement_job_id, item_ids: replacement_item_ids } },
  }));
}

async function readJobs(context: Context, ids: readonly string[]) {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_jobs" as never)
    .select(JOB_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les métrés déjà au devis.");
  return (data ?? []) as unknown as JobRow[];
}

const sourcesOf = (job: JobRow | undefined): PageDocumentSource[] | null => {
  const parsed = sourcesSchema.safeParse(job?.sources);
  return parsed.success ? parsed.data : null;
};

async function readPagesAlreadyInEstimate(context: Context, input: {
  jobId: string | null;
  versionId: string;
  ownLines: readonly TakeoffLineRow[];
  launchLines?: readonly NewTakeoffLine[];
}): Promise<TakeoffPageContributionsResponse> {
  const estimateLines = await readEstimateProvenance(context, input.versionId);
  // The source lines the estimate names, read by id (chunked): this takeoff's own are already read.
  const own = new Set(input.ownLines.map((line) => line.id));
  const referenced = [...new Set(estimateLines.flatMap((line) => estimateLineTakeoffItemIds(line.source_metadata, line.source_job_id)))]
    .filter((id) => !own.has(id));
  const sourceRows = [...input.ownLines, ...await readTakeoffLinesById(context, referenced)];
  const jobs = new Map((await readJobs(context, [...new Set([...(input.jobId ? [input.jobId] : []),
    ...estimateLines.flatMap((line) => line.source_job_id ? [line.source_job_id] : []), ...sourceRows.map((line) => line.job_id)])]))
    .map((job) => [job.id, job]));
  const earlierItems = new Map<string, EarlierTakeoffLine>(sourceRows.map((line) => [line.id, { id: line.id, job_id: line.job_id,
    identity: takeoffLinePageIdentity(line, sourcesOf(jobs.get(line.job_id))) }]));
  const ownSources = input.jobId ? sourcesOf(jobs.get(input.jobId)) : null;
  const newLines = input.launchLines ?? input.ownLines.map((line) => ({ id: line.id, identity: takeoffLinePageIdentity(line, ownSources) }));
  const result = findPagesAlreadyInEstimate({ jobId: input.jobId, newLines, estimateLines, earlierItems });
  const named = new Set(result.pages.flatMap((page) => page.earlier.map((earlier) => earlier.job_id)));
  return parseWithSchema(takeoffPageContributionsResponseSchema, {
    version_id: input.versionId,
    pages: result.pages.map((page) => ({ file_name: page.file_name, page: page.page, item_ids: input.launchLines ? [] : page.item_ids,
      earlier: page.earlier.map((earlier) => ({ job_id: earlier.job_id, line_count: earlier.estimate_item_ids.length,
        takeoff_item_ids: earlier.takeoff_item_ids })),
      own_line_count: page.own_estimate_item_ids.length })),
    jobs: [...named].flatMap((id) => {
      const job = jobs.get(id);
      return job ? [{ id: job.id, estimate_version_id: job.estimate_version_id, created_at: job.created_at, source_file_name: job.source_file_name }] : [];
    }).sort((left, right) => left.created_at.localeCompare(right.created_at)),
    unidentified_item_ids: input.launchLines ? [] : result.unidentified_item_ids,
    other_takeoff_line_count: result.other_takeoff_line_count,
  }, "Lecture des pages déjà au devis invalide.");
}

const versionIdSchema = z.string().uuid("version_id invalide.");
const pageDecisionsSchema = takeoffPageContributionsResponseSchema.shape.decisions.unwrap();

/**
 * 404 unless the user reads the version (tenant, project membership through RLS) and the takeoff is part of it, launched
 * in it or carried over into it: a version id from the client never opens another tenant's or another project's lines.
 */
async function assertTakeoffJobOfVersion(context: Context, jobId: string, versionId: string) {
  await getEstimateVersionProjectIdOrThrow({ supabase: context.supabase as Supabase, tenantId: context.tenantId, versionId });
  const jobs = await listAccessibleTakeoffJobsForVersion({ supabase: context.supabase as never, tenantId: context.tenantId, versionId });
  if (jobs.some((job) => job.id === jobId)) return;
  throw new TakeoffError({ status: 404, code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND, message: "Job takeoff introuvable pour cette version.",
    details: { job_id: jobId, version_id: versionId }, retryable: false, jobId });
}

/**
 * GET /api/takeoff/jobs/[jobId]/page-contributions?version_id=: the pages of this takeoff the reviewed estimate version
 * already holds from another.
 */
export async function getTakeoffJobPageContributions(jobId: string, versionId: unknown): Promise<TakeoffPageContributionsResponse> {
  const context = await getAuthenticatedTakeoffContext();
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const normalizedVersionId = parseWithSchema(versionIdSchema, versionId, "version_id invalide.");
  await assertTakeoffJobOfVersion(context, normalizedJobId, normalizedVersionId);
  const { data, error } = await readAllRows(() => context.supabase.from("takeoff_items" as never)
    .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, normalizedJobId as never) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire les lignes du métré.", normalizedJobId);
  const [read, decisions] = await Promise.all([readPagesAlreadyInEstimate(context, { jobId: normalizedJobId, versionId: normalizedVersionId,
    ownLines: (data ?? []) as unknown as TakeoffLineRow[] }), readPageDecisions(context, normalizedJobId)]);
  return decisions.length ? { ...read, decisions } : read;
}

/** PR 2: the decisions recorded for this takeoff's pages (RLS: the members of its tenant who read its version). */
async function readPageDecisions(context: Context, jobId: string) {
  const { data, error } = await context.supabase.from("takeoff_page_decisions" as never)
    .select("file_name:document->>file_name,source_page,decision,reason_code,note" as never)
    .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, jobId as never)
    .order("source_page" as never, { ascending: true, nullsFirst: false } as never).limit(2000);
  if (error) readFailed(error, "Impossible de lire les choix des pages déjà au devis.", jobId);
  return parseWithSchema(pageDecisionsSchema, data ?? [], "Choix des pages déjà au devis invalides.");
}

/** POST /api/takeoff/page-contributions: before a launch, the pages of the chosen plans the target version already holds. */
export async function getLaunchPageContributions(body: unknown): Promise<TakeoffPageContributionsResponse> {
  const context = await getAuthenticatedTakeoffContext();
  const request = parseWithSchema(takeoffLaunchPageContributionsRequestSchema, body, "Documents du lancement invalides.");
  // 404 for a version the user cannot read, as every takeoff read of a version.
  await getEstimateVersionProjectIdOrThrow({ supabase: context.supabase as Supabase, tenantId: context.tenantId, versionId: request.estimate_version_id });
  return readPagesAlreadyInEstimate(context, { jobId: null, versionId: request.estimate_version_id, ownLines: [],
    launchLines: launchLinesOf(request.documents) });
}
