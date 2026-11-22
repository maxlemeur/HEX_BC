-- Lot 3, migration A: one analysis per plan. A launch request of format 2 seals one unit per retained plan; each unit
-- is analysed by its own job, one at a time on the Mac of the mandate, under a persistent reservation of that Mac (its
-- slot); every paid call is reserved in the request's ledger before it is sent and settled after; the request closes
-- on the end of its last unit with one notice. Lot 2's grouped format (format 1) and every historical job keep working.
--
-- Before the owner sets private.takeoff_plan_dispatch_activation (after lot 2's cut-offs, and once the authorised Mac runs
-- this application), whatever lot 2's activations: no admission seals format 2, and grouped (format 1) and standalone
-- work keep every write, count, public code and outcome they had. A grouped request is settled by M4's own statements;
-- its admissions record what lot 2 records; its paid calls are checked as lot 2 checks them and reserve nothing; the
-- hosted recovery follows M3's statements for every job that is not a plan of one analysis per plan; the notices keep
-- M3's public codes; a grouped analysis is not stopped by plan. The previous application version calls these functions
-- with their signatures and gets those answers.
--
-- Once activated, and after it is withdrawn for the plans already admitted, a plan of one analysis per plan is read only
-- under the Mac's slot (one at a time on the Mac, whatever process claims it); every paid call of its request is reserved
-- before it is sent, a call of unknown outcome freezes the request's further paid calls. The send of a per-plan analysis
-- stays closed until the partial send (TAKEOFF_SEND_JOB_NOT_READY): activating before it closes the send of every new
-- analysis, a dossier of one plan included.
--
-- Section 14 takes the locks, last and as briefly as possible; the application procedure (which writers to stop, the
-- read-only pre-check, what to do on a lock timeout or a deadlock) is in the pull request.
begin;

-- A lock that is not granted in 5 seconds stops the migration, with nothing applied, rather than queue the job writers.
set local lock_timeout = '5s';

-- 1. The activation of one analysis per plan. Empty until the owner sets it.
create table private.takeoff_plan_dispatch_activation (
  singleton boolean primary key default true check (singleton),
  active_from timestamptz not null
);
revoke all on private.takeoff_plan_dispatch_activation from public, anon, authenticated, service_role;

-- Format 2 needs the automatic start's and the notices' cut-offs too: a request closes only on the recorded end of its jobs.
create function private.takeoff_plan_dispatch_active(p_at timestamptz default pg_catalog.clock_timestamp())
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_launch_active(p_at)
    and exists (select 1 from private.takeoff_plan_dispatch_activation a where a.active_from <= p_at)
$$;
revoke all on function private.takeoff_plan_dispatch_active(timestamptz) from public, anon, authenticated, service_role;

create function public.takeoff_plan_dispatch_is_active()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_plan_dispatch_active()
$$;
revoke all on function public.takeoff_plan_dispatch_is_active() from public, anon, authenticated;
grant execute on function public.takeoff_plan_dispatch_is_active() to service_role;

-- 2. The state of a unit of a request, decided here once for the settlement, the reconciliation and the affaire's
-- reading (src/lib/takeoff/launch-request-coverage.ts words it). Each unit is in exactly one state. A result row never
-- makes a success: a failure's diagnostic writes one too.
create function private.takeoff_unit_state(p_status text, p_outcome text, p_error_code text, p_started_at timestamptz)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_outcome = 'success' or (p_outcome is null and p_status in ('completed', 'applied')) then 'succeeded'
    when p_outcome = 'canceled' or (p_outcome is null and p_status = 'canceled') then 'canceled'
    when p_outcome = 'failure' then case
      when p_started_at is null
        or p_error_code in ('TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_QUEUE_EXPIRED', 'TAKEOFF_WORKER_HOST_SILENT')
        then 'not_started' else 'failed' end
    when p_status = 'processing' then 'running'
    -- Pending, or failed with its technical retry still to decide or to run.
    else 'queued'
  end
$$;
revoke all on function private.takeoff_unit_state(text, text, text, timestamptz) from public, anon, authenticated, service_role;

-- The codes of an end of one analysis per plan with a public French reason (TAKEOFF_PLAN_PUBLIC_FAILURE_CODES,
-- src/lib/takeoff/completion-outcome.ts): M3's list (private.takeoff_public_failure_codes, unchanged for every other
-- notice) with a request's budget spent, a usage unknown or unrecorded, and a plan's source changed after its admission.
create function private.takeoff_plan_public_failure_codes()
returns text[] language sql immutable set search_path = pg_catalog as $$
  select private.takeoff_public_failure_codes()
    || array['TAKEOFF_PREPARATION_SOURCE_CHANGED', 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED', 'TAKEOFF_USAGE_UNRECORDED']::text[];
$$;
revoke all on function private.takeoff_plan_public_failure_codes() from public, anon, authenticated, service_role;

-- 3. The request's counters (their columns are added in section 14): a unit that never started is told apart from one
-- that failed, and a member's stop of the rest of the request is recorded (its cancelled units were stopped at a member's
-- request).

-- 4. The seal of format 2 and the projection of one unit. A request's job attests the exact projection of its unit: the
-- request's sealed snapshot with only that unit's plan among the plans (its retained pages, original and 1-based), the
-- common references, and a reference to its request for the audit (`launch_unit`). The PDF is not copied into another
-- plan set, and the request's snapshot is never written over.
create function private.takeoff_launch_unit(p_manifest jsonb, p_unit_key text)
returns jsonb language sql immutable set search_path = '' as $$
  select u.value from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_manifest -> 'units') = 'array'
    then p_manifest -> 'units' else '[]'::jsonb end) as u(value)
  where u.value ->> 'key' = p_unit_key limit 1
$$;
revoke all on function private.takeoff_launch_unit(jsonb, text) from public, anon, authenticated, service_role;

