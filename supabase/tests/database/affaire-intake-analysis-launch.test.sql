begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.member(n integer) returns void language sql as $$
  select set_config('request.jwt.claim.sub', pg_temp.f(n)::text, true),
    set_config('request.jwt.claims', jsonb_build_object('role','authenticated','sub',pg_temp.f(n))::text, true)
$$;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
select pg_temp.f(n), 'intake-launch-' || n || '@example.test', '{}', now() from generate_series(1,4) n;
update public.tenant_memberships set is_default = false where user_id in (pg_temp.f(1),pg_temp.f(2),pg_temp.f(3));
insert into public.tenants(id,name,slug) values (pg_temp.f(10),'Dossier fictif','intake-launch-tests');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default) values
  (pg_temp.f(10),pg_temp.f(1),'engineer',true),(pg_temp.f(10),pg_temp.f(2),'admin',true),
  (pg_temp.f(10),pg_temp.f(3),'director',true);
insert into public.estimate_projects(id,tenant_id,user_id,name) values (pg_temp.f(20),pg_temp.f(10),pg_temp.f(1),'Dossier fictif');
insert into public.affaire_briefs(id,project_id,status,summary,project_object,confirmed_at,confirmed_by)
values (pg_temp.f(30),pg_temp.f(20),'confirme','Résumé fictif','Objet fictif',now(),pg_temp.f(1));
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
select pg_temp.f(n),pg_temp.f(20),pg_temp.f(1),case when n=43 then 'queued' else 'deposited' end from generate_series(41,43) n;
create function pg_temp.deposit(n integer, batch integer) returns void language sql as $$
  insert into public.affaire_intake_documents(id,upload_id,file_name,storage_path,upload_status,classification_status)
  values(pg_temp.f(n),pg_temp.f(batch),'scan.pdf','fixture/'||n,'uploaded','awaiting_launch')
$$;
-- A fixture policy denies confirmation inserts on the member's own, readable dossier.
-- All three states must reach the same policy denial before any domain callback.
create policy test_deny_brief_insert on public.affaire_briefs as restrictive
  for insert to authenticated with check (false);
create function pg_temp.denied_confirmation() returns text language plpgsql as $$
begin
  insert into public.affaire_briefs(project_id,status,summary,project_object,confirmed_at,confirmed_by)
    values(pg_temp.f(20),'confirme','Essai fictif','Objet fictif',now(),auth.uid());
  return 'insert accepted';
exception when others then return sqlstate || ' ' || sqlerrm;
end;
$$;
-- The fourth fixture user belongs only to a different tenant. Compare the normal
-- scope refusal with that of a missing affaire, without exposing dossier errors.
create function pg_temp.outside_scope_refused() returns boolean language plpgsql as $$
begin
  if exists (select 1 from pg_trigger where tgrelid='public.affaire_briefs'::regclass and tgname='guard_insert_intake_confirmation' and (tgtype & 2)<>0) then
    return false;
  end if;
  return not exists (select 1 from public.estimate_projects where id=pg_temp.f(20))
    and pg_temp.denied_confirmation()='P0001 AFFAIRE_BRIEF_PROJECT_NOT_FOUND';
end;
$$;
select pg_temp.member(1);
set local role authenticated;
create temp table insert_denial as select pg_temp.denied_confirmation() as reason;
select matches((select reason from insert_denial),'^42501 ','row policy refuses insertion on an empty dossier');
select pg_temp.member(4);
select ok(pg_temp.outside_scope_refused(),'outside tenant receives the same scope refusal (empty dossier)');
select pg_temp.member(1);
reset role;
select pg_temp.deposit(51,41), pg_temp.deposit(52,42), pg_temp.deposit(53,41);
update public.affaire_intake_documents set classification_status='classified',classification_source='manual',document_kind='annexes'
where id=pg_temp.f(53);
select is((select status from public.affaire_briefs where id=pg_temp.f(30)),'a_confirmer','adding a waiting piece reopens a confirmed brief');
create function pg_temp.confirm() returns void language sql as $$
  update public.affaire_briefs set status='confirme',confirmed_at=now(),confirmed_by=pg_temp.f(1) where id=pg_temp.f(30)
