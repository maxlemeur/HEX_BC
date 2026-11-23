import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";

import { querySql } from "../local/calculation-gate-support";
import type { DedicatedOwner } from "../local/dedicated-owner";

// Lot 4, the send of one plan by item (« Envoyer ce plan au devis »), on the owned stack: an affaire whose list of items
// was read on several plans in one request, each plan published as the worker publishes its answers
// (public.publish_takeoff_item_answers), as item-table-support.ts seeds one plan. The reading against a list is not
// activated: the request, its dispatch, its claims and its publications run here through the database's own functions,
// in one transaction that adds the activations they need and removes those it added before its commit, leaving the ones
// it found. Fictional values only.

export type SendSeedPlan = {
  /** Its file name; the plans are read in this order (the dispatcher's display-name order). */
  name: string;
  /** What it measured, by item label: a quantity on a page; an item it does not name is not found on it. */
  measures: Record<string, { quantity: number; page: number }>;
  /** The bytes of the plan, stored where the dossier stores them (a location is attested on them). */
  pdf?: Buffer;
  /** The plan whose bytes this one is a copy of: the same document, page for page, for the page guard. */
  copyOf?: string;
};

export type SeededSend = {
  projectId: string;
  planSetId: string;
  items: Record<string, string>;
  plans: Array<{ name: string; fileId: string; jobId: string; digest: string }>;
};

/** A fictional plan of `pages` pages, each saying its number. */
export async function fictionalSendPlanPdf(label: string, pages = 9) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page += 1) document.addPage([595, 842]).drawText(`${label} — page ${page} (fictif)`, { x: 60, y: 760, size: 18, font });
  return Buffer.from(await document.save());
}

const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;
const PAGES = [2, 7];

