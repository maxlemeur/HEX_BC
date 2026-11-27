import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type * as Jobs from "@/lib/affaires/analysis-progress-jobs";
import type { StandaloneJob, StandaloneJobLane, StandaloneJobScope } from "@/lib/affaires/analysis-progress-jobs";
import { analysisProgressPages } from "@/lib/affaires/analysis-progress-pages";
import { readAffaireAnalysisProgress } from "@/lib/affaires/analysis-progress-server";
import type { TenantRole } from "@/lib/auth/tenant-context";
import { mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";
import { assertLoopbackSupabaseUrl } from "./local-supabase-ci";

// Parity of the standalone job lanes of the dashboard's analysis progress poll on a real PostgREST and
// PostgreSQL under RLS. The oracle is the five-read path the poll used before it read the five lanes
// in one request (copied below verbatim, on the same paging module). Fictional fixtures only.

const enabled = process.env.MERGEONE_TEST_ANALYSIS_PROGRESS_PARITY === "1";
type Context = { supabase: SupabaseClient<Database>; tenantId: string; userId: string; tenantRole: TenantRole };
let context: Context | null = null;
let useOracle = false;

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: async () => {
    if (!context) throw new Error("No viewer");
    return { ...context, isTenantAdmin: context.tenantRole === "admin", membership: null };
  },
}));
vi.mock("@/lib/affaires/analysis-progress-jobs", async (importOriginal) => {
  const actual = await importOriginal<typeof Jobs>();
  return {
    ...actual,
    readStandaloneJobLanes: (scope: StandaloneJobScope) => useOracle ? oracleLanes(scope) : actual.readStandaloneJobLanes(scope),
  };
});

const PROJECT_PREFILTER_LIMIT = 32;
const RETRY_FILTER = "status.eq.failed,execution_provider.eq.chatgpt_local,next_retry_at.not.is.null";
const ENDED_FILTER = "status.neq.failed,execution_provider.neq.chatgpt_local,next_retry_at.is.null";
const JOB_COLUMNS = "id, status, estimate_version_id, processing_strategy, provider_batch_state, error_code, created_at, completed_at, analysis_finished_at, analysis_completion_event_id, execution_provider, next_retry_at, plan_set_id, launch_unit_key, exceptions:takeoff_dpgf_review_decisions!takeoff_dpgf_review_decisions_takeoff_job_id_fkey(id)";

/** The five-read path of PR #546, verbatim apart from its scope parameter. */
async function oracleLanes(scope: StandaloneJobScope): Promise<Record<StandaloneJobLane, StandaloneJob[]>> {
  const { supabase, tenantId, owner, cutoff, activityCutoff, pages } = scope;
  async function readJobProjectPrefilter() {
    if (!owner) return null;
    const { data, error } = await supabase.from("estimate_projects").select("id")
      .eq("tenant_id", tenantId).eq("user_id", owner).is("is_archived", false).limit(PROJECT_PREFILTER_LIMIT + 1);
    if (error) throw mapSupabaseError(error, "Impossible de lire les affaires du suivi.");
    return data.length <= PROJECT_PREFILTER_LIMIT ? data.map(({ id }) => id) : null;
  }
  const readJobs = (projectIds: string[] | null) => {
    const query = supabase.from("takeoff_jobs").select(
      `${JOB_COLUMNS}, created_by, analysis_requested_by, updated_at, project:estimate_projects!takeoff_jobs_project_tenant_fkey!inner(id,name)`,
    ).eq("tenant_id", tenantId).eq("project.tenant_id", tenantId).is("project.is_archived", false)
      .is("launch_request_id", null).limit(1, { referencedTable: "exceptions" });
    if (projectIds) query.in("project_id", projectIds);
    return owner ? query.eq("project.user_id", owner) : query;
  };
  const projectIds = await readJobProjectPrefilter();
  if (projectIds?.length === 0) return { jobLive: [], jobRetry: [], jobAnalysisEnd: [], jobCompletedEnd: [], jobLegacyEnd: [] };
  const ended = () => readJobs(projectIds).not("status", "in", "(pending,processing)").or(ENDED_FILTER);
  const [jobLive, jobRetry, jobAnalysisEnd, jobCompletedEnd, jobLegacyEnd] = await Promise.all([
    pages.read("jobLive", () => readJobs(projectIds).is("analysis_finished_at", null).is("completed_at", null)
      .gt("updated_at", activityCutoff).or(`status.in.(pending,processing),and(${RETRY_FILTER})`), "updated_at"),
    pages.read("jobRetry", () => readJobs(projectIds).is("analysis_finished_at", null).not("completed_at", "is", null)
      .gt("completed_at", activityCutoff).eq("status", "failed").eq("execution_provider", "chatgpt_local")
      .not("next_retry_at", "is", null), "completed_at"),
    pages.read("jobAnalysisEnd", () => ended().not("analysis_finished_at", "is", null)
      .gt("analysis_finished_at", cutoff), "analysis_finished_at"),
    pages.read("jobCompletedEnd", () => ended().is("analysis_finished_at", null).not("completed_at", "is", null)
      .gt("completed_at", cutoff), "completed_at"),
    pages.read("jobLegacyEnd", () => ended().is("analysis_finished_at", null).is("completed_at", null)
      .gt("updated_at", cutoff), "updated_at"),
  ]);
  return { jobLive, jobRetry, jobAnalysisEnd, jobCompletedEnd, jobLegacyEnd } as Record<StandaloneJobLane, StandaloneJob[]>;
}

