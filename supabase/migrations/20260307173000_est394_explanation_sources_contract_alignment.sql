-- EST-394: align persisted explanation source contract with the runtime API.
-- The production table was created with an earlier source_* shape and must stay
-- backward-compatible while exposing the final columns expected by the app.

alter table if exists public.estimate_explanation_sources
  add column if not exists source_kind text,
  add column if not exists label text,
  add column if not exists rank integer,
  add column if not exists source_record_table text,
  add column if not exists source_record_id uuid;

update public.estimate_explanation_sources
set
  source_kind = coalesce(source_kind, nullif(btrim(source_type), "")),
  label = coalesce(label, nullif(btrim(source_label), "")),
  rank = coalesce(rank, display_rank, 0)
where
  source_kind is null
  or label is null
  or rank is null;

alter table if exists public.estimate_explanation_sources
  alter column rank set default 0;

update public.estimate_explanation_sources
set rank = 0
where rank is null;

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
  drop constraint if exists estimate_explanation_sources_rank_nonnegative_check;
alter table if exists public.estimate_explanation_sources
  add constraint estimate_explanation_sources_rank_nonnegative_check
  check (rank >= 0);

alter table if exists public.estimate_explanation_sources
  alter column source_kind set not null,
  alter column label set not null,
  alter column rank set not null;

create index if not exists estimate_explanation_sources_explanation_rank_idx
  on public.estimate_explanation_sources (explanation_id, rank);

create index if not exists estimate_explanation_sources_source_lookup_idx
  on public.estimate_explanation_sources (
    source_record_table,
    source_record_id
  )
  where source_record_id is not null;

notify pgrst, 'reload schema';
