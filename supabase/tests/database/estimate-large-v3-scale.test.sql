-- Large v3 estimate, deterministic checks (every run of db:ci:local, CI included): one run of each statement.
-- In CI (sub-lot 2.8, IO01) the atomic creation of the hydraulic OPTIMA lot (1 021 items) exceeded the 8 s
-- statement_timeout of the API roles (57014) while it took 660 ms locally: no local check guarded large volumes.
-- Isolation: a journey does not assert the work or the duration of one API statement, and the CI journey only fails
-- once the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
-- - the creation updates its version as many times for 1 021 items as for 8 (once); the per-line content revision
--   bump that M6b replays in one pass would update it once per item. The other replayed effects (audit, coverage,
--   depth) write the same rows either way: only the opt-in budget sees them come back;
-- - the v3 settings save (c_FO 1,3 -> 2) rewrites all 900 priced lines, so the budget measures a real repricing.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(5);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(1);
select * from pg_temp.lb29_diag();

select pg_temp.lb29_succeeded(1);

select is(
  (select jsonb_array_length(pg_temp.lb29_items(60, 15))),
  1021,
  'the probe payload has the 1 021 items of the hydraulic OPTIMA lot'
);

select is(
  (select coalesce(max(updates), -1) from lb29_sample where operation = 'create'),
  (select coalesce(max(updates), -2) from lb29_sample where operation = 'create-small'),
  'a 1 021-item creation updates its version as many times as an 8-item one (no per-line revision bump)'
);

select is(
  (select count(*) from public.audit_logs where estimate_version_id = '29200000-0000-4000-8000-000000000101'
    and table_name = 'estimate_items'),
  1021::bigint,
  'the kept creation still writes one audit row per item'
);

select is(
  (select coalesce(min(updates), -1) from lb29_sample where operation = 'settings'),
  900::bigint,
  'the v3 settings save rewrites the price of each of the 900 lines'
);

select * from finish();
rollback;
