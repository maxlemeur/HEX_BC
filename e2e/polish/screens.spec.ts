import fs from "node:fs";
import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import {
  POLISH_ROUTES,
  POLISH_VIEWPORTS,
  resolveRoutePath,
  routeFixtureKeys,
  type PolishFixtureKey,
  type PolishRoute,
} from "./routes";
import {
  AUTH_STATE_FILE,
  POLISH_ASSERT,
  POLISH_OUTPUT_DIR,
  POLISH_PHASE,
  installWriteGuard,
  writeJson,
  type RecordedWrite,
} from "./support";

type Fixtures = Partial<Record<PolishFixtureKey, string>>;

type ViewportResult = {
  viewport: string;
  status: number | null;
  finalUrl: string;
  title: string;
  h1: string[];
  overflowPx: number;
  axeMajor: { id: string; impact: string; nodes: number; target: string }[];
  pageErrors: string[];
  writes: RecordedWrite[];
  screenshot: string;
};

const RESULTS_DIR = path.join(POLISH_OUTPUT_DIR, "results");
const SHOTS_DIR = path.join(POLISH_OUTPUT_DIR, "shots");
const FIXTURES_FILE = path.join(POLISH_OUTPUT_DIR, "fixtures.json");
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

const ENV_FIXTURES: Record<PolishFixtureKey, string> = {
  projectId: "E2E_UX_PROJECT_ID",
  versionId: "E2E_UX_VERSION_ID",
  orderId: "E2E_UX_ORDER_ID",
  takeoffProjectId: "E2E_UX_TAKEOFF_PROJECT_ID",
  takeoffVersionId: "E2E_UX_TAKEOFF_VERSION_ID",
  takeoffJobId: "E2E_UX_TAKEOFF_JOB_ID",
  portalToken: "E2E_UX_PORTAL_TOKEN",
};

function selectedRoutes() {
  const only = process.env.POLISH_ONLY?.split(",").map((value) => value.trim()).filter(Boolean);
  if (!only?.length) return POLISH_ROUTES;
  return POLISH_ROUTES.filter(
    (route) => only.includes(route.id) || route.tags.some((tag) => only.includes(tag))
  );
}

async function collectHrefs(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator("main").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  return page.$$eval("a[href]", (anchors) => anchors.map((anchor) => anchor.getAttribute("href") ?? ""));
}

function firstMatch(hrefs: string[], pattern: RegExp) {
  for (const href of hrefs) {
    const match = pattern.exec(href);
    if (match) return match[1];
  }
  return undefined;
}

/**
 * Resolves the dynamic route ids read-only: env overrides first, then discovery through
 * list pages and GET APIs. The estimate fixture must not be a draft, because opening the
 * editor on a draft acquires a lock (a write on shared data).
 */
