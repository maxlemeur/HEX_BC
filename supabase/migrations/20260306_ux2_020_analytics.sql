-- UX2-020: backend analytics foundation (FS-B)

create index if not exists estimate_projects_tenant_user_created_at_idx
  on public.estimate_projects (tenant_id, user_id, created_at desc);

create index if not exists estimate_projects_tenant_created_at_idx
  on public.estimate_projects (tenant_id, created_at desc);

create index if not exists estimate_versions_tenant_status_project_updated_idx
  on public.estimate_versions (tenant_id, status, project_id, updated_at desc)
  where status in ('sent'::public.estimate_status, 'accepted'::public.estimate_status);

drop function if exists public.get_chiffreur_analytics_kpis(uuid, uuid);

create or replace function public.get_chiffreur_analytics_kpis(
  p_tenant_id uuid,
  p_owner_user_id uuid default null
)
returns table (
  active_affaires_count integer,
  accepted_revenue_cents bigint,
  accepted_versions_count integer,
  sent_versions_count integer,
  acceptance_rate numeric,
  avg_days_to_first_acceptance numeric
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_effective_owner_user_id uuid;
begin
  if p_tenant_id is null then
    raise exception using message = 'ANALYTICS_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'ANALYTICS_TENANT_MISMATCH';
  end if;

  v_is_admin := coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  );

  if not v_is_admin then
    if p_owner_user_id is not null and p_owner_user_id is distinct from (select auth.uid()) then
      raise exception using message = 'ANALYTICS_OWNER_SCOPE_INVALID';
    end if;

    v_effective_owner_user_id := (select auth.uid());
  else
    v_effective_owner_user_id := p_owner_user_id;
  end if;

  return query
  with scoped_projects_all as (
    select
      p.id,
      p.tenant_id,
      p.user_id,
      p.created_at,
      p.is_archived
    from public.estimate_projects p
    where p.tenant_id = p_tenant_id
      and (
        v_effective_owner_user_id is null
        or p.user_id = v_effective_owner_user_id
      )
  ),
  active_projects as (
    select p.id
    from scoped_projects_all p
    where p.is_archived = false
  ),
  version_rollup as (
    select
      coalesce(
        sum(
          case
            when ev.status = 'accepted'::public.estimate_status
              then ev.total_ht_cents
            else 0
          end
        ),
        0
      )::bigint as accepted_revenue_cents,
      count(*) filter (
        where ev.status = 'accepted'::public.estimate_status
      )::integer as accepted_versions_count,
      count(*) filter (
        where ev.status = 'sent'::public.estimate_status
      )::integer as sent_versions_count
    from public.estimate_versions ev
    join scoped_projects_all p
      on p.id = ev.project_id
     and p.tenant_id = ev.tenant_id
    where ev.tenant_id = p_tenant_id
      and ev.status in ('sent'::public.estimate_status, 'accepted'::public.estimate_status)
  ),
  accepted_version_timestamps as (
    select
      ev.project_id,
      coalesce(min(eve.occurred_at), ev.updated_at) as accepted_at
    from public.estimate_versions ev
    join scoped_projects_all p
      on p.id = ev.project_id
     and p.tenant_id = ev.tenant_id
    left join public.estimate_version_events eve
      on eve.estimate_version_id = ev.id
     and eve.tenant_id = ev.tenant_id
     and eve.event_type = 'accepted'
    where ev.tenant_id = p_tenant_id
      and ev.status = 'accepted'::public.estimate_status
    group by ev.project_id, ev.id, ev.updated_at
  ),
  first_acceptance_per_project as (
    select
      av.project_id,
      min(av.accepted_at) as first_accepted_at
    from accepted_version_timestamps av
    group by av.project_id
  ),
  delay_agg as (
    select
      avg(
        greatest(
          extract(epoch from (fa.first_accepted_at - p.created_at)),
          0
        ) / 86400.0
      ) as avg_days_to_first_acceptance
    from first_acceptance_per_project fa
    join scoped_projects_all p
      on p.id = fa.project_id
  )
  select
    (select count(*)::integer from active_projects) as active_affaires_count,
    vr.accepted_revenue_cents,
    vr.accepted_versions_count,
    vr.sent_versions_count,
    case
      when (vr.accepted_versions_count + vr.sent_versions_count) > 0
        then round(
          (
            vr.accepted_versions_count::numeric * 100.0
          ) / (vr.accepted_versions_count + vr.sent_versions_count),
          1
        )
      else 0::numeric
    end as acceptance_rate,
    case
      when da.avg_days_to_first_acceptance is null then null
      else round(da.avg_days_to_first_acceptance::numeric, 1)
    end as avg_days_to_first_acceptance
  from version_rollup vr
  cross join delay_agg da;
end;
$$;

grant execute on function public.get_chiffreur_analytics_kpis(uuid, uuid)
to authenticated;

drop function if exists public.list_chiffreur_analytics_trend(uuid, uuid, integer);

