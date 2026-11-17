-- TI-695: record material request objects transactionally when their affaire is deleted.
-- The existing durable worker removes the bytes via the Storage API, after commit.
alter table public.procurement_storage_cleanup_outbox
  alter column purchase_order_id drop not null,
  add column project_id uuid,
  add column material_request_id uuid,
  add column material_request_file_id uuid,
  drop constraint procurement_storage_cleanup_outbox_bucket_id_check,
  drop constraint procurement_storage_cleanup_outbox_check,
  add constraint procurement_storage_cleanup_outbox_target_check check (
    (bucket_id = 'devis'
      and purchase_order_id is not null
      and project_id is null and material_request_id is null and material_request_file_id is null
      and storage_path = btrim(storage_path)
      and storage_path ~ ('^purchase-orders/' || purchase_order_id::text || '/[^/]+$')
      and split_part(storage_path, '/', 3) not in ('.', '..'))
    or
    (bucket_id = 'material-requests'
      and purchase_order_id is null
      and project_id is not null and material_request_id is not null and material_request_file_id is not null
      and storage_path ~ ('^' || tenant_id::text || '/' || project_id::text || '/'
        || material_request_id::text || '/' || material_request_file_id::text || '/[^/]+$')
      and split_part(storage_path, '/', 5) not in ('.', '..'))
  );

-- Include terminal rows: an expired worker could still be finishing the old delete.
create index procurement_storage_cleanup_outbox_material_path_idx
  on public.procurement_storage_cleanup_outbox (tenant_id, storage_path)
  where bucket_id = 'material-requests';

alter policy "Tenant admins can view procurement storage cleanup"
  on public.procurement_storage_cleanup_outbox
  using (bucket_id = 'devis' and (select public.has_tenant_role(
    tenant_id, array['admin'::public.tenant_role]
  )));

create or replace function public.guard_procurement_storage_cleanup_outbox()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_APPEND_ONLY';
  end if;

  if new.id is distinct from old.id
    or new.created_at is distinct from old.created_at
    or new.tenant_id is distinct from old.tenant_id
    or new.purchase_order_id is distinct from old.purchase_order_id
    or new.project_id is distinct from old.project_id
    or new.material_request_id is distinct from old.material_request_id
    or new.material_request_file_id is distinct from old.material_request_file_id
    or new.bucket_id is distinct from old.bucket_id
    or new.storage_path is distinct from old.storage_path
    or new.attempts < old.attempts
    or new.max_attempts is distinct from old.max_attempts
    or (
      (old.completed_at is not null or old.abandoned_at is not null)
      and to_jsonb(new) is distinct from to_jsonb(old)
    )
  then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_PAYLOAD_IMMUTABLE';
  end if;

  return new;
end;
$$;

create function private.enqueue_affaire_material_request_storage_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The project row is already gone inside its cascade. Deleting an isolated file, quote or request
  -- still uses its own cleanup. Include unfinalized uploads: they may already have bytes in Storage.
  -- A legacy reservation with a dot segment cannot name a photo through the Storage upload route.
  if not exists (select 1 from public.estimate_projects project where project.id = old.project_id)
    and split_part(old.storage_path, '/', 5) not in ('.', '..')
  then
    insert into public.procurement_storage_cleanup_outbox (
      tenant_id, bucket_id, storage_path, project_id, material_request_id, material_request_file_id
    )
    values (old.tenant_id, 'material-requests', old.storage_path, old.project_id, old.request_id, old.id)
    on conflict (tenant_id, storage_path) where completed_at is null and abandoned_at is null do nothing;
  end if;
  return old;
end;
$$;

revoke all on function private.enqueue_affaire_material_request_storage_cleanup()
  from public, anon, authenticated, service_role;

create trigger enqueue_affaire_material_request_storage_cleanup
  after delete on public.material_request_files
  for each row execute function private.enqueue_affaire_material_request_storage_cleanup();

