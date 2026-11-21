-- Lot 2 M2 (migration …_takeoff_send_receipts.sql): sends that race, in two sessions. Each case holds the first
-- transaction open at a named point (its send done, not committed), proves the second session waits for it (its
-- blocking process), commits, then reads what the second one did. Isolation justified: two confirmations interleave only
-- across two sessions, which no journey drives deterministically.
-- 1. Two takeoffs of one affaire both previewed a first draft: one V1, the other confirmation asked again.
-- 2. The same takeoff confirmed from two tabs: one V1, one application, the second tab told it is sent.
-- 3. An import creates V1 while a first draft is being confirmed: the send is asked again on the real destination.
-- 4. The same request replayed while it is in flight: the replay returns the receipt.
-- 5. Two takeoffs sent to the same draft and the same line: serialized, the second asked again, then 3 + 2 + 1 = 6.
-- Written before the migration: red on ab72179d (public.send_takeoff_job does not exist). All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('d2a00000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

create temp table send_race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- send_stage stays the database owner: it stages each command as the server's service does.
select is(extensions.dblink_connect(session.name, (select connection from send_race_connection)), 'OK', format('%s connected', session.name))
from (values ('send_setup'), ('send_a'), ('send_b'), ('send_stage')) as session(name);

-- One engineer and four affaires: 1 with three plans read by three takeoffs (11, 12, 13, one preparation revision each),
-- 2, 3 and 4 with one takeoff each. Every takeoff is admitted without a version, as M1 admits it, then completed.
select is(extensions.dblink_exec('send_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd2a00000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'send-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer'::public.tenant_role where user_id = 'd2a00000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select project.id, m.tenant_id, m.user_id, project.name, false
from public.tenant_memberships m cross join (values
  ('d2a00000-0000-4000-8000-000000000010'::uuid, 'Course premier brouillon (fictif)'),
  ('d2a00000-0000-4000-8000-000000000020'::uuid, 'Course deux onglets (fictif)'),
  ('d2a00000-0000-4000-8000-000000000030'::uuid, 'Course import (fictif)'),
  ('d2a00000-0000-4000-8000-000000000040'::uuid, 'Course rejeu (fictif)')) as project(id, name)
where m.user_id = 'd2a00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_sets (id, tenant_id, project_id, name)
select plan.set_id, m.tenant_id, plan.project_id, 'Plans fictifs ' || plan.n
from public.tenant_memberships m cross join (values
  (11, 'd2a00000-0000-4000-8000-000000000111'::uuid, 'd2a00000-0000-4000-8000-000000000010'::uuid),
  (12, 'd2a00000-0000-4000-8000-000000000112'::uuid, 'd2a00000-0000-4000-8000-000000000010'::uuid),
  (13, 'd2a00000-0000-4000-8000-000000000113'::uuid, 'd2a00000-0000-4000-8000-000000000010'::uuid),
  (21, 'd2a00000-0000-4000-8000-000000000121'::uuid, 'd2a00000-0000-4000-8000-000000000020'::uuid),
  (31, 'd2a00000-0000-4000-8000-000000000131'::uuid, 'd2a00000-0000-4000-8000-000000000030'::uuid),
  (41, 'd2a00000-0000-4000-8000-000000000141'::uuid, 'd2a00000-0000-4000-8000-000000000040'::uuid)) as plan(n, set_id, project_id)
where m.user_id = 'd2a00000-0000-4000-8000-000000000001' and m.is_default;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d2a00000-0000-4000-8000-000000000' || (200 + s.n))::uuid, s.tenant_id, s.id, 'plan-' || s.n || '.pdf',
  concat_ws('/', s.tenant_id, s.id, 'd2a00000-0000-4000-8000-000000000' || (200 + s.n), 'plan-' || s.n || '.pdf'), 'application/pdf', 8, 1
from (select set_row.*, substr(set_row.id::text, 34)::integer - 100 as n from public.plan_sets set_row
  where set_row.id::text like 'd2a00000-%') as s;
commit;
$setup$), 'COMMIT', 'affaires and plans committed');

select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('send_setup'), ('send_a'), ('send_b')) as session(name);
select is((select claims.sub from extensions.dblink(session.name, $claims$select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"d2a00000-0000-4000-8000-000000000001"}', false), set_config('request.jwt.claim.sub',
  'd2a00000-0000-4000-8000-000000000001', false)$claims$) as claims(full_claims text, sub text)),
  'd2a00000-0000-4000-8000-000000000001', format('%s carries the engineer''s claims', session.name))
