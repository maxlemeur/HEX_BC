-- EST-371: project-scoped multi-document intake workspace with strict RLS and audit trail.

create table if not exists public.affaire_intake_uploads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  last_error text,
  completed_at timestamptz,
  constraint affaire_intake_uploads_status_check
    check (status in ('queued', 'processing', 'ready', 'partial_failure', 'failed')),
  constraint affaire_intake_uploads_attempt_count_check
    check (attempt_count >= 0)
);

create table if not exists public.affaire_intake_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  upload_id uuid not null references public.affaire_intake_uploads(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  storage_path text,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  upload_status text not null default 'pending',
  rejection_reason text,
  classification_status text not null default 'queued',
  document_kind text not null default 'a_classer',
  confidence numeric(5,4),
  issues text[] not null default '{}'::text[],
  extracted_metadata jsonb not null default '{}'::jsonb,
  classification_source text,
  classified_by uuid references public.profiles(id) on delete set null,
  classified_at timestamptz,
  manually_overridden_at timestamptz,
  constraint affaire_intake_documents_size_bytes_check
    check (size_bytes >= 0),
  constraint affaire_intake_documents_upload_status_check
    check (upload_status in ('pending', 'uploaded', 'rejected')),
  constraint affaire_intake_documents_classification_status_check
    check (classification_status in ('queued', 'processing', 'classified', 'ambiguous', 'failed')),
  constraint affaire_intake_documents_document_kind_check
    check (document_kind in ('dpgf', 'plans', 'cctp', 'bpu_dqe', 'annexes', 'emails', 'a_classer')),
  constraint affaire_intake_documents_confidence_check
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint affaire_intake_documents_classification_source_check
    check (classification_source is null or classification_source in ('ai', 'manual')),
  constraint affaire_intake_documents_file_name_not_blank_check
    check (length(btrim(file_name)) > 0),
  constraint affaire_intake_documents_storage_path_not_blank_check
    check (storage_path is null or length(btrim(storage_path)) > 0),
  constraint affaire_intake_documents_metadata_object_check
    check (jsonb_typeof(extracted_metadata) = 'object')
);

create table if not exists public.affaire_intake_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  upload_id uuid references public.affaire_intake_uploads(id) on delete cascade,
  document_id uuid references public.affaire_intake_documents(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  reason text,
  before_payload jsonb,
  after_payload jsonb,
  constraint affaire_intake_events_event_type_check
    check (
      event_type in (
        'upload.created',
        'document.uploaded',
        'document.rejected',
        'document.classified',
        'document.classification_failed',
        'document.reclassified',
        'upload.completed'
      )
    )
);

create index if not exists affaire_intake_uploads_tenant_project_created_at_idx
  on public.affaire_intake_uploads (tenant_id, project_id, created_at desc);

create index if not exists affaire_intake_uploads_project_created_at_idx
  on public.affaire_intake_uploads (project_id, created_at desc);

create index if not exists affaire_intake_documents_tenant_project_created_at_idx
  on public.affaire_intake_documents (tenant_id, project_id, created_at desc);

create index if not exists affaire_intake_documents_project_status_created_at_idx
  on public.affaire_intake_documents (project_id, classification_status, created_at desc);

create index if not exists affaire_intake_documents_project_document_kind_idx
  on public.affaire_intake_documents (project_id, document_kind);

create index if not exists affaire_intake_documents_upload_id_created_at_idx
  on public.affaire_intake_documents (upload_id, created_at asc);

create index if not exists affaire_intake_documents_review_queue_idx
  on public.affaire_intake_documents (project_id, created_at desc)
  where classification_status in ('ambiguous', 'failed') or document_kind = 'a_classer';

create index if not exists affaire_intake_events_project_created_at_idx
  on public.affaire_intake_events (project_id, created_at desc);

create index if not exists affaire_intake_events_upload_created_at_idx
  on public.affaire_intake_events (upload_id, created_at desc)
  where upload_id is not null;

create index if not exists affaire_intake_events_document_created_at_idx
  on public.affaire_intake_events (document_id, created_at desc)
  where document_id is not null;

create or replace function public.can_access_affaire_intake_project(
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
        or (select public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]))
      )
  );
$$;

grant execute on function public.can_access_affaire_intake_project(uuid, uuid) to authenticated;

create or replace function public.assign_affaire_intake_upload_scope()
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
    raise exception using message = 'AFFAIRE_INTAKE_PROJECT_NOT_FOUND';
  end if;

  new.tenant_id := project_tenant_id;
  return new;
end;
$$;

create or replace function public.assign_affaire_intake_document_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  upload_row record;
begin
  select u.tenant_id, u.project_id
    into upload_row
  from public.affaire_intake_uploads u
  where u.id = new.upload_id;

  if upload_row is null then
    raise exception using message = 'AFFAIRE_INTAKE_UPLOAD_NOT_FOUND';
  end if;

  new.tenant_id := upload_row.tenant_id;
  new.project_id := upload_row.project_id;
  return new;
end;
$$;

create or replace function public.assign_affaire_intake_event_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  document_row record;
  upload_row record;
