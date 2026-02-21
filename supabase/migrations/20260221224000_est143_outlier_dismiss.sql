-- EST-143: persist accepted outliers at line level.

create table if not exists public.estimate_item_outlier_dismissals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  item_id uuid not null references public.estimate_items(id) on delete cascade,
  flag_key text not null check (flag_key in ('price_outlier', 'quantity_outlier')),
  dismissed_by uuid not null references public.profiles(id) on delete restrict,
  dismissed_at timestamptz not null default now(),
  unique (version_id, item_id, flag_key)
);

alter table public.estimate_item_outlier_dismissals
  alter column tenant_id set default public.current_tenant_id();

create index if not exists estimate_item_outlier_dismissals_tenant_id_idx
  on public.estimate_item_outlier_dismissals (tenant_id);

create index if not exists estimate_item_outlier_dismissals_version_id_idx
  on public.estimate_item_outlier_dismissals (version_id);

create index if not exists estimate_item_outlier_dismissals_item_id_idx
  on public.estimate_item_outlier_dismissals (item_id);

create index if not exists estimate_item_outlier_dismissals_flag_key_idx
  on public.estimate_item_outlier_dismissals (flag_key);

drop trigger if exists set_estimate_item_outlier_dismissals_updated_at
  on public.estimate_item_outlier_dismissals;
create trigger set_estimate_item_outlier_dismissals_updated_at
  before update on public.estimate_item_outlier_dismissals
  for each row execute procedure public.set_updated_at();

create or replace function public.assign_estimate_item_outlier_dismissals_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_tenant_id uuid;
begin
  if new.version_id is not null then
    select ev.tenant_id
      into parent_tenant_id
    from public.estimate_versions ev
    where ev.id = new.version_id;
  end if;

  if parent_tenant_id is not null then
    new.tenant_id := parent_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_item_outlier_dismissals_tenant_id
  on public.estimate_item_outlier_dismissals;
create trigger set_estimate_item_outlier_dismissals_tenant_id
  before insert or update on public.estimate_item_outlier_dismissals
  for each row execute procedure public.assign_estimate_item_outlier_dismissals_tenant_id();

alter table public.estimate_item_outlier_dismissals enable row level security;

drop policy if exists "Users can view estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals;
drop policy if exists "Users can insert draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals;
drop policy if exists "Users can update draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals;
drop policy if exists "Users can delete draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals;

create policy "Users can view estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_item_outlier_dismissals.version_id
        and v.tenant_id = estimate_item_outlier_dismissals.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can insert draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      join public.estimate_items ei on ei.id = estimate_item_outlier_dismissals.item_id
      where v.id = estimate_item_outlier_dismissals.version_id
        and v.tenant_id = estimate_item_outlier_dismissals.tenant_id
        and v.status = 'draft'
        and ei.version_id = v.id
        and ei.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can update draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      join public.estimate_items ei on ei.id = estimate_item_outlier_dismissals.item_id
      where v.id = estimate_item_outlier_dismissals.version_id
        and v.tenant_id = estimate_item_outlier_dismissals.tenant_id
        and v.status = 'draft'
        and ei.version_id = v.id
        and ei.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      join public.estimate_items ei on ei.id = estimate_item_outlier_dismissals.item_id
      where v.id = estimate_item_outlier_dismissals.version_id
        and v.tenant_id = estimate_item_outlier_dismissals.tenant_id
        and v.status = 'draft'
        and ei.version_id = v.id
        and ei.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );

create policy "Users can delete draft estimate item outlier dismissals"
  on public.estimate_item_outlier_dismissals
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      join public.estimate_items ei on ei.id = estimate_item_outlier_dismissals.item_id
      where v.id = estimate_item_outlier_dismissals.version_id
        and v.tenant_id = estimate_item_outlier_dismissals.tenant_id
        and v.status = 'draft'
        and ei.version_id = v.id
        and ei.tenant_id = v.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
        )
    )
  );
