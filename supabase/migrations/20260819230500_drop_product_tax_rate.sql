-- Retrait de products.tax_rate_bp.
--
-- Le taux de TVA applicable depend du chantier (nature des travaux, anciennete du
-- local, qualite du client), pas de l'article. La colonne etait saisie et stockee
-- mais n'alimentait aucun calcul : le taux effectif vient de estimate_versions.tax_rate_bp,
-- du fichier DPGF importe, ou d'une saisie sur le bon de commande.
--
-- La RPC catalogue_products_page projetait la colonne : elle est recreee sans elle.

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

alter table public.products
  drop column if exists tax_rate_bp;

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

revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) from public, anon;

grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) to authenticated;
