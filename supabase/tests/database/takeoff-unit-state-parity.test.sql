-- Lot 3, migration A (20261121181031_takeoff_plan_dispatcher.sql): the state of a unit is decided in SQL
-- (private.takeoff_unit_state) and derived again in TypeScript for the activity centre's batched reads
-- (deriveTakeoffRequestUnits, src/lib/takeoff/request-activity.ts). Both read the one matrix below:
-- src/lib/takeoff/unit-state-parity.test.ts runs the same rows through the TypeScript derivation and requires the same
-- states. A row added here is checked on both sides. All values are fictional.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select no_plan();

-- unit-state-matrix:begin
create temp table matrix (n integer, status text, outcome text, code text, started boolean, expected text);
insert into matrix values
  (1, 'pending', null, null, false, 'queued'),
  (2, 'processing', null, null, true, 'running'),
  (3, 'processing', null, null, false, 'running'),
  (4, 'failed', null, 'AI_TIMEOUT', true, 'queued'),
  (5, 'completed', 'success', null, true, 'succeeded'),
  (6, 'completed', null, null, true, 'succeeded'),
  (7, 'applied', null, null, true, 'succeeded'),
  (8, 'applied', 'success', null, true, 'succeeded'),
  (9, 'canceled', 'canceled', null, false, 'canceled'),
  (10, 'canceled', null, null, true, 'canceled'),
  (11, 'failed', 'failure', 'AI_PROVIDER', true, 'failed'),
  (12, 'failed', 'failure', 'AI_PROVIDER', false, 'not_started'),
  (13, 'failed', 'failure', 'TAKEOFF_WORKER_NOT_STARTED', true, 'not_started'),
  (14, 'failed', 'failure', 'TAKEOFF_WORKER_QUEUE_EXPIRED', true, 'not_started'),
  (15, 'failed', 'failure', 'TAKEOFF_WORKER_HOST_SILENT', true, 'not_started'),
  (16, 'failed', 'failure', 'TAKEOFF_REQUEST_BUDGET_EXHAUSTED', false, 'not_started'),
  (17, 'failed', 'failure', 'TAKEOFF_USAGE_UNRECORDED', false, 'not_started'),
  (18, 'failed', 'failure', 'TAKEOFF_USAGE_UNRECORDED', true, 'failed'),
  (19, 'failed', 'failure', 'TAKEOFF_PREPARATION_SOURCE_CHANGED', true, 'failed'),
  (20, 'failed', 'failure', 'TAKEOFF_WORKER_OUTCOME_UNKNOWN', true, 'failed');
-- unit-state-matrix:end

select results_eq($$select n, private.takeoff_unit_state(status, outcome, code, case when started then now() end) from matrix order by n$$,
  $$select n, expected from matrix order by n$$, 'each job gives its unit the state of the matrix, as the activity centre derives it');

select * from finish();
rollback;
