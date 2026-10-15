import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import ExcelJS from "exceljs";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  createLineViaApi,
  ownEstimate,
  readEstimate,
  recordEvidence,
  resolveDownload,
  setLineCoreValues,
  waitForAutoSave,
  type ArmyEstimate,
  type ArmyState,
} from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];
type LineOracle = { title: string; quantity: number; price: number; ht: number; tax: number; ttc: number };

// Failure modes and independent centime oracles precede this suite in the runbook.
// In particular, aggregate TVA rounding would incorrectly produce 4 001 cents.
function oracle(army: ArmyState, mainQuantity: 2 | 3 = 2): LineOracle[] {
  return [
    { title: `${army.runPrefix} Principale`, quantity: mainQuantity, price: 10000, ht: mainQuantity === 2 ? 20000 : 30000, tax: mainQuantity === 2 ? 4000 : 6000, ttc: mainQuantity === 2 ? 24000 : 36000 },
    { title: `${army.runPrefix} Centime B`, quantity: 1, price: 2, ht: 2, tax: 0, ttc: 2 },
    { title: `${army.runPrefix} Centime C`, quantity: 1, price: 2, ht: 2, tax: 0, ttc: 2 },
  ];
}

function hasSavedInputs(snapshot: ArmyEstimate, expected: LineOracle[]) {
  return expected.every((line) => snapshot.items.some((item) =>
    item.item_type === "line" && item.title === line.title &&
    item.quantity === line.quantity && item.unit_price_ht_cents === line.price &&
    item.line_total_ht_cents === line.ht && item.line_tax_cents === line.tax &&
    item.line_total_ttc_cents === line.ttc
  )) && snapshot.version.total_ht_cents === expected.reduce((sum, line) => sum + line.ht, 0) &&
    snapshot.version.total_tax_cents === expected.reduce((sum, line) => sum + line.tax, 0) &&
    snapshot.version.total_ttc_cents === expected.reduce((sum, line) => sum + line.ttc, 0);
}

function settings(snapshot: ArmyEstimate) {
  const version = snapshot.version;
  return {
    calc_engine_version: version.calc_engine_version,
    currency: version.currency,
    margin_mode: version.margin_mode,
    margin_multiplier: version.margin_multiplier,
    discount_bp: version.discount_bp,
    discount_mode: version.discount_mode,
    global_coefficient: version.global_coefficient,
    tax_rate_bp: version.tax_rate_bp,
    rounding_mode: version.rounding_mode,
    contractor_role: version.contractor_role,
  };
}

function hierarchy(snapshot: ArmyEstimate) {
  return snapshot.items.map((item) => ({
    type: item.item_type,
    title: item.title,
    position: item.position,
    parent: item.parent_id ? snapshot.items.find((parent) => parent.id === item.parent_id)?.title : null,
    quantity: item.quantity,
    price: item.unit_price_ht_cents,
  })).sort((a, b) => a.title.localeCompare(b.title));
}

function provenance(snapshot: ArmyEstimate) {
  return snapshot.items.filter((item) => item.item_type === "line").map((item) => ({
    title: item.title, provider: item.source_provider, file: item.source_file_name,
    page: item.source_page, jobId: item.source_job_id, metadata: item.source_metadata,
  })).sort((a, b) => a.title.localeCompare(b.title));
}

function evidence(snapshot: ArmyEstimate) {
  return {
    project: snapshot.project,
    version: {
      id: snapshot.version.id,
      title: snapshot.version.title,
      versionNumber: snapshot.version.version_number,
      status: snapshot.version.status,
      settings: settings(snapshot),
      ht: snapshot.version.total_ht_cents,
      tax: snapshot.version.total_tax_cents,
      ttc: snapshot.version.total_ttc_cents,
    },
    items: snapshot.items.map((item) => ({
      id: item.id, parentId: item.parent_id, position: item.position,
      type: item.item_type, title: item.title, quantity: item.quantity,
      price: item.unit_price_ht_cents, ht: item.line_total_ht_cents,
      tax: item.line_tax_cents, ttc: item.line_total_ttc_cents,
      source: {
        provider: item.source_provider, file: item.source_file_name,
        page: item.source_page, jobId: item.source_job_id, metadata: item.source_metadata,
      },
    })),
  };
}

