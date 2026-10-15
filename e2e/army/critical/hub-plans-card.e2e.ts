import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { localTakeoffFixture } from "../takeoff/fixtures";
import { armyTest, createEstimateViaWizard, createLineViaApi, recordEvidence } from "./fixtures";
import { createPlanSet, duplicateHubVersion, requireLocalPlansBackend, uploadSamplePlan } from "./plans-support";

const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "hub-plans"], timeout: 180_000 };

armyTest("HUB03 a fresh affaire without plans hides the plans section and launch action", options, async (ui) => {
  requireLocalPlansBackend();
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-HUB03`, title: "ARMY hub sans plans" }, ui.army);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect(ui.screen.getByText("Déposez vos pièces ici", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("button", "Analyser les plans", { exact: true })).toHaveCount(0);
  await recordEvidence(ui.army, "HUB03-no-plans", { estimate, plansSection: false, launchButton: false });
});

armyTest("HUB04 the launch hero identifies the retained plan set and draft version", options, async (ui) => {
  requireLocalPlansBackend();
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-HUB04`, title: "ARMY hub avec plans" }, ui.army);
  const set = await createPlanSet(ui, ui.army, estimate, "Lot CVC");
  const file = await uploadSamplePlan(ui, ui.army, set);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
  const prompt = ui.screen.getByRole("region", "Proposition d'analyse automatique", { exact: true });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText("Jeu de plans : Lot CVC (1 fichier)", { exact: true })).toBeVisible();
  await expect(prompt.getByText(/Version cible :/)).toBeVisible();
  await expect(prompt.getByText("V1 (brouillon)", { exact: true })).toBeVisible();
  await expect(prompt.getByRole("button", "Analyser maintenant", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "HUB04-hero", { estimate, planSetId: set.id, fileId: file.id, versionLabel: "V1 (brouillon)", fileCount: 1 });
});

armyTest("HUB05 carried-over exceptions target the currently linked estimate version", options, async (ui) => {
  requireLocalPlansBackend();
  const source = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-HUB05`, title: "ARMY hub carry-over" }, ui.army);
  await createLineViaApi(ui.browser, source.versionId, `${ui.army.runPrefix}-BASE`);
  const target = await duplicateHubVersion(ui.browser, ui.army, source);
  const set = await createPlanSet(ui, ui.army, target, "Plans carry-over");
  await uploadSamplePlan(ui, ui.army, set);
  const fixture = await localTakeoffFixture(ui.army, source);
  // Preserve the historical completed extraction fixture; no worker is invoked.
  const job = await fixture.seed("A", [{ designation: "Reserve technique inutile", quantity: 4, unit: "u", confidence: 0.94 }], "ARMY-carry-over.csv");
  const linkId = randomUUID();
  const link = await fixture.client.from("takeoff_version_links").insert({ id: linkId, tenant_id: fixture.tenantId,
    takeoff_job_id: job.jobId, source_version_id: source.versionId, target_version_id: target.versionId });
  if (link.error) throw new Error(`Owned takeoff link fixture failed: ${link.error.code}`);
  await ui.app.open(`/dashboard/affaires/${source.projectId}`);
  const exceptions = ui.screen.getByRole("button", "Voir les 1 exception", { exact: true });
  await expect(exceptions).toBeVisible();
  await exceptions.click();
  const expectedPath = `/dashboard/affaires/${source.projectId}/takeoff/${job.jobId}/review?versionId=${target.versionId}&view=dpgf&dpgfView=exceptions_only`;
  await expect(ui.browser).toHaveURL(expectedPath);
  await recordEvidence(ui.army, "HUB05-carry-over", { source, target, planSetId: set.id, jobId: job.jobId, resultId: job.resultId, linkId, expectedPath });
});
