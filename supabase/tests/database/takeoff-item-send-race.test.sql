-- Lot 4, migration C (…_takeoff_item_send_writer.sql): the send of a plan by item across sessions. Each case holds the
-- first transaction open at a named point, proves the second session waits for it (its blocking process), lets the
-- first one go, then reads what the second one did.
-- 1. A bulk review of the affaire holds it (an item set aside) while the plan is confirmed: the send waits, then is
--    asked again (the answers it showed changed); nothing written. Never interleaved.
-- 1b. The member made a viewer while the send waits for the affaire: the right is read after the wait, nothing written.
-- 2. The same request sent twice at once (a lost answer sent again): the second waits, then answers the first one's
--    receipt, replayed; one version, one receipt.
-- 3. A targeted save of a contributing row holds the job's rules while the plan is confirmed: the send waits for the
--    job, then judges the job as committed and is asked again; nothing written.
-- 4. An import creates V1 (it holds the affaire) while the plan's first draft is confirmed: the send waits for the
--    affaire, then is asked again on the real destination; one V1, the import's.
-- 5. The editor saves the destination (its key and the version) while the plan is confirmed on it: the send waits for the
--    editor's key, then is asked again; nothing written.
-- 6. Two tabs confirm the same job at once (two requests) while a bulk review of the affaire is sent: the second
--    confirmation waits for the affaire and is told the job is sent; the review waits for the affaire's review key and
--    finds the plan closed; one receipt, one target, the job applied once.
-- 7. The actor's tenant suspended while the send waits for the affaire: refused after the wait, before any answer.
-- 8. The member gone to another tenant (their default) while the send waits: refused after the wait.
-- 9. A second reading's send while the member's lease of the draft ends during the wait: the lease is read on the clock
--    after the wait (DRAFT_LOCK_REQUIRED), the estimate unchanged.
-- 10. A copy of a draft fed by item (a new version) while a send into it holds the affaire: the copy waits, then carries
--     what the send wrote (…_takeoff_item_send_copy.sql).
-- 11. A copy of that copy while a send into the copy is confirmed: the send waits, then writes into the first copy
--     only; the second copy holds the first one as it was.
-- The confirmation is the server's (the service role, the acting member its parameter); the tabs' reviews are the member's.
-- The two first creations of a draft are cases 2 (one job, twice) and 4 (the import and the send). Isolation justified:
-- these interleavings exist only across sessions, which no journey drives deterministically. All values are fictional.
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
-- race_setup writes and commits the fixtures; race_a and race_b are two tabs (two requests) of the same member.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b'), ('race_c')) as session(name);

-- Affaires 20 and 21, one plan each (100 + n, read on its pages 2 and 7), each with a list of two items (300 + 10 n + k)
-- in its revision 400 + n.
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5800000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'item-send-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5800000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5800000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Affaire envoyée en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 1) as n
where m.user_id = 'd5800000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5800000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5800000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 1) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5800000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5800000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5800000-0000-4000-8000-000000000001' from generate_series(0, 1) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5800000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 1) as n join public.estimate_projects p on p.id = ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5800000-0000-4000-8000-000000000' || (100 + n))::uuid, s.tenant_id, s.id, 'plan-1.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5800000-0000-4000-8000-000000000' || (100 + n))::uuid, 'plan-1.pdf'), 'application/pdf', 8, 9
from generate_series(0, 1) as n join public.plan_sets s on s.id = ('d5800000-0000-4000-8000-0000000000' || (40 + n))::uuid;
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select ('d5800000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, p.tenant_id, p.id, 'manual', 1, p.user_id
from generate_series(0, 1) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
select ('d5800000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id, 1, 'item_added', '{}', 2, repeat('1', 64),
  repeat('a', 64), ('d5800000-0000-4000-8000-000000000' || (410 + n))::uuid, p.user_id
from generate_series(0, 1) as n join public.estimate_projects p on p.id = ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select ('d5800000-0000-4000-8000-000000000' || (400 + n))::uuid, p.tenant_id, p.id,
  ('d5800000-0000-4000-8000-000000000' || (300 + 10 * n + k))::uuid, k, 'manual:poste-' || k, 'Poste ' || k || ' (fictif)', 'u',
  'manual', '{"kind":"manual"}'
from generate_series(0, 1) as n cross join generate_series(0, 1) as k
join public.estimate_projects p on p.id = ('d5800000-0000-4000-8000-0000000000' || (20 + n))::uuid;
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'two affaires of one plan and a list of two items, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.job(project integer) returns uuid language sql immutable as $$ select pg_temp.f(1000 + project) $$;
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot(project integer, pages_ integer[] default array[2,7], prep_revision integer default 1) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', prep_revision, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', to_jsonb(pages_)))
        from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20))))
$$;
create function pg_temp.launch_sql(project integer, pages_ integer[] default array[2,7], prep_revision integer default 1) returns text language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, %L, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
        'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
        from public.takeoff_list_revisions r where r.id = pg_temp.f(400 + project - 20)),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', jsonb_build_array(jsonb_build_object('key', 'plan:' || pg_temp.f(100 + project - 20), 'ordinal', 1,
        'plans', jsonb_build_array(pg_temp.f(100 + project - 20)), 'pages', to_jsonb(pages_), 'page_count', 9, 'vector_pages', 0,
        'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(100 + project - 20),
        'plan_file_id', pg_temp.f(100 + project - 20), 'name', 'plan-1.pdf', 'logical_id', pg_temp.f(100 + project - 20),
        'generation', null, 'content_sha256', pg_temp.digest(pg_temp.f(100 + project - 20)), 'pages', to_jsonb(pages_),
        'page_count', 9)),
      'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(project,pages_,prep_revision),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(project), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || pg_temp.f(100 + project - 20), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(project + 20), prep_revision, array[pg_temp.f(100 + project - 20)])
$$;
create function pg_temp.claim_sql(project integer, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(project), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- The relaunch of an affaire's plan (a second reading, its job 1100 + n) and its publication (its row 850 + n).
create function pg_temp.relaunch_sql(project integer, pages_ integer[] default array[2,7], prep_revision integer default 1) returns text language sql stable as $$
  select replace(replace(pg_temp.launch_sql(project,pages_,prep_revision), format('%L, ''initial'', null', pg_temp.f(500 + project)),
    format('%L, ''reread_plans'', %L', pg_temp.f(600 + project), pg_temp.job(project))),
    pg_temp.job(project)::text || '", "plan_set_id"', pg_temp.f(1100 + project)::text || '", "plan_set_id"')
$$;
-- The publication of an affaire's unit: its first item measured (2 on page 2, row 800 + n of the result), its second not
-- found.
create function pg_temp.publish_sql(project integer, token integer) returns text language sql stable as $$
  select format($publish$select result_id::text || ':' || replayed::text from public.publish_takeoff_item_answers(%L, %L,
    '2026-11-22T09:00:00Z', 'modele-fictif', 'takeoff-c-postes-v1',
    '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], %L::jsonb, '[]'::jsonb, %L::jsonb,
    %L::jsonb)$publish$,
    pg_temp.job(project), pg_temp.f(token),
    jsonb_build_array(
      jsonb_build_object('item_id', pg_temp.f(300 + 10 * (project - 20)), 'outcome', 'measured', 'reasons', '[]'::jsonb,
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', 2, 'unit', 'u'),
        'observations', jsonb_build_array(jsonb_build_object('page', 2, 'evidence', 'Symboles fictifs', 'method', 'symbol_count',
          'confidence', 0.9, 'quantity', 2, 'unit', 'u', 'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1',
          'takeoff_item_id', pg_temp.f(800 + project)))),
      jsonb_build_object('item_id', pg_temp.f(301 + 10 * (project - 20)), 'outcome', 'not_found',
        'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
          'chunk_id', 'f1-b1')),
        'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'observations', '[]'::jsonb)),
    jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb, 'provider_meta', '{}'::jsonb,
      'token_count', 10, 'cost_cents', 0, 'duration_ms', 5),
    jsonb_build_array(jsonb_build_object('id', pg_temp.f(800 + project), 'designation', 'Poste 0 (fictif)', 'quantity', 2,
      'unit', 'u', 'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', 'plan-1.pdf', 'source_page', 2,
      'metadata', '{}'::jsonb)))
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values %s;
  commit;$prep$, string_agg(format('(%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L)', pg_temp.tenant(), pg_temp.f(project),
    pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), pg_temp.f(1), pg_temp.f(1)), ', '))
  from (values (20), (21)) as affaire(project))), 'COMMIT', 'each affaire''s preparation is confirmed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('affaire %s reads its plan against its list', project)) from (values (20), (21)) as affaire(project);
-- The Mac's one slot reads one plan at a time: each plan is read and published before the next.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(20, 920)) as x(claimed bigint)), 1::bigint,
  'the worker reads the plan of affaire 20');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(20, 920)) as x(answer text)),
  'false', 'and publishes its answers');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(21, 921)) as x(claimed bigint)), 1::bigint,
  'then the plan of affaire 21');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.publish_sql(21, 921)) as x(answer text)),
  'false', 'and publishes its answers');
-- The server evaluated the rules of the rows (none fails), as it does after a reading.
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id in (%L, %L)$rules$, pg_temp.job(20), pg_temp.job(21))),
  'UPDATE 2', 'the rules of both rows are evaluated');

-- The member in the tabs (race_a, race_c); race_b is the server's confirmation of a member's request (the service role,
-- no member's session: the acting member is the writer's parameter).
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the member', session.name))
from (values ('race_a'), ('race_c')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, format($claims$select set_config('request.jwt.claims', %L, false),
    set_config('request.jwt.claim.sub', %L, false)$claims$, jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(1))::text,
    pg_temp.f(1)::text)) as claims(claims text, sub text)), pg_temp.f(1)::text, format('%s is signed in', session.name))
from (values ('race_a'), ('race_c')) as session(name);
select is(extensions.dblink_exec('race_b', 'set role service_role'), 'SET', 'race_b acts as the server');
select is((select claims.sub from extensions.dblink('race_b', $claims$select set_config('request.jwt.claims', '{"role":"service_role"}',
    false), set_config('request.jwt.claim.sub', '', false)$claims$) as claims(claims text, sub text)), '',
  'race_b carries no member''s session');

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_setup'), ('race_a'), ('race_b'), ('race_c')) as session(name);
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

create function pg_temp.target(item integer) returns jsonb language sql stable as $$
  select jsonb_build_object('item_id', pg_temp.f(item),
    'entry_revision', coalesce((select e.revision from public.takeoff_item_entries e where e.item_id = pg_temp.f(item)
      and e.plan_logical_id is null), 0),
    'answers', coalesce((select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', coalesce(d.revision, 0),
        'entry_revision', coalesce(pe.revision, 0), 'marks_revision', private.takeoff_count_marks_revision(a.id)))
      from public.takeoff_item_answers a left join public.takeoff_item_answer_decisions d on d.answer_id = a.id
      left join public.takeoff_item_entries pe on pe.item_id = a.item_id and pe.plan_logical_id = a.plan_logical_id
      where a.item_id = pg_temp.f(item)), '[]'::jsonb))
$$;
create function pg_temp.cmd(gesture text, key integer, items integer[], extra jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(key), 'gesture', gesture,
    'scope', '{"kind":"affaire"}'::jsonb,
    'targets', (select jsonb_agg(pg_temp.target(i) order by i) from unnest(items) i),
    'apply', (select jsonb_agg(pg_temp.f(i) order by i) from unnest(items) i),
    'skipped', '[]'::jsonb) || extra
$$;
create function pg_temp.review_sql(project integer, command jsonb) returns text language sql stable as $$
  select format($review$select public.review_takeoff_items(%L, %L, %L::jsonb)::text$review$, pg_temp.tenant(), pg_temp.f(project),
    command)
$$;
create function pg_temp.review_events(project integer) returns integer language sql stable as $$
  select count(*)::integer from public.takeoff_item_review_events where project_id = pg_temp.f(project)
$$;


-- The plans, built as the server builds them (src/lib/takeoff/item-send-plan.ts) from what is committed, by the owner.
create temp table plans (name text primary key, body jsonb not null, payload jsonb);
create function pg_temp.plan_file(p_project integer) returns uuid language sql immutable as $$ select pg_temp.f(100 + p_project - 20) $$;
create function pg_temp.document(p_project integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('plan_file_id', pg_temp.plan_file(p_project), 'content_hash', pg_temp.digest(pg_temp.plan_file(p_project)),
    'logical_document_id', null, 'file_name', 'plan-1.pdf')
$$;
create function pg_temp.parts(p_project integer, p_item integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('answer_id', s.answer_id, 'answer_revision', s.answer_revision, 'kind', s.kind,
      'observation_ids', case when s.observation_id is null then '[]'::jsonb else jsonb_build_array(s.observation_id) end,
      'quantity', s.quantity, 'unit', s.unit, 'pages', to_jsonb(s.pages),
      'identity', jsonb_build_object('unit', (private.normalize_unit(s.unit)).unit_code, 'basis', null, 'network', null,
        'material', null, 'diameter', null)) order by s.observation_id), '[]'::jsonb)
  from private.takeoff_item_send_job_parts(pg_temp.tenant(), pg_temp.f(p_project), pg_temp.job(p_project), array[2, 7]) as s
  where s.item_id = pg_temp.f(p_item)
$$;
create function pg_temp.new_line(p_project integer, p_item integer, p_quantity numeric) returns jsonb language sql stable as $$
  select jsonb_build_object('key', pg_temp.f(p_item) || '|together', 'item_id', pg_temp.f(p_item), 'compartment_key', 'together',
    'line', jsonb_build_object('kind', 'new_line', 'section_key', 'list:', 'section_id', null, 'title', 'Poste 0 (fictif)',
      'unit_code', 'u', 'order', 1),
    'unit_code', 'u', 'quantity_after', p_quantity, 'quantity', jsonb_build_object('kept_entry', false), 'rule', null,
    'contributions', pg_temp.parts(p_project, p_item), 'replaces', '[]'::jsonb)
