import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import ExcelJS from "exceljs";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyEstimate, type ArmyItem } from "../critical/fixtures";
import { lockVersion, prepareV3Draft, releaseVersion, seedLines, type Envelope, type Ui, type V3Draft } from "./engine-v3-editor-support";

// Lot 2, sous-lot 2.7 — revue Codex de 3d78d662, voie B : exports XLSX standard et DPGF d'une v3
// (docs/testing/estimate-engine-v3-2.7.md §13.8). Défaillances observables, écrites avant le code :
//  V3X-01 Sur une ligne non chiffrée (incluse, hors lot, pour mémoire), l'export DPGF écrit un nombre dans une
//         colonne que l'import DPGF lit comme prix, déboursé ou main-d'oeuvre : « Prix unitaire HT EUR » (PR FO,
//         unit_price_ht du profil DPGF), « Total HT brut EUR » (total_ht de l'heuristique), « h MO / unité » et ses
//         jumeaux atelier et chantier (labor_hours), « Majoration MO (%) » ; l'export standard écrit « Total HT » 0
//         (total_ht).
//  V3X-02 Réimporté par le parcours d'import DPGF (dpgf_rows_raw → mappings → confirmUnifiedImportFlow), avec la
//         correspondance proposée et le rôle MO que l'aperçu demande pour les heures importées, ce classeur recrée
//         ses lignes non chiffrées facturables : le devis importé dépasse ses seules lignes chiffrées.
//  V3X-03 Le statut n'est plus lisible : colonne « Statut » absente, cellule de prix sans le libellé du document.
//  V3X-04 Régression : les cellules d'une ligne chiffrée changent, ou son réimport ne reprend plus exactement ses
//         saisies (PR FO, h/u × Q, majoration). Jusqu'à la revue de 8dd28c91 (§13.9), il lisait PU = PT / Q.
//  V3X-05 Une v3 en USD ou GBP reçoit le format « € » sur chacun de ses montants, et les colonnes de montant de
//         son DPGF disent « EUR ».
//  V3X-06 Régression : une v3 en EUR change de format de montant ou d'en-tête.
// Le statut lui-même n'est pas réimporté : le contrat d'import n'a pas de cible de statut (limite, §13.8).
// Ajouté à la revue de 8dd28c91 (docs/testing/estimate-engine-v3-2.7.md §13.9) :
//  V3X-07 Réimportée avec la correspondance proposée, une ligne chiffrée avec main-d'oeuvre compte deux fois ses
//         heures : « Total HT brut » lu en total_ht donne PU = PT / Q, main-d'oeuvre comprise, comme prix de fourniture,
//         et « h MO / unité » lu en heures de ligne y ajoute la main-d'oeuvre au rôle choisi (2 ml à 135,00 € reviennent
//         à 175,00 € avec 1 h au lieu de 2). Attendu : le DPGF v3 est reconnu comme tel ; ses saisies sont lues (PR FO
//         en prix de fourniture, h/u en heures par unité, majoration), ses PU et PT de vente en contrôles, jamais en
//         montant. Sur une cible v2, qui n'a pas les coefficients de vente, l'aperçu signale l'écart de PU de chaque ligne.

const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const normalized = (text: unknown) => String(text ?? "").replace(/[\s  ]+/g, " ").trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEUTRAL_V2 = {
  margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, discount_bp: 0, discount_mode: "simple", discount_steps: [],
  global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1,
  currency: "EUR", contractor_role: "principal",
} as const;

type CellValue = string | number | null;
type Cell = { value: CellValue; numFmt: string | null };
type SheetView = { header: string[]; rows: Array<{ row: number; cells: Record<string, Cell> }> };
type Workbook = { sha256: string; bytes: Buffer; sheets: Record<string, SheetView> };

