-- Additive access paths for the dashboard's standalone takeoff job poll.
-- Keep recent ends in disjoint date ranges so the session client can use a
-- range and a stable tie-breaker directly on each indexed column under RLS.
create index takeoff_jobs_progress_live_idx
  on public.takeoff_jobs (tenant_id, created_at desc, id desc)
  where launch_request_id is null and completed_at is null;

create index takeoff_jobs_progress_analysis_finished_idx
  on public.takeoff_jobs (tenant_id, analysis_finished_at desc, id desc)
  where launch_request_id is null and analysis_finished_at is not null;

create index takeoff_jobs_progress_completed_idx
  on public.takeoff_jobs (tenant_id, completed_at desc, id desc)
  where launch_request_id is null and analysis_finished_at is null and completed_at is not null;

create index takeoff_jobs_progress_legacy_end_idx
  on public.takeoff_jobs (tenant_id, updated_at desc, id desc)
  where launch_request_id is null and analysis_finished_at is null and completed_at is null;
