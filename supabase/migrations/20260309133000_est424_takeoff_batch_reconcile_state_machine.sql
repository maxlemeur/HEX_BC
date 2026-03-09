alter table public.takeoff_jobs
  add column if not exists provider_reconcile_due_at timestamptz,
  add column if not exists provider_reconcile_attempt_count integer not null default 0,
  add column if not exists provider_reconcile_lease_token uuid,
  add column if not exists provider_reconcile_lease_expires_at timestamptz;

create index if not exists takeoff_jobs_batch_reconcile_due_idx
  on public.takeoff_jobs (
    tenant_id,
    processing_strategy,
    status,
    provider_reconcile_due_at
  )
  where processing_strategy = 'batch'
    and status = 'processing'
    and provider_batch_id is not null;

create or replace function public.acquire_takeoff_batch_reconcile_lease(
  p_job_id uuid,
  p_tenant_id uuid,
  p_now timestamptz,
  p_lease_token uuid,
  p_lease_expires_at timestamptz
)
returns table (
  claimed boolean,
  provider_reconcile_attempt_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_attempt_count integer;
begin
  if p_job_id is null then
    raise exception 'p_job_id is required';
  end if;

  if p_tenant_id is null then
    raise exception 'p_tenant_id is required';
  end if;

  if p_now is null then
    raise exception 'p_now is required';
  end if;

  if p_lease_token is null then
    raise exception 'p_lease_token is required';
  end if;

  if p_lease_expires_at is null then
    raise exception 'p_lease_expires_at is required';
  end if;

  update public.takeoff_jobs
  set
    provider_reconcile_lease_token = p_lease_token,
    provider_reconcile_lease_expires_at = p_lease_expires_at,
    provider_reconcile_attempt_count = coalesce(provider_reconcile_attempt_count, 0) + 1
  where id = p_job_id
    and tenant_id = p_tenant_id
    and status = 'processing'
    and processing_strategy = 'batch'
    and provider_batch_id is not null
    and (
      provider_batch_state is null
      or provider_batch_state not in (
        'succeeded'::public.takeoff_provider_batch_state,
        'failed'::public.takeoff_provider_batch_state,
        'cancelled'::public.takeoff_provider_batch_state,
        'expired'::public.takeoff_provider_batch_state
      )
    )
    and coalesce(provider_reconcile_due_at, p_now) <= p_now
    and (
      provider_reconcile_lease_expires_at is null
      or provider_reconcile_lease_expires_at <= p_now
    )
  returning public.takeoff_jobs.provider_reconcile_attempt_count
  into v_attempt_count;

  if found then
    return query
    select true, v_attempt_count;
    return;
  end if;

  return query
  select false, null::integer;
end;
$$;

revoke all on function public.acquire_takeoff_batch_reconcile_lease(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz
) from public;
revoke all on function public.acquire_takeoff_batch_reconcile_lease(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz
) from authenticated;
grant execute on function public.acquire_takeoff_batch_reconcile_lease(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz
) to authenticated;
grant execute on function public.acquire_takeoff_batch_reconcile_lease(
  uuid,
  uuid,
  timestamptz,
  uuid,
  timestamptz
) to service_role;