/** An affaire of the dedicated owner, its list of items (unit « u », one section), read on `plans`, nothing accepted yet. */
export async function seedItemSendAffaire(owner: DedicatedOwner, input: { name: string; labels: string[]; plans: SendSeedPlan[];
  /** Items the list took from a DPGF import (a fictional one, never imported into an estimate). */
  dpgfLabels?: string[] }): Promise<SeededSend> {
  const ids = { project: randomUUID(), upload: randomUUID(), brief: randomUUID(), planSet: randomUUID(), revision: randomUUID(),
    intent: randomUUID(), listIntent: randomUUID() };
  const host = `urn:uuid:${randomUUID()}`;
  const items = Object.fromEntries(input.labels.map((label) => [label, randomUUID()]));
  const dpgfImport = randomUUID();
  const originOf = (label: string, intent: string) => (input.dpgfLabels ?? []).includes(label)
    ? { kind: "dpgf", importId: dpgfImport, mappingId: randomUUID(), rawRowId: randomUUID(), mappedRowId: randomUUID(), rowIndex: 1,
      sheetName: null, sourceRowNumber: 2, sourcePage: null, tableIndex: null, documentId: null, reference: "1.1", sourceUnit: "u",
      measurementNotesDigest: null, factsDigest: "f".repeat(64) }
    // Each item added by hand, as the list's write function records it (its intent, its author, in which revision).
    : { kind: "manual", intentId: intent, addedBy: owner.userId, addedAt: new Date().toISOString(), addedInRevision: 1 };
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const storage = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
    .storage.from("plan-files");
  const plans: Array<SeededSend["plans"][number] & { token: string; path: string; size: number; spec: SendSeedPlan }> = [];
  for (const spec of input.plans) {
    const fileId = randomUUID();
    const original = spec.copyOf ? plans.find((plan) => plan.name === spec.copyOf) : undefined;
    if (spec.copyOf && !original) throw new Error("A copy names a plan seeded before it.");
    const digest = original?.digest ?? createHash("sha256").update(spec.pdf ?? fileId).digest("hex");
    const path = [owner.tenantId, ids.planSet, fileId, spec.name].join("/");
    if (spec.pdf && (await storage.upload(path, spec.pdf, { contentType: "application/pdf" })).error) {
      throw new Error("The plan's bytes were not stored.");
    }
    plans.push({ name: spec.name, fileId, jobId: randomUUID(), digest, token: randomUUID(), path, size: spec.pdf?.length ?? 8, spec });
  }
  const selection = { profileId: "profil-fictif", model: "modele-fictif", reasoningEffort: null, hostId: host,
    authorizationId: "autorisation-fictive" };
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "count";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], confirmed: true };
  preparation.conventions = { ...preparation.conventions, unit: "u", confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  preparation.sources = plans.map((plan) => ({ document_id: plan.fileId, document_name: plan.name, kind: "plan" as const, revision: "A",
    source_version: "version-fictive-1", pages: PAGES, active: true, confirmed: true, plan_set_id: ids.planSet, file_path: plan.path,
    page_count: 9, logical_document_id: null, content_hash: plan.digest, source_updated_at: null, mime_type: "application/pdf",
    page_triage: null }));
  const unitBudget = { tokens: 100_000, cost_cents: 500 };
  const manifest = {
    format_version: 2, intent: "initial",
    order: { kind: "item_list", version: 2, list: { revision_id: ids.revision, revision: 1, content_sha256: "1".repeat(64),
      item_count: input.labels.length } },
    dispatch: { order: "display_name", version: 1 },
    units: plans.map((plan, index) => ({ key: `plan:${plan.fileId}`, ordinal: index + 1, plans: [plan.fileId], pages: PAGES, page_count: 9,
      vector_pages: 0, budget: unitBudget })),
    plans: plans.map((plan) => ({ entry_key: plan.fileId, plan_file_id: plan.fileId, name: plan.name, logical_id: plan.fileId,
      intake_document_id: null, generation: "generation-fictive-1", content_sha256: plan.digest, pages: PAGES, page_count: 9 })),
    // The request's budget is its plans' (the seal compares the sum of the units' budgets with it).
    coverage: { plans_retained: plans.length, plans_omitted: [] }, references: [],
    budget: { tokens: unitBudget.tokens * plans.length, cost_cents: unitBudget.cost_cents * plans.length },
  };
  const jobs = plans.map((plan) => ({ id: plan.jobId, plan_set_id: ids.planSet, launch_unit_key: `plan:${plan.fileId}`,
    source_file_name: plan.name, source_file_type: "application/pdf", source_file_size_bytes: plan.size, prompt_version: "fixture",
    execution_host_id: host }));
  const result = { extracted_json: {}, warnings: [], tables: [], provider_meta: {}, confidence: null, token_count: 10, cost_cents: 0,
    duration_ms: 5, job_duration_ms: 6, run_metrics: [] };

  const publications = plans.map((plan) => {
    const rows: Array<Record<string, unknown>> = [];
    const answers = input.labels.map((label) => {
      const measure = plan.spec.measures[label];
      const base = { item_id: items[label], searched_pages: PAGES, unreadable_pages: [] as number[], candidate: null, quantity: null };
      if (!measure) {
        return { ...base, outcome: "not_found", observations: [],
          reasons: [{ code: "NO_INDICATION", by: "model", text: "Aucun indice sur les pages lues (fictif).", chunk_id: "f1-b1" }] };
      }
      const rowId = randomUUID();
      rows.push({ id: rowId, designation: label, quantity: measure.quantity, unit: "u", confidence: 0.9, evidence: "Symboles relevés (fictif)",
        source_file_name: plan.name, source_page: measure.page, metadata: {} });
      return { ...base, outcome: "measured", reasons: [], quantity: { value: measure.quantity, unit: "u" }, observations: [{ page: measure.page,
        evidence: "Symboles relevés (fictif)", method: "symbol_count", confidence: 0.9, quantity: measure.quantity, unit: "u",
        measurement_basis: null, role: "contribution", source: "model", chunk_id: "f1-b1", vector_key: null, takeoff_item_id: rowId }] };
    });
    return `select job_id from public.dispatch_next_takeoff_host_job(${text(host)});
select count(*) from public.claim_observed_local_takeoff_job('${plan.jobId}', '${owner.tenantId}', ${text(host)}, clock_timestamp(),
  '${plan.token}', clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0);
select answer_count from public.publish_takeoff_item_answers('${plan.jobId}', '${plan.token}', now(), 'modele-fictif',
  'takeoff-c-postes-v1', '{"schema_version":"v2","prompt_version":"takeoff-c-postes-v1"}'::jsonb, array[${PAGES.join(", ")}], ${literal(answers)},
  '[]'::jsonb, ${literal(result)}, ${literal(rows)}, null);
-- The server evaluated the rules of the rows: none fails.
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = '${plan.jobId}';`;
  });

  const sql = `begin;
insert into public.feature_flags (tenant_id, flag_key, enabled) values ('${owner.tenantId}', 'TAKEOFF_MODULE_ENABLED', true)
on conflict (tenant_id, flag_key) do update set enabled = true;
insert into public.estimate_projects (id, tenant_id, user_id, name) values ('${ids.project}', '${owner.tenantId}', '${owner.userId}', ${text(input.name)});
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values ('${ids.upload}', '${ids.project}', '${owner.userId}', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values ('${ids.brief}', '${ids.project}', '${ids.upload}', 'confirme', 'Résumé fictif', 'Objet fictif', now(), '${owner.userId}');
insert into public.plan_sets (id, tenant_id, project_id, name) values ('${ids.planSet}', '${owner.tenantId}', '${ids.project}', 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select (p ->> 'id')::uuid, '${owner.tenantId}', '${ids.planSet}', p ->> 'name', p ->> 'path', 'application/pdf', (p ->> 'size')::integer, 9
from jsonb_array_elements(${literal(plans.map((plan) => ({ id: plan.fileId, name: plan.name, path: plan.path, size: plan.size })))}) as x(p);
-- The list as its write function stores it (its digest is fictional: the seal compares it with itself).
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select (item ->> 'id')::uuid, '${owner.tenantId}', '${ids.project}', item ->> 'kind', 1, '${owner.userId}'
from jsonb_array_elements(${literal(input.labels.map((label) => ({ id: items[label], kind: originOf(label, "").kind })))}) as x(item);
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256, gesture_sha256,
  intent_key, created_by)
values ('${ids.revision}', '${owner.tenantId}', '${ids.project}', 1, 'item_added', '{}', ${input.labels.length}, repeat('1', 64), repeat('a', 64),
  '${ids.listIntent}', '${owner.userId}');
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label, expected_unit,
  sections, origin_kind, origin)
select '${ids.revision}', '${owner.tenantId}', '${ids.project}', (entry ->> 'id')::uuid, (position - 1)::integer, 'manual:' || (entry ->> 'id'),
  entry ->> 'label', 'u', '[{"id":"appareils","title":"Appareils sanitaires","order":1}]'::jsonb, entry #>> '{origin,kind}', entry -> 'origin'
from jsonb_array_elements(${literal(input.labels.map((label) => ({ id: items[label], label, origin: originOf(label, randomUUID()) })))})
  with ordinality as e(entry, position);
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
select '${owner.tenantId}', '${ids.project}', 1, snapshot -> 'preparation', snapshot, now(), '${owner.userId}', '${owner.userId}'
from (select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', '${owner.userId}',
  'confirmed_at', now(), 'execution_selection', ${literal(selection)},
  'readiness', '{"status":"ready","can_launch":true,"blockers":[],"reservations":[]}'::jsonb,
  'preparation', jsonb_set(${literal(preparation)}, '{sources}', (select jsonb_agg(s.source || jsonb_build_object('source_updated_at',
    to_jsonb(f.updated_at)) order by s.n) from jsonb_array_elements(${literal(preparation.sources)}) with ordinality as s(source, n)
    join public.plan_files f on f.id = (s.source ->> 'document_id')::uuid))) as snapshot) s;
set local session_replication_role = origin;

-- What the second measuring order needs, for this transaction only: the activations it adds are removed before its
-- commit, and those it found stay as they were.
create temporary table seed_activations_added (name text not null) on commit drop;
with added as (insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing
  returning 1) insert into seed_activations_added select 'launch' from added;
with added as (insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute') on conflict do nothing
  returning 1) insert into seed_activations_added select 'completion' from added;
with added as (insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing
  returning 1) insert into seed_activations_added select 'dispatch' from added;
with added as (insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute') on conflict do nothing
  returning 1) insert into seed_activations_added select 'item_list' from added;

select outcome from public.launch_manual_takeoff_plan_request('${owner.tenantId}', '${ids.project}', '${owner.userId}', '${ids.intent}',
  'initial', null, ${text(host)}, ${literal(selection)}, ${literal(manifest)},
  (select confirmed_snapshot from public.takeoff_preparations where project_id = '${ids.project}'), ${literal(jobs)},
  '${ids.planSet}', 1, array[${plans.map((plan) => `'${plan.fileId}'::uuid`).join(", ")}]);
${publications.join("\n")}

delete from private.takeoff_item_list_order_activation where exists (select 1 from seed_activations_added where name = 'item_list');
delete from private.takeoff_plan_dispatch_activation where exists (select 1 from seed_activations_added where name = 'dispatch');
delete from private.takeoff_completion_activation where exists (select 1 from seed_activations_added where name = 'completion');
delete from private.takeoff_launch_activation where exists (select 1 from seed_activations_added where name = 'launch');
commit;
select 'ITEM_SEND_SEEDED';
`;
  const output = await querySql(sql);
  if (!output.includes("ITEM_SEND_SEEDED")) throw new Error("The item send seed did not commit.");
  return { projectId: ids.project, planSetId: ids.planSet, items,
    plans: plans.map(({ name, fileId, jobId, digest }) => ({ name, fileId, jobId, digest })) };
}

