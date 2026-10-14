-- PRICE-02: exclude zero quotes without suppressing comparable positive offers,
-- and include the final calendar day of a supplier quote's validity.
-- CREATE OR REPLACE preserves the existing function owner and ACL. No validation
-- history, locking trigger, tenant policy or consumer price is rewritten.
begin;

do $$
begin
  if to_regprocedure('public.product_reference_price_proposal(uuid,numeric,text)') is null then
    raise exception 'TI-537 product_reference_price_proposal must be installed first.';
  end if;
end;
$$;

create or replace function public.product_reference_price_proposal(
  p_product_id uuid,
  p_quantity numeric default null,
  p_transport_mode text default null
)
returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  product public.products%rowtype;
  quantity_value numeric;
  transport_value text;
  offers jsonb;
  result jsonb;
  offer_count integer;
  average_cents integer;
  minimum_cents integer;
  maximum_cents integer;
  zero_price_requires_review boolean;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required.'; end if;
  select * into product from public.products p
  where p.id = p_product_id and p.tenant_id = public.current_tenant_id();
  if not found then raise no_data_found using message = 'PRODUCT_NOT_FOUND'; end if;
  quantity_value := coalesce(p_quantity, product.reference_quantity);
  transport_value := coalesce(p_transport_mode, product.reference_transport_mode);
  if quantity_value is not null and (quantity_value <= 0 or quantity_value > 999999999.999 or quantity_value <> round(quantity_value, 3)) then
    raise invalid_parameter_value using message = 'Invalid reference quantity.';
  end if;
  if transport_value is not null and transport_value not in ('included', 'excluded') then
    raise invalid_parameter_value using message = 'Invalid freight basis.';
  end if;

  with classified as (
    select sp.id, sp.supplier_id, s.name as supplier_name,
      coalesce(nullif(btrim(sp.supplier_sku), ''), nullif(btrim(sci.supplier_sku), '')) as supplier_sku,
      sp.unit_price_cents, sp.unit, sp.currency, sp.min_quantity,
      sp.valid_from, sp.valid_to, sp.updated_at, sp.transport_mode,
      sp.source_import_id, sp.source_mapped_row_id, sp.notes,
      case
        when not sp.is_active or not s.is_active or sci.is_active = false then 'inactive'
        when coalesce(nullif(btrim(sp.supplier_sku), ''), nullif(btrim(sci.supplier_sku), '')) is null then 'missing_supplier_reference'
        when sp.valid_from > current_date then 'future'
        when sp.valid_to < current_date or current_date > (sp.valid_from + interval '6 months')::date then 'expired'
        when quantity_value is null then 'missing_quantity'
        when sp.min_quantity > quantity_value then 'quantity'
        when lower(btrim(sp.unit)) <> lower(btrim(product.unit)) then 'unit'
        when upper(sp.currency) <> 'EUR' then 'currency'
        when transport_value is null or sp.transport_mode is null then 'missing_transport'
        when sp.transport_mode <> transport_value then 'transport'
        when sp.unit_price_cents = 0 then 'zero_price'
        else null
      end as exclusion
    from public.supplier_pricebook sp
    join public.suppliers s on s.id = sp.supplier_id and s.tenant_id = sp.tenant_id
    left join public.supplier_catalog_items sci on sci.id = sp.supplier_catalog_item_id
      and sci.tenant_id = sp.tenant_id and sci.product_id = sp.product_id and sci.supplier_id = sp.supplier_id
    where sp.product_id = product.id and sp.tenant_id = product.tenant_id
  ), ranked as (
    select c.*, row_number() over (
      partition by supplier_id, (exclusion is null)
      order by valid_from desc, updated_at desc, min_quantity desc, id desc
    ) as rank
    from classified c
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'supplier_id', supplier_id, 'supplier_name', supplier_name,
    'supplier_sku', supplier_sku, 'unit_price_cents', unit_price_cents,
    'unit', unit, 'currency', currency, 'min_quantity', min_quantity,
    'valid_from', valid_from, 'valid_to', valid_to, 'updated_at', updated_at,
    'transport_mode', transport_mode, 'source_import_id', source_import_id,
    'source_mapped_row_id', source_mapped_row_id, 'notes', notes,
    'exclusion', coalesce(exclusion, case when rank > 1 then 'older_supplier_offer' end)
  ) order by supplier_name, valid_from desc, id), '[]'::jsonb) into offers from ranked;

  select count(*)::integer, round(avg((o->>'unit_price_cents')::numeric))::integer,
    min((o->>'unit_price_cents')::integer), max((o->>'unit_price_cents')::integer)
  into offer_count, average_cents, minimum_cents, maximum_cents
  from jsonb_array_elements(offers) o where o->>'exclusion' is null;
  -- A zero quote is excluded above and remains visible for clarification.
  -- It does not cancel the mean of comparable positive offers.
  select exists(select 1 from jsonb_array_elements(offers) o where o->>'exclusion' = 'zero_price')
    into zero_price_requires_review;

  result := jsonb_build_object(
    'product_id', product.id, 'designation', product.designation,
    'quantity', quantity_value, 'unit', product.unit, 'currency', 'EUR',
    'transport_mode', transport_value, 'as_of', current_date,
    'current_price_cents', case when product.reference_price_validation_id is not null then product.unit_price_cents else nullif(product.unit_price_cents, 0) end,
    'validation_id', product.reference_price_validation_id,
    'product_updated_at', product.updated_at,
    'offer_count', offer_count, 'proposed_price_cents', average_cents,
    'zero_price_requires_review', zero_price_requires_review,
    'minimum_cents', minimum_cents, 'maximum_cents', maximum_cents,
    'dispersion_percent', case when minimum_cents > 0 then
      (maximum_cents::numeric - minimum_cents) * 100 / minimum_cents end,
    'dispersion_alert', coalesce((maximum_cents::numeric - minimum_cents) * 100 > minimum_cents::numeric * 15, false),
    'offers', offers
  );
  return result || jsonb_build_object('fingerprint', md5(result::text));
end;
$$;

commit;
