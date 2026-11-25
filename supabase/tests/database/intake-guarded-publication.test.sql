begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae540000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_user_meta_data,email_confirmed_at)
select pg_temp.f(n),'guarded-intake-'||n||'@example.test','{}',now() from generate_series(1,2) n;
update public.tenant_memberships set is_default=false where user_id in (pg_temp.f(1),pg_temp.f(2));
insert into public.tenants(id,name,slug) values(pg_temp.f(10),'Fiction','guarded-intake');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values
  (pg_temp.f(10),pg_temp.f(1),'engineer',true),(pg_temp.f(10),pg_temp.f(2),'admin',true);
insert into public.estimate_projects(id,tenant_id,user_id,name) values(pg_temp.f(20),pg_temp.f(10),pg_temp.f(1),'Fixture');
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  values(pg_temp.f(30),pg_temp.f(20),pg_temp.f(1),'deposited'),(pg_temp.f(31),pg_temp.f(20),pg_temp.f(1),'processing');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status,document_kind,classification_source)
  values(pg_temp.f(40),pg_temp.f(30),'A.pdf','uploaded','classified','plans','manual');
select set_config('request.jwt.claim.sub',pg_temp.f(2)::text,true);
set local role authenticated;
create temporary table launched as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true);
select is((select outcome from launched),'brief_only','a member can press with only hand-classified pieces and no brief');
select is((select piece_count from launched),0,'a brief-only press reserves no reading');
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(20),true)),'already_running','two brief-only presses share one launch');
reset role;
select is((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(40)),null::uuid,'the manual plan is never assigned for reading');
select is((select payer_id from public.claim_affaire_intake_analysis_launch(pg_temp.f(60),(select launch_id from launched))),pg_temp.f(2),'brief-only recovery keeps the presser');
create function pg_temp.inputs() returns text language sql as $$
  select public.read_affaire_intake_brief_inputs(pg_temp.f(20))->>'revision'
$$;
create function pg_temp.publish(batch uuid, token uuid, revision text, stamp timestamptz, label text, source_id uuid)
returns uuid language sql as $$
  select public.publish_affaire_intake_brief(batch,token,null,revision,stamp,
    jsonb_build_object('summary',label,'project_object','Fixture','last_generated_at',now()),
    case when source_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'blockKey','summary','entryIndex',0,'sourceDocumentId',source_id,'sourceFileName','A.pdf')) end)
$$;
create temporary table saved as select pg_temp.inputs() revision,(select launch_id from launched) batch;
select isnt(pg_temp.publish(batch,pg_temp.f(60),revision,null,'Premier',pg_temp.f(40)),null::uuid,'the draft and its source publish together') from saved;
select is((select count(*) from public.affaire_brief_source_links where project_id=pg_temp.f(20)),1::bigint,'one source committed');
alter table saved add column stamp timestamptz;
update saved set stamp=(select updated_at from public.affaire_briefs where project_id=pg_temp.f(20));
-- The model already holds this snapshot. Change only project or plan inputs.
update public.estimate_projects set client_name='Nouveau client' where id=pg_temp.f(20);
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),revision,stamp,'Ancien client',pg_temp.f(40)) from saved$$,
  '40001','INTAKE_BRIEF_INPUT_CHANGED','renaming only the client invalidates the model response');
update public.estimate_projects set client_name=null where id=pg_temp.f(20);
insert into public.plan_sets(id,tenant_id,project_id,name) values(pg_temp.f(70),pg_temp.f(10),pg_temp.f(20),'Plans');
insert into public.plan_files(id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes)
  values(pg_temp.f(71),pg_temp.f(10),pg_temp.f(70),pg_temp.f(10)::text||'/'||pg_temp.f(70)::text||'/'||pg_temp.f(71)::text||'/plan.pdf','plan.pdf','application/pdf',8);
insert into storage.objects(bucket_id,name,metadata) values('plan-files',pg_temp.f(10)::text||'/'||pg_temp.f(70)::text||'/'||pg_temp.f(71)::text||'/plan.pdf','{"size":8}');
select ok(public.affaire_has_stored_plan(pg_temp.f(20)),'the standalone file changes the missing-plan observation');
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),revision,stamp,'Plans manquants',pg_temp.f(40)) from saved$$,
  '40001','INTAKE_BRIEF_INPUT_CHANGED','adding only a stored standalone plan invalidates the model response');
