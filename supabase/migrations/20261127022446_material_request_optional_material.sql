-- Supplier consultations, lot 1, slice 1a: the material of a material request line is optional. No remote
-- application is authorized here; the orchestrator applies it to the shared database after merge.
--
-- The owner's decision of 2026-11-27 (Maxime): « La matière n'est pas du tout obligatoire, c'est un truc facultatif.
-- Le fournisseur comprendra. » Nothing about the material blocks a validation or undoes one, for every request. The
-- presumed material of a request (presumed_material, material_confirmed) stays: once confirmed, it is still the
-- default wording of the lines that name no material. No table, column, row or right changes.
--
-- 1. private.enforce_material_request_line_write: its latest body (20261112173255_material_request_quotes.sql) without
--    the material rule. A line is validated with quantity, unit, type and a size (or « sans dimension »), as the check
--    constraint already requires, with or without a material: MATERIAL_REQUEST_LINE_MATERIAL_MISSING and
--    MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED are no longer raised. Everything else is unchanged.
-- 2. The trigger reopen_material_request_lines_without_material and its function are dropped: no line relies on the
--    presumed material for its validation any more, so changing, clearing or un-confirming it leaves every validated
--    line validated.
-- 3. public.retain_material_request_quote: its body (20261112173255) without the backstop that refused a quote while a
--    project line without material met an unconfirmed presumed material (MATERIAL_REQUEST_QUOTE_MATERIAL_UNCONFIRMED is
--    no longer raised). The retaining writes the presumed material on such a line only when it was confirmed before the
--    quote was requested and has not changed since (material_confirmed_at <= requested_at: changing or un-confirming
--    the material clears material_confirmed_at, a new confirmation stamps it again), which is what the consultation
--    message wrote; otherwise the line is priced, and frozen, without a material. The dropped reopen trigger used to
--    force a new validation when the material changed between the consultation and the retaining.
-- 4. public.create_material_request_purchase_orders: its latest body (20261122194343_affaire_site_contacts.sql) with the
--    designation built from the line's own material only. It used to fall back on the request's material when it was
--    confirmed at order time, which could now order a line priced without material in a material confirmed after its
--    retaining. Every line priced before this migration had its material written by its retaining (which refused
--    otherwise), so their orders read the same words.
-- CREATE OR REPLACE keeps owners and grants. Regression: supabase/tests/database/material-requests.test.sql (16) and
-- supabase/tests/database/material-request-quotes.test.sql (15).
begin;
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. A line is validated without a material.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_material_request_line_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  parent record;
  -- The retaining writes the request's confirmed presumed material on a project line that had none (see below).
  materialized boolean := false;
