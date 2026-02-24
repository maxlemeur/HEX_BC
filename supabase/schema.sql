-- Supabase schema for "Bons de commande fournisseur - Hydro Express"
-- Run this in Supabase SQL Editor (or via migrations).

create extension if not exists "pgcrypto";

-- Reset existing tables/types from previous iterations.
drop table if exists public.dpgf_catalogue_links cascade;
drop table if exists public.material_indices cascade;
drop table if exists public.supplier_pricebook cascade;
drop table if exists public.margin_tiers cascade;
drop table if exists public.feature_flags cascade;
drop table if exists public.tenant_memberships cascade;
drop table if exists public.tenants cascade;
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
drop table if exists public.supply_types cascade;
drop table if exists public.estimate_assembly_items cascade;
drop table if exists public.estimate_assemblies cascade;
drop table if exists public.estimate_items cascade;
drop table if exists public.audit_logs cascade;
drop table if exists public.dpgf_mappings cascade;
drop table if exists public.mapping_memory cascade;
drop table if exists public.mapping_templates cascade;
drop table if exists public.dpgf_rows_mapped cascade;
drop table if exists public.dpgf_rows_raw cascade;
drop table if exists public.dpgf_imports cascade;
drop table if exists public.suggestion_learning_reviews cascade;
drop table if exists public.suggestion_corrections cascade;
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
drop type if exists estimate_margin_mode;
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

create or replace function public.guard_profile_role_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role is distinct from old.role and (select auth.uid()) is not null then
    raise exception
      using
        errcode = '42501',
        message = 'PROFILE_ROLE_IMMUTABLE',
        detail = 'Only server-side workflows can change profiles.role.';
  end if;

  return new;
end;
$$;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

drop trigger if exists guard_profile_role_update on public.profiles;
create trigger guard_profile_role_update
  before update on public.profiles
  for each row execute procedure public.guard_profile_role_update();

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
create index purchase_order_devis_user_id_idx on public.purchase_order_devis (user_id);
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
  margin_multiplier numeric not null default 1.0 check (margin_multiplier >= 0 and margin_multiplier <= 100),
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
create index estimate_suggestion_rules_category_id_idx
  on public.estimate_suggestion_rules (category_id);
create index estimate_suggestion_rules_labor_role_id_idx
  on public.estimate_suggestion_rules (labor_role_id);
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

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references public.profiles(id) on delete set null,
  table_name text not null,
  record_id uuid not null,
  estimate_version_id uuid references public.estimate_versions(id) on delete set null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  before_data jsonb,
  after_data jsonb
);

create index audit_logs_created_at_idx on public.audit_logs (created_at desc);
create index audit_logs_table_name_idx on public.audit_logs (table_name);
create index audit_logs_estimate_version_id_idx on public.audit_logs (estimate_version_id);
create index audit_logs_user_id_idx on public.audit_logs (user_id);

create table public.dpgf_imports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  filename text not null,
  source_format text not null check (source_format in ('json', 'csv', 'xlsx')),
  status text not null default 'pending' check (status in ('pending', 'parsing', 'completed', 'failed')),
  row_count integer not null default 0 check (row_count >= 0),
  error_message text,
  parse_mode text not null check (parse_mode in ('worker', 'server')),
  storage_path text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0)
);

create trigger set_dpgf_imports_updated_at
  before update on public.dpgf_imports
  for each row execute procedure public.set_updated_at();

create index dpgf_imports_user_created_at_idx on public.dpgf_imports (user_id, created_at desc);
create index dpgf_imports_status_idx on public.dpgf_imports (status);

create table public.dpgf_rows_raw (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  row_index integer not null check (row_index >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (import_id, row_index)
);

create index dpgf_rows_raw_import_id_idx on public.dpgf_rows_raw (import_id);
create index dpgf_rows_raw_import_id_row_index_idx on public.dpgf_rows_raw (import_id, row_index);

create table public.dpgf_rows_mapped (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  raw_row_id uuid references public.dpgf_rows_raw(id) on delete cascade,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'mapped', 'rejected')),
  created_at timestamptz not null default now()
);

create index dpgf_rows_mapped_import_id_idx on public.dpgf_rows_mapped (import_id);
create index dpgf_rows_mapped_raw_row_id_idx on public.dpgf_rows_mapped (raw_row_id);
create index dpgf_rows_mapped_status_idx on public.dpgf_rows_mapped (status);

create table public.mapping_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  supplier_name text,
  mapping jsonb not null,
  is_default boolean not null default false,
  last_used_at timestamptz,
  unique (user_id, name)
);

create trigger set_mapping_templates_updated_at
  before update on public.mapping_templates
  for each row execute procedure public.set_updated_at();

create index mapping_templates_user_updated_at_idx on public.mapping_templates (user_id, updated_at desc);
create index mapping_templates_supplier_name_idx on public.mapping_templates (supplier_name);

create table public.mapping_memory (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source_column text not null,
  target_field text not null,
  usage_count integer not null default 1 check (usage_count >= 1),
  confidence numeric(5,4) not null default 1.0000 check (confidence >= 0 and confidence <= 1),
  last_used_at timestamptz not null default now(),
  unique (user_id, source_column, target_field)
);

create trigger set_mapping_memory_updated_at
  before update on public.mapping_memory
  for each row execute procedure public.set_updated_at();

create index mapping_memory_user_source_idx on public.mapping_memory (user_id, source_column);
create index mapping_memory_user_target_idx on public.mapping_memory (user_id, target_field);

create table public.dpgf_mappings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  template_id uuid references public.mapping_templates(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'validated', 'applied', 'archived')),
  column_mapping jsonb not null,
  required_fields_present boolean not null default false,
  missing_required_fields text[] not null default '{}',
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  notes text
);

create trigger set_dpgf_mappings_updated_at
  before update on public.dpgf_mappings
  for each row execute procedure public.set_updated_at();

create index dpgf_mappings_import_id_created_at_idx on public.dpgf_mappings (import_id, created_at desc);
create index dpgf_mappings_status_idx on public.dpgf_mappings (status);
create index dpgf_mappings_template_id_idx on public.dpgf_mappings (template_id);

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
begin
  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    end if;
  end if;

  insert into public.audit_logs (
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    tg_op,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger estimate_projects_audit_trigger
  after insert or update or delete on public.estimate_projects
  for each row execute procedure public.log_estimate_audit();

create trigger estimate_versions_audit_trigger
  after insert or update or delete on public.estimate_versions
  for each row execute procedure public.log_estimate_audit();

create trigger estimate_items_audit_trigger
  after insert or update or delete on public.estimate_items
  for each row execute procedure public.log_estimate_audit();

create trigger estimate_categories_audit_trigger
  after insert or update or delete on public.estimate_categories
  for each row execute procedure public.log_estimate_audit();

create trigger labor_roles_audit_trigger
  after insert or update or delete on public.labor_roles
  for each row execute procedure public.log_estimate_audit();

create trigger estimate_suggestion_rules_audit_trigger
  after insert or update or delete on public.estimate_suggestion_rules
  for each row execute procedure public.log_estimate_audit();

create or replace function public.reorder_estimate_items(
  target_version_id uuid,
  target_parent_id uuid,
  ordered_item_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_item_ids, 1), 0) = 0 then
    return 0;
  end if;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  )
  update public.estimate_items item
  set position = -ordered.position
  from ordered
  where item.id = ordered.id
    and item.version_id = target_version_id
    and (
      (target_parent_id is null and item.parent_id is null)
      or item.parent_id = target_parent_id
    );

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_item_ids) with ordinality as src(id, ordinality)
  )
  update public.estimate_items item
  set position = ordered.position
  from ordered
  where item.id = ordered.id
    and item.version_id = target_version_id
    and (
      (target_parent_id is null and item.parent_id is null)
      or item.parent_id = target_parent_id
    );

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

-- EST-182: reusable estimate assemblies and atomic insertion into estimate versions.

create table if not exists public.estimate_assemblies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  name text not null,
  description text,
  unique (tenant_id, name)
);

create table if not exists public.estimate_assembly_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  assembly_id uuid not null references public.estimate_assemblies(id) on delete cascade,
  title text not null,
  unit text,
  k_fo numeric(12,3) not null default 1 check (k_fo >= 0),
  k_mo numeric(12,3) not null default 1 check (k_mo >= 0),
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  default_quantity numeric(12,3) check (default_quantity is null or default_quantity >= 0),
  position integer not null default 1
);

create index if not exists estimate_assemblies_tenant_id_idx
  on public.estimate_assemblies (tenant_id);
create index if not exists estimate_assemblies_tenant_created_at_idx
  on public.estimate_assemblies (tenant_id, created_at desc);
create index if not exists estimate_assembly_items_tenant_id_idx
  on public.estimate_assembly_items (tenant_id);
create index if not exists estimate_assembly_items_assembly_id_idx
  on public.estimate_assembly_items (assembly_id);
create index if not exists estimate_assembly_items_labor_role_id_idx
  on public.estimate_assembly_items (labor_role_id);
create unique index if not exists estimate_assembly_items_assembly_position_key
  on public.estimate_assembly_items (assembly_id, position);

drop trigger if exists set_estimate_assemblies_updated_at on public.estimate_assemblies;
create trigger set_estimate_assemblies_updated_at
  before update on public.estimate_assemblies
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_assembly_items_updated_at on public.estimate_assembly_items;
create trigger set_estimate_assembly_items_updated_at
  before update on public.estimate_assembly_items
  for each row execute procedure public.set_updated_at();

create or replace function public.assign_estimate_assembly_items_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  select a.tenant_id
    into parent_tenant_id
  from public.estimate_assemblies a
  where a.id = new.assembly_id;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_assemblies_tenant_id on public.estimate_assemblies;
create trigger set_estimate_assemblies_tenant_id
  before insert or update on public.estimate_assemblies
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_assembly_items_tenant_id on public.estimate_assembly_items;
create trigger set_estimate_assembly_items_tenant_id
  before insert or update on public.estimate_assembly_items
  for each row execute procedure public.assign_estimate_assembly_items_tenant_id();

alter table public.estimate_assemblies enable row level security;
alter table public.estimate_assembly_items enable row level security;

drop policy if exists "Users can manage estimate assemblies" on public.estimate_assemblies;
create policy "Users can manage estimate assemblies"
  on public.estimate_assemblies
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
  )
  with check (
    (select public.is_tenant_member(tenant_id))
  );

drop policy if exists "Users can manage estimate assembly items" on public.estimate_assembly_items;
create policy "Users can manage estimate assembly items"
  on public.estimate_assembly_items
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_assemblies a
      where a.id = estimate_assembly_items.assembly_id
        and a.tenant_id = estimate_assembly_items.tenant_id
        and (select public.is_tenant_member(a.tenant_id))
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_assemblies a
      where a.id = estimate_assembly_items.assembly_id
        and a.tenant_id = estimate_assembly_items.tenant_id
        and (select public.is_tenant_member(a.tenant_id))
    )
  );

create or replace function public.replace_estimate_assembly_items(
  p_assembly_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  target_assembly public.estimate_assemblies%rowtype;
  normalized_items jsonb := coalesce(p_items, '[]'::jsonb);
  inserted_count integer := 0;
begin
  if jsonb_typeof(normalized_items) <> 'array' then
    raise exception 'p_items must be a JSON array';
  end if;

  if jsonb_array_length(normalized_items) = 0 then
    raise exception 'Estimate assembly must contain at least one item';
  end if;

  select a.*
    into target_assembly
  from public.estimate_assemblies a
  where a.id = p_assembly_id
    and (select public.is_tenant_member(a.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  delete from public.estimate_assembly_items
  where assembly_id = target_assembly.id
    and tenant_id = target_assembly.tenant_id;

  insert into public.estimate_assembly_items (
    tenant_id,
    assembly_id,
    title,
    unit,
    k_fo,
    k_mo,
    labor_role_id,
    default_quantity,
    position
  )
  select
    target_assembly.tenant_id,
    target_assembly.id,
    item.title,
    nullif(btrim(coalesce(item.unit, '')), ''),
    coalesce(item.k_fo, 1),
    coalesce(item.k_mo, 1),
    item.labor_role_id,
    item.default_quantity,
    item.position
  from jsonb_to_recordset(normalized_items) as item(
    title text,
    unit text,
    k_fo numeric,
    k_mo numeric,
    labor_role_id uuid,
    default_quantity numeric,
    position integer
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.insert_estimate_assembly_into_version(
  p_version_id uuid,
  p_assembly_id uuid,
  p_after_item_id uuid default null
)
returns setof public.estimate_items
language plpgsql
set search_path = public
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_version public.estimate_versions%rowtype;
  source_assembly public.estimate_assemblies%rowtype;
  anchor_item record;
  target_parent_id uuid;
  target_position integer;
  inserted_section public.estimate_items%rowtype;
  inserted_line public.estimate_items%rowtype;
  assembly_item public.estimate_assembly_items%rowtype;
  line_position integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select v.*
    into target_version
  from public.estimate_versions v
  where v.id = p_version_id
    and (select public.is_tenant_member(v.tenant_id));

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Estimate version is read only';
  end if;

  select a.*
    into source_assembly
  from public.estimate_assemblies a
  where a.id = p_assembly_id
    and (select public.is_tenant_member(a.tenant_id));

  if not found then
    raise exception 'Estimate assembly not found or access denied';
  end if;

  if source_assembly.tenant_id <> target_version.tenant_id then
    raise exception 'Estimate assembly and version tenant mismatch';
  end if;

  if not exists (
    select 1
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
  ) then
    raise exception 'Estimate assembly has no items';
  end if;

  if p_after_item_id is not null then
    select id, parent_id, position
      into anchor_item
    from public.estimate_items
    where id = p_after_item_id
      and version_id = target_version.id
      and tenant_id = target_version.tenant_id;

    if not found then
      raise exception 'after_item_id invalide';
    end if;

    target_parent_id := anchor_item.parent_id;
    target_position := anchor_item.position + 1;
  else
    target_parent_id := null;
    select coalesce(max(i.position), 0) + 1
      into target_position
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null;
  end if;

  if target_parent_id is null then
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id is null
    for update;

    update public.estimate_items
    set position = position + 1
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id is null
      and position >= target_position;
  else
    perform 1
    from public.estimate_items i
    where i.version_id = target_version.id
      and i.tenant_id = target_version.tenant_id
      and i.parent_id = target_parent_id
    for update;

    update public.estimate_items
    set position = position + 1
    where version_id = target_version.id
      and tenant_id = target_version.tenant_id
      and parent_id = target_parent_id
      and position >= target_position;
  end if;

  insert into public.estimate_items (
    tenant_id,
    version_id,
    parent_id,
    item_type,
    position,
    title
  )
  values (
    target_version.tenant_id,
    target_version.id,
    target_parent_id,
    'section',
    target_position,
    source_assembly.name
  )
  returning *
  into inserted_section;

  return next inserted_section;

  for assembly_item in
    select ai.*
    from public.estimate_assembly_items ai
    where ai.assembly_id = source_assembly.id
      and ai.tenant_id = source_assembly.tenant_id
    order by ai.position asc, ai.created_at asc
  loop
    line_position := greatest(assembly_item.position, 1);

    insert into public.estimate_items (
      tenant_id,
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
      h_mo_majoration,
      k_mo,
      h_mo_atelier,
      k_mo_atelier,
      labor_role_atelier_id,
      h_mo_chantier,
      k_mo_chantier,
      labor_role_chantier_id,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    values (
      target_version.tenant_id,
      target_version.id,
      inserted_section.id,
      'line',
      line_position,
      assembly_item.title,
      nullif(btrim(coalesce(assembly_item.unit, '')), ''),
      coalesce(assembly_item.default_quantity, 1),
      0,
      coalesce(target_version.tax_rate_bp, 2000),
      coalesce(assembly_item.k_fo, 1),
      0,
      1,
      coalesce(assembly_item.k_mo, 1),
      null,
      null,
      null,
      null,
      null,
      null,
      0,
      assembly_item.labor_role_id,
      null,
      null,
      null,
      0,
      0,
      0
    )
    returning *
    into inserted_line;

    return next inserted_line;
  end loop;

  update public.estimate_versions
  set updated_at = now()
  where id = target_version.id
    and tenant_id = target_version.tenant_id;

  return;
end;
$$;

create or replace function public.reorder_purchase_order_devis(
  target_purchase_order_id uuid,
  ordered_devis_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
begin
  if coalesce(array_length(ordered_devis_ids, 1), 0) = 0 then
    return 0;
  end if;

  if not exists (
    select 1
    from public.purchase_orders po
    where po.id = target_purchase_order_id
      and po.tenant_id is not null
      and (
        exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
        )
        or (select public.is_admin_user())
      )
      and (
        po.user_id = (select auth.uid())
        or exists (
          select 1
          from public.tenant_memberships tm
          where tm.tenant_id = po.tenant_id
            and tm.user_id = (select auth.uid())
            and tm.role::text = 'admin'
        )
        or (select public.is_admin_user())
      )
  ) then
    return 0;
  end if;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = -ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id;

  with ordered as (
    select
      src.id,
      src.ordinality::integer as position
    from unnest(ordered_devis_ids) with ordinality as src(id, ordinality)
  )
  update public.purchase_order_devis devis
  set position = ordered.position
  from ordered
  where devis.id = ordered.id
    and devis.purchase_order_id = target_purchase_order_id;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

drop function if exists public.snapshot_estimate_item_bulk_updates(uuid, jsonb);

create or replace function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  k_mo numeric(12,3),
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  if expected_count = 0 then
    return 0;
  end if;

  create temporary table _estimate_item_bulk_snapshot (
    id uuid primary key,
    parent_id uuid,
    item_position integer,
    title text,
    description text,
    quantity numeric(12,3),
    unit_price_ht_cents integer,
    tax_rate_bp integer,
    k_fo numeric(12,3),
    h_mo numeric(12,3),
    k_mo numeric(12,3),
    pu_ht_cents integer,
    labor_role_id uuid,
    category_id uuid,
    line_total_ht_cents integer,
    line_tax_cents integer,
    line_total_ttc_cents integer
  ) on commit drop;

  insert into _estimate_item_bulk_snapshot (
    id,
    parent_id,
    item_position,
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
    snapshot.id,
    snapshot.parent_id,
    snapshot.item_position,
    snapshot.title,
    snapshot.description,
    snapshot.quantity,
    snapshot.unit_price_ht_cents,
    snapshot.tax_rate_bp,
    snapshot.k_fo,
    snapshot.h_mo,
    snapshot.k_mo,
    snapshot.pu_ht_cents,
    snapshot.labor_role_id,
    snapshot.category_id,
    snapshot.line_total_ht_cents,
    snapshot.line_tax_cents,
    snapshot.line_total_ttc_cents
  from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

  select count(*)
    into snapshot_count
  from _estimate_item_bulk_snapshot;

  if snapshot_count <> expected_count then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,updated_count=%s',
          expected_count,
          snapshot_count
        );
  end if;

  perform item.id
  from public.estimate_items item
  join _estimate_item_bulk_snapshot snapshot
    on item.id = snapshot.id
    and item.version_id = target_version_id
  for update;

  get diagnostics locked_count = row_count;

  if locked_count <> expected_count then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          expected_count,
          locked_count
        );
  end if;

  update public.estimate_items item
  set position = -snapshot.item_position
  from _estimate_item_bulk_snapshot snapshot
  where item.id = snapshot.id
    and item.version_id = target_version_id;

  update public.estimate_items item
  set
    parent_id = snapshot.parent_id,
    position = snapshot.item_position,
    title = snapshot.title,
    description = snapshot.description,
    quantity = snapshot.quantity,
    unit_price_ht_cents = snapshot.unit_price_ht_cents,
    tax_rate_bp = snapshot.tax_rate_bp,
    k_fo = snapshot.k_fo,
    h_mo = snapshot.h_mo,
    k_mo = snapshot.k_mo,
    pu_ht_cents = snapshot.pu_ht_cents,
    labor_role_id = snapshot.labor_role_id,
    category_id = snapshot.category_id,
    line_total_ht_cents = snapshot.line_total_ht_cents,
    line_tax_cents = snapshot.line_tax_cents,
    line_total_ttc_cents = snapshot.line_total_ttc_cents
  from _estimate_item_bulk_snapshot snapshot
  where item.id = snapshot.id
    and item.version_id = target_version_id;

  get diagnostics updated_count = row_count;

  if updated_count <> expected_count then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,updated_count=%s',
          expected_count,
          updated_count
        );
  end if;

  return updated_count;
end;
$$;

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

create or replace function public.is_admin_user()
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    or coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin') = 'true', false);
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
alter table public.audit_logs enable row level security;
alter table public.dpgf_imports enable row level security;
alter table public.dpgf_rows_raw enable row level security;
alter table public.dpgf_rows_mapped enable row level security;
alter table public.mapping_templates enable row level security;
alter table public.mapping_memory enable row level security;
alter table public.dpgf_mappings enable row level security;

create policy "Profiles are viewable by authenticated users"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Authenticated can view suppliers"
  on public.suppliers
  for select
  to authenticated
  using (true);

create policy "Admins can insert suppliers"
  on public.suppliers
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update suppliers"
  on public.suppliers
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete suppliers"
  on public.suppliers
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Authenticated can view delivery sites"
  on public.delivery_sites
  for select
  to authenticated
  using (true);

create policy "Admins can insert delivery sites"
  on public.delivery_sites
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update delivery sites"
  on public.delivery_sites
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete delivery sites"
  on public.delivery_sites
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Authenticated can view products"
  on public.products
  for select
  to authenticated
  using (true);

create policy "Admins can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select public.is_admin_user()));

create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using ((select public.is_admin_user()))
  with check ((select public.is_admin_user()));

create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using ((select public.is_admin_user()));

create policy "Users can view own purchase orders"
  on public.purchase_orders
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can insert own purchase orders"
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can update own purchase orders"
  on public.purchase_orders
  for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  )
  with check (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can delete own purchase orders"
  on public.purchase_orders
  for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin_user())
  );

create policy "Users can view own purchase order items"
  on public.purchase_order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can insert own purchase order items"
  on public.purchase_order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can update own purchase order items"
  on public.purchase_order_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

create policy "Users can delete own purchase order items"
  on public.purchase_order_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and (
          po.user_id = (select auth.uid())
          or (select public.is_admin_user())
        )
    )
  );

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

