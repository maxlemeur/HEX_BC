import { expect, type Locator } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, waitForAutoSave, type ArmyItem, type ArmyState, type OwnedEstimate,
} from "./fixtures";
import { expectStoredTotalsMatchLines } from "./version-totals-support";

type Ui = Parameters<typeof createEstimateViaWizard>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type UiMode = "Expert" | "Simplifié";
type Cleanup = () => Promise<void>;

// Failure plan (S1, S2, P1; P2 is not reachable): docs/testing/bulk-edit-sync-baseline.md.
const options = { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 };

async function createdData<T>(response: { status: number; body: Envelope<T> }) {
  expect([200, 201]).toContain(response.status);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

async function withNavigationDrawer<T>({ browser, screen }: Ui, action: (navigation: Locator) => Promise<T>) {
  const viewport = await browser.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  try {
    // The drawer trigger is visible below the 960px navigation breakpoint (as US-4.4).
    await browser.setViewport({ width: 900, height: 800 });
    await screen.getByRole("button", "Ouvrir le menu principal", { exact: true }).click();
    const navigation = screen.getByRole("dialog", "Navigation principale", { exact: true });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("switch", /^Mode (?:Expert|Simplifié) actif, basculer en /)).toBeVisible();
    const result = await action(navigation);
    await navigation.getByRole("button", "Fermer le menu", { exact: true }).click();
    await expect(navigation).toBeHidden();
    return result;
  } finally {
    await browser.setViewport(viewport);
  }
}

const modeSwitch = (navigation: Locator, mode: UiMode) =>
  navigation.getByRole("switch", mode === "Expert"
    ? "Mode Expert actif, basculer en Simplifié" : "Mode Simplifié actif, basculer en Expert", { exact: true });

const currentUiMode = async (navigation: Locator): Promise<UiMode> =>
  (await modeSwitch(navigation, "Expert").isVisible()) ? "Expert" : "Simplifié";

// The mode is stored on the shared account's profile: change it through the real
// switch and wait until a reloaded page reads it back.
async function setUiMode(ui: Ui, mode: UiMode) {
  const initial = await withNavigationDrawer(ui, async (navigation) => {
    const current = await currentUiMode(navigation);
    if (current !== mode) await modeSwitch(navigation, current).click();
    await expect(modeSwitch(navigation, mode)).toBeVisible();
    return current;
  });
  await expect.poll(async () => {
    await ui.browser.reload();
    return withNavigationDrawer(ui, currentUiMode);
  }, { timeout: 30_000, interval: 1_000 }).toBe(mode);
  return initial;
}

// Expert mode and the tenant-wide rule are shared state: always restore them.
async function withSharedState(ui: Ui, army: ArmyState, label: string, run: (cleanups: Cleanup[]) => Promise<void>) {
  const cleanups: Cleanup[] = [];
  let initialMode: UiMode | null = null;
  try {
    await ui.app.open("/dashboard/affaires");
    initialMode = await setUiMode(ui, "Expert");
    await run(cleanups);
  } finally {
    for (const cleanup of [...cleanups].reverse()) await cleanup();
    await ui.app.open("/dashboard/affaires");
    if (initialMode && initialMode !== "Expert") await setUiMode(ui, initialMode);
    await recordEvidence(army, `bulk-sync-${label}-restored`, {
      initialMode, restoredMode: await withNavigationDrawer(ui, currentUiMode), cleanups: cleanups.length,
    });
  }
}

async function openEditor(ui: Ui, versionId: string) {
  await ui.browser.goto(`/dashboard/estimates/${versionId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
}

async function openDisplayMenu({ screen }: Ui) {
  await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).click();
  const display = screen.getByTestId("estimate-editor-display-button", { visible: true });
  await display.click();
  return display;
}

async function showColumn(ui: Ui, label: string) {
  const display = await openDisplayMenu(ui);
  await ui.screen.getByRole("button", "Personnalisé", { exact: true }).click();
  await ui.screen.getByRole("checkbox", label, { exact: true }).check();
  await display.click();
}

async function resetColumns(ui: Ui) {
  const display = await openDisplayMenu(ui);
  await ui.screen.getByRole("button", "Réinitialiser les colonnes et leurs largeurs", { exact: true }).click();
  await display.click();
}

// Line autosave is debounced (60 s): Ctrl+S flushes it, as in commercial-rounding.e2e.ts.
async function saveAndRecord(
  ui: Ui, army: ArmyState, ids: OwnedEstimate, line: ArmyItem, step: string,
  cell: Locator, typed: string, expected: Partial<ArmyItem>,
) {
  await ui.browser.keyboard.press("ControlOrMeta+s");
  const matches = (item: ArmyItem | undefined) =>
    Boolean(item) && Object.entries(expected).every(([key, wanted]) => (item![key] ?? null) === wanted);
  try {
    await waitForAutoSave(ui, ids.versionId, (snapshot) =>
      matches(snapshot.items.find((item) => item.id === line.id)), army);
  } finally {
    const persisted = (await readEstimate(ui.browser, ids.versionId)).items.find((item) => item.id === line.id);
    await recordEvidence(army, `bulk-sync-${step}`, {
      versionId: ids.versionId, itemId: line.id, typed, expected,
      actual: {
        ...Object.fromEntries(Object.keys(expected).map((key) => [key, persisted?.[key] ?? null])),
        cell: await cell.inputValue(),
        status: await ui.screen.getByTestId("estimate-page-toolbar-autosave-status").textContent(),
      },
    });
  }
}

async function suggestionJourney(ui: Ui, army: ArmyState, label: string, cleanups: Cleanup[]) {
  const { browser, screen } = ui;
  const title = `${army.runPrefix} ${label} suggestion`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  // Still on the editor page: the API calls below share its draft-lock session.
  const line = await createLineViaApi(browser, ids.versionId, title);
  expect([line.k_fo, line.k_mo, line.description ?? null, line.category_id ?? null]).toEqual([1, 1, null, null]);
  // The exact title as keyword keeps this tenant-wide rule away from other ARMY lines.
  const created = await createdData(await apiRequest<Envelope<Record<string, { id: string }>>>(
    browser, "POST", `/api/estimates/${ids.versionId}/suggestion-rules`,
    { name: `${army.runPrefix} ${label} K FO`, match_value: title, k_fo: 1.3, is_active: true },
  ));
  const rule = created.suggestion_rule ?? created.suggestionRule ?? created.rule ?? (created as unknown as { id: string });
  expect(rule.id).toMatch(/^[0-9a-f-]{36}$/i);
  cleanups.push(async () => {
    // Rule writes require the editor's draft lock: retry until the reopened editor holds it.
    await openEditor(ui, ids.versionId);
    await expect.poll(async () => (await apiRequest(browser, "PATCH",
      `/api/estimates/${ids.versionId}/suggestion-rules/${rule.id}`, { is_active: false })).status,
    { timeout: 30_000, interval: 1_000 }).toBe(200);
  });
  await recordEvidence(army, `bulk-sync-${label.toLowerCase()}-rule`, {
    versionId: ids.versionId, itemId: line.id, ruleId: rule.id, keyword: title, kFo: 1.3,
  });
  await openEditor(ui, ids.versionId);
  await showColumn(ui, "K FO");
  const cell = screen.getByLabel(`Coefficient fourniture K FO pour ${title}`, { exact: true });
  await expect(cell).toHaveValue("1");
  const persistedKFo = async () =>
    (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === line.id)?.k_fo;

  await openDisplayMenu(ui);
  const review = screen.getByTestId("estimate-editor-bulk-suggestions-button");
  await expect(review).toHaveText("Examiner 1 suggestion");
  await review.click();
  const dialog = screen.getByRole("dialog", "Application en masse des suggestions", { exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", "Appliquer", { exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect.poll(persistedKFo, { timeout: 30_000, interval: 500 }).toBe(1.3);
  await expect(cell).toHaveValue("1,3");
  return { ids, line, cell, persistedKFo };
}

armyTest(
  "bulk edit sync suggestions save a K FO edit back to the value before they were applied",
  options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    await withSharedState(ui, army, "s1", async (cleanups) => {
      const { ids, line, cell, persistedKFo } = await suggestionJourney(ui, army, "S1", cleanups);
      await cell.fill("1");
      await cell.press("Tab");
      await saveAndRecord(ui, army, ids, line, "s1-edit-back", cell, "1", { k_fo: 1 });
      await openEditor(ui, ids.versionId);
      await expect(cell).toHaveValue("1");
      expect(await persistedKFo()).toBe(1);
      await resetColumns(ui);
    });
  },
);

armyTest(
  "bulk edit sync suggestions save a K FO edit to the suggested value after their undo",
  options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    await withSharedState(ui, army, "s2", async (cleanups) => {
      const { ids, line, cell, persistedKFo } = await suggestionJourney(ui, army, "S2", cleanups);
      await screen.getByTestId("estimate-editor-alert-undo-bulk-suggest-button").click();
      await expect.poll(persistedKFo, { timeout: 30_000, interval: 500 }).toBe(1);
      await expect(cell).toHaveValue("1");
      await cell.fill("1,3");
      await cell.press("Tab");
      await saveAndRecord(ui, army, ids, line, "s2-edit-to-suggested-after-undo", cell, "1,3", { k_fo: 1.3 });
      await openEditor(ui, ids.versionId);
      await expect(cell).toHaveValue("1,3");
      expect(await persistedKFo()).toBe(1.3);
      await resetColumns(ui);
    });
  },
);

armyTest(
  "bulk edit sync supplier preselection saves a return to the article reference price",
  options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    await withSharedState(ui, army, "p1", async () => {
      const designation = `${army.runPrefix} P1 article`;
      const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} P1 devis` }, army);
      // Only the two read-only catalogue lookups of this owned project are allowed.
      army.ownedPriceLookupProjects = [ids.projectId];
      const product = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
        action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 1000 },
      }))).item;
      const supplier = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name: `${army.runPrefix} P1 fournisseur`, is_active: true },
      }))).item;
      const offer = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/prices", {
        action: "create", item: {
          supplier_id: supplier.id, product_id: product.id, supplier_sku: `${army.runPrefix}-P1`, unit: "u",
          min_quantity: 1, unit_price_cents: 1234, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10),
        },
      }))).item;
      const line = await createLineViaApi(browser, ids.versionId, designation, {
        product_id: product.id, description: "u", unit_price_ht_cents: 1000,
      });
      expect([line.product_id, line.selected_supplier_price_id ?? null, line.unit_price_ht_cents]).toEqual([product.id, null, 1000]);
      await recordEvidence(army, "bulk-sync-p1-fixtures", {
        versionId: ids.versionId, itemId: line.id, productId: product.id, supplierId: supplier.id, offerId: offer.id,
        referenceCents: 1000, offerCents: 1234,
      });
      const persistedLine = async () => {
        const item = (await readEstimate(browser, ids.versionId)).items.find((candidate) => candidate.id === line.id);
        return { unit_price_ht_cents: item?.unit_price_ht_cents, selected_supplier_price_id: item?.selected_supplier_price_id ?? null };
      };

      await openEditor(ui, ids.versionId);
      const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${designation}`, { exact: true });
      await expect(price).toHaveValue("10.00");
      await openDisplayMenu(ui);
      await screen.getByTestId("estimate-editor-supplier-preselection-button").click();
      const dialog = screen.getByRole("dialog", /Présélection fournisseurs/);
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Sélectionner toutes les présélections fournisseurs", { exact: true }).check();
      await dialog.getByRole("button", "Appliquer la sélection", { exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await expect.poll(persistedLine, { timeout: 30_000, interval: 500 })
        .toEqual({ unit_price_ht_cents: 1234, selected_supplier_price_id: offer.id });
      await expect(price).toHaveValue("12.34");
      // V2 draft, fixed 0 % margin, 20 % VAT: 1 u at 12,34 € gives 12,34 € HT, 2,47 € VAT, 14,81 € TTC.
      // The version stores those totals with the preselection itself, not at a later save
      // (docs/testing/version-totals-after-preselection.md).
      await expectStoredTotalsMatchLines(ui, army, {
        estimate: ids, projectName: army.projectName, step: "bulk-sync-p1-preselection", expected: [1234, 247, 1481],
      });
      await openEditor(ui, ids.versionId);

      // The offer is withdrawn from the catalogue; the estimator goes back to the article's reference price.
      await createdData(await apiRequest<Envelope<unknown>>(browser, "POST", "/api/prices", {
        action: "update-offer", id: offer.id, item: { is_active: false },
      }));
      await screen.getByRole("button", `Plus d'actions pour ${designation}`, { exact: true }).tap();
      const associate = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
      await expect(associate).toBeEnabled({ timeout: 30_000 });
      await associate.tap();
      const sheet = screen.getByRole("dialog", "Associer ou remplacer l’article", { exact: true });
      await sheet.getByLabel("Rechercher dans le catalogue", { exact: true }).fill(designation);
      const suggestion = sheet.getByRole("button", new RegExp(designation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(suggestion).toContainText("10,00");
      await suggestion.tap();
      await expect(sheet).toBeHidden();
      await expect(price).toHaveValue("10.00");
      await saveAndRecord(ui, army, ids, line, "p1-reassociate-reference", price, "article reference price",
        { unit_price_ht_cents: 1000, selected_supplier_price_id: null });
      await openEditor(ui, ids.versionId);
      await expect(price).toHaveValue("10.00");
      expect(await persistedLine()).toEqual({ unit_price_ht_cents: 1000, selected_supplier_price_id: null });
    });
  },
);
