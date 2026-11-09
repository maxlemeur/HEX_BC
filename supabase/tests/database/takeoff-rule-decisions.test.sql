-- TI-677 (métré L5, PR D) : décisions sur les règles fixes (migration 20261105020000_takeoff_rule_decisions.sql).
-- Mémo de pratique validé le 5 nov. 2026 (Q2 à Q4). Isolation justifiée : chaque cas exige l'écrivain du serveur, le
-- trigger d'application et des audits fabriqués ; aucun parcours ne fait apparaître un nouveau partenaire entre deux
-- calculs, ni ne modifie une ligne entre l'audit d'un override et l'application.
-- Cas écrits avant la migration (rouges sur main) :
-- - faux accept : une ligne vérifiée gagne un échec acceptable d'un partenaire au recalcul ; elle reste vérifiée et
--   l'échec passe pour réglé sans que personne ne l'ait vu (blockingRules, takeoff_item_rule_blocked) ;
-- - les décisions d'un utilisateur (vérification, exclusion, quantité) n'étaient journalisées par la route qu'après
--   l'enregistrement, en mode non bloquant ;
-- - le motif d'exclusion n'était exigé qu'à l'API : la Data API exclut sans motif, ou efface le motif d'une ligne exclue ;
-- - un override admin restait valable quand une ligne bloquée changeait après lui (quantité, enregistrement, règles).
-- Les tables de clés et de réouverture sont celles de src/lib/takeoff/rules/failure-keys.test.ts.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- Fixtures -----------------------------------------------------------------------------------------------

create temporary table decisions_outcome (case_name text primary key, outcome text) on commit drop;
grant all on decisions_outcome to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '9d000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'decisions-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9d000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'decisions-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '9d000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = '9d000000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = '9d000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, '9d000000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('9d000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  '9d000000-0000-4000-8000-000000000001', 'Décisions sur les règles (fictif)', false);

-- Versions ...101 to ...109, one job each (...301 to ...309), and a section to apply into.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select ('9d000000-0000-4000-8000-00000000010' || n)::uuid, current_setting('test.tenant_id')::uuid,
  '9d000000-0000-4000-8000-000000000010', n, 'draft', 2, 1, 0
from generate_series(1, 9) as n;

insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select ('9d000000-0000-4000-8000-0000000002' || right(version.id::text, 2))::uuid, version.tenant_id, version.id, 'section', 0, 'Lot fictif'
from public.estimate_versions version
where version.project_id = '9d000000-0000-4000-8000-000000000010';

-- ...301 the verified line and its partner (level A); ...302 the user's decisions; ...303 to ...309 one override each
-- (...304 level C: its line blocks on a low confidence, no rule reads it).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select ('9d000000-0000-4000-8000-00000000030' || n)::uuid, current_setting('test.tenant_id')::uuid,
  ('9d000000-0000-4000-8000-00000000010' || n)::uuid, case when n = 4 then 'C' else 'A' end::public.takeoff_job_level,
  'completed', 'plan-fictif.pdf', '9d000000-0000-4000-8000-000000000001'
from generate_series(1, 9) as n;

-- Every line was last saved on 1 Nov. 2026: a save in this test moves updated_at to now(). ...404 was excluded before
-- reasons were required (none).
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name,
  source_page, is_verified, verified_at, verified_by, is_excluded, exclusion_reason, rule_results, rules_evaluated_at,
  created_at, updated_at)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.job_id, fixture.designation, 5, 'ml', fixture.confidence,
  'Repère localisé', 'plan-fictif.pdf', 1, fixture.verified,
  case when fixture.verified then timestamptz '2026-11-01 08:00:00+00' end,
  case when fixture.verified then '9d000000-0000-4000-8000-000000000001'::uuid end,
  fixture.excluded, null, fixture.results,
  case when fixture.results is distinct from '[]'::jsonb then timestamptz '2026-11-01 08:00:00+00' end,
  timestamptz '2026-11-01 07:00:00+00' + fixture.rank * interval '1 second', timestamptz '2026-11-01 08:00:00+00'
from (values
  ('9d000000-0000-4000-8000-000000000401'::uuid, '9d000000-0000-4000-8000-000000000301'::uuid, 'EF cuivre 20/22 (Z1)', 0.95,
    true, false, '[{"rule":"dn_network","status":"pass","code":"DN_NETWORK_COMPATIBLE","version":1,"acceptable":true,"reason":"Compatible."}]'::jsonb, 1),
  ('9d000000-0000-4000-8000-000000000402'::uuid, '9d000000-0000-4000-8000-000000000301'::uuid, 'Bureau R+1', 0.95,
    false, false, '[]'::jsonb, 2),
  ('9d000000-0000-4000-8000-000000000403'::uuid, '9d000000-0000-4000-8000-000000000302'::uuid, 'Vanne DN 20', 0.95,
    false, false, '[]'::jsonb, 3),
  ('9d000000-0000-4000-8000-000000000404'::uuid, '9d000000-0000-4000-8000-000000000302'::uuid, 'Vanne DN 25', 0.95,
    false, true, '[]'::jsonb, 4),
  ('9d000000-0000-4000-8000-000000000405'::uuid, '9d000000-0000-4000-8000-000000000302'::uuid, 'Vanne DN 32', 0.95,
    false, false, '[]'::jsonb, 5),
  ('9d000000-0000-4000-8000-000000000406'::uuid, '9d000000-0000-4000-8000-000000000303'::uuid, 'Hall R+1', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 6),
  ('9d000000-0000-4000-8000-000000000407'::uuid, '9d000000-0000-4000-8000-000000000304'::uuid, 'Vanne DN 40', 0.4,
    false, false, '[]'::jsonb, 7),
  ('9d000000-0000-4000-8000-000000000408'::uuid, '9d000000-0000-4000-8000-000000000305'::uuid, 'Hall R+2', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 8),
  ('9d000000-0000-4000-8000-000000000409'::uuid, '9d000000-0000-4000-8000-000000000306'::uuid, 'Hall R+3', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 9),
  ('9d000000-0000-4000-8000-000000000410'::uuid, '9d000000-0000-4000-8000-000000000307'::uuid, 'Hall R+4', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 10),
  ('9d000000-0000-4000-8000-000000000411'::uuid, '9d000000-0000-4000-8000-000000000308'::uuid, 'Hall R+5', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 11),
  ('9d000000-0000-4000-8000-000000000412'::uuid, '9d000000-0000-4000-8000-000000000309'::uuid, 'Hall R+6', 0.95,
    false, false, '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":1,"acceptable":false,"reason":"Fictif."}]'::jsonb, 12)
) as fixture(id, job_id, designation, confidence, verified, excluded, results, rank);

-- TI-681: preserve quantity-change/override binding using a provenance protection.
update public.takeoff_items set evidence=null where id='9d000000-0000-4000-8000-000000000407';

insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id,
  case when version.id = '9d000000-0000-4000-8000-000000000101' then '9d000000-0000-4000-8000-000000000001'::uuid
    else '9d000000-0000-4000-8000-000000000002'::uuid end,
  version.tenant_id, statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = '9d000000-0000-4000-8000-000000000010';

-- The application's plan (one line renamed when asked), section, call and clean-up, as in takeoff-rule-bounds.
create or replace function pg_temp.decisions_plan(p_job_id uuid, p_renamed uuid)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id, 'source_order', item.source_order, 'rule_id', null,
    'action', case when item.id = p_renamed then 'rename' else 'none' end,
    'designation', case when item.id = p_renamed then 'Renommée par le plan' else btrim(item.designation) end,
    'unit_price_cents', null, 'category_id', null, 'assembly_id', null
  ) order by item.source_order), '[]'::jsonb)
  from (
    select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job_id
  ) as item
$$;
grant execute on function pg_temp.decisions_plan(uuid, uuid) to authenticated;

create or replace function pg_temp.decisions_apply(p_case text, p_job_id uuid, p_renamed uuid default null)
returns text
language plpgsql
as $$
declare
  outcome text := 'ok';
begin
  begin
    perform * from public.apply_takeoff_job_guarded_atomic(p_job_id, 'append',
      (select ('9d000000-0000-4000-8000-0000000002' || right(job.estimate_version_id::text, 2))::uuid
       from public.takeoff_jobs job where job.id = p_job_id),
      pg_temp.decisions_plan(p_job_id, p_renamed));
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  insert into decisions_outcome values (p_case, outcome);
  return outcome;
end;
$$;
grant execute on function pg_temp.decisions_apply(text, uuid, uuid) to authenticated;

create or replace function pg_temp.decisions_clear()
returns void
language sql
as $$
  drop table if exists pg_temp._takeoff_apply_source;
  drop table if exists pg_temp._takeoff_apply_created_ids;
  drop table if exists pg_temp._takeoff_apply_matches;
  drop table if exists pg_temp._takeoff_apply_unmatched;
  select pg_catalog.set_config('app.takeoff_apply_atomic', '', true);
  select pg_catalog.set_config('app.takeoff_apply_job', '', true);
$$;

-- The review's save (update_takeoff_item_for_review) as the signed-in user: the number of lines saved.
create or replace function pg_temp.decisions_save(p_item_id uuid, p_fields jsonb)
returns integer
language sql
as $$
  select count(*)::integer from public.update_takeoff_item_for_review(current_setting('test.tenant_id')::uuid,
    (select item.job_id from public.takeoff_items item where item.id = p_item_id), p_item_id,
    (select item.updated_at from public.takeoff_items item where item.id = p_item_id), p_fields)
$$;
grant execute on function pg_temp.decisions_save(uuid, jsonb) to authenticated;

-- The server's writer, as read just before (its updated_at and when it was last made stale).
create or replace function pg_temp.decisions_write(p_item_id uuid, p_results jsonb)
returns integer
language sql
as $$
  select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    (select job.estimate_version_id from public.takeoff_items item join public.takeoff_jobs job on job.id = item.job_id
     where item.id = p_item_id),
    jsonb_build_array(jsonb_build_object('id', p_item_id, 'results', p_results,
      'expected_updated_at', (select item.updated_at from public.takeoff_items item where item.id = p_item_id),
      'expected_stale_at', (select item.rules_stale_at from public.takeoff_items item where item.id = p_item_id))),
    '[]'::jsonb, null)
