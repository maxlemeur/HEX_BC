# Tester Army: critical business journeys

## Failure modes recorded before implementation

| Priority | Journey | Failure that must fail the test | Independent evidence |
| --- | --- | --- | --- |
| P0 | Access control | Anonymous API reads or writes return estimate/import/takeoff data or accept a valid request | Real HTTP status and error code, anonymous trace page |
| P0 | Login/signup before hydration | Native form submission puts an email/password in the URL when application scripts are unavailable | Real browser with Next scripts withheld, synthetic credentials only, observed HTTP method/query keys |
| P0 | Create, price and save | Wizard loses parameters; edits stay only in memory; tax is rounded on the aggregate instead of each line; saved totals differ after reload | Fixed cent-based oracle, exact fields read through the authenticated API, reloaded controls |
| P0 | Concurrent save | An obsolete `updated_at` overwrites a newer title or silently succeeds | Successful first write, exact 409 `VERSION_CONFLICT`, unchanged persisted second read |
| P1 | Duplicate | Copy shares item identifiers or parent links, loses prices, or changing the copy modifies the source | Different version/item IDs, copied hierarchy and monetary fields, source reread |
| P1 | Export and print | Download succeeds but contains wrong quantities/prices/tax/totals, or print differs from the saved estimate | Parsed workbook cells, saved XLSX bytes and SHA-256, exact print assertions |
| P1 | DPGF | Raw rows/mapping/canonical confirmation lose a row, decimal quantity, reference or source identity | Real CSV fixture, raw-row and canonical-item assertions, import/source IDs |

The per-journey files `tester-army-{access,estimate,dpgf}-cases.md` refine these oracles before their corresponding tests are written. No agent verdict, successful click, autosave label, nonempty download, or test discovery alone counts as business coverage.

The pre-hydration regression was added after a real login attempt exposed the default native GET submission. Its fixture uses a non-account `example.invalid` email and a synthetic opaque password; all browser Supabase Auth requests are blocked. It tests transport privacy, not a successful no-JavaScript login/signup.

The ordinary-login setup probes hydration before filling any real secret. A cold render can display the toggle before its event listener is attached, so a single early click cannot establish readiness. Poll the observable password-toggle state, retrying the non-secret click while needed, then restore the masked state before filling credentials. A failed probe is setup failure and missing business proof.

## Authorized environment and fixture boundary

On 2026-10-02 the user explicitly selected **the currently configured Supabase, with dedicated ARMY test data**, after being told the alternative was a disposable local database. Only new projects/versions/imports whose names start with `ARMY` belong to this campaign. Existing account membership and tenant permissions are prerequisites; tests never create an admin membership or repair them.

The user subsequently requested creation of a dedicated test account. That one-time provisioning is a separate authorized operation: the server-side Auth Admin API creates a confirmed account without an email, and its newly created personal tenant is verified and named ARMY. No existing business tenant or user membership is changed. The campaign itself still uses ordinary UI login and application authorization. Its account password is generated randomly and saved only in the ignored local `.env.local`; `.e2e/army/test-account.json` contains non-secret ownership/provisioning evidence for reuse.

The application runs on an owned loopback Next server. Its Supabase origin must exactly match `E2E_ALLOWED_SUPABASE_HOST`; missing credentials or a mismatched host fail before execution. Use the existing E2E account through the login UI with an opaque Tester Army password. Do not extract JWTs, use service-role credentials, send emails, accept real estimates, modify catalogue records, apply migrations, or change existing business data. Keep the created drafts for inspectable evidence; the fixture manifest lists their IDs. No automatic destructive cleanup is performed on the shared database.

