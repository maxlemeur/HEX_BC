-- EST-384: persistent version-zero draft review snapshots attached to existing estimate versions.

create table if not exists public.estimate_version_zero_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  brief_id uuid references public.affaire_briefs(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'ia_a_revoir'
    check (status in ('ia_a_revoir', 'ready_for_version', 'materialized', 'discarded', 'superseded')),
  summary jsonb not null default '{}'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  selected_lots jsonb not null default '[]'::jsonb,
  materialized_at timestamptz,
  discarded_at timestamptz,
  superseded_by_draft_id uuid references public.estimate_version_zero_drafts(id) on delete set null,
  constraint estimate_version_zero_drafts_summary_object_check
    check (jsonb_typeof(summary) = 'object'),
  constraint estimate_version_zero_drafts_generation_metadata_object_check
    check (jsonb_typeof(generation_metadata) = 'object'),
  constraint estimate_version_zero_drafts_selected_lots_array_check
    check (jsonb_typeof(selected_lots) = 'array'),
  constraint estimate_version_zero_drafts_materialized_state_check
    check (
      (status = 'materialized' and materialized_at is not null)
      or status <> 'materialized'
    )
);

create table if not exists public.estimate_version_zero_lots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_version_zero_drafts(id) on delete cascade,
  lot_key text not null,
  lot_order integer not null default 0 check (lot_order >= 0),
  lot_label text not null,
  status text not null default 'missing'
    check (status in ('generated', 'partial', 'missing')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  provenance jsonb not null default '{}'::jsonb,
  risk_signals jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  constraint estimate_version_zero_lots_lot_key_not_blank_check
    check (length(btrim(lot_key)) > 0),
  constraint estimate_version_zero_lots_lot_label_not_blank_check
    check (length(btrim(lot_label)) > 0),
  constraint estimate_version_zero_lots_provenance_object_check
    check (jsonb_typeof(provenance) = 'object'),
  constraint estimate_version_zero_lots_risk_signals_array_check
    check (jsonb_typeof(risk_signals) = 'array'),
  constraint estimate_version_zero_lots_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint estimate_version_zero_lots_draft_lot_key_key
    unique (draft_id, lot_key),
  constraint estimate_version_zero_lots_draft_lot_order_key
    unique (draft_id, lot_order)
);

create table if not exists public.estimate_version_zero_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_version_zero_drafts(id) on delete cascade,
  lot_id uuid not null references public.estimate_version_zero_lots(id) on delete cascade,
  line_order integer not null default 0 check (line_order >= 0),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'accepted', 'edited', 'rejected')),
  proposed_title text not null,
  proposed_description text,
  proposed_quantity numeric(12,3) check (proposed_quantity is null or proposed_quantity >= 0),
  proposed_unit text,
  edited_title text,
  edited_description text,
  edited_quantity numeric(12,3) check (edited_quantity is null or edited_quantity >= 0),
  edited_unit text,
  confidence numeric(5,4) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  provenance jsonb not null default '{}'::jsonb,
  facts jsonb not null default '[]'::jsonb,
  hypotheses jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  missing_signals jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  materialized_estimate_item_id uuid references public.estimate_items(id) on delete set null,
  constraint estimate_version_zero_lines_proposed_title_not_blank_check
    check (length(btrim(proposed_title)) > 0),
  constraint estimate_version_zero_lines_provenance_object_check
    check (jsonb_typeof(provenance) = 'object'),
  constraint estimate_version_zero_lines_facts_array_check
    check (jsonb_typeof(facts) = 'array'),
  constraint estimate_version_zero_lines_hypotheses_array_check
    check (jsonb_typeof(hypotheses) = 'array'),
  constraint estimate_version_zero_lines_inferences_array_check
    check (jsonb_typeof(inferences) = 'array'),
  constraint estimate_version_zero_lines_missing_signals_array_check
    check (jsonb_typeof(missing_signals) = 'array'),
  constraint estimate_version_zero_lines_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint estimate_version_zero_lines_lot_line_order_key
    unique (lot_id, line_order)
);

