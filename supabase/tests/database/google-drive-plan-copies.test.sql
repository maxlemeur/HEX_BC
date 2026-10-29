begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- A plan linked from Google Drive keeps one métré working copy, read from Drive: no
-- affaire-intake object backs it, and it lives and dies with the link. Fictional data only.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','6d000000-0000-4000-8000-000000000001','authenticated','authenticated','drive-plan-copy@example.test',crypt('fictional-password', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6d000000-0000-4000-8000-000000000002',tenant_id,user_id,'Affaire Drive plans fictive'
from public.tenant_memberships where user_id='6d000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6d000000-0000-4000-8000-000000000003','6d000000-0000-4000-8000-000000000002','6d000000-0000-4000-8000-000000000001','ready');
set local role service_role;
select isnt(public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6d000000-0000-4000-8000-000000000001'),
  '6d000000-0000-4000-8000-000000000001','plan_account','drive-plan-copy@example.test','Compte fictif','v1.aaaa.bbbb.cccc'),null,
  'the member has a Google account');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
insert into public.affaire_intake_documents (id,upload_id,created_by,file_name,mime_type,size_bytes,upload_status,source_provider,drive_connection_id,drive_file_id)
select fixture.id::uuid,'6d000000-0000-4000-8000-000000000003','6d000000-0000-4000-8000-000000000001',fixture.name,'application/pdf',5,'uploaded','google_drive',
  (select id from public.google_drive_connections where google_account_id='plan_account'),fixture.file_id
from (values ('6d000000-0000-4000-8000-000000000004','plan-a.pdf','drive_plan_a'),
  ('6d000000-0000-4000-8000-000000000005','plan-b.pdf','drive_plan_b')) fixture(id,name,file_id);
reset role;
update public.affaire_intake_documents set classification_status='classified',document_kind='plans',classified_at=now()
where upload_id='6d000000-0000-4000-8000-000000000003';
insert into public.plan_sets (id,tenant_id,project_id,name)
select '6d000000-0000-4000-8000-000000000006',tenant_id,id,'Plans import' from public.estimate_projects where id='6d000000-0000-4000-8000-000000000002';
create temporary table drive_copy on commit drop as
select d.id as document_id, d.drive_file_id, d.plan_copy_generation, d.file_name, f.id as file_id,
  d.tenant_id::text || '/6d000000-0000-4000-8000-000000000006/' || f.id || '/' || d.file_name as file_path
from public.affaire_intake_documents d
join (values ('6d000000-0000-4000-8000-000000000004','6d000000-0000-4000-8000-000000000007'::uuid),
  ('6d000000-0000-4000-8000-000000000005','6d000000-0000-4000-8000-000000000008'::uuid)) f(document_id,id) on f.document_id::uuid = d.id;
grant select on drive_copy to authenticated;

select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),false,'a Drive plan without a working copy is not a plan of the dossier');

set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6d000000-0000-4000-8000-000000000009',public.current_tenant_id(),'6d000000-0000-4000-8000-000000000006',
    replace(file_path,file_id::text,'6d000000-0000-4000-8000-000000000009'),'plan-a.pdf','application/pdf',9,
    jsonb_build_object('source','affaire-intake','intake_document_id',document_id,'intake_storage_path',null,
      'intake_drive_file_id','another_drive_file','intake_generation',plan_copy_generation)
  from drive_copy where document_id='6d000000-0000-4000-8000-000000000004'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a working copy names the Drive file of its link');
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6d000000-0000-4000-8000-000000000009',public.current_tenant_id(),'6d000000-0000-4000-8000-000000000006',
    replace(file_path,file_id::text,'6d000000-0000-4000-8000-000000000009'),'plan-a.pdf','application/pdf',9,
    jsonb_build_object('source','affaire-intake','intake_document_id',document_id,'intake_storage_path','fixture/plan-a.pdf',
      'intake_drive_file_id',drive_file_id,'intake_generation',plan_copy_generation)
  from drive_copy where document_id='6d000000-0000-4000-8000-000000000004'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a Drive working copy cannot claim stored bytes in the dossier');
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6d000000-0000-4000-8000-000000000009',public.current_tenant_id(),'6d000000-0000-4000-8000-000000000006',
    replace(file_path,file_id::text,'6d000000-0000-4000-8000-000000000009'),'plan-a.pdf','application/pdf',9,
    jsonb_build_object('source','affaire-intake','intake_document_id',document_id,'intake_storage_path',null,
      'intake_drive_file_id',drive_file_id,'intake_generation',gen_random_uuid())
  from drive_copy where document_id='6d000000-0000-4000-8000-000000000004'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a stale classifier cannot reserve another generation');
select lives_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select file_id,public.current_tenant_id(),'6d000000-0000-4000-8000-000000000006',file_path,file_name,'application/pdf',9,
    jsonb_build_object('source','affaire-intake','intake_document_id',document_id,'intake_storage_path',null,
      'intake_drive_file_id',drive_file_id,'intake_generation',plan_copy_generation)
  from drive_copy$$,'a member reserves the working copy of each Drive plan');
reset role;

select lives_ok($$insert into storage.objects (bucket_id,name,metadata)
  select 'plan-files',file_path,'{"size":7}' from drive_copy$$,'the bytes read from Drive are stored without an affaire-intake object');
select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),false,'an incomplete working copy is not a plan');
-- A copy filed in another affaire's plans does not make this affaire's plan present.
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6d000000-0000-4000-8000-000000000020',tenant_id,user_id,'Autre affaire fictive' from public.estimate_projects where id='6d000000-0000-4000-8000-000000000002';
insert into public.plan_sets (id,tenant_id,project_id,name)
select '6d000000-0000-4000-8000-000000000021',tenant_id,id,'Plans import' from public.estimate_projects where id='6d000000-0000-4000-8000-000000000020';
insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
select '6d000000-0000-4000-8000-000000000022',d.tenant_id,'6d000000-0000-4000-8000-000000000021',
  d.tenant_id::text || '/6d000000-0000-4000-8000-000000000021/6d000000-0000-4000-8000-000000000022/' || d.file_name,d.file_name,'application/pdf',9,
  jsonb_build_object('source','affaire-intake','intake_document_id',d.id,'intake_storage_path',null,
    'intake_drive_file_id',d.drive_file_id,'intake_generation',d.plan_copy_generation)
from public.affaire_intake_documents d where d.id='6d000000-0000-4000-8000-000000000005';
insert into storage.objects (bucket_id,name,metadata)
select 'plan-files',file_path,'{"size":9}' from public.plan_files where id='6d000000-0000-4000-8000-000000000022';
select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),false,'a copy filed in another affaire does not count here');
update storage.objects set metadata='{"size":9}' where bucket_id='plan-files' and name in (select file_path from drive_copy);
select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),true,'a complete working copy makes the Drive plan count');

set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
select throws_ok($$delete from public.plan_files where id='6d000000-0000-4000-8000-000000000007'$$,
  'P0001','INTAKE_PLAN_DELETE_SOURCE_FIRST','the working copy cannot be deleted while its link is live');
select throws_ok($$update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id='6d000000-0000-4000-8000-000000000007'$$,
  'P0001','INTAKE_PLAN_NOT_STALE','a live working copy cannot be marked for cleanup');
select is(public.delete_stale_intake_plan_file('6d000000-0000-4000-8000-000000000007'),null,'the copy of a live link is not stale');
select throws_ok($$update public.plan_files set metadata = metadata || '{"intake_drive_file_id":"another_drive_file"}'::jsonb where id='6d000000-0000-4000-8000-000000000007'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a working copy keeps the Drive file it was read from');

-- Removing the link: the deletion reservation releases the working copy with it.
update public.affaire_intake_documents set deletion_token='6d000000-0000-4000-8000-000000000010' where id='6d000000-0000-4000-8000-000000000004';
reset role;
select throws_ok($$update storage.objects set metadata='{"size":9}' where bucket_id='plan-files'
  and name=(select file_path from drive_copy where file_id='6d000000-0000-4000-8000-000000000007')$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a late Drive read cannot write the copy of a link being removed');
set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
select lives_ok($$delete from public.plan_files where id='6d000000-0000-4000-8000-000000000007'$$,'removing the link deletes its working copy');
reset role;
select throws_ok($$update storage.objects set metadata='{"size":9}' where bucket_id='plan-files'
  and name=(select file_path from drive_copy where file_id='6d000000-0000-4000-8000-000000000007')$$,
  '23503','PLAN_FILE_RESERVATION_REQUIRED','a late Drive read cannot rewrite the bytes of a removed working copy');

-- Plan B: an account removed later keeps the copy already made, but no new one can be read.
set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
delete from public.google_drive_connections where google_account_id='plan_account';
reset role;
select is((select drive_connection_id from public.affaire_intake_documents where id='6d000000-0000-4000-8000-000000000005'),null,'the link stays without its account');
select is((select plan_copy_generation from public.affaire_intake_documents where id='6d000000-0000-4000-8000-000000000005'),
  (select plan_copy_generation from drive_copy where file_id='6d000000-0000-4000-8000-000000000008'),'removing the account keeps the copy generation');
select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),true,'the working copy already made still counts');

-- Reclassification retires the copy of the former generation.
update public.affaire_intake_documents set document_kind='cctp' where id='6d000000-0000-4000-8000-000000000005';
select is(public.affaire_has_stored_plan('6d000000-0000-4000-8000-000000000002'),false,'a reclassified piece no longer counts as a plan');
select throws_ok($$update storage.objects set metadata='{"size":9}' where bucket_id='plan-files'
  and name=(select file_path from drive_copy where file_id='6d000000-0000-4000-8000-000000000008')$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a late Drive read cannot write a copy of the former classification');
set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
select is(public.delete_stale_intake_plan_file('6d000000-0000-4000-8000-000000000008'),
  (select file_path from drive_copy where file_id='6d000000-0000-4000-8000-000000000008'),'the copy of the former classification is stale');
select lives_ok($$delete from public.plan_files where id='6d000000-0000-4000-8000-000000000008'$$,'the stale working copy is deleted');
reset role;
update public.affaire_intake_documents set document_kind='plans', classified_at=now() where id='6d000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','6d000000-0000-4000-8000-000000000001',true);
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6d000000-0000-4000-8000-000000000011',public.current_tenant_id(),'6d000000-0000-4000-8000-000000000006',
    replace(d.file_path,d.file_id::text,'6d000000-0000-4000-8000-000000000011'),'plan-b.pdf','application/pdf',9,
    jsonb_build_object('source','affaire-intake','intake_document_id',d.document_id,'intake_storage_path',null,
      'intake_drive_file_id',d.drive_file_id,'intake_generation',s.plan_copy_generation)
  from drive_copy d join public.affaire_intake_documents s on s.id = d.document_id where d.file_id='6d000000-0000-4000-8000-000000000008'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a link without a Google account cannot reserve a new working copy');
reset role;

select * from finish();
rollback;
