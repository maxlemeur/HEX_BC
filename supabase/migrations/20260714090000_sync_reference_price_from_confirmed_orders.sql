-- Keep an internal fallback price while promoting the latest validated purchase
-- (confirmed or received order) as the effective product reference price.

alter table public.products
  add column if not exists manual_reference_price_cents integer;

update public.products
set manual_reference_price_cents = unit_price_cents
where manual_reference_price_cents is null;

alter table public.products
  alter column manual_reference_price_cents set default 0,
  alter column manual_reference_price_cents set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_manual_reference_price_cents_check'
  ) then
    alter table public.products
      add constraint products_manual_reference_price_cents_check
      check (manual_reference_price_cents >= 0);
  end if;
end
$$;

alter table public.products
  add column if not exists reference_price_source_order_id uuid
    references public.purchase_orders(id) on delete set null,
  add column if not exists reference_price_source_item_id uuid
    references public.purchase_order_items(id) on delete set null,
  add column if not exists reference_price_source_date date;

create index if not exists products_reference_price_source_order_idx
  on public.products (reference_price_source_order_id)
  where reference_price_source_order_id is not null;

create index if not exists products_reference_price_source_item_idx
  on public.products (reference_price_source_item_id)
  where reference_price_source_item_id is not null;

create or replace function public.track_manual_product_reference_price()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.manual_reference_price_cents := new.unit_price_cents;
    return new;
  end if;

  if new.unit_price_cents is distinct from old.unit_price_cents
    and new.reference_price_source_order_id is not distinct from old.reference_price_source_order_id
    and new.reference_price_source_item_id is not distinct from old.reference_price_source_item_id
    and new.reference_price_source_date is not distinct from old.reference_price_source_date
  then
    new.manual_reference_price_cents := new.unit_price_cents;
    new.reference_price_source_order_id := null;
    new.reference_price_source_item_id := null;
    new.reference_price_source_date := null;
  end if;

  return new;
end;
$$;

drop trigger if exists track_manual_product_reference_price_insert on public.products;
create trigger track_manual_product_reference_price_insert
  before insert on public.products
  for each row execute function public.track_manual_product_reference_price();

drop trigger if exists track_manual_product_reference_price on public.products;
create trigger track_manual_product_reference_price
  before update of unit_price_cents on public.products
  for each row execute function public.track_manual_product_reference_price();

