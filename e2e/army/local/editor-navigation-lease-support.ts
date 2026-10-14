import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

import {
  apiRequest, ownEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState, type ArmyVersion,
} from "../critical/fixtures";

// Observable failures and the unimplemented transport contracts precede this
// harness: docs/testing/editor-navigation-lease.md. No product fault is injected.
export type LeaseUi = { app: App; browser: Browser; screen: Screen; army: ArmyState };
type Envelope<T> = { ok: boolean; data: T };
type Owner = {
  prefix: string; apiUrl: string;
  owner: { userId: string; tenantId: string; laborRoleId: string };
};
export type LeasePrepared = {
  fixture: Owner; versionId: string; projectId: string; sectionId: string;
  lineId: string; title: string; client: SupabaseClient;
};
export type LeaseRequestObservation = {
  sequence: number; interceptedAt: string; continuedAt: string | null;
  method: string; pathname: string; sessionAlias: string | null;
  forced: boolean; responseObserved: false;
};
export type LeaseObserver = {
  requests: LeaseRequestObservation[];
  alias: (identity: string | null | undefined) => string | null;
  rowAlias: (identity: string) => string;
  close: () => Promise<void>;
};

// These are contracts only. There is deliberately no fake adapter, skipped
// journey, fabricated HTTP reply, or claim of an exercised race.
export type LeaseBarrierCase = "NAV02" | "NAV03" | "NAV04a" | "NAV04b" | "NAV06";
export type LeaseBarrierPhase = "before-forward" | "after-server-response";
export type LeaseBarrierProof = {
  caseId: LeaseBarrierCase; originalRequestFullyReceived: boolean;
  receivedAt: string; forwardedAt: string | null; serverRespondedAt: string | null;
  deliveredAt: string | null; downstreamDisconnectedAt: string | null;
  actualServerStatus: number | null; ordinaryLeaseReadConfirmed: boolean;
  reachedPhases: LeaseBarrierPhase[]; originalBytesPreserved: boolean;
};
export interface LeaseTransportBarrier {
  arm(input: { caseId: LeaseBarrierCase; versionId: string; method: "POST" | "DELETE"; phase: LeaseBarrierPhase }): Promise<void>;
  waitUntilHeld(): Promise<LeaseBarrierProof>;
  release(input: { discardCompletedResponse: boolean }): Promise<LeaseBarrierProof>;
}
export const pendingLeaseBarrierContracts = [
  { caseId: "NAV02", phase: "before-forward", status: "contract-only", order: "POST held; depart; DELETE completed; forward original POST; return" },
  { caseId: "NAV03", phase: "after-server-response", status: "contract-only", order: "POST 201 and ordinary lease read; hold reply; depart; release; return; deliver old reply" },
  { caseId: "NAV04a", phase: "before-forward", status: "contract-only", order: "DELETE held; full navigation; new return lease confirmed; forward old DELETE" },
  { caseId: "NAV04b", phase: "before-forward", status: "contract-only", order: "DELETE held; reload with actual reused identity; new lease confirmed; forward old DELETE" },
  { caseId: "NAV06", phase: "after-server-response", status: "contract-only", order: "POST 201 and ordinary lease read; discard actual reply; return without assuming ownership" },
] as const;

export const leaseTotals = (version: ArmyVersion) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
export const editorPath = (p: LeasePrepared) => `/dashboard/estimates/${p.versionId}/edit`;
const safeError = (error: unknown) => ({ errorName: error instanceof Error ? error.name : "UnknownError" });

