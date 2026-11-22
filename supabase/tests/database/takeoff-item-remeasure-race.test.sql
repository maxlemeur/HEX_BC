-- Lot 4, PR 4b (…_takeoff_item_remeasure_admission.sql): the admission of a new measure of a selection across sessions.
-- 1. Two confirmations at once (two tabs): the second waits for the affaire's review key, then answers already_running;
--    the first one's answer lost and sent again is replayed; one request is admitted, once.
-- 2. A confirmation while a bulk review of the same item commits: it waits, then compares what is committed (the review
--    changes no reading) and is admitted; the review's decision stands.
-- 3. A confirmation while a new reading publishes a replacement of a selected reading: it compares once its locks are
--    held, and answers stale; nothing is admitted.
-- 4. A confirmation compared while a new reading of the affaire still runs, whose last publication commits after the
--    comparison and before the launch looks for a running analysis (the confirmation waits for the launch's key): the
--    admission compares again under the launch's locks and answers stale; nothing is admitted, no receipt.
-- 5. A list edit that removes the selected item while the confirmation waits at the seal (for the list key): the
--    confirmation answers stale naming it, as the same confirmation started after the edit does; nothing is written.
-- 6. A preparation edit in flight when the confirmation starts: the confirmation waits for it, then is refused (the
--    plan is no longer confirmed); nothing admitted.
-- 7. A preparation edit that withdraws the plan once the confirmation compared it (the confirmation waits at the seal):
--    the edit waits until the admission ends; the analysis reads the preparation the admission compared.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5800000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5800000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures and the worker's steps; race_a and race_b are two sessions of the server.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

-- Affaire 20, one plan (100, read on its pages 2 and 7), a list of two items (300, 301) in its revision 400.
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'item-remeasure-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5800000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5800000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select 'd5800000-0000-4000-8000-000000000020', m.tenant_id, m.user_id, 'Affaire remesurée en concurrence (fictive)', false
from public.tenant_memberships m where m.user_id = 'd5800000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
values ('d5800000-0000-4000-8000-000000000030', 'd5800000-0000-4000-8000-000000000020', 'd5800000-0000-4000-8000-000000000001', 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values ('d5800000-0000-4000-8000-000000000060', 'd5800000-0000-4000-8000-000000000020', 'd5800000-0000-4000-8000-000000000030',
  'confirme', 'Résumé fictif', 'Objet fictif', now(), 'd5800000-0000-4000-8000-000000000001');
insert into public.plan_sets (id, tenant_id, project_id, name)
select 'd5800000-0000-4000-8000-000000000040', p.tenant_id, p.id, 'Plans du dossier'
from public.estimate_projects p where p.id = 'd5800000-0000-4000-8000-000000000020';
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select 'd5800000-0000-4000-8000-000000000100', s.tenant_id, s.id, 'plan-1.pdf',
  concat_ws('/', s.tenant_id, s.id, 'd5800000-0000-4000-8000-000000000100', 'plan-1.pdf'), 'application/pdf', 8, 9
from public.plan_sets s where s.id = 'd5800000-0000-4000-8000-000000000040';
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select ('d5800000-0000-4000-8000-000000000' || (300 + k))::uuid, p.tenant_id, p.id, 'manual', 1, p.user_id
from generate_series(0, 1) as k join public.estimate_projects p on p.id = 'd5800000-0000-4000-8000-000000000020';
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
select 'd5800000-0000-4000-8000-000000000400', p.tenant_id, p.id, 1, 'item_added', '{}', 2, repeat('1', 64), repeat('a', 64),
  'd5800000-0000-4000-8000-000000000410', p.user_id
from public.estimate_projects p where p.id = 'd5800000-0000-4000-8000-000000000020';
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select 'd5800000-0000-4000-8000-000000000400', p.tenant_id, p.id, ('d5800000-0000-4000-8000-000000000' || (300 + k))::uuid, k,
  'manual:poste-' || k, 'Poste ' || k || ' (fictif)', 'u', 'manual', '{"kind":"manual"}'
from generate_series(0, 1) as k join public.estimate_projects p on p.id = 'd5800000-0000-4000-8000-000000000020';
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'an affaire of one plan and a list of two items, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.job(n integer) returns uuid language sql immutable as $$ select pg_temp.f(1000 + n) $$;
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
-- The affaire's preparation revision as committed now (1 before it is stored).
create function pg_temp.prep_revision() returns integer language sql stable as $$
  select coalesce((select revision from public.takeoff_preparations where project_id = pg_temp.f(20)), 1)
$$;
create function pg_temp.snapshot(p_revision integer default null) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', coalesce(p_revision, pg_temp.prep_revision()), 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[2, 7]'::jsonb))
        from public.plan_files f where f.plan_set_id = pg_temp.f(40))))
