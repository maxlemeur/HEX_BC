# Authentication boundary regressions

Source before the change: `00d3f62c5be78d7636686f5cda444584d6945857`.
This report records the initial local qualification. It makes no claim about
hosted credentials, migrations, account changes, email delivery or deployment.
Any subsequently authorized publication requires its own production evidence.

## Observable failures, defined before implementation

- A personal-tenant admin searches a name, email fragment or wildcard and obtains
  another tenant's names, email addresses, IDs or legacy roles.
- An exact-email lookup uses editable `profiles.work_email` as account identity,
  returns profile details, accepts a non-admin/suspended actor, or is callable
  directly by `anon`/`authenticated` with a forged actor ID.
- Adding an existing account mistakes RLS-hidden memberships for no memberships
  and attempts to replace its default organization.
- Login or renewal writes production session cookies without `Secure`; cookie
  chunk cleanup, redirect responses or downstream request cookies lose updates.
- Renewal loses the SDK's private/no-store headers, including on redirects or a
  route handler that declares a public cache policy.

## Coverage and proof boundaries

TesterArmy's existing local access journey file will cover a real UI login
(its existing setup), real Supabase renewal, exact-email member addition,
anonymous/non-admin refusal and two independent tenants. Critical values and
response shapes use exact assertions, without model calls or retries.

The Proxy isolation regression uses the installed SSR SDK with synthetic Auth
HTTP responses. It covers HTTPS cookie attributes and both redirect branches,
including rejected refresh and cookie clearing. Browser HTTP loopback
alone cannot prove HTTPS cookie serialization, and an expired/rejected token
cannot safely be scheduled by waiting for a production account to expire.
This is a specialist session-recovery boundary, not a mocked SDK forwarding test.

The first browser run with the corrected Auth code exposed a pre-existing
production-build defect on the Swagger asset used for renewal: webpack replaced
the import-meta-based `require.resolve` with a numeric module ID, causing HTTP
404. The positive HTTP 200 assertion was retained. Native Node path resolution
and explicit file-tracing inputs fix that delivery path; no assertion is weakened.

Native SQL/RLS qualification covers the service-only exact Auth-email lookup,
its fixed definer search path, actor authorization and the existing tenant policies. The lookup reads Auth's
email, never editable profile identity. Only ID and the already supplied email
are returned; partial search is intentionally retired.

The first candidate's native pgTAP run exposed that `service_role` has no SELECT
on `auth.users`. The corrected lookup uses a bounded SECURITY DEFINER function,
requires the actual `role` setting to be `service_role`, fixes `search_path`,
and retains the table-level refusal. It does not grant a general Auth directory.

## Qualified local result

The canonical run is
[`2026-10-20T00-51-55-227Z-critical`](/private/tmp/mergeone-auth-qualification/.e2e/army/ci/2026-10-20T00-51-55-227Z-critical/manifest.json):
`passed`, 63.265 s, Node 24.19.0, Next 16.4.0 production webpack build
`mB7aeYmhEnefODpE1vaz-`, e2e 0.21.2, web 0.15.2, Chromium desktop.
Source is `00d3f62c5be78d7636686f5cda444584d6945857` plus the local changes;
the recorded tracked diff hash is
`a126df3c2136b2269455c1b2dfb08cdd5d5abcff058a8c6f2717940a3f3719d3`.
All 16 affected runtime/test/migration inputs were compared byte for byte with
the working checkout. The unrelated pre-existing performance report was not
copied. Documentation reporting is completed after execution.

| Boundary | Executed result | Evidence |
| --- | --- | --- |
| UI password login | Existing setup passes against disposable real Supabase; production session cookies have Secure | [browser report](/private/tmp/mergeone-auth-qualification/.e2e/army/ci/2026-10-20T00-51-55-227Z-critical/critical/report.json) |
| Real renewal, AUTHSEC01 | Cookie scheduling is expired; real refresh succeeds, cookies regain a future expiry, stay Secure, asset is HTTP 200/no-store, user and tenant remain identical | Same browser report; business artifact `auth-session-renewal` |
| Directory and membership, AUTHSEC02 | Partial/wildcard searches empty; exact Auth email returns only ID/email; UI adds the account without switching its default tenant; anonymous 401 and viewer 403 | Same report; business artifact `auth-membership-isolation` |
| Cross-tenant business data, LEGACCESS01 | Second owner lists only its own estimates, receives 404 for the first owner's version, and cannot render its private line; first owner's data remain intact | Same report; business artifact `legacy-cross-tenant-list` |
| PostgreSQL | 29 pgTAP files, 2,061 assertions pass, including the new candidate privacy/ACL test; real authenticated RLS matrix also passes | [database log](/private/tmp/mergeone-auth-qualification/.e2e/army/ci/2026-10-20T00-51-55-227Z-critical/database.log) |
| Final quality | `npm run verify:pr` exits 0: 3,321 Node + 820 jsdom + 12 critical assertions pass; 3 pre-existing guarded assertions remain skipped in Vitest, not counted as passes | [quality log](/private/tmp/mergeone-auth-review.opYmyC/verify-pr-qualified.log) |

