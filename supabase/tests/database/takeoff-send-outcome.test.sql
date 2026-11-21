-- Lot 2 M2 (migration …_takeoff_send_receipts.sql), what the member confirms is what is written: the preview is a dry
-- run of the very command (rolled back), the confirmation carries its outcome and is refused when the command would write
-- anything else; a request keeps the meaning it was staged with; the mapping rules and the destination's takeoffs are
-- read again under the locks; the receipt names every line created, changed or removed and the real target of each part;
-- a replay checks the caller's current rights and the confirmed fingerprint; plan A then plan B add up on both engines.
-- Isolation justified: the rolled-back run, the comparison under the locks, the staging, the receipt and the replay are
-- database contracts no journey can force deterministically. Written before the change: red on 986aea27 (no dry run, no
-- outcome, no stamp of the mapping rules nor of the linked takeoffs, the staging overwritten, accumulation on engine 3
-- only). All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.fx(n integer) returns uuid language sql immutable as $$
  select ('ab240000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

insert into auth.users(id, email, raw_user_meta_data)
select pg_temp.fx(n), 'takeoff-outcome-' || n || '@example.test', '{}'::jsonb from generate_series(1, 6) as n;
update public.tenant_memberships set is_default = false where user_id::text like 'ab240000-%';
insert into public.tenants(id, name, slug) values
  (pg_temp.fx(10), 'Takeoff outcome', 'takeoff-outcome-test'),
  (pg_temp.fx(12), 'Takeoff outcome engine 2', 'takeoff-outcome-engine-2-test');
insert into public.tenant_calc_policies(tenant_id, new_estimate_calc_engine, change_reason)
values (pg_temp.fx(12), 2, 'Moteur 2 du tenant fictif');
insert into public.tenant_memberships(tenant_id, user_id, role, is_default, created_at) values
  (pg_temp.fx(10), pg_temp.fx(1), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(10), pg_temp.fx(2), 'engineer', true, '2020-01-01'),
  (pg_temp.fx(10), pg_temp.fx(4), 'admin', true, '2020-01-01'),
  (pg_temp.fx(12), pg_temp.fx(6), 'engineer', true, '2020-01-01');

create function pg_temp.sign_in(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.fx(n)::text, true);
  select set_config('request.jwt.claims', jsonb_build_object('role', 'authenticated', 'sub', pg_temp.fx(n))::text, true);
$$;
create function pg_temp.sign_out() returns void language sql as $$
  select set_config('request.jwt.claim.sub', '', true);
  select set_config('request.jwt.claims', '', true);
$$;

-- One affaire per case; each takeoff reads its own plan (or, for the page re-read, the plan of an earlier takeoff) and is
-- admitted from its own preparation revision, as M1 admits it. `hash` is the attested content of the plan.
create function pg_temp.affaire(p_project integer, p_tenant integer, p_owner integer, p_name text) returns void language sql as $$
  select pg_temp.sign_out();
  insert into public.estimate_projects(id, tenant_id, user_id, name)
  values (pg_temp.fx(p_project), pg_temp.fx(p_tenant), pg_temp.fx(p_owner), p_name);
$$;
create function pg_temp.plan(p_set integer, p_file integer, p_project integer, p_tenant integer) returns void language sql as $$
  insert into public.plan_sets(id, tenant_id, project_id, name) values (pg_temp.fx(p_set), pg_temp.fx(p_tenant), pg_temp.fx(p_project),
    'Plans fictifs ' || p_set);
  insert into public.plan_files(id, tenant_id, plan_set_id, file_name, file_path, file_type, file_size_bytes, page_count)
  values (pg_temp.fx(p_file), pg_temp.fx(p_tenant), pg_temp.fx(p_set), 'plan-' || p_file || '.pdf',
    concat_ws('/', pg_temp.fx(p_tenant), pg_temp.fx(p_set), pg_temp.fx(p_file), 'plan-' || p_file || '.pdf'), 'application/pdf', 8, 1);
$$;
create function pg_temp.hash(p_file integer) returns text language sql immutable as $$
  select encode(sha256(convert_to('plan fictif ' || p_file, 'UTF8')), 'hex')
$$;
-- The affaire's preparation, confirmed on this plan at this revision (one row per affaire, revised in place).
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
    'execution_provider', 'chatgpt_local', 'execution_host_id', 'urn:uuid:ab240000-0000-4000-8000-000000000090',
    'processing_strategy', 'sync',
    'preparation_snapshot', (select confirmed_snapshot from public.takeoff_preparations where project_id = pg_temp.fx(p_project))));
  reset role;
  perform pg_temp.sign_out();
  update public.takeoff_jobs set status = 'completed' where id = pg_temp.fx(p_job);
  insert into public.takeoff_results(id, tenant_id, job_id) values (pg_temp.fx(p_job + 100), pg_temp.fx(p_tenant), pg_temp.fx(p_job));