create policy "Admins can view audit logs"
  on public.audit_logs
  for select
  to authenticated
  using ((select public.is_admin_user()));

create policy "Users can manage own dpgf imports"
  on public.dpgf_imports
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own dpgf raw rows"
  on public.dpgf_rows_raw
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.user_id = (select auth.uid())
    )
  );

create policy "Users can manage own dpgf mapped rows"
  on public.dpgf_rows_mapped
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.user_id = (select auth.uid())
    )
  );

create policy "Users can manage own mapping templates"
  on public.mapping_templates
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own mapping memory"
  on public.mapping_memory
  for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Users can manage own dpgf mappings"
  on public.dpgf_mappings
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.user_id = (select auth.uid())
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dpgf-imports',
  'dpgf-imports',
  false,
  52428800,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Users can upload own dpgf imports" on storage.objects;
drop policy if exists "Users can view own dpgf imports" on storage.objects;
drop policy if exists "Users can update own dpgf imports" on storage.objects;
drop policy if exists "Users can delete own dpgf imports" on storage.objects;

create policy "Users can upload own dpgf imports"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can view own dpgf imports"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can update own dpgf imports"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

create policy "Users can delete own dpgf imports"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'dpgf-imports'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

-- ------------------------------------------------------------
-- BC-011 / BC-009 extensions (migrations 013-015)
-- ------------------------------------------------------------

-- Migration S5 (BC-011): multi-tenant core with tenant propagation and tenant-aware RLS.

do $$
begin
  create type public.tenant_role as enum ('admin', 'engineer', 'viewer');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  slug text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  is_active boolean not null default true
);

alter table public.tenants
  alter column created_by set default auth.uid();

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.tenant_role not null default 'viewer',
  is_default boolean not null default false,
  unique (tenant_id, user_id)
);

create index if not exists tenant_memberships_user_id_idx
  on public.tenant_memberships (user_id);
create index if not exists tenant_memberships_tenant_role_idx
  on public.tenant_memberships (tenant_id, role);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  default_tenant_id uuid;
  membership_role public.tenant_role;
begin
  insert into public.profiles (id, full_name, phone, job_title, work_email, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), new.email, 'Utilisateur'),
    nullif(trim(new.raw_user_meta_data->>'phone'), ''),
    nullif(trim(new.raw_user_meta_data->>'job_title'), ''),
    new.email,
    'buyer'
  )
  on conflict (id) do update
  set
    full_name = excluded.full_name,
    phone = excluded.phone,
    job_title = excluded.job_title,
    work_email = excluded.work_email;

  membership_role := case
    when lower(coalesce(new.raw_user_meta_data->>'role', '')) = 'admin' then 'admin'::public.tenant_role
    else 'engineer'::public.tenant_role
  end;

  select t.id
    into default_tenant_id
  from public.tenants t
  where t.slug = 'hydro-express'
  order by t.created_at asc
  limit 1;

  if default_tenant_id is null then
    select t.id
      into default_tenant_id
    from public.tenants t
    order by t.created_at asc
    limit 1;
  end if;

  if default_tenant_id is null then
    insert into public.tenants (name, slug, created_by)
    values ('Hydro Express', 'hydro-express', new.id)
    on conflict (slug) do update
    set name = excluded.name
    returning id into default_tenant_id;

    if default_tenant_id is null then
      select t.id
        into default_tenant_id
      from public.tenants t
      where t.slug = 'hydro-express'
      limit 1;
    end if;
  end if;

  if default_tenant_id is null then
    raise exception 'Unable to resolve a default tenant for user %', new.id;
  end if;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_default
  )
  values (
    default_tenant_id,
    new.id,
    membership_role,
    not exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = new.id
        and tm.is_default
    )
  )
  on conflict (tenant_id, user_id)
  do update
  set role = excluded.role;

  with ranked_defaults as (
    select
      tm.id,
      row_number() over (
        partition by tm.user_id
        order by tm.is_default desc, tm.created_at asc, tm.id asc
      ) as rank_in_user
    from public.tenant_memberships tm
    where tm.user_id = new.id
  )
  update public.tenant_memberships tm
  set is_default = (ranked_defaults.rank_in_user = 1)
  from ranked_defaults
  where tm.id = ranked_defaults.id
    and tm.is_default is distinct from (ranked_defaults.rank_in_user = 1);

  return new;
end;
$$;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;

drop trigger if exists set_tenants_updated_at on public.tenants;
create trigger set_tenants_updated_at
  before update on public.tenants
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_tenant_memberships_updated_at on public.tenant_memberships;
create trigger set_tenant_memberships_updated_at
  before update on public.tenant_memberships
  for each row execute procedure public.set_updated_at();

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tm.tenant_id
  from public.tenant_memberships tm
  where tm.user_id = (select auth.uid())
  order by tm.is_default desc, tm.created_at asc
  limit 1;
$$;

create or replace function public.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_tenant_id is not null
    and (
      exists (
        select 1
        from public.tenant_memberships tm
        where tm.tenant_id = target_tenant_id
          and tm.user_id = (select auth.uid())
      )
      or (select public.is_admin_user())
    );
$$;

create or replace function public.has_tenant_role(
  target_tenant_id uuid,
  allowed_roles public.tenant_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_tenant_id is not null
    and coalesce(array_length(allowed_roles, 1), 0) > 0
    and (
      exists (
        select 1
        from public.tenant_memberships tm
        where tm.tenant_id = target_tenant_id
          and tm.user_id = (select auth.uid())
          and tm.role = any(allowed_roles)
      )
      or (select public.is_admin_user())
    );
$$;

create or replace function public.can_bootstrap_tenant_membership(
  target_tenant_id uuid,
  target_user_id uuid,
  target_role public.tenant_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    target_tenant_id is not null
    and target_user_id = (select auth.uid())
    and target_role = 'admin'::public.tenant_role
    and exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.created_by = (select auth.uid())
    )
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
    );
$$;

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated;
grant execute on function public.can_bootstrap_tenant_membership(uuid, uuid, public.tenant_role) to authenticated;

do $$
declare
  default_tenant_id uuid;
begin
  select t.id
    into default_tenant_id
  from public.tenants t
  order by t.created_at asc
  limit 1;

  if default_tenant_id is null then
    insert into public.tenants (name, slug, created_by)
    values ('Hydro Express', 'hydro-express', null)
    on conflict (slug) do update set slug = excluded.slug
    returning id into default_tenant_id;

    if default_tenant_id is null then
      select t.id
        into default_tenant_id
      from public.tenants t
      where t.slug = 'hydro-express'
      limit 1;
    end if;
  end if;

  if default_tenant_id is null then
    raise exception 'Unable to initialize default tenant.';
  end if;

  insert into public.tenant_memberships (
    tenant_id,
    user_id,
    role,
    is_default
  )
  select
    default_tenant_id,
    p.id,
    case
      when p.role = 'admin' then 'admin'::public.tenant_role
      else 'engineer'::public.tenant_role
    end,
    not exists (
      select 1
      from public.tenant_memberships tm
      where tm.user_id = p.id
        and tm.is_default
    )
  from public.profiles p
  on conflict (tenant_id, user_id)
  do update
  set role = excluded.role;

  with users_without_default as (
    select tm.id
    from public.tenant_memberships tm
    where not exists (
      select 1
      from public.tenant_memberships tmd
      where tmd.user_id = tm.user_id
        and tmd.is_default
    )
    and tm.id in (
      select distinct on (tm2.user_id) tm2.id
      from public.tenant_memberships tm2
      order by tm2.user_id, tm2.created_at asc
    )
  )
  update public.tenant_memberships tm
  set is_default = true
  from users_without_default ud
  where tm.id = ud.id;
end;
$$;

with ranked_defaults as (
  select
    tm.id,
    row_number() over (
      partition by tm.user_id
      order by tm.is_default desc, tm.created_at asc, tm.id asc
    ) as rank_in_user
  from public.tenant_memberships tm
)
update public.tenant_memberships tm
set is_default = (ranked_defaults.rank_in_user = 1)
from ranked_defaults
where tm.id = ranked_defaults.id
  and tm.is_default is distinct from (ranked_defaults.rank_in_user = 1);

create unique index if not exists tenant_memberships_single_default_idx
  on public.tenant_memberships (user_id)
  where is_default;

alter table public.suppliers
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.delivery_sites
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.products
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.purchase_orders
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.purchase_order_items
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.purchase_order_devis
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

alter table public.estimate_projects
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.estimate_versions
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.estimate_items
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.estimate_categories
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.labor_roles
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.estimate_suggestion_rules
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

alter table public.audit_logs
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

alter table public.dpgf_imports
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.dpgf_rows_raw
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.dpgf_rows_mapped
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

alter table public.mapping_templates
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.mapping_memory
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;
alter table public.dpgf_mappings
  add column if not exists tenant_id uuid references public.tenants(id) on delete restrict;

do $$
declare
  default_tenant_id uuid;
begin
  select t.id
    into default_tenant_id
  from public.tenants t
  order by t.created_at asc
  limit 1;

  if default_tenant_id is null then
    raise exception 'No tenant available for tenant_id backfill.';
  end if;

  update public.suppliers
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.delivery_sites
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.products
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.purchase_orders po
  set tenant_id = s.tenant_id
  from public.suppliers s
  where po.tenant_id is null
    and po.supplier_id = s.id
    and s.tenant_id is not null;

  update public.purchase_orders po
  set tenant_id = ds.tenant_id
  from public.delivery_sites ds
  where po.tenant_id is null
    and po.delivery_site_id = ds.id
    and ds.tenant_id is not null;

  update public.purchase_orders
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.purchase_order_items poi
  set tenant_id = po.tenant_id
  from public.purchase_orders po
  where poi.tenant_id is null
    and poi.purchase_order_id = po.id;

  update public.purchase_order_devis pod
  set tenant_id = po.tenant_id
  from public.purchase_orders po
  where pod.tenant_id is null
    and pod.purchase_order_id = po.id;

  update public.estimate_projects ep
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where ep.tenant_id is null
    and ep.user_id = tm.user_id
    and tm.is_default;

  update public.estimate_projects
  set tenant_id = default_tenant_id
  where tenant_id is null;

  alter table public.estimate_versions
    disable trigger guard_estimate_versions_readonly;

  update public.estimate_versions ev
  set tenant_id = ep.tenant_id
  from public.estimate_projects ep
  where ev.tenant_id is null
    and ev.project_id = ep.id;

  alter table public.estimate_versions
    enable trigger guard_estimate_versions_readonly;

  update public.estimate_items ei
  set tenant_id = ev.tenant_id
  from public.estimate_versions ev
  where ei.tenant_id is null
    and ei.version_id = ev.id;

  update public.estimate_categories ec
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where ec.tenant_id is null
    and ec.user_id = tm.user_id
    and tm.is_default;

  update public.estimate_categories
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.labor_roles lr
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where lr.tenant_id is null
    and lr.user_id = tm.user_id
    and tm.is_default;

  update public.labor_roles
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.estimate_suggestion_rules esr
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where esr.tenant_id is null
    and esr.user_id = tm.user_id
    and tm.is_default;

  update public.estimate_suggestion_rules
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.audit_logs al
  set tenant_id = ev.tenant_id
  from public.estimate_versions ev
  where al.tenant_id is null
    and al.estimate_version_id = ev.id;

  update public.audit_logs al
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where al.tenant_id is null
    and al.user_id = tm.user_id
    and tm.is_default;

  update public.audit_logs
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_imports di
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where di.tenant_id is null
    and di.user_id = tm.user_id
    and tm.is_default;

  update public.dpgf_imports
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_rows_raw drr
  set tenant_id = di.tenant_id
  from public.dpgf_imports di
  where drr.tenant_id is null
    and drr.import_id = di.id;

  update public.dpgf_rows_mapped drm
  set tenant_id = di.tenant_id
  from public.dpgf_imports di
  where drm.tenant_id is null
    and drm.import_id = di.id;

  update public.dpgf_rows_mapped drm
  set tenant_id = drr.tenant_id
  from public.dpgf_rows_raw drr
  where drm.tenant_id is null
    and drm.raw_row_id = drr.id;

  update public.mapping_templates mt
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where mt.tenant_id is null
    and mt.user_id = tm.user_id
    and tm.is_default;

  update public.mapping_templates
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.mapping_memory mm
  set tenant_id = tm.tenant_id
  from public.tenant_memberships tm
  where mm.tenant_id is null
    and mm.user_id = tm.user_id
    and tm.is_default;

  update public.mapping_memory
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_mappings dm
  set tenant_id = di.tenant_id
  from public.dpgf_imports di
  where dm.tenant_id is null
    and dm.import_id = di.id;

  update public.purchase_order_items
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.purchase_order_devis
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.estimate_versions
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.estimate_items
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_rows_raw
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_rows_mapped
  set tenant_id = default_tenant_id
  where tenant_id is null;

  update public.dpgf_mappings
  set tenant_id = default_tenant_id
  where tenant_id is null;
end;
$$;

alter table public.suppliers alter column tenant_id set default public.current_tenant_id();
alter table public.delivery_sites alter column tenant_id set default public.current_tenant_id();
alter table public.products alter column tenant_id set default public.current_tenant_id();
alter table public.purchase_orders alter column tenant_id set default public.current_tenant_id();
alter table public.purchase_order_items alter column tenant_id set default public.current_tenant_id();
alter table public.purchase_order_devis alter column tenant_id set default public.current_tenant_id();

alter table public.estimate_projects alter column tenant_id set default public.current_tenant_id();
alter table public.estimate_versions alter column tenant_id set default public.current_tenant_id();
alter table public.estimate_items alter column tenant_id set default public.current_tenant_id();
alter table public.estimate_categories alter column tenant_id set default public.current_tenant_id();
alter table public.labor_roles alter column tenant_id set default public.current_tenant_id();
alter table public.estimate_suggestion_rules alter column tenant_id set default public.current_tenant_id();

alter table public.audit_logs alter column tenant_id set default public.current_tenant_id();

alter table public.dpgf_imports alter column tenant_id set default public.current_tenant_id();
alter table public.dpgf_rows_raw alter column tenant_id set default public.current_tenant_id();
alter table public.dpgf_rows_mapped alter column tenant_id set default public.current_tenant_id();

alter table public.mapping_templates alter column tenant_id set default public.current_tenant_id();
alter table public.mapping_memory alter column tenant_id set default public.current_tenant_id();
alter table public.dpgf_mappings alter column tenant_id set default public.current_tenant_id();

alter table public.suppliers alter column tenant_id set not null;
alter table public.delivery_sites alter column tenant_id set not null;
alter table public.products alter column tenant_id set not null;
alter table public.purchase_orders alter column tenant_id set not null;
alter table public.purchase_order_items alter column tenant_id set not null;
alter table public.purchase_order_devis alter column tenant_id set not null;

alter table public.estimate_projects alter column tenant_id set not null;
alter table public.estimate_versions alter column tenant_id set not null;
alter table public.estimate_items alter column tenant_id set not null;
alter table public.estimate_categories alter column tenant_id set not null;
alter table public.labor_roles alter column tenant_id set not null;
alter table public.estimate_suggestion_rules alter column tenant_id set not null;

alter table public.estimate_categories
  drop constraint if exists estimate_categories_user_id_name_key;
alter table public.estimate_categories
  add constraint estimate_categories_tenant_user_name_key
  unique (tenant_id, user_id, name);

alter table public.labor_roles
  drop constraint if exists labor_roles_user_id_name_key;
alter table public.labor_roles
  add constraint labor_roles_tenant_user_name_key
  unique (tenant_id, user_id, name);

alter table public.mapping_templates
  drop constraint if exists mapping_templates_user_id_name_key;
alter table public.mapping_templates
  add constraint mapping_templates_tenant_user_name_key
  unique (tenant_id, user_id, name);

alter table public.audit_logs alter column tenant_id set not null;

alter table public.dpgf_imports alter column tenant_id set not null;
alter table public.dpgf_rows_raw alter column tenant_id set not null;
alter table public.dpgf_rows_mapped alter column tenant_id set not null;

alter table public.mapping_templates alter column tenant_id set not null;
alter table public.mapping_memory alter column tenant_id set not null;
alter table public.dpgf_mappings alter column tenant_id set not null;

create or replace function public.assign_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_table_name = 'purchase_order_items' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'purchase_order_devis' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'estimate_versions' then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  elsif tg_table_name = 'estimate_items' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  elsif tg_table_name = 'audit_logs' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = nullif(to_jsonb(new)->>'estimate_version_id', '')::uuid;
  elsif tg_table_name = 'dpgf_rows_raw' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  elsif tg_table_name = 'dpgf_rows_mapped' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;

    if parent_tenant_id is null and new.raw_row_id is not null then
      select drr.tenant_id
        into parent_tenant_id
      from public.dpgf_rows_raw drr
      where drr.id = new.raw_row_id;
    end if;
  elsif tg_table_name = 'dpgf_mappings' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_suppliers_tenant_id on public.suppliers;
