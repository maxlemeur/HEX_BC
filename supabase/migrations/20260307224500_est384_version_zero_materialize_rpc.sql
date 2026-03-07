create or replace function public.materialize_estimate_version_zero_draft(
  p_draft_id uuid,
  p_version_id uuid,
  p_materialized_by uuid,
  p_section_items jsonb default '[]'::jsonb,
  p_line_items jsonb default '[]'::jsonb,
  p_application_rows jsonb default '[]'::jsonb,
  p_line_links jsonb default '[]'::jsonb,
  p_materialized_at timestamptz default now()
)
returns table (
  created_section_count integer,
  created_line_count integer,
  application_count integer,
  linked_line_count integer
)
language plpgsql
set search_path = public
as $$
declare
  v_current_tenant_id uuid := public.current_tenant_id();
  v_expected_section_count integer := 0;
  v_expected_line_count integer := 0;
  v_expected_application_count integer := 0;
  v_expected_link_count integer := 0;
begin
  if p_draft_id is null then
    raise exception 'EST384_DRAFT_ID_REQUIRED';
  end if;

  if p_version_id is null then
    raise exception 'EST384_VERSION_ID_REQUIRED';
  end if;

  if p_materialized_by is null then
    raise exception 'EST384_MATERIALIZED_BY_REQUIRED';
  end if;

  if v_current_tenant_id is null then
    raise exception 'EST384_TENANT_CONTEXT_REQUIRED';
  end if;

  perform 1
  from public.estimate_version_zero_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.version_id = p_version_id
  for update;

  if not found then
    raise exception 'EST384_DRAFT_NOT_FOUND';
  end if;

  perform 1
  from public.estimate_version_zero_drafts d
  where d.id = p_draft_id
    and d.tenant_id = v_current_tenant_id
    and d.version_id = p_version_id
    and d.status in ('ia_a_revoir', 'ready_for_version');

  if not found then
    raise exception 'EST384_DRAFT_NOT_REVIEWABLE';
  end if;

  perform 1
  from public.estimate_versions ev
  where ev.id = p_version_id
    and ev.tenant_id = v_current_tenant_id
  for update;

  if not found then
    raise exception 'EST384_VERSION_NOT_FOUND';
  end if;

  perform 1
  from public.estimate_items ei
  where ei.tenant_id = v_current_tenant_id
    and ei.version_id = p_version_id
  limit 1;

  if found then
    raise exception 'EST384_VERSION_NOT_EMPTY';
  end if;

  perform 1
  from public.estimate_version_zero_lines l
  where l.tenant_id = v_current_tenant_id
    and l.draft_id = p_draft_id
    and l.review_status = 'pending'
  limit 1;

  if found then
    raise exception 'EST384_PENDING_LINES';
  end if;

  with section_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_section_items, '[]'::jsonb)) as payload(
      id uuid,
      position integer,
      title text,
      source_provider text
    )
  ),
  inserted_sections as (
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      source_provider
    )
    select
      payload.id,
      v_current_tenant_id,
      p_version_id,
      null,
      'section',
      payload.position,
      payload.title,
      coalesce(payload.source_provider, 'version_zero_draft')
    from section_payload payload
    returning 1
  )
  select
    (select count(*) from section_payload),
    (select count(*) from inserted_sections)
  into v_expected_section_count, created_section_count;

  if created_section_count <> v_expected_section_count then
    raise exception 'EST384_SECTION_INSERT_FAILED';
  end if;

  with line_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_line_items, '[]'::jsonb)) as payload(
      id uuid,
      parent_id uuid,
      position integer,
      title text,
      description text,
      quantity numeric,
      unit_price_ht_cents integer,
      tax_rate_bp integer,
      k_fo numeric,
      h_mo numeric,
      h_mo_majoration numeric,
      k_mo numeric,
      pu_ht_cents integer,
      line_total_ht_cents integer,
      line_tax_cents integer,
      line_total_ttc_cents integer,
      source_provider text,
      source_metadata jsonb
    )
  ),
  inserted_lines as (
    insert into public.estimate_items (
      id,
      tenant_id,
      version_id,
      parent_id,
      item_type,
      position,
      title,
      description,
      quantity,
      unit_price_ht_cents,
      tax_rate_bp,
      k_fo,
      h_mo,
      h_mo_majoration,
      k_mo,
      pu_ht_cents,
      line_total_ht_cents,
      line_tax_cents,
      line_total_ttc_cents,
      source_provider,
      source_metadata
    )
    select
      payload.id,
      v_current_tenant_id,
      p_version_id,
      payload.parent_id,
      'line',
      payload.position,
      payload.title,
      payload.description,
      payload.quantity,
      payload.unit_price_ht_cents,
      payload.tax_rate_bp,
      payload.k_fo,
      payload.h_mo,
      payload.h_mo_majoration,
      payload.k_mo,
      payload.pu_ht_cents,
      payload.line_total_ht_cents,
      payload.line_tax_cents,
      payload.line_total_ttc_cents,
      coalesce(payload.source_provider, 'version_zero_draft'),
      coalesce(payload.source_metadata, '{}'::jsonb)
    from line_payload payload
    returning 1
  )
  select
    (select count(*) from line_payload),
    (select count(*) from inserted_lines)
  into v_expected_line_count, created_line_count;

  if created_line_count <> v_expected_line_count then
    raise exception 'EST384_LINE_INSERT_FAILED';
  end if;

  with application_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_application_rows, '[]'::jsonb)) as payload(
      tenant_id uuid,
      project_id uuid,
      version_id uuid,
      draft_id uuid,
      lot_id uuid,
      line_id uuid,
      estimate_item_id uuid,
      parent_section_item_id uuid,
      applied_by uuid,
      application_order integer,
      applied_payload jsonb
    )
  ),
  inserted_applications as (
    insert into public.estimate_version_zero_applications (
      tenant_id,
      project_id,
      version_id,
      draft_id,
      lot_id,
      line_id,
      estimate_item_id,
      parent_section_item_id,
      applied_by,
      application_order,
      applied_payload
    )
    select
      v_current_tenant_id,
      payload.project_id,
      p_version_id,
      p_draft_id,
      payload.lot_id,
      payload.line_id,
      payload.estimate_item_id,
      payload.parent_section_item_id,
      coalesce(payload.applied_by, p_materialized_by),
      payload.application_order,
      coalesce(payload.applied_payload, '{}'::jsonb)
    from application_payload payload
    returning 1
  )
  select
    (select count(*) from application_payload),
    (select count(*) from inserted_applications)
  into v_expected_application_count, application_count;

  if application_count <> v_expected_application_count then
    raise exception 'EST384_APPLICATION_INSERT_FAILED';
  end if;

  with link_payload as (
    select *
    from jsonb_to_recordset(coalesce(p_line_links, '[]'::jsonb)) as payload(
      line_id uuid,
      materialized_estimate_item_id uuid
    )
  ),
  linked_lines as (
    update public.estimate_version_zero_lines l
    set materialized_estimate_item_id = payload.materialized_estimate_item_id
    from link_payload payload
    where l.id = payload.line_id
      and l.tenant_id = v_current_tenant_id
      and l.draft_id = p_draft_id
    returning 1
  )
  select
    (select count(*) from link_payload),
    (select count(*) from linked_lines)
  into v_expected_link_count, linked_line_count;

  if linked_line_count <> v_expected_link_count then
    raise exception 'EST384_LINE_LINK_UPDATE_FAILED';
  end if;

  update public.estimate_version_zero_drafts
  set
    status = 'materialized',
    materialized_at = coalesce(p_materialized_at, now()),
    updated_at = coalesce(p_materialized_at, now())
  where id = p_draft_id
    and tenant_id = v_current_tenant_id;

  return query
  select
    created_section_count,
    created_line_count,
    application_count,
    linked_line_count;
end;
$$;

grant execute on function public.materialize_estimate_version_zero_draft(
  uuid,
  uuid,
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  timestamptz
) to authenticated;
