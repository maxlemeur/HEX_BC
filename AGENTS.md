# Repository guidelines

Shared contract for Codex and Claude Code. The owner's current request and product
contract take precedence over historical reports and procedures.

## Scope and autonomy

- Start with Git status and affected code, tests and configuration. Read history,
  skills and installed API docs when relevant; reuse unchanged references.
- When a skill says to start a subagent, treat it as permission, not as an
  order: do lookups yourself, and delegate only independent parallel work and
  the review described below. Where a skill's delivery steps differ from this
  file, this file wins.
- `main` is protected: it only moves through a pull request whose required
  checks (`quality-gate`, `army-critical`, `army-takeoff`, `army-calc-v3`,
  `smoke`, `rls-matrix`) are green, and a direct push is refused. Work on a
  branch created from `origin/main`, from the canonical checkout or a cloud
  session alike. Use a detached verification worktree when credentials or
  concurrent work require isolation; an uncommitted task diff alone does not
  require one.
- Preserve unrelated changes, untracked files and personal data. Never stage
  `.env`, `CLAUDE.local.md`, `settings.local.json`, `design-qa.md` or `outputs/`.
- Complete requested changes through verification, review, commit, push, pull
  request and its automatic merge without repeated approval. Keep implementation
  focused. Analysis-only requests end with findings. Ask only for a missing
  decision or an action outside the authorized scope.
- Deployment, activation in production or the shared database (a flag, a row in
  an activation table), access changes and destructive actions require the
  explicit go of the owner, the person who gave the current request. So does
  merging a pull request you were not asked to deliver (someone else's,
  Dependabot, a release). Tool permissions alone do not provide it.
  - An access change is a change of tenant membership or roles, of repository
    or Supabase collaborators, or of keys, or a policy or grant that widens who
    reads or writes existing data.
  - A destructive action is deleting or overwriting data in the shared database
    or its storage, dropping a column or table, a force-push, or deleting a
    branch, worktree or file that holds work not on `main`.
  - Removing your own temporary worktrees, scratch files, owned local stacks
    and merged branches needs no go. Where a session refuses `rm`, use
    `git worktree remove` for a worktree and `git clean -f -- <path>` for a
    file in a checkout.
- Shared migrations carry a standing go (owner, 2026-11-22): once a migration is
  on `main` through a reviewed pull request, activates nothing, removes nothing
  (no deleted row, dropped column or table) and widens no access to existing
  data, apply it to the shared database without asking, by the
  [Supabase runbook](supabase/README.md), and publish its receipt. The policies
  and grants it sets on objects it creates are covered. If another agent
  applies it, quote this rule in its brief. Any other migration waits for an
  explicit go.

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
  compatibility and provenance. The repository is public: commits, pull request
  text and evidence are readable by anyone. Fixtures are fictional; secrets,
  private originals, customer documents and formative feedback must not be
  published.
- Use strict TypeScript, two spaces, semicolons, double quotes, `@/` imports from
  `src/` and existing naming conventions. Synchronize OpenAPI source and artifact
  when its contract changes.
- Ordered `supabase/migrations/` are schema truth; `supabase/schema.sql` is a pointer.
  Never rewrite applied migrations. For schema changes, follow the
  [Supabase runbook](supabase/README.md): timestamped migrations, manifest and Git
  guards, restamping only unapplied changes when needed. Write a migration the
  version in production keeps working on (add first, switch in a later release),
  so that it never waits for a deployment. Regenerate types with
  `npm run supabase:types`; `database.generated.ts` is generated and `database.ts`
  holds explicit refinements.

## Verification

- Small visual-only changes (spacing, typography, colors, wording and layout,
  including responsive adjustments) follow the "Small visual-only change" row
  below and nothing else. A change is not visual-only when it renames, moves,
  hides or removes a control, label, role or test id that a journey selects
  (search `e2e/` for it), or touches business logic, calculations, persistence,
  authorization, APIs or the database: the other rows then apply.
- Define the observable failure and affected journey before changing behavior;
  reproduce regressions first when practical. Prefer TesterArmy (`e2e`,
  `@e2e-dev/web`) as the sole test mechanism where it covers the risk. Deterministic
  journeys need no model; assert business values, persistence, rights and downloads.
- Use isolated tests only for real failures E2E cannot expose reliably (SQL/RLS,
  parsers, races, recovery, calculations). Identify relevant failure modes and
  write new isolated tests before the implementation change they cover.
  Avoid source-text tests and mocks that mirror implementation. Preserve useful
  existing coverage; do not remove it to get green.

