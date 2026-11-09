# Repository guidelines

Shared contract for Codex and Claude Code. The owner's current request and product
contract take precedence over historical reports and procedures.

## Scope and autonomy

- Start with Git status and affected code, tests and configuration. Read history,
  skills and installed API docs when relevant; reuse unchanged references.
- Work in the canonical checkout on `main`; create or switch branches only when
  asked. Use a detached verification worktree when credentials or concurrent work
  require isolation; an uncommitted task diff alone does not require one.
- Preserve unrelated changes, untracked files and personal data. Never stage
  `.env`, `CLAUDE.local.md`, `settings.local.json`, `design-qa.md` or `outputs/`.
- Complete requested changes through verification, review, commit and push without
  repeated approval. Keep implementation focused. Analysis-only requests end with
  findings. Ask only for a missing decision or an action outside the authorized scope.
  PRs, deployment, shared/remote migrations, access changes and destructive actions
  require explicit authorization. Tool permissions alone do not provide it.

## Product and data contracts

- HEX/MergeOne covers affaires, DPGF/plans/CCTP, import/takeoff, estimates,
  approval, PDF/sending, client portal and purchase orders. Domain logic lives in
  `src/lib/`, thin API routes in `src/app/api/`, journeys in `e2e/`.
- Money stays in integer cents and rates in basis points; reuse `src/lib/money.ts`.
  For calculation or lifecycle changes, read [calculation rules](docs/metier/regles-de-calcul.md),
  [lifecycle](docs/metier/cycle-de-vie.md) and the affected implementation.
  Preserve pinned engines, fresh snapshots and issued/sealed amounts. New versions
  use engine 3 unless tenant policy explicitly selects 2; historical versions keep
  their engine. Never roll an application with v3 data back below compatible
  creation/snapshot code.
- Preserve tenant membership, active-tenant authorization and RLS at server
  boundaries; redirects are not authorization. Service-role credentials never
  enter browser code. Storage paths, portal tokens, email side effects and takeoff
  workers are sensitive boundaries.
- Preserve `dpgf_rows_raw -> mappings -> confirmUnifiedImportFlow`, CSV/XLS/XLSX/PDF
  compatibility and provenance. Public fixtures are fictional; private originals
  and formative feedback must not be published.
- Use strict TypeScript, two spaces, semicolons, double quotes, `@/` imports from
  `src/` and existing naming conventions. Synchronize OpenAPI source and artifact
  when its contract changes.
- Ordered `supabase/migrations/` are schema truth; `supabase/schema.sql` is a pointer.
  Never rewrite applied migrations. For schema changes, follow the
  [Supabase runbook](supabase/README.md): timestamped migrations, manifest and Git
  guards, restamping only unapplied changes when needed. Regenerate types with
  `npm run supabase:types`; `database.generated.ts` is generated and `database.ts`
  holds explicit refinements.

## Verification

- Small visual-only changes (spacing, typography, colors, labels and layout,
  including responsive adjustments) require only a targeted check of the affected
  screen in the in-app browser at the relevant viewport sizes, plus a scoped
  `git diff --check`. Do not launch `verify:pr`, a full E2E campaign, a build,
  repository-wide lint or typecheck for these changes. This exception takes
  precedence over the general final-code and affected-journey rows below.
  If a change also affects business logic, calculations, persistence,
  authorization, APIs or the database, apply the checks for that behavior.
  Required CI protections remain enforced.
- Define the observable failure and affected journey before changing behavior;
  reproduce regressions first when practical. Prefer TesterArmy (`e2e`,
  `@e2e-dev/web`) as the sole test mechanism where it covers the risk. Deterministic
  journeys need no model; assert business values, persistence, rights and downloads.
- Use isolated tests only for real failures E2E cannot expose reliably (SQL/RLS,
  parsers, races, recovery, calculations). Identify relevant failure modes and
  write new isolated tests before implementation changes, never afterwards.
  Avoid source-text tests and mocks that mirror implementation. Preserve useful
  existing coverage; do not remove it to get green.