async function resolveFixtures(browser: Browser, baseURL: string): Promise<Fixtures> {
  // Reuse the ids of the reference run so before/after screenshots show the same records.
  const beforeFixtures = path.join(POLISH_OUTPUT_DIR, "..", "before", "fixtures.json");
  for (const candidate of [FIXTURES_FILE, beforeFixtures]) {
    if (fs.existsSync(candidate)) {
      const cached = JSON.parse(fs.readFileSync(candidate, "utf8")) as Fixtures;
      if (candidate !== FIXTURES_FILE) writeJson(FIXTURES_FILE, cached);
      return cached;
    }
  }

  const fixtures: Fixtures = {};
  for (const [key, envName] of Object.entries(ENV_FIXTURES) as [PolishFixtureKey, string][]) {
    const value = process.env[envName]?.trim();
    if (value) fixtures[key] = value;
  }

  const context = await browser.newContext({ storageState: AUTH_STATE_FILE, baseURL });
  await installWriteGuard(context, new URL(baseURL).origin);
  const page = await context.newPage();

  try {
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    if (new URL(page.url()).pathname.startsWith("/login")) {
      throw new Error(
        "Session Playwright expirée (e2e/.auth/playwright-user.json) : relancer le setup d'authentification avec E2E_LOGIN_EMAIL/E2E_LOGIN_PASSWORD exportés."
      );
    }
    if (!fixtures.projectId) {
      const hrefs = await collectHrefs(page, "/dashboard/affaires?status=accepted");
      fixtures.projectId = firstMatch(hrefs, new RegExp(`^/dashboard/affaires/(${UUID})$`));
    }
    if (!fixtures.versionId && fixtures.projectId) {
      const hrefs = await collectHrefs(page, `/dashboard/affaires/${fixtures.projectId}`);
      fixtures.versionId = firstMatch(hrefs, new RegExp(`^/dashboard/estimates/(${UUID})/`));
    }
    if (fixtures.versionId) {
      const response = await page.request.get(`/api/estimates/${fixtures.versionId}`);
      const body = (await response.json().catch(() => null)) as
        | { data?: { version?: { status?: string } } }
        | null;
      if (body?.data?.version?.status === "draft") {
        throw new Error("Le devis de référence est un brouillon : l'ouvrir dans l'éditeur poserait un verrou.");
      }
    }
    if (!fixtures.orderId) {
      const hrefs = await collectHrefs(page, "/dashboard/orders");
      fixtures.orderId = firstMatch(hrefs, new RegExp(`^/dashboard/orders/(${UUID})$`));
    }
    if (!fixtures.takeoffJobId) {
      const response = await page.request.get("/api/takeoff/jobs?status=completed&limit=20");
      const body = (await response.json().catch(() => null)) as
        | { data?: { jobs?: { id: string; estimate_version_id: string; items_count?: number }[] } }
        | null;
      const jobs = [...(body?.data?.jobs ?? [])].sort(
        (left, right) => (right.items_count ?? 0) - (left.items_count ?? 0)
      );
      if (jobs[0]) {
        fixtures.takeoffJobId = jobs[0].id;
        fixtures.takeoffVersionId = jobs[0].estimate_version_id;
      }
    }
    if (!fixtures.takeoffProjectId && fixtures.takeoffVersionId) {
      const response = await page.request.get(`/api/estimates/${fixtures.takeoffVersionId}`);
      const body = (await response.json().catch(() => null)) as
        | { data?: { version?: { project_id?: string } } }
        | null;
      fixtures.takeoffProjectId = body?.data?.version?.project_id;
    }
  } finally {
    await context.close();
  }

  writeJson(FIXTURES_FILE, fixtures);
  return fixtures;
}

async function settle(page: Page) {
  await page.locator("main, body").first().waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // Staggered card entrances finish under one second; axe and screenshots need settled colors.
  await page.waitForTimeout(1_000);
}

async function auditRoute(page: Page, route: PolishRoute, url: string, drainWrites: () => RecordedWrite[]) {
  const results: ViewportResult[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 300)));

  for (const viewport of POLISH_VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await settle(page);

    const h1 = (
      await page
        .locator('h1, [role="heading"][aria-level="1"]')
        .filter({ visible: true })
        .allInnerTexts()
    ).map((text) => text.replace(/\s+/g, " ").trim());

    const overflowPx = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );

    let axe = new AxeBuilder({ page }).exclude("nextjs-portal");
    for (const selector of route.axeExclude ?? []) axe = axe.exclude(selector);
    const axeResults = await axe.analyze();
    const axeMajor = axeResults.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? "unknown",
        nodes: violation.nodes.length,
        target: String(violation.nodes[0]?.target?.[0] ?? ""),
      }));

    const screenshot = path.join(SHOTS_DIR, route.id, `${viewport.name}.png`);
    fs.mkdirSync(path.dirname(screenshot), { recursive: true });
    await page.screenshot({
      path: screenshot,
      fullPage: true,
      animations: "disabled",
      caret: "hide",
      // The Next dev indicator ("Compiling…") is not part of the app and breaks pixel diffs.
      style: "nextjs-portal { display: none !important; }",
    });

    results.push({
      viewport: viewport.name,
      status: response?.status() ?? null,
      finalUrl: new URL(page.url()).pathname + new URL(page.url()).search,
      title: await page.title(),
      h1,
      overflowPx,
      axeMajor,
      pageErrors: pageErrors.splice(0, pageErrors.length),
      writes: drainWrites(),
      screenshot: path.relative(POLISH_OUTPUT_DIR, screenshot).replaceAll("\\", "/"),
    });
  }

  return results;
}

function assertResults(route: PolishRoute, results: ViewportResult[]) {
  for (const result of results) {
    const label = `${route.id} @${result.viewport}`;
    if (route.expectedStatus !== undefined) {
      expect.soft(result.status, `${label} statut HTTP`).toBe(route.expectedStatus);
    } else {
      expect.soft(result.status, `${label} statut HTTP`).toBeLessThan(400);
    }
    expect.soft(result.h1.length, `${label} doit avoir exactement un h1 visible`).toBe(1);
    if (route.heading !== null) {
      const expected = route.heading;
      expect
        .soft(
          typeof expected === "string" ? result.h1[0] === expected : expected.test(result.h1[0] ?? ""),
          `${label} h1 « ${result.h1[0] ?? "∅"} » attendu « ${String(expected)} »`
        )
        .toBe(true);
    }
    expect.soft(result.overflowPx, `${label} débordement horizontal`).toBeLessThanOrEqual(1);
    expect
      .soft(result.axeMajor, `${label} violations axe serious/critical`)
      .toEqual([]);
    expect
      .soft(
        result.writes.filter((write) => write.verdict === "blocked"),
        `${label} écritures bloquées`
      )
      .toEqual([]);
  }
}

let fixtures: Fixtures = {};

test.beforeAll(async ({ browser }, testInfo) => {
  if (selectedRoutes().every((route) => route.auth === "anon")) return;
  const baseURL = String(testInfo.project.use.baseURL ?? "http://localhost:3000");
  fixtures = await resolveFixtures(browser, baseURL);
});

for (const route of selectedRoutes()) {
  test.describe(route.id, () => {
    if (route.auth === "anon") {
      test.use({ storageState: { cookies: [], origins: [] } });
    }

    test(`${route.id} — ${route.path}`, async ({ page, context, baseURL }) => {
      test.setTimeout(420_000);
      const url = resolveRoutePath(route, fixtures);
      const resultFile = path.join(RESULTS_DIR, `${route.id}.json`);

      if (!url) {
        const missing = routeFixtureKeys(route).filter((key) => !fixtures[key]);
        writeJson(resultFile, { route, url: null, missingFixtures: missing, results: [] });
        test.info().annotations.push({
          type: "missing-proof",
          description: `Fixture absente : ${missing.join(", ")}`,
        });
        test.skip(true, `Fixture absente : ${missing.join(", ")}`);
        return;
      }

      const guard = await installWriteGuard(context, new URL(String(baseURL)).origin);
      const results = await auditRoute(page, route, url, () => guard.drain());
      writeJson(resultFile, { route: { ...route, heading: String(route.heading) }, url, results });

      if (POLISH_ASSERT) assertResults(route, results);
    });
  });
}

test.describe("rapport", () => {
  test("agrège les résultats", async () => {
    const files = fs.existsSync(RESULTS_DIR)
      ? fs.readdirSync(RESULTS_DIR).filter((file) => file.endsWith(".json"))
      : [];
    const routes = files.map((file) =>
      JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, file), "utf8"))
    ) as { route: PolishRoute; url: string | null; missingFixtures?: string[]; results: ViewportResult[] }[];

    const rows = routes
      .sort((left, right) => left.route.id.localeCompare(right.route.id))
      .map((entry) => {
        if (!entry.url) return `| ${entry.route.id} | — | fixture absente (${entry.missingFixtures?.join(", ")}) | | | |`;
        const statuses = [...new Set(entry.results.map((result) => result.status))].join("/");
        const h1 = [...new Set(entry.results.map((result) => result.h1.join(" ‖ ") || "∅"))].join(" / ");
        const overflow = entry.results.filter((result) => result.overflowPx > 1).map((result) => result.viewport);
        const axe = [...new Set(entry.results.flatMap((result) => result.axeMajor.map((violation) => violation.id)))];
        const blocked = entry.results.flatMap((result) => result.writes.filter((write) => write.verdict === "blocked"));
        return `| ${entry.route.id} | ${statuses} | ${h1} | ${overflow.join(", ") || "—"} | ${axe.join(", ") || "—"} | ${blocked.length ? blocked.map((write) => `${write.method} ${new URL(write.url).pathname}`).join("; ") : "—"} |`;
      });

    const report = [
      `# Audit polish — phase ${POLISH_PHASE}`,
      "",
      `Voir \`manifest.json\` pour la commande, la révision et l'environnement.`,
      "",
      "| Route | HTTP | h1 visibles | Débordement | Axe serious/critical | Écritures bloquées |",
      "|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    fs.writeFileSync(path.join(POLISH_OUTPUT_DIR, "report.md"), report, "utf8");
    expect(routes.length).toBeGreaterThan(0);
  });
});