Authenticated sessions remain subject to the SDK's secret taint. They produce exact assertion steps, JSON result artifacts and downloaded workbooks. Screenshots and model pixels after a password fill are unavailable; do not bypass this policy. Authenticated traces stay disabled (`trace: "off"`). Since `e2e` 0.20.0 a trace is a markdown page (`results/<test>/trace.md`) rendered from the report, not a Playwright zip, and turning it off does not keep browser-derived text out of the evidence: whatever the trace mode, `report.json` records for every attempt a browser log (`appLog`: console lines, uncaught errors, failed requests and 4xx/5xx responses with their full URL) and navigation URLs. The SDK redacts there only the configured credentials and secrets, not the access/refresh tokens generated by Supabase, so the wrapper pattern-scrubs tokens from the report before hashing and archiving it, as it does for the application log below. Only the anonymous access test retains a trace page. Artifacts stay in the ignored local `.e2e/army/critical/` directory (SDK evidence under `results/`, business JSON under `artifacts/`) and are not uploaded.

The runner appends its application log across invocations. Matching only the current configured password would leave an older submitted password after an account change. Before retaining evidence, the wrapper must also redact password/token/code/API-key query values, bearer tokens, JWTs and JSON password/token fields independently of their value. The manifest hashes the sanitized cumulative log and the run archive retains that exact file; it is not a per-run request count.

These browser/API journeys do not replace the isolated local RLS matrix, cross-tenant tests using independent accounts, a running takeoff extraction worker, or PDF native/cancellation proof. A CSV import result does not establish PDF/XLS/XLSX import coverage.

## Execution and evidence

`npm run e2e:army:critical:list` collects the critical cases without running the app or creating records. `npm run e2e:army:critical` executes them on desktop Chromium by default; `--target chromium-mobile` selects the 390x844 browser viewport. A browser viewport is not native mobile proof.

The wrapper records the command, source revision, dirty-source digest, target Supabase host, fixture scope, per-test outcomes, fresh report and artifact hashes. Each business fixture also writes its own IDs and result JSON. Each executed run's report, SDK `results/` and business `artifacts/` are copied to a timestamped `runs/` directory; the SDK clears `results/` and the wrapper empties `artifacts/` before the next invocation. Downloaded workbooks are under `results/<test>/attempt-<n>/downloads/`. Run outcomes and any unverified boundaries must be recorded after actual execution.

## Verified results — 2026-10-02

The full command `npm run e2e:army:critical` ran on desktop Chromium against the authorized hosted Supabase from `18:08:41.701Z` to `18:15:32.767Z`. All ten results were selected and executed: **nine passed, one failed, zero skipped**. This includes the successful account-login setup; **eight of the nine business scenarios passed**. Model tokens and model calls were zero. The recorded source revision was `b3b319493304530a6f19533bd1e592cd5ef53fbe`, with the dirty diff and runtime inputs fingerprinted and unchanged during the run.

| Scenario | Executed result | Retained evidence |
| --- | --- | --- |
| Ordinary account login | Passed | Setup assertions after proving hydration; dedicated account ownership in `.e2e/army/test-account.json` |
| Anonymous API boundaries | Passed | Seven exact `401/UNAUTHORIZED` observations and anonymous trace |
| Login and signup before hydration | Both passed | Native `POST`, no credential query keys, synthetic non-account fixture only |
| Financial inputs, autosave and reload | Passed | Exact `20004/4000/24004` cent totals and reloaded controls |
| XLSX, DPGF and print | Passed | Two actual downloaded workbooks, parsed cells and exact print contents |
| CSV DPGF with business headers | Passed | Three raw/mapped/canonical lines, decimal/zero quantity, source identities, unchanged V1 and reload |
| CSV DPGF with opaque headers | Passed | Same full oracle after the parser correction |
| Stale-save rejection | Passed | Exact `409/VERSION_CONFLICT`, newer title preserved, `If-Match` precedence |
| Duplication and independent copy edit | Failed before a copy was created | Real `400/BAD_REQUEST`, details SQLSTATE `42P01`; later independent-copy assertions remain unverified on shared Supabase |

The retained local archive is `.e2e/army/critical/runs/2026-10-02T18-08-41-701Z/`: `manifest.json`, `report.json`, 49 hashed artifacts, two workbooks and one anonymous trace. Report, artifact and sanitized cumulative-log hashes were verified after execution. Its manifest SHA-256 is `7a91b15b8666972e306176c46622889a6f2f91e4324099c0428fbabcb809d1f5`. The current `.e2e/army/critical/manifest.json` points to the latest invocation; later runs retain this archived pre-migration result.

