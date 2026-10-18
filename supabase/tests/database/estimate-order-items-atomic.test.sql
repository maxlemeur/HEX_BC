-- Reorder and move write the per-row effects of their item updates in one pass (content revision steps and audit
-- rows), after checking once what the update policy of estimate_items checked per row. About 1 000 siblings exceeded
-- the 8 s statement timeout of the API roles at the CI load factor. Contract: docs/testing/reorder-move-large-v2.md.
-- Isolation: the equivalence of every audit row with the per-row path, the refusals of the new security definer
-- boundary to direct RPC calls and the bounds of the session contract are not observable from a journey.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

\ir ../fixtures/order-items-estimate.sql

-- Three copies of one tree: R (reference, the statements before this change under RLS, per-row triggers), C (the
-- RPCs), D (refused callers). Lot A: A1..A6 then Sous-lot (S1, S2); Lot B: B1..B3; Lot C empty.
create function pg_temp.ro29_tree(p_prefix text) returns jsonb language sql as $$
  select jsonb_build_array(
    pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000001'), null, 1, 'Lot A'),
    pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000002'), null, 2, 'Lot B'),
    pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000003'), null, 3, 'Lot C'))
  || (select jsonb_agg(pg_temp.ro29_line(pg_temp.ro29_id(p_prefix, '0000000000' || (10 + g)::text),
        pg_temp.ro29_id(p_prefix, '000000000001'), g, 'A' || g) order by g) from generate_series(1, 6) g)
  || jsonb_build_array(pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000017'),
        pg_temp.ro29_id(p_prefix, '000000000001'), 7, 'Sous-lot'))
  || (select jsonb_agg(pg_temp.ro29_line(pg_temp.ro29_id(p_prefix, '0000000000' || (20 + g)::text),
        pg_temp.ro29_id(p_prefix, '000000000017'), g, 'S' || g) order by g) from generate_series(1, 2) g)
  || (select jsonb_agg(pg_temp.ro29_line(pg_temp.ro29_id(p_prefix, '0000000000' || (30 + g)::text),
        pg_temp.ro29_id(p_prefix, '000000000002'), g, 'B' || g) order by g) from generate_series(1, 3) g)
$$;
select pg_temp.ro29_version('29500000-0000-4000-8000-000000000010', '29500000-0000-4000-8000-000000000101',
  pg_temp.ro29_tree('29500000-0000-4000-8100-'));
select pg_temp.ro29_version('29500000-0000-4000-8000-000000000011', '29500000-0000-4000-8000-000000000102',
  pg_temp.ro29_tree('29500000-0000-4000-8200-'));
select pg_temp.ro29_version('29500000-0000-4000-8000-000000000012', '29500000-0000-4000-8000-000000000103',
  pg_temp.ro29_tree('29500000-0000-4000-8300-'));

-- Source coverage on R and C: one requirement linked to A1 (moved in step 2), one scoped to S2 (moved with Sous-lot
-- in step 3), one linked to B3 (only renumbered).
create function pg_temp.ro29_coverage(p_version uuid, p_prefix text, p_tag text) returns void language sql as $$
  insert into private.estimate_source_reviews (id, tenant_id, project_id, version_id)
  select ('29500000-0000-4000-8' || p_tag || '-000000000201')::uuid, version.tenant_id, version.project_id, version.id
  from public.estimate_versions version where version.id = p_version;
  insert into private.estimate_source_coverage_requirements (id, review_id, revision, prescription, expected_service, scope)
  select ('29500000-0000-4000-8' || p_tag || '-00000000021' || n)::uuid, ('29500000-0000-4000-8' || p_tag || '-000000000201')::uuid,
    1, 'RO29', 'RO29', case when n = 2 then jsonb_build_object('dpgfLotId', pg_temp.ro29_id(p_prefix, '000000000022')) else '{}'::jsonb end
  from generate_series(1, 3) n;
  insert into private.estimate_source_coverage_links (id, requirement_id, kind, item_id, justification, target_key)
  select gen_random_uuid(), ('29500000-0000-4000-8' || p_tag || '-00000000021' || n)::uuid, 'line',
    pg_temp.ro29_id(p_prefix, case when n = 1 then '000000000011' else '000000000033' end), 'RO29',
    'line:' || pg_temp.ro29_id(p_prefix, case when n = 1 then '000000000011' else '000000000033' end)::text
  from (values (1), (3)) as link(n);
