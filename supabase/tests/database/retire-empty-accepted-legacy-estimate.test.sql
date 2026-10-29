begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','79000000-0000-4000-8000-000000000001','authenticated','authenticated','retire-legacy@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),'','','','');
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','79000000-0000-4000-8000-000000000002','authenticated','authenticated','retire-other@example.test','',now(),'{}'::jsonb,'{}'::jsonb,now(),now(),'','','','');

create temp table retire_fixture as
select tm.tenant_id,tm.user_id from public.tenant_memberships tm
where tm.user_id='79000000-0000-4000-8000-000000000001' and tm.is_default;
grant select on retire_fixture to service_role, authenticated, anon;

insert into public.estimate_projects(id,tenant_id,user_id,name,is_archived)
select x.project_id,f.tenant_id,f.user_id,x.name,false from retire_fixture f cross join (values
  ('79000000-0000-4000-8000-000000000010'::uuid,'empty accepted fixture'),
  ('79000000-0000-4000-8000-000000000020'::uuid,'sealed accepted fixture'),
  ('79000000-0000-4000-8000-000000000030'::uuid,'accepted with line fixture'),
  ('79000000-0000-4000-8000-000000000040'::uuid,'coverage reference fixture')
) x(project_id,name);

select set_config('miaouffrage.estimate_version_insert_contract','legacy_v1',true);
insert into public.estimate_versions(id,tenant_id,project_id,version_number,status,calc_engine_version,seal_hash,seal_payload_version)
select x.version_id,f.tenant_id,x.project_id,1,'accepted'::public.estimate_status,1,x.seal,null
from retire_fixture f cross join (values
  ('79000000-0000-4000-8000-000000000011'::uuid,'79000000-0000-4000-8000-000000000010'::uuid,null::text),
  ('79000000-0000-4000-8000-000000000021'::uuid,'79000000-0000-4000-8000-000000000020'::uuid,repeat('a',64)),
  ('79000000-0000-4000-8000-000000000031'::uuid,'79000000-0000-4000-8000-000000000030'::uuid,null::text),
  ('79000000-0000-4000-8000-000000000041'::uuid,'79000000-0000-4000-8000-000000000040'::uuid,null::text)
) x(version_id,project_id,seal);
select set_config('miaouffrage.estimate_version_insert_contract','',true);

-- Synthetic historical row: creation GUC avoids changing an accepted parent.
select set_config('miaouffrage.estimate_creation_atomic','79000000-0000-4000-8000-000000000031',true);
insert into public.estimate_items(id,tenant_id,version_id,item_type,position,title,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,k_mo,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
select '79000000-0000-4000-8000-000000000032',f.tenant_id,'79000000-0000-4000-8000-000000000031','line',1,'historical line',1,100,2000,1,0,1,100,100,20,120
from retire_fixture f;
select set_config('miaouffrage.estimate_creation_atomic','',true);

insert into public.plan_sets(id,tenant_id,project_id,estimate_version_id,name,created_by)
select '79000000-0000-4000-8000-000000000012',f.tenant_id,'79000000-0000-4000-8000-000000000010','79000000-0000-4000-8000-000000000011','plans fixture',f.user_id from retire_fixture f;
insert into public.plan_files(id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,created_by)
select '79000000-0000-4000-8000-000000000013',f.tenant_id,'79000000-0000-4000-8000-000000000012',f.tenant_id::text||'/79000000-0000-4000-8000-000000000012/79000000-0000-4000-8000-000000000013/fictif.pdf','fictif.pdf','application/pdf',10,f.user_id from retire_fixture f;
-- Storage metadata fixture only: no claim about physical bytes.
insert into storage.objects (bucket_id,name,metadata)
select 'plan-files',file_path,'{"size":10}'::jsonb from public.plan_files where id='79000000-0000-4000-8000-000000000013';
insert into public.estimate_version_events(id,tenant_id,estimate_version_id,event_type,created_by,metadata)
select '79000000-0000-4000-8000-000000000014',f.tenant_id,'79000000-0000-4000-8000-000000000011','approval_rules_evaluated',f.user_id,'{"fixture":true}'::jsonb from retire_fixture f;

create temp table guard_before as
select pg_get_functiondef(p.oid) as ddl,p.proacl::text as acl,p.proowner as owner
from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure;
create temp table target_audit_before as
select id,to_jsonb(a)-'estimate_version_id' as data from public.audit_logs a
where estimate_version_id='79000000-0000-4000-8000-000000000011';
create temp table target_file_before as
select to_jsonb(pf) as data from public.plan_files pf where id='79000000-0000-4000-8000-000000000013';
create temp table target_project_before as
select to_jsonb(p) as data from public.estimate_projects p where id='79000000-0000-4000-8000-000000000010';
grant select on guard_before,target_audit_before,target_file_before,target_project_before to service_role,authenticated,anon;

create function pg_temp.call_retire(p_version uuid,p_project uuid) returns jsonb language sql as $$
  select private.retire_empty_accepted_legacy_estimate(
    (select tenant_id from retire_fixture),p_project,p_version,
    '79000000-0000-4000-8000-000000000012', '79000000-0000-4000-8000-000000000013',
    array['79000000-0000-4000-8000-000000000014'::uuid],
    coalesce((select array_agg(id order by id) from target_audit_before),'{}'::uuid[]));
$$;

select ok(not has_function_privilege('anon','private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])','execute'),'anonymous cannot execute maintenance RPC');
select ok(not has_function_privilege('authenticated','private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])','execute'),'authenticated cannot execute maintenance RPC');
select ok(not has_function_privilege('service_role','private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])','execute'),'service role cannot execute maintenance function');
select ok(has_function_privilege('postgres','private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])','execute'),'postgres owns the maintenance function');

-- An unexpected owner must fail before acquiring locks or changing data.
grant usage, create on schema private to service_role;
alter function private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]) owner to service_role;
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'55000','LEGACY_RETIRE_OWNER_MISMATCH','unexpected function owner fails closed');
alter function private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]) owner to postgres;
revoke usage, create on schema private from service_role;
revoke all on function private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[]) from public, anon, authenticated, service_role;

select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'55000','LEGACY_RETIRE_OWNER_MISMATCH','inherited authenticated identity is refused');
select set_config('request.jwt.claim.sub','',true);

set local role anon;
select throws_ok($$ select private.retire_empty_accepted_legacy_estimate(null,null,null,null,null,null,null) $$,'42501','permission denied for schema private','anonymous call is refused');
reset role;
set local role authenticated;
select throws_ok($$ select private.retire_empty_accepted_legacy_estimate(null,null,null,null,null,null,null) $$,'42501','permission denied for schema private','authenticated call is refused');
reset role;
set local role service_role;
select throws_ok($$ select private.retire_empty_accepted_legacy_estimate(null,null,null,null,null,null,null) $$,'42501','permission denied for schema private','service-role call is refused');
reset role;

select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000021','79000000-0000-4000-8000-000000000020') $$,'22023','LEGACY_RETIRE_TARGET_MISMATCH','sealed accepted version is refused');
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000031','79000000-0000-4000-8000-000000000030') $$,'22023','LEGACY_RETIRE_NOT_EMPTY_OR_NOT_SOLE_VERSION','accepted version with line is refused');
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000020') $$,'22023','LEGACY_RETIRE_TARGET_MISMATCH','wrong project identity is refused');

insert into private.estimate_purchase_receipts(tenant_id,source_version_id,idempotency_key,created_by,request_payload,review_snapshot,result)
select tenant_id,'79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000091',user_id,'{}'::jsonb,'[]'::jsonb,'{}'::jsonb from retire_fixture;
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'22023','LEGACY_RETIRE_UNREVIEWED_REFERENCE','purchase receipt without FK prevents deletion');
delete from private.estimate_purchase_receipts where idempotency_key='79000000-0000-4000-8000-000000000091';
insert into private.estimate_purchase_transfers(tenant_id,source_version_id,source_item_id,item_title,purchase_order_id,reference,quantity,created_by)
select tenant_id,'79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000092','fixture','79000000-0000-4000-8000-000000000093','fixture',1,user_id from retire_fixture;
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'22023','LEGACY_RETIRE_UNREVIEWED_REFERENCE','purchase transfer without FK prevents deletion');
delete from private.estimate_purchase_transfers where source_item_id='79000000-0000-4000-8000-000000000092';
insert into private.estimate_source_coverage_events(project_id,version_identity,entity_id,entity_revision,operation_key,operation,canonical_request,actor_id)
select '79000000-0000-4000-8000-000000000040','79000000-0000-4000-8000-000000000041','79000000-0000-4000-8000-000000000094',1,'79000000-0000-4000-8000-000000000095','fixture','{}'::jsonb,user_id from retire_fixture;
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000041','79000000-0000-4000-8000-000000000040') $$,'22023','LEGACY_RETIRE_UNREVIEWED_REFERENCE','coverage event without FK prevents deletion');

create table public.retire_unreviewed_reference_fixture(id uuid primary key,version_id uuid references public.estimate_versions(id));
insert into public.retire_unreviewed_reference_fixture values('79000000-0000-4000-8000-000000000099','79000000-0000-4000-8000-000000000011');
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'22023','LEGACY_RETIRE_UNREVIEWED_REFERENCE','unreviewed FK prevents deletion');
drop table public.retire_unreviewed_reference_fixture;

create table public.retire_unreviewed_event_reference_fixture(id uuid primary key,event_id uuid references public.estimate_version_events(id) on delete cascade);
insert into public.retire_unreviewed_event_reference_fixture values('79000000-0000-4000-8000-000000000097','79000000-0000-4000-8000-000000000014');
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'22023','LEGACY_RETIRE_UNREVIEWED_EVENT_REFERENCE','event FK prevents deletion');
drop table public.retire_unreviewed_event_reference_fixture;

-- Force an error after the temporary guard replacement. PostgreSQL rolls the
-- function call back to the pgTAP savepoint, including DDL and plan detachment.
create function pg_temp.force_delete_failure() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001',message='RETIRE_TEST_FORCED_FAILURE'; end;
$$;
create trigger zzz_retire_test_forced_failure before delete on public.estimate_versions
for each row execute function pg_temp.force_delete_failure();
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'P0001','RETIRE_TEST_FORCED_FAILURE','failure after guard replacement rolls back');
select is((select pg_get_functiondef(p.oid) from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select ddl from guard_before),'guard body restored after failed call');
select is((select p.proacl::text from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select acl from guard_before),'guard ACL restored after failed call');
select is((select p.proowner from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select owner from guard_before),'guard owner restored after failed call');
select ok(exists(select 1 from public.estimate_versions where id='79000000-0000-4000-8000-000000000011'),'target remains after failed call');
select is((select estimate_version_id from public.plan_sets where id='79000000-0000-4000-8000-000000000012'),'79000000-0000-4000-8000-000000000011'::uuid,'plan link restored after failed call');
select ok(not has_function_privilege('service_role','private.retire_empty_accepted_legacy_estimate(uuid,uuid,uuid,uuid,uuid,uuid[],uuid[])','execute'),'failed call does not grant service access');
select ok(exists(select 1 from public.estimate_version_events where id='79000000-0000-4000-8000-000000000014'),'event restored after failed call');
select ok(not exists(select 1 from target_audit_before before left join public.audit_logs a on a.id=before.id where a.id is null or to_jsonb(a)-'estimate_version_id' is distinct from before.data),'audit unchanged after failed call');
drop trigger zzz_retire_test_forced_failure on public.estimate_versions;

-- Exercise the separate production-like case where a valid plan descriptor
-- points to no Storage catalog row. The nested exception rolls this scenario
-- back, including the synthetic metadata deletion and the one-shot marker, so
-- the existing positive test with a Storage row remains independent below.
create function pg_temp.probe_retire_without_storage() returns jsonb language plpgsql as $probe$
declare
  v_plan_before jsonb;
  v_file_before jsonb;
  v_project_before jsonb;
  v_storage_before integer;
  v_outcome jsonb;
begin
  begin
    perform set_config('storage.allow_delete_query','true',true);
    delete from storage.objects where bucket_id='plan-files' and name=(
      select file_path from public.plan_files where id='79000000-0000-4000-8000-000000000013'
    );
    select count(*)::integer into v_storage_before from storage.objects where name=(
      select file_path from public.plan_files where id='79000000-0000-4000-8000-000000000013'
    );
    select to_jsonb(ps)-array['estimate_version_id','updated_at'] into v_plan_before
      from public.plan_sets ps where id='79000000-0000-4000-8000-000000000012';
    select to_jsonb(pf) into v_file_before from public.plan_files pf where id='79000000-0000-4000-8000-000000000013';
    select to_jsonb(p) into v_project_before from public.estimate_projects p where id='79000000-0000-4000-8000-000000000010';
    perform pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010');
    select jsonb_build_object(
      'storage_before', v_storage_before,
      'storage_after', (select count(*)::integer from storage.objects where name=(
        select file_path from public.plan_files where id='79000000-0000-4000-8000-000000000013')),
      'version_removed', not exists(select 1 from public.estimate_versions where id='79000000-0000-4000-8000-000000000011'),
      'project_preserved', (select to_jsonb(p) from public.estimate_projects p where id='79000000-0000-4000-8000-000000000010') is not distinct from v_project_before,
      'plan_preserved', (select to_jsonb(ps)-array['estimate_version_id','updated_at'] from public.plan_sets ps where id='79000000-0000-4000-8000-000000000012') is not distinct from v_plan_before,
      'plan_detached', exists(select 1 from public.plan_sets where id='79000000-0000-4000-8000-000000000012' and estimate_version_id is null and project_id='79000000-0000-4000-8000-000000000010'),
      'file_preserved', (select to_jsonb(pf) from public.plan_files pf where id='79000000-0000-4000-8000-000000000013') is not distinct from v_file_before,
      'audit_preserved', not exists(select 1 from target_audit_before b left join public.audit_logs a on a.id=b.id where a.id is null or to_jsonb(a)-'estimate_version_id' is distinct from b.data),
      'guard_restored', (select pg_get_functiondef(p.oid) from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure) = (select ddl from guard_before)
    ) into v_outcome;
    raise exception using errcode='P0001',message='RETIRE_TEST_NO_STORAGE_ROLLBACK';
  exception when raise_exception then
    if sqlerrm <> 'RETIRE_TEST_NO_STORAGE_ROLLBACK' then raise; end if;
  end;
  return v_outcome;
end;
$probe$;
create temp table retire_no_storage_result as select pg_temp.probe_retire_without_storage() as outcome;
select is((select (outcome->>'storage_before')::integer from retire_no_storage_result),0,'no Storage object exists before maintenance');
select is((select (outcome->>'storage_after')::integer from retire_no_storage_result),0,'no Storage object is created by maintenance');
select ok((select (outcome->>'version_removed')::boolean from retire_no_storage_result),'empty accepted version is retired without a Storage object');
select ok((select (outcome->>'project_preserved')::boolean from retire_no_storage_result),'affaire metadata is unchanged without a Storage object');
select ok((select (outcome->>'plan_preserved')::boolean and (outcome->>'plan_detached')::boolean from retire_no_storage_result),'plan set metadata is preserved and detached without a Storage object');
select ok((select (outcome->>'file_preserved')::boolean from retire_no_storage_result),'plan file metadata is preserved without a Storage object');
select ok((select (outcome->>'audit_preserved')::boolean and (outcome->>'guard_restored')::boolean from retire_no_storage_result),'audit and guard are preserved without a Storage object');
select ok(exists(select 1 from public.estimate_versions where id='79000000-0000-4000-8000-000000000011')
  and exists(select 1 from public.plan_sets where id='79000000-0000-4000-8000-000000000012' and estimate_version_id='79000000-0000-4000-8000-000000000011')
  and exists(select 1 from storage.objects o join public.plan_files pf on pf.file_path=o.name where pf.id='79000000-0000-4000-8000-000000000013' and o.bucket_id='plan-files'),
  'no-object probe rolls back and restores the independent Storage fixture');

-- Independent PostgreSQL session observes the original guard while the
-- maintenance transaction has temporarily replaced it. Its conflicting write
-- must wait behind the table lock even if no matching estimate row exists.
create extension if not exists dblink with schema extensions;
select is(extensions.dblink_connect('retire_witness',
  format('host=%s port=%s dbname=%s user=postgres password=postgres',
    trim(split_part(current_setting('unix_socket_directories'), ',', 1)),current_setting('port'),current_database())), 'OK', 'independent witness session connected');
select is(extensions.dblink_exec('retire_witness', $$set lock_timeout = '250ms'$$),
  'SET', 'witness has bounded lock wait');
create temp table retire_witness_results(guard_is_original boolean, conflicting_write_blocked boolean, storage_write_blocked boolean);
create function pg_temp.observe_concurrent_guard() returns trigger language plpgsql as $witness$
declare witnessed text; outcome text; problem text; storage_outcome text; storage_problem text;
begin
  select observed.hash into witnessed
    from extensions.dblink('retire_witness',
      $$select md5(pg_get_functiondef('public.guard_estimate_versions_delete_draft_only()'::regprocedure))$$)
      as observed(hash text);
  outcome := extensions.dblink_exec('retire_witness',
    'update public.estimate_versions set updated_at=updated_at where false', false);
  problem := extensions.dblink_error_message('retire_witness');
  storage_outcome := extensions.dblink_exec('retire_witness',
    'update storage.objects set metadata=metadata where false', false);
  storage_problem := extensions.dblink_error_message('retire_witness');
  insert into retire_witness_results values (
    witnessed = (select md5(ddl) from guard_before),
    outcome = 'ERROR' and problem like '%lock timeout%',
    storage_outcome = 'ERROR' and storage_problem like '%lock timeout%');
  return old;
end;
$witness$;
create trigger zzz_retire_test_observe before delete on public.estimate_versions
for each row execute function pg_temp.observe_concurrent_guard();

select lives_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'postgres retires exact empty unsealed version');
select throws_ok($$ select pg_temp.call_retire('79000000-0000-4000-8000-000000000011','79000000-0000-4000-8000-000000000010') $$,'42501','LEGACY_RETIRE_ALREADY_CONSUMED','replay of the removed target is rejected');
select ok((select guard_is_original from retire_witness_results),'concurrent session sees only original guard during replacement');
select ok((select conflicting_write_blocked from retire_witness_results),'concurrent writer is blocked until maintenance transaction ends');
select ok((select storage_write_blocked from retire_witness_results),'concurrent storage metadata writer is blocked until maintenance transaction ends');
select is(extensions.dblink_disconnect('retire_witness'),'OK','witness session disconnected');
drop trigger zzz_retire_test_observe on public.estimate_versions;
select ok(not exists(select 1 from public.estimate_versions where id='79000000-0000-4000-8000-000000000011'),'target version removed');
select ok(exists(select 1 from public.estimate_projects where id='79000000-0000-4000-8000-000000000010'),'affaire remains');
select is((select to_jsonb(p) from public.estimate_projects p where id='79000000-0000-4000-8000-000000000010'),(select data from target_project_before),'affaire is byte-for-byte unchanged');
select ok(not exists(select 1 from public.estimate_version_events where id='79000000-0000-4000-8000-000000000014'),'original event row cascades only after its audit snapshot');
select ok(not exists(select 1 from public.audit_logs a where a.id in (select id from target_audit_before) and a.estimate_version_id is not null),'preserved audits have no orphan version reference');
select ok(exists(select 1 from public.plan_sets where id='79000000-0000-4000-8000-000000000012' and estimate_version_id is null and project_id='79000000-0000-4000-8000-000000000010'),'plan set remains on affaire');
select is((select to_jsonb(pf) from public.plan_files pf where id='79000000-0000-4000-8000-000000000013'),(select data from target_file_before),'plan file metadata unchanged');
select ok(exists(select 1 from storage.objects o join public.plan_files pf on pf.file_path=o.name where pf.id='79000000-0000-4000-8000-000000000013' and o.bucket_id='plan-files'),'existing Storage metadata preserved');
select ok(not exists(select 1 from target_audit_before before left join public.audit_logs a on a.id=before.id where a.id is null or to_jsonb(a)-'estimate_version_id' is distinct from before.data),'all prior audit records preserved');
select ok(exists(select 1 from public.audit_logs a where a.record_id='79000000-0000-4000-8000-000000000014' and a.table_name='estimate_version_events' and a.action='INSERT' and a.after_data->>'id'='79000000-0000-4000-8000-000000000014' and a.estimate_version_id is null),'event identity and full payload preserved in audit');
select ok(exists(select 1 from public.audit_logs a where a.record_id='79000000-0000-4000-8000-000000000011' and a.table_name='estimate_version_maintenance' and a.user_id is null and a.after_data->>'actor'='postgres_maintenance'),'maintenance audit records postgres maintenance actor');
select is((select count(*)::integer from public.audit_logs a where a.record_id='79000000-0000-4000-8000-000000000011' and a.table_name='estimate_versions' and a.action='DELETE' and a.user_id is null and a.before_data->>'id'='79000000-0000-4000-8000-000000000011'),1,'automatic deletion audit is attributed to the system');
select is((select pg_get_functiondef(p.oid) from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select ddl from guard_before),'guard body unchanged after success');
select is((select p.proacl::text from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select acl from guard_before),'guard ACL unchanged after success');
select is((select p.proowner from pg_proc p where p.oid='public.guard_estimate_versions_delete_draft_only()'::regprocedure),(select owner from guard_before),'guard owner unchanged after success');
select throws_ok($$ delete from public.estimate_versions where id='79000000-0000-4000-8000-000000000021' $$,'42501','ESTIMATE_VERSION_DELETE_DRAFT_ONLY','other accepted version remains protected');
set local role authenticated;
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000001',true);
select is((select count(*)::integer from public.audit_logs where id in (select id from target_audit_before)),
  (select count(*)::integer from target_audit_before),'tenant admin can still read all preserved audit entries');
select is((select count(*)::integer from public.plan_sets where id='79000000-0000-4000-8000-000000000012'),1,'owner can read detached plan set');
select is((select count(*)::integer from public.plan_files where id='79000000-0000-4000-8000-000000000013'),1,'owner can read its plan file');
select set_config('request.jwt.claim.sub','79000000-0000-4000-8000-000000000002',true);
select is((select count(*)::integer from public.plan_sets where id='79000000-0000-4000-8000-000000000012'),0,'other tenant cannot read detached plan set');
select is((select count(*)::integer from public.plan_files where id='79000000-0000-4000-8000-000000000013'),0,'other tenant cannot read its plan file');
reset role;

select * from finish();
rollback;
