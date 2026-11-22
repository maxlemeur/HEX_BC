-- The site contacts of an affaire, printed in the instructions of its purchase orders (TI-691, lot 2 « l'achat »,
-- owner's decision of 22/11/2026). Written before the migration 20261122194343_affaire_site_contacts.sql. Failure modes
-- this file guards, with fictional members, suppliers, contacts and lines:
--  1. an affaire has no site contacts by default, or the owner cannot record them; their texts are kept untrimmed, an
--     empty role or phone is kept, or a contact without a name, with an overlong name, role or phone, with another key,
--     a list that is not an array or holds more than 20 contacts is accepted; a viewer writes them;
--  2. a draft made from a request carries the request's date and technician instead of the affaire's contacts, in
--     another order or wording; an affaire without contact gives instructions anyway; a draft already made changes when
--     the contacts change;
--  3. the new functions reach anon or authenticated, or run without a pinned search_path.
-- Every member statement goes through pg_temp.pls_run or pg_temp.pls_rows (role and JWT switched in a sub-block), so a
-- red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaire 201 and makes the orders, 2 admin, 3 viewer, 5 engineer who is not the
-- author. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9340000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'contacts-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 5) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9340000-%';
insert into public.tenants (id, name, slug) values
  ('a9340000-0000-4000-8000-000000000101', 'Contacts fixture', 'contacts-fixture'),
  ('a9340000-0000-4000-8000-000000000102', 'Contacts autre tenant', 'contacts-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9340000-0000-4000-8000-000000000102' else 'a9340000-0000-4000-8000-000000000101' end)::uuid,
  ('a9340000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' else 'engineer' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 5) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9340000-0000-4000-8000-000000000301', 'a9340000-0000-4000-8000-000000000101', 'TI691 Contacts Alpha'),
  ('a9340000-0000-4000-8000-000000000302', 'a9340000-0000-4000-8000-000000000101', 'TI691 Contacts Beta');
insert into public.products (id, tenant_id, reference, designation, unit_price_cents, product_type, material, unit) values
  ('a9340000-0000-4000-8000-000000000501', 'a9340000-0000-4000-8000-000000000101', 'CTC-501', 'TI691 Coude 90° inox DN 50',
    100, 'Coude 90°', 'Inox 304L', 'u'),
  ('a9340000-0000-4000-8000-000000000502', 'a9340000-0000-4000-8000-000000000101', 'CTC-502', 'TI691 Vis inox M6x20',
    1, 'Vis', 'Inox 304L', 'u');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9340000-0000-4000-8000-000000000201', 'a9340000-0000-4000-8000-000000000101', 'a9340000-0000-4000-8000-000000000001',
    'TI691 Affaire contacts');
insert into public.delivery_sites (id, tenant_id, name, is_active, updated_at) values
  ('a9340000-0000-4000-8000-000000000801', 'a9340000-0000-4000-8000-000000000101', 'TI691 Chantier contacts', true,
    now() - interval '1 second');
-- Request 601, needed on 20/11/2026: L1 elbows and L2 screws at Alpha, L3 sleeves at Beta.
insert into public.material_requests (id, project_id, requested_on, needed_on, delivery_place, created_by) values
  ('a9340000-0000-4000-8000-000000000601', 'a9340000-0000-4000-8000-000000000201', '2026-11-10', '2026-11-20', 'site',
    'a9340000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, no_dimension, product_type,
  material, imputation, product_id, product_match) values
  ('a9340000-0000-4000-8000-000000000701', 'a9340000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', false, 'Coude 90°',
    'Inox 304L', 'project', 'a9340000-0000-4000-8000-000000000501', 'manual'),
  ('a9340000-0000-4000-8000-000000000702', 'a9340000-0000-4000-8000-000000000601', 2, 1500, 'u', 'M6x20', false, 'Vis',
    'Inox 304L', 'project', 'a9340000-0000-4000-8000-000000000502', 'manual'),
  ('a9340000-0000-4000-8000-000000000703', 'a9340000-0000-4000-8000-000000000601', 3, 2, 'u', 'DN 40', false, 'Manchon',
    'PVC', 'project', null, null);
update public.material_request_lines set status = 'validated' where request_id = 'a9340000-0000-4000-8000-000000000601';

-- Runs one statement as a signed-in member: « ok <rows> » or « <sqlstate> <message> ».
create function pg_temp.pls_run(p_user uuid, p_sql text)
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

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message, detail when there is one }.
create function pg_temp.pls_rows(p_user uuid, p_sql text)
returns jsonb
language plpgsql
as $run$
declare
  run_result jsonb;
  error_detail text;
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute format('select coalesce(jsonb_agg(to_jsonb(answer)), ''[]''::jsonb) from (%s) answer', p_sql) into run_result;
  exception when others then
    get stacked diagnostics error_detail = pg_exception_detail;
    run_result := jsonb_strip_nulls(jsonb_build_object('error', sqlstate, 'message', sqlerrm, 'detail', nullif(error_detail, '')));
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- 1. The owner records the contacts of affaire 201.
select is((select site_contacts from public.estimate_projects where id = 'a9340000-0000-4000-8000-000000000201'),
  '[]'::jsonb, '1 an affaire has no site contact by default');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$update public.estimate_projects set site_contacts = '[
      {"name": "  Jean Fictif ", "role": " chef de chantier ", "phone": " 06 00 00 00 01 "},
      {"name": "Marie Fictive", "role": "  ", "phone": "07 00 00 00 02"},
      {"name": "Paul Fictif", "role": null}
    ]'::jsonb where id = 'a9340000-0000-4000-8000-000000000201'$$),
  'ok 1', '1 the owner records three site contacts');
select is((select site_contacts from public.estimate_projects where id = 'a9340000-0000-4000-8000-000000000201'),
  '[{"name": "Jean Fictif", "role": "chef de chantier", "phone": "06 00 00 00 01"},
    {"name": "Marie Fictive", "phone": "07 00 00 00 02"},
    {"name": "Paul Fictif"}]'::jsonb,
  '1 their texts are trimmed, an empty role or a null one dropped, their order kept');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  format($$update public.estimate_projects set site_contacts = %L::jsonb where id = 'a9340000-0000-4000-8000-000000000201'$$,
    bad.value)), '22023 AFFAIRE_SITE_CONTACTS_INVALID', '1 refused: ' || bad.label)
from (values
  ('a contact without a name', '[{"phone": "06"}]'),
  ('a blank name', '[{"name": "   "}]'),
  ('a name of 121 characters', '[{"name": "' || repeat('n', 121) || '"}]'),
  ('a role of 81 characters', '[{"name": "Jean", "role": "' || repeat('r', 81) || '"}]'),
  ('a phone of 41 characters', '[{"name": "Jean", "phone": "' || repeat('6', 41) || '"}]'),
  ('another key', '[{"name": "Jean", "email": "jean@example.test"}]'),
  ('a number as phone', '[{"name": "Jean", "phone": 600000001}]'),
  ('a contact that is not an object', '["Jean"]')
) as bad(label, value);
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$update public.estimate_projects set site_contacts = '{"name": "Jean"}'::jsonb
    where id = 'a9340000-0000-4000-8000-000000000201'$$),
  '22023 AFFAIRE_SITE_CONTACTS_INVALID', '1 refused: a list that is not an array');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  format($$update public.estimate_projects set site_contacts = %L::jsonb where id = 'a9340000-0000-4000-8000-000000000201'$$,
    (select jsonb_agg(jsonb_build_object('name', 'Contact ' || n)) from generate_series(1, 21) n))),
  '22023 AFFAIRE_SITE_CONTACTS_INVALID', '1 refused: 21 contacts');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000003',
  $$update public.estimate_projects set site_contacts = '[]'::jsonb where id = 'a9340000-0000-4000-8000-000000000201'$$),
  'ok 0', '1 a viewer changes nothing');
select is(jsonb_array_length((select site_contacts from public.estimate_projects
  where id = 'a9340000-0000-4000-8000-000000000201')), 3, '1 the refusals wrote nothing');

-- 2. Drafts made from request 601 carry them; Alpha's quote is retained for L1 and L2, Beta's for L3.
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9340000-0000-4000-8000-000000000601', 'a9340000-0000-4000-8000-000000000301',
    false, 'Bonjour', array['a9340000-0000-4000-8000-000000000701', 'a9340000-0000-4000-8000-000000000702']::uuid[])$$),
  'ok 1', 'fixture: the owner asks Alpha for L1 and L2');
select set_config('test.quote_alpha', (select id::text from public.material_request_quotes
  where request_id = 'a9340000-0000-4000-8000-000000000601'), true);
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.quote_alpha')::uuid, jsonb_build_object('received', true,
    'lines', jsonb_build_array(
      jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000701', 'unit_price_ht_cents', 1234),
      jsonb_build_object('line_id', 'a9340000-0000-4000-8000-000000000702', 'unit_price_ht_cents', 340, 'price_per', 100))))$$),
  'ok 1', 'fixture: Alpha answers');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.quote_alpha')::uuid)$$), 'ok 0',
  'fixture: Alpha is retained');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$select public.create_material_request_purchase_orders('a9340000-0000-4000-8000-000000000601',
    'a9340000-0000-4000-8000-00000000a001')$$), 'ok 1', 'fixture: the owner makes the draft');
select is((select notes from public.purchase_orders where project_id = 'a9340000-0000-4000-8000-000000000201'),
  'Contacts sur site : Jean Fictif (chef de chantier) : 06 00 00 00 01 ; Marie Fictive : 07 00 00 00 02 ; Paul Fictif',
  '2 the draft''s instructions name the affaire''s site contacts, in their order, not the request');
select is(pg_temp.pls_run('a9340000-0000-4000-8000-000000000001',
  $$update public.estimate_projects set site_contacts = '[{"name": "Lucie Fictive", "phone": "06 00 00 00 03"}]'::jsonb
    where id = 'a9340000-0000-4000-8000-000000000201'$$), 'ok 1', 'fixture: the contacts change');
select is((select notes from public.purchase_orders where project_id = 'a9340000-0000-4000-8000-000000000201'),
  'Contacts sur site : Jean Fictif (chef de chantier) : 06 00 00 00 01 ; Marie Fictive : 07 00 00 00 02 ; Paul Fictif',
  '2 a draft already made keeps its instructions');
select is(private.affaire_site_contacts_text('[{"name": "Lucie Fictive", "phone": "06 00 00 00 03"}]'::jsonb),
  'Contact sur site : Lucie Fictive : 06 00 00 00 03', '2 one contact is said in the singular');
select is(private.affaire_site_contacts_text('[]'::jsonb), null::text, '2 no contact, no instructions');

-- 3. Rights and shape of the new functions.
select ok((select bool_and(not has_function_privilege(role_name, p.oid, 'EXECUTE')
    and p.proconfig @> array['search_path=""'])
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join (values ('anon'), ('authenticated')) roles(role_name)
  where n.nspname = 'private' and p.proname in ('normalize_affaire_site_contacts', 'affaire_site_contacts_text')),
  '3 the new functions reach neither anon nor authenticated and pin their search_path');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname in ('normalize_affaire_site_contacts', 'affaire_site_contacts_text')), 2,
  '3 both exist');

select * from finish();
rollback;
