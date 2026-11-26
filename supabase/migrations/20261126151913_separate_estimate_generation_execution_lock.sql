begin;

create table private.estimate_generation_execution_locks (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation text not null check (operation in ('structure_draft', 'version_zero_draft')),
  token uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  primary key (tenant_id, version_id, operation)
);

create index on private.estimate_generation_execution_locks (version_id);
create index on private.estimate_generation_execution_locks (user_id);
alter table private.estimate_generation_execution_locks enable row level security;
alter table private.estimate_generation_execution_locks force row level security;
revoke all on private.estimate_generation_execution_locks from public, anon, authenticated, service_role;

-- Reuse the exact quota algorithm, including the tenant/user caps and window.
-- All public admission paths must go through the execution check first.
alter function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) set schema private;
alter function private.acquire_estimate_ai_generation_lease(uuid, text, uuid) security invoker;
revoke all on function private.acquire_estimate_ai_generation_lease(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create function public.acquire_estimate_generation_execution(
  p_version_id uuid,
  p_operation text,
  p_token uuid,
  p_draft_lock_session_id uuid,
  p_use_ai boolean
)
returns table (status text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid := public.current_tenant_id();
  v_now timestamptz;
  v_page_expires_at timestamptz;
  v_retry_at timestamptz;
  v_quota record;
begin
  if p_version_id is null or p_token is null or p_use_ai is null
    or p_operation is null or p_operation not in ('structure_draft', 'version_zero_draft')
  then
    raise exception 'estimate_generation_invalid_claim' using errcode = '22023';
  end if;

  if v_user_id is null or not exists (
    select 1
    from public.estimate_versions ev
    join public.estimate_projects ep on ep.id = ev.project_id and ep.tenant_id = ev.tenant_id
    join public.tenant_memberships tm on tm.tenant_id = ev.tenant_id and tm.user_id = v_user_id
    where ev.id = p_version_id and ev.tenant_id = v_tenant_id
      and ev.status = 'draft' and not ep.is_archived
      and (tm.role = 'admin' or (tm.role = 'engineer' and ep.user_id = v_user_id))
  ) then
    raise exception 'estimate_generation_access_denied' using errcode = '42501';
  end if;

  -- Read the current page lease after serializing admission with the same
  -- tenant lock as the AI quota. Do not take a row lock on the page lease:
  -- version deletion can cascade to the page before the execution rows.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_tenant_id::text, 0));

  select dl.expires_at into v_page_expires_at
  from public.draft_locks dl
  where dl.tenant_id = v_tenant_id and dl.version_id = p_version_id
    and dl.user_id = v_user_id and dl.session_id = p_draft_lock_session_id;

  v_now := clock_timestamp();
  if v_page_expires_at is null or v_page_expires_at <= v_now then
    raise exception 'estimate_generation_page_lock_required' using errcode = '40001';
  end if;

  select greatest(
    (select l.expires_at
     from private.estimate_generation_execution_locks l
     where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation),
    -- A request admitted before this migration may still be running.
    (select b.lease_expires_at
     from public.estimate_ai_generation_budgets b
     where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation
       and b.lease_token is not null)
  ) into v_retry_at;

  if v_retry_at > v_now then
    return query select 'busy'::text, ceil(extract(epoch from v_retry_at - v_now))::integer;
    return;
  end if;

  if p_use_ai then
    select * into strict v_quota
    from private.acquire_estimate_ai_generation_lease(p_version_id, p_operation, p_token);

    if not v_quota.claimed then
      return query select 'quota_exceeded'::text, v_quota.retry_after_seconds;
      return;
    end if;
  end if;

  -- The generation routes have a maximum request duration of 300 seconds.
  -- Expired locks can be replaced and the previous token cannot release them.
  insert into private.estimate_generation_execution_locks
    (tenant_id, version_id, operation, token, user_id, expires_at)
  values (v_tenant_id, p_version_id, p_operation, p_token, v_user_id, clock_timestamp() + interval '5 minutes')
  on conflict (tenant_id, version_id, operation) do update
    set token = excluded.token, user_id = excluded.user_id, expires_at = excluded.expires_at;

  return query select 'acquired'::text, 0;
end;
$$;

create function public.release_estimate_generation_execution(
  p_version_id uuid,
  p_operation text,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_tenant_id uuid := public.current_tenant_id();
  v_now timestamptz := clock_timestamp();
  v_quota_released boolean;
begin
  if v_user_id is null then
    raise exception 'estimate_generation_access_denied' using errcode = '42501';
  end if;

  -- Same write order as admission. A matching AI lease is closed without
  -- changing the replay window. This also completes pre-migration requests.
  update public.estimate_ai_generation_budgets b
  set lease_token = null, lease_expires_at = v_now, completed_at = v_now, updated_at = v_now
  where b.tenant_id = v_tenant_id and b.version_id = p_version_id and b.operation = p_operation
    and b.lease_token = p_token and b.created_by = v_user_id;
  v_quota_released := found;

  delete from private.estimate_generation_execution_locks l
  where l.tenant_id = v_tenant_id and l.version_id = p_version_id and l.operation = p_operation
    and l.token = p_token and l.user_id = v_user_id;

  return found or v_quota_released;
end;
$$;

-- Keep the old API safe during deployment and rollback. Older app versions
-- checked the page session themselves and sent only the version and token.
create function public.acquire_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns table (claimed boolean, retry_after_seconds integer)
language sql
security invoker
set search_path = ''
as $$
  select admission.status = 'acquired', admission.retry_after_seconds
  from public.acquire_estimate_generation_execution(
    p_version_id, p_operation, p_lease_token,
    (select dl.session_id from public.draft_locks dl
     where dl.version_id = p_version_id and dl.user_id = (select auth.uid())
       and dl.tenant_id = (select public.current_tenant_id())),
    true
  ) admission;
$$;

create or replace function public.complete_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select public.release_estimate_generation_execution(p_version_id, p_operation, p_lease_token);
$$;

revoke all on function public.acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.release_estimate_generation_execution(uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) from public, anon;
grant execute on function public.acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean) to authenticated;
grant execute on function public.release_estimate_generation_execution(uuid, text, uuid) to authenticated;
grant execute on function public.acquire_estimate_ai_generation_lease(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
