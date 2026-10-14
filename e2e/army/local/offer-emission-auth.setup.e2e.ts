import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordOfferEvidence, restrictOfferBrowser } from "./offer-emission-fixtures";

test.setup("ordinary native ARMY login for local offer profile", { sessions: ["army"], tags: ["offer-emission"], trace: "off", timeout: 90_000 }, async ({ app, browser, screen, session }) => {
  await restrictOfferBrowser(browser, app);
  const account = credentials.user("army");
  await app.open("/login");
  const show = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  const hide = screen.getByRole("button", "Masquer le mot de passe", { exact: true });
  try {
    await expect.poll(async () => {
      if (await hide.isVisible()) return true;
      if (await show.isVisible()) await show.tap();
      return await hide.isVisible();
    }, { timeout: 30_000 }).toBe(true);
  } catch (error) {
    const diagnostics = await browser.evaluate(() => ({ readyState: document.readyState, heading: document.querySelector("h1")?.textContent ?? null, scriptCount: document.querySelectorAll("script[src]").length, toggleAttached: Object.keys(document.querySelector('button[aria-controls="password"]') ?? {}).some((key) => key.startsWith("__reactProps")) }));
    const prefix = `ARMY-OFFER-${Date.now()}-auth`;
    await recordOfferEvidence({ runPrefix: prefix, projectName: prefix, ownedEstimates: [] }, "auth-hydration-missing-proof", diagnostics);
    throw error;
  }
  await hide.tap();
  await expect(show).toBeVisible();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard(?:\/.*)?$/, { timeout: 45_000 });
  const access = await browser.evaluate(async () => ({ status: (await fetch("/api/estimates", { credentials: "same-origin" })).status }));
  expect(access.status).toBe(200);
  await session.save("army");
});
