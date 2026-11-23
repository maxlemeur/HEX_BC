-- Each tab holds an independent database connection. Keep the source for the
-- final proof race, so that the real working edit does not alter earlier cases.
create temp table revision_races(tag text primary key,version_id uuid,receipt_id uuid,answer_id uuid,digest text);
insert into revision_races(tag,version_id)
select tag,(select v.id from extensions.dblink('race_a',format('/* %s */ select public.duplicate_estimate_version(%L,false)',tag,m.draft)) v(id uuid))
from revision_mark_request m cross join (values('tabs'),('redistribution'),('machine')) cases(tag);
insert into revision_races(tag,version_id) select 'marks',draft from revision_mark_request;
update revision_races x set (receipt_id,answer_id)=(select p.receipt_id,p.answer_id from public.takeoff_item_send_parts p
  where p.version_id=x.version_id and p.job_id=pg_temp.job(21) and p.state='live');
create function pg_temp.race_confirm_revision(tag_ text,intent_ integer) returns text language sql stable as $$
  select format('select public.confirm_takeoff_contribution_revision(%L,%L,%L,%L,%L,true,%L,%L,''{}'')',
    pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),x.version_id,x.receipt_id,pg_temp.f(intent_),x.digest)
  from revision_races x where x.tag=tag_
$$;
select is(extensions.dblink_exec('race_setup',format('insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
   values(%L,%L,%L,clock_timestamp()+interval ''15 minutes'',gen_random_uuid())',v.version_id,pg_temp.f(1),pg_temp.tenant())),
  'INSERT 0 1',v.tag||': own editor lease') from revision_races v;
select is((select (x.doc->>'quantity')::numeric from extensions.dblink('race_a',format(
    'select public.review_takeoff_revision_item(%L,%L,%L,%L,%L,%L,%L,''{"source":"measured"}'')',
    pg_temp.tenant(),pg_temp.f(21),v.version_id,v.receipt_id,v.answer_id,gen_random_uuid(),
    jsonb_build_object('work_revision',0,'marks_revision',private.takeoff_count_marks_revision(v.answer_id),'plan_entry_revision',null,
      'answer_revision',a.content_sha256))) x(doc jsonb)),2::numeric,v.tag||': stage two measured units')
  from revision_races v join public.takeoff_item_answers a on a.id=v.answer_id;
update revision_races v set digest=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
  v.version_id,v.receipt_id,true,'{}')->>'digest';

-- Two tabs use distinct intentions and the same preview of the same receipt.
select is(extensions.dblink_exec('race_b','begin'),'BEGIN','first revision tab begins');
select is((select x.doc->>'replayed' from extensions.dblink('race_b',pg_temp.race_confirm_revision('tabs',9440)) x(doc jsonb)),
  'false','the first correction has written but not committed');
select is(extensions.dblink_send_query('race_setup',pg_temp.race_confirm_revision('tabs',9441)),1,'another intent confirms the same preview');
select ok(pg_temp.waits_for('race_setup','race_b'),'the other intent waits for the first tab');
select is(extensions.dblink_exec('race_b','commit'),'COMMIT','the first revision commits');
select ok(pg_temp.answered('race_setup'),'the second intent receives an answer');
select is((select count(*)::int from extensions.dblink_get_result('race_setup',false) x(doc jsonb)),0,'another intent cannot amend the old head');
select ok(extensions.dblink_error_message('race_setup') like '%TAKEOFF_REVISION_STALE%','the second tab gets stale');
select is((select count(*)::int from extensions.dblink_get_result('race_setup',false) x(doc jsonb)),0,'second result drained');
select is((select count(*)::int from public.takeoff_item_send_receipts r join revision_races x on r.amends_receipt_id=x.receipt_id
  where x.tag='tabs'),1,'only one amended receipt was committed');

-- A redistribution holds the version while confirmation waits, then the
-- digest is compared with the new physical line that actually owns the part.
create temp table revision_redistribution as
  select x.*,loc.doc as locations,public.preview_takeoff_item_redistribution(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
    x.version_id,pg_temp.f(310),'by_level',true,loc.doc) as plan from revision_races x
  cross join lateral pg_temp.location_input(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),x.version_id,pg_temp.f(310),'by_level',true) loc(doc)
  where tag='redistribution';
