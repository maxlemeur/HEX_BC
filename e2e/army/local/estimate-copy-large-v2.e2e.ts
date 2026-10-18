import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { assertOwnedLocalBackend, createdData, type Envelope } from "./legacy-v1-draft-support";

// Copies of ~1 000 items into a v1/v2 draft, docs/testing/copy-large-v2.md. Observable failures, written before the
// fix. Every copied item ran the per-item effects of estimate_items one row at a time under the API roles' RLS (the
// hierarchy depth check, the content revision bump with its audit row, the item audit row, the source coverage
// lookup): about 1 000 items exceed the 8 s statement_timeout (57014), so the copy answers 400 and writes nothing.
//  LC1  Duplicating in place a section of 999 lines (1 000 items) of a v2 draft.
//  LC2  Importing that section into another, empty v2 draft (append).
//  LC3  Merging that section into a same-titled section of 2 lines of another v2 draft (999 lines appended).
//  LC4  Importing a linked DPGF of 1 001 priced rows into a v2 draft (1 002 items).
// Each copy must answer 201 and store every line (count, positions, content digest), totals equal to the sums of the
// lines in SQL, one content revision per inserted item plus one for the totals, and one audit row per inserted item
// and per revision step, all journaled under the requesting user, as the per-item effects did.
//  LC5  Control, green before the fix: a section of 12 lines duplicated in place keeps those same revision and audit
//       effects (the fix must not change what a small copy writes).
// The linked DPGF goes past the 1 000-row page of PostgREST, read by pages since #70 (docs/testing/copy-row-limit-v2.md);
// the source versions hold 1 000 items. The large content is seeded in SQL on the
// owned native stack.
const options = { session: "army", tags: ["critical", "local", "copy-large"], timeout: 300_000 } as const;
type Triple = [number, number, number];
type Totals = { total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number };
type Created = { project: { id: string }; version: { id: string } };
type Imported = { imported_lines_count: number; created_section_ids: string[]; created_line_ids: string[]; totals: Totals };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LABEL = /^ARMY-[A-Za-z0-9-]{1,80} [a-z ]{1,40}$/;
const LINES = 999;
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
const triple = (totals: Totals | undefined | null): Triple | null =>
  totals ? [totals.total_ht_cents, totals.total_tax_cents, totals.total_ttc_cents] : null;
const responseOf = (response: { status: number; body: Envelope<unknown> }) =>
  [response.status, response.body.ok, response.body.error?.code ?? null];

/** Wall-clock time of a seed or of one request (its reads, the copy statement and the recalculation), recorded only. */
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
    project: { name: `ARMY-LC-${label}-${army.runPrefix}` }, version: { ...NEUTRAL_V2, title: `${army.runPrefix} ${label} 1` },
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

/** One root section titled `title` with `lines` lines (line g titled `${title} ligne g`), written in SQL into a v2 draft after its root items. */
async function seedSection(tenantId: string, versionId: string, title: string, lines: number) {
  if (!UUID.test(tenantId) || !UUID.test(versionId) || !LABEL.test(title) || !Number.isSafeInteger(lines) || lines < 1 || lines > 999) {
    throw new Error("Invalid seeded section input.");
  }
  const sectionId = randomUUID();
  const output = await querySql(`BEGIN;
INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
SELECT '${sectionId}'::uuid, v.tenant_id, v.id, 'section',
  (SELECT coalesce(max(r.position), 0) + 1 FROM public.estimate_items r WHERE r.version_id = v.id AND r.parent_id IS NULL), '${title}'
FROM public.estimate_versions v WHERE v.id = '${versionId}'::uuid AND v.tenant_id = '${tenantId}'::uuid AND v.calc_engine_version = 2;
INSERT INTO public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
SELECT s.tenant_id, s.version_id, s.id, 'line', g, s.title || ' ligne ' || g, 'u', 1, 5 * g, 2000, 1, 0, 1, 1,
  5 * g, 5 * g, g, 6 * g
FROM public.estimate_items s CROSS JOIN generate_series(1, ${lines}) AS g WHERE s.id = '${sectionId}'::uuid;
COMMIT;
SELECT count(*) FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid;
`);
  if (output.at(-1) !== String(lines)) throw new Error("The seeded v2 section was not persisted.");
  return sectionId;
}

