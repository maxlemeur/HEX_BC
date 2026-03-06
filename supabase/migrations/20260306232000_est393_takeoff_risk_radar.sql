-- EST-393: persistent, explainable takeoff risk alerts.
-- Stores a canonical projection of active risk signals for a takeoff job + estimate version,
-- while preserving review status history across recalculations.

create table if not exists public.estimate_risk_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  scope_type text not null
    check (scope_type in ('project', 'lot', 'line')),
  scope_ref text not null,
  scope_id uuid,
  scope_label text not null,
  cause_code text not null
    check (
      cause_code in (
        'missing_proof',
        'dpgf_takeoff_gap',
        'atypical_price',
        'insufficient_margin',
        'vat_inconsistency',
        'missing_piece'
      )
    ),
  severity text not null
    check (severity in ('info', 'warning', 'critical')),
  status text not null default 'to_process'
    check (status in ('to_process', 'assumed', 'false_positive')),
  risk_score integer not null
    check (risk_score between 0 and 100),
  margin_bucket text
    check (margin_bucket in ('negative', 'thin', 'healthy', 'unknown')),
  line_id uuid references public.estimate_items(id) on delete cascade,
  lot_id uuid references public.estimate_items(id) on delete set null,
  reason_labels jsonb not null default '[]'::jsonb,
  provenance jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  review_note text
);

alter table if exists public.estimate_risk_alerts
  add column if not exists updated_at timestamptz,
  add column if not exists tenant_id uuid,
  add column if not exists project_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists scope_type text,
  add column if not exists scope_ref text,
  add column if not exists scope_id uuid,
  add column if not exists scope_label text,
  add column if not exists cause_code text,
  add column if not exists severity text,
  add column if not exists status text,
  add column if not exists risk_score integer,
  add column if not exists margin_bucket text,
  add column if not exists line_id uuid,
  add column if not exists lot_id uuid,
  add column if not exists reason_labels jsonb,
  add column if not exists provenance jsonb,
  add column if not exists metadata jsonb,
  add column if not exists is_active boolean,
  add column if not exists first_detected_at timestamptz,
  add column if not exists last_detected_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text;