create table if not exists public.estimate_version_zero_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  draft_id uuid not null references public.estimate_version_zero_drafts(id) on delete cascade,
  lot_id uuid references public.estimate_version_zero_lots(id) on delete set null,
  line_id uuid not null references public.estimate_version_zero_lines(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  parent_section_item_id uuid references public.estimate_items(id) on delete set null,
  applied_by uuid references public.profiles(id) on delete set null,
  application_order integer not null default 0 check (application_order >= 0),
  applied_payload jsonb not null default '{}'::jsonb,
  constraint estimate_version_zero_applications_applied_payload_object_check
    check (jsonb_typeof(applied_payload) = 'object'),
  constraint estimate_version_zero_applications_line_id_key
    unique (line_id),
  constraint estimate_version_zero_applications_estimate_item_id_key
    unique (estimate_item_id)
);

create index if not exists estimate_version_zero_drafts_project_status_created_idx
  on public.estimate_version_zero_drafts (project_id, status, created_at desc);

create index if not exists estimate_version_zero_drafts_version_created_idx
  on public.estimate_version_zero_drafts (version_id, created_at desc);

create index if not exists estimate_version_zero_drafts_ia_a_revoir_idx
  on public.estimate_version_zero_drafts (project_id, version_id, created_at desc)
  where status = 'ia_a_revoir';

create index if not exists estimate_version_zero_lots_version_status_idx
  on public.estimate_version_zero_lots (version_id, status, lot_order);

create index if not exists estimate_version_zero_lots_project_status_idx
  on public.estimate_version_zero_lots (project_id, status, created_at desc);

create index if not exists estimate_version_zero_lines_version_review_status_idx
  on public.estimate_version_zero_lines (version_id, review_status, line_order);

create index if not exists estimate_version_zero_lines_project_review_status_idx
  on public.estimate_version_zero_lines (project_id, review_status, created_at desc);

create index if not exists estimate_version_zero_lines_lot_review_status_idx
  on public.estimate_version_zero_lines (lot_id, review_status, line_order);

create index if not exists estimate_version_zero_applications_version_item_idx
  on public.estimate_version_zero_applications (version_id, estimate_item_id);

create index if not exists estimate_version_zero_applications_draft_idx
  on public.estimate_version_zero_applications (draft_id, version_id, created_at desc);

create or replace function public.assign_estimate_version_zero_draft_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  resolved_tenant_id uuid;
  resolved_project_id uuid;
  resolved_brief_tenant_id uuid;
  resolved_brief_project_id uuid;
begin
  select ev.tenant_id, ev.project_id
    into resolved_tenant_id, resolved_project_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if new.brief_id is not null then
    select b.tenant_id, b.project_id
      into resolved_brief_tenant_id, resolved_brief_project_id
    from public.affaire_briefs b
    where b.id = new.brief_id;

    if resolved_brief_project_id is not null and resolved_project_id is not null
      and resolved_brief_project_id <> resolved_project_id then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_VERSION_ZERO_BRIEF_PROJECT_MISMATCH';
    end if;

    if resolved_brief_tenant_id is not null and resolved_tenant_id is not null
      and resolved_brief_tenant_id <> resolved_tenant_id then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_VERSION_ZERO_BRIEF_TENANT_MISMATCH';
    end if;
  end if;

  new.tenant_id := coalesce(resolved_tenant_id, new.tenant_id, public.current_tenant_id());
  new.project_id := coalesce(resolved_project_id, new.project_id);
  return new;
end;
$$;

create or replace function public.assign_estimate_version_zero_lot_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select d.tenant_id, d.project_id, d.version_id
    into new.tenant_id, new.project_id, new.version_id
  from public.estimate_version_zero_drafts d
  where d.id = new.draft_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_version_zero_line_scope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select l.tenant_id, l.project_id, l.version_id, l.draft_id
    into new.tenant_id, new.project_id, new.version_id, new.draft_id
  from public.estimate_version_zero_lots l
  where l.id = new.lot_id;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

create or replace function public.assign_estimate_version_zero_application_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  line_version_id uuid;
  estimate_item_version_id uuid;
  parent_section_version_id uuid;
