import { randomUUID } from "node:crypto";

import { expect, type Locator } from "e2e";

import { apiRequest, readEstimate, recordEvidence, type ArmyItem, type ArmyState } from "../critical/fixtures";
import { closePolicy, createLaborRole, createV2Affaire, createV3Version, openPolicy3, type Ui } from "./engine-v3-creators-support";
import {
  checkpoint, eur, lineView, lockVersion, normalized, openV3Editor, readConsistent, releaseVersion, switchToExpertMode,
  waitForDraftLease, type Envelope, type LineView, type V3Draft,
} from "./engine-v3-editor-support";
import type { V3Owner } from "./engine-v3-persistence-support";

// Reprise des prix d'un devis de référence (docs/metier/reprise-des-prix.md). Deux affaires du même propriétaire :
// la référence (marché « hydraulique » déjà chiffré) et la cible (consultation « plomberie » métrée, sans prix).
// Désignations fictives inspirées du format OPTIMA : DN, dimensions, épaisseurs et unités sont les pièges réels.

const supply = (title: string, unit: string, quantity: number, prCents: number, extra: Record<string, unknown> = {}) => ({
  line_nature: "supply_only", title, unit_code: unit, pricing_status: "priced", quantity, unit_price_ht_cents: prCents,
  tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual", ...extra,
});
const withLabor = (title: string, unit: string, quantity: number, prCents: number, hoursPerUnit: number, roleId: string) => ({
  ...supply(title, unit, quantity, prCents), line_nature: "supply_and_labor", h_mo_per_unit: hoursPerUnit, labor_role_id: roleId,
});

export const REFERENCE_SECTION = "EAU FROIDE - Distribution";
export const TARGET_SECTION = "PLOMBERIE R+8 Z1";

export type PriceReuseFixture = {
  target: { projectId: string; versionId: string };
  reference: { projectId: string; versionId: string };
  tuyauteurId: string;
  /** T1-T3 et T6 : reprises possibles ; T4, T5 : sans correspondance (prix non chiffré, autre unité). */
  lines: Record<"T1" | "T2" | "T3" | "T4" | "T5" | "T6", ArmyItem>;
  /** R3 (RBS) et R6 (papillon) : les deux candidats de T3, R3 proposé par le rapprochement. */
  references: Record<"R1" | "R2" | "R3" | "R4" | "R5" | "R6", ArmyItem>;
};

