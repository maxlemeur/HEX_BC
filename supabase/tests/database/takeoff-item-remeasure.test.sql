-- Lot 4, PR 4b (…_takeoff_item_remeasure_admission.sql): a request may ask part of the list, and a member measures a
-- selection of items again.
-- 1. What a request asks (private.takeoff_request_asked_items): without asked_item_ids, every entry of its revision.
-- 2. The seal admits asked_item_ids in one shape only, and only inside the admission of a new measure of a selection:
--    an ordinary launch, manual or automatic, that carries it is refused; without it, unchanged. The marker it checks is a
--    custom setting no member can set (no grant reaches the launch or the seal, and no setter is exposed); another function
--    of the same transaction could, as this file's own seal tests do.
-- 3. The admission (public.launch_takeoff_item_remeasure): its refusals, each before anything is recorded (a malformed
--    command or an item outside the sealed revision, a plan named with another plan's identity, a preparation other than
--    the one confirmed or a whole plan's page count other than the stored one), its compare-and-set, its receipt (the
--    member's right first; everything confirmed in its digest, the preview and the setting included), and its replay by
--    what the member confirmed alone (public.replay_takeoff_item_remeasure).
-- 4. While a new measure of a selection runs, only its items read on its plans; a publication answers exactly what was
--    asked; the new answer replaces the earlier reading, undecided, the earlier decision and the entries untouched.
-- 5. A plan already sent is measured again without anything of its sent analysis changing; a new measure that fails
--    leaves the earlier reading the current one.
-- 6. An item no request asked on a plan has no pair there: neither failed nor incomplete.
-- Isolation justified: what a request asks, the coverage of its publication and the pairs are the database's rules, which
-- a journey sees only through a few states. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('d5700000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.host() returns text language sql immutable as $$ select 'urn:uuid:d5700000-0000-4000-8000-000000000099' $$;
create function pg_temp.selection() returns jsonb language sql immutable as $$
  select jsonb_build_object('profileId', 'profil-fictif', 'model', 'modele-fictif', 'reasoningEffort', null, 'hostId', pg_temp.host(),
    'authorizationId', 'autorisation-fictive')
$$;
create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.f(n))::text, true);
$$;

-- One tenant: the engineer who owns the affaire (1) and one who does not (2).
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'item-remeasure-' || n || '@example.test', '{}'::jsonb, now() from generate_series(1, 2) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'd5700000-%';
insert into public.tenants (id, name, slug) values (pg_temp.f(10), 'Nouvelle mesure (fictif)', 'item-remeasure-test');
update public.feature_flags set enabled = true where tenant_id = pg_temp.f(10) and flag_key = 'TAKEOFF_MODULE_ENABLED';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.f(10), pg_temp.f(1), 'engineer', true, '2020-01-01'),
  (pg_temp.f(10), pg_temp.f(2), 'engineer', true, '2020-01-01');
-- Affaire 20, read on two plans: A (100) and B (101), each on its pages 2 and 7.
insert into public.estimate_projects (id, tenant_id, user_id, name)
values (pg_temp.f(20), pg_temp.f(10), pg_temp.f(1), 'Affaire remesurée (fictive)');
insert into public.affaire_intake_uploads (id, project_id, created_by, status) values (pg_temp.f(30), pg_temp.f(20), pg_temp.f(1), 'ready');
insert into public.affaire_briefs (id, project_id, upload_id, status, summary, project_object, confirmed_at, confirmed_by)
values (pg_temp.f(60), pg_temp.f(20), pg_temp.f(30), 'confirme', 'Résumé fictif', 'Objet fictif', now(), pg_temp.f(1));
insert into public.plan_sets (id, tenant_id, project_id, name) values (pg_temp.f(40), pg_temp.f(10), pg_temp.f(20), 'Plans du dossier');
insert into public.plan_files (id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
select pg_temp.f(100 + n), pg_temp.f(10), pg_temp.f(40), name,
  concat_ws('/', pg_temp.f(10), pg_temp.f(40), pg_temp.f(100 + n), name), 'application/pdf', 8, 9
from (values (0, 'plan-a.pdf'), (1, 'plan-b.pdf')) as plan(n, name);
-- The list: lavabo 300, vanne 301, baignoire 302 in revision 310 (its revision 1).
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
select pg_temp.f(item), pg_temp.f(10), pg_temp.f(20), 'manual', 1, pg_temp.f(1) from generate_series(300, 302) as item;
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
values (pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), 1, 'item_added', '{}', 3, repeat('1', 64), repeat('a', 64), pg_temp.f(311),
  pg_temp.f(1));
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select pg_temp.f(310), pg_temp.f(10), pg_temp.f(20), pg_temp.f(300 + k), k, 'manual:poste-' || k, label, 'u', 'manual',
  '{"kind":"manual"}'
from (values (0, 'Lavabo (fictif)'), (1, 'Vanne DN32 (fictive)'), (2, 'Baignoire (fictive)')) as entry(k, label);
set local session_replication_role = origin;

create function pg_temp.plan(n integer) returns uuid language sql immutable as $$ select pg_temp.f(100 + n) $$;
create function pg_temp.digest(plan uuid) returns text language sql immutable as $$
  select encode(sha256(convert_to(plan::text, 'UTF8')), 'hex')
$$;
-- The confirmed preparation of the affaire reads both plans; a request seals the part of it its plans read.
create function pg_temp.snapshot(plans uuid[], payer integer default 1) returns jsonb language sql stable as $$
  select jsonb_build_object('schema_version', 1, 'preparation_revision', 1, 'confirmed_by', pg_temp.f(payer),
    'confirmed_at', '2026-11-22T08:00:00Z', 'execution_selection', pg_temp.selection(),
    'readiness', jsonb_build_object('status', 'ready', 'can_launch', true, 'blockers', '[]'::jsonb, 'reservations', '[]'::jsonb),
    'preparation', jsonb_build_object('schema_version', 1,
      'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
      'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
      'sources', (select jsonb_agg(jsonb_build_object('document_id', f.id, 'document_name', f.file_name, 'kind', 'plan',
          'active', true, 'confirmed', true, 'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count,
          'source_updated_at', f.updated_at, 'content_hash', pg_temp.digest(f.id), 'pages', '[2, 7]'::jsonb) order by f.file_name)
        from public.plan_files f where f.id = any (plans))))
$$;
set local session_replication_role = replica;
insert into public.takeoff_preparations (tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by,
  updated_by)
values (pg_temp.f(10), pg_temp.f(20), 1, pg_temp.snapshot(array[pg_temp.plan(0), pg_temp.plan(1)]) -> 'preparation',
  pg_temp.snapshot(array[pg_temp.plan(0), pg_temp.plan(1)]), now(), pg_temp.f(1), pg_temp.f(1));
set local session_replication_role = origin;

