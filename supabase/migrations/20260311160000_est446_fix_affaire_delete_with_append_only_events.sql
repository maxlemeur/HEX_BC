create or replace function public.guard_estimate_versions_delete_draft_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception
      using
        errcode = '42501',
        message = 'ESTIMATE_VERSION_DELETE_DRAFT_ONLY',
        detail = 'Only draft estimate versions can be deleted.';
  end if;

  return old;
end;
$$;

drop trigger if exists estimate_versions_delete_draft_only_guard on public.estimate_versions;
create trigger estimate_versions_delete_draft_only_guard
  before delete on public.estimate_versions
  for each row execute procedure public.guard_estimate_versions_delete_draft_only();

create or replace function public.guard_estimate_version_events_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  raise exception
    using
      errcode = '42501',
      message = 'ESTIMATE_VERSION_EVENTS_APPEND_ONLY',
      detail = 'estimate_version_events is append-only and does not allow update/delete.';
end;
$$;
