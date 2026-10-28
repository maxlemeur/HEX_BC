begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(9);
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','6b000000-0000-4000-8000-000000000001','authenticated','authenticated','intake-delete@example.test',crypt('fictional-password', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6b000000-0000-4000-8000-000000000002',tenant_id,user_id,'Deletion fixture' from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status) values ('6b000000-0000-4000-8000-000000000003','6b000000-0000-4000-8000-000000000002','6b000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_intake_documents (id,upload_id,file_name,upload_status,storage_path,classification_status,document_kind,size_bytes)
values ('6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000003','fixture.pdf','uploaded','fixture/path','classified','plans',1);
insert into storage.objects (bucket_id,name,metadata) values ('affaire-intake','fixture/path','{"size":1}');
insert into public.plan_sets (id,tenant_id,project_id,name)
select '6b000000-0000-4000-8000-000000000005',tenant_id,id,'Deletion fixture' from public.estimate_projects where id='6b000000-0000-4000-8000-000000000002';
insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
select '6b000000-0000-4000-8000-000000000008',tenant_id,'6b000000-0000-4000-8000-000000000005',tenant_id::text || '/6b000000-0000-4000-8000-000000000005/6b000000-0000-4000-8000-000000000008/fixture.pdf','fixture.pdf','application/pdf',1,'{"source":"affaire-intake","intake_document_id":"6b000000-0000-4000-8000-000000000004","intake_storage_path":"fixture/path"}' from public.estimate_projects where id='6b000000-0000-4000-8000-000000000002';
select is(public.delete_stale_intake_plan_file('6b000000-0000-4000-8000-000000000008'),null::text,'an older snapshot cannot delete an eligible current plan');
select is((select count(*) from public.plan_files where id='6b000000-0000-4000-8000-000000000008'),1::bigint,'eligible plan metadata remains');
update public.affaire_intake_documents set document_kind='cctp' where id='6b000000-0000-4000-8000-000000000004';
select isnt(public.delete_stale_intake_plan_file('6b000000-0000-4000-8000-000000000008'),null::text,'actual reclassification retires the stale plan');
update public.affaire_intake_documents set document_kind='plans' where id='6b000000-0000-4000-8000-000000000004';
update public.affaire_intake_documents set deletion_token='6b000000-0000-4000-8000-000000000006' where id='6b000000-0000-4000-8000-000000000004';
select throws_ok($$update public.affaire_intake_documents set classification_status='classified',document_kind='cctp' where id='6b000000-0000-4000-8000-000000000004'$$,'P0001','INTAKE_DOCUMENT_DELETION_IN_PROGRESS','classification cannot mutate a reserved copy');
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata) select '6b000000-0000-4000-8000-000000000007',tenant_id,'6b000000-0000-4000-8000-000000000005',tenant_id::text || '/6b000000-0000-4000-8000-000000000005/6b000000-0000-4000-8000-000000000007/fixture.pdf','fixture.pdf','application/pdf',1,'{"source":"affaire-intake","intake_document_id":"6b000000-0000-4000-8000-000000000004","intake_storage_path":"fixture/path"}' from public.estimate_projects where id='6b000000-0000-4000-8000-000000000002'$$,'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','late plan insert cannot resurrect a reserved copy');
select lives_ok($$update public.affaire_intake_documents set deleted_at=now(),deletion_token=null,storage_path=null,upload_status='rejected',document_priority='secondary' where id='6b000000-0000-4000-8000-000000000004'$$,'verified removal can finalize its tombstone');
select throws_ok($$update public.affaire_intake_documents set document_priority='primary' where id='6b000000-0000-4000-8000-000000000004'$$,'P0001','INTAKE_DOCUMENT_DELETED','deleted copy cannot become principal again');
update public.affaire_intake_documents set deleted_at=null,storage_path='fixture/new-generation',upload_status='uploaded',classification_status='classified',document_kind='plans' where id='6b000000-0000-4000-8000-000000000004';
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata) select '6b000000-0000-4000-8000-000000000009',tenant_id,'6b000000-0000-4000-8000-000000000005',tenant_id::text || '/6b000000-0000-4000-8000-000000000005/6b000000-0000-4000-8000-000000000009/fixture.pdf','fixture.pdf','application/pdf',1,'{"source":"affaire-intake","intake_document_id":"6b000000-0000-4000-8000-000000000004","intake_storage_path":"fixture/path"}' from public.estimate_projects where id='6b000000-0000-4000-8000-000000000002'$$,'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','old generation cannot reattach a plan after restore');
select is((select metadata->>'intake_cleanup_pending' from public.plan_files where id='6b000000-0000-4000-8000-000000000008'),'true','cleanup metadata remains discoverable until verified Storage deletion');
select * from finish();
rollback;
