import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
import { ownedEstimateContext, versionCountOf } from "./calculation-gate-support";
import {
  insertCompletedTakeoffJob, insertProjectMarginRule, itemCountOfVersions, probeV3PersistenceSchema, readTenantCalcPolicy,
  setTenantCalcPolicy, useDedicatedV3Owner, versionIdsOf, type V3Owner, type V3PersistenceSchema,
} from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.5 — persistance, gel et règles v3 derrière la politique d'entreprise
// (docs/testing/estimate-engine-v3-2.5.md §9, V3P-01 à V3P-12). Défaillances observables,
// écrites avant le code :
//  V3P-01 La politique n'existe pas ou n'est pas typée : aucune v3 ne peut naître (premier rouge).
//  V3P-02 Une création sans attente de moteur, ou avec une attente fausse, réussit (v2 ou v3)
//         au lieu de lever CONTEXT_CHANGED sans rien écrire.
//  V3P-03 Une v3 créée ne porte pas les coefficients de la politique (1,30 / 1,20) ou garde une
//         marge, un coefficient global ou un palier v2.
//  V3P-04 Les colonnes v3 d'une ligne (unité, statut, heures par unité) sont ignorées ou perdues
//         par le lot ; h_mo n'est pas dérivé de Q × h/u.
//  V3P-05 Un PU, un brut, une TVA de ligne ou un total diffère d'un centime de l'oracle (§5.1, S1).
//  V3P-06 L'éditeur ne s'ouvre pas sur une v3 persistée (bandeau 2.1), ou l'ouvrir la réécrit
//         (réécrit en 2.6 : l'éditeur v3 s'ouvre, docs/testing/estimate-engine-v3-2.6.md §1.4).
//  V3P-07 Remise : une intention est dérivée de l'autre (discount_bp recalculé à côté du montant,
//         ou l'inverse), le montant appliqué est faux (S2, S3) ou ne suit pas le brut (EUHIST).
//  V3P-08 « Appliquer à toutes les lignes » ne change que la version, ou que certaines lignes.
//  V3P-09 Le gel d'approbation n'est pas un gel v3 (contexte, bruts figés, marque) ou la marque nette
//         lue par la règle et par la file d'approbation est 0, NULL ou fausse.
//  V3P-10 La duplication rend une v2, perd une colonne v3 ou change un montant.
//  V3P-11 Politique remise à 2 : la création suivante n'est pas une v2 aux valeurs de base de 2.0.
//  V3P-12 Une v3 existante change de moteur ou de montant quand la politique change.
// Revue du sous-lot (§10.5), sondes écrites rouges avant les correctifs :
//  V3P-13 Des coefficients de vente fournis à la création sont retirés en silence (v3) ou ignorés (v2).
//  V3P-14 Le hub d'affaire affiche pour une v3 la marge v2 (multiplicateur 1 → « 0.0 % »).
//  V3P-15 La suppression directe d'une ligne v3 laisse ses six montants stockés périmés.
//  V3P-16 Une ligne non chiffrée à un taux hors politique bloque le gel ; le lot ou le gel d'une copie
//         déplace un centime de ses lignes.
//  V3P-17 Le métré appliqué à une v3 n'est pas refusé par son nom (TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED).
// Revue Codex de la PR #33 (§10.6) : la suppression directe d'une ligne v3 hors contrat d'écrivain est refusée en SQL
// (pgTAP F25-25) ; ce que ce refus ne doit pas casser dans l'application :
//  V3P-18 Le lot ne supprime plus une ligne v3 (ou son pied ne suit pas les lignes restantes), ou la suppression
//         contrôlée d'une affaire brouillon qui porte des v3 chiffrées échoue ou laisse des versions ou des lignes.
const options = { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 300_000 } as const;
const BANNER = "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Created = { project: { id: string; tenant_id: string; user_id: string }; version: ArmyEstimate["version"] };
type Response<T> = { status: number; body: Envelope<T> };

const COMPLETE_SCHEMA: V3PersistenceSchema = {
  policyTable: true, policyEvents: true, policyWriter: true, freezeV3: true, pricingStatusType: true,
  missingVersionColumns: [], missingItemColumns: [],
};
const NEUTRAL_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal",
} as const;

// §5.1 : 40 €/h, k_fo = k_mo = maj = 1, c_FO 1,30, c_MO 1,20. Les PU, bruts et le déboursé sont
// ceux de la conception ; h_mo = arrondi(Q × h/u, 3) (D4).
const ORACLE = [
  { ref: "O1", unit: "ml", quantity: 20, prFo: 5466, hPerUnit: 1.991, hMo: 39.82, pu: 16663, gross: 333260 },
  { ref: "O2", unit: "u", quantity: 3, prFo: 9563, hPerUnit: 1.75, hMo: 5.25, pu: 20832, gross: 62496 },
  { ref: "O3", unit: "m2", quantity: 21, prFo: 5850, hPerUnit: 0, hMo: 0, pu: 7605, gross: 159705 },
  { ref: "O4", unit: "ml", quantity: 1139, prFo: 302, hPerUnit: 0.2, hMo: 227.8, pu: 1353, gross: 1541067 },
  { ref: "O5", unit: "u", quantity: 1, prFo: 2000, hPerUnit: 6, hMo: 6, pu: 31400, gross: 31400 },
  { ref: "O6", unit: "ml", quantity: 282, prFo: 9186, hPerUnit: 0.998, hMo: 281.436, pu: 16732, gross: 4718424 },
  { ref: "O7", unit: "ml", quantity: 8, prFo: 883, hPerUnit: 1.3, hMo: 10.4, pu: 7388, gross: 59104 },
] as const;
const GROSS = ORACLE.map(line => line.gross);
// Totaux S1 à S3 : §5.2. Répartitions par ligne (plus grand reste, D13) et état TVA 10 % :
// moteur pur 2.4 (computeEstimateV3Breakdown sur oracleInput), dont les totaux égalent §5.2.
const S1 = { totals: [6905456, 1381091, 8286547], nets: GROSS, taxes: [66652, 12499, 31941, 308213, 6280, 943685, 11821] };
const S2 = { totals: [6905355, 1381071, 8286426], nets: [333255, 62495, 159703, 1541044, 31400, 4718355, 59103], taxes: [66651, 12499, 31941, 308209, 6280, 943671, 11820] };
const S3 = { totals: [6214910, 1242982, 7457892], nets: [299934, 56246, 143735, 1386960, 28260, 4246581, 53194], taxes: [59987, 11249, 28747, 277392, 5652, 849316, 10639] };
const S3_VAT10 = { totals: [6214910, 621491, 6836401], nets: S3.nets, taxes: [29993, 5625, 14374, 138696, 2826, 424658, 5319] };
const FROZEN = {
  costSubtotalCents: 5487177, netMarginBp: 1171, realizedSaleCoefficient: 1.132624,
  grossFo: [142119, 37296, 159705, 447304, 2600, 3367547, 9183],
  netFo: [127907, 33566, 143735, 402574, 2340, 3030792, 8265],
  netMo: [172027, 22680, 0, 984386, 25920, 1215789, 44929],
};