Note (2026-10-14): this run used `e2e` 0.15.2. Its anonymous trace is a Playwright trace zip and its downloads sit under the archive's `artifacts/`. Since `e2e` 0.20.0 the access test keeps a markdown `trace.md` and downloads land under `results/`; both are archived in `runs/<stamp>/results/`.

The opaque-header regression failed before implementation with `row_count: 0` instead of three (`runs/2026-10-02T17-57-55-697Z/`). The fix limits vocabulary bonuses when two numeric cells and header words confined to a single description identify a data row. The existing nine parser tests, touched-file lint and typecheck pass. One first post-fix replay lost its local server with `ECONNRESET` before upload and is retained as infrastructure failure; it did not qualify the parser. The unchanged replay and the full final lot both passed the two CSV variants.

Duplication's function was renamed while ten implicit parameter qualifications retained its old name. The [new corrective migration](../../supabase/migrations/20261002175735_fix_estimate_duplication_parameter_qualification.sql) changes only those qualifications in the deployed internal function, preserving its facade, owner, signature, security settings and ACL. The [isolated PostgreSQL regression](tester-army-duplication-regression.md) passes **40 assertions using the read-only deployed snapshot and 37 using canonical migrations**, including rollback, access denial and idempotence. **At the time of the full run above, no corrective migration had been applied to shared Supabase.** That isolated result did not turn the failed remote E2E into a pass.

## Post-migration duplication replay

The human explicitly answered **“Appliquer cette correction et vérifier”** in the coordinating demonstration chat, authorizing this exact migration and a connected replay on ARMY fixtures only. The coordinator applied it under remote version `20261002182830`; the local SQL checksum remains `71bddc67af9c06aa6fe04b5620dd40bb6d4f32422df3db5d82ef8de86ba3898c`. A subsequent read-only function inspection confirmed no stale qualification and the unchanged facade/internal ACL and `SECURITY DEFINER` settings. No account, role or local credential was changed for the replay.

The first two attempts stopped during the hydration probe before credentials or business fixtures. An additional setup-only filter produced `NO_TESTS` because the runner executes setups only for selected dependent tests. These are missing business proof, and their manifests are retained.

The command `npm run e2e:army:critical -- --grep duplication` then passed both selected results (login setup and duplication), with eight other results excluded. It observed real HTTP `201`, preserved all copied hierarchy/financial settings and manual provenance markers, edited the copy, reloaded it and reopened the unchanged source. The source retains `20004/4000/24004` cents; the edited copy retains `30004/6000/36004` cents.

This initial passing replay is archived under `runs/2026-10-02T18-46-56-037Z/` (manifest SHA-256 `bc9b851e21450c8d5e9a457902b3360ec034ab7d27fe212dc62ae016934d089f`). Its report, ten artifacts and sanitized log hashes match. **`source.changedDuringRun` is true:** concurrent UI/catalogue changes occurred, including `MarginTiersExplanation.tsx`. It establishes the observed persisted business result, not a frozen candidate; a final replay on stabilized source is required before that stronger claim.

## Isolated local replay and `e2e` 0.20.0 upgrade — 2026-10-14

Environment: a disposable **local** Supabase stack (native runtime in WSL, loopback `127.0.0.1:57321`, all migrations of the working tree applied), not the hosted database. The application ran from a shallow clone of `HEAD` `28ccc857` with the exact working diff of the repository replayed (same `workingDiffSha256` content, `source.changedDuringRun` false), on desktop Chromium. The account was created for this stack only (local sign-up, personal tenant renamed `ARMY Audit`, role admin); one catalogue article (`ARMY-CU22-ML`, unit `ml`) was seeded in that tenant because a fresh tenant has none and the unit scenario requires one. No hosted Supabase, email or external service was contacted.

