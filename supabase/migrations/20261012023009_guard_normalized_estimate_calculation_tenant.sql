begin;

-- The labor-role tenant normalizer runs after this gate alphabetically.
-- Mirror its existing NULL -> current_tenant_id rule before taking OLD/NEW
-- locks, so a legacy V1 role moved into the calculating tenant cannot escape
-- its shared gate. Margin tiers and flags have no such normalizer.
-- Preserve the installed function's owner, invoker mode, grants and triggers.
create or replace function private.guard_estimate_calculation_context_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare affected_tenant uuid; old_tenant uuid; new_tenant uuid;
begin
  if tg_table_name = 'feature_flags' then
    if tg_op <> 'INSERT' and old.flag_key = 'EST_031_LABOR_SPLIT' then old_tenant := old.tenant_id; end if;
    if tg_op <> 'DELETE' and new.flag_key = 'EST_031_LABOR_SPLIT' then new_tenant := new.tenant_id; end if;
  else
    if tg_op <> 'INSERT' then old_tenant := old.tenant_id; end if;
    if tg_op <> 'DELETE' then
      new_tenant := case when tg_table_name='labor_roles'
        then coalesce(new.tenant_id,public.current_tenant_id()) else new.tenant_id end;
    end if;
  end if;
  for affected_tenant in select distinct t from unnest(array[old_tenant,new_tenant]) t where t is not null order by t loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('estimate-calculation:'||affected_tenant::text,0)) then
      raise exception using errcode='40001',message='ESTIMATE_CREATE_CONTEXT_CHANGED';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

commit;
