import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { assertOwnedLocalBackend, createdData, type Envelope } from "./legacy-v1-draft-support";

// Reorder and move of ~1 000 siblings in a v2 draft, docs/testing/reorder-move-large-v2.md. Observable failures,
// written before the fix. Both RPCs rewrite every sibling of the parents they touch twice (a negative position first),
// and every written row ran the per-row effects of estimate_items under the API roles' RLS: a content revision step
// of the version with its audit row, an item audit row, the coverage check and the BEFORE guards. About 1 000
// siblings exceed the 8 s statement_timeout at the CI load factor (57014): the API answers 400 and nothing moves.
//  RM01  Reversing the 1 000 lines of a section.
//  RM02  Moving line 1 of a section of 1 000 lines to position 2 of a section of 3 lines (both lists rewritten).
//  RM04  Moving line 1 of a section of 1 000 lines to position 500 of a section of 999 lines (~4 000 row writes): it
//        exceeded the timeout even locally before the fix.
// Each must answer 200 and store the requested positions, with what the per-row effects stored: one content revision
// step per written row (every write changes a position), one item UPDATE audit row per write (its after row carrying
// the negative position of the first pass, then the final one), one version UPDATE audit row per revision step with
// consecutive revisions, all journaled under the requesting user, and unchanged totals.
//  RM03  Control, green before the fix: the same effects for a section of 12 lines reversed, then its first line moved
//        into a section of 3 lines.
// The large sections are seeded in SQL on the owned native stack, in transactions of at most SEED_BATCH rows.
const options = { session: "army", tags: ["critical", "local", "reorder-move-large"], timeout: 300_000 } as const;
type Triple = [number, number, number];
type Created = { project: { id: string }; version: { id: string } };
type Seeded = { sectionId: string; lineIds: string[] };
type Reordered = { updated_count: number };
type Moved = { updated_count: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^ARMY-[A-Za-z0-9-]{1,80} [a-z ]{1,40}$/;
const SEED_BATCH = 250;
// Fixed margin x1, 20 % VAT, no discount, no rounding: a line's stored totals are its v2 totals.
const NEUTRAL_V2 = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 3,
  currency: "EUR", contractor_role: "principal", expected_calc_engine_version: 2,
};
// Line g (position g) of a seeded section: 1 u at 5·g cents, no hours, so 5·g HT, g VAT and 6·g TTC.
const range = (from: number, to: number): Triple => {
  const base = ((from + to) * (to - from + 1)) / 2;
  return [5 * base, base, 6 * base];
};
const add = (a: Triple, b: Triple): Triple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const responseOf = (response: { status: number; body: Envelope<unknown> }) =>
  [response.status, response.body.ok, response.body.error?.code ?? null];

/** Wall-clock time of a seed or of one request (its reads and the RPC), recorded only. */
async function timed<T>(request: () => Promise<T>) {
  const started = Date.now();
  const result = await request();
  return { result, ms: Date.now() - started };
}

async function retakeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect([200, 201]).toContain(lease.status);
}

/** An owned affaire with a v2 draft of neutral settings. */
async function v2Draft(browser: Browser, army: ArmyState, label: string) {
  assertOwnedLocalBackend();
  const created = await createdData(await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
    project: { name: `ARMY-RM-${label}-${army.runPrefix}` }, version: { ...NEUTRAL_V2, title: `${army.runPrefix} ${label}` },
  }));
  const projectId = created.project.id;
  const versionId = created.version.id;
  ownEstimate(army, { projectId, versionId });
  const owner = await ownedEstimateContext(projectId);
  return { projectId, versionId, owner };
}

/**
 * Root sections written in SQL after the root items of a v2 draft, in this order: section `${label} s` holding
 * `lines[s-1]` lines, its line g (position g) titled `${label} s ligne g`. In transactions of at most SEED_BATCH rows.
 */
