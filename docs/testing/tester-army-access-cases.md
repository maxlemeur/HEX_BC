# Tester Army: anonymous API access boundaries

This failure inventory was written before the scenarios. The suite uses a fresh browser with no saved session and sends requests with `credentials: "omit"`. It reaches the real local Next API backed by the configured Supabase; it does not mock product responses, authenticate, or use a privileged observer.

## Observable failures and contracts

Every case must return exactly HTTP `401`, JSON `ok: false`, and `error.code: "UNAUTHORIZED"`. A `400`, `403`, redirect, HTML login page, or network rejection is a failure: it does not prove this authentication boundary. The response must contain only the failure envelope and public authentication error fields, with no business data, resource ID, storage path, or internal error details.

The takeoff upload error contract adds public `retryable: false` and `level: "A"`, repeated under `details`. The test checks those exact values and keys; that metadata is permitted, while a job ID, other detail, or extra response field fails.

| Case | Request and valid fixture | Failure exposed | Inspected boundary |
| --- | --- | --- | --- |
| List estimates | `GET /api/estimates` | Anonymous disclosure of projects, versions, or totals | `listLatestEstimates` authenticates before its queries. |
| Create estimate | `POST /api/estimates`, a new `ARMY access <UUID>` project and valid draft version | Anonymous project/version creation, or a malformed fixture hiding a missing guard | `createEstimateSchema` validates the body; `createEstimate` then authenticates before default-category upsert and project/version writes. |
| List imports | `GET /api/imports` | Anonymous disclosure of imports and Storage paths | `listUserImports` authenticates before `dpgf_imports` queries. |
| Create canonical JSON import | `POST /api/imports`, `application/json`, one tabular DPGF row with designation, unit, quantity and unit price | Anonymous import or raw-row insertion | `createImportFromJsonBody` validates the shape/metadata and authenticates before project lookup and record/raw-row writes. |
| Upload CSV import | `POST /api/imports`, multipart with a nonempty CSV `File` and `headerRowNumber=1` | Anonymous Storage upload or import creation through the separate multipart path | `createImportFromMultipartFormData` validates file metadata and authenticates before Storage upload. |
| List takeoff jobs | `GET /api/takeoff/jobs?limit=1&offset=0` | Anonymous job, counter, or source-file disclosure | `getAuthenticatedTakeoffContext` authenticates before tenant feature checks and queries. |
| Upload structured takeoff | `POST /api/takeoff/jobs`, multipart CSV, level `A`, a syntactically valid run UUID and idempotency key | Anonymous Storage upload, job creation, or worker dispatch | `createTakeoffJobFromFormData` validates file/level/version UUID and hashes the bytes before authentication; Storage upload, job insert and dispatch occur after the guard. |

The takeoff UUID is deliberately a synthetic fixture identifier, not an existing estimate. This proves authentication occurs before resource lookup. Level A uses a tiny valid CSV to avoid PDF validation or inference masking the guard.

Source contracts: [estimate route](../../src/app/api/estimates/route.ts), [estimate schema](../../src/lib/estimates/schemas.ts), [estimate service](../../src/lib/estimates/server.ts), [import route](../../src/app/api/imports/route.ts), [import service](../../src/lib/imports/server.ts), [takeoff route](../../src/app/api/takeoff/jobs/route.ts), [takeoff service](../../src/lib/takeoff/server.ts), and [tenant authentication](../../src/lib/auth/tenant-context.ts).

## Repeatable evidence

Run through the critical wrapper described in [Tester Army](tester-army.md). The test is tagged `critical`, `anonymous`, and `access-boundary`; it imports `test` from `@e2e-dev/web` and declares no session. Its local network guard permits the tested product POST routes so the server actually receives the requests; it blocks external traffic and other writes. Fontshare CSS is fulfilled locally because it is unrelated to the API boundary.

This anonymous scenario explicitly uses `trace: "on"`; authenticated critical scenarios keep traces off because password redaction does not guarantee removal of Supabase-issued session tokens. No authentication response or saved session is used here.

Each attempt writes `.e2e/army/critical/artifacts/business/access-boundaries-<UUID>.json`, including the run prefix, app origin, viewport, fixture identity/hash, expected contracts, observed status and sanitized response shape, and pass/fail/unfinished status for every case. The JSON is written in `finally`, including when an assertion fails. The wrapper records source/environment/command metadata and hashes the evidence directory; SDK report steps and traces independently record the browser requests. A failure before the body or before artifact creation is missing proof. All seven cases must pass on each selected target to claim this boundary covered.

## Proof limits

HTTP refusal and absence of data in the response are verified by these scenarios. The inspected current code puts authentication before writes. This suite does **not** measure database row counts, confirm the absence of `ARMY` persistence, execute RLS tests, inspect authenticated tenant isolation, or prove that a future server implementation could not write and then return `401`. No privileged observer, session JWT extraction, or `service_role` credential is used. Those persistence/security claims require separate authorized evidence; they must not be inferred from this report.
