import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect, type App, type JsonValue, type Screen } from "e2e";

import {
  apiRequest, ownEstimate, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
import { querySql } from "./calculation-gate-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { releaseVersion } from "./engine-v3-editor-support";
import { relativeOutputPath } from "./sdk-results";
// Aliased: the sign-up helper is not a React hook, whatever its name.
import {
  readTenantCalcPolicy, setTenantCalcPolicy, useDedicatedV3Owner as signUpDedicatedV3Owner, type V3Owner,
} from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.10a : préalables et lectures des parcours engine-v3-creators
// (docs/testing/estimate-engine-v3-2.10a.md §3). Propriétaire dédié par parcours (aide du 2.5), politique 3
// posée par le transport SQL possédé le temps du parcours puis remise à 2 ; les gardes ne posent aucune
// politique. Les versions sont relues en SQL par le propriétaire natif de la pile, les lignes par l'API.

export type Ui = { app: App; screen: Screen; browser: Browser };
export type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };

export const NEUTRAL_VERSION = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal",
} as const;
export const ENGINE_UNAVAILABLE = "Ce devis utilise le moteur de calcul 3, pas encore disponible pour cette action.";
// Motif du refus du métré sur une v3, retiré par M2 v0.1 : V3C08 vérifie qu'il n'est plus affiché.
export const TAKEOFF_V3_REASON = "Le métré ne s'applique pas à un devis en moteur de calcul 3.";
export const EDITOR_URL = /\/dashboard\/estimates\/([0-9a-f-]{36})\/edit(?:[?#].*)?$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIZARD_DRAFT_KEY = "est-wizard-draft";

/** Espaces (insécables et fines comprises) réduits à une espace. */
export const normalized = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
const num = (value: unknown) => (value === null || value === undefined ? null : Number(value));
export const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------- Propriétaire, politique ---------- */

/** A disposable owner on the owned loopback stack, its personal ARMY tenant at the explicit policy 2 (2.10b D-i). */
export async function signUpCreatorOwner(ui: Ui, army: ArmyState): Promise<V3Owner> {
  const dedicated = await signUpDedicatedV3Owner(ui.browser, ui.app.baseUrl!, army.runPrefix);
  await ui.app.open("/dashboard/affaires");
  return { tenantId: dedicated.tenantId, userId: dedicated.userId };
}

// ASCII only: setTenantCalcPolicy guards the reason with /^ARMY-[A-Za-z0-9 :.,'()-]{5,200}$/.
export async function openPolicy3(owner: V3Owner, army: ArmyState, label: string) {
  return setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.10a ${label}` });
}

export async function closePolicy(owner: V3Owner, army: ArmyState, label: string) {
  return setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.10a ${label} fin` });
}

export const policySnapshot = readTenantCalcPolicy;

/* ---------- Lectures SQL (propriétaire natif) ---------- */

export type StoredVersion = {
  id: string;
  versionNumber: number;
  title: string | null;
  engine: number;
  fo: number | null;
  mo: number | null;
  marginMode: string;
  marginMultiplier: number;
  marginBp: number | null;
  globalCoefficient: number;
  discountMode: string;
  discountSteps: number[];
  discountBp: number;
  roundingMode: string;
  roundingStepCents: number;
  taxRateBp: number;
  totals: [number, number, number];
};

/** Versions of an owned affaire as stored, ordered by number (engine, coefficients, settings, totals). */
export async function storedVersions(owner: V3Owner, projectId: string): Promise<StoredVersion[]> {
  if (!UUID.test(owner.tenantId) || !UUID.test(owner.userId) || !UUID.test(projectId)) throw new Error("Invalid stored version read.");
  const [row] = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id', v.id, 'versionNumber', v.version_number, 'title', v.title, 'engine', v.calc_engine_version,
  'fo', v.sale_coefficient_fo, 'mo', v.sale_coefficient_mo, 'marginMode', v.margin_mode,
  'marginMultiplier', v.margin_multiplier, 'marginBp', v.margin_bp, 'globalCoefficient', v.global_coefficient,
  'discountMode', v.discount_mode, 'discountSteps', to_jsonb(v.discount_steps), 'discountBp', v.discount_bp,
  'roundingMode', v.rounding_mode, 'roundingStepCents', v.rounding_step_cents, 'taxRateBp', v.tax_rate_bp,
  'totals', jsonb_build_array(v.total_ht_cents, v.total_tax_cents, v.total_ttc_cents)) ORDER BY v.version_number), '[]'::jsonb)
FROM public.estimate_versions v
JOIN public.estimate_projects p ON p.id = v.project_id AND p.tenant_id = v.tenant_id
WHERE v.project_id = '${projectId}' AND v.tenant_id = '${owner.tenantId}' AND p.user_id = '${owner.userId}'
  AND current_user = 'postgres';
