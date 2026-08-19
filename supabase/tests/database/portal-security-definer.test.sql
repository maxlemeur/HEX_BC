begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.claim_portal_estimate_decision(uuid,text,inet,text)'::regprocedure
      and procedure.prosecdef = false
      and position('current_user <> ''service_role''' in procedure.prosrc) > 0
      and position('join public.tenants t on t.id = ev.tenant_id' in procedure.prosrc) > 0
      and position('and t.is_active' in procedure.prosrc) > 0
      and position('for update of ev, t' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  ),
  'claim_portal_estimate_decision pins search_path and locks an active tenant'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_portal_estimate_decision(uuid,text,inet,text)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_portal_estimate_decision(uuid,text,inet,text)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_portal_estimate_decision(uuid,text,inet,text)'::regprocedure,
    'EXECUTE'
  ),
  'claim_portal_estimate_decision remains service-role only'
);

select * from finish();
rollback;