alter table if exists public.estimate_risk_alerts
  alter column updated_at set default now(),
  alter column tenant_id set default public.current_tenant_id(),
  alter column status set default 'to_process',
  alter column reason_labels set default '[]'::jsonb,
  alter column provenance set default '[]'::jsonb,
  alter column metadata set default '{}'::jsonb,
  alter column is_active set default true,
  alter column first_detected_at set default now(),
  alter column last_detected_at set default now(),
  alter column updated_at set not null,
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column scope_type set not null,
  alter column scope_ref set not null,
  alter column scope_label set not null,
  alter column cause_code set not null,
  alter column severity set not null,
  alter column status set not null,
  alter column risk_score set not null,
  alter column reason_labels set not null,
  alter column provenance set not null,
  alter column metadata set not null,
  alter column is_active set not null,
  alter column first_detected_at set not null,
  alter column last_detected_at set not null;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_tenant_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_project_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_project_id_fkey
  foreign key (project_id)
  references public.estimate_projects(id)
  on delete cascade;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_version_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_version_id_fkey
  foreign key (version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_takeoff_job_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_takeoff_job_id_fkey
  foreign key (takeoff_job_id)
  references public.takeoff_jobs(id)
  on delete cascade;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_line_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_line_id_fkey
  foreign key (line_id)
  references public.estimate_items(id)
  on delete cascade;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_lot_id_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_lot_id_fkey
  foreign key (lot_id)
  references public.estimate_items(id)
  on delete set null;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_reviewed_by_fkey;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_reviewed_by_fkey
  foreign key (reviewed_by)
  references public.profiles(id)
  on delete set null;

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_scope_ref_not_blank_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_scope_ref_not_blank_check
  check (length(btrim(scope_ref)) > 0);

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_scope_label_not_blank_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_scope_label_not_blank_check
  check (length(btrim(scope_label)) > 0);

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_reason_labels_array_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_reason_labels_array_check
  check (jsonb_typeof(reason_labels) = 'array');

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_provenance_array_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_provenance_array_check
  check (jsonb_typeof(provenance) = 'array');

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_metadata_object_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_metadata_object_check
  check (jsonb_typeof(metadata) = 'object');

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_review_note_required_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_review_note_required_check
  check (
    status = 'to_process'
    or (
      review_note is not null
      and length(btrim(review_note)) > 0
      and reviewed_at is not null
    )
  );

alter table if exists public.estimate_risk_alerts
  drop constraint if exists estimate_risk_alerts_line_scope_line_id_check;
alter table if exists public.estimate_risk_alerts
  add constraint estimate_risk_alerts_line_scope_line_id_check
  check (
    scope_type <> 'line'
    or line_id is not null
  );

create unique index if not exists estimate_risk_alerts_active_identity_idx
  on public.estimate_risk_alerts (
    tenant_id,
    version_id,
    takeoff_job_id,
    scope_type,
    scope_ref,
    cause_code
  )
  where is_active;

create index if not exists estimate_risk_alerts_open_queue_idx
  on public.estimate_risk_alerts (
    tenant_id,
    version_id,
    takeoff_job_id,
    severity,
    risk_score desc,
    updated_at desc
  )
  where is_active and status = 'to_process';

create index if not exists estimate_risk_alerts_scope_filter_idx
  on public.estimate_risk_alerts (
    tenant_id,
    project_id,
    version_id,
    takeoff_job_id,
    scope_type,
    scope_id,
    status,
    severity
  )
  where is_active;

create index if not exists estimate_risk_alerts_line_idx
  on public.estimate_risk_alerts (
    tenant_id,
    version_id,
    takeoff_job_id,
    line_id,
    status
  )
  where is_active and line_id is not null;

create index if not exists estimate_risk_alerts_lot_idx
  on public.estimate_risk_alerts (
    tenant_id,
    version_id,
    takeoff_job_id,
    lot_id,
    status
  )
  where is_active and lot_id is not null;

create or replace function public.assign_estimate_risk_alerts_scope()
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

drop trigger if exists set_estimate_risk_alerts_scope on public.estimate_risk_alerts;
create trigger set_estimate_risk_alerts_scope
  before insert or update on public.estimate_risk_alerts
  for each row execute procedure public.assign_estimate_risk_alerts_scope();

drop trigger if exists set_estimate_risk_alerts_updated_at on public.estimate_risk_alerts;
create trigger set_estimate_risk_alerts_updated_at
  before update on public.estimate_risk_alerts
  for each row execute procedure public.set_updated_at();

alter table if exists public.estimate_risk_alerts enable row level security;
alter table if exists public.estimate_risk_alerts force row level security;

drop policy if exists "Current tenant can select estimate risk alerts" on public.estimate_risk_alerts;
drop policy if exists "Current tenant can insert estimate risk alerts" on public.estimate_risk_alerts;
drop policy if exists "Current tenant can update estimate risk alerts" on public.estimate_risk_alerts;

create policy "Current tenant can select estimate risk alerts"
  on public.estimate_risk_alerts
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = estimate_risk_alerts.version_id
      where tj.id = estimate_risk_alerts.takeoff_job_id
        and tj.tenant_id = estimate_risk_alerts.tenant_id
        and target.project_id = estimate_risk_alerts.project_id
        and (
          tj.estimate_version_id = estimate_risk_alerts.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_risk_alerts.tenant_id
              and tvl.target_version_id = estimate_risk_alerts.version_id
              and tvl.takeoff_job_id = estimate_risk_alerts.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_risk_alerts.version_id, estimate_risk_alerts.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_risk_alerts.tenant_id))
    )
  );

create policy "Current tenant can insert estimate risk alerts"
  on public.estimate_risk_alerts
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = estimate_risk_alerts.version_id
      where tj.id = estimate_risk_alerts.takeoff_job_id
        and tj.tenant_id = estimate_risk_alerts.tenant_id
        and target.project_id = estimate_risk_alerts.project_id
        and (
          tj.estimate_version_id = estimate_risk_alerts.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_risk_alerts.tenant_id
              and tvl.target_version_id = estimate_risk_alerts.version_id
              and tvl.takeoff_job_id = estimate_risk_alerts.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_risk_alerts.version_id, estimate_risk_alerts.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_risk_alerts.tenant_id))
    )
  );

create policy "Current tenant can update estimate risk alerts"
  on public.estimate_risk_alerts
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = estimate_risk_alerts.takeoff_job_id
        and tj.tenant_id = estimate_risk_alerts.tenant_id
        and (
          tj.estimate_version_id = estimate_risk_alerts.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = estimate_risk_alerts.tenant_id
              and tvl.target_version_id = estimate_risk_alerts.version_id
              and tvl.takeoff_job_id = estimate_risk_alerts.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(estimate_risk_alerts.version_id, estimate_risk_alerts.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, estimate_risk_alerts.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
  );
