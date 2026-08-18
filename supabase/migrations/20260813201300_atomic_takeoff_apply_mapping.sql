-- Apply takeoff lines and every selected mapping transformation in one
-- PostgreSQL transaction. The historical RPC remains the low-level line
-- materializer, but it is no longer callable through its former guarded API.

alter table public.takeoff_jobs
  add column if not exists dispatch_status text,
  add column if not exists dispatch_outcome text,
  add column if not exists dispatch_trigger text,
  add column if not exists dispatch_correlation_id uuid,
  add column if not exists dispatch_status_code integer,
  add column if not exists dispatch_updated_at timestamptz;

alter table public.takeoff_jobs
  drop constraint if exists takeoff_jobs_dispatch_state_check;
alter table public.takeoff_jobs
  add constraint takeoff_jobs_dispatch_state_check check (
    (
      dispatch_status is null
      and dispatch_outcome is null
      and dispatch_trigger is null
      and dispatch_correlation_id is null
      and dispatch_status_code is null
      and dispatch_updated_at is null
    )
    or (
      dispatch_status in ('started', 'queued', 'trigger_failed')
      and dispatch_outcome in (
        'accepted',
        'configuration_missing',
        'http_error',
        'timeout',
        'network_error'
      )
      and dispatch_trigger in ('create', 'retry', 'manual', 'reconcile')
      and dispatch_correlation_id is not null
      and (
        dispatch_status_code is null
        or dispatch_status_code between 100 and 599
      )
      and dispatch_updated_at is not null
    )
  );

create index if not exists takeoff_jobs_dispatch_attention_idx
  on public.takeoff_jobs (tenant_id, dispatch_updated_at desc)
  where dispatch_status in ('queued', 'trigger_failed');

