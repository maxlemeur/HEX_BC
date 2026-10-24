-- Lot 3.2, entry 5 (P-13): a tenant admin sets the default sale coefficients and the allowed VAT rates of the
-- tenant calculation policy through public.set_tenant_calc_defaults; the engine of new versions stays the team's
-- lever (public.set_tenant_calc_policy, service_role only). Journey: V3S03 (e2e/army/local/engine-v3-default.e2e.ts).
--
-- Written red before the migration: the function does not exist. Failure modes:
--   F32-05a only service_role can write the defaults;
--   F32-05b a write by an admin changes the engine, skips the reason or the journal, accepts an invalid value,
--           reaches another tenant, or is open to a non-admin member.
-- Every call goes through pg_temp.cd_call (role and JWT subject switched in a sub-block, kept when it succeeds),
-- so a red assertion fails on its own reason and the suite runs to the end. Fixtures rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- ---------------------------------------------------------------------------
-- Identities: ...8000-00000000000N. 1 admin owner of tenant A (no policy row), 2 engineer and 3 viewer of
-- tenant A, 4 admin owner of tenant B (explicit policy 2).
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,
  raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000', fixture.id, 'authenticated', 'authenticated', fixture.email,
  crypt('test-password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb, now(), now(), '', '', '', ''
from (
  values
    ('a35c0000-0000-4000-8000-000000000001'::uuid, 'calc-defaults-admin-a@example.test'),
    ('a35c0000-0000-4000-8000-000000000002'::uuid, 'calc-defaults-engineer-a@example.test'),
    ('a35c0000-0000-4000-8000-000000000003'::uuid, 'calc-defaults-viewer-a@example.test'),
    ('a35c0000-0000-4000-8000-000000000004'::uuid, 'calc-defaults-admin-b@example.test')
) as fixture(id, email);

create temporary table cd_fx (key text primary key, id uuid not null) on commit drop;

insert into cd_fx (key, id)
select case membership.user_id
    when 'a35c0000-0000-4000-8000-000000000001' then 'tenant_a'
    else 'tenant_b'
  end,
  membership.tenant_id
from public.tenant_memberships membership
where membership.user_id in ('a35c0000-0000-4000-8000-000000000001', 'a35c0000-0000-4000-8000-000000000004')
  and membership.is_default
  and membership.role = 'admin';

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from cd_fx where key = p_key
$$;

select is(
  (select count(*)::integer from cd_fx),
  2,
  'fixture: owners 1 and 4 each administer their own personal tenant'
);

insert into public.tenant_memberships (id, tenant_id, user_id, role, is_default)
select fixture.id, pg_temp.fx('tenant_a'), fixture.user_id, fixture.role, false
from (
  values
    ('a35c0000-0000-4000-8000-000000000021'::uuid, 'a35c0000-0000-4000-8000-000000000002'::uuid, 'engineer'::public.tenant_role),
    ('a35c0000-0000-4000-8000-000000000031'::uuid, 'a35c0000-0000-4000-8000-000000000003'::uuid, 'viewer'::public.tenant_role)
) as fixture(id, user_id, role);

-- Tenant B starts at the explicit policy 2 (the per-tenant opt-out of 2.10b), from the team's writer.
select public.set_tenant_calc_policy(
  p_tenant_id => pg_temp.fx('tenant_b'), p_new_estimate_calc_engine => 2::smallint,
  p_default_sale_coefficient_fo => null, p_default_sale_coefficient_mo => null, p_allowed_tax_rates_bp => null,
  p_change_reason => 'Fixture lot 3.2, politique 2', p_actor_user_id => 'a35c0000-0000-4000-8000-000000000004'::uuid);

create temporary table cd_policy_before on commit drop as
select policy.tenant_id, to_jsonb(policy) as image
from public.tenant_calc_policies policy
where policy.tenant_id <> pg_temp.fx('tenant_b');

create function pg_temp.cd_call(
  p_role text, p_user text, p_tenant uuid, p_fo numeric, p_mo numeric, p_rates integer[], p_reason text
)
returns text
language plpgsql
as $call$
declare
  call_result text := 'ok';
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claim.sub', coalesce(p_user, ''), true);
    execute format(
      'select (public.set_tenant_calc_defaults(%L::uuid, %L::numeric, %L::numeric, %L::integer[], %L::text)).tenant_id',
      p_tenant, p_fo, p_mo, p_rates, p_reason);
  exception when others then
    call_result := sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return call_result;
end;
$call$;

create function pg_temp.cd_policy(p_tenant uuid)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'engine', policy.new_estimate_calc_engine, 'fo', policy.default_sale_coefficient_fo::text,
    'mo', policy.default_sale_coefficient_mo::text, 'rates', to_jsonb(policy.allowed_tax_rates_bp),
    'reason', policy.change_reason, 'updated_by', policy.updated_by)
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant
$$;

create function pg_temp.cd_events(p_tenant uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer from public.tenant_calc_policy_events event where event.tenant_id = p_tenant
$$;

-- ---------------------------------------------------------------------------
-- Contract of the function: security definer with an empty search path, executable by authenticated only;
-- the engine writer stays service_role only.
-- ---------------------------------------------------------------------------
select has_function(
  'public', 'set_tenant_calc_defaults', array['uuid', 'numeric', 'numeric', 'integer[]', 'text'],
  'F32-05a public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text) exists'
);

select is(
  (select row(function.prosecdef, function.proconfig)::text
   from pg_proc function
   where function.oid = to_regprocedure('public.set_tenant_calc_defaults(uuid,numeric,numeric,integer[],text)')),
  row(true, array['search_path=""'])::text,
  'the function is security definer with an empty search path'
);

select ok(
  coalesce(has_function_privilege('authenticated', to_regprocedure('public.set_tenant_calc_defaults(uuid,numeric,numeric,integer[],text)'), 'execute'), false)
  and not coalesce(has_function_privilege('anon', to_regprocedure('public.set_tenant_calc_defaults(uuid,numeric,numeric,integer[],text)'), 'execute'), true),
  'authenticated can execute the function, anon cannot'
);

select ok(
  not has_function_privilege('authenticated', 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.set_tenant_calc_policy(uuid,smallint,numeric,numeric,integer[],text,uuid)', 'execute'),
  'the engine writer stays service_role only (P-13)'
);

-- ---------------------------------------------------------------------------
-- F32-05b: only an admin of the target tenant writes; nothing is written on a refusal.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000002', pg_temp.fx('tenant_a'),
    1.35, 1.25, '{2000,550}', 'Coefficients de l''agence'),
  '42501 TENANT_CALC_DEFAULTS_ADMIN_ONLY',
  'an engineer of the tenant is refused'
);

select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000003', pg_temp.fx('tenant_a'),
    1.35, 1.25, '{2000,550}', 'Coefficients de l''agence'),
  '42501 TENANT_CALC_DEFAULTS_ADMIN_ONLY',
  'a viewer of the tenant is refused'
);

select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000004', pg_temp.fx('tenant_a'),
    1.35, 1.25, '{2000,550}', 'Coefficients de l''agence'),
  '42501 TENANT_CALC_DEFAULTS_ADMIN_ONLY',
  'the admin of another tenant is refused'
);

select is(
  pg_temp.cd_call('authenticated', null, pg_temp.fx('tenant_a'), 1.35, 1.25, '{2000,550}', 'Coefficients de l''agence'),
  '42501 TENANT_CALC_DEFAULTS_ADMIN_ONLY',
  'an authenticated call without a user is refused'
);

select is(
  left(pg_temp.cd_call('anon', null, pg_temp.fx('tenant_a'), 1.35, 1.25, '{2000,550}', 'Coefficients de l''agence'), 5),
  '42501',
  'anon cannot call the function'
);

-- Invalid values, each refused by name for the admin of tenant A.
select results_eq(
  $$select pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'),
      case_input.fo, case_input.mo, case_input.rates, case_input.reason)
    from (values
      (1, null::numeric, 1.25::numeric, '{2000}'::integer[], 'Motif valable'),
      (2, 1.35, null, '{2000}', 'Motif valable'),
      (3, 1.35, 1.25, null, 'Motif valable'),
      (4, 10.5, 1.25, '{2000}', 'Motif valable'),
      (5, 0, 1.25, '{2000}', 'Motif valable'),
      (6, 1.23456, 1.25, '{2000}', 'Motif valable'),
      (7, 1.35, 1.25, '{}', 'Motif valable'),
      (8, 1.35, 1.25, '{2000,2000}', 'Motif valable'),
      (9, 1.35, 1.25, '{20000}', 'Motif valable'),
      (10, 1.35, 1.25, '{2000,null}', 'Motif valable'),
      (11, 1.35, 1.25, '{2000}', '  abc  '),
      (12, 1.35, 1.25, '{2000}', null)
    ) as case_input(n, fo, mo, rates, reason)
    order by case_input.n$$,
  $$values
    ('22023 TENANT_CALC_DEFAULTS_REQUIRED'), ('22023 TENANT_CALC_DEFAULTS_REQUIRED'),
    ('22023 TENANT_CALC_DEFAULTS_REQUIRED'), ('22023 TENANT_CALC_POLICY_INVALID'),
    ('22023 TENANT_CALC_POLICY_INVALID'), ('22023 TENANT_CALC_POLICY_INVALID'),
    ('22023 TENANT_CALC_POLICY_INVALID'), ('22023 TENANT_CALC_POLICY_INVALID'),
    ('22023 TENANT_CALC_POLICY_INVALID'), ('22023 TENANT_CALC_POLICY_INVALID'),
    ('22023 TENANT_CALC_POLICY_REASON_REQUIRED'), ('22023 TENANT_CALC_POLICY_REASON_REQUIRED')$$,
  'F32-05b missing defaults, out-of-range or over-precise coefficients, bad rate lists and short reasons are refused'
);

select is(
  (select count(*)::integer from public.tenant_calc_policies where tenant_id = pg_temp.fx('tenant_a'))
    + pg_temp.cd_events(pg_temp.fx('tenant_a')),
  0,
  'no refusal wrote a policy row or a journal event for tenant A'
);

-- ---------------------------------------------------------------------------
-- F32-05b: the admin writes the defaults; an absent policy becomes an explicit row at engine 3 (its effective
-- engine since M8), a row 2 stays at engine 2, and each write leaves one journal event.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'),
    1.35, 1.25, '{2000,1000,550}', '  Coefficients de l''agence  '),
  'ok',
  'the admin of tenant A writes its defaults'
);

select is(
  pg_temp.cd_policy(pg_temp.fx('tenant_a')),
  jsonb_build_object('engine', 3, 'fo', '1.3500', 'mo', '1.2500', 'rates', jsonb_build_array(2000, 1000, 550),
    'reason', 'Coefficients de l''agence', 'updated_by', 'a35c0000-0000-4000-8000-000000000001'),
  'an absent policy becomes engine 3 with the admin''s defaults, trimmed reason and author'
);

select is(
  (select jsonb_build_object('changed_by', event.changed_by, 'previous', event.previous_policy,
     'engine', event.new_policy -> 'new_estimate_calc_engine', 'reason', event.change_reason)
   from public.tenant_calc_policy_events event
   where event.tenant_id = pg_temp.fx('tenant_a')),
  jsonb_build_object('changed_by', 'a35c0000-0000-4000-8000-000000000001', 'previous', null, 'engine', 3,
    'reason', 'Coefficients de l''agence'),
  'one journal event names the admin, the reason and the engine 3 kept'
);

-- The team moves tenant A to engine 2; the admin's next write keeps the team's engine.
select public.set_tenant_calc_policy(
  p_tenant_id => pg_temp.fx('tenant_a'), p_new_estimate_calc_engine => 2::smallint,
  p_default_sale_coefficient_fo => 1.35, p_default_sale_coefficient_mo => 1.25, p_allowed_tax_rates_bp => '{2000,1000,550}',
  p_change_reason => 'Fixture lot 3.2, retour au moteur 2', p_actor_user_id => 'a35c0000-0000-4000-8000-000000000001'::uuid);

select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000001', pg_temp.fx('tenant_a'),
    1.4, 1.3, '{2000,550}', 'Coefficients révisés'),
  'ok',
  'the admin of tenant A writes again'
);

select is(
  pg_temp.cd_policy(pg_temp.fx('tenant_a')) - 'updated_by' - 'reason',
  jsonb_build_object('engine', 2, 'fo', '1.4000', 'mo', '1.3000', 'rates', jsonb_build_array(2000, 550)),
  'the engine chosen by the team (2) is kept; only the defaults change'
);

select is(
  pg_temp.cd_events(pg_temp.fx('tenant_a')),
  3,
  'each write (admin, team, admin) left exactly one journal event'
);

select is(
  pg_temp.cd_call('authenticated', 'a35c0000-0000-4000-8000-000000000004', pg_temp.fx('tenant_b'),
    1.15, 1.1, '{2000}', 'Coefficients de B'),
  'ok',
  'the admin of tenant B writes its defaults'
);

select is(
  pg_temp.cd_policy(pg_temp.fx('tenant_b')) - 'updated_by' - 'reason',
  jsonb_build_object('engine', 2, 'fo', '1.1500', 'mo', '1.1000', 'rates', jsonb_build_array(2000)),
  'a tenant at the explicit policy 2 stays at engine 2'
);

select is(
  pg_temp.cd_policy(pg_temp.fx('tenant_a')) - 'updated_by' - 'reason',
  jsonb_build_object('engine', 2, 'fo', '1.4000', 'mo', '1.3000', 'rates', jsonb_build_array(2000, 550)),
  'tenant B''s write leaves tenant A untouched'
);

select is(
  (select count(*)::integer from cd_policy_before before
   where before.image is distinct from (
     select to_jsonb(policy) from public.tenant_calc_policies policy where policy.tenant_id = before.tenant_id)),
  0,
  'every other pre-existing policy row is unchanged'
);

select * from finish();
rollback;
