import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { expect, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";
import { ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { installProbe, replies, type Json, type Reply } from "./generated-ouvrage-recovery-support";

export type Component = { componentId: string; fragmentId: string; sourceLinkId: string; designation: string; costType: string; quantity: number; unit: string; unitCostHtCents: number };
export type Scenario = { label: string; projectId: string; versionId: string; sectionId: string; draftId: string; candidateId: string; subdetailId: string; designation: string; components: Component[] };
type Fixture = { schemaVersion: string; status: string; prefix: string; apiUrl: string; selection: string; owner: { userId: string; tenantId: string; laborRoleId: string }; scenarios: Scenario[]; reuse: { projectId: string; versionId: string; sectionId: string } };
export type Ui = { app: App; screen: Screen; browser: Browser; army: ArmyState };
export const amounts = (v: Json) => [v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents];
export const componentSection = (ui: Ui, s: Scenario) => ui.browser.locator(`[data-testid="candidate-card-${s.candidateId}"] section`);
export const componentArticle = (ui: Ui, s: Scenario, index: number) => componentSection(ui, s).getByRole("article").nth(index);

export async function prepareComponents(ui: Ui, label: string) {
  const file = process.env.E2E_GENERATED_COMPONENTS_FIXTURE_PATH;
  if (!file) throw new Error("Explicit component fixture required.");
  const bytes = await readFile(file), fixture = JSON.parse(bytes.toString()) as Fixture;
  if (fixture.schemaVersion !== "estimate-generated-components-fixture-1" || fixture.status !== "ready" || !fixture.prefix.startsWith("ARMY-GENERATED-COMPONENTS-") ||
    fixture.apiUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL || fixture.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN ||
    fixture.selection !== process.env.E2E_GENERATED_COMPONENTS_SELECTION || fixture.scenarios.map((s) => s.label).join() !== "GC01,GC02,GC03,GC04") throw new Error("Component fixture differs from exact profile.");
  const s = fixture.scenarios.find((row) => row.label === label); if (!s) throw new Error("Exact component scenario required.");
  ownEstimate(ui.army, { projectId: s.projectId, versionId: s.versionId });
  await ui.app.open(`/dashboard/estimates/${s.versionId}/edit`);
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("button", `Ajouter dans ${fixture.prefix} ${label} S`, { exact: true })).toBeEnabled();
  const client = createClient(fixture.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error || login.data.user?.id !== fixture.owner.userId) throw new Error("Ordinary component observer differs.");
  const objects = async () => {
    const state: Record<string, Json[]> = {};
    for (const [key, table, column, value] of [
      ["drafts", "estimate_generated_ouvrage_drafts", "id", s.draftId], ["candidates", "estimate_generated_ouvrage_candidates", "draft_id", s.draftId],
      ["subdetails", "estimate_generated_ouvrage_subdetail_drafts", "draft_id", s.draftId], ["components", "estimate_generated_ouvrage_subdetail_items", "draft_id", s.draftId],
      ["componentSources", "estimate_generated_ouvrage_subdetail_item_sources", "draft_id", s.draftId], ["applications", "estimate_generated_ouvrage_applications", "target_version_id", s.versionId],
      ["snapshots", "estimate_generated_ouvrage_work_snapshots", "target_version_id", s.versionId], ["assemblies", "estimate_assemblies", "source_metadata->>draft_id", s.draftId],
    ]) {
      const result = await client.from(table).select("*").eq("tenant_id", fixture.owner.tenantId).eq(column, value).order("id");
      if (result.error) throw new Error("Ordinary component object read failed."); state[key] = result.data;
    }
    state.libraryComponents = [];
    if (state.assemblies.length) {
      const result = await client.from("estimate_assembly_items").select("*").eq("tenant_id", fixture.owner.tenantId).in("assembly_id", state.assemblies.map((row) => row.id)).order("position");
      if (result.error) throw new Error("Ordinary retained library read failed."); state.libraryComponents = result.data;
    }
    return state;
  };
  const versionRows = async (versionId: string) => {
    const result = await client.from("estimate_items").select("*").eq("tenant_id", fixture.owner.tenantId).eq("version_id", versionId).order("id");
    if (result.error) throw new Error("Ordinary reused-version provenance read failed."); return result.data as Json[];
  };
  const versionRow = async (versionId: string) => {
    const result = await client.from("estimate_versions").select("*").eq("tenant_id", fixture.owner.tenantId).eq("id", versionId).single();
    if (result.error || !result.data) throw new Error("Ordinary version footer observation failed."); return result.data as Json;
  };
  const reference = JSON.parse(await readFile(".e2e/army/next/server/server-reference-manifest.json", "utf8")) as { node: Record<string, { exportedName?: string }> };
  const names = new Map(Object.entries(reference.node).map(([id, entry]) => [id, entry.exportedName]));
  const ids: Record<string, string> = {};
  for (const name of ["insertGeneratedOuvrages", "updateGeneratedOuvrageSubdetailDraft", "fetchGeneratedOuvrageSubdetailDraft"]) {
    const found = [...names].find(([, value]) => value === name); if (!found) throw new Error("Built component action missing."); ids[name] = found[0];
  }
  const url = new URL(`/dashboard/estimates/${s.versionId}/edit`, ui.app.baseUrl!).href, calls: Array<{ name: string; request: Json; sessionPresent: boolean }> = [];
  let refuseNextApplication = false;
  await ui.browser.route(url, async (route) => {
    const name = names.get(route.request.headers["next-action"] ?? "");
    if (name?.startsWith("generateOuvrage")) { await route.abort(); throw new Error("Component campaign must not invoke generation/model."); }
    if (name && ["insertGeneratedOuvrages", "updateGeneratedOuvrageSubdetailDraft"].includes(name)) {
      const [body] = JSON.parse(route.request.postData ?? "[]"), { draftLockSessionId, ...request } = body;
      calls.push({ name, request, sessionPresent: typeof draftLockSessionId === "string" });
      if (refuseNextApplication && name === "insertGeneratedOuvrages") { refuseNextApplication = false; await route.abort(); return; }
    }
    await route.continue();
  });
  const capture = async (tag: string) => {
    const estimate = await readEstimate(ui.browser, s.versionId), state = await objects();
    const observed = { estimate, objects: state, calls: [...calls] };
    await recordEvidence(ui.army, `${label}-${tag}`, observed); return observed;
  };
  const close = async () => {
    await recordEvidence(ui.army, `${label}-request-ledger`, { calls, modelInvoked: false });
    await ui.browser.unroute(url);
    const released = JSON.parse(await ui.browser.evaluate(async (versionId) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`); if (!session) return JSON.stringify({ attempted: false });
      const r = await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
      const b = await r.json(); return JSON.stringify({ attempted: true, status: r.status, released: b.data?.released === true });
    }, s.versionId));
    await recordEvidence(ui.army, `${label}-lease-release`, released);
    const logout = await client.auth.signOut({ scope: "local" }); if (logout.error) throw new Error("Ordinary component observer local sign-out failed.");
  };
  const initial = await capture("initial");
  expect(amounts(initial.estimate.version)).toEqual([0, 0, 0]); expect(initial.estimate.items.map((r) => r.id)).toEqual([s.sectionId]);
  expect(initial.objects.components).toHaveLength(4); expect(initial.objects.components.every((r) => r.status === "suggested")).toBe(true);
  for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) expect(initial.objects[key]).toHaveLength(0);
  return { fixture, s, ids, calls, objects, versionRows, versionRow, capture, close, blockNextApplication: () => { refuseNextApplication = true; } };
}
export type PreparedComponents = Awaited<ReturnType<typeof prepareComponents>>;

export async function openComponents(ui: Ui, p: PreparedComponents) {
  const opener = ui.screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
  if (!await opener.isVisible()) {
    const tab = ui.screen.getByRole("tab", "Insérer", { exact: true }); if (await tab.isVisible()) await tab.click();
    await ui.screen.getByRole("button", "Insérer", { exact: true }).click();
  }
  await opener.click(); await expect(ui.screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeVisible();
  await ui.screen.getByTestId(`generated-ouvrage-draft-${p.s.draftId}`).getByRole("button", "Reprendre", { exact: true }).click();
  const card = ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`);
  await expect(card).toBeVisible(); await card.getByRole("button", /^(Valider|Revoir) le sous-détail$/).click();
  await expect(componentSection(ui, p.s).getByRole("article")).toHaveCount(4);
}
export async function componentDecision(ui: Ui, p: PreparedComponents, index: number, decision: "Écarter" | "Rétablir") {
  const article = componentArticle(ui, p.s, index), toggle = article.getByRole("button", p.s.components[index].designation, { exact: false });
  if (!await toggle.getAttribute("aria-expanded") || await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
  const observation = await ui.browser.evaluate((candidateId) => JSON.stringify([...document.querySelectorAll(`[data-testid="candidate-card-${candidateId}"] section article`)].map((node) => ({
    text: node.textContent, buttons: [...node.querySelectorAll("button")].map((b) => ({ name: b.textContent, disabled: b.disabled })),
  }))), p.s.candidateId);
  await recordEvidence(ui.army, `${p.s.label}-decision-${index}-${decision === "Écarter" ? "exclude" : "restore"}-${p.calls.length}`, { index, decision, articles: JSON.parse(observation), state: await p.objects() });
  await expect(article.getByRole("button", decision, { exact: true })).toBeVisible(); await article.getByRole("button", decision, { exact: true }).click();
  if (decision === "Écarter") {
    await expect(article.getByText("Écarté", { exact: true })).toBeVisible();
    for (const name of ["Dupliquer", "Scinder", "Fusionner", "Supprimer"]) {
      const control = article.getByRole("button", name, { exact: true }); if (await control.count()) await expect(control).toBeDisabled();
    }
    for (const input of await article.getByRole("textbox").all()) await expect(input).toBeDisabled();
    for (const input of await article.getByRole("spinbutton").all()) await expect(input).toBeDisabled();
  }
}
export async function saveComponents(ui: Ui, p: PreparedComponents) {
  await installProbe(ui, p, "none", true);
  const before = (await replies(ui)).filter((r) => r.action === "updateGeneratedOuvrageSubdetailDraft").length;
  await componentSection(ui, p.s).getByRole("button", /^(?:(?:Valider|Revalider) le sous-détail|Enregistrer les décisions)$/).click();
  await expect.poll(async () => (await replies(ui)).filter((r) => r.action === "updateGeneratedOuvrageSubdetailDraft").length, { timeout: 45_000 }).toBe(before + 1);
  const reply = (await replies(ui)).filter((r) => r.action === "updateGeneratedOuvrageSubdetailDraft")[before];
  await recordEvidence(ui.army, `${p.s.label}-review-reply-${p.calls.length}`, reply); expect(reply.changedRecords).toBe(0); expect(reply.discarded).toBe(false); return reply;
}
export async function applyComponents(ui: Ui, p: PreparedComponents) {
  const card = ui.screen.getByTestId(`candidate-card-${p.s.candidateId}`), checkbox = card.getByRole("checkbox", `Sélectionner ${p.s.designation}`, { exact: true });
  if (!await checkbox.isChecked()) await checkbox.check();
  await installProbe(ui, p, "none", true);
  const before = (await replies(ui)).filter((r) => r.action === "insertGeneratedOuvrages").length;
  await ui.screen.getByTestId("generated-ouvrage-insert-button").click();
  await expect.poll(async () => (await replies(ui)).filter((r) => r.action === "insertGeneratedOuvrages").length, { timeout: 45_000 }).toBe(before + 1);
  const reply = (await replies(ui)).filter((r) => r.action === "insertGeneratedOuvrages")[before];
  await recordEvidence(ui.army, `${p.s.label}-application-reply`, reply); return reply;
}
export async function actualComponentAction(ui: Ui, p: PreparedComponents, name: string, request: Json): Promise<Pick<Reply, "status" | "records">> {
  return JSON.parse(await ui.browser.evaluate(async (input) => {
    const body = { ...input.request, draftLockSessionId: sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`) };
    const response = await fetch(location.href, { method: "POST", credentials: "same-origin", headers: { "content-type": "text/plain;charset=UTF-8", "next-action": input.id }, body: JSON.stringify([body]) });
    const text = await response.text(), records = text.split("\n").flatMap((line) => { const raw = line.match(/^[0-9a-f]+:(\{.*\})$/i)?.[1]; if (!raw) return []; try { const v = JSON.parse(raw); return typeof v.ok === "boolean" || typeof v.reviewToken === "string" ? [v] : []; } catch { return []; } });
    return JSON.stringify({ status: response.status, records });
  }, { versionId: p.s.versionId, id: p.ids[name], request: JSON.parse(JSON.stringify(request)) })) as Pick<Reply, "status" | "records">;
}
async function files(directory: string): Promise<string[]> { return (await Promise.all((await readdir(directory, { withFileTypes: true })).map((e) => e.isDirectory() ? files(path.join(directory, e.name)) : [path.join(directory, e.name)]))).flat(); }
export async function componentExports(ui: Ui, p: PreparedComponents, expected: number[], options: { versionId?: string; label?: string; retainedIndices?: number[] } = {}) {
  const versionId = options.versionId ?? p.s.versionId, label = options.label ?? "exports", indices = options.retainedIndices ?? [0, 1];
  const api = await readEstimate(ui.browser, versionId), lines = api.items.filter((r) => r.item_type === "line");
  expect(amounts(api.version)).toEqual(expected);
  const root = path.resolve(process.env.E2E_ARMY_ARTIFACT_ROOT!), observed = [];
  for (const mode of ["standard", "dpgf"] as const) {
    const old = new Set(await files(root));
    if (mode === "standard") await ui.screen.getByRole("button", "Exporter", { exact: true }).click(); else await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    const download = await ui.browser.waitForDownload(() => mode === "standard" ? ui.screen.getByRole("button", "Excel (.xlsx)", { exact: true }).click() : ui.screen.getByTestId("estimate-page-toolbar-export-dpgf-button").click(), { timeout: 60_000 });
    const returned = path.normalize(download.path); if (returned.split(path.sep).includes("..")) throw new Error("Component export escaped artifact directory.");
    const found = (await files(root)).filter((f) => !old.has(f) && (path.isAbsolute(returned) ? f === returned : f.endsWith(path.sep + returned))); expect(found).toHaveLength(1);
    const bytes = await readFile(found[0]), workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheets: Record<string, Array<Array<string | number | null>>> = {};
    for (const sheet of workbook.worksheets) { sheets[sheet.name] = []; sheet.eachRow((row) => sheets[sheet.name].push(Array.from({ length: sheet.columnCount }, (_, i) => typeof row.getCell(i + 1).value === "number" ? row.getCell(i + 1).value as number : row.getCell(i + 1).text || null))); }
    observed.push({ mode, path: found[0], sha256: createHash("sha256").update(bytes).digest("hex"), sheets, api, retainedIndices: indices, versionId });
    await recordEvidence(ui.army, `${p.s.label}-${label}-${mode}`, observed[observed.length - 1]);
    for (const c of p.s.components.filter((_, i) => !indices.includes(i))) expect(JSON.stringify(sheets).includes(c.designation)).toBe(false);
    if (mode === "standard") {
      for (const line of lines) {
        const rows = sheets.Devis.filter((r) => String(r[1]).trim() === line.title); expect(rows).toHaveLength(1);
        expect(rows[0].slice(2, 8)).toEqual([line.description, line.quantity, Number(line.pu_ht_cents) / 100, Number(line.line_total_ht_cents) / 100, Number(line.line_tax_cents) / 100, Number(line.line_total_ttc_cents) / 100]);
      }
      for (const [i, label] of ["Total HT", "Total TVA", "Total TTC"].entries()) expect(sheets.Resume.filter((r) => r[0] === label).map((r) => r[1])).toEqual([expected[i] / 100]);
    } else {
      for (const line of lines) {
        const rows = sheets.Données.filter((r) => r[1] === line.id); expect(rows).toHaveLength(1);
        expect([rows[0][3], rows[0][4], rows[0][5], rows[0][7], rows[0][8], rows[0][9], rows[0][10]]).toEqual([line.quantity, line.description,
          Number(line.unit_price_ht_cents) / 100, line.k_fo ?? 1, line.h_mo ?? 0, line.k_mo ?? 1, line.h_mo_majoration ?? 1]);
      }
      if (versionId === p.s.versionId && p.s.label === "GC01") {
        const rows = sheets.Données.filter((r) => r[1] === lines[0].id);
        expect([rows[0][3], rows[0][4], rows[0][5], rows[0][7], rows[0][8], rows[0][9], rows[0][10]]).toEqual([1, "u", 80, 0.5, 1, 1, 1]);
      }
    }
  }
  return observed;
}