const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const totals = (state: ArmyEstimate) => [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents];
const lineItems = (state: ArmyEstimate) => state.items.filter(item => item.item_type === "line").sort((a, b) => a.position - b.position);
const v3Version = (state: ArmyEstimate) => ({
  engine: state.version.calc_engine_version,
  saleCoefficients: [num(state.version.sale_coefficient_fo), num(state.version.sale_coefficient_mo)],
  margin: [state.version.margin_mode, num(state.version.margin_multiplier), num(state.version.global_coefficient)],
  discount: { mode: state.version.discount_mode, bp: state.version.discount_bp, amountCents: state.version.discount_amount_cents ?? null },
  gross: state.version.gross_ht_cents ?? null,
  applied: state.version.discount_applied_cents ?? null,
  commercialRounding: state.version.commercial_rounding_cents ?? null,
  roundingAdjustment: state.version.rounding_adjustment_cents ?? null,
  taxRateBp: state.version.tax_rate_bp,
  totals: totals(state),
});
const lineView = (item: ArmyItem) => ({
  unit: item.unit_code ?? null, status: item.pricing_status ?? null, quantity: num(item.quantity), prFo: item.unit_price_ht_cents,
  hPerUnit: num(item.h_mo_per_unit), hMo: num(item.h_mo), pu: item.pu_ht_cents, net: item.line_total_ht_cents,
  tax: item.line_tax_cents, ttc: item.line_total_ttc_cents, taxRateBp: item.tax_rate_bp,
});
const expectedLines = (state: { nets: readonly number[]; taxes: readonly number[] }, taxRateBp: number) => ORACLE.map((line, index) => ({
  unit: line.unit, status: "priced", quantity: line.quantity, prFo: line.prFo, hPerUnit: line.hPerUnit, hMo: line.hMo, pu: line.pu,
  net: state.nets[index], tax: state.taxes[index], ttc: state.nets[index] + state.taxes[index], taxRateBp,
}));
// updated_at is left out: approval projections may advance it without touching the content.
const stamp = (state: ArmyEstimate) => ({
  engine: state.version.calc_engine_version, contentRevision: state.version.content_revision,
  totals: totals(state), lines: lineItems(state).map(lineView),
});
const normalized = (text: string) => text.replace(/[\s  ]+/g, " ").trim();
const sameStamp = (left: ArmyEstimate, right: ArmyEstimate) => JSON.stringify(stamp(left)) === JSON.stringify(stamp(right));
// V3P-16 : ligne « pour mémoire » (non chiffrée) à 19,6 %, taux hors politique : PU nul, montants nuls (décision 3).
const FOR_MEMORY_LINE = {
  unit: "u", status: "for_memory", quantity: 1, prFo: 500, hPerUnit: 0, hMo: 0, pu: null, net: 0, tax: 0, ttc: 0, taxRateBp: 1960,
};
// Revue (§10.5) : relevées à leur place, assertées ensemble en fin de parcours, pour qu'une seule exécution
// rouge les montre toutes ; aucune ne modifie un attendu de V3P-01 à V3P-12.
const REVIEW_EXPECTED = {
  creationCoefficients: { response: [201, true], saleCoefficients: [1, 1.5] },
  hubMargin: { unavailable: true, percent: false, coefficient: false },
  copyFreeze: {
    batch: [200, true, true],
    linesAfterBatch: [...expectedLines(S3_VAT10, 1000), FOR_MEMORY_LINE],
    submitted: [201, true, null],
    fresh: true,
    totals: S3_VAT10.totals,
    frozenLines: [...expectedLines(S3_VAT10, 1000), FOR_MEMORY_LINE],
  },
  takeoff: { response: [409, "TAKEOFF_APPLY_ENGINE_V3_UNSUPPORTED"], unchanged: true },
  directDelete: { response: [409, false, "ESTIMATE_ENGINE_UNAVAILABLE"], unchanged: true },
  v2Coefficient: { response: [400, false, "ESTIMATE_ENGINE_COLUMN_NOT_SUPPORTED"], created: 0 },
  batchDelete: { response: [200, true, true], lines: 0, totals: [0, 0, 0], footer: [0, 0, 0] },
  affaireDelete: { response: [200, true, true], itemsBefore: true, versions: 0, items: 0 },
};

function assertOwnedLocalBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    !process.env.E2E_ARMY_LOCAL_DB_URL) {
    throw new Error("engine-v3-persistence requires the owned local Supabase stack and its SQL route.");
  }
}

async function createVersion(browser: Browser, body: Record<string, unknown>): Promise<Response<Created>> {
  return apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", body);
}

async function lockVersion(browser: Browser, versionId: string) {
  const lock = await apiRequest(browser, "POST", `/api/estimates/${versionId}/lock`);
  expect(lock.status).toBe(201);
}