type Sent = { url: URL; headers: Headers };
const sent: Sent[] = [];
const recordingFetch: typeof fetch = (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).pathname.startsWith("/rest/v1/")) sent.push({ url: new URL(request.url), headers: new Headers(request.headers) });
  return fetch(input, init);
};
const restPaths = () => sent.map(({ url }) => url.pathname.slice("/rest/v1/".length));

const HOUR = 3_600_000;
const T0 = new Date(Math.floor(Date.now() / 1000) * 1000);
const ids = {
  tenantA: randomUUID(), tenantB: randomUUID(), tenantC: randomUUID(), launch: randomUUID(), launchJob: randomUUID(),
};
type Viewer = { label: string; email: string; password: string; userId: string; tenantId: string; role: TenantRole; client?: SupabaseClient<Database> };
const viewers: Record<"admin" | "small" | "large" | "outsider" | "bulk", Viewer> = {
  admin: { label: "administrator", role: "admin", tenantId: ids.tenantA } as Viewer,
  small: { label: "member under the prefilter limit", role: "engineer", tenantId: ids.tenantA } as Viewer,
  large: { label: "member over the prefilter limit", role: "engineer", tenantId: ids.tenantA } as Viewer,
  outsider: { label: "administrator of another tenant", role: "admin", tenantId: ids.tenantB } as Viewer,
  bulk: { label: "administrator of the 2,400-job tenant", role: "admin", tenantId: ids.tenantC } as Viewer,
};
const evidence: string[] = [];
function note(line: string) {
  evidence.push(line);
  console.info(line);
}

function psql(sql: string) {
  return execFileSync(process.env.E2E_ARMY_LOCAL_PSQL!, ["-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", process.env.E2E_ARMY_LOCAL_DB_URL!], {
    input: sql, encoding: "utf8",
  }).trim();
}

function fixtureSql() {
  const { admin, small, large, outsider, bulk } = viewers;
  const t = (offset: string) => `'${T0.toISOString()}'::timestamptz - interval '${offset}'`;
  return `\\set ON_ERROR_STOP on
begin;
insert into public.tenants (id, name, slug) values
  ('${ids.tenantA}', 'Suivi fictif A', 'suivi-fictif-a-${ids.tenantA}'),
  ('${ids.tenantB}', 'Suivi fictif B', 'suivi-fictif-b-${ids.tenantB}'),
  ('${ids.tenantC}', 'Suivi fictif C', 'suivi-fictif-c-${ids.tenantC}');
update public.tenant_memberships set is_default = false
  where user_id in ('${admin.userId}', '${small.userId}', '${large.userId}', '${outsider.userId}', '${bulk.userId}');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default) values
  ('${ids.tenantA}', '${admin.userId}', 'admin', true), ('${ids.tenantA}', '${small.userId}', 'engineer', true),
  ('${ids.tenantA}', '${large.userId}', 'engineer', true), ('${ids.tenantB}', '${outsider.userId}', 'admin', true),
  ('${ids.tenantC}', '${bulk.userId}', 'admin', true);
update public.feature_flags set enabled = true where tenant_id in ('${ids.tenantA}', '${ids.tenantB}', '${ids.tenantC}')
  and flag_key = 'TAKEOFF_MODULE_ENABLED';

create temp table fx_projects (kind text, slot int, id uuid, version uuid, tenant uuid, owner uuid) on commit drop;
insert into fx_projects
select kind, slot, gen_random_uuid(), gen_random_uuid(), tenant, owner
from (values ('admin', 4, '${ids.tenantA}'::uuid, '${admin.userId}'::uuid),
             ('small', ${PROJECT_PREFILTER_LIMIT}, '${ids.tenantA}', '${small.userId}'),
             ('small_archived', 1, '${ids.tenantA}', '${small.userId}'),
             ('large', 40, '${ids.tenantA}', '${large.userId}'),
             ('outsider', 3, '${ids.tenantB}', '${outsider.userId}'),
             ('bulk', 240, '${ids.tenantC}', '${bulk.userId}')) kinds(kind, total, tenant, owner)
cross join lateral generate_series(0, total - 1) slot;
insert into public.estimate_projects (id, tenant_id, user_id, name)
  select id, tenant, owner, 'Affaire fictive ' || kind || ' ' || slot from fx_projects;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version)
  select version, tenant, id, 1, 2 from fx_projects;

create function pg_temp.fx_kind(n int) returns text language sql immutable as $$
  select case when n % 10 = 9 then 'small_archived' when n % 5 in (0, 1) then 'small' when n % 5 in (2, 3) then 'large' else 'admin' end
$$;
create temp table fx_jobs (lane text, n int, kind text, status public.takeoff_job_status, provider text, retry_at timestamptz,
  updated_at timestamptz, completed_at timestamptz, analysis_finished_at timestamptz) on commit drop;
-- Five lanes, groups of five equal dates so pages split ties, and rows on both sides of each window.
insert into fx_jobs
select 'live', n, pg_temp.fx_kind(n), (array['pending', 'processing', 'failed'])[n % 3 + 1]::public.takeoff_job_status,
  case when n % 3 = 2 then 'chatgpt_local' else 'gemini' end, case when n % 3 = 2 then ${t("-1 hour")} end,
  case when n > 50 then ${t("8 days")} when n = 50 then ${t("6 days 23 hours")} else ${t("1 minute")} - (n / 5) * interval '3 hours' end,
  null::timestamptz, null::timestamptz
from generate_series(1, 53) n
union all
select 'retry', n, pg_temp.fx_kind(n), 'failed', 'chatgpt_local', ${t("-2 hours")}, ${t("1 minute")},
  case when n > 50 then ${t("8 days")} when n = 50 then ${t("6 days 23 hours")} else ${t("1 minute")} - (n / 5) * interval '12 hours' end, null::timestamptz
from generate_series(1, 53) n
union all
select 'analysis', n, pg_temp.fx_kind(n), (array['completed', 'applied', 'canceled', 'failed'])[n % 4 + 1]::public.takeoff_job_status,
  'gemini', null::timestamptz, ${t("1 minute")}, ${t("2 minutes")} - (n / 5) * interval '2 hours',
  case when n > 50 then ${t("25 hours")} when n = 50 then ${t("23 hours 59 minutes")} else ${t("2 minutes")} - (n / 5) * interval '2 hours' end
from generate_series(1, 53) n
union all
select 'completed', n, pg_temp.fx_kind(n), (array['completed', 'canceled', 'failed'])[n % 3 + 1]::public.takeoff_job_status,
  'gemini', null::timestamptz, ${t("1 minute")},
  case when n > 50 then ${t("25 hours")} when n = 50 then ${t("23 hours 59 minutes")} else ${t("3 minutes")} - (n / 5) * interval '2 hours' end, null::timestamptz
from generate_series(1, 53) n
union all
select 'legacy', n, pg_temp.fx_kind(n), (array['completed', 'canceled', 'failed'])[n % 3 + 1]::public.takeoff_job_status,
  'gemini', null::timestamptz,
  case when n > 50 then ${t("25 hours")} when n = 50 then ${t("23 hours 59 minutes")} else ${t("4 minutes")} - (n / 5) * interval '2 hours' end,
  null::timestamptz, null::timestamptz
from generate_series(1, 53) n;
create function pg_temp.fx_outcome(status public.takeoff_job_status, finished timestamptz) returns text language sql immutable as $$
  select case when finished is null then null when status in ('completed', 'applied') then 'success'
    when status = 'failed' then 'failure' else 'canceled' end
$$;

set local session_replication_role = replica;
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, created_by, analysis_requested_by, level, status,
  execution_provider, execution_host_id, next_retry_at, created_at, updated_at, completed_at, analysis_finished_at, analysis_outcome,
  analysis_completion_event_id, error_code)
select gen_random_uuid(), p.tenant, p.id, p.version, p.owner, case when j.n % 2 = 0 then '${admin.userId}'::uuid end, 'B', j.status,
  j.provider, case when j.provider = 'chatgpt_local' then 'urn:uuid:' || gen_random_uuid() end, j.retry_at, ${t("30 days")},
  j.updated_at, j.completed_at, j.analysis_finished_at, pg_temp.fx_outcome(j.status, j.analysis_finished_at),
  case when j.analysis_finished_at is not null then gen_random_uuid() end, case when j.status = 'failed' then 'PROVIDER_FAILED' end
from fx_jobs j
join fx_projects p on p.kind = j.kind and p.slot = (j.n * 7 + length(j.lane)) % (select count(*) from fx_projects c where c.kind = j.kind);

-- The same lanes in another tenant, never readable from tenant A.
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, created_by, level, status, created_at, updated_at,
  completed_at, analysis_finished_at, analysis_outcome)
select gen_random_uuid(), p.tenant, p.id, p.version, p.owner, 'B', case when j.status = 'failed' then 'canceled' else j.status end,
  ${t("30 days")}, j.updated_at, j.completed_at, j.analysis_finished_at,
  pg_temp.fx_outcome(case when j.status = 'failed' then 'canceled' else j.status end, j.analysis_finished_at)
from fx_jobs j join fx_projects p on p.kind = 'outsider' and p.slot = j.n % 3 where j.lane in ('live', 'analysis', 'legacy');

-- A launched unit belongs to its launch request, never to the standalone lanes.
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state)
select '${ids.launch}', tenant, id, 'automatic', 'initial', '${ids.launch}', 'evaluating' from fx_projects where kind = 'admin' and slot = 0;
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, created_by, level, status, created_at, updated_at,
  launch_request_id, launch_unit_key)
select '${ids.launchJob}', tenant, id, version, owner, 'B', 'pending', ${t("1 hour")}, ${t("1 minute")}, '${ids.launch}', 'grouped'
from fx_projects where kind = 'admin' and slot = 0;

-- Review decisions: none, one, or two behind the one-row existence witness.
insert into public.takeoff_dpgf_review_decisions (tenant_id, version_id, takeoff_job_id, estimate_item_id, review_reference,
  line_label, line_position, decision)
select j.tenant_id, j.estimate_version_id, j.id, gen_random_uuid(), 'revue-fictive-' || j.id || '-' || k, 'Ligne fictive', k, 'keep_dpgf'
from (select id, tenant_id, estimate_version_id, row_number() over (order by id) r from public.takeoff_jobs
      where tenant_id = '${ids.tenantA}') j
cross join lateral generate_series(1, case when j.r % 5 = 0 then 2 when j.r % 5 = 1 then 1 else 0 end) k;

-- The volume of the analysis progress journey's budget case: 240 affaires, 2,400 completed jobs.
insert into public.takeoff_jobs (project_id, estimate_version_id, tenant_id, created_by, level, status, created_at, completed_at, updated_at)
select id, version, tenant, owner, 'B', 'completed', ${t("3 hours")},
  case when j = 10 then ${t("2 days")} else ${t("1 hour")} end, ${t("1 hour")}
from fx_projects cross join generate_series(1, 10) j where kind = 'bulk';
set local session_replication_role = origin;
update public.estimate_projects set is_archived = true where id in (select id from fx_projects where kind = 'small_archived');
commit;
analyze public.takeoff_jobs;
analyze public.estimate_projects;
analyze public.takeoff_dpgf_review_decisions;
select count(*) from public.takeoff_jobs where tenant_id in ('${ids.tenantA}', '${ids.tenantB}', '${ids.tenantC}');
`;
}

