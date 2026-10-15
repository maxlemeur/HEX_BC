# E2E TesterArmy

TesterArmy (`e2e` 0.21 et `@e2e-dev/web`) exécute les parcours navigateur.
Les assertions exactes déterminent le résultat ; la navigation par agent reste
facultative. Voir [le guide Army](../docs/testing/tester-army.md),
[la CI native](../docs/testing/tester-army-ci.md) et
[la correspondance des parcours historiques](../docs/testing/army-migration.md).

## Profils

- `npm run e2e` : smoke anonyme desktop/mobile, sans modèle.
- `npm run e2e:army:critical` : contrôles métier prioritaires.
- `npm run e2e:army:full` : parcours de production, spécialistes et métré.
- `npm run e2e:army:development` : trois scénarios du simulateur de hub.
- `npm run e2e:army:polish` : audit optionnel des routes explicitement sélectionnées,
  aux quatre largeurs historiques ; voir [ses limites](../docs/testing/tester-army-polish.md).
- `npm run e2e:army:ci -- full` : SQL, RLS, build, production puis
  développement sur une pile Supabase native éphémère (Linux/macOS ; Windows via WSL).

La CI crée son compte ARMY, refuse les secrets et fichiers env ambiants et détruit
sa pile locale. Pour une campagne manuelle, lire les prérequis du profil avant
exécution : backend loopback explicitement autorisé, compte dédié et nouvelles
fixtures ARMY. Les prérequis worker locaux gardent leurs clés côté Node ; les
actions de l'application utilisent la connexion utilisateur normale.

Les manifestes et archives `.e2e/army/` conservent commande, sources, build,
identités, assertions et empreintes. Échec, skip et setup incomplet restent des
preuves manquantes. Les archives de CI sont contrôlées avant publication.

## Scripts PowerShell historiques

Les scripts ci-dessous restent disponibles pour leurs contrôles spécialisés.
Ils exigent `agent-browser`, PowerShell et une application locale déjà lancée.

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

## PowerShell / agent-browser : **non couverts en CI**

Les suites `e2e/hex/*.ps1` (PowerShell + `agent-browser`) ne tournent dans
aucun workflow GitHub Actions. Les workflows navigateur utilisent TesterArmy.
Les scripts restent dans le dépôt pour une exécution locale
(`npm run e2e:hex`, `npm run e2e:hex:all`, `npm run e2e:hex:<suite>`).
Ce n'est pas un port : c'est la disposition du périmètre HEX hors CI.

Inventaire des scripts sous `e2e/hex/` :

- helpers / runners : `common.ps1`, `run-all.ps1`, `suites.ps1`
- catalogue : `prices-page.ps1`, `prices-import-guided.ps1`
- editor : `est-101-keyboard.ps1`, `est-102-inline-edit.ps1`,
  `est-103-multiselect.ps1`, `est-104-clipboard.ps1`, `est-105-autosave.ps1`,
  `est-106-undo-redo.ps1`, `est-030-supplier-comparison.ps1`,
  `est-164-catalogue-suggestions.ps1`, `ti-147-editor.ps1`
- lifecycle : `ti-140-epic.ps1`, `ti-143-navigation.ps1`, `ti-144-list.ps1`,
  `ti-145-create.ps1`, `ti-149-duplicate.ps1`, `ti-150-status.ps1`
- output : `ti-151-print.ps1`, `ti-152-export.ps1`
- settings : `ti-146-parameters.ps1`, `ti-153-suggestions.ps1`,
  `ti-142-types.ps1`, `est-027-multi-currency.ps1`
- security : `ti-141-db-rls.ps1`
- assemblies : `ti-182-assemblies.ps1`
- dpgf : `dpgf-import-flow.ps1`, `dpgf-affaire-wizard-editor-flow.ps1`

Scripts spécialisés disponibles ; leur présence ne qualifie pas leur exécution en CI :

- **settings** — `ti-146-parameters.ps1`, `ti-153-suggestions.ps1`, `ti-142-types.ps1`
- **security** — `ti-141-db-rls.ps1`
- **assemblies** — `ti-182-assemblies.ps1`
- **output** — `ti-151-print.ps1`, `ti-152-export.ps1`
- **editor** — `est-101-keyboard.ps1` … `est-106-undo-redo.ps1`

## RLS matrix (EST-261 partial)

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
- Il vérifie aussi la frontière tenant actif avec la requête PostgREST réelle
  `tenant_memberships -> tenants!inner`, masque tenant et membership suspendus,
  puis refuse atomiquement la décision d'un token portail sans modifier le token
  ni la version.
- Le même test vérifie le basculement atomique d'un tenant par défaut suspendu et
  les refus d'une cible inactive, étrangère ou bloquée par un défaut non-admin.
- Le second test couvre l'isolation cross-tenant (un non-membre doit être refusé).
- `portal_tokens` is probed and reported when absent from the current schema snapshot.
- La commande canonique est `npm run db:ci:local` : elle crée une pile loopback
  éphémère en runtime natif Supabase, sans Docker, et trois comptes Auth jetables.
  Prérequis : Linux (glibc 2.35+) ou macOS 14+ sur Apple silicon, compte non root ;
  sous Windows, depuis WSL et un clone Linux du dépôt (voir `supabase/README.md`).
  La suite refuse une URL distante ou une exécution hors de ce runner local.
- Fail-closed CI workflow: `.github/workflows/e2e-rls-matrix.yml`. It blocks merges
  only when repository branch protection requires this check.

## Runner options

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
- `E2E_ALLOWED_SUPABASE_HOST` for the exact Supabase hostname authorized for the
  remote critical suite (for example `staging-project.supabase.co`); loopback runs
  must explicitly use `localhost` or `127.0.0.1`.
- `E2E_AUTH_STATE` path for saved auth state (default: `e2e/.auth.json`)
- `E2E_AUTH_CACHE` (default: `1` for HEX flows). Set `0`/`false`/`off`/`no` to disable cache and force UI login.
- `E2E_LOGIN_EMAIL_2` and `E2E_LOGIN_PASSWORD_2` for `ti-141-db-rls.ps1` secondary account checks
- Les variables `RLS_E2E_*`, l'URL loopback et les clés locales sont internes au
  runner `db:ci:local` ; elles ne doivent pas être configurées avec des secrets distants.

Pour la matrice RLS canonique, utilisez `npm run db:ci:local` : la commande
provisionne trois comptes sur une pile Supabase locale en runtime natif, sans secret
ni fallback E2E, puis détruit la pile et ses données (`stack destroy`). `npm run e2e:rls` est une sous-commande interne et
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
