-- Isolated dependencies for the FULL duplication RPC, not a replacement RPC.
-- auth.uid() is simulated; production RLS/triggers and concurrent sessions are
-- deliberately not reconstructed. Function ACLs are exercised with SET ROLE.
create role anon;
create role authenticated;
create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create type public.tenant_role as enum ('admin', 'engineer', 'viewer');
create type public.estimate_status as enum ('draft', 'sending', 'sent', 'accepted', 'archived');
create type public.estimate_item_type as enum ('section', 'line');

create table public.tenants (
  id uuid primary key,
  is_active boolean not null default true
);
create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  role public.tenant_role not null,
  primary key (tenant_id, user_id)
);
create table public.estimate_projects (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  user_id uuid not null,
  name text not null,
  is_archived boolean not null default false,
  unique (tenant_id, id)
);
create table public.estimate_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  version_number integer not null,
  status public.estimate_status not null default 'draft',
  title text,
  exclusions text,
  date_devis date not null default current_date,
  validite_jours integer not null default 30,
  margin_multiplier numeric not null default 1,
  margin_mode text not null default 'fixed',
  currency text not null default 'EUR',
  margin_bp integer not null default 0,
  discount_bp integer not null default 0,
  discount_mode text not null default 'simple',
  discount_steps integer[] not null default '{}',
  global_coefficient numeric not null default 1,
  tax_rate_bp integer not null default 2000,
  rounding_mode text not null default 'none',
  rounding_step_cents integer not null default 1,
  calc_engine_version smallint not null default 2 check (calc_engine_version in (1, 2)),
  contractor_role text not null default 'principal',
  total_ht_cents integer not null default 0,
  total_tax_cents integer not null default 0,
  total_ttc_cents integer not null default 0,
  parent_version_id uuid references public.estimate_versions(id),
  variant_label text,
  max_section_depth integer not null default 3,
  foreign key (tenant_id, project_id) references public.estimate_projects(tenant_id, id),
  unique (project_id, version_number),
  unique (tenant_id, id)
);
create table public.products (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  unique (tenant_id, id)
);
create table public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  version_id uuid not null,
  parent_id uuid,
  item_type public.estimate_item_type not null,
  position integer not null,
  title text not null,
  description text,
  aid text,
  quantity numeric,
  unit_price_ht_cents integer,
  tax_rate_bp integer,
  k_fo numeric,
  h_mo numeric,
  h_mo_majoration numeric,
  k_mo numeric,
  h_mo_atelier numeric,
  k_mo_atelier numeric,
  labor_role_atelier_id uuid,
  h_mo_chantier numeric,
  k_mo_chantier numeric,
  labor_role_chantier_id uuid,
  pu_ht_cents integer,
  labor_role_id uuid,
  category_id uuid,
  supply_type_id uuid,
  selected_supplier_price_id uuid,
  product_id uuid,
  source_provider text,
  source_job_id uuid,
  source_file_name text,
  source_page integer,
  source_metadata jsonb not null default '{}',
  line_total_ht_cents integer,
  line_tax_cents integer,
  line_total_ttc_cents integer,
  foreign key (tenant_id, version_id) references public.estimate_versions(tenant_id, id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id),
  unique (version_id, id),
  foreign key (version_id, parent_id) references public.estimate_items(version_id, id)
);
create table public.takeoff_jobs (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  estimate_version_id uuid not null references public.estimate_versions(id)
);
create table public.takeoff_version_links (
  tenant_id uuid not null references public.tenants(id),
  takeoff_job_id uuid not null references public.takeoff_jobs(id),
  source_version_id uuid not null references public.estimate_versions(id),
  target_version_id uuid not null references public.estimate_versions(id),
  linked_at timestamptz not null,
  linked_by uuid,
  unique (takeoff_job_id, target_version_id)
);
create table public.takeoff_dpgf_review_decisions (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id),
  version_id uuid not null references public.estimate_versions(id),
  takeoff_job_id uuid not null references public.takeoff_jobs(id),
  estimate_item_id uuid,
  review_reference text,
  line_label text,
  line_position integer,
  source_file_name text,
  source_page integer,
  carried_over_from_version_id uuid references public.estimate_versions(id),
  carried_over_at timestamptz,
  decision text,
  reason text,
  decided_at timestamptz,
  updated_at timestamptz,
  decided_by uuid,
  foreign key (version_id, estimate_item_id) references public.estimate_items(version_id, id)
);
