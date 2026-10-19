import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { assertOwnedLocalBackend, createdData, type Envelope } from "./legacy-v1-draft-support";

// Reads of src/lib/estimates/server.ts past the API row limit (PostgREST max_rows = 1 000,
// supabase/config.toml), docs/testing/row-limit-reads.md. Observable failures, written before the fix and
// red on main 36c5158c. The complete reads of 33c7031b (readAllRows) fix LR1 to LR4; LR5 is fixed with it here.
//  LR1  The variant comparison of the summary page (/dashboard/estimates/{id}) counts the lines of a v2
//       and its variant in one read: with 600 and 500 lines it shows counts summing to 1 000.
//  LR2  Reordering a section of 1 001 lines reads its siblings in one unordered read (1 000 ids): it refuses
//       the complete list as obsolete (409), and a list missing the last line passes the check when the read
//       stops before that line, so the RPC reorders 1 000 lines and answers 200.
//  LR3  Moving the last line (position 1 001) of a section of 1 001 lines into another section reads the
//       source siblings by position up to 1 000 and refuses the move (409, item_not_in_source_parent).
//  LR4  Creating a line under a section seeded right after 1 001 sections reads the version's hierarchy in one
//       unordered read: when the section lies past the first 1 000 rows of that read, the API answers 400
//       ("Une ligne doit être ajoutée sous une section."). The read follows the physical order of the rows,
//       recorded as evidence (`physicalRank`) without assertion.
//  LR5  The import dialog (GET /api/estimates/import-sources) offers the 1 000 most recently updated
//       versions of the tenant only: with 1 001 versions beside the current one, in a tenant of its own, the
//       oldest is missing.
// Every write stays small: every written item runs the per-item effects, among them one content revision bump
// of the version per row (docs/testing/large-estimate-statement-budget.md). A complete reorder or move of 1 001
// siblings rewrites about 2 000 rows in one RPC, measured at 2 s locally, past the 8 s timeout at the CI load
// factor of that record. LR2 and LR3 therefore send a list missing one sibling: the fixed check refuses it naming
// every sibling, before any write. The complete operation succeeded in a recorded local run
// (docs/testing/row-limit-reads.md). The SQL seeds write at most SEED_BATCH rows per transaction.
// The large content is seeded in SQL on the owned native stack, and every outcome is checked against SQL.
const options = { session: "army", tags: ["critical", "local", "row-limit-reads"], timeout: 300_000 } as const;
type Triple = [number, number, number];
type Totals = { total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number };
type Created = { project: { id: string }; version: { id: string } };
type Seeded = { sectionId: string; lineIds: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^ARMY-[A-Za-z0-9-]{1,80} [a-z ]{1,40}$/;
const LARGE = 1001;
const SEED_BATCH = 250;
// Fixed margin x1, 20 % VAT, no discount, no rounding: a line's stored totals are its v2 totals.
const NEUTRAL_V2 = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 3,
  currency: "EUR", contractor_role: "principal", expected_calc_engine_version: 2,
};
// Line g (position g) of a seeded section: 1 u at 5·g cents, no hours, so 5·g HT, g VAT and 6·g TTC.
// `range(from, to)` sums g over [from, to].
const range = (from: number, to: number): Triple => {
  const base = ((from + to) * (to - from + 1)) / 2;
  return [5 * base, base, 6 * base];
};
const add = (a: Triple, b: Triple): Triple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
// The ids a refusal names, whatever their order (the order of a diagnostic list is not a contract).
const sameIds = (actual: string[] | null | undefined, expected: string[]) =>
  Array.isArray(actual) && JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
const triple = (totals: Totals | undefined | null): Triple | null =>
  totals ? [totals.total_ht_cents, totals.total_tax_cents, totals.total_ttc_cents] : null;
const responseOf = (response: { status: number; body: Envelope<unknown> }) =>
  [response.status, response.body.ok, response.body.error?.code ?? null];

/** Wall-clock time of a seed or of one request, recorded only. */
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
    project: { name: `ARMY-LR-${label}-${army.runPrefix}` }, version: { ...NEUTRAL_V2, title: `${army.runPrefix} ${label}` },
  }));
  const projectId = created.project.id;
  const versionId = created.version.id;
  ownEstimate(army, { projectId, versionId });
  const owner = await ownedEstimateContext(projectId);
  return { projectId, versionId, owner };
}

