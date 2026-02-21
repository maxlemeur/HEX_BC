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
drop table if exists public.audit_logs cascade;
drop table if exists public.dpgf_mappings cascade;
drop table if exists public.mapping_memory cascade;
drop table if exists public.mapping_templates cascade;
drop table if exists public.dpgf_rows_mapped cascade;
drop table if exists public.dpgf_rows_raw cascade;
drop table if exists public.dpgf_imports cascade;
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
    and devis.purchase_order_id = target_purchase_order_id
    and devis.user_id = (select auth.uid());

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
    and devis.purchase_order_id = target_purchase_order_id
    and devis.user_id = (select auth.uid());

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

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
begin
  if coalesce(jsonb_typeof(item_updates), '') <> 'array' then
    raise exception 'item_updates must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(item_updates), 0) = 0 then
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
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
  );
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

grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_tenant_member(uuid) to authenticated;
grant execute on function public.has_tenant_role(uuid, public.tenant_role[]) to authenticated;

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
  elsif tg_table_name = 'audit_logs' and new.estimate_version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.estimate_version_id;
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
  using ((select public.is_tenant_member(id)));

create policy "Authenticated can create tenants"
  on public.tenants
  for insert
  to authenticated
  with check (
    (select auth.uid()) is not null
    and (created_by is null or created_by = (select auth.uid()))
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
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

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
