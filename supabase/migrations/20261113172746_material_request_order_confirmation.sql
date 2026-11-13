-- TI-691, lot 2 « l'achat », delivery 3b-1 (« commander et recevoir »). No remote application is authorized here.
--
-- The office passes the order of a draft of an affaire (by phone, WhatsApp or on the supplier's site), then records it
-- with its real prices and the supplier's confirmation as proof: the draft becomes « confirmée ». When the goods come,
-- it records the reception of the whole order, dated, with a free note for what is still to come: « reçue ». Once
-- ordered, an order of an affaire is neither canceled nor deleted. Orders without affaire (from an estimate or manual,
-- delivered on a site) keep their free status changes.
--
-- 1. public.purchase_order_confirmations and public.purchase_order_receptions: one row per order, removed with it. The
--    header of an order that is not a draft is read-only and a status change must be isolated
--    (guard_purchase_order_header_mutation), so what an order records when it is ordered and received lives beside it.
--    Read like the order (its author, or an admin, of the active tenant); written by the two functions of 5 only. The
--    proof is a document joined to the order (purchase_order_devis): its foreign key keeps it from being deleted.
-- 2. private.guard_purchase_order_lifecycle: the status of an order of an affaire goes draft -> canceled -> draft (3a),
--    draft -> confirmed through the confirmation only, confirmed -> received through the reception only, and nowhere
--    else: such an order is ordered and confirmed, not sent. One marked « envoyée » before this migration (its status
--    was free) returns to draft or is canceled. Deleting stays as it was: a member deletes drafts only (restrictive
--    policy « Draft purchase orders can be deleted »). The file of a proof is not deleted from storage either.
-- 3. private.normalize_purchase_order_item: in a draft, the price and the lot of a request line stay its retained
--    quote's until the confirmation writes the real ones (this settles what 3a left: the API accepted a new price).
-- 4. public.create_material_request_purchase_orders: a draft is delivered on the date its request needs the material.
-- 5. public.confirm_material_request_purchase_order and public.receive_material_request_purchase_order: SECURITY
--    DEFINER, because no Data API role writes the tables of 1; each checks the rights of an order's update itself (an
--    admin or engineer of the active tenant who is the order's author or an admin: private.purchase_order_access).
-- Functions 3 and 4 are copied from their latest definition (20261112202147) with only the lines marked « 3b » changed.
-- CREATE OR REPLACE keeps owners and ACLs.
-- Regression: supabase/tests/database/material-request-order-confirmation.test.sql.

-- ---------------------------------------------------------------------------
-- 1. What an order records when it is ordered and when it is received.
-- ---------------------------------------------------------------------------
create table public.purchase_order_confirmations (
  purchase_order_id uuid primary key references public.purchase_orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.purchase_order_devis(id),
  supplier_reference text check (supplier_reference is null
    or (char_length(supplier_reference) between 1 and 120 and supplier_reference = btrim(supplier_reference))),
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now()
);
create index purchase_order_confirmations_document_idx on public.purchase_order_confirmations (document_id);
create index purchase_order_confirmations_tenant_idx on public.purchase_order_confirmations (tenant_id);

create table public.purchase_order_receptions (
  purchase_order_id uuid primary key references public.purchase_orders(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  received_on date not null,
  note text check (note is null or (char_length(note) between 1 and 2000 and note = btrim(note))),
  received_by uuid not null,
  received_at timestamptz not null default now()
);
create index purchase_order_receptions_tenant_idx on public.purchase_order_receptions (tenant_id);

comment on table public.purchase_order_confirmations is
  'TI-691: the confirmation of an order of an affaire: the document joined to the order that proves it was passed, the supplier''s reference for it, who recorded it and when. Written by confirm_material_request_purchase_order only.';
comment on table public.purchase_order_receptions is
  'TI-691: the reception of a whole order of an affaire: its date, a free note for what is still to come, who recorded it and when. Written by receive_material_request_purchase_order only.';

alter table public.purchase_order_confirmations enable row level security;
alter table public.purchase_order_receptions enable row level security;
-- service_role keeps its table privileges, as on every public table (security-invariants).
revoke all on public.purchase_order_confirmations, public.purchase_order_receptions from public, anon, authenticated;
grant select on public.purchase_order_confirmations, public.purchase_order_receptions to authenticated;
-- Read like the order: the subquery is filtered by the order's own policy (a member of its tenant who is its author or
-- an admin), in the active tenant.
create policy "Readers of an order read its confirmation" on public.purchase_order_confirmations
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_confirmations.purchase_order_id and po.tenant_id = purchase_order_confirmations.tenant_id));
create policy "Readers of an order read its reception" on public.purchase_order_receptions
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_receptions.purchase_order_id and po.tenant_id = purchase_order_receptions.tenant_id));

