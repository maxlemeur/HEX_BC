# Shared database receipt for takeoff personal API mandates · 26 November 2026

Supabase recorded the three reviewed migrations at 22:51:48, 22:51:59, and 22:52:08 UTC in separate transactions. They install the sealed payer mandate and call ledger, validate the job constraint, and use the selected payer's ledger to check takeoff mark publication coverage. [Schema PR #662](https://github.com/thannous/HEX_BC/pull/662)

| Migration identity | Mandate and ledger | Job constraint validation | Mark publication |
| --- | --- | --- | --- |
| Merge commit on `main` | `79223b914ce156ea9c6b44d1199ff117644d0c1d` | `79223b914ce156ea9c6b44d1199ff117644d0c1d` | `79223b914ce156ea9c6b44d1199ff117644d0c1d` |
| Name in shared history | [`20261126190635_takeoff_personal_api_mandate`](../../supabase/migrations/20261126190635_takeoff_personal_api_mandate.sql) | [`20261126190636_validate_takeoff_personal_api_mandate`](../../supabase/migrations/20261126190636_validate_takeoff_personal_api_mandate.sql) | [`20261126190637_takeoff_personal_api_mark_publication`](../../supabase/migrations/20261126190637_takeoff_personal_api_mark_publication.sql) |
| Remote version | `20261126225148` | `20261126225159` | `20261126225208` |
| Stored SQL bytes | 53,739 | 131 | 18,987 |
| SHA-256 of Git, manifest, submitted and stored SQL | `f2fe5aac578f95e34c42d07b58a0ba89568eb6825bcba45f2ac539109294ff90` | `852fdfff9e91ff20eaa578f54baf9bc667a06e8aed5f5665058d28b92f0ee0a9` | `440569a5ca3239d2b97eedd811dffdcf15c8188a274d19a83c89bd21b410cc90` |