`);
  const rows = JSON.parse(row ?? "[]") as Array<Record<string, unknown>>;
  return rows.map((stored) => ({
    id: String(stored.id), versionNumber: Number(stored.versionNumber), title: (stored.title as string | null) ?? null,
    engine: Number(stored.engine), fo: num(stored.fo), mo: num(stored.mo), marginMode: String(stored.marginMode),
    marginMultiplier: Number(stored.marginMultiplier), marginBp: num(stored.marginBp),
    globalCoefficient: Number(stored.globalCoefficient), discountMode: String(stored.discountMode),
    discountSteps: ((stored.discountSteps as unknown[] | null) ?? []).map(Number), discountBp: Number(stored.discountBp),
    roundingMode: String(stored.roundingMode), roundingStepCents: Number(stored.roundingStepCents),
    taxRateBp: Number(stored.taxRateBp), totals: (stored.totals as number[]).map(Number) as [number, number, number],
  }));
}

/** Owned affaires named exactly `name`: a refused creation writes none. */
export async function ownedProjectIdsNamed(owner: V3Owner, name: string): Promise<string[]> {
  if (!UUID.test(owner.tenantId) || !/^ARMY-[A-Za-z0-9 .-]{5,200}$/.test(name)) throw new Error("Invalid owned project read.");
  const [row] = await querySql(`SELECT coalesce(jsonb_agg(p.id ORDER BY p.id), '[]'::jsonb) FROM public.estimate_projects p
WHERE p.tenant_id = '${owner.tenantId}' AND p.name = '${name}' AND current_user = 'postgres';
`);
  return JSON.parse(row ?? "[]") as string[];
}

/** Affaires and versions of the owned tenant: a refused creation writes neither. */
export async function tenantEstimateCounts(owner: V3Owner): Promise<[number, number]> {
  if (!UUID.test(owner.tenantId)) throw new Error("Invalid owned tenant read.");
  const [row] = await querySql(`SELECT jsonb_build_array(
  (SELECT count(*) FROM public.estimate_projects p WHERE p.tenant_id = '${owner.tenantId}'),
  (SELECT count(*) FROM public.estimate_versions v WHERE v.tenant_id = '${owner.tenantId}'))
WHERE current_user = 'postgres';
`);
  return (JSON.parse(row ?? "[]") as number[]).map(Number) as [number, number];
}

/**
 * Versions ever inserted into an owned affaire, read in the audit trail (010): a copy deleted afterwards still
 * counts, so « nothing copied » is told apart from « copied, then rolled back ».
 */
export async function versionInsertsLogged(owner: V3Owner, projectId: string) {
  if (!UUID.test(owner.tenantId) || !UUID.test(projectId)) throw new Error("Invalid audit read.");
  const [row] = await querySql(`SELECT count(*) FROM public.audit_logs a
WHERE a.table_name = 'estimate_versions' AND a.action = 'INSERT' AND a.after_data->>'project_id' = '${projectId}'
  AND a.after_data->>'tenant_id' = '${owner.tenantId}' AND current_user = 'postgres';
`);
  return Number(row);
}

/**
 * A second administrator of the owner's ARMY tenant (tag V3CA), with that tenant as its default: the browser context
 * now acts as it (dedicated-owner.ts). It sees the owner's templates (RLS: creator or admin); its labour roles are
 * its own, never the owner's.
 */
export async function signUpTenantAdmin(ui: Ui, army: ArmyState, owner: V3Owner): Promise<V3Owner> {
  const member = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, army.runPrefix, { tag: "V3CA" });
  if (!UUID.test(owner.tenantId) || !UUID.test(owner.userId) || !UUID.test(member.userId) || !UUID.test(member.tenantId)) {
    throw new Error("Invalid tenant member identity.");
  }
  const tag = `$army_${randomUUID().replaceAll("-", "")}$`;
  const output = await querySql(`BEGIN;
DO ${tag}
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t
    JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.user_id = '${owner.userId}' AND m.role = 'admin'
    WHERE t.id = '${owner.tenantId}' AND t.is_active AND t.name ~ '^ARMY\\y')
  THEN RAISE EXCEPTION 'The owned ARMY tenant identity differs'; END IF;
  UPDATE public.tenant_memberships SET is_default = false
  WHERE user_id = '${member.userId}' AND tenant_id = '${member.tenantId}' AND is_default;
  IF NOT FOUND THEN RAISE EXCEPTION 'The member must leave its personal default tenant'; END IF;
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, is_default)
  VALUES ('${owner.tenantId}', '${member.userId}', 'admin', true);
