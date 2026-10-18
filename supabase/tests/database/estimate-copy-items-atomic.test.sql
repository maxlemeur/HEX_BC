-- Copies into a v1/v2 draft (public.copy_estimate_items_atomic): one statement instead of one PostgREST insert whose
-- items each ran the insert policy and the per-item triggers under RLS; ~1 000 items exceeded the 8 s
-- statement_timeout of the API roles (57014). Contract and proofs: docs/testing/copy-large-v2.md.
-- Isolation: the function is security definer and callable by any authenticated user through PostgREST, so its
-- authorization is the boundary, and the journeys reach it only through the estimate API, which checks the same
-- things first. The equivalence of the stored rows, revisions and audit rows with the per-item path, and the single
-- version update at 1 000 items (the per-item bump coming back), are not observable from a journey before the
-- timeout itself.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

\ir ../fixtures/copy-items-estimate.sql

-- Versions: S source (12 lines), R reference and C candidate (empty), K at scale (empty), A for the refusals, M a
-- merge target (2 lines), N the admin's (empty), and the sources of the 999-line copy.
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000101', 12, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000301') is not null as source_created;
select pg_temp.cp29_version(id, 0, '29300000-0000-4000-8000-000000000001', session) is null as empty_created
from (values ('29300000-0000-4000-8000-000000000102'::uuid, '29300000-0000-4000-8000-000000000302'::uuid),
  ('29300000-0000-4000-8000-000000000103', '29300000-0000-4000-8000-000000000303'),
  ('29300000-0000-4000-8000-000000000104', '29300000-0000-4000-8000-000000000304'),
  ('29300000-0000-4000-8000-000000000105', '29300000-0000-4000-8000-000000000305'),
  ('29300000-0000-4000-8000-000000000109', '29300000-0000-4000-8000-000000000309')) as version(id, session);
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000106', 2, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000306') is not null as merge_target_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000107', 0, '29300000-0000-4000-8000-000000000002',
  '29300000-0000-4000-8000-000000000307') is null as admin_target_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000108', 999, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000308') is not null as large_source_created;
select set_config('test.section', (select id::text from public.estimate_items
  where version_id = '29300000-0000-4000-8000-000000000101' and parent_id is null), true);
select set_config('test.large_section', (select id::text from public.estimate_items
  where version_id = '29300000-0000-4000-8000-000000000108' and parent_id is null), true);

-- Grants: the API role only.
select ok(has_function_privilege('authenticated', 'public.copy_estimate_items_atomic(uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.copy_estimate_items_atomic(uuid,uuid,jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.copy_estimate_items_atomic(uuid,uuid,jsonb)', 'execute'),
  'copy_estimate_items_atomic is executable by authenticated only');

-- Equivalence: the same 13 items written by the per-item path (a PostgREST insert as the owner) into R and by the
-- function into C.
select set_config('test.updates_before', pg_temp.cp29_updates()::text, true);
select set_config('request.jwt.claims', '{"sub":"29300000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, aid, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier,
  labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id, category_id,
  supply_type_id, selected_supplier_price_id, source_provider, source_job_id, source_file_name, source_page,
  source_metadata, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
select id, tenant_id, version_id, parent_id, item_type, position, title, aid, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, h_mo_atelier, k_mo_atelier,
  labor_role_atelier_id, h_mo_chantier, k_mo_chantier, labor_role_chantier_id, pu_ht_cents, labor_role_id, category_id,
  supply_type_id, selected_supplier_price_id, source_provider, source_job_id, source_file_name, source_page,
  source_metadata, line_total_ht_cents, line_tax_cents, line_total_ttc_cents
from jsonb_populate_recordset(null::public.estimate_items,
  pg_temp.cp29_copy(current_setting('test.section')::uuid, '29300000-0000-4000-8000-000000000102', 1));
select set_config('role', 'none', true);
select set_config('request.jwt.claims', '', true);
select set_config('test.updates_reference', (pg_temp.cp29_updates() - current_setting('test.updates_before')::bigint)::text, true);

select set_config('test.updates_before', pg_temp.cp29_updates()::text, true);
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000103',
  '29300000-0000-4000-8000-000000000303',
  pg_temp.cp29_copy(current_setting('test.section')::uuid, '29300000-0000-4000-8000-000000000103', 1)), 'ok',
  'the owner copies a section of 12 lines into a draft whose lock this page holds');
select set_config('test.updates_candidate', (pg_temp.cp29_updates() - current_setting('test.updates_before')::bigint)::text, true);

select is(current_setting('test.updates_reference') || '|' || current_setting('test.updates_candidate'), '13|1',
  'the version takes one content revision update per item on the per-item path, one for the whole copy');

