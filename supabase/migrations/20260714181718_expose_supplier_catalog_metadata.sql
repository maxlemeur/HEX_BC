-- Return current supplier metadata from supplier_catalog_items while retaining
-- the legacy price-row columns as historical snapshots.
drop function if exists public.supplier_prices_page(
  text, text[], uuid, uuid, text, text, integer, integer
);

create function public.supplier_prices_page(
  p_q text default null,
  p_freshness text[] default '{}'::text[],
  p_product_id uuid default null,
  p_supplier_id uuid default null,
  p_sort text default 'updated_at',
  p_dir text default 'desc',
  p_page integer default 1,
  p_size integer default 25
)
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  supplier_id uuid,
  product_id uuid,
  supplier_catalog_item_id uuid,
  supplier_sku text,
  product_url text,
  unit text,
  min_quantity numeric,
  unit_price_cents integer,
  currency text,
  valid_from date,
  valid_to date,
  is_active boolean,
  source_import_id uuid,
  source_mapped_row_id uuid,
  notes text,
  supplier_name text,
  product_name text,
  product_reference text,
  freshness text,
  age_days integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      sp.id,
      sp.created_at,
      sp.updated_at,
      sp.supplier_id,
      sp.product_id,
      sp.supplier_catalog_item_id,
      item.supplier_sku,
      item.product_url,
      sp.unit,
      sp.min_quantity,
      sp.unit_price_cents,
      sp.currency,
      sp.valid_from,
      sp.valid_to,
      sp.is_active,
      sp.source_import_id,
      sp.source_mapped_row_id,
      sp.notes,
      s.name as supplier_name,
      p.designation as product_name,
      p.reference as product_reference,
      greatest(current_date - coalesce(sp.updated_at, sp.created_at)::date, 0)::integer as age_days,
      case
        when current_date - coalesce(sp.updated_at, sp.created_at)::date <= 30 then 'fresh'
        when current_date - coalesce(sp.updated_at, sp.created_at)::date <= 90 then 'aging'
        else 'stale'
      end as freshness
    from public.supplier_pricebook sp
    join public.supplier_catalog_items item on item.id = sp.supplier_catalog_item_id
    join public.suppliers s on s.id = sp.supplier_id
    join public.products p on p.id = sp.product_id
  ),
  filtered as (
    select e.*
    from enriched e
    where (p_product_id is null or e.product_id = p_product_id)
      and (p_supplier_id is null or e.supplier_id = p_supplier_id)
      and (cardinality(p_freshness) = 0 or e.freshness = any(p_freshness))
      and (
        nullif(btrim(p_q), '') is null
        or public.catalogue_normalize_search(coalesce(e.supplier_name, ''))
          like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
        or public.catalogue_normalize_search(
          coalesce(e.product_reference, '') || ' ' || coalesce(e.product_name, '')
        ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
        or public.catalogue_normalize_search(coalesce(e.supplier_sku, ''))
          like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
      )
  )
  select
    f.id,
    f.created_at,
    f.updated_at,
    f.supplier_id,
    f.product_id,
    f.supplier_catalog_item_id,
    f.supplier_sku,
    f.product_url,
    f.unit,
    f.min_quantity,
    f.unit_price_cents,
    f.currency,
    f.valid_from,
    f.valid_to,
    f.is_active,
    f.source_import_id,
    f.source_mapped_row_id,
    f.notes,
    f.supplier_name,
    f.product_name,
    f.product_reference,
    f.freshness,
    f.age_days,
    count(*) over ()::bigint as total_count
  from filtered f
  order by
    case when p_sort = 'supplier' and p_dir = 'asc' then lower(f.supplier_name) end asc,
    case when p_sort = 'supplier' and p_dir = 'desc' then lower(f.supplier_name) end desc,
    case when p_sort = 'product' and p_dir = 'asc' then lower(f.product_name) end asc,
    case when p_sort = 'product' and p_dir = 'desc' then lower(f.product_name) end desc,
    case when p_sort = 'unit_price_cents' and p_dir = 'asc' then f.unit_price_cents end asc,
    case when p_sort = 'unit_price_cents' and p_dir = 'desc' then f.unit_price_cents end desc,
    case when p_sort = 'updated_at' and p_dir = 'asc' then f.updated_at end asc,
    case when p_sort = 'updated_at' and p_dir = 'desc' then f.updated_at end desc,
    f.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

revoke execute on function public.supplier_prices_page(
  text, text[], uuid, uuid, text, text, integer, integer
) from public, anon;

grant execute on function public.supplier_prices_page(
  text, text[], uuid, uuid, text, text, integer, integer
) to authenticated;
