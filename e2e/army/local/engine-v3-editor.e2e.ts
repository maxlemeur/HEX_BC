import { expect } from "e2e";

import {
  apiRequest, armyTest, recordEvidence, saveLineEditsWithShortcut, waitForAutoSave,
  type ArmyEstimate, type ArmyState,
} from "../critical/fixtures";
import {
  BANNER, addGridLine, apiProjection, checkpoint, clickSaveSettings, eur, fillCell, grid, inputValue, lineView,
  normalized, openSettings, openV3Editor, pause, prepareV3Draft, readConsistent, releaseOfferForPreselection, seedLines,
  settingsDialog, settingsText, showStandardColumns, switchToExpertMode, typeTitle, waitForDraftLease,
  type ApiExpectation, type Envelope, type LineView, type RowExpectation, type Ui, type V3Draft,
} from "./engine-v3-editor-support";

// Lot 2, sous-lot 2.6 — éditeur et réglages v3 (A2, A3, A5, A6 côté saisie), écrit rouge avant le code.
// Scénarios, défaillances et contrat d'écran : docs/testing/estimate-engine-v3-2.6.md §9 ; défaillances
// F26-xx et isolation : même document, §2 et §4 ; conception §14 « 2.6 » et §5.
// V3E-nn = scénario n du §14 (11 : présélection fournisseurs). Parcours :
//  V3E01 — V3E-01 (éditeur ouvert, 7 lignes par la grille, 1,3 / 1,3), V3E-02 (coefficient vidé),
//          V3E-03 (remise : montant, taux, c_FO doublé), V3E-05 (TVA par défaut, S5), V3E-07 (« ML »),
//          V3E-08 (Q doublée), V3E-09 (barèmes), V3E-10 (arrondi S4), fiche et impression du brouillon ;
//  V3E02 — V3E-06 (« Hors lot » puis « Chiffrée »), V3E-04 (remise plafonnée, « demandé / appliqué ») ;
//  V3E03 — V3E-07 (suggestion du catalogue), V3E-11 (présélection : recalcul persisté ou refus nommé).
//  V3E04 — V3E-12 (comparaison fournisseurs d'une ligne : unité de la ligne v3 lue dans unit_code), ajouté à
//          l'intégration (doc 2.6 §10.4, F26-20), rouge avant la correction.
// Chaque état sauvegardé est lu à l'écran, par l'API, puis à l'écran et par l'API après rechargement.
const options = (timeout: number) => ({ session: "army", tags: ["critical", "local", "engine-v3"], timeout }) as const;

type OracleRow = {
  ref: string; typedUnit: string; unit: string; unitText: string; quantity: string; q: number; pr: string; prCents: number;
  h: string; hPerUnit: number; hMo: number; hTotal: string; pu: number; gross: number;
};
// §5.1 : 40 €/h, k_fo = k_mo = maj = 1, c_FO 1,30, c_MO 1,20 ; h_mo = arrondi(Q × h/u, 3) (D4).
// O4 est saisi « ML » (V3E-07 : alias du référentiel d'unités, P-08).
const ORACLE: OracleRow[] = [
  { ref: "O1", typedUnit: "ml", unit: "ml", unitText: "ml — mètre linéaire", quantity: "20", q: 20, pr: "54,66", prCents: 5466, h: "1,991", hPerUnit: 1.991, hMo: 39.82, hTotal: "39,82", pu: 16663, gross: 333260 },
  { ref: "O2", typedUnit: "u", unit: "u", unitText: "u — unité", quantity: "3", q: 3, pr: "95,63", prCents: 9563, h: "1,75", hPerUnit: 1.75, hMo: 5.25, hTotal: "5,25", pu: 20832, gross: 62496 },
  { ref: "O3", typedUnit: "m2", unit: "m2", unitText: "m2 — mètre carré", quantity: "21", q: 21, pr: "58,50", prCents: 5850, h: "0", hPerUnit: 0, hMo: 0, hTotal: "0", pu: 7605, gross: 159705 },
  { ref: "O4", typedUnit: "ML", unit: "ml", unitText: "ml — mètre linéaire", quantity: "1139", q: 1139, pr: "3,02", prCents: 302, h: "0,2", hPerUnit: 0.2, hMo: 227.8, hTotal: "227,8", pu: 1353, gross: 1541067 },
  { ref: "O5", typedUnit: "u", unit: "u", unitText: "u — unité", quantity: "1", q: 1, pr: "20,00", prCents: 2000, h: "6", hPerUnit: 6, hMo: 6, hTotal: "6", pu: 31400, gross: 31400 },
  { ref: "O6", typedUnit: "ml", unit: "ml", unitText: "ml — mètre linéaire", quantity: "282", q: 282, pr: "91,86", prCents: 9186, h: "0,998", hPerUnit: 0.998, hMo: 281.436, hTotal: "281,436", pu: 16732, gross: 4718424 },
  { ref: "O7", typedUnit: "ml", unit: "ml", unitText: "ml — mètre linéaire", quantity: "8", q: 8, pr: "8,83", prCents: 883, h: "1,30", hPerUnit: 1.3, hMo: 10.4, hTotal: "10,4", pu: 7388, gross: 59104 },
];
// Totaux S1 à S5 : §5.2 de la conception. Autres états (1,3 / 1,3, O5 à Q 2, c_FO 2,60 à 10 %, S2 à 10 %) et
// nets par ligne : moteur pur 2.4 (computeEstimateV3Breakdown) ; ces valeurs ne dépendent pas de l'ordre des
// id (D13), vérifié sur les 5 040 permutations (la TVA par ligne de S2 et S4 en dépend : jamais assertée ici).
type Totals = [number, number, number];
const S1 = { totals: [6905456, 1381091, 8286547] as Totals, nets: ORACLE.map(line => line.gross) };
const S2 = { totals: [6905355, 1381071, 8286426] as Totals, nets: [333255, 62495, 159703, 1541044, 31400, 4718355, 59103] };
const S3 = { totals: [6214910, 1242982, 7457892] as Totals, applied: 690546 };
const S4 = { totals: [6900000, 1380000, 8280000] as Totals, rounding: 5355 };
const S5 = { totals: [6905355, 1325525, 8230880] as Totals };
const PU_130_130 = [17459, 21532, 7605, 1433, 33800, 17131, 7908];
const C130_130 = { totals: [7133674, 1426735, 8560409] as Totals };
const O5_Q2 = { totals: [6936856, 1387371, 8324227] as Totals };
const PU_CFO_260 = [23768, 33264, 15210, 1745, 34000, 28674, 8536];
const CFO_260 = { totals: [9963426, 1992685, 11956111] as Totals, gross: 11070473, applied: 1107047 };
const S2_VAT10 = { totals: [6905355, 690536, 7595891] as Totals };
// Message du refus nommé ESTIMATE_V3_SUPPLIER_PRESELECTION_UNSUPPORTED (repli de F26-17 ; doc 2.6 §9.4.6).
const PRESELECTION_REFUSAL = "La présélection fournisseurs n’est pas disponible pour un devis au moteur de calcul 3.";
// La marge v2 (multiplicateur ×1 en v3) ne doit jamais s'afficher « 0% » au pied (F26-12).
const FORBIDDEN_V2_MARGIN = "Marge : 0%";

