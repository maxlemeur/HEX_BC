begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
values ('00000000-0000-0000-0000-000000000000','6d000000-0000-4000-8000-000000000001','authenticated','authenticated','optional-docs@example.test',crypt('fictional-password', gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','');
insert into public.estimate_projects (id,tenant_id,user_id,name)
select '6d000000-0000-4000-8000-000000000002',tenant_id,user_id,'Optional documents migration fixture'
from public.tenant_memberships where user_id='6d000000-0000-4000-8000-000000000001';
insert into public.affaire_register_entries (project_id,kind,code,text,severity,status,origin_kind,scope_type,scope_label,sync_key,metadata)
values
 ('6d000000-0000-4000-8000-000000000002','missing_piece','missing_dpgf','DPGF manquant','critical','open','system','project','Fixture','missing_piece:missing_dpgf','{}'),
 ('6d000000-0000-4000-8000-000000000002','missing_piece','missing_plans','Plans demandés explicitement','critical','open','system','project','Fixture','missing_piece:missing_plans',
  '{"severityDecision":{"mode":"manual","canonicalSeverity":"critical","overriddenSeverity":"critical","updatedAt":"2026-11-01T12:00:00.000Z","updatedByUserId":"6d000000-0000-4000-8000-000000000001"}}'),
 ('6d000000-0000-4000-8000-000000000002','missing_piece','missing_cctp','CCTP à revalider','critical','validated','system','project','Fixture','missing_piece:missing_cctp',
  '{"revalidationRequest":{"status":"required"}}'),
 ('6d000000-0000-4000-8000-000000000002','missing_piece',null,'Accord écrit du client','critical','open','manual','project','Fixture',null,'{}');
-- Replay against populated legacy rows without a service JWT, as real migrations
-- run as the DB owner. This catches authorization failures an empty replay cannot.
select set_config('request.jwt.claims','{}',true);
\ir ../../migrations/20261111130710_optional_dossier_documents.sql
select is(auth.jwt(), '{}'::jsonb, 'migration restores its caller claims');
select is((select severity from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_dpgf'),'warning','existing automatic DPGF gap becomes advisory');
select is((select status from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_dpgf'),'open','the advisory trace stays open');
select is((select severity from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_plans'),'critical','a human-required plan stays critical');
select is((select metadata #>> '{severityDecision,canonicalSeverity}' from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_plans'),'warning','resetting the human override will use the optional default');
select is((select metadata->'businessImpact' ? 'blocks_submission' from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_plans'),true,'a manual critical gap still blocks submission');
select is((select severity from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and origin_kind='manual'),'critical','manual entries are unchanged');
select is((select status from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_cctp'),'validated','backfill preserves the reviewed status');
select is((select metadata #>> '{revalidationRequest,status}' from public.affaire_register_entries where project_id='6d000000-0000-4000-8000-000000000002' and code='missing_cctp'),'required','an explicit revalidation is preserved');
select is((select count(*) from public.affaire_register_events where project_id='6d000000-0000-4000-8000-000000000002' and reason='intake.optional_documents'),3::bigint,'each system-policy change is audited');
select * from finish();
rollback;