/** One section, then the lines by one committed batch, under the editor lease of this page. */
async function writeLinesByBatch(browser: Browser, army: ArmyState, versionId: string, label: string, lines: Array<Record<string, unknown>>) {
  await lockVersion(browser, versionId);
  const empty = await readEstimate(browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: `${label} lot` }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const before = await readEstimate(browser, versionId);
  const request = {
    operation_key: randomUUID(),
    operations: lines.map((line, index) => ({ op: "create", data: { item_type: "line", parent_id: section.body.data.item.id, position: index + 1, ...line } })),
  };
  const response = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string; code?: string }> }>>(
    browser, "POST", `/api/estimates/${versionId}/batch`, request, { "if-match": before.version.updated_at });
  await recordEvidence(army, `v3p-batch-${label}`, { versionId, request, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  expect(response.body.data.results.filter(result => result.status === "error")).toEqual([]);
  return readEstimate(browser, versionId);
}

/**
 * A navigation (app.open) discards the page's in-memory lease identity; only a reload restores it. The
 * draft lease taken by an earlier document of this tab is retaken for the current one, as the editor
 * does, before a settings save (§10.2).
 */
async function retakeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect(lease.status).toBe(200);
}

/**
 * D13 breaks every tie of an exact allocation (VAT, discount and FO/MO shares) by increasing line id, and the
 * per-line expectations above come from the pure engine on the fixture ids, which ascend from O1 to O7. The
 * batch draws random ids, so a tie may go to another line from one run to the next (§10.2, C6). One batch
 * relabels the lines: the k-th smallest id takes O_k's inputs, then a reorder puts it k-th. Totals never
 * depend on it.
 */