$$;
select throws_ok('select pg_temp.confirm()', 'P0001','INTAKE_ANALYSIS_REQUIRED','waiting documents block confirmation');
select is((select count(*)::int from public.claim_affaire_intake_analysis_launch(pg_temp.f(70))),0,'recovery cannot start a deposit');
select is((select claimed from public.claim_affaire_intake_upload(pg_temp.f(41),pg_temp.f(70),now(),now()+interval '10 min')),false,'legacy worker cannot claim a deposit');
select is((select claimed from public.claim_affaire_intake_upload(pg_temp.f(43),pg_temp.f(70),now(),now()+interval '10 min')),true,'legacy upload still runs');

select ok(not has_function_privilege('anon','public.launch_affaire_intake_analysis(uuid,boolean)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_affaire_intake_analysis_launch(uuid,uuid)','EXECUTE'),
  'only members can press, only a worker can recover');
select pg_temp.member(1);
update public.tenants set is_active=false where id=pg_temp.f(10);
select throws_ok($$select * from public.launch_affaire_intake_analysis(pg_temp.f(20),true)$$,'42501','INTAKE_LAUNCH_FORBIDDEN','suspending the tenant prevents its owner from launching');
update public.tenants set is_active=true where id=pg_temp.f(10);
set local role authenticated;
select is(pg_temp.denied_confirmation(),(select reason from insert_denial),'waiting pieces cannot change a policy refusal');
select pg_temp.member(4);
select ok(pg_temp.outside_scope_refused(),'outside tenant receives the same scope refusal (waiting dossier)');
select pg_temp.member(1);
reset role;
select pg_temp.member(3);
set local role authenticated;
select throws_ok($$select * from public.launch_affaire_intake_analysis(pg_temp.f(20),true)$$,'42501','INTAKE_LAUNCH_FORBIDDEN','a director cannot launch another member’s dossier');
select pg_temp.member(2);
create temp table first_press as select * from public.launch_affaire_intake_analysis(pg_temp.f(20),true);
select results_eq('select outcome, piece_count from first_press',$$values ('launched'::text,2)$$,'one press takes two deposits and excludes a manual piece');
select pg_temp.member(1);
select is(pg_temp.denied_confirmation(),(select reason from insert_denial),'an active launch cannot change a policy refusal');
select pg_temp.member(4);
select ok(pg_temp.outside_scope_refused(),'outside tenant receives the same scope refusal (running dossier)');
select pg_temp.member(1);
select results_eq($$select outcome, launch_id from public.launch_affaire_intake_analysis(pg_temp.f(20),false)$$,
  $$select 'already_running'::text, launch_id from first_press$$,'a second writer cannot replace the first mandate');
select throws_ok($$update public.affaire_intake_uploads set created_by=pg_temp.f(1) where id=(select launch_id from first_press)$$,
  '42501','INTAKE_LAUNCH_PROTECTED','a writer cannot change the payer');
reset role;
select is((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(53)),null::uuid,'manual piece excluded');
select is((select claimed from public.claim_affaire_intake_upload((select launch_id from first_press),pg_temp.f(70),now(),now()+interval '10 min')),false,'0.9.0 cannot take a new launch');
select results_eq($$select payer_id,read_scans,attempt_count from public.claim_affaire_intake_analysis_launch(pg_temp.f(71))$$,
  $$values (pg_temp.f(2),true,1)$$,'first worker receives the pressing admin, not the depositor');
select is((select count(*)::int from public.claim_affaire_intake_analysis_launch(pg_temp.f(72))),0,'live lease excludes another worker');
update public.affaire_intake_documents set classification_status='processing' where id=pg_temp.f(51);
update public.affaire_intake_uploads set processing_lease_expires_at=now()-interval '1 second' where id=(select launch_id from first_press);
select results_eq($$select payer_id,read_scans,attempt_count from public.claim_affaire_intake_analysis_launch(pg_temp.f(72))$$,
  $$values (pg_temp.f(2),true,2)$$,'recovery retains payer and reading choice');
select is((select classification_status from public.affaire_intake_documents where id=pg_temp.f(51)),'queued','interrupted classification becomes runnable');
select is(public.finish_affaire_intake_upload_attempt((select launch_id from first_press),pg_temp.f(71),'ready',now()),false,'expired worker cannot finish');
select is(public.renew_affaire_intake_upload_lease((select launch_id from first_press),pg_temp.f(72),now(),now()+interval '11 minutes'),true,'the recovered worker renews');
update public.affaire_intake_documents set classification_status='classified' where analysis_launch_id=(select launch_id from first_press);
select throws_ok('select pg_temp.confirm()', 'P0001','INTAKE_ANALYSIS_RUNNING','even after classification, the batch stays open until its brief is done');
select pg_temp.deposit(54,42);
create function pg_temp.publish(batch uuid,token uuid) returns uuid language sql as $$
  select public.publish_affaire_intake_brief(batch,token,null,s->>'revision',(s->>'brief_updated_at')::timestamptz,
    '{"summary":"Résumé du lot","project_object":"Objet fictif"}','[]')
  from public.read_affaire_intake_brief_inputs(pg_temp.f(20)) s
$$;
select throws_ok($$select public.finish_affaire_intake_upload_attempt((select launch_id from first_press),pg_temp.f(72),'ready',now())$$,
  '40001','INTAKE_BRIEF_INPUT_CHANGED','an explicit success requires its first publication');
select pg_temp.publish((select launch_id from first_press),pg_temp.f(72));
select is(public.finish_affaire_intake_upload_attempt((select launch_id from first_press),pg_temp.f(72),'ready',now()),true,'worker closes its batch after refresh');
select throws_ok('select pg_temp.confirm()', 'P0001','INTAKE_ANALYSIS_REQUIRED','piece deposited during the launch still waits');
select pg_temp.member(1);
set local role authenticated;
select results_eq($$select outcome,piece_count from public.launch_affaire_intake_analysis(pg_temp.f(20),false)$$,$$values ('launched'::text,1)$$,'next press takes only the new piece');
reset role;
select results_eq($$select payer_id,read_scans from public.claim_affaire_intake_analysis_launch(pg_temp.f(73))$$,
  $$values (pg_temp.f(1),false)$$,'disconnected launcher has no scan reading');
select is(public.finish_affaire_intake_upload_attempt((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(54)),
  pg_temp.f(73),'ready',now()),false,'a worker cannot close while a captured piece still waits for classification');
select is(public.finish_affaire_intake_upload_attempt((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(54)),
  pg_temp.f(73),'queued',now(),now()-interval '1 second','interrupted'),true,'retry returns to the explicit queue');
select is((select status from public.affaire_intake_uploads where id=(select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(54))),
  'launch_queued','legacy recovery cannot pick up a released launch');
select results_eq($$select payer_id,read_scans from public.claim_affaire_intake_analysis_launch(pg_temp.f(74))$$,
  $$values (pg_temp.f(1),false)$$,'explicit backoff retains the same payer and reading choice');
update public.affaire_intake_documents set classification_status='classified' where id=pg_temp.f(54);
select pg_temp.publish((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(54)),pg_temp.f(74));
select is(public.finish_affaire_intake_upload_attempt((select analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(54)),pg_temp.f(74),'ready',now()),true,'next launch finishes');
select lives_ok('select pg_temp.confirm()','a separate confirmation succeeds');
select pg_temp.deposit(55,41);
update public.affaire_intake_documents set classification_status='classified',classification_source='manual',document_kind='plans' where id=pg_temp.f(55);
select lives_ok('select pg_temp.confirm()','manual classification alone clears the waiting piece');
select results_eq($$select outcome,piece_count from public.launch_affaire_intake_analysis(pg_temp.f(20),true)$$,
  $$values ('nothing_waiting'::text,0)$$,'a manual-only dossier does not spend a launch');
-- RLS must accept the brief row before either privileged confirmation check can run.
select is((select count(*)::int from pg_trigger where tgrelid='public.affaire_briefs'::regclass
  and tgfoid='private.guard_intake_brief_confirmation()'::regprocedure and (tgtype & 2)=0),2,
  'both business checks run after row policy enforcement');
insert into public.estimate_projects(id,tenant_id,user_id,name)
values (pg_temp.f(21),pg_temp.f(10),pg_temp.f(1),'Second dossier fictif');
insert into public.affaire_intake_uploads(id,project_id,created_by,status)
values (pg_temp.f(44),pg_temp.f(21),pg_temp.f(1),'deposited');
-- Keep the fixture intact even if a move unexpectedly succeeds.
create function pg_temp.move_result(statement text) returns text language plpgsql as $$
begin
  execute statement;
  raise exception 'move accepted';