$$;
create function pg_temp.payload(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(p_version), 'title', null, 'date_devis', '2026-11-22', 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1,
    'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3,
    'contractor_role', 'principal', 'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0,
    'commercial_rounding_cents', 0, 'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)
$$;
create function pg_temp.first_draft_settings(p_project integer, p_payload jsonb) returns jsonb language plpgsql as $$
declare
  settings jsonb;
begin
  begin
    perform public.persist_estimate_creation_atomic(pg_temp.tenant(), pg_temp.f(1), pg_temp.f(p_project), null, p_payload,
      '[]'::jsonb, null);
    select jsonb_build_object('title', v.title, 'validite_jours', v.validite_jours, 'margin_multiplier', v.margin_multiplier,
      'margin_mode', v.margin_mode, 'currency', v.currency, 'margin_bp', v.margin_bp, 'discount_bp', v.discount_bp,
      'discount_amount_cents', v.discount_amount_cents, 'discount_mode', v.discount_mode, 'discount_steps', v.discount_steps,
      'global_coefficient', v.global_coefficient, 'tax_rate_bp', v.tax_rate_bp, 'rounding_mode', v.rounding_mode,
      'rounding_step_cents', v.rounding_step_cents, 'max_section_depth', v.max_section_depth,
      'calc_engine_version', v.calc_engine_version, 'contractor_role', v.contractor_role,
      'sale_coefficient_fo', v.sale_coefficient_fo, 'sale_coefficient_mo', v.sale_coefficient_mo)
      into settings from public.estimate_versions v where v.id = (p_payload ->> 'id')::uuid;
    raise exception 'ITEM_SEND_TEST_PROBE';
  exception when others then
    if sqlerrm <> 'ITEM_SEND_TEST_PROBE' then
      raise;
    end if;
  end;
  return settings;
end;
$$;
create function pg_temp.plan(p_project integer, p_version uuid, p_item integer, p_quantity numeric, p_payload jsonb default null)
returns jsonb language sql as $$
  select jsonb_build_object('format', 'takeoff_item_send', 'version', 1, 'job_id', pg_temp.job(p_project),
    'plan_key', pg_temp.plan_file(p_project), 'list', jsonb_build_object('revision_id', pg_temp.f(400 + p_project - 20), 'revision', 1),
    'destination', case when p_version is null then jsonb_build_object('kind', 'first_draft')
      else jsonb_build_object('kind', 'existing_draft', 'version_id', p_version) end,
    'engine', 3, 'breakdown', 'together',
    'sections', '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb,
    'targets', jsonb_build_array(pg_temp.new_line(p_project, p_item, p_quantity)),
    'page_contributions', jsonb_build_array(jsonb_build_object('page', 2, 'item_ids', jsonb_build_array(pg_temp.f(p_item)),
      'target_keys', jsonb_build_array(pg_temp.f(p_item) || '|together'),
      'observation_ids', (select coalesce(jsonb_agg(o.value), '[]'::jsonb) from jsonb_array_elements(pg_temp.parts(p_project, p_item)) c(value)
        cross join lateral jsonb_array_elements(c.value -> 'observation_ids') o(value)))),
    'page_decisions', '[]'::jsonb, 'left_out', '[]'::jsonb, 'parts_not_sent', '[]'::jsonb,
    'dependencies', jsonb_build_object(
      'answers', (with pairs as (select p.* from private.takeoff_item_table_pairs(pg_temp.tenant(), pg_temp.f(p_project),
          pg_temp.plan_file(p_project)) as p)
        select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'answer_id', a.id, 'revision', a.content_sha256,
            'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
            'entry_revision', null) order by a.item_id), '[]'::jsonb)
        from public.takeoff_item_answers a left join pairs pair on pair.answer_id = a.id where a.job_id = pg_temp.job(p_project)),
      'affaire_entries', '[]'::jsonb, 'rules', '[]'::jsonb, 'location_generation', null, 'plan_pages', '[2, 7]'::jsonb,
      'earlier_targets', case when p_version is null then '[]'::jsonb
        else private.takeoff_item_send_earlier_targets(pg_temp.tenant(), p_version) end,
      'lines', '[]'::jsonb,
      'pages_in_estimate', case when p_version is null then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object(
          'page', h.value -> 'page', 'earlier_job_ids', h.value -> 'earlier_job_ids', 'estimate_item_ids', h.value -> 'estimate_item_ids')),
          '[]'::jsonb) from jsonb_array_elements(private.takeoff_item_send_held_pages(pg_temp.tenant(), p_version,
          pg_temp.job(p_project), pg_temp.document(p_project), array[2, 7])) h(value)) end,
      'stamps', jsonb_build_object('job', public.takeoff_rule_job_stamp(pg_temp.tenant(), pg_temp.f(p_project), pg_temp.job(p_project)),
        'peers', case when p_version is not null then public.takeoff_send_peers_stamp(pg_temp.tenant(), p_version) end,
        'context', (select jsonb_build_object('peers', s.stamps ->> 'peers', 'locations', s.stamps ->> 'locations')
          from (select private.takeoff_send_context_stamps(private.takeoff_send_context(pg_temp.tenant(), pg_temp.f(p_project),
            pg_temp.job(p_project), p_version)) as stamps) s),
        'dpgf', '[]'::jsonb,
        'first_draft_settings', case when p_version is null then pg_temp.first_draft_settings(p_project, p_payload) end,
        'destination', (select jsonb_build_object('version_id', v.id, 'status', v.status, 'updated_at', v.updated_at)
          from public.estimate_versions v where v.id = p_version),
        'mapping', public.takeoff_mapping_rules_stamp(pg_temp.tenant())),
      'resolutions', '[]'::jsonb))
$$;
-- The server's call for the member (the service role; a first draft's payload is the server's canonical creation).
create function pg_temp.send_sql(p_request integer, p_plan text) returns text language sql stable as $$
  select format($send$select public.send_takeoff_item_plan(%L, %L, false, %L::jsonb)::text$send$, pg_temp.tenant(), pg_temp.f(1),
    jsonb_build_object('request_id', pg_temp.f(p_request), 'plan', p.body)
      || case when p.payload is null then '{}'::jsonb else jsonb_build_object('version_payload', p.payload) end)
  from plans p where p.name = p_plan
$$;
-- A tab's transaction turned into the server's (its role and its session, for that transaction only).
create function pg_temp.as_server_sql() returns text language sql immutable as $$
  select $server$set local role service_role; set local request.jwt.claims = '{"role":"service_role"}';
    set local request.jwt.claim.sub = ''$server$
$$;
create function pg_temp.written(p_project integer) returns text language sql stable as $$
  select concat_ws('/', (select count(*) from public.estimate_versions v where v.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_receipts r where r.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_targets t where t.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_parts p where p.project_id = pg_temp.f(p_project)),
    (select status::text from public.takeoff_jobs j where j.id = pg_temp.job(p_project)))
$$;

-- A total's evidence pages cannot certify its coverage. A later full reading
-- may replace it in one piece. Earlier measured/entered parts keep the page rule.
select results_eq($$select old_kind,new_kind,policy from (values
    ('verified_count','measured',array[2],array[7],9,false),
    ('verified_count','entered',array[2],array[2],9,false),
    ('verified_count','verified_count',array[2],array[2,7],null::integer,false),
    ('verified_count','measured',array[2],array[1,2],2,true),
    ('verified_count','entered',array[2],array[1,2],2,true),
    ('verified_count','verified_count',array[2],array[1,2],2,true),
    ('measured','verified_count',array[2],array[7],9,false),
    ('entered','verified_count',array[2],array[7],9,false),
    ('measured','measured',array[2],array[7],9,false),
    ('entered','measured',array[2],array[7],9,false)
  ) with_input(old_kind,new_kind,old_pages,checked,page_count,expected_full)
  cross join lateral private.takeoff_item_send_count_scope(old_kind,old_pages,new_kind = 'verified_count',checked,
    private.takeoff_item_send_whole_plan(page_count,checked,checked)) policy$$,
  $$values ('verified_count'::text,'measured'::text,'refuse'::text),('verified_count','entered','refuse'),
    ('verified_count','verified_count','refuse'),('verified_count','measured','replace'),
    ('verified_count','entered','replace'),('verified_count','verified_count','replace'),
    ('measured','verified_count','refuse'),('entered','verified_count','refuse'),
    ('measured','measured','page_rule'),('entered','measured','page_rule')$$,
  'partial and unknown coverage refuse a verified total, all three full-reading sources replace it whole');
select is(private.takeoff_item_send_whole_plan(2,array[1],array[1,2]),false,
  'a page replacement choice cannot certify a page missing from the actual reading');
select is(private.takeoff_item_send_whole_plan(2,array[1,2],array[1]),false,
  'a page held out of this confirmation prevents a whole-plan replacement');

-- A single retained mark on the second plan, whose independent measured row says two.
create temp view marked_answer as select a.id, private.takeoff_count_marks_revision(a.id) as revision
  from public.takeoff_item_answers a where a.item_id = pg_temp.f(310) and a.job_id = pg_temp.job(21);
create function pg_temp.edit_marks_sql(intent integer, gestures jsonb) returns text language sql stable as $$
  select format('select public.edit_takeoff_count_marks(%L,%L,%L,%L::jsonb,%L::jsonb)',
    pg_temp.tenant(), pg_temp.f(21), pg_temp.f(intent), jsonb_build_object(a.id, a.revision), gestures) from marked_answer a
$$;
select is((select x.answer::jsonb #>> array['summaries', a.id::text, 'quantity']
  from marked_answer a cross join lateral extensions.dblink('race_a', pg_temp.edit_marks_sql(950,
    jsonb_build_array(jsonb_build_object('op','add','answer_id',a.id,'key',pg_temp.f(951),'page',2,'x',0.2,'y',0.3,
      'geometry','{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}'::jsonb),
      jsonb_build_object('op','verify','answer_id',a.id,'pages','[2,7]'::jsonb)))) as x(answer text)),
  '1', 'one mark verified on the complete scope of an item measured at two');

-- On the not-found item, a plan entry and a verified count are two distinct
-- sources even when both say one. A whole-affaire entry covers every plan.
-- Read the two pages of « Saisi » through the same public table and facet
-- readers as the application. The second row keeps its entry throughout.
create function pg_temp.entry_table(reader_ integer) returns jsonb language plpgsql as $$
declare
  tenant_ uuid := pg_temp.tenant();
  project_ uuid := pg_temp.f(21);
  plan_ uuid := pg_temp.plan_file(21);
begin
  perform set_config('request.jwt.claim.sub',pg_temp.f(reader_)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(reader_))::text,true);
  return jsonb_build_array(
    (select items from public.count_takeoff_item_table(tenant_,project_,plan_) where facet = 'decision' and value = 'entered'),
    (select jsonb_agg(jsonb_build_array(r.item_position, r.matching_items, r.page_offset) order by off)
      from generate_series(0,1) off cross join lateral public.read_takeoff_item_table(tenant_,project_,plan_,
        p_decisions => array['entered'],p_offset => off,p_limit => 1) r),
    (select jsonb_build_array(r.decision,r.entry -> 'quantity',r.entry -> 'revision')
      from public.read_takeoff_item_table(tenant_,project_,plan_,p_focus_item_id => pg_temp.f(311),p_limit => 1) r),
    (select r.decision from public.read_takeoff_item_table(tenant_,project_,null,p_item_ids => array[pg_temp.f(311)]) r));
