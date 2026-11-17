-- TI-709: preserve prior validations and journal an explicit withdrawal atomically.
begin;

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
  -- PostgreSQL JSON preserves numeric scale, which would change the fingerprint
  -- between the stored default (100.000) and the same quantity sent back (100).
  quantity_value := trim_scale(coalesce(p_quantity, product.reference_quantity));
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

create table public.product_reference_price_withdrawals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  product_id uuid not null references public.products(id),
  previous_validation_id uuid references public.product_reference_price_validations(id),
  withdrawn_by uuid not null references auth.users(id),
  withdrawn_at timestamptz not null default transaction_timestamp(),
  product_updated_at timestamptz not null,
  unit_price_cents integer not null check (unit_price_cents >= 0),
  quantity numeric(12,3) check (quantity > 0),
  unit text not null,
  transport_mode text check (transport_mode in ('included', 'excluded')),
  source_order_id uuid,
  source_order_item_id uuid,
  source_order_date date
);
create index product_reference_price_withdrawals_history_idx
  on public.product_reference_price_withdrawals (tenant_id, product_id, withdrawn_at desc, id desc);

alter table public.product_reference_price_withdrawals enable row level security;
revoke all on public.product_reference_price_withdrawals from public, anon, authenticated;
grant select on public.product_reference_price_withdrawals to authenticated;
create policy "Active tenant members can read price withdrawals"
  on public.product_reference_price_withdrawals for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and (select public.is_tenant_member(tenant_id)));

create function public.get_product_reference_price_history(
  p_product_id uuid, p_offset integer default 0, p_limit integer default 11
)
returns table (
  id uuid, operation text, actor_id uuid, occurred_at timestamptz, unit_price_cents integer,
  quantity numeric, unit text, currency text, transport_mode text, justification text, offers jsonb,
  source_order_date date
)
language plpgsql stable security invoker set search_path = ''
as $$
declare
  tenant_id_value uuid := public.current_tenant_id();
begin
  if not exists (
    select 1 from public.products p where p.id = p_product_id and p.tenant_id = tenant_id_value
  ) then raise no_data_found using message = 'PRODUCT_NOT_FOUND'; end if;

  return query
    select * from (
      select v.id, v.mode as operation, v.validated_by as actor_id, v.validated_at as occurred_at,
        v.unit_price_cents, v.quantity, v.unit, v.currency, v.transport_mode,
        v.justification, v.proposal->'offers' as offers, null::date as source_order_date
      from public.product_reference_price_validations v
      where v.tenant_id = tenant_id_value and v.product_id = p_product_id
      union all
      select w.id, 'withdrawal', w.withdrawn_by, w.withdrawn_at,
        w.unit_price_cents, w.quantity, w.unit, 'EUR', w.transport_mode,
        null, null, w.source_order_date
      from public.product_reference_price_withdrawals w
      where w.tenant_id = tenant_id_value and w.product_id = p_product_id
    ) history
    order by history.occurred_at desc, history.id desc
    offset greatest(p_offset, 0) limit least(greatest(p_limit, 1), 101);
