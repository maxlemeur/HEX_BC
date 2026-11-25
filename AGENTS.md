# MergeOne repository guidelines

Codex and Claude Code follow the owner's current request and the current product
contract. Use historical reports for context. This file governs delivery when a
skill describes a different workflow.

## Scope and autonomy

- Start with Git status and the affected implementation, tests and configuration.
  For an analysis request, deliver findings with the evidence and material
  uncertainty. For a change, identify the outcome the owner can verify, then
  carry the scoped change through verification, review where required, and merge.
  Ask when a decision is missing or the next action exceeds authorized scope.
- Match investigation to the failure. For a regression, identify the affected
  journey and reproduce the observable failure when practical. When several
  causes fit, use a check that distinguishes them. Handle routine lookups
  directly. Delegate when parts can progress independently or the diff needs
  the independent review below.
- Work on a branch from `origin/main`. Preserve unrelated WIP, untracked files
  and personal data. Stage only task files. Keep `.env`, `CLAUDE.local.md`,
  `settings.local.json`, `design-qa.md` and `outputs/` out of the index.
  The repository is public. Use fictional fixtures and keep secrets, private
  originals, customer documents and formative feedback out of commits, PRs and
  published evidence.

### Actions requiring the owner's go

The person who requested the work must explicitly authorize these actions.
Tool access alone grants no approval.

- Deploying, activating a feature in production or the shared database
  (including flags and activation rows), or merging a PR outside the request
  (including Dependabot and release PRs).
- Changing membership, tenant roles, repository or Supabase collaborators,
  keys, or a policy or grant that widens access to existing data.
- Deleting or overwriting shared data or storage, dropping a column or table,
  deleting a branch, worktree or file holding work outside `main`, or
  force-pushing outside the coordinated stack exception below. Cleanup of
  your own scratch files, temporary worktrees, owned stacks and merged branches
  is authorized after preserving unique work.

## Product and data contracts

- **Estimates and lifecycle.** Use integer cents and basis points with
  `src/lib/money.ts`. Read the [calculation rules](docs/metier/regles-de-calcul.md),
  [lifecycle](docs/metier/cycle-de-vie.md) and affected implementation. New
  versions use engine 3 unless tenant policy explicitly selects 2. Preserve
  historical engine pins, fresh snapshots and issued or sealed amounts. With v3
  data, any rollback must support v3 creation and snapshots.
- **Authorization.** Enforce tenant membership, active-tenant authorization
  and RLS at server boundaries, including routes behind redirects. Keep service
  credentials server-side. Check storage paths, portal tokens, email side
  effects and takeoff workers when the diff reaches them.
- **Imports.** Preserve `dpgf_rows_raw -> mappings -> confirmUnifiedImportFlow`,
  CSV/XLS/XLSX/PDF compatibility and provenance.
- **Implementation.** Keep domain logic in `src/lib/` and API routes in
  `src/app/api/` thin. Use strict TypeScript, two spaces, semicolons, double
  quotes, `@/` imports from `src/` and existing naming conventions. Update the
  OpenAPI source and generated artifact together when the contract changes.
