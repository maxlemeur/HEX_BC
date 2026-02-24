import path from "node:path";

import { expect, test } from "@playwright/test";

import { ensureMapping } from "./helpers";

test.describe("EST-262 - import DPGF", () => {
  test("Scenario 5: importer un DPGF et verifier le mapping", async ({ page }) => {
    const fixturePath = path.join(process.cwd(), "e2e/fixtures/dpgf-minimal.csv");

    await page.goto("/dashboard/imports");
    await expect(page.getByRole("heading", { name: /Import DPGF/i })).toBeVisible();

    await page.setInputFiles("#import-file-input", fixturePath);

    await page.getByRole("button", { name: /^Importer$/ }).click();

    await expect(
      page.getByText(/Import termine avec succes/i)
    ).toBeVisible({ timeout: 60_000 });

    const mapLink = page.getByRole("link", { name: /Mapper les colonnes/i });
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

    await page.getByRole("button", { name: /Apercu et validation/i }).click();
    await page.getByRole("button", { name: /Enregistrer le mapping/i }).click();

    await expect(
      page.getByText(/Mapping enregistre avec succes/i)
    ).toBeVisible({ timeout: 60_000 });

    await page.getByRole("link", { name: /Lier au catalogue/i }).click();

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
