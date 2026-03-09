-- EST-374: cockpit command history for tracking contextual action usage.

create table if not exists public.cockpit_command_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  action_id text not null,
  intent text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index cockpit_command_history_project_idx
  on public.cockpit_command_history (project_id, created_at desc);
create index cockpit_command_history_user_idx
  on public.cockpit_command_history (user_id, created_at desc);

alter table public.cockpit_command_history enable row level security;

create policy "Current tenant can read cockpit command history"
  on public.cockpit_command_history for select to authenticated
  using (tenant_id = (select public.current_tenant_id()));

create policy "Current tenant can insert cockpit command history"
  on public.cockpit_command_history for insert to authenticated
  with check (tenant_id = (select public.current_tenant_id()));
