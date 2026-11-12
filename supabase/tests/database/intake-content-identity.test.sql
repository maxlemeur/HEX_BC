begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(7);
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','6c000000-0000-4000-8000-000000000001','authenticated','authenticated','intake-content@example.test',crypt('fictional-password', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
insert into public.estimate_projects (id,tenant_id,user_id,name)
select projects.id,tenant_id,user_id,'Content identity fixture' from public.tenant_memberships cross join (values ('6c000000-0000-4000-8000-000000000002'::uuid),('6c000000-0000-4000-8000-000000000003'::uuid)) projects(id) where user_id='6c000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status) values
('6c000000-0000-4000-8000-000000000004','6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001','ready'),
('6c000000-0000-4000-8000-000000000005','6c000000-0000-4000-8000-000000000003','6c000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_intake_documents (id,upload_id,file_name,upload_status,storage_path,classification_status,document_kind,size_bytes,content_sha256)
values ('6c000000-0000-4000-8000-000000000006','6c000000-0000-4000-8000-000000000004','first.txt','pending','fixture/path','queued','a_classer',1,repeat('a',64));
select throws_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000004','renamed.txt',1,repeat('a',64))$$,'23505',null,'even a pending document reserves its content against concurrent inserts');
select lives_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000004','first.txt',1,repeat('b',64))$$,'the same name with different content is allowed');
select lives_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000005','first.txt',1,repeat('a',64))$$,'another affaire may hold the same bytes');
update public.affaire_intake_documents set upload_status='rejected' where id='6c000000-0000-4000-8000-000000000006';
select lives_ok($$insert into public.affaire_intake_documents (id,upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000007','6c000000-0000-4000-8000-000000000004','retry.txt',1,repeat('a',64))$$,'a rejected transfer releases its content for retry');
update public.affaire_intake_documents set deleted_at=now(),storage_path=null,upload_status='rejected',document_priority='secondary' where id='6c000000-0000-4000-8000-000000000007';
select lives_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000004','restored.txt',1,repeat('a',64))$$,'a deleted copy can be added again');
select throws_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes,content_sha256) values ('6c000000-0000-4000-8000-000000000004','invalid.txt',1,'bad')$$,'23514',null,'malformed content identities are refused');
select lives_ok($$insert into public.affaire_intake_documents (upload_id,file_name,size_bytes) values ('6c000000-0000-4000-8000-000000000004','legacy.txt',1),('6c000000-0000-4000-8000-000000000004','legacy.txt',1)$$,'legacy pieces remain untouched by the migration');
select * from finish();
rollback;
