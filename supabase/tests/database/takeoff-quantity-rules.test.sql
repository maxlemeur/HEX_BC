-- TI-664 (métré L5) : les règles fixes comptées par le garde d'application
-- (migration 20261103213336_takeoff_quantity_rules.sql). Isolation justifiée : un
-- client Data API qui appelle la RPC sans passer par le serveur, la parité du
-- décompte avec l'audit d'un override admin et l'écriture réservée au serveur ne
-- s'observent pas depuis un parcours.
-- Cas écrits avant la migration :
-- - une ligne dont une règle échoue fait échouer la RPC à 4 et à 5 arguments, en
--   niveau C comme en niveau B ;
-- - après la décision de l'utilisateur (V), l'application non forcée réussit ;
--   une règle non acceptable (quantité à saisir) bloque même vérifiée ;
-- - des résultats périmés bloquent ; un client qui modifie la quantité les périme ;
-- - authenticated ne réécrit ni un résultat, ni son horodatage, ni son état ;
-- - la saisie d'une quantité s'atteste comme une vérification, et s'efface quand
--   la quantité change sans nouvelle attestation ;
-- - écrire les résultats ne déplace pas updated_at ;
-- - l'écrivain est réservé au service, ignore une ligne modifiée depuis sa lecture
--   et une ligne d'un job appliqué, et n'écrit rien quand la version a changé
--   depuis la lecture du calcul (revue) ;
-- - un client ne fixe jamais updated_at lui-même (revue) ;
-- - un override admin avec une ligne bloquée par une ancienne raison et une autre par
--   une nouvelle seulement réussit et consomme son audit ; un audit qui n'en nomme
--   qu'une échoue.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

create temporary table rules_outcome (case_name text primary key, outcome text) on commit drop;
grant all on rules_outcome to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'rules-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'rules-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

-- The engineer's personal tenant is the fixture's; the admin joins it as its default tenant.
update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '9e000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = '9e000000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = '9e000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('9e000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  '9e000000-0000-4000-8000-000000000001', 'Règles fixes (fictif)', false);

-- One v2 draft per case, each with its target section.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select fixture.id, current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000010', fixture.number, 'draft', 2, 1, 0
from (values
  ('9e000000-0000-4000-8000-000000000101'::uuid, 1), ('9e000000-0000-4000-8000-000000000102'::uuid, 2),
  ('9e000000-0000-4000-8000-000000000103'::uuid, 3), ('9e000000-0000-4000-8000-000000000104'::uuid, 4),
  ('9e000000-0000-4000-8000-000000000105'::uuid, 5), ('9e000000-0000-4000-8000-000000000106'::uuid, 6),
  ('9e000000-0000-4000-8000-000000000107'::uuid, 7)
) as fixture(id, number);

insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select ('9e000000-0000-4000-8000-0000000002' || right(version.id::text, 2))::uuid, version.tenant_id, version.id, 'section', 0, 'Lot fictif'
from public.estimate_versions version
where version.project_id = '9e000000-0000-4000-8000-000000000010';

-- Jobs: ...301 C (rule failed, decided by V), ...302 B (rule failed), ...303 C (quantity to enter),
-- ...304 C (stale after a client edit), ...305 C (override: an old reason and a new one), ...306 C (writer),
-- ...307 and ...308 C, two zone jobs of one version (a partner's edit makes the other job's results stale).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.version_id, fixture.level::public.takeoff_job_level,
  'completed', 'plan-fictif.pdf', '9e000000-0000-4000-8000-000000000001'
