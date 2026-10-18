# Local native-stack tooling (18/10/2026)

Four frictions met during sub-lot 2.8, fixed in the local runners only. CI
workflows, `scripts/run-tester-army-ci.ts` phases/selection and
`scripts/tester-army/select-journeys.ts` are unchanged.

## Failure modes written before the change

| # | Behaviour | Failure to prevent | Proof |
| --- | --- | --- | --- |
| 1 | `npm run db:ci:local -- --files a.test.sql,b.test.sql` | a path outside `supabase/tests/database` (`../`, absolute, another folder, non-`.sql`) reaches `supabase test db`; a typo silently runs zero or every file; a duplicate counts twice; the pgTAP file count check still expects the whole suite; a filtered run is mistaken for a full proof; the RLS matrix is silently dropped | isolation: argument parser (exact refusals) and the phase list of a filtered run; real run below |
| 2 | Army Next build skips Vitest `*.test.ts(x)` | a red-first Vitest file importing a module that does not exist yet fails `next build` and therefore every TesterArmy run; `npm run typecheck`/`verify:pr` stop reporting that file | real: `build-local.mjs --execute` and `npm run typecheck` on a deliberately red file |
| 3 | SIGINT/SIGTERM destroys the stack | Node's default signal action kills the runner during a synchronous CLI call and the `finally` never runs: the native stack keeps running (5 h observed); a second cleanup runs after the handler; the slot or workdir survives; the process no longer dies by the signal | isolation: real child process killed by SIGTERM; `runLocalSupabaseCi` cleans once on a signal during the RLS phase |
| 5 | A local `npm run build` takes a place (coordinator ruling on Codex comment 8, 18/10/2026) | a local build starts while every place is taken; a build in CI (`CI=true`) or on Vercel (`VERCEL=1`) waits or fails because of the lock; a missing `ps`, an unwritable lock folder or an import failure fails a build; the build's own process is counted again next to its slot; its place outlives the build (normal end, failure, signal); `next-build.mjs --help` (Vitest guardrail) takes a place; the TesterArmy build (`build-local.mjs`, under its run's place) takes a second one | isolation: launcher outcome per environment, own process not counted; real: three places held, then `npm run build` refused; `CI=true` not concerned |
| 4 | A bounded number of native places per user, stacks and production builds | two runs racing past the count; a crashed run (SIGKILL, power loss) holding a slot forever; a released run still counted; a refusal without saying who holds the slots; a guarded run's own stack host counted twice; an unguarded or orphan stack, or a `node scripts/next-build.mjs` build, ignored | isolation: contention with live and dead PIDs, release, wait; real refusal below |

E2E cannot reproduce these: they concern the local runners themselves (argument
parsing, process signals, cross-process races), not a product journey.

## Behaviour

- `--files` accepts comma-separated names or `supabase/tests/database/<name>`
  paths of existing regular `.sql` files directly in that folder; anything else
  is refused before a stack starts. The default remains the whole folder. The
  behavioural RLS matrix still runs unless `--skip-rls` is also given. A
  filtered or `--skip-rls` run logs that it is partial: it is never the full
  `db:ci:local` proof.
- `.e2e/army/tsconfig.json` (written by `prepareArmyTypeScriptConfig`) excludes
  `src/**/*.test.ts(x)`. The root `tsconfig.json`, hence `npm run typecheck` and
  `verify:pr`, still checks them. A test file imported by application code would
  still be checked (TypeScript follows imports).
- `runLocalSupabaseCi`, `withOwnedNativeStack` (engine-v3 parity) and
  `upgrade-check.ts` register SIGINT/SIGTERM handlers for the life of the stack.
  A signal runs the same `stop` then `stack destroy --yes`, removes the workdir
  and releases the slot once; the `finally` path then does nothing. When no
  other handler is registered for that signal, the handler re-raises it, so the
  process still ends by that signal. When the caller has its own handler (the
  Army `dev`/`dev-loop` modes), the caller keeps control of the shutdown.
  A cleanup failure on that path is logged before the process ends. A signal
  while the isolated project is still being prepared (before any stack starts)
  may leave that temporary workdir behind. SIGKILL cannot be caught: the next run reclaims the slot, the stack must be
  found with `pgrep -u "$USER" -fl "[_]_supabase_stack_host__"`.
- The same three entry points reserve a slot in `~/.supabase/native-runs/`
  before preparing the project: one file `<pid>-<uuid>.json` per run, created
  exclusively, then the live files are counted. A file whose PID is no longer
  alive is stale and removed. Since each run creates its file before counting,
  of two racing runs the later counter sees both: never more than the limit
  are admitted (both may back off). Each run then records its isolated
  workdir in its file. Also counted, from this user's process listing: every
  Supabase stack host (`supabase __supabase_stack_host__`) whose
  `projectRoot` no live slot records (a crashed or unguarded run, a manual
  stack) and every production build started as `node scripts/next-build.mjs`
  (`npm run build`). The TesterArmy build goes through `build-local.mjs`, inside
  a run that already holds a place. The limit, its default and
  `NATIVE_STACK_MAX_RUNS` are defined only in
  [Capacité locale](tester-army-local-development.md#capacité-locale-et-redémarrages-wsl-18102026).
  Beyond it the run is refused
  with `NativeStackLimitError` naming each holder (run PID, entry point,
  folder, start; orphan stack workdir; build command);
  `NATIVE_STACK_WAIT_SECONDS=<n>` waits up to `n` seconds instead. Processes
  are counted best effort: only the guarded runs are race-free.
- A local production build (`scripts/next-build.mjs`, so `npm run build` and
  `check:release`) reserves a place too, with the same refusal and
  `NATIVE_STACK_WAIT_SECONDS`, and frees it when the build ends, including on
  a signal. Never in CI (`CI` set to anything but `false`/`0`) or on Vercel
  (`VERCEL` set), never for `--help`, and fail-open: if the guard cannot be
  loaded, the process listing or the lock folder is unavailable, the build
  warns and runs. Only a full house refuses it. The TesterArmy build goes
  through `build-local.mjs`, inside its run's place, and takes no second one. A reused PID
  keeps a stale slot until that process ends; delete the named file by hand if
  `ps -p <pid>` shows an unrelated process.

## Validation (macOS 27 arm64, Node 24.19.0, Supabase CLI 2.120.0, base `3af6804c`)

| Behaviour | Command | Expected / actual |
| --- | --- | --- |
| 1 refusals | `npm run db:ci:local -- --files ../migrations/x.sql` · `missing.test.sql` · `--bogus` | refused before any stack, exit 1 each |
| 1 filtered | `--files affaire-counters-regression.test.sql,supabase/tests/database/estimate-email-outbox.test.sql --skip-rls` | `Files=2, Tests=90`, PASS, RLS skipped, logged partial, exit 0 |
| 1 filtered + RLS | `--files=estimate-email-outbox.test.sql` | `Files=1, Tests=85`, RLS matrix passed, exit 0 |
| 2 control | `tsc -p .e2e/army/tsconfig.json` with a red `src/lib/red-first-probe.test.ts` | origin/main config: TS2307 on the probe; new config: 0 errors |
| 2 real | same probe, `npm run e2e:army:local -- --grep GATE0 --app-port 3121` | build steps `[0,0,0]`, probe among build inputs, 4/4 tests passed, exit 0; `npm run typecheck` still reports TS2307 on the probe |
| 3 real | `node --import tsx scripts/run-local-supabase-ci.ts`, then `kill -INT`/`-TERM <pid>` after `stack started` | exit 130 / 143, this run's stack host gone, workdir removed, slot freed |
| 3 control | same SIGINT on an origin/main worktree | exit 130, stack host and workdir left running (destroyed by hand) |
| 4 real (limit 4, first commit) | four live holders in `~/.supabase/native-runs`, then a fifth filtered run | `NativeStackLimitError` naming the four PIDs, exit 1; with `NATIVE_STACK_WAIT_SECONDS=60` and one holder ended after 4 s: admitted, exit 0; holders killed: stale files reclaimed by the next run |
| 4 real (default 3) | three dummy `node scripts/next-build.mjs` processes, then a filtered run | refused, `3 of 3 places`, the three builds named, exit 1 |
| 4 real (own host once) | guarded run A with its stack up, then run B with `NATIVE_STACK_MAX_RUNS=1` | B refused with `1 of 1 places`, naming A once as a run (its host not counted again); A passed, exit 0 |
| 5 real | three live holders, then `npm run build` | refused by the launcher before `next build`, `3 of 3 places`, holders named, exit 1 |
| 5 real (CI) | same three holders, `CI=true npm run build` | passed the lock and started `next build` (stopped by hand), no place taken |
| 5 real (release) | `node scripts/next-build.mjs --webpack`, places free, SIGINT once Next starts | one `production build (next-build.mjs)` slot during the build (stale files reclaimed), exit 130, no slot or `next build` left. Local builds print Node's one-line `MODULE_TYPELESS_PACKAGE_JSON` warning when loading the guard |
| 3 (Army dev) | isolation: caller-owned SIGINT during the database phases | the run stops before the next phase and destroys the stack; during the application phase the caller's graceful stop stays a success |
| isolation | `src/test/native-stack-guard.test.ts`, `src/test/local-supabase-ci.test.ts` | 8 racing processes never admit more than 4 (fails when the count check is removed); orphan host and build counted, own host not, shell lines naming the host string ignored; SIGTERM child cleans once and dies by SIGTERM (fails without the re-raise) |
| quality | `npm run verify:pr` | exit 0 |