update public.affaire_intake_documents set document_kind='cctp' where id=pg_temp.f(40);
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),revision,stamp,'Périmé',pg_temp.f(40)) from saved$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','a category correction during generation invalidates the result');
update saved set revision=pg_temp.inputs();
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),revision,stamp,'Périmé',pg_temp.f(99)) from saved$$,'23514','INTAKE_BRIEF_SOURCE_INVALID','a foreign or missing source rolls back the whole publication');
select throws_ok($$select public.publish_affaire_intake_brief(batch,pg_temp.f(60),null,revision,stamp,
  '{"summary":"Non publié","project_object":"Fixture"}',
  jsonb_build_array(jsonb_build_object('blockKey','inconnu','entryIndex',0,'sourceDocumentId',pg_temp.f(40),'sourceFileName','A.pdf')))
  from saved$$,'23514',null,'a failing source insert rolls back the preceding draft update and link replacement');
select results_eq($$select b.summary,l.source_document_id from public.affaire_briefs b join public.affaire_brief_source_links l on l.brief_id=b.id where b.project_id=pg_temp.f(20)$$,$$values ('Premier'::text,pg_temp.f(40))$$,'a failed publication preserves both previous values');
update public.affaire_intake_documents set deletion_token=pg_temp.f(61) where id=pg_temp.f(40);
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),revision,stamp,'Supprimé',pg_temp.f(40)) from saved$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','a deletion during generation cannot put the document back');
update public.affaire_intake_documents set deletion_token=null where id=pg_temp.f(40);
update public.affaire_intake_uploads set processing_lease_token=pg_temp.f(62),processing_lease_expires_at=now()+interval '10 minutes' where id=pg_temp.f(31);
select throws_ok($$select pg_temp.publish(pg_temp.f(31),pg_temp.f(62),pg_temp.inputs(),null,'Historique',pg_temp.f(40))$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','the historical worker loses its compare-and-set against a concurrently published launch brief');
select pg_temp.publish(batch,pg_temp.f(60),pg_temp.inputs(),stamp,'Inventaire corrigé',pg_temp.f(40)) from saved;
select ok(public.finish_affaire_intake_upload_attempt((select batch from saved),pg_temp.f(60),'ready',now()),'close the initial brief-only launch');
set local role authenticated;
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(20),true)),'nothing_waiting','a repeated press does not regenerate the existing brief');
reset role;

insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(41),pg_temp.f(30),'B.png','uploaded','awaiting_launch'),(pg_temp.f(42),pg_temp.f(30),'C.png','uploaded','awaiting_launch'),
    (pg_temp.f(43),pg_temp.f(30),'D.png','uploaded','awaiting_launch');
set local role authenticated;
create temporary table pay as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true);
reset role;
select is(public.stop_affaire_intake_analysis((select launch_id from pay),null),null::text,'a Mac without credentials cannot close a fresh launch on another Mac');
select is((select payer_id from public.claim_affaire_intake_analysis_launch(pg_temp.f(63),(select launch_id from pay))),pg_temp.f(2),'the authorised host can claim it');
set local role authenticated;
select throws_ok($$update public.affaire_intake_documents set analysis_completed_at=now() where id=pg_temp.f(41)$$,'42501','INTAKE_LAUNCH_PROTECTED','a member cannot forge a completed reading');
reset role;
update public.affaire_intake_documents set classification_status='classified',analysis_completed_at=now() where id=pg_temp.f(41);
-- The third piece was classified; its reading had not finished when a member began removing it.
update public.affaire_intake_documents set classification_status='classified' where id=pg_temp.f(43);
set local role authenticated;
update public.affaire_intake_documents set deletion_token=pg_temp.f(65) where id=pg_temp.f(43);
reset role;
select is((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(43)),null::uuid,
  'a deletion reservation leaves no unfinished reading attached to the former launch');
select ok(public.intake_payer_can_write(pg_temp.f(2),pg_temp.f(10),pg_temp.f(20)),'the server accepts the current nonowner admin');
update public.tenant_memberships set role='director' where user_id=pg_temp.f(2) and tenant_id=pg_temp.f(10);
select ok(not public.intake_payer_can_write(pg_temp.f(2),pg_temp.f(10),pg_temp.f(20)),'the server requires current write access to the specific affaire');
select is(public.stop_affaire_intake_analysis((select launch_id from pay),pg_temp.f(64)),null::text,'a stale lease cannot release another worker’s documents');
select is(public.stop_affaire_intake_analysis((select launch_id from pay),pg_temp.f(63)),'payer_access_lost','the current lease can interrupt the revoked payer');
select results_eq($$select classification_status,analysis_launch_id is null from public.affaire_intake_documents where id in (pg_temp.f(41),pg_temp.f(42)) order by id$$,$$values ('classified'::text,false),('awaiting_launch',true)$$,'finished work is retained and the remaining piece can be launched again');

