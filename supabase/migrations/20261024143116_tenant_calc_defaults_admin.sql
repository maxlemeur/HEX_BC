-- Lot 3.2, entry 5 (P-13): a tenant admin sets the default sale coefficients and the VAT rates allowed at the v3
-- freeze. The engine of new versions stays the team's lever: public.set_tenant_calc_policy keeps its
-- service_role-only grant, and public.set_tenant_calc_defaults only ever rewrites the engine already in force
-- (an absent row is engine 3 since M8, 20261018183629). Regression: supabase/tests/database/
-- tenant-calc-defaults-admin.test.sql; journey V3S03 (e2e/army/local/engine-v3-default.e2e.ts).
--
-- The new function checks the caller, then delegates every value check, the row write and the journal event to
-- set_tenant_calc_policy, under the same per-tenant advisory lock, so the two writers cannot diverge.
begin;

do $preflight$
begin
  if to_regprocedure('public.set_tenant_calc_policy(uuid, smallint, numeric, numeric, integer[], text, uuid)') is null
    or to_regclass('public.tenant_calc_policies') is null
    or to_regprocedure('public.has_tenant_role(uuid, public.tenant_role[])') is null
  then
    raise exception 'LOT3_2_ENTRY5_PREREQUISITE_MISSING';
  end if;
  if to_regprocedure('public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text)') is not null then
    raise exception 'LOT3_2_ENTRY5_PREFLIGHT: public.set_tenant_calc_defaults already exists';
  end if;
end;
$preflight$;

create function public.set_tenant_calc_defaults(
  p_tenant_id uuid,
  p_default_sale_coefficient_fo numeric,
  p_default_sale_coefficient_mo numeric,
  p_allowed_tax_rates_bp integer[],
  p_change_reason text
)
returns public.tenant_calc_policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  current_engine smallint;
begin
  if actor_user_id is null
    or p_tenant_id is null
    or not public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role])
  then
    raise exception using errcode = '42501', message = 'TENANT_CALC_DEFAULTS_ADMIN_ONLY';
  end if;
  if p_default_sale_coefficient_fo is null
    or p_default_sale_coefficient_mo is null
    or p_allowed_tax_rates_bp is null
  then
    raise exception using errcode = '22023', message = 'TENANT_CALC_DEFAULTS_REQUIRED';
  end if;
  -- A repeated rate would be stored as is: the list of rates is a set.
  if cardinality(p_allowed_tax_rates_bp) <> (
    select count(distinct rate) from pg_catalog.unnest(p_allowed_tax_rates_bp) as rate
  ) then
    raise exception using errcode = '22023', message = 'TENANT_CALC_POLICY_INVALID';
  end if;

  -- Same lock as set_tenant_calc_policy (re-entrant within the transaction): the engine read here is the one
  -- written back, even if the team changes it concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('estimate-calc-policy:' || p_tenant_id::text, 0)
  );
  select policy.new_estimate_calc_engine
    into current_engine
  from public.tenant_calc_policies policy
  where policy.tenant_id = p_tenant_id
  for update;

  return public.set_tenant_calc_policy(
    p_tenant_id,
    coalesce(current_engine, 3::smallint),
    p_default_sale_coefficient_fo,
    p_default_sale_coefficient_mo,
    p_allowed_tax_rates_bp,
    p_change_reason,
    actor_user_id
  );
end;
$$;

comment on function public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text) is
  'Lot 3.2 entry 5 (P-13): a tenant admin sets the default v3 sale coefficients and the VAT rates allowed at the v3 freeze (TENANT_CALC_DEFAULTS_ADMIN_ONLY, TENANT_CALC_DEFAULTS_REQUIRED). Keeps the engine in force (absent row: 3) and delegates checks, write and journal event to set_tenant_calc_policy.';

revoke all on function public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text)
  from public, anon;
grant execute on function public.set_tenant_calc_defaults(uuid, numeric, numeric, integer[], text)
  to authenticated, service_role;

comment on table public.tenant_calc_policies is
  'Typed tenant calculation policy (lot 2, D3): engine of new estimate versions (absent row = 3 since M8, sub-lot 2.10; an explicit row 2 keeps engine 2), default v3 sale coefficients (absent row: 1.30 FO, 1.20 MO), VAT rates allowed at the v3 freeze, reason and author. Written only by public.set_tenant_calc_policy (engine: service_role, P-13); a tenant admin changes the defaults and rates through public.set_tenant_calc_defaults (lot 3.2).';

commit;