/**
 * The member accepts the measured items of one plan, in that plan's scope, through the table's own command in their
 * session (its claims), as « Accepter les mesurés sans anomalie » does: what is retained, and only that, is sent.
 */
export async function acceptOnPlan(owner: DedicatedOwner, projectId: string, plan: { fileId: string; jobId: string }, itemIds: string[]) {
  const targets = itemIds.map((itemId) => `jsonb_build_object('item_id', '${itemId}', 'entry_revision', 0,
    'answers', (select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', 0, 'entry_revision', 0))
      from public.takeoff_item_answers a where a.item_id = '${itemId}' and a.job_id = '${plan.jobId}'))`);
  const output = await querySql(`begin;
select set_config('request.jwt.claims', ${text(JSON.stringify({ role: "authenticated", sub: owner.userId }))}, true);
select set_config('request.jwt.claim.sub', '${owner.userId}', true);
set local role authenticated;
select public.review_takeoff_items('${owner.tenantId}', '${projectId}', jsonb_build_object('command_version', 1,
  'intent_key', '${randomUUID()}', 'gesture', 'accept_measured', 'scope', jsonb_build_object('kind', 'plan', 'plan_logical_id', '${plan.fileId}'),
  'targets', jsonb_build_array(${targets.join(", ")}), 'apply', ${literal(itemIds)}, 'skipped', '[]'::jsonb)) ->> 'outcome';
commit;`);
  if (!output.includes("applied")) throw new Error(`The acceptance on plan ${plan.fileId} was not applied: ${output.slice(-400)}`);
}