/** Feuilles d'un classeur, cellule par en-tête de colonne (ligne 1), avec leur format de nombre. */
async function readSheets(bytes: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheets: Record<string, SheetView> = {};
  workbook.eachSheet((sheet) => {
    const header: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { header[column - 1] = String(cell.value ?? ""); });
    const rows: SheetView["rows"] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells: Record<string, Cell> = {};
      header.forEach((name, index) => {
        const cell = row.getCell(index + 1);
        const value = cell.value;
        cells[name] = { value: typeof value === "number" || typeof value === "string" ? value : null,
          numFmt: typeof cell.numFmt === "string" && cell.numFmt !== "General" ? cell.numFmt : null };
      });
      rows.push({ row: rowNumber, cells });
    });
    sheets[sheet.name] = { header, rows };
  });
  return sheets;
}

/** Classeur d'export lu par la route de l'interface (GET …/export), depuis le navigateur. */
async function exportWorkbook(browser: Browser, versionId: string, mode: "standard" | "dpgf"): Promise<Workbook> {
  const exported = await browser.evaluate(async (input) => {
    const response = await fetch(`/api/estimates/${input.versionId}/export?format=xlsx${input.mode === "dpgf" ? "&mode=dpgf" : ""}`,
      { credentials: "same-origin", redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { status: response.status, base64: btoa(binary) };
  }, { versionId, mode });
  const bytes = Buffer.from(exported.base64, "base64");
  expect([exported.status, Array.from(bytes.subarray(0, 4))]).toEqual([200, [0x50, 0x4b, 0x03, 0x04]]);
  return { sha256: digest(bytes), bytes, sheets: await readSheets(bytes) };
}

const supply = (title: string, unit: string, quantity: number, prCents: number, status: string) => ({
  line_nature: "supply_only", title, unit_code: unit, pricing_status: status, quantity, unit_price_ht_cents: prCents, tax_rate_bp: 2000,
  k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, labor_role_id: null, source_provider: "manual",
});
const withLabor = (title: string, unit: string, quantity: number, prCents: number, status: string, hoursPerUnit: number, roleId: string) => ({
  ...supply(title, unit, quantity, prCents, status), line_nature: "supply_and_labor", h_mo_per_unit: hoursPerUnit, labor_role_id: roleId,
});

async function patchSettings(ui: Ui, label: string, draft: V3Draft, patch: Record<string, unknown>, record: (label: string, data: unknown) => Promise<unknown>) {
  await lockVersion(ui.browser, draft.versionId);
  const before = await readEstimate(ui.browser, draft.versionId);
  const response = await apiRequest<Envelope<unknown>>(ui.browser, "PATCH", `/api/estimates/${draft.versionId}`,
    { ...patch, expected_content_revision: before.version.content_revision }, { "if-match": before.version.updated_at });
  await record(`settings-${label}`, { versionId: draft.versionId, patch, status: response.status, ok: response.body.ok, error: response.body.error ?? null });
  expect([response.status, response.body.ok]).toEqual([200, true]);
  await releaseVersion(ui.browser, draft.versionId);
}

// V3X01 — lignes du brouillon : deux lignes chiffrées « fourniture seule », une ligne chiffrée avec main-d'oeuvre
// (P3, V3X-07 : la ligne X de V3X02) et trois lignes non chiffrées avec déboursé et heures, valorisables par le rôle
// « Tuyauteur » (40 €/h). Politique 3 : c_FO 1,30, c_MO 1,20. Brut 26,00 + 19,50 + 135,00 = 180,50 € ; TVA 20 % 36,10 ;
// TTC 216,60.
const ROUND_TRIP = [
  { ref: "P1", status: "priced", unit: "u", quantity: 2, prFo: 1000, hPerUnit: 0, pu: 1300, gross: 2600 },
  { ref: "P2", status: "priced", unit: "ml", quantity: 3, prFo: 500, hPerUnit: 0, pu: 650, gross: 1950 },
  { ref: "P3", status: "priced", unit: "ml", quantity: 2, prFo: 1500, hPerUnit: 1, pu: 6750, gross: 13500 },
  { ref: "N1", status: "included", unit: "u", quantity: 3, prFo: 5000, hPerUnit: 2, pu: null, gross: 0 },
  { ref: "N2", status: "out_of_scope", unit: "ml", quantity: 4, prFo: 2500, hPerUnit: 0.5, pu: null, gross: 0 },
  { ref: "N3", status: "for_memory", unit: "u", quantity: 1, prFo: 9900, hPerUnit: 1, pu: null, gross: 0 },
] as const;
const ROUND_TRIP_TOTALS = [18050, 3610, 21660];
// Réimport dans la v2 neutre (marge 1, K 1, rôle choisi 40 €/h) : PR FO × Q + h/u × Q × 40 € par ligne chiffrée,
// soit 20,00 + 15,00 + (30,00 + 2 h × 40,00) = 145,00 € ; TVA 20 % 29,00 ; TTC 174,00.
const IMPORTED_TOTALS = [14500, 2900, 17400];
// Taux du rôle « Tuyauteur » de prepareV3Draft (engine-v3-editor-support.ts).
const TUYAUTEUR_RATE_CENTS = 4000;
// Colonnes de saisie et de contrôle du DPGF v3 et leur cible attendue dans la correspondance proposée (V3X-07).
const EXPECTED_DPGF_MAPPING = {
  "Prix unitaire HT EUR": "unit_price_ht", "h MO / unité": "labor_hours_per_unit", "PU vente HT EUR": "control_unit_price",
  "Total HT brut EUR": "control_total_price",
} as const;
// Libellés du document v3 (ESTIMATE_V3_STATUS_DOCUMENT_LABELS).
const STATUS_LABELS: Record<(typeof ROUND_TRIP)[number]["status"], string> = {
  priced: "Chiffrée", included: "Inclus", out_of_scope: "Hors lot", for_memory: "Pour mémoire",
};
// Colonnes du DPGF v3 que lit l'import (profil DPGF, heuristique de correspondance), plus la quantité et le statut.
const DPGF_READ_COLUMNS = ["Quantité", "Statut", "Prix unitaire HT EUR", "h MO / unité", "Majoration MO (%)", "h MO Atelier / unité",
  "h MO Chantier / unité", "PU vente HT EUR", "Total HT brut EUR"] as const;
const STANDARD_READ_COLUMNS = ["Quantité", "Statut", "PU HT", "Total HT"] as const;

function lineCells(sheet: SheetView | undefined, title: string, columns: readonly string[]) {
  const row = sheet?.rows.find((candidate) => normalized(candidate.cells["Désignation"]?.value) === title);
  return row ? Object.fromEntries(columns.map((column) => [column, row.cells[column]?.value ?? null])) : null;
}

function expectedDpgfCells(line: (typeof ROUND_TRIP)[number]) {
  if (line.status === "priced") {
    return { "Quantité": line.quantity, "Statut": STATUS_LABELS.priced, "Prix unitaire HT EUR": line.prFo / 100, "h MO / unité": line.hPerUnit,
      "Majoration MO (%)": 100, "h MO Atelier / unité": null, "h MO Chantier / unité": null, "PU vente HT EUR": line.pu! / 100,
      "Total HT brut EUR": line.gross / 100 };
  }
  // Aucune valeur numérique lue par l'import ; le libellé du statut tient lieu de prix (PU vide, comme le document).
  const label = STATUS_LABELS[line.status];
  return { "Quantité": line.quantity, "Statut": label, "Prix unitaire HT EUR": label, "h MO / unité": null, "Majoration MO (%)": null,
    "h MO Atelier / unité": null, "h MO Chantier / unité": null, "PU vente HT EUR": null, "Total HT brut EUR": label };
}

function expectedStandardCells(line: (typeof ROUND_TRIP)[number]) {
  if (line.status === "priced") {
    return { "Quantité": line.quantity, "Statut": STATUS_LABELS.priced, "PU HT": line.pu! / 100, "Total HT": line.gross / 100 };
  }
  const label = STATUS_LABELS[line.status];
  return { "Quantité": line.quantity, "Statut": label, "PU HT": null, "Total HT": label };
}

const importedLine = (item: ArmyItem) => ({
  title: item.title, description: item.description ?? null, quantity: Number(item.quantity), unit_price_ht_cents: item.unit_price_ht_cents,
  h_mo: Number(item.h_mo ?? 0), labor_role_id: item.labor_role_id ?? null, line_total_ht_cents: item.line_total_ht_cents,
});
const totalsOf = (state: ArmyEstimate) => [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents];

// V3X02 — formats de montant attendus par devise (même symbole et même place que formatCurrency de money.ts).
const CURRENCY_FORMATS = { EUR: "#,##0.00 \"€\"", USD: "\"$\"#,##0.00", GBP: "\"£\"#,##0.00" } as const;
type Currency = keyof typeof CURRENCY_FORMATS;
const dpgfHeader = (currency: Currency) => ["Type", "AID", "Désignation", "Quantité", "Unité", "Statut", "TVA (%)",
  `Prix unitaire HT ${currency}`, "Type FO", "K FO", "h MO / unité", "K MO", "Majoration MO (%)", "Rôle MO", "Catégorie",
  "h MO Atelier / unité", "K MO Atelier", "Rôle MO Atelier", "h MO Chantier / unité", "K MO Chantier", "Rôle MO Chantier",
  `PU vente HT ${currency}`, `Total HT brut ${currency}`];
const FOOTER_FIELD = /^(Total HT brut|Remise commerciale|Arrondi commercial|Total HT net|TVA |Total TVA|Total TTC)/u;

/** Formats des cellules numériques de montant, dans l'ordre des lignes, et tous les formats du classeur. */
function currencyFacts(standard: Workbook, dpgf: Workbook, currency: Currency) {
  const amounts = (sheet: SheetView | undefined, columns: string[]) => (sheet?.rows ?? []).flatMap((row) =>
    columns.flatMap((column) => (typeof row.cells[column]?.value === "number" ? [row.cells[column].numFmt] : [])));
  const footer = (sheet: SheetView | undefined, field: string, value: string) => (sheet?.rows ?? []).flatMap((row) =>
    FOOTER_FIELD.test(String(row.cells[field]?.value ?? "")) && typeof row.cells[value]?.value === "number" ? [row.cells[value].numFmt] : []);
  const formats = (workbook: Workbook) => [...new Set(Object.values(workbook.sheets).flatMap((sheet) =>
    sheet.rows.flatMap((row) => Object.values(row.cells).flatMap((cell) => (cell.numFmt ? [cell.numFmt] : [])))))].sort();
  const donnees = dpgf.sheets["Données"];
  return {
    dpgfHeader: donnees?.header ?? null,
    devis: amounts(standard.sheets.Devis, ["PU HT", "Total HT"]),
    resume: footer(standard.sheets.Resume, "Champ", "Valeur"),
    donnees: amounts(donnees, [`Prix unitaire HT ${currency}`, `PU vente HT ${currency}`, `Total HT brut ${currency}`]),
    metadata: footer(dpgf.sheets.Metadata, "Champ", "Valeur"),
    standardFormats: formats(standard),
    dpgfFormats: formats(dpgf),
  };
}

// Une ligne chiffrée sous une section ; remise 10 % : section 1 montant, ligne PU et PT, pied 5 montants
// (brut, remise, net, TVA 20 %, TTC) ; DPGF : PR, PU et PT de la ligne.
function expectedCurrencyFacts(currency: Currency) {
  const format = CURRENCY_FORMATS[currency];
  const times = (count: number) => Array.from({ length: count }, () => format);
  return { dpgfHeader: dpgfHeader(currency), devis: times(8), resume: times(5), donnees: times(3), metadata: times(5),
    standardFormats: [format], dpgfFormats: [format] };
}

async function openImportFlow(ui: Ui, fixturePath: string) {
  await ui.screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
  await expect(ui.screen.getByText("Glissez-déposez votre fichier DPGF ici", { exact: true })).toBeVisible({ timeout: 30_000 });
  // La fiche porte aussi l'entrée multiple « Ajouter des pièces à l'affaire » : seule l'entrée unique est celle de l'import.
  const workbookInput = ui.browser.locator('input[type="file"]:not([multiple])');
  expect(await workbookInput.count(), "single-file input of the import flow").toBe(1);
  const launch = ui.screen.getByRole("button", "Lancer l'import", { exact: true });
  await expect.poll(async () => {
    if (!(await launch.isVisible())) await workbookInput.setInputFiles(fixturePath);
    return launch.isVisible();
  }, { timeout: 30_000 }).toBe(true);
  await launch.tap();
}

/**
 * Compte « N lignes prêtes · M refusées » de l'aperçu des lignes (absent : aucune ligne à signaler), et son contrôle
 * « Prix unitaire de vente » : lignes vérifiées et écarts hors tolérance (V3X-07).
 */
async function previewCounts(ui: Ui) {
  const preview = ui.screen.getByTestId("import-lines-preview");
  if ((await preview.count()) === 0) return { shown: false, ready: null, refused: 0, controls: null, text: null };
  const text = normalized(await preview.textContent());
  const ready = /(\d+) lignes? prêtes?/u.exec(text);
  const refused = /(\d+) refusées?/u.exec(text);
  const controls = /Contrôle .Prix unitaire de vente. : (\d+) lignes? vérifiées?, (\d+) écarts?/u.exec(text);
  return { shown: true, ready: ready ? Number(ready[1]) : null, refused: refused ? Number(refused[1]) : 0,
    controls: controls ? { checked: Number(controls[1]), gaps: Number(controls[2]) } : null, text };
}

/** Clé d'en-tête comparable entre l'en-tête du classeur et la colonne d'import stockée (accents, casse, ponctuation). */
const headerKey = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
  .replace(/[^a-z0-9]+/gu, " ").trim();

if (process.env.E2E_ARMY_SUITE === "critical") {
  armyTest("V3X01 a v3 DPGF export re-imported through the DPGF import flow with its proposed mapping brings back only its priced lines, from their supply cost and hours per unit with their sale prices as controls; its included, out-of-scope and for-memory lines carry no amount and keep their status label",
    { session: "army", tags: ["critical", "local", "engine-v3", "dpgf"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const ui: Ui = { app, screen, browser };
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x01-${label}`, data);
      const title = (ref: string) => `${army.runPrefix} ${ref}`;
      let stage = "prepare-v3";
      const ids: Record<string, string | null> = { projectId: null, versionId: null, targetProjectId: null, targetVersionId: null,
        importId: null, importedVersionId: null };
      try {
        const draft = await prepareV3Draft(ui, army, "V3X01");
        Object.assign(ids, { projectId: draft.projectId, versionId: draft.versionId });
        await seedLines(ui, army, draft, "v3x01", ROUND_TRIP.map((line) => line.hPerUnit > 0
          ? withLabor(title(line.ref), line.unit, line.quantity, line.prFo, line.status, line.hPerUnit, draft.tuyauteurId)
          : supply(title(line.ref), line.unit, line.quantity, line.prFo, line.status)));
        const settled = await readEstimate(browser, draft.versionId);
        const v3 = { engine: settled.version.calc_engine_version, totals: totalsOf(settled),
          lines: settled.items.filter((item) => item.item_type === "line").sort((a, b) => a.position - b.position)
            .map((item) => [item.title, item.pricing_status ?? null, item.pu_ht_cents ?? null]) };
        const expectedV3 = { engine: 3, totals: ROUND_TRIP_TOTALS,
          lines: ROUND_TRIP.map((line) => [title(line.ref), line.status, line.pu]) };
        await record("v3-settled", { versionId: draft.versionId, expected: expectedV3, actual: v3 });
        expect(v3).toEqual(expectedV3);

        stage = "export";
        const dpgf = await exportWorkbook(browser, draft.versionId, "dpgf");
        const standard = await exportWorkbook(browser, draft.versionId, "standard");
        const filename = `${army.runPrefix}-v3x01-dpgf.xlsx`;
        const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
        await mkdir(directory, { recursive: true });
        const fixturePath = path.join(directory, filename);
        await writeFile(fixturePath, dpgf.bytes);
        const exported = {
          dpgfHeader: dpgf.sheets["Données"]?.header ?? null,
          dpgf: Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, lineCells(dpgf.sheets["Données"], title(line.ref), DPGF_READ_COLUMNS)])),
          standard: Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, lineCells(standard.sheets.Devis, title(line.ref), STANDARD_READ_COLUMNS)])),
        };
        await record("exports", { versionId: draft.versionId, fixturePath, filename,
          dpgf: { sha256: dpgf.sha256, bytes: dpgf.bytes.length }, standard: { sha256: standard.sha256, bytes: standard.bytes.length }, exported });

        stage = "import-target";
        // Politique remise à 2 par prepareV3Draft : l'import crée une v2 (les imports v3 relèvent de 2.8, D16).
        const target = await apiRequest<Envelope<{ project: { id: string }; version: { id: string; calc_engine_version: number } }>>(
          browser, "POST", "/api/estimates", { project: { name: `ARMY-L2-V3X01-import-${army.runPrefix}` },
            version: { ...NEUTRAL_V2, title: `${army.runPrefix} V3X01 cible` } });
        expect([target.status, target.body.ok, target.body.data?.version?.calc_engine_version]).toEqual([201, true, 2]);
        Object.assign(ids, { targetProjectId: target.body.data.project.id, targetVersionId: target.body.data.version.id });
        ownEstimate(army, { projectId: target.body.data.project.id, versionId: target.body.data.version.id });

        stage = "upload";
        await app.open(`/dashboard/affaires/${ids.targetProjectId}?created=1`);
        await openImportFlow(ui, fixturePath);
        const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
        const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
        await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), { timeout: 60_000 }).toBe(true);
        const imports = await apiRequest<Envelope<Array<{ id: string; project_id: string; filename: string; source_format: string; status: string; row_count: number }>>>(
          browser, "GET", `/api/imports?project_id=${ids.targetProjectId}`);
        expect([imports.status, imports.body.ok, imports.body.data?.length]).toEqual([200, true, 1]);
        ids.importId = imports.body.data[0].id;
        expect(ids.importId).toMatch(UUID);
        const suggested = await apiRequest<Envelope<{ suggestions: Record<string, string>; source_columns: string[] }>>(
          browser, "POST", "/api/mappings", { action: "suggestions", import_id: ids.importId });
        expect(suggested.status).toBe(200);
        await record("import-mapping", { importId: ids.importId, raw: imports.body.data[0], suggestions: suggested.body.data?.suggestions ?? null,
          sourceColumns: suggested.body.data?.source_columns ?? null, autoAdvanced: await editMapping.isVisible() });
        // V3X-07 : cible proposée des colonnes de saisie et de contrôle, et colonnes lues en heures de ligne ou en montant.
        const suggestions = suggested.body.data?.suggestions ?? {};
        const targetOf = (header: string) => {
          const column = Object.keys(suggestions).find((source) => headerKey(source) === headerKey(header));
          return column ? suggestions[column] : null;
        };
        const proposed = {
          columns: Object.fromEntries(Object.keys(EXPECTED_DPGF_MAPPING).map((header) => [header, targetOf(header)])),
          lineHoursOrAmount: Object.entries(suggestions).filter(([, target]) => target === "labor_hours" || target === "total_ht")
            .map(([source]) => source).sort(),
        };
        // La correspondance proposée est gardée telle quelle.
        if (await nextMapping.isVisible()) await nextMapping.tap();

        stage = "preview";
        const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
        await expect(nextPreview).toBeVisible({ timeout: 60_000 });
        await expect(screen.getByText(/Calcul de l.aperçu des heures et des contrôles/u)).toHaveCount(0, { timeout: 60_000 });
        const beforeRole = await previewCounts(ui);
        // L'aperçu demande le rôle qui valorise les heures importées (« Sans rôle, … 0 €/h ») : le rôle de l'affaire.
        const roleSelect = screen.getByLabel("Rôle MO des heures importées", { exact: true });
        const roleOffered = (await roleSelect.count()) === 1;
        if (roleOffered) {
          await roleSelect.selectOption({ value: draft.tuyauteurId });
          await expect(roleSelect).toHaveValue(draft.tuyauteurId);
          await expect(screen.getByText("Sans rôle, ces heures sont valorisées à 0 €/h. Choisissez le rôle qui les valorise.",
            { exact: true })).toHaveCount(0, { timeout: 60_000 });
          await expect(screen.getByText(/Calcul de l.aperçu des heures et des contrôles/u)).toHaveCount(0, { timeout: 60_000 });
        }
        const preview = await previewCounts(ui);
        await record("import-preview", { importId: ids.importId, beforeRole, roleOffered, preview });

        stage = "confirm";
        // Le choix du rôle relance l'aperçu des lignes, qui bloque l'étape le temps du calcul : avancer dès qu'elle
        // est rendue active (même attente que l'envoi du fichier).
        // La notification « Affaire créée ! » de l'arrivée (« ?created=1 »), gardée ouverte par le focus, recouvre le bas
        // du parcours : elle est fermée d'abord.
        const confirm = screen.getByRole("button", "Créer le chiffrage", { exact: true });
        const closeNotification = screen.getByRole("button", "Fermer la notification", { exact: true }).first();
        const advance = { closedNotifications: 0, taps: 0 };
        await expect.poll(async () => {
          if (await closeNotification.isVisible()) {
            await closeNotification.tap();
            advance.closedNotifications += 1;
          } else if (!(await confirm.isVisible()) && (await nextPreview.isVisible()) && (await nextPreview.isEnabled())) {
            await nextPreview.tap();
            advance.taps += 1;
          }
          return confirm.isVisible();
        }, { timeout: 60_000 }).toBe(true);
        await record("import-advance", { importId: ids.importId, ...advance });
        await expect(confirm).toBeEnabled({ timeout: 30_000 });
        await confirm.tap();
        await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 60_000 });
        await screen.getByRole("button", "Continuer", { exact: true }).tap();
        const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
        await expect.poll(async () => /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i.test(await browser.url()) ||
          await skipPlans.isVisible(), { timeout: 30_000 }).toBe(true);
        if (await skipPlans.isVisible()) await skipPlans.tap();
        await expect(browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/, { timeout: 30_000 });
        ids.importedVersionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1];
        ownEstimate(army, { projectId: ids.targetProjectId!, versionId: ids.importedVersionId });

        stage = "verify";
        const imported = await readEstimate(browser, ids.importedVersionId);
        const importedLines = imported.items.filter((item) => item.item_type === "line").sort((a, b) => a.position - b.position);
        const actual = {
          exported,
          proposed,
          preview: { refused: preview.refused, ready: preview.ready, controls: preview.controls },
          imported: { engine: imported.version.calc_engine_version, totals: totalsOf(imported), lines: importedLines.map(importedLine) },
        };
        // Après réimport, seules les lignes chiffrées portent un montant, calculé par la v2 cible depuis leurs saisies :
        // PR FO en prix de fourniture, h/u × Q en heures de ligne au rôle choisi, majoration 100 % (V3X-07, §13.9). Leur PU
        // de vente v3 (« PU vente HT », contrôle) diffère du PU v2 recalculé, sans coefficient de vente : trois écarts
        // signalés. Chaque ligne non chiffrée est refusée par l'import, son prix portant le libellé de son statut (§13.8).
        const expected = {
          exported: {
            dpgfHeader: dpgfHeader("EUR"),
            dpgf: Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, expectedDpgfCells(line)])),
            standard: Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, expectedStandardCells(line)])),
          },
          proposed: { columns: EXPECTED_DPGF_MAPPING, lineHoursOrAmount: [] },
          preview: { refused: 3, ready: 3, controls: { checked: 3, gaps: 3 } },
          imported: { engine: 2, totals: IMPORTED_TOTALS, lines: ROUND_TRIP.filter((line) => line.status === "priced").map((line) => ({
            title: title(line.ref), description: line.unit, quantity: line.quantity, unit_price_ht_cents: line.prFo,
            h_mo: line.hPerUnit * line.quantity, labor_role_id: line.hPerUnit > 0 ? draft.tuyauteurId : null,
            line_total_ht_cents: line.quantity * (line.prFo + line.hPerUnit * TUYAUTEUR_RATE_CENTS) })) },
        };
        await record("round-trip", { ...ids, expected, actual, importedItems: imported.items });
        expect(actual).toEqual(expected);
        stage = "complete";
      } finally {
        await record("owned-identities", { stage, ...ids, cleanup: "none", emails: "none" });
      }
    });

  armyTest("V3X02 the v3 standard and DPGF workbooks format every amount and name the DPGF amount columns in the version currency: USD and GBP, EUR unchanged",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const ui: Ui = { app, screen, browser };
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x02-${label}`, data);
      const draft = await prepareV3Draft(ui, army, "V3X02");
      // 2 ml × (15,00 × 1,30 + 1 h × 40,00 × 1,20) = 2 × 67,50 = 135,00 € ; remise 10 % : net 121,50, TVA 24,30, TTC 145,80.
      await seedLines(ui, army, draft, "v3x02", [withLabor(`${army.runPrefix} X`, "ml", 2, 1500, "priced", 1, draft.tuyauteurId)]);
      await patchSettings(ui, "discount", draft, { discount_amount_cents: null, discount_bp: 1000 }, record);
      const settled = await readEstimate(browser, draft.versionId);
      expect([settled.version.calc_engine_version, settled.version.currency, ...totalsOf(settled)]).toEqual([3, "EUR", 12150, 2430, 14580]);
      const actual: Record<string, unknown> = {};
      for (const currency of ["EUR", "USD", "GBP"] as const) {
        if (currency !== "EUR") await patchSettings(ui, currency.toLowerCase(), draft, { currency }, record);
        const state = await readEstimate(browser, draft.versionId);
        const standard = await exportWorkbook(browser, draft.versionId, "standard");
        const dpgf = await exportWorkbook(browser, draft.versionId, "dpgf");
        actual[currency] = { currency: state.version.currency, totals: totalsOf(state), ...currencyFacts(standard, dpgf, currency) };
        await record(`exports-${currency.toLowerCase()}`, { versionId: draft.versionId, standard: { sha256: standard.sha256, bytes: standard.bytes.length },
          dpgf: { sha256: dpgf.sha256, bytes: dpgf.bytes.length }, actual: actual[currency] });
      }
      const expected = Object.fromEntries((["EUR", "USD", "GBP"] as const).map((currency) =>
        [currency, { currency, totals: [12150, 2430, 14580], ...expectedCurrencyFacts(currency) }]));
      await record("currency-formats", { versionId: draft.versionId, projectId: draft.projectId, expected, actual });
      expect(actual).toEqual(expected);
    });
}
