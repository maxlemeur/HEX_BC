import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import * as XLSX from "xlsx";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
// The 2.4 reading of the OPTIMA control cells (15 significant digits, half up), shared with optima-lot-check.
import { controlCents } from "../../../src/lib/imports/optima-control";
import { ownedEstimateContext } from "./calculation-gate-support";
// Aliased: not a React hook, despite its name.
import { setTenantCalcPolicy, useDedicatedV3Owner as signUpDedicatedV3Owner, type V3Owner } from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.8 — chemins d'entrée v3 (docs/testing/estimate-engine-v3-2.8.md). Défaillances
// observables, écrites avant le code :
//  E1  Créer un chiffrage depuis un import sous politique 3 est refusé (moteur indisponible).
//  E2  « Tps pose unitaire » est converti en heures de ligne (h/u × Q).
//  E3  L'unité importée va dans la description ; une mention de statut reste une unité.
//  E4  Les coefficients de la ligne de paramètres ne sont pas proposés pour la v3.
//  E5  Le contrôle « Prix Unitaire » est calculé par le moteur v1/v2.
//  E6  Un collage OPTIMA avec heures est refusé sur une v3 ; aucune cible h/u.
//  E7  Un ouvrage de bibliothèque est refusé dans une v3.
//  E9  Un modèle est refusé dans une v3.
// Chiffres d'acceptation : conception §5.4 (lots OPTIMA complets, P-03), aussi contrôlés hors navigateur par
// scripts/engine-v3/optima-lot-check.ts. Les classeurs sont déjà versionnés (docs/prd_file, S-01) : le parcours
// en copie un dans ses artefacts et n'ajoute rien au dépôt.
const options = { session: "army", tags: ["critical", "local", "engine-v3", "import"], timeout: 900_000 } as const;
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Created = { project: { id: string }; version: ArmyEstimate["version"] };
type Ui = { app: App; screen: Screen; browser: Browser };

const WORKBOOKS = path.resolve("docs/prd_file/exemple chiffrage OPTIMA");
const LOTS = {
  HYDRAULIQUE: {
    file: "BEING - DPGF HYDRAULIQUE.xlsx", priced: 785,
    sumAtWorkbookCoefficientsCents: 164_420_761, sumAtOfferCoefficientsCents: 157_232_099, costCents: 126_474_907,
    realizedSaleCoefficient: "1.243188",
    statuses: { out_of_scope: 61, included: 10, not_priced: 7, for_memory: 1 },
  },
  PLOMBERIE: {
    file: "BEING - DPGF PLOMBERIE.xlsx", priced: 656,
    sumAtWorkbookCoefficientsCents: 102_765_561, sumAtOfferCoefficientsCents: 98_188_792, costCents: 79_049_005,
    realizedSaleCoefficient: "1.242126",
    statuses: { out_of_scope: 74, not_priced: 4, not_applicable: 3, for_memory: 1 },
  },
} as const;
type Lot = (typeof LOTS)[keyof typeof LOTS];
const NEUTRAL_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 3,
  currency: "EUR", contractor_role: "principal",
};
const EDITOR_URL = /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i;
const STATUS_MENTIONS = /^(HL|inc|NC|PM|CP|SO)$/i;
const field = (item: object, key: string) => (item as Record<string, unknown>)[key];
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

/** The control prices of the priced lines and the status mentions of a workbook (§5.4 reading). */
async function readLot(lot: Lot) {
  const workbook = XLSX.read(await readFile(path.join(WORKBOOKS, lot.file)), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[workbook.SheetNames[0]!]!, { header: 1, raw: true });
  const headers = (rows[0] ?? []).map((cell) => String(cell ?? "").replace(/\s+/g, " ").trim());
  const column = (name: string) => headers.findIndex((header) => header.toLowerCase() === name.toLowerCase());
  const [label, unit, quantity, price] = [column("Désignation"), column("Uté"), column("Qté"), column("Prix Unitaire")];
  if ([label, unit, quantity, price].some((index) => index < 0)) throw new Error(`${lot.file}: OPTIMA headers missing.`);
  const controls: number[] = [];
  let statuses = 0;
  for (const row of rows.slice(1)) {
    const text = String(row[label] ?? "").trim();
    if (!text || /^Sous-total|^Total/i.test(text)) continue;
    if (STATUS_MENTIONS.test(String(row[unit] ?? "").trim())) { statuses += 1; continue; }
    const q = row[quantity];
    const pu = row[price];
    if (typeof q === "number" && q > 0 && typeof pu === "number" && pu > 0) controls.push(controlCents(pu));
  }
  return { controls: controls.sort((a, b) => a - b), statuses };
}

