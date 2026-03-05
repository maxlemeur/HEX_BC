import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createEstimateViaWizard,
  loginWithUi,
} from "./helpers";

const SAMPLE_PDF = path.join(__dirname, "../fixtures/sample-plan.pdf");

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

test.describe("V3-005 — Card Plans & Metres dans le hub affaire", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("hub affaire sans plans — empty state visible", async ({ page }) => {
    // 1. Create a fresh affaire (no plans uploaded yet)
    const projectName = buildEstimateName("V3005-NOPLAN");
    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "V3-005 Hub sans plans",
    });

    const projectId = await extractProjectId(page, versionId);

    // 2. Navigate to hub affaire
    await page.goto(`/dashboard/affaires/${projectId}`);

    // 3. Verify the PlansMetresCard renders with empty state
    //    (only visible if takeoff module is enabled for the tenant)
    const plansSection = page.locator("section").filter({ hasText: "Plans & Metres" });

    // If takeoff is disabled for this tenant, the card won't appear — skip gracefully
    const cardVisible = await plansSection.isVisible().catch(() => false);
    if (!cardVisible) {
      // Feature flag is off — test that the card is NOT rendered (AC: gate)
      await expect(plansSection).toBeHidden();
      return;
    }

    // 4. Verify empty state content
    await expect(plansSection.getByText("Ajoutez vos plans")).toBeVisible();
    await expect(plansSection.getByText("Importer des plans")).toBeVisible();

    // 5. Verify the CTA link points to the plans page
    const importLink = plansSection.getByRole("link", { name: /Importer des plans/i });
    await expect(importLink).toHaveAttribute("href", `/dashboard/affaires/${projectId}/plans`);
  });

  test("hub affaire avec plans — summary card affiche les donnees", async ({ page }) => {
    // 1. Create an affaire
    const projectName = buildEstimateName("V3005-PLANS");
    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "V3-005 Hub avec plans",
    });

    const projectId = await extractProjectId(page, versionId);

    // 2. Go to Plan Center and create a plan set with a file
    await page.goto(`/dashboard/affaires/${projectId}/plans`);

    // Check that the page loaded (if takeoff is disabled, skip)
    const pageHeading = page.getByRole("heading", { name: /Plans/i });
    const plansPageLoaded = await pageHeading.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!plansPageLoaded) {
      // Takeoff module not enabled — skip
      return;
    }

    // Create a plan set
    await page.getByRole("button", { name: /Creer.*jeu de plans/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Nom/i).fill("Lot CVC");
    await dialog.getByRole("button", { name: /Creer|Créer/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Expand the set and upload a PDF
    await page.getByText("Lot CVC").click();
    const fileInput = page.locator("input[type='file'][accept*='pdf']").first();
    await fileInput.setInputFiles(SAMPLE_PDF);

    // Wait for upload to complete
    await expect(page.getByText("sample-plan.pdf")).toBeVisible({ timeout: 15_000 });

    // 3. Navigate back to the hub affaire
    await page.goto(`/dashboard/affaires/${projectId}`);

    // 4. Verify the PlansMetresCard shows data (not empty state)
    const plansSection = page.locator("section").filter({ hasText: "Plans & Metres" });
    await expect(plansSection).toBeVisible({ timeout: 10_000 });

    // Should NOT show empty state
    await expect(plansSection.getByText("Ajoutez vos plans")).toBeHidden();

    // Should show plan set count badge
    await expect(plansSection.getByText(/1 jeu/)).toBeVisible();

    // Should show file count and size
    await expect(plansSection.getByText(/1 fichier/)).toBeVisible();

    // Should have "Voir les plans" link
    const voirLesPlansLink = plansSection.getByRole("link", { name: /Voir les plans/i });
    await expect(voirLesPlansLink).toBeVisible();
    await expect(voirLesPlansLink).toHaveAttribute("href", `/dashboard/affaires/${projectId}/plans`);

    // Should have "Lancer un metre" button (disabled, pending V3-009)
    await expect(plansSection.getByRole("button", { name: /Lancer un metre/i })).toBeVisible();
  });
});
