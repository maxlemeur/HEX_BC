-- Follow-up of lot 2 M2 (the send of a reviewed takeoff), what its reviews left:
-- 1. The line that represents grouped lengths is chosen from its sources (page, position, then the takeoff line), never
--    from an identifier drawn at each run: two runs of one command store the same main page and position, and the
--    outcome a send is compared with names that source, so a confirmation that saw another one is refused. The
--    previous application's call (apply_takeoff_job_with_page_decisions, as v0.8.0 and main make it) gets the same.
-- 2. The parts of a line (`takeoff_contributions.parts`) tell its active sources: A sends 3, B adds 2, C replaces B's
--    page with 4, D adds 1: the parts are A, C, then A, C, D; a line the previous replacement left naming B is listed
--    again from its active sources by its next accumulation (no stored row is rewritten by the migration).
-- 3. A send whose command is of format 2 writes the application's audit rows (« takeoff.apply.completed » and one
--    « takeoff.mapping.applied » per mapped line) in its own transaction, once: a replay writes none. A command of
--    format 1 (the previous application, which writes them after the commit) gets none from the database.
-- Review of #434 (red on 327516ed): engine 2 did not name the representative's takeoff line (2b, 7); a second staging
-- of one request under another format was accepted, the answer did not say which format ran, and nothing recorded that
-- the effects after the commit completed (8); the mapping audit named actions the writer suppressed on the line that
-- remains (9).
-- Isolation justified: the choice of a representative between runs, the parts stored on a line and the rows of one
-- transaction are database contracts no journey can observe deterministically (a run's identifiers are random).
-- Written before the change: red on 0dcea6a2 (no source in the outcome, a representative by the smallest new identifier,
-- B's part kept by the replacement and copied by the accumulation, format 2 refused). All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('ab260000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fx(n), 'takeoff-grouped-' || n || '@example.test', '{}'::jsonb from generate_series(1, 7) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'ab260000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fx(10), 'Takeoff grouped lines', 'takeoff-grouped-test'),
  (pg_temp.fx(12), 'Takeoff grouped lines engine 2', 'takeoff-grouped-engine-2-test'),
  (pg_temp.fx(14), 'Takeoff send audit', 'takeoff-send-audit-test');
insert into public.tenant_calc_policies(tenant_id, new_estimate_calc_engine, change_reason)
values (pg_temp.fx(12), 2, 'Moteur 2 du tenant fictif');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fx(10), pg_temp.fx(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(12), pg_temp.fx(6), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(14), pg_temp.fx(7), 'engineer', true, '2020-01-01');

create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fx(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fx(n))::text, true);
$$;
create function pg_temp.sign_out() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- As takeoff-send-outcome.test.sql builds them: one affaire per case, each takeoff admitted on its own plan from its own
-- preparation revision; `hash` is the attested content of the plan.
create function pg_temp.affaire(p_project integer, p_tenant integer, p_owner integer, p_name text) returns void language sql as $$
  select pg_temp.sign_out();
  insert into public.estimate_projects(id, tenant_id, user_id, name)
  values (pg_temp.fx(p_project), pg_temp.fx(p_tenant), pg_temp.fx(p_owner), p_name);
$$;
create function pg_temp.plan(p_set integer, p_file integer, p_project integer, p_tenant integer, p_pages integer default 1)
returns void language sql as $$
  insert into public.plan_sets(id, tenant_id, project_id, name) values (pg_temp.fx(p_set), pg_temp.fx(p_tenant), pg_temp.fx(p_project),
    'Plans fictifs ' || p_set);
  insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
  values (pg_temp.fx(p_file), pg_temp.fx(p_tenant), pg_temp.fx(p_set), 'plan-' || p_file || '.pdf',
    concat_ws('/', pg_temp.fx(p_tenant), pg_temp.fx(p_set), pg_temp.fx(p_file), 'plan-' || p_file || '.pdf'), 'application/pdf', 8,
    p_pages);
$$;
create function pg_temp.hash(p_file integer) returns text language sql immutable as $$
  select encode(sha256(convert_to('plan fictif ' || p_file, 'UTF8')), 'hex')
$$;
create function pg_temp.prepare(p_project integer, p_tenant integer, p_owner integer, p_file integer, p_revision integer)
returns void language plpgsql as $$
declare
  draft jsonb := (select jsonb_build_object('schema_version', 1,
    'destination', '{"kind":"analysis_only","estimate_version_id":null}'::jsonb,
    'processing', '{"level":"C","provider":"chatgpt"}'::jsonb,
    'sources', jsonb_build_array(jsonb_build_object('document_id', f.id, 'kind', 'plan', 'active', true, 'confirmed', true,
      'plan_set_id', f.plan_set_id, 'file_path', f.file_path, 'page_count', f.page_count, 'source_updated_at', f.updated_at,
      'content_hash', pg_temp.hash(p_file))))
    from public.plan_files f where f.id = pg_temp.fx(p_file));
  snapshot jsonb := jsonb_build_object('schema_version', 1, 'preparation_revision', p_revision, 'confirmed_by', pg_temp.fx(p_owner),
    'confirmed_at', '2026-11-20T00:00:00Z', 'readiness', '{"can_launch":true}'::jsonb, 'preparation', draft);
begin
  insert into public.takeoff_preparations(tenant_id, project_id, revision, draft, confirmed_snapshot, confirmed_at, confirmed_by, updated_by)
  values (pg_temp.fx(p_tenant), pg_temp.fx(p_project), p_revision, draft, snapshot, '2026-11-20T00:00:00Z', pg_temp.fx(p_owner),
    pg_temp.fx(p_owner))
  on conflict (tenant_id, project_id) do update set revision = excluded.revision, draft = excluded.draft,
    confirmed_snapshot = excluded.confirmed_snapshot;
end;
$$;
create function pg_temp.admit(p_job integer, p_project integer, p_set integer, p_tenant integer, p_owner integer) returns void
language plpgsql as $$
begin
  perform pg_temp.sign_in(p_owner);
  set local role authenticated;
  perform public.admit_prepared_takeoff_job(jsonb_build_object(
    'id', pg_temp.fx(p_job), 'tenant_id', pg_temp.fx(p_tenant), 'project_id', pg_temp.fx(p_project),
    'plan_set_id', pg_temp.fx(p_set), 'level', 'C', 'created_by', pg_temp.fx(p_owner),
    'execution_provider', 'chatgpt_local', 'execution_host_id', 'urn:uuid:ab260000-0000-4000-8000-000000000090',
    'processing_strategy', 'sync',
    'preparation_snapshot', (select confirmed_snapshot from public.takeoff_preparations where project_id = pg_temp.fx(p_project))));
  reset role;
  perform pg_temp.sign_out();
  update public.takeoff_jobs set status = 'completed' where id = pg_temp.fx(p_job);
  insert into public.takeoff_results(id, tenant_id, job_id) values (pg_temp.fx(p_job + 100), pg_temp.fx(p_tenant), pg_temp.fx(p_job));
end;
$$;
-- A takeoff line on a page of its plan; lines are read in the order of their number.
create function pg_temp.measure(p_item integer, p_job integer, p_tenant integer, p_file integer, p_designation text, p_quantity numeric,
  p_unit text, p_page integer default 1) returns void language sql as $$
  insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
    source_page, confidence, metadata, created_at)
  values (pg_temp.fx(p_item), pg_temp.fx(p_tenant), pg_temp.fx(p_job), pg_temp.fx(p_job + 100), p_designation, p_quantity, p_unit,
    'Repère page ' || p_page, 'plan-' || p_file || '.pdf', p_page, 0.95,
    jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fx(p_file))),
    '2026-11-20T10:00:00Z'::timestamptz + make_interval(secs => p_item));
