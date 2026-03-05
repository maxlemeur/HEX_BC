-- V3-004: backfill project_id sur plan_sets et bascule des contraintes vers project-scope.

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
  and exists (
    select 1
    from pg_attribute
    where attrelid = 'public.plan_sets'::regclass
      and attname = 'project_id'
      and not attisdropped
  )
  and exists (
    select 1
    from pg_attribute
    where attrelid = 'public.plan_sets'::regclass
      and attname = 'estimate_version_id'
      and not attisdropped
  ) then
    update public.plan_sets ps
    set project_id = ev.project_id
    from public.estimate_versions ev
    where ev.id = ps.estimate_version_id
      and ps.project_id is null;
  end if;
end;
$$;

-- Validation explicite demandee par la story V3-004.
select count(*) as plan_sets_missing_project_id
from public.plan_sets
where project_id is null;

do $$
declare
  v_missing_count integer;
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'plan_sets'
      and c.relkind = 'r'
  ) then
    select count(*)
      into v_missing_count
    from public.plan_sets
    where project_id is null;

    if v_missing_count > 0 then
      raise exception
        using
          errcode = '23514',
          message = 'PLAN_SETS_PROJECT_ID_BACKFILL_INCOMPLETE',
          detail = format('%s row(s) in public.plan_sets still have project_id is null', v_missing_count);
    end if;
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
      and attnotnull = false
  ) then
    alter table public.plan_sets
      alter column project_id set not null;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_attribute
    where attrelid = 'public.plan_sets'::regclass
      and attname = 'estimate_version_id'
      and not attisdropped
      and attnotnull = true
  ) then
    alter table public.plan_sets
      alter column estimate_version_id drop not null;
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
      and conname = 'plan_sets_project_id_not_null_check'
  ) then
    alter table public.plan_sets
      add constraint plan_sets_project_id_not_null_check
      check (project_id is not null);
  end if;
end;
$$;
