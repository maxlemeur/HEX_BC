begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
select ok((select allowed_mime_types is null or 'application/pdf' = any(allowed_mime_types) from storage.buckets where id='dpgf-imports'), 'reviewed PDF imports can use the private import bucket');
select ok((select relrowsecurity from pg_catalog.pg_class where oid='private.affaire_plan_presence_state'::regclass), 'plan observations have row level security enabled');
select is(has_table_privilege('anon','private.affaire_plan_presence_state','SELECT'),false,'anonymous clients cannot read plan observations');
select is(has_table_privilege('authenticated','private.affaire_plan_presence_state','SELECT'),false,'authenticated clients cannot read plan observations');
select is(has_table_privilege('authenticated','private.affaire_plan_presence_state','UPDATE'),false,'authenticated clients cannot alter plan observations');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','6c000000-0000-4000-8000-000000000001','authenticated','authenticated','plan-reconcile@example.test',crypt('fictional-password', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6c000000-0000-4000-8000-000000000002',tenant_id,user_id,'Plan reconciliation fixture'
from public.tenant_memberships where user_id='6c000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6c000000-0000-4000-8000-000000000003','6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_intake_documents (id,upload_id,file_name,upload_status,storage_path,classification_status,document_kind)
values ('6c000000-0000-4000-8000-000000000004','6c000000-0000-4000-8000-000000000003','dpgf.xlsx','uploaded','fixture/dpgf','classified','dpgf');
insert into public.affaire_briefs (id,project_id,upload_id,status,summary,project_object,missing_elements,confirmed_at,confirmed_by)
values ('6c000000-0000-4000-8000-000000000005','6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000003',
  'confirme','Summary','Object','["Plans manquants","Doute CCTP"]',now(),'6c000000-0000-4000-8000-000000000001');
insert into public.affaire_brief_source_links (brief_id,source_document_id,block_key,entry_index,source_file_name)
values ('6c000000-0000-4000-8000-000000000005','6c000000-0000-4000-8000-000000000004','missing_elements',0,'dpgf.xlsx'),
  ('6c000000-0000-4000-8000-000000000005','6c000000-0000-4000-8000-000000000004','missing_elements',1,'dpgf.xlsx');

set local role authenticated;
select throws_ok($$select public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null)$$,
  '42501', null, 'authenticated callers cannot execute the service-only reconciliation');
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001'),true,'missing plan opens its system entry');
select is((select is_active from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000002' and code='missing_plans'),true,'plan gap is active');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'confirme','initializing the register does not invalidate a confirmed brief');
update public.affaire_briefs set status='confirme',confirmed_at=now(),confirmed_by='6c000000-0000-4000-8000-000000000001' where id='6c000000-0000-4000-8000-000000000005';

-- A newly discovered plan gap may require review once, but a human can then
-- confirm a brief without the system rewriting the user's missing-elements text.
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6c000000-0000-4000-8000-000000000020',tenant_id,user_id,'Confirmed brief without a plan entry'
from public.tenant_memberships where user_id='6c000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6c000000-0000-4000-8000-000000000021','6c000000-0000-4000-8000-000000000020','6c000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_briefs (id,project_id,upload_id,status,summary,project_object,missing_elements,confirmed_at,confirmed_by)
values ('6c000000-0000-4000-8000-000000000022','6c000000-0000-4000-8000-000000000020','6c000000-0000-4000-8000-000000000021',
  'confirme','Preserve this summary','Object','["Doute CCTP"]',now(),'6c000000-0000-4000-8000-000000000001');
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000020',null),true,'a newly discovered missing plan creates an issue and requests brief review');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000022'),'a_confirmer','the newly discovered gap invalidates the old confirmation once');
update public.affaire_briefs set status='confirme',confirmed_at=now(),confirmed_by='6c000000-0000-4000-8000-000000000001'
where id='6c000000-0000-4000-8000-000000000022';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000020',null),false,'rechecking an unchanged plan gap does not invalidate a renewed confirmation');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000022'),'confirme','renewed confirmation is stable');
select is((select missing_elements from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000022'),'["Doute CCTP"]'::jsonb,'reconciliation preserves the human brief text');

-- Even if no gap ever existed in the register, losing a previously observed
-- plan changes the facts underlying a confirmation mentioning missing plans.
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6c000000-0000-4000-8000-000000000030',tenant_id,user_id,'Initially present plan'
from public.tenant_memberships where user_id='6c000000-0000-4000-8000-000000000001';
insert into public.affaire_intake_uploads (id,project_id,created_by,status)
values ('6c000000-0000-4000-8000-000000000031','6c000000-0000-4000-8000-000000000030','6c000000-0000-4000-8000-000000000001','ready');
insert into public.affaire_intake_documents (id,upload_id,file_name,upload_status,storage_path,classification_status,document_kind)
values ('6c000000-0000-4000-8000-000000000032','6c000000-0000-4000-8000-000000000031','source.xlsx','uploaded','fixture/source','classified','dpgf');
insert into public.affaire_briefs (id,project_id,upload_id,status,summary,project_object,missing_elements,confirmed_at,confirmed_by)
values ('6c000000-0000-4000-8000-000000000033','6c000000-0000-4000-8000-000000000030','6c000000-0000-4000-8000-000000000031',
  'confirme','Keep summary','Object','["Plans manquants"]',now(),'6c000000-0000-4000-8000-000000000001');
insert into public.affaire_brief_source_links (brief_id,source_document_id,block_key,entry_index,source_file_name)
values ('6c000000-0000-4000-8000-000000000033','6c000000-0000-4000-8000-000000000032','missing_elements',0,'source.xlsx');
insert into public.plan_sets (id,tenant_id,project_id,name)
select '6c000000-0000-4000-8000-000000000034',tenant_id,id,'Existing plans' from public.estimate_projects where id='6c000000-0000-4000-8000-000000000030';
insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
select '6c000000-0000-4000-8000-000000000035',tenant_id,'6c000000-0000-4000-8000-000000000034',
  tenant_id::text || '/6c000000-0000-4000-8000-000000000034/6c000000-0000-4000-8000-000000000035/plan.pdf','plan.pdf','application/pdf',8,'{}'
from public.estimate_projects where id='6c000000-0000-4000-8000-000000000030';
insert into storage.objects (bucket_id,name,metadata)
select 'plan-files',file_path,'{"size":8}' from public.plan_files where id='6c000000-0000-4000-8000-000000000035';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000030',null),false,'first observation of a present plan has no visible changes');
select is((select has_plan from private.affaire_plan_presence_state where project_id='6c000000-0000-4000-8000-000000000030'),true,'the present plan is recorded privately');
select is((select count(*) from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000030' and code='missing_plans'),0::bigint,'no fictional resolved gap is created');
delete from public.plan_files where id='6c000000-0000-4000-8000-000000000035';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000030',null),true,'loss of an initially present plan creates the gap');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000033'),'a_confirmer','loss of the observed plan invalidates the confirmation');
select is((select missing_elements from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000033'),'["Plans manquants"]'::jsonb,'loss of the plan preserves historical text');
select is((select count(*) from public.affaire_brief_source_links where brief_id='6c000000-0000-4000-8000-000000000033'),1::bigint,'loss of the plan preserves its source link');

insert into public.plan_sets (id,tenant_id,project_id,name)
select '6c000000-0000-4000-8000-000000000006',tenant_id,id,'Plans import' from public.estimate_projects where id='6c000000-0000-4000-8000-000000000002';
insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
select '6c000000-0000-4000-8000-000000000007',tenant_id,'6c000000-0000-4000-8000-000000000006',
  tenant_id::text || '/6c000000-0000-4000-8000-000000000006/6c000000-0000-4000-8000-000000000007/plan.pdf','plan.pdf','application/pdf',8,'{}'
from public.estimate_projects where id='6c000000-0000-4000-8000-000000000002';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),false,'metadata without Storage bytes is not a plan');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'confirme','unchanged facts preserve a confirmed brief');
insert into storage.objects (bucket_id,name,metadata)
select 'plan-files',file_path,'{"size":7}' from public.plan_files where id='6c000000-0000-4000-8000-000000000007';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),false,'a truncated Storage object does not resolve the gap');
update storage.objects set metadata='{"size":8}' where bucket_id='plan-files' and name=(select file_path from public.plan_files where id='6c000000-0000-4000-8000-000000000007');
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002','6c000000-0000-4000-8000-000000000001'),true,'complete Storage bytes resolve the plan gap');
select is((select is_active from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000002' and code='missing_plans'),false,'resolved entry is inactive');
select is((select missing_elements from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'["Plans manquants","Doute CCTP"]'::jsonb,'brief preserves all user-endorsed text');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'a_confirmer','changed confirmed brief must be confirmed again');
select is((select array_agg(entry_index order by entry_index) from public.affaire_brief_source_links where brief_id='6c000000-0000-4000-8000-000000000005'),array[0,1],'all source links stay attached to their entries');
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),false,'reconciliation is idempotent');
select throws_ok($$select public.resolve_affaire_brief_plan_gap('6c000000-0000-4000-8000-000000000002',0,'2000-01-01T00:00:00Z','6c000000-0000-4000-8000-000000000001')$$,
  '40001','AFFAIRE_BRIEF_STALE','a stale brief cannot resolve a different entry');
select is(public.resolve_affaire_brief_plan_gap('6c000000-0000-4000-8000-000000000002',0,
  (select updated_at from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'6c000000-0000-4000-8000-000000000001'),true,'user explicitly resolves the reviewed plan entry');
select is((select generation_metadata -> 'resolved_plan_gap_indexes' from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'[0]'::jsonb,'resolution is stored separately');
select is((select missing_elements from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'["Plans manquants","Doute CCTP"]'::jsonb,'resolution preserves the historical text');
select is((select array_agg(entry_index order by entry_index) from public.affaire_brief_source_links where brief_id='6c000000-0000-4000-8000-000000000005'),array[0,1],'resolution preserves source links');

update public.affaire_briefs set status='confirme',confirmed_at=now(),confirmed_by='6c000000-0000-4000-8000-000000000001' where id='6c000000-0000-4000-8000-000000000005';
-- Model the committed metadata deletion; storage.objects is protected against direct SQL deletion.
delete from public.plan_files where id='6c000000-0000-4000-8000-000000000007';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),true,'losing the last stored plan reopens the gap');
select is((select is_active from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000002' and code='missing_plans'),true,'missing plan is active again');
select is((select status from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000002' and code='missing_plans'),'open','reactivation opens the issue');
select is((select missing_elements from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'["Plans manquants","Doute CCTP"]'::jsonb,'a removed plan does not rewrite user-endorsed text');
select is((select array_agg(entry_index order by entry_index) from public.affaire_brief_source_links where brief_id='6c000000-0000-4000-8000-000000000005'),array[0,1],'existing source links remain attached');
select is((select status from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),'a_confirmer','a removed plan invalidates a confirmed brief');
select is((select generation_metadata ? 'resolved_plan_gap_indexes' from public.affaire_briefs where id='6c000000-0000-4000-8000-000000000005'),false,'losing the plan also clears its resolution');
select is((select count(*) from public.affaire_register_events where project_id='6c000000-0000-4000-8000-000000000002' and event_type in ('created','deactivated','reactivated')),3::bigint,'all three state transitions are audited');


-- Interrupted intake deletion can leave an uploaded row after its bytes have gone.
insert into public.affaire_intake_documents (id,upload_id,file_name,upload_status,storage_path,classification_status,document_kind,size_bytes)
values ('6c000000-0000-4000-8000-000000000008','6c000000-0000-4000-8000-000000000003','intake-plan.pdf','uploaded','fixture/intake-plan.pdf','classified','plans',8);
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),false,'intake metadata without bytes does not resolve the gap');
insert into storage.objects (bucket_id,name,metadata) values ('affaire-intake','fixture/intake-plan.pdf','{"size":8}');
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),true,'a complete intake plan resolves the gap');
update storage.objects set metadata='{"size":7}' where bucket_id='affaire-intake' and name='fixture/intake-plan.pdf';
select is(public.reconcile_affaire_plan_gap('6c000000-0000-4000-8000-000000000002',null),true,'missing intake bytes reopen the gap after interrupted deletion');
select is((select is_active from public.affaire_register_entries where project_id='6c000000-0000-4000-8000-000000000002' and code='missing_plans'),true,'the incomplete intake copy is not treated as a plan');


-- A producer cannot resurrect a source whose bytes were lost during deletion.
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6c000000-0000-4000-8000-000000000010',tenant_id,'6c000000-0000-4000-8000-000000000006',
    tenant_id::text || '/6c000000-0000-4000-8000-000000000006/6c000000-0000-4000-8000-000000000010/old.pdf','old.pdf','application/pdf',8,
    '{"source":"affaire-intake","intake_document_id":"6c000000-0000-4000-8000-000000000008","intake_storage_path":"fixture/intake-plan.pdf","intake_classified_at":null}'
  from public.estimate_projects where id='6c000000-0000-4000-8000-000000000002'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a truncated intake source cannot reserve a copy');
update storage.objects set metadata='{"size":8}' where bucket_id='affaire-intake' and name='fixture/intake-plan.pdf';
-- The deployed legacy worker (service role, UUID v4) remains compatible
-- during a migration-first release; new UUID v5 copies require a reservation.
insert into storage.objects (bucket_id,name,metadata)
values ('plan-files','fixture/legacy/44444444-4444-4444-8444-444444444444/legacy.pdf','{"size":8}');
select throws_ok($$insert into storage.objects (bucket_id,name,metadata)
  values ('plan-files','fixture/new/55555555-5555-5555-8555-555555555555/new.pdf','{"size":8}')$$,
  '23503','PLAN_FILE_RESERVATION_REQUIRED','new copy generations cannot upload without a reservation');
-- A derived copy can only be retired through its source lifecycle.
insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
select '6c000000-0000-4000-8000-000000000009',tenant_id,'6c000000-0000-4000-8000-000000000006',
  tenant_id::text || '/6c000000-0000-4000-8000-000000000006/6c000000-0000-4000-8000-000000000009/intake-plan.pdf',
  'intake-plan.pdf','application/pdf',8,
  '{"source":"affaire-intake","intake_document_id":"6c000000-0000-4000-8000-000000000008","intake_storage_path":"fixture/intake-plan.pdf","intake_classified_at":null}'
from public.estimate_projects where id='6c000000-0000-4000-8000-000000000002';
insert into storage.objects (bucket_id,name,metadata)
  select 'plan-files', file_path, '{"size":8}' from public.plan_files where id='6c000000-0000-4000-8000-000000000009';
-- The local Storage API sets this guard for its own transactional delete.
select set_config('storage.allow_delete_query','true',true);
select throws_ok($$delete from storage.objects where bucket_id='plan-files' and name=(select file_path from public.plan_files where id='6c000000-0000-4000-8000-000000000009')$$,
  'P0001','INTAKE_PLAN_DELETE_SOURCE_FIRST','an active intake copy cannot be directly deleted from storage');
select throws_ok($$delete from public.plan_files where id='6c000000-0000-4000-8000-000000000009'$$,
  'P0001','INTAKE_PLAN_DELETE_SOURCE_FIRST','an active intake copy cannot be directly deleted');
select throws_ok($$delete from public.plan_sets where id='6c000000-0000-4000-8000-000000000006'$$,
  'P0001','INTAKE_PLAN_SET_DELETE_SOURCE_FIRST','a set containing intake copies cannot be directly deleted');
select throws_ok($$update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id='6c000000-0000-4000-8000-000000000009'$$,
  'P0001','INTAKE_PLAN_NOT_STALE','an active source cannot be marked for cleanup directly');
create temporary table initial_plan_generation as select plan_copy_generation from public.affaire_intake_documents where id='6c000000-0000-4000-8000-000000000008';
update public.affaire_intake_documents set deletion_token='6c000000-0000-4000-8000-000000000011' where id='6c000000-0000-4000-8000-000000000008';
update public.affaire_intake_documents set deletion_token=null where id='6c000000-0000-4000-8000-000000000008';
select is((select plan_copy_generation from public.affaire_intake_documents where id='6c000000-0000-4000-8000-000000000008'), (select plan_copy_generation from initial_plan_generation), 'an aborted reservation preserves the copy identity');

update public.affaire_intake_documents set document_kind='emails' where id='6c000000-0000-4000-8000-000000000008';
update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id='6c000000-0000-4000-8000-000000000009';
select throws_ok($$update public.plan_files set metadata = metadata - 'intake_cleanup_pending' where id='6c000000-0000-4000-8000-000000000009'$$,
  'P0001','INTAKE_PLAN_CLEANUP_RESERVED','a reserved cleanup cannot be cleared');
select throws_ok($$insert into storage.objects (bucket_id,name,metadata)
  select 'plan-files', file_path, '{"size":8}' from public.plan_files where id='6c000000-0000-4000-8000-000000000009'$$,
  'P0001','INTAKE_PLAN_CLEANUP_PENDING','a late upload is fenced by cleanup reservation');
update public.affaire_intake_documents set document_kind = 'plans', classified_at = now() where id='6c000000-0000-4000-8000-000000000008';
select isnt((select plan_copy_generation from public.affaire_intake_documents where id='6c000000-0000-4000-8000-000000000008'), (select plan_copy_generation from initial_plan_generation), 'reclassification rotates the copy generation');
select throws_ok($$insert into public.plan_files (id,tenant_id,plan_set_id,file_path,file_name,file_type,file_size_bytes,metadata)
  select '6c000000-0000-4000-8000-000000000010',tenant_id,'6c000000-0000-4000-8000-000000000006',
    tenant_id::text || '/6c000000-0000-4000-8000-000000000006/6c000000-0000-4000-8000-000000000010/old.pdf','old.pdf','application/pdf',8,
    '{"source":"affaire-intake","intake_document_id":"6c000000-0000-4000-8000-000000000008","intake_storage_path":"fixture/intake-plan.pdf","intake_classified_at":null}'
  from public.estimate_projects where id='6c000000-0000-4000-8000-000000000002'$$,
  'P0001','INTAKE_PLAN_SOURCE_UNAVAILABLE','a stale classifier cannot create a previous generation');

select * from finish();
rollback;
