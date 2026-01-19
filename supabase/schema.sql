-- Supabase schema for "Bons de commande fournisseur - Hydro Express"
-- Run this in Supabase SQL Editor (or via migrations).

create extension if not exists "pgcrypto";

-- Reset existing tables/types from previous iterations.
drop table if exists public.purchase_order_items cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.products cascade;
drop table if exists public.delivery_sites cascade;
drop table if exists public.suppliers cascade;
drop table if exists public.profiles cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.customers cascade;

drop type if exists purchase_order_status;
drop type if exists employee_role;
drop type if exists order_status;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'purchase_order_status') then
    create type purchase_order_status as enum ('draft', 'sent', 'confirmed', 'received', 'canceled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'employee_role') then
    create type employee_role as enum ('buyer', 'site_manager', 'admin');
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, phone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    'buyer'
  );
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text not null,
  phone text,
  role employee_role not null default 'buyer'
);

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  address text,
  city text,
  postal_code text,
  country text default 'France',
  email text,
  phone text,
  contact_name text,
  siret text,
  vat_number text,
  payment_terms text,
  is_active boolean not null default true
);

create trigger set_suppliers_updated_at
  before update on public.suppliers
  for each row execute procedure public.set_updated_at();

create index suppliers_name_idx on public.suppliers (name);

create table public.delivery_sites (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  project_code text unique,
  address text,
  city text,
  postal_code text,
  contact_name text,
  contact_phone text,
  is_active boolean not null default true
);

create trigger set_delivery_sites_updated_at
  before update on public.delivery_sites
  for each row execute procedure public.set_updated_at();

create index delivery_sites_name_idx on public.delivery_sites (name);
create index delivery_sites_project_code_idx on public.delivery_sites (project_code);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reference text unique,
  designation text not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  tax_rate_bp integer not null default 2000 check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  is_active boolean not null default true
);

create trigger set_products_updated_at
  before update on public.products
  for each row execute procedure public.set_updated_at();

create index products_reference_idx on public.products (reference);

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  order_number bigint generated always as identity unique,
  reference text not null unique,

  user_id uuid not null references public.profiles(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  delivery_site_id uuid not null references public.delivery_sites(id) on delete restrict,

  status purchase_order_status not null default 'draft',
  order_date date not null default current_date,
  expected_delivery_date date,
  notes text,

  total_ht_cents integer not null default 0 check (total_ht_cents >= 0),
  total_tax_cents integer not null default 0 check (total_tax_cents >= 0),
  total_ttc_cents integer not null default 0 check (total_ttc_cents >= 0),

  currency text not null default 'EUR'
);

create trigger set_purchase_orders_updated_at
  before update on public.purchase_orders
  for each row execute procedure public.set_updated_at();

create index purchase_orders_user_id_idx on public.purchase_orders (user_id);
create index purchase_orders_supplier_id_idx on public.purchase_orders (supplier_id);
create index purchase_orders_delivery_site_id_idx on public.purchase_orders (delivery_site_id);
create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_order_date_idx on public.purchase_orders (order_date);

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  position integer not null default 0,

  product_id uuid references public.products(id) on delete set null,

  reference text,
  designation text not null,
  unit_price_ht_cents integer not null check (unit_price_ht_cents >= 0),
  tax_rate_bp integer not null check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),

  quantity integer not null check (quantity > 0),

  line_total_ht_cents integer not null default 0 check (line_total_ht_cents >= 0),
  line_tax_cents integer not null default 0 check (line_tax_cents >= 0),
  line_total_ttc_cents integer not null default 0 check (line_total_ttc_cents >= 0)
);

create trigger set_purchase_order_items_updated_at
  before update on public.purchase_order_items
  for each row execute procedure public.set_updated_at();

create index purchase_order_items_purchase_order_id_idx on public.purchase_order_items (purchase_order_id);
create index purchase_order_items_product_id_idx on public.purchase_order_items (product_id);
create unique index purchase_order_items_position_unique on public.purchase_order_items (purchase_order_id, position);

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.delivery_sites enable row level security;
alter table public.products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Authenticated can access suppliers"
  on public.suppliers
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated can access delivery sites"
  on public.delivery_sites
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated can access products"
  on public.products
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated can access purchase orders"
  on public.purchase_orders
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Authenticated can access purchase order items"
  on public.purchase_order_items
  for all
  to authenticated
  using (true)
  with check (true);
