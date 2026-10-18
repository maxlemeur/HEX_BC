-- Lot 2, sub-lot 2.10b (M8): engine 3 is the engine of new versions for a tenant without a policy row.
-- Design: docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md §6.1 M8, D3, D17, P-02, P-07.
-- Failure modes and contract: docs/testing/estimate-engine-v3-2.10.md (F210-01 to F210-09).
--
-- Written red before M8: F210-01 (absent policy + expectation 3 gives a v3 at 1,30 / 1,20) and F210-02
-- (absent policy + no expectation is refused) fail on the 2.5 contract (absent = 2). The other assertions
-- are guards that already hold and must keep holding after M8: an absent expectation is never read as 3, an
-- explicit row 2 stays v2, an explicit row 3 keeps its coefficients, a duplicated v2 stays v2 whatever the
-- policy, no policy row is written, no other version or line is rewritten, the column default stays 2.
-- Every write goes through pg_temp.def_probe (sub-block always rolled back) or pg_temp.def_try (sub-block
-- kept when it succeeds), so a red assertion fails on its own reason and the suite runs to the end.
-- Fixtures inserted by postgres inside the transaction, rolled back at the end.

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

create function pg_temp.def_probe(p_statements text[], p_action text default null)
returns text
language plpgsql
as $probe$
declare
  probe_statement text;
  action_result text;
begin
  begin
    foreach probe_statement in array coalesce(p_statements, '{}'::text[]) loop
      execute probe_statement;
    end loop;
    if p_action is not null then
      execute p_action into action_result;
    end if;
    raise exception using errcode = 'P0001', message = 'DEF_PROBE_ROLLBACK';
  exception when others then
    if sqlerrm = 'DEF_PROBE_ROLLBACK' then
      return 'ok' || coalesce(':' || action_result, '');
    end if;
    return sqlstate || ' ' || sqlerrm;
  end;
end;
$probe$;

create function pg_temp.def_try(p_statements text[])
returns text
language plpgsql
as $try$
declare
  try_statement text;
begin
  begin
    foreach try_statement in array coalesce(p_statements, '{}'::text[]) loop
      execute try_statement;
    end loop;
  exception when others then
    return sqlstate || ' ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return 'ok';
end;
$try$;

-- ---------------------------------------------------------------------------
-- Identities: ...8000-00000000000N owner of tenant N (1 absent policy, 2 explicit row 2, 3 explicit row 3
-- at 1,10 / 1,05, 4 duplication: v2 created under a row 2, row then removed); ...01N project of tenant N.
-- Versions: ...NVV of tenant N. Lines: "-8001-" group, then the version's last three digits and the rank on
-- three digits (000 = section), so two versions of one tenant never share a line identity.
-- ---------------------------------------------------------------------------
create temporary table def_fx (key text primary key, id uuid not null) on commit drop;

create function pg_temp.fx(p_key text)
returns uuid
language sql
stable
as $$
  select id from def_fx where key = p_key
$$;

create function pg_temp.def_item(p_version uuid, p_index integer)
returns uuid
language sql
immutable
as $$
  select ('a32a0000-0000-4000-8001-000000' || right(p_version::text, 3) || lpad(p_index::text, 3, '0'))::uuid
$$;

-- Every version and line that exists before this suite writes anything (seeds and other fixtures).
create temporary table def_before on commit drop as
select 'version' as kind, version.id, to_jsonb(version) as image
from public.estimate_versions version
union all
select 'item', item.id, to_jsonb(item)
from public.estimate_items item;

create temporary table def_policy_before on commit drop as
select policy.tenant_id, to_jsonb(policy) as image
from public.tenant_calc_policies policy;

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
    ('a32a0000-0000-4000-8000-000000000001'::uuid, 'v3-default-absent@example.test'),
    ('a32a0000-0000-4000-8000-000000000002'::uuid, 'v3-default-row2@example.test'),
    ('a32a0000-0000-4000-8000-000000000003'::uuid, 'v3-default-row3@example.test'),
    ('a32a0000-0000-4000-8000-000000000004'::uuid, 'v3-default-duplication@example.test')
) as fixture(id, email);

