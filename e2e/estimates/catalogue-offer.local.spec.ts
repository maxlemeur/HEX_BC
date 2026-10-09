import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

// Real form and context in a loopback-only browser. The local server captures
// one targeted write; SQL fixtures separately verify its PostgreSQL execution.
let server: Server;
let baseUrl: string;
let writes: Array<{ action: string; id: string; item: Record<string, unknown> }>;

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: process.cwd(), entryPoints: [resolve("e2e/fixtures/catalogue-offer.tsx")],
    tsconfig: resolve("tsconfig.json"), bundle: true, write: false, format: "iife",
    platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' },
  });
  server = createServer(async (request, response) => {
    if (request.url === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (request.url === "/api/prices" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      writes.push(payload);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, data: { item: { id: payload.id, ...payload.item } } }));
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
  writes = [];
  await testInfo.attach("provenance", {
    body: JSON.stringify({
      command: "npx playwright test --config=e2e/catalogue-offer.local.config.ts",
      revision: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      localChanges: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "status", "--short"], { encoding: "utf8" }),
      environment: "Loopback-only browser, real form/context; no shared Supabase writes",
      fixture: "e2e/fixtures/catalogue-offer.tsx", expected: testInfo.title,
    }), contentType: "application/json",
  });
  await page.goto(baseUrl);
});

test("TI-579 un administrateur modifie prix, référence et transport dans une seule offre", async ({ page }, testInfo) => {
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Transport", { exact: true })).toHaveValue("included");
  await dialog.getByLabel("Transport", { exact: true }).selectOption("excluded");
  await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("AL-019");
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("11,50");
  await dialog.getByRole("button", { name: "Enregistrer l’offre", exact: true }).click();
  await expect(page.getByRole("status", { name: "", exact: true }).filter({ hasText: "Offre enregistrée" })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({
    action: "update-offer", id: "44444444-4444-4444-8444-444444444444",
    item: { supplier_sku: "AL-019", unit_price_cents: 1150, transport_mode: "excluded" },
  });
  await testInfo.attach("actual-write", { body: JSON.stringify(writes), contentType: "application/json" });
});

test("TI-579 un ingénieur conserve le transport en modifiant le prix", async ({ page }, testInfo) => {
  await page.goto(`${baseUrl}?role=engineer`);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Transport", { exact: true })).toHaveValue("included");
  await expect(dialog.getByLabel("Transport", { exact: true })).toBeDisabled();
  await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill("12,50");
  await dialog.getByRole("button", { name: "Enregistrer l’offre", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes[0].item.unit_price_cents).toBe(1250);
  expect(writes[0].item).not.toHaveProperty("transport_mode");
  await testInfo.attach("actual-write", { body: JSON.stringify(writes), contentType: "application/json" });
});
