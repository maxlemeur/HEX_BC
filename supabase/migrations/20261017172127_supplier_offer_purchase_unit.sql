-- Lot 2, sub-lot 2.9 (P-18): purchase unit and packaging of a supplier offer, and the shared unit
-- referential for every engine (D9; point 30 of docs/testing/estimate-engine-v3-2.4.md).
-- Design: docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md (§6.1 M7, §14 "2.9").
-- Contract, owner's decisions of 17/10/2026 and proofs: docs/testing/estimate-engine-v3-2.9.md.
--
-- 1. supplier_pricebook.estimate_unit_code (unit of the estimate, referential code),
--    estimate_units_per_purchase_unit (> 0, e.g. 3 ml per bar) and purchase_rounding (none | ceil):
--    all null (no conversion) or all set. unit stays the purchase unit, unit_price_cents its price.
--    The converted price per estimate unit must fit an integer of cents (second review of 2.9).
-- 2. private.purchase_unit_token now resolves through the shared referential (private.normalize_unit),
--    falling back to the spelling token for units outside it ("barre"): m.l. = ml, Pce = u, forfait = fft.
-- 3. private.purchase_quantity / private.purchase_unit_price_cents: quantity ordered in the purchase
--    unit (whole units when rounding up; null when not a multiple of 0.001) and price per purchase
--    unit (the offer price unless the line price was negotiated, then line price x factor, half-up).
--    Mirrored by src/lib/estimates/supplier-offer-purchase-unit.ts.
--    private.purchase_conversion_factor: a converted offer serves both of its units; a line written in
--    the purchase unit ("barre") is ordered as such, without conversion (review of 2.9).
-- 4. create_estimate_purchase_order_drafts orders a converted line in the purchase unit, applies the
--    minimum to the purchase quantity and compares units through the estimate unit of the offer;
--    estimate_purchase_review_lines puts the conversion in the review fingerprint and shows the
--    ordered quantity, unit and price of that snapshot;
--    normalize_purchase_order_item orders a converted line in the purchase unit;
--    update_supplier_offer accepts the three conversion fields.
--    The unit of a line is coalesce(unit_code, description): unit_code on an engine 3 line (M4),
--    description on engines 1 and 2, whose unit_code is always null.
-- 5. catalogue_products_page compares and shows the best offer per estimate unit.
-- Each function is copied from its latest definition (20261017093407, 20261011091744,
-- 20261011083209) with only the lines above changed. CREATE OR REPLACE keeps owners and ACLs. No
-- existing row is rewritten: every existing offer stays without conversion.
begin;

do $preflight$
begin
  if to_regclass('public.measurement_units') is null
    or to_regprocedure('private.normalize_unit(text)') is null
    or to_regprocedure('private.unit_token(text)') is null
    or to_regprocedure('public.create_estimate_purchase_order_drafts(uuid,uuid,jsonb,jsonb)') is null
    or to_regprocedure('public.update_supplier_offer(uuid,jsonb)') is null
    or to_regprocedure('private.purchase_unit_token(text)') is null
    -- M4 (20261017162000, sub-lot 2.5): the unit of an engine 3 line lives in estimate_items.unit_code.
    or not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'estimate_items' and column_name = 'unit_code') then
    raise exception 'LOT2_2_9_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

alter table public.supplier_pricebook
  add column if not exists estimate_unit_code text
    references public.measurement_units (code) on update restrict on delete restrict,
  add column if not exists estimate_units_per_purchase_unit numeric(14,6),
  add column if not exists purchase_rounding text;
alter table public.supplier_pricebook drop constraint if exists supplier_pricebook_purchase_unit_check;
alter table public.supplier_pricebook add constraint supplier_pricebook_purchase_unit_check check (
  (estimate_unit_code is null and estimate_units_per_purchase_unit is null and purchase_rounding is null)
  -- Explicit IS NOT NULL: a comparison with a null column would make the CHECK pass.
  or (estimate_unit_code is not null and estimate_units_per_purchase_unit is not null and estimate_units_per_purchase_unit > 0
    and purchase_rounding is not null and purchase_rounding in ('none', 'ceil'))
);
-- CASE keeps the division away from a zero factor, which the CHECK above refuses.
alter table public.supplier_pricebook drop constraint if exists supplier_pricebook_converted_price_check;
alter table public.supplier_pricebook add constraint supplier_pricebook_converted_price_check check (
  case when estimate_units_per_purchase_unit > 0
    then pg_catalog.round(unit_price_cents / estimate_units_per_purchase_unit) <= 2147483647
    else true end
);
create index if not exists supplier_pricebook_estimate_unit_code_idx
  on public.supplier_pricebook (estimate_unit_code) where estimate_unit_code is not null;
