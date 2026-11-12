import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import * as XLSX from "xlsx";
import { expect } from "e2e";

import { COSTING_WORKBOOK_SHEET } from "@/lib/catalogue/costing-workbook";
import type { CostingWorkbookImportReport } from "@/lib/catalogue/costing-workbook-contract";

import { apiRequest, armyTest, recordEvidence } from "./fixtures";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Browser = Parameters<typeof apiRequest>[0];
type SupplyType = { id: string; code: string; name: string };
type Product = { id: string; reference: string | null; designation: string; catalogue_status: string; unit_price_cents: number };
type CatalogueItem = Product & {
  product_type: string | null; material: string | null; grade: string | null; dimensions: string | null;
  category: string | null; unit: string | null; reliability_score: number | null; supply_type_id: string | null;
};

// TI-690, lot 1. Failure modes, written before the journey was first run against the product:
// - something is written before the office has seen the preview, or confirming writes twice;
// - the preview's counts are wrong or not said in words: new drafts, articles already in the catalogue,
//   drafts without a supply type, the supplier references left for purchasing (lot 2), the rows to check;
// - a workbook without the « All_data » sheet is sent to the server instead of refused in the dialog;
// - an imported article is validated (it must stay a draft), loses its reliability mark, its unit or its price,
//   or gets another supply type than the company's own with the proposed code;
// - an article already in the catalogue is modified;
// - the catalogue cannot be shown on its drafts from the dialog;
// - importing the same workbook again creates anything.
const HEADERS = [
  "Fiabilité (/10)", "ID", "Matériau", "Dimension", "Caractéristique", "Précision", "norme", "Qté", "Unité",
  "PR. FO", "Type FO", "K FO", "h MO", "Type MO", "K MO", "Commentaire", "h / \"", "soudure (\")",
  "F1_nom", "F1_prix", "F1_ref", "F1_URL", "F2_nom", "F2_prix", "F2_ref", "F2_URL",
  "F3_nom", "F3_prix", "F3_ref", "F3_URL", "Type_ligne",
];
type Cell = string | number | null;
const row = (values: Record<string, Cell>): Cell[] => HEADERS.map((header) => (header in values ? values[header] : null));

async function cataloguePage(browser: Browser, query: string, status: "draft" | "validated") {
  const response = await apiRequest<Envelope<{ items: CatalogueItem[] }>>(
    browser, "GET", `/api/catalogue?view=page&q=${encodeURIComponent(query)}&catalogue_status=${status}&size=25`,
  );
  expect(response.status).toBe(200);
  return response.body.data.items;
}

async function catalogueItem(browser: Browser, id: string) {
  const response = await apiRequest<Envelope<{ items: Array<Record<string, unknown>> }>>(
    browser, "GET", `/api/catalogue?id=${id}&include_inactive=true&limit=1`,
  );
  expect(response.status).toBe(200);
  return response.body.data.items.find((item) => item.id === id);
}

async function supplyTypes(browser: Browser) {
  const response = await apiRequest<Envelope<{ items: SupplyType[] }>>(browser, "GET", "/api/catalogue/supply-types");
  expect(response.status).toBe(200);
  return response.body.data.items;
}

