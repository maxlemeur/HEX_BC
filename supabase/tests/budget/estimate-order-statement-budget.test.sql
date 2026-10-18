-- Reorder and move of ~1 000 siblings in a v2 draft, wall-clock statement budget. Opt-in:
-- DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local runs this directory after supabase/tests/database, in WSL; never in
-- CI.
-- Both RPCs rewrite every sibling of the parents they touch twice; with the per-row content revision step and audit rows
-- under RLS, about 1 000 siblings exceeded the 8 s statement_timeout of the API roles at the CI load factor (57014).
-- Isolation: a journey does not assert the duration of one API statement, and only fails once the timeout is crossed.
-- Contract and budget: docs/testing/reorder-move-large-v2.md and docs/testing/large-estimate-statement-budget.md.
-- Reorder and move are interactive statements: the median of 7 rolled-back runs by the owner through the API role stays
-- within the interactive tier, 400 ms (1 s / planning factor 2,5), for the reversal of a section of 1 000 lines (2 000
-- row writes) and for the move of its first line into a section of 3 lines (2 006 row writes). The move of that line into
-- a section of 999 lines (3 998 row writes, twice the rows and audit rows) is reported, not asserted (see the document,
-- « Limits »).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(3);

\ir ../fixtures/order-items-estimate.sql
select pg_temp.ro29_version('29500000-0000-4000-8000-000000000014', '29500000-0000-4000-8000-000000000105',
  pg_temp.ro29_large_section('29500000-0000-4000-8400-', 'a000', 1, 'Lot A', 1000)
  || pg_temp.ro29_large_section('29500000-0000-4000-8400-', 'b000', 2, 'Lot B', 999)
  || pg_temp.ro29_large_section('29500000-0000-4000-8400-', 'c000', 3, 'Lot C', 3)) is not null as large_version_created;

-- Statements are built before the clock, as the estimate API builds its lists before its call.
create temporary table ro29_statement as
select 'reorder'::text as operation, pg_temp.ro29_reorder_sql('29500000-0000-4000-8000-000000000105',
    '29500000-0000-4000-8400-a00000000000', (select array_agg(item.id order by item.position desc)
      from public.estimate_items item where item.parent_id = '29500000-0000-4000-8400-a00000000000')) as statement
union all
-- Line 1 of Lot A (1 000 lines) moved second into Lot C (3 lines): both lists rewritten, 2 006 row writes.
select 'move', pg_temp.ro29_move_sql('29500000-0000-4000-8000-000000000105', '29500000-0000-4000-8400-a00000000001',
    '29500000-0000-4000-8400-a00000000000', '29500000-0000-4000-8400-c00000000000',
    (select array_agg(item.id order by item.position) from public.estimate_items item
      where item.parent_id = '29500000-0000-4000-8400-a00000000000' and item.position > 1),
    array['29500000-0000-4000-8400-c00000000001', '29500000-0000-4000-8400-a00000000001',
      '29500000-0000-4000-8400-c00000000002', '29500000-0000-4000-8400-c00000000003']::uuid[])
union all
-- Line 1 of Lot A moved to position 500 of Lot B (999 lines): 3 998 row writes, reported only.
select 'move-1000-999', pg_temp.ro29_move_sql('29500000-0000-4000-8000-000000000105', '29500000-0000-4000-8400-a00000000001',
    '29500000-0000-4000-8400-a00000000000', '29500000-0000-4000-8400-b00000000000',
    (select array_agg(item.id order by item.position) from public.estimate_items item
      where item.parent_id = '29500000-0000-4000-8400-a00000000000' and item.position > 1),
    (select array_agg(entry.id order by entry.rank) from (
      select item.id, item.position * 2 as rank from public.estimate_items item
      where item.parent_id = '29500000-0000-4000-8400-b00000000000'
      union all select '29500000-0000-4000-8400-a00000000001'::uuid, 999) entry));

select pg_temp.ro29_measure(statement.operation, run, statement.statement)
from ro29_statement statement cross join generate_series(1, 7) run
order by statement.operation, run;

select diag('statement_timeout of the API roles: ' || coalesce((select string_agg(role.rolname || ' '
  || coalesce(array_to_string(role.rolconfig, ','), 'default'), '; ' order by role.rolname) from pg_roles role
  where role.rolname in ('anon', 'authenticated', 'authenticator', 'service_role')), 'none'));
select diag('server: ' || version());
select diag(pg_temp.ro29_report('reorder'));
select diag(pg_temp.ro29_report('move'));
select diag(pg_temp.ro29_report('move-1000-999'));

select results_eq(
  $$select operation, outcome, updates from ro29_sample order by operation, run$$,
  $$select 'move'::text, '1003'::text, 1::bigint from generate_series(1, 7)
    union all select 'move-1000-999', '1999', 1 from generate_series(1, 7)
    union all select 'reorder', '1000', 1 from generate_series(1, 7)$$,
  'every probe run succeeds and updates its version once (failure: ' || coalesce((select string_agg(distinct outcome, '; ')
    from ro29_sample where outcome !~ '^[0-9]+$'), 'none') || ')');

select cmp_ok(pg_temp.ro29_median('reorder'), '<=', (select budget_ms from ro29_budget),
  'the reversal of 1 000 lines stays within the local statement budget: ' || pg_temp.ro29_report('reorder'));
select cmp_ok(pg_temp.ro29_median('move'), '<=', (select budget_ms from ro29_budget),
  'the move out of a section of 1 000 lines into a section of 3 lines stays within the local statement budget: ' || pg_temp.ro29_report('move'));

select * from finish();
rollback;
