import { expect } from "e2e";

import {
  armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, waitForAutoSave, type ArmyState,
} from "./fixtures";
import { basisLaborRole, expectStoredTotals, reconcileStoredTotals, type StoredTotals } from "./version-totals-support";

type Ui = Parameters<typeof createEstimateViaWizard>[0];

// Wizard V2 draft: fixed 0 % margin, 20 % VAT, no rounding. The line is 1 u at 10,00 € plus 1 h of
// labour, at the owned 40 €/h role or without a role (docs/testing/version-totals-after-bulk-actions.md).
const LABOUR_AT_100: StoredTotals = [5000, 1000, 6000]; // 10,00 € + 1 h × 1 × 40,00 €
const LABOUR_AT_150: StoredTotals = [7000, 1400, 8400]; // 10,00 € + 1 h × 1,5 × 40,00 €
const NO_ROLE: StoredTotals = [1000, 200, 1200]; // without a role, the hour has no rate
// The tab label carries the count of quality alerts, if any (an hour without a role is one).
const DISPLAY_TAB = /^Affichage & contrôle(?: \d+)?$/;

// Failure plan (D1–D3): docs/testing/bulk-edit-sync-baseline.md.
async function openMajorationLine(ui: Ui, army: ArmyState, label: string, labour: "role" | "no-role" = "role") {
  const { browser, screen } = ui;
  await browser.emulateMedia({ reducedMotion: "reduce" });
  const title = `${army.runPrefix} ${label}`;
  const step = label.toLowerCase().replaceAll(" ", "-");
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  const role = await basisLaborRole(browser, ids.versionId);
  const roleId = labour === "role" ? role.id : null;
  const line = await createLineViaApi(browser, ids.versionId, title, {
    line_nature: "supply_and_labor", h_mo: 1, labor_role_id: roleId,
  });
  expect([line.h_mo_majoration, line.h_mo, line.labor_role_id ?? null]).toEqual([1, 1, roleId]);
  // The line creation stores the version totals: every action below starts from consistent totals.
  await expectStoredTotals(browser, army, {
    estimate: ids, step: `${step}-seeded`, expected: labour === "role" ? LABOUR_AT_100 : NO_ROLE,
  });
  await browser.reload();
  const grid = screen.getByRole("grid", "Lignes de devis", { exact: true });
  await expect(grid).toBeVisible();
  // Hidden by every preset: enabled for this journey, reset by resetColumns().
  await screen.getByRole("tab", DISPLAY_TAB).click();
  const display = screen.getByTestId("estimate-editor-display-button", { visible: true });
  await display.click();
  await screen.getByRole("button", "Personnalisé", { exact: true }).click();
  await screen.getByRole("checkbox", "Majoration MO (%)", { exact: true }).check();
  await display.click();
  const cell = screen.getByLabel(`Majoration de main-d’œuvre en pourcentage pour ${title}`, { exact: true });
  await expect(cell).toHaveValue("100");
  await screen.getByRole("tab", "Chiffrage", { exact: true }).click();
  const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true });
  const persistedLine = async () => (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === line.id);
  const persisted = async () => (await persistedLine())?.h_mo_majoration;
  const persistedRole = async () => (await persistedLine())?.labor_role_id ?? null;

  async function withSelection(apply: () => Promise<void>) {
    const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
    await select.check();
    const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
    await apply();
    await select.uncheck();
    await expect(bulkBar).toBeHidden();
  }

  return {
    ids, line, role, grid, cell, price, persisted, persistedRole,
    async bulkMajoration(percent: string, expected: number) {
      await withSelection(async () => {
        await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill(percent);
        await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
        await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(expected);
      });
    },
    async bulkLaborRole(laborRoleId: string) {
      await withSelection(async () => {
        await screen.getByTestId("estimate-editor-bulk-selection-bar")
          .getByLabel("Rôle de main-d’œuvre", { exact: true }).selectOption({ value: laborRoleId });
        await screen.getByTestId("estimate-editor-bulk-labor-role-apply-button").click();
        await expect.poll(persistedRole, { timeout: 30_000, interval: 500 }).toBe(laborRoleId);
      });
    },
    async history(action: "Annuler" | "Rétablir", expected: unknown, read: () => Promise<unknown> = persisted) {
      const button = screen.getByTestId(
        action === "Annuler" ? "estimate-editor-undo-button" : "estimate-editor-redo-button", { visible: true },
      );
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(read, { timeout: 30_000, interval: 500 }).toBe(expected);
    },
    // Line autosave is debounced (60 s): Ctrl+S flushes it, as in commercial-rounding.e2e.ts.
    async editCellAndSave(step: string, value: string, expected: number) {
      await cell.fill(value);
      await cell.press("Tab");
      await browser.keyboard.press("ControlOrMeta+s");
      try {
        await waitForAutoSave(ui, ids.versionId, (snapshot) =>
          snapshot.items.some((item) => item.id === line.id && item.h_mo_majoration === expected), army);
      } finally {
        await recordEvidence(army, `bulk-sync-${step}`, {
          versionId: ids.versionId, itemId: line.id, typed: value,
          expected: { h_mo_majoration: expected },
          actual: {
            h_mo_majoration: await persisted(),
            cell: await cell.inputValue(),
            status: await screen.getByTestId("estimate-page-toolbar-autosave-status").textContent(),
          },
        });
      }
    },
    async expectAfterReload(value: string, expected: number) {
      await browser.reload();
      await expect(grid).toBeVisible();
      await expect(cell).toHaveValue(value);
      expect(await persisted()).toBe(expected);
    },
    async resetColumns() {
      await screen.getByRole("tab", DISPLAY_TAB).click();
      await display.click();
      await screen.getByRole("button", "Réinitialiser les colonnes et leurs largeurs", { exact: true }).click();
      await display.click();
      await expect(cell).toBeHidden();
    },
  };
}

