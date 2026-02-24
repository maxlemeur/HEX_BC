-- TKF-029: create tenant-scoped takeoff mapping rules.

create table if not exists public.takeoff_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  name text not null,
  match_pattern text not null,
  match_type text not null,
  action text not null,
  action_params jsonb not null default '{}'::jsonb,
  priority integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null
);

alter table if exists public.takeoff_mapping_rules
  alter column tenant_id set default public.current_tenant_id(),
  alter column action_params set default '{}'::jsonb,
  alter column priority set default 100,
  alter column is_active set default true;

alter table if exists public.takeoff_mapping_rules
  alter column tenant_id set not null,
  alter column name set not null,
  alter column match_pattern set not null,
  alter column match_type set not null,
  alter column action set not null,
  alter column action_params set not null,
  alter column priority set not null,
  alter column is_active set not null;

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_match_type_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_match_type_check
  check (match_type in ('exact', 'contains', 'regex'));

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_action_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_action_check
  check (action in ('rename', 'set_price', 'set_category', 'apply_assembly', 'skip'));

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_priority_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_priority_check
  check (priority >= 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_name_not_blank_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_name_not_blank_check
  check (length(btrim(name)) > 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_match_pattern_not_blank_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_match_pattern_not_blank_check
  check (length(btrim(match_pattern)) > 0);

alter table if exists public.takeoff_mapping_rules
  drop constraint if exists takeoff_mapping_rules_action_params_object_check;
alter table if exists public.takeoff_mapping_rules
  add constraint takeoff_mapping_rules_action_params_object_check
  check (jsonb_typeof(action_params) = 'object');

create index if not exists takeoff_mapping_rules_tenant_active_priority_idx
  on public.takeoff_mapping_rules (tenant_id, is_active, priority);

drop trigger if exists set_takeoff_mapping_rules_updated_at on public.takeoff_mapping_rules;
create trigger set_takeoff_mapping_rules_updated_at
  before update on public.takeoff_mapping_rules
  for each row execute procedure public.set_updated_at();

alter table if exists public.takeoff_mapping_rules enable row level security;
alter table if exists public.takeoff_mapping_rules force row level security;

drop policy if exists "Current tenant can manage takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant members can view takeoff mapping rules" on public.takeoff_mapping_rules;
drop policy if exists "Current tenant admins can manage takeoff mapping rules" on public.takeoff_mapping_rules;

create policy "Current tenant members can view takeoff mapping rules"
  on public.takeoff_mapping_rules
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
  );

create policy "Current tenant admins can manage takeoff mapping rules"
  on public.takeoff_mapping_rules
  for all
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.has_tenant_role(tenant_id, array['admin'::public.tenant_role]))
  );
