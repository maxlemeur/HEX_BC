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
    and exists (
      select 1
      from public.estimate_versions ev
      join public.estimate_projects ep on ep.id = ev.project_id
      where ev.id = draft_locks.version_id
        and ev.tenant_id = draft_locks.tenant_id
        and ep.tenant_id = ev.tenant_id
        and (
          ep.user_id = (select auth.uid())
          or (select public.has_tenant_role(ev.tenant_id, array['admin'::public.tenant_role]))
          or (select public.is_admin_user())
        )
    )
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
  if (select auth.uid()) is not null and not (select public.is_admin_user()) then
    tenant_filter := public.current_tenant_id();
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

-- Consolidated from 027_est_029_supply_types.sql to keep migration versions unique.
-- EST-029: supply types per tenant and estimate item linkage.

create table if not exists public.supply_types (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null,
  name text not null,
  unique (tenant_id, code)
);

drop trigger if exists set_supply_types_updated_at on public.supply_types;
create trigger set_supply_types_updated_at
  before update on public.supply_types
  for each row execute procedure public.set_updated_at();

create index if not exists supply_types_tenant_id_idx
  on public.supply_types (tenant_id);

alter table public.supply_types enable row level security;

drop policy if exists "Users can manage supply types" on public.supply_types;
create policy "Users can manage supply types"
  on public.supply_types
  for all
  to authenticated
  using ((select public.is_tenant_member(tenant_id)))
  with check ((select public.is_tenant_member(tenant_id)));

alter table public.estimate_items
  add column if not exists supply_type_id uuid references public.supply_types(id) on delete set null;

create index if not exists estimate_items_supply_type_id_idx
  on public.estimate_items (supply_type_id);

insert into public.supply_types (tenant_id, code, name)
select
  t.id,
  default_supply_type.code,
  default_supply_type.name
from public.tenants t
cross join (
  values
    ('tube', 'Tube'),
    ('raccord', 'Raccord'),
    ('robinetterie', 'Robinetterie'),
    ('vanne', 'Vanne'),
    ('calorifuge', 'Calorifuge'),
    ('support', 'Support'),
    ('divers', 'Divers')
) as default_supply_type(code, name)
on conflict (tenant_id, code)
do update
set name = excluded.name;

with category_names as (
  select
    ec.tenant_id,
    lower(btrim(ec.name)) as normalized_name,
    min(btrim(ec.name)) as canonical_name
  from public.estimate_categories ec
  where coalesce(btrim(ec.name), '') <> ''
  group by ec.tenant_id, lower(btrim(ec.name))
)
insert into public.supply_types (tenant_id, code, name)
select
  cn.tenant_id,
  'cat_' || substr(md5(cn.normalized_name), 1, 16) as code,
  cn.canonical_name as name
from category_names cn
where not exists (
  select 1
  from public.supply_types st
  where st.tenant_id = cn.tenant_id
    and lower(btrim(st.name)) = cn.normalized_name
)
on conflict (tenant_id, code) do nothing;

update public.estimate_items item
set supply_type_id = matched_supply_type.id
from public.estimate_categories category
join lateral (
  select st.id
  from public.supply_types st
  where st.tenant_id = category.tenant_id
    and lower(btrim(st.name)) = lower(btrim(category.name))
  order by st.created_at asc, st.id asc
  limit 1
) matched_supply_type on true
where item.category_id = category.id
  and item.tenant_id = category.tenant_id
  and item.supply_type_id is null;
