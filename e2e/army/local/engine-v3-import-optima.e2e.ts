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
import { ownedEstimateContext, querySql } from "./calculation-gate-support";
import { switchToExpertMode, waitForDraftLease } from "./engine-v3-editor-support";
// Aliased: not a React hook, despite its name.
import { insertCompletedTakeoffJob, setTenantCalcPolicy, useDedicatedV3Owner as signUpDedicatedV3Owner, type V3Owner } from "./engine-v3-persistence-support";

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
//  E10 La lecture d'un lot complet bloque ~60 s une fois sur trois : les enrichissements de provenance filtrent
//      `.in()` sur tous les éléments, URL au-delà de la limite d'en-têtes de la passerelle (431).
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Import provenance of an XLSX line, as dpgf-import asserts it (no PDF page provenance). */
function hasImportProvenance(line: ArmyItem) {
  const meta = (field(line, "source_metadata") ?? {}) as Record<string, unknown>;
  const structure = (meta._timax_structure ?? {}) as Record<string, unknown>;
  return field(line, "source_provider") === "dpgf" && UUID.test(String(meta.import_id)) && UUID.test(String(meta.mapping_id)) &&
    UUID.test(String(meta.mapped_row_id)) && typeof structure.source_row_number === "number" && !("_timax_provenance" in meta);
}
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

/** E10: well above a normal read of a full lot (~0,2 to 1,2 s locally), well below the ~60 s stall. */
const READ_BUDGET_MS = 10_000;

/**
 * GET /api/estimates/{id} started in the page and awaited by polling, so that a stalled read is measured
 * instead of failing on one browser.evaluate budget. A failed fetch is reported, not left to the poll timeout.
 * Callers record the duration, then bound it with expectReadsWithinBudget (E10).
 */
async function readEstimatePatiently(browser: Browser, versionId: string) {
  type Pending = { started: number; done: { status: number; ms: number; text: string } | null };
  await browser.evaluate((path) => {
    const scope = globalThis as typeof globalThis & { __ioRead?: Pending };
    const pending: Pending = { started: performance.now(), done: null };
    scope.__ioRead = pending;
    void fetch(path, { credentials: "same-origin" }).then(async (response) => {
      pending.done = { status: response.status, ms: Math.round(performance.now() - pending.started), text: await response.text() };
    }).catch((error: unknown) => {
      pending.done = { status: -1, ms: Math.round(performance.now() - pending.started), text: String(error) };
    });
    return 1;
  }, `/api/estimates/${versionId}`);
  await expect.poll(() => browser.evaluate(() =>
    (globalThis as typeof globalThis & { __ioRead?: Pending }).__ioRead?.done !== null), { timeout: 180_000 }).toBe(true);
  const done = await browser.evaluate(() => (globalThis as typeof globalThis & { __ioRead?: Pending }).__ioRead!.done!);
  expect({ status: done.status, error: done.status === 200 ? null : done.text.slice(0, 300) }).toEqual({ status: 200, error: null });
  const body = JSON.parse(done.text) as Envelope<{ version: ArmyEstimate["version"]; items: ArmyItem[] }>;
  return { state: { project: body.data.version.estimate_projects, version: body.data.version, items: body.data.items } as ArmyEstimate,
    ms: done.ms };
}

/** E10, after the durations are recorded: a failing run keeps every measured read. */
function expectReadsWithinBudget(...ms: number[]) {
  expect(ms.filter((value) => value >= READ_BUDGET_MS)).toEqual([]);
}

