import { recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import {
  acceptElsewhere, countOwnedReviewEvents, readOwnedAnswers, readOwnedDecisions, readOwnedEntries, readOwnedRows, seedPublishedItemTable,
  type SeededAnswer,
} from "./item-table-support";
import { describe, expect, nativeTest as test } from "./native-ui";

// Lot 4, the table of items and its bulk gestures (migration …_takeoff_item_review_decisions.sql), on the owned stack:
// an affaire whose plan was read against its list of 30 items and published (item-table-support.ts). A member selects
// lines across two pages, accepts the measured items without anomaly, meets a stale selection that applies nothing,
// sets four items aside with one reason and enters two absences with their own values and one category. Fictional values.

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 240_000 };
const label = (index: number) => `Appareil ${String(index + 1).padStart(2, "0")}`;
// Appareils 01 to 20 and 27 to 30 measured; 21 measured as an hypothesis; 22 uncertain; 23 to 26 not found.
const ANSWERS: SeededAnswer[] = Array.from({ length: 30 }, (_, index) => index === 20 ? "hypothesis" : index === 21 ? "uncertain"
  : index >= 22 && index <= 25 ? "not_found" : "measured");

describe("Tableau des postes", () => {
  test("POSTE-REVUE01 accepte, écarte et complète une sélection sur deux pages ; une sélection périmée n’applique rien", options,
    async ({ ui }) => {
      const { app, screen, army } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PREVUE" });
      const seeded = await seedPublishedItemTable(owner, { name: `${army.runPrefix}-POSTE-REVUE`,
        labels: ANSWERS.map((_, index) => label(index)), answers: ANSWERS });
      const item = (index: number) => seeded.itemIds[index];
      const tick = (index: number) => screen.getByRole("checkbox", `Sélectionner le poste « ${label(index)} »`, { exact: true }).check();
      const row = (index: number) => ui.locator(`[data-testid="poste-${item(index)}"]`);
      const count = ui.locator('[data-testid="poste-selection-count"]');
      const notice = ui.locator('[data-testid="poste-notice"]');

      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?posteLimit=25`);
      await waitForHydration(ui.browser);
      const table = screen.getByRole("table", "Postes du métré", { exact: true });
      await expect(table).toBeVisible();
      await expect(row(20)).toContainText("Hypothèse");
      await expect(row(21)).toContainText("Incertain");
      await expect(row(22)).toContainText("Non trouvé");
      await expect(row(22)).toContainText("—");

      // A selection across two pages: three items that are not accepted in bulk and two measured ones.
      for (const index of [19, 20, 21, 22]) await tick(index);
      await screen.getByRole("button", "Page suivante", { exact: true }).click();
      await expect(row(26)).toBeVisible();
      await tick(26);
      await expect(count).toContainText("5 postes sélectionnés");
      await screen.getByRole("button", "Accepter les mesurés sans anomalie (2)", { exact: true }).click();
      await expect(screen.getByRole("dialog")).toContainText("2 postes acceptés sur 5 postes sélectionnés");
      await screen.getByRole("button", "Accepter 2 postes", { exact: true }).click();
      await expect(notice).toContainText("2 postes acceptés. Laissés : Appareil 21 (à vérifier ligne à ligne)");
      const accepted = await readOwnedDecisions(seeded.projectId);
      expect(accepted.map(({ item_id, kind, actor_id }) => [item_id, kind, actor_id]).sort())
        .toEqual([[item(19), "accepted", owner.userId], [item(26), "accepted", owner.userId]].sort());
      // Their positive rows are verified in the member's name; the hypothesis, the uncertain and the absent are left.
      const rows = new Map((await readOwnedRows(seeded.jobId)).map((value) => [value.id, value]));
      expect([19, 26].map((index) => rows.get(seeded.rowIds[index]!))).toEqual([19, 26].map((index) => expect.objectContaining({
        id: seeded.rowIds[index], is_verified: true, verified_by: owner.userId })));
      expect(rows.get(seeded.rowIds[20]!)).toMatchObject({ is_verified: false });

      // The selection left stays for the tab after a reload, on the page the address keeps.
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(count).toContainText("3 postes sélectionnés");
      await expect(row(26)).toBeVisible();
      await screen.getByRole("button", "Vider la sélection", { exact: true }).click();

      // A stale selection: another tab accepts one of its items meanwhile; nothing of the selection is applied. (Before
      // the set aside below: the rules of a plan's rows then wait for the server, which cannot read the fictional plan.)
      // The decisions still to take come first: these items are on the first page.
      await screen.getByRole("button", "Page précédente", { exact: true }).click();
      await expect(row(0)).toBeVisible();
      for (const index of [2, 3]) await tick(index);
      await acceptElsewhere(owner, seeded.projectId, item(3));
      await screen.getByRole("button", "Accepter les mesurés sans anomalie (2)", { exact: true }).click();
      await screen.getByRole("button", "Accepter 2 postes", { exact: true }).click();
      await expect(notice).toContainText(`Rien n’a été appliqué : ${label(3)} a changé depuis la sélection.`);
      const afterStale = await readOwnedDecisions(seeded.projectId);
      expect(afterStale.find(({ item_id }) => item_id === item(2))).toBeUndefined();
      expect(afterStale.find(({ item_id }) => item_id === item(3))).toMatchObject({ kind: "accepted" });
      await screen.getByRole("button", "Vider la sélection", { exact: true }).click();

      // Four items set aside with one reason chosen once, two without any positive row, confirmed by Enter.
      for (const index of [0, 1, 22, 23]) await tick(index);
      await screen.getByRole("button", "Écarter la sélection (4)", { exact: true }).click();
      const setAside = screen.getByRole("dialog");
      await setAside.getByRole("radio", "Doublon", { exact: true }).check();
      await setAside.getByRole("radio", "Doublon", { exact: true }).press("Enter");
      await expect(notice).toContainText("4 postes écartés.");
      const decided = await readOwnedDecisions(seeded.projectId);
      expect(decided.filter(({ kind }) => kind === "set_aside").map(({ item_id, reason }) => [item_id, reason]).sort())
        .toEqual([0, 1, 22, 23].map((index) => [item(index), "duplicate"]).sort());
      const excluded = new Map((await readOwnedRows(seeded.jobId)).map((value) => [value.id, value]));
      for (const index of [0, 1]) {
        expect(excluded.get(seeded.rowIds[index]!)).toMatchObject({ is_excluded: true,
          exclusion_reason: "Écarté dans le tableau des postes : doublon" });
      }
      // Each effect journaled: the two acceptances and the other tab's (a decision and a row each), then four decisions
      // and two rows.
      expect(await countOwnedReviewEvents(seeded.projectId)).toBe(2 * 2 + 2 + 4 + 2);

      // Two absences entered, each with its own value, under one category; the model's raw answers stay as read.
      await screen.getByRole("textbox", `Quantité saisie pour « ${label(24)} »`, { exact: true }).fill("2");
      await screen.getByRole("textbox", `Quantité saisie pour « ${label(25)} »`, { exact: true }).fill("3");
      await screen.getByRole("button", "Enregistrer les saisies (2)", { exact: true }).click();
      const entry = screen.getByRole("dialog");
      await entry.getByRole("combobox", "Ce qui fonde ces quantités", { exact: true }).selectOption({ value: "hypothesis" });
      await entry.getByRole("textbox", "Ce qui est supposé (obligatoire)", { exact: true }).fill("court");
      await expect(entry.getByRole("button", "Enregistrer", { exact: true })).toBeDisabled();
      await entry.getByRole("combobox", "Ce qui fonde ces quantités", { exact: true }).selectOption({ value: "site_survey" });
      await entry.getByRole("button", "Enregistrer", { exact: true }).click();
      await expect(notice).toContainText("2 postes saisis.");
      expect((await readOwnedEntries(seeded.projectId)).map(({ item_id, quantity, unit, category, included }) =>
        [item_id, Number(quantity), unit, category, included]).sort()).toEqual([
        [item(24), 2, "u", "site_survey", true], [item(25), 3, "u", "site_survey", true]].sort());
      const answers = new Map((await readOwnedAnswers(seeded.projectId)).map((value) => [value.item_id, value]));
      expect([24, 25].map((index) => answers.get(item(index)))).toEqual([24, 25].map((index) =>
        expect.objectContaining({ item_id: item(index), outcome: "not_found", quantity: null })));

      // No gesture forces anything.
      await expect(screen.getByRole("button", /forc/i)).toHaveCount(0);
      await recordEvidence(army, "POSTE-REVUE01", { projectId: seeded.projectId, decisions: await readOwnedDecisions(seeded.projectId),
        entries: await readOwnedEntries(seeded.projectId) });
    });
});
