import { querySql } from "../local/calculation-gate-support";
import type { DedicatedOwner } from "../local/dedicated-owner";
import { seedPublishedItemTable, type SeededItemTable } from "./item-table-support";

// The counted marks of an affaire's items (lot 5) on the owned stack: the table of items' seed (two items of a list read
// on one plan, pages 2 and 7, each measured 1 u on page 2), then the machine marks the same attempt publishes, as the
// worker will (public.publish_takeoff_count_marks, migration …_takeoff_count_marks.sql): no producer runs here, no model
// is called. Fictional values only.

/** An A4 sheet across, as pdf.js reads it: its visible page is 842 × 595 points. */
export const COUNT_MARKS_GEOMETRY = { version: 1, view_box: [0, 0, 842, 595], rotation: 0, user_unit: 1, width: 842, height: 595 };

export type SeededCountMarks = SeededItemTable & { basin: string; valve: string };

/**
 * « Lavabo » proposed three times on page 2 (the third also proposed for « Vanne », a competing item of the same
 * reading) and once on page 7, an object whose item the reading could not tell.
 */
export async function seedCountMarks(owner: DedicatedOwner, name: string): Promise<SeededCountMarks> {
  const proposal = (itemId: string, sourceKey: string, state = "proposed") =>
    ({ item_id: itemId, state, method: "symbol_count", method_version: "banc-1", source_key: sourceKey });
  const seeded = await seedPublishedItemTable(owner, { name, labels: ["Lavabo", "Vanne"], answers: ["measured", "measured"],
    countMarks: ([basin, valve]) => ({
      pages: [{ page: 2, geometry: COUNT_MARKS_GEOMETRY }, { page: 7, geometry: COUNT_MARKS_GEOMETRY }],
      marks: [
        { page: 2, x: 0.2, y: 0.3, proposals: [proposal(basin!, "lav-1")] },
        { page: 2, x: 0.6, y: 0.4, proposals: [proposal(basin!, "lav-2")] },
        { page: 2, x: 0.8, y: 0.7, proposals: [proposal(basin!, "lav-3"), proposal(valve!, "van-1")] },
        { page: 7, x: 0.4, y: 0.6, proposals: [proposal(basin!, "lav-4", "to_attribute")] },
      ],
    }) });
  return { ...seeded, basin: seeded.itemIds[0]!, valve: seeded.itemIds[1]! };
}

async function json<T>(sql: string): Promise<T> {
  return JSON.parse((await querySql(sql)).at(-1) || "null") as T;
}

/** The answers of the seeded items, by item. */
export const readCountAnswers = (projectId: string) => json<Record<string, string>>(`select jsonb_object_agg(item_id, id)
  from public.takeoff_item_answers where project_id = '${projectId}';`);

/**
 * What the table of items and the send read: the analysis's rows, the stored answers' quantities, the decisions and
 * entries of the table. Marks never change any of them.
 */
export const readSentInputs = (projectId: string, jobId: string) => json<unknown>(`select jsonb_build_object(
  'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'quantity', r.quantity, 'unit', r.unit, 'verified', r.is_verified,
    'excluded', r.is_excluded) order by r.id), '[]') from public.takeoff_items r where r.job_id = '${jobId}'),
  'answers', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'quantity', a.quantity, 'outcome', a.outcome) order by a.id), '[]')
    from public.takeoff_item_answers a where a.project_id = '${projectId}'),
  'decisions', (select count(*) from public.takeoff_item_answer_decisions where project_id = '${projectId}'),
  'entries', (select count(*) from public.takeoff_item_entries where project_id = '${projectId}'));`);

/** The member's role in the tenant: « director » reads every affaire and operates none (the marks' operator rule). */
export async function setOwnerRole(owner: DedicatedOwner, role: "admin" | "director") {
  const output = await querySql(`update public.tenant_memberships set role = '${role}'
where tenant_id = '${owner.tenantId}' and user_id = '${owner.userId}' returning role;`);
  if (!output.includes(role)) throw new Error("The member's role was not changed.");
}

/**
 * The plan's job as an estimate send leaves it (status « applied », what the table of items calls sent), or back to
 * « completed »: its guards are the send's, not this journey's, so they are set aside for this one statement.
 */
export async function setJobSent(jobId: string, sent: boolean) {
  const status = sent ? "applied" : "completed";
  const output = await querySql(`begin;
set local session_replication_role = replica;
update public.takeoff_jobs set status = '${status}' where id = '${jobId}' returning status;
commit;`);
  if (!output.includes(status)) throw new Error("The job's status was not changed.");
}