$$;
-- The list sealed: the revision given, else the affaire's latest.
create function pg_temp.manifest(asked integer[] default null, p_revision integer default null) returns jsonb
language sql stable as $$
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
      'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count)
      || case when asked is null then '{}'::jsonb else jsonb_build_object('asked_item_ids',
        (select jsonb_agg(pg_temp.f(i)::text order by pg_temp.f(i)) from unnest(asked) i)) end)
      from public.takeoff_list_revisions r where r.project_id = pg_temp.f(20)
        and (p_revision is null or r.id = pg_temp.f(p_revision)) order by r.revision desc limit 1),
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', jsonb_build_array(jsonb_build_object('key', 'plan:' || pg_temp.f(100), 'ordinal', 1, 'plans', jsonb_build_array(pg_temp.f(100)),
      'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0, 'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))),
    'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(100), 'plan_file_id', pg_temp.f(100), 'name', 'plan-1.pdf',
      'logical_id', pg_temp.f(100), 'generation', null, 'content_sha256', pg_temp.digest(pg_temp.f(100)), 'pages', '[2, 7]'::jsonb,
      'page_count', 9)),
    'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))
$$;
create function pg_temp.jobs(n integer) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('id', pg_temp.job(n), 'plan_set_id', pg_temp.f(40),
    'launch_unit_key', 'plan:' || pg_temp.f(100), 'source_file_name', 'plan-1.pdf', 'source_file_type', 'application/pdf',
    'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host()))
$$;
create function pg_temp.launch_sql(intent text, key integer, n integer, predecessor uuid default null) returns text
language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, %L, %L, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, %s, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(20), pg_temp.f(1), pg_temp.f(key), intent, predecessor, pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(), pg_temp.snapshot(), pg_temp.jobs(n), pg_temp.f(40), pg_temp.prep_revision(), array[pg_temp.f(100)])
$$;
-- Each item's current answers on the plan, as committed now (its greatest reading).
create function pg_temp.targets(items integer[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(i), 'answers', coalesce((select jsonb_agg(a.id) from public.takeoff_item_answers a
      where a.item_id = pg_temp.f(i) and a.reading_revision = (select max(b.reading_revision) from public.takeoff_item_answers b
        where b.item_id = a.item_id and b.plan_logical_id = a.plan_logical_id)), '[]'::jsonb)) order by pg_temp.f(i))
  from unnest(items) i
$$;
-- The server's statement: a new measure of these items on the plan, re-reading its latest analysis.
create function pg_temp.remeasure_sql(key integer, items integer[], n integer, predecessor uuid, targets jsonb default null,
  p_revision integer default null)
returns text language sql stable as $$
  select format($remeasure$select outcome || ':' || coalesce(pg_catalog.array_to_string(stale, ','), '')
    from public.launch_takeoff_item_remeasure(%L, %L, %L, %L, %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb, %L, %s, %L::uuid[],
      %L::jsonb)$remeasure$,
    pg_temp.tenant(), pg_temp.f(20), pg_temp.f(1), pg_temp.f(key), predecessor, pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(items, p_revision), pg_temp.snapshot(), pg_temp.jobs(n), pg_temp.f(40), pg_temp.prep_revision(),
    array[pg_temp.f(100)], coalesce(targets, pg_temp.targets(items)))
