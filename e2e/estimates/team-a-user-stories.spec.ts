import { expect, test, type Page } from "@playwright/test";

import { buildEstimateName, loginWithUi } from "./helpers";

async function createEstimateViaApi(page: Page, input: {
  projectName: string;
  title: string;
}) {
  const response = await page.request.post("/api/estimates", {
    failOnStatusCode: false,
    data: {
      project: {
        name: input.projectName,
      },
      version: {
        title: input.title,
        date_devis: "2026-03-10",
        validite_jours: 30,
      },
    },
  });
  const body = await response.text();
  expect(
    response.status(),
    `Failed to create estimate. status=${response.status()} body=${body}`,
  ).toBe(201);

  const payload = JSON.parse(body) as {
    data?: {
      version?: {
        id?: string;
        project_id?: string;
      };
      version_id?: string;
      project_id?: string;
    };
    version_id?: string;
    project_id?: string;
  };

  const versionId =
    payload.data?.version?.id ??
    payload.data?.version_id ??
    payload.version_id ??
    null;
  const projectId =
    payload.data?.version?.project_id ??
    payload.data?.project_id ??
    payload.project_id ??
    null;

  expect(versionId, "version_id should be present in estimate creation response").toBeTruthy();
  expect(projectId, "project_id should be present in estimate version response").toBeTruthy();
  return {
    versionId: versionId as string,
    projectId: projectId as string,
  };
}

async function openHubScenario(page: Page, input: {
  projectId: string;
  scenario: string;
}) {
  await page.goto(
    `/dashboard/affaires/${input.projectId}?devHubScenario=${input.scenario}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByRole("heading", { name: "Pilotage de l'affaire" })).toBeVisible();
}

function getRegisterSection(page: Page) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Registre hypothèses & pièces manquantes" }),
  });
}

test.describe("Team A vNext2 hub scenarios", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithUi(page);
  });

  test("fresh empty affaire keeps the manual path visible without requiring a DPGF", async ({
    page,
  }) => {
    const { projectId, versionId } = await createEstimateViaApi(page, {
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

  test("accepted-with-hypothesis keeps a readable under-reservations path with explicit register trace", async ({
    page,
  }) => {
    const { projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-HYP"),
      title: "Team A accepted with hypothesis",
    });

    await openHubScenario(page, {
      projectId,
      scenario: "accepted-with-hypothesis",
    });
    const registerSection = getRegisterSection(page);

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

  test("clarify-client prioritises the clarification CTA and removes competing plan launch actions", async ({
    page,
  }) => {
    const { projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-CLARIFY"),
      title: "Team A clarify with client",
    });

    await openHubScenario(page, {
      projectId,
      scenario: "clarify-client",
    });
    const registerSection = getRegisterSection(page);

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

  test("revalidation-required keeps the revalidation CTA dominant and removes competing plan launch actions", async ({
    page,
  }) => {
    const { projectId } = await createEstimateViaApi(page, {
      projectName: buildEstimateName("TEAMA-REVAL"),
      title: "Team A revalidation required",
    });

    await openHubScenario(page, {
      projectId,
      scenario: "revalidation-required",
    });
    const registerSection = getRegisterSection(page);

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
