# Shared database receipt for workbook undo locks · 26 November 2026

The shared migration history records the TI-711 workbook undo lock migration at 09:59:58 UTC on 26 November 2026. The migration replaces the undo function so it releases locks on a kept article before moving to the next article. The application was already recorded when this independent, read-only verification began. [Migration](../../supabase/migrations/20261126011254_workbook_undo_release_kept_article_locks.sql) · [Schema PR and original application report](https://github.com/thannous/HEX_BC/pull/628#shared-supabase-migration-receipt)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `19941c3e02dd9b7205ea707fef622a530811c5c9` |
| Name in shared history | `20261126011254_workbook_undo_release_kept_article_locks` |
| Remote version | `20261126095958` |
| Stored SQL | One element in `statements`, 8,958 bytes including the final newline |
| SHA-256 of both the Git file and the stored SQL | `68ec924ebf3c3ceff205e3669cd7125ea3aca64feb3857048ac26d127c7ea77a` |

## History and row counts

| Measure | Observed value |
| --- | ---: |
| History entries through the previous receipt's latest version `20261125223909` | 454 |
| History entries at 10:08:50.969553 UTC and 10:09:59.382819 UTC | 455 |
| `catalogue_import_batches` rows at 10:09:32.202199 UTC | 0 |
| `products` rows at 10:09:32.202199 UTC | 1,308 |
| `supplier_catalog_items` rows at 10:09:32.202199 UTC | 186 |

The latest shared history entry was the undo lock migration on both reads. The SHA-256 of the 454 earlier entries, serialized as a JSONB array of version, name and statements ordered by version, was `08f7fa442a059353ed5aea9b11af2d543d4f6b0c778f7caac5a19f7d1ba839df` on both reads. The 51 entries without a direct filename match were all covered by the earlier inventory. [Previous receipt](./shared-supabase-ti711-workbook-import-review-2026-11-25.md) · [Earlier inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json)

Version `20261124174040` for material request original PDFs was absent from shared history. It was the only missing file after accounting for split histories and the four historical versions listed in the README. [Material request PR #535](https://github.com/thannous/HEX_BC/pull/535) · [Supabase README](../../supabase/README.md#appliquer-sur-une-base-partagée)

## Installed function

At 10:09:32.202199 UTC, `public.undo_catalogue_import_batch(uuid, integer)` returned `jsonb` and had owner `postgres`, `SECURITY DEFINER` and an empty `search_path`. The second parameter defaults to 500. The catalog ACL was `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. The `authenticated` and `service_role` roles had `EXECUTE`. The `anon` role and `PUBLIC` lacked `EXECUTE`.

| Hash | SHA-256 |
| --- | --- |
| Installed `pg_get_functiondef` | `829b4f7e6780368ad14874360b8496c2f4da818625001a3c25f41921dccec1ab` |
| Installed function body and body in the Git migration | `045b6146abf73bd5468451c2f868fd509925bff1b3377d6b444a191b911bd870` |

## Advisors and production health

| Advisor | Finding | Count on 26 November |
| --- | --- | ---: |
| Security | RLS enabled without a policy | 32 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 117 |
| Security | Leaked password protection | 1 |
| Performance | Unindexed foreign keys | 251 |
| Performance | Unused indexes | 549 |
| Performance | Multiple permissive policies | 6 |

The published 25 November receipt listed 325 unused-index findings after that day's migration. The five other totals match. These snapshots were taken on different days and cannot attribute the difference to the undo lock migration. [25 November advisor snapshot](./shared-supabase-ti711-workbook-import-review-2026-11-25.md#advisors-and-production-health)

Production health returned HTTP 200 with `db: up` and application version `0.9.0` at 10:09:35.645223 UTC. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

Both history digests and all catalog, row count, advisor and health observations in this receipt were collected after the recorded application. The verification has no independently observed immediate pre-application digest, function hash, row counts or advisor baseline. It used read-only queries and a health request. No shared import, undo RPC, concurrency scenario or authenticated RLS journey was exercised. This verification made no database write or deployment.
