-- Lot 3, migration C (…_takeoff_partial_send.sql): the send of one plan while the affaire's other plans are read. A request
-- of three plans (A, B, C) read plan by plan; A is sent while B and C are still read: the previous application's command
-- (no context) stays refused, a direct link stays refused, the context names the other plans read and the operators'
-- locations, a peer read or edited and a location corrected between the preview and the confirmation refuse the send
-- with nothing written, then A creates the first draft and B adds its part to A's line (3 + 2 = 5, both sources). Single
-- session; the races are in takeoff-partial-send-race.test.sql. Isolation justified: the closure and the context's
-- staleness are refusals of the database no journey can force between a preview and a confirmation deterministically.
-- Written before the migration: red on 2c5424215 (public.read_takeoff_send_context does not exist). All values are
-- fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5c50000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5c50000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;

-- Engineer 1 owns the affaire; 2 is an administrator.
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'partial-send-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 2) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5c50000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Envoi par plan (fictif)', 'partial-send-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'admin', true, '2020-01-01');
insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.f(20), pg_temp.f(10), pg_temp.f(1), 'Affaire envoi par plan (fictive)');
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values (pg_temp.f(30), pg_temp.f(20), pg_temp.f(1), 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values (pg_temp.f(60), pg_temp.f(20), pg_temp.f(30), 'confirme', 'Résumé fictif', 'Objet fictif', now(), pg_temp.f(1));
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(40), pg_temp.f(10), pg_temp.f(20), 'Plans du dossier');
-- Plans A (two pages), B and C (one page each): 101, 102, 103, in the order of their names.
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + k), pg_temp.f(10), pg_temp.f(40), 'plan-' || chr(96 + k) || '.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(100 + k), 'plan-' || chr(96 + k) || '.pdf'), 'application/pdf', 8,
  case k when 1 then 2 else 1 end
from generate_series(1, 3) as k;

create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
create function pg_temp.snapshot() returns jsonb language sql as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(1),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan', 'active', true,
          'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[]'::jsonb) order by f.id)
        from public.plan_files f where f.plan_set_id = pg_temp.f(40))))
$$;
create function pg_temp.manifest() returns jsonb language sql as $$
  with plans as (
    select f.id, f.file_name, f.page_count, row_number() over (order by f.file_name, f.id) as ordinal, count(*) over () as units
    from public.plan_files f where f.plan_set_id = pg_temp.f(40)
  )
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'free_extraction', 'version', 1, 'list', null),
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || p.id, 'ordinal', p.ordinal, 'plans', jsonb_build_array(p.id),
      'pages', '[]'::jsonb, 'page_count', p.page_count, 'vector_pages', 0,
      'budget', jsonb_build_object('tokens', ceil(400000::numeric / p.units), 'cost_cents', ceil(2500::numeric / p.units))) order by p.ordinal)
      from plans p),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', p.id, 'plan_file_id', p.id, 'name', p.file_name, 'logical_id', p.id,
      'content_sha256', pg_temp.digest(p.id), 'pages', '[]'::jsonb, 'page_count', p.page_count) order by p.ordinal) from plans p),
    'coverage', jsonb_build_object('plans_retained', (select count(*) from plans), 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500))
$$;
create function pg_temp.jobs() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', pg_temp.f(1200 + (u.value ->> 'ordinal')::integer),
      'plan_set_id', pg_temp.f(40), 'launch_unit_key', u.value ->> 'key', 'source_file_name', 'plan.pdf',
      'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture', 'execution_host_id', pg_temp.host())
    order by (u.value ->> 'ordinal')::integer)
  from jsonb_array_elements(pg_temp.manifest() -> 'units') u(value)
$$;
-- The jobs of plans A, B and C.
create function pg_temp.a() returns uuid language sql immutable as $$ select pg_temp.f(1201) $$;
create function pg_temp.b() returns uuid language sql immutable as $$ select pg_temp.f(1202) $$;
create function pg_temp.c() returns uuid language sql immutable as $$ select pg_temp.f(1203) $$;

set local session_replication_role = replica;
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
values (pg_temp.f(10), pg_temp.f(20), 1, pg_temp.snapshot() -> 'preparation', pg_temp.snapshot(), now(), pg_temp.f(1), pg_temp.f(1));
set local session_replication_role = origin;
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute') on conflict do nothing;
select results_eq($$select outcome from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1), pg_temp.f(500),
    'initial', null, pg_temp.host(), pg_temp.selection(), pg_temp.manifest(), pg_temp.snapshot(), pg_temp.jobs(), pg_temp.f(40), 1,
    (select array_agg(f.id) from public.plan_files f where f.plan_set_id = pg_temp.f(40)))$$,
  $$values ('admitted'::text)$$, 'a request of three plans is admitted: one analysis per plan');
create function pg_temp.request() returns uuid language sql as $$
  select id from public.takeoff_launch_requests where project_id = pg_temp.f(20) order by created_at desc limit 1
$$;

-- A plan read: its reading ends (without the worker's triggers, which are not this file's subject) with its lines.
create function pg_temp.read(p_job uuid, p_lines jsonb) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  update public.takeoff_jobs set status = 'completed', started_at = now() - interval '1 minute', completed_at = now(),
    analysis_outcome = 'success', analysis_finished_at = now(), processing_lease_token = null, processing_lease_expires_at = null
  where id = p_job;
  set local session_replication_role = origin;
  insert into public.takeoff_results (id, tenant_id, job_id) values (('d5c50000-0000-4000-8000-' || lpad((substr(p_job::text, 25)::bigint
    + 300)::text, 12, '0'))::uuid, pg_temp.f(10), p_job);
  insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
    source_page, confidence, metadata)
  select (line.value ->> 'id')::uuid, pg_temp.f(10), p_job, r.id, line.value ->> 'designation', (line.value ->> 'quantity')::numeric,
    line.value ->> 'unit', 'Repère fictif', f.file_name, (line.value ->> 'page')::integer, 0.95,
    jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', f.id))
  from jsonb_array_elements(p_lines) as line(value)
  cross join public.takeoff_results r
  join public.takeoff_jobs j on j.id = p_job
  join public.plan_files f on 'plan:' || f.id = j.launch_unit_key
  where r.job_id = p_job;
end;
$$;

-- As the server: the context the database computes, read with the service role.
create function pg_temp.context(p_job uuid, p_version uuid default null) returns jsonb language plpgsql as $$
declare
  caller text := current_user;
  answer jsonb;
begin
  set local role service_role;
  answer := public.read_takeoff_send_context(pg_temp.f(10), pg_temp.f(20), p_job, p_version);
  execute format('set local role %I', caller);
  return answer;
end;
$$;

-- The command as send-server.ts builds it from the state it read: a dry run first, whose outcome the member sees, then
-- the send of that outcome. `p_context` is what the server stages: the context's stamps, or null (the previous server).
create function pg_temp.command(p_request integer, p_job uuid, p_destination jsonb, p_section jsonb, p_context jsonb,
  p_accumulations jsonb default '[]')
returns jsonb language sql as $$
  select jsonb_build_object('format_version', 2, 'mode', 'dry_run', 'request_id', pg_temp.f(p_request), 'job_id', j.id,
    'fingerprint', repeat('f', 64), 'destination', p_destination, 'section', p_section,
    'client', jsonb_build_object('fingerprint', repeat('f', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'page_decisions', '[]'::jsonb, 'override', false),
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case when p_destination ->> 'kind' = 'existing_draft'
        then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id))
      || case when p_context is null then '{}'::jsonb else jsonb_build_object('context', p_context) end,
    'mapping_plan', (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', i.rank - 1, 'rule_id', null, 'action', 'none',
        'designation', btrim(i.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null) order by i.rank)
      from (select item.*, row_number() over (order by item.created_at, item.id) as rank
        from public.takeoff_items item where item.job_id = j.id) as i),
    'page_decisions', '[]'::jsonb, 'rule_results', '[]'::jsonb, 'rule_transforms', '[]'::jsonb, 'accumulations', p_accumulations,
    'override', null, 'price_rules_ignored', '[]'::jsonb, 'expected_outcome', null)
  from public.takeoff_jobs j where j.id = p_job
$$;
create function pg_temp.first_draft(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'first_draft', 'version_payload', jsonb_build_object(
    'id', pg_temp.f(p_version), 'title', null, 'date_devis', '2026-11-22', 'validite_jours', 30, 'margin_multiplier', 1,
    'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
    'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
    'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
    'calc_engine_version', 3, 'gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0))
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;
create temp table commands (name text primary key, body jsonb) on commit drop;
grant all on commands to authenticated;
create function pg_temp.stage_body(p_body jsonb) returns void language plpgsql as $$
declare
  caller text := current_user;
  actor uuid := (select auth.uid());
begin
  set local role service_role;
  perform public.stage_takeoff_send(actor, p_body);
  execute format('set local role %I', caller);
end;
$$;
create function pg_temp.request_of(p_name text) returns jsonb language sql as $$
  select jsonb_build_object('request_id', body -> 'request_id', 'job_id', body -> 'job_id', 'fingerprint', body -> 'fingerprint')
  from commands where name = p_name
$$;
-- The preview of a command (its dry run under a fresh identity): its outcome, or its named refusal.
create function pg_temp.preview(p_name text) returns jsonb language plpgsql as $$
declare
  previewed jsonb := (select body from commands where name = p_name)
    || jsonb_build_object('request_id', gen_random_uuid(), 'mode', 'dry_run', 'expected_outcome', null);
begin
  perform pg_temp.stage_body(previewed);
  return public.send_takeoff_job(jsonb_build_object('request_id', previewed -> 'request_id', 'job_id', previewed -> 'job_id',
    'fingerprint', previewed -> 'fingerprint'));
end;
$$;
-- The confirmation of the outcome a preview showed: the command in send mode, staged and sent by its identity.
create function pg_temp.confirm(p_name text, p_outcome jsonb) returns jsonb language plpgsql as $$
begin
  update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', p_outcome) where name = p_name;
  perform pg_temp.stage_body((select body from commands where name = p_name));
  return public.send_takeoff_job(pg_temp.request_of(p_name));
end;
$$;
-- The refusal of a statement as « SQLSTATE MESSAGE reason », or null when it passed (its writes are rolled back).
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
declare
  state text;
  message text;
  detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics state = returned_sqlstate, message = message_text, detail = pg_exception_detail;
  return concat_ws(' ', state, message, case when detail ~ '^\{' then detail::jsonb ->> 'reason' end);
end;
$$;
create function pg_temp.counts() returns jsonb language sql as $$
  select jsonb_build_object(
    'versions', (select count(*) from public.estimate_versions where project_id = pg_temp.f(20)),
    'lines', (select count(*) from public.estimate_items i join public.estimate_versions v on v.id = i.version_id
      where v.project_id = pg_temp.f(20) and i.item_type = 'line'),
    'receipts', (select count(*) from public.takeoff_send_receipts where project_id = pg_temp.f(20)),
    'attached', (select count(*) from public.takeoff_jobs where project_id = pg_temp.f(20) and estimate_version_id is not null),
    'checks', (select count(*) from private.takeoff_plan_send_checks))
$$;
create function pg_temp.nothing_written() returns jsonb language sql immutable as $$
  select '{"versions": 0, "lines": 0, "receipts": 0, "attached": 0, "checks": 0}'::jsonb
$$;

-- 1. Plan A is read (a valve line of 3 on its page 2, a network of 4 m on its page 1); B and C are still to read.
select pg_temp.read(pg_temp.a(), jsonb_build_array(
  jsonb_build_object('id', pg_temp.f(2011), 'designation', 'Vanne d''arrêt DN20', 'quantity', 3, 'unit', 'u', 'page', 2),
  jsonb_build_object('id', pg_temp.f(2012), 'designation', 'Réseau EF', 'quantity', 4, 'unit', 'ml', 'page', 1)));
select results_eq($$select status::text from public.takeoff_jobs where launch_request_id = pg_temp.request() order by id$$,
  $$values ('completed'::text), ('pending'::text), ('pending'::text)$$, 'A is read, B and C are still to read');

-- 2. What the previous application's server would stage for A (no context): the send stays closed for it.
insert into commands values ('A-previous', pg_temp.command(601, pg_temp.a(), pg_temp.first_draft(701),
  jsonb_build_object('kind', 'new', 'id', pg_temp.f(711), 'title', 'Métré — plans fictifs'), null));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.preview('A-previous') -> 'error' ->> 'code', 'TAKEOFF_SEND_JOB_NOT_READY',
  'a preview of the previous server (no context) is answered « not ready »');
select is(pg_temp.refusal($$select pg_temp.confirm('A-previous', '{"format_version": 1, "engine": 3, "sections_created": [], "lines": [], "parts": []}'::jsonb)$$),
  '40001 TAKEOFF_SEND_JOB_NOT_READY plan_context_required', 'its confirmation is refused, with its reason');
reset role;
select is(pg_temp.counts(), pg_temp.nothing_written(), 'nothing is written');
-- A direct link of a per-plan analysis (any writer but the send that checked its context) is refused before anything.
select is(pg_temp.refusal($$update public.takeoff_jobs set estimate_version_id = gen_random_uuid() where id = pg_temp.a()$$),
  '40001 TAKEOFF_SEND_JOB_NOT_READY plan_context_unchecked', 'a direct link of a per-plan analysis is refused');

-- 3. The context of A: no other plan read yet; its plan revision without a location; B and C named, not read.
create temp table stamps_before as select pg_temp.context(pg_temp.a()) -> 'stamps' as stamps;
select is(pg_temp.context(pg_temp.a()) -> 'peers', '[]'::jsonb, 'no other plan of the affaire is read yet');
select is(pg_temp.context(pg_temp.a()) -> 'plans', jsonb_build_array(jsonb_build_object('job_id', pg_temp.a(), 'plan_file_id', pg_temp.f(101),
  'content_hash', pg_temp.digest(pg_temp.f(101)), 'location', null, 'current_copy', true)),
  'A''s plan revision, as its preparation attested it, without a location, the dossier''s current copy');
select is(pg_temp.context(pg_temp.a()) -> 'display', jsonb_build_object('request_id', pg_temp.request(), 'plan_name', 'plan-a.pdf',
  'peers', '[]'::jsonb, 'unread', jsonb_build_array(
    jsonb_build_object('plan_name', 'plan-b.pdf', 'state', 'queued', 'compared_reading_at', null),
    jsonb_build_object('plan_name', 'plan-c.pdf', 'state', 'queued', 'compared_reading_at', null)), 'never_read', '[]'::jsonb,
  'uncompared', jsonb_build_object('grouped', 0, 'outside_request', 0)),
  'the preview names B and C, still to read');
-- A plan D added to the dossier and retained by its confirmed preparation, read by no analysis: named, never compared.
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
values (pg_temp.f(104), pg_temp.f(10), pg_temp.f(40), 'plan-d.pdf',
  concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(104), 'plan-d.pdf'), 'application/pdf', 8, 1);