async function alignWithFixtureIdOrder(browser: Browser, army: ArmyState, versionId: string, lines: ReadonlyArray<Record<string, unknown>>) {
  const state = await readEstimate(browser, versionId);
  const stored = lineItems(state);
  const ids = stored.map(item => item.id).sort();
  if (stored.every((item, index) => item.id === ids[index])) return state;
  const request = {
    operation_key: randomUUID(),
    operations: [
      ...ids.map((id, index) => {
        const { line_nature, title, description, unit_code, quantity, unit_price_ht_cents, h_mo_per_unit } = lines[index];
        return { op: "update", id, data: { line_nature, title, description, unit_code, quantity, unit_price_ht_cents, h_mo_per_unit } };
      }),
      { op: "reorder", data: { parent_id: stored[0].parent_id, ordered_ids: ids } },
    ],
  };
  const response = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string; code?: string }> }>>(
    browser, "POST", `/api/estimates/${versionId}/batch`, request, { "if-match": state.version.updated_at });
  await recordEvidence(army, "v3p-batch-oracle-id-order", { versionId, idsByPosition: stored.map(item => item.id), request, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  expect(response.body.data.results.filter(result => result.status === "error")).toEqual([]);
  return readEstimate(browser, versionId);
}

async function saveSettings(browser: Browser, army: ArmyState, versionId: string, label: string, patch: Record<string, unknown>) {
  await retakeLease(browser, versionId);
  const before = await readEstimate(browser, versionId);
  const response = await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${versionId}`,
    { ...patch, expected_content_revision: before.version.content_revision }, { "if-match": before.version.updated_at });
  const after = await readEstimate(browser, versionId);
  await recordEvidence(army, `v3p-settings-${label}`, { versionId, patch, response, before: v3Version(before), after: v3Version(after), lines: lineItems(after).map(lineView) });
  expect([response.status, response.body.ok]).toEqual([200, true]);
  expect(Number(after.version.content_revision)).toBeGreaterThan(Number(before.version.content_revision));
  return after;
}

async function ensureTuyauteur(browser: Browser, army: ArmyState, versionId: string) {
  const details = await apiRequest<Envelope<{ labor_roles: Array<{ id: string; name: string; hourly_rate_cents: number; is_active: boolean }> }>>(
    browser, "GET", `/api/estimates/${versionId}`);
  expect(details.status).toBe(200);
  const existing = details.body.data.labor_roles.find(role => role.name === "Tuyauteur");
  if (existing) {
    expect([existing.hourly_rate_cents, existing.is_active]).toEqual([4000, true]);
    return existing;
  }
  await lockVersion(browser, versionId);
  const created = await apiRequest<Envelope<{ labor_role: { id: string; name: string; hourly_rate_cents: number; is_active: boolean } }>>(
    browser, "POST", `/api/estimates/${versionId}/labor-roles`, { name: "Tuyauteur", hourly_rate_cents: 4000 });
  await recordEvidence(army, "v3p-labor-role", { versionId, response: created });
  expect([created.status, created.body.ok, created.body.data.labor_role.hourly_rate_cents]).toEqual([201, true, 4000]);
  return created.body.data.labor_role;
}

/**
 * The critical browser guard aborts every POST …/approve, by design. This single probe goes
 * from the journey process to the owned app, for the owned v3 only, while the runner leaves
 * the provider key empty: the review-request notification cannot leave the machine.
 */
async function submitForReviewFromJourneyProcess(app: App, browser: Browser, versionId: string, ruleId: string, message: string) {
  if (process.env.RESEND_API_KEY !== "") throw new Error("The v3 approval probe requires the empty provider key of the owned runner.");
  const origin = new URL(app.baseUrl!).origin;
  if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("The v3 approval probe targets the owned loopback app only.");
  const cookie = (await browser.cookies())
    .filter(entry => !entry.domain || entry.domain === "localhost" || entry.domain === ".localhost")
    .map(entry => `${entry.name}=${entry.value}`).join("; ");
  const response = await fetch(`${origin}/api/estimates/${versionId}/approve`, {
    method: "POST", redirect: "manual",
    headers: { cookie, origin, "content-type": "application/json", "x-estimate-draft-lock-session-id": randomUUID() },
    body: JSON.stringify({ action: "submit_for_review", rule_ids: [ruleId], submission_message: message }),
  });
  let body: Envelope<unknown> | { invalidJson: true };
  try { body = await response.json() as Envelope<unknown>; } catch { body = { invalidJson: true }; }
  return { status: response.status, body };
}

async function visibleRowText(browser: Browser, selector: { href?: string; heading?: string }) {
  return browser.evaluate((input) => {
    if (input.href) {
      // The row (hub version list item or table row) that holds a link to the version.
      const row = Array.from(document.querySelectorAll(`a[href="${input.href}"]`)).map(link => link.closest("li, tr")).find(Boolean);
      return row?.textContent ?? null;
    }
    const article = Array.from(document.querySelectorAll("article"))
      .find(node => node.querySelector("h2")?.textContent?.trim() === input.heading);
    return article?.textContent ?? null;
  }, selector);
}

armyTest("V3P01 a v3 born behind the tenant policy persists the oracle, its settings, its freeze, its approval margin and its duplicate", options, async ({ app, screen, browser, army }) => {
  assertOwnedLocalBackend();
  // The policy window must not reach the concurrent journeys of the shared campaign tenant (§9.5).
  const dedicated = await useDedicatedV3Owner(browser, app.baseUrl!, army.runPrefix);
  await app.open("/dashboard/affaires");
  const projectName = `ARMY-L2-V3-${army.runPrefix}`;

  // Préparation, sans dépendance à M4 : affaire et ancre v2 par l'API, rôle « Tuyauteur » 40 €/h.
  const anchorCreated = await createVersion(browser, { project: { name: projectName }, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ancre v2` } });
  expect([anchorCreated.status, anchorCreated.body.ok, anchorCreated.body.data.version.calc_engine_version]).toEqual([201, true, 2]);
  const projectId = anchorCreated.body.data.project.id;
  const anchorId = anchorCreated.body.data.version.id;
  ownEstimate(army, { projectId, versionId: anchorId });
  const context = await ownedEstimateContext(projectId);
  const owner: V3Owner = { tenantId: context.tenantId, userId: context.userId };
  if (owner.tenantId !== dedicated.tenantId || owner.userId !== dedicated.userId) throw new Error("V3P01 must run as its dedicated owner.");
  const tuyauteur = await ensureTuyauteur(browser, army, anchorId);
  const anchorBefore = await readEstimate(browser, anchorId);

  // V3P-01 : ce que M4 doit avoir créé. Avant M4, c'est le premier rouge, nommé.
  const schema = await probeV3PersistenceSchema();
  const policyBefore = schema.policyTable ? await readTenantCalcPolicy(owner) : null;
  await recordEvidence(army, "v3p-schema", { projectId, owner, tuyauteur, expected: COMPLETE_SCHEMA, actual: schema, policyBefore });
  expect(schema).toEqual(COMPLETE_SCHEMA);
  expect(policyBefore?.engine ?? 2).toBe(2);

  // V3P-02, V3P-03 : fenêtre de politique 3 aussi courte que possible (l'entreprise de recette est
  // partagée par les parcours concurrents) ; elle est refermée même si une création échoue.
  const reason = `${army.runPrefix} recette 2.5 moteur 3`;
  let policyOpened = false;
  let policy3: Awaited<ReturnType<typeof setTenantCalcPolicy>> | null = null;
  let policy2: Awaited<ReturnType<typeof setTenantCalcPolicy>> | null = null;
  let unexpected: Response<Created> | null = null;
  let oracleCreated: Response<Created> | null = null;
  let euhistCreated: Response<Created> | null = null;
  let suppliedCreated: Response<Created> | null = null;
  let countAroundUnexpected: [number, number] = [0, 0];
  const review: Record<keyof typeof REVIEW_EXPECTED, unknown> = {
    creationCoefficients: null, hubMargin: null, copyFreeze: null, takeoff: null, directDelete: null, v2Coefficient: null,
    batchDelete: null, affaireDelete: null,
  };
  try {
    policy3 = await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason });
    policyOpened = true;
    const countBefore = await versionCountOf(projectId);
    unexpected = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} sans attente` } });
    countAroundUnexpected = [countBefore, await versionCountOf(projectId)];
    // V3P-13 : des coefficients fournis à la création sont repris (§1.3), jamais remplacés par la politique.
    suppliedCreated = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} coefficients fournis`,
      expected_calc_engine_version: 3, sale_coefficient_fo: 1, sale_coefficient_mo: 1.5 } });
    // EUHIST first: the oracle is then the affaire's current (highest-numbered) version, whose lines
    // make the hub show its version list for the on-screen reading below (§10.2).
    euhistCreated = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} EUHIST v3`, expected_calc_engine_version: 3 } });
    oracleCreated = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} oracle v3`, expected_calc_engine_version: 3 } });
  } finally {
    if (policyOpened) policy2 = await setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${reason} fin` });
  }
  await recordEvidence(army, "v3p-policy-window", { policy3, policy2, unexpected, countAroundUnexpected, oracleCreated, euhistCreated, suppliedCreated });
  const suppliedId = suppliedCreated?.body.data?.version?.id ?? null;
  if (suppliedId) ownEstimate(army, { projectId, versionId: suppliedId });
  review.creationCoefficients = {
    response: [suppliedCreated?.status ?? null, suppliedCreated?.body.ok ?? null],
    saleCoefficients: suppliedId ? v3Version(await readEstimate(browser, suppliedId)).saleCoefficients : null,
  };
  expect(policy3).toMatchObject({ engine: 3, fo: 1.3, mo: 1.2, allowedTaxRatesBp: [2000, 1000, 550, 210] });
  expect(policy2?.engine).toBe(2);
  expect(policy2!.events - policy3!.events).toBe(1);
  expect([unexpected?.status, unexpected?.body.ok, unexpected?.body.error?.code]).toEqual([409, false, "CONTEXT_CHANGED"]);
  expect(countAroundUnexpected[1]).toBe(countAroundUnexpected[0]);
  for (const created of [oracleCreated, euhistCreated]) expect([created?.status, created?.body.ok]).toEqual([201, true]);
  const oracleId = oracleCreated!.body.data.version.id;
  const euhistId = euhistCreated!.body.data.version.id;
  ownEstimate(army, { projectId, versionId: oracleId });
  ownEstimate(army, { projectId, versionId: euhistId });
  const emptyV3 = {
    engine: 3, saleCoefficients: [1.3, 1.2], margin: ["fixed", 1, 1], discount: { mode: "simple", bp: 0, amountCents: null },
    gross: 0, applied: 0, commercialRounding: 0, roundingAdjustment: 0, taxRateBp: 2000, totals: [0, 0, 0],
  };
  expect(v3Version(await readEstimate(browser, oracleId))).toEqual(emptyV3);
  expect(v3Version(await readEstimate(browser, euhistId))).toEqual(emptyV3);

  // V3P-04, V3P-05 : les 7 lignes-oracle par lot, puis relecture (S1).
  const oracleLines = ORACLE.map(line => ({
    line_nature: line.hPerUnit > 0 ? "supply_and_labor" : "supply_only", title: `${army.runPrefix} ${line.ref}`, description: line.unit,
    unit_code: line.unit, pricing_status: "priced", quantity: line.quantity, unit_price_ht_cents: line.prFo, tax_rate_bp: 2000,
    k_fo: 1, h_mo_per_unit: line.hPerUnit, h_mo_majoration: 1, k_mo: 1, labor_role_id: tuyauteur.id, source_provider: "manual",
  }));
  const created = await writeLinesByBatch(browser, army, oracleId, "oracle", oracleLines);
  // V3P-04 sur l'état du lot de création lui-même, ligne par ligne par titre, avant tout réétiquetage (§10.2, C6 ;
  // revue §10.5) : unité, statut, Q, PR, h/u, h_mo dérivé, PU, taux et, en S1 sans remise, net = brut. Seule la
  // TVA par ligne dépend de l'ordre des id (D13) ; elle est assertée après le réétiquetage.
  const createdByTitle = ORACLE.map((line) => {
    const item = lineItems(created).find(candidate => candidate.title === `${army.runPrefix} ${line.ref}`);
    if (!item) return null;
    const { unit, status, quantity, prFo, hPerUnit, hMo, pu, net, taxRateBp } = lineView(item);
    return { unit, status, quantity, prFo, hPerUnit, hMo, pu, net, taxRateBp };
  });
  const createdExpected = ORACLE.map(line => ({
    unit: line.unit, status: "priced", quantity: line.quantity, prFo: line.prFo, hPerUnit: line.hPerUnit, hMo: line.hMo, pu: line.pu,
    net: line.gross, taxRateBp: 2000,
  }));
  await recordEvidence(army, "v3p-batch-oracle-created", { versionId: oracleId, expected: createdExpected, actual: createdByTitle });
  expect(createdByTitle).toEqual(createdExpected);
  const s1 = await alignWithFixtureIdOrder(browser, army, oracleId, oracleLines);
  await recordEvidence(army, "v3p-s1", { versionId: oracleId, expected: { version: { ...emptyV3, gross: 6905456, totals: S1.totals }, lines: expectedLines(S1, 2000) },
    actual: { version: v3Version(s1), lines: lineItems(s1).map(lineView) } });
  expect(lineItems(s1).map(lineView)).toEqual(expectedLines(S1, 2000));
  expect(v3Version(s1)).toEqual({ ...emptyV3, gross: 6905456, totals: S1.totals });

  // V3P-06, réécrit en 2.6 (doc 2.6 §1.4, F26-15) : l'éditeur v3 s'ouvre sur la v3 persistée, sans le
  // bandeau du moteur 3 de 2.1, et l'ouvrir ne la réécrit pas (ni normalisation v2, ni total client).
  // Le bail de brouillon pris par l'API de ce document est rendu d'abord : l'éditeur ouvert par une
  // navigation est une autre session de page (useDraftLock) et resterait « Verrouillé par vous dans un
  // autre onglet ». Les écritures suivantes le reprennent (`retakeLease`).
  const release = await apiRequest(browser, "DELETE", `/api/estimates/${oracleId}/lock`);
  expect(release.status).toBe(200);
  await app.open(`/dashboard/estimates/${oracleId}/edit`);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/, { timeout: 30_000 });
  const editorBanner = await browser.evaluate((banner) => (document.body.textContent ?? "").includes(banner), BANNER);
  const afterEditor = await readEstimate(browser, oracleId);
  await recordEvidence(army, "v3p-editor-open", { versionId: oracleId, editorBanner, expected: stamp(s1), actual: stamp(afterEditor) });
  expect(editorBanner, "the v3 editor opens instead of the 2.1 banner").toBe(false);
  expect(stamp(afterEditor)).toEqual(stamp(s1));

  // Lecture à l'écran (2.5) : la liste des versions de l'affaire affiche le HT stocké de la v3
  // (/dashboard/estimates redirige vers /dashboard/affaires depuis next.config.ts, §10.2).
  await app.open(`/dashboard/affaires/${projectId}`);
  await expect.poll(async () => normalized(await visibleRowText(browser, { href: `/dashboard/estimates/${oracleId}/edit` }) ?? ""), { timeout: 30_000 })
    .toContain("69 054,56 €");
  // V3P-14 : la marge du résumé financier d'une v3 n'est jamais la marge v2 (multiplicateur 1 → « 0.0 % »).
  const hubMarginText = normalized(await browser.evaluate(() => {
    const label = Array.from(document.querySelectorAll("#financial p")).find(node => node.textContent?.trim() === "Marge appliquée");
    return label?.parentElement?.textContent ?? "";
  }));
  await recordEvidence(army, "v3p-hub-margin", { projectId, versionId: oracleId, actual: hubMarginText });
  review.hubMargin = {
    unavailable: hubMarginText.includes("Indisponible"), percent: /\d %/.test(hubMarginText), coefficient: hubMarginText.includes("Coeff."),
  };

  // V3P-07 : S2 (montant), S3 (taux), sans intention dérivée.
  const s2 = await saveSettings(browser, army, oracleId, "s2", { discount_amount_cents: 101, discount_bp: 0 });
  expect(v3Version(s2)).toEqual({ ...emptyV3, discount: { mode: "simple", bp: 0, amountCents: 101 }, gross: 6905456, applied: 101, totals: S2.totals });
  expect(lineItems(s2).map(lineView)).toEqual(expectedLines(S2, 2000));
  const s3 = await saveSettings(browser, army, oracleId, "s3", { discount_amount_cents: null, discount_bp: 1000 });
  expect(v3Version(s3)).toEqual({ ...emptyV3, discount: { mode: "simple", bp: 1000, amountCents: null }, gross: 6905456, applied: 690546, totals: S3.totals });
  expect(lineItems(s3).map(lineView)).toEqual(expectedLines(S3, 2000));

  // V3P-08 : TVA 10 % appliquée à toutes les lignes, dans la même sauvegarde.
  const vat10 = await saveSettings(browser, army, oracleId, "vat10", { tax_rate_bp: 1000, apply_tax_rate_to_lines: true });
  expect(v3Version(vat10)).toEqual({ ...emptyV3, discount: { mode: "simple", bp: 1000, amountCents: null }, gross: 6905456, applied: 690546, taxRateBp: 1000, totals: S3_VAT10.totals });
  expect(lineItems(vat10).map(lineView)).toEqual(expectedLines(S3_VAT10, 1000));

  // V3P-07 (EUHIST) : PR 200 c, 10 %, c_FO de 1 à 2 ; la remise suit le brut, discount_bp reste 1 000.
  const euhistLines = await writeLinesByBatch(browser, army, euhistId, "euhist", [{
    line_nature: "supply_only", title: `${army.runPrefix} EUHIST`, description: "u", unit_code: "u", pricing_status: "priced",
    quantity: 1, unit_price_ht_cents: 200, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual",
  }]);
  expect(lineItems(euhistLines).map(item => [item.pu_ht_cents, item.line_total_ht_cents])).toEqual([[260, 260]]);
  const euhistAt1 = await saveSettings(browser, army, euhistId, "euhist-c1", { sale_coefficient_fo: 1, discount_bp: 1000 });
  expect(v3Version(euhistAt1)).toEqual({ ...emptyV3, saleCoefficients: [1, 1.2], discount: { mode: "simple", bp: 1000, amountCents: null }, gross: 200, applied: 20, totals: [180, 36, 216] });
  const euhistAt2 = await saveSettings(browser, army, euhistId, "euhist-c2", { sale_coefficient_fo: 2 });
  expect(v3Version(euhistAt2)).toEqual({ ...emptyV3, saleCoefficients: [2, 1.2], discount: { mode: "simple", bp: 1000, amountCents: null }, gross: 400, applied: 40, totals: [360, 72, 432] });
  expect(lineItems(euhistAt2).map(item => [item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents])).toEqual([[400, 360, 72]]);

  // V3P-09 : gel d'approbation v3, marque nette de la règle, puis file d'approbation à l'écran.
  const ruleId = await insertProjectMarginRule(owner, projectId, 1500);
  const summary = await apiRequest<Envelope<{ reasons: Array<Record<string, unknown>> }>>(browser, "GET", `/api/estimates/${oracleId}/approval`);
  const marginReason = summary.body.data?.reasons?.find(reason => reason.ruleId === ruleId) ?? null;
  await recordEvidence(army, "v3p-approval-summary", { versionId: oracleId, ruleId, response: summary, expected: { actualValue: FROZEN.netMarginBp, thresholdValue: 1500, sourceState: "ready" } });
  expect(summary.status).toBe(200);
  expect(marginReason).toMatchObject({ actualValue: FROZEN.netMarginBp, thresholdValue: 1500, sourceState: "ready", approvalStatus: "missing" });
  const submitted = await submitForReviewFromJourneyProcess(app, browser, oracleId, ruleId, `${army.runPrefix} gel v3`);
  const frozen = await readEstimate(browser, oracleId);
  const frozenLines = lineItems(frozen);
  await recordEvidence(army, "v3p-freeze", {
    versionId: oracleId, submitted,
    actual: { version: v3Version(frozen), approvalStatus: frozen.version.approval_status, contentRevision: frozen.version.content_revision,
      snapshotRevision: frozen.version.calc_snapshot_content_revision, context: frozen.version.calc_snapshot_context,
      lines: frozenLines.map(item => [item.snapshot_pu_ht_cents, item.snapshot_gross_ht_cents, item.snapshot_gross_fo_ht_cents, item.snapshot_fo_ht_cents, item.snapshot_mo_ht_cents]) },
  });
  // A review submission answers 201 (approve route since e3af04ee, OpenAPI 200/201): the red probe said 200 (§10.2).
  expect([submitted.status, (submitted.body as Envelope<unknown>).ok]).toEqual([201, true]);
  expect(v3Version(frozen)).toEqual(v3Version(vat10));
  expect(frozen.version.approval_status).toBe("in_review");
  expect(Number(frozen.version.calc_snapshot_content_revision)).toBe(Number(frozen.version.content_revision));
  expect(frozen.version.calc_snapshot_context).toMatchObject({
    engine: 3, sale_coefficients: { fo: 1.3, mo: 1.2 },
    discount: { kind: "rate", requested_cents: null, rate_bp: 1000, base_cents: 6905456, applied_cents: 690546 },
    commercial_rounding: { mode: "none", step_cents: 1, applied_cents: 0 },
    cost_subtotal_cents: FROZEN.costSubtotalCents, realized_sale_coefficient: FROZEN.realizedSaleCoefficient,
    tax_breakdown: [{ rate_bp: 1000, base_cents: 6214910, tax_cents: 621491 }],
  });
  expect(frozen.version.calc_snapshot_context).not.toHaveProperty("effective_margin_multiplier");
  expect(frozenLines.map(item => [item.snapshot_pu_ht_cents, item.snapshot_gross_ht_cents, item.snapshot_gross_fo_ht_cents, item.snapshot_fo_ht_cents, item.snapshot_mo_ht_cents]))
    .toEqual(ORACLE.map((line, index) => [line.pu, line.gross, FROZEN.grossFo[index], FROZEN.netFo[index], FROZEN.netMo[index]]));
  await app.open("/dashboard/approvals");
  await expect.poll(async () => normalized(await visibleRowText(browser, { heading: projectName }) ?? ""), { timeout: 30_000 })
    .toContain("62 149,10 € HT");
  const card = normalized(await visibleRowText(browser, { heading: projectName }) ?? "");
  await recordEvidence(army, "v3p-approval-queue", { projectName, expected: ["62 149,10 € HT", "Marge 11.7 %"], actual: card });
  expect(card).toContain("Marge 11.7 %");

  // V3P-10 : duplication sous politique 2 : la copie reste une v3, aux mêmes colonnes et montants.
  const duplicated = await apiRequest<Envelope<{ version_id: string }>>(browser, "POST", `/api/estimates/${oracleId}/duplicate`);
  expect([duplicated.status, duplicated.body.ok]).toEqual([201, true]);
  const copyId = duplicated.body.data.version_id;
  ownEstimate(army, { projectId, versionId: copyId });
  const copy = await readEstimate(browser, copyId);
  await recordEvidence(army, "v3p-duplicate", { sourceVersionId: oracleId, copyId, expected: { version: v3Version(vat10), lines: expectedLines(S3_VAT10, 1000) },
    actual: { status: copy.version.status, version: v3Version(copy), lines: lineItems(copy).map(lineView) } });
  expect(copy.version.status).toBe("draft");
  expect(v3Version(copy)).toEqual(v3Version(vat10));
  expect(lineItems(copy).map(lineView)).toEqual(expectedLines(S3_VAT10, 1000));

  // V3P-11 : politique à 2 ; une attente 3 est refusée, la création suivante est une v2 de base.
  const countBeforeStale = await versionCountOf(projectId);
  const staleExpectation = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} attente 3 périmée`, expected_calc_engine_version: 3 } });
  const countAfterStale = await versionCountOf(projectId);
  const v2Created = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} v2 après politique 2` } });
  await recordEvidence(army, "v3p-policy-2", { staleExpectation, counts: [countBeforeStale, countAfterStale], v2Created });
  expect([staleExpectation.status, staleExpectation.body.ok, staleExpectation.body.error?.code]).toEqual([409, false, "CONTEXT_CHANGED"]);
  expect(countAfterStale).toBe(countBeforeStale);
  expect([v2Created.status, v2Created.body.ok]).toEqual([201, true]);
  const v2Id = v2Created.body.data.version.id;
  ownEstimate(army, { projectId, versionId: v2Id });
  await lockVersion(browser, v2Id);
  const v2Empty = await readEstimate(browser, v2Id);
  const v2Section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${v2Id}/items`,
    { item_type: "section", position: 1, title: `${army.runPrefix} lot v2` }, { "if-match": v2Empty.version.updated_at });
  expect(v2Section.status).toBe(201);
  const v2Ready = await readEstimate(browser, v2Id);
  const v2Line = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${v2Id}/items`, {
    item_type: "line", line_nature: "supply_only", parent_id: v2Section.body.data.item.id, position: 1, title: `${army.runPrefix} base 2.0`,
    description: "u", quantity: 1, unit_price_ht_cents: 2000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual",
  }, { "if-match": v2Ready.version.updated_at });
  expect(v2Line.status).toBe(201);
  const v2 = await readEstimate(browser, v2Id);
  const v2View = { ...v3Version(v2), lines: lineItems(v2).map(lineView) };
  await recordEvidence(army, "v3p-v2-baseline", { versionId: v2Id, actual: v2View });
  expect(v2View).toEqual({
    engine: 2, saleCoefficients: [null, null], margin: ["fixed", 1, 1], discount: { mode: "simple", bp: 0, amountCents: null },
    gross: null, applied: null, commercialRounding: null, roundingAdjustment: 0, taxRateBp: 2000, totals: [2000, 400, 2400],
    lines: [{ unit: null, status: "priced", quantity: 1, prFo: 2000, hPerUnit: null, hMo: 0, pu: 2000, net: 2000, tax: 400, ttc: 2400, taxRateBp: 2000 }],
  });

  // V3P-12 : les versions existantes gardent leur moteur et leurs montants.
  const finals = {
    anchor: stamp(await readEstimate(browser, anchorId)), oracle: stamp(await readEstimate(browser, oracleId)),
    euhist: stamp(await readEstimate(browser, euhistId)), copy: stamp(await readEstimate(browser, copyId)),
  };
  await recordEvidence(army, "v3p-final", { expected: { anchor: stamp(anchorBefore), oracle: stamp(frozen), euhist: stamp(euhistAt2), copy: stamp(copy) }, actual: finals });
  expect(finals).toEqual({ anchor: stamp(anchorBefore), oracle: stamp(frozen), euhist: stamp(euhistAt2), copy: stamp(copy) });

  // V3P-16 : sur la copie (brouillon v3), une ligne « pour mémoire » à 19,6 % par lot, puis le gel d'approbation.
  // Seules les lignes chiffrées sont contrôlées au gel (comme le SQL) ; ni le lot ni le gel ne déplacent un centime.
  await lockVersion(browser, copyId);
  const copyBefore = await readEstimate(browser, copyId);
  const copyLines = lineItems(copyBefore);
  const memoRequest = {
    operation_key: randomUUID(),
    operations: [{ op: "create", data: {
      item_type: "line", parent_id: copyLines[0].parent_id, position: copyLines.length + 1, line_nature: "supply_only",
      title: `${army.runPrefix} pour mémoire`, description: "u", unit_code: "u", pricing_status: "for_memory", quantity: 1,
      unit_price_ht_cents: 500, tax_rate_bp: 1960, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual",
    } }],
  };
  const memoBatch = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${copyId}/batch`, memoRequest,
    { "if-match": copyBefore.version.updated_at });
  const copyWithMemo = await readEstimate(browser, copyId);
  const copySubmitted = await submitForReviewFromJourneyProcess(app, browser, copyId, ruleId, `${army.runPrefix} gel de la copie`);
  const copyFrozen = await readEstimate(browser, copyId);
  const copyEnvelope = copySubmitted.body as Partial<Envelope<unknown>>;
  review.copyFreeze = {
    batch: [memoBatch.status, memoBatch.body.ok, memoBatch.body.data?.committed ?? null],
    linesAfterBatch: lineItems(copyWithMemo).map(lineView),
    submitted: [copySubmitted.status, copyEnvelope.ok ?? null, copyEnvelope.error?.code ?? null],
    fresh: Number(copyFrozen.version.calc_snapshot_content_revision) === Number(copyFrozen.version.content_revision),
    totals: totals(copyFrozen),
    frozenLines: lineItems(copyFrozen).map(lineView),
  };
  await recordEvidence(army, "v3p-copy-freeze", { copyId, memoRequest, memoBatch, copySubmitted, actual: review.copyFreeze,
    context: copyFrozen.version.calc_snapshot_context });

  // V3P-17 : le métré sur une v3 est refusé par son nom, avant tout calcul, et n'écrit rien (EUHIST).
  await retakeLease(browser, euhistId);
  const euhistBeforeProbes = await readEstimate(browser, euhistId);
  const takeoffJobId = await insertCompletedTakeoffJob(owner, euhistId);
  const takeoff = await apiRequest<{ ok?: boolean; error?: { code?: string } }>(browser, "POST", `/api/takeoff/jobs/${takeoffJobId}/apply`,
    { strategy: "append" });
  const euhistAfterTakeoff = await readEstimate(browser, euhistId);
  review.takeoff = { response: [takeoff.status, takeoff.body.error?.code ?? null], unchanged: sameStamp(euhistAfterTakeoff, euhistBeforeProbes) };
  await recordEvidence(army, "v3p-takeoff", { versionId: euhistId, takeoffJobId, response: takeoff, actual: review.takeoff });

  // V3P-15 : la suppression directe d'une ligne v3 (DELETE …/items) ne recalcule rien : refus nommé, rien d'écrit.
  const euhistBeforeDelete = await readEstimate(browser, euhistId);
  const deleted = await apiRequest<Envelope<unknown>>(browser, "DELETE", `/api/estimates/${euhistId}/items`,
    { id: lineItems(euhistBeforeDelete)[0].id }, { "if-match": euhistBeforeDelete.version.updated_at });
  const euhistAfterDelete = await readEstimate(browser, euhistId);
  review.directDelete = {
    response: [deleted.status, deleted.body.ok, deleted.body.error?.code ?? null], unchanged: sameStamp(euhistAfterDelete, euhistBeforeDelete),
  };
  await recordEvidence(army, "v3p-direct-delete", { versionId: euhistId, response: deleted, before: stamp(euhistBeforeDelete),
    after: stamp(euhistAfterDelete) });

  // V3P-13 (v2) : sous politique 2, un coefficient de vente à la création est refusé par son nom, rien n'est créé.
  const countBeforeV2Coefficient = await versionCountOf(projectId);
  const v2Coefficient = await createVersion(browser, { project_id: projectId, version: { ...NEUTRAL_VERSION,
    title: `${army.runPrefix} v2 avec coefficient`, sale_coefficient_fo: 1 } });
  const v2CoefficientId = v2Coefficient.body.data?.version?.id;
  if (v2CoefficientId) ownEstimate(army, { projectId, versionId: v2CoefficientId });
  review.v2Coefficient = {
    response: [v2Coefficient.status, v2Coefficient.body.ok, v2Coefficient.body.error?.code ?? null],
    created: (await versionCountOf(projectId)) - countBeforeV2Coefficient,
  };

  // V3P-18 : une ligne v3 se supprime par le lot (contrat d'écrivain), qui recalcule : EUHIST sans ligne a un pied nul.
  await retakeLease(browser, euhistId);
  const euhistBeforeBatchDelete = await readEstimate(browser, euhistId);
  const batchDeleteRequest = {
    operation_key: randomUUID(),
    operations: lineItems(euhistBeforeBatchDelete).map(line => ({ op: "delete", id: line.id })),
  };
  const batchDelete = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${euhistId}/batch`,
    batchDeleteRequest, { "if-match": euhistBeforeBatchDelete.version.updated_at });
  const euhistAfterBatchDelete = await readEstimate(browser, euhistId);
  review.batchDelete = {
    response: [batchDelete.status, batchDelete.body.ok, batchDelete.body.data?.committed ?? null],
    lines: lineItems(euhistAfterBatchDelete).length,
    totals: totals(euhistAfterBatchDelete),
    footer: [euhistAfterBatchDelete.version.gross_ht_cents ?? null, euhistAfterBatchDelete.version.discount_applied_cents ?? null,
      euhistAfterBatchDelete.version.commercial_rounding_cents ?? null],
  };
  await recordEvidence(army, "v3p-batch-delete", { versionId: euhistId, request: batchDeleteRequest, response: batchDelete,
    before: stamp(euhistBeforeBatchDelete), after: stamp(euhistAfterBatchDelete) });

  // V3P-18 : l'affaire brouillon (v2, v3 chiffrées, copie v3 en revue) se supprime par son chemin contrôlé, cascades comprises.
  const projectVersionIds = await versionIdsOf(projectId);
  const itemsBeforeAffaireDelete = await itemCountOfVersions(projectVersionIds);
  const affaireDelete = await apiRequest<Envelope<{ deleted: boolean }>>(browser, "DELETE", `/api/affaires/${projectId}`);
  review.affaireDelete = {
    response: [affaireDelete.status, affaireDelete.body.ok, affaireDelete.body.data?.deleted ?? null],
    itemsBefore: itemsBeforeAffaireDelete > 0,
    versions: await versionCountOf(projectId),
    items: await itemCountOfVersions(projectVersionIds),
  };
  await recordEvidence(army, "v3p-affaire-delete", { projectId, versionIds: projectVersionIds, itemsBefore: itemsBeforeAffaireDelete,
    response: affaireDelete, actual: review.affaireDelete });
  await recordEvidence(army, "v3p-review", { expected: REVIEW_EXPECTED, actual: review, v2Coefficient });
  expect(review).toEqual(REVIEW_EXPECTED);
});