$$;
select pg_temp.ro29_coverage('29500000-0000-4000-8000-000000000101', '29500000-0000-4000-8100-', '100');
select pg_temp.ro29_coverage('29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8200-', '200');

-- The reference: the statements of 008 (reorder) and 20260304212000 (move, its five updates) as the owner under RLS.
create function pg_temp.ro29_reference_reorder(p_version uuid, p_parent uuid, p_ids uuid[]) returns text
language plpgsql as $$
declare
  updated integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '29500000-0000-4000-8000-000000000001',
    'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  with ordered as (select src.id, src.ordinality::integer as position from unnest(p_ids) with ordinality as src(id, ordinality))
  update public.estimate_items item set position = -ordered.position from ordered
  where item.id = ordered.id and item.version_id = p_version
    and ((p_parent is null and item.parent_id is null) or item.parent_id = p_parent);
  with ordered as (select src.id, src.ordinality::integer as position from unnest(p_ids) with ordinality as src(id, ordinality))
  update public.estimate_items item set position = ordered.position from ordered
  where item.id = ordered.id and item.version_id = p_version
    and ((p_parent is null and item.parent_id is null) or item.parent_id = p_parent);
  get diagnostics updated = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return updated::text;
end
$$;

create function pg_temp.ro29_reference_move(p_version uuid, p_item uuid, p_from uuid, p_to uuid, p_source uuid[],
  p_target uuid[]) returns text language plpgsql as $$
declare
  target_position integer;
  source_updated integer;
  target_updated integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '29500000-0000-4000-8000-000000000001',
    'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select o.ordinality into target_position from unnest(p_target) with ordinality as o(id, ordinality) where o.id = p_item;
  update public.estimate_items item set position = -o.ordinality
  from unnest(p_source) with ordinality as o(id, ordinality)
  where item.id = o.id and item.version_id = p_version and item.parent_id is not distinct from p_from and item.id <> p_item;
  update public.estimate_items item set position = -o.ordinality
  from unnest(p_target) with ordinality as o(id, ordinality)
  where item.id = o.id and item.version_id = p_version and item.id <> p_item and item.parent_id is not distinct from p_to;
  update public.estimate_items item set parent_id = p_to, position = -target_position
  where item.id = p_item and item.version_id = p_version;
  update public.estimate_items item set position = o.ordinality
  from unnest(p_source) with ordinality as o(id, ordinality)
  where item.id = o.id and item.version_id = p_version and item.parent_id is not distinct from p_from and item.id <> p_item;
  get diagnostics source_updated = row_count;
  update public.estimate_items item set parent_id = p_to, position = o.ordinality
  from unnest(p_target) with ordinality as o(id, ordinality)
  where item.id = o.id and item.version_id = p_version;
  get diagnostics target_updated = row_count;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return (source_updated + target_updated)::text;
end
$$;

-- The operations, on the tree of `p_prefix` (one id per suffix).
create function pg_temp.ro29_ids(p_prefix text, p_suffixes text[]) returns uuid[] language sql as $$
  select array_agg(pg_temp.ro29_id(p_prefix, suffix) order by ordinality)
  from unnest(p_suffixes) with ordinality as entry(suffix, ordinality)
$$;

create temporary table ro29_operation (step integer primary key, kind text, args jsonb);
insert into ro29_operation values
  -- 1. Lot A reversed (its six lines and Sous-lot).
  (1, 'reorder', jsonb_build_object('parent', '000000000001', 'ids',
    jsonb_build_array('000000000017', '000000000016', '000000000015', '000000000014', '000000000013', '000000000012', '000000000011'))),
  -- 2. A1 moved into Lot B, second.
  (2, 'move', jsonb_build_object('item', '000000000011', 'from', '000000000001', 'to', '000000000002',
    'source', jsonb_build_array('000000000017', '000000000016', '000000000015', '000000000014', '000000000013', '000000000012'),
    'target', jsonb_build_array('000000000031', '000000000011', '000000000032', '000000000033'))),
  -- 3. Sous-lot (with S1, S2) moved into the empty Lot C.
  (3, 'move', jsonb_build_object('item', '000000000017', 'from', '000000000001', 'to', '000000000003',
    'source', jsonb_build_array('000000000016', '000000000015', '000000000014', '000000000013', '000000000012'),
    'target', jsonb_build_array('000000000017'))),
  -- 4. The root sections reversed.
  (4, 'reorder', jsonb_build_object('parent', null, 'ids', jsonb_build_array('000000000003', '000000000002', '000000000001')));