set local session_replication_role = replica;
update public.takeoff_preparations set confirmed_snapshot = jsonb_set(confirmed_snapshot, '{preparation,sources}',
  (confirmed_snapshot #> '{preparation,sources}') || jsonb_build_array(jsonb_build_object('document_id', pg_temp.f(104),
    'document_name', 'plan-d.pdf', 'kind', 'plan', 'active', true, 'confirmed', true, 'content_hash', pg_temp.digest(pg_temp.f(104)))))
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.a()) #> '{display,never_read}', '["plan-d.pdf"]'::jsonb,
  'a plan of the dossier that no analysis of one plan has read is named');
select is(pg_temp.context(pg_temp.a()) -> 'stamps', (select stamps from stamps_before),
  'and changes nothing the send compares');
-- A heartbeat of a plan being read changes nothing a send compares: C claimed, its lease renewed.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'processing', started_at = now(), processing_lease_token = pg_temp.f(900),
  processing_lease_expires_at = now() + interval '10 minutes' where id = pg_temp.c();
update public.takeoff_jobs set processing_lease_expires_at = now() + interval '20 minutes' where id = pg_temp.c();
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.a()) -> 'stamps', (select stamps from stamps_before),
  'a plan claimed and its lease renewed leave the stamps as they were');
select is(pg_temp.context(pg_temp.a()) #> '{display,unread,1,state}', '"running"'::jsonb, 'only what the preview shows moves');

-- 4. A previewed while B is read; B's reading ends before the confirmation: refused, nothing written.
insert into commands values ('A', pg_temp.command(602, pg_temp.a(), pg_temp.first_draft(702),
  jsonb_build_object('kind', 'new', 'id', pg_temp.f(712), 'title', 'Métré — plans fictifs'), pg_temp.context(pg_temp.a()) -> 'stamps'));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table shown (name text primary key, outcome jsonb) on commit drop;
grant all on shown to authenticated;
insert into shown select 'A', pg_temp.preview('A') -> 'outcome';
select ok((select outcome from shown where name = 'A') is not null, 'A''s preview shows its outcome while B and C are read');
reset role;
select pg_temp.read(pg_temp.b(), jsonb_build_array(
  jsonb_build_object('id', pg_temp.f(2021), 'designation', 'Vanne d''arrêt DN20', 'quantity', 2, 'unit', 'u', 'page', 1)));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('A', (select outcome from shown where name = 'A'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE peers_changed', 'B read since A''s preview: A''s confirmation is refused');
reset role;
select is(pg_temp.counts(), pg_temp.nothing_written(), 'nothing is written: no version, no line, no receipt, no link');
select is(pg_temp.context(pg_temp.a()) #> '{peers,0,job_id}', to_jsonb(pg_temp.b()), 'B is now a peer of A');
-- Fix round 1, point 2: the peers come from the sealed requests and the dossier's current copies, never from the
-- preparation, which an edit clears and an automatic request may not have. Red before: B was a peer only while the
-- confirmed preparation named its plan.
create temp table preparation_kept as select * from public.takeoff_preparations where project_id = pg_temp.f(20);
set local session_replication_role = replica;
update public.takeoff_preparations set confirmed_snapshot = null, confirmed_at = null, confirmed_by = null
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.a()) #> '{peers,0,job_id}', to_jsonb(pg_temp.b()),
  'a preparation edited after the seal (no confirmed snapshot): B is still A''s peer');
set local session_replication_role = replica;
delete from public.takeoff_preparations where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.a()) #> '{peers,0,job_id}', to_jsonb(pg_temp.b()),
  'no preparation at all (as an automatic admission may leave it): B is still A''s peer');
-- The same request as the affaire's automatic one (its snapshot sealed on the request), still without a preparation.
create temp table request_kept as select * from public.takeoff_launch_requests where id = pg_temp.request();
set local session_replication_role = replica;
update public.takeoff_launch_requests set origin = 'automatic', intent_key = id, command_digest = null,
  mandate_kind = 'confirmation', confirmed_by = pg_temp.f(1) where id = pg_temp.request();
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.a()) #> '{peers,0,job_id}', to_jsonb(pg_temp.b()),
  'A and B units of the affaire''s automatic request, no preparation: B is still A''s peer');
set local session_replication_role = replica;
update public.takeoff_launch_requests as request_row set origin = kept.origin, intent_key = kept.intent_key,
  command_digest = kept.command_digest, mandate_kind = kept.mandate_kind, confirmed_by = kept.confirmed_by
from request_kept as kept where request_row.id = kept.id;
insert into public.takeoff_preparations select * from preparation_kept;
set local session_replication_role = origin;

-- One of B's lines edited after A's preview: refused again.
update commands set body = pg_temp.command(603, pg_temp.a(), pg_temp.first_draft(703),
  jsonb_build_object('kind', 'new', 'id', pg_temp.f(713), 'title', 'Métré — plans fictifs'), pg_temp.context(pg_temp.a()) -> 'stamps')
where name = 'A';
select pg_temp.sign_in(1);
set local role authenticated;
update shown set outcome = pg_temp.preview('A') -> 'outcome' where name = 'A';
reset role;
update public.takeoff_items set is_excluded = true, exclusion_reason = 'Doublon fictif' where id = pg_temp.f(2021);
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('A', (select outcome from shown where name = 'A'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE peers_changed', 'a line of B excluded since A''s preview: refused');
reset role;
update public.takeoff_items set is_excluded = false, exclusion_reason = null where id = pg_temp.f(2021);

-- A location of A's plan corrected after A's preview: refused, location_changed.
update commands set body = pg_temp.command(604, pg_temp.a(), pg_temp.first_draft(704),
  jsonb_build_object('kind', 'new', 'id', pg_temp.f(714), 'title', 'Métré — plans fictifs'), pg_temp.context(pg_temp.a()) -> 'stamps')
where name = 'A';
select pg_temp.sign_in(1);
set local role authenticated;
update shown set outcome = pg_temp.preview('A') -> 'outcome' where name = 'A';
reset role;
insert into public.takeoff_plan_locations (id, tenant_id, project_id, source_kind, source_id, content_hash, revision,
  building_choice, building, building_set_by, building_set_at, building_set_revision,
  level_choice, level, level_set_by, level_set_at, level_set_revision, plan_file_id, document_name, created_by, updated_by)
values (pg_temp.f(3001), pg_temp.f(10), pg_temp.f(20), 'plan_file', pg_temp.f(101), pg_temp.digest(pg_temp.f(101)), 1,
  'reading', null, pg_temp.f(1), now(), 1, 'value', 'R+1', pg_temp.f(1), now(), 1, pg_temp.f(101), 'plan-a.pdf', pg_temp.f(1), pg_temp.f(1));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('A', (select outcome from shown where name = 'A'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE location_changed', 'A''s plan located since its preview: refused');
reset role;
select is(pg_temp.counts(), pg_temp.nothing_written(), 'still nothing written');
select is(pg_temp.context(pg_temp.a()) #> '{plans,0,location}', jsonb_build_object('id', pg_temp.f(3001), 'revision', 1,
  'building_choice', 'reading', 'building', null, 'level_choice', 'value', 'level', 'R+1'),
  'the context carries the operator''s location of A''s revision, with its generation');

-- 5. A previewed again and confirmed: one first draft, A's lines, A linked through its check, the receipt says what was
-- checked.
update commands set body = pg_temp.command(605, pg_temp.a(), pg_temp.first_draft(705),
  jsonb_build_object('kind', 'new', 'id', pg_temp.f(715), 'title', 'Métré — plans fictifs'), pg_temp.context(pg_temp.a()) -> 'stamps')
where name = 'A';
select pg_temp.sign_in(1);
set local role authenticated;
update shown set outcome = pg_temp.preview('A') -> 'outcome' where name = 'A';
-- A confirmation of another outcome than the one shown: the send creates the first draft, links A and writes its lines,
-- then compares what it wrote and refuses it; all of it is rolled back (the rollback after the creation, before the end).
select is(pg_temp.refusal($$select pg_temp.confirm('A', jsonb_set((select outcome from shown where name = 'A'), '{lines,0,quantity}', '99'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE outcome_changed', 'a confirmation of an outcome not shown is refused after the creation');
reset role;
select is(pg_temp.counts(), pg_temp.nothing_written(), 'and leaves no version, no line, no receipt, no link, no check');
select pg_temp.sign_in(1);
set local role authenticated;
select is((pg_temp.confirm('A', (select outcome from shown where name = 'A')) ->> 'replayed'), 'false', 'A is sent');
reset role;
select results_eq($$select (select count(*) from public.estimate_versions where project_id = pg_temp.f(20)),
    (select estimate_version_id from public.takeoff_jobs where id = pg_temp.a()),
    (select count(*) from private.takeoff_plan_send_checks)$$,
  $$values (1::bigint, pg_temp.f(705), 0::bigint)$$, 'one first draft, A on it, no check left behind');
select results_eq($$select title, trim_scale(quantity), source_job_id, source_page from public.estimate_items
    where version_id = pg_temp.f(705) and item_type = 'line' order by title$$,
  $$values ('Réseau EF'::text, 4::numeric, pg_temp.a(), 1), ('Vanne d''arrêt DN20'::text, 3::numeric, pg_temp.a(), 2)$$,
  'A''s lines, each with its page');
select is((select (write_plan -> 'context') - 'checked' from public.takeoff_send_receipts where job_id = pg_temp.a()),
  jsonb_build_object('stamps', (select body #> '{expected,context}' from commands where name = 'A'),
    'unit', jsonb_build_object('request_id', pg_temp.request(), 'key', 'plan:' || pg_temp.f(101)),
    'peers', jsonb_build_array(pg_temp.b()),
    'locations', jsonb_build_array(jsonb_build_object('plan_file_id', pg_temp.f(101), 'content_hash', pg_temp.digest(pg_temp.f(101)),
      'location_id', pg_temp.f(3001), 'revision', 1, 'building', null, 'level', 'R+1'))),
  'the receipt records the unit sent, the plan read it was compared with, and the location generation it was sent under');
-- Fix round 2, point 3: and, whole, what its comparison read, which a read compares later with the current state.
select is((select write_plan #> '{context,checked,peers}' from public.takeoff_send_receipts where job_id = pg_temp.a()),
  jsonb_build_array(jsonb_build_object('job_id', pg_temp.b(), 'stamp',
    public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(20), pg_temp.b()))), 'each peer, with the stamp of its lines');
select is((select jsonb_agg(jsonb_build_object('job_id', plan -> 'job_id', 'level', plan #> '{location,level}',
    'current_copy', plan -> 'current_copy') order by plan ->> 'job_id')
    from public.takeoff_send_receipts cross join jsonb_array_elements(write_plan #> '{context,checked,plans}') as plan
    where job_id = pg_temp.a()),
  jsonb_build_array(jsonb_build_object('job_id', pg_temp.a(), 'level', 'R+1', 'current_copy', true),
    jsonb_build_object('job_id', pg_temp.b(), 'level', null, 'current_copy', true)),
  'each plan revision, with its location and copy: A''s at R+1, B''s without a location');
create function pg_temp.drift(p_job uuid) returns jsonb language sql stable as $$
  select public.read_takeoff_send_drift(pg_temp.f(10), pg_temp.f(20), p_job)
$$;
select is(pg_temp.drift(pg_temp.a()) - 'sent_at', jsonb_build_object('changed', false, 'changes', '[]'::jsonb,
    'item_ids', (select jsonb_agg(to_jsonb(id) order by id) from public.takeoff_items where job_id = pg_temp.a())),
  'read right after its send, nothing A compared has changed; the lines it sent are named');
select is(pg_temp.drift(pg_temp.b()), null::jsonb, 'a plan not sent has nothing to compare');

-- 6. B, sent to the same draft, adds its part to A's valve line. A is no longer B's peer (sent): it is the destination's.
create temp table price_before as select unit_price_ht_cents, pricing_status from public.estimate_items
  where version_id = pg_temp.f(705) and title = 'Vanne d''arrêt DN20';
select is(pg_temp.context(pg_temp.b(), pg_temp.f(705)) -> 'peers', '[]'::jsonb, 'a plan sent is no longer a peer');
select is((select jsonb_agg(plan ->> 'job_id' order by plan ->> 'job_id') from jsonb_array_elements(
    pg_temp.context(pg_temp.b(), pg_temp.f(705)) -> 'plans') as plan),
  jsonb_build_array(pg_temp.a(), pg_temp.b()), 'B''s controls read A''s plan, as the destination''s, and B''s');
insert into public.draft_locks (version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.f(705), pg_temp.f(1), pg_temp.f(10), now() + interval '30 minutes', gen_random_uuid());
create function pg_temp.b_command(p_request integer) returns jsonb language sql as $$
  select pg_temp.command(p_request, pg_temp.b(), jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.f(705)),
    jsonb_build_object('kind', 'existing', 'id', pg_temp.f(715)), pg_temp.context(pg_temp.b(), pg_temp.f(705)) -> 'stamps',
    (select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.f(2021), 'estimate_item_id', line.id,
      'expected_updated_at', line.updated_at, 'expected_quantity', line.quantity))
      from public.estimate_items line where line.version_id = pg_temp.f(705) and line.title = 'Vanne d''arrêt DN20'))
$$;
insert into commands values ('B', pg_temp.b_command(606));
select pg_temp.sign_in(1);
set local role authenticated;
insert into shown select 'B', pg_temp.preview('B') -> 'outcome';
reset role;
-- B's plan's copy set aside meanwhile (its cleanup reserved), then given back: refused, then previewed again below.
set local session_replication_role = replica;
update public.plan_files set metadata = metadata || '{"intake_cleanup_pending": "true"}'::jsonb where id = pg_temp.f(102);
set local session_replication_role = origin;
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('B', (select outcome from shown where name = 'B'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE location_changed',
  'B''s plan no longer the dossier''s current copy since its preview: refused (fix round 2, point 2)');
reset role;
set local session_replication_role = replica;
update public.plan_files set metadata = metadata - 'intake_cleanup_pending' where id = pg_temp.f(102);
set local session_replication_role = origin;
update commands set body = pg_temp.b_command(608) where name = 'B';
select pg_temp.sign_in(1);
set local role authenticated;
update shown set outcome = pg_temp.preview('B') -> 'outcome' where name = 'B';
reset role;
-- A location of B's plan corrected meanwhile: refused.
insert into public.takeoff_plan_locations (id, tenant_id, project_id, source_kind, source_id, content_hash, revision,
  building_choice, building, building_set_by, building_set_at, building_set_revision,
  level_choice, level, level_set_by, level_set_at, level_set_revision, plan_file_id, document_name, created_by, updated_by)
values (pg_temp.f(3002), pg_temp.f(10), pg_temp.f(20), 'plan_file', pg_temp.f(102), pg_temp.digest(pg_temp.f(102)), 1,
  'value', 'A', pg_temp.f(1), now(), 1, 'reading', null, pg_temp.f(1), now(), 1, pg_temp.f(102), 'plan-b.pdf', pg_temp.f(1), pg_temp.f(1));
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.refusal($$select pg_temp.confirm('B', (select outcome from shown where name = 'B'))$$),
  '40001 TAKEOFF_SEND_PREVIEW_STALE location_changed', 'B''s plan located since its preview: refused');
reset role;
update commands set body = pg_temp.b_command(607) where name = 'B';
select pg_temp.sign_in(1);
set local role authenticated;
update shown set outcome = pg_temp.preview('B') -> 'outcome' where name = 'B';
select is((pg_temp.confirm('B', (select outcome from shown where name = 'B')) ->> 'replayed'), 'false', 'B is sent');
reset role;
select results_eq($$select title, trim_scale(quantity), (select count(*) from public.estimate_items where version_id = pg_temp.f(705)
      and item_type = 'line' and title = 'Vanne d''arrêt DN20')
    from public.estimate_items where version_id = pg_temp.f(705) and title = 'Vanne d''arrêt DN20'$$,
  $$values ('Vanne d''arrêt DN20'::text, 5::numeric, 1::bigint)$$, 'one valve line of 3 + 2');
select is((select jsonb_agg(jsonb_build_object('job_id', part -> 'job_id', 'quantity', part -> 'quantity') order by part ->> 'job_id')
    from public.estimate_items line cross join jsonb_array_elements(line.source_metadata #> '{takeoff_contributions,parts}') as part
    where line.version_id = pg_temp.f(705) and line.title = 'Vanne d''arrêt DN20'),
  jsonb_build_array(jsonb_build_object('job_id', pg_temp.a(), 'quantity', 3), jsonb_build_object('job_id', pg_temp.b(), 'quantity', 2)),
  'the line keeps both sources: A''s part of 3 and B''s of 2');
select results_eq($$select unit_price_ht_cents, pricing_status from public.estimate_items where version_id = pg_temp.f(705)
    and title = 'Vanne d''arrêt DN20'$$, $$select * from price_before$$, 'its price and pricing status are untouched by B''s send');
select is((select write_plan #> '{context,locations,0,building}' from public.takeoff_send_receipts where job_id = pg_temp.b()),
  '"A"'::jsonb, 'B''s receipt records the building its plan was sent under');
-- What A compared since its send: B, its peer, was sent since (its own send compared it with A: not a change of A's), and
-- B's plan was located after A's send read it without a location (a change).
select is(pg_temp.drift(pg_temp.a()) -> 'changes', jsonb_build_array(jsonb_build_object('reason', 'location_changed',
    'plan_name', 'plan-b.pdf')), 'A''s lines are flagged for B''s location only, never for B''s own send');
select is(pg_temp.drift(pg_temp.b()) -> 'changed', 'false'::jsonb, 'B, sent on what it read, has nothing changed');
-- The dossier's copy of a plan a send read, set aside since (its cleanup reserved): flagged.
set local session_replication_role = replica;
update public.plan_files set metadata = metadata || '{"intake_cleanup_pending": "true"}'::jsonb where id = pg_temp.f(102);
set local session_replication_role = origin;
select is(pg_temp.drift(pg_temp.b()) -> 'changes', jsonb_build_array(jsonb_build_object('reason', 'copy_changed',
    'plan_name', 'plan-b.pdf')), 'B''s lines are flagged once its plan''s copy is no longer the dossier''s current one');
set local session_replication_role = replica;
update public.plan_files set metadata = metadata - 'intake_cleanup_pending' where id = pg_temp.f(102);
set local session_replication_role = origin;

-- 7. C read last: A and B are sent, so C has no peer, and nothing of its request is left to read.
select pg_temp.read(pg_temp.c(), jsonb_build_array(
  jsonb_build_object('id', pg_temp.f(2031), 'designation', 'Réseau EF', 'quantity', 6, 'unit', 'ml', 'page', 1)));
select is(pg_temp.context(pg_temp.c()) -> 'peers', '[]'::jsonb, 'with A and B sent, C has no peer');
select is(pg_temp.context(pg_temp.c()) #> '{display,unread}', '[]'::jsonb, 'and nothing of its request is left to read');
select is(pg_temp.drift(pg_temp.a()) -> 'changes', jsonb_build_array(jsonb_build_object('reason', 'location_changed',
    'plan_name', 'plan-b.pdf')), 'C, read only after A''s send, changes nothing A compared: its own send compares it');

-- 8. A later request reads A and C again (A2, C2, a minute later): A2 is read, C2 still waits. For each other plan, its
-- latest successful reading not sent is the peer; a plan's earlier reading is never its own peer (a reading replaced).
-- Set up without their triggers: the selection of the peers is this file's subject, not the admission of a request.
set local session_replication_role = replica;
insert into public.takeoff_launch_requests
select (jsonb_populate_record(null::public.takeoff_launch_requests, to_jsonb(r) || jsonb_build_object('id', pg_temp.f(5002),
  'intent_key', pg_temp.f(5003), 'state', 'closed', 'outcome', 'success', 'closed_at', now() + interval '2 minutes',
  'completion_event_id', gen_random_uuid(), 'created_at', now() + interval '1 minute'))).*
from public.takeoff_launch_requests r where r.id = pg_temp.request();
insert into public.takeoff_jobs
select (jsonb_populate_record(null::public.takeoff_jobs, to_jsonb(j) || jsonb_build_object('id', reread.id, 'launch_request_id', pg_temp.f(5002),
  'created_at', now() + interval '1 minute', 'status', reread.status, 'analysis_outcome', reread.outcome, 'started_at', null,
  'completed_at', case when reread.status = 'completed' then now() + interval '1 minute' end,
  'analysis_finished_at', case when reread.status = 'completed' then now() + interval '1 minute' end,
  'analysis_completion_event_id', null, 'estimate_version_id', null))).*
from public.takeoff_jobs j join (values (pg_temp.a(), pg_temp.f(1304), 'completed', 'success'), (pg_temp.c(), pg_temp.f(1306), 'pending', null))
  as reread(original, id, status, outcome) on reread.original = j.id;
set local session_replication_role = origin;
-- Fix round 1, point 7: A2's preview compares it with C (C2, its plan's reread, still waits) and says so on C2's line.
select is(pg_temp.context(pg_temp.f(1304)) #> '{display,peers}', jsonb_build_array(jsonb_build_object('job_id', pg_temp.c(),
    'plan_name', 'plan-c.pdf', 'read_at', (select completed_at from public.takeoff_jobs where id = pg_temp.c()), 'request', 'earlier')),
  'A2 is compared with C, read by an earlier request, before A2');
select is(pg_temp.context(pg_temp.f(1304)) #> '{display,unread}', jsonb_build_array(jsonb_build_object('plan_name', 'plan-c.pdf',
    'state', 'queued', 'compared_reading_at', (select completed_at from public.takeoff_jobs where id = pg_temp.c()))),
  'C2, its plan''s reread, is not read: the preview names the earlier reading it compared instead');
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'completed', analysis_outcome = 'success', completed_at = now() + interval '1 minute',
  analysis_finished_at = now() + interval '1 minute' where id = pg_temp.f(1306);
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.f(1306)) -> 'peers', jsonb_build_array(jsonb_build_object('job_id', pg_temp.f(1304),
  'stamp', public.takeoff_rule_job_stamp(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1304)))),
  'C2''s peer is A''s latest reading (A2, not sent), never C, its own plan''s earlier reading');
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(pg_temp.context(pg_temp.f(1304)) -> 'peers') as peer),
  jsonb_build_array(pg_temp.f(1306)), 'A2''s peer is C''s latest reading (C2), not C');
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(pg_temp.context(pg_temp.c()) -> 'peers') as peer),
  jsonb_build_array(pg_temp.f(1304)), 'C, an earlier reading of its plan, is compared with A2 only');
