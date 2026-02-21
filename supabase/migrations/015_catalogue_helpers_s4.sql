-- Migration S4 (BC-009): helper SQL functions for bulk catalogue/pricebook/index operations.

create or replace function public.bulk_create_supplier_prices(
  price_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  inserted_count integer := 0;
begin
  if coalesce(jsonb_typeof(price_rows), '') <> 'array' then
    raise exception 'price_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(price_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.supplier_pricebook (
    tenant_id,
    supplier_id,
    product_id,
    supplier_sku,
    unit,
    min_quantity,
    unit_price_cents,
    currency,
    valid_from,
    valid_to,
    is_active,
    source_import_id,
    source_mapped_row_id,
    created_by,
    notes
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'supplier_id')::uuid,
    (item->>'product_id')::uuid,
    nullif(item->>'supplier_sku', ''),
    coalesce(nullif(item->>'unit', ''), 'u'),
    coalesce(nullif(item->>'min_quantity', '')::numeric(12,3), 1),
    (item->>'unit_price_cents')::integer,
    coalesce(nullif(item->>'currency', ''), 'EUR'),
    coalesce(nullif(item->>'valid_from', '')::date, current_date),
    nullif(item->>'valid_to', '')::date,
    coalesce(nullif(item->>'is_active', '')::boolean, true),
    nullif(item->>'source_import_id', '')::uuid,
    nullif(item->>'source_mapped_row_id', '')::uuid,
    coalesce(nullif(item->>'created_by', '')::uuid, (select auth.uid())),
    nullif(item->>'notes', '')
  from jsonb_array_elements(price_rows) as item
  on conflict (tenant_id, supplier_id, product_id, currency, valid_from, min_quantity)
  do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.bulk_upsert_material_indices(
  index_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  if coalesce(jsonb_typeof(index_rows), '') <> 'array' then
    raise exception 'index_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(index_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.material_indices (
    tenant_id,
    index_code,
    label,
    index_date,
    index_value,
    unit,
    source,
    metadata,
    created_by
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'index_code')::text,
    coalesce(nullif(item->>'label', ''), (item->>'index_code')::text),
    (item->>'index_date')::date,
    (item->>'index_value')::numeric(14,6),
    coalesce(nullif(item->>'unit', ''), 'base_100'),
    nullif(item->>'source', ''),
    case
      when jsonb_typeof(item->'metadata') = 'object'
        then item->'metadata'
      else '{}'::jsonb
    end,
    coalesce(nullif(item->>'created_by', '')::uuid, (select auth.uid()))
  from jsonb_array_elements(index_rows) as item
  on conflict (tenant_id, index_code, index_date)
  do update
  set
    label = excluded.label,
    index_value = excluded.index_value,
    unit = excluded.unit,
    source = excluded.source,
    metadata = excluded.metadata,
    created_by = coalesce(excluded.created_by, material_indices.created_by),
    updated_at = now();

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

create or replace function public.link_mapped_rows_to_catalogue(
  link_rows jsonb,
  target_tenant_id uuid default public.current_tenant_id()
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  affected_count integer := 0;
begin
  if coalesce(jsonb_typeof(link_rows), '') <> 'array' then
    raise exception 'link_rows must be a JSON array';
  end if;

  if coalesce(jsonb_array_length(link_rows), 0) = 0 then
    return 0;
  end if;

  insert into public.dpgf_catalogue_links (
    tenant_id,
    import_id,
    mapped_row_id,
    product_id,
    supplier_price_id,
    material_index_id,
    status,
    message
  )
  select
    coalesce(nullif(item->>'tenant_id', '')::uuid, target_tenant_id),
    (item->>'import_id')::uuid,
    (item->>'mapped_row_id')::uuid,
    nullif(item->>'product_id', '')::uuid,
    nullif(item->>'supplier_price_id', '')::uuid,
    nullif(item->>'material_index_id', '')::uuid,
    coalesce(nullif(item->>'status', ''), 'linked'),
    nullif(item->>'message', '')
  from jsonb_array_elements(link_rows) as item
  on conflict (tenant_id, mapped_row_id)
  do update
  set
    import_id = excluded.import_id,
    product_id = excluded.product_id,
    supplier_price_id = excluded.supplier_price_id,
    material_index_id = excluded.material_index_id,
    status = excluded.status,
    message = excluded.message,
    updated_at = now();

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$$;

grant execute on function public.bulk_create_supplier_prices(jsonb, uuid) to authenticated;
grant execute on function public.bulk_upsert_material_indices(jsonb, uuid) to authenticated;
grant execute on function public.link_mapped_rows_to_catalogue(jsonb, uuid) to authenticated;
