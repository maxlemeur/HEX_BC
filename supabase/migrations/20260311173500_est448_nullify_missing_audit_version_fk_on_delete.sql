create or replace function public.log_estimate_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_new jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  target_old jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  target_record_id uuid;
  target_project_id uuid;
  target_version_id uuid;
  target_row_user_id uuid;
  target_tenant_id uuid;
  target_action text := tg_op;
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  target_record_id := coalesce(
    nullif(target_new->>'id', '')::uuid,
    nullif(target_old->>'id', '')::uuid
  );

  target_version_id := coalesce(
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_new->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_new->>'estimate_version_id', '')::uuid
      else nullif(target_new->>'version_id', '')::uuid
    end,
    case
      when tg_table_name = 'estimate_versions'
      then nullif(target_old->>'id', '')::uuid
      when tg_table_name = 'estimate_version_events'
      then nullif(target_old->>'estimate_version_id', '')::uuid
      else nullif(target_old->>'version_id', '')::uuid
    end
  );

  if tg_op = 'DELETE' and target_version_id is not null then
    if not exists (
      select 1
      from public.estimate_versions v
      where v.id = target_version_id
    ) then
      target_version_id := null;
    end if;
  end if;

  target_project_id := coalesce(
    nullif(target_new->>'project_id', '')::uuid,
    nullif(target_old->>'project_id', '')::uuid
  );

  target_row_user_id := coalesce(
    nullif(target_new->>'user_id', '')::uuid,
    nullif(target_old->>'user_id', '')::uuid,
    nullif(target_new->>'created_by', '')::uuid,
    nullif(target_old->>'created_by', '')::uuid
  );

  target_tenant_id := coalesce(
    nullif(target_new->>'tenant_id', '')::uuid,
    nullif(target_old->>'tenant_id', '')::uuid
  );

  if target_row_user_id is null then
    if tg_table_name = 'estimate_versions' and target_project_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_project_id;
    elsif tg_table_name = 'estimate_items' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_version_events' and target_version_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_versions v
      join public.estimate_projects p on p.id = v.project_id
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.user_id
        into target_row_user_id
      from public.estimate_projects p
      where p.id = target_record_id;
    end if;
  end if;

  if target_tenant_id is null then
    if target_version_id is not null then
      select v.tenant_id
        into target_tenant_id
      from public.estimate_versions v
      where v.id = target_version_id;
    elsif tg_table_name = 'estimate_projects' and target_record_id is not null then
      select p.tenant_id
        into target_tenant_id
      from public.estimate_projects p
      where p.id = target_record_id;
    elsif target_row_user_id is not null then
      select tm.tenant_id
        into target_tenant_id
      from public.tenant_memberships tm
      where tm.user_id = target_row_user_id
      order by tm.is_default desc, tm.created_at asc
      limit 1;
    end if;
  end if;

  if tg_table_name = 'estimate_versions'
    and tg_op = 'UPDATE'
    and coalesce(target_old->>'status', '') = 'draft'
    and coalesce(target_new->>'status', '') = 'sent'
  then
    target_action := 'seal';
  end if;

  insert into public.audit_logs (
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
    coalesce(target_tenant_id, public.current_tenant_id()),
    coalesce((select auth.uid()), target_row_user_id),
    tg_table_name,
    target_record_id,
    target_version_id,
    target_action,
    target_old,
    target_new
  );

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;
