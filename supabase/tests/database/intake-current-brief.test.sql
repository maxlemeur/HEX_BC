begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae590000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(1),'current-brief@example.test',now());
create temp table fixture as select tenant_id from public.tenant_memberships where user_id=pg_temp.f(1) and is_default;
insert into public.estimate_projects(id,tenant_id,user_id,name)
  select pg_temp.f(n),tenant_id,pg_temp.f(1),'Dossier fictif' from fixture,generate_series(20,30) n;
insert into private.takeoff_launch_activation(active_from) values(now()-interval '1 min');
update public.feature_flags set enabled=true where tenant_id=(select tenant_id from fixture) and flag_key='TAKEOFF_MODULE_ENABLED';

create function pg_temp.confirm(n integer,choice boolean default false) returns text language plpgsql as $$
declare b public.affaire_briefs%rowtype; claims jsonb:=jsonb_build_object('sub',pg_temp.f(1),'role','authenticated');
begin
  select * into strict b from public.affaire_briefs where project_id=pg_temp.f(n);
  if choice then return (select outcome from public.confirm_affaire_brief_plan_choice(b.tenant_id,b.project_id,pg_temp.f(1),b.updated_at,
    '{}',null,p_actor_claims=>claims)); end if;
  return (select outcome from public.confirm_affaire_brief_takeoff(b.tenant_id,b.project_id,pg_temp.f(1),b.updated_at,
    null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',p_actor_claims=>claims));
end;
$$;
create function pg_temp.add_plan(n integer,seq integer) returns void language plpgsql as $$
declare tenant uuid:=(select tenant_id from fixture); ps uuid:=pg_temp.f(n*100+seq); f uuid:=pg_temp.f(n*1000+seq);
  filepath text:=concat_ws('/',tenant,ps,f,'plan.pdf');
begin
  insert into public.plan_sets(id,project_id,tenant_id,name) values(ps,pg_temp.f(n),tenant,case when seq=1 then 'Plans import' else 'Plans' end);
  insert into public.plan_files(id,plan_set_id,tenant_id,file_name,file_path,file_type,file_size_bytes)
    values(f,ps,tenant,'plan.pdf',filepath,'application/pdf',8);
  insert into storage.objects(bucket_id,name,metadata,version) values('plan-files',filepath,'{"size":8}',gen_random_uuid()::text);
end;
$$;
create function pg_temp.prepare(n integer) returns text language plpgsql as $$
declare press record; s jsonb;
begin
  select * into strict press from public.start_affaire_intake_analysis(pg_temp.f(n),false);
  if press.outcome<>'brief_only' or press.piece_count<>0 then return press.outcome; end if;
  perform public.claim_affaire_intake_analysis_launch(pg_temp.f(3),press.launch_id);
  s:=public.read_affaire_intake_brief_inputs(pg_temp.f(n));
  perform public.publish_affaire_intake_brief(press.launch_id,pg_temp.f(3),null,s->>'revision',(s->>'brief_updated_at')::timestamptz,
    '{"summary":"Résumé","project_object":"Fixture","missing_elements":["Plans manquants"]}','[]');
  perform public.finish_affaire_intake_upload_attempt(press.launch_id,pg_temp.f(3),'ready',now());
  return press.outcome;
end;
$$;
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
-- The old worker owns these uploads, and the briefs have no generation receipt.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  select pg_temp.f(n+100),pg_temp.f(n),pg_temp.f(1),'ready' from generate_series(20,21) n;
insert into public.affaire_briefs(project_id,upload_id,status,summary,project_object)
  select pg_temp.f(n),pg_temp.f(n+100),'a_confirmer','Brief historique','Essai' from generate_series(20,21) n;
select pg_temp.add_plan(20,1);
select is(pg_temp.confirm(20),'confirmed','0.9.0 can still confirm a brief without a revision after a plan arrives');
select is(pg_temp.confirm(21,true),'confirmed','the plan-choice confirmation also accepts a legacy brief');
select is(pg_temp.confirm(20),'replayed','legacy replay remains available');
select is(public.read_affaire_intake_brief_state(pg_temp.f(20)),'legacy','the worker can distinguish legacy dossiers');
select ok(not has_function_privilege('authenticated','public.read_affaire_intake_brief_state(uuid)','execute')
  and not has_function_privilege('anon','public.read_affaire_intake_brief_state(uuid)','execute'),'the state reader is restricted to the authorized server path');
-- A duplicate-only or rejected upload never enrolled a legacy affaire, even after activation.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  values(pg_temp.f(700),pg_temp.f(20),pg_temp.f(1),'deposited');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(700),'Rejected.pdf','rejected','failed');
select ok(not exists(select 1 from private.affaire_intake_contracts where project_id=pg_temp.f(20)),
  'an empty deposit with only a rejection does not enrol the affaire');

-- Both writers share one dossier. The new version publishes, then the 0.9.0 worker
-- overwrites the existing row and sources. Production must still be able to confirm.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  values(pg_temp.f(728),pg_temp.f(28),pg_temp.f(1),'deposited'),(pg_temp.f(729),pg_temp.f(28),pg_temp.f(1),'ready');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status,classification_source,document_kind)
  values(pg_temp.f(728),'Notice.pdf','uploaded','classified','manual','cctp');