end;
$$;
create function pg_temp.measure(p_item integer, p_job integer, p_tenant integer, p_file integer, p_designation text, p_quantity numeric,
  p_unit text, p_extra jsonb default '{}') returns void language sql as $$
  insert into public.takeoff_items(id, tenant_id, job_id, result_id, designation, quantity, unit, evidence, source_file_name,
    source_page, confidence, metadata, created_at)
  values (pg_temp.fx(p_item), pg_temp.fx(p_tenant), pg_temp.fx(p_job), pg_temp.fx(p_job + 100), p_designation, p_quantity, p_unit,
    'Repère page 1', 'plan-' || p_file || '.pdf', 1, 0.95,
    jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', pg_temp.fx(p_file))) || p_extra,
    '2026-11-20T10:00:00Z'::timestamptz + make_interval(secs => p_item));
$$;

-- The commands, built as send-server.ts builds them: a dry run first (its outcome is what the member sees), then the
-- send that carries that outcome. Staged by the service, sent by the member's session by request identity only.
create function pg_temp.command(p_job integer, p_destination jsonb, p_section jsonb, p_accumulations jsonb default '[]',
  p_page_decisions jsonb default '[]', p_mapping jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('format_version', 1, 'mode', 'dry_run', 'request_id', gen_random_uuid(), 'job_id', j.id,
    'fingerprint', repeat('f', 64),
    'client', jsonb_build_object('fingerprint', repeat('f', 64), 'destination', p_destination - 'version_payload',
      'section', p_section - 'id', 'page_decisions', p_page_decisions, 'override', false),
    'destination', p_destination, 'section', p_section,
    'expected', jsonb_build_object(
      'versions', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'status', v.status, 'updated_at', v.updated_at)
        order by v.id), '[]'::jsonb) from public.estimate_versions v where v.project_id = j.project_id),
      'job_stamp', public.takeoff_rule_job_stamp(j.tenant_id, j.project_id, j.id),
      'peers_stamp', case p_destination ->> 'kind'
        when 'existing_draft' then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'version_id')::uuid)
        when 'version_copy' then public.takeoff_send_peers_stamp(j.tenant_id, (p_destination ->> 'source_version_id')::uuid) end,
      'mapping_stamp', public.takeoff_mapping_rules_stamp(j.tenant_id)),
    'mapping_plan', coalesce(p_mapping, (select jsonb_agg(jsonb_build_object('item_id', i.id, 'source_order', i.rank - 1,
        'rule_id', null, 'action', 'none', 'designation', btrim(i.designation), 'unit_price_cents', null, 'category_id', null,
        'assembly_id', null) order by i.rank)
      from (select item.*, row_number() over (order by item.created_at, item.id) as rank
        from public.takeoff_items item where item.job_id = j.id) as i)),
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
create function pg_temp.new_section(p_id integer, p_title text default 'Métré — plans fictifs') returns jsonb language sql immutable as $$
  select jsonb_build_object('kind', 'new', 'id', pg_temp.fx(p_id), 'title', p_title)
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
-- Stages as the service for the signed-in member, then sends as that member.
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
-- The preview's outcome: a dry run of the command under a fresh identity.
create function pg_temp.dry(p_name text) returns jsonb language plpgsql as $$
declare
  answer jsonb := pg_temp.run((select body from commands where name = p_name) || jsonb_build_object('request_id', gen_random_uuid()));
