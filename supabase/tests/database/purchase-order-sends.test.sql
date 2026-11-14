-- Sending a purchase order to its supplier by e-mail. Written before the migration
-- 20261114121243_purchase_order_sends.sql. The application claims a send, calls the e-mail provider, then settles the
-- claim: the order becomes « envoyée » only when the provider accepted the message. Failure modes this file guards,
-- with fictional members, suppliers, articles and addresses:
--  1. the two functions reach anon or PUBLIC or run without a pinned search_path; a member settles a send himself (he
--     would record an e-mail the provider never accepted); the table is written by a Data API role, read by a member
--     who may not open the order, or read without RLS;
--  2. a send is claimed by a viewer, an engineer who is not the author, a member of another tenant, on a stale revision,
--     on an order that is not a draft, on an order without article, with two recipients, a header injected in the
--     recipient or the subject, an empty subject or an overlong message; a refusal writes nothing;
--  3. a claim does not record who asked, to whom, what and which revision; it already says « envoyée »; a second claim
--     (a double click, another member) is accepted while the first is in flight; a member marks an order of an affaire
--     sent by a direct write;
--  4. the provider's acceptance does not mark the order sent, record the provider's id and the time; the same request
--     replayed sends again instead of answering what was sent; a sent order is sent again; a settled send is settled
--     otherwise;
--  5. a refusal of the provider marks the order sent, or keeps the draft from being sent again; its key is reused;
--  6. a claim whose request died keeps the order unsendable for ever, or is silently sent again: it must be named
--     once as unconfirmed, then leave the way free; its late acceptance is lost;
--  7. a draft changed while its e-mail was leaving is marked sent although the supplier received the older content;
--  8. an order of an affaire sent by e-mail cannot be confirmed, returned to draft or canceled;
--  9. an order without affaire is not sent this way, or loses its free status changes; a key of another tenant's send
--     is taken over.
-- Every member statement goes through pg_temp.pos_run or pg_temp.pos_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaire 201 and makes the orders, 2 admin, 3 viewer, 5 engineer who is not the
-- author. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9370000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'envoi-' || n || '@example.test',
  jsonb_build_object('full_name', 'Envoi Membre ' || n)
from generate_series(1, 5) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9370000-%';
insert into public.tenants (id, name, slug) values
  ('a9370000-0000-4000-8000-000000000101', 'Envoi fixture', 'envoi-fixture'),
  ('a9370000-0000-4000-8000-000000000102', 'Envoi autre tenant', 'envoi-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9370000-0000-4000-8000-000000000102' else 'a9370000-0000-4000-8000-000000000101' end)::uuid,
  ('a9370000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 5) n;
update public.profiles set full_name = 'Envoi Membre 1' where id = 'a9370000-0000-4000-8000-000000000001';

insert into public.suppliers (id, tenant_id, name, email) values
  ('a9370000-0000-4000-8000-000000000301', 'a9370000-0000-4000-8000-000000000101', 'Envoi Alpha', 'commandes@alpha.example.test'),
  ('a9370000-0000-4000-8000-000000000302', 'a9370000-0000-4000-8000-000000000101', 'Envoi Beta', null),
  ('a9370000-0000-4000-8000-000000000303', 'a9370000-0000-4000-8000-000000000102', 'Envoi Gamma', null);
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit) values
  ('a9370000-0000-4000-8000-000000000501', 'a9370000-0000-4000-8000-000000000101', 'ENV-501', 'Envoi Coude 90° inox DN 50',
    100, 'Coude 90°', 'Inox 304L', 'u');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9370000-0000-4000-8000-000000000201', 'a9370000-0000-4000-8000-000000000101', 'a9370000-0000-4000-8000-000000000001',
    'Envoi Affaire');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9370000-0000-4000-8000-000000000801', 'a9370000-0000-4000-8000-000000000101', 'Envoi Chantier', true,
    now() - interval '1 second'),
  ('a9370000-0000-4000-8000-000000000802', 'a9370000-0000-4000-8000-000000000102', 'Envoi Chantier autre', true,
    now() - interval '1 second');
