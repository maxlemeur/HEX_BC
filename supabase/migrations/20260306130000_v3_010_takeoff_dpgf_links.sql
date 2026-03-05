-- V3-010: liens manuels persistants entre lignes DPGF et items takeoff.
-- Scope par version + job, avec garde-fous tenant/projet et RLS indexable.

create table if not exists public.takeoff_dpgf_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  takeoff_item_id uuid not null references public.takeoff_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  linked_by uuid references auth.users(id),
  constraint takeoff_dpgf_links_estimate_item_key
    unique (tenant_id, version_id, takeoff_job_id, estimate_item_id),
  constraint takeoff_dpgf_links_takeoff_item_key
    unique (tenant_id, version_id, takeoff_job_id, takeoff_item_id)
);

alter table if exists public.takeoff_dpgf_links
  add column if not exists tenant_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists estimate_item_id uuid,
  add column if not exists takeoff_item_id uuid,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists linked_by uuid;

alter table if exists public.takeoff_dpgf_links
  alter column tenant_id set default public.current_tenant_id(),
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'takeoff_dpgf_links'
      and c.relkind = 'r'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_tenant_id_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_tenant_id_fkey
        foreign key (tenant_id)
        references public.tenants(id)
        on delete restrict;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_version_id_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_version_id_fkey
        foreign key (version_id)
        references public.estimate_versions(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_takeoff_job_id_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_takeoff_job_id_fkey
        foreign key (takeoff_job_id)
        references public.takeoff_jobs(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_estimate_item_id_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_estimate_item_id_fkey
        foreign key (estimate_item_id)
        references public.estimate_items(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_takeoff_item_id_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_takeoff_item_id_fkey
        foreign key (takeoff_item_id)
        references public.takeoff_items(id)
        on delete cascade;
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_linked_by_fkey'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_linked_by_fkey
        foreign key (linked_by)
        references auth.users(id);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_estimate_item_key'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_estimate_item_key
        unique (tenant_id, version_id, takeoff_job_id, estimate_item_id);
    end if;

    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.takeoff_dpgf_links'::regclass
        and conname = 'takeoff_dpgf_links_takeoff_item_key'
    ) then
      alter table public.takeoff_dpgf_links
        add constraint takeoff_dpgf_links_takeoff_item_key
        unique (tenant_id, version_id, takeoff_job_id, takeoff_item_id);
    end if;
  end if;
end
$$;

alter table if exists public.takeoff_dpgf_links
  alter column tenant_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_item_id set not null,
  alter column takeoff_item_id set not null,
  alter column created_at set not null,
  alter column updated_at set not null;

create index if not exists takeoff_dpgf_links_tenant_version_job_idx
  on public.takeoff_dpgf_links (tenant_id, version_id, takeoff_job_id);

create index if not exists takeoff_dpgf_links_tenant_estimate_item_idx
  on public.takeoff_dpgf_links (tenant_id, estimate_item_id);

create index if not exists takeoff_dpgf_links_tenant_takeoff_item_idx
  on public.takeoff_dpgf_links (tenant_id, takeoff_item_id);

create or replace function public.save_takeoff_dpgf_manual_link(
  p_version_id uuid,
  p_takeoff_job_id uuid,
  p_estimate_item_id uuid,
  p_takeoff_item_id uuid,
  p_linked_by uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted_link_id uuid;
begin
  if p_version_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_VERSION_REQUIRED';
  end if;

  if p_takeoff_job_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_JOB_REQUIRED';
  end if;

  if p_estimate_item_id is null then
    raise exception using message = 'TAKEOFF_DPGF_LINK_ESTIMATE_ITEM_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.takeoff_jobs tj
    join public.estimate_versions ev on ev.id = tj.estimate_version_id
    where tj.id = p_takeoff_job_id
      and tj.tenant_id = (select public.current_tenant_id())
      and ev.project_id = (
        select target.project_id
        from public.estimate_versions target
        where target.id = p_version_id
      )
      and (
        tj.estimate_version_id = p_version_id
        or exists (
          select 1
          from public.takeoff_version_links tvl
          where tvl.tenant_id = tj.tenant_id
            and tvl.target_version_id = p_version_id
            and tvl.takeoff_job_id = p_takeoff_job_id
        )
      )
      and (select public.can_access_takeoff_estimate_version(p_version_id, tj.tenant_id))
      and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
  ) then
    raise exception using message = 'TAKEOFF_DPGF_LINK_SCOPE_INVALID';
  end if;

  if p_takeoff_item_id is null then
    delete from public.takeoff_dpgf_links
    where tenant_id = (select public.current_tenant_id())
      and version_id = p_version_id
      and takeoff_job_id = p_takeoff_job_id
      and estimate_item_id = p_estimate_item_id;

    return null;
  end if;

  delete from public.takeoff_dpgf_links
  where tenant_id = (select public.current_tenant_id())
    and version_id = p_version_id
    and takeoff_job_id = p_takeoff_job_id
    and (
      estimate_item_id = p_estimate_item_id
      or takeoff_item_id = p_takeoff_item_id
    );

  insert into public.takeoff_dpgf_links (
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    takeoff_item_id,
    linked_by
  )
  values (
    (select public.current_tenant_id()),
    p_version_id,
    p_takeoff_job_id,
    p_estimate_item_id,
    p_takeoff_item_id,
    p_linked_by
  )
  returning id into v_inserted_link_id;

  return v_inserted_link_id;
end;
$$;

grant execute on function public.save_takeoff_dpgf_manual_link(uuid, uuid, uuid, uuid, uuid)
  to authenticated;

create or replace function public.assign_takeoff_dpgf_links_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_tenant_id uuid;
  target_project_id uuid;
  job_tenant_id uuid;
  job_version_id uuid;
  job_project_id uuid;
  estimate_item_tenant_id uuid;
  estimate_item_version_id uuid;
  estimate_item_type public.estimate_item_type;
  estimate_item_source_provider text;
  takeoff_item_tenant_id uuid;
  takeoff_item_job_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id, ev.project_id
      into target_tenant_id, target_project_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.takeoff_job_id is not null then
    select tj.tenant_id, tj.estimate_version_id, ev.project_id
      into job_tenant_id, job_version_id, job_project_id
    from public.takeoff_jobs tj
    join public.estimate_versions ev on ev.id = tj.estimate_version_id
    where tj.id = new.takeoff_job_id;
  end if;

  if new.estimate_item_id is not null then
    select ei.tenant_id, ei.version_id, ei.item_type, coalesce(ei.source_provider, '')
      into estimate_item_tenant_id, estimate_item_version_id, estimate_item_type, estimate_item_source_provider
    from public.estimate_items ei
    where ei.id = new.estimate_item_id;
  end if;

  if new.takeoff_item_id is not null then
    select ti.tenant_id, ti.job_id
      into takeoff_item_tenant_id, takeoff_item_job_id
    from public.takeoff_items ti
    where ti.id = new.takeoff_item_id;
  end if;

  if estimate_item_version_id is not null
    and new.version_id is not null
    and estimate_item_version_id is distinct from new.version_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_VERSION_MISMATCH',
        detail = format(
          'estimate_item_id=%s belongs to version_id=%s, got version_id=%s',
          new.estimate_item_id,
          estimate_item_version_id,
          new.version_id
        );
  end if;

  if estimate_item_type is not null
    and estimate_item_type is distinct from 'line'::public.estimate_item_type then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_ITEM_TYPE_INVALID',
        detail = format(
          'estimate_item_id=%s must reference an estimate line, got item_type=%s',
          new.estimate_item_id,
          estimate_item_type
        );
  end if;

  if estimate_item_source_provider is not null
    and estimate_item_source_provider <> ''
    and estimate_item_source_provider is distinct from 'dpgf' then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_SOURCE_PROVIDER_INVALID',
        detail = format(
          'estimate_item_id=%s must reference a DPGF source line, got source_provider=%s',
          new.estimate_item_id,
          estimate_item_source_provider
        );
  end if;

  if takeoff_item_job_id is not null
    and new.takeoff_job_id is not null
    and takeoff_item_job_id is distinct from new.takeoff_job_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_JOB_MISMATCH',
        detail = format(
          'takeoff_item_id=%s belongs to takeoff_job_id=%s, got takeoff_job_id=%s',
          new.takeoff_item_id,
          takeoff_item_job_id,
          new.takeoff_job_id
        );
  end if;

  if target_project_id is not null
    and job_project_id is not null
    and target_project_id is distinct from job_project_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_PROJECT_MISMATCH',
        detail = format(
          'version_id=%s (project_id=%s) and takeoff_job_id=%s (project_id=%s) must belong to the same project',
          new.version_id,
          target_project_id,
          new.takeoff_job_id,
          job_project_id
        );
  end if;

  new.tenant_id := coalesce(
    target_tenant_id,
    job_tenant_id,
    estimate_item_tenant_id,
    takeoff_item_tenant_id,
    new.tenant_id,
    public.current_tenant_id()
  );

  if job_tenant_id is not null and job_tenant_id is distinct from new.tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_TENANT_MISMATCH';
  end if;

  if estimate_item_tenant_id is not null and estimate_item_tenant_id is distinct from new.tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_TENANT_MISMATCH';
  end if;

  if takeoff_item_tenant_id is not null and takeoff_item_tenant_id is distinct from new.tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'TAKEOFF_DPGF_LINK_TENANT_MISMATCH';
  end if;

  new.updated_at := now();
  if tg_op = 'INSERT' and new.created_at is null then
    new.created_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists set_takeoff_dpgf_links_tenant_id on public.takeoff_dpgf_links;
create trigger set_takeoff_dpgf_links_tenant_id
  before insert or update on public.takeoff_dpgf_links
  for each row execute procedure public.assign_takeoff_dpgf_links_tenant_id();

alter table if exists public.takeoff_dpgf_links
  enable row level security;

drop policy if exists "Current tenant can select takeoff dpgf links" on public.takeoff_dpgf_links;
drop policy if exists "Current tenant can insert takeoff dpgf links" on public.takeoff_dpgf_links;
drop policy if exists "Current tenant can update takeoff dpgf links" on public.takeoff_dpgf_links;
drop policy if exists "Current tenant can delete takeoff dpgf links" on public.takeoff_dpgf_links;

create policy "Current tenant can select takeoff dpgf links"
  on public.takeoff_dpgf_links
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_links.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_links.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_links.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_links.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_links.tenant_id
              and tvl.target_version_id = takeoff_dpgf_links.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_links.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can insert takeoff dpgf links"
  on public.takeoff_dpgf_links
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_links.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_links.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_links.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_links.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_links.tenant_id
              and tvl.target_version_id = takeoff_dpgf_links.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_links.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can update takeoff dpgf links"
  on public.takeoff_dpgf_links
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_links.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_links.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_links.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_links.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_links.tenant_id
              and tvl.target_version_id = takeoff_dpgf_links.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_links.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_links.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_links.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_links.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_links.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_links.tenant_id
              and tvl.target_version_id = takeoff_dpgf_links.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_links.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

create policy "Current tenant can delete takeoff dpgf links"
  on public.takeoff_dpgf_links
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions ev on ev.id = tj.estimate_version_id
      where tj.id = takeoff_dpgf_links.takeoff_job_id
        and tj.tenant_id = takeoff_dpgf_links.tenant_id
        and ev.project_id = (
          select target.project_id
          from public.estimate_versions target
          where target.id = takeoff_dpgf_links.version_id
        )
        and (
          tj.estimate_version_id = takeoff_dpgf_links.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_dpgf_links.tenant_id
              and tvl.target_version_id = takeoff_dpgf_links.version_id
              and tvl.takeoff_job_id = takeoff_dpgf_links.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );
