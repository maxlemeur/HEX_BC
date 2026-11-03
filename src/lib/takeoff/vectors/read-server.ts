import "server-only";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { TAKEOFF_VECTOR_READ_LIMITS, takeoffVectorReadingResponseSchema, type TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

// Reads a job's vector reading for the review viewer (TI-662) with the user's
// session: the job must be readable (404 otherwise, as the job detail), and the
// RLS of takeoff_vector_pages and takeoff_item_geometries applies the same
// estimate access. Rows that fail their versioned schema fail the read.
// Geometries are read in pages of GEOMETRY_PAGE_ROWS (under the API's
// max_rows of 1000) with an exact count: never a silent cut. Over the limits
// of read-contracts.ts the read is refused (413).

type PageRow = { id: string; plan_file_id: string | null; source_file_name: string | null; source_page: number; reading: unknown };
type GeometryRow = { takeoff_item_id: string; vector_page_id: string; geometry: unknown };

const GEOMETRY_PAGE_ROWS = 500;

function tooLarge(jobId: string): never {
  throw new TakeoffError({ status: 413, code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE, message: "La lecture vectorielle de ce métré dépasse la taille affichée.",
    retryable: false, jobId });
}

function readError(jobId: string, message: string, error: unknown): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

export async function getTakeoffVectorReading(jobId: string): Promise<TakeoffVectorReadingResponse> {
  const context = await getAuthenticatedTakeoffContext();
  await getTakeoffJobDetailByIdOrThrow({ supabase: context.supabase, tenantId: context.tenantId, jobId });
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
      const rowSegments = (row.geometry as { segments_m?: unknown[] } | null)?.segments_m;
      segments += Array.isArray(rowSegments) ? rowSegments.length : 0;
    }
    if (segments > TAKEOFF_VECTOR_READ_LIMITS.segments) tooLarge(jobId);
    geometryRows.push(...batch);
    if (geometryRows.length >= count) break;
    // A short page before the count: rows changed during the read.
    if (batch.length < GEOMETRY_PAGE_ROWS) readError(jobId, "Lecture incomplète de la géométrie du métré.", null);
  }
  const parsed = takeoffVectorReadingResponseSchema.safeParse({
    job_id: jobId,
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
