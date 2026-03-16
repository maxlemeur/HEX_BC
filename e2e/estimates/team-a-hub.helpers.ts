import { expect, type Page } from "@playwright/test";

export async function createTeamAHubEstimateViaApi(page: Page, input: {
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

export async function openTeamADevHubScenario(page: Page, input: {
  projectId: string;
  scenario: string;
}) {
  await page.goto(
    `/dashboard/affaires/${input.projectId}?devHubScenario=${input.scenario}`,
    { waitUntil: "domcontentloaded" },
  );
  await expect(page.getByRole("heading", { name: "Pilotage de l'affaire" })).toBeVisible();
}

export function getTeamARegisterSection(page: Page) {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Registre hypothèses & pièces manquantes" }),
  });
}