end;
$$;
-- In this fixture the only entry belongs to this answer's plan. A plan table
-- exposes its revision on the line, an affaire table on that line's answer.
create function pg_temp.entry_command_scope(body jsonb, plan_id uuid) returns jsonb language sql as $$
  select case when plan_id is null then body else
    jsonb_set(jsonb_set(body,'{targets,0,entry_revision}',body#>'{targets,0,answers,0,entry_revision}'),
      '{targets,0,answers,0,entry_revision}','0') || jsonb_build_object('scope',jsonb_build_object('kind','plan','plan_logical_id',plan_id)) end
$$;
create function pg_temp.entry_choice(whole boolean, chosen text, typed integer, check_table boolean default false,
  restore_source text default null, restore_plan uuid default null) returns jsonb language plpgsql as $$
declare
  a uuid := (select id from public.takeoff_item_answers where item_id = pg_temp.f(311));
  scope_ jsonb := jsonb_build_object('kind','plan','plan_logical_id',pg_temp.f(101));
  choice jsonb;
  answer jsonb;
  before_ jsonb;
  after_ jsonb;
  entry_ jsonb;
  tables_ jsonb;
  second_reader jsonb;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    if public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),pg_temp.cmd('enter_quantity',962,array[311],
      jsonb_build_object('scope',case when whole then '{"kind":"affaire"}'::jsonb else scope_ end,
        'values',jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),'quantity',typed,'unit','u')),
        'entry',jsonb_build_object('category','site_survey')))) ->> 'outcome' <> 'applied' then
      raise exception 'entry fixture was refused';
    end if;
    perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(963),jsonb_build_object(a,0),
      jsonb_build_array(jsonb_build_object('op','add','answer_id',a,'key',pg_temp.f(964),'page',2,'x',0.7,'y',0.8,
        'geometry','{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}'::jsonb),
        jsonb_build_object('op','verify','answer_id',a,'pages','[2,7]'::jsonb)));
    select coalesce(jsonb_agg(jsonb_build_array(s ->> 'kind',s -> 'quantity')),'[]') into before_
      from private.takeoff_item_send_resolved_parts(pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21),array[2,7]) s
      where s ->> 'item_id' = pg_temp.f(311)::text;
    if whole then
      tables_ := jsonb_build_array(pg_temp.entry_table(1) -> 0);
    end if;
    -- The scope's own revision and the answer's plan-entry revision are distinct.
    choice := jsonb_set(pg_temp.cmd('accept_measured',965,array[311],jsonb_build_object('scope',scope_)),
      '{targets,0,entry_revision}',to_jsonb(case when whole then 0 else 1 end));
    choice := jsonb_set(choice,'{targets,0,answers,0,entry_revision}','0'::jsonb);
    if chosen is not null then
      choice := choice || jsonb_build_object('quantity_choice',jsonb_build_object('source',chosen,
        'alternative_quantity',typed,'verified_quantity',1));
    end if;
    if check_table then
      -- The other item's earlier entry predates its current measured reading.
      insert into public.takeoff_item_entries(tenant_id,project_id,item_id,plan_logical_id,quantity,unit,
        category,included,revision,actor_id,entered_at,command_id)
      select tenant_id,project_id,pg_temp.f(310),plan_logical_id,3,unit,category,included,1,actor_id,entered_at,command_id
        from public.takeoff_item_entries where item_id = pg_temp.f(311);
      insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)
        values(pg_temp.f(2),'item-send-second-reader@example.test','{}',now());
      update public.tenant_memberships set is_default = false where user_id = pg_temp.f(2);
      insert into public.tenant_memberships(tenant_id,user_id,role,is_default)
        values(pg_temp.tenant(),pg_temp.f(2),'director',true);
      second_reader := jsonb_build_array(pg_temp.entry_table(2));
      tables_ := jsonb_build_array(pg_temp.entry_table(1));
    end if;
    answer := public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),choice);
    select coalesce(jsonb_agg(jsonb_build_array(s ->> 'kind',s -> 'quantity')),'[]') into after_
      from private.takeoff_item_send_resolved_parts(pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21),array[2,7]) s
      where s ->> 'item_id' = pg_temp.f(311)::text;
    if whole then
      tables_ := tables_ || jsonb_build_array(pg_temp.entry_table(1) -> 0);
      perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(9966),jsonb_build_object(a,1),
        jsonb_build_array(jsonb_build_object('op','move','mark_id',(select mark_id from public.takeoff_count_mark_attributions
          where answer_id = a and state = 'retained'),'x',0.6,'y',0.5)));
      tables_ := tables_ || jsonb_build_array((select decision from public.read_takeoff_item_table(pg_temp.tenant(),pg_temp.f(21),
        pg_temp.plan_file(21),p_item_ids => array[pg_temp.f(311)])), pg_temp.entry_table(1) -> 0);
    end if;
    select jsonb_build_array(e.quantity,e.revision,e.plan_logical_id is null) into entry_
      from public.takeoff_item_entries e where e.item_id = pg_temp.f(311);
    if check_table then
      second_reader := second_reader || jsonb_build_array(pg_temp.entry_table(2));
      tables_ := tables_ || jsonb_build_array(pg_temp.entry_table(1));
      perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(966),jsonb_build_object(a,1),
        jsonb_build_array(jsonb_build_object('op','move','mark_id', (select mark_id from public.takeoff_count_mark_attributions
          where answer_id = a and state = 'retained'),'x',0.5,'y',0.4)));
      second_reader := second_reader || jsonb_build_array(pg_temp.entry_table(2));
      tables_ := tables_ || jsonb_build_array(pg_temp.entry_table(1));
    end if;
    if restore_source is not null then
      if restore_source = 'stale' then
        perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(968),jsonb_build_object(a,1),
          jsonb_build_array(jsonb_build_object('op','move','mark_id',(select mark_id from public.takeoff_count_mark_attributions
            where answer_id = a and state = 'retained'),'x',0.5,'y',0.4)));
      end if;
      if (public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),pg_temp.entry_command_scope(
        pg_temp.cmd('set_aside',969,array[311],'{"reason":"out_of_scope"}'),restore_plan)) ->> 'outcome') is distinct from 'applied' then
        raise exception 'set aside failed';
      end if;
      if restore_source = 'while_aside' then
        perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(968),jsonb_build_object(a,1),
          jsonb_build_array(jsonb_build_object('op','move','mark_id',(select mark_id from public.takeoff_count_mark_attributions
            where answer_id = a and state = 'retained'),'x',0.5,'y',0.4)));
      end if;
      if restore_source = 'entry_changed' then
        choice:=pg_temp.entry_command_scope(pg_temp.cmd('enter_quantity',971,array[311],jsonb_build_object(
          'values',jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),'quantity',8,'unit','u')),
          'entry',jsonb_build_object('category','site_survey'))),pg_temp.plan_file(21));
        if public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),choice)->>'outcome' is distinct from 'applied' then
          raise exception 'the plan entry could not be amended during the set-aside';
        end if;
      end if;
      if (public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),pg_temp.entry_command_scope(
          pg_temp.cmd('reinstate',970,array[311]),restore_plan))
            ->> 'outcome') is distinct from 'applied' then
        raise exception 'reinstatement failed';
      end if;
      select jsonb_build_array(
        (select r.decision from public.read_takeoff_item_table(pg_temp.tenant(),pg_temp.f(21),pg_temp.plan_file(21),
          p_item_ids => array[pg_temp.f(311)]) r),
        (select f ->> 'quantity_source' from jsonb_array_elements(public.read_takeoff_item_send_facts(
          pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21)) -> 'answers') f where f ->> 'answer_id' = a::text),
        (select jsonb_agg(jsonb_build_array(s ->> 'kind', s -> 'quantity')) from private.takeoff_item_send_resolved_parts(
          pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21),array[2,7]) s where s ->> 'answer_id' = a::text))
        into tables_;
    end if;
    raise sqlstate 'Z1000';
  exception when sqlstate 'Z1000' then null; -- Restore the fixture between choices.
  end;
  if restore_source is not null then return tables_; end if;
  if check_table then return jsonb_build_array(tables_,second_reader = tables_); end if;
  return jsonb_build_array(before_,answer ->> 'outcome',after_,entry_) || coalesce(tables_,'[]');
end;
$$;
select is(pg_temp.entry_choice(true,'verified_count',7),
  '[[],"stale",[],[7,1,true],1,1,"entered",1]'::jsonb,'a whole-affaire seven stays in the entered facet before and after the plan choice and after a mark moves');
select is(pg_temp.entry_choice(false,'verified_count',7),
  '[[["entered",7]],"applied",[["verified_count",1]],[7,1,false]]'::jsonb,'choosing one mark keeps the original plan entry intact');
select is(pg_temp.entry_choice(false,'entered',7),
  '[[["entered",7]],"applied",[["entered",7]],[7,1,false]]'::jsonb,'keeping the plan entry sends seven only once');
select is(pg_temp.entry_choice(false,null,1),
  '[[["entered",1]],"stale",[["entered",1]],[1,1,false]]'::jsonb,'equal typed and counted quantities still require a source choice');
select is(pg_temp.entry_choice(false,'verified_count',7,false,'accepted',scope.plan_id),
  '["accepted","verified_count",[["verified_count",1]]]'::jsonb,
  'reinstating from the '||scope.label||' table restores the verified one for the table, preview and writer')
from (values ('affaire',null::uuid),('plan',pg_temp.plan_file(21))) scope(label,plan_id);
select is(pg_temp.entry_choice(false,'verified_count',7,false,'entry_changed',scope.plan_id),
  '["entered",null,[["entered",8]]]'::jsonb,
  'reinstating from the '||scope.label||' table after editing seven to eight sends the new entry')
from (values ('affaire',null::uuid),('plan',pg_temp.plan_file(21))) scope(label,plan_id);
select is(pg_temp.entry_choice(false,'verified_count',7,false,'stale'),
  '["entered",null,[["entered",7]]]'::jsonb,
  'when reinstatement restores no acceptance, the table, preview and writer all return to the plan entry');

select is(pg_temp.entry_choice(false,'verified_count',7,false,'while_aside'),
  '["entered",null,[["entered",7]]]'::jsonb,
  'a proof changed while set aside cannot restore the count over the surviving plan entry');
select is(pg_temp.entry_choice(false,'verified_count',7,true),
  '[[[2,[[0,2,0],[1,2,1]],["entered",7,1],"entered"],
     [1,[[0,1,0]],["accepted",7,1],"accepted"],
     [1,[[0,1,0]],["pending",7,1],"pending"]],true]'::jsonb,
  'two members see the same entered filter, facet and page boundary before choosing the count, after, and after a move');

-- A difference on a plan requires the member to choose the source of its quantity.
create function pg_temp.choose_quantity(intent integer, source text) returns jsonb language sql stable as $$
  select pg_temp.cmd('accept_measured', intent, array[310], jsonb_build_object('scope',
    jsonb_build_object('kind','plan','plan_logical_id',pg_temp.f(101)), 'quantity_choice',
    jsonb_build_object('source',source,'alternative_quantity',2,'verified_quantity',1)))
$$;
-- An entry from an earlier reading competes with the current measured two and verified one.
-- From the affaire table the member selects the reading's plan before choosing a quantity.
create function pg_temp.dpgf_choice(start_plan uuid, source_ text, reference_ numeric, with_entry boolean)
returns jsonb language plpgsql as $$
declare
  tenant_ uuid := pg_temp.tenant(); project_ uuid := pg_temp.f(21); item_ uuid := pg_temp.f(310);
  selected_plan uuid; shown_entry numeric; choice jsonb; reviewed jsonb; result_ jsonb;
begin
  begin
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    -- Set the sealed fixture's reference before the member reads it.
    set local session_replication_role = replica;
    update public.takeoff_list_revision_entries set origin_kind='dpgf', origin='{"kind":"dpgf","reference":"01"}',
      reference_quantity=reference_ where item_id=item_ and revision_id=pg_temp.f(401);
    set local session_replication_role = origin;
    if with_entry then
      insert into public.takeoff_item_review_commands(id,tenant_id,project_id,intent_key,actor_id,gesture,command_sha256,outcome)
        values(pg_temp.f(7300),tenant_,project_,pg_temp.f(7301),pg_temp.f(1),'enter_quantity',repeat('e',64),'{"outcome":"applied"}');
      insert into public.takeoff_item_entries(tenant_id,project_id,item_id,plan_logical_id,quantity,unit,category,
        included,revision,actor_id,entered_at,command_id)
        values(tenant_,project_,item_,pg_temp.plan_file(21),7,'u','site_survey',true,1,pg_temp.f(1),now(),pg_temp.f(7300));
    end if;
    select (r.readings#>>'{0,plan_logical_id}')::uuid,
      (case when start_plan is null then r.readings#>>'{0,entry,quantity}' else r.entry->>'quantity' end)::numeric
      into strict selected_plan,shown_entry from public.read_takeoff_item_table(tenant_,project_,start_plan,p_item_ids=>array[item_]) r
      where r.reference_quantity=reference_ and r.origin_kind='dpgf';
    if shown_entry is distinct from (case when with_entry then 7 end) then
      raise exception 'the selected table scope did not show the expected plan entry';
    end if;
    select jsonb_set(pg_temp.entry_command_scope(pg_temp.choose_quantity(7302,source_),selected_plan),
      '{quantity_choice,alternative_quantity}',coalesce(r.entry->'quantity','2'::jsonb)) into strict choice
      from public.read_takeoff_item_table(tenant_,project_,selected_plan,p_item_ids=>array[item_]) r;
    reviewed:=public.review_takeoff_items(tenant_,project_,choice);
    select jsonb_build_array(reviewed->>'outcome',d.quantity_source,
      (select sum((part->>'quantity')::numeric) from private.takeoff_item_send_resolved_parts(
        tenant_,project_,pg_temp.job(21),array[2,7]) part where part->>'item_id'=item_::text))
      into result_ from marked_answer a left join public.takeoff_item_answer_decisions d on d.answer_id=a.id;
    raise sqlstate 'Z1000';
  exception when sqlstate 'Z1000' then null;
  end;
  return result_;
end;
$$;
select is(pg_temp.dpgf_choice(scope.plan_id,c.source,c.reference,c.with_entry),c.expected,
  format('%s table, reference %s: %s',scope.label,c.reference,c.description))
from (values ('plan',pg_temp.plan_file(21)),('affaire',null::uuid)) scope(label,plan_id)
cross join (values
  ('entered',7,true,'["applied","entered",7]'::jsonb,'the included seven is within tolerance'),
  ('entered',2,true,'["stale",null,7]'::jsonb,'the chosen seven exceeds tolerance even when the measure matches'),
  ('verified_count',7,true,'["stale",null,7]'::jsonb,'the counted one is outside tolerance despite the entry of seven'),
  ('verified_count',1,true,'["applied","verified_count",1]'::jsonb,'only the counted one matches'),
  ('measured',7,false,'["stale",null,null]'::jsonb,'the measured two is outside tolerance'),
  ('measured',2,false,'["applied","measured",2]'::jsonb,'only the measured two matches'),
  ('measured',2,true,'["stale",null,7]'::jsonb,'the measured two cannot displace a competing included entry')
) c(source,reference,with_entry,expected,description);
select throws_ok(format('select * from extensions.dblink(%L,%L) as r(result jsonb)','race_a',
  pg_temp.review_sql(21,jsonb_set(pg_temp.choose_quantity(7303,'verified_count'),'{scope}','{"kind":"affaire"}'))),
  '22023','TAKEOFF_ITEM_REVIEW_INVALID','a choice from the affaire table still requires a specific plan');
-- Retaining the measure explicitly, or accepting a measure that already equals
-- the verified count, keeps the contribution as the measured observation.
create function pg_temp.keep_measure(equal_count boolean) returns jsonb language plpgsql as $$
declare
  a uuid := (select id from marked_answer);
  choice jsonb;
  reviewed jsonb;
  parts jsonb;
begin
  begin
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',pg_temp.f(1))::text,true);
    perform set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
    if equal_count then
      perform public.edit_takeoff_count_marks(pg_temp.tenant(),pg_temp.f(21),pg_temp.f(976),jsonb_build_object(a,1),
        jsonb_build_array(jsonb_build_object('op','add','answer_id',a,'key',pg_temp.f(977),'page',2,'x',0.7,'y',0.8),
          jsonb_build_object('op','verify','answer_id',a,'pages','[2]'::jsonb)));
    end if;
    choice := pg_temp.choose_quantity(978,'measured');
    reviewed := public.review_takeoff_items(pg_temp.tenant(),pg_temp.f(21),
      case when equal_count then choice - 'quantity_choice' else choice end);
    select jsonb_agg(jsonb_build_array(s -> 'kind',s -> 'quantity',s ->> 'observation_id' is not null)) into parts
      from private.takeoff_item_send_resolved_parts(pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21),array[2,7]) s
      where s ->> 'item_id' = pg_temp.f(310)::text;
    raise sqlstate 'Z1000';
  exception when sqlstate 'Z1000' then null;
  end;
  return jsonb_build_array(reviewed ->> 'outcome',parts);
end;
$$;
create function pg_temp.restore_surviving_plan_entry() returns jsonb language plpgsql as $$
declare
 a uuid := (select id from public.takeoff_item_answers where item_id=pg_temp.f(311));
 t uuid:=pg_temp.tenant(); p uuid:= pg_temp.f(21); actor_ uuid:=pg_temp.f(1);
 scope_ jsonb:=jsonb_build_object('scope', jsonb_build_object('kind','plan','plan_logical_id',pg_temp.plan_file(21)));
 enter_ jsonb:=jsonb_build_object('values',jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),'quantity',7,'unit','u')),
   'entry',jsonb_build_object('category','site_survey'));
 choice jsonb; r jsonb; result_ jsonb; held uuid;
