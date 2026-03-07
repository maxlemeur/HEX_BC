alter table public.takeoff_jobs
  add column if not exists plan_set_id uuid;

alter table public.takeoff_jobs
  drop constraint if exists takeoff_jobs_plan_set_id_fkey;

alter table public.takeoff_jobs
  add constraint takeoff_jobs_plan_set_id_fkey
  foreign key (plan_set_id)
  references public.plan_sets(id) on delete no action;

create index if not exists takeoff_jobs_plan_set_id_idx
  on public.takeoff_jobs (plan_set_id)
  where plan_set_id is not null;

comment on column public.takeoff_jobs.plan_set_id is
  'Optional reference to the plan set used as source for this job (V3-014 auto-proposition).';
