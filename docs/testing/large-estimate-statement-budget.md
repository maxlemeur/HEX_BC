# Large v3 estimate: local statement budget

Sub-lot 2.8 (IO01, 18/10/2026): creating the v3 of the hydraulic OPTIMA lot (1 021 items) through
`persist_estimate_creation_atomic` took 660 ms on the owner's Mac but exceeded the 8 s `statement_timeout` of
the API roles in CI (`57014`). No local check covered large volumes, so the regression first showed up as a CI
journey failure. M6b (`20261018013249`, see [estimate-engine-v3-2.8.md](estimate-engine-v3-2.8.md), « Création
atomique ») fixed it. This guard makes the same kind of slowdown fail in `npm run db:ci:local` before CI.

## Failure modes and where they are checked

| # | Failure | Check |
| --- | --- | --- |
| L1 | The per-line content revision bump comes back on the creation path (the version updated once per item, the main cost in IO01) | pgTAP, **every platform**: a 1 021-item creation updates its version as many times as an 8-item creation. The other effects M6b replays (item audit, coverage invalidation, depth check) write the same rows on both paths, so no row count separates them: only L2 sees them come back |
| L2 | The creation gets slower without per-line version updates (a new BEFORE row trigger with a lookup, a slower D12 check, a missing index, a heavier audit) | pgTAP, **calibrated platform**: median of 7 rolled-back creations ≤ 330 ms |
| L3 | The v3 settings save (`save_estimate_settings_atomic`, every line's projection checked and written in one statement) slows down on 1 021 items | pgTAP, **calibrated platform**: median of 7 rolled-back saves ≤ 330 ms |
| L4 | The v3 batch writer (`commit_estimate_batch`, paste and undo in batches of 100) slows down | **Not guarded, not measured.** Each call carries ≤ 100 items, about a tenth of the statements above, and a 1 000-item paste is 10 separate statements, so a single call is far from the timeout. The paste journeys assert behaviour, not timing; a timing scenario would belong in [tester-army-performance.md](tester-army-performance.md) |
| L5 | The route, serialization or UI around the RPC is slow (time to « Devis créé ») | TesterArmy: step durations of IO01 in `report.json`; reported, no threshold |
| L6 | The 8 s timeout of the API roles changes | Reported by the probe (`diag` of `pg_roles.rolconfig`); the budget must then be derived again |
| — | Reading a large estimate (`GET /api/estimates`, the ~60 s stall) | Out of scope: a separate investigation covers it |

pgTAP takes the statement-level failures (L1–L3): they are deterministic in work done, need no browser and the probe adds a few seconds
to the pgTAP phase (measured below). A wall-clock threshold in a journey would measure the route, the browser and the runner load
together, and would still only fail once the 8 s timeout was crossed.

## Probe

[`supabase/tests/database/estimate-large-v3-statement-budget.test.sql`](../../supabase/tests/database/estimate-large-v3-statement-budget.test.sql)
runs inside the normal pgTAP phase of `npm run db:ci:local` (and so of every CI job that runs it):

1. tenant on engine 3 (c_FO 1,3, c_MO 1,2); payload with the IO01 profile: one import root, 60 lots each with one
   sub-lot, 15 priced v3 lines per sub-lot (1 021 items), DPGF provenance and OPTIMA structure metadata. The
   payload is the one the 2.8 timing probe used;
2. 7 creations, each rolled back in its own subtransaction, plus one 8-item creation, with the
   `estimate_versions` update count of each (`pg_stat_xact_user_tables`);
3. one kept creation and its draft lease, then 7 rolled-back v3 settings saves (c_FO 1,3 → 2) with the projection
   of all 900 lines;
4. 6 assertions: all runs succeed, payload size, L1, one audit row per item, L2, L3. The `diag` lines print the
   role timeouts and every run's duration.

Budget assertions run when `version()` names `aarch64-apple-darwin` (the Supabase native runtime on Apple
silicon, where the budget was calibrated). Elsewhere, including the Linux CI runners, they are reported as `skip`
with the measured medians, and L1 still runs.

Run it with the whole suite:

```bash
npm run db:ci:local
```

## Budget derivation

- **Timeout** T = 8 s. The probe's `diag` reads it locally: `authenticator` and `authenticated` carry
  `statement_timeout=8s` (`anon` 3 s) and `service_role` has none of its own. PostgREST connects as
  `authenticator` and switches role, so the RPC called by the service-role client runs under the 8 s of
  `authenticator`. The probe calls the RPC from psql without that timeout and measures it instead.
- **CI-under-load factor** F, for the army-critical job (Next server and two browser workers on a shared runner):
  - lower bound 12,1: before M6b, local median 660,5 ms and IO01 timed out in CI (≥ 8 s);
  - upper bound 18,6: after M6b, local median 245,0 ms (the 2.8 measurement of the final M6b), and CI run
    [39100138108](https://github.com/maxlemeur/HEX_BC/actions/runs/39100138108) (`f00da33b`) waited 4 568 ms
    from « Confirmer l'import » to the « Devis créé » heading in IO01. That wait includes the route and the UI,
    so the RPC took at most that long;
  - one sample for each bound, on a runner whose load varies. Treat F ≈ 12–19 as an estimate, not a constant.
  - for comparison, the quiet pgTAP job (`E2E RLS Matrix`) ran the 22-file suite in 4–8 s against 3 s locally
    before this probe (pg_prove rounds to the second), about 1,5–2,7×: most of the factor comes from contention in the journey job,
    not from the database alone.
- **Budget** B = T / (F_low × 2) = 8 000 / 24 ≈ **330 ms**. At the upper bound, 330 ms × 18,6 ≈ 6,1 s, still under
  8 s. The budget stops protecting CI if F reaches about 24.

## Measured results

| Run | Tree | Creation median (7 runs) | Settings save median | L1 (1 021 items / 8 items) | Result |
| --- | --- | --- | --- | --- | --- |
| 2.8 probe, before M6b | `e7ea42d4` | 660,5 ms | not measured | not measured | — |
| 2.8 probe, after M6b (final) | `e7ea42d4` + M6b | 245,0 ms | not measured | not measured | — |
| green 1 (this guard) | `3af6804c` | 265,6 ms | 76,8 ms | 1 / 1 | 6 of 6 |
| red 1 (this guard) | `e7ea42d4` (no M6b) | 772,5 ms | 75,7 ms | 1 021 / 8 | 2 of 6 failed on their own messages (L1, L2) |
| green 2 | `3af6804c` | 263,2 ms | 75,1 ms | 1 / 1 | 6 of 6 |
| red 2 | `e7ea42d4` (no M6b) | 759,1 ms | 75,6 ms | 1 021 / 8 | same 2 of 6 |
| green 3 (committed files) | `3af6804c` | 299,2 ms | 82,2 ms | 1 / 1 | 6 of 6, RLS matrix passed |
| red 3 (committed files) | `e7ea42d4` (no M6b) | 743,0 ms | 74,5 ms | 1 021 / 8 | same 2 of 6 |

The guard runs alternated green and red through `npm run db:ci:local`. The red tree is `e7ea42d4`, the parent of
the M6b commit, with only this probe added. Other sessions were running stacks and journeys on the same Mac (load
average 3–7 over one minute), which inflates every median compared with the 2.8 probe on a quieter machine. Even
then, the green creation stayed 9–20 % under the budget (299,2 ms at load 5,5 is the noisiest run) and the red one
was 2,3–2,4 times over it. The settings
save (≈ 75 ms) does not depend on M6b. An earlier set of runs at load 5–6 gave the same picture (green 264,5 and
262,9 ms, red 783,5 and 786,4 ms).

With this probe the local pgTAP phase takes 6–7 s for 23 files, against 3 s for the 22 files before it (8 s in the noisiest run); the red
tree takes 10 s because its creations are slower.

## Limits

- **Wall-clock**: a median of 7 runs on a loaded machine can exceed the budget without a regression. Before
  treating an L2/L3 failure as a regression, run `db:ci:local` again on an idle machine and compare the `diag`
  durations with the table above.
- **Calibration**: the budget is calibrated on the owner's Apple-silicon Mac and the CI factor on GitHub's
  `ubuntu-24.04` runners. A slower machine, another runner class or a change in the army-critical job's
  parallelism invalidates it: measure again and update this page.
- **Coverage**: the probe measures the database statement only, with zero-priced lines (prices are computed by the
  application; the RPC only checks and stores them). It does not cover the route, the network, PostgREST, the
  read path or the batch writer (L4, L5).
- **Proof**: IO01 in CI remains the proof that a real import fits in the timeout. This guard catches a regression
  earlier; it does not replace that journey.
