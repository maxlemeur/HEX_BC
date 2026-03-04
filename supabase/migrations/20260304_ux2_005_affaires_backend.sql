-- UX2-005: backend foundation for affaires list (Hub Affaire).

create index if not exists estimate_versions_tenant_project_version_updated_id_idx
  on public.estimate_versions (
    tenant_id,
    project_id,
    version_number desc,
    updated_at desc,
    id desc
  );

create index if not exists estimate_versions_tenant_project_accepted_version_updated_id_idx
  on public.estimate_versions (
    tenant_id,
    project_id,
    version_number desc,
    updated_at desc,
    id desc
  )
  where status = 'accepted'::public.estimate_status;

drop function if exists public.list_affaires_page(
  uuid,
  uuid,
  integer,
  text,
  public.estimate_status[],
  timestamptz,
  uuid
);

create or replace function public.list_affaires_page(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_limit integer default 20,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_cursor_updated_at timestamptz default null,
  p_cursor_project_id uuid default null
)
returns table (
  project_id uuid,
  project_name text,
  project_reference text,
  project_client text,
  version_count integer,
  current_version_id uuid,
  current_version_number integer,
  current_status public.estimate_status,
  current_total_ht_cents integer,
  current_updated_at timestamptz,
  accepted_version_id uuid,
  accepted_version_number integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 20), 101));
  v_search text := nullif(btrim(p_search), '');
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

  if p_cursor_updated_at is null and p_cursor_project_id is not null then
    raise exception using message = 'AFFAIRES_CURSOR_INVALID';
  end if;

  return query
  with scoped_projects as (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.reference,
      p.client_name
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
      lv.id as current_version_id,
      lv.version_number as current_version_number,
      lv.status as current_status,
      lv.total_ht_cents as current_total_ht_cents,
      lv.updated_at as current_updated_at,
      av.id as accepted_version_id,
      av.version_number as accepted_version_number
    from scoped_projects p
    join lateral (
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
    s.current_version_id,
    s.current_version_number,
    s.current_status,
    s.current_total_ht_cents,
    s.current_updated_at,
    s.accepted_version_id,
    s.accepted_version_number
  from searched s
  where (
    p_statuses is null
    or cardinality(p_statuses) = 0
    or s.current_status = any(p_statuses)
  )
    and (
      p_cursor_updated_at is null
      or p_cursor_project_id is null
      or (s.current_updated_at, s.project_id) < (p_cursor_updated_at, p_cursor_project_id)
    )
  order by s.current_updated_at desc, s.project_id desc
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
  uuid
)
to authenticated;

drop function if exists public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[]
);

create or replace function public.get_affaires_counters(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_search text default null,
  p_statuses public.estimate_status[] default null
)
returns table (
  total_count integer,
  filtered_count integer,
  draft_count integer,
  sent_count integer,
  accepted_count integer,
  archived_count integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_search text := nullif(btrim(p_search), '');
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

  return query
  with scoped_projects as (
    select
      p.id,
      p.tenant_id,
      p.name,
      p.client_name
    from public.estimate_projects p
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
      and (v_is_admin or p.user_id = p_owner_user_id)
  ),
  latest as (
    select
      p.id as project_id,
      p.name as project_name,
      p.client_name as project_client,
      lv.status as current_status
    from scoped_projects p
    join lateral (
      select ev.status
      from public.estimate_versions ev
      where ev.tenant_id = p.tenant_id
        and ev.project_id = p.id
      order by ev.version_number desc, ev.updated_at desc, ev.id desc
      limit 1
    ) lv on true
  ),
  searched as (
    select *
    from latest l
    where (
      v_search is null
      or l.project_name ilike '%' || v_search || '%'
      or coalesce(l.project_client, '') ilike '%' || v_search || '%'
    )
  ),
  filtered as (
    select *
    from searched s
    where (
      p_statuses is null
      or cardinality(p_statuses) = 0
      or s.current_status = any(p_statuses)
    )
  )
  select
    (select count(*)::integer from latest) as total_count,
    (select count(*)::integer from filtered) as filtered_count,
    (select count(*)::integer from searched where current_status = 'draft'::public.estimate_status) as draft_count,
    (select count(*)::integer from searched where current_status = 'sent'::public.estimate_status) as sent_count,
    (select count(*)::integer from searched where current_status = 'accepted'::public.estimate_status) as accepted_count,
    (select count(*)::integer from searched where current_status = 'archived'::public.estimate_status) as archived_count;
end;
$$;

grant execute on function public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[]
)
to authenticated;
