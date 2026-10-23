# Repository guidelines

Shared working contract for Codex and Claude Code. The owner's current request
and the current product contract take precedence over historical reports and
procedures. Prefer useful outcomes and proportionate verification to rigid scripts.

## Work and delivery

- Start with Git status, relevant code, tests, configuration and recent history.
  Use the canonical checkout on `main`; create or switch branches only when asked.
  A temporary detached verification worktree is fine when isolation is necessary.
- Preserve unrelated changes, untracked files and personal data. Never stage
  `.env`, `CLAUDE.local.md`, `settings.local.json`, `design-qa.md` or `outputs/`.
- Complete authorized changes, tests, review, commit and push without asking again.
  Ask only for a concrete missing decision or an action outside the authorized scope.
  PRs, deployment, shared/remote migrations, access changes and destructive actions
  require explicit authorization. Tool permissions alone do not provide it.
- Before delivery, review the scoped diff, stage only task-owned files, run
  `git diff --cached --check`, fetch and reconcile with `origin/main` without
  force or loss of work. Use Conventional Commits. Push a finished review round;
  avoid cancelling running CI with intermediate pushes.
- Keep implementation simple and focused. Use relevant skills and current installed
  API docs. An independent read-only reviewer should inspect substantial changes
  on a stable diff; give it the contract, consumers and actual test evidence.
- Explain outcomes, evidence, limitations and blockers concisely. Discuss Figma
  only when explicitly requested. Use visuals only when they clarify the subject.

## Verification

- Define the observable failure and affected journey before changing behavior.
  Reproduce a regression first when practical. TesterArmy (`e2e`, `@e2e-dev/web`)
  is the primary browser runner; deterministic journeys need no model.
- Assert real business values, persistence, authorization and downloaded files.
  Keep justified SQL/RLS, parser, race, recovery and calculation checks where a
  browser cannot expose the failure reliably. Avoid tests of source text or mocks
  that merely mirror the implementation. Do not remove useful coverage to get green.
- Run affected journeys locally with `npm run e2e:army:local -- --grep '<pattern>'`.
  Use `npm run db:ci:local` for SQL changes and `npm run verify:pr` once on the
  final code. Do not duplicate unchanged checks or the full suites CI already runs.
  A failure requires diagnosis before another run; never hide it with retries or
  higher timeouts. Documentation-only changes need consistency and diff checks.
- Keep the existing CI quality, smoke, critical, takeoff, SQL/RLS and calc-v3
  protections. Their impact selection and schedules live in the workflows and
  [CI guide](docs/testing/tester-army-ci.md), not in a frozen list here.
- Record command, source/build identity, environment, fixture identity, expected
  and actual result, and primary evidence paths. Preserve failed/skipped cases;
  neither a setup failure nor a skipped test is a pass. Sources stay fixed during
  qualification. Never include credentials or session tokens in evidence.
- For performance, use the real repository input and largest supported volume.
  Measure comparable statements on the same available native host (macOS or Linux),
  median of seven runs, with raw samples and host load. WSL is an option, not a
  prerequisite. Keep SQL timings separate from HTTP/UI timings and CI/production.
  Local budgets: bulk import/creation/settings 1,000 ms at 2,031 items; interactive
  operations 400 ms; v3 copy up to 1,000 operations 875 ms. Its CI/production target
  is 3,500 ms, which a local median alone cannot prove. Fix an over-budget write
  instead of changing the budget. See [statement budgets](docs/testing/large-estimate-statement-budget.md).

## Runtime and workspaces

- Use the Node version in `.nvmrc`, `npm ci` for installation and `package.json`
  for current commands. `verify:pr` includes audits, architecture, OpenAPI,
  typecheck, lint and retained tests. `check:release` adds production-build checks
  when preparing publication; a successful build is not deployment evidence.
- The native Supabase runner owns and destroys an ephemeral local stack; do not
  point it at shared credentials or bypass its guards. For browser campaigns use
  a clean checkout without ambient `.env` files and dependencies inside its root.
- Keep persistent task workspaces under `~/Projects/.workspaces/mergeone/`, reuse
  compatible package caches and keep canonical artifacts under `outputs/`.
  Reference native run artifacts rather than duplicating media. Before retiring
  a workspace, check active use, preserve unique work/evidence and write a compact
  recovery receipt. Clean up temporary verification workspaces on success or failure.

## Product and data contracts

- HEX/MergeOne is a multi-tenant estimating product: affaire, DPGF/plans/CCTP,
  import/takeoff, estimate, approval, PDF/sending, client portal and purchase orders.
  Domain logic belongs in `src/lib/`, thin routes in `src/app/api/`, journeys in
  `e2e/`, database history in `supabase/migrations/`.
- Money stays in integer cents and rates in basis points. Reuse `src/lib/money.ts`.
  Before changing calculations or lifecycle, read `docs/metier/regles-de-calcul.md`,
  `docs/metier/cycle-de-vie.md` and the current implementation. Preserve the engine
  pinned on each version, fresh snapshots and issued/sealed amounts. New versions
  use engine 3 unless the tenant explicitly has policy 2; historical versions
  retain their engine. Never roll an application with v3 data back below its
  compatible creation/snapshot code.
- Keep tenant membership, active-tenant authorization and RLS at the existing
  server boundaries. A redirect is not authorization. Service-role credentials
  never enter browser code. Treat Storage paths, portal tokens, email side effects
  and takeoff workers as sensitive boundaries.
- Preserve `dpgf_rows_raw -> mappings -> confirmUnifiedImportFlow`, including
  CSV/XLS/XLSX/PDF compatibility and provenance. Public fixtures are fictional;
  private originals and formative feedback must not be published.
- Use strict TypeScript, two spaces, semicolons, double quotes and `@/` imports
  from `src/`. Follow the existing component, hook and route naming conventions.
  Keep OpenAPI source and artifact synchronized when its contract changes.

## Database and publication

- Schema truth is the ordered migrations; `supabase/schema.sql` is only a pointer.
  Never rewrite an applied migration. Add and validate a new timestamped migration
  when needed; use the manifest and Git guards, and restamp only unapplied changes
  when required by current `main`. See [Supabase runbook](supabase/README.md).
- Validate database changes on an owned local stack with relevant SQL/RLS and
  app journeys. Regenerate types with `npm run supabase:types` after schema changes;
  `database.generated.ts` is generated, `database.ts` holds explicit refinements.
- Remote migration and deployment are separate authorized actions. Vercel Git
  deployment is disabled in `vercel.json`; a push does not deploy. Before an
  authorized deployment, confirm its required shared migrations have been applied.
- For the security scan, update dispositions in `docs/security-remediation-91386191.md`;
  preserve canonical scan evidence and never treat a provisional report as current
  exploitability proof. Load environment-specific guides only in that environment.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
