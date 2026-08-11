# E2E tests (agent-browser)

This folder contains lightweight E2E checks powered by the `agent-browser` CLI.

## Requirements

- `agent-browser` installed and available in PATH.
- Playwright browser binaries installed (`npx playwright install chromium`).
- PowerShell runtime available in PATH (`pwsh` on Linux/macOS, `pwsh` or `powershell` on Windows).
- App running locally (default base URL is `http://localhost:3000`).

## Commands

- `npm run e2e` runs the smoke flow:
  - Opens the home page
  - Clicks the Login CTA
  - Checks the Login form fields

- `npm run e2e:auth` logs in and saves an auth state file for future tests.
- `npm run e2e:pw:critical` runs the Playwright critical-path suite (`e2e/estimates/*`).
- `npm run e2e:pw:headed` runs the same suite in headed mode.
- `npm run e2e:pw:report` opens the generated Playwright HTML report.
- `npm run e2e:rls` runs the EST-261 RLS matrix integration suite.

## HEX ticket scripts

Scripts live in `e2e/hex/` and are grouped by feature suites. All npm commands are cross-platform and routed through `e2e/run-ps1.mjs`.

### Recommended commands

- Fast local run (default quick suite): `npm run e2e:hex`
- Full validation run: `npm run e2e:hex:all`
- Feature suites:
  - `npm run e2e:hex:editor`
  - `npm run e2e:hex:lifecycle`
  - `npm run e2e:hex:output`
  - `npm run e2e:hex:settings`
  - `npm run e2e:hex:security`
  - `npm run e2e:hex:assemblies`
  - `npm run e2e:hex:dpgf`

### Suite matrix

- `quick` (default via `e2e:hex`):
  - `ti-145-create.ps1`
  - `ti-147-editor.ps1`
  - `ti-148-calculations.ps1`
  - `ti-150-status.ps1`
- `editor`:
  - `est-101-keyboard.ps1`
  - `est-102-inline-edit.ps1`
  - `est-103-multiselect.ps1`
  - `est-104-clipboard.ps1`
  - `est-105-autosave.ps1`
  - `est-106-undo-redo.ps1`
  - `est-030-supplier-comparison.ps1`
  - `ti-147-editor.ps1`
  - `est-164-catalogue-suggestions.ps1`
- `lifecycle`:
  - `ti-143-navigation.ps1`
  - `ti-144-list.ps1`
  - `ti-145-create.ps1`
  - `ti-149-duplicate.ps1`
  - `ti-150-status.ps1`
- `output`:
  - `ti-151-print.ps1`
  - `ti-152-export.ps1`
- `settings`:
  - `ti-146-parameters.ps1`
  - `ti-153-suggestions.ps1`
  - `ti-142-types.ps1`
- `security`:
  - `ti-141-db-rls.ps1`
- `assemblies`:
  - `ti-182-assemblies.ps1`
- `dpgf`:
  - `dpgf-import-flow.ps1`
  - `dpgf-affaire-wizard-editor-flow.ps1`
- `all`:
  - full HEX coverage (including `ti-140-epic.ps1`)

### Playwright matrix (EST-262 partial)

- `e2e/estimates/full-lifecycle.spec.ts`
  - Scenario 1: creation wizard + line edition + autosave
  - Scenario 2: status transitions (`draft -> sent -> accepted`)
  - Scenario 4: export XLSX + print page checks
- `e2e/estimates/duplicate.spec.ts`
  - Scenario 3: duplicate estimate + copied line verification
- `e2e/estimates/import-dpgf.spec.ts`
  - Scenario 5: DPGF import + mapping save + catalogue link flow
- `e2e/estimates/takeoff-guard.spec.ts`
  - TKF-025: guard apply blocks unverified low-confidence items on Level C
  - Verify items then retry apply (guard passes)
  - Level A bypass (no guard)
  - Admin override with justification
  - Excluded items do not trigger guard
  - Requires `SUPABASE_SERVICE_ROLE_KEY` for DB seeding
- `e2e/estimates/takeoff-epics-matrix.spec.ts`
  - E01: takeoff health and foundations smoke
  - E02: level A job creation + listing
  - E03: provenance fields + item review editability
  - E04: plan-set CRUD smoke (create/list/delete)
  - E06: job list offset ceiling validation (`offset <= 10000`)
  - E07: compare endpoint delta on two revisions
  - Requires `SUPABASE_SERVICE_ROLE_KEY` for DB seeding when available (falls back to authenticated user)

