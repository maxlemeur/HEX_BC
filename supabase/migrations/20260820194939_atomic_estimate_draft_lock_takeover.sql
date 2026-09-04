begin;

-- A forced takeover used to be implemented as DELETE followed by INSERT from
-- the browser. That exposed a gap where another waiting editor page could win
-- the lock between both requests. Keep the immutable lock identity trigger and
-- perform both statements inside one database transaction instead.
create or replace function public.takeover_estimate_draft_lock(
  p_version_id uuid,
  p_session_id uuid
)
returns public.draft_locks
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_tenant_id uuid;
  claimed_lock public.draft_locks%rowtype;
begin
  if current_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'AUTHENTICATION_REQUIRED';
  end if;

  if p_session_id is null then
    raise exception using
      errcode = '22023',
      message = 'DRAFT_LOCK_SESSION_REQUIRED';
  end if;

  select version.tenant_id
    into target_tenant_id
  from public.estimate_versions version
  join public.estimate_projects project
    on project.id = version.project_id
   and project.tenant_id = version.tenant_id
  where version.id = p_version_id
    and version.status = 'draft'::public.estimate_status;

  if target_tenant_id is null then
    raise exception using
      errcode = 'P0002',
      message = 'ESTIMATE_DRAFT_VERSION_NOT_FOUND';
  end if;

  if not (
    (select public.has_tenant_role(
      target_tenant_id,
      array['admin'::public.tenant_role]
    ))
    or (select public.is_admin_user())
  ) then
    raise exception using
      errcode = '42501',
      message = 'DRAFT_LOCK_TAKEOVER_FORBIDDEN';
  end if;

  -- Serialize concurrent forced takeovers for the same version. Ordinary lock
  -- acquisition still observes either the old row or the committed new row;
  -- it never observes an unlocked gap.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_version_id::text, 0)
  );

  delete from public.draft_locks lock
  where lock.version_id = p_version_id
    and lock.tenant_id = target_tenant_id;

  insert into public.draft_locks (
    version_id,
    user_id,
    session_id,
    tenant_id,
    locked_at,
    expires_at
  )
  values (
    p_version_id,
    current_user_id,
    p_session_id,
    target_tenant_id,
    clock_timestamp(),
    clock_timestamp() + interval '120 seconds'
  )
  returning * into claimed_lock;

  return claimed_lock;
end;
$$;

revoke all on function public.takeover_estimate_draft_lock(uuid, uuid)
  from public;
revoke all on function public.takeover_estimate_draft_lock(uuid, uuid)
  from anon;
grant execute on function public.takeover_estimate_draft_lock(uuid, uuid)
  to authenticated;

commit;
