import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";

import { querySql } from "../local/calculation-gate-support";
import type { DedicatedOwner } from "../local/dedicated-owner";

// The table of items (lot 4) on the owned stack: an affaire of a dedicated member whose plan was read against its sealed
// list and published, as the worker publishes (public.publish_takeoff_item_answers, migration
// 20261122080845_takeoff_item_answers.sql). The reading of a plan against a list is not wired to the worker yet, so the
// request, its claim and its publication are run here by the database's own functions, in one transaction that sets
// the activations they need and removes them before its commit: nothing stays activated. Fictional values only.

export type SeededAnswer = "measured" | "hypothesis" | "uncertain" | "not_found";
export type SeededItemTable = { projectId: string; jobId: string; itemIds: string[]; rowIds: Array<string | null>; planId: string; publicationMs?: number };

const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * An affaire whose list holds `labels.length` items (in that order, unit « u »), read on one plan (pages 2 and 7): each
 * item's answer as `answers` says (measured: one positive row of 1 u on page 2; hypothesis: the same row, then made an
 * estimate; uncertain: a candidate value, page 7 unreadable; not_found: nothing). The rows' rules are evaluated, none
 * failing. A publication counts every contribution's row (20261122113611_takeoff_item_answers_before_activation.sql
 * refuses one its insert excludes), so an hypothesis row is published countable, then made an estimate and excluded as
 * the hypothesis rule excludes a new one: what a member's later edit of the row leaves.
 *
 * `planPdf`, when given, is the plan's bytes (nine pages): stored where the dossier stores them and sealed by their own
 * digest, so that a reader of the analysis is served them (the attested route checks the digest). Without it, the plan
 * has no bytes and a fictional digest.
 */
