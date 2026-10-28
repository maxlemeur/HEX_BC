-- Reviewed DPGF PDFs are stored in the same private import bucket as spreadsheets.
update storage.buckets set allowed_mime_types = pg_catalog.array_append(allowed_mime_types, 'application/pdf')
where id = 'dpgf-imports' and allowed_mime_types is not null
  and not ('application/pdf' = any(allowed_mime_types));

-- Give each source lifecycle a database-owned generation so late workers can
-- never reuse a path after reclassification or an interrupted deletion.
alter table public.affaire_intake_documents add column plan_copy_generation uuid not null default gen_random_uuid();
create or replace function private.rotate_intake_plan_copy_generation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.plan_copy_generation := pg_catalog.gen_random_uuid();
    return new;
  end if;
  if new.storage_path is distinct from old.storage_path
    or new.document_kind is distinct from old.document_kind
    or new.classification_status is distinct from old.classification_status
    or new.classified_at is distinct from old.classified_at
    or new.upload_status is distinct from old.upload_status
    or new.deleted_at is distinct from old.deleted_at
    or (old.deletion_token is not null and new.deletion_token is not null
        and new.plan_copy_generation is distinct from old.plan_copy_generation) then
    new.plan_copy_generation := pg_catalog.gen_random_uuid();
  else
    new.plan_copy_generation := old.plan_copy_generation;
  end if;
  return new;
end;
$$;
drop trigger if exists rotate_intake_plan_copy_generation on public.affaire_intake_documents;
create trigger rotate_intake_plan_copy_generation before insert or update on public.affaire_intake_documents
  for each row execute function private.rotate_intake_plan_copy_generation();

-- Only a server-authorized caller may derive plan presence across Storage RLS.
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
  );
$$;
revoke execute on function public.affaire_has_stored_plan(uuid) from public, anon, authenticated;
grant execute on function public.affaire_has_stored_plan(uuid) to service_role;