-- Request 601: L1 elbows at Alpha, L2 sleeves at Beta.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9370000-0000-4000-8000-000000000601', 'a9370000-0000-4000-8000-000000000201', '2026-11-10', '2026-11-20', 'site',
    'a9370000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, product_id, product_match) values
  ('a9370000-0000-4000-8000-000000000701', 'a9370000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', 'a9370000-0000-4000-8000-000000000501', 'manual'),
  ('a9370000-0000-4000-8000-000000000702', 'a9370000-0000-4000-8000-000000000601', 2, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null);
update public.material_request_lines set status = 'validated' where request_id = 'a9370000-0000-4000-8000-000000000601';

-- Runs one statement as a signed-in member: « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.pos_run(p_user uuid, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text;
  affected bigint;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute p_sql;
    get diagnostics affected = row_count;
    run_result := 'ok ' || affected;
  exception when others then
    run_result := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message }.
create function pg_temp.pos_rows(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute format('select coalesce(jsonb_agg(to_jsonb(answer)), ''[]''::jsonb) from (%s) answer', p_sql) into run_result;
  exception when others then
    run_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- Settles a send as the application server does, with the service role: the answer, or { error, message }.
create function pg_temp.pos_settle(p_send uuid, p_outcome jsonb)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
begin
  begin
    execute 'set local role service_role';
    run_result := public.finish_purchase_order_send(p_send, p_outcome);
  exception when others then
    run_result := jsonb_build_object('error', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  return run_result;
end;
$run$;

select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9370000-0000-4000-8000-000000000601', 'a9370000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9370000-0000-4000-8000-000000000701']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L1');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9370000-0000-4000-8000-000000000601', 'a9370000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9370000-0000-4000-8000-000000000702']::uuid[])$$),
  'ok 1', 'fixture: and Beta for L2');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9370000-0000-4000-8000-000000000601' and supplier_id = 'a9370000-0000-4000-8000-000000000301'), true);
select set_config('test.quote_beta', (select id::text from public.material_request_quotes
  where request_id = 'a9370000-0000-4000-8000-000000000601' and supplier_id = 'a9370000-0000-4000-8000-000000000302'), true);
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9370000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1234))))$$),
  'ok 1', 'fixture: Alpha answers');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_beta')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(jsonb_build_object('line_id', 'a9370000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 999))))$$),
  'ok 1', 'fixture: Beta answers');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_beta')::uuid)$$), 'ok 0',
  'fixture: Beta is retained');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9370000-0000-4000-8000-000000000601',
    'a9370000-0000-4000-8000-00000000a001')$$), 'ok 1', 'fixture: the owner makes one draft per supplier');
select set_config('test.order_alpha', (select id::text from public.purchase_orders
  where project_id = 'a9370000-0000-4000-8000-000000000201' and supplier_id = 'a9370000-0000-4000-8000-000000000301'), true);
select set_config('test.order_beta', (select id::text from public.purchase_orders
  where project_id = 'a9370000-0000-4000-8000-000000000201' and supplier_id = 'a9370000-0000-4000-8000-000000000302'), true);
select set_config('test.item_elbows', (select id::text from public.purchase_order_items
  where material_request_line_id = 'a9370000-0000-4000-8000-000000000701'), true);
-- A manual order of a site, without affaire, by the same engineer; and one of the other tenant, by its admin.
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9370000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9370000-0000-4000-8000-000000000801', 'notes', 'Envoi manuel'), jsonb_build_array(
    jsonb_build_object('designation', 'Envoi manuel', 'quantity', 3, 'unit', 'u', 'unit_price_ht_cents', 500, 'tax_rate_bp', 2000)))$$),
  'ok 1', 'fixture: a manual order of a site');
select set_config('test.order_manual', (select id::text from public.purchase_orders
  where notes = 'Envoi manuel' and tenant_id = 'a9370000-0000-4000-8000-000000000101'), true);
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000004',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9370000-0000-4000-8000-000000000303',
    'delivery_site_id', 'a9370000-0000-4000-8000-000000000802', 'notes', 'Envoi autre'), jsonb_build_array(
    jsonb_build_object('designation', 'Envoi autre', 'quantity', 1, 'unit', 'u', 'unit_price_ht_cents', 100, 'tax_rate_bp', 2000)))$$),
  'ok 1', 'fixture: an order of the other tenant');
