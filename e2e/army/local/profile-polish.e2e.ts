import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open as openFile, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordEvidence } from "../critical/fixtures";
import { createLocalChatGptOwner, prepareChatGptServerWorkspace, warmChatGptServer } from "./chatgpt-server-support";

test("PFL01 profile preserves saved details, AI preferences and accessible account management", {
  tags: ["critical", "local", "profile"], session: "army", timeout: 300_000,
}, async ({ app, screen, browser }) => {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Profile writes require the owned local backend.");
  }
  const { client, userId, email } = await createLocalChatGptOwner();
  const membership = await client.from("tenant_memberships").select("tenant_id, tenants!inner(is_active)")
    .eq("user_id", userId).eq("tenants.is_active", true).order("is_default", { ascending: false }).order("created_at").limit(1).single();
  expect(membership.error).toBeNull();
  const directory = path.resolve(".private/chatgpt-local");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const storePath = path.join(directory, `${createHash("sha256").update(JSON.stringify([userId, membership.data!.tenant_id])).digest("hex")}.json`);
  const firstId = randomUUID();
  const secondId = randomUUID();
  const profile = (id: string, model: string, reasoningEffort: string, email: string) => ({ id, model, reasoningEffort, email,
    clientId: "army-profile-fixture", issuer: "https://auth.openai.com", subject: id, accessToken: "army-profile-fixture",
    refreshToken: "army-profile-fixture", expiresAt: Date.now() + 3_600_000, scopes: ["chatgpt.tokens.use.direct"] });
  const artifactRoot = path.resolve(".e2e/army/critical/artifacts");
  const instance = randomUUID();
  const control = path.join(artifactRoot, `profile-provider-control-${instance}.json`);
  const transportPath = path.join(artifactRoot, `profile-provider-${instance}.jsonl`);
  const setMode = (mode: string) => writeFile(control, JSON.stringify({ mode }));
  let server: ChildProcess | undefined;
  let storeCreated = false;
  let workspace: Awaited<ReturnType<typeof prepareChatGptServerWorkspace>> | undefined;
  let artifactDirectoryReady = false;
  const diagnostics: string[] = [];
  const prefix = `ARMY-profile-${Date.now()}`;
  const army = { runPrefix: prefix, projectName: prefix, ownedEstimates: [] };
  try {
    // Claim the path first: a pre-existing account must never be removed on EEXIST.
    const store = await openFile(storePath, "wx", 0o600);
    storeCreated = true;
    try {
      await store.writeFile(JSON.stringify({ selectedId: firstId, profiles: [
        profile(firstId, "gpt-6.1-terra", "max", "first@example.test"),
        profile(secondId, "gpt-6.1-sol", "low", "second@example.test"),
      ] }));
    } finally {
      await store.close();
    }
    await mkdir(artifactRoot, { recursive: true });
    artifactDirectoryReady = true;
    await setMode("normal");
    await writeFile(transportPath, "");
    const reservation = createServer();
    await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("Profile server port reservation failed.");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const origin = `http://127.0.0.1:${address.port}`;
    workspace = await prepareChatGptServerWorkspace();
    server = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(address.port), "--webpack"], {
      cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development", ...workspace.environment,
        MERGEONE_OPENAI_DECISIONS: "0", OPENAI_DECISIONS_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(path.resolve("e2e/army/local/profile-provider-fixture.mjs")).href}`,
        ARMY_PROFILE_PROVIDER_CONTROL: control, ARMY_PROFILE_PROVIDER_LOG: transportPath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    for (const stream of [server.stdout, server.stderr]) stream?.on("data", chunk => {
      diagnostics.push(String(chunk));
    });
    await expect.poll(async () => {
      if (server?.exitCode !== null) throw new Error("Profile fixture server exited before readiness.");
      return fetch(`${origin}/favicon.ico`).then(response => response.ok).catch(() => false);
    }, { timeout: 90_000 }).toBe(true);
    await workspace.assertReady();
    await warmChatGptServer(origin, email, "profile");
    // This journey uses its own loopback origin and the SDK's plain test fixture,
    // not armyTest. Confine browser traffic before loading the login page.
    await browser.route("**/*", async route => {
      const url = new URL(route.request.url);
      const method = route.request.method;
      if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && method === "GET") {
        await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
        return;
      }
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(method);
      const forbiddenMutation = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
      const appRequest = url.origin === origin && !forbiddenMutation;
      const authRequest = url.origin === backend.origin && (
        (url.pathname === "/auth/v1/token" && ["POST", "OPTIONS"].includes(method)) ||
        (url.pathname === "/auth/v1/user" && ["GET", "OPTIONS"].includes(method))
      );
      const ownProfile = url.origin === backend.origin && url.pathname === "/rest/v1/profiles" && (
        method === "OPTIONS" || (method === "PATCH" && url.searchParams.get("id") === `eq.${userId}`)
      );
      if (appRequest || authRequest || ownProfile) {
        await route.fallback();
        return;
      }
      await route.abort();
      throw new Error(`Profile campaign blocked ${method} ${url.hostname}; unexpected origin or mutation.`);
    });
    const open = (pathname = "/dashboard/profile") => app.open(new URL(pathname, origin).href);
    const account = { ...credentials.user("army"), username: email };
    await open("/login");
    await screen.getByRole("button", "Afficher le mot de passe", { exact: true }).tap();
    await expect(screen.getByRole("button", "Masquer le mot de passe", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Masquer le mot de passe", { exact: true }).tap();
    await screen.getByLabel("Email", { exact: true }).fill(account.username);
    await screen.getByLabel(/Mot de passe/).fill(account.password);
    const [loginResponse] = await Promise.all([
      browser.waitForResponse("**/auth/v1/token?grant_type=password"),
      screen.getByRole("button", "Se connecter", { exact: true }).tap(),
    ]);
    expect(loginResponse.status).toBe(200);
    await expect.poll(async () => (await browser.cookies()).some(cookie =>
      cookie.domain === "127.0.0.1" && cookie.name.startsWith("sb-") && cookie.name.includes("-auth-token"))).toBe(true);
    await browser.setViewport({ width: 1280, height: 900 });
    const actionPath = `${origin}/dashboard/profile`;
    // Observe the first two distinct Server Action fetches at their source. The
    // response URL is shared, so two simultaneous waitForResponse calls could
    // both resolve for one response. Leave URL, headers and request untouched.
    await browser.addInitScript(({ actionPath }) => {
      type Action = { sequence: number; status: number | null; contentType: string | null };
      const audit: { started: number; settled: Action[] } = { started: 0, settled: [] };
      (window as Window & { __armyProfileActions?: typeof audit }).__armyProfileActions = audit;
      const originalFetch = window.fetch;
      window.fetch = function (this: Window, input, init) {
        let isAction = false;
        try {
          const request = input instanceof Request ? input : null;
          const url = new URL(request?.url ?? String(input), window.location.href);
          const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
          const headers = new Headers(init?.headers ?? request?.headers);
          isAction = `${url.origin}${url.pathname}` === actionPath && method === "POST" && headers.has("next-action");
        } catch { /* Let the original fetch handle an invalid input. */ }
        const result = Reflect.apply(originalFetch, this, [input, init]) as Promise<Response>;
        if (!isAction || audit.started >= 2) return result;
        const sequence = ++audit.started;
        return result.then(response => {
          audit.settled.push({ sequence, status: response.status, contentType: response.headers.get("content-type") });
          return response;
        }, error => {
          audit.settled.push({ sequence, status: null, contentType: null });
          throw error;
        });
      };
    }, { actionPath });
    await open();
    const readActions = () => browser.evaluate(() => {
      const audit = (window as Window & { __armyProfileActions?: { started: number; settled: Array<{
        sequence: number; status: number | null; contentType: string | null;
      }> } }).__armyProfileActions;
      return audit ? { started: audit.started, settled: [...audit.settled].sort((a, b) => a.sequence - b.sequence) } : null;
    });
    await expect.poll(async () => (await readActions())?.settled.length ?? 0, { timeout: 30_000 }).toBe(2);
    const initialActions = await readActions();
    if (!initialActions) throw new Error("The initial profile-action observer is unavailable.");
    expect(initialActions.started).toBe(2);
    expect(initialActions.settled.map(response => response.status)).toEqual([200, 200]);
    await recordEvidence(army, "profile-initial-action", { actions: initialActions.settled,
      loginStatus: loginResponse.status, sessionCookiePresent: true,
      runtime: { E2E_ARMY: "1", developmentOutput: `.e2e/army/next-${workspace.id}/dev`, productionSmokeOutput: ".next" } });
    await expect(browser).toHaveURL(/\/dashboard\/profile$/);
    await expect(screen.getByRole("heading", "Mon profil", { exact: true })).toBeVisible();
    const model = screen.getByRole("combobox", "Modèle ChatGPT", { exact: true });
    const effort = screen.getByRole("combobox", "Effort de raisonnement", { exact: true });
    await expect(model).toHaveValue("gpt-6.1-terra");
    await expect(effort).toHaveValue("max");
    await expect(screen.getByText("Désactivé", { exact: true })).toBeVisible();
    const cleanDesktop = await app.screenshot("profile-clean-desktop");
    await browser.setViewport({ width: 390, height: 844 });
    const cleanMobile = await app.screenshot("profile-clean-mobile");
    await browser.setViewport({ width: 1280, height: 900 });

    const fields = { full_name: `${prefix} Responsable`, job_title: "Chargé d’affaires QA", phone: "0601020304", work_email: "profile@example.test" };
    await screen.getByRole("textbox", "Nom complet", { exact: false }).fill(fields.full_name);
    await screen.getByRole("textbox", "Fonction", { exact: true }).fill(fields.job_title);
    await screen.getByRole("textbox", "Téléphone", { exact: true }).fill(fields.phone);
    await screen.getByRole("textbox", "Email professionnel", { exact: true }).fill(fields.work_email);
    await screen.getByText("Aperçu sur les bons de commande", { exact: true }).click();
    const preview = screen.getByRole("region", "Aperçu sur les bons de commande", { exact: true });
    for (const value of Object.values(fields)) await expect(preview.getByText(value, { exact: true })).toBeVisible();
    const profileRoute = "**/rest/v1/profiles?*";
    await browser.route(profileRoute, async route => {
      if (route.request.method === "PATCH") {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "P0001", message: "PFL enregistrement refusé", details: null, hint: null }) });
      } else await route.fallback();
    });
    await screen.getByRole("button", "Enregistrer", { exact: true }).tap();
    await expect(screen.getByRole("alert").getByText("PFL enregistrement refusé", { exact: true })).toBeVisible();
    await expect(screen.getByRole("textbox", "Nom complet", { exact: false })).toHaveValue(fields.full_name);
    await browser.unroute(profileRoute);
    await screen.getByRole("button", "Enregistrer", { exact: true }).tap();
    await expect(screen.getByText("Profil mis à jour.", { exact: true })).toBeVisible();
    await open();
    for (const [label, value] of [["Nom complet", fields.full_name], ["Fonction", fields.job_title], ["Téléphone", fields.phone], ["Email professionnel", fields.work_email]]) {
      await expect(screen.getByRole("textbox", label, { exact: false })).toHaveValue(value);
    }
    const storedProfile = await client.from("profiles").select("full_name,job_title,phone,work_email").eq("id", userId).single();
    expect(storedProfile.error).toBeNull();
    expect(storedProfile.data).toMatchObject(fields);
    await expect(screen.getByRole("link", "Gérer les membres", { exact: true })).toHaveAttribute("href", "/dashboard/memberships");

    for (const [label, title] of [["À quoi servent mes informations ?", "Votre profil sur les documents"], ["À propos de l’email professionnel", "Email professionnel"], ["À propos du forfait ChatGPT", "Forfait ChatGPT dans MergeOne"], ["À propos du modèle ChatGPT", "Modèle ChatGPT"], ["À propos de l’effort de raisonnement", "Effort de raisonnement"]]) {
      const help = screen.getByRole("button", label, { exact: true });
      await help.focus();
      await help.press("Enter");
      await expect(screen.getByRole("button", `Fermer : ${title}`, { exact: true })).toBeVisible();
      await browser.keyboard.press("Escape");
      await expect(help).toBeFocused();
      await expect(help).toHaveAttribute("aria-expanded", "false");
    }
    await expect(effort).toHaveValue("max");
    await effort.selectOption({ value: "medium" });
    await expect(screen.getByText("Préférences ChatGPT enregistrées.", { exact: true })).toBeVisible();
    await open();
    await expect(model).toHaveValue("gpt-6.1-terra");
    await expect(effort).toHaveValue("medium");
    const manage = () => screen.getByText("Gestion des comptes", { exact: true }).click();
    await manage();
    const accounts = screen.getByRole("combobox", "Compte ChatGPT", { exact: true });
    await accounts.selectOption({ value: secondId });
    await expect(model).toHaveValue("gpt-6.1-sol");
    await expect(effort).toHaveValue("low");
    await accounts.selectOption({ value: firstId });
    await expect(model).toHaveValue("gpt-6.1-terra");
    await expect(effort).toHaveValue("medium");
    await model.selectOption({ value: "army-basic-model" });
    await expect(screen.getByText("Modèle enregistré. L’effort est revenu sur Automatique car le niveau précédent n’est pas proposé pour ce modèle.", { exact: true })).toBeVisible();
    await expect(effort).toHaveValue("auto");
    await model.selectOption({ value: "gpt-6.1-terra" });
    await expect(model).toBeEnabled();
    await effort.selectOption({ value: "max" });
    await expect(screen.getByText("Préférences ChatGPT enregistrées.", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Tester la connexion", { exact: true }).tap();
    await expect(screen.getByText("Connexion vérifiée avec gpt-6.1-terra. Cette vérification a utilisé votre forfait.", { exact: true })).toBeVisible();
    await setMode("connection-error");
    await screen.getByRole("button", "Tester la connexion", { exact: true }).tap();
    const connectionError = screen.getByRole("alert").getByText("ChatGPT limite les demandes. Réessayez plus tard ou consultez votre consommation dans Mon profil.", { exact: true });
    await expect(connectionError).toBeVisible();
    await manage();
    await expect(connectionError).toBeVisible();
    const errorScreenshot = await app.screenshot("profile-error-outside-account-details");
    await manage();
    await setMode("models-error");
    await screen.getByRole("button", "Actualiser les modèles", { exact: true }).tap();
    const modelsError = screen.getByRole("alert").getByText("ChatGPT n’a pas terminé la demande. Vérifiez la connexion dans Mon profil.", { exact: true });
    await expect(modelsError).toBeVisible();
    await expect(model).toHaveValue("gpt-6.1-terra");
    await expect(effort).toHaveValue("max");
    await setMode("normal");
    await screen.getByRole("button", "Actualiser les modèles", { exact: true }).tap();
    await expect(model).toBeEnabled();
    await expect(screen.getByRole("link", "Gérer ma consommation", { exact: true })).toHaveAttribute("href", "https://chatgpt.com/settings/usage");

    let declined = 0;
    await browser.route("https://auth.openai.com/**", async route => {
      const url = new URL(route.request.url);
      expect(url.pathname).toBe("/api/accounts/authorize");
      const callback = new URL(url.searchParams.get("redirect_uri")!);
      callback.search = new URLSearchParams({ error: "access_denied", state: url.searchParams.get("state")! }).toString();
      declined += 1;
      await route.fulfill({ status: 302, headers: { location: callback.href }, body: "" });
    });
    for (const button of ["Ajouter un compte", "Reconnecter ChatGPT"]) {
      await screen.getByRole("button", button, { exact: true }).tap();
      await expect(screen.getByRole("alert").getByText("Vous avez annulé la connexion ChatGPT. Vous pouvez la relancer.", { exact: true })).toBeVisible();
      await expect(model).toHaveValue("gpt-6.1-terra");
      await expect(effort).toHaveValue("max");
      await manage();
    }
    expect(declined).toBe(2);
    const desktop = await app.screenshot("profile-desktop-controls");
    await browser.setViewport({ width: 390, height: 844 });
    const help = screen.getByRole("button", "À propos de l’effort de raisonnement", { exact: true });
    await help.tap();
    await expect(screen.getByRole("button", "Fermer : Effort de raisonnement", { exact: true })).toBeVisible();
    const layout = await browser.evaluate(() => {
      const rect = document.querySelector('[data-slot="popover-content"]')!.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
    });
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.right).toBeLessThanOrEqual(layout.width);
    expect(layout.top).toBeGreaterThanOrEqual(0);
    expect(layout.bottom).toBeLessThanOrEqual(layout.height);
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 1);
    const mobile = await app.screenshot("profile-mobile-help");
    await screen.getByRole("button", "Fermer : Effort de raisonnement", { exact: true }).tap();
    await expect(help).toBeFocused();
    await help.tap();
    await screen.getByRole("heading", "Mon profil", { exact: true }).click();
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await screen.getByRole("button", "À propos du classement IA", { exact: true }).tap();
    await expect(screen.getByText("Cet accès API est distinct du forfait ChatGPT. Il est configuré sur le serveur et consomme son propre budget API. Connecter votre forfait ne l’active pas.", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Fermer : Classement et priorités IA", { exact: true }).tap();
    await expect(screen.getByText("Désactivé", { exact: true })).toBeVisible();
    await setMode("revocation-error");
    await screen.getByRole("button", "Déconnecter ChatGPT", { exact: true }).tap();
    await expect(screen.getByText("Connexion supprimée de ce Mac. La révocation distante n’a pas pu être confirmée : déconnectez aussi MergeOne dans les paramètres de sécurité ChatGPT.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Continue with ChatGPT", { exact: true })).toBeVisible();
    const stored = JSON.parse(await readFile(storePath, "utf8"));
    expect(stored.selectedId).toBeNull();
    expect(stored.profiles.find((item: { id: string }) => item.id === firstId).accessToken).toBeUndefined();
    expect(stored.profiles.find((item: { id: string }) => item.id === secondId).accessToken).toBe("army-profile-fixture");
    const transport = (await readFile(transportPath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(transport.filter(item => item.operation === "forbidden")).toEqual([]);
    expect(transport.filter(item => item.operation === "connection")).toEqual([
      { provider: "profile-fixture", operation: "connection", model: "gpt-6.1-terra", reasoningEffort: "max", injectedFailure: false },
      { provider: "profile-fixture", operation: "connection", model: "gpt-6.1-terra", reasoningEffort: "max", injectedFailure: true },
    ]);
    await recordEvidence(army, "profile-polish", { professional: storedProfile.data, initialPreferences: { model: "gpt-6.1-terra", reasoningEffort: "max" },
      reloadedPreferences: { model: "gpt-6.1-terra", reasoningEffort: "medium" }, accountSwitch: true, oauthDeclined: declined,
      disconnectedFixture: true, errorVisibleWithAccountDetailsClosed: true, layout, cleanDesktop, cleanMobile, desktop, mobile, errorScreenshot, transport,
      inference: "simulated only; no real provider request", canonicalProfileTouched: false });
  } catch (error) {
    if (server) {
      try {
        const pathname = await browser.evaluate(() => location.pathname);
        const screenshot = pathname === "/dashboard/profile" ? await app.screenshot("profile-before-server-cleanup") : null;
        const observed = await browser.evaluate(() => ({ readyState: document.readyState,
          statuses: [...document.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent),
          selectLabels: [...document.querySelectorAll("label")].map(node => node.textContent) }));
        await recordEvidence(army, "profile-before-cleanup", { observed, screenshot });
      } catch {
        console.warn("Profile failure diagnostics unavailable; preserving the original error.");
      }
    }
    throw error;
  } finally {
    try {
      if (server?.pid && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise<void>(resolve => server!.once("exit", () => resolve()));
        server.kill("SIGTERM");
        await exited;
      }
    } finally {
      try {
        if (storeCreated) await rm(storePath, { force: true });
        await workspace?.cleanup();
      } finally {
        if (artifactDirectoryReady) {
          await rm(control, { force: true });
          await writeFile(path.join(artifactRoot, "profile-local-server.log"), diagnostics.join("")
            .replace(/([?&](?:state|code|access_token|id_token)=)[^&\s]+/g, "$1[redacted]")
            .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted-token]")
            .replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]")
            .replace(/(cookie["']?\s*[:=]\s*)[^\r\n]+/gi, "$1[redacted]"));
        }
      }
    }
  }
});
