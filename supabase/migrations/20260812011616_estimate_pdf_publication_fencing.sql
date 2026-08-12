-- Fence estimate PDF publication across manual generation, status workflows,
-- and the transactional email outbox. Storage objects are immutable and
-- content-addressed; only the token owner may publish their metadata.

alter table public.estimate_documents
  add column if not exists generation_token uuid,
  add column if not exists generation_purpose text,
  add column if not exists generation_dispatch_id uuid,
  add column if not exists generation_content_revision bigint,
  add column if not exists generation_started_at timestamptz,
  add column if not exists published_generation_token uuid,
  add column if not exists published_purpose text,
  add column if not exists published_dispatch_id uuid,
  add column if not exists published_content_revision bigint;

alter table public.estimate_documents
  drop constraint if exists estimate_documents_generation_purpose_check;
alter table public.estimate_documents
  add constraint estimate_documents_generation_purpose_check
  check (
    generation_purpose is null
    or generation_purpose in ('manual', 'email', 'workflow')
  );

alter table public.estimate_documents
  drop constraint if exists estimate_documents_generation_shape_check;
alter table public.estimate_documents
  add constraint estimate_documents_generation_shape_check
  check (
    (
      generation_token is null
      and generation_purpose is null
      and generation_dispatch_id is null
      and generation_content_revision is null
      and generation_started_at is null
    )
    or (
      generation_token is not null
      and generation_purpose is not null
      and generation_content_revision is not null
      and generation_content_revision > 0
      and generation_started_at is not null
      and (
        generation_purpose <> 'email'
        or generation_dispatch_id is not null
      )
    )
  );

alter table public.estimate_documents
  drop constraint if exists estimate_documents_published_purpose_check;
alter table public.estimate_documents
  add constraint estimate_documents_published_purpose_check
  check (
    published_purpose is null
    or published_purpose in ('legacy', 'manual', 'email', 'workflow')
  );

-- The previous canonical-path trigger rewrites any touched historical
-- commercial filename to `<version>.pdf`, although the Storage object was
-- uploaded under that commercial filename. Disable it transactionally before
-- identifying those already-published rows.
drop trigger if exists enforce_estimate_document_canonical_path
  on public.estimate_documents;

update public.estimate_documents document
set
  published_purpose = coalesce(document.published_purpose, 'legacy'),
  published_content_revision = coalesce(
    document.published_content_revision,
    version.content_revision
  )
from public.estimate_versions version
join public.estimate_projects project
  on project.id = version.project_id
 and project.tenant_id = version.tenant_id
where version.id = document.version_id
  and version.tenant_id = document.tenant_id
  and document.status = 'ready'
  and left(
    document.file_path,
    length(concat(version.tenant_id::text, '/', project.id::text, '/'))
  ) = concat(version.tenant_id::text, '/', project.id::text, '/')
  and length(substring(
    document.file_path
    from length(concat(version.tenant_id::text, '/', project.id::text, '/')) + 1
  )) > 4
  and position('/' in substring(
    document.file_path
    from length(concat(version.tenant_id::text, '/', project.id::text, '/')) + 1
  )) = 0
  and right(document.file_path, 4) = '.pdf'
  and document.sha256_hash ~ '^[0-9a-fA-F]{64}$';

create index if not exists estimate_documents_generation_token_idx
  on public.estimate_documents (generation_token)
  where generation_token is not null;

create or replace function public.enforce_estimate_document_canonical_path()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
  parent_project_id uuid;
  expected_path text;
  legacy_prefix text;
  legacy_filename text;
begin
  if tg_op = 'UPDATE'
    and (
      new.version_id is distinct from old.version_id
      or new.tenant_id is distinct from old.tenant_id
    )
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_DOCUMENT_PARENT_IMMUTABLE';
  end if;

  select version.tenant_id, version.project_id
    into parent_tenant_id, parent_project_id
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = new.version_id;

  if parent_tenant_id is null or parent_project_id is null then
    raise exception using
      errcode = '23503',
      message = 'ESTIMATE_DOCUMENT_PARENT_NOT_FOUND';
  end if;

  new.tenant_id := parent_tenant_id;

  if new.status = 'ready' then
    if new.sha256_hash is null
      or new.sha256_hash !~ '^[0-9a-f]{64}$'
    then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_PDF_HASH_INVALID';
    end if;

    expected_path := concat(
      parent_tenant_id::text,
      '/',
      parent_project_id::text,
      '/',
      new.version_id::text,
      '/',
      lower(new.sha256_hash),
      '.pdf'
    );

    legacy_prefix := concat(
      parent_tenant_id::text,
      '/',
      parent_project_id::text,
      '/'
    );
    legacy_filename := substring(
      new.file_path
      from length(legacy_prefix) + 1
    );

    -- Historical rows may point to either `<version>.pdf` or the former
    -- commercial filename. They remain readable only while their path/hash are
    -- unchanged and the migration marked them as legacy. New publications must
    -- always use the content-addressed path above.
    if new.file_path is distinct from expected_path
      and not (
        tg_op = 'UPDATE'
        and new.file_path is not distinct from old.file_path
        and new.sha256_hash is not distinct from old.sha256_hash
        and old.published_purpose = 'legacy'
        and new.published_purpose = 'legacy'
        and left(new.file_path, length(legacy_prefix)) = legacy_prefix
        and length(legacy_filename) > 4
        and position('/' in legacy_filename) = 0
        and right(legacy_filename, 4) = '.pdf'
      )
    then
      raise exception using
        errcode = '23514',
        message = 'ESTIMATE_PDF_PATH_INVALID';
    end if;
  elsif tg_op = 'UPDATE'
    and new.file_path is distinct from old.file_path
  then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_PDF_PATH_INVALID';
  elsif tg_op = 'INSERT' and new.file_path is not null then
    raise exception using
      errcode = '23514',
      message = 'ESTIMATE_PDF_PATH_INVALID';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_estimate_document_canonical_path()
  from public, anon, authenticated;

drop trigger if exists enforce_estimate_document_canonical_path
  on public.estimate_documents;
create trigger enforce_estimate_document_canonical_path
  before insert or update on public.estimate_documents
  for each row execute function public.enforce_estimate_document_canonical_path();

drop policy if exists "Users can insert estimate documents"
  on public.estimate_documents;
drop policy if exists "Users can update estimate documents"
  on public.estimate_documents;
drop policy if exists "Admins can delete estimate documents"
  on public.estimate_documents;
drop policy if exists "Tenant users can insert estimate documents"
  on public.estimate_documents;
drop policy if exists "Tenant users can update estimate documents"
  on public.estimate_documents;
drop policy if exists "Tenant admins can delete estimate documents"
  on public.estimate_documents;
revoke insert, update, delete on table public.estimate_documents
  from public, anon, authenticated;
grant select on table public.estimate_documents to authenticated;
grant select, insert, update, delete on table public.estimate_documents
  to service_role;

create or replace function public.begin_estimate_pdf_generation(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_purpose text,
  p_dispatch_id uuid default null
)
returns public.estimate_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_dispatch public.estimate_emails%rowtype;
  claimed_document public.estimate_documents%rowtype;
  next_token uuid := gen_random_uuid();
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_purpose not in ('manual', 'email', 'workflow') then
    raise exception using errcode = '22023', message = 'ESTIMATE_PDF_PURPOSE_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  perform public.assert_estimate_email_dispatch_actor(
    p_tenant_id,
    p_version_id,
    p_actor_user_id,
    false
  );

  if p_purpose in ('manual', 'workflow') then
    if p_dispatch_id is not null or target_version.status <> 'draft'::public.estimate_status then
      raise exception using errcode = '42501', message = 'ESTIMATE_PDF_STATUS_FORBIDDEN';
    end if;
  else
    if p_dispatch_id is null
      or target_version.status <> 'sending'::public.estimate_status
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_EMAIL_STATE_CONFLICT';
    end if;

    select dispatch.*
      into target_dispatch
    from public.estimate_emails dispatch
    where dispatch.id = p_dispatch_id
      and dispatch.tenant_id = p_tenant_id
      and dispatch.version_id = p_version_id
      and dispatch.created_by = p_actor_user_id
      and dispatch.request_id is not null
    for update;

    if target_dispatch.id is null
      or target_dispatch.status <> 'preparing'
      or target_dispatch.version_content_revision is distinct from target_version.content_revision
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_EMAIL_STATE_CONFLICT';
    end if;
  end if;

  insert into public.estimate_documents (
    tenant_id,
    version_id,
    status,
    last_error,
    generated_by,
    generation_token,
    generation_purpose,
    generation_dispatch_id,
    generation_content_revision,
    generation_started_at
  ) values (
    p_tenant_id,
    p_version_id,
    'processing',
    null,
    p_actor_user_id,
    next_token,
    p_purpose,
    p_dispatch_id,
    target_version.content_revision,
    clock_timestamp()
  )
  on conflict (tenant_id, version_id)
  do update set
    status = 'processing',
    last_error = null,
    generated_by = excluded.generated_by,
    generation_token = excluded.generation_token,
    generation_purpose = excluded.generation_purpose,
    generation_dispatch_id = excluded.generation_dispatch_id,
    generation_content_revision = excluded.generation_content_revision,
    generation_started_at = excluded.generation_started_at
  returning * into claimed_document;

  return claimed_document;