select set_config('test.order_other', (select id::text from public.purchase_orders
  where notes = 'Envoi autre' and tenant_id = 'a9370000-0000-4000-8000-000000000102'), true);
-- The proof Alpha's order is confirmed with in 8.
insert into public.purchase_order_devis (id, tenant_id, purchase_order_id, user_id, name, original_filename, storage_path,
  file_size_bytes, mime_type, position)
values ('a9370000-0000-4000-8000-00000000d001', 'a9370000-0000-4000-8000-000000000101',
  current_setting('test.order_alpha')::uuid, 'a9370000-0000-4000-8000-000000000001', 'Accusé de réception', 'ar.pdf',
  'purchase-orders/' || current_setting('test.order_alpha') || '/ar.pdf', 1024, 'application/pdf', 1);
insert into storage.objects (bucket_id, name, metadata)
select 'devis', storage_path, '{"size": 1024}'::jsonb from public.purchase_order_devis
where id = 'a9370000-0000-4000-8000-00000000d001';

create function pg_temp.revision(p_order text) returns text language sql as $fn$
  select edit_revision::text from public.purchase_orders where id = current_setting(p_order)::uuid;
$fn$;
create function pg_temp.order_status(p_order text) returns text language sql as $fn$
  select status::text from public.purchase_orders where id = current_setting(p_order)::uuid;
$fn$;
-- The claim of a send of an order, as a statement a member runs: key « …00000000e0NN », to Alpha's address.
create function pg_temp.claim(p_order text, p_key int, p_revision text, p_patch jsonb default '{}'::jsonb)
returns text
language sql
as $fn$
  select format($q$select public.begin_purchase_order_send(%L::uuid, %s, %L::jsonb)$q$,
    current_setting(p_order), p_revision, (jsonb_build_object(
      'id', 'a9370000-0000-4000-8000-00000000e' || lpad(p_key::text, 3, '0'),
      'recipient', 'commandes@alpha.example.test', 'subject', 'Bon de commande C-TEST',
      'message', E'Bonjour,\n\nVeuillez trouver notre bon de commande.', 'redirected', true) || p_patch)::text);
$fn$;
create function pg_temp.send_id(p_key int) returns uuid language sql as $fn$
  select ('a9370000-0000-4000-8000-00000000e' || lpad(p_key::text, 3, '0'))::uuid;
$fn$;

-- ---------------------------------------------------------------------------
-- 1. Structure and grants.
-- ---------------------------------------------------------------------------
select ok((select bool_and(prosecdef and exists (select 1 from unnest(proconfig) setting where setting = 'search_path=""'))
  from pg_proc where oid in ('public.begin_purchase_order_send(uuid, bigint, jsonb)'::regprocedure,
    'public.finish_purchase_order_send(uuid, jsonb)'::regprocedure)),
  '1 both functions are security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.begin_purchase_order_send(uuid, bigint, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.finish_purchase_order_send(uuid, jsonb)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.begin_purchase_order_send(uuid, bigint, jsonb)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.finish_purchase_order_send(uuid, jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.finish_purchase_order_send(uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('service_role', 'public.begin_purchase_order_send(uuid, bigint, jsonb)', 'EXECUTE'),
  '1 a member claims a send, only the application server settles it, an anonymous caller does neither');
select ok(not exists (
    select 1 from information_schema.routine_privileges
    where routine_schema = 'public' and grantee = 'PUBLIC'
      and routine_name in ('begin_purchase_order_send', 'finish_purchase_order_send')),
  '1 PUBLIC executes neither');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.purchase_order_sends'::regclass),
  '1 the sends table has RLS');
select ok(has_table_privilege('authenticated', 'public.purchase_order_sends', 'SELECT')
    and not has_table_privilege('authenticated', 'public.purchase_order_sends', 'INSERT, UPDATE, DELETE')
    and not has_table_privilege('anon', 'public.purchase_order_sends', 'SELECT, INSERT, UPDATE, DELETE'),
  '1 a member reads it and writes it only through the claim; an anonymous caller has nothing');

