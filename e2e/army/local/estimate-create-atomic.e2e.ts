import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState, type ArmyVersion,
} from "../critical/fixtures";
import { sdkResultsRoot } from "./sdk-results";

// Pre-code oracle: docs/testing/estimate-create-atomic.md.
// No editor, autosave or supplied header totals may repair a POST observation.
type Fixture = {
  schemaVersion: "estimate-create-atomic-fixture-1";
  status: "ready"; prefix: string; apiUrl: string;
  owner: { userId: string; tenantId: string; laborRoleId: string };
  legacyV1: { projectId: string; versionId: string };
  legacySplitV1: { projectId: string; versionId: string };
};
type Ui = { app: App; browser: Browser; screen: Screen; army: ArmyState };
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Creation = { item: ArmyItem; version: { id: string; updated_at: string } };
type Observation = {
  label: string; observedAt: string; request: Record<string, unknown>;
  response: { status: number; body: Envelope<Creation> }; state: ArmyEstimate;
  expectedTotals: number[]; expectedHours: number;
};
const options = { session: "army", tags: ["source-coverage", "create-atomic"], trace: "off" as const, timeout: 180_000 };
const totals = (version: ArmyVersion) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
// DPGF export « Majoration MO (%) »: the stored coefficient in percent, 100 = neutral (P-11, sub-lot 2.3).
const majorationPercent = (coefficient: number) => Math.round(coefficient * 10000) / 100;
const values = (item: ArmyItem) => ({
  id: item.id, parent_id: item.parent_id, position: item.position, item_type: item.item_type,
  title: item.title, description: item.description, quantity: item.quantity,
  unit_price_ht_cents: item.unit_price_ht_cents, tax_rate_bp: item.tax_rate_bp,
  k_fo: item.k_fo, h_mo: item.h_mo, h_mo_majoration: item.h_mo_majoration,
  k_mo: item.k_mo, labor_role_id: item.labor_role_id,
  pu_ht_cents: item.pu_ht_cents, line_total_ht_cents: item.line_total_ht_cents,
  line_tax_cents: item.line_tax_cents, line_total_ttc_cents: item.line_total_ttc_cents,
});

async function loadFixture() {
  const file = process.env.E2E_CREATE_ATOMIC_FIXTURE_PATH;
  if (!file) throw new Error("Explicit create-atomic fixture required.");
  const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (fixture.schemaVersion !== "estimate-create-atomic-fixture-1" || fixture.status !== "ready" ||
    !fixture.prefix.startsWith("ARMY-CREATE-ATOMIC-") || fixture.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN ||
    fixture.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ![...Object.values(fixture.owner), ...Object.values(fixture.legacyV1), ...Object.values(fixture.legacySplitV1)].every((id) => uuid.test(id))) {
    throw new Error("Atomic creation fixture does not match its authorized local profile.");
  }
  return fixture;
}

async function setSplitFlag(ui: Ui, fixture: Fixture, enabled: boolean) {
  const response = await apiRequest<Envelope<{ tenant_id: string; flag: { flag_key: string; enabled: boolean } }>>(ui.browser, "PATCH", "/api/feature-flags", { tenant_id: fixture.owner.tenantId, flag_key: "EST_031_LABOR_SPLIT", enabled });
  await recordEvidence(ui.army, `ca02-split-${enabled ? "on" : "off"}`, response);
  expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
  expect([response.body.data.tenant_id, response.body.data.flag.flag_key, response.body.data.flag.enabled]).toEqual([fixture.owner.tenantId, "EST_031_LABOR_SPLIT", enabled]);
}

async function newV2(ui: Ui, fixture: Fixture, label: string) {
  const response = await apiRequest<Envelope<{ project: { id: string }; version: ArmyVersion }>>(ui.browser, "POST", "/api/estimates", {
    project: { name: `${fixture.prefix}-${label}` },
    version: { title: label, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
      discount_bp: 0, discount_mode: "simple", discount_steps: [], global_coefficient: 1,
      tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, currency: "EUR", contractor_role: "principal" },
  });
  await recordEvidence(ui.army, `${label}-version-response`, response);
  expect(response.status).toBe(201); expect(response.body.ok).toBe(true);
  const owned = { projectId: response.body.data.project.id, versionId: response.body.data.version.id };
  ownEstimate(ui.army, owned);
  const state = await readEstimate(ui.browser, owned.versionId);
  expect(state.version.calc_engine_version).toBe(2); expect(state.items).toHaveLength(0);
  expect(totals(state.version)).toEqual([0, 0, 0]);
  return owned;
}

// Session identity is generated and compared only inside the browser. Never
// return it or pass it as an SDK argument, which would archive the raw value.
async function lock(browser: Browser, versionId: string, release = false) {
  return JSON.parse(await browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __armyAtomicLocks?: Map<string, string> };
    const sessions = scope.__armyAtomicLocks ??= new Map<string, string>();
    let sessionId = sessions.get(input.versionId);
    if (!sessionId && !input.release) { sessionId = crypto.randomUUID(); sessions.set(input.versionId, sessionId); }
    if (!sessionId) throw new Error("Owned ordinary API lock identity is missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": sessionId }, body: "{}",
    });
    const body = await response.json();
    const held = body.data?.lock;
    return JSON.stringify({ status: response.status, ok: body.ok === true,
      released: body.data?.released === true, versionMatches: held?.version_id === input.versionId,
      sessionMatches: held?.session_id === sessionId, currentUser: held?.is_current_user === true,
      currentSession: held?.is_current_session === true, expired: held?.is_expired === true,
      errorCode: body.error?.code ?? null });
  }, { versionId, release })) as { status: number; ok: boolean; released: boolean; versionMatches: boolean; sessionMatches: boolean; currentUser: boolean; currentSession: boolean; expired: boolean; errorCode: string | null };
}

async function acquire(ui: Ui, versionId: string, label: string) {
  const result = await lock(ui.browser, versionId);
  await recordEvidence(ui.army, `${label}-lock`, result);
  expect([result.status, result.ok, result.versionMatches, result.sessionMatches, result.currentUser, result.currentSession, result.expired]).toEqual([201, true, true, true, true, true, false]);
}

async function release(ui: Ui, versionId: string, label: string) {
  const result = await lock(ui.browser, versionId, true);
  await recordEvidence(ui.army, `${label}-release`, result);
  expect([result.status, result.ok, result.released, result.sessionMatches]).toEqual([200, true, true, true]);
}

async function create(ui: Ui, versionId: string, label: string, request: Record<string, unknown>, expectedTotals: number[], expectedHours: number) {
  const previous = await readEstimate(ui.browser, versionId);
  const response = JSON.parse(await ui.browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __armyAtomicLocks?: Map<string, string> };
    const sessionId = scope.__armyAtomicLocks?.get(input.versionId);
    if (!sessionId) throw new Error("Owned ordinary API lock identity is missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/items`, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "if-match": input.updatedAt, "x-estimate-draft-lock-session-id": sessionId },
      body: input.body,
    });
    const payload = await response.json();
    const body = payload.ok === true ? payload : { ok: false, error: { code: payload.error?.code, message: payload.error?.message } };
    return JSON.stringify({ status: response.status, body });
  }, { versionId, body: JSON.stringify(request), updatedAt: previous.version.updated_at })) as Observation["response"];
  await recordEvidence(ui.army, `${label}-response`, { request, response });
  expect(response.status).toBe(201); expect(response.body.ok).toBe(true);
  const state = await readEstimate(ui.browser, versionId); // first read after 201; no retry/poll
  const observation: Observation = { label, observedAt: new Date().toISOString(), request, response, state, expectedTotals, expectedHours };
  await recordEvidence(ui.army, `${label}-immediate`, observation);
  expect([response.body.data.version.id, response.body.data.version.updated_at]).toEqual([versionId, state.version.updated_at]);
  expect(state.items).toHaveLength(previous.items.length + 1);
  const created = state.items.find((item) => item.id === response.body.data.item.id);
  expect(created).toBeDefined(); expect(values(created!)).toEqual(values(response.body.data.item));
  for (const old of previous.items) expect(values(state.items.find((item) => item.id === old.id)!)).toEqual(values(old));
  return observation;
}

function assertImmediate(observation: Observation) {
  expect(totals(observation.state.version)).toEqual(observation.expectedTotals);
  const lines = observation.state.items.filter((item) => item.item_type === "line");
  expect(lines.reduce((sum, item) => sum + Number(item.h_mo ?? 0), 0)).toBe(observation.expectedHours);
  expect(lines.reduce((sum, item) => sum + Number(item.line_total_ht_cents), 0)).toBe(observation.expectedTotals[0]);
  expect(lines.reduce((sum, item) => sum + Number(item.line_tax_cents), 0)).toBe(observation.expectedTotals[1]);
  expect(lines.reduce((sum, item) => sum + Number(item.line_total_ttc_cents), 0)).toBe(observation.expectedTotals[2]);
}

async function assertExports(ui: Ui, versionId: string, lines: ArmyItem[], sectionIds: string[]) {
  const root = sdkResultsRoot();
  const allFiles = async () => (await readdir(root, { recursive: true })).map((entry) => path.resolve(root, entry));
  for (const mode of ["standard", "dpgf"] as const) {
    const previous = new Set(await allFiles());
    if (mode === "standard") await ui.screen.getByRole("button", "Exporter", { exact: true }).tap();
    else await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const download = await ui.browser.waitForDownload(() => mode === "standard"
      ? ui.screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap()
      : ui.screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 });
    const returned = path.normalize(download.path);
    if (returned.split(path.sep).includes("..")) throw new Error("Download path escaped its artifact root.");
    const found = (await allFiles()).filter((file) => !previous.has(file) && (path.isAbsolute(returned) ? file === returned : file.endsWith(path.sep + returned)));
    expect(found).toHaveLength(1);
    const bytes = await readFile(found[0]), workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheets: Record<string, Array<Array<string | number | null>>> = {};
    for (const sheet of workbook.worksheets) {
      sheets[sheet.name] = [];
      sheet.eachRow((row) => sheets[sheet.name].push(Array.from({ length: sheet.columnCount }, (_, index) => {
        const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null;
      })));
    }
    await recordEvidence(ui.army, `ca01-export-${mode}`, { versionId, artifact: { path: found[0], sha256: createHash("sha256").update(bytes).digest("hex") }, sheets });
    if (mode === "standard") {
      for (const line of lines) {
        const rows = sheets.Devis.filter((row) => String(row[1]).trim() === line.title);
        expect(rows).toHaveLength(1);
        expect(rows[0].slice(2, 8)).toEqual([line.description, line.quantity, Number(line.pu_ht_cents) / 100, Number(line.line_total_ht_cents) / 100, Number(line.line_tax_cents) / 100, Number(line.line_total_ttc_cents) / 100]);
      }
      for (const [name, value] of [["Total HT", 710], ["Total TVA", 142], ["Total TTC", 852]]) expect(sheets.Resume.filter((row) => row[0] === name).map((row) => row[1])).toEqual([value]);
    } else {
      const ids = [...sectionIds, ...lines.map((line) => line.id)];
      const rows = sheets.Données.filter((row) => ids.includes(String(row[1])));
      expect(rows.map((row) => row[1]).sort()).toEqual([...ids].sort());
      for (const line of lines) {
        const row = rows.find((candidate) => candidate[1] === line.id)!;
        expect([String(row[2]).trim(), ...row.slice(3, 6), ...row.slice(7, 11)]).toEqual([line.title, line.quantity, line.description, Number(line.unit_price_ht_cents) / 100, line.k_fo, line.h_mo, line.k_mo, majorationPercent(Number(line.h_mo_majoration))]);
      }
    }
  }
}

