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
  await expect(ui.screen.getByRole("heading", "Ajoutez le dossier de consultation", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("button", "Préparer le métré", { exact: true })).toHaveCount(0);
  await recordEvidence(ui.army, "HUB03-no-plans", { estimate, plansSection: false, launchButton: false });
});

armyTest("HUB04 the preparation hero identifies the retained plan set before launching", options, async (ui) => {
  requireLocalPlansBackend();
  const estimate = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-HUB04`, title: "ARMY hub avec plans" }, ui.army);
  const set = await createPlanSet(ui, ui.army, estimate, "Lot CVC");
  const file = await uploadSamplePlan(ui, ui.army, set);
  await ui.app.open(`/dashboard/affaires/${estimate.projectId}`);
  const prompt = ui.screen.getByRole("region", "Préparation du métré", { exact: true });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByText(/Lot CVC · 1 fichier/)).toBeVisible();
  await prompt.getByRole("button", "Préparer le métré", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await expect(dialog.getByLabel("Jeu de plans à analyser", { exact: true })).toHaveValue(set.id);
  await dialog.getByRole("button", /Vérifier et lancer$/).click();
  await expect(dialog.getByLabel("Version cible", { exact: true })).toHaveValue(estimate.versionId);
  await expect(dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeDisabled();
  await recordEvidence(ui.army, "HUB04-hero", { estimate, planSetId: set.id, fileId: file.id, fileCount: 1, preparationRequired: true });
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
  await ui.app.open(`/dashboard/affaires/${source.projectId}#plans`);
  const exceptions = ui.screen.getByRole("button", "Voir les 1 exception", { exact: true });
  await expect(exceptions).toBeVisible();
  await exceptions.click();
  const expectedPath = `/dashboard/affaires/${source.projectId}/takeoff/${job.jobId}/review?versionId=${target.versionId}&view=dpgf&dpgfView=exceptions_only`;
  await expect(ui.browser).toHaveURL(expectedPath);
  await recordEvidence(ui.army, "HUB05-carry-over", { source, target, planSetId: set.id, jobId: job.jobId, resultId: job.resultId, linkId, expectedPath });
});

armyTest("HUB12 plans and métrés each offer one next step, from the plan set to the review", options, async (ui) => {
  requireLocalPlansBackend();
  const { app, browser, screen, army } = ui;
  const estimate = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-HUB12`, title: "ARMY prochaine étape" }, army);
  const set = await createPlanSet(ui, army, estimate, "Plans architecte");
  await uploadSamplePlan(ui, army, set);
  const takeoffPath = `/dashboard/affaires/${estimate.projectId}/takeoff`;
  const plansPath = `/dashboard/affaires/${estimate.projectId}/plans`;

  // Plans: the only primary action opens the preparation of the set that holds the PDF.
  await app.open(plansPath);
  await expect(screen.getByRole("heading", "Analyser les plans", { exact: true })).toBeVisible();
  const prepare = screen.getByRole("link", "Préparer le métré", { exact: true });
  await expect(prepare).toHaveCount(1);
  await expect(prepare).toHaveAttribute("href", `${takeoffPath}?launch=1&launchPlanSet=${set.id}`);
  await prepare.click();
  const dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
  await expect(dialog.getByLabel("Jeu de plans à analyser", { exact: true })).toHaveValue(set.id);
  await browser.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(browser).toHaveURL(takeoffPath);

  // Métrés without analysis: one way to start, nothing to follow yet.
  await expect(screen.getByRole("heading", "Préparer le premier métré", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Préparer le métré", { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("heading", "Suivi des analyses", { exact: true })).toHaveCount(0);

  // A completed analysis never reported to the estimate becomes the next step.
  const fixture = await localTakeoffFixture(army, estimate);
  // Historical completed extraction fixture; no worker is invoked.
  const job = await fixture.seed("A", [{ designation: "Radiateur acier 600 W", quantity: 4, unit: "u", confidence: 0.94 }], "ARMY-next-step.csv");
  await browser.reload();
  await expect(screen.getByRole("heading", "Vérifier le métré proposé", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^L’IA a proposé 1 élément pour /)).toBeVisible();
  await expect(screen.getByRole("heading", "Suivi des analyses", { exact: true })).toBeVisible();

  // Filters narrow the list, never the next step; their reset keeps the keyboard focus.
  await app.open(`${takeoffPath}?status=action_required`);
  await expect(screen.getByRole("heading", "Vérifier le métré proposé", { exact: true })).toBeVisible();
  await expect(screen.getByText("Aucune analyse ne correspond à ces filtres.", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Réinitialiser les filtres", { exact: true }).click();
  await expect(browser).toHaveURL(takeoffPath);
  await expect(screen.getByRole("button", /^Filtres/)).toBeFocused();
  await expect(screen.getByText("Aucune analyse ne correspond à ces filtres.", { exact: true })).toHaveCount(0);

  // Once an analysis exists, the plans lead to the métrés instead of a second launch.
  await app.open(plansPath);
  await expect(screen.getByRole("heading", "Suivre le métré", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Préparer le métré", { exact: true })).toHaveCount(0);
  await screen.getByRole("link", "Ouvrir les métrés", { exact: true }).click();
  await expect(browser).toHaveURL(takeoffPath);

  const review = screen.getByRole("link", "Ouvrir la revue", { exact: true });
  const reviewPath = `${takeoffPath}/${job.jobId}/review?versionId=${estimate.versionId}`;
  await expect(review).toHaveAttribute("href", reviewPath);
  await review.click();
  await expect(browser).toHaveURL(reviewPath);
  await expect(screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true, level: 1 })).toBeVisible();
  await recordEvidence(army, "HUB12-next-steps", { estimate, planSetId: set.id, jobId: job.jobId, resultId: job.resultId, reviewPath });
});