-- ---------------------------------------------------------------------------
-- 2. Who may claim a send, of what, with what.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000003', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '2 a viewer does not send an order');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000005', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '2 nor an engineer who is not its author');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000004', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'))),
  '42501 PURCHASE_ORDER_ACCESS_DENIED', '2 nor a member of another tenant');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, '0')),
  '40001 PURCHASE_ORDER_REVISION_CONFLICT', '2 a draft changed since the screen read it is not sent');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, 'null')),
  '40001 PURCHASE_ORDER_REVISION_REQUIRED', '2 nor one whose revision is not given');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    '{"recipient": "a@alpha.example.test, b@alpha.example.test"}')),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 two recipients are refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    jsonb_build_object('recipient', E'a@alpha.example.test\nBcc: b@alpha.example.test'))),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 a header injected in the recipient is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    jsonb_build_object('subject', E'Bon\nBcc: b@alpha.example.test'))),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 a line break in the subject is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    '{"subject": "   "}')),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 an empty subject is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    jsonb_build_object('message', repeat('a', 5001)))),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 an overlong message is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    '{"redirected": "oui"}')),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 the routing is a boolean');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'),
    '{"copy": "b@alpha.example.test"}')),
  '22023 PURCHASE_ORDER_SEND_INPUT_INVALID', '2 an unknown field is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$), 'ok 1',
  'fixture: Beta''s draft is canceled');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 1, pg_temp.revision('test.order_beta'))),
  '55000 PURCHASE_ORDER_SEND_NOT_DRAFT', '2 a canceled order is not sent');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_beta')::uuid$$), 'ok 1',
  'fixture: and reopened');
select is((select count(*) from public.purchase_order_sends), 0::bigint, '2 a refusal writes nothing');

-- ---------------------------------------------------------------------------
-- 3. A claim: recorded, exclusive, and not yet « envoyée ».
-- ---------------------------------------------------------------------------
select set_config('test.revision_claimed', pg_temp.revision('test.order_alpha'), true);
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000001',
    replace(pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha')), 'select public.begin_purchase_order_send',
      'select answer->>''state'' as state, answer->''send''->>''status'' as status from public.begin_purchase_order_send')
      || ' answer'),
  '[{"state": "claimed", "status": "sending"}]'::jsonb, '3 the author claims the send of his draft');
select results_eq(
  $$select purchase_order_id::text, tenant_id::text, order_revision::text, recipient, subject, message, redirected, status,
      requested_by::text, requested_by_name, provider_message_id, settled_at is null
    from public.purchase_order_sends where id = pg_temp.send_id(1)$$,
  $$select current_setting('test.order_alpha'), 'a9370000-0000-4000-8000-000000000101', current_setting('test.revision_claimed'),
      'commandes@alpha.example.test', 'Bon de commande C-TEST', E'Bonjour,\n\nVeuillez trouver notre bon de commande.', true,
      'sending', 'a9370000-0000-4000-8000-000000000001', 'Envoi Membre 1', null::text, true$$,
  '3 the claim records the order, its revision, the recipient, the subject, the message, the routing and who asked');
select is(pg_temp.order_status('test.order_alpha'), 'draft', '3 a claimed order is still a draft');
select is(pg_temp.revision('test.order_alpha'), current_setting('test.revision_claimed'), '3 and its revision has not moved');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 1, pg_temp.revision('test.order_alpha'))),
  '55006 PURCHASE_ORDER_SEND_IN_PROGRESS', '3 the same request again, while the first is in flight, is refused');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000002', pg_temp.claim('test.order_alpha', 2, pg_temp.revision('test.order_alpha'))),
  '55006 PURCHASE_ORDER_SEND_IN_PROGRESS', '3 and so is another request, by an admin');
select is((select count(*) from public.purchase_order_sends), 1::bigint, '3 one claim only');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000002',
  $$update public.purchase_orders set status = 'sent' where id = current_setting('test.order_alpha')::uuid$$),
  '42501 PURCHASE_ORDER_SEND_THROUGH_FUNCTION', '3 an order of an affaire is not marked sent by a direct write, even by an admin');
select matches(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.finish_purchase_order_send(pg_temp.send_id(1), '{"status": "sent", "provider_message_id": "faux"}'::jsonb)$$),
  '^42501 ', '3 a member does not settle a send himself');
