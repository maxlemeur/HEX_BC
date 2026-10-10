import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { fillLoginCredential } from "./helpers";

export const connectedBaseURL = "http://localhost:3000";
const expectedHost = "ijropnynpwjbllievrip.supabase.co";
const expectedTenant = "a8d1292a-bfd1-4a44-9820-dc9536ecad25";
const expectedUser = "6e39f0a0-fd45-441f-b503-1a88310e0f29";
const pendingManifestWrites = new WeakMap<ConnectedRun, Promise<void>>();
const verifiedPages = new WeakMap<Page, ConnectedRun>();

export type ConnectedRun = {
  prefix: string;
  identityVerified: boolean;
  owned: Set<string>;
  manifestPath: string;
  manifest: Record<string, unknown> & {
    fixtures: Array<{ kind: string; id: string; name: string }>;
    steps: Array<{ label: string; expected: unknown; actual: unknown }>;
  };
};

export async function createConnectedRun(testInfo: TestInfo, label: string): Promise<ConnectedRun> {
  const prefix = `ARMY DEMO8 ${label} ${randomUUID().slice(0, 8)}`;
  const sourceFiles = [
    "src/lib/catalogue/server.ts", "src/lib/catalogue/product-writes.ts", "src/lib/estimates/server.ts",
    "src/components/catalogue/prices-manager/SupplierOfferFormModal.tsx",
    "src/components/estimates/SupplierComparisonPanel.tsx", "src/hooks/useAutoSaveNavigationGuard.ts",
    "src/components/estimates/EstimateEditorTable.tsx",
    "src/components/estimates/components/estimate-editor-table/EstimateEditorTableChrome.tsx",
    "src/components/affaires/AffaireHub.tsx",
    "src/components/takeoff/TakeoffReviewPage.tsx",
    "e2e/demo-eight.connected.config.ts", "e2e/estimates/demo-eight-connected.helpers.ts",
    "e2e/estimates/demo-eight-estimate.connected.helpers.ts",
    "e2e/estimates/demo-eight-catalogue.connected.spec.ts",
    "e2e/estimates/demo-eight-parameters.connected.spec.ts", "e2e/estimates/column-preferences.spec.ts",
    "src/components/estimates/MarginTiersManager.tsx", "src/components/estimates/editor/EstimateEditorDrawer.tsx",
    "src/hooks/useEstimateEditorCalculation.ts", "src/components/estimates/MarginTiersExplanation.tsx",
    "src/hooks/useEstimateEditorState.impl.tsx", "src/app/login/page.tsx",
  ];
  const hashes = Object.fromEntries(await Promise.all(sourceFiles.map(async (file) => [file,
    await fs.readFile(file).then((content) => createHash("sha256").update(content).digest("hex")).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    }),
  ])));
  const buildId = await fs.readFile(".next/BUILD_ID", "utf8").then((value) => value.trim()).catch(() => null);
  const loginArtifactHash = await fs.readFile(".next/server/app/login.html")
    .then((value) => createHash("sha256").update(value).digest("hex")).catch(() => null);
  const manifestPath = testInfo.outputPath("business-manifest.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  const run: ConnectedRun = {
    prefix, identityVerified: false, owned: new Set(), manifestPath,
    manifest: {
      startedAt: new Date().toISOString(), prefix, test: testInfo.title,
      command: `npx playwright test --config=e2e/demo-eight.connected.config.ts ${path.basename(testInfo.file)}`,
      sourceRevision: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      localChanges: execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "status", "--short"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(),
      sourceHashes: hashes, onDiskBuildId: buildId, onDiskLoginArtifactHash: loginArtifactHash,
      trackedDiffSha256: createHash("sha256").update(execFileSync("git", ["-c", `safe.directory=${process.cwd()}`, "diff", "--binary"], { maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })).digest("hex"),
      appOrigin: connectedBaseURL, supabaseHost: expectedHost,
      tenantId: expectedTenant, userId: expectedUser,
      environment: `Existing localhost:3000 runtime (${process.env.E2E_DEMO_RUNTIME ?? "runtime declaration not supplied"}); real UI login and ordinary application APIs. On-disk build metadata alone is not proof that a compiled build is served.`,
      fixturesRetained: true, traces: false, videos: false, exportedSession: false,
      fixtures: [], steps: [], result: "running",
    },
  };
  await persistConnectedRun(run);
  return run;
}