async function loadOwner(): Promise<Owner> {
  const file = process.env.E2E_CREATE_ATOMIC_FIXTURE_PATH;
  if (!file) throw new Error("Explicit local owner fixture required for navigation leases.");
  const value = JSON.parse(await readFile(file, "utf8"));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (value.schemaVersion !== "estimate-create-atomic-fixture-1" || value.status !== "ready" ||
    !value.prefix?.startsWith("ARMY-CREATE-ATOMIC-") || value.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN ||
    value.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !["userId", "tenantId", "laborRoleId"].every((field) => uuid.test(value.owner?.[field] ?? ""))) {
    throw new Error("Navigation owner differs from the reviewed local batch profile.");
  }
  const origin = new URL(value.apiUrl);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.username || origin.password ||
    origin.search || origin.hash || origin.pathname !== "/") throw new Error("Navigation leases require the explicit loopback stack.");
  return value as Owner;
}

async function setupLease(browser: Browser, versionId: string, release = false) {
  return browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let session = sessions.get(input.versionId);
    if (!session && !input.release) {
      session = crypto.randomUUID(); sessions.set(input.versionId, session);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, session);
    }
    if (!session) throw new Error("Owned fixture lease identity missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin", redirect: "error",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}",
    });
    const body = await response.json();
    const held = body.data?.lock;
    // Never return the raw lock body/session to a harness-recorded evaluate step.
    return { status: response.status, ok: body.ok === true, released: body.data?.released === true,
      current: held?.is_current_user === true && held?.is_current_session === true && held?.is_expired === false,
      versionMatches: held?.version_id === input.versionId, sessionMatches: held?.session_id === session };
  }, { versionId, release });
}

export async function prepareLeaseCase(ui: LeaseUi, label: "NAV01" | "NAV05"): Promise<LeasePrepared> {
  const fixture = await loadOwner();
  await ui.app.open("/dashboard/estimates");
  const created = await apiRequest<Envelope<{ project: { id: string; tenant_id: string; user_id: string }; version: ArmyVersion }>>(
    ui.browser, "POST", "/api/estimates", {
      project: { name: `${fixture.prefix}-${ui.army.runPrefix}-${label}` },
      version: { title: `${label} navigation du bail`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
        discount_bp: 0, discount_mode: "simple", discount_steps: [], global_coefficient: 1, tax_rate_bp: 2000,
        rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR", contractor_role: "principal" },
    });
  await recordEvidence(ui.army, `${label}-created-version`, created);
  expect(created.status).toBe(201); expect(created.body.ok).toBe(true);
  const { project, version } = created.body.data;
  ownEstimate(ui.army, { projectId: project.id, versionId: version.id });
  expect([project.tenant_id, project.user_id]).toEqual([fixture.owner.tenantId, fixture.owner.userId]);
  const acquired = await setupLease(ui.browser, version.id);
  await recordEvidence(ui.army, `${label}-fixture-acquisition`, acquired);
  expect([acquired.status, acquired.ok, acquired.current, acquired.versionMatches, acquired.sessionMatches]).toEqual([201, true, true, true, true]);
  const initial = await apiRequest<Envelope<{ version: ArmyVersion; items: ArmyItem[] }>>(ui.browser, "GET", `/api/estimates/${version.id}`);
  await recordEvidence(ui.army, `${label}-empty-fixture`, initial);
  expect(initial.status).toBe(200); expect(initial.body.ok).toBe(true);
  expect(initial.body.data.items).toHaveLength(0); expect(initial.body.data.version.calc_engine_version).toBe(2);
  const section = await apiRequest<Envelope<{ item: ArmyItem; version: ArmyVersion }>>(ui.browser, "POST", `/api/estimates/${version.id}/items`, {
    item_type: "section", title: `${label} lot`, position: 1,
  }, { "if-match": initial.body.data.version.updated_at });
  await recordEvidence(ui.army, `${label}-fixture-section`, section);
  expect(section.status).toBe(201); expect(section.body.ok).toBe(true);
  const state = await apiRequest<Envelope<{ version: ArmyVersion; items: ArmyItem[] }>>(ui.browser, "GET", `/api/estimates/${version.id}`);
  await recordEvidence(ui.army, `${label}-fixture-before-line`, state);
  expect(state.status).toBe(200); expect(state.body.ok).toBe(true);
  const title = `${label} ligne du bail`;
  const line = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${version.id}/items`, {
    item_type: "line", parent_id: section.body.data.item.id, title, position: 1, description: "u", line_nature: "supply_only",
    quantity: 2, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
    labor_role_id: null, source_provider: "manual",
  }, { "if-match": state.body.data.version.updated_at });
  await recordEvidence(ui.army, `${label}-fixture-line`, line);
  expect(line.status).toBe(201); expect(line.body.ok).toBe(true);
  // Ordinary fixture completion, before the tested editor is opened. No failed
  // journey is released, repaired or cleaned up by this harness.
  const released = await setupLease(ui.browser, version.id, true);
  await recordEvidence(ui.army, `${label}-fixture-release`, released);
  expect([released.status, released.ok, released.released, released.sessionMatches]).toEqual([200, true, true, true]);
  const client = createClient(fixture.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  await recordEvidence(ui.army, `${label}-ordinary-observer`, {
    succeeded: !login.error, expectedActor: login.data.user?.id === fixture.owner.userId, serviceRole: false,
  });
  if (login.error || login.data.user?.id !== fixture.owner.userId) throw new Error("Ordinary navigation observer authentication failed.");
  return { fixture, versionId: version.id, projectId: project.id, sectionId: section.body.data.item.id,
    lineId: line.body.data.item.id, title, client };
}

export async function observeLeaseRequests(ui: LeaseUi, p: LeasePrepared): Promise<LeaseObserver> {
  const sessions = new Map<string, string>();
  const rows = new Map<string, string>();
  const alias = (identity: string | null | undefined) => {
    if (!identity) return null;
    if (!sessions.has(identity)) sessions.set(identity, `S${sessions.size + 1}`);
    return sessions.get(identity)!;
  };
  const rowAlias = (identity: string) => {
    if (!rows.has(identity)) rows.set(identity, `B${rows.size + 1}`);
    return rows.get(identity)!;
  };
  const requests: LeaseRequestObservation[] = [];
  const pattern = new RegExp(`/api/estimates/${p.versionId}(?:/|$)`);
  await ui.browser.route(pattern, async (route) => {
    const url = new URL(route.request.url);
    if (route.request.method !== "GET") {
      const entry: LeaseRequestObservation = { sequence: requests.length + 1, interceptedAt: new Date().toISOString(),
        continuedAt: null, method: route.request.method, pathname: url.pathname,
        sessionAlias: alias(route.request.headers["x-estimate-draft-lock-session-id"]),
        forced: url.searchParams.has("force"), responseObserved: false };
      requests.push(entry);
      entry.continuedAt = new Date().toISOString();
    }
    // continue/fallback is not a server response or a commit observation.
    await route.continue();
  });
  return { requests, alias, rowAlias, close: () => ui.browser.unroute(pattern) };
}

export async function documentObservation(browser: Browser, title: string, versionId: string) {
  return browser.evaluate((input) => {
    const quantity = Array.from(document.querySelectorAll("input")).find((node) => node.getAttribute("aria-label") === `Quantité pour ${input.title}`);
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { observedAt: new Date().toISOString(), pathname: location.pathname, timeOrigin: performance.timeOrigin,
      navigationType: navigation?.type ?? null, readyState: document.readyState,
      h1: Array.from(document.querySelectorAll("h1")).map((node) => node.textContent?.trim() ?? ""),
      sessionPresent: sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`) !== null,
      quantityFound: Boolean(quantity), quantityEnabled: quantity ? !quantity.disabled : null, quantity: quantity?.value ?? null,
      lockMessage: document.querySelector('[data-testid="estimate-editor-alert-draft-locked"]')?.textContent ?? null,
      lockError: document.querySelector('[data-testid="estimate-editor-alert-draft-lock-error"]')?.textContent ?? null,
      autosave: document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? null };
  }, { title, versionId });
}

