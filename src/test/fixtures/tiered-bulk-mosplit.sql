-- Targeted, disposable PostgreSQL/PGlite schema for the complete canonical bulk
-- RPC chain. Read docs/testing/tiered-bulk-mosplit.md for the failures first.
-- This is not a Supabase bootstrap or a schema dump and must never be applied
-- to a shared database. The runner loads real RPCs, tenant helpers, policies,
-- split/payload constraints and V2/nature/product triggers from migrations.
-- No replacement RPC or permissive replacement RLS policy is defined here.
--
-- Simulations: auth.uid() reads test.user_id; is_admin_user() always returns
-- false, so global administrators are outside this proof. Profiles/Auth users,
-- HTTP edit leases, tenant propagation triggers, supplier/catalog workflows,
-- takeoff provenance FKs and multiple concurrent sessions are not reconstructed.
-- The local role/table grants below are harness setup, not deployed ACL evidence.
-- The service_role role exists only in the disposable database.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('test.user_id', true), '')::uuid;
$$;

create function public.is_admin_user()
returns boolean
language sql
stable
as $$ select false; $$;

grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.tenant_role as enum ('admin', 'engineer', 'viewer', 'director');
create type public.estimate_status as enum ('draft', 'sending', 'sent', 'accepted', 'archived');
create type public.estimate_item_type as enum ('section', 'line');
create type public.estimate_rounding_mode as enum ('none', 'nearest', 'up', 'down');
create type public.estimate_margin_mode as enum ('fixed', 'tiered');
create type public.estimate_discount_mode as enum ('simple', 'cascade');
create type public.estimate_line_nature as enum ('supply_only', 'supply_and_labor', 'labor_only');

-- Membership shape used by the real active-tenant helpers from 20260713135334.
-- User references deliberately lack the omitted public.profiles/Auth FK.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  slug text not null unique,
  created_by uuid,
  is_active boolean not null default true
);

create table public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null,
  role public.tenant_role not null default 'viewer',
  is_default boolean not null default false,
  unique (tenant_id, user_id)
);

create table public.estimate_projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  name text not null,
  reference text,
  client_name text,
  notes text,
  is_archived boolean not null default false
);

create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id),
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_number integer not null,
  status public.estimate_status not null default 'draft',
  title text,
  exclusions text,
  date_devis date not null default current_date,
  validite_jours integer not null default 30 check (validite_jours > 0),
  margin_multiplier numeric not null default 1.0 check (margin_multiplier >= 0),
  margin_mode public.estimate_margin_mode not null default 'fixed',
  currency text not null default 'EUR',
  margin_bp integer not null default 0 check (margin_bp >= 0),
  discount_bp integer not null default 0 check (discount_bp >= 0),
  discount_mode public.estimate_discount_mode not null default 'simple',
  discount_steps integer[] not null default '{}',
  global_coefficient numeric not null default 1,
  tax_rate_bp integer not null default 2000 check (tax_rate_bp between 0 and 10000),
  rounding_mode public.estimate_rounding_mode not null default 'none',
  rounding_step_cents integer not null default 1 check (rounding_step_cents >= 1),
  rounding_adjustment_cents integer not null default 0,
  total_ht_cents integer not null default 0 check (total_ht_cents >= 0),
  total_tax_cents integer not null default 0 check (total_tax_cents >= 0),
  total_ttc_cents integer not null default 0 check (total_ttc_cents >= 0),
  content_revision bigint not null default 1,
  calc_engine_version smallint not null default 1,
  calc_snapshot_content_revision bigint,
  calc_snapshot_context jsonb,
  contractor_role text not null default 'principal',
  seal_hash text,
  parent_version_id uuid references public.estimate_versions(id),
  variant_label text,
  max_section_depth integer not null default 3,
  unique (project_id, version_number)
);

create table public.labor_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  name text not null,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  is_active boolean not null default true,
  position integer not null default 0,
  unique (user_id, name)
);

create table public.estimate_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  name text not null
);

create table public.supply_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  code text not null,
  name text not null,
  unique (tenant_id, code)
);

-- Only columns queried by the real product-tenant trigger/backfill and FKs.
-- This intentionally does not model a complete product or supplier pricebook.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id)
);

create table public.supplier_pricebook (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid references public.products(id) on delete set null
);

