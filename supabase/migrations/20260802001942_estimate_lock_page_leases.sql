begin;

alter table public.draft_locks
  add column if not exists session_id uuid;

update public.draft_locks
set session_id = gen_random_uuid()
where session_id is null;

alter table public.draft_locks
  alter column session_id set not null;

create index if not exists idx_draft_locks_session_id
  on public.draft_locks (session_id);

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