-- The sealed order's list: the revision as stored, and the items asked when some are named (as text, in their order).
create function pg_temp.list(p_revision integer, asked integer[] default null) returns jsonb language sql stable as $$
  select jsonb_build_object('revision_id', r.id, 'revision', r.revision, 'content_sha256', r.content_sha256,
    'item_count', r.item_count)
    || case when asked is null then '{}'::jsonb else jsonb_build_object('asked_item_ids',
      (select jsonb_agg(pg_temp.f(i)::text order by pg_temp.f(i)) from unnest(asked) i)) end
  from public.takeoff_list_revisions r where r.id = pg_temp.f(p_revision)
$$;
create function pg_temp.manifest(list jsonb, plans uuid[]) returns jsonb language sql stable as $$
  select jsonb_build_object('format_version', 2, 'intent', 'initial',
    'order', jsonb_build_object('kind', 'item_list', 'version', 2, 'list', list),
    'dispatch', jsonb_build_object('order', 'display_name', 'version', 1),
    'units', (select jsonb_agg(jsonb_build_object('key', 'plan:' || f.id, 'ordinal', o.position, 'plans', jsonb_build_array(f.id),
        'pages', '[2, 7]'::jsonb, 'page_count', 9, 'vector_pages', 0,
        'budget', jsonb_build_object('tokens', 400000, 'cost_cents', 2500)) order by o.position)
      from unnest(plans) with ordinality o(plan, position) join public.plan_files f on f.id = o.plan),
    'plans', (select jsonb_agg(jsonb_build_object('entry_key', f.id, 'plan_file_id', f.id, 'name', f.file_name, 'logical_id', f.id,
        'intake_document_id', null, 'generation', 'generation-fictive-1', 'content_sha256', pg_temp.digest(f.id),
        'pages', '[2, 7]'::jsonb, 'page_count', 9) order by o.position)
      from unnest(plans) with ordinality o(plan, position) join public.plan_files f on f.id = o.plan),
    'coverage', jsonb_build_object('plans_retained', cardinality(plans), 'plans_omitted', '[]'::jsonb), 'references', '[]'::jsonb,
    'budget', jsonb_build_object('tokens', 400000 * cardinality(plans), 'cost_cents', 2500 * cardinality(plans)))
$$;
-- The job of a round on a plan: 1000 + 10 * round + its plan's number.
create function pg_temp.job(round integer, plan uuid) returns uuid language sql immutable as $$
  select pg_temp.f(1000 + 10 * round + case when plan = pg_temp.plan(0) then 0 else 1 end)
$$;
create function pg_temp.jobs(round integer, plans uuid[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('id', pg_temp.job(round, f.id), 'plan_set_id', pg_temp.f(40), 'launch_unit_key', 'plan:' || f.id,
    'source_file_name', f.file_name, 'source_file_type', 'application/pdf', 'source_file_size_bytes', 8, 'prompt_version', 'fixture',
    'execution_host_id', pg_temp.host()) order by o.position)
  from unnest(plans) with ordinality o(plan, position) join public.plan_files f on f.id = o.plan
$$;
-- Each item's current answers on these plans, as stored (its greatest reading on each plan).
create function pg_temp.seen(item integer, plans uuid[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(a.id order by a.id), '[]'::jsonb) from public.takeoff_item_answers a
  where a.item_id = pg_temp.f(item) and a.plan_logical_id = any (plans)
    and a.reading_revision = (select max(b.reading_revision) from public.takeoff_item_answers b
      where b.item_id = a.item_id and b.plan_logical_id = a.plan_logical_id)
$$;
create function pg_temp.targets(items integer[], plans uuid[]) returns jsonb language sql stable as $$
  select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(i), 'answers', pg_temp.seen(i, plans)) order by pg_temp.f(i))
  from unnest(items) i
$$;
-- What the member confirmed besides the readings: the digest of the preview confirmed and the setting chosen for it.
create function pg_temp.confirmation(digest text default 'c', effort text default null) returns jsonb language sql immutable as $$
  select jsonb_build_object('preview_digest', repeat(digest, 64), 'setting',
    case when effort is null then null else jsonb_build_object('reasoning_effort', effort) end)
$$;
create function pg_temp.remeasure(key integer, items integer[], plans uuid[], round integer, actor integer default 1,
  revision integer default 310, targets jsonb default null, predecessor uuid default null,
  confirmation jsonb default pg_temp.confirmation())
returns table (outcome text, request_id uuid, job_id uuid, stale uuid[]) language sql as $$
  select * from public.launch_takeoff_item_remeasure(pg_temp.f(10), pg_temp.f(20), pg_temp.f(actor), pg_temp.f(key),
    coalesce(predecessor, pg_temp.job(1, plans[1])), pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(pg_temp.list(revision, items), plans), pg_temp.snapshot(plans, actor), pg_temp.jobs(round, plans),
    pg_temp.f(40), 1, plans, coalesce(targets, pg_temp.targets(items, plans)), confirmation)
