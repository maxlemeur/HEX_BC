-- Risk alerts of one takeoff job and estimate version through public.read_takeoff_risk_alerts
-- (supabase/migrations/20261121160259_read_takeoff_risk_alerts.sql): the function checks once per statement what the
-- select policy of estimate_risk_alerts checks per alert, so the risk radar and the DPGF comparison of a large estimate
-- stay under the 8 s statement_timeout of the API roles (57014). It is security definer and callable by any
-- authenticated user through PostgREST, so its rows must be exactly those the policy shows: this file compares them for
-- every role and pins the policies it restates.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

\ir ../fixtures/copy-items-estimate.sql

-- Besides the fixture's owner (01, engineer), admin (02), engineer (03), viewer (04) and outsider (05): a director of
-- the tenant (06) and a platform admin who is not a member of it (07).
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
select '00000000-0000-0000-0000-000000000000', ('29300000-0000-4000-8000-00000000000' || n)::uuid, 'authenticated',
  'authenticated', 'copy-items-' || n || '@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
from generate_series(6, 7) n;
insert into public.tenant_memberships (tenant_id, user_id, role)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000006', 'director');
select set_config('test.other_tenant_id', (select tenant_id::text from public.tenant_memberships
  where user_id = '29300000-0000-4000-8000-000000000005' limit 1), true);
-- The select policy reads the caller's current tenant: the owner's is the active tenant of its other members too, so
-- that their role, not their tenant, decides what they read.
update public.tenant_memberships set is_default = false
where user_id in ('29300000-0000-4000-8000-000000000002', '29300000-0000-4000-8000-000000000003',
  '29300000-0000-4000-8000-000000000004', '29300000-0000-4000-8000-000000000006');
update public.tenant_memberships set is_default = true
where tenant_id = current_setting('test.tenant_id')::uuid
  and user_id in ('29300000-0000-4000-8000-000000000002', '29300000-0000-4000-8000-000000000003',
    '29300000-0000-4000-8000-000000000004', '29300000-0000-4000-8000-000000000006');

-- V1: the job's version; V2: a version the job is linked to from V1; V3: a version of the affaire without a link.
-- A second affaire of the owner (11), in the same tenant.
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000111', 0, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000311') is null as job_version_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000112', 0, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000312') is null as linked_version_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000113', 0, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000313') is null as unlinked_version_created;
insert into public.estimate_projects (id, tenant_id, user_id, name) values
  ('29300000-0000-4000-8000-000000000011', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000001', 'RA affaire 2');

-- J1: a completed job of V1. J2: a job of the affaire without a version. J3: a job of V1 recorded under the second
-- affaire, readable only through its send receipt (added below).
insert into public.takeoff_jobs (id, tenant_id, estimate_version_id, level, status, source_file_name, created_by)
values ('29300000-0000-4000-8000-000000000501', current_setting('test.tenant_id')::uuid,
  '29300000-0000-4000-8000-000000000111', 'B', 'completed', 'plan-fictif.pdf', '29300000-0000-4000-8000-000000000001');
alter table public.takeoff_jobs disable trigger user;
insert into public.takeoff_jobs (id, tenant_id, project_id, estimate_version_id, level, status, source_file_name, created_by)
values
  ('29300000-0000-4000-8000-000000000502', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000010', null, 'B', 'completed', 'plan-fictif.pdf',
   '29300000-0000-4000-8000-000000000001'),
  ('29300000-0000-4000-8000-000000000503', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000011', '29300000-0000-4000-8000-000000000111', 'B', 'completed', 'plan-fictif.pdf',
   '29300000-0000-4000-8000-000000000001');
alter table public.takeoff_jobs enable trigger user;
insert into public.takeoff_version_links (tenant_id, takeoff_job_id, source_version_id, target_version_id)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000501',
  '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000112');

-- `p_count` alerts of (`p_version`, `p_job`), one lot each, every third one inactive; the trigger sets their tenant and
-- project from the version.
create function pg_temp.ra_alerts(p_version uuid, p_job uuid, p_count integer, p_prefix text) returns bigint
language sql as $$
  with inserted as (
    insert into public.estimate_risk_alerts (tenant_id, project_id, version_id, takeoff_job_id, scope_type, scope_ref,
      scope_label, cause_code, severity, risk_score, is_active)
    select current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000010', p_version, p_job, 'lot',
      p_prefix || '-' || n, 'Lot ' || n, 'missing_proof', 'warning', 40, n % 3 <> 0
    from generate_series(1, p_count) n
    returning 1
  )
  select count(*) from inserted
