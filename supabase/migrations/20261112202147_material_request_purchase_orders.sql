-- TI-691, lot 2 « l'achat », delivery 3a (« bons de commande depuis les demandes »). No remote application is
-- authorized here.
--
-- The office turns the ready lines of a material request (validated, priced by a retained quote, not yet in an order
-- that is not canceled) into draft purchase orders: one per supplier, all of the request's affaire; the lines imputed
-- to overhead (frais généraux) follow in their supplier's draft, imputed to overhead. Each order line keeps its request
-- line (and so the technician), its imputation, the retained quote's price for its lot and the article's supply type.
-- Shipping and global discounts are distinct lines of a draft, imputed to the order's affaire. Existing orders, their
-- lines and their totals do not change: every new column is null or takes the value an existing row already means.
--
-- 1. purchase_orders.project_id (affaire, same tenant, ON DELETE RESTRICT: an affaire with orders is not deleted) and
--    delivery_mode (site | office | counter, the request's delivery place). delivery_site_id becomes nullable only for
--    an order of an affaire (CHECK); every existing order keeps its site. An order of an affaire is created only by
--    public.create_material_request_purchase_orders (transaction-local marker app.material_request_ordering = the
--    order id, which the Data API cannot set); its affaire and delivery mode never change, nor does the supplier of an
--    order holding request lines (their price is that supplier's quote).
-- 2. purchase_order_items: material_request_line_id (ON DELETE SET NULL, like the estimate source links), project_id,
--    imputation (project | overhead), overhead_category, supply_type_id (the article's, set by the item trigger),
--    line_kind (article | shipping | discount, default article) and price_per (1, 10, 100 or 1 000, default 1).
--    A request line is ordered once among the orders that are not canceled: private.material_request_line_orders
--    holds one row per line so held (primary key), kept by triggers on the items (insert) and on the order's status
--    (canceled removes them, reopening a canceled order puts them back or is refused); its line FK is ON DELETE
--    RESTRICT, so a request whose lines are in an order that stands is not deleted. Request-sourced fields are set
--    once: a draft edit (replace_purchase_order_draft updates lines in place) keeps them, a direct write that changes
--    them is refused, and only the genuine detach of a deleted line or supply type is accepted, even after sending.
--    A request line held by an order that stands does not return to draft, whatever asks it (its reopening, an edit
--    of what it says, the withdrawal of the request's material): MATERIAL_REQUEST_LINE_ORDERED, DETAIL the order's
--    reference (coordinator's decision of 12/11/2026).
-- 3. The amount of a line is quantity x unit price / price_per, rounded half away from zero to the cent (PostgreSQL
--    numeric round). A discount line keeps a unit price >= 0 and carries negative totals (HT, tax, TTC): every reader
--    that sums or prints line totals subtracts it without knowing kinds. For price_per 1 and an article the formula is
--    the previous round(quantity x price): existing totals are unchanged (pgTAP proves it on their shapes). The header
--    totals stay >= 0: the three immediate CHECKs become one deferred constraint trigger, because a draft edit rewrites
--    lines one by one and may pass through a negative sum before reaching a valid one.
-- 4. public.create_material_request_purchase_orders(p_request_id, p_idempotency_key) and
--    public.material_request_order_summary(p_request_id): SECURITY DEFINER, because a line ordered once must be
--    checked against every order of the tenant while the purchase order policies show a member only the orders they
--    created (all of them to an admin), and the receipts and the ledger are private. Both check the rights themselves:
--    the summary for the readers of the request (owner of the affaire, admin, director), the creation for the writers
--    of material requests (owner of the affaire or admin) who may also create orders (admin or engineer).
-- 5. create_purchase_order_draft and replace_purchase_order_draft accept line_kind and price_per; validate_purchase_order_item,
--    normalize_purchase_order_item and get_purchase_order_documents follow. Each is copied from its latest definition
--    (20261011091744, 20261017172127) with only the lines marked « 3a » changed. CREATE OR REPLACE keeps owners and ACLs.
-- Regression: supabase/tests/database/material-request-purchase-orders.test.sql.

begin;
set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.purchase_orders') is null
    or to_regclass('public.purchase_order_items') is null
    or to_regclass('public.material_request_lines') is null
    or to_regclass('public.material_request_quotes') is null
    or to_regclass('public.supply_types') is null
    or to_regclass('public.supplier_catalog_items') is null
    or to_regprocedure('private.normalize_purchase_order_item()') is null
    or to_regprocedure('private.validate_purchase_order_item(jsonb,boolean)') is null
    or to_regprocedure('private.purchase_order_access(uuid,boolean)') is null
    or to_regprocedure('public.create_purchase_order_draft(jsonb,jsonb)') is null
    or to_regprocedure('public.replace_purchase_order_draft(uuid,jsonb,jsonb,bigint)') is null
    or to_regprocedure('public.get_purchase_order_documents(uuid[])') is null
    or to_regprocedure('public.can_access_affaire_intake_project(uuid,uuid)') is null
    or to_regprocedure('public.can_read_affaire_intake_project(uuid,uuid)') is null
    or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'material_request_lines' and column_name = 'price_quote_id'
    )
  then
    raise exception 'TI691_ORDERS_PREREQUISITE_MISSING';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'purchase_orders' and column_name in ('project_id', 'delivery_mode'))
        or (table_name = 'purchase_order_items' and column_name in ('material_request_line_id', 'line_kind', 'price_per')))
  ) or to_regclass('private.material_request_line_orders') is not null then
    raise exception 'TI691_ORDERS_PREFLIGHT: the columns or the ledger already exist';
  end if;
end;
$preflight$;

lock table public.purchase_orders, public.purchase_order_items in share row exclusive mode;

-- ---------------------------------------------------------------------------
-- 1. The affaire and the delivery mode of an order.
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add column project_id uuid references public.estimate_projects(id) on delete restrict,
  add column delivery_mode text,
  alter column delivery_site_id drop not null,
  add constraint purchase_orders_delivery_mode_check
    check (delivery_mode is null or (delivery_mode in ('site', 'office', 'counter') and project_id is not null)),
  add constraint purchase_orders_delivery_site_or_project_check
    check (delivery_site_id is not null or project_id is not null);
create index purchase_orders_project_id_idx on public.purchase_orders (project_id) where project_id is not null;

comment on column public.purchase_orders.project_id is
  'TI-691: the affaire of an order made from a material request (same tenant); its lines are imputed to it, or to overhead. Null for every other order. Set at creation by create_material_request_purchase_orders only; never changes.';
comment on column public.purchase_orders.delivery_mode is
  'TI-691: site, office or counter, copied from the request''s delivery place; null when the request named none, and for every order without an affaire.';

-- ---------------------------------------------------------------------------
-- 2. What an order line says about its origin, its imputation and its price.
-- ---------------------------------------------------------------------------
alter table public.purchase_order_items
  add column material_request_line_id uuid references public.material_request_lines(id) on delete set null,
  add column project_id uuid references public.estimate_projects(id) on delete restrict,
  add column imputation text,
  add column overhead_category text,
  add column supply_type_id uuid references public.supply_types(id) on delete set null,
  add column line_kind text not null default 'article',
  add column price_per integer not null default 1,
  add constraint purchase_order_items_imputation_check
    check (imputation is null or imputation in ('project', 'overhead')),
  add constraint purchase_order_items_overhead_category_check
    check (overhead_category is null or char_length(overhead_category) between 1 and 80),
  add constraint purchase_order_items_line_kind_check
    check (line_kind in ('article', 'shipping', 'discount')),
  add constraint purchase_order_items_price_per_check
    check (price_per in (1, 10, 100, 1000)),
  -- An imputation names an affaire; a category is overhead's; a request line is an article imputed somewhere; shipping
  -- and discounts are no article and, when imputed, are imputed to the affaire.
  add constraint purchase_order_items_imputation_scope_check check (
    (imputation is null or project_id is not null)
    and (overhead_category is null or imputation = 'overhead')
    and (material_request_line_id is null or (line_kind = 'article' and imputation is not null))
    and (line_kind = 'article' or (product_id is null and material_request_line_id is null
      and (imputation is null or imputation = 'project')))
  );
create index purchase_order_items_material_request_line_idx
  on public.purchase_order_items (material_request_line_id) where material_request_line_id is not null;
create index purchase_order_items_project_idx on public.purchase_order_items (project_id) where project_id is not null;
create index purchase_order_items_supply_type_idx on public.purchase_order_items (supply_type_id) where supply_type_id is not null;

comment on column public.purchase_order_items.material_request_line_id is
  'TI-691: the material request line this order line orders (and so its technician). A line is in one order that is not canceled at most (private.material_request_line_orders). Set at creation only; cleared only by the line''s own deletion.';
comment on column public.purchase_order_items.imputation is
  'TI-691: project (the order''s affaire) or overhead, copied from the request line; project for shipping, discounts and other lines of an order of an affaire; null for orders without an affaire. Never changes.';
comment on column public.purchase_order_items.line_kind is
  'TI-691: article, shipping or discount. A discount keeps a unit price >= 0 and carries negative totals: sums subtract it.';
comment on column public.purchase_order_items.price_per is
  'TI-691: how many units unit_price_ht_cents is for (1, 10, 100 or 1000). Line total = quantity x price / price_per, rounded half away from zero to the cent.';
comment on column public.purchase_order_items.supply_type_id is
  'TI-691: the supply type of the line''s article when the line was written or its article changed (set by the item trigger).';

-- The three line CHECKs (>= 0) become one that knows the sign of a discount, and the three header CHECKs a deferred
-- trigger. Found by their definition, whatever their names on a given database; each table must have its three.
do $total_checks$
declare
  constraint_name text;
  dropped integer;
  target record;
begin
  for target in
    select 'public.purchase_order_items'::regclass as relation,
      array['CHECKline_total_ht_cents>=0', 'CHECKline_tax_cents>=0', 'CHECKline_total_ttc_cents>=0'] as definitions
    union all
    select 'public.purchase_orders'::regclass,
      array['CHECKtotal_ht_cents>=0', 'CHECKtotal_tax_cents>=0', 'CHECKtotal_ttc_cents>=0']
  loop
    dropped := 0;
    for constraint_name in
      select c.conname from pg_catalog.pg_constraint c
      where c.conrelid = target.relation and c.contype = 'c'
        and pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid), '[() ]', '', 'g') = any(target.definitions)
    loop
      execute pg_catalog.format('alter table %s drop constraint %I', target.relation, constraint_name);
      dropped := dropped + 1;
    end loop;
    if dropped <> 3 then
      raise exception 'TI691_ORDERS_PREFLIGHT: % has % of its three total checks', target.relation, dropped;
    end if;
  end loop;
end;
$total_checks$;
alter table public.purchase_order_items add constraint purchase_order_items_line_totals_sign_check check (
  case when line_kind = 'discount'
    then line_total_ht_cents <= 0 and line_tax_cents <= 0 and line_total_ttc_cents <= 0
    else line_total_ht_cents >= 0 and line_tax_cents >= 0 and line_total_ttc_cents >= 0
  end
);

-- The totals of an order stay >= 0, checked at commit (or where a function asks for it): an event is queued only when
-- a negative total is written, and the order is read again as it then stands.
create function private.check_purchase_order_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.purchase_orders po
    where po.id = new.id and (po.total_ht_cents < 0 or po.total_tax_cents < 0 or po.total_ttc_cents < 0)
  ) then
    raise exception using errcode = '23514', message = 'PURCHASE_ORDER_TOTAL_NEGATIVE';
  end if;
  return null;
end;
$$;
create constraint trigger purchase_orders_totals_not_negative
  after insert or update on public.purchase_orders
  deferrable initially deferred
  for each row when (new.total_ht_cents < 0 or new.total_tax_cents < 0 or new.total_ttc_cents < 0)
  execute function private.check_purchase_order_totals();

-- ---------------------------------------------------------------------------
-- 3. A request line is ordered once among the orders that are not canceled.
-- ---------------------------------------------------------------------------
create table private.material_request_line_orders (
  line_id uuid primary key references public.material_request_lines(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null unique references public.purchase_order_items(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index material_request_line_orders_order_idx on private.material_request_line_orders (purchase_order_id);
create index material_request_line_orders_tenant_idx on private.material_request_line_orders (tenant_id);
alter table private.material_request_line_orders enable row level security;
revoke all on private.material_request_line_orders from public, anon, authenticated, service_role;

create table private.material_request_order_receipts (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  request_id uuid not null references public.material_requests(id) on delete cascade,
  idempotency_key uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  primary key (tenant_id, request_id, idempotency_key)
);
create index material_request_order_receipts_request_idx on private.material_request_order_receipts (request_id);
alter table private.material_request_order_receipts enable row level security;
revoke all on private.material_request_order_receipts from public, anon, authenticated, service_role;

create function private.track_material_request_line_order()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.purchase_orders po where po.id = new.purchase_order_id and po.status <> 'canceled') then
    insert into private.material_request_line_orders (line_id, tenant_id, purchase_order_id, item_id)
    values (new.material_request_line_id, new.tenant_id, new.purchase_order_id, new.id);
  end if;
  return null;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'MATERIAL_REQUEST_LINE_ALREADY_ORDERED';
end;
$$;
create trigger track_material_request_line_order
  after insert on public.purchase_order_items
  for each row when (new.material_request_line_id is not null)
  execute function private.track_material_request_line_order();

-- Canceling an order frees its lines; reopening a canceled order takes them back, or is refused when one of them was
-- ordered again meanwhile, or no longer says what was ordered: reopened to draft, or validated again with another
-- article, quantity, unit, imputation or category, or priced or supplied otherwise
-- (MATERIAL_REQUEST_ORDER_LINES_CHANGED, DETAIL: the positions in the request, as a JSON array). Such a line is
-- ordered again from its request instead.
create function private.track_material_request_order_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  changed integer[];
begin
  if new.status = 'canceled' and old.status <> 'canceled' then
    delete from private.material_request_line_orders where purchase_order_id = new.id;
  elsif old.status = 'canceled' and new.status <> 'canceled' then
    select pg_catalog.array_agg(line.position order by line.position) into changed
    from public.purchase_order_items oi
    join public.material_request_lines line on line.id = oi.material_request_line_id
    where oi.purchase_order_id = new.id
      and (line.status <> 'validated'
        or line.supplier_id is distinct from new.supplier_id
        -- As the creation wrote them: the unit trimmed, the category of an overhead line only.
        or (line.product_id, line.quantity, nullif(pg_catalog.btrim(line.unit), ''), line.unit_price_ht_cents,
            line.price_per, line.imputation, case when line.imputation = 'overhead' then line.overhead_category end)
          is distinct from (oi.product_id, oi.quantity, oi.unit, oi.unit_price_ht_cents, oi.price_per, oi.imputation,
            oi.overhead_category));
    if changed is not null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_ORDER_LINES_CHANGED',
        detail = pg_catalog.array_to_json(changed)::text;
    end if;
    insert into private.material_request_line_orders (line_id, tenant_id, purchase_order_id, item_id)
    select oi.material_request_line_id, oi.tenant_id, oi.purchase_order_id, oi.id
    from public.purchase_order_items oi
    where oi.purchase_order_id = new.id and oi.material_request_line_id is not null;
  end if;
  return null;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'MATERIAL_REQUEST_LINE_ALREADY_ORDERED';
end;
$$;
create trigger track_material_request_order_status
  after update of status on public.purchase_orders
  for each row when (old.status is distinct from new.status)
  execute function private.track_material_request_order_status();

-- A line an order that stands holds was ordered as validated: it does not return to draft. Named to run after
-- enforce_material_request_line_write, whose backstop returns an edited validated line to draft.
create function private.guard_ordered_material_request_line()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  reference_value text;
begin
  if old.status = 'validated' and new.status is distinct from 'validated' then
    select po.reference into reference_value
    from private.material_request_line_orders held
    join public.purchase_orders po on po.id = held.purchase_order_id
    where held.line_id = old.id;
    if found then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_ORDERED', detail = reference_value;
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_ordered_material_request_line
  before update on public.material_request_lines
  for each row execute function private.guard_ordered_material_request_line();

-- An order of an affaire comes from create_material_request_purchase_orders only (the marker names the order), with an
-- affaire of its tenant; affaire and delivery mode never change, nor does the supplier of an order holding request
-- lines. Named to run after set_purchase_orders_tenant_id and before zz_revise_purchase_order_header.
create function private.guard_purchase_order_affaire()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.project_id is not null then
      if pg_catalog.current_setting('app.material_request_ordering', true) is distinct from new.id::text then
        raise exception using errcode = '42501', message = 'PURCHASE_ORDER_AFFAIRE_THROUGH_REQUEST';
      end if;
      if not exists (
        select 1 from public.estimate_projects project where project.id = new.project_id and project.tenant_id = new.tenant_id
      ) then
        raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
      end if;
    end if;
    return new;
  end if;
  if new.project_id is distinct from old.project_id or new.delivery_mode is distinct from old.delivery_mode then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if new.supplier_id is distinct from old.supplier_id and exists (
    select 1 from public.purchase_order_items oi where oi.purchase_order_id = old.id and oi.material_request_line_id is not null
  ) then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_REQUEST_SUPPLIER_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger zy_guard_purchase_order_affaire
  before insert or update on public.purchase_orders
  for each row execute function private.guard_purchase_order_affaire();

-- ---------------------------------------------------------------------------
-- 4. Lines: validation of the payload, normalization and money.
-- ---------------------------------------------------------------------------
create or replace function private.validate_purchase_order_item(p_item jsonb,p_existing boolean)
returns void language plpgsql set search_path='' as $$
declare quantity_value numeric; cost numeric; tax numeric;
begin
  if jsonb_typeof(p_item) is distinct from 'object'
    -- 3a: line_kind and price_per.
    or p_item-array['id','product_id','reference','designation','quantity','unit','unit_price_ht_cents','tax_rate_bp','line_kind','price_per']<>'{}'::jsonb
    or jsonb_typeof(p_item->'designation') is distinct from 'string' or nullif(btrim(p_item->>'designation'),'') is null
    or (p_item ? 'reference' and jsonb_typeof(p_item->'reference') not in ('string','null'))
    or (p_item ? 'unit' and jsonb_typeof(p_item->'unit') not in ('string','null'))
    or (p_item ? 'product_id' and jsonb_typeof(p_item->'product_id') not in ('string','null'))
    or (p_item ? 'id' and jsonb_typeof(p_item->'id') not in ('string','null'))
    -- 3a: a kind is one of three; shipping and discounts are no article; a price is for 1, 10, 100 or 1 000 units.
    or (p_item ? 'line_kind' and (jsonb_typeof(p_item->'line_kind') is distinct from 'string'
      or p_item->>'line_kind' not in ('article','shipping','discount')))
    or (coalesce(p_item->>'line_kind','article')<>'article' and p_item->>'product_id' is not null)
    or (p_item ? 'price_per' and (jsonb_typeof(p_item->'price_per') is distinct from 'number'
      or p_item->>'price_per' not in ('1','10','100','1000'))) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if jsonb_typeof(p_item->'quantity') is distinct from 'number' then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  quantity_value:=(p_item->>'quantity')::numeric;
  if quantity_value<=0 or quantity_value>2147483647 or quantity_value<>trunc(quantity_value,3) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_QUANTITY_INVALID';
  end if;
  if jsonb_typeof(p_item->'unit_price_ht_cents') is distinct from 'number'
    or jsonb_typeof(p_item->'tax_rate_bp') is distinct from 'number' then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  cost:=(p_item->>'unit_price_ht_cents')::numeric; tax:=(p_item->>'tax_rate_bp')::numeric;
  if cost not between 0 and 2147483647 or cost<>trunc(cost) or tax not between 0 and 10000 or tax<>trunc(tax) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if not p_existing and nullif(btrim(p_item->>'unit'),'') is null then
    raise exception using errcode='22023',message='PURCHASE_ORDER_UNIT_REQUIRED';
  end if;
  perform (p_item->>'id')::uuid,(p_item->>'product_id')::uuid;
exception when invalid_text_representation then
  raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
end;
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
  -- 3a: shipping and discounts are no article.
  if new.line_kind<>'article' and new.product_id is not null then
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
-- 5. The manual creation and the draft edit accept the kind and the lot of a line.
-- ---------------------------------------------------------------------------
create or replace function public.create_purchase_order_draft(p_header jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.purchase_order_access(null,true); po public.purchase_orders%rowtype; item jsonb; ordinal bigint;
begin
  -- 3a: the totals of the order are checked once its lines are written.
  set constraints public.purchase_orders_totals_not_negative deferred;
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=auth.uid() for share;
  perform private.purchase_order_access(null,true);
  perform private.validate_purchase_order_header(p_header,tenant_value,true);
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
    raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    perform private.validate_purchase_order_item(item,false);
    if item->>'id' is not null then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
    if item->>'product_id' is not null then
      perform 1 from public.products where id=(item->>'product_id')::uuid and tenant_id=tenant_value for share nowait;
      if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
    end if;
  end loop;
  insert into public.purchase_orders(tenant_id,user_id,reference,supplier_id,delivery_site_id,status,expected_delivery_date,notes,currency)
    values(tenant_value,auth.uid(),'TEMP-'||gen_random_uuid(),(p_header->>'supplier_id')::uuid,(p_header->>'delivery_site_id')::uuid,
      'draft',p_header->>'expected_delivery_date',nullif(btrim(p_header->>'notes'),''),'EUR') returning * into po;
  update public.purchase_orders set reference='C-'||to_char(po.order_date,'YYMM')||'-'||lpad(po.order_number::text,greatest(3,length(po.order_number::text)),'0') where id=po.id;
  for item,ordinal in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
    -- 3a: line_kind and price_per.
    insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,quantity,unit,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_kind,price_per)
      values(tenant_value,po.id,ordinal,(item->>'product_id')::uuid,item->>'reference',btrim(item->>'designation'),(item->>'quantity')::numeric,
        item->>'unit',(item->>'unit_price_ht_cents')::integer,(item->>'tax_rate_bp')::integer,0,0,0,
        coalesce(item->>'line_kind','article'),coalesce((item->>'price_per')::integer,1));
  end loop;
  set constraints public.purchase_orders_totals_not_negative immediate;
  select * into po from public.purchase_orders where id=po.id;
  return jsonb_build_object('id',po.id,'reference',po.reference,'edit_revision',po.edit_revision);
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

create or replace function public.replace_purchase_order_draft(p_order_id uuid,p_header_patch jsonb,p_items jsonb,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare tenant_value uuid:=private.purchase_order_access(p_order_id,true); po public.purchase_orders%rowtype;
  item jsonb; ordinal bigint; ids uuid[];
begin
  -- 3a: lines are rewritten one by one, so the totals may pass through a negative sum (a discount kept while a line
  -- goes): they are checked once every line is written.
  set constraints public.purchase_orders_totals_not_negative deferred;
  select * into po from public.purchase_orders where id=p_order_id and tenant_id=tenant_value for update;
  perform 1 from public.tenants where id=tenant_value for share;
  perform 1 from public.tenant_memberships where tenant_id=tenant_value and user_id=auth.uid() for share;
  perform private.purchase_order_access(p_order_id,true);
  if po.status<>'draft' then raise exception using errcode='42501',message='PURCHASE_ORDER_DRAFT_NOT_EDITABLE'; end if;
  if p_expected_revision is null then raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_REQUIRED'; end if;
  if p_expected_revision<>po.edit_revision or p_expected_revision not between 0 and 9007199254740991 then
    raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
  end if;
  perform private.validate_purchase_order_header(p_header_patch,tenant_value,false);
  perform 1 from public.purchase_order_items where purchase_order_id=p_order_id order by id for update nowait;
  if p_items is not null then
    if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 1000 then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
    for item in select value from jsonb_array_elements(p_items) loop
      perform private.validate_purchase_order_item(item,item->>'id' is not null);
      if item->>'id' is not null and not exists(select 1 from public.purchase_order_items where id=(item->>'id')::uuid and purchase_order_id=p_order_id and tenant_id=tenant_value) then
        raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
      end if;
      -- 3a: the kind of a line never changes.
      if item->>'id' is not null and item ? 'line_kind' and exists(select 1 from public.purchase_order_items
        where id=(item->>'id')::uuid and purchase_order_id=p_order_id and line_kind<>item->>'line_kind') then
        raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
      end if;
      if item->>'product_id' is not null then
        perform 1 from public.products where id=(item->>'product_id')::uuid and tenant_id=tenant_value for share nowait;
        if not found then raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID'; end if;
      end if;
    end loop;
    select coalesce(array_agg((value->>'id')::uuid) filter(where value->>'id' is not null),'{}'::uuid[]) into ids from jsonb_array_elements(p_items);
    if cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then
      raise exception using errcode='22023',message='PURCHASE_ORDER_ITEMS_INVALID';
    end if;
  end if;
  update public.purchase_orders set
    supplier_id=case when p_header_patch ? 'supplier_id' then (p_header_patch->>'supplier_id')::uuid else supplier_id end,
    delivery_site_id=case when p_header_patch ? 'delivery_site_id' then (p_header_patch->>'delivery_site_id')::uuid else delivery_site_id end,
    expected_delivery_date=case when p_header_patch ? 'expected_delivery_date' then p_header_patch->>'expected_delivery_date' else expected_delivery_date end,
    notes=case when p_header_patch ? 'notes' then nullif(btrim(p_header_patch->>'notes'),'') else notes end where id=p_order_id;
  if p_items is not null then
    set constraints public.purchase_order_items_position_unique deferred;
    delete from public.purchase_order_items where purchase_order_id=p_order_id and not id=any(ids);
    for item,ordinal in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
      if item->>'id' is not null then
        -- 3a: price_per when given; the request line, affaire, imputation and kind are not written: they stay.
        update public.purchase_order_items set position=ordinal,
          product_id=case when item ? 'product_id' then (item->>'product_id')::uuid else product_id end,
          reference=case when item ? 'reference' then item->>'reference' else reference end,
          designation=btrim(item->>'designation'),quantity=(item->>'quantity')::numeric,
          unit=case when item ? 'unit' then item->>'unit' else unit end,
          unit_price_ht_cents=(item->>'unit_price_ht_cents')::integer,tax_rate_bp=(item->>'tax_rate_bp')::integer,
          price_per=case when item ? 'price_per' then (item->>'price_per')::integer else price_per end
          where id=(item->>'id')::uuid and purchase_order_id=p_order_id;
      else
        -- 3a: line_kind and price_per.
        insert into public.purchase_order_items(tenant_id,purchase_order_id,position,product_id,reference,designation,quantity,unit,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,line_kind,price_per)
          values(tenant_value,p_order_id,ordinal,(item->>'product_id')::uuid,item->>'reference',btrim(item->>'designation'),(item->>'quantity')::numeric,
            item->>'unit',(item->>'unit_price_ht_cents')::integer,(item->>'tax_rate_bp')::integer,0,0,0,
            coalesce(item->>'line_kind','article'),coalesce((item->>'price_per')::integer,1));
      end if;
    end loop;
    set constraints public.purchase_order_items_position_unique immediate;
  end if;
  set constraints public.purchase_orders_totals_not_negative immediate;
  select * into po from public.purchase_orders where id=p_order_id;
  return jsonb_build_object('id',po.id,'edit_revision',po.edit_revision);
exception when lock_not_available then
  raise exception using errcode='40001',message='PURCHASE_ORDER_REVISION_CONFLICT';
end;
$$;

-- A single STABLE invocation reads headers and every line from one MVCC
-- snapshot. Its JSON aggregate is not truncated by PostgREST's row limit.
-- SECURITY INVOKER deliberately retains the existing SELECT RLS policies.
create or replace function public.get_purchase_order_documents(p_order_ids uuid[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tenant_value uuid:=public.current_tenant_id(); accessible integer; item_count bigint;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='PURCHASE_ORDER_AUTH_REQUIRED'; end if;
  if p_order_ids is null or cardinality(p_order_ids) not between 1 and 1000
    or exists(select 1 from unnest(p_order_ids) id where id is null)
    or cardinality(p_order_ids)<>(select count(distinct id) from unnest(p_order_ids) id) then
    raise exception using errcode='22023',message='PURCHASE_ORDER_INPUT_INVALID';
  end if;
  if not exists(select 1 from public.tenant_memberships tm join public.tenants t on t.id=tm.tenant_id
    where tm.tenant_id=tenant_value and tm.user_id=auth.uid() and t.is_active) then
    raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED';
  end if;
  select count(*) into accessible from public.purchase_orders where id=any(p_order_ids) and tenant_id=tenant_value;
  if accessible<>cardinality(p_order_ids) then raise exception using errcode='42501',message='PURCHASE_ORDER_ACCESS_DENIED'; end if;
  select count(*) into item_count from public.purchase_order_items where purchase_order_id=any(p_order_ids) and tenant_id=tenant_value;
  if item_count>10000 then raise exception using errcode='22023',message='PURCHASE_ORDER_EXPORT_TOO_LARGE'; end if;
  return jsonb_build_object('orders',(select jsonb_agg(jsonb_build_object(
    'id',po.id,'reference',po.reference,'created_at',po.created_at,'status',po.status,
    'expected_delivery_date',po.expected_delivery_date,'total_ht_cents',po.total_ht_cents,
    'total_tax_cents',po.total_tax_cents,'total_ttc_cents',po.total_ttc_cents,'edit_revision',po.edit_revision,
    'suppliers',case when s.id is not null then jsonb_build_object('id',s.id,'name',s.name) end,
    'delivery_sites',case when ds.id is not null then jsonb_build_object('id',ds.id,'name',ds.name) end,
    -- 3a: the affaire (its name null when the caller cannot read it) and the delivery mode.
    'project_id',po.project_id,
    'project',case when ep.id is not null then jsonb_build_object('id',ep.id,'name',ep.name) end,
    'delivery_mode',po.delivery_mode,
    -- 3a: each line with the name of its supply type and the request of its request line, as the caller reads them.
    'items',(select coalesce(jsonb_agg(to_jsonb(oi)||jsonb_build_object('supply_type_name',st.name,'material_request_id',mrl.request_id)
        order by oi.position,oi.id),'[]'::jsonb)
      from public.purchase_order_items oi
      left join public.supply_types st on st.id=oi.supply_type_id and st.tenant_id=oi.tenant_id
      left join public.material_request_lines mrl on mrl.id=oi.material_request_line_id and mrl.tenant_id=oi.tenant_id
      where oi.purchase_order_id=po.id and oi.tenant_id=tenant_value)
    ) order by array_position(p_order_ids,po.id))
    from public.purchase_orders po left join public.suppliers s on s.id=po.supplier_id and s.tenant_id=po.tenant_id
    left join public.delivery_sites ds on ds.id=po.delivery_site_id and ds.tenant_id=po.tenant_id
    left join public.estimate_projects ep on ep.id=po.project_id and ep.tenant_id=po.tenant_id
    where po.id=any(p_order_ids) and po.tenant_id=tenant_value));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Orders from a material request.
-- ---------------------------------------------------------------------------
-- What a request line says to a supplier, as the consultation message writes it (fullDesignation in
-- src/lib/material-requests/consultation-message.ts): its type words (else the technician's words), then its size,
-- material and precision when the name does not already say them (case, accents and spacing aside).
create function private.material_request_line_designation(
  p_type text, p_original text, p_dimension text, p_material text, p_precision text
)
returns text language plpgsql immutable parallel safe set search_path = '' as $$
declare
  head text := coalesce(
    nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_type, '\s+', ' ', 'g')), ''),
    nullif(pg_catalog.btrim(pg_catalog.regexp_replace(p_original, '\s+', ' ', 'g')), ''),
    'Sans désignation');
  said text;
  part text;
  result text;
begin
  said := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.regexp_replace(
    normalize(head, NFD), U&'[\0300-\036F]', '', 'g')), '\s+', ' ', 'g'));
  result := head;
  foreach part in array array[p_dimension, p_material, p_precision] loop
    part := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(part, '\s+', ' ', 'g')), '');
    if part is not null and pg_catalog.strpos(said, pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.lower(
        pg_catalog.regexp_replace(normalize(part, NFD), U&'[\0300-\036F]', '', 'g')), '\s+', ' ', 'g'))) = 0 then
      result := result || ', ' || part;
    end if;
  end loop;
  return result;
