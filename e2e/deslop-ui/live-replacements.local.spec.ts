import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import tailwind from "@tailwindcss/postcss";
import { build } from "esbuild";
import postcss from "postcss";

type CapturedEvent = {
  action: string;
  ids?: string[];
  input?: Record<string, unknown>;
  reviewedIds?: string[];
  markedIds?: string[];
  excludedIds?: string[];
};

let server: Server;
let baseUrl: string;
let events: CapturedEvent[] = [];
let browserErrors: string[] = [];
let blockedUrls: string[] = [];

const TUBE_ID = "11111111-1111-4111-8111-111111111111";
const VIS_ID = "22222222-2222-4222-8222-222222222222";
const COUDE_ID = "33333333-3333-4333-8333-333333333333";
const phase = process.env.DESLOP_UI_PHASE === "before" ? "before" : "after";
const command = phase === "before"
  ? "$env:DESLOP_UI_PHASE = 'before'\nnpx playwright test --config=e2e/deslop-ui.local.config.ts --grep \"tout accepter\""
  : "npx playwright test --config=e2e/deslop-ui.local.config.ts";

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [resolve("e2e/fixtures/deslop-live-replacements.tsx")],
    tsconfig: resolve("tsconfig.json"),
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    // Next normally replaces client environment reads. The standalone fixture
    // supplies an empty public environment and never reads project secrets.
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  });
  const stylesheetPath = resolve("src/app/globals.css");
  const stylesheet = await postcss([tailwind({ base: process.cwd() })]).process(
    readFileSync(stylesheetPath, "utf8"), { from: stylesheetPath },
  );

  server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    if (requestUrl.pathname === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (requestUrl.pathname === "/fixture.css") {
      response.setHeader("Content-Type", "text/css");
      response.end(stylesheet.css);
    } else if (requestUrl.pathname === "/fixture-events" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      events.push(JSON.parse(body) as CapturedEvent);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true }));
    } else if (requestUrl.pathname === "/api/catalogue") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, data: { items: [] } }));
    } else if (requestUrl.pathname === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Deslop live replacements</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture locale indisponible.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((closed) => server.close(() => closed()));
});

test.beforeEach(async ({ page }, testInfo) => {
  events = [];
  browserErrors = [];
  blockedUrls = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      blockedUrls.push(route.request().url());
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await testInfo.attach("provenance", {
    body: JSON.stringify({
      command,
      phase,
      revision: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      localChanges: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "status", "--short"], { encoding: "utf8" }),
      environment: "Chromium loopback; production components and CSS; fixture parent callbacks; no shared Supabase",
      fixture: "e2e/fixtures/deslop-live-replacements.tsx",
      fixtureIds: [TUBE_ID, VIS_ID, COUDE_ID],
      expected: testInfo.title,
      limitations: "Does not exercise Next routing, parent hooks, production API, authorization, database persistence, or takeoff application.",
    }),
    contentType: "application/json",
  });
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("actual", {
    body: JSON.stringify({ status: testInfo.status, events, browserErrors, blockedUrls }),
    contentType: "application/json",
  });
  await testInfo.attach("interface", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

test("le dialogue vivant refuse une ligne vide puis transmet nom, quantité et coût à la sauvegarde", async ({ page }, testInfo) => {
  await page.goto(`${baseUrl}?scenario=assembly`);
  await expect(page.getByRole("heading", { name: "Ouvrage — fixture locale", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Créer un ouvrage", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Nouvel ouvrage", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Nom de l'ouvrage *", { exact: true }).fill("Tube de démonstration");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("La désignation de la ligne 1 est obligatoire.");
  expect(events).toHaveLength(0);

  await dialog.getByLabel("Code / référence", { exact: true }).fill("DEMO-TUBE");
  await dialog.getByLabel("Unité de l'ouvrage", { exact: true }).fill("ml");
  await dialog.getByLabel("Désignation *", { exact: true }).fill("Tube PVC");
  await dialog.getByLabel("Unité", { exact: true }).fill("ml");
  await dialog.getByLabel("Quantité par défaut", { exact: true }).fill("2.5");
  await dialog.getByLabel("Prix de revient FO (€)", { exact: true }).fill("12.34");
  await testInfo.attach("assembly-before-save", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("status", { name: "", exact: true }).filter({ hasText: "Ouvrage enregistré localement" })).toBeVisible();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    action: "assembly-submit",
    input: {
      name: "Tube de démonstration", referenceCode: "DEMO-TUBE", unit: "ml", members: [],
      items: [{ title: "Tube PVC", unit: "ml", defaultQuantity: 2.5, unitCostHtCents: 1234, position: 1, costType: "material" }],
    },
  });
  expect(browserErrors).toEqual([]);
  expect(blockedUrls).toEqual([]);
});

test("la revue assistée vivante confirme acceptation et rejet puis déclenche appliquer", async ({ page }) => {
  await page.goto(`${baseUrl}?scenario=review`);
  await expect(page.getByRole("heading", { name: "Revue assistée — fixture locale", exact: true })).toBeVisible();
  const applyButton = page.getByRole("button", { name: "Appliquer au chiffrage", exact: true });
  await expect(applyButton).toBeDisabled();
  await page.getByRole("button", { name: "Accepter", exact: true }).nth(0).click();
  await expect(page.getByRole("button", { name: "Accepté", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Rejeter", exact: true }).nth(2).click();
  await expect(page.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(1);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  await expect(applyButton).toBeEnabled();
  await applyButton.click();
  await expect(page.getByRole("status", { name: "", exact: true }).filter({ hasText: "Application demandée localement" })).toBeVisible();
  expect(events).toEqual([
    { action: "include", ids: [TUBE_ID] },
    { action: "exclude", ids: [COUDE_ID] },
    { action: "apply-click", reviewedIds: [TUBE_ID, COUDE_ID], markedIds: [], excludedIds: [VIS_ID, COUDE_ID] },
  ]);
  expect(browserErrors).toEqual([]);
  expect(blockedUrls).toEqual([]);
});

test("tout accepter réintègre la ligne exclue et conserve le marquage à revoir", async ({ page }) => {
  await page.goto(`${baseUrl}?scenario=review`);
  await expect(page.getByRole("heading", { name: "Revue assistée — fixture locale", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "À revoir", exact: true }).nth(0).click();
  await expect(page.getByRole("button", { name: "Marqué à revoir", exact: true })).toHaveCount(1);
  await expect(page.getByText("Tube PVC", { exact: true })).not.toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Tout accepter (2 items)", exact: true }).click();
  await expect(page.getByRole("button", { name: "Accepté", exact: true })).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Marqué à revoir", exact: true })).toHaveCount(1);
  await expect(page.getByText("Tube PVC", { exact: true })).not.toHaveCSS("text-decoration-line", "line-through");
  await expect(page.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(0);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
  await expect(page.getByRole("status").filter({ hasText: "2 items acceptés" })).toBeVisible();
  await page.getByRole("button", { name: "Appliquer au chiffrage", exact: true }).click();
  await expect(page.getByRole("status", { name: "", exact: true }).filter({ hasText: "Application demandée localement" })).toBeVisible();
  expect(events).toEqual([
    { action: "include", ids: [VIS_ID] },
    { action: "apply-click", reviewedIds: [TUBE_ID, VIS_ID, COUDE_ID], markedIds: [TUBE_ID], excludedIds: [] },
  ]);
  expect(browserErrors).toEqual([]);
  expect(blockedUrls).toEqual([]);
});