exception when others then return sqlerrm;
end;
$$;
select pg_temp.deposit(57,41);
select is(pg_temp.move_result('update public.affaire_intake_documents set upload_id=pg_temp.f(44) where id=pg_temp.f(57)'),
  'INTAKE_SCOPE_IMMUTABLE','a document keeps its original deposit');
select is(pg_temp.move_result('update public.affaire_intake_uploads set project_id=pg_temp.f(21) where id=pg_temp.f(41)'),
  'INTAKE_SCOPE_IMMUTABLE','a deposit and its captured documents keep their affaire');
update public.affaire_intake_documents set classification_status='classified',classification_source='manual' where id=pg_temp.f(57);
select pg_temp.confirm();
select is(pg_temp.move_result('update public.affaire_briefs set project_id=pg_temp.f(21) where id=pg_temp.f(30)'),
  'INTAKE_SCOPE_IMMUTABLE','a confirmed brief belongs to its original affaire');

select pg_temp.deposit(56,41);
create temp table last_press as select * from public.launch_affaire_intake_analysis(pg_temp.f(20),true);
-- The account FK uses SET NULL on deletion. Even this launch keeps its mode; its depositor is still present.
update public.affaire_intake_uploads set created_by=null where id=(select launch_id from last_press);
select results_eq($$select payer_id, read_scans from public.claim_affaire_intake_analysis_launch(pg_temp.f(75))$$,
  $$values (null::uuid,true)$$,'a missing payer stays absent rather than borrowing the depositor’s plan');
update public.affaire_intake_uploads set attempt_count=3,processing_lease_expires_at=now()-interval '1 second' where id=(select launch_id from last_press);
select is((select count(*)::int from public.claim_affaire_intake_analysis_launch(pg_temp.f(76))),0,'an exhausted lease is retired');
select results_eq($$select u.status,d.classification_status from public.affaire_intake_documents d join public.affaire_intake_uploads u on d.analysis_launch_id=u.id
  where d.id=pg_temp.f(56)$$,$$values ('failed'::text,'failed'::text)$$,'exhaustion releases the batch and makes the piece individually retryable');
-- Two outstanding classifications are reserved for deletion. The first deletion fails
-- after the launch stops; the second finishes normally.
select pg_temp.deposit(58,41),pg_temp.deposit(59,42);
create temp table deletion_launch as select launch_id from public.launch_affaire_intake_analysis(pg_temp.f(20),true);
select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(77),(select launch_id from deletion_launch));
update public.affaire_intake_documents set classification_status='processing' where id=pg_temp.f(58);
set local role authenticated;
update public.affaire_intake_documents set deletion_token=pg_temp.f(89),deletion_started_at=now() where id in (pg_temp.f(58),pg_temp.f(59));
reset role;
select ok(public.finish_affaire_intake_upload_attempt((select launch_id from deletion_launch),pg_temp.f(77),'failed',now()),'failed launch closes during deletion');
set local role authenticated;
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where id=pg_temp.f(58);
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null,deleted_at=now(),storage_path=null,
  upload_status='rejected',classification_status='failed',document_priority='secondary' where id=pg_temp.f(59);
reset role;
select results_eq($$select classification_status,analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(58)$$,
  $$values ('awaiting_launch'::text,null::uuid)$$,'cancelled removal returns a visible piece to the next press');
select throws_ok('select pg_temp.confirm()','P0001','INTAKE_ANALYSIS_REQUIRED','a returned piece must be analysed before confirmation');
select results_eq($$select outcome,piece_count from public.launch_affaire_intake_analysis(pg_temp.f(20),false)$$,
  $$values ('launched'::text,1)$$,'only the surviving piece is taken by the next press');
select ok((select deleted_at is not null from public.affaire_intake_documents where id=pg_temp.f(59)),'the successful deletion stays final');
-- Matching release after lease exhaustion, also before a fresh worker is started.
update public.affaire_intake_documents set deletion_token=pg_temp.f(90),deletion_started_at=now() where id=pg_temp.f(58);
update public.affaire_intake_uploads set attempt_count=3 where status='launch_queued' and project_id=pg_temp.f(20);
select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(78));
update public.affaire_intake_documents set deletion_token=null,deletion_started_at=null where id=pg_temp.f(58);
select results_eq($$select classification_status,analysis_launch_id from public.affaire_intake_documents where id=pg_temp.f(58)$$,
  $$values ('awaiting_launch'::text,null::uuid)$$,'exhausted recovery also preserves a cancelled removal');

select * from finish();
rollback;
