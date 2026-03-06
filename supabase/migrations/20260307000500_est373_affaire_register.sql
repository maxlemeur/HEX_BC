-- EST-373: persistent affaire register for assumptions and missing pieces, with audit trail and strict project-scoped RLS.

create table if not exists public.affaire_register_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid references public.estimate_versions(id) on delete cascade,
  source_document_id uuid references public.affaire_intake_documents(id) on delete set null,
  kind text not null,
  code text,
  text text not null,
  severity text not null default 'warning',
  status text not null default 'open',
  origin_kind text not null default 'manual',
  scope_type text not null default 'project',
  scope_id uuid,
  scope_ref text,
  scope_label text not null,
  source_file_name text,
  sync_key text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint affaire_register_entries_project_sync_key_key
    unique (project_id, sync_key),
  constraint affaire_register_entries_kind_check
    check (kind in ('assumption', 'missing_piece')),
  constraint affaire_register_entries_severity_check
    check (severity in ('info', 'warning', 'critical')),
  constraint affaire_register_entries_status_check
    check (status in ('open', 'validated', 'rejected', 'clarify_with_client')),
  constraint affaire_register_entries_origin_kind_check
    check (origin_kind in ('ai', 'manual', 'system')),
  constraint affaire_register_entries_scope_type_check
    check (scope_type in ('project', 'lot', 'line', 'exception')),
  constraint affaire_register_entries_text_not_blank_check
    check (length(btrim(text)) > 0),
  constraint affaire_register_entries_scope_label_not_blank_check
    check (length(btrim(scope_label)) > 0),
  constraint affaire_register_entries_code_not_blank_check
    check (code is null or length(btrim(code)) > 0),
  constraint affaire_register_entries_scope_ref_not_blank_check
    check (scope_ref is null or length(btrim(scope_ref)) > 0),
  constraint affaire_register_entries_source_file_name_not_blank_check
    check (source_file_name is null or length(btrim(source_file_name)) > 0),
  constraint affaire_register_entries_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint affaire_register_entries_scope_consistency_check
    check (
      (
        scope_type = 'project'
        and version_id is null
        and scope_id is null
        and scope_ref is null
      )
      or (
        scope_type in ('lot', 'line')
        and version_id is not null
        and scope_id is not null
        and scope_ref is null
      )
      or (
        scope_type = 'exception'
        and version_id is not null
        and scope_id is null
        and length(btrim(coalesce(scope_ref, ''))) > 0
      )
    )
);

create table if not exists public.affaire_register_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid references public.estimate_versions(id) on delete cascade,
  entry_id uuid not null references public.affaire_register_entries(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  reason text,
  before_payload jsonb,
  after_payload jsonb,
  constraint affaire_register_events_event_type_check
    check (
      event_type in (
        'created',
        'synced',
        'status_changed',
        'deactivated',
        'reactivated'
      )
    ),
  constraint affaire_register_events_reason_not_blank_check
    check (reason is null or length(btrim(reason)) > 0),
  constraint affaire_register_events_before_payload_object_check
    check (before_payload is null or jsonb_typeof(before_payload) = 'object'),
  constraint affaire_register_events_after_payload_object_check
    check (after_payload is null or jsonb_typeof(after_payload) = 'object')
);

create index if not exists affaire_register_entries_tenant_project_updated_at_idx
  on public.affaire_register_entries (tenant_id, project_id, updated_at desc, id desc);

create index if not exists affaire_register_entries_project_version_updated_at_idx
  on public.affaire_register_entries (project_id, version_id, updated_at desc, id desc);

create index if not exists affaire_register_entries_project_source_document_idx
  on public.affaire_register_entries (project_id, source_document_id)
  where source_document_id is not null;

create index if not exists affaire_register_entries_project_scope_status_severity_idx
  on public.affaire_register_entries (project_id, scope_type, status, severity, updated_at desc)
  where is_active;

create index if not exists affaire_register_entries_active_critical_open_idx
  on public.affaire_register_entries (project_id, updated_at desc, id desc)
  where is_active and status = 'open' and severity = 'critical';

create index if not exists affaire_register_events_project_created_at_idx
  on public.affaire_register_events (project_id, created_at desc);

create index if not exists affaire_register_events_entry_created_at_idx
  on public.affaire_register_events (entry_id, created_at desc);

create or replace function public.assign_affaire_register_entry_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_tenant_id uuid;
  version_row record;
  source_document_row record;
  scope_item_row record;
