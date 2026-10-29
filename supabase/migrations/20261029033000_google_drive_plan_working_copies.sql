-- A plan linked from Google Drive keeps one working copy for the métré, and only that one:
-- the dossier itself still holds a link. The copy is an affaire-intake plan copy whose
-- source is the Drive piece (intake_storage_path null, intake_drive_file_id set). It lives
-- and dies with the link through the same generation, cleanup and deletion guards as the
-- copies of stored pieces. Its bytes come from Drive, so no affaire-intake object backs it.

-- Plan presence counts a Drive plan once its working copy holds complete bytes.
create or replace function public.affaire_has_stored_plan(p_project_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.affaire_intake_documents d
    join storage.objects o on o.bucket_id = 'affaire-intake' and o.name = d.storage_path
    where d.project_id = p_project_id and d.tenant_id = (select tenant_id from public.estimate_projects where id = p_project_id)
      and d.deleted_at is null and d.deletion_token is null
      and d.upload_status = 'uploaded' and d.classification_status = 'classified' and d.document_kind = 'plans'
      and d.size_bytes > 0
      and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
        then (o.metadata ->> 'size')::numeric = d.size_bytes else false end
  ) or exists (
    select 1 from public.plan_files f
    join public.plan_sets s on s.id = f.plan_set_id and s.tenant_id = f.tenant_id
    join storage.objects o on o.bucket_id = 'plan-files' and o.name = f.file_path
    where s.project_id = p_project_id and s.tenant_id = (select tenant_id from public.estimate_projects where id = p_project_id)
      and coalesce(f.metadata ->> 'source', '') <> 'affaire-intake'
      and coalesce(f.metadata ->> 'intake_cleanup_pending', 'false') <> 'true'
      and f.file_size_bytes > 0
      and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
        then (o.metadata ->> 'size')::numeric = f.file_size_bytes else false end
  ) or exists (
    select 1 from public.affaire_intake_documents d
    join public.plan_files f on f.tenant_id = d.tenant_id and f.metadata ->> 'source' = 'affaire-intake'
      and f.metadata ->> 'intake_document_id' = d.id::text
    join public.plan_sets s on s.id = f.plan_set_id and s.tenant_id = f.tenant_id and s.project_id = d.project_id
    join storage.objects o on o.bucket_id = 'plan-files' and o.name = f.file_path
    where d.project_id = p_project_id and d.tenant_id = (select tenant_id from public.estimate_projects where id = p_project_id)
      and d.source_provider = 'google_drive' and d.deleted_at is null and d.deletion_token is null
      and d.upload_status = 'uploaded' and d.classification_status = 'classified' and d.document_kind = 'plans'
      and f.metadata ->> 'intake_drive_file_id' = d.drive_file_id
      -- Compared as text: a malformed marker on one row must not make the whole check fail.
      and f.metadata ->> 'intake_generation' = d.plan_copy_generation::text
      and coalesce(f.metadata ->> 'intake_cleanup_pending', 'false') <> 'true'
      and f.file_size_bytes > 0
      and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
        then (o.metadata ->> 'size')::numeric = f.file_size_bytes else false end
  );
$$;
revoke execute on function public.affaire_has_stored_plan(uuid) from public, anon, authenticated;
grant execute on function public.affaire_has_stored_plan(uuid) to service_role;

-- A copy names its source: the stored bytes it was made from, or the Drive file of a link.
-- A Drive copy is only reserved while the link still has the Google account that reads it.
create or replace function public.guard_intake_plan_copy_lifecycle() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare source_row public.affaire_intake_documents;
begin
  if new.metadata ->> 'source' = 'affaire-intake' then
    if tg_op = 'INSERT' and new.metadata ->> 'intake_cleanup_pending' = 'true' then
      raise exception 'INTAKE_PLAN_NOT_STALE';
    end if;
    if tg_op = 'INSERT' then
      -- Match the parent-row then advisory-lock order used by set deletion.
      perform 1 from public.plan_sets where id = new.plan_set_id for key share;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intake-plan-set:' || new.plan_set_id::text, 0));
    end if;
    select * into source_row from public.affaire_intake_documents
      where id = (new.metadata ->> 'intake_document_id')::uuid and tenant_id = new.tenant_id for share;
    if not found or source_row.deleted_at is not null or source_row.deletion_token is not null
       or not coalesce(
         (source_row.storage_path is not null and (new.metadata ->> 'intake_storage_path') = source_row.storage_path)
         or (source_row.source_provider = 'google_drive' and new.metadata -> 'intake_storage_path' = 'null'::jsonb
           and (new.metadata ->> 'intake_drive_file_id') = source_row.drive_file_id), false) then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
    if tg_op = 'INSERT' then
      if source_row.upload_status <> 'uploaded' or source_row.classification_status <> 'classified' or source_row.document_kind <> 'plans'
         or (new.metadata ? 'intake_generation' and
             (new.metadata ->> 'intake_generation')::uuid is distinct from source_row.plan_copy_generation)
         or (new.metadata ? 'intake_classified_at' and
             (new.metadata ->> 'intake_classified_at')::timestamptz is distinct from source_row.classified_at) then
        raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
      end if;
      if source_row.source_provider = 'google_drive' then
        if source_row.drive_connection_id is null then raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE'; end if;
      else
        perform 1 from storage.objects o where o.bucket_id = 'affaire-intake' and o.name = source_row.storage_path
          and source_row.size_bytes > 0 and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
            then (o.metadata ->> 'size')::numeric = source_row.size_bytes else false end for share;
        if not found then raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE'; end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.delete_stale_intake_plan_file(p_file_id uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare plan_row public.plan_files; source_row public.affaire_intake_documents;
begin
  select * into plan_row from public.plan_files where id = p_file_id for update;
  if not found or plan_row.metadata ->> 'source' is distinct from 'affaire-intake' then return null; end if;
  if plan_row.metadata ->> 'intake_cleanup_pending' = 'true' then return plan_row.file_path; end if;
  select * into source_row from public.affaire_intake_documents
    where id = (plan_row.metadata ->> 'intake_document_id')::uuid and tenant_id = plan_row.tenant_id for share;
  if not found or source_row.deletion_token is not null or source_row.deleted_at is not null then return null; end if;
  if source_row.upload_status = 'uploaded' and source_row.classification_status = 'classified'
     and source_row.document_kind = 'plans' and (source_row.storage_path is not null
       or (source_row.source_provider = 'google_drive' and plan_row.metadata ->> 'intake_drive_file_id' = source_row.drive_file_id))
     and (lower(source_row.mime_type) = 'application/pdf' or lower(source_row.file_name) like '%.pdf')
     and (not (plan_row.metadata ? 'intake_generation') or
          (plan_row.metadata ->> 'intake_generation')::uuid is not distinct from source_row.plan_copy_generation)
     and (not (plan_row.metadata ? 'intake_classified_at') or
          (plan_row.metadata ->> 'intake_classified_at')::timestamptz is not distinct from source_row.classified_at)
     then return null; end if;
  update public.plan_files set metadata = metadata || '{"intake_cleanup_pending":true}'::jsonb where id = plan_row.id;
  if not found then return null; end if;
  return plan_row.file_path;
end;
$$;