from (values
  ('9e000000-0000-4000-8000-000000000301'::uuid, '9e000000-0000-4000-8000-000000000101'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000302'::uuid, '9e000000-0000-4000-8000-000000000102'::uuid, 'B'),
  ('9e000000-0000-4000-8000-000000000303'::uuid, '9e000000-0000-4000-8000-000000000103'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000304'::uuid, '9e000000-0000-4000-8000-000000000104'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000305'::uuid, '9e000000-0000-4000-8000-000000000105'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000306'::uuid, '9e000000-0000-4000-8000-000000000106'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000307'::uuid, '9e000000-0000-4000-8000-000000000107'::uuid, 'C'),
  ('9e000000-0000-4000-8000-000000000308'::uuid, '9e000000-0000-4000-8000-000000000107'::uuid, 'C')
) as fixture(id, version_id, level);

-- ...309 C, a third job of version 107 still being read (its lines arrive before its completion).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values ('9e000000-0000-4000-8000-000000000309', current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000107',
  'C', 'processing', 'plan-fictif.pdf', '9e000000-0000-4000-8000-000000000001');

-- A failed acceptable rule (a Z1/Z2 duplicate), a failed rule verifying never settles (a quantity to enter).
select set_config('test.duplicate', '[{"rule":"zone_overlap","status":"fail","code":"ZONE_OVERLAP_DUPLICATE","version":101,"acceptable":true,"reason":"Tronçon compté aussi en Z2."}]', true);
select set_config('test.to_enter', '[{"rule":"non_observable","status":"fail","code":"NON_OBSERVABLE_TO_ENTER","version":1,"acceptable":false,"reason":"Quantité à saisir."}]', true);

insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
  rule_results, rules_evaluated_at, created_at)
select fixture.id, current_setting('test.tenant_id')::uuid, fixture.job_id, fixture.designation, fixture.quantity, fixture.unit,
  fixture.confidence, 'Repère localisé', 'plan-fictif.pdf', 1, fixture.results::jsonb,
  case when fixture.results = '[]' then null else now() end, now() + fixture.rank * interval '1 second'
from (values
  ('9e000000-0000-4000-8000-000000000401'::uuid, '9e000000-0000-4000-8000-000000000301'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, current_setting('test.duplicate'), 1),
  ('9e000000-0000-4000-8000-000000000402'::uuid, '9e000000-0000-4000-8000-000000000302'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, current_setting('test.duplicate'), 2),
  ('9e000000-0000-4000-8000-000000000403'::uuid, '9e000000-0000-4000-8000-000000000303'::uuid, 'Soudures inox', 48::numeric, 'u', 0.95, current_setting('test.to_enter'), 3),
  ('9e000000-0000-4000-8000-000000000404'::uuid, '9e000000-0000-4000-8000-000000000304'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, '[{"rule":"dn_network","status":"pass","code":"DN_NETWORK_COMPATIBLE","version":1,"acceptable":true,"reason":"DN 22 compatible."}]', 4),
  -- 405: blocked by an old reason only (low confidence, not verified); 406: by a new reason only.
  ('9e000000-0000-4000-8000-000000000405'::uuid, '9e000000-0000-4000-8000-000000000305'::uuid, 'Vanne DN 22', 2::numeric, 'u', 0.30, '[]', 5),
  ('9e000000-0000-4000-8000-000000000406'::uuid, '9e000000-0000-4000-8000-000000000305'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, current_setting('test.duplicate'), 6),
  ('9e000000-0000-4000-8000-000000000407'::uuid, '9e000000-0000-4000-8000-000000000306'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, '[]', 7),
  ('9e000000-0000-4000-8000-000000000408'::uuid, '9e000000-0000-4000-8000-000000000306'::uuid, 'ECS inox DN 22', 3::numeric, 'ml', 0.95, '[]', 8),
  -- 409 (Z1, job 307) passes while its duplicate 410 (Z2, job 308) is excluded.
  ('9e000000-0000-4000-8000-000000000409'::uuid, '9e000000-0000-4000-8000-000000000307'::uuid, 'EF inox DN 22', 5::numeric, 'ml', 0.95, '[{"rule":"zone_overlap","status":"pass","code":"ZONE_OVERLAP_NONE","version":101,"acceptable":true,"reason":"Aucun tronçon commun."}]', 9),
  ('9e000000-0000-4000-8000-000000000410'::uuid, '9e000000-0000-4000-8000-000000000308'::uuid, 'EF inox DN 22', 3::numeric, 'ml', 0.95, '[{"rule":"zone_overlap","status":"pass","code":"ZONE_OVERLAP_NONE","version":101,"acceptable":true,"reason":"Aucun tronçon commun."}]', 10),
  -- 411 (job 307): a line the worker wrote with rule inputs, awaiting its first evaluation (stale, never evaluated).
  ('9e000000-0000-4000-8000-000000000411'::uuid, '9e000000-0000-4000-8000-000000000307'::uuid, 'EF inox DN 22', 2::numeric, 'ml', 0.95, '[]', 11)
) as fixture(id, job_id, designation, quantity, unit, confidence, results, rank);
update public.takeoff_items set rules_stale = true where id = '9e000000-0000-4000-8000-000000000411';