armyTest(
  "bulk edit sync saves a grid edit back to the pre-bulk majoration",
  { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const journey = await openMajorationLine({ app, screen, browser }, army, "bulk sync D1");
    await journey.bulkMajoration("150", 1.5);
    // BT1: the bulk write stores the version totals of its lines, not a later save.
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d1-majoration", expected: LABOUR_AT_150 });
    await expect(journey.cell).toHaveValue("150");
    await journey.editCellAndSave("d1-edit-back", "100", 1);
    await journey.expectAfterReload("100", 1);
    await journey.resetColumns();
  },
);

armyTest(
  "bulk edit sync saves a grid edit back to the pre-bulk majoration after undo and redo",
  { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const journey = await openMajorationLine({ app, screen, browser }, army, "bulk sync D2");
    await journey.bulkMajoration("150", 1.5);
    // BT2: the undo and the redo store their own totals. The manual save first brings the stored
    // totals to the lines, so that a stale bulk write (BT1) cannot hide a stale undo.
    await reconcileStoredTotals({ browser, screen }, army, {
      estimate: journey.ids, step: "bulk-sync-d2-majoration", expected: LABOUR_AT_150, from: journey.price,
    });
    await journey.history("Annuler", 1);
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d2-undo", expected: LABOUR_AT_100 });
    await expect(journey.cell).toHaveValue("100");
    await journey.history("Rétablir", 1.5);
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d2-redo", expected: LABOUR_AT_150 });
    await expect(journey.cell).toHaveValue("150");
    await journey.editCellAndSave("d2-edit-back-after-redo", "100", 1);
    await journey.expectAfterReload("100", 1);
    await journey.resetColumns();
  },
);

armyTest(
  "bulk edit sync saves a grid edit to the bulk majoration after its undo",
  { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const journey = await openMajorationLine({ app, screen, browser }, army, "bulk sync D3");
    await journey.bulkMajoration("150", 1.5);
    await journey.history("Annuler", 1);
    await expect(journey.cell).toHaveValue("100");
    await journey.editCellAndSave("d3-edit-to-bulk-after-undo", "150", 1.5);
    await journey.expectAfterReload("150", 1.5);
    await journey.resetColumns();
  },
);

armyTest(
  "bulk edit sync stores the version totals with a bulk labour role, its undo and redo",
  { session: "army", tags: ["critical", "bulk-edit-sync"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const journey = await openMajorationLine({ app, screen, browser }, army, "bulk sync D4", "no-role");
    // BT3: the role prices the hour at 40 €/h; each write stores the totals of its lines.
    await journey.bulkLaborRole(journey.role.id);
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d4-labor-role", expected: LABOUR_AT_100 });
    await journey.history("Annuler", null, journey.persistedRole);
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d4-undo", expected: NO_ROLE });
    await journey.history("Rétablir", journey.role.id, journey.persistedRole);
    await expectStoredTotals(browser, army, { estimate: journey.ids, step: "bulk-sync-d4-redo", expected: LABOUR_AT_100 });
    await journey.resetColumns();
  },
);
