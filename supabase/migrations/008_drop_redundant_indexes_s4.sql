-- Migration S4: remove redundant non-unique indexes covered by unique constraints.

drop index if exists public.delivery_sites_project_code_idx;
drop index if exists public.products_reference_idx;
