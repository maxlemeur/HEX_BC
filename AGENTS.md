# Repository Guidelines

## Core Rules

- When explaining something to the user, use the Visualize skill
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
- Discuss or use Figma only when the user explicitly requests it.

Use current code, `package.json`, configuration, migrations, and focused documentation as operational truth. The root `README.md` is incomplete and is not sufficient by itself.

## Architecture

- `src/app/`: Next.js 16 App Router pages, layouts, server actions, and `api/**` handlers.
- `src/components/`, `src/hooks/`: shared UI and reusable hooks.
- `src/lib/`, `src/workers/`, `src/test/`: domain/integration logic, background work, and shared test support.
- `e2e/`: Playwright plus legacy PowerShell/agent-browser coverage.
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
- E2E: `npm run e2e:pw:critical`, `npm run e2e:pw:ux`, `npm run e2e:pw:takeoff-matrix`, and `npm run e2e:rls` (`RLS_E2E=1` plus documented credentials).
- OpenAPI/build: `npm run generate-openapi`, `npm run validate-openapi`, `npm run build`.

Vitest uses `node` and `jsdom` projects. Legacy `e2e:hex`, `e2e:hex:all`, and feature-specific `e2e:hex:*` suites require a running app, `agent-browser`, and `pwsh` or `powershell`; verify prerequisites before blaming the product.

Validate in this order as scope requires: focused tests and lint; typecheck; full Vitest; relevant E2E for UI, routing, auth, workflows, or RLS; build for release, routing, configuration, or OpenAPI work; `git diff --check`. Test warnings about fallback, portal, storage, or toasts may be intentional; prioritize failed assertions and exit codes, while investigating unexpected logs. Report unrelated global failures separately.

When routes or schemas change, update the OpenAPI generator, regenerate `openapi.json`, inspect its diff, and validate it. Missing public Supabase variables can cause environment-only build failures; never invent or expose secrets. Never print `.env.local`; required variables are documented in `.env.example` and `e2e/README.md`.

## Domain and Security Invariants

- Preserve the DPGF path `dpgf_rows_raw` -> mappings -> `confirmUnifiedImportFlow`.
- PDF imports must use that shared contract without regressing CSV/XLS/XLSX. Cover extraction and canonical import with realistic generated DPGF fixtures where practical, and preserve `sourceDocumentId` and `_timax_provenance`.
- Treat tenant membership, active-tenant checks, RLS, service-role clients, Storage paths, portal tokens, email side effects, and takeoff workers as high-risk boundaries.
- Never move service-role credentials into browser code or weaken authorization to pass a test.
- With PDF.js `disableWorker: true`, timers and `Promise.race` do not preempt CPU work; real cancellation requires a worker thread or terminable process.
- For local login failures, inspect the live UI, Supabase health, and direct authentication, then reload before changing code; a stale Next.js overlay is not current evidence.

## Supabase Changes

Create a new timestamped migration; never rewrite a migration that may have run. Inspect schema, migration history, RLS, and server authorization first; add focused regressions; validate locally or in isolated PostgreSQL/Supabase; run relevant app and RLS tests; document limitations. Apply to shared or remote Supabase only when explicitly authorized. `supabase/schema.sql` is a non-executable comment pointer, not a dump; schema truth is `supabase/migrations/`. Do not publish a migration count or latest filename as a frozen contract.

Do not assume `supabase db reset` works: verify the CLI and baseline because legacy `001_add_job_title_to_profiles.sql` ordering has blocked canonical resets. If full local execution is unavailable, focused SQL regression or an isolated fixture is acceptable only with the limitation stated.

## Code and Publication

Use strict TypeScript for exported APIs, 2-space indentation, semicolons, double quotes, and `@/` imports from `src/`. Use PascalCase components, `useX` hooks, lowercase route segments, and colocated `route.test.ts`, `module.test.ts`, or `Component.test.tsx` files. Keep route handlers thin; put reusable domain/integration logic in `src/lib/`. Add focused regression coverage for bugs and security boundaries.