async function createVersion(browser: Browser, body: Record<string, unknown>) {
  return apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", body);
}

async function retakeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect([200, 201]).toContain(lease.status);
}

/**
 * The insert routes (/api/estimates/assemblies/…, /api/estimates/templates/…) carry no version in their
 * path, so the fixture does not attach this page's draft lease session: send it explicitly.
 */
async function leaseSession(browser: Browser, versionId: string) {
  const sessionId = await browser.evaluate((id) => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  if (!sessionId) throw new Error("The draft lease session of this page is missing.");
  return { "x-estimate-draft-lock-session-id": sessionId };
}

async function saveSettings(browser: Browser, army: ArmyState, versionId: string, label: string, patch: Record<string, unknown>) {
  const started = Date.now();
  const mark = (step: string) => recordEvidence(army, `io-settings-${label}-progress`, { step, elapsedMs: Date.now() - started });
  await mark("lease");
  await retakeLease(browser, versionId);
  await mark("read");
  const before = await readEstimate(browser, versionId);
  await mark("save");
  const sent = Date.now();
  const response = await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}`,
    { ...patch, expected_content_revision: before.version.content_revision }, { "if-match": before.version.updated_at });
  await recordEvidence(army, `io-settings-${label}`, { versionId, patch, status: response.status, ok: response.body.ok,
    elapsedMs: { leaseAndRead: sent - started, save: Date.now() - sent } });
  expect([response.status, response.body.ok]).toEqual([200, true]);
  return readEstimate(browser, versionId);
}

/** Owner, Tuyauteur role at 40 €/h and an affaire with a v2 anchor, then the tenant policy at 3. */
async function prepareV3Owner(ui: Ui, army: ArmyState, label: string) {
  const { app, browser } = ui;
  const dedicated = await signUpDedicatedV3Owner(browser, app.baseUrl!, army.runPrefix);
  await app.open("/dashboard/affaires");
  const anchor = await createVersion(browser, { project: { name: `ARMY-L2-IO-${label}-${army.runPrefix}` },
    version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ancre v2` } });
  expect([anchor.status, anchor.body.ok]).toEqual([201, true]);
  const projectId = anchor.body.data.project.id;
  ownEstimate(army, { projectId, versionId: anchor.body.data.version.id });
  const context = await ownedEstimateContext(projectId);
  const owner: V3Owner = { tenantId: context.tenantId, userId: context.userId };
  if (owner.tenantId !== dedicated.tenantId) throw new Error("The 2.8 journeys must run as their dedicated owner.");
  await retakeLease(browser, anchor.body.data.version.id);
  const role = await apiRequest<Envelope<{ labor_role: { id: string } }>>(browser, "POST",
    `/api/estimates/${anchor.body.data.version.id}/labor-roles`, { name: "Tuyauteur", hourly_rate_cents: 4000 });
  expect([role.status, role.body.ok]).toEqual([201, true]);
  await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.8 ${label}` });
  return { owner, projectId, anchorId: anchor.body.data.version.id, roleId: role.body.data.labor_role.id };
}

async function closePolicy(owner: V3Owner, army: ArmyState, label: string) {
  await setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.8 ${label} fin` });
}

/** Imports a workbook copy through the affaire's import flow and returns the version it creates. */
async function importWorkbook(ui: Ui, army: ArmyState, projectId: string, lot: Lot) {
  const { app, screen, browser } = ui;
  const directory = path.resolve(".e2e/army/local/artifacts/fixtures");
  await mkdir(directory, { recursive: true });
  const fixturePath = path.join(directory, `${army.runPrefix}-${path.basename(lot.file)}`);
  await copyFile(path.join(WORKBOOKS, lot.file), fixturePath);
  await app.open(`/dashboard/affaires/${projectId}?created=1`);
  await screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
  await expect(screen.getByText("Glissez-déposez votre fichier DPGF ici", { exact: true })).toBeVisible({ timeout: 30_000 });
  const workbookInput = browser.locator('input[type="file"]:not([multiple])');
  const launch = screen.getByRole("button", "Lancer l'import", { exact: true });
  await expect.poll(async () => {
    if (!(await launch.isVisible())) await workbookInput.setInputFiles(fixturePath);
    return launch.isVisible();
  }, { timeout: 30_000 }).toBe(true);
  await launch.tap();
  const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
  const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
  await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), { timeout: 60_000 }).toBe(true);
  if (await editMapping.isVisible()) await editMapping.tap();
  await expect(nextMapping).toBeEnabled();
  await nextMapping.tap();
  // E4, E5: the preview proposes the workbook coefficients for the v3 and lists no control gap.
  await expect(screen.getByText("Coefficients du classeur proposés : FO 1,3 · MO 1,3", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(screen.getByText("Aucun écart supérieur à 0,5 c avec « Prix Unitaire »", { exact: true })).toBeVisible();
  const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
  await expect(nextPreview).toBeEnabled({ timeout: 30_000 });
  await nextPreview.tap();
  const confirm = screen.getByRole("button", "Créer le chiffrage", { exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.tap();
  await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 120_000 });
  await screen.getByRole("button", "Continuer", { exact: true }).tap();
  const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
  await expect.poll(async () => EDITOR_URL.test(await browser.url()) || await skipPlans.isVisible(), { timeout: 30_000 }).toBe(true);
  if (await skipPlans.isVisible()) await skipPlans.tap();
  await expect(browser).toHaveURL(EDITOR_URL, { timeout: 30_000 });
  const versionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1]!;
  ownEstimate(army, { projectId, versionId });
  return versionId;
}

function lineItems(state: ArmyEstimate) {
  return state.items.filter((item) => item.item_type === "line");
}

/** §5.4 at the workbook coefficients: PU = « Prix Unitaire » on every priced line, statuses at 0 €. */
async function expectImportedLot(browser: Browser, army: ArmyState, versionId: string, lot: Lot, label: string) {
  const state = await readEstimate(browser, versionId);
  const workbook = await readLot(lot);
  const lines = lineItems(state);
  const priced = lines.filter((line) => field(line, "pricing_status") === "priced" && Number(line.quantity) > 0 && Number(line.pu_ht_cents) > 0);
  const statuses: Record<string, number> = {};
  for (const line of lines) {
    const status = String(field(line, "pricing_status"));
    if (status !== "priced") statuses[status] = (statuses[status] ?? 0) + 1;
  }
  const observed = {
    engine: state.version.calc_engine_version,
    coefficients: [num(field(state.version, "sale_coefficient_fo")), num(field(state.version, "sale_coefficient_mo"))],
    priced: priced.length,
    pricesEqualControl: JSON.stringify(priced.map((line) => Number(line.pu_ht_cents)).sort((a, b) => a - b)) === JSON.stringify(workbook.controls),
    statuses,
    statusLinesAtZero: lines.filter((line) => field(line, "pricing_status") !== "priced").every((line) => Number(line.line_total_ht_cents) === 0),
    priceAsUnit: lines.filter((line) => /^\d+(?:[.,]\d+)?$/.test(String(field(line, "unit_code") ?? line.description ?? ""))).length,
    hoursPerUnitRead: lines.filter((line) => num(field(line, "h_mo_per_unit")) !== null).length > 0,
    totalHtCents: state.version.total_ht_cents,
  };
  await recordEvidence(army, `io-${label}-imported`, { versionId, workbookPriced: workbook.controls.length, workbookStatuses: workbook.statuses, observed });
  expect(observed).toEqual({
    engine: 3, coefficients: [1.3, 1.3], priced: lot.priced, pricesEqualControl: true, statuses: lot.statuses,
    statusLinesAtZero: true, priceAsUnit: 0, hoursPerUnitRead: true, totalHtCents: lot.sumAtWorkbookCoefficientsCents,
  });
}

