import { expect } from "e2e";

import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, recordEvidence } from "./fixtures";
import { createPlanSet, requireLocalPlansBackend, uploadSamplePlan } from "./plans-support";

type Job = { id: string; estimate_version_id: string; level: string; source_file_name: string; status: string };
type Envelope<T> = { ok: boolean; data: T };

armyTest("HUB01 retained PDF launch persists one Standard request and opens its activity center", {
  session: "army", trace: "off", tags: ["critical", "local", "hub-launch"], timeout: 180_000,
}, async (ui) => {
  requireLocalPlansBackend();
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("Hub analysis requires the campaign's worker-blocking server guard.");
  const { army, app, browser, screen } = ui;
  const projectName = `${army.runPrefix}-HUB01`;
  const estimate = await createEstimateViaWizard(ui, { projectName, title: "ARMY Launch Metre" }, army);
  await createLineViaApi(browser, estimate.versionId, `${projectName}-BASE`);
  const name = `${army.runPrefix} lot metre`;
  const planSet = await createPlanSet(ui, army, estimate, name);
  const file = await uploadSamplePlan(ui, army, planSet);
  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect(screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Plus", { exact: true }).click();
  await screen.getByRole("menuitem", "Analyser les plans", { exact: true }).click();
  const dialog = screen.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", "Analyser les plans", { exact: true })).toBeVisible();
  await expect(dialog.getByText(name, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Version cible", { exact: true })).toHaveValue(estimate.versionId);
  await dialog.getByRole("radio", "Standard", { exact: true }).check();

  const listJobs = async () => {
    const result = await apiRequest<Envelope<{ jobs: Job[] }>>(browser, "GET", `/api/takeoff/jobs?estimate_version_id=${estimate.versionId}`);
    expect([result.status, result.body.ok]).toEqual([200, true]);
    return result.body.data.jobs.map(({ id, estimate_version_id, level, source_file_name, status }) =>
      ({ id, estimate_version_id, level, source_file_name, status }));
  };
  const cancelJobs = async () => {
    for (const job of await listJobs()) {
      expect(job.estimate_version_id).toBe(estimate.versionId);
      if (job.status !== "pending" && job.status !== "processing") continue;
      const result = await apiRequest<Envelope<{ job: Job }>>(browser, "POST", `/api/takeoff/jobs/${job.id}/cancel`);
      if (result.status === 409) {
        const current = (await listJobs()).find((entry) => entry.id === job.id);
        expect(current?.status).toMatch(/^(completed|failed|canceled)$/);
      } else {
        expect([result.status, result.body.ok, result.body.data.job.status]).toEqual([200, true, "canceled"]);
      }
    }
  };
  expect(await listJobs()).toEqual([]);
  let launchAttempted = false;
  let jobId: string | null = null;
  try {
    launchAttempted = true;
    await dialog.getByRole("button", "Analyser maintenant", { exact: true }).click();
    await expect.poll(async () => (await listJobs()).length, { timeout: 45_000 }).toBe(1);
    const [job] = await listJobs();
    jobId = job.id;
    expect(job).toMatchObject({ estimate_version_id: estimate.versionId, level: "B", source_file_name: "sample-plan.pdf" });
    await recordEvidence(army, "HUB01-request-persisted", { estimate, planSetId: planSet.id, file, job });
    await cancelJobs();
    const activityLink = dialog.getByRole("link", /Centre d'activit/i);
    const activityPath = `/dashboard/affaires/${estimate.projectId}/takeoff`;
    await expect(activityLink).toHaveAttribute("href", activityPath);
    await activityLink.click();
    await expect(browser).toHaveURL(activityPath);
    const canceled = await listJobs();
    expect(canceled).toHaveLength(1);
    expect(canceled[0]).toMatchObject({ id: jobId, status: "canceled" });
    await browser.reload();
    await expect(browser).toHaveURL(activityPath);
    expect(await listJobs()).toEqual(canceled);
    await recordEvidence(army, "HUB01-activity-reloaded", { estimate, planSetId: planSet.id, fileId: file.id, jobs: canceled, activityPath });
  } finally {
    try {
      if (launchAttempted) await cancelJobs();
    } finally {
      await recordEvidence(army, "HUB01-fixture", { estimate, planSetId: planSet.id, fileId: file.id, jobId, launchAttempted });
    }
  }
});
