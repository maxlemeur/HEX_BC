import { createHash, randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";
import ExcelJS from "exceljs";
import { expect, type App, type Screen } from "e2e";

import { extractPdfText } from "../../../scripts/tester-army/pdf-text";
import { apiRequest, ownEstimate, readEstimate, type ArmyEstimate, type ArmyItem, type ArmyState } from "../critical/fixtures";

// Lot 2, sous-lot 2.7 : aides du parcours engine-v3-emission (docs/testing/estimate-engine-v3-2.7.md).
// Le devis v3 est créé et réglé par l'API de 2.5 (création, lot, réglages), jamais par la grille de
// 2.6 ; l'émission passe par les routes que l'interface appelle (PDF, envoi, vérification, exports).
// Aucune assertion ne lit un montant recalculé ici : les attendus sont les valeurs du §5 de la
// conception, au centime, et le texte est comparé après normalisation des seuls espaces.

export type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: unknown } };
export type Evidence = (label: string, data: unknown) => Promise<unknown>;
type Created = { project: { id: string }; version: ArmyEstimate["version"] };

export const NEUTRAL_V3_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal", validite_jours: 30,
} as const;

// §5.1 : 40 €/h, k_fo = k_mo = maj = 1, c_FO 1,30, c_MO 1,20 (coefficients de la politique). TI-534 : lignes sans type
// FO, provision FO 1,01 (FO_unitaire = P × 1,01 × k_fo) ; PU et PT ci-dessous l'appliquent (moteur pur 2.4).
export const ORACLE = [
  { ref: "O1", unit: "ml", symbol: "ml", quantity: 20, prFo: 5466, hPerUnit: 1.991, pu: 16734, gross: 334680 },
  { ref: "O2", unit: "u", symbol: "u", quantity: 3, prFo: 9563, hPerUnit: 1.75, pu: 20956, gross: 62868 },
  { ref: "O3", unit: "m2", symbol: "m²", quantity: 21, prFo: 5850, hPerUnit: 0, pu: 7681, gross: 161301 },
  { ref: "O4", unit: "ml", symbol: "ml", quantity: 1139, prFo: 302, hPerUnit: 0.2, pu: 1357, gross: 1545623 },
  { ref: "O5", unit: "u", symbol: "u", quantity: 1, prFo: 2000, hPerUnit: 6, pu: 31426, gross: 31426 },
  { ref: "O6", unit: "ml", symbol: "ml", quantity: 282, prFo: 9186, hPerUnit: 0.998, pu: 16852, gross: 4752264 },
  { ref: "O7", unit: "ml", symbol: "ml", quantity: 8, prFo: 883, hPerUnit: 1.3, pu: 7399, gross: 59192 },
] as const;
if (ORACLE.some((line) => line.gross !== Math.round(line.quantity * line.pu))) throw new Error("Oracle: PT must equal ⌈Q × PU⌋.");