async function saveSettings(browser: Browser, army: ArmyState, versionId: string, label: string, patch: Record<string, unknown>) {
  const started = Date.now();
  const mark = (step: string) => recordEvidence(army, `io-settings-${label}-progress`, { step, elapsedMs: Date.now() - started });
  await mark("lease");
  await retakeLease(browser, versionId);
  await mark("read");
  const { state: before, ms: beforeMs } = await readEstimatePatiently(browser, versionId);
  await mark("save");
  const sent = Date.now();
  const response = await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}`,
    { ...patch, expected_content_revision: before.version.content_revision }, { "if-match": before.version.updated_at });
  await recordEvidence(army, `io-settings-${label}`, { versionId, patch, status: response.status, ok: response.body.ok,
    elapsedMs: { leaseAndRead: sent - started, read: beforeMs, save: Date.now() - sent } });
  expectReadsWithinBudget(beforeMs);
  expect([response.status, response.body.ok]).toEqual([200, true]);
  const reread = await readEstimatePatiently(browser, versionId);
  await recordEvidence(army, `io-settings-${label}-reread`, { versionId, rereadMs: reread.ms });
  expectReadsWithinBudget(reread.ms);
  return reread.state;
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
  const { state, ms: readMs } = await readEstimatePatiently(browser, versionId);
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
    provenanceOnEveryLine: lines.every(hasImportProvenance),
    totalHtCents: state.version.total_ht_cents,
  };
  await recordEvidence(army, `io-${label}-imported`, { versionId, readMs, workbookPriced: workbook.controls.length, workbookStatuses: workbook.statuses, observed });
  expectReadsWithinBudget(readMs);
  expect(observed).toEqual({
    engine: 3, coefficients: [1.3, 1.3], priced: lot.priced, pricesEqualControl: true, statuses: lot.statuses,
    statusLinesAtZero: true, priceAsUnit: 0, hoursPerUnitRead: true, provenanceOnEveryLine: true,
    totalHtCents: lot.sumAtWorkbookCoefficientsCents,
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

/** E10: consecutive reads of the same lot stay within budget and return the same items and totals. */
async function expectConsecutiveReads(browser: Browser, army: ArmyState, versionId: string, label: string) {
  const reads: Array<{ ms: number; items: number; totalHtCents: unknown }> = [];
  for (let index = 0; index < 6; index += 1) {
    const { state, ms } = await readEstimatePatiently(browser, versionId);
    reads.push({ ms, items: state.items.length, totalHtCents: state.version.total_ht_cents });
  }
  await recordEvidence(army, `io-${label}-consecutive-reads`, { versionId, budgetMs: READ_BUDGET_MS, reads });
  expectReadsWithinBudget(...reads.map((read) => read.ms));
  expect(new Set(reads.map((read) => `${read.items}:${read.totalHtCents}`)).size).toBe(1);
}

armyTest("IO01 the hydraulic OPTIMA lot imports into a v3 at its workbook prices (785/785), then IO02 at 1,30 / 1,20 and at cost", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "hydraulique");
    try {
      const versionId = await importWorkbook(ui, army, projectId, LOTS.HYDRAULIQUE);
      await expectImportedLot(browser, army, versionId, LOTS.HYDRAULIQUE, "hydraulique");
      await expectOfferAndCost(browser, army, versionId, LOTS.HYDRAULIQUE, "hydraulique");
      await expectConsecutiveReads(browser, army, versionId, "hydraulique");
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
      await expectConsecutiveReads(browser, army, versionId, "plomberie");
    } finally {
      await closePolicy(owner, army, "plomberie");
    }
  });

// Lot 2, sous-lot 2.6b, revue (docs/testing/estimate-engine-v3-2.6b.md, G1) : les lignes de statut du lot hydraulique
// (HL, inc, NC, PM ; 46 sur 79 sans quantité dans le classeur) ne lèvent aucun drapeau de qualité, ni à la porte
// d'envoi ni au radar de risque du métré (alerte « prix atypique », la seule qu'il tire des drapeaux de qualité ;
// « preuve absente » ne dépend pas du statut). Les lignes chiffrées sans quantité du classeur restent hors de G1.
type GatingFlag = { key: string; severity: string; count?: number; item_ids: string[] };
type RiskAlert = { line_id: string | null; cause_code: string; reason_labels: string[] };
armyTest("V3E20 the status lines of the hydraulic OPTIMA lot imported into a v3 raise no quality flag in the send gating or the takeoff risk radar", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "v3e20");
    try {
      const versionId = await importWorkbook(ui, army, projectId, LOTS.HYDRAULIQUE);
      const { state } = await readEstimatePatiently(browser, versionId);
      const statusLines = lineItems(state).filter((line) => field(line, "pricing_status") !== "priced");
      const statusIds = new Set(statusLines.map((line) => line.id));
      const onStatusLines = (entries: Array<{ key: string; ids: Array<string | null> }>) => {
        const counts: Record<string, number> = {};
        for (const entry of entries) {
          const hits = entry.ids.filter((id) => id !== null && statusIds.has(id)).length;
          if (hits > 0) counts[entry.key] = (counts[entry.key] ?? 0) + hits;
        }
        return counts;
      };
      const gating = await apiRequest<Envelope<{ gating: { canSend: boolean; blockingFlags: GatingFlag[]; warningFlags: GatingFlag[] } }>>(
        browser, "GET", `/api/estimates/${versionId}/gating`);
      expect([gating.status, gating.body.ok]).toEqual([200, true]);
      const flags = [...gating.body.data.gating.blockingFlags, ...gating.body.data.gating.warningFlags];
      const takeoffJobId = await insertCompletedTakeoffJob(owner, versionId);
      const radar = await apiRequest<Envelope<{ items: RiskAlert[] }>>(browser, "GET",
        `/api/takeoff/jobs/${takeoffJobId}/risk-radar?version_id=${versionId}`);
      const radarItems = radar.body.data?.items ?? [];
      const observed = {
        statusLines: statusLines.length,
        statusLinesWithoutQuantity: statusLines.filter((line) => !(Number(line.quantity) > 0)).length,
        gatingOnStatusLines: onStatusLines(flags.map((flag) => ({ key: `${flag.severity}:${flag.key}`, ids: flag.item_ids }))),
        radar: [radar.status, radar.body.ok],
        radarPriceAlertsOnStatusLines: onStatusLines(radarItems.filter((alert) => alert.cause_code === "atypical_price")
          .map((alert) => ({ key: alert.cause_code, ids: [alert.line_id] }))),
      };
      await recordEvidence(army, "v3e20-status-lines", { versionId, takeoffJobId,
        pricedLinesWithoutQuantity: lineItems(state).filter((line) => !statusIds.has(line.id) && !(Number(line.quantity) > 0)).length,
        blocking: gating.body.data.gating.blockingFlags.map((flag) => [flag.key, flag.count ?? flag.item_ids.length]),
        warnings: gating.body.data.gating.warningFlags.map((flag) => [flag.key, flag.count ?? flag.item_ids.length]),
        radarAlerts: radarItems.filter((alert) => alert.line_id !== null && statusIds.has(alert.line_id) && alert.cause_code === "atypical_price").slice(0, 20),
        radarError: radar.body.error ?? null, observed });
      expect(observed, "status lines of an imported v3 raise no quality flag in the send gating or the risk radar").toEqual({
        statusLines: 79, statusLinesWithoutQuantity: 46, gatingOnStatusLines: {}, radar: [200, true], radarPriceAlertsOnStatusLines: {},
      });
    } finally {
      await closePolicy(owner, army, "v3e20");
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
    const { owner, projectId, roleId } = await prepareV3Owner(ui, army, "collage");
    try {
      const versionId = await blankV3(ui, army, projectId, "collage");
      const sectionId = (await readEstimate(browser, versionId)).items.find((item) => item.item_type === "section")!.id;
      // The lease taken by the API (blankV3) is handed back, so that the editor page takes it and becomes editable.
      const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
      expect(released.status).toBe(200);
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      // The pasted lines go into the selected section: a v3 line belongs to a section.
      const sectionTitle = browser.locator(`[data-estimate-item-id="${sectionId}"] [data-testid="estimate-section-title-input"]`);
      await expect(sectionTitle).toBeEnabled({ timeout: 150_000 });
      await sectionTitle.click();
      await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
      const title = `${army.runPrefix} O1`;
      const tsv = [
        // The workbook header as Excel copies it: « Prix⏎Unitaire » and « Prix⏎Total » hold a line break, quoted.
        ["N°", "Désignation", "Uté", "Qté", "\"Prix\r\nUnitaire\"", "\"Prix\r\nTotal\"", "PR Fourniture unitaire", "PR Total fourniture",
          "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total", "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire"].join("\t"),
        // The workbook layout: the parameters on row 2 only (L2:O2, « Taux horaire » 40), none on line O1.
        ["", "", "", "0", "", "", "", "", "", "", "", "1,3", "1,3", "0", "40"].join("\t"),
        ["1", title, "ml", "20", "174,59", "3 491,80", "54,66", "1 093,20", "1,991", "1,991", "39,82", "", "", "", ""].join("\t"),
      ].join("\r\n");
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
      await expect(dialog.getByText("Paramètres du classeur : taux horaire 40,00 €/h, non collés", { exact: true })).toBeVisible();
      // The labour role follows the import rule: the single active role at the sheet's « Taux horaire » (40 €/h),
      // read on its parameter row.
      await expect(screen.getByLabel("Rôle MO des lignes collées", { exact: true })).toHaveValue(roleId);
      await screen.getByTestId("paste-preview-dialog-confirm-button").click();
      await expect.poll(async () => lineItems(await readEstimate(browser, versionId)).some((line) => line.title === title), { timeout: 30_000 }).toBe(true);
      const line = lineItems(await readEstimate(browser, versionId)).find((entry) => entry.title === title)!;
      const observed = { unitCode: field(line, "unit_code"), hoursPerUnit: num(field(line, "h_mo_per_unit")), hMo: num(line.h_mo),
        roleId: field(line, "labor_role_id"), pu: line.pu_ht_cents, parentId: field(line, "parent_id") };
      await recordEvidence(army, "io-paste", { versionId, observed });
      // 54,66 € × FO 1,30 + 1,991 h/u × 40 €/h × MO 1,20 = 166,63 € per unit.
      expect(observed).toEqual({ unitCode: "ml", hoursPerUnit: 1.991, hMo: 39.82, roleId, pu: 16663, parentId: sectionId });
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
        // 0,5 h/u × 40 €/h × MO 1,20 = 24,00 € per unit, at Q = 10 then 20.
        amounts: [num(atTen.pu_ht_cents), num(atTen.line_total_ht_cents), num(atTwenty.line_total_ht_cents)],
      };
      await recordEvidence(army, "io-assembly-quantities", { versionId, observed });
      expect(observed).toEqual({ ten: [10, "ml", 0.5, 5], twenty: [20, 10], amounts: [2400, 24000, 48000] });
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
        // Tube: 10,00 € × FO 1,30 + 0,5 h/u × 40 €/h × MO 1,20 = 37,00 € per unit, the template's 5 h kept.
        tube: lines.filter((line) => line.title === `${army.runPrefix} tube`)
          .map((line) => [num(line.pu_ht_cents), num(line.line_total_ht_cents)])[0] ?? null,
      };
      expect(observed).toEqual({
        perUnit: [[`${army.runPrefix} tube`, 0.5, 5], [`${army.runPrefix} collier`, 0.0003, 0.9]],
        converted: [[`${army.runPrefix} collier`, 1, 0.9]],
        tube: [3700, 37000],
      });
    } finally {
      await closePolicy(owner, army, "modele");
    }
  });

/** v3 inputs and stored amounts of a line, compared between a source and its copy (2.8b). */
function v3LineInputs(line: ArmyItem) {
  return [line.title, field(line, "unit_code"), field(line, "pricing_status"), num(field(line, "h_mo_per_unit")), num(line.quantity),
    num(line.unit_price_ht_cents), field(line, "labor_role_id"), num(field(line, "pu_ht_cents")), num(line.line_total_ht_cents)];
}

/** A v2 section of the anchor with the IO06 lines (tube 10 ml × 5 h, collier 3 000 u × 1 h, Tuyauteur). */
async function anchorV2Section(browser: Browser, army: ArmyState, anchorId: string, roleId: string, title: string) {
  await retakeLease(browser, anchorId);
  const anchor = await readEstimate(browser, anchorId);
  const position = anchor.items.filter((item) => item.parent_id === null).length + 1;
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
    { item_type: "section", position, title }, { "if-match": anchor.version.updated_at });
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
  return section.body.data.item.id;
}

function subtreeLines(state: ArmyEstimate, sectionId: string) {
  return lineItems(state).filter((line) => line.parent_id === sectionId).sort((a, b) => a.position - b.position);
}

type CopyReport = { title: string; template_hours: number; converted_hours: number };

// Sous-lot 2.8b (A7, P-12, D-e ; docs/testing/estimate-engine-v3-2.8b.md) : IO07 vérifiait le refus du 2.8.
// Une section v2 importée dans une v3 est convertie comme un modèle (mêmes valeurs qu'IO06) avec son rapport ;
// v3 → v3 copie les saisies v3 ; v3 → v2 est refusé par son nom, rien n'est écrit.
armyTest("IO07 sections enter a v3 from a v2 (converted, listed) and from a v3 (copied); a v3 section into a v2 is refused by name", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId, roleId } = await prepareV3Owner(ui, army, "section");
    try {
      const v2SectionId = await anchorV2Section(browser, army, anchorId, roleId, `${army.runPrefix} lot à importer`);
      const versionId = await blankV3(ui, army, projectId, "section");
      await retakeLease(browser, versionId);
      type Imported = { created_section_ids: string[]; converted_lines?: CopyReport[] };
      const fromV2 = await apiRequest<Envelope<Imported>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [v2SectionId] });
      await recordEvidence(army, "io-section-import-v2", { versionId, status: fromV2.status, body: fromV2.body });
      expect([fromV2.status, fromV2.body.ok, fromV2.body.error?.code ?? null]).toEqual([201, true, null]);
      const imported = await readEstimate(browser, versionId);
      const importedSectionId = fromV2.body.data.created_section_ids[0]!;
      const importedLines = subtreeLines(imported, importedSectionId);
      const observedV2 = {
        engine: imported.version.calc_engine_version,
        perUnit: importedLines.map((line) => [line.title, field(line, "unit_code"), num(field(line, "h_mo_per_unit")), num(line.h_mo)]),
        converted: fromV2.body.data.converted_lines?.map((line) => [line.title, line.template_hours, line.converted_hours]) ?? null,
        tube: importedLines.filter((line) => line.title === `${army.runPrefix} tube`)
          .map((line) => [num(line.pu_ht_cents), num(line.line_total_ht_cents)])[0] ?? null,
        footer: num(imported.version.total_ht_cents) === lineItems(imported).reduce((sum, line) => sum + Number(line.line_total_ht_cents), 0),
      };
      await recordEvidence(army, "io-section-import-v2-observed", { versionId, observedV2 });
      expect(observedV2).toEqual({
        engine: 3,
        perUnit: [[`${army.runPrefix} tube`, "ml", 0.5, 5], [`${army.runPrefix} collier`, "u", 0.0003, 0.9]],
        converted: [[`${army.runPrefix} collier`, 1, 0.9]],
        tube: [3700, 37000],
        footer: true,
      });

      // Revue 2.8b (F3) : la même section par « Importer depuis un autre devis » de l'éditeur ; le résumé liste la ligne
      // dont les heures changent, comme l'insertion d'un modèle.
      const uiTargetId = await blankV3(ui, army, projectId, "section-ui");
      const releasedUi = await apiRequest(browser, "DELETE", `/api/estimates/${uiTargetId}/lock`);
      expect(releasedUi.status).toBe(200);
      await app.open(`/dashboard/estimates/${uiTargetId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      await switchToExpertMode(ui);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      await waitForDraftLease(ui);
      await screen.getByRole("tab", /^Insérer(?: \d+)?$/).tap();
      await screen.getByTestId("estimate-editor-insert-button").tap();
      await screen.getByTestId("estimate-editor-import-from-estimate-button").tap();
      const importDialog = screen.getByRole("dialog", "Importer depuis un autre devis", { exact: true });
      const sourceSelect = importDialog.getByLabel("Devis source", { exact: true });
      await expect(sourceSelect).toBeVisible({ timeout: 30_000 });
      await sourceSelect.selectOption({ value: anchorId });
      await importDialog.getByRole("button", "Continuer", { exact: true }).tap();
      const sectionTitle = `${army.runPrefix} lot à importer`;
      await importDialog.getByRole("checkbox", new RegExp(`^${sectionTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)).check();
      await importDialog.getByRole("button", "Continuer", { exact: true }).tap();
      await importDialog.getByRole("button", "Importer", { exact: true }).tap();
      const importSummary = screen.getByTestId("estimate-editor-alert-import-summary");
      await expect(importSummary).toBeVisible({ timeout: 60_000 });
      const summaryText = (await importSummary.textContent())?.replace(/\s+/g, " ").trim() ?? null;
      await recordEvidence(army, "io-section-import-v2-ui", { uiTargetId, summaryText });
      expect(summaryText).toBe(`1 section(s) et 2 ligne(s) importées. Heures converties au moteur de calcul 3 (h / Q au demi ` +
        `supérieur) : ${army.runPrefix} collier : 1 h → 0,9 h.`);

      // v3 → v3: the inputs are copied as they are, the amounts recomputed by the writer (same coefficients).
      const otherId = await blankV3(ui, army, projectId, "section-b");
      await retakeLease(browser, otherId);
      const fromV3 = await apiRequest<Envelope<Imported>>(browser, "POST", `/api/estimates/${otherId}/import-sections`,
        { source_version_id: versionId, section_ids: [importedSectionId] });
      await recordEvidence(army, "io-section-import-v3", { otherId, status: fromV3.status, body: fromV3.body });
      expect([fromV3.status, fromV3.body.ok, fromV3.body.error?.code ?? null]).toEqual([201, true, null]);
      const copied = await readEstimate(browser, otherId);
      expect({
        lines: subtreeLines(copied, fromV3.body.data.created_section_ids[0]!).map(v3LineInputs),
        converted: fromV3.body.data.converted_lines ?? [],
      }).toEqual({ lines: importedLines.map(v3LineInputs), converted: [] });

      // v3 → v2 (D-e): refused by name before any write, by import and by duplication.
      await retakeLease(browser, anchorId);
      const anchorBefore = await readEstimate(browser, anchorId);
      const v3Before = await readEstimate(browser, versionId);
      const refusals = {
        importFrom: await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${anchorId}/import-sections`,
          { source_version_id: versionId, section_ids: [importedSectionId] }),
        duplicateTo: await apiRequest<Envelope<unknown>>(browser, "POST",
          `/api/estimates/${versionId}/sections/${importedSectionId}/duplicate`, { target_version_id: anchorId },
          await leaseSession(browser, anchorId)),
      };
      const anchorAfter = await readEstimate(browser, anchorId);
      const v3After = await readEstimate(browser, versionId);
      const observed = {
        responses: Object.fromEntries(Object.entries(refusals).map(([name, response]) =>
          [name, [response.status, response.body.ok, response.body.error?.code ?? null]])),
        unchanged: anchorAfter.items.length === anchorBefore.items.length && anchorAfter.version.updated_at === anchorBefore.version.updated_at &&
          v3After.items.length === v3Before.items.length && v3After.version.updated_at === v3Before.version.updated_at,
      };
      await recordEvidence(army, "io-section-import-refused", { versionId, anchorId, observed });
      const refused = [409, false, "ESTIMATE_V3_SECTION_COPY_TO_HISTORICAL"];
      expect(observed).toEqual({ responses: { importFrom: refused, duplicateTo: refused }, unchanged: true });
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

// Règles 3 et 5 (P-12) : les refus SQL de M6 atteignent l'utilisateur par leur nom, avec la ligne nommée.
armyTest("IO09 a v3 refuses by name an inexact assembly and a template line with hours but no quantity, nothing written", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId, roleId } = await prepareV3Owner(ui, army, "refus");
    try {
      const robinet = `${army.runPrefix} robinet`;
      const assembly = await apiRequest<Envelope<{ assembly: { id: string } }>>(browser, "POST", "/api/estimates/assemblies", {
        name: `${army.runPrefix} ouvrage inexact`, unit: "u",
        items: [{ title: robinet, unit: "u", default_quantity: 3, h_mo: 1, position: 1, cost_type: "labor", labor_role_id: roleId, k_mo: 1 }],
      });
      expect([assembly.status, assembly.body.ok]).toEqual([201, true]);
      const sansQuantite = `${army.runPrefix} sans quantité`;
      await retakeLease(browser, anchorId);
      const anchor = await readEstimate(browser, anchorId);
      const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
        { item_type: "section", position: 1, title: "Modèle refus" }, { "if-match": anchor.version.updated_at });
      expect([section.status, section.body.ok]).toEqual([201, true]);
      const current = await readEstimate(browser, anchorId);
      const line = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchorId}/items`,
        { item_type: "line", parent_id: section.body.data.item.id, position: 1, title: sansQuantite, description: "u",
          quantity: 0, unit_price_ht_cents: 1000, h_mo: 2, labor_role_id: roleId }, { "if-match": current.version.updated_at });
      expect([line.status, line.body.ok]).toEqual([201, true]);
      const template = await apiRequest<Envelope<{ template: { id: string } }>>(browser, "POST", "/api/estimates/templates",
        { source_version_id: anchorId, name: `${army.runPrefix} modèle sans quantité` });
      expect([template.status, template.body.ok]).toEqual([201, true]);
      const versionId = await blankV3(ui, army, projectId, "refus");
      await retakeLease(browser, versionId);
      const before = await readEstimate(browser, versionId);
      const insertedAssembly = await apiRequest<Envelope<unknown>>(browser, "POST",
        `/api/estimates/assemblies/${assembly.body.data.assembly.id}/insert`, { version_id: versionId }, await leaseSession(browser, versionId));
      const insertedTemplate = await apiRequest<Envelope<unknown>>(browser, "POST",
        `/api/estimates/templates/${template.body.data.template.id}/insert`, { version_id: versionId }, await leaseSession(browser, versionId));
      const after = await readEstimate(browser, versionId);
      const named = (response: typeof insertedAssembly, title: string) =>
        [response.status, response.body.ok, response.body.error?.code ?? null, (response.body.error?.message ?? "").includes(title)];
      const observed = {
        assembly: named(insertedAssembly, robinet),
        template: named(insertedTemplate, sansQuantite),
        unchanged: after.items.length === before.items.length && after.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-named-refusals", { versionId, observed,
        bodies: { assembly: insertedAssembly.body, template: insertedTemplate.body } });
      expect(observed).toEqual({
        assembly: [400, false, "ESTIMATE_V3_ASSEMBLY_HOURS_PER_UNIT_INEXACT", true],
        template: [400, false, "ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY", true],
        unchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "refus");
    }
  });

// ---------------------------------------------------------------------------------------------------------------
// Sous-lot 2.8b (docs/testing/estimate-engine-v3-2.8b.md) : copies vers une v3. Défaillances observables, écrites
// avant le code :
//  C1  Le DPGF lié importé dans un brouillon v3 existant est refusé (insertion directe, 400 générique du garde SQL).
//  C2  Une fois ouvert, il serait normalisé en v2 (unité dans `description`, statut chiffré) ou aux coefficients de la
//      politique au lieu de ceux du brouillon ; provenance perdue.
//  C3  Dupliquer une section d'une v3 (sur place ou vers une autre v3) est refusé (409 moteur indisponible).
//  C4  Une copie perd `unit_code`, le statut ou les h/u, multiplie les heures par Q deux fois, ou écrit en plusieurs
//      lots (écriture partielle).
//  C5  Une section v2 entre dans une v3 sans conversion P-12 ni rapport ; une section v3 entre dans une v2 (D-e).
//  C6  La conversion ligne ↔ section reste proposée sur une v3, puis échoue par un message générique (D-b).
//  C7  Une copie v1/v2 → v1/v2 change de montants.

/** A linked DPGF of the owned affaire (A5): an import and its mapped rows, as the import mapping stores them. */
async function seedLinkedDpgf(owner: V3Owner, projectId: string, filename: string, rows: ReadonlyArray<Record<string, unknown>>) {
  if (!UUID.test(projectId) || !/^ARMY-[A-Za-z0-9 .-]{1,120}\.xlsx$/.test(filename)) throw new Error("Invalid linked DPGF fixture input.");
  const importId = randomUUID();
  const payloads = rows.map((row, index) => `'${JSON.stringify({ row_index: index + 1, ...row }).replaceAll("'", "''")}'::jsonb`);
  const output = await querySql(`BEGIN;
INSERT INTO public.dpgf_imports (id, tenant_id, user_id, filename, source_format, status, row_count, parse_mode, project_id)
SELECT '${importId}'::uuid, p.tenant_id, p.user_id, '${filename}', 'xlsx', 'completed', ${rows.length}, 'server', p.id
FROM public.estimate_projects p WHERE p.id = '${projectId}' AND p.tenant_id = '${owner.tenantId}' AND p.user_id = '${owner.userId}';
INSERT INTO public.dpgf_rows_mapped (tenant_id, import_id, payload, status, created_at)
SELECT '${owner.tenantId}'::uuid, '${importId}'::uuid, r.payload, 'mapped', now() + r.ord * interval '1 millisecond'
FROM unnest(ARRAY[${payloads.join(", ")}]) WITH ORDINALITY AS r(payload, ord)
WHERE EXISTS (SELECT 1 FROM public.dpgf_imports i WHERE i.id = '${importId}'::uuid);
COMMIT;
SELECT count(*) FROM public.dpgf_rows_mapped WHERE import_id = '${importId}';
`);
  if (output.at(-1) !== String(rows.length)) throw new Error("The linked DPGF fixture was not persisted.");
  return importId;
}