| Scope | Required checks |
| --- | --- |
| Documentation only | Content consistency, links and `git diff --check`; no application suites. |
| Repeated E2E iteration | Use `e2e:army:dev-loop` per the [local guide](docs/testing/tester-army-local-development.md#boucle-ditération-réutilisable). Stop it before final qualification; its results remain `qualification: false`. |
| Small visual-only change | Targeted in-app browser check at affected viewport sizes and scoped `git diff --check`; no global suites. |
| Affected user journey, beyond visual-only changes | `npm run e2e:army:local -- --grep '<pattern>'` on final, stable sources. |
| SQL/RLS/migration | `npm run db:ci:local` on an owned stack, plus affected journeys. Army's SQL/RLS checks do not replace it: parallel builds omit statement ceilings. |
| Final code, beyond visual-only changes | `npm run verify:pr` once; retain required CI protections. |
| Performance | Follow [statement budgets](docs/testing/large-estimate-statement-budget.md) and [browser measurements](docs/testing/tester-army-performance.md) for real inputs and largest supported volumes; fix over-budget writes, never relax budgets. |
| Authorized release preparation | `npm run check:release`; a build is not deployment evidence. |

- Diagnose failures before rerunning affected checks; never mask them with retries
  or higher timeouts. Broaden only for a failure or material risk. Once required
  checks pass, stop testing unchanged inputs; do not duplicate full CI suites.
- Keep CI quality, smoke, critical, takeoff, SQL/RLS and calc-v3 protections.
  Selection and schedules belong to workflows and the [CI guide](docs/testing/tester-army-ci.md).
- Record command, source/build and fixture identities, environment, expected/actual
  results and primary evidence paths. Preserve failures and skips; setup failure,
  skips or changing sources cannot qualify a journey. Never put secrets in evidence.

## Runtime and workspaces

- Use `.nvmrc` and [package.json](package.json) for runtime and commands. Reuse
  conforming dependencies; use `npm ci` when installation is needed, inside the
  checkout root. See the [test guide](e2e/README.md) for setup and suite contents.
- Browser campaigns require no ambient `.env` files or inherited DB/Supabase
  credentials, matching dependencies and sources frozen during qualification;
  task changes may be uncommitted. Isolate when needed without moving personal
  secrets. The runner owns and destroys its ephemeral stack; never bypass guards
  or point it at shared credentials.
- The shared Supabase is also production's. Run writing campaigns on owned stacks.
  An authorized shared check uses only the designated E2E account and tenant
  « ARMY TesterArmy QA »; never create another account/tenant. Use existing authorized
  credentials or ask the owner if missing. Before a shared run, read the
  [write acknowledgement](e2e/README.md#démarrer-un-parcours-local) and
  [retention/exemptions](supabase/README.md#données-de-test); journeys do not delete
  their affaires, but shared test drafts have scheduled retention.
- Keep persistent workspaces under `~/Projects/.workspaces/mergeone/`, reuse
  compatible caches and keep project artifacts in `outputs/`, referencing native
  evidence without copying media. Before cleanup, check active use, preserve unique
  work/evidence and write a compact recovery receipt. Clean up temporary verification
  workspaces on success or failure.

## Review and delivery

- Use an independent read-only reviewer for substantial changes, especially money,
  authorization, migrations, concurrency, public contracts or cross-module behavior.
  Give it a stable diff, the contract, consumers and actual check results.
- A change is complete when the requested outcome works, required checks pass,
  the scoped diff is reviewed and task-owned files are committed and pushed.
  Before committing, fetch and reconcile with `origin/main` without force or loss
  of work, stage only scoped files and run `git diff --cached --check`. Use
  Conventional Commits and push the finished review round, avoiding intermediate
  pushes that cancel CI. Report any blocker instead of claiming completion.
- Pushes do not deploy: Vercel Git deployment is disabled in `vercel.json`.
  Before a separately authorized deployment, confirm required shared migrations
  are applied. For security-scan work, update [dispositions](docs/security-remediation-91386191.md),
  preserve canonical evidence and never treat provisional reports as current
  exploitability proof. Load guides only for the environment involved.
- Report outcomes, checks, limitations and blockers concisely. Discuss Figma only
  when requested; use visuals only when they clarify the subject.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
