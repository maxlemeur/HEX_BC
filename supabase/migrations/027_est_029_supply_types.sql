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
