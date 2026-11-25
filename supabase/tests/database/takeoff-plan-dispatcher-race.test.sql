-- Lot 3, migration A (20261121231238_takeoff_plan_dispatcher.sql): one analysis per plan across sessions.
-- 1. Two processes of one Mac claim two units at the same time: the second waits for the Mac's lock, then finds the Mac
--    busy and starts nothing. One plan is read at a time.
-- 2. The end of a unit and the cancellation of the last one at the same time: the second waits for the request's row,
--    then closes the request; one notice.
-- 3. A member's stop while the worker ends a unit: the stop waits for that unit's row, then cancels the rest; the read
--    plan stays read, and nobody waits for the other (the jobs, then the request, for both).
-- 4. A worker's reservation while the stop holds the request's units: it waits, then is refused (its unit is
--    cancelled): no call is reserved after the stop.
-- 5. A worker renews its lease just before it lapses while another process of the Mac claims the next plan: the claim
--    waits for the renewal, then finds the Mac held again and starts nothing; one live lease on the Mac.
-- 6. Two units of one request reach for its last balance at once (a second process read one without the Mac): one call
--    is reserved, the unit that does not hold the Mac reserves none.
-- 7. With lot 2's activations on and one analysis per plan withdrawn, M3's orders (20261121020321): the hosted recovery
--    takes the tenant's admission lock, then closes an overdue retry outside any request, while a released worker's direct
--    claim (claim_local_takeoff_job) holds that retry's row and takes the same lock after its write. A third process holds
--    the affaire's command key, which the claim's restart guard (20261121193413) takes while it holds the row, so that the
--    recovery owns the tenant's lock before the claim reaches it. They deadlock, and PostgreSQL rolls one back whole: M3's
--    order, not this migration's (it is not changed here).
-- 8. One analysis per plan active again: a retry of an analysis outside any request, claimed through the Mac's slot, against
--    a command naming it (20261121193413's restart guard). The claim takes the Mac's lock, the job, the slot, then the
--    affaire's command key and its automatic request; the command takes the job (a key share), then the key. While a third
--    process holds the key, the claim waits for it holding the job and the slot, and the command waits for the job holding
--    nothing: no cycle. The command is answered with the analysis the claim started.
-- 9. A job outside one analysis per plan whose lease lapsed renews with its earlier clock while a plan takes the Mac: the
--    renewal waits for the slot's row, then finds the Mac taken and is refused; one live lease on the Mac.
-- 10. A stop on a request that has just closed, against a reread naming one of its jobs (the affaire's automatic request
--    held, then a key share on the job through the new request's foreign key): the stale stop answers at once and takes
--    no lock; a stop of a running request holds its jobs without excluding that key share. Neither deadlocks.
-- 11. A Mac's first slotted claim, its slot's row inserted and uncommitted, against the renewal with an earlier clock of a
--    job that never took the slot: the renewal waits for that row, then finds the Mac taken and is refused.
-- Isolation justified: these interleavings exist only across sessions, which no journey drives deterministically. Each
-- held transaction is stopped at a named point; the waits are bounded conditions. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5200000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_a and race_b are two processes of the server and its members.
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);

select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'plan-race-1@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5200000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5200000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Affaire par plan en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 4) as n
where m.user_id = 'd5200000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5200000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5200000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 4) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5200000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5200000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5200000-0000-4000-8000-000000000001' from generate_series(0, 4) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5200000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 4) as n join public.estimate_projects p on p.id = ('d5200000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5200000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, s.tenant_id, s.id, 'plan-' || k || '.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5200000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, 'plan-' || k || '.pdf'),
  'application/pdf', 8, 1
from generate_series(0, 4) as n cross join generate_series(1, 3) as k
join public.plan_sets s on s.id = ('d5200000-0000-4000-8000-0000000000' || (40 + n))::uuid;
-- Attach the first file to a dossier piece before preparing it. Both generations
-- below carry the same fictional content hash and name.
insert into public.affaire_intake_documents (id,upload_id,file_name,mime_type,upload_status,classification_status,
  document_kind,storage_path,size_bytes)
values ('d5200000-0000-4000-8000-000000000071','d5200000-0000-4000-8000-000000000030','plan-1.pdf',
  'application/pdf','uploaded','classified','plans','fixture/plan-race.pdf',8);
insert into storage.objects(bucket_id,name,metadata) values ('affaire-intake','fixture/plan-race.pdf','{"size":8}');
update public.plan_files f set metadata=jsonb_build_object('source','affaire-intake','intake_document_id',d.id,
  'intake_generation',d.plan_copy_generation,'intake_storage_path',d.storage_path)
  from public.affaire_intake_documents d where d.id='d5200000-0000-4000-8000-000000000071'
  and f.id='d5200000-0000-4000-8000-000000000101';
