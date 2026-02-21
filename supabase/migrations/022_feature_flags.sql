-- EST-006: tenant-scoped feature flags runtime.

create table if not exists public.feature_flags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  flag_key text not null,
  enabled boolean not null default false,
  check (length(trim(flag_key)) > 0),
  unique (tenant_id, flag_key)
);

create index if not exists feature_flags_tenant_enabled_idx
  on public.feature_flags (tenant_id, enabled);

drop trigger if exists set_feature_flags_updated_at on public.feature_flags;
create trigger set_feature_flags_updated_at
  before update on public.feature_flags
  for each row execute procedure public.set_updated_at();

alter table public.feature_flags enable row level security;

drop policy if exists "Tenant members can view feature flags" on public.feature_flags;
drop policy if exists "Tenant admins can manage feature flags" on public.feature_flags;

create policy "Tenant members can view feature flags"
  on public.feature_flags
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage feature flags"
  on public.feature_flags
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));
