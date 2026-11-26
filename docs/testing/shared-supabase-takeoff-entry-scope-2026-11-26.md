# Shared database precheck for takeoff entry scope · 26 November 2026

**Stopped before application.** Three earlier migrations from [PR #662](https://github.com/thannous/HEX_BC/pull/662) were missing at all three history reads. The run issued zero shared writes. The target has no remote version, nothing was activated, and the application consumer was not deployed. [Schema PR #675](https://github.com/thannous/HEX_BC/pull/675) · [Reviewed SQL](../../supabase/migrations/20261126193541_takeoff_entry_scope.sql)

The reviewed file on `main` at `8584778b8fc6de8e00881f28dfed0fe43cdf85c4` is 8,839 bytes including the final newline. Its SHA-256 is `f2e808518b3a18b3b25ff90327344d00cfb94cd838cf912a63a820b0c6c0f8b0`.

## Migration order

| UTC on 26 November | History rows | Latest remote version | Missing prerequisites |
| --- | ---: | --- | ---: |
| 21:53:28 | 464 | `20261126190542` | 3 |
| 22:03:32 | 464 | `20261126190542` | 3 |
| 22:13:37 | 464 | `20261126190542` | 3 |

The SHA-256 of the ordered JSONB array of version, name and statements was `f1dd1f799ecd69c9bd6f4b981cfd22c1633bfa6995299ddb73b4ebccfcf81de1` on all three reads. Five migrations followed the 459 entries in the [previous takeoff receipt](./shared-supabase-takeoff-retain-measure-2026-11-26.md). Each of those five stored SQL values matched its Git file. The [estimate generation receipt](./shared-supabase-estimate-generation-execution-lock-2026-11-26.md) and the [intake settings receipt](./shared-supabase-intake-ai-request-settings-2026-11-26.md) document the intervening history through version `20261126182537`.

| File after `20261126154030_takeoff_retain_measure` | Shared remote version |
| --- | --- |
| [20261126161733_delete_draft_material_request_lines](../../supabase/migrations/20261126161733_delete_draft_material_request_lines.sql) | 20261126165137 |
| [20261126165318_separate_estimate_generation_execution_lock](../../supabase/migrations/20261126165318_separate_estimate_generation_execution_lock.sql) | 20261126173418 |
| [20261126173222_intake_ai_request_settings](../../supabase/migrations/20261126173222_intake_ai_request_settings.sql) | 20261126182524 |
| [20261126173223_validate_intake_transcription_ai_source](../../supabase/migrations/20261126173223_validate_intake_transcription_ai_source.sql) | 20261126182537 |
| [20261126184348_catalogue_product_reference_naming](../../supabase/migrations/20261126184348_catalogue_product_reference_naming.sql) | 20261126190542 |
| [20261126190635_takeoff_personal_api_mandate](../../supabase/migrations/20261126190635_takeoff_personal_api_mandate.sql) | Absent · prerequisite |
| [20261126190636_validate_takeoff_personal_api_mandate](../../supabase/migrations/20261126190636_validate_takeoff_personal_api_mandate.sql) | Absent · prerequisite |
| [20261126190637_takeoff_personal_api_mark_publication](../../supabase/migrations/20261126190637_takeoff_personal_api_mark_publication.sql) | Absent · prerequisite |
| [20261126193541_takeoff_entry_scope](../../supabase/migrations/20261126193541_takeoff_entry_scope.sql) | Absent · target |

## Database observations

| Relation | 21:53:31 UTC | 22:13:48 UTC |
| --- | ---: | ---: |
| `takeoff_item_entries` | 1 | 1 |
| `takeoff_item_send_parts` | 1 | 1 |
| `takeoff_item_review_events` | 2 | 2 |
| `takeoff_item_review_commands` | 2 | 2 |
| `takeoff_completion_activation` | 1 | 1 |
| `takeoff_launch_activation` | 1 | 1 |
| `takeoff_item_list_order_activation` | 1 | 1 |
| `takeoff_plan_dispatch_activation` | 1 | 1 |

The send-parts table occupied 8 KiB of heap and 120 KiB in total. The review-events table occupied 8 KiB of heap and 72 KiB in total. Both proposed indexes, the trigger, its private function and the public RPC were absent on both catalog reads. The installation lock observations and post-installation checks did not run because the history prerequisite failed.

The two security advisor snapshots had identical finding identities. Production health returned HTTP 200, version `0.9.0`, and `db: up` after the final history read. [Production health](https://hex-bc.vercel.app/api/health)
