-- EST-372: generated affaire brief with source links, confirmation workflow, and strict project-scoped RLS.

create table if not exists public.affaire_briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  upload_id uuid references public.affaire_intake_uploads(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  status text not null default 'a_confirmer',
  summary text not null,
  project_object text not null,
  scope jsonb not null default '[]'::jsonb,
  lots jsonb not null default '[]'::jsonb,
  received_pieces jsonb not null default '[]'::jsonb,
  assumptions jsonb not null default '[]'::jsonb,
  vigilance_points jsonb not null default '[]'::jsonb,
  missing_elements jsonb not null default '[]'::jsonb,
  generation_metadata jsonb not null default '{}'::jsonb,
  last_generated_at timestamptz,
  confirmed_at timestamptz,
  constraint affaire_briefs_project_id_key unique (project_id),
  constraint affaire_briefs_status_check
    check (status in ('a_confirmer', 'confirme')),
  constraint affaire_briefs_summary_not_blank_check
    check (length(btrim(summary)) > 0),
  constraint affaire_briefs_project_object_not_blank_check
    check (length(btrim(project_object)) > 0),
  constraint affaire_briefs_scope_array_check
    check (jsonb_typeof(scope) = 'array'),
  constraint affaire_briefs_lots_array_check
    check (jsonb_typeof(lots) = 'array'),
  constraint affaire_briefs_received_pieces_array_check
    check (jsonb_typeof(received_pieces) = 'array'),
  constraint affaire_briefs_assumptions_array_check
    check (jsonb_typeof(assumptions) = 'array'),
  constraint affaire_briefs_vigilance_points_array_check
    check (jsonb_typeof(vigilance_points) = 'array'),
  constraint affaire_briefs_missing_elements_array_check
    check (jsonb_typeof(missing_elements) = 'array'),
  constraint affaire_briefs_generation_metadata_object_check
    check (jsonb_typeof(generation_metadata) = 'object')
);

create table if not exists public.affaire_brief_source_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  brief_id uuid not null references public.affaire_briefs(id) on delete cascade,
  source_document_id uuid not null references public.affaire_intake_documents(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  block_key text not null,
  entry_index integer not null default 0,
  source_file_name text not null,
  rationale text,
  constraint affaire_brief_source_links_block_key_check
    check (
      block_key in (
        'summary',
        'project_object',
        'scope',
        'lots',
        'received_pieces',
        'assumptions',
        'vigilance_points',
        'missing_elements'
      )
    ),
  constraint affaire_brief_source_links_entry_index_check
    check (entry_index >= 0),
  constraint affaire_brief_source_links_source_file_name_not_blank_check
    check (length(btrim(source_file_name)) > 0),
  constraint affaire_brief_source_links_unique_entry_source
    unique (brief_id, block_key, entry_index, source_document_id)
);

create index if not exists affaire_briefs_tenant_project_updated_at_idx
  on public.affaire_briefs (tenant_id, project_id, updated_at desc);

create index if not exists affaire_briefs_project_status_updated_at_idx
  on public.affaire_briefs (project_id, status, updated_at desc);

create index if not exists affaire_briefs_a_confirmer_idx
  on public.affaire_briefs (project_id, updated_at desc)
  where status = 'a_confirmer';

create index if not exists affaire_brief_source_links_project_block_idx
  on public.affaire_brief_source_links (project_id, block_key, entry_index, created_at asc);

create index if not exists affaire_brief_source_links_source_document_idx
  on public.affaire_brief_source_links (source_document_id, block_key, entry_index);

create or replace function public.can_read_affaire_intake_project(
  p_project_id uuid,
  p_tenant_id uuid default public.current_tenant_id()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.estimate_projects p
    where p.id = p_project_id
      and p.tenant_id = p_tenant_id
      and (
        p.user_id = (select auth.uid())
        or (select public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role, 'director'::public.tenant_role]))
      )
  );
$$;

grant execute on function public.can_read_affaire_intake_project(uuid, uuid) to authenticated;

create or replace function public.assign_affaire_brief_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  project_tenant_id uuid;
begin
  select p.tenant_id
    into project_tenant_id
  from public.estimate_projects p
  where p.id = new.project_id;

  if project_tenant_id is null then
    raise exception using message = 'AFFAIRE_BRIEF_PROJECT_NOT_FOUND';
  end if;

  new.tenant_id := project_tenant_id;
  return new;
end;
$$;

