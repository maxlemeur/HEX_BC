import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { measure } from "./measure";

type GridSearchMeasurement = {
  term: string;
  inputToResultPaintMs: number;
  longTaskCount: number;
  totalBlockingMs: number;
  longestTaskMs: number;
};

async function readGridDom(browser: Browser) {
  return browser.evaluate(() => ({
    totalElements: document.getElementsByTagName("*").length,
    mountedDesktopLines: document.querySelectorAll('[data-testid="estimate-line-row"]').length,
    mountedMobileLines: document.querySelectorAll('[data-testid^="estimate-mobile-line-"]').length,
    mobileLineCountText: document.querySelector('[data-testid="estimate-mobile-list"] .estimate-mobile-list__toolbar p')?.textContent?.trim() ?? null,
    declaredGridRows: Number(document.querySelector('[data-testid="estimate-editor-body"]')?.getAttribute("aria-rowcount") ?? 0),
  }));
}

async function armGridSearchMeasurement(browser: Browser, term: string, expectedTitle: string, fullRowCount: number) {
  await browser.evaluate(({ term, expectedTitle, fullRowCount }) => {
    const search = document.querySelector<HTMLInputElement>('[data-testid="estimate-editor-search-input"]');
    if (!search) throw new Error("The editor search input is missing.");
    const state = window as typeof window & { __armyGridSearchMeasurement?: Promise<GridSearchMeasurement> };
    state.__armyGridSearchMeasurement = new Promise((resolve, reject) => {
      let inputAt: number | null = null;
      let framePending = false;
      const longTasks: PerformanceEntry[] = [];
      const longTaskObserver = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((list) => longTasks.push(...list.getEntries()))
        : null;
      const resultMatches = () => {
        if (search.value !== term) return false;
        const titles = [...document.querySelectorAll<HTMLInputElement>('[data-testid="estimate-line-title-input"]')]
          .map((element) => element.value);
        if (!titles.includes(expectedTitle)) return false;
        if (term) return titles.length === 1;
        return Number(document.querySelector('[data-testid="estimate-editor-body"]')?.getAttribute("aria-rowcount")) === fullRowCount;
      };
      const cleanup = () => {
        clearTimeout(timeout);
        search.removeEventListener("input", onInput, true);
        mutations.disconnect();
        if (longTaskObserver) longTasks.push(...longTaskObserver.takeRecords());
        longTaskObserver?.disconnect();
      };
      const checkResult = () => {
        if (inputAt === null || framePending || !resultMatches()) return;
        framePending = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          framePending = false;
          if (inputAt === null || !resultMatches()) return;
          const startedAt = inputAt;
          const endedAt = performance.now();
          cleanup();
          const tasks = longTasks.filter((entry) => entry.startTime + entry.duration > startedAt && entry.startTime < endedAt);
          resolve({ term, inputToResultPaintMs: endedAt - startedAt,
            longTaskCount: tasks.length,
            totalBlockingMs: tasks.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
            longestTaskMs: Math.max(0, ...tasks.map((entry) => entry.duration)) });
        }));
      };
      const mutations = new MutationObserver(checkResult);
      const onInput = () => {
        inputAt = performance.now();
        longTaskObserver?.observe({ type: "longtask" });
        mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        queueMicrotask(checkResult);
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`The exact grid search result did not render for ${term || "the cleared filter"}.`));
      }, 15_000);
      search.addEventListener("input", onInput, { capture: true, once: true });
    });
    // Keep a timed-out probe handled until the runner reads its result.
    void state.__armyGridSearchMeasurement.catch(() => undefined);
    return null;
  }, { term, expectedTitle, fullRowCount });
}

async function readGridSearchMeasurement(browser: Browser) {
  return browser.evaluate(async () => {
    const probe = (window as typeof window & { __armyGridSearchMeasurement?: Promise<GridSearchMeasurement> }).__armyGridSearchMeasurement;
    if (!probe) throw new Error("The browser search measurement was not armed.");
    return probe;
  });
}

