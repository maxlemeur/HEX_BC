-- Consulting suppliers for a material request (TI-691, lot 2 « l'achat », delivery 2 « consultation »). Written with
-- the migration 20261112173255_material_request_quotes.sql. Failure modes this file guards, with fictional members,
-- suppliers and lines:
--  1. a quote table is readable without RLS, a client deletes a quote (closed quotes must stay readable) or anon
--     reaches a table or a function; a write function bypasses RLS (security definer); the bucket refuses a PDF;
--  2. a quote takes its tenant, affaire, status or dates from the client, names a supplier of another tenant, or
--     starts elsewhere than « requested »; its message exceeds 262 144 characters (300 lines at their field limits,
--     about 861 characters each, are copied in it), or a message of 300 such lines is refused;
--  3. a supplier gets a second quote on a request while one is requested or received, or a retained or closed one
--     keeps the supplier from being consulted again (lines added later go to the same supplier);
--  4. a quote asks for a line of another request, the same line twice or no line, or is left without its lines when
--     one of them is refused (creation is not all or nothing);
--  5. a viewer, a director, an engineer who does not own the affaire or a member of another tenant creates, prices,
--     closes or retains a quote, or the readers (owner, admin, director) cannot read the quotes and their lines;
--  6. update_material_request_quote: a line the quote does not ask for is priced, a batch with one bad line writes
--     the others, a fraction of a cent is rounded, an unknown key (the status) is accepted, a key left out is
--     cleared, receiving does not date the quote; a price quantity other than 1, 10, 100 or 1 000 units is accepted,
--     or a price is not kept with its quantity (0,034 € a screw is 340 cents for 100);
--  7. a requested quote is retained, a quote is retained by a direct write (its lines left unpriced, its
--     competitors open), the message, supplier or request of a quote changes, a client dates a reception;
--  8. retain_material_request_quote: a requested, closed or retained quote, one without lines or with an unpriced
--     line is retained (and the refusal does not name the lines); the lines do not take the quote's supplier, price
--     and id and price quantity; a validated line returns to draft or loses its stamps; a quote sharing a line is
--     left open, one sharing
--     none is closed; the answer does not name what was closed;
--  9. a retained or closed quote, or its lines, change, are reopened or take a new line; closing by hand does not
--     date the quote; closed quotes are no longer readable; a writer adds a line to an existing quote directly
--     (only create_material_request_quote writes the lines of a quote);
-- 10. the price, price quantity or quote of a line is written by hand (owner or server writer), a line is created
--     priced, a priced line changes supplier or is deleted alone, or changes what it orders and keeps the price (its
--     article, type, dimension, material, precision, reference, unit or quantity: DN 50 priced, then DN 65 ordered
--     at the DN 50 price), or its other columns (zone, imputation...) can no longer be edited;
-- 11. a line already priced by a retained quote is consulted again;
-- 12. an original of the request is a PDF; a quote's file answers a quote of another request, or a retained or
--     closed quote; a quote keeps more than ten listed files, or its files take the places of the request's twelve
--     originals; a PDF of an open quote cannot be stored;
-- 13. the files of a retained or closed quote change: a file prepared while it was open is completed after the
--     retaining, a listed file is withdrawn, turned or deleted; or a file attached by mistake to an open quote cannot
--     be removed, an unstored leftover of a retained quote cannot be cleaned, or the request's deletion cannot
--     withdraw them (withdraw_material_request_files_for_deletion, for writers only);
-- 14. deleting a quote (service role) leaves its price on the lines; deleting a request with priced lines fails, or
--     leaves its quotes behind.
-- 15. (Codex review of #279) a project line without a material of its own, quoted in the request's presumed material,
--     is retained with no material: changing and confirming the header material afterwards turns a line priced for
--     Inox into Cuivre at its Inox price; or a quote is retained while that presumed material is not confirmed; or an
--     overhead line takes the request's material; or a validated line returns to draft when its material is written.
-- 16. (Codex review of #279) a quote whose lines are not all validated (a quantity, unit, type or dimension may still
--     be missing) is retained, which would freeze them incomplete for good while validation keeps refusing them; or a
--     priced line, reopened to draft, cannot be validated again (its frozen fields are complete), or its price moves.
-- Every member statement goes through pg_temp.pls_run, pg_temp.pls_rows or pg_temp.pls_detail (role and JWT switched
-- in a sub-block), so a red assertion fails on its own reason and the file runs to the end. Fixtures are rolled back.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Tenant 101: 1 engineer who owns affaires 201 and 203's request, 2 admin, 3 viewer, 5 engineer who owns affaire 202,
-- 6 director. Member 4 is the admin of tenant 102 only.
insert into auth.users (id, email, raw_user_meta_data)
select ('a9300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'consultation-' || n || '@example.test', '{}'::jsonb
from generate_series(1, 6) n;
update public.tenant_memberships set is_default = false where user_id::text like 'a9300000-%';
insert into public.tenants (id, name, slug) values
  ('a9300000-0000-4000-8000-000000000101', 'Consultation fixture', 'consultation-fixture'),
  ('a9300000-0000-4000-8000-000000000102', 'Consultation autre tenant', 'consultation-autre-tenant');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
select (case when n = 4 then 'a9300000-0000-4000-8000-000000000102' else 'a9300000-0000-4000-8000-000000000101' end)::uuid,
  ('a9300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'viewer' when 4 then 'admin' when 5 then 'engineer'
    else 'director' end)::public.tenant_role,
  true, '2020-01-01'
from generate_series(1, 6) n;

insert into public.suppliers (id, tenant_id, name) values
  ('a9300000-0000-4000-8000-000000000301', 'a9300000-0000-4000-8000-000000000101', 'TI691 Fournisseur Alpha'),
  ('a9300000-0000-4000-8000-000000000302', 'a9300000-0000-4000-8000-000000000101', 'TI691 Fournisseur Beta'),
  ('a9300000-0000-4000-8000-000000000303', 'a9300000-0000-4000-8000-000000000101', 'TI691 Fournisseur Gamma'),
  ('a9300000-0000-4000-8000-000000000304', 'a9300000-0000-4000-8000-000000000101', 'TI691 Fournisseur Delta'),
  ('a9300000-0000-4000-8000-000000000305', 'a9300000-0000-4000-8000-000000000101', 'TI691 Fournisseur Epsilon'),
  ('a9300000-0000-4000-8000-000000000309', 'a9300000-0000-4000-8000-000000000102', 'TI691 Fournisseur d''ailleurs');
insert into public.products (id, tenant_id, designation, unit_price_cents, product_type, material, unit) values
  ('a9300000-0000-4000-8000-000000000501', 'a9300000-0000-4000-8000-000000000101', 'TI691 Coude 90° inox DN 65', 100,
    'Coude 90°', 'Inox 304L', 'u');
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('a9300000-0000-4000-8000-000000000201', 'a9300000-0000-4000-8000-000000000101', 'a9300000-0000-4000-8000-000000000001',
    'TI691 Affaire consultée'),
  ('a9300000-0000-4000-8000-000000000202', 'a9300000-0000-4000-8000-000000000101', 'a9300000-0000-4000-8000-000000000005',
    'TI691 Affaire d''un autre ingénieur');
insert into public.material_requests (id, project_id, created_by) values
  ('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000201', 'a9300000-0000-4000-8000-000000000001'),
  ('a9300000-0000-4000-8000-000000000602', 'a9300000-0000-4000-8000-000000000202', 'a9300000-0000-4000-8000-000000000005'),
  ('a9300000-0000-4000-8000-000000000603', 'a9300000-0000-4000-8000-000000000201', 'a9300000-0000-4000-8000-000000000001');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material) values
  ('a9300000-0000-4000-8000-000000000701', 'a9300000-0000-4000-8000-000000000601', 1, 4, 'u', 'DN 50', 'Coude 90°', 'Inox 304L'),
  ('a9300000-0000-4000-8000-000000000702', 'a9300000-0000-4000-8000-000000000601', 2, 2, 'u', 'DN 50', 'Té égal', 'Inox 304L'),
  ('a9300000-0000-4000-8000-000000000703', 'a9300000-0000-4000-8000-000000000601', 3, 6, 'm', 'DN 50', 'Tube', 'Inox 304L'),
  ('a9300000-0000-4000-8000-000000000704', 'a9300000-0000-4000-8000-000000000602', 1, 1, 'u', 'DN 80', 'Vanne', 'Fonte'),
  ('a9300000-0000-4000-8000-000000000705', 'a9300000-0000-4000-8000-000000000603', 1, 3, 'u', 'DN 32', 'Manchon', 'PVC');

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

-- Runs one query as a signed-in member: its rows as a JSON array, or { error, message }.
create function pg_temp.pls_rows(p_user uuid, p_sql text)
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

-- Runs one statement as a signed-in member: the DETAIL of its refusal, or « passed ».
create function pg_temp.pls_detail(p_user uuid, p_sql text)
returns text
language plpgsql
as $run$
declare
  run_result text := 'passed';
begin
  begin
    execute 'set local role authenticated';
    perform set_config('request.jwt.claim.sub', p_user::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    execute p_sql;
  exception when others then
    get stacked diagnostics run_result = pg_exception_detail;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  return run_result;
end;
$run$;

-- The quote of a supplier on a request still in progress: the one the next assertions name.
create function pg_temp.open_quote(p_request uuid, p_supplier uuid)
returns uuid
language sql
as $$
  select id from public.material_request_quotes
  where request_id = p_request and supplier_id = p_supplier and status in ('requested', 'received');
$$;

-- The owner validates line 1, which keeps its stamps through the whole consultation.
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  'ok 1', 'fixture: the engineer who owns the affaire validates line 1');
select set_config('test.validated_at',
  (select validated_at::text from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000701'), true);

-- ---------------------------------------------------------------------------
-- 1. Structure and grants.
-- ---------------------------------------------------------------------------
select ok((select bool_and(relrowsecurity and relforcerowsecurity) from pg_class
  where oid in ('public.material_request_quotes'::regclass, 'public.material_request_quote_lines'::regclass)),
  '1 both quote tables force row level security');
select is(has_table_privilege('authenticated', 'public.material_request_quotes', 'DELETE'), false,
  '1 a client cannot delete a quote: it is closed, and stays readable');
select is(has_table_privilege('authenticated', 'public.material_request_quote_lines', 'DELETE'), false,
  '1 nor the lines of a quote');
select ok(not has_table_privilege('anon', 'public.material_request_quotes', 'SELECT')
    and not has_table_privilege('anon', 'public.material_request_quote_lines', 'SELECT'),
  '1 an anonymous caller reads no quote');
select ok(not has_function_privilege('anon', 'public.create_material_request_quote(uuid, uuid, boolean, text, uuid[])', 'EXECUTE')
    and not has_function_privilege('anon', 'public.update_material_request_quote(uuid, jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.retain_material_request_quote(uuid)', 'EXECUTE'),
  '1 an anonymous caller calls none of the quote functions');
select ok((select bool_and(not prosecdef) from pg_proc where oid in (
    'public.create_material_request_quote(uuid, uuid, boolean, text, uuid[])'::regprocedure,
    'public.update_material_request_quote(uuid, jsonb)'::regprocedure,
    'public.retain_material_request_quote(uuid)'::regprocedure)),
  '1 the quote functions run as the caller: RLS decides who writes');
select ok((select not public and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  from storage.buckets where id = 'material-requests'), '1 the private bucket now accepts the PDF of a quote');

-- ---------------------------------------------------------------------------
-- 2. What a quote is made of.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301',
    true, 'Bonjour, pouvez-vous chiffrer : 4 coudes 90° inox DN 50 (réf. CO-50), 2 tés égaux inox DN 50 (réf. TE-50) ?',
    array['a9300000-0000-4000-8000-000000000702', 'a9300000-0000-4000-8000-000000000701']::uuid[])$$),
  'ok 1', '2 the owner records the quote asked of Alpha for lines 1 and 2, with references');
select set_config('test.alpha', pg_temp.open_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301')::text, true);
select ok((select tenant_id = 'a9300000-0000-4000-8000-000000000101' and project_id = 'a9300000-0000-4000-8000-000000000201'
    and status = 'requested' and with_references and created_by = 'a9300000-0000-4000-8000-000000000001'
    and requested_at is not null and received_at is null and amount_ht_cents is null
  from public.material_request_quotes where id = current_setting('test.alpha')::uuid),
  '2 tenant and affaire come from the request, the quote starts requested, its author is the caller');
select is((select array_agg(line_id order by line_id) from public.material_request_quote_lines
    where quote_id = current_setting('test.alpha')::uuid),
  array['a9300000-0000-4000-8000-000000000701', 'a9300000-0000-4000-8000-000000000702']::uuid[], '2 it asks for the lines named');
select ok((select bool_and(tenant_id = 'a9300000-0000-4000-8000-000000000101' and project_id = 'a9300000-0000-4000-8000-000000000201'
    and unit_price_ht_cents is null)
  from public.material_request_quote_lines where quote_id = current_setting('test.alpha')::uuid),
  '2 its lines take the quote''s tenant and affaire, unpriced');
select throws_ok($$insert into public.material_request_quotes (request_id, supplier_id, with_references, message)
    values ('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000309', false, 'Bonjour')$$,
  '23514', 'MATERIAL_REQUEST_TENANT_MISMATCH', '2 a supplier of another tenant is refused, even for a server writer');
select lives_ok($$insert into public.material_request_quotes (id, tenant_id, project_id, request_id, supplier_id,
    with_references, message, requested_at)
  values ('a9300000-0000-4000-8000-000000000801', 'a9300000-0000-4000-8000-000000000102', 'a9300000-0000-4000-8000-000000000202',
    'a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000303', false, 'Bonjour Gamma', '2000-01-01')$$,
  '2 a server writer records a quote of Gamma with a forged tenant, affaire and date');
select ok((select tenant_id = 'a9300000-0000-4000-8000-000000000101' and project_id = 'a9300000-0000-4000-8000-000000000201'
    and requested_at > '2001-01-01'
  from public.material_request_quotes where id = 'a9300000-0000-4000-8000-000000000801'),
  '2 the trigger replaces them with the request''s and the database''s');
select throws_ok($$insert into public.material_request_quotes (request_id, supplier_id, with_references, message, status)
    values ('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000304', false, 'Bonjour', 'received')$$,
  '23514', 'MATERIAL_REQUEST_QUOTE_STATUS_INVALID', '2 a quote starts requested');
select throws_ok($$insert into public.material_request_quotes (request_id, supplier_id, with_references, message)
    values ('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000304', false, repeat('x', 262145))$$,
  '23514', null, '2 the message holds 262 144 characters at most');
select lives_ok($$insert into public.material_request_quotes (request_id, supplier_id, with_references, message)
    values ('a9300000-0000-4000-8000-000000000602', 'a9300000-0000-4000-8000-000000000304', false,
      (select string_agg('- 999999,999 ' || repeat('u', 20) || ' ' || repeat('d', 500) || ', ' || repeat('n', 80) || ', '
        || repeat('m', 120) || ', ' || repeat('p', 120), chr(10)) from generate_series(1, 300)) || chr(10) || repeat('a', 2000))$$,
  '2 a message of 300 lines at their field limits, and a long affaire name, is kept');
delete from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000602';

-- ---------------------------------------------------------------------------
-- 3. One quote in progress (requested or received) per supplier and request.
-- ---------------------------------------------------------------------------
select matches(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301',
    false, 'Bonjour, encore une question', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '^23505 .*material_request_quotes_open_supplier_key', '3 Alpha is not consulted twice on a request while its quote is open');
select is((select count(*) from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000601'
    and supplier_id = 'a9300000-0000-4000-8000-000000000301'), 1::bigint, '3 and nothing of the second quote is written');

-- ---------------------------------------------------------------------------
-- 4. The lines of a quote.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000702', 'a9300000-0000-4000-8000-000000000704']::uuid[])$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_REQUEST', '4 an admin cannot ask a quote for a line of another request');
select is((select count(*) from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000601'
    and supplier_id = 'a9300000-0000-4000-8000-000000000302'), 0::bigint, '4 all or nothing: no quote is left without its lines');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000702', 'a9300000-0000-4000-8000-000000000702']::uuid[])$$),
  '22023 MATERIAL_REQUEST_QUOTE_LINES_INVALID', '4 a line is named once');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour', array[]::uuid[])$$),
  '22023 MATERIAL_REQUEST_QUOTE_LINES_INVALID', '4 a quote asks for one line at least');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour, prix pour 2 tés égaux inox 304L DN 50 et 6 m de tube inox 304L DN 50 ?',
    array['a9300000-0000-4000-8000-000000000703', 'a9300000-0000-4000-8000-000000000702']::uuid[])$$),
  'ok 1', '4 an admin records the competing quote of Beta for lines 2 and 3, without references');
