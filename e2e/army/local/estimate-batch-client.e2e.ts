import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence,
  type ArmyItem, type ArmyState, type ArmyVersion,
} from "../critical/fixtures";

// Failures/oracles precede implementation: docs/testing/estimate-batch-client-e2e.md.
type Ui = { app: App; browser: Browser; screen: Screen; army: ArmyState };
type Json = Record<string, unknown>;
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Owner = { prefix: string; apiUrl: string; owner: { userId: string; tenantId: string; laborRoleId: string } };
type BatchBody = { operation_key: string; concurrency_token?: string; operations: Array<{ op: string; id?: string; data?: Json }> };
type Observed = { at: string; pathname: string; method: string; body: Json | null; ifMatch: string | null };
type Reply = { status: number; body: Envelope<Json> };
type TransportEntry = { request: BatchBody; sent: BatchBody; ifMatch: string | null; response: Reply; fault: string | null };
type Probe = { entries: TransportEntry[] };
const options = { session: "army", tags: ["source-coverage", "batch-client"], trace: "off" as const, timeout: 180_000 };
const totals = (v: ArmyVersion) => [v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents];
const apiBase = (id: string) => `/api/estimates/${id}`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function owner() {
  const file = process.env.E2E_CREATE_ATOMIC_FIXTURE_PATH;
  if (!file) throw new Error("Explicit batch owner fixture required.");
  const value = JSON.parse(await readFile(file, "utf8"));
  if (value.schemaVersion !== "estimate-create-atomic-fixture-1" || value.status !== "ready" ||
    !value.prefix?.startsWith("ARMY-CREATE-ATOMIC-") || value.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN ||
    value.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !["userId", "tenantId", "laborRoleId"].every((field) => uuid.test(value.owner?.[field] ?? ""))) {
    throw new Error("Batch owner differs from the reviewed local profile.");
  }
  return value as Owner;
}

async function lock(browser: Browser, versionId: string, release = false) {
  return JSON.parse(await browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let session = sessions.get(input.versionId);
    if (!session && !input.release) {
      session = crypto.randomUUID(); sessions.set(input.versionId, session);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, session);
    }
    if (!session) throw new Error("Owned API lock missing.");
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, {
      method: input.release ? "DELETE" : "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}",
    });
    const body = await response.json();
    const held = body.data?.lock;
    return JSON.stringify({ status: response.status, ok: body.ok === true, released: body.data?.released === true,
      current: held?.is_current_session === true && held?.is_current_user === true && held?.is_expired === false,
      versionMatches: held?.version_id === input.versionId, sessionMatches: held?.session_id === session });
  }, { versionId, release })) as { status: number; ok: boolean; released: boolean; current: boolean; versionMatches: boolean; sessionMatches: boolean };
}

async function prepare(ui: Ui, label: string, bodies: Json[]) {
  const fixture = await owner();
  await ui.app.open("/dashboard/estimates");
  const created = await apiRequest<Envelope<{ project: { id: string; tenant_id: string; user_id: string }; version: ArmyVersion }>>(
    ui.browser, "POST", "/api/estimates", { project: { name: `${fixture.prefix}-${ui.army.runPrefix}-${label}` },
      version: { title: label, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0,
        discount_mode: "simple", discount_steps: [], global_coefficient: 1, tax_rate_bp: 2000,
        rounding_mode: "none", rounding_step_cents: 1, currency: "EUR", contractor_role: "principal" } });
  await recordEvidence(ui.army, `${label}-created-version`, created);
  expect(created.status).toBe(201); expect(created.body.ok).toBe(true);
  expect([created.body.data.project.tenant_id, created.body.data.project.user_id]).toEqual([fixture.owner.tenantId, fixture.owner.userId]);
  const versionId = created.body.data.version.id;
  ownEstimate(ui.army, { projectId: created.body.data.project.id, versionId });
  const acquired = await lock(ui.browser, versionId);
  expect([acquired.status, acquired.ok, acquired.current, acquired.versionMatches, acquired.sessionMatches]).toEqual([201, true, true, true, true]);
  const items: ArmyItem[] = [];
  try {
    const initial = await readEstimate(ui.browser, versionId);
    expect(initial.items).toHaveLength(0); expect(initial.version.calc_engine_version).toBe(2);
    const sectionResponse = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `${apiBase(versionId)}/items`, {
      item_type: "section", title: `${label} lot`, position: 1,
    }, { "if-match": initial.version.updated_at });
    expect(sectionResponse.status).toBe(201);
    const section = sectionResponse.body.data.item;
    for (const [index, raw] of bodies.entries()) {
      const state = await readEstimate(ui.browser, versionId);
      const body = { item_type: "line", parent_id: section.id, title: `${label} ligne ${index + 1}`, position: index + 1,
        description: "u", quantity: 2, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, k_mo: 1,
        labor_role_id: null, source_provider: "manual", ...raw };
      const response = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `${apiBase(versionId)}/items`, body, { "if-match": state.version.updated_at });
      await recordEvidence(ui.army, `${label}-line-${index + 1}`, { body, response });
      expect(response.status).toBe(201); items.push(response.body.data.item);
    }
    return { fixture, versionId, section, items };
  } finally {
    const released = await lock(ui.browser, versionId, true);
    await recordEvidence(ui.army, `${label}-setup-release`, released);
    expect([released.status, released.ok, released.released, released.sessionMatches]).toEqual([200, true, true, true]);
  }
}

