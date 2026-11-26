# Shared database receipt for individual takeoff measure retention · 26 November 2026

Supabase applied the reviewed migration once at 16:12:57 UTC. Nothing was activated and the application consumer was not deployed. The installed verification trigger can now record a stamp when a member verifies a contribution in the released application. [Migration](../../supabase/migrations/20261126154030_takeoff_retain_measure.sql) · [Schema PR #642](https://github.com/thannous/HEX_BC/pull/642)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `ca5ef4eb5141f0e483d12891ea60ccd4f9a41d6a` |
| Name in shared history | `20261126154030_takeoff_retain_measure` |
| Remote version | `20261126161257` |
| Stored SQL | One element, 133,360 bytes including the final newline |
| SHA-256 of the Git file, submitted SQL and stored SQL | `9571b43647a5ea0b87f712500732890a14a0661aca513b21253fe4a733e571bf` |

## Installation checks

History grew from 458 to 459 entries. The three TI-711 entries and the two material-request migrations account for the increase from the previous run's 453 entries. The last prerequisite, `20261126145712_material_request_original_workbooks`, was present at remote version `20261126153052`. All earlier SQL files were accounted for, including the two historical migrations recorded in fragments. The SHA-256 of the ordered JSONB array of version, name and statements for the 458 prior entries was `cb9a3386339bbb41ae907acf9421fec59720f33cd608fb156f3ccfecc8b13271` before and after. [TI-711 receipt and history references](./shared-supabase-ti711-undo-auth-indexes-2026-11-26.md) · [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json)

At 16:10:17, 16:11:23 and 16:12:35 UTC the four new objects in the PR's precheck were absent, the previous writer existed and the three installation relations had zero locks outside the two allowed share modes. All 13 new function signatures, both triggers and the lineage index were absent before application. No takeoff job was processing and the activity check found zero other active statements naming the three replaced functions. No lock retry was needed.

| Shared row counts | Before | After |
| --- | ---: | ---: |
| `takeoff_items` | 10 | 10 |
| `takeoff_item_answers` | 25 | 25 |
| `takeoff_item_review_commands` | 1 | 1 |
| `takeoff_item_answer_decisions` | 0 | 0 |
| `takeoff_jobs` | 5 | 5 |
| `takeoff_completion_activation` | 1 | 1 |
| `takeoff_launch_activation` | 1 | 1 |
| `takeoff_item_list_order_activation` | 1 | 1 |
| `takeoff_plan_dispatch_activation` | 1 | 1 |

## Installed catalog

At 16:13:19 UTC each new private table held zero rows. All listed columns are non-null. Each table has RLS enabled, zero policies and an owner-only ACL. The three client roles have no effective table privileges, and PUBLIC has no grant.

| Private table | Columns | Primary key and cascading foreign keys |
| --- | --- | --- |
| `takeoff_measure_justifications` | `item_id uuid`, `revision text` | PK `item_id` references `public.takeoff_items(id)` |
| `takeoff_retained_measures` | `command_id uuid`, `acknowledged jsonb`, `revision text`, `restored_revision text` | PK `command_id` references `public.takeoff_item_review_commands(id)` |
| `takeoff_measure_lineage` | `answer_id uuid`, `command_id uuid` | PK `answer_id` references `public.takeoff_item_answers(id)`. Its `command_id` references `private.takeoff_retained_measures(command_id)` |

The btree index `takeoff_measure_lineage_command_idx` on `command_id` was valid and ready. Both row triggers were enabled. `record_takeoff_measure_justification` runs after updates of `is_verified`, `verified_at` or `verification_justification`. Its condition requires an authenticated user's own verified row, a timestamp and a justification, and either a fresh verification or a change to one of the three coded reasons. `clear_replaced_measure_lineage` runs after a review command insert when the gesture is `accept_measured`.

All 16 installed function bodies matched the MD5 of their respective SQL source bodies. The ten new private functions have owner-only ACLs. The three new public RPCs grant execution to `authenticated` as their sole non-owner grantee. The three replacements preserved their owner (`postgres`), empty search path, owner-only ACL and security mode. The table-pair and send-plan functions use definer rights, and the proof-lock function uses invoker rights.

| Replaced private function | SHA-256 of definition before | SHA-256 of definition after |
| --- | --- | --- |
| `takeoff_item_table_pairs` | `3d9ecf2fca34ebbbc332110ac411939cc066093c8671412aa16cf2c65042b509` | `45553a2f774e30dcb16f976d00d9b5572ba54bb2f36f6f6365e3d6b9b4f0eb0d` |
| `takeoff_item_send_lock_proofs` | `b0c893de18da6fe7a49af8a50ce07e621b41d2a65f619c3d7da7fff0cbee2858` | `4206298d28798f73c044659d3f2589b7cfb7248a6636e97918275c45cc531ade` |
| `apply_takeoff_item_send_plan` | `d8c6cbc6b818bc070604cbe67fb545dd54f79948a6b9a5273305e61872ce9efe` | `115d5c0e9672e648b3aea3ad52f2348f3a8ba4e18edbc5aea7c6f5f060056316` |

## Security advisor and production

The security advisor reported six new findings. Three cover RLS without policies on the new private tables. Three cover authenticated execution of the security-definer RPCs `read_takeoff_measure_review`, `retain_takeoff_measure` and `read_takeoff_measure_destination_reviews`. These correspond to the reviewed grants and policies. [RLS finding](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) · [RPC finding](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)

Production health returned HTTP 200 with version `0.9.0` and `db: up` after application. Verification used read-only history, catalog, counts and health checks. The migration was the only shared write in this run. [Production health](https://hex-bc.vercel.app/api/health)
