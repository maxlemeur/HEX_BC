import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem, type ArmyVersion } from "../critical/fixtures";

// WFC02 failures/oracles are defined before product changes in
// docs/testing/estimate-workflow-atomicity.md. No model or repair write.
type Scenario = { label: string; projectId: string; versionId: string; sectionId: string; draftId: string; candidateId: string;
  subdetailId: string; componentId: string; designation: string; componentDesignation: string; requestedLot: string };
type Fixture = { schemaVersion: string; status: string; prefix: string; apiUrl: string; planSha256: string;
  owner: { userId: string; tenantId: string }; scenarios: Scenario[] };
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
const totals = (v: ArmyVersion) => [v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents];
const withoutTechnicalDates = (rows: Array<Record<string, unknown>>) => rows.map((row) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !["created_at", "updated_at"].includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));

async function fixture() {
  const file = process.env.E2E_GENERATED_ATOMIC_FIXTURE_PATH;
  if (!file) throw new Error("Explicit generated atomic fixture required.");
  const bytes = await readFile(file), value = JSON.parse(bytes.toString()) as Fixture;
  if (value.schemaVersion !== "estimate-generated-atomic-fixture-1" || value.status !== "ready" ||
    !value.prefix.startsWith("ARMY-GENERATED-ATOMIC-") || value.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    value.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || value.scenarios.map((s) => s.label).join() !== "existing,fallback") throw new Error("Fixture differs from the reviewed local profile.");
  return { value, sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function changeLock(browser: Browser, versionId: string, release = false, editor = false) {
  return JSON.parse(await browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessions = scope.__miaouffrageEstimateDraftLockSessions ??= new Map<string, string>();
    let session = input.editor ? sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`) : sessions.get(input.versionId);
    if (!session && !input.release) {
      session = crypto.randomUUID(); sessions.set(input.versionId, session);
      sessionStorage.setItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`, session);
    }
    if (!session) return JSON.stringify({ status: null, ok: false, released: false, owned: false });
    const response = await fetch(`/api/estimates/${input.versionId}/lock`, { method: input.release ? "DELETE" : "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
    const body = await response.json(), lock = body.data?.lock;
    return JSON.stringify({ status: response.status, ok: body.ok === true, released: body.data?.released === true,
      owned: lock?.session_id === session && lock?.version_id === input.versionId && lock?.is_current_session === true && lock?.is_current_user === true });
  }, { versionId, release, editor })) as { status: number | null; ok: boolean; released: boolean; owned: boolean };
}

for (const label of ["existing", "fallback"]) {
  armyTest(`WFC02 ${label} late native application refusal preserves reviewed draft, existing allocations and all workflow objects`, {
    session: "army", trace: "off", tags: ["source-coverage", "generated-atomic"], timeout: 180_000,
  }, async ({ app, browser, screen, army }) => {
    const loaded = await fixture(), f = loaded.value, s = f.scenarios.find((entry) => entry.label === label)!;
    ownEstimate(army, { projectId: s.projectId, versionId: s.versionId });
    await app.open("/dashboard/estimates");
    const acquired = await changeLock(browser, s.versionId);
    expect([acquired.status, acquired.ok, acquired.owned]).toEqual([201, true, true]);
    let initial: Awaited<ReturnType<typeof readEstimate>>;
    try {
      const empty = await readEstimate(browser, s.versionId);
      expect(empty.items.map((item) => item.id)).toEqual([s.sectionId]);
      expect([empty.version.calc_engine_version, empty.version.discount_bp, ...totals(empty.version)]).toEqual([2, 1667, 0, 0, 0]);
      for (const [index, name] of ["A", "B"].entries()) {
        const before = await readEstimate(browser, s.versionId);
        const body = { item_type: "line", line_nature: "supply_only", parent_id: s.sectionId, position: index + 1,
          title: `WFC02 ${label} ${name}`, description: "u", quantity: 1, unit_price_ht_cents: 3,
          tax_rate_bp: index === 0 ? 2000 : 0, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual" };
        const result = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${s.versionId}/items`, body, { "if-match": before.version.updated_at });
        await recordEvidence(army, `wfc02-${label}-create-${name}`, { body, result });
        expect(result.status).toBe(201); expect(result.body.ok).toBe(true);
      }
      initial = await readEstimate(browser, s.versionId);
      expect(totals(initial.version)).toEqual([5, 0, 5]);
      expect(initial.items.filter((item) => item.item_type === "line").sort((a, b) => a.position - b.position).map((item) => item.line_total_ht_cents)).toEqual([2, 3]);
    } finally {
      const released = await changeLock(browser, s.versionId, true);
      await recordEvidence(army, `wfc02-${label}-setup-release`, released);
      expect([released.status, released.released, released.owned]).toEqual([200, true, true]);
    }
    const client = createClient(f.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
    if (login.error || login.data.user?.id !== f.owner.userId) throw new Error("Ordinary independent observation failed.");
    const readObjects = async () => {
      const state: Record<string, Array<Record<string, unknown>>> = {};
      for (const [table, field, id] of [
        ["estimate_generated_ouvrage_drafts", "id", s.draftId], ["estimate_generated_ouvrage_candidates", "id", s.candidateId],
        ["estimate_generated_ouvrage_subdetail_drafts", "id", s.subdetailId], ["estimate_generated_ouvrage_subdetail_items", "subdetail_id", s.subdetailId],
        ["estimate_generated_ouvrage_applications", "target_version_id", s.versionId], ["estimate_generated_ouvrage_work_snapshots", "target_version_id", s.versionId],
        ["estimate_assemblies", "source_metadata->>draft_id", s.draftId],
      ]) {
        const result = await client.from(table).select("*").eq("tenant_id", f.owner.tenantId).eq(field, id).order("id");
        if (result.error) throw new Error(`Ordinary ${table} read failed: ${result.error.code}`);
        state[table] = result.data;
      }
      const assemblyIds = state.estimate_assemblies.map((row) => row.id as string);
      state.estimate_assembly_items = [];
      if (assemblyIds.length) {
        const result = await client.from("estimate_assembly_items").select("*").eq("tenant_id", f.owner.tenantId).in("assembly_id", assemblyIds).order("id");
        if (result.error) throw new Error("Ordinary assembly component read failed.");
        state.estimate_assembly_items = result.data;
      }
      return state;
    };
    const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
    const names = new Map(Object.entries(manifest.node).map(([id, entry]) => [id, entry.exportedName]));
    const calls: Array<{ action: string; at: string; acceptedCandidates: unknown; draftId: unknown; versionId: unknown;
      operationKey: unknown; expectedUpdatedAt: unknown; sessionPresent: boolean }> = [];
    const repairs: Array<{ path: string; method: string }> = [];
    const editorUrl = new URL(`/dashboard/estimates/${s.versionId}/edit`, app.baseUrl!).href;
    await browser.route(editorUrl, async (route) => {
      const action = names.get(route.request.headers["next-action"] ?? "");
      if (action === "generateOuvragesFromText") { await route.abort(); throw new Error("WFC02 must not invoke a model."); }
      if (action === "insertGeneratedOuvrages") {
        const [body] = JSON.parse(route.request.postData ?? "[]");
        calls.push({ action, at: new Date().toISOString(), acceptedCandidates: body.acceptedCandidates, draftId: body.draftId,
          versionId: body.versionId, operationKey: body.operationKey, expectedUpdatedAt: body.expectedUpdatedAt,
          sessionPresent: typeof body.draftLockSessionId === "string" });
      }
      await route.fallback();
    });
    const bulkUrl = new URL(`/api/estimates/${s.versionId}/items/bulk`, app.baseUrl!).href;
    await browser.route(bulkUrl, async (route) => { repairs.push({ path: new URL(route.request.url).pathname, method: route.request.method }); await route.fallback(); });
    try {
      await app.open(new URL(editorUrl).pathname);
      await expect(screen.getByLabel(`Quantité pour WFC02 ${label} A`, { exact: true })).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
      const opener = screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
      if (!await opener.isVisible()) {
        const tab = screen.getByRole("tab", "Insérer", { exact: true });
        if (await tab.isVisible()) await tab.click();
        await screen.getByRole("button", "Insérer", { exact: true }).click();
      }
      await opener.click();
      const dialog = screen.getByRole("dialog", "Générer des ouvrages", { exact: true });
      await expect(dialog).toBeVisible();
      await screen.getByTestId(`generated-ouvrage-draft-${s.draftId}`).getByRole("button", "Reprendre", { exact: true }).click();
      const card = screen.getByTestId(`candidate-card-${s.candidateId}`);
      await expect(card).toBeVisible();
      await card.getByRole("button", "Valider le sous-détail", { exact: true }).click();
      await expect(card.getByText("Sous-détail composé", { exact: true })).toBeVisible();
      await expect(card.getByRole("button", s.componentDesignation, { exact: false })).toBeVisible();
      await browser.locator(`[data-testid="candidate-card-${s.candidateId}"] section`).getByRole("button", "Valider le sous-détail", { exact: true }).click();
      await expect(card.getByText("Revu", { exact: true })).toBeVisible();
      const before = await readObjects(), beforeEstimate = await readEstimate(browser, s.versionId);
      await recordEvidence(army, `wfc02-${label}-reviewed-before`, { fixtureSha256: loaded.sha256, initial, beforeEstimate, before, repairs });
      expect(before.estimate_generated_ouvrage_subdetail_drafts[0].status).toBe("reviewed");
      expect(before.estimate_generated_ouvrage_drafts[0].status).toBe("pending");
      for (const table of ["estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots", "estimate_assemblies", "estimate_assembly_items"]) expect(before[table]).toHaveLength(0);
      expect(totals(beforeEstimate.version)).toEqual([5, 0, 5]);
      const select = card.getByRole("checkbox", `Sélectionner ${s.designation}`, { exact: true });
      if (!await select.isChecked()) await select.check();
      const actionId = [...names].find(([, name]) => name === "insertGeneratedOuvrages")?.[0];
      if (!actionId) throw new Error("The built generated application action is required.");
      // URL-only matching also sees a subsequently aborted RSC refresh. Capture
      // the actual POST/action response without changing its request or reply.
      await browser.evaluate((actionId) => {
        const scope = window as Window & { __armyAtomicCapture?: { original: typeof fetch; flight: string | null; status: number | null; error: string | null; posts: number } };
        const capture = { original: window.fetch, flight: null as string | null, status: null as number | null, error: null as string | null, posts: 0 };
        scope.__armyAtomicCapture = capture;
        window.fetch = async (input, init) => {
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          const url = new URL(input instanceof Request ? input.url : String(input), location.href);
          const matches = method === "POST" && url.origin === location.origin && url.pathname === location.pathname && headers.get("next-action") === actionId;
          if (matches) capture.posts += 1;
          const response = await capture.original.call(window, input, init);
          if (matches) {
            capture.status = response.status;
            void response.clone().text().then((flight) => { capture.flight = flight; })
              .catch((error) => { capture.error = error instanceof Error ? error.message : "Application response unreadable."; });
          }
          return response;
        };
        return true;
      }, actionId);
      let response: { status: number | null; flight: string | null; error: string | null; posts: number };
      try {
        await screen.getByTestId("generated-ouvrage-insert-button").click();
        await expect.poll(() => browser.evaluate(() => {
          const capture = (window as Window & { __armyAtomicCapture?: { flight: string | null; error: string | null } }).__armyAtomicCapture;
          return !!capture && (capture.flight !== null || capture.error !== null);
        }), { timeout: 45_000 }).toBe(true);
        response = await browser.evaluate(() => {
          const capture = (window as Window & { __armyAtomicCapture?: { status: number | null; flight: string | null; error: string | null; posts: number } }).__armyAtomicCapture!;
          return { status: capture.status, flight: capture.flight, error: capture.error, posts: capture.posts };
        });
        expect(response.error).toBe(null);
        expect(response.posts).toBe(1);
        expect(typeof response.flight).toBe("string");
      } finally {
        await browser.evaluate(() => {
          const scope = window as Window & { __armyAtomicCapture?: { original: typeof fetch } };
          if (scope.__armyAtomicCapture) { window.fetch = scope.__armyAtomicCapture.original; delete scope.__armyAtomicCapture; }
          return true;
        });
      }
      const flight = response.flight!;
      const results = flight.split("\n").flatMap((line) => {
        const raw = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1]; if (!raw) return [];
        try { const value = JSON.parse(raw); return typeof value.ok === "boolean" ? [{ ok: value.ok, error: value.error ?? null }] : []; } catch { return []; }
      });
      // First ordinary GET after the real action response, before any UI repair.
      const afterEstimate = await readEstimate(browser, s.versionId), after = await readObjects();
      await recordEvidence(army, `wfc02-${label}-after-before-assertions`, { response: { status: response.status, results }, calls,
        beforeEstimate, afterEstimate, before, after, repairs, saveInvoked: false, reloadInvoked: false });
      expect(response.status).toBe(200); expect(results).toHaveLength(1); expect(results[0].ok).toBe(false);
      expect(calls).toHaveLength(1); expect(calls[0].sessionPresent).toBe(true);
      expect(typeof calls[0].operationKey === "string" && /^[0-9a-f-]{36}$/i.test(calls[0].operationKey)).toBe(true);
      expect(calls[0].expectedUpdatedAt).toBe(beforeEstimate.version.updated_at);
      const accepted = calls[0].acceptedCandidates as Array<Record<string, unknown>>;
      expect(accepted).toHaveLength(1);
      expect(typeof accepted[0].reviewToken === "string" && /^[0-9a-f]{64}$/i.test(accepted[0].reviewToken)).toBe(true);
      expect(accepted.map(({ reviewToken: _review, ...candidate }) => { void _review; return candidate; }))
        .toEqual([{ candidateId: s.candidateId, designation: s.designation, unit: "u", quantity: 1, lotId: label === "existing" ? s.sectionId : null }]);
      expect(totals(afterEstimate.version)).toEqual([5, 0, 5]);
      expect(withoutTechnicalDates(afterEstimate.items)).toEqual(withoutTechnicalDates(beforeEstimate.items));
      for (const [table, rows] of Object.entries(before)) expect(withoutTechnicalDates(after[table])).toEqual(withoutTechnicalDates(rows));
      expect(repairs).toHaveLength(0);
      // PWF02 is deliberately not a recognized business error. The transaction
      // has rolled back, but the client must retain its unknown intention.
      expect(results[0].error.code).toBe("GENERATED_OUVRAGE_OUTCOME_UNKNOWN");
      expect(results[0].error.status).toBe(503);
      await expect(dialog).toHaveCount(0);
      await expect(screen.getByRole("button", "Reprendre cette opération", { exact: true })).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("Résultat à vérifier");
    } finally {
      await recordEvidence(army, `wfc02-${label}-action-ledger`, { calls, repairs });
      const released = await changeLock(browser, s.versionId, true, true);
      await recordEvidence(army, `wfc02-${label}-editor-release`, released);
      await browser.unroute(editorUrl); await browser.unroute(bulkUrl);
      const logout = await client.auth.signOut({ scope: "local" });
      if (logout.error) throw new Error("Independent local observer sign-out failed.");
    }
  });
}
