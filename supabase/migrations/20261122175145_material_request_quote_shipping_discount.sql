-- TI-691, lot 2 « l'achat »: the shipping and the discount of a supplier's quote. No remote application is authorized
-- here.
--
-- A supplier's quote often totals more than its lines (shipping, « Fdp ») or less (a global discount). Until now the
-- office wrote them in the quote's notes and retyped them on the purchase order, or forgot them: the order, and the
-- supply cost of the affaire that measures the K FO (losses, transport, volume), missed them. They become two amounts of
-- the quote, which the drafts made from the request carry as their own shipping and discount lines.
--
-- 1. public.material_request_quotes.shipping_ht_cents and discount_ht_cents: whole cents excluding tax, >= 0, null
--    when the quote names none. Written like the total and the notes (update_material_request_quote, or a direct
--    update by a writer) while the quote is requested or received; read-only once it is retained or closed
--    (MATERIAL_REQUEST_QUOTE_READ_ONLY). A quote is retained only with a discount no larger than its lines and its
--    shipping (MATERIAL_REQUEST_QUOTE_DISCOUNT_TOO_LARGE): the draft that carries them keeps a total >= 0.
--    private.guard_material_request_quote_charges() holds both rules beside enforce_material_request_quote_write,
--    which is left as it is.
-- 2. public.purchase_order_items.material_request_quote_id: the retained quote a shipping or discount line comes from
--    (CHECK: only those kinds). Written once, by create_material_request_purchase_orders (transaction-local marker
--    app.material_request_ordering = the order id), for a retained quote of the order's affaire and supplier; it never
--    changes afterwards (PURCHASE_ORDER_ITEMS_INVALID). No foreign key: the item trigger refuses any change to an order
--    that is not a draft except named detaches, so an ON DELETE SET NULL would make a request whose canceled orders
--    carry its quote's shipping impossible to delete; the id stays as provenance, like the request's date in the
--    order's notes. The amount stays editable in the draft, like any shipping or discount line, and the line can be
--    removed from the draft (then nothing carries the charge until the quote's lines are ordered again).
-- 3. private.material_request_quote_charge_orders: a quote's shipping and its discount are each held by one order that
--    is not canceled at most (primary key quote, kind), kept by triggers on the items (insert) and on the order's status
--    (canceled frees them, reopening takes them back or is refused: MATERIAL_REQUEST_LINE_ALREADY_ORDERED, as for its
--    lines). A deleted item frees its charge (cascade).
-- 4. public.update_material_request_quote and public.create_material_request_purchase_orders are copied from their
--    latest definitions (20261112173255, 20261113190113) with only the lines marked « charges » changed. The creation
--    adds, after the articles of a draft, a « Port » and a « Remise » line (quantity 1, unit « forfait », 20 %) for
--    each retained quote that priced one of its lines, completes it (its other lines are in orders that stand) and whose
--    charge no standing order holds; a draft that would then total less than zero is refused, named by its supplier
--    (MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE), instead of failing at commit. CREATE OR REPLACE keeps owners and ACLs. The supply cost of an affaire already counts these kinds in its « Port et remises » row.
-- Regression: supabase/tests/database/material-request-quote-charges.test.sql.

begin;
set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.material_request_quotes') is null
    or to_regclass('public.material_request_quote_lines') is null
    or to_regclass('public.purchase_order_items') is null
    or to_regclass('private.material_request_line_orders') is null
    or to_regprocedure('public.update_material_request_quote(uuid, jsonb)') is null
    or to_regprocedure('public.create_material_request_purchase_orders(uuid, uuid)') is null
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'line_kind'
    )
  then
    raise exception 'TI691_QUOTE_CHARGES_PREREQUISITE_MISSING';
  end if;
  if exists (
    select 1 from information_schema.columns
    where (table_schema = 'public' and table_name = 'material_request_quotes'
        and column_name in ('shipping_ht_cents', 'discount_ht_cents'))
      or (table_schema = 'public' and table_name = 'purchase_order_items' and column_name = 'material_request_quote_id')
  ) or to_regclass('private.material_request_quote_charge_orders') is not null then
    raise exception 'TI691_QUOTE_CHARGES_PREFLIGHT: the charge columns already exist';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The shipping and the discount of a quote.