begin
  if tg_op = 'INSERT' then
    select request.tenant_id, request.project_id into parent
    from public.material_requests request where request.id = new.request_id;
    if parent.tenant_id is null then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_NOT_FOUND';
    end if;
    new.tenant_id := parent.tenant_id;
    new.project_id := parent.project_id;
    new.created_at := now();
    -- Three hundred lines per request (MATERIAL_REQUEST_MAX_LINES in the application, which refuses
    -- first and in friendlier words). Appends to one request wait for each other on its row, so two of
    -- them cannot both count 299 and pass; a batch that would cross the cap fails as a whole. The
    -- request row is the first lock an append takes, and an append holds no line another transaction
    -- waits for, so it cannot close a lock cycle with a validation or a change to the request.
    perform 1 from public.material_requests request where request.id = new.request_id for update;
    if (select count(*) from public.material_request_lines other where other.request_id = new.request_id) >= 300 then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_LIMIT';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id or new.project_id is distinct from old.project_id
    or new.request_id is distinct from old.request_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_SCOPE_IMMUTABLE';
  else
    new.created_at := old.created_at;
  end if;

  if new.supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = new.supplier_id and supplier.tenant_id = new.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- The article is one of the line's tenant. The trigger runs as the caller: an article the caller cannot
  -- read is one that does not exist. Checked when it is set; the tenant of a line never changes.
  if new.product_id is not null and (tg_op = 'INSERT' or new.product_id is distinct from old.product_id)
    and not exists (
      select 1 from public.products product
      where product.id = new.product_id and product.tenant_id = new.tenant_id
    )
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_TENANT_MISMATCH';
  end if;

  -- The wording before the first link belongs to the link: it is written or cleared with the article, never
  -- alone, so that no edit can make the line "remember" words the technician did not write.
  if new.pre_link_wording is not null and tg_op = 'INSERT' and new.product_id is null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' and new.pre_link_wording is distinct from old.pre_link_wording
    and new.product_id is not distinct from old.product_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_PRE_LINK_WORDING_IMMUTABLE';
  end if;

  -- How a line was linked goes with its link: unlinked by the office, or erased by the article's deletion
  -- (ON DELETE SET NULL, which would otherwise fail the presence check and block the deletion). A match
  -- sent without an article, on a line that had none, is refused by that check.
  if tg_op = 'UPDATE' and old.product_id is not null and new.product_id is null then
    new.product_match := null;
  end if;

  -- TI-691 delivery 2: the price of a line (and the quantity it is for) is its retained quote's, and only the
  -- retaining writes it. A line is never created priced; it is priced once, while public.retain_material_request_quote
  -- runs for that very quote (the transaction-local marker it sets, which the Data API cannot set); the price then
  -- stays. The only other change is its clearing by the deletion of the quote itself (ON DELETE SET NULL, trigger
  -- depth > 1), the price going with it. A priced line keeps the quote's supplier. Neither is what the line says: a
  -- validated line stays validated.
  if tg_op = 'INSERT' then
    if new.price_quote_id is not null or new.unit_price_ht_cents is not null or new.price_per is distinct from 1 then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY';
    end if;
  elsif (new.price_quote_id, new.unit_price_ht_cents, new.price_per)
    is distinct from (old.price_quote_id, old.unit_price_ht_cents, old.price_per) then
    if pg_trigger_depth() > 1 and old.price_quote_id is not null and new.price_quote_id is null then
      new.unit_price_ht_cents := null;
      new.price_per := 1;
    elsif old.price_quote_id is not null or new.price_quote_id is null
      or pg_catalog.current_setting('app.material_request_quote_retaining', true) is distinct from new.price_quote_id::text
    then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY';
    else
      -- The retaining itself. A project line without its own material, retained while the request's presumed material
      -- is confirmed, takes that material from the retaining: that is not an edit of what it says.
      materialized := old.imputation = 'project' and btrim(coalesce(old.material, '')) = ''
        and new.material is distinct from old.material;
    end if;
  elsif old.price_quote_id is not null and new.supplier_id is distinct from old.supplier_id then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_SUPPLIER_FROM_QUOTE';
  end if;

  -- A priced line orders what its retained quote priced, at that price: its article, type, size, material, precision,
  -- reference, unit and quantity no longer change (a DN 50 priced is not ordered as a DN 65 at the DN 50 price). There
  -- is no way back in this delivery: a retained quote is not reopened. Its zone, imputation, the technician's words, the
  -- quantity doubt and the duplicate acknowledgement stay editable, and an article erased by its own deletion (ON
  -- DELETE SET NULL, trigger depth > 1) is not an edit.
  if tg_op = 'UPDATE' and old.price_quote_id is not null and new.price_quote_id is not null and pg_trigger_depth() = 1
    and (new.product_id, new.product_match, new.product_type, new.dimension, new.no_dimension, new.material,
      new.material_precision, new.reference, new.unit, new.quantity)
    is distinct from (old.product_id, old.product_match, old.product_type, old.dimension, old.no_dimension, old.material,
      old.material_precision, old.reference, old.unit, old.quantity)
  then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_LINE_PRICED';
  end if;

  -- A validated line always describes what was validated: changing what it says returns it to draft,
  -- even when the same statement keeps it validated. Position and the duplicate acknowledgement are
  -- not what it says, nor is its supplier (TI-691: the office's purchasing choice, made or changed on a
  -- validated line), and an article erased by its own deletion (trigger depth 2) is not an edit. Linking,
  -- changing or removing the article is. pre_link_wording is left out: it is what the line said before
  -- its link, not what it says, and it only changes with product_id, which is compared.
  if tg_op = 'UPDATE' and old.status = 'validated' and new.status = 'validated' and pg_trigger_depth() = 1 and (
    (new.original_text, new.quantity, new.quantity_doubtful, new.unit, new.dimension, new.no_dimension,
      new.product_type, case when materialized then old.material else new.material end, new.material_precision,
      new.reference, new.zone,
      new.imputation, new.overhead_category, new.product_id, new.product_match)
    is distinct from
    (old.original_text, old.quantity, old.quantity_doubtful, old.unit, old.dimension, old.no_dimension,
      old.product_type, old.material, old.material_precision, old.reference, old.zone,
      old.imputation, old.overhead_category, old.product_id, old.product_match)
  ) then
    new.status := 'draft';
  end if;

  -- No material rule (owner decision of 2026-11-27): a line is validated with or without a material, its own or the
  -- request's. The supplier reads the line without it.

  -- Author and date of a validation are stamped here, never taken from the client.
  if new.status <> 'validated' then
    new.validated_at := null;
    new.validated_by := null;
  elsif tg_op = 'UPDATE' and old.status = 'validated' then
    new.validated_at := old.validated_at;
    if new.validated_by is not null or pg_trigger_depth() = 1 then new.validated_by := old.validated_by; end if;
  else
    new.validated_at := clock_timestamp();
    new.validated_by := (select auth.uid());
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The presumed material no longer reopens validated lines.
-- ---------------------------------------------------------------------------
drop trigger reopen_material_request_lines_without_material on public.material_requests;
drop function private.reopen_material_request_lines_without_material();

-- ---------------------------------------------------------------------------
-- 3. A quote is retained without a confirmed material.
-- ---------------------------------------------------------------------------
create or replace function public.retain_material_request_quote(p_quote_id uuid)
returns table (closed_quote_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target record;
  presumed record;
  positions integer[];
  line_count integer;
  priced integer;
  closed_ids uuid[];
begin
  select q.request_id into target from public.material_request_quotes q where q.id = p_quote_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'MATERIAL_REQUEST_QUOTE_NOT_FOUND';
  end if;
  perform 1 from public.material_request_quotes q
  where q.request_id = target.request_id and q.status in ('requested', 'received')
  order by q.id
  for update;
  -- Read again under the locks: a competing retaining that committed meanwhile has closed it.
  select q.id, q.request_id, q.supplier_id, q.status, q.requested_at into target
  from public.material_request_quotes q where q.id = p_quote_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'MATERIAL_REQUEST_QUOTE_WRITERS_ONLY';
  end if;
  if target.status <> 'received' then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_NOT_RECEIVED', detail = target.status;
  end if;

  select count(*) into line_count from public.material_request_quote_lines quote_line where quote_line.quote_id = target.id;
  if line_count = 0 then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_WITHOUT_LINES';
  end if;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and quote_line.unit_price_ht_cents is null;
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_UNPRICED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;

  -- The request first (before its lines, like a change of its header): its presumed material, its confirmation and
  -- the time of that confirmation stay as read here until this retaining commits.
  select request.presumed_material, request.material_confirmed, request.material_confirmed_at into presumed
  from public.material_requests request where request.id = target.request_id for share;
  perform 1 from public.material_request_lines line
  where line.id in (
    select quote_line.line_id from public.material_request_quote_lines quote_line where quote_line.quote_id = target.id
  )
  order by line.id
  for update;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and line.price_quote_id is not null;
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;
  select pg_catalog.array_agg(line.position order by line.position) into positions
  from public.material_request_quote_lines quote_line
  join public.material_request_lines line on line.id = quote_line.line_id
  where quote_line.quote_id = target.id and line.status <> 'validated';
  if positions is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED',
      detail = pg_catalog.array_to_json(positions)::text;
  end if;
  perform pg_catalog.set_config('app.material_request_quote_retaining', target.id::text, true);
  update public.material_request_quotes q set status = 'retained' where q.id = target.id;
  update public.material_request_lines line
  set supplier_id = target.supplier_id,
      unit_price_ht_cents = quote_line.unit_price_ht_cents,
      price_per = quote_line.price_per,
      price_quote_id = target.id,
      -- optional material: the presumed material the supplier was consulted in, i.e. confirmed before the quote was
      -- requested and unchanged since; a material confirmed (or changed and confirmed again) later was not the one
      -- priced, and the line is then priced without a material.
      material = case when line.imputation = 'project' and pg_catalog.btrim(coalesce(line.material, '')) = ''
          and presumed.material_confirmed and pg_catalog.btrim(coalesce(presumed.presumed_material, '')) <> ''
          and presumed.material_confirmed_at <= target.requested_at
        then presumed.presumed_material else line.material end
  from public.material_request_quote_lines quote_line
  where quote_line.quote_id = target.id and line.id = quote_line.line_id and line.price_quote_id is null;
  get diagnostics priced = row_count;
  perform pg_catalog.set_config('app.material_request_quote_retaining', '', true);
  -- Every line of the quote is priced, or nothing is (a line the caller may not change is not written by RLS).
  if priced <> line_count then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_QUOTE_LINES_CHANGED';
  end if;

  with closed as (
    update public.material_request_quotes other
    set status = 'closed'
    where other.request_id = target.request_id
      and other.id <> target.id
      and other.status in ('requested', 'received')
      and exists (
        select 1
        from public.material_request_quote_lines theirs
        join public.material_request_quote_lines mine on mine.line_id = theirs.line_id and mine.quote_id = target.id
        where theirs.quote_id = other.id
      )
    returning other.id
  )
  select coalesce(pg_catalog.array_agg(closed.id order by closed.id), '{}'::uuid[]) into closed_ids from closed;

  return query select closed.id from pg_catalog.unnest(closed_ids) as closed(id);
end;
$$;

comment on function public.retain_material_request_quote(uuid) is
  'TI-691: retains a received quote whose lines are all priced and validated, in one transaction, as the caller (RLS): it becomes retained, its lines take its supplier, price, price quantity and id, and a project line without its own material takes the request''s presumed material when it was confirmed before the quote was requested and has not changed since, else stays without one (a validated line stays validated), and every other requested or received quote of the request sharing a line is closed; returns their ids. Refusals: MATERIAL_REQUEST_QUOTE_NOT_FOUND, _WRITERS_ONLY, _NOT_RECEIVED (DETAIL: status), _WITHOUT_LINES, _LINES_UNPRICED, _LINES_ALREADY_RETAINED, _LINES_NOT_VALIDATED (DETAIL: JSON array of line positions), _LINES_CHANGED.';


-- ---------------------------------------------------------------------------
-- 4. An order line says the material its line was priced in, or none.
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
      technician.name as technician_name
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
      -- optional material: the line's own material only. A ready line is priced, and its retaining wrote on it the
      -- request's material if the supplier was consulted in it; a material confirmed later was not the one priced.
      private.material_request_line_designation(line.product_type, line.original_text, line.dimension,
        nullif(pg_catalog.btrim(line.material), ''), line.material_precision),
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
