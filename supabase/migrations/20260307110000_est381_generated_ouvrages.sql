-- EST-381: persisted generated ouvrage drafts with explicit review, provenance, and apply audit.

create table if not exists public.estimate_generated_ouvrage_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  source_kind text not null
    check (source_kind in ('free_text', 'cctp_excerpt', 'internal_note')),
  preferred_lot_id uuid references public.estimate_items(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'partially_applied', 'applied', 'discarded')),
  summary jsonb not null default '{}'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  applied_at timestamptz
);

create table if not exists public.estimate_generated_ouvrage_source_fragments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  fragment_order integer not null check (fragment_order >= 0),
  source_kind text not null
    check (source_kind in ('free_text', 'cctp_excerpt', 'internal_note', 'history', 'library')),
  status text not null default 'active'
    check (status in ('active', 'discarded')),
  label text not null,
  excerpt text not null,
  normalized_excerpt text not null,
  source_document_id uuid references public.affaire_intake_documents(id) on delete set null,
  source_file_name text,
  source_page_from integer check (source_page_from is null or source_page_from >= 1),
  source_page_to integer check (source_page_to is null or source_page_to >= 1),
  selection_label text,
  cctp_section_ref text,
  metadata jsonb not null default '{}'::jsonb,
  constraint estimate_generated_ouvrage_source_fragments_page_range_check
    check (
      source_page_from is null
      or source_page_to is null
      or source_page_to >= source_page_from
    )
);

create table if not exists public.estimate_generated_ouvrage_candidates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  candidate_order integer not null check (candidate_order >= 0),
  suggested_lot_id uuid references public.estimate_items(id) on delete set null,
  lot_label text,
  designation text not null,
  normalized_designation text not null,
  unit text,
  quantity numeric(12,3),
  confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1),
  ai_status text not null
    check (ai_status in ('certain', 'plausible', 'question')),
  resolution_status text not null default 'pending'
    check (resolution_status in ('pending', 'inserted', 'rejected')),
  reasoning text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.estimate_generated_ouvrage_candidate_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  candidate_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  source_fragment_id uuid not null references public.estimate_generated_ouvrage_source_fragments(id) on delete cascade,
  source_rank integer not null default 0 check (source_rank >= 0),
  rationale text,
  metadata jsonb not null default '{}'::jsonb,
  constraint estimate_generated_ouvrage_candidate_sources_candidate_fragment_key
    unique (candidate_id, source_fragment_id)
);

create table if not exists public.estimate_generated_ouvrage_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  draft_id uuid not null references public.estimate_generated_ouvrage_drafts(id) on delete cascade,
  candidate_id uuid not null references public.estimate_generated_ouvrage_candidates(id) on delete cascade,
  target_version_id uuid not null references public.estimate_versions(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  applied_by uuid references auth.users(id) on delete set null,
  applied_payload jsonb not null default '{}'::jsonb,
  constraint estimate_generated_ouvrage_applications_candidate_key unique (candidate_id)
);

create index if not exists estimate_generated_ouvrage_drafts_version_idx
  on public.estimate_generated_ouvrage_drafts (tenant_id, target_version_id, created_at desc);

create index if not exists estimate_generated_ouvrage_drafts_project_status_idx
  on public.estimate_generated_ouvrage_drafts (project_id, status, created_at desc);

create index if not exists estimate_generated_ouvrage_drafts_pending_idx
  on public.estimate_generated_ouvrage_drafts (tenant_id, target_version_id, created_by)
  where status = 'pending';

create index if not exists estimate_generated_ouvrage_source_fragments_draft_order_idx
  on public.estimate_generated_ouvrage_source_fragments (draft_id, fragment_order);

create index if not exists estimate_generated_ouvrage_source_fragments_project_status_idx
  on public.estimate_generated_ouvrage_source_fragments (project_id, status, created_at desc);

