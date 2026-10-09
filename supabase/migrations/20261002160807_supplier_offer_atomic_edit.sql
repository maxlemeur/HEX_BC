-- TI-579: one offer form, one transaction. A price failure also rolls back SKU/URL.
create function public.update_supplier_offer(p_price_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
-- Shared metadata has SELECT-only grants. This narrow RPC supplies explicit
-- authorization, like update_supplier_catalog_item, without widening table RLS.
security definer
set search_path = ''
as $$
declare
  offer public.supplier_pricebook%rowtype;
  catalogue_item public.supplier_catalog_items%rowtype;
  tenant uuid := public.current_tenant_id();
begin
  if auth.uid() is null or tenant is null or not public.is_tenant_member(tenant)
    or not public.has_tenant_role(tenant, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]) then
    raise insufficient_privilege using message = 'Supplier offer access denied.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise invalid_parameter_value using message = 'Offer patch required.';
  end if;
  if exists (select 1 from jsonb_object_keys(p_patch) k where k not in (
    'unit', 'min_quantity', 'unit_price_cents', 'currency', 'valid_from', 'valid_to',
    'is_active', 'source', 'notes', 'supplier_sku', 'product_url', 'transport_mode'
  )) then
    raise invalid_parameter_value using message = 'Unsupported offer field.';
  end if;
  if nullif(btrim(p_patch->>'product_url'), '') is not null
    and btrim(p_patch->>'product_url') !~* '^https?://[^[:space:]]+$' then
    raise invalid_parameter_value using message = 'HTTP supplier URL required.';
  end if;
  select * into offer from public.supplier_pricebook p where p.id = p_price_id and p.tenant_id = tenant;
  if not found then raise no_data_found using message = 'SUPPLIER_OFFER_NOT_FOUND'; end if;
  -- Match creation and metadata edits: shared item before price. Re-read the
  -- locked price; an association changed while waiting must abort this edit.
  select * into catalogue_item from public.supplier_catalog_items c
    where c.id = offer.supplier_catalog_item_id and c.tenant_id = tenant
      and c.product_id = offer.product_id and c.supplier_id = offer.supplier_id for update;
  if not found then raise no_data_found using message = 'SUPPLIER_CATALOG_ITEM_NOT_FOUND'; end if;
  select * into offer from public.supplier_pricebook p
    where p.id = p_price_id and p.tenant_id = tenant for update;
  if not found then raise no_data_found using message = 'SUPPLIER_OFFER_NOT_FOUND'; end if;
  if offer.supplier_catalog_item_id is distinct from catalogue_item.id
    or offer.product_id is distinct from catalogue_item.product_id
    or offer.supplier_id is distinct from catalogue_item.supplier_id then
    raise serialization_failure using message = 'SUPPLIER_OFFER_ASSOCIATION_CHANGED';
  end if;

  if p_patch ? 'supplier_sku' or p_patch ? 'product_url' then
    update public.supplier_catalog_items set
    supplier_sku = case when p_patch ? 'supplier_sku' then nullif(btrim(p_patch->>'supplier_sku'), '') else supplier_sku end,
    product_url = case when p_patch ? 'product_url' then nullif(btrim(p_patch->>'product_url'), '') else product_url end
  where id = catalogue_item.id and tenant_id = tenant returning * into catalogue_item;
    if not found then raise insufficient_privilege using message = 'Supplier catalogue edit denied.'; end if;
  end if;

  update public.supplier_pricebook set
    unit = case when p_patch ? 'unit' then p_patch->>'unit' else unit end,
    min_quantity = case when p_patch ? 'min_quantity' then (p_patch->>'min_quantity')::numeric else min_quantity end,
    unit_price_cents = case when p_patch ? 'unit_price_cents' then (p_patch->>'unit_price_cents')::integer else unit_price_cents end,
    currency = case when p_patch ? 'currency' then p_patch->>'currency' else currency end,
    valid_from = case when p_patch ? 'valid_from' then (p_patch->>'valid_from')::date else valid_from end,
    valid_to = case when p_patch ? 'valid_to' then (p_patch->>'valid_to')::date else valid_to end,
    is_active = case when p_patch ? 'is_active' then (p_patch->>'is_active')::boolean else is_active end,
    transport_mode = case when p_patch ? 'transport_mode' then p_patch->>'transport_mode' else transport_mode end,
    notes = case when p_patch ? 'notes' or p_patch ? 'source'
      then coalesce(p_patch->>'notes', p_patch->>'source') else notes end
  where id = p_price_id and tenant_id = tenant returning * into offer;
  if not found then raise insufficient_privilege using message = 'Supplier price edit denied.'; end if;
  return to_jsonb(offer) || jsonb_build_object(
    'supplier_sku', catalogue_item.supplier_sku,
    'product_url', catalogue_item.product_url
  );
end;
$$;
revoke all on function public.update_supplier_offer(uuid, jsonb) from public, anon;
grant execute on function public.update_supplier_offer(uuid, jsonb) to authenticated;
