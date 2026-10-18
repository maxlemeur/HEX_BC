import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Browser } from "@e2e-dev/web";
import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem } from "../critical/fixtures";
import { localSqlTransport } from "../takeoff/generated-prerequisites";
// Aliased: the sign-up helper is not a React hook, whatever its name.
import { useDedicatedV3Owner as signUpDedicatedOwner } from "./engine-v3-persistence-support";
import { querySql } from "./engine-v3-support";

type SessionMode = "missing" | "different" | "current";
type Envelope<T> = { ok: boolean; data: T };

async function changeLease(browser: Browser, versionId: string, release = false) {
  return browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let session = sessions.get(input.versionId);
    if (!session && !input.release) {
      session = crypto.randomUUID(); sessions.set(input.versionId, session);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, session);
    }
    if (!session) throw new Error("The owned fixture lease identity is missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}",
    });
    const payload = await response.json();
    return { status: response.status, ok: payload.ok === true,
      current: payload.data?.lock?.is_current_session === true,
      released: payload.data?.released === true };
  }, { versionId, release });
}

async function mutate(browser: Browser, input: {
  versionId: string; path: string; method: "POST" | "PATCH"; body: unknown; mode: SessionMode;
}) {
  return browser.evaluate(async (request) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const store = (globalThis as typeof globalThis & {
      __miaouffrageEstimateDraftLockSessions?: Map<string, string>;
    }).__miaouffrageEstimateDraftLockSessions;
    const current = store?.get(request.versionId);
    if (!current) throw new Error("The real page lock identity is missing.");
    if (request.mode !== "missing") {
      headers["x-estimate-draft-lock-session-id"] = request.mode === "current" ? current : crypto.randomUUID();
    }
    const response = await fetch(request.path, { method: request.method, credentials: "same-origin", headers, body: request.body });
    const payload = await response.json();
    // Lock error details contain session identities: never return or retain them.
    return { status: response.status, ok: payload.ok === true, code: payload.error?.code ?? null };
  }, { ...input, body: JSON.stringify(input.body) });
}

