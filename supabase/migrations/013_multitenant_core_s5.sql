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