$$;
-- The replay of a confirmation by what the member confirmed alone (the route's first step, before any planning).
create function pg_temp.replay(key integer, items integer[], plans uuid[], actor integer default 1, revision integer default 310,
  targets jsonb default null, confirmation jsonb default pg_temp.confirmation())
returns table (outcome text, request_id uuid, job_id uuid) language sql as $$
  select * from public.replay_takeoff_item_remeasure(pg_temp.f(10), pg_temp.f(20), pg_temp.f(actor), pg_temp.f(key), plans,
    pg_temp.f(revision), coalesce(targets, pg_temp.targets(items, plans)), pg_temp.selection(), confirmation)
$$;
create function pg_temp.claim(job uuid, token integer) returns integer language sql as $$
  select count(*)::integer from public.claim_observed_local_takeoff_job(job, pg_temp.f(10), pg_temp.host(), clock_timestamp(),
    pg_temp.f(token), clock_timestamp() + interval '30 minutes', 'modele-fictif', 'fixture', 'pending', 0)
$$;
-- The worker's answers: an item measured (one row of the result, page 2), or not found.
create function pg_temp.measured(item integer, row_ integer, quantity numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('item_id', pg_temp.f(item), 'outcome', 'measured', 'reasons', '[]'::jsonb,
    'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'quantity', jsonb_build_object('value', quantity, 'unit', 'u'),
    'candidate', null, 'observations', jsonb_build_array(jsonb_build_object('page', 2, 'evidence', 'Symboles fictifs',
      'method', 'symbol_count', 'confidence', 0.9, 'quantity', quantity, 'unit', 'u', 'measurement_basis', null,
      'role', 'contribution', 'source', 'model', 'chunk_id', 'f1-b1', 'vector_key', null, 'takeoff_item_id', pg_temp.f(row_))))
$$;
create function pg_temp.not_found(item integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('item_id', pg_temp.f(item), 'outcome', 'not_found',
    'reasons', jsonb_build_array(jsonb_build_object('code', 'NO_INDICATION', 'by', 'model', 'text', 'Aucun indice (fictif).',
      'chunk_id', 'f1-b1')),
    'searched_pages', '[2, 7]'::jsonb, 'unreadable_pages', '[]'::jsonb, 'candidate', null, 'observations', '[]'::jsonb)
$$;
create function pg_temp.row_(n integer, quantity numeric, file text) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.f(n), 'designation', 'Poste (fictif)', 'quantity', quantity, 'unit', 'u',
    'confidence', 0.9, 'evidence', 'Symboles fictifs', 'source_file_name', file, 'source_page', 2, 'metadata', '{}'::jsonb)
$$;
create function pg_temp.publish(job uuid, token integer, answers jsonb, items jsonb)
returns table (result_id uuid, replayed boolean, answer_count integer) language sql as $$
  select * from public.publish_takeoff_item_answers(job, pg_temp.f(token), '2026-11-22T09:00:00Z', 'modele-fictif',
    'takeoff-c-postes-v1', '{"schema_version": "v2", "prompt_version": "takeoff-c-postes-v1"}'::jsonb, array[2, 7], answers,
    '[]'::jsonb, jsonb_build_object('extracted_json', '{}'::jsonb, 'warnings', '[]'::jsonb, 'tables', '[]'::jsonb,
      'provider_meta', '{}'::jsonb, 'confidence', null, 'token_count', 10, 'cost_cents', 0, 'duration_ms', 5, 'job_duration_ms', 6,
      'run_metrics', '[]'::jsonb), items, null)
$$;
create function pg_temp.pairs() returns table (item uuid, plan uuid, job uuid, reading text, unit_state text, answer uuid)
language sql stable as $$
  select p.item_id, p.plan_logical_id, p.job_id, p.reading, p.unit_state, p.answer_id
  from private.takeoff_item_reading_pairs(pg_temp.f(10), pg_temp.f(20), null) p
$$;
create function pg_temp.state(item integer) returns text language sql stable as $$
  select s.state from private.takeoff_item_reading_states(pg_temp.f(10), pg_temp.f(20), null) s where s.item_id = pg_temp.f(item)
$$;
create function pg_temp.request_of(job uuid) returns public.takeoff_launch_requests language sql stable as $$
  select r from public.takeoff_launch_requests r join public.takeoff_jobs j on j.launch_request_id = r.id where j.id = job
$$;
-- The member's own review command (B2), on items in the affaire's scope as they are now.
create function pg_temp.review(gesture text, key integer, items integer[], extra jsonb default '{}'::jsonb) returns jsonb
language sql as $$
  select public.review_takeoff_items(pg_temp.f(10), pg_temp.f(20), jsonb_build_object('command_version', 1,
    'intent_key', pg_temp.f(key), 'gesture', gesture, 'scope', '{"kind":"affaire"}'::jsonb,
    'targets', (select jsonb_agg(jsonb_build_object('item_id', pg_temp.f(i), 'entry_revision', coalesce((select e.revision
        from public.takeoff_item_entries e where e.item_id = pg_temp.f(i) and e.plan_logical_id is null), 0),
      'answers', (select coalesce(jsonb_agg(jsonb_build_object('answer_id', a.value #>> '{}', 'decision_revision',
          coalesce((select d.revision from public.takeoff_item_answer_decisions d where d.answer_id = (a.value #>> '{}')::uuid), 0),
          'entry_revision', 0)), '[]'::jsonb)
        from jsonb_array_elements(pg_temp.seen(i, array[pg_temp.plan(0), pg_temp.plan(1)])) a(value)))
      order by i) from unnest(items) i),
    'apply', (select jsonb_agg(pg_temp.f(i) order by i) from unnest(items) i), 'skipped', '[]'::jsonb) || extra)
$$;

-- A statement run and undone, whatever it answers: its answer, or its error's code and message. A refusal writes nothing
-- either way; an admission the test expects refused leaves nothing behind for the assertions after it.
create function pg_temp.attempt(statement text, setup text[] default '{}') returns text language plpgsql as $$
declare
  answer text;
  step text;
begin
  begin
    foreach step in array setup loop
      execute step;
    end loop;
    execute statement into answer;
    raise exception using errcode = 'P0001', message = 'UNDONE:' || coalesce(answer, '');
  exception when others then
    if sqlerrm like 'UNDONE:%' then
      return pg_catalog.substr(sqlerrm, 8);
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$$;
-- A new measure with its command written out: the manifest, the snapshot and the targets as given.
create function pg_temp.remeasure_as(key integer, manifest jsonb, snapshot jsonb, plans uuid[], targets jsonb, round integer)
returns text language sql as $$
  select format($remeasure$select outcome from public.launch_takeoff_item_remeasure(%L, %L, %L, %L, %L, %L, %L::jsonb,
    %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[], %L::jsonb, %L::jsonb)$remeasure$, pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    pg_temp.f(key), pg_temp.job(1, plans[1]), pg_temp.host(), pg_temp.selection(), manifest, snapshot, pg_temp.jobs(round, plans),
    pg_temp.f(40), plans, targets, pg_temp.confirmation())
$$;

-- Every activation, the second measuring order's included.
insert into private.takeoff_launch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_completion_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');

-- The first reading of the affaire, on both plans, against the whole list: the lavabo measured on each plan (2 on A, 1
-- on B), the valve and the bathtub not found.
select results_eq($$select outcome from public.launch_manual_takeoff_plan_request(pg_temp.f(10), pg_temp.f(20), pg_temp.f(1),
    pg_temp.f(500), 'initial', null, pg_temp.host(), pg_temp.selection(),
    pg_temp.manifest(pg_temp.list(310), array[pg_temp.plan(0), pg_temp.plan(1)]), pg_temp.snapshot(array[pg_temp.plan(0), pg_temp.plan(1)]),
    pg_temp.jobs(1, array[pg_temp.plan(0), pg_temp.plan(1)]), pg_temp.f(40), 1, array[pg_temp.plan(0), pg_temp.plan(1)])$$,
  $$values ('admitted'::text)$$, 'the first reading of both plans is admitted');
select is(pg_temp.claim(pg_temp.job(1, pg_temp.plan(0)), 901), 1, 'plan A is read');
select is((select answer_count from pg_temp.publish(pg_temp.job(1, pg_temp.plan(0)), 901,
    jsonb_build_array(pg_temp.measured(300, 811, 2), pg_temp.not_found(301), pg_temp.not_found(302)),
    jsonb_build_array(pg_temp.row_(811, 2, 'plan-a.pdf')))), 3, 'its answers published, every item of the list');
select is(pg_temp.claim(pg_temp.job(1, pg_temp.plan(1)), 902), 1, 'then plan B');
select is((select answer_count from pg_temp.publish(pg_temp.job(1, pg_temp.plan(1)), 902,
    jsonb_build_array(pg_temp.measured(300, 821, 1), pg_temp.not_found(301), pg_temp.not_found(302)),
    jsonb_build_array(pg_temp.row_(821, 1, 'plan-b.pdf')))), 3, 'and its answers');
update public.takeoff_items set rules_stale = false, rules_evaluated_at = now(), rule_results = '[]'::jsonb
where job_id in (pg_temp.job(1, pg_temp.plan(0)), pg_temp.job(1, pg_temp.plan(1)));

-- 1. A request without asked_item_ids asks every entry of its revision, as before.
select results_eq($$select item_id from private.takeoff_request_asked_items(pg_temp.request_of(pg_temp.job(1, pg_temp.plan(0))))
  order by item_id$$, $$values (pg_temp.f(300)), (pg_temp.f(301)), (pg_temp.f(302))$$,
  'a request that names no items asks every entry of its revision');
select is((select count(*)::integer from pg_temp.pairs() where reading = 'answered'), 6, 'each item has a pair on each plan, answered');

-- 2. The seal: asked_item_ids, when present, is a non-empty array of at most 1,000 entries of the sealed revision, each
--    once, in their canonical order (by identifier, as lower-case text); any other shape or key is refused.
-- Under the marker of the admission of a new measure (the request's own intention key unless another is given).
create function pg_temp.seal(list jsonb, marker text default null) returns uuid language plpgsql as $$
declare
  sealed uuid;
begin
  perform set_config('mergeone.takeoff_item_remeasure',
    coalesce(marker, (pg_temp.request_of(pg_temp.job(1, pg_temp.plan(0)))).intent_key::text), true);
  sealed := private.assert_takeoff_launch_order(pg_temp.request_of(pg_temp.job(1, pg_temp.plan(0))),
    pg_temp.manifest(list, array[pg_temp.plan(0)]));
  perform set_config('mergeone.takeoff_item_remeasure', '', true);
  return sealed;
end;
$$;
select is(pg_temp.seal(pg_temp.list(310, array[301, 300])), pg_temp.f(310), 'a list naming two entries in their order is sealed');
select is(pg_temp.seal(pg_temp.list(310)), pg_temp.f(310), 'and a list naming none, as before');
select throws_ok(format('select pg_temp.seal(%L::jsonb)', pg_temp.list(310) || jsonb_build_object('asked_item_ids', value)), '22023',
  'TAKEOFF_LAUNCH_SEAL_INVALID', 'the seal refuses asked items ' || label)
from (values ('"x"'::jsonb, 'that are not an array'), ('[]'::jsonb, 'that are none'),
  (jsonb_build_array(upper(pg_temp.f(300)::text)), 'not in their canonical text'),
  (jsonb_build_array(pg_temp.f(300)::text, pg_temp.f(300)::text), 'named twice'),
  (jsonb_build_array(pg_temp.f(301)::text, pg_temp.f(300)::text), 'out of their order'),
  (jsonb_build_array(pg_temp.f(999)::text), 'outside the sealed revision'),
  (jsonb_build_array(300), 'that are not text'),
  ((select jsonb_agg(('d5700000-0000-4000-8000-' || lpad(n::text, 12, '0')) order by n) from generate_series(1, 1001) n),
    'beyond 1,000')) as cases(value, label);
select throws_ok(format('select pg_temp.seal(%L::jsonb)', pg_temp.list(310) || '{"items": []}'::jsonb), '22023',
  'TAKEOFF_LAUNCH_SEAL_INVALID', 'and any other key of the list');
-- Only the admission of a new measure of a selection seals the items asked: its marker names the request's intention key.
select throws_ok(format('select pg_temp.seal(%L::jsonb, %L)', pg_temp.list(310, array[300]), ''), '22023',
  'TAKEOFF_LAUNCH_SEAL_INVALID', 'without the admission''s marker, a list naming its items is refused');
select throws_ok(format('select pg_temp.seal(%L::jsonb, %L)', pg_temp.list(310, array[300]), pg_temp.f(999)), '22023',
  'TAKEOFF_LAUNCH_SEAL_INVALID', 'and so it is under the marker of another intention');
select is(pg_temp.seal(pg_temp.list(310), ''), pg_temp.f(310), 'a list naming none needs no marker, as before');
-- Through the ordinary launches, run and undone: the manual command and the automatic admission refuse a list naming
-- its items, and admit the same launch without it as before.
create function pg_temp.manual_sql(key integer, list jsonb) returns text language sql stable as $$
  select format($launch$select outcome from public.launch_manual_takeoff_plan_request(%L, %L, %L, %L, 'reread_plans', %L, %L,
    %L::jsonb, %L::jsonb, %L::jsonb, %L::jsonb, %L, 1, %L::uuid[])$launch$, pg_temp.f(10), pg_temp.f(20), pg_temp.f(1), pg_temp.f(key),
    pg_temp.job(1, pg_temp.plan(0)), pg_temp.host(), pg_temp.selection(), pg_temp.manifest(list, array[pg_temp.plan(0)]),
    pg_temp.snapshot(array[pg_temp.plan(0)]), pg_temp.jobs(9, array[pg_temp.plan(0)]), pg_temp.f(40), array[pg_temp.plan(0)])
$$;
select is(pg_temp.attempt(pg_temp.manual_sql(520, pg_temp.list(310, array[300]))), '22023 TAKEOFF_LAUNCH_SEAL_INVALID',
  'a manual launch naming one item of three is refused');
select is(pg_temp.attempt(pg_temp.manual_sql(520, pg_temp.list(310))), 'admitted', 'without it, the same launch is admitted');
-- The affaire's automatic request, waiting for its seal under its evaluation's lease.
create function pg_temp.automatic_sql(list jsonb) returns text language sql stable as $$
  select format($admit$select outcome || ':' || coalesce(reason_code, '') from public.admit_takeoff_launch_request(%L, %L, %s,
    %L::jsonb, %L::jsonb, %L::jsonb)$admit$, pg_temp.f(95), pg_temp.f(96),
    private.takeoff_launch_mark_position(pg_temp.f(10), pg_temp.f(20)), pg_temp.manifest(list, array[pg_temp.plan(0)]),
    pg_temp.snapshot(array[pg_temp.plan(0)]), pg_temp.jobs(9, array[pg_temp.plan(0)]))
$$;
create function pg_temp.automatic_request() returns text[] language sql immutable as $$
  select array['set local session_replication_role = replica', format($request$insert into public.takeoff_launch_requests (id, tenant_id, project_id, origin, intent, intent_key, state,
    payer_id, mandate_kind, mandated_at, execution_host_id, mandate_selection, evaluation_lease_token, evaluation_lease_expires_at)
    values (%L, %L, %L, 'automatic', 'initial', %L, 'evaluating', %L, 'confirmation', now(), %L, %L::jsonb, %L,
      now() + interval '1 hour')$request$, pg_temp.f(95), pg_temp.f(10), pg_temp.f(20), pg_temp.f(95), pg_temp.f(1), pg_temp.host(),
    pg_temp.selection(), pg_temp.f(96)), 'set local session_replication_role = origin']
$$;
select is(pg_temp.attempt(pg_temp.automatic_sql(pg_temp.list(310, array[300])), pg_temp.automatic_request()),
  '22023 TAKEOFF_LAUNCH_SEAL_INVALID', 'an automatic admission naming one item of three is refused');
select is(pg_temp.attempt(pg_temp.automatic_sql(pg_temp.list(310)), pg_temp.automatic_request()), 'admitted:',
  'without it, the same admission is admitted');

-- 3. The admission's refusals: each writes nothing.
create temp table requests_before as select count(*)::integer as n from public.takeoff_launch_requests;
delete from private.takeoff_plan_dispatch_activation;
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2)$$, '55000',
  'TAKEOFF_ITEM_REMEASURE_INACTIVE', 'refused while one analysis per plan is not active');
insert into private.takeoff_plan_dispatch_activation (active_from) values (now() - interval '1 minute');
delete from private.takeoff_item_list_order_activation;
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2)$$, '55000',
  'TAKEOFF_ITEM_REMEASURE_INACTIVE', 'and while the item-list order is not active');
insert into private.takeoff_item_list_order_activation (active_from) values (now() - interval '1 minute');
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2,
    targets => pg_temp.targets(array[300, 301], array[pg_temp.plan(0)]))$$, '22023', 'TAKEOFF_ITEM_REMEASURE_INVALID',
  'refused when its targets are not the items it seals');
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2, actor => 2)$$, '42501',
  'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'refused for a member who may not launch on the affaire');