armyTest("LOCK01 secondary estimate writes require the owning page session", {
  session: "army", tags: ["critical", "local", "lock-boundaries"], timeout: 180_000,
}, async ({ app, browser, army }) => {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Lock fixture preparation requires the explicitly allowlisted local Supabase.");
  }
  // Prepare this HTTP boundary fixture without mounting a competing editor heartbeat.
  await app.open("/dashboard/affaires");
  const created = await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(browser, "POST", "/api/estimates", {
    project: { name: army.projectName },
    version: { title: "ARMY page lock boundaries", margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
      tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR" },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  const acquired = await changeLease(browser, ids.versionId);
  expect([acquired.status, acquired.ok, acquired.current]).toEqual([201, true, true]);
  const empty = await readEstimate(browser, ids.versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
    item_type: "section", title: `${army.runPrefix} section`, position: 1,
  }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const sectionState = await readEstimate(browser, ids.versionId);
  const createdLine = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
    item_type: "line", parent_id: section.body.data.item.id, title: `${army.runPrefix} lock line`, position: 1,
    description: "u", line_nature: "supply_only", quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000,
    k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: null,
  }, { "if-match": sectionState.version.updated_at });
  expect([createdLine.status, createdLine.body.ok]).toEqual([201, true]);
  const line = createdLine.body.data.item;
  const before = await readEstimate(browser, ids.versionId);
  const tenantId = String(before.version.tenant_id);
  const client = createClient(backend.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || !login.data.user) throw new Error("Ordinary fixture login failed.");
  const owner = await client.from("estimate_projects").select("id, user_id, tenant_id, name").eq("id", ids.projectId).single();
  if (owner.error || owner.data?.user_id !== login.data.user.id || owner.data.tenant_id !== tenantId || owner.data.name !== army.projectName) {
    throw new Error("Fixture owner, tenant or ARMY identity is inconsistent.");
  }
  const tenant = await client.from("tenants").select("name").eq("id", tenantId).single();
  if (tenant.error || !/^ARMY\b/.test(tenant.data?.name ?? "")) throw new Error("Fixture settings require a dedicated local ARMY tenant.");
  const flag = await client.from("feature_flags").select("enabled").eq("tenant_id", tenantId).eq("flag_key", "EST_163_SUGGESTION_LEARNING").maybeSingle();
  if (flag.error) throw new Error("The local ARMY learning flag could not be read.");
  if (flag.data && flag.data.enabled !== true) throw new Error("An existing disabled learning flag is preserved; this environment is not ready.");
  let createdFlagId: string | null = null;
  try {
    if (!flag.data) {
      const flagId = randomUUID();
      const prepared = await client.from("feature_flags").insert({ id: flagId, tenant_id: tenantId, flag_key: "EST_163_SUGGESTION_LEARNING", enabled: true });
      if (prepared.error) throw new Error(`Temporary local learning flag failed: ${prepared.error.code}`);
      createdFlagId = flagId;
    }
    const structureId = randomUUID(), nodeId = randomUUID(), draftId = randomUUID(), lotId = randomUUID(), draftLineId = randomUUID(), ruleId = randomUUID();
    const common = { tenant_id: tenantId, project_id: ids.projectId, version_id: ids.versionId };
    const fixtures: Array<[string, Record<string, unknown>]> = [
      ["estimate_structure_drafts", { id: structureId, tenant_id: tenantId, project_id: ids.projectId, target_version_id: ids.versionId, created_by: login.data.user.id }],
      ["estimate_structure_draft_nodes", { id: nodeId, tenant_id: tenantId, draft_id: structureId, order_index: 0, hierarchy_level: 1, label: `${army.runPrefix} structure`, normalized_label: "army structure", confidence: 1, default_action: "create" }],
      ["estimate_version_zero_drafts", { ...common, id: draftId, created_by: login.data.user.id }],
      ["estimate_version_zero_lots", { ...common, id: lotId, draft_id: draftId, lot_key: "army-lock", lot_label: "ARMY lock", status: "generated" }],
      ["estimate_version_zero_lines", { ...common, id: draftLineId, draft_id: draftId, lot_id: lotId, proposed_title: `${army.runPrefix} V0`, proposed_quantity: 1, proposed_unit: "u" }],
      ["estimate_suggestion_rules", { id: ruleId, tenant_id: tenantId, user_id: login.data.user.id, name: `${army.runPrefix} lock rule`, match_value: army.runPrefix, match_type: "keyword", is_active: true }],
    ];
    for (const [table, row] of fixtures) {
      const result = await client.from(table).insert(row);
      if (result.error) throw new Error(`Local RLS fixture ${table} failed: ${result.error.code}`);
    }
    await recordEvidence(army, "lock-boundary-fixtures", { ...ids, itemId: line.id, structureId, nodeId, draftId, lotId, draftLineId, ruleId });

    async function readBusiness() {
      const snapshot = await readEstimate(browser, ids.versionId);
      const records: Record<string, unknown> = {};
      for (const [table, column, value] of [
        ["estimate_structure_drafts", "id", structureId],
        ["estimate_structure_draft_applications", "draft_id", structureId],
        ["estimate_version_zero_lines", "id", draftLineId],
        ["suggestion_corrections", "rule_id", ruleId],
        ["estimate_item_outlier_dismissals", "item_id", line.id],
      ]) {
        const result = await client.from(table).select("*").eq("tenant_id", tenantId).eq(column, value).order("id");
        if (result.error) throw new Error(`Ordinary ${table} observation failed: ${result.error.code}`);
        records[table] = result.data;
      }
      return { version: snapshot.version, items: snapshot.items, records };
    }

    const cases = [
      { name: "outlier", expectedStatus: 200, method: "POST" as const, path: `/api/estimates/${ids.versionId}/outliers`, body: { item_id: line.id, flag_key: "price_outlier", dismissed: true } },
      { name: "v0-review", expectedStatus: 200, method: "PATCH" as const, path: `/api/estimates/${ids.versionId}/version-zero-drafts/${draftId}/lines/${draftLineId}`, body: { review_status: "accepted" } },
      { name: "learning", expectedStatus: 200, method: "POST" as const, path: `/api/estimates/${ids.versionId}/suggestion-learning`, body: { corrections: [{ rule_id: ruleId, field_name: "description", original_value: "before", corrected_value: "after", item_title: army.runPrefix }] } },
      { name: "structure", expectedStatus: 201, method: "POST" as const, path: `/api/estimates/${ids.versionId}/structure-drafts/${structureId}/apply`, body: { mode: "merge_existing", selected_root_node_ids: [nodeId] } },
    ];
    const refusals: Array<{ caseName: string; mode: SessionMode; response: Awaited<ReturnType<typeof mutate>>; unchanged: boolean }> = [];
    for (const entry of cases) {
      const baseline = await readBusiness();
      for (const mode of ["missing", "different"] as const) {
        const renewed = await changeLease(browser, ids.versionId);
        expect([renewed.status, renewed.ok, renewed.current]).toEqual([201, true, true]);
        const response = await mutate(browser, { ...entry, versionId: ids.versionId, mode });
        const after = await readBusiness();
        await recordEvidence(army, `lock-${entry.name}-${mode}`, { response, expectedStatus: 409, unchanged: JSON.stringify(after) === JSON.stringify(baseline), before: baseline, after });
        refusals.push({ caseName: entry.name, mode, response, unchanged: JSON.stringify(after) === JSON.stringify(baseline) });
      }
    }
    await recordEvidence(army, "lock-boundary-refusals", refusals);
    for (const refusal of refusals) {
      expect(refusal.response.status, `${refusal.caseName}/${refusal.mode}`).toBe(409);
      expect(refusal.response.ok).toBe(false);
      expect(refusal.response.code).toBe("CONFLICT");
      expect(refusal.unchanged).toBe(true);
    }
    for (const entry of cases) {
      const renewed = await changeLease(browser, ids.versionId);
      expect([renewed.status, renewed.ok, renewed.current]).toEqual([201, true, true]);
      const response = await mutate(browser, { ...entry, versionId: ids.versionId, mode: "current" });
      const after = await readBusiness();
      await recordEvidence(army, `lock-${entry.name}-current`, { response, expectedStatus: entry.expectedStatus, after });
      expect(response.status).toBe(entry.expectedStatus);
      expect(response.ok).toBe(true);
      if (entry.name === "outlier") expect(after.records.estimate_item_outlier_dismissals).toMatchObject([{ item_id: line.id, flag_key: "price_outlier" }]);
      if (entry.name === "v0-review") expect(after.records.estimate_version_zero_lines).toMatchObject([{ id: draftLineId, review_status: "accepted" }]);
      if (entry.name === "learning") expect(after.records.suggestion_corrections).toMatchObject([{ rule_id: ruleId, original_value: "before", corrected_value: "after" }]);
      if (entry.name === "structure") {
        expect(after.records.estimate_structure_drafts).toMatchObject([{ id: structureId, status: "applied" }]);
        expect(after.items.filter((item) => item.title === `${army.runPrefix} structure`)).toHaveLength(1);
      }
      expect([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents])
        .toEqual([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]);
    }
    const released = await changeLease(browser, ids.versionId, true);
    expect([released.status, released.ok, released.released]).toEqual([200, true, true]);
    await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await browser.reload();
    expect((await readEstimate(browser, ids.versionId)).items.filter((item) => item.title === `${army.runPrefix} structure`)).toHaveLength(1);
  } finally {
    if (createdFlagId) {
      const restored = await client.from("feature_flags").delete().eq("id", createdFlagId).eq("tenant_id", tenantId).eq("flag_key", "EST_163_SUGGESTION_LEARNING").select("id");
      await recordEvidence(army, "lock-boundary-flag-restored", { createdForRun: true, restored: !restored.error && restored.data?.length === 1 });
      if (restored.error || restored.data?.length !== 1) throw new Error("The temporary local learning flag could not be removed.");
    }
  }
});