export async function persistConnectedRun(run: ConnectedRun) {
  const content = `${JSON.stringify(run.manifest, null, 2)}\n`;
  const pending = (pendingManifestWrites.get(run) ?? Promise.resolve()).then(() => fs.writeFile(run.manifestPath, content));
  pendingManifestWrites.set(run, pending);
  await pending;
}

export async function ownFixture(run: ConnectedRun, kind: string, id: string, name: string) {
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(name.startsWith("ARMY ")).toBe(true);
  run.owned.add(id);
  run.manifest.fixtures.push({ kind, id, name });
  await persistConnectedRun(run);
}

export async function recordConnectedStep(run: ConnectedRun, label: string, expected: unknown, actual: unknown) {
  run.manifest.steps.push({ label, expected, actual });
  await persistConnectedRun(run);
}

export function assertOwned(run: ConnectedRun, ...ids: string[]) {
  expect(run.identityVerified, "UI login and tenant identity required before mutation").toBe(true);
  ids.forEach((id) => expect(run.owned.has(id), "Only fixtures created in this run may be mutated").toBe(true));
}

function guardMutation(run: ConnectedRun, apiPath: string, data: unknown) {
  assertOwned(run);
  const pathIds = apiPath.split("?")[0].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  assertOwned(run, ...pathIds);
  if (!data || typeof data !== "object") return;
  const body = data as { id?: string; action?: string; item?: Record<string, unknown>; project?: { name?: string }; project_id?: string };
  if (body.id) assertOwned(run, body.id);
  if (body.project_id) assertOwned(run, body.project_id);
  if (apiPath === "/api/products" && body.action === "create") expect(body.item?.designation).toMatch(/^ARMY /);
  if (apiPath === "/api/suppliers" && body.action === "create") expect(body.item?.name).toMatch(/^ARMY /);
  if (apiPath === "/api/estimates" && body.project) expect(body.project.name).toMatch(/^ARMY /);
  for (const field of [
    "supplier_id", "product_id", "selected_supplier_price_id",
    "labor_role_id", "labor_role_atelier_id", "labor_role_chantier_id",
  ] as const) {
    const id = body.item?.[field] ?? (data as Record<string, unknown>)[field];
    if (typeof id === "string") assertOwned(run, id);
  }
}

export async function apiJson<T>(page: Page, apiPath: string, options: {
  method?: "GET" | "POST" | "PATCH";
  data?: unknown;
  headers?: Record<string, string>;
} = {}): Promise<T> {
  expect(apiPath).toMatch(/^\/api\//);
  expect(apiPath).not.toMatch(/\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens|memberships\/)/);
  if (options.method && options.method !== "GET") {
    const run = verifiedPages.get(page);
    if (!run) throw new Error("No application mutation before verified ARMY identity.");
    guardMutation(run, apiPath, options.data);
  }
  const response = await page.request.fetch(`${connectedBaseURL}${apiPath}`, options);
  const payload = await response.json() as { ok: boolean; data: T; error?: { code?: string; message?: string } };
  // Never dump response headers, credentials, cookies or authentication payloads.
  if (!response.ok() || !payload.ok) throw new Error(`${options.method ?? "GET"} ${apiPath.split("?")[0]}: HTTP ${response.status()} ${payload.error?.code ?? ""} ${payload.error?.message ?? "Business response unsuccessful"}`);
  return payload.data;
}

