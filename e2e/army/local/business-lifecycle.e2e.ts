import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { test, type Browser } from "@e2e-dev/web";
import { credentials, expect, secrets, type App, type Screen } from "e2e";

import type { EstimateApprovalSummary } from "../../../src/lib/estimates/rules-engine";
import { apiRequest, readEstimate, recordEvidence, saveLineEditsWithShortcut, waitForAutoSave } from "../critical/fixtures";
import { isOwnedLoopback, requiredFixturePath } from "./owned-business-inputs";

type Actor = { userId: string; tenantId: string; membershipId: string };
type Scenario = { prefix: string; projectId: string; versionId: string; supplierId: string;
  deliverySiteId: string; lines: Array<{ lineId: string; label: string; price: number }> };
type Fixture = { status: string; apiUrl: string; approval: Scenario & { ruleId: string };
  access: Scenario; purchase: Scenario; actors: { engineer: Actor; director: Actor; observer: Actor } };
type Context = { fixture: Fixture; ownedOrders: Set<string>; calls: Array<{ path: string; method: string; action?: string }> };
type Ui = { app: App; browser: Browser; screen: Screen };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Distinct from the common critical guard: named review actions are authorized
// only on this fixture's version, and purchase status updates only on IDs that
// this browser has just created. Sending mail, invitations and portal mutations
// remain forbidden. No service-role credential is loaded by a browser.
const journey = test.extend<{ business: Context }>({
  business: async ({ app, browser }, provide) => {
    const fixture = JSON.parse(await readFile(requiredFixturePath("E2E_BUSINESS_LIFECYCLE_FIXTURE_PATH"), "utf8")) as Fixture;
    expect(fixture.status).toBe("ready");
    expect(fixture.apiUrl).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    expect(isOwnedLoopback(fixture.apiUrl)).toBe(true);
    const context: Context = { fixture, ownedOrders: new Set(), calls: [] };
    const origin = new URL(app.baseUrl!).origin;
    const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
    const actions = new Map(Object.entries(manifest.node).map(([id, value]) => [id, value.exportedName]));
    const ownedVersions = [fixture.approval.versionId, fixture.access.versionId];
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url), method = route.request.method;
      if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && method === "GET") {
        await route.fulfill({ headers: { "content-type": "text/css" }, body: "" }); return;
      }
      const read = ["GET", "HEAD", "OPTIONS"].includes(method);
      const auth = url.origin === fixture.apiUrl && (read && url.pathname === "/auth/v1/user" ||
        method === "POST" && (url.pathname === "/auth/v1/logout" || url.pathname === "/auth/v1/token" &&
          ["password", "refresh_token"].includes(url.searchParams.get("grant_type") ?? "")));
      const lookup = read && url.origin === fixture.apiUrl && ["suppliers", "delivery_sites", "purchase_orders", "purchase_order_items"].some((table) => url.pathname === `/rest/v1/${table}`);
      let allowed = auth || lookup || read && url.origin === origin;
      let payload: Record<string, unknown> | null = null;
      try { const value: unknown = JSON.parse(route.request.postData ?? "null");
        if (value && typeof value === "object" && !Array.isArray(value)) payload = value as Record<string, unknown>;
      } catch { /* Server actions below use their own array envelope. */ }
      const actionName = actions.get(route.request.headers["next-action"] ?? "");
      if (method === "POST" && url.origin === origin && url.pathname === `/dashboard/estimates/${fixture.approval.versionId}` &&
          ["submitEstimateForReviewAction", "decideEstimateApprovalAction", "updateEstimateReviewCorrectionItemStatusAction"].includes(actionName ?? "")) {
        let value: { versionId?: string; projectId?: string } | null = null;
        try { [value] = JSON.parse(route.request.postData ?? "[]"); } catch { /* Refuse malformed action bodies. */ }
        allowed = value?.versionId === fixture.approval.versionId && value?.projectId === fixture.approval.projectId;
      }
      const versionMatch = url.pathname.match(/^\/api\/estimates\/([0-9a-f-]{36})\/(lock|items|approve)$/);
      if (!read && url.origin === origin && versionMatch && ownedVersions.includes(versionMatch[1])) {
        if (versionMatch[2] === "lock") allowed = ["POST", "DELETE"].includes(method);
        if (versionMatch[2] === "items") allowed = method === "PATCH" &&
          [fixture.approval.lines[0].lineId, fixture.access.lines[0].lineId].includes(String(payload?.id));
        // One negative role check: the engineer attempts the same decision the
        // direction will later perform through the UI.
        if (versionMatch[2] === "approve") allowed = versionMatch[1] === fixture.approval.versionId &&
          method === "POST" && payload?.action === "decide" && payload?.decision === "approved";
      }
      if (url.origin === origin && method === "POST" && url.pathname === `/api/estimates/${fixture.approval.versionId}/batch`) {
        const operations = payload?.operations;
        allowed = Array.isArray(operations) && operations.length === 1 && operations.every((operation) => {
          const entry = operation as { op?: string; id?: string; data?: { quantity?: number } };
          return entry.op === "update" && entry.id === fixture.approval.lines[0].lineId && entry.data?.quantity === 3;
        });
      }
      if (url.origin === origin && method === "POST" && url.pathname === `/api/estimates/${fixture.approval.versionId}/items/bulk`) {
        const updates = payload?.updates, totals = payload?.version_patch as Record<string, unknown> | undefined;
        allowed = Array.isArray(updates) && updates.length === 0 && !!totals &&
          Object.keys(totals).length === 3 && totals.total_ht_cents === 3600 && totals.total_tax_cents === 720 && totals.total_ttc_cents === 4320;
      }
      if (url.origin === origin && url.pathname === "/api/purchase-orders" && method === "POST") {
        allowed = payload?.supplierId === fixture.purchase.supplierId && payload?.deliverySiteId === fixture.purchase.deliverySiteId &&
          Array.isArray(payload?.items) && payload.items.every((item) => item && typeof item === "object" &&
            String((item as { designation?: string }).designation).startsWith(fixture.purchase.prefix));
      }
      if (url.origin === fixture.apiUrl && url.pathname === "/rest/v1/purchase_orders" && method === "PATCH") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
        allowed = context.ownedOrders.has(id) && !!payload && Object.keys(payload).length === 1 &&
          ["sent", "confirmed", "received"].includes(String(payload.status));
      }
      if (!allowed) { await route.abort(); throw new Error(`Business lifecycle guard rejected ${method} ${url.hostname}${url.pathname}`); }
      if (!read && !auth) context.calls.push({ path: url.pathname, method, ...(actionName ? { action: actionName } : {}) });
      await route.continue();
    });
    try { await provide(context); }
    finally { await evidence(fixture.purchase, "lifecycle-actions", { calls: context.calls }); }
  },
});

async function evidence(scenario: Scenario, label: string, data: unknown) {
  return recordEvidence({ runPrefix: `${scenario.prefix}-${Date.now()}`, projectName: scenario.prefix,
    ownedEstimates: [{ projectId: scenario.projectId, versionId: scenario.versionId }] }, label, data);
}
async function switchActor(ui: Ui, label: "ENGINEER" | "DIRECTOR" | "OBSERVER", initial = false) {
  // Start the role journeys anonymously: signing out the shared army session
  // would revoke refresh tokens used by unrelated tests in this campaign.
  if (initial) await ui.app.open("/login");
  else {
    await ui.app.open("/dashboard/estimates");
    await ui.screen.getByRole("button", "Se déconnecter", { exact: true }).tap();
  }
  await expect(ui.browser).toHaveURL(/\/login(?:\?|$)/);
  // A visible password toggle proves hydration before submitting credentials.
  await ui.screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
  await expect(ui.screen.getByRole("button", "Masquer le mot de passe", { exact: true })).toBeVisible();
  await ui.screen.getByRole("button", "Masquer le mot de passe", { exact: true }).tap();
  const name = `business-${label.toLowerCase()}`;
  await ui.screen.getByLabel("Email", { exact: true }).fill(secrets.get(`${name}-email`));
  await ui.screen.getByLabel(/Mot de passe/).fill(credentials.user(name).password);
  await ui.screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(ui.browser).toHaveURL(/\/dashboard(?:\/|$)/);
}
async function approvalSummary(browser: Browser, versionId: string) {
  const result = await apiRequest<{ ok: boolean; data: EstimateApprovalSummary }>(browser, "GET", `/api/estimates/${versionId}/approval`);
  expect(result.status).toBe(200); expect(result.body.ok).toBe(true);
  return result.body.data;
}

journey("BIZ01 approval UI separates engineer and direction, corrects and resubmits an exact estimate", {
  tags: ["critical", "local", "business-lifecycle", "approval"], trace: "off", timeout: 300_000,
}, async ({ app, browser, screen, business }) => {
  const { fixture } = business, scenario = fixture.approval, ui = { app, browser, screen };
  const detail = `/dashboard/estimates/${scenario.versionId}`;
  await switchActor(ui, "ENGINEER", true);
  await app.open(detail);
  const initial = await readEstimate(browser, scenario.versionId);
  expect(initial.version.total_ht_cents).toBe(2400);
  await screen.getByRole("button", "Soumettre à validation", { exact: true }).tap();
  await screen.getByLabel("Validateur", { exact: true }).selectOption({ value: fixture.actors.director.userId });
  await screen.getByLabel("Message de contexte", { exact: true }).fill("ARMY vérifier quantité avant validation");
  await screen.getByRole("button", "Confirmer la soumission", { exact: true }).tap();
  await expect.poll(async () => (await approvalSummary(browser, scenario.versionId)).activeCycle?.cycleNumber).toBe(1);
  const pending = await approvalSummary(browser, scenario.versionId);
  expect(pending.activeCycle).toMatchObject({ requestedBy: fixture.actors.engineer.userId,
    assignedReviewer: { userId: fixture.actors.director.userId }, cycleNumber: 1 });
  expect(pending.permissions.canDecide).toBe(false);
  const forbidden = await apiRequest(browser, "POST", `/api/estimates/${scenario.versionId}/approve`, { action: "decide", decision: "approved", comments: [] });
  expect(forbidden.status).toBe(403);
  expect((await approvalSummary(browser, scenario.versionId)).activeCycle?.id).toBe(pending.activeCycle?.id);

  await switchActor(ui, "DIRECTOR");
  await app.open(detail);
  expect((await approvalSummary(browser, scenario.versionId)).permissions.canDecide).toBe(true);
  await screen.getByLabel("Portée", { exact: true }).selectOption({ value: "line" });
  await screen.getByLabel("Cible", { exact: true }).selectOption({ value: scenario.lines[0].lineId });
  await screen.getByLabel("Commentaire", { exact: true }).fill("ARMY corriger la quantité à trois mètres");
  await screen.getByRole("button", "Ajouter le commentaire", { exact: true }).tap();
  await screen.getByRole("button", "Renvoyer en correction", { exact: true }).tap();
  await screen.getByRole("button", "Oui, renvoyer", { exact: true }).tap();
  await expect.poll(async () => (await approvalSummary(browser, scenario.versionId)).reviewHistory[0]?.decision).toBe("changes_requested");
  const rejected = await approvalSummary(browser, scenario.versionId);
  expect(rejected.reviewHistory[0]).toMatchObject({ decidedBy: fixture.actors.director.userId, cycleNumber: 1 });
  expect(rejected.correctionChecklist?.items).toEqual([expect.objectContaining({ scopeId: scenario.lines[0].lineId,
    status: "pending", comment: "ARMY corriger la quantité à trois mètres" })]);

  await switchActor(ui, "ENGINEER");
  await app.open(`${detail}/edit`);
  const title = `${scenario.prefix} ${scenario.lines[0].label}`;
  await screen.getByLabel(`Quantité pour ${title}`, { exact: true }).fill("3");
  await screen.getByLabel(`Quantité pour ${title}`, { exact: true }).press("Tab");
  await saveLineEditsWithShortcut(ui, scenario.versionId, title);
  await waitForAutoSave(ui, scenario.versionId, (snapshot) => snapshot.version.total_ht_cents === 3600);
  await expect.poll(async () => (await readEstimate(browser, scenario.versionId)).version.total_ht_cents).toBe(3600);
  await app.open(detail);
  await screen.getByRole("button", "Marquer corrigé", { exact: true }).tap();
  await expect.poll(async () => (await approvalSummary(browser, scenario.versionId)).correctionChecklist?.allTreated).toBe(true);
  await screen.getByRole("button", "Resoumettre", { exact: true }).tap();
  await screen.getByRole("button", "Confirmer la resoumission", { exact: true }).tap();
  await expect.poll(async () => (await approvalSummary(browser, scenario.versionId)).activeCycle?.cycleNumber).toBe(2);

  await switchActor(ui, "DIRECTOR");
  await app.open(detail);
  await screen.getByRole("button", "Approuver", { exact: true }).tap();
  await expect.poll(async () => (await approvalSummary(browser, scenario.versionId)).reviewHistory[0]?.decision).toBe("approved");
  await browser.reload();
  const accepted = await approvalSummary(browser, scenario.versionId);
  expect(accepted.activeCycle).toBe(null);
  expect(accepted.reviewHistory.map((cycle) => [cycle.cycleNumber, cycle.decision, cycle.decidedBy])).toEqual([
    [2, "approved", fixture.actors.director.userId], [1, "changes_requested", fixture.actors.director.userId],
  ]);
  await switchActor(ui, "ENGINEER");
  await app.open(detail);
  const final = await readEstimate(browser, scenario.versionId);
  expect(final.version).toMatchObject({ total_ht_cents: 3600, total_tax_cents: 720, total_ttc_cents: 4320, status: "draft", approval_status: "approved" });
  expect(final.items.find((item) => item.id === scenario.lines[0].lineId)).toMatchObject({ quantity: 3, unit_price_ht_cents: 1200 });
  await evidence(scenario, "approval-multirole", { initial, pending, rejected, accepted, final, forbiddenStatus: forbidden.status, notificationBoundary: "in-app only; no email address configured" });
});

type OrderItems = { ok: boolean; data: { items: Array<{ id: string; quantity: number; unit_price_ht_cents: number; line_total_ht_cents: number }>;
  orders: Array<{ id: string; status: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number }> } };
async function purchaseState(browser: Browser, id: string) {
  const result = await apiRequest<OrderItems>(browser, "GET", `/api/orders?view=items&order_id=${id}`);
  expect(result.status).toBe(200); return result.body.data;
}
journey("BIZ02 purchase UI creates fractional order and persists its sent confirmed received lifecycle", {
  session: "army", tags: ["critical", "local", "business-lifecycle", "purchase"], trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, business }) => {
  const scenario = business.fixture.purchase;
  await app.open("/dashboard/orders/new");
  await screen.getByLabel("Fournisseur", { exact: true }).selectOption({ value: scenario.supplierId });
  await screen.getByLabel("Chantier de livraison", { exact: true }).selectOption({ value: scenario.deliverySiteId });
  await screen.getByLabel("Désignation, ligne 1", { exact: true }).fill(`${scenario.prefix} cuivre`);
  await screen.getByLabel("Quantité, ligne 1", { exact: true }).fill("12,5");
  await screen.getByLabel("Unité, ligne 1", { exact: true }).fill("m");
  await screen.getByLabel("Prix unitaire HT, ligne 1", { exact: true }).fill("1,23");
  await screen.getByLabel("Instructions complémentaires", { exact: true }).fill(`${scenario.prefix} livraison`);
  const [created] = await Promise.all([browser.waitForResponse("**/api/purchase-orders"),
    screen.getByRole("button", "Créer le bon de commande", { exact: true }).tap()]);
  expect(created.status).toBe(200);
  const receipt = await created.json() as { id: string; reference: string };
  expect(uuid.test(receipt.id)).toBe(true); business.ownedOrders.add(receipt.id);
  await expect(browser).toHaveURL(new RegExp(`/dashboard/orders/${receipt.id}$`));
  const draft = await purchaseState(browser, receipt.id);
  expect(draft.orders).toEqual([expect.objectContaining({ id: receipt.id, status: "draft", total_ht_cents: 1538, total_tax_cents: 308, total_ttc_cents: 1846 })]);
  expect(draft.items).toEqual([expect.objectContaining({ quantity: 12.5, unit_price_ht_cents: 123, line_total_ht_cents: 1538 })]);
  const states = [];
  for (const status of ["sent", "confirmed", "received"]) {
    await screen.getByLabel("Statut de la commande", { exact: true }).selectOption({ value: status });
    await screen.getByRole("button", "Mettre à jour", { exact: true }).tap();
    await expect.poll(async () => (await purchaseState(browser, receipt.id)).orders[0]?.status).toBe(status);
    await browser.reload();
    await expect(screen.getByLabel("Statut de la commande", { exact: true })).toHaveValue(status);
    const state = await purchaseState(browser, receipt.id);
    expect(state.items).toEqual(draft.items);
    expect(state.orders[0]).toMatchObject({ total_ht_cents: 1538, total_tax_cents: 308, total_ttc_cents: 1846 });
    await expect(screen.getByRole("link", "Modifier", { exact: true })).toHaveCount(0);
    states.push(state);
  }
  await evidence(scenario, "purchase-lifecycle", { receipt, draft, states, boundary: "status transitions only; no supplier email is sent" });
});

async function accessWitness(fixture: Fixture, revoke: boolean) {
  const actor = fixture.actors.observer, scenario = fixture.access;
  const database = new URL(requiredFixturePath("E2E_ARMY_LOCAL_DB_URL"));
  const executable = requiredFixturePath("E2E_ARMY_LOCAL_PSQL");
  if (!isOwnedLoopback(fixture.apiUrl) || database.hostname !== new URL(fixture.apiUrl).hostname ||
    !["postgres:", "postgresql:"].includes(database.protocol) || database.pathname !== "/postgres" ||
    database.username !== "postgres" || !database.password || ["45585", "33485", new URL(fixture.apiUrl).port].includes(database.port) ||
    !path.isAbsolute(executable) || path.basename(executable) !== "psql" ||
    ![actor.userId, actor.tenantId, actor.membershipId, scenario.versionId, scenario.projectId, scenario.lines[0].lineId].every((id) => uuid.test(id))) {
    throw new Error("Revocation witness requires exact owned native identities and transport.");
  }
  const sql = `BEGIN;
DO $owned$ DECLARE n integer; BEGIN
  IF current_user<>'postgres' OR NOT EXISTS (SELECT 1 FROM public.estimate_projects WHERE id='${scenario.projectId}'::uuid
    AND tenant_id='${actor.tenantId}'::uuid AND user_id='${actor.userId}'::uuid AND name LIKE 'ARMY-REVOKED-%')
  THEN RAISE EXCEPTION 'BUSINESS_ACCESS_SCOPE'; END IF;
  ${revoke ? `DELETE FROM public.tenant_memberships WHERE id='${actor.membershipId}'::uuid AND tenant_id='${actor.tenantId}'::uuid AND user_id='${actor.userId}'::uuid AND role='engineer';
  GET DIAGNOSTICS n = ROW_COUNT; IF n <> 1 THEN RAISE EXCEPTION 'BUSINESS_ACCESS_MEMBERSHIP_SCOPE'; END IF;` : ""}
END $owned$;
SELECT json_build_object('membershipCount',(SELECT count(*) FROM public.tenant_memberships WHERE id='${actor.membershipId}'::uuid),
  'version',(SELECT json_build_object('total_ht_cents',total_ht_cents,'total_tax_cents',total_tax_cents,'total_ttc_cents',total_ttc_cents) FROM public.estimate_versions WHERE id='${scenario.versionId}'::uuid),
  'line',(SELECT json_build_object('quantity',quantity,'unit_price_ht_cents',unit_price_ht_cents) FROM public.estimate_items WHERE id='${scenario.lines[0].lineId}'::uuid));
COMMIT;`;
  return new Promise<{ membershipCount: number; version: unknown; line: unknown }>((resolve, reject) => {
    const child = spawn(executable, ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1"], { env: {
      NODE_ENV: "test", PATH: process.env.PATH, PGHOST: database.hostname, PGPORT: database.port, PGUSER: "postgres", PGDATABASE: "postgres",
      PGPASSWORD: decodeURIComponent(database.password), PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
      PGOPTIONS: "-c statement_timeout=15000 -c lock_timeout=5000", }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; const timer = setTimeout(() => child.kill(), 20_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); }); child.stderr.resume(); child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new Error("Owned access witness could not start.")); });
    child.once("close", (code) => { clearTimeout(timer);
      try { if (code !== 0) throw new Error(); resolve(JSON.parse(stdout.trim())); }
      catch { reject(new Error("Owned access witness failed; no successful revocation claim.")); }
    }); child.stdin.end(sql);
  });
}
journey("BIZ03 revoked live membership denies cached UI and server writes then logout removes authentication", {
  tags: ["critical", "local", "business-lifecycle", "authorization"], trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, business }) => {
  const { fixture } = business, scenario = fixture.access;
  await switchActor({ app, browser, screen }, "OBSERVER", true);
  const detail = `/dashboard/estimates/${scenario.versionId}`;
  await app.open(detail);
  const before = await readEstimate(browser, scenario.versionId);
  expect(before.version.total_ht_cents).toBe(2400);
  const revoked = await accessWitness(fixture, true);
  expect(revoked.membershipCount).toBe(0);
  const deniedRead = await apiRequest(browser, "GET", `/api/estimates/${scenario.versionId}`);
  expect(deniedRead.status).toBe(404);
  const deniedWrite = await apiRequest(browser, "PATCH", `/api/estimates/${scenario.versionId}/items`, { id: scenario.lines[0].lineId, quantity: 999 });
  expect(deniedWrite.status).toBe(404);
  await browser.reload();
  await expect(screen.getByRole("button", "Soumettre à validation", { exact: true })).toHaveCount(0);
  await expect(screen.getByText(`${scenario.prefix} integer`, { exact: true })).toHaveCount(0);
  const unchanged = await accessWitness(fixture, false);
  expect(unchanged).toEqual(revoked);
  expect(unchanged.line).toEqual({ quantity: 2, unit_price_ht_cents: 1200 });
  await app.open("/dashboard/estimates");
  await screen.getByRole("button", "Se déconnecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/login(?:\?|$)/);
  const anonymous = await apiRequest(browser, "GET", `/api/estimates/${scenario.versionId}`);
  expect(anonymous.status).toBe(401);
  await app.open(detail);
  await expect(browser).toHaveURL(/\/login(?:\?|$)/);
  await evidence(scenario, "revoked-and-logout", { before, revoked, unchanged,
    deniedRead: deniedRead.status, deniedWrite: deniedWrite.status, anonymous: anonymous.status });
});