Each stored SQL value occupied one `statements` element and included the final newline. The production environment configuration identified the shared MCP project. The precheck used `origin/main` at `8584778b8fc6de8e00881f28dfed0fe43cdf85c4`. The preceding entries used full file stems as names. [Migration manifest](../../supabase/migrations.manifest.json) · [Shared application procedure](../../supabase/README.md#appliquer-sur-une-base-partagée)

## History and row counts

| Measure | Before · 22:51:40.107562 UTC | After · 22:52:15.499063 UTC |
| --- | ---: | ---: |
| Migration history entries | 464 | 467 |
| Latest remote version | `20261126190542` | `20261126225208` |
| `takeoff_jobs` rows | 5 | 5 |
| `takeoff_launch_requests` rows | 4 | 4 |
| `takeoff_item_answer_publications` rows | 2 | 2 |
| `takeoff_item_answers` rows | 25 | 25 |
| `takeoff_item_answer_observations` rows | 13 | 13 |
| `takeoff_items` rows | 10 | 10 |
| `takeoff_results` rows | 4 | 4 |
| `takeoff_count_marks` rows | 0 | 0 |
| `takeoff_count_mark_proposals` rows | 0 | 0 |
| `takeoff_count_mark_twins` rows | 0 | 0 |
| `takeoff_count_mark_attributions` rows | 0 | 0 |
| `takeoff_count_mark_events` rows | 0 | 0 |
| `takeoff_count_answer_pages` rows | 0 | 0 |
| `takeoff_count_answer_states` rows | 1 | 1 |

The SHA-256 of the ordered JSONB array of `[version, name, statements]` through remote version `20261126173418` matched the 461-entry digest in receipt #670, `b262effbfbf5ca7e334eac21e57437f60d397cb1912e535a20af98a85a1a9724`. The next two entries had the names, remote versions, sizes and hashes recorded in #670. Including them, the 463-entry digest was `30b5fea41e887c1495f9104a6193c46fc51cc3ac66c9beaff4c70759082a160e` before and after. The digest of all 464 pre-application entries was `f1dd1f799ecd69c9bd6f4b981cfd22c1633bfa6995299ddb73b4ebccfcf81de1` before and after. [Reference receipt #670](./shared-supabase-intake-ai-request-settings-2026-11-26.md#history-and-row-counts)

Every pre-application entry matched a file on `main` by full stem or suffix, a documented split migration, or a version and name pair in the historical inventory. The standalone historical version `20260222` was present. The standalone versions `20260304`, `20260305`, and `20260306` were absent, with their files covered by stored names or suffixes. The three current names and the earlier forms starting with `20261126173224`, `20261126173225`, and `20261126173226` were absent. [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json) · [Split migrations](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments)

| Other migration merged since receipt #670 | Shared history |
| --- | --- |
| [`20261126184348_catalogue_product_reference_naming`](../../supabase/migrations/20261126184348_catalogue_product_reference_naming.sql) ([#666](https://github.com/thannous/HEX_BC/pull/666)) | Present at `20261126190542`. Its single stored SQL element is 3,058 bytes and matched the Git SHA-256 `5948a722fd5f2551f7f4969817610e6ff5fbbbf934580fc612d0e6a2aa5400eb`. |
| [`20261126193541_takeoff_entry_scope`](../../supabase/migrations/20261126193541_takeoff_entry_scope.sql) ([#675](https://github.com/thannous/HEX_BC/pull/675)) | Absent before and after. Its functions, trigger and indexes are independent of the three applications. |

## Precheck and constraint

The referenced tables, column types, and routine signatures were present. The 16 routines replaced by the migrations matched their preceding Git bodies. The three private tables, two supporting indexes, 14 new routine signatures, three triggers, and job constraint are defined by this delivery. The precheck verified the absence of the new tables, routines, triggers, and constraint. The files add no columns.

The final precheck found zero transactions or active queries older than five seconds, zero long writes, zero held or awaited locks on the job, request, answer, answer observation, and publication tables, and zero jobs in `processing`. A count using the reviewed `CHECK` expression found zero violating rows.

The read at 22:51:54.066515 UTC confirmed 465 history entries, all three new tables, the first migration's 13 new routines, all three enabled triggers, and `takeoff_jobs_api_mandate_shape` with `convalidated = false`. The read at 22:52:03.071613 UTC confirmed 466 history entries and `convalidated = true`. The constraint was still validated after mark publication was installed.

## Installed objects and grants

The installed bodies of all 30 functions matched the reviewed Git SQL by SHA-256 of `pg_proc.prosrc`. The owner is `postgres` for all 30. All 14 new routines have an empty `search_path`.

| New public functions | Security mode | Effective non-owner execution |
| --- | --- | --- |
| `seal_takeoff_api_mandate`, `read_takeoff_api_mandate`, `claim_explicit_takeoff_payment_job`, `reserve_takeoff_api_call`, `settle_takeoff_api_call`, `dispatch_next_takeoff_payment_job`, `recover_takeoff_payment_jobs` | Definer | `service_role` only |

| New private functions | Security mode |
| --- | --- |
| `assert_takeoff_api_scope`, `guard_takeoff_api_request`, `guard_takeoff_api_job` | Definer |
| `takeoff_slot_host_id`, `takeoff_payment_queue_id`, `takeoff_api_request_usage`, `takeoff_count_mark_tile_attempts` | Invoker |

The private routine ACLs are `{postgres=X/postgres}`. `PUBLIC`, `anon`, and `authenticated` lack `EXECUTE` for all 14 new routines. `service_role` also lacks `EXECUTE` for the seven private routines.

All 16 replaced routines retained their owner, security mode, `search_path`, and ACL. `PUBLIC`, `anon`, and `authenticated` lack `EXECUTE` on the two existing activity readers, and `service_role` retained `EXECUTE` on both.

| Replaced routine | Security mode | `search_path` | ACL before and after | SHA-256 of `pg_get_functiondef` before | SHA-256 of `pg_get_functiondef` after |
| --- | --- | --- | --- | --- | --- |
| `private.assert_takeoff_launch_selection(text,jsonb)` | Invoker | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `f5fa811bd698d33c8daca03ef5805da00671bb8fa3dc245efa80ddb0dafd0145` | `8c45f963ba065a60cdc71a3587d5c6dbaff14a6d9a2d08fdd350058854e3e058` |
| `private.follow_takeoff_job_lease()` | Definer | Empty | `{postgres=X/postgres}` | `c0e917684f15c11593678ebffa7af56e105b8d5937ad9bf8e2d2cc4ef2c47559` | `6b27df0ead6b9c403a022de55ba3dc6a375f994acce823de77f5f6d77e5188dc` |
| `private.require_takeoff_host_slot()` | Definer | Empty | `{postgres=X/postgres}` | `4aa8721b7d53a7ac7478388fae62782535828abf226fb9ea781668d606c13c9f` | `427f67cf0f48c61711101598b8e93571bb5f4678bb2b28063ee5daaea1114165` |
| `private.set_takeoff_analysis_outcome()` | Definer | `pg_catalog` | `{postgres=X/postgres,service_role=X/postgres}` | `312bbc36e330f3faac185a056c94eb1d555d28749eaa63e4812a836a858cdaa0` | `5cd51ce1fdcf4a4070f7f52799d52b7951a9d68f010eaa1776894c0345cf8da3` |
| `private.takeoff_count_mark_lease_live(public.takeoff_jobs,uuid)` | Invoker | Empty | `{postgres=X/postgres}` | `24a7d54321c85351ea02c54924aff50991c6158aaeba83d7fec8e05d591aacb1` | `dac7cc7c01574b79f5b216b6f6b75e65729ddd5f7d9c850faca12e5b4dff1f0c` |
| `private.takeoff_host_busy(text,uuid)` | Definer | Empty | `{postgres=X/postgres}` | `b976a6ece5c1c659e52c92cc567af73c5f85314a61e09644b06188a38d11c583` | `5864b040ba2577a0e25180676508358c78b218ceb74a6f48a6442f9e46938a62` |
| `private.takeoff_host_plan_work(text)` | Definer | Empty | `{postgres=X/postgres}` | `67f3c0550fa4d73ee8d52a9cd3d0e2ae5783d5fba26e97a1353b4d5f31a699a4` | `ecb4942e51a2ef75e38b82f07175e9b0558dd541a1a1dc46e2c02269cf845717` |
| `private.takeoff_host_slot_busy(text,uuid)` | Definer | Empty | `{postgres=X/postgres}` | `3949b153c816ae46a93a509aabf958c5de1e9a5dbddf1bbce52c718050d49e0c` | `1574779f8683c0ab0659385f264752431c9f5dcd030701bcb7db1c3a56df9b91` |
| `private.takeoff_launch_mandate_reasons()` | Invoker | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `c562f8da09be828a6728435ada1c562c164cfb82058d49f0bf8e59e487cb9d58` | `02bc7c852196a70405ad28e5c984fb1b9841b5403a34853ba0b235f4a045a713` |
| `private.takeoff_local_host_lock_key(text)` | Invoker | `pg_catalog` | `{postgres=X/postgres}` | `0598ac9d56b28b5b48f4a8f9ae049b6a1ddffed0de258558ea9843ac0e642e5d` | `3638138fc51159b6210418281e058793c43cc3ff5ff79137cd15eaf86d79dcc5` |
| `public.claim_observed_local_takeoff_job(uuid,uuid,text,timestamptz,uuid,timestamptz,text,text,text,integer)` | Definer | `pg_catalog` | `{postgres=X/postgres,service_role=X/postgres}` | `4977207d01de98b36f9f2c451907a547d2ef1ef0f221283503a110bf40e111e1` | `c81a12a41f02592064f20752696638e9e2973dd383ec34f3167aa76322433c72` |
| `public.publish_takeoff_item_answers(uuid,uuid,timestamptz,text,text,jsonb,integer[],jsonb,jsonb,jsonb,jsonb,jsonb)` | Definer | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `759b31a91da9136d62a07edf8850009022b98bf7932059b1d81dc2deab5a7827` | `2dcb112a953047bdeb8b363b45feaaf35befad402b9145e8cea1502f93a58560` |
| `public.read_takeoff_launch_request_units(uuid,uuid,uuid)` | Definer | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `19626fce7d3233621f80fbcbfd44f319a2ca230e4c300e09a80556a9819d5c00` | `ec3d6a3d80cc0c079442eceaa48eb4d48ebbb06538a21697a7679b4b9ff4ef71` |
| `public.read_takeoff_launch_unknown_calls(uuid,uuid,uuid[])` | Definer | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `3b3c3e48b485328569fbc8bd0a437dc350e862854e2578a3b31a286c8b26709b` | `b0a33e564b20a27c76c3fd78fd969ec8487b1a9bde42506bfb355ce45a7fed2b` |
| `public.release_takeoff_host_slot(text,uuid)` | Definer | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `cc690bb801126d30dea166c7cbb4bab21d68dbc9bde1eb48dfb0a701b8b30272` | `ee07cadfea328c3b4396a83e5a972afaa8e189af76127ef4ce906de39a8ce190` |
| `public.reserve_takeoff_launch_call(uuid,uuid,text,text,bigint,boolean)` | Definer | Empty | `{postgres=X/postgres,service_role=X/postgres}` | `a01d7631020428a68e5f21a66a6b9dfb0d7e840692587b82916da7ff820fd2d0` | `a2933e1b3277c4c6605814d662c427837a596568ff92420bc02f5cb6edc2fdc7` |

The three private tables, `takeoff_api_mandates`, `takeoff_api_calls`, and `takeoff_api_budget_stops`, are owned by `postgres`. Each has RLS enabled, zero policies, and zero rows. `PUBLIC`, `anon`, `authenticated`, and `service_role` have no effective table or column privileges. The three primary-key indexes and the two supporting indexes on `takeoff_api_calls` are valid and ready.

| Trigger | Table | Event | Enabled |
| --- | --- | --- | --- |
| `guard_takeoff_api_request` | `public.takeoff_launch_requests` | Before insert or update of `mandate_selection`, `payer_id`, or `execution_host_id` | Origin (`O`) |
| `zz_takeoff_api_job_insert` | `public.takeoff_jobs` | After insert | Origin (`O`) |
| `aa00_takeoff_api_job_update` | `public.takeoff_jobs` | Before update | Origin (`O`) |

## Advisors and production health

| Advisor | Finding | Previous receipt #670 | Before | After |
| --- | --- | ---: | ---: | ---: |
| Security | RLS enabled without a policy | 39 | 39 | 42 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 122 | 123 | 123 |
| Security | Leaked password protection | 1 | 1 | 1 |
| Performance | Unindexed foreign keys | 249 | 249 | 251 |
| Performance | Unused indexes | 467 | 460 | 461 |
| Performance | Multiple permissive policies | 6 | 6 | 6 |

The added RLS findings name the three private tables. Both added unindexed foreign-key findings name `takeoff_api_mandates`. The added unused-index finding names `takeoff_api_calls`. The differences between the previous receipt and the precheck have no established cause. [Previous advisor snapshot](./shared-supabase-intake-ai-request-settings-2026-11-26.md#advisors-and-production-health)

Production health returned HTTP 200 at 22:52:49 UTC with version `0.9.0` and `db: up`. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

The three migration applications were the only shared writes. Verification covered migration history, catalog definitions and grants, row counts, advisors, and the public health endpoint. Application journeys, RPC execution with authenticated users, and provider calls were outside the shared verification scope. This receipt records schema application. Any database correction requires a new reviewed migration. [Schema PR #662](https://github.com/thannous/HEX_BC/pull/662)
