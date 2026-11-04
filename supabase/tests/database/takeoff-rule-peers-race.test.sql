-- TI-677 (métré L5) : deux enregistrements concurrents d'une même version ne s'interbloquent plus (Codex #160,
-- fil 4467587403 ; migration 20261104215000_takeoff_rule_bounds_and_serialization.sql). Prérequis de
-- MERGEONE_TAKEOFF_RULES=1. Isolation justifiée : un interblocage ne se provoque qu'entre deux sessions dont les
-- verrous s'entrelacent, ce qu'aucun parcours ne fait de façon déterministe.
-- Cas écrit avant la migration : chaque UPDATE de la revue verrouille sa ligne, puis l'invalidation des voisines
-- verrouille les autres lignes de la version. A tient sa ligne et attend celle de B, B tient la sienne et attend une
-- ligne que tient A : PostgreSQL annule l'un des deux enregistrements (« deadlock detected »). Une troisième session
-- tient une ligne voisine le temps que les deux enregistrements démarrent, pour que leurs verrous s'entrelacent.
-- Après la migration, la revue enregistre par update_takeoff_item_for_review, qui prend le verrou de la version avant
-- celui de la ligne : B attend A, puis passe.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- Every session connects to the same disposable local PostgreSQL socket; the fixtures are committed because
-- independent sessions must see them, and removed at the end.
create temp table peers_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
select is(extensions.dblink_connect('peers_setup', (select connection from peers_race_connection)), 'OK', 'fixture session connected');
select is(extensions.dblink_connect('peers_hold', (select connection from peers_race_connection)), 'OK', 'holding session connected');
select is(extensions.dblink_connect('peers_a', (select connection from peers_race_connection)), 'OK', 'first review session connected');
select is(extensions.dblink_connect('peers_b', (select connection from peers_race_connection)), 'OK', 'second review session connected');

select is(extensions.dblink_exec('peers_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', '9f100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'peers-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = '9f100000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select '9f100000-0000-4000-8000-000000000010', m.tenant_id, m.user_id, 'Course des voisines (fictif)', false
from public.tenant_memberships m where m.user_id = '9f100000-0000-4000-8000-000000000001' and m.is_default;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select '9f100000-0000-4000-8000-000000000101', m.tenant_id, '9f100000-0000-4000-8000-000000000010', 1, 'draft', 2, 1, 0
from public.tenant_memberships m where m.user_id = '9f100000-0000-4000-8000-000000000001' and m.is_default;
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select job.id, m.tenant_id, '9f100000-0000-4000-8000-000000000101', 'C', 'completed', job.file, m.user_id
from public.tenant_memberships m cross join (values
  ('9f100000-0000-4000-8000-000000000301'::uuid, 'zone-1-fictif.pdf'), ('9f100000-0000-4000-8000-000000000302'::uuid, 'zone-2-fictif.pdf')
) as job(id, file) where m.user_id = '9f100000-0000-4000-8000-000000000001' and m.is_default;
-- Three evaluated lines of the version, the neighbour first (the peer invalidation reaches it before the others).
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
  rule_results, rules_evaluated_at, created_at)
select line.id, m.tenant_id, line.job_id, 'EF cuivre 20/22', 5, 'ml', 0.95, 'Repère localisé', 'plan-fictif.pdf', 1,
  '[]'::jsonb, now(), now() + line.rank * interval '1 second'
from public.tenant_memberships m cross join (values
  ('9f100000-0000-4000-8000-000000000400'::uuid, '9f100000-0000-4000-8000-000000000301'::uuid, 0),
  ('9f100000-0000-4000-8000-000000000401'::uuid, '9f100000-0000-4000-8000-000000000301'::uuid, 1),
  ('9f100000-0000-4000-8000-000000000402'::uuid, '9f100000-0000-4000-8000-000000000302'::uuid, 2)
) as line(id, job_id, rank) where m.user_id = '9f100000-0000-4000-8000-000000000001' and m.is_default;
commit;
$setup$), 'COMMIT', 'fixtures committed');

-- The review's save of one line, as the engineer through the Data API (the call the server makes).
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('peers_a'), ('peers_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, $claims$select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"9f100000-0000-4000-8000-000000000001"}', false), set_config('request.jwt.claim.sub',
  '9f100000-0000-4000-8000-000000000001', false)$claims$) as claims(full_claims text, sub text)),
  '9f100000-0000-4000-8000-000000000001', format('%s carries the engineer''s claims', session.name))
