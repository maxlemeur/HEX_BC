import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { measure } from "./measure";

// Failure modes: missing rows after hydration, expensive editor loading, dropped scroll frames,
// or a supposedly read-only visit acquiring a lock or changing business values.
// Connected E2E gap: available hosted ARMY versions are drafts and take locks. A browser-only
// 1,000-line read-only payload measures grid rendering without changing their status/data.
test(
  "local grid performance: 1000 synthetic read-only lines on the production editor",
  { tags: ["grid-performance"], session: "army", requires: ["browser"], timeout: 180_000 },
  async ({ app, browser, screen }) => {
    await app.open("/dashboard/affaires");
    const fixture = await browser.evaluate(async () => {
      const response = await fetch("/api/estimates", { credentials: "same-origin" });
      if (response.status !== 200) throw new Error("Unable to read ARMY estimate inventory.");
      const result = await response.json();
      const candidates = result.data.items.filter((item: { project_name: string; status: string }) =>
        item.project_name.startsWith("ARMY")
      );
      let selected: { id: string; projectId: string; status: string; itemCount: number; updatedAt: string; totalHt: number; response: string } | null = null;
      for (const item of candidates.slice(0, 5)) {
        const detail = await fetch(`/api/estimates/${item.version_id}`, { credentials: "same-origin" });
        const body = await detail.json();
        if (detail.status !== 200 || !body.data.items.some((line: { item_type: string }) => line.item_type === "line")) continue;
        if (!selected || body.data.items.length > selected.itemCount) selected = {
          id: item.version_id, projectId: item.project_id, status: body.data.version.status,
          itemCount: body.data.items.length, updatedAt: body.data.version.updated_at,
          totalHt: body.data.version.total_ht_cents,
          response: JSON.stringify(body),
        };
      }
      return selected;
    });
    if (!fixture) throw new Error("No nonempty ARMY source: local grid performance is missing proof.");
    const synthetic = JSON.parse(fixture.response);
    synthetic.data.version.status = "sent";
    const line = synthetic.data.items.find((item: { item_type: string }) => item.item_type === "line");
    synthetic.data.items = [
      ...synthetic.data.items.filter((item: { item_type: string }) => item.item_type === "section"),
      ...Array.from({ length: 1000 }, (_, index) => ({ ...line,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        position: index, title: `ARMY local performance line ${index + 1}`,
      })),
    ];
    // Fail on every browser mutation. A non-draft version must not request a draft lock.
    const origin = new URL(app.baseUrl!).origin;
    await browser.route("**/*", async (route) => {
      const requestUrl = new URL(route.request.url);
      if (requestUrl.origin === origin && requestUrl.pathname === `/api/estimates/${fixture.id}` && route.request.method === "GET") {
        await route.fulfill({ status: 200, json: synthetic });
        return;
      }
      if (new URL(route.request.url).origin === origin && !["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
        await route.abort();
        throw new Error("Read-only editor attempted a mutation.");
      }
      await route.continue();
    });
    const samples = [];
    for (let repeat = 0; repeat < 3; repeat += 1) {
      const route = `/dashboard/estimates/${fixture.id}/edit`;
      await app.open(route);
      await expect(browser).toHaveURL(route);
      await expect(screen.getByTestId("estimate-page-toolbar-title")).toContainText("Éditer le chiffrage");
      const width = await browser.evaluate(() => innerWidth);
      if (width >= 1024) {
        await expect(screen.getByTestId("estimate-line-title-input").first()).toHaveValue("ARMY local performance line 1");
      } else {
        await expect(screen.getByText("ARMY local performance line 1", { exact: true })).toBeVisible();
      }
      await expect.poll(async () => (await measure(browser)).lcpMs).toBeTruthy();
      const loading = await measure(browser);
      const frames = await browser.evaluate(async () => {
        const scrollingElement = (document.scrollingElement ?? document.documentElement) as HTMLElement;
        const candidates = [...document.querySelectorAll<HTMLElement>(
          '[data-testid="estimate-editor-body"], main, [data-testid="estimate-editor-table-scroll"]'
        ), scrollingElement];
        const container = candidates.find((element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 &&
          (element === scrollingElement || /auto|scroll/.test(getComputedStyle(element).overflowY))) ?? scrollingElement;
        const initial = container.scrollTop;
        const intervals: number[] = [];
        let previous = 0;
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (previous) intervals.push(now - previous);
            previous = now;
            container.scrollTop = initial + (intervals.length % 2 ? 200 : 0);
            if (intervals.length < 60) requestAnimationFrame(frame);
            else { container.scrollTop = initial; resolve(); }
          };
          requestAnimationFrame(frame);
        });
        return { p95Ms: [...intervals].sort((a, b) => a - b)[56], maxMs: Math.max(...intervals),
          over50Ms: intervals.filter((value) => value > 50).length,
          scrollable: container.scrollHeight > container.clientHeight };
      });
      samples.push({ repeat, loading, frames, afterInteraction: await measure(browser) });
      expect(frames.scrollable).toBe(true);
    }
    await browser.unroute("**/*");
    await app.open("/dashboard/affaires");
    const persisted = await browser.evaluate(async (id) => {
      const result = await (await fetch(`/api/estimates/${id}`, { credentials: "same-origin" })).json();
      return { updatedAt: result.data.version.updated_at, totalHt: result.data.version.total_ht_cents,
        itemCount: result.data.items.length };
    }, fixture.id);
    expect(persisted).toEqual({ updatedAt: fixture.updatedAt, totalHt: fixture.totalHt, itemCount: fixture.itemCount });
    const directory = path.resolve(".e2e/army/performance/artifacts/metrics");
    await mkdir(directory, { recursive: true });
    const identity = { id: fixture.id, projectId: fixture.projectId, status: fixture.status,
      itemCount: fixture.itemCount, updatedAt: fixture.updatedAt, totalHt: fixture.totalHt };
    await writeFile(path.join(directory, `editor-grid-${samples[0].loading.viewport.width}.json`), JSON.stringify({
      schemaVersion: "miaouffrage-performance-1", recordedAt: new Date().toISOString(), fixture: identity, syntheticLineCount: 1000, samples,
      environment: "local production, native desktop CPU/network; viewport only; browser routing disables cache",
      interpretation: "browser-only synthetic grid performance; not connected persistence, edit/autosave or real-device qualification",
    }, null, 2) + "\n");
  }
);
