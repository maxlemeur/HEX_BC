import { randomUUID } from "node:crypto";

import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordEvidence, restrictCriticalBrowser, type ArmyState } from "./fixtures";

// A hydrated rejection must be visible without a native form submission or a
// second authentication attempt. Only a synthetic, intercepted account is used.
test("AUTH01 a hydrated authentication rejection stays visible without restarting login", {
  tags: ["critical", "anonymous", "auth-rejection"], requires: ["browser"], timeout: 90_000,
}, async ({ app, browser, screen }) => {
  const prefix = `ARMY-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const army: ArmyState = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  const origin = new URL(app.baseUrl!).origin;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  let authRequests = 0;
  let nativeSubmissions = 0;
  await restrictCriticalBrowser(browser, app);
  await browser.route("**/auth/v1/token*", async route => {
    const url = new URL(route.request.url);
    if (url.origin !== backend.origin || url.pathname !== "/auth/v1/token") {
      await route.abort();
      throw new Error("Synthetic rejection must stay on the configured backend route.");
    }
    const headers = { "access-control-allow-origin": origin, "access-control-allow-headers": "*", "content-type": "application/json" };
    if (route.request.method === "OPTIONS") await route.fulfill({ status: 204, headers, body: "" });
    else {
      expect(route.request.method).toBe("POST");
      authRequests += 1;
      await route.fulfill({ status: 400, headers, body: JSON.stringify({ code: "invalid_credentials", message: "Invalid login credentials" }) });
    }
  });
  await browser.route("**/login*", async route => {
    const url = new URL(route.request.url);
    if (url.origin === origin && url.pathname === "/login" && route.request.method === "POST") nativeSubmissions += 1;
    await route.fallback();
  });
  try {
    await app.open("/login");
    const show = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
    const hide = screen.getByRole("button", "Masquer le mot de passe", { exact: true });
    await expect.poll(async () => {
      if (await hide.isVisible()) return true;
      if (await show.isVisible()) await show.click();
      return hide.isVisible();
    }, { timeout: 30_000 }).toBe(true);
    await hide.click();
    await expect(screen.getByLabel(/Mot de passe/)).toBeVisible();
    await expect(screen.getByLabel(/Mot de passe/)).toBeEnabled();
    const account = credentials.user("prehydration");
    await screen.getByLabel("Email", { exact: true }).fill(account.username);
    await screen.getByLabel(/Mot de passe/).fill(account.password);
    const submit = screen.getByRole("button", "Se connecter", { exact: true });
    await submit.click();
    await expect(screen.getByRole("alert").filter({ hasText: "Email ou mot de passe incorrect." }))
      .toHaveText("Email ou mot de passe incorrect.");
    await expect(submit).toBeEnabled();
    expect(authRequests).toBe(1);
    expect(nativeSubmissions).toBe(0);
    expect(new URL(await browser.url()).pathname).toBe("/login");
    expect(new URL(await browser.url()).search).toBe("");
    await expect(show).toBeVisible();
  } finally {
    await recordEvidence(army, "hydrated-auth-rejection", { authRequests, nativeSubmissions, realAuthRequests: 0, expected: { authRequests: 1, nativeSubmissions: 0 } });
  }
});
