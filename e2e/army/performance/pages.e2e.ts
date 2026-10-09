import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { measure } from "./measure";

const routes = [
  { path: "/login", heading: "Connexion", session: undefined },
  { path: "/signup", heading: "Créer un compte", session: undefined },
  { path: "/dashboard/affaires", heading: "Affaires", session: "army" },
  { path: "/dashboard/products", heading: "Produits & prix de référence", session: "army" },
  { path: "/dashboard/orders", heading: "Bons de commande", session: "army" },
] as const;


for (const route of routes) {
  test(
    `production performance: ${route.path}`,
    { tags: ["performance"], requires: ["browser"], session: route.session, timeout: 180_000 },
    async ({ app, browser, screen }) => {
      const samples = [];
      for (let repeat = 0; repeat < 3; repeat += 1) {
        await app.open(route.path);
        await expect(browser).toHaveURL(route.path);
        await expect(screen.getByRole("heading", route.heading, { exact: true })).toBeVisible();
        await expect.poll(() => browser.evaluate(() => document.fonts.status), { timeout: 30_000 }).toBe("loaded");
        await expect.poll(async () => (await measure(browser)).lcpMs, { timeout: 15_000 }).toBeTruthy();
        const loading = await measure(browser);
        // Read-only interaction: exercise React without submitting a form or changing records.
        if (route.path === "/login" || route.path === "/signup") {
          const email = screen.getByLabel("Email", { exact: true });
          await email.fill("performance@example.invalid");
          await expect(email).toHaveValue("performance@example.invalid");
          await email.fill("");
        } else {
          const search = screen.getByRole("searchbox");
          await search.tap();
          await search.fill("ARMY-performance-no-match");
          await expect(search).toHaveValue("ARMY-performance-no-match");
          await search.fill("");
          await expect(search).toHaveValue("");
        }
        const frames = await browser.evaluate(async () => {
          const intervals: number[] = [];
          let previous = 0;
          const startingY = scrollY;
          await new Promise<void>((resolve) => {
            const frame = (now: number) => {
              if (previous) intervals.push(now - previous);
              previous = now;
              scrollTo(0, startingY + (intervals.length % 2 ? 80 : 0));
              if (intervals.length < 60) requestAnimationFrame(frame);
              else { scrollTo(0, startingY); resolve(); }
            };
            requestAnimationFrame(frame);
          });
          const sorted = [...intervals].sort((a, b) => a - b);
          return {
            count: intervals.length,
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
            maxMs: Math.max(...intervals),
            over50Ms: intervals.filter((value) => value > 50).length,
            scrollable: document.documentElement.scrollHeight > innerHeight,
          };
        });
        samples.push({ repeat, loading, afterInteraction: await measure(browser), frames });
      }
      const directory = path.resolve(".e2e/army/performance/artifacts/metrics");
      await mkdir(directory, { recursive: true });
      const viewport = samples[0].loading.viewport.width;
      await writeFile(path.join(directory, `${route.path.replaceAll("/", "-")}-${viewport}.json`), JSON.stringify({
        schemaVersion: "miaouffrage-performance-1",
        recordedAt: new Date().toISOString(),
        route: route.path,
        fixture: route.session ? "existing dedicated ARMY account; no record mutations" : "anonymous",
        environment: "owned local production server; native desktop CPU/network; mobile target is viewport only",
        cache: "fresh context per test; first navigation cold and two repeat navigations with browser cache",
        interpretation: "short lab samples; event duration is diagnostic, not field INP; frames only qualify these visits",
        samples,
      }, null, 2) + "\n");
      // Missing content/timing must fail; speed values remain measured evidence until a stable lab budget is established.
      for (const sample of samples) {
        expect(sample.loading.lcpMs).toBeTruthy();
        expect(sample.frames.count).toBe(60);
      }
    }
  );
}