select set_config('test.beta', pg_temp.open_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302')::text, true);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000304',
    false, 'Bonjour, prix pour 6 m de tube inox 304L DN 50 ?', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', '4 and the owner one of Delta for line 3 only');
select set_config('test.delta', pg_temp.open_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000304')::text, true);

-- ---------------------------------------------------------------------------
-- 5. Who reads and who writes.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000006',
  $$select (select count(*) from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000601') as quotes,
    (select count(*) from public.material_request_quote_lines where project_id = 'a9300000-0000-4000-8000-000000000201') as lines$$),
  '[{"quotes": 4, "lines": 5}]'::jsonb, '5 a director reads every quote of the affaire and their lines');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000003',
  $$select (select count(*) from public.material_request_quotes) as quotes, (select count(*) from public.material_request_quote_lines) as lines$$),
  '[{"quotes": 0, "lines": 0}]'::jsonb, '5 a viewer reads none');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000005',
  $$select (select count(*) from public.material_request_quotes) as quotes, (select count(*) from public.material_request_quote_lines) as lines$$),
  '[{"quotes": 0, "lines": 0}]'::jsonb, '5 nor an engineer who does not own the affaire');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000004',
  $$select (select count(*) from public.material_request_quotes) as quotes, (select count(*) from public.material_request_quote_lines) as lines$$),
  '[{"quotes": 0, "lines": 0}]'::jsonb, '5 nor a member of another tenant');