-- One lock per version: the admin holds the override's draft, the engineer every other one.
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
select version.id,
  case when version.id = '9e000000-0000-4000-8000-000000000105' then '9e000000-0000-4000-8000-000000000002'::uuid
    else '9e000000-0000-4000-8000-000000000001'::uuid end,
  version.tenant_id, statement_timestamp() + interval '30 minutes', gen_random_uuid()
from public.estimate_versions version
where version.project_id = '9e000000-0000-4000-8000-000000000010';

create or replace function pg_temp.rules_plan(p_job_id uuid)
returns jsonb
language sql
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', item.id, 'source_order', item.source_order, 'rule_id', null, 'action', 'none',
    'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null
  ) order by item.source_order), '[]'::jsonb)
  from (
    select ti.*, (row_number() over (order by ti.created_at, ti.id) - 1)::integer as source_order
    from public.takeoff_items ti where ti.job_id = p_job_id
  ) as item
$$;
grant execute on function pg_temp.rules_plan(uuid) to authenticated;

create or replace function pg_temp.rules_section(p_job_id uuid)
returns uuid
language sql
as $$
  select ('9e000000-0000-4000-8000-0000000002' || right(job.estimate_version_id::text, 2))::uuid
  from public.takeoff_jobs job where job.id = p_job_id
$$;
grant execute on function pg_temp.rules_section(uuid) to authenticated;

-- Each call records its outcome (« ok » or its SQLSTATE and message), so that a failure prints one line.
create or replace function pg_temp.rules_apply(p_case text, p_job_id uuid, p_permit text default null)
returns text
language plpgsql
as $$
declare
  outcome text := 'ok';
begin
  begin
    if p_permit is null then
      perform * from public.apply_takeoff_job_guarded_atomic(p_job_id, 'append', pg_temp.rules_section(p_job_id), pg_temp.rules_plan(p_job_id));
    else
      perform * from public.apply_takeoff_job_guarded_atomic(p_job_id, 'append', pg_temp.rules_section(p_job_id), pg_temp.rules_plan(p_job_id), p_permit);
    end if;
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  insert into rules_outcome values (p_case, outcome);
  return outcome;
end;
$$;
grant execute on function pg_temp.rules_apply(text, uuid, text) to authenticated;

create or replace function pg_temp.rules_exec(p_case text, p_sql text)
returns text
language plpgsql
as $$
declare
  outcome text := 'ok';
begin
  begin
    execute p_sql;
  exception when others then
    outcome := sqlstate || ' ' || sqlerrm;
  end;
  insert into rules_outcome values (p_case, outcome);
  return outcome;
end;
$$;
grant execute on function pg_temp.rules_exec(text, text) to authenticated;

-- An application leaves, until commit, its working tables and the settings that let the RPC write items
-- (app.takeoff_apply_atomic bypasses the client trigger): both are cleared (as their owner) after one, so that
-- the next statements of this single transaction run as a new request would.
create or replace function pg_temp.rules_clear()
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

-- The shared predicate -------------------------------------------------------------------------

select ok(not public.takeoff_item_rule_blocked('[]'::jsonb, false, false), 'no result never blocks');
select ok(public.takeoff_item_rule_blocked('[]'::jsonb, true, true), 'stale results block, verified or not');
select ok(public.takeoff_item_rule_blocked(current_setting('test.duplicate')::jsonb, false, false), 'a failed acceptable rule blocks an unverified line');
select ok(not public.takeoff_item_rule_blocked(current_setting('test.duplicate')::jsonb, false, true), 'verifying settles an acceptable failure');
select ok(public.takeoff_item_rule_blocked(current_setting('test.to_enter')::jsonb, false, true), 'verifying never settles a quantity to enter');
select ok(not public.takeoff_item_rule_blocked(
  '[{"rule":"non_observable","status":"pass","code":"NON_OBSERVABLE_ENTERED","version":1,"acceptable":false,"reason":"Saisie."}]'::jsonb, false, false),
  'a passed rule never blocks, acceptable or not');

-- The guard, as an engineer through the Data API ---------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"9e000000-0000-4000-8000-000000000001"}', true);