/** The lines of a section as SQL stores them: count, positions, totals and a digest of their content. */
async function sectionLines(sectionId: string, fromPosition = 1) {
  if (!UUID.test(sectionId) || !Number.isSafeInteger(fromPosition)) throw new Error("Invalid section identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('lines', count(*), 'distinctPositions', count(DISTINCT position),
  'positions', jsonb_build_array(min(position), max(position)),
  'sums', jsonb_build_array(coalesce(sum(line_total_ht_cents), 0), coalesce(sum(line_tax_cents), 0), coalesce(sum(line_total_ttc_cents), 0)),
  'digest', md5(coalesce(string_agg(concat_ws('|', title, quantity, unit_price_ht_cents, pu_ht_cents,
    line_total_ht_cents, line_tax_cents, line_total_ttc_cents, k_fo, h_mo, h_mo_majoration, k_mo, k_mo_atelier, k_mo_chantier,
    source_provider, source_metadata), ';' ORDER BY position, title), '')))
FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid AND item_type = 'line' AND position >= ${fromPosition};
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

/** The content revision of a version and the audit rows journaled for it so far, to compare around one request. */
async function revisionAndAudit(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('revision', v.content_revision,
  'itemInserts', (SELECT count(*) FROM public.audit_logs a WHERE a.estimate_version_id = v.id AND a.table_name = 'estimate_items' AND a.action = 'INSERT'),
  'versionUpdates', (SELECT count(*) FROM public.audit_logs a WHERE a.estimate_version_id = v.id AND a.table_name = 'estimate_versions' AND a.action = 'UPDATE'),
  'lastAuditAt', (SELECT max(a.created_at) FROM public.audit_logs a WHERE a.estimate_version_id = v.id))
FROM public.estimate_versions v WHERE v.id = '${versionId}'::uuid;
`);
  return JSON.parse(row) as { revision: number; itemInserts: number; versionUpdates: number; lastAuditAt: string | null };
}

/** Revision steps and audit rows written for a version by one request, and the distinct users they name. */
async function effectsSince(versionId: string, before: Awaited<ReturnType<typeof revisionAndAudit>>) {
  const after = await revisionAndAudit(versionId);
  const since = before.lastAuditAt ? `AND a.created_at > '${before.lastAuditAt}'::timestamptz` : "";
  const [actors] = await querySql(`SELECT coalesce(jsonb_agg(DISTINCT a.user_id), '[]') FROM public.audit_logs a
WHERE a.estimate_version_id = '${versionId}'::uuid ${since};
`);
  return {
    revisions: after.revision - before.revision,
    itemInserts: after.itemInserts - before.itemInserts,
    versionUpdates: after.versionUpdates - before.versionUpdates,
    actors: JSON.parse(actors) as string[],
  };
}

/** The totals the editor reads (GET /api/estimates/{id}). */
async function readTotals(browser: Browser, versionId: string) {
  return triple((await readEstimate(browser, versionId)).version);
}

/** A linked DPGF of the owned affaire: an import and `count` priced mapped rows in reading order, row g is 1 u at 0,05·g €. */
async function seedLinkedDpgf(tenantId: string, projectId: string, filename: string, lineLabel: string, count: number) {
  if (!UUID.test(tenantId) || !UUID.test(projectId) || !/^ARMY-[A-Za-z0-9-]{1,80}\.xlsx$/.test(filename) || !LABEL.test(lineLabel) ||
    !Number.isSafeInteger(count) || count < 1 || count > 5000) {
    throw new Error("Invalid linked DPGF fixture input.");
  }
  const importId = randomUUID();
  const output = await querySql(`BEGIN;
INSERT INTO public.dpgf_imports (id, tenant_id, user_id, filename, source_format, status, row_count, parse_mode, project_id)
SELECT '${importId}'::uuid, p.tenant_id, p.user_id, '${filename}', 'xlsx', 'completed', ${count}, 'server', p.id
FROM public.estimate_projects p WHERE p.id = '${projectId}'::uuid AND p.tenant_id = '${tenantId}'::uuid;
INSERT INTO public.dpgf_rows_mapped (tenant_id, import_id, payload, status, created_at)
SELECT '${tenantId}'::uuid, '${importId}'::uuid, jsonb_build_object('row_index', g, 'designation', '${lineLabel} ' || g, 'unit', 'u',
    'quantity', '1', 'unit_price_ht', replace(to_char(g * 5 / 100.0, 'FM999990.00'), '.', ',')),
  'mapped', now() + g * interval '1 millisecond'
FROM generate_series(1, ${count}) AS g
WHERE EXISTS (SELECT 1 FROM public.dpgf_imports i WHERE i.id = '${importId}'::uuid);
COMMIT;
SELECT count(*) FROM public.dpgf_rows_mapped WHERE import_id = '${importId}'::uuid;
`);
  if (output.at(-1) !== String(count)) throw new Error("The linked DPGF fixture was not persisted.");
  return importId;
}

armyTest("LC01 a section of 999 lines of a v2 draft duplicated in place copies every line with its per-item effects", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [versionId], owner } = await v2Drafts(browser, army, "duplicate");
    const { result: sectionId, ms: seedMs } = await timed(() => seedSection(owner.tenantId, versionId, `${army.runPrefix} lot`, LINES));
    const source = await sectionLines(sectionId);
    await retakeLease(browser, versionId);
    const before = await revisionAndAudit(versionId);
    type Duplicated = { duplicated_section_id: string; copied_item_count: number; totals: Totals };
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Duplicated>>(browser, "POST",
      `/api/estimates/${versionId}/sections/${sectionId}/duplicate`, {}));
    const copyId = response.body.data?.duplicated_section_id;
    const observed = {
      response: responseOf(response),
      copiedItems: response.body.data?.copied_item_count ?? null,
      copy: copyId ? await sectionLines(copyId) : null,
      totals: triple(response.body.data?.totals),
      read: await readTotals(browser, versionId),
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "lc01-duplicate-in-place", { versionId, sectionId, copyId: copyId ?? null,
      elapsedMs: { seed: seedMs, copy: ms }, source, error: response.body.error ?? null, observed });
    const expected = times(2, SECTION);
    expect(observed).toEqual({
      response: [201, true, null],
      copiedItems: LINES + 1,
      copy: source,
      totals: expected,
      read: expected,
      sql: { engine: 2, stored: expected, lines: 2 * LINES, lineSums: expected },
      effects: { revisions: LINES + 2, itemInserts: LINES + 1, versionUpdates: LINES + 2, actors: [owner.userId] },
    });
  });

armyTest("LC02 a section of 999 lines imported into an empty v2 draft copies every line with its per-item effects", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [sourceId, targetId], owner } = await v2Drafts(browser, army, "import", 1);
    const { result: sectionId, ms: seedMs } = await timed(() => seedSection(owner.tenantId, sourceId, `${army.runPrefix} lot`, LINES));
    const source = await sectionLines(sectionId);
    await retakeLease(browser, targetId);
    const before = await revisionAndAudit(targetId);
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Imported>>(browser, "POST",
      `/api/estimates/${targetId}/import-sections`, { source_version_id: sourceId, section_ids: [sectionId], mode: "append" }));
    const copyId = response.body.data?.created_section_ids?.[0];
    const observed = {
      response: responseOf(response),
      imported: [response.body.data?.imported_lines_count ?? null, response.body.data?.created_line_ids?.length ?? null],
      copy: copyId ? await sectionLines(copyId) : null,
      totals: triple(response.body.data?.totals),
      read: await readTotals(browser, targetId),
      sql: await versionTruth(targetId),
      effects: await effectsSince(targetId, before),
    };
    await recordEvidence(army, "lc02-import-into-empty-v2", { sourceId, targetId, sectionId, copyId: copyId ?? null,
      elapsedMs: { seed: seedMs, import: ms }, source, error: response.body.error ?? null, observed });
    expect(observed).toEqual({
      response: [201, true, null],
      imported: [LINES, LINES],
      copy: source,
      totals: SECTION,
      read: SECTION,
      sql: { engine: 2, stored: SECTION, lines: LINES, lineSums: SECTION },
      effects: { revisions: LINES + 2, itemInserts: LINES + 1, versionUpdates: LINES + 2, actors: [owner.userId] },
    });
  });

armyTest("LC03 a section of 999 lines merged into a same-titled section of another v2 draft lands after its lines", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [sourceId, targetId], owner } = await v2Drafts(browser, army, "merge", 1);
    const title = `${army.runPrefix} lot`;
    const { result: sourceSectionId, ms: seedMs } = await timed(() => seedSection(owner.tenantId, sourceId, title, LINES));
    const targetSectionId = await seedSection(owner.tenantId, targetId, title, 2);
    const source = await sectionLines(sourceSectionId);
    await retakeLease(browser, targetId);
    const before = await revisionAndAudit(targetId);
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Imported>>(browser, "POST",
      `/api/estimates/${targetId}/import-sections`, { source_version_id: sourceId, section_ids: [sourceSectionId], mode: "merge" }));
    const observed = {
      response: responseOf(response),
      imported: [response.body.data?.imported_lines_count ?? null, response.body.data?.created_section_ids?.length ?? null],
      target: await sectionLines(targetSectionId),
      merged: await sectionLines(targetSectionId, 3),
      totals: triple(response.body.data?.totals),
      sql: await versionTruth(targetId),
      effects: await effectsSince(targetId, before),
    };
    await recordEvidence(army, "lc03-merge-into-v2", { sourceId, targetId, sourceSectionId, targetSectionId,
      elapsedMs: { seed: seedMs, merge: ms }, source, error: response.body.error ?? null, observed });
    const expected = add(range(1, 2), SECTION);
    expect(observed).toMatchObject({
      response: [201, true, null],
      imported: [LINES, 0],
      target: { lines: LINES + 2, distinctPositions: LINES + 2, positions: [1, LINES + 2], sums: expected },
      // The merged lines keep their content; only their positions move after the 2 existing lines.
      merged: { lines: LINES, distinctPositions: LINES, positions: [3, LINES + 2], sums: SECTION, digest: source.digest },
      totals: expected,
      sql: { engine: 2, stored: expected, lines: LINES + 2, lineSums: expected },
      effects: { revisions: LINES + 1, itemInserts: LINES, versionUpdates: LINES + 1, actors: [owner.userId] },
    });
  });

armyTest("LC04 a linked DPGF of 1 001 priced rows imported into a v2 draft imports every row with its per-item effects", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { projectId, versionIds: [versionId], owner } = await v2Drafts(browser, army, "dpgf");
    const rows = 1001;
    const { result: importId, ms: seedMs } = await timed(() => seedLinkedDpgf(owner.tenantId, projectId, `${army.runPrefix}-dpgf.xlsx`,
      `${army.runPrefix} dpgf ligne`, rows));
    await retakeLease(browser, versionId);
    const before = await revisionAndAudit(versionId);
    type LinkedImport = { created_section_id: string; imported_lines_count: number; skipped_lines_count: number; totals: Totals };
    const { result: imported, ms } = await timed(() => apiRequest<Envelope<LinkedImport>>(browser, "POST",
      `/api/estimates/${versionId}/import-linked-dpgf`, {}));
    const sectionId = imported.body.data?.created_section_id;
    const observed = {
      response: responseOf(imported),
      counts: [imported.body.data?.imported_lines_count ?? null, imported.body.data?.skipped_lines_count ?? null],
      section: sectionId ? await sectionLines(sectionId) : null,
      totals: triple(imported.body.data?.totals),
      read: await readTotals(browser, versionId),
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "lc04-linked-dpgf-into-v2", { projectId, versionId, importId, sectionId: sectionId ?? null,
      elapsedMs: { seed: seedMs, import: ms }, error: imported.body.error ?? null, observed });
    const priced = range(1, rows);
    expect(observed).toMatchObject({
      response: [201, true, null],
      counts: [rows, 0],
      section: { lines: rows, distinctPositions: rows, positions: [1, rows], sums: priced },
      totals: priced,
      read: priced,
      sql: { engine: 2, stored: priced, lines: rows, lineSums: priced },
      effects: { revisions: rows + 2, itemInserts: rows + 1, versionUpdates: rows + 2, actors: [owner.userId] },
    });
  });

armyTest("LC05 a section of 12 lines duplicated in place keeps one revision and audit row per item (control)", options,
  async ({ app, browser, army }) => {
    await app.open("/dashboard/affaires");
    const { versionIds: [versionId], owner } = await v2Drafts(browser, army, "small");
    const lines = 12;
    const sectionId = await seedSection(owner.tenantId, versionId, `${army.runPrefix} lot`, lines);
    const source = await sectionLines(sectionId);
    await retakeLease(browser, versionId);
    const before = await revisionAndAudit(versionId);
    type Duplicated = { duplicated_section_id: string; copied_item_count: number; totals: Totals };
    const { result: response, ms } = await timed(() => apiRequest<Envelope<Duplicated>>(browser, "POST",
      `/api/estimates/${versionId}/sections/${sectionId}/duplicate`, {}));
    const copyId = response.body.data?.duplicated_section_id;
    const observed = {
      response: responseOf(response),
      copy: copyId ? await sectionLines(copyId) : null,
      sql: await versionTruth(versionId),
      effects: await effectsSince(versionId, before),
    };
    await recordEvidence(army, "lc05-small-duplicate-control", { versionId, sectionId, copyId: copyId ?? null, elapsedMs: { copy: ms },
      source, observed });
    const expected = times(2, range(1, lines));
    expect(observed).toEqual({
      response: [201, true, null],
      copy: source,
      sql: { engine: 2, stored: expected, lines: 2 * lines, lineSums: expected },
      effects: { revisions: lines + 2, itemInserts: lines + 1, versionUpdates: lines + 2, actors: [owner.userId] },
    });
  });