create or replace function public.list_chiffreur_analytics_trend(
  p_tenant_id uuid,
  p_owner_user_id uuid default null,
  p_months integer default 6
)
returns table (
  month_key text,
  created_count integer,
  accepted_count integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_is_admin boolean;
  v_effective_owner_user_id uuid;
  v_months integer := greatest(1, least(coalesce(p_months, 6), 24));
  v_current_month_start timestamptz := date_trunc('month', timezone('UTC', now()));
  v_first_month_start timestamptz :=
    date_trunc('month', timezone('UTC', now())) - make_interval(months => greatest(1, least(coalesce(p_months, 6), 24)) - 1);
begin
  if p_tenant_id is null then
    raise exception using message = 'ANALYTICS_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'ANALYTICS_TENANT_MISMATCH';
  end if;

  v_is_admin := coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  );

  if not v_is_admin then
    if p_owner_user_id is not null and p_owner_user_id is distinct from (select auth.uid()) then
      raise exception using message = 'ANALYTICS_OWNER_SCOPE_INVALID';
    end if;

    v_effective_owner_user_id := (select auth.uid());
  else
    v_effective_owner_user_id := p_owner_user_id;
  end if;

  return query
  with scoped_projects_all as (
    select
      p.id,
      p.tenant_id,
      p.user_id,
      p.created_at
    from public.estimate_projects p
    where p.tenant_id = p_tenant_id
      and (
        v_effective_owner_user_id is null
        or p.user_id = v_effective_owner_user_id
      )
  ),
  months as (
    select generate_series(
      v_first_month_start,
      v_current_month_start,
      interval '1 month'
    ) as month_start
  ),
  created_counts as (
    select
      date_trunc('month', timezone('UTC', p.created_at)) as month_start,
      count(*)::integer as created_count
    from scoped_projects_all p
    where p.created_at >= v_first_month_start
      and p.created_at < (v_current_month_start + interval '1 month')
    group by 1
  ),
  accepted_version_timestamps as (
    select
      ev.project_id,
      coalesce(min(eve.occurred_at), ev.updated_at) as accepted_at
    from public.estimate_versions ev
    join scoped_projects_all p
      on p.id = ev.project_id
     and p.tenant_id = ev.tenant_id
    left join public.estimate_version_events eve
      on eve.estimate_version_id = ev.id
     and eve.tenant_id = ev.tenant_id
     and eve.event_type = 'accepted'
    where ev.tenant_id = p_tenant_id
      and ev.status = 'accepted'::public.estimate_status
    group by ev.project_id, ev.id, ev.updated_at
  ),
  first_acceptance_per_project as (
    select
      av.project_id,
      min(av.accepted_at) as first_accepted_at
    from accepted_version_timestamps av
    group by av.project_id
  ),
  accepted_counts as (
    select
      date_trunc('month', timezone('UTC', fa.first_accepted_at)) as month_start,
      count(*)::integer as accepted_count
    from first_acceptance_per_project fa
    where fa.first_accepted_at >= v_first_month_start
      and fa.first_accepted_at < (v_current_month_start + interval '1 month')
    group by 1
  )
  select
    to_char(m.month_start, 'YYYY-MM') as month_key,
    coalesce(cc.created_count, 0) as created_count,
    coalesce(ac.accepted_count, 0) as accepted_count
  from months m
  left join created_counts cc
    on cc.month_start = m.month_start
  left join accepted_counts ac
    on ac.month_start = m.month_start
  order by m.month_start asc
  limit v_months;
end;
$$;

grant execute on function public.list_chiffreur_analytics_trend(uuid, uuid, integer)
to authenticated;

drop function if exists public.list_chiffreur_analytics_owners(uuid);

create or replace function public.list_chiffreur_analytics_owners(
  p_tenant_id uuid
)
returns table (
  owner_user_id uuid,
  owner_name text,
  owner_role public.tenant_role,
  active_affaires_count integer
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  if p_tenant_id is null then
    raise exception using message = 'ANALYTICS_TENANT_REQUIRED';
  end if;

  if p_tenant_id is distinct from public.current_tenant_id() then
    raise exception using message = 'ANALYTICS_TENANT_MISMATCH';
  end if;

  if not coalesce(
    public.has_tenant_role(p_tenant_id, array['admin'::public.tenant_role]),
    false
  ) then
    raise exception using message = 'ANALYTICS_ADMIN_REQUIRED';
  end if;

  return query
  with owner_memberships as (
    select
      tm.user_id,
      tm.role
    from public.tenant_memberships tm
    where tm.tenant_id = p_tenant_id
      and tm.role in ('engineer'::public.tenant_role, 'admin'::public.tenant_role)
  ),
  active_projects as (
    select
      p.user_id,
      count(*)::integer as active_affaires_count
    from public.estimate_projects p
    where p.tenant_id = p_tenant_id
      and p.is_archived = false
    group by p.user_id
  )
  select
    om.user_id as owner_user_id,
    coalesce(nullif(trim(profile.full_name), ''), profile.work_email, om.user_id::text) as owner_name,
    om.role as owner_role,
    coalesce(ap.active_affaires_count, 0)::integer as active_affaires_count
  from owner_memberships om
  left join active_projects ap
    on ap.user_id = om.user_id
  left join public.profiles profile
    on profile.id = om.user_id
  order by coalesce(ap.active_affaires_count, 0) desc, owner_name asc;
end;
$$;

grant execute on function public.list_chiffreur_analytics_owners(uuid)
to authenticated;