create table public.margin_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  threshold_cents bigint not null check (threshold_cents >= 0),
  multiplier numeric not null check (multiplier >= 0 and multiplier <= 100),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, threshold_cents),
  unique (tenant_id, position)
);

create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id),
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  parent_id uuid references public.estimate_items(id) on delete cascade deferrable initially deferred,
  item_type public.estimate_item_type not null,
  -- The canonical bulk core requires temporary negative positions during swaps.
  position integer not null default 0,
  title text not null,
  description text,
  aid text,
  quantity numeric(12,3) check (quantity is null or quantity >= 0),
  unit_price_ht_cents integer check (unit_price_ht_cents is null or unit_price_ht_cents >= 0),
  tax_rate_bp integer check (tax_rate_bp is null or tax_rate_bp between 0 and 10000),
  k_fo numeric(12,3) check (k_fo is null or k_fo >= 0),
  h_mo numeric(12,3) check (h_mo is null or h_mo >= 0),
  h_mo_majoration numeric(12,4) not null default 1.0 check (h_mo_majoration >= 0),
  k_mo numeric(12,3) check (k_mo is null or k_mo >= 0),
  h_mo_atelier numeric(12,3),
  k_mo_atelier numeric(12,3) default 1.0,
  labor_role_atelier_id uuid,
  h_mo_chantier numeric(12,3),
  k_mo_chantier numeric(12,3) default 1.0,
  labor_role_chantier_id uuid,
  pu_ht_cents integer check (pu_ht_cents is null or pu_ht_cents >= 0),
  labor_role_id uuid references public.labor_roles(id) on delete set null,
  category_id uuid references public.estimate_categories(id) on delete set null,
  supply_type_id uuid references public.supply_types(id) on delete set null,
  -- Runner loads the canonical selected-supplier-price and product FKs.
  selected_supplier_price_id uuid,
  product_id uuid,
  line_nature public.estimate_line_nature,
  source_provider text default 'manual',
  source_job_id uuid,
  source_file_name text,
  source_page integer,
  source_metadata jsonb not null default '{}',
  line_total_ht_cents integer check (line_total_ht_cents is null or line_total_ht_cents >= 0),
  line_tax_cents integer check (line_tax_cents is null or line_tax_cents >= 0),
  line_total_ttc_cents integer check (line_total_ttc_cents is null or line_total_ttc_cents >= 0),
  -- All OLD/NEW snapshot fields referenced by the actual governed V2 guard.
  snapshot_pu_ht_cents integer,
  snapshot_fo_ht_cents integer,
  snapshot_mo_ht_cents integer,
  snapshot_mo_atelier_ht_cents integer,
  snapshot_mo_chantier_ht_cents integer
);

-- Same two partial unique indexes as 001_add_job_title_to_profiles.sql.
create unique index estimate_items_root_position_unique
  on public.estimate_items (version_id, position) where parent_id is null;
create unique index estimate_items_child_position_unique
  on public.estimate_items (parent_id, position) where parent_id is not null;

-- Enable RLS before loading real policies. No fixture allow-all policy exists.
alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.estimate_projects enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.estimate_items enable row level security;
alter table public.labor_roles enable row level security;
alter table public.products enable row level security;
alter table public.estimate_categories enable row level security;
alter table public.supply_types enable row level security;
alter table public.supplier_pricebook enable row level security;
alter table public.margin_tiers enable row level security;

-- SELECT FOR SHARE in the canonical V2 guard requires UPDATE privileges on
-- projects/labor_roles as well as SELECT; their real RLS still controls rows.
grant select, insert, update, delete on public.estimate_projects,
  public.estimate_versions, public.estimate_items, public.labor_roles
  to authenticated;
grant select on public.products, public.estimate_categories, public.supply_types,
  public.supplier_pricebook, public.margin_tiers to authenticated;
grant all privileges on all tables in schema public to service_role;

-- The runner must load public.set_updated_at() unchanged from migration 001,
-- then install set_estimate_items_updated_at/set_estimate_versions_updated_at.
-- It must also load the complete canonical helper/core and both wrappers,
-- active-tenant helpers, applicable RLS policies, EST031/EST032 checks/FKs,
-- AID length check, supplier/product/nature checks, and real product/nature/V2
-- trigger bodies. Content-revision/freeze workflows are not replaced here.