$$;
create function pg_temp.claim_sql(n integer, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(n), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- A publication of a job's answers: each item named measured (2 on page 2, one row of the result), or not found.
create function pg_temp.publish_sql(n integer, token integer, measured integer[], absent integer[] default '{}') returns text
language sql stable as $$
  select format($publish$select result_id::text || ':' || replayed::text from public.publish_takeoff_item_answers(%L, %L,
    '2026-11-22T09:00:00Z', 'modele-fictif', 'takeoff-c-postes-v1',
    '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], %L::jsonb, '[]'::jsonb, %L::jsonb,
    %L::jsonb)$publish$,
    pg_temp.job(n), pg_temp.f(token),
    (select coalesce(jsonb_agg(answer), '[]'::jsonb) from (
      select jsonb_build_object('item_id', pg_temp.f(i), 'outcome', 'measured', 'reasons', '[]'::jsonb,
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 2, 'unit', 'u'),
        'observations', jsonb_build_array(jsonb_build_object('page', 2, 'evidence', 'Symboles fictifs', 'method', 'symbol_count',
          'confidence', 0.9, 'quantity', 2, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(8000 + 10 * n + i - 300)))) as answer from unnest(measured) i
      union all
      select jsonb_build_object('item_id', pg_temp.f(i), 'outcome', 'not_found',
        'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
          'chunk_id', 'f1-b1')),
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb) from unnest(absent) i) answers),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5),
    (select coalesce(jsonb_agg(jsonb_build_object('id', pg_temp.f(8000 + 10 * n + i - 300), 'designation', 'Poste (fictif)',
      'quantity', 2, 'unit', 'u', 'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', 'plan-1.pdf',
      'source_page', 2, 'metadata', '{}'::jsonb)), '[]'::jsonb) from unnest(measured) i))
$$;
create function pg_temp.requests() returns integer language sql stable as $$
  select count(*)::integer from public.takeoff_launch_requests where project_id = pg_temp.f(20)
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values (%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L);
  commit;$prep$, pg_temp.tenant(), pg_temp.f(20), pg_temp.snapshot() -> 'preparation', pg_temp.snapshot(), pg_temp.f(1), pg_temp.f(1)))),
  'COMMIT', 'the affaire''s preparation is confirmed');
-- The first reading (job 1001): the first item measured, the second not found.
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql('initial', 500, 1)) as x(outcome text)), 'admitted',
  'the affaire reads its plan against its list');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(1, 901)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(1, 901, array[300], array[301]))
  as x(answer text)), 'false', 'and publishes its answers');

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
create function pg_temp.receipts(key integer) returns integer language sql stable as $$
  select count(*)::integer from private.takeoff_launch_commands where intent_key = pg_temp.f(key)
$$;
create function pg_temp.waits_for(p_waiting text, p_holding text) returns boolean language plpgsql as $$
declare
  waiting integer := (select pid from race_pids where label = p_waiting);
  holding integer := (select pid from race_pids where label = p_holding);
begin
  for attempt in 1..400 loop
    if holding = any(pg_catalog.pg_blocking_pids(waiting)) then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
create function pg_temp.answered(p_session text) returns boolean language plpgsql as $$
begin
  for attempt in 1..400 loop
    if extensions.dblink_is_busy(p_session) = 0 then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
create function pg_temp.hold_review_key_sql() returns text language sql stable as $$
  select format($hold$select pg_advisory_xact_lock(hashtextextended(%L, 0))::text$hold$, 'takeoff-item-review:' || pg_temp.f(20))
$$;

-- 1. Two confirmations at once: the first tab's is admitted, not yet committed; the second tab's waits, then answers that
--    an analysis of the affaire runs; the first one's answer lost and sent again is replayed.
create temp table first_targets as select pg_temp.targets(array[300]) as targets;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the first tab confirms a new measure of the first item');
select is((select x.answer from extensions.dblink('race_a', pg_temp.remeasure_sql(700, array[300], 2, pg_temp.job(1)))
  as x(answer text)), 'admitted:', 'admitted, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(701, array[300], 3, pg_temp.job(1))), 1,
  'the second tab confirms the same selection meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the first');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select x.answer from extensions.dblink_get_result('race_b') as x(answer text)), 'already_running:',
  'an analysis of the affaire runs: the selection is kept for later');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') as x(answer text)), 0, 'and is done');
select is((select x.answer from extensions.dblink('race_b', pg_temp.remeasure_sql(700, array[300], 2, pg_temp.job(1),
  (select targets from first_targets))) as x(answer text)), 'replayed:', 'the first one''s answer sent again is replayed');
select is(pg_temp.requests(), 2, 'one new request admitted, once');
-- Its analysis reads the first item and publishes.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(2, 902)) as x(claimed bigint)), 1::bigint,
  'the new measure is read');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(2, 902, array[300]))
  as x(answer text)), 'false', 'and publishes the first item''s answer');

-- 2. A confirmation while a bulk review of the same item commits: the review holds the affaire's review key; the
--    confirmation waits, then compares what is committed (a review changes no reading) and is admitted.
select is(extensions.dblink_exec('race_a', 'set role authenticated'), 'SET', 'the first tab is now the member');
select is((select claims.sub from extensions.dblink('race_a', format($claims$select set_config('request.jwt.claims', %L, false),
    set_config('request.jwt.claim.sub', %L, false)$claims$, jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(1))::text,
    pg_temp.f(1)::text)) as claims(claims text, sub text)), pg_temp.f(1)::text, 'signed in');
create temp table review_command as select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(600), 'gesture', 'set_aside',
  'scope', '{"kind":"affaire"}'::jsonb, 'reason', 'duplicate',
  'targets', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'entry_revision', 0,
    'answers', (select jsonb_agg(jsonb_build_object('answer_id', a.answer_id, 'decision_revision', 0, 'entry_revision', 0))
      from jsonb_array_elements_text(pg_temp.targets(array[300]) #> '{0,answers}') a(answer_id)))),
  'apply', jsonb_build_array(pg_temp.f(300)), 'skipped', '[]'::jsonb) as command;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the member sets the first item aside');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', format(
    $review$select public.review_takeoff_items(%L, %L, %L::jsonb)::text$review$, pg_temp.tenant(), pg_temp.f(20),
    (select command from review_command))) as x(outcome text)), 'applied', 'applied, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(710, array[300], 4, pg_temp.job(2))), 1,
  'a new measure of the same item is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'it waits for the review');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the review commits');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select x.answer from extensions.dblink_get_result('race_b') as x(answer text)), 'admitted:',
  'admitted: the review changed no reading');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') as x(answer text)), 0, 'and is done');
select is((select d.kind from public.takeoff_item_answer_decisions d where d.answer_id::text = (select targets #>> '{0,answers,0}'
  from (select pg_temp.targets(array[300]) as targets) t)), 'set_aside', 'the review''s decision stands');
select is(extensions.dblink_exec('race_a', 'reset role'), 'RESET', 'the first tab is the server again');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(4, 904)) as x(claimed bigint)), 1::bigint,
  'the new measure is read');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(4, 904, array[300]))
  as x(answer text)), 'false', 'and publishes');

-- 3. A confirmation while a new reading publishes a replacement of the selected reading: it waits behind the affaire's
--    review key, then compares what is current, and answers stale.
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql('reread_plans', 501, 5, pg_temp.job(4)))
  as x(outcome text)), 'admitted', 'the plan is read again');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(5, 905)) as x(claimed bigint)), 1::bigint,
  'and claimed');
create temp table seen_before as select pg_temp.targets(array[301]) as targets;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a session holds the affaire''s review key');
select is((select x.held from extensions.dblink('race_a', pg_temp.hold_review_key_sql()) as x(held text)), '', 'held');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(720, array[301], 6, pg_temp.job(5),
  (select targets from seen_before))), 1, 'a new measure of the second item is confirmed on what was read before');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'it waits for the review key');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(5, 905, array[300, 301]))
  as x(answer text)), 'false', 'meanwhile the new reading publishes a replacement of the second item''s reading');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the key is released');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select x.answer from extensions.dblink_get_result('race_b') as x(answer text)), 'stale:' || pg_temp.f(301)::text,
  'stale: the reading it was confirmed on is no longer the current one');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') as x(answer text)), 0, 'and is done');
