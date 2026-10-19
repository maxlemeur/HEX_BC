# Large v3 estimate: local statement budget

Sub-lot 2.8 (IO01, 18/10/2026): creating the v3 of the hydraulic OPTIMA lot (1 021 items in the 2.8 timing probe)
through `persist_estimate_creation_atomic` took 660 ms on the owner's Mac but exceeded the 8 s `statement_timeout`
of the API roles in CI (`57014`). No local check covered large volumes, so the regression first showed up as a CI
journey failure. M6b (`20261018013249`, see [estimate-engine-v3-2.8.md](estimate-engine-v3-2.8.md), « Création
atomique ») fixed it. This guard makes the same kind of regression fail in `npm run db:ci:local` before CI: a
deterministic check on every run, and a wall-clock budget in WSL when asked for.

**Rule since 18/10/2026** (AGENTS.md Testing Policy; the owner asked that evening to relax the repository's
mandatory 330 ms local limit and to find the limit that best fits this application): two tiers and a stricter copy
exception replace the single 330 ms on a developer Mac. Each is a local median of 7 runs in WSL at the volume of the
largest real input the statement serves (the hydraulic OPTIMA lot: 2 031 items; a copy: 1 000 operations):

| Tier | Statements | Local WSL median | Derivation |
| --- | --- | --- | --- |
| Bulk | atomic import or creation (`persist_estimate_creation_atomic`), v3 settings repricing (`save_estimate_settings_atomic`) | ≤ **1 000 ms** | 8 s `statement_timeout` / (CI/WSL planning factor F = 4 × margin 2) |
| Copy into a v3, option A | one `commit_estimate_batch`, up to 1 000 operations | ≤ **875 ms** | 3 500 ms CI/production maximum / planning factor 4 |
| Interactive | the user waits before the next action: line edit save, autosave flush (≤ 100 updates), paste or undo (≤ 100 operations), reorder/move, delete | ≤ **400 ms** | 1 s (an uninterrupted action) / planning factor 2,5 |

The owner confirmed option A on 18/10/2026: the 3,5 s for a 1 000-operation copy is its maximum in CI/production,
with a stricter local target of 875 ms. A local SQL median alone does not prove that maximum, nor the duration of
the full HTTP route. A statement over its tier gets a faster write, never a raised timeout or retries.
Derivation, sources and limits below.

## Failure modes and where they are checked

| # | Failure | Check |
| --- | --- | --- |
| L1 | The per-line content revision bump comes back on the creation path (the version updated once per item, the main cost in IO01) | pgTAP, **every run, CI included**: a 1 021-item creation updates its version as many times as an 8-item creation. The other effects M6b replays (item audit, coverage invalidation, depth check) write the same rows on both paths, so no row count separates them: only L2 sees them come back |
| L2 | The creation gets slower without per-line version updates (a new BEFORE row trigger with a lookup, a slower D12 check, a missing index, a heavier audit) | pgTAP, **opt-in** in WSL, bulk tier: median of 7 rolled-back creations ≤ **500 ms** (1 000 ms pro rata of the 1 021-item probe to the 2 031-item hydraulic v3) |
| L3 | The v3 settings save (`save_estimate_settings_atomic`, every line's projection checked and written in one statement) slows down on 1 021 items | Every run: the save rewrites all 900 lines (so the measurement is a real repricing). Opt-in, bulk tier: median of 7 saves **reported, not asserted**. It is over its 500 ms pro rata (see « Settings save ») |
| L4 | The v3 batch writer (`commit_estimate_batch`, paste and undo in batches of 100) slows down | pgTAP, **opt-in**, interactive tier: median of 7 batches of 100 creates (the copy probe at 100 operations) into the 1 021-item v3 ≤ **400 ms**. The assumption « ≤ 100 items, far from the timeout » was wrong on a large v3 until `20261018180306` (see « Copy into a v3 ») |
| L7 | A copy into a v3 (2.8b: sections, linked DPGF; one `commit_estimate_batch` of at most 1 000 operations) rewrites the stored lines again, slows down or its receipt goes over 2 Mio | pgTAP, **every run**: a 1 000-operation copy with provenance into the 8-item and the 1 021-item v3 commits and updates **0** stored lines; since lot 3.1 each copy writes its items with **one** INSERT statement and a copy refused at operation 500 reports that index and writes nothing. **Opt-in**, option A: median of 7 such copies into the 1 021-item v3 ≤ **875 ms**, derived from the 3,5 s CI/production maximum. **Ceiling pass** (lot 3.1, [lot3-1-v3-copy-scale.md](lot3-1-v3-copy-scale.md)): one such copy ≤ **3 500 ms** wherever the database checks run alone, CI included (E2E RLS Matrix) |
| L8 | Reorder and move of ~1 000 siblings in a v1/v2 draft (`reorder_estimate_items`, `move_estimate_item`) take the per-row content revision bump and audit back, or slow down ([reorder-move-large-v2.md](reorder-move-large-v2.md)) | pgTAP, **every run**: the RPCs update their version once per operation where the per-row path updates it once per written row (4 against 52), with the same audit rows. **Opt-in**, interactive tier: median of 7 reversals of a section of 1 000 lines and of 7 moves of its first line into a section of 3 lines ≤ **400 ms** each; the move between sections of 1 000 and 999 lines is reported |
| L5 | The route, serialization or UI around the RPC is slow (time to « Devis créé », settings PATCH) | TesterArmy: IO01 step durations in `report.json` and the `io-settings-*` business artifacts (`elapsedMs.save`); reported, no threshold |
| L6 | The 8 s timeout of the API roles or the CI/WSL factor F changes | Reported by the probes (`diag` of `pg_roles.rolconfig`, and every CI job's creation and settings durations); the tiers must then be derived again |
| — | Reading a large estimate (`GET /api/estimates`, the ~60 s stall) | Out of scope: a separate investigation covers it |

pgTAP takes the statement-level failures (L1–L4, L7): no browser, and the work done is deterministic. A wall-clock
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
4. `diag` lines with the role timeouts, the server version, every run's duration, the local WSL budget it is
   compared with when opted in, and the probe's own time.

Two files use it:

| File | Runs | When | Assertions |
| --- | --- | --- | --- |
| [`supabase/tests/database/estimate-large-v3-scale.test.sql`](../../supabase/tests/database/estimate-large-v3-scale.test.sql) | N = 1 | every `db:ci:local`, so every CI job that runs it | all statements succeed, payload size, L1, one audit row per item, the settings save rewrites 900 lines, L7 (the 1 000-operation copies commit, 0 line updates); durations reported, never asserted |
| [`supabase/tests/ceiling/estimate-v3-copy-ceiling.test.sql`](../../supabase/tests/ceiling/estimate-v3-copy-ceiling.test.sql) | N = 1 | every `db:ci:local` whose caller starts nothing alongside the database checks (local runs, CI E2E RLS Matrix); skipped and logged in the Army jobs, whose production build runs beside them | the 1 000-operation copies commit; into the 1 021-item v3 ≤ 3 500 ms (lot 3.1) |
| [`supabase/tests/budget/estimate-large-v3-statement-budget.test.sql`](../../supabase/tests/budget/estimate-large-v3-statement-budget.test.sql) | N = 7 | only with `DB_CI_STATEMENT_BUDGET=enforce`, after the main pgTAP phase | all statements and copies succeed, L2 (creation median ≤ 500 ms), L7 (1 000-operation copy median ≤ 875 ms), L4 (100-operation batch median ≤ 400 ms); settings median reported |

The budget is opt-in rather than inferred from the platform: it is calibrated in WSL (Ubuntu 24.04 on the Windows
development PC, 24 cores, 31 GB, native Supabase runtime), and a wall-clock assertion must not fail correct code on
another machine or a loaded host. CI never sets the variable (see « Why CI does not assert »). The Supabase CLI does
not forward `PGOPTIONS` to pg_prove, and the `postgres` role cannot attach a custom setting to the database. So the
runner runs the `supabase/tests/budget` directory as a second pgTAP pass.

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
- **Retired factor (12×, then 17–19×).** The former 330 ms was 8 000 / (12 × 2). The 12,1 rested on one CI sample
  from before M6b: IO01 timed out there, so its true duration is unknown, and it was divided by a Mac probe
  (660,5 ms) that is not in the repository. The 17–19 upper bounds (runs
  [39100138108](https://github.com/maxlemeur/HEX_BC/actions/runs/39100138108), 4 568 ms, and
  [39121336213](https://github.com/maxlemeur/HEX_BC/actions/runs/39121336213), 4 194 ms, against the Mac's 245 ms)
  were waits from « Confirmer l'import » to the « Devis créé » heading, which include the route and the UI: they
  are not statement times.
- **Measured comparison and planning factor.** The copy probe in
  [PR #59, shard 3](https://github.com/maxlemeur/HEX_BC/actions/runs/39153968200/job/117753257247)
  reports 1 787,7 ms for 1 000 operations into the 1 021-item v3 (N = 1, before Next starts), against the historical
  WSL median of 730,2 ms (N = 7): about **2,45×**. Different sampling and host load limit this comparison; it is
  not a percentile or a universal CI multiplier. See the [lot 2 retrospective](lot2-retro-lot3-plan-2026-10-18.md).
  The source commit `858b27d9` reported statistics over 309 jobs, including 56 loaded jobs; no raw inventory or
  calculation script was supplied or located for this review. Those percentiles are not treated as reproduced.
  **F = 4 is a conservative planning choice**, not a measured upper bound or a validated p95.
- **Bulk tier** B = T / (F × 2) = 8 000 / 8 = **1 000 ms**. This is a policy budget under that planning factor,
  not a guarantee about a future runner.
- **Copy exception, option A** = min(1 000, 3 500 / 4) = **875 ms** locally. It plans for the owner's 3,5 s
  maximum in CI/production while keeping the bulk budget's 8 s timeout margin. It does not add another 2× margin
  to the 3,5 s ceiling. F is a planning choice, so passing the local median cannot guarantee that maximum on a
  slower host. SQL and full-route times must remain separate; IO13's 7 984 ms is the full route, not the SQL call.
- **Interactive tier** = 1 000 ms / 2,5 = **400 ms**. One second is the limit for an uninterrupted flow of thought
  ([Nielsen Norman Group, response-time limits](https://www.nngroup.com/articles/response-times-3-important-limits/)).
  The factor 2,5 is a rounded planning choice near the limited 2,45× comparison, not a reproduced p75. It covers
  SQL time only; a complete interaction includes more work.
- **Probe volume.** The IO01/IO02 v3 holds 2 031 items in PR #59's business artifact
  `ARMY-1792348073459-021430c7-io-hydraulique-consecutive-reads.json` (six reads all return that count);
  this fixture creates 1 021. Until the fixture reproduces the hydraulic lot, the 1 021-item creation and settings
  probes get the bulk tier pro rata: 1 000 × 1 021 / 2 031 ≈ **500 ms** (`budget_ms`). The copy probe exercises
  the real 1 000-operation cap, into an existing 1 021-item target, so it gets the 875 ms copy budget
  (`copy_budget_ms`). The 100-operation copy into the 1 021-item v3 probes the interactive tier
  (`interactive_budget_ms`, 400 ms).
- **Why CI does not assert these local tiers.** Each CI probe is a single run on another host. A 4 s threshold
  might fail on a future slower or loaded runner; the source commit's reported maximum of 3 388 ms does not
  demonstrate such a failure. An 8 s guard would approach the existing API timeout instead of validating the
  calibrated local median. This change adds no CI duration threshold and proves no CI/production maximum. The
  every-run `diag` lines stay diagnostic: until this change they printed CI values beside the local budget (PR #59,
  run [39138950745](https://github.com/maxlemeur/HEX_BC/actions/runs/39138950745): « create: median 584.8 ms over
  1 runs, budget 330 ms », settings 1 383,7 ms); they now label it « local WSL budget … (opt-in) ».
  **Lot 3.1 exception, the copy ceiling**: the owner asked for a CI assertion of the 3,5 s maximum. Over 303 CI
  samples of the every-run copy probe (18–19/10/2026), the E2E RLS Matrix job, where `db:ci:local` runs alone, peaked
  at 2 277 ms, while the Army shards, whose production build starts beside pgTAP, reached 5 596 ms with 15 of 281
  samples over 3,5 s. The ceiling is therefore a separate pass that runs only where nothing starts alongside the
  database checks ([lot3-1-v3-copy-scale.md](lot3-1-v3-copy-scale.md)). The local tiers above stay opt-in.

WSL outcome on 18/10/2026, before this change (shared host, single runs from the every-run probe, medians of 7 from
the budget pass):

| Statement (probe) | Measured in WSL | Tier for the probe | Result |
| --- | --- | --- | --- |
| Creation, 1 021 items | 333 ms (single runs), 389 ms (7 runs) | 500 ms (bulk, pro rata) | passes |
| Copy of 1 000 operations into the 1 021-item v3 | 730 ms | 875 ms (option A) | historical median below target; current validation below |
| Copy of 100 operations into the 1 021-item v3 | 282 ms | 400 ms (interactive) | passes |
| Settings save, 900 lines repriced | 816 ms (single runs), 894–1 333 ms (7 runs) | 500 ms (bulk, pro rata) | over: reported, not asserted |

Validation of the tiers (18/10/2026 20:38 UTC, WSL clone `~/miaouffrage-perf-budget` at `45b9e1cf` plus this change,
idle host at load 1,5; `DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local -- --files estimate-large-v3-scale.test.sql
--skip-rls`, a partial run: one pgTAP file and the budget pass, no RLS matrix). The every-run file passed 7 of 7 and
the budget file 5 of 5. Medians of 7: creation 370,7 ms (tier 500 ms), settings save 928 ms (reported), 100-operation
copy into the 1 021-item v3 151 ms (400 ms), 1 000-operation copy 674,8 ms (then 1 000 ms). Log: `~/perf-budget-dbci.log`
in WSL.

### Option A validation (18/10/2026)

Full isolated run, 23:37:43–23:38:59 Paris time, on Linux WSL2, Node 24.14.0,
PostgreSQL 17.11 and native Supabase CLI 2.120.0. Base `99f8893f`, source commit
`858b27d9` adapted to option A; eight source hashes verified before execution.
Command: `DB_CI_STATEMENT_BUDGET=enforce npm run db:ci:local`, from
`/tmp/miaouffrage-option-a-99f8893f`, without ambient `.env` files or remote secrets.
Host load averages (1/5/15 min) before/after: 5,38 / 5,42 / 5,77 and 4,20 / 4,99 / 5,59.

Result **PASS, exit 0**: all 26 regular pgTAP files (1 982 assertions), all five opt-in
budget assertions, and the behavioral RLS matrix. No retry, timeout increase, writer or
trigger change. The fixture user is `29200000-0000-4000-8000-000000000001`; its tenant
is read from the membership created by the profile trigger. Large/small versions use
suffixes `000000000101` / `000000000102` under the `29200000-0000-4000-8000-` prefix;
the runner destroys its own ephemeral stack.

| N = 7, rolled-back statements | Median | Budget | Raw samples in ms |
|---|---:|---:|---|
| Creation, 1 021 items | 358,1 ms | 500 ms | 329.7, 337.1, 415.5, 358.1, 410.2, 327.5, 394.8 |
| Copy 100 operations into the large v3 | 143,9 ms | 400 ms | 146.3, 135.4, 145.8, 143.9, 140.2, 162.3, 138.3 |
| Copy 1 000 operations into the large v3 | **639,1 ms** | **875 ms** | 628.0, 713.3, 626.3, 639.1, 590.8, **1394.3**, 656.8 |
| Copy 1 000 operations into the small v3 | 623,6 ms | 875 ms | 623.6, 594.8, 588.3, 627.9, 573.1, 631.6, 659.5 |
| Settings save | 863,8 ms | 500 ms, reported only | 782.1, 872.1, 904.9, 859.5, 863.8, 869.3, 823.4 |

All copies succeed with zero updates to existing lines; the large 1 000-operation
receipt is 2 040 397 bytes. **The median passes; one sample exceeds 875 ms.** This
validates the local median for this fixture, not each call, a performance improvement,
the full route, or the CI/production 3,5 s maximum. Settings remain over their provisional
budget and are reported rather than asserted, as before.

Retained at the repository root: `.tmp/budget-a-db-ci.log`, SHA-256
`3442b77000316900c5848e6b8a32d84d9454ae89d58e1f127d1577db65e5c081`;
`.tmp/budget-a-environment.log`, SHA-256
`6f59ff48ca4d5e63011b6082c9d2033d28cc8ab37d0793a5d24b0ef845ad55d9`;
`.tmp/budget-a-source.json` (eight input hashes and protected worktree fingerprints),
and `.tmp/budget-a-source.patch`, SHA-256
`6c716408ce57a200c00ab482dadbd7fce6d72a78506a9988ed1dac726d6210dc`.
The review then corrects documentation and SQL comments only; executable SQL and
TypeScript equivalence are checked before the quality run, recorded in
`.tmp/budget-a-equivalence.json`. `npm run verify:pr` on that final executable
source succeeds (exit 0), log `.tmp/budget-a-verify-pr.log`; the last follow-up
changes documentation and SQL comments only. No affected browser journey is changed; the existing
IO13 assertions are retained. The snapshot of the reorder worktree changed while
its session continued; no writes to that worktree or the copy worktree were issued.
Quality log SHA-256: `1785de30d384e0d559f44f455801815a13c610e017085ef96c45d6e93abd735a`;
equivalence report SHA-256: `dce269f4df8a8337db781b8e1c18c372bd50e2985bfe0550ec4a66b16f99eb87`.
Quality counts: 3 304 node tests passed, two skipped (one file skipped); 831 jsdom
and 12 boundary-coverage tests passed. The skips remain visible in the log.

## Settings save: over its pro rata

With every line repriced, the settings save of the 1 021-item estimate takes about 816 ms in WSL in single runs
(medians of 7 historical runs from 894 to 1 333 ms, and 863,8 ms in the option A run), over the 500 ms pro rata of
the bulk tier. On the owner's Mac it took a median of 546 ms (7 runs, 539–549 ms), against 248 ms for the creation.
The IO02 settings `PATCH` route (the same hydraulic lot, then c_FO/c_MO changed twice; the route also reads the
estimate) took 3,3 s and 6,6 s in run 39100138108 and 9,9 s and 9,4 s in run
[39088903048](https://github.com/maxlemeur/HEX_BC/actions/runs/39088903048), all answering 200. The budget file
therefore reports the settings median without asserting it. The assertion belongs with the change that brings the
save under 500 ms (under 1 000 ms once the probe reproduces the 2 031-item lot). Before M6b the same save took
702 ms on the Mac, so M6b already helped it.

The first version of this probe sent all-zero lines. Changing c_FO then left every projection identical to the
stored row, and the save's `IS DISTINCT FROM` filter skipped all 900 writes (~75 ms). The every-run assertion
« rewrites 900 lines » now keeps the measurement honest.

## Copy into a v3 (2.8b, L7)

Review of PR #59 (18/10/2026): IO13 copied 1 000 operations into a v3 and timed out in CI (run
[39138950745](https://github.com/maxlemeur/HEX_BC/actions/runs/39138950745), 503 `BATCH_OUTCOME_UNKNOWN`, nothing
written). The probe `pg_temp.lb29_copy_run` (one root section and N - 1 priced lines carrying their provenance, rolled
back, as the owner) measured it in WSL on a loaded Windows host (the creation took 415–480 ms there; idle WSL takes
about 333 ms, 1,35 times the 245 ms of the owner's Mac):

| Copy | Before the migration (5 runs) | Its first review version, then `20261018160000` (7 runs for 100, 3 for 1 000) |
| --- | --- | --- |
| 100 operations into the 8-item v3 | 554 ms | **173 ms** |
| 100 operations into the 1 021-item v3 | 4 102 ms | **282 ms**, 0 line updates |
| 1 000 operations, 8-item / 1 021-item v3 | 10 263 / 15 184 ms | 2 300–3 390 ms without provenance; refused with provenance (receipt over 2 Mio, nothing written) |

The profile (`pg_stat_xact_user_functions`) put 3,2 s of the 3,9 s of two 100-operation copies in
`bulk_update_estimate_items`: the v3 projection rewrote every line of the version, each no-op update firing the
revision bump, two audit rows and the coverage invalidation. The first review version of the migration (then
`20261018160000`, since restamped `20261018180306`) passes only the lines whose amounts
differ (D12 still checks them all) and reads created ids and projections from maps. What remains is linear in the
operations (per-line triggers about 1,1 ms, batch loop about 0,85 ms, the quadratic `canonical_estimate_batch_operations`
about 0,6 s at 1 000), so that version capped a copy at **100 operations** (superseded by the owner decision below),
the size of the editor batches: 282 ms here, within the 400 ms interactive tier. Beyond it, a named 413 points to the
affaire import, which creates the version in one set-based statement (L1, L2).

**Owner decision of 18/10/2026 (« on accepte jusqu'à 3,5 s pour 1 000 lignes »), option A confirmed**: a copy into a v3 goes up to
1 000 operations again, under the 8 s `statement_timeout` of the API roles in CI (IO13, never a raised timeout or a
retry). It was first written as an exception to the 330 ms rule, with a local median of at most 3,5 s. Since the two
tiers (« Budget derivation »), the confirmed ceiling is 3,5 s in CI/production and the local WSL copy budget is
875 ms. A local median of 3,5 s leaves no safe timeout margin: at a factor of 3,0 it would be about 10,5 s in CI.
The current calibration changes no writer or trigger and waits for #72 then the reorder PR before optimization.
`20261018180306` also replays the per-line effects of a creations-only batch in one pass (the M6b
replay, `estimate_creation_replay_item_effects_for_writer`), skips the default position and title lookups when the
operation names them, accumulates results and canonical operations in arrays, and no longer echoes in the receipt
the `source_metadata` it received from `p_created_ids`. A receipt still over 2 Mio is refused by name,
`ESTIMATE_BATCH_RECEIPT_TOO_LARGE`, nothing written; the copies answer their named 413.

| Copy of 1 000 operations with provenance (WSL, shared host at load 7–9, 7 runs) | Median | Runs | Receipt | Line updates |
| --- | --- | --- | --- | --- |
| into the 1 021-item v3 | **730,2 ms** | 697,9–831,6 ms | 2 040 397 bytes | 0 |
| into the 8-item v3 | **665,1 ms** | 607,8–821,5 ms | 2 040 395 bytes | 0 |

Before this change the same copies were refused (`22023 ESTIMATE_BATCH_INVALID_INPUT`: the receipt with the
provenance went over 2 Mio). The receipt keeps about 56 KB of headroom at 1 000 lines of about 45-character titles:
1 000 lines fit with titles of about 85 characters at most, beyond which the copy is refused by name (IO13 checks
200-character titles). Evidence: `~/l2-28b-evidence/pgtap-red-25cd083b-20261018T172109Z.log` (red) and
`~/l2-28b-evidence/pgtap-green-budget-25cd083b-20261018T172328Z.log` (green, `DB_CI_STATEMENT_BUDGET=enforce`) in the
WSL clone `~/miaouffrage-l2-28b`. The same budget pass failed L2 only (creation median 388,8 ms against the 330 ms of
the time); it passes the 500 ms of the bulk tier pro rata.

## Measured results

Final files of sub-lot 2.8, on the owner's Mac (Apple silicon, native runtime), against the former 330 ms,
alternated green and red at load average 2,7–3,7 over one minute. The red tree is `e7ea42d4`, the parent of the M6b
commit, with only these probes and the runner's budget pass added.

| Run | Tree | Every-run file (N = 1) | Budget file (N = 7): creation / settings median | Result |
| --- | --- | --- | --- | --- |
| 2.8 probe, before M6b | `e7ea42d4` | — | 660,5 ms / not measured | — |
| 2.8 probe, after M6b (final) | `e7ea42d4` + M6b | — | 245,0 ms / not measured | — |
| green | `74de9764` + this change | 5 of 5; creation 257,9 ms, settings 543,3 ms | 248,1 ms / 546,2 ms; 2 of 2 | full `db:ci:local` with the opt-in passes, RLS matrix included |
| red | `e7ea42d4` (no M6b) | **1 of 5 fails** (L1: 1 021 updates against 8) | **725,1 ms** / 702,4 ms; **1 of 2 fails** (L2) | each on its own message |

Earlier rounds of this guard, with zero-priced lines and the platform gate, gave the same creation picture (green
251–299 ms, red 743–843 ms, under loads up to 21).

**Cost.** On the Mac, before the copy probes, the every-run file took 1,66 s of probe time (`probe runs and setup`),
the 23-file pgTAP phase 6 s (3 s before these probes) and the opt-in budget pass 6,4 s. In WSL with the copy probes
(validation above), the every-run file takes 5,5 s of probe time and the budget pass 22,2 s (28 copies, 7 creations
and 7 settings saves). The `diag` line gives the real duration in each CI job log.

## Limits

- **Wall-clock**: a median of 7 runs on a loaded host can exceed its tier without a regression: above load 10 the
  creation's median of 7 took 722 ms (18/10/2026, 19:51). Record host load before the run. If a check fails,
  retain that failure and diagnose the cause before a new run; an unchanged retry is not qualification. Since CI does not assert the tiers, a slow
  drift is caught only when someone opts in or a journey hits `57014`.
- **Calibration**: the local medians are measured in WSL. F = 4 and the interactive factor 2,5 remain planning
  choices, not validated distribution bounds. A slower runner, more parallelism or another local machine needs
  fresh paired probes. Retain the raw inventory and calculation before claiming new percentiles.
- **Production**: not measured by this qualification. Resource class, role timeouts and actual load are not
  established here. The 3,5 s maximum is the owner's target, not a production result inferred from WSL.
- **Volume**: the probe has 1 021 items, the real lot 2 031. The 500 ms pro rata assumes the cost grows linearly
  with the items, which is not verified. PostgREST, JSON handling and work at commit time are not measured by
  this local statement probe. Follow-up lot:
  build the probe from the hydraulic workbook's real shape (2 031 items, 785 priced lines plus status and section
  rows), then drop the pro rata.
- **Coverage**: the probes measure the database statements only. They do not cover the route, the network,
  PostgREST or the read path (L5). L4 and L7 measure the batch writer for creates only: single-line updates,
  delete and duplication have no probe. Reorder and move have one since L8 (about 350 ms for 1 000 siblings, 0,7 s
  for a move between two sections of ~1 000 lines, over the interactive tier), and the 13-item v2 insert, estimated
  at 0,35–0,5 s locally
  ([copy-row-limit-v2.md](copy-row-limit-v2.md)), is borderline. L1 sees only the per-line revision bump.
- **Routes**: `statement_timeout` does not bound a route, and the tiers guard statements, not routes. IO01's wait
  from « Confirmer l'import » to « Devis créé » grew from 4,2 s to 10–18 s since `59b3b6bf`, not yet investigated;
  IO13 reached 7 984 ms in run 39153968200. Lot 3.1 split IO13 locally into reads, receipt, RPC and SQL and cut
  its route median from 1 282 to 777 ms ([lot3-1-v3-copy-scale.md](lot3-1-v3-copy-scale.md)); no CI trace of the route
  was taken.
- **Proof**: IO01, IO02 and IO13 in CI remain the proof that a real import, its settings changes and a 1 000-line
  copy fit in the timeout. This guard catches a regression earlier; it does not replace those journeys.