create or replace function public.record_takeoff_dispatch_outcome(
  p_job_id uuid,
  p_trigger text,
  p_correlation_id uuid,
  p_outcome text,
  p_status_code integer default null
)
returns table (
  job_id uuid,
  dispatch_status text,
  dispatch_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  resolved_status text;
begin
  if p_job_id is null
    or p_correlation_id is null
    or p_trigger not in ('create', 'retry', 'manual', 'reconcile')
    or p_outcome not in (
      'accepted',
      'configuration_missing',
      'http_error',
      'timeout',
      'network_error'
    )
    or (p_status_code is not null and p_status_code not between 100 and 599)
  then
    raise exception 'TAKEOFF_DISPATCH_OUTCOME_INVALID' using errcode = '22023';
  end if;

  if current_user <> 'service_role' then
    raise exception 'TAKEOFF_DISPATCH_SERVICE_ROLE_REQUIRED'
      using errcode = '42501';
  end if;

  resolved_status := case
    when p_outcome = 'accepted' then 'started'
    when p_outcome = 'configuration_missing' then 'queued'
    else 'trigger_failed'
  end;

  return query
  update public.takeoff_jobs as job
  set
    dispatch_status = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_status
      else resolved_status
    end,
    dispatch_outcome = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_outcome
      else p_outcome
    end,
    dispatch_trigger = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_trigger
      else p_trigger
    end,
    dispatch_correlation_id = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_correlation_id
      else p_correlation_id
    end,
    dispatch_status_code = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_status_code
      else p_status_code
    end,
    dispatch_updated_at = case
      when job.dispatch_status = 'started'
        and job.dispatch_correlation_id = p_correlation_id
        and resolved_status <> 'started'
      then job.dispatch_updated_at
      else statement_timestamp()
    end
  where job.id = p_job_id
  returning job.id, job.dispatch_status, job.dispatch_updated_at;

  if not found then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.record_takeoff_dispatch_outcome(
  uuid, text, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.record_takeoff_dispatch_outcome(
  uuid, text, uuid, text, integer
) to service_role;

create or replace function public.enforce_authenticated_takeoff_job_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_tenant_id uuid;
  parent_version_status text;
  dispatch_fields text[] := array[
    'dispatch_status',
    'dispatch_outcome',
    'dispatch_trigger',
    'dispatch_correlation_id',
    'dispatch_status_code',
    'dispatch_updated_at'
  ];
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select estimate_version.tenant_id, estimate_version.status::text
      into parent_tenant_id, parent_version_status
    from public.estimate_versions as estimate_version
    where estimate_version.id = new.estimate_version_id;

    if parent_tenant_id is null
      or new.tenant_id is distinct from parent_tenant_id
      or parent_version_status is distinct from 'draft'
    then
      raise exception 'TAKEOFF_JOB_VERSION_SCOPE_INVALID' using errcode = '42501';
    end if;

    if new.status <> 'pending'
      or new.created_by is distinct from (select auth.uid())
      or new.retry_count <> 0
      or new.started_at is not null
      or new.completed_at is not null
      or new.token_count is not null
      or new.cost_cents is not null
      or new.duration_ms is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.model is not null
      or new.thinking_level is not null
      or new.media_resolution is not null
      or new.provider_batch_id is not null
      or new.provider_batch_state is not null
      or new.provider_batch_updated_at is not null
      or new.provider_reconcile_due_at is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or new.dispatch_status is not null
      or new.dispatch_outcome is not null
      or new.dispatch_trigger is not null
      or new.dispatch_correlation_id is not null
      or new.dispatch_status_code is not null
      or new.dispatch_updated_at is not null
    then
      raise exception 'TAKEOFF_JOB_INITIAL_STATE_INVALID' using errcode = '42501';
    end if;

    if new.plan_set_id is not null
      and (
        new.level = 'A'
        or not exists (
          select 1
          from public.plan_sets as plan_set
          join public.estimate_versions as estimate_version
            on estimate_version.id = new.estimate_version_id
            and estimate_version.tenant_id = new.tenant_id
          where plan_set.id = new.plan_set_id
            and plan_set.tenant_id = new.tenant_id
            and plan_set.project_id = estimate_version.project_id
        )
      )
    then
      raise exception 'TAKEOFF_JOB_PLAN_SET_SCOPE_INVALID' using errcode = '42501';
    end if;

    if new.plan_set_id is null
      and (
        new.source_file_path is null
        or new.source_file_path not like
          new.tenant_id::text || '/' || new.id::text || '/%'
      )
    then
      raise exception 'TAKEOFF_JOB_SOURCE_PATH_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.dispatch_status is distinct from old.dispatch_status
    or new.dispatch_outcome is distinct from old.dispatch_outcome
    or new.dispatch_trigger is distinct from old.dispatch_trigger
    or new.dispatch_correlation_id is distinct from old.dispatch_correlation_id
    or new.dispatch_status_code is distinct from old.dispatch_status_code
    or new.dispatch_updated_at is distinct from old.dispatch_updated_at
  then
    raise exception 'TAKEOFF_JOB_DISPATCH_FIELDS_IMMUTABLE'
      using errcode = '42501';
  end if;

  if old.status in ('pending', 'processing') and new.status = 'canceled' then
    if new.next_retry_at is not null
      or new.error_code is not null
      or new.error_message is not null
      or (to_jsonb(new) - array[
        'status', 'completed_at', 'next_retry_at', 'error_code',
        'error_message', 'updated_at'
      ]) is distinct from (to_jsonb(old) - array[
        'status', 'completed_at', 'next_retry_at', 'error_code',
        'error_message', 'updated_at'
      ])
    then
      raise exception 'TAKEOFF_JOB_CANCEL_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status in ('failed', 'canceled') and new.status = 'pending' then
    if old.retry_count not between 0 and 2
      or (
        old.status = 'failed'
        and old.completed_at is not null
        and statement_timestamp() < old.completed_at + case old.retry_count
          when 0 then interval '5 seconds'
          when 1 then interval '15 seconds'
          else interval '45 seconds'
        end
      )
      or (
        old.provider_batch_id is not null
        and (
          old.processing_strategy <> 'batch'
          or old.provider_batch_state is null
          or old.provider_batch_state::text not in ('failed', 'cancelled', 'expired')
        )
      )
      or new.retry_count <> old.retry_count + 1
      or new.started_at is not null
      or new.completed_at is not null
      or new.token_count is not null
      or new.cost_cents is not null
      or new.duration_ms is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.provider_batch_id is not null
      or new.provider_batch_state is not null
      or new.provider_batch_updated_at is not null
      or new.provider_reconcile_due_at is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or (to_jsonb(new) - (
        array[
          'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
          'cost_cents', 'duration_ms', 'error_code', 'error_message',
          'next_retry_at', 'last_error_at', 'provider_batch_id',
          'provider_batch_state', 'provider_batch_updated_at',
          'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
          'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
          'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'status', 'retry_count', 'started_at', 'completed_at', 'token_count',
          'cost_cents', 'duration_ms', 'error_code', 'error_message',
          'next_retry_at', 'last_error_at', 'provider_batch_id',
          'provider_batch_state', 'provider_batch_updated_at',
          'provider_reconcile_due_at', 'provider_reconcile_attempt_count',
          'provider_reconcile_lease_token', 'provider_reconcile_lease_expires_at',
          'updated_at'
        ] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_RETRY_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'failed' and new.status = 'processing' then
    if new.processing_strategy <> 'batch'
      or new.provider_batch_id is null
      or old.provider_batch_state is null
      or old.provider_batch_state::text not in (
        'submitted', 'pending', 'running', 'unknown', 'succeeded'
      )
      or (
        old.provider_reconcile_lease_expires_at is not null
        and old.provider_reconcile_lease_expires_at > statement_timestamp()
      )
      or new.retry_count is distinct from old.retry_count
      or new.completed_at is not null
      or new.next_retry_at is not null
      or new.last_error_at is not null
      or new.error_code is not null
      or new.error_message is not null
      or new.provider_reconcile_attempt_count <> 0
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or not coalesce(
        new.provider_reconcile_due_at between
          statement_timestamp() - interval '5 minutes'
          and statement_timestamp() + interval '5 minutes',
        false
      )
      or (to_jsonb(new) - (
        array[
          'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
          'error_message', 'provider_reconcile_due_at',
          'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'status', 'completed_at', 'next_retry_at', 'last_error_at', 'error_code',
          'error_message', 'provider_reconcile_due_at',
          'provider_reconcile_attempt_count', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_RECONCILE_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'processing' and new.status = 'processing' then
    if new.processing_strategy <> 'batch'
      or new.provider_batch_id is null
      or old.provider_batch_state is null
      or (
        old.provider_reconcile_lease_expires_at is not null
        and old.provider_reconcile_lease_expires_at > statement_timestamp()
      )
      or new.provider_reconcile_attempt_count is distinct from old.provider_reconcile_attempt_count
      or new.provider_reconcile_lease_token is not null
      or new.provider_reconcile_lease_expires_at is not null
      or not coalesce(
        new.provider_reconcile_due_at between
          statement_timestamp() - interval '5 minutes'
          and statement_timestamp() + interval '5 minutes',
        false
      )
      or (to_jsonb(new) - (
        array[
          'provider_reconcile_due_at', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array[
          'provider_reconcile_due_at', 'provider_reconcile_lease_token',
          'provider_reconcile_lease_expires_at', 'updated_at'
        ] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_RECONCILE_FIELDS_INVALID' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.status = 'completed' and new.status = 'applied' then
    if not coalesce(current_setting('app.takeoff_apply_job', true) = 'on', false)
      or (to_jsonb(new) - (
        array['status', 'completed_at', 'updated_at'] || dispatch_fields
      )) is distinct from (to_jsonb(old) - (
        array['status', 'completed_at', 'updated_at'] || dispatch_fields
      ))
    then
      raise exception 'TAKEOFF_JOB_APPLY_RPC_REQUIRED' using errcode = '42501';
    end if;
    return new;
  end if;

  raise exception 'TAKEOFF_JOB_OPERATOR_UPDATE_DENIED' using errcode = '42501';
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_job_fields()
  from public;

create or replace function public.takeoff_round_half_even(p_value numeric)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when abs(p_value - trunc(p_value)) = 0.5 then
      case
        when mod(abs(trunc(p_value)), 2) = 0 then trunc(p_value)::bigint
        else (trunc(p_value) + sign(p_value))::bigint
      end
    else round(p_value)::bigint
  end;
$$;

revoke all on function public.takeoff_round_half_even(numeric)
  from public, anon, authenticated;

create or replace function public.takeoff_allocate_pro_rata(
  p_amount bigint,
  p_weights bigint[]
)
returns bigint[]
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  item_count integer := coalesce(cardinality(p_weights), 0);
  safe_amount bigint := greatest(coalesce(p_amount, 0), 0);
  total_weight numeric := 0;
  exact_share numeric;
  parts bigint[];
  fractions numeric[];
  remainder bigint;
  selected_index integer;
  item_index integer;
begin
  if item_count = 0 then
    return '{}'::bigint[];
  end if;

  parts := array_fill(0::bigint, array[item_count]);
  fractions := array_fill(0::numeric, array[item_count]);

  if safe_amount = 0 then
    return parts;
  end if;

  for item_index in 1..item_count loop
    total_weight := total_weight + greatest(
      coalesce(p_weights[item_index], 0),
      0
    );
  end loop;

  for item_index in 1..item_count loop
    exact_share := case
      when total_weight > 0 then
        safe_amount::numeric
          * greatest(coalesce(p_weights[item_index], 0), 0)::numeric
          / total_weight
      else safe_amount::numeric / item_count::numeric
    end;
    parts[item_index] := floor(exact_share)::bigint;
    fractions[item_index] := exact_share - floor(exact_share);
  end loop;

  remainder := safe_amount - (
    select coalesce(sum(part), 0)
    from unnest(parts) as allocated(part)
  );

  while remainder > 0 loop
    selected_index := 1;
    if item_count > 1 then
      for item_index in 2..item_count loop
        if fractions[item_index] > fractions[selected_index] then
          selected_index := item_index;
        end if;
      end loop;
    end if;
    parts[selected_index] := parts[selected_index] + 1;
    fractions[selected_index] := -1;
    remainder := remainder - 1;
  end loop;

  return parts;
end;
$$;

revoke all on function public.takeoff_allocate_pro_rata(bigint, bigint[])
  from public, anon, authenticated;

-- Commercial rounding is normally service-role managed. The atomic takeoff
-- RPC also recalculates the complete draft footer, so this one guarded
-- transaction must be allowed to keep the explicit rounding amount coherent.
create or replace function public.guard_estimate_rounding_adjustment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
    and not (
      (
        current_user = 'service_role'
        and coalesce(
          pg_catalog.current_setting(
            'miaouffrage.estimate_v2_snapshot_freeze',
            true
          ),
          ''
        ) = 'on'
      )
      or coalesce(
        pg_catalog.current_setting('app.takeoff_apply_atomic', true),
        ''
      ) = 'on'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_ROUNDING_ADJUSTMENT_IS_MANAGED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_rounding_adjustment()
  from public, anon, authenticated;

-- The historical materializer uses current_tenant_id(), which deliberately
-- resolves the caller's default active tenant. Keep the atomic wrapper aligned
-- with that canonical context before entering the definer-owned transaction.
create or replace function public.assert_takeoff_active_tenant(
  p_job_id uuid,
  p_expected_tenant_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if p_job_id is null
    or p_expected_tenant_id is null
    or public.current_tenant_id() is distinct from p_expected_tenant_id
  then
    raise exception 'TAKEOFF_ACTIVE_TENANT_MISMATCH' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.assert_takeoff_active_tenant(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.recalculate_takeoff_estimate_version(
  p_version_id uuid,
  p_tenant_id uuid
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  labor_split_enabled boolean := false;
  raw_cost_subtotal numeric := 0;
  effective_margin numeric;
  raw_ht bigint := 0;
  raw_tax bigint := 0;
  scaled_ht integer := 0;
  scaled_tax integer := 0;
  discount_cents integer := 0;
  running_ht integer := 0;
  step_bp integer := 0;
  step_discount integer := 0;
  total_ht integer := 0;
  true_tax integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
  unrounded_ttc integer := 0;
  rounding_adjustment integer := 0;
  effective_tax_rate_bp integer := 0;
  global_coefficient numeric := 1;
  rounding_step integer := 1;
  coefficient_shares bigint[] := '{}'::bigint[];
  discount_shares bigint[] := '{}'::bigint[];
  gross_sale_weights bigint[] := '{}'::bigint[];
  net_tax_weights bigint[] := '{}'::bigint[];
  adjusted_tax_shares bigint[] := '{}'::bigint[];
  max_cents constant integer := 2147483647;
begin
  if coalesce(
    current_setting('app.takeoff_apply_atomic', true),
    ''
  ) <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  select version.*
    into target_version
  from public.estimate_versions as version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'ESTIMATE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_version.status <> 'draft'::public.estimate_status then
    raise exception 'ESTIMATE_VERSION_READ_ONLY' using errcode = '42501';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_projects as project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id;

  if project_owner_id is null then
    raise exception 'ESTIMATE_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags as flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  drop table if exists pg_temp._atomic_takeoff_line_calculations;
  create temporary table _atomic_takeoff_line_calculations (
    sequence integer not null unique,
    id uuid primary key,
    quantity numeric not null,
    cost_line_cents bigint not null,
    sale_line_cents integer,
    pu_ht_cents integer,
    tax_rate_bp integer not null,
    line_tax_cents integer,
    line_total_ttc_cents integer,
    coefficient_share_cents integer,
    discount_share_cents integer,
    net_ht_cents integer,
    net_tax_cents integer
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_line_calculations (
    sequence,
    id,
    quantity,
    cost_line_cents,
    tax_rate_bp
  )
  select
    row_number() over (order by item.position, item.id)::integer,
    item.id,
    greatest(coalesce(item.quantity, 0), 0),
    least(
      max_cents,
      greatest(
        0,
        floor(
          least(
            max_cents::numeric,
            greatest(coalesce(item.quantity, 0), 0)
              * greatest(coalesce(item.unit_price_ht_cents, 0), 0)
              * greatest(coalesce(item.k_fo, 1), 0)
            + case
                when labor_split_enabled and (
                  coalesce(item.h_mo_atelier, 0) > 0
                  or item.labor_role_atelier_id is not null
                  or coalesce(item.h_mo_chantier, 0) > 0
                  or item.labor_role_chantier_id is not null
                  or coalesce(item.k_mo_atelier, 1) <> 1
                  or coalesce(item.k_mo_chantier, 1) <> 1
                ) then
                  greatest(coalesce(item.h_mo_majoration, 1), 0) * (
                    greatest(coalesce(item.h_mo_atelier, 0), 0)
                      * greatest(coalesce(role_atelier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_atelier, 1), 0)
                    + greatest(coalesce(item.h_mo_chantier, 0), 0)
                      * greatest(coalesce(role_chantier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_chantier, 1), 0)
                  )
                else
                  greatest(coalesce(item.h_mo_majoration, 1), 0)
                    * greatest(coalesce(item.h_mo, 0), 0)
                    * greatest(coalesce(role_legacy.hourly_rate_cents, 0), 0)
                    * greatest(coalesce(item.k_mo, 1), 0)
              end
          ) + 0.5
        )
      )
    ),
    case
      when target_version.contractor_role = 'subcontractor' then 0
      when coalesce(target_version.calc_engine_version, 1) = 2
        then greatest(coalesce(item.tax_rate_bp, target_version.tax_rate_bp, 0), 0)
      else greatest(coalesce(target_version.tax_rate_bp, item.tax_rate_bp, 0), 0)
    end
  from public.estimate_items as item
  left join public.labor_roles as role_legacy
    on role_legacy.id = item.labor_role_id
   and role_legacy.tenant_id = target_version.tenant_id
   and role_legacy.user_id = project_owner_id
  left join public.labor_roles as role_atelier
    on role_atelier.id = item.labor_role_atelier_id
   and role_atelier.tenant_id = target_version.tenant_id
   and role_atelier.user_id = project_owner_id
  left join public.labor_roles as role_chantier
    on role_chantier.id = item.labor_role_chantier_id
   and role_chantier.tenant_id = target_version.tenant_id
   and role_chantier.user_id = project_owner_id
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  select coalesce(sum(calculation.cost_line_cents), 0)
    into raw_cost_subtotal
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
    select least(greatest(tier.multiplier, 0), 100)
      into effective_margin
    from public.margin_tiers as tier
    where tier.tenant_id = target_version.tenant_id
    order by
      (tier.threshold_cents <= raw_cost_subtotal) desc,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.threshold_cents
      end desc nulls last,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.position
      end desc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.threshold_cents
      end asc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.position
      end asc nulls last,
      tier.id
    limit 1;

    if effective_margin is null then
      effective_margin := case
        when raw_cost_subtotal >= 100000000 then 1.4
        when raw_cost_subtotal >= 10000000 then 1.45
        else 1.6
      end;
    end if;
  else
    effective_margin := least(
      greatest(coalesce(target_version.margin_multiplier, 1), 0),
      100
    );
  end if;

  with computed as (
    select
      calculation.id,
      least(
        max_cents,
        greatest(
          0,
          floor(
            calculation.cost_line_cents::numeric * effective_margin + 0.5
          )
        )
      )::integer as sale_line_cents
    from pg_temp._atomic_takeoff_line_calculations as calculation
  ), complete as (
    select
      computed.id,
      computed.sale_line_cents,
      least(
        max_cents,
        greatest(
          0,
          floor(
            computed.sale_line_cents::numeric
              * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer as line_tax_cents
    from computed
    join pg_temp._atomic_takeoff_line_calculations as calculation
      on calculation.id = computed.id
  )
  update pg_temp._atomic_takeoff_line_calculations as calculation
  set
    sale_line_cents = complete.sale_line_cents,
    pu_ht_cents = case
      when calculation.quantity > 0 then least(
        max_cents,
        greatest(
          0,
          public.takeoff_round_half_even(
            complete.sale_line_cents::numeric / calculation.quantity
          )
        )
      )
      else 0
    end,
    line_tax_cents = complete.line_tax_cents,
    line_total_ttc_cents = least(
      max_cents,
      complete.sale_line_cents + complete.line_tax_cents
    )
  from complete
  where calculation.id = complete.id;

  select
    coalesce(sum(calculation.sale_line_cents), 0),
    coalesce(sum(calculation.line_tax_cents), 0)
    into raw_ht, raw_tax
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  global_coefficient := greatest(
    coalesce(target_version.global_coefficient, 1),
    0
  );
  scaled_ht := least(
    max_cents,
    greatest(
      0,
      public.takeoff_round_half_even(raw_ht::numeric * global_coefficient)
    )
  )::integer;

  effective_tax_rate_bp := case
    when target_version.contractor_role = 'subcontractor' then 0
    else greatest(coalesce(target_version.tax_rate_bp, 0), 0)
  end;
  scaled_tax := case
    when global_coefficient = 1 then least(max_cents, greatest(raw_tax, 0))::integer
    else least(
      max_cents,
      greatest(
        0,
        floor(
          scaled_ht::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
        )::integer
      )
    )
  end;

  if target_version.discount_mode = 'cascade'::public.estimate_discount_mode then
    running_ht := scaled_ht;
    foreach step_bp in array coalesce(target_version.discount_steps, '{}'::integer[]) loop
      step_bp := least(greatest(coalesce(step_bp, 0), 0), 10000);
      step_discount := least(
        running_ht,
        greatest(
          0,
          public.takeoff_round_half_even(
            running_ht::numeric * step_bp::numeric / 10000
          )
        )::integer
      );
      discount_cents := discount_cents + step_discount;
      running_ht := running_ht - step_discount;
      exit when running_ht <= 0;
    end loop;
  else
    step_bp := case
      when coalesce(cardinality(target_version.discount_steps), 0) > 0
        then coalesce(target_version.discount_steps[1], 0)
      else coalesce(target_version.discount_bp, 0)
    end;
    step_bp := least(greatest(step_bp, 0), 10000);
    discount_cents := least(
      scaled_ht,
      greatest(
        0,
        public.takeoff_round_half_even(
          scaled_ht::numeric * step_bp::numeric / 10000
        )
      )::integer
    );
  end if;

  total_ht := greatest(scaled_ht - discount_cents, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.sale_line_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into gross_sale_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    coefficient_shares := public.takeoff_allocate_pro_rata(
      scaled_ht,
      gross_sale_weights
    );
    discount_shares := public.takeoff_allocate_pro_rata(
      discount_cents,
      coefficient_shares
    );

    update pg_temp._atomic_takeoff_line_calculations as calculation
    set
      coefficient_share_cents = coefficient_shares[calculation.sequence],
      discount_share_cents = discount_shares[calculation.sequence],
      net_ht_cents = coefficient_shares[calculation.sequence]
        - discount_shares[calculation.sequence],
      net_tax_cents = least(
        max_cents,
        greatest(
          0,
          floor(
            (
              coefficient_shares[calculation.sequence]
                - discount_shares[calculation.sequence]
            )::numeric * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer;

    select
      coalesce(sum(calculation.net_ht_cents), 0),
      coalesce(sum(calculation.net_tax_cents), 0)
      into total_ht, true_tax
    from pg_temp._atomic_takeoff_line_calculations as calculation;
  else
    true_tax := greatest(
      scaled_tax - floor(
        discount_cents::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
      )::integer,
      0
    );
  end if;

  unrounded_ttc := least(max_cents, total_ht + true_tax);
  total_ttc := unrounded_ttc;
  rounding_step := greatest(coalesce(target_version.rounding_step_cents, 1), 1);

  if target_version.contractor_role <> 'subcontractor' then
    if target_version.rounding_mode = 'nearest'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric + 0.5
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'up'::public.estimate_rounding_mode then
      total_ttc := ceil(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'down'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    end if;
  end if;

  total_ttc := least(max_cents, greatest(total_ttc, total_ht));
  rounding_adjustment := total_ttc - unrounded_ttc;
  total_tax := greatest(total_ttc - total_ht, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.net_tax_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into net_tax_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    adjusted_tax_shares := public.takeoff_allocate_pro_rata(
      total_tax,
      net_tax_weights
    );

    update public.estimate_items as item
    set
      pu_ht_cents = case
        when calculation.quantity > 0 then least(
          max_cents,
          greatest(
            0,
            public.takeoff_round_half_even(
              calculation.net_ht_cents::numeric / calculation.quantity
            )
          )
        )
        else 0
      end,
      line_total_ht_cents = calculation.net_ht_cents,
      line_tax_cents = adjusted_tax_shares[calculation.sequence],
      line_total_ttc_cents = calculation.net_ht_cents
        + adjusted_tax_shares[calculation.sequence],
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  else
    update public.estimate_items as item
    set
      tax_rate_bp = target_version.tax_rate_bp,
      pu_ht_cents = calculation.pu_ht_cents,
      line_total_ht_cents = calculation.sale_line_cents,
      line_tax_cents = calculation.line_tax_cents,
      line_total_ttc_cents = calculation.line_total_ttc_cents,
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  end if;

  update public.estimate_versions as version
  set
    total_ht_cents = total_ht,
    total_tax_cents = total_tax,
    total_ttc_cents = total_ttc,
    rounding_adjustment_cents = rounding_adjustment,
    updated_at = statement_timestamp()
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id;
end;
$$;

revoke all on function public.recalculate_takeoff_estimate_version(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.apply_takeoff_job_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  normalized_strategy text := lower(btrim(coalesce(p_strategy, '')));
  job_row public.takeoff_jobs%rowtype;
  project_owner_id uuid;
  legacy_strategy text;
  legacy_created_count integer := 0;
  legacy_updated_count integer := 0;
  legacy_ignored_count integer := 0;
  legacy_created_ids uuid[] := '{}'::uuid[];
  legacy_scope text;
  mapping_row record;
  assembly_item_ids uuid[];
  assembly_position integer;
  raw_output_count integer := 0;
  assembly_source_count integer := 0;
  mapped_line_count integer := 0;
begin
  if coalesce(current_setting('app.takeoff_apply_job', true), '') <> 'on'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') <> 'on'
  then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  if (select auth.uid()) is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if normalized_strategy not in ('append', 'replace', 'merge') then
    raise exception 'TAKEOFF_APPLY_STRATEGY_INVALID' using errcode = '22023';
  end if;

  if normalized_strategy = 'replace' and p_target_section_id is null then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.*
    into job_row
  from public.takeoff_jobs as job
  where job.id = p_job_id
  for update;

  if job_row.id is null then
    raise exception 'TAKEOFF_JOB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not coalesce(public.has_tenant_role(
    job_row.tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ), false) then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  if job_row.status <> 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_JOB_COMPLETED_REQUIRED' using errcode = 'P0001';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_versions as version
  join public.estimate_projects as project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = job_row.estimate_version_id
    and version.tenant_id = job_row.tenant_id;

  if project_owner_id is null then
    raise exception 'ESTIMATE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_target_section_id is not null and not exists (
    select 1
    from public.estimate_items as target
    where target.id = p_target_section_id
      and target.version_id = job_row.estimate_version_id
      and target.tenant_id = job_row.tenant_id
      and target.item_type = 'section'::public.estimate_item_type
  ) then
    raise exception 'TAKEOFF_TARGET_SECTION_INVALID' using errcode = '22023';
  end if;

  if p_mapping_plan is null
    or jsonb_typeof(p_mapping_plan) <> 'array'
    or exists (
      select 1
      from jsonb_array_elements(p_mapping_plan) as entry(value)
      where jsonb_typeof(entry.value) <> 'object'
        or entry.value - array[
          'item_id',
          'source_order',
          'rule_id',
          'action',
          'designation',
          'unit_price_cents',
          'category_id',
          'assembly_id'
        ] <> '{}'::jsonb
        or not entry.value ?& array[
          'item_id',
          'source_order',
          'rule_id',
          'action',
          'designation',
          'unit_price_cents',
          'category_id',
          'assembly_id'
        ]
    )
  then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_INVALID' using errcode = '22023';
  end if;

  drop table if exists pg_temp._atomic_takeoff_mapping_plan;
  create temporary table _atomic_takeoff_mapping_plan (
    item_id uuid primary key,
    source_order integer not null unique,
    rule_id uuid,
    action text not null,
    designation text not null,
    unit_price_cents integer,
    category_id uuid,
    assembly_id uuid
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_mapping_plan (
    item_id,
    source_order,
    rule_id,
    action,
    designation,
    unit_price_cents,
    category_id,
    assembly_id
  )
  select
    plan.item_id,
    plan.source_order,
    plan.rule_id,
    plan.action,
    btrim(plan.designation),
    plan.unit_price_cents,
    plan.category_id,
    plan.assembly_id
  from jsonb_to_recordset(p_mapping_plan) as plan(
    item_id uuid,
    source_order integer,
    rule_id uuid,
    action text,
    designation text,
    unit_price_cents integer,
    category_id uuid,
    assembly_id uuid
  );

  if (
    select count(*) from pg_temp._atomic_takeoff_mapping_plan
  ) <> (
    select count(*)
    from public.takeoff_items as item
    where item.job_id = job_row.id
      and item.tenant_id = job_row.tenant_id
  ) or exists (
    with expected as (
      select
        item.id,
        (row_number() over (order by item.created_at, item.id) - 1)::integer
          as source_order
      from public.takeoff_items as item
      where item.job_id = job_row.id
        and item.tenant_id = job_row.tenant_id
    )
    select 1
    from expected
    full join pg_temp._atomic_takeoff_mapping_plan as plan
      on plan.item_id = expected.id
    where plan.item_id is null
      or expected.id is null
      or plan.source_order <> expected.source_order
  ) then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_STALE' using errcode = '40001';
  end if;

  if exists (
    select 1
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.source_order < 0
      or plan.action not in (
        'none',
        'rename',
        'set_price',
        'set_category',
        'apply_assembly',
        'skip'
      )
      or char_length(plan.designation) not between 1 and 500
      or (
        plan.action = 'rename'
        and plan.designation = btrim(item.designation)
      )
      or (
        plan.action <> 'rename'
        and plan.designation is distinct from btrim(item.designation)
      )
      or (plan.action = 'set_price') is distinct from
        (plan.unit_price_cents is not null)
      or coalesce(plan.unit_price_cents, 0) < 0
      or (plan.action = 'set_category') is distinct from
        (plan.category_id is not null)
      or (plan.action = 'apply_assembly') is distinct from
        (plan.assembly_id is not null)
      or (
        item.is_excluded
        and (
          plan.action <> 'none'
          or plan.designation is distinct from btrim(item.designation)
          or plan.unit_price_cents is not null
          or plan.category_id is not null
          or plan.assembly_id is not null
        )
      )
  ) then
    raise exception 'TAKEOFF_ATOMIC_MAPPING_PLAN_INVALID' using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_temp._atomic_takeoff_mapping_plan as plan
    left join public.estimate_categories as category
      on category.id = plan.category_id
     and category.tenant_id = job_row.tenant_id
    where plan.action = 'set_category'
      and category.id is null
  ) then
    raise exception 'TAKEOFF_MAPPING_CATEGORY_INVALID' using errcode = '23503';
  end if;

  for mapping_row in
    select plan.assembly_id
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.action = 'apply_assembly'
      and not item.is_excluded
    order by plan.source_order
  loop
    if not exists (
      select 1
      from public.estimate_assemblies as assembly
      where assembly.id = mapping_row.assembly_id
        and assembly.tenant_id = job_row.tenant_id
    ) then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_INVALID' using errcode = '23503';
    end if;

    if not exists (
      select 1
      from public.estimate_assembly_items as item
      where item.assembly_id = mapping_row.assembly_id
        and item.tenant_id = job_row.tenant_id
    ) and not exists (
      select 1
      from public.estimate_assembly_members as member
      where member.parent_assembly_id = mapping_row.assembly_id
        and member.tenant_id = job_row.tenant_id
    ) then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_EMPTY' using errcode = '22023';
    end if;

    if exists (
      with recursive assembly_tree(id) as (
        select mapping_row.assembly_id
        union
        select member.child_assembly_id
        from public.estimate_assembly_members as member
        join assembly_tree as parent
          on parent.id = member.parent_assembly_id
        where member.tenant_id = job_row.tenant_id
      )
      select 1
      from assembly_tree
      join public.estimate_assembly_items as item
        on item.assembly_id = assembly_tree.id
       and item.tenant_id = job_row.tenant_id
      where item.cost_type = 'labor'
        and item.labor_role_id is null
    ) then
      raise exception 'ESTIMATE_ASSEMBLY_LABOR_ROLE_REQUIRED'
        using errcode = '23502';
    end if;

    if exists (
      with recursive assembly_tree(id) as (
        select mapping_row.assembly_id
        union
        select member.child_assembly_id
        from public.estimate_assembly_members as member
        join assembly_tree as parent
          on parent.id = member.parent_assembly_id
        where member.tenant_id = job_row.tenant_id
      )
      select 1
      from assembly_tree
      join public.estimate_assembly_items as item
        on item.assembly_id = assembly_tree.id
       and item.tenant_id = job_row.tenant_id
      left join public.labor_roles as role
        on role.id = item.labor_role_id
       and role.tenant_id = job_row.tenant_id
       and role.user_id = project_owner_id
      where item.labor_role_id is not null
        and role.id is null
    ) then
      raise exception 'ESTIMATE_LABOR_ROLE_OWNER_MISMATCH'
        using errcode = '23503';
    end if;
  end loop;

  perform set_config('app.takeoff_apply_atomic', 'on', true);

  update public.takeoff_items as item
  set
    designation = plan.designation,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_mapping_plan as plan
  where item.id = plan.item_id
    and item.job_id = job_row.id
    and item.tenant_id = job_row.tenant_id
    and not item.is_excluded
    and plan.action = 'rename';

  update public.takeoff_items as item
  set
    is_excluded = true,
    exclusion_reason = case
      when plan.action = 'skip'
        then 'Exclu par regle de mapping: skip'
      else 'Exclu par regle de mapping: apply_assembly'
    end,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_mapping_plan as plan
  where item.id = plan.item_id
    and item.job_id = job_row.id
    and item.tenant_id = job_row.tenant_id
    and not item.is_excluded
    and plan.action in ('skip', 'apply_assembly');

  select count(*)
    into raw_output_count
  from pg_temp._atomic_takeoff_mapping_plan as plan
  join public.takeoff_items as item
    on item.id = plan.item_id
   and item.job_id = job_row.id
   and item.tenant_id = job_row.tenant_id
  where not item.is_excluded;

  select count(*)
    into assembly_source_count
  from pg_temp._atomic_takeoff_mapping_plan as plan
  join public.takeoff_items as item
    on item.id = plan.item_id
   and item.job_id = job_row.id
   and item.tenant_id = job_row.tenant_id
  where plan.action = 'apply_assembly'
    and item.exclusion_reason = 'Exclu par regle de mapping: apply_assembly';

  if raw_output_count = 0 and assembly_source_count = 0 then
    raise exception 'APPLY_NO_INCLUDABLE_ITEMS' using errcode = '22023';
  end if;

  legacy_strategy := normalized_strategy;
  if normalized_strategy = 'replace' then
    with recursive descendants as (
      select root.id
      from public.estimate_items as root
      where root.id = p_target_section_id
        and root.version_id = job_row.estimate_version_id
        and root.tenant_id = job_row.tenant_id
      union all
      select child.id
      from public.estimate_items as child
      join descendants as parent on parent.id = child.parent_id
      where child.version_id = job_row.estimate_version_id
        and child.tenant_id = job_row.tenant_id
    )
    delete from public.estimate_items as item
    using descendants
    where item.id = descendants.id
      and item.id <> p_target_section_id
      and item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id;

    legacy_strategy := 'append';
  end if;

  select
    result.created_count,
    result.updated_count,
    result.ignored_count,
    result.created_ids,
    result.scope
    into
      legacy_created_count,
      legacy_updated_count,
      legacy_ignored_count,
      legacy_created_ids,
      legacy_scope
  from public.apply_takeoff_job(
    p_job_id,
    legacy_strategy,
    p_target_section_id
  ) as result;

  drop table if exists pg_temp._atomic_takeoff_created_ids;
  create temporary table _atomic_takeoff_created_ids (
    id uuid primary key
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_created_ids (id)
  select id
  from unnest(coalesce(legacy_created_ids, '{}'::uuid[])) as created(id)
  on conflict do nothing;

  drop table if exists pg_temp._atomic_takeoff_line_map;
  create temporary table _atomic_takeoff_line_map (
    takeoff_item_id uuid primary key,
    estimate_item_id uuid not null unique
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_line_map (
    takeoff_item_id,
    estimate_item_id
  )
  with source_ranked as (
    select
      plan.item_id,
      lower(regexp_replace(plan.designation, '\\s+', ' ', 'g'))
        as normalized_title,
      lower(regexp_replace(coalesce(item.unit, ''), '\\s+', ' ', 'g'))
        as normalized_description,
      row_number() over (
        partition by
          lower(regexp_replace(plan.designation, '\\s+', ' ', 'g')),
          lower(regexp_replace(coalesce(item.unit, ''), '\\s+', ' ', 'g'))
        order by plan.source_order, plan.item_id
      ) as match_rank
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where not item.is_excluded
  ), estimate_ranked as (
    select
      item.id,
      lower(regexp_replace(btrim(item.title), '\\s+', ' ', 'g'))
        as normalized_title,
      lower(regexp_replace(coalesce(btrim(item.description), ''), '\\s+', ' ', 'g'))
        as normalized_description,
      row_number() over (
        partition by
          lower(regexp_replace(btrim(item.title), '\\s+', ' ', 'g')),
          lower(regexp_replace(coalesce(btrim(item.description), ''), '\\s+', ' ', 'g'))
        order by item.position, item.id
      ) as match_rank
    from public.estimate_items as item
    where item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id
      and item.item_type = 'line'::public.estimate_item_type
      and item.parent_id is not distinct from p_target_section_id
      and item.source_job_id = job_row.id
  )
  select source.item_id, estimate.id
  from source_ranked as source
  join estimate_ranked as estimate
    on estimate.normalized_title = source.normalized_title
   and estimate.normalized_description = source.normalized_description
   and estimate.match_rank = source.match_rank;

  select count(*)
    into mapped_line_count
  from pg_temp._atomic_takeoff_line_map;

  if mapped_line_count <> raw_output_count then
    raise exception 'TAKEOFF_ATOMIC_LINE_MAPPING_FAILED' using errcode = '40001';
  end if;

  update public.estimate_items as item
  set
    unit_price_ht_cents = plan.unit_price_cents,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_line_map as line_map
  join pg_temp._atomic_takeoff_mapping_plan as plan
    on plan.item_id = line_map.takeoff_item_id
  where item.id = line_map.estimate_item_id
    and item.version_id = job_row.estimate_version_id
    and item.tenant_id = job_row.tenant_id
    and plan.action = 'set_price';

  update public.estimate_items as item
  set
    category_id = plan.category_id,
    updated_at = statement_timestamp()
  from pg_temp._atomic_takeoff_line_map as line_map
  join pg_temp._atomic_takeoff_mapping_plan as plan
    on plan.item_id = line_map.takeoff_item_id
  where item.id = line_map.estimate_item_id
    and item.version_id = job_row.estimate_version_id
    and item.tenant_id = job_row.tenant_id
    and plan.action = 'set_category';

  for mapping_row in
    select
      plan.item_id,
      plan.assembly_id,
      item.source_file_name,
      item.source_page
    from pg_temp._atomic_takeoff_mapping_plan as plan
    join public.takeoff_items as item
      on item.id = plan.item_id
     and item.job_id = job_row.id
     and item.tenant_id = job_row.tenant_id
    where plan.action = 'apply_assembly'
      and item.exclusion_reason = 'Exclu par regle de mapping: apply_assembly'
    order by plan.source_order
  loop
    select coalesce(max(item.position), 0) + 1
      into assembly_position
    from public.estimate_items as item
    where item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id
      and item.parent_id is not distinct from p_target_section_id;

    select coalesce(array_agg(inserted.id), '{}'::uuid[])
      into assembly_item_ids
    from public.materialize_estimate_assembly_tree(
      job_row.estimate_version_id,
      mapping_row.assembly_id,
      p_target_section_id,
      assembly_position,
      1,
      0
    ) as inserted;

    if coalesce(cardinality(assembly_item_ids), 0) = 0 then
      raise exception 'TAKEOFF_MAPPING_ASSEMBLY_INSERT_FAILED'
        using errcode = 'P0001';
    end if;

    insert into pg_temp._atomic_takeoff_created_ids (id)
    select id from unnest(assembly_item_ids) as created(id)
    on conflict do nothing;

    update public.estimate_items as item
    set
      source_provider = 'takeoff',
      source_job_id = job_row.id,
      source_file_name = mapping_row.source_file_name,
      source_page = mapping_row.source_page,
      source_metadata = coalesce(item.source_metadata, '{}'::jsonb)
        || jsonb_build_object(
          'takeoff_item_id', mapping_row.item_id,
          'mapping_action', 'apply_assembly',
          'assembly_id', mapping_row.assembly_id
        ),
      updated_at = statement_timestamp()
    where item.id = any(assembly_item_ids)
      and item.version_id = job_row.estimate_version_id
      and item.tenant_id = job_row.tenant_id;
  end loop;

  perform public.recalculate_takeoff_estimate_version(
    job_row.estimate_version_id,
    job_row.tenant_id
  );

  return query
  select
    (select count(*)::integer from pg_temp._atomic_takeoff_created_ids),
    legacy_updated_count,
    greatest(legacy_ignored_count - assembly_source_count, 0),
    coalesce(
      (
        select array_agg(created.id order by created.id)
        from pg_temp._atomic_takeoff_created_ids as created
      ),
      '{}'::uuid[]
    ),
    case
      when p_target_section_id is null then 'version'
      else 'section'
    end,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'takeoff_item_id', line_map.takeoff_item_id,
            'estimate_item_id', line_map.estimate_item_id
          )
          order by line_map.takeoff_item_id
        )
        from pg_temp._atomic_takeoff_line_map as line_map
      ),
      '[]'::jsonb
    );
end;
$$;

revoke all on function public.apply_takeoff_job_atomic(uuid, text, uuid, jsonb)
  from public, anon, authenticated;

-- Mapping updates are internal to the guarded transaction. They preserve the
-- human attestation attached to the source measurement; direct user edits keep
-- the stricter verification invalidation behavior from the prior migration.
create or replace function public.enforce_authenticated_takeoff_item_fields()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  parent_status public.takeoff_job_status;
  parent_level public.takeoff_job_level;
begin
  if current_user <> 'authenticated'
    or coalesce(current_setting('app.takeoff_apply_atomic', true), '') = 'on'
  then
    return new;
  end if;

  select job.status, job.level
    into parent_status, parent_level
  from public.takeoff_jobs as job
  where job.id = new.job_id
    and job.tenant_id = new.tenant_id;

  if parent_status is distinct from 'completed'::public.takeoff_job_status then
    raise exception 'TAKEOFF_ITEM_COMPLETED_JOB_REQUIRED' using errcode = '42501';
  end if;

  if (to_jsonb(new) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'updated_at'
  ]) is distinct from (to_jsonb(old) - array[
    'designation', 'quantity', 'unit', 'is_excluded', 'exclusion_reason',
    'is_verified', 'verified_at', 'verified_by', 'evidence', 'source_page',
    'updated_at'
  ]) then
    raise exception 'TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE' using errcode = '42501';
  end if;

  if old.is_verified
    and (
      new.designation is distinct from old.designation
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.is_excluded is distinct from old.is_excluded
      or new.exclusion_reason is distinct from old.exclusion_reason
      or new.evidence is distinct from old.evidence
      or new.source_page is distinct from old.source_page
    )
    and new.is_verified is not distinct from old.is_verified
    and new.verified_at is not distinct from old.verified_at
    and new.verified_by is not distinct from old.verified_by
  then
    new.is_verified := false;
    new.verified_at := null;
    new.verified_by := null;
  end if;

  if new.is_verified is distinct from old.is_verified
    or new.verified_at is distinct from old.verified_at
    or new.verified_by is distinct from old.verified_by
  then
    if new.is_verified then
      if new.verified_by is distinct from (select auth.uid())
        or new.verified_at is null
      then
        raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
      end if;
    elsif new.verified_by is not null or new.verified_at is not null then
      raise exception 'TAKEOFF_ITEM_VERIFICATION_INVALID' using errcode = '42501';
    end if;
  end if;

  if parent_level = 'C'::public.takeoff_job_level
    and new.is_verified
    and (
      nullif(btrim(new.evidence), '') is null
      or new.source_page is null
      or new.source_page < 1
    )
  then
    raise exception 'TAKEOFF_ITEM_VERIFICATION_PROOF_REQUIRED' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_authenticated_takeoff_item_fields()
  from public;

create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job_tenant_id uuid;
  job_version_id uuid;
begin
  if lower(btrim(coalesce(p_strategy, ''))) = 'replace'
    and p_target_section_id is null
  then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  perform public.assert_takeoff_active_tenant(p_job_id, job_tenant_id);

  if exists (
    select 1
    from public.estimate_items as item
    where item.tenant_id = job_tenant_id
      and item.version_id = job_version_id
      and item.item_type = 'line'
      and item.source_provider = 'dpgf'
  ) then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_REQUIRED'
      using errcode = '42501';
  end if;

  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  return query
  select result.*
  from public.apply_takeoff_job_atomic(
    p_job_id,
    p_strategy,
    p_target_section_id,
    p_mapping_plan
  ) as result;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb
) to authenticated;

create or replace function public.apply_takeoff_job_guarded_atomic(
  p_job_id uuid,
  p_strategy text,
  p_target_section_id uuid,
  p_mapping_plan jsonb,
  p_dpgf_authorization_token text
)
returns table (
  created_count integer,
  updated_count integer,
  ignored_count integer,
  created_ids uuid[],
  scope text,
  item_links jsonb
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_id uuid := (select auth.uid());
  job_tenant_id uuid;
  job_version_id uuid;
  authorization_id uuid;
begin
  if caller_id is null then
    raise exception 'TAKEOFF_APPLY_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if lower(btrim(coalesce(p_strategy, ''))) = 'replace'
    and p_target_section_id is null
  then
    raise exception 'TAKEOFF_ROOT_REPLACE_DISABLED' using errcode = '22023';
  end if;

  select job.tenant_id, job.estimate_version_id
    into job_tenant_id, job_version_id
  from public.takeoff_jobs as job
  where job.id = p_job_id;

  if job_tenant_id is null
    or not coalesce(public.has_tenant_role(
      job_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ), false)
  then
    raise exception 'TAKEOFF_APPLY_OPERATOR_REQUIRED' using errcode = '42501';
  end if;

  perform public.assert_takeoff_active_tenant(p_job_id, job_tenant_id);

  select permit.id
    into authorization_id
  from public.takeoff_apply_authorizations as permit
  where permit.authorization_token_hash = encode(
      sha256(convert_to(p_dpgf_authorization_token, 'UTF8')),
      'hex'
    )
    and permit.tenant_id = job_tenant_id
    and permit.job_id = p_job_id
    and permit.estimate_version_id = job_version_id
    and permit.user_id = caller_id
    and permit.consumed_at is null
    and permit.expires_at > statement_timestamp()
  for update;

  if authorization_id is null then
    raise exception 'TAKEOFF_DPGF_APPLY_AUTHORIZATION_INVALID'
      using errcode = '42501';
  end if;

  update public.takeoff_apply_authorizations as permit
  set
    authorization_token_hash = null,
    consumed_at = statement_timestamp()
  where permit.id = authorization_id;

  perform set_config('app.takeoff_apply_job', 'on', true);
  perform set_config('app.takeoff_apply_atomic', 'on', true);
  return query
  select result.*
  from public.apply_takeoff_job_atomic(
    p_job_id,
    p_strategy,
    p_target_section_id,
    p_mapping_plan
  ) as result;
end;
$$;

revoke all on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) from public, anon;
grant execute on function public.apply_takeoff_job_guarded_atomic(
  uuid, text, uuid, jsonb, text
) to authenticated;

-- The old wrappers could authorize a destructive version-root replacement and
-- could only apply mapping transformations after the transaction committed.
revoke execute on function public.apply_takeoff_job_guarded(uuid, text, uuid)
  from authenticated;
revoke execute on function public.apply_takeoff_job_guarded(
  uuid, text, uuid, text
) from authenticated;
revoke execute on function public.apply_takeoff_job(uuid, text, uuid)
  from public, anon, authenticated;