create or replace function public.refresh_product_reference_prices(
  p_tenant_id uuid,
  p_product_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant_id is null or coalesce(cardinality(p_product_ids), 0) = 0 then
    return;
  end if;

  -- Clear the previous automatic source first so the product-level manual-price
  -- trigger can distinguish this refresh from an explicit user override, even
  -- when the same order item is corrected after confirmation.
  update public.products product
  set
    reference_price_source_order_id = null,
    reference_price_source_item_id = null,
    reference_price_source_date = null
  where product.tenant_id = p_tenant_id
    and product.id = any(p_product_ids);

  with affected as (
    select distinct product_id
    from unnest(p_product_ids) as requested(product_id)
    where product_id is not null
  ),
  latest_purchase as (
    select distinct on (item.product_id)
      item.product_id,
      item.id as item_id,
      item.unit_price_ht_cents,
      purchase_order.id as order_id,
      purchase_order.order_date
    from public.purchase_order_items item
    join public.purchase_orders purchase_order
      on purchase_order.id = item.purchase_order_id
      and purchase_order.tenant_id = item.tenant_id
    join affected on affected.product_id = item.product_id
    where item.tenant_id = p_tenant_id
      and purchase_order.tenant_id = p_tenant_id
      and purchase_order.status in ('confirmed', 'received')
    order by
      item.product_id,
      purchase_order.order_date desc,
      purchase_order.updated_at desc,
      purchase_order.id desc,
      item.position desc,
      item.updated_at desc,
      item.id desc
  )
  update public.products product
  set
    unit_price_cents = coalesce(latest_purchase.unit_price_ht_cents, product.manual_reference_price_cents),
    reference_price_source_order_id = latest_purchase.order_id,
    reference_price_source_item_id = latest_purchase.item_id,
    reference_price_source_date = latest_purchase.order_date
  from affected
  left join latest_purchase on latest_purchase.product_id = affected.product_id
  where product.id = affected.product_id
    and product.tenant_id = p_tenant_id;
end;
$$;

create or replace function public.refresh_reference_prices_after_order_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_product_ids uuid[];
begin
  if tg_op = 'UPDATE'
    and new.status is not distinct from old.status
    and new.order_date is not distinct from old.order_date
  then
    return new;
  end if;

  select array_agg(distinct item.product_id)
  into affected_product_ids
  from public.purchase_order_items item
  where item.purchase_order_id = new.id
    and item.tenant_id = new.tenant_id
    and item.product_id is not null;

  perform public.refresh_product_reference_prices(new.tenant_id, affected_product_ids);
  return new;
end;
$$;

drop trigger if exists refresh_reference_prices_after_order_insert on public.purchase_orders;
create trigger refresh_reference_prices_after_order_insert
  after insert on public.purchase_orders
  for each row execute function public.refresh_reference_prices_after_order_change();

drop trigger if exists refresh_reference_prices_after_order_update on public.purchase_orders;
create trigger refresh_reference_prices_after_order_update
  after update of status, order_date on public.purchase_orders
  for each row execute function public.refresh_reference_prices_after_order_change();

create or replace function public.refresh_reference_prices_after_order_item_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_product_reference_prices(
      old.tenant_id,
      array_remove(array[old.product_id], null)
    );
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public.refresh_product_reference_prices(
      new.tenant_id,
      array_remove(array[new.product_id], null)
    );
    return new;
  end if;

  if tg_op = 'UPDATE' and old.tenant_id is distinct from new.tenant_id then
    perform public.refresh_product_reference_prices(
      old.tenant_id,
      array_remove(array[old.product_id], null)
    );
    perform public.refresh_product_reference_prices(
      new.tenant_id,
      array_remove(array[new.product_id], null)
    );
    return new;
  end if;

  perform public.refresh_product_reference_prices(
    new.tenant_id,
    array_remove(array[old.product_id, new.product_id], null)
  );
  return new;
end;
$$;

drop trigger if exists refresh_reference_prices_after_order_item_insert on public.purchase_order_items;
create trigger refresh_reference_prices_after_order_item_insert
  after insert on public.purchase_order_items
  for each row execute function public.refresh_reference_prices_after_order_item_change();

drop trigger if exists refresh_reference_prices_after_order_item_update on public.purchase_order_items;
create trigger refresh_reference_prices_after_order_item_update
  after update of product_id, unit_price_ht_cents, purchase_order_id, tenant_id
  on public.purchase_order_items
  for each row execute function public.refresh_reference_prices_after_order_item_change();

drop trigger if exists refresh_reference_prices_after_order_item_delete on public.purchase_order_items;
create trigger refresh_reference_prices_after_order_item_delete
  after delete on public.purchase_order_items
  for each row execute function public.refresh_reference_prices_after_order_item_change();

do $$
declare
  tenant_products record;
begin
  for tenant_products in
    select tenant_id, array_agg(id) as product_ids
    from public.products
    group by tenant_id
  loop
    perform public.refresh_product_reference_prices(
      tenant_products.tenant_id,
      tenant_products.product_ids
    );
  end loop;
end
$$;

drop function if exists public.catalogue_products_page(
  text,
  text[],
  text[],
  text[],
  text[],
  text[],
  text,
  text,
  integer,
  integer
);

create function public.catalogue_products_page(
  p_q text default null,
  p_materials text[] default '{}'::text[],
  p_categories text[] default '{}'::text[],
  p_units text[] default '{}'::text[],
  p_price_statuses text[] default '{}'::text[],
  p_statuses text[] default '{}'::text[],
  p_sort text default 'designation',
  p_dir text default 'asc',
  p_page integer default 1,
  p_size integer default 25
)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  reference text,
  designation text,
  unit_price_cents integer,
  tax_rate_bp integer,
  is_active boolean,
  category text,
  product_type text,
  material text,
  grade text,
  dimensions text,
  standard text,
  unit text,
  reference_price_source_order_id uuid,
  reference_price_source_order_reference text,
  reference_price_source_supplier_name text,
  reference_price_source_date date,
  supplier_price_count bigint,
  best_supplier_price_cents integer,
  best_supplier_name text,
  best_supplier_price_updated_at timestamptz,
  price_status text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      product.id,
      product.created_at,
      product.updated_at,
      product.reference,
      product.designation,
      product.unit_price_cents,
      product.tax_rate_bp,
      product.is_active,
      product.category,
      product.product_type,
      product.material,
      product.grade,
      product.dimensions,
      product.standard,
      product.unit,
      product.reference_price_source_order_id,
      reference_order.reference as reference_price_source_order_reference,
      reference_supplier.name as reference_price_source_supplier_name,
      product.reference_price_source_date,
      coalesce(best_price.price_count, 0)::bigint as supplier_price_count,
      best_price.unit_price_cents as best_supplier_price_cents,
      best_price.supplier_name as best_supplier_name,
      best_price.price_updated_at as best_supplier_price_updated_at,
      case
        when best_price.id is null then 'none'
        when current_date - best_price.price_updated_at::date <= 30 then 'fresh'
        when current_date - best_price.price_updated_at::date <= 90 then 'aging'
        else 'stale'
      end as price_status
    from public.products product
    left join public.purchase_orders reference_order
      on reference_order.id = product.reference_price_source_order_id
      and reference_order.tenant_id = product.tenant_id
    left join public.suppliers reference_supplier
      on reference_supplier.id = reference_order.supplier_id
      and reference_supplier.tenant_id = product.tenant_id
    left join lateral (
      select
        supplier_price.id,
        supplier_price.unit_price_cents,
        supplier.name as supplier_name,
        coalesce(supplier_price.updated_at, supplier_price.created_at) as price_updated_at,
        count(*) over ()::bigint as price_count
      from public.supplier_pricebook supplier_price
      join public.suppliers supplier on supplier.id = supplier_price.supplier_id
      where supplier_price.product_id = product.id
        and supplier_price.is_active
        and supplier_price.valid_from <= current_date
        and (supplier_price.valid_to is null or supplier_price.valid_to >= current_date)
      order by supplier_price.unit_price_cents asc, supplier_price.updated_at desc, supplier_price.id asc
      limit 1
    ) best_price on true
  ),
  filtered as (
    select enriched.*
    from enriched
    where (
      nullif(btrim(p_q), '') is null
      or public.catalogue_normalize_search(
        coalesce(enriched.reference, '') || ' ' ||
        coalesce(enriched.designation, '') || ' ' ||
        coalesce(enriched.category, '') || ' ' ||
        coalesce(enriched.product_type, '') || ' ' ||
        coalesce(enriched.material, '') || ' ' ||
        coalesce(enriched.grade, '') || ' ' ||
        coalesce(enriched.dimensions, '') || ' ' ||
        coalesce(enriched.standard, '')
      ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
    )
      and (cardinality(p_materials) = 0 or coalesce(enriched.material, '') = any(p_materials))
      and (cardinality(p_categories) = 0 or coalesce(enriched.category, '') = any(p_categories))
      and (cardinality(p_units) = 0 or coalesce(enriched.unit, '') = any(p_units))
      and (cardinality(p_price_statuses) = 0 or enriched.price_status = any(p_price_statuses))
      and (
        cardinality(p_statuses) = 0
        or (enriched.is_active and 'active' = any(p_statuses))
        or (not enriched.is_active and 'archived' = any(p_statuses))
      )
  )
  select
    filtered.id,
    filtered.created_at,
    filtered.updated_at,
    filtered.reference,
    filtered.designation,
    filtered.unit_price_cents,
    filtered.tax_rate_bp,
    filtered.is_active,
    filtered.category,
    filtered.product_type,
    filtered.material,
    filtered.grade,
    filtered.dimensions,
    filtered.standard,
    filtered.unit,
    filtered.reference_price_source_order_id,
    filtered.reference_price_source_order_reference,
    filtered.reference_price_source_supplier_name,
    filtered.reference_price_source_date,
    filtered.supplier_price_count,
    filtered.best_supplier_price_cents,
    filtered.best_supplier_name,
    filtered.best_supplier_price_updated_at,
    filtered.price_status,
    count(*) over ()::bigint as total_count
  from filtered
  order by
    case when p_sort = 'designation' and p_dir = 'asc' then lower(filtered.designation) end asc,
    case when p_sort = 'designation' and p_dir = 'desc' then lower(filtered.designation) end desc,
    case when p_sort = 'material' and p_dir = 'asc' then lower(filtered.material) end asc nulls last,
    case when p_sort = 'material' and p_dir = 'desc' then lower(filtered.material) end desc nulls last,
    case when p_sort = 'unit_price_cents' and p_dir = 'asc' then filtered.unit_price_cents end asc,
    case when p_sort = 'unit_price_cents' and p_dir = 'desc' then filtered.unit_price_cents end desc,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'asc' then filtered.best_supplier_price_cents end asc nulls last,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'desc' then filtered.best_supplier_price_cents end desc nulls last,
    case when p_sort = 'updated_at' and p_dir = 'asc' then filtered.updated_at end asc,
    case when p_sort = 'updated_at' and p_dir = 'desc' then filtered.updated_at end desc,
    filtered.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

revoke execute on function public.refresh_product_reference_prices(uuid, uuid[]) from public, anon;
revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) from public, anon;

grant execute on function public.refresh_product_reference_prices(uuid, uuid[]) to authenticated;
grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) to authenticated;