-- ---------------------------------------------------------------------------
-- 2. The lifecycle of an order of an affaire.
-- ---------------------------------------------------------------------------
create function private.guard_purchase_order_lifecycle()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.project_id is null or new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'draft' and new.status = 'confirmed' then
    if pg_catalog.current_setting('app.purchase_order_confirming', true) is distinct from new.id::text then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_CONFIRM_THROUGH_FUNCTION';
    end if;
  elsif old.status = 'confirmed' and new.status = 'received' then
    if pg_catalog.current_setting('app.purchase_order_receiving', true) is distinct from new.id::text then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_RECEIVE_THROUGH_FUNCTION';
    end if;
  elsif not (old.status in ('draft', 'sent') and new.status = 'canceled')
    and not (old.status in ('canceled', 'sent') and new.status = 'draft') then
    raise exception using errcode = '23514', message = 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
      detail = old.status::text || ' -> ' || new.status::text;
  end if;
  return new;
end;
$$;
create trigger guard_purchase_order_lifecycle
  before update of status on public.purchase_orders
  for each row execute function private.guard_purchase_order_lifecycle();

-- The file of a proof stays in storage: the delete policy of the bucket devis (20260713140454) is restated with one more
-- condition, so neither the browser's storage client nor a race with the route removes the file a confirmation names.
drop policy if exists "Authorized users can delete purchase order devis" on storage.objects;
create policy "Authorized users can delete purchase order devis"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'devis'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 2
    and coalesce((storage.foldername(objects.name))[1], '') = 'purchase-orders'
    and coalesce((storage.foldername(objects.name))[2], '') <> ''
    and coalesce(storage.filename(objects.name), '') <> ''
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = coalesce((storage.foldername(objects.name))[2], '')
        and po.status <> 'canceled'
        and (select public.has_tenant_role(
          po.tenant_id,
          array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
        ))
        and (
          po.user_id = (select auth.uid())
          or (select public.has_tenant_role(po.tenant_id, array['admin'::public.tenant_role]))
        )
    )
    -- 3b: not the file of a proof.
    and not exists (
      select 1 from public.purchase_order_confirmations confirmation
      join public.purchase_order_devis document on document.id = confirmation.document_id
      where document.storage_path = objects.name
    )
  );

