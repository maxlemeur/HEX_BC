import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, ownEstimate, recordEvidence } from "./fixtures";

// An open, idle editor reads its affaire's DPGF source once. Measured on 29/10/2026: in the
// production build the effect that reads it ran again after every response, about a dozen
// requests per second for as long as the editor stayed open. Only a production build shows it.
armyTest(
  "an idle estimate editor reads the affaire DPGF source once",
  { session: "army", tags: ["critical"], timeout: 120_000 },
  async ({ app, screen, browser, army }) => {
    const ids = await createEstimateViaWizard({ app, screen, browser }, {
      projectName: army.projectName, title: "ARMY idle editor",
    }, army);
    ownEstimate(army, ids);
    const sourceReads: number[] = [];
    await browser.route("**/api/affaires/*/dpgf-source", async (route) => {
      sourceReads.push(Date.now());
      await route.fallback();
    });
    await browser.reload();
    await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
    await expect.poll(() => sourceReads.length, { timeout: 30_000 }).toBeGreaterThan(0);
    const idleWindowMs = 8_000;
    await new Promise((resolve) => setTimeout(resolve, idleWindowMs));
    await recordEvidence(army, "editor-idle-requests", { ...ids, idleWindowMs, dpgfSourceReads: sourceReads.length });
    expect(sourceReads).toHaveLength(1);
  }
);
