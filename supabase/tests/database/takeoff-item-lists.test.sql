-- Lot 4, migration A (20261121180813_takeoff_item_lists.sql): the list of items of an affaire and the item templates.
-- 1. Who may read and write: the takeoff operator of the affaire writes its list, its readers read it; an administrator
--    of the tenant publishes a template; nobody writes a table directly.
-- 2. The identity rule: an origin key keeps its item across revisions, retirement and return; a new key takes an existing
--    item only as an accepted continuity; an item is never another affaire's.
-- 3. A revision is immutable, its digest is the database's own over what it stored, a gesture replayed returns it and
--    another submission under the same key is a conflict; a stale revision refuses.
-- 4. The proof of an import's confirmation stops matching when the rows, their measured fields or the mapping change.
-- 5. The lineage of mapped rows keeps the line → raw row join after a remapping.
-- 6. The seal of the second measuring order: refused before its activation, then only with the affaire's own revision.
-- 7. Two writers of one list at once: the second waits for the first, then refuses as stale.
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
  'record_takeoff_list_revision(uuid, uuid, uuid, integer, uuid, text, jsonb, jsonb, jsonb)',
  'save_takeoff_item_template_draft(uuid, uuid, text, integer, integer, jsonb)',
  'publish_takeoff_item_template(uuid, uuid, text, integer, uuid)',
  'discard_takeoff_item_template_draft(uuid, uuid, text, integer)',
  'record_dpgf_import_confirmation(uuid, uuid, uuid, uuid, uuid, uuid, jsonb)',
  'persist_dpgf_import_estimate_atomic(uuid, uuid, uuid, jsonb, jsonb, jsonb, uuid, uuid, jsonb)',
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

-- 2. Templates.
create function pg_temp.template(label text, extra_id text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('contract', 1, 'title', 'Plomberie', 'families', jsonb_build_array(jsonb_build_object(
    'id', 'sanitaires', 'title', 'Appareils sanitaires', 'lines', jsonb_build_array(
      jsonb_build_object('id', 'lavabo', 'label', label, 'expectedUnit', 'u', 'measurementBasis', 'Comptage',
        'qualifiers', '{}'::jsonb, 'synonyms', jsonb_build_array('Vasque'))
    ) || case when extra_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('id', extra_id,
      'label', 'WC', 'expectedUnit', 'u', 'measurementBasis', null, 'qualifiers', '{}'::jsonb, 'synonyms', '[]'::jsonb)) end)))
$$;
select throws_ok($$ select public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(1), 'plomberie', 0, 1,
  pg_temp.template('Lavabo')) $$, '42501', 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN', 'an engineer does not edit the template');
select throws_ok($$ select public.save_takeoff_item_template_draft(pg_temp.fx(11), pg_temp.fx(5), 'plomberie', 0, 1,
  pg_temp.template('Lavabo')) $$, '42501', 'TAKEOFF_ITEM_TEMPLATE_FORBIDDEN', 'an administrator of another tenant neither');
select throws_ok($$ select public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 0, 1,
  pg_temp.template('Lavabo', 'lavabo')) $$, '22023', 'TAKEOFF_ITEM_TEMPLATE_INVALID',
  'two lines of one template never share an identifier');
select is(public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 0, 1,
  pg_temp.template('Lavabo sur colonne')), 1, 'the administrator saves a first draft on the shipped version');
select throws_ok($$ select public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 0, 1,
  pg_temp.template('Lavabo')) $$, '40001', 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'a draft saved from an older view refuses');
select is(public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 1, 1,
  pg_temp.template('Lavabo sur colonne', 'wc')), 2, 'the next save names the revision it replaces');
select throws_ok($$ select * from public.publish_takeoff_item_template(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 1,
  pg_temp.fx(900)) $$, '40001', 'TAKEOFF_ITEM_TEMPLATE_DRAFT_STALE', 'publishing a draft not seen refuses');
select results_eq($$ select version, replayed from public.publish_takeoff_item_template(pg_temp.fx(10), pg_temp.fx(5),
  'plomberie', 2, pg_temp.fx(900)) $$, $$ values (2, false) $$, 'the draft becomes version 2, after the shipped version 1');
select results_eq($$ select version, replayed from public.publish_takeoff_item_template(pg_temp.fx(10), pg_temp.fx(5),
  'plomberie', 2, pg_temp.fx(900)) $$, $$ values (2, true) $$, 'the same gesture again returns the same version');
select is((select count(*)::integer from public.takeoff_item_template_drafts where tenant_id = pg_temp.fx(10)), 0,
  'the published draft is gone');
select is((select line_count from public.takeoff_item_template_versions where tenant_id = pg_temp.fx(10)), 2,
  'the version counts its lines');
select throws_ok($$ select public.save_takeoff_item_template_draft(pg_temp.fx(10), pg_temp.fx(5), 'plomberie', 0, 1,
  pg_temp.template('Lavabo')) $$, '40001', 'TAKEOFF_ITEM_TEMPLATE_STALE', 'a draft on a version no longer the latest refuses');
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
create function pg_temp.record(actor integer, expected integer, intent integer, cause text, entries jsonb,
  continuities jsonb default '[]'::jsonb, project integer default 20, tenant integer default 10)
returns table (revision_id uuid, revision integer, content_sha256 text, replayed boolean) language sql as $$
  select * from public.record_takeoff_list_revision(pg_temp.fx(tenant), pg_temp.fx(project), pg_temp.fx(actor), expected,
    pg_temp.fx(intent), cause, '{"dpgf":{"importId":"fictif"}}'::jsonb, entries, continuities)
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
select throws_ok($$ select public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60),
  pg_temp.fx(70), pg_temp.fx(20), null, '[{"rowIndex":0,"kind":"section","level":3}]') $$, '22023',
  'DPGF_IMPORT_CONFIRMATION_INVALID', 'a decision names a level 1 or 2');
select throws_ok($$ select public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60),
  pg_temp.fx(99), pg_temp.fx(20), null, '[]') $$, '40001', 'DPGF_IMPORT_CONFIRMATION_STALE',
  'a confirmation binds to the latest mapping of its import');
select isnt(public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60), pg_temp.fx(70),
  pg_temp.fx(20), null, '[{"rowIndex":0,"kind":"section","level":1},{"rowIndex":1,"kind":"ignore","level":null}]'), null,
  'a confirmation records its decisions');
select results_eq($$ select proof_current, row_count, decisions -> 1 ->> 'kind'
  from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60)) $$,
  $$ values (true, 2, 'ignore'::text) $$, 'its proof matches what the import holds');
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
-- A confirmation of the previous version: a new mapping and new mapped rows, no decision recorded.
insert into public.dpgf_mappings (id, tenant_id, import_id, status, column_mapping)
values (pg_temp.fx(73), pg_temp.fx(10), pg_temp.fx(60), 'validated', '{"Designation":"designation","Qte":"quantity"}');
select is((select proof_current from public.read_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(60))), false,
  'a later mapping: the earlier confirmation''s decisions are not applied');
delete from public.dpgf_rows_mapped where import_id = pg_temp.fx(60);
insert into public.dpgf_rows_mapped (id, tenant_id, import_id, raw_row_id, payload, status) values
  (pg_temp.fx(74), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(61), '{"mapped_row":{"designation":"Bâtiment A"}}', 'mapped'),
  (pg_temp.fx(75), pg_temp.fx(10), pg_temp.fx(60), pg_temp.fx(62),
    '{"mapped_row":{"designation":"Lavabo","quantity":"2"}}', 'mapped');
select isnt(public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60), pg_temp.fx(73),
  pg_temp.fx(20), null, '[]'), null, 'a new confirmation records the new decisions');
select results_eq($$ select proof_current, jsonb_array_length(decisions) from public.read_dpgf_import_confirmation(
  pg_temp.fx(10), pg_temp.fx(60)) $$, $$ values (true, 0) $$, 'the latest confirmation is the one read');

-- 5. Lineage: every mapped row inserted, and those that existed before the migration.
select results_eq($$ select mapped_row_id, raw_row_id from private.dpgf_mapped_row_lineage
  where import_id = pg_temp.fx(60) order by mapped_row_id $$,
  $$ values (pg_temp.fx(71), pg_temp.fx(61)), (pg_temp.fx(72), pg_temp.fx(62)), (pg_temp.fx(74), pg_temp.fx(61)),
    (pg_temp.fx(75), pg_temp.fx(62)) $$, 'each mapped row is linked to its raw row when it is inserted, and stays linked');
set local session_replication_role = replica;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, title)
values (pg_temp.fx(80), pg_temp.fx(10), pg_temp.fx(20), 1, 'draft', 'Devis fictif');
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title, fo_provision, source_metadata)
values (pg_temp.fx(81), pg_temp.fx(10), pg_temp.fx(80), 'section', 0, 'Lavabo', 1,
  jsonb_build_object('import_id', pg_temp.fx(60), 'mapped_row_id', pg_temp.fx(72), 'row_index', 1));
set local session_replication_role = origin;
select results_eq($$ select estimate_item_id, raw_row_id from public.read_estimate_dpgf_raw_rows(pg_temp.fx(10), pg_temp.fx(80)) $$,
  $$ values (pg_temp.fx(81), pg_temp.fx(62)) $$, 'a line made before the remapping still reaches its raw row');

select isnt(public.record_dpgf_import_confirmation(pg_temp.fx(10), pg_temp.fx(2), pg_temp.fx(60), pg_temp.fx(73),
  pg_temp.fx(20), pg_temp.fx(80), '[]'), null, 'a confirmation names the version it created');
set local session_replication_role = replica;
delete from public.estimate_items where version_id = pg_temp.fx(80);
set local session_replication_role = origin;
-- With the foreign keys' actions: a draft deleted as its owner's server does.
delete from public.estimate_versions where id = pg_temp.fx(80);
select is((select count(*)::integer from public.dpgf_import_confirmations where estimate_version_id = pg_temp.fx(80)), 0,
  'deleting that version clears the reference and keeps the confirmation');

-- 6. The seal of the second measuring order.
set local session_replication_role = replica;
insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state)
values (pg_temp.fx(90), pg_temp.fx(10), pg_temp.fx(20), 'automatic', 'initial', pg_temp.fx(90), 'evaluating');
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

-- 7. Two writers at once.
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
create function pg_temp.race_call(intent integer, label text) returns text language sql stable as $$
  select format($call$select revision from public.record_takeoff_list_revision(
    (select tenant_id from public.estimate_projects where id = %L), %L, %L, 0, %L, 'initial', '{}', %L)$call$,
    pg_temp.fx(22), pg_temp.fx(22), pg_temp.fx(6), pg_temp.fx(intent),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.fx(intent), 'source_key', '["manual","' || intent || '"]',
      'label', label, 'expected_unit', null, 'measurement_basis', null, 'qualifiers', '{}'::jsonb, 'sections', '[]'::jsonb,
      'synonyms', '[]'::jsonb, 'origin', jsonb_build_object('kind', 'manual', 'intentId', intent::text,
      'addedBy', pg_temp.fx(6), 'addedAt', '2026-11-21T00:00:00Z', 'addedInRevision', 1), 'reference_quantity', null)))
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
select is(extensions.dblink_exec('race_setup', format($cleanup$
begin;
delete from public.estimate_projects where id = %L;
delete from auth.users where id = %L;
commit;
$cleanup$, pg_temp.fx(22), pg_temp.fx(6))), 'COMMIT', 'the race fixture is removed');
select extensions.dblink_disconnect(session.name) from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

select * from finish();
rollback;
