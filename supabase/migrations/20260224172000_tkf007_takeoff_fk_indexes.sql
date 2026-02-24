-- TKF-007: add covering indexes for takeoff foreign keys flagged by advisor.

create index if not exists takeoff_jobs_estimate_version_id_idx
  on public.takeoff_jobs (estimate_version_id);

create index if not exists takeoff_jobs_created_by_idx
  on public.takeoff_jobs (created_by);

create index if not exists takeoff_results_job_id_idx
  on public.takeoff_results (job_id);

create index if not exists takeoff_items_job_id_idx
  on public.takeoff_items (job_id);

create index if not exists takeoff_items_result_id_idx
  on public.takeoff_items (result_id);

create index if not exists takeoff_items_verified_by_idx
  on public.takeoff_items (verified_by);
