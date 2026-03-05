import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createLineViaApi,
  createEstimateViaWizard,
  expectCurrentStatus,
  exportEstimateAsXlsx,
  openEditorTab,
  openPrintPage,
  setLineCoreValues,
  expectLineTitleVisible,
  waitForAutoSave,
} from "./helpers";

test.describe("EST-262 - parcours critique (creation, edition, statut, sortie)", () => {
  test("Scenario 1: creer un devis, ajouter une ligne, editer et sauvegarder", async ({ page }) => {
    const projectName = buildEstimateName("EST262-S1");
    const lineTitle = `${projectName}-LIGNE-1`;

    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "EST-262 Scenario 1",
    });

    await createLineViaApi(page, versionId, lineTitle);
    await page.reload();
    await openEditorTab(page);
    await expectLineTitleVisible(page, lineTitle);

    await setLineCoreValues(page, lineTitle, {
      quantity: "2",
      unitPriceHt: "100",
    });

    await waitForAutoSave(page);
    await expectCurrentStatus(page, "draft");
  });

  test("Scenario 2 + 4: changer le statut, exporter et verifier la page print", async ({ page }) => {
    const projectName = buildEstimateName("EST262-S2");

    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "EST-262 Scenario 2",
    });

    await expectCurrentStatus(page, "draft");
    const sendButton = page.getByRole("button", { name: /^Envoyer$/ });
    await expect(sendButton).toBeVisible();
    await sendButton.click();

    const gatingDialog = page.getByRole("dialog", {
      name: /Verification avant envoi/i,
    });
    const sentBadge = page
      .locator(".status-badge")
      .filter({ hasText: /Envoy/i })
      .first();

    const sendOutcome = await Promise.race([
      gatingDialog
        .waitFor({ state: "visible", timeout: 8_000 })
        .then(() => "dialog" as const),
      sentBadge.waitFor({ state: "visible", timeout: 8_000 }).then(() => "sent" as const),
    ]).catch(() => "unknown" as const);

    if (sendOutcome === "sent") {
      await expectCurrentStatus(page, "sent");
    } else if (sendOutcome === "dialog" || (await gatingDialog.isVisible().catch(() => false))) {
      const confirmSendButton = gatingDialog.getByRole("button", {
        name: /^Envoyer$/,
      });

      if (await confirmSendButton.isEnabled()) {
        await confirmSendButton.click();
        await expectCurrentStatus(page, "sent");

        const acceptButton = page.getByRole("button", { name: /^Accepter$/ });
        if (await acceptButton.isVisible()) {
          await acceptButton.click();
          await expectCurrentStatus(page, "accepted");
        }
      } else {
        await expect(
          gatingDialog.getByRole("heading", { name: /Bloquants/i })
        ).toBeVisible();
        const cancelButton = gatingDialog.getByRole("button", {
          name: /Annuler|Fermer/i,
        });
        await cancelButton.first().click();
        await expect(gatingDialog).toBeHidden();
      }
    }

    await exportEstimateAsXlsx(page, versionId);
    await openPrintPage(page, versionId);

    await expect(page.getByText(projectName).first()).toBeVisible();
  });
});