create function pg_temp.ro29_suffixes(p_value jsonb) returns text[] language sql as $$
  select array(select jsonb_array_elements_text(p_value))
$$;

create function pg_temp.ro29_run(p_version uuid, p_prefix text, p_reference boolean) returns text language plpgsql as $$
declare
  operation record;
  outcome text;
  outcomes text[] := '{}';
  parent uuid;
begin
  for operation in select * from ro29_operation order by step loop
    if operation.kind = 'reorder' then
      parent := case when operation.args->>'parent' is null then null else pg_temp.ro29_id(p_prefix, operation.args->>'parent') end;
      outcome := case when p_reference
        then pg_temp.ro29_reference_reorder(p_version, parent, pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'ids')))
        else pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_reorder_sql(p_version, parent,
          pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'ids')))) end;
    else
      outcome := case when p_reference
        then pg_temp.ro29_reference_move(p_version, pg_temp.ro29_id(p_prefix, operation.args->>'item'),
          pg_temp.ro29_id(p_prefix, operation.args->>'from'), pg_temp.ro29_id(p_prefix, operation.args->>'to'),
          pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'source')),
          pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'target')))
        else pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_move_sql(p_version,
          pg_temp.ro29_id(p_prefix, operation.args->>'item'), pg_temp.ro29_id(p_prefix, operation.args->>'from'),
          pg_temp.ro29_id(p_prefix, operation.args->>'to'),
          pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'source')),
          pg_temp.ro29_ids(p_prefix, pg_temp.ro29_suffixes(operation.args->'target')))) end;
    end if;
    outcomes := outcomes || outcome;
  end loop;
  return array_to_string(outcomes, ',');
end
$$;

-- What each version journaled before the operations, and its content revision.
create temporary table ro29_before as
select version.id as version_id, version.content_revision,
  (select array_agg(a.id) from public.audit_logs a where a.estimate_version_id = version.id) as audit_ids
from public.estimate_versions version
where version.id in ('29500000-0000-4000-8000-000000000101', '29500000-0000-4000-8000-000000000102',
  '29500000-0000-4000-8000-000000000103');
create temporary table ro29_coverage_before as
select id, technical_revision from private.estimate_source_coverage_requirements where id::text like '29500000-%';

select set_config('test.updates_before', pg_temp.ro29_version_updates()::text, true);
select is(pg_temp.ro29_run('29500000-0000-4000-8000-000000000101', '29500000-0000-4000-8100-', true), '7,10,6,3',
  'the reference operations update 7, 10, 6 and 3 items as the RPCs report them');
select set_config('test.updates_reference', (pg_temp.ro29_version_updates()
  - current_setting('test.updates_before')::bigint)::text, true);
select set_config('test.updates_before', pg_temp.ro29_version_updates()::text, true);
select is(pg_temp.ro29_run('29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8200-', false), '7,10,6,3',
  'the RPCs reorder and move as the owner and report the same counts');
select set_config('test.updates_candidate', (pg_temp.ro29_version_updates()
  - current_setting('test.updates_before')::bigint)::text, true);

select is(current_setting('test.updates_reference') || '|' || current_setting('test.updates_candidate'), '52|4',
  'the per-row path updates its version once per written row (52), the RPCs once per operation (4)');

-- The tree, by titles.
create function pg_temp.ro29_layout(p_version uuid) returns table(title text, parent_title text, item_position integer,
  item_type text) language sql as $$
  select item.title, parent.title, item.position, item.item_type::text
  from public.estimate_items item left join public.estimate_items parent on parent.id = item.parent_id
  where item.version_id = p_version
$$;
select results_eq(
  $$select * from pg_temp.ro29_layout('29500000-0000-4000-8000-000000000102') order by 2 nulls first, 3$$,
  $$select * from pg_temp.ro29_layout('29500000-0000-4000-8000-000000000101') order by 2 nulls first, 3$$,
  'the RPCs leave every item at the parent and position the per-row path left it');
