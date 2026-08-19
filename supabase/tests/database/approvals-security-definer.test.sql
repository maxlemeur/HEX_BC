begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.decide_estimate_approval(uuid,public.estimate_approval_status)'::regprocedure
      and procedure.prosecdef
      and position('current_tenant_id' in procedure.prosrc) > 0
      and position('has_tenant_role' in procedure.prosrc) > 0
      and position('ESTIMATE_APPROVAL_DECISION_FORBIDDEN' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  )
  and has_function_privilege(
    'authenticated',
    'public.decide_estimate_approval(uuid,public.estimate_approval_status)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.decide_estimate_approval(uuid,public.estimate_approval_status)'::regprocedure,
    'EXECUTE'
  ),
  'decide_estimate_approval is security definer, pins search_path, and stays tenant-scoped'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure
      and not procedure.prosecdef
      and position('ESTIMATE_REVIEW_OPEN_REQUIRES_SERVICE_ROLE' in procedure.prosrc) > 0
      and position('p_tenant_id' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  )
  and has_function_privilege(
    'service_role',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.open_estimate_review_cycle(uuid,uuid,uuid,uuid,uuid[],text,jsonb)'::regprocedure,
    'EXECUTE'
  ),
  'open_estimate_review_cycle submit RPC is service-role only and pins search_path'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid = 'public.list_approval_queue(text)'::regprocedure
      and procedure.prosecdef
      and position('current_tenant_id' in procedure.prosrc) > 0
      and position('has_tenant_role' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
  )
  and has_function_privilege(
    'authenticated',
    'public.list_approval_queue(text)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.list_approval_queue(text)'::regprocedure,
    'EXECUTE'
  ),
  'list_approval_queue is security definer, pins search_path, and stays tenant-scoped'
);

select * from finish();
rollback;
