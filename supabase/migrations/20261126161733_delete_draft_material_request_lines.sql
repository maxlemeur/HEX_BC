create function public.delete_draft_material_request_lines(
  p_project_id uuid,
  p_request_id uuid,
  p_line_ids uuid[]
)
returns uuid[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  active_tenant_id uuid := public.current_tenant_id();
  locked_count integer;
  removed_ids uuid[];
begin
  if p_line_ids is null
    or pg_catalog.cardinality(p_line_ids) not between 1 and 300
    or pg_catalog.array_position(p_line_ids, null) is not null
    or (select count(distinct wanted.id) from pg_catalog.unnest(p_line_ids) as wanted(id)) <> pg_catalog.cardinality(p_line_ids)
  then
    raise exception using errcode = '22023', message = 'MATERIAL_REQUEST_DELETE_SELECTION_INVALID';
  end if;

  if not coalesce(public.has_tenant_role(active_tenant_id, array['admin'::public.tenant_role, 'engineer'::public.tenant_role]), false)
    or not coalesce(public.can_access_affaire_intake_project(p_project_id, active_tenant_id), false)
  then
    raise insufficient_privilege;
  end if;

  -- Consultations take FOR SHARE on these rows in the same order. Check their
  -- association in a separate statement after acquiring the locks.
  perform line.id
  from public.material_request_lines line
  where line.tenant_id = active_tenant_id
    and line.project_id = p_project_id
    and line.request_id = p_request_id
    and line.id = any(p_line_ids)
  order by line.id
  for update of line;
  get diagnostics locked_count = row_count;
  if locked_count <> pg_catalog.cardinality(p_line_ids) then
    raise exception using errcode = 'P0001', message = 'MATERIAL_REQUEST_LINES_CHANGED';
  end if;

  if exists (
    select 1
    from public.material_request_lines line
    where line.tenant_id = active_tenant_id
      and line.project_id = p_project_id
      and line.request_id = p_request_id
      and line.id = any(p_line_ids)
      and (
        line.status <> 'draft'
        or line.price_quote_id is not null
        or exists (
          select 1 from public.material_request_quote_lines quote_line
          where quote_line.tenant_id = active_tenant_id
            and quote_line.project_id = p_project_id
            and quote_line.line_id = line.id
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'MATERIAL_REQUEST_LINES_KEPT';
  end if;

  with removed as (
    delete from public.material_request_lines line
    where line.tenant_id = active_tenant_id
      and line.project_id = p_project_id
      and line.request_id = p_request_id
      and line.id = any(p_line_ids)
    returning line.id
  )
  select pg_catalog.array_agg(removed.id order by removed.id) into removed_ids from removed;
  if coalesce(pg_catalog.cardinality(removed_ids), 0) <> locked_count then
    raise exception using errcode = 'P0001', message = 'MATERIAL_REQUEST_LINES_CHANGED';
  end if;
  return removed_ids;
end;
$$;

revoke all on function public.delete_draft_material_request_lines(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.delete_draft_material_request_lines(uuid, uuid, uuid[]) to authenticated;

comment on function public.delete_draft_material_request_lines(uuid, uuid, uuid[]) is
  'Deletes only the selected drafts in one transaction, under existing tenant and project RLS. A validated or quoted line, or a changed selection, refuses the entire deletion.';
