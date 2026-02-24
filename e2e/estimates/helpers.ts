import { expect, type Locator, type Page } from "@playwright/test";

const DEFAULT_E2E_LOGIN_EMAIL = "e2e.hex@example.com";
const DEFAULT_E2E_LOGIN_PASSWORD = "E2eTest-2026!";
const ESTIMATE_EDIT_URL_PATTERN =
  /\/dashboard\/estimates\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/edit(?:[/?#].*)?$/i;

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
    await page.goto("/login");

    if (/\/dashboard(?:$|[/?#])/.test(page.url())) {
      return;
    }

    await expect(page.getByRole("heading", { name: /Connexion/i })).toBeVisible();

    await page.getByLabel("Email").fill(getLoginEmail());
    await page.locator("#password").fill(getLoginPassword());
    await page.getByRole("button", { name: /Se connecter/i }).click();

    try {
      await page.waitForURL(/\/dashboard(?:$|[/?#])/, { timeout: 30_000 });
      return;
    } catch {
      await page.goto("/dashboard");
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

  await page.goto("/dashboard/estimates/new");
  await expect(page.getByRole("heading", { name: /Nouveau chiffrage/i })).toBeVisible();

  await page.getByLabel(/Nom du projet/i).fill(projectName);
  await page.getByLabel(/Titre de la version/i).fill(title);

  await page.getByRole("button", { name: /^Suivant$/ }).click();

  await page.getByLabel(/Date devis/i).fill(options?.dateDevis ?? "2026-02-02");
  await page.getByLabel(/Validit/i).fill(options?.validiteJours ?? "30");

  await page.getByRole("button", { name: /^Suivant$/ }).click();

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

export async function createLineViaApi(
  page: Page,
  versionId: string,
  lineTitle: string
) {
  const response = await page.request.post(`/api/estimates/${versionId}/items`, {
    failOnStatusCode: false,
    data: {
      item_type: "line",
      title: lineTitle,
      quantity: 1,
      unit_price_ht_cents: 1000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
    },
  });

  expect(response.status()).toBe(201);
}

export async function openEditorTab(page: Page) {
  await page
    .getByRole("button", { name: /Editeur|Éditeur/i })
    .click();
  await expect(page.getByRole("heading", { name: /Éditeur du devis/i })).toBeVisible();
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
