-- Sending a purchase order to its supplier by e-mail. No remote application is authorized here.
--
-- From a draft, the office sends the order to its supplier with the order attached as a PDF. The application claims
-- the send here, calls the e-mail provider, then settles the claim: the order becomes « envoyée » only when the
-- provider accepted the message, and the send stays on the order (who, when, to whom, what, the provider's id).
-- Sending is optional: an order of an affaire is still confirmed straight from its draft, an order without affaire is
-- still marked sent by hand.
--
-- 1. public.purchase_order_sends: one row per send asked, removed with its order. Its id is the request's idempotency
--    key, and the key the provider receives. Read like the order (its author, or an admin, of the active tenant);
--    written by the two functions of 4 only.
-- 2. private.guard_purchase_order_lifecycle: an order of an affaire also goes draft -> sent, through the settlement of
--    a send only (PURCHASE_ORDER_SEND_THROUGH_FUNCTION). From sent it already returned to draft or was canceled
--    (20261113190113); it is now confirmed too (3).
-- 3. public.confirm_material_request_purchase_order: a sent order is confirmed like a draft.
-- 4. public.begin_purchase_order_send (a member: SECURITY DEFINER, it checks the rights of an order's update itself,
--    private.purchase_order_access) and public.finish_purchase_order_send (the application server only, with the
--    service role: a member must not record an e-mail the provider never accepted).
-- Functions 2 and 3 are copied from their latest definition (20261113190113) with only the lines marked « Envoi »
-- changed. CREATE OR REPLACE keeps owners and ACLs.
-- Regression: supabase/tests/database/purchase-order-sends.test.sql.
--
-- What keeps a message from leaving twice, without the durable outbox of the estimates (no stored payload, no worker):
--  - one send in flight per order (the partial unique index, and the order's row lock in both functions);
--  - a request replayed with its key after its acceptance is answered what was sent;
--  - a claim whose request died (five minutes without settlement: no request lives that long) is not sent again by
--    the machine: the next request is answered, once, that this send is unconfirmed, and a person decides.

-- ---------------------------------------------------------------------------
-- 1. The sends of an order.
-- ---------------------------------------------------------------------------
create table public.purchase_order_sends (
  id uuid primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  -- The edit revision of the draft the message carries.
  order_revision bigint not null check (order_revision >= 0),
  -- As the user wrote them. When the outgoing e-mails are redirected to the test mailbox (redirected), the provider
  -- received another recipient and a prefixed subject: the supplier received nothing.
  recipient text not null check (char_length(recipient) <= 320 and recipient
    ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'),
  subject text not null check (char_length(subject) between 1 and 160 and subject = btrim(subject)
    and subject !~ '[[:cntrl:]]'),
  message text not null check (char_length(message) <= 5000),
  redirected boolean not null,
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed', 'unconfirmed')),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  failure_code text check (failure_code is null or char_length(failure_code) between 1 and 120),
  requested_by uuid not null,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  settled_at timestamptz,
  constraint purchase_order_sends_provider_id_when_sent check ((status = 'sent') = (provider_message_id is not null)),
  constraint purchase_order_sends_failure_when_not_sent
    check ((status in ('failed', 'unconfirmed')) = (failure_code is not null)),
  constraint purchase_order_sends_settled_when_not_sending check ((status = 'sending') = (settled_at is null))
);
create unique index purchase_order_sends_one_in_flight_idx on public.purchase_order_sends (purchase_order_id)
  where status = 'sending';
create index purchase_order_sends_order_idx on public.purchase_order_sends (purchase_order_id, requested_at);
create index purchase_order_sends_tenant_idx on public.purchase_order_sends (tenant_id);

comment on table public.purchase_order_sends is
  'The sends of a purchase order to its supplier by e-mail: the revision of the draft, the recipient, subject and message as written, whether the outgoing e-mails were redirected to the test mailbox, who asked and when, and the outcome: sending (claimed, the provider not yet answered), sent (accepted by the provider, with its id), failed (refused by the provider), unconfirmed (no answer: a person checks before sending again). Written by begin_purchase_order_send and finish_purchase_order_send only: a member can claim a send (and so leave an unconfirmed one), only the application server records an acceptance.';

alter table public.purchase_order_sends enable row level security;
-- service_role keeps its table privileges, as on every public table (security-invariants).
revoke all on public.purchase_order_sends from public, anon, authenticated;
grant select on public.purchase_order_sends to authenticated;
-- Read like the order: the subquery is filtered by the order's own policy (a member of its tenant who is its author or
-- an admin), in the active tenant.
create policy "Readers of an order read its sends" on public.purchase_order_sends
  for select to authenticated
  using (tenant_id = (select public.current_tenant_id()) and exists (
    select 1 from public.purchase_orders po
    where po.id = purchase_order_sends.purchase_order_id and po.tenant_id = purchase_order_sends.tenant_id));

-- ---------------------------------------------------------------------------
-- 2. The lifecycle of an order of an affaire: « envoyée » through a send only.
-- ---------------------------------------------------------------------------
create or replace function private.guard_purchase_order_lifecycle()
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
  -- Envoi: « envoyée » is written by the settlement of a send the e-mail provider accepted, never by hand.
  elsif old.status = 'draft' and new.status = 'sent' then
    if pg_catalog.current_setting('app.purchase_order_sending', true) is distinct from new.id::text then
      raise exception using errcode = '42501', message = 'PURCHASE_ORDER_SEND_THROUGH_FUNCTION';
    end if;
  elsif not (old.status in ('draft', 'sent') and new.status = 'canceled')
    and not (old.status in ('canceled', 'sent') and new.status = 'draft') then
    raise exception using errcode = '23514', message = 'PURCHASE_ORDER_STATUS_TRANSITION_INVALID',
      detail = old.status::text || ' -> ' || new.status::text;
  end if;
  return new;
end;
$$;
-- ---------------------------------------------------------------------------
-- 3. A sent order of an affaire is confirmed like a draft.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_material_request_purchase_order(
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
  kept_delivery date;
  reference_value text;
  document_value uuid;
  proof_path text;
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
  -- Envoi: an order sent by e-mail is confirmed like a draft.
  if po.status not in ('draft', 'sent') then
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
  -- Passed today at the latest (Paris), delivered on that day or after: the date given, else the one the draft keeps
  -- when it is a day (« TBD », a delivery still to be determined, stays as it is).
  if p_confirmation ? 'expected_delivery_date' then
    kept_delivery := delivery_value;
  elsif po.expected_delivery_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin
      kept_delivery := po.expected_delivery_date::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      kept_delivery := null;
    end;
  end if;
  if ordered_value > today or kept_delivery < ordered_value then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CONFIRMATION_DATE_INVALID';
  end if;
  -- The proof and its stored file are share-locked: a deletion of either that has not committed is waited for, then
  -- they are read as they stand; once this commits, keep_purchase_order_proof_file keeps the file.
  select document.storage_path into proof_path
  from public.purchase_order_devis document
  where document.id = document_value and document.purchase_order_id = po.id and document.tenant_id = tenant_value
  for share;
  if not found then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_CONFIRMATION_PROOF_REQUIRED';
  end if;
  perform 1 from storage.objects stored where stored.bucket_id = 'devis' and stored.name = proof_path for share;
  if not found then
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

  -- Envoi: the lines and the header of a sent order are read-only, so it returns to draft first, in this transaction
  -- (a status change alone, which the lifecycle guard accepts); the confirmation then goes on as for a draft.
  if po.status = 'sent' then
    update public.purchase_orders set status = 'draft' where id = po.id;
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
  'TI-691: records that a draft of an affaire, or one sent to its supplier by e-mail, was ordered: the real price and lot of the lines given, the order date (today at the latest, Paris), the delivery date (not before it), the supplier''s reference and the document joined to the order that proves it; the order becomes confirmed. Caller: admin or engineer of the active tenant who is the order''s author or an admin (PURCHASE_ORDER_ACCESS_DENIED). Refusals: PURCHASE_ORDER_INPUT_INVALID, _AFFAIRE_ONLY, _CONFIRMATION_NOT_DRAFT, _REVISION_REQUIRED, _REVISION_CONFLICT, _CONFIRMATION_DATE_INVALID, _CONFIRMATION_PROOF_REQUIRED, _ITEMS_INVALID, _CONFIRMATION_EMPTY.';

-- ---------------------------------------------------------------------------
-- 4. Claiming and settling a send.
-- ---------------------------------------------------------------------------
create function private.purchase_order_send_json(p_send public.purchase_order_sends)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.to_jsonb(p_send) - 'tenant_id';
$$;

-- p_send: { id: uuid (the request's idempotency key), recipient: one mailbox, subject, message, redirected: boolean }.
-- Answers { state, send }:
--  - claimed: the send is recorded as « sending »; the caller now calls the provider with send.id as idempotency key;
--  - sent: this request was already accepted by the provider (a replay): nothing is to be sent;
--  - unconfirmed: an earlier send of this order was claimed more than five minutes ago and never settled. It is now
--    recorded as unconfirmed and returned; nothing is claimed. The caller tells the user, who may ask again.
create function public.begin_purchase_order_send(p_order_id uuid, p_expected_revision bigint, p_send jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  tenant_value uuid;
  po public.purchase_orders%rowtype;
  send_id uuid;
  recipient_value text;
  subject_value text;
  message_value text;
  send public.purchase_order_sends%rowtype;
begin
  if p_order_id is null or pg_catalog.jsonb_typeof(p_send) is distinct from 'object'
    or p_send - array['id', 'recipient', 'subject', 'message', 'redirected'] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_send->'id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_send->'recipient') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_send->'subject') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_send->'message') is distinct from 'string'
    or pg_catalog.jsonb_typeof(p_send->'redirected') is distinct from 'boolean' then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_INPUT_INVALID';
  end if;
  begin
    send_id := (p_send->>'id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_INPUT_INVALID';
  end;
  recipient_value := p_send->>'recipient';
  subject_value := p_send->>'subject';
  message_value := p_send->>'message';
  -- One mailbox, with nothing a header or a second recipient could be built from (the rule of the outgoing routing).
  if pg_catalog.char_length(recipient_value) > 320 or recipient_value
      !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$'
    or pg_catalog.char_length(subject_value) not between 1 and 160 or subject_value <> pg_catalog.btrim(subject_value)
    or subject_value ~ '[[:cntrl:]]'
    or pg_catalog.char_length(message_value) > 5000 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_INPUT_INVALID';
  end if;
  -- An admin or engineer of the active tenant who is the order's author or an admin (PURCHASE_ORDER_ACCESS_DENIED).
  tenant_value := private.purchase_order_access(p_order_id, true);
  select * into po from public.purchase_orders where id = p_order_id and tenant_id = tenant_value for update;
  if not found then
    -- Deleted since the access check.
    raise exception using errcode = '42501', message = 'PURCHASE_ORDER_ACCESS_DENIED';
  end if;

  select * into send from public.purchase_order_sends s where s.id = send_id;
  if found then
    if send.purchase_order_id <> po.id or send.tenant_id <> tenant_value then
      raise exception using errcode = '23505', message = 'PURCHASE_ORDER_SEND_KEY_TAKEN';
    end if;
    if send.status = 'sent' then
      return pg_catalog.jsonb_build_object('state', 'sent', 'send', private.purchase_order_send_json(send));
    end if;
    if send.status <> 'sending' then
      raise exception using errcode = '23505', message = 'PURCHASE_ORDER_SEND_KEY_SPENT';
    end if;
  end if;

  select * into send from public.purchase_order_sends s where s.purchase_order_id = po.id and s.status = 'sending' for update;
  if found then
    if send.requested_at > pg_catalog.now() - interval '5 minutes' then
      raise exception using errcode = '55006', message = 'PURCHASE_ORDER_SEND_IN_PROGRESS';
    end if;
    update public.purchase_order_sends s
    set status = 'unconfirmed', failure_code = 'SEND_ABANDONED', settled_at = pg_catalog.now()
    where s.id = send.id returning * into send;
    return pg_catalog.jsonb_build_object('state', 'unconfirmed', 'send', private.purchase_order_send_json(send));
  end if;

  if po.status <> 'draft' then
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_SEND_NOT_DRAFT';
  end if;
  if p_expected_revision is null then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_REQUIRED';
  end if;
  if p_expected_revision <> po.edit_revision then
    raise exception using errcode = '40001', message = 'PURCHASE_ORDER_REVISION_CONFLICT';
  end if;
  if not exists (select 1 from public.purchase_order_items oi where oi.purchase_order_id = po.id and oi.line_kind = 'article') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_EMPTY';
  end if;

  insert into public.purchase_order_sends (id, tenant_id, purchase_order_id, order_revision, recipient, subject, message,
    redirected, requested_by, requested_by_name)
  values (send_id, tenant_value, po.id, po.edit_revision, recipient_value, subject_value, message_value,
    (p_send->>'redirected')::boolean, actor, (select profile.full_name from public.profiles profile where profile.id = actor))
  returning * into send;
  return pg_catalog.jsonb_build_object('state', 'claimed', 'send', private.purchase_order_send_json(send));
end;
$$;

comment on function public.begin_purchase_order_send(uuid, bigint, jsonb) is
  'Claims the send of a draft purchase order to one mailbox: { id (idempotency key), recipient, subject, message, redirected }. Answers { state: claimed | sent (replay of an accepted request) | unconfirmed (an earlier claim, never settled after five minutes, now recorded as such; nothing claimed), send }. The order stays a draft until finish_purchase_order_send records the provider''s acceptance. Caller: admin or engineer of the active tenant who is the order''s author or an admin (PURCHASE_ORDER_ACCESS_DENIED). Refusals: PURCHASE_ORDER_SEND_INPUT_INVALID, _SEND_KEY_TAKEN, _SEND_KEY_SPENT, _SEND_IN_PROGRESS, _SEND_NOT_DRAFT, _REVISION_REQUIRED, _REVISION_CONFLICT, _SEND_EMPTY.';

-- p_outcome: { status: 'sent', provider_message_id } | { status: 'failed' | 'unconfirmed', failure_code }.
-- sent: the provider accepted the message; the order becomes « envoyée » when it is still the draft the message carried
-- (same revision): a draft changed meanwhile stays a draft, its send recorded for the older revision. A send recorded
-- as unconfirmed whose acceptance arrives after all becomes sent. Answers { send, order: { id, status, edit_revision } }.
create function public.finish_purchase_order_send(p_send_id uuid, p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  po public.purchase_orders%rowtype;
  send public.purchase_order_sends%rowtype;
  order_value uuid;
  outcome text;
  provider_value text;
  failure_value text;
begin
  if p_send_id is null or pg_catalog.jsonb_typeof(p_outcome) is distinct from 'object'
    or p_outcome - array['status', 'provider_message_id', 'failure_code'] <> '{}'::jsonb
    or pg_catalog.jsonb_typeof(p_outcome->'status') is distinct from 'string'
    or p_outcome->>'status' not in ('sent', 'failed', 'unconfirmed')
    or coalesce(pg_catalog.jsonb_typeof(p_outcome->'provider_message_id'), 'null') not in ('string', 'null')
    or coalesce(pg_catalog.jsonb_typeof(p_outcome->'failure_code'), 'null') not in ('string', 'null') then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_INPUT_INVALID';
  end if;
  outcome := p_outcome->>'status';
  provider_value := nullif(pg_catalog.btrim(p_outcome->>'provider_message_id'), '');
  failure_value := nullif(pg_catalog.btrim(p_outcome->>'failure_code'), '');
  if (outcome = 'sent') <> (provider_value is not null) or (outcome <> 'sent') <> (failure_value is not null)
    or pg_catalog.char_length(provider_value) > 200 or pg_catalog.char_length(failure_value) > 120 then
    raise exception using errcode = '22023', message = 'PURCHASE_ORDER_SEND_INPUT_INVALID';
  end if;

  select s.purchase_order_id into order_value from public.purchase_order_sends s where s.id = p_send_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'PURCHASE_ORDER_SEND_NOT_FOUND';
  end if;
  -- The order first, then its send: the lock order of begin_purchase_order_send.
  select * into po from public.purchase_orders where id = order_value for update;
  select * into send from public.purchase_order_sends s where s.id = p_send_id for update;
  if not found then
    -- The order, and its sends with it, was deleted meanwhile.
    raise exception using errcode = 'P0002', message = 'PURCHASE_ORDER_SEND_NOT_FOUND';
  end if;

  if send.status = outcome and (outcome <> 'sent' or send.provider_message_id = provider_value) then
    null; -- The same settlement again.
  elsif send.status = 'sending' or (send.status = 'unconfirmed' and outcome = 'sent') then
    update public.purchase_order_sends s
    set status = outcome, provider_message_id = provider_value, failure_code = failure_value, settled_at = pg_catalog.now()
    where s.id = send.id returning * into send;
    if outcome = 'sent' and po.status = 'draft' and po.edit_revision = send.order_revision then
      perform pg_catalog.set_config('app.purchase_order_sending', po.id::text, true);
      update public.purchase_orders set status = 'sent' where id = po.id;
      perform pg_catalog.set_config('app.purchase_order_sending', '', true);
      select * into po from public.purchase_orders where id = order_value;
    end if;
  else
    raise exception using errcode = '55000', message = 'PURCHASE_ORDER_SEND_SETTLED';
  end if;
  return pg_catalog.jsonb_build_object('send', private.purchase_order_send_json(send),
    'order', pg_catalog.jsonb_build_object('id', po.id, 'status', po.status::text, 'edit_revision', po.edit_revision));
end;
$$;

comment on function public.finish_purchase_order_send(uuid, jsonb) is
  'Settles a claimed send of a purchase order, for the application server only (service role): { status: sent, provider_message_id } marks the order sent when it is still the draft the message carried; { status: failed | unconfirmed, failure_code } leaves it a draft. An unconfirmed send whose acceptance arrives becomes sent; the same settlement again changes nothing. Refusals: PURCHASE_ORDER_SEND_INPUT_INVALID, _SEND_NOT_FOUND, _SEND_SETTLED.';

revoke all on function private.purchase_order_send_json(public.purchase_order_sends) from public, anon, authenticated, service_role;
revoke all on function public.begin_purchase_order_send(uuid, bigint, jsonb), public.finish_purchase_order_send(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_purchase_order_send(uuid, bigint, jsonb) to authenticated;
grant execute on function public.finish_purchase_order_send(uuid, jsonb) to service_role;