create trigger set_suppliers_tenant_id
  before insert or update on public.suppliers
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_delivery_sites_tenant_id on public.delivery_sites;
create trigger set_delivery_sites_tenant_id
  before insert or update on public.delivery_sites
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_products_tenant_id on public.products;
create trigger set_products_tenant_id
  before insert or update on public.products
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_purchase_orders_tenant_id on public.purchase_orders;
create trigger set_purchase_orders_tenant_id
  before insert or update on public.purchase_orders
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_purchase_order_items_tenant_id on public.purchase_order_items;
create trigger set_purchase_order_items_tenant_id
  before insert or update on public.purchase_order_items
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_purchase_order_devis_tenant_id on public.purchase_order_devis;
create trigger set_purchase_order_devis_tenant_id
  before insert or update on public.purchase_order_devis
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_projects_tenant_id on public.estimate_projects;
create trigger set_estimate_projects_tenant_id
  before insert or update on public.estimate_projects
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_versions_tenant_id on public.estimate_versions;
create trigger set_estimate_versions_tenant_id
  before insert or update on public.estimate_versions
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_items_tenant_id on public.estimate_items;
create trigger set_estimate_items_tenant_id
  before insert or update on public.estimate_items
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_categories_tenant_id on public.estimate_categories;
create trigger set_estimate_categories_tenant_id
  before insert or update on public.estimate_categories
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_labor_roles_tenant_id on public.labor_roles;
create trigger set_labor_roles_tenant_id
  before insert or update on public.labor_roles
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_suggestion_rules_tenant_id on public.estimate_suggestion_rules;
create trigger set_estimate_suggestion_rules_tenant_id
  before insert or update on public.estimate_suggestion_rules
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_audit_logs_tenant_id on public.audit_logs;
create trigger set_audit_logs_tenant_id
  before insert or update on public.audit_logs
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_dpgf_imports_tenant_id on public.dpgf_imports;
create trigger set_dpgf_imports_tenant_id
  before insert or update on public.dpgf_imports
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_dpgf_rows_raw_tenant_id on public.dpgf_rows_raw;
create trigger set_dpgf_rows_raw_tenant_id
  before insert or update on public.dpgf_rows_raw
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_dpgf_rows_mapped_tenant_id on public.dpgf_rows_mapped;
create trigger set_dpgf_rows_mapped_tenant_id
  before insert or update on public.dpgf_rows_mapped
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_mapping_templates_tenant_id on public.mapping_templates;
create trigger set_mapping_templates_tenant_id
  before insert or update on public.mapping_templates
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_mapping_memory_tenant_id on public.mapping_memory;
create trigger set_mapping_memory_tenant_id
  before insert or update on public.mapping_memory
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_dpgf_mappings_tenant_id on public.dpgf_mappings;
create trigger set_dpgf_mappings_tenant_id
  before insert or update on public.dpgf_mappings
  for each row execute procedure public.assign_tenant_id();

create index if not exists suppliers_tenant_id_idx
  on public.suppliers (tenant_id);
create index if not exists suppliers_tenant_name_idx
  on public.suppliers (tenant_id, name);

create index if not exists delivery_sites_tenant_id_idx
  on public.delivery_sites (tenant_id);
create index if not exists delivery_sites_tenant_name_idx
  on public.delivery_sites (tenant_id, name);

create index if not exists products_tenant_id_idx
  on public.products (tenant_id);
create index if not exists products_tenant_designation_idx
  on public.products (tenant_id, designation);

create index if not exists purchase_orders_tenant_id_idx
  on public.purchase_orders (tenant_id);
create index if not exists purchase_orders_tenant_user_id_idx
  on public.purchase_orders (tenant_id, user_id);
create index if not exists purchase_orders_tenant_order_date_idx
  on public.purchase_orders (tenant_id, order_date);

create index if not exists purchase_order_items_tenant_id_idx
  on public.purchase_order_items (tenant_id);
create index if not exists purchase_order_devis_tenant_id_idx
  on public.purchase_order_devis (tenant_id);

create index if not exists estimate_projects_tenant_id_idx
  on public.estimate_projects (tenant_id);
create index if not exists estimate_projects_tenant_user_id_idx
  on public.estimate_projects (tenant_id, user_id);
create index if not exists estimate_versions_tenant_id_idx
  on public.estimate_versions (tenant_id);
create index if not exists estimate_items_tenant_id_idx
  on public.estimate_items (tenant_id);
create index if not exists estimate_categories_tenant_id_idx
  on public.estimate_categories (tenant_id);
create index if not exists labor_roles_tenant_id_idx
  on public.labor_roles (tenant_id);
create index if not exists estimate_suggestion_rules_tenant_id_idx
  on public.estimate_suggestion_rules (tenant_id);

create index if not exists audit_logs_tenant_id_idx
  on public.audit_logs (tenant_id);

create index if not exists dpgf_imports_tenant_id_idx
  on public.dpgf_imports (tenant_id);
create index if not exists dpgf_rows_raw_tenant_id_idx
  on public.dpgf_rows_raw (tenant_id);
create index if not exists dpgf_rows_mapped_tenant_id_idx
  on public.dpgf_rows_mapped (tenant_id);
create index if not exists dpgf_mappings_tenant_id_idx
  on public.dpgf_mappings (tenant_id);
create index if not exists mapping_templates_tenant_id_idx
  on public.mapping_templates (tenant_id);
create index if not exists mapping_memory_tenant_id_idx
  on public.mapping_memory (tenant_id);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'delivery_sites_project_code_key'
      and conrelid = 'public.delivery_sites'::regclass
  ) then
    alter table public.delivery_sites
      drop constraint delivery_sites_project_code_key;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'products_reference_key'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      drop constraint products_reference_key;
  end if;

  if exists (
    select 1
    from pg_constraint
    where conname = 'purchase_orders_reference_key'
      and conrelid = 'public.purchase_orders'::regclass
  ) then
    alter table public.purchase_orders
      drop constraint purchase_orders_reference_key;
  end if;
end;
$$;

create unique index if not exists delivery_sites_tenant_project_code_key
  on public.delivery_sites (tenant_id, project_code)
  where project_code is not null;

create unique index if not exists products_tenant_reference_key
  on public.products (tenant_id, reference)
  where reference is not null;

create unique index if not exists purchase_orders_tenant_reference_key
  on public.purchase_orders (tenant_id, reference);

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
  target_tenant_id uuid;
begin
  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid
  );

  target_tenant_id := coalesce(
    nullif(target_new->>'tenant_id', '')::uuid,
    nullif(target_old->>'tenant_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_record_id;
    end if;
  end if;

  if target_tenant_id is null then
    if target_version_id is not null then
      select v.tenant_id
        into target_tenant_id
      from public.estimate_versions v
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.tenant_id
        into target_tenant_id
      from public.estimate_projects p
      where p.id = target_record_id;
    elsif target_row_user_id is not null then
      select tm.tenant_id
        into target_tenant_id
      from public.tenant_memberships tm
      where tm.user_id = target_row_user_id
      order by tm.is_default desc, tm.created_at asc
      limit 1;
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce(target_tenant_id, public.current_tenant_id()),
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    tg_op,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create or replace function public.duplicate_estimate_version(source_version_id uuid)
returns uuid
language plpgsql
set search_path = public
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
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  insert into public.estimate_versions (
    id,
    tenant_id,
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
    source_version.tenant_id,
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
    tenant_id,
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
    source_version.tenant_id,
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

drop policy if exists "Users can view own tenants" on public.tenants;
drop policy if exists "Authenticated can create tenants" on public.tenants;
drop policy if exists "Tenant admins can update tenants" on public.tenants;
drop policy if exists "Tenant admins can delete tenants" on public.tenants;

drop policy if exists "Users can view memberships in own tenants" on public.tenant_memberships;
drop policy if exists "Tenant admins can insert memberships" on public.tenant_memberships;
drop policy if exists "Tenant admins can update memberships" on public.tenant_memberships;
drop policy if exists "Tenant admins can delete memberships" on public.tenant_memberships;

create policy "Users can view own tenants"
  on public.tenants
  for select
  to authenticated
  using (
    (select public.is_tenant_member(id))
    or created_by = (select auth.uid())
  );

create policy "Authenticated can create tenants"
  on public.tenants
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and created_by = (select auth.uid())
  );

create policy "Tenant admins can update tenants"
  on public.tenants
  for update
  to authenticated
  using ((select public.has_tenant_role(id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(id, array['admin'::public.tenant_role])));

create policy "Tenant admins can delete tenants"
  on public.tenants
  for delete
  to authenticated
  using ((select public.has_tenant_role(id, array['admin'::public.tenant_role])));

create policy "Users can view memberships in own tenants"
  on public.tenant_memberships
  for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );

create policy "Tenant admins can insert memberships"
  on public.tenant_memberships
  for insert
  to authenticated
  with check (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    or (select public.can_bootstrap_tenant_membership(tenant_id, user_id, role))
  );

create policy "Tenant admins can update memberships"
  on public.tenant_memberships
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Tenant admins can delete memberships"
  on public.tenant_memberships
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Authenticated can view suppliers" on public.suppliers;
drop policy if exists "Admins can insert suppliers" on public.suppliers;
drop policy if exists "Admins can update suppliers" on public.suppliers;
drop policy if exists "Admins can delete suppliers" on public.suppliers;

create policy "Authenticated can view suppliers"
  on public.suppliers
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Admins can insert suppliers"
  on public.suppliers
  for insert
  to authenticated
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can update suppliers"
  on public.suppliers
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can delete suppliers"
  on public.suppliers
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Authenticated can view delivery sites" on public.delivery_sites;
drop policy if exists "Admins can insert delivery sites" on public.delivery_sites;
drop policy if exists "Admins can update delivery sites" on public.delivery_sites;
drop policy if exists "Admins can delete delivery sites" on public.delivery_sites;

create policy "Authenticated can view delivery sites"
  on public.delivery_sites
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Admins can insert delivery sites"
  on public.delivery_sites
  for insert
  to authenticated
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can update delivery sites"
  on public.delivery_sites
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can delete delivery sites"
  on public.delivery_sites
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Authenticated can view products" on public.products;
drop policy if exists "Admins can insert products" on public.products;
drop policy if exists "Admins can update products" on public.products;
drop policy if exists "Admins can delete products" on public.products;

create policy "Authenticated can view products"
  on public.products
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Admins can insert products"
  on public.products
  for insert
  to authenticated
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can update products"
  on public.products
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Admins can delete products"
  on public.products
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Users can view own purchase orders" on public.purchase_orders;
drop policy if exists "Users can insert own purchase orders" on public.purchase_orders;
drop policy if exists "Users can update own purchase orders" on public.purchase_orders;
drop policy if exists "Users can delete own purchase orders" on public.purchase_orders;

create policy "Users can view own purchase orders"
  on public.purchase_orders
  for select
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can insert own purchase orders"
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can update own purchase orders"
  on public.purchase_orders
  for update
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can delete own purchase orders"
  on public.purchase_orders
  for delete
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

drop policy if exists "Users can view own purchase order items" on public.purchase_order_items;
drop policy if exists "Users can insert own purchase order items" on public.purchase_order_items;
drop policy if exists "Users can update own purchase order items" on public.purchase_order_items;
drop policy if exists "Users can delete own purchase order items" on public.purchase_order_items;

create policy "Users can view own purchase order items"
  on public.purchase_order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.tenant_id = purchase_order_items.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert own purchase order items"
  on public.purchase_order_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.tenant_id = purchase_order_items.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can update own purchase order items"
  on public.purchase_order_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.tenant_id = purchase_order_items.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.tenant_id = purchase_order_items.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can delete own purchase order items"
  on public.purchase_order_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_items.purchase_order_id
        and po.tenant_id = purchase_order_items.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

drop policy if exists "Authenticated can access devis" on public.purchase_order_devis;

create policy "Authenticated can access devis"
  on public.purchase_order_devis
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.tenant_id = purchase_order_devis.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_devis.purchase_order_id
        and po.tenant_id = purchase_order_devis.tenant_id
        and (select public.is_tenant_member(po.tenant_id))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

drop policy if exists "Users can manage estimate projects" on public.estimate_projects;
drop policy if exists "Users can manage estimate versions" on public.estimate_versions;
drop policy if exists "Users can view estimate items" on public.estimate_items;
drop policy if exists "Users can insert draft estimate items" on public.estimate_items;
drop policy if exists "Users can update draft estimate items" on public.estimate_items;
drop policy if exists "Users can delete draft estimate items" on public.estimate_items;
drop policy if exists "Users can manage estimate categories" on public.estimate_categories;
drop policy if exists "Users can manage labor roles" on public.labor_roles;
drop policy if exists "Users can manage estimate suggestion rules" on public.estimate_suggestion_rules;

create policy "Users can manage estimate projects"
  on public.estimate_projects
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage estimate versions"
  on public.estimate_versions
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_projects p
      where p.id = estimate_versions.project_id
        and p.tenant_id = estimate_versions.tenant_id
        and (select public.is_tenant_member(p.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_projects p
      where p.id = estimate_versions.project_id
        and p.tenant_id = estimate_versions.tenant_id
        and (select public.is_tenant_member(p.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can view estimate items"
  on public.estimate_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert draft estimate items"
  on public.estimate_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can update draft estimate items"
  on public.estimate_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can delete draft estimate items"
  on public.estimate_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_items.version_id
        and v.tenant_id = estimate_items.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can manage estimate categories"
  on public.estimate_categories
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage labor roles"
  on public.labor_roles
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage estimate suggestion rules"
  on public.estimate_suggestion_rules
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

drop policy if exists "Admins can view audit logs" on public.audit_logs;

create policy "Admins can view audit logs"
  on public.audit_logs
  for select
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

drop policy if exists "Users can manage own dpgf imports" on public.dpgf_imports;
drop policy if exists "Users can manage own dpgf raw rows" on public.dpgf_rows_raw;
drop policy if exists "Users can manage own dpgf mapped rows" on public.dpgf_rows_mapped;
drop policy if exists "Users can manage own mapping templates" on public.mapping_templates;
drop policy if exists "Users can manage own mapping memory" on public.mapping_memory;
drop policy if exists "Users can manage own dpgf mappings" on public.dpgf_mappings;

create policy "Users can manage own dpgf imports"
  on public.dpgf_imports
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage own dpgf raw rows"
  on public.dpgf_rows_raw
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_raw.import_id
        and di.tenant_id = dpgf_rows_raw.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can manage own dpgf mapped rows"
  on public.dpgf_rows_mapped
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.tenant_id = dpgf_rows_mapped.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_rows_mapped.import_id
        and di.tenant_id = dpgf_rows_mapped.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can manage own mapping templates"
  on public.mapping_templates
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage own mapping memory"
  on public.mapping_memory
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can manage own dpgf mappings"
  on public.dpgf_mappings
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.tenant_id = dpgf_mappings.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_mappings.import_id
        and di.tenant_id = dpgf_mappings.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

-- Migration S4 (BC-009): catalogue pricebook, material indices, and import linkage tables.

create table if not exists public.supplier_pricebook (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  supplier_sku text,
  unit text not null default 'u',
  min_quantity numeric(12,3) not null default 1 check (min_quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  currency text not null default 'EUR',
  valid_from date not null default current_date,
  valid_to date,
  is_active boolean not null default true,
  source_import_id uuid references public.dpgf_imports(id) on delete set null,
  source_mapped_row_id uuid references public.dpgf_rows_mapped(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  notes text,
  check (valid_to is null or valid_to >= valid_from)
);

drop trigger if exists set_supplier_pricebook_updated_at on public.supplier_pricebook;
create trigger set_supplier_pricebook_updated_at
  before update on public.supplier_pricebook
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_supplier_pricebook_tenant_id on public.supplier_pricebook;
create trigger set_supplier_pricebook_tenant_id
  before insert or update on public.supplier_pricebook
  for each row execute procedure public.assign_tenant_id();

create unique index if not exists supplier_pricebook_unique_window_idx
  on public.supplier_pricebook (tenant_id, supplier_id, product_id, currency, valid_from, min_quantity);
create index if not exists supplier_pricebook_tenant_supplier_product_idx
  on public.supplier_pricebook (tenant_id, supplier_id, product_id, valid_from desc);
create index if not exists supplier_pricebook_tenant_active_valid_idx
  on public.supplier_pricebook (tenant_id, is_active, valid_from desc);

create table if not exists public.material_indices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  index_code text not null,
  label text not null,
  index_date date not null,
  index_value numeric(14,6) not null check (index_value >= 0),
  unit text not null default 'base_100',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  unique (tenant_id, index_code, index_date)
);

drop trigger if exists set_material_indices_updated_at on public.material_indices;
create trigger set_material_indices_updated_at
  before update on public.material_indices
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_material_indices_tenant_id on public.material_indices;
create trigger set_material_indices_tenant_id
  before insert or update on public.material_indices
  for each row execute procedure public.assign_tenant_id();

create index if not exists material_indices_tenant_code_date_idx
  on public.material_indices (tenant_id, index_code, index_date desc);
create index if not exists material_indices_tenant_date_idx
  on public.material_indices (tenant_id, index_date desc);

create table if not exists public.dpgf_catalogue_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  import_id uuid not null references public.dpgf_imports(id) on delete cascade,
  mapped_row_id uuid not null references public.dpgf_rows_mapped(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  supplier_price_id uuid references public.supplier_pricebook(id) on delete set null,
  material_index_id uuid references public.material_indices(id) on delete set null,
  status text not null default 'linked' check (status in ('linked', 'ignored', 'error')),
  message text,
  unique (tenant_id, mapped_row_id)
);

drop trigger if exists set_dpgf_catalogue_links_updated_at on public.dpgf_catalogue_links;
create trigger set_dpgf_catalogue_links_updated_at
  before update on public.dpgf_catalogue_links
  for each row execute procedure public.set_updated_at();

create or replace function public.set_dpgf_catalogue_link_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  select di.tenant_id
    into parent_tenant_id
  from public.dpgf_imports di
  where di.id = new.import_id;

  if parent_tenant_id is null and new.mapped_row_id is not null then
    select drm.tenant_id
      into parent_tenant_id
    from public.dpgf_rows_mapped drm
    where drm.id = new.mapped_row_id;
  end if;

  new.tenant_id := coalesce(parent_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_dpgf_catalogue_links_tenant_id on public.dpgf_catalogue_links;
create trigger set_dpgf_catalogue_links_tenant_id
  before insert or update on public.dpgf_catalogue_links
  for each row execute procedure public.set_dpgf_catalogue_link_tenant_id();

create index if not exists dpgf_catalogue_links_tenant_import_idx
  on public.dpgf_catalogue_links (tenant_id, import_id, created_at desc);
create index if not exists dpgf_catalogue_links_tenant_status_idx
  on public.dpgf_catalogue_links (tenant_id, status);

alter table public.supplier_pricebook enable row level security;
alter table public.material_indices enable row level security;
alter table public.dpgf_catalogue_links enable row level security;

drop policy if exists "Tenant members can view supplier pricebook" on public.supplier_pricebook;
drop policy if exists "Tenant editors can manage supplier pricebook" on public.supplier_pricebook;

drop policy if exists "Tenant members can view material indices" on public.material_indices;
drop policy if exists "Tenant editors can manage material indices" on public.material_indices;

drop policy if exists "Users can view own dpgf catalogue links" on public.dpgf_catalogue_links;
drop policy if exists "Users can manage own dpgf catalogue links" on public.dpgf_catalogue_links;

create policy "Tenant members can view supplier pricebook"
  on public.supplier_pricebook
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant editors can manage supplier pricebook"
  on public.supplier_pricebook
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])));

create policy "Tenant members can view material indices"
  on public.material_indices
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant editors can manage material indices"
  on public.material_indices
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])));

create policy "Users can view own dpgf catalogue links"
  on public.dpgf_catalogue_links
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_catalogue_links.import_id
        and di.tenant_id = dpgf_catalogue_links.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
        )
    )
  );

create policy "Users can manage own dpgf catalogue links"
  on public.dpgf_catalogue_links
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_catalogue_links.import_id
        and di.tenant_id = dpgf_catalogue_links.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.dpgf_imports di
      where di.id = dpgf_catalogue_links.import_id
        and di.tenant_id = dpgf_catalogue_links.tenant_id
        and (select public.is_tenant_member(di.tenant_id))
        and (
          di.user_id = (select auth.uid())
          or (select public.has_tenant_role(di.tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]))
        )
    )
  );

-- Migration S4 (BC-009): helper SQL functions for bulk catalogue/pricebook/index operations.