/** Revue 2.8b (F4) : la provenance stockée des enfants d'une section, par position (SQL : la lecture de l'API la résume). */
async function storedSourceMetadata(parentId: string) {
  if (!UUID.test(parentId)) throw new Error("Invalid section identity.");
  return querySql(`SELECT concat_ws('|', coalesce(source_metadata->>'import_id', '-'), coalesce(source_metadata->>'row_index', '-'),
  source_metadata ? 'mapped_row_id', coalesce(source_metadata->'_timax_provenance'->>'sourceDocumentId', '-'))
FROM public.estimate_items WHERE parent_id = '${parentId}'::uuid AND item_type = 'line' ORDER BY position;
`);
}

/**
 * Revue 2.8b (F4) : une provenance PDF (`_timax_provenance`, `sourceDocumentId`) posée en SQL sur une ligne v3, sous
 * le contrat d'écrivain de sa version (seule colonne changée, aucun montant), comme l'import de l'affaire l'écrit.
 */
async function seedV3LineProvenance(versionId: string, title: string, documentId: string) {
  if (!UUID.test(versionId) || !UUID.test(documentId) || !/^[A-Za-z0-9 .-]{1,160}$/.test(title)) throw new Error("Invalid provenance input.");
  const output = await querySql(`BEGIN;
SELECT set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
UPDATE public.estimate_items SET source_metadata = jsonb_build_object('import_id', '${documentId}',
  '_timax_provenance', jsonb_build_object('sourceDocumentId', '${documentId}', 'page', 3))
WHERE version_id = '${versionId}'::uuid AND title = '${title}' AND item_type = 'line';
COMMIT;
SELECT count(*) FROM public.estimate_items WHERE version_id = '${versionId}'::uuid AND source_metadata ? '_timax_provenance';
`);
  if (output.at(-1) !== "1") throw new Error("The v3 line provenance was not persisted.");
}

