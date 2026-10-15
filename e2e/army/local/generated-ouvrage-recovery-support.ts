import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import { ownEstimate, readEstimate, recordEvidence, type ArmyState, type ArmyVersion } from "../critical/fixtures";

export type Json = Record<string, unknown>;
export type Ui = { app: App; browser: Browser; screen: Screen; army: ArmyState };
export type Candidate = { candidateId: string; subdetailId: string; componentId: string; fragmentId: string; designation: string; componentDesignation: string; unitCostHtCents: number };
export type Scenario = { label: string; projectId: string; versionId: string; sectionId: string; draftId: string; candidates: Candidate[] };
type Fixture = { schemaVersion: string; status: string; prefix: string; apiUrl: string; owner: { userId: string; tenantId: string }; scenarios: Scenario[] };
export type Call = { action: string; request: Json; sessionPresent: boolean; at: string };
export type Reply = { action: string; request: Json; status: number; records: Json[]; changedRecords: number; discarded: boolean };
export const totals = (v: ArmyVersion) => [v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents];
export const stableRows = (rows: Json[]) => rows.map((row) => Object.fromEntries(Object.entries(row)
  .filter(([key]) => !["created_at", "updated_at"].includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));

export async function prepare(ui: Ui, label: string) {
  const file = process.env.E2E_GENERATED_RECOVERY_FIXTURE_PATH;
  if (!file) throw new Error("Explicit generated recovery fixture required.");
  const bytes = await readFile(file), f = JSON.parse(bytes.toString()) as Fixture;
  if (f.schemaVersion !== "estimate-generated-recovery-fixture-1" || f.status !== "ready" ||
    !f.prefix.startsWith("ARMY-GENERATED-ATOMIC-") || f.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL ||
    f.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || f.scenarios.map((s) => s.label).join() !== "lost,malformed,stale,partial,abandon") throw new Error("Recovery fixture differs from the reviewed profile.");
  const s = f.scenarios.find((entry) => entry.label === label)!;
  ownEstimate(ui.army, { projectId: s.projectId, versionId: s.versionId });
  await ui.app.open(`/dashboard/estimates/${s.versionId}/edit`);
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("button", `Ajouter dans ${f.prefix} ${label} S`, { exact: true })).toBeEnabled();
  await saved(ui);
  const initial = await readEstimate(ui.browser, s.versionId);
  await recordEvidence(ui.army, `${label}-initial`, { fixtureSha256: createHash("sha256").update(bytes).digest("hex"), scenario: s, initial });
  expect(initial.items.map((item) => item.id)).toEqual([s.sectionId]);
  expect([initial.version.calc_engine_version, initial.version.discount_bp, ...totals(initial.version)]).toEqual([2, 0, 0, 0, 0]);
  const client = createClient(f.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || login.data.user?.id !== f.owner.userId) throw new Error("Ordinary observation identity differs.");
  const objects = async () => {
    const state: Record<string, Json[]> = {};
    for (const [name, table, field, id] of [
      ["drafts", "estimate_generated_ouvrage_drafts", "id", s.draftId],
      ["candidates", "estimate_generated_ouvrage_candidates", "draft_id", s.draftId],
      ["subdetails", "estimate_generated_ouvrage_subdetail_drafts", "draft_id", s.draftId],
      ["components", "estimate_generated_ouvrage_subdetail_items", "draft_id", s.draftId],
      ["applications", "estimate_generated_ouvrage_applications", "target_version_id", s.versionId],
      ["snapshots", "estimate_generated_ouvrage_work_snapshots", "target_version_id", s.versionId],
      ["assemblies", "estimate_assemblies", "source_metadata->>draft_id", s.draftId],
    ]) {
      const result = await client.from(table).select("*").eq("tenant_id", f.owner.tenantId).eq(field, id).order("id");
      if (result.error) throw new Error(`Ordinary ${table} read failed: ${result.error.code}`);
      state[name] = result.data;
    }
    state.libraryComponents = [];
    if (state.assemblies.length) {
      const result = await client.from("estimate_assembly_items").select("*").eq("tenant_id", f.owner.tenantId).in("assembly_id", state.assemblies.map((row) => row.id)).order("id");
      if (result.error) throw new Error("Ordinary library component read failed.");
      state.libraryComponents = result.data;
    }
    return state;
  };
  const manifest = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
  const names = new Map(Object.entries(manifest.node).map(([id, entry]) => [id, entry.exportedName]));
  const ids: Record<string, string> = {};
  for (const name of ["insertGeneratedOuvrages", "updateGeneratedOuvrageSubdetailDraft", "getGeneratedOuvrageApplicationReceipt", "abandonGeneratedOuvrageApplication"]) {
    const found = [...names].find(([, exported]) => exported === name); if (!found) throw new Error(`Built action missing: ${name}`); ids[name] = found[0];
  }
  const editorUrl = new URL(`/dashboard/estimates/${s.versionId}/edit`, ui.app.baseUrl!).href;
  const calls: Call[] = [], bulk: string[] = [];
  await ui.browser.route(editorUrl, async (route) => {
    const action = names.get(route.request.headers["next-action"] ?? "");
    if (action === "generateOuvragesFromText") { await route.abort(); throw new Error("Recovery recipe must not invoke a model."); }
    if (action && ids[action]) {
      const [body] = JSON.parse(route.request.postData ?? "[]");
      const { draftLockSessionId, ...request } = body;
      calls.push({ action, request, sessionPresent: typeof draftLockSessionId === "string", at: new Date().toISOString() });
    }
    await route.fallback();
  });
  const bulkUrl = new URL(`/api/estimates/${s.versionId}/items/bulk`, ui.app.baseUrl!).href;
  await ui.browser.route(bulkUrl, async (route) => { bulk.push(route.request.method); await route.fallback(); });
  const pending = async () => JSON.parse(await ui.browser.evaluate((identity) => {
    const raw = sessionStorage.getItem(`estimate:batch-pending:v1:${identity.actorId}:${identity.tenantId}:${identity.versionId}`);
    if (!raw) return "null";
    const value = JSON.parse(raw), body = JSON.parse(value.body);
    if ("draftLockSessionId" in body) throw new Error("Renewable lease was persisted in the application intention.");
    return JSON.stringify({ ...value, body });
  }, { actorId: f.owner.userId, tenantId: f.owner.tenantId, versionId: s.versionId })) as Json | null;
  const close = async () => {
    await recordEvidence(ui.army, `${label}-request-ledger`, { calls, bulk });
    await ui.browser.unroute(editorUrl); await ui.browser.unroute(bulkUrl);
    // Normal release of this page's current lease, kept entirely in page memory.
    const released = JSON.parse(await ui.browser.evaluate(async (versionId) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`);
      if (!session) return JSON.stringify({ attempted: false });
      const response = await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin",
        headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
      const body = await response.json(); return JSON.stringify({ attempted: true, status: response.status, released: body.data?.released === true });
    }, s.versionId));
    await recordEvidence(ui.army, `${label}-lease-release`, released);
    const logout = await client.auth.signOut({ scope: "local" }); if (logout.error) throw new Error("Ordinary local observer sign-out failed.");
  };
  return { f, s, ids, calls, bulk, editorUrl, objects, pending, close };
}

export type Prepared = Awaited<ReturnType<typeof prepare>>;
export async function saved(ui: Ui) { await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/); }
export async function resumeDialog(ui: Ui, s: Scenario) {
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(ui.screen.getByTestId("estimate-editor-production-ribbon")).toBeVisible();
  const opener = ui.screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
  if (!await opener.isVisible()) {
    const tab = ui.screen.getByRole("tab", "Insérer", { exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(tab).toBeSelected();
    const insert = ui.screen.getByRole("button", "Insérer", { exact: true });
    await expect(insert).toBeEnabled();
    await insert.click();
  }
  await expect(opener).toBeEnabled();
  await opener.click();
  await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
  await ui.screen.getByTestId(`generated-ouvrage-draft-${s.draftId}`).getByRole("button", "Reprendre", { exact: true }).click();
  await expect(ui.screen.getByTestId(`candidate-card-${s.candidates[0].candidateId}`)).toBeVisible();
}
export async function review(ui: Ui, c: Candidate) {
  const card = ui.screen.getByTestId(`candidate-card-${c.candidateId}`);
  await card.getByRole("button", "Valider le sous-détail", { exact: true }).click();
  const section = ui.browser.locator(`[data-testid="candidate-card-${c.candidateId}"] section`);
  await expect(section.getByRole("button", c.componentDesignation, { exact: false })).toBeVisible();
  await section.getByRole("button", "Valider le sous-détail", { exact: true }).click();
  await expect(section.getByRole("button", "Sous-détail déjà validé", { exact: true })).toBeDisabled();
  await expect(card.getByRole("checkbox", `Sélectionner ${c.designation}`, { exact: true })).toBeEnabled();
}
export async function selectOnly(ui: Ui, s: Scenario, selected: Candidate) {
  for (const c of s.candidates) {
    const checkbox = ui.screen.getByTestId(`candidate-card-${c.candidateId}`).getByRole("checkbox", `Sélectionner ${c.designation}`, { exact: true });
    if (await checkbox.count() === 0) continue;
    if (c.candidateId === selected.candidateId) { if (!await checkbox.isChecked()) await checkbox.check(); }
    else if (await checkbox.isChecked()) await checkbox.uncheck();
  }
}
export async function cost(ui: Ui, c: Candidate, cents: number) {
  const card = ui.screen.getByTestId(`candidate-card-${c.candidateId}`), input = card.getByLabel("Coût unitaire HT", { exact: true });
  if (!await input.isVisible()) await card.getByRole("button", c.componentDesignation, { exact: false }).click();
  await input.fill(String(cents)); await ui.browser.keyboard.press("Tab");
}

export function flightRecords(text: string): Json[] {
  return text.split("\n").flatMap((line) => {
    const raw = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1]; if (!raw) return [];
    try { const value = JSON.parse(raw); return typeof value.ok === "boolean" || typeof value.reviewToken === "string" ? [value] : []; } catch { return []; }
  });
}
export async function action(ui: Ui, p: Prepared, name: string, request: Json) {
  return JSON.parse(await ui.browser.evaluate(async (input) => {
    const body = { ...input.request };
    if (["insertGeneratedOuvrages", "updateGeneratedOuvrageSubdetailDraft"].includes(input.name)) body.draftLockSessionId = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`);
    const response = await fetch(location.href, { method: "POST", credentials: "same-origin", headers: { "content-type": "text/plain;charset=UTF-8", "next-action": input.id }, body: JSON.stringify([body]) });
    const flight = await response.text();
    const records = flight.split("\n").flatMap((line) => {
      const raw = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1]; if (!raw) return [];
      try { const value = JSON.parse(raw); return typeof value.ok === "boolean" || typeof value.reviewToken === "string" ? [value] : []; } catch { return []; }
    });
    return JSON.stringify({ status: response.status, records });
  }, { id: p.ids[name], name, request: JSON.parse(JSON.stringify(request)), versionId: p.s.versionId })) as { status: number; records: Json[] };
}

