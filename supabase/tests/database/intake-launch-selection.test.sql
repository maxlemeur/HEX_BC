begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public,pg_catalog;
select no_plan();
create function pg_temp.f(n integer) returns uuid language sql immutable as $$
  select ('ae5a0000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,email_confirmed_at) values(pg_temp.f(1),'intake-selection@example.test',now());
insert into public.estimate_projects(id,tenant_id,user_id,name) select pg_temp.f(20),tenant_id,user_id,'Fixture'
  from public.tenant_memberships where user_id=pg_temp.f(1) and is_default;
insert into public.affaire_intake_uploads(id,project_id,created_by,status) values(pg_temp.f(30),pg_temp.f(20),pg_temp.f(1),'deposited');
insert into public.affaire_intake_documents(upload_id,file_name,upload_status,classification_status) values(pg_temp.f(30),'A.png','uploaded','awaiting_launch');
select set_config('request.jwt.claim.sub',pg_temp.f(1)::text,true);
set local role authenticated;
select throws_ok($$select public.start_affaire_intake_analysis(pg_temp.f(20),true,null,null)$$,
  '22023','INTAKE_SELECTION_INVALID','a new paid launch needs both authorization identifiers');
create temp table first_press as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true,'profile-A','authorization-A');
select is((select outcome from first_press),'launched','one piece reserved on profile A');
select is((select outcome from public.start_affaire_intake_analysis(pg_temp.f(20),true,'profile-B','authorization-B')),
  'already_running','a second usable profile cannot retarget the active launch');
select ok(not has_function_privilege('authenticated','public.read_affaire_intake_launch_selection(uuid)','execute')
  and not has_function_privilege('anon','public.start_affaire_intake_analysis(uuid,boolean,text,text)','execute'),
  'only the worker can read the saved selection and anonymous callers cannot launch');
reset role;
grant select on first_press to service_role;
set local role service_role;
select count(*) from public.claim_affaire_intake_analysis_launch(pg_temp.f(40),(select launch_id from first_press));
update public.affaire_intake_uploads set processing_lease_expires_at=now()-interval '1 min' where id=(select launch_id from first_press);
select is((select attempt_count from public.claim_affaire_intake_analysis_launch(pg_temp.f(41),(select launch_id from first_press))),2,'a new worker recovers the persisted launch');
select is(public.read_affaire_intake_launch_selection((select launch_id from first_press)),
  '{"profileId":"profile-A","authorizationId":"authorization-A"}'::jsonb,'recovery sees only the original authorization, never the second selection');
update public.affaire_intake_documents set classification_status='classified',document_kind='annexes',analysis_completed_at=now()
  where analysis_launch_id=(select launch_id from first_press);
select public.publish_affaire_intake_brief((select launch_id from first_press),pg_temp.f(41),null,s->>'revision',null,
  '{"summary":"A","project_object":"Fixture"}','[]') from public.read_affaire_intake_brief_inputs(pg_temp.f(20)) s;
select public.finish_affaire_intake_upload_attempt((select launch_id from first_press),pg_temp.f(41),'ready',now());
reset role;
update public.affaire_intake_documents set document_kind='cctp' where analysis_launch_id=(select launch_id from first_press);
set local role authenticated;
create temp table next_press as select * from public.start_affaire_intake_analysis(pg_temp.f(20),true,'profile-B','authorization-B');
select results_eq('select outcome,piece_count from next_press',$$values ('brief_only'::text,0)$$,'a fresh press for the brief needs no reading');
reset role;
select is(public.read_affaire_intake_launch_selection((select launch_id from next_press)),
  '{"profileId":"profile-B","authorizationId":"authorization-B"}'::jsonb,'only the later independent press records the new profile');
select * from finish();
rollback;