select is(pg_temp.prepare(28),'brief_only','the first hand-classified deposit can publish before activation');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status,classification_source,document_kind)
  values(pg_temp.f(727),pg_temp.f(729),'Legacy.pdf','uploaded','classified','ai','annexes');
update public.affaire_briefs set upload_id=pg_temp.f(729),summary='Old worker result' where project_id=pg_temp.f(28);
delete from public.affaire_brief_source_links where project_id=pg_temp.f(28);
insert into public.affaire_brief_source_links(tenant_id,project_id,brief_id,source_document_id,block_key,source_file_name)
  select tenant_id,project_id,id,pg_temp.f(727),'summary','Legacy.pdf' from public.affaire_briefs where project_id=pg_temp.f(28);
select pg_temp.add_plan(28,1);
create temp table inactive_input as select public.read_affaire_intake_brief_inputs(pg_temp.f(28))->>'revision' revision;
select pg_temp.add_plan(28,2);
select is(public.read_affaire_intake_brief_inputs(pg_temp.f(28),true)->>'revision',(select revision from inactive_input),
  'before activation an in-flight worker keeps the released digest when another plan leaves availability unchanged');
select is(pg_temp.confirm(28),'confirmed','without activation production confirms the result of the old worker');
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(28),false)),'nothing_waiting',
  'without activation the press keeps the existing reservation rules');

select ok(not has_table_privilege('service_role','private.intake_current_brief_activation','INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated','private.intake_current_brief_activation','INSERT,UPDATE,DELETE'),
  'neither an application server nor a member can operate the deployment switch');
-- A scheduled activation also leaves the old paths usable until its timestamp.
insert into private.intake_current_brief_activation(active_from) values(now()+interval '1 day');
update public.affaire_briefs set status='a_confirmer',confirmed_at=null,confirmed_by=null where project_id=pg_temp.f(28);
select is(pg_temp.confirm(28,true),'confirmed','a future activation preserves plan-choice confirmation');
update private.intake_current_brief_activation set active_from=now()-interval '1 day';
select is(pg_temp.confirm(20),'replayed','after activation a duplicate-only deposit can still replay its historical confirmation');
select throws_ok('select pg_temp.confirm(28)','P0001','INTAKE_ANALYSIS_REQUIRED','after activation the same mixed-version brief needs a publication');
-- A real deposit enrolls the project even if the upload subsequently disappears.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  select pg_temp.f(n+200),pg_temp.f(n),pg_temp.f(1),'deposited' from generate_series(20,26) n;
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(220),'Accepted.pdf','uploaded','awaiting_launch');
delete from public.affaire_intake_uploads where id=pg_temp.f(220);
select throws_ok('select pg_temp.confirm(20)','P0001','INTAKE_ANALYSIS_REQUIRED','a legacy replay after entry needs a current publication, even after deleting the deposit');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status,classification_source,document_kind)
  select pg_temp.f(n+300),pg_temp.f(n+200),'Notice.pdf','uploaded','classified','manual','cctp' from generate_series(21,26) n;
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status,classification_source,document_kind)
  values(pg_temp.f(223),'Annexe.pdf','uploaded','classified','manual','annexes');
