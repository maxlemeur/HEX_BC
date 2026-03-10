-- EST-374: per-user cockpit preferences for hidden/pinned contextual actions.

create table if not exists public.cockpit_command_preferences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  action_id text not null,
  is_hidden boolean not null default false,
  is_pinned boolean not null default false,
  constraint cockpit_command_preferences_action_id_not_blank_check
    check (btrim(action_id) <> ''),
  constraint cockpit_command_preferences_user_project_action_key
    unique (tenant_id, user_id, project_id, action_id)
);

create index if not exists cockpit_command_preferences_project_user_idx
  on public.cockpit_command_preferences (project_id, user_id, updated_at desc);

create index if not exists cockpit_command_preferences_visible_idx
  on public.cockpit_command_preferences (project_id, user_id, is_hidden, is_pinned, updated_at desc);

drop trigger if exists set_cockpit_command_preferences_updated_at on public.cockpit_command_preferences;
create trigger set_cockpit_command_preferences_updated_at
  before update on public.cockpit_command_preferences
  for each row execute procedure public.set_updated_at();

alter table if exists public.cockpit_command_preferences enable row level security;
alter table if exists public.cockpit_command_preferences force row level security;

drop policy if exists "Current tenant can select cockpit command preferences" on public.cockpit_command_preferences;
drop policy if exists "Current tenant can insert cockpit command preferences" on public.cockpit_command_preferences;
drop policy if exists "Current tenant can update cockpit command preferences" on public.cockpit_command_preferences;
drop policy if exists "Current tenant can delete cockpit command preferences" on public.cockpit_command_preferences;

create policy "Current tenant can select cockpit command preferences"
  on public.cockpit_command_preferences for select to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can insert cockpit command preferences"
  on public.cockpit_command_preferences for insert to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can update cockpit command preferences"
  on public.cockpit_command_preferences for update to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );

create policy "Current tenant can delete cockpit command preferences"
  on public.cockpit_command_preferences for delete to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and user_id = (select auth.uid())
  );