const puText = (cents: number) => eur(cents).replace(" €", "");
const chips = (totals: Totals, rates: Array<[string, number]>, extra: string[] = []) => [
  `Total HT : ${eur(totals[0])}`, `TVA : ${eur(totals[1])}`, ...rates.map(([rate, tax]) => `TVA ${rate} % : ${eur(tax)}`),
  `TTC à payer : ${eur(totals[2])}`, ...extra,
];
const discountChip = (applied: number) => `Remise commerciale : ${eur(-applied)}`;
const apostrophes = (text: string) => text.replace(/[’']/g, "'");

type Placed = { id: string; title: string; row: OracleRow };

function oracleLines(placed: Placed[], tuyauteurId: string, nets: number[], taxRateBp = 2000): Record<string, Partial<LineView>> {
  return Object.fromEntries(placed.map(({ id, row }, index) => [id, {
    unit: row.unit, status: "priced", quantity: row.q, prFo: row.prCents, hPerUnit: row.hPerUnit, hMo: row.hMo, pu: row.pu,
    net: nets[index], taxRateBp, roleId: tuyauteurId,
  }]));
}

async function recordDialogs(ui: Ui) {
  const dialogs: string[] = [];
  // A native dialog (beforeunload of a navigation) must not latch as unhandled; each one is recorded.
  await ui.browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.accept(); });
  return dialogs;
}

