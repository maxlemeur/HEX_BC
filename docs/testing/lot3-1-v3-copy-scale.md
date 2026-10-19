# Lot 3.1 — copies at scale into a v3

Plan row 3.1 ([lot 3 plan](lot2-retro-lot3-plan-2026-10-18.md#ordre-proposé-pour-le-lot-3)): diagnose, then optimize
the copy of up to 1 000 operations into a v3 (`POST /api/estimates/{id}/import-sections`, section duplication), one
`public.commit_estimate_batch` statement. Budgets: [large-estimate-statement-budget.md](large-estimate-statement-budget.md)
(L7: local WSL median of 7 ≤ 875 ms; owner option A: 3,5 s at most in CI/production).

## Failure modes and where they are checked

| # | Failure | Check |
|---|---|---|
| C1 | The copy writes its items one statement per operation again (the 1 000 single-row INSERTs were the largest SQL cost) | pgTAP every run: each 1 000-operation copy runs **one** `estimate_items` INSERT (`pg_stat_statements`, nested statements). Red before the migration: 2 000 statements for two copies, 2 expected |
| C2 | The set-based path writes other rows, audit rows, revisions or results than the loop | Differential pgTAP, not committed (see « Reproduce »): same payload through the previous body and the new one, 9 batches; IO13 after reload |
| C3 | A refused batch reports another operation or code, or writes something | pgTAP every run: operation 500 naming a missing parent → `committed: false`, index 500, `ESTIMATE_BATCH_INVALID_INPUT`, 500 rolled back, 0 item written, version unchanged; differential runs: duplicate position (refused inside the INSERT) and parent created later, same index and code through both bodies |
| C4 | The 1 000-operation copy goes over the 3,5 s CI/production maximum | `supabase/tests/ceiling` (new pgTAP pass): single run ≤ 3 500 ms wherever the database checks run alone (local `db:ci:local`, CI E2E RLS Matrix); skipped beside the Army production build |
| C5 | The route reads the whole source version again (6,7 Mo for one section) or the target twice | IO13 traces below (reported); IO13 nested selection copies exactly the selected subtree |
| C6 | Amounts, provenance, revisions or audit change after the copy | IO13 after reload: 999 lines × (130 / 130 / 26 / 156 c), footer 129 870 / 25 974 / 155 844 c, each line's `source_metadata` equal to its source row's (999), content revision +1 001 (1 000 creations, 1 footer write), 1 000 item audit rows |

A wall-clock threshold in IO13 is not deterministic (route, browser, runner load): `elapsedMs` stays reported.

## Diagnosis (before, base `887d0319`)

### SQL: where a 1 000-operation copy spends its time

pgTAP probe L7 (1 section + 999 priced lines with provenance into the 1 021-item v3), WSL, plpgsql_check line profile of
one copy (733 ms with the profiler) and `pg_stat_xact_user_functions` over 3 copies:

| Part of `commit_estimate_batch` | ms | Note |
|---|---:|---|
| Operation loop | 284 | of which **235 ms in its 1 000 single-row INSERTs** (executor and BEFORE row triggers per statement: `derive_estimate_item_v3_columns` 68, `guard_estimate_v2_snapshot_columns` 26, `assign_tenant_id` 23) |
| `private.estimate_v3_assert_draft` (D12, every line and the footer) | 211 | engine 3 recomputation: `estimate_v3_line_values` 2 898 calls, `estimate_allocate_exact` 5 796 calls |
| `estimate_creation_replay_item_effects_for_writer` | 123 | its audit INSERT: 119 ms for 2 000 rows (1 000 version steps, 1 000 items) |
| `canonical_estimate_batch_operations` | 35 | |
| results, receipt | 21 + 13 | |

EXPLAIN (ANALYZE, BUFFERS) of the statements over 15 ms (auto_explain, nested, same payload; the loop's single-row
INSERTs stay under 15 ms each): the replay's audit INSERT 76–102 ms, of which a sort spilled to disk (external merge,
4 760 kB) for 18 ms; the D12 assertion 152 ms; the results aggregation 18 ms; the set-based INSERT (after) 152 ms of
executor time, 1,8 ms of it producing the 1 000 rows, the rest in the per-row triggers and index maintenance
(41 581 shared buffer hits).

### HTTP: IO13 at the limit, split by server call

Owned native stack (dev loop, production build), IO13 alone (one worker), the Next server's PostgREST calls traced by a
diagnostic patch (not committed), the SQL time of the RPC from `pg_stat_statements`. Five runs before, seven after
(the first after-run follows a rebuild). Raw rows: [lot3-1-v3-copy-scale/io13-route-samples.tsv](lot3-1-v3-copy-scale/io13-route-samples.tsv).

| Median | Before (5) | After (7) |
|---|---:|---:|
| Route (`import-sections`, 999 lines) | **1 282 ms** | **777 ms** |
| `estimate_items` reads | 11 requests, 6 679 Ko, 169 ms | 4 requests, 1 878 Ko, 49 ms |
| Other reads (access, lease, version, flags) | 13 requests, 62 ms | 13 requests, 61 ms |
| Receipt lookup (`get_estimate_batch_receipt`) | 12 ms | 10 ms |
| `commit_estimate_batch` call / its SQL | 828 / **783 ms** | 523 / **487 ms** |
| Outside calls (JSON, preparation, planning) | 212 ms | 134 ms |

Before, the route read the **whole source version** (the anchor: 4 000 items, nine pages of 500, 6,7 Mo) to copy one
section of 999 lines, then the target twice (its reader and the batch preparation), and the preparation rebuilt the
hierarchy index of every item at each of the 1 000 operations. The CI run of #59 (7 984 ms, RPC about 1,7 s) is
consistent with reads and JSON work weighing far more under CI load than locally; no CI trace was taken.

## Changes

1. **Migration `20261019123000_estimate_batch_set_based_creates.sql`** (CREATE OR REPLACE of
   `public.commit_estimate_batch` from its latest body, `20261018180306`; signature, owner, grants, SECURITY DEFINER and
   `search_path` kept). A batch of creations only that names every position and title and carries no takeoff source
   builds each row exactly as the loop does, runs the loop's checks over the whole batch (parent: a stored section or a
   section created earlier in the batch; categories, supply types, products, supplier prices locked FOR SHARE NOWAIT;
   labour roles), then inserts every row in batch order with one INSERT. BEFORE row triggers, constraints and foreign
   keys still run per row; the AFTER row effects stay with the M6b replay, unchanged. Any refusal or error rolls the block
   back and the unchanged loop runs, so a refused batch reports the same operation, index and code. Other batches keep
   the loop. The per-row triggers redefined by `20261018204500` are not touched.
2. **Route** — `readEstimateItemSubtrees` (`src/lib/estimates/read-all-items-server.ts`): a copy reads the selected
   sections and their descendants level by level (by pages, `in` filters of 100 ids), then checks the version as before
   (`assertEstimateVersionUnchanged`); used by section import and duplication. The target items read by the import
   reach the batch preparation (`targetItems`, server-side copies only), which no longer reads them again. The
   preparation uses the live item map as hierarchy index for created items and scans siblings only for a default
   position.
3. **Tests** — every-run pgTAP (C1, C3); new `supabase/tests/ceiling` pass (C4) run by `runLocalSupabaseCi` unless the
   caller starts work alongside the database checks (`onStackStarted`, the Army production build); IO13 (C5, C6).

## Results (after)

### SQL, identical data

| Measure (WSL, 1 000 operations into the 1 021-item v3) | Before | After |
|---|---:|---:|
| Same transaction, previous body vs new body, alternated, 7 each | 593,0 ms (575.6 581.1 582.4 628.5 577.2 617.7 605.8) | **459,7 ms** (456.2 472.4 484.9 458.7 482.1 458.0 459.7) |
| Budget pass, median of 7, alternated A/B runs (base migrations, then lot 3.1), round 1 | 650,3 ms (705.0 626.4 648.9 701.7 670.9 642.5 650.3) | 477,4 ms (490.7 464.0 466.3 477.4 477.7 468.9 490.0) |
| same, round 2 | 621,8 ms (631.6 646.3 603.1 620.7 624.3 615.0 621.8) | 468,9 ms (487.5 484.7 465.7 461.6 468.1 493.6 468.9) |
| Final full run (`DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local`), median of 7 | 591,5 ms (full base run) | **458,0 ms** (455.7 457.0 457.8 471.8 480.6 458.0 472.3), budget 875 ms |
| 100-operation batch (L4), median of 7 | 147,9 ms | 120,1 ms |

Profile after (one profiled copy, 536 ms): set-based INSERT 128 ms, D12 174 ms, replay 111 ms, canonicalization 34 ms,
building the rows 13 ms. The differential runs give the same items, audit rows (minus their id and time), version,
results, totals and receipt operations through both bodies for 3 copy payloads (1 000 into the large and the small v3,
100 into the large one) and 6 varied batches (three section levels; lines under each level and under a stored sub-lot;
labour role, per-unit hours, category, explicit and derived line natures, `for_memory`; a duplicate position; a parent
created after its child), with one INSERT statement for the committed varied batch.

### CI maximum: why the ceiling skips the Army jobs

Every-run probe, 1 000 operations into the large v3, all CI logs from 18/10 18:25 UTC to 19/10 12:07 UTC (303 samples,
78 runs, base code; inventory: [lot3-1-v3-copy-scale/l7-ci-inventory.tsv](lot3-1-v3-copy-scale/l7-ci-inventory.tsv)):

