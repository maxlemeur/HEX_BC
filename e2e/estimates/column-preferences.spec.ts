import { execFileSync } from "node:child_process";

import { expect, test as base, type Page } from "@playwright/test";
import {
  apiJson, createConnectedRun, loginAndVerifyIdentity, persistConnectedRun,
  recordConnectedStep, type ConnectedRun,
} from "./demo-eight-connected.helpers";
import {
  addConnectedSupplyLine, createConnectedEstimate, openConnectedEstimate, type ConnectedEstimate,
} from "./demo-eight-estimate.connected.helpers";

// Observable failures: account-shared storage, preferences lost on navigation,
// header/body/footer disagreement after reordering, hidden data changing totals,
// and reset leaving old widths behind. Connected mode creates only new ARMY fixtures.
const connected = process.env.E2E_DEMO_CONNECTED === "1";
const test = base.extend<{ connectedRun: ConnectedRun | null }>({
  connectedRun: async ({ page }, runTest, testInfo) => {
    if (!connected) return runTest(null);
    const run = await createConnectedRun(testInfo, "colonnes");
    run.manifest.command = "npx playwright test --config=e2e/demo-eight.connected.config.ts column-preferences.spec.ts";
    let completed = false;
    try {
      await loginAndVerifyIdentity(page, run);
      await runTest(run);
      completed = true;
    } finally {
      run.manifest.result = completed ? testInfo.status ?? "failed" : "failed";
      run.manifest.finishedAt = new Date().toISOString();
      await persistConnectedRun(run);
      await testInfo.attach("business-manifest", { path: run.manifestPath, contentType: "application/json" });
    }
  },
});

async function openDisplay(page: Page) {
  await page.getByRole("tab", { name: /Affichage & contrôle/ }).click();
  await page.getByTestId("estimate-editor-display-button").click();
}

