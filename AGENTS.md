# Repository Guidelines

## Operating Contract

Work only from the repository root and remain on the `main` branch. Do not create or switch branches unless the user explicitly changes this rule.

Before modifying files:

1. Read this file and the relevant local documentation.
2. Run `git status --short --branch`.
3. Inspect the relevant implementation, tests, configuration, and recent history.
4. Confirm whether the request is diagnostic-only or authorizes implementation.

The worktree may contain changes from other teams. Treat every pre-existing modification and untracked file as user-owned. Never delete, revert, overwrite, stage, or format unrelated work. In particular, do not include `design-qa.md` or `outputs/` unless explicitly requested.

Do not commit, push, create a PR, deploy, or apply remote database migrations without explicit user authorization. Never force-push.

Do not proactively suggest or offer Figma. Only discuss or use Figma when the user explicitly requests it; otherwise omit Figma from recommendations and follow-up questions.

## Sources of Truth

Use the current code, `package.json`, configuration files, migrations, and focused documentation as operational truth. The root `README.md` is incomplete for the current product and must not be used alone to infer architecture or setup.

- `src/app/`: Next.js 16 App Router pages, layouts, server actions, and `src/app/api/**` route handlers.
- `src/components/`: shared and feature UI.
- `src/hooks/`: reusable React hooks.
- `src/lib/`: domain logic, integrations, authorization, imports, estimates, and takeoff.
- `src/workers/`: background processing.
- `src/test/`: shared test setup and helpers.
- `e2e/`: Playwright coverage plus legacy PowerShell/agent-browser suites.
- `supabase/migrations/`: ordered database migrations and RLS changes.
- `supabase/functions/`: Supabase Edge Functions.
- `src/lib/openapi/`: OpenAPI source generation.
- `openapi.json`: generated, tracked OpenAPI artifact.
- `docs/`: product, implementation, performance, fixture, and security records.
- `maquette/`: design references.

For scan `91386191-6320-4d8c-83c2-a51fbfba12b1`, `docs/security-remediation-91386191.md` is the durable disposition ledger. Update it when dispositions change. Do not rewrite canonical `findings.json`, `coverage.json`, `scan-manifest.json`, or provisional scan reports, and never treat a provisional report as proof of current exploitability.

## Runtime and Installation

Use Node.js 24 LTS to match GitHub Actions and Vercel. The `.nvmrc` file pins the local major version.

- `npm ci`: reproducible installation from `package-lock.json`; preferred on a clean checkout.
- `npm install`: use when intentionally changing dependencies or refreshing the lockfile.
- `npm run dev`: start the default development server.
- `npm run dev:webpack`: start Next.js with Webpack when Turbopack-specific behavior must be isolated.
- `npm run start`: serve an existing production build.

Never print `.env.local` values or expose credentials. Required variables are documented in `.env.example`; E2E and RLS suites require additional credentials described in `e2e/README.md`.

## Build and OpenAPI

- `npm run validate-openapi`: verify that `openapi.json` matches the generated document.
- `npm run generate-openapi`: intentionally regenerate `openapi.json`.
- `npm run build`: validate OpenAPI, then build Next.js.
- `npm run typecheck`: run strict TypeScript checks without emitting application files.
- `npm run lint`: run repository-wide ESLint with zero warnings allowed.

When changing documented routes or schemas, update the OpenAPI generator, run `npm run generate-openapi`, inspect the generated diff, then run `npm run validate-openapi`.

A build can fail because required public Supabase variables are absent. Distinguish environment failures from code regressions and never invent or expose real secrets.

## Test Strategy

Vitest is split into `node` and `jsdom` projects. Component and hook tests use `jsdom`; other tests use `node`.

Start with the smallest relevant validation:

- `npm test -- path/to/file.test.ts`: focused Vitest file.
- `npm test -- --project=node path/to/file.test.ts`: focused server/domain test.
- `npm test -- --project=jsdom path/to/Component.test.tsx`: focused UI test.
- `npx eslint <touched-files>`: focused lint.
- `npm test`: full Vitest suite.
- `npm run e2e:pw:critical`: critical Playwright coverage for UI, routing, or authentication changes.
- `npm run e2e:pw:ux`: focused dashboard UX coverage.
- `npm run e2e:pw:takeoff-matrix`: focused takeoff matrix.
- `npm run e2e:rls`: RLS matrix; requires `RLS_E2E=1` and the documented credentials.

