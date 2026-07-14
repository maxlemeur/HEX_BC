-- TKF-012: Add exclusion_reason to takeoff_items
-- Stores the mandatory reason when an item is excluded (is_excluded = true).

alter table public.takeoff_items
  add column if not exists exclusion_reason text;

-- Consolidated from 20260225120000_tkf026_takeoff_retry_queue.sql to keep migration versions unique.
-- TKF-026: async retry scheduling metadata for takeoff jobs.

alter table if exists public.takeoff_jobs
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error_at timestamptz;

update public.takeoff_jobs
set last_error_at = coalesce(last_error_at, completed_at)
where status = 'failed'
  and last_error_at is null;

create index if not exists takeoff_jobs_retry_queue_idx
  on public.takeoff_jobs (tenant_id, status, next_retry_at, created_at desc)
  where status in ('pending', 'failed');

create index if not exists takeoff_jobs_failed_next_retry_idx
  on public.takeoff_jobs (tenant_id, next_retry_at)
  where status = 'failed';
