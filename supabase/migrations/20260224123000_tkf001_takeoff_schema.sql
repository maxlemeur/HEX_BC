-- TKF-001: takeoff schema foundations (enums, tables, constraints, RLS, indexes).

do $$
begin
  create type public.takeoff_job_level as enum ('A', 'B', 'C');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.takeoff_job_status as enum (
    'pending',
    'processing',
    'completed',
    'failed',
    'canceled',
    'applied'
  );
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.takeoff_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  level public.takeoff_job_level not null,
  status public.takeoff_job_status not null default 'pending',
  source_file_name text,
  source_file_path text,
  source_file_type text,
  source_file_size_bytes bigint check (source_file_size_bytes is null or source_file_size_bytes >= 0),
  prompt_version text,
  schema_version text not null default 'v1',
  model text,
  thinking_level text,
  media_resolution text,
  retry_count integer not null default 0 check (retry_count >= 0),
  token_count integer check (token_count is null or token_count >= 0),
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.takeoff_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  extracted_json jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  tables jsonb not null default '[]'::jsonb,
  provider_meta jsonb not null default '{}'::jsonb,
  raw_response jsonb,
  confidence numeric(5,4),
  token_count integer check (token_count is null or token_count >= 0),
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0)
);

create table if not exists public.takeoff_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  result_id uuid references public.takeoff_results(id) on delete cascade,
  designation text not null,
  quantity numeric(12,3) not null,
  unit text not null,
  confidence numeric(5,4),
  evidence text,
  source_file_name text,
  source_page integer check (source_page is null or source_page > 0),
  metadata jsonb not null default '{}'::jsonb,
  is_excluded boolean not null default false,
  is_verified boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references public.profiles(id) on delete set null
);

alter table if exists public.takeoff_jobs
  alter column tenant_id set default public.current_tenant_id(),
  alter column tenant_id set not null,
  alter column estimate_version_id set not null,
  alter column level set not null,
  alter column status set not null;

alter table if exists public.takeoff_results
  alter column tenant_id set default public.current_tenant_id(),
  alter column tenant_id set not null,
  alter column job_id set not null;

alter table if exists public.takeoff_items
  alter column tenant_id set default public.current_tenant_id(),
  alter column tenant_id set not null,
  alter column job_id set not null,
  alter column quantity set not null,
  alter column unit set not null;

alter table if exists public.takeoff_results
  drop constraint if exists takeoff_results_confidence_check;
alter table if exists public.takeoff_results
  add constraint takeoff_results_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table if exists public.takeoff_items
  drop constraint if exists takeoff_items_confidence_check;
alter table if exists public.takeoff_items
  add constraint takeoff_items_confidence_check
  check (confidence is null or (confidence >= 0 and confidence <= 1));

alter table if exists public.takeoff_items
  drop constraint if exists takeoff_items_quantity_positive_check;
alter table if exists public.takeoff_items
  add constraint takeoff_items_quantity_positive_check
  check (quantity > 0);

create index if not exists takeoff_jobs_tenant_status_created_at_idx
  on public.takeoff_jobs (tenant_id, status, created_at desc);
create index if not exists takeoff_jobs_tenant_estimate_version_idx
  on public.takeoff_jobs (tenant_id, estimate_version_id);
create index if not exists takeoff_results_tenant_job_idx
  on public.takeoff_results (tenant_id, job_id);
create index if not exists takeoff_items_tenant_job_excluded_verified_idx
  on public.takeoff_items (tenant_id, job_id, is_excluded, is_verified);

create or replace function public.assign_takeoff_results_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.job_id is not null then
    select tj.tenant_id
      into parent_tenant_id
    from public.takeoff_jobs tj
    where tj.id = new.job_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_takeoff_items_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  job_tenant_id uuid;
  result_tenant_id uuid;
  result_job_id uuid;