select pg_temp.add_plan(25,1),pg_temp.add_plan(26,1);
select is(public.read_affaire_intake_brief_state(pg_temp.f(21)),'required','the dossier can describe the missing first publication after entering the contract');
create temp table first_publications as select n,pg_temp.prepare(n) outcome from generate_series(21,26) n;
select results_eq($$select n,outcome from first_publications order by n$$,
  $$select n,'brief_only'::text from generate_series(21,26) n$$,'an existing legacy brief and first manual deposits all get a guarded first publication');
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(22),false)),'nothing_waiting','current inputs need no work');
select is(pg_temp.confirm(24),'confirmed','confirm once before testing the already-confirmed replay');
create temp table originals as select n,public.read_affaire_intake_brief_inputs(pg_temp.f(n))->>'revision' revision from generate_series(21,26) n;
-- The second deposit is wholly classified before anyone presses.
insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(400),pg_temp.f(21),pg_temp.f(1),'deposited');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(401),pg_temp.f(400),'Note.pdf','uploaded','awaiting_launch');
update public.affaire_intake_documents set document_kind='annexes',classification_source='manual',classification_status='classified' where id=pg_temp.f(401);
update public.affaire_intake_documents set document_kind='bpu_dqe' where id=pg_temp.f(322);
update public.affaire_intake_documents set deleted_at=now(),upload_status='rejected',classification_status='failed' where id=pg_temp.f(323);
select pg_temp.add_plan(24,1);
select pg_temp.add_plan(25,2);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(public.resolve_affaire_brief_plan_gap(pg_temp.f(26),0,(select updated_at from public.affaire_briefs where project_id=pg_temp.f(26)),pg_temp.f(1)),
  'the member resolves the exact plan gap through the existing RPC');
select set_config('request.jwt.claims','{}',true);
select results_eq($$select n,revision is distinct from (public.read_affaire_intake_brief_inputs(pg_temp.f(n))->>'revision') from originals order by n$$,
  $$select n,true from generate_series(21,26) n$$,'manual second deposit, category, deletion, first or additional plan, and plan decision each change the revision');
select throws_ok(format('select pg_temp.confirm(%s)',n),'P0001','INTAKE_ANALYSIS_REQUIRED','automatic confirmation refuses obsolete inputs for '||n) from generate_series(21,26) n;
select throws_ok(format('select pg_temp.confirm(%s,true)',n),'P0001','INTAKE_ANALYSIS_REQUIRED','plan-choice confirmation refuses obsolete inputs for '||n) from generate_series(21,26) n;
select is((select count(*) from public.takeoff_launch_requests where project_id in (pg_temp.f(22),pg_temp.f(23),pg_temp.f(25),pg_temp.f(26))),0::bigint,'no takeoff was created by a refused confirmation');
select results_eq($$select n,pg_temp.prepare(n) from generate_series(21,26) n$$,
  $$select n,'brief_only'::text from generate_series(21,26) n$$,'a press can republish each changed dossier with zero reading');
select ok(not exists(select 1 from public.affaire_intake_documents where analysis_launch_id is not null and project_id in
  (select pg_temp.f(n) from generate_series(21,26) n)),'no already classified piece was reserved by these launches');
select is(public.read_affaire_intake_brief_state(pg_temp.f(22)),'current','the publication covers the current inputs');
select is(pg_temp.confirm(22),'confirmed','the automatic confirmation accepts the new publication');
select is(pg_temp.confirm(26,true),'confirmed','plan selection accepts the publication after the human decision');
select is((select generation_metadata->'resolved_plan_gap_indexes' from public.affaire_briefs where project_id=pg_temp.f(26)),'[0]'::jsonb,
  'publishing the same missing list does not clear the decision or create another debt');

-- The previously selected plan disappears while the confirmation dialog is open.
-- With a pending brief publication, both confirmation APIs must give the same remedy.
insert into private.takeoff_completion_activation(active_from) values(now()-interval '1 min');
insert into private.takeoff_plan_dispatch_activation(active_from) values(now()-interval '1 min');
create temp table chosen as select jsonb_object_agg(plan_file_id,jsonb_build_object('version',plan_version,'sha256',repeat('c',64))) plans
  from public.takeoff_brief_plan_options((select tenant_id from fixture),pg_temp.f(25)) where plan_file_id=pg_temp.f(25001);
select ok((select plans ? pg_temp.f(25001)::text from chosen),'a real standalone plan is selectable before it disappears');
delete from public.plan_files where id=pg_temp.f(25001);
select throws_ok($$select * from public.confirm_affaire_brief_plan_choice(
  (select tenant_id from fixture),pg_temp.f(25),pg_temp.f(1),(select updated_at from public.affaire_briefs where project_id=pg_temp.f(25)),
  (select plans from chosen),null,p_blocked_reason=>'CHATGPT_NOT_CONNECTED',
  p_actor_claims=>jsonb_build_object('sub',pg_temp.f(1),'role','authenticated'))$$,
  'P0001','INTAKE_ANALYSIS_REQUIRED','a removed selected plan requires updating the brief before reviewing a new plan selection');

-- Even retaining the same brief row cannot make another lot inherit this receipt.
insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(490),pg_temp.f(22),pg_temp.f(1),'ready');
update public.affaire_briefs set upload_id=pg_temp.f(490),summary='Ancien résultat' where project_id=pg_temp.f(22);
select throws_ok('select pg_temp.confirm(22)','P0001','INTAKE_ANALYSIS_REQUIRED','a historical writer of the same row cannot inherit the explicit publication receipt');

