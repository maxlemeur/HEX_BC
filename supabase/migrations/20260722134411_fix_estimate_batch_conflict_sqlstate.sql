-- Report optimistic batch revision conflicts as an HTTP conflict instead of a
-- PostgreSQL serialization failure. SQLSTATE 40001 is transient by contract
-- and can be retried by callers, while this conflict requires a fresh token.
create or replace function public.claim_estimate_batch_revision(
  p_version_id uuid,
  p_expected_updated_at timestamptz
)
returns table (id uuid, updated_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  return query
  update public.estimate_versions v
  set updated_at = clock_timestamp()
  from public.estimate_projects p
  where v.id = p_version_id
    and v.project_id = p.id
    and v.tenant_id = p.tenant_id
    and v.status = 'draft'
    and v.updated_at = p_expected_updated_at
    and (select public.has_tenant_role(
      v.tenant_id,
      array['admin'::public.tenant_role, 'engineer'::public.tenant_role]
    ))
    and (
      p.user_id = current_user_id
      or (select public.has_tenant_role(v.tenant_id, array['admin'::public.tenant_role]))
    )
    and exists (
      select 1
      from public.draft_locks dl
      where dl.version_id = v.id
        and dl.tenant_id = v.tenant_id
        and dl.user_id = current_user_id
        and dl.expires_at > now()
    )
  returning v.id, v.updated_at;

  if not found then
    raise sqlstate 'PT409' using message = 'ESTIMATE_BATCH_REVISION_CONFLICT';
  end if;
end;
$$;

revoke all on function public.claim_estimate_batch_revision(uuid, timestamptz) from public;
revoke all on function public.claim_estimate_batch_revision(uuid, timestamptz) from anon;
grant execute on function public.claim_estimate_batch_revision(uuid, timestamptz) to authenticated;
