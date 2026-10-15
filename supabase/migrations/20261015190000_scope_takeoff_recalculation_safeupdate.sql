-- Scope the temporary allocation update to the owned estimate lines.
-- Keep safeupdate enabled and preserve the published fixed-discount calculation.
begin;

CREATE OR REPLACE FUNCTION public.recalculate_takeoff_estimate_version(p_version_id uuid, p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
declare
  target_version public.estimate_versions%rowtype;
  project_owner_id uuid;
  labor_split_enabled boolean := false;
  raw_cost_subtotal numeric := 0;
  effective_margin numeric;
  raw_ht bigint := 0;
  raw_tax bigint := 0;
  scaled_ht integer := 0;
  fixed_scaled_ht numeric;
  fixed_scaled_ht_floor numeric;
  scaled_tax integer := 0;
  discount_cents integer := 0;
  running_ht integer := 0;
  step_bp integer := 0;
  step_discount integer := 0;
  total_ht integer := 0;
  true_tax integer := 0;
  total_tax integer := 0;
  total_ttc integer := 0;
  unrounded_ttc integer := 0;
  rounding_adjustment integer := 0;
  effective_tax_rate_bp integer := 0;
  global_coefficient numeric := 1;
  rounding_step integer := 1;
  coefficient_shares bigint[] := '{}'::bigint[];
  discount_shares bigint[] := '{}'::bigint[];
  gross_sale_weights bigint[] := '{}'::bigint[];
  net_tax_weights bigint[] := '{}'::bigint[];
  adjusted_tax_shares bigint[] := '{}'::bigint[];
  max_cents constant integer := 2147483647;
begin
  if coalesce(
    current_setting('app.takeoff_apply_atomic', true),
    ''
  ) <> 'on' then
    raise exception 'TAKEOFF_ATOMIC_APPLY_REQUIRED' using errcode = '42501';
  end if;

  select version.*
    into target_version
  from public.estimate_versions as version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'ESTIMATE_VERSION_NOT_FOUND' using errcode = 'P0002';
  end if;

  if target_version.status <> 'draft'::public.estimate_status then
    raise exception 'ESTIMATE_VERSION_READ_ONLY' using errcode = '42501';
  end if;

  select project.user_id
    into project_owner_id
  from public.estimate_projects as project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id;

  if project_owner_id is null then
    raise exception 'ESTIMATE_PROJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(bool_or(flag.enabled), false)
    into labor_split_enabled
  from public.feature_flags as flag
  where flag.tenant_id = target_version.tenant_id
    and flag.flag_key = 'EST_031_LABOR_SPLIT';

  drop table if exists pg_temp._atomic_takeoff_line_calculations;
  create temporary table _atomic_takeoff_line_calculations (
    sequence integer not null unique,
    id uuid primary key,
    quantity numeric not null,
    cost_line_cents bigint not null,
    sale_line_cents integer,
    pu_ht_cents integer,
    tax_rate_bp integer not null,
    line_tax_cents integer,
    line_total_ttc_cents integer,
    coefficient_share_cents integer,
    discount_share_cents integer,
    net_ht_cents integer,
    net_tax_cents integer
  ) on commit drop;

  insert into pg_temp._atomic_takeoff_line_calculations (
    sequence,
    id,
    quantity,
    cost_line_cents,
    tax_rate_bp
  )
  select
    row_number() over (order by item.position, item.id)::integer,
    item.id,
    greatest(coalesce(item.quantity, 0), 0),
    least(
      max_cents,
      greatest(
        0,
        floor(
          least(
            max_cents::numeric,
            greatest(coalesce(item.quantity, 0), 0)
              * greatest(coalesce(item.unit_price_ht_cents, 0), 0)
              * greatest(coalesce(item.k_fo, 1), 0)
            + case
                when labor_split_enabled and (
                  coalesce(item.h_mo_atelier, 0) > 0
                  or item.labor_role_atelier_id is not null
                  or coalesce(item.h_mo_chantier, 0) > 0
                  or item.labor_role_chantier_id is not null
                  or coalesce(item.k_mo_atelier, 1) <> 1
                  or coalesce(item.k_mo_chantier, 1) <> 1
                ) then
                  greatest(coalesce(item.h_mo_majoration, 1), 0) * (
                    greatest(coalesce(item.h_mo_atelier, 0), 0)
                      * greatest(coalesce(role_atelier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_atelier, 1), 0)
                    + greatest(coalesce(item.h_mo_chantier, 0), 0)
                      * greatest(coalesce(role_chantier.hourly_rate_cents, 0), 0)
                      * greatest(coalesce(item.k_mo_chantier, 1), 0)
                  )
                else
                  greatest(coalesce(item.h_mo_majoration, 1), 0)
                    * greatest(coalesce(item.h_mo, 0), 0)
                    * greatest(coalesce(role_legacy.hourly_rate_cents, 0), 0)
                    * greatest(coalesce(item.k_mo, 1), 0)
              end
          ) + 0.5
        )
      )
    ),
    case
      when target_version.contractor_role = 'subcontractor' then 0
      when coalesce(target_version.calc_engine_version, 1) = 2
        then greatest(coalesce(item.tax_rate_bp, target_version.tax_rate_bp, 0), 0)
      else greatest(coalesce(target_version.tax_rate_bp, item.tax_rate_bp, 0), 0)
    end
  from public.estimate_items as item
  left join public.labor_roles as role_legacy
    on role_legacy.id = item.labor_role_id
   and role_legacy.tenant_id = target_version.tenant_id
   and role_legacy.user_id = project_owner_id
  left join public.labor_roles as role_atelier
    on role_atelier.id = item.labor_role_atelier_id
   and role_atelier.tenant_id = target_version.tenant_id
   and role_atelier.user_id = project_owner_id
  left join public.labor_roles as role_chantier
    on role_chantier.id = item.labor_role_chantier_id
   and role_chantier.tenant_id = target_version.tenant_id
   and role_chantier.user_id = project_owner_id
  where item.version_id = target_version.id
    and item.tenant_id = target_version.tenant_id
    and item.item_type = 'line'::public.estimate_item_type;

  select coalesce(sum(calculation.cost_line_cents), 0)
    into raw_cost_subtotal
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  if target_version.margin_mode = 'tiered'::public.estimate_margin_mode then
    select least(greatest(tier.multiplier, 0), 100)
      into effective_margin
    from public.margin_tiers as tier
    where tier.tenant_id = target_version.tenant_id
    order by
      (tier.threshold_cents <= raw_cost_subtotal) desc,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.threshold_cents
      end desc nulls last,
      case
        when tier.threshold_cents <= raw_cost_subtotal
          then tier.position
      end desc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.threshold_cents
      end asc nulls last,
      case
        when tier.threshold_cents > raw_cost_subtotal
          then tier.position
      end asc nulls last,
      tier.id
    limit 1;

    if effective_margin is null then
      effective_margin := case
        when raw_cost_subtotal >= 100000000 then 1.4
        when raw_cost_subtotal >= 10000000 then 1.45
        else 1.6
      end;
    end if;
  else
    effective_margin := least(
      greatest(coalesce(target_version.margin_multiplier, 1), 0),
      100
    );
  end if;

  with computed as (
    select
      calculation.id,
      least(
        max_cents,
        greatest(
          0,
          floor(
            calculation.cost_line_cents::numeric * effective_margin + 0.5
          )
        )
      )::integer as sale_line_cents
    from pg_temp._atomic_takeoff_line_calculations as calculation
  ), complete as (
    select
      computed.id,
      computed.sale_line_cents,
      least(
        max_cents,
        greatest(
          0,
          floor(
            computed.sale_line_cents::numeric
              * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer as line_tax_cents
    from computed
    join pg_temp._atomic_takeoff_line_calculations as calculation
      on calculation.id = computed.id
  )
  update pg_temp._atomic_takeoff_line_calculations as calculation
  set
    sale_line_cents = complete.sale_line_cents,
    pu_ht_cents = case
      when calculation.quantity > 0 then least(
        max_cents,
        greatest(
          0,
          public.takeoff_round_half_even(
            complete.sale_line_cents::numeric / calculation.quantity
          )
        )
      )
      else 0
    end,
    line_tax_cents = complete.line_tax_cents,
    line_total_ttc_cents = least(
      max_cents,
      complete.sale_line_cents + complete.line_tax_cents
    )
  from complete
  where calculation.id = complete.id;

  select
    coalesce(sum(calculation.sale_line_cents), 0),
    coalesce(sum(calculation.line_tax_cents), 0)
    into raw_ht, raw_tax
  from pg_temp._atomic_takeoff_line_calculations as calculation;

  global_coefficient := greatest(
    coalesce(target_version.global_coefficient, 1),
    0
  );
  if target_version.discount_amount_cents is not null then
    -- Fixed-amount calculations match the active JS coefficient's strict
    -- near-half tolerance. Cap numeric before any bigint/integer conversion.
    fixed_scaled_ht := greatest(raw_ht::numeric * global_coefficient, 0);
    if fixed_scaled_ht >= max_cents then
      scaled_ht := max_cents;
    else
      fixed_scaled_ht_floor := floor(fixed_scaled_ht);
      scaled_ht := (case
        when abs(fixed_scaled_ht - fixed_scaled_ht_floor - 0.5) < 0.000000001
          then fixed_scaled_ht_floor + mod(fixed_scaled_ht_floor, 2)
        else floor(fixed_scaled_ht + 0.5)
      end)::integer;
    end if;
  else
    scaled_ht := least(
      max_cents,
      greatest(
        0,
        public.takeoff_round_half_even(raw_ht::numeric * global_coefficient)
      )
    )::integer;
  end if;

  effective_tax_rate_bp := case
    when target_version.contractor_role = 'subcontractor' then 0
    else greatest(coalesce(target_version.tax_rate_bp, 0), 0)
  end;
  scaled_tax := case
    when global_coefficient = 1 then least(max_cents, greatest(raw_tax, 0))::integer
    else least(
      max_cents,
      greatest(
        0,
        floor(
          scaled_ht::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
        )::integer
      )
    )
  end;

  if target_version.discount_amount_cents is not null then
    -- Keep the requested amount; only the applied discount is capped.
    discount_cents := least(scaled_ht, target_version.discount_amount_cents);
  elsif target_version.discount_mode = 'cascade'::public.estimate_discount_mode then
    running_ht := scaled_ht;
    foreach step_bp in array coalesce(target_version.discount_steps, '{}'::integer[]) loop
      step_bp := least(greatest(coalesce(step_bp, 0), 0), 10000);
      step_discount := least(
        running_ht,
        greatest(
          0,
          public.takeoff_round_half_even(
            running_ht::numeric * step_bp::numeric / 10000
          )
        )::integer
      );
      discount_cents := discount_cents + step_discount;
      running_ht := running_ht - step_discount;
      exit when running_ht <= 0;
    end loop;
  else
    step_bp := case
      when coalesce(cardinality(target_version.discount_steps), 0) > 0
        then coalesce(target_version.discount_steps[1], 0)
      else coalesce(target_version.discount_bp, 0)
    end;
    step_bp := least(greatest(step_bp, 0), 10000);
    discount_cents := least(
      scaled_ht,
      greatest(
        0,
        public.takeoff_round_half_even(
          scaled_ht::numeric * step_bp::numeric / 10000
        )
      )::integer
    );
  end if;

  total_ht := greatest(scaled_ht - discount_cents, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.sale_line_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into gross_sale_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    coefficient_shares := public.takeoff_allocate_pro_rata(
      scaled_ht,
      gross_sale_weights
    );
    discount_shares := public.takeoff_allocate_pro_rata(
      discount_cents,
      coefficient_shares
    );

    update pg_temp._atomic_takeoff_line_calculations as calculation
    set
      coefficient_share_cents = coefficient_shares[calculation.sequence],
      discount_share_cents = discount_shares[calculation.sequence],
      net_ht_cents = coefficient_shares[calculation.sequence]
        - discount_shares[calculation.sequence],
      net_tax_cents = least(
        max_cents,
        greatest(
          0,
          floor(
            (
              coefficient_shares[calculation.sequence]
                - discount_shares[calculation.sequence]
            )::numeric * calculation.tax_rate_bp::numeric / 10000 + 0.5
          )
        )
      )::integer
    where exists (
      select 1
      from public.estimate_items as source_item
      where source_item.id = calculation.id
        and source_item.version_id = target_version.id
        and source_item.tenant_id = target_version.tenant_id
    );

    select
      coalesce(sum(calculation.net_ht_cents), 0),
      coalesce(sum(calculation.net_tax_cents), 0)
      into total_ht, true_tax
    from pg_temp._atomic_takeoff_line_calculations as calculation;
  else
    true_tax := greatest(
      scaled_tax - floor(
        discount_cents::numeric * effective_tax_rate_bp::numeric / 10000 + 0.5
      )::integer,
      0
    );
  end if;

  unrounded_ttc := least(max_cents, total_ht + true_tax);
  total_ttc := unrounded_ttc;
  rounding_step := greatest(coalesce(target_version.rounding_step_cents, 1), 1);

  if target_version.contractor_role <> 'subcontractor' then
    if target_version.rounding_mode = 'nearest'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric + 0.5
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'up'::public.estimate_rounding_mode then
      total_ttc := ceil(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    elsif target_version.rounding_mode = 'down'::public.estimate_rounding_mode then
      total_ttc := floor(
        total_ttc::numeric / rounding_step::numeric
      )::integer * rounding_step;
    end if;
  end if;

  total_ttc := least(max_cents, greatest(total_ttc, total_ht));
  rounding_adjustment := total_ttc - unrounded_ttc;
  total_tax := greatest(total_ttc - total_ht, 0);

  if coalesce(target_version.calc_engine_version, 1) = 2 then
    select coalesce(
      array_agg(calculation.net_tax_cents::bigint order by calculation.sequence),
      '{}'::bigint[]
    )
      into net_tax_weights
    from pg_temp._atomic_takeoff_line_calculations as calculation;

    adjusted_tax_shares := public.takeoff_allocate_pro_rata(
      total_tax,
      net_tax_weights
    );

    update public.estimate_items as item
    set
      pu_ht_cents = case
        when calculation.quantity > 0 then least(
          max_cents,
          greatest(
            0,
            public.takeoff_round_half_even(
              calculation.net_ht_cents::numeric / calculation.quantity
            )
          )
        )
        else 0
      end,
      line_total_ht_cents = calculation.net_ht_cents,
      line_tax_cents = adjusted_tax_shares[calculation.sequence],
      line_total_ttc_cents = calculation.net_ht_cents
        + adjusted_tax_shares[calculation.sequence],
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  else
    update public.estimate_items as item
    set
      tax_rate_bp = target_version.tax_rate_bp,
      pu_ht_cents = calculation.pu_ht_cents,
      line_total_ht_cents = calculation.sale_line_cents,
      line_tax_cents = calculation.line_tax_cents,
      line_total_ttc_cents = calculation.line_total_ttc_cents,
      updated_at = statement_timestamp()
    from pg_temp._atomic_takeoff_line_calculations as calculation
    where item.id = calculation.id
      and item.version_id = target_version.id
      and item.tenant_id = target_version.tenant_id;
  end if;

  update public.estimate_versions as version
  set
    total_ht_cents = total_ht,
    total_tax_cents = total_tax,
    total_ttc_cents = total_ttc,
    rounding_adjustment_cents = rounding_adjustment,
    updated_at = statement_timestamp()
  where version.id = target_version.id
    and version.tenant_id = target_version.tenant_id;
end;
$function$;

commit;
