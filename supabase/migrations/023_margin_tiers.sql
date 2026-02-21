-- EST-028: margin mode + tenant margin tiers.

do $$
begin
  create type public.estimate_margin_mode as enum ('fixed', 'tiered');
exception
  when duplicate_object then null;
end
$$;

alter table public.estimate_versions
  add column if not exists margin_mode public.estimate_margin_mode;

alter table public.estimate_versions
  disable trigger guard_estimate_versions_readonly;

update public.estimate_versions
set margin_mode = 'fixed'::public.estimate_margin_mode
where margin_mode is null;

alter table public.estimate_versions
  enable trigger guard_estimate_versions_readonly;

alter table public.estimate_versions
  alter column margin_mode set default 'fixed'::public.estimate_margin_mode;

alter table public.estimate_versions
  alter column margin_mode set not null;

create or replace function public.guard_estimate_versions_readonly()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    if new.status = old.status then
      raise exception 'Estimate version is read-only';
    end if;

    if new.created_at is distinct from old.created_at
      or new.project_id is distinct from old.project_id
      or new.version_number is distinct from old.version_number
      or new.title is distinct from old.title
      or new.date_devis is distinct from old.date_devis
      or new.validite_jours is distinct from old.validite_jours
      or new.margin_multiplier is distinct from old.margin_multiplier
      or new.margin_mode is distinct from old.margin_mode
      or new.currency is distinct from old.currency
      or new.margin_bp is distinct from old.margin_bp
      or new.discount_bp is distinct from old.discount_bp
      or new.tax_rate_bp is distinct from old.tax_rate_bp
      or new.rounding_mode is distinct from old.rounding_mode
      or new.rounding_step_cents is distinct from old.rounding_step_cents
      or new.total_ht_cents is distinct from old.total_ht_cents
      or new.total_tax_cents is distinct from old.total_tax_cents
      or new.total_ttc_cents is distinct from old.total_ttc_cents
    then
      raise exception 'Estimate version is read-only';
    end if;
  end if;

  return new;
end;
$$;

create table if not exists public.margin_tiers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  threshold_cents bigint not null check (threshold_cents >= 0),
  multiplier numeric not null check (multiplier >= 0 and multiplier <= 100),
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists margin_tiers_tenant_threshold_unique_idx
  on public.margin_tiers (tenant_id, threshold_cents);
create unique index if not exists margin_tiers_tenant_position_unique_idx
  on public.margin_tiers (tenant_id, position);

drop trigger if exists set_margin_tiers_updated_at on public.margin_tiers;
create trigger set_margin_tiers_updated_at
  before update on public.margin_tiers
  for each row execute procedure public.set_updated_at();

alter table public.margin_tiers enable row level security;

drop policy if exists "Tenant members can view margin tiers" on public.margin_tiers;
drop policy if exists "Tenant admins can manage margin tiers" on public.margin_tiers;

create policy "Tenant members can view margin tiers"
  on public.margin_tiers
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage margin tiers"
  on public.margin_tiers
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));

with default_tiers(threshold_cents, multiplier, position) as (
  values
    (0::bigint, 1.6::numeric, 0),
    (10000000::bigint, 1.45::numeric, 1),
    (100000000::bigint, 1.4::numeric, 2)
)
insert into public.margin_tiers (tenant_id, threshold_cents, multiplier, position)
select
  t.id,
  dt.threshold_cents,
  dt.multiplier,
  dt.position
from public.tenants t
cross join default_tiers dt
on conflict (tenant_id, threshold_cents) do nothing;
