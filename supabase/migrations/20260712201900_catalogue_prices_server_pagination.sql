create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create or replace function public.catalogue_normalize_search(value text)
returns text
language sql
immutable
strict
parallel safe
security invoker
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, value));
$$;

revoke execute on function public.catalogue_normalize_search(text) from public, anon;
grant execute on function public.catalogue_normalize_search(text) to authenticated;

create index if not exists products_tenant_search_trgm_idx
  on public.products using gin (
    public.catalogue_normalize_search(
      coalesce(reference, '') || ' ' ||
      coalesce(designation, '') || ' ' ||
      coalesce(category, '') || ' ' ||
      coalesce(product_type, '') || ' ' ||
      coalesce(material, '') || ' ' ||
      coalesce(grade, '') || ' ' ||
      coalesce(dimensions, '') || ' ' ||
      coalesce(standard, '')
    ) extensions.gin_trgm_ops
  );

create index if not exists products_price_lookup_search_trgm_idx
  on public.products using gin (
    public.catalogue_normalize_search(
      coalesce(reference, '') || ' ' || coalesce(designation, '')
    ) extensions.gin_trgm_ops
  );

create index if not exists suppliers_tenant_name_search_trgm_idx
  on public.suppliers using gin (
    public.catalogue_normalize_search(coalesce(name, '')) extensions.gin_trgm_ops
  );

create index if not exists products_tenant_active_updated_idx
  on public.products (tenant_id, is_active, updated_at desc, id);

create index if not exists supplier_pricebook_tenant_product_valid_price_idx
  on public.supplier_pricebook (
    tenant_id,
    product_id,
    valid_from,
    valid_to,
    unit_price_cents,
    updated_at desc
  )
  where is_active;

create index if not exists supplier_pricebook_tenant_updated_idx
  on public.supplier_pricebook (tenant_id, updated_at desc, id);

create index if not exists supplier_pricebook_tenant_sku_search_trgm_idx
  on public.supplier_pricebook using gin (
    public.catalogue_normalize_search(coalesce(supplier_sku, '')) extensions.gin_trgm_ops
  );

create or replace function public.catalogue_products_page(
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
      p.id,
      p.created_at,
      p.updated_at,
      p.reference,
      p.designation,
      p.unit_price_cents,
      p.tax_rate_bp,
      p.is_active,
      p.category,
      p.product_type,
      p.material,
      p.grade,
      p.dimensions,
      p.standard,
      p.unit,
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
    from public.products p
    left join lateral (
      select
        sp.id,
        sp.unit_price_cents,
        s.name as supplier_name,
        coalesce(sp.updated_at, sp.created_at) as price_updated_at,
        count(*) over ()::bigint as price_count
      from public.supplier_pricebook sp
      join public.suppliers s on s.id = sp.supplier_id
      where sp.product_id = p.id
        and sp.is_active
        and sp.valid_from <= current_date
        and (sp.valid_to is null or sp.valid_to >= current_date)
      order by sp.unit_price_cents asc, sp.updated_at desc, sp.id asc
      limit 1
    ) best_price on true
  ),
  filtered as (
    select e.*
    from enriched e
    where (
      nullif(btrim(p_q), '') is null
      or public.catalogue_normalize_search(
        coalesce(e.reference, '') || ' ' ||
        coalesce(e.designation, '') || ' ' ||
        coalesce(e.category, '') || ' ' ||
        coalesce(e.product_type, '') || ' ' ||
        coalesce(e.material, '') || ' ' ||
        coalesce(e.grade, '') || ' ' ||
        coalesce(e.dimensions, '') || ' ' ||
        coalesce(e.standard, '')
      ) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
    )
      and (cardinality(p_materials) = 0 or coalesce(e.material, '') = any(p_materials))
      and (cardinality(p_categories) = 0 or coalesce(e.category, '') = any(p_categories))
      and (cardinality(p_units) = 0 or coalesce(e.unit, '') = any(p_units))
      and (cardinality(p_price_statuses) = 0 or e.price_status = any(p_price_statuses))
      and (
        cardinality(p_statuses) = 0
        or (e.is_active and 'active' = any(p_statuses))
        or (not e.is_active and 'archived' = any(p_statuses))
      )
  )
  select
    f.id,
    f.created_at,
    f.updated_at,
    f.reference,
    f.designation,
    f.unit_price_cents,
    f.tax_rate_bp,
    f.is_active,
    f.category,
    f.product_type,
    f.material,
    f.grade,
    f.dimensions,
    f.standard,
    f.unit,
    f.supplier_price_count,
    f.best_supplier_price_cents,
    f.best_supplier_name,
    f.best_supplier_price_updated_at,
    f.price_status,
    count(*) over ()::bigint as total_count
  from filtered f
  order by
    case when p_sort = 'designation' and p_dir = 'asc' then lower(f.designation) end asc,
    case when p_sort = 'designation' and p_dir = 'desc' then lower(f.designation) end desc,
    case when p_sort = 'material' and p_dir = 'asc' then lower(f.material) end asc nulls last,
    case when p_sort = 'material' and p_dir = 'desc' then lower(f.material) end desc nulls last,
    case when p_sort = 'unit_price_cents' and p_dir = 'asc' then f.unit_price_cents end asc,
    case when p_sort = 'unit_price_cents' and p_dir = 'desc' then f.unit_price_cents end desc,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'asc' then f.best_supplier_price_cents end asc nulls last,
    case when p_sort = 'best_supplier_price_cents' and p_dir = 'desc' then f.best_supplier_price_cents end desc nulls last,
    case when p_sort = 'updated_at' and p_dir = 'asc' then f.updated_at end asc,
    case when p_sort = 'updated_at' and p_dir = 'desc' then f.updated_at end desc,
    f.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

create or replace function public.catalogue_products_summary()
returns table (
  active_count bigint,
  covered_count bigint,
  without_supplier_price_count bigint,
  stale_count bigint,
  materials text[],
  categories text[],
  units text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with enriched as (
    select
      p.*,
      best_price.id as best_price_id,
      best_price.price_updated_at
    from public.products p
    left join lateral (
      select sp.id, coalesce(sp.updated_at, sp.created_at) as price_updated_at
      from public.supplier_pricebook sp
      where sp.product_id = p.id
        and sp.is_active
        and sp.valid_from <= current_date
        and (sp.valid_to is null or sp.valid_to >= current_date)
      order by sp.unit_price_cents asc, sp.updated_at desc, sp.id asc
      limit 1
    ) best_price on true
  )
  select
    count(*) filter (where e.is_active)::bigint,
    count(*) filter (where e.best_price_id is not null)::bigint,
    count(*) filter (where e.best_price_id is null)::bigint,
    count(*) filter (
      where e.best_price_id is not null
        and current_date - e.price_updated_at::date > 90
    )::bigint,
    coalesce(array_agg(distinct e.material order by e.material) filter (where nullif(btrim(e.material), '') is not null), '{}'::text[]),
    coalesce(array_agg(distinct e.category order by e.category) filter (where nullif(btrim(e.category), '') is not null), '{}'::text[]),
    coalesce(array_agg(distinct e.unit order by e.unit) filter (where nullif(btrim(e.unit), '') is not null), '{}'::text[])
  from enriched e;
$$;

create or replace function public.supplier_prices_page(
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
  supplier_sku text,
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
      sp.supplier_sku,
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
    f.supplier_sku,
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

create or replace function public.supplier_prices_summary(
  p_product_id uuid default null,
  p_supplier_id uuid default null
)
returns table (
  total_count bigint,
  fresh_count bigint,
  aging_count bigint,
  stale_count bigint,
  unique_suppliers_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(*) filter (where current_date - coalesce(sp.updated_at, sp.created_at)::date <= 30)::bigint,
    count(*) filter (
      where current_date - coalesce(sp.updated_at, sp.created_at)::date between 31 and 90
    )::bigint,
    count(*) filter (where current_date - coalesce(sp.updated_at, sp.created_at)::date > 90)::bigint,
    count(distinct sp.supplier_id)::bigint
  from public.supplier_pricebook sp
  where (p_product_id is null or sp.product_id = p_product_id)
    and (p_supplier_id is null or sp.supplier_id = p_supplier_id);
$$;

create or replace function public.price_lookup_options(
  p_kind text,
  p_q text default null,
  p_selected_id uuid default null,
  p_limit integer default 50
)
returns table (
  kind text,
  id uuid,
  label text,
  reference text
)
language sql
stable
security invoker
set search_path = ''
as $$
  (
    select
      'supplier'::text,
      s.id,
      s.name,
      null::text
    from public.suppliers s
    where p_kind = 'supplier'
      and (s.is_active or s.id = p_selected_id)
      and (
        s.id = p_selected_id
        or nullif(btrim(p_q), '') is null
        or public.catalogue_normalize_search(s.name) like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
      )
    order by (s.id = p_selected_id) desc, lower(s.name), s.id
    limit least(greatest(p_limit, 1), 50)
  )
  union all
  (
    select
      'product'::text,
      p.id,
      p.designation,
      p.reference
    from public.products p
    where p_kind = 'product'
      and (p.is_active or p.id = p_selected_id)
      and (
        p.id = p_selected_id
        or nullif(btrim(p_q), '') is null
        or public.catalogue_normalize_search(coalesce(p.reference, '') || ' ' || p.designation)
          like '%' || public.catalogue_normalize_search(btrim(p_q)) || '%'
      )
    order by (p.id = p_selected_id) desc, lower(p.designation), p.id
    limit least(greatest(p_limit, 1), 50)
  );
$$;

revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) from public, anon;
revoke execute on function public.catalogue_products_summary() from public, anon;
revoke execute on function public.supplier_prices_page(text, text[], uuid, uuid, text, text, integer, integer) from public, anon;
revoke execute on function public.supplier_prices_summary(uuid, uuid) from public, anon;
revoke execute on function public.price_lookup_options(text, text, uuid, integer) from public, anon;

grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer) to authenticated;
grant execute on function public.catalogue_products_summary() to authenticated;
grant execute on function public.supplier_prices_page(text, text[], uuid, uuid, text, text, integer, integer) to authenticated;
grant execute on function public.supplier_prices_summary(uuid, uuid) to authenticated;
grant execute on function public.price_lookup_options(text, text, uuid, integer) to authenticated;
