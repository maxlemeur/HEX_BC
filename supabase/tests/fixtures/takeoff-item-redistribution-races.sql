-- A separate draft already holds three units from a different plan. Copy the stored
-- shapes of the existing fixture, substituting a new job, document, part and line.
select is(extensions.dblink_exec('race_setup',format($prior$
begin;
set local session_replication_role=replica;
insert into public.estimate_versions select (jsonb_populate_record(null::public.estimate_versions,
  to_jsonb(v)||jsonb_build_object('id',%1$L,'version_number',99))).*
  from public.estimate_versions v where id=%2$L;
insert into public.takeoff_jobs(id,tenant_id,project_id,estimate_version_id,level,status,source_file_name,created_by)
  values(%3$L,%4$L,%5$L,%1$L,'A','applied','Autre plan.pdf',%6$L);
insert into public.estimate_items select (jsonb_populate_record(null::public.estimate_items,to_jsonb(i)||jsonb_build_object(
  'id',case when i.item_type='section' then %7$L else %8$L end,'version_id',%1$L,
  'parent_id',case when i.item_type='line' then %7$L end,'source_job_id',case when i.item_type='line' then %3$L end))).*
  from public.estimate_items i where i.id in (
    select estimate_item_id from public.takeoff_item_send_targets where version_id=%2$L union
    select estimate_item_id from public.takeoff_item_send_sections where version_id=%2$L);
insert into public.takeoff_item_send_receipts select (jsonb_populate_record(null::public.takeoff_item_send_receipts,
  to_jsonb(r)||jsonb_build_object('id',%9$L,'job_id',%3$L,'version_id',%1$L,'request_id',%10$L))).*
  from public.takeoff_item_send_receipts r where version_id=%2$L and command_kind='send';
insert into public.takeoff_item_send_sections select (jsonb_populate_record(null::public.takeoff_item_send_sections,
  to_jsonb(s)||jsonb_build_object('id',gen_random_uuid(),'version_id',%1$L,'estimate_item_id',%7$L,'receipt_id',%9$L))).*
  from public.takeoff_item_send_sections s where version_id=%2$L;
insert into public.takeoff_item_send_targets select (jsonb_populate_record(null::public.takeoff_item_send_targets,
  to_jsonb(t)||jsonb_build_object('id',%11$L,'version_id',%1$L,'estimate_item_id',%8$L,'created_by_receipt_id',%9$L))).*
  from public.takeoff_item_send_targets t where version_id=%2$L;
insert into public.takeoff_item_send_parts select (jsonb_populate_record(null::public.takeoff_item_send_parts,
  to_jsonb(p)||jsonb_build_object('id',%12$L,'version_id',%1$L,'job_id',%3$L,'target_id',%11$L,'receipt_id',%9$L,
    'plan_logical_id',%13$L,'answer_id',gen_random_uuid(),'observation_ids',array[gen_random_uuid()],'takeoff_item_ids',array[gen_random_uuid()]))).*
  from public.takeoff_item_send_parts p where version_id=%2$L and state='live';
insert into public.takeoff_item_send_pages select (jsonb_populate_record(null::public.takeoff_item_send_pages,
  to_jsonb(g)||jsonb_build_object('id',gen_random_uuid(),'version_id',%1$L,'job_id',%3$L,'receipt_id',%9$L,
    'part_ids',jsonb_build_array(%12$L),'document',jsonb_build_object('file_name','Autre plan.pdf','content_hash',repeat('e',64),'plan_file_id',%13$L)))).*
  from public.takeoff_item_send_pages g where version_id=%2$L;
insert into public.draft_locks(version_id,tenant_id,user_id,expires_at,session_id)
  values(%1$L,%4$L,%6$L,clock_timestamp()+interval '30 minutes',gen_random_uuid());
commit
$prior$,pg_temp.f(970),pg_temp.f(730),pg_temp.f(971),pg_temp.tenant(),pg_temp.f(20),pg_temp.f(1),
  pg_temp.f(972),pg_temp.f(973),pg_temp.f(974),pg_temp.f(975),pg_temp.f(976),pg_temp.f(977),pg_temp.f(978))),'COMMIT',
  'a second plan has sent its three units on another draft of the same affaire');
