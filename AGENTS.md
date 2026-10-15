# Repository Guidelines

## Core Rules

- Use Visualize when a diagram or interactive comparison materially improves the explanation; otherwise use concise prose or a table.
- Be concise, direct, and candid. Challenge weak assumptions and distinguish verified facts from uncertainty
- Ground research in authoritative, current sources and link important evidence
- Preserve the original goal and constraints; finish authorized work end to end and verify the actual result before claiming completion
- Ask questions only when a decision is materially ambiguous, risky, or requires approval
- Use relevant skills; spawn subagents only for genuinely independent work and synthesize their findings
- Keep changes focused and simple. Avoid unrelated edits, unnecessary abstractions, and low-signal tests
- Test observable behavior, review substantial changes, and validate user-facing work in the real interface when applicable
- Preserve unrelated work and never take destructive, production, or external actions beyond what the user authorized
- Report meaningful blockers, outcomes, and evidence without noisy progress

## Working Contract

- Work from the repository root on `main`; do not create or switch branches unless explicitly authorized.
- Before editing, read applicable instructions and documentation, run `git status --short --branch`, inspect the relevant code, tests, configuration, and recent history, and confirm the request authorizes implementation.
- Treat all existing changes and untracked files as user-owned. Never delete, revert, overwrite, stage, or format unrelated work; exclude `design-qa.md` and `outputs/` unless explicitly requested.
- Do not commit, push, open a PR, deploy, apply remote migrations, or force-push without explicit authorization.
- A configured tool permission is not user authorization. Reuse explicit authorization already granted for the same scope; request a new decision only when the action or scope changes.
- Discuss or use Figma only when the user explicitly requests it.

Use current code, `package.json`, configuration, migrations, and focused documentation as operational truth. The root `README.md` is incomplete and is not sufficient by itself.

## Testing Policy

- Never write unit tests after you write code.
- Use TesterArmy (`e2e` + `@e2e-dev/web`) as the primary E2E runner. Mix bounded agent goals for navigation/exploration with exact assertions for business values, persistence, authorization and exports. Deterministic journeys need no model; an agent verdict alone does not establish correctness. Preserve a verifiable and repeatable artifact for every run.
- Keep existing Playwright journeys until a TesterArmy replacement has equivalent executed assertions and evidence. Keep justified specialist isolation coverage for failures E2E cannot adequately reproduce.
- If you must test a system in isolation, first write down all the ways it could fail, then write the code.
- Before implementing a change, define its observable failures and the E2E scenarios that expose them. Isolation is an exception: document the concrete failure that existing E2E assertions miss and why an E2E scenario cannot adequately reproduce it, then write the isolated regression before the implementation.
- Keep isolation tests only when they detect a real uncovered failure, such as an authorization bypass, race, recovery failure, parser edge case, or data-integrity error. Do not add tests for trivial getters, static source text, mocked forwarding, or behavior already asserted by E2E.
- E2E artifacts must record the command, source revision and local changes, environment, fixture identities, expected and actual results, and report or evidence paths sufficient to repeat and verify the run. Never include credentials or session tokens. A skipped test or failed setup is missing proof, not a pass.

## Architecture

- `src/app/`: Next.js 16 App Router pages, layouts, server actions, and `api/**` handlers.
- `src/components/`, `src/hooks/`: shared UI and reusable hooks.
- `src/lib/`, `src/workers/`, `src/test/`: domain/integration logic, background work, and shared test support.
- `e2e/`: TesterArmy journeys, shared fixtures and legacy PowerShell/agent-browser suites.
- `supabase/migrations/`, `supabase/functions/`: ordered database changes and Edge Functions.
- `src/lib/openapi/`, `openapi.json`: OpenAPI source generation and its tracked artifact.
- `docs/`, `maquette/`: focused records and design references.

For scan `91386191-6320-4d8c-83c2-a51fbfba12b1`, `docs/security-remediation-91386191.md` is the durable disposition ledger. Update it when dispositions change. Never rewrite canonical `findings.json`, `coverage.json`, `scan-manifest.json`, or provisional scan reports, and never treat a provisional report as proof of current exploitability.

## Runtime and Commands

Use Node.js 24 LTS as pinned by `.nvmrc` and used by CI/Vercel.