select matches(pg_temp.pos_run('a9370000-0000-4000-8000-000000000002',
  $$update public.purchase_order_sends set status = 'sent', provider_message_id = 'faux', settled_at = now()$$),
  '^42501 ', '3 nor write the table');
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000002', $$select status from public.purchase_order_sends$$),
  '[{"status": "sending"}]'::jsonb, '3 an admin of the tenant reads the send');
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000005', $$select status from public.purchase_order_sends$$),
  '[]'::jsonb, '3 an engineer who may not open the order does not');
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000004', $$select status from public.purchase_order_sends$$),
  '[]'::jsonb, '3 nor a member of another tenant');

-- ---------------------------------------------------------------------------
-- 4. The provider accepted the message: the order is « envoyée ».
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_settle(pg_temp.send_id(1), '{"status": "sent"}'::jsonb)->>'message',
  'PURCHASE_ORDER_SEND_INPUT_INVALID', '4 an acceptance without the provider''s id is refused');
select is(pg_temp.pos_settle(pg_temp.send_id(99), '{"status": "sent", "provider_message_id": "re_1"}'::jsonb)->>'message',
  'PURCHASE_ORDER_SEND_NOT_FOUND', '4 an unknown send is not settled');
select is(pg_temp.pos_settle(pg_temp.send_id(1), '{"status": "sent", "provider_message_id": "re_alpha_1"}'::jsonb)
    #>> '{order,status}', 'sent', '4 the acceptance answers the order as sent');
select results_eq(
  $$select status, provider_message_id, failure_code, settled_at is not null from public.purchase_order_sends
    where id = pg_temp.send_id(1)$$,
  $$values ('sent', 're_alpha_1', null::text, true)$$, '4 the send records the provider''s id and when it was settled');
select is(pg_temp.order_status('test.order_alpha'), 'sent', '4 the order of the affaire is sent');
select is(pg_temp.pos_settle(pg_temp.send_id(1), '{"status": "sent", "provider_message_id": "re_alpha_1"}'::jsonb)
    #>> '{send,status}', 'sent', '4 the same acceptance again changes nothing');
select is(pg_temp.pos_settle(pg_temp.send_id(1), '{"status": "failed", "failure_code": "validation_error"}'::jsonb)->>'message',
  'PURCHASE_ORDER_SEND_SETTLED', '4 a sent send does not become failed');
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000001',
    replace(pg_temp.claim('test.order_alpha', 1, '0'), 'select public.begin_purchase_order_send',
      'select answer->>''state'' as state, answer->''send''->>''provider_message_id'' as provider from public.begin_purchase_order_send')
      || ' answer'),
  '[{"state": "sent", "provider": "re_alpha_1"}]'::jsonb, '4 the same request replayed answers what was sent, and sends nothing');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 3, pg_temp.revision('test.order_alpha'))),
  '55000 PURCHASE_ORDER_SEND_NOT_DRAFT', '4 a sent order is not sent again');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000004', pg_temp.claim('test.order_other', 1, pg_temp.revision('test.order_other'))),
  '23505 PURCHASE_ORDER_SEND_KEY_TAKEN', '4 the key of a send is not taken over for another tenant''s order');

-- ---------------------------------------------------------------------------
-- 8. An order of an affaire sent by e-mail is confirmed, returned to draft or canceled.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_alpha')::uuid$$), 'ok 1',
  '8 a sent order of an affaire returns to draft');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 4, pg_temp.revision('test.order_alpha'))),
  'ok 1', '8 and is sent again, with a new request');
select is(pg_temp.pos_settle(pg_temp.send_id(4), '{"status": "sent", "provider_message_id": "re_alpha_2"}'::jsonb)
    #>> '{order,status}', 'sent', '8 which the provider accepts');
select is((select count(*) from public.purchase_order_sends where purchase_order_id = current_setting('test.order_alpha')::uuid
    and status = 'sent'), 2::bigint, '8 both sends stay on the order');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  format($$select public.confirm_material_request_purchase_order(%L::uuid, %s, %L::jsonb)$$,
    current_setting('test.order_alpha'), pg_temp.revision('test.order_alpha'), jsonb_build_object(
      'ordered_on', '2026-11-12', 'expected_delivery_date', '2026-11-19', 'supplier_reference', 'AR-7781',
      'document_id', 'a9370000-0000-4000-8000-00000000d001',
      'lines', jsonb_build_array(jsonb_build_object('id', current_setting('test.item_elbows'), 'unit_price_ht_cents', 1300,
        'price_per', 1)))::text)),
  'ok 1', '8 a sent order of an affaire is confirmed with its real prices and its proof');
