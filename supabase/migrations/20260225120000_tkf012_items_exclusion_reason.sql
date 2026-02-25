-- TKF-012: Add exclusion_reason to takeoff_items
-- Stores the mandatory reason when an item is excluded (is_excluded = true).

alter table public.takeoff_items
  add column if not exists exclusion_reason text;
