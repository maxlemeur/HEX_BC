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

test.describe("V3-006 — Plan Center affaire", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("upload plan, verify display, delete", async ({ page }) => {
    // 1. Create an affaire via wizard
    const projectName = buildEstimateName("V3006-PLAN");
    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "V3-006 Plan Center",
    });

    const projectId = await extractProjectId(page, versionId);

    // 2. Navigate to Plan Center
    await page.goto(`/dashboard/affaires/${projectId}/plans`);

    // If takeoff is disabled for this tenant, route is intentionally hidden.
    const pageState = await Promise.race([
      page
        .getByRole("heading", { name: /^Plans$/i })
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => "plans"),
      page
        .getByText("Plans introuvables ou acces non autorise.")
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => "unavailable"),
    ]).catch(() => "unknown");

    test.skip(
      !process.env.CI && pageState === "unavailable",
      "Takeoff disabled for this tenant in the local environment."
    );
    expect(
      pageState,
      "The critical E2E tenant must expose the plan center."
    ).toBe("plans");

    // 3. Verify breadcrumb 3 levels
    const breadcrumb = page.locator("nav[aria-label=\"Fil d'Ariane\"]");
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByText("Mes affaires")).toBeVisible();
    await expect(breadcrumb.getByText(projectName)).toBeVisible();
    await expect(breadcrumb.getByText("Plans", { exact: true })).toBeVisible();

    // 4. Verify empty state
    await expect(page.getByText("Aucun jeu de plans")).toBeVisible();

    // 5. Create a plan set
    await page.getByRole("button", { name: /Creer.*jeu de plans/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(/Nom/i).fill("Jeu de test E2E");
    await dialog.getByRole("button", { name: /Creer|Créer/i }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });

    // Verify the set card appeared
    await expect(page.getByText("Jeu de test E2E")).toBeVisible();
    await expect(page.getByText("0 plans")).toBeVisible();

    // 6. Expand the set and upload a PDF
    await page.getByText("Jeu de test E2E").click();

    const dropZone = page.locator("input[type='file'][accept*='pdf']").first();
    await dropZone.setInputFiles(SAMPLE_PDF);

    // 7. Verify file appears (name, size)
    await expect(page.getByText("sample-plan.pdf")).toBeVisible({ timeout: 15_000 });

    // 8. Delete the file
    const fileDeleteBtn = page.getByRole("button", {
      name: /^Supprimer sample-plan\.pdf$/i,
    });
    await fileDeleteBtn.click();

    // Confirm deletion in the modal
    const confirmDialog = page
      .locator("div.fixed.inset-0.z-50")
      .filter({ has: page.getByRole("heading", { name: /Supprimer le fichier/i }) });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole("button", { name: /^Supprimer$/i }).click();
    await expect(confirmDialog).toBeHidden({ timeout: 10_000 });

    // Verify file is gone
    await expect(page.getByText("sample-plan.pdf")).toBeHidden({ timeout: 10_000 });

    // 9. Delete the plan set
    // The set header has a delete button (trash icon)
    const setDeleteButton = page.getByRole("button", {
      name: /Supprimer le jeu "Jeu de test E2E"/i,
    });
    await setDeleteButton.click();

    const setConfirmDialog = page
      .locator("div.fixed.inset-0.z-50")
      .filter({ has: page.getByRole("heading", { name: /Supprimer le jeu de plans/i }) });
    await expect(setConfirmDialog).toBeVisible();
    await setConfirmDialog.getByRole("button", { name: /^Supprimer$/i }).click();
    await expect(setConfirmDialog).toBeHidden({ timeout: 10_000 });

    // 10. Verify empty state is back
    await expect(page.getByText("Aucun jeu de plans")).toBeVisible({ timeout: 10_000 });
  });
});
