# Shared database receipt for workbook import review · 25 November 2026

The shared database recorded the TI-711 workbook import review migration at 22:39:09 UTC. It adds catalogue import batches, supplier aliases and bulk review functions. The consumer merged separately. [Migration](../../supabase/migrations/20261125210441_workbook_import_batches_aliases_bulk_review.sql) · [Schema PR #615](https://github.com/thannous/HEX_BC/pull/615) · [Consumer PR #616](https://github.com/thannous/HEX_BC/pull/616)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `b736b76953c3f6c6fd0383307696e35579a7bf92` |
| Name in shared history | `20261125210441_workbook_import_batches_aliases_bulk_review` |
| Remote version | `20261125223909` |
| Stored SQL | One application call, one element in `statements`, 51,350 bytes including the final newline |
| SHA-256 of both the Git file and the stored SQL | `c7c66a2937f1dc0d39b779fe3fc65e8448f2bfa0579e2939758dbb09b7dd6060` |

## History and row counts

| Measure | Before · 22:38:55.853 UTC | After · 22:40:07.903 UTC |
| --- | ---: | ---: |
| Migration history entries | 453 | 454 |
| Latest remote version | `20261125210507` | `20261125223909` |
| Products | 1,308 | 1,308 |
| Supplier catalogue items | 186 | 186 |
| Estimate items | 2,802 | 2,802 |
| Suppliers | 81 | 81 |
| `supplier_aliases` | Table absent | 0 |
| `catalogue_import_batches` | Table absent | 0 |

The SHA-256 of the 453 earlier entries, including their SQL and ordered by version, was `91637b101c72b394ed9f2cc69c4c0091287f577c49cd97a711d705dc0cab2e74` at both checks. The previous latest entry was `20261125185936_estimate_creation_payload_passes` and its stored SQL matched its Git file. The precheck confirmed all eight prerequisite function signatures and found no active writer or conflicting lock on the monitored tables. Both new `import_batch_id` columns had zero non-null values after application. [Previous receipt](./shared-supabase-estimate-creation-payload-passes-2026-11-25.md)

All 51 pre-existing remote entries without a direct filename match were already inventoried on 22 November. This includes `init_schema`, the October restore, `20261022112603` (`provision_mergeone_backup_reader`), the two migrations represented by 11 history fragments and `20261111190106` for the exact archived optional-dossier SQL. Of the four historical versions listed in the README, `20260222` appeared as a remote version and `20260304`, `20260305` and `20260306` did not. [22 November inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json) · [Split migration comparison](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments) · [Archived SQL](../../supabase/applied/20261111130710_optional_dossier_documents.sql) · [Supabase README](../../supabase/README.md#appliquer-sur-une-base-partagée)

Version `20261124174040` for material request original PDFs remained absent from shared history before and after this operation. [PR #535](https://github.com/thannous/HEX_BC/pull/535)

## Installed tables and grants

| Table | RLS | `authenticated` table privileges |
| --- | --- | --- |
| `supplier_aliases` | Enabled and forced | `SELECT`, `INSERT`, `DELETE` |
| `catalogue_import_batches` | Enabled | `SELECT` |

Both table ACLs omit `anon` and `PUBLIC`. `service_role` has the migration's explicit `SELECT`, `INSERT`, `UPDATE` and `DELETE` and the matching schema default ACL also grants it `TRUNCATE`, `REFERENCES`, `TRIGGER` and `MAINTAIN` on both new tables.

All four permissive policies apply to `authenticated`. Tenant members can read aliases and batches. Active-tenant admins and engineers can add aliases. Tenant admins can delete aliases, as can authors who are tenant members. The installed policies are `Tenant members read supplier aliases`, `Catalogue editors add supplier aliases`, `Admins and authors delete supplier aliases` and `Tenant members read catalogue import batches`.

`products.import_batch_id` and `supplier_catalog_items.import_batch_id` are nullable UUIDs with no default. `products_import_batch_fkey` and `supplier_catalog_items_import_batch_fkey` both reference `catalogue_import_batches(tenant_id, id)` from `(tenant_id, import_batch_id)`. All 17 constraints were validated, including the primary, unique, foreign and check constraints on the two new tables.

The triggers `enforce_supplier_alias_write`, `validate_product_import_batch_insert` and `validate_product_import_batch_update` were enabled.

The 11 explicit indexes were present, valid and ready.

| Table | Indexes |
| --- | --- |
| `catalogue_import_batches` | `catalogue_import_batches_created_by_idx`, `catalogue_import_batches_tenant_created_idx`, `catalogue_import_batches_undone_by_idx` |
| `estimate_items` | `estimate_items_product_id_idx` |
| `product_reference_price_validations` | `product_reference_price_validations_product_id_idx` |
| `product_reference_price_withdrawals` | `product_reference_price_withdrawals_product_id_idx` |
| `products` | `products_import_batch_idx` |
| `supplier_aliases` | `supplier_aliases_created_by_idx`, `supplier_aliases_supplier_idx` |
| `supplier_catalog_items` | `supplier_catalog_items_import_batch_idx`, `supplier_catalog_items_review_queue_idx` |

The four implicit unique indexes were also valid and ready. They are `catalogue_import_batches_pkey`, `catalogue_import_batches_tenant_id_key`, `supplier_aliases_pkey` and `supplier_aliases_tenant_alias_key`.

## Installed functions

All ten functions have owner `postgres` and an empty `search_path`. Catalog privilege checks returned no `EXECUTE` for `anon` or `PUBLIC` on any of them. `service_role` has `EXECUTE` on all ten. The two private trigger functions have no `EXECUTE` for `authenticated`.

| Signature | Security mode | `authenticated` can execute | Change |
| --- | --- | --- | --- |
| `private.enforce_supplier_alias_write()` | Invoker | No | Created |
| `private.enforce_product_import_batch()` | Definer | No | Created |
| `public.start_workbook_article_import(uuid,text)` | Definer | Yes | Created |
| `public.import_workbook_supplier_reference_batch(uuid,jsonb,text)` | Definer | Yes | Created |
| `public.review_supplier_references(uuid[],boolean)` | Definer | Yes | Created |
| `public.validate_draft_products(uuid[])` | Invoker | Yes | Created |
| `public.assign_products_supply_type(uuid[],uuid)` | Invoker | Yes | Created |
| `public.undo_catalogue_import_batch(uuid,integer)` | Definer | Yes | Created |
| `public.save_supplier_catalog_item(uuid,uuid,text,text,boolean)` | Definer | Yes | Replaced |
| `public.update_supplier_catalog_item(uuid,text,text)` | Definer | Yes | Replaced |

Both replaced RPCs retained their signatures, owner, `search_path` and ACL (`{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`).

| SHA-256 of `pg_get_functiondef` | Before | After |
| --- | --- | --- |
| `public.save_supplier_catalog_item(uuid,uuid,text,text,boolean)` | `30084b6f120782b5e7436bac45c99ec4f1d74512acc036a7352c69b79a7f1d67` | `04a1ef59cf0516da2d6e88c716c1f5824e1081d146272955c89e2458de4da364` |
| `public.update_supplier_catalog_item(uuid,text,text)` | `231e638db0a2858abedfb87eb630cd297bff2e21155b5a63618f4eba7e7b202f` | `ff0e152e6a64a24a042732fa3d91df5129bcd1071a400aeb8bc3957071cb4488` |

## Advisors and production health

| Advisor | Finding | Before | After |
| --- | --- | ---: | ---: |
| Security | RLS enabled without a policy | 32 | 32 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 113 | 117 |
| Security | Leaked password protection | 1 | 1 |
| Performance | Unindexed foreign keys | 252 | 251 |
| Performance | Unused indexes | 314 | 325 |
| Performance | Multiple permissive policies | 6 | 6 |

Security Advisors returned four new warnings for the reviewed grants on `public.import_workbook_supplier_reference_batch`, `public.review_supplier_references`, `public.start_workbook_article_import`, `public.undo_catalogue_import_batch`. These are the four new public `SECURITY DEFINER` functions, and the installed grants matched the migration. The remaining security findings were identical. [Supabase advisor](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

The three unindexed foreign-key findings for `estimate_items`, `product_reference_price_validations` and `product_reference_price_withdrawals` cleared. The following performance notices appeared after application.

- Table `public.products` has a foreign key `products_import_batch_fkey` without a covering index. This can lead to suboptimal query performance.
- Table `public.supplier_catalog_items` has a foreign key `supplier_catalog_items_import_batch_fkey` without a covering index. This can lead to suboptimal query performance.
- Index `supplier_aliases_supplier_idx` on table `public.supplier_aliases` has not been used
- Index `supplier_aliases_created_by_idx` on table `public.supplier_aliases` has not been used
- Index `catalogue_import_batches_tenant_created_idx` on table `public.catalogue_import_batches` has not been used
- Index `catalogue_import_batches_created_by_idx` on table `public.catalogue_import_batches` has not been used
- Index `catalogue_import_batches_undone_by_idx` on table `public.catalogue_import_batches` has not been used
- Index `products_import_batch_idx` on table `public.products` has not been used
- Index `supplier_catalog_items_import_batch_idx` on table `public.supplier_catalog_items` has not been used
- Index `supplier_catalog_items_review_queue_idx` on table `public.supplier_catalog_items` has not been used
- Index `estimate_items_product_id_idx` on table `public.estimate_items` has not been used
- Index `product_reference_price_validations_product_id_idx` on table `public.product_reference_price_validations` has not been used
- Index `product_reference_price_withdrawals_product_id_idx` on table `public.product_reference_price_withdrawals` has not been used

[Unindexed foreign-key advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) · [Unused-index advisor](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index)

Production health returned HTTP 200, application version `0.9.0` and database status `up` at 22:38:49.645601 UTC and 22:40:04.641161 UTC. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

Verification used read-only history, catalogue, row count and advisor queries plus the production health endpoint. It did not exercise application imports, undo, an authenticated RLS journey, or RPC behavior on the shared database. There was no deployment, feature activation or additional database write.