-- The activations last: the briefs, confirmed before them, reserved no automatic start (one that can still begin is taken
-- on from the affaire's zone and refuses a command, 20261121193413).
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'five affaires of three plans each, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
create function pg_temp.unit(project integer, ordinal integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * project + ordinal)
$$;
-- The member's confirmed preparation of the affaire's three plans: the snapshot its commands seal.
create function pg_temp.snapshot(project integer) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-21T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', p.id, 'document_name', p.file_name, 'kind', 'plan', 'active', true,
        'confirmed', true, 'plan_set_id', pg_temp.f(project + 20), 'file_path', p.file_path, 'page_count', p.page_count,
        'source_updated_at', p.updated_at, 'pages', '[]'::jsonb, 'content_hash', encode(sha256(convert_to(p.file_name, 'UTF8')), 'hex'))
        order by p.id) from public.plan_files p where p.plan_set_id = pg_temp.f(project + 20))))
$$;
-- The command of a request of the affaire's three plans (units in name order, which here is identifier order).
create function pg_temp.launch_sql(project integer, named boolean default true) returns text language sql stable as $$
  with plans as (
    select f.id, f.file_name, f.file_path, f.page_count, f.updated_at, row_number() over (order by f.file_name, f.id) as ordinal
    from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
  )
  select format($launch$select outcome from public.%I(%L, %L, %L, %L, 'initial', null, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1%s)$launch$,
    case when named then 'launch_manual_takeoff_plan_request' else 'launch_manual_takeoff_request' end,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(500 + project), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
        'pages', '[]'::jsonb, 'page_count', 1, 'vector_pages', 0, 'budget', jsonb_build_object('tokens', 133334, 'cost_cents', 834))
        order by p.ordinal) from plans p),
      'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'pages', '[]'::jsonb,
        'page_count', 1, 'content_sha256', encode(sha256(convert_to(p.file_name, 'UTF8')), 'hex')) order by p.ordinal) from plans p),
      'coverage', jsonb_build_object('plans_retained', 3, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(project),
    (select jsonb_agg(jsonb_build_object('id', pg_temp.unit(project, p.ordinal::integer), 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || p.id, 'source_file_name', p.file_name, 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host()) order by p.ordinal) from plans p),
    pg_temp.f(project + 20), case when named then format(', %L::uuid[]', (select array_agg(p.id) from plans p)) else '' end)
$$;
create function pg_temp.request(project integer) returns uuid language sql stable as $$
  -- The command's request.
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(project) and origin = 'manual'
$$;
create function pg_temp.claim_sql(job uuid, token integer) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    job, pg_temp.tenant(), pg_temp.host(), pg_temp.f(token))
$$;
create function pg_temp.claim_for_sql(job uuid, token integer, lease interval) returns text language sql stable as $$
  select format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L, clock_timestamp(), %L,
    clock_timestamp() + %L::interval, 'modele-fictif', 'fixture', 'pending', 0)$claim$,
    job, pg_temp.tenant(), pg_temp.host(), pg_temp.f(token), lease)
$$;
create function pg_temp.renew_sql(job uuid, token integer) returns text language sql stable as $$
  select format($renew$select public.renew_takeoff_processing_lease(%L, %L, %L, clock_timestamp(), clock_timestamp() + interval '30 minutes')$renew$,
    job, pg_temp.tenant(), pg_temp.f(token))
$$;
create function pg_temp.reserve_sql(job uuid, token integer, call text) returns text language sql immutable as $$
  select format($reserve$select outcome from public.reserve_takeoff_launch_call(%L, %L, %L, 'pdf', 30000)$reserve$,
    job, pg_temp.f(token), call)
$$;
create function pg_temp.stop_sql(project integer) returns text language sql stable as $$
  select format($stop$select outcome || ':' || request_state || ':' || canceled_units from public.stop_takeoff_launch_request(%L, %L, %L, %L)$stop$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.request(project))
$$;
create function pg_temp.complete_sql(job uuid) returns text language sql immutable as $$
  select format($complete$update public.takeoff_jobs set status = 'completed', completed_at = clock_timestamp()
    where id = %L and status = 'processing'$complete$, job)
$$;
create function pg_temp.cancel_sql(job uuid) returns text language sql immutable as $$
  select format($cancel$update public.takeoff_jobs set status = 'canceled', completed_at = clock_timestamp(), next_retry_at = null
    where id = %L and status in ('pending', 'processing')$cancel$, job)
$$;

select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values %s;
  commit;$prep$, string_agg(format('(%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L)', pg_temp.tenant(), pg_temp.f(project),
    pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), pg_temp.f(1), pg_temp.f(1)), ', '))
  from (values (20), (21), (22), (23), (24)) as affaire(project))), 'COMMIT', 'each affaire''s preparation is confirmed');
create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_a'), ('race_b')) as session(name);
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