async function driveGridScroll(browser: Browser, mode: "frames" | "end") {
  return browser.evaluate(async (mode) => {
    const mobile = matchMedia("(max-width: 767px)").matches;
    const content = document.querySelector<HTMLElement>(mobile
      ? ".estimate-mobile-list__rows" : '[data-testid="estimate-editor-body"]');
    if (!content) throw new Error("The visible grid content is missing.");
    const scrollingElement = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const scrollable = (element: HTMLElement) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 1 &&
      (element === scrollingElement || /auto|scroll/.test(getComputedStyle(element).overflowY));
    // The desktop body owns TanStack Virtual's scrollRef. On compact mobile before the fix,
    // rows are in page flow; after the fix this same rows element owns the internal scrollport.
    let container = content;
    if (!mobile && !scrollable(container)) throw new Error("The desktop virtual body is not scrollable.");
    while (!scrollable(container) && container.parentElement) container = container.parentElement;
    if (!scrollable(container)) container = scrollingElement;
    if (container !== scrollingElement) container.scrollIntoView({ block: "center" });
    const initial = container.scrollTop;
    const intervals: number[] = [];
    if (mode === "frames") {
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
    } else {
      container.scrollTop = container.scrollHeight;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    return { container: container.getAttribute("data-testid") ?? container.tagName.toLowerCase(), mode,
      scrollTop: container.scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight,
      rect: container.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight },
      p95Ms: intervals.length ? [...intervals].sort((a, b) => a - b)[56] : null,
      maxMs: intervals.length ? Math.max(...intervals) : null,
      over50Ms: intervals.filter((value) => value > 50).length,
      scrollable: scrollable(container) };
  }, mode);
}

