# Shared database receipt for estimate creation · 25 November 2026

The shared database applied the estimate creation migration at 21:05:07 UTC. It updates hierarchy validation, price-origin handling and ancestor lookups in the two installed functions used for atomic estimate creation. [Migration](../../supabase/migrations/20261125185936_estimate_creation_payload_passes.sql) · [PR #610](https://github.com/thannous/HEX_BC/pull/610)

| Migration identity | Verified value |
| --- | --- |
| Merge commit on `main` | `b0deb78c304a1f5e1afa40d43edd31668cd10715` |
| Name in shared history | `20261125185936_estimate_creation_payload_passes` |
| Remote version | `20261125210507` |
| Stored SQL | One application call, one element in `statements`, 4,587 bytes including the final newline |
| SHA-256 of both the Git file and the stored SQL | `44c6f41c59dd81513d95a11ae5f2761eb8a2d44e821fbb2e18a5c081e91c590a` |

## History and row counts

| Measure | Before · 21:04:59 UTC | After · 21:05:25 UTC |
| --- | ---: | ---: |
| Migration history entries | 452 | 453 |
| Latest remote version | `20261125120836` | `20261125210507` |
| Estimate versions | 24 | 24 |
| Estimate items | 2,802 | 2,802 |
| DPGF import confirmations | 1 | 1 |

The digest of the 452 earlier history entries matched across both checks. The precheck found zero pending or parsing imports, zero active statements matching the two functions or import operations, and zero concurrent write locks on the four monitored import and estimate tables.

## Installed functions

| SHA-256 of `pg_get_functiondef` | Before | After |
| --- | --- | --- |
| `public.persist_estimate_creation_atomic(uuid,uuid,uuid,jsonb,jsonb,jsonb,uuid)` | `f4f642e072f816ddd8804da06359271c65303ff77e395a464eb982cae1818b42` | `2e69d694e06ea1a6738fa266d1f179e42db0a41c995ec8e0f1b6394e054209e1` |
| `public.estimate_creation_replay_item_effects_for_writer(uuid,uuid[])` | `ec498731b531068644c6d103c5d46e9bd9b2d76149dad1172f4e53e494eaeb29` | `a90a03a1542ab6e32415a71f87d2164b512df288c229f5df2b40b3abb1017885` |

| Exact fragment counted in the installed function | Before | After |
| --- | ---: | ---: |
| Original hierarchy query | 1 | 0 |
| `public.estimate_fo_price_origin_write_input(p_items)` | 8 | 0 |
| Original insert projection | 1 | 0 |
| Original parent join from `replayed` | 1 | 0 |
| Original parent join from `parent_chain` | 1 | 0 |
| `bool_or(item_type <> 'section')` | 0 | 1 |
| Explicit JSON-null projection at insert | 0 | 1 |
| New lateral join from `replayed` | 0 | 1 |
| New lateral join from `parent_chain` | 0 | 1 |

Both functions retained their signatures, owner (`postgres`), empty `search_path` and ACL (`{postgres=X/postgres,service_role=X/postgres}`). The creation writer runs as invoker and the replay function runs as definer.

The security and performance advisors returned zero findings for either function before and after application. The production health endpoint returned HTTP 200, application version 0.9.0 and database status `up` at both checks. [Production health](https://hex-bc.vercel.app/api/health)
