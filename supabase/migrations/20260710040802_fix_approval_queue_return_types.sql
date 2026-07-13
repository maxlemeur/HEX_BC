-- Keep the query expressions aligned with the RPC's declared result types.
-- Postgres requires exact types for PL/pgSQL RETURN QUERY columns.
create or replace function public.list_approval_queue(
  p_sort_by text default 'priority'
)
returns table (
  project_id uuid,
  version_id uuid,
  cycle_id uuid,
  project_name text,
  client_name text,
  version_number integer,
  amount_ht_cents bigint,
  margin_bp integer,
  requested_at timestamptz,
  submission_message text,
  comment_count bigint,
  reviewer_state text,
  exception_count bigint,
  max_risk_score integer,
  cause_code_counts jsonb,
  latest_job_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  scoped_tenant_id uuid := public.current_tenant_id();
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;

  if scoped_tenant_id is null then
    raise exception using errcode = '42501', message = 'TENANT_CONTEXT_REQUIRED';
  end if;

  if not (
    select public.has_tenant_role(
      scoped_tenant_id,
      array['admin'::public.tenant_role, 'director'::public.tenant_role]
    )
  ) then
    raise exception using errcode = '42501', message = 'APPROVAL_QUEUE_ACCESS_DENIED';
  end if;

  return query
  with open_cycles as (
    select
      c.id as cycle_id,
      c.version_id,
      c.requested_at,
      c.submission_message,
      c.tenant_id
    from public.estimate_review_cycles c
    where c.decision is null
      and c.tenant_id = scoped_tenant_id
  ),
  cycle_versions as (
    select
      oc.cycle_id,
      oc.requested_at,
      oc.submission_message,
      v.id as version_id,
      v.project_id,
      v.version_number,
      v.total_ht_cents::bigint as amount_ht_cents,
      v.margin_bp
    from open_cycles oc
    join public.estimate_versions v on v.id = oc.version_id and v.tenant_id = oc.tenant_id
  ),
  with_project as (
    select
      cv.*,
      p.name as project_name,
      p.client_name
    from cycle_versions cv
    join public.estimate_projects p on p.id = cv.project_id
  ),
  comments_agg as (
    select
      rc.cycle_id,
      count(*) as comment_count
    from public.estimate_review_comments rc
    join open_cycles oc on oc.cycle_id = rc.cycle_id
    group by rc.cycle_id
  ),
  reviewer_states as (
    select
      qs.cycle_id,
      qs.state as reviewer_state
    from public.approval_queue_reviewer_states qs
    where qs.tenant_id = scoped_tenant_id
      and qs.reviewer_id = current_user_id
  ),
  risk_agg as (
    select
      ra.version_id,
      sum(ra.cnt)::bigint as exception_count,
      max(ra.max_cause_risk_score) as max_risk_score,
      jsonb_object_agg(ra.cause_code, ra.cnt) as cause_code_counts
    from (
      select
        era.version_id,
        era.cause_code,
        count(*) as cnt,
        max(era.risk_score) as max_cause_risk_score
      from public.estimate_risk_alerts era
      join open_cycles oc on oc.version_id = era.version_id
      where era.is_active
        and era.status = 'to_process'
        and era.tenant_id = scoped_tenant_id
      group by era.version_id, era.cause_code
    ) ra
    group by ra.version_id
  ),
  latest_jobs as (
    select distinct on (tj.estimate_version_id)
      tj.estimate_version_id as version_id,
      tj.id as latest_job_id
    from public.takeoff_jobs tj
    join open_cycles oc on oc.version_id = tj.estimate_version_id
    where tj.status in ('completed', 'applied')
    order by tj.estimate_version_id, tj.completed_at desc nulls last
  )
  select
    wp.project_id,
    wp.version_id,
    wp.cycle_id,
    wp.project_name,
    wp.client_name,
    wp.version_number,
    wp.amount_ht_cents,
    wp.margin_bp,
    wp.requested_at,
    wp.submission_message,
    coalesce(ca.comment_count, 0) as comment_count,
    rs.reviewer_state,
    coalesce(ragg.exception_count, 0) as exception_count,
    coalesce(ragg.max_risk_score, 0) as max_risk_score,
    coalesce(ragg.cause_code_counts, '{}'::jsonb) as cause_code_counts,
    lj.latest_job_id
  from with_project wp
  left join comments_agg ca on ca.cycle_id = wp.cycle_id
  left join reviewer_states rs on rs.cycle_id = wp.cycle_id
  left join risk_agg ragg on ragg.version_id = wp.version_id
  left join latest_jobs lj on lj.version_id = wp.version_id
  order by
    case when p_sort_by = 'priority' then coalesce(ragg.max_risk_score, 0) end desc nulls last,
    case when p_sort_by = 'priority' then wp.requested_at end asc,
    case when p_sort_by = 'amount' then wp.amount_ht_cents end desc nulls last,
    case when p_sort_by = 'margin' then wp.margin_bp end asc nulls last,
    case when p_sort_by = 'age' then wp.requested_at end asc,
    wp.requested_at asc;
end;
$$;