create or replace function public.bulk_create_supplier_prices(
  price_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if coalesce(jsonb_typeof(price_rows), '') <> 'array' then
    raise exception 'price_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(price_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.supplier_pricebook (
    tenant_id,
    supplier_id,
    product_id,
    supplier_sku,
    unit,
    min_quantity,
    unit_price_cents,
    currency,
    valid_from,
    valid_to,
    is_active,
    source_import_id,
    source_mapped_row_id,
    created_by,
    notes
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'supplier_id')::uuid,
    (item->>'product_id')::uuid,
    nullif(item->>'supplier_sku', ''),
    coalesce(nullif(item->>'unit', ''), 'u'),
    coalesce(nullif(item->>'min_quantity', '')::numeric(12,3), 1),
    (item->>'unit_price_cents')::integer,
    coalesce(nullif(item->>'currency', ''), 'EUR'),
    coalesce(nullif(item->>'valid_from', '')::date, current_date),
    nullif(item->>'valid_to', '')::date,
    coalesce(nullif(item->>'is_active', '')::boolean, true),
    nullif(item->>'source_import_id', '')::uuid,
    nullif(item->>'source_mapped_row_id', '')::uuid,
    coalesce(nullif(item->>'created_by', '')::uuid, (select auth.uid())),
    nullif(item->>'notes', '')
  from jsonb_array_elements(price_rows) as item
  on conflict (tenant_id, supplier_id, product_id, currency, valid_from, min_quantity)
  do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.bulk_upsert_material_indices(
  index_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  if coalesce(jsonb_typeof(index_rows), '') <> 'array' then
    raise exception 'index_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(index_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.material_indices (
    tenant_id,
    index_code,
    label,
    index_date,
    index_value,
    unit,
    source,
    metadata,
    created_by
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'index_code')::text,
    coalesce(nullif(item->>'label', ''), (item->>'index_code')::text),
    (item->>'index_date')::date,
    (item->>'index_value')::numeric(14,6),
    coalesce(nullif(item->>'unit', ''), 'base_100'),
    nullif(item->>'source', ''),
    case
      when jsonb_typeof(item->'metadata') = 'object'
        then item->'metadata'
      else '{}'::jsonb
    end,
    coalesce(nullif(item->>'created_by', '')::uuid, (select auth.uid()))
  from jsonb_array_elements(index_rows) as item
  on conflict (tenant_id, index_code, index_date)
  do update
  set
    label = excluded.label,
    index_value = excluded.index_value,
    unit = excluded.unit,
    source = excluded.source,
    metadata = excluded.metadata,
    created_by = coalesce(excluded.created_by, material_indices.created_by),
    updated_at = now();

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.link_mapped_rows_to_catalogue(
  link_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  if coalesce(jsonb_typeof(link_rows), '') <> 'array' then
    raise exception 'link_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(link_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.dpgf_catalogue_links (
    tenant_id,
    import_id,
    mapped_row_id,
    product_id,
    supplier_price_id,
    material_index_id,
    status,
    message
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'import_id')::uuid,
    (item->>'mapped_row_id')::uuid,
    nullif(item->>'product_id', '')::uuid,
    nullif(item->>'supplier_price_id', '')::uuid,
    nullif(item->>'material_index_id', '')::uuid,
    coalesce(nullif(item->>'status', ''), 'linked'),
    nullif(item->>'message', '')
  from jsonb_array_elements(link_rows) as item
  on conflict (tenant_id, mapped_row_id)
  do update
  set
    import_id = excluded.import_id,
    product_id = excluded.product_id,
    supplier_price_id = excluded.supplier_price_id,
    material_index_id = excluded.material_index_id,
    status = excluded.status,
    message = excluded.message,
    updated_at = now();

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

grant execute on function public.bulk_create_supplier_prices(jsonb, uuid) to authenticated;
grant execute on function public.bulk_upsert_material_indices(jsonb, uuid) to authenticated;
grant execute on function public.link_mapped_rows_to_catalogue(jsonb, uuid) to authenticated;

-- EST-006: tenant-scoped feature flags runtime.

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  flag_key text not null,
  enabled boolean not null default false,
  check (length(trim(flag_key)) > 0),
  unique (tenant_id, flag_key)
);

create index if not exists feature_flags_tenant_enabled_idx
  on public.feature_flags (tenant_id, enabled);

drop trigger if exists set_feature_flags_updated_at on public.feature_flags;
create trigger set_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute procedure public.set_updated_at();

alter table public.feature_flags enable row level security;

drop policy if exists "Tenant members can view feature flags" on public.feature_flags;
drop policy if exists "Tenant admins can manage feature flags" on public.feature_flags;

create policy "Tenant members can view feature flags"
  on public.feature_flags
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage feature flags"
  on public.feature_flags
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

-- EST-028: margin mode + tenant margin tiers.

do $$
begin
  create type public.estimate_margin_mode as enum ('fixed', 'tiered');
exception
  when duplicate_object then null;
end
$$;

alter table public.estimate_versions
  add column if not exists margin_mode public.estimate_margin_mode;

alter table public.estimate_versions
  disable trigger guard_estimate_versions_readonly;

update public.estimate_versions
set margin_mode = 'fixed'::public.estimate_margin_mode
where margin_mode is null;

alter table public.estimate_versions
  enable trigger guard_estimate_versions_readonly;

alter table public.estimate_versions
  alter column margin_mode set default 'fixed'::public.estimate_margin_mode;

alter table public.estimate_versions
  alter column margin_mode set not null;

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
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
      or new.margin_mode is distinct from old.margin_mode
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

create table if not exists public.margin_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  threshold_cents bigint not null check (threshold_cents >= 0),
  multiplier numeric not null check (multiplier >= 0 and multiplier <= 100),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists margin_tiers_tenant_threshold_unique_idx
  on public.margin_tiers (tenant_id, threshold_cents);
create unique index if not exists margin_tiers_tenant_position_unique_idx
  on public.margin_tiers (tenant_id, position);

drop trigger if exists set_margin_tiers_updated_at on public.margin_tiers;
create trigger set_margin_tiers_updated_at
  before update on public.margin_tiers
  for each row execute procedure public.set_updated_at();

alter table public.margin_tiers enable row level security;

drop policy if exists "Tenant members can view margin tiers" on public.margin_tiers;
drop policy if exists "Tenant admins can manage margin tiers" on public.margin_tiers;

create policy "Tenant members can view margin tiers"
  on public.margin_tiers
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage margin tiers"
  on public.margin_tiers
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

with default_tiers(threshold_cents, multiplier, position) as (
  values
    (0::bigint, 1.6::numeric, 0),
    (10000000::bigint, 1.45::numeric, 1),
    (100000000::bigint, 1.4::numeric, 2)
)
insert into public.margin_tiers (tenant_id, threshold_cents, multiplier, position)
select
  t.id,
  dt.threshold_cents,
  dt.multiplier,
  dt.position
from public.tenants t
cross join default_tiers dt
on conflict (tenant_id, threshold_cents) do nothing;

-- EST-026: enforce rounding invariants and scoped invariant-violation audit writes.

alter table public.estimate_versions
  drop constraint if exists estimate_versions_total_ttc_gte_total_ht_check;

alter table public.estimate_versions
  add constraint estimate_versions_total_ttc_gte_total_ht_check
  check (
    total_ht_cents is null
    or total_ttc_cents is null
    or total_ttc_cents >= total_ht_cents
  );

alter table public.estimate_versions
  drop constraint if exists estimate_versions_total_tax_nonnegative_check;

alter table public.estimate_versions
  add constraint estimate_versions_total_tax_nonnegative_check
  check (
    total_tax_cents is null
    or total_tax_cents >= 0
  );

alter table public.estimate_versions
  drop constraint if exists estimate_versions_totals_consistent_check;

alter table public.estimate_versions
  add constraint estimate_versions_totals_consistent_check
  check (
    total_ht_cents is null
    or total_tax_cents is null
    or total_ttc_cents is null
    or total_ttc_cents = total_ht_cents + total_tax_cents
  );

alter table public.estimate_items
  drop constraint if exists estimate_items_line_total_ttc_gte_ht_check;

alter table public.estimate_items
  add constraint estimate_items_line_total_ttc_gte_ht_check
  check (
    line_total_ht_cents is null
    or line_total_ttc_cents is null
    or line_total_ttc_cents >= line_total_ht_cents
  );

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'invariant_violation'));

drop policy if exists "Server can insert invariant violation audit logs" on public.audit_logs;

create policy "Server can insert invariant violation audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    action = 'invariant_violation'
    and user_id = (select auth.uid())
    and table_name in ('estimate_versions', 'estimate_items')
    and estimate_version_id is not null
    and exists (
      select 1
      from public.estimate_versions ev
      join public.estimate_projects ep
        on ep.id = ev.project_id
       and ep.tenant_id = ev.tenant_id
      where ev.id = audit_logs.estimate_version_id
        and ev.tenant_id = audit_logs.tenant_id
        and (select public.is_tenant_member(ev.tenant_id))
        and (
          ep.user_id = (select auth.uid())
          or (select public.has_tenant_role(ev.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      (table_name = 'estimate_versions' and record_id = estimate_version_id)
      or (
        table_name = 'estimate_items'
        and exists (
          select 1
          from public.estimate_items ei
          where ei.id = audit_logs.record_id
            and ei.version_id = audit_logs.estimate_version_id
            and ei.tenant_id = audit_logs.tenant_id
        )
      )
    )
  );

-- EST-046: seal transitions and append-only estimate version events.

alter table public.estimate_versions
  add column if not exists seal_hash text;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_seal_hash_hex64_check;

alter table public.estimate_versions
  add constraint estimate_versions_seal_hash_hex64_check
  check (
    seal_hash is null
    or seal_hash ~ '^[0-9a-fA-F]{64}$'
  );

create or replace function public.validate_estimate_version_transition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    if not (
      (old.status = 'draft' and new.status = 'sent')
      or (old.status = 'sent' and new.status in ('accepted', 'archived'))
      or (old.status = 'accepted' and new.status = 'archived')
    ) then
      raise exception 'Invalid estimate status transition: % -> %', old.status, new.status;
    end if;
  end if;

  if old.status = 'draft' and new.status = 'sent' then
    if new.seal_hash is null or new.seal_hash !~ '^[0-9a-fA-F]{64}$' then
      raise exception 'seal_hash must be a 64-character hex string when moving draft -> sent';
    end if;
  elsif new.seal_hash is distinct from old.seal_hash then
    raise exception 'seal_hash is immutable except during draft -> sent transition';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_estimate_version_transition on public.estimate_versions;
create trigger validate_estimate_version_transition
  before update on public.estimate_versions
  for each row execute procedure public.validate_estimate_version_transition();

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
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
      or new.margin_mode is distinct from old.margin_mode
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
      or new.seal_hash is distinct from old.seal_hash
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.estimate_version_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  occurred_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  event_type text not null check (
    event_type in ('sent', 'accepted', 'archived', 'rejected', 'seal_verified')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists estimate_version_events_created_at_idx
  on public.estimate_version_events (created_at desc);
create index if not exists estimate_version_events_tenant_id_idx
  on public.estimate_version_events (tenant_id);
create index if not exists estimate_version_events_estimate_version_id_idx
  on public.estimate_version_events (estimate_version_id);
create index if not exists estimate_version_events_occurred_at_idx
  on public.estimate_version_events (occurred_at desc);
create index if not exists estimate_version_events_version_occurred_at_idx
  on public.estimate_version_events (estimate_version_id, occurred_at desc, created_at desc);

create or replace function public.assign_estimate_version_events_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_version_events_tenant_id on public.estimate_version_events;
create trigger set_estimate_version_events_tenant_id
  before insert on public.estimate_version_events
  for each row execute procedure public.assign_estimate_version_events_tenant_id();

create or replace function public.guard_estimate_version_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception
    using
      errcode = '42501',
      message = 'ESTIMATE_VERSION_EVENTS_APPEND_ONLY',
      detail = 'estimate_version_events is append-only and does not allow update/delete.';
end;
$$;

drop trigger if exists estimate_version_events_append_only_guard on public.estimate_version_events;
create trigger estimate_version_events_append_only_guard
  before update or delete on public.estimate_version_events
  for each row execute procedure public.guard_estimate_version_events_append_only();

create or replace function public.log_estimate_version_event(
  p_estimate_version_id uuid,
  p_event_type text,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.estimate_version_events
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
  inserted_row public.estimate_version_events;
begin
  if normalized_event_type = '' then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = 'event_type is required.';
  end if;

  if normalized_event_type not in ('sent', 'accepted', 'archived', 'rejected', 'seal_verified') then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = format('Unsupported event_type: %s', normalized_event_type);
  end if;

  select ev.tenant_id
    into target_tenant_id
  from public.estimate_versions ev
  where ev.id = p_estimate_version_id;

  if target_tenant_id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_VERSION_NOT_FOUND',
        detail = format('estimate_version_id=%s', p_estimate_version_id);
  end if;

  if p_created_by is not null
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
        and tm.user_id = p_created_by
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = p_created_by
        and profile.role = 'admin'
    ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_EVENT_ACTOR_NOT_ALLOWED',
        detail = format('created_by=%s is not allowed for tenant_id=%s', p_created_by, target_tenant_id);
  end if;

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  )
  values (
    target_tenant_id,
    p_estimate_version_id,
    normalized_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_created_by,
    coalesce(p_occurred_at, now())
  )
  returning *
  into inserted_row;

  return inserted_row;
end;
$$;

revoke all on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) from public;
revoke all on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) from authenticated;
grant execute on function public.log_estimate_version_event(uuid, text, uuid, jsonb, timestamptz) to service_role;

alter table public.estimate_version_events enable row level security;

drop policy if exists "Users can view estimate version events" on public.estimate_version_events;
drop policy if exists "Users can insert estimate version events" on public.estimate_version_events;
drop policy if exists "Tenant members can view estimate version events" on public.estimate_version_events;
drop policy if exists "Service role can insert estimate version events" on public.estimate_version_events;

create policy "Tenant members can view estimate version events"
  on public.estimate_version_events
  for select
  to authenticated
  using (
    tenant_id is not null
    and (
      (select public.is_tenant_member(tenant_id))
      or (select public.is_admin_user())
    )
  );

create policy "Service role can insert estimate version events"
  on public.estimate_version_events
  for insert
  to service_role
  with check (true);

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in ('INSERT', 'UPDATE', 'DELETE', 'invariant_violation', 'seal'));

create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
  target_tenant_id uuid;
  target_action text := tg_op;
begin
  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_new->>'estimate_version_id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_old->>'estimate_version_id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid,
    nullif(target_new->>'created_by', '')::uuid,
    nullif(target_old->>'created_by', '')::uuid
  );

  target_tenant_id := coalesce(
    nullif(target_new->>'tenant_id', '')::uuid,
    nullif(target_old->>'tenant_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_version_events' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_record_id;
    end if;
  end if;

  if target_tenant_id is null then
    if target_version_id is not null then
      select v.tenant_id
        into target_tenant_id
      from public.estimate_versions v
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.tenant_id
        into target_tenant_id
      from public.estimate_projects p
      where p.id = target_record_id;
    elsif target_row_user_id is not null then
      select tm.tenant_id
        into target_tenant_id
      from public.tenant_memberships tm
      where tm.user_id = target_row_user_id
      order by tm.is_default desc, tm.created_at asc
      limit 1;
    end if;
  end if;

  if tg_table_name = 'estimate_versions'
    and tg_op = 'UPDATE'
    and coalesce(target_old->>'status', '') = 'draft'
    and coalesce(target_new->>'status', '') = 'sent'
  then
    target_action := 'seal';
  end if;

  insert into public.audit_logs (
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    coalesce(target_tenant_id, public.current_tenant_id()),
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    target_action,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists estimate_version_events_audit_trigger on public.estimate_version_events;
create trigger estimate_version_events_audit_trigger
  after insert or update or delete on public.estimate_version_events
  for each row execute procedure public.log_estimate_audit();

alter table public.estimate_suggestion_rules
  add column if not exists usage_count integer not null default 0;

alter table public.estimate_suggestion_rules
  add column if not exists last_used_at timestamptz;

alter table public.estimate_suggestion_rules
  drop constraint if exists estimate_suggestion_rules_usage_count_check;

alter table public.estimate_suggestion_rules
  add constraint estimate_suggestion_rules_usage_count_check
  check (usage_count >= 0);

create index if not exists estimate_suggestion_rules_usage_count_idx
  on public.estimate_suggestion_rules (usage_count desc);

-- EST-101: bulk item update + version totals patch in one RPC transaction.

drop function if exists public.bulk_update_estimate_items(uuid, jsonb, jsonb);

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
  version_locked_count integer := 0;
  effective_version_patch jsonb := coalesce(version_patch, '{}'::jsonb);
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if expected_version_updated_at is null then
    raise exception 'expected_version_updated_at is required';
  end if;

  if version_patch is not null and jsonb_typeof(version_patch) <> 'object' then
    raise exception 'version_patch must be a JSON object';
  end if;

  if effective_version_patch - array['total_ht_cents', 'total_tax_cents', 'total_ttc_cents'] <> '{}'::jsonb then
    raise exception 'version_patch supports only total_ht_cents, total_tax_cents, total_ttc_cents';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
    and ev.updated_at = expected_version_updated_at
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  if expected_count > 0 then
    create temporary table _estimate_item_bulk_snapshot (
      id uuid primary key,
      parent_id uuid,
      item_position integer,
      title text,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      k_mo numeric(12,3),
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    ) on commit drop;

    insert into _estimate_item_bulk_snapshot (
      id,
      parent_id,
      item_position,
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
      snapshot.id,
      snapshot.parent_id,
      snapshot.item_position,
      snapshot.title,
      snapshot.description,
      snapshot.quantity,
      snapshot.unit_price_ht_cents,
      snapshot.tax_rate_bp,
      snapshot.k_fo,
      snapshot.h_mo,
      snapshot.k_mo,
      snapshot.pu_ht_cents,
      snapshot.labor_role_id,
      snapshot.category_id,
      snapshot.line_total_ht_cents,
      snapshot.line_tax_cents,
      snapshot.line_total_ttc_cents
    from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

    select count(*)
      into snapshot_count
    from _estimate_item_bulk_snapshot;

    if snapshot_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            snapshot_count
          );
    end if;

    perform item.id
    from public.estimate_items item
    join _estimate_item_bulk_snapshot snapshot
      on item.id = snapshot.id
      and item.version_id = target_version_id
    for update;

    get diagnostics locked_count = row_count;

    if locked_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,locked_count=%s',
            expected_count,
            locked_count
          );
    end if;

    update public.estimate_items item
    set position = -snapshot.item_position
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    update public.estimate_items item
    set
      parent_id = snapshot.parent_id,
      position = snapshot.item_position,
      title = snapshot.title,
      description = snapshot.description,
      quantity = snapshot.quantity,
      unit_price_ht_cents = snapshot.unit_price_ht_cents,
      tax_rate_bp = snapshot.tax_rate_bp,
      k_fo = snapshot.k_fo,
      h_mo = snapshot.h_mo,
      k_mo = snapshot.k_mo,
      pu_ht_cents = snapshot.pu_ht_cents,
      labor_role_id = snapshot.labor_role_id,
      category_id = snapshot.category_id,
      line_total_ht_cents = snapshot.line_total_ht_cents,
      line_tax_cents = snapshot.line_tax_cents,
      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    get diagnostics updated_count = row_count;

    if updated_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            updated_count
          );
    end if;
  end if;

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  update public.estimate_versions ev
  set
    updated_at = now(),
    total_ht_cents = case
      when effective_version_patch ? 'total_ht_cents'
        then (effective_version_patch->>'total_ht_cents')::integer
      else ev.total_ht_cents
    end,
    total_tax_cents = case
      when effective_version_patch ? 'total_tax_cents'
        then (effective_version_patch->>'total_tax_cents')::integer
      else ev.total_tax_cents
    end,
    total_ttc_cents = case
      when effective_version_patch ? 'total_ttc_cents'
        then (effective_version_patch->>'total_ttc_cents')::integer
      else ev.total_ttc_cents
    end
  where ev.id = target_version_id;

  return updated_count;
end;
$$;


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


-- EST-032: add h_mo_majoration and extend estimate item SQL functions.

alter table public.estimate_items
  add column if not exists h_mo_majoration numeric(12,4) default 1.0;

update public.estimate_items
set h_mo_majoration = 1.0
where h_mo_majoration is null
   or item_type = 'section';

alter table public.estimate_items
  alter column h_mo_majoration set default 1.0;

alter table public.estimate_items
  alter column h_mo_majoration set not null;

alter table public.estimate_items
  drop constraint if exists estimate_items_h_mo_majoration_nonnegative_check;

alter table public.estimate_items
  add constraint estimate_items_h_mo_majoration_nonnegative_check
  check (h_mo_majoration >= 0);

do $$
declare
  payload_constraint record;
begin
  for payload_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'estimate_items'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''section''%'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''line''%'
  loop
    execute format(
      'alter table public.estimate_items drop constraint if exists %I',
      payload_constraint.conname
    );
  end loop;
end;
$$;

alter table public.estimate_items
  drop constraint if exists estimate_items_item_type_payload_check;

alter table public.estimate_items
  add constraint estimate_items_item_type_payload_check
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  );