async function signIn(viewer: Viewer) {
  const client = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: recordingFetch },
  });
  const { error } = await client.auth.signInWithPassword({ email: viewer.email, password: viewer.password });
  if (error) throw new Error(`Could not sign the ${viewer.label} in`);
  viewer.client = client;
}

function scopeOf(viewer: Viewer, pages: StandaloneJobScope["pages"]): StandaloneJobScope {
  const now = T0.getTime() + 1_000;
  return {
    supabase: viewer.client!, tenantId: viewer.tenantId, pages,
    owner: viewer.role === "admin" ? null : viewer.userId,
    cutoff: new Date(now - 24 * HOUR).toISOString(), activityCutoff: new Date(now - 7 * 24 * HOUR).toISOString(),
  };
}

beforeAll(async () => {
  if (!enabled) return;
  expect(process.env.RLS_E2E_EPHEMERAL).toBe("1");
  assertLoopbackSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const service = createServiceRoleClient();
  for (const [key, viewer] of Object.entries(viewers)) {
    viewer.email = `suivi-${key}-${randomUUID()}@example.test`;
    viewer.password = `Suivi-${randomUUID()}-A1!`;
    const created = await service.auth.admin.createUser({ email: viewer.email, password: viewer.password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`Could not create the ${viewer.label}`);
    viewer.userId = created.data.user.id;
  }
  note(`fixture jobs: ${psql(fixtureSql())}`);
  for (const viewer of Object.values(viewers)) await signIn(viewer);
  vi.stubEnv("TAKEOFF_MODULE_FORCE_ENABLED", "1");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(T0.getTime() + 1_000));
}, 120_000);

