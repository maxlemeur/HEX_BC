-- EST-066: one audit row per batch operation execution.

create or replace function public.log_estimate_batch_audit(
  target_version_id uuid,
  operations_payload jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version public.estimate_versions%rowtype;
  target_project public.estimate_projects%rowtype;
  target_user_id uuid := (select auth.uid());
  normalized_operations jsonb := coalesce(operations_payload, '[]'::jsonb);
  batch_log_id uuid := gen_random_uuid();
begin
  if target_version_id is null then
    raise exception 'target_version_id is required';
  end if;

  if coalesce(jsonb_typeof(normalized_operations), '') <> 'array' then
    raise exception 'operations_payload must be a JSON array';
  end if;

  if target_user_id is null then
    raise exception 'authentication required';
  end if;

  select ev.*
    into target_version
  from public.estimate_versions ev
  where ev.id = target_version_id;

  if not found then
    raise exception 'estimate version not found';
  end if;

  select ep.*
    into target_project
  from public.estimate_projects ep
  where ep.id = target_version.project_id
    and ep.tenant_id = target_version.tenant_id;

  if not found then
    raise exception 'estimate project not found';
  end if;

  if not public.is_tenant_member(target_version.tenant_id) then
    raise exception 'tenant membership required';
  end if;

  if target_project.user_id <> target_user_id
    and not public.has_tenant_role(
      target_version.tenant_id,
      array['admin'::public.tenant_role]
    )
  then
    raise exception 'access denied';
  end if;

  insert into public.audit_logs (
    id,
    tenant_id,
    user_id,
    table_name,
    record_id,
    estimate_version_id,
    action,
    before_data,
    after_data
  )
  values (
    batch_log_id,
    target_version.tenant_id,
    target_user_id,
    'estimate_versions',
    target_version.id,
    target_version.id,
    'UPDATE',
    null,
    jsonb_build_object(
      'type', 'batch_operations',
      'operation_count', jsonb_array_length(normalized_operations),
      'operations', normalized_operations
    )
  );

  return batch_log_id;
end;
$$;

revoke all on function public.log_estimate_batch_audit(uuid, jsonb) from public;
revoke all on function public.log_estimate_batch_audit(uuid, jsonb) from authenticated;
grant execute on function public.log_estimate_batch_audit(uuid, jsonb) to authenticated;