select is(pg_temp.requests(), 4, 'nothing admitted');

-- 4. A confirmation compared while a new reading still runs, whose publication commits after the comparison and before
--    the launch looks for a running analysis: compared again under the launch's locks, stale.
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql('reread_plans', 502, 8, pg_temp.job(5)))
  as x(outcome text)), 'admitted', 'the plan is read once more');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(8, 908)) as x(claimed bigint)), 1::bigint,
  'and claimed');
create temp table seen_running as select pg_temp.targets(array[300]) as targets;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a session holds the affaire''s launch key');
select is((select x.held from extensions.dblink('race_a', format('select pg_advisory_xact_lock(hashtextextended(%L, 0))::text',
  'takeoff-launch:' || pg_temp.f(20))) as x(held text)), '', 'held');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(740, array[300], 9, pg_temp.job(5),
  (select targets from seen_running))), 1, 'a new measure of the first item, re-reading the older analysis, is confirmed');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'compared, it waits for the launch''s key');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(8, 908, array[300], array[301]))
  as x(answer text)), 'false', 'meanwhile the running reading publishes its answers and ends');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the key is released');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select x.answer from extensions.dblink_get_result('race_b') as x(answer text)), 'stale:' || pg_temp.f(300)::text,
  'stale: the reading it compared was replaced before the launch could see the analysis running');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') as x(answer text)), 0, 'and is done');
select is(pg_temp.requests(), 5, 'nothing admitted');
select is((select count(*)::integer from public.takeoff_jobs where id = pg_temp.job(9)), 0, 'not even its analysis');
select is(pg_temp.receipts(740), 0, 'nor a receipt under its key');

-- 5. A list edit while the confirmation waits at the seal: a list writer holds the list key and records a revision
--    without the second item; the confirmation of that item, compared before, answers stale naming it, as the same
--    confirmation started after the edit does. Nothing is written: no request, no receipt.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a list writer begins');
select is((select x.held from extensions.dblink('race_a', format('select count(*) from private.lock_takeoff_item_list(%L)', pg_temp.f(20)))
  as x(held bigint)), 1::bigint, 'and holds the list key');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(730, array[301], 10, pg_temp.job(8))), 1,
  'a new measure of the second item is confirmed on the list''s revision 1');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'compared, it waits for the list key at the seal');
select is(extensions.dblink_exec('race_a', format($revision$
  set local session_replication_role = replica;
  insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
    gesture_sha256, intent_key, created_by)
  select %1$L, tenant_id, project_id, 2, 'proposal', sources, 1, repeat('2', 64), repeat('b', 64), %2$L, created_by
  from public.takeoff_list_revisions where id = %3$L;
  insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
    expected_unit, origin_kind, origin)
  select %1$L, tenant_id, project_id, item_id, position, source_key, label, expected_unit, origin_kind, origin
  from public.takeoff_list_revision_entries where revision_id = %3$L and item_id = %4$L;
  commit;$revision$, pg_temp.f(401), pg_temp.f(411), pg_temp.f(400), pg_temp.f(300))), 'COMMIT',
  'the writer records revision 2 without the second item, and commits');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'stale:' || pg_temp.f(301)::text,
  'stale, naming the item the list removed');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.requests(), 5, 'nothing admitted');
select is(pg_temp.receipts(730), 0, 'no receipt under its key');
select is((select x.answer from extensions.dblink('race_b', pg_temp.remeasure_sql(731, array[301], 10, pg_temp.job(8), null, 400))
  as x(answer text)), 'stale:' || pg_temp.f(301)::text, 'the same confirmation started after the edit answers the same');
select is(pg_temp.receipts(731), 0, 'and records nothing either');

