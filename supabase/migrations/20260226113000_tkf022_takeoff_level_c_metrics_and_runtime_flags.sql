-- TKF-022: Level C runtime flags and run metrics observability table.

create table if not exists public.takeoff_run_metrics (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  result_id uuid references public.takeoff_results(id) on delete cascade,
  level public.takeoff_job_level not null,
  provider text not null default 'gemini',
  model text not null,
  chunk_index integer check (chunk_index is null or chunk_index >= 0),
  chunk_start_page integer check (chunk_start_page is null or chunk_start_page > 0),
  chunk_end_page integer check (chunk_end_page is null or chunk_end_page > 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  reasoning_tokens integer check (reasoning_tokens is null or reasoning_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  total_tokens integer check (total_tokens is null or total_tokens >= 0),
  cost_cents integer check (cost_cents is null or cost_cents >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  timed_out boolean not null default false,
  budget_exceeded boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  constraint takeoff_run_metrics_chunk_page_range_check
    check (
      (chunk_start_page is null and chunk_end_page is null)
      or (
        chunk_start_page is not null
        and chunk_end_page is not null
        and chunk_start_page <= chunk_end_page
      )
    )
);

create index if not exists takeoff_run_metrics_tenant_job_chunk_idx
  on public.takeoff_run_metrics (tenant_id, job_id, chunk_index);
create index if not exists takeoff_run_metrics_tenant_created_at_idx
  on public.takeoff_run_metrics (tenant_id, created_at desc);
create index if not exists takeoff_run_metrics_job_created_at_idx
  on public.takeoff_run_metrics (job_id, created_at desc);

alter table public.takeoff_run_metrics enable row level security;
alter table public.takeoff_run_metrics force row level security;

drop policy if exists "Current tenant can select takeoff run metrics" on public.takeoff_run_metrics;
drop policy if exists "Current tenant can insert takeoff run metrics" on public.takeoff_run_metrics;
drop policy if exists "Current tenant can update takeoff run metrics" on public.takeoff_run_metrics;
drop policy if exists "Current tenant can delete takeoff run metrics" on public.takeoff_run_metrics;

create policy "Current tenant can select takeoff run metrics"
  on public.takeoff_run_metrics
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_run_metrics.job_id
        and tj.tenant_id = takeoff_run_metrics.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_run_metrics.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_run_metrics.result_id
          and tr.tenant_id = takeoff_run_metrics.tenant_id
          and tr.job_id = takeoff_run_metrics.job_id
      )
    )
  );

create policy "Current tenant can insert takeoff run metrics"
  on public.takeoff_run_metrics
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_run_metrics.job_id
        and tj.tenant_id = takeoff_run_metrics.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_run_metrics.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_run_metrics.result_id
          and tr.tenant_id = takeoff_run_metrics.tenant_id
          and tr.job_id = takeoff_run_metrics.job_id
      )
    )
  );

create policy "Current tenant can update takeoff run metrics"
  on public.takeoff_run_metrics
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_run_metrics.job_id
        and tj.tenant_id = takeoff_run_metrics.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_run_metrics.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_run_metrics.result_id
          and tr.tenant_id = takeoff_run_metrics.tenant_id
          and tr.job_id = takeoff_run_metrics.job_id
      )
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_run_metrics.job_id
        and tj.tenant_id = takeoff_run_metrics.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_run_metrics.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_run_metrics.result_id
          and tr.tenant_id = takeoff_run_metrics.tenant_id
          and tr.job_id = takeoff_run_metrics.job_id
      )
    )
  );

create policy "Current tenant can delete takeoff run metrics"
  on public.takeoff_run_metrics
  for delete
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_run_metrics.job_id
        and tj.tenant_id = takeoff_run_metrics.tenant_id
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, tj.tenant_id))
    )
    and (
      takeoff_run_metrics.result_id is null
      or exists (
        select 1
        from public.takeoff_results tr
        where tr.id = takeoff_run_metrics.result_id
          and tr.tenant_id = takeoff_run_metrics.tenant_id
          and tr.job_id = takeoff_run_metrics.job_id
      )
    )
  );

insert into public.feature_flags (tenant_id, flag_key, enabled, value)
select t.id, f.key, true, f.value
from public.tenants t
cross join (
  values
    ('TAKEOFF_C_TIMEOUT_MS', '300000'),
    ('TAKEOFF_C_MAX_TOTAL_TOKENS', '400000'),
    ('TAKEOFF_C_MAX_COST_CENTS', '2500')
) as f(key, value)
on conflict (tenant_id, flag_key) do nothing;

create or replace function public.bootstrap_takeoff_feature_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.feature_flags (tenant_id, flag_key, enabled, value)
  values
    (new.id, 'TAKEOFF_MODULE_ENABLED', false, null),
    (new.id, 'TAKEOFF_C_CHUNK_THRESHOLD_PAGES', true, '15'),
    (new.id, 'TAKEOFF_C_CHUNK_SIZE_PAGES', true, '10'),
    (new.id, 'TAKEOFF_C_CHUNK_OVERLAP_PAGES', true, '2'),
    (new.id, 'TAKEOFF_C_MAX_PDF_PAGES', true, '200'),
    (new.id, 'TAKEOFF_C_TIMEOUT_MS', true, '300000'),
    (new.id, 'TAKEOFF_C_MAX_TOTAL_TOKENS', true, '400000'),
    (new.id, 'TAKEOFF_C_MAX_COST_CENTS', true, '2500')
  on conflict (tenant_id, flag_key) do nothing;

  return new;
end;
$$;
