begin;
set local lock_timeout = '5s';

alter table public.takeoff_jobs validate constraint takeoff_jobs_api_mandate_shape;
commit;