select is(pg_temp.rules_apply('guard-1', '9e000000-0000-4000-8000-000000000301'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a failed rule fails the 4-argument RPC (level C)');

select is(pg_temp.rules_apply('guard-2', '9e000000-0000-4000-8000-000000000302'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a failed rule fails the 4-argument RPC on a level B job too');

reset role;
insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash, expires_at)
values (current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000301', '9e000000-0000-4000-8000-000000000101',
  '9e000000-0000-4000-8000-000000000001', encode(sha256(convert_to('fixture-permit', 'UTF8')), 'hex'), statement_timestamp() + interval '5 minutes');
set local role authenticated;

select is(pg_temp.rules_apply('guard-3', '9e000000-0000-4000-8000-000000000301', 'fixture-permit'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a failed rule fails the 5-argument RPC with a valid permit');

-- authenticated never writes a rule result nor its state.
select is(pg_temp.rules_exec('update-1', 'update public.takeoff_items set rule_results = ''[]''::jsonb where id = ''9e000000-0000-4000-8000-000000000401'''), '42501 TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE', 'authenticated cannot rewrite a rule result');
select is(pg_temp.rules_exec('update-2', 'update public.takeoff_items set rules_stale = true where id = ''9e000000-0000-4000-8000-000000000404'''), '42501 TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE', 'authenticated cannot change the stale state of the results');
select is(pg_temp.rules_exec('update-3', 'update public.takeoff_items set rules_evaluated_at = null where id = ''9e000000-0000-4000-8000-000000000401'''), '42501 TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE', 'authenticated cannot rewrite when the rules ran');
select throws_ok($$select * from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000101', '[]'::jsonb)$$,
  '42501', 'permission denied for function write_takeoff_rule_results', 'authenticated cannot call the rule results writer');

-- The user's decision (V) settles the acceptable failure: the application, not forced, succeeds.
select is(pg_temp.rules_exec('update-6', 'update public.takeoff_items set is_verified = true, verified_by = ''9e000000-0000-4000-8000-000000000001'', verified_at = now()
  where id = ''9e000000-0000-4000-8000-000000000401'''), 'ok', 'the engineer verifies the duplicated line');
select is(pg_temp.rules_apply('apply-7', '9e000000-0000-4000-8000-000000000301'), 'ok', 'after the decision, the application not forced succeeds');
reset role;
select pg_temp.rules_clear();
set local role authenticated;

-- A quantity to enter: verifying never settles it.
select is(pg_temp.rules_exec('update-7', 'update public.takeoff_items set is_verified = true, verified_by = ''9e000000-0000-4000-8000-000000000001'', verified_at = now()
  where id = ''9e000000-0000-4000-8000-000000000403'''), 'ok', 'the engineer verifies the quantity to enter');
select is(pg_temp.rules_apply('guard-4', '9e000000-0000-4000-8000-000000000303'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'a verified quantity to enter still blocks');

-- The entry is attested by its author, now; another user's name is refused.
select is(pg_temp.rules_exec('update-4', 'update public.takeoff_items set quantity_entered_by = ''9e000000-0000-4000-8000-000000000002'', quantity_entered_at = now()
  where id = ''9e000000-0000-4000-8000-000000000403'''), '42501 TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID', 'an entry is attested by its own author');
select is(pg_temp.rules_exec('update-5', 'update public.takeoff_items set quantity_entered_by = ''9e000000-0000-4000-8000-000000000001''
  where id = ''9e000000-0000-4000-8000-000000000403'''), '42501 TAKEOFF_ITEM_QUANTITY_ENTRY_INVALID', 'an entry carries its time');
select is(pg_temp.rules_exec('update-8', 'update public.takeoff_items set quantity = 48, quantity_entered_by = ''9e000000-0000-4000-8000-000000000001'', quantity_entered_at = now()
  where id = ''9e000000-0000-4000-8000-000000000403'''), 'ok', 'the engineer enters the quantity, the model''s value included');
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000403'), true,
  'an entry makes the results stale until the server computes them');
select is(pg_temp.rules_exec('update-9', 'update public.takeoff_items set quantity = 50 where id = ''9e000000-0000-4000-8000-000000000403'''), 'ok', 'a quantity changed without a new attestation');
select is((select quantity_entered_by from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000403'), null::uuid,
  'a quantity changed without a new attestation is no longer the one entered');

-- A client edit makes evaluated results stale: blocked until the server computes them.
select is(pg_temp.rules_exec('update-10', 'update public.takeoff_items set quantity = 4 where id = ''9e000000-0000-4000-8000-000000000404'''), 'ok', 'the engineer corrects an evaluated quantity');
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'), true,
  'a client edit makes the evaluated results stale');
select is(pg_temp.rules_apply('guard-5', '9e000000-0000-4000-8000-000000000304'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'stale results block the application');
-- updated_at is the writer's token: a client never sets it itself.
select is(pg_temp.rules_exec('update-11', 'update public.takeoff_items set updated_at = ''2001-01-01T00:00:00Z'' where id = ''9e000000-0000-4000-8000-000000000408'''), 'ok', 'a client update of updated_at alone');
select isnt((select updated_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000408'), '2001-01-01T00:00:00Z'::timestamptz,
  'a client never sets updated_at itself: the trigger writes now()');
-- The scale rule reads the line's page: a client edit of the page makes evaluated results stale too (L5b review).
select is(pg_temp.rules_exec('update-12', 'update public.takeoff_items set source_page = 2 where id = ''9e000000-0000-4000-8000-000000000402'''), 'ok', 'the engineer moves an evaluated line to another page');
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000402'), true,
  'a page edit makes the evaluated results stale');
-- The rule inputs live in metadata, written by the worker only.
select is(pg_temp.rules_exec('update-13', 'update public.takeoff_items set metadata = jsonb_set(coalesce(metadata, ''{}''::jsonb), ''{rule_inputs}'', ''{"version":1}''::jsonb) where id = ''9e000000-0000-4000-8000-000000000408'''), '42501 TAKEOFF_ITEM_TRUSTED_FIELDS_IMMUTABLE', 'authenticated cannot rewrite the rule inputs');
-- A partner's edit makes the results of the version's other lines stale (Codex review of L5b): job 307's line passes
-- while its duplicate in job 308 is excluded; re-including it must block 307 until the server computes the version
-- again, even when that computation fails or is skipped.
select set_config('test.peer_updated_at', (select updated_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true);
select is(pg_temp.rules_exec('peer-1', 'update public.takeoff_items set is_excluded = true, exclusion_reason = ''Doublon fictif''
  where id = ''9e000000-0000-4000-8000-000000000410'''), 'ok', 'the engineer excludes the Z2 duplicate');
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true,
  'an edit of one line makes the evaluated lines of its version stale');
select is((select updated_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'),
  current_setting('test.peer_updated_at'), 'a partner made stale keeps its updated_at (the review''s concurrency token)');
reset role;
-- The server computes the version: 307 passes, 308 is excluded.
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now()
where id in ('9e000000-0000-4000-8000-000000000409', '9e000000-0000-4000-8000-000000000410');
-- What that computation read of 307: its stale token, as a later, obsolete computation would pass it.
select set_config('test.peer_stale_at', coalesce((select to_jsonb(item) ->> 'rules_stale_at' from public.takeoff_items as item
  where item.id = '9e000000-0000-4000-8000-000000000409'), ''), true);
set local role authenticated;
select is(pg_temp.rules_exec('peer-2', 'update public.takeoff_items set is_excluded = false, exclusion_reason = null
  where id = ''9e000000-0000-4000-8000-000000000410'''), 'ok', 'the engineer includes the Z2 line again');
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true,
  'its Z1 partner, in another job of the version, goes stale with it');
-- The computation fails: nothing is written. The Z1 job's application is refused.
select is(pg_temp.rules_apply('peer-3', '9e000000-0000-4000-8000-000000000307'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED',
  'a line made stale by its partner''s edit blocks the application until the version is computed again');
-- An obsolete computation never clears that stale state (Codex review of L5b): it read 307 before 308 came back, and
-- the edit landed after its stamp check (no stamp below). The partner's invalidation did not move 307's updated_at;
-- the writer must still see that 307 went stale again since it was read.
reset role;
set local role service_role;
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000107', jsonb_build_array(jsonb_build_object('id', '9e000000-0000-4000-8000-000000000409',
      'results', '[{"rule":"zone_overlap","status":"pass","code":"ZONE_OVERLAP_NONE","version":101,"acceptable":true,"reason":"Aucun tronçon commun."}]'::jsonb,
      'expected_updated_at', current_setting('test.peer_updated_at'),
      'expected_stale_at', nullif(current_setting('test.peer_stale_at'), ''))), '[]'::jsonb, null)),
  0, 'a computation that read a line before its partner''s edit never clears the stale state that edit set');
reset role;
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true,
  'the line stays stale until a computation that read it after the edit');
-- The same for a line awaiting its first evaluation (Codex review of L5b): a first computation read 411 (never
-- evaluated) before its partner's edit; the edit must move its token too, or the obsolete first pass is stored.
select set_config('test.unevaluated_updated_at', (select updated_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000411'), true);
select set_config('test.unevaluated_stale_at', coalesce((select to_jsonb(item) ->> 'rules_stale_at' from public.takeoff_items as item
  where item.id = '9e000000-0000-4000-8000-000000000411'), ''), true);
set local role authenticated;
select is(pg_temp.rules_exec('peer-4', 'update public.takeoff_items set quantity = 2.5 where id = ''9e000000-0000-4000-8000-000000000410'''), 'ok',
  'the engineer corrects the Z2 line');
reset role;
set local role service_role;
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000107', jsonb_build_array(jsonb_build_object('id', '9e000000-0000-4000-8000-000000000411',
      'results', '[{"rule":"zone_overlap","status":"pass","code":"ZONE_OVERLAP_NONE","version":101,"acceptable":true,"reason":"Aucun tronçon commun."}]'::jsonb,
      'expected_updated_at', current_setting('test.unevaluated_updated_at'),
      'expected_stale_at', nullif(current_setting('test.unevaluated_stale_at'), ''))), '[]'::jsonb, null)),
  0, 'a first computation that read a line before its partner''s edit never stores its obsolete pass');