-- ---------------------------------------------------------------------------
-- 3. The price of a request line changes at the confirmation only.
-- ---------------------------------------------------------------------------
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
  -- 3a: the request line, affaire, imputation and kind of a line are set once; only the genuine detach of a deleted
  -- request line or supply type is accepted (the supply type otherwise follows the article, below).
  if tg_op='UPDATE' then
    if (new.material_request_line_id is distinct from old.material_request_line_id and not
        (new.material_request_line_id is null and not exists(select 1 from public.material_request_lines where id=old.material_request_line_id)))
      or (new.project_id,new.imputation,new.overhead_category,new.line_kind)
        is distinct from (old.project_id,old.imputation,old.overhead_category,old.line_kind)
      or (new.supply_type_id is distinct from old.supply_type_id and new.product_id is not distinct from old.product_id and not
        (new.supply_type_id is null and not exists(select 1 from public.supply_types where id=old.supply_type_id))) then
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
        or new.product_id is distinct from old.product_id
        -- 3a: the detach of a deleted request line or supply type (checked above).
        or new.material_request_line_id is distinct from old.material_request_line_id
        or new.supply_type_id is distinct from old.supply_type_id)
      and (new.product_id is not distinct from old.product_id or
        (new.product_id is null and old.product_id is not null and not exists(select 1 from public.products where id=old.product_id)))
      and (to_jsonb(new)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','material_request_line_id','supply_type_id','updated_at'])=
          (to_jsonb(old)-array['source_estimate_item_id','source_selected_supplier_price_id','product_id','material_request_line_id','supply_type_id','updated_at']) then
      return new;
    end if;
    raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE';
  end if;
  if new.quantity is null or new.quantity<=0 or new.quantity>2147483647 or new.quantity<>trunc(new.quantity,3) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  if new.unit_price_ht_cents is null or new.unit_price_ht_cents<0 or new.tax_rate_bp is null or new.tax_rate_bp not between 0 and 10000
    or nullif(btrim(new.designation),'') is null
    -- 3a: a price for 1, 10, 100 or 1 000 units.
    or new.price_per is null or new.price_per not in (1,10,100,1000) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  -- 3a: shipping and discounts are no article, and a lump sum: a quantity of 1, so that their amount is their price
  -- (also for a line kept without its kind).
  if new.line_kind<>'article' and (new.product_id is not null or new.quantity<>1) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  new.unit:=nullif(btrim(new.unit),'');
  if tg_op='INSERT' then
    -- 3a: a request line is written by create_material_request_purchase_orders only, for the order it is creating, as an
    -- article of that order's affaire; every other line is imputed to the order's affaire, when it has one.
    if new.material_request_line_id is not null then
      if pg_catalog.current_setting('app.material_request_ordering', true) is distinct from new.purchase_order_id::text then
        raise exception using errcode='42501',message='PURCHASE_ORDER_REQUEST_LINES_THROUGH_FUNCTION';
      end if;
      if new.line_kind<>'article' or po.project_id is null or new.project_id is distinct from po.project_id
        or new.imputation is null or not exists(select 1 from public.material_request_lines l
          where l.id=new.material_request_line_id and l.tenant_id=new.tenant_id and l.project_id=po.project_id) then
        raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
      end if;
    else
      new.project_id:=po.project_id;
      new.imputation:=case when po.project_id is not null then 'project' end;
      new.overhead_category:=null;
    end if;
    new.supply_type_id:=(select p.supply_type_id from public.products p where p.id=new.product_id and p.tenant_id=new.tenant_id);
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
    -- 3a: the unit of a request line is the one its quote priced.
    if old.material_request_line_id is not null and new.unit is distinct from old.unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    if new.price_unit is distinct from old.price_unit then
      raise exception using errcode='22023',message='PURCHASE_ORDER_SOURCE_UNIT_IMMUTABLE';
    end if;
    -- 3b: the price and the lot of a request line are its retained quote's until the order is confirmed with the real
    -- ones (confirm_material_request_purchase_order names the order in its marker).
    if old.material_request_line_id is not null
      and (new.unit_price_ht_cents,new.price_per) is distinct from (old.unit_price_ht_cents,old.price_per)
      and pg_catalog.current_setting('app.purchase_order_confirming',true) is distinct from new.purchase_order_id::text then
      raise exception using errcode='22023',message='PURCHASE_ORDER_REQUEST_PRICE_AT_CONFIRMATION';
    end if;
    if new.unit is null and (old.unit is not null or new.quantity is distinct from old.quantity or new.unit_price_ht_cents is distinct from old.unit_price_ht_cents) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
    end if;
    if not old.is_source_linked or old.unit is null then new.price_unit:=new.unit; end if;
    -- 3a: the supply type follows the article.
    if new.product_id is distinct from old.product_id then
      new.supply_type_id:=(select p.supply_type_id from public.products p where p.id=new.product_id and p.tenant_id=new.tenant_id);
    end if;
  end if;
  -- 3a: quantity x price / price_per, half away from zero to the cent (numeric round), exact for every amount an order
  -- holds and the previous round(quantity x price) for price_per 1. A discount subtracts: its totals are negative.
  ht:=round(new.quantity*new.unit_price_ht_cents/new.price_per);
  if new.line_kind='discount' then ht:=-ht; end if;
  tax:=round(ht*new.tax_rate_bp/10000);
  if greatest(abs(ht),abs(tax),abs(ht+tax))>2147483647 then
    raise exception using errcode='22023',message='PURCHASE_ORDER_AMOUNT_OUT_OF_RANGE';
  end if;
  new.line_total_ht_cents:=ht::integer; new.line_tax_cents:=tax::integer; new.line_total_ttc_cents:=(ht+tax)::integer;
  return new;
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. A draft from a request is delivered when the request needs its material.
-- ---------------------------------------------------------------------------
create or replace function public.create_material_request_purchase_orders(p_request_id uuid, p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant_value uuid;
  request_row record;
  receipt private.material_request_order_receipts%rowtype;
  ready_ids uuid[];
  inactive text[];
  notes_value text;
  group_row record;
  order_id uuid;
  order_row public.purchase_orders%rowtype;
  orders_result jsonb := '[]'::jsonb;
  result_value jsonb;
begin
  if p_request_id is null or p_idempotency_key is null then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_ORDER_INPUT_INVALID';
  end if;
  -- Allowed to create orders: a signed-in admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED).
  tenant_value := private.purchase_order_access(null, true);
  perform 1 from public.tenants where id = tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id = tenant_value and user_id = actor for share;
  -- 3b: needed_on.
  select request.id, request.project_id, request.requested_on, request.needed_on, request.delivery_place,
      request.presumed_material, request.material_confirmed, technician.name as technician_name
    into request_row
  from public.material_requests request
  left join public.material_request_technicians technician on technician.id = request.technician_id
  where request.id = p_request_id and request.tenant_id = tenant_value;
  if not found then
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_ORDER_NOT_FOUND';
  end if;
  -- And a writer of the request: owner of the affaire or admin.
  if not public.can_access_affaire_intake_project(request_row.project_id, tenant_value) then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_ORDER_WRITERS_ONLY';
  end if;

  -- One creation at a time per request; a replay waits for the call it replays.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('material-request-orders:' || p_request_id::text, 0));
  select * into receipt from private.material_request_order_receipts r
  where r.tenant_id = tenant_value and r.request_id = p_request_id and r.idempotency_key = p_idempotency_key;
  if found then
    if receipt.created_by <> actor and not public.has_tenant_role(tenant_value, array['admin'::public.tenant_role]) then
      raise exception using errcode = '23505', message = 'MATERIAL_REQUEST_ORDER_KEY_TAKEN';
    end if;
    -- The same drafts, each with its status as it now stands.
    return receipt.result || jsonb_build_object('replayed', true, 'orders', coalesce((
      select jsonb_agg(entry.answered || jsonb_build_object('status', coalesce(po.status::text, entry.answered->>'status'))
        order by entry.ordinal)
      from jsonb_array_elements(receipt.result->'orders') with ordinality as entry(answered, ordinal)
      left join public.purchase_orders po on po.id = (entry.answered->>'id')::uuid and po.tenant_id = tenant_value
    ), '[]'::jsonb));
  end if;

  -- The lines are shared-locked until the drafts commit: what is ordered is what was read.
  perform 1 from public.material_request_lines line
  where line.request_id = p_request_id and line.tenant_id = tenant_value order by line.id for share;
  select pg_catalog.array_agg(s.line_id order by s.line_position, s.line_id) into ready_ids
  from private.material_request_order_lines(tenant_value, p_request_id) s where s.state = 'ready';
  if ready_ids is null then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_ORDER_NOTHING_READY';
  end if;
  select pg_catalog.array_agg(distinct supplier.name order by supplier.name) into inactive
  from public.material_request_lines line join public.suppliers supplier on supplier.id = line.supplier_id
  where line.id = any(ready_ids) and not supplier.is_active;
  if inactive is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_ORDER_SUPPLIER_INACTIVE',
      detail = pg_catalog.array_to_json(inactive)::text;
  end if;

  notes_value := 'Demande de matériel du ' || pg_catalog.to_char(request_row.requested_on, 'DD/MM/YYYY')
    || coalesce(' (' || request_row.technician_name || ')', '');
  for group_row in
    select line.supplier_id, supplier.name as supplier_name,
      pg_catalog.array_agg(line.id order by line.position, line.id) as line_ids
    from public.material_request_lines line
    join public.suppliers supplier on supplier.id = line.supplier_id and supplier.tenant_id = tenant_value
    where line.id = any(ready_ids)
    group by line.supplier_id, supplier.name
    order by supplier.name, line.supplier_id
  loop
    order_id := gen_random_uuid();
    perform pg_catalog.set_config('app.material_request_ordering', order_id::text, true);
    -- 3b: delivered on the date the request needs its material (the column holds AAAA-MM-JJ text).
    insert into public.purchase_orders (id, tenant_id, user_id, reference, supplier_id, delivery_site_id, project_id,
        delivery_mode, status, notes, currency, expected_delivery_date)
    values (order_id, tenant_value, actor, 'TEMP-' || gen_random_uuid()::text, group_row.supplier_id, null,
        request_row.project_id, request_row.delivery_place, 'draft', notes_value, 'EUR',
        pg_catalog.to_char(request_row.needed_on, 'YYYY-MM-DD'))
    returning * into order_row;
    update public.purchase_orders set reference = 'C-' || pg_catalog.to_char(order_row.order_date, 'YYMM') || '-'
        || pg_catalog.lpad(order_row.order_number::text, greatest(3, pg_catalog.length(order_row.order_number::text)), '0')
    where id = order_id;
    -- Each line as its retained quote priced it, at 20 % (the manual order form's rate), with its article's reference
    -- at this supplier (else the article's own), the wording it took from the catalogue and its imputation.
    insert into public.purchase_order_items (tenant_id, purchase_order_id, position, product_id, reference, designation,
        quantity, unit, unit_price_ht_cents, price_per, tax_rate_bp, line_total_ht_cents, line_tax_cents,
        line_total_ttc_cents, material_request_line_id, project_id, imputation, overhead_category)
    select tenant_value, order_id, wanted.ordinal, line.product_id,
      coalesce(nullif(pg_catalog.btrim(item.supplier_sku), ''), nullif(pg_catalog.btrim(product.reference), '')),
      private.material_request_line_designation(line.product_type, line.original_text, line.dimension,
        coalesce(nullif(pg_catalog.btrim(line.material), ''),
          case when line.imputation = 'project' and request_row.material_confirmed then request_row.presumed_material end),
        line.material_precision),
      line.quantity, pg_catalog.btrim(line.unit), line.unit_price_ht_cents, line.price_per, 2000, 0, 0, 0,
      line.id, request_row.project_id, line.imputation,
      case when line.imputation = 'overhead' then line.overhead_category end
    from pg_catalog.unnest(group_row.line_ids) with ordinality as wanted(line_id, ordinal)
    join public.material_request_lines line on line.id = wanted.line_id
    left join public.products product on product.id = line.product_id and product.tenant_id = tenant_value
    left join public.supplier_catalog_items item on item.tenant_id = tenant_value and item.supplier_id = group_row.supplier_id
      and item.product_id = line.product_id and item.is_active
    order by wanted.ordinal;
    perform pg_catalog.set_config('app.material_request_ordering', '', true);
    select * into order_row from public.purchase_orders where id = order_id;
    orders_result := orders_result || jsonb_build_array(jsonb_build_object(
      'id', order_row.id, 'reference', order_row.reference, 'supplier_id', order_row.supplier_id,
      'supplier_name', group_row.supplier_name, 'status', order_row.status::text, 'line_count', pg_catalog.cardinality(group_row.line_ids),
      'line_ids', pg_catalog.to_jsonb(group_row.line_ids), 'total_ht_cents', order_row.total_ht_cents,
      'total_tax_cents', order_row.total_tax_cents, 'total_ttc_cents', order_row.total_ttc_cents));
  end loop;

  result_value := jsonb_build_object('request_id', p_request_id, 'idempotency_key', p_idempotency_key,
    'replayed', false, 'orders', orders_result);
  insert into private.material_request_order_receipts (tenant_id, request_id, idempotency_key, created_by, result)
  values (tenant_value, p_request_id, p_idempotency_key, actor, result_value);
  return result_value;
end;
$$;


comment on function public.create_material_request_purchase_orders(uuid, uuid) is
  'TI-691: one draft purchase order per supplier from the ready lines of a material request (validated, priced by a retained quote, in no order that is not canceled), all of the request''s affaire, its overhead lines included (imputation overhead); no delivery site, the request''s delivery place as delivery mode, delivered on the date the request needs its material, notes naming the request. Each line: article, reference at the supplier (else the article''s), catalogue wording, quantity, unit, quote price and lot, 20 % tax, imputation, request line. Idempotent per request and key (replayed: true, each order with its current status). Caller: admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED) who writes the request (MATERIAL_REQUEST_ORDER_WRITERS_ONLY). Refusals: MATERIAL_REQUEST_ORDER_NOT_FOUND, _NOTHING_READY, _SUPPLIER_INACTIVE (DETAIL: JSON names), _KEY_TAKEN, MATERIAL_REQUEST_LINE_ALREADY_ORDERED.';

-- ---------------------------------------------------------------------------
-- 5. Confirming and receiving an order of an affaire.
-- ---------------------------------------------------------------------------
-- p_confirmation: { ordered_on: 'YYYY-MM-DD', expected_delivery_date?: 'YYYY-MM-DD' | null, supplier_reference?: text | null,
-- document_id: uuid of a document joined to the order, lines?: [{ id, unit_price_ht_cents, price_per }] }. The lines
-- given take their real price and lot (each once, of this order); the others keep theirs. In this order, while the order
-- is still a draft: the prices, then the order and delivery dates (the header totals follow), then the confirmation, and
-- last the status alone (an isolated status change, which the lifecycle guard accepts under the marker naming the order).
create function public.confirm_material_request_purchase_order(
  p_order_id uuid, p_expected_revision bigint, p_confirmation jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant_value uuid;
  po public.purchase_orders%rowtype;
  today date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  ordered_value date;
  delivery_value date;
  reference_value text;
  document_value uuid;
  lines_value jsonb;
  line jsonb;
  line_ids uuid[];
begin
  if p_order_id is null or pg_catalog.jsonb_typeof(p_confirmation) is distinct from 'object'
    or p_confirmation - array['ordered_on', 'expected_delivery_date', 'supplier_reference', 'document_id', 'lines'] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_confirmation->'ordered_on') is distinct from 'string'
    or p_confirmation->>'ordered_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(pg_catalog.jsonb_typeof(p_confirmation->'expected_delivery_date'), 'null') not in ('string', 'null')
    or coalesce(p_confirmation->>'expected_delivery_date', '0000-00-00') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(pg_catalog.jsonb_typeof(p_confirmation->'supplier_reference'), 'null') not in ('string', 'null')
    or coalesce(pg_catalog.jsonb_typeof(p_confirmation->'document_id'), 'null') not in ('string', 'null')
    or coalesce(pg_catalog.jsonb_typeof(p_confirmation->'lines'), 'array') <> 'array' then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end if;
  -- An admin or engineer of the active tenant who is the order's author or an admin (PURCHASE_ORDER_ACCESS_DENIED).
  tenant_value := private.purchase_order_access(p_order_id, true);
  select * into po from public.purchase_orders where id = p_order_id and tenant_id = tenant_value for update;
  if po.project_id is null then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_AFFAIRE_ONLY';
  end if;
  if po.status <> 'draft' then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_CONFIRMATION_NOT_DRAFT';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_REQUIRED';
  end if;
  if p_expected_revision <> po.edit_revision then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_CONFLICT';
  end if;

  lines_value := coalesce(p_confirmation->'lines', '[]'::jsonb);
  begin
    ordered_value := (p_confirmation->>'ordered_on')::date;
    delivery_value := (p_confirmation->>'expected_delivery_date')::date;
    document_value := (p_confirmation->>'document_id')::uuid;
    if pg_catalog.jsonb_array_length(lines_value) > 1000 then
      raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEMS_INVALID';
    end if;
    for line in select value from pg_catalog.jsonb_array_elements(lines_value) loop
      if pg_catalog.jsonb_typeof(line) is distinct from 'object'
        or line - array['id', 'unit_price_ht_cents', 'price_per'] <> '{}'::jsonb
        or pg_catalog.jsonb_typeof(line->'id') is distinct from 'string'
        or pg_catalog.jsonb_typeof(line->'unit_price_ht_cents') is distinct from 'number'
        or pg_catalog.jsonb_typeof(line->'price_per') is distinct from 'number' then
        raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
      end if;
      if (line->>'unit_price_ht_cents')::numeric not between 0 and 2147483647
        or (line->>'unit_price_ht_cents')::numeric <> pg_catalog.trunc((line->>'unit_price_ht_cents')::numeric)
        or line->>'price_per' not in ('1', '10', '100', '1000') then
        raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
      end if;
    end loop;
    select coalesce(pg_catalog.array_agg((wanted.value->>'id')::uuid), '{}'::uuid[]) into line_ids
    from pg_catalog.jsonb_array_elements(lines_value) wanted;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end;
  reference_value := nullif(pg_catalog.btrim(p_confirmation->>'supplier_reference'), '');
  if pg_catalog.char_length(reference_value) > 120 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end if;
  -- Passed today at the latest (Paris), delivered on that day or after when a delivery date is given.
  if ordered_value > today or delivery_value < ordered_value then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CONFIRMATION_DATE_INVALID';
  end if;
  if document_value is null or not exists (
    select 1 from public.purchase_order_devis document
    where document.id = document_value and document.purchase_order_id = po.id and document.tenant_id = tenant_value
  ) then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED';
  end if;
  if pg_catalog.cardinality(line_ids) <> (select count(distinct wanted.id) from pg_catalog.unnest(line_ids) wanted(id))
    or exists (
      select 1 from pg_catalog.unnest(line_ids) wanted(id)
      where not exists (select 1 from public.purchase_order_items oi where oi.id = wanted.id and oi.purchase_order_id = po.id)
    ) then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  if not exists (select 1 from public.purchase_order_items oi where oi.purchase_order_id = po.id and oi.line_kind = 'article') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CONFIRMATION_EMPTY';
  end if;

  perform 1 from public.purchase_order_items oi where oi.purchase_order_id = po.id order by oi.id for update;
  perform pg_catalog.set_config('app.purchase_order_confirming', po.id::text, true);
  update public.purchase_order_items oi
  set unit_price_ht_cents = (wanted.value->>'unit_price_ht_cents')::numeric::integer,
    price_per = (wanted.value->>'price_per')::numeric::integer
  from pg_catalog.jsonb_array_elements(lines_value) wanted
  where oi.id = (wanted.value->>'id')::uuid and oi.purchase_order_id = po.id
    and (oi.unit_price_ht_cents, oi.price_per)
      is distinct from ((wanted.value->>'unit_price_ht_cents')::numeric::integer, (wanted.value->>'price_per')::numeric::integer);
  update public.purchase_orders
  set order_date = ordered_value,
    -- The delivery date column holds AAAA-MM-JJ text (the draft editor's format).
    expected_delivery_date = case when p_confirmation ? 'expected_delivery_date'
      then pg_catalog.to_char(delivery_value, 'YYYY-MM-DD') else expected_delivery_date end
  where id = po.id;
  -- The real prices may let the discounts exceed the articles: refused here, before anything says « confirmed »,
  -- rather than at commit.
  set constraints public.purchase_orders_totals_not_negative immediate;
  insert into public.purchase_order_confirmations (purchase_order_id, tenant_id, document_id, supplier_reference, confirmed_by)
  values (po.id, tenant_value, document_value, reference_value, actor);
  update public.purchase_orders set status = 'confirmed' where id = po.id;
  perform pg_catalog.set_config('app.purchase_order_confirming', '', true);

  select * into po from public.purchase_orders where id = p_order_id;
  return jsonb_build_object('id', po.id, 'status', po.status::text, 'edit_revision', po.edit_revision,
    'order_date', po.order_date, 'expected_delivery_date', po.expected_delivery_date,
    'total_ht_cents', po.total_ht_cents, 'total_tax_cents', po.total_tax_cents, 'total_ttc_cents', po.total_ttc_cents);
end;
$$;

comment on function public.confirm_material_request_purchase_order(uuid, bigint, jsonb) is
  'TI-691: records that a draft of an affaire was ordered: the real price and lot of the lines given, the order date (today at the latest, Paris), the delivery date (not before it), the supplier''s reference and the document joined to the order that proves it; the draft becomes confirmed. Caller: admin or engineer of the active tenant who is the order''s author or an admin (PURCHASE_ORDER_ACCESS_DENIED). Refusals: PURCHASE_ORDER_INPUT_INVALID, _AFFAIRE_ONLY, _CONFIRMATION_NOT_DRAFT, _REVISION_REQUIRED, _REVISION_CONFLICT, _CONFIRMATION_DATE_INVALID, _CONFIRMATION_PROOF_REQUIRED, _ITEMS_INVALID, _CONFIRMATION_EMPTY.';

-- p_reception: { received_on: 'YYYY-MM-DD', note?: text | null }. The whole order is received, on that day: not before
-- it was passed, today at the latest (Paris). The note says what is still to come.
create function public.receive_material_request_purchase_order(
  p_order_id uuid, p_expected_revision bigint, p_reception jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant_value uuid;
  po public.purchase_orders%rowtype;
  today date := (pg_catalog.now() at time zone 'Europe/Paris')::date;
  received_value date;
  note_value text;
begin
  if p_order_id is null or pg_catalog.jsonb_typeof(p_reception) is distinct from 'object'
    or p_reception - array['received_on', 'note'] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_reception->'received_on') is distinct from 'string'
    or p_reception->>'received_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or coalesce(pg_catalog.jsonb_typeof(p_reception->'note'), 'null') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end if;
  tenant_value := private.purchase_order_access(p_order_id, true);
  select * into po from public.purchase_orders where id = p_order_id and tenant_id = tenant_value for update;
  if po.project_id is null then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_AFFAIRE_ONLY';
  end if;
  if po.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_RECEPTION_NOT_CONFIRMED';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_REQUIRED';
  end if;
  if p_expected_revision <> po.edit_revision then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_CONFLICT';
  end if;
  begin
    received_value := (p_reception->>'received_on')::date;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end;
  note_value := nullif(pg_catalog.btrim(p_reception->>'note'), '');
  if pg_catalog.char_length(note_value) > 2000 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if received_value > today or received_value < po.order_date then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_RECEPTION_DATE_INVALID';
  end if;

  perform pg_catalog.set_config('app.purchase_order_receiving', po.id::text, true);
  insert into public.purchase_order_receptions (purchase_order_id, tenant_id, received_on, note, received_by)
  values (po.id, tenant_value, received_value, note_value, actor);
  update public.purchase_orders set status = 'received' where id = po.id;
  perform pg_catalog.set_config('app.purchase_order_receiving', '', true);

  select * into po from public.purchase_orders where id = p_order_id;
  return jsonb_build_object('id', po.id, 'status', po.status::text, 'edit_revision', po.edit_revision);
end;
$$;

comment on function public.receive_material_request_purchase_order(uuid, bigint, jsonb) is
  'TI-691: records the reception of a whole confirmed order of an affaire, on a day between its order date and today (Paris), with a free note for what is still to come; the order becomes received. Caller: admin or engineer of the active tenant who is the order''s author or an admin (PURCHASE_ORDER_ACCESS_DENIED). Refusals: PURCHASE_ORDER_INPUT_INVALID, _AFFAIRE_ONLY, _RECEPTION_NOT_CONFIRMED, _REVISION_REQUIRED, _REVISION_CONFLICT, _RECEPTION_DATE_INVALID.';

revoke all on function private.guard_purchase_order_lifecycle() from public, anon, authenticated, service_role;
revoke all on function public.confirm_material_request_purchase_order(uuid, bigint, jsonb),
  public.receive_material_request_purchase_order(uuid, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_material_request_purchase_order(uuid, bigint, jsonb),
  public.receive_material_request_purchase_order(uuid, bigint, jsonb)
  to authenticated;