select results_eq(
  $$select po.status::text, po.total_ht_cents, (select unit_price_ht_cents from public.purchase_order_items
      where id = current_setting('test.item_elbows')::uuid),
      (select supplier_reference from public.purchase_order_confirmations where purchase_order_id = po.id)
    from public.purchase_orders po where po.id = current_setting('test.order_alpha')::uuid$$,
  $$values ('confirmed', 5200, 1300, 'AR-7781')$$, '8 it is confirmed at 4 × 13,00 €');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_alpha', 5, pg_temp.revision('test.order_alpha'))),
  '55000 PURCHASE_ORDER_SEND_NOT_DRAFT', '8 a confirmed order is not sent');

-- ---------------------------------------------------------------------------
-- 5. The provider refused the message: the order stays a draft.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 10, pg_temp.revision('test.order_beta'),
    '{"recipient": "achats@beta.example.test", "redirected": false}')),
  'ok 1', '5 the author claims the send of Beta''s draft');
select is(pg_temp.pos_settle(pg_temp.send_id(10), '{"status": "failed"}'::jsonb)->>'message',
  'PURCHASE_ORDER_SEND_INPUT_INVALID', '5 a refusal without its code is refused');
select is(pg_temp.pos_settle(pg_temp.send_id(10), '{"status": "failed", "failure_code": "validation_error"}'::jsonb)
    #>> '{order,status}', 'draft', '5 the refusal answers the order as a draft');
select results_eq(
  $$select status, failure_code, provider_message_id, redirected, settled_at is not null from public.purchase_order_sends
    where id = pg_temp.send_id(10)$$,
  $$values ('failed', 'validation_error', null::text, false, true)$$, '5 the send records the refusal');
select is(pg_temp.order_status('test.order_beta'), 'draft', '5 the order is still a draft');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 10, pg_temp.revision('test.order_beta'))),
  '23505 PURCHASE_ORDER_SEND_KEY_SPENT', '5 the key of a refused send is not used again');

-- ---------------------------------------------------------------------------
-- 6. A claim whose request died is named once as unconfirmed, then leaves the way free.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 11, pg_temp.revision('test.order_beta'))),
  'ok 1', '6 a new request claims Beta''s draft');
update public.purchase_order_sends set requested_at = now() - interval '2 minutes' where id = pg_temp.send_id(11);
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 12, pg_temp.revision('test.order_beta'))),
  '55006 PURCHASE_ORDER_SEND_IN_PROGRESS', '6 two minutes later it is still in flight');
update public.purchase_order_sends set requested_at = now() - interval '6 minutes' where id = pg_temp.send_id(11);
select is(pg_temp.pos_rows('a9370000-0000-4000-8000-000000000001',
    replace(pg_temp.claim('test.order_beta', 12, pg_temp.revision('test.order_beta')), 'select public.begin_purchase_order_send',
      'select answer->>''state'' as state, answer->''send''->>''id'' as id, answer->''send''->>''status'' as status from public.begin_purchase_order_send')
      || ' answer'),
  jsonb_build_array(jsonb_build_object('state', 'unconfirmed', 'id', pg_temp.send_id(11), 'status', 'unconfirmed')),
  '6 six minutes later the next request is answered that the earlier send is unconfirmed');
select results_eq(
  $$select id, status, failure_code from public.purchase_order_sends
    where purchase_order_id = current_setting('test.order_beta')::uuid and status <> 'failed' order by requested_at$$,
  $$select pg_temp.send_id(11), 'unconfirmed', 'SEND_ABANDONED'$$, '6 the dead claim is unconfirmed and nothing new is claimed');
select is(pg_temp.order_status('test.order_beta'), 'draft', '6 the order is still a draft');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_beta', 12, pg_temp.revision('test.order_beta'))),
  'ok 1', '6 asked again, the send is claimed');