$$;
create function pg_temp.mapping_plan(p_job integer) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', i.rank - 1, 'rule_id', null, 'action', 'none',
      'designation', btrim(i.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null) order by i.rank)
  from (select item.*, row_number() over (order by item.created_at, item.id) as rank
    from public.takeoff_items item where item.job_id = pg_temp.fx(p_job)) as i
$$;

-- The commands, built as send-server.ts builds them (a dry run, then the send carrying its outcome), of the format the
-- application sends: 1 for the previous application, 2 for this one.
create function pg_temp.command(p_job integer, p_destination jsonb, p_section jsonb, p_accumulations jsonb default '[]',
  p_page_decisions jsonb default '[]', p_mapping jsonb default null, p_format integer default 1) returns jsonb language sql as $$
  select jsonb_build_object('format_version', p_format, 'mode', 'dry_run', 'request_id', gen_random_uuid(), 'job_id', j.id,
    'fingerprint', repeat('f', 64),
    'client', jsonb_build_object('fingerprint', repeat('f', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'page_decisions', p_page_decisions, 'override', false),
    'destination', p_destination, 'section', p_section,
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case p_destination ->> 'kind'
        when 'existing_draft' then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id)),
    'mapping_plan', coalesce(p_mapping, pg_temp.mapping_plan(p_job)),
    'page_decisions', p_page_decisions, 'rule_results', '[]'::jsonb, 'rule_transforms', '[]'::jsonb,
    'accumulations', p_accumulations, 'override', null, 'price_rules_ignored', '[]'::jsonb, 'expected_outcome', null)
  from public.takeoff_jobs j where j.id = pg_temp.fx(p_job)
$$;
create function pg_temp.first_draft(p_version integer, p_engine integer default 3) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'first_draft', 'version_payload', jsonb_build_object(
    'id', pg_temp.fx(p_version), 'title', null, 'date_devis', '2026-11-21', 'validite_jours', 30, 'margin_multiplier', 1,
    'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0, 'discount_amount_cents', null,
    'discount_mode', 'simple', 'discount_steps', '[]'::jsonb, 'global_coefficient', 1, 'tax_rate_bp', 2000,
    'rounding_mode', 'none', 'rounding_step_cents', 1, 'max_section_depth', 3, 'contractor_role', 'principal',
    'calc_engine_version', p_engine, 'total_ht_cents', 0, 'total_tax_cents', 0, 'total_ttc_cents', 0)
    -- Engine 2 versions carry none of the engine 3 totals.
    || case when p_engine = 3 then jsonb_build_object('gross_ht_cents', 0, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0)
      else '{}'::jsonb end)