/**
 * Root sections written in SQL, in this order, after the root items of a v2 draft: `emptyBefore` empty sections
 * titled `${label} vide n`, then section `${label} s` holding `lines[s-1]` lines, its line g (position g) titled
 * `${label} s ligne g`. Every written row runs the per-row effects, whose cost grows with the rows written in one
 * transaction: the rows go in order, in transactions of at most SEED_BATCH rows, each far below the 30 s of querySql.
 */
async function seedSections(tenantId: string, versionId: string, label: string, lines: number[], emptyBefore = 0): Promise<Seeded[]> {
  if (!UUID.test(tenantId) || !UUID.test(versionId) || !LABEL.test(label) || lines.length < 1 || lines.length > 10 ||
    !lines.every((count) => Number.isSafeInteger(count) && count >= 0 && count <= 2000) ||
    !Number.isSafeInteger(emptyBefore) || emptyBefore < 0 || emptyBefore > 2000) throw new Error("Invalid seeded sections input.");
  const ids = lines.map(() => randomUUID());
  const ofVersion = `v.id = '${versionId}'::uuid AND v.tenant_id = '${tenantId}'::uuid AND v.calc_engine_version = 2`;
  const nextRoot = "(SELECT coalesce(max(r.position), 0) FROM public.estimate_items r WHERE r.version_id = v.id AND r.parent_id IS NULL)";
  const runs = (count: number) => Array.from({ length: Math.ceil(count / SEED_BATCH) }, (_, index) =>
    [index * SEED_BATCH + 1, Math.min(count, (index + 1) * SEED_BATCH)] as const);
  const units: Array<{ rows: number; sql: string }> = [
    ...runs(emptyBefore).map(([from, to]) => ({ rows: to - from + 1, sql: `INSERT INTO public.estimate_items (tenant_id, version_id, item_type, position, title)
SELECT v.tenant_id, v.id, 'section', ${nextRoot} + n - ${from} + 1, '${label} vide ' || n
FROM public.estimate_versions v CROSS JOIN generate_series(${from}, ${to}) AS n WHERE ${ofVersion}
ORDER BY n;` })),
    ...lines.flatMap((count, index) => [
      { rows: 1, sql: `INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
SELECT '${ids[index]}'::uuid, v.tenant_id, v.id, 'section', ${nextRoot} + 1, '${label} ${index + 1}'
FROM public.estimate_versions v WHERE ${ofVersion};` },
      ...runs(count).map(([from, to]) => ({ rows: to - from + 1, sql: `INSERT INTO public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
SELECT s.tenant_id, s.version_id, s.id, 'line', g, s.title || ' ligne ' || g, 'u', 1, 5 * g, 2000, 1, 0, 1, 1,
  5 * g, 5 * g, g, 6 * g
FROM public.estimate_items s CROSS JOIN generate_series(${from}, ${to}) AS g
WHERE s.id = '${ids[index]}'::uuid
ORDER BY g;` })),
    ]),
  ];
  // Consecutive units share a transaction while they fit: the last empty sections and the next section stay
  // in one session, so LR4's section is stored after them.
  const batches: string[][] = [];
  let rows = SEED_BATCH;
  for (const unit of units) {
    if (rows + unit.rows > SEED_BATCH) { batches.push([]); rows = 0; }
    batches[batches.length - 1].push(unit.sql);
    rows += unit.rows;
  }
  for (const batch of batches) await querySql(`BEGIN;\n${batch.join("\n")}\nCOMMIT;\n`);
  const output = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_object('sectionId', s.id,
  'lineIds', coalesce((SELECT jsonb_agg(l.id ORDER BY l.position) FROM public.estimate_items l WHERE l.parent_id = s.id), '[]'))
  ORDER BY s.position), '[]')
FROM public.estimate_items s WHERE s.id = ANY(ARRAY[${ids.map((id) => `'${id}'::uuid`).join(", ")}]);
`);
  const seeded = JSON.parse(output.at(-1) ?? "[]") as Seeded[];
  if (seeded.length !== lines.length || seeded.some((section, index) => section.sectionId !== ids[index] ||
    section.lineIds.length !== lines[index])) throw new Error("The seeded v2 sections were not persisted.");
  return seeded;
}

/**
 * Rows of the version stored before this one in the table, the order an unordered read of the version follows.
 * Recorded only: it explains LR4, it is not a business outcome.
 */
async function physicalRank(versionId: string, itemId: string) {
  if (!UUID.test(versionId) || !UUID.test(itemId)) throw new Error("Invalid physical rank input.");
  const [rank] = await querySql(`SELECT count(*) FROM public.estimate_items i