armyTest("CA01 each API creation immediately persists exact V2 totals, then reload and exports need no repair", options, async (ui) => {
  const fixture = await loadFixture();
  await ui.app.open("/dashboard/estimates");
  const owned = await newV2(ui, fixture, "ca01");
  await acquire(ui, owned.versionId, "ca01");
  const observed: Observation[] = [];
  let final: ArmyEstimate;
  try {
    const a = await create(ui, owned.versionId, "ca01-section-a", { item_type: "section", title: "ARMY Lot A", position: 1 }, [0, 0, 0], 0);
    const b = await create(ui, owned.versionId, "ca01-section-b", { item_type: "section", title: "ARMY Lot B", position: 2 }, [0, 0, 0], 0);
    observed.push(a, b);
    const specs = [
      ["L1 réseau CH-A", "m", 10, 4000, 0.5, 5, a.response.body.data.item.id, 1, [40000, 8000, 48000], 5],
      ["L2 protection droite", "m", 4, 1000, 1, 1, a.response.body.data.item.id, 2, [48000, 9600, 57600], 6],
      ["L3 protection raccords", "u", 2, 1500, 1, 0.5, a.response.body.data.item.id, 3, [53000, 10600, 63600], 6.5],
      ["L4 canalisation ECS-B", "m", 6, 2000, 1, 1.5, b.response.body.data.item.id, 1, [71000, 14200, 85200], 8],
    ] as const;
    for (const [index, spec] of specs.entries()) {
      const [title, unit, quantity, price, kFo, hMo, parentId, position, expected, hours] = spec;
      observed.push(await create(ui, owned.versionId, `ca01-line-${index + 1}`, { item_type: "line", line_nature: "supply_and_labor", title: `${fixture.prefix} ${title}`, description: unit, quantity, unit_price_ht_cents: price, k_fo: kFo, h_mo: hMo, h_mo_majoration: 1, k_mo: 1, labor_role_id: fixture.owner.laborRoleId, tax_rate_bp: 2000, parent_id: parentId, position }, [...expected], hours));
    }
    await recordEvidence(ui.army, "ca01-immediate-summary", { versionId: owned.versionId, editorOpened: false, explicitSave: false, observations: observed });
    // Retain every immediate observation before the first monetary failure.
    for (const observation of observed) assertImmediate(observation);
    final = observed.at(-1)!.state;
  } finally { await release(ui, owned.versionId, "ca01"); }

  const bulk = new URL(`/api/estimates/${owned.versionId}/items/bulk`, ui.app.baseUrl!).href;
  const writes: Array<{ method: string; observedAt: string }> = [];
  await ui.browser.route(bulk, async (route) => { if (route.request.method !== "GET") writes.push({ method: route.request.method, observedAt: new Date().toISOString() }); await route.fallback(); });
  const dialogs: string[] = [];
  const dispose = await ui.browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.dismiss(); });
  try {
    await ui.app.open(`/dashboard/estimates/${owned.versionId}/edit`);
    const firstLine = final.items.find((item) => item.item_type === "line")!;
    for (const phase of ["opened", "reloaded"] as const) {
      if (phase === "reloaded") await ui.browser.reload({ timeout: 15_000 });
      await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      await expect(ui.screen.getByLabel(`Quantité pour ${firstLine.title}`, { exact: true })).toBeEnabled();
      await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
      const state = await readEstimate(ui.browser, owned.versionId);
      await recordEvidence(ui.army, `ca01-${phase}`, { state, writes, dialogs });
      expect(totals(state.version)).toEqual([71000, 14200, 85200]);
      expect(state.items.map(values)).toEqual(final.items.map(values));
      expect(writes).toHaveLength(0); expect(dialogs).toHaveLength(0);
    }
    await assertExports(ui, owned.versionId, final.items.filter((item) => item.item_type === "line"), final.items.filter((item) => item.item_type === "section").map((item) => item.id));
    expect(writes).toHaveLength(0);
  } finally {
    await recordEvidence(ui.army, "ca01-no-repair-observation", { versionId: owned.versionId, writes, dialogs, scope: "editor open, real reload and the two downloads only" });
    await dispose(); await ui.browser.unroute(bulk);
  }
});

