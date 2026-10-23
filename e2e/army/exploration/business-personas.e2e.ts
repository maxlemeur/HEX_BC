import { expect } from "e2e";
import { armyTest, recordEvidence } from "../critical/fixtures";

// These goals explore discoverability with the existing ChatGPT subscription.
// Exact assertions pin every outcome. Deterministic release checks do not
// depend on a model or on this local authenticated subscription.
for (const persona of [
  { name: "estimator", goal: "Ouvrir la liste des affaires", path: "/dashboard/affaires", heading: "Affaires" },
  { name: "purchaser", goal: "Ouvrir le catalogue de produits et prix de référence", path: "/dashboard/products", heading: "Produits & prix de référence" },
  { name: "reviewer", goal: "Ouvrir la liste des métrés et analyses de plans", path: "/dashboard/takeoff", heading: "Métrés — Analyse de plans" },
] as const) {
  armyTest(`EXP ${persona.name} discovers its business entry from the dashboard`, {
    session: "army", agent: persona.name, tags: ["agent", "exploration"], trace: "off", timeout: 180_000,
  }, async ({ app, browser, screen, agent, army }) => {
    await app.open("/dashboard");
    // The setup has finished: these personas may navigate and read only.
    // Enforce it at the browser boundary as well as in their instructions.
    await browser.route("**/*", async (route) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
        await route.abort();
        throw new Error("Exploration attempted a business mutation.");
      }
      await route.fallback();
    });
    await agent.act(persona.goal);
    await expect(browser).toHaveURL(persona.path);
    await expect(screen.getByRole("heading", persona.heading, { level: 1, exact: true })).toBeVisible();
    await recordEvidence(army, `exploration-${persona.name}`, { persona: persona.name, path: persona.path, exactHeading: persona.heading, mutationScope: "read-only" });
  });
}
