# Shared database receipt for takeoff entry scope · 26 November 2026

Supabase applied `20261126193541_takeoff_entry_scope` at 23:09:27 UTC as remote version `20261126230927`. The run made one migration call. It activated no feature and deployed no application consumer. The new trigger now runs on qualifying inserts from existing clients. [Reviewed schema PR #675](https://github.com/thannous/HEX_BC/pull/675) · [Reviewed SQL](../../supabase/migrations/20261126193541_takeoff_entry_scope.sql)

## Source and migration order

The reviewed merge was `8584778b8fc6de8e00881f28dfed0fe43cdf85c4`. On the fetched `origin/main` at `635876e3ce2959bece11d23f9d79265446c71949`, the target followed all 412 earlier SQL files. The shared migration list covered 410 by full stem or exact suffix and the other two by their documented sets of two and nine fragments. The target was absent. All eight files between the retain-measure migration and this one matched the byte counts and SHA-256 hashes of their stored SQL, including the three prerequisites missing at the previous stop. [Split migration inventory](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments) · [Three prerequisite applications](./shared-supabase-takeoff-personal-api-mandate-2026-11-26.md)

| History measure | Before | After |
| --- | --- | --- |
| Entries | 467 | 468 |
| Latest remote version | `20261126225208` | `20261126230927` |
| SHA-256 of the first 467 entries | `15e18feb548da716f1119b0140721d51bea2a3e7a7edefdece34b8cd5250d5f7` | Identical |

Git, the submitted query and the single stored SQL element were 8,839 bytes including the final newline. Their SHA-256 was `f2e808518b3a18b3b25ff90327344d00cfb94cd838cf912a63a820b0c6c0f8b0`.

## Installation window and counts

At 23:07:05, 23:08:13 and 23:09:17 UTC, there were zero processing takeoff jobs and zero conflicting relation locks on the send parts, review events or entries tables. Both indexes, the trigger and both routines were absent before installation. Before the index builds, send parts occupied 8,192 heap bytes and 122,880 total bytes. Review events occupied 8,192 heap bytes and 73,728 total bytes. The migration completed on its first attempt with the reviewed two-second lock timeout.

| Rows counted | Before | After |
| --- | ---: | ---: |
| `public.takeoff_item_entries` | 1 | 1 |
| `public.takeoff_item_send_parts` | 1 | 1 |
| `public.takeoff_item_review_events` | 2 | 2 |
| `public.takeoff_item_review_commands` | 2 | 2 |
| `private.takeoff_completion_activation` | 1 | 1 |
| `private.takeoff_launch_activation` | 1 | 1 |
| `private.takeoff_item_list_order_activation` | 1 | 1 |
| `private.takeoff_plan_dispatch_activation` | 1 | 1 |

## Catalog and production health

Both indexes were valid and ready. `takeoff_item_send_parts_project_item_idx` indexes `(project_id, item_id)` for live send parts. `takeoff_entry_scope_history_idx` indexes `(tenant_id, project_id, item_id, id DESC)` for review events whose `after->>'scope_action'` is attach, replace or withdraw.

The origin-enabled row trigger `continue_whole_entry_revision` runs before insert on `public.takeoff_item_entries` when the new logical plan ID is null and the new revision is one. It calls the private routine below. Both routines are owned by `postgres`, have an empty `search_path` and match the MD5 of the corresponding function body in Git.

| Routine | Security mode | Non-owner EXECUTE grant | Body MD5 |
| --- | --- | --- | --- |
| `private.continue_takeoff_whole_entry_revision()` | Invoker | None | `6bb3422b33c29239c2552f1c538867f7` |
| `public.change_takeoff_entry_scope(uuid,uuid,uuid,uuid,text,integer,integer,uuid)` | Definer | `authenticated` only | `7bb623b98a21561cb2ea8098e8157c0a` |

The security advisor added one finding for the reviewed grant allowing `authenticated` to execute the new security-definer RPC. Verification used read-only checks and made no call to the command. Production health returned HTTP 200 after application with version `0.9.0` and `db: up`. [Advisor reference](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) · [Production health](https://hex-bc.vercel.app/api/health)