create or replace function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4),
  k_mo numeric(12,3),
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  supply_type_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'h_mo_majoration'
        then (requested.payload->>'h_mo_majoration')::numeric(12,4)
      else item.h_mo_majoration
    end as h_mo_majoration,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'supply_type_id'
        then nullif(requested.payload->>'supply_type_id', '')::uuid
      else item.supply_type_id
    end as supply_type_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

drop function if exists public.bulk_update_estimate_items(uuid, jsonb, jsonb);

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
  version_locked_count integer := 0;
  effective_version_patch jsonb := coalesce(version_patch, '{}'::jsonb);
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if expected_version_updated_at is null then
    raise exception 'expected_version_updated_at is required';
  end if;

  if version_patch is not null and jsonb_typeof(version_patch) <> 'object' then
    raise exception 'version_patch must be a JSON object';
  end if;

  if effective_version_patch - array['total_ht_cents', 'total_tax_cents', 'total_ttc_cents'] <> '{}'::jsonb then
    raise exception 'version_patch supports only total_ht_cents, total_tax_cents, total_ttc_cents';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
    and ev.updated_at = expected_version_updated_at
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  if expected_count > 0 then
    create temporary table _estimate_item_bulk_snapshot (
      id uuid primary key,
      parent_id uuid,
      item_position integer,
      title text,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      h_mo_majoration numeric(12,4),
      k_mo numeric(12,3),
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    ) on commit drop;

    insert into _estimate_item_bulk_snapshot (
      id,
      parent_id,
      item_position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      snapshot.id,
      snapshot.parent_id,
      snapshot.item_position,
      snapshot.title,
      snapshot.description,
      snapshot.quantity,
      snapshot.unit_price_ht_cents,
      snapshot.tax_rate_bp,
      snapshot.k_fo,
      snapshot.h_mo,
      snapshot.h_mo_majoration,
      snapshot.k_mo,
      snapshot.pu_ht_cents,
      snapshot.labor_role_id,
      snapshot.category_id,
      snapshot.supply_type_id,
      snapshot.line_total_ht_cents,
      snapshot.line_tax_cents,
      snapshot.line_total_ttc_cents
    from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

    select count(*)
      into snapshot_count
    from _estimate_item_bulk_snapshot;

    if snapshot_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            snapshot_count
          );
    end if;

    perform item.id
    from public.estimate_items item
    join _estimate_item_bulk_snapshot snapshot
      on item.id = snapshot.id
      and item.version_id = target_version_id
    for update;

    get diagnostics locked_count = row_count;

    if locked_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,locked_count=%s',
            expected_count,
            locked_count
          );
    end if;

    update public.estimate_items item
    set position = -snapshot.item_position
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    update public.estimate_items item
    set
      parent_id = snapshot.parent_id,
      position = snapshot.item_position,
      title = snapshot.title,
      description = snapshot.description,
      quantity = snapshot.quantity,
      unit_price_ht_cents = snapshot.unit_price_ht_cents,
      tax_rate_bp = snapshot.tax_rate_bp,
      k_fo = snapshot.k_fo,
      h_mo = snapshot.h_mo,
      h_mo_majoration = snapshot.h_mo_majoration,
      k_mo = snapshot.k_mo,
      pu_ht_cents = snapshot.pu_ht_cents,
      labor_role_id = snapshot.labor_role_id,
      category_id = snapshot.category_id,
      supply_type_id = snapshot.supply_type_id,
      line_total_ht_cents = snapshot.line_total_ht_cents,
      line_tax_cents = snapshot.line_tax_cents,
      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    get diagnostics updated_count = row_count;

    if updated_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            updated_count
          );
    end if;
  end if;

  if effective_version_patch <> '{}'::jsonb then
    update public.estimate_versions ev
    set
      total_ht_cents = case
        when effective_version_patch ? 'total_ht_cents'
          then (effective_version_patch->>'total_ht_cents')::integer
        else ev.total_ht_cents
      end,
      total_tax_cents = case
        when effective_version_patch ? 'total_tax_cents'
          then (effective_version_patch->>'total_tax_cents')::integer
        else ev.total_tax_cents
      end,
      total_ttc_cents = case
        when effective_version_patch ? 'total_ttc_cents'
          then (effective_version_patch->>'total_ttc_cents')::integer
        else ev.total_ttc_cents
      end
    where ev.id = target_version_id;
  end if;

  return updated_count;
end;
$$;

create or replace function public.duplicate_estimate_version(source_version_id uuid)
returns uuid
language plpgsql
set search_path = public
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
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  insert into public.estimate_versions (
    id,
    tenant_id,
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
    source_version.tenant_id,
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
    tenant_id,
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
    h_mo_majoration,
    k_mo,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  return new_version_id;
end;
$$;


-- EST-181: estimate templates and instantiation RPCs.


create table if not exists public.estimate_templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  source_version_id uuid references public.estimate_versions(id) on delete set null,
  name text not null,
  description text,
  margin_multiplier numeric not null default 1 check (margin_multiplier >= 0),
  margin_mode public.estimate_margin_mode not null default 'fixed',
  currency text not null default 'EUR',
  margin_bp integer not null default 0 check (margin_bp >= 0),
  discount_bp integer not null default 0 check (discount_bp >= 0),
  tax_rate_bp integer not null default 2000 check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  rounding_mode public.estimate_rounding_mode not null default 'none',
  rounding_step_cents integer not null default 1 check (rounding_step_cents >= 1),
  validite_jours integer not null default 30 check (validite_jours >= 1),
  unique (tenant_id, created_by, name)
);

create table if not exists public.estimate_template_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  template_id uuid not null references public.estimate_templates(id) on delete cascade,
  parent_id uuid references public.estimate_template_items(id) on delete cascade deferrable initially deferred,
  item_type public.estimate_item_type not null,
  position integer not null default 0,
  title text not null,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4) not null default 1.0,
  k_mo numeric(12,3),
  h_mo_atelier numeric(12,3),
  k_mo_atelier numeric(12,3) default 1.0,
  labor_role_atelier_id uuid references public.labor_roles(id) on delete set null,
  h_mo_chantier numeric(12,3),
  k_mo_chantier numeric(12,3) default 1.0,
  labor_role_chantier_id uuid references public.labor_roles(id) on delete set null,
  pu_ht_cents integer,
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  category_id uuid references public.estimate_categories(id) on delete set null,
  supply_type_id uuid references public.supply_types(id) on delete set null,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer,
  check (quantity is null or quantity >= 0),
  check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
  check (tax_rate_bp is null or (tax_rate_bp >= 0 and tax_rate_bp <= 10000)),
  check (k_fo is null or k_fo >= 0),
  check (h_mo is null or h_mo >= 0),
  check (h_mo_majoration >= 0),
  check (k_mo is null or k_mo >= 0),
  check (h_mo_atelier is null or h_mo_atelier >= 0),
  check (k_mo_atelier is null or k_mo_atelier >= 0),
  check (h_mo_chantier is null or h_mo_chantier >= 0),
  check (k_mo_chantier is null or k_mo_chantier >= 0),
  check (pu_ht_cents is null or pu_ht_cents >= 0),
  check (line_total_ht_cents is null or line_total_ht_cents >= 0),
  check (line_tax_cents is null or line_tax_cents >= 0),
  check (line_total_ttc_cents is null or line_total_ttc_cents >= 0),
  check (
    line_total_ht_cents is null
    or line_total_ttc_cents is null
    or line_total_ttc_cents >= line_total_ht_cents
  ),
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and h_mo_atelier is null
      and k_mo_atelier = 1.0
      and labor_role_atelier_id is null
      and h_mo_chantier is null
      and k_mo_chantier = 1.0
      and labor_role_chantier_id is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  )
);

drop trigger if exists set_estimate_templates_updated_at on public.estimate_templates;
create trigger set_estimate_templates_updated_at
  before update on public.estimate_templates
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_template_items_updated_at on public.estimate_template_items;
create trigger set_estimate_template_items_updated_at
  before update on public.estimate_template_items
  for each row execute procedure public.set_updated_at();

create index if not exists estimate_templates_tenant_created_at_idx
  on public.estimate_templates (tenant_id, created_at desc);
create index if not exists estimate_templates_source_version_id_idx
  on public.estimate_templates (source_version_id);
create index if not exists estimate_template_items_tenant_id_idx
  on public.estimate_template_items (tenant_id);
create index if not exists estimate_template_items_template_id_idx
  on public.estimate_template_items (template_id);
create index if not exists estimate_template_items_parent_id_idx
  on public.estimate_template_items (parent_id);
create index if not exists estimate_template_items_category_id_idx
  on public.estimate_template_items (category_id);
create index if not exists estimate_template_items_labor_role_id_idx
  on public.estimate_template_items (labor_role_id);
create unique index if not exists estimate_template_items_root_position_unique
  on public.estimate_template_items (template_id, position)
  where parent_id is null;
create unique index if not exists estimate_template_items_child_position_unique
  on public.estimate_template_items (parent_id, position)
  where parent_id is not null;

create or replace function public.assign_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_table_name = 'purchase_order_items' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'purchase_order_devis' then
    select po.tenant_id
      into parent_tenant_id
    from public.purchase_orders po
    where po.id = new.purchase_order_id;
  elsif tg_table_name = 'estimate_versions' then
    select ep.tenant_id
      into parent_tenant_id
    from public.estimate_projects ep
    where ep.id = new.project_id;
  elsif tg_table_name = 'estimate_items' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  elsif tg_table_name = 'estimate_templates' and new.tenant_id is null then
    parent_tenant_id := public.current_tenant_id();
  elsif tg_table_name = 'estimate_template_items' then
    select et.tenant_id
      into parent_tenant_id
    from public.estimate_templates et
    where et.id = new.template_id;
  elsif tg_table_name = 'audit_logs' then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = nullif(to_jsonb(new)->>'estimate_version_id', '')::uuid;
  elsif tg_table_name = 'dpgf_rows_raw' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  elsif tg_table_name = 'dpgf_rows_mapped' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;

    if parent_tenant_id is null and new.raw_row_id is not null then
      select drr.tenant_id
        into parent_tenant_id
      from public.dpgf_rows_raw drr
      where drr.id = new.raw_row_id;
    end if;
  elsif tg_table_name = 'dpgf_mappings' then
    select di.tenant_id
      into parent_tenant_id
    from public.dpgf_imports di
    where di.id = new.import_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_templates_tenant_id on public.estimate_templates;
create trigger set_estimate_templates_tenant_id
  before insert or update on public.estimate_templates
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists set_estimate_template_items_tenant_id on public.estimate_template_items;
create trigger set_estimate_template_items_tenant_id
  before insert or update on public.estimate_template_items
  for each row execute procedure public.assign_tenant_id();

alter table public.estimate_templates enable row level security;
alter table public.estimate_template_items enable row level security;

drop policy if exists "Users can manage estimate templates" on public.estimate_templates;
drop policy if exists "Users can view estimate template items" on public.estimate_template_items;
drop policy if exists "Users can insert estimate template items" on public.estimate_template_items;
drop policy if exists "Users can update estimate template items" on public.estimate_template_items;
drop policy if exists "Users can delete estimate template items" on public.estimate_template_items;

create policy "Users can manage estimate templates"
  on public.estimate_templates
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      created_by = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      created_by = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );

create policy "Users can view estimate template items"
  on public.estimate_template_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert estimate template items"
  on public.estimate_template_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      estimate_template_items.parent_id is null
      or exists (
        select 1
        from public.estimate_template_items p
        where p.id = estimate_template_items.parent_id
          and p.template_id = estimate_template_items.template_id
          and p.tenant_id = estimate_template_items.tenant_id
      )
    )
  );

create policy "Users can update estimate template items"
  on public.estimate_template_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    and (
      estimate_template_items.parent_id is null
      or exists (
        select 1
        from public.estimate_template_items p
        where p.id = estimate_template_items.parent_id
          and p.template_id = estimate_template_items.template_id
          and p.tenant_id = estimate_template_items.tenant_id
      )
    )
  );

create policy "Users can delete estimate template items"
  on public.estimate_template_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_templates t
      where t.id = estimate_template_items.template_id
        and t.tenant_id = estimate_template_items.tenant_id
        and (select public.is_tenant_member(t.tenant_id))
        and (
          t.created_by = (select auth.uid())
          or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create or replace function public.create_estimate_template_from_version(
  p_source_version_id uuid,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  source_owner_id uuid;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select v.*, p.user_id
    into source_version, source_owner_id
  from public.estimate_versions v
  join public.estimate_projects p
    on p.id = v.project_id
   and p.tenant_id = v.tenant_id
  where v.id = p_source_version_id
    and (select public.is_tenant_member(v.tenant_id))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template source version not found or access denied';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_version.tenant_id,
    current_user_id,
    source_version.id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.validite_jours
  );

  create temporary table _estimate_template_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = p_source_version_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_template_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id;

  return new_template_id;
end;
$$;

create or replace function public.duplicate_estimate_template(
  p_template_id uuid,
  p_name text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
  duplicate_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  duplicate_name := nullif(btrim(coalesce(p_name, '')), '');
  if duplicate_name is null then
    duplicate_name := source_template.name || ' (copie)';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_template.tenant_id,
    current_user_id,
    source_template.source_version_id,
    duplicate_name,
    source_template.description,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    source_template.validite_jours
  );

  create temporary table _estimate_template_duplicate_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_duplicate_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
    new_template_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_duplicate_map map on map.old_id = src.id
  left join _estimate_template_duplicate_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return new_template_id;
end;
$$;

create or replace function public.instantiate_estimate_from_template(
  p_template_id uuid,
  p_project_name text,
  p_version_title text,
  p_date_devis date,
  p_validite_jours integer
)
returns table (project_id uuid, version_id uuid)
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_project_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
  target_validite_jours integer;
  total_ht integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_project_name, '')), '') is null then
    raise exception 'Project name is required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  target_validite_jours := coalesce(p_validite_jours, source_template.validite_jours);
  if target_validite_jours <= 0 then
    raise exception 'validite_jours must be greater than 0';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0)
    into total_ht, total_tax
  from public.estimate_template_items item
  where item.template_id = p_template_id
    and item.tenant_id = source_template.tenant_id
    and item.item_type = 'line';

  total_ttc := total_ht + total_tax;

  insert into public.estimate_projects (
    id,
    tenant_id,
    user_id,
    name
  )
  values (
    new_project_id,
    source_template.tenant_id,
    current_user_id,
    btrim(p_project_name)
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
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
    source_template.tenant_id,
    new_project_id,
    1,
    'draft',
    nullif(btrim(coalesce(p_version_title, '')), ''),
    coalesce(p_date_devis, current_date),
    target_validite_jours,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    total_ht,
    total_tax,
    total_ttc
  );

  create temporary table _estimate_template_instantiation_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_instantiation_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_items (
    id,
    tenant_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_instantiation_map map on map.old_id = src.id
  left join _estimate_template_instantiation_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return query
  select new_project_id, new_version_id;
end;
$$;
-- EST-164: catalogue suggestions (selected supplier persistence + configurable stale threshold).

alter table if exists public.feature_flags
  add column if not exists value text;

alter table if exists public.estimate_items
  add column if not exists selected_supplier_price_id uuid references public.supplier_pricebook(id) on delete set null;

create index if not exists estimate_items_selected_supplier_price_id_idx
  on public.estimate_items (selected_supplier_price_id);

do $$
declare
  payload_constraint record;
begin
  for payload_constraint in
    select c.conname
    from pg_constraint c
    join pg_class t
      on t.oid = c.conrelid
    join pg_namespace n
      on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'estimate_items'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''section''%'
      and pg_get_constraintdef(c.oid) ilike '%item_type = ''line''%'
  loop
    execute format(
      'alter table public.estimate_items drop constraint if exists %I',
      payload_constraint.conname
    );
  end loop;
end;
$$;

alter table public.estimate_items
  drop constraint if exists estimate_items_item_type_payload_check;

alter table public.estimate_items
  add constraint estimate_items_item_type_payload_check
  check (
    (
      item_type = 'section'
      and quantity is null
      and unit_price_ht_cents is null
      and tax_rate_bp is null
      and k_fo is null
      and h_mo is null
      and h_mo_majoration = 1.0
      and k_mo is null
      and pu_ht_cents is null
      and labor_role_id is null
      and category_id is null
      and supply_type_id is null
      and selected_supplier_price_id is null
      and line_total_ht_cents is null
      and line_tax_cents is null
      and line_total_ttc_cents is null
    )
    or
    (
      item_type = 'line'
      and quantity is not null
      and unit_price_ht_cents is not null
      and tax_rate_bp is not null
      and k_fo is not null
      and h_mo is not null
      and h_mo_majoration is not null
      and k_mo is not null
      and pu_ht_cents is not null
      and line_total_ht_cents is not null
      and line_tax_cents is not null
      and line_total_ttc_cents is not null
    )
  );

create or replace function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4),
  k_mo numeric(12,3),
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  supply_type_id uuid,
  selected_supplier_price_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'h_mo_majoration'
        then (requested.payload->>'h_mo_majoration')::numeric(12,4)
      else item.h_mo_majoration
    end as h_mo_majoration,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'supply_type_id'
        then nullif(requested.payload->>'supply_type_id', '')::uuid
      else item.supply_type_id
    end as supply_type_id,
    case
      when requested.payload ? 'selected_supplier_price_id'
        then nullif(requested.payload->>'selected_supplier_price_id', '')::uuid
      else item.selected_supplier_price_id
    end as selected_supplier_price_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

