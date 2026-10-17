import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Locator, type Screen } from "e2e";

import {
  apiRequest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState, type ArmyVersion,
} from "../critical/fixtures";
import { ownedEstimateContext } from "./calculation-gate-support";
// Aliased: the sign-up helper is not a React hook, whatever its name.
import { setTenantCalcPolicy, useDedicatedV3Owner as signUpDedicatedV3Owner, type V3Owner } from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.6 : préalables et lectures du parcours engine-v3-editor
// (docs/testing/estimate-engine-v3-2.6.md §9). Les préalables reprennent ceux de V3P01
// (engine-v3-persistence.e2e.ts) : propriétaire dédié, rôle « Tuyauteur » 40 €/h par l'API,
// politique 3 posée par le transport SQL possédé le temps de la création, puis remise à 2.
// Les lectures d'écran suivent le contrat du §9.4 de ce document : rien ici ne dépend d'un
// composant v3 précis, seulement des libellés accessibles et des attributs qu'il fixe.

export type Ui = { app: App; screen: Screen; browser: Browser };
export type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };

export const BANNER = "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";
const NEUTRAL_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal",
} as const;

/** Montant au format affiché (fr-FR), espaces normalisés : 6905456 → « 69 054,56 € ». */
export function eur(cents: number) {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const units = Math.floor(absolute / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${units},${String(absolute % 100).padStart(2, "0")} €`;
}

/** Espaces (insécables et fines comprises) réduits à une espace ; signe moins typographique → « - ». */
export const normalized = (text: string | null | undefined) =>
  (text ?? "").replace(/[\s  ]+/g, " ").replace(/[−–]/g, "-").trim();

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));

export function assertOwnedLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("engine-v3-editor requires the owned local Supabase stack and its SQL route.");
  }
}

export type V3Draft = {
  owner: V3Owner;
  projectId: string;
  anchorId: string;
  versionId: string;
  sectionId: string;
  sectionTitle: string;
  tuyauteurId: string;
};

async function lockVersion(browser: Browser, versionId: string) {
  const lock = await apiRequest(browser, "POST", `/api/estimates/${versionId}/lock`);
  expect(lock.status).toBe(201);
}

/**
 * Hands the draft lease back once a precondition is written. The lease belongs to this document's
 * API session; the editor opened afterwards by a navigation is another page session (useDraftLock)
 * and would otherwise stay read-only, « verrouillé par vous dans un autre onglet » (2.6 green run).
 */
async function releaseVersion(browser: Browser, versionId: string) {
  const release = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
  expect(release.status).toBe(200);
}

async function ensureTuyauteur(browser: Browser, army: ArmyState, anchorId: string) {
  const details = await apiRequest<Envelope<{ labor_roles: Array<{ id: string; name: string; hourly_rate_cents: number; is_active: boolean }> }>>(
    browser, "GET", `/api/estimates/${anchorId}`);
  expect(details.status).toBe(200);
  const existing = details.body.data.labor_roles.find(role => role.name === "Tuyauteur");
  if (existing) {
    expect([existing.hourly_rate_cents, existing.is_active]).toEqual([4000, true]);
    return existing.id;
  }
  await lockVersion(browser, anchorId);
  const created = await apiRequest<Envelope<{ labor_role: { id: string; hourly_rate_cents: number } }>>(
    browser, "POST", `/api/estimates/${anchorId}/labor-roles`, { name: "Tuyauteur", hourly_rate_cents: 4000 });
  await recordEvidence(army, "v3e-labor-role", { anchorId, response: created });
  expect([created.status, created.body.ok, created.body.data.labor_role.hourly_rate_cents]).toEqual([201, true, 4000]);
  return created.body.data.labor_role.id;
}

/**
 * V3P01's preconditions for one journey: a dedicated owner (its own tenant, so the policy window
 * never reaches the concurrent journeys), an affaire with a neutral v2 anchor, the « Tuyauteur »
 * role at 4 000 c/h, then one v3 created under policy 3 (1,30 / 1,20) and the policy back to 2.
 * The v3 receives one section by the API; lines are typed through the grid by the journey, or
 * seeded by one committed batch when the scenario is not about typing (`seedLines`).
 */
export async function prepareV3Draft(ui: Ui, army: ArmyState, label: string): Promise<V3Draft> {
  assertOwnedLocalBackend();
  const dedicated = await signUpDedicatedV3Owner(ui.browser, ui.app.baseUrl!, army.runPrefix);
  await ui.app.open("/dashboard/affaires");
  const projectName = `ARMY-L2-V3E-${label}-${army.runPrefix}`;
  const anchor = await apiRequest<Envelope<{ project: { id: string }; version: { id: string; calc_engine_version: number } }>>(
    ui.browser, "POST", "/api/estimates", { project: { name: projectName }, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ancre v2` } });
  expect([anchor.status, anchor.body.ok, anchor.body.data.version.calc_engine_version]).toEqual([201, true, 2]);
  const projectId = anchor.body.data.project.id;
  const anchorId = anchor.body.data.version.id;
  ownEstimate(army, { projectId, versionId: anchorId });
  const context = await ownedEstimateContext(projectId);
  const owner: V3Owner = { tenantId: context.tenantId, userId: context.userId };
  if (owner.tenantId !== dedicated.tenantId || owner.userId !== dedicated.userId) throw new Error(`${label} must run as its dedicated owner.`);
  const tuyauteurId = await ensureTuyauteur(ui.browser, army, anchorId);

  // ASCII only: setTenantCalcPolicy guards the reason with /^ARMY-[A-Za-z0-9 :.,'()-]{5,200}$/.
  const reason = `${army.runPrefix} recette 2.6 editeur v3`;
  let opened = false;
  let created: { status: number; body: Envelope<{ version: { id: string; calc_engine_version: number } }> } | null = null;
  try {
    await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason });
    opened = true;
    created = await apiRequest(ui.browser, "POST", "/api/estimates", {
      project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ${label} v3`, expected_calc_engine_version: 3 },
    });
  } finally {
    if (opened) await setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${reason} fin` });
  }
  await recordEvidence(army, `v3e-${label.toLowerCase()}-created`, { projectId, anchorId, owner, tuyauteurId, created });
  expect([created?.status, created?.body.ok, created?.body.data?.version?.calc_engine_version]).toEqual([201, true, 3]);
  const versionId = created!.body.data.version.id;
  ownEstimate(army, { projectId, versionId });

  await lockVersion(ui.browser, versionId);
  const empty = await readEstimate(ui.browser, versionId);
  expect([num(empty.version.sale_coefficient_fo), num(empty.version.sale_coefficient_mo)]).toEqual([1.3, 1.2]);
  const sectionTitle = `${army.runPrefix} lot`;
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: sectionTitle }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  await releaseVersion(ui.browser, versionId);
  return { owner, projectId, anchorId, versionId, sectionId: section.body.data.item.id, sectionTitle, tuyauteurId };
}

