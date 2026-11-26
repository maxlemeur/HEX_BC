begin;
set local lock_timeout = '5s';

-- Logical payment queues stay separate. They use the installation's UUIDv4 for
-- the slot, while its UUIDv8 alias identifies work requiring the new runtime.
create function private.takeoff_slot_host_id(p_host_id text)
returns text language sql immutable set search_path = '' as $$
  select case when p_host_id ~ '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then pg_catalog.substr(p_host_id, 1, 23) || '4' || pg_catalog.substr(p_host_id, 25) else p_host_id end
$$;

create function private.takeoff_payment_queue_id(p_host_id text)
returns text language sql immutable set search_path = '' as $$
  select case when p_host_id ~ '^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then pg_catalog.substr(p_host_id, 1, 23) || '8' || pg_catalog.substr(p_host_id, 25) else p_host_id end
$$;
revoke all on function private.takeoff_slot_host_id(text), private.takeoff_payment_queue_id(text)
  from public, anon, authenticated, service_role;

create or replace function private.takeoff_local_host_lock_key(p_host_id text)
returns bigint language sql immutable set search_path = pg_catalog as $$
  select hashtextextended('takeoff-local-host:' || private.takeoff_slot_host_id(p_host_id), 0);
$$;

create or replace function private.takeoff_host_slot_busy(p_host_id text, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.takeoff_host_slots s
    where s.host_id = private.takeoff_slot_host_id(p_host_id) and s.holder_token is not null and s.job_id is distinct from p_job_id
      and s.expires_at > pg_catalog.clock_timestamp()
  )
$$;

create or replace function private.takeoff_host_plan_work(p_host_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.takeoff_host_slots s where s.host_id = private.takeoff_slot_host_id(p_host_id) and s.holder_token is not null
      and s.expires_at > pg_catalog.clock_timestamp())
    or exists (select 1 from public.takeoff_jobs j where j.execution_host_id in (private.takeoff_slot_host_id(p_host_id),
        private.takeoff_payment_queue_id(private.takeoff_slot_host_id(p_host_id)))
      and j.launch_unit_key like 'plan:%' and j.analysis_outcome is null and j.status in ('pending', 'processing', 'failed'))
$$;

create or replace function private.takeoff_host_busy(p_host_id text, p_job_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.takeoff_host_slot_busy(p_host_id, p_job_id) or exists (
    select 1 from public.takeoff_jobs j
    where j.execution_provider = 'chatgpt_local' and j.execution_host_id in (private.takeoff_slot_host_id(p_host_id),
        private.takeoff_payment_queue_id(private.takeoff_slot_host_id(p_host_id))) and j.id is distinct from p_job_id
      and j.status = 'processing' and j.processing_lease_expires_at > pg_catalog.clock_timestamp())
$$;

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
    or private.takeoff_host_plan_work(p_host_id) or private.takeoff_slot_host_id(p_host_id) <> p_host_id);
  if slotted then
    insert into private.takeoff_host_slots (host_id) values (private.takeoff_slot_host_id(p_host_id)) on conflict (host_id) do nothing;
    select * into slot from private.takeoff_host_slots s where s.host_id = private.takeoff_slot_host_id(p_host_id) for update;
    -- Another plan is read on this Mac now: this one waits for its turn.
    if private.takeoff_host_busy(p_host_id, p_job_id) then return; end if;
    update private.takeoff_host_slots s set job_id = p_job_id, holder_token = p_lease_token, generation = s.generation + 1,
      acquired_at = clock_timestamp(), expires_at = p_lease_expires_at
    where s.host_id = private.takeoff_slot_host_id(p_host_id);
  end if;
  -- Planned per call: a session keeps working after a column joins the job row.
  return query execute 'select * from public.claim_local_takeoff_job($1, $2, $3, $4, $5, $6, $7, $8)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model, p_prompt_version;
  if not found and slotted then
    update private.takeoff_host_slots s set job_id = slot.job_id, holder_token = slot.holder_token, generation = slot.generation,
      acquired_at = slot.acquired_at, expires_at = slot.expires_at
    where s.host_id = private.takeoff_slot_host_id(p_host_id);
  end if;
end;
$$;

