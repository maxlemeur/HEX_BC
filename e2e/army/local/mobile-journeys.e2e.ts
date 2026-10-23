import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { expect } from "e2e";
import { armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, resolveDownload,
  saveLineEditsWithShortcut, setLineCoreValues, waitForAutoSave } from "../critical/fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "mobile"], timeout: 240_000 };

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
  await setLineCoreValues(ui, title, { quantity: "2,5", unitPriceHt: "12,50" });
  await saveLineEditsWithShortcut(ui, ids.versionId, title, army);
  await waitForAutoSave(ui, ids.versionId, (state) => state.items.some((item) => item.id === line.id && item.line_total_ht_cents === 3125), army);
  const quantity = screen.getByLabel(`Quantité pour ${title}`, { exact: true });
  await quantity.fill("2oops");
  await quantity.press("Tab");
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await browser.reload();
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const state = await readEstimate(browser, ids.versionId), saved = state.items.find((item) => item.id === line.id)!;
  expect([saved.quantity, saved.unit_price_ht_cents, saved.line_total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents]).toEqual([2.5, 1250, 3125, 625, 3750]);
  await recordEvidence(army, "mobile-persistence", { ids, saved, totals: [3125, 625, 3750], rejected: "2oops" });
});

armyTest("MB03 mobile export downloads the persisted business values", options, async ({ app, browser, screen, army }) => {
  const ui = { app, browser, screen }, title = `${army.runPrefix} mobile export`;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
  await createLineViaApi(browser, ids.versionId, title);
  await browser.reload();
  await setLineCoreValues(ui, title, { quantity: "3", unitPriceHt: "12,34" });
  await saveLineEditsWithShortcut(ui, ids.versionId, title, army);
  await waitForAutoSave(ui, ids.versionId, (state) => state.version.total_ht_cents === 3702, army);
  await screen.getByRole("button", "Exporter", { exact: true }).tap();
  const download = await browser.waitForDownload(() => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap(), { timeout: 60_000 });
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
