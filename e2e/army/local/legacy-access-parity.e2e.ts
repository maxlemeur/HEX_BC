import { expect } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence,
} from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";

// TI-141 checked the actual list with a second authenticated user. Native RLS
// and API-only coverage cannot establish that the list renders the right tenant.
// Each user here owns a disposable tenant on the runner's loopback backend.
armyTest("LEGACCESS01 a second tenant sees its own estimate and cannot list or open the first owner's version", {
  session: "army", tags: ["critical", "local", "legacy-access"], timeout: 180_000,
}, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser };
  const listedProject = (id: string, name: string) => browser.locator(`a[href="/dashboard/affaires/${id}"]`).filter({ hasText: name });
  await app.open("/dashboard/affaires");
  const ownerA = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LEGA", uiMode: "expert" });
  const projectA = `${army.projectName} propriétaire A`;
  const first = await createEstimateViaWizard(ui, { projectName: projectA, title: `${army.runPrefix} privé A` }, army);
  const line = await createLineViaApi(browser, first.versionId, `${army.runPrefix} ligne privée A`);
  const firstSnapshot = await readEstimate(browser, first.versionId);
  const firstCookies = await browser.cookies();
  // The former estimates list intentionally redirects to the current affaires
  // portfolio. Its old Voir/Dupliquer/Imprimer menu is no longer mounted.
  await app.open("/dashboard/estimates");
  await expect(browser).toHaveURL("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
  await expect(listedProject(first.projectId, projectA)).toBeVisible();

  const ownerB = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LEGB", uiMode: "expert" });
  expect(ownerB.tenantId).not.toBe(ownerA.tenantId);
  expect(ownerB.userId).not.toBe(ownerA.userId);
  const projectB = `${army.projectName} propriétaire B`;
  const second = await createEstimateViaWizard(ui, { projectName: projectB, title: `${army.runPrefix} privé B` }, army);
  const projectBExtra = `${army.projectName} deuxième affaire B`;
  const third = await createEstimateViaWizard(ui, { projectName: projectBExtra, title: `${army.runPrefix} privé B bis` }, army);
  await app.open("/dashboard/estimates");
  await expect(browser).toHaveURL("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
  for (const [ids, name] of [[second, projectB], [third, projectBExtra]] as const) {
    await expect(listedProject(ids.projectId, name)).toBeVisible();
    const edit = screen.getByRole("link", `Éditer le chiffrage de l’affaire ${name}`, { exact: true });
    await expect(edit).toHaveAttribute("href", `/dashboard/estimates/${ids.versionId}/edit`);
    await screen.getByRole("button", `Plus d’actions pour l’affaire ${name}`, { exact: true }).click();
    const open = screen.getByRole("menuitem", "Ouvrir l’affaire", { exact: true });
    await expect(open).toHaveAttribute("href", `/dashboard/affaires/${ids.projectId}`);
    await open.press("Escape");
    await expect(open).toBeHidden();
  }
  await expect(screen.getByText(projectA, { exact: true, visible: true })).toHaveCount(0);
  const listed = await apiRequest<{ ok: boolean; data: { items: Array<{ version_id: string; project_id: string }> } }>(browser, "GET", "/api/estimates");
  expect(listed.status).toBe(200);
  expect(listed.body.ok).toBe(true);
  expect(listed.body.data.items.map((item) => item.version_id).sort()).toEqual([second.versionId, third.versionId].sort());
  expect(listed.body.data.items.map((item) => item.project_id).sort()).toEqual([second.projectId, third.projectId].sort());
  const denied = await apiRequest<{ ok: boolean; error: { code: string }; data?: unknown }>(browser, "GET", `/api/estimates/${first.versionId}`);
  expect(denied.status).toBe(404);
  expect(denied.body.ok).toBe(false);
  expect(denied.body.data).toBeUndefined();
  await app.open(`/dashboard/estimates/${first.versionId}`);
  await expect(screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
  await expect(screen.getByText(projectA, { exact: true, visible: true })).toHaveCount(0);
  await expect(screen.getByText(line.title, { exact: true, visible: true })).toHaveCount(0);

  await browser.setCookies(firstCookies);
  await app.open("/dashboard/estimates");
  await expect(listedProject(first.projectId, projectA)).toBeVisible();
  await expect(screen.getByText(projectB, { exact: true, visible: true })).toHaveCount(0);
  const restored = await readEstimate(browser, first.versionId);
  expect(restored.items).toEqual(firstSnapshot.items);
  await recordEvidence(army, "legacy-cross-tenant-list", {
    owners: [{ tenantId: ownerA.tenantId, userId: ownerA.userId }, { tenantId: ownerB.tenantId, userId: ownerB.userId }],
    first, second, third, privateLineId: line.id,
    secondTenantListedVersionIds: listed.body.data.items.map((item) => item.version_id),
    foreignRead: { status: denied.status, code: denied.body.error.code },
    foreignPage: "Page introuvable", ownerRestored: true, unchangedItemIds: restored.items.map((item) => item.id),
  });
});