Legacy HEX suites are available through `npm run e2e:hex`, `e2e:hex:all`, and the feature-specific `e2e:hex:*` commands. They require a running application, `agent-browser`, and a PowerShell runtime (`pwsh` or `powershell`). Check those prerequisites before interpreting a runner failure as a product failure.

Validation order should normally be:

1. Focused regression tests and lint.
2. `npm run typecheck`.
3. Full `npm test` when the scope justifies it or before publication.
4. Relevant E2E suite for UI, routing, auth, workflow, or RLS changes.
5. `npm run build` for release-facing, routing, configuration, or OpenAPI changes.
6. `git diff --check`.

Some tests intentionally log fallback, portal, storage, or toast warnings. Use failed assertions and the exit code as the primary result, while still investigating unexpected logs.

If a global check fails in unrelated pre-existing files, do not absorb those files into the task. Report the global failure separately and provide the focused result for the requested perimeter.

## Domain and Security Invariants

- Preserve the canonical DPGF path: `dpgf_rows_raw` -> mappings -> `confirmUnifiedImportFlow`.
- PDF imports must feed that shared contract and must not fork or regress CSV/XLS/XLSX behavior.
- PDF regressions should cover both extraction and canonical import, preferably with realistic generated DPGF fixtures.
- Preserve provenance such as `sourceDocumentId` and `_timax_provenance`.
- Treat tenant membership, active-tenant checks, RLS, service-role clients, Storage paths, portal tokens, email side effects, and takeoff workers as high-risk boundaries.
- Never move service-role credentials into browser code or weaken authorization merely to make a test pass.
- CPU-bound PDF.js work running with `disableWorker: true` is not made preemptible by a timer or `Promise.race`; real closure requires a worker thread or terminable process.
- For local login failures, inspect the live surface first, verify Supabase health and direct authentication, then reload the page before changing code. A stale Next.js overlay is not current proof.

## Supabase Changes

Create a new timestamped migration for database changes. Do not silently rewrite migrations that may already have been applied.

Use this order:

1. Inspect the current schema, migration history, RLS, and affected server authorization.
2. Add focused structural or behavioral regression tests.
3. Validate the migration locally or in an isolated PostgreSQL/Supabase environment.
4. Run relevant application and RLS tests.
5. Document any validation limitation.
6. Apply to a shared or remote Supabase project only when explicitly authorized.

Do not assume a full `supabase db reset` works. Verify the CLI and baseline first; the legacy `001_add_job_title_to_profiles.sql` ordering has previously blocked a canonical reset. When full local execution is unavailable, a focused SQL regression or isolated fixture is acceptable evidence only if the limitation is stated clearly.

## Coding Conventions

Use TypeScript with strict types for exported APIs. Follow existing formatting: 2-space indentation, semicolons, and double quotes.

- Prefer the `@/` alias for imports from `src/`.
- Use PascalCase for React components.
- Use `useX` for hooks.
- Use lowercase route-segment folders.
- Colocate tests as `route.test.ts`, `module.test.ts`, or `Component.test.tsx`.
- Keep route handlers thin and move reusable domain or integration logic into `src/lib/`.
- Add focused regression coverage for bug fixes and security boundaries.
- Avoid unrelated refactors during scoped fixes.

## Publication

Remain on `main` and preserve concurrent work. Before an explicitly requested commit or push:

1. Re-run `git status --short`.
2. Review the complete scoped diff.
3. Stage only files owned by the task.
4. Run `git diff --cached --check`.
5. Confirm the required validations and their results.
6. Check alignment with `origin/main`; reconcile without force and without losing unrelated work.

Use Conventional Commits and include a ticket when available, for example `fix(EST-243): remove unused portal test imports`.

If a PR is explicitly requested, include a concise summary, linked issue or story, validation commands, screenshots for UI changes, and explicit notes for migrations, RLS, OpenAPI, environment, or known limitations.
