import { expect } from "e2e";

import {
  armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, waitForAutoSave, type ArmyState,
} from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];

// Failure plan (D1–D3): docs/testing/bulk-edit-sync-baseline.md.
async function openMajorationLine(ui: Ui, army: ArmyState, label: string) {
  const { browser, screen } = ui;
  await browser.emulateMedia({ reducedMotion: "reduce" });
  const title = `${army.runPrefix} ${label}`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  const line = await createLineViaApi(browser, ids.versionId, title);
  expect(line.h_mo_majoration).toBe(1);
  await browser.reload();
  const grid = screen.getByRole("grid", "Lignes de devis", { exact: true });
  await expect(grid).toBeVisible();
  // Hidden by every preset: enabled for this journey, reset by resetColumns().
  await screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
  const display = screen.getByTestId("estimate-editor-display-button", { visible: true });
  await display.click();
  await screen.getByRole("button", "Personnalisé", { exact: true }).click();
  await screen.getByRole("checkbox", "Majoration MO (%)", { exact: true }).check();
  await display.click();
  const cell = screen.getByLabel(`Majoration de main-d’œuvre en pourcentage pour ${title}`, { exact: true });
  await expect(cell).toHaveValue("100");
  await screen.getByRole("tab", "Chiffrage", { exact: true }).click();
  const persisted = async () =>
    (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === line.id)?.h_mo_majoration;

  return {
    ids, line, grid, cell, persisted,
    async bulkMajoration(percent: string, expected: number) {
      const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
      await select.check();
      const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
      await expect(bulkBar).toBeVisible();
      await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
      await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill(percent);
      await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
      await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(expected);
      await select.uncheck();
      await expect(bulkBar).toBeHidden();
    },
    async history(action: "Annuler" | "Rétablir", expected: number) {
      const button = screen.getByTestId(
        action === "Annuler" ? "estimate-editor-undo-button" : "estimate-editor-redo-button", { visible: true },
      );
      await expect(button).toBeEnabled();
      await button.click();
      await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(expected);
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
      await screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
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
    await journey.history("Annuler", 1);
    await expect(journey.cell).toHaveValue("100");
    await journey.history("Rétablir", 1.5);
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