select is(pg_temp.pos_settle(pg_temp.send_id(12), '{"status": "unconfirmed", "failure_code": "provider_unreachable"}'::jsonb)
    #>> '{send,status}', 'unconfirmed', '6 a send the provider did not answer is settled as unconfirmed');
select is(pg_temp.order_status('test.order_beta'), 'draft', '6 and leaves a draft');
-- The acceptance of the dead claim arrives after all: the supplier has the order as it still stands.
select is(pg_temp.pos_settle(pg_temp.send_id(11), '{"status": "sent", "provider_message_id": "re_beta_late"}'::jsonb)
    #>> '{order,status}', 'sent', '6 the late acceptance of an unconfirmed send marks the order sent');
select results_eq(
  $$select status, provider_message_id, failure_code from public.purchase_order_sends where id = pg_temp.send_id(11)$$,
  $$values ('sent', 're_beta_late', null::text)$$, '6 and the send records it');
select is(pg_temp.pos_settle(pg_temp.send_id(12), '{"status": "failed", "failure_code": "validation_error"}'::jsonb)->>'message',
  'PURCHASE_ORDER_SEND_SETTLED', '6 an unconfirmed send does not become failed');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'canceled' where id = current_setting('test.order_beta')::uuid$$), 'ok 1',
  '8 a sent order of an affaire is canceled');

-- ---------------------------------------------------------------------------
-- 9. An order without affaire is sent the same way, and keeps its free status.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_manual', 20, pg_temp.revision('test.order_manual'))),
  'ok 1', '9 the author claims the send of a manual draft');
-- ---------------------------------------------------------------------------
-- 7. A draft changed while its e-mail was leaving stays a draft: the supplier has the older content.
-- ---------------------------------------------------------------------------
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set notes = 'Envoi manuel, modifié' where id = current_setting('test.order_manual')::uuid$$),
  'ok 1', '7 the draft is changed while its e-mail is leaving');
select is(pg_temp.pos_settle(pg_temp.send_id(20), '{"status": "sent", "provider_message_id": "re_manual_1"}'::jsonb)
    #>> '{order,status}', 'draft', '7 the acceptance answers the order as still a draft');
select results_eq(
  $$select s.status, s.order_revision < po.edit_revision, po.status::text
    from public.purchase_order_sends s join public.purchase_orders po on po.id = s.purchase_order_id
    where s.id = pg_temp.send_id(20)$$,
  $$values ('sent', true, 'draft')$$, '7 the send is recorded for the revision it carried, and the changed draft stays a draft');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_manual', 21, pg_temp.revision('test.order_manual'))),
  'ok 1', '9 the changed draft is sent again');
select is(pg_temp.pos_settle(pg_temp.send_id(21), '{"status": "sent", "provider_message_id": "re_manual_2"}'::jsonb)
    #>> '{order,status}', 'sent', '9 and the manual order is sent');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_manual')::uuid$$), 'ok 1',
  '9 an order without affaire still returns to draft directly');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'sent' where id = current_setting('test.order_manual')::uuid$$), 'ok 1',
  '9 and is still marked sent by hand');
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$update public.purchase_orders set status = 'draft' where id = current_setting('test.order_manual')::uuid$$), 'ok 1',
  'fixture: back to draft');
-- A draft that holds the supplier's shipping only.
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001',
  $$select public.create_purchase_order_draft(jsonb_build_object('supplier_id', 'a9370000-0000-4000-8000-000000000301',
    'delivery_site_id', 'a9370000-0000-4000-8000-000000000801', 'notes', 'Envoi port seul'), jsonb_build_array(
    jsonb_build_object('designation', 'Port', 'quantity', 1, 'unit', 'forfait', 'unit_price_ht_cents', 1500, 'tax_rate_bp', 2000,
      'line_kind', 'shipping')))$$),
  'ok 1', 'fixture: a manual draft with a shipping line only');
select set_config('test.order_shipping', (select id::text from public.purchase_orders
  where notes = 'Envoi port seul' and tenant_id = 'a9370000-0000-4000-8000-000000000101'), true);
select is(pg_temp.pos_run('a9370000-0000-4000-8000-000000000001', pg_temp.claim('test.order_shipping', 22, pg_temp.revision('test.order_shipping'))),
  '22023 PURCHASE_ORDER_SEND_EMPTY', '2 an order without article is not sent');

select * from finish();
rollback;
