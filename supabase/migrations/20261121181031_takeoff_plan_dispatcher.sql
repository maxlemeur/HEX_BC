-- Lot 3, migration A: one analysis per plan. A launch request of format 2 seals one unit per retained plan; each unit
-- is analysed by its own job, one at a time on the Mac of the mandate, under a persistent reservation of that Mac (its
-- slot); every paid call is reserved in the request's ledger before it is sent and settled after; the request closes
-- on the end of its last unit with one notice. Lot 2's grouped format (format 1) and every historical job keep working.
--
-- Inert until the owner sets private.takeoff_plan_dispatch_activation (after the automatic start's and the notices'
-- cut-offs, and once the authorised Mac runs this application): before it, no admission seals format 2, no claim takes
-- a slot and no dispatch closes anything. What the previous application version sees while this is applied: its
-- claim, its admissions of format 1, its usage records and its checks before each paid call answer as before (the
-- functions it calls keep their signatures; their new branches only concern format 2 requests, which it never makes,
-- and reservations, which it never writes); its inserts of jobs and its claims are counted by the admission limits as
-- before (one request of format 1 has one job). Drain the takeoff worker while this is applied: the last section takes a
-- short lock on takeoff_jobs to add its triggers.
begin;

-- Every statement takes a short lock: give up instead of queueing the job writers.
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

-- The codes of an end with a public French reason (TAKEOFF_PUBLIC_FAILURE_CODES, src/lib/takeoff/completion-outcome.ts),
-- with the two of the launch requests: a request's budget spent and a usage that could not be recorded. Only widens.
create or replace function private.takeoff_public_failure_codes()
returns text[] language sql immutable set search_path = pg_catalog as $$
  select array['AI_PROVIDER', 'AI_RATE_LIMIT', 'AI_SAFETY', 'AI_SCHEMA', 'AI_TIMEOUT', 'FORBIDDEN', 'INTERNAL_ERROR',
    'TAKEOFF_FILE_TOO_LARGE',
    'TAKEOFF_FILE_TYPE_INVALID', 'TAKEOFF_LEVEL_C_BUDGET_EXCEEDED', 'TAKEOFF_LEVEL_C_INVALID_SCHEMA',
    'TAKEOFF_LEVEL_C_TIMEOUT', 'TAKEOFF_PDF_CORRUPTED', 'TAKEOFF_PDF_NOT_INTERPRETABLE', 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED',
    'TAKEOFF_USAGE_UNRECORDED', 'TAKEOFF_WORKER_HOST_SILENT',
    'TAKEOFF_WORKER_NOT_STARTED', 'TAKEOFF_WORKER_OUTCOME_UNKNOWN', 'TAKEOFF_WORKER_QUEUE_EXPIRED']::text[];
$$;

-- 3. The request's counters: a unit that never started is told apart from one that failed, and a member's stop of the
-- rest of the request is recorded (its cancelled units were stopped at a member's request).
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
      select pg_catalog.jsonb_agg(s.value order by s.position)
      from pg_catalog.jsonb_array_elements(p_request.preparation_snapshot #> '{preparation,sources}') with ordinality as s(value, position)
      where s.value ->> 'kind' is distinct from 'plan' or s.value ->> 'document_id' = any (plans)), '[]'::jsonb))
    || pg_catalog.jsonb_build_object('launch_unit', pg_catalog.jsonb_build_object(
      'request_id', p_request.id, 'key', p_unit_key, 'ordinal', unit -> 'ordinal', 'manifest_digest', p_request.manifest_digest,
      'budget', unit -> 'budget', 'vector_pages', unit -> 'vector_pages'));
end;
$$;
revoke all on function private.takeoff_launch_unit_snapshot(public.takeoff_launch_requests, text) from public, anon, authenticated, service_role;

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
        or (u.value ->> 'vector_pages')::numeric not between 0 and 60)
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

-- M4's admission, its jobs inserted by the function above: its signature, its checks and its answers are unchanged; the
-- answer names the first unit's job, the audit all of them.
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
    return query select 'replayed'::text, (select j.id from public.takeoff_jobs j where j.launch_request_id = request.id
      order by j.launch_unit_key limit 1), null::text;
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
      and other.project_id = request.project_id and other.state = 'admitted' and other.id <> request.id) then 'ANOTHER_ANALYSIS_RUNNING'
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
      'format_version', request.manifest -> 'format_version',
      'execution_host_id', request.execution_host_id, 'mandate_kind', request.mandate_kind));
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

-- 5. Explicit commands. M4's command keeps its signature and its identity (format 1, or format 2 of the plans of the
-- member's preparation); a command of format 2 that names its plans (« relancer ce plan », « lire ce plan ajouté ») has
-- its own identity, the plans named included, so that two commands on two plans never share a receipt.
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
  select r.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = r.id order by j.launch_unit_key limit 1) as job
  into running from public.takeoff_launch_requests r
  where r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.state = 'admitted';
  if found then
    insert into private.takeoff_launch_commands (tenant_id, project_id, intent_key, command_digest, answer, request_id, job_id, created_by)
    values (p_tenant_id, p_project_id, p_intent_key, p_digest, 'already_running', running.id, running.job, p_actor);
    return query select 'already_running'::text, running.id, running.job;
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
      'format_version', request.manifest -> 'format_version',
      'predecessor_job_id', p_predecessor_job_id, 'execution_host_id', p_host, 'mandate_kind', 'command'));
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
    select r.id, (select j.id from public.takeoff_jobs j where j.launch_request_id = r.id order by j.launch_unit_key limit 1) as job
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