from (values ('peers_a'), ('peers_b')) as session(name);
create temp table peers_race_saves(label text primary key, query text);
insert into peers_race_saves
select line.label, format($save$select count(*)::integer from public.update_takeoff_item_for_review(
  (select tenant_id from public.takeoff_items where id = %1$L), %2$L, %1$L,
  (select updated_at from public.takeoff_items where id = %1$L), jsonb_build_object('quantity', %3$s))$save$,
  line.item_id, line.job_id, line.quantity)
from (values
  ('a', '9f100000-0000-4000-8000-000000000401', '9f100000-0000-4000-8000-000000000301', 2),
  ('b', '9f100000-0000-4000-8000-000000000402', '9f100000-0000-4000-8000-000000000302', 3)
) as line(label, item_id, job_id, quantity);

-- A third session holds the neighbour, so that both saves start before either reaches it.
select is(extensions.dblink_exec('peers_hold', 'begin'), 'BEGIN', 'holding transaction started');
select is((select count(*)::integer from extensions.dblink('peers_hold',
  'select id from public.takeoff_items where id = ''9f100000-0000-4000-8000-000000000400'' for update') as x(id uuid)), 1,
  'the neighbour line is held');
select is(extensions.dblink_send_query('peers_a', (select query from peers_race_saves where label = 'a')), 1, 'the first save starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('peers_a'), 1, 'the first save waits for the neighbour');
select is(extensions.dblink_send_query('peers_b', (select query from peers_race_saves where label = 'b')), 1, 'the second save starts');
select pg_sleep(0.3);
select is(extensions.dblink_is_busy('peers_b'), 1, 'the second save waits too');
select is(extensions.dblink_exec('peers_hold', 'rollback'), 'ROLLBACK', 'the neighbour is released');

select is((select x.saved from extensions.dblink_get_result('peers_a', false) as x(saved integer)), 1, 'the first save is written');
select is(extensions.dblink_error_message('peers_a'), 'OK', 'the first save is never cancelled');
select is((select count(*)::integer from extensions.dblink_get_result('peers_a', false) as x(saved integer)), 0, 'the first save is done');
select is((select x.saved from extensions.dblink_get_result('peers_b', false) as x(saved integer)), 1, 'the second save is written');
select is(extensions.dblink_error_message('peers_b'), 'OK', 'the second save is never cancelled');
select is((select count(*)::integer from extensions.dblink_get_result('peers_b', false) as x(saved integer)), 0, 'the second save is done');

select is((select array_agg(quantity::text || ':' || rules_stale::text order by id) from public.takeoff_items
  where id in ('9f100000-0000-4000-8000-000000000400', '9f100000-0000-4000-8000-000000000401', '9f100000-0000-4000-8000-000000000402')),
  array['5.000:true', '2.000:true', '3.000:true'], 'both quantities are saved, and every line of the version waits for the server');

-- Clean the committed synthetic fixtures of this disposable database.
select is(extensions.dblink_exec('peers_setup', $cleanup$
begin;
delete from public.takeoff_items where job_id in ('9f100000-0000-4000-8000-000000000301', '9f100000-0000-4000-8000-000000000302');
delete from public.takeoff_jobs where id in ('9f100000-0000-4000-8000-000000000301', '9f100000-0000-4000-8000-000000000302');
delete from public.estimate_versions where id = '9f100000-0000-4000-8000-000000000101';
delete from public.estimate_projects where id = '9f100000-0000-4000-8000-000000000010';
delete from public.estimate_rules where tenant_id = (select tenant_id from public.tenant_memberships where user_id = '9f100000-0000-4000-8000-000000000001' and is_default);
delete from public.audit_logs where tenant_id = (select tenant_id from public.tenant_memberships where user_id = '9f100000-0000-4000-8000-000000000001' and is_default);
delete from public.feature_flags where tenant_id = (select tenant_id from public.tenant_memberships where user_id = '9f100000-0000-4000-8000-000000000001' and is_default);
delete from public.tenants where id = (select tenant_id from public.tenant_memberships where user_id = '9f100000-0000-4000-8000-000000000001' and is_default);
delete from auth.users where id = '9f100000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is(extensions.dblink_disconnect('peers_setup'), 'OK', 'fixture session disconnected');
select is(extensions.dblink_disconnect('peers_hold'), 'OK', 'holding session disconnected');
select is(extensions.dblink_disconnect('peers_a'), 'OK', 'first review session disconnected');
select is(extensions.dblink_disconnect('peers_b'), 'OK', 'second review session disconnected');
select * from finish();
rollback;
