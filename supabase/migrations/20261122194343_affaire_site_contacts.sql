-- TI-691, lot 2 « l'achat »: the site contacts of an affaire, printed on its purchase orders. No remote application is
-- authorized here.
--
-- The owner's decision of 22/11/2026: the people to call on site are entered on the affaire (several, each usually with
-- one number), and the purchase orders made from its material requests carry them in « Instructions complémentaires »,
-- in place of « Demande de matériel du … (technicien) » (each order line already names its request). The requesting
-- technician is often the one delivered, but is not added on that assumption.
--
-- 1. public.estimate_projects.site_contacts: a JSON array of at most 20 contacts { name, role?, phone? }, in the order
--    the office gives them; '[]' for every existing affaire (no rewrite: a constant default). Written like the rest of
--    the affaire's fiche (its RLS unchanged); private.normalize_affaire_site_contacts() trims every text, drops an empty
--    role or phone and refuses any other shape (AFFAIRE_SITE_CONTACTS_INVALID): a name of 1 to 120 characters, a role
--    of at most 80, a phone of at most 40, no other key.
-- 2. private.affaire_site_contacts_text(jsonb): the line written in the instructions, « Contact sur site : Nom (rôle) :
--    téléphone », or « Contacts sur site : … ; … »; null without contact.
-- 3. public.create_material_request_purchase_orders is copied from its latest definition (20261122175145) with only
--    the lines marked « contacts » changed: a new draft's notes are that line. Drafts already made keep their notes; the
--    instructions of a draft stay editable. CREATE OR REPLACE keeps owners and ACLs.
-- Regression: supabase/tests/database/affaire-site-contacts.test.sql.

begin;
set local lock_timeout = '10s';

do $preflight$
begin
  if to_regclass('public.estimate_projects') is null
    or to_regprocedure('public.create_material_request_purchase_orders(uuid, uuid)') is null
    or to_regclass('private.material_request_quote_charge_orders') is null
  then
    raise exception 'TI691_SITE_CONTACTS_PREREQUISITE_MISSING';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'estimate_projects' and column_name = 'site_contacts'
  ) then
    raise exception 'TI691_SITE_CONTACTS_PREFLIGHT: the column already exists';
  end if;
end;
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. The site contacts of an affaire.
-- ---------------------------------------------------------------------------
alter table public.estimate_projects
  add column site_contacts jsonb not null default '[]'::jsonb,
  add constraint estimate_projects_site_contacts_shape_check
    check (pg_catalog.jsonb_typeof(site_contacts) = 'array' and pg_catalog.jsonb_array_length(site_contacts) <= 20);

comment on column public.estimate_projects.site_contacts is
  'TI-691: the people to call on site, in order: [{ name, role?, phone? }], at most 20; trimmed and checked by private.normalize_affaire_site_contacts. Printed in the instructions of the purchase orders made from the affaire''s material requests.';

create function private.normalize_affaire_site_contacts()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  contact jsonb;
  normalized jsonb := '[]'::jsonb;
  name_value text;
  role_value text;
  phone_value text;
begin
  if pg_catalog.jsonb_typeof(new.site_contacts) is distinct from 'array'
    or pg_catalog.jsonb_array_length(new.site_contacts) > 20 then
    raise exception using errcode = '22023', message = 'AFFAIRE_SITE_CONTACTS_INVALID';
  end if;
  for contact in select value from pg_catalog.jsonb_array_elements(new.site_contacts) loop
    if pg_catalog.jsonb_typeof(contact) is distinct from 'object'
      or exists (select 1 from pg_catalog.jsonb_object_keys(contact) as k(key) where k.key not in ('name', 'role', 'phone'))
      or pg_catalog.jsonb_typeof(contact -> 'name') is distinct from 'string'
      or coalesce(pg_catalog.jsonb_typeof(contact -> 'role'), 'null') not in ('string', 'null')
      or coalesce(pg_catalog.jsonb_typeof(contact -> 'phone'), 'null') not in ('string', 'null') then
      raise exception using errcode = '22023', message = 'AFFAIRE_SITE_CONTACTS_INVALID';
    end if;
    name_value := pg_catalog.btrim(contact ->> 'name');
    role_value := nullif(pg_catalog.btrim(contact ->> 'role'), '');
    phone_value := nullif(pg_catalog.btrim(contact ->> 'phone'), '');
    if pg_catalog.char_length(name_value) not between 1 and 120
      or pg_catalog.char_length(role_value) > 80
      or pg_catalog.char_length(phone_value) > 40 then
      raise exception using errcode = '22023', message = 'AFFAIRE_SITE_CONTACTS_INVALID';
    end if;
    normalized := normalized || pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(
      pg_catalog.jsonb_build_object('name', name_value, 'role', role_value, 'phone', phone_value)));
  end loop;
  new.site_contacts := normalized;
  return new;
