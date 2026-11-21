-- Lot 4, migration A (20261121180813_takeoff_item_lists.sql): the list of items of an affaire and the item templates.
-- 1. Who may read and write: the takeoff operator of the affaire writes its list, its readers read it; an administrator
--    of the tenant publishes a template; nobody writes a table directly.
-- 2. The identity rule: an origin key keeps its item across revisions, retirement and return; a new key takes an existing
--    item only as an accepted continuity; an item is never another affaire's.
-- 3. A revision is immutable, its digest is the database's own over what it stored, a gesture replayed returns it and
--    another submission under the same key is a conflict; a stale revision refuses.
-- 4. The proof of an import's confirmation stops matching when the rows, their measured fields or the mapping change.
-- 5. The lineage of mapped rows keeps the line → raw row join after a remapping; the creation of an estimate and its
--    confirmation record commit together.
-- 6. Two writers of one list at once: the second waits for the first, then refuses as stale; an admission sealing a list
--    while a writer records a revision waits for it, then is stale.
-- 7. The seal of the second measuring order: refused before its activation, then only with the affaire's own latest
--    revision, recorded on the request.
-- Isolation justified: rights under RLS, the identity rule in SQL, digests, the seal and the cross-session wait are not
-- observable from a journey. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('b4200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fx(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fx(n))::text, true);
$$;

-- The objects and what the API roles may do with them.
select table_privs_are('public', relation, 'authenticated', array['SELECT'], relation || ': members only read')
from unnest(array['takeoff_list_items', 'takeoff_list_item_sources', 'takeoff_list_revisions',
  'takeoff_list_revision_entries', 'takeoff_item_template_versions']) as relation;
select ok(exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid = format('public.%I', relation)::regclass
  and t.tgname = relation || '_writer'), relation || ': the service role writes only through the functions')
from unnest(array['takeoff_list_items', 'takeoff_list_item_sources', 'takeoff_list_revisions',
  'takeoff_list_revision_entries', 'takeoff_item_template_versions', 'takeoff_item_template_drafts',
  'dpgf_import_confirmations']) as relation;
select table_privs_are('public', relation, 'authenticated', array[]::text[], relation || ': members neither read nor write')
from unnest(array['takeoff_item_template_drafts', 'dpgf_import_confirmations']) as relation;
select table_privs_are('public', relation, 'anon', array[]::text[], relation || ': anonymous clients see nothing')
from unnest(array['takeoff_list_items', 'takeoff_list_item_sources', 'takeoff_list_revisions',
  'takeoff_list_revision_entries', 'takeoff_item_template_versions', 'takeoff_item_template_drafts',
  'dpgf_import_confirmations']) as relation;
select is(has_function_privilege('authenticated', format('public.%s', fn), 'EXECUTE'), false,
  fn || ': not callable by a member''s session')
from unnest(array[
  'record_takeoff_list_revision(uuid, uuid, uuid, integer, uuid, text, text, jsonb, jsonb, jsonb)',
  'save_takeoff_item_template_draft(uuid, uuid, text, uuid, integer, jsonb, text[])',
  'publish_takeoff_item_template(uuid, uuid, text, uuid, uuid, text[])',
  'discard_takeoff_item_template_draft(uuid, uuid, text, uuid)',
  'record_dpgf_import_confirmation(uuid, uuid, uuid, uuid, uuid, uuid, jsonb, jsonb, uuid[])',
  'persist_dpgf_import_estimate_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb, jsonb, uuid[])',
  'read_dpgf_import_confirmation(uuid, uuid)', 'read_estimate_dpgf_raw_rows(uuid, uuid)',
  'takeoff_item_list_order_is_active()', 'takeoff_item_list_may_write(uuid, uuid, uuid)']) as fn;
select is(has_table_privilege('authenticated', 'private.dpgf_mapped_row_lineage', 'SELECT'), false,
  'members do not read the lineage');

-- One tenant: an engineer who owns affaire 20 (1), an engineer who does not (2), a director (3), an admin (5); another
-- tenant's admin (4). Affaire 21 belongs to 2.
insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fx(n), 'item-list-' || n || '@example.test', '{}'::jsonb from generate_series(1, 5) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'b4200000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fx(10), 'Item lists', 'item-lists-test'), (pg_temp.fx(11), 'Other tenant', 'item-lists-other-test');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fx(10), pg_temp.fx(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(10), pg_temp.fx(2), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(10), pg_temp.fx(3), 'director', true, '2020-01-01'),
  (pg_temp.fx(10), pg_temp.fx(5), 'admin', true, '2020-01-01'),
  (pg_temp.fx(11), pg_temp.fx(4), 'admin', true, '2020-01-01');
insert into public.estimate_projects(id, tenant_id, user_id, name) values
  (pg_temp.fx(20), pg_temp.fx(10), pg_temp.fx(1), 'Liste de postes (fictive)'),
  (pg_temp.fx(21), pg_temp.fx(10), pg_temp.fx(2), 'Autre affaire (fictive)');

-- 2. Templates. The shipped definition is named by the server: here its lines « lavabo » and « baignoire ».
create function pg_temp.lines(variadic ids text[]) returns jsonb language sql immutable as $$
  select jsonb_build_object('contract', 1, 'title', 'Plomberie', 'families', jsonb_build_array(jsonb_build_object(
    'id', 'sanitaires', 'title', 'Appareils sanitaires', 'lines', (select jsonb_agg(jsonb_build_object('id', id,
      'label', initcap(id), 'expectedUnit', 'u', 'measurementBasis', 'Comptage', 'qualifiers', '{}'::jsonb,
      'synonyms', '[]'::jsonb) order by ordinality) from unnest(ids) with ordinality id))))
$$;
create function pg_temp.save(actor integer, expected uuid, definition jsonb, base integer default 1, tenant integer default 10)
returns table (revision integer, token uuid) language sql as $$
  select * from public.save_takeoff_item_template_draft(pg_temp.fx(tenant), pg_temp.fx(actor), 'plomberie', expected, base,
    definition, array['lavabo', 'baignoire'])
$$;
create function pg_temp.publish(expected uuid, intent integer) returns table (version_id uuid, version integer,
  replayed boolean) language sql as $$
  select * from public.publish_takeoff_item_template(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', expected, pg_temp.fx(intent),
    array['lavabo', 'baignoire'])