export async function installProbe(ui: Ui, p: Pick<Prepared, "ids">, fault: "lost" | "malformed" | "receipt" | "none", preserveReplies = false) {
  await ui.browser.evaluate((input) => {
    const scope = window as typeof window & { __generatedProbe?: { replies: Reply[] }; __generatedOriginalFetch?: typeof window.fetch };
    const original = scope.__generatedOriginalFetch ??= window.fetch.bind(window);
    scope.__generatedProbe = { replies: input.preserveReplies ? scope.__generatedProbe?.replies ?? [] : [] };
    let faultDone = false;
    window.fetch = async (request, init) => {
      const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
      const id = headers.get("next-action"), name = Object.entries(input.ids).find(([, value]) => value === id)?.[0];
      if (!name) return original(request, init);
      const rawBody = JSON.parse(String(init?.body)), { draftLockSessionId: _lease, ...body } = rawBody[0];
      void _lease;
      const response = await original(request, init), text = await response.clone().text();
      const records: Json[] = []; let changedRecords = 0;
      const target = !faultDone && ((name === "insertGeneratedOuvrages" && ["lost", "malformed"].includes(input.fault)) ||
        (name === "getGeneratedOuvrageApplicationReceipt" && input.fault === "receipt"));
      const replacement = text.split("\n").map((line) => {
        const match = line.match(/^([0-9a-f]+:)(\{.*\})$/i); if (!match) return line;
        let value: Json; try { value = JSON.parse(match[2]); } catch { return line; }
        if (typeof value.ok !== "boolean" && typeof value.reviewToken !== "string" &&
          !(typeof value.draftId === "string" && Array.isArray(value.candidates))) return line;
        records.push(value);
        if (target && value.ok === true && ((name === "insertGeneratedOuvrages" && "receipt" in value) || (name === "getGeneratedOuvrageApplicationReceipt" && "data" in value))) {
          if (input.fault === "malformed") { changedRecords++; return match[1] + JSON.stringify({ ...value, totals: null }); }
          if (input.fault === "receipt") { changedRecords++; return match[1] + JSON.stringify({ ok: true }); }
        }
        return line;
      }).join("\n");
      const discarded = target && input.fault === "lost";
      scope.__generatedProbe!.replies.push({ action: name, request: body, status: response.status, records, changedRecords, discarded });
      if (target) faultDone = true;
      if (discarded) throw new TypeError("ARMY discarded a completed generated-work response");
      return changedRecords ? new Response(replacement, { status: response.status, headers: response.headers }) : response;
    };
    return true;
  }, { ids: p.ids, fault, preserveReplies });
}
export async function replies(ui: Ui): Promise<Reply[]> {
  return JSON.parse(await ui.browser.evaluate(() => JSON.stringify((window as typeof window & { __generatedProbe: { replies: Reply[] } }).__generatedProbe.replies)));
}
export async function capture(ui: Ui, p: Prepared, label: string) {
  // First GET, then separate ordinary RLS observations; no repair or retry.
  const estimate = await readEstimate(ui.browser, p.s.versionId), objects = await p.objects();
  const evidence = { estimate, objects, calls: [...p.calls], bulk: [...p.bulk] };
  await recordEvidence(ui.army, label, evidence); return evidence;
}
export function assertApplied(state: Awaited<ReturnType<typeof capture>>, p: Prepared, expected: number[], candidates: Array<Candidate & { lineQuantity?: number }>) {
  expect(totals(state.estimate.version)).toEqual(expected);
  const lines = state.estimate.items.filter((row) => row.item_type === "line");
  expect(lines).toHaveLength(candidates.length);
  for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(state.objects[key]).toHaveLength(candidates.length);
  expect(state.estimate.items.filter((row) => row.item_type === "section").map((row) => row.id)).toEqual([p.s.sectionId]);
  for (const c of candidates) {
    const application = state.objects.applications.find((row) => row.candidate_id === c.candidateId)!;
    expect(Boolean(application)).toBe(true);
    const line = lines.find((row) => row.id === application.estimate_item_id)!;
    expect([line.title, line.description, line.parent_id, line.source_provider]).toEqual([c.designation, "u", p.s.sectionId, "generated_ouvrage"]);
    const quantity = c.lineQuantity ?? 1, cost = c.unitCostHtCents;
    expect([line.quantity, line.unit_price_ht_cents, line.pu_ht_cents, line.h_mo, line.tax_rate_bp,
      line.line_total_ht_cents, line.line_tax_cents, line.line_total_ttc_cents])
      .toEqual([quantity, cost, cost, 0, 2000, quantity * cost, quantity * cost / 5, quantity * cost * 6 / 5]);
    const snapshot = state.objects.snapshots.find((row) => row.estimate_item_id === line.id)!;
    expect(Boolean(snapshot)).toBe(true);
    expect(snapshot.parent_work_id).toBe(c.candidateId);
    const summary = snapshot.summary as Json, components = snapshot.components as Json[];
    expect([summary.componentCount, summary.dsCents, summary.indicativeTargetPriceCents]).toEqual([1, cost, cost]);
    expect(components).toHaveLength(1);
    expect(components[0]).toEqual(expect.objectContaining({ componentId: c.componentId, designation: c.componentDesignation,
      unit: "u", quantity: 1, costType: "material", unitCostHtCents: cost, lossCoeffBp: 0, yieldValue: null, yieldUnit: null, dsCents: cost }));
    const assembly = state.objects.assemblies.find((row) => row.id === snapshot.assembly_id)!;
    expect(Boolean(assembly)).toBe(true);
    expect([assembly.ds_cents, assembly.indicative_target_price_cents, assembly.avg_time_hours, assembly.unit]).toEqual([cost, cost, null, "u"]);
    const library = state.objects.libraryComponents.filter((row) => row.assembly_id === assembly.id);
    expect(library).toHaveLength(1);
    expect(library[0]).toEqual(expect.objectContaining({ title: c.componentDesignation, unit: "u", default_quantity: 1,
      cost_type: "material", unit_cost_ht_cents: cost, k_fo: 1, k_mo: 0, h_mo: 0, labor_role_id: null,
      loss_coeff_bp: 0, yield_value: null, yield_unit: null }));
    const reviewed = state.objects.components.find((row) => row.id === c.componentId)!;
    expect(reviewed).toEqual(expect.objectContaining({ subdetail_id: c.subdetailId, parent_work_id: c.candidateId,
      quantity: 1, unit: "u", cost_type: "material", unit_cost_ht_cents: cost, loss_coeff_bp: 0 }));
    expect(state.objects.candidates.find((row) => row.id === c.candidateId)?.resolution_status).toBe("inserted");
    expect(state.objects.subdetails.find((row) => row.id === c.subdetailId)?.status).toBe("applied");
  }
}