create or replace function public.assign_affaire_brief_source_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  brief_row record;
begin
  select b.tenant_id, b.project_id
    into brief_row
  from public.affaire_briefs b
  where b.id = new.brief_id;

  if brief_row is null then
    raise exception using message = 'AFFAIRE_BRIEF_NOT_FOUND';
  end if;

  new.tenant_id := brief_row.tenant_id;
  new.project_id := brief_row.project_id;
  return new;
end;
$$;

drop trigger if exists set_affaire_briefs_updated_at on public.affaire_briefs;
create trigger set_affaire_briefs_updated_at
  before update on public.affaire_briefs
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_affaire_brief_scope on public.affaire_briefs;
create trigger set_affaire_brief_scope
  before insert or update on public.affaire_briefs
  for each row execute procedure public.assign_affaire_brief_scope();

drop trigger if exists set_affaire_brief_source_scope on public.affaire_brief_source_links;
create trigger set_affaire_brief_source_scope
  before insert or update on public.affaire_brief_source_links
  for each row execute procedure public.assign_affaire_brief_source_scope();

alter table if exists public.affaire_briefs enable row level security;
alter table if exists public.affaire_brief_source_links enable row level security;

alter table if exists public.affaire_briefs force row level security;
alter table if exists public.affaire_brief_source_links force row level security;

drop policy if exists "Current tenant can select affaire briefs" on public.affaire_briefs;
drop policy if exists "Current tenant can insert affaire briefs" on public.affaire_briefs;
drop policy if exists "Current tenant can update affaire briefs" on public.affaire_briefs;
drop policy if exists "Current tenant can delete affaire briefs" on public.affaire_briefs;

create policy "Current tenant can select affaire briefs"
  on public.affaire_briefs
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire briefs"
  on public.affaire_briefs
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (created_by is null or created_by = (select auth.uid()))
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire briefs"
  on public.affaire_briefs
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (updated_by is null or updated_by = (select auth.uid()))
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire briefs"
  on public.affaire_briefs
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire brief source links" on public.affaire_brief_source_links;
drop policy if exists "Current tenant can insert affaire brief source links" on public.affaire_brief_source_links;
drop policy if exists "Current tenant can update affaire brief source links" on public.affaire_brief_source_links;
drop policy if exists "Current tenant can delete affaire brief source links" on public.affaire_brief_source_links;

create policy "Current tenant can select affaire brief source links"
  on public.affaire_brief_source_links
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire brief source links"
  on public.affaire_brief_source_links
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (created_by is null or created_by = (select auth.uid()))
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire brief source links"
  on public.affaire_brief_source_links
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire brief source links"
  on public.affaire_brief_source_links
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

alter table public.affaire_intake_events
  drop constraint if exists affaire_intake_events_event_type_check;

alter table public.affaire_intake_events
  add constraint affaire_intake_events_event_type_check
  check (
    event_type in (
      'upload.created',
      'document.uploaded',
      'document.rejected',
      'document.classified',
      'document.classification_failed',
      'document.reclassified',
      'upload.completed',
      'brief.generated',
      'brief.updated',
      'brief.confirmed'
    )
  );

drop policy if exists "Current tenant can select affaire intake uploads" on public.affaire_intake_uploads;
create policy "Current tenant can select affaire intake uploads"
  on public.affaire_intake_uploads
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire intake documents" on public.affaire_intake_documents;
create policy "Current tenant can select affaire intake documents"
  on public.affaire_intake_documents
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire intake events" on public.affaire_intake_events;
create policy "Current tenant can select affaire intake events"
  on public.affaire_intake_events
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_read_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Tenant members can view affaire intake storage" on storage.objects;
create policy "Tenant members can view affaire intake storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'affaire-intake'
    and coalesce(array_length(storage.foldername(objects.name), 1), 0) = 4
    and coalesce((storage.foldername(objects.name))[1], '') = (select public.current_tenant_id()::text)
    and exists (
      select 1
      from public.affaire_intake_documents d
      join public.affaire_intake_uploads u on u.id = d.upload_id
      where d.tenant_id::text = coalesce((storage.foldername(objects.name))[1], '')
        and d.project_id::text = coalesce((storage.foldername(objects.name))[2], '')
        and u.id::text = coalesce((storage.foldername(objects.name))[3], '')
        and d.id::text = coalesce((storage.foldername(objects.name))[4], '')
        and d.storage_path = objects.name
        and d.upload_status = 'uploaded'
        and (select public.can_read_affaire_intake_project(d.project_id, d.tenant_id))
    )
  );