$$;
create function pg_temp.new_section(p_id integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'new', 'id', pg_temp.fx(p_id), 'title', 'Métré — plans fictifs')
$$;
create function pg_temp.draft(p_version integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'existing_draft', 'version_id', pg_temp.fx(p_version))
$$;
create function pg_temp.existing_section(p_id integer) returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'existing', 'id', pg_temp.fx(p_id))
$$;
create temp table commands (name text primary key, body jsonb) on commit drop;
grant all on commands to authenticated;
create function pg_temp.request(p_body jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('request_id', p_body -> 'request_id', 'job_id', p_body -> 'job_id', 'fingerprint', p_body -> 'fingerprint')
$$;
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
create function pg_temp.run(p_body jsonb) returns jsonb language plpgsql as $$
begin
  perform pg_temp.stage_body(p_body);
  return public.send_takeoff_job(pg_temp.request(p_body));
end;
$$;
create function pg_temp.dry(p_name text) returns jsonb language plpgsql as $$
declare
  answer jsonb := pg_temp.run((select body from commands where name = p_name) || jsonb_build_object('request_id', gen_random_uuid()));
begin
  if answer ->> 'dry_run' is distinct from 'true' or answer ? 'error' then
    raise exception 'not a preview: %', answer;
  end if;
  return answer -> 'outcome';
end;
$$;
create function pg_temp.confirm(p_name text, p_outcome jsonb default null) returns jsonb language plpgsql as $$
declare
  shown jsonb := coalesce(p_outcome, pg_temp.dry(p_name));
begin
  update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', shown) where name = p_name;
  return pg_temp.run((select body from commands where name = p_name));
end;
$$;
create function pg_temp.line(p_version integer, p_title text) returns public.estimate_items language sql as $$
  select item from public.estimate_items item where item.version_id = pg_temp.fx(p_version) and item.item_type = 'line'
    and item.title = p_title
$$;
-- What a line stores of its main source, and of its parts.
create function pg_temp.stored(p_version integer, p_title text) returns jsonb language sql as $$
  select jsonb_build_object('page', i.source_page, 'position', i.position, 'takeoff_item_id', i.source_metadata ->> 'takeoff_item_id',
    'quantity', trim_scale(i.quantity), 'lines', (select count(*) from public.estimate_items other
      where other.version_id = i.version_id and other.item_type = 'line'))
  from public.estimate_items i where i.version_id = pg_temp.fx(p_version) and i.item_type = 'line' and i.title = p_title
$$;
create function pg_temp.parts(p_version integer, p_title text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(part ->> 'job_id', part -> 'takeoff_item_ids', (part ->> 'quantity')::numeric)
    order by part.ordinality), '[]'::jsonb)
  from public.estimate_items i
  cross join lateral jsonb_array_elements(i.source_metadata #> '{takeoff_contributions,parts}') with ordinality as part(part, ordinality)
  where i.version_id = pg_temp.fx(p_version) and i.item_type = 'line' and i.title = p_title
$$;
-- The read-only count of the pull request's description: lines whose parts name a takeoff line that is not one of the
-- line's active sources, or leave one of them out.
create function pg_temp.stale_part_lines(p_tenant integer) returns bigint language sql stable as $$
  select count(*) from public.estimate_items as line
  cross join lateral (select private.takeoff_estimate_line_item_ids(line.source_metadata, line.source_job_id) as active) as sources
  cross join lateral (select coalesce(array_agg(private.takeoff_uuid_or_null(named.value)), '{}'::uuid[]) as listed
    from jsonb_array_elements(line.source_metadata #> '{takeoff_contributions,parts}') as part(value)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(part.value -> 'takeoff_item_ids') = 'array'
      then part.value -> 'takeoff_item_ids' else '[]'::jsonb end) as named(value)) as parts
  where line.tenant_id = pg_temp.fx(p_tenant) and line.item_type = 'line'
    and jsonb_typeof(line.source_metadata #> '{takeoff_contributions,parts}') = 'array'
    and not (parts.listed @> sources.active and sources.active @> parts.listed)
$$;

-- Runs of the same command, each rolled back once it has answered or written: what each run gives.
create function pg_temp.previewed_sources(p_name text, p_title text, p_runs integer) returns setof jsonb language plpgsql as $$
begin
  for attempt in 1 .. p_runs loop
    return query select line -> 'source' from jsonb_array_elements(pg_temp.dry(p_name) -> 'lines') as line
      where line ->> 'title' = p_title;
  end loop;
end;
$$;
create function pg_temp.sent_lines(p_name text, p_version integer, p_title text, p_runs integer) returns setof jsonb
language plpgsql as $$
declare
  written jsonb;
begin
  for attempt in 1 .. p_runs loop
    begin
      perform pg_temp.confirm(p_name);
      written := pg_temp.stored(p_version, p_title);
      raise exception 'pgtap: rolled back';
    exception when others then
      if sqlerrm <> 'pgtap: rolled back' then
        raise;
      end if;
    end;
    return next written;
  end loop;
end;
$$;

-- 1. Two identical tubes of plan 50, read page 2 first (item 81, 4.2 m), then page 1 (item 82, 3.1 m): one line of
-- 8 m. Its main source is page 1's tube, whatever identifiers the run draws: the page comes first, then the position,
-- then the takeoff line.
select pg_temp.affaire(20, 10, 1, 'Affaire aux tubes');
select pg_temp.plan(40, 50, 20, 10, 2);
select pg_temp.prepare(20, 10, 1, 50, 1);
select pg_temp.admit(61, 20, 40, 10, 1);
select pg_temp.measure(81, 61, 10, 50, 'Tube cuivre', 4.2, 'm', 2);
select pg_temp.measure(82, 61, 10, 50, 'Tube cuivre', 3.1, 'm', 1);
insert into commands values ('tubes', pg_temp.command(61, pg_temp.first_draft(100), pg_temp.new_section(110)));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table tube_previews as select pg_temp.previewed_sources('tubes', 'Tube cuivre', 6) as source;
create temp table tube_sends as select pg_temp.sent_lines('tubes', 100, 'Tube cuivre', 10) as written;
reset role;
select is((select count(*) from tube_previews), 6::bigint, 'six previews of the command each show the grouped line');
select results_eq($$select distinct source from tube_previews$$,
  $$values (jsonb_build_object('file', 'plan-50.pdf', 'page', 1, 'takeoff_item_id', pg_temp.fx(82)))$$,
  'each preview names the same source for the grouped line: page 1''s tube');
select results_eq($$select distinct written from tube_sends$$,
  $$values (jsonb_build_object('page', 1, 'position', 2, 'takeoff_item_id', pg_temp.fx(82)::text, 'quantity', 8, 'lines', 1))$$,
  'ten sends of the command, each rolled back, store one line of 8 m with page 1''s tube as its source, at its position');

-- A confirmation that saw another source for that line is refused, and nothing is written.
select pg_temp.sign_in(1);
set local role authenticated;
create temp table tube_shown as select pg_temp.dry('tubes') as outcome;
select throws_ok($$select pg_temp.confirm('tubes', jsonb_set((select outcome from tube_shown), '{lines,0,source}',
    jsonb_build_object('file', 'plan-50.pdf', 'page', 2, 'takeoff_item_id', pg_temp.fx(81))))$$,
  '40001', 'TAKEOFF_SEND_PREVIEW_STALE', 'a confirmation whose grouped line had another source is refused');
reset role;
select is((select count(*) from public.estimate_versions where project_id = pg_temp.fx(20)), 0::bigint, 'nothing was written');
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('tubes', (select outcome from tube_shown))$$, 'the outcome as shown is sent');
reset role;
select is(pg_temp.stored(100, 'Tube cuivre'),
  jsonb_build_object('page', 1, 'position', 2, 'takeoff_item_id', pg_temp.fx(82)::text, 'quantity', 8, 'lines', 1),
  'the estimate holds the line the member saw, page 1''s tube its source');
select is((select line -> 'source' from public.takeoff_send_receipts receipt
    cross join jsonb_array_elements(receipt.result #> '{outcome,lines}') as line where receipt.job_id = pg_temp.fx(61)),
  jsonb_build_object('file', 'plan-50.pdf', 'page', 1, 'takeoff_item_id', pg_temp.fx(82)), 'and its receipt names that source');

-- 2. The previous application's call, unchanged: an engine 2 takeoff of a version applied through
-- apply_takeoff_job_with_page_decisions (as v0.8.0 and main call it), the same two tubes: the same single line of 8 m,
-- its title, section and price as before, and page 1's tube as its source on every run.
select pg_temp.affaire(22, 12, 6, 'Affaire versionnée moteur 2');
insert into public.estimate_versions (id, tenant_id, project_id, version_number, calc_engine_version, max_section_depth,
  currency, status, margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp,
  rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents)
values (pg_temp.fx(120), pg_temp.fx(12), pg_temp.fx(22), 1, 2, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1,
  0, 0, 0);
insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
values (pg_temp.fx(121), pg_temp.fx(12), pg_temp.fx(120), 'section', 1, 'Lot fictif');
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values (pg_temp.fx(66), pg_temp.fx(12), pg_temp.fx(120), 'B', 'completed', 'plan-56.pdf', pg_temp.fx(6));
insert into public.takeoff_results(id, tenant_id, job_id) values (pg_temp.fx(166), pg_temp.fx(12), pg_temp.fx(66));
select pg_temp.measure(87, 66, 12, 56, 'Tube cuivre', 4.2, 'm', 2);
select pg_temp.measure(88, 66, 12, 56, 'Tube cuivre', 3.1, 'm', 1);
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(120), pg_temp.fx(6), pg_temp.fx(12), now() + interval '30 minutes', gen_random_uuid());
create function pg_temp.applied_lines(p_runs integer) returns setof jsonb language plpgsql as $$
declare
  written jsonb;
begin
  for attempt in 1 .. p_runs loop
    begin
      perform set_config('app.takeoff_apply_atomic', '', true);
      perform set_config('app.takeoff_apply_job', '', true);
      perform public.apply_takeoff_job_with_page_decisions(pg_temp.fx(66), 'append', pg_temp.fx(121), pg_temp.mapping_plan(66),
        '[]'::jsonb, null);
      select jsonb_build_object('page', i.source_page, 'file', i.source_file_name, 'title', i.title, 'unit', i.description,
          'quantity', trim_scale(i.quantity), 'price', i.unit_price_ht_cents, 'section', i.parent_id, 'position', i.position,
          'representative', i.source_metadata #>> '{takeoff_length_rounding,representative_item_id}',
          'lines', (select count(*) from public.estimate_items other where other.version_id = i.version_id and other.item_type = 'line'))
        into written
      from public.estimate_items i where i.version_id = pg_temp.fx(120) and i.item_type = 'line';
      raise exception 'pgtap: rolled back';
    exception when others then
      if sqlerrm <> 'pgtap: rolled back' then
        raise;
      end if;
    end;
    return next written;
  end loop;
end;
$$;
drop table if exists pg_temp._takeoff_apply_source, pg_temp._takeoff_apply_created_ids, pg_temp._takeoff_apply_matches,
  pg_temp._takeoff_apply_unmatched;
select pg_temp.sign_in(6);
set local role authenticated;
create temp table versioned_applications as select pg_temp.applied_lines(10) as written;
reset role;
select results_eq($$select distinct written from versioned_applications$$,
  $$values (jsonb_build_object('page', 1, 'file', 'plan-56.pdf', 'title', 'Tube cuivre', 'unit', 'm', 'quantity', 8, 'price', 0,
    'section', pg_temp.fx(121), 'position', 2, 'representative', pg_temp.fx(88)::text, 'lines', 1))$$,
  'ten applications by the previous application''s call store the same line: page 1''s tube, at its position, named as the line''s source');

-- 3. A (3 washbasins) to a first draft of engine 3 at a typed price, B adds 2, C replaces B's page with 4, D adds 1:
-- the line's parts tell A and B, then A and C, then A, C and D, as its quantity and its active sources do.
select pg_temp.affaire(23, 10, 1, 'Affaire A, B, C puis D');
select pg_temp.plan(43, 53, 23, 10);
select pg_temp.plan(44, 54, 23, 10);
select pg_temp.plan(45, 55, 23, 10);
select pg_temp.prepare(23, 10, 1, 53, 1);
select pg_temp.admit(68, 23, 43, 10, 1);
select pg_temp.measure(85, 68, 10, 53, 'Lavabo', 3, 'u');
select pg_temp.prepare(23, 10, 1, 54, 2);
select pg_temp.admit(69, 23, 44, 10, 1);
select pg_temp.measure(86, 69, 10, 54, 'Lavabo', 2, 'u');
insert into commands values ('a', pg_temp.command(68, pg_temp.first_draft(130), pg_temp.new_section(131)));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('a')$$, 'A sends its 3 washbasins to a first draft');
reset role;
select set_config('miaouffrage.estimate_v3_writer', pg_temp.fx(130)::text, true);
update public.estimate_items set unit_price_ht_cents = 4500 where version_id = pg_temp.fx(130) and item_type = 'line';
select public.estimate_v3_complete_entry_for_writer(pg_temp.fx(130),
  array(select id from public.estimate_items where version_id = pg_temp.fx(130) and item_type = 'line'));
select set_config('miaouffrage.estimate_v3_writer', '', true);
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(130), pg_temp.fx(1), pg_temp.fx(10), now() + interval '30 minutes', gen_random_uuid());
create function pg_temp.accumulation(p_item integer, p_version integer, p_title text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(p_item), 'estimate_item_id', line.id,
    'expected_updated_at', line.updated_at, 'expected_quantity', line.quantity))
  from public.estimate_items line where line.version_id = pg_temp.fx(p_version) and line.item_type = 'line' and line.title = p_title