select results_eq(
  $$select title, parent_title, item_position from pg_temp.ro29_layout('29500000-0000-4000-8000-000000000102')
    where parent_title in ('Lot B', 'Lot C') or parent_title is null order by 2 nulls first, 3$$,
  $$values ('Lot C', null::text, 1), ('Lot B', null, 2), ('Lot A', null, 3), ('B1', 'Lot B', 1), ('A1', 'Lot B', 2),
    ('B2', 'Lot B', 3), ('B3', 'Lot B', 4), ('Sous-lot', 'Lot C', 1)$$,
  'the requested order: roots reversed, A1 second in Lot B, Sous-lot in Lot C');

select is(
  (select v.content_revision - b.content_revision from public.estimate_versions v join ro29_before b on b.version_id = v.id
   where v.id = '29500000-0000-4000-8000-000000000102'),
  (select v.content_revision - b.content_revision from public.estimate_versions v join ro29_before b on b.version_id = v.id
   where v.id = '29500000-0000-4000-8000-000000000101'),
  'the content revision moves as far as with the per-row path');
select is(
  (select v.content_revision - b.content_revision from public.estimate_versions v join ro29_before b on b.version_id = v.id
   where v.id = '29500000-0000-4000-8000-000000000102'), 52::bigint,
  'one content revision step per written row (14 + 20 + 12 + 6)');

-- The audit rows each version gained, with the ids of its tree, version and affaire made comparable.
create function pg_temp.ro29_journal(p_version uuid, p_prefix text, p_project uuid) returns table(table_name text,
  action text, user_id uuid, tenant_id uuid, record_id text, estimate_version_id text, before_data text, after_data text)
language sql as $$
  select a.table_name, a.action, a.user_id, a.tenant_id,
    replace(replace(a.record_id::text, p_prefix, 'item-'), p_version::text, 'version'),
    replace(a.estimate_version_id::text, p_version::text, 'version'),
    replace(replace(replace(a.before_data::text, p_prefix, 'item-'), p_version::text, 'version'), p_project::text, 'affaire'),
    replace(replace(replace(a.after_data::text, p_prefix, 'item-'), p_version::text, 'version'), p_project::text, 'affaire')
  from public.audit_logs a
  where a.estimate_version_id = p_version
    and a.id <> all(coalesce((select b.audit_ids from ro29_before b where b.version_id = p_version), '{}'))
$$;
create temporary table ro29_journal_r as select * from pg_temp.ro29_journal('29500000-0000-4000-8000-000000000101',
  '29500000-0000-4000-8100-', '29500000-0000-4000-8000-000000000010');
create temporary table ro29_journal_c as select * from pg_temp.ro29_journal('29500000-0000-4000-8000-000000000102',
  '29500000-0000-4000-8200-', '29500000-0000-4000-8000-000000000011');

select results_eq(
  $$select table_name, action, count(*) from ro29_journal_c group by 1, 2 order by 1, 2$$,
  $$values ('estimate_items'::text, 'UPDATE'::text, 52::bigint), ('estimate_versions', 'UPDATE', 52)$$,
  'the RPCs journal one item UPDATE row per write and one version UPDATE row per revision step');
select is((select count(*) from (select * from ro29_journal_c except all select * from ro29_journal_r) extra), 0::bigint,
  'every audit row of the RPCs is an audit row of the per-row path (users, tenants, records, before and after rows)');
select is((select count(*) from (select * from ro29_journal_r except all select * from ro29_journal_c) missing), 0::bigint,
  'every audit row of the per-row path is written by the RPCs');
select is((select array_agg(distinct user_id) from ro29_journal_c), array['29500000-0000-4000-8000-000000000001'::uuid],
  'every audit row names the owner who called the RPCs');

select results_eq(
  $$select right(requirement.id::text, 1), requirement.technical_revision - before.technical_revision
    from private.estimate_source_coverage_requirements requirement join ro29_coverage_before before using (id)
    where requirement.id::text like '29500000-0000-4000-8200-%' order by 1$$,
  $$select right(requirement.id::text, 1), requirement.technical_revision - before.technical_revision
    from private.estimate_source_coverage_requirements requirement join ro29_coverage_before before using (id)
    where requirement.id::text like '29500000-0000-4000-8100-%' order by 1$$,
  'the source coverage requirements are invalidated as with the per-row path');