select results_eq(
  $$select to_jsonb(item) - array['id', 'version_id', 'parent_id', 'created_at', 'updated_at']
    from public.estimate_items item where item.version_id = '29300000-0000-4000-8000-000000000102'
    order by item.parent_id nulls first, item.position$$,
  $$select to_jsonb(item) - array['id', 'version_id', 'parent_id', 'created_at', 'updated_at']
    from public.estimate_items item where item.version_id = '29300000-0000-4000-8000-000000000103'
    order by item.parent_id nulls first, item.position$$,
  'the copy stores the same rows as the per-item insert (every column but ids and timestamps)');

select is(
  (select content_revision from public.estimate_versions where id = '29300000-0000-4000-8000-000000000103'),
  (select content_revision from public.estimate_versions where id = '29300000-0000-4000-8000-000000000102'),
  'the copy raises the content revision as the per-item insert does (one step per item)');

select results_eq(
  $$select audit.table_name, audit.action, audit.user_id, audit.before_data->>'content_revision',
      audit.after_data->>'content_revision', audit.after_data - array['id', 'version_id', 'parent_id', 'created_at',
        'updated_at', 'content_revision', 'version_number']
    from public.audit_logs audit where audit.estimate_version_id = '29300000-0000-4000-8000-000000000102'
      and audit.created_at = now() and (audit.table_name, audit.action) in (('estimate_items', 'INSERT'), ('estimate_versions', 'UPDATE'))
      order by audit.table_name, audit.after_data->>'content_revision',
      audit.after_data->>'parent_id' nulls first, audit.after_data->>'position'$$,
  $$select audit.table_name, audit.action, audit.user_id, audit.before_data->>'content_revision',
      audit.after_data->>'content_revision', audit.after_data - array['id', 'version_id', 'parent_id', 'created_at',
        'updated_at', 'content_revision', 'version_number']
    from public.audit_logs audit where audit.estimate_version_id = '29300000-0000-4000-8000-000000000103'
      and audit.created_at = now() and (audit.table_name, audit.action) in (('estimate_items', 'INSERT'), ('estimate_versions', 'UPDATE'))
      order by audit.table_name, audit.after_data->>'content_revision',
      audit.after_data->>'parent_id' nulls first, audit.after_data->>'position'$$,
  'the copy journals the same audit rows, under the same user, as the per-item insert');

select is(
  (select count(*) || '|' || count(*) filter (where user_id = '29300000-0000-4000-8000-000000000001')
    from public.audit_logs where estimate_version_id = '29300000-0000-4000-8000-000000000103' and created_at = now()
      and ((table_name = 'estimate_items' and action = 'INSERT') or (table_name = 'estimate_versions' and action = 'UPDATE'))),
  '26|26',
  'the copy journals 13 item inserts and 13 revision steps, all under the requesting user');

-- The contract is closed after the copy: a later write of that version runs the per-item effects again.
select is(coalesce(current_setting('miaouffrage.estimate_creation_atomic', true), ''), '',
  'the copy leaves no creation contract bound in its transaction');
select set_config('test.updates_before', pg_temp.cp29_updates()::text, true);
insert into public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000103', null, 'section', 9, 'Après');
select is(pg_temp.cp29_updates() - current_setting('test.updates_before')::bigint, 1::bigint,
  'an item written after the copy bumps its version itself');

-- Scale: 1 000 items (a section of 999 lines) in one statement, one version update, one revision step per item.
select set_config('test.revision_before', (select content_revision::text from public.estimate_versions
  where id = '29300000-0000-4000-8000-000000000104'), true);
select set_config('test.updates_before', pg_temp.cp29_updates()::text, true);
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000104',
  '29300000-0000-4000-8000-000000000304',
  pg_temp.cp29_copy(current_setting('test.large_section')::uuid, '29300000-0000-4000-8000-000000000104', 1)), 'ok',
  'a section of 999 lines (1 000 items) is copied in one statement');
select is(
  (pg_temp.cp29_updates() - current_setting('test.updates_before')::bigint) || '|'
    || ((select content_revision from public.estimate_versions where id = '29300000-0000-4000-8000-000000000104')
      - current_setting('test.revision_before')::bigint) || '|'
    || (select count(*) from public.estimate_items where version_id = '29300000-0000-4000-8000-000000000104') || '|'
    || (select count(*) from public.audit_logs where estimate_version_id = '29300000-0000-4000-8000-000000000104'
      and table_name = 'estimate_items' and action = 'INSERT'),
  '1|1000|1000|1000',
  'the 1 000-item copy updates its version once, raises its revision by 1 000 and journals 1 000 item inserts');