begin
  if new.result_id is not null then
    select tr.tenant_id, tr.job_id
      into result_tenant_id, result_job_id
    from public.takeoff_results tr
    where tr.id = new.result_id;
  end if;

  if new.job_id is not null then
    select tj.tenant_id
      into job_tenant_id
    from public.takeoff_jobs tj
    where tj.id = new.job_id;
  end if;

  if result_job_id is not null and new.job_id is not null and result_job_id <> new.job_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_ITEM_RESULT_JOB_MISMATCH',
        detail = format('result_id=%s does not belong to job_id=%s', new.result_id, new.job_id);
  end if;

  if result_tenant_id is not null and job_tenant_id is not null and result_tenant_id <> job_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_ITEM_TENANT_MISMATCH',
        detail = format('job_id=%s and result_id=%s do not share the same tenant', new.job_id, new.result_id);
  end if;

  new.tenant_id := coalesce(result_tenant_id, job_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_takeoff_jobs_updated_at on public.takeoff_jobs;
create trigger set_takeoff_jobs_updated_at
  before update on public.takeoff_jobs
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_takeoff_results_updated_at on public.takeoff_results;
create trigger set_takeoff_results_updated_at
  before update on public.takeoff_results
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_takeoff_items_updated_at on public.takeoff_items;
create trigger set_takeoff_items_updated_at
  before update on public.takeoff_items
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_takeoff_jobs_tenant_id on public.takeoff_jobs;
create trigger set_takeoff_jobs_tenant_id
  before insert or update on public.takeoff_jobs
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_takeoff_results_tenant_id on public.takeoff_results;
create trigger set_takeoff_results_tenant_id
  before insert or update on public.takeoff_results
  for each row execute procedure public.assign_takeoff_results_tenant_id();

drop trigger if exists set_takeoff_items_tenant_id on public.takeoff_items;
create trigger set_takeoff_items_tenant_id
  before insert or update on public.takeoff_items
  for each row execute procedure public.assign_takeoff_items_tenant_id();

alter table public.takeoff_jobs enable row level security;
alter table public.takeoff_results enable row level security;
alter table public.takeoff_items enable row level security;
alter table public.takeoff_jobs force row level security;
alter table public.takeoff_results force row level security;
alter table public.takeoff_items force row level security;

drop policy if exists "Current tenant can select takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can insert takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can update takeoff jobs" on public.takeoff_jobs;
drop policy if exists "Current tenant can delete takeoff jobs" on public.takeoff_jobs;

create policy "Current tenant can select takeoff jobs"
  on public.takeoff_jobs
  for select
  to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy "Current tenant can insert takeoff jobs"
  on public.takeoff_jobs
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.estimate_versions ev
      where ev.id = takeoff_jobs.estimate_version_id
        and ev.tenant_id = takeoff_jobs.tenant_id
    )
  );

create policy "Current tenant can update takeoff jobs"
  on public.takeoff_jobs
  for update
  to authenticated
  using (tenant_id = (select public.current_tenant_id()))
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.estimate_versions ev
      where ev.id = takeoff_jobs.estimate_version_id
        and ev.tenant_id = takeoff_jobs.tenant_id
    )
  );

create policy "Current tenant can delete takeoff jobs"
  on public.takeoff_jobs
  for delete
  to authenticated
  using (tenant_id = (select public.current_tenant_id()));

drop policy if exists "Current tenant can select takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can insert takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can update takeoff results" on public.takeoff_results;
drop policy if exists "Current tenant can delete takeoff results" on public.takeoff_results;

create policy "Current tenant can select takeoff results"
  on public.takeoff_results
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
    )
  );

create policy "Current tenant can insert takeoff results"
  on public.takeoff_results
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
    )
  );

create policy "Current tenant can update takeoff results"
  on public.takeoff_results
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
    )
  );

create policy "Current tenant can delete takeoff results"
  on public.takeoff_results
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_results.job_id
        and tj.tenant_id = takeoff_results.tenant_id
    )
  );

drop policy if exists "Current tenant can select takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can insert takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can update takeoff items" on public.takeoff_items;
drop policy if exists "Current tenant can delete takeoff items" on public.takeoff_items;

create policy "Current tenant can select takeoff items"
  on public.takeoff_items
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can insert takeoff items"
  on public.takeoff_items
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can update takeoff items"
  on public.takeoff_items
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );

create policy "Current tenant can delete takeoff items"
  on public.takeoff_items
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_items.job_id
        and tj.tenant_id = takeoff_items.tenant_id
    )
    and (
      takeoff_items.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_items.result_id
          and tr.tenant_id = takeoff_items.tenant_id
          and tr.job_id = takeoff_items.job_id
      )
    )
  );
