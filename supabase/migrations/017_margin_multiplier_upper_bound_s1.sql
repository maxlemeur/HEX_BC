-- A6: Add upper bound to margin_multiplier to prevent integer overflow
-- in computed cents columns (max PostgreSQL integer = 2,147,483,647).
-- A multiplier of 100 allows cost lines up to ~21.5M EUR before overflow.

alter table public.estimate_versions
  drop constraint if exists estimate_versions_margin_multiplier_check;

alter table public.estimate_versions
  add constraint estimate_versions_margin_multiplier_check
  check (margin_multiplier >= 0 and margin_multiplier <= 100);

-- Also update the guard_estimate_versions_readonly trigger to include this
-- constraint in the read-only check (no change needed: existing trigger
-- already prevents any field change on non-draft versions).