$$;
create temp table tokens (label text primary key, token uuid);
select throws_ok($$ select * from pg_temp.save(1, null, pg_temp.lines('lavabo')) $$, '42501', 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN',
  'an engineer does not edit the template');
select throws_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo'), tenant => 11) $$, '42501',
  'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN', 'an administrator of another tenant neither');
select throws_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo', 'lavabo')) $$, '22023',
  'TAKEOFF_ITEM_TEMPLATE_INVALID', 'two lines of one template never share an identifier');
insert into tokens select 'first', token from pg_temp.save(5, null, pg_temp.lines('lavabo', 'baignoire'));
select is((select revision from public.takeoff_item_template_drafts where tenant_id = pg_temp.fx(10)), 1,
  'the administrator saves a first draft on the shipped version');
select throws_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo')) $$, '40001',
  'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'a draft saved from an older view refuses');
insert into tokens select 'second', token from pg_temp.save(5, (select token from tokens where label = 'first'),
  pg_temp.lines('lavabo', 'baignoire', 'wc'));
select isnt((select token from tokens where label = 'second'), (select token from tokens where label = 'first'),
  'each save gives the draft a new token');
select throws_ok($$ select * from pg_temp.publish((select token from tokens where label = 'first'), 900) $$, '40001',
  'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'publishing a draft not seen refuses');
-- A stale tab: A saw the second draft; B discards it and saves another first revision; A's publication refuses.
select lives_ok($$ select public.discard_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie',
  (select token from tokens where label = 'second')) $$, 'B discards the draft A is looking at');
insert into tokens select 'other', token from pg_temp.save(5, null, pg_temp.lines('lavabo', 'wc'));
select is((select revision from public.takeoff_item_template_drafts where tenant_id = pg_temp.fx(10)), 1,
  'B''s new draft is a first revision again');
select throws_ok($$ select * from pg_temp.publish((select token from tokens where label = 'second'), 901) $$, '40001',
  'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'A''s tab never publishes B''s draft');
select throws_ok($$ select public.discard_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie',
  (select token from tokens where label = 'second')) $$, '40001', 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE',
  'nor discards it');
select throws_ok($$ select * from pg_temp.save(5, (select token from tokens where label = 'second'), pg_temp.lines('lavabo')) $$,
  '40001', 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'nor overwrites it');
select results_eq($$ select version, replayed from pg_temp.publish((select token from tokens where label = 'other'), 900) $$,
  $$ values (2, false) $$, 'B publishes version 2, after the shipped version 1, without « baignoire »');
select results_eq($$ select version, replayed from pg_temp.publish((select token from tokens where label = 'other'), 900) $$,
  $$ values (2, true) $$, 'the same gesture again returns the same version');
select is((select count(*)::integer from public.takeoff_item_template_drafts where tenant_id = pg_temp.fx(10)), 0,
  'the published draft is gone');
select results_eq($$ select line_count, used_line_ids from public.takeoff_item_template_versions where tenant_id = pg_temp.fx(10) $$,
  $$ values (2, array['baignoire', 'lavabo', 'wc']) $$, 'the version counts its lines and every identifier ever used');
-- A retired line never comes back under its identifier: a new « Baignoire » is a new line.
select throws_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo', 'wc', 'baignoire'), base => 2) $$, '22023',
  'TAKEOFF_ITEM_TEMPLATE_LINE_REUSED', 'a line added never takes the identifier of a retired one');
select lives_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo', 'wc', 'baignoire-2'), base => 2) $$,
  'under a new identifier it is saved');
select throws_ok($$ select * from pg_temp.save(5, null, pg_temp.lines('lavabo'), base => 1) $$, '40001',
  'TAKEOFF_ITEM_TEMPLATE_STALE', 'a draft on a version no longer the latest refuses');
select throws_ok($$ update public.takeoff_item_template_versions set line_count = 1 where tenant_id = pg_temp.fx(10) $$,
  '42501', 'TAKEOFF_ITEM_LIST_IMMUTABLE', 'a published version is never changed');
select pg_temp.sign_in(1);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_template_versions), 1,
  'a member of the tenant reads its published version');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_item_template_versions), 0,
  'another tenant''s member reads none');
reset role;

