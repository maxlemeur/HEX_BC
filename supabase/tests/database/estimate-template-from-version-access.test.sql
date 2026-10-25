-- Saving a version as a template checks access once, then copies every item.
-- supabase/migrations/20261025094300_template_from_version_checked_once.sql.
-- PG1000 (TesterArmy full 40176721283) answered 400 / 57014 because the invoker
-- function paid the item policies once per row of a 2 501-line version. This file
-- pins the security-definer boundary and that same volume under the API role's
-- 8 s statement timeout.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

\ir ../fixtures/copy-items-estimate.sql

-- A director (06) besides the fixture's owner, admin, engineer, viewer and outsider.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
values (
  '00000000-0000-0000-0000-000000000000', '29300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated',
  'copy-items-6@example.test', crypt('test-password', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), '', '', '', ''
);
insert into public.tenant_memberships (tenant_id, user_id, role)
values (current_setting('test.tenant_id')::uuid, '29300000-0000-4000-8000-000000000006', 'director');

-- 2 501 lines under one section: the volume PG1000 saves as a template.
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000211', 2501, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000411') is not null as large_version_created;

create function pg_temp.tpl_as(p_actor uuid, p_role text default 'authenticated') returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_actor::text, ''), true);
  perform set_config('request.jwt.claims', case
    when p_actor is null then jsonb_build_object('role', p_role)
    else jsonb_build_object('sub', p_actor, 'role', p_role) end::text, true);
  perform set_config('role', p_role, true);
end
$$;

-- Grants and definition.
select ok(
  has_function_privilege('authenticated', 'public.create_estimate_template_from_version(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.create_estimate_template_from_version(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.create_estimate_template_from_version(uuid,text,text)', 'execute'),
  'create_estimate_template_from_version is executable by authenticated and service_role, not by anon');
select ok(
  has_function_privilege('authenticated', 'public.read_estimate_template_items(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.read_estimate_template_items(uuid,uuid)', 'execute')
  and not has_function_privilege('anon', 'public.read_estimate_template_items(uuid,uuid)', 'execute'),
  'read_estimate_template_items is executable by authenticated and service_role, not by anon');
select ok(
  has_function_privilege('authenticated', 'public.count_estimate_template_lines(uuid,uuid[])', 'execute')
  and has_function_privilege('service_role', 'public.count_estimate_template_lines(uuid,uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.count_estimate_template_lines(uuid,uuid[])', 'execute'),
  'count_estimate_template_lines is executable by authenticated and service_role, not by anon');

select ok((select procedure.prosecdef and procedure.provolatile = 'v' and procedure.proconfig = array['search_path=""']
    from pg_proc procedure
    where procedure.oid = 'public.create_estimate_template_from_version(uuid,text,text)'::regprocedure),
  'create_estimate_template_from_version is a volatile security definer function with an empty search_path');
select ok((select procedure.prosecdef and procedure.provolatile = 's' and procedure.proconfig = array['search_path=""']
    from pg_proc procedure
    where procedure.oid = 'public.read_estimate_template_items(uuid,uuid)'::regprocedure),
  'read_estimate_template_items is a stable security definer function with an empty search_path');
select ok((select procedure.prosecdef and procedure.provolatile = 's' and procedure.proconfig = array['search_path=""']
    from pg_proc procedure
    where procedure.oid = 'public.count_estimate_template_lines(uuid,uuid[])'::regprocedure),
  'count_estimate_template_lines is a stable security definer function with an empty search_path');

-- Refusals happen before any copy.
select pg_temp.tpl_as('29300000-0000-4000-8000-000000000003');
select throws_ok(
  $$select public.create_estimate_template_from_version('29300000-0000-4000-8000-000000000211', 'PG1000 refus ingénieur', null)$$,
  'P0001', 'Template source version not found or access denied',
  'an engineer who does not own the affaire cannot save it as a template');

select pg_temp.tpl_as('29300000-0000-4000-8000-000000000005');
select throws_ok(
  $$select public.create_estimate_template_from_version('29300000-0000-4000-8000-000000000211', 'PG1000 refus extérieur', null)$$,
  'P0001', 'Template source version not found or access denied',
  'a member of another tenant cannot save the version as a template');

select pg_temp.tpl_as(null);
select throws_ok(
  $$select public.create_estimate_template_from_version('29300000-0000-4000-8000-000000000211', 'PG1000 refus anonyme', null)$$,
  'P0001', 'Authentication required',
  'a request without a user cannot save a template');

-- A viewer who owns the affaire can see the version and still cannot write a template.
-- The v2 owner-change guard refuses this swap because the lines cite the engineer's labour
-- roles; that guard is not the boundary under test, so only it is suspended for the swap.
select set_config('role', 'none', true);
alter table public.estimate_projects disable trigger aaz_guard_estimate_project_v2_owner_change;
update public.estimate_projects set user_id = '29300000-0000-4000-8000-000000000004'
where id = '29300000-0000-4000-8000-000000000010';
select pg_temp.tpl_as('29300000-0000-4000-8000-000000000004');
select throws_ok(
  $$select public.create_estimate_template_from_version('29300000-0000-4000-8000-000000000211', 'PG1000 refus lecteur', null)$$,
  '42501', 'new row violates row-level security policy',
  'a viewer who owns the affaire is refused with the insert policy''s 42501');
select set_config('role', 'none', true);
update public.estimate_projects set user_id = '29300000-0000-4000-8000-000000000001'
where id = '29300000-0000-4000-8000-000000000010';
alter table public.estimate_projects enable trigger aaz_guard_estimate_project_v2_owner_change;

-- The owner saves all 2 502 items inside the API roles' 8 s statement timeout.
select pg_temp.tpl_as('29300000-0000-4000-8000-000000000001');
select set_config('statement_timeout', '8s', true);
select lives_ok(
  $$select public.create_estimate_template_from_version('29300000-0000-4000-8000-000000000211', 'PG1000 modèle complet', null)$$,
  'the owner saves a 2 501-line version as a template within 8 s');
select set_config('statement_timeout', '0', true);

select is(
  (select count(*)::integer from public.read_estimate_template_items(current_setting('test.tenant_id')::uuid,
    (select id from public.estimate_templates where name = 'PG1000 modèle complet'))),
  2502,
  'the owner reads the section and all 2 501 lines through the checked-once function');
select is(
  (select line_count from public.count_estimate_template_lines(current_setting('test.tenant_id')::uuid,
    array[(select id from public.estimate_templates where name = 'PG1000 modèle complet')])),
  2501,
  'the line count is the 2 501 lines, not another per-item scan');
select is(
  (select count(*)::integer from public.read_estimate_template_items(current_setting('test.tenant_id')::uuid,
    (select id from public.estimate_templates where name = 'PG1000 modèle complet')) item
    where item.title = 'Lot ligne 2501'),
  1,
  'the last line of the version is in the template');

-- The same rows the select policy shows, for every role. Compared by count: 2 502 identities are the
-- section plus every line, and a refused caller sees none.
create function pg_temp.tpl_visible(p_actor uuid, p_role text default 'authenticated') returns integer
language plpgsql as $$
declare
  visible integer;
begin
  perform pg_temp.tpl_as(p_actor, p_role);
  select count(*)::integer into visible
  from public.read_estimate_template_items(current_setting('test.tenant_id')::uuid,
    (select id from public.estimate_templates where name = 'PG1000 modèle complet'));
  perform set_config('role', 'none', true);
  return visible;
end
$$;

select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000001'), 2502, 'the owner sees every template item');
select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000002'), 2502, 'an admin sees every template item');
select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000003'), 0, 'an engineer who did not create the template sees nothing');
select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000004'), 0, 'a viewer sees nothing');
select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000005'), 0, 'a member of another tenant sees nothing');
select is(pg_temp.tpl_visible('29300000-0000-4000-8000-000000000006'), 0, 'a director who did not create the template sees nothing');
select is(pg_temp.tpl_visible(null, 'service_role'), 2502, 'the service role reads every item of the named template');

select is(
  (select count(*)::integer from public.estimate_template_items item
    where item.template_id = (select id from public.estimate_templates where name = 'PG1000 modèle complet')),
  2502,
  'the table holds the same 2 502 items the owner read');

select * from finish();
rollback;
