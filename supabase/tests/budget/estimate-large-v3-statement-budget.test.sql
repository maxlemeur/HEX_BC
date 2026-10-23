-- Large v3 estimate, wall-clock statement budget. Opt-in: DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local runs
-- this directory after supabase/tests/database on an identified native host; never beside an application build.
-- Historical IO01 exceeded the API roles' 8 s statement_timeout in CI (57014); its early local timing probe
-- had 1 021 synthetic items and took 660 ms. The current public workbook probe has 2 031 items; historical
-- timings are not measurements of this larger fixture. No local check guarded that CI regression at the time.
-- Isolation: a journey does not assert the work or the duration of one API statement, and the CI journey only fails
-- once the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
-- Medians of 7 rolled-back runs at the real workbook volume: both creation and settings repricing must stay
-- under 1 000 ms. The former 500 ms pro rata and unasserted settings measurement are retired.
-- Sub-lot 2.8b (L7), owner option A: 7 copies of 1 000 operations into the 2 031-item v3 get 875 ms,
-- the 3 500 ms maximum in CI/production / planning factor 4. This local SQL probe does not measure a full route
-- or prove the CI/production maximum. L4: a batch of 100 operations (paste, undo) gets the interactive 400 ms.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(6);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(7);
select pg_temp.lb29_copy_run(7, array[100, 1000]);
select * from pg_temp.lb29_diag();
select * from pg_temp.lb29_copy_report();

select pg_temp.lb29_succeeded(7);

select cmp_ok(pg_temp.lb29_median('create'), '<=', (select budget_ms from lb29_budget),
  'the 2 031-item v3 creation stays within the local statement budget: ' || pg_temp.lb29_report('create'));

select cmp_ok(pg_temp.lb29_median('settings'), '<=', (select budget_ms from lb29_budget),
  'the real-volume settings save stays within the bulk budget: ' || pg_temp.lb29_report('settings'));

select is((select count(*) from lb29_copy_sample where outcome <> 'ok'), 0::bigint, 'every copy of the probe commits');

select cmp_ok(pg_temp.lb29_copy_median('large', 1000), '<=', (select copy_budget_ms from lb29_budget),
  'a 1 000-operation copy into the 2 031-item v3 stays within option A: local median <= 875 ms (CI/production maximum: 3.5 s)');

select cmp_ok(pg_temp.lb29_copy_median('large', 100), '<=', (select interactive_budget_ms from lb29_budget),
  'a 100-operation batch into the 2 031-item v3 stays within the interactive budget of 400 ms');

select * from finish();
rollback;
