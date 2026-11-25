-- Two fictional dossiers. A dialog submits the opaque versions it displayed.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
create function pg_temp.f(n int) returns uuid language sql immutable as $$
  select ('d5103333-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email) values (pg_temp.f(1),'plan-choice@example.test');
update public.tenant_memberships set is_default=false where user_id=pg_temp.f(1);
insert into public.tenants(id,name,slug) values (pg_temp.f(10),'Dossier fictif','plan-choice');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default)
values (pg_temp.f(10),pg_temp.f(1),'engineer',true);
insert into public.estimate_projects(id,tenant_id,user_id,name)
select pg_temp.f(i),pg_temp.f(10),pg_temp.f(1),'Affaire fictive' from generate_series(20,21) i;
insert into public.affaire_briefs(project_id,status,summary,project_object)
select pg_temp.f(i),'a_confirmer','Résumé','Objet' from generate_series(20,21) i;
insert into public.plan_sets(id,project_id,tenant_id,name)
select pg_temp.f(i+10),pg_temp.f(i),pg_temp.f(10),'Plans import' from generate_series(20,21) i;
insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count)
select pg_temp.f(i),pg_temp.f(10),pg_temp.f(s),'Plan-R-1.pdf',
  concat_ws('/',pg_temp.f(10),pg_temp.f(s),pg_temp.f(i),'Plan-R-1.pdf'),'application/pdf',80,1
from (values (40,30),(41,30),(42,31)) v(i,s);
update public.plan_files set metadata=jsonb_build_object('original_file_name',
  case id when pg_temp.f(40) then 'Plan R+1.pdf' else 'Plan R-1.pdf' end)
where plan_set_id=pg_temp.f(30);
update public.feature_flags set enabled=true where tenant_id=pg_temp.f(10) and flag_key='TAKEOFF_MODULE_ENABLED';
insert into private.takeoff_launch_activation(active_from) values(now());
insert into private.takeoff_completion_activation(active_from) values(now());
insert into private.takeoff_plan_dispatch_activation(active_from) values(now());

create function pg_temp.scope(project int, variadic ids int[]) returns jsonb language sql as $$
  select jsonb_object_agg(f.plan_file_id,jsonb_build_object('version',f.plan_version,'sha256',repeat('c',64))) from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(project)) f
  where f.plan_file_id in (select pg_temp.f(n) from unnest(ids) n)
$$;
create function pg_temp.selection() returns jsonb language sql as $$
  select jsonb_build_object('profileId','fixture','model','fixture','hostId','urn:uuid:' || pg_temp.f(90),
    'reasoningEffort',null,'authorizationId','fixture')
$$;
create function pg_temp.confirm(choice jsonb, notice boolean default true, revision timestamptz default null)
returns table(outcome text,request_id uuid,state text,reason_code text,payer_id uuid) language sql as $$
  select c.outcome,c.request_id,c.state,c.reason_code,c.payer_id from public.confirm_affaire_brief_plan_choice(
    pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),
    coalesce(revision,(select updated_at from public.affaire_briefs where project_id=pg_temp.f(20))),choice,
    case when notice then public.takeoff_payer_notice(pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),pg_temp.selection(),true) end,
    case when notice then pg_temp.selection()->>'hostId' end, case when notice then pg_temp.selection() end,
    case when not notice then 'MANDATE_REQUIRED' end,true,jsonb_build_object('sub',pg_temp.f(1))) c
$$;
create function pg_temp.reopen() returns void language sql as $$
  update public.affaire_briefs set status='a_confirmer',confirmed_at=null,confirmed_by=null where project_id=pg_temp.f(20)
$$;
select is((select count(*) from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20))),0::bigint,
  'registered plans whose upload never completed are absent');
insert into storage.objects(bucket_id,name,metadata,version)
select 'plan-files',file_path,jsonb_build_object('size',79),gen_random_uuid()::text
from public.plan_files where tenant_id=pg_temp.f(10);
select is((select count(*) from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20))),0::bigint,
  'a partial object does not complete a reserved plan');
