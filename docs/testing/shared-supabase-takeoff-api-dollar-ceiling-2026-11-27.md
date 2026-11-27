# Shared database receipt for the takeoff personal API dollar ceiling · 27 November 2026

Supabase recorded the reviewed migration at 02:47:42 UTC. It makes the sealed dollar ceiling the spending limit for a takeoff request paid with a personal API key. The three routines still record token usage. [Schema PR #684](https://github.com/thannous/HEX_BC/pull/684)

| Migration identity | Value |
| --- | --- |
| Merge commit and checked `origin/main` | `74ccd095772725951b5bc808f1e862a5ff810227` |
| Name in shared history | [`20261126233223_takeoff_api_dollar_ceiling`](../../supabase/migrations/20261126233223_takeoff_api_dollar_ceiling.sql) |
| Remote version | `20261127024742` |
| Stored SQL bytes | 13,305 |
| SHA-256 of Git, manifest, submitted and stored SQL | `30c69d0dd59d05ca35ad33d381fe3c117eb0955b8c9ed7c025625207c3801b8e` |

The production environment configuration and the published migration history identified the shared MCP project. The two preceding migrations used their full file stems as history names. The submitted file included its final newline and Supabase stored it in one `statements` element. [Migration manifest](../../supabase/migrations.manifest.json) · [Shared application procedure](../../supabase/README.md#appliquer-sur-une-base-partagée)

## History and row counts

| Measure | Before · 02:47:32.398369 UTC | After · 02:47:54.782617 UTC |
| --- | ---: | ---: |
| Migration history entries | 468 | 469 |
| Latest remote version | `20261126230927` | `20261127024742` |
| `private.takeoff_api_mandates` | 0 | 0 |
| `private.takeoff_api_calls` | 0 | 0 |
| `private.takeoff_api_budget_stops` | 0 | 0 |
| `public.takeoff_jobs` | 5 | 5 |
| `public.takeoff_launch_requests` | 4 | 4 |

The SHA-256 of the first 467 entries matched the digest in receipt #680, `15e18feb548da716f1119b0140721d51bea2a3e7a7edefdece34b8cd5250d5f7`. The next entry, `20261126193541_takeoff_entry_scope` at `20261126230927`, matched the receipt's name, version, 8,839 bytes and SHA-256. The SHA-256 of all 468 earlier entries was `f985bb544c1bc460e5ff551a26b0457b5842484c4bac6215ba65d32518cd5cee` before and after application. Both digests use the JSONB array of `[version, name, statements]` serialized in version order. [Reference receipt #680](./shared-supabase-takeoff-entry-scope-2026-11-26.md#source-and-migration-order)

All earlier entries matched a migration on `main` by full stem or exact suffix, the documented split migrations, or a version and name pair in the historical inventory. The standalone historical version `20260222` was present. The files for `20260304`, `20260305`, and `20260306` were covered by stored names or suffixes. [Historical inventory](./shared-supabase-packagings-consultation-templates-2026-11-22.json) · [Split migrations](./shared-supabase-main-catchup-2026-11-12.md#anciennes-migrations-représentées-par-des-fragments)

| Other migration merged since receipt #680 | Shared history |
| --- | --- |
| [`20261126230300_catalogue_reference_naming_abbreviations`](../../supabase/migrations/20261126230300_catalogue_reference_naming_abbreviations.sql) ([#679](https://github.com/thannous/HEX_BC/pull/679)) | Absent before and after. It replaces a separate catalogue routine. |

## Precheck and installed functions

Before application, all three `pg_proc.prosrc` values matched the bodies in the original mandate migration byte for byte. The argument lists, including defaults, and return types matched the replacement declarations. All five tables, 37 referenced columns and 16 referenced routines and aggregates were present. [Original mandate migration](../../supabase/migrations/20261126190635_takeoff_personal_api_mandate.sql) · [Mandate receipt #677](./shared-supabase-takeoff-personal-api-mandate-2026-11-26.md)

At 02:46:27.230528 UTC and 02:47:32.398369 UTC, there were zero other transactions or active queries older than five seconds, zero held or awaited locks on the five monitored tables, and zero takeoff jobs in `processing`. The single migration call used the reviewed five-second lock timeout.

After application, each function body matched the reviewed replacement byte for byte and each name resolved to one public function. Before and after, all three functions were owned by `postgres`, used `SECURITY DEFINER` and an empty `search_path`, and had ACL `{postgres=X/postgres,service_role=X/postgres}`. Non-owner `EXECUTE` was limited to `service_role`. `anon`, `authenticated`, and `PUBLIC` lacked `EXECUTE` on each function.

| Routine | SHA-256 of `pg_get_functiondef` before | SHA-256 of `pg_get_functiondef` after |
| --- | --- | --- |
| `public.seal_takeoff_api_mandate(uuid,uuid,uuid,uuid,jsonb)` | `596d34e876d0a524ce4ca09fc012d34071ce9754ea8cf79450576b037bf057af` | `d3c7582ae0bab4ffd70a9b7bbb7f01d77d65f9e6d7b36834c40d73c0f2f62d20` |
| `public.reserve_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,boolean,text,bigint,bigint,boolean,text)` | `f546fbf320ef3f52a27f62f832b0981c658bb63cf37914e3ab5941b0d783c516` | `4440748ff7478af6c763dfd9e15f55412b083b69f2c4e39d535952caf1c8dc44` |
| `public.settle_takeoff_api_call(uuid,uuid,uuid,uuid,uuid,uuid,bigint,bigint)` | `9b21b7c3452f34dfab1cf22030d18180d872175f7aed4c9d53636803058a038c` | `88627f87fd6bb1378fb285fc0bc3ce5c320999dab3adcebb66d4c3907eb962ea` |

## Advisors and production health

Receipt #680 recorded one additional security finding for its new authenticated RPC. The prior performance counts come from receipt #677, the most recent receipt with a performance snapshot. [Security delta in #680](./shared-supabase-takeoff-entry-scope-2026-11-26.md#catalog-and-production-health) · [Advisor snapshot in #677](./shared-supabase-takeoff-personal-api-mandate-2026-11-26.md#advisors-and-production-health)

| Advisor | Finding | Previous receipt | Before | After |
| --- | --- | ---: | ---: | ---: |
| Security | RLS enabled without a policy | 42 | 42 | 42 |
| Security | Authenticated role can execute a SECURITY DEFINER function | 124 | 124 | 124 |
| Security | Leaked password protection | 1 | 1 | 1 |
| Performance | Unindexed foreign keys | 251 | 251 | 251 |
| Performance | Unused indexes | 461 | 463 | 463 |
| Performance | Multiple permissive policies | 6 | 6 | 6 |

The before and after advisor counts matched. The change in unused-index findings since receipt #677 has no established cause.

Production health returned HTTP 200 at 02:47:52.066 UTC with version `0.9.0` and `db: up`. [Production health](https://hex-bc.vercel.app/api/health)

## Limits

This run applied the migration as its only shared write and made no application deployment. Verification covered history, catalog definitions and grants, row counts, advisors, and the public health endpoint. Application journeys, live RPC execution and provider calls were outside the verification scope. The production deployment served commit `d4ef760977cee5b8592aa5dffe92da0d7d4058a2`, which predates #684. The application changes in #684 remain pending deployment. Any database correction requires a new reviewed migration.