async function ordinaryRlsObservation(p: LeasePrepared, observer: LeaseObserver) {
  const [lease, version, items] = await Promise.all([
    p.client.from("draft_locks").select("id,version_id,tenant_id,user_id,session_id,locked_at,expires_at,created_at").eq("tenant_id", p.fixture.owner.tenantId).eq("version_id", p.versionId),
    p.client.from("estimate_versions").select("id,project_id,status,updated_at,total_ht_cents,total_tax_cents,total_ttc_cents").eq("tenant_id", p.fixture.owner.tenantId).eq("id", p.versionId),
    p.client.from("estimate_items").select("id,item_type,parent_id,position,title,quantity,unit_price_ht_cents,tax_rate_bp,line_total_ht_cents,line_tax_cents,line_total_ttc_cents,source_provider").eq("tenant_id", p.fixture.owner.tenantId).eq("version_id", p.versionId).order("id"),
  ]);
  return { observedAt: new Date().toISOString(), errors: { lease: lease.error?.code ?? null, version: version.error?.code ?? null, items: items.error?.code ?? null },
    leases: (lease.data ?? []).map((row) => ({ rowAlias: observer.rowAlias(row.id), sessionAlias: observer.alias(row.session_id),
      expectedVersion: row.version_id === p.versionId, expectedTenant: row.tenant_id === p.fixture.owner.tenantId,
      expectedActor: row.user_id === p.fixture.owner.userId, lockedAt: row.locked_at, expiresAt: row.expires_at,
      expired: Date.parse(row.expires_at) <= Date.now(), createdAt: row.created_at })),
    versions: version.data ?? [], items: items.data ?? [] };
}

export async function leaseCheckpoint(ui: LeaseUi, p: LeasePrepared, observer: LeaseObserver, label: string, detail: unknown = null) {
  const rls = await ordinaryRlsObservation(p, observer).catch((error: unknown) => ({ failed: true, ...safeError(error) }));
  const document = await documentObservation(ui.browser, p.title, p.versionId).catch((error: unknown) => ({ failed: true, ...safeError(error) }));
  const popup = await clonedPopupObservation(ui, p).catch((error: unknown) => ({ failed: true, ...safeError(error) }));
  const response = await apiRequest<Envelope<{ version: ArmyVersion; items: ArmyItem[] }>>(ui.browser, "GET", `/api/estimates/${p.versionId}`)
    .catch((error: unknown) => ({ status: null, body: null, ...safeError(error) }));
  const financial: ArmyEstimate | null = response.body?.ok && response.body.data?.version && response.body.data?.items
    ? { project: response.body.data.version.estimate_projects, version: response.body.data.version, items: response.body.data.items } : null;
  const observation = { label, detail, document, popup, rls, apiStatus: response.status, financial, requests: [...observer.requests],
    barrierCases: pendingLeaseBarrierContracts, forcedRequests: observer.requests.filter((request) => request.forced).length };
  await recordEvidence(ui.army, label, observation);
  return observation;
}

export async function withLeaseEvidence(ui: LeaseUi, p: LeasePrepared, observer: LeaseObserver, label: string, body: () => Promise<void>) {
  let failure: { errorName: string } | null = null;
  try { await body(); }
  catch (error) { failure = safeError(error); throw error; }
  finally {
    try { await leaseCheckpoint(ui, p, observer, `${label}-terminal`, { failure, cleanup: "none", repair: "none" }); }
    finally { await observer.close(); }
  }
}

export async function leaseEditorReady(ui: LeaseUi, p: LeasePrepared, timeout = 10_000) {
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout });
  await expect(ui.screen.getByLabel(`Quantité pour ${p.title}`, { exact: true })).toBeEnabled({ timeout });
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/, { timeout });
}

type PopupMemory = { popup: Window; originalSession: string; firstPopupSession: string | null };
type PopupScope = typeof window & { __armyLeasePopup?: PopupMemory };