END ${tag};
COMMIT;
SELECT m.tenant_id || ' ' || m.role FROM public.tenant_memberships m WHERE m.user_id = '${member.userId}' AND m.is_default;
`);
  if (output.at(-1) !== `${owner.tenantId} admin`) throw new Error("The member did not join the owned tenant as an administrator.");
  return { tenantId: owner.tenantId, userId: member.userId };
}

/** The v3 projection of a stored version (§2) : moteur 3, réglages de version neutres. */
export function v3Settings(version: StoredVersion) {
  return {
    engine: version.engine, coefficients: [version.fo, version.mo],
    neutral: [version.marginMode, version.marginMultiplier, version.globalCoefficient, version.discountMode, version.discountSteps],
    // The step of « Aucun » is not a setting the user chose (inherited or default): only the mode is compared.
    rounding: version.roundingMode === "none" ? ["none"] : [version.roundingMode, version.roundingStepCents],
  };
}

/* ---------- Préalables par l'API ---------- */

export async function createVersion(ui: Ui, body: Record<string, unknown>) {
  return apiRequest<Envelope<{ project: { id: string }; version: ArmyEstimate["version"] }>>(ui.browser, "POST", "/api/estimates", body);
}

/** Takes the draft lease for this document, whoever held it (handed back by releaseVersion). */
export async function takeLease(browser: Browser, versionId: string) {
  const lease = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock?force=true`);
  expect([200, 201]).toContain(lease.status);
}

/** A v2 affaire created by the API under the explicit policy 2 (the anchor of the journeys). */
export async function createV2Affaire(ui: Ui, army: ArmyState, projectName: string, version: Record<string, unknown> = {}) {
  const created = await createVersion(ui, { project: { name: projectName }, version: { ...NEUTRAL_VERSION, title: `${army.runPrefix} ancre v2`, ...version } });
  expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 2]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  return ids;
}

/** One more v2 version in the affaire, under the explicit policy 2. */
export async function createV2Version(ui: Ui, army: ArmyState, projectId: string, title: string, version: Record<string, unknown> = {}) {
  const created = await createVersion(ui, { project_id: projectId, version: { ...NEUTRAL_VERSION, title, ...version } });
  expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 2]);
  const versionId = created.body.data.version.id;
  ownEstimate(army, { projectId, versionId });
  return versionId;
}

/** A v3 created by the API with the expectation 3 (the policy is open). */
export async function createV3Version(ui: Ui, army: ArmyState, projectId: string, title: string, version: Record<string, unknown> = {}) {
  const created = await createVersion(ui, { project_id: projectId, version: { ...NEUTRAL_VERSION, title, expected_calc_engine_version: 3, ...version } });
  expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 3]);
  const versionId = created.body.data.version.id;
  ownEstimate(army, { projectId, versionId });
  return versionId;
}

/** The « Tuyauteur » role at 4 000 c/h of the owner, created through the anchor. */
export async function createTuyauteur(ui: Ui, army: ArmyState, anchorId: string) {
  return createLaborRole(ui, army, anchorId, "Tuyauteur", 4000, "v3c-labor-role");
}

/** A labour role of the owner at `rate` c/h, created through the anchor. */
export async function createLaborRole(ui: Ui, army: ArmyState, anchorId: string, name: string, rate: number, label: string) {
  await takeLease(ui.browser, anchorId);
  const created = await apiRequest<Envelope<{ labor_role: { id: string; hourly_rate_cents: number } }>>(
    ui.browser, "POST", `/api/estimates/${anchorId}/labor-roles`, { name, hourly_rate_cents: rate });
  await recordEvidence(army, label, { anchorId, response: created });
  expect([created.status, created.body.ok, created.body.data.labor_role.hourly_rate_cents]).toEqual([201, true, rate]);
  await releaseVersion(ui.browser, anchorId);
  return created.body.data.labor_role.id;
}

/** The two template lines of IO06 (2.8): 10 ml × 5 h and 3 000 u × 1 h, 10,00 € each, Tuyauteur. */
export function templateLines(army: ArmyState) {
  return { tube: `${army.runPrefix} tube`, collier: `${army.runPrefix} collier` };
}

/** One section and the two IO06 lines in a v2 by the items API (v2 line hours are totals). */
export async function seedV2TemplateLines(ui: Ui, army: ArmyState, versionId: string, roleId: string) {
  const titles = templateLines(army);
  await seedV2Lines(ui, versionId, [
    { title: titles.tube, description: "ml", quantity: 10, h_mo: 5, unit_price_ht_cents: 1000, labor_role_id: roleId },
    { title: titles.collier, description: "u", quantity: 3000, h_mo: 1, unit_price_ht_cents: 1000, labor_role_id: roleId },
  ]);
}

/** One section « Modèle lot » and these lines in a v2, by the items API. */
export async function seedV2Lines(ui: Ui, versionId: string, lines: ReadonlyArray<Record<string, unknown>>) {
  await takeLease(ui.browser, versionId);
  const empty = await readEstimate(ui.browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: "Modèle lot" }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  for (const [index, line] of lines.entries()) {
    const current = await readEstimate(ui.browser, versionId);
    const created = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
      { item_type: "line", parent_id: section.body.data.item.id, position: index + 1, ...line },
      { "if-match": current.version.updated_at });
    expect([created.status, created.body.ok]).toEqual([201, true]);
  }
  await releaseVersion(ui.browser, versionId);
}

/** The same two lines in a v3 by one committed batch: unit codes and hours per unit (0,5 and 0,0003). */
export async function seedV3TemplateLines(ui: Ui, army: ArmyState, versionId: string, roleId: string) {
  const titles = templateLines(army);
  await takeLease(ui.browser, versionId);
  const empty = await readEstimate(ui.browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: "Modèle lot" }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const line = (title: string, unitCode: string, quantity: number, hoursPerUnit: number, position: number) => ({
    op: "create", data: {
      item_type: "line", parent_id: section.body.data.item.id, position, line_nature: "supply_and_labor", title, unit_code: unitCode,
      pricing_status: "priced", quantity, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: hoursPerUnit,
      h_mo_majoration: 1, k_mo: 1, labor_role_id: roleId, source_provider: "manual",
    },
  });
  const before = await readEstimate(ui.browser, versionId);
  const request = { operation_key: randomUUID(), operations: [line(titles.tube, "ml", 10, 0.5, 1), line(titles.collier, "u", 3000, 0.0003, 2)] };
  const response = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string }> }>>(
    ui.browser, "POST", `/api/estimates/${versionId}/batch`, request, { "if-match": before.version.updated_at });
  await recordEvidence(army, "v3c-seed-v3-template-lines", { versionId, request, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  await releaseVersion(ui.browser, versionId);
}

export async function saveTemplate(ui: Ui, army: ArmyState, sourceVersionId: string, name: string) {
  const template = await apiRequest<Envelope<{ template: { id: string } }>>(ui.browser, "POST", "/api/estimates/templates",
    { source_version_id: sourceVersionId, name });
  await recordEvidence(army, `v3c-template-${template.body.data?.template?.id ?? "refused"}`, { sourceVersionId, name, response: template });
  expect([template.status, template.body.ok]).toEqual([201, true]);
  return template.body.data.template.id;
}

/**
 * The insert routes carry no version in their path, so the fixture does not attach this page's draft lease
 * session: it is sent explicitly (2.8, IO05).
 */
async function leaseSession(browser: Browser, versionId: string) {
  const sessionId = await browser.evaluate((id) => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  if (!sessionId) throw new Error("The draft lease session of this page is missing.");
  return { "x-estimate-draft-lock-session-id": sessionId };
}

/** The M6 oracle: the template inserted into a blank v3 of the affaire, under the open policy. */
export async function insertTemplateOracle(ui: Ui, army: ArmyState, projectId: string, templateId: string, label: string) {
  const versionId = await createV3Version(ui, army, projectId, `${army.runPrefix} oracle M6 ${label}`);
  await takeLease(ui.browser, versionId);
  const inserted = await apiRequest<Envelope<{ converted_lines?: unknown[] }>>(ui.browser, "POST",
    `/api/estimates/templates/${templateId}/insert`, { version_id: versionId }, await leaseSession(ui.browser, versionId));
  await recordEvidence(army, `v3c-oracle-${label}`, { versionId, templateId, response: inserted });
  expect([inserted.status, inserted.body.ok]).toEqual([200, true]);
  await releaseVersion(ui.browser, versionId);
  return { versionId, convertedLines: inserted.body.data.converted_lines ?? null };
}

/** POST /api/estimates/templates/{id}/instantiate, the wizard's « Depuis un modèle » request. */
export async function instantiateTemplate(ui: Ui, army: ArmyState, templateId: string, body: Record<string, unknown>, label: string) {
  const response = await apiRequest<Envelope<{ projectId?: string; versionId?: string } & Record<string, unknown>>>(
    ui.browser, "POST", `/api/estimates/templates/${templateId}/instantiate`, body);
  await recordEvidence(army, `v3c-instantiate-${label}`, { templateId, body, response });
  const { projectId, versionId } = response.body.data ?? {};
  if (projectId && versionId) ownEstimate(army, { projectId, versionId });
  return response;
}

/* ---------- Actions serveur ---------- */

/** Built id of a server action by its exported name, in the build the runner serves (`.e2e/army/next`). */
export async function serverActionId(name: string, manifest = ".e2e/army/next/server/server-reference-manifest.json") {
  const reference = JSON.parse(await readFile(manifest, "utf8")) as
    { node: Record<string, { exportedName?: string }> };
  const found = Object.entries(reference.node).filter(([, entry]) => entry.exportedName === name);
  if (found.length !== 1) throw new Error(`Built server action ${name} is missing or ambiguous.`);
  return found[0]![0];
}

/**
 * Calls a server action of the current page as its client does (one argument of plain JSON). Status and error
 * digest plus the public failure envelope only; never retain the raw Flight payload.
 */
export async function callServerAction(browser: Browser, id: string, argument: Record<string, JsonValue>) {
  return browser.evaluate(async (input) => {
    const response = await fetch(location.href, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "text/plain;charset=UTF-8", "next-action": input.id }, body: JSON.stringify([input.argument]),
    });
    const text = await response.text();
    const envelopes: Array<{ ok: boolean; error?: { status?: number; code?: string; message?: string } }> = [];
    for (const line of text.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      try {
        const value = JSON.parse(line.slice(separator + 1));
        if (value && typeof value === "object" && typeof value.ok === "boolean") envelopes.push(value);
      } catch { /* Flight also contains non-JSON records. */ }
    }
    const envelope = envelopes.length === 1 ? envelopes[0] : null;
    return { status: response.status, digest: /"digest":"([^"]+)"/.exec(text)?.[1] ?? null,
      ok: envelope?.ok ?? null, errorStatus: envelope?.error?.status ?? null,
      errorCode: envelope?.error?.code ?? (envelope ? null : "INVALID_ACTION_ENVELOPE"),
      errorMessage: envelope?.error?.message ?? null };
  }, { id, argument });
}

