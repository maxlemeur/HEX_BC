-- EST-383: generated ouvrage subdetail review, canonical composed works, and applied snapshots.

alter table public.estimate_assemblies
  add column if not exists reference_code text,
  add column if not exists unit text,
  add column if not exists pricing_source text,
  add column if not exists ds_cents integer not null default 0 check (ds_cents >= 0),
  add column if not exists indicative_target_price_cents integer not null default 0 check (indicative_target_price_cents >= 0),
  add column if not exists avg_output_rate numeric(12,3),
  add column if not exists avg_time_hours numeric(12,3),
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists estimate_assemblies_reference_code_idx
  on public.estimate_assemblies (tenant_id, reference_code)
  where reference_code is not null;

alter table public.estimate_assembly_items
  add column if not exists cost_type text not null default 'material'
    check (cost_type in ('material', 'labor', 'equipment', 'subcontract')),
  add column if not exists unit_cost_ht_cents integer not null default 0
    check (unit_cost_ht_cents >= 0),
  add column if not exists loss_coeff_bp integer not null default 0
    check (loss_coeff_bp >= 0 and loss_coeff_bp <= 100000),
  add column if not exists yield_value numeric(12,3)
    check (yield_value is null or yield_value > 0),
  add column if not exists yield_unit text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create index if not exists estimate_assembly_items_assembly_cost_type_idx
  on public.estimate_assembly_items (assembly_id, cost_type);

create table if not exists public.estimate_generated_ouvrage_subdetail_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  parent_work_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'reviewed', 'applied', 'discarded')),
  summary jsonb not null default '{}'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  applied_at timestamptz,
  constraint estimate_generated_ouvrage_subdetail_drafts_draft_work_key
    unique (draft_id, parent_work_id)
);

create table if not exists public.estimate_generated_ouvrage_subdetail_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  subdetail_id uuid not null references public.estimate_generated_ouvrage_subdetail_drafts(id) on delete cascade,
  parent_work_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  source_fragment_id uuid references public.estimate_generated_ouvrage_source_fragments(id) on delete set null,
  component_order integer not null default 0,
  status text not null default 'suggested'
    check (status in ('suggested', 'manual', 'rejected')),
  cost_type text not null
    check (cost_type in ('material', 'labor', 'equipment', 'subcontract')),
  designation text not null,
  unit text,
  quantity numeric(12,3) not null default 0 check (quantity >= 0),
  unit_cost_ht_cents integer not null default 0 check (unit_cost_ht_cents >= 0),
  loss_coeff_bp integer not null default 0 check (loss_coeff_bp >= 0 and loss_coeff_bp <= 100000),
  yield_value numeric(12,3) check (yield_value is null or yield_value > 0),
  yield_unit text,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  source_label text,
  facts jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.estimate_generated_ouvrage_subdetail_item_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  subdetail_id uuid not null references public.estimate_generated_ouvrage_subdetail_drafts(id) on delete cascade,
  parent_work_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  component_id uuid not null references public.estimate_generated_ouvrage_subdetail_items(id) on delete cascade,
  source_fragment_id uuid not null references public.estimate_generated_ouvrage_source_fragments(id) on delete cascade,
  source_rank integer not null default 0,
  evidence_kind text not null default 'fact'
    check (evidence_kind in ('fact', 'hypothesis', 'inference')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  constraint estimate_generated_ouvrage_subdetail_item_sources_unique
    unique (component_id, source_fragment_id, source_rank)
);

create table if not exists public.estimate_generated_ouvrage_work_snapshots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  parent_work_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  assembly_id uuid references public.estimate_assemblies(id) on delete set null,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  applied_by uuid references public.profiles(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  components jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint estimate_generated_ouvrage_work_snapshots_item_key
    unique (estimate_item_id)
);

create index if not exists estimate_generated_ouvrage_subdetail_drafts_project_parent_status_idx
  on public.estimate_generated_ouvrage_subdetail_drafts (project_id, parent_work_id, status, created_at desc);

create index if not exists estimate_generated_ouvrage_subdetail_drafts_pending_idx
  on public.estimate_generated_ouvrage_subdetail_drafts (tenant_id, target_version_id, created_by)
  where status in ('pending_review', 'reviewed');

create index if not exists estimate_generated_ouvrage_subdetail_items_project_parent_status_idx
  on public.estimate_generated_ouvrage_subdetail_items (project_id, parent_work_id, status, component_order);

create index if not exists estimate_generated_ouvrage_subdetail_items_fragment_idx
  on public.estimate_generated_ouvrage_subdetail_items (source_fragment_id, subdetail_id)
  where source_fragment_id is not null;