set local role authenticated;
update public.affaire_intake_documents set deletion_token=null where id=pg_temp.f(43);
reset role;
select results_eq($$select classification_status,analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(43)$$,
  $$values ('awaiting_launch'::text,null::uuid)$$,'if the removal fails after interruption, the unread piece can be launched again');
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
set local role authenticated;
create temporary table stranded as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true);
reset role;
update public.affaire_intake_uploads set created_at=now()-interval '31 minutes' where id=(select launch_id from stranded);
select is(public.stop_affaire_intake_analysis((select launch_id from stranded),null),'connection_unavailable','a launch no Mac can take ends after the 30-minute recovery window');
select results_eq($$select classification_status,analysis_launch_id,cardinality(issues)>0 from public.affaire_intake_documents where id=pg_temp.f(42)$$,$$values ('awaiting_launch'::text,null::uuid,true)$$,'the unread piece shows a reason and is eligible for another press');
select ok(not has_function_privilege('authenticated','public.publish_affaire_intake_brief(uuid,uuid,uuid,text,timestamptz,jsonb,jsonb)','execute')
  and not has_function_privilege('anon','public.stop_affaire_intake_analysis(uuid,uuid)','execute'),'the worker mutations are private to the service role');

-- Each fixture has an older brief, one last completed reading, and no publication for the new deposit.
insert into public.estimate_projects(id,tenant_id,user_id,name)
  select pg_temp.f(n),pg_temp.f(10),pg_temp.f(1),'Dossier fictif' from generate_series(80,82) n;
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  select pg_temp.f(n+3),pg_temp.f(n),pg_temp.f(1),'deposited' from generate_series(80,82) n;
insert into public.affaire_briefs(project_id,upload_id,status,summary,project_object,missing_elements)
  select pg_temp.f(n),pg_temp.f(n+3),'a_confirmer','Ancien brief','Fixture','["Plans manquants"]' from generate_series(80,82) n;
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(n+6),pg_temp.f(n+3),'Depot.pdf','uploaded','awaiting_launch' from generate_series(80,81) n;
update public.tenant_memberships set role='admin' where user_id=pg_temp.f(2) and tenant_id=pg_temp.f(10);
select set_config('request.jwt.claim.sub',pg_temp.f(2)::text,true);
set local role authenticated;
create temp table stopped as select n, r.launch_id from generate_series(80,81) n
  cross join lateral public.start_affaire_intake_analysis(pg_temp.f(n),false) r;
reset role;
select count(*) from stopped s cross join lateral public.claim_affaire_intake_analysis_launch(pg_temp.f(90),s.launch_id);
update public.affaire_intake_documents set classification_status='classified',analysis_completed_at=clock_timestamp()
  where id in (pg_temp.f(86),pg_temp.f(87));
update public.tenant_memberships set role='director' where user_id=pg_temp.f(2) and tenant_id=pg_temp.f(10);
select is(public.stop_affaire_intake_analysis((select launch_id from stopped where n=80),pg_temp.f(90)),'payer_access_lost',
  'lose the payer after the last reading and before publication');
update public.affaire_intake_uploads set attempt_count=3,processing_lease_expires_at=now()-interval '1 second'
  where id=(select launch_id from stopped where n=81);
select is((select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(91),(select launch_id from stopped where n=81))),
  0::bigint,'the fourth claim closes the exhausted launch');
create function pg_temp.confirm(n integer) returns text language sql as $$
  select outcome from public.confirm_affaire_brief_takeoff(pg_temp.f(10),pg_temp.f(n),pg_temp.f(1),
    (select updated_at from public.affaire_briefs where project_id=pg_temp.f(n)),null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',
    p_actor_claims=>jsonb_build_object('sub',pg_temp.f(1),'role','authenticated'))
$$;
insert into private.takeoff_launch_activation(active_from) values (now()-interval '1 minute');
insert into private.takeoff_completion_activation(active_from) values (now()-interval '1 minute');
update public.feature_flags set enabled=true where tenant_id=pg_temp.f(10) and flag_key='TAKEOFF_MODULE_ENABLED';
select throws_ok('select pg_temp.confirm(80)','P0001','INTAKE_ANALYSIS_REQUIRED','loss of payer does not make the earlier brief confirmable');
select throws_ok('select pg_temp.confirm(81)','P0001','INTAKE_ANALYSIS_REQUIRED','exhaustion does not make the earlier brief confirmable');
select is((select count(*) from public.takeoff_launch_requests where project_id in (pg_temp.f(80),pg_temp.f(81))),0::bigint,
  'neither refused confirmation reserves a takeoff');
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
set local role authenticated;
create temp table again as select n,r.* from generate_series(80,81) n
  cross join lateral public.start_affaire_intake_analysis(pg_temp.f(n),false) r;
reset role;
select results_eq($$select outcome,piece_count from again order by n$$,$$values ('brief_only'::text,0),('brief_only',0)$$,
  'either failure can be repaired by a brief-only press without rereading the completed piece');

select count(*) from again a cross join lateral public.claim_affaire_intake_analysis_launch(pg_temp.f(92),a.launch_id);
select pg_temp.publish(a.launch_id,pg_temp.f(92),snapshot->>'revision',(snapshot->>'brief_updated_at')::timestamptz,
  'Nouveau dépôt inclus',pg_temp.f(a.n+6))
from again a cross join lateral public.read_affaire_intake_brief_inputs(pg_temp.f(a.n)) snapshot;
select bool_and(public.finish_affaire_intake_upload_attempt(launch_id,pg_temp.f(92),'ready',now())) from again;
select results_eq($$select b.summary,l.source_document_id from public.affaire_briefs b join public.affaire_brief_source_links l
  on l.brief_id=b.id where b.project_id in (pg_temp.f(80),pg_temp.f(81)) order by b.project_id$$,
  $$values ('Nouveau dépôt inclus'::text,pg_temp.f(86)),('Nouveau dépôt inclus',pg_temp.f(87))$$,
  'the new generation includes the completed piece in both dossiers');
select results_eq($$select pg_temp.confirm(n) from generate_series(80,81) n$$,$$values ('confirmed'::text),('confirmed')$$,
  'publishing the new brief makes both confirmations available');
select is((select count(*) from public.takeoff_launch_requests where project_id in (pg_temp.f(80),pg_temp.f(81))),2::bigint,
  'only the confirmed new publications reserve their takeoffs');

-- The previous fixture synthesized a confirmed draft before its first launch.
-- Establish a current publication before exercising the same human resolution.
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status,classification_source,document_kind)
  values(pg_temp.f(85),'Annexe.pdf','uploaded','classified','manual','annexes');
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
create temp table resolution_launch as select launch_id from public.start_affaire_intake_analysis(pg_temp.f(82),false);
select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(99),(select launch_id from resolution_launch));
select public.publish_affaire_intake_brief((select launch_id from resolution_launch),pg_temp.f(99),null,s->>'revision',
  (s->>'brief_updated_at')::timestamptz,'{"summary":"Ancien brief","project_object":"Fixture","missing_elements":["Plans manquants"]}','[]')
  from public.read_affaire_intake_brief_inputs(pg_temp.f(82)) s;
select public.finish_affaire_intake_upload_attempt((select launch_id from resolution_launch),pg_temp.f(99),'ready',now());
-- A member accepted this particular missing-plan entry. A republication omits human metadata.
update public.affaire_briefs set status='confirme',confirmed_by=pg_temp.f(1),confirmed_at=now(),
  generation_metadata='{"resolved_plan_gap_indexes":[0]}' where project_id=pg_temp.f(82);
select public.publish_affaire_intake_brief((select launch_id from resolution_launch),null,pg_temp.f(1),
  public.read_affaire_intake_brief_inputs(pg_temp.f(82))->>'revision',
  (select updated_at from public.affaire_briefs where project_id=pg_temp.f(82)),
  '{"status":"confirme","summary":"Ancien brief","project_object":"Fixture","scope":[],"lots":[],"received_pieces":[],"assumptions":[],"vigilance_points":[],"missing_elements":["Plans manquants"],"generation_metadata":{}}','[]');
select results_eq($$select status,generation_metadata->'resolved_plan_gap_indexes',confirmed_by from public.affaire_briefs where project_id=pg_temp.f(82)$$,
  $$values ('confirme'::text,'[0]'::jsonb,pg_temp.f(1))$$,'republication keeps both the human resolution and its confirmation');
select public.publish_affaire_intake_brief((select launch_id from resolution_launch),null,pg_temp.f(1),
  public.read_affaire_intake_brief_inputs(pg_temp.f(82))->>'revision',
  (select updated_at from public.affaire_briefs where project_id=pg_temp.f(82)),
  '{"status":"confirme","summary":"Ancien brief","project_object":"Fixture","scope":[],"lots":[],"received_pieces":[],"assumptions":[],"vigilance_points":[],"missing_elements":["CCTP manquant"],"generation_metadata":{"resolved_plan_gap_indexes":[0]}}','[]');
select results_eq($$select status,generation_metadata ? 'resolved_plan_gap_indexes',confirmed_at from public.affaire_briefs where project_id=pg_temp.f(82)$$,
  $$values ('a_confirmer'::text,false,null::timestamptz)$$,'an index cannot resolve a different gap after republication');
select ok(not has_function_privilege('authenticated','public.read_affaire_intake_brief_inputs(uuid,boolean)','execute')
  and not has_function_privilege('anon','public.read_affaire_intake_brief_inputs(uuid,boolean)','execute')
  and has_function_privilege('service_role','public.read_affaire_intake_brief_inputs(uuid,boolean)','execute'),'only the service can obtain a dossier input snapshot');
select * from finish();
rollback;