-- A reclassification rotates the generation, leaving the file and the
-- confirmed preparation untouched. The manual command waits for that writer.
select is(extensions.dblink_exec('race_a','begin'), 'BEGIN', 'piece writer starts');
select is(extensions.dblink_exec('race_a',format('update public.affaire_intake_documents set classified_at=now() where id=%L',
  pg_temp.f(71))), 'UPDATE 1', 'writer reclassifies the same bytes');
select is(extensions.dblink_send_query('race_b',pg_temp.launch_sql(20)),1,'a first named command starts');
select ok(pg_temp.waits_for('race_b','race_a'),'admission waits for the change of generation');
select is(extensions.dblink_exec('race_a','commit'),'COMMIT','writer commits');
select throws_ok($$select * from extensions.dblink_get_result('race_b') as r(outcome text)$$,
  '40001','TAKEOFF_LAUNCH_PLAN_COPY_STALE','the named command refuses the previous generation');
select count(*) from extensions.dblink_get_result('race_b',false) as r(outcome text);
select throws_ok(pg_temp.launch_sql(20, false), '40001', 'TAKEOFF_LAUNCH_PLAN_COPY_STALE',
  'a command without named plans also refuses the stale copy in its preparation');
select is((select count(*) from private.takeoff_launch_commands where project_id=pg_temp.f(20)),
  0::bigint,'neither refusal consumes an intent key');
select is(pg_temp.request(20),null::uuid,'no request survives the refusal');
select is((select count(*) from public.takeoff_jobs where project_id=pg_temp.f(20)),0::bigint,'no jobs survive');

-- Install the new generation under another identifier, then confirm the
-- preparation containing that copy. Keep the content and page count.
select is(extensions.dblink_exec('race_setup', format($new$
  begin;
  create temp table replacement as select f.*,d.plan_copy_generation from public.plan_files f
    join public.affaire_intake_documents d on d.id=%L where f.id=%L;
  do $rotate$ begin perform public.delete_stale_intake_plan_file(%L); end $rotate$;
  delete from public.plan_files where id=%L;
  insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count,metadata)
  select %L,tenant_id,plan_set_id,file_name,replace(file_path,id::text,%L),file_type,file_size_bytes,page_count,
    metadata || jsonb_build_object('intake_generation',plan_copy_generation) from replacement;
  commit;$new$, pg_temp.f(71),pg_temp.f(101),pg_temp.f(101),pg_temp.f(101),pg_temp.f(104),pg_temp.f(104))),
  'COMMIT','install the current copy with identical bytes');
select is(extensions.dblink_exec('race_setup',format($prep$begin;
  set local session_replication_role=replica;
  update public.takeoff_preparations set draft=%L,confirmed_snapshot=%L where project_id=%L;
  commit;$prep$,pg_temp.snapshot(20)->'preparation',pg_temp.snapshot(20),pg_temp.f(20))),
  'COMMIT','the member confirms the current copies');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('a request of three plans on affaire %s', project)) from (values (20), (21), (22), (23), (24)) as affaire(project);

select is(extensions.dblink_exec('race_setup',format('update public.affaire_intake_documents set classified_at=clock_timestamp() where id=%L',
  pg_temp.f(71))), 'UPDATE 1', 'rotate once more after admission');
select is((select r.outcome from extensions.dblink('race_setup',pg_temp.launch_sql(20)) as r(outcome text)),
  'replayed','a repeated command returns its receipt even after another rotation');

-- 1. Two processes of the Mac claim two units at the same time.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a first process starts its claim');
select is((select x.claimed from extensions.dblink('race_a', pg_temp.claim_sql(pg_temp.unit(20, 1), 901)) as x(claimed bigint)), 1::bigint,
  'it claims the first unit and takes the Mac, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.claim_sql(pg_temp.unit(20, 2), 902)), 1, 'a second process claims the second unit');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the second claim waits for the Mac''s lock');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the first claim commits');
select ok(pg_temp.answered('race_b'), 'the second claim answers');
select is((select x.claimed from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0::bigint,
  'the second process starts nothing: the Mac is busy');
select diag(concat('second claim: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0, 'and is done');
select results_eq($$select id, status::text from public.takeoff_jobs where launch_request_id = pg_temp.request(20) order by id$$,
  $$values (pg_temp.unit(20, 1), 'processing'::text), (pg_temp.unit(20, 2), 'pending'::text), (pg_temp.unit(20, 3), 'pending'::text)$$,
  'one plan is read at a time');

-- 2. The end of a unit and the cancellation of the last one at the same time: one closure, one notice.
select is(extensions.dblink_exec('race_setup', pg_temp.complete_sql(pg_temp.unit(20, 1))), 'UPDATE 1', 'the first plan is read');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(20, 2), 903)) as x(claimed bigint)),
  1::bigint, 'the second plan takes the Mac');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the worker ends the second plan');
