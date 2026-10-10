import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  buildEstimateName,
  createEstimateViaWizard,
  createLineViaApi,
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

  test("launch retained PDF from the hub, persist the request and open its activity center", async ({ page }, testInfo) => {
    const projectName = buildEstimateName("ARMY-V3009-METRE");
    const { versionId } = await createEstimateViaWizard(page, {
      projectName,
      title: "V3-009 Launch Metre",
    });

    const projectId = await extractProjectId(page, versionId);

    // A saved line makes this an operational hub, rather than the fresh-start
    // document intake. The existing manual-first journey covers the empty hub.
    await createLineViaApi(page, versionId, `${projectName}-BASE`);

    // 2. Navigate to Plan Center and create a plan set
    await page.goto(`/dashboard/affaires/${projectId}/plans`);

    await expect(page.getByRole("heading", { name: /^Plans$/i })).toBeVisible();

    await page.getByRole("button", { name: /Cr[ée]er.*jeu de plans/i }).first().click();
    const createDialog = page.getByRole("dialog");
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel(/Nom/i).fill("Lot E2E Metre");
    await createDialog.getByRole("button", { name: /Creer|Créer/i }).click();
    await expect(createDialog).toBeHidden({ timeout: 10_000 });

    await page.getByRole("heading", { name: "Lot E2E Metre" }).click();
    await page.locator("input[type='file'][accept*='pdf']").first().setInputFiles(
      path.join(process.cwd(), "e2e/fixtures/sample-plan.pdf"),
    );
    await expect(
      page.getByRole("button", { name: /^Supprimer sample-plan\.pdf$/i }),
    ).toBeVisible();

    const planSetsResponse = await page.request.get(
      `/api/takeoff/plan-sets?project_id=${projectId}`,
    );
    expect(planSetsResponse.status()).toBe(200);
    const planSets = (await planSetsResponse.json()).data.plan_sets as Array<{
      id: string;
      name: string;
      file_count: number;
    }>;
    expect(planSets).toHaveLength(1);
    expect(planSets[0]).toMatchObject({ name: "Lot E2E Metre", file_count: 1 });
    const planSetId = planSets[0].id;

    // 3. Navigate back to the hub affaire
    await page.goto(`/dashboard/affaires/${projectId}`);

    // 4. Check the launch CTA is visible from the hub.
    await expect(
      page.getByRole("heading", { name: "Plans, preuves & exceptions" }),
    ).toBeVisible();

    // The action bar keeps this action in its overflow menu.
    await page.getByRole("button", { name: "Plus", exact: true }).click();
    await page.getByRole("menuitem", { name: "Analyser les plans" }).click();
    const metreDialog = page.getByRole("dialog");
    await expect(metreDialog).toBeVisible();
    await expect(metreDialog.getByRole("heading", { name: "Analyser les plans" })).toBeVisible();
    await expect(metreDialog.getByText("Lot E2E Metre", { exact: true })).toBeVisible();
    await expect(metreDialog.getByLabel("Version cible", { exact: true })).toHaveValue(versionId);
    await metreDialog.getByRole("radio", { name: "Standard", exact: true }).check();

    type TestJob = {
      id: string;
      estimate_version_id: string;
      level: string;
      source_file_name: string;
      status: string;
    };
    const listTestJobs = async (): Promise<TestJob[]> => {
      const response = await page.request.get(
        `/api/takeoff/jobs?estimate_version_id=${versionId}`,
      );
      expect(response.status()).toBe(200);
      return (await response.json()).data.jobs;
    };
    const cancelTestJobs = async () => {
      for (const job of await listTestJobs()) {
        if (job.status !== "pending" && job.status !== "processing") continue;
        const response = await page.request.post(`/api/takeoff/jobs/${job.id}/cancel`);
        if (response.status() === 409) {
          const current = (await listTestJobs()).find((item) => item.id === job.id);
          expect(current?.status).toMatch(/^(completed|failed|canceled)$/);
        } else {
          expect(response.status()).toBe(200);
          expect((await response.json()).data.job.status).toBe("canceled");
        }
      }
    };
    expect(await listTestJobs()).toHaveLength(0);

    let launchAttempted = false;
    let jobId: string | null = null;
    try {
      // Retained plan sets require a PDF and Standard/Detailed, not a CSV.
      launchAttempted = true;
      await metreDialog.getByRole("button", { name: "Analyser maintenant" }).click();
      await expect.poll(async () => (await listTestJobs()).length).toBe(1);
      const [job] = await listTestJobs();
      jobId = job.id;
      expect(job).toMatchObject({
        estimate_version_id: versionId,
        level: "B",
        source_file_name: "sample-plan.pdf",
      });

      // Keep only this test's demand from continuing in the background. Creation
      // and persistence are real; this scenario does not qualify worker extraction.
      await cancelTestJobs();

      const activityLink = metreDialog.getByRole("link", { name: /Centre d'activit/i });
      await expect(activityLink).toHaveAttribute(
        "href", `/dashboard/affaires/${projectId}/takeoff`,
      );
      await activityLink.click();
      await expect(page).toHaveURL(
        new RegExp(`/dashboard/affaires/${projectId}/takeoff(?:[?#].*)?$`),
      );
    } finally {
      if (launchAttempted) await cancelTestJobs();
      await testInfo.attach("metre-fixture", {
        body: JSON.stringify({ projectId, versionId, planSetId, jobId }),
        contentType: "application/json",
      });
    }
  });
});