-- ---------------------------------------------------------------------------
alter table public.material_request_quotes
  add column shipping_ht_cents integer check (shipping_ht_cents is null or shipping_ht_cents >= 0),
  add column discount_ht_cents integer check (discount_ht_cents is null or discount_ht_cents >= 0);

comment on column public.material_request_quotes.shipping_ht_cents is
  'TI-691: the supplier''s shipping for this quote, whole cents excluding tax; null when it names none. Read-only once the quote is retained or closed; the drafts made from the request carry it as a « Port » line.';
comment on column public.material_request_quotes.discount_ht_cents is
  'TI-691: the supplier''s global discount for this quote, whole cents excluding tax (>= 0, subtracted); null when it names none. Read-only once the quote is retained or closed; at most its lines and its shipping when it is retained; the drafts made from the request carry it as a « Remise » line.';

create function private.guard_material_request_quote_charges()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  lines_total numeric;
begin
  if old.status in ('retained', 'closed')
    and (new.shipping_ht_cents, new.discount_ht_cents) is distinct from (old.shipping_ht_cents, old.discount_ht_cents)
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
  end if;
  -- Retaining: the draft that will carry the discount keeps a total >= 0. Its lines are priced (the retaining checks
  -- it before it changes the status); each amount is quantity x price / price_per, half away from zero to the cent,
  -- as the order computes it.
  if new.status = 'retained' and old.status <> 'retained' and coalesce(new.discount_ht_cents, 0) > 0 then
    select coalesce(sum(pg_catalog.round(line.quantity * quote_line.unit_price_ht_cents / quote_line.price_per)), 0)
      into lines_total
    from public.material_request_quote_lines quote_line
    join public.material_request_lines line on line.id = quote_line.line_id
    where quote_line.quote_id = new.id;
    if new.discount_ht_cents > lines_total + coalesce(new.shipping_ht_cents, 0) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_DISCOUNT_TOO_LARGE';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_material_request_quote_charges() from public, anon, authenticated;
create trigger guard_material_request_quote_charges
  before update on public.material_request_quotes
  for each row execute function private.guard_material_request_quote_charges();

-- ---------------------------------------------------------------------------
-- 2. The quote a shipping or discount line of an order comes from.
-- ---------------------------------------------------------------------------
alter table public.purchase_order_items
  add column material_request_quote_id uuid,
  add constraint purchase_order_items_quote_charge_check
    check (material_request_quote_id is null or line_kind in ('shipping', 'discount'));
create index purchase_order_items_material_request_quote_idx
  on public.purchase_order_items (material_request_quote_id) where material_request_quote_id is not null;

comment on column public.purchase_order_items.material_request_quote_id is
  'TI-691: the retained quote whose shipping or discount this line carries; set once by create_material_request_purchase_orders, never changed. No foreign key: kept as provenance when the request is deleted later.';

create function private.guard_purchase_order_item_quote_charge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if pg_catalog.current_setting('app.material_request_ordering', true) is distinct from new.purchase_order_id::text
      or not exists (
        select 1 from public.purchase_orders po
        join public.material_request_quotes quote on quote.tenant_id = po.tenant_id and quote.project_id = po.project_id
          and quote.supplier_id = po.supplier_id
        where po.id = new.purchase_order_id and quote.id = new.material_request_quote_id and quote.status = 'retained'
      )
    then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_REQUEST_LINES_THROUGH_FUNCTION';
    end if;
    return new;
  end if;
  raise exception using errcode = '22023', message = 'PURCHASE_ORDER_ITEMS_INVALID';
end;
$$;
revoke all on function private.guard_purchase_order_item_quote_charge() from public, anon, authenticated;
create trigger guard_purchase_order_item_quote_charge
  before insert on public.purchase_order_items
  for each row when (new.material_request_quote_id is not null)
  execute function private.guard_purchase_order_item_quote_charge();
create trigger guard_purchase_order_item_quote_charge_change
  before update on public.purchase_order_items
  for each row when (new.material_request_quote_id is distinct from old.material_request_quote_id)
  execute function private.guard_purchase_order_item_quote_charge();

