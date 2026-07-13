-- Bound estimate AI generation before any provider call. One row is the
-- authoritative tenant/version/operation lease and replay budget.
create table if not exists public.estimate_ai_generation_budgets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  operation text not null,
  lease_token uuid,
  lease_expires_at timestamptz not null,
  window_expires_at timestamptz not null,
  acquisition_count integer not null default 1,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (tenant_id, version_id, operation),
  constraint estimate_ai_generation_budgets_operation_check
    check (operation in ('structure_draft', 'version_zero_draft')),
  constraint estimate_ai_generation_budgets_acquisition_count_check
    check (acquisition_count = 1),
  constraint estimate_ai_generation_budgets_lease_window_check
    check (lease_expires_at <= window_expires_at)
);

create index if not exists estimate_ai_generation_budgets_window_idx
  on public.estimate_ai_generation_budgets (tenant_id, window_expires_at);

alter table public.estimate_ai_generation_budgets enable row level security;
alter table public.estimate_ai_generation_budgets force row level security;

revoke all on table public.estimate_ai_generation_budgets from public;
revoke all on table public.estimate_ai_generation_budgets from anon;
revoke all on table public.estimate_ai_generation_budgets from authenticated;

create or replace function public.acquire_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns table (
  claimed boolean,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
  v_tenant_id uuid;
  v_active_tenant_windows integer;
  v_active_user_windows integer;
  v_tenant_retry_at timestamptz;
  v_user_retry_at timestamptz;
  v_retry_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'estimate_ai_generation_auth_required' using errcode = '42501';
  end if;

  if p_version_id is null or p_lease_token is null then
    raise exception 'estimate_ai_generation_invalid_claim';
  end if;

  if p_operation not in ('structure_draft', 'version_zero_draft') then
    raise exception 'estimate_ai_generation_invalid_operation';
  end if;

  select ev.tenant_id
    into v_tenant_id
  from public.estimate_versions ev
  join public.estimate_projects ep
    on ep.id = ev.project_id
   and ep.tenant_id = ev.tenant_id
  join public.tenants t
    on t.id = ev.tenant_id
   and t.is_active = true
  where ev.id = p_version_id
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = ev.tenant_id
        and tm.user_id = v_user_id
        and tm.role in ('admin'::public.tenant_role, 'engineer'::public.tenant_role)
    )
    and exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = ev.id
        and dl.tenant_id = ev.tenant_id
        and dl.user_id = v_user_id
        and dl.expires_at > v_now
    );

  if v_tenant_id is null then
    raise exception 'estimate_ai_generation_access_denied' using errcode = '42501';
  end if;

  -- Serialize all claims for one tenant. The per-version primary key alone is
  -- insufficient because one actor can lock many versions concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_id::text, 0)
  );

  select count(*), min(b.window_expires_at)
    into v_active_tenant_windows, v_tenant_retry_at
  from public.estimate_ai_generation_budgets b
  where b.tenant_id = v_tenant_id
    and b.window_expires_at > v_now;

  select count(*), min(b.window_expires_at)
    into v_active_user_windows, v_user_retry_at
  from public.estimate_ai_generation_budgets b
  where b.tenant_id = v_tenant_id
    and b.created_by = v_user_id
    and b.window_expires_at > v_now;

  if v_active_tenant_windows >= 4 or v_active_user_windows >= 2 then
    v_retry_at := case
      when v_active_tenant_windows >= 4 and v_active_user_windows >= 2 then
        least(v_tenant_retry_at, v_user_retry_at)
      when v_active_tenant_windows >= 4 then v_tenant_retry_at
      else v_user_retry_at
    end;

    return query
    select
      false,
      greatest(
        1,
        ceil(extract(epoch from (coalesce(v_retry_at, v_now) - v_now)))::integer
      );
    return;
  end if;

  insert into public.estimate_ai_generation_budgets (
    tenant_id,
    version_id,
    operation,
    lease_token,
    lease_expires_at,
    window_expires_at,
    acquisition_count,
    created_by,
    created_at,
    updated_at,
    completed_at
  )
  values (
    v_tenant_id,
    p_version_id,
    p_operation,
    p_lease_token,
    v_now + interval '5 minutes',
    v_now + interval '10 minutes',
    1,
    v_user_id,
    v_now,
    v_now,
    null
  )
  on conflict (tenant_id, version_id, operation) do update
  set
    lease_token = excluded.lease_token,
    lease_expires_at = excluded.lease_expires_at,
    window_expires_at = excluded.window_expires_at,
    acquisition_count = 1,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    completed_at = null
  where public.estimate_ai_generation_budgets.lease_expires_at <= v_now
    and public.estimate_ai_generation_budgets.window_expires_at <= v_now;

  if found then
    return query select true, 0;
    return;
  end if;

  select greatest(b.lease_expires_at, b.window_expires_at)
    into v_retry_at
  from public.estimate_ai_generation_budgets b
  where b.tenant_id = v_tenant_id
    and b.version_id = p_version_id
    and b.operation = p_operation;

  return query
  select
    false,
    greatest(
      1,
      ceil(extract(epoch from (coalesce(v_retry_at, v_now) - v_now)))::integer
    );
end;
$$;

create or replace function public.complete_estimate_ai_generation_lease(
  p_version_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'estimate_ai_generation_auth_required' using errcode = '42501';
  end if;

  update public.estimate_ai_generation_budgets b
  set
    lease_token = null,
    lease_expires_at = v_now,
    completed_at = v_now,
    updated_at = v_now
  where b.version_id = p_version_id
    and b.operation = p_operation
    and b.lease_token = p_lease_token
    and b.created_by = v_user_id;

  return found;
end;
$$;

revoke all on function public.acquire_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from public;
revoke all on function public.acquire_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from anon;
revoke all on function public.acquire_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from authenticated;
grant execute on function public.acquire_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) to authenticated;

revoke all on function public.complete_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from public;
revoke all on function public.complete_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from anon;
revoke all on function public.complete_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) from authenticated;
grant execute on function public.complete_estimate_ai_generation_lease(
  uuid,
  text,
  uuid
) to authenticated;