async function seedSection(ui: Ui, army: ArmyState, versionId: string, title: string, lines: Array<Record<string, unknown>>, label: string) {
  await lockVersion(ui.browser, versionId);
  const empty = await readEstimate(ui.browser, versionId);
  const section = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${versionId}/items`,
    { item_type: "section", position: 1, title }, { "if-match": empty.version.updated_at });
  expect([section.status, section.body.ok]).toEqual([201, true]);
  const before = await readEstimate(ui.browser, versionId);
  const request = { operation_key: randomUUID(), operations: lines.map((line, index) => ({
    op: "create", data: { item_type: "line", parent_id: section.body.data.item.id, position: index + 1, ...line } })) };
  const response = await apiRequest<Envelope<{ committed: boolean; results: Array<{ status: string }> }>>(ui.browser, "POST",
    `/api/estimates/${versionId}/batch`, request, { "if-match": before.version.updated_at });
  await recordEvidence(army, `${label}-seed`, { versionId, request, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  await releaseVersion(ui.browser, versionId);
  const state = await readEstimate(ui.browser, versionId);
  return lines.map((line) => {
    const item = state.items.find((candidate) => candidate.item_type === "line" && candidate.title === line.title);
    if (!item) throw new Error(`Seeded line ${String(line.title)} is missing.`);
    return item;
  });
}

/** Both affaires, the « Tuyauteur » role at 4 000 c/h, two v3 created under policy 3 (1,30 / 1,20), then policy 2 again. */
export async function preparePriceReuseFixture(ui: Ui, army: ArmyState, owner: V3Owner, label: string): Promise<PriceReuseFixture> {
  const target = await createV2Affaire(ui, army, `ARMY-PRX-${label}-plomberie-${army.runPrefix}`);
  const reference = await createV2Affaire(ui, army, `ARMY-PRX-${label}-hydraulique-${army.runPrefix}`);
  const tuyauteurId = await createLaborRole(ui, army, target.versionId, "Tuyauteur", 4000, `${label.toLowerCase()}-labor-role`);
  await openPolicy3(owner, army, label);
  let targetVersionId: string;
  let referenceVersionId: string;
  try {
    targetVersionId = await createV3Version(ui, army, target.projectId, `${army.runPrefix} ${label} consultation plomberie`);
    referenceVersionId = await createV3Version(ui, army, reference.projectId, `${army.runPrefix} ${label} contrat hydraulique`);
  } finally {
    await closePolicy(owner, army, label);
  }
  const [R1, R2, R3, R4, R5, R6] = await seedSection(ui, army, referenceVersionId, REFERENCE_SECTION, [
    withLabor("Tube cuivre Ø22x1 calorifugé ép. 13 mm", "ml", 1, 1250, 0.35, tuyauteurId),
    withLabor("Vanne d'arrêt RBS DN32", "u", 1, 2900, 0.65, tuyauteurId),
    withLabor("Vanne d'arrêt RBS DN40", "u", 1, 4100, 0.7, tuyauteurId),
    withLabor("Calorifuge laine nu 54x30mm - DN50", "m2", 1, 2812, 0.61, tuyauteurId),
    supply("Pompe de relevage", "u", 1, 0, { pricing_status: "included" }),
    withLabor("Vanne d'arrêt papillon DN40", "u", 1, 3600, 0.9, tuyauteurId),
  ], `${label.toLowerCase()}-reference`);
  const [T1, T2, T3, T4, T5, T6] = await seedSection(ui, army, targetVersionId, TARGET_SECTION, [
    supply("Tube cuivre diam. 22 x 1 calorifuge epaisseur 13mm", "ml", 40, 0),
    supply("Vanne d'arret RBS DN 32", "u", 6, 0),
    supply("Vanne d'arrêt DN40", "u", 4, 0),
    supply("Pompe de relevage", "u", 2, 0),
    supply("Calorifuge laine nu 54x30mm - DN50", "ml", 12, 0),
    withLabor("Vanne d'arrêt RBS DN32", "u", 2, 2500, 0.5, tuyauteurId),
  ], `${label.toLowerCase()}-target`);
  return {
    target: { projectId: target.projectId, versionId: targetVersionId },
    reference: { projectId: reference.projectId, versionId: referenceVersionId },
    tuyauteurId, lines: { T1, T2, T3, T4, T5, T6 }, references: { R1, R2, R3, R4, R5, R6 },
  };
}

/** A write to the reference after the comparison (a renamed line): the comparison is stale for the apply. */
export async function renameReferenceLine(ui: Ui, army: ArmyState, versionId: string, itemId: string, title: string) {
  await lockVersion(ui.browser, versionId);
  const before = await readEstimate(ui.browser, versionId);
  const response = await apiRequest<Envelope<{ committed: boolean }>>(ui.browser, "POST", `/api/estimates/${versionId}/batch`,
    { operation_key: randomUUID(), operations: [{ op: "update", id: itemId, data: { title } }] }, { "if-match": before.version.updated_at });
  await recordEvidence(army, "prx-reference-changed", { versionId, itemId, response });
  expect([response.status, response.body.ok, response.body.data?.committed]).toEqual([200, true, true]);
  await releaseVersion(ui.browser, versionId);
}

export const priceReuseDialog = (ui: Ui) =>
  ui.screen.getByRole("dialog", "Reprendre les prix d’un devis de référence", { exact: true });

/** Opens the target editor, then the dialog from « Affichage & contrôle », and compares with the reference. */
export async function openAndCompare(ui: Ui, army: ArmyState, fixture: PriceReuseFixture, label: string) {
  await switchToExpertMode(ui);
  await openV3Editor(ui, army, { versionId: fixture.target.versionId } as V3Draft, label);
  await waitForDraftLease(ui);
  await ui.screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
  await ui.screen.getByTestId("estimate-editor-display-button", { visible: true }).tap();
  await ui.screen.getByTestId("estimate-editor-price-reuse-button").tap();
  const dialog = priceReuseDialog(ui);
  const select = dialog.getByLabel("Devis de référence", { exact: true });
  await expect(select).toBeVisible({ timeout: 60_000 });
  await select.selectOption({ value: fixture.reference.versionId });
  await dialog.getByRole("button", "Comparer", { exact: true }).tap();
  await expect(dialog.getByTestId("price-reuse-summary")).toBeVisible({ timeout: 90_000 });
  return dialog;
}

export async function readRows(ui: Ui) {
  return ui.browser.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("[data-testid=\"price-reuse-row\"]"))
    .map((row) => {
      const checkbox = row.querySelector("input[type=\"checkbox\"]");
      const select = row.querySelector("select");
      return [row.getAttribute("data-line-id"), {
        status: row.getAttribute("data-status"),
        checked: checkbox instanceof HTMLInputElement ? checkbox.checked : null,
        reference: select instanceof HTMLSelectElement ? select.value || null : null,
        origin: (row.querySelector("[data-testid=\"price-reuse-origin\"]")?.textContent ?? "").replace(/\s+/g, " ").trim(),
      }];
    })));
}

export const rowCheckbox = (dialog: Locator, title: string) =>
  dialog.getByRole("checkbox", `Reprendre le prix pour « ${title} »`, { exact: true });

/**
 * PRX02, on the ChatGPT local server and its fixtures: each arbiter receives only the line to review (T3) with the
 * candidates found by the matcher, its answer stays a proposal until the user retains it, then the writer applies it.
 */
export async function verifyPriceReuseArbitration(ui: Ui, army: ArmyState, owner: V3Owner,
  readTransport: () => Promise<Array<Record<string, unknown>>>) {
  const fixture = await preparePriceReuseFixture(ui, army, owner, "PRX02");
  const { T3 } = fixture.lines;
  const { R3, R6 } = fixture.references;
  const referenceBefore = await readEstimate(ui.browser, fixture.reference.versionId);
  const dialog = await openAndCompare(ui, army, fixture, "prx02");
  const status = dialog.getByTestId("price-reuse-ai-status");
  const arbitrate = async (provider: "Decisions" | "ChatGPT") => {
    const start = (await readTransport()).length;
    await dialog.getByRole("button", `Départager avec ${provider}`, { exact: true }).tap();
    await expect(status).toHaveText(`${provider} : 1 proposition pour 1 ligne à vérifier.`, { timeout: 120_000 });
    return { calls: (await readTransport()).slice(start), rows: await readRows(ui) };
  };
  // The matcher proposes R3 (tie, first); both fixtures answer the last candidate, R6: the row shows the AI's choice.
  expect((await readRows(ui))[T3.id]).toMatchObject({ reference: R3.id, origin: "À confirmer" });
  const decisions = await arbitrate("Decisions");
  const chatgpt = await arbitrate("ChatGPT");
  await recordEvidence(army, "prx02-arbitrations", { decisions, chatgpt });
  expect({ calls: decisions.calls, t3: decisions.rows[T3.id] }).toEqual({
    calls: [{ provider: "decisions-fixture", questions: 1 }],
    t3: { status: "to_review", checked: false, reference: R6.id, origin: "Decisions · 80 %" },
  });
  expect({ calls: chatgpt.calls.map(({ provider, task, lines }) => ({ provider, task, lines })), t3: chatgpt.rows[T3.id] }).toEqual({
    calls: [{ provider: "chatgpt-fixture", task: "price-reuse", lines: 1 }],
    t3: { status: "to_review", checked: false, reference: R6.id, origin: "ChatGPT · 70 %" },
  });
  await dialog.getByRole("button", "Retenir les propositions de l’IA (1)", { exact: true }).tap();
  await expect(rowCheckbox(dialog, T3.title)).toBeChecked();
  await dialog.getByRole("button", "Appliquer 3 reprises", { exact: true }).tap();
  await expect(dialog).toBeHidden({ timeout: 60_000 });
  // R6 « papillon » : PU ⌈3 600 × 1,01 × 1,30 + 0,9 × 4 000 × 1,20⌋ = 9 047, × 4 = 36 188.
  await verifyAppliedPrices(ui, army, fixture, "prx02", referenceBefore, { prFo: 3600, hPerUnit: 0.9, pu: 9047, net: 36188 });
}

const priceView = (view: LineView) => ({ title: view.title, unit: view.unit, quantity: view.quantity, prFo: view.prFo,
  hPerUnit: view.hPerUnit, roleId: view.roleId, pu: view.pu, net: view.net });

/**
 * After « Appliquer 3 reprises » (T1, T2 identiques, T3 confirmée) : prix de référence repris, quantités et désignations
 * du métré conservées, T6 (déjà chiffrée à la main) inchangée, T4/T5 intactes ; la référence n'est jamais écrite.
 * PU v3 = ⌈PR × 1,01 × 1,30 + h/u × 40 € × 1,20⌋ : T1 3 321, T2 6 928, T3 8 743, T6 5 683.
 */
export async function verifyAppliedPrices(ui: Ui, army: ArmyState, fixture: PriceReuseFixture, label: string,
  referenceBefore: Awaited<ReturnType<typeof readEstimate>>,
  t3 = { prFo: 4100, hPerUnit: 0.7, pu: 8743, net: 34972 }) {
  const summary = ui.screen.getByTestId("estimate-editor-alert-import-summary");
  await expect(summary).toBeVisible({ timeout: 60_000 });
  expect(normalized(await summary.textContent())).toBe("3 prix repris depuis le devis de référence.");
  const { T1, T2, T3, T4, T5, T6 } = fixture.lines;
  const role = fixture.tuyauteurId;
  const after = await readConsistent(ui, fixture.target.versionId);
  const view = (item: ArmyItem) => priceView(lineView(after.items.find((candidate) => candidate.id === item.id)!));
  const actual = { T1: view(T1), T2: view(T2), T3: view(T3), T4: view(T4), T5: view(T5), T6: view(T6) };
  await recordEvidence(army, `${label}-applied`, { versionId: fixture.target.versionId, actual });
  expect(actual).toEqual({
    T1: { title: T1.title, unit: "ml", quantity: 40, prFo: 1250, hPerUnit: 0.35, roleId: role, pu: 3321, net: 132840 },
    T2: { title: T2.title, unit: "u", quantity: 6, prFo: 2900, hPerUnit: 0.65, roleId: role, pu: 6928, net: 41568 },
    T3: { title: T3.title, unit: "u", quantity: 4, roleId: role, ...t3 },
    T4: { title: T4.title, unit: "u", quantity: 2, prFo: 0, hPerUnit: 0, roleId: null, pu: 0, net: 0 },
    T5: { title: T5.title, unit: "ml", quantity: 12, prFo: 0, hPerUnit: 0, roleId: null, pu: 0, net: 0 },
    T6: { title: T6.title, unit: "u", quantity: 2, prFo: 2500, hPerUnit: 0.5, roleId: role, pu: 5683, net: 11366 },
  });
  const referenceAfter = await readEstimate(ui.browser, fixture.reference.versionId);
  expect({ token: referenceAfter.version.updated_at, lines: referenceAfter.items.map((item) => [item.id, item.unit_price_ht_cents]) })
    .toEqual({ token: referenceBefore.version.updated_at, lines: referenceBefore.items.map((item) => [item.id, item.unit_price_ht_cents]) });
  const totalHt = 132840 + 41568 + t3.net + 11366;
  const tax = Math.round(totalHt * 0.2);
  await checkpoint(ui, army, `${label}-final`, fixture.target.versionId, {
    api: { version: { totals: [totalHt, tax, totalHt + tax] }, lines: { [T1.id]: { net: 132840 }, [T3.id]: { net: t3.net } } },
    screen: { chips: [`Total HT : ${eur(totalHt)}`] },
  });
}