reset role;
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000411'), true,
  'the line awaiting its first evaluation stays stale');
-- A job of the version completes after the worker wrote its lines (Codex review of L5b): a computation that ran in
-- between read only completed jobs and cleared the lines the insertion had made stale; the completion makes them
-- stale again, or their obsolete pass would be applied if the next computation failed.
reset role;
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now() where id = '9e000000-0000-4000-8000-000000000409';
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
  rules_stale, created_at)
values ('9e000000-0000-4000-8000-000000000412', current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000309',
  'EF inox DN 22', 4, 'ml', 0.95, 'Repère localisé', 'plan-fictif.pdf', 1, true, now());
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true,
  'the worker''s new line makes the version''s evaluated lines stale');
-- The computation before the completion reads completed jobs only: it clears 409 without the new line.
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now() where id = '9e000000-0000-4000-8000-000000000409';
select set_config('test.before_completion', (select rules_stale_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true);
update public.takeoff_jobs set status = 'completed' where id = '9e000000-0000-4000-8000-000000000309';
select is((select rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'), true,
  'the completion of a job makes the version''s lines stale again');
select isnt((select rules_stale_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000409'),
  current_setting('test.before_completion'), 'and moves their stale token, so a computation that read them before never clears it');
set local role authenticated;

reset role;

-- The server's writer (service role) -------------------------------------------------------------

-- A line last edited long ago (triggers off as the owner): a rule write must keep that time, not take now().
set local session_replication_role = replica;
update public.takeoff_items set updated_at = '2001-02-03T04:05:06Z' where id = '9e000000-0000-4000-8000-000000000407';
set local session_replication_role = origin;
select set_config('test.updated_407', (select updated_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000407'), true);
select set_config('test.stamp_106', public.takeoff_rule_version_stamp(current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000106'), true);
select set_config('test.updated_404', (select updated_at::text from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'), true);
set local role service_role;
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000106', jsonb_build_array(
      jsonb_build_object('id', '9e000000-0000-4000-8000-000000000407', 'results', current_setting('test.duplicate')::jsonb,
        'expected_updated_at', current_setting('test.updated_407')),
      jsonb_build_object('id', '9e000000-0000-4000-8000-000000000408', 'results', '[]'::jsonb,
        'expected_updated_at', '2001-01-01T00:00:00Z')), '[]'::jsonb, current_setting('test.stamp_106'))),
  1, 'the writer writes a line as it read it, never one changed since');
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000104', jsonb_build_array(jsonb_build_object('id', '9e000000-0000-4000-8000-000000000404',
      'results', '[]'::jsonb, 'expected_updated_at', (select updated_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'),
      'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'))),
    '[]'::jsonb, 'a stamp read before an edit')),
  0, 'the writer writes nothing when the version changed since the computation read it');
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000101', jsonb_build_array(jsonb_build_object('id', '9e000000-0000-4000-8000-000000000401',
      'results', '[]'::jsonb, 'expected_updated_at', (select updated_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000401'))))),
  0, 'the writer never writes a line of an applied job');
