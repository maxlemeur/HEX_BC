-- Lot 3, migration C (…_takeoff_partial_send.sql): the send of one plan while the affaire's other plans are read, across
-- sessions. Each case holds the first transaction open at a named point, proves what the second one waits for (its
-- blocking process) or that it waits for nothing, lets the first one go, then reads what the second one did. Isolation
-- justified: two confirmations, an import and a worker's end interleave only across sessions, which no journey drives
-- deterministically. Each command is previewed first (its dry run) and confirmed with the outcome that preview showed.
-- 1. Plans A and B of one request both previewed a first draft; their confirmations cross: one V1, the second asked again
--    (the second link to the same first draft is never made from a stale preview).
-- 2. An import creates V1 while A's and B's first drafts are confirmed: both wait for it on the affaire, then both are
--    asked again on the real destination.
-- 3. B's reading ends while A's confirmation, previewed while B was read, is in flight: the send locks no other plan, so
--    B's end takes B's row; it waits for A on the affaire's send context (its lines are a peer's: fix round 1, point 1),
--    then is written once A commits. A commits on the context it checked (B not read yet): its receipt names no peer.
--    Each takes its job, then the context, then the request: no cycle.
-- 4. A's confirmation while B's end is in flight (uncommitted): A holds its job, then waits for B's end on the affaire's
--    send context (B's end holds it shared), then reads its context with B read and is refused (« peers_changed »),
--    nothing written. Red before the request's row was locked (first round): the send read its context at once (B not
--    read), and its second update of its job ran its foreign-key check on the request's row until B committed, a busy
--    backend with no lock wait, then sent A on a context B's end had changed. A sibling's end and a send never cross.
-- 5. B's end committed before A's confirmation reads its context: A is refused (« peers_changed »), nothing written.
-- 6.–8. (fix round 1, point 1) A location save, an edit of a peer's line, and a peer's end in another request, each in
--    flight when A's confirmation reads its context: the send waits for it, then refuses; a save while the send is in
--    flight waits for the send.
-- 9. (fix round 1, point 3) A reread naming A while A's send is in flight: it waits on A, holding nothing the send needs.
-- 10. (fix round 1, point 3) The same with A in the affaire's automatic request, closed, and the send holding A while it
--    waits for the context: the reread waits on A before it locks that request, the send then takes it: no deadlock.
-- Written before the migration: red on 2c5424215 (public.read_takeoff_send_context does not exist). All values are
-- fictional.
begin;
create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5c60000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5c60000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create temp table race_connection as select format('host=%s port=%s dbname=%s user=postgres password=postgres',
  trim(split_part(current_setting('unix_socket_directories'), ',', 1)), current_setting('port'), current_database()) as connection;
-- race_setup writes and commits the fixtures; race_stage stages commands as the server's service does; race_a, race_b and
-- race_c are the members' sessions (or the import's service, or the worker).
select is(extensions.dblink_connect(session.name, (select connection from race_connection)), 'OK', format('%s connected', session.name))
from (values ('race_setup'), ('race_stage'), ('race_a'), ('race_b'), ('race_c')) as session(name);

-- One engineer; affaires 20 to 27, each with three plans (A, B, C) of one plan set.
select is(extensions.dblink_exec('race_setup', $setup$
begin;
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values ('00000000-0000-0000-0000-000000000000', 'd5c60000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'partial-send-race@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');
update public.tenant_memberships set role = 'engineer' where user_id = 'd5c60000-0000-4000-8000-000000000001';
update public.feature_flags set enabled = true where flag_key = 'TAKEOFF_MODULE_ENABLED' and tenant_id = (select m.tenant_id
  from public.tenant_memberships m where m.user_id = 'd5c60000-0000-4000-8000-000000000001' and m.is_default);
insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select ('d5c60000-0000-4000-8000-0000000000' || (20 + n))::uuid, m.tenant_id, m.user_id, 'Envoi par plan en concurrence ' || n || ' (fictive)', false
from public.tenant_memberships m cross join generate_series(0, 7) as n
where m.user_id = 'd5c60000-0000-4000-8000-000000000001' and m.is_default;
insert into public.affaire_intake_uploads (id, project_id, created_by, status)
select ('d5c60000-0000-4000-8000-0000000000' || (30 + n))::uuid, ('d5c60000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  'd5c60000-0000-4000-8000-000000000001', 'ready' from generate_series(0, 7) as n;
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
select ('d5c60000-0000-4000-8000-0000000000' || (60 + n))::uuid, ('d5c60000-0000-4000-8000-0000000000' || (20 + n))::uuid,
  ('d5c60000-0000-4000-8000-0000000000' || (30 + n))::uuid, 'confirme', 'Résumé fictif', 'Objet fictif', now(),
  'd5c60000-0000-4000-8000-000000000001' from generate_series(0, 7) as n;
insert into public.plan_sets (id, tenant_id, project_id, name)
select ('d5c60000-0000-4000-8000-0000000000' || (40 + n))::uuid, p.tenant_id, p.id, 'Plans du dossier'
from generate_series(0, 7) as n join public.estimate_projects p on p.id = ('d5c60000-0000-4000-8000-0000000000' || (20 + n))::uuid;
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select ('d5c60000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, s.tenant_id, s.id, 'plan-' || chr(96 + k) || '.pdf',
  concat_ws('/', s.tenant_id, s.id, ('d5c60000-0000-4000-8000-000000000' || (100 + 10 * n + k))::uuid, 'plan-' || chr(96 + k) || '.pdf'),
  'application/pdf', 8, 1
from generate_series(0, 7) as n cross join generate_series(1, 3) as k
join public.plan_sets s on s.id = ('d5c60000-0000-4000-8000-0000000000' || (40 + n))::uuid;
-- The import of affaire 21's DPGF, finished and not yet linked to an affaire.
insert into public.dpgf_imports (id, tenant_id, user_id, filename, source_format, status, row_count, parse_mode)
select 'd5c60000-0000-4000-8000-000000000071', m.tenant_id, m.user_id, 'dpgf-fictif.csv', 'csv', 'completed', 0, 'server'
from public.tenant_memberships m where m.user_id = 'd5c60000-0000-4000-8000-000000000001' and m.is_default;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 hour');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 hour');
commit;
$setup$), 'COMMIT', 'eight affaires of three plans each, with the activations');

create function pg_temp.tenant() returns uuid language sql stable as $$
  select tenant_id from public.estimate_projects where id = pg_temp.f(20)
$$;
-- The job of plan k (1 A, 2 B, 3 C) of affaire `project`.
create function pg_temp.unit(project integer, k integer) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * project + k)
$$;
create function pg_temp.snapshot(project integer) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', p.id, 'document_name', p.file_name, 'kind', 'plan', 'active', true,
        'confirmed', true, 'plan_set_id', pg_temp.f(project + 20), 'file_path', p.file_path, 'page_count', p.page_count,
        'source_updated_at', p.updated_at, 'pages', '[]'::jsonb, 'content_hash', encode(sha256(convert_to(p.id::text, 'UTF8')), 'hex'))
        order by p.id) from public.plan_files p where p.plan_set_id = pg_temp.f(project + 20))))
$$;
-- A command of one analysis per plan of the affaire: its first (`p_predecessor` null), or a reread of its three plans
-- naming the analysis it replaces, with its own key and job identifiers.
create function pg_temp.launch_sql(project integer, p_predecessor uuid default null, p_key integer default null,
  p_jobs integer default null) returns text language sql stable as $$
  with plans as (
    select f.id, f.file_name, row_number() over (order by f.file_name, f.id) as ordinal
    from public.plan_files f where f.plan_set_id = pg_temp.f(project + 20)
  )
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, %L, %L, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$,
    pg_temp.tenant(), pg_temp.f(project), pg_temp.f(1), pg_temp.f(coalesce(p_key, 500 + project)),
    case when p_predecessor is null then 'initial' else 'reread_plans' end, p_predecessor, pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'intent', 'initial',
      'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
      'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
      'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
        'pages', '[]'::jsonb, 'page_count', 1, 'vector_pages', 0, 'budget', jsonb_build_object('tokens', 133334, 'cost_cents', 834))
        order by p.ordinal) from plans p),
      'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'pages', '[]'::jsonb,
        'page_count', 1, 'content_sha256', encode(sha256(convert_to(p.id::text, 'UTF8')), 'hex')) order by p.ordinal) from plans p),
      'coverage', jsonb_build_object('plans_retained', 3, 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
      'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)),
    pg_temp.snapshot(project),
    (select jsonb_agg(jsonb_build_object('id', case when p_jobs is null then pg_temp.unit(project, p.ordinal::integer)
        else pg_temp.f(p_jobs + p.ordinal::integer) end, 'plan_set_id', pg_temp.f(project + 20),
      'launch_unit_key', 'plan:' || p.id, 'source_file_name', p.file_name, 'source_file_type', 'application/pdf',
      'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host()) order by p.ordinal) from plans p),
    pg_temp.f(project + 20), (select array_agg(p.id) from plans p))
$$;
select is(extensions.dblink_exec('race_setup', (select format($prep$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
    updated_by) values %s;
  commit;$prep$, string_agg(format('(%L, %L, 1, %L::jsonb, %L::jsonb, now(), %L, %L)', pg_temp.tenant(), pg_temp.f(project),
    pg_temp.snapshot(project) -> 'preparation', pg_temp.snapshot(project), pg_temp.f(1), pg_temp.f(1)), ', '))
  from generate_series(20, 27) as project)), 'COMMIT', 'each affaire''s preparation confirmed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('affaire %s: a request of three plans, one analysis per plan', project))
from generate_series(20, 23) as project;


-- A plan read (committed): its reading ended with one valve line on its page 1.
create function pg_temp.read_sql(p_job uuid, p_quantity integer) returns text language sql immutable as $$
  select format($read$begin;
    set local session_replication_role = replica;
    update public.takeoff_jobs set status = 'completed', started_at = now() - interval '1 minute', completed_at = now(),
      analysis_outcome = 'success', analysis_finished_at = now() where id = %1$L;
    set local session_replication_role = origin;
    insert into public.takeoff_results (id, tenant_id, job_id) select gen_random_uuid(), tenant_id, id from public.takeoff_jobs where id = %1$L;
    insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
      source_page, confidence, metadata)
    select gen_random_uuid(), j.tenant_id, j.id, r.id, 'Vanne d''arrêt DN20', %2$s, 'u', 'Repère fictif', f.file_name, 1, 0.95,
      jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', f.id))
    from public.takeoff_jobs j join public.takeoff_results r on r.job_id = j.id
    join public.plan_files f on 'plan:' || f.id = j.launch_unit_key where j.id = %1$L;
    commit;$read$, p_job, p_quantity)
$$;
-- A plan being read: claimed by the Mac (a lease the worker's end checks), without the claim's triggers.
create function pg_temp.reading_sql(p_job uuid, p_token integer) returns text language sql immutable as $$
  select format($claimed$begin;
    set local session_replication_role = replica;
    update public.takeoff_jobs set status = 'processing', started_at = now(), processing_lease_token = %2$L,
      processing_lease_expires_at = now() + interval '30 minutes' where id = %1$L;
    commit;$claimed$, p_job, pg_temp.f(p_token))
$$;
-- The worker's end of that reading (finalize_local_takeoff_result under its lease), one valve line of `p_quantity`.
create function pg_temp.end_sql(p_job uuid, p_token integer, p_quantity integer) returns text language sql stable as $$
  select format($end$select public.finalize_local_takeoff_result(%1$L, %2$L, %3$L, clock_timestamp(), 'modele-fictif', 'fixture',
    '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {}, "confidence": 0.95, "token_count": 1000,
      "cost_cents": 0, "duration_ms": 10}'::jsonb, %4$L::jsonb) is not null$end$, p_job, pg_temp.tenant(), pg_temp.f(p_token),
    jsonb_build_array(jsonb_build_object('designation', 'Vanne d''arrêt DN20', 'quantity', p_quantity, 'unit', 'u', 'confidence', 0.95,
      'evidence', 'Repère fictif', 'source_file_name', 'plan-b.pdf', 'source_page', 1,
      'metadata', jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id',
        (select f.id from public.takeoff_jobs j join public.plan_files f on 'plan:' || f.id = j.launch_unit_key where j.id = p_job))))))
$$;

-- Affaires 20, 21: A and B read. Affaires 22, 23: A read, B being read.
select is(extensions.dblink_exec('race_setup', pg_temp.read_sql(pg_temp.unit(project, k), 4 - k)), 'COMMIT',
  format('affaire %s: plan %s read', project, k))
from (values (20, 1), (20, 2), (21, 1), (21, 2), (22, 1), (23, 1)) as read(project, k);
select is(extensions.dblink_exec('race_setup', pg_temp.reading_sql(pg_temp.unit(project, 2), 900 + project)), 'COMMIT',
  format('affaire %s: plan B being read', project))
from generate_series(22, 23) as project;
-- The member's admission limit counts the requests with a job at work (six): those of affaires 20 and 21, read and whose
-- plan C no case reads, are closed (their C cancelled, without their triggers) before the next ones are admitted.
select is(extensions.dblink_exec('race_setup', format($close$begin;
  set local session_replication_role = replica;
  update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now()
  where id in (%1$L, %2$L);
  update public.takeoff_launch_requests set state = 'closed', outcome = 'partial', closed_at = now(), completion_event_id = gen_random_uuid(),
    units_canceled = 1 where project_id in (%3$L, %4$L);
  commit;$close$, pg_temp.unit(20, 3), pg_temp.unit(21, 3), pg_temp.f(20), pg_temp.f(21))), 'COMMIT', 'affaires 20 and 21: requests closed');
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(project)) as x(outcome text)), 'admitted',
  format('affaire %s: a request of three plans, one analysis per plan', project))
from generate_series(24, 26) as project;
-- Affaires 24, 25: A and B read. Affaire 26: A read.
select is(extensions.dblink_exec('race_setup', pg_temp.read_sql(pg_temp.unit(project, k), 4 - k)), 'COMMIT',
  format('affaire %s: plan %s read', project, k))
from (values (24, 1), (24, 2), (25, 1), (25, 2), (26, 1)) as read(project, k);

-- Each session acts as the engineer: its role and its claims (race_stage stays the database owner, as the service).
create function pg_temp.act_as(p_session text) returns text language sql as $$
  select claims.sub from extensions.dblink(p_session, format($claims$select set_config('request.jwt.claims',
    %L, false), set_config('request.jwt.claim.sub', %L, false)$claims$,
    jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(1))::text, pg_temp.f(1))) as claims(full_claims text, sub text)
$$;
select is(extensions.dblink_exec(session.name, 'set role authenticated'), 'SET', format('%s acts as the engineer', session.name))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);
select is(pg_temp.act_as(session.name), pg_temp.f(1)::text, format('%s carries the engineer''s claims', session.name))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);

-- The command as send-server.ts builds it after its preview, from the committed state: the context's stamps as the
-- database computed them for a first draft.
create function pg_temp.command(p_request integer, p_job uuid, p_version integer, p_section integer, p_draft uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object('format_version', 2, 'mode', 'dry_run', 'request_id', pg_temp.f(p_request), 'job_id', j.id,
    'fingerprint', repeat('d', 64),
    'destination', case when p_draft is not null then jsonb_build_object('kind', 'existing_draft', 'version_id', p_draft)
      else jsonb_build_object('kind', 'first_draft', 'version_payload', jsonb_build_object(
      'id', pg_temp.f(p_version), 'title', null, 'date_devis', '2026-11-22', 'validite_jours', 30, 'margin_multiplier', 1,
      'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
      'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
      'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
      'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
      'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)) end,
    'section', jsonb_build_object('kind', 'new', 'id', pg_temp.f(p_section), 'title', 'Métré fictif'),
    'client', jsonb_build_object('fingerprint', repeat('d', 64), 'destination', case when p_draft is not null
        then jsonb_build_object('kind', 'existing_draft', 'version_id', p_draft) else jsonb_build_object('kind', 'first_draft') end,
      'section', jsonb_build_object('kind', 'new', 'title', 'Métré fictif'), 'page_decisions', '[]'::jsonb, 'override', false),
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case when p_draft is not null then public.takeoff_send_peers_stamp(j.tenant_id, p_draft) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id),
      'context', public.read_takeoff_send_context(j.tenant_id, j.project_id, j.id, p_draft) -> 'stamps'),
    'mapping_plan', (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', 0, 'rule_id', null, 'action', 'none',
      'designation', i.designation, 'unit_price_cents', null, 'category_id', null, 'assembly_id', null))
      from public.takeoff_items i where i.job_id = j.id),
    'page_decisions', '[]'::jsonb, 'rule_results', '[]'::jsonb, 'rule_transforms', '[]'::jsonb, 'accumulations', '[]'::jsonb,
    'override', null, 'price_rules_ignored', '[]'::jsonb, 'expected_outcome', null)
  from public.takeoff_jobs j where j.id = p_job
$$;
create function pg_temp.request(p_command jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('request_id', p_command -> 'request_id', 'job_id', p_command -> 'job_id', 'fingerprint', p_command -> 'fingerprint')
$$;
create function pg_temp.stage(p_command jsonb) returns void language sql as $$
  select null::void from extensions.dblink('race_stage', format('select public.stage_takeoff_send(%L, %L::jsonb)::text',
    pg_temp.f(1), p_command)) as staged(result text);
$$;
-- The preview (its dry run, in session C), then the command confirmed with the outcome it showed.
create function pg_temp.confirmed(p_command jsonb) returns jsonb language plpgsql as $$
declare
  previewed jsonb := p_command || jsonb_build_object('request_id', gen_random_uuid());
  shown text;
begin
  perform pg_temp.stage(previewed);
  select preview.outcome into shown from extensions.dblink('race_c', format(
    'select (public.send_takeoff_job(%L::jsonb) -> ''outcome'')::text', pg_temp.request(previewed))) as preview(outcome text);
  if shown is null then raise exception 'the preview of % showed no outcome', p_command ->> 'job_id'; end if;
  return p_command || jsonb_build_object('mode', 'send', 'expected_outcome', shown::jsonb);
end;
$$;
create function pg_temp.send_sql(p_command jsonb) returns text language plpgsql as $$
begin
  perform pg_temp.stage(p_command);
  return format('select (public.send_takeoff_job(%L::jsonb) ->> ''replayed'')', pg_temp.request(p_command));
end;
$$;

create temp table race_pids(label text primary key, pid integer);
insert into race_pids
select session.name, (select backend.pid from extensions.dblink(session.name, 'select pg_backend_pid()') as backend(pid integer))
from (values ('race_a'), ('race_b'), ('race_c')) as session(name);
-- Waits until one session is blocked by another (a condition, bounded), and says whether it is.
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
-- Whether a session sent a query that has answered (bounded wait): it waited for nothing it could not get. Otherwise the
-- lock it waits for is said, and its query cancelled, so that the file fails instead of waiting for ever.
create function pg_temp.answered(p_session text) returns boolean language plpgsql as $$
declare
  waiting integer := (select pid from race_pids where label = p_session);
begin
  for attempt in 1..400 loop
    if extensions.dblink_is_busy(p_session) = 0 then return true; end if;
    perform pg_catalog.pg_sleep(0.025);
  end loop;
  raise warning '% still waits: %', p_session, (select string_agg(format('%s %s %s (held by %s)', lock_row.locktype, lock_row.mode,
      coalesce(lock_row.relation::regclass::text, lock_row.transactionid::text, lock_row.objid::text, ''),
      pg_catalog.pg_blocking_pids(waiting)), '; ')
    from pg_catalog.pg_locks as lock_row where lock_row.pid = waiting and not lock_row.granted);
  perform extensions.dblink_cancel_query(p_session);
  return false;
end;
$$;
create function pg_temp.versions(p_project integer) returns bigint language sql as $$
  select count(*) from public.estimate_versions where project_id = pg_temp.f(p_project)
$$;
create temp table commands (name text primary key, body jsonb);

-- 1. Affaire 20: A and B both previewed a first draft; their confirmations cross.
insert into commands values
  ('20A', pg_temp.confirmed(pg_temp.command(611, pg_temp.unit(20, 1), 711, 811))),
  ('20B', pg_temp.confirmed(pg_temp.command(612, pg_temp.unit(20, 2), 712, 812)));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'A''s confirmation starts');
select is((select x.replayed from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '20A')))
  as x(replayed text)), 'false', 'A creates V1 and is sent, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql((select body from commands where name = '20B'))), 1,
  'B''s confirmation is sent');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'B waits for A, on the affaire');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'A commits');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(replayed text)), 0, 'B writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_SEND_PREVIEW_STALE%destination_changed%',
  'B is asked to confirm again on the real destination: no second link to a first draft from a stale preview');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(replayed text)), 0, 'B is done');
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.f(20)),
    (select count(*) from public.takeoff_jobs where project_id = pg_temp.f(20) and estimate_version_id is not null),
    (select count(*) from private.takeoff_plan_send_checks)$$,
  $$values (1::bigint, 1::bigint, 0::bigint)$$, 'one V1, A alone on it, no check left behind');

-- 2. Affaire 21: an import creates V1 (holding its import row and the affaire) while A's and B's first drafts are confirmed.
insert into commands values
  ('21A', pg_temp.confirmed(pg_temp.command(621, pg_temp.unit(21, 1), 721, 821))),
  ('21B', pg_temp.confirmed(pg_temp.command(622, pg_temp.unit(21, 2), 722, 822)));
select is(extensions.dblink_exec('race_a', 'reset role'), 'RESET', 'session A acts as the import''s service');
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'the import starts');
select is(extensions.dblink_exec('race_a', 'set local role service_role'), 'SET', 'as the service role');
select is((select x.created from extensions.dblink('race_a', format($import$select (public.persist_estimate_creation_atomic(
    %1$L, 'd5c60000-0000-4000-8000-000000000001', %2$L, null, (%3$L::jsonb -> 'version_payload'), '[]'::jsonb, %4$L)
    #>> '{version,id}')$import$, pg_temp.tenant(), pg_temp.f(21),
    (select body -> 'destination' from commands where name = '21A') || jsonb_build_object('version_payload',
      ((select body #> '{destination,version_payload}' from commands where name = '21A') || jsonb_build_object('id', pg_temp.f(720)))),
    pg_temp.f(71))) as x(created text)), pg_temp.f(720)::text, 'the import creates V1 from its import row, not yet committed');
select is(extensions.dblink_send_query('race_b', pg_temp.send_sql((select body from commands where name = '21A'))), 1,
  'A''s first draft is confirmed');
select is(extensions.dblink_send_query('race_c', pg_temp.send_sql((select body from commands where name = '21B'))), 1,
  'B''s first draft is confirmed');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'A''s send waits for the import, on the affaire');
select ok(pg_temp.waits_for('race_c', 'race_a') or pg_temp.waits_for('race_c', 'race_b'), 'and so does B''s');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'the import commits');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(replayed text)), 0, 'A writes nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_SEND_PREVIEW_STALE%destination_changed%',
  'A is asked again on the version the import created');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(replayed text)), 0, 'A is done');