create index if not exists estimate_generated_ouvrage_source_fragments_source_document_idx
  on public.estimate_generated_ouvrage_source_fragments (source_document_id, status, created_at desc)
  where source_document_id is not null;

create index if not exists estimate_generated_ouvrage_source_fragments_cctp_section_idx
  on public.estimate_generated_ouvrage_source_fragments (project_id, cctp_section_ref)
  where cctp_section_ref is not null;

create index if not exists estimate_generated_ouvrage_candidates_draft_status_idx
  on public.estimate_generated_ouvrage_candidates (draft_id, resolution_status, candidate_order);

create index if not exists estimate_generated_ouvrage_candidates_version_status_idx
  on public.estimate_generated_ouvrage_candidates (target_version_id, resolution_status, created_at desc);

create index if not exists estimate_generated_ouvrage_candidate_sources_candidate_idx
  on public.estimate_generated_ouvrage_candidate_sources (candidate_id, source_rank);

create index if not exists estimate_generated_ouvrage_candidate_sources_fragment_idx
  on public.estimate_generated_ouvrage_candidate_sources (source_fragment_id);

create index if not exists estimate_generated_ouvrage_applications_item_idx
  on public.estimate_generated_ouvrage_applications (tenant_id, estimate_item_id);

create index if not exists estimate_generated_ouvrage_applications_draft_idx
  on public.estimate_generated_ouvrage_applications (tenant_id, draft_id, target_version_id);

create or replace function public.assign_estimate_generated_ouvrage_draft_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  resolved_project_id uuid;
begin
  select ev.tenant_id, ev.project_id
    into resolved_tenant_id, resolved_project_id
  from public.estimate_versions ev
  where ev.id = new.target_version_id;

  if resolved_tenant_id is null then
    resolved_tenant_id := public.current_tenant_id();
  end if;

  new.tenant_id := resolved_tenant_id;
  if new.project_id is null then
    new.project_id := resolved_project_id;
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_fragment_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id, d.project_id
    into new.tenant_id, new.project_id
  from public.estimate_generated_ouvrage_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_candidate_scope()
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

create or replace function public.assign_estimate_generated_ouvrage_candidate_source_tenant_id()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id
    into new.tenant_id
  from public.estimate_generated_ouvrage_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_generated_ouvrage_application_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id, d.target_version_id
    into new.tenant_id, new.target_version_id
  from public.estimate_generated_ouvrage_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_generated_ouvrage_drafts_updated_at on public.estimate_generated_ouvrage_drafts;
create trigger set_estimate_generated_ouvrage_drafts_updated_at
  before update on public.estimate_generated_ouvrage_drafts
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_source_fragments_updated_at on public.estimate_generated_ouvrage_source_fragments;
create trigger set_estimate_generated_ouvrage_source_fragments_updated_at
  before update on public.estimate_generated_ouvrage_source_fragments
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_candidates_updated_at on public.estimate_generated_ouvrage_candidates;
create trigger set_estimate_generated_ouvrage_candidates_updated_at
  before update on public.estimate_generated_ouvrage_candidates
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_applications_updated_at on public.estimate_generated_ouvrage_applications;
create trigger set_estimate_generated_ouvrage_applications_updated_at
  before update on public.estimate_generated_ouvrage_applications
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_generated_ouvrage_drafts_tenant_id on public.estimate_generated_ouvrage_drafts;
create trigger set_estimate_generated_ouvrage_drafts_tenant_id
  before insert or update on public.estimate_generated_ouvrage_drafts
  for each row execute procedure public.assign_estimate_generated_ouvrage_draft_tenant_id();

drop trigger if exists set_estimate_generated_ouvrage_source_fragments_scope on public.estimate_generated_ouvrage_source_fragments;
create trigger set_estimate_generated_ouvrage_source_fragments_scope
  before insert or update on public.estimate_generated_ouvrage_source_fragments
  for each row execute procedure public.assign_estimate_generated_ouvrage_fragment_scope();

drop trigger if exists set_estimate_generated_ouvrage_candidates_scope on public.estimate_generated_ouvrage_candidates;
create trigger set_estimate_generated_ouvrage_candidates_scope
  before insert or update on public.estimate_generated_ouvrage_candidates
  for each row execute procedure public.assign_estimate_generated_ouvrage_candidate_scope();

drop trigger if exists set_estimate_generated_ouvrage_candidate_sources_tenant_id on public.estimate_generated_ouvrage_candidate_sources;
create trigger set_estimate_generated_ouvrage_candidate_sources_tenant_id
  before insert or update on public.estimate_generated_ouvrage_candidate_sources
  for each row execute procedure public.assign_estimate_generated_ouvrage_candidate_source_tenant_id();

drop trigger if exists set_estimate_generated_ouvrage_applications_scope on public.estimate_generated_ouvrage_applications;
create trigger set_estimate_generated_ouvrage_applications_scope
  before insert or update on public.estimate_generated_ouvrage_applications
  for each row execute procedure public.assign_estimate_generated_ouvrage_application_scope();

alter table if exists public.estimate_generated_ouvrage_drafts enable row level security;
alter table if exists public.estimate_generated_ouvrage_source_fragments enable row level security;
alter table if exists public.estimate_generated_ouvrage_candidates enable row level security;
alter table if exists public.estimate_generated_ouvrage_candidate_sources enable row level security;
alter table if exists public.estimate_generated_ouvrage_applications enable row level security;

alter table if exists public.estimate_generated_ouvrage_drafts force row level security;
alter table if exists public.estimate_generated_ouvrage_source_fragments force row level security;
alter table if exists public.estimate_generated_ouvrage_candidates force row level security;
alter table if exists public.estimate_generated_ouvrage_candidate_sources force row level security;
alter table if exists public.estimate_generated_ouvrage_applications force row level security;

drop policy if exists "Users can view generated ouvrage drafts" on public.estimate_generated_ouvrage_drafts;
drop policy if exists "Users can insert generated ouvrage drafts" on public.estimate_generated_ouvrage_drafts;
drop policy if exists "Users can update generated ouvrage drafts" on public.estimate_generated_ouvrage_drafts;
drop policy if exists "Users can delete generated ouvrage drafts" on public.estimate_generated_ouvrage_drafts;

create policy "Users can view generated ouvrage drafts"
  on public.estimate_generated_ouvrage_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_generated_ouvrage_drafts.target_version_id
        and v.tenant_id = estimate_generated_ouvrage_drafts.tenant_id
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

create policy "Users can insert generated ouvrage drafts"
  on public.estimate_generated_ouvrage_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_generated_ouvrage_drafts.target_version_id
        and v.tenant_id = estimate_generated_ouvrage_drafts.tenant_id
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

create policy "Users can update generated ouvrage drafts"
  on public.estimate_generated_ouvrage_drafts
  for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "Users can delete generated ouvrage drafts"
  on public.estimate_generated_ouvrage_drafts
  for delete
  to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists "Users can view generated ouvrage source fragments" on public.estimate_generated_ouvrage_source_fragments;
drop policy if exists "Users can insert generated ouvrage source fragments" on public.estimate_generated_ouvrage_source_fragments;
drop policy if exists "Users can update generated ouvrage source fragments" on public.estimate_generated_ouvrage_source_fragments;
drop policy if exists "Users can delete generated ouvrage source fragments" on public.estimate_generated_ouvrage_source_fragments;

create policy "Users can view generated ouvrage source fragments"
  on public.estimate_generated_ouvrage_source_fragments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_source_fragments.draft_id
        and d.tenant_id = estimate_generated_ouvrage_source_fragments.tenant_id
    )
  );

