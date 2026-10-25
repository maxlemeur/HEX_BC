import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, recordEvidence } from "./fixtures";
import { createPlanSet, readPlanFiles, readPlanSets, requireLocalPlansBackend, uploadPlansUnderNames, uploadSamplePlan } from "./plans-support";

armyTest("PLAN01 plan center uploads, persists and deletes an owned PDF and plan set", {
  session: "army", trace: "off", tags: ["critical", "local", "plan-center"], timeout: 180_000,
}, async (ui) => {
  requireLocalPlansBackend();
  const { army, browser, screen } = ui;
  const projectName = `${army.runPrefix}-PLAN01`;
  const estimate = await createEstimateViaWizard(ui, { projectName, title: "ARMY Plan Center" }, army);
  const name = `${army.runPrefix} jeu de plans`;
  const planSet = await createPlanSet(ui, army, estimate, name);
  const breadcrumb = screen.getByRole("navigation", "Fil d'Ariane", { exact: true });
  await expect(breadcrumb).toBeVisible();
  await expect(breadcrumb.getByText("Affaires", { exact: true })).toBeVisible();
  await expect(breadcrumb.getByRole("link", projectName, { exact: true })).toBeVisible();
  await expect(breadcrumb.getByText("Plans", { exact: true })).toBeVisible();
  const file = await uploadSamplePlan(ui, army, planSet);
  await browser.reload();
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();
  await screen.getByRole("heading", name, { exact: true }).click();
  const removeFile = screen.getByRole("button", "Supprimer sample-plan.pdf", { exact: true });
  await expect(removeFile).toBeVisible();
  expect(await readPlanFiles(browser, planSet.id)).toEqual([file]);
  await removeFile.click();
  const fileDialog = screen.getByRole("alertdialog", /Supprimer le fichier/i);
  await expect(fileDialog).toBeVisible();
  await fileDialog.getByRole("button", "Supprimer", { exact: true }).click();
  await expect(fileDialog).toBeHidden();
  await expect(removeFile).toBeHidden();
  expect(await readPlanFiles(browser, planSet.id)).toEqual([]);
  expect((await readPlanSets(browser, estimate.projectId))[0]).toMatchObject({ id: planSet.id, file_count: 0 });
  const names = ["Plan R+1.pdf", "Plan R-1.pdf"];
  const renamed = await uploadPlansUnderNames(ui, army, planSet, names);
  expect(renamed.map((stored) => stored.file_name)).toEqual(["Plan-R-1.pdf", "Plan-R-1.pdf"]);
  expect(renamed.map((stored) => stored.original_file_name).sort()).toEqual(names);
  for (const stored of renamed) expect(stored.file_path).toBe(`${planSet.tenant_id}/${planSet.id}/${stored.id}/Plan-R-1.pdf`);
  await browser.reload();
  await screen.getByRole("heading", name, { exact: true }).click();
  for (const label of names) await expect(screen.getByRole("button", `Supprimer ${label}`, { exact: true })).toBeVisible();
  await screen.getByRole("button", `Supprimer le jeu "${name}"`, { exact: true }).click();
  const setDialog = screen.getByRole("alertdialog", /Supprimer le jeu de plans/i);
  await expect(setDialog).toBeVisible();
  await setDialog.getByRole("button", "Supprimer", { exact: true }).click();
  await expect(setDialog).toBeHidden();
  await expect(screen.getByText("Aucun jeu de plans", { exact: true })).toBeVisible();
  expect(await readPlanSets(browser, estimate.projectId)).toEqual([]);
  await browser.reload();
  await expect(screen.getByText("Aucun jeu de plans", { exact: true })).toBeVisible();
  await recordEvidence(army, "PLAN01-deletion", { estimate, planSetId: planSet.id, fileId: file.id, renamedFileIds: renamed.map((stored) => stored.id),
    files: [], planSets: [], reloadedEmpty: true });
});