-- Derive the plan gap from committed metadata and Storage in one transaction.
-- The caller has already checked the project and actor; the function is service-only.
create or replace function public.reconcile_affaire_plan_gap(
  p_project_id uuid,
  p_actor_user_id uuid default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.estimate_projects%rowtype;
  v_upload_id uuid;
  v_entry public.affaire_register_entries%rowtype;
  v_brief public.affaire_briefs%rowtype;
  v_has_plan boolean;
  v_changed boolean := false;
  v_presence_changed boolean := false;
  v_brief_changed boolean := false;
  v_metadata jsonb;
  v_severity text;
  v_impacts jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'AFFAIRE_PLAN_RECONCILIATION_SERVICE_ROLE_REQUIRED';
  end if;

  -- Every reconciliation rereads committed state after taking the same lock;
  -- an older request can never subsequently publish its old snapshot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('affaire-plan-gap:' || p_project_id::text, 0));
  select * into v_project from public.estimate_projects where id = p_project_id;
  if not found or v_project.is_archived then
    raise exception using message = 'AFFAIRE_PLAN_PROJECT_NOT_FOUND';
  end if;
  select id into v_upload_id from public.affaire_intake_uploads
    where project_id = p_project_id and tenant_id = v_project.tenant_id order by created_at desc, id desc limit 1;
  if v_upload_id is null then
    return false;
  end if;

  select public.affaire_has_stored_plan(p_project_id) into v_has_plan;

  select * into v_entry from public.affaire_register_entries
    where project_id = p_project_id and sync_key = 'missing_piece:missing_plans' for update;

  if not v_has_plan then
    if v_entry.id is null then
      v_metadata := pg_catalog.jsonb_build_object(
        'businessImpact', pg_catalog.jsonb_build_array('affects_hub_readiness', 'blocks_submission', 'affects_takeoff'),
        'structuredLocation', pg_catalog.jsonb_build_object('scopeType', 'project', 'scopeId', null,
          'scopeRef', null, 'scopeLabel', v_project.name, 'versionId', null, 'sourceDocumentId', null, 'sourceFileName', null));
      insert into public.affaire_register_entries
        (tenant_id, project_id, kind, code, text, severity, status, origin_kind, scope_type, scope_label, sync_key, metadata, created_by, updated_by)
      values (v_project.tenant_id, p_project_id, 'missing_piece', 'missing_plans', 'Plans manquants',
        'critical', 'open', 'system', 'project', v_project.name, 'missing_piece:missing_plans', v_metadata, p_actor_user_id, p_actor_user_id)
      returning * into v_entry;
      insert into public.affaire_register_events (entry_id, actor_user_id, event_type, reason, after_payload)
        values (v_entry.id, p_actor_user_id, 'created', 'intake.missing_pieces_sync',
          pg_catalog.jsonb_build_object('kind', 'missing_piece', 'severity', 'critical', 'status', 'open'));
      v_changed := true;
    elsif not v_entry.is_active then
      v_metadata := v_entry.metadata - 'clientClarificationRequest' - 'continuationDecision' - 'continuationSource' - 'revalidationRequest';
      v_severity := case when v_metadata #>> '{severityDecision,mode}' = 'manual'
        and v_metadata #>> '{severityDecision,overriddenSeverity}' in ('info', 'warning', 'critical')
        then v_metadata #>> '{severityDecision,overriddenSeverity}' else 'critical' end;
      v_impacts := case when v_severity = 'critical'
        then pg_catalog.jsonb_build_array('affects_hub_readiness', 'blocks_submission', 'affects_takeoff')
        else pg_catalog.jsonb_build_array('affects_hub_readiness', 'affects_takeoff') end;
      v_metadata := v_metadata || pg_catalog.jsonb_build_object('businessImpact', v_impacts,
        'structuredLocation', pg_catalog.jsonb_build_object('scopeType', 'project', 'scopeId', null,
          'scopeRef', null, 'scopeLabel', v_project.name, 'versionId', null, 'sourceDocumentId', null, 'sourceFileName', null));
      perform public.update_affaire_register_entry_with_event(v_entry.id,
        pg_catalog.jsonb_build_object('status', 'open', 'severity', v_severity, 'is_active', true, 'metadata', v_metadata,
          'scope_label', v_project.name, 'source_file_name', null, 'source_document_id', null),
        'reactivated', 'intake.missing_pieces_sync', pg_catalog.jsonb_build_object('status', v_entry.status, 'is_active', false),
        pg_catalog.jsonb_build_object('status', 'open', 'is_active', true), p_actor_user_id);
      v_changed := true;
      v_presence_changed := true;
    end if;
  elsif v_entry.id is not null and v_entry.is_active then
    perform public.update_affaire_register_entry_with_event(v_entry.id,
      pg_catalog.jsonb_build_object('status', case when v_entry.status = 'validated' then v_entry.status else 'validated' end, 'is_active', false),
      'deactivated', 'intake.missing_pieces_sync', pg_catalog.jsonb_build_object('status', v_entry.status, 'is_active', true),
      pg_catalog.jsonb_build_object('status', 'validated', 'is_active', false), p_actor_user_id);
    v_changed := true;
    v_presence_changed := true;
  end if;

  -- Preserve the historical brief text and source links. A plan transition
  -- requires review, and a missing plan invalidates a previously recorded resolution.
  if v_changed or not v_has_plan then
    select * into v_brief from public.affaire_briefs where project_id = p_project_id for update;
    if v_brief.id is not null and (
      (not v_has_plan and v_brief.generation_metadata ? 'resolved_plan_gap_indexes') or
      (v_brief.status = 'confirme' and (v_presence_changed or
        (not v_has_plan and not (v_brief.missing_elements @> '["Plans manquants"]'::jsonb))))
    ) then
      update public.affaire_briefs set status = 'a_confirmer', confirmed_at = null,
        confirmed_by = null, updated_by = p_actor_user_id,
        generation_metadata = case when not v_has_plan then generation_metadata - 'resolved_plan_gap_indexes' else generation_metadata end
        where id = v_brief.id;
      insert into public.affaire_intake_events (upload_id, actor_user_id, event_type, reason, before_payload, after_payload)
        values (coalesce(v_brief.upload_id, v_upload_id), p_actor_user_id, 'brief.updated', 'plans.presence_sync',
          pg_catalog.jsonb_build_object('status', v_brief.status, 'resolved_plan_gap_indexes', v_brief.generation_metadata -> 'resolved_plan_gap_indexes'),
          pg_catalog.jsonb_build_object('status', 'a_confirmer'));
      v_brief_changed := true;
    end if;
  end if;
  return v_changed or v_brief_changed;
end;
$$;

