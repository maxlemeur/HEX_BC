-- Large v3 estimate, wall-clock statement budget. Opt-in: DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local runs
-- this directory after supabase/tests/database, in WSL, where it is calibrated; never in CI.
-- In CI (sub-lot 2.8, IO01) the atomic creation of the hydraulic OPTIMA lot (1 021 items) exceeded the 8 s
-- statement_timeout of the API roles (57014) while it took 660 ms locally: no local check guarded large volumes.
-- Isolation: a journey does not assert the work or the duration of one API statement, and the CI journey only fails
-- once the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
-- Medians of 7 rolled-back runs. An atomic bulk operation stays under 1 000 ms = 8 s / (planning factor F = 4
-- x margin 2) at the real volume: 500 ms pro rata
-- for this 1 021-item creation against the 2 031-item hydraulic v3. The settings save is measured and reported the
-- same way. Sub-lot 2.8b (L7), owner option A: 7 copies of 1 000 operations into the 1 021-item v3 get 875 ms,
-- the 3 500 ms maximum in CI/production / planning factor 4. This local SQL probe does not measure a full route
-- or prove the CI/production maximum. L4: a batch of 100 operations (paste, undo) gets the interactive 400 ms.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(5);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(7);
select pg_temp.lb29_copy_run(7, array[100, 1000]);
select * from pg_temp.lb29_diag();
select * from pg_temp.lb29_copy_report();

select pg_temp.lb29_succeeded(7);

select cmp_ok(pg_temp.lb29_median('create'), '<=', (select budget_ms from lb29_budget),
  'the 1 021-item v3 creation stays within the local statement budget: ' || pg_temp.lb29_report('create'));

-- The v3 settings save repricing all 900 lines is reported by lb29_diag, not asserted: it takes ~816 ms in WSL, over
-- the provisional 500 ms pro rata. Its budget assertion belongs
-- with the change that brings it under 500 ms.

select is((select count(*) from lb29_copy_sample where outcome <> 'ok'), 0::bigint, 'every copy of the probe commits');

select cmp_ok(pg_temp.lb29_copy_median('large', 1000), '<=', (select copy_budget_ms from lb29_budget),
  'a 1 000-operation copy into the 1 021-item v3 stays within option A: local median <= 875 ms (CI/production maximum: 3.5 s)');

select cmp_ok(pg_temp.lb29_copy_median('large', 100), '<=', (select interactive_budget_ms from lb29_budget),
  'a 100-operation batch into the 1 021-item v3 stays within the interactive budget of 400 ms');

select * from finish();
rollback;
