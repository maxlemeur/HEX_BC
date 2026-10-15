import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { test, type Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

import { readEstimate, recordEvidence, restrictCriticalBrowser } from "../critical/fixtures";
import { sdkResultsRoot } from "./sdk-results";

type Candidate = { candidateId: string; designation: string; subdetailId: string; quantity: number; unit: string; components: Array<{ componentId: string; designation: string; quantity: number; unit: string; unitCostHtCents: number; dsCents: number; costType?: string; lossCoeffBp?: number; yieldValue?: number | null; yieldUnit?: string | null }> };
type Draft = { draftId: string; createdAt: string; status: string; candidates: Candidate[] };
type Scenario = { prefix: string; projectId: string; versionId: string; sectionA: string; sectionB: string; drafts: Draft[] };
type Fixture = { status: string; apiUrl: string; campaign: string; owner: { userId: string; tenantId: string; laborRoleId: string }; scenarios: Record<string, Scenario>; before: Record<string, Record<string, number>>; paginationOrder: string[]; costMatrix?: Array<{ scenario: string; accept: boolean; dsCents: number; hours: number }> };
type ActionCall = { name: string; pathname: string; actionId: string; body: string | null };
type WebRoute = Parameters<Parameters<Browser["route"]>[1]>[0];
type Context = { fixture: Fixture; calls: ActionCall[]; actionNames: Map<string, string>; intercept?: (route: WebRoute) => Promise<boolean> };
type Ui = { app: App; browser: Browser; screen: Screen };

// Observable failure plan: docs/testing/generated-ouvrage-resume.md.
const generatedTest = test.extend<{ generated: Context }>({
  generated: async ({ app, browser }, provide) => {
    const file = process.env.E2E_GENERATED_OUVRAGE_FIXTURE_PATH;
    if (!file || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:59827") throw new Error("An explicit isolated generated-ouvrage fixture is required.");
    const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
    expect(fixture.status).toBe("ready");
    expect(fixture.apiUrl).toBe("http://127.0.0.1:59827");
    const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
    const actionNames = new Map(Object.entries(manifest.node).map(([id, entry]) => [id, entry.exportedName ?? "unknown"]));
    const context: Context = { fixture, calls: [], actionNames };
    const origin = new URL(app.baseUrl!).origin;
    await restrictCriticalBrowser(browser, app);
    await browser.route(`${origin}/dashboard/estimates/**/edit`, async (route) => {
      const actionId = route.request.headers["next-action"];
      if (actionId) {
        const name = actionNames.get(actionId) ?? "unknown";
        if (/GeneratedOuvrage|GeneratedOuvrages/.test(name)) context.calls.push({ name, actionId, pathname: new URL(route.request.url).pathname, body: route.request.postData ?? null });
        if (name === "generateOuvragesFromText") { context.calls.push({ name, actionId, pathname: new URL(route.request.url).pathname, body: null }); await route.abort(); throw new Error("Resume must never invoke generation."); }
      }
      if (context.intercept && await context.intercept(route)) return;
      await route.fallback();
    });
    try { await provide(context); }
    finally {
      const released = await releaseCurrentOwnedLock(browser, Object.entries(fixture.scenarios).filter(([label]) => label !== "foreign").map(([, scenario]) => scenario.versionId));
      await evidence(fixture.scenarios.main, `generated-lock-teardown-${Date.now()}`, released);
      await evidence(fixture.scenarios.main, `generated-action-ledger-${Date.now()}`, { calls: context.calls, generationInvoked: context.calls.some((call) => call.name === "generateOuvragesFromText"), noApplicationOrSnapshotSeeded: fixture.before });
    }
  },
});

async function evidence(scenario: Scenario, label: string, data: unknown) {
  const sanitized = JSON.parse(JSON.stringify(data, (key, value: unknown) => {
    if (/^(?:draftLockSessionId|sessionId|session_id|access_token|refresh_token|password)$/i.test(key)) return "[REDACTED]";
    if (key === "body" && typeof value === "string") return value.replace(/"(?:draftLockSessionId|sessionId|session_id)"\s*:\s*"[^"]*"/g, '"draftLockSessionId":"[REDACTED]"');
    return value;
  })) as unknown;
  return recordEvidence({ runPrefix: scenario.prefix, projectName: scenario.prefix, ownedEstimates: [{ projectId: scenario.projectId, versionId: scenario.versionId }] }, label, sanitized);
}

async function releaseCurrentOwnedLock(browser: Browser, ownedVersionIds: string[]) {
  const current = await browser.url().catch(() => null);
  if (!current) return { attempted: false, reason: "no-open-page" };
  return browser.evaluate(async (owned) => {
    const versionId = location.pathname.match(/^\/dashboard\/estimates\/([0-9a-f-]{36})\/edit$/i)?.[1];
    if (!versionId || !owned.includes(versionId)) return { attempted: false, reason: "not-current-owned-editor", versionId: null, status: null, released: false };
    const sessionId = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`);
    if (!sessionId) return { attempted: false, reason: "no-editor-lock-session", versionId, status: null, released: false };
    const response = await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin", headers: { "x-estimate-draft-lock-session-id": sessionId } });
    const result = await response.json();
    return { attempted: true, reason: "ordinary-own-session-release", versionId, status: response.status, released: Boolean(result.data?.released) };
  }, ownedVersionIds);
}

async function openDialog({ app, screen, browser }: Ui, scenario: Scenario) {
  const target = `/dashboard/estimates/${scenario.versionId}/edit`;
  const current = await browser.url().catch(() => null);
  if (!current || new URL(current).pathname !== target) await app.open(target);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible({ timeout: 45_000 });
  const opener = screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
  if (!await opener.isVisible()) {
    const tab = screen.getByRole("tab", "Insérer", { exact: true });
    if (await tab.isVisible()) await tab.tap();
    await screen.getByRole("button", "Insérer", { exact: true }).tap();
  }
  await expect(opener).toBeEnabled();
  await opener.tap();
  const dialog = screen.getByRole("dialog", "Générer des ouvrages", { exact: true });
  await expect(dialog).toBeVisible();
  const observed = await browser.evaluate(() => {
    const node = document.querySelector('[role="dialog"]');
    return { text: node?.textContent ?? null, buttons: Array.from(node?.querySelectorAll("button") ?? []).map((button) => ({ text: button.textContent, disabled: button.disabled })) };
  });
  await evidence(scenario, "resume-entry-observed", observed);
  // Baseline must fail on the specific missing entry, after its actual surface
  // and the seed's zero-application proof have been retained.
  await expect(dialog.getByText("Reprendre un brouillon", { exact: true })).toBeVisible();
  return dialog;
}

async function resume(screen: Screen, draft: Draft) {
  const entry = screen.getByTestId(`generated-ouvrage-draft-${draft.draftId}`);
  await expect(entry).toBeVisible();
  await entry.getByRole("button", "Reprendre", { exact: true }).tap();
  await expect(screen.getByRole("region", "Propositions d'ouvrages", { exact: true })).toBeVisible();
  for (const candidate of draft.candidates) await expect(screen.getByTestId(`candidate-card-${candidate.candidateId}`)).toBeVisible();
}

async function reloadEditor({ browser, screen }: Ui, scenario: Scenario) {
  const previous = await browser.evaluate(() => performance.timeOrigin);
  const dialogs: string[] = [];
  // After observed autosave, a beforeunload warning is unexpected. Preserve
  // unsaved work and fail instead of accepting a discard to make reload pass.
  const removeHandler = await browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.dismiss(); });
  let reloadError: unknown;
  try { await browser.reload({ timeout: 15_000 }); }
  catch (error) { reloadError = error; }
  finally { await removeHandler(); }
  const current = await browser.evaluate(() => ({ origin: performance.timeOrigin, ready: document.readyState }));
  await evidence(scenario, `document-reload-${Date.now()}`, { previousOrigin: previous, currentOrigin: current.origin, ready: current.ready, nativeDialogs: dialogs });
  expect(dialogs).toHaveLength(0);
  if (reloadError) throw reloadError;
  expect(current.origin > previous && current.ready !== "loading").toBe(true);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
}

async function waitForObservedAutosave(browser: Browser, scenario: Scenario, ht: number, mode: "automatic" | "shortcut" = "automatic") {
  const expected = [ht, Math.round(ht * 0.2), ht + Math.round(ht * 0.2)];
  const observations: Array<{ at: string; status: string | null; totals: number[] }> = [];
  const enteredAt = new Date().toISOString();
  let shortcutAt: string | null = null;
  await browser.evaluate((versionId) => {
    type Totals = { total_ht_cents?: number; total_tax_cents?: number; total_ttc_cents?: number };
    type RequestProof = { requestedAt: string; respondedAt: string | null; method: string; pathname: string; status: number | null; ok: boolean | null; sentTotals: Totals | null; receivedTotals: Totals | null };
    const scope = window as Window & { __armyAutosaveCapture?: { original: typeof fetch; requests: RequestProof[] } };
    if (scope.__armyAutosaveCapture) throw new Error("Autosave observer already installed.");
    const capture = { original: window.fetch, requests: [] as RequestProof[] };
    const onlyTotals = (value: unknown): Totals | null => {
      if (!value || typeof value !== "object") return null;
      const record = value as Record<string, unknown>;
      const totals: Totals = {};
      for (const key of ["total_ht_cents", "total_tax_cents", "total_ttc_cents"] as const) if (typeof record[key] === "number" && Number.isSafeInteger(record[key])) totals[key] = record[key];
      return Object.keys(totals).length ? totals : null;
    };
    scope.__armyAutosaveCapture = capture;
    window.fetch = async function(input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      let entry: RequestProof | null = null;
      if (url.origin === location.origin && url.pathname === `/api/estimates/${versionId}/items/bulk` && method !== "GET") {
        entry = { requestedAt: new Date().toISOString(), respondedAt: null, method, pathname: url.pathname, status: null, ok: null, sentTotals: null, receivedTotals: null };
        // Whitelist numeric totals only; no raw body, version token or headers
        // are ever retained. Forward the original request without modification.
        if (typeof init?.body === "string") {
          try { entry.sentTotals = onlyTotals(JSON.parse(init.body).version_patch); } catch { /* observed malformed body remains null */ }
        }
        capture.requests.push(entry);
      }
      const response = await capture.original.call(window, input, init);
      if (entry) {
        const proof = entry;
        proof.respondedAt = new Date().toISOString(); proof.status = response.status;
        void response.clone().json().then((value) => { proof.ok = value.ok === true; proof.receivedTotals = onlyTotals(value.data?.totals); }).catch(() => { proof.ok = false; });
      }
      return response;
    };
    return true;
  }, scenario.versionId);
  try {
    if (mode === "shortcut") { shortcutAt = new Date().toISOString(); await browser.keyboard.press("Control+s"); }
    await expect.poll(async () => {
      const status = await browser.evaluate(() => document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? null);
      const { version } = await readEstimate(browser, scenario.versionId);
      const totals = [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
      const previous = observations.at(-1);
      if (!previous || previous.status !== status || JSON.stringify(previous.totals) !== JSON.stringify(totals)) observations.push({ at: new Date().toISOString(), status, totals });
      return /Sauvegardé|À jour/.test(status ?? "") && JSON.stringify(totals) === JSON.stringify(expected);
    }, { timeout: mode === "automatic" ? 90_000 : 30_000, interval: 2000 }).toBe(true);
  } finally {
    const bulkRequests = JSON.parse(await browser.evaluate(() => {
      const scope = window as Window & { __armyAutosaveCapture?: { original: typeof fetch; requests: unknown[] } };
      const capture = scope.__armyAutosaveCapture;
      if (!capture) return "[]";
      window.fetch = capture.original; delete scope.__armyAutosaveCapture;
      return JSON.stringify(capture.requests);
    }));
    await evidence(scenario, `observed-autosave-${Date.now()}`, { enteredAt, shortcutAt, expected, observations, bulkRequests, saveMode: mode, manualSaveInvoked: mode === "shortcut", directTotalsPatchInvoked: false });
  }
}

async function reviewCandidate({ browser, screen }: Ui, candidate: Candidate) {
  const card = screen.getByTestId(`candidate-card-${candidate.candidateId}`);
  const editor = browser.locator(`[data-testid="candidate-card-${candidate.candidateId}"] section`);
  await card.getByRole("button", "Valider le sous-détail", { exact: true }).tap();
  await expect(card.getByText("Sous-détail composé", { exact: true })).toBeVisible();
  for (const component of candidate.components) await expect(card.getByRole("button", new RegExp(component.designation))).toBeVisible();
  await editor.getByRole("button", "Valider le sous-détail", { exact: true }).tap();
  await expect(card.getByText("Revu", { exact: true })).toBeVisible();
}

async function reviewAndInsert(ui: Ui, draft: Draft, candidate: Candidate, complete = true, beforeInsert?: () => Promise<void>) {
  const { screen } = ui;
  await reviewCandidate(ui, candidate);
  const card = screen.getByTestId(`candidate-card-${candidate.candidateId}`);
  await beforeInsert?.();
  const select = card.getByRole("checkbox", `Sélectionner ${candidate.designation}`, { exact: true });
  if (!await select.isChecked()) await select.check();
  await screen.getByRole("button", "Insérer les ouvrages sélectionnés", { exact: true }).tap();
  if (complete) await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden({ timeout: 30_000 });
  else await expect(screen.getByTestId(`candidate-card-${candidate.candidateId}`).getByText("Inséré", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(draft.candidates.some((entry) => entry.candidateId === candidate.candidateId)).toBe(true);
}

async function assertInsertionSessionDenials(browser: Browser, context: Context, scenario: Scenario, draft: Draft, candidate: Candidate) {
  const actionId = [...context.actionNames].find(([, name]) => name === "insertGeneratedOuvrages")?.[0];
  if (!actionId || context.fixture.apiUrl !== "http://127.0.0.1:59827") throw new Error("Real insertion action and exact local fixture required.");
  // Separate ordinary authentication is used only for independent RLS reads.
  // Session tokens stay inside the client and are never returned or recorded.
  const client = createClient(context.fixture.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || login.data.user?.id !== context.fixture.owner.userId) throw new Error("Ordinary fixture read authentication failed.");
  const snapshot = async () => {
    const result: Record<string, string[]> = {};
    for (const [table, column, value] of [
      ["estimate_generated_ouvrage_applications", "target_version_id", scenario.versionId],
      ["estimate_generated_ouvrage_work_snapshots", "target_version_id", scenario.versionId],
      ["estimate_items", "version_id", scenario.versionId],
      ["estimate_assemblies", "source_metadata->>draft_id", draft.draftId],
    ]) {
      const read = await client.from(table).select("id").eq("tenant_id", context.fixture.owner.tenantId).eq(column, value).order("id");
      if (read.error) throw new Error(`Ordinary independent ${table} read failed: ${read.error.code}`);
      result[table] = read.data.map((row) => row.id as string);
    }
    return result;
  };
  const before = await snapshot();
  expect(before).toEqual({ estimate_generated_ouvrage_applications: [], estimate_generated_ouvrage_work_snapshots: [], estimate_items: [scenario.sectionA, scenario.sectionB].sort(), estimate_assemblies: [] });
  const observed = [];
  for (const mode of ["missing", "wrong", "other-page", "released"] as const) {
    const refusal = await browser.evaluate(async (request) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${request.versionId}`);
      if (!session || !/^[0-9a-f-]{36}$/i.test(session)) throw new Error("Real editor session is required.");
      const other = crypto.randomUUID();
      const transitions: Array<{ action: string; status: number; success: boolean }> = [];
      const lock = async (method: "DELETE" | "POST", identity: string, label: string) => {
        const response = await fetch(`/api/estimates/${request.versionId}/lock`, { method, credentials: "same-origin", headers: { "x-estimate-draft-lock-session-id": identity } });
        const value = await response.json();
        const acquired = value.data?.lock;
        const success = response.ok && value.ok === true && (method === "DELETE" ? value.data?.released === true : acquired?.version_id === request.versionId && acquired?.session_id === identity && acquired?.is_current_session === true && acquired?.is_current_user === true && acquired?.is_expired === false);
        transitions.push({ action: label, status: response.status, success });
        if (!success) throw new Error(`Ordinary lock transition failed: ${label}`);
      };
      let current: "editor" | "other" | "none" = "editor";
      try {
        if (request.mode === "other-page" || request.mode === "released") {
          await lock("DELETE", session, "release-editor"); current = "none";
          if (request.mode === "other-page") { await lock("POST", other, "acquire-other-page"); current = "other"; }
        }
        const body = { versionId: request.versionId, draftId: request.draftId, acceptedCandidates: [{ candidateId: request.candidateId, designation: request.designation, unit: "m", quantity: 10, lotId: null }], ...(request.mode === "missing" ? {} : { draftLockSessionId: request.mode === "wrong" ? other : session }) };
        const response = await fetch(location.pathname, { method: "POST", credentials: "same-origin", headers: { "next-action": request.actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: JSON.stringify([body]) });
        const flight = await response.text();
        const results = flight.split("\n").flatMap((line) => {
          const json = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1];
          if (!json) return [];
          try { const value = JSON.parse(json); return typeof value.ok === "boolean" ? [{ ok: value.ok as boolean, error: (value.error ?? null) as { code: string; message: string } | null, dataPresent: value.data !== undefined }] : []; } catch { return []; }
        });
        return { mode: request.mode, status: response.status, results, suppliedSession: request.mode !== "missing", fallbackLotRequested: true, transitions };
      } finally {
        if (current === "other") { await lock("DELETE", other, "release-other-page"); current = "none"; }
        if (current === "none") await lock("POST", session, "restore-editor");
      }
    }, { mode, versionId: scenario.versionId, draftId: draft.draftId, candidateId: candidate.candidateId, designation: candidate.designation, actionId });
    const after = await snapshot();
    observed.push({ ...refusal, after });
    await evidence(scenario, `session-denial-${mode}`, { before, ...refusal, after });
    expect(refusal.status).toBe(200);
    expect(refusal.results).toHaveLength(1);
    expect(refusal.results[0].ok).toBe(false);
    expect(refusal.results[0].dataPresent).toBe(false);
    expect(refusal.results[0].error?.code).toBe(mode === "missing" ? "VALIDATION_ERROR" : mode === "released" ? "LOCK_REQUIRED" : "CONFLICT");
    expect(after).toEqual(before);
  }
  await evidence(scenario, "session-denials-before-real-ui-success", { before, observed, trueTimeExpiryQualified: false });
}