- Install: `npm ci` on a clean checkout; use `npm install` only for intentional dependency or lockfile changes.
- Run: `npm run dev`, `npm run dev:webpack` to isolate Turbopack behavior, or `npm run start` for an existing build.
- Check: `npx eslint <touched-files>`, `npm run lint`, `npm run typecheck`, `npm test`.
- Focus tests: `npm test -- path/to/file.test.ts`; add `--project=node` for server/domain tests or `--project=jsdom` for components/hooks.
- E2E: `npm run e2e` runs the TesterArmy anonymous smoke; use `e2e:army:critical` for priority business journeys, `e2e:army:full` for migrated production journeys and specialists, and `e2e:army:development` for the development-only hub scenarios. `e2e:army:ci -- full` runs both phases after native SQL/RLS checks on an owned ephemeral backend; read `docs/testing/tester-army-ci.md`. Opt-in agent navigation uses `e2e:army:agent`.
- Optional route audit: use `e2e:army:polish` with explicit `E2E_ARMY_POLISH_ROUTES`; read `docs/testing/tester-army-polish.md` for fixture and screenshot limits. It does not qualify unselected screens.
- TesterArmy pilot: `npm run e2e:army` runs anonymous desktop/mobile browser checks with `.e2e/army/manifest.json`, `report.json`, screenshots and markdown trace pages under `.e2e/army/results/` (no Playwright trace zip since `e2e` 0.20.0). Read `docs/testing/tester-army.md` and the installed `node_modules/e2e/skills/e2e/` guides before extending it. `npm run e2e:army:agent` requires the runner's separate subscription login; the anonymous pilot does not prove authenticated workflows.
- TesterArmy business cases: `npm run e2e:army:critical` uses the dedicated local test-account configuration and an explicitly authorized Supabase host. Read `docs/testing/tester-army-critical.md`; create only new ARMY drafts/imports and retain their identities and exact result artifacts. Authenticated traces stay off, but `report.json` still records the browser app log and navigation URLs, redacted by the SDK only for configured secrets; a prepared SQL fix still requires separate authorization before application to shared Supabase.
- Performance: read `docs/testing/tester-army-performance.md` before `npm run e2e:army:performance`. Measure an isolated production build, retain raw samples and source/build identity, and compare identical scenarios before/after optimization. Local timing and viewport evidence do not qualify field Web Vitals or native mobile performance.
- RLS: use `npm run db:ci:local` after checking prerequisites in `e2e/README.md`. It creates and destroys its own ephemeral local stack on the Supabase native runtime, without Docker (Linux or macOS on Apple silicon; on Windows, inside WSL from a Linux checkout). `e2e:rls` is internal to that runner; never provide remote secrets or bypass its local-runner checks.
- OpenAPI/build: `npm run generate-openapi`, `npm run validate-openapi`, `npm run build`.

Vitest uses `node` and `jsdom` projects. Legacy `e2e:hex`, `e2e:hex:all`, and feature-specific `e2e:hex:*` suites require a running app, `agent-browser`, and `pwsh` or `powershell`; verify prerequisites before blaming the product.

Use relevant E2E as the primary behavioral validation for UI, routing, auth, workflows, or RLS and preserve its repeatable artifact. Run focused isolation regressions only for a documented E2E gap; run the retained Vitest suite when changing or pruning that coverage. Also run touched-file lint, typecheck, build for release, routing, configuration, or OpenAPI work, and `git diff --check` as scope requires. Test warnings about fallback, portal, storage, or toasts may be intentional; prioritize failed assertions and exit codes, while investigating unexpected logs. Report unrelated global failures separately.

When routes or schemas change, update the OpenAPI generator, regenerate `openapi.json`, inspect its diff, and validate it. Missing public Supabase variables can cause environment-only build failures; never invent or expose secrets. Never print `.env.local`; required variables are documented in `.env.example` and `e2e/README.md`.

## Domain and Security Invariants

- Preserve the DPGF path `dpgf_rows_raw` -> mappings -> `confirmUnifiedImportFlow`.
- PDF imports must use that shared contract without regressing CSV/XLS/XLSX. Cover extraction and canonical import with realistic generated DPGF fixtures where practical, and preserve `sourceDocumentId` and `_timax_provenance`.
- Treat tenant membership, active-tenant checks, RLS, service-role clients, Storage paths, portal tokens, email side effects, and takeoff workers as high-risk boundaries.
- Never move service-role credentials into browser code or weaken authorization to pass a test.
- With PDF.js `disableWorker: true`, timers and `Promise.race` do not preempt CPU work; real cancellation requires a worker thread or terminable process.
- For local login failures, inspect the live UI, Supabase health, and direct authentication, then reload before changing code; a stale Next.js overlay is not current evidence.

## Supabase Changes

Create a new timestamped migration; never rewrite a migration that may have run. Inspect schema, migration history, RLS, and server authorization first; document failure modes and define the relevant E2E/RLS regressions before implementation, using isolation only for a documented E2E gap; validate locally or in isolated PostgreSQL/Supabase; run relevant app and RLS tests; document limitations. Apply to shared or remote Supabase only when explicitly authorized. `supabase/schema.sql` is a non-executable comment pointer, not a dump; schema truth is `supabase/migrations/`. Do not publish a migration count or latest filename as a frozen contract.

Do not assume `supabase db reset` works: verify the CLI and baseline because legacy `001_add_job_title_to_profiles.sql` ordering has blocked canonical resets. If full local execution is unavailable, focused SQL regression or an isolated fixture is acceptable only with the limitation stated.

## Code and Publication

Use strict TypeScript for exported APIs, 2-space indentation, semicolons, double quotes, and `@/` imports from `src/`. Use PascalCase components, `useX` hooks, lowercase route segments, and colocated `route.test.ts`, `module.test.ts`, or `Component.test.tsx` files for justified isolation exceptions. Keep route handlers thin; put reusable domain/integration logic in `src/lib/`. Cover bugs and security boundaries with E2E-first regressions under the Testing Policy.

For an explicitly authorized commit or push: re-run status, review the full scoped diff, stage only task-owned files, run `git diff --cached --check`, confirm validation, and reconcile with `origin/main` without force or loss of concurrent work. Use Conventional Commits with a ticket when available, for example `fix(EST-243): remove unused portal test imports`. An authorized PR must summarize the change, link the issue/story, list validation, include UI screenshots, and call out migrations, RLS, OpenAPI, environment changes, and limitations.

## Cursor Cloud specific instructions

For authorized setup or recovery in a disposable Cursor Cloud VM running its own local Supabase stack, read [the VM guide](docs/agent-cursor-cloud.md). Load it only for that environment. Never apply its local recovery procedures to hosted/shared Supabase; never grant to `anon`.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