create function pg_temp.redistribution_reading_parts(p_job uuid) returns jsonb language sql stable as $$
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
create function pg_temp.redistribution_send_plan(p_job uuid, p_version uuid) returns jsonb language sql as $$
  with line as (select i.id, i.updated_at, i.quantity from public.estimate_items i
      join public.takeoff_item_send_targets t on t.estimate_item_id = i.id
      where t.version_id = p_version and t.item_id = pg_temp.f(300)),
    target as (select jsonb_build_object('key', pg_temp.f(300) || '|together', 'item_id', pg_temp.f(300), 'compartment_key', 'together',
      'line', jsonb_build_object('kind', 'earlier_line', 'estimate_item_id', line.id, 'expected_updated_at', line.updated_at,
        'expected_quantity', line.quantity),
      'unit_code', 'u', 'quantity_after', line.quantity + (select sum((c.value ->> 'quantity')::numeric)
        from jsonb_array_elements(pg_temp.redistribution_reading_parts(p_job)) c(value)),
      'quantity', jsonb_build_object('kept_entry', false), 'rule', null, 'contributions', pg_temp.redistribution_reading_parts(p_job),
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
      'observation_ids', (select coalesce(jsonb_agg(o.value), '[]'::jsonb) from jsonb_array_elements(pg_temp.redistribution_reading_parts(p_job)) c(value)
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
create function pg_temp.redistribution_accept(p_key integer, p_job uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('command_version', 1, 'intent_key', pg_temp.f(p_key), 'gesture', 'accept_measured',
    'scope', '{"kind":"affaire"}'::jsonb,
    'targets', jsonb_build_array(jsonb_build_object('item_id', pg_temp.f(300), 'entry_revision', 0,
      'answers', (select jsonb_agg(jsonb_build_object('answer_id', a.id, 'decision_revision', 0, 'entry_revision', 0))
        from public.takeoff_item_answers a where a.job_id = p_job and a.item_id = pg_temp.f(300)))),
    'apply', jsonb_build_array(pg_temp.f(300)), 'skipped', '[]'::jsonb)
$$;
select is(extensions.dblink_exec('race_setup',format('update public.takeoff_items set rules_stale=false,rules_evaluated_at=now(),rule_results=''[]''::jsonb where job_id=%L',pg_temp.f(1120))),
  'UPDATE 1','the incoming reading has evaluated rules');
select is((select x.result::jsonb->>'outcome' from extensions.dblink('race_a',pg_temp.review_sql(20,pg_temp.redistribution_accept(959,pg_temp.f(1120))))x(result text)),
  'applied','the incoming reading is accepted');
insert into plans values ('redistribution-other-plan',pg_temp.redistribution_send_plan(pg_temp.f(1120),pg_temp.f(970)),null);
-- The competing send must be independently valid. Probe it and roll it back before the actual race.
select is(extensions.dblink_exec('race_a','begin'),'BEGIN','check the competing send before the race');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','use the send RPC');
select is((select x.result::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.send_sql(949,'redistribution-other-plan'))x(result text)),
  'false','the other plan could feed this item before the redistribution');
select is(extensions.dblink_exec('race_a','rollback'),'ROLLBACK','restore the shared starting point');
create function pg_temp.redistribution_sql(mode text, request integer) returns text language sql stable as $$
  select format('select public.redistribute_takeoff_item(%L,%L,%L,%L,%L,%L,false,%L,%L)::text',
    pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),pg_temp.f(970),pg_temp.f(300),mode,pg_temp.f(request),
    public.preview_takeoff_item_redistribution(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(20),pg_temp.f(970),pg_temp.f(300),mode,false)->>'digest')
$$;
create function pg_temp.loser(waiting text, holding text, refusal text) returns setof text language plpgsql as $$
begin
  return next ok(pg_temp.waits_for(waiting,holding),'second command waits for the transaction that won');
  return next is(extensions.dblink_exec(holding,'commit'),'COMMIT','first transaction commits');
  return next ok(pg_temp.answered(waiting),'waiting command returns');
  return next is((select count(*) from extensions.dblink_get_result(waiting,false) x(answer text)),0::bigint,'waiting command writes nothing');
  return next ok(position(refusal in extensions.dblink_error_message(waiting))>0,'waiting command reports '||refusal);
  perform * from extensions.dblink_get_result(waiting,false) x(answer text);
end;
$$;
select is(extensions.dblink_exec('race_a','begin'), 'BEGIN','redistributing the previously sent item');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','through the server');
select is((select x.receipt::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.redistribution_sql('by_level',950)) x(receipt text)),
  'false','redistribution completes while its transaction stays open');
select is(extensions.dblink_send_query('race_b',pg_temp.send_sql(951,'redistribution-other-plan')),1,'a later plan send into the same item starts');
select * from pg_temp.loser('race_b','race_a','TAKEOFF_ITEM_SEND_PREVIEW_STALE');
select results_eq($$select i.quantity,t.breakdown from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (3::numeric,'by_level'::text)$$,'one live destination and the original three');

select is(extensions.dblink_exec('race_a','begin'),'BEGIN','two fresh intentions see the same state');
select is(extensions.dblink_exec('race_a',pg_temp.as_server_sql()),'SET','first through the server');
select is((select x.receipt::jsonb->>'replayed' from extensions.dblink('race_a',pg_temp.redistribution_sql('together',952)) x(receipt text)),
  'false','first confirmation has moved the three to one line');
select is(extensions.dblink_send_query('race_b',pg_temp.redistribution_sql('by_building',953)),1,'second confirmation starts');
select * from pg_temp.loser('race_b','race_a','REDISTRIBUTION_STALE');
select results_eq($$select i.quantity,t.breakdown from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (3::numeric,'together'::text)$$,'only the first confirmation took effect');

select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','a member prices the line');
select is((select x.locked from extensions.dblink('race_setup',format(
  'select pg_advisory_xact_lock(hashtextextended(%L,0))::text',pg_temp.f(970)::text))x(locked text)),'','editor holds the version key');
select is(extensions.dblink_exec('race_setup',format($edit$
  set local miaouffrage.estimate_v3_writer=%1$L;
  update public.estimate_items set unit_price_ht_cents=4200 where id in
    (select estimate_item_id from public.takeoff_item_send_targets where version_id=%1$L and item_id=%2$L)
$edit$,pg_temp.f(970),pg_temp.f(300))),'UPDATE 1','member enters a price on the live line');
select is(extensions.dblink_send_query('race_b',pg_temp.redistribution_sql('by_level',954)),1,'confirmation starts on its earlier preview');
select * from pg_temp.loser('race_b','race_setup','REDISTRIBUTION_STALE');
select results_eq($$select i.quantity,i.unit_price_ht_cents from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
  where t.version_id=pg_temp.f(970) and t.item_id=pg_temp.f(300)$$,$$values (3::numeric,4200)$$,'the edit and all three units remain on the line');
