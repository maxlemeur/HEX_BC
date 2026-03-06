-- EST-382: persisted IA structure drafts for explicit preview + apply.

create table if not exists public.estimate_structure_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'discarded')),
  strategy text not null default 'hybrid'
    check (strategy in ('hybrid')),
  summary jsonb not null default '{}'::jsonb,
  source_overview jsonb not null default '[]'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  applied_at timestamptz
);

create table if not exists public.estimate_structure_draft_nodes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null references public.estimate_structure_drafts(id) on delete cascade,
  parent_node_id uuid references public.estimate_structure_draft_nodes(id) on delete cascade,
  order_index integer not null check (order_index >= 0),
  hierarchy_level integer not null check (hierarchy_level between 1 and 3),
  label text not null,
  normalized_label text not null,
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  default_action text not null
    check (default_action in ('create', 'merge', 'skip')),
  duplicate_match_item_id uuid references public.estimate_items(id) on delete set null,
  duplicate_match_path text,
  provenance jsonb not null default '[]'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb
);

create table if not exists public.estimate_structure_draft_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null references public.estimate_structure_drafts(id) on delete cascade,
  draft_node_id uuid not null references public.estimate_structure_draft_nodes(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  applied_action text not null check (applied_action in ('create', 'merge')),
  applied_by uuid references auth.users(id) on delete set null,
  constraint estimate_structure_draft_applications_node_key unique (draft_node_id)
);

create index if not exists estimate_structure_drafts_target_version_idx
  on public.estimate_structure_drafts (tenant_id, target_version_id, created_at desc);

create index if not exists estimate_structure_drafts_pending_idx
  on public.estimate_structure_drafts (tenant_id, target_version_id, created_by)
  where status = 'pending';

create index if not exists estimate_structure_draft_nodes_parent_order_idx
  on public.estimate_structure_draft_nodes (draft_id, parent_node_id, order_index);

create index if not exists estimate_structure_draft_nodes_duplicate_match_idx
  on public.estimate_structure_draft_nodes (duplicate_match_item_id)
  where duplicate_match_item_id is not null;

create index if not exists estimate_structure_draft_applications_item_idx
  on public.estimate_structure_draft_applications (tenant_id, estimate_item_id);

create index if not exists estimate_structure_draft_applications_draft_idx
  on public.estimate_structure_draft_applications (tenant_id, draft_id, target_version_id);

create or replace function public.assign_estimate_structure_draft_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
begin
  select ev.tenant_id, ev.project_id
    into resolved_tenant_id, new.project_id
  from public.estimate_versions ev
  where ev.id = new.target_version_id;

  if resolved_tenant_id is null then
    resolved_tenant_id := public.current_tenant_id();
  end if;

  new.tenant_id := resolved_tenant_id;
  return new;
end;
$$;

create or replace function public.assign_estimate_structure_draft_node_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id
    into new.tenant_id
  from public.estimate_structure_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_structure_draft_application_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
begin
  select d.tenant_id
    into resolved_tenant_id
  from public.estimate_structure_drafts d
  where d.id = new.draft_id;

  if resolved_tenant_id is null then
    select ev.tenant_id
      into resolved_tenant_id
    from public.estimate_versions ev
    where ev.id = new.target_version_id;
  end if;

  if resolved_tenant_id is null then
    resolved_tenant_id := public.current_tenant_id();
  end if;

  new.tenant_id := resolved_tenant_id;
  return new;
end;
$$;

drop trigger if exists set_estimate_structure_drafts_updated_at on public.estimate_structure_drafts;
create trigger set_estimate_structure_drafts_updated_at
  before update on public.estimate_structure_drafts
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_structure_draft_nodes_updated_at on public.estimate_structure_draft_nodes;
create trigger set_estimate_structure_draft_nodes_updated_at
  before update on public.estimate_structure_draft_nodes
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_structure_drafts_tenant_id on public.estimate_structure_drafts;
create trigger set_estimate_structure_drafts_tenant_id
  before insert or update on public.estimate_structure_drafts
  for each row execute procedure public.assign_estimate_structure_draft_tenant_id();

