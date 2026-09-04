alter table public.estimate_items
  add column if not exists product_id uuid;

alter table public.estimate_items
  drop constraint if exists estimate_items_product_id_fkey;

alter table public.estimate_items
  add constraint estimate_items_product_id_fkey
  foreign key (product_id)
  references public.products(id)
  on delete set null;

alter table public.estimate_items
  drop constraint if exists estimate_items_sections_without_product_check;

alter table public.estimate_items
  add constraint estimate_items_sections_without_product_check
  check (item_type = 'line' or product_id is null)
  not valid;

update public.estimate_items item
set product_id = price.product_id
from public.supplier_pricebook price
where item.product_id is null
  and item.item_type = 'line'
  and item.selected_supplier_price_id = price.id
  and item.tenant_id = price.tenant_id
  and price.product_id is not null;

alter table public.estimate_items
  validate constraint estimate_items_sections_without_product_check;

create index if not exists idx_estimate_items_tenant_product
  on public.estimate_items (tenant_id, product_id)
  where product_id is not null;

create or replace function public.validate_estimate_item_product_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.product_id is null then
    return new;
  end if;

  if new.item_type <> 'line' then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_ITEM_SECTION_PRODUCT_FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = new.product_id
      and product.tenant_id = new.tenant_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_ITEM_PRODUCT_TENANT_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_estimate_item_product_tenant()
  from public, anon, authenticated;

drop trigger if exists trg_validate_estimate_item_product_tenant
  on public.estimate_items;

create trigger trg_validate_estimate_item_product_tenant
before insert or update of product_id, tenant_id, item_type
on public.estimate_items
for each row
execute function public.validate_estimate_item_product_tenant();

-- Preserve the existing atomic editor implementation and persist the new
-- association in the same transaction, following the line_nature wrapper.
alter function public.bulk_update_estimate_items(uuid, jsonb, jsonb, timestamptz)
  rename to bulk_update_estimate_items_without_product_id;

create function public.bulk_update_estimate_items(
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
  updated_count integer;
begin
  updated_count := public.bulk_update_estimate_items_without_product_id(
    target_version_id,
    item_updates,
    version_patch,
    expected_version_updated_at
  );

  update public.estimate_items item
  set product_id = nullif(requested.payload->>'product_id', '')::uuid
  from jsonb_array_elements(item_updates) as requested(payload)
  where requested.payload ? 'product_id'
    and item.id = (requested.payload->>'id')::uuid
    and item.version_id = target_version_id;

  return updated_count;
end;
$$;

comment on function public.bulk_update_estimate_items_without_product_id(
  uuid,
  jsonb,
  jsonb,
  timestamptz
) is
  'Internal compatibility implementation retained by the estimate-item product-link wrapper.';

-- The canonical duplication RPC copies explicit columns. Wrap it so article
-- associations follow the copied hierarchy without replacing its governed
-- implementation.
alter function public.duplicate_estimate_version(uuid, boolean)
  rename to duplicate_estimate_version_without_product_id;

revoke all on function public.duplicate_estimate_version_without_product_id(uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.duplicate_estimate_version(
  source_version_id uuid,
  as_variant boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_version_id uuid;
begin
  new_version_id := public.duplicate_estimate_version_without_product_id(
    source_version_id,
    as_variant
  );

  with recursive source_tree as (
    select item.id, item.product_id, array[item.position] as position_path
    from public.estimate_items item
    where item.version_id = source_version_id
      and item.parent_id is null

    union all

    select child.id, child.product_id, parent.position_path || child.position
    from public.estimate_items child
    join source_tree parent on parent.id = child.parent_id
    where child.version_id = source_version_id
  ), target_tree as (
    select item.id, array[item.position] as position_path
    from public.estimate_items item
    where item.version_id = new_version_id
      and item.parent_id is null

    union all

    select child.id, parent.position_path || child.position
    from public.estimate_items child
    join target_tree parent on parent.id = child.parent_id
    where child.version_id = new_version_id
  )
  update public.estimate_items target
  set product_id = source.product_id
  from source_tree source
  join target_tree copied on copied.position_path = source.position_path
  where target.id = copied.id
    and source.product_id is not null;

  return new_version_id;
end;
$$;

revoke all on function public.duplicate_estimate_version(uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.duplicate_estimate_version(uuid, boolean)
  to authenticated;