insert into def_fx (key, id)
select 'tenant_' || right(membership.user_id::text, 1), membership.tenant_id
from public.tenant_memberships membership
where membership.user_id in (
    'a32a0000-0000-4000-8000-000000000001', 'a32a0000-0000-4000-8000-000000000002',
    'a32a0000-0000-4000-8000-000000000003', 'a32a0000-0000-4000-8000-000000000004'
  )
  and membership.is_default;

select is(
  (select count(*)::integer from def_fx),
  4,
  'fixture: each owner has its own personal default tenant'
);

insert into public.estimate_projects (id, tenant_id, user_id, name, is_archived)
select
  ('a32a0000-0000-4000-8000-00000000001' || n)::uuid,
  pg_temp.fx('tenant_' || n),
  ('a32a0000-0000-4000-8000-00000000000' || n)::uuid,
  'Projet moteur par défaut ' || n,
  false
from generate_series(1, 4) as n;

create function pg_temp.def_create_sql(p_tenant integer, p_version jsonb, p_items jsonb)
returns text
language sql
stable
as $$
  select format(
    'select public.persist_estimate_creation_atomic(%L::uuid, %L::uuid, %L::uuid, null, %L::jsonb, %L::jsonb, null)',
    pg_temp.fx('tenant_' || p_tenant),
    ('a32a0000-0000-4000-8000-00000000000' || p_tenant)::uuid,
    ('a32a0000-0000-4000-8000-00000000001' || p_tenant)::uuid,
    p_version,
    p_items
  )
$$;

create function pg_temp.def_policy_sql(p_tenant integer, p_engine integer, p_fo numeric, p_mo numeric)
returns text
language sql
stable
as $$
  select format(
    'select public.set_tenant_calc_policy('
      'p_tenant_id => %L::uuid, p_new_estimate_calc_engine => %s::smallint, '
      'p_default_sale_coefficient_fo => %L::numeric, p_default_sale_coefficient_mo => %L::numeric, '
      'p_allowed_tax_rates_bp => %L::integer[], p_change_reason => %L, p_actor_user_id => %L::uuid)',
    pg_temp.fx('tenant_' || p_tenant),
    p_engine,
    p_fo,
    p_mo,
    '{2000,1000,550,210}',
    'Fixture 2.10b, politique explicite ' || p_engine,
    ('a32a0000-0000-4000-8000-00000000000' || p_tenant)::uuid
  )
$$;

-- Historical v2 payload: no engine expectation, no v3 key (same shape as the 2.5 F25-01 witness).
create function pg_temp.def_v2_version(p_version uuid, p_title text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_version, 'title', p_title, 'date_devis', '2026-10-18', 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb,
    'global_coefficient', 1, 'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1,
    'max_section_depth', 3, 'contractor_role', 'principal',
    'total_ht_cents', 100, 'total_tax_cents', 20, 'total_ttc_cents', 120
  )
$$;

create function pg_temp.def_v2_items(p_version uuid)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.def_item(p_version, 0), 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Lot v2'),
    jsonb_build_object('id', pg_temp.def_item(p_version, 1), 'parent_id', pg_temp.def_item(p_version, 0),
      'item_type', 'line', 'position', 1, 'title', 'Ligne v2', 'description', 'u', 'quantity', 1,
      'unit_price_ht_cents', 100, 'tax_rate_bp', 2000, 'k_fo', 1, 'h_mo', 0, 'h_mo_majoration', 1, 'k_mo', 1,
      'pu_ht_cents', 100, 'line_total_ht_cents', 100, 'line_tax_cents', 20, 'line_total_ttc_cents', 120)
  )
$$;