create index if not exists estimate_generated_ouvrage_subdetail_item_sources_fragment_idx
  on public.estimate_generated_ouvrage_subdetail_item_sources (source_fragment_id, subdetail_id, source_rank);

create index if not exists estimate_generated_ouvrage_work_snapshots_version_item_idx
  on public.estimate_generated_ouvrage_work_snapshots (target_version_id, estimate_item_id);

create or replace function public.assign_estimate_generated_ouvrage_subdetail_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id, d.project_id, d.target_version_id, d.created_by
    into new.tenant_id, new.project_id, new.target_version_id, new.created_by
  from public.estimate_generated_ouvrage_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_subdetail_item_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.tenant_id, s.project_id, s.draft_id, s.parent_work_id
    into new.tenant_id, new.project_id, new.draft_id, new.parent_work_id
  from public.estimate_generated_ouvrage_subdetail_drafts s
  where s.id = new.subdetail_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_subdetail_source_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.tenant_id, s.draft_id, s.parent_work_id
    into new.tenant_id, new.draft_id, new.parent_work_id
  from public.estimate_generated_ouvrage_subdetail_drafts s
  where s.id = new.subdetail_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_snapshot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id, d.project_id, d.target_version_id
    into new.tenant_id, new.project_id, new.target_version_id
  from public.estimate_generated_ouvrage_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_generated_ouvrage_subdetail_drafts_updated_at on public.estimate_generated_ouvrage_subdetail_drafts;
create trigger set_estimate_generated_ouvrage_subdetail_drafts_updated_at
  before update on public.estimate_generated_ouvrage_subdetail_drafts
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_subdetail_items_updated_at on public.estimate_generated_ouvrage_subdetail_items;
create trigger set_estimate_generated_ouvrage_subdetail_items_updated_at
  before update on public.estimate_generated_ouvrage_subdetail_items
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_work_snapshots_updated_at on public.estimate_generated_ouvrage_work_snapshots;
create trigger set_estimate_generated_ouvrage_work_snapshots_updated_at
  before update on public.estimate_generated_ouvrage_work_snapshots
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_subdetail_drafts_scope on public.estimate_generated_ouvrage_subdetail_drafts;
create trigger set_estimate_generated_ouvrage_subdetail_drafts_scope
  before insert or update on public.estimate_generated_ouvrage_subdetail_drafts
  for each row execute procedure public.assign_estimate_generated_ouvrage_subdetail_scope();

drop trigger if exists set_estimate_generated_ouvrage_subdetail_items_scope on public.estimate_generated_ouvrage_subdetail_items;
create trigger set_estimate_generated_ouvrage_subdetail_items_scope
  before insert or update on public.estimate_generated_ouvrage_subdetail_items
  for each row execute procedure public.assign_estimate_generated_ouvrage_subdetail_item_scope();

drop trigger if exists set_estimate_generated_ouvrage_subdetail_sources_scope on public.estimate_generated_ouvrage_subdetail_item_sources;
create trigger set_estimate_generated_ouvrage_subdetail_sources_scope
  before insert or update on public.estimate_generated_ouvrage_subdetail_item_sources
  for each row execute procedure public.assign_estimate_generated_ouvrage_subdetail_source_scope();

drop trigger if exists set_estimate_generated_ouvrage_work_snapshots_scope on public.estimate_generated_ouvrage_work_snapshots;
create trigger set_estimate_generated_ouvrage_work_snapshots_scope
  before insert or update on public.estimate_generated_ouvrage_work_snapshots
  for each row execute procedure public.assign_estimate_generated_ouvrage_snapshot_scope();

alter table public.estimate_generated_ouvrage_subdetail_drafts enable row level security;
alter table public.estimate_generated_ouvrage_subdetail_items enable row level security;
alter table public.estimate_generated_ouvrage_subdetail_item_sources enable row level security;
alter table public.estimate_generated_ouvrage_work_snapshots enable row level security;

alter table public.estimate_generated_ouvrage_subdetail_drafts force row level security;
alter table public.estimate_generated_ouvrage_subdetail_items force row level security;
alter table public.estimate_generated_ouvrage_subdetail_item_sources force row level security;
alter table public.estimate_generated_ouvrage_work_snapshots force row level security;

drop policy if exists "Users can view generated ouvrage subdetail drafts" on public.estimate_generated_ouvrage_subdetail_drafts;
drop policy if exists "Users can insert generated ouvrage subdetail drafts" on public.estimate_generated_ouvrage_subdetail_drafts;
drop policy if exists "Users can update generated ouvrage subdetail drafts" on public.estimate_generated_ouvrage_subdetail_drafts;
drop policy if exists "Users can delete generated ouvrage subdetail drafts" on public.estimate_generated_ouvrage_subdetail_drafts;