-- Plan A's file named with plan B's identity (two plans uploaded separately, each its own plan), and B's answer as seen:
-- refused, so that no answer of A's reading is ever published as a reading of B.
select is(pg_temp.attempt(pg_temp.remeasure_as(700,
    jsonb_set(pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]), '{plans,0,logical_id}', to_jsonb(pg_temp.plan(1))),
    pg_temp.snapshot(array[pg_temp.plan(0)]), array[pg_temp.plan(0)], pg_temp.targets(array[300], array[pg_temp.plan(1)]), 2)),
  '22023 TAKEOFF_ITEM_REMEASURE_INVALID', 'a plan named with another plan''s identity is refused');
select is(pg_temp.attempt(pg_temp.remeasure_as(700,
    jsonb_set(pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]), '{plans,0,intake_document_id}',
      to_jsonb(pg_temp.plan(1))),
    pg_temp.snapshot(array[pg_temp.plan(0)]), array[pg_temp.plan(0)], pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  '22023 TAKEOFF_ITEM_REMEASURE_INVALID', 'and so is a plan file named as the copy of a piece it is not');
-- The preparation confirmed plan A on its pages 2 and 7: a command reading page 2 alone, its manifest and its snapshot
-- agreeing with each other, is refused; so is one reading other bytes, or a preparation revision other than the stored.
select is(pg_temp.attempt(pg_temp.remeasure_as(700,
    jsonb_set(jsonb_set(pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]), '{plans,0,pages}', '[2]'),
      '{units,0,pages}', '[2]'),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation,sources,0,pages}', '[2]'), array[pg_temp.plan(0)],
    pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  '22023 TAKEOFF_LAUNCH_SEAL_INVALID', 'a plan read on fewer pages than the preparation confirmed is refused');