begin
  select l.tenant_id, l.project_id, l.version_id, l.draft_id, l.lot_id
    into new.tenant_id, new.project_id, line_version_id, new.draft_id, new.lot_id
  from public.estimate_version_zero_lines l
  where l.id = new.line_id;

  new.version_id := line_version_id;

  if new.estimate_item_id is not null then
    select item.version_id
      into estimate_item_version_id
    from public.estimate_items item
    where item.id = new.estimate_item_id;

    if estimate_item_version_id is not null and line_version_id is not null
      and estimate_item_version_id <> line_version_id then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_VERSION_ZERO_APPLICATION_ITEM_VERSION_MISMATCH';
    end if;
  end if;

  if new.parent_section_item_id is not null then
    select item.version_id
      into parent_section_version_id
    from public.estimate_items item
    where item.id = new.parent_section_item_id;

    if parent_section_version_id is not null and line_version_id is not null
      and parent_section_version_id <> line_version_id then
      raise exception
        using
          errcode = '23514',
          message = 'ESTIMATE_VERSION_ZERO_APPLICATION_PARENT_VERSION_MISMATCH';
    end if;
  end if;

  if new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_version_zero_drafts_updated_at on public.estimate_version_zero_drafts;
create trigger set_estimate_version_zero_drafts_updated_at
  before update on public.estimate_version_zero_drafts
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_version_zero_lots_updated_at on public.estimate_version_zero_lots;
create trigger set_estimate_version_zero_lots_updated_at
  before update on public.estimate_version_zero_lots
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_version_zero_lines_updated_at on public.estimate_version_zero_lines;
create trigger set_estimate_version_zero_lines_updated_at
  before update on public.estimate_version_zero_lines
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_version_zero_applications_updated_at on public.estimate_version_zero_applications;
create trigger set_estimate_version_zero_applications_updated_at
  before update on public.estimate_version_zero_applications
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_estimate_version_zero_drafts_scope on public.estimate_version_zero_drafts;
create trigger set_estimate_version_zero_drafts_scope
  before insert or update on public.estimate_version_zero_drafts
  for each row execute procedure public.assign_estimate_version_zero_draft_scope();

drop trigger if exists set_estimate_version_zero_lots_scope on public.estimate_version_zero_lots;
create trigger set_estimate_version_zero_lots_scope
  before insert or update on public.estimate_version_zero_lots
  for each row execute procedure public.assign_estimate_version_zero_lot_scope();

drop trigger if exists set_estimate_version_zero_lines_scope on public.estimate_version_zero_lines;
create trigger set_estimate_version_zero_lines_scope
  before insert or update on public.estimate_version_zero_lines
  for each row execute procedure public.assign_estimate_version_zero_line_scope();

drop trigger if exists set_estimate_version_zero_applications_scope on public.estimate_version_zero_applications;
create trigger set_estimate_version_zero_applications_scope
  before insert or update on public.estimate_version_zero_applications
  for each row execute procedure public.assign_estimate_version_zero_application_scope();

alter table if exists public.estimate_version_zero_drafts enable row level security;
alter table if exists public.estimate_version_zero_lots enable row level security;
alter table if exists public.estimate_version_zero_lines enable row level security;
alter table if exists public.estimate_version_zero_applications enable row level security;

alter table if exists public.estimate_version_zero_drafts force row level security;
alter table if exists public.estimate_version_zero_lots force row level security;
alter table if exists public.estimate_version_zero_lines force row level security;
alter table if exists public.estimate_version_zero_applications force row level security;

drop policy if exists "Users can view version zero drafts" on public.estimate_version_zero_drafts;
drop policy if exists "Users can insert version zero drafts" on public.estimate_version_zero_drafts;
drop policy if exists "Users can update version zero drafts" on public.estimate_version_zero_drafts;
drop policy if exists "Users can delete version zero drafts" on public.estimate_version_zero_drafts;

create policy "Users can view version zero drafts"
  on public.estimate_version_zero_drafts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_version_zero_drafts.version_id
        and v.tenant_id = estimate_version_zero_drafts.tenant_id
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

create policy "Users can insert version zero drafts"
  on public.estimate_version_zero_drafts
  for insert
  to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = estimate_version_zero_drafts.version_id
        and v.tenant_id = estimate_version_zero_drafts.tenant_id
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

