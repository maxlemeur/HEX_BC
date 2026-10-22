-- An authenticated client can insert takeoff_jobs through PostgREST. Enforce
-- aggregate admission in the database for upload, plan-set and direct writes.
-- Ledger rows deliberately survive deletion of a job or its estimate.
create table if not exists public.takeoff_job_admissions (
  job_id uuid primary key,
  tenant_id uuid not null,
  created_by uuid,
  admitted_at timestamptz not null default clock_timestamp()
);

create index if not exists takeoff_job_admissions_tenant_window_idx
  on public.takeoff_job_admissions (tenant_id, admitted_at desc);
create index if not exists takeoff_job_admissions_user_window_idx
  on public.takeoff_job_admissions (tenant_id, created_by, admitted_at desc);

create table if not exists public.takeoff_processing_admissions (
  job_id uuid not null,
  attempt_number integer not null,
  tenant_id uuid not null,
  created_by uuid,
  admitted_at timestamptz not null default clock_timestamp(),
  primary key (job_id, attempt_number),
  constraint takeoff_processing_admissions_attempt_nonnegative check (attempt_number >= 0)
);

create index if not exists takeoff_processing_admissions_tenant_window_idx
  on public.takeoff_processing_admissions (tenant_id, admitted_at desc);
create index if not exists takeoff_processing_admissions_user_window_idx
  on public.takeoff_processing_admissions (tenant_id, created_by, admitted_at desc);

alter table public.takeoff_job_admissions enable row level security;
alter table public.takeoff_job_admissions force row level security;
alter table public.takeoff_processing_admissions enable row level security;
alter table public.takeoff_processing_admissions force row level security;
revoke all on table public.takeoff_job_admissions from PUBLIC, anon, authenticated;
revoke all on table public.takeoff_processing_admissions from PUBLIC, anon, authenticated;

create or replace function public.enforce_takeoff_job_admission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  select pg_catalog.count(*),
    pg_catalog.count(*) filter (where a.created_by = new.created_by)
  into v_tenant_daily, v_user_daily
  from public.takeoff_job_admissions a
  where a.tenant_id = new.tenant_id
    and a.admitted_at > v_now - interval '24 hours';

  select pg_catalog.count(*),
    pg_catalog.count(*) filter (where j.created_by = new.created_by)
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

  insert into public.takeoff_job_admissions
    (job_id, tenant_id, created_by, admitted_at)
  values (new.id, new.tenant_id, new.created_by, v_now);
  return null;
end;
$$;

create or replace function public.enforce_takeoff_job_reactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  select pg_catalog.count(*),
    pg_catalog.count(*) filter (where j.created_by = new.created_by)
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
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    select pg_catalog.count(*),
      pg_catalog.count(*) filter (where j.created_by = new.created_by)
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

  select pg_catalog.count(*),
    pg_catalog.count(*) filter (where a.created_by = new.created_by)
  into v_tenant_daily, v_user_daily
  from public.takeoff_processing_admissions a
  where a.tenant_id = new.tenant_id
    and a.admitted_at > v_now - interval '24 hours';

  if v_tenant_daily >= 80 or v_user_daily >= 20 then
    raise exception using
      errcode = '23514',
      message = 'TAKEOFF_PROCESSING_ADMISSION_LIMIT';
  end if;

  -- A second transition with the same attempt number must not trigger a
  -- second paid provider call without consuming another admission.
  insert into public.takeoff_processing_admissions
    (job_id, attempt_number, tenant_id, created_by, admitted_at)
  values (new.id, new.retry_count, new.tenant_id, new.created_by, v_now);
  return null;
end;
$$;

revoke all on function public.enforce_takeoff_job_admission()
  from PUBLIC, anon, authenticated;
revoke all on function public.enforce_takeoff_job_reactivation()
  from PUBLIC, anon, authenticated;
revoke all on function public.enforce_takeoff_processing_admission()
  from PUBLIC, anon, authenticated;

drop trigger if exists enforce_takeoff_job_admission on public.takeoff_jobs;
create trigger enforce_takeoff_job_admission
  after insert on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_job_admission();

drop trigger if exists enforce_takeoff_job_reactivation on public.takeoff_jobs;
create trigger enforce_takeoff_job_reactivation
  after update of status on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_job_reactivation();

drop trigger if exists enforce_takeoff_processing_admission on public.takeoff_jobs;
create trigger enforce_takeoff_processing_admission
  after update of status on public.takeoff_jobs
  for each row execute function public.enforce_takeoff_processing_admission();
