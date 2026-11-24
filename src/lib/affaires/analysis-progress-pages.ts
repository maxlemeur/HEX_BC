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
type Query<Row> = PromiseLike<{ data: Row[] | null; error: SupabaseErrorLike | null }> & {
  or(filter: string): Query<Row>;
  lte(column: string, value: string): Query<Row>;
  order(column: string, options: { ascending: boolean }): Query<Row>;
  limit(limit: number): Query<Row>;
};

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

  async function read<Row extends { id: string } & Partial<Record<DateColumn, string | null>>>(
    lane: Lane, query: () => Query<Row>, date: DateColumn = "created_at",
  ) {
    const position = positions[lane];
    if (position === null) return [];
    const request = query();
    if (position) {
      // Make the upper date an index range even when the tie-breaker is a disjunction.
      request.lte(date, position.time).or(`${date}.lt.${position.time},id.lt.${position.id}`);
    }
    request.order(date, { ascending: false }).order("id", { ascending: false });
    const { data, error } = await request.limit(PAGE_SIZE + 1);
    if (error) throw mapSupabaseError(error, "Impossible de lire le suivi des analyses.");
    const rows = (data ?? []).slice(0, PAGE_SIZE);
    const last = rows.at(-1);
    const time = last?.[date];
    if (last && time && data?.[PAGE_SIZE]) next[lane] = { time, id: last.id };
    return rows;
  }

  return {
    read,
    nextCursor: () => Object.values(next).some(Boolean) ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
  };
}