$$;
grant execute on function pg_temp.decisions_write(uuid, jsonb) to service_role;

-- An admin override's audit, as the route writes it: its blocked line's state when given.
create or replace function pg_temp.decisions_override(p_item_id uuid, p_state jsonb)
returns void
language sql
as $$
  insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
  select job.tenant_id, '9d000000-0000-4000-8000-000000000002', 'takeoff_jobs', job.id, job.estimate_version_id,
    'takeoff.apply.override',
    jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', job.id, 'tenant_id', job.tenant_id,
      'user_id', '9d000000-0000-4000-8000-000000000002',
      'metadata', jsonb_build_object('estimate_version_id', job.estimate_version_id, 'threshold', 0.5,
        'blocked_item_ids', jsonb_build_array(p_item_id), 'blocked_items_count', 1, 'justification', 'Vérifié sur le plan fictif')
        || case when p_state is null then '{}'::jsonb else jsonb_build_object('blocked_items_state', jsonb_build_array(p_state)) end)
  from public.takeoff_items item join public.takeoff_jobs job on job.id = item.job_id
  where item.id = p_item_id
$$;

-- The state the route records for a blocked line (apply-override-state.ts), its failed rules' keys given.
create or replace function pg_temp.decisions_state(p_item_id uuid, p_rule_failures jsonb)
returns jsonb
language sql
as $$
  select jsonb_build_object('item_id', item.id, 'quantity', item.quantity, 'unit', item.unit, 'updated_at', item.updated_at,
    'rule_failures', p_rule_failures, 'rules_stale', item.rules_stale, 'designation', item.designation,
    'evidence', item.evidence, 'source_page', item.source_page, 'is_verified', item.is_verified,
    'quantity_entered_by', item.quantity_entered_by)
  from public.takeoff_items item where item.id = p_item_id
$$;

create or replace function pg_temp.as_user(p_user uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claim.sub', p_user::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', p_user)::text, true);
$$;
grant execute on function pg_temp.as_user(uuid) to authenticated;

-- Q3: a computation that brings a verified line a failure it did not have reopens it ------------------------

-- ...401 was verified with its rules passed; a room drawn around it now overlaps it (an acceptable failure).
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000401',
  '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"overlapping_item_ids":["9d000000-0000-4000-8000-000000000402"],"overlap_m2":4}}]'::jsonb),
  1, 'the writer writes the new failure of a verified line');
reset role;
select ok((select not is_verified and verified_at is null and verified_by is null
  from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'a failure nobody saw withdraws the verification (it no longer passes for settled)');
select ok((select updated_at > timestamptz '2026-11-01 08:00:00+00' from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'the reopened line moved: a review that read it before saves it no more without reading it again');
select is((select count(*)::integer from public.audit_logs log
  where log.action = 'takeoff.item.modified' and log.table_name = 'takeoff_items'
    and log.record_id = '9d000000-0000-4000-8000-000000000301'
    and log.estimate_version_id = '9d000000-0000-4000-8000-000000000101'
    and log.user_id is null
    and log.after_data -> 'metadata' ->> 'item_id' = '9d000000-0000-4000-8000-000000000401'
    and log.after_data -> 'metadata' ->> 'field' = 'is_verified'
    and log.after_data -> 'metadata' -> 'previous_value' = 'true'::jsonb
    and log.after_data -> 'metadata' -> 'next_value' = 'false'::jsonb
    and log.after_data -> 'metadata' ->> 'reason' like '%ROOM_OVERLAP%'
    and log.after_data ->> 'user_id' is null
    and log.before_data ->> 'verified_by' = '9d000000-0000-4000-8000-000000000001'
    and log.before_data ->> 'verified_at' is not null), 1,
  'the reopening is journaled by the system with the write: who had verified it, and the new failure');

set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
reset role;
select ok(not public.takeoff_item_rule_blocked((select rule_results from public.takeoff_items where id='9d000000-0000-4000-8000-000000000401'),false,false), 'TI-681: a reopened quantity warning remains visible without mandatory acknowledgement');
reset role;
select pg_temp.decisions_clear();

-- Verified again: the same failure computed again leaves it verified, a new partner reopens it, a partner that leaves
-- or a failure that disappears does not.
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000401', jsonb_build_object('is_verified', true,
  'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000001')), 1, 'the user verifies the line again');
reset role;
update public.takeoff_items set rules_stale = true, rules_stale_at = clock_timestamp()
where id = '9d000000-0000-4000-8000-000000000401';
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000401',
  '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif, recalculé.","details":{"overlapping_item_ids":["9D000000-0000-4000-8000-000000000402"],"overlap_m2":4.5}}]'::jsonb),
  1, 'the same failure computed again (another reason, another surface, the partner in capitals)');
reset role;
select ok((select is_verified from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'the same failure, already seen, stays settled');

set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000401',
  '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"overlapping_item_ids":["9d000000-0000-4000-8000-000000000402","9d000000-0000-4000-8000-0000000004ff"]}}]'::jsonb),
  1, 'a second room now overlaps the line');
reset role;
select ok((select not is_verified from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'a new partner reopens the line');

set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000401', jsonb_build_object('is_verified', true,
  'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000001')), 1, 'verified with its two partners');
reset role;
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000401',
  '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"overlapping_item_ids":["9d000000-0000-4000-8000-000000000402"]}}]'::jsonb),
  1, 'one partner leaves');
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000401',
  '[{"rule":"dn_network","status":"pass","code":"DN_NETWORK_COMPATIBLE","version":1,"acceptable":true,"reason":"Compatible."}]'::jsonb),
  1, 'the failure disappears');
reset role;
select ok((select is_verified from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'a partner that leaves and a failure that disappears close by themselves');
select is((select count(*)::integer from public.audit_logs log where log.user_id is null
  and log.after_data -> 'metadata' ->> 'item_id' = '9d000000-0000-4000-8000-000000000401'), 2,
  'two reopenings, two system entries');

-- Q4: the user's decisions are journaled in the save's transaction --------------------------------------

set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000403', jsonb_build_object('is_verified', true,
  'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000001')), 1, 'the user verifies a line');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000403', jsonb_build_object('quantity', 7,
  'quantity_entered_at', now(), 'quantity_entered_by', '9d000000-0000-4000-8000-000000000001',
  'quantity_entry_category', 'site_survey')), 1,
  'then types its quantity with its category (TI-686 D12), which withdraws the verification');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000403', jsonb_build_object('quantity', 7)), 1,
  'then saves the same quantity');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000403', jsonb_build_object('is_excluded', true,
  'exclusion_reason', 'Hors lot plomberie')), 1, 'then excludes it with a reason');
reset role;
select is(
  (select jsonb_agg(jsonb_build_array(log.action, log.after_data -> 'metadata' ->> 'field',
     log.after_data -> 'metadata' -> 'previous_value', log.after_data -> 'metadata' -> 'next_value',
     log.after_data -> 'metadata' ->> 'reason') order by log.action, log.after_data -> 'metadata' ->> 'field',
     log.after_data -> 'metadata' ->> 'next_value')
   from public.audit_logs log
   where log.after_data -> 'metadata' ->> 'item_id' = '9d000000-0000-4000-8000-000000000403'
     and log.user_id = '9d000000-0000-4000-8000-000000000001' and log.table_name = 'takeoff_items'
     and log.record_id = '9d000000-0000-4000-8000-000000000302'
     and log.estimate_version_id = '9d000000-0000-4000-8000-000000000102'
     and log.after_data ->> 'user_id' = '9d000000-0000-4000-8000-000000000001'
     and log.after_data ->> 'schema_version' = '1'),
  jsonb_build_array(
    jsonb_build_array('takeoff.item.excluded', null, null, null, 'Hors lot plomberie'),
    jsonb_build_array('takeoff.item.modified', 'is_verified', true, false, null),
    jsonb_build_array('takeoff.item.modified', 'is_verified', false, true, null),
    jsonb_build_array('takeoff.item.modified', 'quantity', 5.000, 7, null),
    jsonb_build_array('takeoff.item.modified', 'quantity_entered_by', null, '9d000000-0000-4000-8000-000000000001', null),
    jsonb_build_array('takeoff.item.modified', 'quantity_entry_category', null, 'site_survey', null)),
  'each change is journaled once, by the signed-in user, with its value before and after; an unchanged save is not');

-- Q4: an excluded line always has a reason, whatever the path ------------------------------------------

set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select throws_ok($$update public.takeoff_items set is_excluded = true where id = '9d000000-0000-4000-8000-000000000405'$$,
  '23514', 'TAKEOFF_ITEM_EXCLUSION_REASON_REQUIRED', 'the Data API excludes no line without a reason');
select throws_ok($$update public.takeoff_items set is_excluded = true, exclusion_reason = E' \t\n'
  where id = '9d000000-0000-4000-8000-000000000405'$$,
  '23514', 'TAKEOFF_ITEM_EXCLUSION_REASON_REQUIRED', 'a blank reason is no reason');
select throws_ok($$update public.takeoff_items set exclusion_reason = null where id = '9d000000-0000-4000-8000-000000000403'$$,
  '23514', 'TAKEOFF_ITEM_EXCLUSION_REASON_REQUIRED', 'the reason of an excluded line is never erased');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000404', jsonb_build_object('evidence', 'Repère page 1')), 1,
  'a line excluded before reasons were required can still be edited');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000403', jsonb_build_object('is_excluded', false,
  'exclusion_reason', null)), 1, 'an inclusion clears the reason');
reset role;

-- Q2: an admin override is bound to each blocked line's state ---------------------------------------------

-- The state unchanged: the override applies.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000406',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000406', '["dn_network|DN_NETWORK_MATERIAL_BLOCKED|1|"]'::jsonb));
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-unchanged', '9d000000-0000-4000-8000-000000000303'), 'ok',
  'an override whose lines did not change applies');
reset role;
select pg_temp.decisions_clear();

-- The quantity typed after the override.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000407',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000407', '[]'::jsonb));
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000407', jsonb_build_object('quantity', 50)), 1,
  'an engineer changes a blocked line after the override');
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-quantity', '9d000000-0000-4000-8000-000000000304'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a line whose quantity changed after the override needs a new override');
reset role;
select pg_temp.decisions_clear();

-- A computation that brings the blocked line another failure after the override.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000408',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000408', '["dn_network|DN_NETWORK_MATERIAL_BLOCKED|1|"]'::jsonb));
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000408',
  '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_MATERIAL_BLOCKED","version":2,"acceptable":false,"reason":"Restriction fictive actualisée."}]'::jsonb),
  1, 'the line now fails another rule');
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-rules', '9d000000-0000-4000-8000-000000000305'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a line whose failed rules changed after the override needs a new override');
reset role;
select pg_temp.decisions_clear();

-- An override recorded without the lines' state (before this migration).
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000409', null);
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-stateless', '9d000000-0000-4000-8000-000000000306'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'an override that does not record its lines'' state is refused');
reset role;
select pg_temp.decisions_clear();

-- The application renames the blocked line itself (a mapping rule): its own change keeps the override.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000410',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000410', '["dn_network|DN_NETWORK_MATERIAL_BLOCKED|1|"]'::jsonb));
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-renamed', '9d000000-0000-4000-8000-000000000307', '9d000000-0000-4000-8000-000000000410'),
  'ok', 'a line the application renames keeps its override');
reset role;
select pg_temp.decisions_clear();
select is((select count(*)::integer from public.audit_logs log
  where log.after_data -> 'metadata' ->> 'item_id' = '9d000000-0000-4000-8000-000000000410'), 0,
  'the application''s own changes are not journaled as a user''s decisions');

-- ...but not when a user saved it after the override, even if the application renames it afterwards.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000411',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000411', '["dn_network|DN_NETWORK_MATERIAL_BLOCKED|1|"]'::jsonb));
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000411', jsonb_build_object('evidence', 'Autre repère')), 1,
  'an engineer saves the blocked line after the override');
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-saved-renamed', '9d000000-0000-4000-8000-000000000308',
  '9d000000-0000-4000-8000-000000000411'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a line saved after the override needs a new one, even renamed by the application');
reset role;
select pg_temp.decisions_clear();

-- Review findings (TI-677 PR D) ---------------------------------------------------------------------------

-- A change no decision journals (another transaction's, here the owner's) after the override: the application's own
-- renaming does not hide it, every field the override recorded is compared.
select pg_temp.decisions_override('9d000000-0000-4000-8000-000000000412',
  pg_temp.decisions_state('9d000000-0000-4000-8000-000000000412', '["dn_network|DN_NETWORK_MATERIAL_BLOCKED|1|"]'::jsonb));
update public.takeoff_items set evidence = 'Repère changé hors revue' where id = '9d000000-0000-4000-8000-000000000412';
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_apply('override-unjournaled-renamed', '9d000000-0000-4000-8000-000000000309',
  '9d000000-0000-4000-8000-000000000412'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a change made after the override is seen even when no decision journals it and the application renames the line');
reset role;
select pg_temp.decisions_clear();

-- A failure that reaches a line before anyone verifies it: a review that read the line before cannot verify it.
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000405', '[]'::jsonb), 1,
  'the writer computes a line with no failure');