begin
  if answer ->> 'dry_run' is distinct from 'true' then
    raise exception 'not a dry run: %', answer;
  end if;
  return answer -> 'outcome';
end;
$$;
-- The confirmation of what the dry run showed: the same command, sent with that outcome.
create function pg_temp.confirm(p_name text, p_outcome jsonb default null) returns jsonb language plpgsql as $$
declare
  shown jsonb := coalesce(p_outcome, pg_temp.dry(p_name));
begin
  update commands set body = body || jsonb_build_object('mode', 'send', 'expected_outcome', shown) where name = p_name;
  return pg_temp.run((select body from commands where name = p_name));
end;
$$;
create function pg_temp.lines(p_version integer) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(i.title, trim_scale(i.quantity), i.unit_code, i.unit_price_ht_cents)
    order by i.title collate "C", i.quantity), '[]'::jsonb)
  from public.estimate_items i where i.version_id = pg_temp.fx(p_version) and i.item_type = 'line'
$$;

-- Affaire 20: a tube of 12.5 m, two lengths of 2.4 m of one PER tube and three valves on plan 50.
select pg_temp.affaire(20, 10, 1, 'Affaire aux longueurs');
select pg_temp.plan(40, 50, 20, 10);
select pg_temp.prepare(20, 10, 1, 50, 1);
select pg_temp.admit(61, 20, 40, 10, 1);
select pg_temp.measure(81, 61, 10, 50, 'Tube cuivre', 12.5, 'm');
select pg_temp.measure(82, 61, 10, 50, 'Tube PER', 2.4, 'm');
select pg_temp.measure(83, 61, 10, 50, 'Tube PER', 2.4, 'm');
select pg_temp.measure(84, 61, 10, 50, 'Vanne', 3, 'u');

-- 1. The preview is the command run and rolled back: it shows the lines as the writer leaves them (the length rounded up
-- once, two equal lengths grouped into one line), and writes nothing.
insert into commands values ('lengths', pg_temp.command(61, pg_temp.first_draft(100), pg_temp.new_section(110)));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table shown as select pg_temp.dry('lengths') as outcome;
reset role;
select results_eq($$select line ->> 'change', line ->> 'title', line ->> 'unit', (line ->> 'quantity')::numeric,
    jsonb_array_length(line -> 'takeoff_item_ids'), line ->> 'section'
  from shown cross join jsonb_array_elements(outcome -> 'lines') as line order by line ->> 'title'$$,
  $$values ('created'::text, 'Tube cuivre'::text, 'ml'::text, 13::numeric, 1, 'new'::text),
    ('created', 'Tube PER', 'ml', 5, 2, 'new'), ('created', 'Vanne', 'u', 3, 1, 'new')$$,
  'the preview shows 13 m for 12.5 m, one PER line of 5 m for two lengths of 2.4 m, and the valves');
select results_eq($$select part ->> 'takeoff_item_id', part ->> 'target' from shown cross join jsonb_array_elements(outcome -> 'parts') as part
  order by 1$$, $$values (pg_temp.fx(81)::text, 'new_line'::text), (pg_temp.fx(82)::text, 'new_line'),
    (pg_temp.fx(83)::text, 'new_line'), (pg_temp.fx(84)::text, 'new_line')$$, 'each takeoff line names where it goes');
