import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyEstimate } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "../local/calculation-gate-support";
import { assertOwnedLocalBackend } from "../local/legacy-v1-draft-support";

const receiptPath = path.resolve(".e2e/army/performance/fixtures/remaining-affaire.json");
const metricsPath = path.resolve(".e2e/army/performance/artifacts/metrics/remaining-affaire.json");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const totals = [2_502_500, 500_500, 3_003_000];
const assumption = "ARMY performance assumption";
const missingPiece = "ARMY performance missing document";

type Receipt = {
  projectId: string; versionId: string; projectName: string; runPrefix: string;
  tenantId: string; userId: string; sectionId: string; assumptionId: string; missingPieceId: string;
  backendOrigin: string;
};
type ServerFetch = {
  startedAt: number; endedAt: number; method: string; path: string;
  query?: Record<string, string | null>; status?: number; headerElapsedMs?: number;
};

function localOwnership() {
  assertOwnedLocalBackend();
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  if (process.env.E2E_DOGFOOD_OWNED_STACK !== "1" || process.env.E2E_COVERAGE_BACKEND_ORIGIN !== origin) {
    throw new Error("Remaining affaire performance requires its explicitly owned disposable stack.");
  }
  return origin;
}

async function retainedReceipt(): Promise<Receipt | null> {
  const origin = localOwnership();
  try {
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Receipt;
    if (receipt.backendOrigin !== origin || !receipt.runPrefix?.startsWith("ARMY-") ||
      receipt.projectName !== `${receipt.runPrefix} remaining affaire` ||
      ![receipt.projectId, receipt.versionId, receipt.tenantId, receipt.userId, receipt.sectionId,
        receipt.assumptionId, receipt.missingPieceId].every((value) => uuid.test(value))) {
      throw new Error("The retained affaire is not this stack's owned performance fixture.");
    }
    return receipt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function businessSnapshot(estimate: ArmyEstimate) {
  const items = estimate.items.map((item) => ({ id: item.id, parentId: item.parent_id, type: item.item_type,
    position: item.position, title: item.title, quantity: item.quantity, unitPrice: item.unit_price_ht_cents,
    ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { projectId: estimate.project.id, projectName: estimate.project.name, versionId: estimate.version.id,
    title: estimate.version.title, status: estimate.version.status, engine: estimate.version.calc_engine_version,
    totals: [estimate.version.total_ht_cents, estimate.version.total_tax_cents, estimate.version.total_ttc_cents],
    lineCount: items.filter((item) => item.type === "line").length,
    itemValuesSha256: createHash("sha256").update(JSON.stringify(items)).digest("hex") };
}

async function serverFetches(from: number, to: number) {
  const log = process.env.E2E_DOGFOOD_FETCH_LOG ?? process.env.E2E_DOGFOOD_SERVER_NETWORK_LOG;
  if (!log) throw new Error("The server-fetch probe is required to profile repeated affaire reads.");
  const entries = (await readFile(log, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as ServerFetch)
    .filter((entry) => entry.startedAt >= from && entry.startedAt <= to);
  const gateReads = entries.filter((entry) => entry.method === "GET" && entry.path === "/rest/v1/affaire_register_entries" &&
    entry.query?.select?.includes("source_file_name") && !entry.query.select.includes("created_by_profile"));
  const accessReads = entries.filter((entry) => entry.method === "GET" && entry.path === "/rest/v1/estimate_projects" &&
    entry.query?.select?.replaceAll(" ", "") === "id,tenant_id,user_id,name,reference,client_name,is_archived");
  return { entries, gateReadCount: gateReads.length, registerProjectAccessReadCount: accessReads.length };
}

async function armClick(browser: Browser, destination: string, heading: string) {
  await browser.evaluate(({ destination, heading }) => {
    const view = window as typeof window & { __armyRemainingAffaireProbe?: {
      startedAt: number | null; start: number | null; paintedAt: number | null;
    }; __armyRemainingAffaireObserver?: MutationObserver };
    view.__armyRemainingAffaireObserver?.disconnect();
    const probe = { startedAt: null as number | null, start: null as number | null, paintedAt: null as number | null };
    view.__armyRemainingAffaireProbe = probe;
    const observe = new MutationObserver(() => {
      if (probe.start === null || probe.paintedAt !== null || location.pathname !== destination ||
        !Array.from(document.querySelectorAll("h1,h2")).some((node) => node.getClientRects().length && node.textContent?.trim() === heading)) return;
      requestAnimationFrame(() => requestAnimationFrame(() => { probe.paintedAt ??= performance.now(); }));
    });
    observe.observe(document.body, { subtree: true, childList: true, attributes: true });
    view.__armyRemainingAffaireObserver = observe;
    const capture = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (anchor && new URL(anchor.href).pathname === destination) {
        probe.startedAt = Date.now(); probe.start = performance.now(); document.removeEventListener("click", capture, true);
      }
    };
    document.addEventListener("click", capture, true);
    return null;
  }, { destination, heading });
}

// Failure oracles, cache lifetime, write-bearing approval reads and exact fixture boundaries are
// defined before application changes in docs/testing/dogfood-affaire-remaining-failures.md.
armyTest("remaining affaire performance: 1000 real lines, register freshness and five transitions",
  { tags: ["performance", "remaining-performance", "remaining-affaire"], session: "army", requires: ["browser"], timeout: 300_000 },
  async ({ app, browser, screen, army }) => {
    const backendOrigin = localOwnership();
    await app.open("/dashboard/affaires");
    let receipt = await retainedReceipt();
    if (!receipt) {
      const projectName = `${army.runPrefix} remaining affaire`;
      const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(
        browser, "POST", "/api/estimates", { project: { name: projectName, client_name: "ARMY performance" },
          version: { title: "ARMY real 1000-line performance", expected_calc_engine_version: 2,
            margin_multiplier: 1, margin_mode: "fixed", discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", max_section_depth: 1 } });
      expect(created.status).toBe(201);
      expect(created.body.ok).toBe(true);
      const projectId = created.body.data.project.id, versionId = created.body.data.version.id;
      ownEstimate(army, { projectId, versionId });
      const beforeSeed = await readEstimate(browser, versionId);
      expect(beforeSeed.project.name).toBe(projectName);
      expect(beforeSeed.version.calc_engine_version).toBe(2);
      expect(beforeSeed.items.filter((item) => item.item_type === "line")).toHaveLength(0);
      const owner = await ownedEstimateContext(projectId);
      const sectionId = beforeSeed.items.find((item) => item.item_type === "section" && item.parent_id === null)?.id ?? randomUUID();
      receipt = { projectId, versionId, projectName, runPrefix: army.runPrefix, tenantId: owner.tenantId,
        userId: owner.userId, sectionId, assumptionId: randomUUID(), missingPieceId: randomUUID(), backendOrigin };
      if (![projectId, versionId, sectionId, receipt.assumptionId, receipt.missingPieceId].every((id) => uuid.test(id))) throw new Error("Invalid seeded identity.");
      await querySql(`INSERT INTO public.estimate_items(id, tenant_id, version_id, item_type, position, title)
SELECT '${sectionId}', v.tenant_id, v.id, 'section', 1, 'ARMY performance section' FROM public.estimate_versions v
JOIN public.estimate_projects p ON p.id = v.project_id WHERE v.id = '${versionId}' AND p.id = '${projectId}'
AND p.tenant_id = '${owner.tenantId}' AND p.user_id = '${owner.userId}' AND v.calc_engine_version = 2
ON CONFLICT(id) DO UPDATE SET title = EXCLUDED.title;`);
      for (let from = 1; from <= 1000; from += 250) {
        await querySql(`INSERT INTO public.estimate_items(tenant_id, version_id, parent_id, item_type, position, title,
description, quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo, pu_ht_cents,
line_total_ht_cents, line_tax_cents, line_total_ttc_cents)
SELECT s.tenant_id, s.version_id, s.id, 'line', n, 'ARMY performance line ' || n, 'u', 1, 5*n, 2000, 1, 0, 1, 1,
5*n, 5*n, n, 6*n FROM public.estimate_items s CROSS JOIN generate_series(${from}, ${from + 249}) AS n
WHERE s.id = '${sectionId}' AND s.version_id = '${versionId}' AND s.tenant_id = '${owner.tenantId}';`);
      }
      await querySql(`BEGIN;
UPDATE public.estimate_versions SET total_ht_cents = ${totals[0]}, total_tax_cents = ${totals[1]}, total_ttc_cents = ${totals[2]}
WHERE id = '${versionId}' AND project_id = '${projectId}' AND calc_engine_version = 2 AND status = 'draft';
INSERT INTO public.affaire_register_entries(id, tenant_id, project_id, kind, text, severity, status, scope_type, scope_label, created_by, updated_by)
VALUES ('${receipt.assumptionId}', '${owner.tenantId}', '${projectId}', 'assumption', '${assumption}', 'warning', 'open', 'project', 'Affaire', '${owner.userId}', '${owner.userId}'),
('${receipt.missingPieceId}', '${owner.tenantId}', '${projectId}', 'missing_piece', '${missingPiece}', 'critical', 'open', 'project', 'Affaire', '${owner.userId}', '${owner.userId}');
INSERT INTO public.affaire_register_events(tenant_id, project_id, entry_id, actor_user_id, event_type, reason)
VALUES ('${owner.tenantId}', '${projectId}', '${receipt.assumptionId}', '${owner.userId}', 'created', 'ARMY performance fixture'),
('${owner.tenantId}', '${projectId}', '${receipt.missingPieceId}', '${owner.userId}', 'created', 'ARMY performance fixture');
COMMIT;`);
      await mkdir(path.dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    }
    army.runPrefix = receipt.runPrefix; army.projectName = receipt.projectName; ownEstimate(army, receipt);
    const owner = await ownedEstimateContext(receipt.projectId);
    expect([owner.tenantId, owner.userId]).toEqual([receipt.tenantId, receipt.userId]);
    const before = businessSnapshot(await readEstimate(browser, receipt.versionId));
    expect(before.lineCount).toBe(1000); expect(before.totals).toEqual(totals); expect(before.status).toBe("draft");
    const destination = `/dashboard/affaires/${receipt.projectId}`;
    const samples = [];
    for (let repeat = 0; repeat < 5; repeat += 1) {
      await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
      await screen.getByRole("searchbox", "Rechercher par nom ou client…", { exact: true }).fill(receipt.projectName);
      const card = browser.locator(`main a[href="${destination}"]`).first();
      await expect(card).toBeVisible();
      await armClick(browser, destination, receipt.projectName);
      await card.tap();
      await expect(screen.getByRole("heading", receipt.projectName, { exact: true })).toBeVisible();
      await expect(browser.locator("#financial")).toContainText(/25\s?025,00\s*€/);
      await expect(browser.locator(`#financial a[href^="/dashboard/estimates/${receipt.versionId}/edit"]`)).toBeVisible();
      await expect(screen.getByRole("heading", "Versions", { exact: true })).toBeVisible();
      await expect(browser.locator("#register")).toContainText(assumption);
      await expect(browser.locator("#register")).toContainText(missingPiece);
      await expect(browser.locator("#register article").filter({ hasText: "Points ouverts" }).getByText("2", { exact: true })).toHaveText("2");
      await expect.poll(() => browser.evaluate(() => Boolean((window as typeof window & {
        __armyRemainingAffaireProbe?: { paintedAt: number | null } }).__armyRemainingAffaireProbe?.paintedAt))).toBe(true);
      const probe = await browser.evaluate(() => {
        const probe = (window as typeof window & { __armyRemainingAffaireProbe?: {
          startedAt: number | null; start: number | null; paintedAt: number | null } }).__armyRemainingAffaireProbe;
        if (probe?.startedAt == null || probe.start == null || probe.paintedAt == null) throw new Error("The affaire click probe is incomplete.");
        return { startedAt: probe.startedAt, clickToHeadingMs: probe.paintedAt - probe.start };
      });
      const checkedAt = Date.now();
      samples.push({ repeat, ...probe, checkedAt, server: await serverFetches(probe.startedAt, checkedAt) });
      await browser.locator('nav[aria-label="Navigation globale"] a[href="/dashboard/affaires"]').tap();
    }
    // A fresh request must observe a change after previous authenticated renders. Restore only our
    // own entry in finally, so a failed assertion does not contaminate the next comparison.
    try {
      await querySql(`UPDATE public.affaire_register_entries SET text = '${assumption} refreshed', status = 'validated'
WHERE id = '${receipt.assumptionId}' AND project_id = '${receipt.projectId}' AND tenant_id = '${receipt.tenantId}';`);
      await app.open(destination);
      await expect(browser.locator("#register")).toContainText(`${assumption} refreshed`);
      await expect(browser.locator("#register article").filter({ hasText: "Points ouverts" }).getByText("1", { exact: true })).toHaveText("1");
    } finally {
      await querySql(`UPDATE public.affaire_register_entries SET text = '${assumption}', status = 'open'
WHERE id = '${receipt.assumptionId}' AND project_id = '${receipt.projectId}' AND tenant_id = '${receipt.tenantId}';`);
    }
    await app.open(destination);
    await expect(browser.locator("#register article").filter({ hasText: "Points ouverts" }).getByText("2", { exact: true })).toHaveText("2");
    const after = businessSnapshot(await readEstimate(browser, receipt.versionId));
    expect(after).toEqual(before);
    await recordEvidence(army, "remaining-affaire-values", { before, after, registerFreshness: true,
      allowedReadSideEffects: "owned approval projection and audit only; financial and item snapshot checked separately" });
    await mkdir(path.dirname(metricsPath), { recursive: true });
    await writeFile(metricsPath, JSON.stringify({ receipt, samples, before, after, registerFreshness: true,
      limits: "Local owned backend, native Mac CPU/network, five client transitions; completed server fetch headers, not complete response-body timings or field percentiles." }, null, 2) + "\n");
  });

test("remaining affaire performance: a fresh anonymous context stays isolated",
  { tags: ["performance", "remaining-performance", "remaining-affaire"], requires: ["browser"], timeout: 90_000 },
  async ({ app, browser, screen }) => {
    const receipt = await retainedReceipt();
    if (!receipt) throw new Error("Missing owned remaining-affaire fixture.");
    await app.open("/login");
    const denial = await browser.evaluate(async (versionId) => {
      const response = await fetch(`/api/estimates/${versionId}`, { credentials: "omit" });
      const body = await response.json();
      return { status: response.status, ok: body.ok, code: body.error?.code };
    }, receipt.versionId);
    expect(denial).toEqual({ status: 401, ok: false, code: "UNAUTHORIZED" });
    await app.open(`/dashboard/affaires/${receipt.projectId}`);
    await expect(browser).toHaveURL("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
  });