begin
 begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_)::text,true);
 perform set_config('request.jwt.claim.sub',actor_::text,true);
   r:= public.review_takeoff_items(t,p,pg_temp.cmd('enter_quantity',7011,array[311],scope_||enter_));
   if (r ->> 'outcome') is distinct from 'applied' then raise exception 'setup enter %',r; end if;

 perform public.edit_takeoff_count_marks(t,p,pg_temp.f(7012),jsonb_build_object(a,0),jsonb_build_array(
   jsonb_build_object('op','add','answer_id',a,'key',pg_temp.f(7013),'page',2,'x',0.7,'y',0.8,
   'geometry','{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}'::jsonb),
   jsonb_build_object('op','verify','answer_id',a,'pages','[2,7]'::jsonb)));
 choice:=pg_temp.cmd('accept_measured',7014,array[311],scope_||jsonb_build_object('quantity_choice',
    jsonb_build_object('source','verified_count','alternative_quantity',7,'verified_quantity',1)));
 choice:=jsonb_set(jsonb_set(choice,'{targets,0,entry_revision}','1'::jsonb),'{targets,0,answers,0,entry_revision}','0');
 r:=public.review_takeoff_items(t,p,choice);
 if (r ->> 'outcome') is distinct from 'applied' then raise exception 'setup count %',r; end if;
   select mark_id into strict held from public.takeoff_count_mark_attributions where answer_id=a and state='retained';
   perform public.edit_takeoff_count_marks(t,p,pg_temp.f(7015),jsonb_build_object(a,1),
     jsonb_build_array(jsonb_build_object('op','remove','answer_id',a,'mark_id',held,'reason','duplicate'),
     jsonb_build_object('op','verify','answer_id',a,'pages','[2]'::jsonb)));
   choice:=pg_temp.cmd('enter_quantity',7016,array[311],scope_||enter_);
   choice:=jsonb_set(jsonb_set(choice,'{targets,0,entry_revision}','1'),'{targets,0,answers,0,entry_revision}','0');
   r:=public.review_takeoff_items(t,p,choice);
   choice:=pg_temp.cmd('accept_measured',7017,array[311],scope_||jsonb_build_object('quantity_choice',
     jsonb_build_object('source','entered','alternative_quantity',7,'verified_quantity',null)));
   choice:=jsonb_set(jsonb_set(choice,'{targets,0,entry_revision}','2'),'{targets,0,answers,0,entry_revision}','0');
   choice:=public.review_takeoff_items(t,p,choice);
   -- Read stable projections in the next statement so they see the completed review.
   result_:=jsonb_build_array(r->>'outcome',choice->>'outcome',
      (select e.quantity from public.takeoff_item_entries e where item_id=pg_temp.f(311)),
      (select decision from public.read_takeoff_item_table(t,p,pg_temp.plan_file(21),p_item_ids=>array[pg_temp.f(311)])),
      (select coalesce(jsonb_agg(s->'quantity'),'[]') from private.takeoff_item_send_resolved_parts(t,p,pg_temp.job(21),array[2,7]) s where s->>'item_id'=pg_temp.f(311)::text));
 raise sqlstate 'Z1000';
 exception when sqlstate 'Z1000' then null;
 end;
 return result_;
end;
$$;
select is(pg_temp.restore_surviving_plan_entry(),'["applied","applied",7,"entered",[7]]'::jsonb,
  'the user can explicitly retain the surviving typed 7 after the last verified mark is removed');


create function pg_temp.omitted_count(skip_proof_revision integer default null, false_reason text default null, rule_kind text default 'contains') returns jsonb language plpgsql as $$
declare
 a uuid := (select id from public.takeoff_item_answers where item_id=pg_temp.f(311));
 t uuid:=pg_temp.tenant(); p uuid:= pg_temp.f(21); actor_ uuid:=pg_temp.f(1);
 scope_ jsonb:=jsonb_build_object('scope', jsonb_build_object('kind','plan','plan_logical_id',pg_temp.plan_file(21)));
 choice jsonb; r jsonb; result_ jsonb; body_ jsonb;
begin
 begin
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_)::text,true);
 perform set_config('request.jwt.claim.sub',actor_::text,true);
 perform public.edit_takeoff_count_marks(t,p,pg_temp.f(7012),jsonb_build_object(a,0),jsonb_build_array(
   jsonb_build_object('op','add','answer_id',a,'key',pg_temp.f(7013),'page',2,'x',0.7,'y',0.8,
   'geometry','{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}'::jsonb),
   jsonb_build_object('op','verify','answer_id',a,'pages','[2,7]'::jsonb)));
 choice:=pg_temp.cmd('accept_measured',7014,array[311],scope_||jsonb_build_object('quantity_choice',
    jsonb_build_object('source','verified_count','alternative_quantity',null::integer,'verified_quantity',1)));
 choice:=jsonb_set(jsonb_set(choice,'{targets,0,entry_revision}','0'::jsonb),'{targets,0,answers,0,entry_revision}','0');
 r:=public.review_takeoff_items(t,p,choice);
 if (r ->> 'outcome') is distinct from 'applied' then raise exception 'setup count %',r; end if;
   r:=public.review_takeoff_items(t,p,pg_temp.choose_quantity(7016,'measured'));
   if (r ->> 'outcome') is distinct from 'applied' then raise exception 'setup measure %',r; end if;
   body_:=pg_temp.plan(21,null,310,2,pg_temp.payload(721))||jsonb_build_object('left_out',jsonb_build_array(
     jsonb_build_object('item_id',pg_temp.f(311),'reason','not_found')));
   if skip_proof_revision is not null then
     insert into public.takeoff_mapping_rules(id,tenant_id,name,match_pattern,match_type,action,action_params,priority,is_active)
       select pg_temp.f(7020),t,'Hors lot',case when rule_kind = 'regex' then '^Poste' else item.label end,rule_kind,'skip','{}',1,true
       from public.takeoff_list_revision_entries item where item.item_id=pg_temp.f(311)
         and item.revision_id=(select list_revision_id from public.takeoff_item_answers where id=a);
     body_ := jsonb_set(body_,'{dependencies,stamps,mapping}',to_jsonb(public.takeoff_mapping_rules_stamp(t)));
     body_ := jsonb_set(body_,'{dependencies,rules}',(select jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),
       'rule_id',rule.id,'rule_version',rule.updated_at,'action','skip','effect','skipped'))
       from public.takeoff_mapping_rules rule where rule.id=pg_temp.f(7020)));
     body_ := jsonb_set(body_,'{left_out}',jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),
       'reason','rule_skip','rule_id',pg_temp.f(7020))));
     body_ := jsonb_set(body_,'{parts_not_sent}',jsonb_build_array(jsonb_build_object('item_id',pg_temp.f(311),
       'kind','verified_count','marks_revision',skip_proof_revision,'observation_ids','[]'::jsonb,'quantity',1,
       'unit','u','pages','[2]'::jsonb,'reason','rule_skip')));
   end if;
   if false_reason in ('unrelated_rule','shadowed','withdrawn','stale_stamp') then
     if false_reason = 'shadowed' then
       insert into public.takeoff_mapping_rules(id,tenant_id,name,match_pattern,match_type,action,action_params,priority,is_active)
         select pg_temp.f(7021),t,'Catégorie',r.match_pattern,'exact','rename','{"designation":"Autre"}',0,true
           from public.takeoff_mapping_rules r where r.id = pg_temp.f(7020);
     elsif false_reason = 'withdrawn' then
       update public.takeoff_mapping_rules set is_active = false where id = pg_temp.f(7020);
     elsif false_reason = 'unrelated_rule' then
       update public.takeoff_mapping_rules set match_pattern = 'Autre poste fictif' where id = pg_temp.f(7020);
     end if;
     body_ := jsonb_set(body_,'{dependencies,stamps,mapping}',case when false_reason = 'stale_stamp' then to_jsonb('old'::text)
       else to_jsonb(public.takeoff_mapping_rules_stamp(t)) end);
     body_ := jsonb_set(body_,'{dependencies,rules,0,rule_version}',(select to_jsonb(updated_at)
       from public.takeoff_mapping_rules where id = pg_temp.f(7020)));
   elsif false_reason is not null then
     body_ := jsonb_set(body_,'{left_out,0,reason}', to_jsonb(false_reason));
     body_ := jsonb_set(body_,'{parts_not_sent,0,reason}', to_jsonb(false_reason));
     body_ := jsonb_set(body_,'{dependencies,rules}', '[]');
     body_ := jsonb_set(body_,'{dependencies,resolutions}',jsonb_build_array(jsonb_build_object(
       'key',case when false_reason = 'entry_suspended' then 'entry:' else 'target:' end || pg_temp.f(311) || '|together',
       'choice',jsonb_build_object('kind',case when false_reason = 'entry_suspended' then 'keep_entry' else 'leave_out' end))));
   end if;
   perform set_config('request.jwt.claims','{"role":"service_role"}',true);
   perform set_config('request.jwt.claim.sub','',true);
   begin
     perform set_config('role','service_role',true);
     r:=public.send_takeoff_item_plan(t,actor_,false,jsonb_build_object('request_id',pg_temp.f(7018),'plan',body_,'version_payload',pg_temp.payload(721)));
     perform set_config('role','none',true);
     result_:=jsonb_build_array('sent',pg_temp.written(21),
       (select count(*) from public.takeoff_item_send_parts where item_id=pg_temp.f(311)),
       (select quantity from public.estimate_items where version_id=pg_temp.f(721) and item_type='line'));
   exception when sqlstate '40001' then
     result_ := jsonb_build_array(sqlerrm);
     if false_reason is not null then result_ := result_ || jsonb_build_array(pg_temp.written(21)); end if;
   end;
 raise sqlstate 'Z1000';
 exception when sqlstate 'Z1000' then null;
 end;
 return result_;
end;
$$;
select is(pg_temp.omitted_count(),'["TAKEOFF_ITEM_SEND_PREVIEW_STALE"]'::jsonb,
  'an old server cannot finalize a second accepted item while omitting a retained count as not_found');
select is(pg_temp.omitted_count(1),'["sent","1/1/1/1/applied",0,2]'::jsonb,
  'an identified skip rule can leave the proven count out while the other item is sent');
select is(pg_temp.omitted_count(2),'["TAKEOFF_ITEM_SEND_PREVIEW_STALE"]'::jsonb,
  'a skipped count with a different proof also expires');

select is(pg_temp.omitted_count(1,reason),jsonb_build_array('TAKEOFF_ITEM_SEND_PREVIEW_STALE',pg_temp.written(21)),
  format('declaring %s with no supporting fact cannot omit a count or change the draft, receipt or job',reason))
from (values ('unrelated_rule'),('shadowed'),('withdrawn'),('stale_stamp'),('left_out'),('entry_suspended'),('unit_incompatible')) reasons(reason);
select is(pg_temp.omitted_count(1,null,rule_kind),'["sent","1/1/1/1/applied",0,2]'::jsonb,
  format('the winning active %s rule omits its item explicitly and keeps the other part',rule_kind))
from (values ('exact'),('regex')) rules(rule_kind);

select is(pg_temp.keep_measure(false),'["applied",[["measured",2,true]]]'::jsonb,
  'keeping the measured two preserves the measured observation and its quantity');
select is(pg_temp.keep_measure(true),'["applied",[["measured",2,true]]]'::jsonb,
  'two verified marks and two measured units need no source choice');

select is(extensions.dblink_exec('race_a','begin'),'BEGIN','review a count different from the reading');
select is((select x.result::jsonb ->> 'outcome' from extensions.dblink('race_a',pg_temp.review_sql(21,
  pg_temp.choose_quantity(620,'measured') - 'quantity_choice')) as x(result text)),
  'stale','no implicit choice between one verified mark and two measured units');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','finish this review');
select is((select x.result::jsonb ->> 'outcome' from extensions.dblink('race_a',pg_temp.review_sql(20,
  pg_temp.cmd('accept_measured',620,array[300]))) as x(result text)),'applied','the existing acceptance without marks');
select is((select x.result::jsonb ->> 'outcome' from extensions.dblink('race_a',pg_temp.review_sql(21,
  pg_temp.choose_quantity(621,'verified_count'))) as x(result text)),'applied','the member explicitly chooses the verified count');
select is((select jsonb_build_array(a -> 'quantity_source',a #> '{verified_count,quantity}',a #> '{verified_count,marks_revision}',
    a #> '{verified_count,pages}') from extensions.dblink('race_a',
    format('select public.read_takeoff_item_send_facts(%L,%L,%L)',pg_temp.tenant(),pg_temp.f(21),pg_temp.job(21))) x(facts jsonb)
    cross join lateral jsonb_array_elements(x.facts -> 'answers') a where a ->> 'item_id' = pg_temp.f(310)::text),
  '["verified_count",1,1,[2]]'::jsonb,'the preview reads the accepted count with its revision and evidence page');