select is((select jsonb_build_array((select count(*) from public.estimate_versions where project_id = pg_temp.fx(20)),
    (select count(*) from public.takeoff_send_receipts where job_id = pg_temp.fx(61)),
    (select estimate_version_id from public.takeoff_jobs where id = pg_temp.fx(61)),
    (select count(*) from public.takeoff_page_decisions where job_id = pg_temp.fx(61)))),
  '[0, 0, null, 0]'::jsonb, 'the dry run leaves no version, receipt, attachment nor decision');

-- 2. What the member confirms is what is written: an outcome that shows 12.5 m (the source measure) is refused, and nothing
-- is written; the outcome of the dry run is sent as shown.
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.confirm('lengths', jsonb_set((select outcome from shown), '{lines,0,quantity}', '12.5'))$$,
  '40001', 'TAKEOFF_SEND_PREVIEW_STALE', 'a confirmation of other quantities than the command would write is refused');
reset role;
select is((select count(*) from public.estimate_versions where project_id = pg_temp.fx(20)), 0::bigint, 'nothing was written');

-- 3. A request keeps the meaning it was staged with: a second submission of the same request with another page decision
-- (another hash) is refused, and the first staged command stays as it was.
insert into commands values ('staged-once', pg_temp.command(61, pg_temp.first_draft(100), pg_temp.new_section(110)));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.stage_body((select body from commands where name = 'staged-once'))$$, 'the first submission is staged');
select throws_ok($$select pg_temp.stage_body(jsonb_set((select body from commands where name = 'staged-once'), '{client,page_decisions}',
    '[{"decision":"keep_both","reason_code":"other_zone"}]'))$$,
  '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT', 'the same request with another choice is refused at staging');
reset role;
select is((select command -> 'client' -> 'page_decisions' from private.takeoff_send_commands
  where request_id = ((select body from commands where name = 'staged-once') ->> 'request_id')::uuid), '[]'::jsonb,
  'the first staged command is unchanged');

-- 4. A staged command does not outlive the mapping rules that produced it: an administrator turns the rule that kept the
-- valves into « skip » after the preview, and the confirmation is refused.
insert into public.takeoff_mapping_rules(id, tenant_id, name, match_pattern, match_type, action, action_params, priority)
values (pg_temp.fx(90), pg_temp.fx(10), 'Vannes renommées', 'Vanne', 'exact', 'rename', '{"designation":"Vanne d''arrêt"}', 10);
insert into commands values ('rules', pg_temp.command(61, pg_temp.first_draft(100), pg_temp.new_section(110)));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table rules_shown as select pg_temp.dry('rules') as outcome;
reset role;
update public.takeoff_mapping_rules set action = 'skip', action_params = '{}' where id = pg_temp.fx(90);
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select pg_temp.confirm('rules', (select outcome from rules_shown))$$, '40001', 'TAKEOFF_SEND_PREVIEW_STALE',
  'a mapping rule changed since the preview refuses the send');
reset role;
delete from public.takeoff_mapping_rules where id = pg_temp.fx(90);

-- 5. Sent as shown: the lines as the dry run showed them, the receipt holds that outcome and the plan's attested hash.
select pg_temp.sign_in(1);
set local role authenticated;
create temp table sent as select pg_temp.confirm('lengths', (select outcome from shown)) as receipt;
reset role;
select is(pg_temp.lines(100), '[["Tube PER", 5, "ml", 0], ["Tube cuivre", 13, "ml", 0], ["Vanne", 3, "u", 0]]'::jsonb,
  'the estimate holds the quantities the member saw');
select is((select result -> 'outcome' from public.takeoff_send_receipts where job_id = pg_temp.fx(61)),
  (select outcome from shown), 'the receipt holds the outcome that was confirmed');
select is((select part #>> '{source,plan_content_hash}' from public.takeoff_send_receipts receipt
    cross join jsonb_array_elements(receipt.write_plan -> 'parts') as part
  where receipt.job_id = pg_temp.fx(61) and part ->> 'takeoff_item_id' = pg_temp.fx(81)::text),
  pg_temp.hash(50), 'each part names the content its plan was attested with');