-- 6. A preparation edit in flight when a confirmation starts (on the list's latest revision, the first item): the
--    confirmation waits for the preparation's row, then reads the edit committed and is refused.
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'a member edits the preparation');
select is(extensions.dblink_exec('race_setup', format($withdraw$update public.takeoff_preparations set revision = 2,
    draft = jsonb_set(draft, '{sources,0,active}', 'false'), confirmed_snapshot = null, confirmed_at = null, confirmed_by = null
  where project_id = %L$withdraw$, pg_temp.f(20))), 'UPDATE 1', 'the plan withdrawn, the confirmation undone, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(732, array[300], 10, pg_temp.job(8))), 1,
  'a new measure of the first item is confirmed on the preparation as it was');
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'it waits for the preparation''s edit');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the edit commits');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'with an error');
select matches(extensions.dblink_error_message('race_b'), 'TAKEOFF_LAUNCH_SEAL_INVALID', 'refused: the plan is no longer confirmed');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.requests(), 5, 'nothing admitted');
select is(pg_temp.receipts(732), 0, 'no receipt');

-- 7. A preparation edit once the confirmation compared it: the preparation confirmed again (revision 3); the
--    confirmation compares it and waits for the list key at the seal; the edit that withdraws the plan then waits for the
--    admission, which reads the preparation as compared; the edit commits after it.
select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  update public.takeoff_preparations set revision = 3, draft = %L::jsonb, confirmed_snapshot = %L::jsonb, confirmed_at = now(),
    confirmed_by = %L where project_id = %L;
  commit;$prep$, pg_temp.snapshot(3) -> 'preparation', pg_temp.snapshot(3), pg_temp.f(1), pg_temp.f(20)))), 'COMMIT',
  'the preparation is confirmed again');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a list writer begins');
select is((select x.held from extensions.dblink('race_a', format('select count(*) from private.lock_takeoff_item_list(%L)', pg_temp.f(20)))
  as x(held bigint)), 1::bigint, 'and holds the list key');
select is(extensions.dblink_send_query('race_b', pg_temp.remeasure_sql(733, array[300], 11, pg_temp.job(8))), 1,
  'a new measure of the first item is confirmed on revision 3');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'compared, it waits for the list key at the seal');
select is(extensions.dblink_send_query('race_setup', format($withdraw$update public.takeoff_preparations set revision = 4,
    draft = jsonb_set(draft, '{sources,0,active}', 'false'), confirmed_snapshot = null, confirmed_at = null, confirmed_by = null
  where project_id = %L$withdraw$, pg_temp.f(20))), 1, 'meanwhile a member withdraws the plan from the preparation');
select ok(pg_temp.waits_for('race_setup', 'race_b'), 'the edit waits for the admission');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the list key is released');
select ok(pg_temp.answered('race_b'), 'the confirmation answers');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'admitted:',
  'admitted on the preparation it compared');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select ok(pg_temp.answered('race_setup'), 'then the edit ends');
select is((select x.status from extensions.dblink_get_result('race_setup', false) as x(status text)), 'UPDATE 1', 'committed after it');
select is((select count(*)::integer from extensions.dblink_get_result('race_setup', false) as x(status text)), 0, 'and is done');
select is((select j.preparation_snapshot #> '{preparation,sources,0,active}' from public.takeoff_jobs j where j.id = pg_temp.job(11)),
  'true'::jsonb, 'its analysis reads the plan the preparation confirmed when it was compared');
select is((select j.preparation_snapshot ->> 'preparation_revision' from public.takeoff_jobs j where j.id = pg_temp.job(11)), '3',
  'at that revision');
select is(pg_temp.requests(), 6, 'one request admitted');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5800000-0000-4000-8000-000000000001'
  loop
  delete from private.takeoff_launch_usage u using public.takeoff_launch_requests r where r.id = u.request_id and r.tenant_id = target;
  for entry in
    select columns.table_schema, columns.table_name
    from information_schema.columns as columns
    join information_schema.tables as tables
      on tables.table_schema = columns.table_schema and tables.table_name = columns.table_name
    where columns.table_schema in ('public', 'private') and columns.column_name = 'tenant_id'
      and tables.table_type = 'BASE TABLE' and not (columns.table_schema = 'public' and columns.table_name = 'tenants')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  delete from public.tenants where id = target;
  end loop;
end
$clean$;
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5800000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5800000-0000-4000-8000-000000000099';
delete from private.takeoff_item_list_order_activation;
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5800000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5800000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from private.takeoff_item_list_order_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