create or replace function public.release_takeoff_host_slot(p_host_id text, p_lease_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  released boolean;
begin
  if p_host_id is null or p_lease_token is null then
    raise exception 'TAKEOFF_HOST_SLOT_INVALID' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(private.takeoff_local_host_lock_key(p_host_id));
  update private.takeoff_host_slots s set job_id = null, holder_token = null, acquired_at = null, expires_at = null
  where s.host_id = private.takeoff_slot_host_id(p_host_id) and s.holder_token = p_lease_token
    and not exists (select 1 from public.takeoff_jobs j where j.id = s.job_id and j.status = 'processing'
      and j.processing_lease_token = p_lease_token and j.processing_lease_expires_at > pg_catalog.clock_timestamp())
  returning true into released;
  return coalesce(released, false);
end;
$$;

create or replace function private.follow_takeoff_job_lease()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'processing' and new.processing_lease_token is not distinct from old.processing_lease_token then
    -- A renewal: the slot follows it when this lease holds it; a job that holds no slot (every job before the activation)
    -- writes nothing.
    if new.processing_lease_expires_at is not null and exists (select 1 from private.takeoff_host_slots s
        where s.host_id = private.takeoff_slot_host_id(new.execution_host_id) and s.job_id = new.id and s.holder_token = new.processing_lease_token) then
      update private.takeoff_host_slots s set expires_at = new.processing_lease_expires_at
      where s.host_id = private.takeoff_slot_host_id(new.execution_host_id) and s.job_id = new.id and s.holder_token = new.processing_lease_token;
    end if;
    return null;
  end if;
  -- The worker's own end, or the recovery's closure of a lapsed lease, gives the Mac back; a member's cancellation does
  -- not: the stopped worker's provider call may still run, until it ends (release_takeoff_host_slot) or its lease lapses.
  if new.status in ('completed', 'failed') then
    update private.takeoff_host_slots s set job_id = null, holder_token = null, acquired_at = null, expires_at = null
    where s.host_id = private.takeoff_slot_host_id(old.execution_host_id) and s.job_id = old.id and s.holder_token = old.processing_lease_token;
  end if;
  if old.launch_request_id is not null and old.processing_lease_token is not null then
    update private.takeoff_launch_usage l set state = 'unknown', settled_at = pg_catalog.clock_timestamp()
    where l.job_id = old.id and l.lease_token = old.processing_lease_token and l.state = 'reserved';
  end if;
  return null;
end;
$$;

create or replace function private.require_takeoff_host_slot()
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
  -- The Mac's slot row, created here if it has none yet: an insert waits for a first claim of the Mac that inserted it
  -- and has not committed (the row's key), so the row read next is the claim's, never a missing one. The Mac's advisory
  -- lock would serialise the same, but a lapsed job renewing under it would wait for the recovery that holds it while the
  -- recovery waits for that job's row.
  if new.execution_host_id ~ '^urn:uuid:[0-9a-f-]{36}$' then
    insert into private.takeoff_host_slots (host_id) values (private.takeoff_slot_host_id(new.execution_host_id)) on conflict (host_id) do nothing;
  end if;
  select * into slot from private.takeoff_host_slots s where s.host_id = private.takeoff_slot_host_id(new.execution_host_id) for update;
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

create or replace function private.takeoff_count_mark_lease_live(job public.takeoff_jobs, token uuid)
returns boolean language sql volatile set search_path = '' as $$
  select job.status='processing' and job.processing_lease_token=token and job.processing_lease_expires_at>clock_timestamp()
    and exists (select 1 from private.takeoff_host_slots s where s.host_id = private.takeoff_slot_host_id(job.execution_host_id) and s.job_id=job.id
      and s.holder_token=token and s.expires_at>clock_timestamp())
$$;

create or replace function public.reserve_takeoff_launch_call(p_job_id uuid, p_lease_token uuid, p_call_key text, p_branch text,
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
  schedule jsonb;
  classifier_calls integer := 0;
  lane_calls integer;
begin
  if p_call_key is null or length(p_call_key) not between 1 and 120 or p_branch not in ('pdf', 'vector_group', 'other', 'count_tile')
    or p_estimate_tokens is null or p_estimate_tokens < 1 then
    raise exception 'TAKEOFF_LAUNCH_CALL_INVALID' using errcode = '22023';
  end if;
  job := private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  -- A plan of one analysis per plan pays only while it holds the Mac (its slot, under this very lease); another job of
  -- the Mac, from the activation on or while such a plan is at work on the Mac, only while no other job holds it.
  if job.launch_unit_key like 'plan:%' then
    if not exists (select 1 from private.takeoff_host_slots s where s.host_id = private.takeoff_slot_host_id(job.execution_host_id) and s.job_id = job.id
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
  schedule := private.takeoff_confirmed_count_mark_schedule(job);
  if p_branch = 'count_tile' and schedule is null then
    return query select 'refused'::text, 'TILE_OUTSIDE_SCOPE'::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  if job.launch_request_id is null then
    return query select 'unbudgeted'::text, null::text, null::bigint, null::bigint, null::bigint;
    return;
  end if;
  -- The job's row, then the request's: the order of every writer of both.
  select * into request from public.takeoff_launch_requests r where r.id = job.launch_request_id for update;
  -- Waiting for the request can take the last seconds of a valid lease. Check both clocks under the lock.
  if schedule is not null and private.takeoff_count_mark_lease_live(job,p_lease_token) is not true then
    raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
  end if;
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
  -- For the optional readers the confirmation buys one attempt per named tile, across
  -- all leases. Replaying a reservation must never authorize a second physical call.
  if schedule is not null then
    refusal := private.takeoff_count_mark_attempt_refusal(request.id,p_call_key);
    if refusal is not null then
      return query select 'refused'::text, refusal, null::bigint, null::bigint, null::bigint;
      return;
    end if;
    if p_branch = 'count_tile' then
      if not exists (
        select 1 from jsonb_array_elements(schedule -> 'pages') s
        cross join lateral generate_series(1,case when (s ->> 'width_points')::numeric > 700 then 6 else 4 end) t(i)
        where p_call_key = 'tile:' || ((s ->> 'page')::numeric::integer)::text || ':' || t.i::text) then
        refusal := 'TILE_OUTSIDE_SCOPE';
      elsif exists (select 1 from private.takeoff_launch_usage l where l.request_id = request.id and l.state = 'reserved') then
        refusal := 'TILE_IN_FLIGHT';
      end if;
    elsif exists (select 1 from private.takeoff_launch_usage l where l.request_id = request.id
        and l.branch = 'count_tile' and l.state = 'reserved') then
      refusal := 'TILE_IN_FLIGHT';
    else
      classifier_calls := private.takeoff_count_mark_classifier_calls(request.manifest #> '{units,0}',jsonb_array_length(schedule -> 'pages'));
      lane_calls := case p_branch when 'pdf' then (schedule ->> 'other_calls')::integer - classifier_calls
        when 'vector_group' then classifier_calls else 0 end;
      if (select count(*) from private.takeoff_launch_usage l where l.request_id=request.id and l.branch=p_branch) >= lane_calls then
        refusal := 'BUDGET_EXHAUSTED';
      end if;
    end if;
    if refusal is not null then
      return query select 'refused'::text, refusal, null::bigint, null::bigint, null::bigint;
      return;
    end if;
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

create table private.takeoff_api_mandates (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  payer_id uuid not null,
  settings jsonb not null,
  check (jsonb_typeof(settings) = 'object')
);

create table private.takeoff_api_calls (
  id uuid primary key default gen_random_uuid(),
  mandate_id uuid not null references private.takeoff_api_mandates(id) on delete cascade,
  scope_id uuid not null,
  job_id uuid not null,
  lease_token uuid not null,
  branch text not null check (branch in ('pdf', 'vector_group', 'count_tile')),
  tile_key text,
  bound_nano_usd bigint not null check (bound_nano_usd > 0),
  bound_tokens bigint not null check (bound_tokens > 0),
  actual_nano_usd bigint check (actual_nano_usd >= 0),
  actual_tokens bigint check (actual_tokens >= 0),
  settled_at timestamptz,
  check ((branch = 'count_tile') = (tile_key is not null))
);
create index takeoff_api_calls_balance_idx on private.takeoff_api_calls (mandate_id, scope_id);
create unique index takeoff_api_calls_tile_idx on private.takeoff_api_calls (mandate_id, scope_id, tile_key) where tile_key is not null;
alter table private.takeoff_api_mandates enable row level security;
alter table private.takeoff_api_calls enable row level security;
revoke all on private.takeoff_api_mandates, private.takeoff_api_calls from public, anon, authenticated, service_role;

create table private.takeoff_api_budget_stops (
  mandate_id uuid not null references private.takeoff_api_mandates(id) on delete cascade,
  scope_id uuid not null,
  reason text not null check (reason in ('BUDGET_EXHAUSTED', 'PAYER_NOT_ELIGIBLE', 'TAKEOFF_DISABLED')),
  primary key (mandate_id, scope_id)
);
alter table private.takeoff_api_budget_stops enable row level security;
revoke all on private.takeoff_api_budget_stops from public, anon, authenticated, service_role;

create or replace function private.takeoff_launch_mandate_reasons() returns text[]
language sql immutable set search_path = '' as $$
  select array['OPERATOR_REQUIRED', 'MANDATE_REQUIRED', 'LOCAL_RUNTIME_REQUIRED', 'HOST_NOT_AUTHORISED',
    'CHATGPT_NOT_CONNECTED', 'CHATGPT_ACCESS_REVOKED', 'CHATGPT_MODEL_MISSING', 'CHATGPT_SELECTION_CHANGED',
    'API_KEY_CONNECTION_CHANGED', 'PAYER_NOT_ELIGIBLE', 'EVALUATION_FAILED']
$$;

create function public.seal_takeoff_api_mandate(
  p_id uuid, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid, p_settings jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_payer_id) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if (p_settings->>'connectionId')::uuid is null or coalesce((p_settings->>'connectionVersion')::bigint, 0) <= 0
    or coalesce((p_settings->>'maxTokens')::bigint, 0) <= 0 or coalesce((p_settings->>'maxNanoUsd')::bigint, 0) <= 0
    or coalesce(p_settings->>'model', '') = '' or coalesce(p_settings->>'hostId', '') !~ '^urn:uuid:[0-9a-f-]{36}$'
    or (p_settings - array['connectionId','connectionVersion','maxTokens','maxNanoUsd','model','hostId','reasoningEffort']) <> '{}'::jsonb
  then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '22023';
  end if;
  insert into private.takeoff_api_mandates (id, tenant_id, project_id, payer_id, settings)
  values (p_id, p_tenant_id, p_project_id, p_payer_id, p_settings)
  on conflict (id) do nothing;
  if not exists (select 1 from private.takeoff_api_mandates m
    where m.id = p_id and m.tenant_id = p_tenant_id and m.project_id = p_project_id
      and m.payer_id = p_payer_id and m.settings = p_settings) then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
  end if;
end;
$$;

create function public.read_takeoff_api_mandate(p_id uuid, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select m.settings from private.takeoff_api_mandates m
  where m.id = p_id and m.tenant_id = p_tenant_id and m.project_id = p_project_id and m.payer_id = p_payer_id
    and private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_payer_id)
$$;

create or replace function private.assert_takeoff_launch_selection(p_host text, p_selection jsonb)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_host is null or p_host !~ '^urn:uuid:[0-9a-f-]{36}$' or p_selection is null or jsonb_typeof(p_selection) <> 'object'
    or p_selection ->> 'hostId' is distinct from p_host
    or coalesce(p_selection ->> 'profileId', '') = '' or coalesce(p_selection ->> 'model', '') = ''
    or not (p_selection ? 'reasoningEffort') or coalesce(p_selection ->> 'authorizationId', '') = ''
    or coalesce(p_selection ->> 'source', 'chatgpt_plan') not in ('chatgpt_plan', 'personal_api_key')
    or (p_selection - array['profileId', 'model', 'reasoningEffort', 'hostId', 'authorizationId', 'source']) <> '{}'::jsonb then
    raise exception 'TAKEOFF_LAUNCH_SELECTION_INVALID' using errcode = '22023';
  end if;
end;
$$;

create function private.assert_takeoff_api_scope(
  p_selection jsonb, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid, p_host_id text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_selection->>'source' = 'personal_api_key' and not exists (
    select 1 from private.takeoff_api_mandates m
    where m.id::text = p_selection->>'authorizationId' and m.id::text = p_selection->>'profileId'
      and m.tenant_id = p_tenant_id and m.project_id = p_project_id and m.payer_id = p_payer_id
      and m.settings->>'hostId' = p_host_id and p_selection->>'hostId' = p_host_id
      and p_selection->>'model' = 'personal_api_key' and p_selection->'reasoningEffort' = 'null'::jsonb
  ) then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
  end if;
end;
$$;

create function private.guard_takeoff_api_request() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_takeoff_api_scope(new.mandate_selection, new.tenant_id, new.project_id, new.payer_id, new.execution_host_id);
  return new;
end;
$$;
create trigger guard_takeoff_api_request before insert or update of mandate_selection, payer_id, execution_host_id
on public.takeoff_launch_requests for each row execute function private.guard_takeoff_api_request();

create function private.guard_takeoff_api_job() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  selection jsonb := new.preparation_snapshot->'execution_selection';
begin
  if tg_op = 'INSERT' then
    perform private.assert_takeoff_api_scope(selection, new.tenant_id, new.project_id, new.created_by, new.execution_host_id);
  elsif old.preparation_snapshot->'execution_selection'->>'source' in ('chatgpt_plan', 'personal_api_key') then
    if selection is distinct from old.preparation_snapshot->'execution_selection'
      or new.execution_host_id is distinct from old.execution_host_id then
      raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
    end if;
    if new.status = 'processing' and old.status <> 'processing'
      and pg_catalog.current_setting('mergeone.takeoff_payment_claim', true) is distinct from old.id::text then
      return null;
    end if;
    -- The released recovery scans every host. Only versioned callers can close work with no live lease.
    if new.status = 'failed' and (
      old.status <> 'processing' or old.processing_lease_expires_at is null or old.processing_lease_expires_at <= pg_catalog.clock_timestamp()
    ) and pg_catalog.current_setting('mergeone.takeoff_payment_recovery', true) is distinct from 'on'
      and not (old.status = 'pending' and pg_catalog.current_setting('mergeone.takeoff_payment_dispatch', true)
        is not distinct from old.execution_host_id) then
      return null;
    end if;
  elsif selection->>'source' in ('chatgpt_plan', 'personal_api_key') then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger zz_takeoff_api_job_insert after insert on public.takeoff_jobs
for each row execute function private.guard_takeoff_api_job();
create trigger aa00_takeoff_api_job_update before update on public.takeoff_jobs
for each row execute function private.guard_takeoff_api_job();

alter table public.takeoff_jobs add constraint takeoff_jobs_api_mandate_shape
  check (preparation_snapshot->'execution_selection'->>'source' is distinct from 'personal_api_key'
    or (level = 'C' and execution_provider is not distinct from 'chatgpt_local' and execution_host_id is not null and created_by is not null))
  not valid;

create function public.claim_explicit_takeoff_payment_job(
  p_job_id uuid, p_tenant_id uuid, p_host_id text, p_started_at timestamptz, p_lease_token uuid,
  p_lease_expires_at timestamptz, p_model text, p_prompt_version text, p_observed_status text, p_observed_retry_count integer
) returns setof public.takeoff_jobs language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.takeoff_jobs j where j.id = p_job_id and j.tenant_id = p_tenant_id
    and j.execution_host_id = p_host_id and j.preparation_snapshot->'execution_selection'->>'source' in ('chatgpt_plan', 'personal_api_key')) then
    return;
  end if;
  perform pg_catalog.set_config('mergeone.takeoff_payment_claim', p_job_id::text, true);
  return query execute 'select * from public.claim_observed_local_takeoff_job($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)'
    using p_job_id, p_tenant_id, p_host_id, p_started_at, p_lease_token, p_lease_expires_at, p_model,
      p_prompt_version, p_observed_status, p_observed_retry_count;
  perform pg_catalog.set_config('mergeone.takeoff_payment_claim', '', true);
end;
$$;

create function public.dispatch_next_takeoff_payment_job(p_host_id text, p_module_default boolean default false)
returns table (job_id uuid, trigger_kind text, next_due_at timestamptz, closed_jobs uuid[])
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.set_config('mergeone.takeoff_payment_dispatch', p_host_id, true);
  return query select d.* from public.dispatch_next_takeoff_host_job(p_host_id, p_module_default) d;
  perform pg_catalog.set_config('mergeone.takeoff_payment_dispatch', '', true);
end;
$$;

-- Both pre-count reads and pre-dispatch reservations use the same scope and lease.
create function public.reserve_takeoff_api_call(
  p_job_id uuid, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid, p_lease_token uuid,
  p_module_default boolean, p_branch text, p_bound bigint default null, p_tokens bigint default null,
  p_exhausted boolean default false, p_tile_key text default null
) returns table (reason text, remaining_nano_usd bigint, remaining_tokens bigint, call_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  job public.takeoff_jobs;
  mandate private.takeoff_api_mandates;
  billing_scope uuid;
  refusal text;
  usd_left bigint;
  tokens_left bigint;
  reserved uuid;
  schedule jsonb;
  capacity_held boolean;
begin
  job := private.lock_takeoff_paying_job(p_job_id, p_lease_token);
  if job.tenant_id is distinct from p_tenant_id or job.project_id is distinct from p_project_id
    or job.created_by is distinct from p_payer_id
    or job.preparation_snapshot->'execution_selection'->>'source' is distinct from 'personal_api_key' then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
  end if;
  select m.* into mandate from private.takeoff_api_mandates m
  where m.id = (job.preparation_snapshot->'execution_selection'->>'authorizationId')::uuid
    and m.tenant_id = p_tenant_id and m.project_id = p_project_id and m.payer_id = p_payer_id;
  if not found or (job.launch_request_id is not null and not exists (
    select 1 from public.takeoff_launch_requests r where r.id = job.launch_request_id and r.state = 'admitted'
      and r.tenant_id = p_tenant_id and r.project_id = p_project_id and r.payer_id = p_payer_id
      and r.mandate_selection = job.preparation_snapshot->'execution_selection'
  )) then
    raise exception 'TAKEOFF_API_MANDATE_INVALID' using errcode = '42501';
  end if;
  billing_scope := coalesce(job.launch_request_id, job.id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-api:' || billing_scope::text, 0));
  if job.processing_lease_expires_at <= pg_catalog.clock_timestamp() or (job.launch_unit_key like 'plan:%'
    and private.takeoff_count_mark_lease_live(job, p_lease_token) is not true) then
    raise exception 'TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED' using errcode = '42501';
  end if;
  select s.reason into refusal from private.takeoff_api_budget_stops s
  where s.mandate_id = mandate.id and s.scope_id = billing_scope;
  if not found then
    refusal := private.takeoff_job_payment_refusal(job, p_module_default);
    if refusal is not null then
      insert into private.takeoff_api_budget_stops (mandate_id, scope_id, reason) values (mandate.id, billing_scope, refusal);
    end if;
  end if;
  if refusal is not null then
    return query select refusal, 0::bigint, 0::bigint, null::uuid;
    return;
  end if;
  if p_branch = 'count_tile' then
    schedule := private.takeoff_confirmed_count_mark_schedule(job);
    if not exists (
      select 1 from jsonb_array_elements(schedule -> 'pages') s
      cross join lateral generate_series(1, case when (s->>'width_points')::numeric > 700 then 6 else 4 end) t(i)
      where p_tile_key = 'tile:' || ((s->>'page')::numeric::integer)::text || ':' || t.i::text
    ) then
      return query select 'TILE_OUTSIDE_SCOPE'::text, 0::bigint, 0::bigint, null::uuid;
      return;
    end if;
    if exists (select 1 from private.takeoff_api_calls c where c.mandate_id = mandate.id and c.scope_id = billing_scope
      and c.tile_key = p_tile_key) then
      return query select 'TILE_ALREADY_ATTEMPTED'::text, 0::bigint, 0::bigint, null::uuid;
      return;
    end if;
  end if;
  if exists (select 1 from private.takeoff_api_calls c where c.mandate_id = mandate.id and c.scope_id = billing_scope
    and c.settled_at is not null and (c.actual_nano_usd is null or c.actual_tokens is null)) then
    return query select 'USAGE_UNKNOWN'::text, 0::bigint, 0::bigint, null::uuid;
    return;
  end if;
  select (mandate.settings->>'maxNanoUsd')::bigint - coalesce(sum(coalesce(c.actual_nano_usd, c.bound_nano_usd)), 0),
    (mandate.settings->>'maxTokens')::bigint - coalesce(sum(coalesce(c.actual_tokens, c.bound_tokens)), 0)
  into usd_left, tokens_left from private.takeoff_api_calls c where c.mandate_id = mandate.id and c.scope_id = billing_scope;
  if p_exhausted or usd_left <= 0 or tokens_left <= 0 or p_bound > usd_left or p_tokens > tokens_left then
    -- A preparation that cannot fit first waits for live reservations. An abandoned lease keeps its full bound.
    select exists (select 1 from private.takeoff_api_calls c join public.takeoff_jobs j on j.id = c.job_id
      where c.mandate_id = mandate.id and c.scope_id = billing_scope and c.settled_at is null
        and j.status = 'processing' and j.processing_lease_token = c.lease_token
        and j.processing_lease_expires_at > pg_catalog.clock_timestamp()) into capacity_held;
    if capacity_held then
      return query select 'CAPACITY_HELD'::text, greatest(0, usd_left), greatest(0, tokens_left), null::uuid;
      return;
    end if;
    if usd_left > 0 and tokens_left > 0 and (not p_exhausted or usd_left > p_bound or tokens_left > p_tokens) then
      return query select 'REPREPARE'::text, usd_left, tokens_left, null::uuid;
      return;
    end if;
    insert into private.takeoff_api_budget_stops (mandate_id, scope_id, reason) values (mandate.id, billing_scope, 'BUDGET_EXHAUSTED');
    return query select 'BUDGET_EXHAUSTED'::text, greatest(0, usd_left), greatest(0, tokens_left), null::uuid;
    return;
  end if;
  if p_bound is not null or p_tokens is not null then
    insert into private.takeoff_api_calls (mandate_id, scope_id, job_id, lease_token, branch, tile_key, bound_nano_usd, bound_tokens)
    values (mandate.id, billing_scope, job.id, p_lease_token, p_branch, p_tile_key, p_bound, p_tokens) returning id into reserved;
  end if;
  return query select null::text, usd_left, tokens_left, reserved;
end;
$$;

create function public.settle_takeoff_api_call(
  p_call_id uuid, p_job_id uuid, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid, p_lease_token uuid,
  p_cost bigint default null, p_tokens bigint default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  billing_scope uuid;
  settled private.takeoff_api_calls;
  lease_expires_at timestamptz;
begin
  -- Lock the job before the billing scope, as reservation does. An expired or
  -- superseded lease may neither settle a reservation nor replay its receipt.
  select j.processing_lease_expires_at into lease_expires_at from public.takeoff_jobs j
  where j.id = p_job_id and j.tenant_id = p_tenant_id and j.project_id = p_project_id and j.created_by = p_payer_id
    and j.status = 'processing' and j.processing_lease_token = p_lease_token
  for update;
  if not found or lease_expires_at is null or lease_expires_at <= pg_catalog.clock_timestamp() then return false; end if;
  select c.scope_id into billing_scope from private.takeoff_api_calls c join private.takeoff_api_mandates m on m.id = c.mandate_id
  where c.id = p_call_id and c.job_id = p_job_id and c.lease_token = p_lease_token
    and m.tenant_id = p_tenant_id and m.project_id = p_project_id and m.payer_id = p_payer_id;
  if not found then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('takeoff-api:' || billing_scope::text, 0));
  if lease_expires_at <= pg_catalog.clock_timestamp() then return false; end if;
  update private.takeoff_api_calls c set actual_nano_usd = p_cost, actual_tokens = p_tokens, settled_at = pg_catalog.clock_timestamp()
  where c.id = p_call_id and c.settled_at is null returning c.* into settled;
  if not found then
    return exists(select 1 from private.takeoff_api_calls c where c.id = p_call_id and c.settled_at is not null
      and c.actual_nano_usd is not distinct from p_cost and c.actual_tokens is not distinct from p_tokens);
  end if;
  if p_cost > settled.bound_nano_usd or p_tokens > settled.bound_tokens then
    insert into private.takeoff_api_budget_stops (mandate_id, scope_id, reason)
    values (settled.mandate_id, billing_scope, 'BUDGET_EXHAUSTED') on conflict do nothing;
  end if;
  return true;
end;
$$;

-- Recover from the hosted sweep even when the credential holder is offline. The Mac can also run this for its own queue.
-- The persisted deadline follows the original lease expiry, not the time at which the first sweep happened to see it.
create function public.recover_takeoff_payment_jobs(p_now timestamptz, p_host_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  recovery_at timestamptz := least(p_now, pg_catalog.clock_timestamp());
  activation private.takeoff_completion_activation;
  wait_ceiling interval;
begin
  if p_now is null then raise exception 'TAKEOFF_RECOVERY_ARGUMENT_INVALID' using errcode = '22023'; end if;
  select * into activation from private.takeoff_completion_activation;
  wait_ceiling := coalesce(activation.wait_ceiling, interval '24 hours');
  perform pg_catalog.set_config('mergeone.takeoff_payment_recovery', 'on', true);
  with expired as (
    select j.id, j.status, dates.lease_end, j.status = 'processing' and j.retry_count < 3
      and greatest(dates.lease_end, activation.active_from) > recovery_at - wait_ceiling as retry
    from public.takeoff_jobs j
    cross join lateral (select
      coalesce(j.processing_lease_expires_at, coalesce(j.started_at, j.updated_at) + interval '10 minutes') as lease_end,
      greatest(activation.active_from, case when j.status = 'pending' then coalesce(j.analysis_queued_at, j.created_at)
        else j.next_retry_at end) as waiting_since) dates
    where j.analysis_outcome is null and j.preparation_snapshot->'execution_selection'->>'source' in ('chatgpt_plan', 'personal_api_key')
      and (p_host_id is null or j.execution_host_id = p_host_id)
      and ((j.status = 'processing' and dates.lease_end <= recovery_at)
        or ((j.status = 'pending' or (j.status = 'failed' and j.next_retry_at is not null))
          and dates.waiting_since <= recovery_at - wait_ceiling))
    order by j.id limit 20 for update of j skip locked
  )
  update public.takeoff_jobs j set status = 'failed', completed_at = recovery_at, last_error_at = recovery_at,
    next_retry_at = case when expired.retry then expired.lease_end end,
    analysis_outcome = case when not expired.retry then 'failure' end,
    processing_lease_token = null, processing_lease_expires_at = null,
    error_code = case when expired.retry then 'TAKEOFF_WORKER_OUTCOME_UNKNOWN' else 'TAKEOFF_WORKER_QUEUE_EXPIRED' end,
    error_message = case when expired.retry
      then 'Le traitement du métré a été interrompu. Les dépenses réservées et les résultats enregistrés sont conservés.'
      else 'Le métré n’a pas repris avant la fin du délai d’attente du poste autorisé. Les résultats déjà enregistrés sont conservés.' end
  from expired where j.id = expired.id and j.status = expired.status and j.analysis_outcome is null
    and (j.status <> 'processing'
      or coalesce(j.processing_lease_expires_at, coalesce(j.started_at, j.updated_at) + interval '10 minutes') <= recovery_at);
  perform pg_catalog.set_config('mergeone.takeoff_payment_recovery', '', true);
end;
$$;

revoke all on function private.assert_takeoff_api_scope(jsonb, uuid, uuid, uuid, text),
  private.guard_takeoff_api_request(), private.guard_takeoff_api_job() from public, anon, authenticated, service_role;

revoke all on function public.seal_takeoff_api_mandate(uuid,uuid,uuid,uuid,jsonb),
  public.read_takeoff_api_mandate(uuid,uuid,uuid,uuid),
  public.claim_explicit_takeoff_payment_job(uuid,uuid,text,timestamptz,uuid,timestamptz,text,text,text,integer),
  public.reserve_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,boolean,text,bigint,bigint,boolean,text),
  public.settle_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint),
  public.dispatch_next_takeoff_payment_job(text, boolean), public.recover_takeoff_payment_jobs(timestamptz, text) from public, anon, authenticated;

grant execute on function public.seal_takeoff_api_mandate(uuid,uuid,uuid,uuid,jsonb),
  public.read_takeoff_api_mandate(uuid,uuid,uuid,uuid),
  public.claim_explicit_takeoff_payment_job(uuid,uuid,text,timestamptz,uuid,timestamptz,text,text,text,integer),
  public.reserve_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,boolean,text,bigint,bigint,boolean,text),
  public.settle_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint),
  public.dispatch_next_takeoff_payment_job(text, boolean), public.recover_takeoff_payment_jobs(timestamptz, text) to service_role;

-- A recovered API job may retry because its prior paid calls still hold their full reservations.
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
    if new.status = 'failed' and (
      (new.analysis_outcome = 'failure' and new.error_code = 'TAKEOFF_WORKER_OUTCOME_UNKNOWN')
      or (old.preparation_snapshot->'execution_selection'->>'source' in ('chatgpt_plan', 'personal_api_key')
        and current_setting('mergeone.takeoff_payment_recovery', true) = 'on'
        and new.error_code in ('TAKEOFF_WORKER_OUTCOME_UNKNOWN', 'TAKEOFF_WORKER_QUEUE_EXPIRED'))
    ) then
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

commit;
