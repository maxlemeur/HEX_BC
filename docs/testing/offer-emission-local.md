# Dedicated local offer emission profile — prepared, no app execution

This profile is separate from existing critical/coverage recipes. Only its new files may admit an offer send, and only to the explicit loopback collector. No DB, build, app, UI, migration or Army execution was performed while preparing it. No product assertion or readiness is established by this preparation.

## Refusal cases defined before the new guard and fixtures

| Failure | Required refusal/oracle |
| --- | --- |
| Hosted/backend/provider URL or ambiguous origin | Configuration and server preload require three exact HTTP loopback origins with explicit ports; credential/query/hash/path aliases are refused. SDK fallback to api.resend.com is refused before network. |
| Unsafe transport env | Collector origin equals RESEND_BASE_URL; API key equals the invalid local sentinel; EMAIL_FROM uses .invalid; directory/pointer stay in owned ignored archive. Missing/mismatched values fail setup, never product RED. |
| Old account/browser fixture sends an email | Auth setup installs offer browser restriction without ownership: reads/password login only. Existing critical browser guard remains unchanged. |
| Foreign estimate or real recipient send | /send requires POST, version ID in this attempt's shared ownedEstimates array, validated collector mode and to/cc .invalid; all other attempts abort. |
| Hidden approval/reconciliation path | approve, reject, reconcile, email-dispatch, portal-token, invitation and status accepted/rejected writes abort. Only own status draft/sent PATCH can pass. |
| Arbitrary native REST/account/catalogue mutation | Browser allows native password token/logout (including their exact CORS OPTIONS), user read plus delivery_sites read only; other native browser writes abort. The owned estimate's exact DELETE lock release is allowed when leaving its editor; general DELETE is refused. Server still uses the application's real authorization/RLS without mocks. |
| Credential/portal leak | Login uses SDK credential Secret; portalUrl/portalToken use lazy SDK generic-secret providers from a private pointer. Evidence recursion drops headers, cookies, passwords, body HTML/text and secret fields, redacts URL/capability/JWT strings. Traces/cache/video stay off. Guard logs contain origin role/route class, no query/path/body/headers/capability. |
| Implicit ownership from seeded ID | Ownership arises from successful creation helper writing the same army array; a name prefix alone never admits /send. No seeded sent/token/approval or service-role API test call is introduced. |
| Preload/browser guard bypass | Existing initial guard tests qualify collector-only interception. The new three-origin module qualification is recorded below; every future app invocation requires a fresh gate before UI. Browser mutation enforcement remains unexecuted here. Browser route coverage is HTTP only; OS firewall, subprocess/native-addon bypass and browser WebSocket egress are not qualified. |
| Missing collector/probe/app/PDF setup | Missing proof; no product PASS/RED. Collector health must be ready before fixture. The actual outbox Buffer call remains incompatible with the strict base64 packet contract until the separately authorized product correction. |

## Inputs and interfaces

All origins are explicit: E2E_OFFER_APP_ORIGIN (localhost for webpack hydration), E2E_OFFER_BACKEND_ORIGIN (native only; equal NEXT_PUBLIC_SUPABASE_URL), E2E_OFFER_COLLECTOR_ORIGIN (127.0.0.1 only; equal RESEND_BASE_URL). E2E_ARMY_BASE_URL must equal the app origin. E2E_OFFER_RUN_DIRECTORY is an explicit new .e2e/army/offer/runs/<stamp-uuid> campaign; SDK output is its sdk/ directory, logs are public/app.log and public/server-network.jsonl. E2E_OFFER_COLLECTOR_DIRECTORY is exactly campaign/collector, containing receipts/<sha-key>/private/payload.json; the launcher creates its parent before startCollector. E2E_OFFER_SECRET_POINTER is exactly campaign/private/portal-pointer.json with {portalUrl,portalToken}; root writes it before authorized SDK secret fills. Its URL must have app origin. A /portal/ path requires its exact real UUID token; a historical dashboard CTA instead requires the exact ARMY-unused-capability-placeholder. Never use its version UUID as a capability secret.

Use E2E_LOGIN_EMAIL/E2E_LOGIN_PASSWORD for the existing dedicated ARMY native account. A local app service key may be passed to the owned child server as needed by existing outbox code; the test harness never reads, logs or uses it for direct DB/RPC calls. All secrets stay in process/private files. No .env file is printed or modified. Config rejects provider secret override environment variables for portalUrl/portalToken so a lazy private pointer cannot silently become an untracked static secret.

`offerTest` exposes `{army: ArmyState}`. `recordOfferEvidence(army,label,data)` writes redacted JSON under the dedicated offer output. `restrictOfferBrowser(browser,app,army?)` shares the mutable ownership array and refuses write routes when army is absent. `redactOfferEvidence` is exported for root's diagnostic artifacts. Root owns offer-emission.e2e.ts and exact OF00/OF01/OF02 assertions.

Root may use unchanged `createEstimateViaWizard` from critical fixtures with the same army. Its one creation-observed artifact is still written by that helper into critical/coverage according to its existing selector; treat it as ancillary creation evidence, copy and hash only this fixture's artifact into the dedicated archive, never describe the profile as a critical campaign pass. All new offer evidence uses the dedicated writer. Fixture teardown retains owned IDs without destructive cleanup.

## Collector lineage and proof boundaries

New scripts/tester-army/offer-collector.mjs is an exact byte copy of .e2e/offer-emission/transport-preparation-20261013-01/collector.mjs, SHA256 ab68f12788d1d96b7f15f02332988605adc866c60af06b7e35634d57b0929435. Original before-code cases, six failed attempts/corrections, main real SDK 10/10 case groups, Buffer422/zero-receipt then base64/replay409/stopped proof and independent review remain in that ignored preparation archive. Its manifest SHA256 is 17a749a99b6ca71f3c58f0ff0b00bba68ff31deac4a41b45f6cf83ff557d484a. Exact copy preserves collector protocol evidence; it does not qualify the new server/browser guard or actual app integration.

Collector logically commits separate private payload/PDF and public hash receipt by directory rename before HTTP200. It is collection only, without SMTP/relay/DB/Storage. Public filenames are fixed and original filename is hashed. Limits: 12 MiB packet, 8 MiB PDF, 1 MiB HTML/text, 50 fixture recipients; strict base64 and PDF envelope. Configured 5000 ms collector HTTP/inactivity settings do not establish an absolute completion deadline. Guarded SDK fetch has a five-second timeout. Restart/cross-process idempotency, Windows power-loss directory durability, full PDF parsing and Internet delivery remain excluded.

## Future execution

The application requires a prepared PDF before send gating. OF00/OF01/OF02 use
the actual affaire button and layout dialog to publish it. The browser admits
only GET/HEAD/OPTIONS for the configured native signed `estimate-documents`
content addressed PDF path containing this fixture's exact project and version.
It admits no other Storage path or mutation. Signed URLs remain redacted from
public evidence. OF0L deliberately checks the concurrent lease before PDF gating.

Use `e2e.offer.config.ts` at the repository root as the CLI entry point. It exports
the dedicated local profile unchanged. Installed TesterArmy resolves its project
root from the entry config directory, including test globs, output and owned logs.
The initial nested-config collection stopped at INVALID_CONFIG/NO_TESTS before
any application, browser or emission; both attempts remain in their fresh archives.

The new scripts/tester-army/check-offer-network-guard.mjs exports `probeOfferGuard({directory,appOrigin,backendOrigin})` returning status/reportPath/reportSha256/sourceSha256/startedAt/completedAt/cases/cleanup. It creates a fresh nested archive, only an owned loopback collector and dummy app health listeners, and never contacts the configured native origin or a product API. The standalone command was actually executed with localhost:3176 app role and native role127.0.0.1:45585; actual SDK/base64 commit/replay409/Buffer422, localhost plus exact-port127/::1 socket aliases, other-port/custom-hook refusals, forbidden SDK plus ten API calls, safe fixed-field logs and stopped collector failure all passed. Six cleanup conditions passed and runtime hashes stayed unchanged. Report: .e2e/army/offer/guard-qualification-20261013-01/2026-10-13T11-45-04-493Z-23b9b540-db60-41ea-87be-149beccf9075/public/report.json; SHA25639d6b091305f3fb21f9539db3e9ca8826e044881b1b1b338cd3986439b3152ec. The new guard SHA256 is1cc117425c59b7327ecfe393e36f4770ba2b5783530119191269032cb41ace2e; probe SHA256f9477ad08954bb952629343e34a4af5e07f4e7dc157f63e31f795e6ae0c60342. This module/socket proof does not establish actual Next preload, browser refusal gates, native authorization or app issuance.

An authorized launcher must start a new collector with a new owned ignored directory, qualify both collector and three-origin app preload against forbidden hostname/real stopped socket, pass exact env, then use this dedicated config. It must archive command, revision/status/diff and runtime hashes, exact origins/bind, guard/probe results, fresh reports, owned ARMY UUIDs, expected/actual values, true PDF bytes/SHA and redacted receipts. Sanitize app logs before retaining/reporting them: Next's own log is not covered by the network guard logger. Never render/upload private payload or pointer. Config does not start a collector or repair an unavailable native backend.

Discovery/build/UI execution is not performed by this preparation task. OF00 must require actual /send success, actual dispatch and collected/stored PDF SHA; OF01/OF02 must use only the link extracted from that true collection. No token/status mock or seeded issuance may turn missing setup into product proof.