end;
$$;
revoke all on function public.get_product_reference_price_history(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.get_product_reference_price_history(uuid, integer, integer) to authenticated;

create or replace function public.protect_product_reference_price() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.reference_price_validation_id is not null then
      raise exception 'REFERENCE_PRICE_VALIDATION_REQUIRED' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.unit_price_cents is not distinct from old.unit_price_cents
    and new.reference_price_validation_id is not distinct from old.reference_price_validation_id
    and new.reference_quantity is not distinct from old.reference_quantity
    and new.reference_transport_mode is not distinct from old.reference_transport_mode
    and (old.reference_price_validation_id is null or new.unit is not distinct from old.unit) then return new; end if;

  -- Only the withdrawal RPC can create matching evidence within this transaction.
  if new.reference_price_validation_id is null and new.unit_price_cents = 0
    and (old.reference_price_validation_id is not null or old.unit_price_cents > 0)
    and new.reference_quantity is not distinct from old.reference_quantity
    and new.reference_transport_mode is not distinct from old.reference_transport_mode
    and new.unit is not distinct from old.unit
    and new.reference_price_source_order_id is null
    and new.reference_price_source_item_id is null
    and new.reference_price_source_date is null
    and exists (
      select 1 from public.product_reference_price_withdrawals w
      where w.tenant_id = old.tenant_id and w.product_id = old.id
        and w.previous_validation_id is not distinct from old.reference_price_validation_id
        and w.product_updated_at = old.updated_at and w.unit_price_cents = old.unit_price_cents
        and w.withdrawn_by = auth.uid() and w.withdrawn_at = transaction_timestamp()
    ) then return new; end if;

  if new.reference_price_validation_id is null
    or new.reference_price_validation_id is not distinct from old.reference_price_validation_id
    or not exists (
      select 1 from public.product_reference_price_validations v
      where v.id = new.reference_price_validation_id and v.product_id = new.id and v.tenant_id = new.tenant_id
        and v.unit_price_cents = new.unit_price_cents and v.quantity = new.reference_quantity
        and v.unit = new.unit
        and v.transport_mode = new.reference_transport_mode
        and v.previous_validation_id is not distinct from old.reference_price_validation_id
        and v.validated_by = auth.uid() and v.validated_at = transaction_timestamp()
    ) then raise exception 'REFERENCE_PRICE_VALIDATION_REQUIRED' using errcode = 'P0001'; end if;
  return new;
end;
$$;

-- As with validation, the authenticated caller can request one audited operation
-- but has no direct INSERT or UPDATE privilege on the journal.
create function public.withdraw_product_reference_price(
  p_product_id uuid, p_expected_updated_at timestamptz, p_expected_validation_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  tenant_id_value uuid := public.current_tenant_id();
  actor_id uuid := auth.uid();
  product public.products%rowtype;
  withdrawal_id uuid;
begin
  if actor_id is null or tenant_id_value is null or not exists (
    select 1 from public.tenant_memberships m
    where m.tenant_id = tenant_id_value and m.user_id = actor_id and m.role = 'admin'
  ) then raise insufficient_privilege using message = 'Admin role required.'; end if;

  select * into product from public.products p
  where p.id = p_product_id and p.tenant_id = tenant_id_value for update;
  if not found then raise no_data_found using message = 'PRODUCT_NOT_FOUND'; end if;
  if product.updated_at is distinct from p_expected_updated_at
    or product.reference_price_validation_id is distinct from p_expected_validation_id
    or (product.reference_price_validation_id is null and product.unit_price_cents = 0)
  then raise exception 'REFERENCE_PRICE_CHANGED' using errcode = 'P0001'; end if;

  insert into public.product_reference_price_withdrawals (
    tenant_id, product_id, previous_validation_id, withdrawn_by, product_updated_at,
    unit_price_cents, quantity, unit, transport_mode, source_order_id, source_order_item_id, source_order_date
  ) values (
    tenant_id_value, product.id, product.reference_price_validation_id, actor_id, product.updated_at,
    product.unit_price_cents, product.reference_quantity, product.unit, product.reference_transport_mode,
    product.reference_price_source_order_id, product.reference_price_source_item_id, product.reference_price_source_date
  ) returning id into withdrawal_id;

  -- Keep the known quantity and freight basis available for a future proposal.
  update public.products set unit_price_cents = 0, reference_price_validation_id = null,
    reference_price_source_order_id = null, reference_price_source_item_id = null, reference_price_source_date = null
  where id = product.id and tenant_id = tenant_id_value;

  return jsonb_build_object('withdrawal_id', withdrawal_id);
end;
$$;
revoke all on function public.withdraw_product_reference_price(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_product_reference_price(uuid, timestamptz, uuid) to authenticated;

commit;
