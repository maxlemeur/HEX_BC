import { expect, test, type Page } from "@playwright/test";

import { buildEstimateName } from "./helpers";

async function createEstimateViaApi(
  page: Page,
  options: {
    projectName: string;
    title: string;
    dateDevis?: string;
    validiteJours?: number;
  }
) {
  const response = await page.request.post("/api/estimates", {
    failOnStatusCode: false,
    timeout: 60_000,
    data: {
      project: {
        name: options.projectName,
      },
      version: {
        title: options.title,
        date_devis: options.dateDevis ?? "2026-03-07",
        validite_jours: options.validiteJours ?? 30,
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
}

async function openGeneratedOuvrageDialog(page: Page) {
  const openButton = page.getByTestId("estimate-editor-open-generated-ouvrage-button");
  await expect(openButton).toBeVisible({ timeout: 60_000 });
  await openButton.click();
  const dialog = page.getByRole("dialog", { name: /Generer des ouvrages/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function activateButton(locator: ReturnType<Page["getByRole"]>) {
  await locator.focus();
  await locator.press("Enter");
}

async function generateDraftFromText(page: Page, text: string) {
  const dialog = await openGeneratedOuvrageDialog(page);

  await expect(dialog.getByText(/Sans lot choisi/i)).toBeVisible();
  await dialog.getByLabel(/Texte source/i).fill(text);
  const generateButton = dialog.getByTestId("generated-ouvrage-generate-button");
  await activateButton(generateButton);

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
        parent_id: string | null;
        item_type: string;
        title: string | null;
        source_provider?: string | null;
        source_metadata?: {
          kind?: string | null;
        } | null;
      }>;
    };
  };

  return payload.data?.items ?? [];
}

async function findGeneratedFallbackSection(page: Page, versionId: string) {
  const items = await loadEstimateItems(page, versionId);
  return items.find(
    (item) =>
      item.item_type === "section" &&
      item.parent_id === null &&
      item.title === "A classer"
  );
}

test.describe("EST-381 - generated ouvrages review", () => {
  test("can reject all generated candidates and mark the draft as discarded", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const projectName = buildEstimateName("EST381-REJECT");
    const { versionId } = await createEstimateViaApi(page, {
      projectName,
      title: "EST-381 Reject All",
    });

    await page.goto(`/dashboard/estimates/${versionId}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const dialog = await generateDraftFromText(
      page,
      [
        "Lot technique ventilation",
        "- pose de gaine souple 12 ml",
        "- reprise ponctuelle de support 4 u",
        "- rebouchage des trémies 2 u",
      ].join("\n")
    );

    let rejectCount = await dialog.getByRole("button", { name: /^Rejeter$/i }).count();
    expect(rejectCount).toBeGreaterThan(0);

    while (rejectCount > 0) {
      await dialog.getByRole("button", { name: /^Rejeter$/i }).first().click();
      await expect
        .poll(
          async () => dialog.getByRole("button", { name: /^Rejeter$/i }).count(),
          { timeout: 30_000 }
        )
        .toBeLessThan(rejectCount);
      rejectCount = await dialog.getByRole("button", { name: /^Rejeter$/i }).count();
    }

    await expect(dialog.getByText(/Toutes les propositions ont ete ecartees/i)).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Inserer les ouvrages selectionnes/i })
    ).toHaveCount(0);
  });

  test("inserts generated ouvrages into the explicit fallback section when no lot is chosen", async ({
    page,
  }) => {
    test.setTimeout(180_000);

    const projectName = buildEstimateName("EST381-INSERT");
    const { versionId } = await createEstimateViaApi(page, {
      projectName,
      title: "EST-381 Insert Fallback",
    });

    await page.goto(`/dashboard/estimates/${versionId}/edit`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    const dialog = await generateDraftFromText(
      page,
      [
        "Faux plafond suspendu avec isolation",
        "- pose de faux plafond 120 m2",
        "- fourniture et pose d'isolant laine minerale 120 m2",
        "- reprise ponctuelle des joints 20 ml",
      ].join("\n")
    );

    const insertableCard = dialog
      .locator('[data-testid^="candidate-card-"]')
      .filter({ hasText: /Quantite\s*:/i })
      .first();

    await expect(insertableCard).toBeVisible();
    await activateButton(insertableCard.getByRole("button", { name: /^Modifier$/i }));
    await dialog.getByTestId("edit-lot").first().selectOption("");
    await activateButton(dialog.getByRole("button", { name: /^Valider$/i }).first());
    await activateButton(
      dialog
        .locator('[data-testid^="candidate-card-"]')
        .filter({ hasText: /Quantite\s*:/i })
        .first()
        .getByRole("button", { name: /^Selectionner$/i })
    );

    await activateButton(dialog.getByTestId("generated-ouvrage-insert-button"));

    await expect
      .poll(async () => findGeneratedFallbackSection(page, versionId), {
        timeout: 120_000,
      })
      .toBeTruthy();

    const items = await loadEstimateItems(page, versionId);
    const fallbackSection = await findGeneratedFallbackSection(page, versionId);

    expect(fallbackSection, "fallback section should be created at root level").toBeTruthy();
    expect(fallbackSection?.source_provider).toBe("generated_ouvrage");

    const generatedLine = items.find(
      (item) =>
        item.item_type === "line" &&
        item.parent_id === fallbackSection?.id &&
        item.source_provider === "generated_ouvrage"
    );

    expect(generatedLine, "generated line should be inserted under fallback section").toBeTruthy();
    expect(generatedLine?.source_metadata?.kind).toBe("generated_ouvrage");
  });
});