comment on column public.supplier_pricebook.estimate_unit_code is
  'Estimate unit served by an offer sold in another purchase unit (P-18), e.g. ml for a bar; null when the offer is priced in the estimate unit.';
comment on column public.supplier_pricebook.estimate_units_per_purchase_unit is
  'Quantity of the estimate unit in one purchase unit (e.g. 3 ml per bar); set with estimate_unit_code.';
comment on column public.supplier_pricebook.purchase_rounding is
  'ceil orders whole purchase units; none orders the exact quantity, refused when not a multiple of 0.001.';

create or replace function private.purchase_unit_token(p_unit text)
returns text
language sql
stable
parallel safe
set search_path = ''
as $$
  select coalesce((private.normalize_unit(p_unit)).unit_code, private.unit_token(p_unit));
$$;
revoke all on function private.purchase_unit_token(text) from public, anon, authenticated;

create or replace function private.purchase_quantity(p_quantity numeric, p_factor numeric, p_rounding text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_quantity is null then null
    when p_factor is null then p_quantity
    when p_rounding = 'ceil' then pg_catalog.ceil(p_quantity / p_factor)
    when (p_quantity * 1000) % p_factor = 0 then pg_catalog.round(p_quantity * 1000 / p_factor) / 1000
    else null
  end;
$$;
revoke all on function private.purchase_quantity(numeric, numeric, text) from public, anon, authenticated;

create or replace function private.purchase_unit_price_cents(p_line_cents integer, p_offer_cents integer, p_factor numeric)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_factor is null then p_line_cents
    when p_line_cents = pg_catalog.round(p_offer_cents / p_factor) then p_offer_cents
    -- Out of an integer of cents: no price (the drafts refuse the line with ORDER_DRAFT_INPUT_INVALID).
    when pg_catalog.round(p_line_cents * p_factor) > 2147483647 then null
    else pg_catalog.round(p_line_cents * p_factor)::integer
  end;
$$;
revoke all on function private.purchase_unit_price_cents(integer, integer, numeric) from public, anon, authenticated;

-- The factor that applies to a line: none for a line written in the purchase unit of the offer.
create or replace function private.purchase_conversion_factor(
  p_line_unit text, p_offer_unit text, p_estimate_unit_code text, p_factor numeric
)
returns numeric
language sql
stable
parallel safe
set search_path = ''
as $$
  select case
    when p_factor is not null and p_estimate_unit_code is not null
      and nullif(btrim(p_line_unit), '') is not null and nullif(btrim(p_offer_unit), '') is not null
      and private.purchase_unit_token(p_line_unit) = private.purchase_unit_token(p_offer_unit)
      and private.purchase_unit_token(p_line_unit) <> private.purchase_unit_token(p_estimate_unit_code)
    then null
    else p_factor
  end;
$$;
revoke all on function private.purchase_conversion_factor(text, text, text, numeric) from public, anon, authenticated;

create or replace function private.estimate_purchase_review_lines(p_tenant_id uuid,p_version_id uuid,p_item_ids uuid[])
returns jsonb language sql stable security definer set search_path='' set timezone='UTC' as $$
  select coalesce(jsonb_agg(base.display||jsonb_build_object('_snapshot',base.snapshot,'review_fingerprint',
    encode(sha256(convert_to(base.snapshot::text,'UTF8')),'hex')) order by base.id),'[]'::jsonb)
  from (
    select i.id,
      jsonb_build_object('item_id',i.id,'item_title',i.title,'quantity',i.quantity,
        'unit_price_ht_cents',i.unit_price_ht_cents,'tax_rate_bp',i.tax_rate_bp,'unit',btrim(coalesce(i.unit_code,i.description)),
        'selected_supplier_price_id',i.selected_supplier_price_id,'supplier_id',s.id,
        'supplier_name',s.name,'supplier_reference',case when ci.id is not null then ci.supplier_sku else sp.supplier_sku end,
        -- 2.9: what the draft orders, from the same row as the fingerprint.
        'ordered_quantity',private.purchase_quantity(i.quantity,cf.factor,sp.purchase_rounding),
        'ordered_unit',case when cf.factor is null then btrim(coalesce(i.unit_code,i.description)) else btrim(sp.unit) end,
        'ordered_unit_price_ht_cents',private.purchase_unit_price_cents(i.unit_price_ht_cents,sp.unit_price_cents,cf.factor)) display,
      jsonb_build_object('version_currency',v.currency,'stale_price_days',private.estimate_purchase_stale_days(p_tenant_id),
        'item_id',i.id,'item_type',i.item_type,'item_title',i.title,'quantity',i.quantity,'unit_price_ht_cents',i.unit_price_ht_cents,
        'tax_rate_bp',i.tax_rate_bp,'unit',btrim(coalesce(i.unit_code,i.description)),'selected_supplier_price_id',i.selected_supplier_price_id,
        'supplier_id',s.id,'supplier_name',s.name,'supplier_active',s.is_active,
        'supplier_reference',case when ci.id is not null then ci.supplier_sku else sp.supplier_sku end,'catalog_item_id',sp.supplier_catalog_item_id,
        'product_id',sp.product_id,'offer_unit',sp.unit,'offer_currency',sp.currency,'offer_min_quantity',sp.min_quantity,
        'offer_valid_from',sp.valid_from,'offer_valid_to',sp.valid_to,'offer_active',sp.is_active,
        'offer_unit_price_cents',sp.unit_price_cents,'offer_updated_at',sp.updated_at,'offer_created_at',sp.created_at,
        'offer_source_import_id',sp.source_import_id,'offer_source_mapped_row_id',sp.source_mapped_row_id,
        'offer_transport_mode',sp.transport_mode,'offer_estimate_unit_code',sp.estimate_unit_code,
        'offer_units_per_purchase_unit',sp.estimate_units_per_purchase_unit,'offer_purchase_rounding',sp.purchase_rounding) snapshot
    from public.estimate_items i join public.estimate_versions v on v.id=i.version_id and v.tenant_id=i.tenant_id
    join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id and sp.tenant_id=i.tenant_id
    join public.suppliers s on s.id=sp.supplier_id and s.tenant_id=i.tenant_id
    left join public.supplier_catalog_items ci on ci.id=sp.supplier_catalog_item_id and ci.tenant_id=i.tenant_id
    cross join lateral (select private.purchase_conversion_factor(coalesce(i.unit_code,i.description),sp.unit,sp.estimate_unit_code,
      sp.estimate_units_per_purchase_unit) factor) cf
    where i.version_id=p_version_id and i.tenant_id=p_tenant_id and i.id=any(p_item_ids) and i.item_type='line'
  ) base;
$$;

create or replace function private.normalize_purchase_order_item()
returns trigger language plpgsql security definer set search_path='' as $$
declare ht numeric; tax numeric; source_unit text; offer_unit text; estimate_unit text; conversion_factor numeric; po public.purchase_orders%rowtype;
begin
  select * into po from public.purchase_orders where id=new.purchase_order_id for update;
  if po.id is null or po.tenant_id<>new.tenant_id then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  -- The FK's genuine detach is permitted even after sending; it changes no economics.
  if tg_op='UPDATE' and (new.source_estimate_item_id is distinct from old.source_estimate_item_id
    or new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id) then
    if (new.source_estimate_item_id is distinct from old.source_estimate_item_id and not
      (new.source_estimate_item_id is null and old.source_estimate_item_id is not null and not exists(select 1 from public.estimate_items where id=old.source_estimate_item_id)))
      or (new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id and not
      (new.source_selected_supplier_price_id is null and old.source_selected_supplier_price_id is not null and not exists(select 1 from public.supplier_pricebook where id=old.source_selected_supplier_price_id))) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
  end if;
  if tg_op='UPDATE' and (new.id<>old.id or new.tenant_id<>old.tenant_id or new.purchase_order_id<>old.purchase_order_id or new.is_source_linked<>old.is_source_linked) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  -- Recheck after acquiring the parent lock. The RLS scan may have observed a
  -- draft before a concurrent status transition committed while this row waited.
  if po.status<>'draft' then
    if tg_op='UPDATE'
      and (new.source_estimate_item_id is distinct from old.source_estimate_item_id
        or new.source_selected_supplier_price_id is distinct from old.source_selected_supplier_price_id
        or new.product_id is distinct from old.product_id)
      and (new.product_id is not distinct from old.product_id or
        (new.product_id is null and old.product_id is not null and not exists(select 1 from public.products where id=old.product_id)))
      and (to_jsonb(new)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','updated_at'])=
          (to_jsonb(old)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','updated_at']) then
      return new;
    end if;
    raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;
  if new.quantity is null or new.quantity<=0 or new.quantity>2147483647 or new.quantity<>trunc(new.quantity,3) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  if new.unit_price_ht_cents is null or new.unit_price_ht_cents<0 or new.tax_rate_bp is null or new.tax_rate_bp not between 0 and 10000
    or nullif(btrim(new.designation),'') is null then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  new.unit:=nullif(btrim(new.unit),'');
  if tg_op='INSERT' then
    new.price_unit:=nullif(btrim(new.price_unit),'');
    new.is_source_linked:=new.source_estimate_item_id is not null or new.source_selected_supplier_price_id is not null;
    if new.is_source_linked then
      select btrim(coalesce(i.unit_code,i.description)),btrim(sp.unit),sp.estimate_unit_code,sp.estimate_units_per_purchase_unit
        into source_unit,offer_unit,estimate_unit,conversion_factor
      from public.estimate_items i join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id and sp.tenant_id=i.tenant_id
      where i.id=new.source_estimate_item_id and i.tenant_id=new.tenant_id and sp.id=new.source_selected_supplier_price_id
        and i.version_id=po.source_estimate_version_id for share of i,sp nowait;
      if not found or nullif(source_unit,'') is null or nullif(offer_unit,'') is null then
        raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
      end if;
      -- 2.9: a line priced from a converted offer is ordered in the purchase unit (bars, not metres);
      -- a line already written in bars keeps its own unit.
      if private.purchase_conversion_factor(source_unit,offer_unit,estimate_unit,conversion_factor) is not null then
        source_unit:=offer_unit;
      end if;
      if (new.unit is not null and new.unit<>source_unit) or (new.price_unit is not null and new.price_unit<>offer_unit) then
        raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
      end if;
      new.unit:=source_unit; new.price_unit:=offer_unit;
    else new.price_unit:=new.unit; end if;
    if new.unit is null then raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED'; end if;
  else
    if old.is_source_linked and old.unit is not null and new.unit is distinct from old.unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    if new.price_unit is distinct from old.price_unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    if new.unit is null and (old.unit is not null or new.quantity is distinct from old.quantity or new.unit_price_ht_cents is distinct from old.unit_price_ht_cents) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
    end if;
    if not old.is_source_linked or old.unit is null then new.price_unit:=new.unit; end if;
  end if;
  ht:=round(new.quantity*new.unit_price_ht_cents); tax:=round(ht*new.tax_rate_bp/10000);
  if greatest(ht,tax,ht+tax)>2147483647 then
    raise exception using errcode='22023',message='PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE';
  end if;
  new.line_total_ht_cents:=ht::integer; new.line_tax_cents:=tax::integer; new.line_total_ttc_cents:=(ht+tax)::integer;
  return new;
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

create or replace function public.create_estimate_purchase_order_drafts(
  p_version_id uuid,p_idempotency_key uuid,p_reviewed_lines jsonb,p_groups jsonb
) returns jsonb language plpgsql security definer set search_path='' set timezone='UTC' as $$
declare
  tenant_value uuid:=private.estimate_purchase_access(p_version_id,true);
  actor uuid:=auth.uid();
  selected_ids uuid[]; review_ids uuid[]; snapshot jsonb; request_value jsonb;
  receipt private.estimate_purchase_receipts%rowtype;
  group_value jsonb; line_value jsonb; order_row public.purchase_orders%rowtype;
  orders_result jsonb:='[]'::jsonb; result_value jsonb;
  ht bigint; tax bigint; ttc bigint; position_value integer;
  line_ht bigint; line_tax bigint; count_value integer; total_lines integer:=0;
  purchase_quantity numeric; purchase_price integer; conversion_factor numeric;
  stale_days integer; today_value date;
begin
  if p_idempotency_key is null or jsonb_typeof(p_groups) is distinct from 'array'
    or jsonb_typeof(p_reviewed_lines) is distinct from 'array'
    or jsonb_array_length(p_groups) not between 1 and 50
    or jsonb_array_length(p_reviewed_lines) not between 1 and 10000 then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_typeof(g) is distinct from 'object'
    or g-array['supplier_id','delivery_site_id','delivery_site_updated_at','item_ids','expected_delivery_date','notes']<>'{}'::jsonb
    or g->>'supplier_id' is null or g->>'delivery_site_id' is null or g->>'delivery_site_updated_at' is null
    or jsonb_typeof(g->'item_ids') is distinct from 'array') then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  for group_value in select g from jsonb_array_elements(p_groups) g loop
    if (group_value ? 'notes' and jsonb_typeof(group_value->'notes') not in ('string','null'))
      or (group_value ? 'expected_delivery_date' and jsonb_typeof(group_value->'expected_delivery_date') not in ('string','null')) then
      raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
    end if;
    if group_value->>'expected_delivery_date' is not null and group_value->>'expected_delivery_date'<>'TBD' then
      if group_value->>'expected_delivery_date'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end if;
      begin
        if to_char((group_value->>'expected_delivery_date')::date,'YYYY-MM-DD')<>group_value->>'expected_delivery_date' then
          raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
        end if;
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_groups) g where jsonb_array_length(g->'item_ids') not between 1 and 200)
    or exists(select 1 from jsonb_array_elements(p_reviewed_lines) l where jsonb_typeof(l) is distinct from 'object'
      or l-array['item_id','review_fingerprint']<>'{}'::jsonb or l->>'item_id' is null
      or coalesce(l->>'review_fingerprint','')!~'^[0-9a-f]{64}$') then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  -- PostgreSQL UUID input is case-insensitive; all subsequent JSON comparisons
  -- and the immutable idempotency payload must use that same identity contract.
  select jsonb_agg(l||jsonb_build_object('item_id',(l->>'item_id')::uuid) order by (l->>'item_id')::uuid)
    into p_reviewed_lines from jsonb_array_elements(p_reviewed_lines) l;
  select jsonb_agg(g||jsonb_build_object('supplier_id',(g->>'supplier_id')::uuid,
    'delivery_site_id',(g->>'delivery_site_id')::uuid,
    'delivery_site_updated_at',(g->>'delivery_site_updated_at')::timestamptz,
    'item_ids',(select jsonb_agg(ids.value::uuid order by ids.value::uuid)
      from jsonb_array_elements_text(g->'item_ids') ids(value))))
    into p_groups from jsonb_array_elements(p_groups) g;
  select array_agg(id order by id) into selected_ids from (
    select ids.value::uuid id from jsonb_array_elements(p_groups) g cross join lateral jsonb_array_elements_text(g->'item_ids') ids(value)
  ) ids;
  select array_agg((l->>'item_id')::uuid order by (l->>'item_id')::uuid) into review_ids from jsonb_array_elements(p_reviewed_lines) l;
  if selected_ids is distinct from review_ids or cardinality(selected_ids)<>(select count(distinct id) from unnest(selected_ids) id)
    or exists(select 1 from unnest(selected_ids) id where id is null) then
    raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
  end if;
  select jsonb_build_object('reviewed_lines',(select jsonb_agg(l order by l->>'item_id') from jsonb_array_elements(p_reviewed_lines) l),
    'groups',(select jsonb_agg((g-'item_ids')||jsonb_build_object('item_ids',(select jsonb_agg(i order by i) from jsonb_array_elements(g->'item_ids') i))
      order by g->>'supplier_id',g->>'delivery_site_id') from jsonb_array_elements(p_groups) g)) into request_value;

  perform 1 from public.estimate_versions where id=p_version_id and tenant_id=tenant_value for update;
  -- Re-evaluate scope after waiting; membership and parent locks keep it valid.
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=actor for share;
  perform 1 from public.estimate_projects p join public.estimate_versions v on v.project_id=p.id
    where v.id=p_version_id and p.tenant_id=tenant_value for share of p;
  perform private.estimate_purchase_access(p_version_id,true);
  select * into receipt from private.estimate_purchase_receipts r
    where r.tenant_id=tenant_value and r.source_version_id=p_version_id and r.idempotency_key=p_idempotency_key;
  if receipt.idempotency_key is not null then
    if receipt.created_by<>actor and not exists(select 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=actor and role='admin') then
      raise exception using errcode='42501',message='ORDER_DRAFT_ACCESS_DENIED';
    end if;
    if receipt.request_payload is distinct from request_value then
      raise exception using errcode='23505',message='ORDER_DRAFT_IDEMPOTENCY_CONFLICT';
    end if;
    return private.estimate_purchase_present_receipt(receipt.result);
  end if;
  if exists(select 1 from private.estimate_purchase_transfers where tenant_id=tenant_value and source_item_id=any(selected_ids)) then
    raise exception using errcode='23505',message='ORDER_DRAFT_ALREADY_EXISTS';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('estimate-purchase-policy:'||tenant_value::text,0));
  begin
  -- Direct item writes take the item tuple before their revision-bump trigger
  -- takes the version. Do not wait in the opposite order while holding it.
  perform 1 from public.estimate_items where tenant_id=tenant_value and version_id=p_version_id and id=any(selected_ids) order by id for update nowait;
  if (select count(*) from public.estimate_items where tenant_id=tenant_value and version_id=p_version_id and id=any(selected_ids) and item_type='line')<>cardinality(selected_ids) then
    raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
  end if;
  -- Products are also locked by existing supplier mutation triggers. NOWAIT on
  -- the supplier tuples avoids opposite tuple/trigger lock-order deadlocks.
  perform 1 from public.products p where p.tenant_id=tenant_value and p.id in (
    select sp.product_id from public.supplier_pricebook sp join public.estimate_items i on i.selected_supplier_price_id=sp.id
    where i.id=any(selected_ids) and i.tenant_id=tenant_value and sp.tenant_id=tenant_value
  ) order by p.id for update;
    perform 1 from public.supplier_pricebook sp where sp.tenant_id=tenant_value and sp.id in (
      select selected_supplier_price_id from public.estimate_items where id=any(selected_ids) and tenant_id=tenant_value
    ) order by sp.id for share nowait;
    perform 1 from public.supplier_catalog_items ci where ci.tenant_id=tenant_value and ci.id in (
      select sp.supplier_catalog_item_id from public.supplier_pricebook sp join public.estimate_items i on i.selected_supplier_price_id=sp.id
      where i.id=any(selected_ids) and i.tenant_id=tenant_value and sp.tenant_id=tenant_value
    ) order by ci.id for share nowait;
    perform 1 from public.suppliers s where s.tenant_id=tenant_value and s.id in (
      select (g->>'supplier_id')::uuid from jsonb_array_elements(p_groups) g
    ) order by s.id for share nowait;
    perform 1 from public.delivery_sites s where s.tenant_id=tenant_value and s.id in (
      select (g->>'delivery_site_id')::uuid from jsonb_array_elements(p_groups) g
    ) order by s.id for share nowait;
    perform 1 from public.feature_flags where tenant_id=tenant_value and flag_key='STALE_PRICE_DAYS' for share nowait;
  exception when lock_not_available then
    raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
  end;
  snapshot:=private.estimate_purchase_review_lines(tenant_value,p_version_id,selected_ids);
  if jsonb_array_length(snapshot)<>cardinality(selected_ids) or exists(
    select 1 from jsonb_array_elements(snapshot) s join jsonb_array_elements(p_reviewed_lines) r on (r->>'item_id')::uuid=(s->>'item_id')::uuid
    where r->>'review_fingerprint' is distinct from s->>'review_fingerprint'
  ) then raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE'; end if;
  stale_days:=private.estimate_purchase_stale_days(tenant_value);
  today_value:=(clock_timestamp() at time zone 'UTC')::date;
  if exists(select 1 from public.estimate_versions where id=p_version_id and upper(btrim(currency))<>'EUR')
    or exists(select 1 from public.estimate_items i join public.supplier_pricebook sp on sp.id=i.selected_supplier_price_id
      join public.suppliers s on s.id=sp.supplier_id
      cross join lateral (select private.purchase_conversion_factor(coalesce(i.unit_code,i.description),sp.unit,sp.estimate_unit_code,
        sp.estimate_units_per_purchase_unit) factor) cf
      where i.id=any(selected_ids) and (
        i.quantity is null or i.quantity<=0 or i.quantity<>trunc(i.quantity,3) or i.quantity>2147483647
        or i.unit_price_ht_cents is null or i.unit_price_ht_cents<0 or i.tax_rate_bp is null or i.tax_rate_bp not between 0 and 10000
        or nullif(btrim(coalesce(i.unit_code,i.description)),'') is null or nullif(btrim(sp.unit),'') is null
        or private.purchase_unit_token(coalesce(i.unit_code,i.description))<>private.purchase_unit_token(case when cf.factor is null then sp.unit else sp.estimate_unit_code end)
        or private.purchase_quantity(i.quantity,cf.factor,sp.purchase_rounding) is null
        or private.purchase_quantity(i.quantity,cf.factor,sp.purchase_rounding)>2147483647
        or not public.supplier_offer_price_eligible(sp.unit_price_cents,sp.zero_price_kind)
        or upper(btrim(sp.currency))<>'EUR' or not sp.is_active or not s.is_active
        or private.purchase_quantity(i.quantity,cf.factor,sp.purchase_rounding)<sp.min_quantity
        or sp.valid_from is null or sp.valid_to is null or sp.valid_from>today_value or sp.valid_to<today_value
        or sp.valid_to>(sp.valid_from+interval '6 months')::date
        or coalesce(sp.updated_at,sp.created_at)<clock_timestamp()-make_interval(days=>stale_days)
      )) then raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE'; end if;

  for group_value in select g from jsonb_array_elements(p_groups) g order by g->>'supplier_id',g->>'delivery_site_id' loop
    if not exists(select 1 from public.delivery_sites s where s.id=(group_value->>'delivery_site_id')::uuid
      and s.tenant_id=tenant_value and s.is_active and s.updated_at=(group_value->>'delivery_site_updated_at')::timestamptz)
      or exists(select 1 from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids'))
        and l->>'supplier_id' is distinct from group_value->>'supplier_id') then
      raise exception using errcode='40001',message='ORDER_DRAFT_PREPARATION_STALE';
    end if;
    ht:=0; tax:=0; ttc:=0; count_value:=0;
    for line_value in select l from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids')) loop
      conversion_factor:=private.purchase_conversion_factor(line_value->>'unit',line_value->'_snapshot'->>'offer_unit',
        line_value->'_snapshot'->>'offer_estimate_unit_code',(line_value->'_snapshot'->>'offer_units_per_purchase_unit')::numeric);
      purchase_quantity:=private.purchase_quantity((line_value->>'quantity')::numeric,conversion_factor,line_value->'_snapshot'->>'offer_purchase_rounding');
      purchase_price:=private.purchase_unit_price_cents((line_value->>'unit_price_ht_cents')::integer,
        (line_value->'_snapshot'->>'offer_unit_price_cents')::integer,conversion_factor);
      if purchase_price is null then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end if;
      line_ht:=round(purchase_quantity*purchase_price);
      line_tax:=round(line_ht::numeric*(line_value->>'tax_rate_bp')::integer/10000);
      if line_ht+line_tax>2147483647 then
        raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
      end if;
      ht:=ht+line_ht; tax:=tax+line_tax; ttc:=ttc+line_ht+line_tax; count_value:=count_value+1;
    end loop;
    if count_value<>jsonb_array_length(group_value->'item_ids') or greatest(ht,tax,ttc)>2147483647 then
      raise exception using errcode='22023',message='ORDER_DRAFT_INPUT_INVALID';
    end if;
    insert into public.purchase_orders(tenant_id,user_id,reference,supplier_id,delivery_site_id,status,expected_delivery_date,notes,
      total_ht_cents,total_tax_cents,total_ttc_cents,currency,source_estimate_version_id)
      values(tenant_value,actor,'TEMP-'||gen_random_uuid()::text,(group_value->>'supplier_id')::uuid,(group_value->>'delivery_site_id')::uuid,
        'draft',nullif(group_value->>'expected_delivery_date',''),nullif(btrim(group_value->>'notes'),''),ht,tax,ttc,'EUR',p_version_id)
      returning * into order_row;
    update public.purchase_orders set reference='C-'||to_char(order_row.order_date,'YYMM')||'-'||lpad(order_row.order_number::text,greatest(3,length(order_row.order_number::text)),'0')
      where id=order_row.id returning * into order_row;
    position_value:=0;
    for line_value in select l from jsonb_array_elements(snapshot) l where l->>'item_id' in(select jsonb_array_elements_text(group_value->'item_ids')) order by l->>'item_id' loop
      position_value:=position_value+1;
      conversion_factor:=private.purchase_conversion_factor(line_value->>'unit',line_value->'_snapshot'->>'offer_unit',
        line_value->'_snapshot'->>'offer_estimate_unit_code',(line_value->'_snapshot'->>'offer_units_per_purchase_unit')::numeric);
      purchase_quantity:=private.purchase_quantity((line_value->>'quantity')::numeric,conversion_factor,line_value->'_snapshot'->>'offer_purchase_rounding');
      purchase_price:=private.purchase_unit_price_cents((line_value->>'unit_price_ht_cents')::integer,
        (line_value->'_snapshot'->>'offer_unit_price_cents')::integer,conversion_factor);
      line_ht:=round(purchase_quantity*purchase_price);
      line_tax:=round(line_ht::numeric*(line_value->>'tax_rate_bp')::integer/10000);
      insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,unit_price_ht_cents,
        tax_rate_bp,quantity,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_estimate_item_id,source_selected_supplier_price_id,unit,price_unit)
      values(tenant_value,order_row.id,position_value,(line_value->'_snapshot'->>'product_id')::uuid,line_value->>'supplier_reference',line_value->>'item_title',
        purchase_price,(line_value->>'tax_rate_bp')::integer,purchase_quantity,
        line_ht,line_tax,line_ht+line_tax,(line_value->>'item_id')::uuid,(line_value->>'selected_supplier_price_id')::uuid,
        case when conversion_factor is null then line_value->>'unit' else btrim(line_value->'_snapshot'->>'offer_unit') end,
        line_value->'_snapshot'->>'offer_unit');
    end loop;
    orders_result:=orders_result||jsonb_build_array(jsonb_build_object('purchase_order_id',order_row.id,'reference',order_row.reference,
      'supplier_id',order_row.supplier_id,'supplier_name',(select l->>'supplier_name' from jsonb_array_elements(snapshot) l where l->>'supplier_id'=group_value->>'supplier_id' limit 1),
      'delivery_site_id',order_row.delivery_site_id,'item_count',count_value,'total_ht_cents',ht,'total_tax_cents',tax,'total_ttc_cents',ttc,
      'ordered_source_item_ids',(select jsonb_agg(i order by i) from jsonb_array_elements(group_value->'item_ids') i),'current_status','draft','can_open',true));
    total_lines:=total_lines+count_value;
  end loop;
  result_value:=jsonb_build_object('source_version_id',p_version_id,'idempotency_key',p_idempotency_key,'replayed',false,
    'summary',jsonb_build_object('draft_orders_created',jsonb_array_length(orders_result),'draft_lines_created',total_lines),'orders',orders_result);
  insert into private.estimate_purchase_receipts(tenant_id,source_version_id,idempotency_key,created_by,request_payload,review_snapshot,result)
    values(tenant_value,p_version_id,p_idempotency_key,actor,request_value,snapshot,result_value);
  return result_value;
