-- Keep the historical balancing columns intact while exposing commercial
-- rounding as its own contractual amount. The legacy total_tax_cents still
-- balances total_ttc_cents for SQL compatibility; consumers derive true VAT
-- as total_tax_cents - rounding_adjustment_cents.

alter table public.estimate_versions
  add column if not exists rounding_adjustment_cents integer not null default 0;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_rounding_adjustment_valid;
alter table public.estimate_versions
  add constraint estimate_versions_rounding_adjustment_valid
  check (
    total_tax_cents - rounding_adjustment_cents >= 0
    and total_ttc_cents = total_ht_cents + total_tax_cents
  );

comment on column public.estimate_versions.rounding_adjustment_cents is
  'Commercial rounding added after accounting VAT; amount due = HT + true VAT + this adjustment.';

create or replace function public.guard_estimate_rounding_adjustment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.rounding_adjustment_cents is distinct from old.rounding_adjustment_cents
    and not (
      current_user = 'service_role'
      and coalesce(
        pg_catalog.current_setting(
          'miaouffrage.estimate_v2_snapshot_freeze',
          true
        ),
        ''
      ) = 'on'
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_ROUNDING_ADJUSTMENT_IS_MANAGED';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_estimate_rounding_adjustment()
  from public, anon, authenticated;

drop trigger if exists aa_guard_estimate_rounding_adjustment
  on public.estimate_versions;
create trigger aa_guard_estimate_rounding_adjustment
  before update of rounding_adjustment_cents
  on public.estimate_versions
  for each row
  execute function public.guard_estimate_rounding_adjustment();

alter function public.freeze_estimate_v2_snapshot(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) rename to freeze_estimate_v2_snapshot_without_explicit_rounding;

revoke all on function public.freeze_estimate_v2_snapshot_without_explicit_rounding(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_estimate_v2_snapshot_without_explicit_rounding(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

create function public.freeze_estimate_v2_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_purpose text,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rounding_adjustment integer;
  frozen_version public.estimate_versions%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_version_totals is null
    or jsonb_typeof(p_version_totals) <> 'object'
    or p_version_totals - array[
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents',
      'rounding_adjustment_cents'
    ] <> '{}'::jsonb
    or not (p_version_totals ?& array[
      'total_ht_cents',
      'total_tax_cents',
      'total_ttc_cents'
    ])
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_TOTALS_INVALID';
  end if;

  begin
    rounding_adjustment := coalesce(
      (p_version_totals->>'rounding_adjustment_cents')::integer,
      0
    );
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception using
        errcode = '22023',
        message = 'ESTIMATE_V2_TOTALS_INVALID';
  end;

  if rounding_adjustment is null
    or (p_version_totals->>'total_tax_cents')::integer -
      rounding_adjustment < 0
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_ROUNDING_ADJUSTMENT_INVALID';
  end if;

  if exists (
    select 1
    from public.estimate_items item
    where item.tenant_id = p_tenant_id
      and item.version_id = p_version_id
      and item.item_type = 'line'::public.estimate_item_type
      and (
        (
          item.line_nature = 'supply_only'::public.estimate_line_nature
          and (
            coalesce(item.h_mo, 0) > 0
            or coalesce(item.h_mo_atelier, 0) > 0
            or coalesce(item.h_mo_chantier, 0) > 0
            or item.labor_role_id is not null
            or item.labor_role_atelier_id is not null
            or item.labor_role_chantier_id is not null
          )
        )
        or (
          item.line_nature = 'labor_only'::public.estimate_line_nature
          and (
            coalesce(item.unit_price_ht_cents, 0) > 0
            or item.supply_type_id is not null
            or item.selected_supplier_price_id is not null
          )
        )
      )
  )
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_LINE_NATURE_MISMATCH';
  end if;

  frozen_version := public.freeze_estimate_v2_snapshot_without_explicit_rounding(
    p_version_id,
    p_tenant_id,
    p_expected_updated_at,
    p_expected_content_revision,
    p_actor_user_id,
    p_purpose,
    p_calculation_context,
    p_item_snapshots,
    p_version_totals - 'rounding_adjustment_cents'
  );

  if frozen_version.rounding_adjustment_cents is distinct from
    rounding_adjustment
  then
    perform pg_catalog.set_config(
      'miaouffrage.estimate_v2_snapshot_freeze',
      'on',
      true
    );

    update public.estimate_versions version
    set rounding_adjustment_cents = rounding_adjustment
    where version.id = frozen_version.id
      and version.tenant_id = frozen_version.tenant_id
    returning version.* into frozen_version;

    perform pg_catalog.set_config(
      'miaouffrage.estimate_v2_snapshot_freeze',
      'off',
      true
    );
  end if;

  return frozen_version;
end;
$$;

revoke all on function public.freeze_estimate_v2_snapshot(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_estimate_v2_snapshot(
  uuid,
  uuid,
  timestamptz,
  bigint,
  uuid,
  text,
  jsonb,
  jsonb,
  jsonb
) to service_role;

-- The product default is a global approval at 5,000 EUR HT. Existing custom
-- thresholds remain untouched; tenants without a global rule receive it.
insert into public.estimate_rules (
  tenant_id,
  rule_type,
  scope_type,
  scope_id,
  threshold_value,
  action,
  is_active
)
select
  tenant.id,
  'require_approval'::public.estimate_rule_type,
  'global'::public.estimate_rule_scope_type,
  null,
  500000,
  'require_approval'::public.estimate_rule_action,
  true
from public.tenants tenant
where tenant.is_active
  and not exists (
    select 1
    from public.estimate_rules rule
    where rule.tenant_id = tenant.id
      and rule.rule_type = 'require_approval'::public.estimate_rule_type
      and rule.scope_type = 'global'::public.estimate_rule_scope_type
      and rule.scope_id is null
  );

create or replace function public.seed_default_estimate_approval_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.estimate_rules (
    tenant_id,
    rule_type,
    scope_type,
    scope_id,
    threshold_value,
    action,
    is_active
  ) values (
    new.id,
    'require_approval'::public.estimate_rule_type,
    'global'::public.estimate_rule_scope_type,
    null,
    500000,
    'require_approval'::public.estimate_rule_action,
    true
  );

  return new;
end;
$$;

revoke all on function public.seed_default_estimate_approval_rule()
  from public, anon, authenticated;

drop trigger if exists seed_default_estimate_approval_rule on public.tenants;
create trigger seed_default_estimate_approval_rule
  after insert on public.tenants
  for each row
  execute function public.seed_default_estimate_approval_rule();
