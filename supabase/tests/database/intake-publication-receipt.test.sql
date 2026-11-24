-- A worker published A but lost its lease before closing. The closure must decide
-- whether A still describes the dossier, even when recovery cannot publish B.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae580000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)
  select pg_temp.f(n),'receipt-'||n||'@example.test','{}',now() from generate_series(1,2) n;
update public.tenant_memberships set is_default=false where user_id in (pg_temp.f(1),pg_temp.f(2));
insert into public.tenants(id,name,slug) values(pg_temp.f(10),'Fixture','receipt-recovery');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values
  (pg_temp.f(10),pg_temp.f(1),'engineer',true),(pg_temp.f(10),pg_temp.f(2),'admin',true);
insert into private.takeoff_launch_activation(active_from) values (now()-interval '1 minute');
insert into private.takeoff_completion_activation(active_from) values (now()-interval '1 minute');
update public.feature_flags set enabled=true where tenant_id=pg_temp.f(10) and flag_key='TAKEOFF_MODULE_ENABLED';

-- 20 loses its payer, 21 exhausts its claims, 22 finishes normally.
-- 23 and 24 recover with unchanged inputs, then finish or lose the payer.
insert into public.estimate_projects(id,tenant_id,user_id,name)
  select pg_temp.f(n),pg_temp.f(10),pg_temp.f(1),'Affaire fictive' from generate_series(20,24) n;
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  select pg_temp.f(n+10),pg_temp.f(n),pg_temp.f(1),'deposited' from generate_series(20,24) n;
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(n+20),pg_temp.f(n+10),'Notice.pdf','uploaded','awaiting_launch' from generate_series(20,24) n;
select set_config('request.jwt.claim.sub',pg_temp.f(2)::text,true);
set local role authenticated;
create temp table launches as select n,r.launch_id from generate_series(20,24) n
  cross join lateral public.start_affaire_intake_analysis(pg_temp.f(n),false) r;
reset role;
create function pg_temp.publish(n integer,batch uuid,token uuid) returns uuid language sql as $$
  select public.publish_affaire_intake_brief(batch,token,null,s->>'revision',(s->>'brief_updated_at')::timestamptz,
    jsonb_build_object('summary',case when s->'missing_piece_codes' ? 'missing_plans' then 'Plans manquants' else 'Plan reçu' end,
      'project_object','Fixture'),jsonb_build_array(jsonb_build_object(
        'blockKey','summary','entryIndex',0,'sourceDocumentId',pg_temp.f(n+20),'sourceFileName','Notice.pdf')))
  from public.read_affaire_intake_brief_inputs(pg_temp.f(n)) s
$$;
create function pg_temp.confirm(n integer) returns text language sql as $$
  select outcome from public.confirm_affaire_brief_takeoff(pg_temp.f(10),pg_temp.f(n),pg_temp.f(1),
    (select updated_at from public.affaire_briefs where project_id=pg_temp.f(n)),null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',
    p_actor_claims=>jsonb_build_object('sub',pg_temp.f(1),'role','authenticated'))
$$;
select count(*) from launches l cross join lateral public.claim_affaire_intake_analysis_launch(pg_temp.f(60),l.launch_id);
update public.affaire_intake_documents set classification_status='classified',document_kind='cctp',analysis_completed_at=now()
  where analysis_launch_id in (select launch_id from launches);
select pg_temp.publish(n,launch_id,pg_temp.f(60)) from launches;
select is((select count(*) from public.affaire_briefs where tenant_id=pg_temp.f(10) and summary='Plans manquants'),5::bigint,
  'each launch has really published A before its closure');

update public.affaire_intake_uploads set processing_lease_expires_at=now()-interval '1 second'
  where id in (select launch_id from launches where n<>22);
insert into public.plan_sets(id,tenant_id,project_id,name)
  select pg_temp.f(n+50),pg_temp.f(10),pg_temp.f(n),'Plans' from generate_series(20,22) n;
insert into public.plan_files(id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes)
  select pg_temp.f(n+60),pg_temp.f(10),pg_temp.f(n+50),concat_ws('/',pg_temp.f(10),pg_temp.f(n+50),pg_temp.f(n+60),'plan.pdf'),
    'plan.pdf','application/pdf',8 from generate_series(20,22) n;
insert into storage.objects(bucket_id,name,metadata)
  select 'plan-files',file_path,'{"size":8}' from public.plan_files where tenant_id=pg_temp.f(10);
grant select on launches to service_role;
set local role service_role;
select results_eq($$select n,c.upload_id=l.launch_id,c.attempt_count from launches l
  cross join lateral public.claim_affaire_intake_analysis_launch(pg_temp.f(61),l.launch_id) c where n<>22 order by n$$,
  $$values (20,true,2),(21,true,2),(23,true,2),(24,true,2)$$,'recovery claims the same four launches');
select throws_ok($$select public.finish_affaire_intake_upload_attempt(launch_id,pg_temp.f(60),'ready',now()) from launches where n=22$$,
  '40001','INTAKE_BRIEF_INPUT_CHANGED','normal completion cannot accept A after a plan arrives');
select pg_temp.publish(n,launch_id,pg_temp.f(60)) from launches where n=22
  and exists(select 1 from public.affaire_intake_uploads where id=launch_id and status='launch_processing');
select ok(public.finish_affaire_intake_upload_attempt(launch_id,pg_temp.f(60),'ready',now()),
  'the same worker can publish B and finish its normal attempt') from launches where n=22;

update public.affaire_intake_uploads set processing_lease_expires_at=now()-interval '1 second' where id=(select launch_id from launches where n=21);
select is((select attempt_count from public.claim_affaire_intake_analysis_launch(pg_temp.f(62),(select launch_id from launches where n=21))),3,'third claim runs');
update public.affaire_intake_uploads set processing_lease_expires_at=now()-interval '1 second' where id=(select launch_id from launches where n=21);
select is((select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(63),(select launch_id from launches where n=21))),
  0::bigint,'the next claim closes the exhausted launch');
reset role;
update public.tenant_memberships set role='director' where tenant_id=pg_temp.f(10) and user_id=pg_temp.f(2);
set local role service_role;
select is(public.stop_affaire_intake_analysis(launch_id,pg_temp.f(61)),'payer_access_lost','revoked payer stops after publication') from launches where n in (20,24);
select ok(public.finish_affaire_intake_upload_attempt(launch_id,pg_temp.f(61),'partial_failure',now()),
  'unchanged inputs reuse A after recovery without republishing') from launches where n=23;
select throws_ok('select pg_temp.confirm(20)','P0001','INTAKE_ANALYSIS_REQUIRED','revocation cannot make the obsolete A confirmable');
select throws_ok('select pg_temp.confirm(21)','P0001','INTAKE_ANALYSIS_REQUIRED','exhaustion cannot make the obsolete A confirmable');
select is((select count(*) from public.takeoff_launch_requests where tenant_id=pg_temp.f(10)),0::bigint,'neither stale brief reserves a takeoff');
reset role;
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
set local role authenticated;
create temp table next_press as select n,r.* from generate_series(20,24) n cross join lateral public.start_affaire_intake_analysis(pg_temp.f(n),false) r;
reset role;
select results_eq($$select n,outcome,piece_count from next_press order by n$$,
  $$values (20,'brief_only'::text,0),(21,'brief_only',0),(22,'nothing_waiting',0),(23,'nothing_waiting',0),(24,'nothing_waiting',0)$$,
  'only the stopped stale generations need a brief; the current receipts owe no repeat work');
select count(*) from next_press l cross join lateral public.claim_affaire_intake_analysis_launch(pg_temp.f(64),l.launch_id)
  where l.outcome='brief_only';
select pg_temp.publish(n,launch_id,pg_temp.f(64)) from next_press where outcome='brief_only';
select bool_and(public.finish_affaire_intake_upload_attempt(launch_id,pg_temp.f(64),'ready',now())) from next_press where outcome='brief_only';
select results_eq($$select b.summary,l.source_document_id from public.affaire_briefs b join public.affaire_brief_source_links l on l.brief_id=b.id
  where b.tenant_id=pg_temp.f(10) order by b.project_id$$,
  $$values ('Plan reçu'::text,pg_temp.f(40)),('Plan reçu',pg_temp.f(41)),('Plan reçu',pg_temp.f(42)),
    ('Plans manquants',pg_temp.f(43)),('Plans manquants',pg_temp.f(44))$$,'the final briefs and their sources describe the inputs at closure');
select results_eq($$select pg_temp.confirm(n) from generate_series(20,24) n$$,
  $$values ('confirmed'::text),('confirmed'),('confirmed'),('confirmed'),('confirmed')$$,'only current publications can be confirmed');
select is((select count(*) from public.takeoff_launch_requests where tenant_id=pg_temp.f(10)),5::bigint,'each current confirmation reserves one takeoff');
select * from finish();
rollback;
