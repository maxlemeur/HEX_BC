import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { assertOwnedLocalBackend, createdData, type Envelope } from "./legacy-v1-draft-support";

// Copies into a v1/v2 draft past the API row limit (PostgREST max_rows = 1 000, supabase/config.toml),
// docs/testing/copy-row-limit-v2.md. Observable failures, written before the fix. The large version holds
// 99 sections of 12 lines (1 287 items): read by position, its first 1 000 items stop at position 10, so
// sections 11 to 99 and lines 11 and 12 of sections 1 to 10 are missing. Copies stay small (13 items): every
// inserted item runs the per-item effects, whose cost grows with the version.
//  RL1  Duplicating in place its first section copies 10 of its 12 lines and answers 201.
//  RL2  The import dialog lists 10 of its sections, with 10 lines each (GET …/sections), and importing the
//       first one into another v2 draft imports 10 lines and answers 201.
//  RL3  Merging a section into its first section (same title) reads the target up to position 10, allocates
//       child positions already taken and is refused by their unique index (409).
//  RL4  A linked DPGF of 1 001 mapped rows (995 blank rows, then 6 priced rows) imported into a v2 draft
//       imports 5 of the 6 priced rows and answers 201.
//  RL5  A v2 created from a linked DPGF of 1 001 priced rows holds 1 000 lines and answers 201.
// A single copy of ~1 000 lines into a v1/v2 draft by direct insert exceeds the API's 8 s statement timeout
// (400): a separate defect, outside these journeys (see the testing record).
// The large content is seeded in SQL on the owned native stack, and every copy is checked against SQL.
const options = { session: "army", tags: ["critical", "local", "copy-row-limit"], timeout: 300_000 } as const;
type Triple = [number, number, number];
type Totals = { total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number };
type Created = { project: { id: string }; version: { id: string } };
type Imported = { imported_lines_count: number; created_section_ids: string[]; created_line_ids: string[]; totals: Totals };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^ARMY-[A-Za-z0-9-]{1,80} [a-z ]{1,40}$/;
const SECTIONS = 99;
const LINES = 12;
// Fixed margin x1, 20 % VAT, no discount, no rounding: a line's stored totals are its v2 totals.
const NEUTRAL_V2 = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 3,
  currency: "EUR", contractor_role: "principal", expected_calc_engine_version: 2,
};
// Line g (position g) of a seeded section, or row g of a seeded DPGF: 1 u at 5·g cents, no hours, so 5·g HT,
// g VAT and 6·g TTC. `range(from, to)` sums g over [from, to].
const range = (from: number, to: number): Triple => {
  const base = ((from + to) * (to - from + 1)) / 2;
  return [5 * base, base, 6 * base];
};
const times = (count: number, value: Triple): Triple => [count * value[0], count * value[1], count * value[2]];
const add = (a: Triple, b: Triple): Triple => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const SECTION = range(1, LINES);
const LARGE_VERSION = times(SECTIONS, SECTION);
const triple = (totals: Totals | undefined | null): Triple | null =>
  totals ? [totals.total_ht_cents, totals.total_tax_cents, totals.total_ttc_cents] : null;
const responseOf = (response: { status: number; body: Envelope<unknown> }) =>
  [response.status, response.body.ok, response.body.error?.code ?? null];

/** Wall-clock time of a seed or of one request (all its page reads, the insert and the recalculation), recorded only. */
async function timed<T>(request: () => Promise<T>) {
  const started = Date.now();
  const result = await request();
  return { result, ms: Date.now() - started };
}

async function retakeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect([200, 201]).toContain(lease.status);
}