end;
$$;

-- Where each line of a request stands for ordering: ordered (in an order that is not canceled), else the first thing
-- it lacks (validation, supplier, retained quote), else ready.
create function private.material_request_order_lines(p_tenant_id uuid, p_request_id uuid)
returns table (line_id uuid, line_position integer, state text, purchase_order_id uuid)
language sql stable set search_path = '' as $$
  select line.id, line.position,
    case
      when held.line_id is not null then 'ordered'
      when line.status <> 'validated' then 'not_validated'
      when line.supplier_id is null then 'no_supplier'
      when line.price_quote_id is null or line.unit_price_ht_cents is null then 'not_priced'
      else 'ready'
    end,
    held.purchase_order_id
  from public.material_request_lines line
  left join private.material_request_line_orders held on held.line_id = line.id
  where line.tenant_id = p_tenant_id and line.request_id = p_request_id;
$$;

create function public.material_request_order_summary(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  tenant_value uuid := public.current_tenant_id();
  request_row record;
  caller uuid := (select auth.uid());
  caller_is_admin boolean;
begin
  if (select auth.uid()) is null or tenant_value is null then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_ORDER_ACCESS_DENIED';
  end if;
  select request.id, request.project_id into request_row
  from public.material_requests request where request.id = p_request_id and request.tenant_id = tenant_value;
  if not found then
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_ORDER_NOT_FOUND';
  end if;
  if not public.can_read_affaire_intake_project(request_row.project_id, tenant_value) then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_ORDER_ACCESS_DENIED';
  end if;
  -- An order is read by its author and the admins (its RLS): can_open tells the screen whether to link it.
  caller_is_admin := coalesce(public.has_tenant_role(tenant_value, array['admin'::public.tenant_role]), false);
  return (
    with states as (select * from private.material_request_order_lines(tenant_value, p_request_id))
    select jsonb_build_object(
      'ready_line_ids', coalesce((
        select jsonb_agg(s.line_id order by s.line_position, s.line_id) from states s where s.state = 'ready'), '[]'::jsonb),
      'not_ready', coalesce((
        select jsonb_agg(jsonb_build_object('line_id', s.line_id, 'reason', s.state) order by s.line_position, s.line_id)
        from states s where s.state in ('not_validated', 'no_supplier', 'not_priced')), '[]'::jsonb),
      'ordered', coalesce((
        select jsonb_agg(jsonb_build_object('line_id', s.line_id, 'purchase_order_id', po.id,
          'purchase_order_reference', po.reference, 'status', po.status,
          'can_open', caller_is_admin or po.user_id = caller) order by s.line_position, s.line_id)
        from states s join public.purchase_orders po on po.id = s.purchase_order_id
        where s.state = 'ordered'), '[]'::jsonb),
      'orders', coalesce((
        select jsonb_agg(jsonb_build_object('id', o.id, 'reference', o.reference, 'supplier_name', o.supplier_name,
          'status', o.status, 'total_ht_cents', o.total_ht_cents, 'line_count', o.line_count,
          'can_open', caller_is_admin or o.user_id = caller)
          order by o.created_at, o.order_number)
        from (
          select po.id, po.reference, coalesce(supplier.name, '') as supplier_name, po.status, po.total_ht_cents,
            po.created_at, po.order_number, po.user_id, count(*)::integer as line_count
          from public.purchase_order_items oi
          join public.material_request_lines line on line.id = oi.material_request_line_id
          join public.purchase_orders po on po.id = oi.purchase_order_id and po.tenant_id = tenant_value
          left join public.suppliers supplier on supplier.id = po.supplier_id
          where line.request_id = p_request_id and line.tenant_id = tenant_value and oi.tenant_id = tenant_value
          group by po.id, supplier.name
        ) o), '[]'::jsonb),
      -- The caller may create orders here: a writer of the request who may buy.
      'can_create', public.can_access_affaire_intake_project(request_row.project_id, tenant_value)
        and public.has_tenant_role(tenant_value, array['admin'::public.tenant_role, 'engineer'::public.tenant_role])
    )
  );
end;
$$;

comment on function public.material_request_order_summary(uuid) is
  'TI-691: where each line of a material request stands for ordering (ready; not ready and why; ordered, in which order), the orders holding its lines (canceled included: reference, supplier, status, total HT, lines of the request, and whether the caller may open it: its author or an admin, can_open, also on each ordered line) and whether the caller may create orders (can_create). For the readers of the request (owner of the affaire, admin, director): MATERIAL_REQUEST_ORDER_NOT_FOUND, _ACCESS_DENIED. Security definer: an order is otherwise visible to its author and the admins only.';

create function public.create_material_request_purchase_orders(p_request_id uuid, p_idempotency_key uuid)
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
  select request.id, request.project_id, request.requested_on, request.delivery_place, request.presumed_material,
      request.material_confirmed, technician.name as technician_name
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
    insert into public.purchase_orders (id, tenant_id, user_id, reference, supplier_id, delivery_site_id, project_id,
        delivery_mode, status, notes, currency)
    values (order_id, tenant_value, actor, 'TEMP-' || gen_random_uuid()::text, group_row.supplier_id, null,
        request_row.project_id, request_row.delivery_place, 'draft', notes_value, 'EUR')
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
  'TI-691: one draft purchase order per supplier from the ready lines of a material request (validated, priced by a retained quote, in no order that is not canceled), all of the request''s affaire, its overhead lines included (imputation overhead); no delivery site, the request''s delivery place as delivery mode, notes naming the request. Each line: article, reference at the supplier (else the article''s), catalogue wording, quantity, unit, quote price and lot, 20 % tax, imputation, request line. Idempotent per request and key (replayed: true, each order with its current status). Caller: admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED) who writes the request (MATERIAL_REQUEST_ORDER_WRITERS_ONLY). Refusals: MATERIAL_REQUEST_ORDER_NOT_FOUND, _NOTHING_READY, _SUPPLIER_INACTIVE (DETAIL: JSON names), _KEY_TAKEN, MATERIAL_REQUEST_LINE_ALREADY_ORDERED.';

revoke all on function private.check_purchase_order_totals(), private.track_material_request_line_order(),
  private.track_material_request_order_status(), private.guard_purchase_order_affaire(),
  private.guard_ordered_material_request_line(),
  private.material_request_line_designation(text, text, text, text, text), private.material_request_order_lines(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.material_request_order_summary(uuid), public.create_material_request_purchase_orders(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.material_request_order_summary(uuid), public.create_material_request_purchase_orders(uuid, uuid)
  to authenticated;


-- ---------------------------------------------------------------------------
-- An affaire with purchase orders is not deleted (purchase_orders.project_id is ON DELETE RESTRICT): the deletion of
-- draft affaires says so, and the test-data purge never takes such an affaire, instead of failing on it every week.
-- ---------------------------------------------------------------------------
create or replace function public.bulk_delete_draft_affaires(
  p_tenant_id uuid,
  p_project_ids uuid[]
)
returns table (
  project_id uuid,
  outcome text,
  message text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_project_id uuid;
  locked_project_id uuid;
  locked_is_archived boolean;
  delete_succeeded boolean;
  blocking_constraint text;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_tenant_id is null
    or p_project_ids is null
    or cardinality(p_project_ids) < 1
    or cardinality(p_project_ids) > 100
    or array_position(p_project_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'INVALID_BULK_DELETE_INPUT';
  end if;

  if not coalesce(
    (select public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    )),
    false
  ) then
    raise exception using errcode = '42501', message = 'ESTIMATE_WRITE_ROLE_REQUIRED';
  end if;

  foreach target_project_id in array p_project_ids
  loop
    locked_project_id := null;
    locked_is_archived := null;
    delete_succeeded := false;

    begin
      select p.id, p.is_archived
        into locked_project_id, locked_is_archived
      from public.estimate_projects p
      where p.id = target_project_id
        and p.tenant_id = p_tenant_id
      for update;

      if locked_project_id is null then
        project_id := target_project_id;
        outcome := 'not_found';
        message := 'Affaire introuvable ou non autorisee.';
        return next;
        continue;
      end if;

      if locked_is_archived
        or exists (
          select 1
          from public.estimate_versions v
          where v.project_id = locked_project_id
            and v.tenant_id = p_tenant_id
            and v.status <> 'draft'
        )
      then
        project_id := target_project_id;
        outcome := 'not_eligible';
        message := 'Seules les affaires dont toutes les versions sont en brouillon peuvent etre supprimees.';
        return next;
        continue;
      end if;

      perform set_config('app.bulk_delete_draft_affaires', 'on', true);
      delete from public.estimate_projects p
      where p.id = locked_project_id
        and p.tenant_id = p_tenant_id;
      delete_succeeded := found;
      perform set_config('app.bulk_delete_draft_affaires', 'off', true);

      if delete_succeeded then
        project_id := target_project_id;
        outcome := 'deleted';
        message := null;
      else
        project_id := target_project_id;
        outcome := 'failed';
        message := 'Impossible de supprimer cette affaire.';
      end if;
      return next;
    exception
      when foreign_key_violation then
        -- An order holds the affaire (canceled ones included), or a request line of it: the orders are kept, so the
        -- affaire is not deleted. Read from the constraint, as the caller may not see every order.
        perform set_config('app.bulk_delete_draft_affaires', 'off', true);
        get stacked diagnostics blocking_constraint = constraint_name;
        project_id := target_project_id;
        if blocking_constraint in (
          'purchase_orders_project_id_fkey',
          'purchase_order_items_project_id_fkey',
          'material_request_line_orders_line_id_fkey'
        ) then
          outcome := 'not_eligible';
          message := 'Cette affaire a des bons de commande : elle ne peut pas être supprimée.';
        else
          raise warning 'bulk_delete_draft_affaires failed for project %: [%] %',
            target_project_id,
            sqlstate,
            sqlerrm;
          outcome := 'failed';
          message := 'Impossible de supprimer cette affaire.';
        end if;
        return next;
      when others then
        perform set_config('app.bulk_delete_draft_affaires', 'off', true);
        raise warning 'bulk_delete_draft_affaires failed for project %: [%] %',
          target_project_id,
          sqlstate,
          sqlerrm;
        project_id := target_project_id;
        outcome := 'failed';
        message := 'Impossible de supprimer cette affaire.';
        return next;
    end;
  end loop;
end;
$$;

create or replace function private.test_data_project_is_stale(p_project_id uuid, p_retention_days integer)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.estimate_projects as p
    where p.id = p_project_id
      and greatest(p.created_at, p.updated_at)
        < statement_timestamp() - make_interval(days => p_retention_days)
      and not exists (
        select 1
        from public.estimate_versions as v
        where v.project_id = p.id
          and (
            v.status <> 'draft'
            or v.updated_at >= statement_timestamp() - make_interval(days => p_retention_days)
          )
      )
      and not exists (select 1 from public.purchase_orders as o where o.project_id = p.id)
      and not exists (select 1 from public.purchase_order_items as i where i.project_id = p.id)
  )
$$;

commit;
