# Reorder and move of ~1 000 siblings in a v1/v2 draft

18–19/10/2026. `public.reorder_estimate_items` and `public.move_estimate_item` rewrite every sibling of the parents
they touch, twice (a negative position first: the unique position indexes forbid a single pass). Each written row ran
the per-row effects of `estimate_items` under the API roles' RLS: one content revision step of the version (an
`estimate_versions` update and its audit row), one item audit row, the source coverage check and the BEFORE guards.
On main, as `authenticated` (« Validation »), reversing a v2 section of 1 000 lines took 5,4 s and moving a line between
sections of 1 000 and 999 lines 12 s: the latter is over the 8 s `statement_timeout` of the API roles even locally
(the API answered 400, `57014`, and nothing moved). The RLS helpers of the policies and invoker guards came first, then
the per-row audit and bump (an earlier measurement as `postgres`, note `row-limit-reads-reorder-move-cost.md` of the
row-limit-reads session, put ~80 % of a reorder in the bump).

## Observable failures, written before the fix

| # | Failure | Where it shows | Check |
| --- | --- | --- | --- |
| RO1 | Reordering all the lines of a section of 1 000 lines of a v2 draft exceeds the 8 s timeout in CI: 400, nothing moves | `POST /api/estimates/{id}/items/reorder` | journey RM01 |
| RO2 | Moving a line out of a section of 1 000 lines into another section (both lists renumbered twice) exceeds it too, between two sections of ~1 000 lines even locally | `POST /api/estimates/{id}/items/move` | journey RM02 (into 3 lines), RM04 (into 999 lines) |
| RO3 | The fix changes what the operations store: final positions and parents, the content revision (one step per written row that changes), the item audit rows (one `UPDATE` row per write, with its before and after rows), the version audit rows (one per revision step), the actor of every audit row, the source coverage invalidation of a moved item and its descendants, the stored totals | SQL after each operation | RM01–RM04 (counts, positions, actor, totals); pgTAP equivalence with the per-row path on the same tree (every audit row compared, coverage revisions, positions) |
| RO4 | A small reorder or move (the everyday case) stores something else than before | SQL | RM03 (control, green before the fix); pgTAP equivalence |
| RO5 | Authorizing once instead of per row lets someone write who could not, or refuses someone the policy admitted: a viewer, a director, an engineer on another engineer's affaire, a member of another tenant, a caller without user, the owner of a suspended tenant, any caller on a version that is no longer a draft, calling the RPC directly through PostgREST; an admin of the tenant and a platform admin keep their access | `POST /rest/v1/rpc/…` | pgTAP, every refused caller writes nothing (positions, revision, audit) |
| RO6 | The bypass of the per-row effects leaks: it survives the call (a later write in the same transaction is not journaled or does not bump), it applies to another version, to an insert or a delete, or a caller can call the replay directly | SQL | pgTAP |
| RO7 | A refusal of `move_estimate_item` (stale list, target in its own subtree, depth exceeded, invalid parent…) changes its message or writes something | API 400/409 | pgTAP (messages unchanged, nothing written) |
| RO8 | Reorder or move stops working on a v3 draft (the default engine since M8; the editor's undo reorders), or stores something else there | v3 editor, SQL | existing journey `engine-v3-editor-actions` (reorder held then released); pgTAP equivalence on two v3 drafts |
| RO9 | The statement gets slower again without timing out locally | — | opt-in pgTAP budget, interactive tier: median of 7 rolled-back runs in WSL ≤ 400 ms ([budget](large-estimate-statement-budget.md), L8) |

Out of scope: the reads that check the sibling lists (fixed by `readAllRows`, 33c7031b), the other bulk writers of
`estimate_items` (`bulk_update_estimate_items`, line creation in a large v2).

## Scenarios

Journey [`e2e/army/local/estimate-reorder-move-large-v2.e2e.ts`](../../e2e/army/local/estimate-reorder-move-large-v2.e2e.ts),
on the owned native stack; the large sections are seeded in SQL, every outcome is read back in SQL.

| Scenario | Request | Expected |
| --- | --- | --- |
| RM01 | reverse the 1 000 lines of a section | 200, `updated_count` 1 000, the lines in the requested order at positions 1…1 000, content revision + 2 000, 2 000 item `UPDATE` audit rows (1 000 with a negative position after), 2 000 version `UPDATE` audit rows with consecutive revisions, every audit row by the owner, nothing else journaled, totals unchanged |
| RM02 | move line 1 of a section of 1 000 lines to position 2 of a section of 3 lines | 200, `updated_count` 1 003, both lists in the requested order, revision + 2 006 (999 + 3 + 1 + 999 + 4 writes), as many item and version audit rows, owner, totals unchanged |
| RM03 | control: reverse a section of 12 lines, then move its first line into a section of 3 lines | the same formulas at 12 and 3 lines |
| RM04 | move line 1 of a section of 1 000 lines to position 500 of a section of 999 lines | 200, `updated_count` 1 999, both lists in the requested order, revision + 3 998 (999 + 999 + 1 + 999 + 1 000 writes), as many item and version audit rows, owner, totals unchanged |

## Change

Migration [`20261018204500_estimate_item_order_set_based_effects.sql`](../../supabase/migrations/20261018204500_estimate_item_order_set_based_effects.sql).
No route, schema or OpenAPI change: both RPCs keep their signatures, results and refusals.

1. **Authorized once.** `public.reorder_estimate_items` and `public.move_estimate_item` become `security definer`
   (`search_path` empty). `private.estimate_item_order_writer_tenant` checks once what the update policy of
   `estimate_items` (« Users can update draft estimate items ») checked per row: the version exists and is a draft, the
   caller is a member of its active tenant with the admin or engineer role, and owns the affaire unless admin (the
   policy helpers keep the platform admin exception). A refused caller gets `42501 ESTIMATE_ITEM_ORDER_FORBIDDEN`
   (before: its rows were invisible and nothing was written); a version that is no longer a draft gets
   `42501 ESTIMATE_VERSION_READ_ONLY`. Rows stay restricted to the version's tenant, as the policy did. `auth.uid()`
   still names the caller. Execution is granted to `authenticated` only (before: also `anon` and `service_role`,
   through the default privileges).
2. **Same statements.** Each RPC runs its updates as before (the negative pass, then the final one), after locking the
   rows it writes. The negative pass returns the row before and after each update; the final pass returns the new row
   and pairs it with the row the negative pass returned (locked, nothing else writes it in between).
3. **Per-row effects written once.** Around those updates the RPC binds `miaouffrage.estimate_item_order_atomic` to the
   version (`set_config` local, previous value restored). Under it, and only for the `UPDATE` of an item that stays in
   that version: `bump_estimate_content_revision_from_item` and `log_estimate_audit` return at once, and
   `private.source_coverage_invalidate` returns at once when the old row with the new position and `updated_at` equals
   the new row (neither column is technical, so it would have found nothing to invalidate).
   `private.estimate_item_order_replay_effects` then writes what the bump and the item audit wrote: one content
   revision step per write that changes the row beyond `updated_at` (same draft check and refusals), as one update of
   +N under the creation replay pair of M6b (20261018013249: the version guard admits that single upward step on a
   draft and the version audit leaves its rows to the replay), N version audit rows with consecutive revisions, and one
   item audit row per write, with the users, tenants and before/after rows the triggers wrote. Audit rows carry a
   random id and `now()`: their order is not observable, only the rows are, so none is imposed.
4. **Unchanged per row:** the BEFORE guards, the hierarchy depth guard (only the moved item changes parent) and the
   coverage invalidation of a moved item and its descendants. Lock order is unchanged: reorder locks its rows, then
   the version; move locks the version first.

Not reused: `estimate_creation_replay_item_effects_for_writer` journals inserts, and its parent walk is bounded; no
parent chain is replayed here.

Known differences: a direct RPC call by a caller the policy refused now fails with `42501` instead of updating no row
(the API checks access before calling); a call on an unknown version answers `ESTIMATE_ITEM_ORDER_FORBIDDEN` instead
of `target_version_id is invalid` (move) or 0 (reorder); a second move in the same transaction no longer fails on its
temporary tables (`relation "_move_source_order" already exists`, found by the pgTAP reference run; the API makes one
move per request). `log_estimate_audit`, `bump_estimate_content_revision_from_item` and
`private.source_coverage_invalidate` are copied from 20261018013249 with only the marked lines added: a later migration
that copies them from an older body would drop the bypass, and the every-run pgTAP (52 against 4 version updates) fails.

## Validation

Owned native stack in WSL (Ubuntu 24.04, Supabase CLI 2.120.0, PostgreSQL 17.11, Node 24.19.0), 18–19/10/2026. The
final runs use base `d90e158d` (main after #72) with and without this change; earlier iterations used `708ae88d`. Each
phase is a `e2e:army:dev-loop` session (one stack; its migrations, every pgTAP file and the RLS matrix run once at its
start; iterations are not qualification runs). SQL probes run through psql on the same stack, each run rolled back:
`.codex-tmp/reorder-move/probe-profile.sql` (as the owner through `authenticated`, and as `postgres` with the owner's
claims, a local script that is not committed; the budget file reproduces the timings), the pgTAP and budget files.
Retained evidence (manifests, logs, business artifacts): `.codex-tmp/reorder-move/` of the worktree.

| Check | main | this change |
| --- | --- | --- |
| Loop start: migrations, pgTAP, RLS matrix | passed | passed, 28 files, 2 045 tests, the new file included |
| `estimate-order-items-atomic.test.sql` | red: 52 against 40 version updates, refused callers not refused, replay missing (and a second move in the transaction failed on its temporary tables) | 38/38 (v2 and v3 equivalence, callers, contract, refusals) |
| RM01 reverse 1 000 lines | 200 in 4 462 ms (3 177–5 616 over the iterations), effects as expected | 200 in 527 ms, same effects |
| RM02 move 1 000 → 3 lines | 200 in 4 908 ms (3 733 earlier), effects as expected | 200 in 687 ms, same effects |
| RM03 control | passed | passed, same effects |
| RM04 move 1 000 → 999 lines | **400 `BAD_REQUEST`, `57014` after 8 429 ms, nothing written** | 200 in 1 210 ms (986 ms in an earlier loop), same effects |
| `bulk-move`, `engine-v3-editor-actions` (reorder on a v3 draft) | — | passed (1 and 15 tests) |

### Statement profile (median of 3 rolled-back runs, ms)

| Statement | main, `authenticated` | main, `postgres` | change, `authenticated` | change, `postgres` | `estimate_versions` updates |
| --- | --- | --- | --- | --- | --- |
| reorder 1 000 lines (2 000 writes, 4 000 audit rows) | 5 358 | 1 490 | 324 | 333 | 2 000 → 1 |
| move 1 000 → 3 lines (2 006 writes, 4 012 audit rows) | not profiled (request 4 908) | — | 358 | 344 | 2 006 → 1 |
| move 1 000 → 999 lines (3 998 writes, 7 996 audit rows) | **11 965** | 4 384 | 678 | 689 | 3 998 → 1 |

On main, as `authenticated`, the RLS helpers dominated (`is_tenant_member` 150 292 calls for the reorder, 301 309 for
the large move), then the per-row audit and bump. With the change, the time is the two passes of row writes with their
BEFORE guards (~90 ms per 1 000 writes) and the audit rows the contract keeps (2 000 version and 2 000 item audit rows
take ~90 and ~110 ms to insert on their own): both scale with the rows written, not with RLS. The first working
version measured 474–514 ms for the reorder; the coverage exit on a position-only update (460 → 420 ms in a paired
run with a JSON comparison, then ~350 ms with the row comparison) and no second read of the row the final pass
replaces brought it to the figures above.

### Budget

Interactive tier of [large-estimate-statement-budget.md](large-estimate-statement-budget.md) (L8): local WSL median of
7 rolled-back runs ≤ 400 ms. Final migrated stack, load average 1,4, two runs of the budget file: reorder 352 and
376 ms, move 1 000 → 3 355 and 347 ms (both asserted, passed), move 1 000 → 999 726 and 685 ms (reported). At the
planning factor 4 of that page, 400 ms is 1,6 s in CI and 726 ms 2,9 s, under the 8 s timeout.

### Red evidence

On main, RM04 fails locally (400, `57014`, nothing written): the same timeout the CI would hit on RM01 and RM02, whose
statements took 5,4 s and ~5 s locally and pass the local 8 s only because the local machine is unloaded. No filtered
CI dispatch on main was run: it needs a separate push that was not part of the authorized delivery.

## Limits

- The move between two sections of ~1 000 lines (RM04) writes ~4 000 rows and ~8 000 audit rows: ~0,7 s locally,
  over the interactive tier of 400 ms but within the timeout at the planning factor. Going lower needs fewer stored
  rows (the negative pass is required by the unique position indexes, each write keeps its audit row), which is a
  change of what is stored.
- Wall-clock figures come from one loaded workstation; see the calibration limits of the budget page.
- `bulk_update_estimate_items` and line creation in a large v2 keep their per-row effects.
- The coverage check compares whole rows: a future `estimate_items` column of a type without equality (`json`, not
  `jsonb`) would make it fail at run time; the every-run pgTAP would show it.
</content>
