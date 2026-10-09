# Affaire loading optimization

## Observable failures defined before implementation

| Failure | Executed E2E oracle |
| --- | --- |
| Serial server reads delay the useful fiche | Five real list-card clicks to the same owned ARMY affaire, browser click-to-heading and request timings, baseline and optimized isolated production builds |
| Shared authentication escapes its request and exposes another session | A fresh anonymous browser after authenticated rendering receives API 401 and the dashboard redirects to login |
| Tenant, active-membership or owner checks are weakened | Retained strict-boundary regressions; authenticated owned-fixture reads and anonymous denial; no permission/schema changes |
| Parallel work drops sections or changes business values | Financial summary and Versions section visible; exact draft/title/item/totals API snapshot before and after visits |
| Caching persists outdated data between requests | Request lifetime checked against React's installed server-cache semantics and code review; five transitions and reload check the same fixture values, without proving a concurrent-mutation freshness scenario |
| An unexpected approval projection writes existing business data | Only a newly created ARMY draft from this lot is visited. Fixture identity is retained and reused; existing affaire details are excluded |

Use `npm run e2e:army:performance:affaire` against the isolated production build. The first execution creates one new ARMY draft and two priced lines through the authenticated application API. Its ignored fixture receipt is retained in `.e2e/army/performance/fixtures/affaire.json`; later comparisons reuse only that same receipt after host and ownership-name checks. Ordinary UI login, exact Supabase host allowlisting, disabled authenticated traces and no emails/status acceptance/remote migration remain required. Reading this owned fiche may update its approval projection and audit events; unchanged financial data is distinct from full database immutability. No cleanup removes the fixture.

Baseline and after artifacts record the build, revision, local inputs, account scope, fixture identity, five click samples, correctness checks and result hashes. First measured navigation and repeated samples are separate; the server/backend cold state is not controlled. Heading timing includes two animation frames; browser first-byte timing is not full server processing time. Native CPU/network and short local samples do not establish field percentiles.

Implementation scope: request-scoped React memoization for repeated user/membership/context and intake/project reads; parallel profile/membership reads and independent cockpit preferences. Preserve authenticated network validation, active-tenant/role/owner filters, request error contracts, approval behavior and pending-edit persistence. No new isolated test is planned: the concrete request-isolation gap is exercised by the fresh anonymous browser, and retained specialist authorization tests remain in place.

The second optimization starts read-only register/direction/finish-line reads as soon as the authorized current-version lookup completes, in parallel with summary/readiness/timeline/margin work. Both branches share the same request-scoped current-version query to avoid choosing different versions during a concurrent creation. Approval projection and journal reads keep their dependency on the successful initial load; the optimization does not start approval writes on a failed initial load. The fiche must still show the retained version's financial values and edit link after navigation and reload; optional read failures keep their existing settled-result fallbacks.

## Verified local result: 2026-10-09

The earlier Next.js upgrade and performance tooling were committed and pushed as `d9b442715cae59cd225ffdc12f62f938669d0b31`. These subsequent server-loading optimizations were validated locally on `main` before publication. The baseline application has no loading changes from this lot; the final candidate includes both request memoization and overlapping independent reads.

All comparisons used the same retained new ARMY draft, dedicated account, desktop browser and native CPU/network on an isolated webpack production server. Each row contains all five actual click-to-heading samples in their original order. First measured visits do not guarantee a cold server or backend.

| Candidate | Five click-to-heading samples (ms, rounded) | Median of all five (ms) | Median of the four repetitions (ms) |
| --- | --- | --- | --- |
| Baseline | 1183, 1030, 1612, 945, 813 | 1030.0 | 987.3 |
| Memoization and early preferences only | 1832, 929, 812, 844, 898 | 897.7 | 871.0 |
| Final overlapping reads, verified replay | 1139, 712, 746, 681, 629 | 712.1 | 696.7 |

The final five-sample median is 30.9% lower than the baseline; the repeated-visit median is 29.4% lower. The first measured visit changed only from 1182.5 to 1138.8 ms. The intermediate first visit was slower. Small local samples and the uncontrolled remote backend do not establish a field percentile or a guaranteed gain for every navigation. No claim is made that development compilation became faster.

Each of the three comparison rows passed 3/3 selected results: UI authentication, the owned affaire journey and fresh-context anonymous denial. Eight unrelated results were excluded in each invocation. The draft stayed at 5000 HT, 1000 tax and 6000 TTC cents with the same item values, status and title after five visits and reload. The final journey also verifies the financial edit link references the same current version. Approval projection/audit updates on this owned fixture remain permitted; these checks do not prove database immutability, cross-tenant access or concurrent-version behavior.

Final candidate build: `ZkArzb6nfFIQW2PV7z6BB`. Its build identity and the recorded source inputs remained unchanged during every final performance run. Additional validation on that candidate:

- General page/interaction suite: 14/14 selected results passed on desktop and a mobile-sized viewport; eight unrelated results excluded. Its 30 visits recorded zero total blocking duration, frame p95 and maximum <=16.8 ms, and maximum CLS 0.039. This is browser evidence at native speed, not physical-phone or field qualification.
- Global client navigation: 2/2 selected results passed (UI login and eight transitions); nine unrelated results excluded. Headings appeared in 81–663 ms. Different routes and backend variability prevent treating this as an equivalent before/after gain.
- Anonymous access-boundary case: 1/1 selected result passed, asserting seven exact HTTP 401 responses for estimate/import/takeoff reads and creates; eight unrelated results excluded. It does not observe database row counts or run the complete critical/RLS campaign.
- Retained authorization, affaire and intake regressions: 61/61 passed. Touched-file lint and typecheck passed. The isolated production build passed OpenAPI validation and all five existing bundle budgets; product gzip remains 225469 bytes.

Repeatable archives (manifest, report, sanitized owned log and raw metrics/business evidence):

- Baseline, build `98rhaNoRcrz-Z0Cl22Cka`: `.e2e/army/performance/runs/2026-10-09T20-05-04-133Z/`.
- Memoization-only candidate, build `sHRb6-WWKpB4WIXcpKcio`: `.e2e/army/performance/runs/2026-10-09T20-08-32-431Z/`.
- Final affaire replay: `.e2e/army/performance/runs/2026-10-09T20-48-33-347Z/`.
- Final general pages: `.e2e/army/performance/runs/2026-10-09T20-49-04-177Z/`.
- Final global navigation: `.e2e/army/performance/runs/2026-10-09T20-50-10-904Z/`.
- Final anonymous API boundaries: `.e2e/army/critical/runs/2026-10-09T20-50-22-885Z/`.
- Independent hash/JSON verification, raw samples and comparison: `.e2e/army/affaire-loading-comparison.json`; retained candidate patch and untracked input copies under `.e2e/army/affaire-loading-candidate/`.

The earlier final-build attempt at `2026-10-09T20-15-21-887Z` reported three passes, but its anonymous-isolation JSON became unreadable and no longer matched its recorded hash. It is preserved and excluded from complete validation; the following general-page invocation was interrupted without a final manifest. The final replay above replaces that missing proof. Initial fixture-preparation failures are also retained as failures, not passes. No canonical run report or manifest was rewritten.