generatedTest("GR01 resumes the saved ouvrage after closing and reload, reviews and inserts exact costs", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.main, draft = s.drafts[0], candidate = draft.candidates[0];
  expect(generated.fixture.before.main).toEqual({ estimate_generated_ouvrage_applications: 0, estimate_generated_ouvrage_work_snapshots: 0, lines: 0 });
  await app.open(`/dashboard/estimates/${s.versionId}/edit`);
  const before = await readEstimate(browser, s.versionId);
  expect(before.items.filter((item) => item.item_type === "line")).toHaveLength(0);
  expect(before.version.calc_engine_version).toBe(2);
  expect(before.version.max_section_depth).toBe(1);
  await evidence(s, "before-resume", { before, seed: generated.fixture.before.main });
  await openDialog({ app, browser, screen }, s);
  await resume(screen, draft);
  await browser.keyboard.press("Escape");
  await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
  await reloadEditor({ app, browser, screen }, s);
  await openDialog({ app, browser, screen }, s);
  await resume(screen, draft);
  expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
  await reviewAndInsert({ app, browser, screen }, draft, candidate, true, () => assertInsertionSessionDenials(browser, generated, s, draft, candidate));
  await waitForObservedAutosave(browser, s, 40000);
  await reloadEditor({ app, browser, screen }, s);
  const after = await readEstimate(browser, s.versionId);
  const lines = after.items.filter((item) => item.item_type === "line");
  await evidence(s, "applied-parent", { after, calls: generated.calls });
  expect(lines).toHaveLength(1);
  const provenance = lines[0].source_metadata as Record<string, unknown>;
  expect(provenance).toEqual(expect.objectContaining({ kind: "generated_ouvrage", draft_id: draft.draftId, candidate_id: candidate.candidateId, resolution_status: "inserted" }));
  for (const key of ["application_id", "snapshot_id", "assembly_id"]) expect(provenance[key]).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  expect(provenance.subdetail_summary).toEqual(expect.objectContaining({ componentCount: 3, dsCents: 40000, indicativeTargetPriceCents: 40000 }));
  expect(provenance.estimate_item_mapping).toEqual(expect.objectContaining({ mode: "legacy_labor_allocated", unitPriceHtCents: 4000, hMo: 5, kFo: 0.5, kMo: 1, nonLaborDsCents: 20000, laborDsCents: 20000, totalDsCents: 40000 }));
  const snapshotComponents = provenance.components as Array<Record<string, unknown>>;
  expect(snapshotComponents.map((component) => ({ designation: component.designation, quantity: component.quantity, unit: component.unit, unitCostHtCents: component.unitCostHtCents, dsCents: component.dsCents }))).toEqual(candidate.components.map(({ designation, quantity, unit, unitCostHtCents, dsCents }) => ({ designation, quantity, unit, unitCostHtCents, dsCents })));
  expect({ title: lines[0].title, parent: lines[0].parent_id, quantity: lines[0].quantity, unitPrice: lines[0].unit_price_ht_cents, hMo: lines[0].h_mo, kFo: lines[0].k_fo, kMo: lines[0].k_mo, role: lines[0].labor_role_id }).toEqual({ title: candidate.designation, parent: s.sectionA, quantity: 10, unitPrice: 4000, hMo: 5, kFo: 0.5, kMo: 1, role: generated.fixture.owner.laborRoleId });
  expect([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents]).toEqual([40000, 8000, 48000]);
  expect(generated.calls.filter((call) => call.name === "insertGeneratedOuvrages")).toHaveLength(5);
  expect(generated.calls.filter((call) => call.name === "fetchResumableGeneratedOuvrageDraft")).toHaveLength(2);
});