-- Simulate the attachment step shared by the older writers, even after all
-- their own checks succeeded. The first draft and both permits roll back.
create function pg_temp.old_link_refusal() returns text language plpgsql as $$
declare
  detail_ text;
begin
  perform public.persist_estimate_creation_atomic(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),null,
    pg_temp.payload(721),'[]'::jsonb,null);
  insert into private.takeoff_plan_send_checks (job_id,stamps) values (pg_temp.job(21),'{}');
  insert into private.takeoff_job_attachment_permits (job_id,tenant_id,project_id,version_id)
    values (pg_temp.job(21),pg_temp.tenant(),pg_temp.f(21),pg_temp.f(721));
  update public.takeoff_jobs set estimate_version_id = pg_temp.f(721) where id = pg_temp.job(21);
  raise exception 'OLD_PLAN_LINK_SUCCEEDED';
exception when sqlstate '40001' then
  get stacked diagnostics detail_ = pg_exception_detail;
  return sqlerrm || ' ' || (detail_::jsonb ->> 'reason');
end;
$$;
select is(pg_temp.old_link_refusal(),'TAKEOFF_SEND_JOB_NOT_READY item_list_job',
  'the earlier send cannot attach a job with a chosen count through its own permits');

create function pg_temp.count_plan() returns jsonb language sql as $$
  with input as (select pg_temp.plan(21,null,310,1,pg_temp.payload(721)) as body),
  contribution as (select (body #> '{targets,0,contributions,0}') || jsonb_build_object(
     'kind','verified_count','marks_revision',a.revision,'pages','[2]'::jsonb,
     'quantity',1,'observation_ids','[]'::jsonb) as part from input cross join marked_answer a),
  pages as (select jsonb_agg(jsonb_build_object('page',n,'item_ids',jsonb_build_array(pg_temp.f(310)),
     'target_keys',jsonb_build_array(pg_temp.f(310)||'|together'),'observation_ids','[]'::jsonb) order by n) as pages
     from unnest(array[2]) n)
  select jsonb_set(jsonb_set(body,'{targets,0,contributions}',jsonb_build_array(part)),'{page_contributions}',pages.pages)
    from input cross join contribution cross join pages
$$;

-- A move preserves both counts and re-verifies the page in the same edit. It reopens the
-- acceptance, so an ordinary first send must lose the race even at unchanged quantities.
insert into plans values ('21-before-move', pg_temp.count_plan(), pg_temp.payload(721));
insert into plans select '21-wrong-proof',jsonb_set(body,'{targets,0,contributions,0,marks_revision}','3'),payload
  from plans where name = '21-before-move';
select is((select count(*)::integer from extensions.dblink('race_b',pg_temp.send_sql(970,'21-wrong-proof'),false)
  as x(answer text)),0,'the correct count with the wrong proof cannot create the draft');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%',
  'the writer refuses the changed proof even while the acceptance revision matches');
insert into plans values ('21-old-client', pg_temp.plan(21,null,310,2,pg_temp.payload(721)), pg_temp.payload(721));
select is((select count(*)::integer from extensions.dblink('race_b',pg_temp.send_sql(971,'21-old-client'),false)
  as x(answer text)),0,'an old plan presenting the measured observation cannot send it after the choice');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%',
  'the writer compares the selected source before writing');
-- Holding only the marks row distinguishes its lock from the affaire's row,
-- which a first-draft creation also takes against a member editing marks.
select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','hold just the chosen proof');
select is((select x.revision from marked_answer a cross join lateral extensions.dblink('race_setup',
  format('select revision from public.takeoff_count_answer_states where answer_id = %L for update',a.id))
  as x(revision integer)),1,'hold revision one without changing it');
select is(extensions.dblink_exec('race_b','begin'),'BEGIN','preflight the exact preview');
select is(extensions.dblink_send_query('race_b',pg_temp.send_sql(960,'21-before-move')),1,'confirm while the marks row is held');
select ok(pg_temp.waits_for('race_b','race_setup'),'confirmation takes a lock on the marks row itself');
select is(extensions.dblink_exec('race_setup','commit'),'COMMIT','release the proof without a change');
select ok(pg_temp.answered('race_b'),'the confirmation finishes after the marks row is released');
select is((select x.answer::jsonb ->> 'replayed' from extensions.dblink_get_result('race_b') as x(answer text)),
  'false','the preview is confirmable before the move');
select is((select count(*)::integer from extensions.dblink_get_result('race_b') as x(answer text)),0,'result drained');
select is(extensions.dblink_exec('race_b','rollback'),'ROLLBACK','keep the plan unsent for the race');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a second tab moves the retained mark');
create temp view mark_to_move as select a.id as answer_id, t.mark_id from marked_answer a
  join public.takeoff_count_mark_attributions t on t.answer_id = a.id and t.state = 'retained';
select is((select x.answer::jsonb #>> array['summaries', m.answer_id::text, 'quantity'] from mark_to_move m
  cross join lateral extensions.dblink('race_a', pg_temp.edit_marks_sql(952, jsonb_build_array(
    jsonb_build_object('op','move','mark_id',m.mark_id,'x',0.4,'y',0.6),
    jsonb_build_object('op','verify','answer_id',m.answer_id,'pages','[2]'::jsonb)))) as x(answer text)),
  '1', 'the verified count stays one after the move');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(953,'21-before-move')), 1, 'confirm the old preview');
select ok(pg_temp.waits_for('race_b','race_a'), 'the writer waits for the tab editing the mark');
select is(extensions.dblink_exec('race_a','commit'), 'COMMIT', 'the move and verification commit');
select ok(pg_temp.answered('race_b'), 'the confirmation answers after the move');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) as x(answer text)),0,
  'no receipt for the old preview');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%',
  'the old preview is stale because its acceptance no longer holds');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) as x(answer text)),0,'result drained');
select is(pg_temp.written(21), '0/0/0/0/completed', 'the stale preview created nothing');
select is((select x.answer::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(21,
    pg_temp.choose_quantity(954,'verified_count'))) as x(answer text)),'applied','accept the measured item again');

-- 1. Affaire 21: a bulk review holds the affaire while the plan is confirmed.
insert into plans values ('21-first', pg_temp.count_plan(), pg_temp.payload(721));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab sets the absent item aside');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(21,
    pg_temp.cmd('set_aside', 611, array[311], '{"reason":"duplicate"}'))) as x(outcome text)), 'applied', 'applied, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(811, '21-first')), 1, 'another tab confirms the plan''s send');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the send waits for the review');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the review commits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%answers_changed%',
  'it is asked again: the answers it showed changed');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(21), '0/0/0/0/completed', 'no version, no receipt, the job still to send');

-- 1b. Affaire 21: the member loses the right to write while the send waits for the affaire (point 10 of the review).
insert into plans values ('21-demoted', pg_temp.count_plan(), pg_temp.payload(721));
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'an administrator changes the member''s role');
select is((select x.held from extensions.dblink('race_setup', format($hold$select 1 from public.estimate_projects where id = %L
  for update$hold$, pg_temp.f(21))) as x(held integer)), 1, 'holding the affaire');
insert into race_pids select 'race_setup', (select backend.pid from extensions.dblink('race_setup', 'select pg_backend_pid()')
  as backend(pid integer)) on conflict (label) do update set pid = excluded.pid;
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(813, '21-demoted')), 1, 'the plan''s send is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'the send waits for the affaire');
select is(extensions.dblink_exec('race_setup', format($demote$update public.tenant_memberships set role = 'viewer'
  where user_id = %L and tenant_id = %L$demote$, pg_temp.f(1), pg_temp.tenant())), 'UPDATE 1', 'the member made a viewer');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the change commits while the send waits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE%',
  'the right is read after the wait: a viewer never sends');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(21), '0/0/0/0/completed', 'no version, no receipt, the job still to send');
select is(extensions.dblink_exec('race_setup', format($restore$update public.tenant_memberships set role = 'engineer'
  where user_id = %L and tenant_id = %L$restore$, pg_temp.f(1), pg_temp.tenant())), 'UPDATE 1', 'the member an engineer again');

-- 2. Affaire 21: the same request twice at once.
insert into plans values ('21-again', pg_temp.count_plan(), pg_temp.payload(721));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab confirms the plan''s send');
select is(extensions.dblink_exec('race_a', pg_temp.as_server_sql()), 'SET', 'through the server');
create temp table first_send as select x.answer::jsonb as answer
  from extensions.dblink('race_a', pg_temp.send_sql(812, '21-again')) as x(answer text);
select is((select answer ->> 'replayed' from first_send), 'false', 'sent, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(812, '21-again')), 1, 'its lost answer is sent again meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second waits for the affaire');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first commits');
select ok(pg_temp.answered('race_b'), 'the second answers');
select is((select x.answer::jsonb from extensions.dblink_get_result('race_b', false) as x(answer text)),
  (select answer - 'replayed' || '{"replayed": true}'::jsonb from first_send), 'the first one''s receipt, replayed');
select diag(concat('same request: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(21), '1/1/1/1/applied', 'one V1, one receipt, one target, one part, the job applied');

select results_eq($$select p.kind, p.quantity, p.marks_revision, p.pages, i.quantity
  from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
  join public.estimate_items i on i.id = t.estimate_item_id where p.project_id = pg_temp.f(21)$$,
  $$values ('verified_count'::text,1::numeric,2,array[2],1::numeric)$$,
  'the line holds only the chosen count, and its part holds the revision and the page bearing the mark');

-- The source job now has its first receipt. Check the boundary that prevents an amendment.
select is((select count(*)::integer from mark_to_move m cross join lateral extensions.dblink('race_a',
  pg_temp.edit_marks_sql(955,jsonb_build_array(jsonb_build_object('op','remove','answer_id',m.answer_id,
    'mark_id',m.mark_id,'reason','duplicate'))),false) as x(answer text)),0,'the proposed removal was refused');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_MARKS_PLAN_SENT%',
  'the marks command closes the source answer after its first send');
select is((select x.answer::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(21,
  pg_temp.cmd('accept_measured',956,array[310]))) as x(answer text)),'stale','the sent item cannot be accepted again');
select is((select count(*)::integer from extensions.dblink('race_b',pg_temp.send_sql(957,'21-again'),false)
  as x(answer text)),0,'a new send intention was refused');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_ALREADY_SENT%',
  'the writer refuses another send of the same source job');
select is(pg_temp.written(21),'1/1/1/1/applied','the original receipt and live part are still the only ones');

-- 3. Affaire 20: a targeted save of the contributing row holds the job's rules while the plan is confirmed.
insert into plans values ('20-first', pg_temp.plan(20, null, 300, 2, pg_temp.payload(720)), pg_temp.payload(720));
create temp table targeted_read as select format($save$select count(*) from public.update_takeoff_item_for_review(%L, %L, %L,
    %L::timestamptz, %L::jsonb, %L::timestamptz)$save$, i.tenant_id, i.job_id, i.id, i.updated_at,
    jsonb_build_object('quantity', 3, 'updated_at', clock_timestamp()), i.rules_evaluated_at) as save
  from public.takeoff_items i where i.id = pg_temp.f(820);
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the targeted review corrects the row of affaire 20');
select is((select x.saved from extensions.dblink('race_a', (select save from targeted_read)) as x(saved bigint)), 1::bigint,
  'corrected, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(820, '20-first')), 1, 'the plan''s send is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the send waits for the job''s rules');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the targeted save commits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%takeoff_changed%',
  'it judges the job as committed and is asked again');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(20), '0/0/0/0/completed', 'nothing written');
select results_eq($$select quantity, is_verified from public.takeoff_items where id = pg_temp.f(820)$$, $$values (3::numeric, false)$$,
  'the correction withdrew the row''s verification: its acceptance no longer counts');
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = %L$rules$, pg_temp.job(20))), 'UPDATE 1',
  'the server evaluates the corrected row''s rules');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(20,
    pg_temp.cmd('accept_measured', 640, array[300]))) as x(outcome text)), 'applied', 'the corrected measure accepted again');