create policy "Users can insert generated ouvrage source fragments"
  on public.estimate_generated_ouvrage_source_fragments
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_source_fragments.draft_id
        and d.tenant_id = estimate_generated_ouvrage_source_fragments.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage source fragments"
  on public.estimate_generated_ouvrage_source_fragments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_source_fragments.draft_id
        and d.tenant_id = estimate_generated_ouvrage_source_fragments.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_source_fragments.draft_id
        and d.tenant_id = estimate_generated_ouvrage_source_fragments.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage source fragments"
  on public.estimate_generated_ouvrage_source_fragments
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_source_fragments.draft_id
        and d.tenant_id = estimate_generated_ouvrage_source_fragments.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage candidates" on public.estimate_generated_ouvrage_candidates;
drop policy if exists "Users can insert generated ouvrage candidates" on public.estimate_generated_ouvrage_candidates;
drop policy if exists "Users can update generated ouvrage candidates" on public.estimate_generated_ouvrage_candidates;
drop policy if exists "Users can delete generated ouvrage candidates" on public.estimate_generated_ouvrage_candidates;

create policy "Users can view generated ouvrage candidates"
  on public.estimate_generated_ouvrage_candidates
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidates.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidates.tenant_id
    )
  );

create policy "Users can insert generated ouvrage candidates"
  on public.estimate_generated_ouvrage_candidates
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidates.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidates.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage candidates"
  on public.estimate_generated_ouvrage_candidates
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidates.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidates.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidates.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidates.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage candidates"
  on public.estimate_generated_ouvrage_candidates
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidates.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidates.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage candidate sources" on public.estimate_generated_ouvrage_candidate_sources;
drop policy if exists "Users can insert generated ouvrage candidate sources" on public.estimate_generated_ouvrage_candidate_sources;
drop policy if exists "Users can update generated ouvrage candidate sources" on public.estimate_generated_ouvrage_candidate_sources;
drop policy if exists "Users can delete generated ouvrage candidate sources" on public.estimate_generated_ouvrage_candidate_sources;

create policy "Users can view generated ouvrage candidate sources"
  on public.estimate_generated_ouvrage_candidate_sources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidate_sources.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidate_sources.tenant_id
    )
  );

create policy "Users can insert generated ouvrage candidate sources"
  on public.estimate_generated_ouvrage_candidate_sources
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidate_sources.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidate_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage candidate sources"
  on public.estimate_generated_ouvrage_candidate_sources
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidate_sources.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidate_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidate_sources.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidate_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage candidate sources"
  on public.estimate_generated_ouvrage_candidate_sources
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_candidate_sources.draft_id
        and d.tenant_id = estimate_generated_ouvrage_candidate_sources.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view generated ouvrage applications" on public.estimate_generated_ouvrage_applications;
drop policy if exists "Users can insert generated ouvrage applications" on public.estimate_generated_ouvrage_applications;
drop policy if exists "Users can update generated ouvrage applications" on public.estimate_generated_ouvrage_applications;
drop policy if exists "Users can delete generated ouvrage applications" on public.estimate_generated_ouvrage_applications;

create policy "Users can view generated ouvrage applications"
  on public.estimate_generated_ouvrage_applications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_applications.draft_id
        and d.tenant_id = estimate_generated_ouvrage_applications.tenant_id
    )
  );

create policy "Users can insert generated ouvrage applications"
  on public.estimate_generated_ouvrage_applications
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_applications.draft_id
        and d.tenant_id = estimate_generated_ouvrage_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update generated ouvrage applications"
  on public.estimate_generated_ouvrage_applications
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_applications.draft_id
        and d.tenant_id = estimate_generated_ouvrage_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_applications.draft_id
        and d.tenant_id = estimate_generated_ouvrage_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete generated ouvrage applications"
  on public.estimate_generated_ouvrage_applications
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_generated_ouvrage_drafts d
      where d.id = estimate_generated_ouvrage_applications.draft_id
        and d.tenant_id = estimate_generated_ouvrage_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop trigger if exists estimate_generated_ouvrage_drafts_audit_trigger on public.estimate_generated_ouvrage_drafts;