WHERE i.version_id = '${versionId}'::uuid AND i.ctid < (SELECT t.ctid FROM public.estimate_items t WHERE t.id = '${itemId}'::uuid);
`);
  return Number(rank);
}

/** The children of a parent as SQL stores them: ids by position, and the position of each title's line g. */
async function children(sectionId: string) {
  if (!UUID.test(sectionId)) throw new Error("Invalid section identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('ids', coalesce(jsonb_agg(id ORDER BY position, id), '[]'),
  'count', count(*), 'distinctPositions', count(DISTINCT position),
  'positions', jsonb_build_array(min(position), max(position)),
  'sums', jsonb_build_array(coalesce(sum(line_total_ht_cents), 0), coalesce(sum(line_tax_cents), 0), coalesce(sum(line_total_ttc_cents), 0)),
  'reversed', count(*) FILTER (WHERE position + (substring(title FROM ' ligne ([0-9]+)$'))::int = ${LARGE + 1}))
FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid;
`);
  return JSON.parse(row) as {
    ids: string[]; count: number; distinctPositions: number; positions: [number, number]; sums: Triple; reversed: number;
  };
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

/** Stores the totals of the seeded lines on the version, as the recalculation would: the SQL seed bypasses it. */
async function storeSeededTotals(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  await querySql(`UPDATE public.estimate_versions v SET total_ht_cents = t.ht, total_tax_cents = t.tax, total_ttc_cents = t.ttc
FROM (SELECT coalesce(sum(line_total_ht_cents), 0) AS ht, coalesce(sum(line_tax_cents), 0) AS tax, coalesce(sum(line_total_ttc_cents), 0) AS ttc
  FROM public.estimate_items WHERE version_id = '${versionId}'::uuid AND item_type = 'line') AS t
WHERE v.id = '${versionId}'::uuid AND v.calc_engine_version = 2 AND v.status = 'draft';
`);
}

armyTest("LR01 the variant comparison of a v2 and its variant holding 1 100 lines counts every line of each", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { projectId, versionId: baseId, owner } = await v2Draft(browser, army, "variants");
    type Variant = { version_id: string };
    const variant = await createdData(await apiRequest<Envelope<Variant>>(browser, "POST", `/api/estimates/${baseId}/variants`, {}));
    const variantId = variant.version_id;
    expect(variantId).toMatch(UUID);
    ownEstimate(army, { projectId, versionId: variantId });
    const { ms: seedMs } = await timed(async () => {
      await seedSections(owner.tenantId, baseId, `${army.runPrefix} base`, [600]);
      await seedSections(owner.tenantId, variantId, `${army.runPrefix} variante`, [500]);
    });
    const sql = { base: (await versionTruth(baseId)).lines, variant: (await versionTruth(variantId)).lines };
    // The comparison table of the summary page, as the user reads it: label and line count of each row.
    const { ms: pageMs } = await timed(() => app.open(`/dashboard/estimates/${baseId}`));
    const table = await browser.evaluate(async () => {
      const deadline = Date.now() + 30_000;
      let section = document.querySelector("section[aria-labelledby='variant-comparison-title']");
      while (!section && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        section = document.querySelector("section[aria-labelledby='variant-comparison-title']");
      }
      return [...(section?.querySelectorAll("tbody tr") ?? [])].map((row) => [
        (row as HTMLTableRowElement).cells[0]?.querySelector("span")?.textContent?.trim() ?? null,
        (row as HTMLTableRowElement).cells[2]?.textContent?.trim() ?? null,
      ]);
    });
    const observed = { sql, table };
    await recordEvidence(army, "lr01-variant-line-counts", { projectId, baseId, variantId, elapsedMs: { seed: seedMs, page: pageMs }, observed });
    expect(observed).toEqual({
      sql: { base: 600, variant: 500 },
      table: [["Version 1", "600"], ["Variante A · V2", "500"]],
    });
  });

armyTest("LR02 a reorder list of a section of 1 001 lines missing its last line is refused, nothing moves", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "reorder");
    const { result: [section], ms: seedMs } = await timed(() => seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [LARGE]));
    await storeSeededTotals(versionId);
    // The order of a client that has not seen the 1 001st line: the first 1 000 lines, reversed.
    const stale = section.lineIds.slice(0, LARGE - 1).reverse();
    await retakeLease(browser, versionId);
    type Reordered = { updated_count: number };
    type Refused = { expected_ids?: string[] };
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Reordered> & { error?: { details?: Refused } }>(browser, "POST",
      `/api/estimates/${versionId}/items/reorder`, { parent_id: section.sectionId, ordered_ids: stale }));
    const expectedIds = response.body.error?.details?.expected_ids ?? null;
    const after = await children(section.sectionId);
    const observed = {
      response: responseOf(response),
      updated: response.body.data?.updated_count ?? null,
      expected: { count: expectedIds?.length ?? null, every: sameIds(expectedIds, section.lineIds) },
      unchanged: JSON.stringify(after.ids) === JSON.stringify(section.lineIds),
      sql: await versionTruth(versionId),
    };
    await recordEvidence(army, "lr02-reorder-large-section", { versionId, sectionId: section.sectionId, elapsedMs: { seed: seedMs, reorder: ms },
      message: response.body.error?.message ?? null, observed });
    expect(observed).toEqual({
      response: [409, false, "CONFLICT"],
      updated: null,
      expected: { count: LARGE, every: true },
      unchanged: true,
      sql: { engine: 2, stored: range(1, LARGE), lines: LARGE, lineSums: range(1, LARGE) },
    });
  });

armyTest("LR03 a move out of a section of 1 001 lines is checked against every sibling, nothing moves", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "move");
    // The target section comes first, so the version's hierarchy read reaches it whatever the row limit.
    const { result: [target, source], ms: seedMs } = await timed(() =>
      seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [1, LARGE]));
    await storeSeededTotals(versionId);
    const ranks = { target: await physicalRank(versionId, target.sectionId) };
    // The last line moves out; the source order of a client that has not seen line 1 000.
    const movedId = source.lineIds[LARGE - 1];
    const remaining = source.lineIds.slice(0, LARGE - 1);
    await retakeLease(browser, versionId);
    type Moved = { updated_count: number };
    type Refused = { reason?: string; expected_source_ids?: string[] };
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Moved> & { error?: { details?: Refused } }>(browser, "POST",
      `/api/estimates/${versionId}/items/move`, {
        item_id: movedId, from_parent_id: source.sectionId, to_parent_id: target.sectionId,
        ordered_source_ids: remaining.slice(0, -1), ordered_target_ids: [...target.lineIds, movedId],
      }));
    const details = response.body.error?.details;
    const [sourceAfter, targetAfter] = [await children(source.sectionId), await children(target.sectionId)];
    const observed = {
      response: responseOf(response),
      updated: response.body.data?.updated_count ?? null,
      refusal: { reason: details?.reason ?? null, expectedSource: details?.expected_source_ids?.length ?? null,
        every: sameIds(details?.expected_source_ids, remaining) },
      unchanged: JSON.stringify(sourceAfter.ids) === JSON.stringify(source.lineIds) &&
        JSON.stringify(targetAfter.ids) === JSON.stringify(target.lineIds),
      sql: await versionTruth(versionId),
    };
    await recordEvidence(army, "lr03-move-out-of-large-section", { versionId, sourceId: source.sectionId, targetId: target.sectionId, movedId,
      physicalRank: ranks, elapsedMs: { seed: seedMs, move: ms }, message: response.body.error?.message ?? null, observed });
    const all = add(range(1, 1), range(1, LARGE));
    expect(observed).toEqual({
      response: [409, false, "CONFLICT"],
      updated: null,
      refusal: { reason: null, expectedSource: LARGE - 1, every: true },
      unchanged: true,
      sql: { engine: 2, stored: all, lines: LARGE + 1, lineSums: all },
    });
  });

armyTest("LR04 a line is created under a section that follows 1 001 sections of a v2", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionId, owner } = await v2Draft(browser, army, "create");
    // Empty sections: the hierarchy read counts every item, and a new line re-projects only the version's lines.
    const { result: [section], ms: seedMs } = await timed(() => seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, [0], LARGE));
    const ranks = { section: await physicalRank(versionId, section.sectionId) };
    await retakeLease(browser, versionId);
    type CreatedItem = { item: { id: string; parent_id: string | null; position: number } };
    const title = `${army.runPrefix} ligne ajoutée`;
    const { result: response, ms } = await timed(() => apiRequest<Envelope<CreatedItem>>(browser, "POST", `/api/estimates/${versionId}/items`, {
      item_type: "line", parent_id: section.sectionId, title, line_nature: "supply_only",
      quantity: 1, unit_price_ht_cents: 5, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
    }));
    const added = await children(section.sectionId);
    const observed = {
      response: responseOf(response),
      item: response.body.data?.item ? [response.body.data.item.parent_id, response.body.data.item.position] : null,
      section: { count: added.count, positions: added.positions, sums: added.sums },
      read: triple((await readEstimate(browser, versionId)).version),
      sql: await versionTruth(versionId),
    };
    await recordEvidence(army, "lr04-create-under-late-section", { versionId, sectionId: section.sectionId, physicalRank: ranks,
      elapsedMs: { seed: seedMs, create: ms }, message: response.body.error?.message ?? null, observed });
    const line = range(1, 1);
    expect(observed).toEqual({
      response: [201, true, null],
      item: [section.sectionId, 1],
      section: { count: 1, positions: [1, 1], sums: line },
      read: line,
      sql: { engine: 2, stored: line, lines: 1, lineSums: line },
    });
  });