select matches(pg_temp.pls_run('a9300000-0000-4000-8000-000000000006',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000305',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '^42501 new row violates row-level security policy', '5 a director cannot record a quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000003',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000305',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '23514 MATERIAL_REQUEST_NOT_FOUND', '5 nor a viewer, who cannot read the request');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000005',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000305',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '23514 MATERIAL_REQUEST_NOT_FOUND', '5 nor an engineer who does not own the affaire');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000004',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000305',
    false, 'Bonjour', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '23514 MATERIAL_REQUEST_NOT_FOUND', '5 nor a member of another tenant');
select is((select count(*) from public.material_request_quotes where supplier_id = 'a9300000-0000-4000-8000-000000000305'),
  0::bigint, '5 none of them wrote a quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000006',
  $$update public.material_request_quotes set status = 'closed' where id = current_setting('test.delta')::uuid$$),
  'ok 0', '5 a director does not close a quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000004',
  $$update public.material_request_quotes set status = 'closed' where request_id = 'a9300000-0000-4000-8000-000000000601'$$),
  'ok 0', '5 nor does a member of another tenant');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000006',
  $$update public.material_request_quote_lines set unit_price_ht_cents = 1 where quote_id = current_setting('test.delta')::uuid$$),
  'ok 0', '5 a director does not price the lines of a quote directly');
set local role anon;
select throws_ok($$select count(*) from public.material_request_quotes$$, '42501', null, '5 an anonymous caller cannot read quotes');
select throws_ok($$select count(*) from public.material_request_quote_lines$$, '42501', null, '5 nor the lines of a quote');
reset role;

-- ---------------------------------------------------------------------------
-- 6. Prices, total, notes and reception.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid,
    '{"lines": [{"line_id": "a9300000-0000-4000-8000-000000000701", "unit_price_ht_cents": 1250}], "notes": "Délai 48 h"}')$$),
  'ok 1', '6 the owner prices line 1 of the requested quote and notes the delay');
