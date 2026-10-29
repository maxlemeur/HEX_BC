import { beforeEach, test } from "@e2e-dev/web";
import { expect } from "e2e";

beforeEach(async ({ app, browser }) => {
  const origin = new URL(app.baseUrl!).origin;
  await browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    if (url.hostname === "api.fontshare.com" && route.request.method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    if (url.origin !== origin || !["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
      await route.abort();
      throw new Error("Public policy journey permits only anonymous read requests.");
    }
    await route.continue();
  });
});

test(
  "public MergeOne pages explain Drive permissions and data deletion without login",
  { tags: ["smoke", "anonymous"], requires: ["browser"] },
  async ({ app, screen, browser }) => {
    await app.open("/");
    await expect(screen.getByRole("heading", "Vos affaires, du dossier au devis.", { exact: true })).toBeVisible();
    await screen.getByRole("link", "Confidentialité", { exact: true }).tap();
    await expect(browser).toHaveURL("/confidentialite");
    await expect(screen.getByRole("heading", "Politique de confidentialité", { exact: true })).toBeVisible();
    await expect(screen.getByText("drive.readonly", { exact: true })).toBeVisible();
    await expect(screen.getByText("drive.file", { exact: true })).toBeVisible();
    await expect(screen.getByRole("heading", "Analyses assistées par IA", { exact: true })).toBeVisible();
    await expect(screen.getByRole("link", "thannous@gmail.com", { exact: true })).toHaveAttribute("href", "mailto:thannous@gmail.com");

    await screen.getByRole("link", "Conditions d’utilisation", { exact: true }).tap();
    await expect(browser).toHaveURL("/conditions");
    await expect(screen.getByRole("heading", "Conditions d’utilisation", { exact: true })).toBeVisible();
    await screen.getByRole("link", "Suppression des données", { exact: true }).tap();
    await expect(browser).toHaveURL("/suppression-des-donnees");
    await expect(screen.getByRole("heading", "Supprimer vos données ou déconnecter Drive", { exact: true })).toBeVisible();
    await expect(screen.getByRole("link", "Demander la suppression de mes données", { exact: true })).toHaveAttribute("href", /mailto:thannous@gmail.com/);

    await app.open("/login");
    await screen.getByRole("link", "Confidentialité", { exact: true }).tap();
    await expect(browser).toHaveURL("/confidentialite");
    await app.open("/signup");
    await screen.getByRole("link", "Conditions d’utilisation", { exact: true }).tap();
    await expect(browser).toHaveURL("/conditions");
    await app.screenshot("public-google-policies-accessible");
  },
);
