import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence } from "./fixtures";

armyTest("HUB02 a fresh affaire keeps its manual path without requiring a DPGF", {
  session: "army", trace: "off", tags: ["critical", "hub-manual"], timeout: 120_000,
}, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard/affaires");
  const projectName = `${army.runPrefix}-HUB02`;
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name: projectName }, version: { title: "ARMY manual first", date_devis: "2026-10-15", validite_jours: 30 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const estimate = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, estimate);
  const before = await readEstimate(browser, estimate.versionId);
  expect(before.items).toEqual([]);
  expect(before.project.name).toBe(projectName);
  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect(screen.getByText("Déposez vos pièces ici", { exact: true })).toBeVisible();
  const manualLink = screen.getByRole("link", "Continuer en manuel", { exact: true });
  const editorPath = `/dashboard/estimates/${estimate.versionId}/edit?entry=manual`;
  await expect(manualLink).toHaveAttribute("href", editorPath);
  await expect(screen.getByText("Le mode manuel reste disponible", { exact: true })).toBeVisible();
  await expect(screen.getByText("Vous pouvez ouvrir le devis sans DPGF et compléter la structure plus tard.", { exact: true })).toBeVisible();
  await manualLink.click();
  await expect(browser).toHaveURL(editorPath);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual([]);
  await recordEvidence(army, "HUB02-manual-path", { estimate, projectName, editorPath, emptyBefore: true, emptyAfter: true });
});