-- 3. The list of affaire 20.
create function pg_temp.entry(item integer, key text, label text, origin jsonb, reference numeric default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object('item_id', pg_temp.fx(item), 'source_key', key, 'label', label, 'expected_unit', 'u',
    'measurement_basis', null, 'qualifiers', '{}'::jsonb, 'sections', jsonb_build_array(jsonb_build_object('id', 's1',
    'title', 'Bâtiment A', 'order', 0)), 'synonyms', '[]'::jsonb, 'origin', origin, 'reference_quantity', reference)
$$;
create function pg_temp.dpgf(row_id integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'dpgf', 'importId', pg_temp.fx(60), 'rawRowId', pg_temp.fx(row_id))
$$;
-- The server's digest of a gesture, here the submission itself: the same submission is the same gesture.
create function pg_temp.gesture(expected integer, cause text, entries jsonb, continuities jsonb) returns text
language sql immutable as $$
  select encode(sha256(convert_to(jsonb_build_object('expected', expected, 'cause', cause, 'entries', entries,
    'continuities', continuities)::text, 'UTF8')), 'hex')
$$;
create function pg_temp.record(actor integer, expected integer, intent integer, cause text, entries jsonb,
  continuities jsonb default '[]'::jsonb, project integer default 20, tenant integer default 10)
returns table (revision_id uuid, revision integer, content_sha256 text, replayed boolean) language sql as $$
  select * from public.record_takeoff_list_revision(pg_temp.fx(tenant), pg_temp.fx(project), pg_temp.fx(actor), expected,
    pg_temp.fx(intent), pg_temp.gesture(expected, cause, entries, continuities), cause,
    '{"dpgf":{"importId":"fictif"}}'::jsonb, entries, continuities)
$$;
create temp table first_list as select pg_temp.entry(100, '["dpgf","i","r1"]', 'Lavabo en céramique', pg_temp.dpgf(61), 2)
  || '{}'::jsonb as a, pg_temp.entry(101, '["dpgf","i","r2"]', 'Lavabo en céramique', pg_temp.dpgf(62), 3) as b;

select throws_ok($$ select * from pg_temp.record(3, 0, 200, 'initial', (select jsonb_build_array(a, b) from first_list)) $$,
  '42501', 'TAKEOFF_ITEM_LIST_FORBIDDEN', 'a director reads the affaire but does not write its list');
select throws_ok($$ select * from pg_temp.record(2, 0, 200, 'initial', (select jsonb_build_array(a, b) from first_list)) $$,
  '42501', 'TAKEOFF_ITEM_LIST_FORBIDDEN', 'an engineer who does not own the affaire neither');
select throws_ok($$ select * from pg_temp.record(1, 0, 200, 'initial', (select jsonb_build_array(a, b, a) from first_list)) $$,
  '22023', 'TAKEOFF_ITEM_LIST_INVALID', 'an item appears once in a revision');
select results_eq($$ select revision, replayed from pg_temp.record(1, 0, 200, 'initial',
  (select jsonb_build_array(a, b) from first_list)) $$, $$ values (1, false) $$,
  'the owner records the first list: two homonyms from two raw rows are two items');
select is((select content_sha256 from public.takeoff_list_revisions where project_id = pg_temp.fx(20) and revision = 1),
  private.takeoff_list_revision_content_sha256((select id from public.takeoff_list_revisions
    where project_id = pg_temp.fx(20) and revision = 1), pg_temp.fx(10), pg_temp.fx(20)),
  'the stored digest is the database''s over the stored entries');
select results_eq($$ select revision, replayed from pg_temp.record(1, 0, 200, 'initial',
  (select jsonb_build_array(a, b) from first_list)) $$, $$ values (1, true) $$, 'the same gesture again returns it');
select throws_ok($$ select * from pg_temp.record(1, 0, 200, 'initial', (select jsonb_build_array(a) from first_list)) $$,
  '23505', 'TAKEOFF_ITEM_LIST_INTENT_CONFLICT', 'another submission under the same key is a conflict');
select throws_ok($$ select * from pg_temp.record(1, 0, 201, 'initial', (select jsonb_build_array(a, b) from first_list)) $$,
  '40001', 'TAKEOFF_ITEM_LIST_STALE', 'a first list is first only once: a second one refuses as stale');
select throws_ok($$ select * from pg_temp.record(1, 0, 201, 'proposal', (select jsonb_build_array(a, b) from first_list)) $$,
  '22023', 'TAKEOFF_ITEM_LIST_INVALID', 'a revision names the one it follows');
select throws_ok($$ select * from pg_temp.record(5, 3, 201, 'proposal', (select jsonb_build_array(a, b) from first_list)) $$,
  '40001', 'TAKEOFF_ITEM_LIST_STALE', 'a revision on a later one than the latest refuses');
select throws_ok($$ select * from pg_temp.record(1, 1, 202, 'proposal', jsonb_build_array(
  pg_temp.entry(102, '["dpgf","i","r1"]', 'Lavabo', pg_temp.dpgf(61)))) $$,
  '23505', 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT', 'a known origin keeps its item');
select throws_ok($$ select * from pg_temp.record(1, 1, 202, 'proposal', jsonb_build_array(
  pg_temp.entry(100, '["dpgf","i","r9"]', 'Lavabo', pg_temp.dpgf(69)))) $$,
  '23505', 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT', 'an existing item takes a new origin only as an accepted continuity');
select throws_ok($$ select * from pg_temp.record(2, 0, 203, 'initial', jsonb_build_array(
  pg_temp.entry(100, '["dpgf","i","r1"]', 'Lavabo', pg_temp.dpgf(61))), project => 21) $$,
  '23505', 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT', 'another affaire never takes this affaire''s item');
select throws_ok($$ select * from pg_temp.record(1, 1, 204, 'item_added', (select jsonb_build_array(a, b,
  pg_temp.entry(103, '["manual","m1"]', 'Siphon', jsonb_build_object('kind', 'manual', 'intentId', 'm1',
    'addedBy', pg_temp.fx(5), 'addedAt', '2026-11-21T00:00:00Z', 'addedInRevision', 2))) from first_list)) $$,
  '22023', 'TAKEOFF_ITEM_LIST_INVALID', 'an addition names the member who adds it');
select results_eq($$ select revision from pg_temp.record(1, 1, 204, 'item_added', (select jsonb_build_array(a, b,
  pg_temp.entry(103, '["manual","m1"]', 'Siphon', jsonb_build_object('kind', 'manual', 'intentId', 'm1',
    'addedBy', pg_temp.fx(1), 'addedAt', '2026-11-21T00:00:00Z', 'addedInRevision', 2))) from first_list)) $$,
  $$ values (2) $$, 'an item is added at any date, by its author');
-- Retirement of the first homonym, then its return: the same item.
select results_eq($$ select revision from pg_temp.record(1, 2, 205, 'proposal', (select jsonb_build_array(b) from first_list)) $$,
  $$ values (3) $$, 'a source retired leaves the list');
select throws_ok($$ select * from pg_temp.record(1, 3, 206, 'proposal', jsonb_build_array(
  pg_temp.entry(104, '["dpgf","i","r1"]', 'Lavabo en céramique', pg_temp.dpgf(61)))) $$,
  '23505', 'TAKEOFF_ITEM_LIST_IDENTITY_CONFLICT', 'a source back never makes a second item');
select results_eq($$ select revision from pg_temp.record(1, 3, 206, 'proposal', (select jsonb_build_array(a, b) from first_list)) $$,
  $$ values (4) $$, 'a source back finds its item');
-- A continuity accepted by the operator: a new import's row is the same item as the first homonym.
select results_eq($$ select revision from pg_temp.record(1, 4, 207, 'proposal', (select jsonb_build_array(
  pg_temp.entry(100, '["dpgf","j","r1"]', 'Lavabo en céramique', pg_temp.dpgf(63)), b) from first_list),
  jsonb_build_array(jsonb_build_object('source_key', '["dpgf","j","r1"]', 'item_id', pg_temp.fx(100)))) $$,
  $$ values (5) $$, 'an accepted continuity keeps the item');
select results_eq($$ select kind, item_id from public.takeoff_list_item_sources where project_id = pg_temp.fx(20)
  and source_key = '["dpgf","j","r1"]' $$, $$ values ('continuity'::text, pg_temp.fx(100)) $$,
  'the item answers to both origins, the second as a continuity');
select throws_ok($$ update public.takeoff_list_revision_entries set label = 'Autre' where project_id = pg_temp.fx(20) $$,
  '42501', 'TAKEOFF_ITEM_LIST_IMMUTABLE', 'an entry of a revision is never changed');
select throws_ok($$ update public.takeoff_list_revisions set item_count = 0 where project_id = pg_temp.fx(20) $$,
  '42501', 'TAKEOFF_ITEM_LIST_IMMUTABLE', 'a revision is never changed');

-- Readers.
select pg_temp.sign_in(3);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_list_revisions), 5, 'a director reads the affaire''s revisions');
select is((select count(*)::integer from public.takeoff_list_revision_entries where revision_id = (select id
  from public.takeoff_list_revisions where revision = 2)), 3, 'and their entries');
select throws_ok($$ insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision,
  created_by) values (gen_random_uuid(), pg_temp.fx(10), pg_temp.fx(20), 'manual', 1, pg_temp.fx(3)) $$, '42501', null,
  'no member writes the registry directly');
reset role;
select pg_temp.sign_in(2);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_list_revisions where project_id = pg_temp.fx(20)), 0,
  'an engineer who does not own the affaire does not read its list');
