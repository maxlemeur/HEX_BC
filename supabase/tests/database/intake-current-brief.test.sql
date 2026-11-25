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
  select pg_temp.f(n),tenant_id,pg_temp.f(1),'Dossier fictif' from fixture,generate_series(20,27) n;
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
  insert into public.plan_sets(id,project_id,tenant_id,name) values(ps,pg_temp.f(n),tenant,'Plans');
  insert into public.plan_files(id,plan_set_id,tenant_id,file_name,file_path,file_type,file_size_bytes)
    values(f,ps,tenant,'plan.pdf',filepath,'application/pdf',8);
  insert into storage.objects(bucket_id,name,metadata) values('plan-files',filepath,'{"size":8}');
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
-- A real deposit enrolls the project even if the upload subsequently disappears.
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
  select pg_temp.f(n+200),pg_temp.f(n),pg_temp.f(1),'deposited' from generate_series(20,26) n;
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

-- Even retaining the same brief row cannot make another lot inherit this receipt.
insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(490),pg_temp.f(22),pg_temp.f(1),'ready');
update public.affaire_briefs set upload_id=pg_temp.f(490),summary='Ancien résultat' where project_id=pg_temp.f(22);
select throws_ok('select pg_temp.confirm(22)','P0001','INTAKE_ANALYSIS_REQUIRED','a historical writer of the same row cannot inherit the explicit publication receipt');

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
select * from finish();
rollback;