export async function loginAndVerifyIdentity(page: Page, run: ConnectedRun) {
  const account = JSON.parse(await fs.readFile(".e2e/army/test-account.json", "utf8")) as {
    host: string; userId: string; tenantId: string; email: string; tenantRole: string;
  };
  expect(account.host).toBe(expectedHost);
  expect(account.userId).toBe(expectedUser);
  expect(account.tenantId).toBe(expectedTenant);
  expect(account.tenantRole).toBe("admin");
  expect(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://missing.invalid").hostname).toBe(expectedHost);
  const email = process.env.E2E_LOGIN_EMAIL;
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (!email || !password || email !== account.email) throw new Error("Dedicated ARMY E2E credentials are missing or do not match account metadata.");
  await page.context().route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const sameApp = url.origin === connectedBaseURL;
    const auth = url.origin === `https://${expectedHost}` && url.pathname.startsWith("/auth/v1/");
    const forbiddenMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method()) && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
    if ((!sameApp && !auth) || forbiddenMutation) return route.abort("blockedbyclient");
    if (sameApp && url.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      // Authentication posts never enter this branch; business bodies only.
      if (request.method() === "DELETE" && /^\/api\/estimates\/[0-9a-f-]{36}\/lock$/.test(url.pathname)) {
        const versionId = url.pathname.split("/")[3];
        if (!run.identityVerified || !run.owned.has(versionId)) return route.abort("blockedbyclient");
      } else {
        if (request.method() === "DELETE") return route.abort("blockedbyclient");
        guardMutation(run, url.pathname, request.postDataJSON());
      }
    }
    await route.continue();
  });
  await page.goto("/login");
  const form = page.locator("form").filter({ has: page.locator("#password") });
  expect(await form.evaluate((node) => (node as HTMLFormElement).method.toLowerCase()), "Login must POST before filling credentials").toBe("post");
  const authNetwork: Array<{ host: string; path: string; status?: number; error?: string }> = [];
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.hostname === expectedHost) authNetwork.push({ host: url.hostname, path: url.pathname, error: request.failure()?.errorText });
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.hostname === expectedHost && url.pathname.startsWith("/auth/v1/")) authNetwork.push({ host: url.hostname, path: url.pathname, status: response.status() });
  });
  try {
    // Exercise a harmless client-state change while the password is empty.
    // SSR form presence alone is insufficient on a fresh dev compilation.
    await expect.poll(async () => {
      if (await page.locator("#password").getAttribute("type") !== "text") {
        await page.getByRole("button", { name: "Afficher le mot de passe", exact: true }).click();
      }
      return page.locator("#password").getAttribute("type");
    }, { message: "Client login controls must be hydrated before credentials are filled" }).toBe("text");
    await page.getByRole("button", { name: "Masquer le mot de passe", exact: true }).click();
    await expect(page.locator("#password")).toHaveAttribute("type", "password");
    await fillLoginCredential(page.getByLabel("Email", { exact: true }), email);
    await fillLoginCredential(page.locator("#password"), password);
    await page.getByRole("button", { name: /Se connecter/i }).click();
    await page.waitForURL(/\/dashboard(?:$|[/?#])/);
  } catch {
    // Playwright writes an ARIA error-context even with traces/screenshots off;
    // closing this owned login page prevents password values in that snapshot.
    const diagnostic: Record<string, unknown> = { uiPath: new URL(page.url()).pathname };
    try {
      const alert = (await page.getByRole("alert").allTextContents()).join(" | ");
      diagnostic.uiAlert = alert.split(password).join("[REDACTED]");
      const membershipResponse = await page.request.get(`${connectedBaseURL}/api/memberships`, { timeout: 5_000 });
      const membership = await membershipResponse.json() as { ok?: boolean; error?: { code?: string } };
      diagnostic.membershipHttpStatus = membershipResponse.status();
      diagnostic.membershipOk = membership.ok === true;
      diagnostic.membershipErrorCode = membership.error?.code ?? null;
    } catch { diagnostic.membershipDiagnosticUnavailable = true; }
    await page.close();
    run.manifest.loginNetwork = authNetwork;
    run.manifest.loginDiagnostic = diagnostic;
    await persistConnectedRun(run);
    throw new Error("Dedicated ARMY UI login failed before any business mutation.");
  }
  const identity = await apiJson<{
    current_user_id: string; current_membership_role: string;
    tenant: { id: string; name: string };
  }>(page, "/api/memberships");
  expect(identity.current_user_id).toBe(expectedUser);
  expect(identity.tenant.id).toBe(expectedTenant);
  expect(identity.tenant.name).toMatch(/^ARMY /);
  expect(identity.current_membership_role).toBe("admin");
  run.identityVerified = true;
  verifiedPages.set(page, run);
  run.manifest.loginNetwork = authNetwork;
  const businessErrors: string[] = [];
  run.manifest.businessPageErrors = businessErrors;
  page.on("pageerror", (error) => {
    businessErrors.push(error.message.split(password).join("[REDACTED]")
      .replace(/\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g, "[TOKEN REDACTED]"));
  });
  await recordConnectedStep(run, "authenticated identity", { userId: expectedUser, tenantId: expectedTenant, role: "admin" }, {
    userId: identity.current_user_id, tenantId: identity.tenant.id, role: identity.current_membership_role,
  });
}

export async function captureBusinessScreen(page: Page, testInfo: TestInfo, name: string) {
  const url = new URL(page.url());
  expect(url.origin).toBe(connectedBaseURL);
  expect(url.pathname).toMatch(/^\/dashboard\/(products|prices|estimates|affaires)/);
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: false });
}
