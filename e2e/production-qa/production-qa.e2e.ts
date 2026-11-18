import { describe, test } from "@e2e-dev/web";
import { credentials, expect, secrets } from "e2e";

import { authTokenUrl, origin, qaTenantId } from "../../e2e-production-qa.config.ts";

describe("Read-only production QA", () => {
  test("opens the new estimate form as the dedicated QA tenant admin", async ({ app, browser, screen }) => {
    let canSubmitLogin = false;
    await browser.route("**/*", async (route) => {
      const { url, method, headers } = route.request;
      if (url === authTokenUrl && headers.origin === origin) {
        if (method === "OPTIONS") {
          await route.fallback();
          return;
        }
        if (method === "POST" && canSubmitLogin) {
          canSubmitLogin = false;
          // Do not replay a credential-bearing POST across a redirect.
          const response = await route.fetch();
          if (response.status >= 300 && response.status < 400) {
            await route.abort();
            return;
          }
          // The fetched body is decoded. Let Chromium derive its new length.
          const responseHeaders = { ...response.headers };
          delete responseHeaders["content-encoding"];
          delete responseHeaders["content-length"];
          await route.fulfill({
            status: response.status,
            headers: responseHeaders,
            body: await response.body(),
          });
          return;
        }
      }
      if (new URL(url).origin === origin && (method === "GET" || method === "HEAD")) {
        await route.fallback();
        return;
      }
      await route.abort();
    });

    await app.open("/login").catch(() => { throw new Error("QA_LOGIN"); });
    if (await browser.url() !== `${origin}/login`) throw new Error("QA_ORIGIN");

    let loginStatus: number;
    try {
      await expect(screen.getByRole("button", "Afficher le mot de passe", { exact: true })).toBeEnabled();
      if (await browser.url() !== `${origin}/login`) throw new Error("QA_ORIGIN");
      await screen.getByLabel("Email", { exact: true }).fill(secrets.get("qaEmail"));
      await screen.getByLabel(/Mot de passe/).fill(credentials.user("qa").password);
      if (await browser.url() !== `${origin}/login`) throw new Error("QA_ORIGIN");
      canSubmitLogin = true;
      const [response] = await Promise.all([
        browser.waitForResponse(authTokenUrl, { timeout: 20_000 }),
        screen.getByRole("button", "Se connecter", { exact: true }).tap(),
      ]);
      loginStatus = response.status;
    } catch (error) {
      if (error instanceof Error && error.message === "QA_ORIGIN") throw error;
      throw new Error("QA_LOGIN");
    } finally {
      canSubmitLogin = false;
    }
    if (loginStatus === 400 || loginStatus === 401) {
      // Auth error copy is rendered asynchronously.
      await screen.getByText("Email ou mot de passe incorrect.", { exact: true }).waitFor({ timeout: 3_000 })
        .catch(() => { throw new Error("QA_LOGIN"); });
      throw new Error("QA_LOGIN_REJECTED");
    }
    if (loginStatus !== 200) throw new Error("QA_LOGIN");
    await browser.waitForURL(`${origin}/dashboard`, { timeout: 20_000 }).catch(() => { throw new Error("QA_LOGIN"); });

    const membership = await browser.evaluate(async (expectedTenantId) => {
      try {
        const response = await fetch("/api/tenants/memberships", {
          cache: "no-store",
          redirect: "error",
        });
        if (response.status === 401) return "QA_LOGIN";
        if (response.status === 403) return "QA_ROLE";
        if (!response.ok) return "QA_MEMBERSHIP";
        const { ok, data }: {
          ok?: boolean;
          data?: {
            tenant?: { id?: string };
            current_membership_id?: string;
            current_user_id?: string;
            memberships?: { id: string; user_id: string; role: string }[];
          };
        } = await response.json();
        if (!ok || !data) return "QA_MEMBERSHIP";
        if (data.tenant?.id !== expectedTenantId) return "QA_TENANT";
        if (!data.current_membership_id || !data.current_user_id) return "QA_MEMBERSHIP";
        const current = Array.isArray(data.memberships) && data.memberships.find((entry) =>
          entry.id === data.current_membership_id && entry.user_id === data.current_user_id);
        return current && current.role === "admin" ? "verified" : "QA_ROLE";
      } catch {
        return "QA_MEMBERSHIP";
      }
    }, qaTenantId);
    if (membership !== "verified") throw new Error(membership);

    try {
      await app.open("/dashboard/estimates/new");
      await expect(browser).toHaveURL(`${origin}/dashboard/estimates/new`);
      await expect(screen.getByRole("heading", "Nouveau chiffrage", { exact: true })).toBeVisible();
      const projectName = screen.getByLabel(/^Nom du projet/);
      await expect(projectName).toBeVisible();
      await expect(projectName).toBeEnabled();
      await expect(projectName).not.toHaveAttribute("readonly");
      await expect(screen.getByRole("button", "Suivant", { exact: true })).toBeEnabled();
    } catch {
      throw new Error("QA_ESTIMATE");
    }
  });
});
