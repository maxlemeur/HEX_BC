import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const items = [
  {
    project_id: "11111111-1111-4111-8111-111111111111",
    project_name: "Atelier Alpha",
    project_reference: "DESLOP-ALPHA",
    project_client_name: "Client Canonique Alpha",
    version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version_number: 2,
    status: "draft",
    title: "Offre Alpha",
    updated_at: "2026-10-02T09:00:00.000Z",
    total_ht_cents: 120000,
    date_devis: "2026-10-02",
    currency: " usd ",
    validite_jours: 30,
  },
  {
    project_id: "22222222-2222-4222-8222-222222222222",
    project_name: "Atelier Beta",
    project_reference: "DESLOP-BETA",
    project_client_name: "Client Canonique Beta",
    version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-10-01T09:00:00.000Z",
    total_ht_cents: 32000,
    date_devis: null,
    currency: " gbp ",
    validite_jours: null,
  },
  {
    project_id: "33333333-3333-4333-8333-333333333333",
    project_name: "Atelier Gamma",
    project_reference: null,
    project_client_name: null,
    version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-09-30T09:00:00.000Z",
    total_ht_cents: 64000,
    date_devis: null,
    currency: "INVALID",
    validite_jours: null,
  },
  {
    project_id: "44444444-4444-4444-8444-444444444444",
    project_name: "Atelier Delta",
    project_reference: null,
    project_client_name: null,
    version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-09-29T09:00:00.000Z",
    total_ht_cents: 25000,
    date_devis: null,
    validite_jours: null,
  },
];
const canonicalResponse = { ok: true, data: { items } };
let server: Server;
let baseUrl: string;
let apiRequests: string[];
let pageErrors: string[];

test.beforeAll(async () => {
  const bundle = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [resolve("e2e/fixtures/deslop-client-list.tsx")],
    tsconfig: resolve("tsconfig.json"),
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env": "{}",
      "process.env.NODE_ENV": '"development"',
    },
  });
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/fixture.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(bundle.outputFiles[0].text);
    } else if (pathname === "/api/estimates" && request.method === "GET") {
      apiRequests.push(`${request.method} ${pathname}`);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(canonicalResponse));
    } else if (pathname === "/dashboard/estimates") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html lang="fr"><head><style>body{font-family:Arial,sans-serif}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left}.md\\:hidden{display:none}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
    } else {
      if (pathname.startsWith("/api/")) apiRequests.push(`${request.method} ${pathname}`);
      response.writeHead(404);
      response.end("Unexpected local fixture request");
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local fixture did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
});

test.beforeEach(async ({ page, browser }, testInfo) => {
  apiRequests = [];
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const phase = process.env.DESLOP_E2E_PHASE === "before" ? "before" : "after";
  const git = (args: string[]) => execFileSync("git", [
    "-c", `safe.directory=${process.cwd()}`, ...args,
  ], { encoding: "utf8" }).trim();
  await testInfo.attach("provenance", {
    body: JSON.stringify({
      command: `$env:DESLOP_E2E_PHASE='${phase}'; npx playwright test --config=e2e/deslop.local.config.ts`,
      revision: git(["rev-parse", "HEAD"]),
      localChanges: git(["status", "--short"]),
      targetedDiff: git(["diff", "--", "src/lib/estimates/client.ts"]),
      environment: "Loopback Chromium; real production EstimatesPage, client and filtering; Next navigation context supplied; no Supabase, SSR or deployed route",
      node: process.version,
      browser: browser.version(),
      baseUrl,
      fixture: "e2e/fixtures/deslop-client-list.tsx",
      fixtureIdentities: items.map((item) => ({ projectId: item.project_id, versionId: item.version_id })),
      expected: testInfo.title,
    }),
    contentType: "application/json",
  });
  await testInfo.attach("canonical-response", {
    body: JSON.stringify(canonicalResponse),
    contentType: "application/json",
  });
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).origin === baseUrl) await route.continue();
    else await route.abort("blockedbyclient");
  });
  await page.goto(`${baseUrl}/dashboard/estimates`);
  await expect(page.locator("tbody tr")).toHaveCount(4);
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("observed-result", {
    body: JSON.stringify({
      status: testInfo.status,
      url: page.url(),
      table: await page.locator("table").innerText().catch(() => "Table unavailable"),
      apiRequests,
      pageErrors,
      errors: testInfo.errors.map((error) => error.message),
    }),
    contentType: "application/json",
  });
  expect(pageErrors).toEqual([]);
});

test("canonical client name is displayed and the real search keeps only its estimate", async ({ page }) => {
  const table = page.getByRole("table");
  await expect(table.getByRole("cell", { name: "Client Canonique Alpha", exact: true })).toBeVisible();
  await expect(table.getByRole("cell", { name: "Client Canonique Beta", exact: true })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Rechercher par projet ou client..." });
  await search.fill("Canonique Alpha");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(table.getByRole("link", { name: "Atelier Alpha", exact: true })).toBeVisible();
  await expect(table.getByRole("link", { name: "Atelier Beta", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Effacer la recherche", exact: true }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  expect(apiRequests).toContain("GET /api/estimates");
  expect(apiRequests.every((request) => request === "GET /api/estimates")).toBe(true);
});

test("supported currencies normalize and invalid or absent currency falls back to EUR", async ({ page }) => {
  const rows = page.locator("tbody tr");
  await expect(rows.filter({ hasText: "Atelier Alpha" }).getByRole("cell", { name: "USD", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Atelier Beta" }).getByRole("cell", { name: "GBP", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Atelier Gamma" }).getByRole("cell", { name: "EUR", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Atelier Delta" }).getByRole("cell", { name: "EUR", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Atelier Alpha" })).toContainText("$1,200.00");
  await expect(rows.filter({ hasText: "Atelier Beta" })).toContainText("£320.00");
  await expect(rows.filter({ hasText: "Atelier Gamma" })).toContainText("640,00");
  await expect(rows.filter({ hasText: "Atelier Gamma" }).getByRole("cell", { name: "—", exact: true })).toBeVisible();
  await expect(rows.filter({ hasText: "Atelier Delta" }).getByRole("cell", { name: "—", exact: true })).toBeVisible();
});