select is((select jsonb_build_object('status', q.status, 'notes', q.notes, 'amount', q.amount_ht_cents,
    'prices', (select jsonb_agg(jsonb_build_array(ql.line_id, ql.unit_price_ht_cents) order by ql.line_id)
      from public.material_request_quote_lines ql where ql.quote_id = q.id))
  from public.material_request_quotes q where q.id = current_setting('test.alpha')::uuid),
  jsonb_build_object('status', 'requested', 'notes', 'Délai 48 h', 'amount', null, 'prices', jsonb_build_array(
    jsonb_build_array('a9300000-0000-4000-8000-000000000701', 1250), jsonb_build_array('a9300000-0000-4000-8000-000000000702', null))),
  '6 only what was sent changed: the quote stays requested, line 2 unpriced, the total untouched');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid,
    '{"lines": [{"line_id": "a9300000-0000-4000-8000-000000000702", "unit_price_ht_cents": 3400},
      {"line_id": "a9300000-0000-4000-8000-000000000703", "unit_price_ht_cents": 900}]}')$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINE_NOT_IN_QUOTE', '6 a line the quote does not ask for is not priced');
select is((select unit_price_ht_cents from public.material_request_quote_lines
    where quote_id = current_setting('test.alpha')::uuid and line_id = 'a9300000-0000-4000-8000-000000000702'),
  null::integer, '6 all or nothing: the good line of that batch is not priced either');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid, '{"amount_ht_cents": 1250.5}')$$),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '6 a fraction of a cent is refused, not rounded');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid, '{"status": "retained"}')$$),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '6 the status is not one of its keys');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid, '{"received": false}')$$),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '6 received is only ever true');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000006',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid, '{"notes": "Vu"}')$$),
  '42501 MATERIAL_REQUEST_QUOTE_WRITERS_ONLY', '6 a director reads the quote but does not change it');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000004',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid, '{"notes": "Vu"}')$$),
  'P0002 MATERIAL_REQUEST_QUOTE_NOT_FOUND', '6 a member of another tenant does not find it');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid,
    '{"lines": [{"line_id": "a9300000-0000-4000-8000-000000000702", "unit_price_ht_cents": 3400, "price_per": 7}]}')$$),
  '22023 MATERIAL_REQUEST_QUOTE_CHANGES_INVALID', '6 a price is for 1, 10, 100 or 1 000 units, nothing else');
select is((select price_per from public.material_request_quote_lines
    where quote_id = current_setting('test.alpha')::uuid and line_id = 'a9300000-0000-4000-8000-000000000701'),
  1, '6 a price is for one unit unless told otherwise');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.alpha')::uuid,
    '{"received": true, "amount_ht_cents": 11800,
      "lines": [{"line_id": "a9300000-0000-4000-8000-000000000702", "unit_price_ht_cents": 340, "price_per": 100}]}')$$),
  'ok 1', '6 the owner records Alpha''s answer: received, line 2 at 3,40 € for 100, with its total');
select is((select jsonb_agg(jsonb_build_array(ql.line_id, ql.unit_price_ht_cents, ql.price_per) order by ql.line_id)
    from public.material_request_quote_lines ql where ql.quote_id = current_setting('test.alpha')::uuid),
  jsonb_build_array(jsonb_build_array('a9300000-0000-4000-8000-000000000701', 1250, 1),
    jsonb_build_array('a9300000-0000-4000-8000-000000000702', 340, 100)),
  '6 each price keeps its quantity; a line whose quantity was not sent keeps its own');
select ok((select status = 'received' and received_at is not null and amount_ht_cents = 11800 and notes = 'Délai 48 h'
  from public.material_request_quotes where id = current_setting('test.alpha')::uuid),
  '6 the database dates the reception; the notes left out are kept');

-- ---------------------------------------------------------------------------
-- 7. Transitions held by the database.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set status = 'retained' where id = current_setting('test.delta')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_STATUS_INVALID', '7 a requested quote is not retained');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set status = 'retained' where id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_RETAIN_THROUGH_FUNCTION',
  '7 a received quote is not retained by a direct write, which would leave its lines unpriced and its competitors open');
select throws_ok($$update public.material_request_quotes set status = 'retained' where id = current_setting('test.alpha')::uuid$$,
  '23514', 'MATERIAL_REQUEST_QUOTE_RETAIN_THROUGH_FUNCTION', '7 nor by a server writer');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set message = 'Autre message' where id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_IMMUTABLE', '7 the message as copied never changes');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set supplier_id = 'a9300000-0000-4000-8000-000000000303'
    where id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_IMMUTABLE', '7 nor the supplier asked');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$update public.material_request_quotes set status = 'received', received_at = '2000-01-01'
    where id = current_setting('test.beta')::uuid$$),
  'ok 1', '7 an admin marks Beta received, naming a date');
select ok((select received_at > '2001-01-01' from public.material_request_quotes where id = current_setting('test.beta')::uuid),
  '7 the date of a reception is the database''s');

-- ---------------------------------------------------------------------------
-- 8. Retaining one quote.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.update_material_request_quote(current_setting('test.beta')::uuid,
    '{"lines": [{"line_id": "a9300000-0000-4000-8000-000000000702", "unit_price_ht_cents": 3300}]}')$$),
  'ok 1', '8 the admin prices line 2 of Beta, not line 3');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select * from public.retain_material_request_quote(current_setting('test.beta')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINES_UNPRICED', '8 a quote with an unpriced line is not retained');
select is(pg_temp.pls_detail('a9300000-0000-4000-8000-000000000002',
  $$select * from public.retain_material_request_quote(current_setting('test.beta')::uuid)$$),
  '[3]', '8 the refusal names the unpriced line by its number');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.delta')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_NOT_RECEIVED', '8 a requested quote is not retained');
update public.material_request_quotes set status = 'received' where id = 'a9300000-0000-4000-8000-000000000801';
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote('a9300000-0000-4000-8000-000000000801')$$),
  '23514 MATERIAL_REQUEST_QUOTE_WITHOUT_LINES', '8 nor a quote that asks for no line');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000006',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  '42501 MATERIAL_REQUEST_QUOTE_WRITERS_ONLY', '8 a director cannot retain a quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000005',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  'P0002 MATERIAL_REQUEST_QUOTE_NOT_FOUND', '8 nor an engineer who does not own the affaire');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000004',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  'P0002 MATERIAL_REQUEST_QUOTE_NOT_FOUND', '8 nor a member of another tenant');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED', '16 a quote is not retained while one of its lines is a draft');
select is(pg_temp.pls_detail('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  '[2]', '16 the refusal names the draft line by its number');
select is((select status from public.material_request_quotes where id = current_setting('test.alpha')::uuid),
  'received', '16 nothing was retained');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000702'$$),
  'ok 1', '16 the owner validates line 2');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000001',
  $$select closed_quote_id from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  jsonb_build_array(jsonb_build_object('closed_quote_id', current_setting('test.beta'))),
  '8 the owner retains Alpha once its lines are validated: Beta, which shares line 2 with it, is closed and named');
select ok((select status = 'retained' and retained_at is not null and retained_by = 'a9300000-0000-4000-8000-000000000001'
    and received_at is not null and closed_at is null
  from public.material_request_quotes where id = current_setting('test.alpha')::uuid),
  '8 Alpha is retained, dated and signed by the database');
