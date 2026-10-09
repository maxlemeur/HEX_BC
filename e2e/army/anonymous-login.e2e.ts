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
  "anonymous dashboard access redirects to the hydrated login form",
  { tags: ["smoke", "anonymous"], requires: ["browser"] },
  async ({ app, screen, browser }) => {
    await app.open("/dashboard/affaires");
    await expect(browser).toHaveURL("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();

    const email = screen.getByLabel("Email", { exact: true });
    // The wrapping password label includes the visibility button's text.
    const password = screen.getByLabel(/Mot de passe/);
    await expect(email).toBeVisible();
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("required");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(password).toBeVisible();
    await expect(password).toBeEnabled();
    await expect(screen.getByRole("button", "Se connecter", { exact: true })).toBeEnabled();

    const show = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
    await expect(show).toHaveAttribute("aria-controls", "password");
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await show.tap();
    const hide = screen.getByRole("button", "Masquer le mot de passe", { exact: true });
    await expect(hide).toHaveAttribute("aria-pressed", "true");
    await hide.tap();
    await expect(show).toHaveAttribute("aria-pressed", "false");
    await expect(browser).toHaveURL("/login");
    await app.screenshot("anonymous-login-hydrated");
  }
);
