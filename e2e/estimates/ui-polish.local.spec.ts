import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

let server: Server;
let baseUrl: string;
let threshold: number | null = 45;
let comparisons: unknown[] = [];
let sourceHashes: Record<string, string> = {};
const itemId = "11111111-1111-4111-8111-111111111111";

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: process.cwd(), entryPoints: [resolve("e2e/fixtures/ui-polish.tsx")],
    tsconfig: resolve("tsconfig.json"), bundle: true, write: false, format: "iife",
    platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
    banner: { js: "var process = { env: {}, browser: true };" },
    plugins: [{ name: "local-profile-action", setup(builder) {
      builder.onResolve({ filter: /\/dashboard\/_actions\/profile$/ }, () => ({ path: "profile", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export async function updateProfileUiMode(input) { return input; }", loader: "js" }));
    } }],
  });
  const css = await postcss([tailwindcss()]).process(readFileSync("src/app/globals.css", "utf8"), { from: resolve("src/app/globals.css") });
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/fixture.css") {
      response.setHeader("Content-Type", "text/css"); response.end(css.css);
    } else if (request.url?.endsWith("/supplier-comparisons")) {
      response.setHeader("Content-Type", "application/json");
      const result = { data: {
        ...(threshold === null ? {} : { stale_price_days: threshold }), comparisons: [{
          item_id: itemId, best_supplier_price_id: "33333333-3333-4333-8333-333333333333", selected_supplier_price_id: null,
          alternatives: [{ kind: "best_price", supplier_price_id: "33333333-3333-4333-8333-333333333333",
            supplier_name: "Fournisseur Alpha", adjusted_unit_price_cents: 900, currency: "EUR", unit: "u",
            updated_at: "2025-01-01T00:00:00Z", is_stale: true, is_active: true, is_selected: false }],
        }],
      } };
      comparisons.push(result);
      response.end(JSON.stringify(result));
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="fr"><title>Fixture UI</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>');
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture unavailable");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => { if (server) await new Promise<void>((closed) => server.close(() => closed())); });
test.beforeEach(async ({ page, browser }, info) => {
  page.on("pageerror", (error) => console.error(error.message));
  threshold = 45;
  comparisons = [];
  const sourceFiles = [
    "e2e/fixtures/ui-polish.tsx", "e2e/estimates/ui-polish.local.spec.ts", "e2e/ui-polish.local.config.ts",
    "src/components/feedback/toast-provider.tsx", "src/components/feedback/toast-renderer.tsx",
    "src/components/ui-legacy/Toast.tsx", "src/components/ui/toast.tsx",
    "src/components/estimates/EstimateEditorTable.tsx", "src/components/estimates/SupplierComparisonPanel.tsx",
    "src/components/estimates/hooks/useEstimateSupplierComparison.ts", "src/app/globals.css",
    "src/styles/legacy.css", "src/styles/estimate-frozen.css", "src/styles/animations.css",
    "src/styles/shadcn-bridge.css", "src/styles/tokens.css", "src/lib/openapi/registry.ts", "openapi.json",
    "package.json", "package-lock.json", "node_modules/next/package.json", "node_modules/@base-ui/react/package.json",
  ];
  sourceHashes = Object.fromEntries(sourceFiles.map((file) => [file,
    createHash("sha256").update(readFileSync(file)).digest("hex")]));
  const provenance = {
    command: "npx playwright test --config=e2e/ui-polish.local.config.ts",
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    changes: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
    diff: execFileSync("git", ["diff"], { encoding: "utf8", maxBuffer: 5_000_000 }),
    sourceHashes,
    environment: { baseUrl, node: process.version, browser: browser.version(), project: info.project.name },
    fixture: { path: "e2e/fixtures/ui-polish.tsx", itemId, threshold }, expected: info.title,
    evidence: info.outputDir,
  };
  const manifestPath = info.outputPath("manifest.json");
  writeFileSync(manifestPath, JSON.stringify(provenance, null, 2));
  await info.attach("provenance", { path: manifestPath, contentType: "application/json" });
  await page.goto(baseUrl);
  await expect(page.getByTestId("estimate-editor-table")).toBeVisible();
});
test.afterEach(async ({ page }, info) => {
  const sourceChangedDuringRun = Object.entries(sourceHashes).some(([file, hash]) =>
    createHash("sha256").update(readFileSync(file)).digest("hex") !== hash);
  const actualPath = info.outputPath("actual.json");
  writeFileSync(actualPath, JSON.stringify({ status: info.status, expectedStatus: info.expectedStatus,
    sourceChangedDuringRun,
    comparisons,
    notifications: await page.locator("[data-toast-id]").allTextContents(),
    dialog: await page.getByRole("dialog").allTextContents(),
  }, null, 2));
  await info.attach("actual", { path: actualPath, contentType: "application/json" });
  await info.attach("interface", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(sourceChangedDuringRun).toBe(false);
});

test("notifications retain FIFO, queued dismissal and full duration after promotion", async ({ page }) => {
  await page.getByRole("button", { name: "Rafale", exact: true }).click();
  const notifications = page.locator("[data-toast-id]");
  await expect(notifications).toHaveCount(3);
  await expect(notifications).toContainText(["Notification 1", "Notification 2", "Notification 3"]);
  await page.getByRole("button", { name: "Retirer en attente" }).click();
  await page.waitForTimeout(1700);
  await expect(notifications).toHaveCount(3);
  await page.getByRole("button", { name: "Retirer première" }).click();
  await expect(notifications).toContainText(["Notification 2", "Notification 3", "Notification 4"]);
  await expect(page.getByText("Notification 5", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Notification 4", { exact: true })).toBeVisible();
  await expect(page.getByText("Notification 4", { exact: true })).toHaveCount(0, { timeout: 5000 });
});

test("notification keyboard dismissal and hover pause use Base UI", async ({ page }) => {
  await page.getByRole("button", { name: "Erreur", exact: true }).click();
  const notification = page.locator('[data-slot="toast"]');
  await expect(notification).toContainText("Échec de sauvegarde");
  await notification.hover();
  await page.waitForTimeout(2200);
  await expect(notification).toBeVisible();
  await page.keyboard.press("F6");
  await expect(page.locator('[data-slot="toast-viewport"]')).toBeFocused();
  // Audit rendered notifications; Base UI's focus guards are exercised with F6.
  const axe = await new AxeBuilder({ page }).include('[data-slot="toast"]').analyze();
  expect(axe.violations).toEqual([]);
  await notification.getByRole("button", { name: "Fermer la notification" }).focus();
  await page.keyboard.press("Enter");
  await expect(notification).toHaveCount(0);
  await page.getByRole("button", { name: "Succès bref" }).click();
  await expect(page.getByText("Devis enregistré", { exact: true })).toBeVisible();
  await expect(page.getByText("Devis enregistré", { exact: true })).toHaveCount(0, { timeout: 5000 });
});

test("supplier comparison displays the API threshold and tolerates historical responses", async ({ page }, info) => {
  for (const days of [45, 120, null]) {
    threshold = days;
    await page.getByTestId("estimate-line-row").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "Comparer les fournisseurs", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Fournisseur Alpha");
    await expect(dialog).toContainText(days === null ? "au-delà du seuil de fraîcheur" : `seuil de fraîcheur : ${days} j`);
    await expect(dialog).not.toContainText("seuil de fraîcheur : 90 j");
    await info.attach(`comparison-${days ?? "historical"}`, { body: await dialog.screenshot(), contentType: "image/png" });
    if (days === 45) {
      await page.evaluate(() => window.dispatchEvent(new Event("fixture-notification")));
      const notification = page.locator('[data-slot="toast"]');
      await expect(notification).toContainText("Notification pendant la comparaison");
      await notification.locator('[data-slot="toast-close"]').click();
      await expect(notification).toHaveCount(0);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
});

test("legacy utilities win while frozen FO/MO headers keep accessible contrast", async ({ page }, info) => {
  await expect(page.getByTestId("cascade-button")).toHaveCSS("background-color", "oklch(0.505 0.213 27.518)");
  for (const width of [1600, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    const headers = page.locator(".estimate-super-head__group--fo, .estimate-super-head__group--mo");
    await expect(headers).toHaveCount(2);
    await expect(headers.first()).toHaveCSS("font-size", "10px");
    const axe = await new AxeBuilder({ page }).include(".estimate-super-head__group--fo").include(".estimate-super-head__group--mo").withRules(["color-contrast"]).analyze();
    expect(axe.violations).toEqual([]);
    await info.attach(`contrast-${width}`, { body: JSON.stringify(axe), contentType: "application/json" });
    await info.attach(`headers-${width}`, { body: await page.locator(".estimate-table__super-head").screenshot(), contentType: "image/png" });
  }
});
