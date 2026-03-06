-- EST-382: apply structure drafts atomically and preserve four-level hierarchies.

alter table public.estimate_structure_draft_nodes
  drop constraint if exists estimate_structure_draft_nodes_hierarchy_level_check;

alter table public.estimate_structure_draft_nodes
  add constraint estimate_structure_draft_nodes_hierarchy_level_check
  check (hierarchy_level between 1 and 4);

create or replace function public.apply_estimate_structure_draft(
  p_draft_id uuid,
  p_target_version_id uuid,
  p_applied_by uuid,
  p_created_items jsonb default '[]'::jsonb,
  p_updated_items jsonb default '[]'::jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_applied_at timestamptz default now()
)
returns table (
  created_count integer,
  updated_count integer,
  application_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_current_tenant_id uuid := public.current_tenant_id();
  v_expected_updated_count integer := 0;
  v_expected_application_count integer := 0;
begin
  if p_draft_id is null then
    raise exception 'p_draft_id is required';
  end if;

  if p_target_version_id is null then
    raise exception 'p_target_version_id is required';
  end if;

  if v_current_tenant_id is null then
    raise exception 'tenant context is required';
  end if;

  perform 1
  from public.estimate_structure_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.target_version_id = p_target_version_id
  for update;

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_NOT_FOUND';
  end if;

  perform 1
  from public.estimate_structure_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.target_version_id = p_target_version_id
    and d.status = 'pending';

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_NOT_PENDING';
  end if;

  perform 1
  from public.estimate_versions ev
  where ev.id = p_target_version_id
    and ev.tenant_id = v_current_tenant_id
  for update;

  if not found then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_VERSION_NOT_FOUND';
  end if;

  with inserted as (
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      source_provider,
      source_job_id,
      source_file_name,
      source_page,
      h_mo_majoration,
      k_mo_atelier,
      k_mo_chantier,
      selected_supplier_price_id
    )
    select
      payload.id,
      v_current_tenant_id,
      p_target_version_id,
      payload.parent_id,
      'section',
      payload.position,
      payload.title,
      payload.source_provider,
      payload.source_job_id,
      payload.source_file_name,
      payload.source_page,
      1,
      1,
      1,
      null
    from jsonb_to_recordset(coalesce(p_created_items, '[]'::jsonb)) as payload(
      id uuid,
      parent_id uuid,
      item_type text,
      position integer,
      title text,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer
    )
    returning 1
  )
  select count(*) into created_count
  from inserted;

  with update_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_updated_items, '[]'::jsonb)) as payload(
      id uuid,
      title text,
      source_provider text,
      source_job_id uuid,
      source_file_name text,
      source_page integer
    )
  ),
  updated as (
    update public.estimate_items ei
    set
      title = payload.title,
      source_provider = payload.source_provider,
      source_job_id = payload.source_job_id,
      source_file_name = payload.source_file_name,
      source_page = payload.source_page
    from update_payload payload
    where ei.id = payload.id
      and ei.tenant_id = v_current_tenant_id
      and ei.version_id = p_target_version_id
      and ei.item_type = 'section'
    returning 1
  )
  select
    (select count(*) from update_payload),
    (select count(*) from updated)
  into v_expected_updated_count, updated_count;

  if updated_count <> v_expected_updated_count then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_TARGET_ITEM_NOT_FOUND';
  end if;

  with application_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_application_rows, '[]'::jsonb)) as payload(
      tenant_id uuid,
      draft_id uuid,
      draft_node_id uuid,
      target_version_id uuid,
      estimate_item_id uuid,
      applied_action text,
      applied_by uuid
    )
  ),
  inserted_applications as (
    insert into public.estimate_structure_draft_applications (
      tenant_id,
      draft_id,
      draft_node_id,
      target_version_id,
      estimate_item_id,
      applied_action,
      applied_by
    )
    select
      v_current_tenant_id,
      p_draft_id,
      payload.draft_node_id,
      p_target_version_id,
      payload.estimate_item_id,
      payload.applied_action,
      coalesce(payload.applied_by, p_applied_by)
    from application_payload payload
    returning 1
  )
  select
    (select count(*) from application_payload),
    (select count(*) from inserted_applications)
  into v_expected_application_count, application_count;

  if application_count <> v_expected_application_count then
    raise exception 'ESTIMATE_STRUCTURE_DRAFT_APPLICATION_INSERT_FAILED';
  end if;

  update public.estimate_structure_drafts
  set
    status = 'applied',
    applied_at = coalesce(p_applied_at, now()),
    updated_at = now()
  where id = p_draft_id
    and tenant_id = v_current_tenant_id;

  return query
  select
    created_count,
    updated_count,
    application_count;
end;
$$;

grant execute on function public.apply_estimate_structure_draft(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  timestamptz
) to authenticated;