select is(extensions.dblink_exec('race_a', pg_temp.complete_sql(pg_temp.unit(20, 2))), 'UPDATE 1', 'its end is written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.cancel_sql(pg_temp.unit(20, 3))), 1, 'a member cancels the third plan meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the cancellation waits for the request''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the end commits');
select ok(pg_temp.answered('race_b'), 'the cancellation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(status text)), 1, 'with its command status');
select diag(concat('cancellation: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(status text)), 0, 'and is done');
select results_eq($$select state, outcome, units_succeeded, units_canceled from public.takeoff_launch_requests where id = pg_temp.request(20)$$,
  $$values ('closed'::text, 'partial'::text, 2, 1)$$, 'the request is closed once: two plans read, one cancelled');
select is((select count(*)::integer from public.takeoff_completion_notifications where request_id = pg_temp.request(20)), 1,
  'with one notice');

-- 3. A member's stop while the worker ends a unit.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(21, 1), 911)) as x(claimed bigint)),
  1::bigint, 'the first plan of the second request is read');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the worker ends it');
select is(extensions.dblink_exec('race_a', pg_temp.complete_sql(pg_temp.unit(21, 1))), 'UPDATE 1', 'its end is written, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.stop_sql(21)), 1, 'the operator stops the rest of the request meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the stop waits for that unit''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the end commits');
select ok(pg_temp.answered('race_b'), 'the stop answers');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'stopped:closed:2',
  'it cancels the two plans not read');
select diag(concat('stop: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select results_eq($$select outcome, units_succeeded, units_canceled, reason_code from public.takeoff_launch_requests
    where id = pg_temp.request(21)$$, $$values ('partial'::text, 1, 2, 'STOPPED_BY_MEMBER'::text)$$,
  'the plan read stays read; the request ends partial, stopped by a member');

-- 4. A worker's reservation while the stop holds the request's units.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(22, 1), 921)) as x(claimed bigint)),
  1::bigint, 'the first plan of the third request is read');
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the operator stops the request');
select is((select x.answer from extensions.dblink('race_b', pg_temp.stop_sql(22)) as x(answer text)), 'stopped:closed:3',
  'every unit is cancelled, not yet committed');
select is(extensions.dblink_send_query('race_a', pg_temp.reserve_sql(pg_temp.unit(22, 1), 921, 'call:1')), 1,
  'the worker reserves a call meanwhile');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'the reservation waits for the unit''s row');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the stop commits');
select ok(pg_temp.answered('race_a'), 'the reservation answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(outcome text)), 0, 'with no reservation');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED%',
  'it is refused: its unit was cancelled, nothing is sent');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(outcome text)), 0, 'and is done');
select is((select count(*)::integer from private.takeoff_launch_usage where request_id = pg_temp.request(22)), 0,
  'no call of the stopped request is in its ledger');
select results_eq($$select job_id, holder_token from private.takeoff_host_slots where host_id = pg_temp.host()$$,
  $$values (pg_temp.unit(22, 1), pg_temp.f(921))$$, 'the stopped reading holds the Mac until its worker ends');
select is((select x.released from extensions.dblink('race_setup', format('select public.release_takeoff_host_slot(%L, %L)',
  pg_temp.host(), pg_temp.f(921))) as x(released boolean)), true, 'its worker gives the Mac back');

-- 5. A renewal just before its lease lapses against another process's claim of the next plan.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_for_sql(pg_temp.unit(23, 1), 931, '2 seconds'))
  as x(claimed bigint)), 1::bigint, 'the first plan of the fourth request is read under a short lease');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'its worker renews its lease just before it lapses');
select ok((select x.renewed from extensions.dblink('race_a', pg_temp.renew_sql(pg_temp.unit(23, 1), 931)) as x(renewed boolean)),
  'the renewal is written, not yet committed');
select pg_catalog.pg_sleep(2.5);
select is(extensions.dblink_send_query('race_b', pg_temp.claim_sql(pg_temp.unit(23, 2), 932)), 1,
  'once the old lease lapsed, another process of the Mac claims the next plan');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the claim waits for the renewal');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the renewal commits');
select ok(pg_temp.answered('race_b'), 'the claim answers');
select is((select x.claimed from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0::bigint,
  'it finds the Mac held again and starts nothing');
select diag(concat('takeover: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(claimed bigint)), 0, 'and is done');
select results_eq($$select id, status::text from public.takeoff_jobs where launch_request_id = pg_temp.request(23) order by id$$,
  $$values (pg_temp.unit(23, 1), 'processing'::text), (pg_temp.unit(23, 2), 'pending'::text), (pg_temp.unit(23, 3), 'pending'::text)$$,
  'the renewed reading continues alone');
select is((select count(*)::integer from public.takeoff_jobs where execution_host_id = pg_temp.host() and status = 'processing'
  and processing_lease_expires_at > clock_timestamp()), 1, 'one live lease on the Mac');
select is(extensions.dblink_exec('race_setup', pg_temp.complete_sql(pg_temp.unit(23, 1))), 'UPDATE 1', 'and it ends');

-- 6. Two units of one request reach for its last balance at once.
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(24, 1), 941)) as x(claimed bigint)),
  1::bigint, 'the first plan of the fifth request is read');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.reserve_sql(pg_temp.unit(24, 1), 941, 'call:1')) as x(outcome text)),
  'reserved', 'its call is reserved');