/* ---------- LOCK02: a forced takeover against a lease acquisition still in flight ---------- */

// V3E03 flake (docs/testing/v3e03-draft-lock-takeover.md): the editor's own acquisition (POST /lock,
// one PostgREST INSERT) and an admin's forced takeover (PATCH /lock?force=true, the RPC
// takeover_estimate_draft_lock) reached the same empty lease slot together, and the forced takeover
// failed with 23505 (HTTP 409). The race is driven here in a fixed order: the in-flight half is a
// second PostgreSQL session held open inside its transaction, the HTTP request is sent, the journey
// waits until PostgreSQL reports that request blocked by the held session, then commits it.
type LockView = { is_current_session: boolean; is_current_user: boolean; user_id: string };
type LockEnvelope = {
  ok: boolean;
  data?: { lock: LockView | null; released?: boolean };
  error?: { code: string; details?: { code?: string; lock?: LockView } };
};
type HeldTransaction = ReturnType<typeof openTransaction>;

const LEASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const pause = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/**
 * A PostgreSQL session of the owned local stack left open inside its transaction. psql runs each
 * statement as soon as it reads it; whether it has run is read from pg_stat_activity (by
 * application_name), never from psql's buffered output.
 */
function openTransaction(name: string, statements: string) {
  const transport = localSqlTransport();
  const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  let exitCode: number | null | undefined;
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8_192); });
  child.stdin.on("error", () => { /* The exit code reports a refused or closed SQL session. */ });
  const exited = new Promise<number | null>(resolve => {
    child.once("error", () => { exitCode = -1; resolve(-1); });
    child.once("close", code => { exitCode = code; resolve(code); });
  });
  // The transport runs psql with VERBOSITY=sqlstate: only the SQLSTATE is printed.
  const outcome = () => `exit=${exitCode}, SQLSTATE=${/ERROR:\s*([0-9A-Z]{5})\b/.exec(stderr)?.[1] ?? "none"}`;
  child.stdin.write(`SET application_name = '${name}';\nBEGIN;\n${statements}`);
  return {
    name,
    ended: () => exitCode !== undefined,
    outcome,
    async commit() {
      child.stdin.end("COMMIT;\n");
      if ((await exited) !== 0) throw new Error(`The held transaction ${name} did not commit: ${outcome()}; no retry.`);
    },
    abort() {
      if (exitCode === undefined) { child.stdin.destroy(); child.kill(); }
    },
  };
}

/** Until the held session has written its row and waits, idle, inside its transaction. */
async function waitUntilHeld(held: HeldTransaction) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (held.ended()) throw new Error(`The held transaction ${held.name} ended before holding: ${held.outcome()}; no retry.`);
    const [row] = await querySql(`SELECT coalesce(bool_and(state = 'idle in transaction' AND backend_xid IS NOT NULL), false)
FROM pg_stat_activity WHERE application_name = '${held.name}';\n`);
    if (row === "t") return;
    await pause(100);
  }
  throw new Error(`The held transaction ${held.name} never reached its held state; no retry.`);
}

/**
 * Until PostgreSQL reports a backend running `statement` blocked by the held session, or the HTTP
 * request settles first (then null: the order the scenario requires was not reached).
 */
async function waitUntilBlocked(held: HeldTransaction, statement: string, request: { settled: boolean }) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline && !request.settled) {
    const [row] = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_object('waitEventType', w.wait_event_type, 'waitEvent', w.wait_event)), '[]'::jsonb)
FROM pg_stat_activity h JOIN pg_stat_activity w ON h.pid = ANY(pg_catalog.pg_blocking_pids(w.pid))
WHERE h.application_name = '${held.name}' AND w.query ILIKE '%${statement}%';\n`);
    const waits = JSON.parse(row ?? "[]") as Array<{ waitEventType: string | null; waitEvent: string | null }>;
    if (waits.length > 0) return waits[0];
    await pause(100);
  }
  return null;
}

/** Sends one lease request without awaiting it; `settled` turns true when its response is back. */
function sendLeaseRequest(browser: Browser, method: "POST" | "PATCH", pathname: string) {
  const request = { settled: false };
  const response = apiRequest<LockEnvelope>(browser, method, pathname).finally(() => { request.settled = true; });
  response.catch(() => { /* Awaited below; a transport failure fails the scenario there. */ });
  return { request, response };
}

/** The lease rows of the version, compared in SQL with identities kept in memory (never archived). */
async function readLease(versionId: string, userId: string, sessionId: string) {
  const [row] = await querySql(`SELECT jsonb_build_object('rows', count(*),
  'session', coalesce(bool_and(session_id = '${sessionId}'::uuid), false), 'owner', coalesce(bool_and(user_id = '${userId}'::uuid), false))