afterAll(() => {
  vi.useRealTimers();
  if (enabled && process.env.ANALYSIS_PROGRESS_PARITY_EVIDENCE) {
    appendFileSync(process.env.ANALYSIS_PROGRESS_PARITY_EVIDENCE, `${evidence.join("\n")}\n`);
  }
});

const allRows = (lanes: Record<StandaloneJobLane, StandaloneJob[]>) => Object.values(lanes).flat();

it.runIf(enabled)("reads the same standalone job lanes in one request on every page, for every viewer", async () => {
  const actual = await vi.importActual<typeof Jobs>("@/lib/affaires/analysis-progress-jobs");
  const projectIds = JSON.parse(psql(`select json_object_agg(kind, ids) from (
    select kind, json_agg(id) ids from (
      select p.id, case when p.is_archived then 'archived' when p.tenant_id = '${ids.tenantB}' then 'outsider'
        when p.user_id = '${viewers.small.userId}' then 'small' when p.user_id = '${viewers.large.userId}' then 'large' else 'admin' end kind
      from public.estimate_projects p where p.tenant_id in ('${ids.tenantA}', '${ids.tenantB}')) p
    group by kind) k`)) as Record<string, string[]>;
  const coverage = { pages: 0, exceptionsSeen: 0, exceptionlessSeen: 0, longestUrl: 0, fullCursorPage: false };
  for (const key of ["admin", "small", "large", "outsider"] as const) {
    const viewer = viewers[key];
    let cursor: string | undefined;
    let page = 0;
    const seen = new Set<string>();
    const laneRows = Object.fromEntries(actual.STANDALONE_JOB_LANES.map((lane) => [lane, 0]));
    do {
      sent.length = 0;
      const oraclePages = analysisProgressPages(cursor);
      const expected = await oracleLanes(scopeOf(viewer, oraclePages));
      const before = restPaths();
      sent.length = 0;
      const pages = analysisProgressPages(cursor);
      const lanes = await actual.readStandaloneJobLanes(scopeOf(viewer, pages));
      const after = restPaths();
      const longest = Math.max(...sent.map(({ url }) => url.href.length));
      coverage.longestUrl = Math.max(coverage.longestUrl, longest);
      const positions = cursor ? Object.entries(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>)
        .filter(([lane, position]) => lane.startsWith("job") && position).length : 0;
      if (key === "small" && positions === 5) coverage.fullCursorPage = true;
      expect(lanes).toEqual(expected);
      expect(pages.nextCursor()).toBe(oraclePages.nextCursor());
      const prefilter = viewer.role === "admin" ? [] : ["estimate_projects"];
      if (page === 0) expect(before).toEqual([...prefilter, ...Array(5).fill("takeoff_jobs")]);
      if (after.length) expect(after).toEqual([...prefilter, "tenants"]);
      note(`${viewer.label}, page ${page + 1}: ${allRows(lanes).length} jobs; requests before ${before.length} (${before.join(", ")}), `
        + `after ${after.length} (${after.join(", ")}); longest URL ${longest} characters`);
      for (const lane of actual.STANDALONE_JOB_LANES) laneRows[lane] += lanes[lane].length;
      for (const row of allRows(lanes)) {
        seen.add(row.id);
        if (row.exceptions.length) coverage.exceptionsSeen++;
        else coverage.exceptionlessSeen++;
        expect(row.exceptions.length).toBeLessThanOrEqual(1);
        if (key === "small") expect(projectIds.small).toContain(row.project.id);
        if (key === "large") expect(projectIds.large).toContain(row.project.id);
        if (key === "outsider") expect(projectIds.outsider).toContain(row.project.id);
        else expect(projectIds.outsider).not.toContain(row.project.id);
        expect(projectIds.archived).not.toContain(row.project.id);
        expect(row.id).not.toBe(ids.launchJob);
      }
      cursor = pages.nextCursor() ?? undefined;
      page++;
      coverage.pages++;
    } while (cursor);
    note(`${viewer.label}: ${page} pages, ${seen.size} distinct jobs, rows per lane ${JSON.stringify(laneRows)}`);
    // The other tenant only has live, analysis and legacy rows.
    if (key !== "outsider") expect(Object.values(laneRows).every((rows) => rows > 16)).toBe(true);
    expect(page).toBeGreaterThan(1);
  }
  expect(coverage.exceptionsSeen).toBeGreaterThan(0);
  expect(coverage.exceptionlessSeen).toBeGreaterThan(0);
  // The longest request: a member at the prefilter limit (32 project ids in each lane) resuming all five lanes.
  // Supabase's gateway rejects URLs over about 16 KB; keep a margin for the request's headers.
  expect(coverage.fullCursorPage).toBe(true);
  note(`longest URL over every viewer and page: ${coverage.longestUrl} characters`);
  expect(coverage.longestUrl).toBeLessThan(14_336);
}, 120_000);