/** §5.4 at the offer coefficients, then at 1 / 1 (the cost): Σ HT and the realized sale coefficient. */
async function expectOfferAndCost(browser: Browser, army: ArmyState, versionId: string, lot: Lot, label: string) {
  const offer = await saveSettings(browser, army, versionId, `${label}-offer`, { sale_coefficient_fo: 1.3, sale_coefficient_mo: 1.2 });
  const cost = await saveSettings(browser, army, versionId, `${label}-cost`, { sale_coefficient_fo: 1, sale_coefficient_mo: 1 });
  const realized = (Number(offer.version.total_ht_cents) / Number(cost.version.total_ht_cents)).toFixed(6);
  expect([offer.version.total_ht_cents, cost.version.total_ht_cents, realized])
    .toEqual([lot.sumAtOfferCoefficientsCents, lot.costCents, lot.realizedSaleCoefficient]);
}

armyTest("IO01 the hydraulic OPTIMA lot imports into a v3 at its workbook prices (785/785), then IO02 at 1,30 / 1,20 and at cost", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "hydraulique");
    try {
      const versionId = await importWorkbook(ui, army, projectId, LOTS.HYDRAULIQUE);
      await expectImportedLot(browser, army, versionId, LOTS.HYDRAULIQUE, "hydraulique");
      await expectOfferAndCost(browser, army, versionId, LOTS.HYDRAULIQUE, "hydraulique");
    } finally {
      await closePolicy(owner, army, "hydraulique");
    }
  });

armyTest("IO03 the plumbing OPTIMA lot imports into a v3 at its workbook prices (656/656), then at 1,30 / 1,20", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "plomberie");
    try {
      const versionId = await importWorkbook(ui, army, projectId, LOTS.PLOMBERIE);
      await expectImportedLot(browser, army, versionId, LOTS.PLOMBERIE, "plomberie");
      await expectOfferAndCost(browser, army, versionId, LOTS.PLOMBERIE, "plomberie");
    } finally {
      await closePolicy(owner, army, "plomberie");
    }
  });

