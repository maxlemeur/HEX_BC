-- TKF-017: add tenant-scoped takeoff plan sets/files with strict RLS and storage policies.

create table if not exists public.plan_sets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.plan_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  plan_set_id uuid not null references public.plan_sets(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size_bytes bigint not null,
  page_count integer,
  file_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

alter table if exists public.plan_sets
  alter column tenant_id set default public.current_tenant_id(),
  alter column metadata set default '{}'::jsonb,
  alter column tenant_id set not null,
  alter column estimate_version_id set not null,
  alter column name set not null,
  alter column metadata set not null;

alter table if exists public.plan_files
  alter column tenant_id set default public.current_tenant_id(),
  alter column metadata set default '{}'::jsonb,
  alter column tenant_id set not null,
  alter column plan_set_id set not null,
  alter column file_path set not null,
  alter column file_name set not null,
  alter column file_type set not null,
  alter column file_size_bytes set not null,
  alter column metadata set not null;

alter table if exists public.plan_files
  drop constraint if exists plan_files_plan_set_id_fkey;
alter table if exists public.plan_files
  add constraint plan_files_plan_set_id_fkey
  foreign key (plan_set_id)
  references public.plan_sets(id)
  on delete cascade;

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_size_bytes_check;
alter table if exists public.plan_files
  add constraint plan_files_file_size_bytes_check
  check (file_size_bytes >= 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_page_count_check;
alter table if exists public.plan_files
  add constraint plan_files_page_count_check
  check (page_count is null or page_count > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_path_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_path_not_blank_check
  check (length(btrim(file_path)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_name_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_name_not_blank_check
  check (length(btrim(file_name)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_type_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_type_not_blank_check
  check (length(btrim(file_type)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_metadata_object_check;
alter table if exists public.plan_files
  add constraint plan_files_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

alter table if exists public.plan_sets
  drop constraint if exists plan_sets_name_not_blank_check;
alter table if exists public.plan_sets
  add constraint plan_sets_name_not_blank_check
  check (length(btrim(name)) > 0);

alter table if exists public.plan_sets
  drop constraint if exists plan_sets_metadata_object_check;
alter table if exists public.plan_sets
  add constraint plan_sets_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_path_key;
alter table if exists public.plan_files
  add constraint plan_files_file_path_key
  unique (file_path);

create index if not exists plan_sets_tenant_estimate_version_created_at_idx
  on public.plan_sets (tenant_id, estimate_version_id, created_at desc);

create index if not exists plan_files_tenant_plan_set_created_at_idx
  on public.plan_files (tenant_id, plan_set_id, created_at desc);

create index if not exists plan_files_file_hash_idx
  on public.plan_files (file_hash)
  where file_hash is not null;

create index if not exists plan_sets_estimate_version_id_idx
  on public.plan_sets (estimate_version_id);

create index if not exists plan_sets_created_by_idx
  on public.plan_sets (created_by);

create index if not exists plan_files_plan_set_id_idx
  on public.plan_files (plan_set_id);

create index if not exists plan_files_created_by_idx
  on public.plan_files (created_by);

create or replace function public.assign_plan_sets_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_plan_files_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.plan_set_id is not null then
    select ps.tenant_id
      into parent_tenant_id
    from public.plan_sets ps
    where ps.id = new.plan_set_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

update public.plan_sets ps
set tenant_id = ev.tenant_id
from public.estimate_versions ev
where ev.id = ps.estimate_version_id
  and ps.tenant_id is distinct from ev.tenant_id;

update public.plan_files pf
set tenant_id = ps.tenant_id
from public.plan_sets ps
where ps.id = pf.plan_set_id
  and pf.tenant_id is distinct from ps.tenant_id;

drop trigger if exists set_plan_sets_updated_at on public.plan_sets;
create trigger set_plan_sets_updated_at
  before update on public.plan_sets
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_plan_files_updated_at on public.plan_files;
create trigger set_plan_files_updated_at
  before update on public.plan_files
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_plan_sets_tenant_id on public.plan_sets;
create trigger set_plan_sets_tenant_id
  before insert or update on public.plan_sets
  for each row execute procedure public.assign_plan_sets_tenant_id();

drop trigger if exists set_plan_files_tenant_id on public.plan_files;
create trigger set_plan_files_tenant_id
  before insert or update on public.plan_files
  for each row execute procedure public.assign_plan_files_tenant_id();

alter table if exists public.plan_sets enable row level security;
alter table if exists public.plan_files enable row level security;
alter table if exists public.plan_sets force row level security;
alter table if exists public.plan_files force row level security;

drop policy if exists "Current tenant can select plan sets" on public.plan_sets;
drop policy if exists "Current tenant can insert plan sets" on public.plan_sets;
drop policy if exists "Current tenant can update plan sets" on public.plan_sets;
drop policy if exists "Current tenant can delete plan sets" on public.plan_sets;

create policy "Current tenant can select plan sets"
  on public.plan_sets
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can insert plan sets"
  on public.plan_sets
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can update plan sets"
  on public.plan_sets
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can delete plan sets"
  on public.plan_sets
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

drop policy if exists "Current tenant can select plan files" on public.plan_files;
drop policy if exists "Current tenant can insert plan files" on public.plan_files;
drop policy if exists "Current tenant can update plan files" on public.plan_files;
drop policy if exists "Current tenant can delete plan files" on public.plan_files;

create policy "Current tenant can select plan files"
  on public.plan_files
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can insert plan files"
  on public.plan_files
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can update plan files"
  on public.plan_files
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can delete plan files"
  on public.plan_files
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plan-files',
  'plan-files',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Tenant members can view plan files storage" on storage.objects;
drop policy if exists "Tenant members can insert plan files storage" on storage.objects;
drop policy if exists "Tenant members can update plan files storage" on storage.objects;
drop policy if exists "Tenant members can delete plan files storage" on storage.objects;

create policy "Tenant members can view plan files storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can insert plan files storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can update plan files storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  )
  with check (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = objects.name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can delete plan files storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 3
    and coalesce((storage.foldername(objects.name))[1], '') <> ''
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce((storage.foldername(objects.name))[3], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
    )
    and (
      exists (
        select 1
        from public.plan_sets ps
        join public.plan_files pf on pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
        where ps.id::text = coalesce((storage.foldername(objects.name))[2], '')
          and ps.tenant_id = pf.tenant_id
          and pf.plan_set_id = ps.id
          and coalesce(pf.file_path, '') = objects.name
          and coalesce(pf.file_name, '') = coalesce(storage.filename(objects.name), '')
          and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
      )
      or not exists (
        select 1
        from public.plan_files pf
        where pf.id::text = coalesce((storage.foldername(objects.name))[3], '')
      )
    )
  );
