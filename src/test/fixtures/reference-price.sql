-- Isolated PostgreSQL fixture. Never run against a shared Supabase database.
create role anon;
create role authenticated;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
create type public.tenant_role as enum ('admin', 'engineer', 'viewer');
create table public.tenants(id uuid primary key, is_active boolean not null default true);
create table public.tenant_memberships(tenant_id uuid, user_id uuid, role public.tenant_role, is_default boolean default true, created_at timestamptz default now());
create function public.current_tenant_id() returns uuid language sql stable security definer set search_path = '' as $$
  select tm.tenant_id from public.tenant_memberships tm join public.tenants t on t.id = tm.tenant_id
  where tm.user_id = auth.uid() and t.is_active order by tm.is_default desc, tm.created_at limit 1;
$$;
create function public.is_tenant_member(target_tenant_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tenant_memberships tm join public.tenants t on t.id = tm.tenant_id
    where tm.user_id = auth.uid() and tm.tenant_id = target_tenant_id and t.is_active);
$$;
create function public.has_tenant_role(target_tenant_id uuid, allowed_roles public.tenant_role[]) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.tenant_memberships tm join public.tenants t on t.id = tm.tenant_id
    where tm.user_id = auth.uid() and tm.tenant_id = target_tenant_id and tm.role = any(allowed_roles) and t.is_active);
$$;
create function public.catalogue_normalize_search(value text) returns text language sql immutable as $$ select lower(value); $$;
create table public.products(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  reference text, designation text not null default 'Article', unit text not null default 'm',
  unit_price_cents integer not null default 0, is_active boolean not null default true,
  category text, product_type text, material text, grade text, dimensions text, standard text
);
create table public.suppliers(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text, is_active boolean not null default true);
create table public.supplier_catalog_items(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, product_id uuid not null, supplier_id uuid not null, supplier_sku text, is_active boolean not null default true);
create table public.supplier_pricebook(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null, product_id uuid not null, supplier_id uuid not null,
  supplier_catalog_item_id uuid, supplier_sku text, unit text not null default 'm', currency text not null default 'EUR',
  min_quantity numeric(12,3) not null default 1, unit_price_cents integer not null check(unit_price_cents >= 0),
  valid_from date not null default current_date, valid_to date, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source_import_id uuid, source_mapped_row_id uuid, notes text
);
create table public.purchase_orders(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, supplier_id uuid, reference text, status text, order_date date, updated_at timestamptz not null default now());
create table public.purchase_order_items(id uuid primary key default gen_random_uuid(), tenant_id uuid, purchase_order_id uuid references public.purchase_orders, product_id uuid, unit_price_ht_cents integer, position integer, updated_at timestamptz default now());
create table public.estimate_items(id uuid primary key default gen_random_uuid(), product_id uuid, unit_price_ht_cents integer);
create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end; $$;
create trigger set_supplier_pricebook_updated_at before update on public.supplier_pricebook for each row execute function public.set_updated_at();
create trigger set_products_updated_at before update on public.products for each row execute function public.set_updated_at();
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter table public.products enable row level security;
alter table public.supplier_pricebook enable row level security;
alter table public.supplier_catalog_items enable row level security;
alter table public.suppliers enable row level security;
create policy products_read on public.products for select to authenticated using (public.is_tenant_member(tenant_id));
create policy products_write on public.products for update to authenticated using (public.has_tenant_role(tenant_id,array['admin'::public.tenant_role])) with check(public.has_tenant_role(tenant_id,array['admin'::public.tenant_role]));
create policy prices_read on public.supplier_pricebook for select to authenticated using (public.is_tenant_member(tenant_id));
create policy prices_update on public.supplier_pricebook for update to authenticated using (public.has_tenant_role(tenant_id,array['admin'::public.tenant_role, 'engineer'::public.tenant_role])) with check(public.has_tenant_role(tenant_id,array['admin'::public.tenant_role, 'engineer'::public.tenant_role]));
create policy catalog_read on public.supplier_catalog_items for select to authenticated using (public.is_tenant_member(tenant_id));
create policy suppliers_read on public.suppliers for select to authenticated using (public.is_tenant_member(tenant_id));