reset role;
select pg_temp.sign_in(4);
set local role authenticated;
select is((select count(*)::integer from public.takeoff_list_items), 0, 'another tenant reads nothing');
reset role;

set local role service_role;
select throws_ok($$ delete from public.takeoff_list_revisions where project_id = pg_temp.fx(20) $$, '42501',
  'TAKEOFF_ITEM_LIST_WRITER_REQUIRED', 'the server never deletes a revision directly');
select throws_ok($$ insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision,
  created_by) values (gen_random_uuid(), pg_temp.fx(10), pg_temp.fx(20), 'manual', 1, pg_temp.fx(1)) $$, '42501',
  'TAKEOFF_ITEM_LIST_WRITER_REQUIRED', 'nor writes the registry directly');
reset role;

-- 4. The proof of a confirmation.
insert into public.dpgf_imports (id, tenant_id, user_id, project_id, filename, source_format, status, row_count, parse_mode)
values (pg_temp.fx(60), pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(20), 'dpgf-fictif.csv', 'csv', 'completed', 2, 'server');
insert into public.dpgf_rows_raw (id, tenant_id, import_id, row_index, payload) values
  (pg_temp.fx(61), pg_temp.fx(10), pg_temp.fx(60), 0, '{"Designation":"Bâtiment A"}'),
  (pg_temp.fx(62), pg_temp.fx(10), pg_temp.fx(60), 1, '{"Designation":"Lavabo","Qte":"2"}');
insert into public.dpgf_mappings (id, tenant_id, import_id, status, column_mapping, created_at)
values (pg_temp.fx(70), pg_temp.fx(10), pg_temp.fx(60), 'validated', '{"Designation":"designation","Qte":"quantity"}',
  now() - interval '1 minute');
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, raw_row_id, payload, status) values
  (pg_temp.fx(71), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(61), '{"mapped_row":{"designation":"Bâtiment A"}}', 'mapped'),
  (pg_temp.fx(72), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(62),
    '{"mapped_row":{"designation":"Lavabo","quantity":"2"}}', 'mapped');
create function pg_temp.confirm(mapping integer, decisions jsonb, exclusions jsonb, rows integer[],
  version integer default null) returns uuid language sql as $$
  select public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60), pg_temp.fx(mapping),
    pg_temp.fx(20), case when version is null then null else pg_temp.fx(version) end, decisions, exclusions,
    array(select pg_temp.fx(n) from unnest(rows) n))
$$;
select throws_ok($$ select pg_temp.confirm(70, '[{"rowIndex":0,"kind":"section","level":3}]', '[]', array[71, 72]) $$,
  '22023', 'DPGF_IMPORT_CONFIRMATION_INVALID', 'a decision names a level 1 or 2');
select throws_ok($$ select pg_temp.confirm(70, '[]', '[{"rowIndex":1,"reason":"prix"}]', array[71, 72]) $$,
  '22023', 'DPGF_IMPORT_CONFIRMATION_INVALID', 'an exclusion names one of the import''s own reasons');
select throws_ok($$ select pg_temp.confirm(99, '[]', '[]', array[71, 72]) $$, '40001', 'DPGF_IMPORT_CONFIRMATION_STALE',
  'a confirmation binds to the latest mapping of its import');
select throws_ok($$ select pg_temp.confirm(70, '[]', '[]', array[71]) $$, '40001', 'DPGF_IMPORT_CONFIRMATION_ROWS_CHANGED',
  'a confirmation names every row the import holds, never a part of them');
select throws_ok($$ select pg_temp.confirm(70, '[]', '[]', array[71, 72, 79]) $$, '40001',
  'DPGF_IMPORT_CONFIRMATION_ROWS_CHANGED', 'nor a row the import no longer holds');
select isnt(pg_temp.confirm(70, '[{"rowIndex":0,"kind":"section","level":1}]', '[{"rowIndex":1,"reason":"user_ignored"}]',
  array[71, 72]), null, 'a confirmation records its decisions and what the import left out');
select results_eq($$ select proof_current, superseded, row_count, exclusions -> 0 ->> 'reason'
  from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60)) $$,
  $$ values (true, false, 2, 'user_ignored'::text) $$, 'its proof matches what the import holds');
-- The catalogue linking rewrites the payload with keys of its own: the proof holds.
update public.dpgf_rows_mapped set payload = payload || '{"catalogue_product_id":"fictif"}' where id = pg_temp.fx(72);
select is((select proof_current from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60))), true,
  'a key outside the measured fields leaves the proof valid');
update public.dpgf_rows_mapped set payload = jsonb_set(payload, '{mapped_row,quantity}', '"3"') where id = pg_temp.fx(72);
select is((select proof_current from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60))), false,
  'a measured field changed: the decisions are no longer proven');
update public.dpgf_rows_mapped set payload = jsonb_set(payload, '{mapped_row,quantity}', '"2"') where id = pg_temp.fx(72);
select is((select proof_current from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60))), true,
  'the same facts again: proven again');
-- A confirmation of the previous version with a mapping: a new mapping and new mapped rows, no decision recorded.
insert into public.dpgf_mappings (id, tenant_id, import_id, status, column_mapping)
values (pg_temp.fx(73), pg_temp.fx(10), pg_temp.fx(60), 'validated', '{"Designation":"designation","Qte":"quantity"}');
select is((select proof_current from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60))), false,
  'a later mapping: the earlier confirmation''s decisions are not applied');
