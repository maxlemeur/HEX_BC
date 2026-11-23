import { randomUUID } from "node:crypto";

import { apiRequest, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { readCountAnswers } from "./count-marks-support";
import { describe, expect, nativeTest as test } from "./native-ui";
import { countOwnedReceipts, fictionalSendPlanPdf, readOwnedLines, seedItemSendAffaire } from "./poste-send-support";

describe("Quantité vérifiée d’un poste sur un plan", () => {
  test("POSTE-COMPTAGE01 retient un repère au lieu des deux unités mesurées et retrouve une unité au devis",
    { session: "army", trace: "off", tags: ["critical", "local"], timeout: 240_000 }, async ({ ui }) => {
      const { app, army, screen } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "POSTECPT", calcPolicy: "absent" });
      const name = "plan-comptage.pdf";
      const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-POSTE-COMPTAGE`, labels: ["Lavabo"],
        plans: [{ name, measures: { Lavabo: { quantity: 2, page: 2 } }, pdf: await fictionalSendPlanPdf("Comptage") }] });
      const plan = seeded.plans[0];
      const itemId = seeded.items.Lavabo;
      const answerId = (await readCountAnswers(seeded.projectId))[itemId];
      const table = `/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${plan.fileId}`;
      await app.open(table);
      await waitForHydration(ui.browser);
      const marked = await apiRequest(ui.browser, "POST", `/api/affaires/${seeded.projectId}/takeoff/count-marks`, {
        intentKey: randomUUID(), revisions: { [answerId]: 0 },
        gestures: [{ op: "add", answer_id: answerId, key: randomUUID(), page: 2, x: 0.4, y: 0.5,
          geometry: { version: 1, view_box: [0, 0, 595, 842], rotation: 0, user_unit: 1, width: 595, height: 842 } },
          { op: "verify", answer_id: answerId, pages: [2, 7] }],
      });
      expect(marked.status).toBe(200);
      await screen.getByRole("link", "Détail de « Lavabo » sur le plan", { exact: true }).click();
      const detail = ui.locator('[data-testid="poste-detail"]');
      await expect(detail.getByRole("button", "Conserver la mesure (2 u)", { exact: true })).toBeVisible();
      await expect(detail.getByTestId("reperes-decompte")).toContainText("Le comptage vérifié peut être retenu pour le devis");
      await detail.getByRole("button", "Retenir le comptage vérifié (1 u)", { exact: true }).click();
      await expect(detail).toContainText("Comptage vérifié retenu");
      const choice = await app.screenshot("poste-comptage-accepte");
      await app.open(table);
      await waitForHydration(ui.browser);
      await expect(ui.locator(`[data-testid="poste-${itemId}"]`)).toContainText("1 u");
      await ui.locator('[data-testid="poste-plan-send"]').getByRole("button", "Envoyer ce plan au devis", { exact: true }).click();
      const dialog = screen.getByRole("dialog");
      const preview = dialog.getByTestId(`item-send-line-${itemId}-together`);
      await expect(preview).toContainText("Comptage vérifié");
      await expect(preview).toContainText("1 u");
      const receiptPreview = await app.screenshot("poste-comptage-apercu");
      await dialog.getByRole("button", `Créer le devis et y envoyer « ${name} »`, { exact: true }).click();
      await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit\?focusItemId=[0-9a-f-]{36}$/, { timeout: 60_000 });
      const lines = (await readOwnedLines(seeded.projectId)).filter((row) => row.item_type === "line");
      expect(lines).toHaveLength(1);
      const [line] = lines;
      await app.open(`/dashboard/estimates/${line.version_id}/edit?focusItemId=${line.id}`);
      const reloadedLine = `[data-estimate-item-id="${line.id}"]`;
      await expect(ui.browser.locator(reloadedLine)).toBeVisible({ timeout: 60_000 });
      await expect(ui.browser.locator(`${reloadedLine} input[aria-label="Quantité pour Lavabo"]`)).toHaveValue("1");
      expect(line.quantity).toBe(1);
      expect(await countOwnedReceipts(seeded.projectId)).toBe(1);
      const parts = await querySql(`select jsonb_build_array(item_id,kind,quantity,marks_revision,pages)
        from public.takeoff_item_send_parts where project_id = '${seeded.projectId}' and version_id = '${line.version_id}' and state = 'live';`);
      expect(parts).toHaveLength(1);
      const proof = JSON.parse(parts[0]);
      expect(proof).toEqual([itemId, "verified_count", 1, 1, [2]]);
      await recordEvidence(army, "POSTE-COMPTAGE01", { projectId: seeded.projectId, itemId, line: line.id,
        observed: 2, retained: line.quantity, proof, screenshots: [choice, receiptPreview] });
    });
});
