import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import type { CoverageRequirement, CoverageWorkspace } from "@/lib/estimates/source-coverage-contracts";
import { apiRequest, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { sdkResultsRoot } from "./sdk-results";

export type CoverageScenario = {
  projectId: string; versionId: string; sectionA: string; sectionB: string;
  draftId: string; candidateId: string; designation: string;
  documents: { A: string; B: string };
};
export type CoverageFixture = {
  schemaVersion: "source-coverage-fixture-1"; status: "ready"; prefix: string; apiUrl: string;
  owner: { userId: string; tenantId: string; laborRoleId: string };
  scenarios: Record<string, CoverageScenario>;
  corpus: { A: { sha256: string; bytes: number }; B: { sha256: string; bytes: number } };
};
export type Ui = { app: App; browser: Browser; screen: Screen };
export type Case = Ui & { fixture: CoverageFixture; scenario: CoverageScenario; army: ArmyState };
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
export const base = (s: CoverageScenario) => `/api/estimates/${s.versionId}/source-review/requirements`;
export const page = (s: CoverageScenario) => `/dashboard/estimates/${s.versionId}/source-review/requirements`;
export const clauses = [
  "Pour cet exercice, les réseaux CH-A en zone A et ECS-B en zone B reçoivent un calorifuge de 30 mm.",
  "En zone A, les parties droites et leurs deux raccords reçoivent une protection extérieure.",
  "En zone A, les deux raccords sont traités avec une finition démontable.",
  "Le diagnostic amiante de la zone A est exclu du présent lot dans cet exercice.",
  "Le traçage électrique du réseau ECS-B relève du lot Électricité.",
  "Les traversées de la zone B seront précisées par le détail D-B encore attendu.",
  "Les accès de pose en zone B restent à confirmer avant fixation du traitement des traversées.",
];
export const requirements = [
  { alias: "E1", name: "Calorifuge CH-A", zone: "A", clause: 0, treatment: "included" },
  { alias: "E2", name: "Calorifuge ECS-B", zone: "B", clause: 0, treatment: "unresolved" },
  { alias: "E3", name: "Protection complète CH-A", zone: "A", clause: 1, treatment: "priced" },
  { alias: "E4", name: "Finition démontable des deux raccords", zone: "A", clause: 2, treatment: "priced" },
  { alias: "E5", name: "Diagnostic amiante", zone: "A", clause: 3, treatment: "excluded" },
  { alias: "E6", name: "Traçage électrique", zone: "B", clause: 4, treatment: "other_lot" },
  { alias: "E7", name: "Traitement des traversées", zone: "B", clause: 5, treatment: "provisional" },
  { alias: "E8", name: "Conditions d’accès de pose", zone: "B", clause: 6, treatment: "provisional" },
] as const;
export const s1Counts = {
  total: 8, treatments: { unresolved: 1, priced: 2, included: 1, excluded: 1, other_lot: 1, provisional: 2 },
  validities: { unreviewed: 1, current: 7, needs_review: 0 },
};

export async function loadFixture() {
  const file = process.env.E2E_COVERAGE_FIXTURE_PATH;
  if (!file) throw new Error("Explicit coverage fixture required.");
  const fixture = JSON.parse(await readFile(file, "utf8")) as CoverageFixture;
  if (fixture.schemaVersion !== "source-coverage-fixture-1" || fixture.status !== "ready" ||
    fixture.apiUrl !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || !fixture.prefix.startsWith("ARMY-COVERAGE-")) throw new Error("Coverage fixture does not match the authorized profile.");
  return fixture;
}

export async function workspace(c: Case, requirementId?: string) {
  const response = await apiRequest<Envelope<CoverageWorkspace>>(c.browser, "GET", `${base(c.scenario)}${requirementId ? `?requirementId=${requirementId}` : ""}`);
  expect(response.status).toBe(200); expect(response.body.ok).toBe(true);
  return response.body.data;
}

export async function openCoverage(c: Case) {
  await c.app.open(page(c.scenario));
  await recordEvidence(c.army, "coverage-entry", await c.browser.evaluate(() => ({ pathname: location.pathname, headings: Array.from(document.querySelectorAll("h1,h2")).map((node) => node.textContent), text: document.body.innerText.slice(0, 8000) })));
  await expect(c.screen.getByRole("heading", "Exigences du CCTP", { exact: true })).toBeVisible();
}

export async function ordinaryClient(c: Case) {
  const client = createClient(c.fixture.apiUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const result = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (result.error || result.data.user?.id !== c.fixture.owner.userId) throw new Error("Ordinary coverage observer authentication failed.");
  return client;
}

export async function saveEditor(c: Case, totals: number[]) {
  const label = `editor-save-${randomUUID()}`;
  const evidence = {
    versionId: c.scenario.versionId, startedAt: new Date().toISOString(), finishedAt: null as string | null,
    expectedTotals: [...totals], confirmed: false,
    samples: [] as Array<{ observedAt: string; status: string | null; readSucceeded: boolean; totals?: number[]; updatedAt?: string; matched?: boolean }>,
  };
  try {
    await c.browser.keyboard.press("Control+s");
    await expect.poll(async () => {
      const sample: typeof evidence.samples[number] = { observedAt: new Date().toISOString(), status: null, readSucceeded: false };
      try {
        sample.status = await c.browser.evaluate(() => document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? "");
        const { version } = await readEstimate(c.browser, c.scenario.versionId);
        sample.totals = [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
        sample.updatedAt = version.updated_at;
        sample.readSucceeded = true;
        sample.matched = /Sauvegardé|À jour/.test(sample.status) && JSON.stringify(sample.totals) === JSON.stringify(totals);
        return sample.matched;
      } finally {
        evidence.samples.push(sample);
        await recordEvidence(c.army, label, evidence);
      }
    }, { timeout: 45_000, interval: 1000 }).toBe(true);
    evidence.confirmed = true;
  } finally {
    evidence.finishedAt = new Date().toISOString();
    await recordEvidence(c.army, label, evidence);
  }
}

export async function financial(c: Case, label: string, totals = [71000, 14200, 85200], hours = 8) {
  const state = await readEstimate(c.browser, c.scenario.versionId);
  const lines = state.items.filter((item) => item.item_type === "line");
  const observed = { totals: [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents], hours: lines.reduce((sum, item) => sum + Number(item.h_mo), 0), items: state.items };
  await recordEvidence(c.army, label, observed);
  expect(observed.totals).toEqual(totals); expect(observed.hours).toBe(hours);
  expect(state.items.filter((item) => item.item_type === "section")).toHaveLength(2);
  expect(lines).toHaveLength(4);
  return state;
}

export async function editorReady(c: Case, totals: number[]) {
  await expect(c.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(c.screen.getByLabel(`Quantité pour ${c.scenario.designation}`, { exact: true })).toBeEnabled();
  await expect(c.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
  const { version } = await readEstimate(c.browser, c.scenario.versionId);
  const actualTotals = [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
  await recordEvidence(c.army, `editor-ready-${randomUUID()}`, { versionId: c.scenario.versionId, observedAt: new Date().toISOString(), quantityEnabled: true, status: await c.browser.evaluate(() => document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? ""), expectedTotals: totals, actualTotals });
  expect(actualTotals).toEqual(totals);
}

export async function prepareEstimate(c: Case) {
  const { browser, screen, app, scenario: s } = c;
  await app.open(`/dashboard/estimates/${s.versionId}/edit`);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const initial = await readEstimate(browser, s.versionId);
  expect(initial.items.map((item) => item.id).sort()).toEqual([s.sectionA, s.sectionB].sort());
  const client = await ordinaryClient(c);
  for (const table of ["estimate_generated_ouvrage_applications", "estimate_generated_ouvrage_work_snapshots"]) {
    const check = await client.from(table).select("id").eq("tenant_id", c.fixture.owner.tenantId).eq("target_version_id", s.versionId);
    if (check.error) throw new Error(`Ordinary ${table} read failed.`);
    expect(check.data).toHaveLength(0);
  }
  const opener = screen.getByTestId("estimate-editor-open-generated-ouvrage-button");
  if (!await opener.isVisible()) {
    const tab = screen.getByRole("tab", "Insérer", { exact: true });
    if (await tab.isVisible()) await tab.tap();
    await screen.getByRole("button", "Insérer", { exact: true }).tap();
  }
  await opener.tap();
  await screen.getByTestId(`generated-ouvrage-draft-${s.draftId}`).getByRole("button", "Reprendre", { exact: true }).tap();
  const card = screen.getByTestId(`candidate-card-${s.candidateId}`);
  await card.getByRole("button", "Valider le sous-détail", { exact: true }).tap();
  await expect(card.getByText("Sous-détail composé", { exact: true })).toBeVisible();
  await browser.locator(`[data-testid="candidate-card-${s.candidateId}"] section`).getByRole("button", "Valider le sous-détail", { exact: true }).tap();
  await expect(card.getByText("Revu", { exact: true })).toBeVisible();
  await card.getByRole("checkbox", `Sélectionner ${s.designation}`, { exact: true }).check();
  await screen.getByRole("button", "Insérer les ouvrages sélectionnés", { exact: true }).tap();
  await expect(screen.getByRole("dialog", "Générer des ouvrages", { exact: true })).toBeHidden();
  await saveEditor(c, [40000, 8000, 48000]);
  const l1 = (await readEstimate(browser, s.versionId)).items.filter((item) => item.item_type === "line");
  expect(l1).toHaveLength(1);
  expect([l1[0].parent_id, l1[0].description, l1[0].quantity, l1[0].h_mo, l1[0].k_fo, l1[0].k_mo, l1[0].labor_role_id]).toEqual([s.sectionA, "m", 10, 5, 0.5, 1, c.fixture.owner.laborRoleId]);
  const applications = await client.from("estimate_generated_ouvrage_applications").select("*").eq("tenant_id", c.fixture.owner.tenantId).eq("target_version_id", s.versionId);
  const snapshots = await client.from("estimate_generated_ouvrage_work_snapshots").select("*").eq("tenant_id", c.fixture.owner.tenantId).eq("target_version_id", s.versionId);
  if (applications.error || snapshots.error) throw new Error("Applied work proof is unreadable.");
  expect(applications.data).toHaveLength(1); expect(snapshots.data).toHaveLength(1);
  await recordEvidence(c.army, "applied-work", { line: l1[0], applications: applications.data, snapshots: snapshots.data });
  const specs = [
    { title: "ARMY Protection parties droites CH-A", parent_id: s.sectionA, quantity: 4, description: "m", unit_price_ht_cents: 1000, h_mo: 1, position: 2 },
    { title: "ARMY Protection démontable des raccords CH-A", parent_id: s.sectionA, quantity: 2, description: "u", unit_price_ht_cents: 1500, h_mo: 0.5, position: 3 },
    { title: "ARMY Canalisation ECS-B sans calorifuge", parent_id: s.sectionB, quantity: 6, description: "m", unit_price_ht_cents: 2000, h_mo: 1.5, position: 1 },
  ];
  const immediate: Array<{ observedAt: string; status: number; itemId: string; expectedTotals: number[]; actualTotals: number[]; updatedAt: string }> = [];
  const expectedSteps = [[48000, 9600, 57600], [53000, 10600, 63600], [71000, 14200, 85200]];
  for (const [index, spec] of specs.entries()) {
    const result = await browser.evaluate(async (input) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`);
      if (!session) throw new Error("Real editor session required.");
      const response = await fetch(`/api/estimates/${input.versionId}/items`, { method: "POST", headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: JSON.stringify(input.item) });
      return { status: response.status, body: await response.json() };
    }, { versionId: s.versionId, item: { ...spec, item_type: "line", line_nature: "supply_and_labor", labor_role_id: c.fixture.owner.laborRoleId, tax_rate_bp: 2000, k_fo: 1, k_mo: 1, h_mo_majoration: 1 } });
    expect(result.status).toBe(201); expect(result.body.ok).toBe(true);
    const { version } = await readEstimate(browser, s.versionId);
    immediate.push({ observedAt: new Date().toISOString(), status: result.status, itemId: result.body.data.item.id,
      expectedTotals: expectedSteps[index], actualTotals: [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents], updatedAt: version.updated_at });
    await recordEvidence(c.army, "s0-immediate-api", { versionId: s.versionId, explicitSaveAfterCreates: false, immediate });
    expect(immediate[index].actualTotals).toEqual(expectedSteps[index]);
  }
  const bulkUrl = new URL(`/api/estimates/${s.versionId}/items/bulk`, app.baseUrl!).href;
  const synchronization = {
    versionId: s.versionId, expectedTotals: [71000, 14200, 85200],
    observationStartedAt: null as string | null, observationEndedAt: null as string | null,
    explicitSaveAfterCreates: false,
    loaded: null as { observedAt: string; status: string; totals: number[]; updatedAt: string } | null,
    posts: [] as Array<{ observedAt: string }>,
    samples: [] as Array<{ observedAt: string; status: string; totals: number[]; updatedAt: string }>,
  };
  await browser.route(bulkUrl, async (route) => {
    if (route.request.method === "POST") synchronization.posts.push({ observedAt: new Date().toISOString() });
    await route.fallback();
  });
  try {
    await browser.reload();
    await editorReady(c, [71000, 14200, 85200]);
    const loadedVersion = (await readEstimate(browser, s.versionId)).version;
    synchronization.loaded = {
      observedAt: new Date().toISOString(),
      status: await browser.evaluate(() => document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? ""),
      totals: [loadedVersion.total_ht_cents, loadedVersion.total_tax_cents, loadedVersion.total_ttc_cents], updatedAt: loadedVersion.updated_at,
    };
    await recordEvidence(c.army, "s0-already-synchronized", synchronization);
    const status = screen.getByTestId("estimate-page-toolbar-autosave-status");
    await expect(status).toHaveText(/^(Sauvegardé|À jour)$/);
    synchronization.observationStartedAt = new Date().toISOString();
    const deadline = Date.now() + 3000;
    do {
      const statusText = await browser.evaluate(() => document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent ?? "");
      const { version } = await readEstimate(browser, s.versionId);
      synchronization.samples.push({ observedAt: new Date().toISOString(), status: statusText, totals: [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents], updatedAt: version.updated_at });
      await recordEvidence(c.army, "s0-already-synchronized", synchronization);
      await delay(1000);
    } while (Date.now() < deadline);
    synchronization.observationEndedAt = new Date().toISOString();
    await recordEvidence(c.army, "s0-already-synchronized", synchronization);
    expect(synchronization.posts).toHaveLength(0);
    expect(synchronization.samples.every((sample) => /^(Sauvegardé|À jour)$/.test(sample.status.trim()))).toBe(true);
    expect(synchronization.samples.map((sample) => sample.totals)).toEqual(synchronization.samples.map(() => [71000, 14200, 85200]));
    await browser.reload();
    await editorReady(c, [71000, 14200, 85200]);
    expect(synchronization.posts).toHaveLength(0);
  } finally {
    await recordEvidence(c.army, "s0-already-synchronized", synchronization);
    await browser.unroute(bulkUrl);
  }
  const state = await financial(c, "s0");
  const signedOut = await client.auth.signOut({ scope: "local" });
  if (signedOut.error) throw new Error("Ordinary coverage observer session cleanup failed.");
  return { L1: l1[0], L2: state.items.find((item) => item.title === specs[0].title)!, L3: state.items.find((item) => item.title === specs[1].title)!, L4: state.items.find((item) => item.title === specs[2].title)!, applied: { applicationId: applications.data[0].id as string, snapshotId: snapshots.data[0].id as string } };
}

export async function retainReference(c: Case, key: "A" | "B") {
  await c.app.open(`/dashboard/estimates/${c.scenario.versionId}/source-review`);
  await c.screen.getByLabel("Document CCTP", { exact: true }).selectOption({ value: c.scenario.documents[key] });
  await c.screen.getByRole("button", "Préparer une copie", { exact: true }).tap();
  const prepared = c.screen.getByRole("region", "Copie préparée", { exact: true });
  await expect(prepared.getByText("Copie prête à consulter", { exact: true })).toBeVisible({ timeout: 70_000 });
  await prepared.getByRole("button", "Consulter la copie", { exact: true }).tap();
  await expect(c.browser.locator('iframe[title="Copie conservée du CCTP"]')).toBeVisible();
  await c.screen.getByRole("button", "Fermer la consultation", { exact: true }).tap();
  await c.screen.getByLabel("J’ai consulté cette copie", { exact: true }).check();
  await c.screen.getByLabel("Motif de confirmation", { exact: true }).fill(`Recette synthétique DOS-CAL-01 : référence ${key} consultée.`);
  await c.screen.getByRole("button", "Confirmer la référence", { exact: true }).tap();
  await expect.poll(async () => {
    const result = await apiRequest<Envelope<{ activeReference: { sha256: string } | null }>>(c.browser, "GET", `/api/estimates/${c.scenario.versionId}/source-review`);
    return result.body.data?.activeReference?.sha256;
  }).toBe(c.fixture.corpus[key].sha256);
}

export async function createRegister(c: Case) {
  // Every fixture project has exactly one version; the hub selects it itself.
  // The ordinary read below verifies that the canonical entry used that ID.
  await c.app.open(`/dashboard/affaires/${c.scenario.projectId}#register`);
  const entries = [
    { key: "H1", kind: "assumption", text: "ARMY hypothèse : accès de pose disponibles en zone B ; à confirmer." },
    { key: "M1", kind: "missing_piece", text: "ARMY pièce manquante : détail D-B des traversées en zone B." },
  ];
  for (const entry of entries) {
    await c.screen.getByRole("button", "+ Ajouter un point", { exact: true }).tap();
    await c.screen.getByLabel("Type", { exact: true }).selectOption({ value: entry.kind });
    await c.screen.getByLabel("Sévérité", { exact: true }).selectOption({ value: "warning" });
    await c.screen.getByLabel("Scope", { exact: true }).selectOption({ value: "lot" });
    await c.screen.getByLabel("Lot cible", { exact: true }).selectOption({ value: c.scenario.sectionB });
    await c.screen.getByLabel("Texte", { exact: true }).fill(entry.text);
    await c.screen.getByRole("button", "Ajouter au registre", { exact: true }).tap();
    await expect(c.screen.getByLabel("Texte", { exact: true })).toBeHidden();
    await expect(c.screen.getByText(entry.text, { exact: true })).toBeVisible();
  }
  const client = await ordinaryClient(c);
  const result = await client.from("affaire_register_entries").select("id,kind,text,status,scope_type,scope_id,version_id,origin_kind,is_active").eq("tenant_id", c.fixture.owner.tenantId).eq("project_id", c.scenario.projectId).order("kind");
  if (result.error) throw new Error("Ordinary register read failed.");
  expect(result.data).toHaveLength(2);
  for (const entry of result.data) expect([entry.status, entry.scope_type, entry.scope_id, entry.version_id, entry.origin_kind, entry.is_active]).toEqual(["open", "lot", c.scenario.sectionB, c.scenario.versionId, "manual", true]);
  await recordEvidence(c.army, "canonical-register", result.data);
  const signedOut = await client.auth.signOut({ scope: "local" });
  if (signedOut.error) throw new Error("Ordinary coverage observer session cleanup failed.");
  return { H1: result.data.find((entry) => entry.kind === "assumption")!, M1: result.data.find((entry) => entry.kind === "missing_piece")! };
}

export async function selectRequirement(c: Case, id: string) {
  await c.screen.getByTestId(`coverage-requirement-${id}`).getByRole("button", "Ouvrir l’exigence", { exact: true }).tap();
  await expect(c.screen.getByTestId(`coverage-editor-${id}`)).toBeVisible();
  await expect(c.screen.getByRole("button", "Préparer la décision", { exact: true })).toBeEnabled();
  return c.screen.getByRole("region", "Exigence sélectionnée", { exact: true });
}

export async function saveRequirement(c: Case) {
  const response = c.browser.waitForResponse(new URL(base(c.scenario), c.app.baseUrl!).href);
  await c.screen.getByRole("button", "Enregistrer les modifications", { exact: true }).tap();
  const result = await response;
  const body = JSON.parse(await result.text());
  expect(result.status).toBe(201); expect(body.ok).toBe(true);
  await expect(c.screen.getByRole("button", "Préparer la décision", { exact: true })).toBeEnabled();
  await expect(c.screen.getByRole("button", "Enregistrer les modifications", { exact: true })).toBeDisabled();
}

export async function decide(c: Case, requirement: CoverageRequirement, treatment: string) {
  await selectRequirement(c, requirement.id);
  await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
  await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: treatment });
  await c.screen.getByLabel("Motif de décision", { exact: true }).fill(`Recette synthétique ${requirement.prescription} : éléments explicitement examinés.`);
  if (treatment === "other_lot") await c.screen.getByLabel("Lot destinataire", { exact: true }).fill("Électricité");
  if (treatment === "provisional") await c.screen.getByLabel("Incertitude restante", { exact: true }).fill("Détail et accès à confirmer");
  await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
  await c.screen.getByRole("button", "Confirmer le traitement", { exact: true }).tap();
  await expect.poll(async () => (await workspace(c, requirement.id)).selectedRequirement?.validity).toBe("current");
}

export async function verifyCitation(c: Case, requirementId: string) {
  const requirement = (await workspace(c, requirementId)).selectedRequirement!;
  for (const citation of requirement.citations) {
    const section = c.screen.getByTestId(`coverage-citation-${citation.id}`);
    await section.getByRole("button", "Consulter le passage", { exact: true }).tap();
    const consultation = c.screen.getByRole("region", "Consultation du passage cité", { exact: true });
    await expect(consultation).toBeVisible();
    await consultation.getByLabel("J’ai vérifié ce passage dans cette copie", { exact: true }).check();
    await consultation.getByRole("button", "Vérifier la citation", { exact: true }).tap();
    await expect.poll(async () => Boolean((await workspace(c, requirementId)).selectedRequirement?.citations.find((entry) => entry.id === citation.id)?.verification)).toBe(true);
    await expect(consultation).toBeHidden();
    await expect(c.screen.getByRole("button", "Préparer la décision", { exact: true })).toBeEnabled();
  }
}

export async function establishS1(c: Case) {
  const lines = await prepareEstimate(c);
  await exportsAt(c, "s0");
  const register = await createRegister(c);
  await retainReference(c, "A");
  await openCoverage(c);
  expect((await workspace(c)).counts.total).toBe(0);
  await c.screen.getByRole("button", "Ajouter une exigence", { exact: true }).tap();
  for (const [kind, label] of [["zone", "Zone A — chaufferie"], ["network", "CH-A"], ["zone", "Zone B — étage"], ["network", "ECS-B"]]) {
    await c.screen.getByRole("button", "Ajouter une zone ou un réseau", { exact: true }).tap();
    const dialog = c.screen.getByRole("dialog", "Déclarer un périmètre d’affaire", { exact: true });
    await dialog.getByLabel("Type de périmètre", { exact: true }).selectOption({ value: kind });
    await dialog.getByLabel("Libellé du périmètre", { exact: true }).fill(label);
    await dialog.getByLabel("Étendue du périmètre", { exact: true }).fill(`Périmètre synthétique ${label}, sans inférence du lot DPGF.`);
    await dialog.getByRole("button", "Enregistrer le périmètre", { exact: true }).tap();
    await expect.poll(async () => (await workspace(c)).dimensions.some((entry) => entry.label === label)).toBe(true);
  }
  const dimensions = (await workspace(c)).dimensions;
  const ids: Record<string, string> = {};
  for (const spec of requirements) {
    await c.screen.getByRole("button", "Ajouter une exigence", { exact: true }).tap();
    await c.screen.getByLabel("Prescription", { exact: true }).fill(`${spec.alias} ${spec.name}`);
    await c.screen.getByLabel("Prestation attendue", { exact: true }).fill(clauses[spec.clause]);
    await c.screen.getByLabel("Périmètre", { exact: true }).selectOption({ value: "specified" });
    await c.screen.getByLabel("Zone", { exact: true }).selectOption({ value: dimensions.find((entry) => entry.kind === "zone" && entry.label.startsWith(`Zone ${spec.zone}`))!.id });
    await c.screen.getByLabel("Réseau", { exact: true }).selectOption({ value: dimensions.find((entry) => entry.kind === "network" && entry.label === (spec.zone === "A" ? "CH-A" : "ECS-B"))!.id });
    await c.screen.getByRole("button", "Choisir un contexte DPGF", { exact: true }).tap();
    await c.screen.getByRole("button", "Rechercher les lots DPGF", { exact: true }).tap();
    await c.screen.getByTestId(`coverage-target-${spec.zone === "A" ? c.scenario.sectionA : c.scenario.sectionB}`).getByRole("button", "Choisir ce lot DPGF", { exact: true }).tap();
    await c.screen.getByRole("button", "Ajouter une citation de la référence actuelle", { exact: true }).tap();
    await c.screen.getByLabel("Page physique", { exact: true }).fill(spec.clause < 3 ? "2" : "3");
    await c.screen.getByLabel("Folio imprimé", { exact: true }).fill(spec.clause < 3 ? "CVC-10" : "CVC-11");
    await c.screen.getByLabel("Passage cité", { exact: true }).fill(clauses[spec.clause]);
    await expect(c.screen.getByLabel("Prestation entièrement traitée", { exact: true })).not.toBeChecked();
    await saveRequirement(c);
    await expect.poll(async () => (await workspace(c)).requirements.filter((entry) => entry.prescription === `${spec.alias} ${spec.name}`).length).toBe(1);
    ids[spec.alias] = (await workspace(c)).requirements.find((entry) => entry.prescription === `${spec.alias} ${spec.name}`)!.id;
  }
  const initial = await workspace(c);
  expect(initial.counts).toEqual({ total: 8, treatments: { unresolved: 8, priced: 0, included: 0, excluded: 0, other_lot: 0, provisional: 0 }, validities: { unreviewed: 8, current: 0, needs_review: 0 } });
  await recordEvidence(c.army, "eight-unreviewed-requirements", initial);
  for (const spec of requirements) {
    const id = ids[spec.alias];
    await selectRequirement(c, id); await verifyCitation(c, id);
    if (spec.alias === "E2") continue;
    const links = spec.alias === "E1" ? [{ kind: "component", id: lines.L1.id, title: lines.L1.title }]
      : spec.alias === "E3" ? [{ kind: "line", id: lines.L2.id, title: lines.L2.title }, { kind: "line", id: lines.L3.id, title: lines.L3.title }]
        : spec.alias === "E4" ? [{ kind: "line", id: lines.L3.id, title: lines.L3.title }]
          : spec.alias === "E7" ? [{ kind: "register", id: register.H1.id, title: register.H1.text }, { kind: "register", id: register.M1.id, title: register.M1.text }]
            : spec.alias === "E8" ? [{ kind: "register", id: register.H1.id, title: register.H1.text }] : [];
    for (const link of links) {
      if (!await c.screen.getByLabel("Justification du lien", { exact: true }).isVisible()) await c.screen.getByRole("button", "Ajouter un lien", { exact: true }).tap();
      await c.screen.getByLabel("Type de cible", { exact: true }).selectOption({ value: link.kind });
      await c.screen.getByLabel("Recherche de cible", { exact: true }).fill(link.title);
      await c.screen.getByLabel("Justification du lien", { exact: true }).fill(`Recette ${spec.alias} : cible réelle revue dans son périmètre explicite.`);
      await c.screen.getByRole("button", "Rechercher les cibles", { exact: true }).tap();
      const target = c.screen.getByTestId(`coverage-target-${link.id}`);
      if (link.kind === "component") {
        const components = target.getByRole("button", "Lier ce composant", { exact: true });
        const option = await apiRequest<Envelope<{ items: Array<{ id: string; components: Array<{ kind: string; title: string; applicationId?: string; componentId?: string; quantity?: number; unit?: string }> }> }>>(c.browser, "GET", `${base(c.scenario)}/targets?kind=component&search=${encodeURIComponent(link.title)}`);
        expect(option.status).toBe(200);
        const iso = option.body.data.items.find((entry) => entry.id === link.id)!.components.filter((component) => component.title.includes("calorifuge"));
        expect(iso).toHaveLength(1); expect([iso[0].quantity, iso[0].unit]).toEqual([10, "m"]);
        await expect(components).toHaveCount(3);
        await c.screen.getByTestId(`coverage-component-${iso[0].applicationId}-${iso[0].componentId}`).getByRole("button", "Lier ce composant", { exact: true }).tap();
      } else await target.getByRole("button", "Lier cette cible", { exact: true }).tap();
      await expect(c.screen.getByLabel("Prestation entièrement traitée", { exact: true })).not.toBeChecked();
      if (spec.alias === "E3" && link.id === lines.L2.id) {
        await saveRequirement(c);
        await c.screen.getByRole("button", "Préparer la décision", { exact: true }).tap();
        await c.screen.getByLabel("Traitement", { exact: true }).selectOption({ value: "priced" });
        await c.screen.getByLabel("Motif de décision", { exact: true }).fill("L2 seule : lien partiel conservé, raccords encore non rapprochés.");
        await c.screen.getByLabel("J’ai examiné les faits et le traitement proposé", { exact: true }).check();
        await expect(c.screen.getByRole("button", "Confirmer le traitement", { exact: true })).toBeDisabled();
        const partial = (await workspace(c, id)).selectedRequirement!;
        expect([partial.completeness, partial.treatment, partial.lastDecision]).toEqual(["partial", "unresolved", null]);
        await recordEvidence(c.army, "e3-l2-partial-not-decided", partial);
      }
    }
    if (["included", "priced"].includes(spec.treatment)) {
      await saveRequirement(c);
      await expect.poll(async () => (await workspace(c, id)).selectedRequirement?.links.length).toBe(links.length);
      expect((await workspace(c, id)).selectedRequirement?.validity).toBe("unreviewed");
      await c.screen.getByLabel("Prestation entièrement traitée", { exact: true }).check();
      await c.screen.getByLabel("Motif de complétude", { exact: true }).fill(`Recette ${spec.alias} : toute la prestation a été explicitement examinée avec ses cibles.`);
    }
    if (links.length) await saveRequirement(c);
    await expect.poll(async () => (await workspace(c, id)).selectedRequirement?.links.length).toBe(links.length);
    await decide(c, (await workspace(c, id)).selectedRequirement!, spec.treatment);
  }
  await c.browser.reload();
  const state = await workspace(c);
  expect(state.counts).toEqual(s1Counts);
  await recordEvidence(c.army, "s1-eight-requirements", state);
  await financial(c, "s1-finances");
  return { ids, lines, register, state };
}

async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? files(path.join(folder, entry.name)) : [path.join(folder, entry.name)]))).flat();
}

export async function exportsAt(c: Case, label: string) {
  const editorPath = `/dashboard/estimates/${c.scenario.versionId}/edit`;
  if (await c.browser.evaluate(() => location.pathname) !== editorPath) await c.app.open(editorPath);
  await expect(c.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  const root = sdkResultsRoot();
  const evidence = [];
  for (const mode of ["standard", "dpgf"] as const) {
    const old = new Set(await files(root));
    if (mode === "standard") await c.screen.getByRole("button", "Exporter", { exact: true }).tap();
    else await c.screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const download = await c.browser.waitForDownload(() => mode === "standard"
      ? c.screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap()
      : c.screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 });
    const returned = path.normalize(download.path);
    if (returned.split(path.sep).includes("..")) throw new Error("Download path escaped the test directory.");
    const found = (await files(root)).filter((file) => !old.has(file) && (path.isAbsolute(returned) ? file === returned : file.endsWith(path.sep + returned)));
    expect(found).toHaveLength(1);
    const bytes = await readFile(found[0]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheets: Record<string, Array<Array<string | number | null>>> = {};
    for (const worksheet of workbook.worksheets) {
      sheets[worksheet.name] = [];
      worksheet.eachRow((row) => sheets[worksheet.name].push(Array.from({ length: worksheet.columnCount }, (_, index) => { const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null; })));
    }
    const allText = JSON.stringify(sheets);
    for (const forbidden of [...clauses, "ARMY hypothèse :", "ARMY pièce manquante :", "Recette synthétique E", "Détail et accès à confirmer"]) expect(allText.includes(forbidden)).toBe(false);
    if (mode === "standard") {
      const expected = [
        [c.scenario.designation, "m", 10, 40, 400, 80, 480],
        ["ARMY Protection parties droites CH-A", "m", 4, 20, 80, 16, 96],
        ["ARMY Protection démontable des raccords CH-A", "u", 2, 25, 50, 10, 60],
        ["ARMY Canalisation ECS-B sans calorifuge", "m", 6, 30, 180, 36, 216],
      ];
      for (const row of expected) {
        const found = sheets.Devis.filter((candidate) => typeof candidate[1] === "string" && candidate[1].trim() === row[0]);
        expect(found).toHaveLength(1); expect([String(found[0][1]).trim(), ...found[0].slice(2, 8)]).toEqual(row);
      }
      for (const [name, value] of [["Total HT", 710], ["Total TVA", 142], ["Total TTC", 852]]) expect(sheets.Resume.filter((row) => row[0] === name).map((row) => row[1])).toEqual([value]);
    } else {
      const estimate = await readEstimate(c.browser, c.scenario.versionId);
      const rows = sheets.Données.filter((row) => estimate.items.some((item) => item.id === row[1]));
      expect(rows).toHaveLength(6);
      // Last column: « Majoration MO (%) », 100 = neutral (P-11, sub-lot 2.3).
      const expected = [[c.scenario.designation, 10, "m", 40, 0.5, 5, 1, 100], ["ARMY Protection parties droites CH-A", 4, "m", 10, 1, 1, 1, 100], ["ARMY Protection démontable des raccords CH-A", 2, "u", 15, 1, 0.5, 1, 100], ["ARMY Canalisation ECS-B sans calorifuge", 6, "m", 20, 1, 1.5, 1, 100]];
      for (const expectedRow of expected) {
        const row = rows.find((candidate) => String(candidate[2]).trim() === expectedRow[0]);
        expect(row).toBeDefined(); expect([String(row![2]).trim(), ...row!.slice(3, 6), ...row!.slice(7, 11)]).toEqual(expectedRow);
      }
    }
    evidence.push({ mode, path: found[0], sha256: createHash("sha256").update(bytes).digest("hex"), sheets });
  }
  await recordEvidence(c.army, `exports-${label}`, evidence);
  return evidence;
}
