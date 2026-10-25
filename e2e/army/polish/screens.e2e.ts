import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { test } from "@e2e-dev/web";
import type { AxeResults } from "axe-core";
import { expect } from "e2e";

import { POLISH_VIEWPORTS, resolveRoutePath } from "../../polish/routes";
import { recordEvidence } from "../critical/fixtures";
import { relativeOutputPath } from "../local/sdk-results";
import { fixtureEvidence, installWriteGuard, polishState, routeFixtures, selectedRoutes, verifyFixtures, type RecordedWrite } from "./support";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const selected = selectedRoutes();
type ViewportResult = {
  viewport: string;
  status: number;
  finalPath: string;
  title: string;
  h1: string[];
  overflowPx: number;
  axeMajor: { id: string; impact: string; nodes: number; target: string }[];
  pageErrors: string[];
  writes: RecordedWrite[];
  screenshot: string;
};

for (const route of selected) {
  test(`POLISH ${route.id} preserves the four-viewport audit`, {
    ...(route.auth === "anon" ? {} : { session: "army" }),
    tags: ["critical", "polish"], trace: "off", timeout: 420_000,
  }, async ({ app, browser }) => {
    const army = polishState(route);
    const results: ViewportResult[] = [];
    let fixtures: ReturnType<typeof routeFixtures> = {};
    let guard: Awaited<ReturnType<typeof installWriteGuard>> | undefined;
    try {
      fixtures = routeFixtures(route);
      await verifyFixtures(fixtures, army);
      const pathname = resolveRoutePath(route, fixtures);
      if (!pathname) throw new Error("The selected polish route has unresolved fixture identities.");
      const origin = new URL(app.baseUrl!).origin;
      guard = await installWriteGuard(browser, origin);
      // Army installs page init scripts only after a page exists. Keep the
      // write guard active for this prerequisite navigation as well.
      await app.open(pathname);
      await browser.addInitScript(() => {
        const target = window as typeof window & { __armyPolishErrors: string[] };
        target.__armyPolishErrors = [];
        window.addEventListener("error", event => target.__armyPolishErrors.push(event.message.slice(0, 300)));
        window.addEventListener("unhandledrejection", event => target.__armyPolishErrors.push(String(event.reason).slice(0, 300)));
      });
      for (const viewport of POLISH_VIEWPORTS) {
        await browser.setViewport({ width: viewport.width, height: viewport.height });
        const absoluteUrl = new URL(pathname, origin).href;
        const responsePattern = new RegExp(`^${absoluteUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
        const [response] = await Promise.all([
          browser.waitForResponse(responsePattern, { timeout: 90_000 }),
          app.open(pathname),
        ]);
        await expect(browser.locator("main, body").first()).toBeVisible({ timeout: 60_000 });
        // The document response can settle before the streamed page heading.
        // Readiness must still require exactly one genuinely visible heading.
        await expect.poll(() => browser.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>('h1, [role="heading"][aria-level="1"]'))
            .filter(node => node.getClientRects().length > 0 && !["hidden", "collapse"].includes(getComputedStyle(node).visibility)).length
        ), { timeout: 60_000 }).toBe(1);
        await browser.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(document.getAnimations().filter(animation =>
            animation.effect?.getTiming().iterations !== Infinity
          ).map(animation => animation.finished.catch(() => undefined)));
          return true;
        });
        const state = await browser.evaluate(() => {
          const target = window as typeof window & { __armyPolishErrors?: string[] };
          return {
            title: document.title,
            h1: Array.from(document.querySelectorAll<HTMLElement>('h1, [role="heading"][aria-level="1"]'))
              .filter(node => node.getClientRects().length > 0 && !["hidden", "collapse"].includes(getComputedStyle(node).visibility))
              .map(node => node.innerText.replace(/\s+/g, " ").trim()),
            overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            pageErrors: target.__armyPolishErrors ?? [],
          };
        });
        await browser.evaluate(`(() => { ${axeSource}\n; return true; })()`);
        const axeMajor = await browser.evaluate(async exclusions => {
          const axe = (window as typeof window & { axe: { run: (context: { exclude: string[] }) => Promise<AxeResults> } }).axe;
          const audit = await axe.run({ exclude: ["nextjs-portal", ...exclusions] });
          return audit.violations.filter(rule => rule.impact === "critical" || rule.impact === "serious")
            .map(rule => ({ id: rule.id, impact: rule.impact ?? "unknown", nodes: rule.nodes.length, target: String(rule.nodes[0]?.target?.[0] ?? "") }));
        }, route.axeExclude ?? []);
        const screenshot = await relativeOutputPath(await app.screenshot(`polish-${route.id}-${viewport.name}`));
        const finalUrl = new URL(await browser.url());
        results.push({
          viewport: viewport.name, status: response.status,
          finalPath: route.id === "portal" ? "/portal/<portal-token>" : finalUrl.pathname + finalUrl.search,
          ...state, axeMajor, writes: guard.drain(), screenshot,
        });
        // Preserve every completed viewport before an assertion or a later navigation fails.
        await recordEvidence(army, "polish-results", {
          selectedRoutes: selected.map(item => item.id), route: { ...route, heading: String(route.heading) },
          fixtures: fixtureEvidence(fixtures), results,
          screenshotScope: "Every viewport; secure fields stay masked after a secret fill.",
        });
      }
      for (const result of results) {
        if (route.expectedStatus !== undefined) expect(result.status).toBe(route.expectedStatus);
        else expect(result.status).toBeLessThan(400);
        expect(result.h1).toHaveLength(1);
        if (typeof route.heading === "string") expect(result.h1[0]).toBe(route.heading);
        else if (route.heading) expect(result.h1[0]).toMatch(route.heading);
        expect(result.overflowPx).toBeLessThanOrEqual(1);
        expect(result.axeMajor).toEqual([]);
        expect(result.writes.filter(write => write.verdict === "blocked")).toEqual([]);
      }
      expect(results).toHaveLength(POLISH_VIEWPORTS.length);
    } finally {
      await recordEvidence(army, "polish-completed-viewports", {
        selectedRoutes: selected.map(item => item.id), routeId: route.id,
        fixtures: fixtureEvidence(fixtures), expectedViewports: POLISH_VIEWPORTS.map(viewport => viewport.name),
        completedViewports: results.map(result => result.viewport), results, pendingWrites: guard?.drain() ?? [],
      });
    }
  });
}
