import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

type ProductResponse = {
  ok: true;
  data: {
    items: Array<{ id: string; designation: string }>;
    pagination: { page: number; size: number; totalItems: number };
  };
};

function responsePattern(term: string) {
  const token = new URLSearchParams({ q: term }).toString()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("/api/catalogue\\?[^#]*" + token + "(?:&|$)");
}

// Failures defined before optimization: product filters may incur an avoidable
// RSC trip before their API read, lose exact results or break history; large
// order lists may keep animating seconds after load. The paginated orders
// contract mounts 50 rows from the same read-only 120-order fixture. Real catalogue reads are
// preserved. Only the order directory response is synthetic; no writes occur.
test(
  "dogfood directories: real product filters and 120 read-only orders",
  { tags: ["performance", "directory-performance"], session: "army", requires: ["browser"], timeout: 300_000 },
  async ({ app, browser, screen }) => {
    await app.open("/dashboard/affaires");
    await browser.setViewport({ width: 1440, height: 900 });
    const origin = new URL(app.baseUrl!).origin;
    const blockedMutations: Array<{ path: string; method: string }> = [];
    const productSamples: Array<{ rscRequests: number } & Record<string, unknown>> = [];
    let historyResult: unknown = null;
    let ordersResult: unknown = null;
    let animatedOrderRows: number | null = null;
    const supplier = { id: "00000000-0000-4000-8000-000000000901", name: "ARMY performance supplier" };
    const site = { id: "00000000-0000-4000-8000-000000000902", name: "ARMY performance site" };
    const orders = Array.from({ length: 120 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      reference: `ARMY PERF ${String(index + 1).padStart(3, "0")}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 120 - index)).toISOString(),
      status: "draft",
      expected_delivery_date: null,
      total_ht_cents: 12345 + index,
      total_tax_cents: 2469,
      total_ttc_cents: 14814 + index,
      edit_revision: 1,
      suppliers: supplier,
      delivery_sites: site,
      devis_count: 0,
      has_devis: "without",
    }));
    await browser.addInitScript(() => {
      const view = window as Window & { __armyOrdersMount?: {
        mountedAt: number; count: number; maxAnimationDelayMs: number;
        animatedRows: number; lastOpacity: number; lastAnimationName: string;
      } };
      const observer = new MutationObserver(() => {
        if (view.__armyOrdersMount) return;
        const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>(
          '[aria-label="Tableau des bons de commande"] tbody > tr'
        ));
        if (rows.length !== 50) return;
        const styles = rows.map((row) => getComputedStyle(row));
        view.__armyOrdersMount = {
          mountedAt: performance.now(), count: rows.length,
          maxAnimationDelayMs: Math.max(...styles.map((style) =>
            Math.max(...style.animationDelay.split(",").map((delay) =>
              Number.parseFloat(delay) * (delay.trim().endsWith("ms") ? 1 : 1000)
            ))
          )),
          animatedRows: styles.filter((style) => style.animationName !== "none").length,
          lastOpacity: Number(styles[styles.length - 1].opacity),
          lastAnimationName: styles[styles.length - 1].animationName,
        };
        observer.disconnect();
      });
      observer.observe(document, { subtree: true, childList: true });
    });
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url);
      if (url.origin === origin && !["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
        blockedMutations.push({ path: url.pathname, method: route.request.method });
        await route.abort();
        return;
      }
      if (url.origin === origin && url.pathname === "/api/orders" && route.request.method === "GET") {
        const view = url.searchParams.get("view");
        if (view === "lookups") {
          await route.fulfill({ status: 200, json: { ok: true, data: { suppliers: [supplier], delivery_sites: [site], totalOrders: orders.length } } });
        } else if (view === "page") {
          const page = Number(url.searchParams.get("page") ?? "1");
          const size = Number(url.searchParams.get("size") ?? "50");
          await route.fulfill({ status: 200, json: { ok: true, data: {
            items: orders.slice((page - 1) * size, page * size),
            pagination: { page, size, totalItems: orders.length, totalPages: Math.ceil(orders.length / size) },
          } } });
        } else if (view) {
          await route.fulfill({ status: 400, json: { ok: false, error: { message: "No order detail is used by this directory benchmark." } } });
        } else {
          await route.fulfill({ status: 200, json: {
            ok: true, data: { items: orders, suppliers: [supplier], delivery_sites: [site] },
          } });
        }
        return;
      }
      await route.fallback();
    });
    try {
      const [initialResponse] = await Promise.all([
        browser.waitForResponse(/\/api\/catalogue\?[^#]*view=page(?:&|$)/, { timeout: 90_000 }),
        app.open("/dashboard/products"),
      ]);
      expect(initialResponse.status).toBe(200);
      const initial = await initialResponse.json() as ProductResponse;
      expect(initial.ok).toBe(true);
      await expect(screen.getByRole("heading", "Produits & prix de référence", { exact: true })).toBeVisible();
      await expect(browser.locator('section[aria-label="Base produits"]')).toHaveAttribute("aria-busy", "false");
      const seed = initial.data.items.map((item) => item.designation.trim())
        .sort((left, right) => right.length - left.length)[0];
      if (!seed || seed.length < 8) throw new Error("A real nonempty catalogue designation of at least 8 characters is required.");
      const terms = [...new Set(Array.from({ length: Math.min(seed.length - 1, 40) }, (_, index) =>
        seed.slice(0, index + 2).trim()
      ))].slice(0, 7);
      if (terms.length !== 7) throw new Error("The real catalogue designation cannot provide seven distinct search prefixes.");
      const search = screen.getByRole("searchbox", "Rechercher une référence, une matière, une nuance ou une dimension…", { exact: true });
      const expectedByTerm = new Map<string, string[]>();
      for (const term of terms) {
        const startedAt = await browser.evaluate(() => performance.now());
        const [response] = await Promise.all([
          browser.waitForResponse(responsePattern(term), { timeout: 90_000 }),
          search.fill(term),
        ]);
        expect(response.status).toBe(200);
        const payload = await response.json() as ProductResponse;
        expect(payload.ok).toBe(true);
        expect(new URL(response.url).searchParams.get("q")).toBe(term);
        await expect.poll(async () => new URL(await browser.url()).searchParams.get("q")).toBe(term);
        await expect(search).toHaveValue(term);
        await expect(browser.locator('section[aria-label="Base produits"]')).toHaveAttribute("aria-busy", "false");
        const expected = payload.data.items.map((item) => item.designation.trim().replace(/\s+/g, " "));
        await expect(browser.locator(".product-catalogue-table tbody tr td:nth-child(2) > div:first-child")).toHaveText(expected);
        expect(payload.data.pagination.totalItems).toBeGreaterThan(0);
        expectedByTerm.set(term, expected);
        const metrics = await browser.evaluate((start) => {
          const resources = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
            .filter((entry) => entry.startTime >= start && new URL(entry.name).origin === location.origin)
            .map((entry) => {
              const url = new URL(entry.name);
              return {
                path: url.pathname, rsc: url.searchParams.has("_rsc"),
                catalogue: url.pathname === "/api/catalogue",
                startMs: entry.startTime - start, durationMs: entry.duration,
              };
            });
          return {
            inputToResultCheckedMs: performance.now() - start,
            rscRequests: resources.filter((entry) => entry.rsc).length,
            catalogueRequests: resources.filter((entry) => entry.catalogue).length,
            resources,
          };
        }, startedAt);
        productSamples.push({ term, expectedRows: expected.length, totalItems: payload.data.pagination.totalItems, ...metrics });
      }
      const lastTerm = terms[terms.length - 1];
      const [sizedResponse] = await Promise.all([
        browser.waitForResponse(/\/api\/catalogue\?[^#]*size=50(?:&|$)/, { timeout: 90_000 }),
        screen.getByRole("button", "50 par page", { exact: true }).tap(),
      ]);
      expect(sizedResponse.status).toBe(200);
      const sized = await sizedResponse.json() as ProductResponse;
      expect(sized.data.pagination.size).toBe(50);
      await expect.poll(async () => new URL(await browser.url()).searchParams.get("size")).toBe("50");
      await expect(browser.locator('section[aria-label="Base produits"]')).toHaveAttribute("aria-busy", "false");
      await app.back();
      await expect.poll(async () => new URL(await browser.url()).searchParams.get("size")).toBe(null);
      await expect.poll(async () => new URL(await browser.url()).searchParams.get("q")).toBe(lastTerm);
      await expect(search).toHaveValue(lastTerm);
      await expect(screen.getByRole("button", "25 par page", { exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(browser.locator('section[aria-label="Base produits"]')).toHaveAttribute("aria-busy", "false");
      await expect(browser.locator(".product-catalogue-table tbody tr td:nth-child(2) > div:first-child"))
        .toHaveText(expectedByTerm.get(lastTerm)!);
      historyResult = { restoredQuery: lastTerm, restoredSize: 25, restoredRows: expectedByTerm.get(lastTerm)!.length };

      await app.open("/dashboard/orders");
      await expect(screen.getByRole("heading", "Bons de commande", { exact: true })).toBeVisible();
      const table = browser.locator('[aria-label="Tableau des bons de commande"]');
      const orderRows = browser.locator('[aria-label="Tableau des bons de commande"] tbody > tr');
      await expect(orderRows).toHaveCount(50);
      await expect.poll(() => browser.evaluate(() =>
        Boolean((window as Window & { __armyOrdersMount?: unknown }).__armyOrdersMount)
      )).toBe(true);
      const mount = await browser.evaluate(() =>
        (window as Window & { __armyOrdersMount?: Record<string, number | string> }).__armyOrdersMount ?? null
      );
      if (typeof mount?.animatedRows !== "number") throw new Error("Initial order animation measurement is missing.");
      animatedOrderRows = mount.animatedRows;
      await expect(table.getByRole("link", "ARMY PERF 050", { exact: true })).toBeVisible();
      await expect(orderRows.last()).toContainText("123,94");
      await expect(orderRows.first()).toContainText("123,45");
      await table.getByRole("button", "Actions du bon ARMY PERF 050", { exact: true }).tap();
      await expect(screen.getByRole("menuitem", "Télécharger le ZIP", { exact: true })).toBeVisible();
      await expect(screen.getByRole("menuitem", "Changer le statut…", { exact: true })).toBeVisible();
      await expect(screen.getByRole("menuitem", "Supprimer", { exact: true })).toBeVisible();
      await browser.keyboard.press("Escape");
      await expect(screen.getByRole("menuitem", "Supprimer", { exact: true })).not.toBeVisible();
      ordersResult = { syntheticRows: 120, mountedRows: 50, firstHtCents: 12345, lastHtCents: 12394, mount, actionMenuVerified: true };
      expect(blockedMutations).toEqual([]);
    } finally {
      await browser.unroute("**/*");
      const directory = ".e2e/army/performance/artifacts/metrics";
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "dogfood-directory.json"), JSON.stringify({
        recordedAt: new Date().toISOString(), viewport: { width: 1440, height: 900 },
        environment: process.env.E2E_ARMY_SERVER_MODE === "live" ? "existing local development server" : "owned local production server",
        productSamples, historyResult, ordersResult, blockedMutations,
        scope: "Real catalogue API reads through UI filters/history. Synthetic 120-order directory GET only, rendering one 50-order page. Real inventory completeness is covered by dogfood-orders.e2e.ts. No business mutation; actions inspected without invocation.",
        limits: "Local native CPU/network browser diagnostics, no physical-device or field percentile proof. Result-check latency includes runner overhead. Routing disables browser HTTP cache equally before and after. Resource counts include completed requests begun after each fill. Initial order styles are captured by a DOM observer at mount; animation delay is measured without waiting for all staggered animations.",
      }, null, 2) + "\n");
    }
    expect.soft(productSamples.reduce((total, sample) => total + sample.rscRequests, 0)).toBe(0);
    expect.soft(animatedOrderRows).toBe(0);
  },
);
