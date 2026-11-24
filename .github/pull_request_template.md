## Purpose and change

Describe the observable result and link the issue or lot when one exists.

## Risk and scope

- Affected journey and concrete failure to prevent:
- Sensitive boundaries or consumers affected (calculation version/rounding, auth/RLS, persistence, exports, migrations, OpenAPI, CI/publication):

## Validation

- Tested source revision, local changes and build/environment:
- Local PR quality: `npm run verify:pr` result (or precise failure/blocker):
- Optional focused diagnostics actually run and results:
- Affected TesterArmy journey, exact expected/actual result and existing evidence path (or why no runtime journey is affected):
- Remaining failures, skipped/blocked cases and platform/backend limits:

`verify:pr` runs the `check:quality` gate on the current checkout;
keep the affected TesterArmy/SQL/RLS evidence separate. For a UI change, name
the screen and viewport checked, in words: a pull request carries no
screenshots. Anonymous or simulated evidence does not qualify authenticated
business or real backend behavior.

## Review

- Independent findings and their disposition, when `AGENTS.md` (« Review and delivery ») requires a reviewer; otherwise "none needed":
- Corrections rechecked against the final diff and affected journeys:

## Delivery and recovery

State migration/environment prerequisites and the applicable recovery action.
Use `npm run check:release` when preparing publication.
Keep publication separate from this PR; a code revert does not undo data changes.
