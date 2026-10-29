begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data)
values('7e000000-0000-4000-8000-000000000001','premetre-processing@example.test','{}');
update public.tenant_memberships set role='engineer'
where user_id='7e000000-0000-4000-8000-000000000001';
insert into public.estimate_projects(id,tenant_id,user_id,name)
select '7e000000-0000-4000-8000-000000000201',tenant_id,user_id,'Preparation processing fixture'
from public.tenant_memberships where user_id='7e000000-0000-4000-8000-000000000001';
insert into public.estimate_versions(id,project_id,version_number)
values('7e000000-0000-4000-8000-000000000301','7e000000-0000-4000-8000-000000000201',1);

create function pg_temp.processing_snapshot(revision_value integer, processing_value jsonb)
returns jsonb language sql as $$
 select jsonb_build_object('schema_version',1,'preparation_revision',revision_value,
   'confirmed_by','7e000000-0000-4000-8000-000000000001','confirmed_at','2026-10-29T08:00:00Z',
   'readiness',jsonb_build_object('can_launch',true),
   'preparation',jsonb_build_object('schema_version',1,
     'destination',jsonb_build_object('kind','analysis_only','estimate_version_id',null),
     'sources','[{"document_id":"upload:fixture-hash","kind":"plan","active":true,"confirmed":true,"plan_set_id":null}]'::jsonb)
     || case when processing_value is null then '{}'::jsonb else jsonb_build_object('processing',processing_value) end)
$$;
create function pg_temp.save_processing(revision_value integer, processing_value jsonb)
returns void language sql as $$
 insert into public.takeoff_preparations(tenant_id,project_id,revision,draft,confirmed_snapshot,confirmed_at,confirmed_by,updated_by)
 select tenant_id,'7e000000-0000-4000-8000-000000000201',revision_value,
   pg_temp.processing_snapshot(revision_value,processing_value)->'preparation',
   pg_temp.processing_snapshot(revision_value,processing_value),'2026-10-29T08:00:00Z',user_id,user_id
 from public.tenant_memberships where user_id='7e000000-0000-4000-8000-000000000001'
 on conflict(tenant_id,project_id) do update set revision=excluded.revision,draft=excluded.draft,
   confirmed_snapshot=excluded.confirmed_snapshot,confirmed_at=excluded.confirmed_at,
   confirmed_by=excluded.confirmed_by,updated_by=excluded.updated_by
$$;
create function pg_temp.processing_insert(job_number integer,level_value public.takeoff_job_level,
 provider_value text default 'gemini',snapshot_value jsonb default null)
returns void language plpgsql as $$
declare
 job_id uuid:=('7e000000-0000-4000-8000-'||lpad(job_number::text,12,'0'))::uuid;
 project_tenant uuid;
 confirmed_value jsonb;
begin
 select tenant_id,confirmed_snapshot into project_tenant,confirmed_value
 from public.takeoff_preparations where project_id='7e000000-0000-4000-8000-000000000201';
 insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by,
   source_file_path,execution_provider,execution_host_id,processing_strategy,preparation_snapshot)
 values(job_id,project_tenant,'7e000000-0000-4000-8000-000000000301',level_value,
   '7e000000-0000-4000-8000-000000000001',project_tenant||'/'||job_id||'/fixture.pdf',provider_value,
   case when provider_value='chatgpt_local' then 'urn:uuid:7e000000-0000-4000-8000-000000000099' else null end,
   'sync',coalesce(snapshot_value,confirmed_value));
end $$;

select pg_temp.save_processing(1,'{"level":"B","provider":"chatgpt"}');
select set_config('request.jwt.claim.sub','7e000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"7e000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
select throws_ok($$select pg_temp.processing_insert(601,'C','chatgpt_local')$$,
 '42501','TAKEOFF_PREPARATION_LEVEL_MISMATCH','a direct client cannot change the confirmed processing level');
select throws_ok($$select pg_temp.processing_insert(601,'B','gemini')$$,
 '42501','TAKEOFF_PREPARATION_PROVIDER_MISMATCH','a direct client cannot replace explicit ChatGPT with Gemini');
select throws_ok($$select pg_temp.processing_insert(601,'C','gemini',pg_temp.processing_snapshot(1,'{"level":"C","provider":"gemini"}'))$$,
 '42501','TAKEOFF_PREPARATION_REQUIRED','a forged snapshot cannot replace the exact persisted confirmation');
select lives_ok($$select pg_temp.processing_insert(601,'B','chatgpt_local')$$,
 'the confirmed ChatGPT choice admits the matching local execution owner');
reset role;
select is((select preparation_snapshot from public.takeoff_jobs where id='7e000000-0000-4000-8000-000000000601'),
 pg_temp.processing_snapshot(1,'{"level":"B","provider":"chatgpt"}'),'admission preserves the complete exact confirmation');
update public.takeoff_jobs set status='failed',completed_at=now() where id='7e000000-0000-4000-8000-000000000601';

select pg_temp.save_processing(2,'{"level":"B","provider":"gemini"}');
set local role authenticated;
select throws_ok($$select pg_temp.processing_insert(602,'B','chatgpt_local')$$,
 '42501','TAKEOFF_PREPARATION_PROVIDER_MISMATCH','a direct client cannot replace explicit Gemini with ChatGPT');
select lives_ok($$select pg_temp.processing_insert(602,'B','gemini')$$,'the confirmed Gemini choice admits Gemini execution');
reset role;
update public.takeoff_jobs set status='failed',completed_at=now() where id='7e000000-0000-4000-8000-000000000602';

select pg_temp.save_processing(3,'{"level":"B","provider":"auto"}');
set local role authenticated;
select lives_ok($$select pg_temp.processing_insert(603,'B','gemini')$$,'automatic provider choice permits a resolved Gemini owner');
select lives_ok($$select pg_temp.processing_insert(604,'B','chatgpt_local')$$,'automatic provider choice permits a resolved local ChatGPT owner');
reset role;
update public.takeoff_jobs set status='failed',completed_at=now()
where id in('7e000000-0000-4000-8000-000000000603','7e000000-0000-4000-8000-000000000604');

select pg_temp.save_processing(4,'{"level":null,"provider":"auto"}');
set local role authenticated;
select lives_ok($$select pg_temp.processing_insert(605,'C')$$,'a legacy unset level remains compatible with historical admission');
reset role;
update public.takeoff_jobs set status='failed',completed_at=now() where id='7e000000-0000-4000-8000-000000000605';
select pg_temp.save_processing(5,null);
set local role authenticated;
select lives_ok($$select pg_temp.processing_insert(606,'A')$$,'a legacy snapshot without processing choices can retain its queued job');
reset role;
select pg_temp.save_processing(6,'null'::jsonb);
set local role authenticated;
select lives_ok($$select pg_temp.processing_insert(607,'C')$$,'an explicit JSON null processing value remains compatible');
reset role;

-- Worker updates use each immutable job snapshot, even after current choices change.
select pg_temp.save_processing(7,'{"level":"B","provider":"chatgpt"}');
set local role service_role;
select lives_ok($$update public.takeoff_jobs set status='processing'
 where id in('7e000000-0000-4000-8000-000000000606','7e000000-0000-4000-8000-000000000607')$$,
 'queued legacy jobs still process after a different level and provider are confirmed');
reset role;
select is((select count(*) from public.takeoff_jobs where status='processing'
 and id in('7e000000-0000-4000-8000-000000000606','7e000000-0000-4000-8000-000000000607')),2::bigint,
 'both forms of legacy processing snapshots reach the real processing state');
select is((select preparation_snapshot from public.takeoff_jobs where id='7e000000-0000-4000-8000-000000000606'),
 pg_temp.processing_snapshot(5,null),'worker processing preserves the legacy snapshot without rewriting it');

insert into public.takeoff_jobs(id,tenant_id,estimate_version_id,level,created_by)
select '7e000000-0000-4000-8000-000000000608',tenant_id,'7e000000-0000-4000-8000-000000000301','A',user_id
from public.tenant_memberships where user_id='7e000000-0000-4000-8000-000000000001';
set local role service_role;
select lives_ok($$update public.takeoff_jobs set status='processing' where id='7e000000-0000-4000-8000-000000000608'$$,
 'an older job with no preparation snapshot still processes');
reset role;
select is((select preparation_snapshot from public.takeoff_jobs where id='7e000000-0000-4000-8000-000000000608'),
 null::jsonb,'the historical null snapshot is preserved');
select * from finish();
rollback;