export async function seedPublishedItemTable(owner: DedicatedOwner, input: { name: string; labels: string[]; answers: SeededAnswer[];
  planPdf?: Buffer;
  /** Machine marks the same attempt publishes after the answers (public.publish_takeoff_count_marks, generation 1). */
  countMarks?: (itemIds: string[]) => { pages: unknown; marks: unknown } }):
  Promise<SeededItemTable> {
  if (input.labels.length !== input.answers.length) throw new Error("One answer per item.");
  const ids = {
    project: randomUUID(), upload: randomUUID(), brief: randomUUID(), planSet: randomUUID(), plan: randomUUID(),
    revision: randomUUID(), intent: randomUUID(), job: randomUUID(), token: randomUUID(), listIntent: randomUUID(),
  };
  const host = `urn:uuid:${randomUUID()}`;
  const itemIds = input.labels.map(() => randomUUID());
  const rowIds = input.answers.map((answer) => answer === "measured" || answer === "hypothesis" ? randomUUID() : null);
  const planDigest = createHash("sha256").update(input.planPdf ?? ids.plan).digest("hex");
  const filePath = [owner.tenantId, ids.planSet, ids.plan, "plan-1.pdf"].join("/");
  const planSize = input.planPdf?.length ?? 8;
  if (input.planPdf) {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const storage = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
      .storage.from("plan-files");
    if ((await storage.upload(filePath, input.planPdf, { contentType: "application/pdf" })).error) throw new Error("The plan's bytes were not stored.");
  }
  const selection = { profileId: "profil-fictif", model: "modele-fictif", reasoningEffort: null, hostId: host,
    authorizationId: "autorisation-fictive" };
  const answers = input.answers.map((answer, index) => {
    const base = { item_id: itemIds[index], searched_pages: [2, 7], unreadable_pages: [] as number[], candidate: null, quantity: null };
    if (answer === "measured" || answer === "hypothesis") {
      return { ...base, outcome: "measured", reasons: [], quantity: { value: 1, unit: "u" }, observations: [{ page: 2,
        evidence: "Symbole relevé (fictif)", method: "symbol_count", confidence: 0.9, quantity: 1, unit: "u", measurement_basis: null,
        role: "contribution", source: "model", chunk_id: "f1-b1", vector_key: null, takeoff_item_id: rowIds[index] }] };
    }
    if (answer === "uncertain") {
      return { ...base, outcome: "uncertain", searched_pages: [2], unreadable_pages: [7],
        reasons: [{ code: "QUALIFIER_UNREADABLE", by: "model", text: "Le diamètre n’est pas lisible (fictif).", chunk_id: "f1-b1" },
          { code: "PAGES_UNREADABLE", by: "worker", text: null, chunk_id: null }],
        candidate: { value: 1, unit: "u" }, observations: [{ page: 2, evidence: "Indice fictif", method: "symbol_count", confidence: 0.6,
          quantity: 1, unit: "u", measurement_basis: null, role: "candidate", source: "model", chunk_id: "f1-b1", vector_key: null,
          takeoff_item_id: null }] };
    }
    return { ...base, outcome: "not_found", observations: [],
      reasons: [{ code: "NO_INDICATION", by: "model", text: "Aucun indice sur les pages lues (fictif).", chunk_id: "f1-b1" }] };
  });
  const rows = input.answers.flatMap((answer, index) => rowIds[index] ? [{ id: rowIds[index], designation: input.labels[index],
    quantity: 1, unit: "u", confidence: 0.9, evidence: "Symbole relevé (fictif)", source_file_name: "plan-1.pdf", source_page: 2,
    metadata: {} }] : []);
  const marks = input.countMarks?.(itemIds) ?? null;
  const hypotheses = input.answers.flatMap((answer, index) => answer === "hypothesis" ? [rowIds[index]!] : []);
  const result = { extracted_json: {}, warnings: [], tables: [], provider_meta: {}, confidence: null, token_count: 10, cost_cents: 0,
    duration_ms: 5, job_duration_ms: 6, run_metrics: [] };
  const plan = { entry_key: ids.plan, plan_file_id: ids.plan, name: "plan-1.pdf", logical_id: ids.plan, intake_document_id: null,
    generation: "generation-fictive-1", content_sha256: planDigest, pages: [2, 7], page_count: 9 };
  // The preparation as the application builds it (its own constructor), so that every reader of the job parses its seal:
  // the plan's source with its pages, its digest and its path; its modification date is the row's, set below.
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "count";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], confirmed: true };
  preparation.conventions = { ...preparation.conventions, unit: "u", confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  preparation.sources = [{ document_id: ids.plan, document_name: "plan-1.pdf", kind: "plan", revision: "A",
    source_version: "version-fictive-1", pages: [2, 7], active: true, confirmed: true, plan_set_id: ids.planSet, file_path: filePath,
    page_count: 9, logical_document_id: null, content_hash: planDigest, source_updated_at: null, mime_type: "application/pdf",
    page_triage: null }];

  const sql = `begin;
insert into public.feature_flags (tenant_id, flag_key, enabled) values ('${owner.tenantId}', 'TAKEOFF_MODULE_ENABLED', true)
on conflict (tenant_id, flag_key) do update set enabled = true;
insert into public.estimate_projects (id, tenant_id, user_id, name) values ('${ids.project}', '${owner.tenantId}', '${owner.userId}', ${text(input.name)});
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values ('${ids.upload}', '${ids.project}', '${owner.userId}', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values ('${ids.brief}', '${ids.project}', '${ids.upload}', 'confirme', 'Résumé fictif', 'Objet fictif', now(), '${owner.userId}');
insert into public.plan_sets (id, tenant_id, project_id, name) values ('${ids.planSet}', '${owner.tenantId}', '${ids.project}', 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values ('${ids.plan}', '${owner.tenantId}', '${ids.planSet}', 'plan-1.pdf', ${text(filePath)}, 'application/pdf', ${planSize}, 9);
-- The list as its write function stores it (its digest is fictional: the seal compares it with itself).
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select item.id::uuid, '${owner.tenantId}', '${ids.project}', 'manual', 1, '${owner.userId}'
from jsonb_array_elements_text(${literal(itemIds)}) as item(id);
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256, gesture_sha256,
  intent_key, created_by)
values ('${ids.revision}', '${owner.tenantId}', '${ids.project}', 1, 'item_added', '{}', ${itemIds.length}, repeat('1', 64), repeat('a', 64),
  '${ids.listIntent}', '${owner.userId}');
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label, expected_unit,
  sections, origin_kind, origin)
select '${ids.revision}', '${owner.tenantId}', '${ids.project}', (entry ->> 'id')::uuid, (position - 1)::integer, 'manual:' || (entry ->> 'id'),
  entry ->> 'label', 'u', '[{"id":"appareils","title":"Appareils sanitaires","order":1}]'::jsonb, 'manual',
  -- Each item added by hand, as the list's write function records it (its intent, its author, when, in which revision).
  jsonb_build_object('kind', 'manual', 'intentId', entry ->> 'intent', 'addedBy', '${owner.userId}',
    'addedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'addedInRevision', 1)
from jsonb_array_elements(${literal(itemIds.map((id, index) => ({ id, label: input.labels[index], intent: randomUUID() })))})
  with ordinality as e(entry, position);
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select '${owner.tenantId}', '${ids.project}', 1, snapshot -> 'preparation', snapshot, now(), '${owner.userId}', '${owner.userId}'
from (select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', '${owner.userId}',
  'confirmed_at', now(), 'execution_selection', ${literal(selection)},
  'readiness', '{"status":"ready","can_launch":true,"blockers":[],"reservations":[]}'::jsonb,
  'preparation', jsonb_set(${literal(preparation)}, '{sources,0,source_updated_at}',
    to_jsonb((select updated_at from public.plan_files where id = '${ids.plan}')))) as snapshot) s;
set local session_replication_role = origin;

-- What the second measuring order needs, for this transaction only.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;

select outcome from public.launch_manual_takeoff_plan_request('${owner.tenantId}', '${ids.project}', '${owner.userId}', '${ids.intent}',
  'initial', null, ${text(host)}, ${literal(selection)},
  jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', '${ids.revision}',
      'revision', 1, 'content_sha256', repeat('1', 64), 'item_count', ${itemIds.length})),
    'dispatch', '{"order":"display_name","version":1}'::jsonb,
    'units', jsonb_build_array(jsonb_build_object('key', 'plan:${ids.plan}', 'ordinal', 1, 'plans', jsonb_build_array('${ids.plan}'),
      'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0, 'budget', '{"tokens":400000,"cost_cents":2500}'::jsonb)),
    'plans', jsonb_build_array(${literal(plan)}),
    'coverage', '{"plans_retained":1,"plans_omitted":[]}'::jsonb, 'references', '[]'::jsonb,
    'budget', '{"tokens":400000,"cost_cents":2500}'::jsonb),
  (select confirmed_snapshot from public.takeoff_preparations where project_id = '${ids.project}'),
  jsonb_build_array(jsonb_build_object('id', '${ids.job}', 'plan_set_id', '${ids.planSet}', 'launch_unit_key', 'plan:${ids.plan}',
    'source_file_name', 'plan-1.pdf', 'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
    'execution_host_id', ${text(host)})),
  '${ids.planSet}', 1, array['${ids.plan}'::uuid]);
select job_id from public.dispatch_next_takeoff_host_job(${text(host)});
select count(*) from public.claim_observed_local_takeoff_job('${ids.job}', '${owner.tenantId}', ${text(host)}, clock_timestamp(),
  '${ids.token}', clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0);
select answer_count from public.publish_takeoff_item_answers('${ids.job}', '${ids.token}', now(), 'modele-fictif',
  'takeoff-c-postes-v1', '{"schema_version":"v2","prompt_version":"takeoff-c-postes-v1"}'::jsonb, array[2, 7], ${literal(answers)},
  '[]'::jsonb, ${literal(result)}, ${literal(rows)}, null);
${marks ? `select 'MARKS_BEGIN=' || extract(epoch from clock_timestamp());
select public.publish_takeoff_count_marks('${ids.job}', '${ids.token}', 1, ${literal(marks.pages)}, ${literal(marks.marks)}) ->> 'marks';
select 'MARKS_END=' || extract(epoch from clock_timestamp());
` : ""}-- The hypotheses made estimates, excluded as public.exclude_new_takeoff_hypothesis excludes a new estimated row.
update public.takeoff_items set metadata = '{"quantity_nature":"estimated"}'::jsonb, is_excluded = true,
  exclusion_reason = 'Hypothèse non présélectionnée : quantité estimée, sans mesure sur un plan. Incluez la ligne pour la compter.'
where job_id = '${ids.job}' and id::text in (select jsonb_array_elements_text(${literal(hypotheses)}));
-- The server evaluated the rules of the rows: none fails.
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = '${ids.job}';

delete from private.takeoff_item_list_order_activation;
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
commit;
select 'ITEM_TABLE_SEEDED';
`;
  const output = await querySql(sql);
  if (!output.includes("ITEM_TABLE_SEEDED")) throw new Error("The item table seed did not commit.");
  const instant = (label: string) => Number(output.find((line) => line.startsWith(label))?.slice(label.length));
  return { projectId: ids.project, jobId: ids.job, planId: ids.plan, itemIds, rowIds,
    ...(marks && { publicationMs: Math.round(1000 * (instant("MARKS_END=") - instant("MARKS_BEGIN="))) }) };
}

