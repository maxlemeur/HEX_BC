-- Supabase schema for "Bons de commande fournisseur - Hydro Express"
-- Run this in Supabase SQL Editor (or via migrations).

create extension if not exists "pgcrypto";

-- Reset existing tables/types from previous iterations.
drop table if exists public.purchase_order_devis cascade;
drop table if exists public.purchase_order_items cascade;
drop table if exists public.purchase_orders cascade;
drop table if exists public.products cascade;
drop table if exists public.delivery_sites cascade;
drop table if exists public.suppliers cascade;
drop table if exists public.profiles cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.customers cascade;
drop table if exists public.estimate_items cascade;
drop table if exists public.estimate_versions cascade;
drop table if exists public.estimate_projects cascade;
drop table if exists public.estimate_categories cascade;
drop table if exists public.labor_roles cascade;
drop table if exists public.estimate_suggestion_rules cascade;

drop type if exists purchase_order_status;
drop type if exists employee_role;
drop type if exists order_status;
drop type if exists estimate_status;
drop type if exists estimate_item_type;
drop type if exists estimate_rounding_mode;
drop type if exists estimate_rule_match_type;

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

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_status') then
    create type estimate_status as enum ('draft', 'sent', 'accepted', 'archived');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_item_type') then
    create type estimate_item_type as enum ('section', 'line');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_rounding_mode') then
    create type estimate_rounding_mode as enum ('none', 'nearest', 'up', 'down');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'estimate_rule_match_type') then
    create type estimate_rule_match_type as enum ('keyword');
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
  insert into public.profiles (id, full_name, phone, job_title, work_email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
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
  job_title text,
  work_email text,
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

create table public.purchase_order_devis (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  original_filename text not null,
  storage_path text not null unique,
  file_size_bytes integer not null,
  mime_type text not null,
  position integer not null default 0
);

create trigger set_purchase_order_devis_updated_at
  before update on public.purchase_order_devis
  for each row execute procedure public.set_updated_at();

create index purchase_order_devis_purchase_order_id_idx on public.purchase_order_devis (purchase_order_id);
create unique index purchase_order_devis_position_unique on public.purchase_order_devis (purchase_order_id, position);

create table public.estimate_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  reference text,
  client_name text,
  notes text,
  is_archived boolean not null default false
);

create trigger set_estimate_projects_updated_at
  before update on public.estimate_projects
  for each row execute procedure public.set_updated_at();

create index estimate_projects_user_id_idx on public.estimate_projects (user_id);
create index estimate_projects_updated_at_idx on public.estimate_projects (updated_at);

create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_number integer not null,
  status estimate_status not null default 'draft',
  title text,
  date_devis date not null default current_date,
  validite_jours integer not null default 30 check (validite_jours > 0),
  margin_multiplier numeric not null default 1.0 check (margin_multiplier >= 0),
  currency text not null default 'EUR',
  margin_bp integer not null default 0 check (margin_bp >= 0),
  discount_bp integer not null default 0 check (discount_bp >= 0),
  tax_rate_bp integer not null default 2000 check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  rounding_mode estimate_rounding_mode not null default 'none',
  rounding_step_cents integer not null default 1 check (rounding_step_cents >= 1),
  total_ht_cents integer not null default 0 check (total_ht_cents >= 0),
  total_tax_cents integer not null default 0 check (total_tax_cents >= 0),
  total_ttc_cents integer not null default 0 check (total_ttc_cents >= 0),
  unique (project_id, version_number)
);

create trigger set_estimate_versions_updated_at
  before update on public.estimate_versions
  for each row execute procedure public.set_updated_at();

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status then
      raise exception 'Estimate version is read-only';
    end if;

    if new.created_at is distinct from old.created_at
      or new.project_id is distinct from old.project_id
      or new.version_number is distinct from old.version_number
      or new.title is distinct from old.title
      or new.date_devis is distinct from old.date_devis
      or new.validite_jours is distinct from old.validite_jours
      or new.margin_multiplier is distinct from old.margin_multiplier
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create trigger guard_estimate_versions_readonly
  before update on public.estimate_versions
  for each row execute procedure public.guard_estimate_versions_readonly();

create index estimate_versions_project_id_idx on public.estimate_versions (project_id);
create index estimate_versions_status_idx on public.estimate_versions (status);
create index estimate_versions_updated_at_idx on public.estimate_versions (updated_at);

create table public.estimate_categories (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  color text,
  position integer not null default 0,
  unique (user_id, name)
);

create trigger set_estimate_categories_updated_at
  before update on public.estimate_categories
  for each row execute procedure public.set_updated_at();

create index estimate_categories_user_id_idx on public.estimate_categories (user_id);

create table public.labor_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  is_active boolean not null default true,
  position integer not null default 0,
  unique (user_id, name)
);

create trigger set_labor_roles_updated_at
  before update on public.labor_roles
  for each row execute procedure public.set_updated_at();

create index labor_roles_user_id_idx on public.labor_roles (user_id);

create table public.estimate_suggestion_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  match_type estimate_rule_match_type not null default 'keyword',
  match_value text not null,
  unit text,
  category_id uuid references public.estimate_categories(id) on delete set null,
  k_fo numeric(12,3),
  k_mo numeric(12,3),
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  position integer not null default 0,
  is_active boolean not null default true,
  check (k_fo is null or k_fo >= 0),
  check (k_mo is null or k_mo >= 0)
);

create trigger set_estimate_suggestion_rules_updated_at
  before update on public.estimate_suggestion_rules
  for each row execute procedure public.set_updated_at();