-- ---------------------------------------------------------------------------
-- 3. A quote's shipping and discount are each held by one order that stands.
-- ---------------------------------------------------------------------------
create table private.material_request_quote_charge_orders (
  quote_id uuid not null references public.material_request_quotes(id) on delete cascade,
  line_kind text not null check (line_kind in ('shipping', 'discount')),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null unique references public.purchase_order_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quote_id, line_kind)
);
create index material_request_quote_charge_orders_order_idx on private.material_request_quote_charge_orders (purchase_order_id);
create index material_request_quote_charge_orders_tenant_idx on private.material_request_quote_charge_orders (tenant_id);
alter table private.material_request_quote_charge_orders enable row level security;
revoke all on private.material_request_quote_charge_orders from public, anon, authenticated, service_role;

comment on table private.material_request_quote_charge_orders is
  'TI-691: the order that is not canceled holding the shipping or the discount of a retained quote, one per quote and kind. Kept by triggers on purchase_order_items (insert) and purchase_orders (status).';

create function private.track_material_request_quote_charge_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.purchase_orders po where po.id = new.purchase_order_id and po.status <> 'canceled') then
    insert into private.material_request_quote_charge_orders (quote_id, line_kind, tenant_id, purchase_order_id, item_id)
    values (new.material_request_quote_id, new.line_kind, new.tenant_id, new.purchase_order_id, new.id);
  end if;
  return null;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'MATERIAL_REQUEST_LINE_ALREADY_ORDERED';
end;
$$;
revoke all on function private.track_material_request_quote_charge_order() from public, anon, authenticated;
create trigger track_material_request_quote_charge_order
  after insert on public.purchase_order_items
  for each row when (new.material_request_quote_id is not null)
  execute function private.track_material_request_quote_charge_order();

-- Canceling an order frees its charges; reopening it takes them back, or is refused when another order holds one now.
-- Named to run after track_material_request_order_status, which settles its lines first (a reopening whose lines
-- changed or were ordered again is refused there, with its own code).
create function private.track_material_request_quote_charge_order_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'canceled' and old.status <> 'canceled' then
    delete from private.material_request_quote_charge_orders where purchase_order_id = new.id;
  elsif old.status = 'canceled' and new.status <> 'canceled' then
    insert into private.material_request_quote_charge_orders (quote_id, line_kind, tenant_id, purchase_order_id, item_id)
    select oi.material_request_quote_id, oi.line_kind, oi.tenant_id, oi.purchase_order_id, oi.id
    from public.purchase_order_items oi
    where oi.purchase_order_id = new.id and oi.material_request_quote_id is not null
      -- A quote deleted since (with its request) has nothing left to hold.
      and exists (select 1 from public.material_request_quotes quote where quote.id = oi.material_request_quote_id);
  end if;
  return null;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'MATERIAL_REQUEST_LINE_ALREADY_ORDERED';
end;
$$;
revoke all on function private.track_material_request_quote_charge_order_status() from public, anon, authenticated;
create trigger track_material_request_quote_charge_order_status
  after update of status on public.purchase_orders
  for each row when (old.status is distinct from new.status)
  execute function private.track_material_request_quote_charge_order_status();

