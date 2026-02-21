-- EST-045: pessimistic draft locks with tenancy-aware RLS.

create table if not exists public.draft_locks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  locked_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now(),
  unique (version_id)
);

create index if not exists draft_locks_tenant_id_idx
  on public.draft_locks (tenant_id);
create index if not exists draft_locks_user_id_idx
  on public.draft_locks (user_id);
create index if not exists draft_locks_expires_at_idx
  on public.draft_locks (expires_at);

create or replace function public.assign_draft_lock_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_draft_locks_tenant_id on public.draft_locks;
create trigger set_draft_locks_tenant_id
  before insert on public.draft_locks
  for each row execute procedure public.assign_draft_lock_tenant_id();

alter table public.draft_locks enable row level security;

drop policy if exists "Tenant members can view draft locks" on public.draft_locks;
drop policy if exists "Lock owners and admins can insert draft locks" on public.draft_locks;
drop policy if exists "Lock owner or admins can renew draft locks" on public.draft_locks;
drop policy if exists "Lock owner or admins can release draft locks" on public.draft_locks;

create policy "Tenant members can view draft locks"
  on public.draft_locks
  for select
  to authenticated
  using (
    tenant_id is not null
    and (
      (select public.is_tenant_member(tenant_id))
      or (select public.is_admin_user())
    )
  );

create policy "Lock owners and admins can insert draft locks"
  on public.draft_locks
  for insert
  to authenticated
  with check (
    tenant_id is not null
    and (
      (
        user_id = (select auth.uid())
        and tenant_id = public.current_tenant_id()
      )
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
      or (select public.is_admin_user())
    )
  );

create policy "Lock owner or admins can renew draft locks"
  on public.draft_locks
  for update
  to authenticated
  using (
    tenant_id is not null
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
      or (select public.is_admin_user())
    )
  )
  with check (
    tenant_id is not null
    and (
      (
        user_id = (select auth.uid())
        and tenant_id = public.current_tenant_id()
      )
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
      or (select public.is_admin_user())
    )
  );

create policy "Lock owner or admins can release draft locks"
  on public.draft_locks
  for delete
  to authenticated
  using (
    tenant_id is not null
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
      or (select public.is_admin_user())
    )
  );

create or replace function public.cleanup_expired_draft_locks(
  target_tenant_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  tenant_filter uuid := target_tenant_id;
  deleted_count integer;
begin
  if tenant_filter is null then
    if (select auth.uid()) is not null and not (select public.is_admin_user()) then
      tenant_filter := public.current_tenant_id();
    end if;
  end if;

  delete from public.draft_locks
  where expires_at < now()
    and (
      tenant_filter is null
      or tenant_id = tenant_filter
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

grant execute on function public.cleanup_expired_draft_locks(uuid) to authenticated;
