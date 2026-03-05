-- V3-001: ajouter un scope projet sur plan_sets sans casser le mode legacy version-scope.

do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'plan_sets'
      and c.relkind = 'r'
  )
  and not exists (
    select 1
    from pg_attribute
    where attrelid = 'public.plan_sets'::regclass
      and attname = 'project_id'
      and not attisdropped
  ) then
    alter table public.plan_sets
      add column project_id uuid;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.plan_sets'::regclass
      and attname = 'project_id'
      and not attisdropped
  )
  and not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.plan_sets'::regclass
      and conname = 'plan_sets_project_id_fkey'
  ) then
    alter table public.plan_sets
      add constraint plan_sets_project_id_fkey
      foreign key (project_id)
      references public.estimate_projects(id)
      on delete cascade;
  end if;
end;
$$;

create index if not exists plan_sets_tenant_project_idx
  on public.plan_sets (tenant_id, project_id, created_at desc);

create index if not exists plan_sets_tenant_project_not_null_idx
  on public.plan_sets (tenant_id, project_id, created_at desc)
  where project_id is not null;

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

  if parent_tenant_id is null and new.project_id is not null then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;