begin
  select p.tenant_id
    into project_tenant_id
  from public.estimate_projects p
  where p.id = new.project_id;

  if project_tenant_id is null then
    raise exception using message = 'AFFAIRE_REGISTER_PROJECT_NOT_FOUND';
  end if;

  new.tenant_id := project_tenant_id;

  if new.version_id is not null then
    select v.project_id
      into version_row
    from public.estimate_versions v
    where v.id = new.version_id;

    if version_row is null then
      raise exception using message = 'AFFAIRE_REGISTER_VERSION_NOT_FOUND';
    end if;

    if version_row.project_id <> new.project_id then
      raise exception using message = 'AFFAIRE_REGISTER_VERSION_PROJECT_MISMATCH';
    end if;
  end if;

  if new.source_document_id is not null then
    select d.project_id
      into source_document_row
    from public.affaire_intake_documents d
    where d.id = new.source_document_id;

    if source_document_row is null then
      raise exception using message = 'AFFAIRE_REGISTER_SOURCE_DOCUMENT_NOT_FOUND';
    end if;

    if source_document_row.project_id <> new.project_id then
      raise exception using message = 'AFFAIRE_REGISTER_SOURCE_DOCUMENT_PROJECT_MISMATCH';
    end if;
  end if;

  if new.scope_type = 'project' then
    new.version_id := null;
    new.scope_id := null;
    new.scope_ref := null;
    return new;
  end if;

  if new.scope_type in ('lot', 'line') then
    if new.version_id is null or new.scope_id is null then
      raise exception using message = 'AFFAIRE_REGISTER_SCOPE_INCOMPLETE';
    end if;

    select ei.version_id, ei.item_type
      into scope_item_row
    from public.estimate_items ei
    where ei.id = new.scope_id;

    if scope_item_row is null then
      raise exception using message = 'AFFAIRE_REGISTER_SCOPE_ITEM_NOT_FOUND';
    end if;

    if scope_item_row.version_id <> new.version_id then
      raise exception using message = 'AFFAIRE_REGISTER_SCOPE_VERSION_MISMATCH';
    end if;

    if new.scope_type = 'lot' and scope_item_row.item_type <> 'section' then
      raise exception using message = 'AFFAIRE_REGISTER_SCOPE_EXPECTED_LOT';
    end if;

    if new.scope_type = 'line' and scope_item_row.item_type <> 'line' then
      raise exception using message = 'AFFAIRE_REGISTER_SCOPE_EXPECTED_LINE';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.assign_affaire_register_event_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  entry_row record;
begin
  select e.tenant_id, e.project_id, e.version_id
    into entry_row
  from public.affaire_register_entries e
  where e.id = new.entry_id;

  if entry_row is null then
    raise exception using message = 'AFFAIRE_REGISTER_ENTRY_NOT_FOUND';
  end if;

  new.tenant_id := entry_row.tenant_id;
  new.project_id := entry_row.project_id;
  new.version_id := entry_row.version_id;
  return new;
end;
$$;

create or replace function public.prevent_affaire_register_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception using message = 'AFFAIRE_REGISTER_EVENTS_IMMUTABLE';
end;
$$;

drop trigger if exists set_affaire_register_entries_updated_at on public.affaire_register_entries;
create trigger set_affaire_register_entries_updated_at
  before update on public.affaire_register_entries
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_affaire_register_entry_scope on public.affaire_register_entries;
create trigger set_affaire_register_entry_scope
  before insert or update on public.affaire_register_entries
  for each row execute procedure public.assign_affaire_register_entry_scope();

drop trigger if exists set_affaire_register_event_scope on public.affaire_register_events;
create trigger set_affaire_register_event_scope
  before insert on public.affaire_register_events
  for each row execute procedure public.assign_affaire_register_event_scope();

drop trigger if exists guard_affaire_register_events_immutable on public.affaire_register_events;
create trigger guard_affaire_register_events_immutable
  before update or delete on public.affaire_register_events
  for each row execute procedure public.prevent_affaire_register_event_mutation();

alter table if exists public.affaire_register_entries enable row level security;
alter table if exists public.affaire_register_events enable row level security;

alter table if exists public.affaire_register_entries force row level security;
alter table if exists public.affaire_register_events force row level security;

drop policy if exists "Current tenant can select affaire register entries" on public.affaire_register_entries;
drop policy if exists "Current tenant can insert affaire register entries" on public.affaire_register_entries;
drop policy if exists "Current tenant can update affaire register entries" on public.affaire_register_entries;
drop policy if exists "Current tenant can delete affaire register entries" on public.affaire_register_entries;

create policy "Current tenant can select affaire register entries"
  on public.affaire_register_entries
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire register entries"
  on public.affaire_register_entries
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (created_by is null or created_by = (select auth.uid()))
    and (updated_by is null or updated_by = (select auth.uid()))
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire register entries"
  on public.affaire_register_entries
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (updated_by is null or updated_by = (select auth.uid()))
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire register entries"
  on public.affaire_register_entries
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire register events" on public.affaire_register_events;
drop policy if exists "Current tenant can insert affaire register events" on public.affaire_register_events;

create policy "Current tenant can select affaire register events"
  on public.affaire_register_events
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire register events"
  on public.affaire_register_events
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (actor_user_id is null or actor_user_id = (select auth.uid()))
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );
