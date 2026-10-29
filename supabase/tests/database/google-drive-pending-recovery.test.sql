begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(12);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
  crypt('fictional-local-test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('6a000000-0000-4000-8000-000000000001','drive-owner@example.test'),
  ('6a000000-0000-4000-8000-000000000002','drive-director@example.test'),
  ('6a000000-0000-4000-8000-000000000003','drive-foreign@example.test'),
  ('6a000000-0000-4000-8000-000000000008','drive-admin@example.test')
) fixture(id,email);

update public.tenant_memberships set is_default=false where user_id in ('6a000000-0000-4000-8000-000000000002','6a000000-0000-4000-8000-000000000008');
insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
select tenant_id, member.user_id::uuid, member.role::public.tenant_role, true
from public.tenant_memberships cross join (values
  ('6a000000-0000-4000-8000-000000000002','director'),('6a000000-0000-4000-8000-000000000008','admin')
) member(user_id,role) where tenant_memberships.user_id='6a000000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6a000000-0000-4000-8000-000000000004',tenant_id,user_id,'Drive POC fictif'
from public.tenant_memberships where user_id='6a000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6a000000-0000-4000-8000-000000000005','6a000000-0000-4000-8000-000000000004','6a000000-0000-4000-8000-000000000001','failed');
insert into public.affaire_intake_documents (id,upload_id,created_by,file_name,upload_status,storage_path)
select fixture.id::uuid, '6a000000-0000-4000-8000-000000000005', '6a000000-0000-4000-8000-000000000001', 'fictional.pdf', 'pending',
  p.tenant_id::text || '/' || p.id::text || '/6a000000-0000-4000-8000-000000000005/' || fixture.id || '/fictional.pdf'
from public.estimate_projects p cross join (values
  ('6a000000-0000-4000-8000-000000000006'),('6a000000-0000-4000-8000-000000000007')
) fixture(id) where p.id='6a000000-0000-4000-8000-000000000004';
insert into public.affaire_intake_events (document_id,event_type,actor_user_id,after_payload)
values ('6a000000-0000-4000-8000-000000000006','upload.created','6a000000-0000-4000-8000-000000000001','{"drive":{"provider":"google_drive"}}');
insert into storage.objects (bucket_id,name)
select 'affaire-intake',storage_path from public.affaire_intake_documents
where project_id='6a000000-0000-4000-8000-000000000004';

set local role authenticated;
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000001',true);
-- Drive pieces are links now: no pending Drive copy is ever readable before finalization.
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),0::bigint,
  'a project writer cannot read a pending object marked as a former Drive copy');
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000007/%'),0::bigint,
  'ordinary pending intake objects remain unreadable');
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000002',true);
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),0::bigint,
  'same-tenant director cannot read a pending Drive object');
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000003',true);
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),0::bigint,
  'another tenant cannot read a pending Drive object');
reset role;
update public.affaire_intake_documents set upload_status='uploaded' where id='6a000000-0000-4000-8000-000000000006';
set local role authenticated;
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000002',true);
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),1::bigint,
  'existing authorized reader can read the finalized copy');
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000003',true);
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),0::bigint,
  'another tenant still cannot read the finalized copy');
reset role;
set local role anon;
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),0::bigint,
  'anonymous users cannot read the finalized copy');
reset role;

-- Deleted copies (verified deletion tombstones) imported by the project owner, restored by a tenant admin:
-- the Storage insert policy admits only the document's created_by, so the restorer must become it.
insert into public.affaire_intake_documents (id,upload_id,created_by,file_name,upload_status,storage_path,deleted_at,document_priority)
select fixture.id::uuid, '6a000000-0000-4000-8000-000000000005', '6a000000-0000-4000-8000-000000000001', 'fictional.pdf', 'rejected', null, now(), 'secondary'
from (values ('6a000000-0000-4000-8000-000000000010'),('6a000000-0000-4000-8000-000000000011')) fixture(id);
set local role authenticated;
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000002',true);
with restored as (
  update public.affaire_intake_documents set created_by='6a000000-0000-4000-8000-000000000002', deleted_at=null,
    storage_path=tenant_id::text || '/' || project_id::text || '/' || upload_id::text || '/' || id::text || '/director.pdf', upload_status='pending'
  where id='6a000000-0000-4000-8000-000000000011' and deleted_at is not null and deletion_token is null returning id
) select is((select count(*) from restored),0::bigint,'a same-tenant director cannot restore a deleted copy nor take it over');
select set_config('request.jwt.claim.sub','6a000000-0000-4000-8000-000000000008',true);
with restored as (
  update public.affaire_intake_documents set deleted_at=null, upload_status='pending', classification_status='queued', rejection_reason=null, issues='{}',
    storage_path=tenant_id::text || '/' || project_id::text || '/' || upload_id::text || '/' || id::text || '/kept-creator.pdf'
  where id='6a000000-0000-4000-8000-000000000010' and deleted_at is not null and deletion_token is null returning created_by
) select is((select created_by from restored),'6a000000-0000-4000-8000-000000000001'::uuid,'control: an admin restore that keeps the owner as creator is accepted');
select throws_ok($$insert into storage.objects (bucket_id,name) select 'affaire-intake',storage_path from public.affaire_intake_documents
  where id='6a000000-0000-4000-8000-000000000010'$$,'42501','new row violates row-level security policy for table "objects"',
  'control: that admin then cannot store the new generation');
with restored as (
  update public.affaire_intake_documents set created_by='6a000000-0000-4000-8000-000000000008', deleted_at=null, upload_status='pending',
    classification_status='queued', rejection_reason=null, issues='{}',
    storage_path=tenant_id::text || '/' || project_id::text || '/' || upload_id::text || '/' || id::text || '/restored-by-admin.pdf'
  where id='6a000000-0000-4000-8000-000000000011' and deleted_at is not null and deletion_token is null returning created_by
) select is((select created_by from restored),'6a000000-0000-4000-8000-000000000008'::uuid,'an admin restore records the admin as creator of the new generation');
select lives_ok($$insert into storage.objects (bucket_id,name) select 'affaire-intake',storage_path from public.affaire_intake_documents
  where id='6a000000-0000-4000-8000-000000000011'$$,'the restoring admin stores the new generation under the unchanged Storage insert policy');
reset role;
select * from finish();
rollback;
