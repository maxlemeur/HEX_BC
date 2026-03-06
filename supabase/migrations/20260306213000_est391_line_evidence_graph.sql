-- EST-391: persistent evidence graph per DPGF line.
-- Persists explainable proofs scoped by version + takeoff job + estimate line,
-- with invalidation / replacement history instead of silent deletes.

create table if not exists public.estimate_line_evidences (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  fingerprint text not null,
  evidence_type text not null
    check (evidence_type in ('dpgf', 'takeoff', 'plan_zone', 'formula', 'price_source', 'comment')),
  evidence_kind text not null
    check (evidence_kind in ('fact', 'hypothesis', 'inference')),
  label text not null,
  source_label text not null,
  source_file_name text,
  source_page integer check (source_page is null or source_page > 0),
  confidence_score numeric(5,4)
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  note text,
  source_record_table text,
  source_record_id uuid,
  payload jsonb not null default '{}'::jsonb,
  author_user_id uuid references public.profiles(id) on delete set null,
  invalidated_at timestamptz,
  invalidated_by uuid references public.profiles(id) on delete set null,
  invalidation_reason text,
  supersedes_evidence_id uuid references public.estimate_line_evidences(id) on delete set null
);

alter table if exists public.estimate_line_evidences
  add column if not exists tenant_id uuid,
  add column if not exists project_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists estimate_item_id uuid,
  add column if not exists fingerprint text,
  add column if not exists evidence_type text,
  add column if not exists evidence_kind text,
  add column if not exists label text,
  add column if not exists source_label text,
  add column if not exists source_file_name text,
  add column if not exists source_page integer,
  add column if not exists confidence_score numeric(5,4),
  add column if not exists note text,
  add column if not exists source_record_table text,
  add column if not exists source_record_id uuid,
  add column if not exists payload jsonb,
  add column if not exists author_user_id uuid,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidated_by uuid,
  add column if not exists invalidation_reason text,
  add column if not exists supersedes_evidence_id uuid;