-- Availability of each original matters even when the dossier already has plans.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  values(pg_temp.f(730),pg_temp.f(30),pg_temp.f(1),'deposited');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status,classification_source,document_kind,storage_path,size_bytes)
  select pg_temp.f(730),'Plan.pdf','uploaded','classified','manual','plans','fixture/original-'||i,8 from generate_series(1,2) i;
insert into storage.objects(bucket_id,name,metadata) values('affaire-intake','fixture/original-1','{"size":8}');
select is(pg_temp.prepare(30),'brief_only','first publication includes the one complete original');
insert into storage.objects(bucket_id,name,metadata) values('affaire-intake','fixture/original-2','{"size":8}');
select is(public.read_affaire_intake_brief_state(pg_temp.f(30)),'required','restoring a second original invalidates the existing publication');
select pg_temp.add_plan(30,1);
update storage.objects set version=null,metadata=metadata||'{"eTag":"first"}'::jsonb
  where name=(select file_path from public.plan_files where id=pg_temp.f(30001));
select is(pg_temp.prepare(30),'brief_only','publication includes the standalone copy identified only by its eTag');
update storage.objects set metadata=metadata||'{"eTag":"second"}'::jsonb
  where name=(select file_path from public.plan_files where id=pg_temp.f(30001));
select is(public.read_affaire_intake_brief_state(pg_temp.f(30)),'required','an equal-size standalone replacement with only its eTag changed invalidates the brief');

-- 0.9.0 starts a Drive lot in failed, before writing any links and arming it.
insert into public.affaire_intake_uploads(id,project_id,created_by,status,last_error)
  select pg_temp.f(i),pg_temp.f(27),pg_temp.f(1),'failed','Liens Drive en cours d''enregistrement.' from generate_series(740,741) i;
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(i),'Drive.pdf','uploaded','queued' from generate_series(740,741) i;
update public.affaire_intake_documents set deletion_token=pg_temp.f(3),deletion_started_at=now() where upload_id in (pg_temp.f(740),pg_temp.f(741));
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where upload_id in (pg_temp.f(740),pg_temp.f(741));
update public.affaire_intake_uploads set status='queued',last_error=null where id=pg_temp.f(740);
select results_eq($$select u.status,d.classification_status,d.issues from public.affaire_intake_uploads u
  join public.affaire_intake_documents d on d.upload_id=u.id where u.id in (pg_temp.f(740),pg_temp.f(741)) order by u.id$$,
  $$values ('queued'::text,'queued'::text,'{}'::text[]),('failed','queued','{}')$$,
  'ordinary recording and interrupted, re-armable Drive deposits expose no premature retry or diagnostic');

-- Old terminal pieces are left untouched at installation and at cut-over. The
-- member's individual retry may make only that piece actionable.
insert into public.affaire_intake_uploads(id,project_id,created_by,status,completed_at)
  values(pg_temp.f(750),pg_temp.f(27),pg_temp.f(1),'failed',now());
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(i),pg_temp.f(750),'Old.pdf','uploaded','queued' from generate_series(751,753) i;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(2),'historical-retry-outsider@example.test',now());

delete from private.intake_current_brief_activation;
select ok(not has_function_privilege('anon','public.prepare_historical_intake_document_retry(uuid,uuid)','execute')
  and not has_function_privilege('service_role','public.prepare_historical_intake_document_retry(uuid,uuid)','execute'),
  'preparing a historical retry is a member gesture');
set local role authenticated;
select is(public.intake_current_brief_active(),false,'the deployed client sees the compatibility mode before cut-over');
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(751)),false,'before activation a press cannot repair an old row');
reset role;
insert into private.intake_current_brief_activation(active_from) values(now()+interval '1 hour');
-- Close and cancel through the same operations a released worker uses.
insert into public.affaire_intake_uploads(id,project_id,created_by,status,processing_lease_token,processing_lease_expires_at)
  values(pg_temp.f(760),pg_temp.f(27),pg_temp.f(1),'processing',pg_temp.f(761),now()+interval '10 minutes');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  select pg_temp.f(i),pg_temp.f(760),'Old.pdf','uploaded','queued' from generate_series(762,763) i;
