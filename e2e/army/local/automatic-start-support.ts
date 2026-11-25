import { redactOutput } from "../../../scripts/tester-army/local-recipe-common.mjs";
import { querySql } from "./calculation-gate-support";

// The automatic start of the takeoff (migration 20261121170448_takeoff_launch_requests.sql) on the owned stack of a
// local campaign: its activation, and the rows a journey reads to count requests, jobs, notices and payers.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function readJson<T>(sql: string): Promise<T> {
  const output = await querySql(sql);
  return JSON.parse([...output].reverse().find((line) => line.trim().startsWith("[") || line.trim().startsWith("{")) ?? "[]") as T;
}

export type OwnedLaunchRequest = {
  id: string; origin: string; state: string; reason_code: string | null; confirmed_by: string | null; payer_id: string | null;
  mandate_kind: string | null; execution_host_id: string | null; outcome: string | null;
  units_expected: number | null; units_failed: number; units_not_started: number; manifest_plans: string[] | null;
};

/** Displayed copy identities on this fictional dossier, for a second tab replaying its gesture. */
export async function ownedPlanChoices(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<Array<{ id: string; version: string }>>(`select coalesce(json_agg(json_build_object(
    'id',o.plan_file_id,'version',o.plan_version) order by o.plan_name),'[]'::json)
    from public.estimate_projects p cross join lateral public.takeoff_brief_plan_options(p.tenant_id,p.id) o
    where p.id='${projectId}';`);
}

export async function readOwnedLaunchRequests(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<OwnedLaunchRequest[]>(`select coalesce(json_agg(json_build_object('id', r.id, 'origin', r.origin, 'state', r.state,
    'reason_code', r.reason_code, 'confirmed_by', r.confirmed_by, 'payer_id', r.payer_id,
    'mandate_kind', r.mandate_kind, 'execution_host_id', r.execution_host_id, 'outcome', r.outcome, 'units_expected', r.units_expected,
    'units_failed', r.units_failed, 'units_not_started', r.units_not_started,
    'manifest_plans', (select json_agg(plan ->> 'plan_file_id') from jsonb_array_elements(r.manifest -> 'plans') plan))
    order by r.created_at), '[]'::json) from public.takeoff_launch_requests r where r.project_id = '${projectId}';`);
}

export type OwnedAffaireJob = {
  id: string; status: string; estimate_version_id: string | null; created_by: string; launch_request_id: string | null;
  launch_unit_key: string | null; analysis_outcome: string | null; execution_host_id: string | null;
};

export async function readOwnedAffaireJobs(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<OwnedAffaireJob[]>(`select coalesce(json_agg(json_build_object('id', j.id, 'status', j.status,
    'estimate_version_id', j.estimate_version_id, 'created_by', j.created_by, 'launch_request_id', j.launch_request_id,
    'launch_unit_key', j.launch_unit_key, 'analysis_outcome', j.analysis_outcome, 'execution_host_id', j.execution_host_id)
    order by j.created_at), '[]'::json) from public.takeoff_jobs j where j.project_id = '${projectId}';`);
}

export async function readOwnedAffaireNotices(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<Array<{ subject_kind: string; request_id: string | null; job_id: string | null; recipient_user_id: string | null;
    outcome: string; plans_read_count: number | null }>>(`select coalesce(json_agg(json_build_object('subject_kind', n.subject_kind,
    'request_id', n.request_id, 'job_id', n.job_id, 'recipient_user_id', n.recipient_user_id, 'outcome', n.outcome,
    'plans_read_count', n.plans_read_count)), '[]'::json) from public.takeoff_completion_notifications n where n.project_id = '${projectId}';`);
}

/** Makes `memberId` a director of `ownerId`'s tenant, their active tenant from now on. */
export async function makeOwnedDirector(ownerId: string, memberId: string) {
  if (!UUID.test(ownerId) || !UUID.test(memberId)) throw new Error("Invalid fixture member.");
  await querySql(`begin;
update public.tenant_memberships set is_default = false where user_id = '${memberId}';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
select m.tenant_id, '${memberId}', 'director', true from public.tenant_memberships m where m.user_id = '${ownerId}' and m.is_default;
commit;`);
}

export async function readOwnedBrief(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  const [brief] = await readJson<Array<{ status: string; updated_at: string; confirmed_by: string | null }>>(`select coalesce(json_agg(
    json_build_object('status', b.status, 'updated_at', b.updated_at, 'confirmed_by', b.confirmed_by)), '[]'::json)
    from public.affaire_briefs b where b.project_id = '${projectId}';`);
  return brief ?? null;
}

/**
 * What the payer notice of the brief's confirmation depends on for `memberId`, read as the affaire's page reads it when
 * the server renders it (readAutomaticTakeoffPayerNotice): the brief to confirm, both cut-offs, and the member's right to
 * pay on the affaire. The module's flag is the server's default on these stacks, and a missing subscription only changes
 * the notice's digest.
 */
export async function readOwnedPayerNoticeBasis(projectId: string, memberId: string) {
  if (!UUID.test(projectId) || !UUID.test(memberId)) throw new Error("Invalid fixture affaire or member.");
  const [basis] = await readJson<Array<{ brief: string | null; active: boolean; payer: boolean }>>(`select coalesce(json_agg(
    json_build_object('brief', (select b.status from public.affaire_briefs b where b.project_id = p.id),
      'active', private.takeoff_launch_active(), 'payer', private.takeoff_launch_payer_eligible(p.tenant_id, p.id, '${memberId}'))),
    '[]'::json) from public.estimate_projects p where p.id = '${projectId}';`);
  return basis ?? null;
}

/** Diagnostic only. The member's dossier API controls readiness. */
export async function readOwnedIntakeLaunchDiagnostics(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  const launches = await readJson<Array<{ id: string; status: string; attempts: number; published: boolean; lastError: string | null }>>(
    `select coalesce(json_agg(json_build_object('id', id, 'status', status, 'attempts', attempt_count,
      'published', brief_published_revision is not null, 'lastError', last_error) order by created_at, id), '[]'::json)
      from public.affaire_intake_uploads where project_id = '${projectId}' and launch_read_scans is not null;`);
  return launches.map(launch => ({ ...launch, lastError: launch.lastError ? redactOutput(launch.lastError).slice(0, 500) : null }));
}

/** The affaire's estimate versions: a launch from the takeoff's options creates none (the send chooses its draft). */
export async function readOwnedVersionCount(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  const [row] = await readJson<Array<{ count: number }>>(`select coalesce(json_agg(json_build_object('count', c.count)), '[]'::json)
    from (select count(*)::int as count from public.estimate_versions v where v.project_id = '${projectId}') c;`);
  return row?.count ?? 0;
}