function assertFinancialSnapshot(snapshot: ArmyEstimate, expected: LineOracle[], copied = false) {
  expect(settings(snapshot)).toEqual({
    calc_engine_version: 2, currency: "EUR", margin_mode: "fixed", margin_multiplier: 1,
    discount_bp: 0, discount_mode: "simple", global_coefficient: 1, tax_rate_bp: 2000,
    rounding_mode: "none", contractor_role: "principal",
  });
  expect(snapshot.version.status).toBe("draft");
  expect(snapshot.version.seal_hash).toBeNull();
  expect(snapshot.version.total_ht_cents).toBe(copied ? 30004 : 20004);
  expect(snapshot.version.total_tax_cents).toBe(copied ? 6000 : 4000);
  expect(snapshot.version.total_ttc_cents).toBe(copied ? 36004 : 24004);
  const lines = snapshot.items.filter((item) => item.item_type === "line");
  expect(lines).toHaveLength(3);
  for (const line of expected) {
    const matches = lines.filter((item) => item.title === line.title);
    expect(matches, `One persisted line must match ${line.title}`).toHaveLength(1);
    const item = matches[0];
    expect(item.parent_id).not.toBeNull();
    expect(snapshot.items.some((parent) => parent.id === item.parent_id && parent.item_type === "section")).toBe(true);
    expect({
      quantity: item.quantity, price: item.unit_price_ht_cents,
      ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents,
    }).toEqual({ quantity: line.quantity, price: line.price, ht: line.ht, tax: line.tax, ttc: line.ttc });
    expect(item.line_nature).toBe("supply_only");
    expect(item.k_fo).toBe(1);
    expect(item.h_mo).toBe(0);
    expect(item.tax_rate_bp).toBe(2000);
  }
}

async function createFinancialFixture(ui: Ui, army: ArmyState, label: string) {
  const ids = await createEstimateViaWizard(ui, {
    projectName: army.projectName,
    title: `${army.runPrefix} ${label}`,
  }, army);
  ownEstimate(army, ids);
  const expected = oracle(army);
  for (const [index, line] of expected.entries()) {
    await createLineViaApi(ui.browser, ids.versionId, line.title, label === "duplication" ? {
      source_provider: "manual", source_file_name: `${army.runPrefix}-manual-source.txt`,
      source_page: index + 1,
    } : {});
  }
  await ui.browser.reload();
  await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
  await setLineCoreValues(ui, expected[0].title, { quantity: "4", unitPriceHt: "99,99" });
  for (const line of expected) {
    await setLineCoreValues(ui, line.title, {
      quantity: String(line.quantity), unitPriceHt: line.price === 2 ? "0,02" : "100,00",
    });
  }
  const snapshot = await waitForAutoSave(ui, ids.versionId, (saved) => hasSavedInputs(saved, expected), army);
  await recordEvidence(army, `${label}-persisted`, { oracle: expected, snapshot: evidence(snapshot) });
  assertFinancialSnapshot(snapshot, expected);
  return { ids, expected, snapshot };
}

function worksheet(workbook: ExcelJS.Workbook, name: string) {
  const sheet = workbook.getWorksheet(name);
  if (!sheet) throw new Error(`Downloaded workbook is missing the ${name} worksheet.`);
  return sheet;
}

function matchingRows(sheet: ExcelJS.Worksheet, titleColumn: number, title: string) {
  const rows: ExcelJS.Row[] = [];
  sheet.eachRow((row, index) => {
    if (index > 1 && row.getCell(titleColumn).text.trim() === title) rows.push(row);
  });
  expect(rows, `Downloaded ${sheet.name} must contain ${title} exactly once`).toHaveLength(1);
  return rows[0];
}