async function storedTotalHtCents(versionId: string) {
  if (!UUID.test(versionId)) throw new Error("Invalid version identity.");
  const [total] = await querySql(`SELECT total_ht_cents FROM public.estimate_versions WHERE id = '${versionId}';\n`);
  return Number(total);
}

armyTest("IO10 the linked DPGF imported into a v3 draft keeps units and statuses, prices at the draft coefficients, keeps provenance", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "dpgf-lie");
    try {
      const filename = `${army.runPrefix}-dpgf-lie.xlsx`;
      const versionId = await blankV3(ui, army, projectId, "dpgf-lie");
      // The draft's own coefficients (1,25 / 1,15), not the policy's (1,30 / 1,20), price the imported lines.
      await saveSettings(browser, army, versionId, "dpgf-lie", { sale_coefficient_fo: 1.25, sale_coefficient_mo: 1.15 });
      const before = await readEstimate(browser, versionId);
      const importId = await seedLinkedDpgf(owner, projectId, filename, [
        { designation: `${army.runPrefix} tube`, unit: "ml", quantity: "10", unit_price_ht: "12,00" },
        // Revue Codex de la PR #59 (G1) : une ligne issue d'un tableau PDF porte sa page dans `raw_row._timax_provenance`
        // (import tabulaire PDF) ; une ligne de classeur n'a pas de page.
        { designation: `${army.runPrefix} collier`, unit: "u", quantity: "3", unit_price_ht: "4,00",
          raw_row: { _timax_provenance: { source_page: 7, table_index: 0, source_file_name: null, source_document_id: null } } },
        { designation: `${army.runPrefix} provision`, unit: "PM", quantity: "1" },
        { designation: `${army.runPrefix} hors lot`, unit: "HL", quantity: "1" },
      ]);
      // The editor's own action (toolbar « Importer le DPGF source »), as a user reaches it on a v3 draft.
      const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
      expect(released.status).toBe(200);
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      const firstSectionId = before.items.find((item) => item.item_type === "section" && item.parent_id === null)!.id;
      await expect(browser.locator(`[data-estimate-item-id="${firstSectionId}"] [data-testid="estimate-section-title-input"]`))
        .toBeEnabled({ timeout: 150_000 });
      await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
      const importButton = screen.getByTestId("estimate-page-toolbar-import-dpgf-source-button");
      await expect(importButton).toBeEnabled({ timeout: 30_000 });
      await importButton.tap();
      const summary = screen.getByText("4 lignes importées depuis le DPGF source.", { exact: true }).first();
      await expect(summary).toBeVisible({ timeout: 60_000 });
      const after = await readEstimate(browser, versionId);
      const section = after.items.find((item) => item.item_type === "section" && field(item, "source_provider") === "dpgf");
      await recordEvidence(army, "io-linked-dpgf", { versionId, summary: await summary.textContent(), sectionId: section?.id ?? null });
      const lines = section ? subtreeLines(after, section.id) : [];
      const observed = {
        engine: after.version.calc_engine_version,
        coefficients: [num(field(after.version, "sale_coefficient_fo")), num(field(after.version, "sale_coefficient_mo"))],
        lines: lines.map((line) => [line.title, field(line, "unit_code"), field(line, "pricing_status"), num(field(line, "h_mo_per_unit")),
          num(line.line_total_ht_cents)]),
        pricedPu: lines.filter((line) => field(line, "pricing_status") === "priced").map((line) => num(field(line, "pu_ht_cents"))),
        provenance: lines.map((line) => [field(line, "source_provider"), field(line, "source_file_name"), field(line, "source_page")]),
        sectionProvenance: section ? [field(section, "source_provider"), field(section, "source_file_name")] : null,
        // Revue 2.8b (F4) : la provenance de la ligne mappée (import, ligne, `mapped_row_id`) suit la ligne.
        metadata: section ? await storedSourceMetadata(section.id) : null,
        previousItemsKept: before.items.every((item) => after.items.some((next) => next.id === item.id && next.title === item.title)),
        apiTotal: num(after.version.total_ht_cents),
        sqlTotal: await storedTotalHtCents(versionId),
      };
      await recordEvidence(army, "io-linked-dpgf-observed", { versionId, observed });
      // 12,00 € × FO 1,25 = 15,00 € × 10 ml ; 4,00 € × 1,25 = 5,00 € × 3 u ; PM and HL at 0 € : 165,00 € HT.
      expect(observed).toEqual({
        engine: 3,
        coefficients: [1.25, 1.15],
        lines: [
          [`${army.runPrefix} tube`, "ml", "priced", null, 15000],
          [`${army.runPrefix} collier`, "u", "priced", null, 1500],
          [`${army.runPrefix} provision`, null, "for_memory", null, 0],
          [`${army.runPrefix} hors lot`, null, "out_of_scope", null, 0],
        ],
        pricedPu: [1500, 500],
        // G1 : la page du document source (`line.sourcePage`, comme le sérialiseur commun), jamais le numéro de ligne.
        provenance: [null, 7, null, null].map((page) => ["dpgf", filename, page]),
        sectionProvenance: ["dpgf", filename],
        metadata: [1, 2, 3, 4].map((row) => `${importId}|${row}|t|-`),
        previousItemsKept: true,
        apiTotal: 16500,
        sqlTotal: 16500,
      });
    } finally {
      await closePolicy(owner, army, "dpgf-lie");
    }
  });

