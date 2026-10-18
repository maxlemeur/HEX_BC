import { expect, type Locator } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, waitForAutoSave, type ArmyItem, type ArmyState, type OwnedEstimate,
} from "./fixtures";
import { expectStoredTotals, reconcileStoredTotals, type StoredTotals } from "./version-totals-support";
import { ownedEstimateContext } from "../local/calculation-gate-support";
import { signUpDedicatedOwner, type DedicatedOwner } from "../local/dedicated-owner";

type Ui = Parameters<typeof createEstimateViaWizard>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type UiMode = "Expert" | "Simplifié";

// Failure plan (S1, S2, P1; P2 is not reachable): docs/testing/bulk-edit-sync-baseline.md.
const options = { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 };
// Wizard V2 draft, fixed 0 % margin, 20 % VAT: 1 u at 10,00 € with K FO 1, then 1,3 once the suggestion
// is applied (docs/testing/version-totals-after-bulk-actions.md, BT4 and BT5).
const AT_K_FO_1: StoredTotals = [1000, 200, 1200];
const AT_K_FO_1_3: StoredTotals = [1300, 260, 1560];

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

// Both actions sit in the Expert-only « Contrôles avancés ». The UI mode is stored on the account's
// profile and suggestion rules are tenant-wide: switching the shared campaign account leaks into the
// other worker's journeys, and a lost restore into the rest of the run
// (docs/testing/version-totals-after-bulk-actions.md, « Mode Expert du compte partagé »). Each journey
// therefore runs as its own disposable owner, born in Expert mode on the owned stack.
async function withExpertOwner(ui: Ui, army: ArmyState, label: string, run: (owner: DedicatedOwner) => Promise<void>) {
  const owner = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, army.runPrefix, { tag: "BES", uiMode: "expert" });
  await ui.app.open("/dashboard/affaires");
  const uiMode = await withNavigationDrawer(ui, currentUiMode);
  await recordEvidence(army, `bulk-sync-${label}-owner`, {
    owner: { tenantId: owner.tenantId, userId: owner.userId }, storedMode: owner.uiMode, uiMode,
  });
  expect(uiMode).toBe("Expert");
  await run(owner);
}

// The journey's estimate belongs to its dedicated owner and tenant, not to the shared account.
async function expectOwnedBy(owner: DedicatedOwner, ids: OwnedEstimate) {
  const context = await ownedEstimateContext(ids.projectId);
  expect({ tenantId: context.tenantId, userId: context.userId }).toEqual({ tenantId: owner.tenantId, userId: owner.userId });
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

type HeldRequest = { held: Promise<void>; release: () => Promise<void> };

// Holds the next matching request of the page until the journey releases it, then hands it to the
// campaign's own route (restrictCriticalBrowser). One request only: later ones pass at once.
async function holdNextRequest(browser: Ui["browser"], method: string, pattern: string): Promise<HeldRequest> {
  let markHeld!: () => void;
  const held = new Promise<void>((resolve) => { markHeld = resolve; });
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let markForwarded!: () => void;
  const forwarded = new Promise<void>((resolve) => { markForwarded = resolve; });
  let armed = true;
  await browser.route(pattern, async (route) => {
    if (!armed || route.request.method !== method) return route.fallback();
    armed = false;
    markHeld();
    await released;
    await route.fallback();
    markForwarded();
  });
  return {
    held,
    release: async () => {
      release();
      await forwarded;
      await browser.unroute(pattern);
    },
  };
}

// Records, in the page, whether the send-blocked alert is removed from the document.
async function watchSendBlockedUnmount(browser: Ui["browser"]) {
  await browser.evaluate(() => {
    const state = window as unknown as { __sendBlockedUnmounted?: boolean };
    state.__sendBlockedUnmounted = false;
    const selector = '[data-testid="estimate-editor-alert-send-blocked"]';
    new MutationObserver((records) => {
      if (records.some((record) => [...record.removedNodes].some((node) =>
        node instanceof Element && (node.matches(selector) || node.querySelector(selector) !== null)))) {
        state.__sendBlockedUnmounted = true;
      }
    }).observe(document.body, { childList: true, subtree: true });
    return null;
  });
  return () => browser.evaluate(() =>
    (window as unknown as { __sendBlockedUnmounted?: boolean }).__sendBlockedUnmounted ?? null);
}

// Records, frame by frame in the page, whether the undo is offered enabled until the probe is read.
async function watchUndoEnabled(browser: Ui["browser"]) {
  await browser.evaluate(() => {
    const state = window as unknown as { __undoEnabled?: boolean; __undoWatch?: boolean };
    state.__undoEnabled = false;
    state.__undoWatch = true;
    const selector = '[data-testid="estimate-editor-alert-undo-bulk-suggest-button"]';
    const check = () => {
      if (!state.__undoWatch) return;
      const button = document.querySelector<HTMLButtonElement>(selector);
      if (button && !button.disabled) state.__undoEnabled = true;
      requestAnimationFrame(check);
    };
    check();
    return null;
  });
  return () => browser.evaluate(() => {
    const state = window as unknown as { __undoEnabled?: boolean; __undoWatch?: boolean };
    state.__undoWatch = false;
    return state.__undoEnabled ?? null;
  });
}

// Lets the page commit what it has received before the journey moves on.
async function settleFrames(browser: Ui["browser"], frames: number) {
  await browser.evaluate((count) => new Promise<null>((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve(null) : requestAnimationFrame(() => step(left - 1)));
    step(count);
  }), frames);
}

async function suggestionJourney(
  ui: Ui, army: ArmyState, owner: DedicatedOwner, label: string,
  beforeApply?: (versionId: string) => Promise<void>,
) {
  const { browser, screen } = ui;
  const title = `${army.runPrefix} ${label} suggestion`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  await expectOwnedBy(owner, ids);
  // Still on the editor page: the API calls below share its draft-lock session.
  const line = await createLineViaApi(browser, ids.versionId, title);
  expect([line.k_fo, line.k_mo, line.description ?? null, line.category_id ?? null]).toEqual([1, 1, null, null]);
  // A tenant-wide rule, in the owner's own tenant; the exact title as keyword targets this line.
  const created = await createdData(await apiRequest<Envelope<Record<string, { id: string }>>>(
    browser, "POST", `/api/estimates/${ids.versionId}/suggestion-rules`,
    { name: `${army.runPrefix} ${label} K FO`, match_value: title, k_fo: 1.3, is_active: true },
  ));
  const rule = created.suggestion_rule ?? created.suggestionRule ?? created.rule ?? (created as unknown as { id: string });
  expect(rule.id).toMatch(/^[0-9a-f-]{36}$/i);
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
  await beforeApply?.(ids.versionId);
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
    await withExpertOwner(ui, army, "s1", async (owner) => {
      const { ids, line, cell, persistedKFo } = await suggestionJourney(ui, army, owner, "S1");
      // BT4: applying the suggestions stores the version totals of their lines, not a later save.
      await expectStoredTotals(browser, army, { estimate: ids, step: "bulk-sync-s1-apply", expected: AT_K_FO_1_3 });
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
    await withExpertOwner(ui, army, "s2", async (owner) => {
      // S2 flake (docs/testing/bulk-edit-sync-baseline.md, « Annulation perdue »): the apply ends with
      // its rule feedback, and its new version token reloads the send gating. Both are held here, so
      // that the undo is pressed inside the windows where a click used to be lost under load.
      let feedback!: HeldRequest;
      let gating!: HeldRequest;
      const { ids, line, cell, persistedKFo } = await suggestionJourney(ui, army, owner, "S2", async (versionId) => {
        feedback = await holdNextRequest(browser, "POST", `**/api/estimates/${versionId}/suggestion-rules/*/feedback`);
        gating = await holdNextRequest(browser, "GET", `**/api/estimates/${versionId}/gating`);
      });
      await Promise.all([feedback.held, gating.held]);
      const undo = screen.getByTestId("estimate-editor-alert-undo-bulk-suggest-button");
      const sendBlocked = screen.getByTestId("estimate-editor-alert-send-blocked");
      // An undo offered before the apply has finished was ignored without a word.
      await expect(undo).toBeDisabled();
      // The fresh line keeps blocking anomalies: their alert sits above the undo. While the gating of
      // the new token loads, it keeps its place.
      await expect(sendBlocked).toBeVisible();
      const sendBlockedUnmounted = await watchSendBlockedUnmount(browser);
      const undoEnabledDuringGating = await watchUndoEnabled(browser);
      const centre = async () => {
        const box = await undo.boundingBox();
        expect(box).not.toBeNull();
        return { x: Math.round(box!.x + box!.width / 2), y: Math.round(box!.y + box!.height / 2) };
      };
      const before = await centre();
      const feedbackAnswer = browser.waitForResponse(`**/api/estimates/${ids.versionId}/suggestion-rules/*/feedback`);
      await feedback.release();
      expect((await feedbackAnswer).status).toBe(200);
      // The apply has ended; the gating of its token is still held. Its answer may add or remove the
      // alert above the undo (blocked to sendable, review of #64), so a press across it could land
      // on a moved button: the undo waits for that answer too.
      await settleFrames(browser, 10);
      const enabledDuringGating = await undoEnabledDuringGating();
      const gatingAnswer = browser.waitForResponse(`**/api/estimates/${ids.versionId}/gating`);
      await gating.release();
      expect((await gatingAnswer).status).toBe(200);
      await expect(undo).toBeEnabled({ timeout: 30_000 });
      const after = await centre();
      // BT5: the undo stores its own totals. The manual save first brings the stored totals to the
      // lines, so that a stale apply (BT4) cannot hide a stale undo.
      await reconcileStoredTotals({ browser, screen }, army, { estimate: ids, step: "bulk-sync-s2-apply", expected: AT_K_FO_1_3 });
      await undo.click();
      try {
        await expect.poll(persistedKFo, { timeout: 30_000, interval: 500 }).toBe(1);
      } finally {
        await recordEvidence(army, "bulk-sync-s2-undo-press", {
          versionId: ids.versionId, itemId: line.id, before, after, enabledDuringGating,
          sendBlockedUnmounted: await sendBlockedUnmounted(), kFo: (await persistedKFo()) ?? null,
        });
      }
      expect(enabledDuringGating, "undo enabled while the gating of the apply's token was loading").toBe(false);
      expect(after).toEqual(before);
      expect(await sendBlockedUnmounted(), "send-blocked alert unmounted across the gating reload").toBe(false);
      await expectStoredTotals(browser, army, { estimate: ids, step: "bulk-sync-s2-undo", expected: AT_K_FO_1 });
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
    await withExpertOwner(ui, army, "p1", async (owner) => {
      const designation = `${army.runPrefix} P1 article`;
      const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} P1 devis` }, army);
      await expectOwnedBy(owner, ids);
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
      // (docs/testing/version-totals-after-preselection.md). API read only: reopening the editor
      // would rebuild its sync baseline from the server and hide a missing markItemsSynced().
      await expectStoredTotals(browser, army, {
        estimate: ids, step: "bulk-sync-p1-preselection", expected: [1234, 247, 1481],
      });

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