-- ---------------------------------------------------------------------------
-- 4. Writing the charges of a quote, and carrying them into the drafts.
-- ---------------------------------------------------------------------------
create or replace function public.update_material_request_quote(p_quote_id uuid, p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target record;
  written integer;
begin
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_changes) as change(key)
      -- charges: shipping_ht_cents and discount_ht_cents.
      where change.key not in ('amount_ht_cents', 'shipping_ht_cents', 'discount_ht_cents', 'notes', 'lines', 'received')
    )
    or (p_changes ? 'amount_ht_cents' and pg_catalog.jsonb_typeof(p_changes -> 'amount_ht_cents') <> 'null'
      and coalesce(p_changes ->> 'amount_ht_cents', '') !~ '^[0-9]{1,10}$')
    -- charges: a JSON number of whole cents from 0 to the column's 2 147 483 647, or null to clear.
    or (p_changes ? 'shipping_ht_cents' and pg_catalog.jsonb_typeof(p_changes -> 'shipping_ht_cents') <> 'null'
      and (pg_catalog.jsonb_typeof(p_changes -> 'shipping_ht_cents') <> 'number'
        or (p_changes ->> 'shipping_ht_cents') !~ '^[0-9]{1,10}$'
        or (p_changes ->> 'shipping_ht_cents')::bigint > 2147483647))
    or (p_changes ? 'discount_ht_cents' and pg_catalog.jsonb_typeof(p_changes -> 'discount_ht_cents') <> 'null'
      and (pg_catalog.jsonb_typeof(p_changes -> 'discount_ht_cents') <> 'number'
        or (p_changes ->> 'discount_ht_cents') !~ '^[0-9]{1,10}$'
        or (p_changes ->> 'discount_ht_cents')::bigint > 2147483647))
    or (p_changes ? 'notes' and pg_catalog.jsonb_typeof(p_changes -> 'notes') not in ('string', 'null'))
    or (p_changes ? 'received' and p_changes -> 'received' <> 'true'::jsonb)
    or (p_changes ? 'lines' and (
      pg_catalog.jsonb_typeof(p_changes -> 'lines') <> 'array'
      or pg_catalog.jsonb_array_length(p_changes -> 'lines') not between 1 and 300
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line)
        where pg_catalog.jsonb_typeof(entry.line) <> 'object'
          or pg_catalog.jsonb_typeof(entry.line -> 'line_id') is distinct from 'string'
          or not (entry.line ? 'unit_price_ht_cents')
          or (pg_catalog.jsonb_typeof(entry.line -> 'unit_price_ht_cents') <> 'null'
            and coalesce(entry.line ->> 'unit_price_ht_cents', '') !~ '^[0-9]{1,10}$')
          or (entry.line ? 'price_per' and (pg_catalog.jsonb_typeof(entry.line -> 'price_per') <> 'number'
            or (entry.line ->> 'price_per') not in ('1', '10', '100', '1000')))
      )
      or (select count(distinct entry.line ->> 'line_id') from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line))
        <> pg_catalog.jsonb_array_length(p_changes -> 'lines')
    ))
  then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_QUOTE_CHANGES_INVALID';
  end if;

  -- Locked for update: a retaining or a closing of this quote waits, or has already happened and is seen here. A
  -- quote the caller reads but may not change is not locked.
  select q.id, q.status into target from public.material_request_quotes q where q.id = p_quote_id for update;
  if not found then
    if exists (select 1 from public.material_request_quotes q where q.id = p_quote_id) then
      raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_QUOTE_WRITERS_ONLY';
    end if;
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_QUOTE_NOT_FOUND';
  end if;
  if target.status not in ('requested', 'received') then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_READ_ONLY';
  end if;

  if p_changes ? 'lines' then
    update public.material_request_quote_lines quote_line
    set unit_price_ht_cents = (entry.line ->> 'unit_price_ht_cents')::bigint,
        price_per = case when entry.line ? 'price_per' then (entry.line ->> 'price_per')::integer else quote_line.price_per end
    from pg_catalog.jsonb_array_elements(p_changes -> 'lines') as entry(line)
    where quote_line.quote_id = target.id and quote_line.line_id = (entry.line ->> 'line_id')::uuid;
    get diagnostics written = row_count;
    if written <> pg_catalog.jsonb_array_length(p_changes -> 'lines') then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE';
    end if;
  end if;

  update public.material_request_quotes q
  set amount_ht_cents = case when p_changes ? 'amount_ht_cents'
        then (p_changes ->> 'amount_ht_cents')::bigint else q.amount_ht_cents end,
      -- charges.
      shipping_ht_cents = case when p_changes ? 'shipping_ht_cents'
        then (p_changes ->> 'shipping_ht_cents')::bigint else q.shipping_ht_cents end,
      discount_ht_cents = case when p_changes ? 'discount_ht_cents'
        then (p_changes ->> 'discount_ht_cents')::bigint else q.discount_ht_cents end,
      notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else q.notes end,
      status = case when p_changes ? 'received' and q.status = 'requested' then 'received' else q.status end
  where q.id = target.id;
end;
$$;

