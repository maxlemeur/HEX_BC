-- Prepared after the frozen 40-case document snapshot regression. An initial
-- v2 draft PDF requires a financial image under its OWN page-session lease.
-- This wrapper creates no document claim, approval, offer, token or email.
-- The two installed financial RPCs and publication/seal guards stay intact.
begin;

create function public.freeze_estimate_v2_document_snapshot(
  p_version_id uuid,
  p_tenant_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_content_revision bigint,
  p_actor_user_id uuid,
  p_draft_lock_session_id uuid,
  p_calculation_context jsonb,
  p_item_snapshots jsonb,
  p_version_totals jsonb
)
returns public.estimate_versions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_version public.estimate_versions%rowtype;
  draft_lock public.draft_locks%rowtype;
  frozen_version public.estimate_versions%rowtype;
begin
  if current_user <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'SERVICE_ROLE_REQUIRED';
  end if;

  if p_version_id is null
    or p_tenant_id is null
    or p_expected_updated_at is null
    or p_expected_content_revision is null
    or p_actor_user_id is null
    or p_draft_lock_session_id is null
    or p_calculation_context is null
    or p_item_snapshots is null
    or p_version_totals is null
  then
    raise exception using
      errcode = '22023',
      message = 'ESTIMATE_V2_DOCUMENT_SNAPSHOT_INPUT_INVALID';
  end if;

  -- Version is always the first row lock. Do not acquire a lease or membership
  -- first: editor mutations and financial freezes serialize on this version.
  select version.* into target_version
  from public.estimate_versions version
  where version.id = p_version_id
    and version.tenant_id = p_tenant_id
  for update of version;

  if target_version.id is null then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_NOT_WRITABLE';
  end if;

  -- Hold the owner/archive context while assert locks the active tenant and
  -- membership. The delegated financial RPC uses this same project owner.
  perform project.id
  from public.estimate_projects project
  where project.id = target_version.project_id
    and project.tenant_id = target_version.tenant_id
    and not project.is_archived
  for share of project;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_EMAIL_DISPATCH_FORBIDDEN';
  end if;

  perform public.assert_estimate_offer_actor(
    p_tenant_id,
    p_version_id,
    p_actor_user_id
  );

  -- Exact immutable lease identity, including session. Same user in another
  -- tab does not own this lease. Expiry is checked AFTER waiting on the lock.
  select lock.* into draft_lock
  from public.draft_locks lock
  where lock.version_id = target_version.id
    and lock.tenant_id = target_version.tenant_id
    and lock.user_id = p_actor_user_id
    and lock.session_id = p_draft_lock_session_id
  for update of lock;

  if draft_lock.version_id is null
    or draft_lock.expires_at <= pg_catalog.clock_timestamp()
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_DRAFT_LOCK_REQUIRED';
  end if;

  if target_version.updated_at is distinct from p_expected_updated_at
    or target_version.content_revision is distinct from p_expected_content_revision
  then
    raise exception using
      errcode = '40001',
      message = 'ESTIMATE_VERSION_CONFLICT';
  end if;

  if target_version.status <> 'draft'::public.estimate_status
    or target_version.calc_engine_version <> 2
  then
    raise exception using
      errcode = '42501',
      message = 'ESTIMATE_V2_SNAPSHOT_REQUIRES_DRAFT';
  end if;

  -- "send" is the existing financial freeze's lease mode; it persists no
  -- status/emission decision. Never use its approval mode to bypass a lease.
  -- The commercial wrapper retains explicit rounding, zero-rate labor,
  -- context validation, exact item coverage, totals and replay semantics.
  frozen_version := public.freeze_estimate_v2_snapshot(
    p_version_id,
    p_tenant_id,
    p_expected_updated_at,
    p_expected_content_revision,
    p_actor_user_id,
    'send',
    p_calculation_context,
    p_item_snapshots,
    p_version_totals
  );

  return frozen_version;
end;
$$;

revoke all on function public.freeze_estimate_v2_document_snapshot(
  uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.freeze_estimate_v2_document_snapshot(
  uuid, uuid, timestamptz, bigint, uuid, uuid, jsonb, jsonb, jsonb
) to service_role;

commit;
