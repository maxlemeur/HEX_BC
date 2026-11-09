import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence } from "./fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "loading-feedback"], timeout: 120_000 };

function requestGate() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  return { pending, release: () => release() };
}

armyTest("LOAD01 navigation reports pending work and respects reduced motion", options, async ({ app, browser, screen, army }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await browser.emulateMedia({ reducedMotion: "reduce" });
  await app.open("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
  const gate = requestGate();
  await browser.route("**/dashboard/profile?**", async (route) => {
    await gate.pending;
    await route.fallback();
  });
  try {
    await screen.getByRole("link", /Ouvrir le profil/, { visible: true }).tap();
    await expect(screen.getByText("Chargement en cours…", { exact: true })).toBeVisible();
    expect(await browser.evaluate(() => ({
      bar: getComputedStyle(document.querySelector(".navigation-feedback__bar")!).animationName,
      spinner: getComputedStyle(document.querySelector(".navigation-feedback [data-slot='spinner']")!).animationName,
      blocksClicks: getComputedStyle(document.querySelector(".navigation-feedback")!).pointerEvents,
    }))).toEqual({ bar: "none", spinner: "none", blocksClicks: "none" });
    await app.screenshot("navigation-pending-reduced-motion");
  } finally {
    gate.release();
  }
  await expect(browser).toHaveURL("/dashboard/profile");
  await expect(screen.getByRole("heading", "Mon profil", { exact: true })).toBeVisible();
  await expect(screen.getByText("Chargement en cours…", { exact: true })).toHaveCount(0);
  await recordEvidence(army, "navigation-pending", { completed: true, reducedMotion: true, blocksClicks: false });
});

armyTest("LOAD02 affaire filters and favorites stay busy until the server responds", options, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard/affaires");
  const name = `${army.runPrefix}-loader`;
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name }, version: { title: "Loading feedback", date_devis: "2026-11-09", validite_jours: 30 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const estimate = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, estimate);
  await app.open("/dashboard/affaires");
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();
  const filterGate = requestGate();
  let filterRequested = false;
  await browser.route("**/dashboard/affaires?**", async (route) => {
    if (route.request.method === "GET" && new URL(route.request.url).searchParams.get("q")?.trim() === name) {
      filterRequested = true;
      await filterGate.pending;
    }
    await route.fallback();
  });
  try {
    await screen.getByRole("searchbox", "Rechercher par nom ou client…").fill(` ${name} `);
    await expect.poll(() => filterRequested).toBe(true);
    await expect(screen.getByText("Actualisation des affaires…", { exact: true })).toBeVisible();
    await expect(browser.locator('[role="search"]')).toHaveAttribute("aria-busy", "true");
    await expect(screen.getByRole("region", "Liste des affaires")).toHaveAttribute("aria-busy", "true");
    await app.screenshot("affaires-filter-pending");
  } finally {
    filterGate.release();
  }
  await expect(screen.getByRole("region", "Liste des affaires")).toHaveAttribute("aria-busy", "false");
  await expect(screen.getByRole("heading", name, { exact: true })).toBeVisible();
  await expect(screen.getByText("Actualisation des affaires…", { exact: true })).toHaveCount(0);

  const favoriteGate = requestGate();
  await browser.route("**/dashboard/affaires?**", async (route) => {
    if (route.request.method === "POST") await favoriteGate.pending;
    await route.fallback();
  });
  try {
    await screen.getByRole("button", "Ajouter aux favoris", { exact: true }).tap();
    const favorite = screen.getByRole("button", "Retirer des favoris", { exact: true });
    await expect(favorite).toHaveAttribute("aria-busy", "true");
    await expect(favorite).toBeDisabled();
  } finally {
    favoriteGate.release();
  }
  await expect(screen.getByRole("button", "Retirer des favoris", { exact: true })).toBeEnabled();
  await browser.reload();
  await expect(screen.getByRole("button", "Retirer des favoris", { exact: true })).toBeVisible();
  await recordEvidence(army, "affaire-filter-favorite-pending", { estimate, waitsForServer: true, favoritePersisted: true });
});

armyTest("LOAD03 closed action menus keep feedback through failure, retry and navigation", options, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard/affaires");
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name: `${army.runPrefix}-action` }, version: { title: "Loading action", date_devis: "2026-11-09", validite_jours: 30 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const estimate = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, estimate);
  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  const pattern = `**/api/estimates/${estimate.versionId}/duplicate`;
  const gate = requestGate();
  await browser.route(pattern, async (route) => {
    await gate.pending;
    await route.fulfill({ status: 409, json: { ok: false, error: { code: "CONFLICT", message: "Duplication interrompue pour le test." } } });
  });
  try {
    await screen.getByRole("button", "Plus", { exact: true }).tap();
    await screen.getByRole("menuitem", "Nouvelle version", { exact: true }).tap();
    await expect(screen.getByRole("menuitem", "Nouvelle version", { exact: true })).toHaveCount(0);
    await expect(screen.getByText("Chargement en cours…", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Plus", { exact: true }).tap();
    await expect(screen.getByRole("menuitem", "Duplication…", { exact: true })).toBeDisabled();
    await expect(screen.getByRole("menuitem", "Dupliquer en variante", { exact: true })).toBeDisabled();
    await screen.getByRole("button", "Plus", { exact: true }).tap();
    await expect(screen.getByRole("button", "Plus", { exact: true })).toHaveAttribute("aria-expanded", "false");
    await expect(screen.getByText("Chargement en cours…", { exact: true })).toBeVisible();
    await app.screenshot("closed-menu-action-pending");
  } finally {
    gate.release();
  }
  await expect(screen.getByText("Duplication interrompue pour le test.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Chargement en cours…", { exact: true })).toHaveCount(0);
  await browser.unroute(pattern);
  await screen.getByRole("button", "Plus", { exact: true }).tap();
  await screen.getByRole("menuitem", "Nouvelle version", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard\/estimates\/[^/]+\/edit$/);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  await expect(screen.getByText("Chargement en cours…", { exact: true })).toHaveCount(0);
  const versionId = new URL(await browser.url()).pathname.split("/")[3];
  ownEstimate(army, { projectId: estimate.projectId, versionId });
  expect((await readEstimate(browser, versionId)).version.project_id).toBe(estimate.projectId);
  await recordEvidence(army, "action-pending-recovery", { estimate, duplicatedVersionId: versionId, failedAttemptRecovered: true });
});
