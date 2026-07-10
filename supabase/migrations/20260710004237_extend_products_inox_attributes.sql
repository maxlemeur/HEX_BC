alter table public.products
  add column if not exists category text,
  add column if not exists product_type text,
  add column if not exists material text,
  add column if not exists grade text,
  add column if not exists dimensions text,
  add column if not exists standard text,
  add column if not exists unit text not null default 'u';

create index if not exists products_tenant_category_idx
  on public.products (tenant_id, category)
  where category is not null;

create index if not exists products_tenant_material_idx
  on public.products (tenant_id, material)
  where material is not null;