-- 7. The slot of each authorised Mac: the one job its dispatcher reads now, held by that job's processing lease token
-- (its holder), with a generation that grows at each acquisition. It is taken with the job's claim, under the Mac's
-- lock and in the same transaction, renewed with the job's lease and given back by the job's end with the same token
-- (section 13). A slot whose holder's lease expired is free: the next claim takes it over. No foreign key: the slot
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

-- Whether another job holds the Mac now: its slot's holder is a job still processing under that very lease.
create function private.takeoff_host_slot_busy(p_host_id text, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.takeoff_host_slots s
    join public.takeoff_jobs j on j.id = s.job_id
    where s.host_id = p_host_id and s.job_id is distinct from p_job_id
      and s.expires_at > pg_catalog.clock_timestamp() and j.status = 'processing'
      and j.processing_lease_token = s.holder_token and j.processing_lease_expires_at > pg_catalog.clock_timestamp()
  )
$$;
revoke all on function private.takeoff_host_slot_busy(text, uuid) from public, anon, authenticated, service_role;

-- The application's claim (M3, 20261121020321), which from activation on takes the Mac's slot with the job, in one
-- transaction under the Mac's lock: a second process, tab or gesture of the same Mac cannot start a second plan.
create or replace function public.claim_observed_local_takeoff_job(
  p_job_id uuid, p_tenant_id uuid, p_host_id text, p_started_at timestamptz, p_lease_token uuid,
  p_lease_expires_at timestamptz, p_model text, p_prompt_version text,
  p_observed_status text, p_observed_retry_count integer
)
returns setof public.takeoff_jobs language plpgsql security definer set search_path = pg_catalog as $$
declare
  slotted boolean := p_host_id is not null and private.takeoff_plan_dispatch_active();
begin
  if p_observed_status is null or p_observed_status not in ('pending', 'failed') or p_observed_retry_count is null then
    raise exception 'TAKEOFF_LOCAL_CLAIM_INVALID' using errcode = '22023';
  end if;
  if p_host_id is not null then
    perform pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  end if;
  perform 1 from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.status::text = p_observed_status and j.retry_count = p_observed_retry_count
  for update;
  if not found then return; end if;
  -- Another plan is read on this Mac now: this one waits for its turn.
  if slotted and private.takeoff_host_slot_busy(p_host_id, p_job_id) then return; end if;
  -- Planned per call: a session keeps working after a column joins the job row.
  return query execute 'select * from public.claim_local_takeoff_job($1, $2, $3, $4, $5, $6, $7, $8)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model, p_prompt_version;
  if found and slotted then
    insert into private.takeoff_host_slots as s (host_id, job_id, holder_token, generation, acquired_at, expires_at)
    values (p_host_id, p_job_id, p_lease_token, 1, clock_timestamp(), p_lease_expires_at)
    on conflict (host_id) do update set job_id = excluded.job_id, holder_token = excluded.holder_token,
      generation = s.generation + 1, acquired_at = excluded.acquired_at, expires_at = excluded.expires_at;
  end if;
end;
$$;

-- 8. The ledger of a request's paid calls (M4's private.takeoff_launch_usage, keyed by job, attempt lease and call): a
-- call is reserved before it is sent, under the job's lock then the request's, and settled once after its answer. A
-- reservation holds its bound (the largest call the request observed on that branch, or the estimate the worker
-- gives) until it is settled; a call that ended without a known usage, or whose attempt ended first, stays held as
-- unknown: it is never credited back, and the balance a new call needs counts it. A row M4's settlement wrote is an
-- observed call.
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

-- The one rule before each paid call of any job: the module is on and its creator may still launch on its affaire.
create function private.takeoff_job_payment_refusal(p_job public.takeoff_jobs, p_module_default boolean)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when not private.takeoff_module_enabled(p_job.tenant_id, p_module_default) then 'TAKEOFF_DISABLED'
    when not private.takeoff_launch_payer_eligible(p_job.tenant_id, p_job.project_id, p_job.created_by) then 'PAYER_NOT_ELIGIBLE'
  end
$$;
revoke all on function private.takeoff_job_payment_refusal(public.takeoff_jobs, boolean) from public, anon, authenticated, service_role;

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
  if job.execution_host_id is not null and private.takeoff_plan_dispatch_active()
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
    insert into private.takeoff_launch_usage (job_id, lease_token, call_key, request_id, tokens, cost_cents, settled_at)
    values (p_job_id, p_lease_token, p_call_key, job.launch_request_id, v_tokens, v_cost, pg_catalog.clock_timestamp())
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
  if not found or request.state <> 'admitted' then
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
    case when request.outcome = 'failure' and failure_code = any (private.takeoff_public_failure_codes()) then failure_code end
  );
