-- A second real plan of the same affaire feeds the same line in an ordinary
-- send. The earlier revision preview must include the two newly committed units
-- when the member refreshes after the stale response.
insert into revision_races(tag,version_id) select 'other_send',x.id from revision_mark_request m cross join lateral
  extensions.dblink('race_a',format('select public.duplicate_estimate_version(%L,false)',m.draft)) x(id uuid);
update revision_races x set (receipt_id,answer_id)=(select p.receipt_id,p.answer_id from public.takeoff_item_send_parts p
  where p.version_id=x.version_id and p.job_id=pg_temp.job(21) and p.state='live') where tag='other_send';
select is(extensions.dblink_exec('race_setup',format('insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count)
  values(%L,%L,%L,''plan-b.pdf'',%L,''application/pdf'',8,9)',pg_temp.f(9520),pg_temp.tenant(),pg_temp.f(41),
  concat_ws('/',pg_temp.tenant(),pg_temp.f(41),pg_temp.f(9520),'plan-b.pdf'))),'INSERT 0 1','another file for the independent send');
create temp table second_plan_request as
with snapshot as (select pg_temp.snapshot(21,array[2,7],2) as doc), inputs as (
  select jsonb_set(doc,'{preparation,sources}',(select jsonb_agg(s||jsonb_build_object('active',s->>'document_id'=pg_temp.f(9520)::text))
    from jsonb_array_elements(doc#>'{preparation,sources}') s)) as snapshot from snapshot)
select snapshot,
  replace(replace(replace(r.manifest::text,pg_temp.digest(pg_temp.plan_file(21)),pg_temp.digest(pg_temp.f(9520))),
    pg_temp.plan_file(21)::text,pg_temp.f(9520)::text),'plan-1.pdf','plan-b.pdf')::jsonb as manifest from inputs
  join public.takeoff_jobs j on j.id=pg_temp.job(21) join public.takeoff_launch_requests r on r.id=j.launch_request_id;
select is(extensions.dblink_exec('race_setup',format('update public.takeoff_preparations set revision=2,draft=%L,confirmed_snapshot=%L,
  confirmed_at=%L where project_id=%L',snapshot->'preparation',snapshot,snapshot->>'confirmed_at',pg_temp.f(21))),'UPDATE 1','confirm the second plan')
from second_plan_request;
select is((select x.outcome from second_plan_request p cross join lateral extensions.dblink('race_setup',format(
  'select outcome from public.launch_manual_takeoff_plan_request(%L,%L,%L,%L,''initial'',null,%L,%L,%L,%L,%L,%L,2,%L::uuid[])',
  pg_temp.tenant(),pg_temp.f(21),pg_temp.f(1),pg_temp.f(9521),pg_temp.host(),pg_temp.selection(),p.manifest,p.snapshot,
  jsonb_build_array(jsonb_build_object('id',pg_temp.f(9522),'plan_set_id',pg_temp.f(41),'launch_unit_key','plan:'||pg_temp.f(9520),
    'source_file_name','plan-b.pdf','source_file_type','application/pdf','source_file_size_bytes',8,'prompt_version','fixture','execution_host_id',pg_temp.host())),
  pg_temp.f(41),array[pg_temp.f(9520)])) x(outcome text)),'admitted','the second plan is admitted');
select is((select x.job from extensions.dblink('race_setup',format('select job_id from public.dispatch_next_takeoff_host_job(%L)',pg_temp.host())) x(job uuid)),
  pg_temp.f(9522),'dispatch the independent reading');
select is((select x.n from extensions.dblink('race_setup',replace(pg_temp.claim_sql(21,9523),pg_temp.job(21)::text,pg_temp.f(9522)::text)) x(n bigint)),
  1::bigint,'claim it');
select is((select split_part(x.result,':',2) from extensions.dblink('race_setup',replace(replace(replace(pg_temp.publish_sql(21,9523),
  pg_temp.job(21)::text,pg_temp.f(9522)::text),pg_temp.f(821)::text,pg_temp.f(9524)::text),'plan-1.pdf','plan-b.pdf')) x(result text)),
  'false','publish its two units');
select is(extensions.dblink_exec('race_setup',format('update public.takeoff_items set rules_stale=false,rules_evaluated_at=now(),rule_results=''[]''
  where job_id=%L',pg_temp.f(9522))),'UPDATE 1','evaluate the independent measurement rules');
create temp table second_choice as select jsonb_build_object('command_version',1,'intent_key',pg_temp.f(9525),'gesture','accept_measured',
  'scope',jsonb_build_object('kind','plan','plan_logical_id',pg_temp.f(9520)),
  'targets',jsonb_build_array(jsonb_build_object('item_id',a.item_id,'entry_revision',0,'answers',jsonb_build_array(
    jsonb_build_object('answer_id',a.id,'decision_revision',0,'entry_revision',0,'marks_revision',0)))),
  'apply',jsonb_build_array(a.item_id),'skipped','[]'::jsonb) as cmd from public.takeoff_item_answers a
  where a.job_id=pg_temp.f(9522) and a.item_id=pg_temp.f(310);
select is((select x.result->>'outcome' from second_choice c cross join lateral extensions.dblink('race_a',pg_temp.review_sql(21,c.cmd))
  x(result jsonb)),'applied','retain the measured two on its own plan');
select is(extensions.dblink_exec('race_setup',format('insert into public.draft_locks(version_id,user_id,tenant_id,expires_at,session_id)
   values(%L,%L,%L,clock_timestamp()+interval ''15 minutes'',gen_random_uuid())',x.version_id,pg_temp.f(1),pg_temp.tenant())),
  'INSERT 0 1','the member holds that draft') from revision_races x where tag='other_send';
select is((select (r.doc->>'quantity')::numeric from revision_races x join public.takeoff_item_answers a on a.id=x.answer_id
  cross join lateral extensions.dblink('race_a',format('select public.review_takeoff_revision_item(%L,%L,%L,%L,%L,%L,%L,''{"source":"measured"}'')',
  pg_temp.tenant(),pg_temp.f(21),x.version_id,x.receipt_id,x.answer_id,pg_temp.f(9526),jsonb_build_object('work_revision',0,
  'marks_revision',private.takeoff_count_marks_revision(x.answer_id),'plan_entry_revision',null,'answer_revision',a.content_sha256))) r(doc jsonb)
  where x.tag='other_send'),2::numeric,'the existing reading has a pending revision to two');
update revision_races x set digest=public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),
  x.version_id,x.receipt_id,true,'{}')->>'digest' where tag='other_send';
create function pg_temp.second_send(v uuid) returns jsonb language plpgsql as $$
declare plan_ jsonb; c jsonb; line_ public.estimate_items; job_ uuid:=pg_temp.f(9522); facts jsonb;
begin
  plan_:=pg_temp.plan(21,v,310,3)||jsonb_build_object('job_id',job_,'plan_key',pg_temp.f(9520),'sections','[]'::jsonb);
  select i.* into strict line_ from public.takeoff_item_send_targets t join public.estimate_items i on i.id=t.estimate_item_id
    where t.version_id=v and t.item_id=pg_temp.f(310);
  facts:=public.read_takeoff_item_send_facts(pg_temp.tenant(),pg_temp.f(21),job_);
  select jsonb_build_object('answer_id',s->'answer_id','answer_revision',s->'answer_revision','kind','measured','quantity',s->'quantity','unit',s->'unit',
    'observation_ids',jsonb_build_array(s->'observation_id'),'pages',s->'pages','identity',jsonb_build_object('unit','u','basis',null,
    'network',null,'material',null,'diameter',null)) into strict c from private.takeoff_item_send_resolved_parts(pg_temp.tenant(),pg_temp.f(21),job_,array[2,7]) s;
  plan_:=jsonb_set(plan_,'{targets,0,line}',jsonb_build_object('kind','earlier_line','estimate_item_id',line_.id,
    'expected_updated_at',line_.updated_at,'expected_quantity',line_.quantity));
  plan_:=jsonb_set(plan_,'{targets,0,contributions}',jsonb_build_array(c));
  plan_:=jsonb_set(plan_,'{page_contributions,0,observation_ids}',c->'observation_ids');
  plan_:=jsonb_set(plan_,'{dependencies,pages_in_estimate}','[]');
  plan_:=jsonb_set(plan_,'{dependencies,lines}',jsonb_build_array(jsonb_build_object('estimate_item_id',line_.id,'updated_at',line_.updated_at,'quantity',line_.quantity,'dpgf',null)));
  plan_:=jsonb_set(plan_,'{dependencies,answers}',(select jsonb_agg(jsonb_build_object('item_id',a->'item_id','answer_id',a->'answer_id',
    'revision',a->'revision','decision_revision',a#>'{decision,revision}','entry_revision',a#>'{entry,revision}') order by a->>'item_id') from jsonb_array_elements(facts->'answers') a));
  plan_:=jsonb_set(plan_,'{dependencies,stamps,job}',to_jsonb(public.takeoff_rule_job_stamp(pg_temp.tenant(),pg_temp.f(21),job_)));
  plan_:=jsonb_set(plan_,'{dependencies,stamps,context}',(select jsonb_build_object('peers',s->>'peers','locations',s->>'locations')
    from private.takeoff_send_context_stamps(private.takeoff_send_context(pg_temp.tenant(),pg_temp.f(21),job_,v)) s));
  return plan_;
end;
$$;
insert into plans select 'revision-other-send',pg_temp.second_send(version_id),null from revision_races where tag='other_send';
select is(extensions.dblink_exec('race_setup','begin'),'BEGIN','the ordinary send into the line starts first');
select is((select x.doc->>'parts_written' from extensions.dblink('race_setup',pg_temp.send_sql(9527,'revision-other-send')) x(doc jsonb)),
  '1','the ordinary send of the other plan writes its part');
select is(extensions.dblink_send_query('race_b',pg_temp.race_confirm_revision('other_send',9528)),1,'confirm the previous correction concurrently');
select ok(pg_temp.waits_for('race_b','race_setup'),'the correction waits for the ordinary send');
select is(extensions.dblink_exec('race_setup','commit'),'COMMIT','commit the other plan');
select ok(pg_temp.answered('race_b'),'the waiting correction receives its answer');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'stale correction wrote nothing');
select ok(extensions.dblink_error_message('race_b') like '%TAKEOFF_REVISION_STALE%','the shared line changed under the previous preview');
select is((select count(*)::integer from extensions.dblink_get_result('race_b',false) x(doc jsonb)),0,'result drained');
select is((select public.preview_takeoff_contribution_revision(pg_temp.tenant(),pg_temp.f(1),pg_temp.f(21),x.version_id,
  x.receipt_id,true,'{}')#>'{actions,0,quantity_after}' from revision_races x where tag='other_send'),'4'::jsonb,
  'a refreshed revision keeps the two committed units from the other plan');
