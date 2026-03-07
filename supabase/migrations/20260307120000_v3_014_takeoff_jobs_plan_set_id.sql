alter table public.takeoff_jobs
  add column if not exists plan_set_id uuid
  references public.plan_sets(id) on delete set null;

create index if not exists takeoff_jobs_plan_set_id_idx
  on public.takeoff_jobs (plan_set_id)
  where plan_set_id is not null;

comment on column public.takeoff_jobs.plan_set_id is
  'Optional reference to the plan set used as source for this job (V3-014 auto-proposition).';
