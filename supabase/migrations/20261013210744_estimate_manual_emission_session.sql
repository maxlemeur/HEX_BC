-- Candidate only: regression.sql and before-ddl03.json were frozen first.
-- Create a NEW CLI timestamped migration only after root review/SQL proof.
-- Does not replace installed transition, snapshot, publication or actor RPCs.
begin;

create function public.transition_estimate_draft_to_sent(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_next_status public.estimate_status,
  p_seal_hash text,
  p_actor_user_id uuid,
  p_event_metadata jsonb,
  p_occurred_at timestamptz,
  p_seal_payload_version smallint,
  p_expected_document_contract jsonb,
  p_draft_lock_session_id uuid
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  draft_lock public.draft_locks%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_version_id is null
    or p_tenant_id is null
    or p_expected_updated_at is null
    or p_actor_user_id is null
    or p_draft_lock_session_id is null
    or p_next_status is distinct from 'sent'::public.estimate_status
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_MANUAL_EMISSION_INPUT_INVALID';
  end if;

  -- Version is first, matching editor mutations and the exact-session freezer.
  select version.* into target_version
  from public.estimate_versions version
  where version.id = p_version_id and version.tenant_id = p_tenant_id
  for update of version;

  if target_version.id is null then
    raise exception using errcode = '42501', message = 'ESTIMATE_MANUAL_EMISSION_NOT_WRITABLE';
  end if;

  -- Preserve owner/archive context while the installed helper holds the active
  -- tenant and membership. Admin remains allowed; engineer must own the project.
  perform project.id
  from public.estimate_projects project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
    and not project.is_archived
  for share of project;

  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN';
  end if;

  perform public.assert_estimate_offer_actor(p_tenant_id, p_version_id, p_actor_user_id);

  -- Exact PostgreSQL timestamp, including microseconds. Never adopt a fresh
  -- token silently after the caller's precheck or a version-lock wait.
  if target_version.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status is distinct from 'draft'::public.estimate_status then
    raise exception using errcode = '42501', message = 'ESTIMATE_MANUAL_EMISSION_REQUIRES_DRAFT';
  end if;

  -- A different page of the same actor does not own this lease. Both identity
  -- and real-time expiry are checked after all preceding row-lock waits.
  select lease.* into draft_lock
  from public.draft_locks lease
  where lease.version_id = target_version.id
    and lease.tenant_id = target_version.tenant_id
    and lease.user_id = p_actor_user_id
    and lease.session_id = p_draft_lock_session_id
  for update of lease;

  if draft_lock.version_id is null or draft_lock.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '40001', message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  -- Reuse the unchanged Doc1/proof/Seal5 guards and atomic status/event write.
  -- Reentrant version locks remain held; the exact lease cannot be replaced
  -- or released between this check and the delegated mutation.
  return public.transition_estimate_version_status(
    p_version_id, p_tenant_id, p_expected_updated_at, p_next_status, p_seal_hash,
    p_actor_user_id, p_event_metadata, p_occurred_at, p_seal_payload_version,
    p_expected_document_contract
  );
end;
$$;

revoke all on function public.transition_estimate_draft_to_sent(
  uuid, uuid, timestamptz, public.estimate_status, text, uuid, jsonb,
  timestamptz, smallint, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.transition_estimate_draft_to_sent(
  uuid, uuid, timestamptz, public.estimate_status, text, uuid, jsonb,
  timestamptz, smallint, jsonb, uuid
) to service_role;

commit;
