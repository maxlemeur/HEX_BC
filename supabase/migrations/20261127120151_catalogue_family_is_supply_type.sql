-- The catalogue goes from three classification levels to two: the family of an article is its supply type
-- (public.supply_types, which already drives the K FO and the preferred supplier) and its type is
-- products.product_type. The free-text products.category stops being written and read by the application.
--
-- This migration only adds: the column, its index and the summary's « categories » stay, and the page still
-- accepts p_categories and returns « category », so the application deployed before this change keeps working.
-- A later migration drops them once no client reads them.

-- 1. Catalogue page: filter by supply type, and search its name where the free-text family was searched.
drop function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[]);

-- Copied from 20261111224927; adds p_supply_type_ids and the supply type's name to the searched text.
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
  p_size integer default 25,
  p_catalogue_statuses text[] default '{}'::text[],
  p_supply_type_ids uuid[] default '{}'::uuid[]
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
  reference_quantity numeric,
  reference_transport_mode text,
  reference_price_validation_id uuid,
  reference_price_source_order_id uuid,
  reference_price_source_order_reference text,
  reference_price_source_supplier_name text,
  reference_price_source_date date,
  supplier_price_count bigint,
  best_supplier_price_cents integer,
  best_supplier_name text,
  best_supplier_price_updated_at timestamptz,
  price_status text,
  catalogue_status text,
  supply_type_id uuid,
  supply_type_name text,
  reliability_score smallint,
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
      product.reference_quantity,
      product.reference_transport_mode,
      product.reference_price_validation_id,
      product.reference_price_source_order_id,
      reference_order.reference as reference_price_source_order_reference,
      reference_supplier.name as reference_price_source_supplier_name,
      product.reference_price_source_date,
      coalesce(best_price.price_count, 0)::bigint as supplier_price_count,
      case when best_price.price_eligible then best_price.unit_price_cents end as best_supplier_price_cents,
      case when best_price.price_eligible then best_price.supplier_name end as best_supplier_name,
      case when best_price.price_eligible then best_price.price_updated_at end as best_supplier_price_updated_at,
      case
        when best_price.id is null or not best_price.price_eligible then 'none'
        when current_date - best_price.price_updated_at::date <= 30 then 'fresh'
        when current_date - best_price.price_updated_at::date <= 90 then 'aging'
        else 'stale'
      end as price_status,
      product.catalogue_status,
      product.supply_type_id,
      supply_type.name as supply_type_name,
      product.reliability_score
    from public.products product
    left join public.supply_types supply_type
      on supply_type.id = product.supply_type_id
      and supply_type.tenant_id = product.tenant_id
    left join public.purchase_orders reference_order
      on reference_order.id = product.reference_price_source_order_id
      and reference_order.tenant_id = product.tenant_id
    left join public.suppliers reference_supplier
      on reference_supplier.id = reference_order.supplier_id
      and reference_supplier.tenant_id = product.tenant_id
    left join lateral (
      select
        supplier_price.id,
        -- 2.9: compared and shown per estimate unit (a bar of 3 m at 262,45 € is 87,48 € per metre).
        case when supplier_price.estimate_units_per_purchase_unit is not null
          then pg_catalog.round(supplier_price.unit_price_cents / supplier_price.estimate_units_per_purchase_unit)::integer
          else supplier_price.unit_price_cents end as unit_price_cents,
        supplier.name as supplier_name,
        coalesce(supplier_price.updated_at, supplier_price.created_at) as price_updated_at,
        public.supplier_offer_price_eligible(supplier_price.unit_price_cents, supplier_price.zero_price_kind) as price_eligible,
        count(*) over ()::bigint as price_count
      from public.supplier_pricebook supplier_price
      join public.suppliers supplier on supplier.id = supplier_price.supplier_id
      where supplier_price.product_id = product.id
        and supplier_price.is_active
        and supplier_price.valid_from <= current_date
        and (supplier_price.valid_to is null or supplier_price.valid_to >= current_date)
      order by public.supplier_offer_price_eligible(supplier_price.unit_price_cents, supplier_price.zero_price_kind) desc,
        case when supplier_price.estimate_units_per_purchase_unit is not null
          then pg_catalog.round(supplier_price.unit_price_cents / supplier_price.estimate_units_per_purchase_unit)
          else supplier_price.unit_price_cents end asc, supplier_price.updated_at desc, supplier_price.id asc
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
        coalesce(enriched.supply_type_name, '') || ' ' ||
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
      and (cardinality(p_catalogue_statuses) = 0 or enriched.catalogue_status = any(p_catalogue_statuses))
      and (cardinality(p_supply_type_ids) = 0 or enriched.supply_type_id = any(p_supply_type_ids))
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
    filtered.reference_quantity,
    filtered.reference_transport_mode,
    filtered.reference_price_validation_id,
    filtered.reference_price_source_order_id,
    filtered.reference_price_source_order_reference,
    filtered.reference_price_source_supplier_name,
    filtered.reference_price_source_date,
    filtered.supplier_price_count,
    filtered.best_supplier_price_cents,
    filtered.best_supplier_name,
    filtered.best_supplier_price_updated_at,
    filtered.price_status,
    filtered.catalogue_status,
    filtered.supply_type_id,
    filtered.supply_type_name,
    filtered.reliability_score,
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
    -- Review queue: an unrated article never outranks a rated one, whatever the direction.
    case when p_sort = 'reliability_score' and p_dir = 'asc' then filtered.reliability_score end asc nulls last,
    case when p_sort = 'reliability_score' and p_dir = 'desc' then filtered.reliability_score end desc nulls last,
    filtered.id asc
  offset (greatest(p_page, 1) - 1) * least(greatest(p_size, 1), 100)
  limit least(greatest(p_size, 1), 100);
$$;

revoke execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[], uuid[]) from public, anon;
grant execute on function public.catalogue_products_page(text, text[], text[], text[], text[], text[], text, text, integer, integer, text[], uuid[]) to authenticated;

-- 2. Article created with a supplier offer: it takes a supply type instead of a free-text family.
-- Copied from 20260714181702. The insert also named products.tax_rate_bp, dropped by 20260819230500, so
-- creating an article through this function failed since then (undefined_column).
create or replace function public.create_supplier_catalog_price(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  target_tenant_id uuid := public.current_tenant_id();
  supplier_id_value uuid := nullif(payload->>'supplier_id', '')::uuid;
  product_id_value uuid := nullif(payload->>'product_id', '')::uuid;
  new_supplier jsonb := payload->'new_supplier';
  new_product jsonb := payload->'new_product';
  price_payload jsonb := coalesce(payload->'price', '{}'::jsonb);
  supplier_sku_value text := nullif(btrim(payload->>'supplier_sku'), '');
  product_url_value text := nullif(btrim(payload->>'product_url'), '');
  product_unit text;
  catalog_item public.supplier_catalog_items%rowtype;
  created_price public.supplier_pricebook%rowtype;
begin
  if actor_id is null or target_tenant_id is null then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  if not public.has_tenant_role(
    target_tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ) then
    raise insufficient_privilege using message = 'Admin or engineer role required.';
  end if;

  if (supplier_id_value is null) = (new_supplier is null) then
    raise invalid_parameter_value using message = 'Provide exactly one existing or new supplier.';
  end if;

  if (product_id_value is null) = (new_product is null) then
    raise invalid_parameter_value using message = 'Provide exactly one existing or new product.';
  end if;

  if product_url_value is not null and product_url_value !~* '^https?://[^[:space:]]+$' then
    raise invalid_parameter_value using message = 'Product URL must use HTTP or HTTPS.';
  end if;

  if nullif(price_payload->>'source_import_id', '') is not null
    and not exists (
      select 1
      from public.dpgf_imports source_import
      where source_import.id = (price_payload->>'source_import_id')::uuid
        and source_import.tenant_id = target_tenant_id
    ) then
    raise invalid_parameter_value using
      message = 'Source import not found in active tenant.';
  end if;

  if nullif(price_payload->>'source_mapped_row_id', '') is not null
    and not exists (
      select 1
      from public.dpgf_rows_mapped mapped_row
      where mapped_row.id = (price_payload->>'source_mapped_row_id')::uuid
        and mapped_row.tenant_id = target_tenant_id
        and (
          nullif(price_payload->>'source_import_id', '') is null
          or mapped_row.import_id = (price_payload->>'source_import_id')::uuid
        )
    ) then
    raise invalid_parameter_value using
      message = 'Source mapped row not found in active tenant or import.';
  end if;

  if supplier_id_value is null then
    if nullif(btrim(new_supplier->>'name'), '') is null then
      raise invalid_parameter_value using message = 'Supplier name is required.';
    end if;

    insert into public.suppliers (
      tenant_id, name, address, city, postal_code, country, email, phone,
      contact_name, siret, vat_number, payment_terms, is_active
    ) values (
      target_tenant_id,
      btrim(new_supplier->>'name'),
      nullif(btrim(new_supplier->>'address'), ''),
      nullif(btrim(new_supplier->>'city'), ''),
      nullif(btrim(new_supplier->>'postal_code'), ''),
      coalesce(nullif(btrim(new_supplier->>'country'), ''), 'France'),
      nullif(btrim(new_supplier->>'email'), ''),
      nullif(btrim(new_supplier->>'phone'), ''),
      nullif(btrim(new_supplier->>'contact_name'), ''),
      nullif(btrim(new_supplier->>'siret'), ''),
      nullif(btrim(new_supplier->>'vat_number'), ''),
      nullif(btrim(new_supplier->>'payment_terms'), ''),
      true
    ) returning id into supplier_id_value;
  elsif not exists (
    select 1 from public.suppliers s
    where s.id = supplier_id_value and s.tenant_id = target_tenant_id
  ) then
    raise invalid_parameter_value using message = 'Supplier not found in active tenant.';
  end if;

  if product_id_value is null then
    if nullif(btrim(new_product->>'designation'), '') is null then
      raise invalid_parameter_value using message = 'Product designation is required.';
    end if;

    -- The family of the new article is one of the tenant's supply types: the trigger
    -- validate_product_catalogue_status refuses any other (PRODUCT_SUPPLY_TYPE_INVALID).
    insert into public.products (
      tenant_id, reference, designation, supply_type_id, product_type, material,
      grade, dimensions, standard, unit, unit_price_cents, is_active
    ) values (
      target_tenant_id,
      nullif(btrim(new_product->>'reference'), ''),
      btrim(new_product->>'designation'),
      nullif(btrim(new_product->>'supply_type_id'), '')::uuid,
      nullif(btrim(new_product->>'product_type'), ''),
      nullif(btrim(new_product->>'material'), ''),
      nullif(btrim(new_product->>'grade'), ''),
      nullif(btrim(new_product->>'dimensions'), ''),
      nullif(btrim(new_product->>'standard'), ''),
      coalesce(nullif(btrim(new_product->>'unit'), ''), 'u'),
      coalesce(nullif(new_product->>'unit_price_cents', '')::integer, 0),
      true
    ) returning id, unit into product_id_value, product_unit;
  else
    select p.unit into product_unit
    from public.products p
    where p.id = product_id_value and p.tenant_id = target_tenant_id;

    if product_unit is null then
      raise invalid_parameter_value using message = 'Product not found in active tenant.';
    end if;
  end if;

  insert into public.supplier_catalog_items (
    tenant_id, supplier_id, product_id, supplier_sku, product_url, is_active, created_by
  ) values (
    target_tenant_id, supplier_id_value, product_id_value,
    supplier_sku_value, product_url_value, true, actor_id
  )
  on conflict (tenant_id, supplier_id, product_id)
  do update set is_active = true;

  select item.* into catalog_item
  from public.supplier_catalog_items item
  where item.tenant_id = target_tenant_id
    and item.supplier_id = supplier_id_value
    and item.product_id = product_id_value
  for update;

  if catalog_item.supplier_sku is not null
    and supplier_sku_value is not null
    and lower(catalog_item.supplier_sku) is distinct from lower(supplier_sku_value) then
    raise exception 'SUPPLIER_CATALOG_REFERENCE_CONFLICT' using errcode = 'P0001';
  end if;

  if catalog_item.product_url is not null
    and product_url_value is not null
    and catalog_item.product_url is distinct from product_url_value then
    raise exception 'SUPPLIER_CATALOG_URL_CONFLICT' using errcode = 'P0001';
  end if;

  update public.supplier_catalog_items item
  set
    supplier_sku = coalesce(item.supplier_sku, supplier_sku_value),
    product_url = coalesce(item.product_url, product_url_value),
    is_active = true
  where item.id = catalog_item.id
  returning item.* into catalog_item;

  insert into public.supplier_pricebook (
    tenant_id, supplier_catalog_item_id, supplier_id, product_id, supplier_sku,
    unit, min_quantity, unit_price_cents, currency, valid_from, valid_to,
    is_active, source_import_id, source_mapped_row_id, created_by, notes
  ) values (
    target_tenant_id,
    catalog_item.id,
    supplier_id_value,
    product_id_value,
    catalog_item.supplier_sku,
    coalesce(nullif(btrim(price_payload->>'unit'), ''), product_unit, 'u'),
    coalesce(nullif(price_payload->>'min_quantity', '')::numeric(12,3), 1),
    (price_payload->>'unit_price_cents')::integer,
    upper(coalesce(nullif(btrim(price_payload->>'currency'), ''), 'EUR')),
    coalesce(nullif(price_payload->>'valid_from', '')::date, current_date),
    nullif(price_payload->>'valid_to', '')::date,
    coalesce(nullif(price_payload->>'is_active', '')::boolean, true),
    nullif(price_payload->>'source_import_id', '')::uuid,
    nullif(price_payload->>'source_mapped_row_id', '')::uuid,
    actor_id,
    coalesce(nullif(price_payload->>'notes', ''), nullif(price_payload->>'source', ''))
  ) returning * into created_price;

  return to_jsonb(created_price) || jsonb_build_object(
    'supplier_catalog_item_id', catalog_item.id,
    'supplier_sku', catalog_item.supplier_sku,
    'product_url', catalog_item.product_url
  );
end;
$$;

revoke execute on function public.create_supplier_catalog_price(jsonb) from public, anon;
grant execute on function public.create_supplier_catalog_price(jsonb) to authenticated;