/** Lines that a scenario does not type, by one committed batch (same contract as V3P01, §9.3.2 of 2.5). */
export async function seedLines(ui: Ui, army: ArmyState, draft: V3Draft, label: string, lines: Array<Record<string, unknown>>) {
  // prepareV3Draft handed its lease back: this document takes it again for the batch only.
  await lockVersion(ui.browser, draft.versionId);
  const before = await readEstimate(ui.browser, draft.versionId);
  const request = {
    operation_key: randomUUID(),
    operations: lines.map((line, index) => ({ op: "create", data: { item_type: "line", parent_id: draft.sectionId, position: index + 1, ...line } })),
  };
  const response = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string; code?: string }> }>>(
    ui.browser, "POST", `/api/estimates/${draft.versionId}/batch`, request, { "if-match": before.version.updated_at });
  await recordEvidence(army, `v3e-seed-${label}`, { versionId: draft.versionId, request, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  expect(response.body.data.results.filter(result => result.status === "error")).toEqual([]);
  await releaseVersion(ui.browser, draft.versionId);
  const state = await readEstimate(ui.browser, draft.versionId);
  return lines.map(line => {
    const item = state.items.find(candidate => candidate.item_type === "line" && candidate.title === line.title);
    if (!item) throw new Error(`Seeded line ${String(line.title)} is missing.`);
    return item;
  });
}

async function withNavigationDrawer<T>(ui: Ui, action: (navigation: Locator) => Promise<T>) {
  const viewport = await ui.browser.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  try {
    // Below the 960px navigation breakpoint the drawer holds the UI mode switch (bulk-edit-sync-sources).
    await ui.browser.setViewport({ width: 900, height: 800 });
    await ui.screen.getByRole("button", "Ouvrir le menu principal", { exact: true }).click();
    const navigation = ui.screen.getByRole("dialog", "Navigation principale", { exact: true });
    await expect(navigation).toBeVisible();
    const result = await action(navigation);
    await navigation.getByRole("button", "Fermer le menu", { exact: true }).click();
    await expect(navigation).toBeHidden();
    return result;
  } finally {
    await ui.browser.setViewport(viewport);
  }
}

/** The disposable owner works in Expert mode: the supplier preselection is hidden in simplified mode. */
export async function switchToExpertMode(ui: Ui) {
  const expert = (navigation: Locator) => navigation.getByRole("switch", "Mode Expert actif, basculer en Simplifié", { exact: true });
  const simplified = (navigation: Locator) => navigation.getByRole("switch", "Mode Simplifié actif, basculer en Expert", { exact: true });
  await withNavigationDrawer(ui, async (navigation) => {
    await expect(navigation.getByRole("switch", /^Mode (?:Expert|Simplifié) actif, basculer en /)).toBeVisible();
    if (await simplified(navigation).isVisible()) await simplified(navigation).click();
    await expect(expert(navigation)).toBeVisible();
  });
  await expect.poll(async () => {
    await ui.browser.reload();
    return withNavigationDrawer(ui, (navigation) => expert(navigation).isVisible());
  }, { timeout: 30_000, interval: 1_000 }).toBe(true);
}

export const grid = (ui: Ui) => ui.screen.getByRole("grid", "Lignes de devis", { exact: true });

/**
 * V3E-01, the first red: the editor opens on a v3 (2.1 banner gone), with the grid and the
 * « Résumé du paramétrage » region. Before 2.6 the edit route still renders the 2.1 banner.
 */
export async function openV3Editor(ui: Ui, army: ArmyState, draft: V3Draft, label: string) {
  await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
  const read = () => ui.browser.evaluate((banner) => ({
    banner: Array.from(document.querySelectorAll("[data-testid=\"estimate-engine-unavailable\"]"))
      .some(node => (node.textContent ?? "").includes(banner)),
    heading: Array.from(document.querySelectorAll("h1, h2")).some(node => (node.textContent ?? "").trim() === "Éditer le chiffrage"),
    grid: Boolean(document.querySelector("[role=\"grid\"][aria-label=\"Lignes de devis\"]")),
    summary: Boolean(document.querySelector("[role=\"region\"][aria-label=\"Résumé du paramétrage\"]")),
  }), BANNER);
  const expected = { banner: false, heading: true, grid: true, summary: true };
  const deadline = Date.now() + 60_000;
  let actual = await read();
  while (JSON.stringify(actual) !== JSON.stringify(expected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    actual = await read();
  }
  await recordEvidence(army, `v3e-${label}-editor-open`, { versionId: draft.versionId, url: await ui.browser.url(), expected, actual });
  expect(actual, "the v3 editor opens instead of the 2.1 engine-unavailable banner").toEqual(expected);
  await expect(grid(ui)).toBeVisible();
}

/** Columns of the « Standard » preset (role, K FO, K MO): the role cell is typed through the grid. */
export async function showStandardColumns(ui: Ui) {
  await ui.screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
  const display = ui.screen.getByTestId("estimate-editor-display-button", { visible: true });
  await display.tap();
  await ui.screen.getByRole("button", "Standard", { exact: true }).tap();
  await display.tap();
}

/**
 * Fills one labelled control, then leaves it with Tab from the keyboard: a combobox (unit, role)
 * may open a listbox that carries the same accessible name, so the locator is not resolved twice.
 */
export async function fillCell(ui: Ui, label: string, value: string) {
  await ui.screen.getByLabel(label, { exact: true }).fill(value);
  await ui.browser.keyboard.press("Tab");
}

/**
 * One line added through the grid (section « + » menu), its id read from the creation response. The
 * « + » appears on hover of the section's designation (pointer-events none until then,
 * estimate-frozen.css « .estimate-section-quick-actions »): the pointer hovers the title first, as a
 * user does; a section created by the API has no focus inside it to reveal the menu otherwise.
 */
export async function addGridLine(ui: Ui, draft: V3Draft) {
  const itemUrl = new URL(`/api/estimates/${draft.versionId}/items`, ui.app.baseUrl!).href;
  const addLine = ui.screen.getByTestId("estimate-section-add-line-button");
  // The menu stays open after « + Ligne » until an outside click or Escape (usePopover): a second
  // tap on « + » would close it, so it is opened only when it is not already.
  if (!(await addLine.isVisible())) {
    await ui.browser.locator(`[data-estimate-item-id="${draft.sectionId}"] [data-testid="estimate-section-title-input"]`).hover();
    await ui.screen.getByRole("button", `Ajouter dans ${draft.sectionTitle}`, { exact: true }).tap();
  }
  const [response] = await Promise.all([
    ui.browser.waitForResponse(itemUrl, { timeout: 60_000 }),
    addLine.tap(),
  ]);
  expect(response.status).toBe(201);
  const body = await response.json<Envelope<{ item: ArmyItem }>>();
  expect([body.ok, body.data.item.item_type, body.data.item.parent_id]).toEqual([true, "line", draft.sectionId]);
  await expect(ui.browser.locator(`[data-estimate-item-id="${body.data.item.id}"]`)).toHaveCount(1);
  return body.data.item.id;
}

/**
 * V3E-11 precondition (2.6 green run): the supplier preselection proposes an offer only for a line with
 * no retained offer and a single offer (server.ts « findEstimateSupplierPreselectionProposalAlternative »,
 * every engine); a line holding offer A with a cheaper B is a « divergence » exception, never applied.
 * Offer A is released from the line by the v3 batch writer (its lease taken over from the open editor
 * page, then handed back), then removed from the catalogue, so that B is the line's single offer.
 */
export async function releaseOfferForPreselection(ui: Ui, army: ArmyState, draft: V3Draft, lineId: string, offerId: string) {
  const lease = await apiRequest(ui.browser, "PATCH", `/api/estimates/${draft.versionId}/lock?force=true`);
  expect(lease.status).toBe(200);
  const before = await readEstimate(ui.browser, draft.versionId);
  const request = { operation_key: randomUUID(), operations: [{ op: "update", id: lineId, data: { selected_supplier_price_id: null } }] };
  const response = await apiRequest<Envelope<{ committed: boolean }>>(
    ui.browser, "POST", `/api/estimates/${draft.versionId}/batch`, request, { "if-match": before.version.updated_at });
  await releaseVersion(ui.browser, draft.versionId);
  const removed = await apiRequest<Envelope<unknown>>(ui.browser, "POST", "/api/prices", { action: "delete", id: offerId });
  await recordEvidence(army, "v3e-preselection-precondition", { versionId: draft.versionId, lineId, offerId, request, response, removed });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  expect([removed.status, removed.body.ok]).toEqual([200, true]);
}

export async function typeTitle(ui: Ui, itemId: string, title: string) {
  await ui.browser.locator(`[data-estimate-item-id="${itemId}"] [data-testid="estimate-line-title-input"]`).fill(title);
  await ui.browser.keyboard.press("Tab");
}

/* ---------- API projections ---------- */

export type VersionView = {
  totals: [number, number, number];
  gross: number | null;
  applied: number | null;
  commercialRounding: number | null;
  roundingAdjustment: number | null;
  saleCoefficients: [number | null, number | null];
  discountBp: number;
  discountAmountCents: number | null;
  taxRateBp: number;
  rounding: [string, number];
  taxByRate: Array<{ rateBp: number; baseCents: number; taxCents: number }>;
};
export type LineView = {
  title: string;
  unit: string | null;
  status: string | null;
  quantity: number | null;
  prFo: number | null;
  hPerUnit: number | null;
  hMo: number | null;
  pu: number | null;
  net: number | null;
  tax: number | null;
  taxRateBp: number | null;
  roleId: string | null;
  productId: string | null;
  offerId: string | null;
};

const lines = (state: ArmyEstimate) => state.items.filter(item => item.item_type === "line");

export function versionView(state: ArmyEstimate): VersionView {
  const byRate = new Map<number, { baseCents: number; taxCents: number }>();
  for (const item of lines(state)) {
    if ((item.pricing_status ?? "priced") !== "priced") continue;
    const rate = Number(item.tax_rate_bp);
    const entry = byRate.get(rate) ?? { baseCents: 0, taxCents: 0 };
    entry.baseCents += Number(item.line_total_ht_cents ?? 0);
    entry.taxCents += Number(item.line_tax_cents ?? 0);
    byRate.set(rate, entry);
  }
  const version = state.version;
  return {
    totals: [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents],
    gross: num(version.gross_ht_cents),
    applied: num(version.discount_applied_cents),
    commercialRounding: num(version.commercial_rounding_cents),
    roundingAdjustment: num(version.rounding_adjustment_cents),
    saleCoefficients: [num(version.sale_coefficient_fo), num(version.sale_coefficient_mo)],
    discountBp: Number(version.discount_bp),
    discountAmountCents: num(version.discount_amount_cents),
    taxRateBp: Number(version.tax_rate_bp),
    rounding: [version.rounding_mode, Number(version.rounding_step_cents)],
    taxByRate: [...byRate.entries()].sort(([left], [right]) => left - right)
      .map(([rateBp, entry]) => ({ rateBp, ...entry })),
  };
}

export function lineView(item: ArmyItem): LineView {
  return {
    title: item.title, unit: (item.unit_code as string | null | undefined) ?? null, status: (item.pricing_status as string | null | undefined) ?? null,
    quantity: num(item.quantity), prFo: num(item.unit_price_ht_cents), hPerUnit: num(item.h_mo_per_unit), hMo: num(item.h_mo),
    pu: num(item.pu_ht_cents), net: num(item.line_total_ht_cents), tax: num(item.line_tax_cents), taxRateBp: num(item.tax_rate_bp),
    roleId: (item.labor_role_id as string | null | undefined) ?? null, productId: (item.product_id as string | null | undefined) ?? null,
    offerId: (item.selected_supplier_price_id as string | null | undefined) ?? null,
  };
}

function pick<T extends object>(actual: T, expected: Partial<T>) {
  return Object.fromEntries(Object.keys(expected).map(key => [key, actual[key as keyof T]])) as Partial<T>;
}

export type ApiExpectation = { version: Partial<VersionView>; lines?: Record<string, Partial<LineView>> };

export function apiProjection(state: ArmyEstimate, expected: ApiExpectation) {
  return {
    version: pick(versionView(state), expected.version),
    lines: Object.fromEntries(Object.entries(expected.lines ?? {}).map(([id, line]) => {
      const item = state.items.find(candidate => candidate.id === id);
      return [id, item ? pick(lineView(item), line) : null];
    })),
  };
}

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET of the estimate. The consistent-read guard refuses a read that spans a save
 * (409 VERSION_CONFLICT, as in waitForAutoSave): only that named result is retried.
 */
export async function readConsistent(ui: Ui, versionId: string): Promise<ArmyEstimate> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const response = await apiRequest<Envelope<{ version: ArmyVersion; items: ArmyItem[] }>>(ui.browser, "GET", `/api/estimates/${versionId}`);
    if (response.status === 409 && response.body.error?.code === "VERSION_CONFLICT" && Date.now() < deadline) {
      await pause(750);
      continue;
    }
    expect([response.status, response.body.ok]).toEqual([200, true]);
    const { version, items } = response.body.data;
    return { project: version.estimate_projects, version, items };
  }
}

/** Polls the persisted estimate (no save is triggered here) until it equals the expectation. */
export async function waitPersisted(ui: Ui, versionId: string, expected: ApiExpectation, timeoutMs = 60_000) {
  const target = { version: expected.version, lines: expected.lines ?? {} };
  const deadline = Date.now() + timeoutMs;
  let actual = apiProjection(await readConsistent(ui, versionId), expected);
  while (!sameJson(actual, target) && Date.now() < deadline) {
    await pause(1_000);
    actual = apiProjection(await readConsistent(ui, versionId), expected);
  }
  return actual;
}

/* ---------- Screen reads (contract §9.4) ---------- */

export type RowExpectation = {
  id: string;
  title: string;
  unit?: string;
  pu?: string;
  pt?: string;
  hTotal?: string;
  status?: string;
  taxRate?: string;
};
export type ScreenExpectation = { chips: string[]; forbiddenChipPrefixes?: string[]; rows?: RowExpectation[] };

async function readScreen(ui: Ui, expected: ScreenExpectation) {
  const raw = await ui.browser.evaluate((rows) => {
    const clean = (text: string | null | undefined) =>
      (text ?? "").replace(/[\s  ]+/g, " ").replace(/[−–]/g, "-").trim();
    const region = document.querySelector("[role=\"region\"][aria-label=\"Résumé du paramétrage\"]");
    const chips = region
      ? Array.from(region.querySelectorAll("button")).map(button => clean(button.getAttribute("aria-label") ?? button.textContent))
      : null;
    const labelled = (scope: Element | null, label: string) =>
      scope ? Array.from(scope.querySelectorAll("[aria-label]")).find(node => node.getAttribute("aria-label") === label) ?? null : null;
    const valueOf = (node: Element | null) => {
      if (!node) return null;
      if (node instanceof HTMLSelectElement) return clean(node.value);
      if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return clean(node.value);
      return clean(node.textContent);
    };
    const read = rows.map((row) => {
      const scope = document.querySelector(`[data-estimate-item-id="${row.id}"]`);
      const out: Record<string, string | null> = { id: row.id, title: row.title };
      if (row.unit) out.unit = valueOf(labelled(scope, `Unité pour ${row.title}`));
      if (row.pu) out.pu = valueOf(labelled(scope, `Prix de vente unitaire HT pour ${row.title}`));
      if (row.pt) out.pt = clean(scope?.querySelector("[data-estimate-column=\"total_price\"]")?.textContent);
      if (row.hTotal) out.hTotal = valueOf(labelled(scope, `Heures de main-d’œuvre totales pour ${row.title}`));
      if (row.status) {
        const select = labelled(scope, `Statut de chiffrage pour ${row.title}`);
        out.status = select instanceof HTMLSelectElement ? clean(select.selectedOptions[0]?.textContent) : null;
      }
      if (row.taxRate) out.taxRate = valueOf(labelled(scope, `Taux de TVA pour ${row.title}`));
      return out;
    });
    return { chips, rows: read };
  }, (expected.rows ?? []).map(row => ({
    id: row.id, title: row.title, unit: Boolean(row.unit), pu: Boolean(row.pu), pt: Boolean(row.pt), hTotal: Boolean(row.hTotal),
    status: Boolean(row.status), taxRate: Boolean(row.taxRate),
  })));
  const chips = raw.chips ?? [];
  return {
    raw,
    view: {
      summary: raw.chips !== null,
      missingChips: expected.chips.filter(chip => !chips.includes(chip)),
      forbiddenChips: chips.filter(chip => (expected.forbiddenChipPrefixes ?? []).some(prefix => chip.startsWith(prefix))),
      rows: raw.rows,
    },
  };
}

function screenTarget(expected: ScreenExpectation) {
  return {
    summary: true, missingChips: [], forbiddenChips: [],
    rows: (expected.rows ?? []).map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined))),
  };
}

async function waitScreen(ui: Ui, expected: ScreenExpectation, timeoutMs = 30_000) {
  const target = screenTarget(expected);
  const deadline = Date.now() + timeoutMs;
  let current = await readScreen(ui, expected);
  while (!sameJson(current.view, target) && Date.now() < deadline) {
    await pause(750);
    current = await readScreen(ui, expected);
  }
  return current;
}

/**
 * One saved state, read three ways (contract §9.3 of the doc): the persisted values (API), the
 * values displayed by the editor that saved them, and the values displayed and reread after a
 * reload. The caller has already triggered the save (Ctrl+S, « Enregistrer le paramétrage »).
 */
export async function checkpoint(ui: Ui, army: ArmyState, label: string, versionId: string,
  expected: { api: ApiExpectation; screen: ScreenExpectation }) {
  const apiTarget = { version: expected.api.version, lines: expected.api.lines ?? {} };
  const persisted = await waitPersisted(ui, versionId, expected.api);
  const before = await waitScreen(ui, expected.screen);
  await ui.browser.reload();
  await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
  const after = await waitScreen(ui, expected.screen);
  const reread = apiProjection(await readConsistent(ui, versionId), expected.api);
  await recordEvidence(army, `v3e-${label}`, {
    versionId, expected,
    actual: { persisted, displayedBeforeReload: before.raw, displayedAfterReload: after.raw, rereadAfterReload: reread },
  });
  expect(persisted, `${label}: persisted`).toEqual(apiTarget);
  expect(before.view, `${label}: displayed after save`).toEqual(screenTarget(expected.screen));
  expect(after.view, `${label}: displayed after reload`).toEqual(screenTarget(expected.screen));
  expect(reread, `${label}: reread after reload`).toEqual(apiTarget);
}