it.runIf(enabled)("returns the same poll response and cursor chain as the five-read path", async () => {
  for (const key of ["admin", "small", "large", "outsider", "bulk"] as const) {
    const viewer = viewers[key];
    context = { supabase: viewer.client!, tenantId: viewer.tenantId, userId: viewer.userId, tenantRole: viewer.role };
    let cursor: string | undefined;
    let page = 0;
    do {
      useOracle = true;
      const expected = await readAffaireAnalysisProgress(cursor);
      useOracle = false;
      sent.length = 0;
      const received = await readAffaireAnalysisProgress(cursor);
      expect(received).toEqual(expected);
      expect(restPaths().filter((path) => path === "takeoff_jobs")).toEqual([]);
      cursor = received.nextCursor ?? undefined;
      page++;
      // The 2,400-job tenant has more than a hundred pages: its first three suffice.
    } while (cursor && (key !== "bulk" || page < 3));
    note(`${viewer.label}: same response on ${page} pages${cursor ? " (first pages)" : ""}`);
  }
}, 180_000);

type PlanNode = { "Node Type": string; "Relation Name"?: string; "Index Name"?: string; Plans?: PlanNode[]; "Actual Rows"?: number; "Actual Loops"?: number };
function scans(node: PlanNode): PlanNode[] {
  return [...(node["Relation Name"] === "takeoff_jobs" ? [node] : []), ...(node.Plans ?? []).flatMap(scans)];
}