$$;
insert into commands values ('b', pg_temp.command(69, pg_temp.draft(130), pg_temp.existing_section(131),
  pg_temp.accumulation(86, 130, 'Lavabo')));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('b')$$, 'B adds its 2 to that line');
reset role;
select is(pg_temp.parts(130, 'Lavabo'), jsonb_build_array(jsonb_build_array(pg_temp.fx(68), jsonb_build_array(pg_temp.fx(85)), 3),
    jsonb_build_array(pg_temp.fx(69), jsonb_build_array(pg_temp.fx(86)), 2)), 'after B, the parts are A''s 3 and B''s 2');

-- C reads B's page again (4 washbasins) and the member replaces B's measure: 3 + 4.
select pg_temp.prepare(23, 10, 1, 54, 3);
select pg_temp.admit(70, 23, 44, 10, 1);
select pg_temp.measure(89, 70, 10, 54, 'Lavabo', 4, 'u');
insert into commands select 'c', pg_temp.command(70, pg_temp.draft(130), pg_temp.existing_section(131),
  p_page_decisions => jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', pg_temp.fx(54), 'content_hash', pg_temp.hash(54), 'logical_document_id', null,
      'file_name', 'plan-54.pdf'),
    'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.fx(69)), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.line(130, 'Lavabo')).id,
      'expected_updated_at', (pg_temp.line(130, 'Lavabo')).updated_at, 'action', 'update', 'take', null,
      'item_ids', jsonb_build_array(pg_temp.fx(86)))),
    'pairs', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(89),
      'estimate_item_id', (pg_temp.line(130, 'Lavabo')).id)))));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('c')$$, 'C replaces B''s page');
reset role;
select is((pg_temp.line(130, 'Lavabo')).quantity, 7::numeric, 'the line holds A''s 3 and C''s 4');
select is(pg_temp.parts(130, 'Lavabo'), jsonb_build_array(jsonb_build_array(pg_temp.fx(68), jsonb_build_array(pg_temp.fx(85)), 3),
    jsonb_build_array(pg_temp.fx(70), jsonb_build_array(pg_temp.fx(89)), 4)),
  'after the replacement, the parts are A''s 3 and C''s 4: B''s part is gone');
select is((pg_temp.line(130, 'Lavabo')).source_metadata #>> '{takeoff_contributions,job_id}', pg_temp.fx(70)::text,
  'the parts are those of the line''s current takeoff');
select is(pg_temp.stale_part_lines(10), 0::bigint, 'no line of the tenant has a part that is not one of its sources');

-- D (1 washbasin on a third plan) adds to the line: 3 + 4 + 1, at its price.
select pg_temp.prepare(23, 10, 1, 55, 4);
select pg_temp.admit(71, 23, 45, 10, 1);
select pg_temp.measure(90, 71, 10, 55, 'Lavabo', 1, 'u');
insert into commands values ('d', pg_temp.command(71, pg_temp.draft(130), pg_temp.existing_section(131),
  pg_temp.accumulation(90, 130, 'Lavabo')));
create function pg_temp.parts_after(p_name text) returns jsonb language plpgsql as $$
declare
  written jsonb;
begin
  begin
    perform pg_temp.confirm(p_name);
    written := jsonb_build_object('quantity', trim_scale((pg_temp.line(130, 'Lavabo')).quantity),
      'price', (pg_temp.line(130, 'Lavabo')).unit_price_ht_cents, 'parts', pg_temp.parts(130, 'Lavabo'),
      'request', (pg_temp.line(130, 'Lavabo')).source_metadata #> '{takeoff_contributions,parts,2,request_id}');
    raise exception 'pgtap: rolled back';
  exception when others then
    if sqlerrm <> 'pgtap: rolled back' then
      raise;
    end if;
  end;
  return written;
end;
$$;
select pg_temp.sign_in(1);
set local role authenticated;
create temp table d_on_current as select pg_temp.parts_after('d') as written;
reset role;
select is((select written from d_on_current), jsonb_build_object('quantity', 8, 'price', 4500,
    'parts', jsonb_build_array(jsonb_build_array(pg_temp.fx(68), jsonb_build_array(pg_temp.fx(85)), 3),
      jsonb_build_array(pg_temp.fx(70), jsonb_build_array(pg_temp.fx(89)), 4),
      jsonb_build_array(pg_temp.fx(71), jsonb_build_array(pg_temp.fx(90)), 1)),
    'request', (select body -> 'request_id' from commands where name = 'd')),
  'D''s addition gives 8 at the same price, its parts A, C and D (D''s with its request)');

-- 4. A line as the previous replacement left it: its parts still name B's 2. The read-only count finds it; D's addition
-- lists the parts from the line's active sources (A and C) and adds its own; the count then finds none. No migration
-- rewrites such a line: its next accumulation does.
set local session_replication_role = replica;
update public.estimate_items set source_metadata = source_metadata || jsonb_build_object('takeoff_contributions',
    jsonb_build_object('version', 1, 'job_id', pg_temp.fx(69), 'item_ids', jsonb_build_array(pg_temp.fx(85), pg_temp.fx(86)),
      'parts', jsonb_build_array(jsonb_build_object('job_id', pg_temp.fx(68), 'takeoff_item_ids', jsonb_build_array(pg_temp.fx(85)),
          'quantity', 3),
        jsonb_build_object('job_id', pg_temp.fx(69), 'request_id', (select body -> 'request_id' from commands where name = 'b'),
          'takeoff_item_ids', jsonb_build_array(pg_temp.fx(86)), 'quantity', 2))))
where id = (pg_temp.line(130, 'Lavabo')).id;
set local session_replication_role = origin;
select is(pg_temp.stale_part_lines(10), 1::bigint, 'the count finds the line whose parts still name B');
select is(private.takeoff_estimate_line_item_ids((pg_temp.line(130, 'Lavabo')).source_metadata,
    (pg_temp.line(130, 'Lavabo')).source_job_id), array[pg_temp.fx(89), pg_temp.fx(85)],
  'its active sources are still C''s and A''s (the stale part is of another takeoff)');
delete from commands where name = 'd';
insert into commands values ('d', pg_temp.command(71, pg_temp.draft(130), pg_temp.existing_section(131),
  pg_temp.accumulation(90, 130, 'Lavabo')));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('d')$$, 'D adds its washbasin to that line');