select is((select count(*)::integer from extensions.dblink_get_result('race_c', false) as x(replayed text)), 0, 'B writes nothing');
select ok(extensions.dblink_error_message('race_c') like '%TAKEOFF_SEND_PREVIEW_STALE%destination_changed%',
  'B is asked again on the version the import created');
select is((select count(*)::integer from extensions.dblink_get_result('race_c', false) as x(replayed text)), 0, 'B is done');
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.f(21)),
    (select count(*) from public.takeoff_jobs where project_id = pg_temp.f(21) and estimate_version_id is not null),
    (select project_id from public.dpgf_imports where id = pg_temp.f(71))$$,
  $$values (1::bigint, 0::bigint, pg_temp.f(21))$$, 'the affaire has the import''s V1 only, no plan on it');
select is(extensions.dblink_exec('race_a', 'set role authenticated'), 'SET', 'session A acts as the engineer again');

-- 3. Affaire 22: A previewed while B is read; A's confirmation in flight; B's reading ends meanwhile.
insert into commands values ('22A', pg_temp.confirmed(pg_temp.command(631, pg_temp.unit(22, 1), 731, 831)));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'A''s confirmation starts');
select is((select x.replayed from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '22A')))
  as x(replayed text)), 'false', 'A is sent on the context it checked (B not read), not yet committed');
select is(extensions.dblink_exec('race_b', 'reset role'), 'RESET', 'session B acts as the worker');
select is(extensions.dblink_send_query('race_b', pg_temp.end_sql(pg_temp.unit(22, 2), 922, 2)), 1, 'B''s reading ends');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'B''s end waits for A''s send');
select is((select pg_catalog.string_agg(lock_row.locktype, ',') from pg_catalog.pg_locks as lock_row join race_pids on race_pids.pid = lock_row.pid
  where race_pids.label = 'race_b' and not lock_row.granted), 'advisory',
  'what B''s end waits for is the affaire''s send context (its lines are a peer''s), not a plan''s row');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'A commits');
select ok(pg_temp.answered('race_b'), 'B''s end goes on');
select is((select x.ended from extensions.dblink_get_result('race_b') as x(ended boolean)), true, 'B''s end is written');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(ended boolean)), 0, 'and done');
select results_eq($$select (select status::text from public.takeoff_jobs where id = pg_temp.unit(22, 2)),
    (select estimate_version_id from public.takeoff_jobs where id = pg_temp.unit(22, 1)),
    (select write_plan #> '{context,peers}' from public.takeoff_send_receipts where job_id = pg_temp.unit(22, 1))$$,
  $$values ('completed'::text, pg_temp.f(731), '[]'::jsonb)$$,
  'B is read, A is on its first draft, and A''s receipt names the context it checked: no plan read beside it');

-- 4. Affaire 23: B's end in flight (uncommitted) while A is confirmed.
insert into commands values ('23A', pg_temp.confirmed(pg_temp.command(641, pg_temp.unit(23, 1), 741, 841)));
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the worker''s end of B starts');
select is((select x.ended from extensions.dblink('race_b', pg_temp.end_sql(pg_temp.unit(23, 2), 923, 2)) as x(ended boolean)), true,
  'B''s end is written, not yet committed');
select is(extensions.dblink_send_query('race_a', pg_temp.send_sql((select body from commands where name = '23A'))), 1,
  'A is confirmed');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'A''s send waits for B''s end before it reads its context');
select is((select pg_catalog.string_agg(lock_row.locktype, ',') from pg_catalog.pg_locks as lock_row join race_pids on race_pids.pid = lock_row.pid
  where race_pids.label = 'race_a' and not lock_row.granted), 'advisory',
  'a wait for a lock (the affaire''s send context, which B''s end holds), never a check that runs until the other commits');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'B''s end commits');
select ok(pg_temp.answered('race_a'), 'A''s send goes on');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A writes nothing');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_SEND_PREVIEW_STALE%peers_changed%',
  'A is asked again: B was read before A read its context');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A is done');
select results_eq($$select (select status::text from public.takeoff_jobs where id = pg_temp.unit(23, 2)),
    (select count(*) from public.estimate_versions where project_id = pg_temp.f(23)),
    (select estimate_version_id from public.takeoff_jobs where id = pg_temp.unit(23, 1))$$,
  $$values ('completed'::text, 0::bigint, null::uuid)$$, 'B is read; no version, A still to send');
-- Previewed again, with B among the plans it is compared with, A is sent.
insert into commands values ('23A-again', pg_temp.confirmed(pg_temp.command(642, pg_temp.unit(23, 1), 742, 842)));
select is((select x.replayed from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '23A-again')))
  as x(replayed text)), 'false', 'A is sent');
select is((select write_plan #> '{context,peers}' from public.takeoff_send_receipts where job_id = pg_temp.unit(23, 1)),
  jsonb_build_array(pg_temp.unit(23, 2)), 'its receipt names B, the plan it was compared with');

-- 5. Affaire 22 again: C is read after B; C's preview names B as its peer; B's lines change and commit before C's
-- confirmation reads its context: refused, nothing written.
select is(extensions.dblink_exec('race_setup', pg_temp.read_sql(pg_temp.unit(22, 3), 6)), 'COMMIT', 'C is read');
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(public.read_takeoff_send_context(pg_temp.tenant(), pg_temp.f(22),
    pg_temp.unit(22, 3), pg_temp.f(731)) -> 'peers') as peer), jsonb_build_array(pg_temp.unit(22, 2)),
  'C''s controls compare it with B, read and not sent');
