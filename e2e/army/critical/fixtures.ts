import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type Browser } from "@e2e-dev/web";
import { expect, type App, type JsonValue, type Screen } from "e2e";

import { sdkResultsRoot } from "../local/sdk-results";
import { allowsOwnedPurchaseRead, type OwnedPurchaseOrder } from "./owned-purchase-reads";

export type OwnedEstimate = { projectId: string; versionId: string };
export type ArmyState = {
  runPrefix: string;
  projectName: string;
  ownedEstimates: OwnedEstimate[];
  ownedPlanSets?: Array<{ projectId: string; planSetId: string; tenantId: string }>;
  ownedPriceLookupProjects?: string[];
  ownedPurchaseOrders?: OwnedPurchaseOrder[];
};
export type ArmyItem = {
  id: string;
  item_type: "section" | "line";
  parent_id: string | null;
  position: number;
  title: string;
  quantity: number | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
  [key: string]: unknown;
};
export type ArmyVersion = {
  id: string;
  project_id: string;
  title: string | null;
  status: string;
  updated_at: string;
  // Exigée par tout PATCH du devis : la révision de contenu lue avant l'écriture.
  content_revision: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  max_section_depth: number;
  margin_multiplier: number;
  margin_mode: string;
  margin_bp: number | null;
  discount_bp: number;
  tax_rate_bp: number;
  currency: string;
  rounding_mode: string;
  rounding_step_cents: number;
  estimate_projects: { id: string; name: string };
  [key: string]: unknown;
};
export type ArmyEstimate = {
  project: { id: string; name: string };
  version: ArmyVersion;
  items: ArmyItem[];
};
type Ui = { app: App; screen: Screen; browser: Browser };
type ApiEnvelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };

export async function restrictCriticalBrowser(browser: Browser, app: App, army?: ArmyState) {
  const origin = new URL(app.baseUrl!).origin;
  const supabaseOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
  await browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && route.request.method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    const readOnly = ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
    const auth = url.origin === supabaseOrigin && url.pathname.startsWith("/auth/v1/");
    // The affaire fiche's delivery-site selector reads this existing RLS-protected
    // lookup directly. Allow only that read in the explicit hub campaigns.
    const performanceLookup = ["performance", "coverage"].includes(process.env.E2E_ARMY_SUITE ?? "") && readOnly &&
      url.origin === supabaseOrigin && url.pathname === "/rest/v1/delivery_sites";
    const localBackend = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      url.hostname === process.env.E2E_ALLOWED_SUPABASE_HOST && url.origin === supabaseOrigin;
    const ownedPriceLookup = localBackend && route.request.method === "GET" &&
      (army?.ownedPriceLookupProjects ?? []).some((projectId) =>
        army?.ownedEstimates.some((estimate) => estimate.projectId === projectId)) &&
      ((url.pathname === "/rest/v1/suppliers" && url.searchParams.get("select")?.replaceAll(" ", "") === "id,name") ||
        (url.pathname === "/rest/v1/products" && url.searchParams.get("select")?.replaceAll(" ", "") === "id,designation,reference"));
    const ownedPlanUpload = localBackend && ["PUT", "OPTIONS"].includes(route.request.method) &&
      (army?.ownedPlanSets ?? []).some((set) =>
        army?.ownedEstimates.some((estimate) => estimate.projectId === set.projectId) &&
        url.pathname.startsWith(`/storage/v1/object/upload/sign/plan-files/${set.tenantId}/${set.planSetId}/`));
    const ownedPurchaseRead = localBackend && allowsOwnedPurchaseRead(
      url, route.request.method, army?.ownedEstimates ?? [], army?.ownedPurchaseOrders ?? [],
    );
    const forbiddenMutation = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
    if ((url.origin !== origin && !auth && !performanceLookup && !ownedPriceLookup && !ownedPlanUpload && !ownedPurchaseRead) || forbiddenMutation) {
      await route.abort();
      const safePath = url.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[id]");
      throw new Error(`Critical campaign blocked ${route.request.method} ${url.hostname}${safePath}; external request or email/status mutation.`);
    }
    await route.continue();
  });
}

