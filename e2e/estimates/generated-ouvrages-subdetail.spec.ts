import { expect, test, type Locator, type Page } from "@playwright/test";

import { buildEstimateName } from "./helpers";

async function retry<T>(
  fn: () => Promise<T>,
  options?: {
    attempts?: number;
    delayMs?: number;
  }
) {
  const attempts = options?.attempts ?? 3;
  const delayMs = options?.delayMs ?? 1_500;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Retry failed.");
}

async function createEstimateViaApi(
  page: Page,
  options: {
    projectName: string;
    title: string;
  }
) {
  return retry(async () => {
    const response = await page.request.post("/api/estimates", {
      failOnStatusCode: false,
      timeout: 60_000,
      data: {
        project: {
          name: options.projectName,
        },
        version: {
          title: options.title,
          date_devis: "2026-03-07",
          validite_jours: 30,
        },
      },
    });
    const body = await response.text();

    expect(
      response.status(),
      `Failed to create estimate. status=${response.status()} body=${body}`
    ).toBe(201);

    const payload = JSON.parse(body) as {
      data?: { version?: { id?: string }; version_id?: string; versionId?: string };
      version_id?: string;
      versionId?: string;
    };

    const versionId =
      payload.data?.version?.id ??
      payload.data?.version_id ??
      payload.data?.versionId ??
      payload.version_id ??
      payload.versionId ??
      null;

    expect(versionId, "version id should be present in create estimate response").toBeTruthy();
    return { versionId: versionId as string };
  });
}

async function openEstimateEditor(page: Page, versionId: string) {
  await retry(async () => {
    await page.goto(`/dashboard/estimates/${versionId}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await expect(
      page.getByTestId("estimate-editor-open-generated-ouvrage-button")
    ).toBeVisible({ timeout: 30_000 });
  });
}

async function openGeneratedOuvrageDialog(page: Page) {
  const openButton = page.getByTestId("estimate-editor-open-generated-ouvrage-button");
  await expect(openButton).toBeVisible({ timeout: 60_000 });
  await openButton.click();
  const dialog = page.getByRole("dialog", { name: /Generer des ouvrages/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function activateButton(locator: Locator) {
  await locator.focus();
  await locator.press("Enter");
}

async function generateDraftFromText(page: Page, text: string) {
  const dialog = await openGeneratedOuvrageDialog(page);

  await dialog.getByLabel(/Texte source/i).fill(text);
  await activateButton(dialog.getByTestId("generated-ouvrage-generate-button"));

  const firstCard = dialog.locator('[data-testid^="candidate-card-"]').first();
  await expect(firstCard).toBeVisible({ timeout: 120_000 });

  return dialog;
}

async function loadEstimateItems(page: Page, versionId: string) {
  const response = await page.request.get(`/api/estimates/${versionId}/items`, {
    failOnStatusCode: false,
    timeout: 60_000,
  });
  const body = await response.text();

  expect(
    response.status(),
    `Failed to fetch estimate items. status=${response.status()} body=${body}`
  ).toBe(200);

  const payload = JSON.parse(body) as {
    data?: {
      items?: Array<{
        id: string;
        item_type: string;
        title: string | null;
        source_provider?: string | null;
        source_metadata?: {
          kind?: string | null;
          subdetail_summary?: {
            ds_cents?: number | null;
            indicative_target_price_cents?: number | null;
          } | null;
        } | null;
      }>;
    };
  };

  return payload.data?.items ?? [];
}

test.describe("EST-383 - generated ouvrage subdetail review", () => {
  test("reviews subdetail before insertion and exposes snapshot provenance on desktop and mobile", async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const projectName = buildEstimateName("EST383-SUBDETAIL");
    const { versionId } = await createEstimateViaApi(page, {
      projectName,
      title: "EST-383 Subdetail Review",
    });

    await openEstimateEditor(page, versionId);

    const dialog = await generateDraftFromText(
      page,
      [
        "Faux plafond suspendu acoustique",
        "- pose de faux plafond 120 m2",
      ].join("\n")
    );

    const firstCard = dialog
      .locator('[data-testid^="candidate-card-"]')
      .filter({ hasText: /Quantite\s*:/i })
      .first();

    await expect(firstCard).toBeVisible();

    await activateButton(firstCard.getByRole("button", { name: /^Sous-detail$/i }));
    await expect(
      dialog.getByRole("button", { name: /Valider le sous-detail/i })
    ).toBeVisible({ timeout: 60_000 });

    await activateButton(dialog.getByRole("button", { name: /Valider le sous-detail/i }));
    await expect(dialog.getByText(/Sous-detail valide/i)).toBeVisible({
      timeout: 60_000,
    });

    await activateButton(firstCard.getByRole("button", { name: /^Selectionner$/i }));
    await expect(dialog.getByText(/1\/1 ouvrage\(s\) selectionne\(s\) avec sous-detail valide/i)).toBeVisible();

    await activateButton(dialog.getByTestId("generated-ouvrage-insert-button"));
    await expect(dialog).toBeHidden({ timeout: 120_000 });

    await expect
      .poll(
        async () => {
          const items = await loadEstimateItems(page, versionId);
          return items.find(
            (item) =>
              item.item_type === "line" &&
              item.source_provider === "generated_ouvrage" &&
              item.source_metadata?.kind === "generated_ouvrage"
          );
        },
        { timeout: 120_000 }
      )
      .toBeTruthy();

    const items = await loadEstimateItems(page, versionId);
    const insertedLine = items.find(
      (item) =>
        item.item_type === "line" &&
        item.source_provider === "generated_ouvrage" &&
        item.source_metadata?.kind === "generated_ouvrage"
    );

    expect(insertedLine?.source_metadata?.subdetail_summary?.ds_cents).toBeGreaterThan(0);
    expect(
      insertedLine?.source_metadata?.subdetail_summary?.indicative_target_price_cents
    ).toBeGreaterThan(
      insertedLine?.source_metadata?.subdetail_summary?.ds_cents ?? 0
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Afficher la provenance IA/i }).first()).toBeVisible();

    const browser = page.context().browser();
    expect(browser).toBeTruthy();

    const storageState = await page.context().storageState();
    const mobileContext = await browser!.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState,
    });
    const mobilePage = await mobileContext.newPage();

    await mobilePage.goto(`/dashboard/estimates/${versionId}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await expect(
      mobilePage.getByRole("button", { name: /Afficher la provenance IA/i }).first()
    ).toBeVisible({ timeout: 60_000 });

    await mobileContext.close();
  });
});