select is(extensions.dblink_exec('race_setup', format($lock$begin; insert into public.draft_locks (version_id, user_id, tenant_id,
  expires_at, session_id) values (%L, %L, %L, now() + interval '30 minutes', gen_random_uuid()); commit;$lock$,
  pg_temp.f(731), pg_temp.f(1), pg_temp.tenant())), 'COMMIT', 'the engineer holds V1''s draft lock');
insert into commands values ('22C', pg_temp.confirmed(pg_temp.command(651, pg_temp.unit(22, 3), 751, 851, pg_temp.f(731))));
select is(extensions.dblink_exec('race_setup', format($edit$begin;
  update public.takeoff_items set is_excluded = true, exclusion_reason = 'Doublon fictif' where job_id = %L; commit;$edit$,
  pg_temp.unit(22, 2))), 'COMMIT', 'B''s line is set aside and committed, after C''s preview');
select is((select count(*)::integer from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '22C')), false)
  as x(replayed text)), 0, 'C''s confirmation writes nothing');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_SEND_PREVIEW_STALE%peers_changed%',
  'C is asked again: a plan it was compared with changed');
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.unit(22, 3)), null::uuid, 'C is still to send');

-- Fix round 1, point 1: every writer of what the send's context reads is serialised with the send, the writer in flight
-- at the moment the send would read its stamps. Red before (no context lock): the send read the committed state and
-- committed, the writer's change landing after it.
create function pg_temp.plan_file(p_project integer, p_k integer) returns uuid language sql stable as $$
  select f.id from public.takeoff_jobs j join public.plan_files f on 'plan:' || f.id = j.launch_unit_key where j.id = pg_temp.unit(p_project, p_k)
$$;
create function pg_temp.location_insert_sql(p_project integer, p_k integer) returns text language sql stable as $$
  select format($location$insert into public.takeoff_plan_locations (tenant_id, project_id, source_kind, source_id, content_hash,
      revision, building_choice, building, building_set_by, building_set_at, building_set_revision, level_choice, level, level_set_by,
      level_set_at, level_set_revision, plan_file_id, document_name, created_by, updated_by)
    select %1$L, %2$L, recorded.source_kind, recorded.source_id, encode(sha256(convert_to(%3$L::text, 'UTF8')), 'hex'), 1, 'reading',
      null, %4$L, now(), 1, 'value', 'R+1', %4$L, now(), 1, %3$L, 'plan-b.pdf', %4$L, %4$L
    from public.takeoff_plan_location_sources recorded where recorded.plan_file_id = %3$L$location$,
    pg_temp.tenant(), pg_temp.f(p_project), pg_temp.plan_file(p_project, p_k), pg_temp.f(1))
$$;

-- 6. Affaire 24: an operator saves B's location (uncommitted) when A's confirmation reads its context: the send waits
-- for the save, then reads it and refuses (« location_changed »).
insert into commands values ('24A', pg_temp.confirmed(pg_temp.command(661, pg_temp.unit(24, 1), 761, 861)));
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the location save starts');
select is(extensions.dblink_exec('race_b', pg_temp.location_insert_sql(24, 2)), 'INSERT 0 1', 'B''s location is written, not committed');
select is(extensions.dblink_send_query('race_a', pg_temp.send_sql((select body from commands where name = '24A'))), 1, 'A is confirmed');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'A''s send waits for the location save before it reads its context');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the save commits');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A writes nothing');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_SEND_PREVIEW_STALE%location_changed%',
  'A is asked again: B''s location changed what its controls compare');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A is done');
select is(pg_temp.versions(24), 0::bigint, 'no version');
-- The other way: A's send in flight (its context checked) when the location is saved again: the save waits for the send.
insert into commands values ('24A2', pg_temp.confirmed(pg_temp.command(662, pg_temp.unit(24, 1), 762, 862)));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'A''s confirmation starts again');
select is((select x.replayed from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '24A2')))
  as x(replayed text)), 'false', 'A is sent on its context, not yet committed');
select is(extensions.dblink_send_query('race_b', format($relocate$update public.takeoff_plan_locations set level = 'R+2', revision = revision + 1,
    level_set_revision = revision + 1 where project_id = %L$relocate$, pg_temp.f(24))), 1, 'B''s location is saved again');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the save waits for A''s send');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'A commits');
select ok(pg_temp.answered('race_b'), 'the save goes on');
select is((select x.status from extensions.dblink_get_result('race_b') as x(status text)), 'UPDATE 1', 'and is written');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(status text)), 0, 'the save is done');
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.f(24)),
    (select revision from public.takeoff_plan_locations where project_id = pg_temp.f(24))$$,
  $$values (1::bigint, 2)$$, 'A is sent on the location it read, and the later save is the next generation');

-- 7. Affaire 25: one of B's lines set aside (uncommitted) when A's confirmation reads its context: the send waits for
-- that edit, then refuses (« peers_changed »).
insert into commands values ('25A', pg_temp.confirmed(pg_temp.command(671, pg_temp.unit(25, 1), 771, 871)));
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the review of B starts');
select is(extensions.dblink_exec('race_b', format($edit$update public.takeoff_items set is_excluded = true, exclusion_reason = 'Doublon fictif'
  where job_id = %L$edit$, pg_temp.unit(25, 2))), 'UPDATE 1', 'B''s line is set aside, not committed');
select is(extensions.dblink_send_query('race_a', pg_temp.send_sql((select body from commands where name = '25A'))), 1, 'A is confirmed');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'A''s send waits for B''s edit before it reads its context');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the edit commits');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A writes nothing');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_SEND_PREVIEW_STALE%peers_changed%',
  'A is asked again: a plan it was compared with changed');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A is done');

