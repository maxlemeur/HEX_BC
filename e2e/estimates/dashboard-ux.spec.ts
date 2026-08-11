import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const AUDITED_ROUTES = [
  { path: "/dashboard", heading: "Vue d’ensemble" },
  { path: "/dashboard/affaires", heading: "Affaires" },
  { path: "/dashboard/takeoff", heading: "Métrés — Analyse de plans" },
  { path: "/dashboard/admin/flags", heading: "Fonctionnalités" },
  {
    path: "/dashboard/admin/anomaly-history",
    heading: "Historique des anomalies",
  },
  { path: "/dashboard/products", heading: "Produits & prix de référence" },
  { path: "/dashboard/prices", heading: "Prix fournisseurs" },
] as const;

const VIEWPORTS = [
  { name: "small-mobile", width: 320, height: 568 },
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function waitForDashboard(
  page: Page,
  expectedRoute: (typeof AUDITED_ROUTES)[number]
) {
  await expect(page).toHaveURL((url) => url.pathname === expectedRoute.path);
  await expect(page.locator("main")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: expectedRoute.heading,
      exact: true,
    })
  ).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // The longest staggered card entrance completes in under one second.
  // Axe must inspect the settled colors rather than opacity-blended transition frames.
  await page.waitForTimeout(1_000);
}

for (const viewport of VIEWPORTS) {
  test.describe(`dashboard UX - ${viewport.name}`, () => {
    test.use({ viewport });

    for (const route of AUDITED_ROUTES) {
      test(`${route.path} reste lisible et sans violation majeure`, async ({ page }) => {
        await page.goto(route.path, { waitUntil: "domcontentloaded" });
        await waitForDashboard(page, route);

        const overflow = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }));
        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

        const results = await new AxeBuilder({ page }).analyze();
        const majorViolations = results.violations.filter(
          (violation) =>
            violation.impact === "critical" || violation.impact === "serious"
        );

        expect(
          majorViolations,
          majorViolations
            .map(
              (violation) =>
                `${violation.id}: ${violation.help} (${violation.nodes.length})`
            )
            .join("\n")
        ).toEqual([]);
      });
    }
  });
}

test("le tiroir mobile conserve le focus et neutralise le contenu", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForDashboard(page, AUDITED_ROUTES[0]);

  const openButton = page.getByRole("button", { name: "Ouvrir le menu" });
  await openButton.click();

  const drawer = page.locator("#dashboard-sidebar");
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("main")).toHaveAttribute("inert", "");

  await page.keyboard.press("Escape");
  await expect(openButton).toBeFocused();
});