delete from public.dpgf_rows_mapped where import_id = pg_temp.fx(60);
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, raw_row_id, payload, status) values
  (pg_temp.fx(74), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(61), '{"mapped_row":{"designation":"Bâtiment A"}}', 'mapped'),
  (pg_temp.fx(75), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(62),
    '{"mapped_row":{"designation":"Lavabo","quantity":"2"}}', 'mapped');
select isnt(pg_temp.confirm(73, '[]', '[]', array[74, 75]), null, 'a new confirmation records the new structure');
select results_eq($$ select proof_current, jsonb_array_length(decisions) from public.read_dpgf_import_confirmation(
  pg_temp.fx(10), pg_temp.fx(60)) $$, $$ values (true, 0) $$, 'the latest confirmation is the one read');

-- 5. Lineage: a deleted mapped row is recorded with its raw row as it is deleted; a live one needs no record.
select results_eq($$ select mapped_row_id, raw_row_id from private.dpgf_mapped_row_lineage
  where import_id = pg_temp.fx(60) order by mapped_row_id $$,
  $$ values (pg_temp.fx(71), pg_temp.fx(61)), (pg_temp.fx(72), pg_temp.fx(62)) $$,
  'the rows a remapping deleted are recorded, the live ones are not');
set local session_replication_role = replica;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, title, parent_version_id)
values (pg_temp.fx(80), pg_temp.fx(10), pg_temp.fx(20), 1, 'draft', 'Devis fictif', null);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title, fo_provision, source_metadata) values
  (pg_temp.fx(81), pg_temp.fx(10), pg_temp.fx(80), 'section', 0, 'Lavabo', 1,
    jsonb_build_object('import_id', pg_temp.fx(60), 'mapped_row_id', pg_temp.fx(72), 'row_index', 1)),
  (pg_temp.fx(85), pg_temp.fx(10), pg_temp.fx(80), 'section', 1, 'Lavabo', 1,
    jsonb_build_object('import_id', pg_temp.fx(60), 'mapped_row_id', pg_temp.fx(75), 'row_index', 1));
set local session_replication_role = origin;
select results_eq($$ select estimate_item_id, raw_row_id from public.read_estimate_dpgf_raw_rows(pg_temp.fx(10), pg_temp.fx(80))
  order by estimate_item_id $$, $$ values (pg_temp.fx(81), pg_temp.fx(62)), (pg_temp.fx(85), pg_temp.fx(62)) $$,
  'a line reaches its raw row, through its live mapped row or the record of a deleted one');

select isnt(pg_temp.confirm(73, '[]', '[]', array[74, 75], version => 80), null, 'a confirmation names the version it created');
set local session_replication_role = replica;
delete from public.estimate_items where version_id = pg_temp.fx(80);
set local session_replication_role = origin;
-- With the foreign keys' actions: a draft deleted as its owner's server does.
delete from public.estimate_versions where id = pg_temp.fx(80);
select is((select count(*)::integer from public.dpgf_import_confirmations where estimate_version_id = pg_temp.fx(80)), 0,
  'deleting that version clears the reference and keeps the confirmation');

-- The estimate created from the import and its confirmation's record commit together (engine 2 policy, as the
-- creations of transactional-workflows.test.sql): a record refused leaves no version.
select public.set_tenant_calc_policy(p_tenant_id => pg_temp.fx(10), p_new_estimate_calc_engine => 2::smallint,
  p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null, p_allowed_tax_rates_bp => null,
  p_change_reason => 'Fixture: liste de postes (lot 4)', p_actor_user_id => pg_temp.fx(5));
create function pg_temp.version_payload(version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.fx(version), 'title', 'Import DPGF fictif', 'date_devis', '2026-11-21',
    'validite_jours', 30, 'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0,
    'discount_bp', 0, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'total_ht_cents', 0,
    'total_tax_cents', 0, 'total_ttc_cents', 0)
$$;
create function pg_temp.import_estimate(version integer, mapping integer, rows integer[]) returns jsonb language sql as $$
  select public.persist_dpgf_import_estimate_atomic(pg_temp.fx(10), pg_temp.fx(5), pg_temp.fx(20), null,
    pg_temp.version_payload(version), '[]'::jsonb, pg_temp.fx(60), pg_temp.fx(mapping),
    '[{"rowIndex":0,"kind":"section","level":1}]'::jsonb, '[{"rowIndex":1,"reason":"footer"}]'::jsonb,
    array(select pg_temp.fx(n) from unnest(rows) n))
$$;
set local role service_role;
select throws_ok($$ select pg_temp.import_estimate(82, 70, array[74, 75]) $$, '40001', 'DPGF_IMPORT_CONFIRMATION_STALE',
  'a confirmation on a mapping that is no longer the latest refuses');
select throws_ok($$ select pg_temp.import_estimate(82, 73, array[74]) $$, '40001', 'DPGF_IMPORT_CONFIRMATION_ROWS_CHANGED',
  'a confirmation on rows other than the import''s refuses');
select is((select count(*)::integer from public.estimate_versions where id = pg_temp.fx(82)), 0,
  'and its estimate was not created: one transaction');
select isnt(pg_temp.import_estimate(83, 73, array[74, 75]), null, 'on the latest mapping and its rows, the estimate is created');
reset role;
select results_eq($$ select estimate_version_id, decisions, exclusions, superseded
  from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60)) $$,
  $$ values (pg_temp.fx(83), '[{"rowIndex":0,"kind":"section","level":1}]'::jsonb, '[{"rowIndex":1,"reason":"footer"}]'::jsonb,
    false) $$, 'and the confirmation that created it records its structure and names it');