-- 6. A replay checks the caller's current rights and the fingerprint it was confirmed with.
select pg_temp.sign_in(1);
set local role authenticated;
select is((select pg_temp.run((select body from commands where name = 'lengths')) ->> 'replayed'), 'true', 'the same request replays');
select throws_ok($$select public.send_takeoff_job(jsonb_set(pg_temp.request((select body from commands where name = 'lengths')),
  '{fingerprint}', to_jsonb(repeat('e', 64))))$$, '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT',
  'another fingerprint for the same request is a conflict, staged row or not');
reset role;
delete from private.takeoff_send_commands where request_id = ((select body from commands where name = 'lengths') ->> 'request_id')::uuid;
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select public.send_takeoff_job(jsonb_set(pg_temp.request((select body from commands where name = 'lengths')),
  '{fingerprint}', to_jsonb(repeat('e', 64))))$$, '40001', 'TAKEOFF_SEND_REQUEST_CONFLICT',
  'and once the staged row is gone, another fingerprint still gets no receipt');
reset role;
-- The affaire passes to another engineer: its first owner no longer reads the takeoff, nor its receipt by a replay.
update public.estimate_projects set user_id = pg_temp.fx(2) where id = pg_temp.fx(20);
select pg_temp.sign_in(1);
set local role authenticated;
select throws_ok($$select public.send_takeoff_job(pg_temp.request((select body from commands where name = 'lengths')))$$,
  '42501', 'TAKEOFF_SEND_RECEIPT_NOT_READABLE', 'a member who lost access to the affaire gets no receipt');
reset role;
update public.estimate_projects set user_id = pg_temp.fx(1) where id = pg_temp.fx(20);

-- 7. Plan A then plan B on engine 3, with a price the estimator typed: 3 then 2 give one line of 5 at the same price.
select pg_temp.affaire(23, 10, 1, 'Affaire A puis B');
select pg_temp.plan(43, 53, 23, 10);
select pg_temp.plan(44, 54, 23, 10);
select pg_temp.prepare(23, 10, 1, 53, 1);
select pg_temp.admit(68, 23, 43, 10, 1);
select pg_temp.measure(85, 68, 10, 53, 'Lavabo', 3, 'u');
select pg_temp.prepare(23, 10, 1, 54, 2);
select pg_temp.admit(69, 23, 44, 10, 1);
select pg_temp.measure(86, 69, 10, 54, 'Lavabo', 2, 'u');
insert into commands values ('a3', pg_temp.command(68, pg_temp.first_draft(130), pg_temp.new_section(131)));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('a3')$$, 'A sends its 3 washbasins to a first draft of engine 3');
reset role;
select set_config('miaouffrage.estimate_v3_writer', pg_temp.fx(130)::text, true);
update public.estimate_items set unit_price_ht_cents = 4500 where version_id = pg_temp.fx(130) and item_type = 'line';
select public.estimate_v3_complete_entry_for_writer(pg_temp.fx(130),
  array(select id from public.estimate_items where version_id = pg_temp.fx(130) and item_type = 'line'));
select set_config('miaouffrage.estimate_v3_writer', '', true);
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(130), pg_temp.fx(1), pg_temp.fx(10), now() + interval '30 minutes', gen_random_uuid());
insert into commands select 'b3', pg_temp.command(69, pg_temp.draft(130), pg_temp.existing_section(131),
  (select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(86), 'estimate_item_id', line.id,
    'expected_updated_at', line.updated_at, 'expected_quantity', line.quantity))
   from public.estimate_items line where line.version_id = pg_temp.fx(130) and line.item_type = 'line'));