export async function openClonedLeasePopup(ui: LeaseUi, p: LeasePrepared) {
  const observation = await ui.browser.evaluate((input) => {
    const scope = window as PopupScope;
    const key = `__miaouffrageEstimateDraftLockSession:${input.versionId}`;
    const originalSession = sessionStorage.getItem(key);
    if (!originalSession) return { opened: false, clonedBeforeNavigation: false, reason: "original-session-missing" };
    const popup = window.open("about:blank", input.popupName);
    if (!popup) return { opened: false, clonedBeforeNavigation: false, reason: "popup-blocked" };
    try {
      const clonedBeforeNavigation = popup.sessionStorage.getItem(key) === originalSession;
      scope.__armyLeasePopup = { popup, originalSession, firstPopupSession: null };
      popup.location.href = `${location.origin}/dashboard/estimates/${input.versionId}/edit`;
      return { opened: true, clonedBeforeNavigation, reason: null };
    } catch {
      return { opened: true, clonedBeforeNavigation: false, reason: "popup-reference-inaccessible" };
    }
  }, { versionId: p.versionId, popupName: `ARMY-NAV05-${randomUUID()}` });
  await recordEvidence(ui.army, "NAV05-popup-opened", observation);
  return observation;
}

export async function clonedPopupObservation(ui: LeaseUi, p: LeasePrepared) {
  return ui.browser.evaluate((input) => {
    const unavailable = (reason: string) => ({ observedAt: new Date().toISOString(), accessible: false, reason,
      pathname: null, timeOrigin: null, navigationType: null, readyState: null,
      distinctFromOriginal: false, sameAsFirstPopupSession: false, originalSessionUnchanged: false,
      quantityFound: false, quantityEnabled: null, quantity: null, lockMessage: null, lockError: null });
    const memory = (window as PopupScope).__armyLeasePopup;
    if (!memory) return unavailable("popup-reference-missing");
    try {
      const popup = memory.popup;
      if (popup.closed) return unavailable("popup-closed");
      const key = `__miaouffrageEstimateDraftLockSession:${input.versionId}`;
      const popupSession = popup.sessionStorage.getItem(key);
      const distinctFromOriginal = Boolean(popupSession && popupSession !== memory.originalSession);
      if (distinctFromOriginal && !memory.firstPopupSession) memory.firstPopupSession = popupSession;
      const quantity = Array.from(popup.document.querySelectorAll("input")).find((node) => node.getAttribute("aria-label") === `Quantité pour ${input.title}`);
      const navigation = popup.performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return { observedAt: new Date().toISOString(), accessible: true, reason: null, pathname: popup.location.pathname,
        timeOrigin: popup.performance.timeOrigin, navigationType: navigation?.type ?? null, readyState: popup.document.readyState,
        distinctFromOriginal, sameAsFirstPopupSession: Boolean(popupSession && memory.firstPopupSession === popupSession),
        originalSessionUnchanged: sessionStorage.getItem(key) === memory.originalSession,
        quantityFound: Boolean(quantity), quantityEnabled: quantity ? !quantity.disabled : null, quantity: quantity?.value ?? null,
        lockMessage: popup.document.querySelector('[data-testid="estimate-editor-alert-draft-locked"]')?.textContent ?? null,
        lockError: popup.document.querySelector('[data-testid="estimate-editor-alert-draft-lock-error"]')?.textContent ?? null };
    } catch {
      return unavailable("popup-reference-inaccessible");
    }
  }, { versionId: p.versionId, title: p.title });
}

export async function reloadClonedLeasePopup(ui: LeaseUi) {
  return ui.browser.evaluate(() => {
    const memory = (window as PopupScope).__armyLeasePopup;
    if (!memory || memory.popup.closed) return { attempted: false };
    memory.popup.location.reload();
    return { attempted: true };
  });
}