end;
$$;

revoke execute on function public.begin_estimate_pdf_generation(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_estimate_pdf_generation(uuid, uuid, uuid, text, uuid)
  to service_role;

create or replace function public.publish_estimate_pdf_generation(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_generation_token uuid,
  p_file_path text,
  p_sha256_hash text,
  p_file_size_bytes bigint,
  p_generated_at timestamptz,
  p_layout_options jsonb,
  p_terms_snapshot jsonb
)
returns public.estimate_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_dispatch public.estimate_emails%rowtype;
  target_document public.estimate_documents%rowtype;
  published_document public.estimate_documents%rowtype;
  expected_path text;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_generation_token is null
    or p_sha256_hash is null
    or p_sha256_hash !~ '^[0-9a-f]{64}$'
    or p_file_size_bytes <= 0
    or p_generated_at is null
    or jsonb_typeof(coalesce(p_layout_options, '{}'::jsonb)) <> 'object'
    or (
      p_terms_snapshot is not null
      and jsonb_typeof(p_terms_snapshot) <> 'object'
    )
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_PDF_PUBLICATION_INVALID';
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
    and exists (
      select 1
      from public.estimate_projects project
      where project.id = version.project_id
        and project.tenant_id = version.tenant_id
    )
  for update of version;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  select document.*
    into target_document
  from public.estimate_documents document
  where document.version_id = p_version_id
    and document.tenant_id = p_tenant_id
  for update;

  if target_document.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_PDF_GENERATION_NOT_FOUND';
  end if;

  expected_path := concat(
    p_tenant_id::text,
    '/',
    target_version.project_id::text,
    '/',
    p_version_id::text,
    '/',
    p_sha256_hash,
    '.pdf'
  );

  if target_document.generation_token is distinct from p_generation_token then
    if target_document.generation_token is null
      and target_document.published_generation_token = p_generation_token
      and target_document.status = 'ready'
      and target_document.file_path = expected_path
      and target_document.sha256_hash = p_sha256_hash
    then
      return target_document;
    end if;

    raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;

  if target_document.generated_by is distinct from p_actor_user_id
    or target_document.generation_content_revision is distinct from target_version.content_revision
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;

  if target_document.generation_purpose in ('manual', 'workflow') then
    if target_version.status <> 'draft'::public.estimate_status then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
    end if;
  elsif target_document.generation_purpose = 'email' then
    if target_version.status <> 'sending'::public.estimate_status then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
    end if;

    select dispatch.*
      into target_dispatch
    from public.estimate_emails dispatch
    where dispatch.id = target_document.generation_dispatch_id
      and dispatch.tenant_id = p_tenant_id
      and dispatch.version_id = p_version_id
      and dispatch.created_by = p_actor_user_id
    for update;

    if target_dispatch.id is null
      or target_dispatch.status <> 'preparing'
      or target_dispatch.version_content_revision is distinct from target_document.generation_content_revision
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
    end if;
  else
    raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;

  if trim(coalesce(p_file_path, '')) <> expected_path then
    raise exception using errcode = '23514', message = 'ESTIMATE_PDF_PATH_INVALID';
  end if;

  update public.estimate_documents document
  set
    status = 'ready',
    last_error = null,
    file_path = expected_path,
    sha256_hash = p_sha256_hash,
    file_size_bytes = p_file_size_bytes,
    generated_by = p_actor_user_id,
    generated_at = p_generated_at,
    layout_options = coalesce(p_layout_options, '{}'::jsonb),
    terms_snapshot = p_terms_snapshot,
    published_generation_token = p_generation_token,
    published_purpose = target_document.generation_purpose,
    published_dispatch_id = target_document.generation_dispatch_id,
    published_content_revision = target_document.generation_content_revision,
    generation_token = null,
    generation_purpose = null,
    generation_dispatch_id = null,
    generation_content_revision = null,
    generation_started_at = null
  where document.id = target_document.id
    and document.generation_token = p_generation_token
  returning * into published_document;

  if published_document.id is null then
    raise exception using errcode = '40001', message = 'ESTIMATE_PDF_GENERATION_SUPERSEDED';
  end if;

  return published_document;
end;
$$;

revoke execute on function public.publish_estimate_pdf_generation(
  uuid, uuid, uuid, uuid, text, text, bigint, timestamptz, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.publish_estimate_pdf_generation(
  uuid, uuid, uuid, uuid, text, text, bigint, timestamptz, jsonb, jsonb
) to service_role;

create or replace function public.fail_estimate_pdf_generation(
  p_version_id uuid,
  p_tenant_id uuid,
  p_actor_user_id uuid,
  p_generation_token uuid,
  p_error_message text
)
returns public.estimate_documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_document public.estimate_documents%rowtype;
  failed_document public.estimate_documents%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  select document.*
    into target_document
  from public.estimate_documents document
  where document.version_id = p_version_id
    and document.tenant_id = p_tenant_id
  for update;

  if target_document.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_PDF_GENERATION_NOT_FOUND';
  end if;

  -- A stale worker must never overwrite a newer attempt's result or failure.
  if target_document.generation_token is distinct from p_generation_token
    or target_document.generated_by is distinct from p_actor_user_id
  then
    return target_document;
  end if;

  update public.estimate_documents document
  set
    -- Keep the previous publication metadata for audit/recovery, but never
    -- expose it as a successful response to a failed current attempt.
    status = 'failed',
    last_error = left(coalesce(nullif(trim(p_error_message), ''), 'Echec generation PDF'), 2000),
    generation_token = null,
    generation_purpose = null,
    generation_dispatch_id = null,
    generation_content_revision = null,
    generation_started_at = null
  where document.id = target_document.id
    and document.generation_token = p_generation_token
  returning * into failed_document;

  if failed_document.id is null then
    return target_document;
  end if;

  return failed_document;
end;
$$;

revoke execute on function public.fail_estimate_pdf_generation(uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_estimate_pdf_generation(uuid, uuid, uuid, uuid, text)
  to service_role;

create or replace function public.guard_estimate_email_pdf_publication()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_document public.estimate_documents%rowtype;
  target_version public.estimate_versions%rowtype;
begin
  if old.status <> 'preparing' or new.status <> 'queued' then
    return new;
  end if;

  select version.*
    into target_version
  from public.estimate_versions version
  where version.id = new.version_id
    and version.tenant_id = new.tenant_id;

  select document.*
    into target_document
  from public.estimate_documents document
  where document.version_id = new.version_id
    and document.tenant_id = new.tenant_id;

  if target_version.id is null
    or target_document.id is null
    or target_document.status <> 'ready'
    or target_document.generation_token is not null
    or target_document.file_path is distinct from new.document_path
    or lower(coalesce(target_document.sha256_hash, '')) is distinct from new.document_sha256
    or target_document.published_content_revision is distinct from new.version_content_revision
  then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_PDF_PUBLICATION_CONFLICT';
  end if;

  if target_version.status = 'sending'::public.estimate_status then
    if target_document.published_purpose is distinct from 'email'
      or target_document.published_dispatch_id is distinct from new.id
    then
      raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_PDF_PUBLICATION_CONFLICT';
    end if;
  elsif target_version.status not in (
    'sent'::public.estimate_status,
    'accepted'::public.estimate_status,
    'archived'::public.estimate_status
  ) then
    raise exception using errcode = '40001', message = 'ESTIMATE_EMAIL_PDF_PUBLICATION_CONFLICT';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_estimate_email_pdf_publication()
  from public, anon, authenticated;

drop trigger if exists aaa_guard_estimate_email_pdf_publication
  on public.estimate_emails;
create trigger aaa_guard_estimate_email_pdf_publication
  before update on public.estimate_emails
  for each row execute function public.guard_estimate_email_pdf_publication();

drop policy if exists "Tenant users can view estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant users can insert estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant users can update estimate documents storage"
  on storage.objects;
drop policy if exists "Tenant admins can delete estimate documents storage"
  on storage.objects;

create policy "Tenant users can view estimate documents storage"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'estimate-documents'
    and exists (
      select 1
      from public.estimate_documents document
      join public.estimate_versions version
        on version.id = document.version_id
       and version.tenant_id = document.tenant_id
      join public.estimate_projects project
        on project.id = version.project_id
       and project.tenant_id = version.tenant_id
      where document.status = 'ready'
        and document.file_path = storage.objects.name
        and (select public.is_tenant_member(version.tenant_id))
        and (
          project.user_id = (select auth.uid())
          or (select public.has_tenant_role(
            version.tenant_id,
            array['admin'::public.tenant_role]
          ))
        )
    )
  );

-- No authenticated INSERT/UPDATE/DELETE policies. Only trusted service-role
-- workflows may create immutable content-addressed objects or clean orphans;
-- this prevents an authenticated client from pre-poisoning a predictable hash.