begin
  if new.document_id is not null then
    select d.tenant_id, d.project_id, d.upload_id
      into document_row
    from public.affaire_intake_documents d
    where d.id = new.document_id;

    if document_row is null then
      raise exception using message = 'AFFAIRE_INTAKE_DOCUMENT_NOT_FOUND';
    end if;

    new.tenant_id := document_row.tenant_id;
    new.project_id := document_row.project_id;
    new.upload_id := coalesce(new.upload_id, document_row.upload_id);
    return new;
  end if;

  if new.upload_id is not null then
    select u.tenant_id, u.project_id
      into upload_row
    from public.affaire_intake_uploads u
    where u.id = new.upload_id;

    if upload_row is null then
      raise exception using message = 'AFFAIRE_INTAKE_UPLOAD_NOT_FOUND';
    end if;

    new.tenant_id := upload_row.tenant_id;
    new.project_id := upload_row.project_id;
    return new;
  end if;

  raise exception using message = 'AFFAIRE_INTAKE_EVENT_SCOPE_REQUIRED';
end;
$$;

drop trigger if exists set_affaire_intake_uploads_updated_at on public.affaire_intake_uploads;
create trigger set_affaire_intake_uploads_updated_at
  before update on public.affaire_intake_uploads
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_affaire_intake_documents_updated_at on public.affaire_intake_documents;
create trigger set_affaire_intake_documents_updated_at
  before update on public.affaire_intake_documents
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_affaire_intake_upload_scope on public.affaire_intake_uploads;
create trigger set_affaire_intake_upload_scope
  before insert or update on public.affaire_intake_uploads
  for each row execute procedure public.assign_affaire_intake_upload_scope();

drop trigger if exists set_affaire_intake_document_scope on public.affaire_intake_documents;
create trigger set_affaire_intake_document_scope
  before insert or update on public.affaire_intake_documents
  for each row execute procedure public.assign_affaire_intake_document_scope();

drop trigger if exists set_affaire_intake_event_scope on public.affaire_intake_events;
create trigger set_affaire_intake_event_scope
  before insert or update on public.affaire_intake_events
  for each row execute procedure public.assign_affaire_intake_event_scope();

alter table if exists public.affaire_intake_uploads enable row level security;
alter table if exists public.affaire_intake_documents enable row level security;
alter table if exists public.affaire_intake_events enable row level security;

alter table if exists public.affaire_intake_uploads force row level security;
alter table if exists public.affaire_intake_documents force row level security;
alter table if exists public.affaire_intake_events force row level security;

drop policy if exists "Current tenant can select affaire intake uploads" on public.affaire_intake_uploads;
drop policy if exists "Current tenant can insert affaire intake uploads" on public.affaire_intake_uploads;
drop policy if exists "Current tenant can update affaire intake uploads" on public.affaire_intake_uploads;
drop policy if exists "Current tenant can delete affaire intake uploads" on public.affaire_intake_uploads;

create policy "Current tenant can select affaire intake uploads"
  on public.affaire_intake_uploads
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire intake uploads"
  on public.affaire_intake_uploads
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire intake uploads"
  on public.affaire_intake_uploads
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire intake uploads"
  on public.affaire_intake_uploads
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire intake documents" on public.affaire_intake_documents;
drop policy if exists "Current tenant can insert affaire intake documents" on public.affaire_intake_documents;
drop policy if exists "Current tenant can update affaire intake documents" on public.affaire_intake_documents;
drop policy if exists "Current tenant can delete affaire intake documents" on public.affaire_intake_documents;

create policy "Current tenant can select affaire intake documents"
  on public.affaire_intake_documents
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire intake documents"
  on public.affaire_intake_documents
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and created_by = (select auth.uid())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire intake documents"
  on public.affaire_intake_documents
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire intake documents"
  on public.affaire_intake_documents
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

drop policy if exists "Current tenant can select affaire intake events" on public.affaire_intake_events;
drop policy if exists "Current tenant can insert affaire intake events" on public.affaire_intake_events;
drop policy if exists "Current tenant can update affaire intake events" on public.affaire_intake_events;
drop policy if exists "Current tenant can delete affaire intake events" on public.affaire_intake_events;

create policy "Current tenant can select affaire intake events"
  on public.affaire_intake_events
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can insert affaire intake events"
  on public.affaire_intake_events
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (actor_user_id is null or actor_user_id = (select auth.uid()))
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can update affaire intake events"
  on public.affaire_intake_events
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

create policy "Current tenant can delete affaire intake events"
  on public.affaire_intake_events
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_affaire_intake_project(project_id, tenant_id))
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'affaire-intake',
  'affaire-intake',
  false,
  52428800,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/csv',
    'message/rfc822',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

drop policy if exists "Tenant members can view affaire intake storage" on storage.objects;
drop policy if exists "Tenant members can insert affaire intake storage" on storage.objects;
drop policy if exists "Tenant members can update affaire intake storage" on storage.objects;
drop policy if exists "Tenant members can delete affaire intake storage" on storage.objects;

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
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
    )
  );

create policy "Tenant members can insert affaire intake storage"
  on storage.objects
  for insert
  to authenticated
  with check (
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
        and d.created_by = (select auth.uid())
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
    )
  );

create policy "Tenant members can update affaire intake storage"
  on storage.objects
  for update
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
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
    )
  )
  with check (
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
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
    )
  );

create policy "Tenant members can delete affaire intake storage"
  on storage.objects
  for delete
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
        and (select public.can_access_affaire_intake_project(d.project_id, d.tenant_id))
    )
  );