async function seedSections(tenantId: string, versionId: string, label: string, lines: number[]): Promise<Seeded[]> {
  if (!UUID.test(tenantId) || !UUID.test(versionId) || !LABEL.test(label) || lines.length < 1 || lines.length > 4 ||
    !lines.every((count) => Number.isSafeInteger(count) && count >= 1 && count <= 1000)) {
    throw new Error("Invalid seeded sections input.");
  }
  const ids = lines.map(() => randomUUID());
  const ofVersion = `v.id = '${versionId}'::uuid AND v.tenant_id = '${tenantId}'::uuid AND v.calc_engine_version = 2`;
  const nextRoot = "(SELECT coalesce(max(r.position), 0) FROM public.estimate_items r WHERE r.version_id = v.id AND r.parent_id IS NULL)";
  const runs = (count: number) => Array.from({ length: Math.ceil(count / SEED_BATCH) }, (_, index) =>
    [index * SEED_BATCH + 1, Math.min(count, (index + 1) * SEED_BATCH)] as const);
  for (const [index, count] of lines.entries()) {
    await querySql(`INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
SELECT '${ids[index]}'::uuid, v.tenant_id, v.id, 'section', ${nextRoot} + 1, '${label} ${index + 1}'
FROM public.estimate_versions v WHERE ${ofVersion};
`);
    for (const [from, to] of runs(count)) {
      await querySql(`BEGIN;
INSERT INTO public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
SELECT s.tenant_id, s.version_id, s.id, 'line', g, s.title || ' ligne ' || g, 'u', 1, 5 * g, 2000, 1, 0, 1, 1,
  5 * g, 5 * g, g, 6 * g
FROM public.estimate_items s CROSS JOIN generate_series(${from}, ${to}) AS g
WHERE s.id = '${ids[index]}'::uuid
ORDER BY g;
COMMIT;
`);
    }
  }
  // One read per section: querySql keeps the last 64 KiB of output, about 1 600 ids.
  const seeded: Seeded[] = [];
  for (const id of ids) {
    const output = await querySql(`SELECT jsonb_build_object('sectionId', s.id,
  'lineIds', coalesce((SELECT jsonb_agg(l.id ORDER BY l.position) FROM public.estimate_items l WHERE l.parent_id = s.id), '[]'))
FROM public.estimate_items s WHERE s.id = '${id}'::uuid;
`);
    if (output.length) seeded.push(JSON.parse(output.at(-1)!) as Seeded);
  }
  if (seeded.length !== lines.length || seeded.some((section, index) => section.sectionId !== ids[index] ||
    section.lineIds.length !== lines[index])) throw new Error("The seeded v2 sections were not persisted.");
  return seeded;
}

/** Stores the totals of the seeded lines on the version, as the recalculation would: the SQL seed bypasses it. */
async function storeSeededTotals(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  await querySql(`UPDATE public.estimate_versions v SET total_ht_cents = t.ht, total_tax_cents = t.tax, total_ttc_cents = t.ttc
FROM (SELECT coalesce(sum(line_total_ht_cents), 0) AS ht, coalesce(sum(line_tax_cents), 0) AS tax, coalesce(sum(line_total_ttc_cents), 0) AS ttc
  FROM public.estimate_items WHERE version_id = '${versionId}'::uuid AND item_type = 'line') AS t
WHERE v.id = '${versionId}'::uuid AND v.calc_engine_version = 2 AND v.status = 'draft';
`);
}

/** The children of a parent as SQL stores them: whether their ids by position are `expected`, count, distinct positions and bounds. */
async function children(sectionId: string, expected: string[]) {
  if (!UUID.test(sectionId)) throw new Error("Invalid section identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('ids', coalesce(jsonb_agg(id ORDER BY position, id), '[]'),
  'count', count(*), 'distinctPositions', count(DISTINCT position),
  'positions', jsonb_build_array(min(position), max(position)))
FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid;
`);
  const { ids, ...stored } = JSON.parse(row) as { ids: string[]; count: number; distinctPositions: number; positions: [number | null, number | null] };
  return { inRequestedOrder: JSON.stringify(ids) === JSON.stringify(expected), ...stored };
}

/** The version as SQL stores it: engine, stored totals, its line count and the sums of its line totals. */
async function versionTruth(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('engine', v.calc_engine_version,
  'stored', jsonb_build_array(v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents), 'lines', count(i.id),
  'lineSums', jsonb_build_array(coalesce(sum(i.line_total_ht_cents), 0), coalesce(sum(i.line_tax_cents), 0), coalesce(sum(i.line_total_ttc_cents), 0)))
FROM public.estimate_versions v LEFT JOIN public.estimate_items i ON i.version_id = v.id AND i.item_type = 'line'
WHERE v.id = '${versionId}'::uuid GROUP BY v.id;
`);
  return JSON.parse(row) as { engine: number; stored: Triple; lines: number; lineSums: Triple };
}

