-- Approval summaries are a derived read model. Their trusted projection must
-- not invalidate an otherwise unchanged estimate's optimistic content token.
-- All other updates keep the existing timestamp behavior.
begin;

create function public.set_estimate_version_content_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'service_role'
    and new.updated_at is not distinct from old.updated_at
    and (
      new.approval_status is distinct from old.approval_status
      or new.approval_summary is distinct from old.approval_summary
      or new.approval_evaluated_at is distinct from old.approval_evaluated_at
    )
    and (
      to_jsonb(new) - array[
        'approval_status', 'approval_summary', 'approval_evaluated_at', 'updated_at'
      ]
    ) is not distinct from (
      to_jsonb(old) - array[
        'approval_status', 'approval_summary', 'approval_evaluated_at', 'updated_at'
      ]
    )
  then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke all on function public.set_estimate_version_content_updated_at()
  from public, anon, authenticated, service_role;

create or replace trigger set_estimate_versions_updated_at
  before update on public.estimate_versions
  for each row execute function public.set_estimate_version_content_updated_at();

commit;
