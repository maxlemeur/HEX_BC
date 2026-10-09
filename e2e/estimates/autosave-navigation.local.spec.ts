import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

// Observable failures: click discarded instead of resumed, leaving before a slow
// save, and loss of input on failure. This browser fixture uses the real guard;
// its local save server keeps all writes outside the shared Supabase environment.
let server: Server;
let baseUrl: string;
let savedValue = "";

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [resolve("e2e/fixtures/autosave-navigation.tsx")],
    tsconfig: resolve("tsconfig.json"),
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  server = createServer(async (request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/fixture-save") {
      let body = "";
      for await (const chunk of request) body += chunk;
      savedValue = (JSON.parse(body) as { value: string }).value;
      response.end("{}");
    } else if (request.url === "/destination") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(`<main><h1>Destination</h1><p>Désignation enregistrée : ${savedValue}</p></main>`);
    } else {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<div id="root"></div><script src="/fixture.js"></script>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local fixture did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async ({ page }, testInfo) => {
  savedValue = "";
  await testInfo.attach("provenance", {
    body: JSON.stringify({
      command: "npx playwright test --config=e2e/demo-eight.local.config.ts",
      revision: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      localChanges: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "status", "--short"], { encoding: "utf8" }),
      environment: "Loopback-only browser fixture; real navigation guard; no Supabase writes",
      fixture: "e2e/fixtures/autosave-navigation.tsx", expected: testInfo.title,
    }), contentType: "application/json",
  });
  await page.goto(baseUrl);
});

test("one click saves the edit and reaches the requested page", async ({ page }) => {
  await page.getByLabel("Désignation").fill("Tube cuivre 18 mm");
  await page.getByRole("link", { name: "Quitter le chiffrage" }).click();
  await expect(page.getByRole("heading", { name: "Destination" })).toBeVisible();
  await expect(page.getByText("Désignation enregistrée : Tube cuivre 18 mm")).toBeVisible();
});

test("slow save keeps the page open and resumes without another click", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/fixture-save", async (route) => { await pending; await route.continue(); });
  await page.getByLabel("Désignation").fill("Vanne 15/21");
  await page.getByRole("link", { name: "Quitter le chiffrage" }).click();
  await expect(page.getByRole("status")).toHaveText("Sauvegarde en cours");
  await expect(page.getByLabel("Désignation")).toHaveValue("Vanne 15/21");
  release();
  await expect(page.getByRole("heading", { name: "Destination" })).toBeVisible();
  await expect(page.getByText("Désignation enregistrée : Vanne 15/21")).toBeVisible();
});

test("failed save preserves the edit and retry resumes navigation", async ({ page }) => {
  await page.route("**/fixture-save", (route) => route.fulfill({ status: 503, body: "{}" }));
  await page.getByLabel("Désignation").fill("Flexible sanitaire");
  await page.getByRole("link", { name: "Quitter le chiffrage" }).click();
  await expect(page.getByRole("alert")).toContainText("saisie conservée");
  await expect(page.getByLabel("Désignation")).toHaveValue("Flexible sanitaire");
  await page.unroute("**/fixture-save");
  await page.getByRole("link", { name: "Quitter le chiffrage" }).click();
  await expect(page.getByText("Désignation enregistrée : Flexible sanitaire")).toBeVisible();
});

test("browser Back saves before resuming the original history without adding entries", async ({ page }) => {
  await page.getByRole("button", { name: "Ouvrir le chiffrage suivant" }).click();
  await expect(page).toHaveURL(/visit=1/);
  await page.getByLabel("Désignation").fill("Retour conservé");
  const historyLength = await page.evaluate(() => history.length);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/fixture-save", async (route) => { await pending; await route.continue(); });
  await page.evaluate(() => history.back());
  await expect(page.getByRole("status")).toHaveText("Sauvegarde en cours");
  await expect(page).toHaveURL(/visit=1/);
  release();
  await expect(page).toHaveURL(baseUrl + "/");
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(savedValue).toBe("Retour conservé");
  await page.getByLabel("Désignation").fill("Avance conservée");
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/visit=1/);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  expect(savedValue).toBe("Avance conservée");
});