reset role;
select is((select updated_at from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000405'),
  timestamptz '2026-11-01 08:00:00+00', 'results that bring no failure leave the line''s save as it was');
set local role service_role;
select is(pg_temp.decisions_write('9d000000-0000-4000-8000-000000000405',
  '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"overlapping_item_ids":["9d000000-0000-4000-8000-000000000403"]}}]'::jsonb),
  1, 'a partner brings the unverified line a failure');
reset role;
select ok((select updated_at > timestamptz '2026-11-01 08:00:00+00' from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000405'),
  'the line whose failures grew moved');
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is((select count(*)::integer from public.update_takeoff_item_for_review(current_setting('test.tenant_id')::uuid,
  '9d000000-0000-4000-8000-000000000302', '9d000000-0000-4000-8000-000000000405', timestamptz '2026-11-01 08:00:00+00',
  jsonb_build_object('is_verified', true, 'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000001'))), 0,
  'a review that read the line before the failure cannot verify it: it reads it again first');
reset role;

-- One computation in several chunks: a chunk that reopens a line moves the version's stamp, the next chunk writes with
-- the stamp the previous one returned (each line of the version is written, none is left with stale results).
select set_config('test.stamp', public.takeoff_rule_version_stamp(current_setting('test.tenant_id')::uuid,
  '9d000000-0000-4000-8000-000000000101'), true);
set local role service_role;
select set_config('test.next_stamp', (select written.version_stamp from public.write_takeoff_rule_results(
  current_setting('test.tenant_id')::uuid, '9d000000-0000-4000-8000-000000000101',
  jsonb_build_array(jsonb_build_object('id', '9d000000-0000-4000-8000-000000000401',
    'results', '[{"rule":"closed_box","status":"fail","code":"CLOSED_BOX_SHAPE","version":1,"acceptable":true,"reason":"Fictif."}]'::jsonb,
    'expected_updated_at', (select updated_at from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
    'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'))),
  '[]'::jsonb, current_setting('test.stamp')) as written limit 1), true);
reset role;
select ok((select not is_verified from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000401'),
  'the first chunk reopens a verified line');
select is(current_setting('test.next_stamp'), public.takeoff_rule_version_stamp(current_setting('test.tenant_id')::uuid,
  '9d000000-0000-4000-8000-000000000101'), 'the first chunk returns the version''s stamp after its own writes');
set local role service_role;
select is((select count(*)::integer from public.write_takeoff_rule_results(
  current_setting('test.tenant_id')::uuid, '9d000000-0000-4000-8000-000000000101',
  jsonb_build_array(jsonb_build_object('id', '9d000000-0000-4000-8000-000000000402', 'results', '[]'::jsonb,
    'expected_updated_at', (select updated_at from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000402'),
    'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9d000000-0000-4000-8000-000000000402'))),
  '[]'::jsonb, current_setting('test.next_stamp'))), 1, 'the next chunk, with that stamp, is written');
reset role;

-- Another user takes over a verification: journaled as theirs.
set local role authenticated;
select pg_temp.as_user('9d000000-0000-4000-8000-000000000001');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000401', jsonb_build_object('is_verified', true,
  'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000001')), 1, 'the engineer verifies the line again');
select pg_temp.as_user('9d000000-0000-4000-8000-000000000002');
select is(pg_temp.decisions_save('9d000000-0000-4000-8000-000000000401', jsonb_build_object('is_verified', true,
  'verified_at', now(), 'verified_by', '9d000000-0000-4000-8000-000000000002')), 1, 'the admin verifies it in turn');
reset role;
select is((select count(*)::integer from public.audit_logs log
  where log.user_id = '9d000000-0000-4000-8000-000000000002'
    and log.after_data -> 'metadata' ->> 'item_id' = '9d000000-0000-4000-8000-000000000401'
    and log.after_data -> 'metadata' ->> 'field' = 'is_verified'
    and log.after_data -> 'metadata' -> 'previous_value' = 'true'::jsonb
    and log.after_data -> 'metadata' -> 'next_value' = 'true'::jsonb), 1,
  'a verification another user takes over is journaled as theirs');

-- Keys of the failed rules and reopening: the TS table (failure-keys.test.ts) ----------------------------

select is(public.takeoff_rule_failure_keys(fixture.results), fixture.expected, fixture.name)
from (values
  ('no results', null::jsonb, '[]'::jsonb),
  ('an object instead of a list', '{"rule":"dn_network"}', '[]'),
  ('an empty list', '[]', '[]'),
  ('a passed rule', '[{"rule":"dn_network","status":"pass","code":"DN_NETWORK_COMPATIBLE","version":1,"acceptable":true,"reason":""}]', '[]'),
  ('a failed rule without partner', '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":1,"acceptable":true,"reason":"Fictif."}]',
    '["dn_network|DN_NETWORK_DN_MISSING|1|"]'),
  ('one key per partner, in lower case, sorted', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"acceptable":true,"reason":"Fictif.","details":{"partners":[{"item_id":"0B000000-0000-4000-8000-00000000000B"},{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]',
    '["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|0a000000-0000-4000-8000-00000000000a","zone_overlap|ZONE_OVERLAP_DUPLICATE|1|0b000000-0000-4000-8000-00000000000b"]'),
  ('overlapping rooms named twice', '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"overlapping_item_ids":["0b000000-0000-4000-8000-00000000000b","0B000000-0000-4000-8000-00000000000B"]}}]',
    '["room_overlap|ROOM_OVERLAP|1|0b000000-0000-4000-8000-00000000000b"]'),
  ('partners and overlapping rooms together', '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1,"acceptable":true,"reason":"Fictif.","details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}],"overlapping_item_ids":["0b000000-0000-4000-8000-00000000000b"]}}]',
    '["room_overlap|ROOM_OVERLAP|1|0a000000-0000-4000-8000-00000000000a","room_overlap|ROOM_OVERLAP|1|0b000000-0000-4000-8000-00000000000b"]'),
  ('a version written 1.0', '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":1.0,"acceptable":true,"reason":"Fictif."}]',
    '["dn_network|DN_NETWORK_DN_MISSING|1|"]'),
  ('a version that is not an integer', '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":1.5},{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":"2"},{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":-1},{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":2147483648}]',
    '["dn_network|DN_NETWORK_DN_MISSING|?|"]'),
  ('the largest version', '[{"rule":"dn_network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":2147483647}]',
    '["dn_network|DN_NETWORK_DN_MISSING|2147483647|"]'),
  ('a rule or a code that is not a name', '[{"rule":"dn network","status":"fail","code":"DN_NETWORK_DN_MISSING","version":1},{"rule":5,"status":"fail","code":"BAD|CODE","version":1}]',
    '["?|?|1|","?|DN_NETWORK_DN_MISSING|1|"]'),
  ('a partner without identifier, or with a separator', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"zone":"Z1"},{"item_id":"0a000000-0000-4000-8000-00000000000a,0b000000-0000-4000-8000-00000000000b"},"x",null,{"item_id":7}]}}]',
    '["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|?"]'),
  ('a status written in capitals, and a result that is not an object', '[{"rule":"dn_network","status":"FAIL","code":"DN_NETWORK_DN_MISSING","version":1},"fail",["fail"],1]', '[]'),
  ('the same failure twice', '[{"rule":"closed_box","status":"fail","code":"CLOSED_BOX_LABEL","version":1},{"rule":"closed_box","status":"fail","code":"CLOSED_BOX_LABEL","version":1}]',
    '["closed_box|CLOSED_BOX_LABEL|1|"]'),
  ('details that are a list', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_UNREGISTERED","version":1,"details":[{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}]}]',
    '["zone_overlap|ZONE_OVERLAP_UNREGISTERED|1|"]'),
  ('partners that are not a list', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":{"item_id":"0a000000-0000-4000-8000-00000000000a"},"overlapping_item_ids":"0a000000-0000-4000-8000-00000000000a"}}]',
    '["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|"]'),
  ('several rules, sorted by byte', '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1},{"rule":"area_printed","status":"fail","code":"AREA_PRINTED_MISMATCH","version":1},{"rule":"non_observable","status":"fail","code":"NON_OBSERVABLE_TO_ENTER","version":1,"acceptable":false}]',
    '["area_printed|AREA_PRINTED_MISMATCH|1|","non_observable|NON_OBSERVABLE_TO_ENTER|1|","room_overlap|ROOM_OVERLAP|1|"]'),
  ('an empty partner list', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[]}}]',
    '["zone_overlap|ZONE_OVERLAP_DUPLICATE|1|"]')
) as fixture(name, results, expected);