/** Leaves the settings drawer URL: grid interactions need the plain editor route. */
async function openGrid(ui: Ui, versionId: string) {
  await ui.browser.goto(`/dashboard/estimates/${versionId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
  await waitForDraftLease(ui);
}

async function waitSettingsSaved(ui: Ui, army: ArmyState, label: string, versionId: string, expected: ApiExpectation) {
  const deadline = Date.now() + 60_000;
  let state = await readConsistent(ui, versionId);
  const target = { version: expected.version, lines: expected.lines ?? {} };
  while (JSON.stringify(apiProjection(state, expected)) !== JSON.stringify(target) && Date.now() < deadline) {
    await pause(1_000);
    state = await readConsistent(ui, versionId);
  }
  await recordEvidence(army, `v3e-settings-${label}`, { versionId, expected: target, actual: apiProjection(state, expected) });
  expect(apiProjection(state, expected), `${label}: settings persisted`).toEqual(target);
  return state;
}

armyTest("V3E01 the v3 editor types the oracle through the grid and sets coefficients, discount intent, commercial rounding and VAT by rate",
  options(900_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E01");
    await switchToExpertMode(ui);

    // V3E-01 : l'éditeur s'ouvre sur la v3 (premier rouge avant 2.6 : le bandeau de 2.1 le remplace).
    await openV3Editor(ui, army, draft, "v3e01");
    await showStandardColumns(ui);

    // V3E-01, V3E-07 : les 7 lignes-oracle saisies par la grille (désignation, U, Q, PR FO, h/u, rôle).
    const placed: Placed[] = [];
    for (const row of ORACLE) {
      const id = await addGridLine(ui, draft);
      const title = `${army.runPrefix} ${row.ref}`;
      await typeTitle(ui, id, title);
      await fillCell(ui, `Unité pour ${title}`, row.typedUnit);
      await fillCell(ui, `Quantité pour ${title}`, row.quantity);
      await fillCell(ui, `Prix d’achat unitaire HT pour ${title}`, row.pr);
      await fillCell(ui, `Heures de main-d’œuvre par unité pour ${title}`, row.h);
      await fillCell(ui, `Rôle de main-d'œuvre pour ${title}`, "Tuyauteur");
      await saveLineEditsWithShortcut(ui, draft.versionId, title, army);
      const expected = {
        title, unit: row.unit, status: "priced", quantity: row.q, prFo: row.prCents, hPerUnit: row.hPerUnit, hMo: row.hMo, pu: row.pu,
        net: row.gross, taxRateBp: 2000, roleId: draft.tuyauteurId,
      };
      const saved = await waitForAutoSave(ui, draft.versionId, (snapshot) => {
        const item = snapshot.items.find(candidate => candidate.id === id);
        if (!item) return false;
        const view = lineView(item);
        return JSON.stringify(Object.keys(expected).map(key => view[key as keyof LineView])) === JSON.stringify(Object.values(expected));
      }, army);
      const item = saved.items.find(candidate => candidate.id === id)!;
      await recordEvidence(army, `v3e-grid-${row.ref.toLowerCase()}`, { versionId: draft.versionId, itemId: id, typed: row, expected, actual: lineView(item) });
      placed.push({ id, title, row });
    }
    // « h MO total » est dérivé (Q × h/u) et jamais saisi (F26-11).
    const hTotalControl = await browser.evaluate((input) => {
      const row = document.querySelector(`[data-estimate-item-id="${input.id}"]`);
      const node = row ? Array.from(row.querySelectorAll("[aria-label]")).find(entry => entry.getAttribute("aria-label") === input.label) ?? null : null;
      if (!node) return null;
      const editable = (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) && !node.readOnly && !node.disabled;
      return { tag: node.tagName.toLowerCase(), editable, ariaReadonly: node.getAttribute("aria-readonly") };
    }, { id: placed[0].id, label: `Heures de main-d’œuvre totales pour ${placed[0].title}` });
    await recordEvidence(army, "v3e-h-total-control", { control: hTotalControl });
    expect(hTotalControl?.editable, "« h MO total » is read-only").toBe(false);
    const s1Rows: RowExpectation[] = placed.map(({ id, title, row }) => ({ id, title, unit: row.unitText, pu: puText(row.pu), pt: eur(row.gross), hTotal: row.hTotal }));
    const s1Api: ApiExpectation = {
      version: { totals: S1.totals, gross: 6905456, applied: 0, commercialRounding: 0, roundingAdjustment: 0, saleCoefficients: [1.3, 1.2],
        discountBp: 0, discountAmountCents: null, taxRateBp: 2000, taxByRate: [{ rateBp: 2000, baseCents: 6905456, taxCents: 1381091 }] },
      lines: oracleLines(placed, draft.tuyauteurId, S1.nets),
    };
    await checkpoint(ui, army, "s1", draft.versionId, {
      api: s1Api, screen: { chips: chips(S1.totals, [["20", 1381091]]), forbiddenChipPrefixes: [FORBIDDEN_V2_MARGIN], rows: s1Rows },
    });

    // Aide des colonnes selon le moteur (D11) : « h MO / u » en v3, jamais « heures totales de la ligne ».
    await screen.getByTestId("estimate-columns-help-button", { visible: true }).click();
    const help = screen.getByTestId("estimate-columns-help-panel");
    await expect(help).toBeVisible();
    const helpText = normalized(await help.textContent());
    await recordEvidence(army, "v3e-columns-help", { helpText });
    expect(helpText).toContain("h MO / u");
    expect(helpText).not.toContain("heures totales de la ligne");
    await screen.getByRole("button", "Fermer l’aide des colonnes", { exact: true }).click();
    await expect(help).toBeHidden();

    // V3E-08 : Q de O5 (6 h/u) doublée → heures totales et PT doublés, exactement.
    const o5 = placed[4];
    await fillCell(ui, `Quantité pour ${o5.title}`, "2");
    await saveLineEditsWithShortcut(ui, draft.versionId, o5.title, army);
    await waitForAutoSave(ui, draft.versionId, (snapshot) => snapshot.version.total_ht_cents === O5_Q2.totals[0], army);
    await checkpoint(ui, army, "o5-q2", draft.versionId, {
      api: { version: { totals: O5_Q2.totals, gross: 6936856 }, lines: { [o5.id]: { quantity: 2, hMo: 12, pu: 31400, net: 62800 } } },
      screen: { chips: chips(O5_Q2.totals, [["20", 1387371]]), rows: [{ id: o5.id, title: o5.title, pu: "314,00", pt: eur(62800), hTotal: "12" }] },
    });
    await fillCell(ui, `Quantité pour ${o5.title}`, "1");
    await saveLineEditsWithShortcut(ui, draft.versionId, o5.title, army);
    await waitForAutoSave(ui, draft.versionId, (snapshot) => snapshot.version.total_ht_cents === S1.totals[0], army);
    await checkpoint(ui, army, "o5-q1", draft.versionId, {
      api: { version: { totals: S1.totals }, lines: { [o5.id]: { quantity: 1, hMo: 6, pu: 31400, net: 31400 } } },
      screen: { chips: chips(S1.totals, [["20", 1381091]]), rows: [{ id: o5.id, title: o5.title, pu: "314,00", pt: eur(31400), hTotal: "6" }] },
    });

    // V3E-09 (sans barème d'entreprise) : aucun barème par défaut affiché en v3.
    let dialog = await openSettings(ui, draft.versionId);
    const noTierText = normalized(await dialog.textContent());
    const fields = {
      fo: await inputValue(dialog.getByLabel("Coefficient de vente FO", { exact: true })),
      mo: await inputValue(dialog.getByLabel("Coefficient de vente MO", { exact: true })),
      amount: await inputValue(dialog.getByLabel("Remise (EUR HT)", { exact: true })),
      rate: await inputValue(dialog.getByLabel("Remise (%)", { exact: true })),
      defaultVat: await inputValue(dialog.getByLabel("TVA par défaut des nouvelles lignes", { exact: true })),
    };
    await recordEvidence(army, "v3e-settings-initial", { versionId: draft.versionId, fields, text: noTierText });
    expect(fields).toEqual({ fo: "1,30", mo: "1,20", amount: "", rate: "", defaultVat: "20" });
    expect(/barème par défaut/i.test(noTierText), "no default tier in v3").toBe(false);
    expect(/×\s?1[,.]60\b/.test(noTierText), "the hard-coded 1,60 tier is never shown in v3").toBe(false);

    // V3E-02 : coefficient FO vidé → refus explicite, 1,30 conservé, jamais 0.
    const fo = dialog.getByLabel("Coefficient de vente FO", { exact: true });
    await fo.fill("");
    await browser.keyboard.press("Tab");
    await expect(fo).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText(/^Coefficient de vente FO obligatoire/)).toBeVisible();
    // A disabled save is one way to refuse; an enabled one may be tried, and nothing may be written.
    const save = dialog.getByRole("button", "Enregistrer le paramétrage", { exact: true });
    const saveEnabled = await save.isEnabled();
    if (saveEnabled) {
      await save.tap();
      const settled = Date.now() + 30_000;
      while (normalized(await save.textContent()) === "Enregistrement…" && Date.now() < settled) await pause(500);
    }
    const afterRefusal = await readConsistent(ui, draft.versionId);
    dialog = await openSettings(ui, draft.versionId);
    const foAfterReload = await inputValue(dialog.getByLabel("Coefficient de vente FO", { exact: true }));
    await recordEvidence(army, "v3e-fo-emptied", { versionId: draft.versionId, saveEnabled,
      persisted: apiProjection(afterRefusal, s1Api).version, foAfterReload });
    expect(apiProjection(afterRefusal, s1Api)).toEqual({ version: s1Api.version, lines: s1Api.lines });
    expect(foAfterReload).toBe("1,30");

    // V3E-01 : à 1,3 / 1,3, PU de O1 = 174,59 €.
    await fillCell(ui, "Coefficient de vente MO", "1,30");
    await clickSaveSettings(ui);
    await waitSettingsSaved(ui, army, "mo-130", draft.versionId, { version: { saleCoefficients: [1.3, 1.3], totals: C130_130.totals } });
    await checkpoint(ui, army, "coeff-130-130", draft.versionId, {
      api: { version: { saleCoefficients: [1.3, 1.3], totals: C130_130.totals, gross: 7133674 },
        lines: Object.fromEntries(placed.map(({ id }, index) => [id, { pu: PU_130_130[index] }])) },
      screen: { chips: chips(C130_130.totals, [["20", 1426735]]),
        rows: [{ id: placed[0].id, title: placed[0].title, pu: "174,59", pt: eur(349180) }] },
    });
    await openSettings(ui, draft.versionId);
    await fillCell(ui, "Coefficient de vente MO", "1,20");
    await clickSaveSettings(ui);
    await waitSettingsSaved(ui, army, "mo-120", draft.versionId, { version: { saleCoefficients: [1.3, 1.2], totals: S1.totals } });

    // V3E-09 (barème d'entreprise) : repère affiché « non appliqué », montants inchangés.
    for (const tier of [{ threshold_cents: 0, multiplier: 1.15, position: 0 }, { threshold_cents: 5_000_000, multiplier: 1.1, position: 1 }]) {
      const created = await apiRequest<Envelope<unknown>>(browser, "POST", "/api/margin-tiers", tier);
      expect([created.status, created.body.ok]).toEqual([201, true]);
    }
    dialog = await openSettings(ui, draft.versionId);
    await expect(dialog.getByTestId("estimate-v3-margin-tier-hint")).toBeVisible({ timeout: 30_000 });
    const hint = await settingsText(ui, "estimate-v3-margin-tier-hint");
    const tierText = normalized(await dialog.textContent());
    const afterTiers = await readConsistent(ui, draft.versionId);
    await recordEvidence(army, "v3e-tier-hint", { versionId: draft.versionId, hint, persisted: apiProjection(afterTiers, s1Api).version });
    expect(hint).toContain("×1,10");
    expect(hint).toContain("non appliqué");
    expect(/barème par défaut/i.test(tierText)).toBe(false);
    expect(apiProjection(afterTiers, s1Api)).toEqual({ version: s1Api.version, lines: s1Api.lines });

    // V3E-03 (S2) : remise de 1,01 € → appliquée 1,01 €, discount_bp 0, « demandé / appliqué ».
    await fillCell(ui, "Remise (EUR HT)", "1,01");
    await clickSaveSettings(ui);
    const s2Version = { totals: S2.totals, gross: 6905456, applied: 101, commercialRounding: 0, discountBp: 0, discountAmountCents: 101,
      taxByRate: [{ rateBp: 2000, baseCents: 6905355, taxCents: 1381071 }] };
    await waitSettingsSaved(ui, army, "s2", draft.versionId, { version: s2Version });
    await checkpoint(ui, army, "s2", draft.versionId, {
      api: { version: s2Version, lines: Object.fromEntries(placed.map(({ id }, index) => [id, { net: S2.nets[index] }])) },
      screen: { chips: chips(S2.totals, [["20", 1381071]], [discountChip(101)]), forbiddenChipPrefixes: [FORBIDDEN_V2_MARGIN] },
    });
    dialog = await openSettings(ui, draft.versionId);
    expect([await inputValue(dialog.getByLabel("Remise (EUR HT)", { exact: true })), await inputValue(dialog.getByLabel("Remise (%)", { exact: true }))])
      .toEqual(["1,01", ""]);
    expect(await settingsText(ui, "estimate-v3-discount-applied")).toContain("demandé 1,01 € / appliqué 1,01 €");

    // V3E-10 (S4) : « Aucun » ou « palier inférieur » seulement ; 100 € inférieur = remise HT, TVA pure.
    const roundingValues = await browser.evaluate(() => {
      const select = Array.from(document.querySelectorAll("select")).find(node => node.getAttribute("aria-label") === "Arrondi" ||
        Array.from(node.labels ?? []).some(label => (label.textContent ?? "").trim() === "Arrondi"));
      return select ? Array.from(select.options).map(option => option.value) : null;
    });
    expect(roundingValues).toEqual(["none", "100", "1000", "5000", "10000"]);
    await dialog.getByLabel("Arrondi", { exact: true }).selectOption({ value: "10000" });
    await clickSaveSettings(ui);
    const s4Version = { totals: S4.totals, gross: 6905456, applied: 101, commercialRounding: S4.rounding, roundingAdjustment: 0,
      rounding: ["down", 10000] as [string, number], discountAmountCents: 101, discountBp: 0 };
    await waitSettingsSaved(ui, army, "s4", draft.versionId, { version: s4Version });
    await checkpoint(ui, army, "s4", draft.versionId, {
      api: { version: s4Version },
      screen: { chips: chips(S4.totals, [["20", 1380000]], [discountChip(101), `Arrondi commercial : ${eur(-S4.rounding)}`]) },
    });
    dialog = await openSettings(ui, draft.versionId);
    await dialog.getByLabel("Arrondi", { exact: true }).selectOption({ value: "none" });
    await clickSaveSettings(ui);
    await waitSettingsSaved(ui, army, "s4-none", draft.versionId, { version: { ...s2Version, rounding: ["none", 1] } });

    // V3E-03 (S3 puis EUHIST) : 10 % remplace le montant → 1 000 pb exacts ; c_FO doublé, curseur passé par
    // le champ montant (vide pour une intention en taux) → toujours 10 %, remise appliquée = 10 % du nouveau brut.
    dialog = await openSettings(ui, draft.versionId);
    await fillCell(ui, "Remise (%)", "10");
    await clickSaveSettings(ui);
    const s3Version = { totals: S3.totals, gross: 6905456, applied: S3.applied, discountBp: 1000, discountAmountCents: null };
    await waitSettingsSaved(ui, army, "s3", draft.versionId, { version: s3Version });
    await checkpoint(ui, army, "s3", draft.versionId, {
      api: { version: s3Version }, screen: { chips: chips(S3.totals, [["20", 1242982]], [discountChip(S3.applied)]) },
    });
    dialog = await openSettings(ui, draft.versionId);
    expect([await inputValue(dialog.getByLabel("Remise (EUR HT)", { exact: true })), await inputValue(dialog.getByLabel("Remise (%)", { exact: true }))])
      .toEqual(["", "10"]);
    expect(await settingsText(ui, "estimate-v3-discount-applied")).toContain(`appliqué ${eur(S3.applied)}`);
    await fillCell(ui, "Coefficient de vente FO", "2,60");
    await dialog.getByLabel("Remise (EUR HT)", { exact: true }).focus();
    await browser.keyboard.press("Tab");
    await clickSaveSettings(ui);
    const cfoVersion = { saleCoefficients: [2.6, 1.2] as [number, number], totals: CFO_260.totals, gross: CFO_260.gross, applied: CFO_260.applied,
      discountBp: 1000, discountAmountCents: null };
    await waitSettingsSaved(ui, army, "cfo-260", draft.versionId, { version: cfoVersion });
    await checkpoint(ui, army, "cfo-260", draft.versionId, {
      api: { version: cfoVersion, lines: Object.fromEntries(placed.map(({ id }, index) => [id, { pu: PU_CFO_260[index] }])) },
      screen: { chips: chips(CFO_260.totals, [["20", 1992685]], [discountChip(CFO_260.applied)]),
        rows: [{ id: placed[0].id, title: placed[0].title, pu: puText(PU_CFO_260[0]), pt: eur(475360) }] },
    });
    dialog = await openSettings(ui, draft.versionId);
    expect(await inputValue(dialog.getByLabel("Remise (%)", { exact: true }))).toBe("10");
    await fillCell(ui, "Coefficient de vente FO", "1,30");
    await fillCell(ui, "Remise (EUR HT)", "1,01");
    await clickSaveSettings(ui);
    await waitSettingsSaved(ui, army, "back-to-s2", draft.versionId, { version: { ...s2Version, saleCoefficients: [1.3, 1.2] } });

    // V3E-05 : TVA par défaut 20 → 10 : dialogue ; « Non » garde les 7 lignes à 20 % (récapitulatif 20 %).
    const propagation = () => screen.getByRole("alertdialog", /^Appliquer ce taux à toutes les lignes\s?\?$/);
    const setDefaultVat = async (value: string, answer: "Oui" | "Non" | null) => {
      await openSettings(ui, draft.versionId);
      await fillCell(ui, "TVA par défaut des nouvelles lignes", value);
      await clickSaveSettings(ui);
      if (answer === null) return;
      await expect(propagation()).toBeVisible({ timeout: 30_000 });
      await propagation().getByRole("button", answer, { exact: true }).tap();
      await expect(propagation()).toBeHidden({ timeout: 30_000 });
    };
    const ratesOf = (rate: number) => Object.fromEntries(placed.map(({ id }) => [id, { taxRateBp: rate }]));
    await setDefaultVat("10", "Non");
    await waitSettingsSaved(ui, army, "vat-no", draft.versionId, { version: { taxRateBp: 1000, totals: S2.totals }, lines: ratesOf(2000) });
    await checkpoint(ui, army, "vat-no", draft.versionId, {
      api: { version: { taxRateBp: 1000, totals: S2.totals, taxByRate: [{ rateBp: 2000, baseCents: 6905355, taxCents: 1381071 }] }, lines: ratesOf(2000) },
      screen: { chips: chips(S2.totals, [["20", 1381071]]), forbiddenChipPrefixes: ["TVA 10 %"],
        rows: placed.map(({ id, title }) => ({ id, title, taxRate: "2000" })) },
    });
    // 10 → 20 : aucune ligne n'a un autre taux, donc aucun dialogue (contrat §9.4.4).
    await setDefaultVat("20", null);
    await waitSettingsSaved(ui, army, "vat-back-20", draft.versionId, { version: { taxRateBp: 2000, totals: S2.totals }, lines: ratesOf(2000) });
    const silentDialog = await propagation().isVisible();
    await recordEvidence(army, "v3e-vat-back-20-dialog", { visible: silentDialog });
    expect(silentDialog, "no propagation dialog when every line already has the new default").toBe(false);
    // 20 → 10, « Oui » : les 7 lignes passent à 10 % dans la même sauvegarde.
    await setDefaultVat("10", "Oui");
    await waitSettingsSaved(ui, army, "vat-yes", draft.versionId, { version: { taxRateBp: 1000, totals: S2_VAT10.totals }, lines: ratesOf(1000) });
    await checkpoint(ui, army, "vat-yes", draft.versionId, {
      api: { version: { taxRateBp: 1000, totals: S2_VAT10.totals, taxByRate: [{ rateBp: 1000, baseCents: 6905355, taxCents: 690536 }] }, lines: ratesOf(1000) },
      screen: { chips: chips(S2_VAT10.totals, [["10", 690536]]), forbiddenChipPrefixes: ["TVA 20 %"],
        rows: placed.map(({ id, title }) => ({ id, title, taxRate: "1000" })) },
    });

    // V3E-05 (S5) : O4–O7 remis à 20 % par la grille → deux taux au pied, TVA 13 255,25 €.
    await openGrid(ui, draft.versionId);
    for (const line of placed.slice(3)) {
      await screen.getByLabel(`Taux de TVA pour ${line.title}`, { exact: true }).selectOption({ value: "2000" });
    }
    await saveLineEditsWithShortcut(ui, draft.versionId, placed[6].title, army);
    await waitForAutoSave(ui, draft.versionId, (snapshot) => snapshot.version.total_tax_cents === S5.totals[1], army);
    await checkpoint(ui, army, "s5", draft.versionId, {
      api: {
        version: { totals: S5.totals, gross: 6905456, applied: 101, taxRateBp: 1000,
          taxByRate: [{ rateBp: 1000, baseCents: 555453, taxCents: 55545 }, { rateBp: 2000, baseCents: 6349902, taxCents: 1269980 }] },
        lines: Object.fromEntries(placed.map(({ id }, index) => [id, { taxRateBp: index < 3 ? 1000 : 2000, net: S2.nets[index] }])),
      },
      screen: { chips: chips(S5.totals, [["10", 55545], ["20", 1269980]], [discountChip(101)]), forbiddenChipPrefixes: [FORBIDDEN_V2_MARGIN],
        rows: placed.map(({ id, title }, index) => ({ id, title, taxRate: index < 3 ? "1000" : "2000" })) },
    });

    // Fiche et impression du brouillon v3 (§14 « 2.6 », périmètre) : plus de bandeau, totaux stockés.
    await app.open(`/dashboard/estimates/${draft.versionId}`);
    const readDetail = () => browser.evaluate((banner) => {
      const valueOf = (label: string) => {
        const term = Array.from(document.querySelectorAll("dt")).find(node => (node.textContent ?? "").trim() === label);
        return term?.nextElementSibling ? (term.nextElementSibling.textContent ?? "").replace(/[\s  ]+/g, " ").trim() : null;
      };
      return { banner: (document.body.textContent ?? "").includes(banner), ht: valueOf("Total HT"), ttc: valueOf("Total TTC") };
    }, BANNER);
    const expectedDetail = { banner: false, ht: eur(S5.totals[0]), ttc: eur(S5.totals[2]) };
    await expect.poll(readDetail, { timeout: 30_000 }).toEqual(expectedDetail);
    await app.open(`/dashboard/estimates/${draft.versionId}/print?price_mode=unit_and_total&detail_level=lines`);
    await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible({ timeout: 30_000 });
    const printBanner = await browser.evaluate((banner) => (document.body.textContent ?? "").includes(banner), BANNER);
    await recordEvidence(army, "v3e01-end", { versionId: draft.versionId, detail: await readDetail().catch(() => null), printBanner, nativeDialogs: dialogs });
    expect(printBanner).toBe(false);
  });

