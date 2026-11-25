---
name: mergeone-verification
description: Run MergeOne locally, select checks for UI, code, database or performance changes, or qualify a release.
---

For interactive browsing, use the normal dev server on Turbopack. Link the
canonical checkout's ignored local environment for shared reads. Qualify
writing journeys on the runner's ephemeral stack with matching dependencies,
stable sources and no ambient env files or inherited database credentials.
Uncommitted changes can qualify. Isolate when credentials or concurrent work
require it. For an explicitly requested shared check, use the designated QA
account and tenant. Follow “Démarrer un parcours local” for per-run write
acknowledgement and “Données de test” for retention. Journeys leave their affaires.

Choose local checks by risk:

- For a small visual-only diff, inspect the actual screen at affected viewports
  and check the diff. This is sufficient for local qualification. Search journey
  selectors before classifying a renamed, moved, hidden or removed control,
  label, role or test ID. A selected element or a change to behavior, persistence,
  access, API or schema takes the code route.
- For code iterations use `verify:fast`. On code or journey PRs run
  `e2e:army:reach` first against the immediate base and run the development and
  extended selections it prints. Run affected journeys on final stable sources.
  The reusable development loop must stop before qualification.
- Prefer deterministic TesterArmy assertions for amounts, persistence, rights
  and downloads. Write isolated regression tests before the fix for SQL/RLS,
  parsers, races, recovery or calculations that a journey cannot expose reliably.
  SQL/RLS and migrations also require the dedicated local database CI check.
  For performance, measure real inputs and the largest supported volumes against
  existing statement budgets and browser measurements. Fix over-budget writes.
- Run `verify:pr` once as the final code check on each tree pushed, including
  review fixes. Preparing a release also requires the local release check with
  blank shared credentials. Confirm required shared migrations before deployment.

Record what ran, on which sources, build, fixtures and environment, with expected
and actual results and the primary evidence. Setup failures, skips and development
loops cannot qualify a journey. A green CI check covers its selected journeys.
Recheck a load-related timeout once after the failing files pass alone and load
drops. For security scans, update the existing remediation dispositions and
preserve the canonical evidence.