The browser selection executes four tests including setup, all pass with no
retry or model call. The wrapper privacy check passes, and a token-pattern scan
of the report finds no JWT or refresh-token value. SQL ran in newly created
native stacks, which the runner closed and destroyed before exiting.

Exact browser/SQL rerun, from the prepared clean copy without ambient `.env`:

```sh
cd /private/tmp/mergeone-auth-qualification
PATH=/Users/timax/.local/share/mise/installs/node/24.19.0/bin:$PATH npm run e2e:army:local -- --grep 'AUTHSEC0[12]|LEGACCESS01' --app-port 3123
```

The source checkout retains its existing private environment files. Quality is
run there with Node 24 using `npm run verify:pr`; the runner refuses to launch
Supabase from that checkout, so application qualification uses the clean copy.

## Red runs, corrections and review

- Baseline [Proxy regression report](/private/tmp/mergeone-auth-review.opYmyC/proxy-red.json): all five new cases fail on the absent cache/secure protections. The unchanged SDK is used with synthetic Auth HTTP responses.
- Baseline native/browser run `2026-10-20T00-42-50-605Z-critical`: login and LEGACCESS01 pass; both AUTHSEC regressions fail before implementation.
- Candidate `2026-10-20T00-45-29-196Z-critical`: new SQL test exposes missing direct Auth-table permission; fixed with the narrowly authorized definer lookup, preserving the table refusal.
- Candidate `2026-10-20T00-47-22-175Z-critical`: SQL/RLS, login, AUTHSEC02 and LEGACCESS01 pass; AUTHSEC01 reveals the pre-existing production asset 404.
- Candidate `2026-10-20T00-49-57-549Z-critical`: webpack also rejects a dynamic createRequire argument. Resolution was simplified to the two fixed npm asset paths with explicit tracing; assertions remain unchanged.
- Independent read-only review found no remaining actionable issue in the initial diff, the bounded definer correction, or the final fixed-path build correction. `git diff --check` passes.

The added migration's SHA-256 is
`94c051cd194651417287bc3053bede2fde4753a5ba758437bcc731aa02c3cc4a`.
At completion of this local qualification, it had run only on owned disposable
local databases. The normal separately authorized migration process must precede
deployment of this code. This qualification does not cover hosted Auth settings,
CDN behavior, a native/mobile interface or a deployed application. No commit,
push or deployment was part of the local qualification recorded here.

## Publication gate follow-up

The subsequently authorized commit `b6a5fad9` passed `check:release`, the hosted
Quality Gate and anonymous smoke. Its first full
[critical CI run](https://github.com/maxlemeur/HEX_BC/actions/runs/39351642109)
failed LEP01's ArrowDown assertion; shard 2 passed 74 of 75 selected cases.
The failure artifact is `12233946147`, SHA-256
`c967a3cade54ea25e843037794b3df7c7ae0f754a0e494bb31eca19a62ced0e3`.

LEP01 sent ArrowDown immediately after programmatic focus, without checking the
editor's committed roving focus. The follow-up adds one atomic precondition:
the starting quantity cell must hold native focus and `tabIndex === 0`.
It retains the single focus operation, single key press and existing navigation,
value, persistence, undo and redo assertions. Independent review supports this
test setup correction; the evidence does not establish a runtime focus defect.
The editor's application code is unchanged.

The focused follow-up
[`2026-10-20T01-21-41-283Z-critical`](/private/tmp/mergeone-auth-publication-ci-fix/.e2e/army/ci/2026-10-20T01-21-41-283Z-critical/manifest.json)
passes: setup login, AUTHSEC01, AUTHSEC02, LEGACCESS01 and LEP01, plus native
pgTAP and the authenticated RLS matrix. It uses source `b6a5fad9` plus only the
test readiness change, with no retries or model calls. Exact rerun from the clean
copy: `npm run e2e:army:local -- --grep 'LEP01|AUTHSEC0[12]|LEGACCESS01' --app-port 3124`
under Node 24.19.0. The first failed hosted result remains failed; publication
evidence is tracked separately under `.e2e/army/auth-publication-20261020/`.
