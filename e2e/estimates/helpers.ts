import fs from "node:fs";
import path from "node:path";

import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_E2E_LOGIN_EMAIL = "e2e.hex@example.com";
const DEFAULT_E2E_LOGIN_PASSWORD = "E2eTest-2026!";
const ESTIMATE_EDIT_URL_PATTERN =
  /\/dashboard\/estimates\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit(?:[/?#].*)?$/i;
const NO_ACTIVE_TENANT_PATTERN = /Aucun tenant actif pour cet utilisateur/i;

function getLoginEmail() {
  const fromEnv = process.env.E2E_LOGIN_EMAIL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_E2E_LOGIN_EMAIL;
}

function getLoginPassword() {
  const fromEnv = process.env.E2E_LOGIN_PASSWORD?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_E2E_LOGIN_PASSWORD;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readPublicEnvFromDotEnv(name: string) {
  const dotEnvPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(dotEnvPath)) return null;

  const content = fs.readFileSync(dotEnvPath, "utf8");
  const line = content
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));

  if (!line) return null;

  const value = line.slice(name.length + 1).trim();
  return value.length > 0 ? value : null;
}

function resolveSupabasePublicConfig() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    readPublicEnvFromDotEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    readPublicEnvFromDotEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    return null;
  }

  return {
    url,
    anonKey,
  };
}

function decodeSupabaseSessionFromCookie(cookieValue: string) {
  const decoded = decodeURIComponent(cookieValue);
  const payload = decoded.startsWith("base64-")
    ? Buffer.from(decoded.slice("base64-".length), "base64").toString("utf8")
    : decoded;

  const parsed = JSON.parse(payload) as unknown;
  if (!parsed || typeof parsed !== "object") return null;

  return parsed as {
    access_token?: string;
  };
}

function readSupabaseAuthCookieValue(
  cookies: Array<{
    name: string;
    value: string;
  }>
) {
  const byBaseName = new Map<
    string,
    {
      fullValue: string | null;
      chunks: Map<number, string>;
    }
  >();

  for (const cookie of cookies) {
    const match = cookie.name.match(/^(sb-.*-auth-token)(?:\.(\d+))?$/i);
    if (!match) continue;

    const baseName = match[1] ?? cookie.name;
    const chunkIndexRaw = match[2];
    const existing = byBaseName.get(baseName) ?? {
      fullValue: null,
      chunks: new Map<number, string>(),
    };

    if (typeof chunkIndexRaw === "string") {
      existing.chunks.set(Number.parseInt(chunkIndexRaw, 10), cookie.value);
    } else {
      existing.fullValue = cookie.value;
    }

    byBaseName.set(baseName, existing);
  }

  for (const candidate of byBaseName.values()) {
    if (candidate.chunks.size === 0) {
      if (candidate.fullValue) return candidate.fullValue;
      continue;
    }

    const parts: string[] = [];
    let index = 0;
    while (candidate.chunks.has(index)) {
      parts.push(candidate.chunks.get(index) ?? "");
      index += 1;
    }

    if (parts.length === candidate.chunks.size && parts.length > 0) {
      return parts.join("");
    }

    if (candidate.fullValue) {
      return candidate.fullValue;
    }
  }

  return null;
}

function extractJwtSubject(token: string) {
  const segments = token.split(".");
  if (segments.length < 2) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1] ?? "", "base64url").toString("utf8")
    ) as { sub?: string };

    return typeof payload.sub === "string" && payload.sub.length > 0
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