select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','the redistribution starts first');
select ok((select r.doc ? 'receipt_id' from revision_redistribution v cross join lateral extensions.dblink('race_setup',
  format('select public.redistribute_takeoff_item(%L,%L,%L,%L,%L,''by_level'',true,%L,%L,%L)',pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
    v.version_id,pg_temp.f(310),pg_temp.f(9442),v.plan->>'digest',v.locations)) r(doc jsonb)), 'the redistribution has moved the live part');
select is(extensions.dblink_send_query('race_b',pg_temp.race_confirm_revision('redistribution',9443)),1,'the member confirms the earlier revision preview');
select ok(pg_temp.waits_for('race_b','race_setup'),'the revision waits for redistribution');
select is(extensions.dblink_exec('race_setup','commit'),'COMMIT','the redistributed target becomes current');
select ok(pg_temp.answered('race_b'),'the revision has re-read its target');
select is((select count(*)::int from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'the earlier preview cannot change the moved line');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_REVISION_STALE%','the moved target makes the preview stale');
select is((select count(*)::int from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'result drained after the move');

\ir takeoff-revision-other-plan-race.sql

-- The machine publishes a proposal for B after A's working correction.
-- It is a genuine publication with its worker's lease, never a retained unit.
update revision_races x set digest=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
  x.version_id,x.receipt_id,true,'{}')->>'digest' where tag in ('marks','machine');
select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','a late proposal for the untouched item enters its transaction');
select is((select x.doc->>'replayed' from extensions.dblink('race_setup',format(
  'select public.publish_takeoff_count_marks(%L,%L,1,%L,%L)',pg_temp.job(21),pg_temp.f(921),
  '[{"page":2,"geometry":{"version":1,"view_box":[0,0,100,100],"rotation":0,"user_unit":1,"width":100,"height":100}}]',
  jsonb_build_array(jsonb_build_object('page',2,'x',0.75,'y',0.5,'proposals',jsonb_build_array(jsonb_build_object(
    'item_id',pg_temp.f(311),'state','proposed','method','symbol_count','method_version','fixture-1','source_key','candidate-b')))))) x(doc jsonb)),
  'false','the worker publishes a proposal while the earlier member proof remains intact');
select is(extensions.dblink_send_query('race_b',pg_temp.race_confirm_revision('machine',9445)),1,'confirm concurrently with publication');
select ok(pg_temp.waits_for('race_b','race_setup'),'the writer waits for the published proof');
select is(extensions.dblink_exec('race_setup','commit'),'COMMIT','the proposal commits');
select ok(pg_temp.answered('race_b'),'the writer has re-read marks after the publication');
select is((select x.doc->>'replayed' from extensions.dblink_get_result('race_b',false) x(doc jsonb)),'false',
  'a machine-only proposal for B leaves A’s unchanged working preview confirmable');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'publication result drained');
select is((select count(*)::integer from public.takeoff_item_send_parts p join revision_races x on p.version_id=x.version_id
  where x.tag='machine' and p.item_id=pg_temp.f(311)),0,'the proposal for B produced no contribution');
select is(extensions.dblink_exec('race_a','begin'),'BEGIN','correct the marks after the last preview');
select is((select x.doc->>'replayed' from extensions.dblink('race_a',pg_temp.working_marks_call('correct')) x(doc jsonb)),
  'false','the changed proof remains uncommitted');
select is(extensions.dblink_send_query('race_b',pg_temp.race_confirm_revision('marks',9444)),1,'confirm the previous proof meanwhile');
select ok(pg_temp.waits_for('race_b','race_a'),'confirmation waits for the working edit');
select is(extensions.dblink_exec('race_a','commit'),'COMMIT','the new proof now governs the working choice');
select ok(pg_temp.answered('race_b'),'the writer answers after the proof changes');
select is((select count(*)::int from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'the older proof produces no receipt');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_REVISION_STALE%','the marks race returns stale');
select is((select count(*)::int from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'last result drained');
select is((select count(*)::int from public.takeoff_item_send_receipts r join revision_races x on x.receipt_id=r.amends_receipt_id
  where x.tag in ('redistribution','marks')),0,'neither stale preview wrote any correction');
