begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- 20261013130248 replaced the four-argument decision RPC with one that also
-- binds the expected seal hash and document proof. The same invoker, trusted
-- caller, active-tenant lock and pinned search_path properties must hold.
select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb)'::regprocedure
      and procedure.prosecdef = false
      and position('current_user<>''service_role''' in procedure.prosrc) > 0
      and position('join public.tenants t on t.id=v.tenant_id and t.is_active' in procedure.prosrc) > 0
      and position('for update of v,t' in procedure.prosrc) > 0
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
    'public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.claim_portal_estimate_decision(uuid,text,inet,text,text,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'claim_portal_estimate_decision remains service-role only'
);

select ok(
  to_regprocedure('public.claim_portal_estimate_decision(uuid,text,inet,text)') is null
  and not exists (
    select 1
    from pg_proc as procedure
    where procedure.pronamespace = 'public'::regnamespace
      and procedure.proname = 'claim_portal_estimate_decision'
      and (
        procedure.prosecdef
        or has_function_privilege('anon', procedure.oid, 'EXECUTE')
        or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
  ),
  'no proof-less or client-executable portal decision overload remains'
);

select * from finish();
rollback;