async function bootstrapTenantMembershipIfMissing(page: Page) {
  const statsResponse = await page.request.get("/api/estimates/stats", {
    failOnStatusCode: false,
  });

  if (statsResponse.status() !== 403) {
    return;
  }

  const statsBody = await statsResponse.text();
  if (!NO_ACTIVE_TENANT_PATTERN.test(statsBody)) {
    return;
  }

  const supabaseConfig = resolveSupabasePublicConfig();
  if (!supabaseConfig) {
    throw new Error(
      "Missing Supabase public config while tenant bootstrap is required."
    );
  }

  const authCookieValue = readSupabaseAuthCookieValue(await page.context().cookies());
  if (!authCookieValue) {
    throw new Error("Missing Supabase auth cookie for tenant bootstrap.");
  }

  const session = decodeSupabaseSessionFromCookie(authCookieValue);
  const accessToken =
    session && typeof session.access_token === "string"
      ? session.access_token
      : null;
  if (!accessToken) {
    throw new Error("Missing access token in Supabase auth cookie.");
  }

  const userId = extractJwtSubject(accessToken);
  if (!userId) {
    throw new Error("Missing JWT subject in Supabase auth token.");
  }

  const bootstrapSlug = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const baseHeaders = {
    apikey: supabaseConfig.anonKey,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };

  const tenantResponse = await page.request.post(
    `${supabaseConfig.url}/rest/v1/tenants`,
    {
      failOnStatusCode: false,
      headers: baseHeaders,
      data: [
        {
          name: `E2E ${bootstrapSlug}`,
          slug: bootstrapSlug,
          created_by: userId,
        },
      ],
    }
  );
  const tenantBody = await tenantResponse.text();
  expect(
    [200, 201].includes(tenantResponse.status()),
    `Failed to bootstrap tenant. status=${tenantResponse.status()} body=${tenantBody}`
  ).toBe(true);

  let tenantId: string | null = null;
  try {
    const payload = JSON.parse(tenantBody) as Array<{ id?: string }>;
    tenantId =
      Array.isArray(payload) && typeof payload[0]?.id === "string"
        ? payload[0].id
        : null;
  } catch {
    tenantId = null;
  }

  if (!tenantId) {
    throw new Error(`Unable to parse tenant id from bootstrap response: ${tenantBody}`);
  }

  const membershipResponse = await page.request.post(
    `${supabaseConfig.url}/rest/v1/tenant_memberships`,
    {
      failOnStatusCode: false,
      headers: baseHeaders,
      data: [
        {
          tenant_id: tenantId,
          user_id: userId,
          role: "admin",
          is_default: true,
        },
      ],
    }
  );
  const membershipBody = await membershipResponse.text();
  expect(
    [200, 201].includes(membershipResponse.status()),
    `Failed to bootstrap tenant membership. status=${membershipResponse.status()} body=${membershipBody}`
  ).toBe(true);

  const statsAfterBootstrap = await page.request.get("/api/estimates/stats", {
    failOnStatusCode: false,
  });
  const statsAfterBody = await statsAfterBootstrap.text();
  expect(
    statsAfterBootstrap.status(),
    `Tenant bootstrap completed but estimates stats remains unavailable. status=${statsAfterBootstrap.status()} body=${statsAfterBody}`
  ).toBe(200);
}

async function clickFirstVisibleEnabledButton(
  page: Page,
  candidates: Locator,
  label: string,
  timeoutMs = 30_000
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const count = await candidates.count();

    for (let index = 0; index < count; index += 1) {
      const candidate = candidates.nth(index);
      if (!(await candidate.isVisible())) continue;
      if (!(await candidate.isEnabled())) continue;
      await candidate.click({ force: true });
      return;
    }

    await page.waitForTimeout(250);
  }

  throw new Error(`No visible enabled button found for: ${label}`);
}