-- v3 payload expecting engine 3 WITHOUT sale coefficients: the policy (or, after M8, the absent-policy
-- defaults) gives them. One priced line, 10,00 € of supplies, no labour: PU = 10,00 € x FO coefficient.
create function pg_temp.def_v3_version(p_version uuid, p_title text, p_pu integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'id', p_version, 'title', p_title, 'date_devis', '2026-10-18', 'validite_jours', 30,
    'margin_multiplier', 1, 'margin_mode', 'fixed', 'currency', 'EUR', 'margin_bp', 0, 'discount_bp', 0,
    'discount_amount_cents', null, 'discount_mode', 'simple', 'discount_steps', '[]'::jsonb,
    'global_coefficient', 1, 'tax_rate_bp', 2000, 'rounding_mode', 'none', 'rounding_step_cents', 1,
    'max_section_depth', 3, 'contractor_role', 'principal', 'calc_engine_version', 3,
    'gross_ht_cents', p_pu, 'discount_applied_cents', 0, 'commercial_rounding_cents', 0,
    'total_ht_cents', p_pu, 'total_tax_cents', p_pu / 5, 'total_ttc_cents', p_pu + p_pu / 5
  )
$$;

create function pg_temp.def_v3_items(p_version uuid, p_pu integer)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_array(
    jsonb_build_object('id', pg_temp.def_item(p_version, 0), 'parent_id', null, 'item_type', 'section',
      'position', 1, 'title', 'Lot'),
    jsonb_build_object('id', pg_temp.def_item(p_version, 1), 'parent_id', pg_temp.def_item(p_version, 0),
      'item_type', 'line', 'position', 1, 'title', 'L1', 'k_fo', 1, 'h_mo_majoration', 1, 'k_mo', 1,
      'pricing_status', 'priced', 'quantity', 1, 'unit_price_ht_cents', 1000, 'tax_rate_bp', 2000,
      'h_mo_per_unit', 0, 'unit_code', 'u', 'pu_ht_cents', p_pu, 'line_total_ht_cents', p_pu,
      'line_tax_cents', p_pu / 5, 'line_total_ttc_cents', p_pu + p_pu / 5)
  )
$$;

create function pg_temp.def_versions_of(p_tenant integer)
returns integer
language sql
stable
as $$
  select count(*)::integer from public.estimate_versions
  where project_id = ('a32a0000-0000-4000-8000-00000000001' || p_tenant)::uuid
$$;

-- ---------------------------------------------------------------------------
-- F210-09: M8 changes no column default and writes no policy row.
-- ---------------------------------------------------------------------------
select col_default_is(
  'public', 'tenant_calc_policies', 'new_estimate_calc_engine', '2',
  'F210-09 the column default of the policy engine stays 2 (a default of 3 would violate the v3 defaults check)'
);

select is(
  (select count(*)::integer from public.tenant_calc_policies
   where tenant_id in (pg_temp.fx('tenant_1'), pg_temp.fx('tenant_2'), pg_temp.fx('tenant_3'), pg_temp.fx('tenant_4'))),
  0,
  'F210-09 a new tenant has no policy row: nothing backfills one'
);

-- ---------------------------------------------------------------------------
-- F210-01: absent policy + expectation 3, no coefficients -> v3 at 1,3000 / 1,2000 (red before M8).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_create_sql(1,
      pg_temp.def_v3_version('a32a0000-0000-4000-8000-000000000101', 'Défaut absent v3', 1300),
      pg_temp.def_v3_items('a32a0000-0000-4000-8000-000000000101', 1300))
  ]),
  'ok',
  'F210-01 without a policy row, a creation expecting engine 3 succeeds'
);

select is(
  (select concat_ws('|', calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents,
     total_ht_cents, total_tax_cents, total_ttc_cents)
   from public.estimate_versions where id = 'a32a0000-0000-4000-8000-000000000101'),
  '3|1.3000|1.2000|1300|1300|260|1560',
  'F210-01 the absent policy gives engine 3 with the documented defaults 1,30 FO and 1,20 MO (P-02)'
);

select is(
  (select count(*)::integer from public.tenant_calc_policies where tenant_id = pg_temp.fx('tenant_1'))
    + (select count(*)::integer from public.tenant_calc_policy_events where tenant_id = pg_temp.fx('tenant_1')),
  0,
  'F210-01 the creation under an absent policy writes no policy row and no policy event'
);

-- ---------------------------------------------------------------------------
-- F210-02, F210-03: absent policy + no expectation (old bundle) or expectation 2 -> CONTEXT_CHANGED,
-- nothing written. An absent expectation is never read as 3 (D3).
-- ---------------------------------------------------------------------------
select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_create_sql(1,
      pg_temp.def_v2_version('a32a0000-0000-4000-8000-000000000102', 'Ancien bundle'),
      pg_temp.def_v2_items('a32a0000-0000-4000-8000-000000000102'))
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F210-02 without a policy row, a creation without engine expectation fails closed with CONTEXT_CHANGED'
);

select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_create_sql(1,
      pg_temp.def_v2_version('a32a0000-0000-4000-8000-000000000103', 'Attente 2')
        || '{"calc_engine_version":2}'::jsonb,
      pg_temp.def_v2_items('a32a0000-0000-4000-8000-000000000103'))
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F210-03 without a policy row, a creation expecting engine 2 is refused, never silently given a v3'
);

select is(
  pg_temp.def_versions_of(1),
  1,
  'F210-02 a refused creation writes no version: the affaire of tenant 1 holds only the F210-01 v3'
);

-- ---------------------------------------------------------------------------
-- F210-04, F210-05: explicit row 2 (per-tenant opt-out and rollback lever) -> v2; expectation 3 refused.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.def_try(array['set local role service_role', pg_temp.def_policy_sql(2, 2, null, null)]),
  'ok',
  'F210-04 fixture: service_role sets tenant 2 to an explicit policy 2'
);

select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_create_sql(2,
      pg_temp.def_v2_version('a32a0000-0000-4000-8000-000000000201', 'Politique 2 explicite'),
      pg_temp.def_v2_items('a32a0000-0000-4000-8000-000000000201'))
  ]),
  'ok',
  'F210-04 under an explicit row 2, a creation without engine expectation succeeds'
);

select is(
  (select concat_ws('|', calc_engine_version, coalesce(sale_coefficient_fo::text, 'null'),
     coalesce(sale_coefficient_mo::text, 'null'), total_ht_cents)
   from public.estimate_versions where id = 'a32a0000-0000-4000-8000-000000000201'),
  '2|null|null|100',
  'F210-04 an explicit row 2 still creates a v2 after the switch'
);

select is(
  pg_temp.def_probe(array[
    'set local role service_role',
    pg_temp.def_create_sql(2,
      pg_temp.def_v3_version('a32a0000-0000-4000-8000-000000000202', 'Attente 3 sous 2', 1300),
      pg_temp.def_v3_items('a32a0000-0000-4000-8000-000000000202', 1300))
  ]),
  '40001 ESTIMATE_CALC_POLICY_CONTEXT_CHANGED',
  'F210-05 under an explicit row 2, a creation expecting engine 3 is refused'
);

-- ---------------------------------------------------------------------------
-- F210-06: explicit row 3 at 1,10 / 1,05 -> v3 with the row's coefficients, not the absent defaults.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.def_try(array['set local role service_role', pg_temp.def_policy_sql(3, 3, 1.10, 1.05)]),
  'ok',
  'F210-06 fixture: service_role sets tenant 3 to an explicit policy 3 at 1,10 / 1,05'
);

select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_create_sql(3,
      pg_temp.def_v3_version('a32a0000-0000-4000-8000-000000000301', 'Politique 3 explicite', 1100),
      pg_temp.def_v3_items('a32a0000-0000-4000-8000-000000000301', 1100))
  ]),
  'ok',
  'F210-06 under an explicit row 3, a creation expecting engine 3 succeeds'
);

select is(
  (select concat_ws('|', calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, total_ht_cents)
   from public.estimate_versions where id = 'a32a0000-0000-4000-8000-000000000301'),
  '3|1.1000|1.0500|1100',
  'F210-06 an explicit row 3 keeps its own coefficients (1,10 / 1,05)'
);

-- ---------------------------------------------------------------------------
-- F210-07: a v2 duplicated under an absent policy stays a v2 (I4, P-15), source untouched.
-- ---------------------------------------------------------------------------
select is(
  pg_temp.def_try(array[
    'set local role service_role',
    pg_temp.def_policy_sql(4, 2, null, null),
    pg_temp.def_create_sql(4,
      pg_temp.def_v2_version('a32a0000-0000-4000-8000-000000000401', 'Source v2'),
      pg_temp.def_v2_items('a32a0000-0000-4000-8000-000000000401'))
  ]),
  'ok',
  'F210-07 fixture: a v2 is created in tenant 4 under an explicit row 2'
);

-- The row is removed by postgres (fixture only, never an application path): tenant 4 is back to absent.
delete from public.tenant_calc_policies where tenant_id = pg_temp.fx('tenant_4');

create temporary table def_source on commit drop as
select to_jsonb(version) as version_image,
  (select jsonb_agg(to_jsonb(item) order by item.id) from public.estimate_items item where item.version_id = version.id)
    as items_image
from public.estimate_versions version
where version.id = 'a32a0000-0000-4000-8000-000000000401';

select is(
  pg_temp.def_try(array[
    'set local role authenticated',
    $s$select set_config('request.jwt.claim.sub', 'a32a0000-0000-4000-8000-000000000004', true)$s$,
    $s$select set_config('def_test.duplicate_id', public.duplicate_estimate_version('a32a0000-0000-4000-8000-000000000401', false)::text, true)$s$
  ]),
  'ok',
  'F210-07 the owner duplicates its v2 while its tenant has no policy row'
);

select is(
  (select concat_ws('|', version.calc_engine_version, coalesce(version.sale_coefficient_fo::text, 'null'),
     version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents,
     (select count(*) from public.estimate_items item where item.version_id = version.id))
   from public.estimate_versions version
   where version.id = nullif(current_setting('def_test.duplicate_id', true), '')::uuid),
  '2|null|100|20|120|2',
  'F210-07 the duplicate of a v2 is a v2 with the same amounts, whatever the policy'
);

select is(
  (select version_image = (select to_jsonb(version) from public.estimate_versions version
       where version.id = 'a32a0000-0000-4000-8000-000000000401')
     and items_image = (select jsonb_agg(to_jsonb(item) order by item.id) from public.estimate_items item
       where item.version_id = 'a32a0000-0000-4000-8000-000000000401')
   from def_source),
  true,
  'F210-07 the duplicated v2 source is untouched (amounts, content_revision, lines)'
);

select is(
  (select count(*)::integer from public.tenant_calc_policies where tenant_id = pg_temp.fx('tenant_4')),
  0,
  'F210-07 duplication reads no policy and writes none'
);

-- ---------------------------------------------------------------------------
-- F210-08: no version or line that existed before the suite is rewritten by creations under the new
-- default, and no other tenant's policy row changes (D17).
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::integer from def_before before
   where before.image is distinct from (
     case before.kind
       when 'version' then (select to_jsonb(version) from public.estimate_versions version where version.id = before.id)
       else (select to_jsonb(item) from public.estimate_items item where item.id = before.id)
     end)),
  0,
  'F210-08 every pre-existing version and line keeps its exact stored row'
);

select is(
  (select count(*)::integer from def_policy_before before
   where before.image is distinct from (
     select to_jsonb(policy) from public.tenant_calc_policies policy where policy.tenant_id = before.tenant_id)),
  0,
  'F210-08 every pre-existing policy row is unchanged'
);

select * from finish();
rollback;