select is((select jsonb_agg(jsonb_build_array(position, supplier_id, unit_price_ht_cents, price_per, price_quote_id::text)
      order by position)
    from public.material_request_lines where request_id = 'a9300000-0000-4000-8000-000000000601'),
  jsonb_build_array(
    jsonb_build_array(1, 'a9300000-0000-4000-8000-000000000301', 1250, 1, current_setting('test.alpha')),
    jsonb_build_array(2, 'a9300000-0000-4000-8000-000000000301', 340, 100, current_setting('test.alpha')),
    jsonb_build_array(3, null, null, 1, null)),
  '8 lines 1 and 2 take Alpha''s supplier, their price with its quantity, and Alpha; line 3 is untouched');
select ok((select status = 'validated' and validated_by = 'a9300000-0000-4000-8000-000000000001'
    and validated_at = current_setting('test.validated_at')::timestamptz
  from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000701'),
  '8 the validated line stays validated, with its author and date');
select ok((select status = 'closed' and closed_at is not null and retained_at is null
  from public.material_request_quotes where id = current_setting('test.beta')::uuid), '8 Beta is closed and dated');
select ok((select status = 'requested' from public.material_request_quotes where id = current_setting('test.delta')::uuid),
  '8 Delta, which shares no line with Alpha, stays open');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select * from public.retain_material_request_quote(current_setting('test.beta')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_NOT_RECEIVED', '8 a closed quote is not retained afterwards');
select is(pg_temp.pls_detail('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.alpha')::uuid)$$),
  'retained', '8 nor a retained one again, and the refusal says why');

-- ---------------------------------------------------------------------------
-- 9. Retained and closed quotes are read-only.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set notes = 'Après coup' where id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 a retained quote is read-only');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quotes set status = 'closed' where id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 it is neither closed nor reopened afterwards');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$update public.material_request_quotes set status = 'received' where id = current_setting('test.beta')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 a closed quote is not reopened');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$select public.update_material_request_quote(current_setting('test.beta')::uuid, '{"notes": "Trop tard"}')$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 nor changed through the function');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$update public.material_request_quote_lines set unit_price_ht_cents = 1 where quote_id = current_setting('test.beta')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 the lines of a closed quote are fixed');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_quote_lines set unit_price_ht_cents = 1 where quote_id = current_setting('test.alpha')::uuid$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 so are those of a retained quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into public.material_request_quote_lines (quote_id, line_id)
    values (current_setting('test.alpha')::uuid, 'a9300000-0000-4000-8000-000000000703')$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '9 a retained quote asks for no new line');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into public.material_request_quote_lines (quote_id, line_id)
    values ('a9300000-0000-4000-8000-000000000801', 'a9300000-0000-4000-8000-000000000703')$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINES_THROUGH_FUNCTION',
  '9 nor does a quote in progress take a line written directly: only its creation writes its lines');
select throws_ok($$insert into public.material_request_quote_lines (quote_id, line_id)
    values ('a9300000-0000-4000-8000-000000000801', 'a9300000-0000-4000-8000-000000000703')$$,
  '23514', 'MATERIAL_REQUEST_QUOTE_LINES_THROUGH_FUNCTION', '9 not even by a server writer');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000002',
  $$update public.material_request_quotes set status = 'closed' where id = current_setting('test.delta')::uuid$$),
  'ok 1', '9 an admin closes Delta by hand');
select ok((select status = 'closed' and closed_at is not null and received_at is null
  from public.material_request_quotes where id = current_setting('test.delta')::uuid), '9 the database dates the closing');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000006',
  $$select status from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000601' order by status$$),
  '[{"status": "closed"}, {"status": "closed"}, {"status": "received"}, {"status": "retained"}]'::jsonb,
  '9 closed quotes stay readable');

-- ---------------------------------------------------------------------------
-- 10. The price of a line is its retained quote's, and only the retaining writes it.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set unit_price_ht_cents = 1000 where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 the price of a priced line is not changed by hand');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set unit_price_ht_cents = 900, price_quote_id = current_setting('test.beta')::uuid
    where id = 'a9300000-0000-4000-8000-000000000703'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 a line is not priced by hand, even naming a quote');
select throws_ok($$update public.material_request_lines set unit_price_ht_cents = null, price_quote_id = null
    where id = 'a9300000-0000-4000-8000-000000000701'$$,
  '23514', 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 nor unpriced, even by a server writer');
select throws_ok($$insert into public.material_request_lines (request_id, position, unit_price_ht_cents, price_quote_id)
    values ('a9300000-0000-4000-8000-000000000601', 9, 100, current_setting('test.alpha')::uuid)$$,
  '23514', 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 a line is never created priced');
select throws_ok($$insert into public.material_request_lines (request_id, position, price_per)
    values ('a9300000-0000-4000-8000-000000000601', 9, 100)$$,
  '23514', 'MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 nor with a price quantity');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set price_per = 1000 where id = 'a9300000-0000-4000-8000-000000000702'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICE_FROM_QUOTE_ONLY', '10 the price quantity of a priced line is not changed by hand');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set supplier_id = 'a9300000-0000-4000-8000-000000000302'
    where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_SUPPLIER_FROM_QUOTE', '10 a priced line keeps the supplier of its quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set dimension = 'DN 65' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its dimension (DN 50 priced, DN 65 ordered)');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set no_dimension = true where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: whether it has a dimension');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set quantity = 40 where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its quantity');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set unit = 'm' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its unit');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set product_type = 'Coude 45°' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its type');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set material = 'Inox 316L' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its material');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set material_precision = 'PN16' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its precision');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set reference = 'CO-65' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its reference');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set product_id = 'a9300000-0000-4000-8000-000000000501', product_match = 'manual' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line keeps what its quote priced: its article');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set zone = 'R+1', imputation = 'overhead', overhead_category = 'Atelier',
    original_text = '2 tés DN 50', quantity_doubtful = true where id = 'a9300000-0000-4000-8000-000000000702'$$),
  'ok 1', '10 counterexample: its zone, imputation, the technician''s words and the doubt are still edited');
select ok((select dimension = 'DN 50' and quantity = 4 and status = 'validated' and unit_price_ht_cents = 1250
  from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000701'),
  '10 line 1 still orders what Alpha priced, validated, at Alpha''s price');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'draft' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  'ok 1', '16 a priced line can be reopened to draft (lines/reopen): its status is not what it orders');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  'ok 1', '16 and validated again, since what it orders is complete and frozen');
select ok((select status = 'validated' and unit_price_ht_cents = 1250 and price_quote_id = current_setting('test.alpha')::uuid
    and dimension = 'DN 50' and quantity = 4
  from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000701'),
  '16 through both, the line keeps its price, its quote and what it orders');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$delete from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000702'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '10 a priced line is not deleted alone');

-- ---------------------------------------------------------------------------
-- 11. A line belongs to one retained quote.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour, une relance', array['a9300000-0000-4000-8000-000000000701']::uuid[])$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINES_ALREADY_RETAINED', '11 a line priced by a retained quote is not consulted again');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302',
    false, 'Bonjour, une relance pour le tube', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', '11 a closed quote frees its supplier: Beta is consulted again for line 3');
select set_config('test.beta2', pg_temp.open_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000302')::text, true);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301',
    true, 'Bonjour, et le tube ?', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  'ok 1', '11 a retained quote frees its supplier too: Alpha is consulted again for a line it was not asked');
select set_config('test.alpha2', pg_temp.open_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301')::text, true);
select matches(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000601', 'a9300000-0000-4000-8000-000000000301',
    false, 'Bonjour, encore le tube ?', array['a9300000-0000-4000-8000-000000000703']::uuid[])$$),
  '^23505 ', '11 counterexample: while that new quote is in progress, Alpha is not consulted a third time');

-- ---------------------------------------------------------------------------
-- 12. Files of a quote.
-- ---------------------------------------------------------------------------
select throws_ok($$insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size)
  values ('a9300000-0000-4000-8000-000000000901', 'a9300000-0000-4000-8000-000000000601',
    'a9300000-0000-4000-8000-000000000101/a9300000-0000-4000-8000-000000000201/a9300000-0000-4000-8000-000000000601/a9300000-0000-4000-8000-000000000901/devis.pdf',
    'devis.pdf', 'application/pdf', 2048)$$,
  '23514', null, '12 an original of the request is not a PDF');
select set_config('test.beta2_prefix', 'a9300000-0000-4000-8000-000000000101/a9300000-0000-4000-8000-000000000201/a9300000-0000-4000-8000-000000000601/', true);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size, created_by)
    values ('a9300000-0000-4000-8000-000000000902', 'a9300000-0000-4000-8000-000000000601', current_setting('test.beta2')::uuid,
      current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000902/devis-beta.pdf',
      'devis-beta.pdf', 'application/pdf', 2048, 'a9300000-0000-4000-8000-000000000001')$$),
  'ok 1', '12 the owner records the PDF answering Beta''s open quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into storage.objects (bucket_id, name, metadata) values ('material-requests',
    current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000902/devis-beta.pdf', '{"size":2048}')$$),
  'ok 1', '12 they store its bytes at its path');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set stored_at = now() where id = 'a9300000-0000-4000-8000-000000000902'$$),
  'ok 1', '12 and the PDF is marked stored');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size, created_by)
    values ('a9300000-0000-4000-8000-000000000903', 'a9300000-0000-4000-8000-000000000601', current_setting('test.alpha')::uuid,
      current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000903/devis-alpha.pdf',
      'devis-alpha.pdf', 'application/pdf', 2048, 'a9300000-0000-4000-8000-000000000001')$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '12 a retained quote takes no new file');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size, created_by)
    values ('a9300000-0000-4000-8000-000000000903', 'a9300000-0000-4000-8000-000000000601', current_setting('test.beta')::uuid,
      current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000903/devis-beta-ancien.pdf',
      'devis-beta-ancien.pdf', 'application/pdf', 2048, 'a9300000-0000-4000-8000-000000000001')$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '12 nor a closed one');
select throws_ok($$insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size)
  values ('a9300000-0000-4000-8000-000000000904', 'a9300000-0000-4000-8000-000000000602', current_setting('test.beta2')::uuid,
    'a9300000-0000-4000-8000-000000000101/a9300000-0000-4000-8000-000000000202/a9300000-0000-4000-8000-000000000602/a9300000-0000-4000-8000-000000000904/devis.pdf',
    'devis.pdf', 'application/pdf', 2048)$$,
  '23514', 'MATERIAL_REQUEST_FILE_QUOTE_MISMATCH', '12 a file answers a quote of its own request');
-- Ten listed files per quote: nine more pages beside the PDF fill it.
insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size)
select id, 'a9300000-0000-4000-8000-000000000601', current_setting('test.beta2')::uuid,
  current_setting('test.beta2_prefix') || id || '/page.jpg', 'page.jpg', 'image/jpeg', 2048
from (select ('a9300000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'))::uuid as id from generate_series(10, 19) n) pages;
insert into storage.objects (bucket_id, name, metadata)
select 'material-requests', storage_path, '{"size":2048}' from public.material_request_files
where quote_id = current_setting('test.beta2')::uuid and stored_at is null;
select lives_ok($$update public.material_request_files set stored_at = now()
  where quote_id = current_setting('test.beta2')::uuid and id <> 'a9300000-0000-4000-8000-000000000919'$$,
  '12 a quote keeps ten listed files');
select throws_ok($$update public.material_request_files set stored_at = now() where id = 'a9300000-0000-4000-8000-000000000919'$$,
  '23514', 'MATERIAL_REQUEST_QUOTE_FILE_LIMIT', '12 an eleventh is not listed');
-- Twelve originals of the request still fit beside them.
insert into public.material_request_files (id, request_id, storage_path, file_name, mime_type, byte_size)
select id, 'a9300000-0000-4000-8000-000000000601',
  current_setting('test.beta2_prefix') || id || '/photo.jpg', 'photo.jpg', 'image/jpeg', 2048
from (select ('a9300000-0000-4000-8000-0000000009' || lpad(n::text, 2, '0'))::uuid as id from generate_series(30, 41) n) photos;
insert into storage.objects (bucket_id, name, metadata)
select 'material-requests', storage_path, '{"size":2048}' from public.material_request_files
where request_id = 'a9300000-0000-4000-8000-000000000601' and quote_id is null and stored_at is null;
select lives_ok($$update public.material_request_files set stored_at = now()
  where request_id = 'a9300000-0000-4000-8000-000000000601' and quote_id is null$$,
  '12 the files of a quote do not take the places of the twelve originals');
select is((select count(*) from public.material_request_files where request_id = 'a9300000-0000-4000-8000-000000000601'
    and stored_at is not null), 22::bigint, '12 ten files of the quote and twelve originals are listed');

-- ---------------------------------------------------------------------------
-- 13. The files of a retained or closed quote are read-only.
-- ---------------------------------------------------------------------------
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set removed_at = now() where id = 'a9300000-0000-4000-8000-000000000910'$$),
  'ok 1', '13 a page attached by mistake to a quote in progress is withdrawn');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$delete from public.material_request_files where id = 'a9300000-0000-4000-8000-000000000910'$$),
  'ok 1', '13 and deleted');
-- A late page, prepared while the quote is in progress, whose bytes arrive after its retaining.
insert into public.material_request_files (id, request_id, quote_id, storage_path, file_name, mime_type, byte_size)
values ('a9300000-0000-4000-8000-000000000950', 'a9300000-0000-4000-8000-000000000601', current_setting('test.beta2')::uuid,
  current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000950' || '/tardive.jpg', 'tardive.jpg', 'image/jpeg', 2048);
insert into storage.objects (bucket_id, name, metadata)
values ('material-requests', current_setting('test.beta2_prefix') || 'a9300000-0000-4000-8000-000000000950' || '/tardive.jpg', '{"size":2048}');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.beta2')::uuid,
    '{"received": true, "lines": [{"line_id": "a9300000-0000-4000-8000-000000000703", "unit_price_ht_cents": 1890}]}')$$),
  'ok 1', '13 fixture: Beta answers its second quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000703'$$),
  'ok 1', '13 fixture: the owner validates line 3');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000001',
  $$select closed_quote_id from public.retain_material_request_quote(current_setting('test.beta2')::uuid)$$),
  jsonb_build_array(jsonb_build_object('closed_quote_id', current_setting('test.alpha2'))),
  '13 fixture: the owner retains it, closing Alpha''s second quote');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set stored_at = now() where id = 'a9300000-0000-4000-8000-000000000950'$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '13 a page prepared while the quote was in progress is not completed after its retaining');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set removed_at = now() where id = 'a9300000-0000-4000-8000-000000000911'$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '13 a listed file of a retained quote is not withdrawn');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set rotation = 90 where id = 'a9300000-0000-4000-8000-000000000911'$$),
  '23514 MATERIAL_REQUEST_QUOTE_READ_ONLY', '13 nor turned');
select throws_ok($$delete from public.material_request_files where id = 'a9300000-0000-4000-8000-000000000911'$$,
  '23514', 'MATERIAL_REQUEST_QUOTE_READ_ONLY', '13 nor deleted, even by a server writer');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set removed_at = now() where id in ('a9300000-0000-4000-8000-000000000950', 'a9300000-0000-4000-8000-000000000919')$$),
  'ok 2', '13 counterexample: its leftovers that were never listed are withdrawn');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$delete from public.material_request_files where id in ('a9300000-0000-4000-8000-000000000950', 'a9300000-0000-4000-8000-000000000919')$$),
  'ok 2', '13 and deleted');
-- Deleting the request withdraws every file first, those of retained quotes included, through one function.
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000006',
  $$select cardinality(public.withdraw_material_request_files_for_deletion('a9300000-0000-4000-8000-000000000601')) as withdrawn$$),
  '[{"withdrawn": 0}]'::jsonb, '13 a director, who may not delete the request, withdraws nothing');
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000001',
  $$select cardinality(public.withdraw_material_request_files_for_deletion('a9300000-0000-4000-8000-000000000601')) as withdrawn$$),
  jsonb_build_array(jsonb_build_object('withdrawn',
    (select count(*) from public.material_request_files where request_id = 'a9300000-0000-4000-8000-000000000601'))),
  '13 its owner withdraws every file of the request, with their paths');
-- (Codex review of #279) The paths come back as one value, whatever their number: the Data API answers 1 000 rows at
-- most, and a request may hold more files across its quotes. The rows are written past their triggers here (rolled
-- back), as 1 005 listed files would otherwise need a hundred quotes.
alter table public.material_request_files disable trigger enforce_material_request_file_write;
insert into public.material_request_files (id, tenant_id, project_id, request_id, storage_path, file_name, mime_type, byte_size,
    created_by, stored_at)
select file.id, 'a9300000-0000-4000-8000-000000000101', 'a9300000-0000-4000-8000-000000000202', 'a9300000-0000-4000-8000-000000000602',
  'a9300000-0000-4000-8000-000000000101/a9300000-0000-4000-8000-000000000202/a9300000-0000-4000-8000-000000000602/'
    || file.id || '/page.jpg', 'page.jpg', 'image/jpeg', 2048, 'a9300000-0000-4000-8000-000000000005', now()
from (select gen_random_uuid() as id from generate_series(1, 1005)) file;
alter table public.material_request_files enable trigger enforce_material_request_file_write;
select is(pg_temp.pls_rows('a9300000-0000-4000-8000-000000000005',
  $$select cardinality(paths) as paths, (select count(distinct path) from unnest(paths) path) as distinct_paths
    from (select public.withdraw_material_request_files_for_deletion('a9300000-0000-4000-8000-000000000602') as paths) answer$$),
  '[{"paths": 1005, "distinct_paths": 1005}]'::jsonb,
  '13 1 005 files of a request are withdrawn and answered in a single value, every path once');
select is((select count(*) from public.material_request_files
    where request_id = 'a9300000-0000-4000-8000-000000000602' and removed_at is null), 0::bigint, '13 all of them are withdrawn');
select is((select count(*) from public.material_request_files where request_id = 'a9300000-0000-4000-8000-000000000601' and removed_at is null),
  0::bigint, '13 the files of the retained quote are withdrawn with the others, ready for the deletion');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_files set removed_at = null where id = 'a9300000-0000-4000-8000-000000000911'$$),
  'ok 1', '13 a withdrawal is for good (the trigger keeps it)');
select ok((select removed_at is not null from public.material_request_files where id = 'a9300000-0000-4000-8000-000000000911'), '13 the file stays withdrawn');

-- ---------------------------------------------------------------------------
-- 14. Deletions.
-- ---------------------------------------------------------------------------
select lives_ok($$delete from public.material_request_quotes where id = current_setting('test.alpha')::uuid$$,
  '14 the service role deletes the retained quote (no client can)');
select is((select jsonb_agg(jsonb_build_array(position, supplier_id, unit_price_ht_cents, price_per, price_quote_id)
      order by position)
    from public.material_request_lines where request_id = 'a9300000-0000-4000-8000-000000000601' and position < 3),
  jsonb_build_array(
    jsonb_build_array(1, 'a9300000-0000-4000-8000-000000000301', null, 1, null),
    jsonb_build_array(2, 'a9300000-0000-4000-8000-000000000301', null, 1, null)),
  '14 its price and price quantity go with it from the lines, which keep their supplier');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set dimension = 'DN 65' where id = 'a9300000-0000-4000-8000-000000000701'$$),
  'ok 1', '14 counterexample: an unpriced line says something else again');
-- Request 603: one line priced by a retained quote.
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000603', 'a9300000-0000-4000-8000-000000000303',
    true, 'Bonjour, 3 manchons PVC DN 32 (réf. MA-32) ?', array['a9300000-0000-4000-8000-000000000705']::uuid[])$$),
  'ok 1', '14 fixture: the owner consults Gamma on request 603');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  format($$select public.update_material_request_quote(%L,
    '{"received": true, "lines": [{"line_id": "a9300000-0000-4000-8000-000000000705", "unit_price_ht_cents": 0}]}')$$,
    pg_temp.open_quote('a9300000-0000-4000-8000-000000000603', 'a9300000-0000-4000-8000-000000000303'))),
  'ok 1', '14 fixture: Gamma answers, the sleeves are offered (a price of zero is a price)');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000705'$$),
  'ok 1', '14 fixture: the owner validates the sleeves');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  format($$select * from public.retain_material_request_quote(%L)$$,
    pg_temp.open_quote('a9300000-0000-4000-8000-000000000603', 'a9300000-0000-4000-8000-000000000303'))),
  'ok 0', '14 fixture: the owner retains it, closing nothing');
select is((select unit_price_ht_cents from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000705'),
  0, '14 the line is priced at zero');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$delete from public.material_requests where id = 'a9300000-0000-4000-8000-000000000603'$$),
  'ok 1', '14 the owner deletes the request, priced line included');
select is((select count(*) from public.material_request_quotes where request_id = 'a9300000-0000-4000-8000-000000000603')
  + (select count(*) from public.material_request_lines where request_id = 'a9300000-0000-4000-8000-000000000603')
  + (select count(*) from public.material_request_quote_lines where line_id = 'a9300000-0000-4000-8000-000000000705'),
  0::bigint, '14 its quotes, lines and quote lines go with it');

-- ---------------------------------------------------------------------------
-- 15. A line quoted in the request's material keeps that material once priced.
-- ---------------------------------------------------------------------------
-- Request 604 presumes Inox 304L, not confirmed yet. Line 1 and line 4 have no material of their own (project), line 2
-- is overhead without material, line 3 has its own.
insert into public.material_requests (id, project_id, created_by, presumed_material) values
  ('a9300000-0000-4000-8000-000000000604', 'a9300000-0000-4000-8000-000000000201', 'a9300000-0000-4000-8000-000000000001', 'Inox 304L');
insert into public.material_request_lines (id, request_id, position, quantity, unit, dimension, product_type, material, imputation,
    overhead_category) values
  ('a9300000-0000-4000-8000-000000000711', 'a9300000-0000-4000-8000-000000000604', 1, 8, 'u', 'DN 40', 'Coude 90°', null, 'project', null),
  ('a9300000-0000-4000-8000-000000000712', 'a9300000-0000-4000-8000-000000000604', 2, 2, 'u', 'T10', 'Gants', null, 'overhead', 'EPI'),
  ('a9300000-0000-4000-8000-000000000713', 'a9300000-0000-4000-8000-000000000604', 3, 3, 'm', 'DN 40', 'Tube', 'PVC pression', 'project', null),
  ('a9300000-0000-4000-8000-000000000714', 'a9300000-0000-4000-8000-000000000604', 4, 1, 'u', 'DN 40', 'Bouchon', null, 'project', null);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.create_material_request_quote('a9300000-0000-4000-8000-000000000604', 'a9300000-0000-4000-8000-000000000304', false,
    'Bonjour, prix pour 8 coudes 90° inox 304L DN 40, 2 paires de gants T10, 3 m de tube PVC pression DN 40 ?',
    array['a9300000-0000-4000-8000-000000000711', 'a9300000-0000-4000-8000-000000000712', 'a9300000-0000-4000-8000-000000000713']::uuid[])$$),
  'ok 1', '15 fixture: the owner consults Delta on request 604 (in the presumed Inox)');
select set_config('test.delta604', pg_temp.open_quote('a9300000-0000-4000-8000-000000000604', 'a9300000-0000-4000-8000-000000000304')::text, true);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select public.update_material_request_quote(current_setting('test.delta604')::uuid,
    '{"received": true, "lines": [{"line_id": "a9300000-0000-4000-8000-000000000711", "unit_price_ht_cents": 2150},
      {"line_id": "a9300000-0000-4000-8000-000000000712", "unit_price_ht_cents": 390},
      {"line_id": "a9300000-0000-4000-8000-000000000713", "unit_price_ht_cents": 640}]}')$$),
  'ok 1', '15 fixture: Delta answers');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated'
    where id in ('a9300000-0000-4000-8000-000000000712', 'a9300000-0000-4000-8000-000000000713')$$),
  'ok 2', '15 fixture: the overhead line and the line with its own material are validated');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id = 'a9300000-0000-4000-8000-000000000711'$$),
  '23514 MATERIAL_REQUEST_LINE_MATERIAL_UNCONFIRMED', '15 line 1 is not validated in a presumed material not confirmed yet');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.delta604')::uuid)$$),
  '23514 MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED',
  '15 so a quote asked in the presumed material is not retained while that material is not confirmed');
select is(pg_temp.pls_detail('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.delta604')::uuid)$$),
  '[1]', '15 the refusal names the line that has no material of its own (not the overhead one)');
select is((select status from public.material_request_quotes where id = current_setting('test.delta604')::uuid),
  'received', '15 nothing was retained');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_requests set material_confirmed = true where id = 'a9300000-0000-4000-8000-000000000604'$$),
  'ok 1', '15 the owner confirms Inox 304L');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set status = 'validated' where id in ('a9300000-0000-4000-8000-000000000711', 'a9300000-0000-4000-8000-000000000714')$$),
  'ok 2', '15 and validates lines 1 and 4 in it');
select set_config('test.validated_711',
  (select validated_at::text from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000711'), true);
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$select * from public.retain_material_request_quote(current_setting('test.delta604')::uuid)$$),
  'ok 0', '15 the owner retains Delta once the material is confirmed');
select is((select jsonb_agg(jsonb_build_array(position, material, status, unit_price_ht_cents) order by position)
    from public.material_request_lines where request_id = 'a9300000-0000-4000-8000-000000000604'),
  jsonb_build_array(
    jsonb_build_array(1, 'Inox 304L', 'validated', 2150),
    jsonb_build_array(2, null, 'validated', 390),
    jsonb_build_array(3, 'PVC pression', 'validated', 640),
    jsonb_build_array(4, null, 'validated', null)),
  '15 the retaining writes the presumed material on the project line priced without one; the overhead line, the line with its own material and the line not quoted keep theirs');
select ok((select validated_at = current_setting('test.validated_711')::timestamptz and validated_by = 'a9300000-0000-4000-8000-000000000001'
  from public.material_request_lines where id = 'a9300000-0000-4000-8000-000000000711'), '15 the priced line stays validated, with its author and date');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_requests set presumed_material = 'Cuivre' where id = 'a9300000-0000-4000-8000-000000000604'$$),
  'ok 1', '15 the owner changes the header material to Cuivre');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_requests set material_confirmed = true where id = 'a9300000-0000-4000-8000-000000000604'$$),
  'ok 1', '15 and confirms it');
select is((select jsonb_agg(jsonb_build_array(position, material, status, unit_price_ht_cents) order by position)
    from public.material_request_lines where request_id = 'a9300000-0000-4000-8000-000000000604' and position in (1, 4)),
  jsonb_build_array(
    jsonb_build_array(1, 'Inox 304L', 'validated', 2150),
    jsonb_build_array(4, null, 'draft', null)),
  '15 the priced line keeps Inox at its Inox price; the unpriced line that relied on the header returns to draft');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set material = null where id = 'a9300000-0000-4000-8000-000000000711'$$),
  '23514 MATERIAL_REQUEST_LINE_PRICED', '15 and its written material is frozen like the rest of what it orders');
select is(pg_temp.pls_run('a9300000-0000-4000-8000-000000000001',
  $$update public.material_request_lines set material = 'Inox 304L' where id = 'a9300000-0000-4000-8000-000000000714'$$),
  'ok 1', '15 counterexample: outside a retaining, writing a material on a line is an ordinary edit');

select * from finish();
rollback;
