# TesterArmy mixed tests and production performance

TesterArmy is the primary E2E runner. Critical business outcomes use exact assertions; optional agent steps navigate or explore, followed by exact checks. Existing Playwright cases remain until equivalent TesterArmy cases have passed. Specialist authorization, RLS, parser, race and recovery regressions remain where E2E misses a concrete failure.

`npm run e2e` selects the anonymous desktop/mobile smoke without a model or credentials. GitHub Actions runs that smoke against synthetic public configuration, with no shared backend. `e2e:army:critical` still requires the explicitly allowlisted dedicated account/environment. `e2e:army:agent` uses the separate supported subscription login and bounds goals/model calls; it is opt-in and its verdict does not replace assertions.

## Failure modes defined before optimization

| Failure | Observable scenario |
| --- | --- |
| Render-blocking assets or slow server rendering delay content | Actual production route, heading visible, buffered navigation/paint/LCP measurements and slow-resource paths |
| Hydration and JavaScript block the main thread | Buffered long tasks, total blocking duration and actual input assertions |
| Layout moves after fonts/content load | CLS using the maximum layout-shift session window |
| Interaction or scrolling drops frames | Synthetic email edit with exact value assertion; 60 animation frames during scroll with p95, maximum and >50 ms intervals |
| Deferred imports break navigation or dialogs | Existing business assertions plus actual first-open UI verification for changed features |
| The page silently redirects or measurements are absent | Exact route/heading assertions and nonempty paint/frame measurements |

Statement-level timings of large v3 estimates (creation and settings save on 1 021 items) are guarded in pgTAP, not here: see [large-estimate-statement-budget.md](large-estimate-statement-budget.md), which lists the batch writer and route timings it leaves unguarded.

## Commands

Prepare and measure the isolated production build in PowerShell:

```powershell
npm run e2e:army:performance:list
$env:E2E_ARMY = "1"
$env:PERFORMANCE_BUILD_DIR = ".e2e/army/next"
npm run build
Remove-Item Env:E2E_ARMY
Remove-Item Env:PERFORMANCE_BUILD_DIR
npm run e2e:army:performance
```

The wrapper owns a loopback production server on port 3107, refuses an existing server, loads the normal ignored local environment, requires exact `E2E_ALLOWED_SUPABASE_HOST`, and uses the existing dedicated account through UI login. No business record is created or changed. Authenticated traces stay off; measurements contain timings/resource paths, not response bodies, credentials, headers or cookies. Missing account/environment is missing proof. No automatic cleanup removes shared fixtures.

The suite visits login, signup, affaires, products and purchase orders on desktop and a mobile-sized browser viewport, with three samples each. Each test starts in a fresh context; repeated navigations can use browser caches. Login setup currently stubs Fontshare, but measured visits use actual font resources. CPU/network run at the local machine's native speed: viewport tests do not emulate a slow phone. Scroll frames are identified as scrollable/non-scrollable.

`npm run e2e:army:performance:grid` selects a separate browser-only grid benchmark. Available ARMY fixtures are drafts; visiting their editor normally acquires a lock. The benchmark reads an existing ARMY source, injects 1,000 deterministic line IDs and a read-only status into the browser's GET response, blocks local-origin mutations, exercises the actually scrollable container, then removes interception and verifies source timestamp, total and item count unchanged. It writes only local artifacts. This measures production frontend rendering on synthetic data, not connected editing, autosave, financial correctness or native-device behavior. Main performance and grid tags are selected separately; excluded results are not executed proof.

Each invocation archives its command, revision, working-tree/input hashes, fresh report and artifact hashes under `.e2e/army/performance/runs/`. Raw JSON is under its `artifacts/metrics/`. Compare the same command, machine, route, account and viewport after changes; first navigation and repeat samples must remain separate. Keep timing distributions, bundle sizes and correctness evidence distinct. Concurrent source changes prevent claiming a frozen candidate.

`npm run e2e:army:performance:affaire` selects the separate [affaire-loading comparison](affaire-loading-performance.md). It creates one new dedicated ARMY draft on first use, then reuses its retained receipt for five real desktop transitions and exact financial/item checks. Unlike the general page suite, this case may persist that owned draft's approval projection and audit events. It also checks fresh anonymous denial after authenticated rendering. Read its failure plan and fixture boundaries before running it.