For an explicitly authorized commit or push: re-run status, review the full scoped diff, stage only task-owned files, run `git diff --cached --check`, confirm validation, and reconcile with `origin/main` without force or loss of concurrent work. Use Conventional Commits with a ticket when available, for example `fix(EST-243): remove unused portal test imports`. An authorized PR must summarize the change, link the issue/story, list validation, include UI screenshots, and call out migrations, RLS, OpenAPI, environment changes, and limitations.

## Cursor Cloud specific instructions

Durable, non-obvious notes for running this app in a Cursor Cloud VM. Standard commands live in `package.json`, `README.md`, and the sections above — reference those, this only captures gotchas.

- **Node 24 vs the daemon node shim.** The base image injects a Node 22 shim at `/exec-daemon/node` that shadows nvm on `PATH`. Node 24 (per `.nvmrc`, required by `engines`) is installed via nvm and made to win through a `~/.bashrc` block that prepends `nvm which 24`. New shells get Node 24 automatically; if `node -v` ever shows v22, run `. "$HOME/.nvm/nvm.sh" && nvm use 24` (or re-`source ~/.bashrc`). The startup update script also refreshes this.
- **The app needs a Supabase backend; local dev uses the Supabase CLI stack, which needs Docker.** Neither Docker nor Supabase is started by the update script — start them per session:
  - Docker daemon: `sudo dockerd >/tmp/dockerd.log 2>&1 &` then `sudo chmod 666 /var/run/docker.sock`. Docker 29 must keep `containerd-snapshotter=false` so the `fuse-overlayfs` storage driver (set in `/etc/docker/daemon.json`) works.
  - Supabase: `npx supabase start` (pinned CLI `2.109.1`; applies all migrations on first boot). It prints the API URL and keys.
- **`.env.local` (gitignored) wires the app to the local stack.** Minimum working set: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, plus the `ANON_KEY` and `SERVICE_ROLE_KEY` from `supabase start`/`supabase status`. See `.env.example` for the rest (all optional for basic dev).
- **CRITICAL: grant table privileges after `supabase start` / `supabase db reset`.** The local stack does not auto-expose new tables (`config.toml` leaves `auto_expose_new_tables` unset), but migrations only grant a subset of tables explicitly and rely on legacy auto-expose for the rest. Without the grants below, authenticated reads on tables like `affaire_briefs`, `feature_flags`, `supply_types`, `dpgf_imports` fail with Postgres `42501 permission denied`, so the dashboard and every list render "Impossible de charger" / "Accès refusé" while writes still succeed. RLS is still the row-level boundary, so replicating legacy auto-expose is safe:
  ```bash
  CID=$(docker ps --format '{{.Names}}' | grep -i supabase_db | head -1)
  docker exec -e PGPASSWORD=postgres "$CID" psql -U postgres -d postgres \
    -c "grant usage on schema public to anon, authenticated;" \
    -c "grant select, insert, update, delete on all tables in schema public to anon, authenticated;" \
    -c "grant usage, select on all sequences in schema public to anon, authenticated;" \
    -c "grant execute on all functions in schema public to anon, authenticated;"
  ```
- **No test users are committed.** Email confirmation is disabled locally (`config.toml` `enable_confirmations = false`), so a fresh signup at `/signup` returns a session immediately, and the `handle_new_user` trigger provisions a profile + a fresh isolated tenant + an `admin` membership. A brand-new signup is therefore a fully working admin of its own empty tenant — the simplest way to exercise the app end to end (e.g. create an Affaire at `/dashboard/affaires/new`).
- **Dev server:** `npm run dev` (Turbopack) on port 3000; `.next/dev/lock` prevents two dev servers in the same folder. `GET /api/health` returns `{"db":"up"}` once Supabase is reachable.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