/** v3 lines written by the batch writer under the first section: tube, PM provision and a sub-section with a coude. */
async function seedV3Section(browser: Browser, army: ArmyState, versionId: string, roleId: string) {
  const state = await readEstimate(browser, versionId);
  const sectionId = state.items.find((item) => item.item_type === "section" && item.parent_id === null)!.id;
  const line = (title: string, parentId: string, position: number, input: Record<string, unknown>) => ({ op: "create", data: {
    item_type: "line", parent_id: parentId, position, title, tax_rate_bp: 2000, k_fo: 1, h_mo_majoration: 1, k_mo: 1, ...input } });
  const first = await apiRequest<Envelope<{ committed: boolean; results: Array<{ data: { item: ArmyItem } }> }>>(browser, "POST",
    `/api/estimates/${versionId}/batch`, { operation_key: randomUUID(), operations: [
      line(`${army.runPrefix} tube`, sectionId, 1,
        { quantity: 10, unit_price_ht_cents: 1000, unit_code: "ml", pricing_status: "priced", h_mo_per_unit: 0.5, labor_role_id: roleId }),
      line(`${army.runPrefix} provision`, sectionId, 2, { quantity: 1, unit_price_ht_cents: 0, unit_code: null, pricing_status: "for_memory" }),
      { op: "create", data: { item_type: "section", parent_id: sectionId, position: 3, title: `${army.runPrefix} sous-lot` } },
    ] }, { "if-match": state.version.updated_at });
  expect([first.status, first.body.ok, first.body.data?.committed]).toEqual([200, true, true]);
  const subSection = first.body.data.results[2]!.data.item.id;
  const current = await readEstimate(browser, versionId);
  const second = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${versionId}/batch`,
    { operation_key: randomUUID(), operations: [line(`${army.runPrefix} coude`, subSection, 1,
      { quantity: 4, unit_price_ht_cents: 250, unit_code: "u", pricing_status: "priced", h_mo_per_unit: 0.25, labor_role_id: roleId })] },
    { "if-match": current.version.updated_at });
  expect([second.status, second.body.ok, second.body.data?.committed]).toEqual([200, true, true]);
  return sectionId;
}

/** The subtree of a section in order: [depth, type, title or v3 inputs and amounts], titles of the root excepted. */
function subtreeShape(state: ArmyEstimate, rootId: string) {
  const rows: unknown[] = [];
  const visit = (parentId: string, depth: number) => {
    for (const item of state.items.filter((entry) => entry.parent_id === parentId).sort((a, b) => a.position - b.position)) {
      rows.push(item.item_type === "line" ? [depth, ...v3LineInputs(item)] : [depth, "section", item.title]);
      if (item.item_type === "section") visit(item.id, depth + 1);
    }
  };
  visit(rootId, 1);
  return rows;
}

armyTest("IO11 a v3 section is duplicated in place and to another v3 with the same inputs and amounts; a v2 copy keeps its amounts", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId, roleId } = await prepareV3Owner(ui, army, "duplication");
    try {
      const versionId = await blankV3(ui, army, projectId, "duplication");
      const sectionId = await seedV3Section(browser, army, versionId, roleId);
      const documentId = randomUUID();
      await seedV3LineProvenance(versionId, `${army.runPrefix} tube`, documentId);
      const source = await readEstimate(browser, versionId);
      const sourceShape = subtreeShape(source, sectionId);
      type Duplicated = { duplicated_section_id: string; copied_item_count: number; converted_lines?: CopyReport[] };

      // In place through the editor's section menu (« Dupliquer la section »), as a user reaches it.
      const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
      expect(released.status).toBe(200);
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(browser.locator(`[data-estimate-item-id="${sectionId}"] [data-testid="estimate-section-title-input"]`))
        .toBeEnabled({ timeout: 150_000 });
      await browser.evaluate((id) => {
        const row = document.querySelector(`[data-estimate-item-id="${id}"]`);
        if (!(row instanceof HTMLElement)) throw new Error("Section row missing.");
        const box = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 40, clientY: box.top + 10 }));
        return true;
      }, sectionId);
      const duplicateButton = browser.locator('[data-testid="estimate-section-context-duplicate-button"]');
      await expect(duplicateButton).toBeEnabled();
      await duplicateButton.click();
      const copyTitle = "duplication lot (copie)";
      await expect.poll(async () => (await readEstimate(browser, versionId)).items.some((item) => item.title === copyTitle),
        { timeout: 60_000, interval: 500 }).toBe(true);
      const afterInPlace = await readEstimate(browser, versionId);
      const copyId = afterInPlace.items.find((item) => item.title === copyTitle)!.id;
      await recordEvidence(army, "io-duplicate-in-place", { versionId, copyId, items: afterInPlace.items.length });

      const otherId = await blankV3(ui, army, projectId, "duplication-b");
      await retakeLease(browser, otherId);
      const toOther = await apiRequest<Envelope<Duplicated>>(browser, "POST",
        `/api/estimates/${versionId}/sections/${sectionId}/duplicate`, { target_version_id: otherId }, await leaseSession(browser, otherId));
      await recordEvidence(army, "io-duplicate-to-v3", { otherId, status: toOther.status, body: toOther.body });
      expect([toOther.status, toOther.body.ok, toOther.body.error?.code ?? null]).toEqual([201, true, null]);
      const other = await readEstimate(browser, otherId);

      const observed = {
        inPlace: {
          title: afterInPlace.items.find((item) => item.id === copyId)?.title ?? null,
          shape: subtreeShape(afterInPlace, copyId),
          count: 1 + subtreeShape(afterInPlace, copyId).length,
          sourceUnchanged: JSON.stringify(subtreeShape(afterInPlace, sectionId)) === JSON.stringify(sourceShape),
          total: num(afterInPlace.version.total_ht_cents),
          sqlTotal: await storedTotalHtCents(versionId),
        },
        toOther: { shape: subtreeShape(other, toOther.body.data.duplicated_section_id), total: num(other.version.total_ht_cents),
          count: toOther.body.data.copied_item_count, converted: toOther.body.data.converted_lines ?? null },
        // Revue 2.8b (F4) : la provenance PDF du tube (`_timax_provenance.sourceDocumentId`) suit les deux copies.
        provenance: { inPlace: await storedSourceMetadata(copyId), toOther: await storedSourceMetadata(toOther.body.data.duplicated_section_id) },
      };
      await recordEvidence(army, "io-duplicate-observed", { versionId, otherId, sourceShape, sourceTotal: source.version.total_ht_cents, observed });
      const sourceTotal = num(source.version.total_ht_cents)!;
      expect(observed).toEqual({
        inPlace: { title: `duplication lot (copie)`, shape: sourceShape, count: 5, sourceUnchanged: true,
          total: sourceTotal * 2, sqlTotal: sourceTotal * 2 },
        toOther: { shape: sourceShape, total: sourceTotal, count: 5, converted: [] },
        provenance: { inPlace: [`${documentId}|-|f|${documentId}`, "-|-|f|-"],
          toOther: [`${documentId}|-|f|${documentId}`, "-|-|f|-"] },
      });
      // Tube: 10,00 € × 1,30 + 0,5 h/u × 40 €/h × 1,20 = 37,00 € × 10 ml ; coude: 2,50 € × 1,30 + 0,25 × 40 × 1,20 = 15,25 € × 4 u.
      expect(sourceTotal).toBe(37_000 + 6_100);

      // C7 guard (green before): a v2 section duplicated in place keeps its amounts.
      const v2SectionId = await anchorV2Section(browser, army, anchorId, roleId, `${army.runPrefix} lot v2`);
      const anchorBefore = await readEstimate(browser, anchorId);
      const v2Copy = await apiRequest<Envelope<Duplicated>>(browser, "POST", `/api/estimates/${anchorId}/sections/${v2SectionId}/duplicate`, {});
      expect([v2Copy.status, v2Copy.body.ok]).toEqual([201, true]);
      const anchorAfter = await readEstimate(browser, anchorId);
      const v2Amounts = (state: ArmyEstimate, id: string) => subtreeLines(state, id).map((line) =>
        [line.title, num(line.quantity), num(line.unit_price_ht_cents), num(line.h_mo), num(field(line, "pu_ht_cents")), num(line.line_total_ht_cents)]);
      const v2Observed = {
        copy: v2Amounts(anchorAfter, v2Copy.body.data.duplicated_section_id),
        total: Number(anchorAfter.version.total_ht_cents) - Number(anchorBefore.version.total_ht_cents),
        converted: v2Copy.body.data.converted_lines ?? [],
      };
      await recordEvidence(army, "io-duplicate-v2-guard", { anchorId, v2Observed });
      expect(v2Observed).toEqual({
        copy: v2Amounts(anchorBefore, v2SectionId),
        total: v2Amounts(anchorBefore, v2SectionId).reduce((sum, line) => sum + Number(line[5]), 0),
        converted: [],
      });
    } finally {
      await closePolicy(owner, army, "duplication");
    }
  });

armyTest("IO12 line ↔ section conversion is disabled with its reason in a v3 editor and refused by name, nothing written", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, roleId } = await prepareV3Owner(ui, army, "conversion");
    try {
      const versionId = await blankV3(ui, army, projectId, "conversion");
      const sectionId = await seedV3Section(browser, army, versionId, roleId);
      let state = await readEstimate(browser, versionId);
      const empty = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`,
        { item_type: "section", position: 2, title: `${army.runPrefix} vide` }, { "if-match": state.version.updated_at });
      expect([empty.status, empty.body.ok]).toEqual([201, true]);
      state = await readEstimate(browser, versionId);
      const tube = lineItems(state).find((line) => line.title === `${army.runPrefix} tube`)!;
      const probes = {
        lineToSection: await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}/items`,
          { id: tube.id, item_type: "section" }, { "if-match": state.version.updated_at }),
        sectionToLine: await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}/items`,
          { id: empty.body.data.item.id, item_type: "line" }, { "if-match": state.version.updated_at }),
      };
      const afterProbes = await readEstimate(browser, versionId);

      const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
      expect(released.status).toBe(200);
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      const sectionTitle = browser.locator(`[data-estimate-item-id="${sectionId}"] [data-testid="estimate-section-title-input"]`);
      await expect(sectionTitle).toBeEnabled({ timeout: 150_000 });
      await screen.getByRole("button", `Plus d'actions pour ${army.runPrefix} tube`, { exact: true }).tap();
      const reason = "Conversion ligne ↔ section indisponible sur un devis au moteur de calcul 3 : supprimez l’élément puis recréez-le.";
      const lineConvert = screen.getByRole("menuitem", /^Convertir en section/);
      await expect(lineConvert).toBeVisible();
      // Revue 2.8b (F6) : l'entrée désactivée ne reçoit pas le survol (pointer-events: none), son motif est un texte visible.
      const lineMenu = { disabled: await lineConvert.getAttribute("aria-disabled"), reason: await lineConvert.getAttribute("title"),
        shown: await lineConvert.getByText(reason, { exact: true }).isVisible() };
      await browser.keyboard.press("Escape");
      await browser.evaluate((id) => {
        const row = document.querySelector(`[data-estimate-item-id="${id}"]`);
        if (!(row instanceof HTMLElement)) throw new Error("Section row missing.");
        const box = row.getBoundingClientRect();
        row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: box.left + 40, clientY: box.top + 10 }));
        return true;
      }, empty.body.data.item.id);
      const sectionConvert = browser.locator('[data-testid="estimate-section-context-convert-to-line-button"]');
      await expect(sectionConvert).toBeVisible();
      const sectionMenu = { disabled: await sectionConvert.isDisabled(), reason: await sectionConvert.getAttribute("title"),
        shown: await sectionConvert.getByText(reason, { exact: true }).isVisible() };
      const after = await readEstimate(browser, versionId);
      const observed = {
        responses: Object.fromEntries(Object.entries(probes).map(([name, response]) =>
          [name, [response.status, response.body.ok, response.body.error?.code ?? null]])),
        lineMenu,
        sectionMenu,
        unchanged: after.items.length === state.items.length && afterProbes.version.updated_at === state.version.updated_at &&
          after.items.every((item) => state.items.some((previous) => previous.id === item.id && previous.item_type === item.item_type)),
      };
      await recordEvidence(army, "io-conversion-gate", { versionId, observed });
      const refused = [409, false, "ESTIMATE_V3_ITEM_CONVERSION_UNAVAILABLE"];
      expect(observed).toEqual({
        responses: { lineToSection: refused, sectionToLine: refused },
        lineMenu: { disabled: "true", reason, shown: true },
        sectionMenu: { disabled: true, reason, shown: true },
        unchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "conversion");
    }
  });