select is(pg_temp.context(pg_temp.c()) #> '{display,peers,0,request}', '"later"'::jsonb,
  'and A2, another request''s reading made after C''s, is never said to be a previous request''s (fix round 2, point 6; red before: it was)');
-- C2 sent (its plan's latest reading is on a version): C, the reading it replaced, is no peer of A2 either. Red before
-- the fix of the selection: the latest unsent reading of plan C, C, was A2's peer beside C2 on its version.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'applied', estimate_version_id = pg_temp.f(705) where id = pg_temp.f(1306);
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.f(1304)) -> 'peers', '[]'::jsonb,
  'a plan whose latest reading was sent has no peer: the reading it replaced is never compared');

-- 9. A plan of the dossier (piece E) read at its first copy, then replaced in the dossier by a new copy (fix round 1,
-- points 2 and 7): its reading of the replaced copy is no longer compared, though the preparation still names that copy
-- (it was not confirmed again since); once it is, the new copy is named never read.
insert into public.affaire_intake_documents (id, upload_id, file_name, upload_status, storage_path, classification_status, document_kind,
  size_bytes, mime_type, classified_at)
values (pg_temp.f(71), pg_temp.f(30), 'plan-e.pdf', 'uploaded', 'fixture/plan-e.pdf', 'classified', 'plans', 8, 'application/pdf',
  '2026-11-01T00:00:00Z');