from (values ('send_setup'), ('send_a'), ('send_b')) as session(name);

-- Each takeoff: its preparation confirmed (one revision per plan set of the affaire), admitted, then completed with one
-- washbasin line read on its plan (3, 2, 1 in affaire 1).
create function pg_temp.prepare_and_admit(p_job integer, p_set integer, p_project integer, p_revision integer, p_quantity integer)
returns void language plpgsql as $$
declare
  draft jsonb;
begin
  select jsonb_build_object('schema_version', 1, 'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true,
        'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at)))
    into draft
  from public.plan_files f where f.plan_set_id = pg_temp.fx(100 + p_set);
  perform extensions.dblink_exec('send_setup', 'reset role');
  perform extensions.dblink_exec('send_setup', format($prep$
    insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
    select m.tenant_id, %1$L, %2$s, %3$L::jsonb, jsonb_build_object('schema_version', 1, 'preparation_revision', %2$s,
      'confirmed_by', m.user_id, 'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb,
      'preparation', %3$L::jsonb), '2026-11-20T00:00:00Z', m.user_id, m.user_id
    from public.tenant_memberships m where m.user_id = 'd2a00000-0000-4000-8000-000000000001' and m.is_default
    on conflict (tenant_id, project_id) do update set revision = excluded.revision, draft = excluded.draft,
      confirmed_snapshot = excluded.confirmed_snapshot$prep$, pg_temp.fx(p_project), p_revision, draft));
  perform extensions.dblink_exec('send_setup', 'set role authenticated');
  perform 1 from extensions.dblink('send_setup', format($admit$
    select null::text from public.admit_prepared_takeoff_job(jsonb_build_object('id', %1$L, 'tenant_id',
      (select tenant_id from public.estimate_projects where id = %2$L), 'project_id', %2$L, 'plan_set_id', %3$L, 'level', 'C',
      'created_by', 'd2a00000-0000-4000-8000-000000000001', 'execution_provider', 'chatgpt_local',
      'execution_host_id', 'urn:uuid:d2a00000-0000-4000-8000-000000000090', 'processing_strategy', 'sync',
      'preparation_snapshot', (select confirmed_snapshot from public.takeoff_preparations where project_id = %2$L)))$admit$,
    pg_temp.fx(p_job), pg_temp.fx(p_project), pg_temp.fx(100 + p_set))) as admitted(nothing text);
  perform extensions.dblink_exec('send_setup', 'reset role');
  perform extensions.dblink_exec('send_setup', format($done$
    update public.takeoff_jobs set status = 'completed' where id = %1$L;
    insert into public.takeoff_results (id, tenant_id, job_id) select %2$L, tenant_id, id from public.takeoff_jobs where id = %1$L;
    insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
      source_page, confidence, metadata)
    select %3$L, j.tenant_id, j.id, %2$L, 'Lavabo', %4$s, 'u', 'Repère fictif', f.file_name, 1, 0.95,
      jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', f.id))
    from public.takeoff_jobs j join public.plan_files f on f.plan_set_id = j.plan_set_id where j.id = %1$L$done$,
    pg_temp.fx(p_job), pg_temp.fx(p_job + 300), pg_temp.fx(p_job + 400), p_quantity));
  perform extensions.dblink_exec('send_setup', 'set role authenticated');
end;
$$;
select pg_temp.prepare_and_admit(11, 11, 10, 1, 3);
select pg_temp.prepare_and_admit(12, 12, 10, 2, 2);
select pg_temp.prepare_and_admit(13, 13, 10, 3, 1);
select pg_temp.prepare_and_admit(21, 21, 20, 1, 4);
select pg_temp.prepare_and_admit(31, 31, 30, 1, 5);
select pg_temp.prepare_and_admit(41, 41, 40, 1, 6);
select is((select count(*)::integer from public.takeoff_jobs where id::text like 'd2a00000-%' and status = 'completed'
  and estimate_version_id is null), 6, 'six versionless takeoffs are ready to send');

-- The command as the server builds it after its preview, from the committed state.
create function pg_temp.command(p_request integer, p_job integer, p_destination jsonb, p_section jsonb,
  p_accumulations jsonb default '[]', p_accumulated integer default 0)