export type OwnedDecision = { item_id: string; kind: string; reason: string | null; note: string | null; revision: number; actor_id: string };
export type OwnedEntry = { item_id: string; quantity: number; unit: string; category: string; note: string | null; included: boolean };
export type OwnedRow = { id: string; is_verified: boolean; verified_by: string | null; is_excluded: boolean; exclusion_reason: string | null };
export type OwnedAnswer = { item_id: string; outcome: string; quantity: number | null };

async function json<T>(sql: string): Promise<T> {
  return JSON.parse((await querySql(sql)).at(-1) || "[]") as T;
}

export const readOwnedDecisions = (projectId: string) => json<OwnedDecision[]>(`select coalesce(jsonb_agg(to_jsonb(d) order by d.item_id), '[]')
  from (select item_id, kind, reason, note, revision, actor_id from public.takeoff_item_answer_decisions where project_id = '${projectId}') d;`);
export const readOwnedEntries = (projectId: string) => json<OwnedEntry[]>(`select coalesce(jsonb_agg(to_jsonb(e) order by e.item_id), '[]')
  from (select item_id, quantity, unit, category, note, included from public.takeoff_item_entries where project_id = '${projectId}') e;`);
export const readOwnedRows = (jobId: string) => json<OwnedRow[]>(`select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]')
  from (select id, is_verified, verified_by, is_excluded, exclusion_reason from public.takeoff_items where job_id = '${jobId}') r;`);