create trigger estimate_generated_ouvrage_drafts_audit_trigger
  after insert or update or delete on public.estimate_generated_ouvrage_drafts
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_generated_ouvrage_source_fragments_audit_trigger on public.estimate_generated_ouvrage_source_fragments;
create trigger estimate_generated_ouvrage_source_fragments_audit_trigger
  after insert or update or delete on public.estimate_generated_ouvrage_source_fragments
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_generated_ouvrage_candidates_audit_trigger on public.estimate_generated_ouvrage_candidates;
create trigger estimate_generated_ouvrage_candidates_audit_trigger
  after insert or update or delete on public.estimate_generated_ouvrage_candidates
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_generated_ouvrage_candidate_sources_audit_trigger on public.estimate_generated_ouvrage_candidate_sources;
create trigger estimate_generated_ouvrage_candidate_sources_audit_trigger
  after insert or update or delete on public.estimate_generated_ouvrage_candidate_sources
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_generated_ouvrage_applications_audit_trigger on public.estimate_generated_ouvrage_applications;
create trigger estimate_generated_ouvrage_applications_audit_trigger
  after insert or update or delete on public.estimate_generated_ouvrage_applications
  for each row execute procedure public.log_estimate_audit();

alter table public.estimate_version_events
  drop constraint if exists estimate_version_events_event_type_check;

alter table public.estimate_version_events
  add constraint estimate_version_events_event_type_check
  check (
    event_type in (
      'sent',
      'accepted',
      'archived',
      'rejected',
      'seal_verified',
      'approval_rules_evaluated',
      'approval_status_changed',
      'approval_decided',
      'generated_ouvrage_draft_created',
      'generated_ouvrage_inserted',
      'generated_ouvrage_discarded'
    )
  );

create or replace function public.log_estimate_version_event(
  p_estimate_version_id uuid,
  p_event_type text,
  p_created_by uuid,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns public.estimate_version_events
language plpgsql
security definer
set search_path = public
as $$
declare
  target_tenant_id uuid;
  normalized_event_type text := lower(trim(coalesce(p_event_type, '')));
  inserted_row public.estimate_version_events;
begin
  if normalized_event_type = '' then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = 'event_type is required.';
  end if;

  if normalized_event_type not in (
    'sent',
    'accepted',
    'archived',
    'rejected',
    'seal_verified',
    'approval_rules_evaluated',
    'approval_status_changed',
    'approval_decided',
    'generated_ouvrage_draft_created',
    'generated_ouvrage_inserted',
    'generated_ouvrage_discarded'
  ) then
    raise exception
      using
        errcode = '22023',
        message = 'INVALID_ESTIMATE_VERSION_EVENT_TYPE',
        detail = format('Unsupported event_type: %s', normalized_event_type);
  end if;

  select ev.tenant_id
    into target_tenant_id
  from public.estimate_versions ev
  where ev.id = p_estimate_version_id;

  if target_tenant_id is null then
    raise exception
      using
        errcode = 'P0001',
        message = 'ESTIMATE_VERSION_NOT_FOUND',
        detail = format('estimate_version_id=%s', p_estimate_version_id);
  end if;

  if p_created_by is not null
    and not exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = target_tenant_id
        and tm.user_id = p_created_by
    )
    and not exists (
      select 1
      from public.profiles profile
      where profile.id = p_created_by
        and profile.role = 'admin'
    ) then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_EVENT_ACTOR_NOT_ALLOWED',
        detail = format('created_by=%s is not allowed for tenant_id=%s', p_created_by, target_tenant_id);
  end if;

  insert into public.estimate_version_events (
    tenant_id,
    estimate_version_id,
    event_type,
    metadata,
    created_by,
    occurred_at
  )
  values (
    target_tenant_id,
    p_estimate_version_id,
    normalized_event_type,
    coalesce(p_metadata, '{}'::jsonb),
    p_created_by,
    coalesce(p_occurred_at, now())
  )
  returning *
  into inserted_row;

  return inserted_row;
end;
$$;
