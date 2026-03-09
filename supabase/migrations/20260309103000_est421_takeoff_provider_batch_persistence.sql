do $$
begin
  create type public.takeoff_processing_strategy as enum ('sync', 'batch');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.takeoff_provider_batch_state as enum (
    'submitted',
    'pending',
    'running',
    'succeeded',
    'failed',
    'cancelled',
    'expired',
    'unknown'
  );
exception
  when duplicate_object then null;
end
$$;

alter table if exists public.takeoff_jobs
  add column if not exists processing_strategy public.takeoff_processing_strategy,
  add column if not exists provider_batch_id text,
  add column if not exists provider_batch_state public.takeoff_provider_batch_state,
  add column if not exists provider_batch_updated_at timestamptz;

update public.takeoff_jobs
set processing_strategy = 'sync'
where processing_strategy is null;

alter table if exists public.takeoff_jobs
  alter column processing_strategy set default 'sync',
  alter column processing_strategy set not null;

create index if not exists takeoff_jobs_tenant_status_strategy_batch_state_updated_idx
  on public.takeoff_jobs (
    tenant_id,
    status,
    processing_strategy,
    provider_batch_state,
    updated_at desc
  );

create table if not exists public.takeoff_job_provider_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  provider text not null check (provider in ('gemini')),
  processing_strategy public.takeoff_processing_strategy not null,
  provider_batch_id text,
  provider_batch_state public.takeoff_provider_batch_state,
  provider_state_raw text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint takeoff_job_provider_events_provider_batch_id_nonempty
    check (provider_batch_id is null or btrim(provider_batch_id) <> '')
);

alter table if exists public.takeoff_job_provider_events
  alter column tenant_id set default public.current_tenant_id(),
  alter column tenant_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_version_id set not null;

create index if not exists takeoff_job_provider_events_job_created_idx
  on public.takeoff_job_provider_events (tenant_id, takeoff_job_id, created_at desc);

create index if not exists takeoff_job_provider_events_batch_state_created_idx
  on public.takeoff_job_provider_events (tenant_id, provider_batch_state, created_at desc);

alter table public.takeoff_job_provider_events enable row level security;
alter table public.takeoff_job_provider_events force row level security;

drop policy if exists "Current tenant can select takeoff job provider events"
  on public.takeoff_job_provider_events;
create policy "Current tenant can select takeoff job provider events"
  on public.takeoff_job_provider_events
  for select
  to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_job_provider_events.takeoff_job_id
        and tj.tenant_id = takeoff_job_provider_events.tenant_id
        and tj.estimate_version_id = takeoff_job_provider_events.estimate_version_id
    )
  );

drop policy if exists "Current tenant can insert takeoff job provider events"
  on public.takeoff_job_provider_events;
create policy "Current tenant can insert takeoff job provider events"
  on public.takeoff_job_provider_events
  for insert
  to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_job_provider_events.takeoff_job_id
        and tj.tenant_id = takeoff_job_provider_events.tenant_id
        and tj.estimate_version_id = takeoff_job_provider_events.estimate_version_id
    )
  );