Playwright config is in `playwright.config.ts` with:
- automatic screenshots on failure (`screenshot: only-on-failure`),
- HTML report output in `playwright-report/`,
- CI artifact upload from `.github/workflows/e2e-playwright-critical.yml`.

### RLS matrix (EST-261 partial)

- `src/lib/estimates/rls.e2e.test.ts` validates a CRUD matrix (`SELECT/INSERT/UPDATE/DELETE`)
  by role (`admin/engineer/viewer`) on:
  - `estimate_versions`
  - `estimate_items`
  - `estimate_categories`
  - `labor_roles`
  - `estimate_suggestion_rules`
  - `audit_logs`
- Le premier des deux tests Vitest couvre aussi les mutations d'un propriétaire
  rétrogradé viewer, le DELETE gouverné d'`estimate_projects`, la RPC de suppression
  avec cascade réelle des journaux append-only, ainsi que les frontières
  `takeoff_jobs`/`takeoff_items` (rôles, statuts, worker/provider, retry/reconcile,
  source, plan-set, draft-lock et apply atomique).
- Le second test couvre l'isolation cross-tenant (un non-membre doit être refusé).
- `portal_tokens` is probed and reported when absent from the current schema snapshot.
- La commande canonique est `npm run db:ci:local` : elle crée une pile loopback
  éphémère et trois comptes Auth jetables. La suite refuse désormais une URL distante
  ou une exécution hors de ce runner local.
- Fail-closed CI workflow: `.github/workflows/e2e-rls-matrix.yml`. It blocks merges
  only when repository branch protection requires this check.

### Runner options

List available suites:

```bash
npm run e2e:run -- e2e/hex/run-all.ps1 -ListSuites
```

Run one suite manually and stop on first failure:

```bash
npm run e2e:run -- e2e/hex/run-all.ps1 -Suite editor -ContinueOnFailure false
```

`npm run e2e`, `npm run e2e:auth`, and all `npm run e2e:hex*` commands auto-load `.env` then `.env.local`.

## Environment variables

- `E2E_BASE_URL` (default: `http://localhost:3000`)
- `E2E_HEADED=1` to run with a visible browser window
- `E2E_SESSION` to control the agent-browser session name
- `E2E_LOGIN_EMAIL` and `E2E_LOGIN_PASSWORD` for auth state (required; no committed fallback)
- `E2E_AUTH_STATE` path for saved auth state (default: `e2e/.auth.json`)
- `E2E_AUTH_CACHE` (default: `1` for HEX flows). Set `0`/`false`/`off`/`no` to disable cache and force UI login.
- `E2E_LOGIN_EMAIL_2` and `E2E_LOGIN_PASSWORD_2` for `ti-141-db-rls.ps1` secondary account checks
- Les variables `RLS_E2E_*`, l'URL loopback et les clés locales sont internes au
  runner `db:ci:local` ; elles ne doivent pas être configurées avec des secrets distants.

Pour la matrice RLS canonique, utilisez `npm run db:ci:local` : la commande
provisionne trois comptes sur une pile Supabase locale, sans secret ni fallback E2E,
puis détruit la pile sans backup. `npm run e2e:rls` est une sous-commande interne et
refuse de s'exécuter hors de ce contexte local éphémère.

The expected test-account roles are documented in [`docs/test-logins.md`](../docs/test-logins.md).

If `E2E_LOGIN_EMAIL_2` or `E2E_LOGIN_PASSWORD_2` is missing, `ti-141-db-rls.ps1` now fails fast (no `SKIP` fallback).

By default, session names are isolated per process (`e2e-$PID`, `e2e-auth-$PID`, `e2e-hex-$PID`) and HEX suite runs isolate each test with its own session. This avoids collisions when multiple devs run E2E in parallel.

## Environment examples

```powershell
$env:E2E_BASE_URL = "http://localhost:3000"
$env:E2E_HEADED = "1"
npm run e2e
```

```powershell
$env:E2E_LOGIN_EMAIL = "user@example.com"
$env:E2E_LOGIN_PASSWORD = "password"
npm run e2e:auth
```

```bash
E2E_BASE_URL="http://localhost:3000" E2E_HEADED="1" npm run e2e
E2E_LOGIN_EMAIL="user@example.com" E2E_LOGIN_PASSWORD="password" npm run e2e:auth
```

## Auth state cache

When scripts use `e2e/hex/common.ps1`, `Login-E2E` automatically:

- tries to load `E2E_AUTH_STATE` (`e2e/.auth.json` by default),
- validates access via `/dashboard`,
- falls back to UI login only when cache is missing/invalid,
- and saves the refreshed state after a successful login.

Refresh cache manually with:

```bash
npm run e2e:auth
```
