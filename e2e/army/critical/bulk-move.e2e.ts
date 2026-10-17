import { expect } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, type ArmyItem,
} from "./fixtures";

type Envelope<T> = { ok: boolean; data: T };

// Failure plan (M1–M4): docs/testing/bulk-move-placement.md.
armyTest(
  "bulk move persists the new section and position, its undo and its redo",
  { session: "army", tags: ["critical", "bulk-move"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    await browser.emulateMedia({ reducedMotion: "reduce" });
    const ui = { app, screen, browser };
    const title = `${army.runPrefix} déplacée`;
    const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title }, army);
    // Still on the editor page: the API calls below share its draft-lock session.
    const moved = await createLineViaApi(browser, ids.versionId, title, { unit_price_ht_cents: 1234 });
    const source = (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === moved.parent_id)!;
    expect(source.item_type).toBe("section");
    const created = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
      item_type: "section", parent_id: source.parent_id, title: `${army.runPrefix} section cible`,
    });
    expect(created.status).toBe(201);
    const target = created.body.data.item;
    const existingTitle = `${army.runPrefix} déjà dans la cible`;
    const existing = await createLineViaApi(browser, ids.versionId, existingTitle, { parent_id: target.id });
    expect(existing.parent_id).toBe(target.id);

    const placement = async () => {
      const item = (await readEstimate(browser, ids.versionId)).items.find((candidate) => candidate.id === moved.id);
      return { parent_id: item?.parent_id ?? null, position: item?.position ?? null };
    };
    const atSource = { parent_id: source.id, position: moved.position };
    const atTarget = { parent_id: target.id, position: existing.position + 1 };
    const observed: Array<{ step: string; expected: unknown; actual: unknown }> = [];
    const expectPlacement = async (step: string, expected: typeof atSource) => {
      try {
        await expect.poll(placement, { timeout: 30_000, interval: 500 }).toEqual(expected);
      } finally {
        observed.push({ step, expected, actual: await placement() });
        await recordEvidence(army, "bulk-move-placements", {
          versionId: ids.versionId, movedId: moved.id, existingId: existing.id,
          sourceSectionId: source.id, targetSectionId: target.id, observed,
        });
      }
    };
    const lineTitlesInGridOrder = () => browser.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLInputElement>('[data-testid="estimate-line-title-input"]'))
        .map((input) => input.value));

    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    expect(await placement()).toEqual(atSource);
    expect(await lineTitlesInGridOrder()).toEqual([title, existingTitle]);

    const select = screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true });
    await select.check();
    await expect(screen.getByTestId("estimate-editor-bulk-selection-bar")).toBeVisible();
    await screen.getByLabel("Déplacer les lignes sélectionnées vers", { exact: true }).selectOption({ value: target.id });
    await screen.getByTestId("estimate-editor-bulk-move-apply-button").click();
    await expectPlacement("moved", atTarget);
    await select.uncheck();

    const undo = screen.getByTestId("estimate-editor-undo-button", { visible: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expectPlacement("undone", atSource);
    const redo = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    await expect(redo).toBeEnabled();
    await redo.click();
    await expectPlacement("redone", atTarget);

    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await expectPlacement("reloaded", atTarget);
    expect(await lineTitlesInGridOrder()).toEqual([existingTitle, title]);
    const after = (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === moved.id)!;
    expect([after.quantity, after.unit_price_ht_cents, after.line_total_ht_cents])
      .toEqual([moved.quantity, moved.unit_price_ht_cents, moved.line_total_ht_cents]);
  },
);
