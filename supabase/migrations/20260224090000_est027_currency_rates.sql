-- EST-027: tenant-scoped currency exchange rates.

create table if not exists public.currency_rates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  from_currency text not null,
  to_currency text not null,
  rate numeric(20,8) not null,
  effective_date date not null default current_date,
  source text not null default 'manual',
  is_active boolean not null default true,
  check (from_currency in ('EUR', 'USD', 'GBP')),
  check (to_currency in ('EUR', 'USD', 'GBP')),
  check (from_currency <> to_currency),
  check (source in ('manual', 'api')),
  check (rate > 0)
);

create unique index if not exists currency_rates_tenant_pair_date_unique_idx
  on public.currency_rates (tenant_id, from_currency, to_currency, effective_date);

create index if not exists currency_rates_tenant_pair_effective_idx
  on public.currency_rates (tenant_id, from_currency, to_currency, effective_date desc);

create index if not exists currency_rates_tenant_effective_idx
  on public.currency_rates (tenant_id, effective_date desc);

create or replace function public.normalize_currency_rates_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.from_currency := upper(trim(coalesce(new.from_currency, '')));
  new.to_currency := upper(trim(coalesce(new.to_currency, '')));
  new.source := lower(trim(coalesce(new.source, '')));
  return new;
end;
$$;

drop trigger if exists set_currency_rates_updated_at on public.currency_rates;
create trigger set_currency_rates_updated_at
  before update on public.currency_rates
  for each row execute procedure public.set_updated_at();

drop trigger if exists assign_currency_rates_tenant_id on public.currency_rates;
create trigger assign_currency_rates_tenant_id
  before insert on public.currency_rates
  for each row execute procedure public.assign_tenant_id();

drop trigger if exists normalize_currency_rates_fields on public.currency_rates;
create trigger normalize_currency_rates_fields
  before insert or update on public.currency_rates
  for each row execute procedure public.normalize_currency_rates_fields();

alter table public.currency_rates enable row level security;

drop policy if exists "Tenant members can view currency rates" on public.currency_rates;
drop policy if exists "Tenant admins can manage currency rates" on public.currency_rates;

create policy "Tenant members can view currency rates"
  on public.currency_rates
  for select
  to authenticated
  using ((select public.is_tenant_member(tenant_id)));

create policy "Tenant admins can manage currency rates"
  on public.currency_rates
  for all
  to authenticated
  using ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])))
  with check ((select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role])));