update storage.objects set metadata='{"size":80}' where name in (select file_path from public.plan_files where tenant_id=pg_temp.f(10));
select results_eq($$select plan_name from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20)) order by plan_file_id$$,
  $$values ('Plan R+1.pdf'::text),('Plan R-1.pdf')$$,'display labels distinguish the two floors with the same storage basename');
select is((select plan_name from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(21))),'Plan-R-1.pdf','legacy name fallback');
-- Older completed objects may carry only a Storage ETag.
savepoint etag_only;
update storage.objects set version=null,metadata=metadata || '{"eTag":"etag-a"}'
where name=(select file_path from public.plan_files where id=pg_temp.f(40));
create temporary table original_etag as select plan_version from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20))
where plan_file_id=pg_temp.f(40);
update storage.objects set metadata=metadata || '{"eTag":"etag-b"}' where name=(select file_path from public.plan_files where id=pg_temp.f(40));
select ok((select plan_version from original_etag) <> (select plan_version from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20))
  where plan_file_id=pg_temp.f(40)),'an older object without a generation still detects content replacement by ETag');
update storage.objects set metadata=metadata-'eTag' where name=(select file_path from public.plan_files where id=pg_temp.f(40));
select is((select count(*) from public.takeoff_brief_plan_options(pg_temp.f(10),pg_temp.f(20)) where plan_file_id=pg_temp.f(40)),
  0::bigint,'an object without any verifiable Storage identity is not offered');
rollback to etag_only;
select throws_ok($$select * from pg_temp.confirm(jsonb_set(pg_temp.scope(20,40),array[pg_temp.f(40)::text,'sha256'],'"unattested"'))$$,
  '22023','TAKEOFF_BRIEF_PLAN_CHANGED','a nonempty consent requires a SHA-256 from the service');
select throws_ok($$select * from pg_temp.confirm(pg_temp.scope(21,42))$$,'22023','TAKEOFF_BRIEF_PLAN_CHANGED',
  'a valid plan from another affaire cannot be chosen');
select throws_ok($$select * from public.confirm_affaire_brief_plan_choice(pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),
  now(),'{}',null,p_actor_claims=>jsonb_build_object('sub',pg_temp.f(2)))$$,'42501','TAKEOFF_BRIEF_CONFIRMATION_FORBIDDEN',
  'a mismatched session cannot confirm even without a reading');
select ok(not has_function_privilege('authenticated',
  'public.confirm_affaire_brief_plan_choice(uuid,uuid,uuid,timestamptz,jsonb,text,text,jsonb,text,boolean,jsonb)','EXECUTE')
  and not has_function_privilege('anon','public.takeoff_brief_plan_options(uuid,uuid,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.takeoff_brief_plan_options(uuid,uuid,jsonb)','EXECUTE'),
  'browser roles cannot invoke server operations with arbitrary tenant or actor IDs');
select is((select count(*) from public.takeoff_brief_plan_options(pg_temp.f(11),pg_temp.f(20))),0::bigint,
  'plan options require both tenant and affaire');
create temporary table old_choice as select pg_temp.scope(20,40) choice;
update public.plan_files set metadata=metadata || '{"label":"revised"}' where id=pg_temp.f(40);
select is(pg_temp.scope(20,40),(select choice from old_choice),'editing descriptive metadata preserves the content selection');
update old_choice set choice=pg_temp.scope(20,40);
update storage.objects set version=gen_random_uuid()::text where bucket_id='plan-files'
  and name=(select file_path from public.plan_files where id=pg_temp.f(40));
savepoint replaced_before_confirmation;
select throws_ok($$select * from pg_temp.confirm((select choice from old_choice))$$,'22023','TAKEOFF_BRIEF_PLAN_CHANGED',
  'replacing the displayed version under the same file ID invalidates the choice');
rollback to replaced_before_confirmation;
select is((select status from public.affaire_briefs where project_id=pg_temp.f(20)),'a_confirmer','a stale selection rolls back confirmation');
select results_eq($$select outcome,request_id from pg_temp.confirm('{}',false)$$,$$values ('confirmed'::text,null::uuid)$$,
  'confirm only reserves no start');
