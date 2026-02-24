import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createLineViaApi,
  createEstimateViaWizard,
  expectLineTitleVisible,
  extractVersionIdFromUrl,
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

    await page.goto("/dashboard/estimates");

    const searchInput = page.getByPlaceholder(/Rechercher par projet ou client/i);
    await searchInput.fill(projectName);

    const sourceRow = page
      .locator("table.data-table tbody tr")
      .filter({ hasText: projectName })
      .first();

    await expect(sourceRow).toBeVisible({ timeout: 30_000 });

    await Promise.all([
      page.waitForURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[/?#].*)?$/i, {
        timeout: 60_000,
      }),
      sourceRow.getByRole("button", { name: /^Dupliquer$/ }).click(),
    ]);

    const duplicatedVersionId = extractVersionIdFromUrl(page.url());
    expect(duplicatedVersionId).not.toBe(sourceVersionId);

    await openEditorTab(page);
    await expectLineTitleVisible(page, lineTitle);
  });
});
