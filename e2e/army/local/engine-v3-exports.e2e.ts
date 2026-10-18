import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import ExcelJS from "exceljs";
import { expect } from "e2e";
import * as xlsx from "xlsx";

import {
  apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence, resolveDownload, type ArmyEstimate, type ArmyItem,
} from "../critical/fixtures";
import {
  lockVersion, openV3Editor, prepareV3Draft, releaseVersion, seedLines, waitForDraftLease, type Envelope, type Ui, type V3Draft,
} from "./engine-v3-editor-support";

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
  const controls = /Contrôle « ?Prix unitaire de vente ?» : (\d+) lignes? vérifiées?, (\d+) écarts?/u.exec(text);
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

// Lot 2, sous-lot 2.7b — exports CSV et BDC V1.1 d'une v3 (A9, A10, A11 ; décision D-a du 18/10/2026 ; contrat et
// preuves : docs/testing/estimate-engine-v3-2.7b.md). Défaillances observables, écrites avant le code :
//  V3X-08 « Exporter CSV » et « Exporter BDC V1.1 » restent fermés dans l'éditeur d'une v3 (menu compact et « Plus
//         d'actions »), et le bouton « Exporter le BDC » du hub reçoit 409 ESTIMATE_ENGINE_UNAVAILABLE.
//  V3X-09 Le CSV d'une v3 est construit dans le navigateur (editor-export.ts) : totaux du client nuls sur une v3,
//         unité lue dans description, PU et total recalculés ou absents ; attendu : le serveur l'écrit depuis le
//         document v3 (GET …/export?format=csv), mêmes lignes, PU, bruts et pied que le classeur standard.
//  V3X-10 Une v3 est lue par le moteur v1/v2 du BDC (computeEstimateLineValues) ou par le garde du gel v2 : montants
//         recalculés en TS, différents du document (D12).
//  V3X-11 Unité tirée de description au lieu de unit_code ; h/u perdues (V1.1 n'a que « h MO » de ligne).
//  V3X-12 Une ligne non chiffrée (incluse, hors lot, pour mémoire) exportée chiffrée : PR FO, heures ou PU de vente
//         écrits en nombre ; attendu : totaux à 0 €, libellé du statut, aucun prix numérique.
//  V3X-13 Colonnes V1.1 déplacées ou renommées : les feuilles en aval cassent ; attendu : en-tête V1.1 intact, colonnes
//         v3 ajoutées à la fin.
//  V3X-14 Remise comptée deux fois ou oubliée ; brouillon modifié depuis son gel présenté comme figé.
//  V3X-15 Prix fournisseur d'une offre convertie (2.9, barre de 3 ml) non ramené à l'unité de la ligne.
//  V3X-16 Régression v1/v2 : le CSV de l'éditeur ou le BDC d'une v2 change de colonnes ou de valeurs (garde V3X06,
//         verte avant).