// §5.2, à provision FO 1,01 : S2 (remise 1,01 €, TVA 20 %) et S5 (S2, O1–O3 à 10 %, O4–O7 à 20 %).
export type Scenario = {
  name: "S2" | "S5";
  rates: readonly number[];
  totals: readonly [number, number, number];
  taxByRate: ReadonlyArray<{ rateBp: number; label: string; base: number; tax: number }>;
};
export const S2: Scenario = {
  name: "S2", rates: [2000, 2000, 2000, 2000, 2000, 2000, 2000], totals: [6947253, 1389451, 8336704],
  taxByRate: [{ rateBp: 2000, label: "20", base: 6947253, tax: 1389451 }],
};
export const S5: Scenario = {
  name: "S5", rates: [1000, 1000, 1000, 2000, 2000, 2000, 2000], totals: [6947253, 1333566, 8280819],
  taxByRate: [{ rateBp: 1000, label: "10", base: 558841, tax: 55884 }, { rateBp: 2000, label: "20", base: 6388412, tax: 1277682 }],
};
export const GROSS = 6947354;
export const DISCOUNT = 101;
for (const scenario of [S2, S5]) {
  const tax = scenario.taxByRate.reduce((sum, rate) => sum + rate.tax, 0);
  const base = scenario.taxByRate.reduce((sum, rate) => sum + rate.base, 0);
  if (base !== scenario.totals[0] || tax !== scenario.totals[1] || scenario.totals[0] + tax !== scenario.totals[2] ||
    scenario.totals[0] !== GROSS - DISCOUNT || scenario.taxByRate.some((rate) => rate.tax !== Math.round(rate.base * rate.rateBp / 10_000))) {
    throw new Error(`Oracle ${scenario.name}: base, VAT per rate or TTC inconsistent with §5.2.`);
  }
}

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
/** Espaces (fines, insécables, retours) ramenés à une espace ; aucun autre caractère n'est touché. */
export const normalizeText = (value: string) => value.replace(/[\s  ]+/gu, " ").trim();
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** Montant en euros tel qu'imprimé en fr-FR, espaces normalisées : 334680 → « 3 346,80 ». */
export function euros(cents: number) {
  const whole = Math.trunc(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return `${whole},${String(cents % 100).padStart(2, "0")}`;
}
const grouped = (value: number) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
const amount = (cents: number) => `${escape(euros(cents))} ?€`;

/**
 * Présence, dans un texte de document normalisé, de chaque montant que la conception exige (§14 2.7) :
 * chaque ligne « Q unité … PU … PT » (une colonne intercalée est tolérée, pas un autre montant), le
 * brut, la ligne « Remise commerciale −1,01 € », le « Total HT net », chaque « TVA r % » avec sa base
 * et son montant, et le TTC. Chaque entrée vaut true quand le document la porte.
 */
export function documentChecks(text: string, scenario: Scenario) {
  const value = normalizeText(text);
  const has = (pattern: string) => new RegExp(pattern, "u").test(value);
  return {
    lines: Object.fromEntries(ORACLE.map((line) => [line.ref,
      has(`(?:^| )${escape(grouped(line.quantity))} ${escape(line.symbol)} (?:[^€]{0,40} )?${amount(line.pu)}(?: [^€]{0,40})? ${amount(line.gross)}`)])),
    gross: has(amount(GROSS)),
    discount: has(`Remise commerciale(?: [^€]{0,40})? [−-] ?${amount(DISCOUNT)}`),
    net: has(`Total HT net(?: [^€]{0,20})? ${amount(scenario.totals[0])}`),
    taxByRate: Object.fromEntries(scenario.taxByRate.map((rate) => [`TVA ${rate.label} %`,
      has(`TVA ${rate.label} ?%(?: [^€]{0,60})? (?:${amount(rate.base)}(?: [^€]{0,40})? ${amount(rate.tax)}|${amount(rate.tax)}(?: [^€]{0,40})? ${amount(rate.base)})`)])),
    ttc: has(`TTC(?: [^€]{0,30})? ${amount(scenario.totals[2])}`),
  };
}

/** L'attendu de documentChecks : tout vrai. */
export function expectedDocumentChecks(scenario: Scenario) {
  return {
    lines: Object.fromEntries(ORACLE.map((line) => [line.ref, true])),
    gross: true, discount: true, net: true,
    taxByRate: Object.fromEntries(scenario.taxByRate.map((rate) => [`TVA ${rate.label} %`, true])),
    ttc: true,
  };
}

/**
 * Lignes-oracle d'une version v3, écrites par le lot de 2.5 (contrat d'écrivain v3). Une ligne sans
 * heure (O3, « fourniture seule ») ne porte pas de rôle de MO : la règle de nature de ligne, bloquante
 * à l'envoi, compte un rôle comme de la main-d'oeuvre ; aucun montant n'en dépend (h/u = 0).
 */
function oracleLines(runPrefix: string, scenario: Scenario, laborRoleId: string, parentId: string) {
  return ORACLE.map((line, index) => ({
    item_type: "line", parent_id: parentId, position: index + 1,
    line_nature: line.hPerUnit > 0 ? "supply_and_labor" : "supply_only", title: `${runPrefix} ${line.ref}`, description: line.unit,
    unit_code: line.unit, pricing_status: "priced", quantity: line.quantity, unit_price_ht_cents: line.prFo,
    tax_rate_bp: scenario.rates[index], k_fo: 1, h_mo_per_unit: line.hPerUnit, h_mo_majoration: 1, k_mo: 1,
    labor_role_id: line.hPerUnit > 0 ? laborRoleId : null, source_provider: "manual",
  }));
}

export async function retakeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect(lease.status).toBe(200);
}

/** Une affaire et une v3 attendue (moteur 3 de la politique) par l'API de création de 2.5. */
export async function createV3(browser: Browser, army: ArmyState, record: Evidence, label: string) {
  const today = new Date().toISOString().slice(0, 10);
  const created = await apiRequest<Envelope<Created>>(browser, "POST", "/api/estimates", {
    project: { name: `${army.runPrefix}-${label}` },
    version: { ...NEUTRAL_V3_VERSION, title: `${army.runPrefix} ${label}`, date_devis: today, expected_calc_engine_version: 3 },
  });
  await record(`${label}-created`, { status: created.status, ok: created.body.ok, error: created.body.error ?? null,
    engine: created.body.data?.version?.calc_engine_version ?? null });
  expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 3]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  return ids;
}

/**
 * Brouillon v3 d'une seule ligne de 1 × 10,00 € (PR FO), sous une section, écrite par le lot de 2.5 :
 * - sans unité et chiffrée, aucun gel ne peut le figer (D9 ; l'unité est facultative à la saisie,
 *   exigée au gel) ;
 * - « included » en u, il n'a aucune ligne chiffrée : récapitulatif de TVA vide, montants nuls.
 */
export async function settleOneLineV3(browser: Browser, army: ArmyState, record: Evidence, label: string, ids: { versionId: string },
  line: { unitCode: string | null; pricingStatus: "priced" | "included" }) {
  const lock = await apiRequest(browser, "POST", `/api/estimates/${ids.versionId}/lock`);
  expect(lock.status).toBe(201);
  const empty = await readEstimate(browser, ids.versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`,
    { item_type: "section", position: 1, title: `${army.runPrefix} ${label} lot` }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const beforeBatch = await readEstimate(browser, ids.versionId);
  const batch = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${ids.versionId}/batch`, {
    operation_key: randomUUID(),
    operations: [{ op: "create", data: {
      item_type: "line", parent_id: section.body.data.item.id, position: 1, line_nature: "supply_only",
      title: `${army.runPrefix} ${label} ligne`, description: null, unit_code: line.unitCode, pricing_status: line.pricingStatus, quantity: 1,
      unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: null,
      source_provider: "manual",
    } }],
  }, { "if-match": beforeBatch.version.updated_at });
  expect([batch.status, batch.body.ok, batch.body.data?.committed]).toEqual([200, true, true]);
  const settled = await readEstimate(browser, ids.versionId);
  const lines = settled.items.filter((item) => item.item_type === "line");
  const actual = { engine: settled.version.calc_engine_version, status: settled.version.status,
    lines: lines.map((item) => [item.unit_code ?? null, item.pricing_status ?? null, Number(item.quantity)]) };
  await record(`${label}-settled`, { versionId: ids.versionId, actual });
  expect(actual).toEqual({ engine: 3, status: "draft", lines: [[line.unitCode, line.pricingStatus, 1]] });
  return settled;
}

/** Résumé d'approbation par la route que lisent la fiche et l'affaire (GET …/approval). */
export async function readApproval(browser: Browser, versionId: string) {
  const read = await apiRequest<Envelope<{ approvalStatus?: string; reasons?: Array<{ ruleId?: string; approvalStatus?: string }> }>>(
    browser, "GET", `/api/estimates/${versionId}/approval`);
  return { status: read.status, ok: read.body.ok ?? null, code: read.body.error?.code ?? null,
    approvalStatus: read.body.data?.approvalStatus ?? null, reasons: read.body.data?.reasons ?? [] };
}

/**
 * Action d'approbation (POST …/approve) depuis le processus du parcours, pour la seule v3 possédée :
 * le garde de navigateur des offres interdit /approve, par conception (comme V3P01). Les cookies de
 * la session du navigateur portent l'authentification ; l'origine est l'application possédée en boucle.
 */