export async function recordEvidence(army: ArmyState, label: string, data: unknown) {
  if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Evidence label must be a simple filename.");
  const suite = process.env.E2E_ARMY_SUITE === "coverage" ? "coverage" : process.env.E2E_ARMY_SUITE === "performance" ? "performance" : "critical";
  const directory = path.resolve(`.e2e/army/${suite}/artifacts/business`);
  await mkdir(directory, { recursive: true });
  const body = `${JSON.stringify({
    schemaVersion: "miaouffrage-army-business-1",
    recordedAt: new Date().toISOString(),
    fixturePrefix: army.runPrefix,
    projectName: army.projectName,
    ownedEstimates: army.ownedEstimates,
    ...(army.ownedPurchaseOrders?.length ? { ownedPurchaseOrders: army.ownedPurchaseOrders } : {}),
    data,
  }, null, 2)}\n`;
  const file = path.join(directory, `${army.runPrefix}-${label}.json`);
  await writeFile(file, body);
  return { path: file, sha256: createHash("sha256").update(body).digest("hex") };
}

// web 0.15 identifies the exact download; never search other attempts by filename.
// Resolve real paths so a link outside this run cannot become export evidence.
export async function resolveDownload(download: { absolutePath: string }) {
  expect(path.isAbsolute(download.absolutePath), "SDK download must have an absolute path").toBe(true);
  const root = await realpath(sdkResultsRoot(".e2e/army/critical/results"));
  const file = await realpath(download.absolutePath);
  const relative = path.relative(root, file).split(path.sep).join("/");
  expect(relative.startsWith("../") || path.isAbsolute(relative), "Download must remain inside this run").toBe(false);
  expect(relative, "Download must belong to a retained attempt").toMatch(/^[^/]+\/(?:rerun-\d+\/)?attempt-\d+\/.+/);
  return file;
}

export function ownEstimate(army: ArmyState, estimate: OwnedEstimate) {
  if (!army.ownedEstimates.some((existing) => existing.versionId === estimate.versionId)) {
    army.ownedEstimates.push(estimate);
  }
}

export const armyTest = test.extend<{ army: ArmyState }>({
  army: async ({ app, browser }, provideFixture) => {
    const runPrefix = `ARMY-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const army = { runPrefix, projectName: runPrefix, ownedEstimates: [] };
    await restrictCriticalBrowser(browser, app, army);
    try {
      await provideFixture(army);
    } finally {
      // Keep the IDs even when the business assertion fails. Shared data is retained.
      await recordEvidence(army, "fixtures", { retained: true, cleanup: "none", emails: "none" });
    }
  },
});

export async function apiRequest<T = unknown>(
  browser: Browser,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  pathname: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: T }> {
  if (!pathname.startsWith("/api/") || pathname.startsWith("//")) {
    throw new Error("Business requests must use a same-origin application API.");
  }
  const result = await browser.evaluate(async (request) => {
    const requestHeaders: Record<string, string> = { ...request.headers };
    if (request.body !== null) requestHeaders["content-type"] = "application/json";
    const versionId = request.pathname.match(/^\/api\/estimates\/([0-9a-f-]{36})(?:\/|$)/i)?.[1];
    if (versionId && request.method !== "GET") {
      const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
      const store = scope.__miaouffrageEstimateDraftLockSessions ?? new Map<string, string>();
      scope.__miaouffrageEstimateDraftLockSessions = store;
      let sessionId = store.get(versionId);
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        store.set(versionId, sessionId);
        sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${versionId}`, sessionId);
      }
      requestHeaders["x-estimate-draft-lock-session-id"] ??= sessionId;
    }
    const response = await fetch(request.pathname, {
      method: request.method,
      credentials: "same-origin",
      headers: requestHeaders,
      ...(request.body === null ? {} : { body: request.body }),
    });
    const text = await response.text();
    let payload: JsonValue = null;
    try { payload = JSON.parse(text) as JsonValue; } catch { payload = { invalidJson: true }; }
    return { status: response.status, body: payload };
  }, { method, pathname, body: body === undefined ? null : JSON.stringify(body), headers });
  return result as { status: number; body: T };
}

export async function readEstimate(browser: Browser, versionId: string): Promise<ArmyEstimate> {
  const response = await apiRequest<ApiEnvelope<{ version: ArmyVersion; items: ArmyItem[] }>>(
    browser, "GET", `/api/estimates/${versionId}`
  );
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  const { version, items } = response.body.data;
  return { project: version.estimate_projects, version, items };
}

export async function createEstimateViaWizard(
  { app, screen, browser }: Ui,
  { projectName, title, marginPercent = "0" }: { projectName: string; title: string; marginPercent?: string },
  army: ArmyState
): Promise<OwnedEstimate> {
  if (!projectName.startsWith("ARMY-")) throw new Error("Campaign projects must start with ARMY-.");
  await app.open("/dashboard/estimates/new");
  await expect(screen.getByRole("heading", "Nouveau chiffrage", { exact: true })).toBeVisible();
  await screen.getByLabel(/Nom du projet/).fill(projectName);
  await screen.getByLabel(/Titre de la version/).fill(title);
  await screen.getByRole("button", "Suivant", { exact: true }).tap();
  await expect(screen.getByLabel(/Date devis/)).toBeVisible();
  await screen.getByLabel(/Date devis/).fill("2026-10-02");
  await screen.getByLabel(/Validité/).fill("30");
  await screen.getByRole("button", "Marge fixe", { exact: true }).tap();
  // A fixed margin of N % is stored as the multiplier 1 + N / 100.
  await screen.getByLabel("Marge (%)", { exact: true }).fill(marginPercent);
  await screen.getByLabel("Marge (%)", { exact: true }).press("Tab");
  await screen.getByLabel(/TVA \(%\)/).fill("20");
  await screen.getByLabel(/TVA \(%\)/).press("Tab");
  await screen.getByLabel("Arrondi", { exact: true }).selectOption({ value: "none" });
  await screen.getByRole("button", "Suivant", { exact: true }).tap();
  await expect(screen.getByRole("heading", "Import", { exact: true })).toBeVisible();
  const [created] = await Promise.all([
    browser.waitForResponse("**/api/estimates", { timeout: 60_000 }),
    screen.getByRole("button", /Créer le chiffrage|Creer le chiffrage/).tap(),
  ]);
  expect(created.status).toBe(201);
  const createdBody = await created.json<ApiEnvelope<{ project: { id: string }; version: { id: string } }>>();
  expect(createdBody.ok).toBe(true);
  const ids = { projectId: createdBody.data.project.id, versionId: createdBody.data.version.id };
  ownEstimate(army, ids);
  await recordEvidence(army, "creation-observed", { ...ids, projectName, title, status: created.status });
  await expect(browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/, { timeout: 60_000 });
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible({ timeout: 30_000 });
  const versionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1];
  expect(versionId).toBe(ids.versionId);
  const snapshot = await readEstimate(browser, versionId);
  expect(snapshot.project.name).toBe(projectName);
  expect(snapshot.version.title).toBe(title);
  expect(snapshot.project.id).toBe(ids.projectId);
  return ids;
}

export async function createLineViaApi(
  browser: Browser,
  versionId: string,
  title: string,
  options: Partial<ArmyItem> = {}
): Promise<ArmyItem> {
  const snapshot = await readEstimate(browser, versionId);
  if (!snapshot.project.name.startsWith("ARMY-")) throw new Error("Only ARMY drafts may be seeded.");
  const lock = await apiRequest(browser, "POST", `/api/estimates/${versionId}/lock`);
  expect(lock.status).toBe(201);
  let parentId: string | null = null;
  for (let level = 1; level <= snapshot.version.max_section_depth; level += 1) {
    const section = snapshot.items.find((item) => item.item_type === "section" && item.parent_id === parentId);
    if (section) {
      parentId = section.id;
    } else {
      const response: { status: number; body: ApiEnvelope<{ item: ArmyItem }> } = await apiRequest(browser, "POST", `/api/estimates/${versionId}/items`, {
        item_type: "section", parent_id: parentId, title: `ARMY section ${level}`,
      });
      expect(response.status).toBe(201);
      parentId = response.body.data.item.id;
    }
  }
  const response = await apiRequest<ApiEnvelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`, {
    item_type: "line", parent_id: parentId, title, line_nature: "supply_only",
    quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000,
    k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, ...options,
  });
  expect(response.status).toBe(201);
  return response.body.data.item;
}

export async function setLineCoreValues(
  { screen }: Pick<Ui, "screen" | "browser">,
  title: string,
  values: { quantity: string; unitPriceHt: string }
) {
  await screen.getByLabel(`Quantité pour ${title}`, { exact: true }).fill(values.quantity);
  await screen.getByLabel(`Quantité pour ${title}`, { exact: true }).press("Tab");
  await screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true }).fill(values.unitPriceHt);
  await screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true }).press("Tab");
}

// Line autosave is debounced for 60 s (AUTOSAVE_DEBOUNCE_MS). A journey that does not test
// that cadence flushes its buffered line edits with Ctrl+S, the editor's manual save, and
// still proves persistence with waitForAutoSave: same API predicate, same "Sauvegardé" or
// "À jour" toolbar state. The shortcut does nothing without buffered edits or while the
// draft lock is pending ("Connexion…"), so first wait until the toolbar reports buffered
// edits ("En attente") or a save in flight. If it were still ignored, the 60 s autosave
// would persist the edits within waitForAutoSave's deadline: slower, never weaker. Press it
// from the line's price input, as commercial-rounding.e2e.ts does: the controls that Tab
// reaches next in the row stop keydown propagation before the editor's window listener.
export async function saveLineEditsWithShortcut(
  { screen }: Pick<Ui, "screen">,
  versionId: string,
  lineTitle: string,
  army?: ArmyState
) {
  const syncStatus = screen.getByTestId("estimate-page-toolbar-autosave-status");
  await expect(syncStatus).toHaveText(/^(En attente|Synchronisation…)$/, { timeout: 30_000 });
  const statusBefore = await syncStatus.textContent();
  await screen.getByLabel(`Prix d’achat unitaire HT pour ${lineTitle}`, { exact: true }).press("ControlOrMeta+s");
  if (army) await recordEvidence(army, `save-shortcut-${versionId}`, {
    versionId, trigger: "ControlOrMeta+s", lineTitle, statusBefore,
  });
}

export async function waitForAutoSave(
  { screen, browser }: Pick<Ui, "screen" | "browser">,
  versionId: string,
  predicate: (snapshot: ArmyEstimate) => boolean,
  army?: ArmyState
): Promise<ArmyEstimate> {
  // The current editor deliberately debounces automatic saves for 60 seconds.
  const deadline = Date.now() + 90_000;
  let conflicts = 0;
  const readDuringSave = async () => {
    const response = await apiRequest<ApiEnvelope<{ version: ArmyVersion; items: ArmyItem[] }>>(browser, "GET", `/api/estimates/${versionId}`);
    // A consistent-read guard deliberately refuses a GET spanning a save.
    // Only that named concurrency result is pending; all other errors fail.
    if (response.status === 409 && response.body.error?.code === "VERSION_CONFLICT") {
      conflicts += 1;
      if (army) await recordEvidence(army, `save-read-conflict-${versionId}-${conflicts}`, { versionId, status: response.status, error: response.body.error });
      return null;
    }
    if (army && response.status !== 200) await recordEvidence(army, `save-read-error-${versionId}`, { versionId, response });
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    const { version, items } = response.body.data;
    return { project: version.estimate_projects, version, items };
  };
  let snapshot = await readDuringSave();
  while ((!snapshot || !predicate(snapshot)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const current = await readDuringSave();
    if (current) snapshot = current;
  }
  if (!snapshot) throw new Error("No consistent estimate snapshot was available before the save deadline.");
  if (army) await recordEvidence(army, `save-observed-${versionId}`, {
    predicateMatched: predicate(snapshot),
    versionId, consistentReadConflicts: conflicts, totals: [snapshot.version.total_ht_cents, snapshot.version.total_tax_cents, snapshot.version.total_ttc_cents],
    lines: snapshot.items.filter((item) => item.item_type === "line").map((item) => ({
      id: item.id, title: item.title, quantity: item.quantity, price: item.unit_price_ht_cents,
      ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents,
    })),
  });
  expect(predicate(snapshot)).toBe(true);
  // A separate API read can observe the commit before the editor receives its
  // acknowledgement. Require both persisted values and the actual UI state.
  const syncStatus = screen.getByTestId("estimate-page-toolbar-autosave-status");
  if (army) await recordEvidence(army, `save-ui-before-${versionId}`, {
    versionId, status: await syncStatus.textContent(),
  });
  await expect(syncStatus).toHaveText(/^(Sauvegardé|À jour)$/);
  if (army) await recordEvidence(army, `save-ui-after-${versionId}`, {
    versionId, status: await syncStatus.textContent(),
  });
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  return snapshot;
}
