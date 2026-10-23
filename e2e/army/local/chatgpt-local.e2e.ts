import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, beforeAll, test } from "@e2e-dev/web";
import { credentials, expect } from "e2e";

import { recordEvidence } from "../critical/fixtures";

let localServer: ChildProcess;
let localOrigin: string;
const diagnostics: string[] = [];

beforeAll(async () => {
  // Use the campaign's disposable local backend, never ambient .env credentials.
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(backend.hostname)) throw new Error("Local backend required.");
  const reservation = createServer();
  await new Promise<void>((resolve, reject) => { reservation.once("error", reject); reservation.listen(0, "127.0.0.1", resolve); });
  const address = reservation.address();
  if (!address || typeof address === "string") throw new Error("Port reservation failed.");
  const port = address.port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  localOrigin = `http://127.0.0.1:${port}`;
  localServer = spawn(process.execPath, ["scripts/dev-chatgpt-local.mjs", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, CI: "", VERCEL: "", NODE_ENV: "development", E2E_ARMY_SERVER_MODE: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [localServer.stdout, localServer.stderr]) stream?.on("data", (chunk) => {
    diagnostics.push(String(chunk).replace(/code=[^&\s]+/g, "code=[redacted]"));
    if (diagnostics.length > 100) diagnostics.shift();
  });
  await expect.poll(async () => {
    if (localServer.exitCode !== null) throw new Error("ChatGPT local server exited before readiness.");
    return fetch(`${localOrigin}/login`).then((response) => response.ok).catch(() => false);
  }, { timeout: 90_000 }).toBe(true);
});

afterAll(async () => {
  if (localServer && localServer.exitCode === null) {
    localServer.kill("SIGTERM");
    await new Promise<void>((resolve) => localServer.once("exit", () => resolve()));
  }
});

test("ChatGPT local: profile starts PKCE authorization and recovers from declined consent", {
  tags: ["critical", "local", "chatgpt"], session: "army", timeout: 180_000,
}, async ({ app, screen, browser }) => {
  const account = credentials.user("army");
  let authorization: { host: string; clientId: string | null; challengeMethod: string | null; planScope: boolean } | null = null;
  await browser.route("https://auth.openai.com/**", async (route) => {
    // This is an injected consent refusal, not evidence of live ChatGPT sign-in.
    const url = new URL(route.request.url);
    authorization = { host: url.hostname, clientId: url.searchParams.get("client_id"),
      challengeMethod: url.searchParams.get("code_challenge_method"), planScope: (url.searchParams.get("scope") ?? "").includes("chatgpt.tokens.use.direct") };
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ error: "access_denied", state: url.searchParams.get("state")! }).toString();
    await route.fulfill({ status: 302, headers: { location: callback.toString() }, body: "" });
  });
  await app.open(`${localOrigin}/login`);
  const showPassword = screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  await showPassword.tap();
  await expect(screen.getByRole("button", "Masquer le mot de passe", { exact: true })).toBeVisible();
  await screen.getByLabel("Email", { exact: true }).fill(account.username);
  await screen.getByLabel(/Mot de passe/).fill(account.password);
  await screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(browser).toHaveURL(/\/dashboard/);
  await app.open(`${localOrigin}/dashboard/profile`);
  await expect(screen.getByRole("heading", "Mon forfait ChatGPT", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Continue with ChatGPT", { exact: true }).tap();
  await expect(screen.getByText("Vous avez annulé la connexion ChatGPT. Vous pouvez la relancer.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Continue with ChatGPT", { exact: true })).toBeEnabled();
  expect(authorization).toEqual({ host: "auth.openai.com", clientId: "dynamic_agent_client", challengeMethod: "S256", planScope: true });
  expect(diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry))).toBe(false);
  const prefix = `ARMY-chatgpt-${Date.now()}`;
  await recordEvidence({ runPrefix: prefix, projectName: prefix, ownedEstimates: [] }, "chatgpt-local", {
    outcome: "local OAuth start and injected consent refusal", liveChatGptSignIn: false, inference: false,
    authorization, callbackContainsSecretsInLog: diagnostics.some((entry) => /GET \/auth\/chatgpt\/callback.*state=/.test(entry)),
  });
});