async function downloadedWorkbook(download: { path: string; absolutePath: string; suggestedFilename: string }) {
  // Read the exact SDK download, after checking its current-run containment.
  const absolutePath = await resolveDownload(download);
  const bytes = await readFile(absolutePath);
  expect(download.suggestedFilename).toMatch(/\.xlsx$/i);
  expect(Array.from(bytes.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(absolutePath);
  return {
    workbook,
    artifact: { path: absolutePath, sdkRelativePath: download.path, suggestedFilename: download.suggestedFilename, sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

type CatalogueSuggestion = {
  product_id: string;
  product_reference: string | null;
  product_designation: string;
  unit: string | null;
};

// Read-only discovery of an existing catalogue article of the test tenant whose unit
// differs from its designation, so that a unit overwritten by the designation is visible.
// The suite never creates or modifies catalogue records.
async function findCatalogueArticleWithUnit(browser: Ui["browser"], versionId: string) {
  for (const query of ["re", "en", "an", "er", "on", "ou", "ca", "pl"]) {
    const response = await apiRequest<{ ok: boolean; data: { suggestions: CatalogueSuggestion[] } }>(
      browser, "GET", `/api/estimates/${versionId}/suggest-prices?q=${query}`
    );
    expect(response.status).toBe(200);
    const candidate = response.body.data.suggestions.find((suggestion) => {
      const unit = suggestion.unit?.trim() ?? "";
      const designation = suggestion.product_designation.trim();
      return unit.length > 0 && designation.length >= 2 && unit !== designation;
    });
    if (candidate) return candidate;
  }
  throw new Error("Missing fixture: the test tenant has no catalogue article with a unit distinct from its designation.");
}

armyTest(
  "creation persists final French price inputs and exact per-line VAT after reload",
  { session: "army", tags: ["critical"], timeout: 180_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { ids, expected } = await createFinancialFixture(ui, army, "autosave");
    const nativeDialogs: Array<{ messageLength: number }> = [];
    const removeDialogObserver = await browser.onDialog(async (dialog) => {
      nativeDialogs.push({ messageLength: dialog.message.length });
      await dialog.dismiss();
      await recordEvidence(army, "autosave-reload-dialog", { ids, nativeDialogs });
      throw new Error("The acknowledged autosave must reload without a native dialog.");
    });
    const reloadState = () => browser.evaluate(() => ({
      pathname: window.location.pathname,
      readyState: document.readyState,
      timeOrigin: performance.timeOrigin,
      navigations: performance.getEntriesByType("navigation").map((entry) => ({
        type: (entry as PerformanceNavigationTiming).type,
        domContentLoadedEventEnd: (entry as PerformanceNavigationTiming).domContentLoadedEventEnd,
        loadEventEnd: (entry as PerformanceNavigationTiming).loadEventEnd,
      })),
      autosaveStatus: document.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent?.trim() ?? null,
    }));
    let reloadCompleted = false;
    try {
      await recordEvidence(army, "autosave-before-reload", { ids, state: await reloadState() });
      await browser.reload();
      reloadCompleted = true;
      expect(nativeDialogs).toEqual([]);
    } finally {
      try {
        const state = await reloadState().catch(() => null);
        await recordEvidence(army, "autosave-after-reload", { ids, reloadCompleted, nativeDialogs, state });
      } finally {
        await removeDialogObserver();
      }
    }
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const controls = [];
    for (const line of expected) {
      const quantity = await screen.getByLabel(`Quantité pour ${line.title}`, { exact: true }).inputValue();
      const price = await screen.getByLabel(`Prix d’achat unitaire HT pour ${line.title}`, { exact: true }).inputValue();
      controls.push({ title: line.title, quantity, price });
      expect(Number(quantity.replace(",", "."))).toBe(line.quantity);
      expect(Math.round(Number(price.replace(/\s/g, "").replace(",", ".")) * 100)).toBe(line.price);
    }
    const reloaded = await readEstimate(browser, ids.versionId);
    await recordEvidence(army, "autosave-reloaded", { oracle: expected, controls, snapshot: evidence(reloaded) });
    assertFinancialSnapshot(reloaded, expected);
  }
);

armyTest(
  "duplication preserves hierarchy and finances while edits leave the source unchanged",
  { session: "army", tags: ["critical"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const source = await createFinancialFixture(ui, army, "duplication");
    const sourceProvenance = provenance(source.snapshot);
    expect(sourceProvenance).toEqual(source.expected.map((line, index) => ({
      title: line.title, provider: "manual", file: `${army.runPrefix}-manual-source.txt`,
      page: index + 1, jobId: null, metadata: {},
    })).sort((a, b) => a.title.localeCompare(b.title)));
    const duplicated = await apiRequest<{ ok: boolean; data: { version_id: string } }>(
      browser, "POST", `/api/estimates/${source.ids.versionId}/duplicate`
    );
    await recordEvidence(army, "duplication-response", { sourceVersionId: source.ids.versionId, ...duplicated });
    expect(duplicated.status).toBe(201);
    expect(duplicated.body.ok).toBe(true);
    const copyId = duplicated.body.data.version_id;
    expect(copyId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(copyId).not.toBe(source.ids.versionId);
    ownEstimate(army, { projectId: source.ids.projectId, versionId: copyId });
    const copyBefore = await readEstimate(browser, copyId);
    await recordEvidence(army, "duplication-before-edit", {
      source: evidence(source.snapshot), copy: evidence(copyBefore),
      sourceHierarchy: hierarchy(source.snapshot), copyHierarchy: hierarchy(copyBefore),
    });
    assertFinancialSnapshot(copyBefore, source.expected);
    expect(copyBefore.project.id).toBe(source.ids.projectId);
    expect(copyBefore.version.version_number).toBe(Number(source.snapshot.version.version_number) + 1);
    expect(hierarchy(copyBefore)).toEqual(hierarchy(source.snapshot));
    expect(provenance(copyBefore)).toEqual(sourceProvenance);
    const sourceItemIds = new Set(source.snapshot.items.map((item) => item.id));
    expect(copyBefore.items.some((item) => sourceItemIds.has(item.id))).toBe(false);
    await browser.goto(`/dashboard/estimates/${copyId}/edit`, { waitUntil: "domcontentloaded" });
    const changedOracle = oracle(army, 3);
    await setLineCoreValues(ui, changedOracle[0].title, { quantity: "3", unitPriceHt: "100,00" });
    const copyAfter = await waitForAutoSave(ui, copyId, (saved) => hasSavedInputs(saved, changedOracle), army);
    const sourceAfter = await readEstimate(browser, source.ids.versionId);
    await recordEvidence(army, "duplication-independent", {
      source: evidence(sourceAfter), copy: evidence(copyAfter), copyOracle: changedOracle,
    });
    assertFinancialSnapshot(copyAfter, changedOracle, true);
    assertFinancialSnapshot(sourceAfter, source.expected);
    expect(hierarchy(sourceAfter)).toEqual(hierarchy(source.snapshot));
    expect(provenance(copyAfter)).toEqual(sourceProvenance);
    expect(evidence(sourceAfter)).toEqual(evidence(source.snapshot));
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const copyReloaded = await readEstimate(browser, copyId);
    await recordEvidence(army, "duplication-copy-reloaded", {
      snapshot: evidence(copyReloaded), provenance: provenance(copyReloaded),
    });
    expect(evidence(copyReloaded)).toEqual(evidence(copyAfter));
    expect(Number((await screen.getByLabel(`Quantité pour ${changedOracle[0].title}`, { exact: true }).inputValue()).replace(",", "."))).toBe(3);
    await browser.goto(`/dashboard/estimates/${source.ids.versionId}/edit`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const sourceReloaded = await readEstimate(browser, source.ids.versionId);
    await recordEvidence(army, "duplication-source-reopened", {
      snapshot: evidence(sourceReloaded), provenance: provenance(sourceReloaded),
    });
    expect(evidence(sourceReloaded)).toEqual(evidence(source.snapshot));
    expect(Number((await screen.getByLabel(`Quantité pour ${source.expected[0].title}`, { exact: true }).inputValue()).replace(",", "."))).toBe(2);
  }
);

armyTest(
  "downloaded XLSX and DPGF cells, BDC download and printed content match the persisted estimate",
  { session: "army", tags: ["critical"], timeout: 180_000 },
  async ({ app, screen, browser, army }) => {
    const { ids, expected, snapshot } = await createFinancialFixture({ app, screen, browser }, army, "exports");
    await screen.getByRole("button", "Exporter", { exact: true }).tap();
    const standard = await downloadedWorkbook(await browser.waitForDownload(
      () => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap(), { timeout: 60_000 }
    ));
    const sheet = worksheet(standard.workbook, "Devis");
    expect(sheet.getRow(1).values).toEqual([undefined, "Poste", "Désignation", "Unité", "Quantité", "PU HT", "Total HT", "TVA", "Total TTC"]);
    const standardRows = expected.map((line) => {
      const row = matchingRows(sheet, 2, line.title);
      return { title: row.getCell(2).text.trim(), values: [4, 5, 6, 7, 8].map((column) => row.getCell(column).value) };
    });
    const summary = worksheet(standard.workbook, "Resume");
    const standardFooter = Object.fromEntries(["Version ID", "Projet", "Total HT", "Total TVA", "Total TTC"].map((label) =>
      [label, matchingRows(summary, 1, label).getCell(2).value]
    ));
    await recordEvidence(army, "standard-xlsx", { artifact: standard.artifact, rows: standardRows, summary: standardFooter });
    expect(standardRows).toEqual(expected.map((line) => ({
      title: line.title, values: [line.quantity, line.price / 100, line.ht / 100, line.tax / 100, line.ttc / 100],
    })));
    expect(standardFooter).toEqual({ "Version ID": ids.versionId, "Projet": army.projectName, "Total HT": 200.04, "Total TVA": 40, "Total TTC": 240.04 });
    await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const dpgf = await downloadedWorkbook(await browser.waitForDownload(
      () => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 }
    ));
    const dpgfSheet = worksheet(dpgf.workbook, "Données");
    const dpgfRows = expected.map((line) => {
      const row = matchingRows(dpgfSheet, 3, line.title);
      return {
        type: row.getCell(1).value, title: row.getCell(3).text.trim(),
        values: [4, 6, 8, 9, 10].map((column) => row.getCell(column).value),
      };
    });
    const versionMetadata = matchingRows(worksheet(dpgf.workbook, "Metadata"), 1, "Version").getCell(2).value;
    await recordEvidence(army, "dpgf-xlsx", { artifact: dpgf.artifact, rows: dpgfRows, versionMetadata });
    expect(dpgfRows).toEqual(expected.map((line) => ({ type: "line", title: line.title, values: [line.quantity, line.price / 100, 1, 0, 1] })));
    expect(versionMetadata).toBe(`v${snapshot.version.version_number} - ${snapshot.version.title}`);
    await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const bdc = await downloadedWorkbook(await browser.waitForDownload(
      () => screen.getByTestId("estimate-page-toolbar-export-bdc-button").tap(), { timeout: 60_000 }
    ));
    expect(bdc.workbook.worksheets.length).toBeGreaterThan(0);
    await recordEvidence(army, "bdc-xlsx", { artifact: bdc.artifact, worksheets: bdc.workbook.worksheets.map(item => item.name) });
    await browser.goto(`/dashboard/estimates/${ids.versionId}/print?price_mode=unit_and_total&detail_level=lines`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Mise en page / imprimer", { exact: true })).toBeVisible();
    await expect(screen.getByText(army.projectName, { exact: true }).last()).toBeVisible();
    for (const line of expected) await expect(screen.getByText(line.title, { exact: true })).toBeVisible();
    const print = await browser.evaluate(() => {
      const normalize = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
      return {
        rows: Array.from(document.querySelectorAll("table tbody tr")).map((row) =>
          Array.from(row.querySelectorAll("td")).map((cell) => normalize(cell.textContent))
        ),
        footer: Array.from(document.querySelectorAll("span"))
          .filter((span) => ["Total HT", "TVA", "Total TTC"].includes(normalize(span.textContent)))
          .map((span) => ({ label: normalize(span.textContent), value: normalize(span.parentElement?.children[1]?.textContent ?? null) })),
      };
    });
    await recordEvidence(army, "printed-content", { versionId: ids.versionId, url: await browser.url(), ...print });
    expect(print.footer).toEqual([
      { label: "Total HT", value: "200,04 €" }, { label: "TVA", value: "40,00 €" }, { label: "Total TTC", value: "240,04 €" },
    ]);
    for (const line of expected) {
      const printed = print.rows.filter((row) => row[0] === line.title);
      expect(printed).toEqual([[line.title, String(line.quantity), "-", line.price === 2 ? "0,02 €" : "100,00 €", line.ht === 2 ? "0,02 €" : "200,00 €"]]);
    }
  }
);

// Legacy full-lifecycle scenario 2 created an empty estimate. Keep its concrete
// blocking gate, with one deterministic outcome instead of optional transitions.
armyTest("LIF01 an empty estimate exposes blocking checks and remains a draft", {
  session: "army", tags: ["critical"], timeout: 120_000,
}, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, {
    projectName: army.projectName, title: "ARMY empty estimate send gate",
  }, army);
  const send = screen.getByRole("button", "Envoyer", { exact: true });
  await expect(send).toBeEnabled({ timeout: 30_000 });
  await send.tap();
  const dialog = screen.getByRole("dialog", "Vérification avant envoi", { exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", /Bloquants/i)).toBeVisible();
  await expect(dialog.getByRole("button", "Envoyer", { exact: true })).toBeDisabled();
  await dialog.getByRole("button", /Annuler|Fermer/i).first().tap();
  await expect(dialog).toBeHidden();
  const snapshot = await readEstimate(browser, ids.versionId);
  expect(snapshot.version.status).toBe("draft");
  expect(snapshot.items.filter(item => item.item_type === "line")).toHaveLength(0);
  await recordEvidence(army, "empty-estimate-gating", { ids, status: snapshot.version.status, lineCount: 0 });
});

// Failure modes: associating a catalogue article must not write the article designation
// into the line unit (stored in estimate_items.description), and the DPGF "Unité" column
// must carry the article unit, never its designation.
armyTest(
  "associating a catalogue article keeps a unit, not the designation, in the line and the DPGF",
  { session: "army", tags: ["critical"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} article-unit`,
    }, army);
    ownEstimate(army, ids);
    const lineTitle = `${army.runPrefix} Ligne article`;
    const line = await createLineViaApi(browser, ids.versionId, lineTitle, { description: "ens" });
    const article = await findCatalogueArticleWithUnit(browser, ids.versionId);
    const designation = article.product_designation.trim();
    const expectedUnit = article.unit!.trim();
    await recordEvidence(army, "article-unit-fixture", {
      versionId: ids.versionId, lineId: line.id, initialUnit: "ens",
      article: { productId: article.product_id, reference: article.product_reference, designation, unit: expectedUnit },
    });

    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    // The menu entry stays disabled while the editor is still acquiring its draft lock.
    await screen.getByRole("button", `Plus d'actions pour ${lineTitle}`, { exact: true }).tap();
    const associate = screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true });
    await expect(associate).toBeEnabled({ timeout: 30_000 });
    await associate.tap();
    const search = screen.getByLabel("Rechercher dans le catalogue", { exact: true });
    await expect(search).toBeVisible();
    await search.fill(designation);
    await screen.getByText(designation, { exact: true }).first().tap();

    const saved = await waitForAutoSave(ui, ids.versionId, (snapshot) =>
      snapshot.items.some((item) => item.id === line.id && item.product_id === article.product_id), army);
    const associated = saved.items.find((item) => item.id === line.id)!;
    await recordEvidence(army, "article-unit-persisted", {
      lineId: line.id, productId: associated.product_id, title: associated.title, unit: associated.description,
    });
    expect(associated.title).toBe(designation);
    expect(associated.description, "The line unit must be the article unit").toBe(expectedUnit);

    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    expect(await screen.getByLabel(`Unité pour ${designation}`, { exact: true }).inputValue()).toBe(expectedUnit);

    await screen.getByTestId("estimate-page-toolbar-more-actions-button").tap();
    const dpgf = await downloadedWorkbook(await browser.waitForDownload(
      () => screen.getByTestId("estimate-page-toolbar-export-dpgf-button").tap(), { timeout: 60_000 }
    ));
    const row = matchingRows(worksheet(dpgf.workbook, "Données"), 3, designation);
    const dpgfUnit = row.getCell(5).text.trim();
    await recordEvidence(army, "article-unit-dpgf", { artifact: dpgf.artifact, designation, unit: dpgfUnit });
    expect(dpgfUnit, "The DPGF Unité column must carry the article unit").toBe(expectedUnit);
  }
);
