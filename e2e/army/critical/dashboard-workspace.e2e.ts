import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { measure } from "../performance/measure";
import { armyTest, recordEvidence, type ArmyState } from "./fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "dashboard-workspace"], timeout: 180_000 };

async function dashboardFixture(browser: Browser, baseUrl: string, army: ArmyState, count: number) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !backend.port ||
      ["45585", "33485"].includes(backend.port) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Dashboard fixtures require the campaign's owned native stack.");
  }
  const owner = await signUpDedicatedOwner(browser, baseUrl, army.runPrefix, { tag: "DASH" });
  const admin = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const projects = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(), versionId: randomUUID(), name: `ARMY Dashboard ${String(index + 1).padStart(4, "0")}`,
    updatedAt: new Date(Date.UTC(2026, 10, 9, 12) - index * 60_000).toISOString(),
    status: index >= count - 2 ? "accepted" : index >= count - 5 ? "sent" : "draft",
  }));
  if (projects.length) {
    const created = await admin.from("estimate_projects").insert(projects.map(project => ({
      id: project.id, name: project.name, tenant_id: owner.tenantId, user_id: owner.userId,
      client_name: "ARMY Habitat", reference: `DASH-${project.name.slice(-4)}`, updated_at: project.updatedAt,
    })));
    if (created.error) throw new Error(`Dashboard project fixtures failed: ${created.error.code}`);
    const versions = await admin.from("estimate_versions").insert(projects.map(project => ({
      id: project.versionId, project_id: project.id, tenant_id: owner.tenantId,
      version_number: 1, status: project.status, calc_engine_version: 2, updated_at: project.updatedAt,
    })));
    if (versions.error) throw new Error(`Dashboard version fixtures failed: ${versions.error.code}`);
    // These two statements fill tables the planner last saw with 1 and 0 rows. Until autovacuum's next pass, up to
    // a minute later, the whole shard plans its row policies for empty tables: a line creation of the journey
    // running beside DASH01 took 11 s and Postgres cut it at its 8 s limit (57014, pull request #230).
    await querySql("analyze public.estimate_projects; analyze public.estimate_versions;");
    army.ownedEstimates.push(...projects.map(project => ({ projectId: project.id, versionId: project.versionId })));
  }
  await recordEvidence(army, "dashboard-prerequisites", { count, tenantId: owner.tenantId,
    distribution: { draft: Math.max(0, count - 5), sent: Math.min(3, count), accepted: Math.min(2, count) },
    purpose: "Owned metadata fixtures only; browser reads use the ordinary authenticated account." });
  return { admin, owner, projects };
}

