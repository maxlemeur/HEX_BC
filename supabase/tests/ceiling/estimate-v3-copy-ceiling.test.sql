-- Copy into a v3, CI/production maximum (lot 3.1, owner option A of 18/10/2026: « on accepte jusqu'à 3,5 s pour
-- 1 000 lignes »). A copy is one public.commit_estimate_batch statement of at most 1 000 operations; IO13 copies 999
-- lines with their provenance and timed out in CI before 20261018180306. This single rolled-back copy of 1 000
-- operations with provenance into the 1 021-item v3 must take at most 3,5 s.
-- Separate pgTAP pass of db:ci:local, run whenever the database checks run alone (locally and in the E2E RLS Matrix
-- job, where this probe took at most 2,3 s before lot 3.1). An Army job starts the production build alongside them and
-- skips this pass: the same probe measured that build's load too (up to 5,6 s). Isolation: a journey times the whole
-- route and its runner, not the statement. Measurements and limits: docs/testing/lot3-1-v3-copy-scale.md.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(2);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(0);
select pg_temp.lb29_copy_run(1, array[1000]);
select * from pg_temp.lb29_copy_report();

select is(
  (select string_agg(target || ' ' || outcome, ', ' order by target) from lb29_copy_sample),
  'large ok, small ok',
  'a 1 000-operation copy into a v3 commits in one batch, into an 8-item and into a 1 021-item version'
);

select cmp_ok(
  (select duration_ms from lb29_copy_sample where target = 'large' and size = 1000 and outcome = 'ok'),
  '<=', 3500::numeric,
  'a 1 000-operation copy into the 1 021-item v3 stays within the 3,5 s CI/production maximum of option A'
);

select * from finish();
rollback;
