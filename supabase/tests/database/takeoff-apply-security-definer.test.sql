begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb)'::regprocedure
      and procedure.prosecdef
      and position('has_tenant_role' in procedure.prosrc) > 0
      and position('assert_takeoff_active_tenant' in procedure.prosrc) > 0
      and position('TAKEOFF_ROOT_REPLACE_DISABLED' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=pg_catalog'
      )
  ),
  'apply_takeoff_job_guarded_atomic is security definer, pins search_path, and checks the active tenant'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    where procedure.oid =
      'public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb,text)'::regprocedure
      and procedure.prosecdef
      and position('authorization_token_hash' in procedure.prosrc) > 0
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting = 'search_path=pg_catalog'
      )
  ),
  'token-bound apply_takeoff_job_guarded_atomic stays security definer with a pinned search_path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb,text)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.apply_takeoff_job_guarded_atomic(uuid,text,uuid,jsonb)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job(uuid,text,uuid)'::regprocedure,
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.apply_takeoff_job_guarded(uuid,text,uuid)'::regprocedure,
    'EXECUTE'
  ),
  'only the guarded atomic takeoff apply RPCs stay executable for authenticated callers'
);

select * from finish();
rollback;
