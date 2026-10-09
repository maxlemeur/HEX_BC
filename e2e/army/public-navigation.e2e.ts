import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";

beforeEach(async ({ app, browser }) => {
  const origin = new URL(app.baseUrl!).origin;
  await browser.route("**/*", async (route) => {
    const requestUrl = new URL(route.request.url);
    if (requestUrl.hostname === "api.fontshare.com" && requestUrl.pathname === "/v2/css" &&
      route.request.method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    if (
      requestUrl.origin !== origin ||
      !["GET", "HEAD", "OPTIONS"].includes(route.request.method)
    ) {
      await route.abort();
      throw new Error("Anonymous pilot blocked an external or non-read HTTP request.");
    }
    await route.continue();
  });
});

test(
  "agent follows public signup and login links without submitting forms",
  { tags: ["agent", "anonymous"], requires: ["browser"], timeout: 120_000 },
  async ({ app, agent, screen, browser }) => {
    await app.open("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
    await agent.act(
      "Open the signup page using the visible Créer un compte link. Do not enter any data or submit a form.",
      { maxSteps: 6, maxModelCalls: 6, timeout: 45_000 }
    );
    await expect(browser).toHaveURL("/signup");
    await expect(screen.getByRole("heading", "Créer un compte", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Créer le compte", { exact: true })).toBeVisible();

    await agent.act(
      "Return to the login page using the visible Se connecter link. Do not enter any data or submit a form.",
      { maxSteps: 6, maxModelCalls: 6, timeout: 45_000 }
    );
    await expect(browser).toHaveURL("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
    await expect(screen.getByLabel("Email", { exact: true })).toHaveValue("");
    // Password values are deliberately never read by the runner.
    await expect(screen.getByLabel(/Mot de passe/)).toBeVisible();
    await app.screenshot("anonymous-navigation-returned");
  }
);
