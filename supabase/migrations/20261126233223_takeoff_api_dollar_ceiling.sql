-- Owner decision of 2026-11-27: a takeoff request paid by a personal OpenAI key has no token ceiling. Its only bound is
-- the dollar ceiling its mandate seals (maxNanoUsd), reserved before each call and shared by the request's jobs.
--
-- Additive: three functions of 20261126190635_takeoff_personal_api_mandate.sql are replaced with their signatures, owners
-- and grants unchanged (service_role only). No table, column, row or right changes.
--   * seal_takeoff_api_mandate accepts a mandate whose maxTokens is null (no token ceiling). A positive number is still
--     accepted and recorded as sent, so a caller older than this migration keeps sealing.
--   * reserve_takeoff_api_call refuses on dollars only. A mandate already sealed with a token number stays readable and
--     that number bounds nothing any more. Unchanged: the payer and module checks, the lease, the confirmed tiles and
--     the confirmed calls of each lane, the freeze on an unknown usage, the wait for live reservations, the budget stop.
--     Each reservation still records its call's token estimate (bound_tokens).
--   * settle_takeoff_api_call records the tokens a call used and stops the request only when the call cost more than the
--     dollars it reserved.
begin;
set local lock_timeout = '5s';

create or replace function public.seal_takeoff_api_mandate(
  p_id uuid, p_tenant_id uuid, p_project_id uuid, p_payer_id uuid, p_settings jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.takeoff_launch_payer_eligible(p_tenant_id, p_project_id, p_payer_id) then
    raise exception 'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE' using errcode = '42501';
  end if;
  if (p_settings->>'connectionId')::uuid is null or coalesce((p_settings->>'connectionVersion')::bigint, 0) <= 0
    or coalesce((p_settings->>'maxNanoUsd')::bigint, 0) <= 0
    -- No token ceiling: null. The positive number a caller older than this migration still sends is recorded as sent.
    or not (p_settings ? 'maxTokens') or (pg_catalog.jsonb_typeof(p_settings->'maxTokens') <> 'null'
      and coalesce((p_settings->>'maxTokens')::bigint, 0) <= 0)
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

create or replace function public.reserve_takeoff_api_call(
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
  classifier_calls integer;
  lane_calls integer;
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
  schedule := private.takeoff_confirmed_count_mark_schedule(job);
  if p_branch = 'count_tile' then
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
  if schedule is not null and p_branch <> 'count_tile' then
    select private.takeoff_count_mark_classifier_calls(private.takeoff_launch_unit(r.manifest, job.launch_unit_key),
      jsonb_array_length(schedule -> 'pages')) into classifier_calls
    from public.takeoff_launch_requests r where r.id = job.launch_request_id;
    lane_calls := case p_branch when 'pdf' then (schedule ->> 'other_calls')::integer - classifier_calls
      when 'vector_group' then classifier_calls else 0 end;
    -- The confirmed lane counts every reservation, across leases, just like the subscription ledger.
    if (select count(*) from private.takeoff_api_calls c where c.mandate_id = mandate.id and c.scope_id = billing_scope
      and c.branch = p_branch) >= lane_calls then
      return query select 'BUDGET_EXHAUSTED'::text, 0::bigint, 0::bigint, null::uuid;
      return;
    end if;
  end if;
  -- The dollars left decide. `tokens_left` bounds nothing; an admitted call reports it for a worker older than this
  -- migration: null for a mandate sealed without a token ceiling, else what is left of the number the mandate carries.
  select (mandate.settings->>'maxNanoUsd')::bigint - coalesce(sum(coalesce(c.actual_nano_usd, c.bound_nano_usd)), 0),
    (mandate.settings->>'maxTokens')::bigint - coalesce(sum(coalesce(c.actual_tokens, c.bound_tokens)), 0)
  into usd_left, tokens_left from private.takeoff_api_calls c where c.mandate_id = mandate.id and c.scope_id = billing_scope;
  if p_exhausted or usd_left <= 0 or p_bound > usd_left then
    -- A preparation that cannot fit first waits for live reservations. An abandoned lease keeps its full bound.
    select exists (select 1 from private.takeoff_api_calls c join public.takeoff_jobs j on j.id = c.job_id
      where c.mandate_id = mandate.id and c.scope_id = billing_scope and c.settled_at is null
        and j.status = 'processing' and j.processing_lease_token = c.lease_token
        and j.processing_lease_expires_at > pg_catalog.clock_timestamp()) into capacity_held;
    if capacity_held then
      return query select 'CAPACITY_HELD'::text, greatest(0, usd_left), greatest(0, tokens_left), null::uuid;
      return;
    end if;
    if usd_left > 0 and (not p_exhausted or usd_left > p_bound) then
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

create or replace function public.settle_takeoff_api_call(
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
  -- Only a call that cost more than the dollars it reserved stops its request. Its tokens are recorded, never compared.
  if p_cost > settled.bound_nano_usd then
    insert into private.takeoff_api_budget_stops (mandate_id, scope_id, reason)
    values (settled.mandate_id, billing_scope, 'BUDGET_EXHAUSTED') on conflict do nothing;
  end if;
  return true;
end;
$$;

commit;
