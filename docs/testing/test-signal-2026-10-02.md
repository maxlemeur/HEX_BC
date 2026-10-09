# Test signal audit — 2026-10-02

The audit compares isolated assertions with the actual Playwright and local HEX assertions. It removes static source spelling, copy/class/render smoke, mocked forwarding and duplicate happy paths while retaining concrete failures that those E2E scenarios do not expose. The machine-readable [decision inventory](test-signal-2026-10-02.json) records every baseline file, reasons, retained failures, E2E evidence, removed cases and before/after hashes.

## Scope and result

Baseline revision: `b3b319493304530a6f19533bd1e592cd5ef53fbe`, on `main`. No branch, commit, staging, push, deployment, remote migration or business-code change was performed for the audit. TesterArmy's separate integration adds a development-only Next build/config switch.

| Baseline decision | Files |
| --- | ---: |
| Deleted | 161 |
| Mixed suites pruned | 218 |
| Kept intact | 187 |
| Protected dirty/concurrent tests | 28 |
| Total baseline files | 594 |

Removed **1,436 test declarations**. Parameterized declarations are counted once, not once per runtime row. Twenty tests were initially dirty/untracked; eight more changed during the audit and were excluded. Newly created concurrent tests are outside the baseline and remain untouched. The inventory records observed concurrent changes rather than claiming an immutable checkout.

Three parallel agents owned UI/hooks, domain logic and takeoff/workers; the parent owned routes/pages/test infrastructure. Independent review restored the successful pending Ctrl+S/debounce cancellation case and the rejected streaming export recovery case because existing E2E assertions miss both. Their two suites pass all 20 cases.

Retained protection includes tenant/role boundaries, stale writes, worker leases, idempotency, draft recovery, parser cancellation/budgets, provenance, financial reconciliation and CSV formula injection. Historical SQL/source-regex matches were removed where they did not execute the claimed behavior. This does not change the disposition of any security finding or replace database execution proof.

## Verification

| Check | Result |
| --- | --- |
| ESLint for all 218 pruned suites and integration files | Pass, zero warnings |
| TypeScript | Pass |
| Final full Vitest | 2,673 passed; 4 failed; 2 skipped across 438 files |
| Critical tenant/service-role/environment coverage | 12/12 passed; thresholds pass |
| Existing Playwright discovery | 88 tests in 21 files; discovery only |
| TesterArmy anonymous desktop/mobile | 2/2 selected checks passed; zero model calls/tokens |
| TesterArmy proof | Two screenshots, two traces, fresh report hash and unchanged source digests during run |
| Dependency audit | Fails on existing vulnerable nodes; none added or version-changed by this integration |

The final four Vitest failures are unrelated to pruning:

- `src/lib/cockpit/suggestions.test.ts`: an unchanged test expects V0 generation while concurrent TI-582 code parks that capability.
- `src/lib/supabase-migration-history-regressions.test.ts`: unchanged migration inventory validation reports manifest drift in concurrent migration work. Its diagnostic wording does not prove deployed history changed.
- Two cases in `src/lib/estimates/server.coverage.test.ts`: supplier-comparison fixtures reject an additional current `products` query. Both reproduce using untouched HEAD test contents and current product code.

Earlier failures in concurrent supplier form/OpenAPI work no longer appear in the final run. The empty suite left by pruning was removed and its surviving test passes. Failures were not deleted to make the run green.

Local validation reports are under `test-results/test-signal-2026-10-02/`, notably `vitest-final.json`, `vitest-final.log` and `dependency-audit.json`. Commands and results are also in the decision inventory. Use `npm test`, `npm run typecheck`, `npm run test:critical-coverage` and `npm run e2e:army` to repeat the relevant checks on the current checkout. Repetition requires retaining the recorded local changes and fixture identities, not just checking out the baseline SHA.

## Policy and E2E boundary

`AGENTS.md` now contains the three requested rules verbatim, a documented isolation exception, E2E-first regression requirements and repeatable artifact requirements. Existing migration/publication/validation instructions are aligned with that policy.

Playwright/HEX coverage in this audit is source evidence, not a fresh authenticated journey pass. HEX is local-only; Playwright critical and nightly have different selections. No authenticated app E2E, local DB/RLS execution, remote application mutation, email, upload or publication was performed.

[TesterArmy setup and failure modes](tester-army.md) documents the pinned pilot, commands and limits. The anonymous pilot is verified natively on Windows. Its subscription-driven agent scenario remains unverified until the user performs the runner's separate ChatGPT OAuth sign-in.
