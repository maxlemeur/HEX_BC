-- TI-685 / partial TI-686: SQL boundary tests.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local client_min_messages = warning;
select no_plan();

-- Fixtures -----------------------------------------------------------------------------------------------

create temporary table decisions_outcome (case_name text primary key, outcome text) on commit drop;
grant all on decisions_outcome to authenticated;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
values
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'material-engineer@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '9e000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'material-admin@example.test', crypt('test-password', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', '');

update public.tenant_memberships set role = 'engineer'::public.tenant_role
where user_id = '9e000000-0000-4000-8000-000000000001';
select set_config('test.tenant_id', (select membership.tenant_id::text from public.tenant_memberships membership
  where membership.user_id = '9e000000-0000-4000-8000-000000000001' limit 1), true);
update public.tenant_memberships set is_default = false where user_id = '9e000000-0000-4000-8000-000000000002';
insert into public.tenant_memberships (tenant_id, user_id, role, is_default, created_at)
values (current_setting('test.tenant_id')::uuid, '9e000000-0000-4000-8000-000000000002', 'admin', true, '2020-01-01');

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
values ('9e000000-0000-4000-8000-000000000010', current_setting('test.tenant_id')::uuid,
  '9e000000-0000-4000-8000-000000000001', 'Décisions sur les règles (fictif)', false);

-- Versions ...101 to ...109, one job each (...301 to ...309), and a section to apply into.
insert into public.estimate_versions (id, tenant_id, project_id, version_number, status, calc_engine_version, margin_multiplier, tax_rate_bp)
select ('9e000000-0000-4000-8000-00000000010' || n)::uuid, current_setting('test.tenant_id')::uuid,
  '9e000000-0000-4000-8000-000000000010', n, 'draft', 2, 1, 0
from generate_series(1, 9) as n;

insert into public.estimate_items (id, tenant_id, version_id, item_type, position, title)
select ('9e000000-0000-4000-8000-0000000002' || right(version.id::text, 2))::uuid, version.tenant_id, version.id, 'section', 0, 'Lot fictif'
from public.estimate_versions version
where version.project_id = '9e000000-0000-4000-8000-000000000010';

-- ...301 the verified line and its partner (level A); ...302 the user's decisions; ...303 to ...309 one override each
-- (...304 level C: its line blocks on a low confidence, no rule reads it).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
select ('9e000000-0000-4000-8000-00000000030' || n)::uuid, current_setting('test.tenant_id')::uuid,
  ('9e000000-0000-4000-8000-00000000010' || n)::uuid, case when n = 4 then 'C' else 'A' end::public.takeoff_job_level,
  'completed', 'plan-fictif.pdf', '9e000000-0000-4000-8000-000000000001'
from generate_series(1, 9) as n;


-- TI-685/TI-686 boundary cases written before implementation: raw Data API verification, blocked gas,
-- missing/wrong PE reasons, atomic audit, and clearing a justification when content changes.
insert into public.takeoff_items (id, tenant_id, job_id, designation, quantity, unit, confidence, evidence,
 source_page, rule_results, rules_evaluated_at)
select ('9e000000-0000-4000-8000-00000000040' || n)::uuid, current_setting('test.tenant_id')::uuid,
 '9e000000-0000-4000-8000-000000000301', 'Réseau fictif', 5, 'ml', 0.95, 'Plan p1', 1,
 jsonb_build_array(jsonb_build_object('rule','dn_network','status','fail','version',2,
 'code',case when n=3 then 'DN_NETWORK_MATERIAL_BLOCKED' else 'DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION' end,
 'acceptable',n<>3,'reason','Fictif')), now()
from generate_series(1,3) n;
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub','9e000000-0000-4000-8000-000000000001', 'role','authenticated')::text, true);

select throws_ok($q$update public.takeoff_items set is_verified=true, verified_by=auth.uid(), verified_at=now()
 where id='9e000000-0000-4000-8000-000000000401'$q$, '23514', 'TAKEOFF_RULE_JUSTIFICATION_REQUIRED',
 'Data API cannot bypass the technical justification');
select throws_ok($q$update public.takeoff_items set is_verified=true, verified_by=auth.uid(), verified_at=now(),
 verification_justification='{"reason_code":"system_documented","system_reference":"Fabricant fictif, gamme G, certificat C"}'
 where id='9e000000-0000-4000-8000-000000000401'$q$, '23514', 'TAKEOFF_RULE_GAS_PE_REASON_REQUIRED',
 'PE gas accepts only a qualified external installation reason');
select throws_ok($q$update public.takeoff_items set is_verified=true, verified_by=auth.uid(), verified_at=now(),
 verification_justification='{"reason_code":"gas_pe_buried_outside","system_reference":"Fabricant fictif, gamme G, certificat C"}'
 where id='9e000000-0000-4000-8000-000000000403'$q$, '23514', 'TAKEOFF_RULE_NOT_ACCEPTABLE',
 'blocked material cannot be verified even with a reason');
select lives_ok($q$select * from public.update_takeoff_item_for_review(current_setting('test.tenant_id')::uuid,
 '9e000000-0000-4000-8000-000000000301','9e000000-0000-4000-8000-000000000401',
 (select updated_at from public.takeoff_items where id='9e000000-0000-4000-8000-000000000401'),
 jsonb_build_object('is_verified',true,'verified_by',auth.uid(),'verified_at',now(),
 'verification_justification',jsonb_build_object('reason_code','gas_pe_buried_outside',
 'system_reference','Fabricant fictif, gamme G, certificat C')))$q$, 'review RPC saves a qualified justification');
select ok((select is_verified from public.takeoff_items where id='9e000000-0000-4000-8000-000000000401'),
 'qualified acceptance is persisted');
reset role;
select ok(exists(select 1 from public.audit_logs where record_id='9e000000-0000-4000-8000-000000000301'
 and after_data #>> '{metadata,field}'='is_verified'
 and after_data #>> '{metadata,justification,reason_code}'='gas_pe_buried_outside'
 and after_data #> '{metadata,rule_failures}' @> '["dn_network|DN_NETWORK_GAS_PE_REQUIRES_JUSTIFICATION|2|"]'::jsonb),
 'same transaction records reason and acknowledged rule identities');
set local role authenticated;
update public.takeoff_items set quantity=6 where id='9e000000-0000-4000-8000-000000000401';
select ok((select not is_verified and verification_justification is null from public.takeoff_items
 where id='9e000000-0000-4000-8000-000000000401'), 'content edit clears verification and its justification');
reset role;
select * from finish();
rollback;
