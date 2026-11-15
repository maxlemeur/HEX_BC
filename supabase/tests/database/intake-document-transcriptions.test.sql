begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(20);

-- Fictional members: the affaire owner (an engineer), an engineer of the same tenant who does not read the
-- affaire, and a member of another tenant.
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select '00000000-0000-0000-0000-000000000000', id::uuid, 'authenticated', 'authenticated', email,
  crypt('fictional-local-test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (values
  ('7a000000-0000-4000-8000-000000000001','transcription-owner@example.test'),
  ('7a000000-0000-4000-8000-000000000002','transcription-colleague@example.test'),
  ('7a000000-0000-4000-8000-000000000003','transcription-foreign@example.test')
) fixture(id,email);
update public.tenant_memberships set is_default=false where user_id='7a000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
select tenant_id, '7a000000-0000-4000-8000-000000000002', 'engineer', true
from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001';
update public.tenant_memberships set role='engineer' where user_id='7a000000-0000-4000-8000-000000000001';
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '7a000000-0000-4000-8000-000000000004', tenant_id, user_id, 'Affaire transcription fictive'
from public.tenant_memberships where user_id='7a000000-0000-4000-8000-000000000001' and is_default;
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('7a000000-0000-4000-8000-000000000005','7a000000-0000-4000-8000-000000000004','7a000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_intake_documents (id,upload_id,file_name,mime_type,upload_status,storage_path,classification_status,document_kind,size_bytes)
values ('7a000000-0000-4000-8000-000000000006','7a000000-0000-4000-8000-000000000005','photo-chantier.jpg','image/jpeg','uploaded','fixture/photo','classified','annexes',10),
  ('7a000000-0000-4000-8000-000000000007','7a000000-0000-4000-8000-000000000005','scan.pdf','application/pdf','uploaded','fixture/scan','classified','cctp',10);

-- The intake worker (here the table owner) writes the transcription of what it read.
select lives_ok($$insert into public.affaire_intake_document_transcriptions
  (id,tenant_id,document_id,source_sha256,status,pages,pages_needed,model,reasoning_effort,prompt_version)
  select '7a000000-0000-4000-8000-000000000010', tenant_id, id, repeat('a',64), 'completed',
    '[{"page":1,"text":"Tube cuivre DN20 [illisible] m","illegible":1}]'::jsonb, 1, 'gpt-6.1-terra', 'high', 'intake-transcription-v1'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000006'$$,
  'the worker records a completed transcription');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  select tenant_id, id, repeat('b',64), 'completed', '[{"page":1,"text":"autre","illegible":0}]'::jsonb, 1, 'intake-transcription-v1'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000006'$$,
  '23505',null,'a piece has one transcription, replaced rather than added');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  select tenant_id, id, repeat('b',64), 'completed', '[{"page":1,"text":"a","illegible":0}]'::jsonb, 2, 'intake-transcription-v1'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000007'$$,
  '23514',null,'a completed transcription read every page it needed');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version,error_code)
  select tenant_id, id, repeat('b',64), 'failed', '[{"page":1,"text":"a","illegible":0}]'::jsonb, 1, 'intake-transcription-v1', 'AI_QUOTA'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000007'$$,
  '23514',null,'a failed transcription keeps no text');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  select tenant_id, id, repeat('b',64), 'failed', '[]'::jsonb, 1, 'intake-transcription-v1'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000007'$$,
  '23514',null,'a failed transcription says why');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  select tenant_id, id, 'not-a-hash', 'completed', '[{"page":1,"text":"a","illegible":0}]'::jsonb, 1, 'intake-transcription-v1'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000007'$$,
  '23514',null,'the content read is named by its SHA-256');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  select membership.tenant_id, '7a000000-0000-4000-8000-000000000007', repeat('b',64), 'completed',
    '[{"page":1,"text":"a","illegible":0}]'::jsonb, 1, 'intake-transcription-v1'
  from public.tenant_memberships membership where membership.user_id='7a000000-0000-4000-8000-000000000003'$$,
  '23503',null,'a transcription stays in its piece''s tenant');
select lives_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,pages_skipped,prompt_version,model,reasoning_effort)
  select tenant_id, id, repeat('c',64), 'partial', '[{"page":2,"text":"Article 4.2","illegible":0}]'::jsonb, 3, 1,
    'intake-transcription-v1', 'gpt-6.1-terra', 'high'
  from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000007'$$,
  'a partial transcription keeps the pages it read and counts those left out');
select throws_ok($$update public.affaire_intake_document_transcriptions set document_id='7a000000-0000-4000-8000-000000000007'
  where id='7a000000-0000-4000-8000-000000000010'$$,'23514','INTAKE_TRANSCRIPTION_SCOPE_IMMUTABLE','a transcription cannot move to another piece');

-- Whoever reads the piece reads its transcription; nobody but the worker writes it.
set local role authenticated;
select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.affaire_intake_document_transcriptions),2::bigint,'the affaire owner reads the transcriptions of its pieces');
select is((select pages->0->>'text' from public.affaire_intake_document_transcriptions where id='7a000000-0000-4000-8000-000000000010'),
  'Tube cuivre DN20 [illisible] m','the text keeps the passages marked illegible');
select throws_ok($$insert into public.affaire_intake_document_transcriptions
  (tenant_id,document_id,source_sha256,status,pages,pages_needed,prompt_version)
  values (public.current_tenant_id(),'7a000000-0000-4000-8000-000000000006',repeat('d',64),'completed',
    '[{"page":1,"text":"forgé","illegible":0}]'::jsonb,1,'intake-transcription-v1')$$,
  '42501',null,'a member cannot write a transcription');
select throws_ok($$update public.affaire_intake_document_transcriptions set pages='[]'::jsonb$$,'42501',null,
  'a member cannot rewrite a transcription');
select throws_ok($$delete from public.affaire_intake_document_transcriptions$$,'42501',null,'a member cannot delete a transcription');

select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.affaire_intake_document_transcriptions),0::bigint,
  'a colleague who does not read the affaire does not read its transcriptions');
select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.affaire_intake_document_transcriptions),0::bigint,'another tenant reads no transcription');

-- A deleted piece takes its transcription out of reach, then away with it.
reset role;
update public.affaire_intake_documents set deleted_at=now(), storage_path=null, upload_status='rejected', document_priority='secondary'
  where id='7a000000-0000-4000-8000-000000000007';
set local role authenticated;
select set_config('request.jwt.claim.sub','7a000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.affaire_intake_document_transcriptions),1::bigint,
  'the transcription of a deleted piece is no longer readable');
reset role;
delete from public.affaire_intake_documents where id='7a000000-0000-4000-8000-000000000006';
select is((select count(*) from public.affaire_intake_document_transcriptions where id='7a000000-0000-4000-8000-000000000010'),0::bigint,
  'the transcription goes with its piece');

-- The worker replaces the transcription in place when the content changes.
update public.affaire_intake_document_transcriptions set source_sha256=repeat('e',64), status='failed', pages='[]'::jsonb,
  pages_skipped=0, error_code='AI_QUOTA' where document_id='7a000000-0000-4000-8000-000000000007';
select is((select status from public.affaire_intake_document_transcriptions where document_id='7a000000-0000-4000-8000-000000000007'),
  'failed','a new reading replaces the previous one');
select throws_ok($$update public.affaire_intake_document_transcriptions set tenant_id=(select tenant_id from public.tenant_memberships
  where user_id='7a000000-0000-4000-8000-000000000003') where document_id='7a000000-0000-4000-8000-000000000007'$$,
  '23514','INTAKE_TRANSCRIPTION_SCOPE_IMMUTABLE','a transcription stays on its piece and tenant');

select * from finish();
rollback;