/** An owned affaire with a v2 draft of neutral settings, plus `extra` v2 drafts in it. */
async function v2Drafts(browser: Browser, army: ArmyState, label: string, extra = 0) {
  assertOwnedLocalBackend();
  const first = await createdData(await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
    project: { name: `ARMY-RL-${label}-${army.runPrefix}` }, version: { ...NEUTRAL_V2, title: `${army.runPrefix} ${label} 1` },
  }));
  const projectId = first.project.id;
  const versionIds = [first.version.id];
  for (let index = 0; index < extra; index += 1) {
    const next = await createdData(await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
      project_id: projectId, version: { ...NEUTRAL_V2, title: `${army.runPrefix} ${label} ${index + 2}` },
    }));
    versionIds.push(next.version.id);
  }
  versionIds.forEach((versionId) => ownEstimate(army, { projectId, versionId }));
  const owner = await ownedEstimateContext(projectId);
  return { projectId, versionIds, owner };
}

/**
 * `sections` root sections of `lines` lines each, written in SQL into a v2 draft after its root items:
 * section s is titled `${label} s` and its line g (position g) `${label} s ligne g`. Returns their ids by s.
 */
async function seedSections(tenantId: string, versionId: string, label: string, sections: number, lines: number) {
  if (!UUID.test(tenantId) || !UUID.test(versionId) || !LABEL.test(label) || !Number.isSafeInteger(sections) ||
    !Number.isSafeInteger(lines) || sections < 1 || lines < 1 || sections * lines > 5000) throw new Error("Invalid seeded sections input.");
  const [ids] = (await querySql(`BEGIN;
INSERT INTO public.estimate_items (tenant_id, version_id, item_type, position, title)
SELECT v.tenant_id, v.id, 'section',
  (SELECT coalesce(max(r.position), 0) FROM public.estimate_items r WHERE r.version_id = v.id AND r.parent_id IS NULL) + s, '${label} ' || s
FROM public.estimate_versions v CROSS JOIN generate_series(1, ${sections}) AS s
WHERE v.id = '${versionId}'::uuid AND v.tenant_id = '${tenantId}'::uuid AND v.calc_engine_version = 2;
INSERT INTO public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
SELECT s.tenant_id, s.version_id, s.id, 'line', g, s.title || ' ligne ' || g, 'u', 1, 5 * g, 2000, 1, 0, 1, 1,
  5 * g, 5 * g, g, 6 * g
FROM public.estimate_items s CROSS JOIN generate_series(1, ${lines}) AS g
WHERE s.version_id = '${versionId}'::uuid AND s.parent_id IS NULL AND s.item_type = 'section' AND s.title LIKE '${label} %';
COMMIT;
SELECT coalesce(jsonb_agg(s.id ORDER BY s.position), '[]') FROM public.estimate_items s
WHERE s.version_id = '${versionId}'::uuid AND s.parent_id IS NULL AND s.title LIKE '${label} %'
  AND (SELECT count(*) FROM public.estimate_items l WHERE l.parent_id = s.id) = ${lines};
`)).slice(-1);
  const sectionIds = JSON.parse(ids) as string[];
  if (sectionIds.length !== sections) throw new Error("The seeded v2 sections were not persisted.");
  return sectionIds;
}

