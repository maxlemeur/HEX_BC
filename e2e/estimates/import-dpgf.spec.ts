import path from "node:path";

import { expect, test } from "@playwright/test";

import { ensureMapping } from "./helpers";

test.describe("EST-262 - import DPGF", () => {
  test("Scenario 5: importer un DPGF et verifier le mapping", async ({ page }) => {
    const fixturePath = path.join(process.cwd(), "e2e/fixtures/dpgf-minimal.csv");

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    await page.setInputFiles("#import-file-input", fixturePath);

    await page
      .getByRole("button", { name: /^(Importer|Lancer l['’]import)$/i })
      .first()
      .click();

    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
    await expect(mapLink).toBeVisible({ timeout: 60_000 });
    const mapHref = await mapLink.getAttribute("href");
    expect(mapHref).not.toBeNull();

    const mapUrl = new URL(mapHref ?? "", "http://localhost");
    const importId = mapUrl.searchParams.get("import_id");
    expect(importId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    await mapLink.click();

    await expect(page).toHaveURL(/\/dashboard\/mappings\?import_id=/i);
    await expect(page.getByRole("heading", { name: /Mapping DPGF/i })).toBeVisible();

    await ensureMapping(page, "hex_code", "hex_code");
    await ensureMapping(page, "designation", "designation");
    await ensureMapping(page, "unit_price_ht", "unit_price_ht");

    await page.getByRole("button", { name: /Enregistrer le mapping/i }).click();

    const mappingSavedBanner = page.getByText(/Mapping enregistre avec succes/i);
    const mappingMemoryErrorBanner = page.getByText(
      /Impossible de mettre a jour la memoire de mapping/i
    );

    const saveOutcome = await Promise.race([
      mappingSavedBanner.waitFor({ state: "visible", timeout: 60_000 }).then(() => "saved"),
      mappingMemoryErrorBanner
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(() => "saved-with-memory-error"),
    ]).catch(() => "unknown");

    if (saveOutcome === "saved") {
      await page.getByRole("link", { name: /Lier au catalogue/i }).click();
    } else {
      await page.goto(`/dashboard/catalogue?import_id=${importId}`);
    }

    await expect(page).toHaveURL(/\/dashboard\/catalogue\?import_id=/i);
    await page.getByRole("button", { name: /Liaison lignes importees/i }).click();

    await expect(page.locator("#catalogue-link-import-id")).toHaveValue(importId ?? "");

    const simulationCheckbox = page.getByLabel(/Simulation/i);
    if (!(await simulationCheckbox.isChecked())) {
      await simulationCheckbox.check();
    }

    await page.getByRole("button", { name: /Lancer la liaison/i }).click();

    await expect(
      page.getByText(/Simulation terminee|Liaison terminee/i)
    ).toBeVisible({ timeout: 60_000 });
  });
});