select is(pg_temp.attempt(pg_temp.remeasure_as(700,
    jsonb_set(pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]), '{plans,0,content_sha256}',
      to_jsonb(repeat('e', 64))),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation,sources,0,content_hash}', to_jsonb(repeat('e', 64))),
    array[pg_temp.plan(0)], pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  '22023 TAKEOFF_LAUNCH_SEAL_INVALID', 'and so is a plan whose bytes are not those the preparation confirmed');
select is(pg_temp.attempt(replace(pg_temp.remeasure_as(700, pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation_revision}', '2'), array[pg_temp.plan(0)],
    pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2), ', 1, ''{', ', 2, ''{')),
  '22023 TAKEOFF_LAUNCH_SEAL_INVALID', 'and so is a preparation revision the affaire has not confirmed');
-- A plan read whole: its page count is its coverage. The preparation confirmed plan A whole, of nine pages: a command
-- whose manifest and unit count one page is refused; one whose stored count is unknown (the server counts the PDF) is not.
set local session_replication_role = replica;
update public.takeoff_preparations set confirmed_snapshot = jsonb_set(confirmed_snapshot, '{preparation,sources,0,pages}', '[]')
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
create function pg_temp.whole(page_count integer) returns jsonb language sql stable as $$
  select jsonb_set(jsonb_set(jsonb_set(jsonb_set(pg_temp.manifest(pg_temp.list(310, array[300]), array[pg_temp.plan(0)]),
    '{plans,0,pages}', '[]'), '{units,0,pages}', '[]'), '{plans,0,page_count}', to_jsonb(page_count)), '{units,0,page_count}',
    to_jsonb(page_count))
$$;
select is(pg_temp.attempt(pg_temp.remeasure_as(700, pg_temp.whole(1),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation,sources,0,pages}', '[]'), array[pg_temp.plan(0)],
    pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  '22023 TAKEOFF_LAUNCH_SEAL_INVALID', 'a plan read whole counted one page of the nine the preparation confirmed is refused');
select is(pg_temp.attempt(pg_temp.remeasure_as(700, pg_temp.whole(9),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation,sources,0,pages}', '[]'), array[pg_temp.plan(0)],
    pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  'admitted', 'counted nine pages, it is admitted');
-- A plan file whose page count was never stored (the server counts its PDF): the preparation has no count to compare.
set local session_replication_role = replica;
update public.plan_files set page_count = null where id = pg_temp.plan(0);
update public.takeoff_preparations set confirmed_snapshot = jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0), pg_temp.plan(1)]),
  '{preparation,sources,0,pages}', '[]')
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
select is(pg_temp.attempt(pg_temp.remeasure_as(700, pg_temp.whole(9),
    jsonb_set(pg_temp.snapshot(array[pg_temp.plan(0)]), '{preparation,sources,0,pages}', '[]'), array[pg_temp.plan(0)],
    pg_temp.targets(array[300], array[pg_temp.plan(0)]), 2)),
  'admitted', 'a plan whose stored page count is unknown is admitted on the count the server read');
