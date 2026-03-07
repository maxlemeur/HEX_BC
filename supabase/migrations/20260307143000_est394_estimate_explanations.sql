-- EST-394: persistent explanations for estimate prices and version deltas.
-- Stores one active explanation snapshot per identity, with normalized provenance.

create table if not exists public.estimate_explanations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  project_id uuid not null references public.estimate_projects(id) on delete cascade,
  version_id uuid not null references public.estimate_versions(id) on delete cascade,
  line_id uuid references public.estimate_items(id) on delete cascade,
  compare_version_id uuid references public.estimate_versions(id) on delete cascade,
  requested_by uuid references public.profiles(id) on delete set null,
  explanation_kind text not null
    check (explanation_kind in ('price', 'delta')),
  snapshot_fingerprint text not null,
  summary_short text not null,
  summary_detail text not null,
  confidence_label text not null
    check (confidence_label in ('low', 'medium', 'high')),
  confidence_score double precision
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  used_fallback boolean not null default false,
  provider text not null default 'gemini',
  model text,
  statements_json jsonb not null default '{"facts":[],"hypotheses":[],"inferences":[]}'::jsonb,
  risk_signals_json jsonb not null default '[]'::jsonb,
  impact_summary_json jsonb not null default '{}'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by_explanation_id uuid references public.estimate_explanations(id) on delete set null
);

alter table if exists public.estimate_explanations
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists tenant_id uuid,
  add column if not exists project_id uuid,
  add column if not exists version_id uuid,
  add column if not exists line_id uuid,
  add column if not exists compare_version_id uuid,
  add column if not exists requested_by uuid,
  add column if not exists explanation_kind text,
  add column if not exists snapshot_fingerprint text,
  add column if not exists summary_short text,
  add column if not exists summary_detail text,
  add column if not exists confidence_label text,
  add column if not exists confidence_score double precision,
  add column if not exists used_fallback boolean,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists statements_json jsonb,
  add column if not exists risk_signals_json jsonb,
  add column if not exists impact_summary_json jsonb,
  add column if not exists metadata_json jsonb,
  add column if not exists generated_at timestamptz,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_explanation_id uuid;

alter table if exists public.estimate_explanations
  alter column created_at set default now(),
  alter column updated_at set default now(),
  alter column tenant_id set default public.current_tenant_id(),
  alter column used_fallback set default false,
  alter column provider set default 'gemini',
  alter column statements_json set default '{"facts":[],"hypotheses":[],"inferences":[]}'::jsonb,
  alter column risk_signals_json set default '[]'::jsonb,
  alter column impact_summary_json set default '{}'::jsonb,
  alter column metadata_json set default '{}'::jsonb,
  alter column generated_at set default now(),
  alter column created_at set not null,
  alter column updated_at set not null,
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column version_id set not null,
  alter column explanation_kind set not null,
  alter column snapshot_fingerprint set not null,
  alter column summary_short set not null,
  alter column summary_detail set not null,
  alter column confidence_label set not null,
  alter column used_fallback set not null,
  alter column provider set not null,
  alter column statements_json set not null,
  alter column risk_signals_json set not null,
  alter column impact_summary_json set not null,
  alter column metadata_json set not null,
  alter column generated_at set not null;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_tenant_id_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_tenant_id_fkey
  foreign key (tenant_id)
  references public.tenants(id)
  on delete restrict;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_project_id_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_project_id_fkey
  foreign key (project_id)
  references public.estimate_projects(id)
  on delete cascade;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_version_id_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_version_id_fkey
  foreign key (version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_line_id_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_line_id_fkey
  foreign key (line_id)
  references public.estimate_items(id)
  on delete cascade;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_compare_version_id_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_compare_version_id_fkey
  foreign key (compare_version_id)
  references public.estimate_versions(id)
  on delete cascade;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_requested_by_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_requested_by_fkey
  foreign key (requested_by)
  references public.profiles(id)
  on delete set null;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_superseded_by_fkey;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_superseded_by_fkey
  foreign key (superseded_by_explanation_id)
  references public.estimate_explanations(id)
  on delete set null;

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_fingerprint_not_blank_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_fingerprint_not_blank_check
  check (length(btrim(snapshot_fingerprint)) > 0);

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_summary_short_not_blank_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_summary_short_not_blank_check
  check (length(btrim(summary_short)) > 0);

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_summary_detail_not_blank_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_summary_detail_not_blank_check
  check (length(btrim(summary_detail)) > 0);

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_provider_not_blank_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_provider_not_blank_check
  check (length(btrim(provider)) > 0);

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_statements_object_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_statements_object_check
  check (
    jsonb_typeof(statements_json) = 'object'
    and statements_json ? 'facts'
    and statements_json ? 'hypotheses'
    and statements_json ? 'inferences'
  );

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_risk_signals_array_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_risk_signals_array_check
  check (jsonb_typeof(risk_signals_json) = 'array');

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_impact_summary_object_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_impact_summary_object_check
  check (jsonb_typeof(impact_summary_json) = 'object');

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_metadata_object_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_metadata_object_check
  check (jsonb_typeof(metadata_json) = 'object');

alter table if exists public.estimate_explanations
  drop constraint if exists estimate_explanations_scope_check;
alter table if exists public.estimate_explanations
  add constraint estimate_explanations_scope_check
  check (
    (
      explanation_kind = 'price'
      and line_id is not null
      and compare_version_id is null
    )
    or (
      explanation_kind = 'delta'
      and line_id is null
      and compare_version_id is not null
      and compare_version_id <> version_id
    )
  );

create unique index if not exists estimate_explanations_active_identity_idx
  on public.estimate_explanations (
    tenant_id,
    version_id,
    coalesce(line_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(compare_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    explanation_kind
  )
  where superseded_at is null;

create unique index if not exists estimate_explanations_active_fingerprint_idx
  on public.estimate_explanations (
    tenant_id,
    version_id,
    coalesce(line_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(compare_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    explanation_kind,
    snapshot_fingerprint
  )
  where superseded_at is null;

create index if not exists estimate_explanations_project_version_kind_idx
  on public.estimate_explanations (
    tenant_id,
    project_id,
    version_id,
    explanation_kind,
    generated_at desc
  )
  where superseded_at is null;

create index if not exists estimate_explanations_compare_version_idx
  on public.estimate_explanations (
    tenant_id,
    compare_version_id
  )
  where compare_version_id is not null;

create index if not exists estimate_explanations_line_idx
  on public.estimate_explanations (
    tenant_id,
    line_id
  )
  where line_id is not null;

create index if not exists estimate_explanations_superseded_by_idx
  on public.estimate_explanations (superseded_by_explanation_id)
  where superseded_by_explanation_id is not null;

create table if not exists public.estimate_explanation_sources (
  id uuid primary key default gen_random_uuid(),
  explanation_id uuid not null references public.estimate_explanations(id) on delete cascade,
  source_kind text not null,
  label text not null,
  source_ref text,
  confidence_score double precision
    check (confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)),
  rank integer not null default 0
    check (rank >= 0),
  source_record_table text,
  source_record_id uuid,
  metadata_json jsonb not null default '{}'::jsonb
);

alter table if exists public.estimate_explanation_sources
  add column if not exists explanation_id uuid,
  add column if not exists source_kind text,
  add column if not exists label text,
  add column if not exists source_ref text,
  add column if not exists confidence_score double precision,
  add column if not exists rank integer,
  add column if not exists source_record_table text,
  add column if not exists source_record_id uuid,
  add column if not exists metadata_json jsonb;

alter table if exists public.estimate_explanation_sources
  alter column rank set default 0,
  alter column metadata_json set default '{}'::jsonb,
  alter column explanation_id set not null,
  alter column source_kind set not null,
  alter column label set not null,
  alter column rank set not null,
  alter column metadata_json set not null;

alter table if exists public.estimate_explanation_sources
  drop constraint if exists estimate_explanation_sources_explanation_id_fkey;
alter table if exists public.estimate_explanation_sources
  add constraint estimate_explanation_sources_explanation_id_fkey
  foreign key (explanation_id)
  references public.estimate_explanations(id)
  on delete cascade;

alter table if exists public.estimate_explanation_sources
  drop constraint if exists estimate_explanation_sources_source_kind_not_blank_check;
alter table if exists public.estimate_explanation_sources
  add constraint estimate_explanation_sources_source_kind_not_blank_check
  check (length(btrim(source_kind)) > 0);

alter table if exists public.estimate_explanation_sources
  drop constraint if exists estimate_explanation_sources_label_not_blank_check;
alter table if exists public.estimate_explanation_sources
  add constraint estimate_explanation_sources_label_not_blank_check
  check (length(btrim(label)) > 0);

alter table if exists public.estimate_explanation_sources
  drop constraint if exists estimate_explanation_sources_metadata_object_check;
alter table if exists public.estimate_explanation_sources
  add constraint estimate_explanation_sources_metadata_object_check
  check (jsonb_typeof(metadata_json) = 'object');

create index if not exists estimate_explanation_sources_explanation_rank_idx
  on public.estimate_explanation_sources (explanation_id, rank);

create index if not exists estimate_explanation_sources_source_lookup_idx
  on public.estimate_explanation_sources (
    source_record_table,
    source_record_id
  )
  where source_record_id is not null;

create or replace function public.assign_estimate_explanations_scope()
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

drop trigger if exists set_estimate_explanations_scope on public.estimate_explanations;
create trigger set_estimate_explanations_scope
  before insert or update on public.estimate_explanations
  for each row execute procedure public.assign_estimate_explanations_scope();

drop trigger if exists set_estimate_explanations_updated_at on public.estimate_explanations;
create trigger set_estimate_explanations_updated_at
  before update on public.estimate_explanations
  for each row execute procedure public.set_updated_at();

alter table if exists public.estimate_explanations enable row level security;
alter table if exists public.estimate_explanations force row level security;
alter table if exists public.estimate_explanation_sources enable row level security;
alter table if exists public.estimate_explanation_sources force row level security;

drop policy if exists "Current tenant can select estimate explanations" on public.estimate_explanations;
drop policy if exists "Current tenant can insert estimate explanations" on public.estimate_explanations;
drop policy if exists "Current tenant can update estimate explanations" on public.estimate_explanations;
drop policy if exists "Current tenant can select estimate explanation sources" on public.estimate_explanation_sources;
drop policy if exists "Current tenant can insert estimate explanation sources" on public.estimate_explanation_sources;
drop policy if exists "Current tenant can update estimate explanation sources" on public.estimate_explanation_sources;

create policy "Current tenant can select estimate explanations"
  on public.estimate_explanations
  for select
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and (
      compare_version_id is null
      or (select public.can_access_takeoff_estimate_version(compare_version_id, tenant_id))
    )
  );

create policy "Current tenant can insert estimate explanations"
  on public.estimate_explanations
  for insert
  to authenticated
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and (
      compare_version_id is null
      or (select public.can_access_takeoff_estimate_version(compare_version_id, tenant_id))
    )
  );

create policy "Current tenant can update estimate explanations"
  on public.estimate_explanations
  for update
  to authenticated
  using (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and (
      compare_version_id is null
      or (select public.can_access_takeoff_estimate_version(compare_version_id, tenant_id))
    )
  )
  with check (
    tenant_id = (select public.current_tenant_id())
    and (select public.can_access_takeoff_estimate_version(version_id, tenant_id))
    and (
      compare_version_id is null
      or (select public.can_access_takeoff_estimate_version(compare_version_id, tenant_id))
    )
  );

create policy "Current tenant can select estimate explanation sources"
  on public.estimate_explanation_sources
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_explanations ee
      where ee.id = estimate_explanation_sources.explanation_id
        and ee.tenant_id = (select public.current_tenant_id())
        and (select public.can_access_takeoff_estimate_version(ee.version_id, ee.tenant_id))
        and (
          ee.compare_version_id is null
          or (select public.can_access_takeoff_estimate_version(ee.compare_version_id, ee.tenant_id))
        )
    )
  );

create policy "Current tenant can insert estimate explanation sources"
  on public.estimate_explanation_sources
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.estimate_explanations ee
      where ee.id = estimate_explanation_sources.explanation_id
        and ee.tenant_id = (select public.current_tenant_id())
        and (select public.can_access_takeoff_estimate_version(ee.version_id, ee.tenant_id))
        and (
          ee.compare_version_id is null
          or (select public.can_access_takeoff_estimate_version(ee.compare_version_id, ee.tenant_id))
        )
    )
  );

create policy "Current tenant can update estimate explanation sources"
  on public.estimate_explanation_sources
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.estimate_explanations ee
      where ee.id = estimate_explanation_sources.explanation_id
        and ee.tenant_id = (select public.current_tenant_id())
        and (select public.can_access_takeoff_estimate_version(ee.version_id, ee.tenant_id))
        and (
          ee.compare_version_id is null
          or (select public.can_access_takeoff_estimate_version(ee.compare_version_id, ee.tenant_id))
        )
    )
  )
  with check (
    exists (
      select 1
      from public.estimate_explanations ee
      where ee.id = estimate_explanation_sources.explanation_id
        and ee.tenant_id = (select public.current_tenant_id())
        and (select public.can_access_takeoff_estimate_version(ee.version_id, ee.tenant_id))
        and (
          ee.compare_version_id is null
          or (select public.can_access_takeoff_estimate_version(ee.compare_version_id, ee.tenant_id))
        )
    )
  );