select is((select selected_plans from private.takeoff_brief_confirmations where project_id=pg_temp.f(20)),'{}'::jsonb,'the receipt records the opt-out');
select is((select count(*) from public.takeoff_launch_requests where project_id=pg_temp.f(20)),0::bigint,'there is nothing to claim or take over');
select pg_temp.reopen();
update public.affaire_briefs set status='confirme',confirmed_by=pg_temp.f(1),confirmed_at=now() where project_id=pg_temp.f(20);
select is((select count(*) from public.takeoff_launch_requests where project_id=pg_temp.f(20)),0::bigint,
  'direct reconfirmation after the first opt-out cannot reserve an all-plan request');
select pg_temp.reopen();
select results_eq($$select outcome,request_id from public.confirm_affaire_brief_takeoff(pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),
  (select updated_at from public.affaire_briefs where project_id=pg_temp.f(20)),
  public.takeoff_payer_notice(pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),pg_temp.selection(),true),
  pg_temp.selection()->>'hostId',pg_temp.selection(),null,true,jsonb_build_object('sub',pg_temp.f(1)))$$,
  $$values ('confirmed'::text,null::uuid)$$,'even the released RPC with a valid notice respects the first opt-out');
select is((select selected_plans from private.takeoff_brief_confirmations where project_id=pg_temp.f(20)),'{}'::jsonb,
  'a legacy RPC reconfirmation preserves the refusal for future confirmations');
select pg_temp.reopen();
create temporary table choice_revision as select updated_at from public.affaire_briefs where project_id=pg_temp.f(20);
select results_eq($$select outcome,state,payer_id from pg_temp.confirm(pg_temp.scope(20,40))$$,
  $$values ('confirmed'::text,'evaluating'::text,pg_temp.f(1))$$,'the notified member pays for the checked plan');
select results_eq($$select outcome from pg_temp.confirm(pg_temp.scope(20,40),true,(select updated_at from choice_revision))$$,
  $$values ('replayed'::text)$$,'a lost response replays the selected request');
select results_eq($$select outcome from pg_temp.confirm(pg_temp.scope(20,41),true,(select updated_at from choice_revision))$$,
  $$values ('conflict'::text)$$,'a different selection does not replay a confirmation');
select is((select selected_plans from public.takeoff_launch_requests where project_id=pg_temp.f(20)),
  pg_temp.scope(20,40),'the evaluator can recover the exact plan and version');
select pg_temp.reopen();
select results_eq($$select outcome,request_id from pg_temp.confirm('{}',false)$$,$$values ('confirmed'::text,null::uuid)$$,
  'a new opt-out withdraws a previously payable but unadmitted request');
select is((select count(*) from public.claim_takeoff_launch_evaluations(pg_temp.selection()->>'hostId',pg_temp.f(99),5,true)),0::bigint,
  'recovery cannot spend after a later opt-out');
select is((select public.takeoff_launch_request_action(id,pg_temp.f(1)) from public.takeoff_launch_requests where project_id=pg_temp.f(20)),
  'none','no member can take over the withdrawn request');
select results_eq($$select outcome from public.take_on_takeoff_launch_request(pg_temp.f(10),pg_temp.f(20),pg_temp.f(1),
  (select id from public.takeoff_launch_requests where project_id=pg_temp.f(20)),
  (select mandate_revision from public.takeoff_launch_requests where project_id=pg_temp.f(20)),
  'take_on',pg_temp.selection()->>'hostId',pg_temp.selection(),null,true)$$,$$values ('moved'::text)$$,
  'even a fresh takeover command cannot reactivate the opted-out request');
select pg_temp.reopen();
select results_eq($$select state,reason_code,payer_id from pg_temp.confirm(pg_temp.scope(20,41),false)$$,
  $$values ('blocked'::text,'MANDATE_REQUIRED'::text,null::uuid)$$,'a selection without a notice has no payer');
select is((select selected_plans from public.takeoff_launch_requests where project_id=pg_temp.f(20)),
  pg_temp.scope(20,41),'a later takeover can only engage the newly selected plan');
select * from finish();
rollback;
