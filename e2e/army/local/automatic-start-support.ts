import { querySql } from "./calculation-gate-support";

// The automatic start of the takeoff (migration 20261121170448_takeoff_launch_requests.sql) on the owned stack of a
// local campaign: its activation, and the rows a journey reads to count requests, jobs, notices and payers.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertOwnedCampaign() {
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || process.env.E2E_ARMY_BLOCK_WORKERS !== "1") {
    throw new Error("The automatic start fixture requires a dedicated owned worker campaign.");
  }
}

/**
 * Sets both cut-offs: the automatic start's and the end-of-analysis notices' (an admission needs both). The automatic
 * start is removed again by `deactivateOwnedAutomaticStart` once the journey ends, so that no other journey of the
 * stack confirms a brief under it; the notices' cut-off stays, as the other local journeys set it.
 */
export async function activateOwnedAutomaticStart() {
  assertOwnedCampaign();
  await querySql(`insert into private.takeoff_completion_activation (active_from) values (clock_timestamp()) on conflict do nothing;
insert into private.takeoff_launch_activation (active_from) values (clock_timestamp()) on conflict do nothing;`);
}

export async function deactivateOwnedAutomaticStart() {
  assertOwnedCampaign();
  await querySql("delete from private.takeoff_launch_activation;");
}

async function readJson<T>(sql: string): Promise<T> {
  const output = await querySql(sql);
  return JSON.parse([...output].reverse().find((line) => line.trim().startsWith("[") || line.trim().startsWith("{")) ?? "[]") as T;
}

export type OwnedLaunchRequest = {
  id: string; origin: string; state: string; reason_code: string | null; confirmed_by: string | null; payer_id: string | null;
  mandate_kind: string | null; execution_host_id: string | null; outcome: string | null;
  units_expected: number | null; manifest_plans: string[] | null;
};

export async function readOwnedLaunchRequests(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<OwnedLaunchRequest[]>(`select coalesce(json_agg(json_build_object('id', r.id, 'origin', r.origin, 'state', r.state,
    'reason_code', r.reason_code, 'confirmed_by', r.confirmed_by, 'payer_id', r.payer_id,
    'mandate_kind', r.mandate_kind, 'execution_host_id', r.execution_host_id, 'outcome', r.outcome, 'units_expected', r.units_expected,
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
