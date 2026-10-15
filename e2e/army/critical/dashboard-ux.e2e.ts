import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { AxeResults } from "axe-core";
import { expect } from "e2e";

import { armyTest, recordEvidence } from "./fixtures";

const axeSource = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const routes = [
  { path: "/dashboard", heading: "Vue d’ensemble" },
  { path: "/dashboard/affaires", heading: "Affaires" },
  { path: "/dashboard/takeoff", heading: "Métrés — Analyse de plans" },
  { path: "/dashboard/admin/flags", heading: "Fonctionnalités" },
  { path: "/dashboard/admin/anomaly-history", heading: "Historique des anomalies" },
  { path: "/dashboard/products", heading: "Produits & prix de référence" },
  { path: "/dashboard/prices", heading: "Prix fournisseurs" },
] as const;
const viewports = [
  { name: "small-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const options = { session: "army", trace: "off" as const, tags: ["critical", "dashboard-ux"], timeout: 120_000 };

for (const [viewportIndex, viewport] of viewports.entries()) {
  for (const [routeIndex, route] of routes.entries()) {
    const caseId = `UX${String(viewportIndex * routes.length + routeIndex + 1).padStart(2, "0")}`;
    armyTest(`${caseId} ${route.path} ${viewport.name} has no major Axe violation or overflow`, options, async ({ app, browser, screen, army }) => {
      await browser.setViewport({ width: viewport.width, height: viewport.height });
      await app.open(route.path);
      await expect(browser).toHaveURL(route.path);
      await expect(screen.getByRole("main")).toBeVisible();
      await expect(screen.getByRole("heading", route.heading, { level: 1, exact: true })).toBeVisible();
      await expect.poll(() => browser.evaluate(() => document.readyState)).toBe("complete");
      // Await actual entrance animations, preserving their final colors and every Axe rule.
      await browser.evaluate(async () => {
        await Promise.all(document.getAnimations().filter((animation) =>
          animation.effect?.getTiming().iterations !== Infinity
        ).map((animation) => animation.finished.catch(() => undefined)));
        return true;
      });
      const dimensions = await browser.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      }));
      await browser.evaluate(`(() => { ${axeSource}\n; return true; })()`);
      const audit = await browser.evaluate(async () => {
        const axe = (window as typeof window & { axe: { run: (context: Document) => Promise<AxeResults> } }).axe;
        const result = await axe.run(document);
        return {
          version: result.testEngine.version,
          passes: result.passes.length,
          incomplete: result.incomplete.map((rule) => ({ id: rule.id, nodes: rule.nodes.length })),
          violations: result.violations.map((rule) => ({
            id: rule.id, impact: rule.impact ?? null, help: rule.help,
            nodes: rule.nodes.map((node) => ({ target: node.target, impact: node.impact ?? null })),
          })),
        };
      });
      await recordEvidence(army, `${caseId}-dashboard-audit`, { route, viewport, dimensions, audit });
      expect(dimensions.viewportWidth).toBe(viewport.width);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
      expect(audit.violations.filter((rule) => rule.impact === "critical" || rule.impact === "serious")).toEqual([]);
    });
  }
}

armyTest("UX29 mobile drawer traps the page and restores keyboard focus", options, async ({ app, browser, screen, army }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/dashboard");
  await expect(screen.getByRole("heading", routes[0].heading, { level: 1, exact: true })).toBeVisible();
  const opener = screen.getByRole("button", "Ouvrir le menu principal", { exact: true });
  await opener.click();
  const drawer = browser.locator("#dashboard-sidebar");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(browser.locator("main")).toHaveAttribute("inert", "");
  await recordEvidence(army, "UX29-open", { modal: await drawer.getAttribute("aria-modal"), mainInert: await browser.locator("main").getAttribute("inert") });
  await browser.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await recordEvidence(army, "UX29-closed", { focusRestored: true });
});
