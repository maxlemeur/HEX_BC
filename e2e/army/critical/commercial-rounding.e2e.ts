import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  createLineViaApi,
  ownEstimate,
  readEstimate,
  recordEvidence,
  setLineCoreValues,
  type ArmyState,
} from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];

// Failure plan and independent centime oracles: docs/testing/commercial-rounding.md.
// The existing storage contract includes commercial rounding in total_tax_cents.
// Actual accounting TVA is asserted on the printed document and XLSX separately.
async function expectSavedRounding(
  ui: Ui,
  versionId: string,
  expected: { mode: string; step: number; ht: number; ttc: number },
  army: ArmyState,
  label: string,
) {
  await expect.poll(async () => {
    const { version } = await readEstimate(ui.browser, versionId);
    return {
      mode: version.rounding_mode, step: version.rounding_step_cents,
      ht: version.total_ht_cents, ttc: version.total_ttc_cents,
    };
  }, { timeout: 30_000, interval: 500 }).toEqual(expected);
  const snapshot = await readEstimate(ui.browser, versionId);
  await recordEvidence(army, `rounding-${label}`, {
    versionId, expected,
    actual: {
      mode: snapshot.version.rounding_mode,
      step: snapshot.version.rounding_step_cents,
      ht: snapshot.version.total_ht_cents,
      ttc: snapshot.version.total_ttc_cents,
      adjustment: snapshot.version.rounding_adjustment_cents,
    },
    lines: snapshot.items.filter((item) => item.item_type === "line").map((item) => ({
      id: item.id, title: item.title, quantity: item.quantity,
      unitPrice: item.unit_price_ht_cents, taxRate: item.tax_rate_bp,
    })),
  });
  return snapshot;
}

async function openSettings(ui: Ui, versionId: string) {
  await ui.browser.goto(`/dashboard/estimates/${versionId}/edit?openSettings=rounding`, { waitUntil: "domcontentloaded" });
  await expect(ui.screen.getByLabel("Arrondi", { exact: true })).toBeVisible();
}

async function saveSettings(ui: Ui) {
  await ui.screen.getByRole("button", "Enregistrer le paramétrage", { exact: true }).tap();
  await expect(ui.screen.getByRole("button", "Enregistrer le paramétrage", { exact: true })).toBeEnabled();
}

async function downloadWorkbook(download: { path: string; suggestedFilename: string }) {
  const root = path.resolve(process.env.E2E_ARMY_ARTIFACT_ROOT ?? ".e2e/army/critical/artifacts");
  const matches = (await readdir(root, { recursive: true })).filter((entry) => {
    const normalized = entry.split(path.sep).join("/");
    return normalized === download.path || normalized.endsWith(`/${download.path}`);
  });
  expect(matches).toHaveLength(1);
  const absolutePath = path.resolve(root, matches[0]);
  const bytes = await readFile(absolutePath);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);
  return { workbook, artifact: {
    path: absolutePath, suggestedFilename: download.suggestedFilename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  } };
}