armyTest("V3E02 an out-of-scope line leaves the net total and comes back priced; a 500 € discount on a 400 € base shows requested and applied",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft = await prepareV3Draft(ui, army, "V3E02");
    // A : 4 u à 76,92 € (PU ⌈7 692 × 1,3⌋ = 100,00 €) ; B : 1 u, 200,00 € + 5 h × 40 € (PU 500,00 €).
    const [lineA, lineB] = await seedLines(ui, army, draft, "v3e02", [
      { line_nature: "supply_only", title: `${army.runPrefix} A`, description: "u", unit_code: "u", pricing_status: "priced", quantity: 4,
        unit_price_ht_cents: 7692, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: draft.tuyauteurId, source_provider: "manual" },
      { line_nature: "supply_and_labor", title: `${army.runPrefix} B`, description: "u", unit_code: "u", pricing_status: "priced", quantity: 1,
        unit_price_ht_cents: 20000, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 5, h_mo_majoration: 1, k_mo: 1, labor_role_id: draft.tuyauteurId, source_provider: "manual" },
    ]);
    expect([lineA.pu_ht_cents, lineA.line_total_ht_cents, lineB.pu_ht_cents, lineB.line_total_ht_cents]).toEqual([10000, 40000, 50000, 50000]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e02");
    const rowB = (status: string, pt?: string): RowExpectation => ({ id: lineB.id, title: lineB.title, status, ...(pt ? { pt } : {}) });
    const priced = { totals: [90000, 18000, 108000] as Totals };
    await checkpoint(ui, army, "tstat-initial", draft.versionId, {
      api: { version: { totals: priced.totals, gross: 90000 }, lines: { [lineB.id]: { status: "priced", net: 50000 } } },
      screen: { chips: chips(priced.totals, [["20", 18000]]), rows: [rowB("Chiffrée", eur(50000))] },
    });

    // V3E-06 (T-STAT) : B « Hors lot » → HT −500,00 €, ses saisies conservées ; retour à « Chiffrée » → restaurée.
    const setStatus = async (value: string) => {
      await screen.getByLabel(`Statut de chiffrage pour ${lineB.title}`, { exact: true }).selectOption({ value });
      await saveLineEditsWithShortcut(ui, draft.versionId, lineB.title, army);
      await waitForAutoSave(ui, draft.versionId, (snapshot) =>
        snapshot.items.find(item => item.id === lineB.id)?.pricing_status === value, army);
    };
    await setStatus("out_of_scope");
    const outOfScope = { totals: [40000, 8000, 48000] as Totals };
    await checkpoint(ui, army, "tstat-out", draft.versionId, {
      api: { version: { totals: outOfScope.totals, gross: 40000 },
        lines: { [lineB.id]: { status: "out_of_scope", net: 0, tax: 0, quantity: 1, prFo: 20000, hPerUnit: 5 } } },
      screen: { chips: chips(outOfScope.totals, [["20", 8000]]), rows: [rowB("Hors lot")] },
    });
    expect(priced.totals[0] - outOfScope.totals[0]).toBe(50000);
    await setStatus("priced");
    await checkpoint(ui, army, "tstat-back", draft.versionId, {
      api: { version: { totals: priced.totals, gross: 90000 },
        lines: { [lineB.id]: { status: "priced", net: 50000, quantity: 1, prFo: 20000, hPerUnit: 5, pu: 50000 } } },
      screen: { chips: chips(priced.totals, [["20", 18000]]), rows: [rowB("Chiffrée", eur(50000))] },
    });

    // V3E-04 (CAP) : B hors lot, assiette 400 € ; remise demandée 500 € → appliquée 400 €.
    await setStatus("out_of_scope");
    await openSettings(ui, draft.versionId);
    await fillCell(ui, "Remise (EUR HT)", "500");
    await clickSaveSettings(ui);
    const capVersion = { totals: [0, 0, 0] as Totals, gross: 40000, applied: 40000, discountAmountCents: 50000, discountBp: 0 };
    await waitSettingsSaved(ui, army, "cap", draft.versionId, { version: capVersion });
    await checkpoint(ui, army, "cap", draft.versionId, {
      api: { version: capVersion }, screen: { chips: chips([0, 0, 0], [["20", 0]], [discountChip(40000)]) },
    });
    await openSettings(ui, draft.versionId);
    const applied = await settingsText(ui, "estimate-v3-discount-applied");
    const amountField = await inputValue(settingsDialog(ui).getByLabel("Remise (EUR HT)", { exact: true }));
    // The requested amount stays the intention (never replaced by the applied one); its field format is free.
    await recordEvidence(army, "v3e-cap-text", { versionId: draft.versionId, applied, amountField, nativeDialogs: dialogs });
    expect(applied).toContain("demandé 500,00 € / appliqué 400,00 €");
  });

armyTest("V3E03 a catalogue suggestion keeps the v3 unit, and the supplier preselection either recomputes and persists or is refused by name",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft: V3Draft = await prepareV3Draft(ui, army, "V3E03");
    const [line] = await seedLines(ui, army, draft, "v3e03", [
      { line_nature: "supply_only", title: `${army.runPrefix} L`, description: "ml", unit_code: "ml", pricing_status: "priced", quantity: 2,
        unit_price_ht_cents: 1500, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual" },
    ]);
    expect([line.unit_code, line.pu_ht_cents, line.line_total_ht_cents]).toEqual(["ml", 1950, 3900]);
    // Article du catalogue en « ML » (alias de ml) et son offre A à 15,00 €, par les API du catalogue
    // (même chemin que bulk-edit-sync-sources) ; seules les deux lectures catalogue de cette affaire passent.
    army.ownedPriceLookupProjects = [draft.projectId];
    const designation = `${army.runPrefix} cuivre 22`;
    const created = async <T>(label: string, pathname: string, body: unknown) => {
      const response = await apiRequest<Envelope<{ item: T }>>(browser, "POST", pathname, body);
      await recordEvidence(army, `v3e-catalogue-${label}`, { pathname, body, response });
      expect([response.status, response.body.ok]).toEqual([201, true]);
      return response.body.data.item;
    };
    const product = await created<{ id: string }>("product", "/api/products", {
      action: "create", item: { designation, reference: `${army.runPrefix}-CU22`, unit: "ML", unit_price_cents: 1500 } });
    const supplierA = await created<{ id: string }>("supplier-a", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} fournisseur A`, is_active: true } });
    type Offer = { id: string; product_id: string; supplier_id: string; unit_price_cents: number };
    const offerFor = (label: string, supplierId: string, unit: string, cents: number) => created<Offer>(label, "/api/prices", {
      action: "create", item: { supplier_id: supplierId, product_id: product.id, supplier_sku: `${army.runPrefix}-${label}`, unit,
        min_quantity: 1, unit_price_cents: cents, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) } });
    const offerA = await offerFor("offer-a", supplierA.id, "ML", 1500);
    expect([offerA.product_id, offerA.unit_price_cents]).toEqual([product.id, 1500]);
    const productId = product.id;
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e03");

    // V3E-07 : la suggestion du catalogue lie l'article sans toucher à l'unité de la ligne.
    await browser.locator(`[data-estimate-item-id="${line.id}"] [data-testid="estimate-line-title-input"]`).fill(designation);
    await expect(screen.getByRole("listbox").first().getByText(designation, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await browser.keyboard.press("Enter");
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, army);
    await waitForAutoSave(ui, draft.versionId, (snapshot) => snapshot.items.find(item => item.id === line.id)?.product_id === productId, army);
    const linkedApi: ApiExpectation = {
      version: { totals: [3900, 780, 4680] },
      lines: { [line.id]: { title: designation, unit: "ml", productId, offerId: offerA.id, prFo: 1500, pu: 1950, net: 3900 } },
    };
    await checkpoint(ui, army, "suggestion", draft.versionId, {
      api: linkedApi,
      screen: { chips: chips([3900, 780, 4680], [["20", 780]]),
        rows: [{ id: line.id, title: designation, unit: "ml — mètre linéaire", pu: "19,50", pt: eur(3900) }] },
    });

    // V3E-11 : une offre B à 12,40 € ; appliquer la présélection recalcule et persiste (contrat F26-17), ou est
    // refusé par son nom avant toute écriture. La conception implique le refus (D16, P-14 : mise à jour groupée
    // directe refusée en v3 pendant le lot 2, message nommé) ; le message générique du moteur 3 est un échec.
    // Préalable corrigé au vert (doc 2.6 §8.4) : une seule offre et aucune offre retenue sur la ligne.
    await releaseOfferForPreselection(ui, army, draft, line.id, offerA.id);
    const supplierB = await created<{ id: string }>("supplier-b", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} fournisseur B`, is_active: true } });
    const offerB = await offerFor("offer-b", supplierB.id, "ml", 1240);
    expect([offerB.product_id, offerB.unit_price_cents]).toEqual([productId, 1240]);
    await openGrid(ui, draft.versionId);
    const before: ArmyEstimate = await readConsistent(ui, draft.versionId);
    await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).tap();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).tap();
    const preselect = screen.getByTestId("estimate-editor-supplier-preselection-button");
    await expect(preselect).toBeEnabled({ timeout: 30_000 });
    await preselect.tap();
    const panel = screen.getByRole("dialog", "Présélection fournisseurs", { exact: true });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const proposal = panel.getByLabel(`Sélectionner ${designation}`, { exact: true });
    const applyButton = panel.getByRole("button", "Appliquer la sélection", { exact: true });
    const panelText = async () => ((await panel.isVisible()) ? apostrophes(normalized(await panel.textContent())) : "");
    const refusalShown = async () => (await panelText()).includes(apostrophes(PRESELECTION_REFUSAL));
    await expect.poll(async () => (await proposal.isVisible()) || (await refusalShown()), { timeout: 30_000 }).toBe(true);
    const refusedBeforeApply = await refusalShown();
    const applyEnabled = async () => (await applyButton.count()) === 1 && await applyButton.isEnabled();
    const applyEnabledBeforeRefusal = await applyEnabled();
    if (!refusedBeforeApply) await applyButton.tap();

    const recomputedApi: ApiExpectation = {
      version: { totals: [3224, 645, 3869] },
      lines: { [line.id]: { unit: "ml", productId, offerId: offerB.id, prFo: 1240, pu: 1612, net: 3224 } },
    };
    const target = (expected: ApiExpectation) => JSON.stringify({ version: expected.version, lines: expected.lines ?? {} });
    const unchanged = (state: ArmyEstimate) => state.version.content_revision === before.version.content_revision &&
      JSON.stringify(apiProjection(state, linkedApi)) === target(linkedApi);
    const deadline = Date.now() + 60_000;
    let outcome: { refused: boolean; recomputed: boolean; text: string; state: ArmyEstimate };
    do {
      await pause(1_000);
      const state = await readConsistent(ui, draft.versionId);
      const text = await panelText();
      outcome = {
        refused: text.includes(apostrophes(PRESELECTION_REFUSAL)) && unchanged(state),
        recomputed: JSON.stringify(apiProjection(state, recomputedApi)) === target(recomputedApi),
        text, state,
      };
    } while (!outcome.refused && !outcome.recomputed && Date.now() < deadline);
    const applyDisabledOnRefusal = outcome.refused ? !(await applyEnabled()) : null;
    await recordEvidence(army, "v3e-preselection", {
      versionId: draft.versionId, designImplies: "refused (D16, P-14)", contractChoice: "recomputed (F26-17), named refusal as fallback",
      refusedBeforeApply, applyEnabledBeforeRefusal, applyDisabledOnRefusal,
      outcome: { refused: outcome.refused, recomputed: outcome.recomputed, genericBanner: outcome.text.includes(apostrophes(BANNER)) },
      panelText: outcome.text, before: apiProjection(before, linkedApi), after: apiProjection(outcome.state, recomputedApi),
      revisions: [before.version.content_revision, outcome.state.version.content_revision], nativeDialogs: dialogs,
    });
    // Exactement une des deux issues ; des lignes écrites avec des totaux périmés (défaut v2 connu, 2.2) ou le
    // bandeau générique du moteur 3 n'en sont pas.
    expect([outcome.refused, outcome.recomputed].filter(Boolean)).toHaveLength(1);
    if (outcome.refused) expect(applyDisabledOnRefusal, "the refused preselection cannot be applied").toBe(true);
    const settled = outcome.recomputed
      ? { api: recomputedApi, chips: chips([3224, 645, 3869], [["20", 645]]), pu: "16,12", pt: eur(3224) }
      : { api: linkedApi, chips: chips([3900, 780, 4680], [["20", 780]]), pu: "19,50", pt: eur(3900) };
    await openGrid(ui, draft.versionId);
    await checkpoint(ui, army, outcome.recomputed ? "preselection-recomputed" : "preselection-refused", draft.versionId, {
      api: settled.api,
      screen: { chips: settled.chips, rows: [{ id: line.id, title: designation, unit: "ml — mètre linéaire", pu: settled.pu, pt: settled.pt }] },
    });
    // The known v2 defect (lines written, stored totals stale) shows « Totaux à synchroniser ».
    expect(normalized(await browser.evaluate(() => document.body.innerText))).not.toContain("Totaux à synchroniser");
  });

armyTest("V3E04 the per-line supplier comparison of a v3 line reads its unit_code: an offer in another unit is refused, a retained offer keeps unit_code and description",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const dialogs = await recordDialogs(ui);
    const draft: V3Draft = await prepareV3Draft(ui, army, "V3E04");
    // A v3 line as the grid makes it: its unit in unit_code (D9), nothing in description (F26-10).
    const designation = `${army.runPrefix} cuivre 18`;
    const [line] = await seedLines(ui, army, draft, "v3e04", [
      { line_nature: "supply_only", title: designation, unit_code: "ml", pricing_status: "priced", quantity: 2,
        unit_price_ht_cents: 1500, tax_rate_bp: 2000, k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual" },
    ]);
    expect([line.unit_code, line.description ?? null, line.pu_ht_cents, line.line_total_ht_cents]).toEqual(["ml", null, 1950, 3900]);
    // Catalogue by its API (same path as V3E03): one offer in the line unit, one in another unit, no conversion.
    army.ownedPriceLookupProjects = [draft.projectId];
    const created = async <T>(label: string, pathname: string, body: unknown) => {
      const response = await apiRequest<Envelope<{ item: T }>>(browser, "POST", pathname, body);
      await recordEvidence(army, `v3e04-catalogue-${label}`, { pathname, body, response });
      expect([response.status, response.body.ok]).toEqual([201, true]);
      return response.body.data.item;
    };
    const product = await created<{ id: string }>("product", "/api/products", {
      action: "create", item: { designation, reference: `${army.runPrefix}-CU18`, unit: "ML", unit_price_cents: 1500 } });
    type Offer = { id: string; product_id: string; supplier_id: string; unit_price_cents: number };
    const supplierMl = `${army.runPrefix} fournisseur ml`;
    const supplierBar = `${army.runPrefix} fournisseur barre`;
    const offerFrom = async (label: string, supplierName: string, unit: string, cents: number) => {
      const supplier = await created<{ id: string }>(`supplier-${label}`, "/api/suppliers", {
        action: "create", item: { name: supplierName, is_active: true } });
      return created<Offer>(`offer-${label}`, "/api/prices", {
        action: "create", item: { supplier_id: supplier.id, product_id: product.id, supplier_sku: `${army.runPrefix}-${label}`, unit,
          min_quantity: 1, unit_price_cents: cents, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) } });
    };
    const offerMl = await offerFrom("ml", supplierMl, "ml", 1240);
    const offerBar = await offerFrom("bar", supplierBar, "barre", 5000);
    expect([offerMl.unit_price_cents, offerBar.unit_price_cents]).toEqual([1240, 5000]);
    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "v3e04");

    // V3E-12 : la comparaison de la ligne juge chaque offre dans l'unité de la ligne v3 (unit_code), jamais
    // dans description, vide : une offre à la barre est refusée (« Unité différente du devis »).
    await screen.getByRole("button", `Plus d'actions pour ${designation}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Comparer les fournisseurs", { exact: true }).tap();
    const panel = screen.getByRole("dialog", "Comparer fournisseurs", { exact: true });
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const card = (supplierName: string) => browser.locator("[role=\"dialog\"] article").filter({ hasText: supplierName });
    const retain = (supplierName: string) =>
      card(supplierName).getByRole("button", /^(Retenir cette offre|Actualiser cette offre|Offre retenue)$/);
    await expect.poll(async () => (await card(supplierMl).count()) + (await card(supplierBar).count()), { timeout: 30_000 }).toBe(2);
    const offerView = async (supplierName: string) => ({
      unitRefused: normalized(await card(supplierName).textContent()).includes("Unité différente du devis"),
      retainEnabled: await retain(supplierName).isEnabled(),
    });
    const offers = { ml: await offerView(supplierMl), bar: await offerView(supplierBar) };

    // Retenir l'offre en ml : seuls le PR FO et l'offre changent ; unit_code reste ml, description reste vide.
    await retain(supplierMl).tap();
    await expect(panel).toBeHidden({ timeout: 30_000 });
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, army);
    const saved = await waitForAutoSave(ui, draft.versionId,
      (snapshot) => snapshot.items.find(item => item.id === line.id)?.selected_supplier_price_id === offerMl.id, army);
    const savedLine = saved.items.find(item => item.id === line.id)!;
    const review = {
      offers,
      persisted: { unitCode: savedLine.unit_code ?? null, description: savedLine.description ?? null,
        prFo: Number(savedLine.unit_price_ht_cents), offerId: savedLine.selected_supplier_price_id ?? null },
    };
    const expected = {
      offers: { ml: { unitRefused: false, retainEnabled: true }, bar: { unitRefused: true, retainEnabled: false } },
      persisted: { unitCode: "ml", description: null, prFo: 1240, offerId: offerMl.id },
    };
    await recordEvidence(army, "v3e04-supplier-comparison", {
      versionId: draft.versionId, lineId: line.id, offerMlId: offerMl.id, offerBarId: offerBar.id, expected, actual: review, nativeDialogs: dialogs,
    });
    expect(review, "the v3 line unit is unit_code for the supplier comparison and is never written to description").toEqual(expected);
    await checkpoint(ui, army, "v3e04-retained", draft.versionId, {
      api: { version: { totals: [3224, 645, 3869] }, lines: { [line.id]: { unit: "ml", offerId: offerMl.id, prFo: 1240, pu: 1612, net: 3224 } } },
      screen: { chips: chips([3224, 645, 3869], [["20", 645]]),
        rows: [{ id: line.id, title: designation, unit: "ml — mètre linéaire", pu: "16,12", pt: eur(3224) }] },
    });
  });