select pg_temp.sign_in(1);
set local role authenticated;
create temp table b3_shown as select pg_temp.dry('b3') as outcome;
select lives_ok($$select pg_temp.confirm('b3', (select outcome from b3_shown))$$, 'B adds its 2 to that line');
reset role;
select results_eq($$select line ->> 'change', (line ->> 'quantity_before')::numeric, (line ->> 'quantity')::numeric,
    (line ->> 'unit_price_ht_cents')::integer from b3_shown cross join jsonb_array_elements(outcome -> 'lines') as line$$,
  $$values ('changed'::text, 3::numeric, 5::numeric, 4500)$$, 'the preview of B shows the line going from 3 to 5 at its price');
select is(pg_temp.lines(130), '[["Lavabo", 5, "u", 4500]]'::jsonb, 'one line of 5 on engine 3, its price unchanged');
select results_eq($$select part #>> '{target,kind}', part ->> 'estimate_item_id', part #>> '{target,quantity_before}'
  from public.takeoff_send_receipts receipt cross join jsonb_array_elements(receipt.write_plan -> 'parts') as part
  where receipt.job_id = pg_temp.fx(69)$$,
  $$select 'existing_line'::text, id::text, '3'::text from public.estimate_items where version_id = pg_temp.fx(130) and item_type = 'line'$$,
  'the receipt names the earlier line as the target of B''s part');

-- 8. The same on engine 2, the engine of this tenant's new estimates: one line of 5, its price unchanged.
select pg_temp.affaire(22, 12, 6, 'Affaire moteur 2');
select pg_temp.plan(45, 55, 22, 12);
select pg_temp.plan(46, 56, 22, 12);
select pg_temp.prepare(22, 12, 6, 55, 1);
select pg_temp.admit(66, 22, 45, 12, 6);
select pg_temp.measure(87, 66, 12, 55, 'Lavabo', 3, 'u');
select pg_temp.prepare(22, 12, 6, 56, 2);
select pg_temp.admit(67, 22, 46, 12, 6);
select pg_temp.measure(88, 67, 12, 56, 'Lavabo', 2, 'u');
insert into commands values ('a2', pg_temp.command(66, pg_temp.first_draft(120, 2), pg_temp.new_section(121)));
select pg_temp.sign_in(6);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('a2')$$, 'A sends its 3 washbasins to a first draft of engine 2');
reset role;
select is((select calc_engine_version::integer from public.estimate_versions where id = pg_temp.fx(120)), 2, 'the draft is of engine 2');
update public.estimate_items set unit_price_ht_cents = 4500 where version_id = pg_temp.fx(120) and item_type = 'line';
-- The line as a save of the day before left it: the send runs later, in its own transaction (here they share the test's,
-- whose now() would otherwise hide that the engine 2 writer recalculates every line of the version, and dates it anew).
set local session_replication_role = replica;
update public.estimate_items set updated_at = '2026-11-20T08:00:00Z' where version_id = pg_temp.fx(120) and item_type = 'line';
set local session_replication_role = origin;
-- Each send is its own transaction in the application; here they share the test's, so the engine 2 writer's work tables go.
drop table if exists pg_temp._takeoff_apply_source, pg_temp._takeoff_apply_created_ids, pg_temp._takeoff_apply_matches,
  pg_temp._takeoff_apply_unmatched;
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(120), pg_temp.fx(6), pg_temp.fx(12), now() + interval '30 minutes', gen_random_uuid());
insert into commands select 'b2', pg_temp.command(67, pg_temp.draft(120), pg_temp.existing_section(121),
  (select jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(88), 'estimate_item_id', line.id,
    'expected_updated_at', line.updated_at, 'expected_quantity', line.quantity))
   from public.estimate_items line where line.version_id = pg_temp.fx(120) and line.item_type = 'line'));