reset role;
select is(jsonb_build_array(trim_scale((pg_temp.line(130, 'Lavabo')).quantity), (pg_temp.line(130, 'Lavabo')).unit_price_ht_cents,
    pg_temp.parts(130, 'Lavabo')),
  jsonb_build_array(8, 4500, jsonb_build_array(jsonb_build_array(pg_temp.fx(68), jsonb_build_array(pg_temp.fx(85)), 3),
    jsonb_build_array(pg_temp.fx(70), jsonb_build_array(pg_temp.fx(89)), 4),
    jsonb_build_array(pg_temp.fx(71), jsonb_build_array(pg_temp.fx(90)), 1))),
  'the line holds 8 at its price, its parts A, C and D: the stale part is not copied');
select is(pg_temp.stale_part_lines(10), 0::bigint, 'the count finds none');

-- Replaced again: E reads C's page anew (5 washbasins) and the member replaces C's measure: 3 + 1 + 5, the parts A, D
-- and E.
select pg_temp.prepare(23, 10, 1, 54, 5);
select pg_temp.admit(79, 23, 44, 10, 1);
select pg_temp.measure(101, 79, 10, 54, 'Lavabo', 5, 'u');
insert into commands select 'e', pg_temp.command(79, pg_temp.draft(130), pg_temp.existing_section(131),
  p_page_decisions => jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', pg_temp.fx(54), 'content_hash', pg_temp.hash(54), 'logical_document_id', null,
      'file_name', 'plan-54.pdf'),
    'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.fx(70)), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.line(130, 'Lavabo')).id,
      'expected_updated_at', (pg_temp.line(130, 'Lavabo')).updated_at, 'action', 'update', 'take', null,
      'item_ids', jsonb_build_array(pg_temp.fx(89)))),
    'pairs', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(101),
      'estimate_item_id', (pg_temp.line(130, 'Lavabo')).id)))));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('e')$$, 'E replaces C''s page');
reset role;
select is(jsonb_build_array(trim_scale((pg_temp.line(130, 'Lavabo')).quantity), (pg_temp.line(130, 'Lavabo')).unit_price_ht_cents,
    pg_temp.parts(130, 'Lavabo')),
  jsonb_build_array(9, 4500, jsonb_build_array(jsonb_build_array(pg_temp.fx(68), jsonb_build_array(pg_temp.fx(85)), 3),
    jsonb_build_array(pg_temp.fx(71), jsonb_build_array(pg_temp.fx(90)), 1),
    jsonb_build_array(pg_temp.fx(79), jsonb_build_array(pg_temp.fx(101)), 5))),
  'replaced again, the line holds 9 at its price, its parts A, D and E: C''s part is gone');
select is(pg_temp.stale_part_lines(10), 0::bigint, 'the count still finds none');

-- 5. The application's audit rows, in the send's transaction for a command of format 2: one « takeoff.apply.completed »
-- (its counts as the server read them from the receipt) and one « takeoff.mapping.applied » per line a mapping rule
-- changed — renamed, or set aside (no estimate line), two equal lengths renamed naming the one line that represents them
-- —, as the server wrote them after the commit; a replay writes none; an addition to an earlier line counts as updated.
-- A command of format 1 gets none from the database.
select pg_temp.affaire(25, 14, 7, 'Affaire aux règles');
select pg_temp.plan(47, 57, 25, 14, 2);
select pg_temp.plan(48, 58, 25, 14);
select pg_temp.plan(49, 59, 25, 14);
select pg_temp.prepare(25, 14, 7, 57, 1);
select pg_temp.admit(72, 25, 47, 14, 7);
select pg_temp.measure(93, 72, 14, 57, 'Vanne', 2, 'u');
select pg_temp.measure(94, 72, 14, 57, 'Coude', 4, 'u');
select pg_temp.measure(96, 72, 14, 57, 'Tube PER', 2.4, 'm', 1);
select pg_temp.measure(97, 72, 14, 57, 'Tube PER', 2.4, 'm', 2);
insert into public.takeoff_mapping_rules(id, tenant_id, name, match_pattern, match_type, action, action_params, priority) values
  (pg_temp.fx(91), pg_temp.fx(14), 'Vannes renommées', 'Vanne', 'exact', 'rename', '{"designation":"Vanne d''arrêt"}', 10),
  (pg_temp.fx(92), pg_temp.fx(14), 'Coudes écartés', 'Coude', 'exact', 'skip', '{}', 20),
  (pg_temp.fx(93), pg_temp.fx(14), 'Tubes renommés', 'Tube PER', 'exact', 'rename', '{"designation":"Tube PER 16"}', 30);
insert into commands values ('audited', pg_temp.command(72, pg_temp.first_draft(150), pg_temp.new_section(151),
  p_mapping => (select jsonb_agg(case entry ->> 'item_id'
      when pg_temp.fx(93)::text then entry || jsonb_build_object('rule_id', pg_temp.fx(91), 'action', 'rename', 'designation', 'Vanne d''arrêt')
      when pg_temp.fx(94)::text then entry || jsonb_build_object('rule_id', pg_temp.fx(92), 'action', 'skip')
      else entry || jsonb_build_object('rule_id', pg_temp.fx(93), 'action', 'rename', 'designation', 'Tube PER 16') end
      order by (entry ->> 'source_order')::integer) from jsonb_array_elements(pg_temp.mapping_plan(72)) as entry),
  p_format => 2));
create function pg_temp.attempt(p_name text) returns jsonb language plpgsql as $$
begin
  return pg_temp.confirm(p_name);
exception when others then
  return jsonb_build_object('raised', sqlerrm);
end;
$$;
create function pg_temp.lines(p_version integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(i.title, trim_scale(i.quantity), i.unit_code, i.unit_price_ht_cents)
    order by i.title collate "C", i.quantity), '[]'::jsonb)
  from public.estimate_items i where i.version_id = pg_temp.fx(p_version) and i.item_type = 'line'
$$;
-- The completed row as the server wrote it: the counts of the receipt of that send.
create function pg_temp.completed_row(p_job integer) returns jsonb language sql as $$
  select jsonb_build_object('table', 'takeoff_jobs', 'record', pg_temp.fx(p_job), 'version', receipt.target_version_id,
    'user', pg_temp.fx(7), 'after_data', jsonb_build_object('schema_version', 1, 'action', 'takeoff.apply.completed',
      'job_id', pg_temp.fx(p_job), 'tenant_id', pg_temp.fx(14), 'user_id', pg_temp.fx(7),
      'metadata', jsonb_build_object('estimate_version_id', receipt.target_version_id,
        'applied_items_count', (receipt.result ->> 'created_count')::integer + (receipt.result ->> 'updated_count')::integer,
        'excluded_items_count', (receipt.result ->> 'ignored_count')::integer)))
  from public.takeoff_send_receipts receipt where receipt.job_id = pg_temp.fx(p_job)
