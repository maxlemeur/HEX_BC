begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(7);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
  crypt('fictional-local-test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('6a000000-0000-4000-8000-000000000001','drive-owner@example.test'),
  ('6a000000-0000-4000-8000-000000000002','drive-director@example.test'),
  ('6a000000-0000-4000-8000-000000000003','drive-foreign@example.test')
) fixture(id,email);

update public.tenant_memberships set is_default=false where user_id='6a000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
select tenant_id, '6a000000-0000-4000-8000-000000000002', 'director', true
from public.tenant_memberships where user_id='6a000000-0000-4000-8000-000000000001';
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
select is((select count(*) from storage.objects where bucket_id='affaire-intake' and name like '%/6a000000-0000-4000-8000-000000000006/%'),1::bigint,
  'project writer can verify exactly the pending Drive object after lost acknowledgement');
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
select * from finish();
rollback;