| Job | Samples | Median | p95 | Max | Over 3,5 s |
|---|---:|---:|---:|---:|---:|
| E2E RLS Matrix (`db:ci:local` alone) | 22 | 1 521 ms | 2 269 ms | **2 277 ms** | 0 |
| Army critical shards (pgTAP beside the production build) | 221 | 1 931 ms | 3 727 ms | 5 596 ms | 12 |
| Army takeoff shards (same) | 60 | 1 799 ms | 3 672 ms | 3 954 ms | 3 |

The « about 2,4 s » CI maximum holds only where the database checks run alone. In the Army jobs `run-tester-army-ci`
starts the production build as soon as the stack runs, alongside the snapshot, pgTAP and RLS phases: a single-run 3,5 s
assertion there would have failed 15 of 281 correct runs (5,3 %). The ceiling pass therefore runs wherever nothing is
started alongside the database checks (it is logged as skipped otherwise); the Army journeys (IO13) keep the end-to-end
proof. With the −25 % above, the RLS Matrix maximum projects to about 1,7 s, half the ceiling. This does not prove the
3,5 s for production.

### Journeys

| Run | Command | Result |
|---|---|---|
| IO13 extended, base build | dev loop, `run --grep 'IO13 a section copy'` | pass (the new exactness assertions hold before the change) |
| IO13 × 7 after | same, final sources | pass ×7 |
| Qualifying selection | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --grep 'IO07 \|IO10 \|IO11 \|IO13 \|V3E05 \|V3E06 \|V3E12 \|V3E13 \|PG1000 \|LC0[1-5] \|RL0[1-5] ' --app-port 3171` | **20 of 20 passed** (setup, IO07/10/11/13, V3E05/06/12/13, PG1000, LC01–05, RL01–05), 0 skipped, 0 flaky; owned stack, migrations, pgTAP, RLS matrix, production build; ceiling pass logged as skipped beside the build. Evidence `.e2e/army/ci/2026-10-19T13-13-35-693Z-critical/manifest.json` (SHA-256 `021ceb25…c8fe`) in the WSL clone |

## Validation

Recorded in the commit's hand-off; logs under `~/lot31-evidence/` in the WSL clone `~/miaouffrage-lot31`
(copy of this worktree, compared file by file before each run).

| Check | Command | Result |
|---|---|---|
| Red, pgTAP C1 | `npm run db:ci:local -- --files estimate-large-v3-scale.test.sql --skip-rls` on base migrations | 1 of 10 fails: 2 000 INSERT statements, 2 expected |
| Red, runner | `npx vitest run --project=node src/test/local-supabase-ci.test.ts` against the base runner | 2 of 33 fail |
| pgTAP + ceiling + RLS | `npm run db:ci:local` | 28 files, 2 047 assertions; ceiling 2 of 2 (482 ms); RLS matrix passed |
| Quality | `npm run verify:pr` | pass: node 3 305 tests (2 skipped, the RLS e2e file run by the matrix), jsdom 831, boundary coverage 12; audit, architecture, OpenAPI, typecheck, lint. The copy-source isolation doubles (`server.copy-source.test.ts`, P1–P4) learned the `in` filter of the subtree reads |
| Budgets | `DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local` | L2, L4, L7, v2 copy pass; **L8 reorder fails on base too** (median 471 ms, two runs near 2 s after the full pgTAP phase; 345–364 ms when only one pgTAP file precedes it): pre-existing, not in this lot |

## Limits

- Local WSL measurements on a shared host (load 0,3–3 before runs); no CI trace of the route: the CI share of reads in
  the #59 run is inferred, not measured.
- The receipt is still about 2 Mo, parsed and checked by the route; JSON work and the 13 small reads around the RPC are
  unchanged. The replay's audit INSERT (≈100 ms, a sort spilling to disk) and the D12 assertion (≈150–210 ms) are now the
  largest SQL costs; both carry contracts (audit rows, D12) and are left for a later lot.
- A batch with a default position or title, or a takeoff source (a same-version copy of takeoff lines), keeps the loop.
- The editor batch coverage harnesses (`BC01`–`BC04`, `WFC01`) run in the explicit coverage mode with their own profiles;
  they were not rerun here. V3E05, V3E06, V3E12 and V3E13 (v3 editor batches, paste) were.

## Reproduce

The differential and EXPLAIN probes are not committed. Generate the previous body as a function next to the test
(`public.lot31_commit_estimate_batch_loop`, from `20261018180306`), place the probe under `supabase/tests/database/`
with that file, and run `npm run db:ci:local -- --files <probe> --skip-rls`; the probes and the generator are kept with
the session's evidence. `pg_stat_statements.track`, `track_functions` and `auto_explain.*` are accepted for `postgres`
on the native runtime (`set local`); `LOAD 'auto_explain'` is not needed (preloaded).