- **Schema.** Ordered migrations are authoritative. Follow the
  [migration and types runbook](supabase/README.md#ajouter-une-migration-et-régénérer-les-types)
  for timestamps, manifest, Git guards and type generation. Restamp only
  unapplied migrations. Preserve compatibility with the deployed application
  by adding first and switching consumers in a later release. Regenerate with
  `npm run supabase:types`; put explicit refinements in `database.ts`.
- **Shared migrations.** Once a reviewed migration reaches `main`, apply it
  without requesting a separate migration approval. The [owner approval rules](#actions-requiring-the-owners-go)
  apply to the actions its SQL performs. Follow the [shared application runbook](supabase/README.md#appliquer-sur-une-base-partagée)
  and publish the receipt.

## Verification

Choose local checks from the diff. Documentation-only and small visual-only
changes each use just their row. For code, combine all applicable rows. GitHub's
required checks apply to every PR.

| Scope | Required local verification |
| --- | --- |
| Documentation only | Check content against the owning sources, verify links and run `git diff --check`. |
| Small visual-only change | For spacing, typography, color, wording or layout, inspect the affected screen in a real browser at the actual viewport sizes. Compare against the supplied visual reference when available. Run a scoped `git diff --check`. If the change renames, moves, hides or removes a control, label, role or test ID selected in `e2e/`, or changes logic, persistence, authorization, an API or the database, use the code rows. |
| Code iteration | Run `npm run verify:fast`. For repeated journey iterations use the [development loop](docs/testing/tester-army-local-development.md#boucle-ditération-réutilisable). Stop it before qualification. |
| Code or journey PR | Run `npm run e2e:army:reach` first (add `-- --base origin/<parent-branch>` for a stack layer). Run the commands it prints for the development phase and extended journeys. |
| Affected user journey | Run `npm run e2e:army:local -- --grep '<pattern>'` on stable final sources. Assert the affected business values, persistence, rights or downloads. Run deterministic journeys without a model. |
| SQL, RLS or migration | Run `npm run db:ci:local` on an owned stack and qualify affected journeys. The dedicated database check enforces statement ceilings omitted in parallel Army builds. |
| Performance | Measure real inputs and the largest supported volumes against the [SQL budgets](docs/testing/large-estimate-statement-budget.md) and [browser measurements](docs/testing/tester-army-performance.md). Fix over-budget writes. |
| Final code | Run `npm run verify:pr` once per push as the last local code check, including after review fixes or a merge of `main`. |
| Release preparation | Run `npm run check:release` locally with blank shared credentials. Before an authorized deployment, confirm the required shared migrations are applied. |

Prefer TesterArmy (`@e2e-dev/web`) wherever it covers the risk. For failures a
journey cannot expose reliably (SQL/RLS, parsers, races, recovery, calculations),
write the isolated regression test before the fix. Assert behavior and preserve
useful existing coverage. Broaden testing only for an actual failure or material
risk. Stop once the required checks pass on unchanged inputs.

Record the command, source/build and fixture identities, environment, expected
and actual results, and primary evidence paths. Setup failures, skips, development
loops and changing sources do not qualify a journey. Keep failures and skips
visible. A green PR check covers only the journeys in its
[selection summary](docs/testing/tester-army-ci.md#filtre-par-modèle-de-décision).

## Runtime and workspaces

- Use [the pinned Node version](.nvmrc) and [package scripts](package.json).
  Reuse conforming dependencies by copy-on-write where available. Run `npm ci`
  in the checkout root when no installation matching its lockfile is available.
- **Interactive browsing.** Run `npm run dev` or `npm run dev:chatgpt` as
  written with Turbopack. In a worktree, link the canonical checkout's ignored
  `.env.local` and use that server only for browsing and reads. Run seeds and
  ordinary writing campaigns on owned stacks.
- **Local qualification.** The [browser runner](e2e/README.md#démarrer-un-parcours-local)
  owns and destroys its ephemeral stack. Use matching dependencies, stable
  sources, no ambient env files and no inherited DB/Supabase credentials.
  Uncommitted changes can qualify. Use a detached verification worktree when
  credentials or concurrent work require isolation. Keep personal secrets in place.
- **Shared checks.** Shared Supabase serves production. Shared `execute_sql` is
  read-only unless the owner authorizes the specific statement. A shared check
  explicitly requested for this task uses only the existing designated account
  and tenant « ARMY TesterArmy QA ». Ask if authorized credentials are missing.
  Follow the [write acknowledgement](e2e/README.md#démarrer-un-parcours-local)
  and [retention rules](supabase/README.md#données-de-test). Journeys leave their
  affaires for scheduled retention.
- **Workspace ownership.** Keep persistent worktrees under
  `~/Projects/.workspaces/mergeone/`. Leave tool-created T3 Code and Claude Code
  worktrees in place. Keep evidence in `~/Projects/mergeone/outputs/` and link
  native media. Stop jobs you started. Before cleanup, check active use,
  preserve unique work and evidence, and write a compact recovery receipt.
  Remove temporary verification workspaces on success or failure.
- **Multi-session work.** Keep current status and dated owner decisions in
  `outputs/<task>/STATE.md` and append events to a separate log. Read
  `STATE.md` first when resuming.

## Review and delivery

1. **Decide whether independent review is required.** Use a read-only reviewer
   for changes to money, authorization, migrations, concurrency or public
   contracts, even within one module, and for implementation changes spanning
   modules. When none of these triggers applies, documentation-only, visual-only,
   test-only and single-module changes can proceed without independent review.
2. **Prepare one ready PR per standalone change.** Fetch and reconcile with
   `origin/main` before committing. Integrate it into a standalone branch only
   for a GitHub-reported conflict, a migration restamp or a landed change the
   branch needs. Stage scoped files, run `git diff --cached --check` and use an
   English Conventional Commit with the Linear ID when available. Push once per
   finished task or review round. Open the PR with the
   [template](.github/pull_request_template.md) so CI can run during review.
3. **Resolve the review.** Give the reviewer the stable diff, contract,
   consumers and actual checks. Allow one full reading and one recheck of
   fixes. Block for data loss or corruption, wider rights, a changed amount
   or failure of the requested outcome. Name a follow-up PR for other
   findings. After round two, the delivering agent records the decision and reason.
4. **Merge and verify delivery.** Enable `gh pr merge --auto --squash` once
   review clears, or immediately when independent review is optional. Protected
   `main` requires `quality-gate`, `army-critical`, `army-takeoff`,
   `army-calc-v3`, `smoke` and `rls-matrix`. Preserve all six. Confirm the
   merge and report the outcome, checks and any remaining limitations. A push
   does not deploy the application.

For a red check, diagnose the cause before retrying or changing timeouts.
For a local timeout attributed to load, verify the files pass alone and rerun
once after load drops. For CI, follow the [PR failure procedure](docs/testing/tester-army-ci.md#check-rouge-sur-une-pull-request)
for regressions, infrastructure failures and failures inherited from `main`.
Follow the [retry and quarantine rules](docs/testing/tester-army-ci.md#tentative-unique-et-quarantaine)
for intermittent journeys and `test.fail`. Fix any regression your merge causes
in the [post-merge campaigns](docs/testing/tester-army-ci.md#campagnes-de-main-après-un-push).

For security scans, update [dispositions](docs/security-remediation-91386191.md)
and preserve canonical evidence. Distinguish a provisional report from verified
impact. Discuss Figma only on request.

## Stacked pull requests

Give independent changes separate PRs to `main`. For a dependent series that
can be written and reviewed in parallel, follow the [stack procedure](docs/testing/tester-army-ci.md#pull-requests-empilées)
for creation, one coordinated publisher, review against each immediate base,
rechecks and auto-merge from the top. Resolve all review threads and require
all six checks on every layer. Only the extension's atomic, lease-checked push
on coordinated stack branches is authorized after reconciling collaborators'
work. Keep each migration and its SQL tests below their consumers in a separate
layer. Merge replacements of the same SQL function sequentially from `main`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