end;
$$;
revoke all on function private.normalize_affaire_site_contacts() from public, anon, authenticated;
create trigger normalize_affaire_site_contacts
  before insert or update of site_contacts on public.estimate_projects
  for each row execute function private.normalize_affaire_site_contacts();

-- ---------------------------------------------------------------------------
-- 2. The line the purchase orders print.
-- ---------------------------------------------------------------------------
create function private.affaire_site_contacts_text(p_contacts jsonb)
returns text language sql immutable set search_path = '' as $$
  select case when pg_catalog.jsonb_array_length(p_contacts) = 0 then null
    else (case when pg_catalog.jsonb_array_length(p_contacts) = 1 then 'Contact sur site : ' else 'Contacts sur site : ' end)
      || (select pg_catalog.string_agg(
            (c.contact ->> 'name') || coalesce(' (' || (c.contact ->> 'role') || ')', '')
              || coalesce(' : ' || (c.contact ->> 'phone'), ''),
            ' ; ' order by c.ordinal)
          from pg_catalog.jsonb_array_elements(p_contacts) with ordinality as c(contact, ordinal))
  end;
$$;
revoke all on function private.affaire_site_contacts_text(jsonb) from public, anon, authenticated;

comment on function private.affaire_site_contacts_text(jsonb) is
  'TI-691: « Contact sur site : Nom (rôle) : téléphone », or « Contacts sur site : … ; … » in the order given; null without contact.';

-- ---------------------------------------------------------------------------
-- 3. A new draft carries them in its instructions.
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
  contacts_value jsonb;
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

  -- contacts: the affaire's site contacts, for the supplier who delivers, in place of the request's date and technician
  -- (each order line already names its request); none, no instructions.
  select project.site_contacts into contacts_value
  from public.estimate_projects project where project.id = request_row.project_id and project.tenant_id = tenant_value;
  notes_value := private.affaire_site_contacts_text(coalesce(contacts_value, '[]'::jsonb));
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
  'TI-691: one draft purchase order per supplier from the ready lines of a material request (validated, priced by a retained quote, in no order that is not canceled), all of the request''s affaire, its overhead lines included (imputation overhead); no delivery site, the request''s delivery place as delivery mode, delivered on the date the request needs its material, instructions naming the affaire''s site contacts (none: no instructions). Each line: article, reference at the supplier (else the article''s), catalogue wording, quantity, unit, quote price and lot, 20 % tax, imputation, request line; then the shipping (« Port ») and the discount (« Remise ») of each retained quote that priced a line of the draft and that the draft completes, a lump sum at 20 % linked to its quote (material_request_quote_id), each once among the orders that are not canceled. Idempotent per request and key (replayed: true, each order with its current status). Caller: admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED) who writes the request (MATERIAL_REQUEST_ORDER_WRITERS_ONLY). Refusals: MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE (DETAIL: JSON name of the supplier), MATERIAL_REQUEST_ORDER_NOT_FOUND, _NOTHING_READY, _SUPPLIER_INACTIVE (DETAIL: JSON names), _KEY_TAKEN, MATERIAL_REQUEST_LINE_ALREADY_ORDERED.';

commit;