/** The lines of a section as SQL stores them: count, positions, totals and a digest of their content. */
async function sectionLines(sectionId: string) {
  if (!UUID.test(sectionId)) throw new Error("Invalid section identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('lines', count(*), 'distinctPositions', count(DISTINCT position),
  'positions', jsonb_build_array(min(position), max(position)),
  'sums', jsonb_build_array(coalesce(sum(line_total_ht_cents), 0), coalesce(sum(line_tax_cents), 0), coalesce(sum(line_total_ttc_cents), 0)),
  'digest', md5(coalesce(string_agg(concat_ws('|', position, title, quantity, unit_price_ht_cents, pu_ht_cents,
    line_total_ht_cents, line_tax_cents, line_total_ttc_cents), ';' ORDER BY position, title), '')))
FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid AND item_type = 'line';
`);
  return JSON.parse(row) as { lines: number; distinctPositions: number; positions: [number, number]; sums: Triple; digest: string };
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

/** The totals the editor reads (GET /api/estimates/{id}). */
async function readTotals(browser: Browser, versionId: string) {
  return triple((await readEstimate(browser, versionId)).version);
}

/**
 * A linked DPGF of the owned affaire: an import and `count` mapped rows in reading order. Rows up to
 * `blankRows` carry no field (refused as untitled, then skipped); row g after them is 1 u at 0,05·g €.
 */
async function seedLinkedDpgf(tenantId: string, projectId: string, filename: string, lineLabel: string, count: number, blankRows = 0) {
  if (!UUID.test(tenantId) || !UUID.test(projectId) || !/^ARMY-[A-Za-z0-9-]{1,80}\.xlsx$/.test(filename) || !LABEL.test(lineLabel) ||
    !Number.isSafeInteger(count) || !Number.isSafeInteger(blankRows) || count < 1 || count > 5000 || blankRows < 0 || blankRows >= count) {
    throw new Error("Invalid linked DPGF fixture input.");
  }
  const importId = randomUUID();
  const output = await querySql(`BEGIN;
INSERT INTO public.dpgf_imports (id, tenant_id, user_id, filename, source_format, status, row_count, parse_mode, project_id)
SELECT '${importId}'::uuid, p.tenant_id, p.user_id, '${filename}', 'xlsx', 'completed', ${count}, 'server', p.id
FROM public.estimate_projects p WHERE p.id = '${projectId}'::uuid AND p.tenant_id = '${tenantId}'::uuid;
INSERT INTO public.dpgf_rows_mapped (tenant_id, import_id, payload, status, created_at)
SELECT '${tenantId}'::uuid, '${importId}'::uuid, CASE WHEN g <= ${blankRows} THEN jsonb_build_object('row_index', g)
  ELSE jsonb_build_object('row_index', g, 'designation', '${lineLabel} ' || g, 'unit', 'u', 'quantity', '1',
    'unit_price_ht', replace(to_char(g * 5 / 100.0, 'FM999990.00'), '.', ',')) END,
  'mapped', now() + g * interval '1 millisecond'
FROM generate_series(1, ${count}) AS g
WHERE EXISTS (SELECT 1 FROM public.dpgf_imports i WHERE i.id = '${importId}'::uuid);
COMMIT;
SELECT count(*) FROM public.dpgf_rows_mapped WHERE import_id = '${importId}'::uuid;
`);
  if (output.at(-1) !== String(count)) throw new Error("The linked DPGF fixture was not persisted.");
  return importId;
}

armyTest("RL01 a section of a v2 of more than 1 000 items duplicated in place copies every line, totals as SQL stores them", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [versionId], owner } = await v2Drafts(browser, army, "duplicate");
    const { result: sectionIds, ms: seedMs } = await timed(() => seedSections(owner.tenantId, versionId, `${army.runPrefix} lot`, SECTIONS, LINES));
    const sectionId = sectionIds[0];
    const source = await sectionLines(sectionId);
    const seeded = await versionTruth(versionId);
    await retakeLease(browser, versionId);
    type Duplicated = { duplicated_section_id: string; copied_item_count: number; totals: Totals };
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Duplicated>>(browser, "POST",
      `/api/estimates/${versionId}/sections/${sectionId}/duplicate`, {}));
    const copyId = response.body.data?.duplicated_section_id;
    const observed = {
      seeded: { lines: seeded.lines, lineSums: seeded.lineSums, engine: seeded.engine },
      response: responseOf(response),
      copiedItems: response.body.data?.copied_item_count ?? null,
      copy: copyId ? await sectionLines(copyId) : null,
      totals: triple(response.body.data?.totals),
      read: await readTotals(browser, versionId),
      sql: await versionTruth(versionId),
    };
    await recordEvidence(army, "rl01-duplicate-in-place", { versionId, sectionId, copyId: copyId ?? null, elapsedMs: { seed: seedMs, copy: ms }, source, observed });
    const expected = add(LARGE_VERSION, SECTION);
    expect(observed).toEqual({
      seeded: { lines: SECTIONS * LINES, lineSums: LARGE_VERSION, engine: 2 },
      response: [201, true, null],
      copiedItems: LINES + 1,
      copy: source,
      totals: expected,
      read: expected,
      sql: { engine: 2, stored: expected, lines: (SECTIONS + 1) * LINES, lineSums: expected },
    });
  });

armyTest("RL02 a section of a v2 of more than 1 000 items is listed and imported into another v2 with every line", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [sourceId, targetId], owner } = await v2Drafts(browser, army, "import", 1);
    const { result: sectionIds, ms: seedMs } = await timed(() => seedSections(owner.tenantId, sourceId, `${army.runPrefix} lot`, SECTIONS, LINES));
    const sectionId = sectionIds[0];
    const source = await sectionLines(sectionId);
    // The sections the import dialog offers from the source version.
    type Listed = { items: Array<{ id: string; line_count: number; total_ht_cents: number }> };
    const { result: listed, ms: listMs } = await timed(() => apiRequest<Envelope<Listed>>(browser, "GET", `/api/estimates/${sourceId}/sections`));
    const offered = (listed.body.data?.items ?? []).filter((item) => sectionIds.includes(item.id));
    await retakeLease(browser, targetId);
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Imported>>(browser, "POST",
      `/api/estimates/${targetId}/import-sections`, { source_version_id: sourceId, section_ids: [sectionId], mode: "append" }));
    const copyId = response.body.data?.created_section_ids?.[0];
    const observed = {
      offered: {
        status: listed.status, sections: offered.length,
        lineCounts: [...new Set(offered.map((item) => item.line_count))], totals: [...new Set(offered.map((item) => item.total_ht_cents))],
      },
      response: responseOf(response),
      imported: [response.body.data?.imported_lines_count ?? null, response.body.data?.created_line_ids?.length ?? null],
      copy: copyId ? await sectionLines(copyId) : null,
      totals: triple(response.body.data?.totals),
      read: await readTotals(browser, targetId),
      sql: await versionTruth(targetId),
    };
    await recordEvidence(army, "rl02-import-into-v2", { sourceId, targetId, sectionId, copyId: copyId ?? null,
      elapsedMs: { seed: seedMs, list: listMs, import: ms }, source, observed });
    expect(observed).toEqual({
      offered: { status: 200, sections: SECTIONS, lineCounts: [LINES], totals: [SECTION[0]] },
      response: [201, true, null],
      imported: [LINES, LINES],
      copy: source,
      totals: SECTION,
      read: SECTION,
      sql: { engine: 2, stored: SECTION, lines: LINES, lineSums: SECTION },
    });
  });

armyTest("RL03 a section merged into a v2 of more than 1 000 items lands after the last line of its same-titled section", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [sourceId, targetId], owner } = await v2Drafts(browser, army, "merge", 1);
    const label = `${army.runPrefix} lot`;
    const [sourceSectionId] = await seedSections(owner.tenantId, sourceId, label, 1, 2);
    const { result: [targetSectionId], ms: seedMs } = await timed(() => seedSections(owner.tenantId, targetId, label, SECTIONS, LINES));
    await retakeLease(browser, targetId);
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Imported>>(browser, "POST",
      `/api/estimates/${targetId}/import-sections`, { source_version_id: sourceId, section_ids: [sourceSectionId], mode: "merge" }));
    const [merged] = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_array(position, title, line_total_ht_cents) ORDER BY position), '[]')
FROM public.estimate_items WHERE parent_id = '${targetSectionId}'::uuid AND position > ${LINES};
`);
    const observed = {
      response: responseOf(response),
      imported: [response.body.data?.imported_lines_count ?? null, response.body.data?.created_section_ids?.length ?? null],
      merged: JSON.parse(merged) as Array<[number, string, number]>,
      target: await sectionLines(targetSectionId),
      totals: triple(response.body.data?.totals),
      sql: await versionTruth(targetId),
    };
    await recordEvidence(army, "rl03-merge-into-large-v2", { sourceId, targetId, sourceSectionId, targetSectionId, elapsedMs: { seed: seedMs, merge: ms },
      message: response.body.error?.message ?? null, observed });
    const expected = add(LARGE_VERSION, range(1, 2));
    expect(observed).toMatchObject({
      response: [201, true, null],
      imported: [2, 0],
      merged: [[LINES + 1, `${label} 1 ligne 1`, 5], [LINES + 2, `${label} 1 ligne 2`, 10]],
      target: { lines: LINES + 2, distinctPositions: LINES + 2, positions: [1, LINES + 2], sums: add(SECTION, range(1, 2)) },
      totals: expected,
      sql: { engine: 2, stored: expected, lines: SECTIONS * LINES + 2, lineSums: expected },
    });
  });

armyTest("RL04 a linked DPGF of 1 001 mapped rows imported into a v2 draft imports every priced row", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { projectId, versionIds: [versionId], owner } = await v2Drafts(browser, army, "dpgf-draft");
    const { result: importId, ms: seedMs } = await timed(() => seedLinkedDpgf(owner.tenantId, projectId, `${army.runPrefix}-dpgf-draft.xlsx`,
      `${army.runPrefix} dpgf ligne`, 1001, 995));
    await retakeLease(browser, versionId);
    type LinkedImport = { created_section_id: string; imported_lines_count: number; skipped_lines_count: number; totals: Totals };
    const { result: imported, ms } = await timed(() => apiRequest<Envelope<LinkedImport>>(browser, "POST",
      `/api/estimates/${versionId}/import-linked-dpgf`, {}));
    const sectionId = imported.body.data?.created_section_id;
    const observed = {
      response: responseOf(imported),
      counts: [imported.body.data?.imported_lines_count ?? null, imported.body.data?.skipped_lines_count ?? null],
      section: sectionId ? await sectionLines(sectionId) : null,
      totals: triple(imported.body.data?.totals),
      sql: await versionTruth(versionId),
    };
    await recordEvidence(army, "rl04-linked-dpgf-into-v2", { projectId, versionId, importId, sectionId: sectionId ?? null, elapsedMs: { seed: seedMs, import: ms },
      observed });
    // Rows 996 to 1 001: 5 × 5 991 = 29 955 cents HT.
    const priced = range(996, 1001);
    expect(observed).toMatchObject({
      response: [201, true, null],
      counts: [6, 995],
      section: { lines: 6, distinctPositions: 6, positions: [1, 6], sums: priced },
      totals: priced,
      sql: { engine: 2, stored: priced, lines: 6, lineSums: priced },
    });
  });