select results_eq(
  $$select right(requirement.id::text, 1), requirement.technical_revision > before.technical_revision
    from private.estimate_source_coverage_requirements requirement join ro29_coverage_before before using (id)
    where requirement.id::text like '29500000-0000-4000-8200-%' order by 1$$,
  $$values ('1'::text, true), ('2', true), ('3', false)$$,
  'moving A1 invalidates its requirement, moving Sous-lot the one scoped to S2, renumbering B3 nothing');

-- The contract does not outlive the call.
select is(coalesce(current_setting('miaouffrage.estimate_item_order_atomic', true), '')
  || '|' || coalesce(current_setting('miaouffrage.estimate_creation_atomic', true), '')
  || '|' || coalesce(current_setting('miaouffrage.estimate_creation_replay', true), ''), '||',
  'no order or creation contract is left bound after the RPCs');
select set_config('test.revision', (select content_revision::text from public.estimate_versions
  where id = '29500000-0000-4000-8000-000000000102'), true);
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001',
  $$with written as (update public.estimate_items set title = 'B1 bis'
    where id = '29500000-0000-4000-8200-000000000031' returning 1) select count(*)::text from written$$), '1',
  'the owner updates a line directly after the RPCs');
select is((select content_revision - current_setting('test.revision')::bigint from public.estimate_versions
  where id = '29500000-0000-4000-8000-000000000102')
  || '|' || (select count(*) from public.audit_logs where record_id = '29500000-0000-4000-8200-000000000031'
    and after_data->>'title' = 'B1 bis'), '1|1',
  'a later write of the same transaction still takes its revision step and its audit row');

-- Bound by hand to C, the contract only skips the UPDATE of an item staying in C.
select set_config('miaouffrage.estimate_item_order_atomic', '29500000-0000-4000-8000-000000000102', true);
create temporary table ro29_contract_marks as
select version.id, version.content_revision, (select count(*) from public.audit_logs a where a.estimate_version_id = version.id) as audits
from public.estimate_versions version
where version.id in ('29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8000-000000000103');
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title)
values ('29500000-0000-4000-8200-000000000099', current_setting('test.tenant_id')::uuid,
  '29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8200-000000000003', 'section', 2, 'Insérée');
update public.estimate_items set title = 'Insérée bis' where id = '29500000-0000-4000-8200-000000000099';
delete from public.estimate_items where id = '29500000-0000-4000-8200-000000000099';
update public.estimate_items set title = 'D1 bis' where id = '29500000-0000-4000-8300-000000000011';
select set_config('miaouffrage.estimate_item_order_atomic', '', true);
select results_eq(
  $$select right(version.id::text, 3), version.content_revision - marks.content_revision,
      (select count(*) from public.audit_logs a where a.estimate_version_id = version.id) - marks.audits
    from public.estimate_versions version join ro29_contract_marks marks using (id) order by 1$$,
  $$values ('102'::text, 2::bigint, 4::bigint), ('103', 1, 2)$$,
  'under a contract bound to C: the insert and the delete in C, and the update in D, keep their steps and audit rows; the update in C is skipped');

select throws_ok(
  $$select private.estimate_item_order_replay_effects('29500000-0000-4000-8000-000000000102', '{}', '{}')$$,
  '42501', 'ESTIMATE_ITEM_ORDER_REPLAY_OUTSIDE_CONTRACT',
  'the replay refuses to run outside the contract of its version');

-- The security definer boundary: execution and refused callers.
select ok(has_function_privilege('authenticated', 'public.reorder_estimate_items(uuid, uuid, uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[])', 'execute'),
  'authenticated may call both RPCs');
select ok(not has_function_privilege('anon', 'public.reorder_estimate_items(uuid, uuid, uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.reorder_estimate_items(uuid, uuid, uuid[])', 'execute')
  and not has_function_privilege('service_role', 'public.move_estimate_item(uuid, uuid, uuid, uuid, uuid[], uuid[])', 'execute'),
  'anon and service_role may not call them');
select ok(not has_function_privilege('authenticated', 'private.estimate_item_order_replay_effects(uuid, jsonb[], jsonb[])', 'execute')
  and not has_function_privilege('authenticated', 'private.estimate_item_order_writer_tenant(uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.estimate_item_order_replay_effects(uuid, jsonb[], jsonb[])', 'execute'),
  'no API role may call the replay or the authorization helper');

delete from ro29_before where version_id = '29500000-0000-4000-8000-000000000103';
insert into ro29_before
select version.id, version.content_revision,
  (select array_agg(a.id) from public.audit_logs a where a.estimate_version_id = version.id)