-- 4. Affaire 20: an import creates V1 while the plan's first draft is confirmed.
insert into plans values ('20-second', pg_temp.plan(20, null, 300, 3, pg_temp.payload(720)), pg_temp.payload(720));
select is(extensions.dblink_exec('race_a', 'reset role'), 'RESET', 'session A acts as the import''s service');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the import starts');
select is(extensions.dblink_exec('race_a', 'set local role service_role'), 'SET', 'as the service role');
select is((select x.created from extensions.dblink('race_a', format($import$select (public.persist_estimate_creation_atomic(%L, %L, %L,
    null, %L::jsonb, '[]'::jsonb, null) #>> '{version,id}')$import$, pg_temp.tenant(), pg_temp.f(1), pg_temp.f(20), pg_temp.payload(730)))
  as x(created text)), pg_temp.f(730)::text, 'the import creates V1, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(821, '20-second')), 1, 'the plan''s first draft is confirmed');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the send waits for the import, on the affaire');
select diag(concat('send during the import: ', extensions.dblink_error_message('race_b')));
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the import commits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%destination_changed%',
  'it is asked again on the version the import created');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(20), '1/0/0/0/completed', 'one V1, the import''s; nothing sent');
select is(extensions.dblink_exec('race_a', 'set role authenticated'), 'SET', 'session A is the member again');
select is(extensions.dblink_exec('race_setup', format($lock$begin; insert into public.draft_locks (version_id, user_id, tenant_id,
  expires_at, session_id) values (%L, %L, %L, now() + interval '30 minutes', gen_random_uuid()); commit;$lock$,
  pg_temp.f(730), pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the member holds V1''s lease');

-- 5. Affaire 20: the editor saves V1 (its key, then the version) while the plan is confirmed on it.
insert into plans values ('20-third', pg_temp.plan(20, pg_temp.f(730), 300, 3));
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'the editor saves V1');
select is((select x.saved from extensions.dblink('race_setup', format($edit$with saved as (update public.estimate_versions
    set updated_at = clock_timestamp() where id = %1$L returning 1)
  select pg_advisory_xact_lock(hashtextextended(%1$L, 0))::text || (select count(*) from saved)::text$edit$, pg_temp.f(730)))
  as x(saved text)), '1', 'its key held, the version saved, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(822, '20-third')), 1, 'the plan''s send is confirmed on V1');
create temp table race_setup_pid as select (select backend.pid from extensions.dblink('race_setup', 'select pg_backend_pid()')
  as backend(pid integer)) as pid;
insert into race_pids select 'race_setup', pid from race_setup_pid on conflict (label) do update set pid = excluded.pid;
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'the send waits for the editor''s key');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the editor commits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PREVIEW_STALE%destination_changed%',
  'it is asked again: the draft changed since the plan');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.written(20), '1/0/0/0/completed', 'nothing sent');

-- 6. Affaire 20: two tabs confirm the same job at once while a bulk review of the affaire is sent.
insert into plans values ('20-fourth', pg_temp.plan(20, pg_temp.f(730), 300, 3));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab confirms the plan''s send on V1');
select is(extensions.dblink_exec('race_a', pg_temp.as_server_sql()), 'SET', 'through the server');
select is((select x.answer::jsonb ->> 'replayed' from extensions.dblink('race_a', pg_temp.send_sql(823, '20-fourth'))
  as x(answer text)), 'false', 'sent, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(824, '20-fourth')), 1, 'another tab confirms it too (another request)');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second confirmation waits for the affaire');
select is(extensions.dblink_send_query('race_c', pg_temp.review_sql(20, pg_temp.cmd('set_aside', 625, array[301],
  '{"reason":"duplicate"}'))), 1, 'a third tab sets the absent item aside');
select ok(pg_temp.waits_for('race_c', 'race_a'), 'the review waits for the send');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the send commits');
select ok(pg_temp.answered('race_b'), 'the second confirmation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_ALREADY_SENT%', 'it is told the job is sent');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select ok(pg_temp.answered('race_c'), 'the review answers');
select is((select x.outcome::jsonb from extensions.dblink_get_result('race_c', false) as x(outcome text)),
  jsonb_build_object('outcome', 'stale', 'stale', jsonb_build_array(pg_temp.f(301))), 'stale: a plan sent is closed to every gesture');
select diag(concat('review after the send: ', extensions.dblink_error_message('race_c')));
select is((select count(*)::integer from extensions.dblink_get_result('race_c', false) as x(outcome text)), 0, 'and is done');
select is(pg_temp.written(20), '1/1/1/1/applied', 'one receipt, one target, one part, the job applied once');
select results_eq($$select i.quantity from public.estimate_items i join public.takeoff_item_send_targets t on t.estimate_item_id = i.id
  where t.project_id = pg_temp.f(20)$$, $$values (3::numeric)$$, 'the line holds the corrected measure, written once');


-- 7. Affaire 20: the actor's tenant suspended while the send waits for the affaire (closing 7 of the last check). The job
--    is sent already: without the change the send is told so; with it, it is refused first, by the actor's tenant.
create function pg_temp.hold_affaire_sql(p_project integer) returns text language sql stable as $$
  select format($hold$select 1 from public.estimate_projects where id = %L for update$hold$, pg_temp.f(p_project))
$$;
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'an administrator of the platform suspends the tenant');
select is((select x.held from extensions.dblink('race_setup', pg_temp.hold_affaire_sql(20)) as x(held integer)), 1,
  'holding the affaire');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(825, '20-fourth')), 1, 'the plan''s send is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'the send waits for the affaire');
select is(extensions.dblink_exec('race_setup', format($suspend$update public.tenants set is_active = false where id = %L$suspend$,
  pg_temp.tenant())), 'UPDATE 1', 'the tenant suspended');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'while the send waits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE%tenant_changed%',
  'the tenant is read after the wait: a suspended tenant never sends, never replays');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_setup', format($restore$update public.tenants set is_active = true where id = %L$restore$,
  pg_temp.tenant())), 'UPDATE 1', 'the tenant active again');
select is(pg_temp.written(20), '1/1/1/1/applied', 'nothing more written');

-- 8. Affaire 20: the member goes to another tenant (it becomes their default) while the send waits for the affaire.
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'the member is given another tenant, their default');
select is((select x.held from extensions.dblink('race_setup', pg_temp.hold_affaire_sql(20)) as x(held integer)), 1,
  'holding the affaire');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(826, '20-fourth')), 1, 'the plan''s send is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'the send waits for the affaire');
select is(extensions.dblink_exec('race_setup', format($switch$insert into public.tenants (id, name, slug, is_active)
    values ('d5800000-0000-4000-8000-000000000071', 'Autre entreprise (fictive)', 'autre-entreprise-fictive-envoi', true);
  update public.tenant_memberships set is_default = false where user_id = %1$L;
  insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
    values ('d5800000-0000-4000-8000-000000000071', %1$L, 'admin', true)$switch$, pg_temp.f(1))), 'INSERT 0 1',
  'the other tenant is now the member''s');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'while the send waits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_PROJECT_NOT_WRITABLE%tenant_changed%',
  'the actor''s active tenant is read after the wait: a member gone to another tenant never sends here');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
-- The member back in their tenant (the other one goes with the fixtures' cleanup, as every tenant of the member).
select is(extensions.dblink_exec('race_setup', format($back$begin;
  update public.tenant_memberships set is_default = false where user_id = %1$L;
  update public.tenant_memberships set is_default = true where user_id = %1$L and tenant_id = %2$L;
  commit;$back$, pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the member back in their tenant');
select is(pg_temp.written(20), '1/1/1/1/applied', 'nothing more written');

-- 9. Affaire 20: a second reading of its plan (job 1120) confirmed while the member's lease of V1 ends during the wait
--    (closing 10): the lease is read on the clock after the wait, the send is refused, the estimate unchanged.
create function pg_temp.republish_sql(project integer, token integer) returns text language sql stable as $$
  select replace(replace(pg_temp.publish_sql(project, token), pg_temp.job(project)::text, pg_temp.f(1100 + project)::text),
    pg_temp.f(800 + project)::text, pg_temp.f(850 + project)::text)
$$;
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.relaunch_sql(20)) as x(outcome text)), 'admitted',
  'a second reading of affaire 20''s plan');
select is((select x.job from extensions.dblink('race_setup', format($dispatch$select job_id::text from
  public.dispatch_next_takeoff_host_job(%L)$dispatch$, pg_temp.host())) as x(job text)), pg_temp.f(1120)::text, 'handed');
select is((select x.claimed from extensions.dblink('race_setup', replace(pg_temp.claim_sql(20, 930), pg_temp.job(20)::text,
  pg_temp.f(1120)::text)) as x(claimed bigint)), 1::bigint, 'claimed');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', pg_temp.republish_sql(20, 930)) as x(answer text)),
  'false', 'published');
-- Its plan as far as the lease is read (a well-formed plan of this job on V1 as it is now; what follows the lease is not
-- reached): the parts compared later need not match.
insert into plans select '20-late', jsonb_set(jsonb_set(body, '{job_id}', to_jsonb(pg_temp.f(1120))), '{dependencies,stamps,destination}',
  (select jsonb_build_object('version_id', v.id, 'status', v.status, 'updated_at', v.updated_at) from public.estimate_versions v
    where v.id = pg_temp.f(730))) from plans where name = '20-fourth';
create temp table estimate_before as select string_agg(i.id || ':' || i.quantity || ':' || i.updated_at, ',' order by i.id) as rows_
from public.estimate_items i where i.version_id = pg_temp.f(730);
select is(extensions.dblink_exec('race_setup', format($lease$begin; delete from public.draft_locks where version_id = %1$L;
  insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  values (%1$L, %2$L, %3$L, clock_timestamp() + interval '2 seconds', gen_random_uuid()); commit;$lease$,
  pg_temp.f(730), pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the member''s lease of V1 ends in two seconds');
select is(extensions.dblink_exec('race_setup', 'begin'), 'BEGIN', 'a session holds the affaire');
select is((select x.held from extensions.dblink('race_setup', pg_temp.hold_affaire_sql(20)) as x(held integer)), 1,
  'holding it');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(827, '20-late')), 1, 'the second reading''s send is confirmed');
select ok(pg_temp.waits_for('race_b', 'race_setup'), 'the send waits for the affaire');
select pg_sleep(3);
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the affaire released after the lease ended');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'it writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_ITEM_SEND_DRAFT_LOCK_REQUIRED%',
  'a lease valid on entry and ended during the wait never authorises the write');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is((select string_agg(i.id || ':' || i.quantity || ':' || i.updated_at, ',' order by i.id) from public.estimate_items i
  where i.version_id = pg_temp.f(730)), (select rows_ from estimate_before), 'the estimate is unchanged');

-- 10. Affaire 20: the second reading (job 1120) sent into V1 holds the affaire while V1 is copied as a new version (the
--     copy of a draft fed by item, …_takeoff_item_send_copy.sql): the copy waits for the affaire, then carries what the
--     send wrote (the new part; the part it replaced stays in V1's history only).
-- The lavabo's part of a reading, as the writer reads it.
create function pg_temp.parts_of(p_job uuid) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('answer_id', s.answer_id, 'answer_revision', s.answer_revision, 'kind', s.kind,
      'observation_ids', case when s.observation_id is null then '[]'::jsonb else jsonb_build_array(s.observation_id) end,
      'quantity', s.quantity, 'unit', s.unit, 'pages', to_jsonb(s.pages),
      'identity', jsonb_build_object('unit', (private.normalize_unit(s.unit)).unit_code, 'basis', null, 'network', null,
        'material', null, 'diameter', null)) order by s.observation_id), '[]'::jsonb)
  from private.takeoff_item_send_job_parts(pg_temp.tenant(), pg_temp.f(20), p_job, array[2, 7]) as s
  where s.item_id = pg_temp.f(300)
$$;
-- A reading of affaire 20's plan sent into a version whose line the lavabo feeds: that line, the reading's part replacing
-- this plan's earlier part on the pages it covers.
create function pg_temp.plan_into(p_job uuid, p_version uuid) returns jsonb language sql as $$
  with line as (select i.id, i.updated_at, i.quantity from public.estimate_items i
      join public.takeoff_item_send_targets t on t.estimate_item_id = i.id
      where t.version_id = p_version and t.item_id = pg_temp.f(300)),
    target as (select jsonb_build_object('key', pg_temp.f(300) || '|together', 'item_id', pg_temp.f(300), 'compartment_key', 'together',
      'line', jsonb_build_object('kind', 'earlier_line', 'estimate_item_id', line.id, 'expected_updated_at', line.updated_at,
        'expected_quantity', line.quantity),
      'unit_code', 'u', 'quantity_after', (select sum((c.value ->> 'quantity')::numeric)
        from jsonb_array_elements(pg_temp.parts_of(p_job)) c(value)),
      'quantity', jsonb_build_object('kept_entry', false), 'rule', null, 'contributions', pg_temp.parts_of(p_job),
      'replaces', coalesce((select jsonb_agg(jsonb_build_object('job_id', p.job_id, 'answer_id', p.answer_id,
          'observation_ids', to_jsonb(p.observation_ids), 'quantity', p.quantity) order by p.id)
        from public.takeoff_item_send_parts p join public.takeoff_item_send_targets t on t.id = p.target_id
        where t.estimate_item_id = line.id and p.state = 'live' and p.plan_logical_id = pg_temp.plan_file(20)), '[]'::jsonb)) as value,
      line.id as line_id, line.updated_at, line.quantity
      from line)
  select jsonb_build_object('format', 'takeoff_item_send', 'version', 1, 'job_id', p_job, 'plan_key', pg_temp.plan_file(20),
    'list', jsonb_build_object('revision_id', pg_temp.f(400), 'revision', 1),
    'destination', jsonb_build_object('kind', 'existing_draft', 'version_id', p_version),
    'engine', 3, 'breakdown', 'together', 'sections', '[]'::jsonb, 'targets', jsonb_build_array(target.value),
    'page_contributions', jsonb_build_array(jsonb_build_object('page', 2, 'item_ids', jsonb_build_array(pg_temp.f(300)),
      'target_keys', jsonb_build_array(pg_temp.f(300) || '|together'),
      'observation_ids', (select coalesce(jsonb_agg(o.value), '[]'::jsonb) from jsonb_array_elements(pg_temp.parts_of(p_job)) c(value)
        cross join lateral jsonb_array_elements(c.value -> 'observation_ids') o(value)))),
    'page_decisions', '[]'::jsonb, 'left_out', '[]'::jsonb, 'parts_not_sent', '[]'::jsonb,
    'dependencies', jsonb_build_object(
      'answers', (with pairs as (select p.* from private.takeoff_item_table_pairs(pg_temp.tenant(), pg_temp.f(20),
          pg_temp.plan_file(20)) as p)
        select coalesce(jsonb_agg(jsonb_build_object('item_id', a.item_id, 'answer_id', a.id, 'revision', a.content_sha256,
            'decision_revision', case when pair.decision_effective in ('accepted', 'set_aside') then pair.decision_revision end,
            'entry_revision', null) order by a.item_id), '[]'::jsonb)
        from public.takeoff_item_answers a left join pairs pair on pair.answer_id = a.id where a.job_id = p_job),
      'affaire_entries', '[]'::jsonb, 'rules', '[]'::jsonb, 'location_generation', null, 'plan_pages', '[2, 7]'::jsonb,
      'earlier_targets', private.takeoff_item_send_earlier_targets(pg_temp.tenant(), p_version),
      'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', target.line_id, 'updated_at', target.updated_at,
        'quantity', target.quantity, 'dpgf', null)),
      'pages_in_estimate', (select coalesce(jsonb_agg(jsonb_build_object('page', h.value -> 'page',
          'earlier_job_ids', h.value -> 'earlier_job_ids', 'estimate_item_ids', h.value -> 'estimate_item_ids')), '[]'::jsonb)
        from jsonb_array_elements(private.takeoff_item_send_held_pages(pg_temp.tenant(), p_version, p_job, pg_temp.document(20),
          array[2, 7])) h(value)),
      'stamps', jsonb_build_object('job', public.takeoff_rule_job_stamp(pg_temp.tenant(), pg_temp.f(20), p_job),
        'peers', public.takeoff_send_peers_stamp(pg_temp.tenant(), p_version),
        'context', (select jsonb_build_object('peers', s.stamps ->> 'peers', 'locations', s.stamps ->> 'locations')
          from (select private.takeoff_send_context_stamps(private.takeoff_send_context(pg_temp.tenant(), pg_temp.f(20), p_job,
            p_version)) as stamps) s),
        'dpgf', '[]'::jsonb, 'first_draft_settings', null,
        'destination', (select jsonb_build_object('version_id', v.id, 'status', v.status, 'updated_at', v.updated_at)
          from public.estimate_versions v where v.id = p_version),
        'mapping', public.takeoff_mapping_rules_stamp(pg_temp.tenant())),
      'resolutions', '[]'::jsonb))
  from target