async function readLastLineReachability(browser: Browser) {
  return browser.evaluate(() => {
    const target = matchMedia("(max-width: 767px)").matches
      ? document.querySelector<HTMLElement>('[data-testid="estimate-mobile-line-00000000-0000-4000-8000-000000001000"]')
      : [...document.querySelectorAll<HTMLInputElement>('[data-testid="estimate-line-title-input"]')]
        .find((element) => element.value === "ARMY local performance line 1000");
    const body = document.querySelector<HTMLElement>('[data-testid="estimate-editor-body"]');
    const mobileRows = document.querySelector<HTMLElement>(".estimate-mobile-list__rows");
    const describe = (element: HTMLElement | null) => element ? {
      testId: element.getAttribute("data-testid"), tag: element.tagName.toLowerCase(),
      rect: element.getBoundingClientRect().toJSON(), scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
    } : null;
    if (!target) return { mounted: false, visibleRatio: 0, centreReachable: false,
      targetRect: null, scrollport: null, hit: null, body: describe(body), mobileRows: describe(mobileRows) };
    const rect = target.getBoundingClientRect();
    let scrollport = target.parentElement;
    while (scrollport && !(scrollport.clientHeight > 0 && scrollport.scrollHeight > scrollport.clientHeight + 1 &&
      /auto|scroll/.test(getComputedStyle(scrollport).overflowY))) scrollport = scrollport.parentElement;
    const port = scrollport?.getBoundingClientRect() ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    const left = Math.max(0, rect.left, port.left);
    const top = Math.max(0, rect.top, port.top);
    const right = Math.min(innerWidth, rect.right, port.right);
    const bottom = Math.min(innerHeight, rect.bottom, port.bottom);
    const visibleRatio = rect.width * rect.height > 0
      ? Math.max(0, right - left) * Math.max(0, bottom - top) / (rect.width * rect.height) : 0;
    const centreX = rect.left + rect.width / 2;
    const centreY = rect.top + rect.height / 2;
    const centreInViewportAndScrollport = centreX > left && centreX < right && centreY > top && centreY < bottom;
    const hit = centreInViewportAndScrollport ? document.elementFromPoint(centreX, centreY) : null;
    return { mounted: true, visibleRatio, centreReachable: hit !== null && (hit === target || target.contains(hit)),
      targetRect: rect.toJSON(), scrollport: describe(scrollport),
      hit: hit ? { tag: hit.tagName.toLowerCase(), testId: hit.getAttribute("data-testid") } : null,
      body: describe(body), mobileRows: describe(mobileRows) };
  });
}

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
    // Retain the source line's ancestor chain only: unrelated empty sections would put the
    // last synthetic line before the scroll end and change the benchmark's hierarchy by source.
    const sectionById = new Map<string, { id: string; parent_id: string | null }>(synthetic.data.items
      .filter((item: { item_type: string }) => item.item_type === "section")
      .map((item: { id: string; parent_id: string | null }) => [item.id, item]));
    const ancestorIds = new Set<string>();
    let parentId = line.parent_id;
    while (parentId) {
      if (ancestorIds.has(parentId)) throw new Error("The source line has a cyclic ancestor chain.");
      const parent = sectionById.get(parentId);
      if (!parent) throw new Error("The source line's parent section is missing.");
      ancestorIds.add(parentId);
      parentId = parent.parent_id;
    }
    synthetic.data.items = [
      ...synthetic.data.items.filter((item: { id: string }) => ancestorIds.has(item.id)),
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
    const viewportWidth = await browser.evaluate(() => innerWidth);
    const samples = [];
    let primaryFailure: unknown = null;
    try {
      for (let repeat = 0; repeat < 3; repeat += 1) {
        const route = `/dashboard/estimates/${fixture.id}/edit`;
        await app.open(route);
        await expect(browser).toHaveURL(route);
        await expect(screen.getByTestId("estimate-page-toolbar-title")).toContainText("Éditer le chiffrage");
        const width = await browser.evaluate(() => innerWidth);
        if (width >= 768) {
          await expect(screen.getByTestId("estimate-line-title-input").first()).toHaveValue("ARMY local performance line 1");
        } else {
          await expect(screen.getByText("ARMY local performance line 1", { exact: true })).toBeVisible();
        }
        await expect.poll(async () => (await measure(browser)).lcpMs).toBeTruthy();
        const loading = await measure(browser);
        const domBeforeInteraction = await readGridDom(browser);
        const searches: Array<{
          lineNumber: number; filter: GridSearchMeasurement; clear: GridSearchMeasurement;
          filterRunnerCheckedMs: number; clearRunnerCheckedMs: number;
          filteredDom: Awaited<ReturnType<typeof readGridDom>>;
          restoredDom: Awaited<ReturnType<typeof readGridDom>>;
        }> = [];
        const sample = { repeat, loading, domBeforeInteraction, searches };
        samples.push(sample);
        try {
          if (width >= 768) {
            const search = screen.getByRole("searchbox", "Rechercher dans le chiffrage", { exact: true });
            await expect(search).toBeVisible();
            for (const lineNumber of [113, 227, 341, 455, 569, 683, 797]) {
              const title = `ARMY local performance line ${lineNumber}`;
              await armGridSearchMeasurement(browser, title, title, synthetic.data.items.length);
              const filterStartedAt = performance.now();
              await search.fill(title);
              await expect(search).toHaveValue(title);
              await expect(screen.getByTestId("estimate-line-title-input")).toHaveValue(title);
              await expect(screen.getByTestId("estimate-line-title-input")).toHaveCount(1);
              const filter = await readGridSearchMeasurement(browser);
              const filterRunnerCheckedMs = performance.now() - filterStartedAt;
              const filteredDom = await readGridDom(browser);
              await armGridSearchMeasurement(browser, "", "ARMY local performance line 1", synthetic.data.items.length);
              const clearStartedAt = performance.now();
              await search.fill("");
              await expect(search).toHaveValue("");
              const clear = await readGridSearchMeasurement(browser);
              const clearRunnerCheckedMs = performance.now() - clearStartedAt;
              const restoredDom = await readGridDom(browser);
              expect(restoredDom.declaredGridRows).toBe(synthetic.data.items.length);
              searches.push({ lineNumber, filter, filterRunnerCheckedMs, filteredDom,
                clear, clearRunnerCheckedMs, restoredDom });
            }
          }
          const afterSearch = await measure(browser);
          Object.assign(sample, { afterSearch, searchScope: width >= 768 ? "desktop visible search" : "not available in compact mobile UI" });
          const frames = await driveGridScroll(browser, "frames");
          Object.assign(sample, { frames });
          const lastLineAccess = await driveGridScroll(browser, "end");
          Object.assign(sample, { lastLineAccess });
          await expect.poll(async () => (await readLastLineReachability(browser)).centreReachable).toBe(true);
          const lastLineReachability = await readLastLineReachability(browser);
          expect(lastLineReachability.visibleRatio).toBeGreaterThanOrEqual(0.5);
          let mobileControls = null;
          if (width >= 768) {
            await expect(screen.getByTestId("estimate-line-title-input").last()).toHaveValue("ARMY local performance line 1000");
          } else {
            await expect(screen.getByTestId("estimate-mobile-line-00000000-0000-4000-8000-000000001000")).toBeVisible();
            await screen.getByTestId("estimate-mobile-display-button").click();
            const display = screen.getByTestId("estimate-mobile-display-sheet");
            await expect(display).toBeVisible();
            await display.getByRole("button", /^Tableau complet/).click();
            await expect(screen.getByTestId("estimate-mobile-list")).toHaveAttribute("data-mobile-view", "table");
            await screen.getByRole("button", "Revenir à la liste compacte", { exact: true }).click();
            await expect(screen.getByTestId("estimate-mobile-list")).toHaveAttribute("data-mobile-view", "compact");
            await expect(screen.getByText("ARMY local performance line 1", { exact: true })).toBeVisible();
            const rootSectionId = [...ancestorIds].at(-1);
            if (rootSectionId) {
              const sectionToggle = screen.getByTestId(`estimate-mobile-section-${rootSectionId}`).getByRole("button").first();
              await sectionToggle.click();
              await expect(sectionToggle).toHaveAttribute("aria-expanded", "false");
              await expect.poll(async () => (await readGridDom(browser)).mountedMobileLines).toBe(0);
              await sectionToggle.click();
              await expect(sectionToggle).toHaveAttribute("aria-expanded", "true");
              await expect(screen.getByText("ARMY local performance line 1", { exact: true })).toBeVisible();
            }
            const afterControlsScroll = await driveGridScroll(browser, "end");
            await expect.poll(async () => (await readLastLineReachability(browser)).centreReachable).toBe(true);
            const afterControlsReachability = await readLastLineReachability(browser);
            expect(afterControlsReachability.visibleRatio).toBeGreaterThanOrEqual(0.5);
            await screen.getByTestId("estimate-mobile-line-00000000-0000-4000-8000-000000001000").click();
            const editor = screen.getByTestId("estimate-mobile-line-editor");
            await expect(editor).toBeVisible();
            await expect(screen.getByTestId("estimate-mobile-line-title-input")).toHaveValue("ARMY local performance line 1000");
            await expect(screen.getByTestId("estimate-mobile-line-title-input")).toBeDisabled();
            await editor.getByRole("button", "Fermer", { exact: true }).click();
            await expect(editor).toBeHidden();
            mobileControls = { switchedToTableAndBack: true, collapsedAndExpandedSection: rootSectionId ?? null,
              openedReadOnlyLastLine: true, afterControlsScroll, afterControlsReachability };
          }
          Object.assign(sample, { lastLineReachability, mobileControls,
            domAfterInteraction: await readGridDom(browser), afterInteraction: await measure(browser) });
          expect(frames.scrollable).toBe(true);
        } catch (error) {
          Object.assign(sample, { failure: error instanceof Error ? { name: error.name, message: error.message } : String(error),
            domAtFailure: await readGridDom(browser), lastLineAtFailure: await readLastLineReachability(browser) });
          throw error;
        }
      }
    } catch (error) { primaryFailure = error; }
    let persisted = null;
    let invariantFailure: unknown = null;
    try {
      await browser.unroute("**/*");
      await app.open("/dashboard/affaires");
      persisted = await browser.evaluate(async (id) => {
        const result = await (await fetch(`/api/estimates/${id}`, { credentials: "same-origin" })).json();
        return { updatedAt: result.data.version.updated_at, totalHt: result.data.version.total_ht_cents,
          itemCount: result.data.items.length };
      }, fixture.id);
      expect(persisted).toEqual({ updatedAt: fixture.updatedAt, totalHt: fixture.totalHt, itemCount: fixture.itemCount });
    } catch (error) { invariantFailure = error; }
    const directory = path.resolve(".e2e/army/performance/artifacts/metrics");
    await mkdir(directory, { recursive: true });
    const identity = { id: fixture.id, projectId: fixture.projectId, status: fixture.status,
      itemCount: fixture.itemCount, updatedAt: fixture.updatedAt, totalHt: fixture.totalHt };
    await writeFile(path.join(directory, `editor-grid-${viewportWidth}.json`), JSON.stringify({
      schemaVersion: "miaouffrage-performance-3", recordedAt: new Date().toISOString(), fixture: identity, syntheticLineCount: 1000, samples,
      sourceAfter: persisted,
      failure: primaryFailure instanceof Error ? { name: primaryFailure.name, message: primaryFailure.message } : primaryFailure,
      invariantFailure: invariantFailure instanceof Error ? { name: invariantFailure.name, message: invariantFailure.message } : invariantFailure,
      environment: "local production, native desktop CPU/network; viewport only; browser routing disables cache",
      interpretation: "browser-only synthetic read-only grid rendering/search/scroll; not connected persistence, edit/autosave or real-device qualification",
      measurement: {
        search: "inputToResultPaintMs starts at the browser input event and ends after the exact result and two requestAnimationFrame callbacks; it is a paint opportunity, not a compositor timestamp or field INP. On desktop only, each of seven unique filters is followed by an exact full-list restoration. Compact mobile hides search and is measured without it.",
        runner: "filterRunnerCheckedMs and clearRunnerCheckedMs include locator, assertion and transport overhead; they are upper bounds and are separate from browser timing.",
        longTasks: "Per-search long tasks overlap the input-to-result interval, including the input handler's containing task; task durations are whole-task durations. Loading/afterSearch/afterInteraction metrics are cumulative buffered navigation measurements.",
        dom: "Mounted row counts include hidden desktop/mobile subtrees; declaredGridRows records the complete filtered hierarchy, independently of desktop virtualization.",
      },
    }, null, 2) + "\n");
    if (primaryFailure) throw primaryFailure;
    if (invariantFailure) throw invariantFailure;
    // Keep the complete timings, exact journey and unchanged-source evidence even on the red
    // reference: rendering all 1,000 mobile rows is the concrete regression this guard exposes.
    if (viewportWidth < 768) {
      for (const sample of samples) expect(sample.domBeforeInteraction.mountedMobileLines).toBeLessThanOrEqual(50);
    }
  }
);