export function buildEstimateName(prefix: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${suffix}`;
}

export function extractVersionIdFromUrl(url: string) {
  const match = url.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );

  if (!match) {
    throw new Error(`Unable to parse estimate version id from URL: ${url}`);
  }

  return match[0].toLowerCase();
}

export async function loginWithUi(page: Page) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });

    if (/\/dashboard(?:$|[/?#])/.test(page.url())) {
      await bootstrapTenantMembershipIfMissing(page);
      return;
    }

    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();

    await page.getByLabel("Email").fill(getLoginEmail());
    await page.locator("#password").fill(getLoginPassword());
    await page.getByRole("button", { name: /Se connecter/i }).click();

    try {
      await page.waitForURL(/\/dashboard(?:$|[/?#])/, { timeout: 30_000 });
      await bootstrapTenantMembershipIfMissing(page);
      return;
    } catch {
      await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
      if (/\/dashboard(?:$|[/?#])/.test(page.url())) {
        return;
      }

      if (attempt === maxAttempts) {
        const alertText = (await page.getByRole("alert").allTextContents())
          .map((text) => text.trim())
          .filter((text) => text.length > 0)
          .join(" | ");
        throw new Error(
          alertText
            ? `Unable to login after ${maxAttempts} attempts: ${alertText}`
            : `Unable to login after ${maxAttempts} attempts.`
        );
      }

      await page.waitForTimeout(2_000);
    }
  }
}

export async function createEstimateViaWizard(
  page: Page,
  options?: {
    projectName?: string;
    title?: string;
    dateDevis?: string;
    validiteJours?: string;
  }
) {
  const projectName = options?.projectName ?? buildEstimateName("EST262-PROJET");
  const title = options?.title ?? "E2E EST-262";
  const projectNameInput = page.getByLabel(/Nom du projet/i);
  const titleInput = page.getByLabel(/Titre de la version/i);
  const nextButton = page.getByRole("button", { name: /^Suivant$/ });
  const dateDevisInput = page.getByLabel(/Date devis/i);
  const validiteInput = page.getByLabel(/Validit/i);

  await page.goto("/dashboard/estimates/new", {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("heading", { name: /Nouveau chiffrage/i })).toBeVisible();

  await projectNameInput.fill(projectName);
  await expect(projectNameInput).toHaveValue(projectName);
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title);

  let parametersStepReached = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await nextButton.click();

    try {
      await expect(dateDevisInput).toBeVisible({ timeout: 5_000 });
      parametersStepReached = true;
      break;
    } catch {
      await projectNameInput.fill(projectName);
      await expect(projectNameInput).toHaveValue(projectName);
      await titleInput.fill(title);
      await expect(titleInput).toHaveValue(title);
    }
  }

  expect(parametersStepReached, "wizard should reach the parameters step").toBe(true);

  await dateDevisInput.fill(options?.dateDevis ?? "2026-02-02");
  await validiteInput.fill(options?.validiteJours ?? "30");

  await nextButton.click();
  await expect(
    page.getByRole("heading", { name: /^Import$/i }),
  ).toBeVisible({ timeout: 15_000 });

  await Promise.all([
    page.waitForURL(ESTIMATE_EDIT_URL_PATTERN, { timeout: 60_000 }),
    page
      .getByRole("button", { name: /Creer le chiffrage|Créer le chiffrage/i })
      .click(),
  ]);

  const versionId = extractVersionIdFromUrl(page.url());
  await expect(
    page.getByRole("heading", { name: /Editer le chiffrage|Éditer le chiffrage/i })
  ).toBeVisible();

  return { projectName, title, versionId };
}

export async function duplicateEstimateViaApi(page: Page, versionId: string) {
  const response = await page.request.post(`/api/estimates/${versionId}/duplicate`, {
    failOnStatusCode: false,
  });
  const body = await response.text();

  expect(
    response.status(),
    `Failed to duplicate estimate version. status=${response.status()} body=${body}`
  ).toBe(201);

  let payload: unknown = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = null;
  }

  if (!payload || typeof payload !== "object") {
    throw new Error(`Invalid duplicate estimate payload: ${body}`);
  }

  const root = payload as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : null;
  const duplicatedVersionId =
    data && typeof data.version_id === "string" ? data.version_id : null;

  if (!duplicatedVersionId) {
    throw new Error(`Missing duplicated version id in response: ${body}`);
  }

  return duplicatedVersionId;
}

export async function createLineViaApi(
  page: Page,
  versionId: string,
  lineTitle: string
) {
  const itemsEndpoint = `/api/estimates/${versionId}/items`;
  const lockEndpoint = `/api/estimates/${versionId}/lock`;
  const linePayload = {
    item_type: "line" as const,
    title: lineTitle,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
  };

  async function postJson(url: string, payload?: Record<string, unknown>) {
    const response = await page.request.post(url, {
      failOnStatusCode: false,
      ...(payload ? { data: payload } : {}),
    });

    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    return {
      status: response.status(),
      json,
      text,
    };
  }

  function extractErrorMessage(json: unknown, text: string) {
    if (
      json &&
      typeof json === "object" &&
      "error" in json &&
      json.error &&
      typeof json.error === "object" &&
      "message" in json.error &&
      typeof json.error.message === "string"
    ) {
      return json.error.message;
    }
    return text;
  }

  function extractCreatedItemId(json: unknown): string | null {
    if (
      json &&
      typeof json === "object" &&
      "data" in json &&
      json.data &&
      typeof json.data === "object" &&
      "item" in json.data &&
      json.data.item &&
      typeof json.data.item === "object" &&
      "id" in json.data.item &&
      typeof json.data.item.id === "string"
    ) {
      return json.data.item.id;
    }
    return null;
  }

  function extractRequiredSectionLevel(message: string): number | null {
    const parsedLevel = Number(message.match(/niveau\s+(\d+)/i)?.[1] ?? "");
    if (!Number.isFinite(parsedLevel) || parsedLevel < 1) {
      return null;
    }

    return Math.trunc(parsedLevel);
  }

  function extractVersionMaxSectionDepth(payload: unknown): number | null {
    if (!payload || typeof payload !== "object") return null;

    const root = payload as Record<string, unknown>;
    const data =
      root.data && typeof root.data === "object"
        ? (root.data as Record<string, unknown>)
        : null;
    const versionFromData =
      data?.version && typeof data.version === "object"
        ? (data.version as Record<string, unknown>)
        : null;
    const estimateVersionFromData =
      data?.estimateVersion && typeof data.estimateVersion === "object"
        ? (data.estimateVersion as Record<string, unknown>)
        : null;

    const candidates = [
      root.max_section_depth,
      data?.max_section_depth,
      versionFromData?.max_section_depth,
      estimateVersionFromData?.max_section_depth,
    ];

    for (const candidate of candidates) {
      const numericCandidate =
        typeof candidate === "number"
          ? candidate
          : typeof candidate === "string"
            ? Number(candidate)
            : NaN;

      if (Number.isFinite(numericCandidate) && numericCandidate >= 1) {
        return Math.trunc(numericCandidate);
      }
    }

    return null;
  }

  async function resolveRequiredSectionLevel(message: string) {
    const fromMessage = extractRequiredSectionLevel(message);
    if (fromMessage !== null) {
      return fromMessage;
    }

    const versionResponse = await page.request.get(`/api/estimates/${versionId}`, {
      failOnStatusCode: false,
    });

    if (versionResponse.status() !== 200) {
      return 1;
    }

    let versionPayload: unknown = null;
    try {
      versionPayload = await versionResponse.json();
    } catch {
      versionPayload = null;
    }

    return extractVersionMaxSectionDepth(versionPayload) ?? 1;
  }

  const lockAttempt = await postJson(lockEndpoint);
  expect(
    lockAttempt.status,
    `Failed to acquire draft lock. status=${lockAttempt.status} body=${lockAttempt.text}`
  ).toBe(201);

  let firstAttempt = await postJson(itemsEndpoint, linePayload);
  let firstAttemptMessage = extractErrorMessage(firstAttempt.json, firstAttempt.text);

  if (
    firstAttempt.status === 409 &&
    /lock_required|verrou actif est requis/i.test(firstAttemptMessage)
  ) {
    const lockRetryAttempt = await postJson(lockEndpoint);
    expect(
      lockRetryAttempt.status,
      `Failed to renew draft lock after LOCK_REQUIRED. status=${lockRetryAttempt.status} body=${lockRetryAttempt.text}`
    ).toBe(201);

    firstAttempt = await postJson(itemsEndpoint, linePayload);
    firstAttemptMessage = extractErrorMessage(firstAttempt.json, firstAttempt.text);
  }

  if (firstAttempt.status === 201) {
    return;
  }

  // Backend now enforces line placement under a section.
  if (
    firstAttempt.status === 400 &&
    /sous une section|niveau/i.test(firstAttemptMessage)
  ) {
    const requiredLevel = await resolveRequiredSectionLevel(firstAttemptMessage);
    let parentSectionId: string | null = null;

    for (let level = 1; level <= requiredLevel; level += 1) {
      const sectionAttempt = await postJson(itemsEndpoint, {
        item_type: "section",
        title: `E2E Section L${level}`,
        ...(parentSectionId ? { parent_id: parentSectionId } : {}),
      });

      expect(
        sectionAttempt.status,
        `Failed to create section level ${level}. status=${sectionAttempt.status} body=${sectionAttempt.text}`
      ).toBe(201);

      parentSectionId = extractCreatedItemId(sectionAttempt.json);
      expect(
        parentSectionId,
        `Missing section id for level ${level}. body=${sectionAttempt.text}`
      ).not.toBeNull();
    }

    const secondAttempt = await postJson(itemsEndpoint, {
      ...linePayload,
      parent_id: parentSectionId,
    });

    expect(
      secondAttempt.status,
      `Failed to create line under section. status=${secondAttempt.status} body=${secondAttempt.text}`
    ).toBe(201);
    return;
  }

  expect(
    firstAttempt.status,
    `Failed to create line. status=${firstAttempt.status} body=${firstAttempt.text}`
  ).toBe(201);
}

export async function openEditorTab(page: Page) {
  const editorToggleButton = page.getByRole("button", { name: /Editeur|Éditeur/i });

  if (await editorToggleButton.first().isVisible().catch(() => false)) {
    await editorToggleButton.first().click();
    await expect(page.getByRole("heading", { name: /Éditeur du devis/i })).toBeVisible();
    return;
  }

  await expect(
    page.getByRole("heading", { name: /Éditer le chiffrage|Editer le chiffrage/i })
  ).toBeVisible();
  await expect(page.getByRole("grid", { name: /Lignes de devis/i })).toBeVisible();
}

export async function addChapter(page: Page, chapterTitle: string) {
  const titleInputs = page.locator("input.estimate-input--title");
  const beforeCount = await titleInputs.count();

  await clickFirstVisibleEnabledButton(
    page,
    page.getByRole("button", { name: /^\+\s*Chapitre$/ }),
    "+ Chapitre"
  );

  await expect
    .poll(async () => titleInputs.count(), { timeout: 15_000 })
    .toBeGreaterThan(beforeCount);

  await titleInputs.last().fill(chapterTitle);
  await titleInputs.last().press("Tab");
}

export async function addLine(page: Page, lineTitle: string) {
  const titleInputs = page.locator("input.estimate-input--title");
  const beforeCount = await titleInputs.count();

  await clickFirstVisibleEnabledButton(
    page,
    page.getByRole("button", { name: /^\+\s*Ligne$/ }),
    "+ Ligne"
  );

  await expect
    .poll(async () => titleInputs.count(), { timeout: 15_000 })
    .toBeGreaterThan(beforeCount);

  await titleInputs.last().fill(lineTitle);
  await titleInputs.last().press("Tab");

  await expectLineTitleVisible(page, lineTitle);
}

export async function setLineCoreValues(
  page: Page,
  lineTitle: string,
  values: { quantity: string; unitPriceHt: string }
) {
  const escapedTitle = escapeRegExp(lineTitle);

  const quantityInput = page.getByLabel(
    new RegExp(`Quantite pour ${escapedTitle}`, "i")
  );
  await quantityInput.fill(values.quantity);
  await quantityInput.press("Tab");

  const priceInput = page.getByLabel(
    new RegExp(`Prix unitaire pour ${escapedTitle}`, "i")
  );
  await priceInput.fill(values.unitPriceHt);
  await priceInput.press("Tab");
}

export async function waitForAutoSave(page: Page) {
  await expect(
    page.getByText(/Sauvegard[ée]|Sauvegarde en cours/i).first()
  ).toBeVisible({ timeout: 25_000 });

  await expect(
    page.getByText(/Sauvegard[ée]/i).first()
  ).toBeVisible({ timeout: 25_000 });
}

export async function changeEstimateStatus(
  page: Page,
  target: "sent" | "accepted"
) {
  if (target === "sent") {
    const sendButton = page.getByRole("button", { name: /^Envoyer$/ });
    await expect(sendButton).toBeEnabled({ timeout: 30_000 });
    await sendButton.click();

    const gatingDialog = page.getByRole("dialog", {
      name: /Verification avant envoi/i,
    });
    if (await gatingDialog.isVisible().catch(() => false)) {
      const confirmSendButton = gatingDialog.getByRole("button", {
        name: /^Envoyer$/,
      });
      await expect(confirmSendButton).toBeEnabled({ timeout: 30_000 });
      await confirmSendButton.click();
    }

    await expectCurrentStatus(page, "sent");
    return;
  }

  const acceptButton = page.getByRole("button", { name: /^Accepter$/ });
  await expect(acceptButton).toBeEnabled({ timeout: 30_000 });
  await acceptButton.click();
  await expectCurrentStatus(page, "accepted");
}

export async function expectCurrentStatus(
  page: Page,
  status: "draft" | "sent" | "accepted"
) {
  let labelPattern: RegExp;

  switch (status) {
    case "draft":
      labelPattern = /Brouillon/i;
      break;
    case "sent":
      labelPattern = /Envoy/i;
      break;
    case "accepted":
      labelPattern = /Accept/i;
      break;
    default:
      labelPattern = /./;
      break;
  }

  await expect(
    page.locator(".status-badge").filter({ hasText: labelPattern }).first()
  ).toBeVisible({ timeout: 25_000 });
}

export async function exportEstimateAsXlsx(page: Page, versionId: string) {
  const exportRequest = page.waitForResponse((response) => {
    const url = response.url();
    return (
      response.request().method() === "GET" &&
      response.status() === 200 &&
      url.includes(`/api/estimates/${versionId}/export`) &&
      url.includes("format=xlsx")
    );
  });

  await page.getByRole("button", { name: /^Exporter$/ }).click();
  await expect(page.getByRole("button", { name: /Excel \(\.xlsx\)/i })).toBeVisible();
  await page.getByRole("button", { name: /Excel \(\.xlsx\)/i }).click();

  const response = await exportRequest;
  const disposition = response.headers()["content-disposition"] ?? "";
  expect(disposition.toLowerCase()).toContain(".xlsx");
}

export async function ensureEstimatePdfReady(page: Page, versionId: string) {
  const triggerResponse = await page.request.post(
    `/api/estimates/${versionId}/pdf?force=true`,
    {
      failOnStatusCode: false,
    }
  );

  expect([200, 202]).toContain(triggerResponse.status());

  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `/api/estimates/${versionId}/pdf?format=json`,
          { failOnStatusCode: false }
        );

        if (response.status() !== 200 && response.status() !== 202) {
          return `http-${response.status()}`;
        }

        const payload = (await response.json()) as {
          data?: { status?: string };
        };

        return payload.data?.status ?? "unknown";
      },
      {
        timeout: 60_000,
        intervals: [1_000, 2_000, 3_000],
      }
    )
    .toBe("ready");
}

function extractUpdatedAtToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;

  const fromRoot =
    typeof root.updated_at === "string" ? root.updated_at : null;
  if (fromRoot) return fromRoot;

  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : null;
  if (!data) return null;

  const dataToken =
    typeof data.updated_at === "string" ? data.updated_at : null;
  if (dataToken) return dataToken;

  const version =
    data.version && typeof data.version === "object"
      ? (data.version as Record<string, unknown>)
      : null;
  if (!version) return null;

  return typeof version.updated_at === "string" ? version.updated_at : null;
}

export async function setEstimateStatusViaApi(
  page: Page,
  versionId: string,
  status: "sent" | "accepted"
) {
  const versionResponse = await page.request.get(`/api/estimates/${versionId}`, {
    failOnStatusCode: false,
  });
  expect(versionResponse.status()).toBe(200);

  const versionPayload = (await versionResponse.json()) as unknown;
  const updatedAtToken = extractUpdatedAtToken(versionPayload);
  expect(updatedAtToken).toBeTruthy();

  const statusResponse = await page.request.patch(
    `/api/estimates/${versionId}/status`,
    {
      failOnStatusCode: false,
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken ?? "",
      },
      data: {
        status,
        updated_at: updatedAtToken,
        force: true,
      },
    }
  );

  expect(statusResponse.status()).toBe(200);
}

export async function openPrintPage(page: Page, versionId: string) {
  await page.goto(`/dashboard/estimates/${versionId}/print`);
  await expect(page).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/print`));
  await expect(page.getByRole("button", { name: /Imprimer \/ PDF/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Devis$/i })).toBeVisible();
}

export async function expectLineTitleVisible(page: Page, expectedTitle: string) {
  await expect
    .poll(
      async () =>
        page.evaluate((lineTitle) => {
          return Array.from(
            document.querySelectorAll<HTMLInputElement>("input.estimate-input--title")
          ).some((input) => input.value.trim() === lineTitle);
        }, expectedTitle),
      { timeout: 20_000 }
    )
    .toBe(true);
}

export async function ensureMapping(
  page: Page,
  sourceColumn: string,
  targetField: string
) {
  const row = page
    .locator("table.data-table tbody tr")
    .filter({ hasText: sourceColumn })
    .first();

  await expect(row).toBeVisible();
  await row.locator("select").selectOption(targetField);
}