armyTest("CA02 V2 and legacy V1 keep chapters, omitted draft fields and positive hours without a role", options, async (ui) => {
  const fixture = await loadFixture();
  await ui.app.open("/dashboard/estimates");
  const v2 = await newV2(ui, fixture, "ca02-v2");
  const observations: Observation[] = [];
  await setSplitFlag(ui, fixture, false);
  for (const [engine, owned] of [[2, v2], [1, fixture.legacyV1]] as const) {
    ownEstimate(ui.army, owned);
    const label = `ca02-v${engine}`;
    const initial = await readEstimate(ui.browser, owned.versionId);
    await recordEvidence(ui.army, `${label}-initial`, initial);
    expect(initial.version.calc_engine_version).toBe(engine); expect(initial.version.status).toBe("draft");
    expect(initial.items).toHaveLength(0); expect(totals(initial.version)).toEqual([0, 0, 0]);
    expect([initial.version.margin_mode, initial.version.margin_multiplier, initial.version.discount_bp, initial.version.tax_rate_bp, initial.version.rounding_mode, initial.version.global_coefficient]).toEqual(["fixed", 1, 0, 2000, "none", 1]);
    await acquire(ui, owned.versionId, label);
    try {
      const section = await create(ui, owned.versionId, `${label}-section`, { item_type: "section" }, [0, 0, 0], 0);
      const chapter = section.response.body.data.item;
      expect(chapter.title).toBe("Nouveau lot");
      expect([chapter.quantity, chapter.unit_price_ht_cents, chapter.line_total_ht_cents, chapter.line_tax_cents, chapter.line_total_ttc_cents]).toEqual([null, null, null, null, null]);
      const draft = await create(ui, owned.versionId, `${label}-omitted`, { item_type: "line", parent_id: chapter.id }, [0, 0, 0], 0);
      const incomplete = draft.response.body.data.item;
      expect([incomplete.title, incomplete.quantity, incomplete.unit_price_ht_cents, incomplete.h_mo, incomplete.labor_role_id]).toEqual(["Nouvelle ligne", 1, 0, 0, null]);
      const noRole = await create(ui, owned.versionId, `${label}-hours-no-role`, { item_type: "line", parent_id: chapter.id, title: `${fixture.prefix} heures sans rôle V${engine}`, quantity: 2, unit_price_ht_cents: 1000, h_mo: 1 }, [2000, 400, 2400], 1);
      expect([noRole.response.body.data.item.h_mo, noRole.response.body.data.item.labor_role_id]).toEqual([1, null]);
      const nextChapter = await create(ui, owned.versionId, `${label}-chapter-after-lines`, { item_type: "section", parent_id: chapter.id }, [2000, 400, 2400], 1);
      expect(nextChapter.response.body.data.item.title).toBe("Nouveau chapitre");
      for (const observation of [section, draft, noRole, nextChapter]) expect(observation.state.version.calc_engine_version).toBe(engine);
      observations.push(section, draft, noRole, nextChapter);
      if (engine === 1) {
        observations.push(await create(ui, owned.versionId, "ca02-v1-split-off", { item_type: "line", parent_id: chapter.id, title: `${fixture.prefix} split OFF`, quantity: 2, unit_price_ht_cents: 1000, h_mo: 1, labor_role_id: fixture.owner.laborRoleId, h_mo_atelier: 3, labor_role_atelier_id: fixture.owner.laborRoleId }, [8000, 1600, 9600], 2));
      }
    } finally { await release(ui, owned.versionId, label); }
  }
  await setSplitFlag(ui, fixture, true);
  const split = fixture.legacySplitV1;
  ownEstimate(ui.army, split);
  const initialSplit = await readEstimate(ui.browser, split.versionId);
  expect(initialSplit.version.calc_engine_version).toBe(1); expect(initialSplit.items).toHaveLength(0);
  expect(totals(initialSplit.version)).toEqual([0, 0, 0]);
  await acquire(ui, split.versionId, "ca02-v1-split-on");
  try {
    const parent = await create(ui, split.versionId, "ca02-v1-split-on-parent", { item_type: "section" }, [0, 0, 0], 0);
    observations.push(parent);
    observations.push(await create(ui, split.versionId, "ca02-v1-split-on", { item_type: "line", parent_id: parent.response.body.data.item.id, title: `${fixture.prefix} split ON`, quantity: 2, unit_price_ht_cents: 1000, h_mo: 1, labor_role_id: fixture.owner.laborRoleId, h_mo_atelier: 3, labor_role_atelier_id: fixture.owner.laborRoleId }, [14000, 2800, 16800], 1));
    observations.push(await create(ui, split.versionId, "ca02-v1-split-on-chapter", { item_type: "section" }, [14000, 2800, 16800], 1));
  } finally { await release(ui, split.versionId, "ca02-v1-split-on"); }
  await recordEvidence(ui.army, "ca02-both-engine-observations", { observations, editorOpened: false, explicitSave: false, publicationAttempted: false });
  for (const observation of observations) assertImmediate(observation);
});

armyTest("CA03 API creation calculates from PostgreSQL quantity, coefficient and hour-majoration precision", options, async (ui) => {
  const fixture = await loadFixture();
  await ui.app.open("/dashboard/estimates");
  const owned = await newV2(ui, fixture, "ca03");
  await acquire(ui, owned.versionId, "ca03");
  const observed: Observation[] = [];
  try {
    const parent = await create(ui, owned.versionId, "ca03-parent", { item_type: "section" }, [0, 0, 0], 0);
    assertImmediate(parent);
    const parent_id = parent.response.body.data.item.id;
    observed.push(await create(ui, owned.versionId, "ca03-quantity-half", { item_type: "line", parent_id, title: `${fixture.prefix} quantité demi-précision`, quantity: 1.0005, unit_price_ht_cents: 100000 }, [100100, 20020, 120120], 0));
    observed.push(await create(ui, owned.versionId, "ca03-coefficient-half", { item_type: "line", parent_id, title: `${fixture.prefix} coefficient demi-précision`, quantity: 1, unit_price_ht_cents: 100000, k_fo: 1.0005 }, [200200, 40040, 240240], 0));
    observed.push(await create(ui, owned.versionId, "ca03-majoration-half", { item_type: "line", parent_id, title: `${fixture.prefix} majoration demi-précision`, quantity: 1, unit_price_ht_cents: 0, h_mo: 100, h_mo_majoration: 1.00005, labor_role_id: fixture.owner.laborRoleId }, [600240, 120048, 720288], 100));
    await recordEvidence(ui.army, "ca03-precision-observations", { observations: observed, editorOpened: false, explicitSave: false });
    expect(observed[0].response.body.data.item.quantity).toBe(1.001);
    expect(observed[1].response.body.data.item.k_fo).toBe(1.001);
    expect(observed[2].response.body.data.item.h_mo_majoration).toBe(1.0001);
    for (const observation of observed) assertImmediate(observation);
  } finally { await release(ui, owned.versionId, "ca03"); }
});
