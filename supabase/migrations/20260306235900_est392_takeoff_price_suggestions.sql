-- EST-392: persistent, explainable takeoff price suggestion snapshots.
-- Stores one active suggestion snapshot per takeoff job + estimate line,
-- with normalized pricing sources and explicit human review status.

create table if not exists public.takeoff_price_suggestions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  snapshot_fingerprint text not null,
  status text not null default 'pending'
    check (status in ('pending', 'applied', 'kept_current', 'rejected')),
  current_price_cents integer
    check (current_price_cents is null or current_price_cents >= 0),
  low_cents integer not null
    check (low_cents >= 0),
  target_cents integer not null
    check (target_cents >= 0),
  high_cents integer not null
    check (high_cents >= 0),
  confidence_score double precision
    check (confidence_score is null or confidence_score between 0 and 1),
  confidence_label text not null
    check (confidence_label in ('low', 'medium', 'high')),
  candidate_count integer not null default 0
    check (candidate_count >= 0),
  outlier_count integer not null default 0
    check (outlier_count >= 0 and outlier_count <= candidate_count),
  justification text not null,
  factors_json jsonb not null default '[]'::jsonb,
  summary_json jsonb not null default '{}'::jsonb,
  selected_action text
    check (
      selected_action in (
        'apply_low',
        'apply_target',
        'apply_high',
        'keep_current',
        'reject'
      )
    ),
  selected_price_cents integer
    check (selected_price_cents is null or selected_price_cents >= 0),
  review_note text,
  reviewed_at timestamptz,
  superseded_at timestamptz,
  superseded_by_suggestion_id uuid references public.takeoff_price_suggestions(id) on delete set null
);

alter table if exists public.takeoff_price_suggestions
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists tenant_id uuid,
  add column if not exists project_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists estimate_item_id uuid,
  add column if not exists requested_by uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists snapshot_fingerprint text,
  add column if not exists status text,
  add column if not exists current_price_cents integer,
  add column if not exists low_cents integer,
  add column if not exists target_cents integer,
  add column if not exists high_cents integer,
  add column if not exists confidence_score double precision,
  add column if not exists confidence_label text,
  add column if not exists candidate_count integer,
  add column if not exists outlier_count integer,
  add column if not exists justification text,
  add column if not exists factors_json jsonb,
  add column if not exists summary_json jsonb,
  add column if not exists selected_action text,
  add column if not exists selected_price_cents integer,
  add column if not exists review_note text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_suggestion_id uuid;

alter table if exists public.takeoff_price_suggestions
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column tenant_id set default public.current_tenant_id(),
  alter column status set default 'pending',
  alter column candidate_count set default 0,
  alter column outlier_count set default 0,
  alter column factors_json set default '[]'::jsonb,
  alter column summary_json set default '{}'::jsonb,
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_item_id set not null,
  alter column snapshot_fingerprint set not null,
  alter column status set not null,
  alter column low_cents set not null,
  alter column target_cents set not null,
  alter column high_cents set not null,
  alter column confidence_label set not null,
  alter column candidate_count set not null,
  alter column outlier_count set not null,
  alter column justification set not null,
  alter column factors_json set not null,
  alter column summary_json set not null;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_tenant_id_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_project_id_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_project_id_fkey
  foreign key (project_id)
  references public.estimate_projects(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_version_id_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_version_id_fkey
  foreign key (version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_takeoff_job_id_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_takeoff_job_id_fkey
  foreign key (takeoff_job_id)
  references public.takeoff_jobs(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_estimate_item_id_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_estimate_item_id_fkey
  foreign key (estimate_item_id)
  references public.estimate_items(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_requested_by_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_requested_by_fkey
  foreign key (requested_by)
  references public.profiles(id)
  on delete set null;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_reviewed_by_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_reviewed_by_fkey
  foreign key (reviewed_by)
  references public.profiles(id)
  on delete set null;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_superseded_by_fkey;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_superseded_by_fkey
  foreign key (superseded_by_suggestion_id)
  references public.takeoff_price_suggestions(id)
  on delete set null;

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_fingerprint_not_blank_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_fingerprint_not_blank_check
  check (length(btrim(snapshot_fingerprint)) > 0);

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_justification_not_blank_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_justification_not_blank_check
  check (length(btrim(justification)) > 0);

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_range_order_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_range_order_check
  check (low_cents <= target_cents and target_cents <= high_cents);

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_factors_array_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_factors_array_check
  check (jsonb_typeof(factors_json) = 'array');

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_summary_object_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_summary_object_check
  check (jsonb_typeof(summary_json) = 'object');

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_status_action_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_status_action_check
  check (
    (
      status = 'pending'
      and selected_action is null
      and selected_price_cents is null
      and review_note is null
      and reviewed_at is null
      and reviewed_by is null
    )
    or (
      status = 'applied'
      and selected_action in ('apply_low', 'apply_target', 'apply_high')
      and selected_price_cents is not null
      and reviewed_at is not null
      and reviewed_by is not null
      and review_note is not null
      and length(btrim(review_note)) > 0
    )
    or (
      status = 'kept_current'
      and selected_action = 'keep_current'
      and reviewed_at is not null
      and reviewed_by is not null
      and review_note is not null
      and length(btrim(review_note)) > 0
    )
    or (
      status = 'rejected'
      and selected_action = 'reject'
      and selected_price_cents is null
      and reviewed_at is not null
      and reviewed_by is not null
      and review_note is not null
      and length(btrim(review_note)) > 0
    )
  );

alter table if exists public.takeoff_price_suggestions
  drop constraint if exists takeoff_price_suggestions_selected_price_match_check;
alter table if exists public.takeoff_price_suggestions
  add constraint takeoff_price_suggestions_selected_price_match_check
  check (
    selected_action is null
    or (selected_action = 'apply_low' and selected_price_cents = low_cents)
    or (selected_action = 'apply_target' and selected_price_cents = target_cents)
    or (selected_action = 'apply_high' and selected_price_cents = high_cents)
    or (
      selected_action = 'keep_current'
      and selected_price_cents is not distinct from current_price_cents
    )
    or (selected_action = 'reject' and selected_price_cents is null)
  );

create unique index if not exists takeoff_price_suggestions_active_line_idx
  on public.takeoff_price_suggestions (
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id
  )
  where superseded_at is null;

create index if not exists takeoff_price_suggestions_active_status_idx
  on public.takeoff_price_suggestions (
    tenant_id,
    project_id,
    version_id,
    takeoff_job_id,
    status,
    updated_at desc
  )
  where superseded_at is null;

create index if not exists takeoff_price_suggestions_line_review_idx
  on public.takeoff_price_suggestions (
    tenant_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    reviewed_at desc
  );

create table if not exists public.takeoff_price_suggestion_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  takeoff_job_id uuid not null references public.takeoff_jobs(id) on delete cascade,
  estimate_item_id uuid not null references public.estimate_items(id) on delete cascade,
  suggestion_id uuid not null references public.takeoff_price_suggestions(id) on delete cascade,
  source_kind text not null
    check (source_kind in ('history', 'pricebook', 'similar_item', 'external_reference')),
  kind text not null
    check (kind in ('fact', 'hypothesis', 'inference')),
  label text not null,
  source_ref text not null,
  price_cents integer not null
    check (price_cents >= 0),
  freshness_label text,
  confidence_score double precision
    check (confidence_score is null or confidence_score between 0 and 1),
  rank integer not null default 0
    check (rank >= 0),
  is_outlier boolean not null default false,
  source_record_table text,
  source_record_id text,
  metadata_json jsonb not null default '{}'::jsonb
);

alter table if exists public.takeoff_price_suggestion_sources
  add column if not exists created_at timestamptz,
  add column if not exists tenant_id uuid,
  add column if not exists project_id uuid,
  add column if not exists version_id uuid,
  add column if not exists takeoff_job_id uuid,
  add column if not exists estimate_item_id uuid,
  add column if not exists suggestion_id uuid,
  add column if not exists source_kind text,
  add column if not exists kind text,
  add column if not exists label text,
  add column if not exists source_ref text,
  add column if not exists price_cents integer,
  add column if not exists freshness_label text,
  add column if not exists confidence_score double precision,
  add column if not exists rank integer,
  add column if not exists is_outlier boolean,
  add column if not exists source_record_table text,
  add column if not exists source_record_id text,
  add column if not exists metadata_json jsonb;

alter table if exists public.takeoff_price_suggestion_sources
  alter column created_at set default now(),
  alter column tenant_id set default public.current_tenant_id(),
  alter column rank set default 0,
  alter column is_outlier set default false,
  alter column metadata_json set default '{}'::jsonb,
  alter column created_at set not null,
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column version_id set not null,
  alter column takeoff_job_id set not null,
  alter column estimate_item_id set not null,
  alter column suggestion_id set not null,
  alter column source_kind set not null,
  alter column kind set not null,
  alter column label set not null,
  alter column source_ref set not null,
  alter column price_cents set not null,
  alter column rank set not null,
  alter column is_outlier set not null,
  alter column metadata_json set not null;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_tenant_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_project_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_project_id_fkey
  foreign key (project_id)
  references public.estimate_projects(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_version_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_version_id_fkey
  foreign key (version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_takeoff_job_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_takeoff_job_id_fkey
  foreign key (takeoff_job_id)
  references public.takeoff_jobs(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_estimate_item_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_estimate_item_id_fkey
  foreign key (estimate_item_id)
  references public.estimate_items(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_suggestion_id_fkey;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_suggestion_id_fkey
  foreign key (suggestion_id)
  references public.takeoff_price_suggestions(id)
  on delete cascade;

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_label_not_blank_check;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_label_not_blank_check
  check (length(btrim(label)) > 0);

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_source_ref_not_blank_check;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_source_ref_not_blank_check
  check (length(btrim(source_ref)) > 0);

alter table if exists public.takeoff_price_suggestion_sources
  drop constraint if exists takeoff_price_suggestion_sources_metadata_object_check;
alter table if exists public.takeoff_price_suggestion_sources
  add constraint takeoff_price_suggestion_sources_metadata_object_check
  check (jsonb_typeof(metadata_json) = 'object');

create index if not exists takeoff_price_suggestion_sources_suggestion_idx
  on public.takeoff_price_suggestion_sources (
    suggestion_id,
    source_kind,
    rank
  );

create index if not exists takeoff_price_suggestion_sources_line_kind_idx
  on public.takeoff_price_suggestion_sources (
    tenant_id,
    project_id,
    version_id,
    takeoff_job_id,
    estimate_item_id,
    source_kind
  );

create or replace function public.assign_takeoff_price_suggestions_scope()
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

create or replace function public.assign_takeoff_price_suggestion_sources_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_scope record;
begin
  select
    suggestion.tenant_id,
    suggestion.project_id,
    suggestion.version_id,
    suggestion.takeoff_job_id,
    suggestion.estimate_item_id
    into v_scope
  from public.takeoff_price_suggestions suggestion
  where suggestion.id = new.suggestion_id;

  if found then
    new.tenant_id := v_scope.tenant_id;
    new.project_id := v_scope.project_id;
    new.version_id := v_scope.version_id;
    new.takeoff_job_id := v_scope.takeoff_job_id;
    new.estimate_item_id := v_scope.estimate_item_id;
  elsif new.tenant_id is null then
    new.tenant_id := public.current_tenant_id();
  end if;

  return new;
end;
$$;

drop trigger if exists set_takeoff_price_suggestions_scope on public.takeoff_price_suggestions;
create trigger set_takeoff_price_suggestions_scope
  before insert or update on public.takeoff_price_suggestions
  for each row execute procedure public.assign_takeoff_price_suggestions_scope();

drop trigger if exists set_takeoff_price_suggestions_updated_at on public.takeoff_price_suggestions;
create trigger set_takeoff_price_suggestions_updated_at
  before update on public.takeoff_price_suggestions
  for each row execute procedure public.set_updated_at();

drop trigger if exists set_takeoff_price_suggestion_sources_scope on public.takeoff_price_suggestion_sources;
create trigger set_takeoff_price_suggestion_sources_scope
  before insert or update on public.takeoff_price_suggestion_sources
  for each row execute procedure public.assign_takeoff_price_suggestion_sources_scope();

alter table if exists public.takeoff_price_suggestions enable row level security;
alter table if exists public.takeoff_price_suggestions force row level security;
alter table if exists public.takeoff_price_suggestion_sources enable row level security;
alter table if exists public.takeoff_price_suggestion_sources force row level security;

drop policy if exists "Current tenant can select takeoff price suggestions" on public.takeoff_price_suggestions;
drop policy if exists "Current tenant can insert takeoff price suggestions" on public.takeoff_price_suggestions;
drop policy if exists "Current tenant can update takeoff price suggestions" on public.takeoff_price_suggestions;

create policy "Current tenant can select takeoff price suggestions"
  on public.takeoff_price_suggestions
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = takeoff_price_suggestions.version_id
      where tj.id = takeoff_price_suggestions.takeoff_job_id
        and tj.tenant_id = takeoff_price_suggestions.tenant_id
        and target.project_id = takeoff_price_suggestions.project_id
        and (
          tj.estimate_version_id = takeoff_price_suggestions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_price_suggestions.tenant_id
              and tvl.target_version_id = takeoff_price_suggestions.version_id
              and tvl.takeoff_job_id = takeoff_price_suggestions.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(takeoff_price_suggestions.version_id, takeoff_price_suggestions.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, takeoff_price_suggestions.tenant_id))
    )
    and exists (
      select 1
      from public.estimate_items ei
      where ei.id = takeoff_price_suggestions.estimate_item_id
        and ei.tenant_id = takeoff_price_suggestions.tenant_id
        and ei.version_id = takeoff_price_suggestions.version_id
    )
  );

create policy "Current tenant can insert takeoff price suggestions"
  on public.takeoff_price_suggestions
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = takeoff_price_suggestions.version_id
      where tj.id = takeoff_price_suggestions.takeoff_job_id
        and tj.tenant_id = takeoff_price_suggestions.tenant_id
        and target.project_id = takeoff_price_suggestions.project_id
        and (
          tj.estimate_version_id = takeoff_price_suggestions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_price_suggestions.tenant_id
              and tvl.target_version_id = takeoff_price_suggestions.version_id
              and tvl.takeoff_job_id = takeoff_price_suggestions.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(takeoff_price_suggestions.version_id, takeoff_price_suggestions.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, takeoff_price_suggestions.tenant_id))
    )
    and exists (
      select 1
      from public.estimate_items ei
      where ei.id = takeoff_price_suggestions.estimate_item_id
        and ei.tenant_id = takeoff_price_suggestions.tenant_id
        and ei.version_id = takeoff_price_suggestions.version_id
    )
  );

create policy "Current tenant can update takeoff price suggestions"
  on public.takeoff_price_suggestions
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_jobs tj
      where tj.id = takeoff_price_suggestions.takeoff_job_id
        and tj.tenant_id = takeoff_price_suggestions.tenant_id
        and (
          tj.estimate_version_id = takeoff_price_suggestions.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_price_suggestions.tenant_id
              and tvl.target_version_id = takeoff_price_suggestions.version_id
              and tvl.takeoff_job_id = takeoff_price_suggestions.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(takeoff_price_suggestions.version_id, takeoff_price_suggestions.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, takeoff_price_suggestions.tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
  );

drop policy if exists "Current tenant can select takeoff price suggestion sources" on public.takeoff_price_suggestion_sources;
drop policy if exists "Current tenant can insert takeoff price suggestion sources" on public.takeoff_price_suggestion_sources;
drop policy if exists "Current tenant can update takeoff price suggestion sources" on public.takeoff_price_suggestion_sources;

create policy "Current tenant can select takeoff price suggestion sources"
  on public.takeoff_price_suggestion_sources
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_price_suggestions suggestion
      where suggestion.id = takeoff_price_suggestion_sources.suggestion_id
        and suggestion.tenant_id = takeoff_price_suggestion_sources.tenant_id
        and suggestion.project_id = takeoff_price_suggestion_sources.project_id
        and suggestion.version_id = takeoff_price_suggestion_sources.version_id
        and suggestion.takeoff_job_id = takeoff_price_suggestion_sources.takeoff_job_id
        and suggestion.estimate_item_id = takeoff_price_suggestion_sources.estimate_item_id
    )
    and exists (
      select 1
      from public.takeoff_jobs tj
      join public.estimate_versions target on target.id = takeoff_price_suggestion_sources.version_id
      where tj.id = takeoff_price_suggestion_sources.takeoff_job_id
        and tj.tenant_id = takeoff_price_suggestion_sources.tenant_id
        and target.project_id = takeoff_price_suggestion_sources.project_id
        and (
          tj.estimate_version_id = takeoff_price_suggestion_sources.version_id
          or exists (
            select 1
            from public.takeoff_version_links tvl
            where tvl.tenant_id = takeoff_price_suggestion_sources.tenant_id
              and tvl.target_version_id = takeoff_price_suggestion_sources.version_id
              and tvl.takeoff_job_id = takeoff_price_suggestion_sources.takeoff_job_id
          )
        )
        and (select public.can_access_takeoff_estimate_version(takeoff_price_suggestion_sources.version_id, takeoff_price_suggestion_sources.tenant_id))
        and (select public.can_access_takeoff_estimate_version(tj.estimate_version_id, takeoff_price_suggestion_sources.tenant_id))
    )
  );

create policy "Current tenant can insert takeoff price suggestion sources"
  on public.takeoff_price_suggestion_sources
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_price_suggestions suggestion
      where suggestion.id = takeoff_price_suggestion_sources.suggestion_id
        and suggestion.tenant_id = takeoff_price_suggestion_sources.tenant_id
        and suggestion.project_id = takeoff_price_suggestion_sources.project_id
        and suggestion.version_id = takeoff_price_suggestion_sources.version_id
        and suggestion.takeoff_job_id = takeoff_price_suggestion_sources.takeoff_job_id
        and suggestion.estimate_item_id = takeoff_price_suggestion_sources.estimate_item_id
    )
  );

create policy "Current tenant can update takeoff price suggestion sources"
  on public.takeoff_price_suggestion_sources
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and exists (
      select 1
      from public.takeoff_price_suggestions suggestion
      where suggestion.id = takeoff_price_suggestion_sources.suggestion_id
        and suggestion.tenant_id = takeoff_price_suggestion_sources.tenant_id
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
  );