drop trigger if exists set_estimate_structure_draft_nodes_tenant_id on public.estimate_structure_draft_nodes;
create trigger set_estimate_structure_draft_nodes_tenant_id
  before insert or update on public.estimate_structure_draft_nodes
  for each row execute procedure public.assign_estimate_structure_draft_node_tenant_id();

drop trigger if exists set_estimate_structure_draft_applications_tenant_id on public.estimate_structure_draft_applications;
create trigger set_estimate_structure_draft_applications_tenant_id
  before insert or update on public.estimate_structure_draft_applications
  for each row execute procedure public.assign_estimate_structure_draft_application_tenant_id();

alter table public.estimate_structure_drafts enable row level security;
alter table public.estimate_structure_draft_nodes enable row level security;
alter table public.estimate_structure_draft_applications enable row level security;

drop policy if exists "Users can view estimate structure drafts" on public.estimate_structure_drafts;
drop policy if exists "Users can insert estimate structure drafts" on public.estimate_structure_drafts;
drop policy if exists "Users can update estimate structure drafts" on public.estimate_structure_drafts;
drop policy if exists "Users can delete estimate structure drafts" on public.estimate_structure_drafts;

create policy "Users can view estimate structure drafts"
  on public.estimate_structure_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_structure_drafts.target_version_id
        and v.tenant_id = estimate_structure_drafts.tenant_id
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array[
                'admin'::public.tenant_role,
                'engineer'::public.tenant_role,
                'viewer'::public.tenant_role,
                'director'::public.tenant_role
              ]
            )
          )
        )
    )
  );

create policy "Users can insert estimate structure drafts"
  on public.estimate_structure_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_structure_drafts.target_version_id
        and v.tenant_id = estimate_structure_drafts.tenant_id
        and v.status = 'draft'
        and (select public.is_tenant_member(v.tenant_id))
        and (
          p.user_id = (select auth.uid())
          or (
            select public.has_tenant_role(
              v.tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Users can update estimate structure drafts"
  on public.estimate_structure_drafts
  for update
  to authenticated
  using (
    created_by = (select auth.uid())
  )
  with check (
    created_by = (select auth.uid())
  );

create policy "Users can delete estimate structure drafts"
  on public.estimate_structure_drafts
  for delete
  to authenticated
  using (
    created_by = (select auth.uid())
  );

drop policy if exists "Users can view estimate structure draft nodes" on public.estimate_structure_draft_nodes;
drop policy if exists "Users can insert estimate structure draft nodes" on public.estimate_structure_draft_nodes;
drop policy if exists "Users can update estimate structure draft nodes" on public.estimate_structure_draft_nodes;
drop policy if exists "Users can delete estimate structure draft nodes" on public.estimate_structure_draft_nodes;

create policy "Users can view estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
    )
  );

create policy "Users can insert estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete estimate structure draft nodes"
  on public.estimate_structure_draft_nodes
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_nodes.draft_id
        and d.tenant_id = estimate_structure_draft_nodes.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view estimate structure draft applications" on public.estimate_structure_draft_applications;
drop policy if exists "Users can insert estimate structure draft applications" on public.estimate_structure_draft_applications;
drop policy if exists "Users can delete estimate structure draft applications" on public.estimate_structure_draft_applications;

create policy "Users can view estimate structure draft applications"
  on public.estimate_structure_draft_applications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_applications.draft_id
        and d.tenant_id = estimate_structure_draft_applications.tenant_id
    )
  );

create policy "Users can insert estimate structure draft applications"
  on public.estimate_structure_draft_applications
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_applications.draft_id
        and d.tenant_id = estimate_structure_draft_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete estimate structure draft applications"
  on public.estimate_structure_draft_applications
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_structure_drafts d
      where d.id = estimate_structure_draft_applications.draft_id
        and d.tenant_id = estimate_structure_draft_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );
