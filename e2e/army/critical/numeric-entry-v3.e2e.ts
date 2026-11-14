import { expect } from "e2e";

import {
  armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, waitForAutoSave, saveLineEditsWithShortcut,
} from "./fixtures";

import { prepareV3Draft, seedLines, showStandardColumns, waitForDraftLease } from "../local/engine-v3-editor-support";

// Sub-lot 2.3 (A8, D11, P-11, C-11): failure modes are in docs/testing/estimate-input-import-2.3.md.
// numeric-entry.e2e.ts keeps the d484c5a1 recipe; steps 1 to 5 were written red before 2.3, step 6
// (grid majoration cell) was added at integration to prove E7/E9 in the real grid, steps 7 to 9
// were written red for the 2.3 review (paste, grid and settings precision, pasted sale price).
armyTest(
  "numeric entry v3 refuses 1.250 alike everywhere and shows the majoration coefficient before applying it",
  { session: "army", tags: ["critical", "numeric-entry"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const title = `${army.runPrefix} saisie v3`;
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
    const line = await createLineViaApi(browser, ids.versionId, title);
    const grid = screen.getByRole("grid", "Lignes de devis", { exact: true });
    const lineOf = async () => (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === line.id);
    // What a screen reader reads with a refused field: the text of the ids its aria-describedby lists
    // (MWG « Error Link »). Empty when nothing is listed, so a valid field must not keep the reason.
    const describedReason = (selector: string) => browser.evaluate((css) => {
      const fields = document.querySelectorAll(css);
      if (fields.length !== 1) return `<${fields.length} fields match ${css}>`;
      const ids = (fields[0].getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`).join(" ").trim();
    }, selector);
    const byLabel = (label: string) => `input[aria-label=${JSON.stringify(label)}]`;
    await browser.reload();
    await expect(grid).toBeVisible();

    // 1. Grid PR FO cell: "1.250" is ambiguous, refused and never saved (green since d484c5a1).
    const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true });
    await price.fill("1.250");
    await price.press("Tab");
    await expect(price).toHaveAttribute("aria-invalid", "true");
    const refusal = (await price.getAttribute("title")) ?? "";
    expect(refusal).toMatch(/^Nombre invalide/);
    await expect.poll(() => describedReason(byLabel(`Prix d’achat unitaire HT pour ${title}`))).toBe(refusal);
    await browser.reload();
    await expect(grid).toBeVisible();
    expect((await lineOf())?.unit_price_ht_cents).toBe(1000);

    // 2. Settings panel: the same refusal for "1.250"; "1 000" is 1 000 € after reload (C-11).
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
    // Precondition, as in numeric-entry.e2e.ts: the shared account keeps its default Simplifié mode,
    // without which the Expert-only « Contrôles avancés » push the settings button out of the viewport.
    const displayMenu = screen.getByRole("dialog", "Options d’affichage du chiffrage", { exact: true });
    await expect(displayMenu).toBeVisible();
    expect(await displayMenu.getByRole("region", "Contrôles avancés", { exact: true }).count(),
      "Precondition: the shared campaign account must be in Simplifié mode; a journey switched profiles.ui_mode").toBe(0);
    await screen.getByTestId("estimate-editor-settings-button", { visible: true }).click();
    await expect(screen.getByRole("dialog", "Paramétrage du devis", { exact: true })).toBeVisible();
    const discount = screen.getByLabel("Remise (EUR HT)", { exact: true });
    await discount.fill("1.250");
    await discount.press("Tab");
    await expect(discount).toHaveAttribute("aria-invalid", "true");
    await expect(discount).toHaveAttribute("title", refusal);
    await expect.poll(() => describedReason("#estimate-discount")).toBe(refusal);
    await discount.fill("1 000");
    await discount.press("Tab");
    await expect(discount).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => describedReason("#estimate-discount")).toBe("");
    await screen.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).version.discount_amount_cents).toBe(100000);
    await browser.reload();
    await expect(grid).toBeVisible();
    expect((await readEstimate(browser, ids.versionId)).version.discount_amount_cents).toBe(100000);

    // 3. v1/v2 column help: h MO is the line's total hours, not hours per unit (C-01, D11).
    await screen.getByTestId("estimate-columns-help-button", { visible: true }).click();
    const help = screen.getByTestId("estimate-columns-help-panel");
    await expect(help).toBeVisible();
    await expect.soft(help).toContainText("heures totales de la ligne");
    await screen.getByRole("button", "Fermer l’aide des colonnes", { exact: true }).click();
    await expect(help).toBeHidden();

    // 4. Paste: the preview gives the same refusal for a "1.250" price and creates nothing.
    // DOM paste as in numeric-entry.e2e.ts; the OS clipboard is not qualified.
    await screen.getByTestId("estimate-line-title-input", { visible: true }).click();
    await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    const pastedTitle = `${army.runPrefix} prix ambigu`;
    const tsv = ["Désignation\tQuantité\tUnité\tPrix unitaire HT", `${pastedTitle}\t1\tu\t1.250`].join("\n");
    await browser.evaluate((text) => {
      const target = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
      if (!(target instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      return true;
    }, tsv);
    const pasteDialog = screen.getByRole("dialog", "Aperçu du collage", { exact: true });
    await expect(pasteDialog).toBeVisible();
    const pasteReason = screen.getByTestId("paste-preview-row-invalid-reason");
    await expect(pasteReason).toContainText("Nombre invalide");
    const pasteReasonText = await pasteReason.textContent();
    await expect.soft(pasteReason).toContainText(refusal);
    await screen.getByTestId("paste-preview-dialog-cancel-button").click();
    await expect(pasteDialog).toBeHidden();
    expect((await readEstimate(browser, ids.versionId)).items.some((item) => item.title === pastedTitle)).toBe(false);

    // 5. Bulk « Majoration MO (%) » (P-11, 100 = neutral): the resulting coefficient is shown
    // before applying, and an emptied field can no longer apply ×0 to the selection.
    await screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true }).check();
    const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
    const bulkPercent = screen.getByLabel("Majoration MO en pourcentage", { exact: true });
    const applyMajoration = screen.getByTestId("estimate-editor-bulk-majoration-apply-button");
    await expect(bulkPercent).toBeVisible();
    await bulkPercent.fill("150");
    await expect.soft(screen.getByTestId("estimate-editor-bulk-majoration-coefficient")).toContainText("×1,5");
    await applyMajoration.click();
    await expect.poll(async () => (await lineOf())?.h_mo_majoration).toBe(1.5);
    await bulkPercent.fill("");
    await expect.soft(applyMajoration).toBeDisabled();
    const bulkMajoration = (await lineOf())?.h_mo_majoration;
    expect(bulkMajoration).toBe(1.5);

    // 6. Grid « Majoration MO (%) » cell, same convention (P-11, E7, E9): « 112,5 % » → 1,125;
    // emptied → ×1, never ×0; « 1 001 » (×10,01) refused and not saved. Hidden by every preset, the
    // column is enabled for this step, then the personal columns are reset. « 112,5 % » comes first:
    // right after a bulk action, a cell edit back to the pre-bulk value is dropped by the autosave
    // (pre-existing defect outside 2.3, recorded in docs/testing/estimate-input-import-2.3.md).
    await screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true }).uncheck();
    await expect(bulkBar).toBeHidden();
    const display = screen.getByTestId("estimate-editor-display-button", { visible: true });
    await display.click();
    await screen.getByRole("button", "Personnalisé", { exact: true }).click();
    await screen.getByRole("checkbox", "Majoration MO (%)", { exact: true }).check();
    await display.click();
    const gridMajoration = screen.getByLabel(`Majoration de main-d’œuvre en pourcentage pour ${title}`, { exact: true });
    await expect(gridMajoration).toHaveValue("150");
    // Line autosave is debounced (60 s): Ctrl+S flushes it, as in commercial-rounding.e2e.ts.
    const savedMajoration = async (expected: number) => {
      await browser.keyboard.press("ControlOrMeta+s");
      await waitForAutoSave(ui, ids.versionId, (snapshot) =>
        snapshot.items.some((item) => item.id === line.id && item.h_mo_majoration === expected), army);
      expect((await lineOf())?.h_mo_majoration).toBe(expected);
    };
    await gridMajoration.fill("112,5 %");
    await gridMajoration.press("Tab");
    await savedMajoration(1.125);
    await gridMajoration.fill("");
    await gridMajoration.press("Tab");
    await savedMajoration(1);
    await gridMajoration.fill("1 001");
    await gridMajoration.press("Tab");
    await expect(gridMajoration).toHaveAttribute("aria-invalid", "true");
    await expect.poll(() => describedReason(byLabel(`Majoration de main-d’œuvre en pourcentage pour ${title}`))).toMatch(/^Nombre invalide/);
    await browser.reload();
    await expect(grid).toBeVisible();
    await expect(gridMajoration).toHaveValue("100");
    const persisted = await readEstimate(browser, ids.versionId);
    await display.click();
    await screen.getByRole("button", "Réinitialiser les colonnes et leurs largeurs", { exact: true }).click();
    await display.click();
    await expect(gridMajoration).toBeHidden();

    // 7. Paste (2.3 review): quantity is numeric(12,3), so « 1,2345 » is refused as in the import
    // instead of being rounded on write; a bare « Prix Unitaire » (an OPTIMA sale price) is never
    // proposed as the supply cost (D11).
    await screen.getByTestId("estimate-line-title-input", { visible: true }).click();
    await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    const preciseTitle = `${army.runPrefix} quantité trop précise`;
    const preciseTsv = ["Désignation\tQuantité\tPrix Unitaire", `${preciseTitle}\t1,2345\t174,59`].join("\n");
    await browser.evaluate((text) => {
      const target = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
      if (!(target instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      return true;
    }, preciseTsv);
    await expect(pasteDialog).toBeVisible();
    const salePriceTarget = screen.getByLabel("Champ cible de la colonne Prix Unitaire", { exact: true });
    await expect(salePriceTarget).toHaveValue("");
    const preciseReason = screen.getByTestId("paste-preview-row-invalid-reason");
    await expect(preciseReason).toContainText(`Quantité : ${refusal}`);
    const preciseReasonText = await preciseReason.textContent();
    await screen.getByTestId("paste-preview-dialog-cancel-button").click();
    await expect(pasteDialog).toBeHidden();

    // 8. Grid quantity cell (2.3 review): « 1,2345 » refused, the stored quantity is unchanged.
    const quantity = screen.getByLabel(`Quantité pour ${title}`, { exact: true });
    await quantity.fill("1,2345");
    await quantity.press("Tab");
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    // This reload intentionally discards the rejected draft. Handle only the
    // browser's leave warning; unrelated dialogs must still fail the journey.
    const reloadDialogs: string[] = [];
    const stopReloadDialogs = await browser.onDialog(async (dialog) => {
      reloadDialogs.push(dialog.type);
      if (dialog.type !== "beforeunload") {
        await dialog.dismiss();
        throw new Error(`Unexpected dialog during rejected quantity reload: ${dialog.type}`);
      }
      await dialog.accept();
    });
    try {
      await browser.reload();
    } finally {
      await stopReloadDialogs();
    }
    await expect(grid).toBeVisible();
    expect((await lineOf())?.quantity).toBe(1);

    // 9. Settings « TVA unique » (2.3 review): the rate reads as at the import, « 5,5 % » → 550 pb;
    // « 12,555 » is refused instead of being stored as 1 256 pb.
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
    await screen.getByTestId("estimate-editor-settings-button", { visible: true }).click();
    await expect(screen.getByRole("dialog", "Paramétrage du devis", { exact: true })).toBeVisible();
    const tax = screen.getByLabel("TVA unique", { exact: true });
    await tax.fill("5,5 %");
    await tax.press("Tab");
    await expect(tax).not.toHaveAttribute("aria-invalid", "true");
    await screen.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).version.tax_rate_bp).toBe(550);
    await tax.fill("12,555");
    await tax.press("Tab");
    await expect(tax).toHaveAttribute("aria-invalid", "true");
    await browser.reload();
    await expect(grid).toBeVisible();
    const reviewed = await readEstimate(browser, ids.versionId);
    expect(reviewed.version.tax_rate_bp).toBe(550);
    expect(reviewed.items.some((item) => item.title === preciseTitle)).toBe(false);

    await recordEvidence(army, "numeric-entry-v3", {
      ids, itemId: line.id, refusal, pasteReason: pasteReasonText, preciseQuantityReason: preciseReasonText, reloadDialogs,
      expected: {
        priceCents: 1000, discountCents: 100000, pastedTitleAbsent: pastedTitle, bulkMajoration: 1.5,
        gridMajorationPercent: 1.125, gridMajorationAfterReload: 1, gridMajorationRefusedText: "1 001",
        preciseQuantityTitleAbsent: preciseTitle, salePriceTarget: "", gridQuantityAfterRefusal: 1,
        taxRateBp: 550, taxRateRefusedText: "12,555",
      },
      actual: {
        priceCents: persisted.items.find((item) => item.id === line.id)?.unit_price_ht_cents,
        discountCents: persisted.version.discount_amount_cents,
        pastedTitlePresent: persisted.items.some((item) => item.title === pastedTitle),
        bulkMajoration,
        gridMajorationAfterReload: persisted.items.find((item) => item.id === line.id)?.h_mo_majoration,
        preciseQuantityTitlePresent: reviewed.items.some((item) => item.title === preciseTitle),
        gridQuantityAfterRefusal: reviewed.items.find((item) => item.id === line.id)?.quantity,
        taxRateBp: reviewed.version.tax_rate_bp,
      },
    });
  },
);

// Browser constraint-validation can steal focus; a DOM-only test cannot expose it.
armyTest("NUMNAV01 invalid estimate numbers release focus without saving and recover after correction or Escape",
  { session: "army", tags: ["critical", "local", "numeric-entry"], timeout: 240_000 }, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const draft = await prepareV3Draft(ui, army, "NUMNAV01");
    const title = `${army.runPrefix} numeric navigation`;
    const [line] = await seedLines(ui, army, draft, "numeric-navigation", [{ title, quantity: 2, unit_code: "u",
      pricing_status: "priced", unit_price_ht_cents: 10000, h_mo_per_unit: 1, labor_role_id: draft.tuyauteurId,
      k_fo: 1, k_mo: 1, tax_rate_bp: 2000 }]);
    await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await showStandardColumns(ui);
    const priceLabel = `Prix d’achat unitaire HT pour ${title}`;
    const coefficientLabel = `Coefficient fourniture K FO pour ${title}`;
    const price = screen.getByLabel(priceLabel, { exact: true });
    const coefficient = screen.getByLabel(coefficientLabel, { exact: true });
    const activeLabel = () => browser.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
    const savedLine = async () => (await readEstimate(browser, draft.versionId)).items.find(item => item.id === line.id)!;
    const unchanged = async () => {
      const saved = await savedLine();
      expect([saved.unit_price_ht_cents, saved.k_fo, saved.line_total_ht_cents])
        .toEqual([line.unit_price_ht_cents, line.k_fo, line.line_total_ht_cents]);
    };
    for (const token of ["", "1.250", "12x"]) {
      await price.fill(token);
      await price.press("Tab");
      await expect(price).toHaveAttribute("aria-invalid", "true");
      await expect.poll(activeLabel).not.toBe(priceLabel);
      if (token === "") await recordEvidence(army, "numeric-empty-draft-navigation", { screenshot: await app.screenshot("numeric-empty-draft-navigation") });
      await screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
      await expect(screen.getByTestId("estimate-editor-insert-button", { visible: true })).toHaveAttribute("aria-expanded", "true");
      await screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
      await unchanged();
      await price.fill("100,00");
      await price.press("Tab");
      await expect(price).not.toHaveAttribute("aria-invalid", "true");
    }
    await coefficient.fill("1,2,3");
    await coefficient.press("Tab");
    await expect(coefficient).toHaveAttribute("aria-invalid", "true");
    await expect.poll(activeLabel).not.toBe(coefficientLabel);
    await screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
    await screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
    await unchanged();
    await coefficient.fill("1,5");
    await coefficient.press("Tab");
    await price.fill("80,25");
    await price.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, title, army);
    await expect.poll(async () => { const saved = await savedLine(); return [saved.unit_price_ht_cents, saved.k_fo]; })
      .toEqual([8025, 1.5]);
    await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
    for (const [field, label] of [[price, priceLabel], [coefficient, coefficientLabel]] as const) {
      await field.fill("invalid");
      await field.press("Escape");
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
      const validity = await browser.evaluate((name) => {
        const input = Array.from(document.querySelectorAll("input")).find(node => node.getAttribute("aria-label") === name);
        return input ? { customError: input.validity.customError, value: input.value } : null;
      }, label);
      expect(validity?.customError).toBe(false);
    }
    await recordEvidence(army, "numeric-navigation-restored", { versionId: draft.versionId, saved: await savedLine() });
    await browser.reload();
    await waitForDraftLease(ui);
    expect((await savedLine()).unit_price_ht_cents).toBe(8025);
    expect((await savedLine()).k_fo).toBe(1.5);
  });
