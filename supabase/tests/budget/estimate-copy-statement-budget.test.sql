-- Copy into a v1/v2 draft, wall-clock statement budget. Opt-in: DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local
-- runs this directory after supabase/tests/database, on the machine the budget was calibrated on; never in CI.
-- About 1 000 copied items exceeded the 8 s statement_timeout of the API roles (57014) when each item ran the insert
-- policy and the per-item triggers under RLS. Isolation: a journey does not assert the duration of one API statement,
-- and only fails once the timeout is crossed. Contract and budget: docs/testing/copy-large-v2.md and
-- docs/testing/large-estimate-statement-budget.md.
-- The median of 7 rolled-back copies of a section of 999 lines (1 000 items) into an empty v2 draft, by its owner
-- through the API role, stays under 330 ms = 8 s / (CI-under-load factor 12 x safety 2).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(2);

\ir ../fixtures/copy-items-estimate.sql
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000108', 999, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000308') is not null as large_source_created;
select pg_temp.cp29_version('29300000-0000-4000-8000-000000000104', 0, '29300000-0000-4000-8000-000000000001',
  '29300000-0000-4000-8000-000000000304') is null as empty_target_created;
-- Payloads are built before the clock, as the estimate API builds them before its call.
create temporary table cp29_payload as
select run, pg_temp.cp29_copy((select id from public.estimate_items
    where version_id = '29300000-0000-4000-8000-000000000108' and parent_id is null),
  '29300000-0000-4000-8000-000000000104', 1) as items
from generate_series(1, 7) run;
select pg_temp.cp29_measure('copy', payload.run, '29300000-0000-4000-8000-000000000104',
  '29300000-0000-4000-8000-000000000304', payload.items)
from cp29_payload payload order by payload.run;

select diag('statement_timeout of the API roles: ' || coalesce((select string_agg(role.rolname || ' '
  || coalesce(array_to_string(role.rolconfig, ','), 'default'), '; ' order by role.rolname) from pg_roles role
  where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')), 'none'));
select diag('server: ' || version());
select diag(pg_temp.cp29_report('copy'));

select results_eq(
  $$select outcome, updates from cp29_sample where operation = 'copy' order by run$$,
  $$select 'ok'::text, 1::bigint from generate_series(1, 7)$$,
  'every 1 000-item copy of the probe succeeds and updates its version once (failure: ' || coalesce((select string_agg(distinct outcome, '; ')
    from cp29_sample where outcome <> 'ok'), 'none') || ')');

select cmp_ok(pg_temp.cp29_median('copy'), '<=', (select budget_ms from cp29_budget),
  'the 1 000-item copy into a v2 draft stays within the local statement budget: ' || pg_temp.cp29_report('copy'));

select * from finish();
rollback;