set local session_replication_role = replica;
update public.plan_files set page_count = 9 where id = pg_temp.plan(0);
update public.takeoff_preparations set confirmed_snapshot = pg_temp.snapshot(array[pg_temp.plan(0), pg_temp.plan(1)])
where project_id = pg_temp.f(20);
set local session_replication_role = origin;
-- A selection made on a reading since replaced: stale, the item named, nothing admitted.
select results_eq($$select outcome, stale from pg_temp.remeasure(700, array[300, 301], array[pg_temp.plan(0)], 2,
    targets => jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', jsonb_build_array(pg_temp.f(999))),
      jsonb_build_object('item_id', pg_temp.f(301), 'answers', pg_temp.seen(301, array[pg_temp.plan(0)]))))$$,
  $$values ('stale'::text, array[pg_temp.f(300)])$$, 'a selection made on another reading is stale and names its item');
select is((select count(*)::integer from public.takeoff_launch_requests), (select n from requests_before), 'none of them admitted a request');
select is((select count(*)::integer from private.takeoff_launch_commands where intent_key = pg_temp.f(700)), 0, 'nor left a receipt');

-- 4. The lavabo was accepted, and the bathtub given a quantity, before the new measure.
select pg_temp.sign_in(1);
set local role authenticated;
select is(pg_temp.review('accept_measured', 600, array[300]) ->> 'outcome', 'applied', 'the lavabo is accepted on both plans');
select is(pg_temp.review('enter_quantity', 601, array[302], jsonb_build_object('values', jsonb_build_array(jsonb_build_object(
    'item_id', pg_temp.f(302), 'quantity', 1, 'unit', 'u')), 'entry', jsonb_build_object('category', 'site_survey'))) ->> 'outcome',
  'applied', 'the bathtub is entered');
reset role;
create temp table before_remeasure as select a.id, a.item_id, a.plan_logical_id from public.takeoff_item_answers a;
-- The lavabo measured again on plan A only.
create temp table remeasure_700 as select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2);
select is((select outcome from remeasure_700), 'admitted', 'a new measure of the lavabo on plan A is admitted');
select is((select job_id from remeasure_700), pg_temp.job(2, pg_temp.plan(0)), 'its one analysis reads plan A');
select is((select r.manifest #> '{order,list,asked_item_ids}' from public.takeoff_launch_requests r
    where r.id = (select request_id from remeasure_700)), jsonb_build_array(pg_temp.f(300)::text), 'its order seals the lavabo alone');
select is((select r.manifest #>> '{order,list,item_count}' from public.takeoff_launch_requests r
    where r.id = (select request_id from remeasure_700)), '3', 'the revision''s count unchanged');
select results_eq($$select item_id from private.takeoff_request_asked_items(pg_temp.request_of(pg_temp.job(2, pg_temp.plan(0))))$$,
  $$values (pg_temp.f(300))$$, 'it asks the lavabo only');
select is((select r.payer_id from public.takeoff_launch_requests r where r.id = (select request_id from remeasure_700)), pg_temp.f(1),
  'paid by the member who confirms');
select is((select r.manifest #> '{plans,0,logical_id}' from public.takeoff_launch_requests r
    where r.id = (select request_id from remeasure_700)), to_jsonb(pg_temp.plan(0)), 'plan A read as plan A');
-- While it runs, only the lavabo reads on plan A; everything else keeps its reading.
select results_eq($$select item, plan, job, reading from pg_temp.pairs() order by item, plan$$,
  $$values (pg_temp.f(300), pg_temp.plan(0), pg_temp.job(2, pg_temp.plan(0)), 'in_flight'::text),
    (pg_temp.f(300), pg_temp.plan(1), pg_temp.job(1, pg_temp.plan(1)), 'answered'),
    (pg_temp.f(301), pg_temp.plan(0), pg_temp.job(1, pg_temp.plan(0)), 'answered'),
    (pg_temp.f(301), pg_temp.plan(1), pg_temp.job(1, pg_temp.plan(1)), 'answered'),
    (pg_temp.f(302), pg_temp.plan(0), pg_temp.job(1, pg_temp.plan(0)), 'answered'),
    (pg_temp.f(302), pg_temp.plan(1), pg_temp.job(1, pg_temp.plan(1)), 'answered')$$,
  'only the item asked reads on the plan asked; the others keep their pair and their answer');
select results_eq($$select pg_temp.state(i) from unnest(array[300, 301, 302]) i$$,
  $$values ('reading'::text), ('not_found'), ('not_found')$$, 'the lavabo is being read, the others keep their state');
-- The same confirmation answers what it answered; another under its key is a conflict; another while it runs, already running.
select results_eq($$select outcome, request_id from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2)$$,
  $$select 'replayed'::text, request_id from remeasure_700$$, 'the same confirmation sent again is replayed');
select throws_ok($$select * from pg_temp.remeasure(700, array[301], array[pg_temp.plan(0)], 2)$$, '23505',
  'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'another selection under the same key is a conflict');
-- Everything the member confirmed is in its digest: the same items with other answers seen are another confirmation.
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2,
    targets => jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'answers', '[]'::jsonb)))$$, '23505',
  'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'the same items confirmed on other answers under the same key are a conflict');
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2,
    confirmation => pg_temp.confirmation('d'))$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'and so is the same selection under another preview confirmed');
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2,
    confirmation => pg_temp.confirmation('c', 'high'))$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT',
  'or another setting chosen for it');
-- The replay by what the member confirmed alone answers the receipt of that confirmation only.
select results_eq($$select outcome, request_id from pg_temp.replay(700, array[300], array[pg_temp.plan(0)])$$,
  $$select 'replayed'::text, request_id from remeasure_700$$, 'the replay of the same confirmation answers its receipt');
