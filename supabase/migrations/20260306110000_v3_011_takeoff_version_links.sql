-- V3-011: carry-over des jobs takeoff entre versions de devis.
-- Table de liens version->version, avec contraintes de cohérence, RLS tenant-scope et index de lecture.

create table if not exists public.takeoff_version_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  source_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  constraint takeoff_version_links_source_target_check
    check (source_version_id <> target_version_id),
  constraint takeoff_version_links_job_target_key
    unique (takeoff_job_id, target_version_id)
);

alter table if exists public.takeoff_version_links
  add column if not exists tenant_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists source_version_id uuid,
  add column if not exists target_version_id uuid,
  add column if not exists linked_at timestamptz,
  add column if not exists linked_by uuid;

alter table if exists public.takeoff_version_links
  alter column tenant_id set default public.current_tenant_id(),
  alter column linked_at set default now();

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'takeoff_version_links'
      and c.relkind = 'r'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_tenant_id_fkey'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_tenant_id_fkey
        foreign key (tenant_id)
        references public.tenants(id)
        on delete restrict;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_takeoff_job_id_fkey'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_takeoff_job_id_fkey
        foreign key (takeoff_job_id)
        references public.takeoff_jobs(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_source_version_id_fkey'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_source_version_id_fkey
        foreign key (source_version_id)
        references public.estimate_versions(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_target_version_id_fkey'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_target_version_id_fkey
        foreign key (target_version_id)
        references public.estimate_versions(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_linked_by_fkey'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_linked_by_fkey
        foreign key (linked_by)
        references auth.users(id);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_source_target_check'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_source_target_check
        check (source_version_id <> target_version_id);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_version_links'::regclass
        and conname = 'takeoff_version_links_job_target_key'
    ) then
      alter table public.takeoff_version_links
        add constraint takeoff_version_links_job_target_key
        unique (takeoff_job_id, target_version_id);
    end if;
  end if;
end
$$;

alter table if exists public.takeoff_version_links
  alter column tenant_id set not null,
  alter column takeoff_job_id set not null,
  alter column source_version_id set not null,
  alter column target_version_id set not null,
  alter column linked_at set not null;

create index if not exists takeoff_version_links_tenant_target_idx
  on public.takeoff_version_links (tenant_id, target_version_id);

create index if not exists takeoff_version_links_tenant_source_idx
  on public.takeoff_version_links (tenant_id, source_version_id);

create index if not exists takeoff_version_links_job_idx
  on public.takeoff_version_links (takeoff_job_id);

create or replace function public.assign_takeoff_version_links_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  job_tenant_id uuid;
  job_source_version_id uuid;
  source_tenant_id uuid;
  source_project_id uuid;
  target_tenant_id uuid;
  target_project_id uuid;
begin
  if new.takeoff_job_id is not null then
    select tj.tenant_id, tj.estimate_version_id
      into job_tenant_id, job_source_version_id
    from public.takeoff_jobs tj
    where tj.id = new.takeoff_job_id;
  end if;

  if new.source_version_id is not null then
    select ev.tenant_id, ev.project_id
      into source_tenant_id, source_project_id
    from public.estimate_versions ev
    where ev.id = new.source_version_id;
  end if;

  if new.target_version_id is not null then
    select ev.tenant_id, ev.project_id
      into target_tenant_id, target_project_id
    from public.estimate_versions ev
    where ev.id = new.target_version_id;
  end if;

  if job_source_version_id is not null
    and new.source_version_id is not null
    and job_source_version_id is distinct from new.source_version_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_VERSION_LINK_SOURCE_MISMATCH',
        detail = format(
          'takeoff_job_id=%s belongs to source_version_id=%s, got source_version_id=%s',
          new.takeoff_job_id,
          job_source_version_id,
          new.source_version_id
        );
  end if;

  if source_project_id is not null
    and target_project_id is not null
    and source_project_id is distinct from target_project_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_VERSION_LINK_PROJECT_MISMATCH',
        detail = format(
          'source_version_id=%s (project_id=%s) and target_version_id=%s (project_id=%s) must belong to the same project',
          new.source_version_id,
          source_project_id,
          new.target_version_id,
          target_project_id
        );
  end if;

  if job_tenant_id is not null
    and source_tenant_id is not null
    and job_tenant_id is distinct from source_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_VERSION_LINK_TENANT_MISMATCH',
        detail = format(
          'takeoff_job_id=%s tenant_id=%s and source_version_id=%s tenant_id=%s do not match',
          new.takeoff_job_id,
          job_tenant_id,
          new.source_version_id,
          source_tenant_id
        );
  end if;

  if source_tenant_id is not null
    and target_tenant_id is not null
    and source_tenant_id is distinct from target_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_VERSION_LINK_TENANT_MISMATCH',
        detail = format(
          'source_version_id=%s tenant_id=%s and target_version_id=%s tenant_id=%s do not match',
          new.source_version_id,
          source_tenant_id,
          new.target_version_id,
          target_tenant_id
        );
  end if;

  if job_tenant_id is not null
    and target_tenant_id is not null
    and job_tenant_id is distinct from target_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_VERSION_LINK_TENANT_MISMATCH',
        detail = format(
          'takeoff_job_id=%s tenant_id=%s and target_version_id=%s tenant_id=%s do not match',
          new.takeoff_job_id,
          job_tenant_id,
          new.target_version_id,
          target_tenant_id
        );
  end if;

  new.tenant_id := coalesce(
    job_tenant_id,
    source_tenant_id,
    target_tenant_id,
    new.tenant_id,
    public.current_tenant_id()
  );

  return new;
end;
$$;

drop trigger if exists set_takeoff_version_links_tenant_id on public.takeoff_version_links;
create trigger set_takeoff_version_links_tenant_id
  before insert or update on public.takeoff_version_links
  for each row execute procedure public.assign_takeoff_version_links_tenant_id();

alter table if exists public.takeoff_version_links
  enable row level security;

drop policy if exists "Current tenant can select takeoff version links" on public.takeoff_version_links;
drop policy if exists "Current tenant can insert takeoff version links" on public.takeoff_version_links;
drop policy if exists "Current tenant can update takeoff version links" on public.takeoff_version_links;
drop policy if exists "Current tenant can delete takeoff version links" on public.takeoff_version_links;

create policy "Current tenant can select takeoff version links"
  on public.takeoff_version_links
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(source_version_id, tenant_id))
    and (select public.can_access_takeoff_estimate_version(target_version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_version_links.takeoff_job_id
        and tj.tenant_id = takeoff_version_links.tenant_id
        and tj.estimate_version_id = takeoff_version_links.source_version_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can insert takeoff version links"
  on public.takeoff_version_links
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(source_version_id, tenant_id))
    and (select public.can_access_takeoff_estimate_version(target_version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_version_links.takeoff_job_id
        and tj.tenant_id = takeoff_version_links.tenant_id
        and tj.estimate_version_id = takeoff_version_links.source_version_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can update takeoff version links"
  on public.takeoff_version_links
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(source_version_id, tenant_id))
    and (select public.can_access_takeoff_estimate_version(target_version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_version_links.takeoff_job_id
        and tj.tenant_id = takeoff_version_links.tenant_id
        and tj.estimate_version_id = takeoff_version_links.source_version_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(source_version_id, tenant_id))
    and (select public.can_access_takeoff_estimate_version(target_version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_version_links.takeoff_job_id
        and tj.tenant_id = takeoff_version_links.tenant_id
        and tj.estimate_version_id = takeoff_version_links.source_version_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can delete takeoff version links"
  on public.takeoff_version_links
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(source_version_id, tenant_id))
    and (select public.can_access_takeoff_estimate_version(target_version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_version_links.takeoff_job_id
        and tj.tenant_id = takeoff_version_links.tenant_id
        and tj.estimate_version_id = takeoff_version_links.source_version_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );
