import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";
import { PDFDocument } from "pdf-lib";
import { armyTest, recordEvidence } from "../critical/fixtures";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { seedPublishedItemTable } from "../takeoff/item-table-support";

async function restrictToReads(browser: Browser, alreadyReconciledUrl?: string) {
  await browser.route("**/*", async (route) => {
    // The hub reconciles plans on mount. The review fixture already has its sealed plan.
    if (route.request.method === "POST" && route.request.url === alreadyReconciledUrl) {
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: { changed: false } }),
      });
      return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
      await route.abort();
      throw new Error("Exploration attempted a business mutation.");
    }
    await route.fallback();
  });
}

// These goals explore discoverability with the existing ChatGPT subscription.
// Exact assertions pin every outcome. Deterministic release checks do not
// depend on a model or on this local authenticated subscription.
for (const persona of [
  { name: "estimator", goal: "Ouvrir la liste des affaires", path: "/dashboard/affaires", heading: "Affaires" },
  { name: "purchaser", goal: "Ouvrir le catalogue de produits et prix de référence", path: "/dashboard/products", heading: "Produits & prix de référence" },
] as const) {
  armyTest(`EXP ${persona.name} discovers its business entry from the dashboard`, {
    session: "army", agent: persona.name, tags: ["agent", "exploration"], trace: "off", timeout: 180_000,
  }, async ({ app, browser, screen, agent, army }) => {
    await restrictToReads(browser);
    await app.open("/dashboard");
    await agent.act(persona.goal);
    await expect(browser).toHaveURL(persona.path);
    await expect(screen.getByRole("heading", persona.heading, { level: 1, exact: true })).toBeVisible();
    await recordEvidence(army, `exploration-${persona.name}`, { persona: persona.name, path: persona.path, exactHeading: persona.heading, mutationScope: "read-only" });
  });
}

armyTest("EXP reviewer finds the named affaire and opens the measured poste on its plan", {
  session: "army", agent: "reviewer", tags: ["agent", "exploration"], trace: "off", timeout: 180_000,
}, async ({ app, browser, screen, agent, army }) => {
  const affaire = "École des Tilleuls – rénovation sanitaire";
  const poste = "Vanne DN32";
  const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "EXPREV" });
  const plan = await PDFDocument.create();
  for (let page = 1; page <= 9; page += 1) {
    plan.addPage([595, 842]).drawText(`Plan sanitaire fictif – page ${page}`, { x: 60, y: 760, size: 18 });
  }
  const fixture = await seedPublishedItemTable(owner, {
    name: affaire,
    labels: ["Vanne DN25", poste],
    answers: ["measured", "measured"],
    planPdf: Buffer.from(await plan.save()),
  });
  const affairePath = `/dashboard/affaires/${fixture.projectId}`;
  const posteId = fixture.itemIds[1];
  const reconciliation = new URL(`/api/affaires/${fixture.projectId}/intake/reconcile-plans`, app.baseUrl).href;

  await restrictToReads(browser, reconciliation);
  await app.open("/dashboard");
  await agent.act("Retrouver et ouvrir l’affaire {affaire} depuis le tableau de bord.", {
    params: { affaire }, timeout: 60_000,
  });
  await browser.waitForURL(affairePath);

  await agent.act("Ouvrir le détail sur le plan du poste de métré {poste} de cette affaire.", {
    params: { poste }, timeout: 60_000,
  });

  const evidence = screen.getByRole("complementary", "Preuve et décisions du poste", { exact: true });
  await expect(evidence.getByRole("heading", poste, { exact: true })).toBeVisible();
  await expect(evidence).toContainText("Mesuré · 1 u");
  await expect(screen.getByRole("img", "plan-1.pdf, page 2", { exact: true })).toBeVisible({ timeout: 30_000 });
  const destination = new URL(await browser.url());
  expect(destination.pathname).toBe(`${affairePath}/takeoff`);
  expect(destination.searchParams.get("poste")).toBe(posteId);
  await agent.assert(
    "Sur cet écran, le plan et la preuve du poste sont-ils présentés assez clairement pour que le relecteur comprenne d’où vient la mesure ?",
    { vision: true, timeout: 45_000 },
  );
  await recordEvidence(army, "exploration-reviewer", {
    persona: "reviewer", affaire, projectId: fixture.projectId, poste, posteId,
    plan: "plan-1.pdf", page: 2, mutationScope: "read-only", planReconciliation: "browser-noop",
  });
});