select is((select count(*)::integer from extensions.dblink('race_setup', format($settle$select remaining_tokens
    from public.record_takeoff_launch_usage(%L, %L, 'call:1', 380000, 0)$settle$, pg_temp.unit(24, 1), pg_temp.f(941))) as x(remaining bigint)),
  1, 'and settled at 380 000 tokens: 20 000 are left to the request');
select is(extensions.dblink_exec('race_setup', pg_temp.complete_sql(pg_temp.unit(24, 1))), 'UPDATE 1', 'the first plan ends');
select is((select x.claimed from extensions.dblink('race_setup', pg_temp.claim_sql(pg_temp.unit(24, 2), 942)) as x(claimed bigint)),
  1::bigint, 'the second plan takes the Mac');
select is(extensions.dblink_exec('race_setup', format($force$begin; set local session_replication_role = replica;
  update public.takeoff_jobs set status = 'processing', started_at = clock_timestamp(), processing_lease_token = %L,
    processing_lease_expires_at = clock_timestamp() + interval '30 minutes' where id = %L; commit$force$,
  pg_temp.f(943), pg_temp.unit(24, 3))), 'COMMIT', 'a second process reads the third plan without the Mac (written past every check)');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the second plan reserves a call');
select is((select x.outcome from extensions.dblink('race_a', pg_temp.reserve_sql(pg_temp.unit(24, 2), 942, 'call:1')) as x(outcome text)),
  'reserved', 'on the request''s last balance, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.reserve_sql(pg_temp.unit(24, 3), 943, 'call:1')), 1,
  'the third plan reserves a call meanwhile');
select ok(pg_temp.answered('race_b'), 'it answers');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'with no reservation');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_LAUNCH_USAGE_LEASE_REQUIRED%',
  'refused: a unit that does not hold the Mac never pays');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the second plan''s reservation commits');
select is((select count(*)::integer from private.takeoff_launch_usage where request_id = pg_temp.request(24) and state = 'reserved'), 1,
  'one call is reserved on the last balance');

-- 7. One analysis per plan withdrawn (lot 2's activations on): the hosted recovery against a released worker's direct claim.
select is(extensions.dblink_exec('race_setup', 'begin; delete from private.takeoff_plan_dispatch_activation; commit'), 'COMMIT',
  'the owner withdraws one analysis per plan');
create function pg_temp.other_host() returns text language sql immutable as $$ select 'urn:uuid:d5200000-0000-4000-8000-000000000098' $$;
create function pg_temp.overdue() returns uuid language sql immutable as $$ select pg_temp.f(2102) $$;
-- The retry waits on another Mac, live and idle for longer than the pickup grace: the recovery closes it as not started.
select is(extensions.dblink_exec('race_setup', format($overdue$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
    execution_host_id, retry_count, next_retry_at, analysis_queued_at, created_at)
  values (%L, %L, %L, %L, 'C', 'failed', %L, 'chatgpt_local', %L, 0, clock_timestamp() - interval '20 minutes',
    now() - interval '1 hour', now() - interval '1 hour');
  insert into private.takeoff_local_host_activity (host_id, live_since, seen_at)
  values (%L, now() - interval '1 hour', clock_timestamp());
  commit;$overdue$, pg_temp.overdue(), pg_temp.tenant(), pg_temp.f(21), pg_temp.f(41), pg_temp.f(1), pg_temp.other_host(),
  pg_temp.other_host())), 'COMMIT', 'an overdue retry outside any request waits on another Mac');
insert into race_pids select 'race_setup', (select backend.pid from extensions.dblink('race_setup', 'select pg_backend_pid()') as backend(pid integer));
select is((select count(*)::integer from extensions.dblink('race_setup', format(
    'begin; select private.lock_takeoff_launch_commands(%L)', pg_temp.f(21))) as x(locked text)), 1,
  'a third process holds the affaire''s command key');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a released worker claims the retry directly');