/**
 * A v2 section of `count` lines written in SQL on the anchor (a v2: no v3 writer guard), for the batch limit. Line
 * titles are `titleLength` characters long (the writer accepts 500); the v1/v2 writers never bounded them. With
 * `provenance`, each line carries the source_metadata of an imported workbook row (import, mapping, mapped row, OPTIMA
 * structure), as the affaire import writes it: the copy carries it to the v3 (F2), and the receipt must not echo it.
 */
async function seedLargeV2Section(owner: V3Owner, anchorId: string, count: number, position: number, titleLength = 55,
  provenance = false) {
  if (!UUID.test(anchorId) || !Number.isSafeInteger(count) || count < 1 || count > 5000 || !Number.isSafeInteger(position) ||
    !Number.isSafeInteger(titleLength) || titleLength < 55 || titleLength > 1000) throw new Error("Invalid large section input.");
  const sectionId = randomUUID();
  const output = await querySql(`BEGIN;
INSERT INTO public.estimate_items (id, tenant_id, version_id, item_type, position, title)
SELECT '${sectionId}'::uuid, v.tenant_id, v.id, 'section', ${position}, 'Lot volumineux ${count}'
FROM public.estimate_versions v WHERE v.id = '${anchorId}'::uuid AND v.tenant_id = '${owner.tenantId}'::uuid;
INSERT INTO public.estimate_items (tenant_id, version_id, parent_id, item_type, position, title, description,
  quantity, unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, h_mo_majoration, k_mo,
  pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, source_metadata)
SELECT v.tenant_id, v.id, '${sectionId}'::uuid, 'line', g,
  rpad('Fourniture et pose de canalisation PVC 110 mm, ligne ' || g || ' ', ${titleLength}, 'x'), 'u', 1, 100, 2000, 1, 0, 1, 1, 130, 130, 26, 156,
  ${provenance ? `jsonb_build_object('import_id', '${randomUUID()}', 'mapping_id', '${randomUUID()}', 'mapped_row_id', gen_random_uuid(),
    'row_index', g, 'notes', null, 'sheet_name', 'PLOMBERIE', 'source_row_number', g + 12, 'bold_columns', '[]'::jsonb,
    'merged_columns', '[]'::jsonb, 'outline_level', null, '_timax_structure', jsonb_build_object('sheet_name', 'PLOMBERIE',
      'source_row_number', g + 12, 'bold_columns', '[]'::jsonb, 'merged_columns', '[]'::jsonb, 'outline_level', null,
      'column_order', '["N°","Désignation","Uté","Qté","PR Fourniture unitaire"]'::jsonb))` : "'{}'::jsonb"}
FROM public.estimate_versions v CROSS JOIN generate_series(1, ${count}) AS g
WHERE v.id = '${anchorId}'::uuid AND EXISTS (SELECT 1 FROM public.estimate_items s WHERE s.id = '${sectionId}'::uuid);
COMMIT;
SELECT count(*) FROM public.estimate_items WHERE parent_id = '${sectionId}'::uuid;
`);
  if (output.at(-1) !== String(count)) throw new Error("The large v2 section was not persisted.");
  return sectionId;
}

// C8 (2.8b) : une copie vers une v3 est un seul lot atomique de l'écrivain v3, jusqu'à 1 000 opérations (décision du
// propriétaire du 18/10 : jusqu'à 3,5 s localement pour 1 000 lignes ; en CI, sous le délai de 8 s des rôles de l'API,
// run 39138950745 rouge avant 20261018172303) ; au-delà, refus nommé qui renvoie vers l'import de l'affaire, jamais une
// écriture en plusieurs lots. C9 (revue) : un titre au-delà de 500 caractères est refusé par son nom, rien n'est écrit.
armyTest("IO13 a section copy into a v3 is one atomic batch up to 1 000 operations and refused by name beyond it, pointing to the affaire import, nothing written", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId, anchorId } = await prepareV3Owner(ui, army, "limite");
    try {
      const largeSectionId = await seedLargeV2Section(owner, anchorId, 1000, 900);
      // At the limit, every line carries the provenance of an imported row: the copy keeps it (F2), the receipt of the
      // writer does not echo it (owner decision of 18/10: no limit is raised for it).
      const boundarySectionId = await seedLargeV2Section(owner, anchorId, 999, 901, 55, true);
      const longTitleSectionId = await seedLargeV2Section(owner, anchorId, 1, 902, 501);
      // 1 000 operations whose receipt (the stored rows, 200-character titles) goes over the writer's 2 Mio.
      const heavyReceiptSectionId = await seedLargeV2Section(owner, anchorId, 999, 903, 200);
      const versionId = await blankV3(ui, army, projectId, "limite");
      await retakeLease(browser, versionId);
      const before = await readEstimate(browser, versionId);
      const response = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [largeSectionId] });
      const after = await readEstimate(browser, versionId);
      const observed = {
        response: [response.status, response.body.ok, response.body.error?.code ?? null],
        pointsToAffaireImport: (response.body.error?.message ?? "").includes("depuis l’affaire"),
        unchanged: after.items.length === before.items.length && after.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-copy-too-large", { versionId, anchorId, largeSectionId, message: response.body.error?.message, observed });
      expect(observed).toEqual({ response: [413, false, "ESTIMATE_V3_COPY_TOO_LARGE"], pointsToAffaireImport: true, unchanged: true });

      // C9: a line title over the writer's 500 characters is refused by name before any write.
      const longTitle = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [longTitleSectionId] });
      const afterLongTitle = await readEstimate(browser, versionId);
      const named = {
        response: [longTitle.status, longTitle.body.ok, longTitle.body.error?.code ?? null],
        namesTheLine: (longTitle.body.error?.message ?? "").startsWith("« Fourniture et pose de canalisation PVC 110 mm, ligne 1 "),
        unchanged: afterLongTitle.items.length === before.items.length && afterLongTitle.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-copy-long-title", { versionId, longTitleSectionId, message: longTitle.body.error?.message, named });
      expect(named).toEqual({ response: [400, false, "ESTIMATE_V3_COPY_ITEM_INVALID"], namesTheLine: true, unchanged: true });

      // Within 1 000 operations but over the 2 Mio receipt (known only at the write): the database refuses it by name
      // inside the transaction, the copy answers its named 413, nothing written (never the generic 400).
      const heavy = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [heavyReceiptSectionId] });
      const afterHeavy = await readEstimate(browser, versionId);
      const heavyObserved = {
        response: [heavy.status, heavy.body.ok, heavy.body.error?.code ?? null],
        pointsToAffaireImport: (heavy.body.error?.message ?? "").includes("depuis l’affaire"),
        unchanged: afterHeavy.items.length === before.items.length && afterHeavy.version.updated_at === before.version.updated_at,
      };
      await recordEvidence(army, "io-copy-heavy-receipt", { versionId, heavyReceiptSectionId, message: heavy.body.error?.message, heavyObserved });
      expect(heavyObserved).toEqual({ response: [413, false, "ESTIMATE_V3_COPY_TOO_LARGE"], pointsToAffaireImport: true, unchanged: true });

      // At the limit (1 section + 999 lines = 1 000 operations): one atomic batch, every line, amounts of the writer.
      type Imported = { created_section_ids: string[]; created_line_ids: string[] };
      const started = Date.now();
      const atLimit = await apiRequest<Envelope<Imported>>(browser, "POST", `/api/estimates/${versionId}/import-sections`,
        { source_version_id: anchorId, section_ids: [boundarySectionId] });
      const elapsedMs = Date.now() - started;
      const copied = await readEstimate(browser, versionId);
      const copiedSectionId = atLimit.body.data?.created_section_ids?.[0] ?? null;
      const copiedLines = copiedSectionId ? subtreeLines(copied, copiedSectionId) : [];
      const [withProvenance] = copiedSectionId && UUID.test(copiedSectionId) ? await querySql(`SELECT count(*) FROM public.estimate_items
WHERE parent_id = '${copiedSectionId}'::uuid AND item_type = 'line' AND source_metadata ? 'mapped_row_id'
  AND source_metadata->'_timax_structure'->>'sheet_name' = 'PLOMBERIE';
`) : [null];
      const boundary = {
        response: [atLimit.status, atLimit.body.ok, atLimit.body.error?.code ?? null],
        lines: copiedLines.length,
        withProvenance: Number(withProvenance),
        priced: copiedLines.filter((line) => num(line.line_total_ht_cents) === 130).length,
        total: num(copied.version.total_ht_cents),
        sqlTotal: await storedTotalHtCents(versionId),
      };
      // elapsedMs: the whole route (reads, preparation, commit_estimate_batch), reported for the CI runner, not asserted.
      await recordEvidence(army, "io-copy-at-limit", { versionId, boundarySectionId, boundary, elapsedMs });
      // 999 × (1,00 € × FO 1,30) = 1 298,70 € HT.
      expect(boundary).toEqual({ response: [201, true, null], lines: 999, withProvenance: 999, priced: 999, total: 129_870,
        sqlTotal: 129_870 });
    } finally {
      await closePolicy(owner, army, "limite");
    }
  });

