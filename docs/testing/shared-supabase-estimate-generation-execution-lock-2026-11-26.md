# Shared database receipt for estimate generation execution locks · 26 November 2026

Supabase applied the reviewed migration once at 17:34:18 UTC. It separates the execution lock from the AI quota window and preserves the two RPC signatures used by the deployed application. [Migration](../../supabase/migrations/20261126165318_separate_estimate_generation_execution_lock.sql) · [Schema PR #660](https://github.com/thannous/HEX_BC/pull/660)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `a062ae2eb5dc6c64b01d6232d7a488acd197333e` |
| Name in shared history | `20261126165318_separate_estimate_generation_execution_lock` |
| Remote version | `20261126173418` |
| Stored SQL | One element in `statements`, 22,387 bytes including the final newline |
| SHA-256 of Git, submitted and stored SQL | `3554778590cef070884256dc480cdf780e4a576b1d870fefc072447cbdea0ff0` |

## History and row counts

| Measure | Before · 17:34:09 UTC | After · 17:34:32 UTC |
| --- | ---: | ---: |
| Migration history entries | 460 | 461 |
| Latest remote version | `20261126165137` | `20261126173418` |
| `estimate_ai_generation_budgets` rows | 0 | 0 |
| Active budget leases (`lease_expires_at > now()`) | 0 | 0 |
| `estimate_structure_drafts` rows | 0 | 0 |
| `estimate_structure_draft_nodes` rows | 0 | 0 |
| `estimate_version_zero_drafts` rows | 0 | 0 |
| `estimate_version_zero_lots` rows | 0 | 0 |
| `estimate_version_zero_lines` rows | 0 | 0 |

The ordered JSONB array of version, name and statements for the 458 entries preceding the takeoff receipt still hashed to `cb9a3386339bbb41ae907acf9421fec59720f33cd608fb156f3ccfecc8b13271`. Including the takeoff migration at remote version `20261126161257`, the 459-entry reference hashed to `0f148146b69d75bc1a0c91eb3790efc317bbe3c4327883cae6c1f998f057cf8f`. The digest of the 460 entries preceding this application was `1ed5f9745690dbda5ae0c588e358aa0a1e9a0d4d368317d116e13bfc5dfed5c0` on both reads. [Takeoff receipt #663](./shared-supabase-takeoff-retain-measure-2026-11-26.md)

Every earlier entry matched a migration on `main`, a documented split migration or an entry in the historical inventory. The standalone remote version `20260222` was present. The versions `20260304`, `20260305` and `20260306` were absent as documented, with their files accounted for by stored names or suffixes. The current migration and both earlier stems, beginning with `20261126151913` and `20261126160921`, were absent from shared history before application. The current migration was the only pending file. The workbook undo and takeoff entries used their full file stems as names. [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json) · [Split migrations](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments) · [Supabase README](../../supabase/README.md#appliquer-sur-une-base-partagée) · [Workbook undo receipt](./shared-supabase-ti711-undo-auth-indexes-2026-11-26.md)

| Other file on `main` | Shared history before application | SHA-256 of stored SQL and Git file |
| --- | --- | --- |
| `20261124174040_material_request_original_pdfs` | Present at `20261126153032` | `ca1f4f384d56799abd1e21a44d5a40737778c1bd24f3fe633a69f60bfa416302` |
| `20261126145712_material_request_original_workbooks` | Present at `20261126153052` | `520a0893d22ee3f223225260e39ac9082ca21b8f6130a8a88eaf0eb0cdf056ea` |
| `20261126154030_takeoff_retain_measure` | Present at `20261126161257` | `9571b43647a5ea0b87f712500732890a14a0661aca513b21253fe4a733e571bf` |
| `20261126161733_delete_draft_material_request_lines` | Present at `20261126165137` | `ec832d688237b5373d9da5a2f5b9183ee9c70e05221af57a51c59cf1c246c198` |

The draft-line deletion entry from [PR #661](https://github.com/thannous/HEX_BC/pull/661) was the sole addition after the 459-entry reference. All four stored SQL values were single elements and matched their Git files byte for byte by SHA-256.

The precheck found the `private` schema, the two legacy RPCs and all required columns on the budget, draft and referenced tables. The two private tables, nine new signatures and seven trigger names were absent. At 17:34:09 UTC, no other session held or awaited a lock on the six monitored tables, no transaction or write was older than five seconds, and no generation lease was active.

## Installed functions and grants

Before application both legacy public RPCs were owned by `postgres`, used `SECURITY DEFINER` and had an empty `search_path`. Their ACL was `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`. `authenticated` and `service_role` had effective `EXECUTE`. `anon` and `PUBLIC` lacked it. The installed bodies matched the original stored migration byte for byte and its Git file after CRLF-to-LF normalization. [Original quota migration](../../supabase/migrations/20260713142735_harden_estimate_ai_generation_budgets.sql)

| Public RPC | SHA-256 of `pg_get_functiondef` before | SHA-256 of `pg_get_functiondef` after |
| --- | --- | --- |
| `acquire_estimate_ai_generation_lease(uuid, text, uuid)` | `a51e7fcfba5fd25b43b5cadc51fc3b5781fb40d1458adb5a845454338b12dbc7` | `cb6c20747fef84c506b4bc5b365ba0e4fbdfeac388666ec446f0355c2712f149` |
| `complete_estimate_ai_generation_lease(uuid, text, uuid)` | `83517b10a4d23d5856f83ab9e67fc123cf514e73cd64394e22ccf7ff5256f524` | `9d97c813b47b4611b37ce23b3b7e83315357d154564a547560ec2957dddc3c3d` |

All 11 installed functions are owned by `postgres` and have an empty `search_path`. The ten new or replaced bodies matched the reviewed SQL. The moved quota function retained its original `prosrc` SHA-256, `855c6f1195cbdf208b20542bedfe6755a91c10841aed3c5a521e83342f043bd7`. Both legacy RPCs retain `EXECUTE` for `authenticated` and `service_role`. All seven public signatures deny `EXECUTE` to `anon` and `PUBLIC`.

| Public function after application | Security mode | Non-owner `EXECUTE` |
| --- | --- | --- |
| `acquire_estimate_ai_generation_lease(uuid, text, uuid)` | Definer | `authenticated`, `service_role` |
| `complete_estimate_ai_generation_lease(uuid, text, uuid)` | Invoker | `authenticated`, `service_role` |
| `acquire_estimate_generation_execution(uuid, text, uuid, uuid, boolean)` | Definer | `authenticated` |
| `require_estimate_generation_execution(uuid, text, uuid)` | Definer | `authenticated` |
| `release_estimate_generation_execution(uuid, text, uuid)` | Definer | `authenticated` |
| `persist_estimate_structure_generation(uuid, uuid, jsonb, jsonb, jsonb, jsonb)` | Invoker | `authenticated` |
| `persist_estimate_v0_generation(uuid, uuid, jsonb, jsonb, jsonb)` | Invoker | `authenticated` |

The four private functions have owner-only ACLs. The moved `acquire_estimate_ai_generation_lease`, `estimate_generation_lock_key` and `acquire_estimate_generation_execution` use invoker rights. `fence_estimate_generation_write` uses definer rights. `PUBLIC`, `anon`, `authenticated` and `service_role` have no `EXECUTE` on any of the four.

## Private tables and draft triggers

The two private tables each contain zero rows, with RLS enabled and forced, zero policies and owner-only ACLs. `PUBLIC`, `anon`, `authenticated` and `service_role` have no table or column privileges. All columns are non-null. The shared primary key is `(tenant_id, version_id, operation)`, and each table has cascading tenant, version and user references. The primary key and both supporting indexes on `version_id` and `user_id` are valid and ready.

| Private table | Columns |
| --- | --- |
| `estimate_generation_execution_locks` | `tenant_id uuid`, `version_id uuid`, `operation text`, `token uuid`, `user_id uuid`, `expires_at timestamptz`. The operation check permits `structure_draft` and `version_zero_draft`. |
| `estimate_generation_legacy_drains` | `tenant_id uuid`, `version_id uuid`, `operation text`, `token uuid`, `user_id uuid` |

All seven triggers are enabled in origin mode (`tgenabled = 'O'`). Each runs before a row write and calls `private.fence_estimate_generation_write` with its draft operation.

| Trigger | Public table | Event |
| --- | --- | --- |
| `zz_fence_estimate_structure_generation_insert` | `estimate_structure_drafts` | Insert |
| `zz_fence_estimate_structure_generation_discard` | `estimate_structure_drafts` | Status update from `pending` to `discarded` |
| `zz_fence_estimate_structure_generation_nodes` | `estimate_structure_draft_nodes` | Insert |
| `zz_fence_estimate_v0_generation_insert` | `estimate_version_zero_drafts` | Insert |
| `zz_fence_estimate_v0_generation_supersede` | `estimate_version_zero_drafts` | Status update from `ia_a_revoir` or `ready_for_version` to `superseded` |
| `zz_fence_estimate_v0_generation_lots` | `estimate_version_zero_lots` | Insert |
| `zz_fence_estimate_v0_generation_lines` | `estimate_version_zero_lines` | Insert |

## Advisors and production health

| Advisor | Finding | Last published totals (#653) | Before | After |
| --- | --- | ---: | ---: | ---: |
| Security | RLS enabled without a policy | 32 | 35 | 37 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 117 | 120 | 122 |
| Security | Leaked password protection | 1 | 1 | 1 |
| Performance | Unindexed foreign keys | 249 | 249 | 249 |
| Performance | Unused indexes | 492 | 464 | 468 |
| Performance | Multiple permissive policies | 6 | 6 | 6 |

The latest receipt, #663, reported three additional findings in each of the first two security categories and provided no advisor totals or performance counts. The immediate postcheck named both new private tables in the RLS findings and four functions for the definer finding. These included the replacement legacy acquire RPC and the three new definer RPCs. The legacy completion RPC moved to invoker rights. Four unused-index findings named the two new private tables. The differences across the older snapshots cannot establish causes. [Latest advisor notes](./shared-supabase-takeoff-retain-measure-2026-11-26.md#security-advisor-and-production) · [Previous published totals](./shared-supabase-ti711-undo-auth-indexes-2026-11-26.md#advisors-and-production-health)

Production health returned HTTP 200 at 17:34:26 UTC with version `0.9.0` and `db: up`. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

The migration application was the only shared write. Verification covered history, catalog definitions and grants, row counts, advisors and the public health endpoint. Shared checks did not invoke authenticated RPCs, generate an estimate or exercise a concurrency scenario. The schema PR records the qualification on owned stacks. No deployment or feature activation was performed.