create or replace function private.guard_material_request_storage_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  file_row public.material_request_files;
begin
  if tg_op = 'UPDATE' then
    if new.bucket_id <> 'material-requests' and old.bucket_id <> 'material-requests' then return new; end if;
    if new.bucket_id is distinct from old.bucket_id or new.name is distinct from old.name then
      raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_MOVE_FORBIDDEN';
    end if;
    -- A read may date the object; what the object holds changes only while its row waits for its bytes.
    if new.metadata is not distinct from old.metadata and new.version is not distinct from old.version then
      return new;
    end if;
  elsif new.bucket_id <> 'material-requests' then
    return new;
  end if;
  select * into file_row from public.material_request_files where storage_path = new.name for share;
  if not found then
    raise exception using errcode = '23503', message = 'MATERIAL_REQUEST_FILE_ROW_REQUIRED';
  end if;
  if file_row.removed_at is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_REMOVED';
  end if;
  if file_row.stored_at is not null then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_ALREADY_STORED';
  end if;
  -- Cleanup may still be in flight after an expired lease. A cascaded key is never reused.
  if exists (
    select 1 from public.procurement_storage_cleanup_outbox cleanup
    where cleanup.bucket_id = 'material-requests'
      and cleanup.tenant_id = file_row.tenant_id and cleanup.storage_path = new.name
  ) then
    raise exception using errcode = '23514', message = 'MATERIAL_REQUEST_FILE_PATH_RETIRED';
  end if;
  return new;
end;
$$;
create or replace function public.claim_procurement_storage_cleanup_for_bucket(
  p_tenant_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_bucket_id text
)
returns setof public.procurement_storage_cleanup_outbox
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'PROCUREMENT_STORAGE_CLEANUP_SERVICE_ROLE_REQUIRED';
  end if;

  if (p_bucket_id is not null and p_bucket_id not in ('devis', 'material-requests'))
    or p_limit is null or p_limit < 1 or p_limit > 100
    or p_lease_seconds is null
    or p_lease_seconds < 30 or p_lease_seconds > 600
  then
    raise exception using
      errcode = '22023',
      message = 'PROCUREMENT_STORAGE_CLEANUP_CLAIM_INVALID';
  end if;

  -- A worker can crash after consuming its final allowed attempt. Once that
  -- lease expires, retain the row as an explicit terminal failure instead of
  -- leaving it forever active but impossible to claim.
  update public.procurement_storage_cleanup_outbox as cleanup
  set abandoned_at = now(),
      lease_token = null,
      lease_expires_at = null,
      last_error = 'PROCUREMENT_STORAGE_CLEANUP_MAX_ATTEMPTS_EXHAUSTED'
  where cleanup.completed_at is null
    and cleanup.abandoned_at is null
    and cleanup.attempts >= cleanup.max_attempts
    and (
      cleanup.lease_expires_at is null
      or cleanup.lease_expires_at <= now()
    )
    and (p_tenant_id is null or cleanup.tenant_id = p_tenant_id)
    and (p_bucket_id is null or cleanup.bucket_id = p_bucket_id);

  return query
  with candidates as (
    select cleanup.id
    from public.procurement_storage_cleanup_outbox as cleanup
    where cleanup.completed_at is null
      and cleanup.abandoned_at is null
      and cleanup.attempts < cleanup.max_attempts
      and cleanup.next_attempt_at <= now()
      and (
        cleanup.lease_expires_at is null
        or cleanup.lease_expires_at <= now()
      )
      and (p_tenant_id is null or cleanup.tenant_id = p_tenant_id)
      and (p_bucket_id is null or cleanup.bucket_id = p_bucket_id)
    order by cleanup.next_attempt_at, cleanup.created_at, cleanup.id
    for update skip locked
    limit p_limit
  )
  update public.procurement_storage_cleanup_outbox as cleanup
  set attempts = cleanup.attempts + 1,
      last_attempt_at = now(),
      lease_token = gen_random_uuid(),
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      last_error = null
  from candidates
  where cleanup.id = candidates.id
  returning cleanup.*;
end;
$$;

revoke all on function public.claim_procurement_storage_cleanup_for_bucket(uuid, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.claim_procurement_storage_cleanup_for_bucket(uuid, integer, integer, text)
  to service_role;

-- Existing purchase-order calls (including builds deployed before this migration) keep their scope.
create or replace function public.claim_procurement_storage_cleanup(
  p_tenant_id uuid default null,
  p_limit integer default 25,
  p_lease_seconds integer default 120
)
returns setof public.procurement_storage_cleanup_outbox
language sql
security invoker
set search_path = ''
as $$
  select * from public.claim_procurement_storage_cleanup_for_bucket(
    p_tenant_id, p_limit, p_lease_seconds, 'devis'
  );
$$;