update public.affaire_intake_documents set deletion_token=pg_temp.f(3),deletion_started_at=now() where id=pg_temp.f(763);
select ok(public.finish_affaire_intake_upload_attempt(pg_temp.f(760),pg_temp.f(761),'failed',now()),'a pre-cutover worker can close its historical lot');
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where id=pg_temp.f(763);
select ok((select bool_and(classification_status='queued' and issues='{}') from public.affaire_intake_documents where upload_id=pg_temp.f(760)),
  'while activation is in the future neither a close nor cancellation adds a failure');
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(751)),false,'a scheduled activation cannot change the selected historical piece yet');
update private.intake_current_brief_activation set active_from=now();
select ok((select bool_and(classification_status='queued' and issues='{}') from public.affaire_intake_documents where upload_id=pg_temp.f(750)),
  'activation itself does not sweep existing pieces');
set local role authenticated;
select is(public.intake_current_brief_active(),true,'the deployed client can offer a retry for an uploaded piece under a terminal historical lot');
select set_config('request.jwt.claim.sub',pg_temp.f(2)::text,true);
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(751)),false,'a user outside the tenant cannot change that piece');
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),(select id from public.affaire_intake_documents where upload_id=pg_temp.f(741))),false,
  'the gesture does not release an interrupted Drive registration');
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(751)),true,'the member can explicitly prepare just the old failed reading for a retry');
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(751)),false,'replaying preparation does not append a duplicate diagnosis');
reset role;
select results_eq($$select classification_status,cardinality(issues) from public.affaire_intake_documents where upload_id=pg_temp.f(750) order by id$$,
  $$values ('failed'::text,1),('queued',0),('queued',0)$$,'only the selected piece is now eligible for the existing per-piece command');
update public.estimate_projects set is_archived=true where id=pg_temp.f(27);
select is(public.prepare_historical_intake_document_retry(pg_temp.f(27),pg_temp.f(752)),false,'an archived dossier cannot change a historical piece');
update public.estimate_projects set is_archived=false where id=pg_temp.f(27);
-- A historical lot can end before its first piece starts, too.
insert into public.affaire_intake_uploads(id,project_id,created_by,status,attempt_count,processing_lease_token,processing_lease_expires_at)
  values(pg_temp.f(500),pg_temp.f(27),pg_temp.f(1),'processing',3,pg_temp.f(501),now()-interval '1 min');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(500),'En attente.pdf','uploaded','queued'),(pg_temp.f(500),'Commencée.pdf','uploaded','processing');
select count(*) from public.claim_affaire_intake_upload(pg_temp.f(500),pg_temp.f(502),now(),now()+interval '10 minutes');
select results_eq($$select classification_status from public.affaire_intake_documents where upload_id=pg_temp.f(500) order by file_name$$,
  $$values ('failed'::text),('failed')$$,'permanently exhausted historical pieces are individually retryable');
-- A historical attempt can also stop because the depositor no longer has the right.
insert into public.affaire_intake_uploads(id,project_id,created_by,status,attempt_count,processing_lease_token,processing_lease_expires_at)
  values(pg_temp.f(510),pg_temp.f(27),pg_temp.f(1),'processing',1,pg_temp.f(511),now()+interval '10 min');
insert into public.affaire_intake_documents(id,upload_id,file_name,upload_status,classification_status)
  values(pg_temp.f(512),pg_temp.f(510),'À relancer.pdf','uploaded','queued'),
    (pg_temp.f(513),pg_temp.f(510),'Suppression en cours.pdf','uploaded','queued');
update public.affaire_intake_documents set deletion_token=pg_temp.f(514),deletion_started_at=now() where id=pg_temp.f(513);
select ok(public.finish_affaire_intake_upload_attempt(pg_temp.f(510),pg_temp.f(511),'failed',now(),null,'payer_access_lost'),
  'a failed historical worker can finish while a source is being removed');
select is((select classification_status from public.affaire_intake_documents where id=pg_temp.f(512)),'failed','an ordinary historical stop releases the unstarted piece');
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where id=pg_temp.f(513);
select is((select classification_status from public.affaire_intake_documents where id=pg_temp.f(513)),'failed','a cancelled removal exposes the historical piece for an individual retry');
-- The migration role owns its function. Removing it also removes the dependent
-- Storage trigger, reproducing a missing fence without owning the managed table.
drop function private.lock_intake_plan_original() cascade;
select throws_ok('select public.read_affaire_intake_brief_inputs(pg_temp.f(30),true)','55000','INTAKE_STORAGE_GUARD_UNAVAILABLE',
  'if a managed upgrade removes the active restoration fence, the service cannot certify a brief');

delete from private.intake_current_brief_activation;
select is(pg_temp.confirm(28,true),'replayed','removing activation restores the 0.9.0 confirmation immediately');
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(28),false)),'nothing_waiting','rollback restores the old press on the same affaire');
select * from finish();
rollback;
