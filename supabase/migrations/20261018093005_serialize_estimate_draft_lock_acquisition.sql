begin;

-- A forced takeover (public.takeover_estimate_draft_lock) takes the version's
-- transaction advisory lock, then deletes the lease row and inserts its own.
-- An ordinary acquisition (the editor's POST /lock: one PostgREST INSERT) did
-- not take that lock. With no live lease row, an acquisition whose INSERT was
-- not yet committed when the takeover deleted was invisible to that DELETE,
-- yet already in the unique index: the takeover's INSERT waited for it, then
-- failed with 23505 and the admin got HTTP 409 « Conflit de données »
-- (docs/testing/v3e03-draft-lock-takeover.md).
--
-- Every INSERT now takes the same lock before it reaches the unique index, so
-- an acquisition and a takeover of one version run one after the other. A
-- takeover that waits deletes the committed acquisition and claims the lease;
-- an acquisition that waits finds the committed takeover and is refused as
-- before (23505, mapped to the lease conflict by acquireLock). RLS, the
-- immutable lease identity and the tenant assignment are unchanged; renewals
-- (UPDATE) and releases (DELETE) take no new lock. The lock is re-entrant, so
-- the takeover's own INSERT takes it again without waiting.
create or replace function public.assign_draft_lock_tenant_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_tenant_id uuid;
begin
  if tg_op = 'UPDATE' and (
    old.version_id is distinct from new.version_id
    or old.user_id is distinct from new.user_id
    or old.session_id is distinct from new.session_id
    or old.tenant_id is distinct from new.tenant_id
    or old.locked_at is distinct from new.locked_at
    or old.created_at is distinct from new.created_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'DRAFT_LOCK_IDENTITY_IMMUTABLE';
  end if;

  if tg_op = 'INSERT' then
    -- Same key as public.takeover_estimate_draft_lock.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(new.version_id::text, 0)
    );
  end if;

  select ev.tenant_id into parent_tenant_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if parent_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = 'DRAFT_LOCK_VERSION_NOT_FOUND';
  end if;

  new.tenant_id := parent_tenant_id;
  return new;
end;
$$;
revoke all on function public.assign_draft_lock_tenant_id() from public;
revoke all on function public.assign_draft_lock_tenant_id() from anon;
revoke all on function public.assign_draft_lock_tenant_id() from authenticated;

commit;
