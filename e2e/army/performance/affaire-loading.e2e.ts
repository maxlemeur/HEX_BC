import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createLineViaApi,
  ownEstimate,
  readEstimate,
  recordEvidence,
  type ArmyEstimate,
} from "../critical/fixtures";

type Fixture = {
  schemaVersion: "miaouffrage-affaire-performance-1";
  runPrefix: string;
  projectName: string;
  projectId: string;
  versionId: string;
  supabaseHost: string;
  prepared?: boolean;
};

const fixturePath = path.resolve(".e2e/army/performance/fixtures/affaire.json");
const metricsPath = path.resolve(".e2e/army/performance/artifacts/metrics");

function businessValues(estimate: ArmyEstimate) {
  return {
    project: estimate.project,
    status: estimate.version.status,
    title: estimate.version.title,
    totals: [estimate.version.total_ht_cents, estimate.version.total_tax_cents, estimate.version.total_ttc_cents],
    items: estimate.items.map((item) => ({ id: item.id, type: item.item_type, parent: item.parent_id,
      title: item.title, quantity: item.quantity, unitPrice: item.unit_price_ht_cents, totalHt: item.line_total_ht_cents })),
  };
}

async function retainedFixture(): Promise<Fixture | null> {
  try {
    const value = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
    if (value.schemaVersion !== "miaouffrage-affaire-performance-1" ||
      !value.runPrefix?.startsWith("ARMY-") || value.projectName !== `${value.runPrefix} loading` ||
      value.supabaseHost !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
      !/^[0-9a-f-]{36}$/i.test(value.projectId) || !/^[0-9a-f-]{36}$/i.test(value.versionId)) {
      throw new Error("The retained affaire is not this benchmark's owned, allowlisted fixture.");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Failure oracles and approval-read side effects are documented before app changes in
// docs/testing/affaire-loading-performance.md. Only this lot's new ARMY draft is visited.
armyTest(
  "affaire loading: same owned draft, exact values and five real client transitions",
  { tags: ["affaire-performance"], session: "army", requires: ["browser"], timeout: 300_000 },
  async ({ app, browser, screen, army }) => {
    await app.open("/dashboard/affaires");
    let fixture = await retainedFixture();
    if (!fixture) {
      const projectName = `${army.runPrefix} loading`;
      const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(
        browser, "POST", "/api/estimates", {
          project: { name: projectName, client_name: "ARMY performance" },
          version: { title: "ARMY loading benchmark", margin_multiplier: 1, margin_mode: "fixed",
            discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", max_section_depth: 1 },
        }
      );
      expect(created.status).toBe(201);
      expect(created.body.ok).toBe(true);
      const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
      ownEstimate(army, ids);
      await recordEvidence(army, "loading-creation", { ...ids, projectName, httpStatus: created.status });
      await createLineViaApi(browser, ids.versionId, "ARMY loading line A", { quantity: 2, unit_price_ht_cents: 1250 });
      await createLineViaApi(browser, ids.versionId, "ARMY loading line B", { quantity: 1, unit_price_ht_cents: 2500 });
      fixture = { schemaVersion: "miaouffrage-affaire-performance-1", runPrefix: army.runPrefix,
        projectName, ...ids, supabaseHost: process.env.E2E_ALLOWED_SUPABASE_HOST!, prepared: false };
      await mkdir(path.dirname(fixturePath), { recursive: true });
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { flag: "wx" });
    }
    army.runPrefix = fixture.runPrefix;
    army.projectName = fixture.projectName;
    ownEstimate(army, fixture);
    let before = await readEstimate(browser, fixture.versionId);
    expect(before.project.id).toBe(fixture.projectId);
    expect(before.project.name).toBe(fixture.projectName);
    expect(before.version.status).toBe("draft");
    if (!fixture.prepared) {
      // Item creation persists its price; the editor separately persists aggregate totals.
      // Prepare that ordinary application contract once, only on this new owned fixture.
      const lines = before.items.filter((item) => item.item_type === "line");
      expect(lines).toHaveLength(2);
      expect(lines.reduce((total, item) => total + (item.line_total_ht_cents ?? 0), 0)).toBe(5000);
      const versionId = fixture.versionId;
      await expect.poll(async () => (await apiRequest(browser, "POST", `/api/estimates/${versionId}/lock`)).status,
        { timeout: 140_000, interval: 10_000 }).toBe(201);
      try {
        const saved = await apiRequest(browser, "POST", `/api/estimates/${versionId}/items/bulk`, {
          updated_at: before.version.updated_at, updates: [],
          version_patch: { total_ht_cents: 5000, total_tax_cents: 1000, total_ttc_cents: 6000 },
        });
        expect(saved.status).toBe(200);
        before = await readEstimate(browser, versionId);
        expect(businessValues(before).totals).toEqual([5000, 1000, 6000]);
        await recordEvidence(army, "loading-prepared", { aggregateSaveStatus: saved.status, totals: businessValues(before).totals });
      } finally {
        const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
        expect(released.status).toBe(200);
      }
      fixture.prepared = true;
      await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n");
    }
    expect(businessValues(before).totals).toEqual([5000, 1000, 6000]);
    const destination = `/dashboard/affaires/${fixture.projectId}`;
    const samples = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
      await screen.getByRole("searchbox", "Rechercher par nom ou client…", { exact: true }).fill(fixture.projectName);
      const card = browser.locator(`main a[href="${destination}"]`).first();
      await expect(card).toBeVisible();
      await browser.evaluate(({ destination, heading }) => {
        type Probe = { start: number | null; headingAt: number | null; loadingAt: number | null };
        const probe: Probe = { start: null, headingAt: null, loadingAt: null };
        const view = window as Window & { __armyAffaireLoading?: Probe; __armyAffaireObserver?: MutationObserver };
        view.__armyAffaireObserver?.disconnect();
        view.__armyAffaireLoading = probe;
        const observer = new MutationObserver(() => {
          if (probe.start === null) return;
          if (probe.loadingAt === null && Array.from(document.querySelectorAll('[role="status"]')).some((node) =>
            node.getClientRects().length && /Chargement/.test(node.textContent ?? "")
          )) probe.loadingAt = performance.now();
          if (location.pathname === destination && Array.from(document.querySelectorAll("h1,h2")).some((node) =>
            node.getClientRects().length && node.textContent?.trim() === heading
          )) requestAnimationFrame(() => requestAnimationFrame(() => { probe.headingAt ??= performance.now(); }));
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        view.__armyAffaireObserver = observer;
        const capture = (event: MouseEvent) => {
          const anchor = event.target instanceof Element ? event.target.closest("a[href]") as HTMLAnchorElement | null : null;
          if (anchor && new URL(anchor.href).pathname === destination) {
            probe.start = performance.now();
            document.removeEventListener("click", capture, true);
          }
        };
        document.addEventListener("click", capture, true);
        return null;
      }, { destination, heading: fixture.projectName });
      await card.tap();
      await expect(browser).toHaveURL(destination);
      await expect(screen.getByRole("heading", fixture.projectName, { exact: true })).toBeVisible();
      await expect(browser.locator("#financial")).toContainText(/50,00\s*€/);
      await expect(browser.locator(`#financial a[href^="/dashboard/estimates/${fixture.versionId}/edit"]`)).toBeVisible();
      await expect(screen.getByRole("heading", "Versions", { exact: true })).toBeVisible();
      await expect.poll(() => browser.evaluate(() => Boolean((window as Window & {
        __armyAffaireLoading?: { headingAt: number | null };
      }).__armyAffaireLoading?.headingAt))).toBe(true);
      const sample = await browser.evaluate(() => {
        const probe = (window as Window & { __armyAffaireLoading?: {
          start: number | null; headingAt: number | null; loadingAt: number | null;
        } }).__armyAffaireLoading;
        if (!probe || probe.start === null || probe.headingAt === null) throw new Error("Affaire timing is incomplete.");
        const start = probe.start;
        return { clickToHeadingMs: probe.headingAt - start,
          clickToLoadingMs: probe.loadingAt === null ? null : probe.loadingAt - start,
          resources: (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
            .filter((resource) => resource.startTime >= start && resource.initiatorType === "fetch")
            .map((resource) => ({ path: new URL(resource.name).pathname, durationMs: resource.duration,
              startAfterClickMs: resource.startTime - start,
              firstByteWaitMs: resource.responseStart ? resource.responseStart - resource.startTime : null })),
        };
      });
      samples.push({ repeat, ...sample });
      await browser.locator('nav[aria-label="Navigation globale"] a[href="/dashboard/affaires"]').tap();
    }
    await app.open(destination);
    await expect(screen.getByRole("heading", fixture.projectName, { exact: true })).toBeVisible();
    const after = await readEstimate(browser, fixture.versionId);
    expect(businessValues(after)).toEqual(businessValues(before));
    await recordEvidence(army, "loading-values", { before: businessValues(before), after: businessValues(after),
      approvalReadSideEffects: "owned projection/audit allowed; financial/status/item values checked independently" });
    await mkdir(metricsPath, { recursive: true });
    await writeFile(path.join(metricsPath, "affaire-loading.json"), JSON.stringify({
      fixture, samples, financialAndItemValuesUnchanged: true, reloaded: true,
      environment: "owned isolated production; desktop native CPU/network; actual backend; same retained new ARMY draft",
      measurementLimits: "Heading includes two animation frames; only completed post-click requests; first-byte wait excludes later stream work; uncontrolled backend/server cold state; no field percentile claim",
    }, null, 2) + "\n");
  }
);

test(
  "affaire loading: anonymous requests after an authenticated render stay isolated",
  { tags: ["affaire-performance"], requires: ["browser"], timeout: 90_000 },
  async ({ app, browser, screen }) => {
    const fixture = await retainedFixture();
    if (!fixture) throw new Error("Missing owned fixture: request-isolation proof is unavailable.");
    await app.open("/login");
    const denial = await browser.evaluate(async (versionId) => {
      const response = await fetch(`/api/estimates/${versionId}`, { credentials: "omit" });
      const body = await response.json();
      return { status: response.status, code: body.error?.code, ok: body.ok };
    }, fixture.versionId);
    expect(denial).toEqual({ status: 401, code: "UNAUTHORIZED", ok: false });
    await app.open(`/dashboard/affaires/${fixture.projectId}`);
    await expect(browser).toHaveURL("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
    await mkdir(metricsPath, { recursive: true });
    await writeFile(path.join(metricsPath, "request-isolation.json"), JSON.stringify({
      fixture: { projectId: fixture.projectId, versionId: fixture.versionId }, denial,
      dashboardRedirect: "/login", context: "fresh anonymous browser after authenticated test",
    }, null, 2) + "\n");
  }
);
