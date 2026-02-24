-- TKF-014: add source tracking fields on estimate items for takeoff provenance.

alter table if exists public.estimate_items
  add column if not exists source_provider text default 'manual',
  add column if not exists source_job_id uuid,
  add column if not exists source_file_name text,
  add column if not exists source_page integer;

alter table if exists public.estimate_items
  alter column source_provider set default 'manual';

alter table if exists public.estimate_items
  drop constraint if exists estimate_items_source_job_id_fkey;

alter table if exists public.estimate_items
  add constraint estimate_items_source_job_id_fkey
  foreign key (source_job_id)
  references public.takeoff_jobs(id)
  on delete set null;

create index if not exists estimate_items_source_job_id_idx
  on public.estimate_items (source_job_id);

create index if not exists estimate_items_tenant_source_job_id_idx
  on public.estimate_items (tenant_id, source_job_id);