create policy "Users can update version zero drafts"
  on public.estimate_version_zero_drafts
  for update
  to authenticated
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "Users can delete version zero drafts"
  on public.estimate_version_zero_drafts
  for delete
  to authenticated
  using (created_by = (select auth.uid()));

drop policy if exists "Users can view version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can insert version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can update version zero lots" on public.estimate_version_zero_lots;
drop policy if exists "Users can delete version zero lots" on public.estimate_version_zero_lots;

create policy "Users can view version zero lots"
  on public.estimate_version_zero_lots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lots.draft_id
        and d.tenant_id = estimate_version_zero_lots.tenant_id
    )
  );

create policy "Users can insert version zero lots"
  on public.estimate_version_zero_lots
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lots.draft_id
        and d.tenant_id = estimate_version_zero_lots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update version zero lots"
  on public.estimate_version_zero_lots
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lots.draft_id
        and d.tenant_id = estimate_version_zero_lots.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lots.draft_id
        and d.tenant_id = estimate_version_zero_lots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete version zero lots"
  on public.estimate_version_zero_lots
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lots.draft_id
        and d.tenant_id = estimate_version_zero_lots.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can insert version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can update version zero lines" on public.estimate_version_zero_lines;
drop policy if exists "Users can delete version zero lines" on public.estimate_version_zero_lines;

create policy "Users can view version zero lines"
  on public.estimate_version_zero_lines
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lines.draft_id
        and d.tenant_id = estimate_version_zero_lines.tenant_id
    )
  );

create policy "Users can insert version zero lines"
  on public.estimate_version_zero_lines
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lines.draft_id
        and d.tenant_id = estimate_version_zero_lines.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update version zero lines"
  on public.estimate_version_zero_lines
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lines.draft_id
        and d.tenant_id = estimate_version_zero_lines.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lines.draft_id
        and d.tenant_id = estimate_version_zero_lines.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete version zero lines"
  on public.estimate_version_zero_lines
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_lines.draft_id
        and d.tenant_id = estimate_version_zero_lines.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop policy if exists "Users can view version zero applications" on public.estimate_version_zero_applications;
drop policy if exists "Users can insert version zero applications" on public.estimate_version_zero_applications;
drop policy if exists "Users can update version zero applications" on public.estimate_version_zero_applications;
drop policy if exists "Users can delete version zero applications" on public.estimate_version_zero_applications;

create policy "Users can view version zero applications"
  on public.estimate_version_zero_applications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_applications.draft_id
        and d.tenant_id = estimate_version_zero_applications.tenant_id
    )
  );

create policy "Users can insert version zero applications"
  on public.estimate_version_zero_applications
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_applications.draft_id
        and d.tenant_id = estimate_version_zero_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can update version zero applications"
  on public.estimate_version_zero_applications
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_applications.draft_id
        and d.tenant_id = estimate_version_zero_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_applications.draft_id
        and d.tenant_id = estimate_version_zero_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

create policy "Users can delete version zero applications"
  on public.estimate_version_zero_applications
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_version_zero_drafts d
      where d.id = estimate_version_zero_applications.draft_id
        and d.tenant_id = estimate_version_zero_applications.tenant_id
        and d.created_by = (select auth.uid())
    )
  );

drop trigger if exists estimate_version_zero_drafts_audit_trigger on public.estimate_version_zero_drafts;
create trigger estimate_version_zero_drafts_audit_trigger
  after insert or update or delete on public.estimate_version_zero_drafts
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_version_zero_lots_audit_trigger on public.estimate_version_zero_lots;
create trigger estimate_version_zero_lots_audit_trigger
  after insert or update or delete on public.estimate_version_zero_lots
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_version_zero_lines_audit_trigger on public.estimate_version_zero_lines;
create trigger estimate_version_zero_lines_audit_trigger
  after insert or update or delete on public.estimate_version_zero_lines
  for each row execute procedure public.log_estimate_audit();

drop trigger if exists estimate_version_zero_applications_audit_trigger on public.estimate_version_zero_applications;
create trigger estimate_version_zero_applications_audit_trigger
  after insert or update or delete on public.estimate_version_zero_applications
  for each row execute procedure public.log_estimate_audit();