/** The content revision of a version and the newest audit timestamp journaled for it, to compare around one request. */
async function revisionMark(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('revision', v.content_revision,
  'lastAuditAt', (SELECT max(a.created_at) FROM public.audit_logs a WHERE a.estimate_version_id = v.id))
FROM public.estimate_versions v WHERE v.id = '${versionId}'::uuid;
`);
  return JSON.parse(row) as { revision: number; lastAuditAt: string | null };
}

/**
 * What one request journaled for a version: the revision delta; its item UPDATE audit rows (count, distinct items,
 * after rows with a negative then a positive position); its version UPDATE audit rows (count, and whether their after
 * revisions are exactly the consecutive steps from the revision before the request); every other audit row; the users.
 */
async function effectsSince(versionId: string, before: Awaited<ReturnType<typeof revisionMark>>) {
  if (!UUID.test(versionId) || !Number.isSafeInteger(before.revision)) throw new Error("Invalid effects input.");
  const after = await revisionMark(versionId);
  const since = before.lastAuditAt ? `AND a.created_at > '${before.lastAuditAt}'::timestamptz` : "";
  const [row] = await querySql(`WITH journal AS (
  SELECT a.* FROM public.audit_logs a WHERE a.estimate_version_id = '${versionId}'::uuid ${since}
), items AS (
  SELECT * FROM journal WHERE table_name = 'estimate_items' AND action = 'UPDATE'
), versions AS (
  SELECT (after_data->>'content_revision')::bigint AS revision, (before_data->>'content_revision')::bigint AS previous
  FROM journal WHERE table_name = 'estimate_versions' AND action = 'UPDATE'
)
SELECT jsonb_build_object(
  'itemUpdates', (SELECT count(*) FROM items),
  'items', (SELECT count(DISTINCT record_id) FROM items),
  'negativeAfter', (SELECT count(*) FROM items WHERE (after_data->>'position')::int < 0),
  'positiveAfter', (SELECT count(*) FROM items WHERE (after_data->>'position')::int > 0),
  'versionUpdates', (SELECT count(*) FROM versions),
  'consecutiveSteps', (SELECT count(*) = count(DISTINCT revision) AND bool_and(revision = previous + 1)
      AND min(revision) = ${before.revision} + 1 AND max(revision) = ${before.revision} + count(*) FROM versions),
  'otherRows', (SELECT count(*) FROM journal WHERE NOT (action = 'UPDATE' AND table_name IN ('estimate_items', 'estimate_versions'))),
  'actors', (SELECT coalesce(jsonb_agg(DISTINCT user_id), '[]') FROM journal));
`);
  const journaled = JSON.parse(row) as {
    itemUpdates: number; items: number; negativeAfter: number; positiveAfter: number; versionUpdates: number;
    consecutiveSteps: boolean | null; otherRows: number; actors: string[];
  };
  return { revisions: after.revision - before.revision, ...journaled };
}

/** The effects of `writes` row writes over `items` distinct items, `firstPass` of them in the negative pass. */
const effectsOf = (writes: number, items: number, firstPass: number, actor: string) => ({
  revisions: writes, itemUpdates: writes, items, negativeAfter: firstPass, positiveAfter: writes - firstPass,
  versionUpdates: writes, consecutiveSteps: true, otherRows: 0, actors: [actor],
});

async function reorder(browser: Browser, versionId: string, parentId: string, orderedIds: string[]) {
  return timed(() => apiRequest<Envelope<Reordered>>(browser, "POST", `/api/estimates/${versionId}/items/reorder`,
    { parent_id: parentId, ordered_ids: orderedIds }));
}

async function move(browser: Browser, versionId: string, body: {
  item_id: string; from_parent_id: string; to_parent_id: string; ordered_source_ids: string[]; ordered_target_ids: string[];
}) {
  return timed(() => apiRequest<Envelope<Moved>>(browser, "POST", `/api/estimates/${versionId}/items/move`, body));
}

armyTest("RM01 the 1 000 lines of a section of a v2 draft are reversed with their per-row effects", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const lines = 1000;
    const { versionId, owner } = await v2Draft(browser, army, "reorder");
    const { result: [section], ms: seedMs } = await timed(() => seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [lines]));
    await storeSeededTotals(versionId);
    const reversed = [...section.lineIds].reverse();
    await retakeLease(browser, versionId);
    const before = await revisionMark(versionId);
    const { result: response, ms } = await reorder(browser, versionId, section.sectionId, reversed);
    const observed = {
      response: responseOf(response),
      updated: response.body.data?.updated_count ?? null,
      section: await children(section.sectionId, reversed),
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "rm01-reverse-1000-lines", { versionId, sectionId: section.sectionId,
      elapsedMs: { seed: seedMs, reorder: ms }, error: response.body.error ?? null, observed });
    expect(observed).toEqual({
      response: [200, true, null],
      updated: lines,
      section: { inRequestedOrder: true, count: lines, distinctPositions: lines, positions: [1, lines] },
      sql: { engine: 2, stored: range(1, lines), lines, lineSums: range(1, lines) },
      effects: effectsOf(2 * lines, lines, lines, owner.userId),
    });
  });

armyTest("RM02 a line moved out of a section of 1 000 lines into a section of 3 lines rewrites both with their per-row effects",
  options, async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "move");
    const { result: [source, target], ms: seedMs } = await timed(() =>
      seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [1000, 3]));
    await storeSeededTotals(versionId);
    const movedId = source.lineIds[0];
    const orderedSource = source.lineIds.slice(1);
    const orderedTarget = [target.lineIds[0], movedId, ...target.lineIds.slice(1)];
    await retakeLease(browser, versionId);
    const before = await revisionMark(versionId);
    const { result: response, ms } = await move(browser, versionId, {
      item_id: movedId, from_parent_id: source.sectionId, to_parent_id: target.sectionId,
      ordered_source_ids: orderedSource, ordered_target_ids: orderedTarget,
    });
    const observed = {
      response: responseOf(response),
      updated: response.body.data?.updated_count ?? null,
      source: await children(source.sectionId, orderedSource),
      target: await children(target.sectionId, orderedTarget),
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "rm02-move-out-of-large-section", { versionId, sourceId: source.sectionId,
      targetId: target.sectionId, movedId, elapsedMs: { seed: seedMs, move: ms }, error: response.body.error ?? null, observed });
    const all = add(range(1, 1000), range(1, 3));
    // Writes: the 999 source siblings and the 3 target siblings to their negative positions, the moved line into the
    // target, the 999 source siblings and the 4 target items to their final positions.
    expect(observed).toEqual({
      response: [200, true, null],
      updated: 999 + 4,
      source: { inRequestedOrder: true, count: 999, distinctPositions: 999, positions: [1, 999] },
      target: { inRequestedOrder: true, count: 4, distinctPositions: 4, positions: [1, 4] },
      sql: { engine: 2, stored: all, lines: 1003, lineSums: all },
      effects: effectsOf(999 + 3 + 1 + 999 + 4, 1003, 999 + 3 + 1, owner.userId),
    });
  });

armyTest("RM03 a section of 12 lines reversed, then its first line moved into a section of 3 lines, keep their per-row effects (control)",
  options, async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "small");
    const [source, target] = await seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [12, 3]);
    await storeSeededTotals(versionId);
    await retakeLease(browser, versionId);
    const reversed = [...source.lineIds].reverse();
    const beforeReorder = await revisionMark(versionId);
    const { result: reordered, ms: reorderMs } = await reorder(browser, versionId, source.sectionId, reversed);
    const afterReorder = { response: responseOf(reordered), updated: reordered.body.data?.updated_count ?? null,
      section: await children(source.sectionId, reversed), effects: await effectsSince(versionId, beforeReorder) };
    const movedId = reversed[0];
    const orderedTarget = [...target.lineIds, movedId];
    const beforeMove = await revisionMark(versionId);
    const { result: moved, ms: moveMs } = await move(browser, versionId, {
      item_id: movedId, from_parent_id: source.sectionId, to_parent_id: target.sectionId,
      ordered_source_ids: reversed.slice(1), ordered_target_ids: orderedTarget,
    });
    const afterMove = { response: responseOf(moved), updated: moved.body.data?.updated_count ?? null,
      source: await children(source.sectionId, reversed.slice(1)), target: await children(target.sectionId, orderedTarget),
      effects: await effectsSince(versionId, beforeMove) };
    const observed = { afterReorder, afterMove, sql: await versionTruth(versionId) };
    await recordEvidence(army, "rm03-small-reorder-move-control", { versionId, sourceId: source.sectionId,
      targetId: target.sectionId, movedId, elapsedMs: { reorder: reorderMs, move: moveMs }, observed });
    const all = add(range(1, 12), range(1, 3));
    expect(observed).toEqual({
      afterReorder: {
        response: [200, true, null], updated: 12,
        section: { inRequestedOrder: true, count: 12, distinctPositions: 12, positions: [1, 12] },
        effects: effectsOf(24, 12, 12, owner.userId),
      },
      afterMove: {
        response: [200, true, null], updated: 11 + 4,
        source: { inRequestedOrder: true, count: 11, distinctPositions: 11, positions: [1, 11] },
        target: { inRequestedOrder: true, count: 4, distinctPositions: 4, positions: [1, 4] },
        effects: effectsOf(11 + 3 + 1 + 11 + 4, 15, 11 + 3 + 1, owner.userId),
      },
      sql: { engine: 2, stored: all, lines: 15, lineSums: all },
    });
  });

armyTest("RM04 a line moved between two sections of about 1 000 lines rewrites both with their per-row effects",
  options, async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "move-large");
    const { result: [source, target], ms: seedMs } = await timed(() =>
      seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [1000, 999]));
    await storeSeededTotals(versionId);
    const movedId = source.lineIds[0];
    const orderedSource = source.lineIds.slice(1);
    const orderedTarget = [...target.lineIds.slice(0, 499), movedId, ...target.lineIds.slice(499)];
    await retakeLease(browser, versionId);
    const before = await revisionMark(versionId);
    const { result: response, ms } = await move(browser, versionId, {
      item_id: movedId, from_parent_id: source.sectionId, to_parent_id: target.sectionId,
      ordered_source_ids: orderedSource, ordered_target_ids: orderedTarget,
    });
    const observed = {
      response: responseOf(response),
      updated: response.body.data?.updated_count ?? null,
      source: await children(source.sectionId, orderedSource),
      target: await children(target.sectionId, orderedTarget),
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "rm04-move-between-large-sections", { versionId, sourceId: source.sectionId,
      targetId: target.sectionId, movedId, elapsedMs: { seed: seedMs, move: ms }, error: response.body.error ?? null, observed });
    const all = add(range(1, 1000), range(1, 999));
    // Writes: the 999 source siblings and the 999 target siblings to their negative positions, the moved line into
    // the target, the 999 source siblings and the 1 000 target items to their final positions.
    expect(observed).toEqual({
      response: [200, true, null],
      updated: 999 + 1000,
      source: { inRequestedOrder: true, count: 999, distinctPositions: 999, positions: [1, 999] },
      target: { inRequestedOrder: true, count: 1000, distinctPositions: 1000, positions: [1, 1000] },
      sql: { engine: 2, stored: all, lines: 1999, lineSums: all },
      effects: effectsOf(999 + 999 + 1 + 999 + 1000, 1999, 999 + 999 + 1, owner.userId),
    });
  });