-- 8. Affaire 26: B is read again by another request (B2, its own request, outside A's), its end in flight (uncommitted)
-- when A's confirmation reads its context: the send waits for that end, then refuses (« peers_changed »).
select is(extensions.dblink_exec('race_setup', format($rereading$begin;
  set local session_replication_role = replica;
  insert into public.takeoff_launch_requests
  select (jsonb_populate_record(null::public.takeoff_launch_requests, to_jsonb(r) || jsonb_build_object('id', %1$L, 'intent_key', %2$L,
    'state', 'closed', 'outcome', 'success', 'closed_at', now(), 'completion_event_id', gen_random_uuid()))).*
  from public.takeoff_launch_requests r where r.project_id = %3$L and r.origin = 'manual';
  insert into public.takeoff_jobs
  select (jsonb_populate_record(null::public.takeoff_jobs, to_jsonb(j) || jsonb_build_object('id', %4$L, 'launch_request_id', %1$L,
    'status', 'processing', 'started_at', now(), 'processing_lease_token', %5$L, 'processing_lease_expires_at', now() + interval '30 minutes',
    'created_at', now() + interval '1 minute'))).*
  from public.takeoff_jobs j where j.id = %6$L;
  commit;$rereading$, pg_temp.f(5262), pg_temp.f(5263), pg_temp.f(26), pg_temp.f(5264), pg_temp.f(926), pg_temp.unit(26, 2))),
  'COMMIT', 'B is being read again, by another request');
insert into commands values ('26A', pg_temp.confirmed(pg_temp.command(681, pg_temp.unit(26, 1), 781, 881)));
select is(extensions.dblink_exec('race_b', 'begin'), 'BEGIN', 'the worker''s end of B''s reread starts');
select is((select x.ended from extensions.dblink('race_b', pg_temp.end_sql(pg_temp.f(5264), 926, 2)) as x(ended boolean)), true,
  'B''s reread ends, not committed');
select is(extensions.dblink_send_query('race_a', pg_temp.send_sql((select body from commands where name = '26A'))), 1, 'A is confirmed');
select ok(pg_temp.waits_for('race_a', 'race_b'), 'A''s send waits for that end, though it is another request''s');
select is(extensions.dblink_exec('race_b', 'commit'), 'COMMIT', 'the end commits');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A writes nothing');
select ok(extensions.dblink_error_message('race_a') like '%TAKEOFF_SEND_PREVIEW_STALE%peers_changed%',
  'A is asked again: B was read meanwhile');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A is done');

-- 9. Fix round 1, point 3: a reread naming A while A's send is in flight. The send holds A, then the affaire's context,
-- then A's request; the reread takes its predecessor A (a key share) before anything else, so it waits for the send
-- holding nothing the send needs (not the affaire's command key, not the automatic request), and goes on once A is sent.
-- Red before: a request's predecessor was not locked early; the reread held the command key (and the affaire's automatic
-- request, which A's may be) when its request's foreign key waited for A.
insert into commands values ('25A2', pg_temp.confirmed(pg_temp.command(672, pg_temp.unit(25, 1), 772, 872)));
select is(extensions.dblink_exec('race_a', 'begin'), 'BEGIN', 'A''s send starts');
select is((select x.replayed from extensions.dblink('race_a', pg_temp.send_sql((select body from commands where name = '25A2')))
  as x(replayed text)), 'false', 'A is sent, not yet committed');
select is(extensions.dblink_send_query('race_b', format($reread$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L,
    'reread_plans', %L, %L, %L::jsonb, %L::jsonb, %L::jsonb, '[]'::jsonb, %L, 1, array[%L]::uuid[])$reread$,
    pg_temp.tenant(), pg_temp.f(25), pg_temp.f(1), pg_temp.f(5251), pg_temp.unit(25, 1), pg_temp.host(), pg_temp.selection(),
    jsonb_build_object('format_version', 2, 'plans', jsonb_build_array(jsonb_build_object('entry_key', pg_temp.plan_file(25, 1)))),
    pg_temp.snapshot(25), pg_temp.f(45), pg_temp.plan_file(25, 1))), 1, 'a reread naming A is commanded');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the reread waits for A''s send, on A');
select ok((select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('takeoff-launch:' || pg_temp.f(25)::text, 0))),
  'holding nothing else: the affaire''s command key is free');
select ok((select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('takeoff-launch:' || pg_temp.f(25)::text, 0))), 'given back');
select is(extensions.dblink_exec('race_a', 'commit'), 'COMMIT', 'A commits');
select ok(pg_temp.answered('race_b'), 'the reread goes on: no deadlock');
select is((select x.outcome from extensions.dblink_get_result('race_b', false) as x(outcome text)), 'already_running',
  'and is answered as a command beside A''s running request (no deadlock, nothing refused)');
select is(extensions.dblink_error_message('race_b'), 'OK', 'without error');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'the reread is done');
select is((select estimate_version_id is not null from public.takeoff_jobs where id = pg_temp.unit(25, 1)), true, 'A is sent');

-- 10. Fix round 1, point 3, the order the review named: A belongs to the affaire's automatic request (closed: A and B
-- read, C set aside). A's send holds A, then waits for the affaire's send context, which a writer holds (shared, as a
-- location save in flight does); a reread naming A is commanded meanwhile. It takes its predecessor A (a key share)
-- before the affaire's command key and its automatic request, so it waits on A holding neither; the writer commits, the
-- send takes the request, commits, then the reread is admitted. Red before (one predecessor lock for a request's
-- predecessor too was missing): the reread locked the automatic request (FOR UPDATE), then its request's foreign key
-- waited for A, and the send, asking for that request, deadlocked with it.
select is((select x.outcome from extensions.dblink('race_setup', pg_temp.launch_sql(27)) as x(outcome text)), 'admitted',
  'affaire 27: a request of three plans, one analysis per plan');