select is(public.takeoff_rule_failures_reopen(fixture.previous, fixture.next), fixture.expected, fixture.name)
from (values
  ('a failure the line did not have', '[]'::jsonb,
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]'::jsonb, true),
  ('the same failure computed again',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', false),
  ('a failure that disappears closes by itself',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', '[]', false),
  ('a new partner',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"},{"item_id":"0b000000-0000-4000-8000-00000000000b"}]}}]', true),
  ('a partner that leaves',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"},{"item_id":"0b000000-0000-4000-8000-00000000000b"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', false),
  ('a new version of the rule',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":2,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', true),
  ('another code of the rule',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_UNREGISTERED","version":1}]', true),
  ('one failure of two left',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}},{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1}]',
    '[{"rule":"room_overlap","status":"fail","code":"ROOM_OVERLAP","version":1}]', false),
  ('stored results that are not a list', '{"broken":true}',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', true),
  ('results to write that are not a list',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0a000000-0000-4000-8000-00000000000a"}]}}]', '"broken"', false),
  ('a passed rule that fails', '[{"rule":"area_printed","status":"pass","code":"AREA_PRINTED_CONSISTENT","version":1,"acceptable":true,"reason":""}]',
    '[{"rule":"area_printed","status":"fail","code":"AREA_PRINTED_MISMATCH","version":1}]', true),
  ('the same identifier in capitals',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0b000000-0000-4000-8000-00000000000b"}]}}]',
    '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":1,"details":{"partners":[{"item_id":"0B000000-0000-4000-8000-00000000000B"}]}}]', false)
) as fixture(name, previous, next, expected);

-- The displays of large overlap groups can be identical before and after a hidden replacement.
create function pg_temp.overlap_write(ids integer[], proof boolean default true, stamp text default null)
returns boolean language sql as $$
  with entries as (
    select n, pos, 'p' || lpad(n::text,3,'0') as id from unnest(ids) with ordinality as a(n,pos)
  ), identity as (
    select array_agg('zone_overlap|ZONE_OVERLAP_DUPLICATE|1|' || id order by id collate "C") as keys,
      jsonb_agg(jsonb_build_object('item_id',id) order by pos) filter (where pos <= 50) as displayed from entries
  ), payload as (
    select jsonb_build_object('id', item.id, 'expected_updated_at',item.updated_at,'expected_stale_at',item.rules_stale_at,
      'results', jsonb_build_array(jsonb_build_object('rule','zone_overlap','code','ZONE_OVERLAP_DUPLICATE',
      'status','fail','version',1,'acceptable',true,'reason','Plan fictif.',
      'details', jsonb_build_object('partners',displayed,'partner_count',cardinality(ids)) ||
        case when proof and cardinality(ids)>50 then jsonb_build_object('failure_keys_sha256',
          encode(sha256(convert_to(array_to_string(keys,chr(10)),'UTF8')),'hex')) else '{}'::jsonb end))) ||
      case when proof and cardinality(ids)>50 then jsonb_build_object('complete_failure_keys',keys) else '{}'::jsonb end as entry
    from identity, public.takeoff_items item where item.id='9d000000-0000-4000-8000-000000000401'
  )
  select w.reopened from payload, lateral public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9d000000-0000-4000-8000-000000000101',jsonb_build_array(entry),'[]'::jsonb,stamp) w
$$;

select pg_temp.overlap_write(array(select generate_series(1,50)));
update public.takeoff_items set is_verified=true, verified_by='9d000000-0000-4000-8000-000000000001',verified_at=now()
where id='9d000000-0000-4000-8000-000000000401';
select is(pg_temp.overlap_write(array(select generate_series(1,51)),false),null::boolean,'an older writer cannot discard the 51st identity');
select ok((select rules_stale and public.takeoff_item_rule_blocked(rule_results,rules_stale,is_verified)
  from public.takeoff_items where id='9d000000-0000-4000-8000-000000000401'),
  'a verified, previously fresh line blocks after an old writer attempts an incomplete evaluation');
select is(pg_temp.overlap_write(array(select generate_series(1,51)),true,'stale-stamp'),null::boolean,'stale evaluation writes no proof');
select is(pg_temp.overlap_write(array(select generate_series(1,51))),true,'50 to 51 partners reopens');
select ok((select not is_verified and verified_at is null and verified_by is null from public.takeoff_items
  where id='9d000000-0000-4000-8000-000000000401'),'the 51st partner withdraws verification');
select ok(exists(select 1 from public.audit_logs where after_data#>>'{metadata,item_id}'='9d000000-0000-4000-8000-000000000401'
  and after_data#>>'{metadata,reason}' like '%ZONE_OVERLAP_DUPLICATE%'),'hidden new partner journaled by the writer');
update public.takeoff_items set is_verified=true,verified_at=now(),verified_by='9d000000-0000-4000-8000-000000000001'
where id='9d000000-0000-4000-8000-000000000401';
select set_config('test.override_overflow',(select pg_temp.decisions_state(id,jsonb_build_array(
  'sha256:' || (rule_results#>>'{0,details,failure_keys_sha256}')))::text from public.takeoff_items
  where id='9d000000-0000-4000-8000-000000000401'),true);
select is(pg_temp.overlap_write(array(select generate_series(51,1,-1))),false,'a reorder keeps verification');
select ok((select public.takeoff_apply_override_state_holds(current_setting('test.override_overflow')::jsonb,item) from public.takeoff_items item
  where id='9d000000-0000-4000-8000-000000000401'),'reordering a truncated group preserves its override');
select is(pg_temp.overlap_write(array(select generate_series(1,51))),false,'restoring the visible order preserves verification');
select ok((select not public.takeoff_apply_override_state_holds(pg_temp.decisions_state(item.id,
  (select failure_keys from takeoff_internal.rule_failure_proofs where item_id=item.id) || '[null]'::jsonb),item)
  from public.takeoff_items item where id='9d000000-0000-4000-8000-000000000401'),
  'malformed override keys cannot hash to the identity of a real set');
select is(pg_temp.overlap_write(array(select generate_series(1,50)) || 52),true,'a hidden replacement at equal size reopens');
select ok((select not public.takeoff_apply_override_state_holds(current_setting('test.override_overflow')::jsonb,item) from public.takeoff_items item
  where id='9d000000-0000-4000-8000-000000000401'),'the previous override does not cover the replacement');
update public.takeoff_items set is_verified=true,verified_at=now(),verified_by='9d000000-0000-4000-8000-000000000001'
where id='9d000000-0000-4000-8000-000000000401';
select set_config('test.override_before_removal',(select pg_temp.decisions_state(id,jsonb_build_array(
  'sha256:' || (rule_results#>>'{0,details,failure_keys_sha256}')))::text from public.takeoff_items
  where id='9d000000-0000-4000-8000-000000000401'),true);
select is(pg_temp.overlap_write(array(select generate_series(2,50)) || 52),false,'a removal bringing a hidden partner into view does not reopen');
select ok((select is_verified from public.takeoff_items where id='9d000000-0000-4000-8000-000000000401'),'the reduced group stays verified');
select ok((select not public.takeoff_apply_override_state_holds(current_setting('test.override_before_removal')::jsonb,item)
  from public.takeoff_items item where id='9d000000-0000-4000-8000-000000000401'),
  'a removal alone invalidates the override despite the verification still holding');
select ok(not has_table_privilege('authenticated','takeoff_internal.rule_failure_proofs','SELECT') and
          not has_table_privilege('anon','takeoff_internal.rule_failure_proofs','SELECT'),
          'neither application role can read the private proof');
-- Historical truncation without a proof: the visible list cannot authorize hidden partners.
update public.takeoff_items set rule_results=jsonb_set(rule_results,'{0,details,partner_count}','51')
where id='9d000000-0000-4000-8000-000000000401';
select is(pg_temp.overlap_write(array(select generate_series(2,52))),true,'the first complete evaluation reopens legacy truncation');

select * from finish();
rollback;