export const readOwnedAnswers = (projectId: string) => json<OwnedAnswer[]>(`select coalesce(jsonb_agg(to_jsonb(a) order by a.item_id), '[]')
  from (select item_id, outcome, quantity from public.takeoff_item_answers where project_id = '${projectId}') a;`);
export const countOwnedReviewEvents = async (projectId: string) =>
  Number((await querySql(`select count(*) from public.takeoff_item_review_events where project_id = '${projectId}';`)).at(-1));

/**
 * Another tab of the same member accepts one item, through the database's own command in the member's session (its
 * claims): what a stale selection on screen then meets.
 */
export async function acceptElsewhere(owner: DedicatedOwner, projectId: string, itemId: string) {
  const output = await querySql(`begin;
select set_config('request.jwt.claims', ${text(JSON.stringify({ role: "authenticated", sub: owner.userId }))}, true);
select set_config('request.jwt.claim.sub', '${owner.userId}', true);
set local role authenticated;
select public.review_takeoff_items('${owner.tenantId}', '${projectId}', jsonb_build_object('command_version', 1,
  'intent_key', '${randomUUID()}', 'gesture', 'accept_measured', 'scope', '{"kind":"affaire"}'::jsonb,
  'targets', jsonb_build_array(jsonb_build_object('item_id', '${itemId}', 'entry_revision', 0,
    'answers', (select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', 0, 'entry_revision', 0))
      from public.takeoff_item_answers a
      where a.item_id = '${itemId}'))),
  'apply', jsonb_build_array('${itemId}'), 'skipped', '[]'::jsonb)) ->> 'outcome';
commit;`);
  if (!output.includes("applied")) throw new Error("The other tab's acceptance was not applied.");
}