LCP <=2.5 s, CLS <=0.1 and INP <=200 ms are the [Web Vitals field targets](https://web.dev/articles/vitals), evaluated at the 75th percentile of real visits. These short local samples provide diagnostics. `maxEventDurationMs` is a sampled event-duration signal, not field INP. Timing values are reported without a machine-dependent pass threshold; exact content/interaction assertions and existing build bundle budgets enforce correctness and size.

The installed engine is authoritative for this pinned version. Upstream APIs are evolving: current online setup uses an engine-owned `playwright-core`, while the installed `@e2e-dev/web` 0.11.1 requires the explicit Playwright peer. Upgrade the runner/engine and adapt artifacts as a separate compatibility change.

## Verified local result: 2026-10-09

Next.js, eslint-config-next and Windows SWC are installed at 16.4.0. The isolated webpack production build passes OpenAPI validation and all five existing bundle budgets. The reference performance run passed 12/12 results; the optimized run passed 14/14, including the two login setups and first-open/close/focus checks for the three product dialogs on both viewports. No result was skipped, no model was invoked, and the recorded source was unchanged during both runs. The optimized build identity was also unchanged during measurement. Every archived report/artifact/log hash was independently checked.

Product creation, CSV import and template import dialogs now load only when opened. The product route budget fell from 234,689 to 225,469 gzip bytes (-3.9%); the measured first-navigation JavaScript fell by 36,015 decoded bytes in both viewports. All 30 measured visits retained zero total blocking duration and frame p95 <=16.8 ms in these short local samples. Maximum observed CLS was 0.039.

| Page | LCP median before, desktop / mobile viewport (ms) | LCP median after (ms) |
| --- | --- | --- |
| Login | 536 / 552 | 536 / 552 |
| Signup | 24 / 24 | 24 / 24 |
| Affaires | 240 / 248 | 412 / 240 |
| Products | 324 / 288 | 336 / 308 |
| Orders | 396 / 256 | 304 / 296 |

These three-sample medians do **not** establish a loading-time improvement: timings vary and products LCP did not improve. The verified improvement is less initial product JavaScript, with the first-open dialog behavior preserved. These visits do not qualify the estimate grid under large data, native mobile, field INP, or the full critical business/RLS campaign.

Local repeatable evidence:

- Reference: `.e2e/army/performance/runs/2026-10-09T17-44-06-736Z/`.
- Optimized: `.e2e/army/performance/runs/2026-10-09T17-50-35-024Z/`.
- Verified before/after comparison: `.e2e/next-16.4-upgrade/comparison.json`; build logs and pre-edit failure plan are retained alongside it.

The anonymous smoke also passes 2/2 with the CI's synthetic public Supabase configuration and no backend/model/account. The workflow is authored locally; GitHub execution has not been triggered. Subscription authentication is absent in this environment, so the opt-in agent navigation/replay has not been executed. Configure it through `npx e2e login openai` before `npm run e2e:army:agent`.

The separate 1,000-line grid benchmark passed 4/4 selected results (two login setups and two viewport benchmarks), with 12 unrelated results excluded. Its archive is `.e2e/army/performance/runs/2026-10-09T18-01-33-299Z/`, and `.e2e/next-16.4-upgrade/grid-summary.json` retains the verified summary. Source and build remained unchanged during that run; every artifact/report/log hash matches. Six three-sample visits had LCP 276–344 ms, frame p95 <=16.8 ms and no frame >50 ms; maximum desktop frame was 33.4 ms. Startup still produced a 127 ms task and up to 77 ms total blocking, so this is not a claim of universally smooth large-estimate editing. The source ARMY version remained unchanged.

## Actual client navigation: localhost diagnosis

The direct-load LCP cases above do not measure transitions between pages. The final navigation scenario uses the visible desktop global navigation and the reference-data hub's product link. It repeats four transitions in the same browser context, records click-to-URL, click-to-visible-heading (plus two animation frames), loading feedback and completed request timings, and checks the orders list/empty state without an error and the product count. It does not open an affaire detail or editor, or submit business forms.

```powershell
# Attach to the existing localhost:3000 server; never start or stop it.
npm run e2e:army:performance:navigation:live
# Use the isolated production build prepared above; own port 3107.
npm run e2e:army:performance:navigation
```

An explicit `E2E_ARMY_BASE_URL` may select another loopback HTTP origin. Both commands keep the dedicated login/host allowlist and authenticated traces off. Only the desktop case is supported. Metrics are archived as `artifacts/metrics/navigation-metrics.json` by the standard wrapper. The attached server's build identity and cold state are not controlled; the production build ID and unchanged-build check are recorded. No existing development server is restarted to force a cold sample.

Initial actual localhost:3000 measurements found the commands heading at 997 ms on the first measured transition and 131 ms on repetition; the ARMY affaire heading took 4,065 ms then 1,264 ms. Evidence: `.e2e/navigation-diagnosis/2026-10-09T18-23-44-323Z-live/`. These are first measured visits, not a guaranteed cold server. A later warmed development run took 1,679 / 1,379 ms for the same affaire, compared with 947 / 931 ms in the rebuilt local production app. Those standard archives are `.e2e/army/performance/runs/2026-10-09T18-27-04-261Z/` and `2026-10-09T18-27-51-227Z/`. Each passed two selected results (ordinary login and twelve transitions); seven other results were excluded. Source remained unchanged; production build `98rhaNoRcrz-Z0Cl22Cka` also remained unchanged. Those initial runs cannot prove database immutability: review found `getEstimateApprovalSummary` calls `syncEstimateApprovalSummary(trigger: "read")`, which can update the version's approval projection and audit events when it changes. No before/after snapshot established whether this happened. The detail step was removed from the final scenario; no rollback or remote fix was attempted. Follow-up review notes are retained separately from original reports/manifests.

The existing server serves development React/Turbopack assets. [Next.js automatically prefetches only in production](https://nextjs.org/docs/app/guides/prefetching), and development compiles routes on demand. These mechanisms explain why a first local transition can be slower; timing variation also includes route/browser caches and the remote backend. The top navigation uses default prefetch; the overlay drawer explicitly disables it. Enabling drawer prefetch alone would not fix development navigation.

Code inspection identifies additional server/data waterfalls: the proxy validates the user for page/RSC/API requests; route handlers may validate again, and [Supabase `getUser` makes an Auth network request](https://supabase.com/docs/reference/javascript/auth-getuser). Products and orders start SWR API reads after mounting. The affaire hub waits for its initial group, then another group of approval/register/cockpit/finish-line reads before rendering the hub. In the production sample, the affaire response stream lasted about 0.9 s while its first byte arrived in 40–57 ms, consistent with server work after the loading shell. The measurements do not isolate each backend query's contribution. Shared dashboard layouts are reused on sibling client transitions; their initial authentication waterfall is not repeated wholesale at every click.

`clickToUrlMs` records the first DOM observation after the URL changes, not the exact history update. `clickToContentCheckedMs` includes runner polling and transport overhead and is an upper bound, not a paint timestamp. Resource duration includes the response stream; first-byte wait includes browser/connection overhead and omits later streaming work. Requests prefetched before the click or still unfinished at the snapshot are absent. The existing app may update localStorage and send Web Vitals telemetry if configured. Local short samples do not establish production field percentiles or prove an upgrade caused the latency. The next optimization target is reducing unnecessary serial server reads and progressively displaying useful affaire sections, followed by data preloading and immediate navigation feedback; authentication and pending-edit persistence guarantees must remain intact.

The final reduced production scenario passed 2/2 selected results (UI login and eight transitions), with seven unrelated results excluded, in `.e2e/army/performance/runs/2026-10-09T18-33-57-499Z/`. Source/build remained unchanged and archived report, metrics and owned log hashes were independently verified. Headings appeared in 81–365 ms in these samples. A final attempt to attach to localhost:3000 failed during login because the server no longer answered (`ERR_CONNECTION_REFUSED`); the navigation case was not executed and this is missing development proof for the reduced scenario. The runner did not own that server. The Web Vitals endpoint was verified absent in the loaded local environment and compiled dev/production bundles; its reporter returns without sending when empty. An automatic-review telemetry concern was resolved by these read-only checks before retrying. Typecheck, touched-file lint, syntax checks and diff whitespace checks passed; the isolated production build passed OpenAPI validation and all existing bundle budgets. No application authentication or data-loading code was changed by this diagnosis.
