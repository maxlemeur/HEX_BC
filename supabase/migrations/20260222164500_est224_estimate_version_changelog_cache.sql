-- EST-224: cache changelog by estimate version pair to avoid recomputation.

create table if not exists public.estimate_version_changelogs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  previous_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  current_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  previous_version_updated_at timestamptz not null,
  current_version_updated_at timestamptz not null,
  changelog_payload jsonb not null default '{}'::jsonb,
  delta_ht_cents integer not null default 0,
  delta_ttc_cents integer not null default 0,
  computed_at timestamptz not null default now(),
  check (previous_version_id <> current_version_id),
  unique (tenant_id, previous_version_id, current_version_id)
);

create index if not exists estimate_version_changelogs_tenant_project_idx
  on public.estimate_version_changelogs (tenant_id, project_id);

create index if not exists estimate_version_changelogs_previous_version_idx
  on public.estimate_version_changelogs (previous_version_id);

create index if not exists estimate_version_changelogs_current_version_idx
  on public.estimate_version_changelogs (current_version_id);

drop trigger if exists set_estimate_version_changelogs_updated_at on public.estimate_version_changelogs;
create trigger set_estimate_version_changelogs_updated_at
  before update on public.estimate_version_changelogs
  for each row execute procedure public.set_updated_at();

alter table public.estimate_version_changelogs enable row level security;

drop policy if exists "Users can view estimate version changelogs" on public.estimate_version_changelogs;
drop policy if exists "Users can insert estimate version changelogs" on public.estimate_version_changelogs;
drop policy if exists "Users can update estimate version changelogs" on public.estimate_version_changelogs;
drop policy if exists "Admins can delete estimate version changelogs" on public.estimate_version_changelogs;

create policy "Users can view estimate version changelogs"
  on public.estimate_version_changelogs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_projects p
      join public.estimate_versions pv on pv.id = estimate_version_changelogs.previous_version_id
      join public.estimate_versions cv on cv.id = estimate_version_changelogs.current_version_id
      where p.id = estimate_version_changelogs.project_id
        and p.tenant_id = estimate_version_changelogs.tenant_id
        and pv.tenant_id = estimate_version_changelogs.tenant_id
        and cv.tenant_id = estimate_version_changelogs.tenant_id
        and pv.project_id = p.id
        and cv.project_id = p.id
        and (select public.is_tenant_member(estimate_version_changelogs.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              estimate_version_changelogs.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Users can insert estimate version changelogs"
  on public.estimate_version_changelogs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_projects p
      join public.estimate_versions pv on pv.id = estimate_version_changelogs.previous_version_id
      join public.estimate_versions cv on cv.id = estimate_version_changelogs.current_version_id
      where p.id = estimate_version_changelogs.project_id
        and p.tenant_id = estimate_version_changelogs.tenant_id
        and pv.tenant_id = estimate_version_changelogs.tenant_id
        and cv.tenant_id = estimate_version_changelogs.tenant_id
        and pv.project_id = p.id
        and cv.project_id = p.id
        and (select public.is_tenant_member(estimate_version_changelogs.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              estimate_version_changelogs.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Users can update estimate version changelogs"
  on public.estimate_version_changelogs
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_projects p
      join public.estimate_versions pv on pv.id = estimate_version_changelogs.previous_version_id
      join public.estimate_versions cv on cv.id = estimate_version_changelogs.current_version_id
      where p.id = estimate_version_changelogs.project_id
        and p.tenant_id = estimate_version_changelogs.tenant_id
        and pv.tenant_id = estimate_version_changelogs.tenant_id
        and cv.tenant_id = estimate_version_changelogs.tenant_id
        and pv.project_id = p.id
        and cv.project_id = p.id
        and (select public.is_tenant_member(estimate_version_changelogs.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              estimate_version_changelogs.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_projects p
      join public.estimate_versions pv on pv.id = estimate_version_changelogs.previous_version_id
      join public.estimate_versions cv on cv.id = estimate_version_changelogs.current_version_id
      where p.id = estimate_version_changelogs.project_id
        and p.tenant_id = estimate_version_changelogs.tenant_id
        and pv.tenant_id = estimate_version_changelogs.tenant_id
        and cv.tenant_id = estimate_version_changelogs.tenant_id
        and pv.project_id = p.id
        and cv.project_id = p.id
        and (select public.is_tenant_member(estimate_version_changelogs.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              estimate_version_changelogs.tenant_id,
              array['admin'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Admins can delete estimate version changelogs"
  on public.estimate_version_changelogs
  for delete
  to authenticated
  using ((
    select public.has_tenant_role(
      estimate_version_changelogs.tenant_id,
      array['admin'::public.tenant_role]
    )
  ));