$$;
create function pg_temp.completed_rows(p_job integer) returns setof jsonb language sql as $$
  select jsonb_build_object('table', audit.table_name, 'record', audit.record_id, 'version', audit.estimate_version_id,
    'user', audit.user_id, 'after_data', audit.after_data)
  from public.audit_logs audit where audit.record_id = pg_temp.fx(p_job) and audit.action = 'takeoff.apply.completed'
$$;
select pg_temp.sign_in(7);
set local role authenticated;
create temp table audited_receipt as select pg_temp.attempt('audited') as receipt;
reset role;
select is((select receipt ->> 'raised' from audited_receipt), null, 'the send of format 2 is admitted');
select is(jsonb_build_array(pg_temp.lines(150), (select receipt.result -> 'created_count' from public.takeoff_send_receipts receipt
    where receipt.job_id = pg_temp.fx(72))),
  '[[["Tube PER 16", 5, "ml", 0], ["Vanne d''arrêt", 2, "u", 0]], 2]'::jsonb,
  'it wrote the renamed valve and one line for the two renamed tubes; the elbow was set aside');
select results_eq($$select pg_temp.completed_rows(72)$$, $$select pg_temp.completed_row(72)$$,
  'it wrote the application''s audit row in its transaction, with the counts of its receipt');
select results_eq($$select audit.table_name, audit.record_id, audit.estimate_version_id, audit.after_data - 'metadata',
    audit.after_data -> 'metadata' from public.audit_logs audit
  where audit.record_id = pg_temp.fx(72) and audit.action = 'takeoff.mapping.applied' order by audit.after_data #>> '{metadata,item_id}'$$,
  $$select 'takeoff_items'::text, pg_temp.fx(72), pg_temp.fx(150), jsonb_build_object('schema_version', 1,
      'action', 'takeoff.mapping.applied', 'job_id', pg_temp.fx(72), 'tenant_id', pg_temp.fx(14), 'user_id', pg_temp.fx(7)),
    jsonb_build_object('job_id', pg_temp.fx(72), 'item_id', pg_temp.fx(item_no), 'rule_id', pg_temp.fx(rule_no), 'action', action,
      'estimate_item_id', (pg_temp.line(150, title)).id)
  from (values (93, 91, 'rename', 'Vanne d''arrêt'), (94, 92, 'skip', null), (96, 93, 'rename', 'Tube PER 16'),
    (97, 93, 'rename', 'Tube PER 16')) as expected(item_no, rule_no, action, title) order by pg_temp.fx(item_no)::text$$,
  'and one row per line a mapping rule changed: the line it entered, none for the elbow set aside, the one tube line for both tubes');
select pg_temp.sign_in(7);
set local role authenticated;
select is((select pg_temp.run((select body from commands where name = 'audited')) ->> 'replayed'), 'true', 'the same request replays');
reset role;
select is((select count(*) from public.audit_logs audit where audit.record_id = pg_temp.fx(72)
    and audit.action in ('takeoff.apply.completed', 'takeoff.mapping.applied')), 5::bigint, 'a replay writes no audit row again');

select pg_temp.prepare(25, 14, 7, 58, 2);
select pg_temp.admit(73, 25, 48, 14, 7);
select pg_temp.measure(95, 73, 14, 58, 'Té', 1, 'u');
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(150), pg_temp.fx(7), pg_temp.fx(14), now() + interval '30 minutes', gen_random_uuid());
insert into commands values ('previous', pg_temp.command(73, pg_temp.draft(150), pg_temp.existing_section(151)));
select pg_temp.sign_in(7);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('previous')$$, 'a command of format 1 is sent as before');
reset role;
select is((select count(*) from public.audit_logs audit where audit.tenant_id = pg_temp.fx(14) and audit.record_id = pg_temp.fx(73)
    and audit.action in ('takeoff.apply.completed', 'takeoff.mapping.applied')), 0::bigint,
  'and gets no audit row from the database: the previous application writes it after the commit');

-- An addition of format 2 to the renamed valve's line: 2 + 1, counted as one line updated and none created.
select pg_temp.prepare(25, 14, 7, 59, 3);
select pg_temp.admit(74, 25, 49, 14, 7);
select pg_temp.measure(98, 74, 14, 59, 'Vanne d''arrêt', 1, 'u');
insert into commands values ('added', pg_temp.command(74, pg_temp.draft(150), pg_temp.existing_section(151),
  pg_temp.accumulation(98, 150, 'Vanne d''arrêt'), p_format => 2));
select pg_temp.sign_in(7);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('added')$$, 'the addition of format 2 is sent');
reset role;
select is((pg_temp.line(150, 'Vanne d''arrêt')).quantity, 3::numeric, 'the valve line holds 3');
select results_eq($$select pg_temp.completed_rows(74)$$, $$select pg_temp.completed_row(74)$$,
  'its audit row counts the line it updated');
select is((select (after_data #>> '{metadata,applied_items_count}')::integer from public.audit_logs
    where record_id = pg_temp.fx(74) and action = 'takeoff.apply.completed'), 1, 'one line updated, none created');

-- 6. A page replacement on a line no send fed twice: it gets no `takeoff_contributions` (no parts appear on it).
select pg_temp.affaire(26, 10, 1, 'Affaire remesurée sans parts');
select pg_temp.plan(50, 60, 26, 10);
select pg_temp.prepare(26, 10, 1, 60, 1);
select pg_temp.admit(75, 26, 50, 10, 1);
select pg_temp.measure(99, 75, 10, 60, 'Siphon', 1, 'u');
insert into commands values ('siphon', pg_temp.command(75, pg_temp.first_draft(160), pg_temp.new_section(161)));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('siphon')$$, 'the first takeoff of the page is sent');
reset role;
select pg_temp.prepare(26, 10, 1, 60, 2);
select pg_temp.admit(76, 26, 50, 10, 1);
select pg_temp.measure(100, 76, 10, 60, 'Siphon', 2, 'u');
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(160), pg_temp.fx(1), pg_temp.fx(10), now() + interval '30 minutes', gen_random_uuid());
insert into commands select 'siphon-again', pg_temp.command(76, pg_temp.draft(160), pg_temp.existing_section(161),
  p_page_decisions => jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', pg_temp.fx(60), 'content_hash', pg_temp.hash(60), 'logical_document_id', null,
      'file_name', 'plan-60.pdf'),
    'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.fx(75)), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.line(160, 'Siphon')).id,
      'expected_updated_at', (pg_temp.line(160, 'Siphon')).updated_at, 'action', 'update', 'take', null,
      'item_ids', jsonb_build_array(pg_temp.fx(99)))),
    'pairs', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(100),
      'estimate_item_id', (pg_temp.line(160, 'Siphon')).id)))));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('siphon-again')$$, 'the page is replaced');
