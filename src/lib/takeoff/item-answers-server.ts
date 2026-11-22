import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { mapSupabaseError } from "@/lib/http/api-response";
import type { Database } from "@/types/database";
import {
  parseTakeoffItemAnswer,
  parseTakeoffItemPlanReading,
  TAKEOFF_ITEM_READING_STATES,
  type TakeoffItemAnswer,
  type TakeoffItemReadingLine,
  type TakeoffItemReadingState,
} from "./item-answers";

/**
 * The readers of the stored answers of an affaire's items (lot 4), with the member's session: the database checks the
 * affaire's read rule once per statement and pages in SQL.
 */

type Client = SupabaseClient<Database>;

const READ_FAILURE = "Impossible de lire les réponses des postes.";

export type TakeoffItemReadingsQuery = {
  /** One plan's scope (its logical identity), or the affaire's. */
  planLogicalId?: string | null;
  /** The states asked; every state by default. */
  states?: readonly TakeoffItemReadingState[];
  offset?: number;
  limit?: number;
};

export type TakeoffItemReadingsPage = {
  projectId: string;
  lines: TakeoffItemReadingLine[];
  /** The items of the latest list revision in the states asked. */
  matchingItems: number;
  /** The items in each state, for the filters (in the plan's scope when one is asked). */
  counts: Record<TakeoffItemReadingState, number>;
};

function isReadingState(value: unknown): value is TakeoffItemReadingState {
  return (TAKEOFF_ITEM_READING_STATES as readonly unknown[]).includes(value);
}

/**
 * A page of the affaire's items in their list order, each with its state, its coverage and its reading on each plan it
 * was asked about (the job asked, its unit's state, the current answer), and the counts of every state.
 */
export async function readAffaireItemReadings(projectId: string, query: TakeoffItemReadingsQuery = {}):
  Promise<TakeoffItemReadingsPage> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const client = context.supabase as unknown as Client;
  const scope = { p_tenant_id: context.tenantId, p_project_id: project.id,
    ...(query.planLogicalId ? { p_plan_logical_id: query.planLogicalId } : {}) };
  const [page, counted] = await Promise.all([
    client.rpc("read_takeoff_item_readings", { ...scope, ...(query.states ? { p_states: [...query.states] } : {}),
      p_offset: query.offset ?? 0, p_limit: query.limit ?? 100 }),
    client.rpc("count_takeoff_item_readings", scope),
  ]);
  if (page.error) throw mapSupabaseError(page.error, READ_FAILURE);
  if (counted.error) throw mapSupabaseError(counted.error, READ_FAILURE);
  const counts = Object.fromEntries(TAKEOFF_ITEM_READING_STATES.map((state) => [state, 0])) as Record<TakeoffItemReadingState, number>;
  for (const row of counted.data ?? []) if (isReadingState(row.state)) counts[row.state] = row.items;
  const lines = (page.data ?? []).map((row): TakeoffItemReadingLine => ({
    itemId: row.item_id,
    position: row.item_position,
    state: isReadingState(row.state) ? row.state : (() => { throw new TypeError("État de poste illisible."); })(),
    coverage: { expected: row.expected, answered: row.answered, inFlight: row.in_flight, ended: row.ended },
    readings: Array.isArray(row.readings) ? row.readings.map(parseTakeoffItemPlanReading) : [],
  }));
  const asked = query.states ?? TAKEOFF_ITEM_READING_STATES;
  const matchingItems = page.data?.[0]?.matching_items ?? asked.reduce((sum, state) => sum + counts[state], 0);
  return { projectId: project.id, lines, matchingItems, counts };
}

export type TakeoffItemAnswersCursor = { itemId: string; planLogicalId: string; readingRevision: number };

/**
 * Every answer of the affaire, the replaced ones too, in a stable order (item, plan, reading), after the cursor given:
 * one job's only, or the current readings only, when asked.
 */
export async function readAffaireItemAnswers(projectId: string, query: {
  jobId?: string | null; currentOnly?: boolean; after?: TakeoffItemAnswersCursor | null; limit?: number;
} = {}): Promise<{ projectId: string; answers: Array<TakeoffItemAnswer & { isCurrent: boolean }>; next: TakeoffItemAnswersCursor | null }> {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  const { data, error } = await (context.supabase as unknown as Client).rpc("read_takeoff_item_answers", {
    p_tenant_id: context.tenantId, p_project_id: project.id,
    ...(query.jobId ? { p_job_id: query.jobId } : {}),
    p_current_only: query.currentOnly ?? false,
    ...(query.after ? { p_after_item_id: query.after.itemId, p_after_plan_logical_id: query.after.planLogicalId,
      p_after_reading_revision: query.after.readingRevision } : {}),
    p_limit: limit,
  });
  if (error) throw mapSupabaseError(error, READ_FAILURE);
  const rows = data ?? [];
  const answers = rows.map((row) => ({ ...parseTakeoffItemAnswer(row.answer), isCurrent: row.is_current }));
  const last = rows.at(-1);
  return { projectId: project.id, answers,
    next: rows.length === limit && last
      ? { itemId: last.item_id, planLogicalId: last.plan_logical_id, readingRevision: last.reading_revision } : null };
}
