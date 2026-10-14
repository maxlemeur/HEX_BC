-- Candidate only. Matrix, regression.sql and before-ddl.json were frozen first.
-- New additive bridge; installed reservation/freezer/Doc1/recovery RPCs stay intact.
begin;

create function public.reserve_estimate_email_dispatch_with_session(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_payload_hash text,
  p_recipient text,
  p_cc text[],
  p_subject text,
  p_body text,
  p_from_address text,
  p_portal_origin text,
  p_company_snapshot jsonb,
  p_draft_lock_session_id uuid
)
returns public.estimate_emails
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  existing public.estimate_emails%rowtype;
  draft_lock public.draft_locks%rowtype;
  payload_frozen boolean;
  requires_draft_authority boolean;
begin
  if current_user <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVICE_ROLE_REQUIRED';
  end if;

  -- Keep the installed constructor's input refusals before accessing rows.
  if p_request_id is null or p_payload_hash is null or p_payload_hash !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_recipient, ''))) = 0
    or length(btrim(coalesce(p_subject, ''))) = 0
    or length(btrim(coalesce(p_body, ''))) = 0
    or length(btrim(coalesce(p_from_address, ''))) = 0
  then
    raise exception using errcode = '22023', message = 'ESTIMATE_EMAIL_DISPATCH_INPUT_INVALID';
  end if;

  select version.* into target_version
  from public.estimate_versions version
  join public.estimate_projects project on project.id = version.project_id and project.tenant_id = version.tenant_id
  join public.tenants tenant on tenant.id = version.tenant_id and tenant.is_active
  where version.id = p_version_id and version.tenant_id = p_tenant_id
  for update of version;

  if target_version.id is null then
    raise exception using errcode = 'P0001', message = 'ESTIMATE_VERSION_NOT_FOUND';
  end if;

  perform project.id
  from public.estimate_projects project
  where project.id = target_version.project_id and project.tenant_id = target_version.tenant_id and not project.is_archived
  for share of project;
  if not found then
    raise exception using errcode = '42501', message = 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN';
  end if;
  perform public.assert_estimate_offer_actor(p_tenant_id, p_version_id, p_actor_user_id);

  -- Exactly the installed preference order. Lock the selected dispatch so its
  -- replay/recovery classification cannot change before reentrant delegation.
  if target_version.status in ('sending', 'sent') then
    select dispatch.* into existing
    from public.estimate_emails dispatch
    where dispatch.tenant_id = p_tenant_id and dispatch.version_id = p_version_id
      and dispatch.type = 'initial' and dispatch.status in ('preparing', 'queued', 'processing', 'unknown')
    for update of dispatch;
  end if;
  if existing.id is null then
    select dispatch.* into existing
    from public.estimate_emails dispatch
    where dispatch.tenant_id = p_tenant_id and dispatch.request_id = p_request_id
    for update of dispatch;
  end if;

  requires_draft_authority := target_version.status = 'draft';
  if existing.id is not null then
    payload_frozen := existing.provider_payload_hash ~ '^[0-9a-f]{64}$'
      and length(coalesce(existing.html_body, '')) > 0
      and length(coalesce(existing.text_body, '')) > 0
      and existing.document_path is not null
      and existing.document_sha256 ~ '^[0-9a-f]{64}$'
      and existing.attachment_filename is not null;
    if existing.status <> 'failed' or existing.request_contract_version = 1 or payload_frozen
      or existing.version_id is distinct from p_version_id
      or existing.payload_hash is distinct from p_payload_hash
      or existing.created_by is distinct from p_actor_user_id
      or existing.recipient is distinct from btrim(p_recipient)
      or existing.cc is distinct from p_cc
      or existing.subject is distinct from btrim(p_subject)
      or existing.body is distinct from p_body
    then
      -- Let the unchanged RPC prove the envelope and return exact existing
      -- state, or produce its original mismatch/frozen/legacy refusal.
      requires_draft_authority := false;
    end if;
  end if;

  if requires_draft_authority then
    if target_version.updated_at is distinct from p_expected_updated_at then
      raise exception using errcode = '40001', message = 'ESTIMATE_VERSION_CONFLICT';
    end if;
    select lease.* into draft_lock
    from public.draft_locks lease
    where lease.tenant_id = target_version.tenant_id and lease.version_id = target_version.id
      and lease.user_id = p_actor_user_id and lease.session_id = p_draft_lock_session_id
    for update of lease;
    if draft_lock.version_id is null or draft_lock.expires_at <= pg_catalog.clock_timestamp() then
      raise exception using errcode = '40001', message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
    end if;
  end if;

  -- No fresh draft gate on immutable sent resends or exact existing replay.
  -- All original Doc1/Seal5/envelope/capability/recovery guards still decide.
  return public.reserve_estimate_email_dispatch(
    p_version_id, p_tenant_id, p_expected_updated_at, p_actor_user_id,
    p_request_id, p_payload_hash, p_recipient, p_cc, p_subject, p_body,
    p_from_address, p_portal_origin, p_company_snapshot
  );
end;
$$;

revoke all on function public.reserve_estimate_email_dispatch_with_session(
  uuid, uuid, timestamptz, uuid, uuid, text, text, text[], text, text, text, text, jsonb, uuid
) from public, anon, authenticated;
grant execute on function public.reserve_estimate_email_dispatch_with_session(
  uuid, uuid, timestamptz, uuid, uuid, text, text, text[], text, text, text, text, jsonb, uuid
) to service_role;

commit;