select is(extensions.dblink_exec('race_setup', pg_temp.read_sql(pg_temp.unit(27, k), 4 - k)), 'COMMIT',
  format('affaire 27: plan %s read', k))
from generate_series(1, 2) as k;
select is(extensions.dblink_exec('race_setup', format($automatic$begin;
  set local session_replication_role = replica;
  update public.takeoff_jobs set status = 'canceled', analysis_outcome = 'canceled', analysis_finished_at = now() where id = %1$L;
  update public.takeoff_launch_requests set origin = 'automatic', intent_key = id, command_digest = null, mandate_kind = 'confirmation',
    confirmed_by = %3$L, state = 'closed', outcome = 'partial', closed_at = now(), completion_event_id = gen_random_uuid(),
    units_succeeded = 2, units_canceled = 1 where project_id = %2$L;
  commit;$automatic$, pg_temp.unit(27, 3), pg_temp.f(27), pg_temp.f(1))), 'COMMIT',
  'the request is the affaire''s automatic one, closed (its C set aside, without its triggers)');
insert into commands values ('27A', pg_temp.confirmed(pg_temp.command(691, pg_temp.unit(27, 1), 791, 891)));
select is(extensions.dblink_exec('race_c', 'begin'), 'BEGIN', 'a writer of the affaire starts');
select is((select x.held from extensions.dblink('race_c', format($held$select 'held'::text from
    (select pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(%L, 0))) as locked$held$,
    'takeoff-send-context:' || pg_temp.f(27))) as x(held text)), 'held',
  'and holds the affaire''s send context, shared');
select is(extensions.dblink_send_query('race_a', pg_temp.send_sql((select body from commands where name = '27A'))), 1, 'A is confirmed');
select ok(pg_temp.waits_for('race_a', 'race_c'), 'A''s send holds A and waits for the affaire''s send context');
select is(extensions.dblink_send_query('race_b', pg_temp.launch_sql(27, pg_temp.unit(27, 1), 5270, 5280)), 1,
  'a reread naming A is commanded');
select ok(pg_temp.waits_for('race_b', 'race_a'), 'the reread waits for A''s send, on A');
select ok((select pg_catalog.pg_try_advisory_lock(pg_catalog.hashtextextended('takeoff-launch:' || pg_temp.f(27)::text, 0))),
  'holding nothing else: the affaire''s command key is free');
select ok((select pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended('takeoff-launch:' || pg_temp.f(27)::text, 0))), 'given back');
select is((select x.free from extensions.dblink('race_setup', format($free$select count(*)::integer from (select 1
    from public.takeoff_launch_requests r where r.project_id = %L and r.origin = 'automatic' for update skip locked) as free_row$free$,
    pg_temp.f(27))) as x(free integer)), 1, 'and the automatic request is free: the send can take it');
select is(extensions.dblink_exec('race_c', 'commit'), 'COMMIT', 'the writer commits');
select ok(pg_temp.answered('race_a'), 'A''s send goes on');
select is((select x.replayed from extensions.dblink_get_result('race_a', false) as x(replayed text)), 'false',
  'and sends A: it took the request, no deadlock');
select is(extensions.dblink_error_message('race_a'), 'OK', 'A''s send without error');
select is((select count(*)::integer from extensions.dblink_get_result('race_a', false) as x(replayed text)), 0, 'A''s send is done');
select ok(pg_temp.answered('race_b'), 'the reread goes on');
select is((select x.outcome from extensions.dblink_get_result('race_b', false) as x(outcome text)), 'admitted',
  'and is admitted once A is sent: a request naming A');
select is(extensions.dblink_error_message('race_b'), 'OK', 'the reread without error');
select is((select count(*)::integer from extensions.dblink_get_result('race_b', false) as x(outcome text)), 0, 'the reread is done');
select is((select estimate_version_id is not null from public.takeoff_jobs where id = pg_temp.unit(27, 1)), true, 'A is sent');
select is((select predecessor_job_id from public.takeoff_launch_requests where intent_key = pg_temp.f(5270)), pg_temp.unit(27, 1),
  'the reread''s request names A');

-- Clean the committed synthetic fixtures of this disposable database, as the other race files do.
select is(extensions.dblink_exec('race_setup', $cleanup$
begin;
set local session_replication_role = replica;
do $clean$
declare
  target uuid;
  entry record;
begin
  for target in select distinct m.tenant_id from public.tenant_memberships m where m.user_id = 'd5c60000-0000-4000-8000-000000000001'
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
delete from private.takeoff_host_slots where host_id = 'urn:uuid:d5c60000-0000-4000-8000-000000000099';
delete from private.takeoff_local_job_work where host_id = 'urn:uuid:d5c60000-0000-4000-8000-000000000099';
delete from private.takeoff_plan_dispatch_activation;
delete from private.takeoff_launch_activation;
delete from private.takeoff_completion_activation;
delete from public.profiles where id = 'd5c60000-0000-4000-8000-000000000001';
delete from auth.users where id = 'd5c60000-0000-4000-8000-000000000001';
commit;
$cleanup$), 'COMMIT', 'synthetic fixtures and the activations cleaned');
select is((select count(*)::integer from public.takeoff_jobs where id::text like 'd5c60000-%'), 0, 'no fixture job is left');
select is((select count(*)::integer from private.takeoff_plan_dispatch_activation), 0, 'the database is left without an activation');
select is(extensions.dblink_disconnect(session.name), 'OK', format('%s disconnected', session.name))
from (values ('race_setup'), ('race_stage'), ('race_a'), ('race_b'), ('race_c')) as session(name);
select * from finish();
rollback;
