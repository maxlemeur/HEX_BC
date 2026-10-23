import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";
import { expect } from "e2e";

import { requiredFixturePath } from "./owned-business-inputs";

import {
  armyTest,
  resolveDownload,
  createEstimateViaWizard,
  createLineViaApi,
  ownEstimate,
  waitForAutoSave,
} from "../critical/fixtures";
import { sdkResultsRoot } from "./sdk-results";

type LocalProduct = {
  id: string;
  reference: string;
  designation: string;
  unit: string;
  unit_price_cents: number;
};

// Failure modes reproduced before the fix: a cold panel loses its opening state;
// the designation replaces the unit in storage and DPGF; a manual unit draft can
// mask the newly associated unit. Exercise both association and replacement.
// This suite requires the isolated native stack from docs/testing/rls-required-check.md.
armyTest(
  "local article association and replacement preserve units and DPGF",
  { session: "army", tags: ["critical", "local", "business-corpus"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") {
      throw new Error("This fixture is restricted to the isolated loopback stack.");
    }
    const fixture = JSON.parse(await readFile(requiredFixturePath("E2E_LOCAL_ARTICLE_FIXTURE_PATH"), "utf8")) as {
      apiUrl: string;
      products: LocalProduct[];
    };
    expect(fixture.apiUrl).toBe(backend.origin);
    expect(fixture.products.map(({ reference, unit, unit_price_cents }) => ({ reference, unit, unit_price_cents }))).toEqual([
      { reference: "ARMY-CUIVRE", unit: "m", unit_price_cents: 1234 },
      { reference: "ARMY-ACIER", unit: "u", unit_price_cents: 2500 },
    ]);

    const directory = path.resolve(".e2e/army/critical/artifacts/business", army.runPrefix);
    await mkdir(directory, { recursive: true });
    // SDK downloads land in the diagnostic output's results/, not beside this evidence.
    const downloadRoot = sdkResultsRoot(".e2e/army/critical/results");
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} article association and replacement`,
    }, army);
    ownEstimate(army, ids);
    let title = `${army.runPrefix} Ligne locale`;
    const line = await createLineViaApi(browser, ids.versionId, title, { description: "ens", quantity: 2.5 });
    const observations: unknown[] = [];
    const saveEvidence = () => writeFile(path.join(directory, "panel-observations.json"), JSON.stringify({
      fixturePrefix: army.runPrefix, ...ids, lineId: line.id, observations,
    }, null, 2));
    await saveEvidence();
    const editUrl = `/dashboard/estimates/${ids.versionId}/edit`;
    await browser.goto(editUrl, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();

    for (const [index, product] of fixture.products.entries()) {
      const unit = screen.getByLabel(`Unité pour ${title}`, { exact: true });
      await expect(unit).toBeEnabled({ timeout: 30_000 });
      await unit.fill("lot");
      await unit.press("Tab");

      await screen.getByRole("button", `Plus d'actions pour ${title}`, { exact: true }).tap();
      const action = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
      await expect(action).toBeEnabled({ timeout: 30_000 });
      await action.tap();
      const search = screen.getByLabel("Rechercher dans le catalogue", { exact: true });
      // No second click or keyboard fallback may hide an opening regression.
      await expect(search).toBeVisible({ timeout: 10_000 });
      observations.push({ stage: "first-click", product: product.reference, opened: true });
      await saveEvidence();
      await search.fill(product.designation);
      await screen.getByText(product.designation, { exact: true }).first().tap();
      title = product.designation;
      await expect(screen.getByLabel(`Unité pour ${title}`, { exact: true })).toHaveValue(product.unit);

      const expectedTotals = index === 0 ? [3085, 617, 3702] : [6250, 1250, 7500];
      const saved = await waitForAutoSave(ui, ids.versionId, (snapshot) =>
        snapshot.items.some((item) => item.id === line.id && item.product_id === product.id &&
          item.unit_price_ht_cents === product.unit_price_cents) &&
        snapshot.version.total_ht_cents === expectedTotals[0] &&
        snapshot.version.total_tax_cents === expectedTotals[1] &&
        snapshot.version.total_ttc_cents === expectedTotals[2], army);
      await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toContainText("À jour", { timeout: 30_000 });
      const item = saved.items.find((candidate) => candidate.id === line.id)!;
      expect(item.description).toBe(product.unit);
      expect(item.title).toBe(title);
      expect(item.quantity).toBe(2.5);

      await browser.goto(editUrl, { waitUntil: "domcontentloaded" });
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      const reloadedUnit = await screen.getByLabel(`Unité pour ${title}`, { exact: true }).inputValue();
      expect(reloadedUnit).toBe(product.unit);
      expect(Number((await screen.getByLabel(`Quantité pour ${title}`, { exact: true }).inputValue()).replace(",", "."))).toBe(2.5);
      const price = await screen.getByLabel(`Prix d’achat unitaire HT pour ${title}`, { exact: true }).inputValue();
      expect(Math.round(Number(price.replace(/\s/g, "").replace(",", ".")) * 100)).toBe(product.unit_price_cents);

      await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
      const download = await browser.waitForDownload(
        () => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 }
      );
      const file = await resolveDownload(download);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file);
      const rows: ExcelJS.Row[] = [];
      workbook.getWorksheet("Données")!.eachRow((row) => {
        if (row.getCell(3).text.trim() === title) rows.push(row);
      });
      expect(rows).toHaveLength(1);
      const exported = {
        unit: rows[0].getCell(5).text.trim(), quantity: rows[0].getCell(4).value,
        price: rows[0].getCell(6).value, path: path.relative(downloadRoot, file),
        sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
      };
      observations.push({
        stage: index === 0 ? "association" : "replacement", product,
        persisted: { unit: item.description, quantity: item.quantity, price: item.unit_price_ht_cents },
        totals: [saved.version.total_ht_cents, saved.version.total_tax_cents, saved.version.total_ttc_cents],
        reloadedUnit, exported,
      });
      await saveEvidence();
      expect(exported.unit).toBe(product.unit);
      expect(exported.quantity).toBe(2.5);
      expect(exported.price).toBe(product.unit_price_cents / 100);
    }
  }
);
