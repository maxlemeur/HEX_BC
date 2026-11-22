import type { z } from "zod";

import { TakeoffApiError, TAKEOFF_READ_REQUEST_TIMEOUT_MS, TAKEOFF_WRITE_REQUEST_TIMEOUT_MS } from "@/lib/takeoff/client-http";
import type { TakeoffCountMarkState } from "@/lib/takeoff/count-marks";
import {
  countMarkTargetsSchema,
  countMarksEditResultSchema,
  countMarksHistorySchema,
  countMarksViewSchema,
  type CountMarksEditRequest,
} from "@/lib/takeoff/count-marks-contracts";
import { isRecord } from "@/lib/value-guards";

/**
 * The screen's calls to the counted marks of an affaire (lot 5), each answer checked against its contract. A refusal
 * keeps its code and status: the screen words it from the code (count-marks.ts, count-marks-contracts.ts), never from a
 * database's text. One reader per member and affaire, as the detail of an item has.
 */

const READ_FAILURE = "Impossible de lire les repères du poste.";
const WRITE_FAILURE = "Impossible d’enregistrer les repères du poste.";

async function call<T>(path: string, init: RequestInit, schema: z.ZodType<T>, failure: string, timeoutMs: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(timeoutMs), ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  } catch {
    // A network failure carries the browser's own (English) message: never shown as is.
    throw new TakeoffApiError(failure, 0, null, null);
  }
  const body = await response.json().catch(() => null) as unknown;
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  if (!response.ok || !isRecord(body) || body.ok !== true) {
    const message = typeof error?.message === "string" && error.message.trim() ? error.message : failure;
    throw new TakeoffApiError(message, response.status, error?.details ?? null, typeof error?.code === "string" ? error.code : null);
  }
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) throw new TakeoffApiError(failure, response.status, null, null);
  return parsed.data;
}

export type CountMarksReader = ReturnType<typeof createCountMarksReader>;

export function createCountMarksReader(projectId: string) {
  const base = `/api/affaires/${encodeURIComponent(projectId)}/takeoff/count-marks`;
  return {
    /** A lot of the marks of an answer on a page, with its count and what the member may do. */
    readPage(input: { answerId: string; page: number; after?: string | null; states?: readonly TakeoffCountMarkState[]; limit?: number }) {
      const query = new URLSearchParams({ reponse: input.answerId, page: String(input.page) });
      if (input.after) query.set("apres", input.after);
      if (input.states?.length) query.set("etats", input.states.join(","));
      if (input.limit) query.set("limite", String(input.limit));
      return call(`${base}?${query}`, { method: "GET" }, countMarksViewSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
    },
    /** The command of a correction session; the same intention key with the same content is a replay. */
    edit(command: CountMarksEditRequest) {
      return call(base, { method: "POST", body: JSON.stringify(command) }, countMarksEditResultSchema, WRITE_FAILURE,
        TAKEOFF_WRITE_REQUEST_TIMEOUT_MS);
    },
    /** The items a mark of an answer may be given to: the other items of the same reading, whatever the table shows. */
    readTargets(input: { answerId: string }) {
      const query = new URLSearchParams({ reponse: input.answerId });
      return call(`${base}/targets?${query}`, { method: "GET" }, countMarkTargetsSchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
    },
    /** A page of the journal of an answer's marks, after the position given. */
    readHistory(input: { answerId: string; after: { revision: number; ordinal: number } | null; limit?: number }) {
      const query = new URLSearchParams({ reponse: input.answerId });
      if (input.after) {
        query.set("apresRevision", String(input.after.revision));
        query.set("apresOrdre", String(input.after.ordinal));
      }
      if (input.limit) query.set("limite", String(input.limit));
      return call(`${base}/history?${query}`, { method: "GET" }, countMarksHistorySchema, READ_FAILURE, TAKEOFF_READ_REQUEST_TIMEOUT_MS);
    },
  };
}