type ActionResult = { ok: boolean; data?: Record<string, unknown>; error?: { code: string; message: string } };
function lastCall(context: Context, name: string) {
  const call = context.calls.filter((entry) => entry.name === name).at(-1);
  if (!call?.body) throw new Error(`The UI has not emitted the expected ${name} action.`);
  return call;
}
async function replayAction(browser: Browser, call: ActionCall, input: Record<string, unknown>) {
  const original = JSON.parse(call.body!) as unknown[];
  expect(Array.isArray(original) && original.length === 1 && typeof original[0] === "object").toBe(true);
  const response = await browser.evaluate(async (request) => {
    const response = await fetch(request.pathname, { method: "POST", credentials: "same-origin", headers: { "next-action": request.actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: request.body });
    return { status: response.status, text: await response.text() };
  }, { pathname: call.pathname, actionId: call.actionId, body: JSON.stringify([input]) });
  // Retain only the action envelope. Other Flight records may carry page data;
  // neither raw Flight nor any cookie/auth header is saved as evidence.
  const envelopes = response.text.split("\n").flatMap((line) => {
    const json = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1];
    if (!json) return [];
    try { const value = JSON.parse(json) as ActionResult; return typeof value.ok === "boolean" ? [value] : []; } catch { return []; }
  });
  expect(envelopes).toHaveLength(1);
  return { httpStatus: response.status, result: envelopes[0] };
}
function idsFromPage(result: ActionResult) {
  expect(result.ok).toBe(true);
  const items = result.data?.items as Array<{ draftId: string }>;
  expect(Array.isArray(items)).toBe(true);
  return items.map((item) => item.draftId);
}
async function listedIds(browser: Browser) {
  return browser.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="generated-ouvrage-draft-"]')).map((node) => node.getAttribute("data-testid")!.slice("generated-ouvrage-draft-".length)));
}

generatedTest("GR02 paginates all 21 owned drafts in stable order and rejects an invalid cursor", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.pagination;
  await openDialog({ app, browser, screen }, s);
  await expect(screen.getByTestId(/^generated-ouvrage-draft-/)).toHaveCount(20);
  expect(await listedIds(browser)).toEqual(generated.fixture.paginationOrder.slice(0, 20));
  const call = lastCall(generated, "listResumableGeneratedOuvrageDrafts");
  const first = await replayAction(browser, call, { versionId: s.versionId });
  expect(idsFromPage(first.result)).toEqual(generated.fixture.paginationOrder.slice(0, 20));
  expect(typeof first.result.data?.nextCursor).toBe("string");
  await screen.getByRole("button", "Charger la suite", { exact: true }).tap();
  await expect(screen.getByTestId(/^generated-ouvrage-draft-/)).toHaveCount(21);
  expect(await listedIds(browser)).toEqual(generated.fixture.paginationOrder);
  await expect(screen.getByText("Tous les brouillons disponibles sont affichés.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Charger la suite", { exact: true })).toHaveCount(0);
  const next = await replayAction(browser, call, { versionId: s.versionId, cursor: first.result.data!.nextCursor });
  expect(idsFromPage(next.result)).toEqual(generated.fixture.paginationOrder.slice(20));
  expect(next.result.data?.nextCursor).toBe(null);
  const malformed = await replayAction(browser, call, { versionId: s.versionId, cursor: Buffer.from("not-json").toString("base64url") });
  expect(malformed.result.ok).toBe(false);
  expect(malformed.result.error?.code).toBe("BAD_REQUEST");
  expect(malformed.result.data).toBeUndefined();
  await evidence(s, "pagination-order", { first, next, malformed, displayed: await listedIds(browser) });
  const finalDraft = s.drafts.find((draft) => draft.draftId === generated.fixture.paginationOrder[20])!;
  await resume(screen, finalDraft);
  expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
});

generatedTest("GR03 denies forged resume IDs from another version author or tenant in the real session", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.failure;
  await openDialog({ app, browser, screen }, s);
  await resume(screen, s.drafts[0]);
  const call = lastCall(generated, "fetchResumableGeneratedOuvrageDraft");
  const pagination = generated.fixture.scenarios.pagination;
  const sameVersionOtherAuthor = pagination.drafts[23];
  const cases = [
    { label: "another-version", versionId: s.versionId, draftId: generated.fixture.scenarios.late.drafts[0].draftId },
    { label: "another-author", versionId: pagination.versionId, draftId: sameVersionOtherAuthor.draftId },
    { label: "another-tenant", versionId: s.versionId, draftId: generated.fixture.scenarios.foreign.drafts[0].draftId },
  ];
  const observed = [];
  for (const item of cases) {
    const response = await replayAction(browser, call, { versionId: item.versionId, draftId: item.draftId });
    observed.push({ label: item.label, ...response });
    expect(response.result).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Brouillon introuvable ou non reprenable." } });
  }
  await evidence(s, "forged-scope-denials", observed);
  expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
  expect(generated.calls.filter((entry) => entry.name === "insertGeneratedOuvrages")).toHaveLength(0);
});

generatedTest("GR04 resumes partial application without selecting or inserting the first candidate again", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.partial, draft = s.drafts[0];
  await openDialog({ app, browser, screen }, s);
  await resume(screen, draft);
  const renamed = `${draft.candidates[0].designation} — validé chantier`;
  const firstCard = screen.getByTestId(`candidate-card-${draft.candidates[0].candidateId}`);
  await firstCard.getByRole("button", "Modifier", { exact: true }).tap();
  await firstCard.getByTestId("edit-designation").fill(renamed);
  await firstCard.getByRole("button", "Valider la ligne", { exact: true }).tap();
  await reviewAndInsert({ app, browser, screen }, draft, draft.candidates[0], false);
  const first = await readEstimate(browser, s.versionId);
  const firstLines = first.items.filter((item) => item.item_type === "line");
  expect(firstLines).toHaveLength(1);
  expect(firstLines[0].title).toBe(renamed);
  expect(((firstLines[0].source_metadata as Record<string, unknown>).applied_values as Record<string, unknown>).designation).toBe(renamed);
  await evidence(s, "partial-renamed-parent-before-resume", { first, renamed });
  const resolvedBeforeReload = await browser.evaluate((candidateId) => document.querySelector(`[data-testid="candidate-card-${candidateId}"]`)?.textContent ?? null, draft.candidates[0].candidateId);
  await evidence(s, "partial-resolved-name-before-reload", { expectedDesignation: renamed, displayedText: resolvedBeforeReload, appliedParentId: firstLines[0].id });
  await expect(firstCard.getByText(renamed, { exact: true })).toBeVisible();
  await browser.keyboard.press("Escape");
  await waitForObservedAutosave(browser, s, 40000, "shortcut");
  await reloadEditor({ app, browser, screen }, s);
  await openDialog({ app, browser, screen }, s);
  await resume(screen, draft);
  const resolved = screen.getByTestId(`candidate-card-${draft.candidates[0].candidateId}`);
  await expect(resolved.getByText("Inséré", { exact: true })).toBeVisible();
  await expect(resolved.getByText(renamed, { exact: true })).toBeVisible();
  await expect(resolved.getByText(draft.candidates[0].designation, { exact: true })).toHaveCount(0);
  await expect(resolved.getByRole("checkbox")).toHaveCount(0);
  await reviewAndInsert({ app, browser, screen }, draft, draft.candidates[1]);
  await waitForObservedAutosave(browser, s, 80000, "shortcut");
  await reloadEditor({ app, browser, screen }, s);
  const final = await readEstimate(browser, s.versionId);
  const finalLines = final.items.filter((item) => item.item_type === "line");
  expect(finalLines).toHaveLength(2);
  expect(finalLines.filter((item) => item.id === firstLines[0].id)).toHaveLength(1);
  expect(finalLines.find((item) => item.id === firstLines[0].id)?.title).toBe(renamed);
  expect([final.version.total_ht_cents, final.version.total_tax_cents, final.version.total_ttc_cents]).toEqual([80000, 16000, 96000]);
  await evidence(s, "partial-application-stable-parent", { first, final, insertionCalls: generated.calls.filter((call) => call.name === "insertGeneratedOuvrages") });
  await openDialog({ app, browser, screen }, s);
  await expect(screen.getByText("Aucun brouillon à reprendre.", { exact: true })).toBeVisible();
  await expect(screen.getByTestId(`generated-ouvrage-draft-${draft.draftId}`)).toHaveCount(0);
});

generatedTest("GR05 preserves received pages and retries real list and resume responses after failures", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.pagination;
  const pattern = `${new URL(app.baseUrl!).origin}/dashboard/estimates/${s.versionId}/edit`;
  let mode: "list503" | "list-invalid" | "list-incoherent" | "next503" | "resume503" | "pass" = "list503";
  let incoherentFlight = "";
  const intercepted: Array<{ action: string; mode: string }> = [];
  generated.intercept = async (route) => {
    const action = generated.actionNames.get(route.request.headers["next-action"] ?? "") ?? "";
    const next = route.request.postData?.includes('"cursor"') ?? false;
    const block = action === "listResumableGeneratedOuvrageDrafts" && ["list503", "list-invalid", "list-incoherent"].includes(mode)
      || action === "listResumableGeneratedOuvrageDrafts" && mode === "next503" && next
      || action === "fetchResumableGeneratedOuvrageDraft" && mode === "resume503";
    if (block) {
      const failingMode = mode;
      await route.fulfill({ status: ["list-invalid", "list-incoherent"].includes(mode) ? 200 : 503, headers: { "content-type": "text/x-component" }, body: mode === "list-invalid" ? "invalid-flight-response" : mode === "list-incoherent" ? incoherentFlight : "unavailable" });
      intercepted.push({ action, mode: failingMode });
      return true;
    }
    return false;
  };
  await openDialog({ app, browser, screen }, s);
  await expect(screen.getByText(/Impossible de charger les brouillons/)).toBeVisible();
  await expect(screen.getByText("Aucun brouillon à reprendre.", { exact: true })).toHaveCount(0);
  mode = "list-invalid";
  await screen.getByRole("button", "Réessayer", { exact: true }).tap();
  await expect.poll(() => intercepted.filter((entry) => entry.mode === "list-invalid").length).toBe(1);
  await expect(screen.getByText(/Impossible de charger les brouillons/)).toBeVisible();
  await expect(screen.getByText("Aucun brouillon à reprendre.", { exact: true })).toHaveCount(0);
  mode = "pass";
  const validPageResponse = browser.waitForResponse(pattern, { timeout: 30_000 });
  await screen.getByRole("button", "Réessayer", { exact: true }).tap();
  const template = await (await validPageResponse).text();
  await expect(screen.getByTestId(/^generated-ouvrage-draft-/)).toHaveCount(20);
  let changedRecords = 0;
  incoherentFlight = template.split("\n").map((line) => {
    const matched = line.match(/^([0-9a-f]+:)(\{.*\})$/i);
    if (!matched) return line;
    try {
      const value = JSON.parse(matched[2]) as ActionResult;
      if (value.ok === true && value.data?.versionId === s.versionId && Array.isArray(value.data.items)) {
        changedRecords += 1;
        return matched[1] + JSON.stringify({ ...value, data: { ...value.data, nextCursor: 42 } });
      }
    } catch { /* Preserve all non-envelope Flight records exactly. */ }
    return line;
  }).join("\n");
  expect(changedRecords).toBe(1);
  mode = "list-incoherent";
  await screen.getByRole("button", "Actualiser la liste", { exact: true }).tap();
  await expect.poll(() => intercepted.filter((entry) => entry.mode === "list-incoherent").length).toBe(1);
  await expect(screen.getByText(/Impossible de charger les brouillons/)).toBeVisible();
  await expect(screen.getByText("Aucun brouillon à reprendre.", { exact: true })).toHaveCount(0);
  mode = "pass";
  await screen.getByRole("button", "Réessayer", { exact: true }).tap();
  await expect(screen.getByTestId(/^generated-ouvrage-draft-/)).toHaveCount(20);
  mode = "next503";
  await screen.getByRole("button", "Charger la suite", { exact: true }).tap();
  await expect.poll(() => intercepted.filter((entry) => entry.mode === "next503").length).toBe(1);
  expect(await listedIds(browser)).toEqual(generated.fixture.paginationOrder.slice(0, 20));
  await expect(screen.getByText("Tous les brouillons disponibles sont affichés.", { exact: true })).toHaveCount(0);
  mode = "pass";
  await screen.getByRole("button", "Réessayer", { exact: true }).tap();
  await expect(screen.getByTestId(/^generated-ouvrage-draft-/)).toHaveCount(21);
  mode = "resume503";
  const finalId = generated.fixture.paginationOrder[20];
  await screen.getByTestId(`generated-ouvrage-draft-${finalId}`).getByRole("button", "Reprendre", { exact: true }).tap();
  await expect.poll(() => intercepted.filter((entry) => entry.mode === "resume503").length).toBe(1);
  await expect(screen.getByText(/Impossible de reprendre ce brouillon/)).toBeVisible();
  expect(await listedIds(browser)).toEqual(generated.fixture.paginationOrder);
  await evidence(s, "failure-retains-all-pages", { intercepted, displayed: await listedIds(browser), estimate: await readEstimate(browser, s.versionId) });
  mode = "pass";
  await screen.getByRole("button", "Réessayer la reprise", { exact: true }).tap();
  const finalDraft = s.drafts.find((draft) => draft.draftId === finalId)!;
  await expect(screen.getByTestId(`candidate-card-${finalDraft.candidates[0].candidateId}`)).toBeVisible();
  expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
  expect(intercepted.map((entry) => entry.mode)).toEqual(["list503", "list-invalid", "list-incoherent", "next503", "resume503"]);
});

generatedTest("GR06 ignores an outstanding real resume when its dialog closes and another version opens", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.late, other = generated.fixture.scenarios.failure;
  await openDialog({ app, browser, screen }, s);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let observed = false, released = false;
  const pattern = `${new URL(app.baseUrl!).origin}/dashboard/estimates/${s.versionId}/edit`;
  generated.intercept = async (route) => {
    if (generated.actionNames.get(route.request.headers["next-action"] ?? "") === "fetchResumableGeneratedOuvrageDraft") {
      observed = true;
      await held;
      await route.fallback();
      released = true;
      return true;
    }
    return false;
  };
  try {
    await screen.getByTestId(`generated-ouvrage-draft-${s.drafts[0].draftId}`).getByRole("button", "Reprendre", { exact: true }).tap();
    await expect.poll(() => observed).toBe(true);
    await browser.keyboard.press("Escape");
    await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
    const delivered = browser.waitForResponse(pattern, { timeout: 30_000 });
    release();
    await expect.poll(() => released).toBe(true);
    const response = await delivered;
    const flight = await response.text();
    expect(response.status).toBe(200);
    expect(flight.includes(s.drafts[0].draftId)).toBe(true);
    await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
    await expect(screen.getByTestId(`candidate-card-${s.drafts[0].candidates[0].candidateId}`)).toHaveCount(0);
    await releaseCurrentOwnedLock(browser, [s.versionId]);
    await openDialog({ app, browser, screen }, other);
    await expect(screen.getByTestId(`generated-ouvrage-draft-${other.drafts[0].draftId}`)).toBeVisible();
    await expect(screen.getByTestId(`candidate-card-${s.drafts[0].candidates[0].candidateId}`)).toHaveCount(0);
    await browser.keyboard.press("Escape");
    generated.intercept = undefined;
    await releaseCurrentOwnedLock(browser, [other.versionId]);
    await openDialog({ app, browser, screen }, s);
    await resume(screen, s.drafts[0]);
    expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
    await evidence(s, "late-resume-scoped", { observed, released, responseStatus: response.status, responseFullyRead: true, dialogStillClosedAfterResponse: true, otherVersion: other.versionId, noAutomaticInsertion: true });
  } finally { release(); }
});

generatedTest("GR07 refuses a displayed draft after a real rejection and refreshes the stale list", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.stale, draft = s.drafts[0];
  await openDialog({ app, browser, screen }, s);
  await resume(screen, draft);
  const readCall = lastCall(generated, "fetchResumableGeneratedOuvrageDraft");
  await browser.keyboard.press("Escape");
  await openDialog({ app, browser, screen }, s);
  await expect(screen.getByTestId(`generated-ouvrage-draft-${draft.draftId}`)).toBeVisible();
  const rejectionAction = [...generated.actionNames].find(([, name]) => name === "rejectGeneratedOuvrageDraft")?.[0];
  if (!rejectionAction) throw new Error("The real rejection action must exist in this build.");
  const rejected = await browser.evaluate(async (request) => {
    const response = await fetch(location.pathname, { method: "POST", credentials: "same-origin", headers: { "next-action": request.actionId, "content-type": "text/plain;charset=UTF-8", accept: "text/x-component" }, body: JSON.stringify([{ draftId: request.draftId, candidateId: request.candidateId }]) });
    return { status: response.status };
  }, { actionId: rejectionAction, draftId: draft.draftId, candidateId: draft.candidates[0].candidateId });
  expect(rejected.status).toBe(200);
  const refused = await replayAction(browser, readCall, { versionId: s.versionId, draftId: draft.draftId });
  expect(refused.result.ok).toBe(false);
  expect(refused.result.error?.code).toBe("GENERATED_OUVRAGE_NOT_RESUMABLE");
  expect(refused.result.data).toBeUndefined();
  await screen.getByTestId(`generated-ouvrage-draft-${draft.draftId}`).getByRole("button", "Reprendre", { exact: true }).tap();
  await expect(screen.getByText(/Impossible de reprendre ce brouillon/)).toBeVisible();
  await expect(screen.getByTestId(`generated-ouvrage-draft-${draft.draftId}`)).toHaveCount(0);
  expect((await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line")).toHaveLength(0);
  await evidence(s, "stale-list-rejection", { rejected, refused, insertionCalls: generated.calls.filter((call) => call.name === "insertGeneratedOuvrages") });
});

async function artifactFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? artifactFiles(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}
generatedTest("GR08 preserves the explicitly reviewed parent unit in API UI and the real DPGF workbook", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, generated }) => {
  const s = generated.fixture.scenarios.unit, draft = s.drafts[0], candidate = draft.candidates[0];
  const readOnlyDiagnostic = process.env.E2E_GENERATED_OUVRAGE_UNIT_READONLY === "1";
  if (readOnlyDiagnostic) {
    await app.open(`/dashboard/estimates/${s.versionId}/edit`);
    const prior = await readEstimate(browser, s.versionId);
    expect(prior.items.filter((item) => item.item_type === "line")).toHaveLength(1);
    await evidence(s, "unit-readonly-diagnostic-existing-application", { prior, readOnlyDiagnostic, fullJourneyQualified: false });
  } else {
    await openDialog({ app, browser, screen }, s);
    await resume(screen, draft);
    const card = screen.getByTestId(`candidate-card-${candidate.candidateId}`);
    await card.getByRole("button", "Modifier", { exact: true }).tap();
    await card.getByTestId("edit-unit").fill("m");
    await card.getByTestId("edit-quantity").fill("10");
    await card.getByRole("button", "Valider la ligne", { exact: true }).tap();
    await reviewAndInsert({ app, browser, screen }, draft, candidate);
  }
  await waitForObservedAutosave(browser, s, 40000, "shortcut");
  await reloadEditor({ app, browser, screen }, s);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const estimate = await readEstimate(browser, s.versionId);
  const lines = estimate.items.filter((item) => item.item_type === "line");
  expect(lines).toHaveLength(1);
  const uiUnit = await screen.getByLabel(`Unité pour ${candidate.designation}`, { exact: true }).inputValue();
  const root = sdkResultsRoot();
  if (!root.startsWith(path.resolve(".e2e/product-foundation/runs") + path.sep)) throw new Error("Explicit current download artifact root required.");
  const before = new Set(await artifactFiles(root));
  await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
  const download = await browser.waitForDownload(() => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 });
  const returned = path.normalize(download.path);
  if (returned.split(path.sep).includes("..")) throw new Error("Unsafe download path.");
  const candidates = (await artifactFiles(root)).filter((file) => !before.has(file) && (path.isAbsolute(returned) ? file === returned : file.endsWith(path.sep + returned)));
  expect(candidates).toHaveLength(1);
  const bytes = await readFile(candidates[0]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const worksheet = workbook.getWorksheet("Données");
  expect(worksheet).toBeDefined();
  const rows: ExcelJS.Row[] = [];
  worksheet!.eachRow((row) => { if (row.getCell(2).text === lines[0].id) rows.push(row); });
  expect(rows).toHaveLength(1);
  const dpgfUnit = rows[0].getCell(5).text;
  await evidence(s, "unit-api-ui-dpgf-before-assertion", { parent: lines[0], uiUnit, dpgfUnit, acceptedCalls: generated.calls.filter((call) => ["updateGeneratedOuvrageSubdetailDraft", "insertGeneratedOuvrages"].includes(call.name)), download: { path: candidates[0], sha256: createHash("sha256").update(bytes).digest("hex"), filename: download.suggestedFilename } });
  expect({ apiUnit: lines[0].description, uiUnit, dpgfUnit }).toEqual({ apiUnit: "m", uiUnit: "m", dpgfUnit: "m" });
  expect([rows[0].getCell(3).text, rows[0].getCell(4).value, rows[0].getCell(6).value]).toEqual([`  ${candidate.designation}`, 10, 40]);
  expect([estimate.version.total_ht_cents, estimate.version.total_tax_cents, estimate.version.total_ttc_cents]).toEqual([40000, 8000, 48000]);
});

generatedTest("GR09 preserves exact costs and hours in both projections or refuses the whole batch before writes", {
  session: "army", trace: "off", timeout: 360_000,
}, async ({ app, browser, screen, generated }) => {
  const matrix = generated.fixture.costMatrix;
  expect(matrix?.map((entry) => entry.scenario)).toEqual(["cost_base", "cost_loss", "cost_yield", "cost_canonical_inexact", "cost_parent_inexact", "cost_batch"]);
  const client = createClient(generated.fixture.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const auth = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (auth.error || auth.data.user?.id !== generated.fixture.owner.userId) throw new Error("Ordinary cost projection read authentication failed.");
  for (const oracle of matrix!) {
    const s = generated.fixture.scenarios[oracle.scenario], draft = s.drafts[0];
    const readState = async () => {
      const state: Record<string, Array<Record<string, unknown>>> = {};
      for (const [table, column, value] of [
        ["estimate_items", "version_id", s.versionId],
        ["estimate_generated_ouvrage_applications", "target_version_id", s.versionId],
        ["estimate_generated_ouvrage_work_snapshots", "target_version_id", s.versionId],
        ["estimate_assemblies", "source_metadata->>draft_id", draft.draftId],
        ["estimate_generated_ouvrage_candidates", "target_version_id", s.versionId],
        ["estimate_generated_ouvrage_subdetail_drafts", "target_version_id", s.versionId],
      ]) {
        const read = await client.from(table).select("*").eq("tenant_id", generated.fixture.owner.tenantId).eq(column, value).order("id");
        if (read.error) throw new Error(`Ordinary ${table} inspection failed: ${read.error.code}`);
        state[table] = read.data;
      }
      const ids = state.estimate_assemblies.map((row) => row.id as string);
      state.estimate_assembly_items = [];
      if (ids.length) {
        const read = await client.from("estimate_assembly_items").select("*").eq("tenant_id", generated.fixture.owner.tenantId).in("assembly_id", ids).order("position");
        if (read.error) throw new Error("Ordinary canonical component inspection failed.");
        state.estimate_assembly_items = read.data;
      }
      return state;
    };
    await openDialog({ app, browser, screen }, s);
    await resume(screen, draft);
    for (const candidate of draft.candidates) {
      await reviewCandidate({ app, browser, screen }, candidate);
      const select = screen.getByTestId(`candidate-card-${candidate.candidateId}`).getByRole("checkbox", `Sélectionner ${candidate.designation}`, { exact: true });
      if (!await select.isChecked()) await select.check();
    }
    const before = await readState();
    const emptyWrites = (state: typeof before) => ({
      items: state.estimate_items.map((row) => row.id).sort(),
      applications: state.estimate_generated_ouvrage_applications.map((row) => row.id),
      snapshots: state.estimate_generated_ouvrage_work_snapshots.map((row) => row.id),
      assemblies: state.estimate_assemblies.map((row) => row.id),
      canonicalItems: state.estimate_assembly_items.map((row) => row.id),
    });
    expect(emptyWrites(before)).toEqual({ items: [s.sectionA, s.sectionB].sort(), applications: [], snapshots: [], assemblies: [], canonicalItems: [] });
    const insertionActionId = [...generated.actionNames].find(([, name]) => name === "insertGeneratedOuvrages")?.[0];
    if (!insertionActionId) throw new Error("Real insertion action is missing.");
    // A URL-only response waiter may see an aborted RSC GET on this same URL.
    // Observe only the real UI POST with the exact action header. Forward the
    // original request/response unchanged; keep only its safe envelope in RAM.
    await browser.evaluate((request) => {
      const scope = window as Window & { __armyInsertionCapture?: { original: typeof fetch; done: boolean; status: number | null; results: unknown[]; error: string | null; matchedPosts: number } };
      if (scope.__armyInsertionCapture) throw new Error("An insertion observer is already installed.");
      const capture = { original: window.fetch, done: false, status: null as number | null, results: [] as unknown[], error: null as string | null, matchedPosts: 0 };
      scope.__armyInsertionCapture = capture;
      window.fetch = async function(input, init) {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const matches = method === "POST" && url.origin === location.origin && url.pathname === request.pathname && headers.get("next-action") === request.actionId;
        if (matches) capture.matchedPosts += 1;
        const response = await capture.original.call(window, input, init);
        if (matches) {
          capture.status = response.status;
          void response.clone().text().then((flight) => {
            capture.results = flight.split("\n").flatMap((line) => {
              const json = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1];
              if (!json) return [];
              try { const value = JSON.parse(json); return typeof value.ok === "boolean" ? [value] : []; } catch { return []; }
            });
          }).catch((error) => { capture.error = error instanceof Error ? error.message : "Response clone failed."; }).finally(() => { capture.done = true; });
        }
        return response;
      };
      return true;
    }, { actionId: insertionActionId, pathname: `/dashboard/estimates/${s.versionId}/edit` });
    let response: { status: number; results: ActionResult[]; error: string | null; matchedPosts: number };
    try {
      await screen.getByRole("button", "Insérer les ouvrages sélectionnés", { exact: true }).tap();
      await expect.poll(() => browser.evaluate(() => Boolean((window as Window & { __armyInsertionCapture?: { done: boolean } }).__armyInsertionCapture?.done)), { timeout: 30_000 }).toBe(true);
      response = JSON.parse(await browser.evaluate(() => {
        const capture = (window as Window & { __armyInsertionCapture?: { status: number | null; results: unknown[]; error: string | null; matchedPosts: number } }).__armyInsertionCapture;
        if (!capture) throw new Error("Insertion observer is missing.");
        return JSON.stringify({ status: capture.status, results: capture.results, error: capture.error, matchedPosts: capture.matchedPosts });
      }));
    } finally {
      await browser.evaluate(() => {
        const scope = window as Window & { __armyInsertionCapture?: { original: typeof fetch } };
        if (scope.__armyInsertionCapture) { window.fetch = scope.__armyInsertionCapture.original; delete scope.__armyInsertionCapture; }
        return true;
      });
    }
    const results = response.results;
    const after = await readState();
    await evidence(s, "cost-projection-after-real-insertion", { oracle, before, after, response });
    expect(response.matchedPosts).toBe(1);
    expect(response.error).toBe(null);
    expect(response.status).toBe(200);
    expect(results).toHaveLength(1);
    const result = results[0];
    expect(result.ok).toBe(oracle.accept);
    if (!oracle.accept) {
      expect(result.error?.code).toBe("EST383_COST_PROJECTION_INEXACT");
      expect(result.data).toBeUndefined();
      expect(emptyWrites(after)).toEqual(emptyWrites(before));
      expect(after.estimate_generated_ouvrage_candidates.map((row) => row.resolution_status)).toEqual(draft.candidates.map(() => "pending"));
      expect(after.estimate_generated_ouvrage_subdetail_drafts.map((row) => row.status)).toEqual(draft.candidates.map(() => "reviewed"));
      await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
      expect(typeof result.error?.message).toBe("string");
      await expect(screen.getByText(result.error!.message, { exact: true })).toBeVisible();
      for (const candidate of draft.candidates) await expect(screen.getByTestId(`candidate-card-${candidate.candidateId}`).getByRole("checkbox")).toBeEnabled();
      await browser.keyboard.press("Escape");
    } else {
      await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
      expect(after.estimate_generated_ouvrage_applications).toHaveLength(1);
      expect(after.estimate_generated_ouvrage_work_snapshots).toHaveLength(1);
      expect(after.estimate_assemblies).toHaveLength(1);
      const canonical = after.estimate_assemblies[0];
      expect([canonical.ds_cents, canonical.indicative_target_price_cents, canonical.unit]).toEqual([oracle.dsCents, oracle.dsCents, "m"]);
      const canonicalItems = after.estimate_assembly_items;
      expect(canonicalItems.map((row) => [row.title, row.default_quantity, row.unit, row.unit_cost_ht_cents])).toEqual(draft.candidates[0].components.map((component) => [component.designation, component.quantity, component.unit, component.unitCostHtCents]));
      expect(canonicalItems.filter((row) => row.cost_type === "labor").reduce((sum, row) => sum + Number(row.h_mo), 0)).toBe(oracle.hours);
      if (oracle.scenario === "cost_yield") expect([canonicalItems[0].h_mo, canonicalItems[0].k_mo, canonicalItems[0].labor_role_id]).toEqual([5, 0.8, null]);
      if (oracle.scenario === "cost_loss") expect(canonicalItems[0].k_fo).toBe(1.05);
    }
    await waitForObservedAutosave(browser, s, oracle.accept ? oracle.dsCents : 0, oracle.accept ? "shortcut" : "automatic");
    await reloadEditor({ app, browser, screen }, s);
    const persisted = await readEstimate(browser, s.versionId);
    const parents = persisted.items.filter((row) => row.item_type === "line");
    expect(parents).toHaveLength(oracle.accept ? 1 : 0);
    const expectedHt = oracle.accept ? oracle.dsCents : 0;
    expect([persisted.version.total_ht_cents, persisted.version.total_tax_cents, persisted.version.total_ttc_cents]).toEqual([expectedHt, Math.round(expectedHt * 0.2), expectedHt + Math.round(expectedHt * 0.2)]);
    if (oracle.accept) expect([parents[0].quantity, parents[0].description, parents[0].h_mo, parents[0].parent_id]).toEqual([draft.candidates[0].quantity, "m", oracle.hours, s.sectionA]);
    await evidence(s, "cost-projection-persisted", { oracle, persisted });
    await releaseCurrentOwnedLock(browser, [s.versionId]);
  }
});