async function json<T>(sql: string): Promise<T> {
  return JSON.parse((await querySql(sql)).at(-1) || "[]") as T;
}

/** A line's own entries, which a send by item never changes (only its quantity, and what engine 3 derives from it). */
// `h_mo` is not among them: under engine 3 it is the line's total hours, derived from its hours per unit and its quantity.
const LINE_INPUTS = ["unit_price_ht_cents", "pu_ht_cents", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit",
  "tax_rate_bp", "k_fo", "k_fo_manual", "k_mo", "k_mo_atelier", "k_mo_chantier", "fo_price_origin", "pricing_status",
  "selected_supplier_price_id", "product_id", "line_nature", "title", "unit_code", "parent_id"];

export type OwnedLine = { id: string; version_id: string; item_type: string; parent_id: string | null; title: string | null; quantity: number;
  position: number; inputs: Record<string, unknown> };

/** Every version of the affaire. */
export const readOwnedVersions = (projectId: string) => json<Array<{ id: string; version_number: number; status: string;
  calc_engine_version: number }>>(`select coalesce(jsonb_agg(to_jsonb(v) order by v.version_number), '[]')
  from (select id, version_number, status, calc_engine_version from public.estimate_versions where project_id = '${projectId}') v;`);

/** Every section and line of the affaire's versions, in document order, with each line's own entries. */
export const readOwnedLines = (projectId: string) => json<OwnedLine[]>(`select coalesce(jsonb_agg(to_jsonb(x) order by x.position, x.id), '[]')
  from (select i.id, i.version_id, i.item_type, i.parent_id, i.title, i.quantity::float8 as quantity, i.position,
      (select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(i)) e where e.key = any(${`array[${LINE_INPUTS.map((key) => `'${key}'`).join(", ")}]`})) as inputs
    from public.estimate_items i join public.estimate_versions v on v.id = i.version_id
    where v.project_id = '${projectId}') x;`);

/** The live and replaced parts of the sends by item of the affaire: which job brought how much to which line. */
export const readOwnedParts = (projectId: string) => json<Array<{ job_id: string; quantity: number; state: string; estimate_item_id: string | null;
  item_id: string }>>(`select coalesce(jsonb_agg(to_jsonb(p) order by p.job_id, p.state), '[]')
  from (select p.job_id, p.quantity::float8 as quantity, p.state, t.estimate_item_id, p.item_id
    from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
    where p.project_id = '${projectId}') p;`);

export const countOwnedReceipts = async (projectId: string) =>
  Number((await querySql(`select count(*) from public.takeoff_item_send_receipts where project_id = '${projectId}';`)).at(-1));

/** Another member of the tenant holds the editor's lease on the draft, as the editor holds it. */
export async function holdDraftElsewhere(input: { tenantId: string; versionId: string; userId: string }) {
  await querySql(`insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
    values ('${input.versionId}', '${input.userId}', '${input.tenantId}', now() + interval '10 minutes', '${randomUUID()}');`);
}

export async function releaseDraftElsewhere(versionId: string, userId: string) {
  await querySql(`delete from public.draft_locks where version_id = '${versionId}' and user_id = '${userId}';`);
}