export async function approvalFromJourneyProcess(app: App, browser: Browser, versionId: string, body: Record<string, unknown>) {
  const origin = new URL(app.baseUrl!).origin;
  if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("The v3 approval probe targets the owned loopback app only.");
  const cookie = (await browser.cookies())
    .filter((entry) => !entry.domain || entry.domain === "localhost" || entry.domain === ".localhost")
    .map((entry) => `${entry.name}=${entry.value}`).join("; ");
  const response = await fetch(`${origin}/api/estimates/${versionId}/approve`, {
    method: "POST", redirect: "manual",
    headers: { cookie, origin, "content-type": "application/json", "x-estimate-draft-lock-session-id": randomUUID() },
    body: JSON.stringify(body),
  });
  let parsed: Envelope<unknown> | { invalidJson: true };
  try { parsed = await response.json() as Envelope<unknown>; } catch { parsed = { invalidJson: true }; }
  const envelope = parsed as Partial<Envelope<unknown>>;
  return { status: response.status, ok: envelope.ok ?? null, code: envelope.error?.code ?? null, message: envelope.error?.message ?? null };
}

/** Les 7 lignes en S5 : O1–O3 passent à 10 % par un lot de mises à jour, sur un brouillon réglé en S2. */
export async function moveToS5(browser: Browser, record: Evidence, label: string, versionId: string) {
  await retakeLease(browser, versionId);
  const before = await readEstimate(browser, versionId);
  const lines = before.items.filter((item) => item.item_type === "line").sort((a, b) => a.position - b.position);
  const request = { operation_key: randomUUID(), operations: lines.slice(0, 3).map((line) => ({ op: "update", id: line.id, data: { tax_rate_bp: 1000 } })) };
  const batch = await apiRequest<Envelope<{ committed: boolean }>>(browser, "POST", `/api/estimates/${versionId}/batch`, request,
    { "if-match": before.version.updated_at });
  const after = await readEstimate(browser, versionId);
  const actual = { response: [batch.status, batch.body.ok, batch.body.data?.committed ?? null],
    totals: [after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents] };
  await record(`${label}-s5`, { versionId, expected: { response: [200, true, true], totals: [...S5.totals] }, actual });
  expect(actual).toEqual({ response: [200, true, true], totals: [...S5.totals] });
}

/**
 * Préparation (2.5, sans M5) : une section, les 7 lignes par un lot validé, puis la remise de
 * 1,01 € par les réglages ; relecture au centime.
 */