armyTest("RL05 a v2 created from a linked DPGF of 1 001 priced rows holds every row", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { projectId, owner } = await v2Drafts(browser, army, "dpgf-creation");
    const { result: importId, ms: seedMs } = await timed(() => seedLinkedDpgf(owner.tenantId, projectId, `${army.runPrefix}-dpgf-creation.xlsx`,
      `${army.runPrefix} dpgf ligne`, 1001));
    const { result: created, ms } = await timed(() => apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
      project_id: projectId, creation_mode: "linked_dpgf_source", version: { ...NEUTRAL_V2, title: `${army.runPrefix} dpgf creation` },
    }));
    const createdId = created.body.data?.version?.id;
    if (createdId) ownEstimate(army, { projectId, versionId: createdId });
    const observed = { response: responseOf(created), sql: createdId ? await versionTruth(createdId) : null };
    await recordEvidence(army, "rl05-linked-dpgf-creation", { projectId, importId, createdId: createdId ?? null, elapsedMs: { seed: seedMs, create: ms },
      observed });
    // Rows 1 to 1 001: 2 507 505 cents HT.
    expect(observed).toEqual({
      response: [201, true, null],
      sql: { engine: 2, stored: range(1, 1001), lines: 1001, lineSums: range(1, 1001) },
    });
  });