/* ---------- Settings drawer (contract §9.4.4) ---------- */

export const settingsDialog = (ui: Ui) => ui.screen.getByRole("dialog", "Paramétrage du devis", { exact: true });

/** Sync states of a page that does not own its draft lease yet (useEstimateEditorAutoSave). */
const LEASE_PENDING_LABELS = new Set(["Verrouillé", "Connexion…"]);

/**
 * Waits until the page owns its draft lease: every grid and drawer input stays disabled before
 * (isDraftLockPending, isDraftLockedByOther). A navigation (goto) opens another page session, and
 * the document it leaves hands its lease back by a keepalive release sent from beforeunload
 * (useDraftLock). When that release does not land (once in the combined 2.6 run), the new page
 * stays « Verrouillé par vous dans un autre onglet ou appareil » until the 120 s lease expires
 * (DRAFT_LOCK_TTL_SECONDS) and its 5 s acquisition retry takes it, as a user's page would. The
 * journey waits for that recovery; it retries nothing.
 */
export async function waitForDraftLease(ui: Ui) {
  const status = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
  await expect.poll(async () => LEASE_PENDING_LABELS.has(normalized(await status.textContent())), { timeout: 150_000, interval: 1_000 })
    .toBe(false);
}

export async function openSettings(ui: Ui, versionId: string) {
  await ui.browser.goto(`/dashboard/estimates/${versionId}/edit?openSettings=general`, { waitUntil: "domcontentloaded" });
  await expect(settingsDialog(ui)).toBeVisible({ timeout: 60_000 });
  await expect(settingsDialog(ui).getByLabel("Coefficient de vente FO", { exact: true })).toBeVisible({ timeout: 30_000 });
  await waitForDraftLease(ui);
  return settingsDialog(ui);
}

export async function clickSaveSettings(ui: Ui) {
  const save = settingsDialog(ui).getByRole("button", "Enregistrer le paramétrage", { exact: true });
  await expect(save).toBeEnabled({ timeout: 30_000 });
  await save.tap();
}

/** Text of an element of the settings drawer, spaces normalized (null when absent). */
export async function settingsText(ui: Ui, testId: string) {
  const node = settingsDialog(ui).getByTestId(testId);
  return (await node.count()) === 1 ? normalized(await node.textContent()) : null;
}

export async function inputValue(locator: Locator) {
  return normalized(await locator.inputValue());
}