select throws_ok($$select * from pg_temp.replay(700, array[300, 301], array[pg_temp.plan(0)])$$, '23505',
  'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'a selection holding one more item is another confirmation');
select throws_ok($$select * from pg_temp.replay(700, array[300], array[pg_temp.plan(0)], confirmation => pg_temp.confirmation('d'))$$,
  '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'and so is another preview confirmed');
select throws_ok($$select * from pg_temp.replay(700, array[300], array[pg_temp.plan(0)],
    confirmation => pg_temp.confirmation('c', 'high'))$$, '23505', 'TAKEOFF_LAUNCH_INTENT_CONFLICT', 'or another setting');
select is((select count(*)::integer from pg_temp.replay(709, array[300], array[pg_temp.plan(0)])), 0,
  'a key that answered nothing yet has no receipt to replay');
set local session_replication_role = replica;
update public.tenant_memberships set role = 'director' where tenant_id = pg_temp.f(10) and user_id = pg_temp.f(1);
set local session_replication_role = origin;
select throws_ok($$select * from pg_temp.replay(700, array[300], array[pg_temp.plan(0)])$$, '42501',
  'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'and no receipt is replayed to a member who may no longer launch');
set local session_replication_role = replica;
update public.tenant_memberships set role = 'engineer' where tenant_id = pg_temp.f(10) and user_id = pg_temp.f(1);
set local session_replication_role = origin;
-- A member who lost the right since gets no answer, a replayed one included.
set local session_replication_role = replica;
update public.tenant_memberships set role = 'director' where tenant_id = pg_temp.f(10) and user_id = pg_temp.f(1);
set local session_replication_role = origin;
select throws_ok($$select * from pg_temp.remeasure(700, array[300], array[pg_temp.plan(0)], 2)$$, '42501',
  'TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE', 'the exact replay is refused to a member who may no longer launch on the affaire');
set local session_replication_role = replica;
update public.tenant_memberships set role = 'engineer' where tenant_id = pg_temp.f(10) and user_id = pg_temp.f(1);
set local session_replication_role = origin;
-- While it runs, a malformed selection is refused before anything is recorded under its key; the corrected one then
-- answers as any other.
select throws_ok($$select * from pg_temp.remeasure(705, array[301, 301], array[pg_temp.plan(0)], 3)$$, '22023',
  'TAKEOFF_ITEM_REMEASURE_INVALID', 'a selection naming an item twice is refused while another analysis runs');
select throws_ok($$select * from pg_temp.remeasure(705, array[301], array[pg_temp.plan(0)], 3,
    targets => jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(301), 'answers',
      pg_temp.seen(301, array[pg_temp.plan(0)]) || pg_temp.seen(301, array[pg_temp.plan(0)]))))$$, '22023',
  'TAKEOFF_ITEM_REMEASURE_INVALID', 'and so is a target naming an answer twice');
select throws_ok($$select * from pg_temp.remeasure(705, (select array_agg(n) from generate_series(1, 1001) n),
    array[pg_temp.plan(0)], 3)$$, '22023', 'TAKEOFF_ITEM_REMEASURE_INVALID', 'and a selection of more than 1,000 items');
select throws_ok($$select * from pg_temp.remeasure(706, array[399], array[pg_temp.plan(0)], 3)$$, '22023',
  'TAKEOFF_ITEM_REMEASURE_INVALID', 'and an item that is not an entry of the sealed revision');
select is((select count(*)::integer from private.takeoff_launch_commands where intent_key = pg_temp.f(706)), 0,
  'which records nothing under its key either');
select is((select count(*)::integer from private.takeoff_launch_commands where intent_key = pg_temp.f(705)), 0,
  'none of them recorded anything under its key');
select results_eq($$select outcome from pg_temp.remeasure(705, array[301], array[pg_temp.plan(0)], 3)$$,
  $$values ('already_running'::text)$$, 'the corrected selection is kept for later, as any other');
select results_eq($$select outcome from pg_temp.remeasure(701, array[301], array[pg_temp.plan(0)], 3)$$,
  $$values ('already_running'::text)$$, 'another new measure while this one runs is kept for later');
select is((select count(*)::integer from public.takeoff_launch_requests), (select n from requests_before) + 1,
  'one request admitted, once');

-- Its publication answers exactly what was asked.
select is(pg_temp.claim(pg_temp.job(2, pg_temp.plan(0)), 903), 1, 'the new measure is read');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(2, pg_temp.plan(0)), 903,
    jsonb_build_array(pg_temp.measured(300, 831, 3), pg_temp.not_found(301)), jsonb_build_array(pg_temp.row_(831, 3, 'plan-a.pdf')))$$,
  '22023', 'TAKEOFF_ANSWERS_ITEM_FOREIGN', 'an answer for an item it did not ask is refused');
select throws_ok($$select * from pg_temp.publish(pg_temp.job(2, pg_temp.plan(0)), 903, '[]'::jsonb, '[]'::jsonb)$$,
  '22023', 'TAKEOFF_ANSWERS_ITEM_MISSING', 'and so is a publication without the item it asked');
select is((select answer_count from pg_temp.publish(pg_temp.job(2, pg_temp.plan(0)), 903, jsonb_build_array(pg_temp.measured(300, 831, 3)),
    jsonb_build_array(pg_temp.row_(831, 3, 'plan-a.pdf')))), 1, 'one answer, the lavabo''s');
-- The new answer replaces the lavabo's reading on plan A, undecided; nothing else changes.
select results_eq($$select a.plan_file_id, a.plan_logical_id from public.takeoff_item_answers a
    where a.job_id = pg_temp.job(2, pg_temp.plan(0))$$, $$values (pg_temp.plan(0), pg_temp.plan(0))$$,
  'published as a reading of plan A''s file, as plan A');
select results_eq($$select a.reading_revision, a.replaces_answer_id from public.takeoff_item_answers a
    where a.job_id = pg_temp.job(2, pg_temp.plan(0))$$,
  $$select 2, b.id from before_remeasure b where b.item_id = pg_temp.f(300) and b.plan_logical_id = pg_temp.plan(0)$$,
  'it replaces the earlier reading of the lavabo on plan A');
select results_eq($$select item, plan, answer from pg_temp.pairs() where not (item = pg_temp.f(300) and plan = pg_temp.plan(0))
    order by item, plan$$,
  $$select b.item_id, b.plan_logical_id, b.id from before_remeasure b
    where not (b.item_id = pg_temp.f(300) and b.plan_logical_id = pg_temp.plan(0)) order by b.item_id, b.plan_logical_id$$,
  'every other current answer is the one before');
select is((select count(*)::integer from public.takeoff_item_answer_decisions d
    join public.takeoff_item_answers a on a.id = d.answer_id where a.job_id = pg_temp.job(2, pg_temp.plan(0))), 0,
  'the new answer is undecided');
select results_eq($$select d.kind from public.takeoff_item_answer_decisions d join before_remeasure b on b.id = d.answer_id
    where b.item_id = pg_temp.f(300) order by b.plan_logical_id$$, $$values ('accepted'::text), ('accepted')$$,
  'the earlier decisions stay, on the readings they were taken on');
select results_eq($$select l.decision from private.takeoff_item_table_lines(pg_temp.f(10), pg_temp.f(20), null) l
    where l.item_id = pg_temp.f(300)$$, $$values ('pending'::text)$$, 'the table shows the new reading to decide');
select results_eq($$select quantity, revision from public.takeoff_item_entries where item_id = pg_temp.f(302)$$,
  $$values (1::numeric, 1)$$, 'the entered quantity is untouched');
select is(pg_temp.state(300), 'measured', 'the lavabo is measured again');

-- 5. A plan already sent is measured again: its new analysis is not sent, and nothing of the sent one changes.
set local session_replication_role = replica;
update public.takeoff_jobs set status = 'applied' where id = pg_temp.job(1, pg_temp.plan(1));
set local session_replication_role = origin;
create temp table sent_before as
  select j.id, j.status::text, j.updated_at from public.takeoff_jobs j where j.id = pg_temp.job(1, pg_temp.plan(1));
