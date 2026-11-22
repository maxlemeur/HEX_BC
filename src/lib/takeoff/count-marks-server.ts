import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { badRequest, conflict, forbidden, notFound } from "@/lib/http/api-error";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import {
  parseTakeoffCountMarkEditResult,
  parseTakeoffCountMarksPage,
  parseTakeoffCountMarkSummary,
  TAKEOFF_COUNT_MARK_EDIT_REFUSALS,
  takeoffCountMarkEditRefusal,
  type TakeoffCountMarkEditRefusal,
  type TakeoffCountMarkEditResult,
  type TakeoffCountMarkGesture,
  type TakeoffCountMarksPage,
  type TakeoffCountMarkState,
  type TakeoffCountMarkSummary,
} from "./count-marks";

/**
 * The readers and the edit of the counted marks of an affaire's items (lot 5), with the member's session: the database
 * checks the affaire's read rule, or its operator rule and the expected revisions under its locks, and answers the
 * server-side count. The worker's publication (public.publish_takeoff_count_marks) is the producer's, not a member's.
 */

type Client = SupabaseClient<Database>;
type EditArgs = Database["public"]["Functions"]["edit_takeoff_count_marks"]["Args"];

const READ_FAILURE = "Impossible de lire les repères du poste.";
const EDIT_FAILURE = "Impossible d'enregistrer les repères du poste.";

/** The marks of one answer on one page of its scope, paged, with the server's total apart from the number loaded. */
export async function readAnswerCountMarks(projectId: string, query: {
  answerId: string;
  page: number;
  /** proposed, to attribute and retained by default; removed and pending on demand. */
  states?: readonly TakeoffCountMarkState[];
  afterMarkId?: string | null;
  limit?: number;
}): Promise<TakeoffCountMarksPage | null> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data, error } = await (context.supabase as unknown as Client).rpc("read_takeoff_count_marks", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_id: query.answerId, p_page: query.page,
    ...(query.states ? { p_states: [...query.states] } : {}),
    ...(query.afterMarkId ? { p_after_mark_id: query.afterMarkId } : {}),
    p_limit: Math.min(Math.max(query.limit ?? 500, 1), 1000),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return data === null ? null : parseTakeoffCountMarksPage(data);
}

/** The server-side count of each answer given (at most 500), by answer. */
export async function readAnswerCountMarkSummaries(projectId: string, answerIds: readonly string[]):
  Promise<Record<string, TakeoffCountMarkSummary>> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data, error } = await (context.supabase as unknown as Client).rpc("read_takeoff_count_mark_summaries", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_ids: answerIds.slice(0, 500),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return Object.fromEntries((data ?? []).map((row) => [row.answer_id, parseTakeoffCountMarkSummary(row.summary)]));
}

/** The journal of an answer's marks, in order, after the position given. */
export async function readAnswerCountMarkEvents(projectId: string, query: {
  answerId: string; after?: { revision: number; ordinal: number } | null; limit?: number;
}) {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const { data, error } = await (context.supabase as unknown as Client).rpc("read_takeoff_count_mark_events", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_answer_id: query.answerId,
    p_after_revision: query.after?.revision ?? 0, p_after_ordinal: query.after?.ordinal ?? 0,
    p_limit: Math.min(Math.max(query.limit ?? 200, 1), 500),
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  return data ?? [];
}

function refusalError(code: TakeoffCountMarkEditRefusal) {
  const message = TAKEOFF_COUNT_MARK_EDIT_REFUSALS[code];
  switch (code) {
    case "TAKEOFF_MARKS_FORBIDDEN":
      return forbidden(message, undefined, code);
    case "TAKEOFF_MARKS_ANSWER_NOT_FOUND":
    case "TAKEOFF_MARKS_MARK_NOT_FOUND":
      return notFound(message, undefined, code);
    case "TAKEOFF_MARKS_REVISION_CONFLICT":
    case "TAKEOFF_MARKS_INTENT_CONFLICT":
    case "TAKEOFF_MARKS_ANSWER_REPLACED":
    case "TAKEOFF_MARKS_ATTRIBUTION_TAKEN":
    case "TAKEOFF_MARKS_OBJECT_DUPLICATE":
    case "TAKEOFF_MARKS_PAGE_GEOMETRY_CONFLICT":
      return conflict(message, undefined, code);
    default:
      return badRequest(message, undefined, code);
  }
}

/**
 * An operator's edit of N gestures at once, under the expected marks revision of every answer it changes; the same
 * intention key with the same content answers the same, replayed. A refusal of the command is answered in French with
 * its own code; nothing is written.
 */
export async function editAnswerCountMarks(projectId: string, command: {
  intentKey: string;
  /** Every answer the edit changes, with the marks revision it was shown. */
  revisions: Record<string, number>;
  gestures: readonly TakeoffCountMarkGesture[];
}): Promise<TakeoffCountMarkEditResult> {
  const { context, project } = await requireAffaireAccess(projectId, "write");
  const { data, error } = await (context.supabase as unknown as Client).rpc("edit_takeoff_count_marks", {
    p_tenant_id: context.tenantId, p_project_id: project.id, p_intent_key: command.intentKey,
    p_revisions: command.revisions, p_gestures: command.gestures as unknown as EditArgs["p_gestures"],
  });
  if (error) {
    const refusal = takeoffCountMarkEditRefusal(error.message);
    throw refusal ? refusalError(refusal) : mapSupabaseError(error, EDIT_FAILURE);
  }
  return parseTakeoffCountMarkEditResult(data);
}
