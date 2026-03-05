-- Create the labor_roles table (was missing from deployed migrations).

create table if not exists public.labor_roles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  name text not null,
  hourly_rate_cents integer not null default 0 check (hourly_rate_cents >= 0),
  is_active boolean not null default true,
  position integer not null default 0,
  constraint labor_roles_tenant_user_name_key unique (tenant_id, user_id, name)
);

-- Indexes
create index if not exists labor_roles_user_id_idx on public.labor_roles (user_id);
create index if not exists labor_roles_tenant_id_idx on public.labor_roles (tenant_id);

-- updated_at trigger
create trigger set_labor_roles_updated_at
  before update on public.labor_roles
  for each row execute procedure public.set_updated_at();

-- tenant_id auto-assign trigger
create trigger set_labor_roles_tenant_id
  before insert or update on public.labor_roles
  for each row execute procedure public.assign_tenant_id();

-- Audit trigger
create trigger labor_roles_audit_trigger
  after insert or update or delete on public.labor_roles
  for each row execute procedure public.log_estimate_audit();

-- RLS
alter table public.labor_roles enable row level security;
alter table public.labor_roles force row level security;

create policy "Users can manage labor roles"
  on public.labor_roles
  for all
  to authenticated
  using (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  )
  with check (
    (select public.is_tenant_member(tenant_id))
    and (
      user_id = (select auth.uid())
      or (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
    )
  );
