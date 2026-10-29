begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

select ok((select relrowsecurity from pg_class where oid='public.takeoff_preparations'::regclass),'preparations have RLS');
select ok((select relrowsecurity from pg_class where oid='public.takeoff_preparation_profiles'::regclass),'profiles have RLS');
select is(has_table_privilege('anon','public.takeoff_preparations','SELECT'),false,'anonymous preparation access is revoked');
select is(has_table_privilege('authenticated','public.takeoff_preparations','INSERT'),false,'clients cannot forge confirmations');
select is(has_table_privilege('authenticated','public.takeoff_preparations','UPDATE'),false,'clients cannot overwrite revisions');
select is(has_table_privilege('authenticated','public.takeoff_preparation_profiles','INSERT'),false,'profiles use authorized server writes');
select is(has_table_privilege('authenticated','public.takeoff_preparation_profiles','DELETE'),false,'clients cannot delete profiles directly');
insert into auth.users(id,email,raw_user_meta_data)
select ('7d000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'premetre-'||n||'@example.test','{}'::jsonb
from generate_series(1,5)n;
update public.tenant_memberships set is_default=false where user_id::text like '7d000000-%';
insert into public.tenants(id,name,slug) values
('7d000000-0000-4000-8000-000000000101','Premetre fixture','premetre-fixture'),
('7d000000-0000-4000-8000-000000000102','Foreign premetre fixture','premetre-foreign');
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
select '7d000000-0000-4000-8000-000000000101',('7d000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  (case n when 1 then 'engineer' when 2 then 'admin' when 3 then 'director' when 4 then 'viewer' else 'engineer' end)::public.tenant_role,
  true,'2020-01-01' from generate_series(1,5)n;
insert into public.tenant_memberships(tenant_id,user_id,role,is_default,created_at)
values('7d000000-0000-4000-8000-000000000102','7d000000-0000-4000-8000-000000000001','engineer',false,'2021-01-01');
insert into public.estimate_projects(id,tenant_id,user_id,name) values
('7d000000-0000-4000-8000-000000000201','7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000001','Owned preparation'),
('7d000000-0000-4000-8000-000000000202','7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000005','Other preparation'),
('7d000000-0000-4000-8000-000000000203','7d000000-0000-4000-8000-000000000102','7d000000-0000-4000-8000-000000000001','Foreign tenant preparation');
insert into public.estimate_versions(id,project_id,version_number)
values('7d000000-0000-4000-8000-000000000301','7d000000-0000-4000-8000-000000000201',1),
('7d000000-0000-4000-8000-000000000302','7d000000-0000-4000-8000-000000000201',2),
('7d000000-0000-4000-8000-000000000303','7d000000-0000-4000-8000-000000000203',1);
insert into public.plan_sets(id,tenant_id,project_id,name)
values('7d000000-0000-4000-8000-000000000401','7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000201','Selected plans');
insert into public.plan_files(id,tenant_id,plan_set_id,file_name,file_path,file_type,file_size_bytes,page_count)
values('7d000000-0000-4000-8000-000000000501','7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000401',
 'fixture.pdf','7d000000-0000-4000-8000-000000000101/7d000000-0000-4000-8000-000000000401/7d000000-0000-4000-8000-000000000501/fixture.pdf','application/pdf',8,1);

create function pg_temp.prep_snapshot(rev integer, plan_source boolean default false, destination uuid default null)
returns jsonb language sql as $$
select jsonb_build_object('schema_version',1,'preparation_revision',rev,
 'confirmed_by','7d000000-0000-4000-8000-000000000001','confirmed_at','2026-10-29T00:00:00Z',
 'readiness',jsonb_build_object('can_launch',true),
 'preparation',jsonb_build_object('schema_version',1,'destination',jsonb_build_object(
   'kind',case when destination is null then 'analysis_only' else 'estimate_review' end,'estimate_version_id',destination),
   'sources',case when plan_source then (select jsonb_build_array(jsonb_build_object(
     'document_id',id,'kind','plan','active',true,'confirmed',true,'plan_set_id',plan_set_id,
     'file_path',file_path,'page_count',page_count,'source_updated_at',updated_at))
     from public.plan_files where id='7d000000-0000-4000-8000-000000000501')
   else '[{"document_id":"upload:fixture-hash","kind":"dpgf","active":true,"confirmed":true}]'::jsonb end))
$$;
create function pg_temp.prep_insert_job(job_number integer, snapshot_value jsonb, plan_source boolean default false, version_number integer default 301)
returns void language plpgsql as $$
declare job_id uuid:=('7d000000-0000-4000-8000-'||lpad(job_number::text,12,'0'))::uuid;
begin
 insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by,source_file_path,plan_set_id,preparation_snapshot)
 values(job_id,'7d000000-0000-4000-8000-000000000101',('7d000000-0000-4000-8000-'||lpad(version_number::text,12,'0'))::uuid,
 case when plan_source then 'B' else 'A' end::public.takeoff_job_level,'7d000000-0000-4000-8000-000000000001',
 case when plan_source then null else '7d000000-0000-4000-8000-000000000101/'||job_id||'/fixture.csv' end,
 case when plan_source then '7d000000-0000-4000-8000-000000000401'::uuid else null end,snapshot_value);
end $$;
create function pg_temp.prep_insert_version_receipt(receipt_number integer,
 source_version_number integer default 301, revision_value integer default 6,
 tenant_number integer default 101, project_number integer default 201, actor_number integer default 2)
returns void language sql as $$
 insert into public.audit_logs(id,tenant_id,user_id,table_name,record_id,estimate_version_id,action,after_data)
 values(('7d000000-0000-4000-8000-'||lpad(receipt_number::text,12,'0'))::uuid,
 ('7d000000-0000-4000-8000-'||lpad(tenant_number::text,12,'0'))::uuid,
 ('7d000000-0000-4000-8000-'||lpad(actor_number::text,12,'0'))::uuid,'estimate_versions',
 '7d000000-0000-4000-8000-000000000302',
 ('7d000000-0000-4000-8000-'||lpad((case when tenant_number=102 then 303 else 302 end)::text,12,'0'))::uuid,
 'takeoff.preparation.version_created',jsonb_build_object('schema_version',1,
   'project_id',('7d000000-0000-4000-8000-'||lpad(project_number::text,12,'0')),
   'source_version_id',('7d000000-0000-4000-8000-'||lpad(source_version_number::text,12,'0')),
   'target_version_id','7d000000-0000-4000-8000-000000000302','preparation_revision',revision_value));
$$;
insert into public.takeoff_preparations(tenant_id,project_id,draft,updated_by)
values('7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000201','{}','7d000000-0000-4000-8000-000000000001'),
('7d000000-0000-4000-8000-000000000101','7d000000-0000-4000-8000-000000000202','{}','7d000000-0000-4000-8000-000000000005');
insert into public.takeoff_preparation_profiles(tenant_id,name,profile,created_by,updated_by)
values('7d000000-0000-4000-8000-000000000101','Shared conventions','{}','7d000000-0000-4000-8000-000000000001','7d000000-0000-4000-8000-000000000001');
-- Service-seeded historical jobs stay nullable and can finish after rollout.
select lives_ok($$select pg_temp.prep_insert_job(601,null)$$,'historical fixture accepts null snapshot');
select lives_ok($$update public.takeoff_jobs set status='processing' where id='7d000000-0000-4000-8000-000000000601'$$,'historical jobs can still process');
select throws_ok($$update public.takeoff_jobs set preparation_snapshot='{}' where id='7d000000-0000-4000-8000-000000000601'$$,'42501','TAKEOFF_JOB_PREPARATION_IMMUTABLE','historical identity cannot be rewritten');
select throws_ok($$update public.takeoff_preparations set revision=3 where project_id='7d000000-0000-4000-8000-000000000201'$$,
 '40001','TAKEOFF_PREPARATION_REVISION_CONFLICT','revision jumps are rejected');
with changed as (update public.takeoff_preparations set revision=2,draft='{"decision":"saved"}' where project_id='7d000000-0000-4000-8000-000000000201' and revision=1 returning revision)
select is((select count(*) from changed),1::bigint,'first CAS draft save succeeds');
with changed as (update public.takeoff_preparations set revision=2,draft='{"decision":"stale"}' where project_id='7d000000-0000-4000-8000-000000000201' and revision=1 returning revision)
select is((select count(*) from changed),0::bigint,'stale CAS save cannot overwrite a newer decision');

select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7d000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select is((select count(*) from public.takeoff_preparations),1::bigint,'engineer reads only own project preparation');
select is((select count(*) from public.takeoff_preparation_profiles),1::bigint,'tenant profiles are shared with members');
select throws_ok($$select pg_temp.prep_insert_job(602,null)$$,'42501','TAKEOFF_PREPARATION_REQUIRED','direct client insert cannot bypass confirmation');
select throws_ok($$select pg_temp.prep_insert_job(602,'{"readiness":{"can_launch":true}}')$$,'42501','TAKEOFF_PREPARATION_REQUIRED','forged readiness JSON is rejected');
select throws_ok($$update public.takeoff_preparations set confirmed_snapshot='{}'$$,'42501',null,'clients cannot forge persisted confirmations');
reset role;

update public.takeoff_preparations set revision=3,draft=pg_temp.prep_snapshot(3)->'preparation',confirmed_snapshot=pg_temp.prep_snapshot(3),
 confirmed_at='2026-10-29T00:00:00Z',confirmed_by=updated_by where project_id='7d000000-0000-4000-8000-000000000201';
set local role authenticated;
select lives_ok($$select pg_temp.prep_insert_job(603,pg_temp.prep_snapshot(3))$$,'exact confirmed snapshot admits a new job');
reset role;
select is((select preparation_snapshot->'preparation_revision' from public.takeoff_jobs where id='7d000000-0000-4000-8000-000000000603'),'3'::jsonb,'job persists the reviewed revision');
update public.takeoff_preparations set revision=4,confirmed_snapshot=null,confirmed_at=null,confirmed_by=null,draft='{"decision":"changed"}' where project_id='7d000000-0000-4000-8000-000000000201';
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(604,pg_temp.prep_snapshot(3))$$,'42501','TAKEOFF_PREPARATION_REQUIRED','saving a new draft invalidates the old launch snapshot');
reset role;
select is((select preparation_snapshot->'preparation_revision' from public.takeoff_jobs where id='7d000000-0000-4000-8000-000000000603'),'3'::jsonb,'later draft changes preserve a running job snapshot');

update public.takeoff_preparations set revision=5,draft=pg_temp.prep_snapshot(5,true,'7d000000-0000-4000-8000-000000000301')->'preparation',
 confirmed_snapshot=pg_temp.prep_snapshot(5,true,'7d000000-0000-4000-8000-000000000301'),confirmed_at='2026-10-29T00:00:00Z',confirmed_by=updated_by
 where project_id='7d000000-0000-4000-8000-000000000201';
set local role authenticated;
select lives_ok($$select pg_temp.prep_insert_job(605,pg_temp.prep_snapshot(5,true,'7d000000-0000-4000-8000-000000000301'),true)$$,'confirmed plan sources match the selected plan set');
select throws_ok($$select pg_temp.prep_insert_job(606,pg_temp.prep_snapshot(5,true,'7d000000-0000-4000-8000-000000000301'),true)$$,
 '23505',null,'different request IDs cannot duplicate the same prepared target receipt');
reset role;
update public.takeoff_preparations set revision=6,draft=pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301')->'preparation',
 confirmed_snapshot=pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),confirmed_at='2026-10-29T00:00:00Z',confirmed_by=updated_by
 where project_id='7d000000-0000-4000-8000-000000000201';
set local role authenticated;
select lives_ok($$select pg_temp.prep_insert_job(607,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true)$$,
 'a deliberately confirmed new revision can create another analysis for the same target');