from public.estimate_versions version where version.id = '29500000-0000-4000-8000-000000000103';

create temporary table ro29_refusal (caller text, operation text, outcome text);
insert into ro29_refusal
select caller.label, operation.label, pg_temp.ro29_call(caller.id, operation.statement)
from (values ('viewer', '29500000-0000-4000-8000-000000000004'::uuid),
  ('engineer of another affaire', '29500000-0000-4000-8000-000000000003'),
  ('outsider', '29500000-0000-4000-8000-000000000005'),
  ('no user', null)) as caller(label, id)
cross join (values
  ('reorder', pg_temp.ro29_reorder_sql('29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000033', '000000000032', '000000000031']))),
  ('move', pg_temp.ro29_move_sql('29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000031',
    '29500000-0000-4000-8300-000000000002', '29500000-0000-4000-8300-000000000003',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000032', '000000000033']),
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000031']))))
  as operation(label, statement);
select results_eq(
  $$select caller, operation, outcome from ro29_refusal order by 1, 2$$,
  $$select caller, operation, '42501 ESTIMATE_ITEM_ORDER_FORBIDDEN'::text
    from (values ('engineer of another affaire'), ('no user'), ('outsider'), ('viewer')) as caller(caller)
    cross join (values ('move'), ('reorder')) as operation(operation) order by 1, 2$$,
  'a viewer, an engineer on another engineer''s affaire, a member of another tenant and a caller without user are refused');
select is(
  (select v.content_revision - b.content_revision from public.estimate_versions v join ro29_before b on b.version_id = v.id
   where v.id = '29500000-0000-4000-8000-000000000103')
  || '|' || (select count(*) from public.audit_logs a join ro29_before b on b.version_id = a.estimate_version_id
    where a.estimate_version_id = '29500000-0000-4000-8000-000000000103' and a.id <> all(coalesce(b.audit_ids, '{}')))
  || '|' || (select string_agg(title || '@' || position, ',' order by position) from public.estimate_items
    where parent_id = '29500000-0000-4000-8300-000000000002'),
  '0|0|B1@1,B2@2,B3@3',
  'a refused call writes nothing: no revision step, no audit row, no position');

select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000002', pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000033', '000000000032', '000000000031']))), '3',
  'an admin of the tenant reorders the owner''s affaire, as the update policy allows');
select is((select array_agg(distinct a.user_id) from public.audit_logs a join ro29_before b on b.version_id = a.estimate_version_id
    where a.estimate_version_id = '29500000-0000-4000-8000-000000000103' and a.id <> all(coalesce(b.audit_ids, '{}'))),
  array['29500000-0000-4000-8000-000000000002'::uuid], 'its audit rows name the admin');

-- A version that is no longer a draft (inserted as sent, engine 1, without items).
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, seal_hash)
values ('29500000-0000-4000-8000-000000000104', current_setting('test.tenant_id')::uuid,
  '29500000-0000-4000-8000-000000000013', 1, 'sent', 1, repeat('a', 64));
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000104', null, array['29500000-0000-4000-8000-000000000999'::uuid])),
  '42501 ESTIMATE_VERSION_READ_ONLY', 'the owner may not reorder a version that is no longer a draft');
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_move_sql(
    '29500000-0000-4000-8000-000000000104', '29500000-0000-4000-8000-000000000999', null,
    '29500000-0000-4000-8000-000000000998', '{}', array['29500000-0000-4000-8000-000000000999'::uuid])),
  '42501 ESTIMATE_VERSION_READ_ONLY', 'nor move in it');

-- Refusals of move keep their messages and write nothing.
select set_config('test.revision', (select content_revision::text from public.estimate_versions
  where id = '29500000-0000-4000-8000-000000000102'), true);
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_move_sql(
    '29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8200-000000000003', null,
    '29500000-0000-4000-8200-000000000017',
    pg_temp.ro29_ids('29500000-0000-4000-8200-', array['000000000002', '000000000001']),
    pg_temp.ro29_ids('29500000-0000-4000-8200-', array['000000000021', '000000000022', '000000000003']))),
  'P0001 section target_parent_id cannot reference its own subtree', 'a section is not moved into its own subtree');
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_move_sql(
    '29500000-0000-4000-8000-000000000102', '29500000-0000-4000-8200-000000000033',
    '29500000-0000-4000-8200-000000000002', '29500000-0000-4000-8200-000000000003',
    pg_temp.ro29_ids('29500000-0000-4000-8200-', array['000000000031', '000000000011']),
    pg_temp.ro29_ids('29500000-0000-4000-8200-', array['000000000017', '000000000033']))),
  'P0001 ordered_source_item_ids count mismatch', 'a stale source list is refused');