armyTest(
  "commercial rounding uses lower steps from creation through save reload exports and print",
  { session: "army", tags: ["critical", "commercial-rounding"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    // Exercise the wizard's actual selected mode, not an API-only creation.
    await app.open("/dashboard/estimates/new");
    await screen.getByLabel(/Nom du projet/).fill(army.projectName);
    await screen.getByLabel(/Titre de la version/).fill(`${army.runPrefix} rounding`);
    await screen.getByRole("button", "Suivant", { exact: true }).tap();
    await screen.getByRole("button", "Marge fixe", { exact: true }).tap();
    await screen.getByLabel("Marge (%)", { exact: true }).fill("0");
    await screen.getByLabel("Marge (%)", { exact: true }).press("Tab");
    await screen.getByLabel(/TVA \(%\)/).fill("20");
    await screen.getByLabel(/TVA \(%\)/).press("Tab");
    await screen.getByLabel("Arrondi", { exact: true }).selectOption({ value: "100" });
    await screen.getByRole("button", "Suivant", { exact: true }).tap();
    const [created] = await Promise.all([
      browser.waitForResponse("**/api/estimates", { timeout: 60_000 }),
      screen.getByRole("button", /Créer le chiffrage|Creer le chiffrage/).tap(),
    ]);
    expect(created.status).toBe(201);
    const response = await created.json<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>();
    expect(response.ok).toBe(true);
    const ids = { projectId: response.data.project.id, versionId: response.data.version.id };
    ownEstimate(army, ids);
    await expect(browser).toHaveURL(/\/estimates\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
    expect((await readEstimate(browser, ids.versionId)).version.rounding_mode).toBe("down");
    const title = `${army.runPrefix} rounding line`;
    // Item creation seeds the hierarchy and a neutral line, not the saved footer.
    // The real editor must price and save it before persistence can be asserted.
    await createLineViaApi(browser, ids.versionId, title, { description: "u" });
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await setLineCoreValues(ui, title, { quantity: "1", unitPriceHt: "760,63" });
    await screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true }).press("ControlOrMeta+s");
    await expectSavedRounding(ui, ids.versionId, { mode: "down", step: 100, ht: 76063, ttc: 91200 }, army, "created");
    await openSettings(ui, ids.versionId);
    await expect(screen.getByLabel("Arrondi", { exact: true })).toHaveValue("100");

    for (const [step, ttc] of [[1000, 91000], [5000, 90000], [10000, 90000], [1, 91276], [100, 91200]]) {
      const mode = step === 1 ? "none" : "down";
      const value = step === 1 ? "none" : String(step);
      await screen.getByLabel("Arrondi", { exact: true }).selectOption({ value });
      await saveSettings(ui);
      await expectSavedRounding(ui, ids.versionId, { mode, step, ht: 76063, ttc }, army, `step-${step}`);
      await openSettings(ui, ids.versionId);
      await expect(screen.getByLabel("Arrondi", { exact: true })).toHaveValue(value);
    }
    await screen.getByTestId("estimate-editor-drawer-close-button").tap();
    await screen.getByRole("button", "Exporter", { exact: true }).tap();
    const standard = await downloadWorkbook(await browser.waitForDownload(
      () => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap(), { timeout: 60_000 },
    ));
    const summary = standard.workbook.getWorksheet("Resume");
    expect(Boolean(summary)).toBe(true);
    const footer: Record<string, ExcelJS.CellValue> = {};
    summary!.eachRow((row) => { footer[row.getCell(1).text] = row.getCell(2).value; });
    const expectedFooter = { "Total HT": 760.63, "Total TVA": 152.13, "TTC calculé": 912.76, "Arrondi commercial": -0.76, "Montant à payer": 912 };
    const actualFooter = Object.fromEntries(Object.keys(expectedFooter).map((key) => [key, footer[key]]));
    await recordEvidence(army, "rounding-xlsx", { artifact: standard.artifact, expected: expectedFooter, actual: actualFooter });
    expect(actualFooter).toEqual(expectedFooter);
    await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const dpgf = await downloadWorkbook(await browser.waitForDownload(
      () => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 },
    ));
    const dpgfRows: ExcelJS.CellValue[][] = [];
    dpgf.workbook.getWorksheet("Données")!.eachRow((row) => {
      if (row.getCell(3).text.trim() === title) dpgfRows.push([4, 5, 6].map((column) => row.getCell(column).value));
    });
    await recordEvidence(army, "rounding-dpgf", { artifact: dpgf.artifact, rows: dpgfRows });
    expect(dpgfRows).toEqual([[1, "u", 760.63]]);
    await browser.goto(`/dashboard/estimates/${ids.versionId}/print?price_mode=unit_and_total&detail_level=lines`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible();
    const print = await browser.evaluate(() => {
      const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
      const labels = ["Total HT", "TVA", "TTC calculé", "Arrondi commercial", "Montant à payer"];
      return Array.from(document.querySelectorAll("span"))
        .filter((span) => labels.includes(normalize(span.textContent)))
        .map((span) => ({ label: normalize(span.textContent), value: normalize(span.parentElement?.children[1]?.textContent) }));
    });
    await recordEvidence(army, "rounding-print", { versionId: ids.versionId, footer: print });
    expect(print).toEqual([
      { label: "Total HT", value: "760,63 €" }, { label: "TVA", value: "152,13 €" },
      { label: "TTC calculé", value: "912,76 €" }, { label: "Arrondi commercial", value: "-0,76 €" },
      { label: "Montant à payer", value: "912,00 €" },
    ]);
    await browser.goto(`/dashboard/estimates/${ids.versionId}/edit`, { waitUntil: "domcontentloaded" });
    await setLineCoreValues(ui, title, { quantity: "1", unitPriceHt: "760,83" });
    // Explicit save qualifies the exact-multiple boundary; autosave has its own suite.
    await screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true }).press("ControlOrMeta+s");
    await expectSavedRounding(ui, ids.versionId, { mode: "down", step: 100, ht: 76083, ttc: 91300 }, army, "exact-multiple");
    await browser.reload();
    await expect(screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true })).toHaveValue("760.83");
  },
);

armyTest(
  "commercial rounding displays historical modes explicitly and preserves them on unrelated saves",
  { session: "army", tags: ["critical", "commercial-rounding"], timeout: 180_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} historical rounding` }, army);
    await createLineViaApi(browser, ids.versionId, `${army.runPrefix} historical line`, { unit_price_ht_cents: 76063 });
    for (const [mode, step, ttc, optionLabel] of [
      ["nearest", 100, 91300, "Réglage conservé : au plus proche, pas de 1,00 €"],
      ["up", 1000, 92000, "Réglage conservé : au palier supérieur, pas de 10,00 €"],
      ["down", 250, 91250, "Réglage conservé : au palier inférieur, pas de 2,50 €"],
    ] as const) {
      const before = await readEstimate(browser, ids.versionId);
      const seeded = await apiRequest(browser, "PATCH", `/api/estimates/${ids.versionId}`, {
        rounding_mode: mode, rounding_step_cents: step,
      }, { "If-Match": before.version.updated_at });
      expect(seeded.status).toBe(200);
      await openSettings(ui, ids.versionId);
      await expect(screen.getByRole("option", optionLabel, { exact: true })).toBeSelected();
      const updatedTitle = `${army.runPrefix} keep-${mode}`;
      await screen.getByLabel("Titre", { exact: true }).fill(updatedTitle);
      await saveSettings(ui);
      await expect.poll(async () => (await readEstimate(browser, ids.versionId)).version.title,
        { timeout: 30_000, interval: 500 }).toBe(updatedTitle);
      await expectSavedRounding(ui, ids.versionId, { mode, step, ht: 76063, ttc }, army, `historical-${mode}`);
      await openSettings(ui, ids.versionId);
      await expect(screen.getByLabel("Titre", { exact: true })).toHaveValue(updatedTitle);
      await expect(screen.getByRole("option", optionLabel, { exact: true })).toBeSelected();
    }
  },
);