create index estimate_suggestion_rules_user_id_idx
  on public.estimate_suggestion_rules (user_id);
create index estimate_suggestion_rules_position_idx
  on public.estimate_suggestion_rules (position);
create index estimate_suggestion_rules_active_idx
  on public.estimate_suggestion_rules (is_active);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  parent_id uuid references public.estimate_items(id) on delete cascade deferrable initially deferred,
  item_type estimate_item_type not null,
  position integer not null default 0,
  title text not null,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
    tax_rate_bp integer,
    k_fo numeric(12,3),
    h_mo numeric(12,3),
    k_mo numeric(12,3),
    pu_ht_cents integer,
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  category_id uuid references public.estimate_categories(id) on delete set null,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer,
    check (quantity is null or quantity >= 0),
    check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
    check (tax_rate_bp is null or (tax_rate_bp >= 0 and tax_rate_bp <= 10000)),
    check (k_fo is null or k_fo >= 0),
    check (h_mo is null or h_mo >= 0),
    check (k_mo is null or k_mo >= 0),
    check (pu_ht_cents is null or pu_ht_cents >= 0),
    check (line_total_ht_cents is null or line_total_ht_cents >= 0),
    check (line_tax_cents is null or line_tax_cents >= 0),
    check (line_total_ttc_cents is null or line_total_ttc_cents >= 0),
    check (
      (item_type = 'section'
        and quantity is null
        and unit_price_ht_cents is null
        and tax_rate_bp is null
        and k_fo is null
        and h_mo is null
        and k_mo is null
        and pu_ht_cents is null
        and labor_role_id is null
        and category_id is null
        and line_total_ht_cents is null
        and line_tax_cents is null
        and line_total_ttc_cents is null
    )
    or
      (item_type = 'line'
        and quantity is not null
        and unit_price_ht_cents is not null
        and tax_rate_bp is not null
        and k_fo is not null
        and h_mo is not null
        and k_mo is not null
        and pu_ht_cents is not null
        and line_total_ht_cents is not null
        and line_tax_cents is not null
        and line_total_ttc_cents is not null
      )
    )
  );

create trigger set_estimate_items_updated_at
  before update on public.estimate_items
  for each row execute procedure public.set_updated_at();

create index estimate_items_version_id_idx on public.estimate_items (version_id);
create index estimate_items_parent_id_idx on public.estimate_items (parent_id);
create index estimate_items_category_id_idx on public.estimate_items (category_id);
create index estimate_items_labor_role_id_idx on public.estimate_items (labor_role_id);
create unique index estimate_items_root_position_unique
  on public.estimate_items (version_id, position)
  where parent_id is null;
create unique index estimate_items_child_position_unique
  on public.estimate_items (parent_id, position)
  where parent_id is not null;

create or replace function public.duplicate_estimate_version(source_version_id uuid)
returns uuid
language plpgsql
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = source_version_id
    and p.user_id = (select auth.uid());

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  insert into public.estimate_versions (
    id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    new_version_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents
  );

  create temporary table _estimate_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = source_version_id;

    insert into public.estimate_items (
      id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      k_mo,
      pu_ht_cents,
      labor_role_id,
      category_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
  )
  select
    map.new_id,
    new_version_id,
    parent_map.new_id,
    src.item_type,
    src.position,
    src.title,
      src.description,
      src.quantity,
      src.unit_price_ht_cents,
      src.tax_rate_bp,
      src.k_fo,
      src.h_mo,
      src.k_mo,
      src.pu_ht_cents,
      src.labor_role_id,
      src.category_id,
      src.line_total_ht_cents,
      src.line_tax_cents,
      src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  return new_version_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.suppliers enable row level security;
alter table public.delivery_sites enable row level security;
alter table public.products enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_order_devis enable row level security;
alter table public.estimate_projects enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.estimate_items enable row level security;
alter table public.estimate_categories enable row level security;
alter table public.labor_roles enable row level security;
alter table public.estimate_suggestion_rules enable row level security;

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

create policy "Authenticated can access devis"
  on public.purchase_order_devis
  for all
  to authenticated
  using (true)
  with check (true);

create policy "Users can manage estimate projects"
  on public.estimate_projects
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage estimate versions"
  on public.estimate_versions
  for all
  to authenticated
  using (
    project_id in (
      select id from public.estimate_projects
      where user_id = (select auth.uid())
    )
  )
  with check (
    project_id in (
      select id from public.estimate_projects
      where user_id = (select auth.uid())
    )
  );

create policy "Users can view estimate items"
  on public.estimate_items
  for select
  to authenticated
  using (
    version_id in (
      select v.id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where p.user_id = (select auth.uid())
    )
  );

create policy "Users can insert draft estimate items"
  on public.estimate_items
  for insert
  to authenticated
  with check (
    version_id in (
      select v.id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  );

create policy "Users can update draft estimate items"
  on public.estimate_items
  for update
  to authenticated
  using (
    version_id in (
      select v.id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  )
  with check (
    version_id in (
      select v.id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  );

create policy "Users can delete draft estimate items"
  on public.estimate_items
  for delete
  to authenticated
  using (
    version_id in (
      select v.id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where p.user_id = (select auth.uid())
        and v.status = 'draft'
    )
  );

create policy "Users can manage estimate categories"
  on public.estimate_categories
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage labor roles"
  on public.labor_roles
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage estimate suggestion rules"
  on public.estimate_suggestion_rules
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
