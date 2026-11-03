import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { TAKEOFF_FILES_BUCKET } from "@/lib/storage/buckets";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  getAuthenticatedTakeoffContext,
  getTakeoffJobDetailByIdOrThrow,
  type AuthenticatedTakeoffContext,
  type TakeoffJobDetailRow,
} from "@/lib/takeoff/job-read-server";
import { TAKEOFF_VECTOR_READ_LIMITS, takeoffVectorReadingResponseSchema, type TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

// Reads a job's vector reading for the review viewer (TI-662) with the user's
// session: the job must be readable (404 otherwise, as the job detail), and the
// RLS of takeoff_vector_pages and takeoff_item_geometries applies the same
// estimate access. Rows that fail their versioned schema fail the read.
// Geometries are read in pages of GEOMETRY_PAGE_ROWS (under the API's
// max_rows of 1000) with an exact count: never a silent cut. Over the limits
// of read-contracts.ts the read is refused (413). Pages read from the job's own
// upload (no plan file) come with that PDF's signed URL, for the viewer.

type PageRow = { id: string; plan_file_id: string | null; source_file_name: string | null; source_page: number; reading: unknown };
type GeometryRow = { takeoff_item_id: string; vector_page_id: string; geometry: unknown };

const GEOMETRY_PAGE_ROWS = 500;
/** Life of a direct upload's signed URL, as a plan file's (plans.ts): the viewer opens the PDF as soon as it reads the pages. */
const SOURCE_URL_TTL_SECONDS = 60 * 10;

function tooLarge(jobId: string): never {
  throw new TakeoffError({ status: 413, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "La lecture vectorielle de ce métré dépasse la taille affichée.",
    retryable: false, jobId });
}

function readError(jobId: string, message: string, error: unknown): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

/**
 * Signed URL of the PDF the job was created with, when pages were read from it
 * (plan_file_id null). Signed with the user's session: the Storage policy of
 * takeoff-files checks the current tenant, that the object is this job's
 * source_file_path and the estimate access. The path is the job row's, never
 * the client's. Null for a plan-set job (its source_file_path is a plan file's)
 * or when Storage refuses or misses the object: the viewer then says so.
 */
async function jobUploadUrl(context: AuthenticatedTakeoffContext, job: TakeoffJobDetailRow, pages: readonly PageRow[]) {
  if (job.plan_set_id || !job.source_file_path || !pages.some((page) => page.plan_file_id === null)) return null;
  const { data, error } = await context.supabase.storage.from(TAKEOFF_FILES_BUCKET).createSignedUrl(job.source_file_path, SOURCE_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    console.error("takeoff.vector.source_url_failed", { job_id: job.id, tenant_id: context.tenantId, message: (error?.message ?? "URL absente").slice(0, 200) });
    return null;
  }
  return data.signedUrl;
}

export async function getTakeoffVectorReading(jobId: string): Promise<TakeoffVectorReadingResponse> {
  const context = await getAuthenticatedTakeoffContext();
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase: context.supabase, tenantId: context.tenantId, jobId });
  const { data: pages, error: pagesError } = await context.supabase.from("takeoff_vector_pages" as never)
    .select("id,plan_file_id,source_file_name,source_page,reading" as never)
    .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, jobId as never)
    .order("source_file_name" as never).order("source_page" as never).range(0, TAKEOFF_VECTOR_READ_LIMITS.pages);
  if (pagesError) readError(jobId, "Impossible de charger la lecture vectorielle du métré.", pagesError);
  const pageRows = (pages ?? []) as unknown as PageRow[];
  if (pageRows.length > TAKEOFF_VECTOR_READ_LIMITS.pages) tooLarge(jobId);
  const geometryRows: GeometryRow[] = [];
  let segments = 0;
  for (let start = 0; ; start += GEOMETRY_PAGE_ROWS) {
    const { data, error, count } = await context.supabase.from("takeoff_item_geometries" as never)
      .select("takeoff_item_id,vector_page_id,geometry" as never, { count: "exact" })
      .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, jobId as never)
      .order("takeoff_item_id" as never).range(start, start + GEOMETRY_PAGE_ROWS - 1);
    if (error) readError(jobId, "Impossible de charger la géométrie du métré.", error);
    if (count === null || count === undefined) readError(jobId, "Impossible de compter la géométrie du métré.", null);
    if (count > TAKEOFF_VECTOR_READ_LIMITS.geometries) tooLarge(jobId);
    const batch = (data ?? []) as unknown as GeometryRow[];
    for (const row of batch) {
      // A room polygon counts one edge per x, y pair against the same budget as the centrelines.
      const geometry = row.geometry as { segments_m?: unknown[]; polygon_m?: unknown[] | null } | null;
      segments += (Array.isArray(geometry?.segments_m) ? geometry.segments_m.length : 0) + (Array.isArray(geometry?.polygon_m) ? geometry.polygon_m.length / 2 : 0);
    }
    if (segments > TAKEOFF_VECTOR_READ_LIMITS.segments) tooLarge(jobId);
    geometryRows.push(...batch);
    if (geometryRows.length >= count) break;
    // A short page before the count: rows changed during the read.
    if (batch.length < GEOMETRY_PAGE_ROWS) readError(jobId, "Lecture incomplète de la géométrie du métré.", null);
  }
  const parsed = takeoffVectorReadingResponseSchema.safeParse({
    job_id: jobId,
    source_download_url: await jobUploadUrl(context, job, pageRows),
    pages: pageRows.map((page) => ({
      id: page.id, plan_file_id: page.plan_file_id, source_file_name: page.source_file_name, source_page: page.source_page, reading: page.reading,
      items: geometryRows.filter((row) => row.vector_page_id === page.id).map((row) => ({ takeoff_item_id: row.takeoff_item_id, geometry: row.geometry })),
    })),
  });
  if (!parsed.success) {
    throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, message: "Lecture vectorielle invalide en base.", retryable: false, jobId });
  }
  return parsed.data;
}
