import { expect } from "e2e";

import {
  armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, setLineCoreValues, waitForAutoSave, type ArmyEstimate,
} from "../critical/fixtures";

function financials(estimate: ArmyEstimate) {
  return {
    totals: [estimate.version.total_ht_cents, estimate.version.total_tax_cents, estimate.version.total_ttc_cents],
    lines: estimate.items.map(({ id, quantity, unit_price_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents }) =>
      ({ id, quantity, unit_price_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents })),
  };
}

armyTest("COL01 personal column order and width survive reload and another estimate without changing money", {
  session: "army", tags: ["critical", "extended", "personal-columns"], trace: "off", timeout: 240_000,
}, async (ui) => {
  await ui.browser.emulateMedia({ reducedMotion: "reduce" });
  const first = await createEstimateViaWizard(ui, { projectName: ui.army.projectName, title: `${ui.army.runPrefix} columns A` }, ui.army);
  const lineTitle = `${ui.army.runPrefix} priced line`;
  const line = await createLineViaApi(ui.browser, first.versionId, lineTitle);
  await ui.browser.reload();
  await setLineCoreValues(ui, lineTitle, { quantity: "3", unitPriceHt: "15,00" });
  const before = await waitForAutoSave(ui, first.versionId, (snapshot) => snapshot.items.some((item) =>
    item.id === line.id && item.quantity === 3 && item.unit_price_ht_cents === 1500 && item.line_total_ht_cents === 4500), ui.army);
  expect(before.version.total_ht_cents).toBe(4500);
  const owner = (before.version.estimate_projects as { user_id?: string }).user_id;
  expect(owner).toMatch(/^[0-9a-f-]{36}$/i);
  const second = await createEstimateViaWizard(ui, { projectName: `${ui.army.projectName} B`, title: `${ui.army.runPrefix} columns B` }, ui.army);
  await ui.app.open(`/dashboard/estimates/${first.versionId}/edit`);
  const table = ui.screen.getByTestId("estimate-editor-table", { visible: true });
  await expect(table).toBeVisible();
  const total = ui.screen.getByRole("button", /^Total HT :/);
  const initialTotal = await total.textContent();
  if (!initialTotal) throw new Error("The priced estimate must expose its Total HT before changing columns.");
  const display = ui.screen.getByTestId("estimate-editor-display-button", { visible: true });
  const openDisplay = async () => {
    await ui.screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
    await display.click();
  };
  await openDisplay();
  await ui.screen.getByRole("button", "Réinitialiser les colonnes et leurs largeurs", { exact: true }).click();
  await ui.screen.getByRole("button", "Personnalisé", { exact: true }).click();
  for (const name of ["K FO", "Marque %", "Fournisseur"]) await ui.screen.getByRole("checkbox", name, { exact: true }).check();
  await ui.screen.getByText("Ordre des colonnes, par groupe", { exact: true }).click();
  await ui.screen.getByRole("button", "Déplacer K FO vers la gauche", { exact: true }).click();
  await ui.screen.getByRole("button", "Déplacer K FO vers la gauche", { exact: true }).click();
  await display.click();
  await ui.screen.getByRole("button", "Ajuster la largeur de la colonne Désignation", { exact: true }).press("ArrowRight");
  const headers = await ui.browser.evaluate(() => document.querySelector('[data-testid="estimate-editor-table-head"]')?.textContent ?? "");
  expect(headers).toContain("Marque %"); expect(headers).toContain("Fournisseur");
  expect(headers.indexOf("K FO")).toBeGreaterThanOrEqual(0);
  expect(headers.indexOf("K FO")).toBeLessThan(headers.indexOf("PR FO"));
  const layout = await ui.browser.evaluate(() => {
    const columns = (selector: string) => Array.from(document.querySelectorAll(`${selector} [data-estimate-column]`))
      .map((element) => element.getAttribute("data-estimate-column"));
    return {
      grid: (document.querySelector('[data-testid="estimate-editor-table"]') as HTMLElement).style.getPropertyValue("--estimate-grid-desktop"),
      preferences: Object.fromEntries(Object.entries(localStorage).filter(([key]) => /^est-col-(vis|custom|override|widths-v1|order-v1):/.test(key))),
      footer: columns('[data-testid="estimate-editor-table-footer"]'),
      row: columns('[data-testid="estimate-line-row"]'),
    };
  });
  expect(layout.grid.length).toBeGreaterThan(0);
  expect(Object.keys(layout.preferences).some((key) => key.startsWith("est-col-widths-v1:"))).toBe(true);
  expect(Object.keys(layout.preferences).every((key) => key.endsWith(`:${owner}`))).toBe(true);
  expect(layout.footer.indexOf("k_fo")).toBeGreaterThanOrEqual(0);
  expect(layout.footer.indexOf("k_fo")).toBeLessThan(layout.footer.indexOf("supply_price"));
  for (const key of ["k_fo", "marque", "supplier"]) expect(layout.row).toContain(key);
  await expect(ui.browser.locator('[data-testid="estimate-line-row"] [data-estimate-column="designation"] [data-testid="estimate-line-selected-supplier"]')).toHaveCount(0);
  const price = ui.browser.locator('[data-testid="estimate-line-row"] [data-cell-column-key="unit_price"]');
  await price.focus(); await price.press("ArrowRight");
  await expect(ui.browser.locator('[data-testid="estimate-line-row"] [data-cell-column-key="supplier"]')).toBeFocused();
  await expect(total).toHaveText(initialTotal);
  const grid = () => ui.browser.evaluate(() => (document.querySelector('[data-testid="estimate-editor-table"]') as HTMLElement | null)?.style.getPropertyValue("--estimate-grid-desktop") ?? "");
  await ui.browser.reload();
  await expect(table).toBeVisible();
  await expect.poll(grid).toBe(layout.grid);
  await expect(total).toHaveText(initialTotal);
  await ui.app.open(`/dashboard/estimates/${second.versionId}/edit`);
  await expect(table).toBeVisible();
  await expect.poll(grid).toBe(layout.grid);
  await ui.app.open(`/dashboard/estimates/${first.versionId}/edit`);
  await expect(table).toBeVisible();
  await openDisplay();
  await ui.screen.getByRole("button", "Réinitialiser les colonnes et leurs largeurs", { exact: true }).click();
  await expect.poll(() => ui.browser.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("est-col-widths-v1:")).length)).toBe(0);
  await expect(total).toHaveText(initialTotal);
  const after = await readEstimate(ui.browser, first.versionId);
  expect(financials(after)).toEqual(financials(before));
  await recordEvidence(ui.army, "personal-columns", {
    first, second, expected: { htCents: 4500, accountScoped: true, resetWidthKeys: 0 },
    layout, before: financials(before), after: financials(after),
  });
});
