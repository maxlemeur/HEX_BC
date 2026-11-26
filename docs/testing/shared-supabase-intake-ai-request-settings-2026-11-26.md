# Shared database receipt for intake AI request settings · 26 November 2026

Supabase recorded the two reviewed migrations at 18:25:24 and 18:25:37 UTC, in separate transactions. The first adds the private AI batch and call records, the service RPCs, and the nullable transcription source. The second validates the source check after the first transaction releases its lock. [Schema PR #658](https://github.com/thannous/HEX_BC/pull/658)

| Migration identity | Request settings | Transcription source validation |
| --- | --- | --- |
| Merge commit on `main` | `40f30716d4474b35b12637e02869626d53adc3b8` | `40f30716d4474b35b12637e02869626d53adc3b8` |
| Name in shared history | [`20261126173222_intake_ai_request_settings`](../../supabase/migrations/20261126173222_intake_ai_request_settings.sql) | [`20261126173223_validate_intake_transcription_ai_source`](../../supabase/migrations/20261126173223_validate_intake_transcription_ai_source.sql) |
| Remote version | `20261126182524` | `20261126182537` |
| Stored SQL | One `statements` element, 17,642 bytes | One `statements` element, 326 bytes |
| SHA-256 of Git, submitted and stored SQL | `2f86d7f712b1b3f6af51f30e961e4f32a21005cc93f64c36ac4bae1887922bc8` | `99988082697173a27fdcfe40fe9f24c50c12c9ffc8c8a743f266343f80b3202f` |

Both stored SQL sizes and hashes include the final newline. The two applications followed the full-file-stem naming convention verified on the preceding entry. [Preceding receipt #667](./shared-supabase-estimate-generation-execution-lock-2026-11-26.md)

## History and row counts

| Measure | Before · 18:25:14.667124 UTC | After · 18:25:49.441123 UTC |
| --- | ---: | ---: |
| Migration history entries | 461 | 463 |
| Latest remote version | `20261126173418` | `20261126182537` |
| `affaire_intake_document_transcriptions` rows | 0 | 0 |
| `affaire_intake_uploads` rows | 21 | 21 |
| `affaire_intake_documents` rows | 53 | 53 |

The SHA-256 of the ordered JSONB array of `[version, name, statements]` for the first 460 entries matched the preceding receipt at `1ed5f9745690dbda5ae0c588e358aa0a1e9a0d4d368317d116e13bfc5dfed5c0` on both reads. Including `20261126165318_separate_estimate_generation_execution_lock` at remote version `20261126173418`, the 461-entry digest was `b262effbfbf5ca7e334eac21e57437f60d397cb1912e535a20af98a85a1a9724` on both reads. The two intake entries are the last two in version order.

Each earlier entry matched a file on `main`, a documented split migration, or a version and name pair in the historical inventory. The two intake files were the only pending files. Both restamped stems and their earlier forms beginning with `20261126153210` and `20261126153211` were absent before application. The standalone version `20260222` was present. The standalone versions `20260304`, `20260305`, and `20260306` were absent, with their corresponding files covered by stored names or suffixes. [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json) · [Split migrations](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments) · [Supabase README](../../supabase/README.md#appliquer-sur-une-base-partagée)

| Other file on `main` | Shared history before application | SHA-256 of stored SQL and Git file |
| --- | --- | --- |
| `20261124174040_material_request_original_pdfs` | Present at `20261126153032` | `ca1f4f384d56799abd1e21a44d5a40737778c1bd24f3fe633a69f60bfa416302` |
| `20261126145712_material_request_original_workbooks` | Present at `20261126153052` | `520a0893d22ee3f223225260e39ac9082ca21b8f6130a8a88eaf0eb0cdf056ea` |
| `20261126154030_takeoff_retain_measure` | Present at `20261126161257` | `9571b43647a5ea0b87f712500732890a14a0661aca513b21253fe4a733e571bf` |
| `20261126161733_delete_draft_material_request_lines` | Present at `20261126165137` | `ec832d688237b5373d9da5a2f5b9183ee9c70e05221af57a51c59cf1c246c198` |

Each of these four entries contained one `statements` element that matched its Git file. The applications in this receipt covered only the two intake migrations.

## Prerequisites and installed objects

The precheck found the `private` schema, the three monitored public tables, the referenced project and tenant tables, the required column types, and both intake admission dependencies with their expected return types. The two private tables, nine new routine signatures, `ai_source` column, and named check constraint were absent. The 18:24:11.238502 UTC probe found one relation lock on the monitored tables. The 18:25:14.667124 UTC recheck found zero held or awaited locks on those tables, zero other transactions older than five seconds, and zero other active queries older than five seconds.

Before application, both legacy public RPCs used `SECURITY INVOKER`, and their installed bodies matched the preceding Git definitions. Both use `SECURITY DEFINER` after application. They retained owner `postgres`, their arguments and return types, an empty `search_path`, and ACL `{postgres=X/postgres,service_role=X/postgres}`. [Original claim](../../supabase/migrations/20261124182705_affaire_intake_analysis_launch.sql) · [Original stop](../../supabase/migrations/20261124210748_intake_guarded_brief_and_recovery.sql)

| Legacy public RPC | SHA-256 of `pg_get_functiondef` before | SHA-256 of `pg_get_functiondef` after |
| --- | --- | --- |
| `claim_affaire_intake_analysis_launch(uuid, uuid)` | `9d252d79fb19db45250368d9760eb4d1c2c830bb086bae70a62cc14a1704fc2f` | `b856218c9c3274343ace44a19241c9390fd8d8dbdb393df964d5ee809bb6e2df` |
| `stop_affaire_intake_analysis(uuid, uuid)` | `5f94ee1d9df2be15c3ae1302188a260c5c59a1a3a942e190646fb5cd111d5b68` | `ab26f65d81b83181822feab8dc04a0329fb2f427c4c8c134173dc112fe1d31fd` |

The installed bodies of all 11 functions matched the reviewed file. Each function is owned by `postgres` and has an empty `search_path`. The two legacy and seven new public RPCs use definer rights and grant non-owner `EXECUTE` only to `service_role`. The two private helpers use invoker rights and have owner-only ACLs. `PUBLIC`, `anon`, and `authenticated` lack `EXECUTE` on all 11 signatures.

| New public RPCs | New private helpers |
| --- | --- |
| `start_affaire_intake_ai_batch`, `read_affaire_intake_ai_batch`, `reserve_affaire_intake_ai_call`, `settle_affaire_intake_ai_call`, `finish_affaire_intake_ai_retry`, `claim_affaire_intake_analysis_launch_v2`, `stop_affaire_intake_analysis_v2` | `claim_affaire_intake_analysis_launch(uuid, uuid, boolean)`, `stop_affaire_intake_analysis(uuid, uuid, boolean)` |

Both private tables have RLS enabled, zero policies, and owner-only ACLs. `PUBLIC`, `anon`, `authenticated`, and `service_role` have no table or column privileges. The columns, defaults, primary keys, cascading foreign keys, and checks match the migration. All five indexes were valid and ready.

| Private table | Verified constraints and supporting indexes |
| --- | --- |
| `affaire_intake_ai_batches` | Primary key on `id`, unique `launch_id`, cascading upload and project references, launch identity and budget checks, index on `project_id` |
| `affaire_intake_ai_calls` | Primary key on `id`, cascading batch reference, stage and positive bound checks, index on `batch_id` |

The intermediate read at 18:25:30.589657 UTC found 462 history entries and the nullable `text` column `ai_source`. `affaire_intake_transcriptions_ai_source_check` existed with `convalidated = false`. The final read found the column still nullable and without a default, with `convalidated = true`. The check permits `chatgpt_plan` and `personal_api_key` as non-null values.

## Advisors and production health

| Advisor | Finding | Previous receipt #667 | Before | After |
| --- | --- | ---: | ---: | ---: |
| Security | RLS enabled without a policy | 37 | 37 | 39 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 122 | 122 | 122 |
| Security | Leaked password protection | 1 | 1 | 1 |
| Performance | Unindexed foreign keys | 249 | 249 | 249 |
| Performance | Unused indexes | 468 | 465 | 467 |
| Performance | Multiple permissive policies | 6 | 6 | 6 |

The two new RLS findings name the private intake tables. The two new unused-index findings name their supporting project and batch indexes. The difference in unused-index counts between the preceding receipt and this precheck has no established cause. [Previous advisor snapshot](./shared-supabase-estimate-generation-execution-lock-2026-11-26.md#advisors-and-production-health)

Production health returned HTTP 200 at 18:25:46.882010 UTC with version `0.9.0` and `db: up`. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

The two migration applications were the only shared writes. Verification covered history, catalog definitions and grants, row counts, advisors, and production health. RPC execution, authenticated intake journeys, and concurrency are covered by the qualification on owned stacks. Delivery of the application and activation of its features are separate from the schema receipt. [Schema PR #658](https://github.com/thannous/HEX_BC/pull/658)
