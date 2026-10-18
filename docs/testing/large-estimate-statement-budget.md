# Large v3 estimate: local statement budget

Sub-lot 2.8 (IO01, 18/10/2026): creating the v3 of the hydraulic OPTIMA lot (1 021 items) through
`persist_estimate_creation_atomic` took 660 ms on the owner's Mac but exceeded the 8 s `statement_timeout` of
the API roles in CI (`57014`). No local check covered large volumes, so the regression first showed up as a CI
journey failure. M6b (`20261018013249`, see [estimate-engine-v3-2.8.md](estimate-engine-v3-2.8.md), « Création
atomique ») fixed it. This guard makes the same kind of regression fail in `npm run db:ci:local` before CI: a
deterministic check on every run, and a wall-clock budget on the calibrated machine when asked for.

## Failure modes and where they are checked

| # | Failure | Check |
| --- | --- | --- |
| L1 | The per-line content revision bump comes back on the creation path (the version updated once per item, the main cost in IO01) | pgTAP, **every run, CI included**: a 1 021-item creation updates its version as many times as an 8-item creation. The other effects M6b replays (item audit, coverage invalidation, depth check) write the same rows on both paths, so no row count separates them: only L2 sees them come back |
| L2 | The creation gets slower without per-line version updates (a new BEFORE row trigger with a lookup, a slower D12 check, a missing index, a heavier audit) | pgTAP, **opt-in** on the calibrated machine: median of 7 rolled-back creations ≤ 330 ms |
| L3 | The v3 settings save (`save_estimate_settings_atomic`, every line's projection checked and written in one statement) slows down on 1 021 items | Every run: the save rewrites all 900 lines (so the measurement is a real repricing). Opt-in: median of 7 saves **reported, not asserted**. It is already over the budget (see « Settings save ») |
| L4 | The v3 batch writer (`commit_estimate_batch`, paste and undo in batches of 100) slows down | Through L7 since 2.8b: the copy probe is a batch of creates. The assumption « ≤ 100 items, far from the timeout » was wrong on a large v3 until `20261018160000` (see « Copy into a v3 ») |
| L7 | A copy into a v3 (2.8b: sections, linked DPGF; one `commit_estimate_batch` of at most 100 operations) rewrites the stored lines again or slows down | pgTAP, **every run**: a 100-operation copy into the 1 021-item v3 commits and updates **0** stored lines. **Opt-in**: median of 7 such copies ≤ 330 ms |
| L5 | The route, serialization or UI around the RPC is slow (time to « Devis créé », settings PATCH) | TesterArmy: IO01 step durations in `report.json` and the `io-settings-*` business artifacts (`elapsedMs.save`); reported, no threshold |
| L6 | The 8 s timeout of the API roles changes | Reported by the probes (`diag` of `pg_roles.rolconfig`); the budget must then be derived again |
| — | Reading a large estimate (`GET /api/estimates`, the ~60 s stall) | Out of scope: a separate investigation covers it |

pgTAP takes the statement-level failures (L1–L3): no browser, and the work done is deterministic. A wall-clock
threshold in a journey would measure the route, the browser and the runner load together, and would still only
fail once the 8 s timeout was crossed.

## Probes

The shared fixture [`supabase/tests/fixtures/large-v3-estimate.sql`](../../supabase/tests/fixtures/large-v3-estimate.sql)
(included with `\ir`, not a test file) builds the IO01 profile and runs the statements:

1. tenant on engine 3 (c_FO 1,3, c_MO 1,2); payload: one import root, 60 lots each with one sub-lot, 15 priced v3
   lines per sub-lot (1 021 items), DPGF provenance and OPTIMA structure metadata, as in the 2.8 timing probe.
   Supply costs vary per line (5–45 €). Their engine 3 amounts come from `private.estimate_v3_compute_items`,
   the D12 reference, before the clock starts;
2. N creations, each rolled back in its own subtransaction, plus one 8-item creation, with the `estimate_versions`
   update count of each (`pg_stat_xact_user_tables`);
3. one kept creation and its draft lease, then N rolled-back v3 settings saves (c_FO 1,3 → 2) with the projection
   of all 900 lines at the new coefficient, as the settings route sends it, and the `estimate_items` update count;
4. `diag` lines with the role timeouts, the server version, every run's duration and the probe's own time.

Two files use it:

| File | Runs | When | Assertions |
| --- | --- | --- | --- |
| [`supabase/tests/database/estimate-large-v3-scale.test.sql`](../../supabase/tests/database/estimate-large-v3-scale.test.sql) | N = 1 | every `db:ci:local`, so every CI job that runs it | all statements succeed, payload size, L1, one audit row per item, the settings save rewrites 900 lines |
| [`supabase/tests/budget/estimate-large-v3-statement-budget.test.sql`](../../supabase/tests/budget/estimate-large-v3-statement-budget.test.sql) | N = 7 | only with `DB_CI_STATEMENT_BUDGET=enforce`, after the main pgTAP phase | all statements succeed, L2 (creation median ≤ 330 ms); settings median reported |

The budget is opt-in rather than inferred from the platform: another Mac model, a VM or a loaded host is not the
calibrated machine, and a wall-clock assertion must not fail correct code there. The Supabase CLI does not forward
`PGOPTIONS` to pg_prove, and the `postgres` role cannot attach a custom setting to the database. So the runner
runs the `supabase/tests/budget` directory as a second pgTAP pass. CI never sets the variable.

```bash
npm run db:ci:local
```

```bash
DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local
```

## Budget derivation

- **Timeout** T = 8 s. The probes' `diag` reads it locally: `authenticator` and `authenticated` carry
  `statement_timeout=8s` (`anon` 3 s) and `service_role` has none of its own. PostgREST connects as
  `authenticator` and switches role, so the RPC called by the service-role client runs under the 8 s of
  `authenticator`. The probes call the RPCs from psql without that timeout and measure them instead.
- **CI-under-load factor** F, for the army-critical job (Next server and two browser workers on a shared runner):
  - lower bound 12,1: before M6b, local median 660,5 ms and IO01 timed out in CI (≥ 8 s);
  - upper bound 18,6: after M6b, local median 245,0 ms (the 2.8 measurement of the final M6b), and CI run
    [39100138108](https://github.com/maxlemeur/HEX_BC/actions/runs/39100138108) (`f00da33b`) waited 4 568 ms
    from « Confirmer l'import » to the « Devis créé » heading in IO01. That wait includes the route and the UI,
    so the RPC took at most that long;
  - one sample for each bound, on a runner whose load varies. Treat F ≈ 12–19 as an estimate, not a constant;
  - for comparison, the quiet pgTAP job (`E2E RLS Matrix`) ran the 22-file suite in 4–8 s against 3 s locally
    before these probes (pg_prove rounds to the second), about 1,5–2,7×: most of the factor comes from contention
    in the journey job, not from the database alone.
- **Budget** B = T / (F_low × 2) = 8 000 / 24 ≈ **330 ms**. At the upper bound, 330 ms × 18,6 ≈ 6,1 s, still under
  8 s. The budget stops protecting CI if F reaches about 24.

## Settings save: already over the budget

With every line repriced, the settings save of the 1 021-item estimate takes a median of **546 ms** locally (7 runs,
539–549 ms), against 248 ms for the creation. At F = 12–19 that is 6,5–10 s, at or over the 8 s timeout. CI
agrees: in IO02 (the same hydraulic lot, then c_FO/c_MO changed twice), the settings `PATCH` route took 3,3 s and
6,6 s in run 39100138108 and 9,9 s and 9,4 s in run
[39088903048](https://github.com/maxlemeur/HEX_BC/actions/runs/39088903048), all answering 200. The route also
reads the estimate, so the RPC took less, but the margin under 8 s is thin. The budget file therefore reports the
settings median without asserting it. The assertion belongs with the change that brings the save under 330 ms.
Before M6b the same save took 702 ms locally, so M6b already helped it.

The first version of this probe sent all-zero lines. Changing c_FO then left every projection identical to the
stored row, and the save's `IS DISTINCT FROM` filter skipped all 900 writes (~75 ms). The every-run assertion
« rewrites 900 lines » now keeps the measurement honest.

## Copy into a v3 (2.8b, L7)

Review of PR #59 (18/10/2026): IO13 copied 1 000 operations into a v3 and timed out in CI (run
[39138950745](https://github.com/maxlemeur/HEX_BC/actions/runs/39138950745), 503 `BATCH_OUTCOME_UNKNOWN`, nothing
written). The probe `pg_temp.lb29_copy_run` (one root section and N - 1 priced lines carrying their provenance, rolled
back, as the owner) measured it in WSL on a loaded Windows host, about twice slower than the calibrated Mac (the
creation took 415–480 ms there against 245 ms):

| Copy | Before `20261018160000` (5 runs) | After (7 runs for 100, 3 for 1 000) |
| --- | --- | --- |
| 100 operations into the 8-item v3 | 554 ms | **173 ms** |
| 100 operations into the 1 021-item v3 | 4 102 ms | **282 ms**, 0 line updates |
| 1 000 operations, 8-item / 1 021-item v3 | 10 263 / 15 184 ms | 2 300–3 390 ms without provenance; refused with provenance (receipt over 2 Mio, nothing written) |

The profile (`pg_stat_xact_user_functions`) put 3,2 s of the 3,9 s of two 100-operation copies in
`bulk_update_estimate_items`: the v3 projection rewrote every line of the version, each no-op update firing the
revision bump, two audit rows and the coverage invalidation. `20261018160000` passes only the lines whose amounts
differ (D12 still checks them all) and reads created ids and projections from maps. What remains is linear in the
operations (per-line triggers about 1,1 ms, batch loop about 0,85 ms, the quadratic `canonical_estimate_batch_operations`
about 0,6 s at 1 000), so a copy is capped at **100 operations**, the size of the editor batches: 282 ms here,
about half on the Mac, a few seconds in CI. Beyond it, a named 413 points to the affaire import, which creates the
version in one set-based statement (L1, L2).

## Measured results

Final files, on the owner's Mac (Apple silicon, native runtime), alternated green and red at load average
2,7–3,7 over one minute. The red tree is `e7ea42d4`, the parent of the M6b commit, with only these probes and the
runner's budget pass added.

| Run | Tree | Every-run file (N = 1) | Budget file (N = 7): creation / settings median | Result |
| --- | --- | --- | --- | --- |
| 2.8 probe, before M6b | `e7ea42d4` | — | 660,5 ms / not measured | — |
| 2.8 probe, after M6b (final) | `e7ea42d4` + M6b | — | 245,0 ms / not measured | — |
| green | `74de9764` + this change | 5 of 5; creation 257,9 ms, settings 543,3 ms | 248,1 ms / 546,2 ms; 2 of 2 | full `db:ci:local` with the opt-in passes, RLS matrix included |
| red | `e7ea42d4` (no M6b) | **1 of 5 fails** (L1: 1 021 updates against 8) | **725,1 ms** / 702,4 ms; **1 of 2 fails** (L2) | each on its own message |

Earlier rounds of this guard, with zero-priced lines and the platform gate, gave the same creation picture (green
251–299 ms, red 743–843 ms, under loads up to 21).

**Cost.** The every-run file takes 1,66 s of probe time locally (`probe runs and setup`), and the 23-file pgTAP
phase 6 s (3 s before these probes). The opt-in budget pass adds 6,4 s. At the quiet CI factor of 1,5–2,7 the
every-run file should cost about 2,5–4,5 s per CI pgTAP phase; the `diag` line gives the real duration in the job
logs.

## Limits

- **Wall-clock**: a median of 7 runs on a loaded machine can exceed the budget without a regression. Before
  treating an L2 failure as a regression, run again on an idle machine and compare the `diag` durations with the
  table above.
- **Calibration**: the budget is calibrated on the owner's Apple-silicon Mac and the CI factor on GitHub's
  `ubuntu-24.04` runners. Only opt in on the calibrated machine. A slower machine, another runner class or a change
  in the army-critical job's parallelism invalidates the budget: measure again and update this page.
- **Coverage**: the probes measure the database statements only. They do not cover the route, the network,
  PostgREST or the read path (L5). L7 measures the batch writer for creates only (no update, delete or reorder). L1
  sees only the per-line revision bump.
- **L7 calibration**: the copy medians above come from WSL, not from the calibrated Mac; the opt-in L7 assertion was
  not run there.
- **Proof**: IO01 and IO02 in CI remain the proof that a real import and its settings changes fit in the timeout.
  This guard catches a regression earlier; it does not replace those journeys.
