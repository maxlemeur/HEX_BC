begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.set_active_tenant_membership_default(uuid)'::regprocedure
      and procedure.prosecdef
      and position('tenant.is_active' in procedure.prosrc) > 0
      and position('for update' in lower(procedure.prosrc)) > 0
      and position('TENANT_DEFAULT_TARGET_FORBIDDEN' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  )
  and has_function_privilege(
    'authenticated',
    'public.set_active_tenant_membership_default(uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.set_active_tenant_membership_default(uuid)'::regprocedure,
    'EXECUTE'
  ),
  'set_active_tenant_membership_default is security definer, pins search_path, and rejects inactive tenants'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'public.current_tenant_id()'::regprocedure
      and procedure.prosecdef
      and position('t.is_active' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  )
  and exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'public.is_tenant_member(uuid)'::regprocedure
      and procedure.prosecdef
      and position('t.is_active' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  ),
  'membership helpers current_tenant_id and is_tenant_member stay security definer and active-tenant aware'
);

select * from finish();
rollback;
