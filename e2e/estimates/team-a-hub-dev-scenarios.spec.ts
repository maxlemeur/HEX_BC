import { test, expect } from "@playwright/test";

import { buildEstimateName, loginWithUi } from "./helpers";
import {
  createTeamAHubEstimateViaApi,
  getTeamARegisterSection,
  openTeamADevHubScenario,
} from "./team-a-hub.helpers";

const DEV_HUB_SCENARIOS_ENABLED = process.env.E2E_ALLOW_DEV_HUB_SCENARIOS === "1";

test.describe("Team A hub synthetic dev scenarios", () => {
  test.skip(
    !DEV_HUB_SCENARIOS_ENABLED,
    "devHubScenario is not available on production builds.",
  );

  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("keeps a readable under-reservations path with explicit register trace", async ({
    page,
  }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-HYP"),
      title: "Team A accepted with hypothesis",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "accepted-with-hypothesis",
    });
    const registerSection = getTeamARegisterSection(page);

    await expect(page.getByText("Analyse sous reserves")).toBeVisible();
    await expect(
      registerSection.getByText(
        "Prix fournisseurs a confirmer apres la premiere passe de chiffrage.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Traiter 1 hypothese ouverte" }),
    ).toBeVisible();
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });

  test("prioritises the clarification CTA and removes competing plan launch actions", async ({
    page,
  }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-CLARIFY"),
      title: "Team A clarify with client",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "clarify-client",
    });
    const registerSection = getTeamARegisterSection(page);

    await expect(page.getByText("Clarification client requise")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Traiter 1 clarification client" }).last(),
    ).toBeVisible();
    await expect(
      registerSection.getByText(
        "Le client doit confirmer le phasage et la variante retenue avant remise.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser les plans" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Demarrer l'analyse" })).toHaveCount(0);
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });

  test("keeps the revalidation CTA dominant and removes competing plan launch actions", async ({
    page,
  }) => {
    const { projectId } = await createTeamAHubEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-REVAL"),
      title: "Team A revalidation required",
    });

    await openTeamADevHubScenario(page, {
      projectId,
      scenario: "revalidation-required",
    });
    const registerSection = getTeamARegisterSection(page);

    await expect(page.getByText("Revalidation requise").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Relancer 1 revalidation critique" }).last(),
    ).toBeVisible();
    await expect(
      registerSection.getByText(
        "Le dossier a change; la revue documentaire et la pre-remise doivent etre rejouees.",
        { exact: true },
      ).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Analyser les plans" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Demarrer l'analyse" })).toHaveCount(0);
    await expect(page.getByText("Nadia Martin")).toHaveCount(0);
    await expect(page.getByText("Affaire test")).toHaveCount(0);
  });
});