$$;
select is(pg_temp.ra_alerts('29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', 30, 'v1j1'),
  30::bigint, '30 alerts of the job on its version');
select is(pg_temp.ra_alerts('29300000-0000-4000-8000-000000000112', '29300000-0000-4000-8000-000000000501', 5, 'v2j1'),
  5::bigint, '5 alerts of the job on the linked version');
select is(pg_temp.ra_alerts('29300000-0000-4000-8000-000000000113', '29300000-0000-4000-8000-000000000501', 4, 'v3j1'),
  4::bigint, '4 alerts of the job on a version it has no link to');
select is(pg_temp.ra_alerts('29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000502', 3, 'v1j2'),
  3::bigint, '3 alerts of the job without a version');
select is(pg_temp.ra_alerts('29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000503', 6, 'v1j3'),
  6::bigint, '6 alerts of the job readable through its send receipt');
-- An alert of the job on its version whose project is not the version's, a row the trigger never writes.
alter table public.estimate_risk_alerts disable trigger user;
insert into public.estimate_risk_alerts (tenant_id, project_id, version_id, takeoff_job_id, scope_type, scope_ref,
  scope_label, cause_code, severity, risk_score)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000011',
  '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', 'project', 'other-project',
  'Autre affaire', 'missing_piece', 'info', 10);
alter table public.estimate_risk_alerts enable trigger user;

-- The alerts of (`p_tenant`, `p_version`, `p_job`) that `p_actor` reads through the function (`p_function`) or the table
-- under its policy, as the API role PostgREST sets (`p_role`), with the platform admin claim when `p_platform_admin`.
create function pg_temp.ra_ids(p_actor uuid, p_platform_admin boolean, p_tenant uuid, p_version uuid, p_job uuid,
  p_function boolean, p_role text default 'authenticated') returns uuid[] language plpgsql as $$
declare
  ids uuid[];
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', p_role, 'app_metadata',
    case when p_platform_admin then '{"role":"admin"}'::jsonb else '{}'::jsonb end)::text, true);
  perform set_config('role', p_role, true);
  if p_function then
    select coalesce(array_agg(alert.id order by alert.id), '{}') into ids
    from public.read_takeoff_risk_alerts(p_tenant, p_version, p_job) alert;
  else
    select coalesce(array_agg(alert.id order by alert.id), '{}') into ids
    from public.estimate_risk_alerts alert
    where alert.tenant_id = p_tenant and alert.version_id = p_version and alert.takeoff_job_id = p_job;
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return ids;
end
$$;

create temporary table ra_actor (label text, actor uuid, platform_admin boolean, visible boolean);
insert into ra_actor values
  ('the owner (engineer)', '29300000-0000-4000-8000-000000000001', false, true),
  ('an admin', '29300000-0000-4000-8000-000000000002', false, true),
  ('an engineer who does not own the affaire', '29300000-0000-4000-8000-000000000003', false, false),
  ('a viewer', '29300000-0000-4000-8000-000000000004', false, false),
  ('a member of another tenant', '29300000-0000-4000-8000-000000000005', false, false),
  ('a director', '29300000-0000-4000-8000-000000000006', false, false),
  ('the platform admin, outside the tenant', '29300000-0000-4000-8000-000000000007', true, false),
  ('a request without a user', null, false, false);

create temporary table ra_case (label text, tenant_id uuid, version_id uuid, job_id uuid, owner_reads integer);
insert into ra_case values
  ('the job on its version', current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111',
   '29300000-0000-4000-8000-000000000501', 30),
  ('the job on the version it is linked to', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000112', '29300000-0000-4000-8000-000000000501', 5),
  ('the job on a version it has no link to', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000113', '29300000-0000-4000-8000-000000000501', 0),
  ('a job without a version', current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111',
   '29300000-0000-4000-8000-000000000502', 0),
  ('a job of another affaire, before its send receipt', current_setting('test.tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000503', 0),
  ('the job and version named under another tenant', current_setting('test.other_tenant_id')::uuid,
   '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', 0),
  ('an unknown job', current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111',
   gen_random_uuid(), 0);

-- Equivalence with the policy, for every role and case, and the rows it shows.
select is(pg_temp.ra_ids(actor, platform_admin, c.tenant_id, c.version_id, c.job_id, true),
  pg_temp.ra_ids(actor, platform_admin, c.tenant_id, c.version_id, c.job_id, false),
  format('%s, %s: the function returns the alerts the select policy shows', a.label, c.label))
from ra_actor a cross join ra_case c;
select is(cardinality(pg_temp.ra_ids(actor, platform_admin, c.tenant_id, c.version_id, c.job_id, true)),
  case when a.visible then c.owner_reads else 0 end,
  format('%s, %s: %s alerts', a.label, c.label, case when a.visible then c.owner_reads else 0 end))
from ra_actor a cross join ra_case c;

-- The job of another affaire becomes readable to the owner through its send receipt (the second branch of the select
-- policy of takeoff_jobs), and its alerts with it.
alter table public.takeoff_send_receipts disable trigger user;
insert into public.takeoff_send_receipts (tenant_id, project_id, job_id, request_id, format_version, actor_id,
  payload_hash, preview_fingerprint, destination, target_version_id, write_plan, result)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000011',
  '29300000-0000-4000-8000-000000000503', gen_random_uuid(), 1, '29300000-0000-4000-8000-000000000001',
  repeat('a', 64), repeat('b', 64), '{}'::jsonb, '29300000-0000-4000-8000-000000000111', '{}'::jsonb, '{}'::jsonb);
alter table public.takeoff_send_receipts enable trigger user;
select is(pg_temp.ra_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000503', true),
  pg_temp.ra_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000503', false),
  label || ', a job of another affaire with its send receipt: the function returns the alerts the select policy shows')
from ra_actor;
select is(cardinality(pg_temp.ra_ids('29300000-0000-4000-8000-000000000001', false,
    current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111',
    '29300000-0000-4000-8000-000000000503', true)), 6,
  'the owner reads the 6 alerts of the job of another affaire once it has its send receipt');

-- An inactive tenant: no member, nor the platform admin, reads its alerts.
update public.tenants set is_active = false where id = current_setting('test.tenant_id')::uuid;
select is(pg_temp.ra_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', true),
  pg_temp.ra_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', false),
  label || ': in an inactive tenant, the function returns what the policy shows')
from ra_actor;
select is(cardinality(pg_temp.ra_ids('29300000-0000-4000-8000-000000000001', false,
    current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111',
    '29300000-0000-4000-8000-000000000501', true)), 0,
  'the owner reads no alert of an inactive tenant');
update public.tenants set is_active = true where id = current_setting('test.tenant_id')::uuid;

-- The service role bypasses RLS on the table: every alert of the job and version, none under another tenant.
select is(pg_temp.ra_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', true, 'service_role'),
  pg_temp.ra_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', false, 'service_role'),
  'the service role reads every alert of the job and version, as from the table');
select is(cardinality(pg_temp.ra_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', true, 'service_role')), 31,
  'the service role reads the 31 alerts, the one of another project included');
select is(pg_temp.ra_ids(null, false, current_setting('test.other_tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', '29300000-0000-4000-8000-000000000501', true, 'service_role'),
  '{}'::uuid[], 'the service role reads no alert when the job and version are named under another tenant');

-- Grants and definition.
select ok(has_function_privilege('authenticated', 'public.read_takeoff_risk_alerts(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.read_takeoff_risk_alerts(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_takeoff_risk_alerts(uuid,uuid,uuid)', 'execute'),
  'read_takeoff_risk_alerts is executable by authenticated and service_role, not by anon');
select ok((select procedure.prosecdef and procedure.provolatile = 's' and procedure.proconfig = array['search_path=""']
    from pg_proc procedure where procedure.oid = 'public.read_takeoff_risk_alerts(uuid,uuid,uuid)'::regprocedure),
  'read_takeoff_risk_alerts is a stable security definer function with an empty search_path');

-- The policies the function restates: those that let authenticated read estimate_risk_alerts, takeoff_jobs,
-- takeoff_version_links, estimate_versions and estimate_projects. A change to any of them must change the function and
-- this file with it.
select is(
  (select string_agg(format('%s | %s | %s | %s | %s | %s', policy.tablename, policy.policyname, policy.permissive,
      policy.cmd, policy.roles, regexp_replace(policy.qual, '\s+', ' ', 'g')), E'\n' order by policy.tablename, policy.policyname)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('estimate_risk_alerts', 'takeoff_jobs', 'takeoff_version_links', 'estimate_versions',
        'estimate_projects')
      and policy.cmd in ('SELECT', 'ALL')),
  concat_ws(E'\n',
    'estimate_projects | Tenant directors can view estimate projects | PERMISSIVE | SELECT | {authenticated} | (( SELECT is_tenant_member(estimate_projects.tenant_id) AS is_tenant_member) AND ( SELECT has_tenant_role(estimate_projects.tenant_id, ARRAY[''director''::tenant_role]) AS has_tenant_role))',
    'estimate_projects | Users can manage estimate projects | PERMISSIVE | ALL | {authenticated} | (( SELECT is_tenant_member(estimate_projects.tenant_id) AS is_tenant_member) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_tenant_role(estimate_projects.tenant_id, ARRAY[''admin''::tenant_role]) AS has_tenant_role)))',
    'estimate_risk_alerts | Current tenant can select estimate risk alerts | PERMISSIVE | SELECT | {authenticated} | ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND (EXISTS ( SELECT 1 FROM (takeoff_jobs tj JOIN estimate_versions target ON ((target.id = estimate_risk_alerts.version_id))) WHERE ((tj.id = estimate_risk_alerts.takeoff_job_id) AND (tj.tenant_id = estimate_risk_alerts.tenant_id) AND (target.project_id = estimate_risk_alerts.project_id) AND ((tj.estimate_version_id = estimate_risk_alerts.version_id) OR (EXISTS ( SELECT 1 FROM takeoff_version_links tvl WHERE ((tvl.tenant_id = estimate_risk_alerts.tenant_id) AND (tvl.target_version_id = estimate_risk_alerts.version_id) AND (tvl.takeoff_job_id = estimate_risk_alerts.takeoff_job_id))))) AND ( SELECT can_access_takeoff_estimate_version(estimate_risk_alerts.version_id, estimate_risk_alerts.tenant_id) AS can_access_takeoff_estimate_version) AND ( SELECT can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_risk_alerts.tenant_id) AS can_access_takeoff_estimate_version)))))',
    'estimate_versions | Tenant directors can view estimate versions | PERMISSIVE | SELECT | {authenticated} | (EXISTS ( SELECT 1 FROM estimate_projects p WHERE ((p.id = estimate_versions.project_id) AND (p.tenant_id = estimate_versions.tenant_id) AND ( SELECT is_tenant_member(p.tenant_id) AS is_tenant_member) AND ( SELECT has_tenant_role(p.tenant_id, ARRAY[''director''::tenant_role]) AS has_tenant_role))))',
    'estimate_versions | Users can manage estimate versions | PERMISSIVE | ALL | {authenticated} | (EXISTS ( SELECT 1 FROM estimate_projects p WHERE ((p.id = estimate_versions.project_id) AND (p.tenant_id = estimate_versions.tenant_id) AND ( SELECT is_tenant_member(p.tenant_id) AS is_tenant_member) AND ((p.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_tenant_role(p.tenant_id, ARRAY[''admin''::tenant_role]) AS has_tenant_role)))))',
    'takeoff_jobs | Current tenant can select takeoff jobs | PERMISSIVE | SELECT | {authenticated} | (( SELECT private.can_access_takeoff_scope(takeoff_jobs.tenant_id, takeoff_jobs.project_id, takeoff_jobs.estimate_version_id, false) AS can_access_takeoff_scope) OR ( SELECT private.can_read_sent_takeoff_job(takeoff_jobs.tenant_id, takeoff_jobs.project_id, takeoff_jobs.id) AS can_read_sent_takeoff_job))',
    'takeoff_version_links | Current tenant can select takeoff version links | PERMISSIVE | SELECT | {authenticated} | ((tenant_id = ( SELECT current_tenant_id() AS current_tenant_id)) AND ( SELECT can_access_takeoff_estimate_version(takeoff_version_links.source_version_id, takeoff_version_links.tenant_id) AS can_access_takeoff_estimate_version) AND ( SELECT can_access_takeoff_estimate_version(takeoff_version_links.target_version_id, takeoff_version_links.tenant_id) AS can_access_takeoff_estimate_version) AND (EXISTS ( SELECT 1 FROM takeoff_jobs tj WHERE ((tj.id = takeoff_version_links.takeoff_job_id) AND (tj.tenant_id = takeoff_version_links.tenant_id) AND (tj.estimate_version_id = takeoff_version_links.source_version_id) AND ( SELECT can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id) AS can_access_takeoff_estimate_version)))))'),
  'the select policies read_takeoff_risk_alerts restates are unchanged');

select * from finish();
rollback;
