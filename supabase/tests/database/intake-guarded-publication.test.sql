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
create function pg_temp.inputs() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at,'document_kind',document_kind) order by id),'[]')
  from public.affaire_intake_documents where project_id=pg_temp.f(20) and deleted_at is null and deletion_token is null
    and upload_status='uploaded' and classification_status <> 'awaiting_launch'
$$;
create function pg_temp.publish(batch uuid, token uuid, docs jsonb, stamp timestamptz, label text, source_id uuid)
returns uuid language sql as $$
  select public.publish_affaire_intake_brief(batch,token,null,docs,stamp,
    jsonb_build_object('summary',label,'project_object','Fixture','last_generated_at',now()),
    case when source_id is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
      'blockKey','summary','entryIndex',0,'sourceDocumentId',source_id,'sourceFileName','A.pdf')) end)
$$;
create temporary table saved as select pg_temp.inputs() docs,(select launch_id from launched) batch;
select isnt(pg_temp.publish(batch,pg_temp.f(60),docs,null,'Premier',pg_temp.f(40)),null::uuid,'the draft and its source publish together') from saved;
select is((select count(*) from public.affaire_brief_source_links where project_id=pg_temp.f(20)),1::bigint,'one source committed');
alter table saved add column stamp timestamptz;
update saved set stamp=(select updated_at from public.affaire_briefs where project_id=pg_temp.f(20));
update public.affaire_intake_documents set document_kind='cctp' where id=pg_temp.f(40);
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),docs,stamp,'Périmé',pg_temp.f(40)) from saved$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','a category correction during generation invalidates the result');
update saved set docs=pg_temp.inputs();
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),docs,stamp,'Périmé',pg_temp.f(99)) from saved$$,'23514','INTAKE_BRIEF_SOURCE_INVALID','a foreign or missing source rolls back the whole publication');
select throws_ok($$select public.publish_affaire_intake_brief(batch,pg_temp.f(60),null,docs,stamp,
  '{"summary":"Non publié","project_object":"Fixture"}',
  jsonb_build_array(jsonb_build_object('blockKey','inconnu','entryIndex',0,'sourceDocumentId',pg_temp.f(40),'sourceFileName','A.pdf')))
  from saved$$,'23514',null,'a failing source insert rolls back the preceding draft update and link replacement');
select results_eq($$select b.summary,l.source_document_id from public.affaire_briefs b join public.affaire_brief_source_links l on l.brief_id=b.id where b.project_id=pg_temp.f(20)$$,$$values ('Premier'::text,pg_temp.f(40))$$,'a failed publication preserves both previous values');
update public.affaire_intake_documents set deletion_token=pg_temp.f(61) where id=pg_temp.f(40);
select throws_ok($$select pg_temp.publish(batch,pg_temp.f(60),docs,stamp,'Supprimé',pg_temp.f(40)) from saved$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','a deletion during generation cannot put the document back');
update public.affaire_intake_documents set deletion_token=null where id=pg_temp.f(40);
update public.affaire_intake_uploads set processing_lease_token=pg_temp.f(62),processing_lease_expires_at=now()+interval '10 minutes' where id=pg_temp.f(31);
select throws_ok($$select pg_temp.publish(pg_temp.f(31),pg_temp.f(62),pg_temp.inputs(),null,'Historique',pg_temp.f(40))$$,'40001','INTAKE_BRIEF_INPUT_CHANGED','the historical worker loses its compare-and-set against a concurrently published launch brief');
select ok(public.finish_affaire_intake_upload_attempt((select batch from saved),pg_temp.f(60),'ready',now()),'close the initial brief-only launch');
set local role authenticated;
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(20),true)),'nothing_waiting','a repeated press does not regenerate the existing brief');
reset role;

insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(41),pg_temp.f(30),'B.png','uploaded','awaiting_launch'),(pg_temp.f(42),pg_temp.f(30),'C.png','uploaded','awaiting_launch');
set local role authenticated;
create temporary table pay as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true);
reset role;
select is(public.stop_affaire_intake_analysis((select launch_id from pay),null),null::text,'a Mac without credentials cannot close a fresh launch on another Mac');
select is((select payer_id from public.claim_affaire_intake_analysis_launch(pg_temp.f(63),(select launch_id from pay))),pg_temp.f(2),'the authorised host can claim it');
set local role authenticated;
select throws_ok($$update public.affaire_intake_documents set analysis_completed_at=now() where id=pg_temp.f(41)$$,'42501','INTAKE_LAUNCH_PROTECTED','a member cannot forge a completed reading');
reset role;
update public.affaire_intake_documents set classification_status='classified',analysis_completed_at=now() where id=pg_temp.f(41);
select ok(public.intake_payer_can_write(pg_temp.f(2),pg_temp.f(10),pg_temp.f(20)),'the server accepts the current nonowner admin');
update public.tenant_memberships set role='director' where user_id=pg_temp.f(2) and tenant_id=pg_temp.f(10);
select ok(not public.intake_payer_can_write(pg_temp.f(2),pg_temp.f(10),pg_temp.f(20)),'the server requires current write access to the specific affaire');
select is(public.stop_affaire_intake_analysis((select launch_id from pay),pg_temp.f(64)),null::text,'a stale lease cannot release another worker’s documents');
select is(public.stop_affaire_intake_analysis((select launch_id from pay),pg_temp.f(63)),'payer_access_lost','the current lease can interrupt the revoked payer');
select results_eq($$select classification_status,analysis_launch_id is null from public.affaire_intake_documents where id in (pg_temp.f(41),pg_temp.f(42)) order by id$$,$$values ('classified'::text,false),('awaiting_launch',true)$$,'finished work is retained and the remaining piece can be launched again');

select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
set local role authenticated;
create temporary table stranded as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true);
reset role;
update public.affaire_intake_uploads set created_at=now()-interval '31 minutes' where id=(select launch_id from stranded);
select is(public.stop_affaire_intake_analysis((select launch_id from stranded),null),'connection_unavailable','a launch no Mac can take ends after the 30-minute recovery window');
select results_eq($$select classification_status,analysis_launch_id,cardinality(issues)>0 from public.affaire_intake_documents where id=pg_temp.f(42)$$,$$values ('awaiting_launch'::text,null::uuid,true)$$,'the unread piece shows a reason and is eligible for another press');
select ok(not has_function_privilege('authenticated','public.publish_affaire_intake_brief(uuid,uuid,uuid,jsonb,timestamptz,jsonb,jsonb)','execute')
  and not has_function_privilege('anon','public.stop_affaire_intake_analysis(uuid,uuid)','execute'),'the worker mutations are private to the service role');
select * from finish();
rollback;
