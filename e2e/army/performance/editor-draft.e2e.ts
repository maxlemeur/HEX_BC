import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { armyTest, ownEstimate, readEstimate, type ArmyEstimate } from "../critical/fixtures";
import { assertOwnedLocalBackend, waitForDraftLease } from "../local/engine-v3-editor-support";
import { editorDraftFixture } from "./editor-draft-fixture";

type ExpectedSuggestion = { value: string; text: string };
type EditorFixture = {
  schemaVersion: "dogfood-editor-1";
  runPrefix: string;
  projectId: string;
  versionId: string;
  supabaseHost: string;
  targetLineId: string;
  expectedItems: number;
  expectedTotals: number[];
  ruleCount: number;
  titles: Array<{ title: string; suggestions: ExpectedSuggestion[] }>;
};
type EditingMeasurement = {
  inputToPaintMs: number;
  inputToSavedMs: number;
  longTaskCount: number;
  totalBlockingMs: number;
  longestTaskMs: number;
  requests: Array<{ path: string; durationMs: number }>;
};
type SearchMeasurement = Omit<EditingMeasurement, "inputToSavedMs"> & { matchingTitles: string[] };

async function armDraftSearch(browser: Browser, title: string) {
  await browser.evaluate((title) => {
    const search = document.querySelector<HTMLInputElement>('[data-testid="estimate-editor-search-input"]');
    if (!search) throw new Error("The real draft search input is missing.");
    const scope = window as typeof window & { __armyDraftSearch?: Promise<SearchMeasurement> };
    scope.__armyDraftSearch = new Promise((resolve, reject) => {
      let started: number | null = null;
      let pending = false;
      const tasks: PerformanceEntry[] = [];
      const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((entries) => tasks.push(...entries.getEntries())) : null;
      const titles = () => [...document.querySelectorAll<HTMLInputElement>('[data-testid="estimate-line-title-input"]')].map((node) => node.value);
      const matches = () => search.value === title && titles().length === 1 && titles()[0] === title;
      const cleanup = () => {
        clearTimeout(timeout);
        mutations.disconnect();
        search.removeEventListener("input", onInput, true);
        if (observer) tasks.push(...observer.takeRecords());
        observer?.disconnect();
      };
      const check = () => {
        if (started === null || pending || !matches()) return;
        pending = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          pending = false;
          if (started === null || !matches()) return;
          const end = performance.now();
          const start = started;
          cleanup();
          const during = tasks.filter((entry) => entry.startTime + entry.duration > start && entry.startTime < end);
          resolve({ inputToPaintMs: end - start, matchingTitles: titles(), longTaskCount: during.length,
            totalBlockingMs: during.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
            longestTaskMs: Math.max(0, ...during.map((entry) => entry.duration)),
            requests: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
              .filter((entry) => entry.startTime >= start && entry.initiatorType === "fetch")
              .map((entry) => ({ path: new URL(entry.name).pathname, durationMs: entry.duration })) });
        }));
      };
      const mutations = new MutationObserver(check);
      const onInput = () => {
        started = performance.now();
        observer?.observe({ type: "longtask" });
        mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        queueMicrotask(check);
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("The exact real draft search result was not rendered.")); }, 15_000);
      search.addEventListener("input", onInput, { once: true, capture: true });
    });
    void scope.__armyDraftSearch.catch(() => undefined);
    return null;
  }, title);
}

// Failure modes defined before app edits: rebuilding 2,031 line suggestions blocks input;
// an optimized ranker changes exact/partial/fuzzy ordering or score; autosave loses the
// actual title or changes money; a cached suggestion survives a new title, rule or learning.
// The receipt contains a real imported OPTIMA draft and frozen suggestion oracles captured
// with the baseline scorer. Browser responses and saves are never mocked in this journey.
async function armEditorMeasurement(browser: Browser, itemId: string, title: string) {
  await browser.evaluate(({ itemId, title }) => {
    const input = document.querySelector<HTMLInputElement>(`[data-estimate-item-id="${itemId}"] [data-testid="estimate-line-title-input"]`);
    if (!input) throw new Error("The retained draft line is not rendered.");
    const scope = window as typeof window & { __armyEditing?: Promise<EditingMeasurement> };
    scope.__armyEditing = new Promise((resolve, reject) => {
      let start: number | null = null;
      let painted: number | null = null;
      let pending = false;
      let sawSaving = false;
      const tasks: PerformanceEntry[] = [];
      const observer = PerformanceObserver.supportedEntryTypes.includes("longtask")
        ? new PerformanceObserver((list) => tasks.push(...list.getEntries())) : null;
      const cleanup = () => {
        clearTimeout(timeout);
        mutations.disconnect();
        input.removeEventListener("input", onInput, true);
        if (observer) tasks.push(...observer.takeRecords());
        observer?.disconnect();
      };
      const check = () => {
        if (start === null) return;
        const status = document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent?.trim();
        if (status !== "À jour" && status !== "Sauvegardé") sawSaving = true;
        if (pending) return;
        const current = document.querySelector<HTMLInputElement>(`[data-estimate-item-id="${itemId}"] [data-testid="estimate-line-title-input"]`);
        if (current?.value !== title) return;
        pending = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          pending = false;
          if (start === null) return;
          painted ??= performance.now();
          const currentStatus = document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent?.trim();
          const saved = currentStatus === "À jour" || currentStatus === "Sauvegardé";
          if (!saved || !sawSaving) return;
          const end = performance.now();
          const started = start;
          cleanup();
          const during = tasks.filter((entry) => entry.startTime + entry.duration > started && entry.startTime < end);
          resolve({ inputToPaintMs: painted - started, inputToSavedMs: end - started,
            longTaskCount: during.length, totalBlockingMs: during.reduce((sum, entry) => sum + Math.max(0, entry.duration - 50), 0),
            longestTaskMs: Math.max(0, ...during.map((entry) => entry.duration)),
            requests: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
              .filter((entry) => entry.startTime >= started && entry.initiatorType === "fetch")
              .map((entry) => ({ path: new URL(entry.name).pathname, durationMs: entry.duration })) });
        }));
      };
      const mutations = new MutationObserver(check);
      const onInput = () => {
        start = performance.now();
        observer?.observe({ type: "longtask" });
        mutations.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        queueMicrotask(check);
      };
      const timeout = setTimeout(() => { cleanup(); reject(new Error("The real Ctrl+S draft save did not settle after the title edit.")); }, 30_000);
      input.addEventListener("input", onInput, { capture: true, once: true });
    });
    void scope.__armyEditing.catch(() => undefined);
    return null;
  }, { itemId, title });
}

function moneyAndInputs(state: ArmyEstimate) {
  return {
    totals: [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents],
  };
}

armyTest(
  "dogfood editor draft: seven exact persistent Ctrl+S edits on the complete OPTIMA fixture with 80 suggestion rules",
  { session: "army", tags: ["performance", "editor-draft-performance"], requires: ["browser"], timeout: 600_000 },
  async ({ app, browser, screen, army }) => {
    assertOwnedLocalBackend();
    const allowedHost = process.env.E2E_ALLOWED_SUPABASE_HOST;
    if (!allowedHost) throw new Error("The owned stack allowlist is missing.");
    const fixture = await editorDraftFixture({ app, browser, screen }, army) as EditorFixture;
    expect(fixture.schemaVersion).toBe("dogfood-editor-1");
    expect(fixture.runPrefix).toMatch(/^ARMY-/);
    expect(fixture.supabaseHost).toBe(allowedHost);
    expect(fixture.expectedItems).toBeGreaterThanOrEqual(2031);
    expect(fixture.ruleCount).toBeGreaterThanOrEqual(80);
    expect(fixture.titles).toHaveLength(7);
    army.runPrefix = fixture.runPrefix;
    ownEstimate(army, fixture);
    await app.open("/dashboard/affaires");
    const before = await readEstimate(browser, fixture.versionId);
    expect(before.version.calc_engine_version).toBe(3);
    expect(before.version.status).toBe("draft");
    expect(before.items).toHaveLength(fixture.expectedItems);
    expect(moneyAndInputs(before).totals).toEqual(fixture.expectedTotals);
    const target = before.items.find((item) => item.id === fixture.targetLineId);
    if (!target || target.item_type !== "line") throw new Error("The receipt does not point to a real owned line.");
    const samples: Array<{ title: string; suggestions: ExpectedSuggestion[]; persistedTitle: string } & EditingMeasurement> = [];
    const searches: Array<{ title: string } & SearchMeasurement> = [];
    const metrics = path.resolve(".e2e/army/performance/artifacts/metrics/editor-draft.json");
    await mkdir(path.dirname(metrics), { recursive: true });
    const saveMetrics = async (result: string) => writeFile(metrics, JSON.stringify({ fixture, result, samples, searches,
      environment: "owned loopback production build; complete imported OPTIMA draft; real title input and Ctrl+S flush through the editor save pipeline; native CPU/network",
      limits: "title input includes two browser animation frames; saved timing includes the runner's Tab/Ctrl+S command and HTTP; the one-minute automatic cadence is unchanged and is not measured; this is not a SQL statement budget or field percentile" }, null, 2) + "\n");
    try {
      await app.open(`/dashboard/estimates/${fixture.versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      await waitForDraftLease({ app, browser, screen });
      const titleInput = browser.locator(`[data-estimate-item-id="${target.id}"] [data-testid="estimate-line-title-input"]`);
      // The prepared target is the first visible real line. Keeping its position avoids
      // a search filter removing it when its title is edited.
      await expect(titleInput).toBeEnabled();
      // The product's automatic cadence is one minute. Prepare the same initial
      // title on repeated runs, then measure the explicit user save shortcut.
      // A failed earlier run can have flushed its own pending draft on pagehide.
      const preparedTitle = "ARMY performance prepared line";
      if (await titleInput.inputValue() !== preparedTitle) {
        await titleInput.fill(preparedTitle);
        await browser.keyboard.press("Tab");
        await browser.keyboard.press("Control+s");
      }
      await expect.poll(async () => (await readEstimate(browser, fixture.versionId)).items.find((item) => item.id === target.id)?.title,
        { timeout: 30_000 }).toBe(preparedTitle);
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("À jour");
      for (const scenario of fixture.titles) {
        await armEditorMeasurement(browser, target.id, scenario.title);
        await titleInput.fill(scenario.title);
        await browser.keyboard.press("Tab");
        await browser.keyboard.press("Control+s");
        const measured = await browser.evaluate(async () => {
          const pending = (window as typeof window & { __armyEditing?: Promise<EditingMeasurement> }).__armyEditing;
          if (!pending) throw new Error("No pending draft timing probe.");
          return pending;
        });
        const actualSuggestions = await browser.evaluate((id) => {
          const row = document.querySelector(`[data-estimate-item-id="${id}"]`);
          const suggestion = (row?.closest("[data-index]") ?? row)?.nextElementSibling;
          return [...(suggestion?.querySelectorAll<HTMLOptionElement>(".estimate-suggestion select option") ?? [])]
            .map((option) => ({ value: option.value, text: option.textContent?.trim() ?? "" }));
        }, target.id);
        const persisted = await readEstimate(browser, fixture.versionId);
        const persistedTitle = persisted.items.find((item) => item.id === target.id)?.title ?? "";
        samples.push({ title: scenario.title, ...measured, suggestions: actualSuggestions, persistedTitle });
        await saveMetrics("in-progress");
        expect(actualSuggestions).toEqual(scenario.suggestions);
        expect(persistedTitle).toBe(scenario.title);
        // updated_at/content tokens and projections are allowed to advance. Every
        // numeric business input and monetary value must remain exactly unchanged.
        expect(persisted.items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.unit_price_ht_cents,
          ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents })))
          .toEqual(before.items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.unit_price_ht_cents,
            ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents })));
        expect(moneyAndInputs(persisted).totals).toEqual(fixture.expectedTotals);
      }
      const lines = before.items.filter((item) => item.item_type === "line" && item.id !== target.id);
      const searchTitles = [...new Set(lines.map((item) => item.title))].filter((title) => title.length > 12 &&
        lines.filter((item) => item.title.toLowerCase().includes(title.toLowerCase())).length === 1).slice(0, 7);
      expect(searchTitles).toHaveLength(7);
      for (const title of searchTitles) {
        await armDraftSearch(browser, title);
        await screen.getByTestId("estimate-editor-search-input").fill(title);
        const measured = await browser.evaluate(async () => {
          const pending = (window as typeof window & { __armyDraftSearch?: Promise<SearchMeasurement> }).__armyDraftSearch;
          if (!pending) throw new Error("No pending draft search probe.");
          return pending;
        });
        searches.push({ title, ...measured });
        await saveMetrics("in-progress");
        expect(measured.matchingTitles).toEqual([title]);
      }
      await screen.getByTestId("estimate-editor-search-input").fill("");
      const searched = await readEstimate(browser, fixture.versionId);
      expect(searched.items).toHaveLength(fixture.expectedItems);
      expect(moneyAndInputs(searched).totals).toEqual(fixture.expectedTotals);
      await browser.reload();
      await waitForDraftLease({ app, browser, screen });
      await expect(titleInput).toHaveValue(fixture.titles.at(-1)!.title);
      const after = await readEstimate(browser, fixture.versionId);
      expect(after.items).toHaveLength(fixture.expectedItems);
      expect(moneyAndInputs(after).totals).toEqual(fixture.expectedTotals);
      await saveMetrics("passed");
    } catch (error) {
      await saveMetrics("failed");
      throw error;
    }
  }
);
