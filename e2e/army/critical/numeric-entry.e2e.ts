import { expect } from "e2e";

import {
  armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, saveLineEditsWithShortcut, setLineCoreValues, waitForAutoSave,
} from "./fixtures";

// Contract and parser-only edge cases: docs/testing/tech-debt-numeric-entry.md.
armyTest(
  "numeric entry retains grouped decimals and refuses invalid grid drafts after reload",
  { session: "army", tags: ["critical", "numeric-entry"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    await browser.emulateMedia({ reducedMotion: "reduce" });
    const ui = { app, screen, browser };
    const title = `${army.runPrefix} numeric`;
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
    const line = await createLineViaApi(browser, ids.versionId, title);
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    expect(await browser.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await setLineCoreValues(ui, title, { quantity: "1 234,56", unitPriceHt: "12,50" });
    await saveLineEditsWithShortcut(ui, ids.versionId, title, army);
    const saved = await waitForAutoSave(ui, ids.versionId, (snapshot) => snapshot.items.some((item) =>
      item.id === line.id && item.quantity === 1234.56 && item.unit_price_ht_cents === 1250), army);
    expect(saved.items.find((item) => item.id === line.id)?.line_total_ht_cents).toBe(1543200);
    const quantity = screen.getByLabel(`Quantité pour ${title}`, { exact: true });
    await quantity.fill("12abc");
    await quantity.press("Escape");
    await expect(quantity).toHaveValue("1234,56");
    await expect(quantity).not.toHaveAttribute("aria-invalid", "true");
    await quantity.fill("12abc");
    await quantity.press("Tab");
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items.find((item) => item.id === line.id)?.quantity).toBe(1234.56);
    expect(reloaded.items.find((item) => item.id === line.id)?.unit_price_ht_cents).toBe(1250);
    expect(reloaded.items.find((item) => item.id === line.id)?.line_total_ht_cents).toBe(1543200);
    await recordEvidence(army, "numeric-entry-reloaded", {
      ids, itemId: line.id, expected: { quantity: 1234.56, unitPriceHtCents: 1250, htCents: 1543200 },
      actual: reloaded.items.find((item) => item.id === line.id), invalidDraft: "12abc",
    });
  },
);

armyTest(
  "numeric entry persists grouped settings and excludes invalid clipboard prices",
  { session: "army", tags: ["critical", "numeric-entry"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const title = `${army.runPrefix} numeric settings`;
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
    const line = await createLineViaApi(browser, ids.versionId, title);
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await setLineCoreValues(ui, title, { quantity: "1 234,56", unitPriceHt: "12,50" });
    await saveLineEditsWithShortcut(ui, ids.versionId, title, army);
    await waitForAutoSave(ui, ids.versionId, (snapshot) => snapshot.items.some((item) =>
      item.id === line.id && item.line_total_ht_cents === 1543200), army);

    await screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
    // Precondition: the shared campaign account keeps its default Simplifié mode. In Expert mode the
    // « Contrôles avancés » push the settings button out of the 1280x800 viewport; no critical journey
    // may switch that mode (docs/testing/version-totals-after-bulk-actions.md, « Mode Expert du compte partagé »).
    const displayMenu = screen.getByRole("dialog", "Options d’affichage du chiffrage", { exact: true });
    await expect(displayMenu).toBeVisible();
    expect(await displayMenu.getByRole("region", "Contrôles avancés", { exact: true }).count(),
      "Precondition: the shared campaign account must be in Simplifié mode; a journey switched profiles.ui_mode").toBe(0);
    await screen.getByTestId("estimate-editor-settings-button", { visible: true }).click();
    await expect(screen.getByRole("dialog", "Paramétrage du devis", { exact: true })).toBeVisible();
    const discount = screen.getByLabel("Remise (EUR HT)", { exact: true });
    await discount.fill("1 234,56");
    await discount.press("Tab");
    await screen.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).version.discount_amount_cents).toBe(123456);
    await discount.fill("12abc");
    await discount.press("Tab");
    await expect(discount).toHaveAttribute("aria-invalid", "true");
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const settingsReloaded = await readEstimate(browser, ids.versionId);
    expect(settingsReloaded.version.discount_amount_cents).toBe(123456);
    const settingsLine = settingsReloaded.items.find((item) => item.id === line.id);
    expect(settingsLine?.quantity).toBe(1234.56);
    expect(settingsLine?.unit_price_ht_cents).toBe(1250);
    // The existing calculation allocates the global discount to line totals.
    expect(settingsLine?.line_total_ht_cents).toBe(1419744);

    // The visible title editor establishes the ordinary insertion anchor. The
    // quantity editor is hidden behind its display cell outside editing mode.
    // Exercise DOM paste, preview and confirmation; OS integration is not claimed.
    await screen.getByTestId("estimate-line-title-input", { visible: true }).click();
    await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    const acceptedTitle = `${army.runPrefix} decimal quantity`;
    const rejectedTitle = `${army.runPrefix} invalid money`;
    const tsv = [
      "Désignation\tQuantité\tUnité\tPrix unitaire HT",
      `${acceptedTitle}\t1,234\tu\t12,50`,
      `${rejectedTitle}\t1\tu\t1,234`,
    ].join("\n");
    await browser.evaluate((text) => {
      const grid = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
      if (!(grid instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      grid.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      return true;
    }, tsv);
    await expect(screen.getByRole("dialog", "Aperçu du collage", { exact: true })).toBeVisible();
    await expect(screen.getByTestId("paste-preview-row-invalid-reason")).toContainText("Nombre invalide");
    const invalidRow = screen.getByLabel("Inclure la ligne 3", { exact: true });
    const confirm = screen.getByTestId("paste-preview-dialog-confirm-button");
    // Every included row must be valid; explicitly exclude the rejected price.
    await invalidRow.check();
    await expect(confirm).toBeDisabled();
    await invalidRow.uncheck();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .find((item) => item.title === acceptedTitle)?.quantity).toBe(1.234);
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const pastedReloaded = await readEstimate(browser, ids.versionId);
    const accepted = pastedReloaded.items.find((item) => item.title === acceptedTitle);
    expect(accepted?.quantity).toBe(1.234);
    expect(accepted?.unit_price_ht_cents).toBe(1250);
    expect(pastedReloaded.items.some((item) => item.title === rejectedTitle)).toBe(false);
    expect(pastedReloaded.version.discount_amount_cents).toBe(123456);
    await recordEvidence(army, "numeric-entry-settings-paste-reloaded", {
      ids, seedItemId: line.id, settingsReloaded, pastedReloaded,
      expected: { discountCents: 123456, seedDiscountedHtCents: 1419744, acceptedQuantity: 1.234, acceptedPriceCents: 1250, rejectedTitle },
    });
  },
);