| Scope | Required checks |
| --- | --- |
| Documentation only | Content consistency, links and `git diff --check`; no application suites. |
| Iteration on code | `npm run verify:fast`: incremental typecheck, cached lint and the Vitest files the diff reaches (seconds to about a minute). It does not replace the final check. |
| Repeated E2E iteration | Use `e2e:army:dev-loop` per the [local guide](docs/testing/tester-army-local-development.md#boucle-ditération-réutilisable). Stop it before final qualification; its results remain `qualification: false`. |
| Small visual-only change | Check the affected screen in a real browser (in-app browser or Playwright) at the affected viewport sizes, plus a scoped `git diff --check`. No `verify:pr`, E2E campaign, build, repository-wide lint or typecheck. |
| Affected user journey | `npm run e2e:army:local -- --grep '<pattern>'` on final, stable sources. |
| Pull request of code or journeys | `npm run e2e:army:reach` first: the checks of a pull request run the critical and takeoff journeys and the calc-v3 phases it reaches, but leave out the development phase and the extended journeys, which only run in the Full campaign after the merge. Run the commands it prints for those two; the takeoff journeys and calc-v3 phases it lists run in the pull request, unless the decision model leaves some out (its selection summary names them). |
| SQL/RLS/migration | `npm run db:ci:local` on an owned stack, plus affected journeys. Army's SQL/RLS checks do not replace it: parallel builds omit statement ceilings. |
| Final code | `npm run verify:pr` once per push, as the last check on the tree you push: after the independent review's fixes and any merge of `main` (about 3 minutes cold, 1.5 warm). Fix rounds before that use `verify:fast` and the targeted tests. Its checks run in parallel and all of them always run; a green check prints one line, a red one its whole output (`npm run check:quality -- --verbose` prints everything). |
| Performance | Follow [statement budgets](docs/testing/large-estimate-statement-budget.md) and [browser measurements](docs/testing/tester-army-performance.md) for real inputs and largest supported volumes; fix over-budget writes, never relax budgets. |
| Authorized release preparation | `npm run check:release`; a build is not deployment evidence. |

- Diagnose failures before rerunning affected checks; never mask them with retries
  or higher timeouts. A timeout the diagnosis ties to machine load (the failing
  files pass alone) is rerun once, when the load drops. CI retries a failed
  journey once, only to classify it: one that then passes is named
  « intermittent », its check stays red, and the label is not evidence that your
  change is innocent. `test.fail` is only a quarantine for a journey red on
  `main`: its reason cites an open ticket (`TI-681`, `#123`) and the campaign
  summary lists it
  ([rule](docs/testing/tester-army-ci.md#tentative-unique-et-quarantaine)).
  Broaden only for a failure or material risk. Once required checks pass, stop
  testing unchanged inputs; do not duplicate full CI suites.
- Never weaken, skip or remove the CI quality, smoke, critical, takeoff, SQL/RLS
  and calc-v3 checks to get green. Selection and schedules belong to workflows
  and the [CI guide](docs/testing/tester-army-ci.md). On a pull request a decision
  model leaves out critical and takeoff journeys it rates unaffected by the diff
  ([rule](docs/testing/tester-army-ci.md#filtre-par-modèle-de-décision)): a green
  check proves the journeys its selection summary lists, `main` runs them all, and
  the label `army-full` runs them all on the pull request.
- Record command, source/build and fixture identities, environment, expected/actual
  results and primary evidence paths. Preserve failures and skips; setup failure,
  skips or changing sources cannot qualify a journey. Never put secrets in evidence.

## Runtime and workspaces

- Use `.nvmrc` and [package.json](package.json) for runtime and commands. Reuse
  conforming dependencies. A new worktree whose `package-lock.json` is identical
  to the canonical checkout's clones that checkout's `node_modules` with the
  machine's copy-on-write tool when it has one, instead of installing a second
  copy. Run `npm ci`, inside the checkout root, when the lockfiles differ or
  there is nothing conforming to reuse. See the [test guide](e2e/README.md) for
  setup and suite contents.
- Start the local server someone browses with `npm run dev` or `npm run dev:chatgpt`
  as written, on Next's default compiler (Turbopack). `--webpack` belongs to the
  scripts that already pass it (builds, Army development): in `next dev` it took
  20 s instead of 7 s to compile the estimate editor and its API routes on a first
  visit, twice the memory, and seconds more for each file changed in the checkout.
- A worktree has no `.env.local` of its own, and without one the application
  reads no data. For the server someone browses, link the canonical checkout's
  file (`ln -s <canonical>/.env.local .env.local`) rather than starting on
  placeholder values; it stays ignored and is never staged. That file points at
  the shared Supabase: browse and read with it, and keep writing campaigns,
  migrations and seeds on owned stacks as below.
- Browser campaigns require no ambient `.env` files or inherited DB/Supabase
  credentials, matching dependencies and sources frozen during qualification;
  task changes may be uncommitted. Isolate when needed without moving personal
  secrets. The runner owns and destroys its ephemeral stack; never bypass guards
  or point it at shared credentials.
- The shared Supabase is also production's. Run writing campaigns on owned stacks.
  `execute_sql` on the shared project only reads, unless the owner's go names
  the statement to run. A shared check the owner asked for in the current
  request uses only the designated E2E account and tenant
  « ARMY TesterArmy QA »; never create another account/tenant. Use existing authorized
  credentials or ask the owner if missing. Before a shared run, read the
  [write acknowledgement](e2e/README.md#démarrer-un-parcours-local) and
  [retention/exemptions](supabase/README.md#données-de-test); journeys do not delete
  their affaires, but shared test drafts have scheduled retention.
- Keep persistent workspaces under `~/Projects/.workspaces/mergeone/`; a worktree
  T3 Code or Claude Code created stays where that tool put it. Reuse compatible
  caches and keep project artifacts in the canonical checkout's `outputs/`
  (`~/Projects/mergeone/outputs/`), from a worktree too, referencing native
  evidence without copying media. Before cleanup, check active use, preserve unique
  work/evidence and write a compact recovery receipt. Clean up temporary verification
  workspaces on success or failure.
- An orchestration that spans sessions keeps two files under `outputs/<task>/`:
  `STATE.md`, rewritten in place (merged, applied, running, waiting for the
  owner, and the owner's standing decisions with their date), and an append-only
  log. A new session reads `STATE.md` first.

## Review and delivery

- Use an independent read-only reviewer when the diff touches money,
  authorization, migrations, concurrency or a public contract, or spans modules.
  Documentation, visual-only, test-only and single-module fixes need none.
  Give it a stable diff, the contract, consumers and actual check results.
  Two rounds at most: one full reading, then one check of the fixes. A finding
  blocks when it loses or corrupts data, widens a right, changes an amount or
  stops the requested outcome from working; every other finding goes to a
  follow-up pull request named in the description. After the second round the
  agent delivering the task decides and records why.
- A change is complete when the requested outcome works, required checks pass,
  the scoped diff is reviewed and task-owned files are committed and pushed.
  Before committing, fetch and reconcile with `origin/main` without force or loss
  of work, stage only scoped files and run `git diff --cached --check`. Use
  Conventional Commits in English, with the Linear id when one exists (`TI-681`).
  Report any blocker instead of claiming completion.
- Deliver each finished task as one pull request: open it ready for review,
  never as a draft, with the template, so that its checks run during the
  independent review. Enable its automatic merge (`gh pr merge --auto --squash`)
  when that review says merge, or at once when the change needs none. It merges
  by itself once the required checks are green. Push once per finished task or
  review round, not per commit: a new push cancels the runs in progress and
  starts every check again.
- Split a task too large for one reading into pull requests that each merge on
  their own: the migration and its SQL tests first, then the code that uses it.
  Two open pull requests never replace the same SQL function: the second starts
  from `main` once the first is merged.
- Read the checks of your pull request and find the cause of a red one before
  reacting to it: a new push starts every check again, a rerun only the failed
  jobs. See the [guide](docs/testing/tester-army-ci.md#check-rouge-sur-une-pull-request).
  - Your change made it red: fix it before other work.
  - An infrastructure failure or a flaky journey (red without your diff, green
    on the same commit elsewhere): say so in the pull request with the evidence,
    then rerun the failed jobs only (`gh run rerun <run-id> --failed`), without
    a new commit.
  - The same journey is red on `main`: a rerun cannot pick up its fix, because
    it replays the merge commit computed when you pushed. Say so in the pull
    request with the evidence, wait for the fix to land on `main`, then merge
    `origin/main` once.
- Merge `origin/main` into the branch only for a conflict GitHub reports, a
  migration to restamp or code that landed on `main` and that the branch needs,
  such as the fix of a red it inherited. Never merge it as a reaction to a red
  you have not diagnosed, nor to bring the branch up to date: `main` does not
  require an up-to-date branch, and « Update branch » is that same merge. Do not
  stack pull requests.
- The merge is a push to `main`: unless it is documentation-only, it starts a full
  Critical run of about 15 minutes and queues the Full and calc-v3
  [campaigns of main](docs/testing/tester-army-ci.md#campagnes-de-main-après-un-push),
  one at a time. An open issue « CI rouge sur main » names their red journeys,
  and one your change caused is yours to fix.
- Pushes do not deploy: Vercel Git deployment is disabled in `vercel.json`.
  Before a separately authorized deployment, confirm required shared migrations
  are applied.
- For security-scan work, update [dispositions](docs/security-remediation-91386191.md),
  preserve canonical evidence and never treat provisional reports as current
  exploitability proof.
- Report outcomes, checks, limitations and blockers concisely. Discuss Figma only
  when requested; use visuals only when they clarify the subject.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
