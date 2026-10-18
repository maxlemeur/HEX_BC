import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem, type ArmyState } from "../critical/fixtures";
import { basisLaborRole, expectStoredTotals, expectStoredTotalsMatchLines, type StoredTotals } from "../critical/version-totals-support";
import { ownedEstimateContext } from "./calculation-gate-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { assertOwnedLocalBackend, createdData, insertLegacyV1Draft, type Envelope } from "./legacy-v1-draft-support";

// Stored version totals after the bulk actions on a legacy V1 draft
// (docs/testing/version-totals-after-bulk-actions.md, BT6, BT8 and BT9). The critical bulk-edit-sync
// journeys are the V2 guards; the V1 path is only reachable on a draft seeded in SQL
// (legacy-v1-draft-support). The journeys work in Expert mode. The UI mode is stored on the account's
// profile and suggestion rules are tenant-wide, so each journey runs as its own disposable owner, born
// in Expert mode, with its own tenant, labour role and rule (dedicated-owner.ts): the critical
// selection runs them at two workers without touching the shared campaign account
// (docs/testing/tester-army-ci.md, « Parcours V1 des totaux dans la sélection des PR »).
const options = { session: "army", tags: ["critical", "local", "version-totals"], timeout: 240_000 } as const;
type Ui = Parameters<typeof expectStoredTotalsMatchLines>[0];
type SeededLine = Awaited<ReturnType<typeof seedLegacyV1Line>>;
// V1 engine values (calc_engine_version 1). Fixed margin x1, 20 % VAT, no discount, no rounding:
// 2 u at 10,00 € plus 1 h at the owned 40 €/h role (seeded, consistent), 20,00 € + 40,00 €.
const SEEDED: StoredTotals = [6000, 1200, 7200];
// The hour at 150 %: 20,00 € + 60,00 € = 80,00 € HT.
const EXPECTED: StoredTotals = [8000, 1600, 9600];
// Then the margin x1,2 saved: 80,00 € × 1,2 = 96,00 € HT.
const MAJORATION_AT_MARGIN_1_2: StoredTotals = [9600, 1920, 11520];
// K FO 1,3 from the suggestion rule: 26,00 € + 40,00 € = 66,00 € HT; then × 1,2 = 79,20 € HT.
const K_FO_1_3: StoredTotals = [6600, 1320, 7920];
const K_FO_1_3_AT_MARGIN_1_2: StoredTotals = [7920, 1584, 9504];
// The tab label carries the count of quality alerts, if any.
const DISPLAY_TAB = /^Affichage & contrôle(?: \d+)?$/;

