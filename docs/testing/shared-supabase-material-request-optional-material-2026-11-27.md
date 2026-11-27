# Shared database receipt for optional material on material request lines · 27 November 2026

Supabase recorded the migration at 03:24:57 UTC. A material request line can now be validated without a material. Changing the request’s presumed material leaves validated lines in place. [Reviewed schema change](https://github.com/thannous/HEX_BC/pull/690)

| Migration identity | Value |
| --- | --- |
| Merge commit and checked `origin/main` | `7d82e1e7cabc58f1f0cecc6f19669b27a448f4f2` |
| Name in shared history | [20261127022446_material_request_optional_material](../../supabase/migrations/20261127022446_material_request_optional_material.sql) |
| Remote version | `20261127032457` |
| Stored SQL bytes | 33,160 |
| SHA-256 of Git, manifest, submitted SQL and stored SQL | `8496de6a76b105a51bca50b01f18729805b2f5842f1dcef30cd7f5698bdfc8a0` |

The production environment configuration identified the connector project. Its migration history matched the published baseline. A single migration call submitted the complete file with its transaction, five-second lock timeout and final newline. Supabase stored exactly those bytes in one `statements` element. [Manifest](../../supabase/migrations.manifest.json) · [Shared application procedure](../../supabase/README.md#appliquer-sur-une-base-partagée)

## History and row counts

| Measure | Before · 03:24:32.336205 UTC | After · 03:25:20.791112 UTC |
| --- | ---: | ---: |
| Migration history entries | 469 | 470 |
| Latest remote version | `20261127024742` | `20261127032457` |
| `public.material_requests` | 10 | 10 |
| `public.material_request_lines` | 216 | 216 |
| `public.material_request_quotes` | 8 | 8 |
| `public.material_request_quote_lines` | 80 | 80 |
| `public.purchase_orders` | 18 | 18 |
| `public.purchase_order_items` | 1017 | 1017 |

At 03:23:37.908438 UTC the first 468 entries matched the published SHA-256, `f985bb544c1bc460e5ff551a26b0457b5842484c4bac6215ba65d32518cd5cee`. Entry 469 matched by name (`20261126233223_takeoff_api_dollar_ceiling`), remote version (`20261127024742`), length (13,305 bytes) and SHA-256 (`30c69d0dd59d05ca35ad33d381fe3c117eb0955b8c9ed7c025625207c3801b8e`). At 03:25:27.375380 UTC the first 469 entries still had their pre-application SHA-256, `81e2f3f191fc8adb5ea71fe0a07e6065fcd6eb61ab32cdb2ff4e272bc5bd794e`. Each history digest uses the JSONB array of `[version, name, statements]` in version order. The connector listing and the history table both showed one additional entry. [Previous receipt](https://github.com/thannous/HEX_BC/pull/692)

The only other merged migration absent from the shared history was [`20261126230300_catalogue_reference_naming_abbreviations`](../../supabase/migrations/20261126230300_catalogue_reference_naming_abbreviations.sql), both before and after. The comparison accounted for historical names, version-only entries and the two migrations recorded in fragments. [Historical split migrations](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments)

## Precheck and installed functions

Before application, each of the three replacement signatures, including its return type, matched the installed declaration. The installed `pg_proc.prosrc` values matched the previous definitions byte for byte. The enabled `reopen_material_request_lines_without_material` trigger on `public.material_requests` referenced the private trigger function of the same name. At 03:24:39.462026 UTC the database had zero other transactions or active queries older than five seconds and zero held or awaited locks on `material_requests`, `material_request_lines` and `material_request_quotes`. [Previous quote and line definitions](../../supabase/migrations/20261112173255_material_request_quotes.sql) · [Previous order definition](../../supabase/migrations/20261122194343_affaire_site_contacts.sql)

After application, each replaced name resolved to exactly one function in its schema, and its body matched the reviewed file byte for byte. The removed trigger and its function were both absent. The following are SHA-256 digests of `pg_get_functiondef`.

| Function | Before | After |
| --- | --- | --- |
| `private.enforce_material_request_line_write()` | `254bff0139e0d58803b6b259fabcc0a2f6d7fb7e93ea4e99a4c34ff5b8d3a4cb` | `58d2c51ecd9cdff4116bf7f3753efbb63440dda1ca96c7bdcf354df4e7ef7d42` |
| `private.reopen_material_request_lines_without_material()` | `14c9f4a1303f46183e3372c69f24783af52edbb5128f463579eccfd2ceb61499` | Removed |
| `public.create_material_request_purchase_orders(uuid, uuid)` | `c645b656a7ebe41e02f03c55ff17ebe7a29271c9515fd52da0c6b00b5294fc71` | `811d278c4b3f2da5a313071bac826cf7b9f735d3dae96aca466f9d16e0271cf4` |
| `public.retain_material_request_quote(uuid)` | `2e806674c67837ca5e5acb5e88fbb8be152779cf08752a647b8083499690a1b0` | `55782b4970da4fddfc4383a4840cac624873ea287e1194e5b0667b80e878a3a8` |

All four functions were owned by `postgres` with an empty `search_path` before application. The three retained functions kept their owner, security mode, search path, ACL, arguments and return type.

| Function | Returns | Security mode | ACL observed before application |
| --- | --- | --- | --- |
| `private.enforce_material_request_line_write()` | `trigger` | Invoker | `{postgres=X/postgres,service_role=X/postgres}` |
| `private.reopen_material_request_lines_without_material()` | `trigger` | Invoker | `{postgres=X/postgres,service_role=X/postgres}` |
| `public.create_material_request_purchase_orders(uuid, uuid)` | `jsonb` | Definer | `{postgres=X/postgres,authenticated=X/postgres}` |
| `public.retain_material_request_quote(uuid)` | `TABLE(closed_quote_id uuid)` | Invoker | `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}` |

### Function comments

The post-application `obj_description` values matched both `COMMENT ON FUNCTION` literals in Git exactly. Quote retention’s comment now specifies confirmation before the quote request and continuity since then. It also removes the former unconfirmed-material refusal. The order function’s comment was rewritten with identical text.

| Function | SHA-256 of comment before | SHA-256 of comment after |
| --- | --- | --- |
| `public.create_material_request_purchase_orders(uuid, uuid)` | `4d8a4f4d27d3fb06ec7fbecb19b62614538489504241c41d8b6dcba3c06c70c8` | `4d8a4f4d27d3fb06ec7fbecb19b62614538489504241c41d8b6dcba3c06c70c8` |
| `public.retain_material_request_quote(uuid)` | `2fb30252040971d918e6552e652b62d96c4437e705cce49cdb022face7709258` | `9457440c54ee315d0fbb553a83dc9db43ceda89b71c928d6d1ebf8c98ab3db80` |

<details>
<summary>Comment text read from the shared catalogue</summary>

**`public.create_material_request_purchase_orders(uuid, uuid)` before and after**

TI-691: one draft purchase order per supplier from the ready lines of a material request (validated, priced by a retained quote, in no order that is not canceled), all of the request's affaire, its overhead lines included (imputation overhead); no delivery site, the request's delivery place as delivery mode, delivered on the date the request needs its material, instructions naming the affaire's site contacts (none: no instructions). Each line: article, reference at the supplier (else the article's), catalogue wording, quantity, unit, quote price and lot, 20 % tax, imputation, request line; then the shipping (« Port ») and the discount (« Remise ») of each retained quote that priced a line of the draft and that the draft completes, a lump sum at 20 % linked to its quote (material_request_quote_id), each once among the orders that are not canceled. Idempotent per request and key (replayed: true, each order with its current status). Caller: admin or engineer of the active tenant (PURCHASE_ORDER_ACCESS_DENIED) who writes the request (MATERIAL_REQUEST_ORDER_WRITERS_ONLY). Refusals: MATERIAL_REQUEST_ORDER_TOTAL_NEGATIVE (DETAIL: JSON name of the supplier), MATERIAL_REQUEST_ORDER_NOT_FOUND, _NOTHING_READY, _SUPPLIER_INACTIVE (DETAIL: JSON names), _KEY_TAKEN, MATERIAL_REQUEST_LINE_ALREADY_ORDERED.

**`public.retain_material_request_quote(uuid)` before**

TI-691: retains a received quote whose lines are all priced and validated, in one transaction, as the caller (RLS): it becomes retained, its lines take its supplier, price, price quantity and id, and a project line without its own material takes the request's confirmed presumed material (a validated line stays validated), and every other requested or received quote of the request sharing a line is closed; returns their ids. Refusals: MATERIAL_REQUEST_QUOTE_NOT_FOUND, _WRITERS_ONLY, _NOT_RECEIVED (DETAIL: status), _WITHOUT_LINES, _LINES_UNPRICED, _LINES_ALREADY_RETAINED, _LINES_NOT_VALIDATED and _MATERIAL_UNCONFIRMED (DETAIL: JSON array of line positions), _LINES_CHANGED.

**After**

TI-691: retains a received quote whose lines are all priced and validated, in one transaction, as the caller (RLS): it becomes retained, its lines take its supplier, price, price quantity and id, and a project line without its own material takes the request's presumed material when it was confirmed before the quote was requested and has not changed since, else stays without one (a validated line stays validated), and every other requested or received quote of the request sharing a line is closed; returns their ids. Refusals: MATERIAL_REQUEST_QUOTE_NOT_FOUND, _WRITERS_ONLY, _NOT_RECEIVED (DETAIL: status), _WITHOUT_LINES, _LINES_UNPRICED, _LINES_ALREADY_RETAINED, _LINES_NOT_VALIDATED (DETAIL: JSON array of line positions), _LINES_CHANGED.

</details>

## Advisors and production health

| Security advisor | Before | After |
| --- | ---: | ---: |
| [RLS enabled without a policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) | 42 | 42 |
| [Authenticated role can execute a security-definer function](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) | 124 | 124 |
| [Leaked password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) | 1 | 1 |

Production health returned HTTP 200 at 03:26:16 UTC with version `0.9.0` and `db: up`. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

The production deployment served commit `d4ef760977cee5b8592aa5dffe92da0d7d4058a2`, which predates the application change. With that application on the updated database, the screen still asks for a material while the database accepts a line without one. Retaining a quote copies the request’s presumed material onto a project line lacking its own material only if the presumed material was confirmed before consultation and has remained unchanged since. Otherwise the line can be priced without a material. [Application change](https://github.com/thannous/HEX_BC/pull/690)

The migration was the only shared write. Verification covered the catalogue, stored SQL, grants, row counts, security advisors and public health endpoint. Application acceptance in `npm run dev:prod:full` remains for the owner. No application deployment or live business RPC was performed. Any database correction requires a new reviewed migration.