select pg_temp.sign_in(6);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('b2')$$, 'B adds its 2 to that line on engine 2');
reset role;
-- An engine 2 line keeps its unit in its description.
select is(pg_temp.lines(120), '[["Lavabo", 5, null, 4500]]'::jsonb, 'one line of 5 on engine 2, its price unchanged');
select is((select source_metadata #> '{takeoff_contributions,item_ids}' from public.estimate_items
  where version_id = pg_temp.fx(120) and item_type = 'line'), jsonb_build_array(pg_temp.fx(87), pg_temp.fx(88)),
  'the line names both takeoff lines');

-- 9. A page measured again: the member replaces it, pairs the new measure with the earlier line of section S1 and removes
-- the earlier valve, moved meanwhile to section S2. The receipt names the changed line, the removed one and both sections.
select pg_temp.affaire(24, 10, 1, 'Affaire page remesurée');
select pg_temp.plan(47, 57, 24, 10);
select pg_temp.prepare(24, 10, 1, 57, 1);
select pg_temp.admit(70, 24, 47, 10, 1);
select pg_temp.measure(91, 70, 10, 57, 'Réseau EF', 8, 'm');
select pg_temp.measure(92, 70, 10, 57, 'Vanne', 2, 'u');
insert into commands values ('earlier', pg_temp.command(70, pg_temp.first_draft(140), pg_temp.new_section(141, 'S1')));
select pg_temp.sign_in(1);
set local role authenticated;
select lives_ok($$select pg_temp.confirm('earlier')$$, 'the earlier takeoff of the page is sent');
reset role;
select set_config('miaouffrage.estimate_v3_writer', pg_temp.fx(140)::text, true);
insert into public.estimate_items(id, tenant_id, version_id, item_type, position, title)
values (pg_temp.fx(142), pg_temp.fx(10), pg_temp.fx(140), 'section', 2, 'S2');
update public.estimate_items set parent_id = pg_temp.fx(142), position = 1
where version_id = pg_temp.fx(140) and item_type = 'line' and title = 'Vanne';
select public.estimate_v3_complete_entry_for_writer(pg_temp.fx(140),
  array(select id from public.estimate_items where version_id = pg_temp.fx(140) and item_type = 'line'));
select set_config('miaouffrage.estimate_v3_writer', '', true);
select pg_temp.prepare(24, 10, 1, 57, 2);
select pg_temp.admit(71, 24, 47, 10, 1);
select pg_temp.measure(93, 71, 10, 57, 'Réseau EF', 9, 'm');
insert into public.draft_locks(version_id, user_id, tenant_id, expires_at, session_id)
values (pg_temp.fx(140), pg_temp.fx(1), pg_temp.fx(10), now() + interval '30 minutes', gen_random_uuid());
create function pg_temp.line_of(p_version integer, p_title text) returns public.estimate_items language sql as $$
  select item from public.estimate_items item where item.version_id = pg_temp.fx(p_version) and item.item_type = 'line'
    and item.title = p_title
$$;
insert into commands select 'remeasured', pg_temp.command(71, pg_temp.draft(140), pg_temp.existing_section(141),
  p_page_decisions => jsonb_build_array(jsonb_build_object(
    'document', jsonb_build_object('plan_file_id', pg_temp.fx(57), 'content_hash', pg_temp.hash(57), 'logical_document_id', null,
      'file_name', 'plan-57.pdf'),
    'source_page', 1, 'earlier_job_ids', jsonb_build_array(pg_temp.fx(70)), 'decision', 'replace', 'reason_code', null, 'note', null,
    'lines', jsonb_build_array(
      jsonb_build_object('estimate_item_id', (pg_temp.line_of(140, 'Réseau EF')).id,
        'expected_updated_at', (pg_temp.line_of(140, 'Réseau EF')).updated_at, 'action', 'update', 'take', null,
        'item_ids', jsonb_build_array(pg_temp.fx(91))),
      jsonb_build_object('estimate_item_id', (pg_temp.line_of(140, 'Vanne')).id,
        'expected_updated_at', (pg_temp.line_of(140, 'Vanne')).updated_at, 'action', 'remove', 'take', null,
        'item_ids', jsonb_build_array(pg_temp.fx(92)))),
    'pairs', jsonb_build_array(jsonb_build_object('takeoff_item_id', pg_temp.fx(93),
      'estimate_item_id', (pg_temp.line_of(140, 'Réseau EF')).id)))));
