import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createLineViaApi,
  createEstimateViaWizard,
  duplicateEstimateViaApi,
  expectLineTitleVisible,
  openEditorTab,
} from "./helpers";

test.describe("EST-262 - duplication", () => {
  test("Scenario 3: dupliquer un devis et verifier les donnees copiees", async ({ page }) => {
    const projectName = buildEstimateName("EST262-S3");
    const lineTitle = `${projectName}-LIGNE`;

    const { versionId: sourceVersionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "EST-262 Scenario 3",
    });

    await createLineViaApi(page, sourceVersionId, lineTitle);
    await page.reload();
    await openEditorTab(page);
    await expectLineTitleVisible(page, lineTitle);

    const duplicatedVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    expect(duplicatedVersionId).not.toBe(sourceVersionId);

    await page.goto(`/dashboard/estimates/${duplicatedVersionId}/edit`);
    await openEditorTab(page);
    await expectLineTitleVisible(page, lineTitle);
  });
});
