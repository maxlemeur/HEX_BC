import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// Observable gap in the direct-load benchmark: a fast LCP does not measure clicking
// between routes. Record actual click -> URL -> visible destination and its requests.
test(
  "client navigation: global menu and catalogue",
  { tags: ["navigation-performance"], session: "army", requires: ["browser"], timeout: 300_000 },
  async ({ app, browser, screen }) => {
    await app.open("/dashboard/affaires");
    await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
    const steps = [
      { route: "/dashboard/orders", heading: "Bons de commande", global: true },
      { route: "/dashboard/referentiel", heading: "Référentiel", global: true, group: "Outils" },
      { route: "/dashboard/products", heading: "Produits & prix de référence", global: false },
      { route: "/dashboard/affaires", heading: "Affaires", global: true },
    ];
    const results = [];
    for (let repeat = 0; repeat < 2; repeat += 1) {
      for (const step of steps) {
        if (step.group) await screen.getByRole("menuitem", step.group, { exact: true }).tap();
        const from = new URL(await browser.url()).pathname;
        await browser.evaluate(({ destination, heading }) => {
          type Probe = { start: number | null; urlAt: number | null; headingAt: number | null; loadingAt: number | null };
          const state: Probe = { start: null, urlAt: null, headingAt: null, loadingAt: null };
          const view = window as Window & { __armyNavigation?: Probe; __armyNavigationObserver?: MutationObserver };
          view.__armyNavigationObserver?.disconnect();
          view.__armyNavigation = state;
          const observer = new MutationObserver(() => {
            if (state.start === null) return;
            const now = performance.now();
            if (location.pathname === destination) state.urlAt ??= now;
            if (state.loadingAt === null && Array.from(document.querySelectorAll('[role="status"]')).some((node) =>
              node.getClientRects().length && /Chargement/.test(node.textContent ?? "")
            )) state.loadingAt = now;
            if (location.pathname === destination && Array.from(document.querySelectorAll("h1,h2")).some((node) =>
              node.getClientRects().length && node.textContent?.trim() === heading
            )) {
              requestAnimationFrame(() => requestAnimationFrame(() => {
                state.headingAt ??= performance.now();
              }));
            }
          });
          observer.observe(document.body, { subtree: true, childList: true, attributes: true });
          view.__armyNavigationObserver = observer;
          const capture = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target.closest("a[href]") as HTMLAnchorElement | null : null;
            if (target && new URL(target.href).pathname === destination) {
              state.start = performance.now();
              document.removeEventListener("click", capture, true);
            }
          };
          document.addEventListener("click", capture, true);
          return null;
        }, { destination: step.route, heading: step.heading });
        const selector = step.global
          ? `nav[aria-label="Navigation globale"] a[href="${step.route}"]`
          : `main a[href="${step.route}"]`;
        await browser.locator(selector).first().tap();
        await expect(browser).toHaveURL(step.route, { timeout: 90_000 });
        await expect.poll(() => browser.evaluate(() => {
          const view = window as Window & { __armyNavigation?: { headingAt: number | null } };
          return Boolean(view.__armyNavigation?.headingAt);
        }), { timeout: 90_000 }).toBe(true);
        if (step.route === "/dashboard/orders") {
          await expect(screen.getByRole("button", "Actualiser", { exact: true })).toBeVisible({ timeout: 90_000 });
          await expect(browser.locator('main [data-slot="alert"][role="alert"]')).not.toBeVisible();
          await expect.poll(() => browser.evaluate(() => {
            const main = document.querySelector("main");
            return Boolean(main?.querySelector("tbody tr")) || /Aucun bon de commande/.test(main?.textContent ?? "");
          }), { timeout: 90_000 }).toBe(true);
        } else if (step.route === "/dashboard/products") {
          await expect.poll(() => browser.evaluate(() => /\d[\d\s]* produits actifs/.test(
            document.querySelector("main")?.textContent ?? ""
          )), { timeout: 90_000 }).toBe(true);
        }
        await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
        const measurement = await browser.evaluate(() => {
          const view = window as Window & { __armyNavigation?: { start: number | null; urlAt: number | null; headingAt: number | null; loadingAt: number | null } };
          const probe = view.__armyNavigation;
          if (!probe || probe.start === null || probe.headingAt === null) throw new Error("Navigation probe is incomplete.");
          const start = probe.start;
          return {
            clickToUrlMs: probe.urlAt === null ? null : probe.urlAt - start,
            clickToHeadingMs: probe.headingAt - start,
            // Includes runner polling/transport: an upper bound, not a paint timestamp.
            clickToContentCheckedMs: performance.now() - start,
            clickToLoadingMs: probe.loadingAt === null ? null : probe.loadingAt - start,
            resources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
              .filter((entry) => entry.startTime >= start - 1)
              .map((entry) => ({ path: new URL(entry.name).pathname, kind: entry.initiatorType,
                startAfterClickMs: entry.startTime - start, durationMs: entry.duration,
                responseWaitMs: entry.responseStart ? entry.responseStart - entry.startTime : null }))
              .sort((a, b) => b.durationMs - a.durationMs).slice(0, 12),
          };
        });
        results.push({ repeat, from, to: step.route, ...measurement });
      }
    }
    const directory = ".e2e/army/performance/artifacts/metrics";
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "navigation-metrics.json"), JSON.stringify({
      recordedAt: new Date().toISOString(),
      environment: process.env.E2E_ARMY_SERVER_MODE === "live" ? "existing local development server" : "owned local production server", results,
      scope: "list/hub client clicks; no business form submissions, edits or autosave; affaire detail/editor excluded because detail GET can write approval projections; no credential/header/body capture",
      measurementLimits: "URL timing is first DOM observation after its change, an upper bound. Heading timing includes two animation frames. Content-check timing is an upper bound including runner overhead. Resource timings include only completed requests started after the click; first-byte wait includes browser/connection overhead and omits later streaming server work. Existing app telemetry and localStorage may run.",
    }, null, 2) + "\n");
  }
);
