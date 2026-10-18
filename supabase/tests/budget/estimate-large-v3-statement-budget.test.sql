-- Large v3 estimate, wall-clock statement budget. Opt-in: DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local runs
-- this directory after supabase/tests/database, on the machine the budget was calibrated on; never in CI.
-- In CI (sub-lot 2.8, IO01) the atomic creation of the hydraulic OPTIMA lot (1 021 items) exceeded the 8 s
-- statement_timeout of the API roles (57014) while it took 660 ms locally: no local check guarded large volumes.
-- Isolation: a journey does not assert the work or the duration of one API statement, and the CI journey only fails
-- once the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
-- The median of 7 rolled-back runs of the 1 021-item creation stays under 330 ms = 8 s / (CI-under-load factor
-- 12 x safety 2). The settings save is measured and reported the same way.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(2);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(7);
select * from pg_temp.lb29_diag();

select pg_temp.lb29_succeeded(7);

select cmp_ok(pg_temp.lb29_median('create'), '<=', (select budget_ms from lb29_budget),
  'the 1 021-item v3 creation stays within the local statement budget: ' || pg_temp.lb29_report('create'));

-- The v3 settings save repricing all 900 lines is reported by lb29_diag, not asserted: it takes ~540 ms locally,
-- over this budget, and the IO02 settings route on this lot took 3,3-9,9 s in CI (see the document). Its budget
-- assertion belongs with the change that brings it under 330 ms.

select * from finish();
rollback;