insert into storage.objects (bucket_id, name, metadata) values ('affaire-intake', 'fixture/plan-e.pdf', '{"size":8}');
create function pg_temp.copy_of_e(file integer) returns void language sql as $$
  insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count, metadata)
  select pg_temp.f(file), pg_temp.f(10), pg_temp.f(40), 'plan-e.pdf',
    concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(file), 'plan-e.pdf'), 'application/pdf', 8, 1,
    jsonb_build_object('source', 'affaire-intake', 'intake_document_id', id, 'intake_storage_path', storage_path,
      'intake_classified_at', classified_at, 'intake_generation', plan_copy_generation)
  from public.affaire_intake_documents where id = pg_temp.f(71)
$$;
select pg_temp.copy_of_e(105);
select is((select source_kind || ':' || source_id from public.takeoff_plan_location_sources where plan_file_id = pg_temp.f(105)),
  'intake_document:' || pg_temp.f(71), 'the copy''s source is its dossier piece');
set local session_replication_role = replica;
insert into public.takeoff_jobs
select (jsonb_populate_record(null::public.takeoff_jobs, to_jsonb(j) || jsonb_build_object('id', pg_temp.f(1308),
  'launch_request_id', pg_temp.f(5002), 'launch_unit_key', 'plan:' || pg_temp.f(105), 'status', 'completed', 'analysis_outcome', 'success',
  'completed_at', now() + interval '1 minute', 'created_at', now() + interval '1 minute', 'estimate_version_id', null,
  'preparation_snapshot', jsonb_set(j.preparation_snapshot, '{preparation,sources}', jsonb_build_array(jsonb_build_object(
    'document_id', pg_temp.f(105), 'document_name', 'plan-e.pdf', 'kind', 'plan', 'active', true, 'confirmed', true,
    'content_hash', pg_temp.digest(pg_temp.f(105)))))))).*
from public.takeoff_jobs j where j.id = pg_temp.f(1304);
-- The preparation retains that copy.
update public.takeoff_preparations set confirmed_snapshot = jsonb_set(confirmed_snapshot, '{preparation,sources}',
  (confirmed_snapshot #> '{preparation,sources}') || jsonb_build_array(jsonb_build_object('document_id', pg_temp.f(105),
    'document_name', 'plan-e.pdf', 'kind', 'plan', 'active', true, 'confirmed', true, 'content_hash', pg_temp.digest(pg_temp.f(105)))))
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(pg_temp.context(pg_temp.c()) -> 'peers') as peer),
  jsonb_build_array(pg_temp.f(1304), pg_temp.f(1308)), 'E''s reading of its current copy is a peer of C');
-- The piece is replaced in the dossier: a new copy of E (106), the first no longer current. The preparation, not
-- confirmed again, still names the first.
update public.affaire_intake_documents set classified_at = '2026-11-03T00:00:00Z' where id = pg_temp.f(71);
select pg_temp.copy_of_e(106);
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(pg_temp.context(pg_temp.c()) -> 'peers') as peer),
  jsonb_build_array(pg_temp.f(1304)),
  'its reading of the replaced copy is no longer compared, whatever the preparation names (red before: it stayed C''s peer)');
