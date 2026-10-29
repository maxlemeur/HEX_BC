begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(34);

-- Fictional members: the affaire owner, an admin of the same tenant and a member of another tenant.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
  crypt('fictional-local-test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('6b000000-0000-4000-8000-000000000001','drive-link-owner@example.test'),
  ('6b000000-0000-4000-8000-000000000002','drive-link-admin@example.test'),
  ('6b000000-0000-4000-8000-000000000003','drive-link-foreign@example.test')
) fixture(id,email);
update public.tenant_memberships set is_default=false where user_id='6b000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
select tenant_id,'6b000000-0000-4000-8000-000000000002','admin',true
from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6b000000-0000-4000-8000-000000000004',tenant_id,user_id,'Affaire Drive fictive'
from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000001','failed');

set local role authenticated;
select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.save_google_drive_connection(public.current_tenant_id(),'6b000000-0000-4000-8000-000000000001',
  'colleague_account','x@example.test','Forged','v1.aaaa.bbbb.cccc')$$,'42501',null,
  'a member cannot register a Google account by name: only the OAuth callback saves one');
reset role;

-- The OAuth callback saves, through the service role, the account Google returned for the member it verified.
set local role service_role;
select isnt(public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001'),
  '6b000000-0000-4000-8000-000000000001','owner_account','drive-link-owner@example.test','Compte fictif','v1.aaaa.bbbb.cccc'),null,
  'the OAuth callback saves a Google account for the member it verified');
select is(public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001'),
  '6b000000-0000-4000-8000-000000000001','owner_account','drive-link-owner@example.test','Compte fictif','v1.dddd.eeee.ffff'),
  (select id from public.google_drive_connections where google_account_id='owner_account'),'adding the same Google account again keeps one row');
select throws_ok($$select public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001'),
  '6b000000-0000-4000-8000-000000000001','owner_other','drive-link-owner@example.test','Compte fictif','plain-refresh-token')$$,
  '23514',null,'only an encrypted token can be stored');
select throws_ok($$select public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001'),
  '6b000000-0000-4000-8000-000000000003','foreign_account','drive-link-foreign@example.test','Compte fictif','v1.aaaa.bbbb.cccc')$$,
  '42501','GOOGLE_DRIVE_CONNECTION_DENIED','an account is saved only for a member of that tenant');
select isnt(public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000001'),
  '6b000000-0000-4000-8000-000000000002','admin_account','drive-link-admin@example.test','Admin fictif','v1.gggg.hhhh.iiii'),null,
  'the admin gets an account of their own');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.google_drive_connections),1::bigint,'the member sees only their saved account');
select throws_ok($$select * from private.google_drive_connection_secrets$$,'42501',null,'a member cannot read stored tokens');
select throws_ok($$select * from public.google_drive_connection_secret((select id from public.google_drive_connections limit 1))$$,'42501',null,
  'a member cannot call the token read reserved to the server');
select throws_ok($$insert into public.google_drive_connections (tenant_id,user_id,google_account_id,email,display_name)
  values (public.current_tenant_id(),'6b000000-0000-4000-8000-000000000001','forged','x@example.test','Forged')$$,'42501',null,
  'accounts are saved only through the binding function');

select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.google_drive_connections where user_id<>'6b000000-0000-4000-8000-000000000002'),0::bigint,
  'a same-tenant admin does not see another member''s accounts');
with removed as (delete from public.google_drive_connections where user_id<>'6b000000-0000-4000-8000-000000000002' returning id)
select is((select count(*) from removed),0::bigint,'a same-tenant admin cannot remove another member''s account');
reset role;
create temporary table fixture_connection on commit drop as
select google_account_id, id from public.google_drive_connections where google_account_id in ('owner_account','admin_account');
grant select on fixture_connection to authenticated, service_role;
set local role authenticated;

select throws_ok($$insert into public.affaire_intake_documents (id,upload_id,created_by,file_name,upload_status,source_provider,drive_connection_id,drive_file_id)
  values ('6b000000-0000-4000-8000-000000000010','6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000002','plan.pdf','uploaded','google_drive',
    (select id from fixture_connection where google_account_id='owner_account'),'plan_file')$$,'42501','GOOGLE_DRIVE_CONNECTION_NOT_OWNED',
  'a writer cannot link a file through another member''s account');
select lives_ok($$insert into public.affaire_intake_documents (id,upload_id,created_by,file_name,upload_status,source_provider,drive_connection_id,drive_file_id,drive_revision)
  values ('6b000000-0000-4000-8000-000000000011','6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000002','plan.pdf','uploaded','google_drive',
    (select id from fixture_connection where google_account_id='admin_account'),'plan_file','3')$$,'a writer links a file with their own account, without stored bytes');
select throws_ok($$update public.affaire_intake_documents set drive_connection_id=(select id from fixture_connection where google_account_id='owner_account')
  where id='6b000000-0000-4000-8000-000000000011'$$,'42501','GOOGLE_DRIVE_CONNECTION_NOT_OWNED','a link cannot be moved to another member''s account');

select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000001',true);
select throws_ok($$update public.affaire_intake_documents set drive_file_id='another_file' where id='6b000000-0000-4000-8000-000000000011'$$,
  '42501','GOOGLE_DRIVE_CONNECTION_NOT_OWNED','another member cannot point the admin''s link at a different file');
select lives_ok($$update public.affaire_intake_documents set classification_status='classified', document_kind='plans'
  where id='6b000000-0000-4000-8000-000000000011'$$,'other writers still classify a linked piece');
select throws_ok($$insert into public.affaire_intake_documents (upload_id,created_by,file_name,upload_status,source_provider,drive_connection_id,drive_file_id)
  values ('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000001','plan.pdf','uploaded','google_drive',
    (select id from fixture_connection where google_account_id='owner_account'),'plan_file')$$,'23505',null,'a Drive file is linked once per affaire');
select throws_ok($$insert into public.affaire_intake_documents (upload_id,created_by,file_name,upload_status,storage_path,source_provider,drive_connection_id,drive_file_id)
  values ('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000001','copie.pdf','uploaded','tenant/copie.pdf','google_drive',
    (select id from fixture_connection where google_account_id='owner_account'),'copied_file')$$,'23514',null,'a Drive link never carries a stored copy');
select lives_ok($$update public.affaire_intake_documents set deleted_at=now(), upload_status='rejected', document_priority='secondary'
  where id='6b000000-0000-4000-8000-000000000011'$$,'a removed link leaves a tombstone');
select lives_ok($$insert into public.affaire_intake_documents (upload_id,created_by,file_name,upload_status,source_provider,drive_connection_id,drive_file_id)
  values ('6b000000-0000-4000-8000-000000000005','6b000000-0000-4000-8000-000000000001','plan.pdf','uploaded','google_drive',
    (select id from fixture_connection where google_account_id='owner_account'),'plan_file')$$,'the same file can be linked again after its removal');

select lives_ok($$insert into public.affaire_google_drive_folders (project_id,linked_by,connection_id,folder_id,folder_name)
  values ('6b000000-0000-4000-8000-000000000004','6b000000-0000-4000-8000-000000000001',
    (select id from fixture_connection where google_account_id='owner_account'),'folder_demo','Dossier fictif')$$,'the owner links the affaire''s Drive folder');
select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000002',true);
select throws_ok($$update public.affaire_google_drive_folders set linked_by='6b000000-0000-4000-8000-000000000002', folder_id='other_folder'
  where project_id='6b000000-0000-4000-8000-000000000004'$$,'42501','GOOGLE_DRIVE_CONNECTION_NOT_OWNED',
  'another writer cannot re-point the folder through the owner''s account');
select lives_ok($$update public.affaire_google_drive_folders set linked_by='6b000000-0000-4000-8000-000000000002', folder_id='other_folder',
  connection_id=(select id from fixture_connection where google_account_id='admin_account') where project_id='6b000000-0000-4000-8000-000000000004'$$,
  'another writer links a folder of their own Drive instead');

select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.affaire_google_drive_folders) + (select count(*) from public.google_drive_connections)
  + (select count(*) from public.affaire_intake_documents where upload_id='6b000000-0000-4000-8000-000000000005'),0::bigint,
  'another tenant sees no account, folder or linked piece');
reset role;

set local role service_role;
select isnt(public.save_google_drive_connection((select tenant_id from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000003'),
  '6b000000-0000-4000-8000-000000000003','owner_account','drive-link-owner@example.test','Compte fictif','v1.jjjj.kkkk.llll'),null,
  'the same Google account can be added in another tenant');
select is((select refresh_token_ciphertext from public.google_drive_connection_secret((select id from fixture_connection where google_account_id='owner_account'))),
  'v1.dddd.eeee.ffff','the server reads the latest encrypted token for the intake worker');
select is((select shared_grant from public.google_drive_connection_secret((select id from fixture_connection where google_account_id='owner_account'))),
  true,'the server knows that revoking this Google grant would cut another connection');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000001',true);
delete from public.google_drive_connections where google_account_id='owner_account';
reset role;
select is((select count(*) from private.google_drive_connection_secrets s join fixture_connection f on f.id=s.connection_id
  where f.google_account_id='owner_account'),0::bigint,'removing an account deletes its stored token');
select is((select count(*) from public.affaire_intake_documents where upload_id='6b000000-0000-4000-8000-000000000005'
  and drive_file_id='plan_file' and deleted_at is null and drive_connection_id is null),1::bigint,
  'pieces linked through a removed account stay in the affaire, without an account');
set local role authenticated;
select set_config('request.jwt.claim.sub','6b000000-0000-4000-8000-000000000002',true);
select throws_ok($$update public.affaire_intake_documents set drive_revision='4' where id='6b000000-0000-4000-8000-000000000011'$$,
  'P0001','INTAKE_DOCUMENT_DELETED','a removed link stays unchanged');
select lives_ok($$delete from public.google_drive_connections where google_account_id='admin_account'$$,
  'an account that linked a since-removed piece can still be removed');
reset role;
select ok((select deleted_at is not null and drive_connection_id is null from public.affaire_intake_documents
  where id='6b000000-0000-4000-8000-000000000011'),'the removed link keeps its tombstone, without the account');
delete from public.tenant_memberships where user_id='6b000000-0000-4000-8000-000000000003';
select is((select count(*) from public.google_drive_connections where user_id='6b000000-0000-4000-8000-000000000003'),0::bigint,
  'a member who leaves a tenant loses the Google accounts added there');
select * from finish();
rollback;