select is(extensions.dblink_send_query('race_a', format($claim$select count(*) from public.claim_local_takeoff_job(%L, %L, %L,
    clock_timestamp(), %L, clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture')$claim$,
    pg_temp.overdue(), pg_temp.tenant(), pg_temp.other_host(), pg_temp.f(972))), 1, 'its claim is sent');
select ok(pg_temp.waits_for('race_a', 'race_setup'), 'the claim holds the retry''s row and waits for the command key');
select is(extensions.dblink_send_query('race_b', 'select count(*) from public.recover_stale_local_takeoff_jobs(now())'), 1,
  'the hosted recovery runs meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the recovery waits for that row to close the retry');
select ok(exists (select 1 from pg_locks l where l.pid = (select pid from race_pids where label = 'race_b')
    and l.locktype = 'advisory' and l.granted
    and l.classid::bigint = (hashtextextended('takeoff-admission:' || pg_temp.tenant()::text, 0) >> 32) & 4294967295
    and l.objid::bigint = hashtextextended('takeoff-admission:' || pg_temp.tenant()::text, 0) & 4294967295),
  'holding the tenant''s admission lock');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the third process lets the command key go');
select ok(pg_temp.answered('race_a'), 'the claim ends');
select ok(pg_temp.answered('race_b'), 'and so does the recovery');
create temp table m3_cycle as select
  (select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(claimed bigint)) as claim_rows,
  extensions.dblink_error_message('race_a') as claim_error;
update m3_cycle set claim_rows = claim_rows
  + (select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(claimed bigint));
alter table m3_cycle add column recovery_rows integer, add column recovery_error text;
update m3_cycle set recovery_rows = (select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(recovered bigint)),
  recovery_error = extensions.dblink_error_message('race_b');
update m3_cycle set recovery_rows = recovery_rows
  + (select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(recovered bigint));
select diag(format('claim: %s; recovery: %s', coalesce(nullif(split_part(claim_error, E'\n', 1), ''), 'OK'),
  coalesce(nullif(split_part(recovery_error, E'\n', 1), ''), 'OK'))) from m3_cycle;
select ok((claim_error like '%deadlock detected%') <> (recovery_error like '%deadlock detected%'), 'PostgreSQL rolls back one side whole')
from m3_cycle;
-- The claim's transaction ends as its caller ends it: committed when it won, rolled back when it was the victim.
select is(extensions.dblink_exec('race_a', case when claim_error like '%deadlock detected%' then 'rollback' else 'commit' end),
  case when claim_error like '%deadlock detected%' then 'ROLLBACK' else 'COMMIT' end, 'the claim''s transaction ends')
from m3_cycle;
-- Whichever side PostgreSQL rolls back, the winner's write stands, as it wrote it: the recovery's closure of the retry as
-- not started, or the claim's attempt under its own lease.
select ok(case when (select claim_error like '%deadlock detected%' from m3_cycle)
    then (select status::text = 'failed' and analysis_outcome::text = 'failure' and error_code = 'TAKEOFF_WORKER_NOT_STARTED'
      from public.takeoff_jobs where id = pg_temp.overdue())
    else (select status::text = 'processing' and analysis_outcome is null and processing_lease_token = pg_temp.f(972)
      and processing_lease_expires_at > clock_timestamp() from public.takeoff_jobs where id = pg_temp.overdue()) end,
  'and the winner''s write stands: the recovery''s closure as not started, or the claim''s attempt under its lease');

-- 8. A retry outside any request claimed through the slot, against a command naming it.
create function pg_temp.retry() returns uuid language sql immutable as $$ select pg_temp.f(2201) $$;
select is(extensions.dblink_exec('race_setup', format($retry$begin;
  insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
  set local session_replication_role = replica;
  -- The Mac idle: the leases of the cases above lapsed, its slot free.
  update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second'
  where execution_host_id = %1$L and status = 'processing';
  delete from private.takeoff_host_slots where host_id = %1$L;
  insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
    execution_host_id, retry_count, next_retry_at, analysis_queued_at, created_at)
  values (%2$L, %3$L, %4$L, %5$L, 'C', 'failed', %6$L, 'chatgpt_local', %1$L, 0, clock_timestamp() - interval '1 minute',
    now() - interval '1 hour', now() - interval '1 hour');
  commit;$retry$, pg_temp.host(), pg_temp.retry(), pg_temp.tenant(), pg_temp.f(22), pg_temp.f(42), pg_temp.f(1))), 'COMMIT',
  'affaire 22, whose request is closed, has a retry of an analysis launched outside any request');
select is((select count(*)::integer from extensions.dblink('race_setup', format(
    'begin; select private.lock_takeoff_launch_commands(%L)', pg_temp.f(22))) as x(locked text)), 1,
  'a third process holds the affaire''s command key');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the Mac claims the retry through its slot');
select is(extensions.dblink_send_query('race_a', format($claim$select count(*) from public.claim_observed_local_takeoff_job(%L, %L, %L,
    clock_timestamp(), %L, clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'failed', 0)$claim$,
    pg_temp.retry(), pg_temp.tenant(), pg_temp.host(), pg_temp.f(981))), 1, 'its claim is sent');