end;
$$;
revoke all on function private.close_takeoff_launch_request(uuid, timestamptz, text) from public, anon, authenticated, service_role;

-- M4's trigger on the recorded end of a unit, now through the recomputation above.
create or replace function private.settle_takeoff_launch_request()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform private.close_takeoff_launch_request(new.launch_request_id, new.analysis_finished_at, new.error_code);
  return null;
end;
$$;

-- A request whose units have all ended but which is still open (an end recorded while its trigger could not settle it):
-- the same recomputation, without any AI call; idempotent.
create function public.reconcile_takeoff_launch_requests(p_limit integer default 20)
returns table (request_id uuid, state text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  candidate uuid;
begin
  for candidate in
    select r.id from public.takeoff_launch_requests r
    where r.state = 'admitted' and r.units_expected = (select count(*) from public.takeoff_jobs j where j.launch_request_id = r.id)
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

-- 10. M3's trigger on the end of an analysis (20261121020321), with one change: a unit failed with its technical retry
-- still to run that a member stops is cancelled, with its outcome (before, only a pending or processing job could be).
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
    or (old.status = 'failed' and old.analysis_outcome is null and new.next_retry_at is null)) then
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
-- e-mail). Who may launch on the affaire may stop. The jobs are locked first, in identifier order, then the request: the
-- order of every writer of both.
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
  perform 1 from public.takeoff_jobs j where j.launch_request_id = p_request_id and j.tenant_id = p_tenant_id
  order by j.id for update;
  select * into request from public.takeoff_launch_requests r
  where r.id = p_request_id and r.tenant_id = p_tenant_id and r.project_id = p_project_id for update;
  if not found then
    raise exception 'TAKEOFF_LAUNCH_REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  if request.state <> 'admitted' then
    return query select 'not_running'::text, request.state, 0;
    return;
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
begin
  if p_host_id is null or p_host_id !~ '^urn:uuid:[0-9a-f-]{36}$' then
    raise exception 'TAKEOFF_DISPATCH_INVALID' using errcode = '22023';
  end if;
  if not private.takeoff_plan_dispatch_active() then
    return;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  select min(j.next_retry_at) into due from public.takeoff_jobs j
  where j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id and j.analysis_outcome is null
    and j.status = 'failed' and j.retry_count < 3 and j.next_retry_at > pg_catalog.clock_timestamp();
  if private.takeoff_host_slot_busy(p_host_id, null) then
    return query select null::uuid, null::text, due, closed;
    return;
  end if;
  for candidate in
    select j.*, r.manifest as request_manifest from public.takeoff_jobs j
    join public.tenants t on t.id = j.tenant_id and t.is_active
    left join public.takeoff_launch_requests r on r.id = j.launch_request_id
    where j.execution_provider = 'chatgpt_local' and j.execution_host_id = p_host_id and j.provider_batch_id is null
      and j.analysis_outcome is null
      and (j.status = 'pending' or (j.status = 'failed' and j.retry_count < 3 and j.next_retry_at <= pg_catalog.clock_timestamp()))
      and (j.launch_request_id is null or r.state = 'admitted')
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
    if not private.local_takeoff_claim_admissible(candidate.tenant_id, candidate.created_by, candidate.status = 'failed') then
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

-- 13. The units of a request, for the affaire's activity, read by the server after it checked the reader's access to
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
          'reason_code', case when j.error_code = any (private.takeoff_public_failure_codes())
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

-- 14. The slot and the ledger follow the job's lease: renewed with it, given back by its end with the same token; the
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
  update private.takeoff_host_slots s set job_id = null, holder_token = null, acquired_at = null, expires_at = null
  where s.host_id = old.execution_host_id and s.job_id = old.id and s.holder_token = old.processing_lease_token;
  if old.launch_request_id is not null and old.processing_lease_token is not null then
    update private.takeoff_launch_usage l set state = 'unknown', settled_at = pg_catalog.clock_timestamp()
    where l.job_id = old.id and l.lease_token = old.processing_lease_token and l.state = 'reserved';
  end if;
  return null;
end;
$$;
revoke all on function private.follow_takeoff_job_lease() from public, anon, authenticated, service_role;

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

-- 15. Last, just before the commit: the triggers on takeoff_jobs (a short SHARE ROW EXCLUSIVE lock each).
create trigger takeoff_job_lease_follow after update of status, processing_lease_expires_at on public.takeoff_jobs
  for each row when (old.status = 'processing' and (new.status <> 'processing'
    or new.processing_lease_expires_at is distinct from old.processing_lease_expires_at))
  execute function private.follow_takeoff_job_lease();
-- First of the job's triggers (« aa0 »): before the identity guard, so that its refusal is the one a send reads.
create trigger aa0_guard_takeoff_plan_unit_send before update of estimate_version_id on public.takeoff_jobs
  for each row when (old.estimate_version_id is null and new.estimate_version_id is not null and new.launch_request_id is not null)
  execute function private.guard_takeoff_plan_unit_send();

commit;
