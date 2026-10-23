-- Large v3 estimate, deterministic checks (every run of db:ci:local, CI included): one run of each statement.
-- Historical IO01 exceeded the API roles' 8 s statement_timeout in CI (57014); its early local timing probe
-- had 1 021 synthetic items and took 660 ms. The current public workbook probe has 2 031 items; historical
-- timings are not measurements of this larger fixture. No local check guarded that CI regression at the time.
-- Isolation: a journey does not assert the work or the duration of one API statement, and the CI journey only fails
-- once the timeout is crossed. Contract, budget derivation and limits: docs/testing/large-estimate-statement-budget.md.
-- - the creation updates its version as many times for 2 031 items as for 8 (once); the per-line content revision
--   bump that M6b replays in one pass would update it once per item. The other replayed effects (audit, coverage,
--   depth) write the same rows either way: only the opt-in budget sees them come back;
-- - the v3 settings save (c_FO 1,3 -> 2) rewrites the 785 nonzero workbook lines, so it measures real repricing;
-- - sub-lot 2.8b (L7): a 1 000-operation copy (the cap of a copy into a v3, each line with its import provenance) into
--   an 8-item and into the 2 031-item v3 (commit_estimate_batch) commits, its receipt (which does not echo the
--   provenance) under 2 Mio, and updates none of the lines already stored. Before 20261018180306 the v3
--   projection rewrote every line of the version, each no-op update firing the per-line revision bump and audit
--   (4,1 s for 100 operations locally, the IO13 timeout in CI), and the receipt went over 2 Mio with the provenance;
-- - lot 3.1: each copy writes its 1 000 items with one INSERT statement, not one per operation (pg_stat_statements,
--   nested statements): 1 000 single-row INSERTs took 235 ms of a 733 ms copy in WSL; a copy whose operation 500 names
--   a parent that does not exist is refused at that operation by the same loop as before (index 500, the 500 previous
--   ones rolled back) and writes nothing. The 3,5 s CI/production maximum of that copy is asserted by
--   supabase/tests/ceiling where the database checks run alone (docs/testing/lot3-1-v3-copy-scale.md).
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
select plan(14);

\ir ../fixtures/large-v3-estimate.sql
select pg_temp.lb29_run(1);
-- Nested statements too (the INSERTs inside commit_estimate_batch), for this transaction only.
set local pg_stat_statements.track = 'all';
select set_config('lb29.copy_inserts_before', pg_temp.lb29_batch_insert_statements()::text, true);
select pg_temp.lb29_copy_run(1, array[1000]);
select set_config('lb29.copy_inserts', (pg_temp.lb29_batch_insert_statements()
  - current_setting('lb29.copy_inserts_before')::bigint)::text, true);
select * from pg_temp.lb29_diag();
select * from pg_temp.lb29_copy_report();

select pg_temp.lb29_succeeded(1);

select is(
  (select jsonb_array_length(items) from lb29_payload where operation = 'create-kept'),
  2031,
  'the probe consumes all 2 031 items of the hydraulic workbook used by IO01'
);

select is((select count(*) from public.estimate_items where version_id = '29200000-0000-4000-8000-000000000101'
  and item_type = 'section'), 131::bigint, 'the workbook hierarchy keeps 131 sections including the import root');
select is((select count(*) from public.estimate_items where version_id = '29200000-0000-4000-8000-000000000101'
  and item_type = 'line'), 1900::bigint, 'all 1 900 workbook lines enter the SQL target');
select is((select count(*) from public.estimate_items where version_id = '29200000-0000-4000-8000-000000000101'
  and item_type = 'line' and quantity > 0 and pu_ht_cents > 0), 785::bigint, 'the public workbook keeps its 785 priced lines');
select is((select jsonb_object_agg(pricing_status, count) from (select pricing_status, count(*) from public.estimate_items
  where version_id = '29200000-0000-4000-8000-000000000101' and item_type = 'line' group by pricing_status) counts),
  '{"priced":1821,"out_of_scope":61,"included":10,"not_priced":7,"for_memory":1}'::jsonb,
  'the SQL target preserves the actual workbook pricing statuses and zero-price rows');
select is((select total_ht_cents from public.estimate_versions where id = '29200000-0000-4000-8000-000000000101'),
  6729803, 'the public workbook retains its independent HT oracle at 1.30 / 1.20');

select is(
  (select coalesce(max(updates), -1) from lb29_sample where operation = 'create'),
  (select coalesce(max(updates), -2) from lb29_sample where operation = 'create-small'),
  'a 2 031-item creation updates its version as many times as an 8-item one (no per-line revision bump)'
);

select is(
  (select count(*) from public.audit_logs where estimate_version_id = '29200000-0000-4000-8000-000000000101'
    and table_name = 'estimate_items'),
  2031::bigint,
  'the kept creation still writes one audit row per item'
);

select is(
  (select coalesce(min(updates), -1) from lb29_sample where operation = 'settings'),
  785::bigint,
  'the settings probe really reprices the 785 nonzero workbook lines'
);

select is(
  (select string_agg(target || ' ' || outcome, ', ' order by target) from lb29_copy_sample),
  'large ok, small ok',
  'a 1 000-operation copy into a v3 commits in one batch, into an 8-item and into a 2 031-item version'
);

select is(
  (select updates from lb29_copy_sample where target = 'large'),
  0::bigint,
  'a copy into the 2 031-item v3 updates none of its stored lines (the projection keeps unchanged amounts)'
);

select is(
  current_setting('lb29.copy_inserts')::bigint,
  2::bigint,
  'each 1 000-operation copy (into the 8-item and the 2 031-item v3) writes its items with one INSERT statement'
);

select is(
  pg_temp.lb29_copy_refused_at(500),
  jsonb_build_object('committed', false, 'results', 501, 'index', 500, 'code', 'ESTIMATE_BATCH_INVALID_INPUT',
    'rolled_back', 500, 'items_written', 0, 'version_unchanged', true),
  'a 1 000-operation copy whose operation 500 names a missing parent is refused at that operation, nothing written'
);

select * from finish();
rollback;