drop function if exists public.bulk_update_estimate_items(uuid, jsonb, jsonb);

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
  version_locked_count integer := 0;
  effective_version_patch jsonb := coalesce(version_patch, '{}'::jsonb);
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if expected_version_updated_at is null then
    raise exception 'expected_version_updated_at is required';
  end if;

  if version_patch is not null and jsonb_typeof(version_patch) <> 'object' then
    raise exception 'version_patch must be a JSON object';
  end if;

  if effective_version_patch - array['total_ht_cents', 'total_tax_cents', 'total_ttc_cents'] <> '{}'::jsonb then
    raise exception 'version_patch supports only total_ht_cents, total_tax_cents, total_ttc_cents';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
    and ev.updated_at = expected_version_updated_at
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  if expected_count > 0 then
    create temporary table _estimate_item_bulk_snapshot (
      id uuid primary key,
      parent_id uuid,
      item_position integer,
      title text,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      h_mo_majoration numeric(12,4),
      k_mo numeric(12,3),
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    ) on commit drop;

    insert into _estimate_item_bulk_snapshot (
      id,
      parent_id,
      item_position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      snapshot.id,
      snapshot.parent_id,
      snapshot.item_position,
      snapshot.title,
      snapshot.description,
      snapshot.quantity,
      snapshot.unit_price_ht_cents,
      snapshot.tax_rate_bp,
      snapshot.k_fo,
      snapshot.h_mo,
      snapshot.h_mo_majoration,
      snapshot.k_mo,
      snapshot.pu_ht_cents,
      snapshot.labor_role_id,
      snapshot.category_id,
      snapshot.supply_type_id,
      snapshot.selected_supplier_price_id,
      snapshot.line_total_ht_cents,
      snapshot.line_tax_cents,
      snapshot.line_total_ttc_cents
    from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

    select count(*)
      into snapshot_count
    from _estimate_item_bulk_snapshot;

    if snapshot_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            snapshot_count
          );
    end if;

    perform item.id
    from public.estimate_items item
    join _estimate_item_bulk_snapshot snapshot
      on item.id = snapshot.id
      and item.version_id = target_version_id
    for update;

    get diagnostics locked_count = row_count;

    if locked_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,locked_count=%s',
            expected_count,
            locked_count
          );
    end if;

    update public.estimate_items item
    set position = -snapshot.item_position
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    update public.estimate_items item
    set
      parent_id = snapshot.parent_id,
      position = snapshot.item_position,
      title = snapshot.title,
      description = snapshot.description,
      quantity = snapshot.quantity,
      unit_price_ht_cents = snapshot.unit_price_ht_cents,
      tax_rate_bp = snapshot.tax_rate_bp,
      k_fo = snapshot.k_fo,
      h_mo = snapshot.h_mo,
      h_mo_majoration = snapshot.h_mo_majoration,
      k_mo = snapshot.k_mo,
      pu_ht_cents = snapshot.pu_ht_cents,
      labor_role_id = snapshot.labor_role_id,
      category_id = snapshot.category_id,
      supply_type_id = snapshot.supply_type_id,
      selected_supplier_price_id = snapshot.selected_supplier_price_id,
      line_total_ht_cents = snapshot.line_total_ht_cents,
      line_tax_cents = snapshot.line_tax_cents,
      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    get diagnostics updated_count = row_count;

    if updated_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            updated_count
          );
    end if;
  end if;

  if effective_version_patch <> '{}'::jsonb then
    update public.estimate_versions ev
    set
      total_ht_cents = case
        when effective_version_patch ? 'total_ht_cents'
          then (effective_version_patch->>'total_ht_cents')::integer
        else ev.total_ht_cents
      end,
      total_tax_cents = case
        when effective_version_patch ? 'total_tax_cents'
          then (effective_version_patch->>'total_tax_cents')::integer
        else ev.total_tax_cents
      end,
      total_ttc_cents = case
        when effective_version_patch ? 'total_ttc_cents'
          then (effective_version_patch->>'total_ttc_cents')::integer
        else ev.total_ttc_cents
      end
    where ev.id = target_version_id;
  end if;

  return updated_count;
end;
$$;


-- EST-025: add cascade discount mode/steps and global coefficient on estimates.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'estimate_discount_mode'
  ) then
    create type public.estimate_discount_mode as enum ('simple', 'cascade');
  end if;
end;
$$;

alter table public.estimate_versions
  add column if not exists discount_mode public.estimate_discount_mode not null default 'simple',
  add column if not exists discount_steps integer[] not null default '{}',
  add column if not exists global_coefficient numeric not null default 1;

alter table public.estimate_templates
  add column if not exists discount_mode public.estimate_discount_mode not null default 'simple',
  add column if not exists discount_steps integer[] not null default '{}',
  add column if not exists global_coefficient numeric not null default 1;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_discount_mode_steps_check;
alter table public.estimate_versions
  add constraint estimate_versions_discount_mode_steps_check
  check (discount_mode <> 'simple' or cardinality(discount_steps) = 0);

alter table public.estimate_versions
  drop constraint if exists estimate_versions_global_coefficient_nonnegative_check;
alter table public.estimate_versions
  add constraint estimate_versions_global_coefficient_nonnegative_check
  check (global_coefficient >= 0);

alter table public.estimate_templates
  drop constraint if exists estimate_templates_discount_mode_steps_check;
alter table public.estimate_templates
  add constraint estimate_templates_discount_mode_steps_check
  check (discount_mode <> 'simple' or cardinality(discount_steps) = 0);

alter table public.estimate_templates
  drop constraint if exists estimate_templates_global_coefficient_nonnegative_check;
alter table public.estimate_templates
  add constraint estimate_templates_global_coefficient_nonnegative_check
  check (global_coefficient >= 0);

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
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
      or new.margin_mode is distinct from old.margin_mode
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.discount_mode is distinct from old.discount_mode
      or new.discount_steps is distinct from old.discount_steps
      or new.global_coefficient is distinct from old.global_coefficient
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
      or new.seal_hash is distinct from old.seal_hash
      or new.parent_version_id is distinct from old.parent_version_id
      or new.variant_label is distinct from old.variant_label
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  new_version_id uuid := gen_random_uuid();
  new_version_number integer;
  variant_parent_id uuid := null;
  next_variant_index integer := 0;
  next_variant_label text := null;
