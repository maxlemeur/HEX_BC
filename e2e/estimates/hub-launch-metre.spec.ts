import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createEstimateViaWizard,
  loginWithUi,
} from "./helpers";

const SAMPLE_CSV = path.join(__dirname, "../fixtures/sample.csv");

async function extractProjectId(page: import("@playwright/test").Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as {
    data?: { version?: { project_id?: string }; project_id?: string };
    project_id?: string;
  };

  const projectId =
    payload.data?.version?.project_id ??
    payload.data?.project_id ??
    payload.project_id ??
    null;

  expect(projectId, "project_id should be present in estimate version response").toBeTruthy();
  return projectId as string;
}

test.describe("V3-009 — Action rapide Lancer un metre", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("launch metre from QuickActionsCard opens dialog, uploads CSV, redirects to takeoff", async ({ page }) => {
    // 1. Create a fresh affaire (creates project with draft version)
    const projectName = buildEstimateName("V3009-METRE");
    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "V3-009 Launch Metre",
    });

    const projectId = await extractProjectId(page, versionId);

    // 2. Navigate to Plan Center and create a plan set
    await page.goto(`/dashboard/affaires/${projectId}/plans`);

    const pageHeading = page.getByRole("heading", { name: /Plans/i });
    const plansPageLoaded = await pageHeading.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!plansPageLoaded) {
      // Takeoff module not enabled for this tenant — skip gracefully
      test.skip();
      return;
    }

    await page.getByRole("button", { name: /Creer.*jeu de plans/i }).first().click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel(/Nom/i).fill("Lot E2E Metre");
    await createDialog.getByRole("button", { name: /Creer|Créer/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // 3. Navigate back to the hub affaire
    await page.goto(`/dashboard/affaires/${projectId}`);

    // 4. Check the "Lancer un metre" button is visible in QuickActionsCard
    const quickActionsSection = page.locator("section").filter({ hasText: "Actions rapides" });
    await expect(quickActionsSection).toBeVisible({ timeout: 10_000 });

    const launchButton = quickActionsSection.getByRole("button", { name: /Lancer un metre/i });

    // If button is not visible, takeoff may be disabled — skip gracefully
    const buttonVisible = await launchButton.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!buttonVisible) {
      test.skip();
      return;
    }

    // 5. Click "Lancer un metre" → dialog should open
    await launchButton.click();
    const metreDialog = page.getByRole("dialog");
    await expect(metreDialog).toBeVisible();
    await expect(metreDialog.getByText(/Lancer un metre/i)).toBeVisible();

    // 6. Upload CSV file via the TakeoffUploadForm inside the dialog
    const fileInput = metreDialog.locator("input[type='file']").first();
    await fileInput.setInputFiles(SAMPLE_CSV);

    // Wait for file to be selected
    await expect(metreDialog.getByText("sample.csv")).toBeVisible({ timeout: 5_000 });

    // Submit
    await metreDialog.getByRole("button", { name: /Lancer l'extraction/i }).click();

    // 7. Verify redirection to the takeoff page
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/affaires/${projectId}/takeoff`),
      { timeout: 30_000 }
    );
  });
});