export async function settleV3(browser: Browser, army: ArmyState, record: Evidence, label: string, ids: { projectId: string; versionId: string },
  scenario: Scenario, laborRoleId: string) {
  const lock = await apiRequest(browser, "POST", `/api/estimates/${ids.versionId}/lock`);
  expect(lock.status).toBe(201);
  const empty = await readEstimate(browser, ids.versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`,
    { item_type: "section", position: 1, title: `${army.runPrefix} ${label} lot` }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const beforeBatch = await readEstimate(browser, ids.versionId);
  const request = {
    operation_key: randomUUID(),
    operations: oracleLines(army.runPrefix, scenario, laborRoleId, section.body.data.item.id).map((data) => ({ op: "create", data })),
  };
  const batch = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string; code?: string }> }>>(
    browser, "POST", `/api/estimates/${ids.versionId}/batch`, request, { "if-match": beforeBatch.version.updated_at });
  await record(`${label}-batch`, { versionId: ids.versionId, status: batch.status, ok: batch.body.ok, committed: batch.body.data?.committed ?? null,
    errors: batch.body.data?.results?.filter((result) => result.status === "error") ?? null });
  expect([batch.status, batch.body.ok, batch.body.data?.committed]).toEqual([200, true, true]);
  await retakeLease(browser, ids.versionId);
  const beforeSettings = await readEstimate(browser, ids.versionId);
  const settings = await apiRequest<Envelope<unknown>>(browser, "PATCH", `/api/estimates/${ids.versionId}`,
    { discount_amount_cents: DISCOUNT, discount_bp: 0, expected_content_revision: beforeSettings.version.content_revision },
    { "if-match": beforeSettings.version.updated_at });
  expect([settings.status, settings.body.ok]).toEqual([200, true]);
  const settled = await readEstimate(browser, ids.versionId);
  const lines = settled.items.filter((item) => item.item_type === "line").sort((a, b) => a.position - b.position);
  const actual = {
    engine: settled.version.calc_engine_version, gross: settled.version.gross_ht_cents ?? null,
    applied: settled.version.discount_applied_cents ?? null,
    totals: [settled.version.total_ht_cents, settled.version.total_tax_cents, settled.version.total_ttc_cents],
    lines: lines.map((item) => [item.unit_code ?? null, Number(item.quantity), item.pu_ht_cents ?? null, item.tax_rate_bp]),
  };
  const expected = {
    engine: 3, gross: GROSS, applied: DISCOUNT, totals: [...scenario.totals],
    lines: ORACLE.map((line, index) => [line.unit, line.quantity, line.pu, scenario.rates[index]]),
  };
  await record(`${label}-settled`, { versionId: ids.versionId, expected, actual });
  expect(actual).toEqual(expected);
  return ids;
}

/**
 * Génération manuelle du PDF par la route de l'interface (POST …/pdf?force=1, bail de cette page),
 * puis attente de l'état « ready ». Le premier refus d'une v3 avant M5 est relevé ici, par son code.
 * `layout` : mise en page envoyée comme par la fenêtre « Préparer le PDF » (V3M-18) ; sans elle, celle du
 * document stocké ou la mise en page par défaut.
 */
export async function generatePdf(browser: Browser, record: Evidence, label: string, versionId: string,
  layout?: Readonly<Record<string, string | number | boolean>>) {
  await retakeLease(browser, versionId);
  const started = await apiRequest<Envelope<{ status: string }>>(browser, "POST", `/api/estimates/${versionId}/pdf?force=1`,
    layout ? { layout } : {});
  await record(`${label}-pdf-start`, { versionId, layout: layout ?? null, status: started.status, ok: started.body.ok,
    error: started.body.error ?? null });
  expect({ status: started.status, code: started.body.error?.code ?? null }).toEqual({ status: 202, code: null });
  type PdfState = { status: number; body: Envelope<{ status: string; sha256_hash?: string; file_size_bytes?: number }> };
  const observed: { last: PdfState | null } = { last: null };
  await expect.poll(async () => {
    const state: PdfState = await apiRequest(browser, "GET", `/api/estimates/${versionId}/pdf?format=json`);
    observed.last = state;
    if (state.status === 500) return `failed: ${state.body.error?.message ?? "unknown"}`;
    return state.status === 200 && state.body.data?.status === "ready" ? "ready" : "pending";
  }, { timeout: 120_000 }).toBe("ready");
  const ready = observed.last!.body.data;
  await record(`${label}-pdf-ready`, { versionId, sha256: ready.sha256_hash ?? null, bytes: ready.file_size_bytes ?? null });
  return { sha256: ready.sha256_hash!, bytes: ready.file_size_bytes! };
}

/** État du PDF stocké (hash, taille), sans jamais exposer l'URL signée. */
export async function storedPdfState(browser: Browser, versionId: string) {
  const state = await apiRequest<Envelope<{ status: string; sha256_hash?: string; file_size_bytes?: number }>>(
    browser, "GET", `/api/estimates/${versionId}/pdf?format=json`);
  return { status: state.status, documentStatus: state.body.data?.status ?? null, sha256: state.body.data?.sha256_hash ?? null,
    bytes: state.body.data?.file_size_bytes ?? null };
}

/**
 * Octets du PDF stocké, lus depuis ce processus sur l'URL signée de la pile possédée (le garde du
 * navigateur critique refuse l'origine Storage). L'URL n'est ni renvoyée ni enregistrée.
 */
export async function storedPdfBytes(browser: Browser, versionId: string) {
  const state = await apiRequest<Envelope<{ status: string; download_url?: string; sha256_hash?: string }>>(
    browser, "GET", `/api/estimates/${versionId}/pdf?format=json`);
  expect([state.status, state.body.data?.status]).toEqual([200, "ready"]);
  const url = new URL(state.body.data.download_url ?? "");
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  if (url.origin !== backend.origin || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.startsWith("/storage/v1/object/sign/estimate-documents/")) {
    throw new Error("The stored PDF must be read from the owned loopback Storage only.");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  expect([response.status, bytes.subarray(0, 5).toString("ascii"), digest(bytes)]).toEqual([200, "%PDF-", state.body.data.sha256_hash]);
  return bytes;
}

/** Texte d'un PDF réel (pages jointes), lu par pdfjs-dist dans un thread terminable. */
export async function pdfText(bytes: Buffer) {
  const text = await extractPdfText(bytes, { root: process.cwd() });
  return { sha256: text.sha256, pageCount: text.pageCount, characters: text.characters, text: normalizeText(text.pages.join("\n")) };
}

/** Vérification du sceau par la route publique de l'application (GET …/verify). */
export async function verifySeal(browser: Browser, versionId: string) {
  const verified = await apiRequest<Envelope<Record<string, unknown>>>(browser, "GET", `/api/estimates/${versionId}/verify`);
  return { status: verified.status, ok: verified.body.ok, data: verified.body.data ?? null, error: verified.body.error ?? null };
}

/** Texte du document imprimable (lecture seule, aucun bail), comme commercial-rounding.e2e.ts. */
export async function printText(app: App, screen: Screen, browser: Browser, versionId: string) {
  await app.open(`/dashboard/estimates/${versionId}/print?price_mode=unit_and_total&detail_level=lines`);
  await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible({ timeout: 30_000 });
  return normalizeText(await browser.evaluate(() => {
    const visible = Array.from(document.querySelectorAll(".estimate-document")).find((node) => node.getClientRects().length > 0);
    return (visible as HTMLElement | undefined)?.innerText ?? document.body.innerText;
  }));
}

type CellValue = string | number | boolean | null;
export type WorkbookRow = { sheet: string; row: number; cells: CellValue[] };

/** Classeur d'export lu par la route de l'interface, dans le navigateur ; octets et lignes rendus ici. */
export async function exportWorkbook(browser: Browser, versionId: string, mode: "standard" | "dpgf") {
  const exported = await browser.evaluate(async (input) => {
    const response = await fetch(`/api/estimates/${input.versionId}/export?format=xlsx${input.mode === "dpgf" ? "&mode=dpgf" : ""}`,
      { credentials: "same-origin", redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { status: response.status, base64: btoa(binary) };
  }, { versionId, mode });
  const bytes = Buffer.from(exported.base64, "base64");
  expect([exported.status, Array.from(bytes.subarray(0, 4))]).toEqual([200, [0x50, 0x4b, 0x03, 0x04]]);
  return { sha256: digest(bytes), bytes: bytes.length, rows: await readWorkbookRows(bytes) };
}

/** Lignes d'un classeur XLSX (feuille, numéro, cellules non vides) ; aussi pour un classeur téléchargé depuis l'éditeur. */
export async function readWorkbookRows(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const rows: WorkbookRow[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row, rowNumber) => {
      const cells: CellValue[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const value = cell.value;
        if (value === null || value === undefined) cells.push(null);
        else if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") cells.push(value);
        else if (value instanceof Date) cells.push(value.toISOString());
        else if (typeof value === "object" && "result" in value) {
          const result = (value as { result?: unknown }).result;
          cells.push(typeof result === "number" || typeof result === "string" ? result : null);
        } else cells.push(cell.text);
      });
      rows.push({ sheet: sheet.name, row: rowNumber, cells });
    });
  });
  return rows;
}

/** Mêmes PU et PT bruts que le document pour chaque ligne-oracle, et une ligne de remise de 1,01 €. */
export function exportChecks(rows: WorkbookRow[], runPrefix: string) {
  const cents = (row: WorkbookRow, value: number) => row.cells.some((cell) => typeof cell === "number" && Math.round(cell * 100) === value);
  return {
    lines: Object.fromEntries(ORACLE.map((line) => [line.ref, rows.some((row) =>
      row.cells.some((cell) => typeof cell === "string" && normalizeText(cell) === `${runPrefix} ${line.ref}`) &&
      cents(row, line.pu) && cents(row, line.gross))])),
    discount: rows.some((row) => row.cells.some((cell) => typeof cell === "string" && /remise commerciale/iu.test(cell)) &&
      row.cells.some((cell) => typeof cell === "number" && Math.abs(Math.round(cell * 100)) === DISCOUNT)),
  };
}

export function expectedExportChecks() {
  return { lines: Object.fromEntries(ORACLE.map((line) => [line.ref, true])), discount: true };
}