/** Réponse brute d'une route d'export, lue dans le navigateur (statut, en-têtes, octets, corps JSON d'un refus). */
async function fetchExport(browser: Browser, versionId: string, query: string) {
  const fetched = await browser.evaluate(async (input) => {
    const response = await fetch(`/api/estimates/${input.versionId}/export?${input.query}`, { credentials: "same-origin", redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { status: response.status, contentType: response.headers.get("content-type"), disposition: response.headers.get("content-disposition"),
      base64: btoa(binary) };
  }, { versionId, query });
  const bytes = Buffer.from(fetched.base64, "base64");
  const error = fetched.status === 200 ? null : (() => {
    try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { return bytes.toString("utf8").slice(0, 500); }
  })();
  return { status: fetched.status, contentType: fetched.contentType, disposition: fetched.disposition, bytes, sha256: digest(bytes), error };
}

/** Lignes d'un CSV « ; » (BOM UTF-8), cellules en texte, lignes vides retirées. */
function readCsv(bytes: Buffer) {
  const book = xlsx.read(bytes, { type: "buffer", raw: true, FS: ";" });
  const rows = xlsx.utils.sheet_to_json<unknown[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: false, defval: "", blankrows: false });
  return rows.map((row) => row.map((cell) => String(cell ?? ""))).filter((row) => row.some((cell) => cell.trim() !== ""));
}

/** Téléchargement de l'interface : réponse de la route et fichier retenu. */
async function downloadFrom(browser: Browser, url: RegExp, trigger: () => Promise<void>) {
  const [response, file] = await Promise.all([
    browser.waitForResponse(url, { timeout: 60_000 }), browser.waitForDownload(trigger, { timeout: 60_000 })]);
  const absolutePath = await resolveDownload(file);
  const bytes = await readFile(absolutePath);
  return { status: response.status, url: response.url, filename: file.suggestedFilename, path: absolutePath, bytes, sha256: digest(bytes) };
}

const V3_CSV_HEADER = ["Chemin chapitre", "Poste", "Désignation", "Unité", "Quantité", "Statut", "Prix unitaire HT (EUR)", "Type FO",
  "Fournisseur 1", "Fournisseur 2", "Fournisseur 3", "K FO", "h MO / unité", "Majoration MO (%)", "Rôle MO", "K MO", "PU HT (EUR)",
  "Total HT (EUR)", "TVA (%)"];
// En-tête BDC V1.1 (bdc-export.ts) : inchangé et dans cet ordre pour toute version ; une v3 ajoute ses colonnes à la fin.
const BDC_V11_HEADER = ["Type", "Position", "AID", "Désignation", "Unité", "Quantité", "Type FO", "PU FO HT EUR", "PR FO HT EUR", "K FO",
  "h MO", "K MO", "Taux horaire MO EUR", "Rôle MO", "Catégorie", "Total FO HT EUR", "Total MO HT EUR", "Total HT EUR",
  "Fournisseur 1 Nom", "Fournisseur 1 Prix EUR", "Fournisseur 1 Ref", "Fournisseur 1 URL", "Fournisseur 2 Nom", "Fournisseur 2 Prix EUR",
  "Fournisseur 2 Ref", "Fournisseur 2 URL", "Fournisseur 3 Nom", "Fournisseur 3 Prix EUR", "Fournisseur 3 Ref", "Fournisseur 3 URL", "Ref interne"];
const BDC_V3_COLUMNS = ["Statut", "h MO / unité", "PU vente HT EUR"];
// Brut FO et MO de vente par ligne (c_FO 1,30, c_MO 1,20, Tuyauteur 40 €/h) ; lignes non chiffrées à 0.
const ROUND_TRIP_SPLIT: Record<(typeof ROUND_TRIP)[number]["ref"], { fo: number; mo: number }> = {
  P1: { fo: 2600, mo: 0 }, P2: { fo: 1950, mo: 0 }, P3: { fo: 3900, mo: 9600 }, N1: { fo: 0, mo: 0 }, N2: { fo: 0, mo: 0 }, N3: { fo: 0, mo: 0 },
};

/** Cellules BDC attendues d'une ligne v3 (V1.1 puis colonnes v3) ; fournisseur 1 éventuel. */
function expectedBdcLine(line: (typeof ROUND_TRIP)[number], supplier: { name: string; price: number; ref: string } | null) {
  const priced = line.status === "priced";
  const label = STATUS_LABELS[line.status];
  const split = ROUND_TRIP_SPLIT[line.ref];
  return {
    "Type": "line", "Unité": line.unit, "Quantité": line.quantity, "Type FO": null, "PU FO HT EUR": priced ? line.prFo / 100 : null,
    "PR FO HT EUR": priced ? line.prFo / 100 : null, "K FO": 1, "h MO": null, "K MO": 1, "Taux horaire MO EUR": null,
    "Rôle MO": line.hPerUnit > 0 ? "Tuyauteur" : null, "Catégorie": null, "Total FO HT EUR": split.fo / 100, "Total MO HT EUR": split.mo / 100,
    "Total HT EUR": line.gross / 100, "Fournisseur 1 Nom": supplier?.name ?? null, "Fournisseur 1 Prix EUR": supplier?.price ?? null,
    "Fournisseur 1 Ref": supplier?.ref ?? null, "Statut": label, "h MO / unité": priced ? line.hPerUnit : null,
    "PU vente HT EUR": priced ? line.pu! / 100 : null,
  };
}
const BDC_LINE_COLUMNS = ["Type", "Unité", "Quantité", "Type FO", "PU FO HT EUR", "PR FO HT EUR", "K FO", "h MO", "K MO", "Taux horaire MO EUR",
  "Rôle MO", "Catégorie", "Total FO HT EUR", "Total MO HT EUR", "Total HT EUR", "Fournisseur 1 Nom", "Fournisseur 1 Prix EUR",
  "Fournisseur 1 Ref", "Statut", "h MO / unité", "PU vente HT EUR"] as const;

/** Vue d'un BDC : en-tête, cellules des lignes nommées, totaux, pied de la feuille « Resume ». */
function bdcView(sheets: Record<string, SheetView>, titles: Record<string, string>) {
  const sheet = sheets.BDC_V1_1;
  const rowOf = (title: string) => sheet?.rows.find((candidate) => normalized(candidate.cells["Désignation"]?.value) === title) ?? null;
  const lines = Object.fromEntries(Object.entries(titles).map(([ref, title]) => {
    const row = rowOf(title);
    return [ref, row ? Object.fromEntries(BDC_LINE_COLUMNS.map((column) => [column, row.cells[column]?.value ?? null])) : null];
  }));
  const lineRows = (sheet?.rows ?? []).filter((row) => row.cells.Type?.value === "line");
  const sum = (column: string) => Math.round(lineRows.reduce((total, row) => total + Number(row.cells[column]?.value ?? 0), 0) * 100);
  const refInterne = Object.fromEntries(Object.entries(titles).map(([ref, title]) => [ref, rowOf(title)?.cells["Ref interne"]?.value ?? null]));
  const resume = (sheets.Resume?.rows ?? []).map((row) => [normalized(String(row.cells.Champ?.value ?? "")), row.cells.Valeur?.value ?? null]);
  return { header: sheet?.header ?? null, lines, refInterne, sums: { fo: sum("Total FO HT EUR"), mo: sum("Total MO HT EUR"), ht: sum("Total HT EUR") }, resume };
}

/** Pied du classeur standard d'une v3 (feuille « Resume ») : libellé normalisé et montant. */
function standardFooter(standard: Workbook) {
  return (standard.sheets.Resume?.rows ?? []).filter((row) => FOOTER_FIELD.test(String(row.cells.Champ?.value ?? "")))
    .map((row) => [normalized(String(row.cells.Champ?.value ?? "")), row.cells.Valeur?.value ?? null] as [string, CellValue]);
}

const ROUND_TRIP_LINES = (draft: V3Draft, title: (ref: string) => string, lines: ReadonlyArray<(typeof ROUND_TRIP)[number]> = ROUND_TRIP) =>
  lines.map((line) => line.hPerUnit > 0
    ? withLabor(title(line.ref), line.unit, line.quantity, line.prFo, line.status, line.hPerUnit, draft.tuyauteurId)
    : supply(title(line.ref), line.unit, line.quantity, line.prFo, line.status));

if (process.env.E2E_ARMY_SUITE === "critical") {
  armyTest("V3X03 the v3 editor's CSV export is written by the server from the v3 document: unit, status, sale unit price and gross of each line, the status label instead of any price on a non-priced line, and the document footer",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const ui: Ui = { app, screen, browser };
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x03-${label}`, data);
      const title = (ref: string) => `${army.runPrefix} ${ref}`;
      const draft = await prepareV3Draft(ui, army, "V3X03");
      await seedLines(ui, army, draft, "v3x03", ROUND_TRIP_LINES(draft, title));
      const settled = await readEstimate(browser, draft.versionId);
      expect([settled.version.calc_engine_version, ...totalsOf(settled)]).toEqual([3, ...ROUND_TRIP_TOTALS]);
      const standard = await exportWorkbook(browser, draft.versionId, "standard");
      const footer = standardFooter(standard);
      expect(footer.map(([, amount]) => amount), "standard v3 footer: gross, net, VAT 20 %, TTC").toEqual([180.5, 180.5, 36.1, 216.6]);

      await openV3Editor(ui, army, draft, "v3x03");
      await waitForDraftLease(ui);
      const compact = screen.getByRole("button", "Exporter", { exact: true });
      await expect(compact).toBeEnabled({ timeout: 30_000 });
      await compact.tap();
      const csvItem = screen.getByRole("button", "Fichier CSV (.csv)", { exact: true });
      await expect(csvItem).toBeVisible({ timeout: 30_000 });
      const csvEnabled = await csvItem.isEnabled();
      await record("csv-action", { versionId: draft.versionId, expected: true, actual: csvEnabled });
      expect(csvEnabled, "the v3 editor offers the CSV export (V3X-08)").toBe(true);
      const csv = await downloadFrom(browser, new RegExp(`/api/estimates/${draft.versionId}/export\\?format=csv$`), () => csvItem.tap());
      const rows = readCsv(csv.bytes);
      const posteOf = (lineTitle: string) => String(standard.sheets.Devis?.rows.find((row) =>
        normalized(row.cells["Désignation"]?.value) === lineTitle)?.cells.Poste?.value ?? "");
      const lineRow = (line: (typeof ROUND_TRIP)[number]) => {
        const priced = line.status === "priced";
        const label = STATUS_LABELS[line.status];
        return [draft.sectionTitle, posteOf(title(line.ref)), title(line.ref), line.unit, String(line.quantity), label,
          priced ? String(line.prFo / 100) : label, "", "", "", "", "1", priced ? String(line.hPerUnit) : "", priced ? "100" : "",
          line.hPerUnit > 0 ? "Tuyauteur" : "", "1", priced ? String(line.pu! / 100) : "", priced ? String(line.gross / 100) : label, "20"];
      };
      const footerRow = (label: string, value: string) => ["", "", label, "", "", "", "", "", "", "", "", "", "", "", "", "", "", value, ""];
      const actual = {
        status: csv.status, filename: /\.csv$/i.test(csv.filename), bom: csv.bytes.subarray(0, 3).toString("hex"),
        header: rows[0] ?? null,
        lines: rows.slice(1, 1 + ROUND_TRIP.length).map((row) => row.map((cell) => normalized(cell))),
        footer: rows.slice(1 + ROUND_TRIP.length).map((row) => row.map((cell) => normalized(cell))),
      };
      const expected = {
        status: 200, filename: true, bom: "efbbbf", header: V3_CSV_HEADER,
        lines: ROUND_TRIP.map(lineRow),
        footer: [footerRow("Moteur de calcul", "3"), footerRow("Montants", "Aperçu du brouillon (non figé)"),
          ...footer.map(([label, amount]) => footerRow(label, String(amount)))],
      };
      await record("csv", { versionId: draft.versionId, projectId: draft.projectId, url: csv.url, filename: csv.filename, path: csv.path,
        bytes: csv.bytes.length, sha256: csv.sha256, standard: { sha256: standard.sha256 }, expected, actual });
      expect(actual, "the v3 CSV carries the document lines and footer (V3X-09, V3X-12)").toEqual(expected);
    });

  armyTest("V3X04 the v3 editor's BDC V1.1 export keeps the V1.1 columns and appends the v3 ones: document gross, FO and labour shares of each line, unit_code, hours per unit and status, non-priced lines at 0 with their status label, supplier price of a converted offer per metre, footer of the document",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const ui: Ui = { app, screen, browser };
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x04-${label}`, data);
      const title = (ref: string) => `${army.runPrefix} ${ref}`;
      const draft = await prepareV3Draft(ui, army, "V3X04");
      const seeded = await seedLines(ui, army, draft, "v3x04", ROUND_TRIP_LINES(draft, title));
      // V3X-15 : offre à la barre de 3 ml (27,00 €), convertie au mètre (2.9) ; même désignation que P2 (ml).
      army.ownedPriceLookupProjects = [draft.projectId];
      const created = async <T>(label: string, pathname: string, body: unknown) => {
        const response = await apiRequest<Envelope<{ item: T }>>(browser, "POST", pathname, body);
        await record(`catalogue-${label}`, { pathname, body, response });
        expect([response.status, response.body.ok]).toEqual([201, true]);
        return response.body.data.item;
      };
      const product = await created<{ id: string }>("product", "/api/products", {
        action: "create", item: { designation: title("P2"), reference: `${army.runPrefix}-p2`, unit: "ml", unit_price_cents: 900 } });
      const supplierName = `${army.runPrefix} fournisseur barre`;
      const supplierRecord = await created<{ id: string }>("supplier", "/api/suppliers", { action: "create", item: { name: supplierName, is_active: true } });
      const sku = `${army.runPrefix}-p2-barre`;
      const offer = await created<{ id: string }>("offer", "/api/prices", {
        action: "create", item: { supplier_id: supplierRecord.id, product_id: product.id, supplier_sku: sku, unit: "barre", min_quantity: 1,
          unit_price_cents: 2700, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) } });
      const converted = await apiRequest<Envelope<unknown>>(browser, "POST", "/api/prices", { action: "update-offer", id: offer.id,
        item: { estimate_unit_code: "ml", estimate_units_per_purchase_unit: 3, purchase_rounding: "ceil" } });
      await record("catalogue-conversion", { offerId: offer.id, response: converted });
      expect(converted.status).toBe(200);
      const p2 = seeded[1];
      const comparisons = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${draft.versionId}/supplier-comparisons`,
        { item_ids: [p2.id] });
      await record("supplier-comparisons", { versionId: draft.versionId, lineId: p2.id, response: comparisons });
      expect(comparisons.status).toBe(200);

      const settled = await readEstimate(browser, draft.versionId);
      expect([settled.version.calc_engine_version, ...totalsOf(settled)]).toEqual([3, ...ROUND_TRIP_TOTALS]);
      const standard = await exportWorkbook(browser, draft.versionId, "standard");
      const route = await fetchExport(browser, draft.versionId, "format=xlsx&mode=bdc");
      await record("route", { versionId: draft.versionId, status: route.status, contentType: route.contentType, disposition: route.disposition,
        sha256: route.sha256, bytes: route.bytes.length, error: route.error });
      expect([route.status, route.error], "the BDC route exports a v3 (V3X-08, V3X-10)").toEqual([200, null]);

      await openV3Editor(ui, army, draft, "v3x04");
      await waitForDraftLease(ui);
      const more = screen.getByTestId("estimate-page-toolbar-more-actions-button");
      await more.tap();
      const bdcButton = screen.getByTestId("estimate-page-toolbar-export-bdc-button");
      await expect(bdcButton).toBeVisible({ timeout: 30_000 });
      const bdcEnabled = await bdcButton.isEnabled();
      await record("bdc-action", { versionId: draft.versionId, expected: true, actual: bdcEnabled });
      expect(bdcEnabled, "the v3 editor offers the BDC V1.1 export (V3X-08)").toBe(true);
      const download = await downloadFrom(browser, new RegExp(`/api/estimates/${draft.versionId}/export\\?format=xlsx&mode=bdc$`),
        () => bdcButton.tap());
      const titles = Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, title(line.ref)]));
      const actual = { status: download.status, xlsx: /-bdc-v1_1\.xlsx$/i.test(download.filename), ...bdcView(await readSheets(download.bytes), titles) };
      const supplier = { name: supplierName, price: 9, ref: sku };
      const expected = {
        status: 200, xlsx: true, header: [...BDC_V11_HEADER, ...BDC_V3_COLUMNS],
        lines: Object.fromEntries(ROUND_TRIP.map((line) => [line.ref, expectedBdcLine(line, line.ref === "P2" ? supplier : null)])),
        refInterne: Object.fromEntries(ROUND_TRIP.map((line, index) => [line.ref, seeded[index].id])),
        // Σ des bruts = brut du document ; FO + MO = brut sur chaque ligne (V3X-14 : aucune remise dans les lignes).
        sums: { fo: 2600 + 1950 + 3900, mo: 9600, ht: ROUND_TRIP_TOTALS[0] },
        resume: [["Moteur de calcul", 3], ["Montants", "Aperçu du brouillon (non figé)"], ["Coefficient de vente FO", 1.3],
          ["Coefficient de vente MO", 1.2], ...standardFooter(standard)],
      };
      await record("bdc", { versionId: draft.versionId, projectId: draft.projectId, url: download.url, filename: download.filename,
        path: download.path, bytes: download.bytes.length, sha256: download.sha256, expected, actual });
      expect(actual, "the v3 BDC carries the document values in the V1.1 layout with the v3 columns appended").toEqual(expected);
    });

  armyTest("V3X05 the affaire hub's « Exporter le BDC » exports the current v3 through the same route, with the document values, and confirms it",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const ui: Ui = { app, screen, browser };
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x05-${label}`, data);
      const title = (ref: string) => `${army.runPrefix} ${ref}`;
      const draft = await prepareV3Draft(ui, army, "V3X05");
      const subset = ROUND_TRIP.filter((line) => line.ref === "P3" || line.ref === "N1");
      await seedLines(ui, army, draft, "v3x05", ROUND_TRIP_LINES(draft, title, subset));
      const settled = await readEstimate(browser, draft.versionId);
      expect([settled.version.calc_engine_version, ...totalsOf(settled)]).toEqual([3, 13500, 2700, 16200]);

      await app.open(`/dashboard/affaires/${draft.projectId}`);
      const zone = screen.getByTestId("affaire-finish-line-bdc");
      const button = zone.getByRole("button", "Exporter le BDC", { exact: true });
      await expect(button).toBeVisible({ timeout: 60_000 });
      const [responseResult, downloadResult] = await Promise.allSettled([
        browser.waitForResponse(new RegExp(`/api/estimates/${draft.versionId}/export\\?format=xlsx&mode=bdc$`), { timeout: 60_000 }),
        browser.waitForDownload(() => button.tap(), { timeout: 30_000 }),
      ]);
      const response = responseResult.status === "fulfilled" ? { status: responseResult.value.status, url: responseResult.value.url } : null;
      const alert = normalized(await browser.evaluate(() =>
        document.querySelector("#finish-line-output [role=\"alert\"]")?.textContent ?? ""));
      await record("hub-click", { projectId: draft.projectId, versionId: draft.versionId, response, alert,
        download: downloadResult.status === "fulfilled" ? downloadResult.value.suggestedFilename : String(downloadResult.reason) });
      expect([response?.status ?? null, alert], "the hub exports the v3 BDC without an error (V3X-08)").toEqual([200, ""]);
      if (downloadResult.status !== "fulfilled") throw new Error(`The hub BDC was not downloaded: ${String(downloadResult.reason)}`);
      const file = downloadResult.value;
      await expect(screen.getByText("BDC exporté", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      const absolutePath = await resolveDownload(file);
      const bytes = await readFile(absolutePath);
      const view = bdcView(await readSheets(bytes), Object.fromEntries(subset.map((line) => [line.ref, title(line.ref)])));
      const actual = { filename: /-bdc-v1_1\.xlsx$/i.test(file.suggestedFilename), header: view.header, lines: view.lines, sums: view.sums };
      const expected = {
        filename: true, header: [...BDC_V11_HEADER, ...BDC_V3_COLUMNS],
        lines: Object.fromEntries(subset.map((line) => [line.ref, expectedBdcLine(line, null)])),
        sums: { fo: 3900, mo: 9600, ht: 13500 },
      };
      await record("hub-bdc", { projectId: draft.projectId, versionId: draft.versionId, filename: file.suggestedFilename, path: absolutePath,
        bytes: bytes.length, sha256: digest(bytes), expected, actual });
      expect(actual, "the hub BDC of a v3 equals the document values").toEqual(expected);
    });

  armyTest("V3X06 guard: the editor CSV and the BDC V1.1 of a v2 keep their columns and values",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 300_000 }, async ({ app, screen, browser, army }) => {
      const record = (label: string, data: unknown) => recordEvidence(army, `v3x06-${label}`, data);
      await app.open("/dashboard/affaires");
      const created = await apiRequest<Envelope<{ project: { id: string }; version: { id: string; calc_engine_version: number } }>>(
        browser, "POST", "/api/estimates", { project: { name: `ARMY-L2-V3X06-${army.runPrefix}` }, version: { ...NEUTRAL_V2, title: `${army.runPrefix} V3X06 v2` } });
      expect([created.status, created.body.ok, created.body.data?.version?.calc_engine_version]).toEqual([201, true, 2]);
      const versionId = created.body.data.version.id;
      ownEstimate(army, { projectId: created.body.data.project.id, versionId });
      const lineTitle = `${army.runPrefix} V3X06 tube`;
      // 2 ml × 15,00 € × K FO 1,2 = 36,00 € (marge 1, sans main-d'oeuvre) ; TVA 20 % 7,20 ; TTC 43,20.
      const line = await createLineViaApi(browser, versionId, lineTitle, { description: "ml", quantity: 2, unit_price_ht_cents: 1500, k_fo: 1.2 });
      const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
      expect(released.status).toBe(200);
      const state = await readEstimate(browser, versionId);
      const persisted = state.items.find((item) => item.id === line.id)!;
      expect([persisted.line_total_ht_cents, persisted.pu_ht_cents, persisted.line_total_ttc_cents]).toEqual([3600, 1800, 4320]);

      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
      const compact = screen.getByRole("button", "Exporter", { exact: true });
      await expect(compact).toBeEnabled({ timeout: 30_000 });
      await compact.tap();
      const csvItem = screen.getByRole("button", "Fichier CSV (.csv)", { exact: true });
      await expect(csvItem).toBeEnabled({ timeout: 30_000 });
      // CSV v1/v2 : construit par le navigateur (editor-export.ts), sans requête d'export CSV au serveur.
      const csvFile = await browser.waitForDownload(() => csvItem.tap(), { timeout: 60_000 });
      const csvPath = await resolveDownload(csvFile);
      const csvBytes = await readFile(csvPath);
      const csvRows = readCsv(csvBytes);
      const more = screen.getByTestId("estimate-page-toolbar-more-actions-button");
      await more.tap();
      const bdc = await downloadFrom(browser, new RegExp(`/api/estimates/${versionId}/export\\?format=xlsx&mode=bdc$`),
        () => screen.getByTestId("estimate-page-toolbar-export-bdc-button").tap());
      const csvExportCalls = await browser.evaluate(() => performance.getEntriesByType("resource")
        .filter((entry) => /\/export\?format=csv/.test(entry.name)).length);
      const sheets = await readSheets(bdc.bytes);
      const bdcRow = sheets.BDC_V1_1?.rows.find((row) => normalized(row.cells["Désignation"]?.value) === lineTitle) ?? null;
      const csvLine = csvRows.find((row) => row[1] === lineTitle) ?? null;
      const bdcColumns = BDC_V11_HEADER.filter((column) => !["AID", "Ref interne", "Position"].includes(column));
      const actual = {
        csv: { serverCalls: csvExportCalls, header: csvRows[0]?.slice(0, 19) ?? null,
          line: csvLine ? [0, 3, 4, 5, 10, 11, 15, 16, 17, 18].map((index) => csvLine[index] ?? null) : null },
        bdc: { sheets: Object.keys(sheets), header: sheets.BDC_V1_1?.header ?? null,
          line: bdcRow ? Object.fromEntries(bdcColumns.map((column) => [column, bdcRow.cells[column]?.value ?? null])) : null,
          formats: bdcRow ? ["PU FO HT EUR", "PR FO HT EUR", "Total FO HT EUR", "Total HT EUR"].map((column) => bdcRow.cells[column]?.numFmt ?? null) : null },
      };
      const expected = {
        csv: { serverCalls: 0, header: ["Chemin chapitre", "Désignation", "Flags qualité", "Unité", "Quantité", "Prix unitaire HT (EUR)", "Type FO",
          "Fournisseur 1", "Fournisseur 2", "Fournisseur 3", "K FO", "h MO", "Majoration MO (%)", "Rôle MO", "K MO", "PU HT (EUR)",
          "Total HT (EUR)", "TVA (%)", "Total TTC (EUR)"],
          line: ["ARMY section 1", "ml", "2", "15", "1.2", "0", "18", "36", "20", "43.2"] },
        bdc: { sheets: ["BDC_V1_1"], header: BDC_V11_HEADER,
          line: { "Type": "line", "Désignation": lineTitle, "Unité": "ml", "Quantité": 2, "Type FO": null, "PU FO HT EUR": 15, "PR FO HT EUR": 18,
            "K FO": 1.2, "h MO": 0, "K MO": 1, "Taux horaire MO EUR": 0, "Rôle MO": null, "Catégorie": null, "Total FO HT EUR": 36,
            "Total MO HT EUR": 0, "Total HT EUR": 36, "Fournisseur 1 Nom": null, "Fournisseur 1 Prix EUR": null, "Fournisseur 1 Ref": null,
            "Fournisseur 1 URL": null, "Fournisseur 2 Nom": null, "Fournisseur 2 Prix EUR": null, "Fournisseur 2 Ref": null, "Fournisseur 2 URL": null,
            "Fournisseur 3 Nom": null, "Fournisseur 3 Prix EUR": null, "Fournisseur 3 Ref": null, "Fournisseur 3 URL": null },
          formats: Array.from({ length: 4 }, () => CURRENCY_FORMATS.EUR) },
      };
      await record("v2-exports", { versionId, csv: { filename: csvFile.suggestedFilename, path: csvPath, bytes: csvBytes.length, sha256: digest(csvBytes), rows: csvRows },
        bdc: { url: bdc.url, filename: bdc.filename, path: bdc.path, bytes: bdc.bytes.length, sha256: bdc.sha256 }, expected, actual });
      expect(actual, "the v2 editor CSV and BDC V1.1 are unchanged (V3X-16)").toEqual(expected);
    });
}