/** A blank v3 draft under the policy (1,30 / 1,20) with one section. */
async function blankV3(ui: Ui, army: ArmyState, projectId: string, label: string) {
  const { browser } = ui;
  const created = await createVersion(browser, { project_id: projectId,
    version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ${label} v3`, expected_calc_engine_version: 3 } });
  expect([created.status, created.body.ok, created.body.data.version.calc_engine_version]).toEqual([201, true, 3]);
  const versionId = created.body.data.version.id;
  ownEstimate(army, { projectId, versionId });
  await retakeLease(browser, versionId);
  const empty = await readEstimate(browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: `${label} lot` }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  return versionId;
}

armyTest("IO04 pasting the OPTIMA header and line O1 into a v3 shows h/u 1,991 and the control, and prices 166,63 € at 1,30 / 1,20", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "collage");
    try {
      const versionId = await blankV3(ui, army, projectId, "collage");
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      const title = `${army.runPrefix} O1`;
      const tsv = [
        ["N°", "Désignation", "Uté", "Qté", "Prix Unitaire", "Prix Total", "PR Fourniture unitaire", "PR Total fourniture",
          "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total", "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire"].join("\t"),
        ["1", title, "ml", "20", "174,59", "3 491,80", "54,66", "1 093,20", "1,991", "1,991", "39,82", "1,3", "1,3", "0", "40"].join("\t"),
      ].join("\n");
      await browser.evaluate((text) => {
        const target = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
        if (!(target instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
        const transfer = new DataTransfer();
        transfer.setData("text/plain", text);
        target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
        return true;
      }, tsv);
      const dialog = screen.getByRole("dialog", "Aperçu du collage", { exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText("h/u 1,991", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Prix Unitaire 174,59 : contrôle", { exact: true })).toBeVisible();
      await screen.getByTestId("paste-preview-dialog-confirm-button").click();
      await expect.poll(async () => lineItems(await readEstimate(browser, versionId)).some((line) => line.title === title), { timeout: 30_000 }).toBe(true);
      const line = lineItems(await readEstimate(browser, versionId)).find((entry) => entry.title === title)!;
      const observed = { unitCode: field(line, "unit_code"), hoursPerUnit: num(field(line, "h_mo_per_unit")), hMo: num(line.h_mo), pu: line.pu_ht_cents };
      await recordEvidence(army, "io-paste", { versionId, observed });
      expect(observed).toEqual({ unitCode: "ml", hoursPerUnit: 1.991, hMo: 39.82, pu: 16663 });
    } finally {
      await closePolicy(owner, army, "collage");
    }
  });

armyTest("IO05 a library assembly enters a v3 per unit: its MO doubles from Q = 10 to Q = 20", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, roleId } = await prepareV3Owner(ui, army, "ouvrage");
    try {
      const versionId = await blankV3(ui, army, projectId, "ouvrage");
      const assembly = await apiRequest<Envelope<{ assembly: { id: string } }>>(browser, "POST", "/api/estimates/assemblies", {
        name: `${army.runPrefix} ouvrage tube`, unit: "ml",
        items: [{ title: `${army.runPrefix} pose tube`, unit: "ml", default_quantity: 10, h_mo: 5, position: 1, cost_type: "labor",
          labor_role_id: roleId, k_mo: 1 }],
      });
      expect([assembly.status, assembly.body.ok]).toEqual([201, true]);
      await retakeLease(browser, versionId);
      const inserted = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/assemblies/${assembly.body.data.assembly.id}/insert`,
        { version_id: versionId }, await leaseSession(browser, versionId));
      await recordEvidence(army, "io-assembly-insert", { versionId, status: inserted.status, body: inserted.body });
      expect([inserted.status, inserted.body.ok]).toEqual([200, true]);
      const atTen = lineItems(await readEstimate(browser, versionId)).find((line) => line.title === `${army.runPrefix} pose tube`)!;
      const before = await readEstimate(browser, versionId);
      const update = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${versionId}/batch`,
        { operation_key: randomUUID(), operations: [{ op: "update", id: atTen.id, data: { quantity: 20 } }] },
        { "if-match": before.version.updated_at });
      expect([update.status, update.body.ok]).toEqual([200, true]);
      const atTwenty = lineItems(await readEstimate(browser, versionId)).find((line) => line.id === atTen.id)!;
      const observed = {
        ten: [num(atTen.quantity), field(atTen, "unit_code"), num(field(atTen, "h_mo_per_unit")), num(atTen.h_mo)],
        twenty: [num(atTwenty.quantity), num(atTwenty.h_mo)],
        moDoubled: Number(atTwenty.line_total_ht_cents) === 2 * Number(atTen.line_total_ht_cents),
      };
      await recordEvidence(army, "io-assembly-quantities", { versionId, observed });
      expect(observed).toEqual({ ten: [10, "ml", 0.5, 5], twenty: [20, 10], moDoubled: true });
    } finally {
      await closePolicy(owner, army, "ouvrage");
    }
  });

armyTest("IO06 a v2 template enters a v3 with the same MO and lists its converted lines", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId, roleId } = await prepareV3Owner(ui, army, "modele");
    try {
      // The template comes from the v2 anchor of the affaire: 3 000 u × 1 h gives 0,0003 h/u (0,900 h, listed).
      await retakeLease(browser, anchorId);
      const anchor = await readEstimate(browser, anchorId);
      const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
        { item_type: "section", position: 1, title: "Modèle lot" }, { "if-match": anchor.version.updated_at });
      expect([section.status, section.body.ok]).toEqual([201, true]);
      for (const [index, line] of [
        { title: `${army.runPrefix} tube`, description: "ml", quantity: 10, h_mo: 5 },
        { title: `${army.runPrefix} collier`, description: "u", quantity: 3000, h_mo: 1 },
      ].entries()) {
        const current = await readEstimate(browser, anchorId);
        const created = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
          { item_type: "line", parent_id: section.body.data.item.id, position: index + 1, unit_price_ht_cents: 1000, labor_role_id: roleId, ...line },
          { "if-match": current.version.updated_at });
        expect([created.status, created.body.ok]).toEqual([201, true]);
      }
      const template = await apiRequest<Envelope<{ template: { id: string } }>>(browser, "POST", "/api/estimates/templates",
        { source_version_id: anchorId, name: `${army.runPrefix} modèle v2` });
      expect([template.status, template.body.ok]).toEqual([201, true]);
      const versionId = await blankV3(ui, army, projectId, "modele");
      await retakeLease(browser, versionId);
      const inserted = await apiRequest<Envelope<{ converted_lines?: Array<{ title: string; template_hours: number; converted_hours: number }> }>>(
        browser, "POST", `/api/estimates/templates/${template.body.data.template.id}/insert`, { version_id: versionId },
        await leaseSession(browser, versionId));
      await recordEvidence(army, "io-template-insert", { versionId, status: inserted.status, body: inserted.body });
      expect([inserted.status, inserted.body.ok]).toEqual([200, true]);
      const lines = lineItems(await readEstimate(browser, versionId));
      const observed = {
        perUnit: lines.map((line) => [line.title, num(field(line, "h_mo_per_unit")), num(line.h_mo)]),
        converted: inserted.body.data.converted_lines?.map((line) => [line.title, line.template_hours, line.converted_hours]) ?? null,
      };
      expect(observed).toEqual({
        perUnit: [[`${army.runPrefix} tube`, 0.5, 5], [`${army.runPrefix} collier`, 0.0003, 0.9]],
        converted: [[`${army.runPrefix} collier`, 1, 0.9]],
      });
    } finally {
      await closePolicy(owner, army, "modele");
    }
  });

// E10 (règle 6) : une section importée d'une autre version reçoit un refus nommé dans une v3, sans écriture ;
// la conversion des heures (mêmes règles que les modèles) est une suite du 2.8.
armyTest("IO07 a section imported from another version into a v3 is refused by name, nothing written", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId } = await prepareV3Owner(ui, army, "section");
    try {
      await retakeLease(browser, anchorId);
      const anchor = await readEstimate(browser, anchorId);
      const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
        { item_type: "section", position: 1, title: `${army.runPrefix} lot à importer` }, { "if-match": anchor.version.updated_at });
      expect([section.status, section.body.ok]).toEqual([201, true]);
      const current = await readEstimate(browser, anchorId);
      const line = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
        { item_type: "line", parent_id: section.body.data.item.id, position: 1, title: `${army.runPrefix} tube`,
          description: "ml", quantity: 10, unit_price_ht_cents: 1000, h_mo: 5 }, { "if-match": current.version.updated_at });
      expect([line.status, line.body.ok]).toEqual([201, true]);
      const versionId = await blankV3(ui, army, projectId, "section");
      const before = await readEstimate(browser, versionId);
      const imported = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [section.body.data.item.id] });
      const after = await readEstimate(browser, versionId);
      const observed = {
        response: [imported.status, imported.body.ok, imported.body.error?.code ?? null],
        unchanged: after.items.length === before.items.length && after.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-section-import", { versionId, observed });
      expect(observed).toEqual({ response: [409, false, "ESTIMATE_ENGINE_UNAVAILABLE"], unchanged: true });
    } finally {
      await closePolicy(owner, army, "section");
    }
  });

// Règle 8 (P-14) : structure IA et version zéro sont refusées dans une v3 avec le message nommé, avant toute
// lecture de brouillon ou appel d'IA ; rien n'est écrit. La mise à jour groupée directe l'est déjà (2.5).
armyTest("IO08 AI structure and version zero are refused by name in a v3, nothing written", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "p14");
    try {
      const versionId = await blankV3(ui, army, projectId, "p14");
      const before = await readEstimate(browser, versionId);
      const draftId = randomUUID();
      const nodeId = randomUUID();
      const probes = {
        structureGenerate: await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/structure-drafts`, {}),
        structureApply: await apiRequest<Envelope<unknown>>(browser, "POST",
          `/api/estimates/${versionId}/structure-drafts/${draftId}/apply`, { mode: "merge_existing", selected_root_node_ids: [nodeId] }),
        versionZeroGenerate: await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/version-zero-drafts`, {}),
        versionZeroMaterialize: await apiRequest<Envelope<unknown>>(browser, "POST",
          `/api/estimates/${versionId}/version-zero-drafts/${draftId}/materialize`, {}),
      };
      const after = await readEstimate(browser, versionId);
      const observed = {
        responses: Object.fromEntries(Object.entries(probes).map(([name, response]) =>
          [name, [response.status, response.body.ok, response.body.error?.code ?? null]])),
        unchanged: after.items.length === before.items.length && after.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-p14", { versionId, observed });
      const refused = [409, false, "ESTIMATE_ENGINE_UNAVAILABLE"];
      expect(observed).toEqual({
        responses: { structureGenerate: refused, structureApply: refused, versionZeroGenerate: refused, versionZeroMaterialize: refused },
        unchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "p14");
    }
  });
