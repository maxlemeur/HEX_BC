import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { test, type Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

// Destination after coordination: e2e/army/local/generated-ouvrage-access.e2e.ts.
import { recordEvidence, restrictCriticalBrowser } from "../critical/fixtures";
import { isolatedLocalBackend } from "./isolated-backend";

type Actor = { userId: string; tenantId: string; membershipId: string; laborRoleId?: string };
type Scenario = { label: string; prefix: string; projectId: string; versionId: string; sectionA: string; sectionB: string; draftId: string; candidateId: string; fragmentId: string; subdetailId: string; componentIds: string[]; designation: string };
type Fixture = { schemaVersion: string; status: string; apiUrl: string; owner: Actor; observer: Actor; scenarios: { archive: Scenario; role: Scenario } };
type ActionCall = { name: string; pathname: string; actionId: string };
type ActionEnvelope = { ok: boolean; data?: { draftId?: string; versionId?: string; items?: Array<{ draftId: string }> }; error?: { code: string; message: string } };
type Ui = { app: App; browser: Browser; screen: Screen };

async function evidence(scenario: Scenario, label: string, data: unknown) {
  return recordEvidence({ runPrefix: scenario.prefix, projectName: scenario.prefix, ownedEstimates: [{ projectId: scenario.projectId, versionId: scenario.versionId }] }, label, data);
}

async function ordinaryObserver(fixture: Fixture) {
  const email = process.env.E2E_ACCESS_OBSERVER_EMAIL;
  const password = process.env.E2E_ACCESS_OBSERVER_PASSWORD;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!email || !password || !anon) throw new Error("Dedicated observer ordinary credentials required");
  const client = createClient(fixture.apiUrl, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || login.data.user?.id !== fixture.observer.userId) throw new Error("Ordinary observer authentication failed");
  const membership = await client.from("tenant_memberships").select("id,tenant_id,role").eq("user_id", fixture.observer.userId).eq("is_default", true).single();
  if (membership.error || membership.data.id !== fixture.observer.membershipId || membership.data.tenant_id !== fixture.owner.tenantId || membership.data.role !== "admin") throw new Error("Observer active tenant mismatch");
  return client;
}

async function readState(client: SupabaseClient, fixture: Fixture, scenario: Scenario) {
  const values: Record<string, unknown[]> = {};
  const tables = [
    ["estimate_versions", "id", scenario.versionId],
    ["estimate_items", "version_id", scenario.versionId],
    ["estimate_generated_ouvrage_drafts", "id", scenario.draftId],
    ["estimate_generated_ouvrage_candidates", "draft_id", scenario.draftId],
    ["estimate_generated_ouvrage_subdetail_drafts", "draft_id", scenario.draftId],
    ["estimate_generated_ouvrage_subdetail_items", "draft_id", scenario.draftId],
    ["estimate_generated_ouvrage_applications", "target_version_id", scenario.versionId],
    ["estimate_generated_ouvrage_work_snapshots", "target_version_id", scenario.versionId],
    ["estimate_assemblies", "tenant_id", fixture.owner.tenantId],
  ];
  for (const [table, column, value] of tables) {
    const result = await client.from(table).select("*").eq("tenant_id", fixture.owner.tenantId).eq(column, value).order("id");
    if (result.error) throw new Error(`Ordinary ${table} read failed: ${result.error.code}`);
    values[table] = result.data;
  }
  return values;
}

function assertPristine(state: Record<string, unknown[]>, scenario: Scenario) {
  expect(state.estimate_items).toHaveLength(2);
  expect((state.estimate_items as Array<{ id: string; item_type: string }>).map((row) => ({ id: row.id, type: row.item_type }))).toEqual([scenario.sectionA, scenario.sectionB].sort().map((id) => ({ id, type: "section" })));
  expect(state.estimate_generated_ouvrage_applications).toEqual([]);
  expect(state.estimate_generated_ouvrage_work_snapshots).toEqual([]);
  expect(state.estimate_assemblies).toEqual([]);
  expect(state.estimate_generated_ouvrage_drafts).toHaveLength(1);
  expect(state.estimate_generated_ouvrage_drafts[0]).toEqual(expect.objectContaining({ id: scenario.draftId, status: "pending" }));
  expect(state.estimate_generated_ouvrage_candidates).toHaveLength(1);
  expect(state.estimate_generated_ouvrage_candidates[0]).toEqual(expect.objectContaining({ id: scenario.candidateId, resolution_status: "pending" }));
  expect(state.estimate_generated_ouvrage_subdetail_drafts).toHaveLength(1);
  expect(state.estimate_generated_ouvrage_subdetail_drafts[0]).toEqual(expect.objectContaining({ id: scenario.subdetailId, status: "pending_review" }));
  expect(state.estimate_generated_ouvrage_subdetail_items).toHaveLength(3);
}

async function openAndReadActualDraft({ app, browser, screen }: Ui, scenario: Scenario) {
  await app.open(`/dashboard/estimates/${scenario.versionId}/edit`);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible({ timeout: 45_000 });
  const opener = screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
  if (!await opener.isVisible()) {
    const tab = screen.getByRole("tab", "Insérer", { exact: true });
    if (await tab.isVisible()) await tab.tap();
    await screen.getByRole("button", "Insérer", { exact: true }).tap();
  }
  await expect(opener).toBeEnabled();
  await opener.tap();
  await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
  const entry = screen.getByTestId(`generated-ouvrage-draft-${scenario.draftId}`);
  await expect(entry).toBeVisible();
  await entry.getByRole("button", "Reprendre", { exact: true }).tap();
  await expect(screen.getByTestId(`candidate-card-${scenario.candidateId}`)).toBeVisible();
  // No review, acceptance, rejection, or generation is performed in this campaign.
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
}

async function releaseOwnedLock(browser: Browser, scenario: Scenario) {
  const result = await browser.evaluate(async ({ versionId }) => {
    const identity = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`);
    if (!identity) throw new Error("Observed editor lock identity required");
    const response = await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin", headers: { "x-estimate-draft-lock-session-id": identity } });
    const body = await response.json();
    return { status: response.status, released: body.data?.released === true };
  }, { versionId: scenario.versionId });
  expect(result).toEqual({ status: 200, released: true });
  return result;
}

async function actionRead(browser: Browser, call: ActionCall, input: Record<string, unknown>) {
  // The identity was emitted by the actual UI in this exact build and session.
  // Tokens, cookies, auth headers, and raw Flight are never returned as evidence.
  const serialized = await browser.evaluate(async (request) => {
    const response = await fetch(request.pathname, { method: "POST", credentials: "same-origin", headers: { "next-action": request.actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: request.body });
    const flight = await response.text();
    const envelopes = flight.split("\n").flatMap((line) => {
      const text = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1];
      if (!text) return [];
      try {
        const value = JSON.parse(text);
        return typeof value.ok === "boolean" ? [value as ActionEnvelope] : [];
      } catch { return []; }
    });
    return JSON.stringify({ status: response.status, envelopes });
  }, { pathname: call.pathname, actionId: call.actionId, body: JSON.stringify([input]) });
  return JSON.parse(serialized) as { status: number; envelopes: ActionEnvelope[] };
}

function assertRefused(value: Awaited<ReturnType<typeof actionRead>>, code: string) {
  expect(value.status).toBe(200);
  expect(value.envelopes).toHaveLength(1);
  expect(value.envelopes[0].ok).toBe(false);
  expect(value.envelopes[0].error?.code).toBe(code);
  expect(value.envelopes[0].error?.message).toEqual(expect.any(String));
  expect(value.envelopes[0].data).toBeUndefined();
}

test("GR07 access refuses list and resume after real archive then owner role downgrade", {
  session: "army", trace: "off", retries: 0, timeout: 240_000,
}, async ({ app, browser, screen }) => {
  const filename = process.env.E2E_GENERATED_ACCESS_FIXTURE_PATH;
  if (!filename || process.env.NEXT_PUBLIC_SUPABASE_URL !== isolatedLocalBackend()) throw new Error("Explicit local access fixture required");
  const fixture = JSON.parse(await readFile(filename, "utf8")) as Fixture;
  expect(fixture.schemaVersion).toBe("generated-ouvrage-access-1");
  expect(fixture.status).toBe("ready");
  expect(fixture.apiUrl).toBe(isolatedLocalBackend());
  expect(fixture.owner.tenantId).toBe(fixture.observer.tenantId);
  expect(fixture.owner.userId === fixture.observer.userId).toBe(false);
  const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
  const names = new Map(Object.entries(manifest.node).map(([id, entry]) => [id, entry.exportedName ?? "unknown"]));
  const calls: ActionCall[] = [];
  const origin = new URL(app.baseUrl!).origin;
  await restrictCriticalBrowser(browser, app);
  await browser.route(`${origin}/dashboard/estimates/**/edit`, async (route) => {
    const actionId = route.request.headers["next-action"];
    if (actionId) {
      const name = names.get(actionId) ?? "unknown";
      calls.push({ name, actionId, pathname: new URL(route.request.url).pathname });
      if (["generateOuvragesFromText", "insertGeneratedOuvrages", "rejectGeneratedOuvrageDraft", "updateGeneratedOuvrageSubdetailDraft"].includes(name)) {
        await route.abort();
        throw new Error("Access campaign must not generate, apply, reject, or review a draft");
      }
    }
    await route.fallback();
  });
  const observer = await ordinaryObserver(fixture);
  try {
    // One serial journey: role downgrade is the final mutation and is never undone.
    for (const label of ["archive", "role"] as const) {
      const scenario = fixture.scenarios[label];
      const membershipBefore = await observer.from("tenant_memberships").select("id,user_id,role").eq("tenant_id", fixture.owner.tenantId).order("id");
      if (membershipBefore.error) throw new Error("Ordinary membership read failed");
      expect(membershipBefore.data).toHaveLength(2);
      expect(membershipBefore.data.every((row) => row.role === "admin")).toBe(true);
      const original = await readState(observer, fixture, scenario);
      assertPristine(original, scenario);
      await openAndReadActualDraft({ app, browser, screen }, scenario);
      const pathname = `/dashboard/estimates/${scenario.versionId}/edit`;
      const listCall = calls.filter((call) => call.pathname === pathname && call.name === "listResumableGeneratedOuvrageDrafts").at(-1);
      const fetchCall = calls.filter((call) => call.pathname === pathname && call.name === "fetchResumableGeneratedOuvrageDraft").at(-1);
      if (!listCall || !fetchCall) throw new Error("Both actual UI read actions must be observed before access changes");
      const released = await releaseOwnedLock(browser, scenario);
      // Remove the editor's autosave/lease timers before permission transitions.
      // This navigation follows reads only; do not accept an unexpected dirty warning.
      await app.open("/dashboard/affaires");
      await expect(browser).toHaveURL(/\/dashboard\/affaires$/);
      const beforeChange = await readState(observer, fixture, scenario);
      assertPristine(beforeChange, scenario);
      const transition = await browser.evaluate(async (request) => {
        const route = request.label === "archive" ? "/api/affaires/bulk-archive" : "/api/tenants/memberships";
        const payload = request.label === "archive"
          ? { projectIds: [request.projectId] }
          : { action: "set-role", membership_id: request.membershipId, role: "viewer" };
        const response = await fetch(route, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
        const body = await response.json();
        // Do not retain profile work_email or any other membership UI decoration.
        return { status: response.status, ok: body.ok === true, requestedCount: body.data?.requestedCount ?? null, archivedIds: body.data?.archivedIds ?? null, failures: body.data?.failures ?? null, membership: body.data?.membership ? { id: body.data.membership.id, user_id: body.data.membership.user_id, role: body.data.membership.role } : null, errorCode: body.error?.code ?? null };
      }, { label, projectId: scenario.projectId, membershipId: fixture.owner.membershipId });
      await evidence(scenario, "access-transition-before-assertion", { label, released, transition, actor: fixture.owner, observer: fixture.observer });
      expect(transition.status).toBe(200);
      expect(transition.ok).toBe(true);
      if (label === "archive") {
        expect(transition.requestedCount).toBe(1);
        expect(transition.archivedIds).toEqual([scenario.projectId]);
        expect(transition.failures).toEqual([]);
      } else {
        expect(transition.membership).toEqual({ id: fixture.owner.membershipId, user_id: fixture.owner.userId, role: "viewer" });
      }
      const project = await observer.from("estimate_projects").select("id,user_id,is_archived").eq("tenant_id", fixture.owner.tenantId).eq("id", scenario.projectId).single();
      const memberships = await observer.from("tenant_memberships").select("id,user_id,role").eq("tenant_id", fixture.owner.tenantId).order("id");
      if (project.error || memberships.error) throw new Error("Ordinary post-transition verification failed");
      expect(project.data.is_archived).toBe(label === "archive");
      expect(memberships.data.find((row) => row.id === fixture.owner.membershipId)?.role).toBe(label === "archive" ? "admin" : "viewer");
      expect(memberships.data.find((row) => row.id === fixture.observer.membershipId)?.role).toBe("admin");
      const beforeReads = await readState(observer, fixture, scenario);
      expect(beforeReads).toEqual(beforeChange);
      const listed = await actionRead(browser, listCall, { versionId: scenario.versionId });
      const fetched = await actionRead(browser, fetchCall, { versionId: scenario.versionId, draftId: scenario.draftId });
      const afterReads = await readState(observer, fixture, scenario);
      await evidence(scenario, "access-denials-and-zero-effects", { label, expectedCode: label === "archive" ? "CONFLICT" : "FORBIDDEN", listed, fetched, beforeReads, afterReads, project: project.data, memberships: memberships.data, calls: calls.filter((call) => call.pathname === pathname), nonDraftReadOnlyQualified: false });
      assertRefused(listed, label === "archive" ? "CONFLICT" : "FORBIDDEN");
      assertRefused(fetched, label === "archive" ? "CONFLICT" : "FORBIDDEN");
      expect(afterReads).toEqual(beforeReads);
      assertPristine(afterReads, scenario);
    }
  } finally {
    await observer.auth.signOut();
    await evidence(fixture.scenarios.role, "access-action-ledger", { calls, boundary: "New fixture roles only; actual archive and self-demotion; no READ_ONLY version transition or applied ouvrage claimed" });
  }
});
