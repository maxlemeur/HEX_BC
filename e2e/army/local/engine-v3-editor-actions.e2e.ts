import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import {
  apiRequest, armyTest, readEstimate, recordEvidence, resolveDownload, saveLineEditsWithShortcut, waitForAutoSave,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
import { readWorkbookRows, type WorkbookRow } from "./engine-v3-emission-support";
import {
  BANNER, addGridLine, checkpoint, clickSaveSettings, eur, fillCell, grid, lineView, lockVersion, normalized, openSettings,
  openV3Editor, pause, prepareV3Draft, readConsistent, releaseVersion, seedLines, settingsDialog, switchToExpertMode,
  waitForDraftLease, type Envelope, type LineView, type Ui, type V3Draft,
} from "./engine-v3-editor-support";
import { insertProjectMarginRule } from "./engine-v3-persistence-support";

// Lot 2, sous-lot 2.6 (revue du 18/10/2026) — actions de la grille et du tiroir d'une v3 autres que la saisie d'une
// cellule, écrites rouges avant leurs corrections. Défaillances F26-10 (complément) et F26-21 à F26-32, contrat et
// preuves : docs/testing/estimate-engine-v3-2.6.md §11. Valeurs : moteur pur 2.4 (computeEstimateV3Breakdown,
// 40 €/h, coefficients 1,30 / 1,20), rejouées le 18/10/2026. Parcours :
//  V3E05 — suppression d'une ligne, d'une ligne ajoutée (annulation) et d'une section, annulation d'une suppression ;
//          unité inconnue ou statut refusés par la cellule « U » (F26-10) ;
//  V3E06 — majoration, déplacement et suppression en lot, et leur annulation ;
//  V3E07 — taux horaire d'un rôle changé dans le tiroir : totaux stockés recalculés, fiche = éditeur ; totaux d'en-tête
//          et historique des versions de la fiche dans la devise de chaque version (revue Codex de la PR #44, F2) ;
//  V3E08 — colonnes « Deboursé sec », « Marge € », « Marque % » lues dans le moteur ; contrôle « Temps MO manquant » ;
//  V3E09 — « Associer ou remplacer l’article » juge l'offre dans unit_code et n'écrit jamais description ; un prix de
//          référence (sans offre) dans une autre unité est refusé par la fiche et par la suggestion de la désignation
//          (revue Codex de la PR #44, F1) ;
//  V3E10 — question de propagation de la TVA ouverte par Ctrl+S et par l'enregistrement à la fermeture du tiroir ;
//  V3E11 — remise de 0 % enregistrée sans état « en attente » ; palier d'arrondi hors liste affiché tel qu'appliqué ;
//          action modèle de la fiche fermée par son nom ; depuis la fusion de 2.7 (émission v3), le PDF y est ouvert
//          (doc 2.7 §13 ; sa génération par la fiche est prouvée par V3M05) ;
//  V3E15 — fusion de 2.7 : l'éditeur d'une v3 propose « Exporter Excel » et « Exporter DPGF » (routes serveur de 2.7,
//          classeurs v3) ; « Exporter CSV » et « Exporter BDC V1.1 » y sont ouverts par 2.7b (D-a ; V3X03 à V3X05) ;
//  V3E12 — suggestions en lot appliquées et annulées par l'écrivain v3 ;
//  V3E13 — collage de lignes écrit par l'écrivain v3 (unité du référentiel, jamais description ni heures totales), et
//          son annulation (sous-lot 2.8, qui lève le refus nommé de la revue du 2.6) ;
//  V3E14 — un enregistrement des réglages v3 (« Oui » à la propagation de la TVA) ferme l'annulation d'une majoration
//          en lot et celle des suggestions, qui réécriraient l'ancien taux (fusion de la PR #41 avec 2.6,
//          docs/testing/version-totals-after-bulk-actions.md).
// Sous-lot 2.6b (docs/testing/estimate-engine-v3-2.6b.md), écrits rouges avant leurs corrections :
//  V3E16 — G1 : lignes inc / PM / HL d'une v3 à 0 € sans prix ni temps manquant (porte d'envoi, éditeur) ; garde v2 ;
//  V3E17 — éditeur mobile (375 × 812) : unité du référentiel et heures par unité, gel v3 accepté ;
//  V3E18 — restauration d'un brouillon en conflit par l'écrivain v3, jamais la marge v2 ;
//  V3E19 — unité d'une règle de suggestion écrite dans unit_code en lot et sur une ligne ; unité inconnue refusée par
//          son nom ; une unité choisie n'est jamais remplacée (revue de 2.6b, A15).
// Le refus générique du moteur 3 (bandeau de 2.1) n'est jamais une issue admise d'une action de la grille v3.
const options = (timeout: number) => ({ session: "army", tags: ["critical", "local", "engine-v3"], timeout }) as const;

type Totals = [number, number, number];
const chips = (totals: Totals, rate = "20", extra: string[] = []) => [
  `Total HT : ${eur(totals[0])}`, `TVA : ${eur(totals[1])}`, `TVA ${rate} % : ${eur(totals[1])}`, `TTC à payer : ${eur(totals[2])}`, ...extra,
];
const apostrophes = (text: string) => text.replace(/[’']/g, "'");
// Messages nommés retenus par la revue (doc 2.6 §11.2).
// Fusion de 2.7 : seul l'enregistrement comme modèle reste fermé (2.8) ; l'ancienne raison, qui nommait le PDF, disparaît.
const DETAIL_TEMPLATE_REASON = "Moteur de calcul 3 : l’enregistrement comme modèle n’est pas encore disponible pour ce devis.";
const DETAIL_ACTIONS_REASON_2_6 = "Moteur de calcul 3 : le PDF et l’enregistrement comme modèle ne sont pas encore disponibles";
const UNIT_REFUSED = "Unité différente du devis";

const supply = (title: string, quantity: number, prCents: number, extra: Record<string, unknown> = {}) => ({
  line_nature: "supply_only", title, unit_code: "u", pricing_status: "priced", quantity, unit_price_ht_cents: prCents, tax_rate_bp: 2000,
  k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual", ...extra,
});
const withLabor = (title: string, quantity: number, prCents: number, hoursPerUnit: number, roleId: string, extra: Record<string, unknown> = {}) => ({
  ...supply(title, quantity, prCents, extra), line_nature: "supply_and_labor", h_mo_per_unit: hoursPerUnit, labor_role_id: roleId,
});

async function recordDialogs(ui: Ui) {
  const dialogs: string[] = [];
  // A native dialog (beforeunload of a navigation) must not latch as unhandled; each one is recorded.
  await ui.browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.accept(); });
  return dialogs;
}

const totalsOf = (state: ArmyEstimate): Totals => [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents];
const sameTotals = (state: ArmyEstimate, totals: Totals) => JSON.stringify(totalsOf(state)) === JSON.stringify(totals);
const lineIds = (state: ArmyEstimate) => state.items.filter(item => item.item_type === "line").map(item => item.id);
const lineByTitle = (state: ArmyEstimate, title: string) => state.items.find(item => item.item_type === "line" && item.title === title) ?? null;
const pickLine = (item: ArmyItem | null, keys: Array<keyof LineView>) => {
  if (!item) return null;
  const view = lineView(item);
  return Object.fromEntries(keys.map(key => [key, view[key]]));
};
const LINE_INPUTS: Array<keyof LineView> = ["unit", "status", "quantity", "prFo", "hPerUnit", "pu", "net", "taxRateBp", "roleId"];

/** Polls the persisted estimate (no save is triggered here); the caller asserts on what it returns. */
async function waitState(ui: Ui, versionId: string, ready: (state: ArmyEstimate) => boolean, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let state = await readConsistent(ui, versionId);
  while (!ready(state) && Date.now() < deadline) {
    await pause(1_000);
    state = await readConsistent(ui, versionId);
  }
  return state;
}

/** Reads until true or the deadline; never a retry of an action (each caller asserts what it returns). */
async function becomes(read: () => Promise<boolean>, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read().catch(() => false);
  while (!value && Date.now() < deadline) {
    await pause(500);
    value = await read().catch(() => false);
  }
  return value;
}

async function pageText(ui: Ui) {
  return apostrophes(normalized(await ui.browser.evaluate(() => document.body.innerText)));
}

/** Label of the ribbon's synchronisation status (« À jour », « En attente », …). */
async function autoSaveStatus(ui: Ui) {
  return normalized(await ui.browser.evaluate(() =>
    document.querySelector("[data-testid=\"estimate-page-toolbar-autosave-status\"]")?.textContent ?? null));
}

/** The 2.1 engine banner text: a grid action of the v3 editor must never end on it (F26-17's rule, extended). */
async function genericRefusalShown(ui: Ui) {
  return (await pageText(ui)).includes(apostrophes(BANNER));
}

async function seedSection(ui: Ui, army: ArmyState, draft: V3Draft, label: string, title: string, position: number) {
  await lockVersion(ui.browser, draft.versionId);
  const before = await readEstimate(ui.browser, draft.versionId);
  const response = await apiRequest<Envelope<{ item: ArmyItem }>>(ui.browser, "POST", `/api/estimates/${draft.versionId}/items`,
    { item_type: "section", position, title }, { "if-match": before.version.updated_at });
  await recordEvidence(army, `v3e-seed-${label}`, { versionId: draft.versionId, title, response });
  expect([response.status, response.body.ok]).toEqual([201, true]);
  await releaseVersion(ui.browser, draft.versionId);
  return response.body.data.item;
}

/**
 * A settings write by the API (same contract as V3P01): the lease is taken over from any open editor page, then
 * handed back, so that the page opened next takes it again (waitForDraftLease).
 */
async function patchSettingsByApi(ui: Ui, army: ArmyState, draft: V3Draft, label: string, patch: Record<string, unknown>) {
  const lock = await apiRequest(ui.browser, "POST", `/api/estimates/${draft.versionId}/lock`);
  if (lock.status !== 201) {
    const lease = await apiRequest(ui.browser, "PATCH", `/api/estimates/${draft.versionId}/lock?force=true`);
    expect(lease.status).toBe(200);
  }
  const before = await readEstimate(ui.browser, draft.versionId);
  const response = await apiRequest<Envelope<unknown>>(ui.browser, "PATCH", `/api/estimates/${draft.versionId}`,
    { ...patch, expected_content_revision: before.version.content_revision }, { "if-match": before.version.updated_at });
  await recordEvidence(army, `v3e-settings-api-${label}`, { versionId: draft.versionId, patch, response });
  expect([response.status, response.body.ok]).toEqual([200, true]);
  await releaseVersion(ui.browser, draft.versionId);
}

async function openGrid(ui: Ui, versionId: string) {
  await ui.browser.goto(`/dashboard/estimates/${versionId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
  await waitForDraftLease(ui);
}

async function showPreset(ui: Ui, preset: "Standard" | "Complet") {
  await ui.screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
  const display = ui.screen.getByTestId("estimate-editor-display-button", { visible: true });
  await display.tap();
  await ui.screen.getByRole("button", preset, { exact: true }).tap();
  await display.tap();
}

async function confirmDeletion(ui: Ui) {
  const dialog = ui.screen.getByRole("dialog", "Confirmer la suppression", { exact: true });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", "Supprimer", { exact: true }).tap();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
}

async function undo(ui: Ui) {
  const button = ui.screen.getByTestId("estimate-editor-undo-button", { visible: true });
  await expect(button).toBeEnabled({ timeout: 30_000 });
  await button.tap();
}

armyTest("V3E05 a v3 line, an added line and a section are deleted, and a deletion undone, through the v3 writer: totals recomputed, inputs kept, never the generic refusal",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E05");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    // A : 2 u, 100,00 € + 1 h/u × 40 € → PU 178,00 € ; B 50,00 € → 65,00 € ; C 10,00 € → 13,00 € ; D (lot T) 20,00 € → 26,00 €.
    const [lineA, lineB, lineC] = await seedLines(ui, army, draft, "v3e05", [
      withLabor(title("A"), 2, 10000, 1, draft.tuyauteurId), supply(title("B"), 1, 5000), supply(title("C"), 1, 1000)]);
    const sectionT = await seedSection(ui, army, draft, "v3e05-section", `${army.runPrefix} lot T`, 2);
    const [lineD] = await seedLines(ui, army, draft, "v3e05-d", [supply(title("D"), 1, 2000)], sectionT.id);
    expect([lineA.line_total_ht_cents, lineB.line_total_ht_cents, lineC.line_total_ht_cents, lineD.line_total_ht_cents])
      .toEqual([35600, 6500, 1300, 2600]);
    const initial: Totals = [46000, 9200, 55200];
    const withoutC: Totals = [44700, 8940, 53640];
    const withoutT: Totals = [43400, 8680, 52080];
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e05");
    await waitForDraftLease(ui);

    // F26-10 (complément de la revue) : une unité inconnue, puis un statut, sont refusés par leur nom ; la cellule se
    // quitte (Tab) ; rien n'est écrit, unit_code reste « u ».
    const unitView = () => browser.evaluate((label) => {
      const input = Array.from(document.querySelectorAll("input")).find(node => node.getAttribute("aria-label") === label) ?? null;
      const describedBy = input?.getAttribute("aria-describedby") ?? null;
      const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
      return {
        value: input ? input.value : null, invalid: input?.getAttribute("aria-invalid") ?? null,
        message: describedBy ? clean(document.getElementById(describedBy)?.textContent) : null, focusLeft: document.activeElement !== input,
      };
    }, `Unité pour ${lineB.title}`);
    const refusals: Array<{ typed: string; expected: unknown; actual: unknown }> = [];
    for (const [typed, message] of [
      ["xyz", "Unité inconnue du référentiel : « xyz »."],
      ["HL", "« HL » est un statut de ligne, pas une unité : choisissez-le dans la colonne Statut."],
    ] as const) {
      await fillCell(ui, `Unité pour ${lineB.title}`, typed);
      refusals.push({ typed, expected: { value: typed, invalid: "true", message, focusLeft: true }, actual: await unitView() });
    }
    await fillCell(ui, `Unité pour ${lineB.title}`, "u");
    const afterRefusals = await readConsistent(ui, draft.versionId);
    await recordEvidence(army, "v3e05-unit-refusals", { versionId: draft.versionId, lineId: lineB.id, refusals,
      persistedUnit: afterRefusals.items.find(item => item.id === lineB.id)?.unit_code ?? null });
    for (const refusal of refusals) expect(refusal.actual, `unit « ${refusal.typed} » is refused by name`).toEqual(refusal.expected);
    expect(afterRefusals.items.find(item => item.id === lineB.id)?.unit_code).toBe("u");

    // A recreation can already occupy the right slot while its subsequent
    // reorder is rejected. Require the real request to succeed as well as the
    // persisted hierarchy, and keep observing errors through the final reload.
    const errorKey = `${army.runPrefix}-V3E05-errors`;
    const installErrorObserver = (key: string) => {
      const count = (kind: string) => {
        const errors = JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, number>;
        errors[kind] = (errors[kind] ?? 0) + 1;
        sessionStorage.setItem(key, JSON.stringify(errors));
      };
      const originalError = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        try { count("console.error"); } finally { originalError(...args); }
      };
      window.addEventListener("error", () => count("error"));
      window.addEventListener("unhandledrejection", () => count("unhandledrejection"));
      return null;
    };
    await browser.addInitScript(installErrorObserver, errorKey);
    await browser.evaluate(installErrorObserver, errorKey);
    const readErrors = () => browser.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, number>, errorKey);
    const placement = (state: ArmyEstimate) => state.items.map(item => ({
      id: item.id, type: item.item_type, parentId: item.parent_id, position: item.position,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const domOrder = () => browser.evaluate(() => Array.from(document.querySelectorAll(
      '[role="grid"][aria-label="Lignes de devis"] [data-estimate-item-id]',
    )).map(item => item.getAttribute("data-estimate-item-id")));
    const beforeDelete = await readConsistent(ui, draft.versionId);
    const placementBeforeDelete = placement(beforeDelete);
    const orderBeforeDelete = await domOrder();
    expect(orderBeforeDelete.length).toBe(beforeDelete.items.length);
    expect(new Set(orderBeforeDelete).size).toBe(beforeDelete.items.length);

    // F26-21 : supprimer une ligne v3 depuis la grille passe par le lot (`delete`), qui recalcule ; jamais le refus générique.
    await screen.getByRole("button", `Plus d'actions pour ${lineC.title}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Supprimer", { exact: true }).tap();
    await confirmDeletion(ui);
    const deleted = await waitState(ui, draft.versionId, (state) => !lineIds(state).includes(lineC.id) && sameTotals(state, withoutC));
    const deleteView = { present: lineIds(deleted).includes(lineC.id), totals: totalsOf(deleted), genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e05-delete-line", { versionId: draft.versionId, lineId: lineC.id, actual: deleteView });
    expect(deleteView, "a v3 line is deleted by the v3 writer").toEqual({ present: false, totals: withoutC, genericRefusal: false });

    // Annuler la suppression recrée la ligne avec ses saisies v3 (unité, statut, h/u), sans heures totales ni projection.
    // CI 39107622137 (docs/testing/v3e05-click-intercepted.md) : sa remise en ordre, retenue ici, laisse ouverte la fenêtre
    // que la CI a touchée au hasard. Ni alerte « totaux non sauvegardés » ni saut de la grille pendant l'annulation ;
    // le pointeur laissé sur le titre de la section atteint encore son « + » ; l'annulation finie, rien « En attente ».
    const reorderUrl = new URL(`/api/estimates/${draft.versionId}/items/reorder`, app.baseUrl!).href;
    let releaseReorder!: () => void;
    const reorderGate = new Promise<void>((resolve) => { releaseReorder = resolve; });
    let reorderHeld = false;
    const sectionTitle = browser.locator(`[data-estimate-item-id="${draft.sectionId}"] [data-testid="estimate-section-title-input"]`);
    const sectionTop = async () => { const box = await sectionTitle.boundingBox(); return box ? Math.round(box.y) : null; };
    const totalsAlert = screen.getByTestId("estimate-editor-alert-totals-out-of-sync");
    const topBeforeUndo = await sectionTop();
    const reorderRequests: Array<{ method: string; parentId: string | null; orderedIds: string[] | null }> = [];
    await browser.route(reorderUrl, async (route) => {
      const body = JSON.parse(route.request.postData ?? "null") as { parent_id?: string | null; ordered_ids?: unknown } | null;
      reorderRequests.push({ method: route.request.method, parentId: body?.parent_id ?? null,
        orderedIds: Array.isArray(body?.ordered_ids) && body.ordered_ids.every(id => typeof id === "string") ? body.ordered_ids : null });
      reorderHeld = true;
      await reorderGate;
      await route.fallback();
    });
    let inFlight!: { alert: boolean; top: number | null };
    let recreatedWhileHeld!: ArmyEstimate;
    const [reorderResponse] = await Promise.all([
      browser.waitForResponse(reorderUrl),
      (async () => {
        try {
          await undo(ui);
          await expect.poll(() => reorderHeld).toBe(true);
          // Line C is back in the grid: its recreation is committed and rendered, only its reorder is in flight.
          await expect(screen.getByRole("combobox", lineC.title, { exact: true })).toBeVisible();
          inFlight = { alert: await totalsAlert.isVisible(), top: await sectionTop() };
          recreatedWhileHeld = await readConsistent(ui, draft.versionId);
          await sectionTitle.hover();
        } finally {
          releaseReorder();
        }
      })(),
    ]);
    await expect(screen.getByTestId("estimate-editor-redo-button", { visible: true })).toBeEnabled({ timeout: 30_000 });
    await browser.unroute(reorderUrl);
    const reorderBody = await reorderResponse.json<{ ok?: boolean; error?: { code?: string } }>();
    const recreatedC = lineByTitle(recreatedWhileHeld, lineC.title);
    const expectedSiblingIds = beforeDelete.items.filter(item => item.parent_id === lineC.parent_id)
      .sort((left, right) => left.position - right.position).map(item => item.id === lineC.id ? recreatedC?.id ?? null : item.id);
    const reorderResult = { requests: reorderRequests, status: reorderResponse.status, ok: reorderBody.ok ?? null, code: reorderBody.error?.code ?? null };
    await recordEvidence(army, "v3e05-undo-reorder-response", {
      versionId: draft.versionId, expectedParentId: lineC.parent_id, expectedSiblingIds,
      placementBeforeDelete, recreatedWhileHeld: placement(recreatedWhileHeld), actual: reorderResult, errors: await readErrors(),
    });
    expect(recreatedWhileHeld.items.filter(item => item.title === lineC.title)).toHaveLength(1);
    expect(reorderResult, "undo must send every current sibling, including the recreated ID, and commit its real reorder").toEqual({
      requests: [{ method: "POST", parentId: lineC.parent_id, orderedIds: expectedSiblingIds }], status: 200, ok: true, code: null,
    });
    const settled = { alert: await totalsAlert.isVisible(), top: await sectionTop(), status: await autoSaveStatus(ui) };
    await recordEvidence(army, "v3e05-undo-in-flight", { versionId: draft.versionId, actual: { topBeforeUndo, inFlight, settled } });
    expect({ inFlight, settled }, "an undone v3 deletion neither raises the totals alert nor moves the grid").toEqual({
      inFlight: { alert: false, top: topBeforeUndo }, settled: { alert: false, top: topBeforeUndo, status: "À jour" },
    });
    // The CI tap: the « + » opens from the pointer left on the section title during the undo, without a new hover.
    await screen.getByRole("button", `Ajouter dans ${draft.sectionTitle}`, { exact: true }).tap();
    const restored = await waitState(ui, draft.versionId, (state) => lineByTitle(state, lineC.title) !== null && sameTotals(state, initial));
    const restoredC = lineByTitle(restored, lineC.title);
    const restoreView = {
      totals: totalsOf(restored), newId: restoredC ? restoredC.id !== lineC.id : null, line: pickLine(restoredC, LINE_INPUTS),
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e05-undo-delete", { versionId: draft.versionId, originalId: lineC.id, actual: restoreView });
    expect(restoreView, "an undone v3 deletion recreates the line with its v3 inputs").toEqual({
      totals: initial, newId: true, genericRefusal: false,
      line: { unit: "u", status: "priced", quantity: 1, prFo: 1000, hPerUnit: 0, pu: 1300, net: 1300, taxRateBp: 2000, roleId: null },
    });
    const expectedRestoredPlacement = placementBeforeDelete.map(item => ({ ...item,
      id: item.id === lineC.id ? restoredC!.id : item.id,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const expectedRestoredOrder = orderBeforeDelete.map(id => id === lineC.id ? restoredC!.id : id);
    expect(placement(restored), "undo restores every exact parent and position from before deletion").toEqual(expectedRestoredPlacement);
    await expect.poll(domOrder).toEqual(expectedRestoredOrder);
    await expect(screen.getByTestId("estimate-section-add-line-button")).toBeVisible();
    await browser.reload();
    await expect(grid(ui)).toBeVisible();
    await waitForDraftLease(ui);
    const restoredAfterReload = await readConsistent(ui, draft.versionId);
    await recordEvidence(army, "v3e05-undo-placement-reloaded", {
      versionId: draft.versionId, expected: expectedRestoredPlacement, actual: placement(restoredAfterReload),
      expectedOrder: expectedRestoredOrder, actualOrder: await domOrder(), errors: await readErrors(),
    });
    expect(placement(restoredAfterReload)).toEqual(expectedRestoredPlacement);
    expect(totalsOf(restoredAfterReload)).toEqual(initial);
    await expect.poll(domOrder).toEqual(expectedRestoredOrder);

    // Annuler l'ajout d'une ligne la supprime par le lot.
    const addedId = await addGridLine(ui, draft);
    await waitState(ui, draft.versionId, (state) => lineIds(state).includes(addedId));
    await undo(ui);
    const unadded = await waitState(ui, draft.versionId, (state) => !lineIds(state).includes(addedId));
    const unaddView = { present: lineIds(unadded).includes(addedId), totals: totalsOf(unadded), genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e05-undo-add", { versionId: draft.versionId, addedId, actual: unaddView });
    expect(unaddView, "undoing an added v3 line deletes it by the v3 writer").toEqual({ present: false, totals: initial, genericRefusal: false });

    // Supprimer une section supprime ses lignes par le même lot.
    await browser.locator(`[data-estimate-item-id="${sectionT.id}"] [data-testid="estimate-section-title-input"]`).hover();
    await browser.locator(`[data-estimate-item-id="${sectionT.id}"] [data-testid="estimate-section-actions-button"]`).tap();
    await screen.getByTestId("estimate-section-context-delete-button").tap();
    await confirmDeletion(ui);
    const noSection = await waitState(ui, draft.versionId, (state) =>
      !state.items.some(item => item.id === sectionT.id || item.id === lineD.id) && sameTotals(state, withoutT));
    const sectionView = {
      sectionPresent: noSection.items.some(item => item.id === sectionT.id), linePresent: noSection.items.some(item => item.id === lineD.id),
      totals: totalsOf(noSection), genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e05-delete-section", { versionId: draft.versionId, sectionId: sectionT.id, lineId: lineD.id, actual: sectionView });
    expect(sectionView, "a v3 section and its lines are deleted by the v3 writer").toEqual({
      sectionPresent: false, linePresent: false, totals: withoutT, genericRefusal: false,
    });

    await checkpoint(ui, army, "v3e05-final", draft.versionId, {
      api: { version: { totals: withoutT, gross: 43400 },
        lines: { [lineA.id]: { net: 35600 }, [lineB.id]: { unit: "u", net: 6500 }, [restoredC!.id]: { unit: "u", net: 1300 } } },
      screen: { chips: chips(withoutT) },
    });
    const errors = await readErrors();
    await recordEvidence(army, "v3e05-end", { versionId: draft.versionId, nativeDialogs: dialogs, errors });
    expect(dialogs, "the saved nominal undo must not warn on either reload").toEqual([]);
    expect(errors, "the nominal deletion/undo and final reload must emit no console.error or uncaught error, including late callbacks").toEqual({});
  });

armyTest("V3E06 bulk majoration, move and delete of v3 lines, and their undo, go through the v3 writer and recompute the totals",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E06");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    const [lineA, lineB, lineC] = await seedLines(ui, army, draft, "v3e06", [
      withLabor(title("A"), 2, 10000, 1, draft.tuyauteurId), supply(title("B"), 1, 5000), supply(title("C"), 1, 1000)]);
    const sectionT = await seedSection(ui, army, draft, "v3e06-section", `${army.runPrefix} lot T`, 2);
    expect([lineA.line_total_ht_cents, lineB.line_total_ht_cents, lineC.line_total_ht_cents]).toEqual([35600, 6500, 1300]);
    // Majoration 150 % : A = 2 × (130,00 € + 1 h × 1,5 × 40 € × 1,2) = 404,00 € ; B sans heures, inchangée.
    const majorated: Totals = [48200, 9640, 57840];
    const onlyC: Totals = [1300, 260, 1560];
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e06");
    await waitForDraftLease(ui);

    const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    for (const line of [lineA, lineB]) await screen.getByLabel(`Sélectionner la ligne ${line.title}`, { exact: true }).check();
    await expect(bulkBar).toBeVisible();

    // F26-22 : majoration en lot par l'écrivain v3 (saisies seulement), totaux recalculés et stockés.
    await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
    await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
    await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
    const majoration = (state: ArmyEstimate, id: string) => Number(state.items.find(item => item.id === id)?.h_mo_majoration);
    const afterMajoration = await waitState(ui, draft.versionId, (state) =>
      majoration(state, lineA.id) === 1.5 && majoration(state, lineB.id) === 1.5 && sameTotals(state, majorated));
    const majorationView = {
      majorations: [majoration(afterMajoration, lineA.id), majoration(afterMajoration, lineB.id)], totals: totalsOf(afterMajoration),
      lineA: pickLine(afterMajoration.items.find(item => item.id === lineA.id) ?? null, ["pu", "net", "hMo"]),
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e06-majoration", { versionId: draft.versionId, actual: majorationView });
    expect(majorationView, "a bulk majoration of v3 lines is written by the v3 writer").toEqual({
      majorations: [1.5, 1.5], totals: majorated, lineA: { pu: 20200, net: 40400, hMo: 2 }, genericRefusal: false,
    });

    // Déplacement en lot vers le lot T : placement seul, totaux inchangés.
    await screen.getByLabel("Déplacer les lignes sélectionnées vers", { exact: true }).selectOption({ value: sectionT.id });
    await screen.getByTestId("estimate-editor-bulk-move-apply-button").click();
    const parentOf = (state: ArmyEstimate, id: string) => state.items.find(item => item.id === id)?.parent_id ?? null;
    const afterMove = await waitState(ui, draft.versionId, (state) =>
      parentOf(state, lineA.id) === sectionT.id && parentOf(state, lineB.id) === sectionT.id);
    const moveView = {
      parents: [parentOf(afterMove, lineA.id), parentOf(afterMove, lineB.id)], totals: totalsOf(afterMove), genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e06-move", { versionId: draft.versionId, sectionId: sectionT.id, actual: moveView });
    expect(moveView, "a bulk move of v3 lines is written by the v3 writer").toEqual({
      parents: [sectionT.id, sectionT.id], totals: majorated, genericRefusal: false,
    });

    // Suppression en lot : un seul lot `delete`, atomique ; puis son annulation recrée les deux lignes avec leurs saisies.
    await screen.getByTestId("estimate-editor-bulk-delete-selection-button").tap();
    await confirmDeletion(ui);
    const afterDelete = await waitState(ui, draft.versionId, (state) =>
      !lineIds(state).includes(lineA.id) && !lineIds(state).includes(lineB.id) && sameTotals(state, onlyC));
    const deleteView = {
      remaining: lineIds(afterDelete), totals: totalsOf(afterDelete), genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e06-delete", { versionId: draft.versionId, actual: deleteView });
    expect(deleteView, "a bulk delete of v3 lines is written by the v3 writer").toEqual({
      remaining: [lineC.id], totals: onlyC, genericRefusal: false,
    });

    await undo(ui);
    const restored = await waitState(ui, draft.versionId, (state) =>
      lineByTitle(state, lineA.title) !== null && lineByTitle(state, lineB.title) !== null && sameTotals(state, majorated));
    const restoredA = lineByTitle(restored, lineA.title);
    const restoredB = lineByTitle(restored, lineB.title);
    const restoreView = {
      totals: totalsOf(restored),
      lineA: restoredA ? { ...pickLine(restoredA, LINE_INPUTS), parent: restoredA.parent_id, majoration: Number(restoredA.h_mo_majoration) } : null,
      lineB: restoredB ? { ...pickLine(restoredB, LINE_INPUTS), parent: restoredB.parent_id, majoration: Number(restoredB.h_mo_majoration) } : null,
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e06-undo-delete", { versionId: draft.versionId, actual: restoreView });
    expect(restoreView, "an undone bulk delete recreates the v3 lines with their inputs").toEqual({
      totals: majorated, genericRefusal: false,
      lineA: { unit: "u", status: "priced", quantity: 2, prFo: 10000, hPerUnit: 1, pu: 20200, net: 40400, taxRateBp: 2000,
        roleId: draft.tuyauteurId, parent: sectionT.id, majoration: 1.5 },
      lineB: { unit: "u", status: "priced", quantity: 1, prFo: 5000, hPerUnit: 0, pu: 6500, net: 6500, taxRateBp: 2000,
        roleId: null, parent: sectionT.id, majoration: 1.5 },
    });

    await checkpoint(ui, army, "v3e06-final", draft.versionId, {
      api: { version: { totals: majorated, gross: 48200 }, lines: { [restoredA!.id]: { net: 40400 }, [restoredB!.id]: { net: 6500 }, [lineC.id]: { net: 1300 } } },
      screen: { chips: chips(majorated) },
    });
    await recordEvidence(army, "v3e06-end", { versionId: draft.versionId, nativeDialogs: dialogs });
  });

armyTest("V3E07 a labour rate changed in the v3 editor recomputes and stores the version totals: the detail page shows the editor's HT",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E07");
    // L : 1 u, 200,00 € + 5 h/u : 40 €/h → PU 500,00 € ; 50 €/h → 260,00 € + 5 × 50 × 1,2 = 560,00 €.
    const [line] = await seedLines(ui, army, draft, "v3e07", [withLabor(`${army.runPrefix} L`, 1, 20000, 5, draft.tuyauteurId)]);
    expect([line.pu_ht_cents, line.line_total_ht_cents]).toEqual([50000, 50000]);
    const at50: Totals = [56000, 11200, 67200];
    await switchToExpertMode(ui);
    const dialog = await openSettings(ui, draft.versionId);

    // F26-23 : le rôle enregistré, l'éditeur fait recalculer et stocker les lignes et les totaux (D12) ; sinon la fiche,
    // l'impression, la liste des affaires et les approbations gardent l'ancien HT sous un état « Sauvegardé ».
    await fillCell(ui, "Taux horaire du rôle Tuyauteur (EUR)", "50");
    const roleRate = async () => {
      const details = await apiRequest<Envelope<{ labor_roles: Array<{ id: string; hourly_rate_cents: number }> }>>(
        browser, "GET", `/api/estimates/${draft.versionId}`);
      return details.body.data?.labor_roles?.find(role => role.id === draft.tuyauteurId)?.hourly_rate_cents ?? null;
    };
    await expect.poll(roleRate, { timeout: 30_000 }).toBe(5000);
    const stored = await waitState(ui, draft.versionId, (state) => sameTotals(state, at50));
    const storedView = {
      rate: await roleRate(), totals: totalsOf(stored),
      line: pickLine(stored.items.find(item => item.id === line.id) ?? null, ["pu", "net"]),
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e07-rate", { versionId: draft.versionId, roleId: draft.tuyauteurId, dialogText: normalized(await dialog.textContent()), actual: storedView });
    expect(storedView, "a v3 labour rate change is stored with the recomputed totals").toEqual({
      rate: 5000, totals: at50, line: { pu: 56000, net: 56000 }, genericRefusal: false,
    });

    await openGrid(ui, draft.versionId);
    await checkpoint(ui, army, "v3e07-rate", draft.versionId, {
      api: { version: { totals: at50, gross: 56000 }, lines: { [line.id]: { pu: 56000, net: 56000 } } },
      screen: { chips: chips(at50) },
    });
    await app.open(`/dashboard/estimates/${draft.versionId}`);
    const readDetail = () => browser.evaluate(() => {
      const term = Array.from(document.querySelectorAll("dt")).find(node => (node.textContent ?? "").trim() === "Total HT");
      return term?.nextElementSibling ? (term.nextElementSibling.textContent ?? "").replace(/[\s  ]+/g, " ").trim() : null;
    });
    await expect.poll(readDetail, { timeout: 30_000 }).toBe(eur(at50[0]));
    await recordEvidence(army, "v3e07-end", { versionId: draft.versionId, detailHt: await readDetail(), nativeDialogs: dialogs });

    // Revue de la correction F2 : l'« Historique des versions » de la même fiche (V2 = ce brouillon v3, V1 = l'ancre v2
    // vide, en euros). Chaque entrée : HT, écart avec la version précédente, TTC. Même devise : l'écart est affiché.
    const readTimeline = () => browser.evaluate(() => {
      const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
      const entries = Array.from(document.querySelectorAll("section[aria-labelledby=\"estimate-timeline-title\"] li > a"));
      return entries.map((entry) => {
        const label = (text: string) => Array.from(entry.querySelectorAll("p")).find(node => clean(node.textContent) === text);
        const ht = label("Total HT")?.nextElementSibling;
        return {
          current: entry.getAttribute("aria-current") === "page",
          ht: ht?.firstElementChild ? clean(ht.firstElementChild.textContent) : null,
          delta: ht?.children[1] ? clean(ht.children[1].textContent) : null,
          ttc: clean(label("Total TTC")?.nextElementSibling?.textContent) || null,
        };
      });
    });
    const anchorEntry = { current: false, ht: eur(0), delta: null, ttc: eur(0) };
    const expectedTimelineEur = [{ current: true, ht: eur(at50[0]), delta: `+${eur(at50[0])}`, ttc: eur(at50[2]) }, anchorEntry];
    await becomes(async () => JSON.stringify(await readTimeline()) === JSON.stringify(expectedTimelineEur), 30_000);
    const timelineEur = await readTimeline();
    await recordEvidence(army, "v3e07-timeline-eur", { versionId: draft.versionId, anchorId: draft.anchorId, expected: expectedTimelineEur, actual: timelineEur });
    expect(timelineEur, "the v3 detail timeline shows each version in euros and the HT delta between two euro versions").toEqual(expectedTimelineEur);

    // Revue Codex de la PR #44 (F2) : un brouillon v3 en dollars US affiche ses totaux d'en-tête dans la devise de la
    // version, comme son résumé (montants inchangés), jamais en euros.
    await patchSettingsByApi(ui, army, draft, "v3e07-currency", { currency: "USD" });
    await app.open(`/dashboard/estimates/${draft.versionId}`);
    const readCurrencies = () => browser.evaluate(() => {
      const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
      const headline = (label: string) => {
        const term = Array.from(document.querySelectorAll("dt")).find(node => clean(node.textContent) === label);
        return term?.nextElementSibling ? clean(term.nextElementSibling.textContent) : null;
      };
      const summary = (label: string) => {
        const rows = Array.from(document.querySelectorAll("[data-testid=\"estimate-v3-draft-totals\"] > div"));
        const row = rows.find(node => clean(node.firstElementChild?.textContent) === label);
        return row?.lastElementChild ? clean(row.lastElementChild.textContent) : null;
      };
      return { headlineHt: headline("Total HT"), headlineTtc: headline("Total TTC"), summaryHt: summary("HT net"), summaryTtc: summary("TTC à payer") };
    });
    const expectedCurrencies = { headlineHt: "$560.00", headlineTtc: "$672.00", summaryHt: "$560.00", summaryTtc: "$672.00" };
    await becomes(async () => JSON.stringify(await readCurrencies()) === JSON.stringify(expectedCurrencies), 30_000);
    const currencies = await readCurrencies();
    await recordEvidence(army, "v3e07-currency", { versionId: draft.versionId, expected: expectedCurrencies, actual: currencies, nativeDialogs: dialogs });
    expect(currencies, "the v3 headline totals are formatted in the version currency, as the summary").toEqual(expectedCurrencies);

    // Revue de la correction F2 : l'entrée « Courante » de l'historique suit aussi la devise de la version (mêmes
    // « $560.00 » / « $672.00 »), l'ancre v2 reste en euros, et aucun écart n'est calculé entre deux devises.
    const expectedTimelineUsd = [{ current: true, ht: "$560.00", delta: null, ttc: "$672.00" }, anchorEntry];
    await becomes(async () => JSON.stringify(await readTimeline()) === JSON.stringify(expectedTimelineUsd), 30_000);
    const timelineUsd = await readTimeline();
    await recordEvidence(army, "v3e07-timeline-currency", {
      versionId: draft.versionId, anchorId: draft.anchorId, expected: expectedTimelineUsd, actual: timelineUsd, nativeDialogs: dialogs,
    });
    expect(timelineUsd, "the v3 detail timeline formats each version in its own currency, with no delta across currencies").toEqual(expectedTimelineUsd);
  });

armyTest("V3E08 the cost, margin and markup columns of a v3 line read the engine, and the missing labour time check reads the engine hours",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E08");
    // P : 2 ml, 15,00 € + 1 h/u (40 €/h) → brut 135,00 €, déboursé 110,00 € ; remise 10 % → net 121,50 €.
    // H : la même ligne « Hors lot » (déboursé et brut nuls) ; Q : 1 u, 10,00 €, sans heures, nature FO + MO.
    const [lineP, lineH, lineQ] = await seedLines(ui, army, draft, "v3e08", [
      withLabor(`${army.runPrefix} P`, 2, 1500, 1, draft.tuyauteurId, { unit_code: "ml" }),
      withLabor(`${army.runPrefix} H`, 2, 1500, 1, draft.tuyauteurId, { unit_code: "ml", pricing_status: "out_of_scope" }),
      withLabor(`${army.runPrefix} Q`, 1, 1000, 0, draft.tuyauteurId),
    ]);
    await patchSettingsByApi(ui, army, draft, "v3e08-discount", { discount_amount_cents: null, discount_bp: 1000 });
    const discounted = await readConsistent(ui, draft.versionId);
    expect(totalsOf(discounted)).toEqual([13320, 2664, 15984]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e08");
    await waitForDraftLease(ui);
    await showPreset(ui, "Complet");

    // F26-24 : DS = déboursé du moteur, Marge = brut − DS (avant remise, aide de la colonne), Marque = marge / brut ;
    // une ligne non chiffrée n'a ni déboursé, ni marge, ni marque.
    const marginView = (itemId: string) => browser.evaluate((id) => {
      const row = document.querySelector(`[data-estimate-item-id="${id}"]`);
      const cell = (column: string) => row?.querySelector(`[data-estimate-column="${column}"]`) ?? null;
      const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").replace(/[−–]/g, "-").trim();
      return {
        ds: cell("ds") ? clean(cell("ds")!.textContent) : null, marge: cell("marge") ? clean(cell("marge")!.textContent) : null,
        marque: cell("marque") ? clean(cell("marque")!.textContent) : null,
        negative: Boolean(cell("marge")?.classList.contains("estimate-cell--margin-negative")),
      };
    }, itemId);
    const margins = { priced: await marginView(lineP.id), outOfScope: await marginView(lineH.id) };
    const expectedMargins = {
      priced: { ds: "110,00 €", marge: "25,00 €", marque: "18,5 %", negative: false },
      outOfScope: { ds: "0,00 €", marge: "0,00 €", marque: "-", negative: false },
    };
    await recordEvidence(army, "v3e08-margins", { versionId: draft.versionId, expected: expectedMargins, actual: margins });
    expect.soft(margins, "the v3 margin columns read the engine line").toEqual(expectedMargins);

    // F26-25 : « Temps MO manquant » suit les heures du moteur (Q × h/u), sans attendre un rechargement.
    const missingLaborTime = () => browser.evaluate((id) => Boolean(document.querySelector(
      `[data-estimate-item-id="${id}"] [data-estimate-column="labor_hours"]`)?.classList.contains("estimate-cell--warning-empty")), lineQ.id);
    const before = await missingLaborTime();
    await fillCell(ui, `Heures de main-d’œuvre par unité pour ${lineQ.title}`, "2");
    await saveLineEditsWithShortcut(ui, draft.versionId, lineQ.title, army);
    await waitForAutoSave(ui, draft.versionId, (snapshot) =>
      Number(snapshot.items.find(item => item.id === lineQ.id)?.h_mo_per_unit) === 2 && sameTotals(snapshot, [21960, 4392, 26352]), army);
    await expect.poll(async () => normalized(await screen.getByTestId("estimate-page-toolbar-autosave-status").textContent()), { timeout: 30_000 })
      .toMatch(/^(Sauvegardé|À jour)$/);
    const afterSave = await missingLaborTime();
    await browser.reload();
    await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
    const afterReload = await missingLaborTime();
    const quality = { before, afterSave, afterReload };
    await recordEvidence(army, "v3e08-quality", { versionId: draft.versionId, lineId: lineQ.id, actual: quality, nativeDialogs: dialogs });
    expect(quality, "the missing labour time check follows the engine hours of a v3 line").toEqual({ before: true, afterSave: false, afterReload: false });
  });

armyTest("V3E09 associating an article to a v3 line judges its offer in unit_code: another unit is refused, the retained article never writes description",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E09");
    // A v3 line as the grid makes it: its unit in unit_code (D9), nothing in description.
    const [line] = await seedLines(ui, army, draft, "v3e09", [supply(`${army.runPrefix} tube à remplacer`, 2, 1500, { unit_code: "ml" })]);
    expect([line.unit_code, line.description ?? null, line.line_total_ht_cents]).toEqual(["ml", null, 3900]);
    army.ownedPriceLookupProjects = [draft.projectId];
    const created = async <T>(label: string, pathname: string, body: unknown) => {
      const response = await apiRequest<Envelope<{ item: T }>>(browser, "POST", pathname, body);
      await recordEvidence(army, `v3e09-catalogue-${label}`, { pathname, body, response });
      expect([response.status, response.body.ok]).toEqual([201, true]);
      return response.body.data.item;
    };
    type Offer = { id: string; product_id: string; unit_price_cents: number };
    const article = async (label: string, designation: string, unit: string, cents: number) => {
      const product = await created<{ id: string }>(`product-${label}`, "/api/products", {
        action: "create", item: { designation, reference: `${army.runPrefix}-${label}`, unit, unit_price_cents: cents } });
      const supplier = await created<{ id: string }>(`supplier-${label}`, "/api/suppliers", {
        action: "create", item: { name: `${army.runPrefix} fournisseur ${label}`, is_active: true } });
      const offer = await created<Offer>(`offer-${label}`, "/api/prices", {
        action: "create", item: { supplier_id: supplier.id, product_id: product.id, supplier_sku: `${army.runPrefix}-${label}-sku`, unit,
          min_quantity: 1, unit_price_cents: cents, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) } });
      return { designation, productId: product.id, offer };
    };
    const inMl = await article("ml", `${army.runPrefix} tube cuivre ml`, "ML", 1240);
    const inBar = await article("barre", `${army.runPrefix} tube cuivre barre`, "barre", 5000);
    // Revue Codex de la PR #44 (F1) : un article sans offre, prix seulement par son prix de référence, à la pièce.
    const piece = await created<{ id: string }>("product-piece", "/api/products", {
      action: "create", item: { designation: `${army.runPrefix} tube cuivre piece`, reference: `${army.runPrefix}-piece`, unit: "u", unit_price_cents: 800 } });
    const inPiece = { designation: `${army.runPrefix} tube cuivre piece`, productId: piece.id };
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e09");
    await waitForDraftLease(ui);

    // F26-26 : l'article proposé est jugé dans l'unité de la ligne v3 (unit_code), jamais dans description (vide).
    await screen.getByRole("button", `Plus d'actions pour ${line.title}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true }).tap();
    const search = screen.getByLabel("Rechercher dans le catalogue", { exact: true });
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill(`${army.runPrefix} tube cuivre`);
    const suggestion = (designation: string) => browser.locator("[role=\"dialog\"] button").filter({ hasText: designation });
    await expect.poll(async () => (await suggestion(inMl.designation).count()) + (await suggestion(inBar.designation).count()) +
      (await suggestion(inPiece.designation).count()), { timeout: 30_000 }).toBe(3);
    const suggestionView = async (designation: string) => ({
      enabled: await suggestion(designation).isEnabled(),
      unitRefused: normalized(await suggestion(designation).textContent()).includes(UNIT_REFUSED),
    });
    const sheet = { ml: await suggestionView(inMl.designation), bar: await suggestionView(inBar.designation), piece: await suggestionView(inPiece.designation) };
    // Le prix de référence à la pièce (sans offre) est refusé comme l'offre à la barre (F26-26, 1c16ad40).
    const expectedSheet = { ml: { enabled: true, unitRefused: false }, bar: { enabled: false, unitRefused: true }, piece: { enabled: false, unitRefused: true } };
    await recordEvidence(army, "v3e09-sheet", { versionId: draft.versionId, lineId: line.id, expected: expectedSheet, actual: sheet });
    expect.soft(sheet, "an article in another unit than the v3 line is refused by name").toEqual(expectedSheet);

    // L'article en ml remplace celui de la ligne : désignation, PR FO et offre ; unit_code reste ml, description vide.
    await suggestion(inMl.designation).first().tap();
    await expect(search).toBeHidden({ timeout: 30_000 });
    await saveLineEditsWithShortcut(ui, draft.versionId, inMl.designation, army);
    const saved = await waitForAutoSave(ui, draft.versionId,
      (snapshot) => snapshot.items.find(item => item.id === line.id)?.product_id === inMl.productId, army);
    const savedLine = saved.items.find(item => item.id === line.id)!;
    const persisted = {
      unitCode: savedLine.unit_code ?? null, description: savedLine.description ?? null, title: savedLine.title,
      prFo: Number(savedLine.unit_price_ht_cents), offerId: savedLine.selected_supplier_price_id ?? null, totals: totalsOf(saved),
    };
    const expectedPersisted = { unitCode: "ml", description: null, title: inMl.designation, prFo: 1240, offerId: inMl.offer.id, totals: [3224, 645, 3869] };
    await recordEvidence(army, "v3e09-associated", { versionId: draft.versionId, lineId: line.id, expected: expectedPersisted, actual: persisted, nativeDialogs: dialogs });
    expect(persisted, "the associated article keeps the v3 unit_code and never writes description").toEqual(expectedPersisted);
    await checkpoint(ui, army, "v3e09-associated", draft.versionId, {
      api: { version: { totals: [3224, 645, 3869] }, lines: { [line.id]: { unit: "ml", prFo: 1240, pu: 1612, net: 3224 } } },
      screen: { chips: chips([3224, 645, 3869]), rows: [{ id: line.id, title: inMl.designation, unit: "ml — mètre linéaire", pu: "16,12", pt: eur(3224) }] },
    });

    // Revue Codex de la PR #44 (F1) : la suggestion de la désignation juge aussi un prix de référence (sans offre) dans
    // unit_code. L'article à la pièce ne prix jamais la ligne en ml (8,00 € la pièce comme 8,00 € le mètre) : refus nommé,
    // l'article, le PR FO et l'offre de la ligne restent ; la désignation saisie reste le titre, comme toute saisie.
    await waitForDraftLease(ui);
    await browser.locator(`[data-estimate-item-id="${line.id}"] [data-testid="estimate-line-title-input"]`).fill(inPiece.designation);
    const listbox = screen.getByRole("listbox").first();
    await expect(listbox.getByText(inPiece.designation, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await browser.keyboard.press("Enter");
    const referenceRefusal = `${UNIT_REFUSED} : offre en u, ligne en ml.`;
    const popoverRefused = await becomes(async () => (await listbox.count()) > 0 && normalized(await listbox.textContent()).includes(referenceRefusal), 10_000);
    const popoverText = (await listbox.count()) > 0 ? normalized(await listbox.textContent()) : null;
    await browser.keyboard.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, inPiece.designation, army);
    const afterReference = await waitForAutoSave(ui, draft.versionId,
      (snapshot) => snapshot.items.find(item => item.id === line.id)?.title === inPiece.designation, army);
    const keptLine = afterReference.items.find(item => item.id === line.id)!;
    const kept = {
      popoverRefused, unitCode: keptLine.unit_code ?? null, description: keptLine.description ?? null, title: keptLine.title,
      productId: keptLine.product_id ?? null, prFo: Number(keptLine.unit_price_ht_cents), offerId: keptLine.selected_supplier_price_id ?? null,
      totals: totalsOf(afterReference),
    };
    const expectedKept = {
      popoverRefused: true, unitCode: "ml", description: null, title: inPiece.designation,
      productId: inMl.productId, prFo: 1240, offerId: inMl.offer.id, totals: [3224, 645, 3869],
    };
    await recordEvidence(army, "v3e09-reference-price", {
      versionId: draft.versionId, lineId: line.id, referenceProductId: inPiece.productId, expected: expectedKept, actual: kept, popoverText, nativeDialogs: dialogs,
    });
    expect(kept, "a reference price in another unit never prices the v3 line: refused by name, nothing but the typed title written").toEqual(expectedKept);
    await checkpoint(ui, army, "v3e09-reference-refused", draft.versionId, {
      api: { version: { totals: [3224, 645, 3869] }, lines: { [line.id]: { unit: "ml", productId: inMl.productId, offerId: inMl.offer.id, prFo: 1240, pu: 1612, net: 3224 } } },
      screen: { chips: chips([3224, 645, 3869]), rows: [{ id: line.id, title: inPiece.designation, unit: "ml — mètre linéaire", pu: "16,12", pt: eur(3224) }] },
    });
  });

armyTest("V3E10 the VAT propagation question opens from every save path of the v3 settings: Ctrl+S and saving on close",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E10");
    const [line] = await seedLines(ui, army, draft, "v3e10", [supply(`${army.runPrefix} X`, 1, 10000)]);
    expect(line.line_total_ht_cents).toBe(13000);
    await switchToExpertMode(ui);
    const propagation = () => screen.getByRole("alertdialog", /^Appliquer ce taux à toutes les lignes\s?\?$/);
    const persistedRates = async () => {
      const state = await readConsistent(ui, draft.versionId);
      return { version: Number(state.version.tax_rate_bp), line: Number(state.items.find(item => item.id === line.id)?.tax_rate_bp), totals: totalsOf(state) };
    };

    // F26-27 : Ctrl+S depuis le tiroir ouvre la question (une ligne porte un autre taux), « Non » ne change que la version.
    await openSettings(ui, draft.versionId);
    await fillCell(ui, "TVA par défaut des nouvelles lignes", "10");
    await browser.keyboard.press("ControlOrMeta+s");
    const shortcutOpened = await becomes(() => propagation().isVisible());
    await recordEvidence(army, "v3e10-shortcut", { versionId: draft.versionId, opened: shortcutOpened, text: await pageText(ui) });
    expect(shortcutOpened, "Ctrl+S opens the VAT propagation question").toBe(true);
    await propagation().getByRole("button", "Non", { exact: true }).tap();
    await expect(propagation()).toBeHidden({ timeout: 30_000 });
    await expect.poll(persistedRates, { timeout: 30_000 }).toEqual({ version: 1000, line: 2000, totals: [13000, 2600, 15600] });

    // Fermer le tiroir puis « Enregistrer » ouvre la même question ; « Oui » applique le taux à la ligne dans la même sauvegarde.
    await openSettings(ui, draft.versionId);
    await fillCell(ui, "TVA par défaut des nouvelles lignes", "5,5");
    await settingsDialog(ui).getByRole("button", "Fermer", { exact: true }).tap();
    const closeConfirm = screen.getByRole("dialog", "Enregistrer les modifications du paramétrage ?", { exact: true });
    await expect(closeConfirm).toBeVisible({ timeout: 30_000 });
    await closeConfirm.getByRole("button", "Enregistrer", { exact: true }).tap();
    const closeOpened = await becomes(() => propagation().isVisible());
    await recordEvidence(army, "v3e10-close", { versionId: draft.versionId, opened: closeOpened, text: await pageText(ui) });
    expect(closeOpened, "saving on close opens the VAT propagation question").toBe(true);
    await propagation().getByRole("button", "Oui", { exact: true }).tap();
    await expect.poll(persistedRates, { timeout: 30_000 }).toEqual({ version: 550, line: 550, totals: [13000, 715, 13715] });
    await expect(settingsDialog(ui)).toBeHidden({ timeout: 30_000 });
    await expect(closeConfirm).toBeHidden({ timeout: 30_000 });
    await checkpoint(ui, army, "v3e10-vat", draft.versionId, {
      api: { version: { totals: [13000, 715, 13715], taxRateBp: 550 }, lines: { [line.id]: { taxRateBp: 550 } } },
      screen: { chips: chips([13000, 715, 13715], "5,5") },
    });
    await recordEvidence(army, "v3e10-end", { versionId: draft.versionId, nativeDialogs: dialogs });
  });

armyTest("V3E11 a 0 % discount saves without a pending state, a stored rounding step outside the list shows as applied, and the detail page opens the PDF and closes the template by name",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E11");
    // X : 1 u, 100,10 € → PU 130,13 € ; 10 % → 117,12 € ; palier inférieur de 2,50 € → 130,00 € (arrondi 0,13 €).
    const [line] = await seedLines(ui, army, draft, "v3e11", [supply(`${army.runPrefix} X`, 1, 10010)]);
    expect(line.line_total_ht_cents).toBe(13013);
    const initial: Totals = [13013, 2603, 15616];
    await switchToExpertMode(ui);
    const status = () => screen.getByTestId("estimate-page-toolbar-autosave-status");
    const settingsOf = async () => {
      const state = await readConsistent(ui, draft.versionId);
      return { discountBp: Number(state.version.discount_bp), discountAmountCents: state.version.discount_amount_cents ?? null,
        rounding: [state.version.rounding_mode, Number(state.version.rounding_step_cents)], totals: totalsOf(state) };
    };

    // F26-28 : « 0 » dans « Remise (%) » est une remise nulle ; une fois enregistrée, plus rien n'est en attente.
    await openSettings(ui, draft.versionId);
    await fillCell(ui, "Remise (%)", "10");
    await clickSaveSettings(ui);
    await expect.poll(settingsOf, { timeout: 30_000 }).toEqual({ discountBp: 1000, discountAmountCents: null, rounding: ["none", 1], totals: [11712, 2342, 14054] });
    await fillCell(ui, "Remise (%)", "0");
    await clickSaveSettings(ui);
    await expect.poll(settingsOf, { timeout: 30_000 }).toEqual({ discountBp: 0, discountAmountCents: null, rounding: ["none", 1], totals: initial });
    const settled = await becomes(async () => /^(Sauvegardé|À jour)$/.test(normalized(await status().textContent())));
    await recordEvidence(army, "v3e11-zero-discount", { versionId: draft.versionId, settled, status: normalized(await status().textContent()) });
    expect.soft(settled, "a saved 0 % discount leaves nothing pending").toBe(true);

    // F26-29 : un palier inférieur stocké hors de la liste (2,50 €, admis par l'API) s'affiche tel qu'il s'applique, et
    // « Aucun » est un vrai changement.
    await patchSettingsByApi(ui, army, draft, "v3e11-rounding", { rounding_mode: "down", rounding_step_cents: 250 });
    await expect.poll(settingsOf, { timeout: 30_000 }).toEqual({ discountBp: 0, discountAmountCents: null, rounding: ["down", 250], totals: [13000, 2600, 15600] });
    const dialog = await openSettings(ui, draft.versionId);
    const rounding = dialog.getByLabel("Arrondi", { exact: true });
    const roundingView = await browser.evaluate(() => {
      const select = Array.from(document.querySelectorAll("select")).find(node =>
        Array.from(node.labels ?? []).some(label => (label.textContent ?? "").trim() === "Arrondi")) ?? null;
      const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").trim();
      return select ? { value: select.value, shown: clean(select.selectedOptions[0]?.textContent), values: Array.from(select.options).map(option => option.value) } : null;
    });
    await recordEvidence(army, "v3e11-rounding-shown", { versionId: draft.versionId, actual: roundingView });
    expect.soft(roundingView?.value, "the stored 2,50 € step is the selected option").toBe("250");
    expect.soft(roundingView?.shown ?? "", "the selected option names the applied step").toContain("2,50 €");
    expect.soft(roundingView?.values, "the standard options stay, the stored step is added once").toEqual(["none", "100", "250", "1000", "5000", "10000"]);
    await rounding.selectOption({ value: "none" });
    await clickSaveSettings(ui);
    const afterNone = await becomes(async () => JSON.stringify(await settingsOf()) ===
      JSON.stringify({ discountBp: 0, discountAmountCents: null, rounding: ["none", 1], totals: initial }));
    await recordEvidence(army, "v3e11-rounding-none", { versionId: draft.versionId, saved: afterNone, actual: await settingsOf() });
    expect(afterNone, "choosing « Aucun » after a stored 2,50 € step is saved").toBe(true);

    // F26-30, revu à la fusion de 2.7 : la fiche d'un brouillon v3 propose le PDF (émission v3 de 2.7), pas le modèle
    // (2.8) ; elle dit pourquoi le seul modèle reste fermé, sans plus nommer le PDF.
    await app.open(`/dashboard/estimates/${draft.versionId}`);
    await screen.getByTestId("estimate-detail-more-actions").tap();
    const actions = browser.locator("[aria-label=\"Autres actions sur la version\"]");
    await expect(actions).toBeVisible({ timeout: 30_000 });
    const actionView = async (label: string) => {
      const button = actions.getByRole("button", label, { exact: true });
      return (await button.count()) === 1 ? { present: true, enabled: await button.isEnabled() } : { present: false, enabled: false };
    };
    const detail = {
      pdf: await actionView("Préparer le PDF"), template: await actionView("Sauvegarder comme modèle"),
      duplicate: await actionView("Dupliquer"),
      reason: apostrophes(normalized(await actions.textContent())).includes(apostrophes(DETAIL_TEMPLATE_REASON)),
      pdfNamedClosed: apostrophes(normalized(await actions.textContent())).includes(apostrophes(DETAIL_ACTIONS_REASON_2_6)),
    };
    const expectedDetail = { pdf: { present: true, enabled: true }, template: { present: true, enabled: false },
      duplicate: { present: true, enabled: true }, reason: true, pdfNamedClosed: false };
    await recordEvidence(army, "v3e11-detail-actions", { versionId: draft.versionId, expected: expectedDetail, actual: detail, nativeDialogs: dialogs });
    expect(detail, "the v3 draft detail page opens the PDF and closes the template by name").toEqual(expectedDetail);
  });

armyTest("V3E15 the v3 editor offers the Excel, DPGF, CSV and BDC exports; Excel and DPGF stream the v3 workbooks",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E15");
    // X : 2 u à 100,00 € → PU 130,00 €, PT 260,00 € (c_FO 1,30).
    const title = `${army.runPrefix} X`;
    const [line] = await seedLines(ui, army, draft, "v3e15", [supply(title, 2, 10000)]);
    expect(line.line_total_ht_cents).toBe(26000);
    await openV3Editor(ui, army, draft, "v3e15");
    await waitForDraftLease(ui);

    // P-20 (doc 2.7 §9.1) ne ferme que l'export CSV de l'éditeur (editor-export.ts) et le BDC ; Excel et DPGF appellent
    // GET …/export, que 2.7 ouvre pour une v3 (v3-export.ts). À 1 280 px, Excel et CSV sont dans le menu compact
    // « Exporter » ; leurs entrées de « Plus d'actions » (menu mobile, masqué à cette largeur) sont lues dans le DOM.
    const compact = screen.getByRole("button", "Exporter", { exact: true });
    await expect(compact).toBeVisible({ timeout: 30_000 });
    const compactEnabled = await compact.isEnabled();
    let compactItems: { excel: boolean | null; csv: boolean | null } = { excel: null, csv: null };
    if (compactEnabled) {
      await compact.tap();
      compactItems = {
        excel: await screen.getByRole("button", "Excel (.xlsx)", { exact: true }).isEnabled(),
        csv: await screen.getByRole("button", "Fichier CSV (.csv)", { exact: true }).isEnabled(),
      };
      await compact.tap();
    }
    const more = screen.getByTestId("estimate-page-toolbar-more-actions-button");
    await more.tap();
    await expect(screen.getByTestId("estimate-page-toolbar-more-actions-menu")).toBeVisible({ timeout: 30_000 });
    const menu = await browser.evaluate(() => {
      const panel = document.querySelector("[data-testid=\"estimate-page-toolbar-more-actions-menu\"]");
      const entry = (label: string) => {
        const button = Array.from(panel?.querySelectorAll("button") ?? [])
          .find(node => (node.textContent ?? "").replace(/\s+/g, " ").trim() === label);
        return button instanceof HTMLButtonElement ? { enabled: !button.disabled, shown: button.getClientRects().length > 0 } : null;
      };
      return { excel: entry("Exporter Excel"), csv: entry("Exporter CSV"), dpgf: entry("Exporter DPGF"), bdc: entry("Exporter BDC V1.1") };
    });
    await more.tap();
    const states = {
      compact: compactEnabled, compactExcel: compactItems.excel, compactCsv: compactItems.csv,
      menuExcel: menu.excel?.enabled ?? null, menuCsv: menu.csv?.enabled ?? null, dpgf: menu.dpgf?.enabled ?? null, bdc: menu.bdc?.enabled ?? null,
    };
    // 2.7b (D-a, docs/testing/estimate-engine-v3-2.7b.md) ouvre le CSV et le BDC d'une v3 : V3X03 à V3X05 en prouvent le contenu.
    const expectedStates = { compact: true, compactExcel: true, compactCsv: true, menuExcel: true, menuCsv: true, dpgf: true, bdc: true };
    await recordEvidence(army, "v3e15-export-actions", { versionId: draft.versionId, expected: expectedStates, actual: states, menu });
    expect(states, "the v3 editor opens Excel, DPGF, CSV and BDC (P-20, D-a)").toEqual(expectedStates);

    // Chaque export est la réponse 200 de sa route, téléchargée par l'éditeur et relue par ExcelJS.
    const exported = async (url: RegExp, trigger: () => Promise<void>) => {
      const [response, file] = await Promise.all([
        browser.waitForResponse(url, { timeout: 60_000 }), browser.waitForDownload(trigger, { timeout: 60_000 })]);
      const absolutePath = await resolveDownload(file);
      const bytes = await readFile(absolutePath);
      return { status: response.status, url: response.url, filename: file.suggestedFilename, path: absolutePath, bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"), rows: await readWorkbookRows(bytes) };
    };
    await compact.tap();
    const standard = await exported(new RegExp(`/api/estimates/${draft.versionId}/export\\?format=xlsx$`),
      () => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap());
    await more.tap();
    const dpgf = await exported(new RegExp(`/api/estimates/${draft.versionId}/export\\?format=xlsx&mode=dpgf$`),
      () => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap());
    const header = (rows: WorkbookRow[], sheet: string) => rows.find(row => row.sheet === sheet && row.row === 1)?.cells ?? null;
    const field = (rows: WorkbookRow[], sheet: string, name: string) => rows.find(row => row.sheet === sheet && row.cells[0] === name)?.cells[1] ?? null;
    const hasLine = (rows: WorkbookRow[], sheet: string) => rows.some(row => row.sheet === sheet &&
      row.cells.some(value => typeof value === "string" && normalized(value) === title) && [130, 260].every(amount => row.cells.includes(amount)));
    const exportsView = {
      standard: { status: standard.status, xlsx: /\.xlsx$/i.test(standard.filename), header: header(standard.rows, "Devis"),
        engine: field(standard.rows, "Resume", "Moteur de calcul"), line: hasLine(standard.rows, "Devis") },
      dpgf: { status: dpgf.status, xlsx: /\.xlsx$/i.test(dpgf.filename),
        v3Columns: ["Statut", "h MO / unité", "PU vente HT EUR", "Total HT brut EUR"].every(column => header(dpgf.rows, "Données")?.includes(column) ?? false),
        line: hasLine(dpgf.rows, "Données") },
    };
    // En-tête exact de l'export standard d'une v3 (writeEstimateV3Workbook) ; colonnes propres au DPGF v3.
    const expectedExports = {
      standard: { status: 200, xlsx: true, header: ["Poste", "Désignation", "Unité", "Quantité", "Statut", "TVA (%)", "PU HT", "Total HT"],
        engine: 3, line: true },
      dpgf: { status: 200, xlsx: true, v3Columns: true, line: true },
    };
    const artifact = (file: typeof standard) =>
      ({ url: file.url, filename: file.filename, path: file.path, bytes: file.bytes, sha256: file.sha256 });
    await recordEvidence(army, "v3e15-exports", { versionId: draft.versionId, expected: expectedExports, actual: exportsView,
      standard: artifact(standard), dpgf: artifact(dpgf), nativeDialogs: dialogs });
    expect(exportsView, "the v3 editor's Excel and DPGF exports are the v3 workbooks of 2.7").toEqual(expectedExports);
  });

armyTest("V3E12 bulk suggestions are applied to v3 lines and undone through the v3 writer, with recomputed totals",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E12");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    // B porte seule le mot-clé de la règle : la règle est floue (suggestion-scoring), les désignations « A », « B »
    // et « C » d'un même préfixe se seraient toutes appariées (premier passage rouge : « Examiner 3 suggestions »).
    const [lineA, lineB, lineC] = await seedLines(ui, army, draft, "v3e12", [
      withLabor(title("A"), 2, 10000, 1, draft.tuyauteurId), supply(title("robinetterie"), 1, 5000), supply(title("C"), 1, 1000)]);
    const initial: Totals = [43400, 8680, 52080];
    // Règle K FO 1,3 sur le mot-clé de B (tenant dédié) : B = 50,00 € × 1,3 × 1,3 = 84,50 €.
    const suggested: Totals = [45350, 9070, 54420];
    await lockVersion(browser, draft.versionId);
    const rule = await apiRequest<Envelope<Record<string, { id: string }>>>(browser, "POST", `/api/estimates/${draft.versionId}/suggestion-rules`,
      { name: `${army.runPrefix} K FO B`, match_value: "robinetterie", k_fo: 1.3, is_active: true });
    await releaseVersion(browser, draft.versionId);
    await recordEvidence(army, "v3e12-rule", { versionId: draft.versionId, lineId: lineB.id, response: rule });
    expect([200, 201]).toContain(rule.status);
    expect(rule.body.ok).toBe(true);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e12");
    await waitForDraftLease(ui);

    // F26-32 : appliquer les suggestions en lot passe par l'écrivain v3 (saisies seulement), qui recalcule.
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).tap();
    const review = screen.getByTestId("estimate-editor-bulk-suggestions-button");
    await expect(review).toHaveText("Examiner 1 suggestion", { timeout: 30_000 });
    await review.tap();
    const suggestions = screen.getByRole("dialog", "Application en masse des suggestions", { exact: true });
    await expect(suggestions).toBeVisible({ timeout: 30_000 });
    await suggestions.getByRole("button", "Appliquer", { exact: true }).tap();
    const kFo = (state: ArmyEstimate) => Number(state.items.find(item => item.id === lineB.id)?.k_fo);
    const applied = await waitState(ui, draft.versionId, (state) => kFo(state) === 1.3 && sameTotals(state, suggested));
    const appliedView = { kFo: kFo(applied), totals: totalsOf(applied), lineB: pickLine(applied.items.find(item => item.id === lineB.id) ?? null, ["pu", "net"]),
      dialogText: (await suggestions.isVisible()) ? apostrophes(normalized(await suggestions.textContent())) : null, genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e12-applied", { versionId: draft.versionId, actual: appliedView });
    expect({ ...appliedView, dialogText: undefined }, "bulk suggestions are written to v3 lines by the v3 writer").toEqual({
      kFo: 1.3, totals: suggested, lineB: { pu: 8450, net: 8450 }, dialogText: undefined, genericRefusal: false,
    });

    await screen.getByTestId("estimate-editor-alert-undo-bulk-suggest-button").tap();
    const undone = await waitState(ui, draft.versionId, (state) => kFo(state) === 1 && sameTotals(state, initial));
    const undoneView = { kFo: kFo(undone), totals: totalsOf(undone), genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e12-undone", { versionId: draft.versionId, actual: undoneView, nativeDialogs: dialogs });
    expect(undoneView, "undoing bulk suggestions on v3 lines goes through the v3 writer").toEqual({ kFo: 1, totals: initial, genericRefusal: false });
    await checkpoint(ui, army, "v3e12-undone", draft.versionId, {
      api: { version: { totals: initial }, lines: { [lineA.id]: { net: 35600 }, [lineB.id]: { net: 6500 }, [lineC.id]: { net: 1300 } } },
      screen: { chips: chips(initial) },
    });
  });

armyTest("V3E13 pasting rows into a v3 grid writes their v3 inputs through the v3 writer, and its undo deletes them through it",
  options(300_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E13");
    const [line, tail] = await seedLines(ui, army, draft, "v3e13",
      [supply(`${army.runPrefix} ancre`, 1, 1000), supply(`${army.runPrefix} suite`, 1, 500)]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e13");
    await waitForDraftLease(ui);
    const before = await readConsistent(ui, draft.versionId);
    const initial: Totals = [1950, 390, 2340];
    const order = (state: ArmyEstimate) => state.items.filter((item) => item.item_type === "line")
      .sort((left, right) => Number(left.position) - Number(right.position)).map((item) => item.title);

    // F26-31, levé par le 2.8 : le collage v1/v2 écrirait l'unité dans description (unit_code perdu) et des heures
    // totales (refusées). Sur une v3, l'unité passe par le référentiel (« ml » → unit_code), l'aperçu montre la valeur
    // interprétée et la ligne est écrite par l'écrivain de lot v3 juste après la ligne active (repositionnement par le
    // lot) : 2 × 10,00 € × 1,30 = 26,00 € HT.
    const pastedTitle = `${army.runPrefix} ligne collée ${randomUUID().slice(0, 4)}`;
    await browser.locator(`[data-estimate-item-id="${line.id}"] [data-testid="estimate-line-title-input"]`).click();
    await browser.evaluate(() => new Promise<boolean>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))));
    const tsv = ["Désignation\tQuantité\tUnité\tPrix unitaire HT", `${pastedTitle}\t2\tml\t10,00`].join("\n");
    await browser.evaluate((text) => {
      const target = document.querySelector("[role=\"grid\"][aria-label=\"Lignes de devis\"]");
      if (!(target instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const transfer = new DataTransfer();
      transfer.setData("text/plain", text);
      target.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }));
      return true;
    }, tsv);
    const pasteDialog = screen.getByRole("dialog", "Aperçu du collage", { exact: true });
    await expect(pasteDialog).toBeVisible({ timeout: 30_000 });
    await expect(pasteDialog.getByText("Unité ml", { exact: true })).toBeVisible();
    await screen.getByTestId("paste-preview-dialog-confirm-button").tap();
    await expect(pasteDialog).toBeHidden({ timeout: 30_000 });
    const pasted = await waitState(ui, draft.versionId, (state) => lineByTitle(state, pastedTitle) !== null &&
      sameTotals(state, [4550, 910, 5460]) && order(state)[1] === pastedTitle);
    const pastedLine = lineByTitle(pasted, pastedTitle);
    const view = {
      line: pickLine(pastedLine, ["unit", "status", "quantity", "prFo", "hPerUnit", "hMo", "pu", "net", "taxRateBp", "roleId"]),
      description: pastedLine?.description ?? null, order: order(pasted),
      totals: totalsOf(pasted), revisionBumped: pasted.version.content_revision > before.version.content_revision,
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e13-paste", { versionId: draft.versionId, tsv, actual: view, nativeDialogs: dialogs });
    expect(view, "a paste into a v3 grid writes its v3 inputs through the v3 writer").toEqual({
      line: { unit: "ml", status: "priced", quantity: 2, prFo: 1000, hPerUnit: null, hMo: 0, pu: 1300, net: 2600, taxRateBp: 2000, roleId: null },
      description: null, order: [line.title, pastedTitle, tail.title], totals: [4550, 910, 5460], revisionBumped: true,
      genericRefusal: false,
    });

    // Annuler le collage supprime la ligne collée par le lot v3.
    await undo(ui);
    const undone = await waitState(ui, draft.versionId, (state) => lineByTitle(state, pastedTitle) === null && sameTotals(state, initial));
    const undoneView = { present: lineByTitle(undone, pastedTitle) !== null, order: order(undone), totals: totalsOf(undone),
      genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e13-undo", { versionId: draft.versionId, actual: undoneView, nativeDialogs: dialogs });
    expect(undoneView, "undoing a v3 paste deletes the pasted line through the v3 writer").toEqual({
      present: false, order: [line.title, tail.title], totals: initial, genericRefusal: false,
    });
  });

armyTest("V3E14 a v3 settings save that applies its VAT rate to every line closes the undo of a bulk majoration and of the suggestions",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E14");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    // The lines of V3E12: B alone carries the rule's keyword.
    const [lineA, lineB, lineC] = await seedLines(ui, army, draft, "v3e14", [
      withLabor(title("A"), 2, 10000, 1, draft.tuyauteurId), supply(title("robinetterie"), 1, 5000), supply(title("C"), 1, 1000)]);
    expect([lineA.line_total_ht_cents, lineB.line_total_ht_cents, lineC.line_total_ht_cents]).toEqual([35600, 6500, 1300]);
    // Majoration 150 % on A: 404,00 € (V3E06). Then K FO 1,3 on B: 84,50 € (V3E12). Then « Oui » at 10 %: 50,15 € of VAT.
    const majorated: Totals = [48200, 9640, 57840];
    const acted: Totals = [50150, 10030, 60180];
    const atTenPercent: Totals = [50150, 5015, 55165];
    await lockVersion(browser, draft.versionId);
    const rule = await apiRequest<Envelope<Record<string, { id: string }>>>(browser, "POST", `/api/estimates/${draft.versionId}/suggestion-rules`,
      { name: `${army.runPrefix} K FO B`, match_value: "robinetterie", k_fo: 1.3, is_active: true });
    await releaseVersion(browser, draft.versionId);
    await recordEvidence(army, "v3e14-rule", { versionId: draft.versionId, lineId: lineB.id, response: rule });
    expect([200, 201]).toContain(rule.status);
    expect(rule.body.ok).toBe(true);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e14");
    await waitForDraftLease(ui);
    const itemOf = (state: ArmyEstimate, id: string) => state.items.find(item => item.id === id);
    const majorationOfA = (state: ArmyEstimate) => Number(itemOf(state, lineA.id)?.h_mo_majoration);
    const kFoOfB = (state: ArmyEstimate) => Number(itemOf(state, lineB.id)?.k_fo);

    // A bulk majoration, kept in the undo history, then the suggestions, kept in their own undo: both at 20 %.
    const select = screen.getByLabel(`Sélectionner la ligne ${lineA.title}`, { exact: true });
    await select.check();
    const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
    await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
    await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
    const afterMajoration = await waitState(ui, draft.versionId, (state) => majorationOfA(state) === 1.5 && sameTotals(state, majorated));
    expect({ majoration: majorationOfA(afterMajoration), totals: totalsOf(afterMajoration) }).toEqual({ majoration: 1.5, totals: majorated });
    await select.uncheck();
    await expect(bulkBar).toBeHidden();
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).tap();
    const review = screen.getByTestId("estimate-editor-bulk-suggestions-button");
    await expect(review).toHaveText("Examiner 1 suggestion", { timeout: 30_000 });
    await review.tap();
    const suggestions = screen.getByRole("dialog", "Application en masse des suggestions", { exact: true });
    await expect(suggestions).toBeVisible({ timeout: 30_000 });
    await suggestions.getByRole("button", "Appliquer", { exact: true }).tap();
    await expect(suggestions).toBeHidden({ timeout: 30_000 });
    const afterSuggestions = await waitState(ui, draft.versionId, (state) => kFoOfB(state) === 1.3 && sameTotals(state, acted));
    expect({ kFo: kFoOfB(afterSuggestions), totals: totalsOf(afterSuggestions) }).toEqual({ kFo: 1.3, totals: acted });
    await screen.getByRole("tab", "Chiffrage", { exact: true }).tap();
    const undo = screen.getByTestId("estimate-editor-undo-button", { visible: true });
    const undoSuggestions = screen.getByTestId("estimate-editor-alert-undo-bulk-suggest-button");
    await expect(undo).toBeEnabled({ timeout: 30_000 });
    await expect(undoSuggestions).toBeVisible({ timeout: 30_000 });

    // The settings of the mounted editor, opened from the summary bar: a navigation would remount the editor and drop
    // the undo state that the step judges. « Oui » rewrites every line at 10 % in the same save (D8).
    await screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).tap();
    await expect(settingsDialog(ui)).toBeVisible({ timeout: 30_000 });
    await fillCell(ui, "TVA par défaut des nouvelles lignes", "10");
    await clickSaveSettings(ui);
    const propagation = screen.getByRole("alertdialog", /^Appliquer ce taux à toutes les lignes\s?\?$/);
    await expect(propagation).toBeVisible({ timeout: 30_000 });
    await propagation.getByRole("button", "Oui", { exact: true }).tap();
    const rates = (state: ArmyEstimate) => ({
      version: Number(state.version.tax_rate_bp), lines: [lineA, lineB, lineC].map(line => Number(itemOf(state, line.id)?.tax_rate_bp)),
    });
    const saved = await waitState(ui, draft.versionId, (state) => sameTotals(state, atTenPercent));
    expect({ ...rates(saved), totals: totalsOf(saved) }).toEqual({ version: 1000, lines: [1000, 1000, 1000], totals: atTenPercent });
    // The API sees the commit before the editor receives it: the button comes back with the acknowledgement.
    await expect(settingsDialog(ui).getByRole("button", "Enregistrer le paramétrage", { exact: true })).toBeEnabled({ timeout: 30_000 });
    await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/, { timeout: 30_000 });
    await screen.getByTestId("estimate-editor-drawer-close-button").tap();
    await expect(settingsDialog(ui)).toBeHidden({ timeout: 30_000 });

    // Both undos hold A and B as they were at 20 %. Still offered here, each one is run, so that the step fails on the
    // VAT rate it writes back: the evidence of the stale undo.
    const offered = { history: await undo.isEnabled(), suggestions: await undoSuggestions.isVisible() };
    if (offered.history) {
      await undo.tap();
      await expect(screen.getByTestId("estimate-editor-redo-button", { visible: true })).toBeEnabled({ timeout: 30_000 });
    }
    if (offered.suggestions) {
      await undoSuggestions.tap();
      await expect(undoSuggestions).toBeHidden({ timeout: 30_000 });
    }
    const after = await readConsistent(ui, draft.versionId);
    const view = {
      offered, ...rates(after), majoration: majorationOfA(after), kFo: kFoOfB(after), totals: totalsOf(after),
      genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e14-after-save", { versionId: draft.versionId, actual: view, nativeDialogs: dialogs });
    expect(view, "a v3 settings save closes the undos captured before it").toEqual({
      offered: { history: false, suggestions: false }, version: 1000, lines: [1000, 1000, 1000], majoration: 1.5, kFo: 1.3,
      totals: atTenPercent, genericRefusal: false,
    });
    await checkpoint(ui, army, "v3e14-closed", draft.versionId, {
      api: {
        version: { totals: atTenPercent, taxRateBp: 1000 },
        lines: {
          [lineA.id]: { net: 40400, tax: 4040, taxRateBp: 1000 },
          [lineB.id]: { net: 8450, tax: 845, taxRateBp: 1000 },
          [lineC.id]: { net: 1300, tax: 130, taxRateBp: 1000 },
        },
      },
      screen: { chips: chips(atTenPercent, "10") },
    });
  });

/* ---------- Lot 2, sous-lot 2.6b : G1 et limites restantes de l'éditeur v3 (docs/testing/estimate-engine-v3-2.6b.md) ---------- */

type GatingFlag = { key: string; severity: string; item_ids: string[] };
type Gating = { canSend: boolean; blockingFlags: GatingFlag[]; warningFlags: GatingFlag[] };
const statusLine = (title: string, pricingStatus: string, nature = "supply_and_labor") => ({
  ...supply(title, 1, 0), line_nature: nature, unit_code: null, pricing_status: pricingStatus,
});

async function readGating(ui: Ui, versionId: string) {
  const response = await apiRequest<Envelope<{ gating: Gating }>>(ui.browser, "GET", `/api/estimates/${versionId}/gating`);
  expect([response.status, response.body.ok]).toEqual([200, true]);
  return response.body.data.gating;
}

/** Ids flagged by one quality check, whatever its severity, restricted to the given lines. */
function flaggedIds(gating: Gating, key: string, ids: readonly string[]) {
  return [...gating.blockingFlags, ...gating.warningFlags].filter(flag => flag.key === key)
    .flatMap(flag => flag.item_ids).filter(id => ids.includes(id)).sort();
}

/** Quality dots of the editor rows (LineRow « estimate-quality-dot--<flag> »), per line id. */
async function qualityDots(ui: Ui, ids: readonly string[]) {
  return ui.browser.evaluate((lineIds) => Object.fromEntries(lineIds.map((id) => [id,
    Array.from(document.querySelectorAll(`[data-estimate-item-id="${id}"] .estimate-quality-dot`))
      .map(node => Array.from(node.classList).find(name => name.startsWith("estimate-quality-dot--"))?.slice("estimate-quality-dot--".length) ?? "")
      .filter(flag => flag === "missing-price" || flag === "missing-labor-time").sort()])), ids);
}

armyTest("V3E16 included, for-memory and out-of-scope v3 lines at 0 € raise no missing price or labour time, in the send gating and the editor; a v2 line at 0 € still blocks",
  options(300_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E16");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    // P : 2 ml, 15,00 € + 1 h/u (40 €/h) = 135,00 € HT (V3E08) ; inc, PM, HL : statuts à 0 € (P-09), comme l'import d'OPTIMA.
    const [lineP, lineInc, linePm, lineHl] = await seedLines(ui, army, draft, "v3e16", [
      withLabor(title("P"), 2, 1500, 1, draft.tuyauteurId, { unit_code: "ml" }),
      statusLine(title("inc"), "included", "supply_only"), statusLine(title("PM"), "for_memory"), statusLine(title("HL"), "out_of_scope"),
    ]);
    const statusIds = [lineInc.id, linePm.id, lineHl.id];
    const seeded = await readConsistent(ui, draft.versionId);
    expect(totalsOf(seeded)).toEqual([13500, 2700, 16200]);

    // G1 : la porte d'envoi (celle de POST /send, lue par la fenêtre d'envoi) ne lève ni prix ni temps manquant sur un statut.
    // Sur main, l'émission v3 reste fermée jusqu'au 2.7 : seule l'absence de PDF bloque encore (no_pdf_generated).
    const gating = await readGating(ui, draft.versionId);
    const gatingView = {
      blocking: gating.blockingFlags.map(flag => flag.key).sort(), canSend: gating.canSend,
      missingPrice: flaggedIds(gating, "missing_price", [lineP.id, ...statusIds]),
      missingLaborTime: flaggedIds(gating, "missing_labor_time", [lineP.id, ...statusIds]),
    };
    await recordEvidence(army, "v3e16-v3-gating", { versionId: draft.versionId, statusIds, gating, actual: gatingView });
    expect(gatingView, "status lines of a v3 raise no missing price or labour time in the send gating").toEqual({
      blocking: ["no_pdf_generated"], canSend: false, missingPrice: [], missingLaborTime: [],
    });

    // Garde v1/v2 : une ligne v2 « HL » à 0 € (mention dans description) reste un prix manquant qui bloque l'envoi.
    // Avant toute navigation : le bail de l'ancre v2, pris par ensureTuyauteur, appartient à la session de ce document.
    await lockVersion(browser, draft.anchorId);
    const anchor = await readEstimate(browser, draft.anchorId);
    const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${draft.anchorId}/items`,
      { item_type: "section", position: 1, title: title("lot v2") }, { "if-match": anchor.version.updated_at });
    expect([section.status, section.body.ok]).toEqual([201, true]);
    const afterSection = await readEstimate(browser, draft.anchorId);
    const v2Line = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${draft.anchorId}/items`,
      { item_type: "line", parent_id: section.body.data.item.id, position: 1, title: title("HL v2"), description: "HL", quantity: 1,
        unit_price_ht_cents: 0, line_nature: "supply_only" }, { "if-match": afterSection.version.updated_at });
    expect([v2Line.status, v2Line.body.ok]).toEqual([201, true]);
    await releaseVersion(browser, draft.anchorId);
    const v2Gating = await readGating(ui, draft.anchorId);
    const v2View = {
      blocking: v2Gating.blockingFlags.map(flag => flag.key).includes("missing_price"), canSend: v2Gating.canSend,
      missingPrice: flaggedIds(v2Gating, "missing_price", [v2Line.body.data.item.id]),
      severity: v2Gating.blockingFlags.find(flag => flag.key === "missing_price")?.severity ?? null,
    };
    await recordEvidence(army, "v3e16-v2-gating", { versionId: draft.anchorId, lineId: v2Line.body.data.item.id, gating: v2Gating, actual: v2View });
    expect(v2View, "a v2 line at 0 € still blocks the send by missing price").toEqual({
      blocking: true, canSend: false, missingPrice: [v2Line.body.data.item.id], severity: "blocking",
    });

    // Même règle dans l'éditeur : aucune pastille « Prix manquant » ni « Temps MO manquant » sur les lignes de statut.
    await openV3Editor(ui, army, draft, "v3e16");
    await waitForDraftLease(ui);
    const empty = Object.fromEntries([lineP.id, ...statusIds].map(id => [id, [] as string[]]));
    let dots = await qualityDots(ui, [lineP.id, ...statusIds]);
    const deadline = Date.now() + 15_000;
    while (JSON.stringify(dots) !== JSON.stringify(empty) && Date.now() < deadline) {
      await pause(750);
      dots = await qualityDots(ui, [lineP.id, ...statusIds]);
    }
    await recordEvidence(army, "v3e16-editor-dots", { versionId: draft.versionId, actual: dots, nativeDialogs: dialogs });
    expect(dots, "the v3 editor shows no missing price or labour time on status lines").toEqual(empty);
  });

/**
 * The critical browser guard aborts every POST …/approve, by design (V3P01's probe): from the journey process to the
 * owned app, for the owned v3 only, with the empty provider key of the owned runner. Submitting for review freezes the
 * v3 by the same SQL freeze as the emission (ESTIMATE_V3_UNIT_REQUIRED on a priced line without unit), the only v3
 * freeze open on main until 2.7.
 */
async function submitForReview(ui: Ui, versionId: string, ruleId: string, message: string) {
  if (process.env.RESEND_API_KEY !== "") throw new Error("The v3 approval probe requires the empty provider key of the owned runner.");
  const origin = new URL(ui.app.baseUrl!).origin;
  if (!/^http:\/\/localhost:\d+$/.test(origin)) throw new Error("The v3 approval probe targets the owned loopback app only.");
  const cookie = (await ui.browser.cookies())
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

armyTest("V3E17 at phone width the mobile line editor of a v3 writes unit_code from the referential and hours per unit, and the v3 freeze accepts the line",
  options(360_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E17");
    // L : 2 × 10,00 € (FO × 1,30 = 26,00 €), sans unité ni heures ; « ml » et 1,5 h/u à 40 €/h × 1,20 → 2 × 85,00 = 170,00 € HT.
    // HL : ligne de statut à 0 € (P-09), sans unité.
    const [line, outOfScope] = await seedLines(ui, army, draft, "v3e17", [
      { ...withLabor(`${army.runPrefix} mobile`, 2, 1000, 0, draft.tuyauteurId), unit_code: null },
      statusLine(`${army.runPrefix} mobile HL`, "out_of_scope")]);
    const typed: Totals = [17000, 3400, 20400];
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e17");
    await waitForDraftLease(ui);
    await browser.setViewport({ width: 375, height: 812 });
    // À 375 px, la grille cède la place à la liste mobile (MobileEstimateList) : chaque ligne ouvre l'éditeur mobile.
    const trigger = browser.locator(`[data-testid="estimate-mobile-line-${line.id}"]`);
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    // Revue 2.6b : la liste ne prête pas l'unité « u » d'une v1/v2 à une ligne v3 sans unité (le gel la refuserait),
    // ni à une ligne de statut, qui affiche son statut.
    const listMetaOf = (id: string) => browser.evaluate((lineId) => document
      .querySelector(`[data-testid="estimate-mobile-line-${lineId}"] .estimate-mobile-line__meta .tabular-nums`)?.textContent?.trim() ?? null, id);
    const listBefore = { line: await listMetaOf(line.id), status: await listMetaOf(outOfScope.id) };
    await trigger.click();
    const editor = screen.getByTestId("estimate-mobile-line-editor");
    await expect(editor).toBeVisible({ timeout: 30_000 });

    await editor.getByLabel(`Unité pour ${line.title}`, { exact: true }).fill("ml");
    await browser.keyboard.press("Tab");
    const hoursPerUnit = editor.getByLabel(`Heures de main-d’œuvre par unité pour ${line.title}`, { exact: true });
    const fields = {
      hoursPerUnit: (await hoursPerUnit.count()) === 1,
      lineHours: (await editor.getByLabel(`Heures de main-d’œuvre pour ${line.title}`, { exact: true }).count()) === 1,
    };
    if (fields.hoursPerUnit) {
      await hoursPerUnit.fill("1,5");
      await browser.keyboard.press("Tab");
    }
    await editor.getByRole("button", "Terminer", { exact: true }).tap();
    await expect(editor).toBeHidden({ timeout: 30_000 });
    // Sur téléphone, « Sauvegarder maintenant » du menu « Plus d'actions » (l'enregistrement automatique attend 60 s).
    await screen.getByTestId("estimate-page-toolbar-more-actions-button", { visible: true }).tap();
    await screen.getByTestId("estimate-page-toolbar-save-now-button", { visible: true }).tap();
    const saved = await waitState(ui, draft.versionId, (state) => {
      const item = lineByTitle(state, line.title);
      return item?.unit_code === "ml" && Number(item?.h_mo_per_unit) === 1.5 && sameTotals(state, typed);
    });
    const savedLine = lineByTitle(saved, line.title);
    // La liste mobile affiche l'unité du référentiel de la ligne v3 (« 2 × ml »), jamais description.
    const listMeta = await listMetaOf(line.id);
    const view = {
      fields, line: pickLine(savedLine, ["unit", "status", "quantity", "hPerUnit", "hMo", "pu", "net"]),
      description: savedLine?.description ?? null, listBefore, listMeta, totals: totalsOf(saved), genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e17-mobile", { versionId: draft.versionId, lineId: line.id, actual: view, nativeDialogs: dialogs });
    expect(view, "the mobile line editor of a v3 writes unit_code and hours per unit through the v3 writer").toEqual({
      fields: { hoursPerUnit: true, lineHours: false },
      line: { unit: "ml", status: "priced", quantity: 2, hPerUnit: 1.5, hMo: 3, pu: 8500, net: 17000 },
      description: null, listBefore: { line: "2 × sans unité", status: "Hors lot" }, listMeta: "2 × ml", totals: typed, genericRefusal: false,
    });

    // Le gel v3 (celui de l'émission, ouvert sur main par la demande d'approbation) accepte la ligne : elle a son unité.
    await browser.setViewport({ width: 1280, height: 900 });
    const ruleId = await insertProjectMarginRule(draft.owner, draft.projectId, 5000);
    const submitted = await submitForReview(ui, draft.versionId, ruleId, `${army.runPrefix} gel mobile`);
    const frozen = await readConsistent(ui, draft.versionId);
    const freezeView = {
      status: submitted.status, ok: (submitted.body as Envelope<unknown>).ok ?? null,
      code: (submitted.body as Envelope<unknown>).error?.code ?? null, approvalStatus: frozen.version.approval_status,
      frozenRevision: Number(frozen.version.calc_snapshot_content_revision) === Number(frozen.version.content_revision),
      totals: totalsOf(frozen),
    };
    await recordEvidence(army, "v3e17-freeze", { versionId: draft.versionId, ruleId, submitted, actual: freezeView });
    expect(freezeView, "the v3 freeze accepts the line edited on a phone").toEqual({
      status: 201, ok: true, code: null, approvalStatus: "in_review", frozenRevision: true, totals: typed,
    });
  });

armyTest("V3E18 restoring a conflicting local draft on a v3 writes its v3 inputs through the v3 writer, with engine-3 amounts",
  options(300_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E18");
    // L : 2 u × (10,00 € × 1,30 + 1 h/u × 40 €/h × 1,20) = 122,00 € HT. Brouillon : « ml », 1,5 h/u → 2 × 85,00 = 170,00 €.
    const [line] = await seedLines(ui, army, draft, "v3e18", [withLabor(`${army.runPrefix} brouillon`, 2, 1000, 1, draft.tuyauteurId)]);
    const initial: Totals = [12200, 2440, 14640];
    const restored: Totals = [17000, 3400, 20400];
    // Mode Expert : le pied affiche les jetons TVA et TTC que le point de contrôle relit (comme V3E17 et V3E19).
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e18");
    await waitForDraftLease(ui);
    const before = await readConsistent(ui, draft.versionId);
    expect(totalsOf(before)).toEqual(initial);

    // Le brouillon que l'éditeur conserve en session après un conflit d'enregistrement (editor-drafts.ts,
    // « estimate:edit:conflict-draft:<version> ») : les lignes telles que l'éditeur les tenait, saisies v3 comprises,
    // et ses réglages (forme v2, ici une marge × 1,25 qu'une v3 ne porte pas).
    const draftItems = before.items.map(item => item.id === line.id
      ? { ...item, unit_code: "ml", h_mo_per_unit: 1.5 } : item);
    const settings = { margin_mode: "fixed", margin_multiplier: 1.25, margin_bp: 2500, discount_bp: 0, tax_rate_bp: 2000, currency: "EUR" };
    await browser.evaluate((entry) => {
      const [key, value] = entry as [string, string];
      sessionStorage.setItem(key, value);
      return true;
    }, [`estimate:edit:conflict-draft:${draft.versionId}`,
      JSON.stringify({ settings, items: draftItems, saved_at: new Date().toISOString() })]);
    await browser.reload();
    await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
    await waitForDraftLease(ui);
    const restore = screen.getByTestId("estimate-editor-alert-restore-draft-button");
    await expect(restore).toBeVisible({ timeout: 30_000 });
    await restore.tap();
    // Les lignes restaurées restent en attente : Ctrl+S les enregistre (l'enregistrement automatique attend 60 s).
    await expect(restore).toBeHidden({ timeout: 30_000 });
    // Revue 2.6b (A14) : aucun réglage v2 n'est repris ; sinon l'état passerait à « Non sauvegardé » et Ctrl+S
    // enregistrerait ce paramétrage (marge × 1,25) au lieu des lignes.
    const textOf = (testId: string) => browser.evaluate((id) =>
      document.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? null, testId);
    const afterRestore = {
      notice: await textOf("estimate-editor-alert-action-notice"), saveStatus: await textOf("estimate-page-toolbar-autosave-status"),
    };
    await browser.keyboard.press("ControlOrMeta+s");
    const after = await waitState(ui, draft.versionId, (state) => {
      const item = lineByTitle(state, line.title);
      return item?.unit_code === "ml" && Number(item?.h_mo_per_unit) === 1.5 && sameTotals(state, restored);
    });
    const restoredLine = lineByTitle(after, line.title);
    const view = {
      line: pickLine(restoredLine, ["unit", "status", "quantity", "hPerUnit", "hMo", "pu", "net"]),
      description: restoredLine?.description ?? null, totals: totalsOf(after),
      version: { marginMultiplier: Number(after.version.margin_multiplier), saleCoefficients: [Number(after.version.sale_coefficient_fo), Number(after.version.sale_coefficient_mo)] },
      genericRefusal: await genericRefusalShown(ui), afterRestore,
    };
    await recordEvidence(army, "v3e18-restored", { versionId: draft.versionId, lineId: line.id, actual: view, nativeDialogs: dialogs });
    expect(view, "a restored v3 draft writes its v3 inputs through the v3 writer, never the v2 margin").toEqual({
      line: { unit: "ml", status: "priced", quantity: 2, hPerUnit: 1.5, hMo: 3, pu: 8500, net: 17000 },
      description: null, totals: restored, version: { marginMultiplier: 1, saleCoefficients: [1.3, 1.2] }, genericRefusal: false,
      afterRestore: { notice: "Modifications locales restaurées. Les lignes restent en attente de synchronisation.", saveStatus: "En attente" },
    });
    await checkpoint(ui, army, "v3e18-restored", draft.versionId, {
      api: { version: { totals: restored }, lines: { [line.id]: { unit: "ml", hPerUnit: 1.5, net: 17000 } } },
      screen: { chips: chips(restored) },
    });
  });

armyTest("V3E19 a suggestion rule's unit is written to unit_code on a v3 in bulk and on one line, never over a chosen unit, and a unit unknown to the referential is refused by name in bulk and on one line",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E19");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    // G, T et H sans unité (brouillon admis, D9) ; K, à 0 €, a déjà son unité (u) : une règle ne la remplace ni en lot
    // ni sur sa ligne (A15). La règle de K porte aussi un K FO : sa suggestion reste affichée et appliquée sans l'unité
    // (revue de 2.6b, A15-L). Chaque désignation porte seule le mot-clé de sa règle.
    const [lineG, lineT, lineH, lineK] = await seedLines(ui, army, draft, "v3e19", [
      { ...supply(title("gaine"), 2, 1000), unit_code: null }, { ...supply(title("fourreau"), 1, 500), unit_code: null },
      { ...supply(title("chemin"), 1, 0), unit_code: null }, supply(title("corniere"), 1, 0)]);
    const totals: Totals = [3250, 650, 3900];
    await lockVersion(browser, draft.versionId);
    const rules: unknown[] = [];
    for (const [name, keyword, unit, extra] of [["G", "gaine", "ML", {}], ["T", "fourreau", "boite", {}], ["H", "chemin", "M2", {}],
      ["K", "corniere", "M2", { k_fo: 1.25 }]] as const) {
      const rule = await apiRequest<Envelope<Record<string, { id: string }>>>(browser, "POST", `/api/estimates/${draft.versionId}/suggestion-rules`,
        { name: `${army.runPrefix} unite ${name}`, match_value: keyword, unit, is_active: true, ...extra });
      rules.push(rule);
      expect([200, 201]).toContain(rule.status);
      expect(rule.body.ok).toBe(true);
    }
    await releaseVersion(browser, draft.versionId);
    await recordEvidence(army, "v3e19-rules", { versionId: draft.versionId, rules });
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e19");
    await waitForDraftLease(ui);
    const unitOf = (state: ArmyEstimate, id: string) => {
      const item = state.items.find(candidate => candidate.id === id);
      return { unit: (item?.unit_code as string | null | undefined) ?? null, description: item?.description ?? null };
    };
    const kFoOf = (state: ArmyEstimate, id: string) => Number(state.items.find(candidate => candidate.id === id)?.k_fo);

    // En lot : l'unité inconnue « boite » est refusée par son nom, sans rien écrire ; « ML » devient unit_code = ml. K n'y
    // propose que son K FO ; il est décoché pour être appliqué sur sa ligne.
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).tap();
    const review = screen.getByTestId("estimate-editor-bulk-suggestions-button");
    await expect(review).toHaveText("Examiner 4 suggestions", { timeout: 30_000 });
    await review.tap();
    const suggestions = screen.getByRole("dialog", "Application en masse des suggestions", { exact: true });
    await expect(suggestions).toBeVisible({ timeout: 30_000 });
    const beforeApply = await readConsistent(ui, draft.versionId);
    await suggestions.getByRole("button", "Appliquer", { exact: true }).tap();
    const refusal = "Unité inconnue du référentiel : « boite ».";
    const refused = await becomes(async () => apostrophes(normalized(await suggestions.textContent())).includes(refusal), 15_000);
    const afterRefusal = await readConsistent(ui, draft.versionId);
    const refusalView = {
      refused, revision: afterRefusal.version.content_revision === beforeApply.version.content_revision,
      lines: [unitOf(afterRefusal, lineG.id), unitOf(afterRefusal, lineT.id), unitOf(afterRefusal, lineH.id)],
    };
    await recordEvidence(army, "v3e19-bulk-refused", { versionId: draft.versionId, expected: refusal, actual: refusalView,
      dialogText: (await suggestions.isVisible()) ? normalized(await suggestions.textContent()) : null });
    expect(refusalView, "a rule unit unknown to the referential is refused by name, nothing written").toEqual({
      refused: true, revision: true, lines: [{ unit: null, description: null }, { unit: null, description: null }, { unit: null, description: null }],
    });
    await suggestions.getByLabel(`Sélectionner la ligne ${lineT.title}`, { exact: true }).uncheck();
    await suggestions.getByLabel(`Sélectionner la ligne ${lineH.title}`, { exact: true }).uncheck();
    await suggestions.getByLabel(`Sélectionner la ligne ${lineK.title}`, { exact: true }).uncheck();
    await suggestions.getByRole("button", "Appliquer", { exact: true }).tap();
    const applied = await waitState(ui, draft.versionId, (state) => unitOf(state, lineG.id).unit === "ml");
    const appliedView = { lines: [unitOf(applied, lineG.id), unitOf(applied, lineT.id), unitOf(applied, lineH.id)], totals: totalsOf(applied), genericRefusal: await genericRefusalShown(ui) };
    await recordEvidence(army, "v3e19-bulk-applied", { versionId: draft.versionId, actual: appliedView, nativeDialogs: dialogs });
    expect(appliedView, "a bulk rule unit is written to unit_code on a v3").toEqual({
      lines: [{ unit: "ml", description: null }, { unit: null, description: null }, { unit: null, description: null }], totals, genericRefusal: false,
    });

    // Sur une ligne : la suggestion « boite » sous T est refusée par son nom, sans rien écrire.
    if (await suggestions.isVisible()) await browser.keyboard.press("Escape");
    await expect(suggestions).toBeHidden({ timeout: 30_000 });
    await screen.getByRole("tab", "Chiffrage", { exact: true }).tap();
    // The row suggestion of a rule names it (EstimateSuggestionRow « estimate-suggestion__rule »): it is marked, then applied.
    const markRowSuggestion = (rule: string) => browser.evaluate((entry) => {
      const [ruleName, target] = entry as [string, string];
      const row = Array.from(document.querySelectorAll(".estimate-suggestion"))
        .find(node => (node.querySelector(".estimate-suggestion__rule")?.textContent ?? "").trim().startsWith(ruleName));
      row?.setAttribute("data-army-target", target);
      return Boolean(row);
    }, [`${army.runPrefix} unite ${rule}`, `v3e19-${rule}`]);
    expect(await becomes(() => markRowSuggestion("T"), 30_000), "the row suggestion of T is shown").toBe(true);
    const beforeOne = await readConsistent(ui, draft.versionId);
    await browser.locator("[data-army-target=\"v3e19-T\"] .estimate-suggestion__actions .btn-primary").click();
    const oneRefused = await becomes(async () => (await pageText(ui)).includes(apostrophes(refusal)), 15_000);
    await pause(2_000);
    const afterOne = await readConsistent(ui, draft.versionId);
    const oneView = {
      refused: oneRefused, revision: afterOne.version.content_revision === beforeOne.version.content_revision,
      line: unitOf(afterOne, lineT.id),
    };
    await recordEvidence(army, "v3e19-one-line", { versionId: draft.versionId, actual: oneView, nativeDialogs: dialogs });
    expect(oneView, "one line's rule unit unknown to the referential is refused by name, nothing written").toEqual({
      refused: true, revision: true, line: { unit: null, description: null },
    });

    // Sur une ligne sans unité, une unité connue (« M2 ») va dans unit_code, jamais dans description. Sur K, déjà en
    // « u », la même unité n'est ni proposée ni écrite : la suggestion n'y affiche et n'y applique que son K FO, une unité
    // choisie est gardée, comme en lot (revue de 2.6b, A15-L).
    expect(await becomes(() => markRowSuggestion("H"), 30_000), "the row suggestion of H is shown").toBe(true);
    expect(await becomes(() => markRowSuggestion("K"), 30_000), "the row suggestion of K is shown for its K FO").toBe(true);
    const kParts = normalized(await browser.evaluate(() =>
      document.querySelector("[data-army-target=\"v3e19-K\"] .estimate-suggestion__list")?.textContent ?? ""));
    await browser.locator("[data-army-target=\"v3e19-H\"] .estimate-suggestion__actions .btn-primary").click();
    expect(await becomes(() => markRowSuggestion("K"), 30_000), "the row suggestion of K is still shown").toBe(true);
    await browser.locator("[data-army-target=\"v3e19-K\"] .estimate-suggestion__actions .btn-primary").click();
    await browser.keyboard.press("ControlOrMeta+s");
    const oneApplied = await waitState(ui, draft.versionId, (state) => unitOf(state, lineH.id).unit !== null && kFoOf(state, lineK.id) === 1.25);
    const oneAppliedView = {
      chosenUnitProposed: kParts.includes("Unité"), kFoProposed: kParts.includes("K FO:"),
      lines: [unitOf(oneApplied, lineG.id), unitOf(oneApplied, lineT.id), unitOf(oneApplied, lineH.id), unitOf(oneApplied, lineK.id)],
      kFo: kFoOf(oneApplied, lineK.id), totals: totalsOf(oneApplied), genericRefusal: await genericRefusalShown(ui),
    };
    await recordEvidence(army, "v3e19-one-line-applied", { versionId: draft.versionId, kParts, actual: oneAppliedView, nativeDialogs: dialogs });
    expect(oneAppliedView, "one line's known rule unit is written to unit_code on a v3, never over a chosen unit").toEqual({
      chosenUnitProposed: false, kFoProposed: true,
      lines: [{ unit: "ml", description: null }, { unit: null, description: null }, { unit: "m2", description: null }, { unit: "u", description: null }],
      kFo: 1.25, totals, genericRefusal: false,
    });
  });

armyTest("V3E20 a failed reorder after undo restores one line once and offers an explicit recovery without losing its context",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E20");
    const [lineA, lineB] = await seedLines(ui, army, draft, "v3e20", [
      supply(`${army.runPrefix} A`, 1, 1000), supply(`${army.runPrefix} B`, 1, 2000), supply(`${army.runPrefix} C`, 1, 3000),
    ]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e20");
    await waitForDraftLease(ui);
    const before = await readConsistent(ui, draft.versionId);
    const initial: Totals = [7800, 1560, 9360];
    expect(totalsOf(before)).toEqual(initial);
    const placement = (state: ArmyEstimate) => state.items.map(item => ({
      id: item.id, type: item.item_type, parentId: item.parent_id, position: item.position,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const domOrder = () => browser.evaluate(() => Array.from(document.querySelectorAll(
      '[role="grid"][aria-label="Lignes de devis"] [data-estimate-item-id]',
    )).map(item => item.getAttribute("data-estimate-item-id")));
    const beforeOrder = await domOrder();
    const editorUrl = await browser.url();
    const documentOrigin = await browser.evaluate(() => performance.timeOrigin);
    const sectionRow = browser.locator(`[data-estimate-item-id="${draft.sectionId}"]`);
    const sectionTitle = browser.locator(`[data-estimate-item-id="${draft.sectionId}"] [data-testid="estimate-section-title-input"]`);
    const sectionTop = async () => { const box = await sectionTitle.boundingBox(); return box ? Math.round(box.y) : null; };

    await screen.getByRole("button", `Plus d'actions pour ${lineB.title}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Supprimer", { exact: true }).tap();
    await confirmDeletion(ui);
    const deleted = await waitState(ui, draft.versionId, state => !lineIds(state).includes(lineB.id));
    expect(totalsOf(deleted)).toEqual([5200, 1040, 6240]);
    const topBeforeUndo = await sectionTop();
    const itemUrl = new URL(`/api/estimates/${draft.versionId}/items`, app.baseUrl!).href;
    const reorderUrl = new URL(`/api/estimates/${draft.versionId}/items/reorder`, app.baseUrl!).href;
    let creationPosts = 0;
    const reorderRequests: Array<{ parentId: string | null; orderedIds: unknown }> = [];
    let releaseFailure!: () => void, releaseRetry!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
    let failureHeld = false, retryHeld = false;
    await browser.route(itemUrl, async route => {
      if (route.request.method === "POST") creationPosts++;
      await route.fallback();
    });
    await browser.route(reorderUrl, async route => {
      const body = JSON.parse(route.request.postData ?? "null") as { parent_id?: string | null; ordered_ids?: unknown } | null;
      reorderRequests.push({ parentId: body?.parent_id ?? null, orderedIds: body?.ordered_ids ?? null });
      if (reorderRequests.length === 1) {
        failureHeld = true;
        await failureGate;
        await route.fulfill({ status: 503, json: { ok: false, error: {
          code: "INTERNAL_ERROR", message: "Transport indisponible pour la remise en ordre (fixture).",
        } } });
      } else {
        retryHeld = true;
        await retryGate;
        await route.fallback();
      }
    });
    const pending = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Annulation…" });
    const partial = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Ligne restaurée, position à vérifier." });
    const success = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Suppression annulée." });
    const redo = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    const retry = screen.getByRole("button", "Réessayer la remise en ordre", { exact: true });
    let restoredId = "";
    let inFlightPending = false;
    try {
      const [failedReorder] = await Promise.all([
        browser.waitForResponse(reorderUrl),
        (async () => {
          try {
            await undo(ui);
            await expect.poll(() => failureHeld).toBe(true);
            inFlightPending = await pending.isVisible();
            const recreated = await readConsistent(ui, draft.versionId);
            const matches = recreated.items.filter(item => item.title === lineB.title);
            expect(matches).toHaveLength(1);
            restoredId = matches[0].id;
            expect(restoredId).not.toBe(lineB.id);
            expect(creationPosts).toBe(1);
            expect(await sectionTop()).toBe(topBeforeUndo);
          } finally { releaseFailure(); }
        })(),
      ]);
      const failure = { status: failedReorder.status, body: await failedReorder.json<{ ok: boolean; error: { code: string } }>() };
      await recordEvidence(army, "v3e20-reorder-refused", {
        versionId: draft.versionId, originalId: lineB.id, restoredId, creationPosts,
        requests: reorderRequests, inFlightPending, failure: { status: failure.status, ok: failure.body.ok, code: failure.body.error.code },
      });
      expect([failure.status, failure.body.ok, failure.body.error.code]).toEqual([503, false, "INTERNAL_ERROR"]);
      await expect(partial).toBeVisible();
      expect(inFlightPending, "undo announces its work while the first reorder is held").toBe(true);
      await expect(redo).toBeDisabled();
      await expect(screen.getByTestId("estimate-editor-undo-button", { visible: true })).toBeDisabled();
      await expect(screen.getByRole("combobox", lineA.title, { exact: true })).toBeDisabled();
      await expect(screen.getByLabel(`Sélectionner la ligne ${lineA.title}`, { exact: true })).toBeDisabled();
      await expect(retry).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-send-button")).toBeDisabled();
      expect(await sectionTop()).toBe(topBeforeUndo);
      expect(creationPosts).toBe(1);
      expect(reorderRequests).toHaveLength(1);

      await sectionRow.getByRole("button", "Replier la section", { exact: true }).click();
      await expect(sectionRow.getByRole("button", "Deplier la section", { exact: true })).toBeVisible();
      const restoredRow = browser.locator(`[data-estimate-item-id="${restoredId}"]`);
      await expect(restoredRow).toBeHidden();
      await screen.getByRole("button", "Vérifier la position", { exact: true }).click();
      await expect(sectionRow.getByRole("button", "Replier la section", { exact: true })).toBeVisible();
      await expect(restoredRow).toBeVisible();
      await expect.poll(() => browser.evaluate(() =>
        document.activeElement?.closest("[data-estimate-item-id]")?.getAttribute("data-estimate-item-id") ?? null)).toBe(restoredId);
      await expect(grid(ui)).toBeVisible();
      await expect(browser).toHaveURL(editorUrl);
      expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);

      const quickSearch = screen.getByRole("searchbox", "Rechercher dans le chiffrage", { exact: true });
      await quickSearch.fill(lineA.title);
      await expect(quickSearch).toHaveValue(lineA.title);
      await expect(browser.locator(`[data-estimate-item-id="${lineA.id}"]`)).toBeVisible();
      await expect(restoredRow).toBeHidden();
      await screen.getByRole("button", "Vérifier la position", { exact: true }).click();
      await expect(quickSearch).toHaveValue("");
      await expect(restoredRow).toBeVisible();
      await expect.poll(() => browser.evaluate(() =>
        document.activeElement?.closest("[data-estimate-item-id]")?.getAttribute("data-estimate-item-id") ?? null)).toBe(restoredId);
      await expect(browser).toHaveURL(editorUrl);
      expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);

      const [retriedReorder] = await Promise.all([
        browser.waitForResponse(reorderUrl),
        (async () => {
          try {
            await retry.click();
            await expect.poll(() => retryHeld).toBe(true);
            await expect(pending).toBeVisible();
            await expect(redo).toBeDisabled();
            expect(creationPosts).toBe(1);
          } finally { releaseRetry(); }
        })(),
      ]);
      const retriedBody = await retriedReorder.json<{ ok: boolean }>();
      expect([retriedReorder.status, retriedBody.ok]).toEqual([200, true]);
      await expect(success).toBeVisible();
      await expect(partial).toBeHidden();
      await expect(redo).toBeEnabled();
      await expect(screen.getByRole("combobox", lineA.title, { exact: true })).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("À jour");
      await expect(browser).toHaveURL(editorUrl);
      expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
      expect(await sectionTop()).toBe(topBeforeUndo);
      expect(creationPosts).toBe(1);
      expect(reorderRequests).toHaveLength(2);
      const expectedSiblingIds = before.items.filter(item => item.parent_id === lineB.parent_id)
        .sort((left, right) => left.position - right.position).map(item => item.id === lineB.id ? restoredId : item.id);
      expect(reorderRequests).toEqual([
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
      ]);
      const expectedPlacement = placement(before).map(item => ({ ...item, id: item.id === lineB.id ? restoredId : item.id }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const expectedOrder = beforeOrder.map(id => id === lineB.id ? restoredId : id);
      const restored = await readConsistent(ui, draft.versionId);
      expect(placement(restored)).toEqual(expectedPlacement);
      expect(totalsOf(restored)).toEqual(initial);
      await expect.poll(domOrder).toEqual(expectedOrder);
      await browser.reload();
      await expect(grid(ui)).toBeVisible();
      await waitForDraftLease(ui);
      const reloaded = await readConsistent(ui, draft.versionId);
      await recordEvidence(army, "v3e20-recovery-reloaded", {
        versionId: draft.versionId, restoredId, creationPosts, reorderRequests,
        expectedPlacement, actualPlacement: placement(reloaded), expectedOrder, actualOrder: await domOrder(),
        expectedTotals: initial, actualTotals: totalsOf(reloaded), nativeDialogs: dialogs,
      });
      expect(placement(reloaded)).toEqual(expectedPlacement);
      expect(totalsOf(reloaded)).toEqual(initial);
      expect(reloaded.items.filter(item => item.title === lineB.title)).toHaveLength(1);
      await expect.poll(domOrder).toEqual(expectedOrder);
      expect(creationPosts).toBe(1);
      expect(dialogs).toEqual([]);
    } finally {
      releaseFailure();
      releaseRetry();
      await browser.unroute(reorderUrl);
      await browser.unroute(itemUrl);
    }
  });

armyTest("V3E21 a bulk deletion undo recovers its two restored lines without recreating them or losing their exact positions",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E21");
    const [lineA, lineB] = await seedLines(ui, army, draft, "v3e21", [
      supply(`${army.runPrefix} A`, 1, 1000), supply(`${army.runPrefix} B`, 1, 2000), supply(`${army.runPrefix} C`, 1, 3000),
    ]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e21");
    await waitForDraftLease(ui);
    const before = await readConsistent(ui, draft.versionId);
    const initial: Totals = [7800, 1560, 9360];
    expect(totalsOf(before)).toEqual(initial);
    const placement = (state: ArmyEstimate) => state.items.map(item => ({
      id: item.id, type: item.item_type, parentId: item.parent_id, position: item.position,
    })).sort((left, right) => left.id.localeCompare(right.id));
    const domOrder = () => browser.evaluate(() => Array.from(document.querySelectorAll(
      '[role="grid"][aria-label="Lignes de devis"] [data-estimate-item-id]',
    )).map(item => item.getAttribute("data-estimate-item-id")));
    const beforeOrder = await domOrder();
    const editorUrl = await browser.url();
    const documentOrigin = await browser.evaluate(() => performance.timeOrigin);
    const sectionRow = browser.locator(`[data-estimate-item-id="${draft.sectionId}"]`);
    const sectionTitle = browser.locator(`[data-estimate-item-id="${draft.sectionId}"] [data-testid="estimate-section-title-input"]`);
    const sectionTop = async () => { const box = await sectionTitle.boundingBox(); return box ? Math.round(box.y) : null; };

    for (const line of [lineA, lineB]) await screen.getByLabel(`Sélectionner la ligne ${line.title}`, { exact: true }).check();
    await expect(screen.getByTestId("estimate-editor-bulk-selection-bar")).toBeVisible();
    await screen.getByTestId("estimate-editor-bulk-delete-selection-button").tap();
    await confirmDeletion(ui);
    const deleted = await waitState(ui, draft.versionId, state => !lineIds(state).includes(lineA.id) && !lineIds(state).includes(lineB.id));
    expect(totalsOf(deleted)).toEqual([3900, 780, 4680]);
    const topBeforeUndo = await sectionTop();
    const itemUrl = new URL(`/api/estimates/${draft.versionId}/items`, app.baseUrl!).href;
    const reorderUrl = new URL(`/api/estimates/${draft.versionId}/items/reorder`, app.baseUrl!).href;
    let creationPosts = 0;
    const reorderRequests: Array<{ parentId: string | null; orderedIds: unknown }> = [];
    let releaseFailure!: () => void, releaseRetry!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
    let failureHeld = false, retryHeld = false;
    await browser.route(itemUrl, async route => {
      if (route.request.method === "POST") creationPosts++;
      await route.fallback();
    });
    await browser.route(reorderUrl, async route => {
      const body = JSON.parse(route.request.postData ?? "null") as { parent_id?: string | null; ordered_ids?: unknown } | null;
      reorderRequests.push({ parentId: body?.parent_id ?? null, orderedIds: body?.ordered_ids ?? null });
      if (reorderRequests.length === 1) {
        failureHeld = true;
        await failureGate;
        await route.fulfill({ status: 503, json: { ok: false, error: {
          code: "INTERNAL_ERROR", message: "Transport indisponible pour la remise en ordre (fixture).",
        } } });
      } else {
        retryHeld = true;
        await retryGate;
        await route.fallback();
      }
    });
    const pending = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Annulation…" });
    const partial = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Lignes restaurées, positions à vérifier." });
    const success = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Suppression annulée." });
    const redo = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    const retry = screen.getByRole("button", "Réessayer la remise en ordre", { exact: true });
    const restoredIds: Record<string, string> = {};
    let inFlightPending = false;
    try {
      const [failedReorder] = await Promise.all([
        browser.waitForResponse(reorderUrl),
        (async () => {
          try {
            await undo(ui);
            await expect.poll(() => failureHeld).toBe(true);
            inFlightPending = await pending.isVisible();
            const recreated = await readConsistent(ui, draft.versionId);
            for (const original of [lineA, lineB]) {
              const matches = recreated.items.filter(item => item.title === original.title);
              expect(matches).toHaveLength(1);
              restoredIds[original.id] = matches[0].id;
              expect(matches[0].id).not.toBe(original.id);
            }
            expect(new Set(Object.values(restoredIds)).size).toBe(2);
            expect(creationPosts).toBe(2);
            expect(await sectionTop()).toBe(topBeforeUndo);
          } finally { releaseFailure(); }
        })(),
      ]);
      const failure = { status: failedReorder.status, body: await failedReorder.json<{ ok: boolean; error: { code: string } }>() };
      await recordEvidence(army, "v3e21-reorder-refused", {
        versionId: draft.versionId, originalIds: [lineA.id, lineB.id], restoredIds, creationPosts,
        requests: reorderRequests, inFlightPending, failure: { status: failure.status, ok: failure.body.ok, code: failure.body.error.code },
      });
      expect([failure.status, failure.body.ok, failure.body.error.code]).toEqual([503, false, "INTERNAL_ERROR"]);
      await expect(partial).toBeVisible();
      expect(inFlightPending, "undo announces its work while the first reorder is held").toBe(true);
      await expect(redo).toBeDisabled();
      await expect(screen.getByTestId("estimate-editor-undo-button", { visible: true })).toBeDisabled();
      await expect(screen.getByRole("combobox", lineA.title, { exact: true })).toBeDisabled();
      await expect(screen.getByLabel(`Sélectionner la ligne ${lineA.title}`, { exact: true })).toBeDisabled();
      await expect(retry).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-send-button")).toBeDisabled();
      expect(await sectionTop()).toBe(topBeforeUndo);
      expect(creationPosts).toBe(2);
      expect(reorderRequests).toHaveLength(1);

      await sectionRow.getByRole("button", "Replier la section", { exact: true }).click();
      await expect(sectionRow.getByRole("button", "Deplier la section", { exact: true })).toBeVisible();
      for (const id of Object.values(restoredIds)) {
        await expect(browser.locator(`[data-estimate-item-id="${id}"]`)).toBeHidden();
      }
      await screen.getByRole("button", "Vérifier la position", { exact: true }).click();
      await expect(sectionRow.getByRole("button", "Replier la section", { exact: true })).toBeVisible();
      for (const id of Object.values(restoredIds)) {
        await expect(browser.locator(`[data-estimate-item-id="${id}"]`)).toBeVisible();
      }
      await expect.poll(async () => Object.values(restoredIds).includes(await browser.evaluate(() =>
        document.activeElement?.closest("[data-estimate-item-id]")?.getAttribute("data-estimate-item-id") ?? ""))).toBe(true);
      await expect(grid(ui)).toBeVisible();
      await expect(browser).toHaveURL(editorUrl);
      expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);

      const [retriedReorder] = await Promise.all([
        browser.waitForResponse(reorderUrl),
        (async () => {
          try {
            await retry.click();
            await expect.poll(() => retryHeld).toBe(true);
            await expect(pending).toBeVisible();
            await expect(redo).toBeDisabled();
            expect(creationPosts).toBe(2);
          } finally { releaseRetry(); }
        })(),
      ]);
      const retriedBody = await retriedReorder.json<{ ok: boolean }>();
      expect([retriedReorder.status, retriedBody.ok]).toEqual([200, true]);
      await expect(success).toBeVisible();
      await expect(partial).toBeHidden();
      await expect(redo).toBeEnabled();
      await expect(screen.getByRole("combobox", lineA.title, { exact: true })).toBeEnabled();
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("À jour");
      await expect(browser).toHaveURL(editorUrl);
      expect(await browser.evaluate(() => performance.timeOrigin)).toBe(documentOrigin);
      expect(await sectionTop()).toBe(topBeforeUndo);
      expect(creationPosts).toBe(2);
      expect(reorderRequests).toHaveLength(2);
      const expectedSiblingIds = before.items.filter(item => item.parent_id === lineB.parent_id)
        .sort((left, right) => left.position - right.position).map(item => restoredIds[item.id] ?? item.id);
      expect(reorderRequests).toEqual([
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
      ]);
      const expectedPlacement = placement(before).map(item => ({ ...item, id: restoredIds[item.id] ?? item.id }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const expectedOrder = beforeOrder.map(id => restoredIds[id!] ?? id);
      const restored = await readConsistent(ui, draft.versionId);
      expect(placement(restored)).toEqual(expectedPlacement);
      expect(totalsOf(restored)).toEqual(initial);
      await expect.poll(domOrder).toEqual(expectedOrder);
      await browser.reload();
      await expect(grid(ui)).toBeVisible();
      await waitForDraftLease(ui);
      const reloaded = await readConsistent(ui, draft.versionId);
      await recordEvidence(army, "v3e21-recovery-reloaded", {
        versionId: draft.versionId, restoredIds, creationPosts, reorderRequests,
        expectedPlacement, actualPlacement: placement(reloaded), expectedOrder, actualOrder: await domOrder(),
        expectedTotals: initial, actualTotals: totalsOf(reloaded), nativeDialogs: dialogs,
      });
      expect(placement(reloaded)).toEqual(expectedPlacement);
      expect(totalsOf(reloaded)).toEqual(initial);
      for (const original of [lineA, lineB]) expect(reloaded.items.filter(item => item.title === original.title)).toHaveLength(1);
      await expect.poll(domOrder).toEqual(expectedOrder);
      expect(creationPosts).toBe(2);
      expect(dialogs).toEqual([]);
    } finally {
      releaseFailure();
      releaseRetry();
      await browser.unroute(reorderUrl);
      await browser.unroute(itemUrl);
    }
  });

armyTest("V3E22 a queued line save cannot clear an undo recovery when its acknowledgement arrives after the failed reorder",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const draft = await prepareV3Draft(ui, army, "V3E22");
    const [lineA, lineB] = await seedLines(ui, army, draft, "v3e22", [
      supply(`${army.runPrefix} A`, 1, 1000), supply(`${army.runPrefix} B`, 1, 2000), supply(`${army.runPrefix} C`, 1, 3000),
    ]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e22");
    await waitForDraftLease(ui);
    const before = await readConsistent(ui, draft.versionId);
    const quantity = screen.getByLabel(`Quantité pour ${lineA.title}`, { exact: true });
    // A real unsaved edit precedes the deletion, so undo still targets deletion.
    // Ctrl+S below uses the ordinary flush path; the version mutation queue holds
    // it behind the in-flight reorder, without changing the one-minute cadence.
    await fillCell(ui, `Quantité pour ${lineA.title}`, "2");
    await expect(quantity).toHaveValue("2");
    await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("En attente");
    expect(Number((await readConsistent(ui, draft.versionId)).items.find(item => item.id === lineA.id)?.quantity)).toBe(1);
    await screen.getByRole("button", `Plus d'actions pour ${lineB.title}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Supprimer", { exact: true }).tap();
    await confirmDeletion(ui);
    await waitState(ui, draft.versionId, state => !lineIds(state).includes(lineB.id));

    const itemUrl = new URL(`/api/estimates/${draft.versionId}/items`, app.baseUrl!).href;
    const reorderUrl = new URL(`/api/estimates/${draft.versionId}/items/reorder`, app.baseUrl!).href;
    const batchUrl = new URL(`/api/estimates/${draft.versionId}/batch`, app.baseUrl!).href;
    const events: string[] = [];
    let creationPosts = 0;
    const reorderRequests: Array<{ parentId: string | null; orderedIds: unknown }> = [];
    const saveRequests: Array<{ operations: Array<{ op: string; id?: string; data?: { quantity?: number } }> }> = [];
    let releaseFailure!: () => void, releaseSave!: () => void;
    const failureGate = new Promise<void>(resolve => { releaseFailure = resolve; });
    const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
    let failureHeld = false, saveHeld = false;
    await browser.route(itemUrl, async route => {
      if (route.request.method === "POST") creationPosts++;
      await route.fallback();
    });
    await browser.route(reorderUrl, async route => {
      const body = JSON.parse(route.request.postData ?? "null") as { parent_id?: string | null; ordered_ids?: unknown } | null;
      reorderRequests.push({ parentId: body?.parent_id ?? null, orderedIds: body?.ordered_ids ?? null });
      if (reorderRequests.length === 1) {
        failureHeld = true;
        events.push("undo-reorder-held");
        await failureGate;
        events.push("undo-reorder-refused");
        await route.fulfill({ status: 503, json: { ok: false, error: {
          code: "INTERNAL_ERROR", message: "Transport indisponible pour la remise en ordre (fixture).",
        } } });
      } else await route.fallback();
    });
    await browser.route(batchUrl, async route => {
      if (route.request.method !== "POST") { await route.fallback(); return; }
      saveRequests.push(JSON.parse(route.request.postData ?? "null") as typeof saveRequests[number]);
      saveHeld = true;
      events.push("queued-save-request-held");
      await saveGate;
      events.push("queued-save-request-released");
      await route.fallback();
    });
    const pending = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Annulation…" });
    const partial = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Ligne restaurée, position à vérifier." });
    const success = screen.getByRole("status", "Historique des modifications", { exact: true }).filter({ hasText: "Suppression annulée." });
    const retry = screen.getByRole("button", "Réessayer la remise en ordre", { exact: true });
    const redo = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    let restoredId = "";
    let pendingEdits = { quantityEnabled: true, selectionEnabled: true };
    try {
      const [saveResponse] = await Promise.all([
        browser.waitForResponse(batchUrl),
        (async () => {
          const [refused] = await Promise.all([
            browser.waitForResponse(reorderUrl),
            (async () => {
              try {
                await undo(ui);
                await expect.poll(() => failureHeld).toBe(true);
                await expect(pending).toBeVisible();
                pendingEdits = {
                  quantityEnabled: await quantity.isEnabled(),
                  selectionEnabled: await screen.getByLabel(`Sélectionner la ligne ${lineA.title}`, { exact: true }).isEnabled(),
                };
                // Record both findings in one red run: the deferred save still
                // exercises recovery even if the pending edit guard is missing.
                expect.soft(pendingEdits).toEqual({ quantityEnabled: false, selectionEnabled: false });
                events.push("save-requested-during-undo");
                await browser.keyboard.press("ControlOrMeta+s");
              } finally { releaseFailure(); }
            })(),
          ]);
          const refusedBody = await refused.json<{ ok: boolean; error: { code: string } }>();
          expect([refused.status, refusedBody.ok, refusedBody.error.code]).toEqual([503, false, "INTERNAL_ERROR"]);
          await expect.poll(() => saveHeld).toBe(true);
          await expect(partial).toBeVisible();
          await expect(retry).toBeEnabled();
          events.push("recovery-visible-before-save-ack");
          const recreated = await readConsistent(ui, draft.versionId);
          const matches = recreated.items.filter(item => item.title === lineB.title);
          expect(matches).toHaveLength(1);
          restoredId = matches[0].id;
          expect(restoredId).not.toBe(lineB.id);
          expect(Number(recreated.items.find(item => item.id === lineA.id)?.quantity)).toBe(1);
          expect(creationPosts).toBe(1);
          expect(saveRequests).toHaveLength(1);
          expect(saveRequests[0].operations).toHaveLength(1);
          expect(saveRequests[0].operations[0]).toMatchObject({ op: "update", id: lineA.id, data: { quantity: 2 } });
          await recordEvidence(army, "v3e22-before-late-save-ack", {
            versionId: draft.versionId, originalId: lineB.id, restoredId, creationPosts,
            events, pendingEdits, saveRequests, reorderRequests,
            failure: { status: refused.status, ok: refusedBody.ok, code: refusedBody.error.code },
          });
          releaseSave();
        })(),
      ]);
      const saved = await saveResponse.json<{ ok: boolean; data: { committed: boolean } }>();
      expect([saveResponse.status, saved.ok, saved.data.committed]).toEqual([200, true, true]);
      // The buffer is removed by the successful flush before clearHistory is
      // called; this observes completion of that real acknowledgement path.
      await expect.poll(() => browser.evaluate(id =>
        localStorage.getItem(`estimate:edit:autosave-buffer:${id}`) === null, draft.versionId)).toBe(true);
      const savedState = await readConsistent(ui, draft.versionId);
      expect(Number(savedState.items.find(item => item.id === lineA.id)?.quantity)).toBe(2);
      const afterAck = { recoveryVisible: await partial.isVisible(), retryVisible: await retry.isVisible() };
      events.push("save-acknowledged");
      await recordEvidence(army, "v3e22-after-late-save-ack", {
        versionId: draft.versionId, events, afterAck, creationPosts, saveRequests, reorderRequests,
        saved: { status: saveResponse.status, ok: saved.ok, committed: saved.data.committed },
      });
      await expect(partial).toBeVisible();
      await expect(retry).toBeEnabled();
      await expect(redo).toBeDisabled();
      await expect(quantity).toBeDisabled();
      const [retried] = await Promise.all([browser.waitForResponse(reorderUrl), retry.click()]);
      const retriedBody = await retried.json<{ ok: boolean }>();
      expect([retried.status, retriedBody.ok]).toEqual([200, true]);
      await expect(success).toBeVisible();
      await expect(partial).toBeHidden();
      await expect(redo).toBeEnabled();
      await expect(quantity).toBeEnabled();
      await expect(quantity).toHaveValue("2");
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(À jour|Sauvegardé)$/);
      const expectedSiblingIds = before.items.filter(item => item.parent_id === lineB.parent_id)
        .sort((left, right) => left.position - right.position).map(item => item.id === lineB.id ? restoredId : item.id);
      expect(reorderRequests).toEqual([
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
        { parentId: lineB.parent_id, orderedIds: expectedSiblingIds },
      ]);
      const restored = await readConsistent(ui, draft.versionId);
      expect(Number(restored.items.find(item => item.id === lineA.id)?.quantity)).toBe(2);
      expect(restored.items.filter(item => item.title === lineB.title)).toHaveLength(1);
      expect(restored.items.map(item => item.id).sort()).toEqual(before.items.map(item => item.id === lineB.id ? restoredId : item.id).sort());
      expect(creationPosts).toBe(1);
      expect(saveRequests).toHaveLength(1);
      await recordEvidence(army, "v3e22-recovery-after-late-save", {
        versionId: draft.versionId, restoredId, events, creationPosts, saveRequests, reorderRequests,
        retry: { status: retried.status, ok: retriedBody.ok }, restoredIds: restored.items.map(item => item.id),
      });
    } finally {
      releaseFailure();
      releaseSave();
      await browser.unroute(reorderUrl);
      await browser.unroute(batchUrl);
      await browser.unroute(itemUrl);
    }
  });