create temp table earlier_lines as
select id, title, parent_id from public.estimate_items where version_id = pg_temp.fx(140) and item_type = 'line';
select pg_temp.sign_in(1);
set local role authenticated;
create temp table remeasured_shown as select pg_temp.dry('remeasured') as outcome;
select lives_ok($$select pg_temp.confirm('remeasured', (select outcome from remeasured_shown))$$,
  'the page is replaced as decided');
reset role;
select results_eq($$select line ->> 'change', line ->> 'title', line ->> 'section', (line ->> 'quantity')::numeric
  from remeasured_shown cross join jsonb_array_elements(outcome -> 'lines') as line order by 1, 2$$,
  $$values ('changed'::text, 'Réseau EF'::text, 'item:' || pg_temp.fx(141), 9::numeric),
    ('removed', 'Vanne', 'item:' || pg_temp.fx(142), 2)$$,
  'the preview showed the changed line and the removed one, each in its own section');
select is(pg_temp.lines(140), '[["Réseau EF", 9, "ml", 0]]'::jsonb, 'the page is counted once');
select results_eq($$select receipt.result -> 'lines_changed', receipt.result -> 'lines_removed' -> 0 ->> 'id',
    receipt.result -> 'lines_removed' -> 0 ->> 'section_id',
    (select jsonb_agg(value order by value) from jsonb_array_elements_text(receipt.result -> 'sections_changed'))
  from public.takeoff_send_receipts receipt where receipt.job_id = pg_temp.fx(71)$$,
  $$select jsonb_build_array((select id from earlier_lines where title = 'Réseau EF')),
    (select id::text from earlier_lines where title = 'Vanne'), pg_temp.fx(142)::text,
    (select jsonb_agg(value order by value) from jsonb_array_elements_text(jsonb_build_array(pg_temp.fx(141), pg_temp.fx(142))))$$,
  'the receipt names the changed line, the removed line with its section, and both sections');
select results_eq($$select part ->> 'takeoff_item_id', part #>> '{target,kind}', part ->> 'section_id'
  from public.takeoff_send_receipts receipt cross join jsonb_array_elements(receipt.write_plan -> 'parts') as part
  where receipt.job_id = pg_temp.fx(71)$$,
  $$values (pg_temp.fx(93)::text, 'existing_line'::text, pg_temp.fx(141)::text)$$,
  'the part names its real target: the earlier line of S1');

-- 10. The takeoffs a destination's lines come from are its peers: a copy carried over takeoff A, still attached to V1.
-- An edit of A changes what a send to that copy is compared with.
select is((select count(*) from public.takeoff_version_links), 0::bigint, 'no carried-over takeoff yet');
select pg_temp.sign_in(1);
set local role authenticated;
create temp table carried as select public.duplicate_estimate_version(pg_temp.fx(140), false) as copy_id;
reset role;
select ok((select count(*) > 0 from public.takeoff_version_links where target_version_id = (select copy_id from carried)),
  'the copy carries the takeoffs of its source over');
create temp table peers_before as
select public.takeoff_send_peers_stamp(pg_temp.fx(10), (select copy_id from carried)) as stamp;
-- A's line as an edit leaves it (written past the guards that freeze an applied takeoff: only its stamp matters here).
set local session_replication_role = replica;
update public.takeoff_items set updated_at = updated_at + interval '1 second' where id = pg_temp.fx(93);
set local session_replication_role = origin;
select isnt(public.takeoff_send_peers_stamp(pg_temp.fx(10), (select copy_id from carried)), (select stamp from peers_before),
  'an edit of a carried-over takeoff changes the stamp a send to the copy is checked against');

select * from finish();
rollback;
