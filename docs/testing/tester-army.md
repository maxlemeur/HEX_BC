# TesterArmy

[Tester Army e2e](https://github.com/tester-army/e2e) is the primary E2E runner under the mixed testing policy. Exact browser assertions remain the pass criteria; bounded agent navigation exercises visible user intent. The [migration ledger](army-migration.md) maps the existing journeys to Army and retains failed runs. The anonymous smoke does not establish authenticated estimate/import/RLS coverage. See [native business CI](tester-army-ci.md) for the critical/full profiles and [production performance](tester-army-performance.md) for measured page loading and interaction evidence.

## Failure modes recorded before implementation

The optional [route audit](tester-army-polish.md) reuses the existing route inventory
and four viewport sizes through `e2e:army:polish`. Its explicit selection and
authenticated screenshot limitations stay separate from the full business suite.

| Failure | Observable check | Evidence |
| --- | --- | --- |
| Anonymous dashboard access bypasses the auth proxy or loops | `/dashboard/affaires` settles at `/login` | Trace page (`trace.md`) and report |
| Login renders a shell but hydration fails | Password visibility button changes its accessible label and pressed state in both directions | Passing trace page, with no credentials filled |
| Login fields disappear or email validation semantics disappear | Visible heading, enabled labelled password field, email required/type/autocomplete attributes | Exact assertion steps |
| Signup navigation changes destination or loses return path | Agent reaches `/signup`, signup heading is visible, then returns to `/login` | Exact URL/heading assertions after each agent goal |
| Agent submits a form or contacts an external site | Documented browser `route` API rejects non-read HTTP requests and external origins | Failed test and blocked request evidence |
| Smoke accidentally consumes model calls | Smoke excludes the `agent` tag and never requests the agent fixture | Report AI usage; lazy subscription adapter |
| Report belongs to an earlier run or another checkout | Wrapper records run timestamps, revision, working-diff/input digests and report hash; requires a fresh report | `.e2e/army/manifest.json` |
| Runner attaches to an unrelated server | Owned `app.command`, `reuseExisting: false`, dedicated port | App startup error or owned server log |

## Commands

Node 24 is the repository runtime. [package.json](../../package.json) and
`package-lock.json` define the installed runner and engine versions; each run's
manifest records its effective versions. The engine bundles its own browser
implementation; the root `playwright` dependency is also used by
`scripts/sofinther-prices.ts` and is not a substitute for the engine's browser
installation. Install with `npx @e2e-dev/web install chromium --with-deps`
(`--with-deps` adds Linux system libraries).

```powershell
npm run e2e:army:list
npm run e2e:army
npm run e2e:army -- --target chromium-desktop
```

The default smoke runs anonymous desktop and mobile-sized Chromium contexts. Mobile here means a browser viewport, not an Android/iOS device. The config starts Next with webpack through the current Node executable, then the runner owns shutdown. It uses `http://localhost:3107`, probes `/login`, and refuses an already running server. `E2E_ARMY=1` selects the ignored `.e2e/army/next` build directory and a generated pilot TypeScript config, preserving another dev server's `.next/dev/lock` and the root TypeScript config. Normal Next commands keep their existing configuration.

The smoke requires the public Supabase variables documented in `.env.example`; Next reads the checkout's normal env files. Fresh browser contexts contain no account session, no form is submitted, and no credentials are configured. The runner forbids reading secure field values and attributes; password checks use visibility, enabled state and the toggle's accessible state. The external Fontshare stylesheet is fulfilled locally with empty CSS; this pilot checks behavior with fallback fonts. Other external browser HTTP requests and non-read methods fail. Successful smoke is evidence for anonymous redirect/render/hydration only.

`E2E_ARMY_BASE_URL` can choose a local port. The config rejects non-loopback URLs, URL credentials and non-root paths, and normalizes a loopback hostname to `localhost` to preserve Next dev hydration. Shared or hosted environments need a separate reviewed configuration and explicit fixture/mutation scope.

## Optional subscription agent

Verified action recordings use a read/write replay cache only in the opt-in agent command. Smoke, critical and performance runs keep replay off. Exact assertions still execute after each goal.

Sign in yourself using the runner's supported OAuth command:

```powershell
npx e2e login openai
npx e2e models openai
npm run e2e:army:agent
```

The config uses `chatgpt()` from `e2e/oauth/chatgpt`; authentication is read only when the first model call occurs. It does not read Codex token files or require an OpenAI API key. `E2E_ARMY_MODEL` overrides the documented subscription default `gpt-6-luna`; model availability depends on the account and can be checked with `e2e models openai`.

The opt-in command selects `agent` tests on desktop by default, bounds each of two goals to six actions and six model calls (at most twelve calls total), and uses exact browser assertions afterward. It requests only public login/signup navigation, never fills a field, and never submits signup/login or sends email. Both files use the documented browser `route` API to abort and fail on external-origin or non-read HTTP requests. This constrains browser HTTP traffic; it does not enforce a server/network sandbox or intercept WebSockets and server-internal requests. Run `npm run e2e:army:agent -- --target chromium-mobile` for the alternate viewport.

For Windows, upstream quickstart recommends WSL. Native Windows CLI loading and an eventual native smoke result are separate from WSL compatibility: a WSL Node installation does not prove this checkout's Windows-installed `node_modules` works in Linux. Do not install or modify global WSL/Node as part of this pilot.

## Browser routes

Journeys intercept browser HTTP with `browser.route`; the newest matching route runs first. Since `@e2e-dev/web` 0.14.0, `route.continue()` sends the request straight to the network and skips every older route, while `route.fallback()` (no argument) hands it to the route registered before, which is what `continue()` did up to 0.11.1. Campaign guards (`**/*`: origin allowlist, send/status/email/approve/invite blocks, offer recipient and lifecycle admissions) are registered first, so an observer or mock registered after them that ends in `continue()` silently bypasses them while every test keeps passing. Observers and mocks therefore end in `route.fallback()`; only the final allow decision of a guard that is the oldest route for its requests calls `continue()`. The `continue({ url, method, headers, postData })` overrides skip the guards too. `src/test/ci-guardrails.test.ts` enforces the rule with its `ARMY_ROUTE_GUARD_CONTINUES` allowlist (exact call count per guard) under `npm test`.

## Repeatable evidence

Every wrapper run writes `.e2e/army/manifest.json`, including the exact command, runtime, revision, working diff digest, hashes of pilot inputs and untracked application files, anonymous fixture description, result, and fresh report/artifact hashes. The runner writes `.e2e/army/report.json` and one directory per test under `.e2e/army/results/<test>/`: `attempt-<n>/` holds that attempt's screenshots and downloads, and `trace.md` is the test's trace page, kept for passing tests too (`trace: "on"`). Since `e2e` 0.20.0 a trace is this markdown page rendered from the report (steps, browser log, screen at failure), not a Playwright trace zip: there is no trace viewer and no network, cookie or DOM capture. The wrapper requires one trace page per passing smoke result. Whatever the trace mode, `report.json` records each attempt's browser log (`appLog`: console lines, uncaught errors, failed requests and 4xx/5xx responses with their full URL) and navigation URLs; the SDK redacts only configured credentials and secrets. The SDK clears `results/` when a run's tests start and no longer writes or clears `<output>/artifacts/`, so the wrapper empties `<output>/artifacts/` (journey evidence) itself before each run, and archives each run that has a fresh report under `<output>/runs/<stamp>/` with its `report.json`, `results/`, `artifacts/` when present and the owned server log. That server app log lives at `.e2e/army/logs/app.log`. Outputs are ignored and should be retained together when reproducing or sharing a result. Wrapper flags allow the configured targets, headed mode, cache disabling, debug output, a positive `--max-duration` in milliseconds, and `--grep` for authenticated campaigns. Config/output overrides remain forbidden. The manifest retains selected flags, skip causes and run errors, so a duration limit cannot turn missing proof into a pass. See the [0.21 qualification](tester-army-021.md) for the local bounded campaign, explicit app environment inheritance, reduced-motion interaction and exact SDK download paths.

The wrapper requires a fresh report for a run to count as evidence; failures before runner startup receive their own manifest and cannot borrow an older report. `list` collects without starting an app, browser or model and produces a discovery manifest. Do not describe discovery as E2E execution. A smoke pass does not verify subscription authentication or the optional agent test. The parent task records actual validation results after implementation.

Installed operational references: `node_modules/e2e/skills/e2e/references/{setup,agent,writing-tests,running,debugging}.md`, `node_modules/e2e/docs/reference/{config,web}.mdx`, and `node_modules/e2e/dist/oauth/chatgpt.js`. These installed-version APIs take precedence over older examples.

## Critical business cases

The [critical campaign](tester-army-critical.md) adds nine scenarios: anonymous API protection, login/signup privacy before hydration, estimate autosave and financial integrity, duplication independence, actual workbook/print contents, canonical CSV DPGF import with business and opaque headers, and stale-save rejection. It uses a separate critical selection/output, documented ARMY-only fixtures and an explicitly allowlisted Supabase host. The anonymous pilot commands above keep their original scope.

`npm run e2e:army:critical:list` collects without executing. `npm run e2e:army:critical` needs valid local `E2E_LOGIN_EMAIL`/`E2E_LOGIN_PASSWORD` and `E2E_ALLOWED_SUPABASE_HOST`; see the campaign for execution results and remaining prerequisites. Password-tainted business sessions use JSON/workbook proof with traces disabled; anonymous access retains its trace page. Disabled traces do not keep the browser log and navigation URLs out of `report.json` (see the campaign's [fixture boundary](tester-army-critical.md#authorized-environment-and-fixture-boundary)). No agent OAuth is needed for these exact scenarios.

## Verified result — 2026-10-02

`npm run e2e:army` passes both selected desktop/mobile checks natively on Windows. The saved report records zero model tokens and zero model calls per step, two screenshots and two traces; report/artifact hashes match and the recorded source did not change during the run. The separate subscription OAuth store is absent, so agent execution remains unverified. The malformed-URL pre-start path was also executed: it exits with code 3 and saves a fresh failure manifest rather than borrowing previous evidence.

Note (2026-10-14): those two traces were `e2e` 0.15.2 Playwright trace zips under `.e2e/army/artifacts/`. With `e2e` 0.20.0 the same run keeps two `trace.md` pages under `.e2e/army/results/`. Smoke manifests written with 0.20.0 before the wrapper counted `trace.md` pages are not evidence: on a fresh output they exit 3 `evidence_unavailable`, and with 0.15.2 `artifacts/` left in place they passed on the old zips.

For that dated campaign, typecheck, integration ESLint and critical boundary
coverage passed; its Vitest and dependency-audit limitations are recorded in
[the test-signal audit of 2 October](test-signal-2026-10-02.md). Current quality
is established by `npm run verify:pr` on the identified checkout.

The complete desktop critical run finished with **9 passed / 1 failed**, including one successful login setup and all nine business scenarios. Duplication exposed a real SQL `42P01`; its corrective migration passed isolated PostgreSQL regressions, was subsequently authorized and applied, and a filtered connected duplication replay passed both selected results. That initial replay recorded concurrent source changes and remains distinct from proof on stabilized source. The passing CSV regressions include the formerly failing opaque-header import. See the [critical run results](tester-army-critical.md#verified-results--2026-10-02) for exact artifacts and proof boundaries.