returns text language sql as $$
  select jsonb_build_object('format_version', 1, 'request_id', pg_temp.fx(p_request), 'job_id', j.id,
    'fingerprint', repeat('d', 64), 'destination', p_destination, 'section', p_section,
    'client', jsonb_build_object('fingerprint', repeat('d', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'override', false),
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'version_stamp', case when p_destination ->> 'kind' = 'existing_draft'
        then public.takeoff_rule_version_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid) end),
    'mapping_plan', (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', 0, 'rule_id', null, 'action', 'none',
      'designation', i.designation, 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
      from public.takeoff_items i where i.job_id = j.id),
    'page_decisions', '[]'::jsonb, 'rule_results', '[]'::jsonb, 'rule_transforms', '[]'::jsonb, 'accumulations', p_accumulations,
    'expected_impact', jsonb_build_object('sent', 1, 'accumulated', p_accumulated), 'override', null,
    'write_plan', jsonb_build_object('format_version', 1, 'parts', (select jsonb_agg(jsonb_build_object('takeoff_item_id', i.id))
      from public.takeoff_items i where i.job_id = j.id)))::text
  from public.takeoff_jobs j where j.id = pg_temp.fx(p_job)
$$;
create function pg_temp.first_draft(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'first_draft', 'version_payload', jsonb_build_object(
    'id', pg_temp.fx(p_version), 'title', null, 'date_devis', '2026-11-21', 'validite_jours', 30, 'margin_multiplier', 1,
    'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
    'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
    'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
    'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0))
$$;
create function pg_temp.section(p_id integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'new', 'id', pg_temp.fx(p_id), 'title', 'Métré fictif')
$$;
-- Stages the command (committed, as the server's service does before the user's session sends it), then returns the
-- send of its request.
create function pg_temp.send_sql(p_command text) returns text language plpgsql as $$
begin
  perform * from extensions.dblink('send_stage', format('select public.stage_takeoff_send(%L, %L::jsonb)::text',
    'd2a00000-0000-4000-8000-000000000001', p_command)) as staged(result text);
  return format('select (public.send_takeoff_job(%L::jsonb) ->> ''replayed'')', (select jsonb_build_object('request_id',
    command -> 'request_id', 'job_id', command -> 'job_id', 'fingerprint', command -> 'fingerprint')
    from (select p_command::jsonb as command) as parsed));
end;
$$;

create temp table send_race_pids(label text primary key, pid integer);
insert into send_race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('send_a'), ('send_b')) as session(name);
-- Waits until session B is blocked by session A (a condition, bounded), and says whether it is.
create function pg_temp.b_waits_for_a() returns boolean language plpgsql as $$
declare
  a integer := (select pid from send_race_pids where label = 'send_a');
  b integer := (select pid from send_race_pids where label = 'send_b');
begin
  for attempt in 1..400 loop
    if a = any(pg_catalog.pg_blocking_pids(b)) then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  return false;
end;
$$;
create function pg_temp.versions(p_project integer) returns bigint language sql as $$
  select count(*) from public.estimate_versions where project_id = pg_temp.fx(p_project)
$$;

-- 1. Two takeoffs of affaire 1 both previewed a first draft.
create temp table commands (name text primary key, body text);
insert into commands values
  ('11', pg_temp.command(511, 11, pg_temp.first_draft(601), pg_temp.section(701))),
  ('12', pg_temp.command(512, 12, pg_temp.first_draft(602), pg_temp.section(702)));
select is(extensions.dblink_exec('send_a', 'begin'), 'BEGIN', 'takeoff 11''s confirmation starts');
select is((select x.replayed from extensions.dblink('send_a', pg_temp.send_sql((select body from commands where name = '11')))
  as x(replayed text)), 'false', 'takeoff 11 creates V1 and is sent, not yet committed');
select is(extensions.dblink_send_query('send_b', pg_temp.send_sql((select body from commands where name = '12'))), 1,
  'takeoff 12''s confirmation is sent');
select ok(pg_temp.b_waits_for_a(), 'takeoff 12 waits for takeoff 11, on the affaire');
select is(extensions.dblink_exec('send_a', 'commit'), 'COMMIT', 'takeoff 11 commits');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0,
  'takeoff 12 writes nothing');
select ok(extensions.dblink_error_message('send_b') like '%TAKEOFF_SEND_PREVIEW_STALE%destination_changed%',
  'takeoff 12 is asked to confirm again on the real destination');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'takeoff 12 is done');
