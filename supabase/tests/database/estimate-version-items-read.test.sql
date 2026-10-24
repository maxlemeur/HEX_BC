-- Items of one estimate version through public.read_estimate_version_items
-- (supabase/migrations/20261024130000_read_estimate_version_items.sql): the function checks once per statement what
-- the select policy of estimate_items checks per item, so the estimate, risk radar, DPGF comparison and affaire hub
-- reads of a large version no longer depend on Postgres's statistics to stay under the 8 s statement_timeout of the
-- API roles (57014). It is security definer and callable by any authenticated user through PostgREST, so its rows
-- must be exactly those the policy shows: this file compares them for every role and pins the policies it restates.
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

-- V: 40 lines under one section; W: another version of the same affaire, 3 lines.
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000111', 40, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000311') is not null as version_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000112', 3, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000312') is not null as other_version_created;

-- The items of (`p_tenant`, `p_version`) that `p_actor` reads through the function (`p_function`) or the table under
-- its policy, as the API role PostgREST sets (`p_role`), with the platform admin claim when `p_platform_admin`.
create function pg_temp.vi_ids(p_actor uuid, p_platform_admin boolean, p_tenant uuid, p_version uuid,
  p_function boolean, p_role text default 'authenticated') returns uuid[] language plpgsql as $$
declare
  ids uuid[];
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_actor, 'role', p_role, 'app_metadata',
    case when p_platform_admin then '{"role":"admin"}'::jsonb else '{}'::jsonb end)::text, true);
  perform set_config('role', p_role, true);
  if p_function then
    select coalesce(array_agg(item.id order by item.id), '{}') into ids
    from public.read_estimate_version_items(p_tenant, p_version) item;
  else
    select coalesce(array_agg(item.id order by item.id), '{}') into ids
    from public.estimate_items item where item.tenant_id = p_tenant and item.version_id = p_version;
  end if;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return ids;
end
$$;

create temporary table vi_actor (label text, actor uuid, platform_admin boolean, visible integer);
insert into vi_actor values
  ('the owner (engineer)', '29300000-0000-4000-8000-000000000001', false, 41),
  ('an admin', '29300000-0000-4000-8000-000000000002', false, 41),
  ('an engineer who does not own the affaire', '29300000-0000-4000-8000-000000000003', false, 0),
  ('a viewer', '29300000-0000-4000-8000-000000000004', false, 0),
  ('a member of another tenant', '29300000-0000-4000-8000-000000000005', false, 0),
  ('a director', '29300000-0000-4000-8000-000000000006', false, 41),
  ('the platform admin, outside the tenant', '29300000-0000-4000-8000-000000000007', true, 41),
  ('a request without a user', null, false, 0);

-- Equivalence with the policy, for every role, and the rows it shows.
select is(pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true),
  pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', false),
  label || ': the function returns the items the select policy shows')
from vi_actor;
select is(cardinality(pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true)), visible,
  format('%s: %s of the 41 items', label, visible))
from vi_actor;

-- Another version, another tenant, an unknown version.
select is(pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000112', true),
  pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000112', false),
  label || ': the items of another version of the affaire are those the policy shows')
from vi_actor;
select is(cardinality(pg_temp.vi_ids('29300000-0000-4000-8000-000000000001', false,
    current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000112', true)), 4,
  'the owner reads the 4 items of the other version, none of the first');
select is(pg_temp.vi_ids(actor, platform_admin, current_setting('test.other_tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true), '{}'::uuid[],
  label || ': no item when the version is named under another tenant')
from vi_actor;
select is(pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid, gen_random_uuid(), true),
  '{}'::uuid[], label || ': no item for an unknown version')
from vi_actor;

-- An inactive tenant: no member, nor the platform admin, reads its items.
update public.tenants set is_active = false where id = current_setting('test.tenant_id')::uuid;
select is(pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true),
  pg_temp.vi_ids(actor, platform_admin, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', false),
  label || ': in an inactive tenant, the function returns what the policy shows')
from vi_actor;
select is(cardinality(pg_temp.vi_ids('29300000-0000-4000-8000-000000000001', false,
    current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000111', true)), 0,
  'the owner reads no item of an inactive tenant');
update public.tenants set is_active = true where id = current_setting('test.tenant_id')::uuid;

-- The service role bypasses RLS on the table: every item of the version, none under another tenant.
select is(pg_temp.vi_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true, 'service_role'),
  pg_temp.vi_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', false, 'service_role'),
  'the service role reads every item of the version, as from the table');
select is(cardinality(pg_temp.vi_ids(null, false, current_setting('test.tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true, 'service_role')), 41, 'the service role reads the 41 items');
select is(pg_temp.vi_ids(null, false, current_setting('test.other_tenant_id')::uuid,
    '29300000-0000-4000-8000-000000000111', true, 'service_role'), '{}'::uuid[],
  'the service role reads no item when the version is named under another tenant');

-- Grants and definition.
select ok(has_function_privilege('authenticated', 'public.read_estimate_version_items(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.read_estimate_version_items(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_estimate_version_items(uuid,uuid)', 'execute'),
  'read_estimate_version_items is executable by authenticated and service_role, not by anon');
select ok((select procedure.prosecdef and procedure.provolatile = 's' and procedure.proconfig = array['search_path=""']
    from pg_proc procedure where procedure.oid = 'public.read_estimate_version_items(uuid,uuid)'::regprocedure),
  'read_estimate_version_items is a stable security definer function with an empty search_path');

-- The policies the function restates: those that let authenticated read estimate_items, estimate_versions and
-- estimate_projects. A change to any of them must change the function and this file with it.
select is(
  (select string_agg(format('%s | %s | %s | %s | %s | %s', policy.tablename, policy.policyname, policy.permissive,
      policy.cmd, policy.roles, regexp_replace(policy.qual, '\s+', ' ', 'g')), E'\n' order by policy.tablename, policy.policyname)
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in ('estimate_items', 'estimate_versions', 'estimate_projects')
      and policy.cmd in ('SELECT', 'ALL')),
  concat_ws(E'\n',
    'estimate_items | Users can view estimate items | PERMISSIVE | SELECT | {authenticated} | (EXISTS ( SELECT 1 FROM (estimate_versions v JOIN estimate_projects p ON ((p.id = v.project_id))) WHERE ((v.id = estimate_items.version_id) AND (v.tenant_id = estimate_items.tenant_id) AND ( SELECT is_tenant_member(v.tenant_id) AS is_tenant_member) AND ((p.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_tenant_role(v.tenant_id, ARRAY[''admin''::tenant_role, ''director''::tenant_role]) AS has_tenant_role)))))',
    'estimate_projects | Tenant directors can view estimate projects | PERMISSIVE | SELECT | {authenticated} | (( SELECT is_tenant_member(estimate_projects.tenant_id) AS is_tenant_member) AND ( SELECT has_tenant_role(estimate_projects.tenant_id, ARRAY[''director''::tenant_role]) AS has_tenant_role))',
    'estimate_projects | Users can manage estimate projects | PERMISSIVE | ALL | {authenticated} | (( SELECT is_tenant_member(estimate_projects.tenant_id) AS is_tenant_member) AND ((user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_tenant_role(estimate_projects.tenant_id, ARRAY[''admin''::tenant_role]) AS has_tenant_role)))',
    'estimate_versions | Tenant directors can view estimate versions | PERMISSIVE | SELECT | {authenticated} | (EXISTS ( SELECT 1 FROM estimate_projects p WHERE ((p.id = estimate_versions.project_id) AND (p.tenant_id = estimate_versions.tenant_id) AND ( SELECT is_tenant_member(p.tenant_id) AS is_tenant_member) AND ( SELECT has_tenant_role(p.tenant_id, ARRAY[''director''::tenant_role]) AS has_tenant_role))))',
    'estimate_versions | Users can manage estimate versions | PERMISSIVE | ALL | {authenticated} | (EXISTS ( SELECT 1 FROM estimate_projects p WHERE ((p.id = estimate_versions.project_id) AND (p.tenant_id = estimate_versions.tenant_id) AND ( SELECT is_tenant_member(p.tenant_id) AS is_tenant_member) AND ((p.user_id = ( SELECT auth.uid() AS uid)) OR ( SELECT has_tenant_role(p.tenant_id, ARRAY[''admin''::tenant_role]) AS has_tenant_role)))))'),
  'the select policies read_estimate_version_items restates are unchanged');

select * from finish();
rollback;
