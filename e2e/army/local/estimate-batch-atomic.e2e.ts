import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyVersion,
} from "../critical/fixtures";

// Pre-code failures: docs/testing/estimate-workflow-atomicity.md, WFC-01.
// Reuse the dedicated create-atomic owner fixture and ordinary `army` UI login.
// Its explicit batch-atomic profile selects auth + WFC01. No new seed or injected auth.
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type CreatedItem = { item: ArmyItem; version: { id: string; updated_at: string } };
type BatchResult = {
  committed: boolean;
  results: Array<{ index: number; op: string; status: string; code?: string; data?: unknown }>;
  version: { id: string; updated_at: string };
};
type OwnerFixture = {
  schemaVersion: "estimate-create-atomic-fixture-1";
  status: "ready";
  prefix: string;
  apiUrl: string;
  owner: { userId: string; tenantId: string; laborRoleId: string };
};
type LockResult = {
  status: number; ok: boolean; released: boolean;
  versionMatches: boolean; sessionMatches: boolean;
  currentUser: boolean; currentSession: boolean; expired: boolean;
};
const totals = (version: ArmyVersion) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
const preservedFields = [
  "id", "parent_id", "item_type", "position", "title", "description", "aid",
  "quantity", "unit_price_ht_cents", "tax_rate_bp", "k_fo", "h_mo", "h_mo_majoration", "k_mo",
  "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id", "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id",
  "labor_role_id", "category_id", "supply_type_id", "product_id", "selected_supplier_price_id", "line_nature",
  "source_provider", "source_job_id", "source_file_name", "source_page",
  "pu_ht_cents", "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents",
] as const;
const preservedItems = (state: ArmyEstimate) => [...state.items]
  .sort((left, right) => left.id.localeCompare(right.id))
  .map((item) => Object.fromEntries(preservedFields.map((field) => [field, item[field]])));

async function loadOwnerFixture() {
  const filename = process.env.E2E_CREATE_ATOMIC_FIXTURE_PATH;
  if (!filename) throw new Error("Explicit local create-atomic owner fixture required for WFC-01.");
  const bytes = await readFile(filename);
  const fixture = JSON.parse(bytes.toString("utf8")) as OwnerFixture;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (fixture.schemaVersion !== "estimate-create-atomic-fixture-1" || fixture.status !== "ready" ||
    !fixture.prefix.startsWith("ARMY-CREATE-ATOMIC-") ||
    fixture.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || fixture.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ![fixture.owner.userId, fixture.owner.tenantId, fixture.owner.laborRoleId].every((id) => uuid.test(id))) {
    throw new Error("WFC-01 fixture does not match its explicitly authorized local profile.");
  }
  const origin = new URL(fixture.apiUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1") {
    throw new Error("WFC-01 requires the dedicated local stack.");
  }
  return { fixture, sha256: createHash("sha256").update(bytes).digest("hex") };
}

// The helper shares apiRequest's browser-local lock store. Raw session identity
// stays inside the browser; neither SDK arguments nor evidence contain it.
async function changeLock(browser: Browser, versionId: string, release = false): Promise<LockResult> {
  return JSON.parse(await browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let sessionId = sessions.get(input.versionId);
    if (!sessionId && !input.release) {
      sessionId = crypto.randomUUID();
      sessions.set(input.versionId, sessionId);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, sessionId);
    }
    if (!sessionId) throw new Error("Owned lock identity missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin", redirect: "error",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": sessionId }, body: "{}",
    });
    const payload = await response.json();
    const lock = payload.data?.lock;
    return JSON.stringify({ status: response.status, ok: payload.ok === true, released: payload.data?.released === true,
      versionMatches: lock?.version_id === input.versionId, sessionMatches: lock?.session_id === sessionId,
      currentUser: lock?.is_current_user === true, currentSession: lock?.is_current_session === true, expired: lock?.is_expired === true });
  }, { versionId, release })) as LockResult;
}

armyTest("WFC01 failed ordinary batch preserves both V2 allocations and footer before reload and exports", {
  session: "army", tags: ["source-coverage", "batch-atomic"], trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, army }) => {
  const { fixture, sha256 } = await loadOwnerFixture();
  await app.open("/dashboard/estimates");
  const prefix = `${fixture.prefix}-${army.runPrefix}-WFC01`;
  const created = await apiRequest<Envelope<{ project: { id: string; tenant_id: string; user_id: string }; version: ArmyVersion }>>(
    browser, "POST", "/api/estimates", {
      project: { name: prefix },
      version: { title: "WFC01 batch atomique", margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
        discount_bp: 1667, discount_mode: "simple", discount_steps: [], global_coefficient: 1,
        tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
        currency: "EUR", contractor_role: "principal" },
    });
  await recordEvidence(army, "wfc01-create-version", { fixtureSha256: sha256, response: created });
  expect(created.status).toBe(201); expect(created.body.ok).toBe(true);
  const versionId = created.body.data.version.id;
  ownEstimate(army, { projectId: created.body.data.project.id, versionId });
  expect([created.body.data.project.tenant_id, created.body.data.project.user_id]).toEqual([fixture.owner.tenantId, fixture.owner.userId]);
  const initial = await readEstimate(browser, versionId);
  expect(initial.items).toHaveLength(0); expect(totals(initial.version)).toEqual([0, 0, 0]);
  expect([initial.version.calc_engine_version, initial.version.margin_mode, initial.version.margin_multiplier,
    initial.version.discount_bp, initial.version.discount_mode, initial.version.discount_steps, initial.version.global_coefficient,
    initial.version.rounding_mode, initial.version.contractor_role, initial.version.max_section_depth]).toEqual([2, "fixed", 1, 1667, "simple", [], 1, "none", "principal", 1]);
  const held = await changeLock(browser, versionId);
  await recordEvidence(army, "wfc01-acquire-lock", held);
  expect([held.status, held.ok, held.versionMatches, held.sessionMatches, held.currentUser, held.currentSession, held.expired]).toEqual([201, true, true, true, true, true, false]);

  let before: ArmyEstimate;
  const titleC = `${prefix} C doit disparaître`;
  try {
    const createItem = async (label: string, body: Record<string, unknown>) => {
      const previous = await readEstimate(browser, versionId);
      const response = await apiRequest<Envelope<CreatedItem>>(browser, "POST", `/api/estimates/${versionId}/items`, body, { "if-match": previous.version.updated_at });
      await recordEvidence(army, `wfc01-setup-${label}`, { request: body, response });
      expect(response.status).toBe(201); expect(response.body.ok).toBe(true);
      return response.body.data.item;
    };
    const section = await createItem("section", { item_type: "section", position: 1, title: `${prefix} lot` });
    const lineBody = (title: string, position: number, taxRate: number) => ({
      item_type: "line", line_nature: "supply_only", parent_id: section.id, position, title,
      description: "u", quantity: 1, unit_price_ht_cents: 3, tax_rate_bp: taxRate,
      k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual",
    });
    const a = await createItem("a", lineBody(`${prefix} A`, 1, 2000));
    const b = await createItem("b", lineBody(`${prefix} B`, 2, 0));
    before = await readEstimate(browser, versionId);
    await recordEvidence(army, "wfc01-before-batch", { state: before, expectedTotals: [5, 0, 5], expectedLines: [[a.id, 2, 0, 2], [b.id, 3, 0, 3]], editorOpened: false, explicitSave: false });
    expect(before.items.map((item) => item.id).sort()).toEqual([section.id, a.id, b.id].sort());
    expect(totals(before.version)).toEqual([5, 0, 5]);
    expect(before.items.filter((item) => item.item_type === "line").sort((left, right) => left.position - right.position)
      .map((item) => [item.id, item.position, item.quantity, item.unit_price_ht_cents, item.tax_rate_bp, item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents]))
      .toEqual([[a.id, 1, 1, 3, 2000, 2, 2, 0, 2], [b.id, 2, 1, 3, 0, 3, 3, 0, 3]]);

    const missingId = randomUUID();
    expect(before.items.some((item) => item.id === missingId)).toBe(false);
    const request = { operation_key: randomUUID(), operations: [
      { op: "create", data: lineBody(titleC, 3, 0) },
      { op: "update", id: missingId, data: { title: `${prefix} cible absente` } },
    ] };
    const response = await apiRequest<Envelope<BatchResult>>(browser, "POST", `/api/estimates/${versionId}/batch`, request, { "if-match": before.version.updated_at });
    // First ordinary read, without polling, page navigation, save or repair.
    const after = await readEstimate(browser, versionId);
    await recordEvidence(army, "wfc01-after-batch-before-assertions", {
      request, response, before, after, expectedTotals: [5, 0, 5], editorOpened: false, explicitSave: false,
      intermediateCommittedStateObserved: false,
      note: "Operation results are not proof that an intermediate commit was observed.",
    });
    expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
    expect(response.body.data.committed).toBe(false);
    expect(response.body.data.results.filter((result) => result.index === 1)).toEqual([
      expect.objectContaining({ index: 1, op: "update", status: "error", code: "NOT_FOUND" }),
    ]);
    expect(response.body.data.version).toEqual({ id: versionId, updated_at: after.version.updated_at });
    expect(totals(after.version)).toEqual([5, 0, 5]);
    expect(preservedItems(after)).toEqual(preservedItems(before));
    expect(after.items.some((item) => item.title === titleC || item.id === missingId)).toBe(false);
  } finally {
    const released = await changeLock(browser, versionId, true);
    await recordEvidence(army, "wfc01-release-lock", released);
    expect([released.status, released.ok, released.released, released.sessionMatches]).toEqual([200, true, true, true]);
  }

  const bulkUrl = new URL(`/api/estimates/${versionId}/items/bulk`, app.baseUrl!).href;
  const repairs: Array<{ method: string; at: string }> = [];
  await browser.route(bulkUrl, async (route) => {
    if (route.request.method !== "GET") repairs.push({ method: route.request.method, at: new Date().toISOString() });
    await route.continue();
  });
  const dialogs: string[] = [];
  const dispose = await browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.dismiss(); });
  try {
    await app.open(`/dashboard/estimates/${versionId}/edit`);
    const firstLine = before.items.find((item) => item.item_type === "line")!;
    for (const phase of ["opened", "reloaded"] as const) {
      const originBefore = await browser.evaluate(() => performance.timeOrigin);
      if (phase === "reloaded") await browser.reload({ timeout: 15_000 });
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      await expect(screen.getByLabel(`Quantité pour ${firstLine.title}`, { exact: true })).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
      const originAfter = await browser.evaluate(() => performance.timeOrigin);
      const state = await readEstimate(browser, versionId);
      await recordEvidence(army, `wfc01-${phase}`, { state, originBefore, originAfter, repairs, dialogs });
      if (phase === "reloaded") expect(originAfter > originBefore).toBe(true);
      expect(totals(state.version)).toEqual([5, 0, 5]);
      expect(preservedItems(state)).toEqual(preservedItems(before));
      expect(repairs).toHaveLength(0); expect(dialogs).toHaveLength(0);
    }

    const artifactRoot = path.resolve(process.env.E2E_ARMY_ARTIFACT_ROOT!);
    const allFiles = async () => (await readdir(artifactRoot, { recursive: true })).map((entry) => path.resolve(artifactRoot, entry));
    for (const mode of ["standard", "dpgf"] as const) {
      const oldFiles = new Set(await allFiles());
      if (mode === "standard") await screen.getByRole("button", "Exporter", { exact: true }).tap();
      else await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
      const download = await browser.waitForDownload(() => mode === "standard"
        ? screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap()
        : screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 });
      const returned = path.normalize(download.path);
      const matches = (await allFiles()).filter((file) => !oldFiles.has(file) && (path.isAbsolute(returned) ? file === returned : file.endsWith(path.sep + returned)));
      expect(matches).toHaveLength(1);
      const bytes = await readFile(matches[0]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      const sheets: Record<string, Array<Array<string | number | null>>> = {};
      for (const sheet of workbook.worksheets) {
        sheets[sheet.name] = [];
        sheet.eachRow((row) => sheets[sheet.name].push(Array.from({ length: sheet.columnCount }, (_, index) => {
          const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null;
        })));
      }
      await recordEvidence(army, `wfc01-export-${mode}`, { artifact: { path: matches[0], sha256: createHash("sha256").update(bytes).digest("hex") }, sheets });
      expect(Object.values(sheets).flat().some((row) => row.some((cell) => String(cell).includes(titleC)))).toBe(false);
      if (mode === "standard") {
        for (const line of before.items.filter((item) => item.item_type === "line")) {
          const rows = sheets.Devis.filter((row) => String(row[1]).trim() === line.title);
          expect(rows).toHaveLength(1);
          expect(rows[0].slice(2, 8)).toEqual(["u", 1, Number(line.pu_ht_cents) / 100, Number(line.line_total_ht_cents) / 100, 0, Number(line.line_total_ttc_cents) / 100]);
        }
        for (const [label, expected] of [["Total HT", 0.05], ["Total TVA", 0], ["Total TTC", 0.05]]) {
          expect(sheets.Resume.filter((row) => row[0] === label).map((row) => row[1])).toEqual([expected]);
        }
      } else {
        const ids = before.items.map((item) => item.id).sort();
        expect(sheets.Données.filter((row) => ids.includes(String(row[1]))).map((row) => row[1]).sort()).toEqual(ids);
        for (const line of before.items.filter((item) => item.item_type === "line")) {
          const row = sheets.Données.find((candidate) => candidate[1] === line.id)!;
          expect([String(row[2]).trim(), ...row.slice(3, 6), ...row.slice(7, 11)])
            .toEqual([line.title, 1, "u", 0.03, 1, 0, 1, 1]);
        }
      }
    }
    const final = await readEstimate(browser, versionId);
    await recordEvidence(army, "wfc01-final", { final, repairs, dialogs, expectedTotals: [5, 0, 5], concurrencyProved: false, generatedWorkflowProved: false });
    expect(totals(final.version)).toEqual([5, 0, 5]);
    expect(preservedItems(final)).toEqual(preservedItems(before));
    expect(repairs).toHaveLength(0); expect(dialogs).toHaveLength(0);
  } finally {
    await recordEvidence(army, "wfc01-no-repair-observation", { repairs, dialogs, scope: "editor opening, real reload and both downloads only" });
    await dispose(); await browser.unroute(bulkUrl);
  }
});

// Independent arithmetic: 6 * 1667 / 10000 = 1.0002 -> discount 1c.
// Its equal 0.5c shares tie: first line A receives the 1c discount, hence A2/B3.
// At 20%, A2 taxes to 0c; B is exempt. Adding equal C gives discount 2c
// (9 * 1667 / 10000 = 1.5003), allocated A1/B1/C0 -> A2/B2/C3, footer7/0/7.
// These expected constants are not obtained from the product calculator.
