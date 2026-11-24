import "server-only";

import { z } from "zod";

import { badRequest, mapSupabaseError, type SupabaseErrorLike } from "@/lib/http/api-response";

const PAGE_SIZE = 16;
const laneSchema = z.enum(["documentLive", "documentEnd", "requestLive", "requestEnd", "jobLive", "jobRetry", "jobEnd"]);
const pageTime = z.iso.datetime({ offset: true });
const positionSchema = z.object({ time: pageTime, id: z.guid() });
const pagingSchema = z.partialRecord(laneSchema, positionSchema.nullable());
type Lane = z.infer<typeof laneSchema>;
type Cursor = z.infer<typeof pagingSchema>;
type Query<Row> = PromiseLike<{ data: Row[] | null; error: SupabaseErrorLike | null }> & {
  or(filter: string): Query<Row>;
  lt(column: string, value: string): Query<Row>;
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
    jobLive: null, jobRetry: null, jobEnd: null,
  };

  async function read<Row extends { id: string; created_at: string }>(lane: Lane, query: () => Query<Row>) {
    const position = positions[lane];
    if (position === null) return [];
    const request = query();
    if (lane === "jobEnd") {
      if (position) request.lt("id", position.id);
    } else {
      if (position) {
        request.or(`created_at.lt.${position.time},and(created_at.eq.${position.time},id.lt.${position.id})`);
      }
      request.order("created_at", { ascending: false });
    }
    request.order("id", { ascending: false });
    const { data, error } = await request.limit(PAGE_SIZE + 1);
    if (error) throw mapSupabaseError(error, "Impossible de lire le suivi des analyses.");
    const rows = (data ?? []).slice(0, PAGE_SIZE);
    const last = rows.at(-1);
    if (last && data?.[PAGE_SIZE]) next[lane] = { time: last.created_at, id: last.id };
    return rows;
  }

  return {
    read,
    nextCursor: () => Object.values(next).some(Boolean) ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
  };
}