create policy "Users can view generated ouvrage subdetail drafts"
  on public.estimate_generated_ouvrage_subdetail_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_drafts.draft_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_drafts.tenant_id
    )
  );

create policy "Users can insert generated ouvrage subdetail drafts"
  on public.estimate_generated_ouvrage_subdetail_drafts
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_drafts.draft_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_drafts.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage subdetail drafts"
  on public.estimate_generated_ouvrage_subdetail_drafts
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_drafts.draft_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_drafts.tenant_id
        and (
          d.created_by = (select auth.uid())
          or (
            select public.has_tenant_role(
              d.tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_drafts.draft_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_drafts.tenant_id
        and (
          d.created_by = (select auth.uid())
          or (
            select public.has_tenant_role(
              d.tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Users can delete generated ouvrage subdetail drafts"
  on public.estimate_generated_ouvrage_subdetail_drafts
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_drafts.draft_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_drafts.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage subdetail items" on public.estimate_generated_ouvrage_subdetail_items;
drop policy if exists "Users can insert generated ouvrage subdetail items" on public.estimate_generated_ouvrage_subdetail_items;
drop policy if exists "Users can update generated ouvrage subdetail items" on public.estimate_generated_ouvrage_subdetail_items;
drop policy if exists "Users can delete generated ouvrage subdetail items" on public.estimate_generated_ouvrage_subdetail_items;

create policy "Users can view generated ouvrage subdetail items"
  on public.estimate_generated_ouvrage_subdetail_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_items.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_items.tenant_id
    )
  );

create policy "Users can insert generated ouvrage subdetail items"
  on public.estimate_generated_ouvrage_subdetail_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_items.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_items.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage subdetail items"
  on public.estimate_generated_ouvrage_subdetail_items
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_items.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_items.tenant_id
        and (
          d.created_by = (select auth.uid())
          or (
            select public.has_tenant_role(
              d.tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            )
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_items.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_items.tenant_id
        and (
          d.created_by = (select auth.uid())
          or (
            select public.has_tenant_role(
              d.tenant_id,
              array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
            )
          )
        )
    )
  );

create policy "Users can delete generated ouvrage subdetail items"
  on public.estimate_generated_ouvrage_subdetail_items
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_items.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_items.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage subdetail item sources" on public.estimate_generated_ouvrage_subdetail_item_sources;
drop policy if exists "Users can insert generated ouvrage subdetail item sources" on public.estimate_generated_ouvrage_subdetail_item_sources;
drop policy if exists "Users can update generated ouvrage subdetail item sources" on public.estimate_generated_ouvrage_subdetail_item_sources;
drop policy if exists "Users can delete generated ouvrage subdetail item sources" on public.estimate_generated_ouvrage_subdetail_item_sources;

create policy "Users can view generated ouvrage subdetail item sources"
  on public.estimate_generated_ouvrage_subdetail_item_sources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_item_sources.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_item_sources.tenant_id
    )
  );

create policy "Users can insert generated ouvrage subdetail item sources"
  on public.estimate_generated_ouvrage_subdetail_item_sources
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_item_sources.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_item_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage subdetail item sources"
  on public.estimate_generated_ouvrage_subdetail_item_sources
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_item_sources.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_item_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_item_sources.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_item_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage subdetail item sources"
  on public.estimate_generated_ouvrage_subdetail_item_sources
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_subdetail_drafts d
      where d.id = estimate_generated_ouvrage_subdetail_item_sources.subdetail_id
        and d.tenant_id = estimate_generated_ouvrage_subdetail_item_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;
drop policy if exists "Users can insert generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;
drop policy if exists "Users can update generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;
drop policy if exists "Users can delete generated ouvrage work snapshots" on public.estimate_generated_ouvrage_work_snapshots;

create policy "Users can view generated ouvrage work snapshots"
  on public.estimate_generated_ouvrage_work_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_work_snapshots.draft_id
        and d.tenant_id = estimate_generated_ouvrage_work_snapshots.tenant_id
    )
  );

create policy "Users can insert generated ouvrage work snapshots"
  on public.estimate_generated_ouvrage_work_snapshots
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_work_snapshots.draft_id
        and d.tenant_id = estimate_generated_ouvrage_work_snapshots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage work snapshots"
  on public.estimate_generated_ouvrage_work_snapshots
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_work_snapshots.draft_id
        and d.tenant_id = estimate_generated_ouvrage_work_snapshots.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_work_snapshots.draft_id
        and d.tenant_id = estimate_generated_ouvrage_work_snapshots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage work snapshots"
  on public.estimate_generated_ouvrage_work_snapshots
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_work_snapshots.draft_id
        and d.tenant_id = estimate_generated_ouvrage_work_snapshots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );
