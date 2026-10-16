import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";
import * as XLSX from "xlsx";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  readEstimate,
  recordEvidence,
  type ArmyEstimate,
  type ArmyItem,
  type ArmyState,
} from "./fixtures";

// Sub-lot 2.3 (P-16, D11, U-03, C-01): failure modes and expected values are in
// docs/testing/estimate-input-import-2.3.md. Written red before the 2.3 implementation.

type Envelope<T> = { ok: boolean; data: T };
type ImportRecord = {
  id: string;
  project_id: string;
  filename: string;
  source_format: string;
  status: string;
  row_count: number;
};
type LaborRole = { id: string; name: string; hourly_rate_cents: number; is_active: boolean };
type Suggestions = { suggestions: Record<string, string>; source_columns: string[] };

// Real OPTIMA header row (Feuil1!A1:O1 of the workbooks in docs/prd_file), line breaks included.
const OPTIMA_HEADERS = [
  "N°", "Désignation", "Uté", "Qté", "Prix\nUnitaire", "Prix\nTotal", "PR Fourniture unitaire",
  "PR Total\nfourniture", "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total",
  "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire",
];
// The keys the upload stores for those headers (accents and separators normalized).
const UPLOADED_COLUMNS = [
  "N", "Designation", "Ute", "Qte", "Prix_Unitaire", "Prix_Total", "PR_Fourniture_unitaire",
  "PR_Total_fourniture", "Tps_pose_unitaire", "Tps_pose_unitaire_majore", "Tps_pose_total",
  "Coeff_FO", "Coeff_MO", "Majoration_MO", "Taux_horaire",
];
// Every suggestion outside these value targets must be a check column or a workbook parameter.
const EXPECTED_VALUE_TARGETS = {
  Designation: "designation",
  Ute: "unit",
  Qte: "quantity",
  PR_Fourniture_unitaire: "unit_price_ht",
  Tps_pose_unitaire: "labor_hours_per_unit",
  Majoration_MO: "h_mo_majoration_additive",
};
const CONTROL_COLUMNS = ["Prix_Unitaire", "Prix_Total", "Tps_pose_unitaire_majore", "Tps_pose_total"];
const PARAMETER_COLUMNS = ["Coeff_FO", "Coeff_MO", "Taux_horaire"];
const ROLE_TARGET = /^(control|param|unsupported)_/;

// Workbook parameters, row 2 (Feuil1!L2:O2): coefficients 1,3 / 1,3, additive majoration 0, 40 €/h.
const PARAMETERS = { coeffFo: 1.3, coeffMo: 1.3, majorationMo: 0, hourlyRateEuros: 40 };

// Oracle lines O1..O7 (reproductions/d4/D4-extraits.json): numbers only, no client designation
// (design §5.6). Stored line hours = Q × h/u; totals at fixed margin 1,30 and 40 €/h.
const ORACLE = [
  { id: "O1", unit: "ml", quantity: 20, supplyEuros: 54.66, hoursPerUnit: 1.991, lineHours: 39.82, totalCents: 349180 },
  { id: "O2", unit: "U", quantity: 3, supplyEuros: 95.63, hoursPerUnit: 1.75, lineHours: 5.25, totalCents: 64596 },
  { id: "O3", unit: "m2", quantity: 21, supplyEuros: 58.5, hoursPerUnit: 0, lineHours: 0, totalCents: 159705 },
  { id: "O4", unit: "ml", quantity: 1139, supplyEuros: 3.02, hoursPerUnit: 0.2, lineHours: 227.8, totalCents: 1631731 },
  { id: "O5", unit: "U", quantity: 1, supplyEuros: 20, hoursPerUnit: 6, lineHours: 6, totalCents: 33800 },
  { id: "O6", unit: "ml", quantity: 282, supplyEuros: 91.86, hoursPerUnit: 0.998, lineHours: 281.436, totalCents: 4831055 },
  { id: "O7", unit: "ml", quantity: 8, supplyEuros: 8.83, hoursPerUnit: 1.3, lineHours: 10.4, totalCents: 63263 },
];
// Σ 71 333,30 € (design §14, 2.3). Tax and TTC are what the unchanged v2 engine derives from it.
const EXPECTED_TOTALS = { ht: 7133330, tax: 1426666, ttc: 8559996 };

function workbookRows(prefix: string, parameters: typeof PARAMETERS = PARAMETERS) {
  const parameterRow = ["", "", "", 0, null, null, null, null, null, null, null,
    parameters.coeffFo, parameters.coeffMo, parameters.majorationMo, parameters.hourlyRateEuros];
  const lines = ORACLE.map((line) => {
    // Same cached values as the workbook formulas: J = I + I × N2, E = G × L2 + J × M2 × O2.
    const markedUpHours = line.hoursPerUnit + line.hoursPerUnit * parameters.majorationMo;
    const unitPrice = line.supplyEuros * parameters.coeffFo + markedUpHours * parameters.coeffMo * parameters.hourlyRateEuros;
    return [
      "", `${prefix} ${line.id}`, line.unit, line.quantity, unitPrice,
      Math.round(line.quantity * unitPrice * 100) / 100, line.supplyEuros, line.quantity * line.supplyEuros,
      line.hoursPerUnit, markedUpHours, line.quantity * markedUpHours, null, null, null, null,
    ];
  });
  return [OPTIMA_HEADERS, parameterRow, ...lines];
}

function businessSnapshot(estimate: ArmyEstimate) {
  const { version } = estimate;
  return {
    version: {
      id: version.id, project_id: version.project_id, version_number: version.version_number,
      calc_engine_version: version.calc_engine_version, margin_mode: version.margin_mode,
      margin_multiplier: version.margin_multiplier, tax_rate_bp: version.tax_rate_bp,
      total_ht_cents: version.total_ht_cents, total_tax_cents: version.total_tax_cents,
      total_ttc_cents: version.total_ttc_cents,
    },
    lines: estimate.items.filter((item) => item.item_type === "line").map((item) => ({
      id: item.id, title: item.title, description: item.description, quantity: item.quantity,
      unit_price_ht_cents: item.unit_price_ht_cents, k_fo: item.k_fo, h_mo: item.h_mo,
      h_mo_majoration: item.h_mo_majoration, k_mo: item.k_mo, labor_role_id: item.labor_role_id,
      line_total_ht_cents: item.line_total_ht_cents, source_metadata: item.source_metadata,
    })),
  };
}

armyTest(
  "OPTIMA workbook imported into a fixed-margin 1,30 v2 stores h/u × Q line hours and exact totals",
  { session: "army", tags: ["critical", "dpgf", "optima"], requires: ["browser"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    let projectId: string | null = null;
    let importId: string | null = null;
    let importedVersionId: string | null = null;
    let stage = "write-workbook";
    const rows = workbookRows(army.projectName);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Feuil1");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
    const filename = `${army.projectName}-optima.xlsx`;
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
    await mkdir(directory, { recursive: true });
    const fixturePath = path.join(directory, filename);
    await writeFile(fixturePath, bytes);
    await recordEvidence(army, "optima-input", {
      fixturePath, filename, sha256: createHash("sha256").update(bytes).digest("hex"),
      headers: OPTIMA_HEADERS, parameters: PARAMETERS, rows, oracle: ORACLE,
      expected: { valueTargets: EXPECTED_VALUE_TARGETS, controls: CONTROL_COLUMNS, parameters: PARAMETER_COLUMNS, totals: EXPECTED_TOTALS },
    });

    try {
      stage = "create-v2-margin-1-30";
      const initial = await createEstimateViaWizard(
        { app, screen, browser },
        { projectName: army.projectName, title: `${army.projectName} initial`, marginPercent: "30" },
        army,
      );
      projectId = initial.projectId;
      const before = await readEstimate(browser, initial.versionId);
      expect(before.version).toMatchObject({
        version_number: 1, calc_engine_version: 2, margin_mode: "fixed", margin_multiplier: 1.3,
        tax_rate_bp: 2000, rounding_mode: "none",
      });
      expect(before.items).toHaveLength(0);
      // The owned CI tenant has exactly one active role at the workbook rate (run-tester-army-ci.ts).
      const details = await apiRequest<Envelope<{ labor_roles: LaborRole[] }>>(browser, "GET", `/api/estimates/${initial.versionId}`);
      expect(details.status).toBe(200);
      const workbookRateRoles = details.body.data.labor_roles
        .filter((role) => role.is_active && role.hourly_rate_cents === PARAMETERS.hourlyRateEuros * 100);
      expect(workbookRateRoles, "one active labour role at 40 €/h").toHaveLength(1);
      const workbookRateRole = workbookRateRoles[0];
      await recordEvidence(army, "optima-initial-version", { version: businessSnapshot(before).version, workbookRateRole });

      stage = "upload-xlsx";
      await app.open(`/dashboard/affaires/${projectId}?created=1`);
      await selectWorkbookInImportFlow({ app, screen, browser }, fixturePath);
      const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
      const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
      await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), {
        timeout: 30_000,
      }).toBe(true);
      if (await editMapping.isVisible()) await editMapping.tap();
      await expect(nextMapping).toBeVisible();

      const imports = await apiRequest<Envelope<ImportRecord[]>>(browser, "GET", `/api/imports?project_id=${projectId}`);
      expect(imports.status).toBe(200);
      expect(imports.body.data).toHaveLength(1);
      const imported = imports.body.data[0];
      importId = imported.id;
      await recordEvidence(army, "optima-raw-import", imported);
      // The parameter row and the seven lines all stay raw rows.
      expect(imported).toMatchObject({ project_id: projectId, filename, source_format: "xlsx", status: "completed", row_count: 8 });

      stage = "suggestions";
      const suggested = await apiRequest<Envelope<Suggestions>>(browser, "POST", "/api/mappings", {
        action: "suggestions", import_id: importId,
      });
      expect(suggested.status).toBe(200);
      expect([...suggested.body.data.source_columns].sort()).toEqual([...UPLOADED_COLUMNS].sort());
      const suggestions = suggested.body.data.suggestions;
      await recordEvidence(army, "optima-suggestions", { importId, suggestions });
      const valueTargets = Object.fromEntries(Object.entries(suggestions).filter(([, target]) => !ROLE_TARGET.test(target)));
      const controlSources = Object.keys(suggestions).filter((source) => suggestions[source]?.startsWith("control_")).sort();
      const parameterSources = Object.keys(suggestions).filter((source) => suggestions[source]?.startsWith("param_")).sort();
      // U-03 / F17: no price or time column becomes the unit; h/u, check columns and parameters are named.
      expect.soft(valueTargets, "OPTIMA value targets").toEqual(EXPECTED_VALUE_TARGETS);
      expect.soft(controlSources, "OPTIMA check columns").toEqual(expect.arrayContaining(CONTROL_COLUMNS));
      expect.soft(parameterSources, "OPTIMA parameters").toEqual([...PARAMETER_COLUMNS].sort());

      stage = "map-columns";
      const sourceRow = (header: string) => screen.getByRole("row").filter({ has: screen.getByText(header, { exact: true }) });
      const column = (header: string) => sourceRow(header).getByRole("combobox");
      for (const [source, target] of Object.entries(EXPECTED_VALUE_TARGETS)) {
        await expect(column(source)).toHaveValue(target);
      }
      await expect(nextMapping).toBeEnabled();
      await nextMapping.tap();

      stage = "preview-hours-per-unit";
      // P-16: the preview shows the conversion of hours per unit into stored line hours.
      await expect(screen.getByText(/h\/u × Q/).first()).toBeVisible({ timeout: 30_000 });
      // Added at integration: the preview's values, not only its title (P-16, E17, D11 self-check).
      const linesPreview = screen.getByTestId("import-lines-preview");
      await expect(linesPreview).toContainText("7 lignes prêtes · 1 ligne de paramètres lue, non importée");
      await expect(linesPreview).toContainText("Total : 570,706 h sur 6 lignes.");
      await expect(linesPreview).toContainText("7 lignes vérifiées, 0 écart supérieur à 0,5 c.");
      await expect(screen.getByLabel("Rôle MO des heures importées", { exact: true })).toHaveValue(workbookRateRole.id);
      const previewHours = await browser.evaluate(() =>
        Array.from(document.querySelectorAll('[aria-label="Heures MO importées"] tbody tr')).map((row) =>
          // Designation, Q, h/u, line hours (the leading row number is left out).
          Array.from(row.querySelectorAll("td")).slice(1).map((cell) => (cell.textContent ?? "").replace(/\s/g, ""))));
      const frenchDecimal = (value: number) => String(value).replace(".", ",");
      expect(previewHours, "h/u × Q preview").toEqual(ORACLE.map((line) => [
        `${army.projectName} ${line.id}`.replace(/\s/g, ""), frenchDecimal(line.quantity),
        frenchDecimal(line.hoursPerUnit), `${frenchDecimal(line.lineHours)}h`,
      ]));
      await recordEvidence(army, "optima-preview", { importId, previewHours, totalLineHours: "570,706", linesWithHours: 6 });
      const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
      await expect(nextPreview).toBeEnabled({ timeout: 30_000 });
      await nextPreview.tap();

      stage = "confirm-import";
      const confirm = screen.getByRole("button", "Créer le chiffrage", { exact: true });
      await expect(confirm).toBeEnabled();
      await confirm.tap();
      await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 45_000 });
      await screen.getByRole("button", "Continuer", { exact: true }).tap();
      const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
      await expect.poll(async () => {
        return /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i.test(await browser.url()) || await skipPlans.isVisible();
      }, { timeout: 30_000 }).toBe(true);
      if (await skipPlans.isVisible()) await skipPlans.tap();
      await expect(browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/, { timeout: 30_000 });
      importedVersionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1];
      ownEstimate(army, { projectId, versionId: importedVersionId });
      expect(importedVersionId).not.toBe(initial.versionId);

      stage = "verify-persisted-estimate";
      await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
      const saved = await readEstimate(browser, importedVersionId);
      await recordEvidence(army, "optima-persisted-result", { importId, workbookRateRole, result: businessSnapshot(saved) });
      const lines = saved.items.filter((item) => item.item_type === "line");
      expect(lines.map((item) => item.title).sort()).toEqual(ORACLE.map((line) => `${army.projectName} ${line.id}`).sort());
      for (const line of ORACLE) {
        const actual = lines.find((item) => item.title === `${army.projectName} ${line.id}`) as ArmyItem;
        expect.soft(actual, `${line.id} stored values`).toMatchObject({
          description: line.unit, quantity: line.quantity, unit_price_ht_cents: Math.round(line.supplyEuros * 100),
          k_fo: 1, h_mo: line.lineHours, h_mo_majoration: 1, k_mo: 1, tax_rate_bp: 2000,
          line_total_ht_cents: line.totalCents, source_provider: "dpgf", source_file_name: filename,
          ...(line.lineHours > 0 ? { labor_role_id: workbookRateRole.id } : {}),
        });
        expect.soft(actual.source_metadata, `${line.id} provenance`).toMatchObject({ import_id: importId });
      }
      expect(saved.version).toMatchObject({
        project_id: projectId, version_number: 2, calc_engine_version: 2, margin_mode: "fixed",
        margin_multiplier: 1.3, tax_rate_bp: 2000, total_ht_cents: EXPECTED_TOTALS.ht,
        total_tax_cents: EXPECTED_TOTALS.tax, total_ttc_cents: EXPECTED_TOTALS.ttc,
      });

      stage = "verify-reload";
      await app.open(`/dashboard/estimates/${importedVersionId}/edit`);
      await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
      const reloaded = await readEstimate(browser, importedVersionId);
      expect(businessSnapshot(reloaded)).toEqual(businessSnapshot(saved));
      await recordEvidence(army, "optima-reloaded-result", { unchangedAfterReload: true, result: businessSnapshot(reloaded) });

      stage = "linked-dpgf-without-preview";
      // 2.3 review (P-16 « avec aperçu », E17): the linked-DPGF import into an existing version
      // has no preview. It must refuse the OPTIMA rows rather than store h/u × Q at 0 €/h.
      const lock = await apiRequest(browser, "POST", `/api/estimates/${initial.versionId}/lock`);
      expect(lock.status).toBe(201);
      const direct = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${initial.versionId}/import-linked-dpgf`, {});
      const untouched = await readEstimate(browser, initial.versionId);
      await recordEvidence(army, "optima-linked-dpgf-refused", {
        versionId: initial.versionId, status: direct.status, body: direct.body, itemsAfter: untouched.items.length,
      });
      expect(direct.status).toBe(400);
      expect(JSON.stringify(direct.body)).toContain("aperçu");
      expect(untouched.items).toHaveLength(0);
      stage = "complete";
    } finally {
      await recordEvidence(army, "optima-owned-identities", {
        stage, projectId, importId, importedVersionId, fixturePath, cleanup: "none", emails: "none",
      });
    }
  },
);

// 2.3 review helpers for the journeys below: same upload, mapping and confirmation path as above.
type Ui = { app: App; screen: Screen; browser: Browser };

async function writeWorkbookFixture(army: ArmyState, name: string, sheet: XLSX.WorkSheet) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Feuil1");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const filename = `${army.projectName}-${name}.xlsx`;
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
  await mkdir(directory, { recursive: true });
  const fixturePath = path.join(directory, filename);
  await writeFile(fixturePath, bytes);
  return { filename, fixturePath, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/**
 * Opens the affaire's import flow and selects the workbook in its upload step. The flow is loaded on
 * demand and the affaire page also holds the « Ajouter des pièces à l'affaire » input (several files):
 * wait for the upload step, target its single-file input, and select again until « Lancer l'import »
 * appears (a full campaign once selected the file before the step was ready).
 */
async function selectWorkbookInImportFlow({ screen, browser }: Ui, fixturePath: string) {
  await screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
  await expect(screen.getByText("Glissez-déposez votre fichier DPGF ici", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  const workbookInput = browser.locator('input[type="file"]:not([multiple])');
  expect(await workbookInput.count(), "single-file input of the import flow").toBe(1);
  const launch = screen.getByRole("button", "Lancer l'import", { exact: true });
  await expect.poll(async () => {
    if (!(await launch.isVisible())) await workbookInput.setInputFiles(fixturePath);
    return launch.isVisible();
  }, { timeout: 30_000 }).toBe(true);
  await launch.tap();
}

/** Uploads a workbook through the affaire's import flow and stays on the mapping step. */
async function uploadThroughAffaire(ui: Ui, projectId: string, fixturePath: string) {
  const { app, screen, browser } = ui;
  await app.open(`/dashboard/affaires/${projectId}?created=1`);
  await selectWorkbookInImportFlow(ui, fixturePath);
  const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
  const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
  await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), {
    timeout: 30_000,
  }).toBe(true);
  if (await editMapping.isVisible()) await editMapping.tap();
  await expect(nextMapping).toBeEnabled();
  const imports = await apiRequest<Envelope<ImportRecord[]>>(browser, "GET", `/api/imports?project_id=${projectId}`);
  expect(imports.status).toBe(200);
  return { importId: imports.body.data[0]?.id ?? null, nextMapping };
}

const EDITOR_URL = /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i;

/** Confirms the previewed import and returns the version it created. */
async function confirmPreviewedImport({ screen, browser }: Ui, army: ArmyState, projectId: string) {
  const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
  await expect(nextPreview).toBeEnabled({ timeout: 30_000 });
  await nextPreview.tap();
  const confirm = screen.getByRole("button", "Créer le chiffrage", { exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.tap();
  await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 45_000 });
  await screen.getByRole("button", "Continuer", { exact: true }).tap();
  const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
  await expect.poll(async () => EDITOR_URL.test(await browser.url()) || await skipPlans.isVisible(), {
    timeout: 30_000,
  }).toBe(true);
  if (await skipPlans.isVisible()) await skipPlans.tap();
  await expect(browser).toHaveURL(EDITOR_URL, { timeout: 30_000 });
  const versionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1];
  ownEstimate(army, { projectId, versionId });
  return versionId;
}

// 2.3 review (E17): with a workbook rate that matches no active role, choosing « no role » in the
// preview sent the request back to « choose a role »; an owner without any active role could not
// import at all. The preview now offers an explicit « Aucun rôle (MO à 0 €/h) » choice.
armyTest(
  "OPTIMA workbook whose hourly rate matches no role imports after an explicit no-role choice",
  { session: "army", tags: ["critical", "dpgf", "optima"], requires: ["browser"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    let projectId: string | null = null;
    let importId: string | null = null;
    let versionId: string | null = null;
    let stage = "write-workbook";
    // The owned CI tenant has exactly one active role, at 40 €/h (run-tester-army-ci.ts).
    const parameters = { ...PARAMETERS, hourlyRateEuros: 45 };
    const rows = workbookRows(army.projectName, parameters);
    const fixture = await writeWorkbookFixture(army, "optima-sans-role", XLSX.utils.aoa_to_sheet(rows));
    await recordEvidence(army, "optima-no-role-input", { ...fixture, parameters, rows });

    try {
      stage = "create-v2-margin-1-30";
      const initial = await createEstimateViaWizard(
        ui, { projectName: army.projectName, title: `${army.projectName} initial`, marginPercent: "30" }, army,
      );
      projectId = initial.projectId;

      stage = "upload-xlsx";
      const uploaded = await uploadThroughAffaire(ui, projectId, fixture.fixturePath);
      importId = uploaded.importId;
      await uploaded.nextMapping.tap();

      stage = "preview-choice-required";
      const linesPreview = screen.getByTestId("import-lines-preview");
      await expect(linesPreview).toBeVisible({ timeout: 30_000 });
      await expect(linesPreview).toContainText("Total : 570,706 h sur 6 lignes.");
      await expect(linesPreview).toContainText("Aucun rôle actif n’a le taux horaire du classeur");
      const role = screen.getByLabel("Rôle MO des heures importées", { exact: true });
      await expect(role).toHaveAttribute("aria-invalid", "true");
      const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
      await expect(nextPreview).toBeDisabled();

      stage = "decline-role";
      await role.selectOption({ value: "none" });
      await expect(linesPreview).toContainText("Sans rôle, ces heures sont valorisées à 0 €/h.");
      await expect(role).not.toHaveAttribute("aria-invalid", "true");

      stage = "confirm-import";
      versionId = await confirmPreviewedImport(ui, army, projectId);

      stage = "verify-persisted-estimate";
      const saved = await readEstimate(browser, versionId);
      await recordEvidence(army, "optima-no-role-result", { importId, result: businessSnapshot(saved) });
      const lines = saved.items.filter((item) => item.item_type === "line");
      expect(lines).toHaveLength(ORACLE.length);
      for (const line of ORACLE) {
        const actual = lines.find((item) => item.title === `${army.projectName} ${line.id}`);
        expect.soft(actual, `${line.id} hours without role`).toMatchObject({ h_mo: line.lineHours, labor_role_id: null });
      }
      expect(saved.version).toMatchObject({ project_id: projectId, version_number: 2, margin_multiplier: 1.3 });
      stage = "complete";
    } finally {
      await recordEvidence(army, "optima-no-role-owned-identities", {
        stage, projectId, importId, versionId, fixturePath: fixture.fixturePath, cleanup: "none", emails: "none",
      });
    }
  },
);

// 2.3 review: Excel stores a cell shown « 115 % » as 1,15; both upload parsers stored the
// fraction, so « Majoration MO (%) » imported ×0,0115 in silence. The cell now imports as the
// percent it shows.
armyTest(
  "percent-formatted « Majoration MO (%) » cell imports as the percent it shows",
  { session: "army", tags: ["critical", "dpgf"], requires: ["browser"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    let projectId: string | null = null;
    let importId: string | null = null;
    let versionId: string | null = null;
    let stage = "write-workbook";
    const title = `${army.projectName} PCT`;
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Désignation", "Qté", "Unité", "PR FO", "h MO", "Majoration MO (%)"],
      [title, 2, "u", 10, 3, 1.15],
    ]);
    sheet.F2!.z = "0%";
    const fixture = await writeWorkbookFixture(army, "majoration-pourcentage", sheet);
    await recordEvidence(army, "percent-cell-input", { ...fixture, majorationCell: { value: 1.15, format: "0%", shown: "115%" } });

    try {
      stage = "create-v2";
      const initial = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.projectName} initial` }, army);
      projectId = initial.projectId;

      stage = "upload-xlsx";
      const uploaded = await uploadThroughAffaire(ui, projectId, fixture.fixturePath);
      importId = uploaded.importId;
      const sourceRow = (header: string) => screen.getByRole("row").filter({ has: screen.getByText(header, { exact: true }) });
      await expect(sourceRow("Majoration_MO_pct").getByRole("combobox")).toHaveValue("h_mo_majoration_percent");
      await uploaded.nextMapping.tap();

      stage = "confirm-import";
      versionId = await confirmPreviewedImport(ui, army, projectId);

      stage = "verify-persisted-estimate";
      const saved = await readEstimate(browser, versionId);
      const line = saved.items.find((item) => item.title === title);
      await recordEvidence(army, "percent-cell-result", { importId, versionId, line });
      expect(line).toMatchObject({ quantity: 2, unit_price_ht_cents: 1000, h_mo: 3, h_mo_majoration: 1.15 });
      stage = "complete";
    } finally {
      await recordEvidence(army, "percent-cell-owned-identities", {
        stage, projectId, importId, versionId, fixturePath: fixture.fixturePath, cleanup: "none", emails: "none",
      });
    }
  },
);
