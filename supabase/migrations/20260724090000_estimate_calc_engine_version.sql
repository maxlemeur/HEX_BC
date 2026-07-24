-- T6 phase A: pin every estimate version to an explicit totals calculation
-- engine, so that the unified engine can later be rolled out version by version
-- instead of flipping the whole tenant base at once.
--
-- This migration is behaviour-neutral by construction:
--   * In PostgreSQL 11+, "add column ... not null default 1" fills every
--     existing row from the catalog default. There is no table rewrite and no
--     UPDATE, therefore no row-level trigger fires: guard_estimate_versions_
--     readonly, set_estimate_versions_updated_at and the audit trigger are all
--     left strictly untouched, and sent/accepted versions keep their
--     updated_at and their audit history intact.
--   * guard_estimate_versions_readonly is deliberately NOT extended with the
--     new column. Adding it there would make non-draft versions raise
--     'Estimate version is read-only' on this column, which is a behaviour
--     change. That belongs to phase C, when versions are actually switched
--     over to engine 2.
--   * No application SELECT is changed here and nothing reads the column yet.
--
-- Column semantics: 1 = legacy per-call-site engine (current behaviour).

alter table public.estimate_versions
  add column if not exists calc_engine_version smallint not null default 1;

alter table public.estimate_versions
  drop constraint if exists estimate_versions_calc_engine_version_check;
alter table public.estimate_versions
  add constraint estimate_versions_calc_engine_version_check
  check (calc_engine_version >= 1);

comment on column public.estimate_versions.calc_engine_version is
  'Totals calculation engine applied to this version (1 = legacy engine, T6 phase A).';