begin
  select v.*
    into source_version
  from public.estimate_versions v
  join public.estimate_projects p on p.id = v.project_id
  where v.id = source_version_id
    and (select public.is_tenant_member(p.tenant_id))
    and (
      p.user_id = (select auth.uid())
      or (select public.has_tenant_role(p.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Estimate version not found or access denied';
  end if;

  select coalesce(max(version_number), 0) + 1
    into new_version_number
  from public.estimate_versions
  where project_id = source_version.project_id;

  if coalesce(as_variant, false) then
    variant_parent_id := source_version_id;

    loop
      next_variant_index := next_variant_index + 1;
      next_variant_label := public.estimate_variant_label_from_index(next_variant_index);

      exit when not exists (
        select 1
        from public.estimate_versions existing_variant
        where existing_variant.parent_version_id = variant_parent_id
          and existing_variant.variant_label = next_variant_label
      );
    end loop;
  end if;

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents,
    parent_version_id,
    variant_label
  )
  values (
    new_version_id,
    source_version.tenant_id,
    source_version.project_id,
    new_version_number,
    'draft',
    source_version.title,
    source_version.date_devis,
    source_version.validite_jours,
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.total_ht_cents,
    source_version.total_tax_cents,
    source_version.total_ttc_cents,
    variant_parent_id,
    next_variant_label
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
    tenant_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    selected_supplier_price_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.selected_supplier_price_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_item_map map on map.old_id = src.id
  left join _estimate_item_map parent_map on parent_map.old_id = src.parent_id;

  return new_version_id;
end;
$$;

create or replace function public.create_estimate_template_from_version(
  p_source_version_id uuid,
  p_name text,
  p_description text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_version public.estimate_versions%rowtype;
  source_owner_id uuid;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'Template name is required';
  end if;

  select v.*, p.user_id
    into source_version, source_owner_id
  from public.estimate_versions v
  join public.estimate_projects p
    on p.id = v.project_id
   and p.tenant_id = v.tenant_id
  where v.id = p_source_version_id
    and (select public.is_tenant_member(v.tenant_id))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template source version not found or access denied';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_version.tenant_id,
    current_user_id,
    source_version.id,
    btrim(p_name),
    nullif(btrim(coalesce(p_description, '')), ''),
    source_version.margin_multiplier,
    source_version.margin_mode,
    source_version.currency,
    source_version.margin_bp,
    source_version.discount_bp,
    source_version.discount_mode,
    source_version.discount_steps,
    source_version.global_coefficient,
    source_version.tax_rate_bp,
    source_version.rounding_mode,
    source_version.rounding_step_cents,
    source_version.validite_jours
  );

  create temporary table _estimate_template_item_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_item_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_items
  where version_id = p_source_version_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_version.tenant_id,
    new_template_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_items src
  join _estimate_template_item_map map on map.old_id = src.id
  left join _estimate_template_item_map parent_map on parent_map.old_id = src.parent_id
  where src.version_id = p_source_version_id;

  return new_template_id;
end;
$$;

create or replace function public.duplicate_estimate_template(
  p_template_id uuid,
  p_name text
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_template_id uuid := gen_random_uuid();
  duplicate_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  duplicate_name := nullif(btrim(coalesce(p_name, '')), '');
  if duplicate_name is null then
    duplicate_name := source_template.name || ' (copie)';
  end if;

  insert into public.estimate_templates (
    id,
    tenant_id,
    created_by,
    source_version_id,
    name,
    description,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    validite_jours
  )
  values (
    new_template_id,
    source_template.tenant_id,
    current_user_id,
    source_template.source_version_id,
    duplicate_name,
    source_template.description,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    source_template.validite_jours
  );

  create temporary table _estimate_template_duplicate_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_duplicate_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_template_items (
    id,
    tenant_id,
    template_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
    new_template_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_duplicate_map map on map.old_id = src.id
  left join _estimate_template_duplicate_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return new_template_id;
end;
$$;

create or replace function public.instantiate_estimate_from_template(
  p_template_id uuid,
  p_project_name text,
  p_version_title text,
  p_date_devis date,
  p_validite_jours integer
)
returns table (project_id uuid, version_id uuid)
language plpgsql
set search_path = public
as $$
declare
  source_template public.estimate_templates%rowtype;
  current_user_id uuid := (select auth.uid());
  new_project_id uuid := gen_random_uuid();
  new_version_id uuid := gen_random_uuid();
  target_validite_jours integer;
  total_ht integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if nullif(btrim(coalesce(p_project_name, '')), '') is null then
    raise exception 'Project name is required';
  end if;

  select t.*
    into source_template
  from public.estimate_templates t
  where t.id = p_template_id
    and (select public.is_tenant_member(t.tenant_id))
    and (
      t.created_by = current_user_id
      or (select public.has_tenant_role(t.tenant_id, array['admin'::public.tenant_role]))
    );

  if not found then
    raise exception 'Template not found or access denied';
  end if;

  target_validite_jours := coalesce(p_validite_jours, source_template.validite_jours);
  if target_validite_jours <= 0 then
    raise exception 'validite_jours must be greater than 0';
  end if;

  select
    coalesce(sum(item.line_total_ht_cents), 0),
    coalesce(sum(item.line_tax_cents), 0)
    into total_ht, total_tax
  from public.estimate_template_items item
  where item.template_id = p_template_id
    and item.tenant_id = source_template.tenant_id
    and item.item_type = 'line';

  total_ttc := total_ht + total_tax;

  insert into public.estimate_projects (
    id,
    tenant_id,
    user_id,
    name
  )
  values (
    new_project_id,
    source_template.tenant_id,
    current_user_id,
    btrim(p_project_name)
  );

  insert into public.estimate_versions (
    id,
    tenant_id,
    project_id,
    version_number,
    status,
    title,
    date_devis,
    validite_jours,
    margin_multiplier,
    margin_mode,
    currency,
    margin_bp,
    discount_bp,
    discount_mode,
    discount_steps,
    global_coefficient,
    tax_rate_bp,
    rounding_mode,
    rounding_step_cents,
    total_ht_cents,
    total_tax_cents,
    total_ttc_cents
  )
  values (
    new_version_id,
    source_template.tenant_id,
    new_project_id,
    1,
    'draft',
    nullif(btrim(coalesce(p_version_title, '')), ''),
    coalesce(p_date_devis, current_date),
    target_validite_jours,
    source_template.margin_multiplier,
    source_template.margin_mode,
    source_template.currency,
    source_template.margin_bp,
    source_template.discount_bp,
    source_template.discount_mode,
    source_template.discount_steps,
    source_template.global_coefficient,
    source_template.tax_rate_bp,
    source_template.rounding_mode,
    source_template.rounding_step_cents,
    total_ht,
    total_tax,
    total_ttc
  );

  create temporary table _estimate_template_instantiation_map (
    old_id uuid primary key,
    new_id uuid not null
  ) on commit drop;

  insert into _estimate_template_instantiation_map (old_id, new_id)
  select id, gen_random_uuid()
  from public.estimate_template_items
  where template_id = p_template_id;

  insert into public.estimate_items (
    id,
    tenant_id,
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
    h_mo_majoration,
    k_mo,
    h_mo_atelier,
    k_mo_atelier,
    labor_role_atelier_id,
    h_mo_chantier,
    k_mo_chantier,
    labor_role_chantier_id,
    pu_ht_cents,
    labor_role_id,
    category_id,
    supply_type_id,
    line_total_ht_cents,
    line_tax_cents,
    line_total_ttc_cents
  )
  select
    map.new_id,
    source_template.tenant_id,
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
    src.h_mo_majoration,
    src.k_mo,
    src.h_mo_atelier,
    src.k_mo_atelier,
    src.labor_role_atelier_id,
    src.h_mo_chantier,
    src.k_mo_chantier,
    src.labor_role_chantier_id,
    src.pu_ht_cents,
    src.labor_role_id,
    src.category_id,
    src.supply_type_id,
    src.line_total_ht_cents,
    src.line_tax_cents,
    src.line_total_ttc_cents
  from public.estimate_template_items src
  join _estimate_template_instantiation_map map on map.old_id = src.id
  left join _estimate_template_instantiation_map parent_map on parent_map.old_id = src.parent_id
  where src.template_id = p_template_id;

  return query
  select new_project_id, new_version_id;
end;
$$;

-- EST-122: move estimate item across parents with atomic dual reordering.

create or replace function public.move_estimate_item(
  target_version_id uuid,
  target_item_id uuid,
  source_parent_id uuid,
  target_parent_id uuid,
  ordered_source_item_ids uuid[],
  ordered_target_item_ids uuid[]
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_item public.estimate_items%rowtype;
  source_parent_item public.estimate_items%rowtype;
  target_parent_item public.estimate_items%rowtype;
  source_expected_count integer := 0;
  target_expected_count integer := 0;
  source_locked_count integer := 0;
  target_locked_count integer := 0;
  source_updated_count integer := 0;
  target_updated_count integer := 0;
  target_position integer := 0;
begin
  if target_version_id is null then
    raise exception 'target_version_id is required';
  end if;

  if target_item_id is null then
    raise exception 'target_item_id is required';
  end if;

  if ordered_source_item_ids is null then
    raise exception 'ordered_source_item_ids is required';
  end if;

  if ordered_target_item_ids is null then
    raise exception 'ordered_target_item_ids is required';
  end if;

  if source_parent_id is not distinct from target_parent_id then
    raise exception 'source_parent_id and target_parent_id must be different';
  end if;

  if coalesce(array_length(ordered_target_item_ids, 1), 0) = 0 then
    raise exception 'ordered_target_item_ids cannot be empty';
  end if;

  select *
    into target_version
  from public.estimate_versions ev
  where ev.id = target_version_id
  for update;

  if not found then
    raise exception 'target_version_id is invalid';
  end if;

  select *
    into target_item
  from public.estimate_items item
  where item.id = target_item_id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
  for update;

  if not found then
    raise exception 'target_item_id is invalid for target_version_id';
  end if;

  if target_item.parent_id is distinct from source_parent_id then
    raise exception 'source_parent_id mismatch for target_item_id';
  end if;

  if source_parent_id is not null then
    select *
      into source_parent_item
    from public.estimate_items parent
    where parent.id = source_parent_id
      and parent.version_id = target_version_id
      and parent.tenant_id = target_version.tenant_id
      and parent.item_type = 'section'
    for update;

    if not found then
      raise exception 'source_parent_id is invalid for target_version_id';
    end if;
  end if;

  if target_parent_id is not null then
    select *
      into target_parent_item
    from public.estimate_items parent
    where parent.id = target_parent_id
      and parent.version_id = target_version_id
      and parent.tenant_id = target_version.tenant_id
      and parent.item_type = 'section'
    for update;

    if not found then
      raise exception 'target_parent_id is invalid for target_version_id';
    end if;
  end if;

  if target_item.item_type = 'section' then
    if target_parent_id is not null and target_parent_item.parent_id is not null then
      raise exception 'section target_parent_id must reference a root section';
    end if;

    if target_parent_id is not null and exists (
      select 1
      from public.estimate_items section_child
      where section_child.version_id = target_version_id
        and section_child.tenant_id = target_version.tenant_id
        and section_child.parent_id = target_item_id
        and section_child.item_type = 'section'
    ) then
      raise exception 'section with subsections cannot become a subsection';
    end if;
  end if;

  if target_item.item_type = 'line'
     and target_parent_id is not null
     and target_parent_item.parent_id is not null then
    if not exists (
      select 1
      from public.estimate_items parent_section
      where parent_section.id = target_parent_item.parent_id
        and parent_section.version_id = target_version_id
        and parent_section.tenant_id = target_version.tenant_id
        and parent_section.item_type = 'section'
        and parent_section.parent_id is null
    ) then
      raise exception 'line target_parent_id exceeds maximum depth';
    end if;
  end if;

  create temporary table _move_source_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into _move_source_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_source_item_ids) with ordinality as src(id, ordinality);

  get diagnostics source_expected_count = row_count;

  if source_expected_count <> coalesce(array_length(ordered_source_item_ids, 1), 0) then
    raise exception 'ordered_source_item_ids contains duplicates';
  end if;

  if exists (
    select 1
    from _move_source_order source_order
    where source_order.id = target_item_id
  ) then
    raise exception 'ordered_source_item_ids must not contain target_item_id';
  end if;

  create temporary table _move_target_order (
    id uuid primary key,
    position integer not null
  ) on commit drop;

  insert into _move_target_order (id, position)
  select src.id, src.ordinality::integer as position
  from unnest(ordered_target_item_ids) with ordinality as src(id, ordinality);

  get diagnostics target_expected_count = row_count;

  if target_expected_count <> coalesce(array_length(ordered_target_item_ids, 1), 0) then
    raise exception 'ordered_target_item_ids contains duplicates';
  end if;

  if not exists (
    select 1
    from _move_target_order target_order
    where target_order.id = target_item_id
  ) then
    raise exception 'ordered_target_item_ids must contain target_item_id';
  end if;

  if exists (
    select 1
    from _move_source_order source_order
    join _move_target_order target_order
      on target_order.id = source_order.id
  ) then
    raise exception 'ordered_source_item_ids and ordered_target_item_ids overlap';
  end if;

  perform item.id
  from public.estimate_items item
  where item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id
  for update;

  get diagnostics source_locked_count = row_count;

  if source_locked_count <> source_expected_count then
    raise exception 'ordered_source_item_ids count mismatch';
  end if;

  perform item.id
  from public.estimate_items item
  where item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from target_parent_id
    and item.id <> target_item_id
  for update;

  get diagnostics target_locked_count = row_count;

  if target_locked_count + 1 <> target_expected_count then
    raise exception 'ordered_target_item_ids count mismatch';
  end if;

  if exists (
    select 1
    from _move_source_order source_order
    left join public.estimate_items item
      on item.id = source_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
    where item.id is null
  ) then
    raise exception 'ordered_source_item_ids contains invalid source ids';
  end if;

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from source_parent_id
      and item.id <> target_item_id
      and not exists (
        select 1
        from _move_source_order source_order
        where source_order.id = item.id
      )
  ) then
    raise exception 'ordered_source_item_ids is missing source ids';
  end if;

  if exists (
    select 1
    from _move_target_order target_order
    left join public.estimate_items item
      on item.id = target_order.id
      and item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and (
        item.id = target_item_id
        or (
          item.parent_id is not distinct from target_parent_id
          and item.id <> target_item_id
        )
      )
    where item.id is null
  ) then
    raise exception 'ordered_target_item_ids contains invalid target ids';
  end if;

  if exists (
    select 1
    from public.estimate_items item
    where item.version_id = target_version_id
      and item.tenant_id = target_version.tenant_id
      and item.parent_id is not distinct from target_parent_id
      and item.id <> target_item_id
      and not exists (
        select 1
        from _move_target_order target_order
        where target_order.id = item.id
      )
  ) then
    raise exception 'ordered_target_item_ids is missing target ids';
  end if;

  select target_order.position
    into target_position
  from _move_target_order target_order
  where target_order.id = target_item_id;

  if target_position is null or target_position <= 0 then
    raise exception 'target_item_id position is invalid in ordered_target_item_ids';
  end if;

  update public.estimate_items item
  set position = -source_order.position
  from _move_source_order source_order
  where item.id = source_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id;

  update public.estimate_items item
  set position = -target_order.position
  from _move_target_order target_order
  where item.id = target_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.id <> target_item_id
    and item.parent_id is not distinct from target_parent_id;

  update public.estimate_items item
  set
    parent_id = target_parent_id,
    position = -target_position
  where item.id = target_item_id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id;

  update public.estimate_items item
  set position = source_order.position
  from _move_source_order source_order
  where item.id = source_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id
    and item.parent_id is not distinct from source_parent_id
    and item.id <> target_item_id;

  get diagnostics source_updated_count = row_count;

  update public.estimate_items item
  set
    parent_id = target_parent_id,
    position = target_order.position
  from _move_target_order target_order
  where item.id = target_order.id
    and item.version_id = target_version_id
    and item.tenant_id = target_version.tenant_id;

  get diagnostics target_updated_count = row_count;

  if source_updated_count <> source_expected_count then
    raise exception 'ordered_source_item_ids stale write detected';
  end if;

  if target_updated_count <> target_expected_count then
    raise exception 'ordered_target_item_ids stale write detected';
  end if;

  return source_updated_count + target_updated_count;
end;
$$;

grant execute on function public.move_estimate_item(
  uuid,
  uuid,
  uuid,
  uuid,
  uuid[],
  uuid[]
) to authenticated;

-- EST-163: suggestion learning from manual corrections.

alter table if exists public.feature_flags
  add column if not exists value text;

create table if not exists public.suggestion_corrections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_id uuid not null references public.estimate_suggestion_rules(id) on delete cascade,
  field_name text not null check (
    field_name in (
      'description',
      'category_id',
      'k_fo',
      'k_mo',
      'labor_role_id',
      'supply_type_id'
    )
  ),
  original_value text,
  corrected_value text,
  item_title text not null default '',
  user_id uuid not null references public.profiles(id) on delete restrict
);

alter table public.suggestion_corrections
  alter column tenant_id set default public.current_tenant_id();

create index if not exists suggestion_corrections_rule_field_corrected_idx
  on public.suggestion_corrections (rule_id, field_name, corrected_value);

create index if not exists suggestion_corrections_tenant_created_idx
  on public.suggestion_corrections (tenant_id, created_at desc);

create index if not exists suggestion_corrections_tenant_rule_idx
  on public.suggestion_corrections (tenant_id, rule_id);

create or replace function public.assign_suggestion_corrections_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.rule_id is not null then
    select esr.tenant_id
      into parent_tenant_id
    from public.estimate_suggestion_rules esr
    where esr.id = new.rule_id;
  end if;

  new.tenant_id := coalesce(parent_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_suggestion_corrections_tenant_id
  on public.suggestion_corrections;
create trigger set_suggestion_corrections_tenant_id
  before insert or update on public.suggestion_corrections
  for each row execute procedure public.assign_suggestion_corrections_tenant_id();

alter table public.suggestion_corrections enable row level security;

drop policy if exists "Tenant members can view suggestion corrections"
  on public.suggestion_corrections;
drop policy if exists "Tenant members can insert suggestion corrections"
  on public.suggestion_corrections;
drop policy if exists "Tenant admins can delete suggestion corrections"
  on public.suggestion_corrections;

create policy "Tenant members can view suggestion corrections"
  on public.suggestion_corrections
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can insert suggestion corrections"
  on public.suggestion_corrections
  for insert
  to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and user_id = (select auth.uid())
  );

create policy "Tenant admins can delete suggestion corrections"
  on public.suggestion_corrections
  for delete
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create table if not exists public.suggestion_learning_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_id uuid not null references public.estimate_suggestion_rules(id) on delete cascade,
  field_name text not null check (
    field_name in (
      'description',
      'category_id',
      'k_fo',
      'k_mo',
      'labor_role_id',
      'supply_type_id'
    )
  ),
  corrected_value text,
  status text not null check (status in ('approved', 'rejected')),
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now()
);

alter table public.suggestion_learning_reviews
  alter column tenant_id set default public.current_tenant_id();

drop trigger if exists set_suggestion_learning_reviews_updated_at
  on public.suggestion_learning_reviews;
create trigger set_suggestion_learning_reviews_updated_at
  before update on public.suggestion_learning_reviews
  for each row execute procedure public.set_updated_at();

create unique index if not exists suggestion_learning_reviews_unique_triplet_idx
  on public.suggestion_learning_reviews (
    tenant_id,
    rule_id,
    field_name,
    coalesce(corrected_value, '__NULL__')
  );

create index if not exists suggestion_learning_reviews_tenant_rule_idx
  on public.suggestion_learning_reviews (tenant_id, rule_id);

create or replace function public.assign_suggestion_learning_reviews_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.rule_id is not null then
    select esr.tenant_id
      into parent_tenant_id
    from public.estimate_suggestion_rules esr
    where esr.id = new.rule_id;
  end if;

  new.tenant_id := coalesce(parent_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

drop trigger if exists set_suggestion_learning_reviews_tenant_id
  on public.suggestion_learning_reviews;
create trigger set_suggestion_learning_reviews_tenant_id
  before insert or update on public.suggestion_learning_reviews
  for each row execute procedure public.assign_suggestion_learning_reviews_tenant_id();

alter table public.suggestion_learning_reviews enable row level security;

drop policy if exists "Tenant members can view suggestion learning reviews"
  on public.suggestion_learning_reviews;
drop policy if exists "Tenant admins can manage suggestion learning reviews"
  on public.suggestion_learning_reviews;

create policy "Tenant members can view suggestion learning reviews"
  on public.suggestion_learning_reviews
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage suggestion learning reviews"
  on public.suggestion_learning_reviews
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create or replace function public.get_suggestion_learnings(
  target_tenant_id uuid default public.current_tenant_id(),
  threshold integer default 3,
  include_inactive boolean default false
)
returns table (
  rule_id uuid,
  field_name text,
  corrected_value text,
  correction_count integer,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  review_status text,
  decided_by uuid,
  decided_at timestamptz,
  is_active boolean,
  sample_original_value text,
  sample_item_title text
)
language sql
stable
set search_path = public
as $$
  with normalized as (
    select
      coalesce(target_tenant_id, public.current_tenant_id()) as tenant_id,
      greatest(coalesce(threshold, 3), 1) as min_corrections
  ),
  aggregated as (
    select
      c.rule_id,
      c.field_name,
      c.corrected_value,
      count(*)::integer as correction_count,
      min(c.created_at) as first_seen_at,
      max(c.created_at) as last_seen_at,
      (
        array_agg(c.original_value order by c.created_at desc)
          filter (where c.original_value is not null)
      )[1] as sample_original_value,
      (
        array_agg(c.item_title order by c.created_at desc)
          filter (where c.item_title is not null and btrim(c.item_title) <> '')
      )[1] as sample_item_title
    from public.suggestion_corrections c
    join normalized n on n.tenant_id = c.tenant_id
    group by c.rule_id, c.field_name, c.corrected_value
  ),
  merged as (
    select
      a.rule_id,
      a.field_name,
      a.corrected_value,
      a.correction_count,
      a.first_seen_at,
      a.last_seen_at,
      r.status as review_status,
      r.decided_by,
      r.decided_at,
      case
        when r.status = 'approved' then true
        when r.status = 'rejected' then false
        else a.correction_count >= n.min_corrections
      end as is_active,
      a.sample_original_value,
      a.sample_item_title
    from aggregated a
    join normalized n on true
    left join public.suggestion_learning_reviews r
      on r.tenant_id = n.tenant_id
      and r.rule_id = a.rule_id
      and r.field_name = a.field_name
      and coalesce(r.corrected_value, '__NULL__') = coalesce(a.corrected_value, '__NULL__')
  )
  select
    merged.rule_id,
    merged.field_name,
    merged.corrected_value,
    merged.correction_count,
    merged.first_seen_at,
    merged.last_seen_at,
    merged.review_status,
    merged.decided_by,
    merged.decided_at,
    merged.is_active,
    merged.sample_original_value,
    merged.sample_item_title
  from merged
  where include_inactive or merged.is_active
  order by merged.is_active desc, merged.correction_count desc, merged.last_seen_at desc;
$$;

create or replace function public.purge_suggestion_corrections(
  target_tenant_id uuid default public.current_tenant_id(),
  retention_months integer default 12
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  scoped_tenant_id uuid := coalesce(target_tenant_id, public.current_tenant_id());
  normalized_retention_months integer := greatest(1, least(coalesce(retention_months, 12), 120));
  deleted_count integer := 0;
begin
  if scoped_tenant_id is null then
    return 0;
  end if;

  if not (select public.has_tenant_role(scoped_tenant_id, array['admin'::public.tenant_role])) then
    raise exception 'Access denied';
  end if;

  delete from public.suggestion_corrections
  where tenant_id = scoped_tenant_id
    and created_at < (now() - make_interval(months => normalized_retention_months));

  get diagnostics deleted_count = row_count;

  delete from public.suggestion_learning_reviews r
  where r.tenant_id = scoped_tenant_id
    and not exists (
      select 1
      from public.suggestion_corrections c
      where c.tenant_id = r.tenant_id
        and c.rule_id = r.rule_id
        and c.field_name = r.field_name
        and coalesce(c.corrected_value, '__NULL__') = coalesce(r.corrected_value, '__NULL__')
    );

  return deleted_count;
end;
$$;

grant execute on function public.get_suggestion_learnings(uuid, integer, boolean) to authenticated;
grant execute on function public.purge_suggestion_corrections(uuid, integer) to authenticated;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING', false, null
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING_THRESHOLD', true, '3'
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'EST_163_SUGGESTION_LEARNING_RETENTION_MONTHS', true, '12'
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

-- EST-037: business rules engine (margin/discount/approval) with tenant-scoped approvals.

do $$
begin
  create type public.estimate_rule_type as enum ('min_margin', 'max_discount', 'require_approval');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_rule_scope_type as enum ('global', 'category', 'client');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_rule_action as enum ('warn', 'block', 'require_approval');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.estimate_approval_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.estimate_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_type public.estimate_rule_type not null,
  scope_type public.estimate_rule_scope_type not null default 'global',
  scope_id uuid,
  threshold_value numeric not null,
  action public.estimate_rule_action not null,
  is_active boolean not null default true,
  check (threshold_value >= 0)
);

create index if not exists estimate_rules_tenant_active_idx
  on public.estimate_rules (tenant_id, is_active);
create index if not exists estimate_rules_tenant_scope_idx
  on public.estimate_rules (tenant_id, scope_type, scope_id);

create table if not exists public.estimate_approvals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  rule_id uuid not null references public.estimate_rules(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete set null,
  status public.estimate_approval_status not null default 'pending',
  decided_at timestamptz,
  check (
    (
      status = 'pending'
      and approved_by is null
      and decided_at is null
    )
    or (
      status in ('approved', 'rejected')
      and decided_at is not null
    )
  )
);

create index if not exists estimate_approvals_tenant_status_idx
  on public.estimate_approvals (tenant_id, status, created_at desc);
create index if not exists estimate_approvals_tenant_version_idx
  on public.estimate_approvals (tenant_id, version_id, created_at desc);
create index if not exists estimate_approvals_tenant_rule_idx
  on public.estimate_approvals (tenant_id, rule_id, created_at desc);

create unique index if not exists estimate_approvals_pending_unique_idx
  on public.estimate_approvals (tenant_id, version_id, rule_id)
  where status = 'pending';

create or replace function public.assign_estimate_rules_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_approvals_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  version_tenant_id uuid;
  rule_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into version_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if new.rule_id is not null then
    select er.tenant_id
      into rule_tenant_id
    from public.estimate_rules er
    where er.id = new.rule_id;
  end if;

  if version_tenant_id is null and rule_tenant_id is null then
    new.tenant_id := coalesce(new.tenant_id, public.current_tenant_id());
    return new;
  end if;

  if version_tenant_id is not null and rule_tenant_id is not null and version_tenant_id <> rule_tenant_id then
    raise exception
      using
        errcode = '23514',
        message = 'ESTIMATE_APPROVAL_TENANT_MISMATCH',
        detail = format('version_id=%s and rule_id=%s belong to different tenants', new.version_id, new.rule_id);
  end if;

  new.tenant_id := coalesce(version_tenant_id, rule_tenant_id, new.tenant_id, public.current_tenant_id());
  return new;
end;
$$;

create or replace function public.guard_estimate_approvals_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'pending' then
    if new.approved_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_PENDING_INVALID',
          detail = 'pending approvals cannot carry approved_by/decided_at.';
    end if;
  else
    if new.status not in ('approved', 'rejected') then
      raise exception
        using
          errcode = '22023',
          message = 'ESTIMATE_APPROVAL_STATUS_INVALID',
          detail = format('status=%s is not supported', new.status);
    end if;

    if new.decided_at is null or new.approved_by is null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_DECISION_INVALID',
          detail = 'approved/rejected approvals must carry approved_by and decided_at on insert.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.guard_estimate_approvals_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.tenant_id is distinct from new.tenant_id
    or old.version_id is distinct from new.version_id
    or old.rule_id is distinct from new.rule_id
    or old.requested_by is distinct from new.requested_by
    or old.created_at is distinct from new.created_at
  then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_APPROVAL_IMMUTABLE_FIELDS',
        detail = 'tenant_id/version_id/rule_id/requested_by/created_at cannot be changed.';
  end if;

  if new.status = 'pending' then
    if new.approved_by is not null or new.decided_at is not null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_PENDING_INVALID',
          detail = 'pending approvals cannot carry approved_by/decided_at.';
    end if;
  else
    if new.status not in ('approved', 'rejected') then
      raise exception
        using
          errcode = '22023',
          message = 'ESTIMATE_APPROVAL_STATUS_INVALID',
          detail = format('status=%s is not supported', new.status);
    end if;

    if new.decided_at is null then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_APPROVAL_DECISION_INVALID',
          detail = 'approved/rejected approvals must carry decided_at.';
    end if;

    if new.approved_by is null then
      if not (
        old.status = new.status
        and old.status in ('approved', 'rejected')
        and old.approved_by is not null
        and old.decided_at is not distinct from new.decided_at
      ) then
        raise exception
          using
            errcode = '23514',
            message = 'ESTIMATE_APPROVAL_DECISION_INVALID',
            detail = 'approved/rejected approvals must carry approved_by unless the approver profile was deleted.';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_rules_updated_at on public.estimate_rules;
create trigger set_estimate_rules_updated_at
  before update on public.estimate_rules
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_rules_tenant_id on public.estimate_rules;
create trigger set_estimate_rules_tenant_id
  before insert on public.estimate_rules
  for each row execute procedure public.assign_estimate_rules_tenant_id();

drop trigger if exists set_estimate_approvals_updated_at on public.estimate_approvals;
create trigger set_estimate_approvals_updated_at
  before update on public.estimate_approvals
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_approvals_tenant_id on public.estimate_approvals;
create trigger set_estimate_approvals_tenant_id
  before insert or update on public.estimate_approvals
  for each row execute procedure public.assign_estimate_approvals_tenant_id();

drop trigger if exists guard_estimate_approvals_insert_trigger on public.estimate_approvals;
create trigger guard_estimate_approvals_insert_trigger
  before insert on public.estimate_approvals
  for each row execute procedure public.guard_estimate_approvals_insert();

drop trigger if exists guard_estimate_approvals_update_trigger on public.estimate_approvals;
create trigger guard_estimate_approvals_update_trigger
  before update on public.estimate_approvals
  for each row execute procedure public.guard_estimate_approvals_update();

alter table public.estimate_rules enable row level security;
alter table public.estimate_approvals enable row level security;

drop policy if exists "Tenant members can view estimate rules" on public.estimate_rules;
drop policy if exists "Tenant admins can manage estimate rules" on public.estimate_rules;

drop policy if exists "Tenant members can view estimate approvals" on public.estimate_approvals;
drop policy if exists "Tenant members can create estimate approvals" on public.estimate_approvals;
drop policy if exists "Tenant admins can decide estimate approvals" on public.estimate_approvals;

create policy "Tenant members can view estimate rules"
  on public.estimate_rules
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage estimate rules"
  on public.estimate_rules
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

create policy "Tenant members can view estimate approvals"
  on public.estimate_approvals
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant members can create estimate approvals"
  on public.estimate_approvals
  for insert
  to authenticated
  with check (
    (select public.is_tenant_member(tenant_id))
    and requested_by = (select auth.uid())
    and status = 'pending'
    and approved_by is null
    and decided_at is null
  );

create policy "Tenant admins can decide estimate approvals"
  on public.estimate_approvals
  for update
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check (
    (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    and (
      status = 'pending'
      or (
        status in ('approved', 'rejected')
        and approved_by = (select auth.uid())
        and decided_at is not null
      )
    )
  );


-- EST-033: add AID on estimate items and propagate it in bulk update RPC.

alter table public.estimate_items
  add column if not exists aid text;

alter table public.estimate_items
  drop constraint if exists estimate_items_aid_length_check;
alter table public.estimate_items
  add constraint estimate_items_aid_length_check
  check (aid is null or char_length(aid) <= 64);

create index if not exists estimate_items_tenant_aid_idx
  on public.estimate_items (tenant_id, aid)
  where aid is not null;

create or replace function public.snapshot_estimate_item_bulk_updates(
  target_version_id uuid,
  item_updates jsonb
)
returns table (
  id uuid,
  parent_id uuid,
  item_position integer,
  title text,
  aid text,
  description text,
  quantity numeric(12,3),
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric(12,3),
  h_mo numeric(12,3),
  h_mo_majoration numeric(12,4),
  k_mo numeric(12,3),
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  supply_type_id uuid,
  selected_supplier_price_id uuid,
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer
)
language sql
stable
set search_path = public
as $$
  with requested_updates as (
    select value as payload
    from jsonb_array_elements(item_updates)
  )
  select
    item.id,
    case
      when requested.payload ? 'parent_id'
        then nullif(requested.payload->>'parent_id', '')::uuid
      else item.parent_id
    end as parent_id,
    case
      when requested.payload ? 'position'
        then (requested.payload->>'position')::integer
      else item.position
    end as item_position,
    case
      when requested.payload ? 'title'
        then requested.payload->>'title'
      else item.title
    end as title,
    case
      when requested.payload ? 'aid'
        then nullif(upper(btrim(requested.payload->>'aid')), '')
      else item.aid
    end as aid,
    case
      when requested.payload ? 'description'
        then nullif(btrim(requested.payload->>'description'), '')
      else item.description
    end as description,
    case
      when requested.payload ? 'quantity'
        then (requested.payload->>'quantity')::numeric(12,3)
      else item.quantity
    end as quantity,
    case
      when requested.payload ? 'unit_price_ht_cents'
        then (requested.payload->>'unit_price_ht_cents')::integer
      else item.unit_price_ht_cents
    end as unit_price_ht_cents,
    case
      when requested.payload ? 'tax_rate_bp'
        then (requested.payload->>'tax_rate_bp')::integer
      else item.tax_rate_bp
    end as tax_rate_bp,
    case
      when requested.payload ? 'k_fo'
        then (requested.payload->>'k_fo')::numeric(12,3)
      else item.k_fo
    end as k_fo,
    case
      when requested.payload ? 'h_mo'
        then (requested.payload->>'h_mo')::numeric(12,3)
      else item.h_mo
    end as h_mo,
    case
      when requested.payload ? 'h_mo_majoration'
        then (requested.payload->>'h_mo_majoration')::numeric(12,4)
      else item.h_mo_majoration
    end as h_mo_majoration,
    case
      when requested.payload ? 'k_mo'
        then (requested.payload->>'k_mo')::numeric(12,3)
      else item.k_mo
    end as k_mo,
    case
      when requested.payload ? 'pu_ht_cents'
        then (requested.payload->>'pu_ht_cents')::integer
      else item.pu_ht_cents
    end as pu_ht_cents,
    case
      when requested.payload ? 'labor_role_id'
        then nullif(requested.payload->>'labor_role_id', '')::uuid
      else item.labor_role_id
    end as labor_role_id,
    case
      when requested.payload ? 'category_id'
        then nullif(requested.payload->>'category_id', '')::uuid
      else item.category_id
    end as category_id,
    case
      when requested.payload ? 'supply_type_id'
        then nullif(requested.payload->>'supply_type_id', '')::uuid
      else item.supply_type_id
    end as supply_type_id,
    case
      when requested.payload ? 'selected_supplier_price_id'
        then nullif(requested.payload->>'selected_supplier_price_id', '')::uuid
      else item.selected_supplier_price_id
    end as selected_supplier_price_id,
    case
      when requested.payload ? 'line_total_ht_cents'
        then (requested.payload->>'line_total_ht_cents')::integer
      else item.line_total_ht_cents
    end as line_total_ht_cents,
    case
      when requested.payload ? 'line_tax_cents'
        then (requested.payload->>'line_tax_cents')::integer
      else item.line_tax_cents
    end as line_tax_cents,
    case
      when requested.payload ? 'line_total_ttc_cents'
        then (requested.payload->>'line_total_ttc_cents')::integer
      else item.line_total_ttc_cents
    end as line_total_ttc_cents
  from requested_updates requested
  join public.estimate_items item
    on item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;
$$;

create or replace function public.bulk_update_estimate_items(
  target_version_id uuid,
  item_updates jsonb,
  version_patch jsonb default null,
  expected_version_updated_at timestamptz default null
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  updated_count integer := 0;
  expected_count integer := 0;
  snapshot_count integer := 0;
  locked_count integer := 0;
  version_locked_count integer := 0;
  effective_version_patch jsonb := coalesce(version_patch, '{}'::jsonb);
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if expected_version_updated_at is null then
    raise exception 'expected_version_updated_at is required';
  end if;

  if version_patch is not null and jsonb_typeof(version_patch) <> 'object' then
    raise exception 'version_patch must be a JSON object';
  end if;

  if effective_version_patch - array['total_ht_cents', 'total_tax_cents', 'total_ttc_cents'] <> '{}'::jsonb then
    raise exception 'version_patch supports only total_ht_cents, total_tax_cents, total_ttc_cents';
  end if;

  expected_count := coalesce(jsonb_array_length(item_updates), 0);

  perform ev.id
  from public.estimate_versions ev
  where ev.id = target_version_id
    and ev.updated_at = expected_version_updated_at
  for update;

  get diagnostics version_locked_count = row_count;

  if version_locked_count <> 1 then
    raise exception
      using
        errcode = 'P0001',
        message = 'STALE_BULK_UPDATE_ITEMS',
        detail = format(
          'expected_count=%s,locked_count=%s',
          1,
          version_locked_count
        );
  end if;

  if expected_count > 0 then
    create temporary table _estimate_item_bulk_snapshot (
      id uuid primary key,
      parent_id uuid,
      item_position integer,
      title text,
      aid text,
      description text,
      quantity numeric(12,3),
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric(12,3),
      h_mo numeric(12,3),
      h_mo_majoration numeric(12,4),
      k_mo numeric(12,3),
      pu_ht_cents integer,
      labor_role_id uuid,
      category_id uuid,
      supply_type_id uuid,
      selected_supplier_price_id uuid,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer
    ) on commit drop;

    insert into _estimate_item_bulk_snapshot (
      id,
      parent_id,
      item_position,
      title,
      aid,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      pu_ht_cents,
      labor_role_id,
      category_id,
      supply_type_id,
      selected_supplier_price_id,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents
    )
    select
      snapshot.id,
      snapshot.parent_id,
      snapshot.item_position,
      snapshot.title,
      snapshot.aid,
      snapshot.description,
      snapshot.quantity,
      snapshot.unit_price_ht_cents,
      snapshot.tax_rate_bp,
      snapshot.k_fo,
      snapshot.h_mo,
      snapshot.h_mo_majoration,
      snapshot.k_mo,
      snapshot.pu_ht_cents,
      snapshot.labor_role_id,
      snapshot.category_id,
      snapshot.supply_type_id,
      snapshot.selected_supplier_price_id,
      snapshot.line_total_ht_cents,
      snapshot.line_tax_cents,
      snapshot.line_total_ttc_cents
    from public.snapshot_estimate_item_bulk_updates(target_version_id, item_updates) snapshot;

    select count(*)
      into snapshot_count
    from _estimate_item_bulk_snapshot;

    if snapshot_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            snapshot_count
          );
    end if;

    perform item.id
    from public.estimate_items item
    join _estimate_item_bulk_snapshot snapshot
      on item.id = snapshot.id
      and item.version_id = target_version_id
    for update;

    get diagnostics locked_count = row_count;

    if locked_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,locked_count=%s',
            expected_count,
            locked_count
          );
    end if;

    update public.estimate_items item
    set position = -snapshot.item_position
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    update public.estimate_items item
    set
      parent_id = snapshot.parent_id,
      position = snapshot.item_position,
      title = snapshot.title,
      aid = snapshot.aid,
      description = snapshot.description,
      quantity = snapshot.quantity,
      unit_price_ht_cents = snapshot.unit_price_ht_cents,
      tax_rate_bp = snapshot.tax_rate_bp,
      k_fo = snapshot.k_fo,
      h_mo = snapshot.h_mo,
      h_mo_majoration = snapshot.h_mo_majoration,
      k_mo = snapshot.k_mo,
      pu_ht_cents = snapshot.pu_ht_cents,
      labor_role_id = snapshot.labor_role_id,
      category_id = snapshot.category_id,
      supply_type_id = snapshot.supply_type_id,
      selected_supplier_price_id = snapshot.selected_supplier_price_id,
      line_total_ht_cents = snapshot.line_total_ht_cents,
      line_tax_cents = snapshot.line_tax_cents,
      line_total_ttc_cents = snapshot.line_total_ttc_cents
    from _estimate_item_bulk_snapshot snapshot
    where item.id = snapshot.id
      and item.version_id = target_version_id;

    get diagnostics updated_count = row_count;

    if updated_count <> expected_count then
      raise exception
        using
          errcode = 'P0001',
          message = 'STALE_BULK_UPDATE_ITEMS',
          detail = format(
            'expected_count=%s,updated_count=%s',
            expected_count,
            updated_count
          );
    end if;
  end if;

  if effective_version_patch <> '{}'::jsonb then
    update public.estimate_versions ev
    set
      total_ht_cents = case
        when effective_version_patch ? 'total_ht_cents'
          then (effective_version_patch->>'total_ht_cents')::integer
        else ev.total_ht_cents
      end,
      total_tax_cents = case
        when effective_version_patch ? 'total_tax_cents'
          then (effective_version_patch->>'total_tax_cents')::integer
        else ev.total_tax_cents
      end,
      total_ttc_cents = case
        when effective_version_patch ? 'total_ttc_cents'
          then (effective_version_patch->>'total_ttc_cents')::integer
        else ev.total_ttc_cents
      end
    where ev.id = target_version_id;
  end if;

  return updated_count;
end;
$$;

-- TKF-014: add source tracking fields on estimate items for takeoff provenance.

alter table if exists public.estimate_items
  add column if not exists source_provider text default 'manual',
  add column if not exists source_job_id uuid,
  add column if not exists source_file_name text,
  add column if not exists source_page integer;

alter table if exists public.estimate_items
  alter column source_provider set default 'manual';

alter table if exists public.estimate_items
  drop constraint if exists estimate_items_source_job_id_fkey;

alter table if exists public.estimate_items
  add constraint estimate_items_source_job_id_fkey
  foreign key (source_job_id)
  references public.takeoff_jobs(id)
  on delete set null;

create index if not exists estimate_items_source_job_id_idx
  on public.estimate_items (source_job_id);

create index if not exists estimate_items_tenant_source_job_id_idx
  on public.estimate_items (tenant_id, source_job_id);

-- TKF-015: extend audit action catalog for takeoff processing lifecycle.

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (
    action in (
      'INSERT',
      'UPDATE',
      'DELETE',
      'invariant_violation',
      'seal',
      'takeoff.job.created',
      'takeoff.job.processing',
      'takeoff.job.completed',
      'takeoff.job.failed',
      'takeoff.job.retried',
      'takeoff.job.canceled',
      'takeoff.item.excluded',
      'takeoff.item.modified',
      'takeoff.apply.started',
      'takeoff.apply.completed',
      'takeoff.apply.failed'
    )
  );

drop policy if exists "Authenticated can insert takeoff audit logs" on public.audit_logs;

create policy "Authenticated can insert takeoff audit logs"
  on public.audit_logs
  for insert
  to authenticated
  with check (
    action like 'takeoff.%'
    and user_id = (select auth.uid())
    and tenant_id = (select public.current_tenant_id())
    and table_name in ('takeoff_jobs', 'takeoff_items')
    and estimate_version_id is not null
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.tenant_id = audit_logs.tenant_id
        and tj.estimate_version_id = audit_logs.estimate_version_id
        and (
          (audit_logs.table_name = 'takeoff_jobs' and tj.id = audit_logs.record_id)
          or (
            audit_logs.table_name = 'takeoff_items'
            and exists (
              select 1
              from public.takeoff_items ti
              where ti.id = audit_logs.record_id
                and ti.job_id = tj.id
                and ti.tenant_id = audit_logs.tenant_id
            )
          )
        )
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
  );

-- TKF-029: create tenant-scoped takeoff mapping rules.

create table if not exists public.takeoff_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  name text not null,
  match_pattern text not null,
  match_type text not null,
  action text not null,
  action_params jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null
);

alter table if exists public.takeoff_mapping_rules
  alter column tenant_id set default public.current_tenant_id(),
  alter column action_params set default '{}'::jsonb,
  alter column priority set default 100,
  alter column is_active set default true;

alter table if exists public.takeoff_mapping_rules
  alter column tenant_id set not null,
  alter column name set not null,
  alter column match_pattern set not null,
  alter column match_type set not null,
  alter column action set not null,
  alter column action_params set not null,
  alter column priority set not null,
  alter column is_active set not null;

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_match_type_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_match_type_check
  check (match_type in ('exact', 'contains', 'regex'));

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_action_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_action_check
  check (action in ('rename', 'set_price', 'set_category', 'apply_assembly', 'skip'));

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_priority_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_priority_check
  check (priority >= 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_name_not_blank_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_name_not_blank_check
  check (length(btrim(name)) > 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_match_pattern_not_blank_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_match_pattern_not_blank_check
  check (length(btrim(match_pattern)) > 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_action_params_object_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_action_params_object_check
  check (jsonb_typeof(action_params) = 'object');

create index if not exists takeoff_mapping_rules_tenant_active_priority_idx
  on public.takeoff_mapping_rules (tenant_id, is_active, priority);

drop trigger if exists set_takeoff_mapping_rules_updated_at on public.takeoff_mapping_rules;
create trigger set_takeoff_mapping_rules_updated_at
  before update on public.takeoff_mapping_rules
  for each row execute procedure public.set_updated_at();

alter table if exists public.takeoff_mapping_rules enable row level security;
alter table if exists public.takeoff_mapping_rules force row level security;

drop policy if exists "Current tenant can manage takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant members can view takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can manage takeoff mapping rules" on public.takeoff_mapping_rules;

create policy "Current tenant members can view takeoff mapping rules"
  on public.takeoff_mapping_rules
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
  );

create policy "Current tenant admins can manage takeoff mapping rules"
  on public.takeoff_mapping_rules
  for all
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );


-- TKF-017: add tenant-scoped takeoff plan sets/files with strict RLS and storage policies.


create table if not exists public.plan_sets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  estimate_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  name text not null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

create table if not exists public.plan_files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  plan_set_id uuid not null references public.plan_sets(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null,
  file_size_bytes bigint not null,
  page_count integer,
  file_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null
);

alter table if exists public.plan_sets
  alter column tenant_id set default public.current_tenant_id(),
  alter column metadata set default '{}'::jsonb,
  alter column tenant_id set not null,
  alter column estimate_version_id set not null,
  alter column name set not null,
  alter column metadata set not null;

alter table if exists public.plan_files
  alter column tenant_id set default public.current_tenant_id(),
  alter column metadata set default '{}'::jsonb,
  alter column tenant_id set not null,
  alter column plan_set_id set not null,
  alter column file_path set not null,
  alter column file_name set not null,
  alter column file_type set not null,
  alter column file_size_bytes set not null,
  alter column metadata set not null;

alter table if exists public.plan_files
  drop constraint if exists plan_files_plan_set_id_fkey;
alter table if exists public.plan_files
  add constraint plan_files_plan_set_id_fkey
  foreign key (plan_set_id)
  references public.plan_sets(id)
  on delete cascade;

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_size_bytes_check;
alter table if exists public.plan_files
  add constraint plan_files_file_size_bytes_check
  check (file_size_bytes >= 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_page_count_check;
alter table if exists public.plan_files
  add constraint plan_files_page_count_check
  check (page_count is null or page_count > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_path_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_path_not_blank_check
  check (length(btrim(file_path)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_name_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_name_not_blank_check
  check (length(btrim(file_name)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_type_not_blank_check;
alter table if exists public.plan_files
  add constraint plan_files_file_type_not_blank_check
  check (length(btrim(file_type)) > 0);

alter table if exists public.plan_files
  drop constraint if exists plan_files_metadata_object_check;
alter table if exists public.plan_files
  add constraint plan_files_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

alter table if exists public.plan_sets
  drop constraint if exists plan_sets_name_not_blank_check;
alter table if exists public.plan_sets
  add constraint plan_sets_name_not_blank_check
  check (length(btrim(name)) > 0);

alter table if exists public.plan_sets
  drop constraint if exists plan_sets_metadata_object_check;
alter table if exists public.plan_sets
  add constraint plan_sets_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

alter table if exists public.plan_files
  drop constraint if exists plan_files_file_path_key;
alter table if exists public.plan_files
  add constraint plan_files_file_path_key
  unique (file_path);

create index if not exists plan_sets_tenant_estimate_version_created_at_idx
  on public.plan_sets (tenant_id, estimate_version_id, created_at desc);

create index if not exists plan_files_tenant_plan_set_created_at_idx
  on public.plan_files (tenant_id, plan_set_id, created_at desc);

create index if not exists plan_files_file_hash_idx
  on public.plan_files (file_hash)
  where file_hash is not null;

create index if not exists plan_sets_estimate_version_id_idx
  on public.plan_sets (estimate_version_id);

create index if not exists plan_sets_created_by_idx
  on public.plan_sets (created_by);

create index if not exists plan_files_plan_set_id_idx
  on public.plan_files (plan_set_id);

create index if not exists plan_files_created_by_idx
  on public.plan_files (created_by);

create or replace function public.assign_plan_sets_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_plan_files_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.plan_set_id is not null then
    select ps.tenant_id
      into parent_tenant_id
    from public.plan_sets ps
    where ps.id = new.plan_set_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

update public.plan_sets ps
set tenant_id = ev.tenant_id
from public.estimate_versions ev
where ev.id = ps.estimate_version_id
  and ps.tenant_id is distinct from ev.tenant_id;

update public.plan_files pf
set tenant_id = ps.tenant_id
from public.plan_sets ps
where ps.id = pf.plan_set_id
  and pf.tenant_id is distinct from ps.tenant_id;

drop trigger if exists set_plan_sets_updated_at on public.plan_sets;
create trigger set_plan_sets_updated_at
  before update on public.plan_sets
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_plan_files_updated_at on public.plan_files;
create trigger set_plan_files_updated_at
  before update on public.plan_files
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_plan_sets_tenant_id on public.plan_sets;
create trigger set_plan_sets_tenant_id
  before insert or update on public.plan_sets
  for each row execute procedure public.assign_plan_sets_tenant_id();

drop trigger if exists set_plan_files_tenant_id on public.plan_files;
create trigger set_plan_files_tenant_id
  before insert or update on public.plan_files
  for each row execute procedure public.assign_plan_files_tenant_id();

alter table if exists public.plan_sets enable row level security;
alter table if exists public.plan_files enable row level security;
alter table if exists public.plan_sets force row level security;
alter table if exists public.plan_files force row level security;

drop policy if exists "Current tenant can select plan sets" on public.plan_sets;
drop policy if exists "Current tenant can insert plan sets" on public.plan_sets;
drop policy if exists "Current tenant can update plan sets" on public.plan_sets;
drop policy if exists "Current tenant can delete plan sets" on public.plan_sets;

create policy "Current tenant can select plan sets"
  on public.plan_sets
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can insert plan sets"
  on public.plan_sets
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can update plan sets"
  on public.plan_sets
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

create policy "Current tenant can delete plan sets"
  on public.plan_sets
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(estimate_version_id, tenant_id))
  );

drop policy if exists "Current tenant can select plan files" on public.plan_files;
drop policy if exists "Current tenant can insert plan files" on public.plan_files;
drop policy if exists "Current tenant can update plan files" on public.plan_files;
drop policy if exists "Current tenant can delete plan files" on public.plan_files;

create policy "Current tenant can select plan files"
  on public.plan_files
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can insert plan files"
  on public.plan_files
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can update plan files"
  on public.plan_files
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Current tenant can delete plan files"
  on public.plan_files
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.plan_sets ps
      where ps.id = plan_files.plan_set_id
        and ps.tenant_id = plan_files.tenant_id
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'plan-files',
  'plan-files',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "Tenant members can view plan files storage" on storage.objects;
drop policy if exists "Tenant members can insert plan files storage" on storage.objects;
drop policy if exists "Tenant members can update plan files storage" on storage.objects;
drop policy if exists "Tenant members can delete plan files storage" on storage.objects;

create policy "Tenant members can view plan files storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and coalesce((storage.foldername(name))[3], '') <> ''
    and coalesce(storage.filename(name), '') <> ''
    and coalesce((storage.foldername(name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can insert plan files storage"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and coalesce((storage.foldername(name))[3], '') <> ''
    and coalesce(storage.filename(name), '') <> ''
    and coalesce((storage.foldername(name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can update plan files storage"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and coalesce((storage.foldername(name))[3], '') <> ''
    and coalesce(storage.filename(name), '') <> ''
    and coalesce((storage.foldername(name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  )
  with check (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and coalesce((storage.foldername(name))[3], '') <> ''
    and coalesce(storage.filename(name), '') <> ''
    and coalesce((storage.foldername(name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );

create policy "Tenant members can delete plan files storage"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'plan-files'
    and coalesce(array_length(storage.foldername(name), 1), 0) = 3
    and coalesce((storage.foldername(name))[1], '') <> ''
    and coalesce((storage.foldername(name))[2], '') <> ''
    and coalesce((storage.foldername(name))[3], '') <> ''
    and coalesce(storage.filename(name), '') <> ''
    and coalesce((storage.foldername(name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.tenant_memberships tm
      join public.plan_sets ps on ps.id::text = coalesce((storage.foldername(name))[2], '')
      join public.plan_files pf on pf.id::text = coalesce((storage.foldername(name))[3], '')
      where tm.user_id = (select auth.uid())
        and tm.tenant_id::text = coalesce((storage.foldername(name))[1], '')
        and ps.tenant_id = tm.tenant_id
        and pf.tenant_id = tm.tenant_id
        and pf.plan_set_id = ps.id
        and coalesce(pf.file_path, '') = name
        and coalesce(pf.file_name, '') = coalesce(storage.filename(name), '')
        and (select public.can_access_takeoff_estimate_version(ps.estimate_version_id, ps.tenant_id))
    )
  );