armyTest("DASH01 dashboard initial load stays bounded with 999 affaires", options, async ({ app, browser, screen, army }) => {
  const { projects } = await dashboardFixture(browser, app.baseUrl!, army, 999);
  await browser.setViewport({ width: 1440, height: 900 });
  await browser.addInitScript(() => {
    const state = { contentPaintMs: 0, lcp: null as { time: number; size: number; renderTime: number; tag: string; text: string } | null };
    (window as typeof window & { __dashboardPaint: typeof state }).__dashboardPaint = state;
    const observer = new MutationObserver(() => {
      const ids = [...document.querySelectorAll('main a[href^="/dashboard/affaires/"]')]
        .map(link => link.getAttribute("href")).filter(href => /\/affaires\/[0-9a-f-]{36}$/.test(href ?? ""));
      if (new Set(ids).size < 5) return;
      observer.disconnect();
      const visibleFrame = (time: number) => {
        const links = [...document.querySelectorAll('main a[href^="/dashboard/affaires/"]')]
          .filter(link => /\/affaires\/[0-9a-f-]{36}$/.test(link.getAttribute("href") ?? ""));
        const visible = links.every(link => {
          if (!link.getBoundingClientRect().width || !link.getBoundingClientRect().height) return false;
          for (let node: Element | null = link; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
          }
          return true;
        });
        if (visible) state.contentPaintMs = time;
        else requestAnimationFrame(visibleFrame);
      };
      requestAnimationFrame(visibleFrame);
    });
    observer.observe(document, { childList: true, subtree: true });
    new PerformanceObserver(list => {
      const entry = list.getEntries().at(-1) as (PerformanceEntry & { element?: Element; size: number; renderTime: number }) | undefined;
      if (entry) state.lcp = { time: entry.startTime, size: entry.size, renderTime: entry.renderTime,
        tag: entry.element?.tagName ?? "", text: entry.element?.textContent?.slice(0, 160) ?? "" };
    }).observe({ type: "largest-contentful-paint", buffered: true });
  });
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat += 1) {
    const start = Date.now();
    await app.open("/dashboard");
    await expect(screen.getByRole("heading", "Accueil", { exact: true })).toBeVisible();
    await expect(browser.locator(`main a[href="/dashboard/affaires/${projects[0].id}"]`)).toBeVisible();
    const readyMs = Date.now() - start;
    const rows = await browser.evaluate(() => [...document.querySelectorAll('main a[href^="/dashboard/affaires/"]')]
      .map(link => link.getAttribute("href")).filter(href => /\/affaires\/[0-9a-f-]{36}$/.test(href ?? "")));
    expect(new Set(rows).size).toBe(5);
    await browser.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => undefined)));
      return true;
    });
    const metrics = await measure(browser);
    const paint = await browser.evaluate(() => (window as typeof window & {
      __dashboardPaint: { contentPaintMs: number; lcp: { time: number; size: number; renderTime: number; tag: string; text: string } | null };
    }).__dashboardPaint);
    expect(paint.contentPaintMs).toBeGreaterThan(0);
    samples.push({ repeat, readyMs, metrics, paint });
    if (repeat === 0) await app.screenshot("dashboard-desktop");
  }
  await recordEvidence(army, "dashboard-performance", {
    corpus: "999 affaires: 994 drafts, 3 sent, 2 accepted; fixed descending timestamps; no estimate lines",
    environment: "Owned local production build; desktop CPU/network; first browser visit then six warm-cache visits",
    interpretation: "readyMs includes runner observation overhead; local samples are not hosted production percentiles",
    samples,
  });
});

armyTest("DASH02 dashboard tabs paginate the whole authorized portfolio and preserve navigation", options, async ({ app, browser, screen, army }) => {
  const { admin, owner, projects } = await dashboardFixture(browser, app.baseUrl!, army, 31);
  const foreignTenantId = randomUUID();
  const foreign = await admin.from("tenants").insert({ id: foreignTenantId, name: `${army.runPrefix}-foreign`, slug: `army-${randomUUID()}` });
  if (foreign.error) throw new Error(`Foreign dashboard tenant seed failed: ${foreign.error.code}`);
  const hidden = await admin.from("estimate_projects").insert([
    { name: "ARMY Dashboard foreign", tenant_id: foreignTenantId, user_id: owner.userId, is_archived: false },
    { name: "ARMY Dashboard archived", tenant_id: owner.tenantId, user_id: owner.userId, is_archived: true },
  ]);
  if (hidden.error) throw new Error(`Hidden dashboard projects failed: ${hidden.error.code}`);
  await browser.setViewport({ width: 1440, height: 900 });
  await app.open("/dashboard");
  const tableRows = browser.locator("table tbody tr");
  const filters = screen.getByRole("navigation", "Filtrer les affaires", { exact: true });
  await expect(tableRows).toHaveCount(5);
  await expect(filters.getByRole("link", "Récentes", { exact: true })).toHaveAttribute("aria-current", "page");
  await expect(filters.getByRole("link", "Toutes 31", { exact: true })).toBeVisible();
  await expect(filters.getByRole("link", "Brouillons 26", { exact: true })).toBeVisible();
  await expect(filters.getByRole("link", "Envoyées 3", { exact: true })).toBeVisible();
  await expect(filters.getByRole("link", "Acceptées 2", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", projects[26].name, { exact: true })).toHaveCount(0);
  await filters.getByRole("link", "Envoyées 3", { exact: true }).press("Enter");
  await expect(browser).toHaveURL("/dashboard?view=sent");
  await expect(tableRows).toHaveCount(3);
  for (const item of projects.slice(26, 29)) await expect(screen.getByRole("link", item.name, { exact: true })).toBeVisible();
  await expect(filters.getByRole("link", "Toutes 31", { exact: true })).toBeVisible();
  await filters.getByRole("link", "Toutes 31", { exact: true }).tap();
  await expect(browser).toHaveURL("/dashboard?view=all");
  await expect(tableRows).toHaveCount(20);
  const firstPage = await browser.evaluate(() => [...document.querySelectorAll("table tbody tr")].map(row => row.textContent));
  await screen.getByRole("link", "Suivante", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard\?view=all&after=/);
  await expect(tableRows).toHaveCount(11);
  await expect(screen.getByRole("link", projects[20].name, { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", projects[0].name, { exact: true })).toHaveCount(0);
  const secondPageUrl = await browser.url();
  await browser.reload();
  await expect(tableRows).toHaveCount(11);
  await screen.getByRole("link", "Précédente", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard\?view=all&before=/);
  await expect(tableRows).toHaveCount(20);
  expect(await browser.evaluate(() => [...document.querySelectorAll("table tbody tr")].map(row => row.textContent))).toEqual(firstPage);
  await app.open(secondPageUrl);
  await screen.getByRole("link", projects[20].name, { exact: true }).tap();
  await expect(browser).toHaveURL(`/dashboard/affaires/${projects[20].id}`);
  await app.back();
  await expect(browser).toHaveURL(secondPageUrl);
  await expect(tableRows).toHaveCount(11);
  // The dashboard intentionally omits the resume card; back navigation still preserves the page.
  await expect(screen.getByRole("link", "Reprendre", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("link", "ARMY Dashboard foreign", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("link", "ARMY Dashboard archived", { exact: true })).toHaveCount(0);
  await filters.getByRole("link", "Acceptées 2", { exact: true }).tap();
  await expect(tableRows).toHaveCount(2);
  for (const item of projects.slice(29)) await expect(screen.getByRole("link", item.name, { exact: true })).toBeVisible();
  await filters.getByRole("link", "Brouillons 26", { exact: true }).tap();
  await expect(tableRows).toHaveCount(20);
  await screen.getByRole("link", "Suivante", { exact: true }).tap();
  await expect(tableRows).toHaveCount(6);
  await recordEvidence(army, "dashboard-tabs", { total: 31, recent: 5, pageSizes: [20, 11], drafts: [20, 6], sent: 3, accepted: 2,
    foreignAndArchivedExcluded: true, directPageAndBack: true, keyboardActivation: true });
});

armyTest("DASH03 empty dashboard keeps filters, keyboard access and a recoverable error", options, async ({ app, browser, screen, army }) => {
  await dashboardFixture(browser, app.baseUrl!, army, 0);
  await app.open("/dashboard");
  await expect(screen.getByRole("heading", "Aucune affaire pour le moment", { exact: true })).toBeVisible();
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await browser.route("**/dashboard?**", async route => {
    if (route.request.method === "GET" && new URL(route.request.url).searchParams.get("view") === "sent") await gate;
    await route.fallback();
  });
  try {
    await screen.getByRole("navigation", "Filtrer les affaires", { exact: true }).getByRole("link", "Envoyées 0", { exact: true }).press("Enter");
    await expect(screen.getByRole("status")).toContainText("Chargement");
    await expect(browser.locator('[aria-busy="true"]')).toBeVisible();
  } finally {
    release();
  }
  await expect(browser).toHaveURL("/dashboard?view=sent");
  await expect(screen.getByRole("heading", "Aucune affaire dans ce statut", { exact: true })).toBeVisible();
  await app.open("/dashboard?view=all&after=invalid");
  await expect(screen.getByRole("heading", "Cette page n’a pas pu être chargée", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Réessayer", { exact: true })).toBeVisible();
  await screen.getByRole("link", "Retour à l’accueil", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Accueil", { exact: true })).toBeVisible();
  await app.open("/dashboard?view=unknown&after=invalid");
  await expect(screen.getByRole("heading", "Aucune affaire pour le moment", { exact: true })).toBeVisible();
  await browser.setViewport({ width: 983, height: 558 });
  await app.screenshot("dashboard-integrated-browser");
  await browser.setViewport({ width: 390, height: 844 });
  await app.screenshot("dashboard-mobile-empty");
  const dimensions = await browser.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
  await recordEvidence(army, "dashboard-empty", { dimensions, errorRecovery: true, malformedViewFallsBackToRecent: true });
});