select is((select content_revision::text from public.estimate_versions where id = '29500000-0000-4000-8000-000000000102'),
  current_setting('test.revision'), 'a refused move takes no revision step');

-- Engine 3, the engine of a tenant without a policy row since M8: the same equivalence on two v3 drafts (Lot X: L1,
-- L2; Lot Y: L3; priced lines, coefficients 1 / 1), R3 by the per-row statements and C3 by the RPCs.
select set_config('role', 'service_role', true);
select public.set_tenant_calc_policy(p_tenant_id => current_setting('test.tenant_id')::uuid,
  p_new_estimate_calc_engine => 3::smallint, p_default_sale_coefficient_fo => 1, p_default_sale_coefficient_mo => 1,
  p_allowed_tax_rates_bp => null, p_change_reason => 'RO29 v3', p_actor_user_id => '29500000-0000-4000-8000-000000000001');
select set_config('role', 'none', true);
create function pg_temp.ro29_v3_line(p_prefix text, p_suffix text, p_parent text, p_position integer, p_title text,
  p_cents integer) returns jsonb language sql as $$
  select jsonb_build_object('id', pg_temp.ro29_id(p_prefix, p_suffix), 'parent_id', pg_temp.ro29_id(p_prefix, p_parent),
    'item_type', 'line', 'position', p_position, 'title', p_title, 'description', 'u', 'quantity', 1,
    'unit_price_ht_cents', p_cents, 'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo_per_unit', 0, 'h_mo_majoration', 1, 'k_mo', 1,
    'pu_ht_cents', p_cents, 'line_total_ht_cents', p_cents, 'line_tax_cents', p_cents / 5, 'line_total_ttc_cents', p_cents * 6 / 5,
    'unit_code', 'u', 'pricing_status', 'priced')
$$;
create function pg_temp.ro29_version_v3(p_project uuid, p_id uuid, p_prefix text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  perform public.persist_estimate_creation_atomic(current_setting('test.tenant_id')::uuid,
    '29500000-0000-4000-8000-000000000001', p_project, null,
    jsonb_build_object('id', p_id, 'title', 'RO29 v3', 'date_devis', current_date, 'validite_jours', 30,
      'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
      'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
      'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
      'contractor_role', 'principal', 'calc_engine_version', 3, 'sale_coefficient_fo', 1, 'sale_coefficient_mo', 1,
      'gross_ht_cents', 6000, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
      'total_ht_cents', 6000, 'total_tax_cents', 1200, 'total_ttc_cents', 7200),
    jsonb_build_array(
      pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000001'), null, 1, 'Lot X'),
      pg_temp.ro29_section(pg_temp.ro29_id(p_prefix, '000000000002'), null, 2, 'Lot Y'),
      pg_temp.ro29_v3_line(p_prefix, '000000000011', '000000000001', 1, 'L1', 1000),
      pg_temp.ro29_v3_line(p_prefix, '000000000012', '000000000001', 2, 'L2', 2000),
      pg_temp.ro29_v3_line(p_prefix, '000000000013', '000000000002', 1, 'L3', 3000)), null);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return 'ok';
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;
select is(pg_temp.ro29_version_v3('29500000-0000-4000-8000-000000000014', '29500000-0000-4000-8000-000000000106',
    '29500000-0000-4000-8500-') || '|' || pg_temp.ro29_version_v3('29500000-0000-4000-8000-000000000015',
    '29500000-0000-4000-8000-000000000107', '29500000-0000-4000-8600-'), 'ok|ok',
  'two identical v3 drafts are created');
insert into ro29_before
select version.id, version.content_revision,
  (select array_agg(a.id) from public.audit_logs a where a.estimate_version_id = version.id)
from public.estimate_versions version
where version.id in ('29500000-0000-4000-8000-000000000106', '29500000-0000-4000-8000-000000000107');
select is(
  pg_temp.ro29_reference_reorder('29500000-0000-4000-8000-000000000106', '29500000-0000-4000-8500-000000000001',
    pg_temp.ro29_ids('29500000-0000-4000-8500-', array['000000000012', '000000000011']))
  || ',' || pg_temp.ro29_reference_move('29500000-0000-4000-8000-000000000106', '29500000-0000-4000-8500-000000000011',
    '29500000-0000-4000-8500-000000000001', '29500000-0000-4000-8500-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8500-', array['000000000012']),
    pg_temp.ro29_ids('29500000-0000-4000-8500-', array['000000000011', '000000000013']))
  || '|' || pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000107', '29500000-0000-4000-8600-000000000001',
    pg_temp.ro29_ids('29500000-0000-4000-8600-', array['000000000012', '000000000011'])))
  || ',' || pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_move_sql(
    '29500000-0000-4000-8000-000000000107', '29500000-0000-4000-8600-000000000011',
    '29500000-0000-4000-8600-000000000001', '29500000-0000-4000-8600-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8600-', array['000000000012']),
    pg_temp.ro29_ids('29500000-0000-4000-8600-', array['000000000011', '000000000013']))),
  '2,3|2,3', 'on v3 drafts the per-row statements and the RPCs reorder then move with the same counts');
