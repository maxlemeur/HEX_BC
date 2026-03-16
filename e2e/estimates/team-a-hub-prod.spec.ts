import { expect, test } from "@playwright/test";

import { buildEstimateName, loginWithUi } from "./helpers";
import { createTeamAHubEstimateViaApi } from "./team-a-hub.helpers";

test.describe("Team A hub prod coverage", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("keeps the manual path visible without requiring a DPGF", async ({ page }) => {
    const { projectId, versionId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-MANUAL"),
      title: "Team A manual first",
    });

    await page.goto(`/dashboard/affaires/${projectId}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByText("Deposez vos pieces ici")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Continuer en manuel" }),
    ).toHaveAttribute("href", `/dashboard/estimates/${versionId}/edit?entry=manual`);
    await expect(
      page.getByText("Le mode manuel reste disponible"),
    ).toBeVisible();
    await expect(
      page.getByText("Vous pouvez ouvrir le devis sans DPGF et completer la structure plus tard."),
    ).toBeVisible();
  });
});
