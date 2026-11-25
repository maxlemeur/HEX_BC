---
name: mergeone-verification
description: Run MergeOne locally, select checks for UI, code, database or performance changes, or qualify a release.
---

Browse with Turbopack and the canonical checkout’s ignored local environment
for shared reads. For qualification, “Démarrer un parcours local” covers
credential isolation, the runner’s ephemeral stack and the acknowledgement for
shared writes. A stable uncommitted diff can qualify. For shared fixtures,
follow “Données de test” on retention of affaires.

- **Small visual changes.** Check the screen at affected viewports and run a
  scoped diff check. Use the code checks for changes to behavior, persistence,
  authorization, APIs or schema. Before moving, renaming, hiding or removing a
  control, label, role or test ID, search the journeys. A matching selector
  also requires the code checks.
- **Code and journeys.** Iterate with `verify:fast`. For a code or journey PR,
  run `e2e:army:reach` first against its immediate base and run the development
  and extended selections it prints. Stop the development loop and qualify
  affected journeys on final sources with `e2e:army:local`. Assert the affected
  amounts, persisted values, access rights or downloads.
- **Database and performance.** SQL/RLS and migrations require `db:ci:local`.
  Write isolated tests before the fix for SQL/RLS, parsers, races, recovery or
  calculations a journey cannot expose reliably. Measure real inputs and the
  largest supported volumes against SQL statement budgets and browser
  measurements. Fix over-budget writes.
- **Push and release.** Run `verify:pr` last on each code revision pushed,
  including review fixes. Release preparation adds `check:release` with blank
  shared credentials. Confirm required shared migrations before deployment.

Use “Lire une preuve” for Army qualification. The dev loop produces
`qualification: false`. A green PR check covers only the selected journeys.
For a timeout attributed to load, verify the files pass alone and rerun once
after load drops. For security scans, record the disposition in the project's
remediation log.
