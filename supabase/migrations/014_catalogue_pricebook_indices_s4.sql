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