it.runIf(enabled)("serves each lane of the single request from the poll indexes on the journey's volume", async () => {
  psql("alter role authenticator set pgrst.db_plan_enabled = 'true'; notify pgrst, 'reload config';");
  const explain = async ({ url, headers }: Sent) => {
    const plan = new Headers(headers);
    plan.set("accept", 'application/vnd.pgrst.plan+json; for="application/json"; options=analyze|buffers');
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, { headers: plan });
      if (response.ok) {
        const [{ Plan, "Execution Time": time }] = await response.json() as [{ Plan: PlanNode; "Execution Time": number }];
        return { scans: scans(Plan), time };
      }
      if (attempt > 20) throw new Error(`Plan unavailable: ${response.status} ${await response.text()}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  };
  const describe = (nodes: PlanNode[]) => nodes.map((node) => `${node["Node Type"]}${node["Index Name"] ? ` ${node["Index Name"]}` : ""}`
    + ` rows=${node["Actual Rows"]} loops=${node["Actual Loops"]}`);
  const actual = await vi.importActual<typeof Jobs>("@/lib/affaires/analysis-progress-jobs");
  for (const key of ["bulk", "small"] as const) {
    const viewer = viewers[key];
    sent.length = 0;
    await oracleLanes(scopeOf(viewer, analysisProgressPages(undefined)));
    const before = sent.filter(({ url }) => url.pathname.endsWith("/takeoff_jobs"));
    sent.length = 0;
    const firstPages = analysisProgressPages(undefined);
    await actual.readStandaloneJobLanes(scopeOf(viewer, firstPages));
    const after = sent.filter(({ url }) => url.pathname.endsWith("/tenants"));
    expect(after).toHaveLength(1);
    const oldPlans = await Promise.all(before.map(explain));
    const newPlan = await explain(after[0]);
    const oldIndexes = oldPlans.flatMap(({ scans }) => scans.map((node) => node["Index Name"] ?? node["Node Type"])).sort();
    const newIndexes = newPlan.scans.map((node) => node["Index Name"] ?? node["Node Type"]).sort();
    note(`${viewer.label} first page, five reads: ${oldPlans.map(({ scans, time }) => `[${describe(scans).join("; ")}] ${time} ms`).join(" | ")}`);
    note(`${viewer.label} first page, one read (${after[0].url.href.length} characters): [${describe(newPlan.scans).join("; ")}] ${newPlan.time} ms`);
    expect(newPlan.scans.some((node) => node["Node Type"] === "Seq Scan")).toBe(false);
    expect(newIndexes).toEqual(oldIndexes);
  }
}, 120_000);