create temp table sent_rows_before as
  select i.id, i.quantity, i.is_verified, i.is_excluded from public.takeoff_items i where i.job_id = pg_temp.job(1, pg_temp.plan(1));
select results_eq($$select outcome from pg_temp.remeasure(702, array[301], array[pg_temp.plan(1)], 4)$$,
  $$values ('admitted'::text)$$, 'a new measure of the valve on plan B, already sent, is admitted');
select results_eq($$select j.id, j.status::text, j.updated_at from public.takeoff_jobs j where j.id = pg_temp.job(1, pg_temp.plan(1))$$,
  $$select * from sent_before$$, 'the sent analysis is unchanged');
select results_eq($$select i.id, i.quantity, i.is_verified, i.is_excluded from public.takeoff_items i
    where i.job_id = pg_temp.job(1, pg_temp.plan(1)) order by i.id$$, $$select * from sent_rows_before order by id$$,
  'and so are its rows');
select is((select status::text from public.takeoff_jobs where id = pg_temp.job(4, pg_temp.plan(1))), 'pending',
  'its new analysis is not sent');
-- It fails: the earlier reading stays the current one, with its decision; the pair says its new reading did not end.
select is(pg_temp.claim(pg_temp.job(4, pg_temp.plan(1)), 904), 1, 'the new measure of the valve is read');
select ok(public.record_local_takeoff_failure(pg_temp.job(4, pg_temp.plan(1)), pg_temp.f(10), pg_temp.f(904),
  jsonb_build_object('completed_at', clock_timestamp(), 'duration_ms', 5, 'error_code', 'AI_PROVIDER',
    'error_message', 'Échec fictif', 'analysis_outcome', 'failure', 'last_error_at', clock_timestamp(), 'next_retry_at', null),
  '{"extracted_json": {}, "warnings": [], "tables": [], "provider_meta": {"status": "failed"}, "token_count": 0, "cost_cents": 0,
    "duration_ms": 5}') is not null, 'and fails for good');
select results_eq($$select job, reading, unit_state, answer from pg_temp.pairs() where item = pg_temp.f(301) and plan = pg_temp.plan(1)$$,
  $$select pg_temp.job(4, pg_temp.plan(1)), 'answered'::text, 'failed'::text, b.id from before_remeasure b
    where b.item_id = pg_temp.f(301) and b.plan_logical_id = pg_temp.plan(1)$$,
  'the valve keeps its earlier answer on plan B; its new reading failed');
select is(pg_temp.state(301), 'not_found', 'its state is the earlier one');

-- 6. An item added to the list, measured on plan A only: it has no pair on plan B (not expected there).
set local session_replication_role = replica;
insert into public.takeoff_list_items (id, tenant_id, project_id, origin_kind, created_in_revision, created_by)
values (pg_temp.f(303), pg_temp.f(10), pg_temp.f(20), 'manual', 2, pg_temp.f(1));
insert into public.takeoff_list_revisions (id, tenant_id, project_id, revision, cause, sources, item_count, content_sha256,
  gesture_sha256, intent_key, created_by)
values (pg_temp.f(320), pg_temp.f(10), pg_temp.f(20), 2, 'item_added', '{}', 4, repeat('2', 64), repeat('b', 64), pg_temp.f(321),
  pg_temp.f(1));
insert into public.takeoff_list_revision_entries (revision_id, tenant_id, project_id, item_id, position, source_key, label,
  expected_unit, origin_kind, origin)
select pg_temp.f(320), e.tenant_id, e.project_id, e.item_id, e.position, e.source_key, e.label, e.expected_unit, e.origin_kind, e.origin
from public.takeoff_list_revision_entries e where e.revision_id = pg_temp.f(310)
union all
select pg_temp.f(320), pg_temp.f(10), pg_temp.f(20), pg_temp.f(303), 3, 'manual:poste-3', 'Évier (fictif)', 'u', 'manual',
  '{"kind":"manual"}';
set local session_replication_role = origin;
select results_eq($$select outcome, stale from pg_temp.remeasure(703, array[300], array[pg_temp.plan(0)], 5)$$,
  $$values ('stale'::text, array[pg_temp.f(300)])$$, 'a selection on a revision the list has left is stale');
select throws_ok($$select * from pg_temp.remeasure(703, array[303], array[pg_temp.plan(0)], 5)$$, '22023',
  'TAKEOFF_ITEM_REMEASURE_INVALID', 'and an item that revision never held is refused, its key left unused');
select results_eq($$select outcome from pg_temp.remeasure(704, array[303], array[pg_temp.plan(0)], 5, revision => 320)$$,
  $$values ('admitted'::text)$$, 'the sink is measured on plan A, on the list''s latest revision');
select is(pg_temp.claim(pg_temp.job(5, pg_temp.plan(0)), 905), 1, 'it is read');
select is((select answer_count from pg_temp.publish(pg_temp.job(5, pg_temp.plan(0)), 905, jsonb_build_array(pg_temp.not_found(303)),
    '[]'::jsonb)), 1, 'and found nowhere');
select is((select count(*)::integer from pg_temp.pairs() where item = pg_temp.f(303) and plan = pg_temp.plan(1)), 0,
  'it has no pair on plan B, which no request asked about it');
select results_eq($$select s.state, s.expected, s.answered from private.takeoff_item_reading_states(pg_temp.f(10), pg_temp.f(20), null) s
    where s.item_id = pg_temp.f(303)$$, $$values ('not_found'::text, 1, 1)$$,
  'in the affaire, its coverage is the plan asked: not found there, by the answer of plan A, never failed nor incomplete');
-- On the plan it was never asked about, it is not expected: the table of that plan's scope does not show it at all.
select is((select count(*)::integer from private.takeoff_item_table_lines(pg_temp.f(10), pg_temp.f(20), pg_temp.plan(1)) l
    where l.item_id = pg_temp.f(303)), 0, 'the table of plan B''s scope does not show it');
select results_eq($$select l.state, l.expected from private.takeoff_item_table_lines(pg_temp.f(10), pg_temp.f(20), pg_temp.plan(0)) l
    where l.item_id = pg_temp.f(303)$$, $$values ('not_found'::text, 1)$$, 'the table of plan A''s scope shows its answer there');
select results_eq($$select s.state, s.expected from private.takeoff_item_reading_states(pg_temp.f(10), pg_temp.f(20), pg_temp.plan(1)) s
    where s.item_id = pg_temp.f(303)$$, $$values ('to_measure'::text, 0)$$,
  'on plan B nothing is expected of it (no request asked it there): to measure, which that scope does not list');
select results_eq($$select pg_temp.state(i) from unnest(array[300, 301, 302]) i$$,
  $$values ('measured'::text), ('not_found'), ('not_found')$$, 'the other items keep their states on the latest revision');

select * from finish();
rollback;