async function editorReady(ui: Ui, title: string) {
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true })).toBeEnabled();
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
}

async function observe(ui: Ui, versionId: string) {
  const pattern = new RegExp(`/api/estimates/${versionId}/`);
  const requests: Observed[] = [];
  await ui.browser.route(pattern, async (route) => {
    const pathname = new URL(route.request.url).pathname;
    // Never inspect or return the editor lease/auth headers or lock payload.
    if (!pathname.endsWith("/lock") && route.request.method !== "GET") {
      requests.push({ at: new Date().toISOString(), pathname, method: route.request.method,
        ifMatch: route.request.headers["if-match"] ?? null,
        body: route.request.postData ? JSON.parse(route.request.postData) as Json : null });
    }
    await route.fallback();
  });
  return { requests, close: () => ui.browser.unroute(pattern) };
}

async function installFault(browser: Browser, versionId: string, fault: "lost" | "malformed" | "second-parent") {
  await browser.evaluate((input) => {
    const scope = window as typeof window & { __batchClientProbe?: Probe; __batchClientReleaseResponse?: () => void };
    scope.__batchClientProbe = { entries: [] };
    const original = window.fetch.bind(window);
    let posts = 0;
    window.fetch = async (request, init) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url, location.href);
      const method = (init?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
      if (url.origin !== location.origin || url.pathname !== `/api/estimates/${input.versionId}/batch` || method !== "POST") return original(request, init);
      const body = JSON.parse(String(init?.body)) as BatchBody;
      const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
      const sent = structuredClone(body);
      posts++;
      let applied: string | null = null;
      if (input.fault === "second-parent" && posts === 2) {
        if (sent.operations.length !== 1 || sent.operations[0]?.op !== "create") throw new Error("Second paste chunk shape differs from the pre-code oracle.");
        sent.operations[0].data = { ...sent.operations[0].data, parent_id: input.missingParent };
        applied = "second-parent";
      }
      const response = await original(request, applied ? { ...init, body: JSON.stringify(sent) } : init);
      const parsed = await response.clone().json();
      if (posts === 1 && (input.fault === "lost" || input.fault === "malformed")) applied = input.fault;
      scope.__batchClientProbe!.entries.push({ request: body, sent, ifMatch: headers.get("if-match"),
        response: { status: response.status, body: parsed }, fault: applied });
      if (applied === "lost") {
        // The server has answered. Let the user edit while this response is held.
        await new Promise<void>((resolve) => { scope.__batchClientReleaseResponse = resolve; });
        delete scope.__batchClientReleaseResponse;
        throw new TypeError("ARMY discarded the completed batch response");
      }
      if (applied === "malformed") return new Response("{", { status: response.status, headers: { "content-type": "application/json", "cache-control": "private, no-store" } });
      return response;
    };
    return true;
  }, { versionId, fault, missingParent: randomUUID() });
}

async function probe(browser: Browser): Promise<Probe> {
  return JSON.parse(await browser.evaluate(() => JSON.stringify((window as typeof window & { __batchClientProbe: Probe }).__batchClientProbe))) as Probe;
}

async function exactTotals(ui: Ui, versionId: string, expected: number[]) {
  await expect.poll(async () => totals((await readEstimate(ui.browser, versionId)).version), { timeout: 20_000 }).toEqual(expected);
  return readEstimate(ui.browser, versionId);
}

for (const [code, fault] of [["BC01", "lost"], ["BC02", "malformed"]] as const) {
  armyTest(`${code} ordinary CtrlS recovers ${fault} committed batch response with exact intent and no automatic replay`, options, async (ui) => {
    const { versionId, items } = await prepare(ui, code, [{}]);
    const originalIds = (await readEstimate(ui.browser, versionId)).items.map((item) => item.id).sort();
    await ui.app.open(`/dashboard/estimates/${versionId}/edit`);
    await editorReady(ui, items[0].title);
    const observed = await observe(ui, versionId);
    const dialogs: string[] = [];
    const dispose = await ui.browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.accept(); });
    try {
      await installFault(ui.browser, versionId, fault);
      await ui.screen.getByLabel(`Quantité pour ${items[0].title}`, { exact: true }).fill("3");
      await ui.browser.keyboard.press("Tab"); await ui.browser.keyboard.press("Control+s");
      await expect.poll(async () => (await probe(ui.browser)).entries.length, { timeout: 30_000 }).toBe(1);
      const first = (await probe(ui.browser)).entries[0];
      if (code === "BC01") {
        await expect(ui.screen.getByLabel(`Quantité pour ${items[0].title}`, { exact: true })).toBeEnabled();
        await ui.screen.getByLabel(`Quantité pour ${items[0].title}`, { exact: true }).fill("4");
        await ui.browser.keyboard.press("Tab");
        expect(await ui.browser.evaluate(() => {
          const release = (window as typeof window & { __batchClientReleaseResponse?: () => void }).__batchClientReleaseResponse;
          if (!release) return false; release(); return true;
        })).toBe(true);
      }
      const persisted = await exactTotals(ui, versionId, [3000, 600, 3600]);
      await recordEvidence(ui.army, `${code}-completed-response-before-ui`, { first, persisted, observed: observed.requests });
      expect(first.response.status).toBe(200); expect(first.response.body.ok).toBe(true);
      expect(first.response.body.data.committed).toBe(true); expect(first.fault).toBe(fault);
      expect(uuid.test(first.request.operation_key)).toBe(true); expect(Boolean(first.ifMatch)).toBe(true);
      expect(persisted.items.map((item) => item.id).sort()).toEqual(originalIds);
      await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
      await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).not.toHaveText(/^(Sauvegardé|À jour)$/);
      const batchPosts = () => observed.requests.filter((entry) => entry.pathname.endsWith("/batch") && entry.method === "POST");
      const beforeReloadPosts = batchPosts().length;
      const previousOrigin = await ui.browser.evaluate(() => performance.timeOrigin);
      await ui.browser.reload({ timeout: 15_000 });
      expect(await ui.browser.evaluate(() => performance.timeOrigin) > previousOrigin).toBe(true);
      await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
      const observationStart = Date.now();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      const afterReloadPosts = batchPosts().length;
      await recordEvidence(ui.army, `${code}-reload-no-post`, { beforeReloadPosts, afterReloadPosts, windowMs: Date.now() - observationStart, dialogs });
      expect(afterReloadPosts).toBe(beforeReloadPosts);
      if (code === "BC02") {
        const receiptUrl = new URL(`${apiBase(versionId)}/batch/receipts/${first.request.operation_key}`, ui.app.baseUrl!).href;
        let malformedReads = 0;
        await ui.browser.route(receiptUrl, async (route) => {
          if (route.request.method === "GET") { malformedReads++; await route.fulfill({ status: 200, headers: { "content-type": "application/json", "cache-control": "private, no-store" }, body: "{" }); }
          else await route.fallback();
        });
        try {
          await ui.screen.getByRole("button", "Vérifier le résultat", { exact: true }).click();
          await expect.poll(() => malformedReads, { timeout: 10_000 }).toBe(1);
          await expect(ui.screen.getByRole("alert").filter({ hasText: "Impossible de vérifier le résultat. La demande reste conservée." })).toBeVisible();
          await expect(ui.screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
          await expect(ui.screen.getByText("Aucun résultat n'est encore disponible.", { exact: false })).toHaveCount(0);
          await recordEvidence(ui.army, "BC02-malformed-receipt", { malformedReads, postsAfterMalformedRead: batchPosts().length, beforeReloadPosts, responseKind: "HTTP200 malformed JSON", absentReceiptClaimVisible: false });
          expect(batchPosts().length).toBe(beforeReloadPosts);
        } finally { await ui.browser.unroute(receiptUrl); }
      }
      const responsePromise = ui.browser.waitForResponse(new URL(`${apiBase(versionId)}/batch`, ui.app.baseUrl!).href, { timeout: 30_000 });
      await ui.screen.getByRole("button", "Reprendre cette opération", { exact: true }).click();
      const replayResponse = await responsePromise;
      const replay = await replayResponse.json<Envelope<Json>>();
      await expect(ui.screen.getByLabel(`Quantité pour ${items[0].title}`, { exact: true })).toBeEnabled();
      if (code === "BC02") await editorReady(ui, items[0].title);
      if (code === "BC01") {
        await expect(ui.screen.getByLabel(`Quantité pour ${items[0].title}`, { exact: true })).toHaveValue("4");
        await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).not.toHaveText(/^(Sauvegardé|À jour)$/);
      }
      const resumed = await exactTotals(ui, versionId, [3000, 600, 3600]);
      const bufferedQuantity = await ui.browser.evaluate((label) => {
        const input = Array.from(document.querySelectorAll("input")).find((entry) => entry.getAttribute("aria-label") === label);
        return input?.value ?? null;
      }, `Quantité pour ${items[0].title}`);
      await recordEvidence(ui.army, `${code}-explicit-replay`, { status: replayResponse.status, replay, requests: batchPosts(), resumed, bufferedQuantity });
      expect(replayResponse.status).toBe(200); expect(replay.data.replayed).toBe(true);
      expect(batchPosts()).toHaveLength(2);
      expect(batchPosts()[1].body).toEqual(first.request); expect(batchPosts()[1].ifMatch).toBe(first.ifMatch);
      expect(resumed.items.map((item) => item.id).sort()).toEqual(originalIds);
      expect(observed.requests.filter((entry) => entry.pathname.endsWith("/items/bulk"))).toHaveLength(0);
      if (code === "BC01") {
        // Save the preserved edit, without entering it again after the reload.
        expect(bufferedQuantity).toBe("4"); await ui.browser.keyboard.press("Control+s");
        const newer = await exactTotals(ui, versionId, [4000, 800, 4800]);
        await editorReady(ui, items[0].title);
        const old = await apiRequest<Envelope<Json>>(ui.browser, "POST", `${apiBase(versionId)}/batch`, first.request, { "if-match": first.ifMatch! });
        const changed = structuredClone(first.request);
        const update = changed.operations.find((operation) => operation.op === "update" && operation.id === items[0].id);
        expect(Boolean(update)).toBe(true); update!.data = { ...update!.data, quantity: 7 };
        const refused = await apiRequest<Envelope<Json>>(ui.browser, "POST", `${apiBase(versionId)}/batch`, changed, { "if-match": first.ifMatch! });
        const final = await readEstimate(ui.browser, versionId);
        await recordEvidence(ui.army, `${code}-old-replay-and-body-conflict`, { newer, old, refused, final });
        expect(old.status).toBe(200); expect(old.body.data.replayed).toBe(true);
        expect(refused.status).toBe(409); expect(refused.body.ok).toBe(false);
        expect(refused.body.error?.code).toBe("ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT");
        expect(final.items).toEqual(newer.items); expect(totals(final.version)).toEqual([4000, 800, 4800]);
        expect(observed.requests.filter((entry) => entry.pathname.endsWith("/items/bulk"))).toHaveLength(0);
      }
    } finally {
      await recordEvidence(ui.army, `${code}-request-ledger`, { requests: observed.requests, dialogs, dialogsAcceptedOnlyForPendingRecovery: true });
      await dispose(); await observed.close();
    }
  });
}

armyTest("BC03 delete and real UI undo preserve split labor fields and default majoration through the create client", options, async (ui) => {
  const fixture = await owner();
  await ui.app.open("/dashboard/estimates");
  const flag = await apiRequest<Envelope<Json>>(ui.browser, "PATCH", "/api/feature-flags", { tenant_id: fixture.owner.tenantId, flag_key: "EST_031_LABOR_SPLIT", enabled: true });
  await recordEvidence(ui.army, "BC03-split-flag", flag);
  expect(flag.status).toBe(200); expect(flag.body.ok).toBe(true);
  const split = { h_mo_atelier: 1, k_mo_atelier: 1.25, labor_role_atelier_id: fixture.owner.laborRoleId,
    h_mo_chantier: 2, k_mo_chantier: 0.75, labor_role_chantier_id: fixture.owner.laborRoleId };
  const { versionId, items } = await prepare(ui, "BC03", [{ ...split, h_mo_majoration: 1.1 }, { ...split }]);
  const initial = await readEstimate(ui.browser, versionId);
  await recordEvidence(ui.army, "BC03-before-delete", { initial, expectedTotals: [27100, 5420, 32520] });
  expect(totals(initial.version)).toEqual([27100, 5420, 32520]);
  const fields = ["parent_id", "position", "title", "description", "quantity", "unit_price_ht_cents", "tax_rate_bp", "k_fo", "h_mo", "k_mo", "labor_role_id",
    "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id", "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "h_mo_majoration",
    "pu_ht_cents", "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents"];
  const values = (item: ArmyItem) => fields.map((field) => item[field]);
  await ui.app.open(`/dashboard/estimates/${versionId}/edit`); await editorReady(ui, items[0].title);
  const observed = await observe(ui, versionId);
  try {
    for (const [index, item] of items.entries()) {
      await ui.screen.getByRole("button", `Plus d'actions pour ${item.title}`, { exact: true }).click();
      await ui.screen.getByRole("menuitem", "Supprimer", { exact: true }).click();
      await ui.screen.getByRole("dialog", "Confirmer la suppression", { exact: true }).getByRole("button", "Supprimer", { exact: true }).click();
      await expect.poll(async () => (await readEstimate(ui.browser, versionId)).items.some((entry) => entry.id === item.id), { timeout: 15_000 }).toBe(false);
      await expect(ui.screen.getByTestId("estimate-editor-undo-button")).toBeEnabled();
      await ui.screen.getByTestId("estimate-editor-undo-button").click();
      await expect.poll(async () => (await readEstimate(ui.browser, versionId)).items.filter((entry) => entry.title === item.title).length, { timeout: 20_000 }).toBe(1);
      const state = await readEstimate(ui.browser, versionId), restored = state.items.find((entry) => entry.title === item.title)!;
      const posts = observed.requests.filter((entry) => entry.method === "POST" && entry.pathname.endsWith("/items") && entry.body?.title === item.title);
      await recordEvidence(ui.army, `BC03-undo-${index + 1}`, { original: item, restored, posts, state });
      expect(restored.id === item.id).toBe(false); expect(values(restored)).toEqual(values(item));
      expect(posts).toHaveLength(1);
      const serializedFields = ["h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id", "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "h_mo_majoration"];
      expect(serializedFields.map((field) => posts[0].body?.[field])).toEqual(serializedFields.map((field) => item[field]));
      expect(totals(state.version)).toEqual([27100, 5420, 32520]);
    }
    await ui.browser.keyboard.press("Control+s"); await editorReady(ui, items[0].title);
    await ui.browser.reload({ timeout: 15_000 }); await editorReady(ui, items[0].title);
    const final = await readEstimate(ui.browser, versionId);
    await recordEvidence(ui.army, "BC03-reloaded", { final, requests: observed.requests });
    expect(totals(final.version)).toEqual([27100, 5420, 32520]);
    for (const item of items) expect(values(final.items.find((entry) => entry.title === item.title)!)).toEqual(values(item));
  } finally { await observed.close(); }
});

armyTest("BC04 partial paste retains the committed first 100 rows after a real second-chunk refusal without compensating DELETE", options, async (ui) => {
  const { versionId, section } = await prepare(ui, "BC04", []);
  await ui.app.open(`/dashboard/estimates/${versionId}/edit`);
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("button", `Ajouter dans ${section.title}`, { exact: true })).toBeEnabled();
  const observed = await observe(ui, versionId);
  try {
    await installFault(ui.browser, versionId, "second-parent");
    const titles = Array.from({ length: 101 }, (_, index) => `BC04 fournitures ${String(index + 1).padStart(3, "0")}`);
    const tsv = ["Désignation\tQuantité\tUnité\tPrix unitaire HT", ...titles.map((title) => `${title}\t1\tu\t1,00`)].join("\n");
    // Real DOM paste entry, parser, preview, confirmation and client batches.
    // This does not claim an operating-system clipboard integration test.
    // Focus the real section control to establish the ordinary insertion anchor.
    await ui.screen.getByTestId("estimate-section-title-input").click();
    await ui.browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    await ui.browser.evaluate((text) => {
      const grid = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
      if (!(grid instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const transfer = new DataTransfer(); transfer.setData("text/plain", text);
      grid.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      return true;
    }, tsv);
    await expect(ui.screen.getByRole("dialog", "Aperçu du collage", { exact: true })).toBeVisible();
    await ui.screen.getByTestId("paste-preview-dialog-confirm-button").click();
    await expect.poll(async () => (await probe(ui.browser)).entries.length, { timeout: 60_000 }).toBe(2);
    const replies = (await probe(ui.browser)).entries;
    const state = await readEstimate(ui.browser, versionId);
    await recordEvidence(ui.army, "BC04-completed-chunks", { replies, state, expectedTotals: [10000, 2000, 12000], requests: observed.requests });
    expect(replies[0].request.operations).toHaveLength(100); expect(replies[1].request.operations).toHaveLength(1);
    expect(replies[0].response.status).toBe(200); expect(replies[0].response.body.data.committed).toBe(true);
    expect(replies[1].fault).toBe("second-parent"); expect(replies[1].sent.operation_key).toBe(replies[1].request.operation_key);
    expect(replies[1].response.status).toBe(200); expect(replies[1].response.body.data.committed).toBe(false);
    expect(replies[1].response.body.ok).toBe(true);
    expect((replies[1].response.body.data.results as Array<{ status: string }>).some((result) => result.status === "error")).toBe(true);
    const lines = state.items.filter((item) => item.item_type === "line");
    expect(lines.map((item) => item.title).sort()).toEqual(titles.slice(0, 100).sort());
    expect(lines.every((item) => item.quantity === 1 && item.unit_price_ht_cents === 100 && item.line_total_ht_cents === 100 && item.line_tax_cents === 20)).toBe(true);
    expect(totals(state.version)).toEqual([10000, 2000, 12000]);
    expect(observed.requests.filter((entry) => entry.method === "DELETE")).toHaveLength(0);
    await expect(ui.screen.getByRole("alert").filter({ hasText: "100 ligne(s) ont été enregistrées. Le collage s'est arrêté ; les lignes enregistrées sont conservées." })).toBeVisible();
    await editorReady(ui, titles[0]);
    await expect(ui.screen.getByTestId("estimate-editor-alert-totals-out-of-sync")).toHaveCount(0);
    const writesBeforeWindow = observed.requests.length;
    const observationStart = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    const settled = await readEstimate(ui.browser, versionId);
    await recordEvidence(ui.army, "BC04-settled-ui", { settled, writesBeforeWindow, writesAfterWindow: observed.requests.length,
      windowMs: Date.now() - observationStart, requests: observed.requests });
    expect(observed.requests.length).toBe(writesBeforeWindow);
    expect(observed.requests.filter((entry) => entry.pathname.endsWith("/items/bulk") || entry.method === "DELETE")).toHaveLength(0);
    expect(settled.items).toEqual(state.items); expect(totals(settled.version)).toEqual([10000, 2000, 12000]);
    await expect(ui.screen.getByRole("alert").filter({ hasText: "100 ligne(s) ont été enregistrées. Le collage s'est arrêté ; les lignes enregistrées sont conservées." })).toBeVisible();
    await ui.browser.reload({ timeout: 15_000 }); await editorReady(ui, titles[0]);
    const reloaded = await readEstimate(ui.browser, versionId);
    await recordEvidence(ui.army, "BC04-reloaded", { reloaded, requests: observed.requests });
    expect(reloaded.items).toEqual(state.items); expect(totals(reloaded.version)).toEqual([10000, 2000, 12000]);
    expect(observed.requests.filter((entry) => entry.method === "DELETE")).toHaveLength(0);
  } finally { await observed.close(); }
});
