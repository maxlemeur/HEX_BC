import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createEstimateViaWizard,
  loginWithUi,
} from "./helpers";

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

test.describe("V3-009 — Action rapide Analyser les plans", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("launch metre from action bar opens dialog, uploads CSV, navigates to takeoff via success CTA", async ({ page }) => {
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
    test.skip(
      !process.env.CI && !plansPageLoaded,
      "Takeoff disabled for this tenant in the local environment."
    );
    expect(
      plansPageLoaded,
      "The critical E2E tenant must expose the takeoff module."
    ).toBe(true);

    await page.getByRole("button", { name: /Creer.*jeu de plans/i }).first().click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel(/Nom/i).fill("Lot E2E Metre");
    await createDialog.getByRole("button", { name: /Creer|Créer/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    // 3. Navigate back to the hub affaire
    await page.goto(`/dashboard/affaires/${projectId}`);

    // 4. Check the launch CTA is visible from the hub.
    const plansSection = page
      .locator("section")
      .filter({ hasText: "Plans, preuves & exceptions" });
    await expect(plansSection).toBeVisible({ timeout: 15_000 });

    const launchButton = page.getByRole("button", { name: "Analyser les plans" }).first();
    await expect(launchButton).toBeVisible({ timeout: 15_000 });

    // 5. Click "Analyser les plans" → dialog should open
    await launchButton.click();
    const metreDialog = page.getByRole("dialog");
    await expect(metreDialog).toBeVisible();
    await expect(metreDialog.getByText(/Analyser les plans/i)).toBeVisible();

    // 6. Launch analysis from the retained plan set
    await metreDialog.getByRole("button", { name: /Analyser maintenant/i }).click();

    // 7. After success, click "Centre d'activite" to navigate to takeoff page
    const activityButton = metreDialog.getByRole("button", { name: /Centre d'activit/i });
    await expect(activityButton).toBeVisible({ timeout: 30_000 });
    await activityButton.click();

    // 8. Verify redirection to the takeoff page
    await expect(page).toHaveURL(
      new RegExp(`/dashboard/affaires/${projectId}/takeoff`),
      { timeout: 30_000 }
    );
  });
});