select is(pg_temp.versions(10), 1::bigint, 'one first draft V1');
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.fx(12)), null::uuid, 'takeoff 12 is still to send');

-- 2. The same takeoff of affaire 2 confirmed from two tabs.
insert into commands values
  ('21a', pg_temp.command(521, 21, pg_temp.first_draft(611), pg_temp.section(711))),
  ('21b', pg_temp.command(522, 21, pg_temp.first_draft(612), pg_temp.section(712)));
select is(extensions.dblink_exec('send_a', 'begin'), 'BEGIN', 'tab A''s confirmation starts');
select is((select x.replayed from extensions.dblink('send_a', pg_temp.send_sql((select body from commands where name = '21a')))
  as x(replayed text)), 'false', 'tab A sends, not yet committed');
select is(extensions.dblink_send_query('send_b', pg_temp.send_sql((select body from commands where name = '21b'))), 1,
  'tab B confirms the same takeoff');
select ok(pg_temp.b_waits_for_a(), 'tab B waits for tab A');
select is(extensions.dblink_exec('send_a', 'commit'), 'COMMIT', 'tab A commits');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'tab B writes nothing');
select ok(extensions.dblink_error_message('send_b') like '%TAKEOFF_SEND_ALREADY_SENT%',
  'tab B finds the takeoff sent: nothing is applied twice');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'tab B is done');
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.fx(20)),
    (select count(*) from public.takeoff_send_receipts where job_id = pg_temp.fx(21)),
    (select count(*) from public.estimate_items where source_job_id = pg_temp.fx(21))$$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$, 'one V1, one receipt, one line');

-- 3. An import creates V1 of affaire 3 while its takeoff's first draft is being confirmed.
insert into commands values ('31', pg_temp.command(531, 31, pg_temp.first_draft(622), pg_temp.section(722)));
select is(extensions.dblink_exec('send_a', 'reset role'), 'RESET', 'session A acts as the import''s service');
select is(extensions.dblink_exec('send_a', 'begin'), 'BEGIN', 'the import starts');
select is(extensions.dblink_exec('send_a', 'set local role service_role'), 'SET', 'as the service role');
select is((select x.created from extensions.dblink('send_a', format($import$select (public.persist_estimate_creation_atomic(
    (select tenant_id from public.estimate_projects where id = %1$L), 'd2a00000-0000-4000-8000-000000000001', %1$L, null,
    (%2$L::jsonb -> 'version_payload'), '[]'::jsonb, null) #>> '{version,id}')$import$, pg_temp.fx(30), pg_temp.first_draft(621)))
  as x(created text)), pg_temp.fx(621)::text, 'the import creates V1, not yet committed');
select is(extensions.dblink_send_query('send_b', pg_temp.send_sql((select body from commands where name = '31'))), 1,
  'the takeoff''s first draft is confirmed');
select ok(pg_temp.b_waits_for_a(), 'the send waits for the import, on the affaire');
select is(extensions.dblink_exec('send_a', 'commit'), 'COMMIT', 'the import commits');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'the send writes nothing');
select ok(extensions.dblink_error_message('send_b') like '%TAKEOFF_SEND_PREVIEW_STALE%destination_changed%',
  'the send is asked again on the version the import created');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'the send is done');
select results_eq($$select id from public.estimate_versions where project_id = pg_temp.fx(30)$$, $$values (pg_temp.fx(621))$$,
  'the affaire has the import''s V1 only');
select is(extensions.dblink_exec('send_a', 'set role authenticated'), 'SET', 'session A acts as the engineer again');

-- 4. The same request replayed while it is in flight (a timeout, then « Réessayer »).
insert into commands values ('41', pg_temp.command(541, 41, pg_temp.first_draft(631), pg_temp.section(731)));
select is(extensions.dblink_exec('send_a', 'begin'), 'BEGIN', 'the request starts');
select is((select x.replayed from extensions.dblink('send_a', pg_temp.send_sql((select body from commands where name = '41')))
  as x(replayed text)), 'false', 'it sends, not yet committed');
select is(extensions.dblink_send_query('send_b', pg_temp.send_sql((select body from commands where name = '41'))), 1,
  'the same request arrives again');
select ok(pg_temp.b_waits_for_a(), 'the replay waits for the request in flight');
select is(extensions.dblink_exec('send_a', 'commit'), 'COMMIT', 'the request commits');
select is((select x.replayed from extensions.dblink_get_result('send_b') as x(replayed text)), 'true',
  'the replay returns the committed receipt');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'the replay is done');
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.fx(40)),
    (select count(*) from public.takeoff_send_receipts where job_id = pg_temp.fx(41)),
    (select count(*) from public.estimate_items where source_job_id = pg_temp.fx(41))$$,
  $$values (1::bigint, 1::bigint, 1::bigint)$$, 'one V1, one receipt, one line');

-- 5. Takeoffs 12 and 13 sent to V1 of affaire 1, both adding to its washbasin line, at the same time.
select is(extensions.dblink_exec('send_setup', 'reset role'), 'RESET', 'the fixture session locks the draft as the owner');
select is(extensions.dblink_exec('send_setup', format($lock$insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
  select %1$L, 'd2a00000-0000-4000-8000-000000000001', tenant_id, now() + interval '30 minutes', gen_random_uuid()
  from public.estimate_versions where id = %1$L$lock$, pg_temp.fx(601))), 'INSERT 0 1', 'the engineer holds V1''s draft lock');
create function pg_temp.to_line(p_request integer, p_job integer) returns text language sql as $$
  select pg_temp.command(p_request, p_job, jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.fx(601)),
    jsonb_build_object('kind', 'existing', 'id', pg_temp.fx(701)),
    (select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(p_job + 400), 'estimate_item_id', line.id,
      'expected_updated_at', line.updated_at, 'expected_quantity', line.quantity))
      from public.estimate_items line where line.version_id = pg_temp.fx(601) and line.item_type = 'line'), 1)
$$;
insert into commands values ('12-line', pg_temp.to_line(513, 12)), ('13-line', pg_temp.to_line(514, 13));
select is(extensions.dblink_exec('send_a', 'begin'), 'BEGIN', 'takeoff 12''s send starts');
select is((select x.replayed from extensions.dblink('send_a', pg_temp.send_sql((select body from commands where name = '12-line')))
  as x(replayed text)), 'false', 'takeoff 12 adds its 2 to the 3, not yet committed');
select is(extensions.dblink_send_query('send_b', pg_temp.send_sql((select body from commands where name = '13-line'))), 1,
  'takeoff 13''s send, previewed on the 3, is confirmed');
select ok(pg_temp.b_waits_for_a(), 'takeoff 13 waits for takeoff 12, on the draft');
select is(extensions.dblink_exec('send_a', 'commit'), 'COMMIT', 'takeoff 12 commits');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0,
  'takeoff 13 writes nothing');
select ok(extensions.dblink_error_message('send_b') like '%TAKEOFF_SEND_PREVIEW_STALE%',
  'takeoff 13 is asked to preview again: the line it was to add to changed');
select is((select count(*)::integer from extensions.dblink_get_result('send_b', false) as x(replayed text)), 0, 'takeoff 13 is done');
select is((select trim_scale(quantity) from public.estimate_items where version_id = pg_temp.fx(601) and item_type = 'line'),
  5::numeric, 'the line holds 3 + 2');
update commands set body = pg_temp.to_line(515, 13) where name = '13-line';
select is((select x.replayed from extensions.dblink('send_b', pg_temp.send_sql((select body from commands where name = '13-line')))
  as x(replayed text)), 'false', 'previewed again, takeoff 13 is sent');
select results_eq($$select trim_scale(quantity), (select count(*) from public.estimate_items where version_id = pg_temp.fx(601)
    and item_type = 'line') from public.estimate_items where version_id = pg_temp.fx(601) and item_type = 'line'$$,
  $$values (6::numeric, 1::bigint)$$, 'three sends feed one line of six');

-- Clean the committed synthetic fixtures of this disposable database, as takeoff-page-once-race.test.sql does.
select is(extensions.dblink_exec('send_setup', 'reset role'), 'RESET', 'the fixture session cleans as the owner');
select is(extensions.dblink_exec('send_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid := (select tenant_id from public.tenant_memberships
    where user_id = 'd2a00000-0000-4000-8000-000000000001' and is_default);
  entry record;
begin
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
end
$clean$;
delete from public.profiles where id = 'd2a00000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd2a00000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id::text like 'd2a00000-%'), 0, 'no fixture job is left');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('send_setup'), ('send_a'), ('send_b'), ('send_stage')) as session(name);
select * from finish();
rollback;
