import { nativeTest as test, describe, expect, duplicateEstimateViaApi, loginWithUi, localClient, type NativeUi as Page } from "./native-ui";

import { createLineViaApi, ownEstimate, recordEvidence } from "../critical/fixtures";
import { seedPlanSetWithFile, seedTakeoffJob, seedVersionLink } from "./recovery-support";


async function getAuthenticatedSupabaseClient() { return (await localClient()).client; }

async function extractProjectId(page: Page, versionId: string) {
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

async function createEstimateViaApi(
  page: Page,
  options: {
    projectName: string;
    title: string;
    dateDevis?: string;
    validiteJours?: number;
  }
) {
  const response = await page.request.post("/api/estimates", {
    failOnStatusCode: false,
    data: {
      project: {
        name: options.projectName,
      },
      version: {
        title: options.title,
        date_devis: options.dateDevis ?? "2026-03-11",
        validite_jours: options.validiteJours ?? 30,
      },
    },
  });
  const body = await response.text();

  expect(
    response.status(),
    `Failed to create estimate. status=${response.status()} body=${body}`
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

  if (!versionId) {
    throw new Error(`Unable to extract version id from payload: ${body}`);
  }

  return { versionId };
}

async function getTenantIdForVersion(versionId: string) {
  const sb = await getAuthenticatedSupabaseClient();
  const { data, error } = await sb
    .from("estimate_versions")
    .select("tenant_id")
    .eq("id", versionId)
    .single();

  if (error) {
    throw new Error(`Cannot resolve tenant for version: ${error.message}`);
  }

  const tenantId = (data as { tenant_id?: string }).tenant_id;
  if (!tenantId) {
    throw new Error("Missing tenant_id for version.");
  }

  return tenantId;
}

async function openPlansSection(page: Page, projectId: string) {
  await page.goto(`/dashboard/affaires/${projectId}`);

  const plansSection = page
    .locator("section")
    .filter({ hasText: "Plans, preuves & exceptions" });
  await expect(plansSection).toBeVisible();
  return plansSection;
}

describe("US-6.2 - reprise apres attente, erreur ou echec partiel", { session: "army", tags: ["critical", "extended"], timeout: 180_000 }, () => {
  test.beforeEach(async ({ ui: page }) => {
    await loginWithUi(page);
  });

  test("conserve les statuts acquis et renvoie vers la bonne etape apres un echec partiel", async ({ ui: page }) => {
    const sourceFileName = "us62-partial-recovery.pdf";
    const { versionId: sourceVersionId } = await createEstimateViaApi(page, {
      projectName: `${page.army.runPrefix} US62-PARTIAL`,
      title: "US-6.2 Reprise partielle",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    await createLineViaApi(page.browser, sourceVersionId, "ARMY reprise partielle conservée");
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    ownEstimate(page.army, { projectId, versionId: targetVersionId });
    await recordEvidence(page.army, "recovery-owned-versions", { projectId, sourceVersionId, targetVersionId });
    const tenantId = await getTenantIdForVersion(sourceVersionId);

    await seedPlanSetWithFile({
      projectId,
      versionId: targetVersionId,
      tenantId,
      planSetName: "Plans reprise partielle",
      fileName: sourceFileName,
    });

    const { jobId: acquiredJobId } = await seedTakeoffJob(page.army, {
      versionId: sourceVersionId,
      tenantId,
      sourceFileName,
      status: "completed",
      createResult: true,
    });

    await seedVersionLink({
      tenantId,
      jobId: acquiredJobId,
      sourceVersionId,
      targetVersionId,
    });

    await seedTakeoffJob(page.army, {
      versionId: targetVersionId,
      tenantId,
      sourceFileName,
      status: "failed",
      retryCount: 1,
      errorCode: "AI_TIMEOUT",
      errorMessage: "E2E partial failure",
    });

    const plansSection = await openPlansSection(page, projectId);

    await expect(plansSection.getByText("Reprise après échec partiel")).toBeVisible();
    await expect(
      plansSection.getByText(
        "Les analyses déjà acquises restent visibles. Corrigez ou relancez uniquement la reprise en échec."
      )
    ).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("0 en attente")).toBeVisible();
    await expect(plansSection.getByText("1 à corriger")).toBeVisible();
    const partialRecoveryHistory = plansSection.getByRole("list").first();
    await expect(
      partialRecoveryHistory.getByRole("listitem").filter({ hasText: "V2" }).first()
    ).toContainText("Échec à corriger");
    await expect(
      partialRecoveryHistory.getByRole("listitem").filter({ hasText: "V1" }).first()
    ).toContainText("Analyse terminée");

    const resumeLink = plansSection.getByRole("link", { name: "Reprendre l'analyse" });
    await expect(resumeLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff`
    );

    await resumeLink.click();
    await expect(page.browser).toHaveURL(`/dashboard/affaires/${projectId}/takeoff`);
  });

  test("garde la reprise lisible pendant l'attente et permet de suivre seulement ce qui manque", async ({ ui: page }) => {
    const sourceFileName = "us62-pending-recovery.pdf";
    const { versionId: sourceVersionId } = await createEstimateViaApi(page, {
      projectName: `${page.army.runPrefix} US62-PENDING`,
      title: "US-6.2 Reprise en attente",
    });
    const projectId = await extractProjectId(page, sourceVersionId);
    await createLineViaApi(page.browser, sourceVersionId, "ARMY reprise en attente conservée");
    const targetVersionId = await duplicateEstimateViaApi(page, sourceVersionId);
    ownEstimate(page.army, { projectId, versionId: targetVersionId });
    await recordEvidence(page.army, "recovery-owned-versions", { projectId, sourceVersionId, targetVersionId });
    const tenantId = await getTenantIdForVersion(sourceVersionId);

    await seedPlanSetWithFile({
      projectId,
      versionId: targetVersionId,
      tenantId,
      planSetName: "Plans reprise en attente",
      fileName: sourceFileName,
    });

    const { jobId: acquiredJobId } = await seedTakeoffJob(page.army, {
      versionId: sourceVersionId,
      tenantId,
      sourceFileName,
      status: "completed",
      createResult: true,
    });

    await seedVersionLink({
      tenantId,
      jobId: acquiredJobId,
      sourceVersionId,
      targetVersionId,
    });

    await seedTakeoffJob(page.army, {
      versionId: targetVersionId,
      tenantId,
      sourceFileName,
      status: "processing",
      processingStrategy: "batch",
      providerBatchState: "pending",
      retryCount: 2,
    });

    const plansSection = await openPlansSection(page, projectId);

    await expect(plansSection.getByText("Reprise en attente")).toBeVisible();
    await expect(
      plansSection.getByText(
        "Les résultats déjà acquis restent disponibles pendant l'attente. Revenez ici pour suivre ou relancer seulement ce qui manque."
      )
    ).toBeVisible();
    await expect(plansSection.getByText("1 acquis")).toBeVisible();
    await expect(plansSection.getByText("1 en attente")).toBeVisible();
    await expect(plansSection.getByText("0 à corriger")).toBeVisible();
    const pendingRecoveryHistory = plansSection.getByRole("list").first();
    await expect(
      pendingRecoveryHistory.getByRole("listitem").filter({ hasText: "V2" }).first()
    ).toContainText("En attente provider");
    await expect(
      pendingRecoveryHistory.getByRole("listitem").filter({ hasText: "V1" }).first()
    ).toContainText("Analyse terminée");

    const followLink = plansSection.getByRole("link", { name: "Suivre la reprise" });
    await expect(followLink).toHaveAttribute(
      "href",
      `/dashboard/affaires/${projectId}/takeoff`
    );

    await followLink.click();
    await expect(page.browser).toHaveURL(`/dashboard/affaires/${projectId}/takeoff`);
  });
});