armyTest("LR05 the import dialog offers every version of the tenant past 1 000, the oldest included", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    // A tenant of its own: the list spans the tenant, which the campaign's two workers share.
    const dedicated = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LR05" });
    await app.open("/dashboard/affaires");
    const { projectId, versionId, owner } = await v2Draft(browser, army, "sources");
    expect({ tenantId: owner.tenantId, userId: owner.userId }).toEqual({ tenantId: dedicated.tenantId, userId: dedicated.userId });
    const label = `${army.runPrefix} source`;
    if (!LABEL.test(label)) throw new Error("Invalid source version label.");
    // 1 001 empty v2 drafts beside the current one, updated in 2001 one minute apart: the dialog must offer all of
    // them, most recently updated first, so the first one written comes last.
    const { result: seeded, ms: seedMs } = await timed(async () => JSON.parse((await querySql(`BEGIN;
INSERT INTO public.estimate_versions (tenant_id, project_id, version_number, status, calc_engine_version, title, currency,
  margin_mode, margin_multiplier, margin_bp, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents,
  discount_bp, discount_mode, discount_steps, contractor_role, max_section_depth,
  total_ht_cents, total_tax_cents, total_ttc_cents, created_at, updated_at)
SELECT p.tenant_id, p.id, 1 + g, 'draft', 2, '${label} ' || g, 'EUR', 'fixed', 1, 0, 1, 2000, 'none', 1, 0, 'simple', '{}', 'principal', 3,
  0, 0, 0, timestamptz '2001-01-01 00:00:00+00' + g * interval '1 minute', timestamptz '2001-01-01 00:00:00+00' + g * interval '1 minute'
FROM public.estimate_projects p CROSS JOIN generate_series(1, ${LARGE}) AS g
WHERE p.id = '${projectId}'::uuid AND p.tenant_id = '${owner.tenantId}'::uuid AND p.user_id = '${owner.userId}'::uuid;
COMMIT;
SELECT jsonb_build_object('oldest', (SELECT v.id FROM public.estimate_versions v WHERE v.project_id = '${projectId}'::uuid AND v.title = '${label} 1'),
  'offerable', (SELECT coalesce(jsonb_agg(v.id ORDER BY v.updated_at DESC, v.version_number DESC, v.id), '[]')
    FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id = v.project_id
    WHERE v.tenant_id = '${owner.tenantId}'::uuid AND p.tenant_id = v.tenant_id AND NOT p.is_archived AND v.id <> '${versionId}'::uuid));
`)).at(-1) ?? "{}") as { oldest: string; offerable: string[] });
    type Source = { id: string; updated_at: string };
    const { result: listed, ms } = await timed(() => apiRequest<Envelope<{ items: Source[] }>>(browser, "GET",
      `/api/estimates/import-sources?exclude_version_id=${versionId}`));
    const ids = (listed.body.data?.items ?? []).map((item) => item.id);
    const observed = {
      offerable: seeded.offerable.length,
      response: responseOf(listed),
      offered: { count: ids.length, oldestLast: ids.at(-1) === seeded.oldest, asSql: JSON.stringify(ids) === JSON.stringify(seeded.offerable) },
    };
    // On a mismatch, what differs: the first differing rank and up to 20 missing or extra versions.
    const firstDifference = seeded.offerable.findIndex((id, index) => ids[index] !== id);
    await recordEvidence(army, "lr05-import-sources-past-limit", { projectId, versionId, tenantId: owner.tenantId, oldestId: seeded.oldest,
      elapsedMs: { seed: seedMs, list: ms }, firstDifference,
      missing: seeded.offerable.filter((id) => !ids.includes(id)).slice(0, 20), extra: ids.filter((id) => !seeded.offerable.includes(id)).slice(0, 20),
      observed });
    expect(observed).toEqual({
      offerable: LARGE,
      response: [200, true, null],
      offered: { count: LARGE, oldestLast: true, asSql: true },
    });
  });