comment on function public.update_material_request_quote(uuid, jsonb) is
  'TI-691: changes the prices of a quote''s lines (whole cents for price_per units: 1, 10, 100 or 1000), its total, its shipping and discount (whole cents, null clears), its notes and/or marks it received (from requested), in one statement, as the caller (RLS), while it is requested or received (MATERIAL_REQUEST_QUOTE_READ_ONLY). Keys left out are left alone (MATERIAL_REQUEST_QUOTE_CHANGES_INVALID for any other key or value); every priced line is one of the quote''s (MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE).';


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
    -- charges: the shipping and the discount of each retained quote that priced a line of this draft, after its
    -- articles, at 20 %, each held once among the orders that stand (private.material_request_quote_charge_orders).
    -- They go with the draft that completes the quote: every other line the quote priced is already in an order that
    -- stands. A quote whose lines are ordered in several drafts (one returned to draft meanwhile, for instance) gives
    -- them to the last, which its discount was checked against at the retain as a whole; a canceled order frees them.
    insert into public.purchase_order_items (tenant_id, purchase_order_id, position, reference, designation, quantity,
        unit, unit_price_ht_cents, price_per, tax_rate_bp, line_total_ht_cents, line_tax_cents, line_total_ttc_cents,
        line_kind, material_request_quote_id)
    select tenant_value, order_id, pg_catalog.cardinality(group_row.line_ids)
        + pg_catalog.row_number() over (order by charge.retained_at, charge.quote_id, charge.kind_order),
      null, charge.designation, 1, 'forfait', charge.amount, 1, 2000, 0, 0, 0, charge.line_kind, charge.quote_id
    from (
      select quote.id as quote_id, quote.retained_at, kind.line_kind, kind.kind_order, kind.designation,
        case kind.line_kind when 'shipping' then quote.shipping_ht_cents else quote.discount_ht_cents end as amount
      from public.material_request_quotes quote
      cross join (values ('shipping', 1, 'Port'), ('discount', 2, 'Remise')) as kind(line_kind, kind_order, designation)
      where quote.tenant_id = tenant_value and quote.request_id = p_request_id and quote.status = 'retained'
        and quote.supplier_id = group_row.supplier_id
        and exists (select 1 from public.material_request_lines line
          where line.id = any(group_row.line_ids) and line.price_quote_id = quote.id)
        and not exists (select 1 from public.material_request_lines line
          where line.price_quote_id = quote.id and line.id <> all(group_row.line_ids)
            and not exists (select 1 from private.material_request_line_orders held_line where held_line.line_id = line.id))
    ) charge
    where charge.amount > 0
      and not exists (select 1 from private.material_request_quote_charge_orders held
        where held.quote_id = charge.quote_id and held.line_kind = charge.line_kind);
    -- charges: a discount larger than what this draft holds (lines of the quote ordered earlier in another draft, or
    -- the tax of a discount equal to the lines, rounded once) is refused here, named by its supplier, rather than by
    -- the deferred total check at commit with no word for the office.
    if exists (select 1 from public.purchase_orders po
      where po.id = order_id and (po.total_ht_cents < 0 or po.total_tax_cents < 0 or po.total_ttc_cents < 0)) then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE',
        detail = pg_catalog.json_build_array(group_row.supplier_name)::text;
    end if;
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
  'TI-691: one draft purchase order per supplier from the ready lines of a material request (validated, priced by a retained quote, in no order that is not canceled), all of the request''s affaire, its overhead lines included (imputation overhead); no delivery site, the request''s delivery place as delivery mode, delivered on the date the request needs its material, notes naming the request. Each line: article, reference at the supplier (else the article''s), catalogue wording, quantity, unit, quote price and lot, 20 % tax, imputation, request line; then the shipping (« Port ») and the discount (« Remise ») of each retained quote that priced a line of the draft and that the draft completes, a lump sum at 20 % linked to its quote (material_request_quote_id), each once among the orders that are not canceled. Idempotent per request and key (replayed: true, each order with its current status). Caller: admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED) who writes the request (MATERIAL_REQUEST_ORDER_WRITERS_ONLY). Refusals: MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE (DETAIL: JSON name of the supplier), MATERIAL_REQUEST_ORDER_NOT_FOUND, _NOTHING_READY, _SUPPLIER_INACTIVE (DETAIL: JSON names), _KEY_TAKEN, MATERIAL_REQUEST_LINE_ALREADY_ORDERED.';

commit;
