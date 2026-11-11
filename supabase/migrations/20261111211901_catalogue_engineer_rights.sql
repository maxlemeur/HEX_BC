-- TI-689. No remote application is authorized here.
-- Catalogue rights depend on the company. Until now only an admin wrote public.suppliers and public.products
-- (policies « Admins can insert/update/delete … », 013_multitenant_core_s5.sql), while an engineer could already
-- create both through the supplier offer form (public.create_supplier_catalog_price, security definer). Now:
-- - an admin still writes everything;
-- - an engineer adds suppliers and items, and changes or deletes the ones they added (created_by);
-- - the admin decides whether engineers also change the shared base, through
--   public.tenant_catalogue_policies.engineers_can_edit_shared (absent row = false), written only by
--   public.set_tenant_catalogue_policy;
-- - validating a reference price stays an admin act: public.validate_product_reference_price and the trigger
--   protect_product_reference_price (20260906145000) are untouched, so an engineer who may update an item still
--   cannot change its price without a validation.
-- Rows that exist keep created_by null: they are the shared base. viewer and director gain nothing.
-- Regression: supabase/tests/database/catalogue-engineer-rights.test.sql.
begin;

do $preflight$
begin
  if to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
    or to_regclass('public.products') is null
    or to_regclass('public.suppliers') is null
    or to_regprocedure('public.suggest_product_reference()') is null
  then
    raise exception 'TI689_PREREQUISITE_MISSING';
  end if;
  if to_regclass('public.tenant_catalogue_policies') is not null then
    raise exception 'TI689_PREFLIGHT: public.tenant_catalogue_policies already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The company setting.
-- ---------------------------------------------------------------------------
create table public.tenant_catalogue_policies (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  engineers_can_edit_shared boolean not null default false,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.tenant_catalogue_policies is
  'TI-689: catalogue rights of a tenant. engineers_can_edit_shared lets engineers change and delete suppliers and items they did not add (absent row = false). Written only by public.set_tenant_catalogue_policy (tenant admin).';

create index tenant_catalogue_policies_updated_by_idx
  on public.tenant_catalogue_policies (updated_by);

alter table public.tenant_catalogue_policies enable row level security;

create policy "Tenant members read their catalogue policy"
  on public.tenant_catalogue_policies
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_catalogue_policies.tenant_id)));

revoke all on table public.tenant_catalogue_policies from public, anon, authenticated;
grant select on table public.tenant_catalogue_policies to authenticated;
grant select, insert, update, delete on table public.tenant_catalogue_policies to service_role;

create function public.set_tenant_catalogue_policy(
  p_tenant_id uuid,
  p_engineers_can_edit_shared boolean
)
returns public.tenant_catalogue_policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  written_policy public.tenant_catalogue_policies%rowtype;
begin
  if actor_user_id is null
    or p_tenant_id is null
    or not public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'TENANT_CATALOGUE_POLICY_ADMIN_ONLY';
  end if;
  if p_engineers_can_edit_shared is null then
    raise exception using errcode = '22023', message = 'TENANT_CATALOGUE_POLICY_REQUIRED';
  end if;

  insert into public.tenant_catalogue_policies as policy (
    tenant_id, engineers_can_edit_shared, updated_by, updated_at
  ) values (
    p_tenant_id, p_engineers_can_edit_shared, actor_user_id, now()
  )
  on conflict (tenant_id) do update
    set engineers_can_edit_shared = excluded.engineers_can_edit_shared,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
  returning policy.* into written_policy;

  return written_policy;
end;
$$;

comment on function public.set_tenant_catalogue_policy(uuid, boolean) is
  'TI-689: a tenant admin decides whether engineers change the shared catalogue (TENANT_CATALOGUE_POLICY_ADMIN_ONLY, TENANT_CATALOGUE_POLICY_REQUIRED).';

revoke all on function public.set_tenant_catalogue_policy(uuid, boolean) from public, anon;
grant execute on function public.set_tenant_catalogue_policy(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Who added a supplier or an item. Stamped by the base, never by the caller. The same trigger freezes the
--    tenant of a row for signed-in members (CATALOGUE_RECORD_TENANT_FROZEN).
-- ---------------------------------------------------------------------------
alter table public.suppliers
  add column created_by uuid references public.profiles(id) on delete set null;
alter table public.products
  add column created_by uuid references public.profiles(id) on delete set null;

comment on column public.suppliers.created_by is
  'TI-689: member who added the supplier (null: shared base, or a row older than TI-689). Set by trigger at insert, then frozen.';
comment on column public.products.created_by is
  'TI-689: member who added the item (null: shared base, or a row older than TI-689). Set by trigger at insert, then frozen.';

create index suppliers_created_by_idx on public.suppliers (created_by);
create index products_created_by_idx on public.products (created_by);

create function public.stamp_catalogue_record_author()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A signed-in member never chooses the author; a server writer without a user (service_role, a migration) may.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    new.created_by := old.created_by;
    -- The update policies read the new row's tenant: without this, a member holding a write role in two tenants
    -- could move a supplier or an item from one to the other.
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '42501', message = 'CATALOGUE_RECORD_TENANT_FROZEN';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.stamp_catalogue_record_author() from public, anon, authenticated;

create trigger stamp_suppliers_author
  before insert or update on public.suppliers
  for each row execute function public.stamp_catalogue_record_author();
create trigger stamp_products_author
  before insert or update on public.products
  for each row execute function public.stamp_catalogue_record_author();

-- ---------------------------------------------------------------------------
-- 3. The one rule read by the update and delete policies, and by the application to show or hide its buttons.
-- ---------------------------------------------------------------------------
create function public.can_edit_catalogue_record(p_tenant_id uuid, p_created_by uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role])
    or (
      public.has_tenant_role(p_tenant_id, array['engineer'::public.tenant_role])
      and (
        (p_created_by is not null and p_created_by = (select auth.uid()))
        or exists (
          select 1
          from public.tenant_catalogue_policies policy
          where policy.tenant_id = p_tenant_id
            and policy.engineers_can_edit_shared
        )
      )
    );
$$;

comment on function public.can_edit_catalogue_record(uuid, uuid) is
  'TI-689: true for a tenant admin, and for an engineer on a supplier or item they added, or on any of them when the tenant lets engineers edit the shared catalogue.';

revoke all on function public.can_edit_catalogue_record(uuid, uuid) from public, anon;
grant execute on function public.can_edit_catalogue_record(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Policies. Reading is unchanged (every member of the tenant).
-- ---------------------------------------------------------------------------
drop policy "Admins can insert suppliers" on public.suppliers;
drop policy "Admins can update suppliers" on public.suppliers;
drop policy "Admins can delete suppliers" on public.suppliers;
drop policy "Admins can insert products" on public.products;
drop policy "Admins can update products" on public.products;
drop policy "Admins can delete products" on public.products;

create policy "Catalogue editors can insert suppliers"
  on public.suppliers
  for insert
  to authenticated
  with check ((select public.has_tenant_role(
    tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])));

create policy "Catalogue editors can update suppliers"
  on public.suppliers
  for update
  to authenticated
  using ((select public.can_edit_catalogue_record(tenant_id, created_by)))
  with check ((select public.can_edit_catalogue_record(tenant_id, created_by)));

create policy "Catalogue editors can delete suppliers"
  on public.suppliers
  for delete
  to authenticated
  using ((select public.can_edit_catalogue_record(tenant_id, created_by)));

create policy "Catalogue editors can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select public.has_tenant_role(
    tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])));

create policy "Catalogue editors can update products"
  on public.products
  for update
  to authenticated
  using ((select public.can_edit_catalogue_record(tenant_id, created_by)))
  with check ((select public.can_edit_catalogue_record(tenant_id, created_by)));

create policy "Catalogue editors can delete products"
  on public.products
  for delete
  to authenticated
  using ((select public.can_edit_catalogue_record(tenant_id, created_by)));

-- ---------------------------------------------------------------------------
-- 5. The reference suggestion of the item form follows the insert right. Body from
--    20261002155954_product_internal_reference_auto.sql; only the role list and its message change.
-- ---------------------------------------------------------------------------
create or replace function public.suggest_product_reference()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_tenant_id uuid := public.current_tenant_id();
  next_number bigint;
  number_text text;
begin
  if auth.uid() is null or target_tenant_id is null
    or not public.has_tenant_role(
      target_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]) then
    raise insufficient_privilege using message = 'Catalogue editor required.';
  end if;
  select coalesce(max(substring(btrim(p.reference) from '(?i)^ART-([0-9]{6,12})$')::bigint), 0) + 1
    into next_number from public.products p where p.tenant_id = target_tenant_id;
  number_text := next_number::text;
  return 'ART-' || lpad(number_text, greatest(6, length(number_text)), '0');
end;
$$;

revoke all on function public.suggest_product_reference() from public, anon;
grant execute on function public.suggest_product_reference() to authenticated;

commit;