create function private.takeoff_launch_unit_snapshot(p_request public.takeoff_launch_requests, p_unit_key text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  unit jsonb := private.takeoff_launch_unit(p_request.manifest, p_unit_key);
  plans text[];
begin
  if p_request.manifest -> 'format_version' is distinct from '2'::jsonb or unit is null then
    return null;
  end if;
  select pg_catalog.array_agg(p.value) into plans from pg_catalog.jsonb_array_elements_text(unit -> 'plans') as p(value);
  return pg_catalog.jsonb_set(p_request.preparation_snapshot, '{preparation,sources}', coalesce((
      -- Its plan's pages as the manifest lists them (the seal checked they are its source's): the order the worker reads.
      select pg_catalog.jsonb_agg(case when s.value ->> 'kind' = 'plan' and unit ? 'pages'
          then s.value || pg_catalog.jsonb_build_object('pages', unit -> 'pages') else s.value end order by s.position)
      from pg_catalog.jsonb_array_elements(p_request.preparation_snapshot #> '{preparation,sources}') with ordinality as s(value, position)
      where s.value ->> 'kind' is distinct from 'plan' or s.value ->> 'document_id' = any (plans)), '[]'::jsonb))
    || pg_catalog.jsonb_build_object('launch_unit', pg_catalog.jsonb_build_object(
      'request_id', p_request.id, 'key', p_unit_key, 'ordinal', unit -> 'ordinal', 'manifest_digest', p_request.manifest_digest,
      'budget', unit -> 'budget', 'vector_pages', unit -> 'vector_pages'));
end;
$$;
revoke all on function private.takeoff_launch_unit_snapshot(public.takeoff_launch_requests, text) from public, anon, authenticated, service_role;

-- The job of a request's first unit, by its place in the recorded order (a unit's key is a plan copy's identifier, whose
-- order is not the members'): what an admission, a replay or a command meanwhile answers.
create function private.takeoff_launch_first_job(p_request_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select j.id from public.takeoff_jobs j
  join public.takeoff_launch_requests r on r.id = j.launch_request_id
  where j.launch_request_id = p_request_id
  order by (private.takeoff_launch_unit(r.manifest, j.launch_unit_key) ->> 'ordinal')::integer nulls first, j.id
  limit 1
$$;
revoke all on function private.takeoff_launch_first_job(uuid) from public, anon, authenticated, service_role;

-- The seal of either format: format 1 exactly as M4 checked it; format 2 only once the owner activated it, with one
-- unit per plan of the snapshot, in the recorded order, each with its share of the request's envelope (rounded up by
-- the server: the shares add up to at least the envelope and less than the envelope plus one per unit) and its
-- allowance of the dossier's sixty vector pages.
create or replace function private.assert_takeoff_launch_seal(p_request public.takeoff_launch_requests, p_manifest jsonb, p_snapshot jsonb)
returns void language plpgsql stable set search_path = '' as $$
declare
  units integer;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object'
    or (p_manifest -> 'format_version' is distinct from '1'::jsonb and p_manifest -> 'format_version' is distinct from '2'::jsonb)
    or jsonb_typeof(p_manifest -> 'units') is distinct from 'array'
    or p_manifest #>> '{order,kind}' is distinct from 'free_extraction'
    or jsonb_typeof(p_manifest -> 'plans') is distinct from 'array' or jsonb_array_length(p_manifest -> 'plans') = 0
    or jsonb_typeof(p_manifest #> '{budget,tokens}') is distinct from 'number' or (p_manifest #>> '{budget,tokens}')::numeric < 1
    or jsonb_typeof(p_manifest #> '{budget,cost_cents}') is distinct from 'number' or (p_manifest #>> '{budget,cost_cents}')::numeric < 0
    or jsonb_typeof(p_snapshot) is distinct from 'object' or p_snapshot -> 'schema_version' is distinct from '1'::jsonb
    or p_snapshot ->> 'confirmed_by' is distinct from p_request.payer_id::text
    or p_snapshot -> 'execution_selection' is distinct from p_request.mandate_selection
    or p_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb
    or p_snapshot #>> '{preparation,processing,level}' is distinct from 'C'
    or p_snapshot #>> '{preparation,processing,provider}' is distinct from 'chatgpt'
    or p_snapshot #>> '{preparation,destination,kind}' is distinct from 'analysis_only' then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
  units := jsonb_array_length(p_manifest -> 'units');
  if p_manifest -> 'format_version' = '1'::jsonb then
    if units <> 1 or p_manifest #>> '{units,0,key}' is distinct from 'grouped' then
      raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
    end if;
    return;
  end if;
  if not private.takeoff_plan_dispatch_active()
    or units not between 1 and 20 or units <> jsonb_array_length(p_manifest -> 'plans')
    or p_manifest #>> '{dispatch,order}' is distinct from 'display_name'
    -- Unit i holds plan i, keyed by its entry, at place i.
    or exists (
      select 1 from jsonb_array_elements(p_manifest -> 'units') with ordinality as u(value, position)
      join jsonb_array_elements(p_manifest -> 'plans') with ordinality as p(value, position) using (position)
      where u.value ->> 'key' is distinct from 'plan:' || lower(p.value ->> 'entry_key')
        or u.value -> 'ordinal' is distinct from to_jsonb(u.position)
        or u.value -> 'plans' is distinct from jsonb_build_array(p.value ->> 'entry_key')
        or jsonb_typeof(u.value #> '{budget,tokens}') is distinct from 'number'
        or jsonb_typeof(u.value #> '{budget,cost_cents}') is distinct from 'number'
        or jsonb_typeof(u.value -> 'vector_pages') is distinct from 'number'
        or (u.value #>> '{budget,tokens}')::numeric not between 1 and (p_manifest #>> '{budget,tokens}')::numeric
        or (u.value #>> '{budget,cost_cents}')::numeric not between 0 and (p_manifest #>> '{budget,cost_cents}')::numeric
        or (u.value ->> 'vector_pages')::numeric not between 0 and 60
        -- The unit reads its plan's pages, and counts its plan's pages.
        or u.value -> 'pages' is distinct from p.value -> 'pages'
        or u.value -> 'page_count' is distinct from p.value -> 'page_count')
    -- Each plan is its source as the snapshot reads it: the same copy, name, digest and retained pages (the manifest lists
    -- them in ascending order; its unit's projection gives the worker that order), so that what the worker reads and what
    -- the activity shows are the same pages.
    or exists (
      select 1 from jsonb_array_elements(p_manifest -> 'plans') p(value)
      left join lateral (select s.value from jsonb_array_elements(p_snapshot #> '{preparation,sources}') s(value)
        where s.value -> 'active' = 'true'::jsonb and s.value ->> 'kind' = 'plan' and s.value ->> 'document_id' = p.value ->> 'entry_key'
        limit 1) source on true
      where source.value is null
        or p.value ->> 'plan_file_id' is distinct from p.value ->> 'entry_key'
        or p.value ->> 'name' is distinct from source.value ->> 'document_name'
        -- A plan without its digest is refused, as its worker refuses it.
        or nullif(source.value ->> 'content_hash', '') is null
        or p.value ->> 'content_sha256' is distinct from source.value ->> 'content_hash'
        or jsonb_typeof(p.value -> 'pages') is distinct from 'array'
        or p.value -> 'pages' is distinct from (select coalesce(jsonb_agg(page.value order by (page.value #>> '{}')::numeric), '[]'::jsonb)
          from jsonb_array_elements(case when jsonb_typeof(source.value -> 'pages') = 'array' then source.value -> 'pages'
            else '[]'::jsonb end) page(value)))
    or (select sum((u.value #>> '{budget,tokens}')::numeric) from jsonb_array_elements(p_manifest -> 'units') u(value))
      not between (p_manifest #>> '{budget,tokens}')::numeric and (p_manifest #>> '{budget,tokens}')::numeric + units - 1
    or (select sum((u.value #>> '{budget,cost_cents}')::numeric) from jsonb_array_elements(p_manifest -> 'units') u(value))
      not between (p_manifest #>> '{budget,cost_cents}')::numeric and (p_manifest #>> '{budget,cost_cents}')::numeric + units - 1
    or (select sum((u.value ->> 'vector_pages')::numeric) from jsonb_array_elements(p_manifest -> 'units') u(value)) > 60
    -- Every plan the snapshot reads is a unit, and only those.
    or (select coalesce(array_agg(s.value ->> 'document_id' order by s.value ->> 'document_id'), '{}')
        from jsonb_array_elements(p_snapshot #> '{preparation,sources}') s(value)
        where s.value -> 'active' = 'true'::jsonb and s.value ->> 'kind' = 'plan')
      is distinct from (select array_agg(p.value ->> 'entry_key' order by p.value ->> 'entry_key')
        from jsonb_array_elements(p_manifest -> 'plans') p(value)) then
    raise exception 'TAKEOFF_LAUNCH_SEAL_INVALID' using errcode = '22023';
  end if;
end;
$$;

-- M4's attestation with the unit's branch: a job of format 2 attests the projection of its unit, and a plan added to
-- the plan set since the seal does not make it stale (the affaire shows it as an addition); format 1 is unchanged.
create or replace function private.attest_takeoff_job_snapshot(p_job public.takeoff_jobs)
returns table (snapshot jsonb, require_complete_plan_set boolean)
language plpgsql set search_path = '' as $$
declare
  prep public.takeoff_preparations%rowtype;
  request public.takeoff_launch_requests%rowtype;
  sealed jsonb;
begin
  if p_job.launch_request_id is not null then
    select * into request from public.takeoff_launch_requests r
    where r.id = p_job.launch_request_id and r.tenant_id = p_job.tenant_id and r.project_id = p_job.project_id
      and r.state = 'admitted';
    sealed := case when request.manifest -> 'format_version' = '2'::jsonb
      then private.takeoff_launch_unit_snapshot(request, p_job.launch_unit_key) else request.preparation_snapshot end;
    if sealed is null or sealed #> '{readiness,can_launch}' is distinct from 'true'::jsonb then
      raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
    end if;
    return query select sealed, request.manifest -> 'format_version' is distinct from '2'::jsonb;
    return;
  end if;
  -- Take the preparation lock before membership, tenant and project locks,
  -- in the same order as a concurrent edit or confirmation.
  select * into prep from public.takeoff_preparations
  where tenant_id = p_job.tenant_id and project_id = p_job.project_id for share;
  if prep.confirmed_snapshot is null
    or prep.confirmed_snapshot -> 'preparation_revision' is distinct from to_jsonb(prep.revision)
    or prep.confirmed_snapshot #> '{readiness,can_launch}' is distinct from 'true'::jsonb then
    raise exception using errcode = '42501', message = 'TAKEOFF_PREPARATION_REQUIRED';
  end if;
  return query select prep.confirmed_snapshot, true;
end;
$$;
revoke all on function private.attest_takeoff_job_snapshot(public.takeoff_jobs) from public, anon, authenticated;

-- The job of one unit, for both admissions: its unit of the sealed manifest, and the snapshot it attests computed here
-- (the projection for format 2), so that what is inserted and what is attested are one value.
create or replace function private.insert_takeoff_launch_job(p_request public.takeoff_launch_requests, p_job jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  requested public.takeoff_jobs := jsonb_populate_record(null::public.takeoff_jobs, p_job);
  snapshot jsonb;
  inserted uuid;
begin
  if requested.id is null or requested.plan_set_id is null or requested.launch_unit_key is null
    or requested.execution_host_id is distinct from p_request.execution_host_id
    or private.takeoff_launch_unit(p_request.manifest, requested.launch_unit_key) is null then
    raise exception 'TAKEOFF_LAUNCH_JOB_INVALID' using errcode = '22023';
  end if;
  snapshot := case when p_request.manifest -> 'format_version' = '2'::jsonb
    then private.takeoff_launch_unit_snapshot(p_request, requested.launch_unit_key) else p_request.preparation_snapshot end;
  perform set_config('mergeone.takeoff_request_admission', p_request.id::text, true);
  insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, plan_set_id, level, status,
    processing_strategy, source_file_name, source_file_path, source_file_type, source_file_size_bytes, prompt_version,
    created_by, preparation_snapshot, execution_provider, execution_host_id, launch_request_id, launch_unit_key)
  values (requested.id, p_request.tenant_id, p_request.project_id, null, requested.plan_set_id, 'C', 'pending', 'sync',
    requested.source_file_name, null, requested.source_file_type, requested.source_file_size_bytes, requested.prompt_version,
    p_request.payer_id, snapshot, 'chatgpt_local', p_request.execution_host_id, p_request.id,
    requested.launch_unit_key)
  returning id into inserted;
  perform set_config('mergeone.takeoff_request_admission', '', true);
  return inserted;
end;
$$;
revoke all on function private.insert_takeoff_launch_job(public.takeoff_launch_requests, jsonb) from public, anon, authenticated, service_role;

-- The jobs of a sealed request, in the order of its units, inserted in the transaction that seals it: one object for
-- format 1 (its grouped unit), an array with one job per unit, in their order, for format 2.
create function private.insert_takeoff_launch_jobs(p_request public.takeoff_launch_requests, p_job jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  unit record;
  payload jsonb;
  inserted uuid[] := '{}';
begin
  if p_request.manifest -> 'format_version' is distinct from '2'::jsonb then
    if jsonb_typeof(p_job) is distinct from 'object' then
      raise exception 'TAKEOFF_LAUNCH_JOB_INVALID' using errcode = '22023';
    end if;
    return array[private.insert_takeoff_launch_job(p_request,
      p_job || jsonb_build_object('launch_unit_key', p_request.manifest #>> '{units,0,key}'))];
  end if;
  if jsonb_typeof(p_job) is distinct from 'array' or jsonb_array_length(p_job) <> jsonb_array_length(p_request.manifest -> 'units') then
    raise exception 'TAKEOFF_LAUNCH_JOB_INVALID' using errcode = '22023';
  end if;
  for unit in select u.value, u.position from jsonb_array_elements(p_request.manifest -> 'units') with ordinality as u(value, position)
    order by u.position
  loop
    payload := p_job -> (unit.position::integer - 1);
    if jsonb_typeof(payload) is distinct from 'object' or payload ->> 'launch_unit_key' is distinct from unit.value ->> 'key' then
      raise exception 'TAKEOFF_LAUNCH_JOB_INVALID' using errcode = '22023';
    end if;
    inserted := inserted || private.insert_takeoff_launch_job(p_request, payload);
  end loop;
  return inserted;
end;
$$;
revoke all on function private.insert_takeoff_launch_jobs(public.takeoff_launch_requests, jsonb) from public, anon, authenticated, service_role;

-- The admission as 20261121193413_takeoff_launch_exclusion_and_send_requests.sql left it (an analysis outside any request
-- that runs makes it wait), its jobs inserted by the function above: its signature, its checks and its answers are
-- unchanged; the answer names the first unit's job, the audit all of them.
create or replace function public.admit_takeoff_launch_request(
  p_request_id uuid, p_token uuid, p_mark bigint, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_module_default boolean default false
) returns table (outcome text, job_id uuid, reason_code text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  brief public.affaire_briefs%rowtype;
  admitted_jobs uuid[];
  failure text;
  violated text;
begin
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state in ('admitted', 'closed') then
    return query select 'replayed'::text, private.takeoff_launch_first_job(request.id), null::text;
    return;
  end if;
  -- The token alone: a lease that expired was claimed again under another token by then, or is still this evaluation's.
  if request.evaluation_lease_token is distinct from p_token then
    return query select 'lost'::text, null::uuid, null::text;
    return;
  end if;
  -- The previous application version neither records an end nor reads a request: nothing is admitted before both cut-offs.
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
    perform private.release_takeoff_launch_evaluation(request.id, 'evaluating', null, null, null);
    return query select 'stale'::text, null::uuid, null::text;
    return;
  end if;
  select * into brief from public.affaire_briefs b where b.tenant_id = request.tenant_id and b.project_id = request.project_id;
  failure := case
    when not private.takeoff_module_enabled(request.tenant_id, p_module_default) then 'TAKEOFF_DISABLED'
    when request.payer_id is null or request.execution_host_id is null then 'MANDATE_REQUIRED'
    when request.origin = 'automatic' and brief.status is distinct from 'confirme' then 'BRIEF_NOT_CONFIRMED'
    when not private.takeoff_launch_payer_eligible(request.tenant_id, request.project_id, request.payer_id) then 'PAYER_NOT_ELIGIBLE'
    when exists (select 1 from public.takeoff_launch_requests other where other.tenant_id = request.tenant_id
      and other.project_id = request.project_id and other.state = 'admitted' and other.id <> request.id)
      or private.takeoff_unrequested_analysis_running(request.tenant_id, request.project_id) is not null then 'ANOTHER_ANALYSIS_RUNNING'
  end;
  if failure is not null then
    perform private.release_takeoff_launch_evaluation(request.id,
      case when failure = 'BRIEF_NOT_CONFIRMED' then 'not_eligible' else 'blocked' end, failure, null, p_mark);
    return query select 'blocked'::text, null::uuid, failure;
    return;
  end if;

  begin
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot, p_mark);
    admitted_jobs := private.insert_takeoff_launch_jobs(request, p_job);
    perform private.record_takeoff_launch_audit(request, request.payer_id, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', to_jsonb(admitted_jobs), 'manifest_digest', request.manifest_digest,
      'execution_host_id', request.execution_host_id, 'mandate_kind', request.mandate_kind)
      || case when request.manifest -> 'format_version' = '2'::jsonb then jsonb_build_object('format_version', 2) else '{}'::jsonb end);
    -- The final comparison, last of everything this admission locks: the dossier key exclusively, which each transaction
    -- that marks a change of the dossier holds shared until it commits. A change committed after the count above (an
    -- annex back to classification, a saved restriction) is counted here, and the admission rolls back with it.
    perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(request.project_id));
    if private.takeoff_launch_mark_position(request.tenant_id, request.project_id) <> p_mark then
      raise exception 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' using errcode = '40001';
    end if;
  exception
    when sqlstate '40001' then
      if sqlerrm <> 'TAKEOFF_LAUNCH_DOSSIER_CHANGED' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
    when unique_violation then
      -- Another request of the affaire was admitted between the check above and this one: it runs, this one waits.
      get stacked diagnostics violated = constraint_name;
      if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ANOTHER_ANALYSIS_RUNNING', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ANOTHER_ANALYSIS_RUNNING'::text;
      return;
    when sqlstate '23514' then
      if sqlerrm <> 'TAKEOFF_JOB_ADMISSION_LIMIT' then raise; end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'blocked', 'ADMISSION_LIMIT', null, p_mark);
      return query select 'blocked'::text, null::uuid, 'ADMISSION_LIMIT'::text;
      return;
    when sqlstate '42501' then
      -- A source that moved since the evaluation: evaluate the dossier again, nothing was admitted.
      if sqlerrm not in ('TAKEOFF_PREPARATION_SOURCE_STALE', 'TAKEOFF_PREPARATION_SOURCE_MISMATCH', 'TAKEOFF_PREPARATION_REQUIRED') then
        raise;
      end if;
      perform private.release_takeoff_launch_evaluation(p_request_id, 'evaluating', null, null, null);
      return query select 'stale'::text, null::uuid, null::text;
      return;
  end;
  return query select 'admitted'::text, admitted_jobs[1], null::text;
end;
$$;

-- 5. Explicit commands. The command of 20261121193413_takeoff_launch_exclusion_and_send_requests.sql (its refusals of an
-- automatic start that can still begin and of a second first analysis, the analysis outside any request that runs, the
-- analysis it replaces locked before the affaire's key), shared by both manual entry points: M4's command keeps its
-- signature and its identity (format 1, or format 2 of the plans of the member's preparation); a command of format 2 that
-- names its plans (« relancer ce plan », « lire ce plan ajouté ») has its own identity, the plans named included, so that
-- two commands on two plans never share a receipt. Its jobs are inserted in the order of their units, its answer names the
-- first unit's job and its admission record all of them.
create function private.launch_manual_takeoff_command(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_module_default boolean, p_digest text
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  running record;
  answer record;
  predecessor_request uuid;
  admitted_jobs uuid[];
  violated text;
  running_unrequested uuid;
  decided_mark bigint;
begin
  if p_intent not in ('initial', 'reread_plans') or p_intent_key is null or p_actor is null or p_plan_set_id is null
    or p_preparation_revision is null then
    raise exception 'TAKEOFF_LAUNCH_COMMAND_INVALID' using errcode = '22023';
  end if;
  if p_intent <> 'initial' and p_predecessor_job_id is null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_REQUIRED' using errcode = '22023';
  end if;
  if p_intent = 'initial' and p_predecessor_job_id is not null then
    raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
  end if;
  perform private.assert_takeoff_launch_selection(p_host, p_selection);
  if not private.takeoff_launch_active() then
    raise exception 'TAKEOFF_LAUNCH_INACTIVE' using errcode = '55000';
  end if;
  if not private.takeoff_module_enabled(p_tenant_id, p_module_default) then
    raise exception 'TAKEOFF_LAUNCH_MODULE_DISABLED' using errcode = '55000';
  end if;
  -- The analysis it replaces, when launched outside any request, before the affaire's key: its Mac's claim of a retry holds
  -- that row and then waits for the key (the restart guard of 20261121193413), while this command's request names it (a
  -- key share). Both take the analysis first, never the reverse. A request's analysis is never restarted that way.
  if p_predecessor_job_id is not null then
    perform 1 from public.takeoff_jobs j where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id
      and j.project_id = p_project_id and j.launch_request_id is null for key share;
  end if;
  -- Commands and reservations of one affaire are serialized on its key: the replay and the one-running rule read
  -- committed rows, and the automatic request a confirmation reserved is always found.
  perform private.lock_takeoff_launch_commands(p_project_id);
  for answer in select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key, p_digest) loop
    return query select answer.outcome, answer.request_id, answer.job_id;
    return;
  end loop;
  if p_predecessor_job_id is not null then
    select j.launch_request_id into predecessor_request from public.takeoff_jobs j
    where j.id = p_predecessor_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id;
    if not found then
      raise exception 'TAKEOFF_LAUNCH_PREDECESSOR_INVALID' using errcode = '22023';
    end if;
  end if;
  -- The affaire's automatic request is held before the one-running rule is read: its own admission either committed
  -- (it runs, the command is refused) or waits for this command, which then sets it aside.
  perform 1 from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic' for update;
  -- An automatic start that can still begin without a new dossier change (its eligible payer's Mac, or a gesture this
  -- member may make) is taken on from the affaire's takeoff zone: refused, nothing is recorded. One that waits for a
  -- dossier change or for nobody is set aside below by this explicit analysis.
  decided_mark := private.takeoff_launch_mark_position(p_tenant_id, p_project_id);
  if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
      and private.takeoff_automatic_request_can_start(r, p_actor)) then
    raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
  end if;
  -- The first analysis only on an affaire that has none, whatever launched it: any other command names the analysis it
  -- replaces or extends.
  if p_intent = 'initial' and exists (select 1 from public.takeoff_jobs j
      where j.tenant_id = p_tenant_id and j.project_id = p_project_id) then
    raise exception 'TAKEOFF_LAUNCH_ANALYSIS_EXISTS' using errcode = '22023';
  end if;
  select r.id, private.takeoff_launch_first_job(r.id) as job
  into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end if;
  -- An analysis launched outside any request (the dialogue's launch on a version, before the activation) that has not
  -- ended runs too: the command is recorded with it, as with a running request, and no request is created.
  running_unrequested := private.takeoff_unrequested_analysis_running(p_tenant_id, p_project_id);
  if running_unrequested is not null then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', null, running_unrequested, p_actor);
    return query select 'already_running'::text, null::uuid, running_unrequested;
    return;
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  begin
    insert into public.takeoff_launch_requests (tenant_id, project_id, origin, intent, intent_key, command_digest,
      predecessor_request_id, predecessor_job_id, state, payer_id, mandate_kind, mandated_at,
      execution_host_id, mandate_selection, mandate_revision)
    values (p_tenant_id, p_project_id, 'manual', p_intent, p_intent_key, p_digest, predecessor_request, p_predecessor_job_id,
      'evaluating', p_actor, 'command', pg_catalog.clock_timestamp(), p_host, p_selection, 1)
    returning * into request;
    request := private.seal_takeoff_launch_request(request, p_manifest, p_snapshot,
      private.takeoff_launch_mark_position(p_tenant_id, p_project_id));
    admitted_jobs := private.insert_takeoff_launch_jobs(request, p_job);
    perform private.record_takeoff_launch_audit(request, p_actor, 'takeoff.request.admitted', jsonb_build_object(
      'job_ids', to_jsonb(admitted_jobs), 'manifest_digest', request.manifest_digest, 'intent', p_intent,
      'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command')
      || case when request.manifest -> 'format_version' = '2'::jsonb then jsonb_build_object('format_version', 2) else '{}'::jsonb end);
    -- Before setting an automatic start aside: the dossier key exclusively, last of everything this command locks, as the
    -- automatic admission takes it. A dossier change committed since the decision above is counted, and a start it lets
    -- begin again is decided again, under the same lock: refused, nothing is recorded.
    if exists (select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
        and r.origin = 'automatic' and private.takeoff_launch_request_open(r)) then
      perform pg_catalog.pg_advisory_xact_lock(private.takeoff_dossier_lock_key(p_project_id));
      if private.takeoff_launch_mark_position(p_tenant_id, p_project_id) <> decided_mark and exists (
          select 1 from public.takeoff_launch_requests r where r.tenant_id = p_tenant_id and r.project_id = p_project_id
            and private.takeoff_automatic_request_can_start(r, p_actor)) then
        raise exception 'TAKEOFF_LAUNCH_AUTOMATIC_PENDING' using errcode = '55000';
      end if;
    end if;
    -- An automatic start that had not begun is set aside by this explicit analysis, for good: it never spends later.
    update public.takeoff_launch_requests r set state = 'superseded', reason_code = null,
      reason_details = jsonb_build_object('request_id', request.id), evaluation_lease_token = null, evaluation_lease_expires_at = null,
      mandate_revision = r.mandate_revision + 1
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.origin = 'automatic'
      and r.state in ('evaluating', 'not_eligible', 'blocked');
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'admitted', request.id, admitted_jobs[1], p_actor);
  exception when unique_violation then
    -- Another request of the affaire was admitted meanwhile (an automatic admission that did not wait): the command's
    -- receipt records that one.
    get stacked diagnostics violated = constraint_name;
    if violated is distinct from 'takeoff_launch_requests_running_uidx' then raise; end if;
    select r.id, private.takeoff_launch_first_job(r.id) as job
    into running from public.takeoff_launch_requests r
    where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
    return;
  end;
  return query select 'admitted'::text, request.id, admitted_jobs[1];
end;
$$;
revoke all on function private.launch_manual_takeoff_command(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, integer, boolean, text)
  from public, anon, authenticated, service_role;

create or replace function public.launch_manual_takeoff_request(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_job jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_module_default boolean default false
) returns table (outcome text, request_id uuid, job_id uuid)
language sql security definer set search_path = '' as $$
  select * from private.launch_manual_takeoff_command(p_tenant_id, p_project_id, p_actor, p_intent_key, p_intent,
    p_predecessor_job_id, p_host, p_selection, p_manifest, p_snapshot, p_job, p_plan_set_id, p_preparation_revision,
    p_module_default, private.takeoff_launch_command_digest(p_actor, p_intent, p_predecessor_job_id, p_plan_set_id,
      p_preparation_revision))
$$;

create function private.takeoff_launch_plan_command_digest(p_actor uuid, p_intent text, p_predecessor_job_id uuid,
  p_plan_set_id uuid, p_preparation_revision integer, p_plan_file_ids uuid[])
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(jsonb_build_array('takeoff-launch-command', 3, p_actor, p_intent,
    p_predecessor_job_id, p_plan_set_id, p_preparation_revision,
    (select coalesce(jsonb_agg(distinct p order by p), '[]'::jsonb) from unnest(p_plan_file_ids) p))::text, 'UTF8')), 'hex')
$$;
revoke all on function private.takeoff_launch_plan_command_digest(uuid, text, uuid, uuid, integer, uuid[]) from public, anon, authenticated, service_role;

create function public.replay_manual_takeoff_plan_request(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_plan_set_id uuid, p_preparation_revision integer, p_plan_file_ids uuid[]
) returns table (outcome text, request_id uuid, job_id uuid)
language sql stable security definer set search_path = '' as $$
  select * from private.replay_takeoff_launch_command(p_tenant_id, p_project_id, p_intent_key,
    private.takeoff_launch_plan_command_digest(p_actor, p_intent, p_predecessor_job_id, p_plan_set_id, p_preparation_revision,
      p_plan_file_ids))
$$;
revoke all on function public.replay_manual_takeoff_plan_request(uuid, uuid, uuid, uuid, text, uuid, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.replay_manual_takeoff_plan_request(uuid, uuid, uuid, uuid, text, uuid, uuid, integer, uuid[]) to service_role;

-- A command of format 2 on the plans it names: those plans, and only those, are its units.
create function public.launch_manual_takeoff_plan_request(
  p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_intent_key uuid, p_intent text, p_predecessor_job_id uuid,
  p_host text, p_selection jsonb, p_manifest jsonb, p_snapshot jsonb, p_jobs jsonb, p_plan_set_id uuid,
  p_preparation_revision integer, p_plan_file_ids uuid[], p_module_default boolean default false
) returns table (outcome text, request_id uuid, job_id uuid)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if p_manifest -> 'format_version' is distinct from '2'::jsonb or p_plan_file_ids is null
    or coalesce(array_length(p_plan_file_ids, 1), 0) = 0
    or (select array_agg(p::text order by p::text) from unnest(p_plan_file_ids) p)
      is distinct from (select array_agg(e.value ->> 'entry_key' order by e.value ->> 'entry_key')
        from jsonb_array_elements(p_manifest -> 'plans') e(value)) then
    raise exception 'TAKEOFF_LAUNCH_COMMAND_INVALID' using errcode = '22023';
  end if;
  return query select * from private.launch_manual_takeoff_command(p_tenant_id, p_project_id, p_actor, p_intent_key, p_intent,
    p_predecessor_job_id, p_host, p_selection, p_manifest, p_snapshot, p_jobs, p_plan_set_id, p_preparation_revision,
    p_module_default, private.takeoff_launch_plan_command_digest(p_actor, p_intent, p_predecessor_job_id, p_plan_set_id,
      p_preparation_revision, p_plan_file_ids));
end;
$$;
revoke all on function public.launch_manual_takeoff_plan_request(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, integer, uuid[], boolean)
  from public, anon, authenticated;
grant execute on function public.launch_manual_takeoff_plan_request(uuid, uuid, uuid, uuid, text, uuid, text, jsonb, jsonb, jsonb, jsonb, uuid, integer, uuid[], boolean)
  to service_role;

-- 6. The admission limits (20261022075204_bound_takeoff_job_admission.sql) count a request of plans as one analysis:
-- its first unit's insert and first claim are counted, its other units join them; their retries count. A request of
-- format 1 has one job and is counted as before; a job without a request too.
create or replace function public.enforce_takeoff_job_admission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz;
  v_tenant_daily bigint;
  v_user_daily bigint;
  v_tenant_active bigint;
  v_user_active bigint;
begin
  if new.status <> 'pending' then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-admission:' || new.tenant_id::text, 0)
  );
  v_now := pg_catalog.clock_timestamp();

  -- A later unit of a request already admitted joins its admission.
  if new.launch_request_id is null or not exists (
    select 1 from public.takeoff_job_admissions a join public.takeoff_jobs other on other.id = a.job_id
    where other.launch_request_id = new.launch_request_id and other.id <> new.id
  ) then
    select pg_catalog.count(distinct coalesce(j.launch_request_id, a.job_id)),
      pg_catalog.count(distinct coalesce(j.launch_request_id, a.job_id)) filter (where a.created_by = new.created_by)
    into v_tenant_daily, v_user_daily
    from public.takeoff_job_admissions a
    left join public.takeoff_jobs j on j.id = a.job_id
    where a.tenant_id = new.tenant_id
      and a.admitted_at > v_now - interval '24 hours';

    select pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)),
      pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)) filter (where j.created_by = new.created_by)
    into v_tenant_active, v_user_active
    from public.takeoff_jobs j
    where j.tenant_id = new.tenant_id
      and j.status in ('pending', 'processing');

    -- The inserted row is already visible in this AFTER trigger.
    if v_tenant_daily >= 40 or v_user_daily >= 10
      or v_tenant_active > 15 or v_user_active > 6
    then
      raise exception using
        errcode = '23514',
        message = 'TAKEOFF_JOB_ADMISSION_LIMIT';
    end if;
  end if;

  insert into public.takeoff_job_admissions
    (job_id, tenant_id, created_by, admitted_at)
  values (new.id, new.tenant_id, new.created_by, v_now);
  return null;
end;
$$;

create or replace function public.enforce_takeoff_job_reactivation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tenant_active bigint;
  v_user_active bigint;
begin
  if new.status <> 'pending' or old.status = 'pending' then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-admission:' || new.tenant_id::text, 0)
  );
  select pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)),
    pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)) filter (where j.created_by = new.created_by)
  into v_tenant_active, v_user_active
  from public.takeoff_jobs j
  where j.tenant_id = new.tenant_id
    and j.status in ('pending', 'processing');

  if v_tenant_active > 15 or v_user_active > 6 then
    raise exception using
      errcode = '23514',
      message = 'TAKEOFF_JOB_ADMISSION_LIMIT';
  end if;
  return null;
end;
$$;

create or replace function public.enforce_takeoff_processing_admission()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz;
  v_tenant_daily bigint;
  v_user_daily bigint;
  v_tenant_active bigint;
  v_user_active bigint;
begin
  if new.status <> 'processing' or old.status = 'processing' then
    return null;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('takeoff-admission:' || new.tenant_id::text, 0)
  );

  -- A failed job becoming processing occupies a new active slot, even when
  -- reconciliation reuses a previously admitted provider attempt.
  if old.status not in ('pending', 'processing') then
    select pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)),
      pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)) filter (where j.created_by = new.created_by)
    into v_tenant_active, v_user_active
    from public.takeoff_jobs j
    where j.tenant_id = new.tenant_id
      and j.status in ('pending', 'processing');

    if v_tenant_active > 15 or v_user_active > 6 then
      raise exception using
        errcode = '23514',
        message = 'TAKEOFF_JOB_ADMISSION_LIMIT';
    end if;
  end if;

  -- A failed batch can resume polling the same provider batch without
  -- sending another paid request. It retains the original retry count and
  -- processing admission; only a new attempt consumes another admission.
  if old.status = 'failed'
    and new.processing_strategy = 'batch'
    and new.provider_batch_id is not null
    and new.provider_batch_id is not distinct from old.provider_batch_id
    and new.retry_count = old.retry_count
  then
    return null;
  end if;

  v_now := pg_catalog.clock_timestamp();

  -- The first attempt of a later unit joins its request's first claim; every other attempt is counted.
  if new.launch_request_id is null or new.retry_count <> 0 or not exists (
    select 1 from public.takeoff_processing_admissions a join public.takeoff_jobs other on other.id = a.job_id
    where other.launch_request_id = new.launch_request_id and other.id <> new.id and a.attempt_number = 0
  ) then
    select pg_catalog.count(distinct case when j.launch_request_id is not null and a.attempt_number = 0
        then 'request:' || j.launch_request_id::text else 'attempt:' || a.job_id::text || ':' || a.attempt_number::text end),
      pg_catalog.count(distinct case when j.launch_request_id is not null and a.attempt_number = 0
        then 'request:' || j.launch_request_id::text else 'attempt:' || a.job_id::text || ':' || a.attempt_number::text end)
        filter (where a.created_by = new.created_by)
    into v_tenant_daily, v_user_daily
    from public.takeoff_processing_admissions a
    left join public.takeoff_jobs j on j.id = a.job_id
    where a.tenant_id = new.tenant_id
      and a.admitted_at > v_now - interval '24 hours';

    if v_tenant_daily >= 80 or v_user_daily >= 20 then
      raise exception using
        errcode = '23514',
        message = 'TAKEOFF_PROCESSING_ADMISSION_LIMIT';
    end if;
  end if;

  -- A second transition with the same attempt number must not trigger a
  -- second paid provider call without consuming another admission.
  insert into public.takeoff_processing_admissions
    (job_id, attempt_number, tenant_id, created_by, admitted_at)
  values (new.id, new.retry_count, new.tenant_id, new.created_by, v_now);
  return null;
end;
$$;

-- Whether a claim of this job would pass the admission limits now, counted exactly as the two triggers above count them
-- (a request of plans is one analysis: its first unit's first claim, the other units' first claims joining it; every
-- retry counts), on the database clock. The Mac's dispatcher and the hosted recovery ask it, so that a unit the triggers
-- would admit never waits for a turn M3's count of jobs (private.local_takeoff_claim_admissible) would never give it.
create function private.takeoff_job_claim_admissible(p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with job as (
    select j.id, j.tenant_id, j.created_by, j.status = 'failed' as from_failed,
      j.launch_request_id is not null and j.status = 'pending' and j.retry_count = 0 and exists (
        select 1 from public.takeoff_processing_admissions a join public.takeoff_jobs other on other.id = a.job_id
        where other.launch_request_id = j.launch_request_id and other.id <> j.id and a.attempt_number = 0) as joins
    from public.takeoff_jobs j where j.id = p_job_id
  )
  select
    -- A failed job that becomes active again counts itself among the active analyses.
    (not job.from_failed or (
      select pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)) <= 15
        and pg_catalog.count(distinct coalesce(j.launch_request_id, j.id)) filter (where j.created_by = job.created_by) <= 6
      from public.takeoff_jobs j
      where j.tenant_id = job.tenant_id and (j.status in ('pending', 'processing') or j.id = job.id)))
    and (job.joins or (
      select pg_catalog.count(distinct k.key) < 80 and pg_catalog.count(distinct k.key) filter (where k.created_by = job.created_by) < 20
      from (select a.created_by, case when j.launch_request_id is not null and a.attempt_number = 0
          then 'request:' || j.launch_request_id::text else 'attempt:' || a.job_id::text || ':' || a.attempt_number::text end as key
        from public.takeoff_processing_admissions a left join public.takeoff_jobs j on j.id = a.job_id
        where a.tenant_id = job.tenant_id and a.admitted_at > pg_catalog.clock_timestamp() - interval '24 hours') k))
  from job
$$;
revoke all on function private.takeoff_job_claim_admissible(uuid) from public, anon, authenticated, service_role;

-- 7. The slot of each authorised Mac: the one job its dispatcher reads now, held by that job's processing lease token
-- (its holder), with a generation that grows at each acquisition. It is taken with the job's claim, under the Mac's
-- lock and in the same transaction, renewed with the job's lease and given back by the job's end with the same token
-- (section 13). A slot whose holder's lease lapsed is free: the next claim takes it over. No foreign key: the slot
-- never takes a lock on takeoff_jobs.
create table private.takeoff_host_slots (
  host_id text primary key check (host_id ~ '^urn:uuid:[0-9a-f-]{36}$'),
  job_id uuid,
  holder_token uuid,
  generation bigint not null default 0 check (generation >= 0),
  acquired_at timestamptz,
  expires_at timestamptz,
  constraint takeoff_host_slots_holder_check check (
    (job_id is null) = (holder_token is null) and (holder_token is null) = (acquired_at is null)
    and (holder_token is null) = (expires_at is null)
  )
);
revoke all on private.takeoff_host_slots from public, anon, authenticated, service_role;

-- Whether another job holds the Mac now: its slot's holder, until that worker gives the slot back with its end or its
-- lease lapses (the slot's expiry follows the lease). A member's stop does not free it: the stopped worker's provider call
-- may still run.
create function private.takeoff_host_slot_busy(p_host_id text, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.takeoff_host_slots s
    where s.host_id = p_host_id and s.holder_token is not null and s.job_id is distinct from p_job_id
      and s.expires_at > pg_catalog.clock_timestamp()
  )
$$;
revoke all on function private.takeoff_host_slot_busy(text, uuid) from public, anon, authenticated, service_role;

-- Whether a plan of one analysis per plan is still at work on the Mac (waiting, read, or failed with a retry): while one
-- is, every claim and renewal of that Mac keeps to its slot, whatever the activation (a withdrawal included).
create function private.takeoff_host_plan_work(p_host_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.takeoff_jobs j where j.execution_host_id = p_host_id
    and j.launch_unit_key like 'plan:%' and j.analysis_outcome is null and j.status in ('pending', 'processing', 'failed'))
$$;
revoke all on function private.takeoff_host_plan_work(text) from public, anon, authenticated, service_role;

-- Whether the Mac reads another job now: the holder of its slot, or a job of the Mac still processing under a live lease
-- that never took the slot (claimed before the activation). A claim or a dispatch waits for either.
create function private.takeoff_host_busy(p_host_id text, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_host_slot_busy(p_host_id, p_job_id) or exists (
    select 1 from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id and j.id is distinct from p_job_id
      and j.status = 'processing' and j.processing_lease_expires_at > pg_catalog.clock_timestamp())
$$;
revoke all on function private.takeoff_host_busy(text, uuid) from public, anon, authenticated, service_role;


-- The application's claim (M3, 20261121020321), which takes the Mac's slot with the job, in one transaction under the
-- Mac's lock, for every job of one analysis per plan (whatever the activation: withdrawing it keeps one plan at a time for
-- the plans already admitted) and, from the activation on or while such a plan is at work on the Mac, for every job of
-- the Mac. The slot's row is the one point of
-- serialisation with a renewal of the job that holds it (section 13): it is locked and read after any renewal in flight
-- commits, so a lease renewed just before it lapsed keeps the Mac. The slot is taken before the job, then the job claimed;
-- a claim that finds nothing gives the slot back as it was.
create or replace function public.claim_observed_local_takeoff_job(
  p_job_id uuid, p_tenant_id uuid, p_host_id text, p_started_at timestamptz, p_lease_token uuid,
  p_lease_expires_at timestamptz, p_model text, p_prompt_version text,
  p_observed_status text, p_observed_retry_count integer
)
returns setof public.takeoff_jobs language plpgsql security definer set search_path = pg_catalog as $$
declare
  plan_unit boolean;
  slotted boolean;
  slot private.takeoff_host_slots%rowtype;
begin
  if p_observed_status is null or p_observed_status not in ('pending', 'failed') or p_observed_retry_count is null then
    raise exception 'TAKEOFF_LOCAL_CLAIM_INVALID' using errcode = '22023';
  end if;
  if p_host_id is not null then
    perform pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  end if;
  select j.launch_unit_key like 'plan:%' into plan_unit from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.status::text = p_observed_status and j.retry_count = p_observed_retry_count
  for update;
  if not found then return; end if;
  slotted := p_host_id is not null and (coalesce(plan_unit, false) or private.takeoff_plan_dispatch_active()
    or private.takeoff_host_plan_work(p_host_id));
  if slotted then
    insert into private.takeoff_host_slots (host_id) values (p_host_id) on conflict (host_id) do nothing;
    select * into slot from private.takeoff_host_slots s where s.host_id = p_host_id for update;
    -- Another plan is read on this Mac now: this one waits for its turn.
    if private.takeoff_host_busy(p_host_id, p_job_id) then return; end if;
    update private.takeoff_host_slots s set job_id = p_job_id, holder_token = p_lease_token, generation = s.generation + 1,
      acquired_at = clock_timestamp(), expires_at = p_lease_expires_at
    where s.host_id = p_host_id;
  end if;
  -- Planned per call: a session keeps working after a column joins the job row.
  return query execute 'select * from public.claim_local_takeoff_job($1, $2, $3, $4, $5, $6, $7, $8)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model, p_prompt_version;
  if not found and slotted then
    update private.takeoff_host_slots s set job_id = slot.job_id, holder_token = slot.holder_token, generation = slot.generation,
      acquired_at = slot.acquired_at, expires_at = slot.expires_at
    where s.host_id = p_host_id;
  end if;
end;
$$;

-- The worker's end of an attempt it held the Mac for, whatever ended the job (its own write, or a member's stop that made
-- its write refused): the slot is given back when its holder is this lease and no job still runs under it.
create function public.release_takeoff_host_slot(p_host_id text, p_lease_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  released boolean;
begin
  if p_host_id is null or p_lease_token is null then
    raise exception 'TAKEOFF_HOST_SLOT_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  update private.takeoff_host_slots s set job_id = null, holder_token = null, acquired_at = null, expires_at = null
  where s.host_id = p_host_id and s.holder_token = p_lease_token
    and not exists (select 1 from public.takeoff_jobs j where j.id = s.job_id and j.status = 'processing'
      and j.processing_lease_token = p_lease_token and j.processing_lease_expires_at > pg_catalog.clock_timestamp())
  returning true into released;
  return coalesce(released, false);
end;
$$;
revoke all on function public.release_takeoff_host_slot(text, uuid) from public, anon, authenticated;
grant execute on function public.release_takeoff_host_slot(text, uuid) to service_role;

-- 8. The ledger of a request's paid calls (M4's private.takeoff_launch_usage, keyed by job, attempt lease and call): a
-- call is reserved before it is sent, under the job's lock then the request's, and settled once after its answer. A
-- reservation holds its bound (the largest call the request observed on that branch, or the estimate the worker
-- gives) until it is settled; a call that ended without a known usage, or whose attempt ended first, stays held as
-- unknown: it is never credited back, and the balance a new call needs counts it. A row M4's settlement wrote is an
-- observed call.


-- The one rule before each paid call of any job: the module is on and its creator may still launch on its affaire.
create function private.takeoff_job_payment_refusal(p_job public.takeoff_jobs, p_module_default boolean)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.takeoff_module_enabled(p_job.tenant_id, p_module_default) then 'TAKEOFF_DISABLED'
    when not private.takeoff_launch_payer_eligible(p_job.tenant_id, p_job.project_id, p_job.created_by) then 'PAYER_NOT_ELIGIBLE'
  end
$$;
revoke all on function private.takeoff_job_payment_refusal(public.takeoff_jobs, boolean) from public, anon, authenticated, service_role;

-- Whether a request makes no further paid call: one of its calls ended without a known usage, or is still reserved by an
-- attempt whose lease ended (its worker died, before any recovery holds it as unknown). Either may have spent what is
-- left. (PL/pgSQL: the ledger's state is added in section 14.)
create function private.takeoff_launch_usage_frozen(p_request_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  return exists (select 1 from private.takeoff_launch_usage l where l.request_id = p_request_id and (l.state = 'unknown'
    or (l.state = 'reserved' and not exists (select 1 from public.takeoff_jobs j where j.id = l.job_id and j.status = 'processing'
      and j.processing_lease_token = l.lease_token and j.processing_lease_expires_at > pg_catalog.clock_timestamp()))));
end;
$$;
revoke all on function private.takeoff_launch_usage_frozen(uuid) from public, anon, authenticated, service_role;

-- M4's check, same signature and answers: the rule above, then a request's balance, of its unit for format 2.
create or replace function public.takeoff_job_may_pay(p_job_id uuid, p_module_default boolean default false)
returns table (reason text, remaining_tokens bigint, remaining_cost_cents bigint)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  job public.takeoff_jobs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  balance record;
begin
  select * into job from public.takeoff_jobs j where j.id = p_job_id;
  if not found then
    return;
  end if;
  if job.launch_request_id is null then
    return query select private.takeoff_job_payment_refusal(job, p_module_default), null::bigint, null::bigint;
    return;
  end if;
  select * into request from public.takeoff_launch_requests r where r.id = job.launch_request_id;
  select * into balance from private.takeoff_launch_job_balance(job, request);
  return query select coalesce(private.takeoff_job_payment_refusal(job, p_module_default),
      case when private.takeoff_launch_usage_frozen(request.id) then 'USAGE_UNKNOWN' end,
      case when balance.tokens_left <= 0 or balance.cost_left <= 0 then 'BUDGET_EXHAUSTED' end),
    balance.tokens_left, balance.cost_left;
end;
$$;

-- The worker's lease on the job, checked under the job's lock by the reservation and the settlement.
create function private.lock_takeoff_paying_job(p_job_id uuid, p_lease_token uuid)
returns public.takeoff_jobs language plpgsql security definer set search_path = '' as $$
declare
  job public.takeoff_jobs%rowtype;
begin
  select * into job from public.takeoff_jobs j where j.id = p_job_id for no key update;
  if not found or job.status::text <> 'processing' or p_lease_token is null or job.processing_lease_token is distinct from p_lease_token
    or job.processing_lease_expires_at is null or job.processing_lease_expires_at <= pg_catalog.clock_timestamp() then
    raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
  end if;
  return job;
end;
$$;
revoke all on function private.lock_takeoff_paying_job(uuid, uuid) from public, anon, authenticated, service_role;

-- Before a paid call is sent, with the credential in hand: the rule above; the Mac's slot is not another job's; for a
-- request's job, a positive balance counting what is held, and a reservation of the call. reserved: the call may be
-- sent (a replay of its key reserves nothing more); unbudgeted: a job without a request may pay (its own per-job budget
-- applies); wait: only this attempt's calls in flight hold the balance (one of them may give some back); refused: the
-- reason, nothing is sent.
create function public.reserve_takeoff_launch_call(p_job_id uuid, p_lease_token uuid, p_call_key text, p_branch text,
  p_estimate_tokens bigint, p_module_default boolean default false)
returns table (outcome text, reason text, reserved_tokens bigint, remaining_tokens bigint, remaining_cost_cents bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  job public.takeoff_jobs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  existing private.takeoff_launch_usage%rowtype;
  balance record;
  refusal text;
  bound bigint;
begin
  if p_call_key is null or length(p_call_key) not between 1 and 120 or p_branch not in ('pdf', 'vector_group', 'other')
    or p_estimate_tokens is null or p_estimate_tokens < 1 then
    raise exception 'TAKEOFF_LAUNCH_CALL_INVALID' using errcode = '22023';
  end if;
  job := private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  -- A plan of one analysis per plan pays only while it holds the Mac (its slot, under this very lease); another job of
  -- the Mac, from the activation on or while such a plan is at work on the Mac, only while no other job holds it.
  if job.launch_unit_key like 'plan:%' then
    if not exists (select 1 from private.takeoff_host_slots s where s.host_id = job.execution_host_id and s.job_id = job.id
        and s.holder_token = p_lease_token and s.expires_at > pg_catalog.clock_timestamp()) then
      raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
    end if;
  elsif job.execution_host_id is not null
    and (private.takeoff_plan_dispatch_active() or private.takeoff_host_plan_work(job.execution_host_id))
    and private.takeoff_host_slot_busy(job.execution_host_id, job.id) then
    raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
  end if;
  refusal := private.takeoff_job_payment_refusal(job, p_module_default);
  if refusal is not null then
    return query select 'refused'::text, refusal, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  if job.launch_request_id is null then
    return query select 'unbudgeted'::text, null::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  -- The job's row, then the request's: the order of every writer of both.
  select * into request from public.takeoff_launch_requests r where r.id = job.launch_request_id for update;
  -- Before the owner's activation of one analysis per plan, a call of a grouped analysis is checked as M4 checked it (its
  -- request's balance) and reserves nothing: its usage is recorded once answered, as before; nothing new is written.
  if not private.takeoff_plan_dispatch_active() and request.manifest -> 'format_version' is distinct from '2'::jsonb then
    select * into balance from private.takeoff_launch_job_balance(job, request);
    return query select case when balance.tokens_left > 0 and balance.cost_left > 0 then 'unreserved' else 'refused' end,
      case when balance.tokens_left > 0 and balance.cost_left > 0 then null else 'BUDGET_EXHAUSTED' end,
      null::bigint, balance.tokens_left, balance.cost_left;
    return;
  end if;
  -- A call of the request whose outcome is unknown freezes every further paid call of the request: it may have consumed
  -- what is left (a call still reserved by an attempt whose lease ended counts, before any recovery). A member's relaunch
  -- starts a new request.
  if private.takeoff_launch_usage_frozen(request.id) then
    return query select 'refused'::text, 'USAGE_UNKNOWN'::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  select * into existing from private.takeoff_launch_usage l
  where l.job_id = job.id and l.lease_token = p_lease_token and l.call_key = p_call_key;
  select * into balance from private.takeoff_launch_job_balance(job, request);
  if existing.job_id is not null then
    return query select case when existing.state = 'reserved' then 'reserved' else 'refused' end,
      case when existing.state = 'reserved' then null else 'CALL_ALREADY_SETTLED' end,
      existing.reserved_tokens, balance.tokens_left, balance.cost_left;
    return;
  end if;
  if balance.tokens_left > 0 and balance.cost_left > 0 then
    select greatest(p_estimate_tokens, coalesce(max(l.tokens), 0)) into bound from private.takeoff_launch_usage l
    where l.request_id = request.id and l.branch = p_branch and l.state = 'observed';
    insert into private.takeoff_launch_usage (job_id, lease_token, call_key, request_id, tokens, cost_cents, state, branch,
      reserved_tokens, reserved_at)
    values (job.id, p_lease_token, p_call_key, request.id, 0, 0, 'reserved', p_branch, bound, pg_catalog.clock_timestamp());
    return query select 'reserved'::text, null::text, bound, balance.tokens_left - bound, balance.cost_left;
    return;
  end if;
  if exists (select 1 from private.takeoff_launch_usage l where l.job_id = job.id and l.lease_token = p_lease_token
      and l.state = 'reserved') then
    return query select 'wait'::text, null::text, null::bigint, balance.tokens_left, balance.cost_left;
    return;
  end if;
  return query select 'refused'::text, 'BUDGET_EXHAUSTED'::text, null::bigint, balance.tokens_left, balance.cost_left;
end;
$$;
revoke all on function public.reserve_takeoff_launch_call(uuid, uuid, text, text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.reserve_takeoff_launch_call(uuid, uuid, text, text, bigint, boolean) to service_role;

-- M4's settlement, same signature: a reserved call becomes observed once, with the usage its answer carried; a call
-- without a reservation (the previous application version) is recorded observed as before. It returns what the job may
-- still spend (its unit's balance for format 2).
create or replace function public.record_takeoff_launch_usage(p_job_id uuid, p_lease_token uuid, p_call_key text, p_tokens bigint,
  p_cost_cents bigint)
returns table (remaining_tokens bigint, remaining_cost_cents bigint)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  job public.takeoff_jobs%rowtype;
  request public.takeoff_launch_requests%rowtype;
  v_tokens bigint := greatest(coalesce(p_tokens, 0), 0);
  v_cost bigint := greatest(coalesce(p_cost_cents, 0), 0);
  counted boolean;
  balance record;
begin
  -- The job row locked while its lease is checked: a claim, a renewal or an end cannot change it meanwhile.
  job := private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  if job.launch_request_id is null then
    return query select null::bigint, null::bigint;
    return;
  end if;
  update private.takeoff_launch_usage l set state = 'observed', tokens = v_tokens, cost_cents = v_cost,
    settled_at = pg_catalog.clock_timestamp()
  where l.job_id = p_job_id and l.lease_token = p_lease_token and l.call_key = p_call_key and l.state = 'reserved'
  returning true into counted;
  if counted is null then
    -- A call without a reservation (lot 2's writer, or this one before the activation): the row lot 2 writes.
    insert into private.takeoff_launch_usage (job_id, lease_token, call_key, request_id, tokens, cost_cents)
    values (p_job_id, p_lease_token, p_call_key, job.launch_request_id, v_tokens, v_cost)
    on conflict do nothing
    returning true into counted;
  end if;
  if counted then
    update public.takeoff_launch_requests r set tokens_observed = r.tokens_observed + v_tokens,
      cost_cents_observed = r.cost_cents_observed + v_cost
    where r.id = job.launch_request_id
    returning * into request;
  else
    select * into request from public.takeoff_launch_requests r where r.id = job.launch_request_id;
  end if;
  select * into balance from private.takeoff_launch_job_balance(job, request);
  return query select balance.tokens_left, balance.cost_left;
end;
$$;

-- A reserved call that ended without a known usage (no answer, an answer without one): it stays held, as unknown.
create function public.record_takeoff_launch_call_unknown(p_job_id uuid, p_lease_token uuid, p_call_key text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  marked boolean;
begin
  perform private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  update private.takeoff_launch_usage l set state = 'unknown', settled_at = pg_catalog.clock_timestamp()
  where l.job_id = p_job_id and l.lease_token = p_lease_token and l.call_key = p_call_key and l.state = 'reserved'
  returning true into marked;
  return coalesce(marked, false);
end;
$$;
revoke all on function public.record_takeoff_launch_call_unknown(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.record_takeoff_launch_call_unknown(uuid, uuid, text) to service_role;

-- The worker's end of an attempt on a failure (M3, 20261121011212_takeoff_analysis_completion.sql), same signature: its
-- retry decision is the worker's, except after a call of unknown outcome.
create or replace function public.record_local_takeoff_failure(
  p_job_id uuid, p_tenant_id uuid, p_lease_token uuid, p_failure jsonb,
  p_diagnostic jsonb default null, p_run_metrics jsonb default null
)
returns jsonb language plpgsql security definer set search_path = pg_catalog as $$
declare
  failure public.takeoff_jobs := jsonb_populate_record(null::public.takeoff_jobs, p_failure);
  diagnostic public.takeoff_results;
  diagnostic_id uuid;
  caller_lock_timeout text := current_setting('lock_timeout');
  recorded_code text;
  recorded_message text;
  recorded_retry boolean;
begin
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id and j.status = 'processing'
    and j.execution_provider = 'chatgpt_local' and j.processing_lease_token = p_lease_token
  for update;
  if not found then return null; end if;

  if not exists (select 1 from public.takeoff_jobs j where j.id = p_job_id
      and j.processing_lease_expires_at > clock_timestamp()) then
    return null;
  end if;

  -- The diagnostic stays best effort, as it was: if it cannot be stored, the
  -- previous rows stay whole and the failure is still recorded. It never waits
  -- on a held row (lock_not_available) and a statement timeout inside it is
  -- trapped, so the retry-or-terminal decision below does not depend on it.
  perform set_config('lock_timeout', '2s', true);
  if p_diagnostic is not null then
    begin
      diagnostic := jsonb_populate_record(null::public.takeoff_results, p_diagnostic);
      delete from public.takeoff_run_metrics where job_id = p_job_id and tenant_id = p_tenant_id;
      delete from public.takeoff_items where job_id = p_job_id and tenant_id = p_tenant_id;
      delete from public.takeoff_results where job_id = p_job_id and tenant_id = p_tenant_id;
      insert into public.takeoff_results (tenant_id, job_id, extracted_json, warnings, tables, provider_meta, raw_response,
        token_count, cost_cents, duration_ms)
      values (p_tenant_id, p_job_id, diagnostic.extracted_json, diagnostic.warnings, diagnostic.tables, diagnostic.provider_meta,
        diagnostic.raw_response, diagnostic.token_count, diagnostic.cost_cents, diagnostic.duration_ms)
      returning id into diagnostic_id;
    exception when others or query_canceled then
      diagnostic_id := null;
      raise log 'takeoff.failure.diagnostic_persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;

  if jsonb_typeof(p_run_metrics) = 'array' and jsonb_array_length(p_run_metrics) > 0 then
    begin
      insert into public.takeoff_run_metrics (
        tenant_id, job_id, result_id, level, provider, model, chunk_index, chunk_start_page, chunk_end_page,
        input_tokens, reasoning_tokens, output_tokens, total_tokens, cost_cents, duration_ms, timed_out,
        budget_exceeded, metadata
      )
      select p_tenant_id, p_job_id, diagnostic_id, m.level, m.provider, m.model, m.chunk_index,
        m.chunk_start_page, m.chunk_end_page, m.input_tokens, m.reasoning_tokens, m.output_tokens,
        m.total_tokens, m.cost_cents, m.duration_ms, m.timed_out, m.budget_exceeded, m.metadata
      from jsonb_populate_recordset(null::public.takeoff_run_metrics, p_run_metrics) m;
    exception when others or query_canceled then
      raise log 'takeoff.failure.metrics_persistence_failed job=% code=%', p_job_id, sqlstate;
    end;
  end if;
  perform set_config('lock_timeout', caller_lock_timeout, true);

  -- An attempt that holds a paid call of unknown outcome (still reserved when it ends, or ended without its usage) is
  -- never retried on its own: the retry would send that call again. Its unit ends with that reason; a member may relaunch
  -- it. Only a call reserved from the activation of one analysis per plan on can be held. Read in the update itself, after
  -- its lock on the job: the job first, then the ledger, as every writer of both.
  update public.takeoff_jobs j set
    status = 'failed', completed_at = failure.completed_at, duration_ms = failure.duration_ms,
    error_code = case when held.unknown then 'TAKEOFF_USAGE_UNRECORDED' else failure.error_code end,
    error_message = case when held.unknown
      then 'Un appel de cette analyse s’est terminé sans consommation connue : elle s’arrête sans le renvoyer. Relancez-la depuis les options du métré.'
      else failure.error_message end,
    analysis_outcome = case when held.unknown then 'failure' else failure.analysis_outcome end,
    last_error_at = failure.last_error_at,
    next_retry_at = case when held.unknown then null else failure.next_retry_at end,
    processing_lease_token = null, processing_lease_expires_at = null
  from (select failure.next_retry_at is not null and exists (select 1 from private.takeoff_launch_usage l
      where l.job_id = p_job_id and l.lease_token = p_lease_token and l.state in ('reserved', 'unknown')) as unknown) held
  where j.id = p_job_id and j.tenant_id = p_tenant_id
  returning j.error_code, j.error_message, j.next_retry_at is not null into recorded_code, recorded_message, recorded_retry;
  -- What was recorded, for the worker's audit (the previous application version reads the diagnostic only).
  return jsonb_build_object('diagnostic_id', diagnostic_id, 'error_code', recorded_code, 'error_message', recorded_message,
    'retry_scheduled', recorded_retry);
end;
$$;

-- 9. The end of a request, recomputed from its units' jobs at each unit's end (M4 counted increments): the same answer
-- for a settlement, a replay or a reconciliation, never two notices (the request's completion event is set once).
-- success: every unit read; failure: none read and at least one failed or closed before its start; partial: some read
-- and some not; canceled: every unit stopped by a member before it was read.
create function private.close_takeoff_launch_request(p_request_id uuid, p_at timestamptz, p_last_error text)
returns void language plpgsql security definer set search_path = pg_catalog as $$
declare
  request public.takeoff_launch_requests%rowtype;
  counts record;
  plans integer;
  read_count integer;
  failed_count integer;
  not_started_count integer;
  recipient uuid;
  logical_email text;
  initial_state text := 'unavailable';
  failure_code text;
begin
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if not found or request.state <> 'admitted' or request.manifest -> 'format_version' is distinct from '2'::jsonb then
    return;
  end if;
  select count(*) as jobs,
    count(*) filter (where s.state = 'succeeded') as succeeded, count(*) filter (where s.state = 'failed') as failed,
    count(*) filter (where s.state = 'canceled') as canceled, count(*) filter (where s.state = 'not_started') as not_started,
    bool_or(s.error_code = 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED') as budget_closed,
    (array_agg(s.error_code order by s.finished_at desc nulls last) filter (where s.state in ('failed', 'not_started')))[1] as last_failure
  into counts
  from (select private.takeoff_unit_state(j.status::text, j.analysis_outcome, j.error_code, j.started_at) as state,
      j.error_code, j.analysis_finished_at as finished_at
    from public.takeoff_jobs j where j.launch_request_id = request.id) s;
  update public.takeoff_launch_requests r set units_succeeded = counts.succeeded, units_failed = counts.failed,
    units_canceled = counts.canceled, units_not_started = counts.not_started
  where r.id = request.id
  returning * into request;
  if counts.jobs < request.units_expected
    or counts.succeeded + counts.failed + counts.canceled + counts.not_started < request.units_expected then
    return;
  end if;
  update public.takeoff_launch_requests r set state = 'closed', closed_at = coalesce(p_at, pg_catalog.clock_timestamp()),
    completion_event_id = gen_random_uuid(),
    reason_code = case
      when r.stop_requested_at is not null and counts.canceled > 0 then 'STOPPED_BY_MEMBER'
      when counts.budget_closed or (r.manifest -> 'format_version' is distinct from '2'::jsonb
        and p_last_error in ('TAKEOFF_REQUEST_BUDGET_EXHAUSTED', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED')) then 'BUDGET_EXHAUSTED' end,
    outcome = case
      when counts.succeeded = r.units_expected then 'success'
      when counts.succeeded = 0 and counts.failed + counts.not_started = 0 then 'canceled'
      when counts.succeeded = 0 then 'failure'
      else 'partial' end
  where r.id = request.id
  returning * into request;

  -- From the notices' cut-off on, as for a job: one notice and one e-mail to the request's payer.
  if not exists (select 1 from private.takeoff_completion_activation a where request.closed_at >= a.active_from) then
    return;
  end if;
  -- The counts of plans: format 1 has one unit holding every plan; format 2, one plan per unit.
  plans := jsonb_array_length(request.manifest -> 'plans');
  if request.manifest -> 'format_version' = '2'::jsonb then
    read_count := counts.succeeded;
    failed_count := counts.failed;
    not_started_count := counts.not_started;
  else
    read_count := case when counts.succeeded > 0 then plans else 0 end;
    failed_count := case when counts.failed > 0 then plans else 0 end;
    not_started_count := case when counts.not_started > 0 then plans else 0 end;
  end if;
  failure_code := coalesce(p_last_error, counts.last_failure);
  -- The member who pays receives the end: the confirmer, who took it on, or who clicked.
  recipient := request.payer_id;
  if request.outcome = 'canceled' then
    initial_state := 'suppressed';
  elsif recipient is not null and private.takeoff_completion_recipient_can_read(request.tenant_id, request.project_id, recipient) then
    select nullif(trim(u.email), '') into logical_email from auth.users u
      where u.id = recipient and u.email_confirmed_at is not null and u.deleted_at is null;
    if logical_email is not null then
      initial_state := 'pending';
    end if;
  end if;
  insert into public.takeoff_completion_notifications (
    id, tenant_id, project_id, subject_kind, request_id, recipient_user_id, outcome, finished_at,
    plans_read_count, plans_failed_count, plans_not_started_count,
    recipient_email, delivery_state, provider_key, next_attempt_at, last_delivery_code, reason_code
  ) values (
    request.completion_event_id, request.tenant_id, request.project_id, 'request', request.id, recipient, request.outcome,
    request.closed_at, read_count, failed_count, not_started_count,
    logical_email, initial_state,
    'takeoff-completion/' || request.tenant_id::text || '/request/' || request.id::text || '/'
      || coalesce(recipient::text, 'unavailable'),
    case when initial_state = 'pending' then request.closed_at end,
    case when initial_state = 'unavailable' then 'RECIPIENT_UNAVAILABLE' end,
    -- The notices keep M3's public codes (their constraint); a plan's own reason is told on the plan, in the activity.
    case when request.outcome = 'failure' and failure_code = any (private.takeoff_public_failure_codes()) then failure_code end
  );
end;
$$;
revoke all on function private.close_takeoff_launch_request(uuid, timestamptz, text) from public, anon, authenticated, service_role;

-- M4's trigger on the recorded end of a unit (20261121170448_takeoff_launch_requests.sql): one analysis per plan through
-- the recomputation above; a grouped request (format 1) by M4's own statements, unchanged.
create or replace function private.settle_takeoff_launch_request()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare
  request public.takeoff_launch_requests%rowtype;
  ended integer;
  plans integer;
  recipient uuid;
  logical_email text;
  initial_state text := 'unavailable';
  not_started boolean := new.error_code in ('TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_QUEUE_EXPIRED', 'TAKEOFF_WORKER_HOST_SILENT');
begin
  -- One analysis per plan: the recomputation above, from its units' jobs.
  if exists (select 1 from public.takeoff_launch_requests r where r.id = new.launch_request_id
      and r.manifest -> 'format_version' = '2'::jsonb) then
    perform private.close_takeoff_launch_request(new.launch_request_id, new.analysis_finished_at, new.error_code);
    return null;
  end if;
  -- Lot 2's request (format 1), settled exactly as M4 settles it.
  select * into request from public.takeoff_launch_requests r where r.id = new.launch_request_id for update;
  if not found or request.state <> 'admitted' then
    return null;
  end if;
  update public.takeoff_launch_requests r set
    units_succeeded = r.units_succeeded + (new.analysis_outcome = 'success')::integer,
    units_failed = r.units_failed + (new.analysis_outcome = 'failure')::integer,
    units_canceled = r.units_canceled + (new.analysis_outcome = 'canceled')::integer
  where r.id = request.id
  returning * into request;
  ended := request.units_succeeded + request.units_failed + request.units_canceled;
  if ended < request.units_expected then
    return null;
  end if;
  update public.takeoff_launch_requests r set state = 'closed', closed_at = new.analysis_finished_at,
    completion_event_id = gen_random_uuid(),
    reason_code = case when new.error_code in ('TAKEOFF_REQUEST_BUDGET_EXHAUSTED', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED')
      then 'BUDGET_EXHAUSTED' end,
    outcome = case
      when r.units_succeeded = r.units_expected then 'success'
      when r.units_failed = r.units_expected then 'failure'
      when r.units_canceled = r.units_expected then 'canceled'
      else 'partial' end
  where r.id = request.id
  returning * into request;

  -- From the notices' cut-off on, as for a job: one notice and one e-mail to the request's payer.
  if not exists (select 1 from private.takeoff_completion_activation a where request.closed_at >= a.active_from) then
    return null;
  end if;
  -- The member who pays receives the end: the confirmer, who took it on, or who clicked.
  recipient := request.payer_id;
  plans := jsonb_array_length(request.manifest -> 'plans');
  if request.outcome = 'canceled' then
    initial_state := 'suppressed';
  elsif recipient is not null and private.takeoff_completion_recipient_can_read(request.tenant_id, request.project_id, recipient) then
    select nullif(trim(u.email), '') into logical_email from auth.users u
      where u.id = recipient and u.email_confirmed_at is not null and u.deleted_at is null;
    if logical_email is not null then
      initial_state := 'pending';
    end if;
  end if;
  insert into public.takeoff_completion_notifications (
    id, tenant_id, project_id, subject_kind, request_id, recipient_user_id, outcome, finished_at,
    plans_read_count, plans_failed_count, plans_not_started_count,
    recipient_email, delivery_state, provider_key, next_attempt_at, last_delivery_code, reason_code
  ) values (
    request.completion_event_id, request.tenant_id, request.project_id, 'request', request.id, recipient, request.outcome,
    request.closed_at,
    case when request.outcome = 'success' then plans else 0 end,
    case when request.outcome = 'failure' and not not_started then plans else 0 end,
    case when request.outcome = 'failure' and not_started then plans else 0 end,
    logical_email, initial_state,
    'takeoff-completion/' || request.tenant_id::text || '/request/' || request.id::text || '/'
      || coalesce(recipient::text, 'unavailable'),
    case when initial_state = 'pending' then request.closed_at end,
    case when initial_state = 'unavailable' then 'RECIPIENT_UNAVAILABLE' end,
    case when request.outcome = 'failure' and new.error_code = any (private.takeoff_public_failure_codes())
      then new.error_code end
  );
  return null;
end;
$$;

-- A request of one analysis per plan whose units have all ended but which is still open (an end recorded while its
-- trigger could not settle it): the same recomputation, without any AI call; idempotent. A grouped request is settled by
-- its job's end only, as in lot 2.
create function public.reconcile_takeoff_launch_requests(p_limit integer default 20)
returns table (request_id uuid, state text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  candidate uuid;
begin
  for candidate in
    select r.id from public.takeoff_launch_requests r
    where r.state = 'admitted' and r.manifest -> 'format_version' = '2'::jsonb
      and r.units_expected = (select count(*) from public.takeoff_jobs j where j.launch_request_id = r.id)
      and not exists (select 1 from public.takeoff_jobs j where j.launch_request_id = r.id
        and private.takeoff_unit_state(j.status::text, j.analysis_outcome, j.error_code, j.started_at) in ('queued', 'running'))
    order by r.admitted_at, r.id
    limit greatest(1, least(coalesce(p_limit, 20), 100))
  loop
    perform private.close_takeoff_launch_request(candidate, null, null);
    return query select r.id, r.state from public.takeoff_launch_requests r where r.id = candidate;
  end loop;
end;
$$;
revoke all on function public.reconcile_takeoff_launch_requests(integer) from public, anon, authenticated;
grant execute on function public.reconcile_takeoff_launch_requests(integer) to service_role;

-- 10. M3's trigger on the end of an analysis (20261121020321), with one change for a plan of one analysis per plan only:
-- failed with its technical retry still to run, a member's stop cancels it with its outcome (a pending or processing job
-- only could be). Every other job keeps M3's rule.
create or replace function private.set_takeoff_analysis_outcome()
returns trigger
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  finished_at timestamptz := clock_timestamp();
  writer_role text := coalesce(nullif(current_setting('role', true), 'none'), session_user::text);
  worker_write boolean := writer_role in ('service_role', 'postgres');
  activated boolean := exists (select 1 from private.takeoff_completion_activation a where a.active_from <= finished_at);
  host_work boolean;
begin
  if tg_op = 'INSERT' then
    if new.analysis_outcome is not null or new.analysis_finished_at is not null
      or new.analysis_completion_event_id is not null or new.analysis_requested_by is not null
      or new.analysis_queued_at is not null then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.analysis_requested_by is distinct from old.analysis_requested_by then
    raise exception 'TAKEOFF_ANALYSIS_REQUESTER_RESERVED' using errcode = '42501';
  end if;
  new.analysis_queued_at := old.analysis_queued_at;
  -- The Mac's own work: a claim, a lease renewal, or an end it wrote (not a closure by the recovery).
  host_work := new.execution_provider = 'chatgpt_local' and worker_write and (
    (old.status is distinct from 'processing' and new.status = 'processing')
    or (old.status = 'processing' and new.status = 'processing'
      and new.processing_lease_expires_at is distinct from old.processing_lease_expires_at)
    or (old.status = 'processing' and new.status in ('completed', 'failed')
      and new.error_code is distinct from 'TAKEOFF_WORKER_OUTCOME_UNKNOWN'));

  if old.status in ('failed', 'canceled') and new.status = 'pending' then
    -- Only the member who launched a job sends it back to pending: its analysis runs on the launcher's own
    -- subscription. A deliberate change, effective before activation too. The worker's retries (failed to
    -- processing) and the service role are not concerned.
    if writer_role = 'authenticated' and old.created_by is distinct from (select auth.uid()) then
      raise exception 'TAKEOFF_RELAUNCH_LAUNCHER_ONLY' using errcode = '42501';
    end if;
    new.analysis_queued_at := finished_at;
    -- This trigger runs after the existing authenticated reset allowlist.
    -- Attribute the accepted reset from its own session, not its payload.
    if writer_role = 'authenticated' then
      new.analysis_requested_by := (select auth.uid());
    end if;
  end if;

  -- The deployed pre-M3 writers retain their behavior before activation.
  if not activated and old.analysis_outcome is null then
    new.analysis_outcome := null;
    new.analysis_finished_at := old.analysis_finished_at;
    new.analysis_completion_event_id := old.analysis_completion_event_id;
    return new;
  end if;

  if old.execution_provider = 'chatgpt_local' and old.status = 'failed'
    and old.next_retry_at is not null and new.status = 'pending'
  then
    raise exception 'TAKEOFF_ANALYSIS_RETRY_SCHEDULED' using errcode = '23514';
  end if;
  if old.execution_provider = 'chatgpt_local' and old.status = 'failed' and new.status = 'processing'
    and (old.analysis_outcome is not null or old.next_retry_at > finished_at
      or old.retry_count >= 3)
  then
    return null;
  end if;
  if new.analysis_finished_at is distinct from old.analysis_finished_at
    or new.analysis_completion_event_id is distinct from old.analysis_completion_event_id
    or (new.analysis_outcome is distinct from old.analysis_outcome and (
      not worker_write or old.analysis_outcome is not null or new.analysis_outcome is distinct from 'failure'
      or new.status <> 'failed' or (
        old.status not in ('pending', 'processing') and not (
          -- The recovery closes a due retry that nobody took, that waited past the ceiling, or whose Mac was silent.
          old.status = 'failed' and old.next_retry_at is not null and new.next_retry_at is null
          and new.error_code in ('TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_QUEUE_EXPIRED', 'TAKEOFF_WORKER_HOST_SILENT')
        )
      )
    ))
  then
    raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
  end if;

  if new.status = 'canceled' and (old.status in ('pending', 'processing')
    or (old.status = 'failed' and old.analysis_outcome is null and new.next_retry_at is null
      and old.launch_unit_key like 'plan:%')) then
    new.analysis_outcome := 'canceled';
  elsif old.execution_provider = 'chatgpt_local' and old.status = 'processing'
    and new.status in ('completed', 'failed') then
    if not worker_write then
      raise exception 'TAKEOFF_ANALYSIS_FIELDS_RESERVED' using errcode = '42501';
    end if;
    if new.status = 'failed' and new.analysis_outcome = 'failure'
      and new.error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN' then
      -- Recovery has already verified staleness in its UPDATE predicate.
      null;
    elsif old.processing_lease_token is null or old.processing_lease_expires_at <= finished_at then
      raise exception 'TAKEOFF_ANALYSIS_LEASE_EXPIRED' using errcode = '23514';
    end if;
    if new.status = 'completed' then
      new.analysis_outcome := 'success';
    end if;
  end if;

  if new.analysis_outcome is distinct from old.analysis_outcome then
    new.analysis_finished_at := finished_at;
    -- M4 supplies the parent FK. Child jobs still record an outcome, and the
    -- request finalizer will allocate its own event after all children settle.
    if to_jsonb(new) ->> 'launch_request_id' is null then
      new.analysis_completion_event_id := gen_random_uuid();
    end if;
  end if;
  -- Only once the cutoff is set: before it, no write of a job touches another table.
  if host_work and activated then
    insert into private.takeoff_local_job_work as w (job_id, host_id, worked_at)
    values (new.id, new.execution_host_id, finished_at)
    on conflict (job_id) do update set worked_at = greatest(w.worked_at, excluded.worked_at);
  end if;
  return new;
end;
$$;

-- 11. Stop the rest of a request: every unit not read yet is cancelled (a reading in progress cannot commit later, its
-- lease being refused), the units read stay; the request closes when its last unit ends, as partial when some plan was
-- read (its notice and e-mail tell « N plans disponibles, M arrêtés à votre demande »), cancelled when none was (no
-- e-mail). Who may launch on the affaire may stop. The request is read first: a stop of a request that has ended answers
-- at once and takes no lock. Then its jobs are held in identifier order, then the request is locked and read again: the
-- order of every writer of both (a job's end writes its job, then its request). The jobs are held « for no key update »,
-- as the stop only writes their state: a reread naming one of them (its new request's foreign key, a key share, under the
-- affaire's automatic request) does not wait for the stop, so the two never wait for each other.
create function public.stop_takeoff_launch_request(p_tenant_id uuid, p_project_id uuid, p_actor uuid, p_request_id uuid)
returns table (outcome text, request_state text, canceled_units integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  request public.takeoff_launch_requests%rowtype;
  stopped uuid[];
  actor_role public.tenant_role;
begin
  if p_actor is null or p_request_id is null then
    raise exception 'TAKEOFF_LAUNCH_STOP_INVALID' using errcode = '22023';
  end if;
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_actor) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  select * into request from public.takeoff_launch_requests r
  where r.id = p_request_id and r.tenant_id = p_tenant_id and r.project_id = p_project_id;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state <> 'admitted' then
    return query select 'not_running'::text, request.state, 0;
    return;
  end if;
  perform 1 from public.takeoff_jobs j where j.launch_request_id = p_request_id and j.tenant_id = p_tenant_id
  order by j.id for no key update;
  select * into request from public.takeoff_launch_requests r where r.id = p_request_id for update;
  if request.state <> 'admitted' then
    return query select 'not_running'::text, request.state, 0;
    return;
  end if;
  -- A grouped analysis (lot 2) is one reading: it is cancelled as a job, never stopped by plan.
  if request.manifest -> 'format_version' is distinct from '2'::jsonb then
    raise exception 'TAKEOFF_LAUNCH_STOP_GROUPED' using errcode = '22023';
  end if;
  update public.takeoff_launch_requests r set stop_requested_at = coalesce(r.stop_requested_at, pg_catalog.clock_timestamp()),
    stop_requested_by = coalesce(r.stop_requested_by, p_actor)
  where r.id = request.id;
  select m.role into actor_role from public.tenant_memberships m where m.tenant_id = p_tenant_id and m.user_id = p_actor;
  with canceled as (
    update public.takeoff_jobs j set status = 'canceled', completed_at = pg_catalog.clock_timestamp(), next_retry_at = null,
      error_code = null, error_message = null
    where j.launch_request_id = request.id and j.analysis_outcome is null and j.status in ('pending', 'processing', 'failed')
    returning j.id, j.tenant_id, j.estimate_version_id
  ), audited as (
    insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
    select c.tenant_id, p_actor, 'takeoff_jobs', c.id, c.estimate_version_id, 'takeoff.job.canceled',
      jsonb_build_object('schema_version', 1, 'action', 'takeoff.job.canceled', 'job_id', c.id, 'tenant_id', c.tenant_id,
        'user_id', p_actor, 'metadata', jsonb_build_object('status', 'canceled', 'reason', 'request_stopped',
          'canceled_by', case when actor_role = 'admin' then 'admin' else 'user' end, 'launch_request_id', request.id))
    from canceled c
    returning record_id
  )
  select coalesce(array_agg(record_id), '{}') into stopped from audited;
  select * into request from public.takeoff_launch_requests r where r.id = request.id;
  return query select 'stopped'::text, request.state, coalesce(array_length(stopped, 1), 0);
end;
$$;
revoke all on function public.stop_takeoff_launch_request(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.stop_takeoff_launch_request(uuid, uuid, uuid, uuid) to service_role;

-- 12. The dispatcher of each authorised Mac: the next job it reads, once its slot is free, under the Mac's lock. The
-- oldest eligible request first (its admission), its units in their recorded order, then by identifier; a unit waiting
-- for a later retry never holds the others back; a job of a tenant whose limits refuse its claim now waits its turn.
-- A unit of a request whose budget is spent before its turn is closed, never started, with that reason. Before the
-- activation it answers nothing: the Mac's poller keeps its former order.
create function public.dispatch_next_takeoff_host_job(p_host_id text, p_module_default boolean default false)
returns table (job_id uuid, trigger_kind text, next_due_at timestamptz, closed_jobs uuid[])
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  candidate record;
  closed uuid[] := '{}';
  balance record;
  due timestamptz;
  active boolean;
begin
  if p_host_id is null or p_host_id !~ '^urn:uuid:[0-9a-f-]{36}$' then
    raise exception 'TAKEOFF_DISPATCH_INVALID' using errcode = '22023';
  end if;
  active := private.takeoff_plan_dispatch_active();
  -- Withdrawn, it still serves the plans of one analysis per plan already admitted, one at a time; with none, it answers
  -- nothing (the Mac keeps its former order).
  if not active and not private.takeoff_host_plan_work(p_host_id) then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  select min(j.next_retry_at) into due from public.takeoff_jobs j
  where j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id and j.analysis_outcome is null
    and j.status = 'failed' and j.retry_count < 3 and j.next_retry_at > pg_catalog.clock_timestamp();
  if private.takeoff_host_busy(p_host_id, null) then
    return query select null::uuid, null::text, due, closed;
    return;
  end if;
  for candidate in
    select j.*, r.manifest as request_manifest from public.takeoff_jobs j
    join public.tenants t on t.id = j.tenant_id and t.is_active
    left join public.takeoff_launch_requests r on r.id = j.launch_request_id
    where j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id and j.provider_batch_id is null
      and j.analysis_outcome is null
      -- A retry past the wait ceiling is only closed by its recovery, never run (20261121193413's floor, as the Mac's poll).
      and (j.status = 'pending' or (j.status = 'failed' and j.retry_count < 3 and j.next_retry_at <= pg_catalog.clock_timestamp()
        and j.next_retry_at > coalesce(private.takeoff_retry_expiry_floor(), '-infinity'::timestamptz)))
      and (j.launch_request_id is null or r.state = 'admitted')
      and (active or j.launch_unit_key like 'plan:%')
      and private.takeoff_module_enabled(j.tenant_id, p_module_default)
      -- A pending job whose creation has not finished may still be withdrawn: its record says it was admitted.
      and (j.status <> 'pending' or exists (select 1 from public.audit_logs a where a.tenant_id = j.tenant_id
        and a.table_name = 'takeoff_jobs' and a.action = 'takeoff.job.created' and a.record_id = j.id
        and a.created_at >= j.created_at))
    order by coalesce(r.admitted_at, j.analysis_queued_at, j.created_at),
      (private.takeoff_launch_unit(r.manifest, j.launch_unit_key) ->> 'ordinal')::integer nulls first, j.id
    for update of j skip locked
  loop
    if candidate.launch_request_id is not null and candidate.status = 'pending' and candidate.started_at is null then
      -- A request with a call of unknown outcome makes no further paid call: its plans not started are closed so.
      if private.takeoff_launch_usage_frozen(candidate.launch_request_id) then
        update public.takeoff_jobs j set status = 'failed', completed_at = pg_catalog.clock_timestamp(), next_retry_at = null,
          last_error_at = pg_catalog.clock_timestamp(), error_code = 'TAKEOFF_USAGE_UNRECORDED',
          error_message = 'Un appel de cette analyse s’est terminé sans consommation connue : ce plan n’a pas été lu. Relancez-le depuis les options du métré.',
          analysis_outcome = 'failure'
        where j.id = candidate.id;
        closed := closed || candidate.id;
        continue;
      end if;
      select * into balance from private.takeoff_launch_job_balance(
        (select j from public.takeoff_jobs j where j.id = candidate.id),
        (select r from public.takeoff_launch_requests r where r.id = candidate.launch_request_id));
      if balance.tokens_left <= 0 or balance.cost_left <= 0 then
        update public.takeoff_jobs j set status = 'failed', completed_at = pg_catalog.clock_timestamp(), next_retry_at = null,
          last_error_at = pg_catalog.clock_timestamp(), error_code = 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED',
          error_message = 'Le budget de cette analyse était épuisé avant la lecture de ce plan.', analysis_outcome = 'failure'
        where j.id = candidate.id;
        closed := closed || candidate.id;
        continue;
      end if;
    end if;
    if not private.takeoff_job_claim_admissible(candidate.id) then
      continue;
    end if;
    return query select candidate.id, case when candidate.status = 'failed' then 'retry' else 'create' end, due, closed;
    return;
  end loop;
  return query select null::uuid, null::text, due, closed;
end;
$$;
revoke all on function public.dispatch_next_takeoff_host_job(text, boolean) from public, anon, authenticated;
grant execute on function public.dispatch_next_takeoff_host_job(text, boolean) to service_role;

-- The hosted recovery (M3, 20261121020321_takeoff_completion_before_activation.sql), same signature. Every job that is
-- not a plan of one analysis per plan follows M3's statements as they were: its turn by M3's rule, its row locked only if
-- it is closed. A plan of one analysis per plan (A's work, whatever the activation) waits for its turn by the rule of its
-- claim's triggers (a request of plans is one analysis), and is locked in identifier order before any write, without
-- waiting (skip locked): a plan held by another writer (a claim, a member's stop) is left to the next run.
create or replace function public.recover_stale_local_takeoff_jobs(
  p_now timestamptz,
  p_stale_after interval default interval '10 minutes'
)
returns table (job_id uuid, error_code text)
language plpgsql security definer
set search_path = pg_catalog
as $$
declare
  activation private.takeoff_completion_activation;
  recovery_at timestamptz := least(p_now, clock_timestamp());
  live_window constant interval := private.takeoff_local_host_live_window();
  waiting_host text;
  waiting_tenant uuid;
  decided_hosts text[] := '{}';
  admitting_tenants uuid[] := '{}';
  plan_units uuid[] := '{}';
begin
  if p_now is null or p_stale_after < interval '1 minute' then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;
  select * into activation from private.takeoff_completion_activation;
  if activation.active_from is null or clock_timestamp() < activation.active_from then
    -- The statement of the function before M3, unchanged.
    return query
    with recovered as (
      update public.takeoff_jobs as job_row
      set status = 'failed', completed_at = p_now, next_retry_at = null,
        last_error_at = p_now, error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN',
        error_message = 'Le worker a expire pendant un appel dont le resultat fournisseur est inconnu. Une reprise manuelle est requise.',
        processing_lease_token = null, processing_lease_expires_at = null,
        provider_reconcile_due_at = null, provider_reconcile_lease_token = null,
        provider_reconcile_lease_expires_at = null
      where job_row.execution_provider = 'chatgpt_local'
        and job_row.status = 'processing' and job_row.provider_batch_id is null
        and (job_row.processing_lease_expires_at <= p_now or
          (job_row.processing_lease_expires_at is null and coalesce(job_row.started_at, job_row.updated_at) <= p_now - p_stale_after))
      returning job_row.id, job_row.error_code
    ) select recovered.id, recovered.error_code from recovered;
    return;
  end if;
  if p_stale_after is null then
    raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023';
  end if;

  -- Decide for each Mac while none of its claims is in flight: this application's claim takes the same lock, so a
  -- claim committed before the decision is read below and one that starts after it waits for this transaction. Only
  -- the Macs locked here are decided for in this run.
  for waiting_host in
    select distinct j.execution_host_id from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.status in ('pending', 'failed')
    order by 1
  loop
    perform pg_advisory_xact_lock(private.takeoff_local_host_lock_key(waiting_host));
    decided_hosts := decided_hosts || waiting_host;
  end loop;
  -- Judge a tenant's admission limits only under its admission lock, as a claim does (the key of
  -- 20261022075204_bound_takeoff_job_admission.sql). A tenant whose admission is in flight is waiting its turn; the
  -- lock is only tried, so the recovery never waits behind an admission.
  for waiting_tenant in
    select distinct j.tenant_id from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.status in ('pending', 'failed') and j.execution_host_id = any (decided_hosts)
    order by 1
  loop
    if not pg_try_advisory_xact_lock(hashtextextended('takeoff-admission:' || waiting_tenant::text, 0)) then
      admitting_tenants := admitting_tenants || waiting_tenant;
    end if;
  end loop;

  -- The plans of one analysis per plan this run may close, locked in identifier order before any write and never waited
  -- for: a stop locks a request's plans in that order too, and a claim's row is left to the next run.
  plan_units := array(select j.id from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.launch_unit_key like 'plan:%'
      and ((j.status = 'processing' and (j.processing_lease_expires_at <= recovery_at
          or (j.processing_lease_expires_at is null and coalesce(j.started_at, j.updated_at) <= recovery_at - p_stale_after)))
        or (j.execution_host_id = any (decided_hosts)
          and (j.status = 'pending' or (j.status = 'failed' and j.retry_count < 3 and j.next_retry_at <= recovery_at))))
    order by j.id
    for update skip locked);

  -- A processing job whose lease expired is closed as before. A job that waits for its Mac (pending, or a due
  -- retry) is never closed for its age alone: only when its live Mac could take it and, idle with nothing claimed,
  -- renewed or ended for the pickup grace, leaves it untaken, or when it has waited longer than the ceiling.
  -- Liveness, live period and work are database time; so is the queue time of a pending job.
  return query
  with waiting as (
    select j.id, j.tenant_id, j.created_by, j.execution_host_id as host_id, j.status, j.retry_count, j.next_retry_at,
      coalesce(j.launch_unit_key like 'plan:%', false) as plan_unit,
      coalesce(j.analysis_queued_at, j.created_at) as queued_at,
      greatest(activation.active_from,
        case when j.status = 'pending' then coalesce(j.analysis_queued_at, j.created_at) else j.next_retry_at end
      ) as waiting_since,
      t.is_active as tenant_active
    from public.takeoff_jobs j
    join public.tenants t on t.id = j.tenant_id
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.execution_host_id = any (decided_hosts)
      and (j.status = 'pending'
        or (j.status = 'failed' and j.retry_count < 3 and j.next_retry_at <= recovery_at))
  ),
  host_work as (
    select w.host_id, max(w.worked_at) as worked_at
    from private.takeoff_local_job_work w
    where w.host_id in (select waiting.host_id from waiting)
    group by w.host_id
  ),
  host_busy as (
    select k.execution_host_id as host_id, true as busy
    from public.takeoff_jobs k
    where k.execution_provider = 'chatgpt_local' and k.execution_host_id in (select w.host_id from waiting w)
      and k.status = 'processing' and k.processing_lease_expires_at > recovery_at
    group by k.execution_host_id
  ),
  judged as (
    select w.*,
      coalesce(a.seen_at >= recovery_at - live_window and a.seen_at >= clock_timestamp() - live_window, false) as live,
      a.live_since,
      -- What is ahead of it: a job under lease, recent work of the Mac, an admission of the tenant in flight, or the
      -- tenant's limits refusing its claim.
      coalesce(hb.busy, false) or coalesce(hw.worked_at > recovery_at - activation.pickup_grace, false)
        or w.tenant_id = any (admitting_tenants)
        or not case when w.plan_unit then private.takeoff_job_claim_admissible(w.id)
          else private.local_takeoff_claim_admissible(w.tenant_id, w.created_by, w.status = 'failed') end as waiting_turn
    from waiting w
    left join private.takeoff_local_host_activity a on a.host_id = w.host_id
    left join host_busy hb on hb.host_id = w.host_id
    left join host_work hw on hw.host_id = w.host_id
  ),
  closing as (
    select j.id, j.status, j.retry_count, j.next_retry_at, null::timestamptz as queued_at,
      'TAKEOFF_WORKER_OUTCOME_UNKNOWN'::text as code,
      'Le traitement a été interrompu. Son résultat est inconnu et nécessite une vérification manuelle.'::text as message
    from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.provider_batch_id is null and j.analysis_outcome is null
      and j.status = 'processing' and (j.processing_lease_expires_at <= recovery_at or
        (j.processing_lease_expires_at is null and coalesce(j.started_at, j.updated_at) <= recovery_at - p_stale_after))
    union all
    select g.id, g.status, g.retry_count, g.next_retry_at, g.queued_at,
      case
        when g.waiting_since > recovery_at - activation.wait_ceiling then 'TAKEOFF_WORKER_NOT_STARTED'
        when not g.live then 'TAKEOFF_WORKER_HOST_SILENT'
        when g.waiting_turn then 'TAKEOFF_WORKER_QUEUE_EXPIRED'
        else 'TAKEOFF_WORKER_NOT_STARTED'
      end,
      case
        when g.waiting_since > recovery_at - activation.wait_ceiling then
          'L’analyse n’a pas démarré : le poste autorisé était disponible mais ne l’a pas prise en charge. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.'
        when not g.live then
          'L’analyse n’a pas démarré : le poste autorisé ne s’est pas manifesté avant la fin du délai d’attente maximal. Vérifiez qu’il est allumé, connecté et que l’application y est ouverte avant de préparer une nouvelle analyse.'
        when g.waiting_turn then
          'L’analyse attendait encore son tour sur le poste autorisé quand le délai d’attente maximal a expiré. Elle n’a pas démarré : préparez une nouvelle analyse.'
        else
          'L’analyse n’a pas démarré : le poste autorisé ne l’a pas prise en charge pendant le délai d’attente maximal. Vérifiez le poste autorisé avant de préparer une nouvelle analyse.'
      end
    from judged g
    where g.waiting_since <= recovery_at - activation.wait_ceiling
      or (g.tenant_active and g.live and not g.waiting_turn
        and g.live_since <= recovery_at - activation.pickup_grace
        and g.waiting_since <= recovery_at - activation.pickup_grace)
  )
  update public.takeoff_jobs as job_row
  set status = 'failed', completed_at = recovery_at, next_retry_at = null,
    last_error_at = recovery_at, error_code = closing.code, error_message = closing.message,
    analysis_outcome = 'failure',
    processing_lease_token = null, processing_lease_expires_at = null,
    provider_reconcile_due_at = null, provider_reconcile_lease_token = null,
    provider_reconcile_lease_expires_at = null
  from closing
  -- Rechecked on the locked row: a claim, a renewal or a relaunch that commits first keeps the job.
  where job_row.id = closing.id
    and (job_row.launch_unit_key is null or job_row.launch_unit_key not like 'plan:%' or job_row.id = any (plan_units))
    and job_row.execution_provider = 'chatgpt_local' and job_row.provider_batch_id is null
    and job_row.analysis_outcome is null and job_row.status = closing.status
    and job_row.retry_count = closing.retry_count
    and case job_row.status::text
      when 'processing' then job_row.processing_lease_expires_at <= recovery_at
        or (job_row.processing_lease_expires_at is null
          and coalesce(job_row.started_at, job_row.updated_at) <= recovery_at - p_stale_after)
      when 'pending' then coalesce(job_row.analysis_queued_at, job_row.created_at) = closing.queued_at
      else job_row.next_retry_at = closing.next_retry_at
    end
  returning job_row.id, job_row.error_code;
end;
$$;


-- 13. The slot and the ledger follow the job's lease: renewed with it, given back by its end with the same token; the
-- calls of an attempt that ends while reserved stay held as unknown.
create function private.follow_takeoff_job_lease()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'processing' and new.processing_lease_token is not distinct from old.processing_lease_token then
    update private.takeoff_host_slots s set expires_at = new.processing_lease_expires_at
    where s.host_id = new.execution_host_id and s.job_id = new.id and s.holder_token = new.processing_lease_token
      and new.processing_lease_expires_at is not null;
    return null;
  end if;
  -- The worker's own end, or the recovery's closure of a lapsed lease, gives the Mac back; a member's cancellation does
  -- not: the stopped worker's provider call may still run, until it ends (release_takeoff_host_slot) or its lease lapses.
  if new.status in ('completed', 'failed') then
    update private.takeoff_host_slots s set job_id = null, holder_token = null, acquired_at = null, expires_at = null
    where s.host_id = old.execution_host_id and s.job_id = old.id and s.holder_token = old.processing_lease_token;
  end if;
  if old.launch_request_id is not null and old.processing_lease_token is not null then
    update private.takeoff_launch_usage l set state = 'unknown', settled_at = pg_catalog.clock_timestamp()
    where l.job_id = old.id and l.lease_token = old.processing_lease_token and l.state = 'reserved';
  end if;
  return null;
end;
$$;
revoke all on function private.follow_takeoff_job_lease() from public, anon, authenticated, service_role;

-- A plan of one analysis per plan starts, or renews its lease, only while it holds the Mac's slot under that lease: a
-- released worker's direct claim (claim_local_takeoff_job without the slot) is refused, and so is a renewal of a worker
-- whose lease lapsed and whose Mac another process took; a retry of it that has waited past the ceiling
-- (20261121193413's floor) never starts. From the activation on, and while such a plan is at work on the Mac whatever the
-- activation, every other job of the Mac starts only under the slot too, and a renewal of one whose Mac another job holds
-- is refused as a lost lease. Before the activation, on a Mac without such a plan, every other job is claimed and renewed
-- as before. The slot's row is locked: a claim of the Mac waits for this renewal, then reads it.
create function private.require_takeoff_host_slot()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  slot private.takeoff_host_slots%rowtype;
  plan_unit boolean := coalesce(new.launch_unit_key like 'plan:%', false);
  renewal boolean := old.status = 'processing' and new.processing_lease_token is not distinct from old.processing_lease_token;
begin
  if not plan_unit and not private.takeoff_plan_dispatch_active() and not private.takeoff_host_plan_work(new.execution_host_id) then
    return new;
  end if;
  if plan_unit and old.status = 'failed' and old.next_retry_at <= private.takeoff_retry_expiry_floor() then
    raise exception 'TAKEOFF_JOB_RETRY_EXPIRED' using errcode = '55000';
  end if;
  select * into slot from private.takeoff_host_slots s where s.host_id = new.execution_host_id for update;
  if plan_unit or not renewal then
    if slot.job_id is distinct from new.id or slot.holder_token is distinct from new.processing_lease_token then
      if old.status = 'processing' then
        raise exception 'TAKEOFF_HOST_SLOT_LOST' using errcode = '40001';
      end if;
      raise exception 'TAKEOFF_HOST_SLOT_REQUIRED' using errcode = '42501';
    end if;
  elsif slot.job_id is not null and slot.job_id is distinct from new.id then
    raise exception 'TAKEOFF_HOST_SLOT_LOST' using errcode = '40001';
  end if;
  return new;
end;
$$;
revoke all on function private.require_takeoff_host_slot() from public, anon, authenticated, service_role;

-- The send of one analysis per plan stays closed until the partial-send pull request: its job is never attached to a
-- version (the send's only way to write it), and the send answers « not ready ». Lot 2's grouped analyses are unchanged.
create function private.guard_takeoff_plan_unit_send()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.takeoff_launch_requests r where r.id = new.launch_request_id
      and r.manifest -> 'format_version' = '2'::jsonb) then
    raise exception 'TAKEOFF_SEND_JOB_NOT_READY' using errcode = '40001',
      detail = jsonb_build_object('reason', 'plan_unit_send_closed')::text;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_takeoff_plan_unit_send() from public, anon, authenticated, service_role;

-- 14. Last, the statements that lock the tables of the paid path, kept as short as possible: everything above takes no
-- lock on them. In the order in which the previous application version's paid path writes them while this is applied (a
-- job's end writes the job first; M4's settlement of a call locks the job, writes its ledger, then its request): the jobs
-- (their index, then their triggers), the ledger, the requests last (their access exclusive lock also stops reads, held
-- for milliseconds). A worker that ends a job, renews its lease or settles a call meanwhile waits for this migration,
-- never in a cycle with it. A transaction that reads a request before it writes a job (an admission, a member's command
-- or cancellation) may meet it in a cycle: either side is rolled back whole (with no call made); which writers to stop
-- first, and what to do then, is the application procedure of the pull request.
lock table public.takeoff_jobs in share row exclusive mode;
-- The live jobs of each Mac: its dispatcher's queue and its next retry, without a scan of every job at each pass (whether
-- it reads a job now is answered by takeoff_jobs_processing_lease_due_idx).
create index takeoff_jobs_local_host_live_idx on public.takeoff_jobs (execution_host_id, status, next_retry_at)
  where execution_provider = 'chatgpt_local' and analysis_outcome is null and status in ('pending', 'processing', 'failed');

lock table private.takeoff_launch_usage in access exclusive mode;
-- The ledger's states (section 8): a call reserved before it is sent, observed once settled, unknown when its usage never
-- came back. A row lot 2's writer recorded is an observed call.
alter table private.takeoff_launch_usage
  add column state text not null default 'observed' check (state in ('reserved', 'observed', 'unknown')),
  add column branch text check (branch in ('pdf', 'vector_group', 'other')),
  add column reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  add column reserved_at timestamptz,
  add column settled_at timestamptz,
  add constraint takeoff_launch_usage_reservation_check check (
    (state = 'observed') or (tokens = 0 and cost_cents = 0 and reserved_at is not null)
  );
create index takeoff_launch_usage_request_idx on private.takeoff_launch_usage (request_id, state);

lock table public.takeoff_launch_requests in access exclusive mode;
-- The request's counters (section 3).
alter table public.takeoff_launch_requests
  add column units_not_started integer not null default 0 check (units_not_started >= 0),
  add column stop_requested_at timestamptz,
  add column stop_requested_by uuid,
  add constraint takeoff_launch_requests_stop_check check ((stop_requested_at is null) = (stop_requested_by is null)),
  drop constraint takeoff_launch_requests_closure_check,
  add constraint takeoff_launch_requests_closure_check check (
    (state = 'closed') = (outcome is not null) and (outcome is null) = (closed_at is null)
    and (outcome is null) = (completion_event_id is null)
    and (units_expected is null or units_succeeded + units_failed + units_canceled + units_not_started <= units_expected)
  );
grant select (units_not_started, stop_requested_at) on public.takeoff_launch_requests to authenticated;

-- What a job of a request may still spend: its unit's share (format 2; the request's envelope for format 1) and the
-- request's envelope, each less what was observed and what is held; and the calls of the job in flight.
create function private.takeoff_launch_job_balance(p_job public.takeoff_jobs, p_request public.takeoff_launch_requests)
returns table (tokens_left bigint, cost_left bigint, in_flight bigint)
language sql stable security definer set search_path = '' as $$
  with unit as (
    select coalesce(case when p_request.manifest -> 'format_version' = '2'::jsonb
        then private.takeoff_launch_unit(p_request.manifest, p_job.launch_unit_key) -> 'budget' end,
      jsonb_build_object('tokens', p_request.token_budget, 'cost_cents', p_request.cost_budget_cents)) as budget
  ), job_usage as (
    select coalesce(sum(l.tokens) filter (where l.state = 'observed'), 0) as tokens,
      coalesce(sum(l.reserved_tokens) filter (where l.state <> 'observed'), 0) as held,
      coalesce(sum(l.cost_cents), 0) as cost, count(*) filter (where l.state = 'reserved') as in_flight
    from private.takeoff_launch_usage l where l.job_id = p_job.id
  ), request_usage as (
    select coalesce(sum(l.reserved_tokens), 0) as held from private.takeoff_launch_usage l
    where l.request_id = p_request.id and l.state <> 'observed'
  )
  select least((unit.budget ->> 'tokens')::bigint - job_usage.tokens - job_usage.held,
      p_request.token_budget - p_request.tokens_observed - request_usage.held),
    least((unit.budget ->> 'cost_cents')::bigint - job_usage.cost, p_request.cost_budget_cents - p_request.cost_cents_observed),
    job_usage.in_flight
  from unit, job_usage, request_usage
$$;
revoke all on function private.takeoff_launch_job_balance(public.takeoff_jobs, public.takeoff_launch_requests)
  from public, anon, authenticated, service_role;

-- The units of a request, for the affaire's activity, read by the server after it checked the reader's access to
-- the affaire: each unit in its recorded order with its state (section 2), its public reason, its plan as the dossier
-- names it, its job; and what the request consumed. Never the Mac, the account, the lease, the selection or a
-- provider's text.
create function public.read_takeoff_launch_request_units(p_tenant_id uuid, p_project_id uuid, p_request_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'request_id', r.id,
    'format', case when r.manifest -> 'format_version' = '2'::jsonb then 'per_plan' else 'grouped' end,
    'plans', jsonb_array_length(coalesce(r.manifest -> 'plans', '[]'::jsonb)),
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
          'key', j.launch_unit_key,
          'ordinal', coalesce((u.value ->> 'ordinal')::integer, 1),
          'plan_file_id', p.value ->> 'plan_file_id', 'logical_id', p.value ->> 'logical_id', 'name', p.value ->> 'name',
          'pages', coalesce(p.value -> 'pages', '[]'::jsonb),
          'job_id', j.id,
          'state', private.takeoff_unit_state(j.status::text, j.analysis_outcome, j.error_code, j.started_at),
          'reason_code', case when j.error_code = any (case when r.manifest -> 'format_version' = '2'::jsonb
              then private.takeoff_plan_public_failure_codes() else private.takeoff_public_failure_codes() end)
            and private.takeoff_unit_state(j.status::text, j.analysis_outcome, j.error_code, j.started_at) in ('failed', 'not_started')
            then j.error_code end,
          'retry_at', case when j.status = 'failed' and j.analysis_outcome is null then j.next_retry_at end,
          'updated_at', j.updated_at)
        order by coalesce((u.value ->> 'ordinal')::integer, 1), j.id)
      from public.takeoff_jobs j
      left join lateral (select private.takeoff_launch_unit(r.manifest, j.launch_unit_key) as value) u on true
      left join lateral (select e.value from jsonb_array_elements(r.manifest -> 'plans') e(value)
        where r.manifest -> 'format_version' = '2'::jsonb and e.value ->> 'entry_key' = u.value #>> '{plans,0}') p on true
      where j.launch_request_id = r.id), '[]'::jsonb),
    'usage', jsonb_build_object('tokens_observed', r.tokens_observed, 'cost_cents_observed', r.cost_cents_observed,
      'unknown_calls', (select count(*) from private.takeoff_launch_usage l where l.request_id = r.id and l.state = 'unknown')))
  from public.takeoff_launch_requests r
  where r.id = p_request_id and r.tenant_id = p_tenant_id and r.project_id = p_project_id
$$;
revoke all on function public.read_takeoff_launch_request_units(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.read_takeoff_launch_request_units(uuid, uuid, uuid) to service_role;

-- The calls of unknown consumption of a page's requests, in one read, by the server after it checked the reader's access to
-- the affaire: a call sent whose usage never came back stays held, and freezes its request's further paid calls.
create function public.read_takeoff_launch_unknown_calls(p_tenant_id uuid, p_project_id uuid, p_request_ids uuid[])
returns table (request_id uuid, unknown_calls bigint)
language sql stable security definer set search_path = '' as $$
  select r.id, count(l.call_key) filter (where l.state = 'unknown')
  from public.takeoff_launch_requests r
  left join private.takeoff_launch_usage l on l.request_id = r.id
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.id = any (p_request_ids)
  group by r.id
$$;
revoke all on function public.read_takeoff_launch_unknown_calls(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.read_takeoff_launch_unknown_calls(uuid, uuid, uuid[]) to service_role;

-- The triggers on takeoff_jobs.
create trigger takeoff_job_lease_follow after update of status, processing_lease_expires_at on public.takeoff_jobs
  for each row when (old.status = 'processing' and (new.status <> 'processing'
    or new.processing_lease_expires_at is distinct from old.processing_lease_expires_at))
  execute function private.follow_takeoff_job_lease();
create trigger aa1_require_takeoff_host_slot before update of status, processing_lease_token, processing_lease_expires_at
  on public.takeoff_jobs
  for each row when (new.status = 'processing' and new.execution_host_id is not null and (old.status <> 'processing'
    or new.processing_lease_token is distinct from old.processing_lease_token
    or new.processing_lease_expires_at is distinct from old.processing_lease_expires_at))
  execute function private.require_takeoff_host_slot();
-- First of the job's triggers (« aa0 »): before the identity guard, so that its refusal is the one a send reads.
create trigger aa0_guard_takeoff_plan_unit_send before update of estimate_version_id on public.takeoff_jobs
  for each row when (old.estimate_version_id is null and new.estimate_version_id is not null and new.launch_request_id is not null)
  execute function private.guard_takeoff_plan_unit_send();

commit;
