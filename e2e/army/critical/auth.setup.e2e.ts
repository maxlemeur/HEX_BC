import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordEvidence, restrictCriticalBrowser } from "./fixtures";

test.setup(
  "authenticate the existing E2E account without provisioning memberships",
  { sessions: ["army"], tags: ["critical", "performance"], timeout: 90_000 },
  async ({ app, browser, screen, session }) => {
    await restrictCriticalBrowser(browser, app);
    const account = credentials.user("army");
    await app.open("/login");
    // Rendering the form does not prove that React has attached onSubmit.
    const showPassword = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
    const hidePassword = screen.getByRole("button", "Masquer le mot de passe", { exact: true });
    try {
      await expect.poll(async () => {
        if (await hidePassword.isVisible()) return true;
        if (await showPassword.isVisible()) await showPassword.tap();
        return await hidePassword.isVisible();
      }, { timeout: 30_000 }).toBe(true);
    } catch (error) {
      const diagnostics = await browser.evaluate(async () => {
        const scripts = Array.from(document.querySelectorAll<HTMLScriptElement>("script[src]"))
          .filter((script) => new URL(script.src).origin === location.origin);
        const responses = [];
        for (const script of scripts.slice(0, 12)) {
          const url = new URL(script.src);
          const response = await fetch(script.src);
          responses.push({ path: url.pathname, status: response.status, contentType: response.headers.get("content-type") });
        }
        const form = document.querySelector("form");
        const button = document.querySelector('button[aria-controls="password"]');
        return {
          readyState: document.readyState,
          scriptResponses: responses,
          formOpacity: form ? getComputedStyle(form).opacity : null,
          toggleReactAttached: button ? Object.keys(button).some((key) => key.startsWith("__reactProps")) : false,
        };
      });
      const prefix = `ARMY-${Date.now()}-auth-probe`;
      await recordEvidence({ runPrefix: prefix, projectName: prefix, ownedEstimates: [] }, "auth-hydration", diagnostics);
      throw error;
    }
    await hidePassword.tap();
    await expect(showPassword).toBeVisible();
    await screen.getByLabel("Email", { exact: true }).fill(account.username);
    await screen.getByLabel(/Mot de passe/).fill(account.password);
    await screen.getByRole("button", "Se connecter", { exact: true }).tap();
    await expect(browser).toHaveURL(/\/dashboard(?:\/.*)?$/, { timeout: 45_000 });
    // Verify membership without recording the existing business records.
    const access = await browser.evaluate(async () => {
      const response = await fetch("/api/estimates", { credentials: "same-origin" });
      return { status: response.status };
    });
    expect(access.status).toBe(200);
    await session.save("army");
  }
);