alter table if exists public.estimate_line_evidences
  alter column tenant_id set default public.current_tenant_id(),
  alter column payload set default '{}'::jsonb,
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_item_id set not null,
  alter column fingerprint set not null,
  alter column evidence_type set not null,
  alter column evidence_kind set not null,
  alter column label set not null,
  alter column source_label set not null,
  alter column payload set not null;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_tenant_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_project_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_project_id_fkey
  foreign key (project_id)
  references public.estimate_projects(id)
  on delete cascade;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_version_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_version_id_fkey
  foreign key (version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_takeoff_job_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_takeoff_job_id_fkey
  foreign key (takeoff_job_id)
  references public.takeoff_jobs(id)
  on delete cascade;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_estimate_item_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_estimate_item_id_fkey
  foreign key (estimate_item_id)
  references public.estimate_items(id)
  on delete cascade;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_author_user_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_author_user_id_fkey
  foreign key (author_user_id)
  references public.profiles(id)
  on delete set null;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_invalidated_by_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_invalidated_by_fkey
  foreign key (invalidated_by)
  references public.profiles(id)
  on delete set null;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_supersedes_evidence_id_fkey;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_supersedes_evidence_id_fkey
  foreign key (supersedes_evidence_id)
  references public.estimate_line_evidences(id)
  on delete set null;

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_payload_object_check;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_payload_object_check
  check (jsonb_typeof(payload) = 'object');

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_fingerprint_not_blank_check;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_fingerprint_not_blank_check
  check (length(btrim(fingerprint)) > 0);

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_label_not_blank_check;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_label_not_blank_check
  check (length(btrim(label)) > 0);

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_source_label_not_blank_check;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_source_label_not_blank_check
  check (length(btrim(source_label)) > 0);

alter table if exists public.estimate_line_evidences
  drop constraint if exists estimate_line_evidences_invalidation_reason_required_check;
alter table if exists public.estimate_line_evidences
  add constraint estimate_line_evidences_invalidation_reason_required_check
  check (
    invalidated_at is null
    or invalidation_reason is not null
  );

create unique index if not exists estimate_line_evidences_active_fingerprint_idx
  on public.estimate_line_evidences (
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    fingerprint
  )
  where invalidated_at is null;

create index if not exists estimate_line_evidences_active_fetch_idx
  on public.estimate_line_evidences (
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    created_at desc
  )
  where invalidated_at is null;

create index if not exists estimate_line_evidences_project_type_idx
  on public.estimate_line_evidences (
    tenant_id,
    project_id,
    evidence_type,
    evidence_kind
  )
  where invalidated_at is null;

create index if not exists estimate_line_evidences_source_lookup_idx
  on public.estimate_line_evidences (
    tenant_id,
    source_record_table,
    source_record_id
  )
  where source_record_id is not null;

create index if not exists estimate_line_evidences_supersedes_idx
  on public.estimate_line_evidences (supersedes_evidence_id)
  where supersedes_evidence_id is not null;

create or replace function public.assign_estimate_line_evidences_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_project_id uuid;
  v_tenant_id uuid;
begin
  select ev.project_id, ev.tenant_id
    into v_project_id, v_tenant_id
  from public.estimate_versions ev
  where ev.id = new.version_id;

  if v_project_id is not null then
    new.project_id := v_project_id;
  end if;

  if v_tenant_id is not null then
    new.tenant_id := v_tenant_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_estimate_line_evidences_scope on public.estimate_line_evidences;
create trigger set_estimate_line_evidences_scope
  before insert or update on public.estimate_line_evidences
  for each row execute procedure public.assign_estimate_line_evidences_scope();

alter table if exists public.estimate_line_evidences enable row level security;
alter table if exists public.estimate_line_evidences force row level security;

drop policy if exists "Current tenant can select estimate line evidences" on public.estimate_line_evidences;
drop policy if exists "Current tenant can insert estimate line evidences" on public.estimate_line_evidences;
drop policy if exists "Current tenant can update estimate line evidences" on public.estimate_line_evidences;

create policy "Current tenant can select estimate line evidences"
  on public.estimate_line_evidences
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = estimate_line_evidences.version_id
      where tj.id = estimate_line_evidences.takeoff_job_id
        and tj.tenant_id = estimate_line_evidences.tenant_id
        and target.project_id = estimate_line_evidences.project_id
        and (
          tj.estimate_version_id = estimate_line_evidences.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_line_evidences.tenant_id
              and tvl.target_version_id = estimate_line_evidences.version_id
              and tvl.takeoff_job_id = estimate_line_evidences.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_line_evidences.version_id, estimate_line_evidences.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_line_evidences.tenant_id))
    )
    and exists (
      select 1
      from public.estimate_items ei
      where ei.id = estimate_line_evidences.estimate_item_id
        and ei.tenant_id = estimate_line_evidences.tenant_id
        and ei.version_id = estimate_line_evidences.version_id
    )
  );

create policy "Current tenant can insert estimate line evidences"
  on public.estimate_line_evidences
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = estimate_line_evidences.version_id
      where tj.id = estimate_line_evidences.takeoff_job_id
        and tj.tenant_id = estimate_line_evidences.tenant_id
        and target.project_id = estimate_line_evidences.project_id
        and (
          tj.estimate_version_id = estimate_line_evidences.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_line_evidences.tenant_id
              and tvl.target_version_id = estimate_line_evidences.version_id
              and tvl.takeoff_job_id = estimate_line_evidences.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_line_evidences.version_id, estimate_line_evidences.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_line_evidences.tenant_id))
    )
    and exists (
      select 1
      from public.estimate_items ei
      where ei.id = estimate_line_evidences.estimate_item_id
        and ei.tenant_id = estimate_line_evidences.tenant_id
        and ei.version_id = estimate_line_evidences.version_id
    )
  );

create policy "Current tenant can update estimate line evidences"
  on public.estimate_line_evidences
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = estimate_line_evidences.takeoff_job_id
        and tj.tenant_id = estimate_line_evidences.tenant_id
        and (
          tj.estimate_version_id = estimate_line_evidences.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_line_evidences.tenant_id
              and tvl.target_version_id = estimate_line_evidences.version_id
              and tvl.takeoff_job_id = estimate_line_evidences.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_line_evidences.version_id, estimate_line_evidences.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_line_evidences.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
  );
