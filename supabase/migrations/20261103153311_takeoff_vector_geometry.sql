-- TI-662 (métré L3): the vector reading of a takeoff job, per page and per item.
-- Written by the takeoff worker with the service role only, never by Data API
-- clients; read by authenticated users through the same job access as
-- takeoff_items. A dedicated table rather than takeoff_items.metadata: the
-- geometry stays out of every item read (job details, PATCH responses, DPGF
-- comparisons, line evidences), and a page without measured item (« échelle non
-- vérifiée ») keeps its scale, cotes and printed surfaces. Rows go with their
-- result: clearing a job's results (retry, cancel) deletes them.

create table public.takeoff_vector_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  result_id uuid not null references public.takeoff_results(id) on delete cascade,
  -- The plan file the page was read from; null for a single upload. Plan files may be deleted: no foreign key.
  plan_file_id uuid,
  source_file_name text check (source_file_name is null or char_length(source_file_name) <= 255),
  source_page integer not null check (source_page > 0),
  reading jsonb not null check (jsonb_typeof(reading) = 'object' and octet_length(reading::text) <= 262144),
  schema_version smallint not null check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp()
);
create unique index takeoff_vector_pages_page_key
  on public.takeoff_vector_pages(result_id, coalesce(plan_file_id, '00000000-0000-0000-0000-000000000000'::uuid), source_page);
create index takeoff_vector_pages_job_idx on public.takeoff_vector_pages(tenant_id, job_id);
-- Deleting a job cascades here: its foreign key needs an index led by job_id.
create index takeoff_vector_pages_job_fk_idx on public.takeoff_vector_pages(job_id);

create table public.takeoff_item_geometries (
  takeoff_item_id uuid primary key references public.takeoff_items(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  vector_page_id uuid not null references public.takeoff_vector_pages(id) on delete cascade,
  geometry jsonb not null check (jsonb_typeof(geometry) = 'object' and octet_length(geometry::text) <= 524288),
  schema_version smallint not null check (schema_version = 1),
  created_at timestamptz not null default clock_timestamp()
);
create index takeoff_item_geometries_job_idx on public.takeoff_item_geometries(tenant_id, job_id);
create index takeoff_item_geometries_page_idx on public.takeoff_item_geometries(vector_page_id);
create index takeoff_item_geometries_job_fk_idx on public.takeoff_item_geometries(job_id);

-- Tenant and job consistency: a page follows its result's job and tenant, a
-- geometry its item's, on a page of the same job.
create or replace function public.assign_takeoff_vector_page_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_tenant_id uuid;
  owner_job_id uuid;
begin
  select tr.tenant_id, tr.job_id into owner_tenant_id, owner_job_id
  from public.takeoff_results tr where tr.id = new.result_id;
  if owner_job_id is null or owner_job_id <> new.job_id then
    raise exception using errcode = '23514', message = 'TAKEOFF_VECTOR_JOB_MISMATCH';
  end if;
  new.tenant_id := owner_tenant_id;
  return new;
end;
$$;

create or replace function public.assign_takeoff_item_geometry_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_tenant_id uuid;
  owner_job_id uuid;
begin
  select ti.tenant_id, ti.job_id into owner_tenant_id, owner_job_id
  from public.takeoff_items ti where ti.id = new.takeoff_item_id;
  if owner_job_id is null or owner_job_id <> new.job_id then
    raise exception using errcode = '23514', message = 'TAKEOFF_VECTOR_JOB_MISMATCH';
  end if;
  if not exists (
    select 1 from public.takeoff_vector_pages page
    where page.id = new.vector_page_id and page.job_id = owner_job_id and page.tenant_id = owner_tenant_id
  ) then
    raise exception using errcode = '23514', message = 'TAKEOFF_VECTOR_GEOMETRY_PAGE_MISMATCH';
  end if;
  new.tenant_id := owner_tenant_id;
  return new;
end;
$$;
revoke execute on function public.assign_takeoff_vector_page_tenant_id() from public, anon, authenticated;
revoke execute on function public.assign_takeoff_item_geometry_tenant_id() from public, anon, authenticated;

create trigger set_takeoff_vector_pages_tenant_id
  before insert or update on public.takeoff_vector_pages
  for each row execute procedure public.assign_takeoff_vector_page_tenant_id();
create trigger set_takeoff_item_geometries_tenant_id
  before insert or update on public.takeoff_item_geometries
  for each row execute procedure public.assign_takeoff_item_geometry_tenant_id();

alter table public.takeoff_vector_pages enable row level security;
alter table public.takeoff_vector_pages force row level security;
alter table public.takeoff_item_geometries enable row level security;
alter table public.takeoff_item_geometries force row level security;
revoke all on public.takeoff_vector_pages, public.takeoff_item_geometries from public, anon, authenticated;
grant select on public.takeoff_vector_pages, public.takeoff_item_geometries to authenticated;
grant select, insert, update, delete on public.takeoff_vector_pages, public.takeoff_item_geometries to service_role;

create policy "Current tenant can select takeoff vector pages"
  on public.takeoff_vector_pages for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.takeoff_jobs tj
      where tj.id = takeoff_vector_pages.job_id
        and tj.tenant_id = takeoff_vector_pages.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can select takeoff item geometries"
  on public.takeoff_item_geometries for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1 from public.takeoff_jobs tj
      where tj.id = takeoff_item_geometries.job_id
        and tj.tenant_id = takeoff_item_geometries.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );
