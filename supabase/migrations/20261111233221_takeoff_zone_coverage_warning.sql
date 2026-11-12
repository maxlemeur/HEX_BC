-- TI-684 (D14, coverage by the overview). No remote application is authorized here.
-- The rule zone_coverage fails a line of an overview for what it draws inside the perimeter of an enlarged plan that
-- does not draw it (ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN). Like a duplicate between zones, it is a quantity warning
-- (TI-681): it recommends a review and never blocks the application.
-- public.takeoff_item_rule_blocked is re-created from its newest body (20261109205839_takeoff_targeted_quantity_review.sql)
-- with that one code added to its list; nothing else changes. Until this migration is applied, the code is unknown to
-- the guard, which keeps its protection: such a line blocks the application until it is verified. The TS twin of the
-- list is QUANTITY_WARNING_CODES (src/lib/takeoff/quantity-review-policy.ts).
-- CREATE OR REPLACE keeps the owner and the grants; no data is rewritten.
begin;

create or replace function public.takeoff_item_rule_blocked(
  p_rule_results jsonb,
  p_rules_stale boolean,
  p_is_verified boolean
)
returns boolean
language sql
stable
set search_path = pg_catalog, pg_temp
as $$
  select coalesce(p_rules_stale, false) or exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(p_rule_results) = 'array' then p_rule_results else '[]'::jsonb end
    ) as entry(value)
    where entry.value ->> 'status' = 'fail'
      and coalesce(entry.value ->> 'code', '') not in ('DN_NETWORK_NETWORK_MISSING', 'DN_NETWORK_MATERIAL_MISSING', 'DN_NETWORK_DN_MISSING', 'DN_NETWORK_DN_NOT_IN_SERIES', 'ZONE_OVERLAP_DUPLICATE', 'ZONE_OVERLAP_UNREGISTERED', 'ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN', 'SCALE_DIMENSION_MISMATCH', 'AREA_PRINTED_MISMATCH', 'ROOM_OVERLAP', 'CLOSED_BOX_LABEL', 'CLOSED_BOX_SHAPE', 'NON_OBSERVABLE_TO_ENTER')
      and (
        entry.value -> 'acceptable' is distinct from 'true'::jsonb
        or not coalesce(p_is_verified, false)
      )
      and not public.takeoff_rule_failure_left_out(entry.value)
  );
$$;

commit;
