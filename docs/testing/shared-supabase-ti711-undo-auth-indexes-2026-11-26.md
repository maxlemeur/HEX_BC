# Shared database receipt for workbook undo authorization and batch indexes · 26 November 2026

Supabase recorded the TI-711 migration at 14:06:28 UTC on 26 November 2026. The migration checks workbook undo authorization before waiting on the batch row and checks it again against the locked row. It replaces the two indexes used to find imported articles and supplier references. [Migration](../../supabase/migrations/20261126100842_workbook_undo_authorization_and_batch_indexes.sql) · [Schema PR #633](https://github.com/thannous/HEX_BC/pull/633)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `110bdc5bc71ab711a72a2bb3f3f597944c030e8b` |
| Name in shared history | `20261126100842_workbook_undo_authorization_and_batch_indexes` |
| Remote version | `20261126140628` |
| Stored SQL | One element in `statements`, 10,367 bytes including the final newline |
| SHA-256 of both the Git file and the stored SQL | `eaf3165602bb2c6bcb164917718be45eb629baa742e8cda1d95c2b71fd7295d7` |

## History and row counts

| Measure | Before · 14:06:18.237515 UTC | After · 14:06:40.764244 UTC |
| --- | ---: | ---: |
| Migration history entries | 455 | 456 |
| Latest remote version | `20261126095958` | `20261126140628` |
| `catalogue_import_batches` rows | 0 | 0 |
| `products` rows | 1,308 | 1,308 |
| `supplier_catalog_items` rows | 186 | 186 |

The SHA-256 of the 455 earlier entries was `3112db1205a55dceef1bc782949e855a86b5aea3eac5c682dc0ce2005eeea49f` before and after application, using a JSONB array of version, name and statements ordered by version. The preceding entry was `20261126011254_workbook_undo_release_kept_article_locks`, and its stored SQL matched the hash in its published receipt. Every earlier entry matched a migration filename, a documented split migration, or an entry in the historical inventory, which includes the archived optional-dossier SQL. [Preceding receipt](./shared-supabase-ti711-undo-locks-2026-11-26.md) · [Workbook import receipt](./shared-supabase-ti711-workbook-import-review-2026-11-25.md) · [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json)

The standalone remote versions `20260304`, `20260305` and `20260306` were absent as allowed by the README. Version `20260222` was present. With historical and split entries accounted for, the precheck found two pending files. The workbook undo migration was applied once. Version `20261124174040` for material request original PDFs was absent on both reads. [Supabase README](../../supabase/README.md#appliquer-sur-une-base-partagée) · [Material request PR #535](https://github.com/thannous/HEX_BC/pull/535)

At the precheck, both tables had `tenant_id`, `import_batch_id` and `id`. The functions `public.has_tenant_role(uuid, public.tenant_role[])` and `public.current_tenant_id()` were present. No other session held or awaited a lock on either table, and no other transaction in the database was older than five seconds.

## Installed function

`public.undo_catalogue_import_batch(uuid, integer)` returned `jsonb` with a second parameter default of 500, owner `postgres`, `SECURITY DEFINER` and an empty `search_path` on both reads. Its ACL stayed `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. The `authenticated` and `service_role` roles had `EXECUTE`. The `anon` role and `PUBLIC` lacked `EXECUTE`.

| SHA-256 | Before | After |
| --- | --- | --- |
| Installed `pg_get_functiondef` | `829b4f7e6780368ad14874360b8496c2f4da818625001a3c25f41921dccec1ab` | `75cf4b03c23c473616964cec5b2874551532028a3b38b72a03d01805dc915727` |
| Installed function body | `045b6146abf73bd5468451c2f868fd509925bff1b3377d6b444a191b911bd870` | `a455f22914bc3f761cdb2b976675d2a3d40aef6d61846989749e3131007f8e5b` |

The installed body hash matched the body in the reviewed Git migration.

## Indexes

Both indexes had `indisvalid` and `indisready` set to true before and after application.

| Index | Before | After |
| --- | --- | --- |
| `products_import_batch_idx` | `CREATE INDEX products_import_batch_idx ON public.products USING btree (import_batch_id, id) WHERE (import_batch_id IS NOT NULL)` | `CREATE INDEX products_import_batch_idx ON public.products USING btree (tenant_id, import_batch_id, id) WHERE (import_batch_id IS NOT NULL)` |
| `supplier_catalog_items_import_batch_idx` | `CREATE INDEX supplier_catalog_items_import_batch_idx ON public.supplier_catalog_items USING btree (import_batch_id, id) WHERE (import_batch_id IS NOT NULL)` | `CREATE INDEX supplier_catalog_items_import_batch_idx ON public.supplier_catalog_items USING btree (tenant_id, import_batch_id, id) WHERE (import_batch_id IS NOT NULL)` |

## Advisors and production health

| Advisor | Finding | Previous receipt | After application |
| --- | --- | ---: | ---: |
| Security | RLS enabled without a policy | 32 | 32 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 117 | 117 |
| Security | Leaked password protection | 1 | 1 |
| Performance | Unindexed foreign keys | 251 | 249 |
| Performance | Unused indexes | 549 | 492 |
| Performance | Multiple permissive policies | 6 | 6 |

The previous advisor snapshot is from the earlier application on 26 November. The aggregate differences span both observations and cannot establish which changes caused them. [Previous advisor snapshot](./shared-supabase-ti711-undo-locks-2026-11-26.md#advisors-and-production-health)

Production health returned HTTP 200 with `db: up` and application version `0.9.0` at 14:06:37.724215 UTC. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

Verification covered shared migration history, function and index metadata, row counts, advisors and production health. The shared check did not run an import, call the undo RPC, exercise concurrency or run an authenticated RLS journey. The schema PR records those checks on owned stacks. The migration application was the only shared database write. No deployment or feature activation was performed.