// Revue 2.8b (Codex, P1) : une v3 créée depuis le DPGF lié lit la source par pages ; PostgREST s'arrête à
// max_rows = 1000 et la création gardait en silence les 1 000 premières lignes d'une source plus longue.
armyTest("IO14 a v3 created from a linked DPGF of 1 001 lines keeps every line", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { owner, projectId } = await prepareV3Owner(ui, army, "dpgf-long");
    try {
      const filename = `${army.runPrefix}-dpgf-long.xlsx`;
      const importId = await seedLinkedDpgf(owner, projectId, filename, Array.from({ length: 1001 }, (_, index) =>
        ({ designation: `${army.runPrefix} ligne ${index + 1}`, unit: "u", quantity: "1", unit_price_ht: "1,00" })));
      const created = await createVersion(browser, { creation_mode: "linked_dpgf_source", project_id: projectId,
        version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} dpgf long v3`, expected_calc_engine_version: 3 } });
      const versionId = created.body.data?.version?.id ?? null;
      if (versionId) ownEstimate(army, { projectId, versionId });
      const [lines, rows] = versionId && UUID.test(versionId) ? await querySql(`SELECT count(*) FROM public.estimate_items
WHERE version_id = '${versionId}'::uuid AND item_type = 'line' AND source_provider = 'dpgf';
SELECT count(*) FROM public.dpgf_rows_mapped WHERE import_id = '${importId}'::uuid;
`) : [null, null];
      const observed = {
        response: [created.status, created.body.ok, created.body.error?.code ?? null, created.body.data?.version?.calc_engine_version ?? null],
        rows: Number(rows), lines: Number(lines),
        total: num(created.body.data?.version?.total_ht_cents),
        sqlTotal: versionId ? await storedTotalHtCents(versionId) : null,
      };
      await recordEvidence(army, "io-linked-dpgf-long", { versionId, importId, observed });
      // 1 001 × (1,00 € × FO 1,30) = 1 301,30 € HT.
      expect(observed).toEqual({ response: [201, true, null, 3], rows: 1001, lines: 1001, total: 130_130, sqlTotal: 130_130 });
    } finally {
      await closePolicy(owner, army, "dpgf-long");
    }
  });