select ok(pg_temp.context(pg_temp.c()) #> '{display,never_read}' ? 'plan-e.pdf',
  'and the new copy is named never read at once, though no manifest or preparation names it yet (fix round 2, point 6; red before: it vanished)');
select ok(pg_temp.context(pg_temp.f(1304)) #> '{display,never_read}' ? 'plan-e.pdf',
  'also for a plan of the request that read the replaced copy (A2''s, with E''s first copy): only a reading of the current copy covers it (fix round 3, point 4; red before: excluded by its piece)');
-- The preparation confirmed again, on the new copy.
set local session_replication_role = replica;
update public.takeoff_preparations set confirmed_snapshot = jsonb_set(confirmed_snapshot, '{preparation,sources}',
  (select jsonb_agg(case when source.value ->> 'document_id' = pg_temp.f(105)::text then jsonb_build_object('document_id',
      pg_temp.f(106), 'document_name', 'plan-e-v2.pdf', 'kind', 'plan', 'active', true, 'confirmed', true, 'content_hash',
      pg_temp.digest(pg_temp.f(106))) else source.value end order by source.ordinality)
    from jsonb_array_elements(confirmed_snapshot #> '{preparation,sources}') with ordinality as source(value, ordinality)))
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is((select jsonb_agg(peer -> 'job_id') from jsonb_array_elements(pg_temp.context(pg_temp.c()) -> 'peers') as peer),
  jsonb_build_array(pg_temp.f(1304)), 'still not compared');
select is((select count(*)::integer from jsonb_array_elements_text(pg_temp.context(pg_temp.c()) #> '{display,never_read}') as name
    where name = 'plan-e.pdf'), 1,
  'and is named never read once, by its file, though the replaced copy of its piece was read (red before: it was hidden)');
-- A grouped or standalone analysis has no peer: the context of a job outside a request of format 2.
set local session_replication_role = replica;
insert into public.takeoff_jobs
select (jsonb_populate_record(null::public.takeoff_jobs, to_jsonb(j) || jsonb_build_object('id', pg_temp.f(1307),
  'launch_request_id', null, 'launch_unit_key', null, 'status', 'completed', 'estimate_version_id', null))).*
from public.takeoff_jobs j where j.id = pg_temp.c();
set local session_replication_role = origin;
select is(pg_temp.context(pg_temp.f(1307)) -> 'peers', '[]'::jsonb, 'an analysis outside a request of one plan per job has no peer');
select is(pg_temp.context(pg_temp.f(1307)) -> 'display', 'null'::jsonb, 'and no plan scope');

-- Fix round 3, point 3: what the previous application pays. The check table has no foreign key (no internal trigger on a
-- deletion of a job or a version) and is read or written only by a send of an analysis of one plan. An analysis launched
-- outside any request, sent by a command without a context (the previous server's) onto V1, and a job deleted: neither
-- scans, inserts into nor deletes from the check table. Red before: the send deleted from it unconditionally, and its
-- foreign keys cascaded each deletion of a job or a version into it.
select is((select count(*)::integer from pg_constraint where conrelid = 'private.takeoff_plan_send_checks'::regclass and contype = 'f'), 0,
  'the check table has no foreign key');
set local session_replication_role = replica;
insert into public.takeoff_jobs
select (jsonb_populate_record(null::public.takeoff_jobs, to_jsonb(j) || jsonb_build_object('id', pg_temp.f(1309),
  'launch_request_id', null, 'launch_unit_key', null, 'status', 'completed', 'estimate_version_id', null,
  'analysis_completion_event_id', null, 'created_at', now() + interval '3 minutes'))).*
from public.takeoff_jobs j where j.id = pg_temp.a();
insert into public.takeoff_results (id, tenant_id, job_id) values (pg_temp.f(2309), pg_temp.f(10), pg_temp.f(1309));
insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name, source_page,
  confidence, metadata)
values (pg_temp.f(2391), pg_temp.f(10), pg_temp.f(1309), pg_temp.f(2309), 'Robinet de puisage fictif', 2, 'u', 'Repère fictif',
  'plan-a.pdf', 9, 0.95, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.f(101))));
set local session_replication_role = origin;
create temp table checks_seen as
select 'before'::text as moment, seq_scan, coalesce(idx_scan, 0) as idx_scan, n_tup_ins, n_tup_del
from pg_stat_xact_user_tables where relid = 'private.takeoff_plan_send_checks'::regclass;
insert into commands values ('standalone', pg_temp.command(609, pg_temp.f(1309), jsonb_build_object('kind', 'existing_draft',
  'version_id', pg_temp.f(705)), jsonb_build_object('kind', 'existing', 'id', pg_temp.f(715)), null));
select pg_temp.sign_in(1);
set local role authenticated;
insert into shown select 'standalone', pg_temp.preview('standalone') -> 'outcome';
select is((pg_temp.confirm('standalone', (select outcome from shown where name = 'standalone')) ->> 'replayed'), 'false',
  'an analysis outside any request is sent onto V1 by a command without a context (the previous server''s)');
reset role;
select is((select estimate_version_id from public.takeoff_jobs where id = pg_temp.f(1309)), pg_temp.f(705), 'it is on V1');
delete from public.takeoff_jobs where id = pg_temp.f(1307);
insert into checks_seen
select 'after', seq_scan, coalesce(idx_scan, 0), n_tup_ins, n_tup_del
from pg_stat_xact_user_tables where relid = 'private.takeoff_plan_send_checks'::regclass;
select is((select jsonb_agg(to_jsonb(seen) - 'moment' order by moment desc) from checks_seen as seen) -> 0,
  (select jsonb_agg(to_jsonb(seen) - 'moment' order by moment desc) from checks_seen as seen) -> 1,
  'its preview, its send and a job''s deletion neither read nor write the check table');

select * from finish();
rollback;