-- 6. Two writers at once, and an admission against a writer (before this session activates the second order).
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select is(extensions.dblink_exec('race_setup', format($setup$
begin;
insert into auth.users(id, email, raw_user_meta_data) values (%L, 'item-list-race@example.test', '{}');
update public.tenant_memberships set role = 'admin' where user_id = %L;
insert into public.estimate_projects(id, tenant_id, user_id, name)
select %L, m.tenant_id, m.user_id, 'Liste en concurrence (fictive)' from public.tenant_memberships m where m.user_id = %L;
commit;
$setup$, pg_temp.fx(6), pg_temp.fx(6), pg_temp.fx(22), pg_temp.fx(6))), 'COMMIT', 'an affaire whose list two members write');
create function pg_temp.race_call(intent integer, label text, expected integer default 0) returns text language sql stable as $$
  select format($call$select revision from public.record_takeoff_list_revision(
    (select tenant_id from public.estimate_projects where id = %L), %L, %L, %s, %L, %L, %L, '{}', %L)$call$,
    pg_temp.fx(22), pg_temp.fx(22), pg_temp.fx(6), expected, pg_temp.fx(intent), repeat(to_hex(intent % 16), 64),
    case when expected = 0 then 'initial' else 'item_added' end,
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx(intent), 'source_key', '["manual","' || intent || '"]',
      'label', label, 'expected_unit', null, 'measurement_basis', null, 'qualifiers', '{}'::jsonb, 'sections', '[]'::jsonb,
      'synonyms', '[]'::jsonb, 'origin', jsonb_build_object('kind', 'manual', 'intentId', intent::text,
      'addedBy', pg_temp.fx(6), 'addedAt', '2026-11-21T00:00:00Z', 'addedInRevision', expected + 1), 'reference_quantity', null)))
$$;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the first writer opens its transaction');
select results_eq(format('select * from extensions.dblink(%L, %L) as t(revision integer)', 'race_a',
  pg_temp.race_call(300, 'Premier')), $$ values (1) $$, 'the first writer records revision 1, not yet committed');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the second writer opens its transaction');
select is(extensions.dblink_send_query('race_b', pg_temp.race_call(301, 'Second')), 1,
  'the second writer starts on the same view (no revision yet)');
create function pg_temp.waits_on_lock(p_marker text) returns boolean language plpgsql as $$
begin
  for attempt in 1..200 loop
    -- The statistics views are a snapshot per transaction: read them afresh at each attempt.
    perform pg_catalog.pg_stat_clear_snapshot();
    if exists (select 1 from pg_catalog.pg_stat_activity a where a.wait_event_type = 'Lock'
      and a.query like '%' || p_marker || '%') then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
select ok(pg_temp.waits_on_lock('Second'), 'the second writer waits for the first');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first writer commits');
select throws_ok($$ select * from extensions.dblink_get_result('race_b') as t(revision integer) $$, '40001',
  'TAKEOFF_ITEM_LIST_STALE', 'the second writer then refuses as stale: nothing is written twice');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as t(revision integer)), 0,
  'its call is over');
select is(extensions.dblink_exec('race_b', 'rollback'), 'ROLLBACK', 'the second writer ends');
select is((select count(*)::integer from extensions.dblink('race_setup', format(
  'select revision from public.takeoff_list_revisions where project_id = %L', pg_temp.fx(22))) as t(revision integer)), 1,
  'one revision exists');
-- An admission sealing revision 1 while a writer records revision 2: it waits for the writer, then is stale.
select is(extensions.dblink_exec('race_setup', format($setup$
begin;
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');
set local session_replication_role = replica;
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state)
select %L, tenant_id, id, 'automatic', 'initial', %L, 'evaluating' from public.estimate_projects where id = %L;
commit;
$setup$, pg_temp.fx(91), pg_temp.fx(91), pg_temp.fx(22))), 'COMMIT', 'a request of that affaire, the second order activated');
create temp table race_manifest as select jsonb_build_object('order', jsonb_build_object('kind', 'item_list', 'version', 2,
  'list', jsonb_build_object('revision_id', r.revision_id, 'revision', r.revision, 'content_sha256', r.content_sha256,
  'item_count', r.item_count))) as manifest
from extensions.dblink('race_setup', format('select id, revision, content_sha256, item_count from public.takeoff_list_revisions
  where project_id = %L and revision = 1', pg_temp.fx(22))) as r(revision_id uuid, revision integer, content_sha256 text, item_count integer);
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a writer opens its transaction');
select results_eq(format('select * from extensions.dblink(%L, %L) as t(revision integer)', 'race_a',
  pg_temp.race_call(302, 'Ajout pendant l''admission', 1)), $$ values (2) $$,
  'the writer records revision 2, not yet committed');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the admission opens its transaction');
select is(extensions.dblink_send_query('race_b', format(
  'select private.assert_takeoff_launch_order(r, %L::jsonb) is not null from public.takeoff_launch_requests r where r.id = %L',
  (select manifest from race_manifest), pg_temp.fx(91))), 1, 'the admission seals revision 1');
select ok(pg_temp.waits_on_lock('assert_takeoff_launch_order'), 'the seal waits for the writer of the list');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the writer commits revision 2');
select throws_ok($$ select * from extensions.dblink_get_result('race_b') as t(sealed boolean) $$, '40001',
  'TAKEOFF_LAUNCH_DOSSIER_CHANGED', 'the admission is stale: the addition is never left out of an initial analysis');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as t(sealed boolean)), 0,
  'its seal is over');
select is(extensions.dblink_exec('race_b', 'rollback'), 'ROLLBACK', 'the admission ends, nothing sealed');
-- Two tabs and the previous application version, on committed rows of that affaire: an import whose mapping B read.
select is(extensions.dblink_exec('race_setup', format($setup$
begin;
insert into public.dpgf_imports (id, tenant_id, user_id, project_id, filename, source_format, status, row_count, parse_mode)
select %1$L, tenant_id, user_id, id, 'dpgf-onglets.csv', 'csv', 'completed', 2, 'server' from public.estimate_projects where id = %2$L;
insert into public.dpgf_rows_raw (id, tenant_id, import_id, row_index, payload)
select x.id, i.tenant_id, i.id, x.row_index, x.payload from public.dpgf_imports i
cross join (values (%3$L::uuid, 0, '{"Designation":"Lavabo","Qte":"2"}'::jsonb),
  (%4$L::uuid, 1, '{"Designation":"Option vasque","Qte":"1"}'::jsonb)) as x(id, row_index, payload) where i.id = %1$L;
insert into public.dpgf_mappings (id, tenant_id, import_id, status, column_mapping)
select %5$L, tenant_id, id, 'validated', '{"Designation":"designation","Qte":"quantity"}' from public.dpgf_imports where id = %1$L;
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, raw_row_id, payload, status)
select x.id, i.tenant_id, i.id, x.raw, x.payload, 'mapped' from public.dpgf_imports i
cross join (values (%6$L::uuid, %3$L::uuid, '{"mapped_row":{"designation":"Lavabo","quantity":"2"}}'::jsonb),
  (%7$L::uuid, %4$L::uuid, '{"mapped_row":{"designation":"Option vasque","quantity":"1"}}'::jsonb)) as x(id, raw, payload)
where i.id = %1$L;
select public.set_tenant_calc_policy(p_tenant_id => (select tenant_id from public.estimate_projects where id = %2$L),
  p_new_estimate_calc_engine => 2::smallint, p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null,
  p_allowed_tax_rates_bp => null, p_change_reason => 'Fixture: liste de postes (lot 4)', p_actor_user_id => %8$L);
commit;
$setup$, pg_temp.fx(160), pg_temp.fx(22), pg_temp.fx(161), pg_temp.fx(162), pg_temp.fx(170), pg_temp.fx(171),
  pg_temp.fx(172), pg_temp.fx(6))), 'COMMIT', 'an import of that affaire, mapped, its rows committed');
