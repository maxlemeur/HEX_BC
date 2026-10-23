import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { expect, type Screen } from "e2e";
import { armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, resolveDownload,
  waitForAutoSave } from "../critical/fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "mobile"], timeout: 240_000 };

// At the mobile breakpoint, the desktop grid remains in the DOM but is hidden.
// Open the actual mobile sheet and scope its controls instead of filling that grid.
async function openMobileLine(screen: Screen, title: string) {
  await expect(screen.getByRole("region", "Vue mobile du chiffrage", { exact: true })).toBeVisible();
  await screen.getByRole("button", `Modifier la ligne ${title}`, { exact: true }).tap();
  const editor = screen.getByTestId("estimate-mobile-line-editor");
  await expect(editor).toBeVisible();
  return editor;
}

async function editAndSaveMobileLine(screen: Screen, title: string, quantity: string, unitPriceHt: string) {
  const editor = await openMobileLine(screen, title);
  const quantityInput = editor.getByLabel(`Quantité pour ${title}`, { exact: true });
  const priceInput = editor.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true });
  await quantityInput.scrollIntoView();
  await quantityInput.fill(quantity);
  // Moving to the next real field commits the quantity through its blur handler.
  await priceInput.scrollIntoView();
  await priceInput.fill(unitPriceHt);
  await editor.getByRole("button", "Terminer", { exact: true }).tap();
  await expect(editor).toBeHidden();
  await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("En attente");
  await screen.getByRole("button", "Plus d'actions", { exact: true }).tap();
  await screen.getByTestId("estimate-page-toolbar-save-now-button").tap();
}

armyTest("MB01 mobile navigation reaches affaires and restores focus after closing the drawer", options, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard");
  expect(await browser.evaluate(() => window.innerWidth)).toBe(390);
  const open = screen.getByRole("button", "Ouvrir le menu principal", { exact: true });
  await open.tap();
  const drawer = browser.locator("#dashboard-sidebar");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await drawer.getByRole("link", "Affaires", { exact: true }).tap();
  await expect(browser).toHaveURL("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { level: 1, exact: true })).toBeVisible();
  await expect(browser.locator("main")).not.toHaveAttribute("inert", "");
  await open.tap();
  await browser.keyboard.press("Escape");
  await expect(open).toBeFocused();
  const dimensions = await browser.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
  await recordEvidence(army, "mobile-navigation", { dimensions, target: "Chromium viewport 390x844; no native-device claim" });
});

armyTest("MB02 mobile creation and decimal editing persist exact cents after reload", options, async ({ app, browser, screen, army }) => {
  const ui = { app, browser, screen }, title = `${army.runPrefix} mobile`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  const line = await createLineViaApi(browser, ids.versionId, title);
  await browser.reload();
  await editAndSaveMobileLine(screen, title, "2,5", "12,50");
  await waitForAutoSave(ui, ids.versionId, (state) => state.items.some((item) => item.id === line.id && item.line_total_ht_cents === 3125), army);
  const editor = await openMobileLine(screen, title);
  const quantity = editor.getByLabel(`Quantité pour ${title}`, { exact: true });
  await quantity.scrollIntoView();
  await quantity.fill("2oops");
  await editor.getByTestId("estimate-mobile-line-title-input").tap();
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await browser.reload();
  const reloadedEditor = await openMobileLine(screen, title);
  await expect(reloadedEditor.getByLabel(`Quantité pour ${title}`, { exact: true })).toHaveValue("2,5");
  await expect(reloadedEditor.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true })).toHaveValue("12,5");
  const state = await readEstimate(browser, ids.versionId), saved = state.items.find((item) => item.id === line.id)!;
  expect([saved.quantity, saved.unit_price_ht_cents, saved.line_total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents]).toEqual([2.5, 1250, 3125, 625, 3750]);
  await recordEvidence(army, "mobile-persistence", { ids, saved, totals: [3125, 625, 3750], rejected: "2oops" });
});

armyTest("MB03 mobile export downloads the persisted business values", options, async ({ app, browser, screen, army }) => {
  const ui = { app, browser, screen }, title = `${army.runPrefix} mobile export`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  await createLineViaApi(browser, ids.versionId, title);
  await browser.reload();
  await editAndSaveMobileLine(screen, title, "3", "12,34");
  await waitForAutoSave(ui, ids.versionId, (state) => state.version.total_ht_cents === 3702, army);
  await screen.getByRole("button", "Plus d'actions", { exact: true }).tap();
  const download = await browser.waitForDownload(() => screen.getByRole("menuitem", "Exporter Excel", { exact: true }).tap(), { timeout: 60_000 });
  const file = await resolveDownload(download), bytes = await readFile(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const rows: ExcelJS.Row[] = [];
  workbook.getWorksheet("Devis")!.eachRow((row) => { if (row.getCell(2).text === title) rows.push(row); });
  expect(rows.length).toBe(1);
  expect([4, 5, 6, 7, 8].map((column) => rows[0].getCell(column).value)).toEqual([3, 12.34, 37.02, 7.4, 44.42]);
  expect((await readEstimate(browser, ids.versionId)).version.total_ttc_cents).toBe(4442);
  await recordEvidence(army, "mobile-export", { ids, path: file, sha256: createHash("sha256").update(bytes).digest("hex"), values: [3, 12.34, 37.02, 7.4, 44.42] });
});