FROM public.draft_locks WHERE version_id = '${versionId}'::uuid;\n`);
  return JSON.parse(row ?? "null") as { rows: number; session: boolean; owner: boolean };
}

const lockView = (lock: LockView | null | undefined, userId: string) =>
  lock ? { currentSession: lock.is_current_session, currentUser: lock.is_current_user, owner: lock.user_id === userId } : null;

armyTest("LOCK02 a forced takeover wins over a lease acquisition still in flight, and an acquisition never wins over a takeover in flight", {
  session: "army", tags: ["critical", "local", "lock-boundaries"], timeout: 180_000,
}, async ({ app, browser, army }) => {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("LOCK02 requires the owned local Supabase stack and its SQL route.");
  }
  // A dedicated owner, admin of its own tenant: the forced takeover is an admin action, and no
  // concurrent journey reaches this tenant.
  const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix);
  await app.open("/dashboard/affaires");
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name: army.projectName },
    version: { title: `${army.runPrefix} lease race`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0,
      tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR" },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  if (![ids.versionId, owner.userId, owner.tenantId].every(id => LEASE_UUID.test(id))) throw new Error("Invalid LOCK02 fixture identity.");
  const [precondition] = await querySql(`SELECT jsonb_build_object('draft', v.status = 'draft', 'tenant', v.tenant_id = '${owner.tenantId}'::uuid,
  'owner', p.user_id = '${owner.userId}'::uuid, 'leases', (SELECT count(*) FROM public.draft_locks l WHERE l.version_id = v.id))
FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id = v.project_id WHERE v.id = '${ids.versionId}'::uuid;\n`);
  await recordEvidence(army, "lock02-precondition", { ...ids, owner: { tenantId: owner.tenantId, userId: owner.userId }, precondition: JSON.parse(precondition ?? "null") });
  expect(JSON.parse(precondition ?? "null")).toEqual({ draft: true, tenant: true, owner: true, leases: 0 });

  // The in-flight half runs as the owner through RLS, like PostgREST: role and JWT claims of the request.
  const claims = JSON.stringify({ sub: owner.userId, role: "authenticated" });
  const asOwner = `SET LOCAL ROLE authenticated;\nSELECT set_config('request.jwt.claims', '${claims}', true);\n`;
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);

  // 1. Another editor page of the owner is acquiring the empty slot (acquireLock's INSERT, not yet
  //    committed) when the admin forces the takeover. The takeover must win: it claims the lease.
  const pageSession = randomUUID();
  const acquisition = openTransaction(`army_lock02_acquire_${suffix}`, `${asOwner}INSERT INTO public.draft_locks (version_id, user_id, session_id, tenant_id, expires_at)
VALUES ('${ids.versionId}'::uuid, '${owner.userId}'::uuid, '${pageSession}'::uuid, '${owner.tenantId}'::uuid, now() + interval '120 seconds');\n`);
  try {
    await waitUntilHeld(acquisition);
    const takeover = sendLeaseRequest(browser, "PATCH", `/api/estimates/${ids.versionId}/lock?force=true`);
    const blocked = await waitUntilBlocked(acquisition, "takeover_estimate_draft_lock", takeover.request);
    await acquisition.commit();
    const response = await takeover.response;
    const lease = await readLease(ids.versionId, owner.userId, pageSession);
    const renewed = await apiRequest<LockEnvelope>(browser, "PATCH", `/api/estimates/${ids.versionId}/lock`);
    const result = {
      takeoverWaitedOnAcquisition: blocked,
      takeover: { status: response.status, ok: response.body.ok, error: response.body.error?.code ?? null,
        sqlState: response.body.error?.details?.code ?? null, lock: lockView(response.body.data?.lock, owner.userId) },
      lease: { rows: lease.rows, acquiringPageKept: lease.session, owner: lease.owner },
      renewedByTakeoverPage: { status: renewed.status, ok: renewed.body.ok, lock: lockView(renewed.body.data?.lock, owner.userId) },
    };
    await recordEvidence(army, "lock02-takeover-over-acquisition", {
      versionId: ids.versionId, expected: { takeover: 200, leaseRows: 1, acquiringPageKept: false, renewed: 200 }, actual: result,
    });
    expect(blocked, "the takeover reached the lease slot while the acquisition was in flight").not.toBeNull();
    expect([result.takeover.status, result.takeover.ok, result.takeover.error, result.takeover.sqlState]).toEqual([200, true, null, null]);
    expect(result.takeover.lock).toEqual({ currentSession: true, currentUser: true, owner: true });
    expect(result.lease).toEqual({ rows: 1, acquiringPageKept: false, owner: true });
    expect([renewed.status, renewed.body.ok, result.renewedByTakeoverPage.lock?.currentSession]).toEqual([200, true, true]);
  } finally {
    acquisition.abort();
  }

  // 2. The reverse order keeps lease ownership: a takeover in flight (not yet committed) when an
  //    editor page acquires. The acquisition must not win: it is refused, the takeover keeps the lease.
  const released = await apiRequest<LockEnvelope>(browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
  expect([released.status, released.body.ok, released.body.data?.released]).toEqual([200, true, true]);
  expect((await readLease(ids.versionId, owner.userId, pageSession)).rows).toBe(0);
  const takeoverSession = randomUUID();
  const forced = openTransaction(`army_lock02_takeover_${suffix}`,
    `${asOwner}SELECT (public.takeover_estimate_draft_lock('${ids.versionId}'::uuid, '${takeoverSession}'::uuid)).session_id;\n`);
  try {
    await waitUntilHeld(forced);
    const acquire = sendLeaseRequest(browser, "POST", `/api/estimates/${ids.versionId}/lock`);
    const blocked = await waitUntilBlocked(forced, "draft_locks", acquire.request);
    await forced.commit();
    const response = await acquire.response;
    const lease = await readLease(ids.versionId, owner.userId, takeoverSession);
    const result = {
      acquisitionWaitedOnTakeover: blocked,
      acquisition: { status: response.status, ok: response.body.ok, error: response.body.error?.code ?? null,
        holder: lockView(response.body.error?.details?.lock, owner.userId) },
      lease: { rows: lease.rows, takeoverKept: lease.session, owner: lease.owner },
    };
    await recordEvidence(army, "lock02-acquisition-under-takeover", {
      versionId: ids.versionId, expected: { acquisition: 409, error: "CONFLICT", leaseRows: 1, takeoverKept: true }, actual: result,
    });
    expect(blocked, "the acquisition reached the lease slot while the takeover was in flight").not.toBeNull();
    expect([result.acquisition.status, result.acquisition.ok, result.acquisition.error]).toEqual([409, false, "CONFLICT"]);
    expect(result.acquisition.holder).toEqual({ currentSession: false, currentUser: true, owner: true });
    expect(result.lease).toEqual({ rows: 1, takeoverKept: true, owner: true });
  } finally {
    forced.abort();
  }
});
