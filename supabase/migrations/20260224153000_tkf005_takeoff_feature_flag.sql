-- TKF-005: bootstrap TAKEOFF_MODULE_ENABLED per tenant.

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, 'TAKEOFF_MODULE_ENABLED', false, null
from public.tenants t
on conflict (tenant_id, flag_key) do nothing;

create or replace function public.bootstrap_takeoff_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feature_flags (tenant_id, flag_key, enabled, value)
  values (new.id, 'TAKEOFF_MODULE_ENABLED', false, null)
  on conflict (tenant_id, flag_key) do nothing;

  return new;
end;
$$;

drop trigger if exists bootstrap_takeoff_feature_flags on public.tenants;
create trigger bootstrap_takeoff_feature_flags
after insert on public.tenants
for each row execute procedure public.bootstrap_takeoff_feature_flags();
