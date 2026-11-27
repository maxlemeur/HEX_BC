import "server-only";

import { z } from "zod";

import { badRequest, mapSupabaseError, type SupabaseErrorLike } from "@/lib/http/api-response";

const PAGE_SIZE = 16;
const laneSchema = z.enum([
  "documentLive", "documentEnd", "requestLive", "requestEnd", "jobLive", "jobRetry",
  "jobAnalysisEnd", "jobCompletedEnd", "jobLegacyEnd",
]);
const pageTime = z.iso.datetime({ offset: true });
const positionSchema = z.object({ time: pageTime, id: z.guid() });
const pagingSchema = z.partialRecord(laneSchema, positionSchema.nullable());
type Lane = z.infer<typeof laneSchema>;
type Cursor = z.infer<typeof pagingSchema>;
type DateColumn = "created_at" | "updated_at" | "analysis_finished_at" | "completed_at";
type Embed = { referencedTable?: string };
/** A PostgREST request a page bounds, at its top level or on one of its embedded resources. */
type PageRequest = {
  or(filter: string, options?: Embed): unknown;
  lte(column: string, value: string): unknown;
  order(column: string, options: { ascending: boolean } & Embed): unknown;
  limit(limit: number, options?: Embed): unknown;
};
type Query<Row> = PromiseLike<{ data: Row[] | null; error: SupabaseErrorLike | null }> & PageRequest;
type PageRow = { id: string } & Partial<Record<DateColumn, string | null>>;

function decodeCursor(cursor: string | undefined): Cursor {
  if (!cursor) return {};
  try {
    return pagingSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
  } catch {
    throw badRequest("La page suivante du suivi n’est plus disponible.");
  }
}

export function analysisProgressPages(cursor: string | undefined) {
  const positions = decodeCursor(cursor);
  // A depleted stream stays depleted until a new discovery poll.
  const next: Cursor = {
    documentLive: null, documentEnd: null, requestLive: null, requestEnd: null,
    jobLive: null, jobRetry: null, jobAnalysisEnd: null, jobCompletedEnd: null, jobLegacyEnd: null,
  };

  /**
   * The page of one lane, or null when the lane is depleted. `bound` applies its keyset, its order and its
   * look-ahead limit to a request, or to the embedded resource `embed` of a request that reads several lanes
   * at once; `settle` keeps the page of the rows read and records where the lane resumes.
   */
  function page<Row extends PageRow>(lane: Lane, date: DateColumn = "created_at") {
    const position = positions[lane];
    if (position === null) return null;
    return {
      bound<Request extends PageRequest>(request: Request, embed?: string): Request {
        const options = embed ? { referencedTable: embed } : {};
        if (position) {
          // Make the upper date an index range even when the tie-breaker is a disjunction.
          request.lte(embed ? `${embed}.${date}` : date, position.time);
          request.or(`${date}.lt.${position.time},id.lt.${position.id}`, options);
        }
        request.order(date, { ascending: false, ...options });
        request.order("id", { ascending: false, ...options });
        request.limit(PAGE_SIZE + 1, options);
        return request;
      },
      settle(data: Row[] | null) {
        const rows = (data ?? []).slice(0, PAGE_SIZE);
        const last = rows.at(-1);
        const time = last?.[date];
        if (last && time && data?.[PAGE_SIZE]) next[lane] = { time, id: last.id };
        return rows;
      },
    };
  }

  async function read<Row extends PageRow>(lane: Lane, query: () => Query<Row>, date: DateColumn = "created_at") {
    const bounded = page<Row>(lane, date);
    if (!bounded) return [];
    const { data, error } = await bounded.bound(query());
    if (error) throw mapSupabaseError(error, "Impossible de lire le suivi des analyses.");
    return bounded.settle(data);
  }

  return {
    page,
    read,
    nextCursor: () => Object.values(next).some(Boolean) ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
  };
}