revoke execute on function public.reconcile_affaire_plan_gap(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reconcile_affaire_plan_gap(uuid, uuid) to service_role;

-- Explicitly mark the exact reviewed entry as treated without deleting its text
-- or source links. A stale page must reload instead of resolving a different entry.
create or replace function public.resolve_affaire_brief_plan_gap(
  p_project_id uuid, p_entry_index integer, p_expected_updated_at timestamptz, p_actor_user_id uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_brief public.affaire_briefs%rowtype; v_indexes jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'AFFAIRE_PLAN_RECONCILIATION_SERVICE_ROLE_REQUIRED';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('affaire-plan-gap:' || p_project_id::text, 0));
  if not public.affaire_has_stored_plan(p_project_id) then
    raise exception using errcode = '40001', message = 'AFFAIRE_PLAN_NOT_PRESENT';
  end if;
  select * into v_brief from public.affaire_briefs where project_id = p_project_id for update;
  if not found or v_brief.updated_at is distinct from p_expected_updated_at
     or p_entry_index < 0 or v_brief.missing_elements ->> p_entry_index is distinct from 'Plans manquants' then
    raise exception using errcode = '40001', message = 'AFFAIRE_BRIEF_STALE';
  end if;
  v_indexes := case when pg_catalog.jsonb_typeof(v_brief.generation_metadata -> 'resolved_plan_gap_indexes') = 'array'
    then v_brief.generation_metadata -> 'resolved_plan_gap_indexes' else '[]'::jsonb end;
  if v_indexes @> pg_catalog.jsonb_build_array(p_entry_index) then return false; end if;
  update public.affaire_briefs set
    generation_metadata = pg_catalog.jsonb_set(generation_metadata, '{resolved_plan_gap_indexes}', v_indexes || pg_catalog.jsonb_build_array(p_entry_index), true),
    status = 'a_confirmer', confirmed_at = null, confirmed_by = null, updated_by = p_actor_user_id
    where id = v_brief.id;
  insert into public.affaire_intake_events (upload_id, actor_user_id, event_type, reason, before_payload, after_payload)
    values (coalesce(v_brief.upload_id, (select id from public.affaire_intake_uploads where project_id = p_project_id order by created_at desc, id desc limit 1)), p_actor_user_id, 'brief.updated', 'plans.marked_received',
      pg_catalog.jsonb_build_object('status', v_brief.status, 'entry_index', p_entry_index),
      pg_catalog.jsonb_build_object('status', 'a_confirmer', 'entry_index', p_entry_index, 'resolved', true));
  return true;
end;
$$;
revoke execute on function public.resolve_affaire_brief_plan_gap(uuid, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.resolve_affaire_brief_plan_gap(uuid, integer, timestamptz, uuid) to service_role;

-- A reclassification starts a new copy generation. A delayed cleanup of the
-- prior generation must never remove the bytes of the replacement.
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
       or source_row.storage_path is null
       or (new.metadata ->> 'intake_storage_path') is distinct from source_row.storage_path then
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
      perform 1 from storage.objects o where o.bucket_id = 'affaire-intake' and o.name = source_row.storage_path
        and source_row.size_bytes > 0 and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
          then (o.metadata ->> 'size')::numeric = source_row.size_bytes else false end for share;
      if not found then raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE'; end if;
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
     and source_row.document_kind = 'plans' and source_row.storage_path is not null
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
       or source_row.document_kind <> 'plans' or source_row.storage_path is distinct from plan_row.metadata ->> 'intake_storage_path'
       or (plan_row.metadata ? 'intake_generation' and
           (plan_row.metadata ->> 'intake_generation')::uuid is distinct from source_row.plan_copy_generation)
       or (plan_row.metadata ? 'intake_classified_at' and
           (plan_row.metadata ->> 'intake_classified_at')::timestamptz is distinct from source_row.classified_at) then
      raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE';
    end if;
    perform 1 from storage.objects o where o.bucket_id = 'affaire-intake' and o.name = source_row.storage_path
      and source_row.size_bytes > 0 and case when pg_catalog.jsonb_typeof(o.metadata -> 'size') = 'number'
        then (o.metadata ->> 'size')::numeric = source_row.size_bytes else false end for share;
    if not found then raise exception 'INTAKE_PLAN_SOURCE_UNAVAILABLE'; end if;
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_plan_storage_write() from public, anon, authenticated;
drop trigger if exists guard_plan_storage_write on storage.objects;
create trigger guard_plan_storage_write before insert or update on storage.objects
  for each row execute function private.guard_plan_storage_write();


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
         and source_row.document_kind = 'plans' and source_row.storage_path is not null
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
drop trigger if exists guard_intake_plan_metadata on public.plan_files;
create trigger guard_intake_plan_metadata before update or delete on public.plan_files
  for each row execute function private.guard_intake_plan_metadata();

create or replace function private.guard_import_plan_set_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_catalog.pg_trigger_depth() = 1 then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('intake-plan-set:' || old.id::text, 0));
    if exists (select 1 from public.plan_files f where f.plan_set_id = old.id and f.metadata ->> 'source' = 'affaire-intake')
      then raise exception 'INTAKE_PLAN_SET_DELETE_SOURCE_FIRST'; end if;
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_import_plan_set_delete() from public, anon, authenticated;
drop trigger if exists guard_import_plan_set_delete on public.plan_sets;
create trigger guard_import_plan_set_delete before delete on public.plan_sets
  for each row execute function private.guard_import_plan_set_delete();


create or replace function private.guard_intake_plan_storage_delete() returns trigger
language plpgsql security definer set search_path = '' as $$
declare plan_row public.plan_files; source_row public.affaire_intake_documents;
begin
  if old.bucket_id <> 'plan-files' then return old; end if;
  select * into plan_row from public.plan_files where file_path = old.name for share;
  if not found or plan_row.metadata ->> 'source' is distinct from 'affaire-intake'
     or plan_row.metadata ->> 'intake_cleanup_pending' = 'true' then return old; end if;
  select * into source_row from public.affaire_intake_documents
    where id = (plan_row.metadata ->> 'intake_document_id')::uuid and tenant_id = plan_row.tenant_id for share;
  if found and source_row.deleted_at is null and source_row.deletion_token is null then
    raise exception 'INTAKE_PLAN_DELETE_SOURCE_FIRST';
  end if;
  return old;
end;
$$;
revoke execute on function private.guard_intake_plan_storage_delete() from public, anon, authenticated;
drop trigger if exists guard_intake_plan_storage_delete on storage.objects;
create trigger guard_intake_plan_storage_delete before delete on storage.objects
  for each row execute function private.guard_intake_plan_storage_delete();
