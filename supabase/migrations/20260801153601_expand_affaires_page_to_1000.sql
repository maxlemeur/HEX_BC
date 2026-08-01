-- Allow one page of up to 1,000 affaires plus the look-ahead row.
-- Keep keyset pagination, tenant authorization, RLS, and grants unchanged.

create or replace function public.list_affaires_page(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_limit integer default 20,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_name text default null,
  p_cursor_total_ht_cents integer default null,
  p_cursor_project_id uuid default null,
  p_sort_by text default 'updatedAt',
  p_sort_dir text default 'desc',
  p_favorites_only boolean default false
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
  has_dpgf boolean,
  current_approval_status public.estimate_version_approval_status,
  is_favorite boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 1001));
  v_search text := nullif(btrim(p_search), '');
  v_sort_by text := case lower(coalesce(p_sort_by, 'updatedat'))
    when 'name' then 'name'
    when 'totalhtcents' then 'totalHtCents'
    else 'updatedAt'
  end;
  v_sort_dir text := case lower(coalesce(p_sort_dir, 'desc'))
    when 'asc' then 'asc'
    else 'desc'
  end;
  v_favorites_only boolean := coalesce(p_favorites_only, false);
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

  if not v_is_admin
    and p_owner_user_id is not null
    and p_owner_user_id is distinct from auth.uid()
  then
    raise exception using message = 'AFFAIRES_OWNER_SCOPE_INVALID';
  end if;

  if p_cursor_project_id is null then
    if num_nonnulls(
      p_cursor_updated_at,
      p_cursor_name,
      p_cursor_total_ht_cents
    ) > 0 then
      raise exception using message = 'AFFAIRES_CURSOR_INVALID';
    end if;
  elsif num_nonnulls(
    p_cursor_updated_at,
    p_cursor_name,
    p_cursor_total_ht_cents
  ) <> 1
    or (v_sort_by = 'updatedAt' and p_cursor_updated_at is null)
    or (v_sort_by = 'name' and p_cursor_name is null)
    or (v_sort_by = 'totalHtCents' and p_cursor_total_ht_cents is null)
  then
    raise exception using message = 'AFFAIRES_CURSOR_INVALID';
  end if;

  return query
  with scoped_projects as materialized (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.reference,
      p.client_name,
      p.updated_at,
      coalesce(ufp.project_id is not null, false) as is_favorite
    from public.estimate_projects p
    left join public.user_favorite_projects ufp
      on ufp.tenant_id = p.tenant_id
      and ufp.user_id = auth.uid()
      and ufp.project_id = p.id
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
      and (v_is_admin or p_owner_user_id is null or p.user_id = p_owner_user_id)
      and (
        not v_favorites_only
        or ufp.project_id is not null
      )
      and (
        v_search is null
        or p.name ilike '%' || v_search || '%'
        or coalesce(p.client_name, '') ilike '%' || v_search || '%'
      )
  ),
  latest_versions as materialized (
    select
      p.id as project_id,
      p.tenant_id,
      p.name as project_name,
      p.reference as project_reference,
      p.client_name as project_client,
      p.updated_at as project_updated_at,
      p.is_favorite,
      lv.id as current_version_id,
      lv.version_number as current_version_number,
      lv.status as current_status,
      lv.total_ht_cents as current_total_ht_cents,
      lv.updated_at as version_updated_at,
      lv.approval_status as current_approval_status
    from scoped_projects p
    left join lateral (
      select
        ev.id,
        ev.version_number,
        ev.status,
        ev.total_ht_cents,
        ev.updated_at,
        ev.approval_status
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
  ),
  paged_projects as materialized (
    select
      lv.*,
      coalesce(lv.version_updated_at, lv.project_updated_at) as effective_updated_at,
      lower(lv.project_name) as normalized_project_name,
      coalesce(lv.current_total_ht_cents, 0) as effective_total_ht_cents
    from latest_versions lv
    where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or (
        lv.current_version_id is not null
        and lv.current_status = any(p_statuses)
      )
      or (
        lv.current_version_id is null
        and 'draft'::public.estimate_status = any(p_statuses)
      )
    )
      and (
        p_cursor_project_id is null
        or (
          v_sort_by = 'updatedAt'
          and (
            (v_sort_dir = 'desc' and (coalesce(lv.version_updated_at, lv.project_updated_at), lv.project_id) < (p_cursor_updated_at, p_cursor_project_id))
            or (v_sort_dir = 'asc' and (coalesce(lv.version_updated_at, lv.project_updated_at), lv.project_id) > (p_cursor_updated_at, p_cursor_project_id))
          )
        )
        or (
          v_sort_by = 'name'
          and (
            (v_sort_dir = 'desc' and (lower(lv.project_name), lv.project_id) < (lower(p_cursor_name), p_cursor_project_id))
            or (v_sort_dir = 'asc' and (lower(lv.project_name), lv.project_id) > (lower(p_cursor_name), p_cursor_project_id))
          )
        )
        or (
          v_sort_by = 'totalHtCents'
          and (
            (v_sort_dir = 'desc' and (coalesce(lv.current_total_ht_cents, 0), lv.project_id) < (p_cursor_total_ht_cents, p_cursor_project_id))
            or (v_sort_dir = 'asc' and (coalesce(lv.current_total_ht_cents, 0), lv.project_id) > (p_cursor_total_ht_cents, p_cursor_project_id))
          )
        )
      )
    order by
      case when v_sort_by = 'updatedAt' and v_sort_dir = 'asc' then coalesce(lv.version_updated_at, lv.project_updated_at) end asc,
      case when v_sort_by = 'updatedAt' and v_sort_dir = 'asc' then lv.project_id end asc,
      case when v_sort_by = 'updatedAt' and v_sort_dir = 'desc' then coalesce(lv.version_updated_at, lv.project_updated_at) end desc,
      case when v_sort_by = 'updatedAt' and v_sort_dir = 'desc' then lv.project_id end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc' then lower(lv.project_name) end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'asc' then lv.project_id end asc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then lower(lv.project_name) end desc,
      case when v_sort_by = 'name' and v_sort_dir = 'desc' then lv.project_id end desc,
      case when v_sort_by = 'totalHtCents' and v_sort_dir = 'asc' then coalesce(lv.current_total_ht_cents, 0) end asc,
      case when v_sort_by = 'totalHtCents' and v_sort_dir = 'asc' then lv.project_id end asc,
      case when v_sort_by = 'totalHtCents' and v_sort_dir = 'desc' then coalesce(lv.current_total_ht_cents, 0) end desc,
      case when v_sort_by = 'totalHtCents' and v_sort_dir = 'desc' then lv.project_id end desc
    limit v_limit
  )
  select
    p.project_id,
    p.project_name,
    p.project_reference,
    p.project_client,
    vc.version_count,
    (p.current_version_id is not null) as has_current_version,
    p.current_version_id,
    p.current_version_number,
    p.current_status,
    p.current_total_ht_cents,
    p.effective_updated_at as current_updated_at,
    av.id as accepted_version_id,
    av.version_number as accepted_version_number,
    (di.id is not null) as has_dpgf,
    p.current_approval_status,
    p.is_favorite
  from paged_projects p
  left join lateral (
    select count(*)::integer as version_count
    from public.estimate_versions ev
    where ev.tenant_id = p.tenant_id
      and ev.project_id = p.project_id
  ) vc on true
  left join lateral (
    select ev.id, ev.version_number
    from public.estimate_versions ev
    where ev.tenant_id = p.tenant_id
      and ev.project_id = p.project_id
      and ev.status = 'accepted'::public.estimate_status
    order by ev.version_number desc, ev.updated_at desc, ev.id desc
    limit 1
  ) av on true
  left join lateral (
    select d.id
    from public.dpgf_imports d
    where d.tenant_id = p.tenant_id
      and d.project_id = p.project_id
    limit 1
  ) di on true
  order by
    case when v_sort_by = 'updatedAt' and v_sort_dir = 'asc' then p.effective_updated_at end asc,
    case when v_sort_by = 'updatedAt' and v_sort_dir = 'asc' then p.project_id end asc,
    case when v_sort_by = 'updatedAt' and v_sort_dir = 'desc' then p.effective_updated_at end desc,
    case when v_sort_by = 'updatedAt' and v_sort_dir = 'desc' then p.project_id end desc,
    case when v_sort_by = 'name' and v_sort_dir = 'asc' then p.normalized_project_name end asc,
    case when v_sort_by = 'name' and v_sort_dir = 'asc' then p.project_id end asc,
    case when v_sort_by = 'name' and v_sort_dir = 'desc' then p.normalized_project_name end desc,
    case when v_sort_by = 'name' and v_sort_dir = 'desc' then p.project_id end desc,
    case when v_sort_by = 'totalHtCents' and v_sort_dir = 'asc' then p.effective_total_ht_cents end asc,
    case when v_sort_by = 'totalHtCents' and v_sort_dir = 'asc' then p.project_id end asc,
    case when v_sort_by = 'totalHtCents' and v_sort_dir = 'desc' then p.effective_total_ht_cents end desc,
    case when v_sort_by = 'totalHtCents' and v_sort_dir = 'desc' then p.project_id end desc;
end;
$$;

revoke execute on function public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  text,
  integer,
  uuid,
  text,
  text,
  boolean
) from public, anon;

grant execute on function public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  text,
  integer,
  uuid,
  text,
  text,
  boolean
) to authenticated;