$$;
-- The lavabo of a reading accepted in the table of items, as the table freezes it (the plan's current answer).
create function pg_temp.accept_reading(p_key integer, p_job uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(p_key), 'gesture', 'accept_measured',
    'scope', '{"kind":"affaire"}'::jsonb,
    'targets', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'entry_revision', 0,
      'answers', (select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', 0, 'entry_revision', 0))
        from public.takeoff_item_answers a where a.job_id = p_job and a.item_id = pg_temp.f(300)))),
    'apply', jsonb_build_array(pg_temp.f(300)), 'skipped', '[]'::jsonb)
$$;
-- What a version holds of the send by item, by its line: its targets' items, its live parts (reading, quantity, pages),
-- the line's quantity.
create function pg_temp.held_by(p_version uuid) returns text language sql stable as $$
  select concat_ws(' | ', (select string_agg(concat_ws(':', t.item_id, i.quantity), ',' order by t.item_id)
      from public.takeoff_item_send_targets t join public.estimate_items i on i.id = t.estimate_item_id where t.version_id = p_version),
    (select string_agg(concat_ws(':', p.job_id, p.quantity, p.pages::text), ',' order by p.job_id)
      from public.takeoff_item_send_parts p where p.version_id = p_version and p.state = 'live'))
$$;
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = %L$rules$, pg_temp.f(1120))), 'UPDATE 1',
  'the second reading''s rules are evaluated');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(20,
  pg_temp.accept_reading(631, pg_temp.f(1120)))) as x(outcome text)), 'applied', 'its lavabo accepted');
select is(extensions.dblink_exec('race_setup', format($lease$begin; delete from public.draft_locks where version_id = %1$L;
  insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  values (%1$L, %2$L, %3$L, clock_timestamp() + interval '30 minutes', gen_random_uuid()); commit;$lease$,
  pg_temp.f(730), pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the member holds V1''s lease again');
\ir ../fixtures/takeoff-item-redistribution-races.sql
\ir ../fixtures/takeoff-item-redistribution-vacated.sql
insert into plans values ('20-second-reading', pg_temp.plan_into(pg_temp.f(1120), pg_temp.f(730)), null);
create temp table v1_before as select pg_temp.held_by(pg_temp.f(730)) as held;
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab confirms the second reading''s send into V1');
select is(extensions.dblink_exec('race_a', pg_temp.as_server_sql()), 'SET', 'through the server');
select is((select x.answer::jsonb ->> 'parts_replaced' from extensions.dblink('race_a', pg_temp.send_sql(828, '20-second-reading'))
  as x(answer text)), '1', 'sent, replacing the first reading''s part, not yet committed');
select is(extensions.dblink_send_query('race_c', format($copy$select public.duplicate_estimate_version(%L, false)::text$copy$,
  pg_temp.f(730))), 1, 'another tab makes a new version of V1');
select ok(pg_temp.waits_for('race_c', 'race_a'), 'the copy waits for the affaire');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the send commits');
select ok(pg_temp.answered('race_c'), 'the copy answers');
create temp table copy_one as select x.version_id::uuid as version_id from extensions.dblink_get_result('race_c', false)
  as x(version_id text);
select is((select count(*)::integer from extensions.dblink_get_result('race_c', false) as x(version_id text)), 0, 'and is done');
select isnt(pg_temp.held_by(pg_temp.f(730)), (select held from v1_before), 'V1 holds the second reading');
select is(pg_temp.held_by((select version_id from copy_one)), pg_temp.held_by(pg_temp.f(730)),
  'the copy made after the send holds what V1 holds: the second reading''s part, on its line');
select is((select count(*)::integer from public.takeoff_item_send_parts p where p.version_id = (select version_id from copy_one)
  and p.job_id = pg_temp.job(20)), 0, 'the part the send replaced stays in V1''s history, never in the copy');

-- 11. Affaire 20: V1's copy copied again while a third reading (job 1220) is sent into the first copy: the send waits for
--     the affaire, then writes into the first copy only; the second copy holds the first copy as it was.
select is((select x.outcome from extensions.dblink('race_setup', replace(replace(pg_temp.relaunch_sql(20),
  format('%L, ''reread_plans'', %L', pg_temp.f(620), pg_temp.job(20)), format('%L, ''reread_plans'', %L', pg_temp.f(670),
  pg_temp.f(1120))), pg_temp.f(1120)::text || '", "plan_set_id"', pg_temp.f(1220)::text || '", "plan_set_id"'))
  as x(outcome text)), 'admitted', 'a third reading of affaire 20''s plan');
select is((select x.job from extensions.dblink('race_setup', format($dispatch$select job_id::text from
  public.dispatch_next_takeoff_host_job(%L)$dispatch$, pg_temp.host())) as x(job text)), pg_temp.f(1220)::text, 'handed');
select is((select x.claimed from extensions.dblink('race_setup', replace(pg_temp.claim_sql(20, 940), pg_temp.job(20)::text,
  pg_temp.f(1220)::text)) as x(claimed bigint)), 1::bigint, 'claimed');
select is((select split_part(x.answer, ':', 2) from extensions.dblink('race_setup', replace(replace(pg_temp.publish_sql(20, 940),
  pg_temp.job(20)::text, pg_temp.f(1220)::text), pg_temp.f(820)::text, pg_temp.f(890)::text)) as x(answer text)), 'false',
  'published');
select is(extensions.dblink_exec('race_setup', format($rules$update public.takeoff_items set rules_stale = false,
  rules_evaluated_at = now(), rule_results = '[]'::jsonb where job_id = %L$rules$, pg_temp.f(1220))), 'UPDATE 1',
  'its rules are evaluated');
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(20,
  pg_temp.accept_reading(632, pg_temp.f(1220)))) as x(outcome text)), 'applied', 'its lavabo accepted');
