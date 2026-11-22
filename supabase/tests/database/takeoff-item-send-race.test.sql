-- Lot 4, migration C (…_takeoff_item_send_writer.sql): the send of a plan by item across sessions. Each case holds the
-- first transaction open at a named point, proves the second session waits for it (its blocking process), lets the
-- first one go, then reads what the second one did.
-- 1. A bulk review of the affaire holds it (an item set aside) while the plan is confirmed: the send waits, then is
--    asked again (the answers it showed changed); nothing written. Never interleaved.
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
create function pg_temp.snapshot(project integer) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[2, 7]'::jsonb))
        from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20))))
$$;
create function pg_temp.launch_sql(project integer) returns text language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', (select jsonb_build_object('kind', 'item_list', 'version', 2, 'list', jsonb_build_object('revision_id', r.id,
        'revision', r.revision, 'content_sha256', r.content_sha256, 'item_count', r.item_count))
        from public.takeoff_list_revisions r where r.id = pg_temp.f(400 + project - 20)),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', jsonb_build_array(jsonb_build_object('key', 'plan:' || pg_temp.f(100 + project - 20), 'ordinal', 1,
        'plans', jsonb_build_array(pg_temp.f(100 + project - 20)), 'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0,
        'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))),
      'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.f(100 + project - 20),
        'plan_file_id', pg_temp.f(100 + project - 20), 'name', 'plan-1.pdf', 'logical_id', pg_temp.f(100 + project - 20),
        'generation', null, 'content_sha256', pg_temp.digest(pg_temp.f(100 + project - 20)), 'pages', '[2, 7]'::jsonb,
        'page_count', 9)),
      'coverage', jsonb_build_object('plans_retained', 1, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(project),
    jsonb_build_array(jsonb_build_object('id', pg_temp.job(project), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || pg_temp.f(100 + project - 20), 'source_file_name', 'plan-1.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
      'execution_host_id', pg_temp.host())),
    pg_temp.f(project + 20), array[pg_temp.f(100 + project - 20)])
$$;
create function pg_temp.claim_sql(project integer, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    pg_temp.job(project), pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
-- The relaunch of an affaire's plan (a second reading, its job 1100 + n) and its publication (its row 850 + n).
create function pg_temp.relaunch_sql(project integer) returns text language sql stable as $$
  select replace(replace(pg_temp.launch_sql(project), format('%L, ''initial'', null', pg_temp.f(500 + project)),
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

-- The member in both tabs.
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the member', session.name))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, format($claims$select set_config('request.jwt.claims', %L, false),
    set_config('request.jwt.claim.sub', %L, false)$claims$, jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(1))::text,
    pg_temp.f(1)::text)) as claims(claims text, sub text)), pg_temp.f(1)::text, format('%s is signed in', session.name))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);
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
        'entry_revision', coalesce(pe.revision, 0)))
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
create temp table plans (name text primary key, body jsonb not null);
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
    'destination', case when p_version is null then jsonb_build_object('kind', 'first_draft', 'version_payload', p_payload)
      else jsonb_build_object('kind', 'existing_draft', 'version_id', p_version) end,
    'engine', 3, 'breakdown', 'together',
    'sections', '[{"key": "list:", "title": "Métré", "parent_key": null, "parent_id": null}]'::jsonb,
    'targets', jsonb_build_array(pg_temp.new_line(p_project, p_item, p_quantity)),
    'page_contributions', jsonb_build_array(jsonb_build_object('page', 2, 'item_ids', jsonb_build_array(pg_temp.f(p_item)),
      'target_keys', jsonb_build_array(pg_temp.f(p_item) || '|together'), 'observation_ids', '[]'::jsonb)),
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
create function pg_temp.send_sql(p_request integer, p_plan text) returns text language sql stable as $$
  select format($send$select public.send_takeoff_item_plan(%L::jsonb)::text$send$, jsonb_build_object('request_id', pg_temp.f(p_request),
    'plan', (select body from plans where name = p_plan)))
$$;
create function pg_temp.written(p_project integer) returns text language sql stable as $$
  select concat_ws('/', (select count(*) from public.estimate_versions v where v.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_receipts r where r.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_targets t where t.project_id = pg_temp.f(p_project)),
    (select count(*) from public.takeoff_item_send_parts p where p.project_id = pg_temp.f(p_project)),
    (select status::text from public.takeoff_jobs j where j.id = pg_temp.job(p_project)))
$$;

-- Each affaire's measured item accepted in the table of items.
select is((select x.outcome::jsonb ->> 'outcome' from extensions.dblink('race_a', pg_temp.review_sql(p.project,
    pg_temp.cmd('accept_measured', 600 + p.project, array[300 + 10 * (p.project - 20)]))) as x(outcome text)), 'applied',
  format('affaire %s: its measured item accepted', p.project)) from (values (20), (21)) as p(project);

-- 1. Affaire 21: a bulk review holds the affaire while the plan is confirmed.
insert into plans values ('21-first', pg_temp.plan(21, null, 310, 2, pg_temp.payload(721)));
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

-- 2. Affaire 21: the same request twice at once.
insert into plans values ('21-again', pg_temp.plan(21, null, 310, 2, pg_temp.payload(721)));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a tab confirms the plan''s send');
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

-- 3. Affaire 20: a targeted save of the contributing row holds the job's rules while the plan is confirmed.
insert into plans values ('20-first', pg_temp.plan(20, null, 300, 2, pg_temp.payload(720)));
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
insert into plans values ('20-second', pg_temp.plan(20, null, 300, 3, pg_temp.payload(720)));
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
from (values ('race_setup'), ('race_a'), ('race_b'), ('race_c')) as session(name);
select * from finish();
rollback;