create function pg_temp.race_confirm(rows integer[]) returns text language sql stable as $$
  select format($call$select public.record_dpgf_import_confirmation((select tenant_id from public.dpgf_imports where id = %L),
    %L, %L, %L, %L, null, '[{"rowIndex":1,"kind":"ignore","level":null}]', '[{"rowIndex":1,"reason":"user_ignored"}]',
    %L::uuid[])$call$, pg_temp.fx(160), pg_temp.fx(6), pg_temp.fx(160), pg_temp.fx(170), pg_temp.fx(22),
    array(select pg_temp.fx(n) from unnest(rows) n))
$$;
create function pg_temp.race_read() returns table (proof_current boolean, superseded boolean) language sql as $$
  select r.proof_current, r.superseded from extensions.dblink('race_setup', format(
    'select proof_current, superseded from public.read_dpgf_import_confirmation((select tenant_id from public.dpgf_imports
      where id = %L), %L)', pg_temp.fx(160), pg_temp.fx(160))) as r(proof_current boolean, superseded boolean)
$$;
-- An estimate already made from the import, before the confirmation (its lines carry the import).
select is(extensions.dblink_exec('race_setup', format($earlier$
begin;
select public.persist_estimate_creation_atomic((select tenant_id from public.dpgf_imports where id = %1$L), %2$L, %3$L, null,
  %4$L::jsonb, jsonb_build_array(jsonb_build_object('id', %5$L, 'parent_id', null, 'item_type', 'section', 'position', 1,
    'title', 'Import DPGF', 'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('import_id', %1$L,
    'mapping_id', %6$L))), %1$L);
commit;
$earlier$, pg_temp.fx(160), pg_temp.fx(6), pg_temp.fx(22), pg_temp.version_payload(186), pg_temp.fx(187),
  pg_temp.fx(170))), 'COMMIT', 'an estimate made from the import before its confirmation');
-- The previous application version's transaction starts before B's record and creates its estimate after it.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the previous version starts its transaction first');
select is(extensions.dblink_exec('race_b', 'begin; ' || pg_temp.race_confirm(array[171, 172]) || '; commit;'), 'COMMIT',
  'B confirms the rows it read: « ignore the option »');
select results_eq($$ select * from pg_temp.race_read() $$, $$ values (true, false) $$, 'B''s structure is established');
-- A copy of the earlier estimate (« Nouvelle version », or the copy a takeoff preparation makes) carries its lines and
-- decides nothing about the import: B's structure stays established.
select is(extensions.dblink_exec('race_setup', format($copy$
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', %L, true);
select public.duplicate_estimate_version(%L, false);
commit;
$copy$, pg_temp.fx(6), pg_temp.fx(186))), 'COMMIT', 'a member copies the earlier estimate after B''s record');
select results_eq($$ select * from pg_temp.race_read() $$, $$ values (true, false) $$,
  'a copy of an estimate is not a confirmation: B''s structure stays established');
-- The previous application version, with an empty mapping, creates an estimate on the same mapping and rows: it records
-- nothing, its estimate keeps the option (its own choice). Its transaction began before B's record (its now() is
-- earlier), its estimate after it: B's record no longer establishes the structure.
select is(extensions.dblink_exec('race_a', format($previous$
select public.persist_estimate_creation_atomic((select tenant_id from public.dpgf_imports where id = %1$L), %2$L, %3$L, null,
  %4$L::jsonb, jsonb_build_array(jsonb_build_object('id', %5$L, 'parent_id', null, 'item_type', 'section', 'position', 1,
    'title', 'Import DPGF', 'source_provider', 'dpgf', 'source_metadata', jsonb_build_object('import_id', %1$L,
    'mapping_id', %6$L))), %1$L);
commit;
$previous$, pg_temp.fx(160), pg_temp.fx(6), pg_temp.fx(22), pg_temp.version_payload(184), pg_temp.fx(185),
  pg_temp.fx(170))), 'COMMIT', 'the previous version creates an estimate from the import, without a record');
select results_eq($$ select * from pg_temp.race_read() $$, $$ values (true, true) $$,
  'B''s structure is no longer established: the list says so');
-- Two tabs: A's mapping writer inserts a late row after B read the import's rows; B's confirmation refuses.
select is(extensions.dblink_exec('race_a', format($late$
begin;
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, raw_row_id, payload, status)
select %L, tenant_id, id, %L, '{"mapped_row":{"designation":"Option vasque","quantity":"9"}}', 'mapped'
from public.dpgf_imports where id = %L;
commit;
$late$, pg_temp.fx(173), pg_temp.fx(162), pg_temp.fx(160))), 'COMMIT', 'A writes a row of its own mapping');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'B confirms again what it read');
select throws_ok(format('select * from extensions.dblink(%L, %L) as t(id uuid)', 'race_b', pg_temp.race_confirm(array[171, 172])),
  '40001', 'DPGF_IMPORT_CONFIRMATION_ROWS_CHANGED', 'B never certifies rows it did not read');
select is(extensions.dblink_exec('race_b', 'rollback'), 'ROLLBACK', 'nothing of B''s is written');
select is(extensions.dblink_exec('race_setup', format($cleanup$
begin;
delete from public.takeoff_launch_requests where id = %L;
delete from private.takeoff_item_list_order_activation;
delete from public.estimate_projects where id = %L;
delete from auth.users where id = %L;
commit;
$cleanup$, pg_temp.fx(91), pg_temp.fx(22), pg_temp.fx(6))), 'COMMIT', 'the race fixture is removed');
select extensions.dblink_disconnect(session.name) from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