select is(extensions.dblink_exec('race_setup', format($lease$begin; insert into public.draft_locks (version_id, user_id, tenant_id,
  expires_at, session_id) values (%1$L, %2$L, %3$L, clock_timestamp() + interval '30 minutes', gen_random_uuid()); commit;$lease$,
  (select version_id from copy_one), pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the member holds the copy''s lease');
insert into plans values ('20-third-reading', pg_temp.plan_into(pg_temp.f(1220), (select version_id from copy_one)), null);
create temp table copy_one_before as select pg_temp.held_by((select version_id from copy_one)) as held;
select is(extensions.dblink_exec('race_c', 'begin'), 'BEGIN', 'a tab copies the copy');
create temp table copy_two as select x.version_id::uuid from extensions.dblink('race_c',
  format($copy$select public.duplicate_estimate_version(%L, false)::text$copy$, (select version_id from copy_one))) as x(version_id text);
select ok((select version_id from copy_two) is not null, 'copied, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql(829, '20-third-reading')), 1,
  'the third reading''s send into the first copy is confirmed meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_c'), 'the send waits for the affaire');
select is(extensions.dblink_exec('race_c', 'commit'), 'COMMIT', 'the second copy commits');
select ok(pg_temp.answered('race_b'), 'the send answers');
select is((select x.answer::jsonb ->> 'parts_replaced' from extensions.dblink_get_result('race_b', false) as x(answer text)), '1',
  'it is sent into the first copy, replacing the part the copy carried');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(pg_temp.held_by((select version_id from copy_two)), (select held from copy_one_before),
  'the second copy holds the first copy as it was before the send');
select isnt(pg_temp.held_by((select version_id from copy_one)), (select held from copy_one_before),
  'the first copy holds the third reading');
select is((select count(*)::integer from public.takeoff_item_send_parts p where p.version_id = pg_temp.f(730)
  and p.job_id = pg_temp.f(1220)), 0, 'and V1 holds nothing of it');

-- Copies own their proof. Read each part through its own version, even after
-- deleting the intermediate draft. The original analysis stays on the first draft.
create temp table marked_copy as select x.id from extensions.dblink('race_a',
  format('select public.duplicate_estimate_version(%L,false)',pg_temp.f(721))) as x(id uuid);
create temp table marked_next_copy as select x.id from marked_copy c cross join lateral extensions.dblink('race_a',
  format('select public.duplicate_estimate_version(%L,false)',c.id)) as x(id uuid);
create temp view copied_counts as
  select p.version_id, p.kind, p.quantity, p.marks_revision, p.pages, p.copied_from_part_id
  from public.takeoff_item_send_parts p
  where p.item_id = pg_temp.f(310) and p.state = 'live';
select results_eq($$select kind,quantity,marks_revision,pages from copied_counts
  where version_id in (select id from marked_copy union select id from marked_next_copy) order by version_id$$,
  $$values ('verified_count'::text,1::numeric,2,array[2]),('verified_count',1,2,array[2])$$,
  'a copy and its copy each hold the chosen count, pages and proof revision');
select is((select count(*)::integer from copied_counts p join public.takeoff_item_send_parts source on source.id = p.copied_from_part_id
  where (p.version_id = (select id from marked_copy) and source.version_id = pg_temp.f(721))
     or (p.version_id = (select id from marked_next_copy) and source.version_id = (select id from marked_copy))),2,
  'each copy names its immediate source part');
select is(extensions.dblink_exec('race_a',format('delete from public.estimate_versions where id = %L',(select id from marked_copy))),
  'DELETE 1','the member deletes the intermediate draft that owns no analysis');
select results_eq($$select c.kind,c.quantity,c.marks_revision,c.pages,source.id is null
  from copied_counts c left join public.takeoff_item_send_parts source on source.id = c.copied_from_part_id
  where c.version_id = (select id from marked_next_copy)$$,
  $$values ('verified_count'::text,1::numeric,2,array[2],true)$$,
  'the second copy retains its own proof after its immediate source part is gone');

-- A public edit of this sent analysis is refused above. Exercise the writer's
-- locked proof comparison separately on an analysis one revision ahead, with
-- the same retained mark. Each call rolls its synthetic revision back.
create function pg_temp.earlier_proof(version_ uuid, advanced boolean) returns jsonb language plpgsql as $$
declare
  part public.takeoff_item_send_parts;
  result jsonb;
begin
  select * into strict part from public.takeoff_item_send_parts where version_id = version_ and state = 'live';
  begin
    if advanced then
      update public.takeoff_count_answer_states set revision = revision + 1 where answer_id = part.answer_id;
    end if;
    select jsonb_build_array(private.takeoff_item_send_lock_proofs(part.tenant_id,part.job_id,version_,
      jsonb_build_array(jsonb_build_object('item_id',part.item_id))), part.marks_revision,
      s -> 'revision', s -> 'quantity') into result from private.takeoff_count_mark_summary(part.answer_id) s;
    raise sqlstate 'Z1000';
  exception when sqlstate 'Z1000' then null;
  end;
  return result;
end;
$$;
select is(pg_temp.earlier_proof(pg_temp.f(721),true),'[false,2,3,1]'::jsonb,
  'the source part is stale under the writer lock when its analysis advances at constant count');
select is(pg_temp.earlier_proof((select id from marked_next_copy),false),'[true,2,2,1]'::jsonb,
  'the copied part is current when the locked analysis still holds the recorded revision');
select is(pg_temp.earlier_proof((select id from marked_next_copy),true),'[false,2,3,1]'::jsonb,
  'the copied part is equally stale at constant count even after its immediate source was deleted');

-- Replay a fresh reading into C, the surviving copy. The underlying PDF has
-- nine pages. The requested pages change with the member's preparation.
-- All five scenarios run the real admission, publication, review and writer,
-- each rolled back to the same source and copy.
create function pg_temp.followup_scope(pages_ integer[], source_ text, fault text default null, prior_ text default 'verified_count') returns jsonb language plpgsql as $$
declare
  project_ uuid := pg_temp.f(21);
  tenant_ uuid := pg_temp.tenant();
  job_ uuid := pg_temp.f(1121);
  actor_ uuid := pg_temp.f(1);
  version_ uuid := (select id from marked_next_copy);
  item_ uuid := pg_temp.f(310);
  plan_ uuid := pg_temp.plan_file(21);
  token_ uuid := pg_temp.f(981);
  counted boolean := source_ = 'verified_count';
  typed boolean := source_ = 'entered';
  full_ boolean := cardinality(pages_) = 9;
  snapshot_ jsonb := pg_temp.snapshot(21,pages_,2);
  targets_ jsonb;
  plan jsonb;
  contribution jsonb;
  line record;
  previous public.takeoff_item_send_parts;
  facts jsonb;
  answer_ uuid;
  empty_answer jsonb;
  measured_answer jsonb;
  row_ jsonb;
  command jsonb;
  record_ jsonb;
  request_ jsonb;
  read_ text;
  detail_ text;
begin
  begin
    update public.takeoff_preparations set revision = 2,draft = snapshot_ -> 'preparation',
      confirmed_snapshot = snapshot_,confirmed_at = (snapshot_ ->> 'confirmed_at')::timestamptz
      where project_id = project_;
    execute pg_temp.relaunch_sql(21,pages_,2) into read_;
    if read_ is distinct from 'admitted' then raise exception 'expected new reading, got %', read_; end if;
    perform public.dispatch_next_takeoff_host_job(pg_temp.host());
    execute replace(pg_temp.claim_sql(21,981),pg_temp.job(21)::text,job_::text) into read_;
    if read_ is distinct from '1' then raise exception 'expected a claimed reading, got %',read_; end if;
    empty_answer := jsonb_build_object('item_id',item_,'outcome','not_found','searched_pages',pages_,'unreadable_pages','[]'::jsonb,
      'reasons',jsonb_build_array(jsonb_build_object('code','NO_INDICATION','by','model','text','Aucun indice (fictif).',
        'chunk_id','f1-b1')),'observations','[]'::jsonb);
    measured_answer := jsonb_build_object('item_id',item_,'outcome','measured','searched_pages',pages_,'unreadable_pages','[]'::jsonb,
      'reasons','[]'::jsonb,'quantity',jsonb_build_object('value',2,'unit','u'),
      'observations',jsonb_build_array(jsonb_build_object('page',pages_[1],'evidence','Deux symboles fictifs','method','symbol_count',
        'confidence',0.9,'quantity',2,'unit','u','role','contribution','source','model','chunk_id','f1-b1','takeoff_item_id',pg_temp.f(871))));
    row_ := jsonb_build_object('id',pg_temp.f(871),'designation','Poste 0 (fictif)','quantity',2,'unit','u',
      'confidence',0.9,'evidence','Deux symboles fictifs','source_file_name','plan-1.pdf','source_page',pages_[1],'metadata','{}'::jsonb);
    perform public.publish_takeoff_item_answers(job_,token_,'2026-11-22T10:00:00Z','modele-fictif','takeoff-c-postes-v1',
      '{"schema_version":"v2","prompt_version":"takeoff-c-postes-v1"}',pages_,
      jsonb_build_array(case when typed then empty_answer else measured_answer end,
        jsonb_set(empty_answer,'{item_id}',to_jsonb(pg_temp.f(311)))),'[]',
      '{"extracted_json":{},"warnings":[],"tables":[],"provider_meta":{},"token_count":10,"cost_cents":0,"duration_ms":5}',
      case when typed then '[]'::jsonb else jsonb_build_array(row_) end);
    update public.takeoff_items set rules_stale = false,rules_evaluated_at = now(),rule_results = '[]' where job_id = job_;
    perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor_)::text,true);
    perform set_config('request.jwt.claim.sub',actor_::text,true);
    select id into strict answer_ from public.takeoff_item_answers where job_id = job_ and item_id = item_;
    if counted then
      perform public.edit_takeoff_count_marks(tenant_,project_,pg_temp.f(982),jsonb_build_object(answer_,0),jsonb_build_array(
        jsonb_build_object('op','add','answer_id',answer_,'key',pg_temp.f(983),'page',pages_[1],'x',0.8,'y',0.2,
          'geometry','{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}'::jsonb),
        jsonb_build_object('op','verify','answer_id',answer_,'pages',pages_)));
    end if;
    command := pg_temp.cmd(case when typed then 'enter_quantity' else 'accept_measured' end,984,array[310],
      jsonb_build_object('scope',jsonb_build_object('kind','plan','plan_logical_id',plan_)));
    command := jsonb_set(command,'{targets,0,answers}',jsonb_build_array(jsonb_build_object('answer_id',answer_,
      'entry_revision',0,'decision_revision',0,'marks_revision',private.takeoff_count_marks_revision(answer_))));
    if counted then command := command || '{"quantity_choice":{"source":"verified_count","alternative_quantity":2,"verified_quantity":1}}';
    elsif typed then command := command || jsonb_build_object('entry',jsonb_build_object('category','site_survey'),
      'values',jsonb_build_array(jsonb_build_object('item_id',item_,'quantity',7,'unit','u'))); end if;
    record_ := public.review_takeoff_items(tenant_,project_,command);
    if record_ ->> 'outcome' <> 'applied' then raise exception 'expected an accepted reading, got %',record_; end if;
    select * into strict previous from public.takeoff_item_send_parts where version_id = version_ and item_id = item_ and state = 'live';
    if prior_ in ('measured','entered') then
      -- Build a copied earlier ordinary contribution. The send below uses the normal locked writer.
      perform set_config('mergeone.takeoff_item_send','fixture',true);
      insert into public.takeoff_item_send_receipts
        select (jsonb_populate_record(null::public.takeoff_item_send_receipts,to_jsonb(r)
          || jsonb_build_object('id',pg_temp.f(9897)))).* from public.takeoff_item_send_receipts r
        where r.id = previous.receipt_id and r.command_kind = 'copy';
      update public.takeoff_item_send_parts set state = 'replaced',replaced_by_receipt_id = pg_temp.f(9897),
        replaced_at = now() where id = previous.id;
      previous.id := pg_temp.f(9894);
      previous.receipt_id := pg_temp.f(9897);
      previous.copied_from_part_id := null;
      previous.kind := prior_;
      previous.quantity := 7.5;
      previous.marks_revision := null;
      if prior_ = 'measured' then
        previous.observation_ids := array[pg_temp.f(9886)];
        previous.takeoff_item_ids := array[pg_temp.f(9885)];
      else
        previous.entry_id := pg_temp.f(9884);
        previous.entry_revision := 1;
      end if;
      insert into public.takeoff_item_send_parts select previous.*;
      perform set_config('mergeone.takeoff_item_send','',true);
    end if;
    select i.* into strict line from public.takeoff_item_send_targets t join public.estimate_items i on i.id = t.estimate_item_id
      where t.id = previous.target_id;
    insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
      values(version_,actor_,tenant_,now()+interval '10 minutes',gen_random_uuid());
    facts := public.read_takeoff_item_send_facts(tenant_,project_,job_);
    select jsonb_build_object('answer_id',answer_,'answer_revision',s -> 'answer_revision','kind',source_,
      'quantity',case when typed then 7 when counted then 1 else 2 end,'unit','u',
      'observation_ids',case when typed or counted then '[]'::jsonb else jsonb_build_array(s -> 'observation_id') end,
      'pages',case when typed then to_jsonb(pages_) else jsonb_build_array(pages_[1]) end,
      'identity','{"unit":"u","basis":null,"network":null,"material":null,"diameter":null}'::jsonb)
      || case when counted then jsonb_build_object('marks_revision',1) else '{}'::jsonb end into strict contribution
      from private.takeoff_item_send_resolved_parts(tenant_,project_,job_,pages_) s where s ->> 'item_id' = item_::text;
    targets_ := jsonb_build_array(jsonb_build_object('key',item_||'|together','item_id',item_,'compartment_key','together',
      'line',jsonb_build_object('kind','earlier_line','estimate_item_id',line.id,'expected_updated_at',line.updated_at,
        'expected_quantity',line.quantity),'unit_code','u','quantity_after',(contribution ->> 'quantity')::numeric + case when full_ then 0 else 1 end,
      'quantity',jsonb_build_object('kept_entry',false),'rule',null,'contributions',jsonb_build_array(contribution),
      'replaces',case when full_ then jsonb_build_array(jsonb_build_object('job_id',previous.job_id,'answer_id',previous.answer_id,
          'observation_ids','[]'::jsonb,'quantity',previous.quantity)) else '[]'::jsonb end));
    plan := pg_temp.plan(21,version_,310,2) || jsonb_build_object('job_id',job_,'targets',targets_,'sections','[]'::jsonb,
      'page_contributions',(select jsonb_agg(jsonb_build_object('page',page,'item_ids',jsonb_build_array(item_),
        'target_keys',jsonb_build_array(item_||'|together'),'observation_ids',contribution->'observation_ids') order by page)
        from jsonb_array_elements(contribution -> 'pages') page));
    plan := jsonb_set(plan,'{dependencies,plan_pages}',to_jsonb(pages_));
    plan := jsonb_set(plan,'{dependencies,answers}',(select jsonb_agg(jsonb_build_object('item_id',a -> 'item_id',
      'answer_id',a -> 'answer_id','revision',a -> 'revision','decision_revision',a #> '{decision,revision}',
      'entry_revision',a #> '{entry,revision}') order by a ->> 'item_id') from jsonb_array_elements(facts->'answers') a));
    plan := jsonb_set(plan,'{dependencies,stamps,job}',to_jsonb(public.takeoff_rule_job_stamp(tenant_,project_,job_)));
    plan := jsonb_set(plan,'{dependencies,stamps,context}',(select jsonb_build_object('peers',s->>'peers','locations',s->>'locations')
      from private.takeoff_send_context_stamps(private.takeoff_send_context(tenant_,project_,job_,version_)) s));
    plan := jsonb_set(plan,'{dependencies,lines}',jsonb_build_array(jsonb_build_object('estimate_item_id',line.id,
      'updated_at',line.updated_at,'quantity',line.quantity,'dpgf',null)));
    plan := jsonb_set(plan,'{dependencies,pages_in_estimate}',(select coalesce(jsonb_agg(jsonb_build_object('page',h->'page',
      'earlier_job_ids',h->'earlier_job_ids','estimate_item_ids',h->'estimate_item_ids')),'[]'::jsonb)
      from jsonb_array_elements(private.takeoff_item_send_held_pages(tenant_,version_,job_,pg_temp.document(21),pages_)) h));
    if fault = 'other_quantity' then
      plan := jsonb_set(plan,'{targets,0,replaces,0,quantity}','9');
    elsif fault = 'older_proof' then
      update public.takeoff_count_answer_states set revision = revision + 1 where answer_id = previous.answer_id;
    end if;
    request_ := jsonb_build_object('request_id',pg_temp.f(985),'plan',plan);
    begin
      perform set_config('request.jwt.claims','{"role":"service_role"}',true);
      perform set_config('request.jwt.claim.sub','',true);
      perform public.send_takeoff_item_plan(tenant_,actor_,false,request_);
      select jsonb_build_array('sent',p.kind,p.quantity,i.quantity,old.state) into strict record_
        from public.takeoff_item_send_parts p join public.estimate_items i on i.id = line.id
        join public.takeoff_item_send_parts old on old.id = previous.id
        where p.version_id = version_ and p.job_id = job_ and p.state = 'live';
    exception when sqlstate '40001' then
      get stacked diagnostics detail_ = pg_exception_detail;
      if prior_ in ('measured','entered') then
        record_ := jsonb_build_array(sqlerrm,detail_::jsonb -> 'held_part' = jsonb_build_object(
          'job_id',previous.job_id,'answer_id',previous.answer_id,'reading_revision',
          (select a.reading_revision from public.takeoff_item_answers a where a.id = previous.answer_id),
          'source',prior_,'pages',previous.pages,'quantity',7.5,'unit',previous.unit),
          (select count(*) from public.takeoff_item_send_receipts where job_id = job_));
      elsif fault is not null then
        record_ := jsonb_build_array(sqlerrm,detail_::jsonb -> 'reason',
          (select quantity from public.estimate_items where id = line.id),
          (select count(*) from public.takeoff_item_send_receipts where job_id = job_));
      else
        record_ := jsonb_build_array(sqlerrm,detail_::jsonb -> 'quantity',detail_::jsonb -> 'pages',
        detail_::jsonb ->> 'job_id' = previous.job_id::text,(select quantity from public.estimate_items where id = line.id),
        (select count(*) from public.takeoff_item_send_receipts where job_id = job_));
      end if;
    end;
    raise sqlstate 'Z1000';
  exception when sqlstate 'Z1000' then null;
  end;
  return record_;
end;
$$;
select is(pg_temp.followup_scope(array[7],'verified_count',null,prior_),
  '["TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE",true,0]'::jsonb,
  format('refusing the partial count identifies the held %s quantity, pages and original reading of the copy',prior_))
from (values ('measured'),('entered')) prior(prior_);
select is(pg_temp.followup_scope(array[7],'measured'),
  '["TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE",1,[2],true,1,0]'::jsonb,
  'the disjoint measured reading cannot add to the earlier verified total, the copy and its receipt are untouched');
select is(pg_temp.followup_scope(array[7],'verified_count'),
  '["TAKEOFF_ITEM_SEND_VERIFIED_TOTAL_INDIVISIBLE",1,[2],true,1,0]'::jsonb,
  'the disjoint verified count cannot add either');
select is(pg_temp.followup_scope(array[1,2,3,4,5,6,7,8,9],source_),expected,format('a whole reading replaces the earlier count with %s',source_))
from (values ('measured','["sent","measured",2,2,"replaced"]'::jsonb),('entered','["sent","entered",7,7,"replaced"]'::jsonb),
  ('verified_count','["sent","verified_count",1,1,"replaced"]'::jsonb)) inputs(source_,expected);

select is(pg_temp.followup_scope(array[1,2,3,4,5,6,7,8,9],'measured',fault),
  '["TAKEOFF_ITEM_SEND_PREVIEW_STALE","earlier_send_changed",1,0]'::jsonb,
  format('a full send to the surviving copy refuses %s and leaves the line and receipts intact',fault))
from (values ('older_proof'),('other_quantity')) faults(fault);

\ir ../fixtures/takeoff-item-redistribution-committed.sql

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
      and not (columns.table_schema = 'public' and columns.table_name = 'audit_logs')
  loop
    execute format('delete from %I.%I where tenant_id = $1', entry.table_schema, entry.table_name) using target;
  end loop;
  -- Tenant data deletes can write audit entries, so clear them after the loop.
  delete from public.audit_logs where tenant_id = target;
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
from (values ('race_setup'), ('race_a'), ('race_b'), ('race_c')) as session(name);
select * from finish();
rollback;