select throws_ok($$select pg_temp.prep_insert_job(606,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 '42501','TAKEOFF_PREPARATION_DESTINATION_MISMATCH','confirmation cannot launch into a different estimate version');
select throws_ok($$select pg_temp.prep_insert_version_receipt(701,301,6,101,201,1)$$,'42501',null,
 'authenticated clients cannot forge a server-created version receipt');
reset role;
select is((select parent_version_id from public.estimate_versions where id='7d000000-0000-4000-8000-000000000302'),null::uuid,
 'a normal copy is independent of variant parent semantics');
select pg_temp.prep_insert_version_receipt(702,302);
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(608,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 '42501','TAKEOFF_PREPARATION_DESTINATION_MISMATCH','a receipt for another source version does not authorize the copy');
reset role;
select pg_temp.prep_insert_version_receipt(703,301,6,102);
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(608,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 '42501','TAKEOFF_PREPARATION_DESTINATION_MISMATCH','a receipt from another tenant does not authorize the copy');
reset role;
select pg_temp.prep_insert_version_receipt(704,301,5);
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(608,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 '42501','TAKEOFF_PREPARATION_DESTINATION_MISMATCH','a receipt from an older preparation revision does not authorize the copy');
reset role;
select pg_temp.prep_insert_version_receipt(705,301,6,101,202);
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(608,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 '42501','TAKEOFF_PREPARATION_DESTINATION_MISMATCH','a receipt from another project does not authorize the copy');
reset role;
select pg_temp.prep_insert_version_receipt(706);
set local role authenticated;
select lives_ok($$select pg_temp.prep_insert_job(608,pg_temp.prep_snapshot(6,true,'7d000000-0000-4000-8000-000000000301'),true,302)$$,
 'a normal copy with a valid trusted receipt admits its prepared analysis');
reset role;
update public.plan_files set page_count=2 where id='7d000000-0000-4000-8000-000000000501';
set local role authenticated;
select throws_ok($$select pg_temp.prep_insert_job(606,(select confirmed_snapshot from public.takeoff_preparations where project_id='7d000000-0000-4000-8000-000000000201'),true)$$,
 '42501','TAKEOFF_PREPARATION_SOURCE_STALE','source metadata changes invalidate launch under the database lock');
reset role;
update public.tenant_memberships set role='viewer' where user_id='7d000000-0000-4000-8000-000000000001';
select throws_ok($$update public.takeoff_preparations set revision=7,confirmed_snapshot=null,confirmed_at=null,confirmed_by=null where project_id='7d000000-0000-4000-8000-000000000201'$$,
 '42501','TAKEOFF_PREPARATION_WRITE_FORBIDDEN','server writes recheck a revoked operator role');
set local role authenticated;
select is((select count(*) from public.takeoff_preparations),1::bigint,'a downgraded owner retains read access');
select throws_ok($$select pg_temp.prep_insert_job(606,null)$$,'42501',null,'a downgraded owner cannot launch');
reset role;

select set_config('request.jwt.claim.sub','7d000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7d000000-0000-4000-8000-000000000003"}',true);
set local role authenticated;
select is((select count(*) from public.takeoff_preparations),2::bigint,'director can review tenant project preparations');
select is((select count(*) from public.takeoff_preparation_profiles),1::bigint,'director can reuse shared conventions');
reset role;
update public.tenants set is_active=false where id='7d000000-0000-4000-8000-000000000101';
set local role authenticated;
select is((select count(*) from public.takeoff_preparations),0::bigint,'inactive tenant has no preparation visibility');
select is((select count(*) from public.takeoff_preparation_profiles),0::bigint,'inactive tenant has no profile visibility');
reset role;
select * from finish();
rollback;