-- Fence storage writes against a cleanup reservation. The row locks make a
-- late upload finish before cleanup, or reject it after cleanup is reserved.
create or replace function private.guard_plan_storage_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare plan_row public.plan_files; source_row public.affaire_intake_documents;
begin
  if new.bucket_id <> 'plan-files' then return new; end if;
  select * into plan_row from public.plan_files where file_path = new.name for share;
  if not found then
    -- During a migration-first rollout the previously deployed worker uploads
    -- before inserting metadata and uses random UUID v4 paths. New intake
    -- copies use UUID v5 and never take this service-only compatibility path.
    if coalesce(auth.jwt() ->> 'role', '') = 'service_role'
       and pg_catalog.split_part(new.name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return new;
    end if;
    raise exception using errcode = '23503', message = 'PLAN_FILE_RESERVATION_REQUIRED';
  end if;
  if plan_row.metadata ->> 'source' = 'affaire-intake' then
    if plan_row.metadata ->> 'intake_cleanup_pending' = 'true' then
      raise exception 'INTAKE_PLAN_CLEANUP_PENDING';
    end if;
    select * into source_row from public.affaire_intake_documents
      where id = (plan_row.metadata ->> 'intake_document_id')::uuid and tenant_id = plan_row.tenant_id for share;
    if not found or source_row.deleted_at is not null or source_row.deletion_token is not null
       or source_row.upload_status <> 'uploaded' or source_row.classification_status <> 'classified'
       or source_row.document_kind <> 'plans'
       or not coalesce(
         (source_row.storage_path is not null and (plan_row.metadata ->> 'intake_storage_path') = source_row.storage_path)
         or (source_row.source_provider = 'google_drive' and plan_row.metadata -> 'intake_storage_path' = 'null'::jsonb
           and (plan_row.metadata ->> 'intake_drive_file_id') = source_row.drive_file_id), false)
       or (plan_row.metadata ? 'intake_generation' and
           (plan_row.metadata ->> 'intake_generation')::uuid is distinct from source_row.plan_copy_generation)
       or (plan_row.metadata ? 'intake_classified_at' and
           (plan_row.metadata ->> 'intake_classified_at')::timestamptz is distinct from source_row.classified_at) then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
    -- The bytes of a Drive copy were read from Drive: no affaire-intake object backs them.
    if source_row.source_provider is distinct from 'google_drive' then
      perform 1 from storage.objects o where o.bucket_id = 'affaire-intake' and o.name = source_row.storage_path
        and source_row.size_bytes > 0 and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
          then (o.metadata ->> 'size')::numeric = source_row.size_bytes else false end for share;
      if not found then raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE'; end if;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_plan_storage_write() from public, anon, authenticated;

-- Intake copies are lifecycle-managed by their source document. Prevent a
-- direct metadata delete (including through PostgREST) from racing a producer.
create or replace function private.guard_intake_plan_metadata() returns trigger
language plpgsql security definer set search_path = '' as $$
declare source_row public.affaire_intake_documents;
begin
  if old.metadata ->> 'source' is distinct from 'affaire-intake' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  if tg_op = 'UPDATE' then
    if old.metadata ->> 'intake_cleanup_pending' = 'true'
       and new.metadata ->> 'intake_cleanup_pending' is distinct from 'true' then
      raise exception 'INTAKE_PLAN_CLEANUP_RESERVED';
    end if;
    if coalesce(old.metadata ->> 'intake_cleanup_pending', 'false') <> 'true'
       and new.metadata ->> 'intake_cleanup_pending' = 'true' then
      select * into source_row from public.affaire_intake_documents
        where id = (old.metadata ->> 'intake_document_id')::uuid and tenant_id = old.tenant_id for share;
      if found and source_row.deleted_at is null and source_row.deletion_token is null
         and source_row.upload_status = 'uploaded' and source_row.classification_status = 'classified'
         and source_row.document_kind = 'plans' and (source_row.storage_path is not null
           or (source_row.source_provider = 'google_drive' and old.metadata ->> 'intake_drive_file_id' = source_row.drive_file_id))
         and (not (old.metadata ? 'intake_generation') or
           (old.metadata ->> 'intake_generation')::uuid is not distinct from source_row.plan_copy_generation)
         and (not (old.metadata ? 'intake_classified_at') or
           (old.metadata ->> 'intake_classified_at')::timestamptz is not distinct from source_row.classified_at) then
        raise exception 'INTAKE_PLAN_NOT_STALE';
      end if;
    end if;
    if new.metadata ->> 'source' is distinct from old.metadata ->> 'source'
      or new.metadata ->> 'intake_document_id' is distinct from old.metadata ->> 'intake_document_id'
      or new.metadata ->> 'intake_storage_path' is distinct from old.metadata ->> 'intake_storage_path'
      or new.metadata ->> 'intake_drive_file_id' is distinct from old.metadata ->> 'intake_drive_file_id'
      or new.metadata -> 'intake_classified_at' is distinct from old.metadata -> 'intake_classified_at'
      or new.metadata -> 'intake_generation' is distinct from old.metadata -> 'intake_generation'
      or new.file_path is distinct from old.file_path then
      raise exception 'INTAKE_PLAN_IDENTITY_IMMUTABLE';
    end if;
    return new;
  end if;
  if pg_catalog.pg_trigger_depth() > 1 then return old; end if;
  select * into source_row from public.affaire_intake_documents
    where id = (old.metadata ->> 'intake_document_id')::uuid and tenant_id = old.tenant_id for share;
  if found and source_row.deleted_at is null and source_row.deletion_token is null
     and coalesce(old.metadata ->> 'intake_cleanup_pending', 'false') <> 'true' then
    raise exception 'INTAKE_PLAN_DELETE_SOURCE_FIRST';
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_intake_plan_metadata() from public, anon, authenticated;