-- Merge: lines appended under a section of the target that is not in the payload.
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000106',
  '29300000-0000-4000-8000-000000000306',
  pg_temp.cp29_copy(current_setting('test.section')::uuid, '29300000-0000-4000-8000-000000000106', 0,
    (select id from public.estimate_items where version_id = '29300000-0000-4000-8000-000000000106' and parent_id is null), 2)),
  'ok', 'lines are copied under an existing section of the draft (merge)');
select is((select count(*) || '|' || min(position) || '|' || max(position) from public.estimate_items
    where version_id = '29300000-0000-4000-8000-000000000106' and item_type = 'line'), '14|1|14',
  'the merged lines follow the 2 existing lines');

-- An admin of the tenant copies into a draft of another user's affaire, as the insert policy allows.
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000002', '29300000-0000-4000-8000-000000000107',
  '29300000-0000-4000-8000-000000000307',
  pg_temp.cp29_copy(current_setting('test.section')::uuid, '29300000-0000-4000-8000-000000000107', 1)), 'ok',
  'a tenant admin copies into a draft of an affaire owned by another user');

-- Depth over the sections already in the draft (review finding): D holds Niveau 1 > Niveau 2 > Niveau 3 and a line
-- under Niveau 3 (max_section_depth 3). Before #59 the replay walked only as many parents as there were items (one
-- here) and let a section in at level 4; it now walks up to max_section_depth + 1.
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values ('29300000-0000-4000-8000-000000000501', current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000109', null, 'section', 1, 'Niveau 1'),
  ('29300000-0000-4000-8000-000000000502', current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000109', '29300000-0000-4000-8000-000000000501', 'section', 1, 'Niveau 2'),
  ('29300000-0000-4000-8000-000000000503', current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000109', '29300000-0000-4000-8000-000000000502', 'section', 1, 'Niveau 3');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents,
  line_total_ttc_cents)
values ('29300000-0000-4000-8000-000000000504', current_setting('test.tenant_id')::uuid,
  '29300000-0000-4000-8000-000000000109', '29300000-0000-4000-8000-000000000503', 'line', 1, 'Ligne 3', 'u', 1, 0, 2000,
  1, 0, 1, 1, 0, 0, 0, 0);
-- One copied item into D: a section shaped like S's root section, or a line shaped like S's first line.
create function pg_temp.cp29_one(p_item_type text, p_parent uuid, p_position integer) returns jsonb language sql as $$
  select jsonb_build_array(pg_temp.cp29_item(item, '29300000-0000-4000-8000-000000000109', gen_random_uuid(), p_parent,
    p_position, 'Profondeur'))
  from public.estimate_items item
  where item.version_id = '29300000-0000-4000-8000-000000000101' and item.item_type::text = p_item_type
  order by item.parent_id nulls first, item.position
  limit 1
$$;
select results_eq(
  $$select pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000109',
      '29300000-0000-4000-8000-000000000309', pg_temp.cp29_one(item_type, parent, position))
    -- Case 4 takes a position free under that foreign section, so that only the parent is wrong.
    from (values (1, 'section', '29300000-0000-4000-8000-000000000503'::uuid, 9),
      (2, 'line', '29300000-0000-4000-8000-000000000503', 9),
      (3, 'section', '29300000-0000-4000-8000-000000000502', 9),
      (4, 'section', current_setting('test.section')::uuid, 99),
      (5, 'line', '29300000-0000-4000-8000-000000000504', 9)) as call(n, item_type, parent, position)
    order by n$$,
  $$values ('P0001 Profondeur de section depassee (max 3).'), ('ok'), ('ok'),
    ('P0001 parent_id invalide pour estimate_items'), ('P0001 Le parent doit etre une section.')$$,
  'depth is checked over the sections already in the draft: no level-4 section, lines and level-3 sections accepted, no parent of another version, no line as parent');

select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', upper('29300000-0000-4000-8000-000000000109')::uuid,
  '29300000-0000-4000-8000-000000000309',
  (select jsonb_agg(item || jsonb_build_object('version_id', upper(item->>'version_id'), 'tenant_id', upper(item->>'tenant_id')))
    from jsonb_array_elements(pg_temp.cp29_one('section', null, 9)) item)), 'ok',
  'a payload naming its version and tenant in upper case is accepted, as the PostgREST insert accepted it');

-- Refusals, each before any write: version A (empty, the owner's lock 305).
select set_config('test.items', pg_temp.cp29_copy(current_setting('test.section')::uuid,
  '29300000-0000-4000-8000-000000000105', 1)::text, true);
select results_eq(
  $$select pg_temp.cp29_call(actor, '29300000-0000-4000-8000-000000000105', session, current_setting('test.items')::jsonb)
    from (values (null::uuid, '29300000-0000-4000-8000-000000000305'::uuid, 1),
      ('29300000-0000-4000-8000-000000000005', '29300000-0000-4000-8000-000000000305', 2),
      ('29300000-0000-4000-8000-000000000004', '29300000-0000-4000-8000-000000000305', 3),
      ('29300000-0000-4000-8000-000000000003', '29300000-0000-4000-8000-000000000305', 4),
      ('29300000-0000-4000-8000-000000000001', null, 5),
      ('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000399', 6),
      ('29300000-0000-4000-8000-000000000002', '29300000-0000-4000-8000-000000000305', 7)) as call(actor, session, n)
    order by n$$,
  $$values ('42501 ESTIMATE_COPY_FORBIDDEN'), ('42501 ESTIMATE_COPY_FORBIDDEN'), ('42501 ESTIMATE_COPY_FORBIDDEN'),
    ('42501 ESTIMATE_COPY_FORBIDDEN'), ('55000 ESTIMATE_COPY_LOCK_REQUIRED'), ('55000 ESTIMATE_COPY_LOCK_REQUIRED'),
    ('55000 ESTIMATE_COPY_LOCK_REQUIRED')$$,
  'no user, another tenant, a viewer, a non-owner engineer are forbidden; no session, another session, another user''s lock need the lock');

update public.draft_locks set expires_at = statement_timestamp() - interval '1 second'
where version_id = '29300000-0000-4000-8000-000000000105';
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000105',
  '29300000-0000-4000-8000-000000000305', current_setting('test.items')::jsonb), '55000 ESTIMATE_COPY_LOCK_REQUIRED',
  'an expired lease is not a lock');
update public.draft_locks set expires_at = statement_timestamp() + interval '30 minutes'
where version_id = '29300000-0000-4000-8000-000000000105';

select results_eq(
  $$select pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000105',
      '29300000-0000-4000-8000-000000000305', payload)
    from (values
      (1, '[]'::jsonb),
      (2, jsonb_build_array((current_setting('test.items')::jsonb->0) - 'aid')),
      (3, jsonb_build_array((current_setting('test.items')::jsonb->0) || '{"line_nature":"supply"}')),
      (4, jsonb_build_array((current_setting('test.items')::jsonb->0) || '{"version_id":"29300000-0000-4000-8000-000000000101"}')),
      (5, jsonb_build_array((current_setting('test.items')::jsonb->0) || jsonb_build_object('tenant_id', gen_random_uuid()))),
      (6, jsonb_build_array(current_setting('test.items')::jsonb->0, current_setting('test.items')::jsonb->0)),
      (7, jsonb_build_array(current_setting('test.items')::jsonb->1, current_setting('test.items')::jsonb->0)),
      (8, jsonb_build_array((current_setting('test.items')::jsonb->1) || '{"parent_id":null}'))) as call(n, payload)
    order by n$$,
  $$values ('22023 ESTIMATE_COPY_ITEMS_INVALID'), ('22023 ESTIMATE_COPY_ITEMS_INVALID'), ('22023 ESTIMATE_COPY_ITEMS_INVALID'),
    ('22023 ESTIMATE_COPY_ITEMS_INVALID'), ('22023 ESTIMATE_COPY_ITEMS_INVALID'), ('22023 ESTIMATE_COPY_ITEMS_INVALID'),
    ('22023 ESTIMATE_COPY_ITEMS_INVALID'), ('P0001 Une ligne doit etre rattachee a une section.')$$,
  'an empty, incomplete, widened, misdirected, duplicated or misordered payload is refused, and the depth check still applies');

select is((select count(*) from public.estimate_items where version_id = '29300000-0000-4000-8000-000000000105'),
  0::bigint, 'no refused copy wrote an item');

-- A version that is no longer a draft, or a v3, is refused (status and engine set past their guards).
set local session_replication_role = replica;
update public.estimate_versions set status = 'sent' where id = '29300000-0000-4000-8000-000000000105';
set local session_replication_role = origin;
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000105',
  '29300000-0000-4000-8000-000000000305', current_setting('test.items')::jsonb), '42501 ESTIMATE_VERSION_READ_ONLY',
  'a version that is not a draft is read only');
set local session_replication_role = replica;
update public.estimate_versions set status = 'draft', calc_engine_version = 3, sale_coefficient_fo = 1,
  sale_coefficient_mo = 1, gross_ht_cents = 0, discount_applied_cents = 0, commercial_rounding_cents = 0
where id = '29300000-0000-4000-8000-000000000105';
set local session_replication_role = origin;
select is(pg_temp.cp29_call('29300000-0000-4000-8000-000000000001', '29300000-0000-4000-8000-000000000105',
  '29300000-0000-4000-8000-000000000305', current_setting('test.items')::jsonb), '0A000 ESTIMATE_V3_WRITER_NOT_SUPPORTED',
  'a v3 draft is written by the batch writer, not by this copy');

select * from finish();
rollback;