select is(
  (select count(*)::integer from public.write_takeoff_rule_results(current_setting('test.tenant_id')::uuid,
    '9e000000-0000-4000-8000-000000000104', jsonb_build_array(jsonb_build_object('id', '9e000000-0000-4000-8000-000000000404',
      'results', '[]'::jsonb, 'expected_updated_at', (select updated_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'),
      'expected_stale_at', (select rules_stale_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'))))),
  1, 'the server computes the stale line again');
reset role;

select is((select rule_results from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000407'),
  current_setting('test.duplicate')::jsonb, 'the written results are stored');
select is((select updated_at from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000407'),
  '2001-02-03T04:05:06Z'::timestamptz, 'writing rule results does not move updated_at');
select ok((select rules_evaluated_at is not null and not rules_stale from public.takeoff_items where id = '9e000000-0000-4000-8000-000000000404'),
  'a computation clears the stale state');

-- Override: one line blocked by an old reason, one by a new reason only ------------------------------

set local role authenticated;
select set_config('request.jwt.claim.sub', '9e000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"9e000000-0000-4000-8000-000000000002"}', true);
reset role;

insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
values (current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000002', 'takeoff_jobs',
  '9e000000-0000-4000-8000-000000000305', '9e000000-0000-4000-8000-000000000105', 'takeoff.apply.override',
  jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', '9e000000-0000-4000-8000-000000000305',
    'tenant_id', current_setting('test.tenant_id'), 'user_id', '9e000000-0000-4000-8000-000000000002',
    'metadata', jsonb_build_object('estimate_version_id', '9e000000-0000-4000-8000-000000000105', 'threshold', 0.5,
      'blocked_item_ids', jsonb_build_array('9e000000-0000-4000-8000-000000000405'), 'blocked_items_count', 1,
      'justification', 'Audit qui oublie la ligne de règle')));

set local role authenticated;
select is(pg_temp.rules_apply('guard-6', '9e000000-0000-4000-8000-000000000305'), 'P0001 TAKEOFF_APPLY_GUARD_FAILED', 'an override audit that leaves out the line a rule blocks is refused');
reset role;

insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data, created_at)
values (current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000002', 'takeoff_jobs',
  '9e000000-0000-4000-8000-000000000305', '9e000000-0000-4000-8000-000000000105', 'takeoff.apply.override',
  jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.override', 'job_id', '9e000000-0000-4000-8000-000000000305',
    'tenant_id', current_setting('test.tenant_id'), 'user_id', '9e000000-0000-4000-8000-000000000002',
    'metadata', jsonb_build_object('estimate_version_id', '9e000000-0000-4000-8000-000000000105', 'threshold', 0.5,
      'blocked_item_ids', jsonb_build_array('9e000000-0000-4000-8000-000000000405', '9e000000-0000-4000-8000-000000000406'),
      'blocked_items_count', 2, 'justification', 'Vérifié sur le plan fictif',
      -- TI-677 (PR D): each lifted line's state, as the route records it (apply-override-state.ts).
      'blocked_items_state', (select jsonb_agg(jsonb_build_object('item_id', ti.id, 'quantity', ti.quantity, 'unit', ti.unit,
        'updated_at', ti.updated_at, 'rule_failures', public.takeoff_rule_failure_keys(ti.rule_results), 'rules_stale', ti.rules_stale))
        from public.takeoff_items ti
        where ti.id in ('9e000000-0000-4000-8000-000000000405', '9e000000-0000-4000-8000-000000000406')))),
  statement_timestamp() + interval '1 second');

set local role authenticated;
select is(pg_temp.rules_apply('apply-8', '9e000000-0000-4000-8000-000000000305'), 'ok', 'an admin override naming the line of an old reason and the line of a new one succeeds');
reset role;
select pg_temp.rules_clear();
set local role authenticated;
reset role;

select is((select count(*)::integer from public.takeoff_apply_override_consumptions where job_id = '9e000000-0000-4000-8000-000000000305'),
  1, 'the override consumes its audit');
select is((select status::text from public.takeoff_jobs where id = '9e000000-0000-4000-8000-000000000305'), 'applied',
  'the overridden job is applied');

select * from finish();
rollback;