armyTest(
  "CAT02 the costing workbook becomes catalogue drafts after a preview, and a second import creates nothing",
  { session: "army", tags: ["critical", "catalogue"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const prefix = army.runPrefix;
    await app.open("/dashboard/products");

    // Supply types are the company's, never created by the import: the drafts get the ones with the code the
    // workbook proposes. A company created after the historical seed has none; the journey gives it « Tube »
    // and « Raccord » (codes tube and raccord) and leaves « Vanne » as it finds it.
    for (const name of ["Tube", "Raccord"]) {
      if ((await supplyTypes(browser)).some((type) => type.code === name.toLowerCase())) continue;
      const createdType = await apiRequest<Envelope<{ item: SupplyType }>>(browser, "POST", "/api/catalogue/supply-types", { name });
      expect([201, 409]).toContain(createdType.status);
    }
    const typeIdOf = new Map((await supplyTypes(browser)).map((type) => [type.code, type.id]));
    const expectedType = (code: string) => typeIdOf.get(code) ?? null;
    const withoutSupplyType = ["tube", "raccord", "vanne"].filter((code) => !typeIdOf.has(code)).length;

    // Supplier references are not imported (the catalogue keeps one with its price: purchasing, lot 2); those of
    // the new articles are counted. The suppliers named here are invented and never created.
    const supplierName = `${prefix} Fournisseur fictif`;

    const tubeRef = `${prefix}-Tub.X4so.20`;
    const elbowRef = `${prefix}-Cou.X4so.20`;
    const valveRef = `${prefix}-Van.R.15`;
    const existingRef = `${prefix}-Tub.EXIST.32`;
    const existing = await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create",
      item: { reference: existingRef, designation: `${prefix} tube déjà au catalogue`, unit: "ml", unit_price_cents: 999 },
    });
    expect(existing.status).toBe(201);
    const existingId = existing.body.data.item.id;
    const existingBefore = await catalogueItem(browser, existingId);
    expect(existingBefore).toMatchObject({ reference: existingRef, catalogue_status: "validated", unit_price_cents: 999 });

    // An invented workbook in the shape of the office's: a summary sheet, then « All_data » with a section row,
    // a tube, a fitting, a valve without unit and the article the catalogue already holds.
    const sheetRows: Cell[][] = [
      HEADERS,
      row({ "Type_ligne": "Rub", "Caractéristique": "Tuyauterie inox" }),
      row({
        "Type_ligne": "Art", "ID": tubeRef, "Matériau": "Inox 304L soudé", "Dimension": "DN20", "Caractéristique": "Tube",
        "Précision": "21,3x1,6", "Unité": "ml", "PR. FO": 12.5, "Type FO": "I4L", "Fiabilité (/10)": 8,
        "F1_nom": supplierName, "F1_ref": `${prefix}-T20`, "F1_URL": "https://fournisseur.example/t20",
      }),
      row({
        "Type_ligne": "Art", "ID": elbowRef, "Matériau": "Inox 304L soudé", "Dimension": "DN20",
        "Caractéristique": "Coude 90° à souder", "Unité": "U", "PR. FO": "5,44", "Type FO": "I4L", "Fiabilité (/10)": 6,
        "F1_nom": supplierName, "F1_ref": `${prefix}-C20`,
      }),
      row({
        "Type_ligne": "Art", "ID": valveRef, "Matériau": "Robinetterie", "Dimension": "DN15",
        "Caractéristique": "Vanne à boisseau sphérique", "Type FO": "ROB",
      }),
      row({
        "Type_ligne": "Art", "ID": existingRef, "Matériau": "Inox 304L soudé", "Dimension": "DN32", "Caractéristique": "Tube",
        "Unité": "ml", "PR. FO": 30, "Type FO": "I4L", "Fiabilité (/10)": 9,
        "F1_nom": supplierName, "F1_ref": `${prefix}-T32`,
      }),
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Bible de chiffrage (fictive)"]]), "Sommaire");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheetRows), COSTING_WORKBOOK_SHEET);
    const bytes = Buffer.from(XLSX.write(book, { bookType: "xlsm", type: "buffer" }) as Buffer);
    const otherBook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(otherBook, XLSX.utils.aoa_to_sheet(sheetRows), "Feuil1");
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
    await mkdir(directory, { recursive: true });
    const workbookPath = path.join(directory, "bible-chiffrage.xlsm");
    const otherPath = path.join(directory, "autre-classeur.xlsx");
    await writeFile(workbookPath, bytes);
    await writeFile(otherPath, Buffer.from(XLSX.write(otherBook, { bookType: "xlsx", type: "buffer" }) as Buffer));

    // Every request the dialog sends, by its confirm flag.
    const sent: boolean[] = [];
    await browser.route("**/api/catalogue/workbook-import", async (route) => {
      sent.push((JSON.parse(route.request.postData ?? "{}") as { confirm?: unknown }).confirm === true);
      await route.fallback();
    });

    const openDialog = async () => {
      await screen.getByRole("button", "Ouvrir les actions du catalogue", { exact: true }).tap();
      await screen.getByRole("menuitem", "Importer le classeur de chiffrage", { exact: true }).tap();
      const dialog = screen.getByRole("dialog", "Importer le classeur de chiffrage", { exact: true });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      return dialog;
    };
    const dialog = await openDialog();
    const fileInput = dialog.getByLabel("Classeur de chiffrage", { exact: true });

    // A workbook without the sheet is refused in the dialog, before any request.
    await fileInput.setInputFiles(otherPath);
    await expect(dialog.getByText(
      `Ce classeur n’a pas d’onglet « ${COSTING_WORKBOOK_SHEET} ». Choisissez le classeur de chiffrage.`, { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    expect(sent).toEqual([]);

    // The preview: nothing written, the counts in words.
    const [previewResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      fileInput.setInputFiles(workbookPath),
    ]);
    expect(previewResponse.status).toBe(200);
    const unitIssue = { row: 5, reference: valveRef, message: "Unité absente : « u » retenue." };
    const expectedPreview: CostingWorkbookImportReport = {
      confirmed: false, articles: 4, new_articles: 3, already_in_catalogue: 1, without_supply_type: withoutSupplyType,
      supplier_references_not_imported: 2, issues: [unitIssue], issue_count: 1, sections: 1,
    };
    expect((await previewResponse.json<Envelope<CostingWorkbookImportReport>>()).data).toEqual(expectedPreview);
    expect(sent).toEqual([false]);
    expect(await cataloguePage(browser, prefix, "draft")).toEqual([]);

    const sentences = [
      "3 nouveaux articles en brouillon",
      "1 déjà au catalogue (inchangé)",
      "2 références fournisseur du classeur ne sont pas reprises : elles le seront avec les achats.",
      "1 remarque sur le classeur",
      `Ligne 5 · ${valveRef} : Unité absente : « u » retenue.`,
      ...(withoutSupplyType > 0 ? [`${withoutSupplyType} sans type de fourniture`] : []),
    ];
    for (const sentence of sentences) {
      await expect(dialog.getByText(sentence, { exact: true })).toBeVisible();
    }

    // The import: one confirmed request, the drafts, then the catalogue on its drafts.
    const importButton = dialog.getByRole("button", "Importer 3 brouillons", { exact: true });
    await expect(importButton).toBeEnabled();
    const [importResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      importButton.tap(),
    ]);
    expect(importResponse.status).toBe(200);
    expect((await importResponse.json<Envelope<CostingWorkbookImportReport>>()).data).toEqual({ ...expectedPreview, confirmed: true });
    await expect(dialog.getByText("Import terminé : 3 brouillons créés.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(sent).toEqual([false, true]);

    const drafts = await cataloguePage(browser, prefix, "draft");
    expect(drafts.map((item) => item.reference).sort()).toEqual([elbowRef, tubeRef, valveRef].sort());
    const draftOf = (reference: string) => drafts.find((item) => item.reference === reference)!;
    expect(draftOf(tubeRef)).toMatchObject({
      catalogue_status: "draft", designation: "Tube — Inox 304L soudé DN20", product_type: "Tube",
      material: "Inox 304L soudé", grade: "304L", dimensions: "DN20 — 21,3x1,6", category: "Tuyauterie",
      unit: "ml", unit_price_cents: 1250, reliability_score: 8, supply_type_id: expectedType("tube"),
    });
    expect(draftOf(elbowRef)).toMatchObject({
      catalogue_status: "draft", designation: "Coude 90° à souder — Inox 304L soudé DN20", product_type: "Coude 90° à souder",
      category: "Raccords", unit: "u", unit_price_cents: 544, reliability_score: 6, supply_type_id: expectedType("raccord"),
    });
    expect(draftOf(valveRef)).toMatchObject({
      catalogue_status: "draft", designation: "Vanne à boisseau sphérique DN15", product_type: "Vanne à boisseau sphérique",
      category: "Robinetterie", unit: "u", unit_price_cents: 0, reliability_score: null, supply_type_id: expectedType("vanne"),
    });

    // The article already in the catalogue is untouched.
    expect(await catalogueItem(browser, existingId)).toEqual(existingBefore);

    await dialog.getByRole("button", "Voir les brouillons", { exact: true }).tap();
    await expect(dialog).toBeHidden();
    await expect(browser).toHaveURL(/[?&]catalogue_status=draft(?:&|$)/);

    // The same workbook again: a preview that creates nothing, and nothing to confirm.
    const again = await openDialog();
    const [againResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      again.getByLabel("Classeur de chiffrage", { exact: true }).setInputFiles(workbookPath),
    ]);
    expect(againResponse.status).toBe(200);
    expect((await againResponse.json<Envelope<CostingWorkbookImportReport>>()).data).toEqual({
      ...expectedPreview, new_articles: 0, already_in_catalogue: 4, without_supply_type: 0,
      supplier_references_not_imported: 0,
    });
    await expect(again.getByText("Aucun nouvel article en brouillon", { exact: true })).toBeVisible();
    await expect(again.getByText("4 déjà au catalogue (inchangés)", { exact: true })).toBeVisible();
    await expect(again.getByText("Rien de nouveau à importer.", { exact: true })).toBeVisible();
    await expect(again.getByRole("button", "Importer 0 brouillon", { exact: true })).toBeDisabled();
    expect(sent).toEqual([false, true, false]);
    expect((await cataloguePage(browser, prefix, "draft")).map((item) => item.id).sort()).toEqual(drafts.map((item) => item.id).sort());

    await recordEvidence(army, "catalogue-workbook-import", {
      workbook: { file: path.basename(workbookPath), sha256: createHash("sha256").update(bytes).digest("hex"), rows: sheetRows.length },
      supplyTypes: Object.fromEntries(typeIdOf), existingId,
      draftIds: Object.fromEntries(drafts.map((item) => [item.reference, item.id])), requests: sent,
    });
  },
);
