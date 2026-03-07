-- V3-019: reviewer triage state for the cross-affaire approval queue.
-- Separate from estimate_review_cycles (which has strict immutability triggers).

create table if not exists public.approval_queue_reviewer_states (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id()
    references public.tenants(id) on delete restrict,
  cycle_id uuid not null
    references public.estimate_review_cycles(id) on delete cascade,
  reviewer_id uuid not null
    references public.profiles(id) on delete cascade,
  state text not null
    check (state in ('seen', 'review_laurent', 'blocking', 'acceptable'))
);

create unique index if not exists approval_queue_reviewer_states_tenant_cycle_reviewer_idx
  on public.approval_queue_reviewer_states (tenant_id, cycle_id, reviewer_id);

create index if not exists approval_queue_reviewer_states_tenant_cycle_idx
  on public.approval_queue_reviewer_states (tenant_id, cycle_id);

drop trigger if exists set_approval_queue_reviewer_states_updated_at on public.approval_queue_reviewer_states;
create trigger set_approval_queue_reviewer_states_updated_at
  before update on public.approval_queue_reviewer_states
  for each row execute procedure public.set_updated_at();

alter table public.approval_queue_reviewer_states enable row level security;

drop policy if exists "Admin/director can view approval queue states" on public.approval_queue_reviewer_states;
create policy "Admin/director can view approval queue states"
  on public.approval_queue_reviewer_states
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  );

drop policy if exists "Admin/director can insert approval queue states" on public.approval_queue_reviewer_states;
create policy "Admin/director can insert approval queue states"
  on public.approval_queue_reviewer_states
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and reviewer_id = (select auth.uid())
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  );

drop policy if exists "Admin/director can update approval queue states" on public.approval_queue_reviewer_states;
create policy "Admin/director can update approval queue states"
  on public.approval_queue_reviewer_states
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and reviewer_id = (select auth.uid())
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and reviewer_id = (select auth.uid())
    and (
      select public.has_tenant_role(
        tenant_id,
        array['admin'::public.tenant_role, 'director'::public.tenant_role]
      )
    )
  );

-- RPC: list_approval_queue
-- Returns open review cycles with aggregated risk alerts, sorted by the caller's preference.
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
language sql
stable
security definer
set search_path = public
as $$
  with open_cycles as (
    select
      c.id as cycle_id,
      c.version_id,
      c.requested_at,
      c.submission_message,
      c.tenant_id
    from public.estimate_review_cycles c
    where c.decision is null
      and c.tenant_id = (select public.current_tenant_id())
  ),
  cycle_versions as (
    select
      oc.cycle_id,
      oc.requested_at,
      oc.submission_message,
      v.id as version_id,
      v.project_id,
      v.version_number,
      v.total_ht_cents as amount_ht_cents,
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
    where qs.tenant_id = (select public.current_tenant_id())
      and qs.reviewer_id = (select auth.uid())
  ),
  risk_agg as (
    select
      ra.version_id,
      sum(ra.cnt) as exception_count,
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
        and era.tenant_id = (select public.current_tenant_id())
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
$$;
