-- TKF-023: bootstrap tenant-level chunking flags for Level C PDF processing.

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, f.key, true, f.value
from public.tenants t
cross join (
  values
    ('TAKEOFF_C_CHUNK_THRESHOLD_PAGES', '15'),
    ('TAKEOFF_C_CHUNK_SIZE_PAGES', '10'),
    ('TAKEOFF_C_CHUNK_OVERLAP_PAGES', '2'),
    ('TAKEOFF_C_MAX_PDF_PAGES', '200')
) as f(key, value)
on conflict (tenant_id, flag_key) do nothing;

create or replace function public.bootstrap_takeoff_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feature_flags (tenant_id, flag_key, enabled, value)
  values
    (new.id, 'TAKEOFF_MODULE_ENABLED', false, null),
    (new.id, 'TAKEOFF_C_CHUNK_THRESHOLD_PAGES', true, '15'),
    (new.id, 'TAKEOFF_C_CHUNK_SIZE_PAGES', true, '10'),
    (new.id, 'TAKEOFF_C_CHUNK_OVERLAP_PAGES', true, '2'),
    (new.id, 'TAKEOFF_C_MAX_PDF_PAGES', true, '200')
  on conflict (tenant_id, flag_key) do nothing;

  return new;
end;
$$;