/** Read only the public confirmation envelope from the Server Action's Flight response. */
export async function confirmTakeoffPreparationViaAction(browser: Browser, input: {
  actionId: string; projectId: string; expectedRevision: number;
}) {
  return browser.evaluate(async (request) => {
    const response = await fetch(location.href, {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "text/plain;charset=UTF-8", "next-action": request.actionId },
      body: JSON.stringify([{ projectId: request.projectId, expectedRevision: request.expectedRevision }]),
    });
    const text = await response.text();
    const envelopes: Array<{ ok: boolean; data?: { revision?: number }; error?: { code?: string } }> = [];
    for (const line of text.split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      try {
        const value = JSON.parse(line.slice(separator + 1));
        if (value && typeof value === "object" && typeof value.ok === "boolean") envelopes.push(value);
      } catch { /* Flight also includes non-JSON records that are not the action envelope. */ }
    }
    const envelope = envelopes.length === 1 ? envelopes[0] : null;
    return { status: response.status, digest: /"digest":"([^"]+)"/.exec(text)?.[1] ?? null,
      ok: envelope?.ok ?? false, revision: envelope?.data?.revision ?? null,
      errorCode: envelope?.error?.code ?? (envelope ? null : "INVALID_ACTION_ENVELOPE") };
  }, input);
}

/* ---------- Captures ---------- */

/**
 * A capture of a visible state for the pull request. e2e 0.21.3 keeps the file after a secret fill
 * and masks secure fields; the stored path stays relative to the output root.
 */
export async function captureScreen(ui: Ui, army: ArmyState, label: string) {
  // Finite animations (dialog opening, menu closing) end first, within 3 s.
  await ui.browser.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.race([Promise.all(finite.map((animation) => animation.finished.catch(() => null))),
      new Promise((resolve) => setTimeout(resolve, 3_000))]);
    return true;
  });
  const pixels = { status: "captured", file: await relativeOutputPath(await ui.app.screenshot(label)) };
  await recordEvidence(army, `${label}-capture`, pixels);
  return pixels;
}

/* ---------- Projections de lignes ---------- */

export type LineFacts = {
  title: string; unitCode: string | null; description: string | null; status: string | null; quantity: number | null;
  hPerUnit: number | null; hMo: number | null; prFo: number | null; pu: number | null; net: number | null; tax: number | null;
  roleId: string | null;
};

export function lineFacts(item: ArmyItem): LineFacts {
  return {
    title: item.title, unitCode: (item.unit_code as string | null | undefined) ?? null,
    description: (item.description as string | null | undefined) ?? null,
    status: (item.pricing_status as string | null | undefined) ?? null, quantity: num(item.quantity),
    hPerUnit: num(item.h_mo_per_unit), hMo: num(item.h_mo), prFo: num(item.unit_price_ht_cents), pu: num(item.pu_ht_cents),
    net: num(item.line_total_ht_cents), tax: num(item.line_tax_cents), roleId: (item.labor_role_id as string | null | undefined) ?? null,
  };
}

/** Lines and sections of a version, by title, with the version totals and gross. */
export function estimateFacts(state: ArmyEstimate) {
  const lines = state.items.filter((item) => item.item_type === "line").map(lineFacts).sort((a, b) => a.title.localeCompare(b.title));
  const sections = state.items.filter((item) => item.item_type === "section").map((item) => item.title).sort();
  return {
    sections, lines,
    totals: [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents],
    gross: num(state.version.gross_ht_cents),
  };
}

/* ---------- Assistant de création ---------- */

/** Opens the wizard with no restored draft (the draft survives a refused creation in localStorage). */
export async function openWizard(ui: Ui, projectId?: string) {
  await ui.browser.evaluate((key) => { try { localStorage.removeItem(key); } catch { /* none */ } return true; }, WIZARD_DRAFT_KEY);
  await ui.app.open(projectId ? `/dashboard/estimates/new?projectId=${projectId}` : "/dashboard/estimates/new");
  await expect(ui.screen.getByRole("heading", projectId ? "Nouvelle version" : "Nouveau chiffrage", { exact: true }))
    .toBeVisible({ timeout: 60_000 });
}

export async function fillProjectStep(ui: Ui, input: { projectName?: string; title: string }) {
  if (input.projectName) await ui.screen.getByLabel(/Nom du projet/).fill(input.projectName);
  await ui.screen.getByLabel(/Titre de la version/).fill(input.title);
}

export async function nextStep(ui: Ui) {
  await ui.screen.getByRole("button", "Suivant", { exact: true }).tap();
}

async function valueOfLabel(ui: Ui, label: string) {
  const field = ui.screen.getByLabel(label, { exact: true });
  return (await field.count()) === 1 ? normalized(await field.inputValue()) : null;
}

/** What the pricing step offers (§2 point 2): coefficient fields, margin controls, rounding choices. */
export async function readPricingStep(ui: Ui) {
  await expect(ui.screen.getByLabel(/Date devis/)).toBeVisible({ timeout: 30_000 });
  const marginControls: string[] = [];
  for (const name of ["Marge fixe", "Marge par tranche"]) {
    if ((await ui.screen.getByRole("button", name, { exact: true }).count()) > 0) marginControls.push(name);
  }
  if ((await ui.screen.getByLabel("Marge (%)", { exact: true }).count()) > 0) marginControls.push("Marge (%)");
  const roundingLabels = await ui.browser.evaluate(() => {
    const select = Array.from(document.querySelectorAll("label"))
      .find((label) => (label.textContent ?? "").trim() === "Arrondi")?.getAttribute("for");
    const element = select ? document.getElementById(select) : null;
    return element instanceof HTMLSelectElement ? Array.from(element.options).map((option) => option.textContent ?? "") : null;
  });
  return {
    saleCoefficientFo: await valueOfLabel(ui, "Coefficient de vente FO"),
    saleCoefficientMo: await valueOfLabel(ui, "Coefficient de vente MO"),
    marginControls,
    roundingOutsideV3: roundingLabels === null ? null
      : roundingLabels.map(normalized).filter((label) => label !== "Aucun" && !label.endsWith("— palier inférieur")),
  };
}

export async function fillLabelled(ui: Ui, label: string, value: string) {
  await ui.screen.getByLabel(label, { exact: true }).fill(value);
  await ui.browser.keyboard.press("Tab");
}

/** Selects the « Arrondi » option shown as `optionLabel` (spaces normalized: the amount uses a narrow space). */
export async function chooseRounding(ui: Ui, optionLabel: string) {
  const value = await ui.browser.evaluate((wanted) => {
    const clean = (text: string | null) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
    const id = Array.from(document.querySelectorAll("label")).find((label) => clean(label.textContent) === "Arrondi")?.getAttribute("for");
    const select = id ? document.getElementById(id) : null;
    if (!(select instanceof HTMLSelectElement)) return null;
    return Array.from(select.options).find((option) => clean(option.textContent) === clean(wanted))?.value ?? null;
  }, optionLabel);
  if (value === null) throw new Error(`Rounding option « ${optionLabel} » is not offered.`);
  await ui.screen.getByLabel("Arrondi", { exact: true }).selectOption({ value });
}

/** Fixed margin of N % in the v2 pricing step (stored as the multiplier 1 + N / 100). */
export async function chooseV2FixedMargin(ui: Ui, percent: string) {
  await ui.screen.getByRole("button", "Marge fixe", { exact: true }).tap();
  await fillLabelled(ui, "Marge (%)", percent);
}

export async function chooseTemplate(ui: Ui, templateId: string) {
  const templateMode = ui.screen.getByRole("button", "Depuis un modèle", { exact: true });
  await expect(templateMode).toBeEnabled({ timeout: 30_000 });
  await templateMode.tap();
  const select = ui.screen.getByLabel("Modèle (10 plus récents)", { exact: true });
  await expect.poll(() => ui.browser.evaluate((id) => Array.from(document.querySelectorAll("select option"))
    .some((option) => (option as HTMLOptionElement).value === id), templateId), { timeout: 30_000 }).toBe(true);
  await select.selectOption({ value: templateId });
}

export type WizardOutcome = {
  status: number | null;
  code: string | null;
  message: string | null;
  requestBodies: unknown[];
  responseData: Record<string, unknown> | null;
  alert: string | null;
  url: string;
  versionId: string | null;
  projectId: string | null;
};

async function visibleAlert(browser: Browser) {
  return browser.evaluate(() => {
    const text = Array.from(document.querySelectorAll("main [role=\"alert\"]"))
      .map((node) => (node.textContent ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
    return text.length > 0 ? text.join(" | ") : null;
  });
}

/**
 * Submits the wizard (« Créer le chiffrage » or « Créer directement ») and records the creation request as
 * the browser sent it, the response, and where the page went (editor or an alert in the wizard).
 */
export async function submitWizard(ui: Ui, army: ArmyState, label: string,
  input: { trigger: "create" | "quick"; endpoint: "estimates" | "instantiate" }): Promise<WizardOutcome> {
  const pattern = input.endpoint === "estimates" ? /\/api\/estimates(?:\?.*)?$/ : /\/api\/estimates\/templates\/[0-9a-f-]{36}\/instantiate(?:\?.*)?$/i;
  const requestBodies: unknown[] = [];
  await ui.browser.route(pattern, async (route) => {
    if (route.request.method === "POST") {
      try { requestBodies.push(JSON.parse(route.request.postData ?? "null")); } catch { requestBodies.push({ unreadable: true }); }
    }
    await route.fallback();
  });
  try {
    const button = input.trigger === "create"
      ? ui.screen.getByRole("button", "Créer le chiffrage", { exact: true })
      : ui.screen.getByRole("button", "Créer directement", { exact: true });
    const [response] = await Promise.all([ui.browser.waitForResponse(pattern, { timeout: 120_000 }), button.tap()]);
    const body = await response.json<Envelope<Record<string, unknown>>>().catch(() => null);
    await expect.poll(async () => EDITOR_URL.test(await ui.browser.url()) || (await visibleAlert(ui.browser)) !== null,
      { timeout: 60_000 }).toBe(true);
    const url = await ui.browser.url();
    const data = body?.ok ? body.data : null;
    const project = (data?.project as { id?: string } | undefined)?.id ?? (data?.projectId as string | undefined) ?? null;
    const version = (data?.version as { id?: string } | undefined)?.id ?? (data?.versionId as string | undefined) ?? null;
    const outcome: WizardOutcome = {
      status: response.status, code: body?.error?.code ?? null, message: body?.error?.message ?? null, requestBodies,
      responseData: data, alert: EDITOR_URL.test(url) ? null : await visibleAlert(ui.browser), url,
      versionId: version, projectId: project,
    };
    if (outcome.projectId && outcome.versionId) ownEstimate(army, { projectId: outcome.projectId, versionId: outcome.versionId });
    await recordEvidence(army, `v3c-wizard-${label}`, outcome);
    return outcome;
  } finally {
    await ui.browser.unroute(pattern);
  }
}

/** The version part of the wizard's creation request (POST /api/estimates) as the browser sent it. */
export function sentVersion(outcome: WizardOutcome) {
  const body = outcome.requestBodies.at(-1) as { version?: Record<string, unknown> } | undefined;
  return body?.version ?? null;
}

/** The expectation a creation request carries: `version.expected_calc_engine_version`, or top level (template). */
export function sentExpectation(outcome: WizardOutcome) {
  const body = (outcome.requestBodies.at(-1) ?? {}) as Record<string, unknown>;
  const version = (body.version ?? {}) as Record<string, unknown>;
  return version.expected_calc_engine_version ?? body.expected_calc_engine_version ?? body.expectedCalcEngineVersion ?? null;
}

/** Text of the page polled for a while (a toast shown after the navigation to the editor). */
export async function waitPageText(ui: Ui, needles: readonly string[], timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  for (;;) {
    text = normalized(await ui.browser.evaluate(() => document.body.innerText));
    if (needles.every((needle) => text.includes(normalized(needle))) || Date.now() > deadline) break;
    await pause(500);
  }
  return { text, missing: needles.filter((needle) => !text.includes(normalized(needle))) };
}

/* ---------- Accueil d'une nouvelle affaire ---------- */

/** « Nouvelle affaire » → « Créer l'affaire » (initializeAffaireDraft), then the editor or an error. */
export async function createAffaireFromOnboarding(ui: Ui, army: ArmyState, projectName: string, label: string) {
  await ui.app.open("/dashboard/affaires/new");
  await expect(ui.screen.getByRole("heading", "Nouvelle affaire", { exact: true })).toBeVisible({ timeout: 60_000 });
  await ui.browser.locator("#details-project-name").fill(projectName);
  await ui.screen.getByRole("button", "Créer l'affaire", { exact: true }).tap();
  await expect.poll(async () => EDITOR_URL.test(await ui.browser.url()) || (await visibleAlert(ui.browser)) !== null,
    { timeout: 90_000 }).toBe(true);
  const url = await ui.browser.url();
  const outcome = { url, versionId: url.match(EDITOR_URL)?.[1] ?? null, alert: EDITOR_URL.test(url) ? null : await visibleAlert(ui.browser) };
  await recordEvidence(army, `v3c-onboarding-${label}`, outcome);
  return outcome;
}

/* ---------- DPGF lié par le hub ---------- */

export type LinkedDpgf = { importId: string; filename: string; lines: { tube: string; robinet: string } };

/**
 * A two-line DPGF CSV linked to the affaire through the hub's import flow, mapping only (« Retour au hub ») :
 * nothing is created, the import becomes the affaire's linked DPGF source that the wizard offers by default.
 */
export async function linkDpgfThroughHub(ui: Ui, army: ArmyState, projectId: string): Promise<LinkedDpgf> {
  const { app, screen, browser } = ui;
  const token = randomUUID().replaceAll("-", "").slice(0, 10);
  const headers = ["Référence article", "Désignation", "Quantité", "Unité", "Prix fourniture", "Montant HT"].map((label) => `${label} ${token}`);
  // The upload API exposes normalized source keys (dpgf-import.e2e.ts).
  const sourceHeaders = ["Reference_article", "Designation", "Quantite", "Unite", "Prix_fourniture", "Montant_HT"].map((label) => `${label}_${token}`);
  const targets = ["hex_code", "designation", "quantity", "unit", "unit_price_ht", "total_ht"];
  const lines = { tube: `${army.runPrefix} tube cuivre`, robinet: `${army.runPrefix} robinet laiton` };
  const rows = [["R01", lines.tube, "2", "m", "12,50", "25,00"], ["R02", lines.robinet, "1", "u", "65,00", "65,00"]];
  const cell = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`;
  const csv = `﻿${[headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n")}\r\n`;
  const filename = `${army.runPrefix}-dpgf-lie.csv`;
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
  await mkdir(directory, { recursive: true });
  const fixturePath = path.join(directory, filename);
  await writeFile(fixturePath, csv, "utf8");

  await app.open(`/dashboard/affaires/${projectId}?created=1`);
  await screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
  const input = browser.locator('input[type="file"]:not([multiple])');
  const launch = screen.getByRole("button", "Lancer l'import", { exact: true });
  await expect.poll(async () => {
    if (!(await launch.isVisible())) await input.setInputFiles(fixturePath);
    return launch.isVisible();
  }, { timeout: 30_000 }).toBe(true);
  await launch.tap();
  const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
  const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
  await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), { timeout: 60_000 }).toBe(true);
  if (await editMapping.isVisible()) await editMapping.tap();
  const column = (header: string) => screen.getByRole("row").filter({ has: screen.getByText(header, { exact: true }) }).getByRole("combobox");
  for (const [index, header] of sourceHeaders.entries()) await column(header).selectOption({ value: targets[index]! });
  await expect(nextMapping).toBeEnabled();
  await nextMapping.tap();
  const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
  await expect(nextPreview).toBeEnabled({ timeout: 60_000 });
  await nextPreview.tap();
  const backToHub = screen.getByRole("button", "Retour au hub", { exact: true });
  await expect(backToHub).toBeEnabled({ timeout: 30_000 });
  await backToHub.tap();
  let source: { status: number; body: Envelope<Record<string, unknown> | null> } | null = null;
  await expect.poll(async () => {
    source = await apiRequest<Envelope<Record<string, unknown> | null>>(browser, "GET", `/api/affaires/${projectId}/dpgf-source`);
    const data = source.body.data ?? {};
    return [data.importStatus ?? data.import_status, data.mappedRowCount ?? data.mapped_row_count];
  }, { timeout: 60_000 }).toEqual(["completed", 2]);
  const data = (source!.body.data ?? {}) as Record<string, unknown>;
  const importId = String(data.importId ?? data.import_id);
  await recordEvidence(army, "v3c-linked-dpgf", { projectId, filename, fixturePath, csv, source });
  expect(importId).toMatch(UUID);
  return { importId, filename, lines };
}

export async function seedSupplyLine(ui: Ui, versionId: string, title: string, engine: 2 | 3) {
  await takeLease(ui.browser, versionId);
  const empty = await readEstimate(ui.browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title: `${title} lot` }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const current = await readEstimate(ui.browser, versionId);
  const line = { item_type: "line", parent_id: section.body.data.item.id, position: 1, title, line_nature: "supply_only", quantity: 1,
    unit_price_ht_cents: 10000, tax_rate_bp: 2000, k_fo: 1, h_mo_majoration: 1, k_mo: 1 };
  if (engine === 2) {
    const created = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
      { ...line, description: "u", h_mo: 0 }, { "if-match": current.version.updated_at });
    expect([created.status, created.body.ok]).toEqual([201, true]);
  } else {
    const batch = await apiRequest<Envelope<{ committed: boolean }>>(ui.browser, "POST", `/api/estimates/${versionId}/batch`,
      { operation_key: randomUUID(), operations: [{ op: "create", data: { ...line, unit_code: "u", pricing_status: "priced", h_mo_per_unit: 0 } }] },
      { "if-match": current.version.updated_at });
    expect([batch.status, batch.body.ok, batch.body.data?.committed]).toEqual([200, true, true]);
  }
  await releaseVersion(ui.browser, versionId);
}