select ok(pg_temp.waits_for('race_a', 'race_setup'), 'the claim waits for the command key, holding the job and the slot');
select is(extensions.dblink_send_query('race_b', replace(replace(pg_temp.launch_sql(22), $$'initial', null$$,
    format('%L, %L', 'reread_plans', pg_temp.retry())), quote_literal(pg_temp.f(522)), quote_literal(pg_temp.f(622)))), 1,
  'a command naming the retry is sent meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the command waits for the job the claim holds, before the command key');
select is(extensions.dblink_exec('race_setup', 'commit'), 'COMMIT', 'the third process lets the key go');
select ok(pg_temp.answered('race_a'), 'the claim goes on');
select is((select x.claimed from extensions.dblink_get_result('race_a', false) as x(claimed bigint)), 1::bigint, 'and starts the retry');
select diag(concat('claim: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(claimed bigint)), 0, 'and is done');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the claim commits');
select ok(pg_temp.answered('race_b'), 'the command goes on');
select is((select x.outcome from extensions.dblink_get_result('race_b', false) as x(outcome text)), 'already_running',
  'and is answered with the analysis the claim started: neither deadlocked');
select diag(concat('command: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'and is done');
select results_eq($$select answer, request_id, job_id from private.takeoff_launch_commands where intent_key = pg_temp.f(622)$$,
  $$values ('already_running'::text, null::uuid, pg_temp.retry())$$, 'its receipt names that analysis and no request');

-- 9. The retry claimed in case 8 holds the Mac; its lease lapses (its worker's clock is behind), and a plan takes the Mac.
select is(extensions.dblink_exec('race_setup', format($lapse$begin;
  update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second' where id = %L;
  commit;$lapse$, pg_temp.retry())), 'COMMIT', 'the retry''s lease lapses');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'another process of the Mac claims a waiting plan');
select is((select x.claimed from extensions.dblink('race_a', pg_temp.claim_sql(pg_temp.unit(23, 3), 982)) as x(claimed bigint)), 1::bigint,
  'it takes the Mac with the plan');
select is(extensions.dblink_send_query('race_b', format($renew$select public.renew_takeoff_processing_lease(%L, %L, %L,
    clock_timestamp() - interval '1 hour', clock_timestamp() + interval '30 minutes')$renew$, pg_temp.retry(), pg_temp.tenant(),
    pg_temp.f(981))), 1, 'the retry''s worker renews meanwhile, with its earlier clock');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the renewal waits for the Mac''s slot');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the plan''s claim commits');
select ok(pg_temp.answered('race_b'), 'the renewal goes on');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(renewed boolean)), 0,
  'and is refused');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_HOST_SLOT_LOST%', 'as a lost Mac');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(renewed boolean)), 0, 'and is done');
select is((select count(*)::integer from public.takeoff_jobs where execution_host_id = pg_temp.host() and status = 'processing'
  and processing_lease_expires_at > clock_timestamp()), 1, 'one live lease on the Mac');

-- 10. A stop against a reread naming one of its request's jobs. The requests of affaires 22 (closed by case 4) and 24 (still
-- running) are the affaires' automatic starts here, which a reread holds before its new request names their job.
create function pg_temp.stop_of_sql(project integer, request uuid) returns text language sql stable as $$
  select format($stop$select outcome || ':' || request_state from public.stop_takeoff_launch_request(%L, %L, %L, %L)$stop$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), request)
$$;
create temp table stopped_requests as select project, pg_temp.request(project) as id from (values (22), (24)) as affaire(project);
select is(extensions.dblink_exec('race_setup', format($automatic$begin;
  set local session_replication_role = replica;
  update public.takeoff_launch_requests set origin = 'automatic', intent_key = id, command_digest = null where id in (%L, %L);
  commit;$automatic$, (select id from stopped_requests where project = 22), (select id from stopped_requests where project = 24))),
  'COMMIT', 'the two requests are their affaires'' automatic starts');
-- A stale stop: the request has just closed.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a reread of affaire 22 starts');
select is((select count(*)::integer from extensions.dblink('race_a', format(
    'select id from public.takeoff_launch_requests where id = %L for update', (select id from stopped_requests where project = 22)))
  as x(id uuid)), 1, 'it holds the affaire''s automatic request');
select is(extensions.dblink_send_query('race_b', pg_temp.stop_of_sql(22, (select id from stopped_requests where project = 22))), 1,
  'a member''s stop of that request arrives late');
select ok(pg_temp.answered('race_b'), 'the stale stop answers at once');
select is(extensions.dblink_send_query('race_a', format('select id from public.takeoff_jobs where id = %L for key share',
  pg_temp.unit(22, 1))), 1, 'the reread''s new request names one of its jobs');