reset role;
select is(jsonb_build_array(trim_scale((pg_temp.line(160, 'Siphon')).quantity),
    (pg_temp.line(160, 'Siphon')).source_metadata ? 'takeoff_contributions',
    (pg_temp.line(160, 'Siphon')).source_metadata #>> '{takeoff_page_replacement,job_id}'),
  jsonb_build_array(2, false, pg_temp.fx(76)), 'the line holds the new measure and no parts');


-- 7. Engine 2, two equal tubes of one file and one page: the line names no takeoff line of its own, so the outcome names
-- the representative's (the first by position), recorded by the finalizer; every preview names it, and the line keeps
-- its position.
select pg_temp.affaire(28, 12, 6, 'Affaire moteur 2 aux tubes');
select pg_temp.plan(51, 63, 28, 12);
select pg_temp.prepare(28, 12, 6, 63, 1);
select pg_temp.admit(83, 28, 51, 12, 6);
select pg_temp.measure(105, 83, 12, 63, 'Tube PER', 2.4, 'm');
select pg_temp.measure(106, 83, 12, 63, 'Tube PER', 2.4, 'm');
insert into commands values ('tubes-2', pg_temp.command(83, pg_temp.first_draft(180, 2), pg_temp.new_section(181)));
drop table if exists pg_temp._takeoff_apply_source, pg_temp._takeoff_apply_created_ids, pg_temp._takeoff_apply_matches,
  pg_temp._takeoff_apply_unmatched;
select pg_temp.sign_in(6);
set local role authenticated;
create temp table engine2_previews as select pg_temp.previewed_sources('tubes-2', 'Tube PER', 6) as source;
reset role;
select results_eq($$select distinct source from engine2_previews$$,
  $$values (jsonb_build_object('file', 'plan-63.pdf', 'page', 1, 'takeoff_item_id', pg_temp.fx(105)))$$,
  'on engine 2, every preview names the representative''s takeoff line: the first tube by position');
drop table if exists pg_temp._takeoff_apply_source, pg_temp._takeoff_apply_created_ids, pg_temp._takeoff_apply_matches,
  pg_temp._takeoff_apply_unmatched;
select pg_temp.sign_in(6);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('tubes-2')$$, 'the engine 2 send is confirmed as shown');
reset role;
select is((select jsonb_build_object('position', i.position, 'representative', i.source_metadata #>> '{takeoff_length_rounding,representative_item_id}',
    'quantity', trim_scale(i.quantity), 'lines', (select count(*) from public.estimate_items other where other.version_id = i.version_id
      and other.item_type = 'line'))
  from public.estimate_items i where i.version_id = pg_temp.fx(180) and i.item_type = 'line'),
  jsonb_build_object('position', 1, 'representative', pg_temp.fx(105)::text, 'quantity', 5, 'lines', 1),
  'the engine 2 line keeps the first tube''s position and names it as its representative');

-- 8. The format of a command is part of its request's identity. The same confirmation staged by a server of format 1
-- and then by one of format 2, or in the reverse order, is refused at the second staging (the member previews again).
-- The answer of a send says which format ran and whether what follows the commit was recorded as completed; completing
-- it writes the application's audit row for a command of format 1 when no server wrote it, once, and nothing more.
create function pg_temp.answer(p_sql text) returns text language plpgsql as $$
declare
  result jsonb;
begin
  execute p_sql into result;
  return coalesce(result::text, 'null');
exception when others then
  return 'raised ' || sqlerrm;
end;
$$;
select pg_temp.affaire(29, 14, 7, 'Affaire aux formats');
select pg_temp.plan(52, 64, 29, 14);
select pg_temp.plan(53, 65, 29, 14);
select pg_temp.prepare(29, 14, 7, 64, 1);
select pg_temp.admit(84, 29, 52, 14, 7);
select pg_temp.measure(107, 84, 14, 64, 'Raccord', 2, 'u');
insert into commands values ('format-1', pg_temp.command(84, pg_temp.first_draft(190), pg_temp.new_section(191)));
select pg_temp.sign_in(7);
set local role authenticated;
create temp table format_1_outcome as select pg_temp.dry('format-1') as outcome;
reset role;
update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', (select outcome from format_1_outcome))
where name = 'format-1';
select pg_temp.sign_in(7);
set local role authenticated;
select lives_ok($$select pg_temp.stage_body((select body from commands where name = 'format-1'))$$,
  'a server of format 1 stages the confirmation');
select throws_ok($$select pg_temp.stage_body((select body || '{"format_version": 2}'::jsonb from commands where name = 'format-1'))$$,
  '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT', 'a server of format 2 staging the same confirmation is refused');
select lives_ok($$select pg_temp.stage_body((select body || jsonb_build_object('format_version', 2, 'request_id', pg_temp.fx(202))
    from commands where name = 'format-1'))$$, 'a server of format 2 stages another confirmation');
select throws_ok($$select pg_temp.stage_body((select body || jsonb_build_object('format_version', 1, 'request_id', pg_temp.fx(202))
    from commands where name = 'format-1'))$$, '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT',
  'and a server of format 1 staging that one is refused');
create temp table format_1_answer as select public.send_takeoff_job(pg_temp.request((select body from commands where name = 'format-1')))
  as receipt;
reset role;
select is((select jsonb_build_object('format', receipt -> 'command_format', 'effects', receipt -> 'effects',
    'owner', receipt -> 'affaire_owner_id') from format_1_answer),
  jsonb_build_object('format', 1, 'effects', 'pending', 'owner', pg_temp.fx(7)),
  'the send of format 1 says which format ran, that its effects are pending, and the affaire''s owner at the send');
select is((select count(*) from public.audit_logs where record_id = pg_temp.fx(84) and action = 'takeoff.apply.completed'), 0::bigint,
  'the database wrote no audit row for format 1');
grant select on format_1_answer to service_role;
select pg_temp.sign_in(7);
set local role authenticated;
select is(pg_temp.answer($$select to_jsonb(public.complete_takeoff_send_effects((select (receipt ->> 'id')::uuid from format_1_answer)))$$),
  'raised permission denied for function complete_takeoff_send_effects', 'a member cannot record the effects completed');
reset role;
set local role service_role;
select is(pg_temp.answer($$select to_jsonb(public.complete_takeoff_send_effects((select (receipt ->> 'id')::uuid from format_1_answer)))$$),
  'true', 'the server records them completed');
select is(pg_temp.answer($$select to_jsonb(public.complete_takeoff_send_effects((select (receipt ->> 'id')::uuid from format_1_answer)))$$),
  'false', 'once');
reset role;
select results_eq($$select jsonb_build_object('user', audit.user_id, 'version', audit.estimate_version_id,
    'metadata', audit.after_data -> 'metadata') from public.audit_logs audit
  where audit.record_id = pg_temp.fx(84) and audit.action = 'takeoff.apply.completed'$$,
  $$values (jsonb_build_object('user', pg_temp.fx(7), 'version', pg_temp.fx(190), 'metadata',
    jsonb_build_object('estimate_version_id', pg_temp.fx(190), 'applied_items_count', 1, 'excluded_items_count', 0)))$$,
  'completing a format 1 send wrote its audit row once, as its server would have');
select pg_temp.sign_in(7);
set local role authenticated;
select is((select jsonb_build_object('replayed', answer -> 'replayed', 'format', answer -> 'command_format', 'effects', answer -> 'effects')
    from (select pg_temp.run((select body from commands where name = 'format-1')) as answer) as replayed),
  '{"replayed": true, "format": 1, "effects": "completed"}'::jsonb, 'a replay says the effects are completed');
reset role;
-- A format 1 send whose server wrote its audit row itself: completing it writes none.
select pg_temp.prepare(29, 14, 7, 65, 2);
select pg_temp.admit(85, 29, 53, 14, 7);
select pg_temp.measure(108, 85, 14, 65, 'Raccord', 1, 'u');
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(190), pg_temp.fx(7), pg_temp.fx(14), now() + interval '30 minutes', gen_random_uuid());
insert into commands values ('format-1-audited', pg_temp.command(85, pg_temp.draft(190), pg_temp.existing_section(191)));
select pg_temp.sign_in(7);
set local role authenticated;
create temp table format_1_audited as select pg_temp.confirm('format-1-audited') as receipt;
reset role;
grant select on format_1_audited to service_role;
insert into public.audit_logs (tenant_id, user_id, table_name, record_id, estimate_version_id, action, after_data)
values (pg_temp.fx(14), pg_temp.fx(7), 'takeoff_jobs', pg_temp.fx(85), pg_temp.fx(190), 'takeoff.apply.completed',
  '{"schema_version": 1, "action": "takeoff.apply.completed"}');
set local role service_role;
select is(pg_temp.answer($$select to_jsonb(public.complete_takeoff_send_effects((select (receipt ->> 'id')::uuid from format_1_audited)))$$),
  'true', 'its effects are recorded completed');
reset role;
select is((select count(*) from public.audit_logs where record_id = pg_temp.fx(85) and action = 'takeoff.apply.completed'), 1::bigint,
  'without a second audit row');
-- A format 2 send: the answer says so; completing it writes no audit row (the send wrote it).
select pg_temp.plan(55, 67, 29, 14);
select pg_temp.prepare(29, 14, 7, 67, 3);
select pg_temp.admit(86, 29, 55, 14, 7);
select pg_temp.measure(109, 86, 14, 67, 'Bouchon', 1, 'u');
insert into commands values ('format-2', pg_temp.command(86, pg_temp.draft(190), pg_temp.existing_section(191), p_format => 2));
select pg_temp.sign_in(7);
set local role authenticated;
create temp table format_2_answer as select pg_temp.confirm('format-2') as receipt;
reset role;
grant select on format_2_answer to service_role;
select is((select jsonb_build_object('format', receipt -> 'command_format', 'effects', receipt -> 'effects') from format_2_answer),
  '{"format": 2, "effects": "pending"}'::jsonb, 'the send of format 2 says so');
set local role service_role;
select is(pg_temp.answer($$select to_jsonb(public.complete_takeoff_send_effects((select (receipt ->> 'id')::uuid from format_2_answer)))$$),
  'true', 'its effects are recorded completed');
reset role;
select is((select count(*) from public.audit_logs where record_id = pg_temp.fx(86) and action = 'takeoff.apply.completed'), 1::bigint,
  'with the one audit row its send wrote');

-- 9. The mapping audit names what was applied to the line that remains. A rule classifies the addition D-like of a
-- washer: it adds to the earlier « Té » line, whose category stays; a rule classifies the re-read of the valve's page,
-- paired with the valve line of category X: the line keeps X. Neither writes a « takeoff.mapping.applied » row.
insert into public.estimate_categories (id, tenant_id, user_id, name, position) values
  (pg_temp.fx(301), pg_temp.fx(14), pg_temp.fx(7), 'Catégorie X fictive', 1),
  (pg_temp.fx(302), pg_temp.fx(14), pg_temp.fx(7), 'Catégorie Y fictive', 2);
insert into public.takeoff_mapping_rules(id, tenant_id, name, match_pattern, match_type, action, action_params, priority)
values (pg_temp.fx(95), pg_temp.fx(14), 'Classement Y', 'Té', 'exact', 'set_category',
  jsonb_build_object('category_id', pg_temp.fx(302)), 40);
create function pg_temp.classified(p_job integer, p_rule integer) returns jsonb language sql as $$
  select jsonb_agg(entry || jsonb_build_object('rule_id', pg_temp.fx(p_rule), 'action', 'set_category',
      'category_id', pg_temp.fx(302)) order by (entry ->> 'source_order')::integer)
  from jsonb_array_elements(pg_temp.mapping_plan(p_job)) as entry
$$;
select pg_temp.plan(54, 66, 25, 14);
select pg_temp.prepare(25, 14, 7, 66, 4);
select pg_temp.admit(80, 25, 54, 14, 7);
select pg_temp.measure(110, 80, 14, 66, 'Té', 1, 'u');
insert into commands values ('classified-addition', pg_temp.command(80, pg_temp.draft(150), pg_temp.existing_section(151),
  pg_temp.accumulation(110, 150, 'Té'), p_mapping => pg_temp.classified(80, 95), p_format => 2));
select pg_temp.sign_in(7);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('classified-addition')$$, 'a classified washer adds to the earlier line');
reset role;
select is(jsonb_build_array(trim_scale((pg_temp.line(150, 'Té')).quantity), (pg_temp.line(150, 'Té')).category_id,
    (select count(*) from public.audit_logs where record_id = pg_temp.fx(80) and action = 'takeoff.mapping.applied')),
  jsonb_build_array(2, null, 0), 'the line holds 2 and keeps its category: no mapping row for a category it did not get');

select set_config('miaouffrage.estimate_v3_writer', pg_temp.fx(150)::text, true);
update public.estimate_items set category_id = pg_temp.fx(301) where id = (pg_temp.line(150, 'Vanne d''arrêt')).id;
select public.estimate_v3_complete_entry_for_writer(pg_temp.fx(150), array[(pg_temp.line(150, 'Vanne d''arrêt')).id]);
select set_config('miaouffrage.estimate_v3_writer', '', true);
select pg_temp.prepare(25, 14, 7, 59, 5);
select pg_temp.admit(81, 25, 49, 14, 7);
select pg_temp.measure(111, 81, 14, 59, 'Vanne d''arrêt', 1, 'u');
insert into commands select 'classified-replacement', pg_temp.command(81, pg_temp.draft(150), pg_temp.existing_section(151),
  p_page_decisions => jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', pg_temp.fx(59), 'content_hash', pg_temp.hash(59), 'logical_document_id', null,
      'file_name', 'plan-59.pdf'),
    'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.fx(74)), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(jsonb_build_object('estimate_item_id', (pg_temp.line(150, 'Vanne d''arrêt')).id,
      'expected_updated_at', (pg_temp.line(150, 'Vanne d''arrêt')).updated_at, 'action', 'update', 'take', null,
      'item_ids', jsonb_build_array(pg_temp.fx(98)))),
    'pairs', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(111),
      'estimate_item_id', (pg_temp.line(150, 'Vanne d''arrêt')).id)))),
  p_mapping => pg_temp.classified(81, 95), p_format => 2);
select pg_temp.sign_in(7);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('classified-replacement')$$, 'a classified re-read replaces the valve''s page');
reset role;
select is(jsonb_build_array(trim_scale((pg_temp.line(150, 'Vanne d''arrêt')).quantity), (pg_temp.line(150, 'Vanne d''arrêt')).category_id,
    (select count(*) from public.audit_logs where record_id = pg_temp.fx(81) and action = 'takeoff.mapping.applied')),
  jsonb_build_array(3, pg_temp.fx(301), 0), 'the line holds 3 and keeps category X: no mapping row for a category it did not get');

select * from finish();
rollback;
