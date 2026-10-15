import { randomUUID } from "node:crypto";

import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordEvidence, restrictCriticalBrowser, type ArmyState } from "./fixtures";

for (const page of ["login", "signup"] as const) {
  test(
    `${page} pre-hydration submission keeps credentials out of the URL`,
    { tags: ["critical", "anonymous", "prehydration"], requires: ["browser"] },
    async ({ app, browser, screen }) => {
      const prefix = `ARMY-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const army: ArmyState = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
      const origin = new URL(app.baseUrl!).origin;
      const submissions: Array<{ method: string; queryKeys: string[] }> = [];
      await restrictCriticalBrowser(browser, app);
      await browser.route("**/auth/v1/**", async (route) => {
        await route.abort();
        throw new Error("Synthetic pre-hydration credentials must never reach Supabase.");
      });
      await browser.route("**/_next/static/**", async (route) => {
        const url = new URL(route.request.url);
        if (url.origin === origin && url.pathname.endsWith(".js")) {
          await route.fulfill({ headers: { "content-type": "application/javascript" }, body: "" });
        } else {
          // fallback(), not continue(): the campaign guard registered first must still decide.
          await route.fallback();
        }
      });
      await browser.route(`**/${page}*`, async (route) => {
        const url = new URL(route.request.url);
        if (url.origin !== origin) {
          await route.abort();
          throw new Error("Synthetic credentials must stay on the owned loopback app.");
        }
        if (url.origin === origin && url.pathname === `/${page}`) {
          submissions.push({ method: route.request.method, queryKeys: [...url.searchParams.keys()] });
        }
        await route.fallback();
      });
      try {
        await app.open(`/${page}`);
        const account = credentials.user("prehydration");
        await screen.getByLabel("Email", { exact: true }).fill(account.username);
        await screen.getByLabel(/Mot de passe/).fill(account.password);
        // Discard the initial page load; the next real document request is the form.
        submissions.length = 0;
        const [response] = await Promise.all([
          browser.waitForResponse(`**/${page}*`, { timeout: 20_000 }),
          screen.getByRole("button", page === "login" ? "Se connecter" : "Créer le compte", { exact: true }).tap(),
        ]);
        const actual = submissions.at(-1);
        await recordEvidence(army, `${page}-prehydration`, {
          scripts: "Next JavaScript responses withheld",
          credentials: "synthetic non-account fixture; Auth traffic blocked",
          responseStatus: response.status,
          submissions,
          expected: { method: "POST", queryKeys: [] },
        });
        expect(actual).toEqual({ method: "POST", queryKeys: [] });
        const resultingUrl = new URL(await browser.url());
        expect(resultingUrl.origin).toBe(origin);
        expect([...resultingUrl.searchParams.keys()]).toEqual([]);
      } finally {
        await recordEvidence(army, `${page}-prehydration-fixture`, { submissions, realAccountsUsed: false, authRequestsAllowed: false });
      }
    }
  );
}
