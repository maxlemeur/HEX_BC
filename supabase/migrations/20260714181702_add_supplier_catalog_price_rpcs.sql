-- Atomic manual creation. Engineers are allowed through this narrow function
-- without receiving direct INSERT rights on products or suppliers.
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

    insert into public.products (
      tenant_id, reference, designation, category, product_type, material,
      grade, dimensions, standard, unit, unit_price_cents, tax_rate_bp, is_active
    ) values (
      target_tenant_id,
      nullif(btrim(new_product->>'reference'), ''),
      btrim(new_product->>'designation'),
      nullif(btrim(new_product->>'category'), ''),
      nullif(btrim(new_product->>'product_type'), ''),
      nullif(btrim(new_product->>'material'), ''),
      nullif(btrim(new_product->>'grade'), ''),
      nullif(btrim(new_product->>'dimensions'), ''),
      nullif(btrim(new_product->>'standard'), ''),
      coalesce(nullif(btrim(new_product->>'unit'), ''), 'u'),
      coalesce(nullif(new_product->>'unit_price_cents', '')::integer, 0),
      coalesce(nullif(new_product->>'tax_rate_bp', '')::integer, 2000),
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

create or replace function public.update_supplier_catalog_item(
  p_item_id uuid,
  p_supplier_sku text,
  p_product_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tenant_id uuid;
  normalized_sku text := nullif(btrim(p_supplier_sku), '');
  normalized_url text := nullif(btrim(p_product_url), '');
  updated_item public.supplier_catalog_items%rowtype;
begin
  if (select auth.uid()) is null then
    raise insufficient_privilege using message = 'Authentication required.';
  end if;

  select item.tenant_id into target_tenant_id
  from public.supplier_catalog_items item
  where item.id = p_item_id;

  if target_tenant_id is null then
    raise no_data_found using message = 'Supplier catalogue item not found.';
  end if;

  if not public.has_tenant_role(
    target_tenant_id,
    array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
  ) then
    raise insufficient_privilege using message = 'Admin or engineer role required.';
  end if;

  if normalized_url is not null and normalized_url !~* '^https?://[^[:space:]]+$' then
    raise invalid_parameter_value using message = 'Product URL must use HTTP or HTTPS.';
  end if;

  update public.supplier_catalog_items item
  set supplier_sku = normalized_sku, product_url = normalized_url
  where item.id = p_item_id
  returning item.* into updated_item;

  return to_jsonb(updated_item);
end;
$$;

revoke execute on function public.update_supplier_catalog_item(uuid, text, text) from public, anon;
grant execute on function public.update_supplier_catalog_item(uuid, text, text) to authenticated;