end;
$$;

create or replace function public.update_supplier_offer(p_price_id uuid, p_patch jsonb)
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
    'is_active', 'source', 'notes', 'supplier_sku', 'product_url', 'transport_mode', 'zero_price_kind',
    'estimate_unit_code', 'estimate_units_per_purchase_unit', 'purchase_rounding'
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
    -- A7: an explicit marking is kept (the CHECK refuses it above 0 €); repricing above 0 € clears it.
    zero_price_kind = case when p_patch ? 'zero_price_kind' then nullif(btrim(p_patch->>'zero_price_kind'), '')
      when p_patch ? 'unit_price_cents' and (p_patch->>'unit_price_cents')::integer > 0 then null
      else zero_price_kind end,
    -- 2.9: the three conversion columns are set or cleared together (CHECK supplier_pricebook_purchase_unit_check).
    estimate_unit_code = case when p_patch ? 'estimate_unit_code'
      then nullif(btrim(p_patch->>'estimate_unit_code'), '') else estimate_unit_code end,
    estimate_units_per_purchase_unit = case when p_patch ? 'estimate_units_per_purchase_unit'
      then (p_patch->>'estimate_units_per_purchase_unit')::numeric else estimate_units_per_purchase_unit end,
    purchase_rounding = case when p_patch ? 'purchase_rounding'
      then nullif(btrim(p_patch->>'purchase_rounding'), '') else purchase_rounding end,
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

-- Copied from 20261017093407; only the price of the best offer (selected and ordered) changes.
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

commit;
