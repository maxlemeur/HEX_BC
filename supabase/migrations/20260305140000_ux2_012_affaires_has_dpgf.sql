-- UX2-012: add has_dpgf flag to affaires list RPC.

drop function if exists public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid,
  text
);

create or replace function public.list_affaires_page(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_limit integer default 20,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_project_id uuid default null,
  p_sort_dir text default 'desc'
)
returns table (
  project_id uuid,
  project_name text,
  project_reference text,
  project_client text,
  version_count integer,
  has_current_version boolean,
  current_version_id uuid,
  current_version_number integer,
  current_status public.estimate_status,
  current_total_ht_cents integer,
  current_updated_at timestamptz,
  accepted_version_id uuid,
  accepted_version_number integer,
  has_dpgf boolean
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 101));
  v_search text := nullif(btrim(p_search), '');
  v_sort_dir text := case lower(coalesce(p_sort_dir, 'desc'))
    when 'asc' then 'asc'
    else 'desc'
  end;
  v_is_admin boolean;
begin
  if p_tenant_id is null then
    raise exception using message = 'AFFAIRES_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'AFFAIRES_TENANT_MISMATCH';
  end if;

  v_is_admin := coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  );

  if not v_is_admin and p_owner_user_id is distinct from auth.uid() then
    raise exception using message = 'AFFAIRES_OWNER_SCOPE_INVALID';
  end if;

  if (p_cursor_updated_at is null) <> (p_cursor_project_id is null) then
    raise exception using message = 'AFFAIRES_CURSOR_INVALID';
  end if;

  return query
  with scoped_projects as (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.reference,
      p.client_name,
      p.updated_at
    from public.estimate_projects p
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
      and (v_is_admin or p.user_id = p_owner_user_id)
  ),
  enriched as (
    select
      p.id as project_id,
      p.name as project_name,
      p.reference as project_reference,
      p.client_name as project_client,
      vc.version_count,
      (lv.id is not null) as has_current_version,
      lv.id as current_version_id,
      lv.version_number as current_version_number,
      lv.status as current_status,
      lv.total_ht_cents as current_total_ht_cents,
      coalesce(lv.updated_at, p.updated_at) as current_updated_at,
      av.id as accepted_version_id,
      av.version_number as accepted_version_number,
      (di.id is not null) as has_dpgf
    from scoped_projects p
    left join lateral (
      select
        ev.id,
        ev.version_number,
        ev.status,
        ev.total_ht_cents,
        ev.updated_at
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
    left join lateral (
      select
        ev.id,
        ev.version_number
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
        and ev.status = 'accepted'::public.estimate_status
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) av on true
    left join lateral (
      select count(*)::integer as version_count
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
    ) vc on true
    left join lateral (
      select d.id
      from public.dpgf_imports d
      where d.tenant_id = p.tenant_id
        and d.project_id = p.id
      limit 1
    ) di on true
  ),
  searched as (
    select *
    from enriched e
    where (
      v_search is null
      or e.project_name ilike '%' || v_search || '%'
      or coalesce(e.project_client, '') ilike '%' || v_search || '%'
    )
  )
  select
    s.project_id,
    s.project_name,
    s.project_reference,
    s.project_client,
    s.version_count,
    s.has_current_version,
    s.current_version_id,
    s.current_version_number,
    s.current_status,
    s.current_total_ht_cents,
    s.current_updated_at,
    s.accepted_version_id,
    s.accepted_version_number,
    s.has_dpgf
  from searched s
  where (
    p_statuses is null
    or cardinality(p_statuses) = 0
    or (
      s.has_current_version
      and s.current_status = any(p_statuses)
    )
    or (
      not s.has_current_version
      and 'draft'::public.estimate_status = any(p_statuses)
    )
  )
    and (
      p_cursor_updated_at is null
      or (
        (v_sort_dir = 'desc' and (s.current_updated_at, s.project_id) < (p_cursor_updated_at, p_cursor_project_id))
        or (v_sort_dir = 'asc' and (s.current_updated_at, s.project_id) > (p_cursor_updated_at, p_cursor_project_id))
      )
    )
  order by
    case when v_sort_dir = 'asc' then s.current_updated_at end asc,
    case when v_sort_dir = 'asc' then s.project_id end asc,
    case when v_sort_dir = 'desc' then s.current_updated_at end desc,
    case when v_sort_dir = 'desc' then s.project_id end desc
  limit v_limit;
end;
$$;

grant execute on function public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid,
  text
)
to authenticated;