// The dedicated tenant only has the default labour roles, at 0 €/h: its 40 €/h basis is created
// through the API under the anchor's draft lease, which is then handed back.
async function createBasisLaborRole(browser: Ui["browser"], anchorVersionId: string) {
  await createdData(await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${anchorVersionId}/lock`));
  await createdData(await apiRequest<Envelope<{ labor_role: { id: string } }>>(
    browser, "POST", `/api/estimates/${anchorVersionId}/labor-roles`, { name: "ARMY V1 basis", hourly_rate_cents: 4000 }));
  await createdData(await apiRequest<Envelope<unknown>>(browser, "DELETE", `/api/estimates/${anchorVersionId}/lock`));
}

// A dedicated owner (tag: the journey id), then an owned project made by the ordinary creation path
// (its V2 draft stays version 1), then the legacy V1 draft inserted as its version 2.
async function seedLegacyV1Line(ui: Ui, army: ArmyState, label: string, tag: string) {
  const { browser } = ui;
  assertOwnedLocalBackend();
  const dedicated = await signUpDedicatedOwner(browser, ui.app.baseUrl!, army.runPrefix, { tag, uiMode: "expert" });
  await ui.app.open("/dashboard/affaires");
  const created = await createdData(await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(
    browser, "POST", "/api/estimates", {
      project: { name: army.projectName },
      version: {
        title: `${army.runPrefix} v2 anchor`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
        rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
      },
    }));
  const projectId = created.project.id;
  ownEstimate(army, { projectId, versionId: created.version.id });
  const owner = await ownedEstimateContext(projectId);
  // The estimate belongs to the dedicated owner and tenant, not to the shared account.
  expect({ tenantId: owner.tenantId, userId: owner.userId }).toEqual({ tenantId: dedicated.tenantId, userId: dedicated.userId });
  await createBasisLaborRole(browser, created.version.id);
  const role = await basisLaborRole(browser, created.version.id);

  const title = `${army.runPrefix} ${label}`;
  const draft = await insertLegacyV1Draft({ projectId, tenantId: owner.tenantId, userId: owner.userId }, {
    title, description: null, productId: null, lineNature: "supply_and_labor",
    quantity: 2, unitPriceCents: 1000, hMo: 1, laborRoleId: role.id, puHtCents: 3000,
  }, SEEDED);
  const estimate = { projectId, versionId: draft.versionId };
  ownEstimate(army, estimate);
  return { created, dedicated, role, title, draft, estimate };
}

// Asserted once seeded, before the editor opens.
async function expectSeededLine({ browser }: Ui, army: ArmyState, seeded: SeededLine, step: string) {
  const { created, dedicated, role, draft } = seeded;
  const lineOf = (items: ArmyItem[]) => items.find((item) => item.id === draft.lineId);
  const before = await readEstimate(browser, draft.versionId);
  await recordEvidence(army, step, {
    ...draft, anchorVersionId: created.version.id, laborRole: role, insertedBy: "postgres (owned native stack)",
    owner: { tenantId: dedicated.tenantId, userId: dedicated.userId, storedMode: dedicated.uiMode },
    quantity: 2, unitPriceCents: 1000, hMo: 1, seeded: SEEDED,
    before: {
      engine: before.version.calc_engine_version ?? null, versionNumber: before.version.version_number ?? null,
      totals: [before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents],
      line: lineOf(before.items) ?? null,
    },
  });
  expect(before.version.calc_engine_version, "legacy V1 draft").toBe(1);
  expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual(SEEDED);
  expect(lineOf(before.items)).toMatchObject({
    h_mo: 1, h_mo_majoration: 1, k_fo: 1, labor_role_id: role.id, line_total_ht_cents: SEEDED[0],
  });
  return lineOf;
}

// The grid renders before the editor holds its draft lease. Until then the editor is read-only
// and its sync status reads « Connexion… » (« Verrouillé » while an unloaded page still holds
// it); the user can write only once it reads « À jour ». The API writes of these journeys share
// that lease (apiRequest sends the page's lock session), so they wait for the same state.
async function openEditor({ app, screen }: Ui, versionId: string) {
  await app.open(`/dashboard/estimates/${versionId}/edit`);
  await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await expect(screen.getByTestId("estimate-page-toolbar-autosave-status"))
    .toHaveText(/^(À jour|Sauvegardé)$/, { timeout: 30_000 });
}

// The bulk bar of the selected line, as in bulk-edit-sync (D1).
async function bulkMajoration({ screen }: Ui, title: string, persisted: () => Promise<unknown>) {
  const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
  await select.check();
  const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
  await expect(bulkBar).toBeVisible();
  await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
  await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
  await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
  // The bulk write is committed once the line is read back; the totals are then read once,
  // without waiting for any later save.
  await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(1.5);
  await select.uncheck();
  await expect(bulkBar).toBeHidden();
}

async function history({ screen }: Ui, action: "Annuler" | "Rétablir", persisted: () => Promise<unknown>, expected: unknown) {
  const button = screen.getByTestId(
    action === "Annuler" ? "estimate-editor-undo-button" : "estimate-editor-redo-button", { visible: true },
  );
  await expect(button).toBeEnabled();
  await button.click();
  await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(expected);
}

// The suggestions of the display menu, as in bulk-edit-sync-sources (S1).
async function applySuggestions({ screen }: Ui, persisted: () => Promise<unknown>) {
  await screen.getByRole("tab", DISPLAY_TAB).click();
  await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
  const review = screen.getByTestId("estimate-editor-bulk-suggestions-button");
  await expect(review).toHaveText("Examiner 1 suggestion");
  await review.click();
  const dialog = screen.getByRole("dialog", "Application en masse des suggestions", { exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", "Appliquer", { exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await expect.poll(persisted, { timeout: 30_000, interval: 500 }).toBe(1.3);
  await screen.getByRole("tab", "Chiffrage", { exact: true }).click();
}

// The margin x1,2 through the settings dialog of the mounted editor, opened from the summary bar
// (as connected-support): a navigation would remount the editor and drop the undo state that the
// step judges.
async function saveMargin1_2({ screen, browser }: Ui, versionId: string) {
  await screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
  const dialog = screen.getByRole("dialog", "Paramétrage du devis", { exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", /^1\.20 \(marge de 20 %\)$/).click();
  const save = dialog.getByRole("button", "Enregistrer le paramétrage", { exact: true });
  await save.click();
  await expect.poll(async () => (await readEstimate(browser, versionId)).version.margin_multiplier,
    { timeout: 30_000, interval: 500 }).toBe(1.2);
  // The API sees the commit before the editor receives it: the button label only comes back with
  // the acknowledgement ("Enregistrement…" meanwhile).
  await expect(save).toBeEnabled({ timeout: 30_000 });
  await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
  await screen.getByTestId("estimate-editor-drawer-close-button").click();
  await expect(dialog).toBeHidden();
  await screen.getByRole("tab", "Chiffrage", { exact: true }).click();
}

armyTest("V1BT01 a bulk majoration on a legacy V1 draft stores the version totals with its lines", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const seeded = await seedLegacyV1Line(ui, army, "V1 bulk", "V1BT01");
    const { title, draft, estimate } = seeded;
    const lineOf = await expectSeededLine(ui, army, seeded, "v1-bulk-fixtures");

    await openEditor(ui, draft.versionId);
    const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
    await select.check();
    const bulkBar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    await expect(bulkBar).toBeVisible();
    await bulkBar.getByText("Modifier les attributs", { exact: true }).click();
    await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
    await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
    // The bulk write is committed once the line is read back at 150 %; the totals are then read
    // once, without waiting for any later save.
    await expect.poll(async () => lineOf((await readEstimate(browser, draft.versionId)).items)?.h_mo_majoration,
      { timeout: 30_000, interval: 500 }).toBe(1.5);
    await expectStoredTotalsMatchLines(ui, army, {
      estimate, projectName: army.projectName, step: "v1-bulk-majoration", expected: EXPECTED,
    });
  });

armyTest("V1BT02 a margin save on a legacy V1 draft closes the undo of a bulk majoration stored with its totals", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const seeded = await seedLegacyV1Line(ui, army, "V1 history", "V1BT02");
    const { title, draft, estimate } = seeded;
    const lineOf = await expectSeededLine(ui, army, seeded, "v1-history-fixtures");
    const majoration = async () => lineOf((await readEstimate(browser, draft.versionId)).items)?.h_mo_majoration;

    await openEditor(ui, draft.versionId);
    await screen.getByRole("tab", "Chiffrage", { exact: true }).click();
    await bulkMajoration(ui, title, majoration);
    await expectStoredTotals(browser, army, { estimate, step: "v1-history-majoration", expected: EXPECTED });
    // BT8: on a V1 draft the server stores the totals the editor sends; the undo and the redo
    // send their own.
    await history(ui, "Annuler", majoration, 1);
    await expectStoredTotals(browser, army, { estimate, step: "v1-history-undo", expected: SEEDED });
    await history(ui, "Rétablir", majoration, 1.5);
    await expectStoredTotals(browser, army, { estimate, step: "v1-history-redo", expected: EXPECTED });

    // BT9: the margin save reprices the line and the version on the server.
    await saveMargin1_2(ui, draft.versionId);
    await expectStoredTotals(browser, army, { estimate, step: "v1-history-margin-saved", expected: MAJORATION_AT_MARGIN_1_2 });
    // The history captured before the save holds the line and the totals calculation of the
    // previous margin. An undo still offered here writes them back: it is run, so that the step
    // fails on its stored values, the evidence of the defect.
    const undo = screen.getByTestId("estimate-editor-undo-button", { visible: true });
    if (await undo.isEnabled()) {
      await undo.click();
      await expect(screen.getByTestId("estimate-editor-redo-button", { visible: true })).toBeEnabled({ timeout: 30_000 });
    }
    await expectStoredTotals(browser, army, { estimate, step: "v1-history-after-margin", expected: MAJORATION_AT_MARGIN_1_2 });
    // The margin save closes the history priced before it.
    await expect(undo).toBeDisabled();
    await expectStoredTotalsMatchLines(ui, army, {
      estimate, projectName: army.projectName, step: "v1-history-final", expected: MAJORATION_AT_MARGIN_1_2,
    });
  });

armyTest("V1BT03 suggestions on a legacy V1 draft store their totals and a margin save closes their undo", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const seeded = await seedLegacyV1Line(ui, army, "V1 suggestions", "V1BT03");
    const { title, draft, estimate } = seeded;
    const lineOf = await expectSeededLine(ui, army, seeded, "v1-suggestions-fixtures");
    const kFo = async () => lineOf((await readEstimate(browser, draft.versionId)).items)?.k_fo;

    // Rule writes require the editor's draft lease: the rule is created once the open editor holds
    // it (openEditor). It is born in the dedicated tenant, which no other journey reads, and the
    // exact title as keyword targets this line.
    await openEditor(ui, draft.versionId);
    const created = await createdData(await apiRequest<Envelope<Record<string, { id: string }>>>(
      browser, "POST", `/api/estimates/${draft.versionId}/suggestion-rules`,
      { name: `${army.runPrefix} V1 K FO`, match_value: title, k_fo: 1.3, is_active: true },
    ));
    const rule = created.suggestion_rule ?? created.suggestionRule ?? created.rule ?? (created as unknown as { id: string });
    expect(rule.id).toMatch(/^[0-9a-f-]{36}$/i);
    await recordEvidence(army, "v1-suggestions-rule", {
      versionId: draft.versionId, lineId: draft.lineId, ruleId: rule.id, keyword: title, kFo: 1.3,
    });
    await openEditor(ui, draft.versionId);

    // BT8: the apply and the undo of the suggestions send their totals.
    await applySuggestions(ui, kFo);
    await expectStoredTotals(browser, army, { estimate, step: "v1-suggestions-apply", expected: K_FO_1_3 });
    const undoSuggestions = screen.getByTestId("estimate-editor-alert-undo-bulk-suggest-button");
    await undoSuggestions.click();
    await expect.poll(kFo, { timeout: 30_000, interval: 500 }).toBe(1);
    await expectStoredTotals(browser, army, { estimate, step: "v1-suggestions-undo", expected: SEEDED });
    await applySuggestions(ui, kFo);
    await expectStoredTotals(browser, army, { estimate, step: "v1-suggestions-reapply", expected: K_FO_1_3 });

    // BT9: the margin save reprices the line and the version on the server.
    await saveMargin1_2(ui, draft.versionId);
    await expectStoredTotals(browser, army, { estimate, step: "v1-suggestions-margin-saved", expected: K_FO_1_3_AT_MARGIN_1_2 });
    // The undo of the suggestions holds the line priced at the previous margin. Still offered
    // here, it is run, so that the step fails on its stored values.
    const applied = screen.getByTestId("estimate-editor-alert-bulk-suggest-applied");
    if (await undoSuggestions.isVisible() && await undoSuggestions.isEnabled()) {
      await undoSuggestions.click();
      await expect(applied).toBeHidden({ timeout: 30_000 });
    }
    await expectStoredTotals(browser, army, { estimate, step: "v1-suggestions-after-margin", expected: K_FO_1_3_AT_MARGIN_1_2 });
    // The margin save closes the undo of the suggestions.
    await expect(applied).toBeHidden();
    await expectStoredTotalsMatchLines(ui, army, {
      estimate, projectName: army.projectName, step: "v1-suggestions-final", expected: K_FO_1_3_AT_MARGIN_1_2,
    });
  });
