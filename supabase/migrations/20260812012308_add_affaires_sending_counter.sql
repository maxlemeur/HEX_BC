-- Keep the affaires status buckets independent from the selected status filter.
-- The previous client-side subtraction mixed `filtered_count` with unfiltered
-- buckets and therefore reported an incorrect `sending` count.

drop function if exists public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[],
  boolean
);

create function public.get_affaires_counters(
  p_tenant_id uuid,
  p_owner_user_id uuid,
  p_search text default null,
  p_statuses public.estimate_status[] default null,
  p_favorites_only boolean default false
)
returns table (
  total_count integer,
  filtered_count integer,
  draft_count integer,
  sending_count integer,
  sent_count integer,
  accepted_count integer,
  archived_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_search text := nullif(pg_catalog.btrim(p_search), '');
  v_favorites_only boolean := pg_catalog.coalesce(p_favorites_only, false);
  v_is_admin boolean;
begin
  if p_tenant_id is null then
    raise exception using message = 'AFFAIRES_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'AFFAIRES_TENANT_MISMATCH';
  end if;

  v_is_admin := pg_catalog.coalesce(
    public.has_tenant_role(
      p_tenant_id,
      array['admin'::public.tenant_role]
    ),
    false
  );

  if not v_is_admin
    and p_owner_user_id is not null
    and p_owner_user_id is distinct from auth.uid()
  then
    raise exception using message = 'AFFAIRES_OWNER_SCOPE_INVALID';
  end if;

  return query
  with scoped_projects as (
    select
      project.id,
      project.tenant_id,
      project.name,
      project.client_name,
      pg_catalog.coalesce(favorite.project_id is not null, false) as is_favorite
    from public.estimate_projects as project
    left join public.user_favorite_projects as favorite
      on favorite.tenant_id = project.tenant_id
      and favorite.user_id = auth.uid()
      and favorite.project_id = project.id
    where project.tenant_id = p_tenant_id
      and project.is_archived = false
      and (
        v_is_admin
        or p_owner_user_id is null
        or project.user_id = p_owner_user_id
      )
  ),
  total_latest as (
    select
      project.id as project_id,
      pg_catalog.coalesce(
        latest_version.status,
        'draft'::public.estimate_status
      ) as effective_status
    from scoped_projects as project
    left join lateral (
      select version.status
      from public.estimate_versions as version
      where version.tenant_id = project.tenant_id
        and version.project_id = project.id
      order by
        version.version_number desc,
        version.updated_at desc,
        version.id desc
      limit 1
    ) as latest_version on true
  ),
  effective_projects as (
    select *
    from scoped_projects as project
    where not v_favorites_only or project.is_favorite
  ),
  latest as (
    select
      project.id as project_id,
      project.name as project_name,
      project.client_name as project_client,
      pg_catalog.coalesce(
        latest_version.status,
        'draft'::public.estimate_status
      ) as effective_status
    from effective_projects as project
    left join lateral (
      select version.status
      from public.estimate_versions as version
      where version.tenant_id = project.tenant_id
        and version.project_id = project.id
      order by
        version.version_number desc,
        version.updated_at desc,
        version.id desc
      limit 1
    ) as latest_version on true
  ),
  searched as (
    select *
    from latest
    where v_search is null
      or project_name ilike '%' || v_search || '%'
      or pg_catalog.coalesce(project_client, '') ilike '%' || v_search || '%'
  ),
  filtered as (
    select *
    from searched
    where p_statuses is null
      or pg_catalog.cardinality(p_statuses) = 0
      or effective_status = any(p_statuses)
  )
  select
    (select pg_catalog.count(*)::integer from total_latest),
    (select pg_catalog.count(*)::integer from filtered),
    (select pg_catalog.count(*)::integer from searched where effective_status = 'draft'::public.estimate_status),
    (select pg_catalog.count(*)::integer from searched where effective_status = 'sending'::public.estimate_status),
    (select pg_catalog.count(*)::integer from searched where effective_status = 'sent'::public.estimate_status),
    (select pg_catalog.count(*)::integer from searched where effective_status = 'accepted'::public.estimate_status),
    (select pg_catalog.count(*)::integer from searched where effective_status = 'archived'::public.estimate_status);
end;
$$;

revoke all on function public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[],
  boolean
) from public, anon;
grant execute on function public.get_affaires_counters(
  uuid,
  uuid,
  text,
  public.estimate_status[],
  boolean
) to authenticated, service_role;