-- 7. The seal of the second measuring order.
-- An automatic request mandated by the owner on a Mac, waiting for its admission (as M4 leaves it before the seal).
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null,
    'hostId', 'urn:uuid:b4200000-0000-4000-8000-000000000099', 'authorizationId', 'autorisation-fictive')
$$;
set local session_replication_role = replica;
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state, payer_id,
  mandate_kind, mandated_at, execution_host_id, mandate_selection)
values (pg_temp.fx(90), pg_temp.fx(10), pg_temp.fx(20), 'automatic', 'initial', pg_temp.fx(90), 'evaluating', pg_temp.fx(1),
  'confirmation', now(), pg_temp.selection() ->> 'hostId', pg_temp.selection());
set local session_replication_role = origin;
create function pg_temp.request() returns public.takeoff_launch_requests language sql stable as $$
  select * from public.takeoff_launch_requests where id = pg_temp.fx(90)
$$;
create function pg_temp.order_manifest(p_revision integer, p_project integer default 20, p_digest text default null)
returns jsonb language sql stable as $$
  select jsonb_build_object('order', jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object(
    'revision_id', r.id, 'revision', r.revision, 'content_sha256', coalesce(p_digest, r.content_sha256),
    'item_count', r.item_count)))
  from public.takeoff_list_revisions r where r.project_id = pg_temp.fx(p_project) and r.revision = p_revision
$$;
select is(private.assert_takeoff_launch_order(pg_temp.request(),
  '{"order":{"kind":"free_extraction","version":1,"list":null}}'), null, 'the free extraction seals no list');
select throws_ok($$ select private.assert_takeoff_launch_order(pg_temp.request(), pg_temp.order_manifest(5)) $$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'before its activation, the second order is refused as before the migration');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');
select is(private.assert_takeoff_launch_order(pg_temp.request(), pg_temp.order_manifest(5)),
  (select id from public.takeoff_list_revisions where project_id = pg_temp.fx(20) and revision = 5),
  'once activated, the affaire''s revision is sealed');
select throws_ok($$ select private.assert_takeoff_launch_order(pg_temp.request(), pg_temp.order_manifest(5, 20,
  repeat('a', 64))) $$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'a digest other than the stored one is refused');
select throws_ok($$ select private.assert_takeoff_launch_order(pg_temp.request(), pg_temp.order_manifest(4)) $$,
  '40001', 'TAKEOFF_LAUNCH_DOSSIER_CHANGED',
  'a revision recorded since the evaluation read the list makes the admission stale, never sealed without it');
-- The seal itself (M4's, replaced): it records the list it sealed on the request.
create function pg_temp.sealed_manifest(p_revision integer) returns jsonb language sql stable as $$
  select pg_temp.order_manifest(p_revision) || jsonb_build_object('format_version', 1, 'intent', 'initial',
    'units', jsonb_build_array(jsonb_build_object('key', 'grouped', 'plans', jsonb_build_array('plan-fictif'))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', 'plan-fictif')), 'budget', jsonb_build_object('tokens', 1000,
    'cost_cents', 0))
$$;
create function pg_temp.snapshot() returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'confirmed_by', pg_temp.fx(1), 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('can_launch', true), 'preparation', jsonb_build_object(
      'processing', jsonb_build_object('level', 'C', 'provider', 'chatgpt'), 'destination', jsonb_build_object('kind', 'analysis_only')))
$$;
select throws_ok($$ select private.seal_takeoff_launch_request(pg_temp.request(), pg_temp.sealed_manifest(4), pg_temp.snapshot(), 0) $$,
  '40001', 'TAKEOFF_LAUNCH_DOSSIER_CHANGED', 'the seal refuses a list that is no longer the latest');
select results_eq($$ select r.state, r.item_list_revision_id, r.manifest #>> '{order,kind}'
  from private.seal_takeoff_launch_request(pg_temp.request(), pg_temp.sealed_manifest(5), pg_temp.snapshot(), 0) r $$,
  $$ select 'admitted'::text, id, 'item_list'::text from public.takeoff_list_revisions
    where project_id = pg_temp.fx(20) and revision = 5 $$,
  'the seal admits the request and records the revision it sealed');
select throws_ok($$ delete from public.takeoff_list_revisions where project_id = pg_temp.fx(20) and revision = 5 $$, '23503', null,
  'a sealed revision outlives any attempt to delete it while its request exists');
select results_eq($$ select revision from pg_temp.record(2, 0, 208, 'initial', jsonb_build_array(
  pg_temp.entry(110, '["manual","x"]', 'Poste de l''autre affaire', jsonb_build_object('kind', 'manual', 'intentId', 'x',
    'addedBy', pg_temp.fx(2), 'addedAt', '2026-11-21T00:00:00Z', 'addedInRevision', 1))), project => 21) $$,
  $$ values (1) $$, 'another affaire has its own list');
select throws_ok($$ select private.assert_takeoff_launch_order(pg_temp.request(), pg_temp.order_manifest(1, 21)) $$,
  '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID', 'another affaire''s revision is never sealed');
select throws_ok($$ select private.assert_takeoff_launch_order(pg_temp.request(),
  '{"order":{"kind":"item_list","version":2,"list":null}}') $$, '22023', 'TAKEOFF_LAUNCH_SEAL_INVALID',
  'the second order names its list');
select ok('ITEM_LIST_TO_PREPARE' = any (private.takeoff_launch_transient_reasons()),
  'a list to prepare is retried by the Mac of the mandate');

-- The key of an import's notes digests: one per tenant, kept, never readable by a member (a digest of short notes
-- cannot be reversed by trying every value without it).
select matches(public.takeoff_item_list_notes_key(pg_temp.fx(10)), '^[0-9a-f]{64}$', 'a tenant gets a notes key');
select is(public.takeoff_item_list_notes_key(pg_temp.fx(10)), public.takeoff_item_list_notes_key(pg_temp.fx(10)),
  'the same key every time');
select isnt(public.takeoff_item_list_notes_key(pg_temp.fx(11)), public.takeoff_item_list_notes_key(pg_temp.fx(10)),
  'another tenant gets another key');
select ok(not has_function_privilege('authenticated', 'public.takeoff_item_list_notes_key(uuid)', 'execute')
  and not has_table_privilege('authenticated', 'private.takeoff_item_list_keys', 'select'),
  'a member reads no notes key');

select * from finish();
rollback;
