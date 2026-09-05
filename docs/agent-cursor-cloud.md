# Disposable Cursor Cloud VM setup

Read this only for an authorized task in a disposable Cursor Cloud VM running its own local Supabase stack. These notes are not macOS setup instructions. The saved checkout normally uses hosted Supabase: verify the target before any stack or database operation without printing credentials. Never run local recovery commands against hosted/shared Supabase. Never grant to `anon`.

## Verify the environment first

- Use Node 24 from `.nvmrc`. A previously observed VM shim at `/exec-daemon/node` supplied Node 22 ahead of nvm; check `node -v` and `command -v node`. If applicable, source nvm and select 24 for this session. Do not assume a shell startup patch is present.
- Local Supabase needs Docker and the package-pinned Supabase CLI. Check availability before starting either. The VM previously required Docker 29 with `containerd-snapshotter=false` for its `fuse-overlayfs` driver; verify that this applies to the current VM before changing daemon configuration. Use the VM's supported Docker access setup; do not make the socket world-writable.
- Before startup, reset or privilege changes, identify the exact disposable stack, project and container, verify the loopback endpoint, and confirm no user data must be retained. Do not select the first matching container or infer isolation from a container name. Stop dependent mutations if the target is ambiguous.
- After those checks, `npx supabase start` starts the local stack and may apply migrations. Keep its credential output private. Never assume a reset succeeds; follow the baseline checks in [AGENTS.md](../AGENTS.md).

## App connection and smoke check

Use ignored `.env.local` for the verified loopback stack. The usual API URL is `http://127.0.0.1:54321`; confirm the actual port. Map the local anon and service-role keys to the variable names in [`.env.example`](../.env.example). Never paste keys into documentation, chat, logs or browser code. Do not replace an existing hosted configuration without authorization for local setup and a recoverable copy.

Check `supabase/config.toml` before relying on signup behavior. With local email confirmation disabled, signup can provision an isolated tenant and its admin membership. Use disposable test accounts only as part of authorized local QA; do not use shared or committed credentials.

`npm run dev` normally serves port 3000. `.next/dev/lock` prevents concurrent dev servers in one checkout. Check the actual URL and `GET /api/health`; `{"db":"up"}` indicates database reachability, not successful authorization or a complete workflow. Exercise the affected interface before claiming it works.

## Missing local grants

A previously observed fresh-stack failure returned Postgres `42501 permission denied` for dashboard reads while service-role writes succeeded. Migrations `20260811184019` and `20260811185118` restore service-role and selected authenticated privileges respectively; the latter's allowlist omits `affaire_briefs`, `supply_types`, `dpgf_imports` and `feature_flags`. Check subsequent migrations and current local grants before treating this as unresolved. Historical hosted behavior is not current proof.

For an authorized repair in this disposable VM only, inspect the exact failing relation, its RLS and server access contract. Restore only the necessary explicit privileges for `authenticated`; do not blanket-grant all public tables or sequences. Some relations are intentionally server-only. Never grant to `anon`: migration `20260811212848` deliberately revokes its tenant and membership privileges. Record temporary privilege changes and their validation. A durable fix requires a new migration and the normal review/regression process; never rewrite applied migrations or infer authorization to apply remotely.

For RLS regressions, use `npm run db:ci:local` as documented in [the E2E guide](../e2e/README.md). It provisions its own ephemeral loopback stack and disposable accounts; verify local prerequisites first. `e2e:rls` is internal to that runner and must not receive hosted credentials. Its two test cases exercise many boundaries but do not establish dashboard coverage or full schema reproducibility.