select ok(pg_temp.answered('race_a'), 'and its key share is taken at once');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(id uuid)), 1, 'on that job');
select diag(concat('reread: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(id uuid)), 0, 'and is done');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'not_running:closed',
  'the request has ended: nothing to stop');
select diag(concat('stale stop: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');
select is(extensions.dblink_exec('race_a', 'rollback'), 'ROLLBACK', 'the reread ends');
-- A stop of a running request while a reread holds the affaire's automatic request: the stop holds the request's jobs and
-- waits for the request; the reread's key share on one of those jobs does not wait for the stop.
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a reread of affaire 24 starts');
select is((select count(*)::integer from extensions.dblink('race_a', format(
    'select id from public.takeoff_launch_requests where id = %L for update', (select id from stopped_requests where project = 24)))
  as x(id uuid)), 1, 'it holds the affaire''s automatic request');
select is(extensions.dblink_send_query('race_b', pg_temp.stop_of_sql(24, (select id from stopped_requests where project = 24))), 1,
  'a member stops the rest of that request meanwhile');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the stop waits for the request the reread holds');
select is(extensions.dblink_send_query('race_a', format('select id from public.takeoff_jobs where id = %L for key share',
  pg_temp.unit(24, 1))), 1, 'the reread''s new request names one of its jobs');
select ok(pg_temp.answered('race_a'), 'its key share does not wait for the stop');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(id uuid)), 1, 'on that job');
select diag(concat('reread: ', extensions.dblink_error_message('race_a')));
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(id uuid)), 0, 'and is done');
select is(extensions.dblink_exec('race_a', 'rollback'), 'ROLLBACK', 'the reread ends');
select ok(pg_temp.answered('race_b'), 'then the stop goes on');
select is((select x.answer from extensions.dblink_get_result('race_b', false) as x(answer text)), 'stopped:closed',
  'and stops the rest: neither deadlocked');
select diag(concat('stop: ', extensions.dblink_error_message('race_b')));
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(answer text)), 0, 'and is done');

-- 11. The Mac without a slot row yet: a job outside any request waits, another that never took the slot ran and its lease
-- lapsed (its worker's clock is behind).
select is(extensions.dblink_exec('race_setup', format($first$begin;
  delete from private.takeoff_host_slots where host_id = %1$L;
  set local session_replication_role = replica;
  update public.takeoff_jobs set processing_lease_expires_at = clock_timestamp() - interval '1 second'
  where execution_host_id = %1$L and status = 'processing';
  insert into public.takeoff_jobs (id, tenant_id, project_id, plan_set_id, level, status, created_by, execution_provider,
    execution_host_id, processing_lease_token, processing_lease_expires_at, started_at, created_at)
  values (%2$L, %4$L, %5$L, %6$L, 'C', 'pending', %7$L, 'chatgpt_local', %1$L, null, null, null, now()),
    (%3$L, %4$L, %5$L, %6$L, 'C', 'processing', %7$L, 'chatgpt_local', %1$L, %8$L, clock_timestamp() - interval '1 second',
      clock_timestamp() - interval '40 minutes', now() - interval '1 hour');
  commit;$first$, pg_temp.host(), pg_temp.f(2103), pg_temp.f(2104), pg_temp.tenant(), pg_temp.f(21), pg_temp.f(41), pg_temp.f(1),
  pg_temp.f(983))), 'COMMIT', 'the Mac has no slot row; a job waits, another ran without the slot');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'a process of the Mac claims the waiting job');
select is((select x.claimed from extensions.dblink('race_a', pg_temp.claim_sql(pg_temp.f(2103), 984)) as x(claimed bigint)), 1::bigint,
  'it inserts the Mac''s slot row and takes it, uncommitted');
select is(extensions.dblink_send_query('race_b', format($renew$select public.renew_takeoff_processing_lease(%L, %L, %L,
    clock_timestamp() - interval '1 hour', clock_timestamp() + interval '30 minutes')$renew$, pg_temp.f(2104), pg_temp.tenant(),
    pg_temp.f(983))), 1, 'the other job''s worker renews meanwhile, with its earlier clock');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the renewal waits for the Mac''s first slot row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the claim commits');
select ok(pg_temp.answered('race_b'), 'the renewal goes on');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(renewed boolean)), 0, 'and is refused');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_HOST_SLOT_LOST%', 'as a lost Mac');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(renewed boolean)), 0, 'and is done');
select is((select count(*)::integer from public.takeoff_jobs where execution_host_id = pg_temp.host() and status = 'processing'
  and processing_lease_expires_at > clock_timestamp()), 1, 'one live lease on the Mac');

select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5200000-0000-4000-8000-000000000001'
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
delete from storage.objects where bucket_id='affaire-intake' and name='fixture/plan-race.pdf';
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5200000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5200000-0000-4000-8000-000000000099';
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5200000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5200000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures, the Mac''s slot and the activations cleaned');
select is((select count(*)::integer from private.takeoff_plan_dispatch_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_a'), ('race_b')) as session(name);
select * from finish();
rollback;