select results_eq(
  $$select * from pg_temp.ro29_layout('29500000-0000-4000-8000-000000000107') order by 2 nulls first, 3$$,
  $$select * from pg_temp.ro29_layout('29500000-0000-4000-8000-000000000106') order by 2 nulls first, 3$$,
  'on v3 the RPCs leave every item where the per-row path left it');
select is(
  (select string_agg((v.content_revision - b.content_revision)::text, '|' order by v.id) from public.estimate_versions v
   join ro29_before b on b.version_id = v.id
   where v.id in ('29500000-0000-4000-8000-000000000106', '29500000-0000-4000-8000-000000000107')),
  '10|10', 'on v3 both paths take one revision step per write (4 + 6)');
create temporary table ro29_journal_r3 as select * from pg_temp.ro29_journal('29500000-0000-4000-8000-000000000106',
  '29500000-0000-4000-8500-', '29500000-0000-4000-8000-000000000014');
create temporary table ro29_journal_c3 as select * from pg_temp.ro29_journal('29500000-0000-4000-8000-000000000107',
  '29500000-0000-4000-8600-', '29500000-0000-4000-8000-000000000015');
select is(
  (select count(*) from ro29_journal_c3) || '|'
  || (select count(*) from (select * from ro29_journal_c3 except all select * from ro29_journal_r3) extra) || '|'
  || (select count(*) from (select * from ro29_journal_r3 except all select * from ro29_journal_c3) missing),
  '20|0|0', 'on v3 the RPCs write exactly the audit rows of the per-row path (10 item and 10 version rows)');

-- More callers of the security definer boundary, as the update policy decides them.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '29500000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
  'order-items-6@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
insert into public.tenant_memberships (tenant_id, user_id, role)
values (current_setting('test.tenant_id')::uuid, '29500000-0000-4000-8000-000000000006', 'director');
create function pg_temp.ro29_call_claims(p_claims jsonb, p_statement text) returns text language plpgsql as $$
declare
  result text;
begin
  perform set_config('request.jwt.claims', p_claims::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_statement into result;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return coalesce(result, 'ok');
exception when others then
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return sqlstate || ' ' || sqlerrm;
end
$$;
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000006', pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000031', '000000000032', '000000000033']))),
  '42501 ESTIMATE_ITEM_ORDER_FORBIDDEN', 'a director (neither admin nor engineer) is refused');
select is(pg_temp.ro29_call_claims(jsonb_build_object('sub', '29500000-0000-4000-8000-000000000005', 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')), pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000031', '000000000032', '000000000033']))),
  '3', 'a platform admin reorders, as the update policy allows it');
update public.tenants set is_active = false where id = current_setting('test.tenant_id')::uuid;
select is(pg_temp.ro29_call('29500000-0000-4000-8000-000000000001', pg_temp.ro29_reorder_sql(
    '29500000-0000-4000-8000-000000000103', '29500000-0000-4000-8300-000000000002',
    pg_temp.ro29_ids('29500000-0000-4000-8300-', array['000000000033', '000000000032', '000000000031']))),
  '42501 ESTIMATE_ITEM_ORDER_FORBIDDEN', 'the owner of a suspended tenant is refused');

select * from finish();
rollback;
