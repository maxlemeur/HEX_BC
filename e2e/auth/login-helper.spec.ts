import { createServer } from "node:http";

import { expect, test as base, type Page } from "@playwright/test";

import { createLineViaApi, duplicateEstimateViaApi, loginWithUi } from "../estimates/helpers";
import { createTeamAHubEstimateViaApi } from "../estimates/team-a-hub.helpers";

const syntheticEmail = "login-helper@example.invalid";
const syntheticPassword = "unused-synthetic-fixture";
const originalEmail = process.env.E2E_LOGIN_EMAIL;
const originalPassword = process.env.E2E_LOGIN_PASSWORD;

const test = base.extend({
  baseURL: async ({}, provideOrigin) => {
    // page.request is an API client and does not use browser route handlers.
    const server = createServer((request, response) => {
      if (request.url?.startsWith("/api/estimates/") && request.url !== "/api/estimates/stats") {
        const denied = request.url.includes("/denied/");
        const malformed = request.url.includes("/malformed/");
        response.writeHead(denied ? 409 : 201, { "content-type": "application/json" });
        response.end(JSON.stringify({
          data: { owner: { work_email: syntheticEmail }, ...(malformed ? {} : { version_id: "duplicated-version", item: { id: "created-line" } }) },
          ...(denied ? { error: { message: "Draft lock unavailable", diagnostic: syntheticPassword } } : {}),
        }));
        return;
      }
      if (request.url === "/api/estimates") {
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: { version: { id: "created-version", project_id: "created-project", created_by_email: syntheticEmail } } }));
        return;
      }
      response.writeHead(request.url === "/api/estimates/stats" ? 200 : 404, {
        "content-type": "application/json",
      });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Fixture server has no TCP address");
    try {
      await provideOrigin(`http://127.0.0.1:${address.port}`);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  },
});

test.beforeEach(() => {
  process.env.E2E_LOGIN_EMAIL = syntheticEmail;
  process.env.E2E_LOGIN_PASSWORD = syntheticPassword;
});

test.afterEach(() => {
  if (originalEmail === undefined) delete process.env.E2E_LOGIN_EMAIL;
  else process.env.E2E_LOGIN_EMAIL = originalEmail;
  if (originalPassword === undefined) delete process.env.E2E_LOGIN_PASSWORD;
  else process.env.E2E_LOGIN_PASSWORD = originalPassword;
});

async function fixture(page: Page, origin: string, reject = false) {
  const observations = { nativeSubmissions: 0, authRequests: 0, submittedAfterHydration: false };
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      throw new Error("Synthetic login fixtures cannot contact a real service");
    }
    if (url.pathname === "/auth-probe") {
      observations.authRequests += 1;
      const body = route.request().postDataJSON() as { email: string; password: string; hydrated: boolean };
      observations.submittedAfterHydration = body.hydrated &&
        body.email === syntheticEmail && body.password === syntheticPassword;
      await route.fulfill({ json: { rejected: reject } });
      return;
    }
    if (url.pathname === "/api/estimates/stats") {
      await route.fulfill({ json: {} });
      return;
    }
    if (route.request().method() === "POST") observations.nativeSubmissions += 1;
    await route.fulfill({ contentType: "text/html", body: `
      <h1>Connexion</h1>
      <form method="post">
        <label for="email">Email</label><input id="email" name="email" type="email">
        <label for="password">Mot de passe</label><input id="password" name="password" type="password">
        <button type="button" aria-controls="password" aria-label="Afficher le mot de passe">Afficher le mot de passe</button>
        <button type="submit">Se connecter</button>
      </form>
      <script>
        setTimeout(() => {
          const model = { email: "", password: "", hydrated: true };
          for (const field of ["email", "password"]) {
            document.getElementById(field).addEventListener("input", event => model[field] = event.target.value);
          }
          const toggle = document.querySelector('[aria-controls="password"]');
          toggle.addEventListener("click", () => {
            const input = document.getElementById("password");
            input.type = input.type === "password" ? "text" : "password";
            const label = input.type === "password" ? "Afficher le mot de passe" : "Masquer le mot de passe";
            toggle.textContent = label;
            toggle.setAttribute("aria-label", label);
          });
          document.querySelector("form").addEventListener("submit", async event => {
            event.preventDefault();
            const response = await fetch("/auth-probe", { method: "POST", body: JSON.stringify(model) });
            if ((await response.json()).rejected) {
              const alert = document.createElement("p");
              alert.setAttribute("role", "alert");
              alert.textContent = "Email ou mot de passe incorrect.";
              document.body.append(alert);
            } else history.pushState({}, "", "/dashboard");
          });
        }, 600);
      </script>
    ` });
  });
  return observations;
}

test("waits for late handlers before filling credentials and preserves successful login", async ({ page, baseURL }) => {
  const observed = await fixture(page, baseURL!);
  const attempt = loginWithUi(page).then(() => ({ result: "success" }), (error: Error) => ({ result: "failure", message: error.message }));
  await expect.poll(() => observed.submittedAfterHydration, { timeout: 4_000 }).toBe(true);
  await expect(attempt).resolves.toEqual({ result: "success" });
  expect(observed.nativeSubmissions).toBe(0);
  expect(observed.authRequests).toBe(1);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("#password")).toHaveAttribute("type", "password");
});

test("reports an authentication rejection without restarting the login", async ({ page, baseURL }) => {
  const observed = await fixture(page, baseURL!, true);
  const error = await loginWithUi(page).then(() => null, (caught: Error) => caught.message);
  expect(error).toContain("Email ou mot de passe incorrect.");
  expect(observed.nativeSubmissions).toBe(0);
  expect(observed.authRequests).toBe(1);
});

test("keeps successful API response identities out of reporter metadata", async ({ page }) => {
  await createLineViaApi(page, "existing-version", "Synthetic line");
  expect(await duplicateEstimateViaApi(page, "existing-version")).toBe("duplicated-version");
  expect(await createTeamAHubEstimateViaApi(page, { projectName: "Synthetic project", title: "Synthetic estimate" }))
    .toEqual({ versionId: "created-version", projectId: "created-project" });
});

test("preserves API rejection diagnostics without reporting credentials", async ({ page }) => {
  const message = await createLineViaApi(page, "denied", "Synthetic line")
    .then(() => null, (error: Error) => error.message);
  expect(message).toContain("status=409");
  expect(message).toContain("Draft lock unavailable");
  expect(message?.includes(syntheticEmail)).toBe(false);
  expect(message?.includes(syntheticPassword)).toBe(false);
});

test("rejects incomplete duplicate payloads without reporting account identities", async ({ page }) => {
  const message = await duplicateEstimateViaApi(page, "malformed")
    .then(() => null, (error: Error) => error.message);
  expect(message).toContain("Missing duplicated version id");
  expect(message?.includes(syntheticEmail)).toBe(false);
});