| Run (archive under `.e2e/army/critical/runs/isolated-local-2026-10-14/`) | Runner | Result | Explanation |
| --- | --- | --- | --- |
| `2026-10-14T18-08-54-916Z` (manifest `586a92b8…3a7add3`) | `e2e` 0.15.2 | 10 passed, 3 failed | Two journeys predated the `expected_content_revision` contract that `PATCH /api/estimates/[versionId]` already required at `HEAD` (historical rounding modes, stale save: `400` instead of `200`); the unit scenario lacked its catalogue fixture. |
| `2026-10-14T18-17-56-344Z` (manifest `8be30fa3…102a85d3`) | `e2e` 0.20.0, unadapted | 8 passed, 5 failed | Same three, plus both export scenarios: downloads now live under `results/<test>/attempt-<n>/`. This archive also shows the stale-evidence defect: its `artifacts/` holds the previous run's files. |
| `2026-10-14T19-47-37-809Z` (manifest `56daee6c…8174ec4c`) | `e2e` 0.20.0, adapted | **13 passed**, 0 failed | Journeys send the content revision, downloads and trace pages are read from `results/`, observers use `route.fallback()`, catalogue fixture present. |

The adapted run kept one `trace.md` (access boundaries), 78 fingerprinted files, and its archive contains `results/` and `artifacts/`. A scan of the archive found no JWT, `Bearer` value or the account password. The unit scenario persisted unit `ml` with the designation in the title; the catalogue suggestion popover path is still not covered.

Anonymous smoke archives under `.e2e/army/runs/isolated-local-2026-10-14/`: `e2e` 0.15.2 passed 2/2 (`2026-10-14T18-08-16-074Z`); `e2e` 0.20.0 on a fresh output before the wrapper change exited 3 `evidence_unavailable` (`…-fresh-output-red/manifest.json`); the adapted wrapper passed 2/2 with two `trace.md` pages (`2026-10-14T19-47-20-048Z`, manifest `374c828f…7e13c45d`).

Final replay on the final tree — 2026-10-15. After the adapted run above, the application's `zod` was restored to 4.4.3 (the upgrade had silently hoisted 4.6.1, which broke two OpenAPI/Gemini schema tests) and the `create-membership` contract text was corrected. The local stack had stopped overnight: `2026-10-15T05-26-30-514Z` (manifest `1541b1ac…7ef441`) failed at the login setup with the API unreachable and skipped the nine dependent journeys, which is missing proof, not a regression. After restarting the stack, resetting it from the 244 migrations (pgTAP 14 files, 1 268 tests, PASS) and recreating the local account and catalogue article, `2026-10-15T05-29-19-980Z` (manifest `71f5ae13…48dbab0`) passed **13/13** with `source.changedDuringRun` false; the smoke `2026-10-15T05-26-01-805Z` (manifest `b17f5e13…2daafb7`) passed 2/2 with two trace pages. Its archive contains no JWT, `Bearer` value or account password.

Not established by these runs: the hosted database, mobile viewport, the `e2e/army/local/` suites (offer emission, Resend portal, coverage profiles), which need the native local recipe and were only checked statically (`check:army-recipes` and the offline checkers), and agent mode.

## Rejeu partagé ciblé — 16 octobre 2026

Après application explicitement autorisée des prérequis de création, édition,
remise fixe et recalcul, le filtre `creation persists final French|duplication
preserves hierarchy` passe **3/3** (connexion incluse) sur la source publiée
`40ffb876`, en développement puis avec un build de production local, contre le
Supabase partagé autorisé. Montants exacts, persistance, hiérarchie, provenance
et indépendance de la copie sont vérifiés. Les échecs initiaux de connexion et
de création HTTP 500 restent archivés ; le conflit de lecture 409 observé en
production garde sa preuve séparée. Aucun 500 ne subsiste sur ces deux parcours.

Le [reçu détaillé](shared-estimate-recovery-20261016.md) distingue cette preuve
des anciennes campagnes locales et conserve la correspondance des migrations.
Les autres parcours, le viewport mobile, les exports et Vercel ne sont pas
qualifiés par cette sélection. Pour les itérations quotidiennes, utiliser le
[même bootstrap local jetable que la CI](tester-army-local-development.md).