test("TI-577 — personal columns retain order and widths without changing the estimate", async ({ page, connectedRun }, testInfo) => {
  let versionId = process.env.E2E_COLUMNS_VERSION_ID;
  let secondVersionId = process.env.E2E_COLUMNS_SECOND_VERSION_ID ?? versionId;
  let before: ConnectedEstimate | null = null;
  if (connectedRun) {
    const first = await createConnectedEstimate(page, connectedRun, "Colonnes A");
    const second = await createConnectedEstimate(page, connectedRun, "Colonnes B");
    versionId = first.version.id;
    secondVersionId = second.version.id;
    await openConnectedEstimate(page, versionId);
    await addConnectedSupplyLine(page, connectedRun, versionId);
    await expect.poll(async () => (await apiJson<ConnectedEstimate>(page,
      `/api/estimates/${versionId}`)).version.total_ht_cents,
    { timeout: 90_000, message: "Wait for the editor's persisted financial baseline" }).toBe(4500);
    before = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  } else {
    test.skip(!versionId, "Provide E2E_COLUMNS_VERSION_ID identifying an accessible existing estimate. Missing fixture is not proof.");
    await page.goto(`/dashboard/estimates/${versionId}/edit`);
  }
  const table = page.getByTestId("estimate-editor-table");
  await expect(table).toBeVisible();
  const totalButton = page.getByRole("button", { name: /^Total HT :/ });
  const originalTotal = await totalButton.textContent();

  await openDisplay(page);
  await page.getByRole("button", { name: "Réinitialiser les colonnes et leurs largeurs" }).click();
  await page.getByRole("button", { name: "Personnalisé", exact: true }).click();
  await page.getByRole("checkbox", { name: "K FO", exact: true }).check();
  await page.getByRole("checkbox", { name: "Marque %", exact: true }).check();
  await page.getByRole("checkbox", { name: "Fournisseur", exact: true }).check();
  await page.getByText("Ordre des colonnes, par groupe", { exact: true }).click();
  await page.getByRole("button", { name: "Déplacer K FO vers la gauche", exact: true }).click();
  await page.getByRole("button", { name: "Déplacer K FO vers la gauche", exact: true }).click();
  await page.getByTestId("estimate-editor-display-button").click();
  await page.getByRole("button", { name: "Ajuster la largeur de la colonne Désignation", exact: true }).press("ArrowRight");

  const headers = await page.getByTestId("estimate-editor-table-head").allTextContents();
  expect(headers.join(" ")).toContain("Marque %");
  expect(headers.join(" ")).toContain("Fournisseur");
  expect(headers.join(" ").indexOf("K FO")).toBeLessThan(headers.join(" ").indexOf("PR FO"));
  const grid = await table.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--estimate-grid-desktop"));
  await expect(totalButton).toHaveText(originalTotal ?? "");
  const preferences = await page.evaluate(() => Object.fromEntries(
    Object.entries(localStorage).filter(([key]) => /^est-col-(vis|custom|override|widths-v1|order-v1):/.test(key)),
  ));
  expect(Object.keys(preferences).some((key) => key.startsWith("est-col-widths-v1:"))).toBe(true);
  if (connectedRun) expect(Object.keys(preferences).every((key) => key.endsWith(`:${connectedRun.manifest.userId}`))).toBe(true);
  const keys = await page.getByTestId("estimate-editor-table-footer").locator("[data-estimate-column]").evaluateAll(
    (elements) => elements.map((element) => element.getAttribute("data-estimate-column")),
  );
  expect(keys.indexOf("k_fo")).toBeLessThan(keys.indexOf("supply_price"));
  const row = page.getByTestId("estimate-line-row").first();
  if (await row.count()) {
    const lineColumns = await row.locator("[data-estimate-column]").evaluateAll(
      (elements) => elements.map((element) => element.getAttribute("data-estimate-column")),
    );
    expect(lineColumns).toContain("k_fo");
    expect(lineColumns).toContain("marque");
    expect(lineColumns).toContain("supplier");
    await expect(row.locator('[data-estimate-column="designation"] [data-testid="estimate-line-selected-supplier"]')).toHaveCount(0);
    const supplyPriceCell = row.locator('[data-cell-column-key="unit_price"]');
    await supplyPriceCell.focus();
    await supplyPriceCell.press("ArrowRight");
    await expect(row.locator('[data-cell-column-key="supplier"]')).toBeFocused();
  }

  await page.reload();
  await expect(table).toBeVisible();
  await expect.poll(() => table.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--estimate-grid-desktop"))).toBe(grid);
  await expect(totalButton).toHaveText(originalTotal ?? "");

  if (secondVersionId !== versionId) {
    await page.goto(`/dashboard/estimates/${secondVersionId}/edit`);
    await expect(table).toBeVisible();
    await expect.poll(() => table.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--estimate-grid-desktop"))).toBe(grid);
    await page.goto(`/dashboard/estimates/${versionId}/edit`);
    await expect(table).toBeVisible();
  }
  await testInfo.attach("personal-columns", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await openDisplay(page);
  await page.getByRole("button", { name: "Réinitialiser les colonnes et leurs largeurs" }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("est-col-widths-v1:")).length)).toBe(0);
  await expect(totalButton).toHaveText(originalTotal ?? "");

  if (connectedRun && before) {
    const after = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
    expect(after.version.total_ht_cents).toBe(before.version.total_ht_cents);
    expect(after.items.map(({ id, quantity, unit_price_ht_cents, line_total_ht_cents }) =>
      ({ id, quantity, unit_price_ht_cents, line_total_ht_cents }))).toEqual(before.items.map(
      ({ id, quantity, unit_price_ht_cents, line_total_ht_cents }) =>
        ({ id, quantity, unit_price_ht_cents, line_total_ht_cents })));
    const remainingWidthKeys = await page.evaluate(() => Object.keys(localStorage)
      .filter((key) => key.startsWith("est-col-widths-v1:")).length);
    await recordConnectedStep(connectedRun, "Personal columns across two new estimates", {
      versionId, secondVersionId, totalCents: 4500, accountScopedKeys: true, remainingWidthKeys: 0,
    }, { versionId, secondVersionId, totalCents: after.version.total_ht_cents, preferences, grid,
      footerOrder: keys, remainingWidthKeys });
  }

  await testInfo.attach("repeatable-context", {
    body: JSON.stringify({
      command: connectedRun?.manifest.command ?? "E2E_COLUMNS_VERSION_ID=<fixture> E2E_COLUMNS_SECOND_VERSION_ID=<optional second fixture> npx playwright test column-preferences.spec.ts --project=chromium",
      revision: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      localChanges: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "status", "--short"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      environment: { baseURL: testInfo.project.use.baseURL, node: process.version, project: testInfo.project.name },
      fixture: { versionId, secondVersionId },
      expected: { personalKeys: true, restoredGrid: true, unchangedEstimateTotal: true, resetWidths: true },
      actual: { preferences, grid, footerOrder: keys, originalTotal, finalTotal: await totalButton.textContent() },
      evidence: "personal-columns.png attachment and Playwright report",
    }, null, 2),
    contentType: "application/json",
  });
});
