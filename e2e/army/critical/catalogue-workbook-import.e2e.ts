import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
// - a workbook without the « All_data » sheet is sent to the server instead of refused on the import page;
// - an imported article is validated (it must stay a draft), loses its reliability mark, its unit or its price,
//   or gets another supply type than the company's own with the proposed code;
// - an article already in the catalogue is modified;
// - the catalogue cannot be shown on its drafts from the import page;
// - importing the same workbook again creates anything;
// - (TI-711) a price corrected in the screen is not the draft's price, or the Excel values are sent instead;
// - (TI-711) an article already in the catalogue at another price is not shown as a gap, or is modified;
// - (TI-711) the drafts of an import can only be validated one by one, an incomplete draft is validated with the
//   others, or undoing the import removes an article somebody validated.
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

    // Every request the import page sends, by its confirm flag.
    const sent: boolean[] = [];
    await browser.route("**/api/catalogue/workbook-import", async (route) => {
      sent.push((JSON.parse(route.request.postData ?? "{}") as { confirm?: unknown }).confirm === true);
      await route.fallback();
    });

    const openImport = async () => {
      await screen.getByRole("button", "Ouvrir les actions du catalogue", { exact: true }).tap();
      await screen.getByRole("menuitem", "Importer le classeur de chiffrage", { exact: true }).tap();
      const importPage = screen.getByRole("region", "Importer le classeur de chiffrage", { exact: true });
      await expect(importPage).toBeVisible({ timeout: 15_000 });
      return importPage;
    };
    const importPage = await openImport();
    await expect(browser).toHaveURL(/\/dashboard\/products\/import-workbook(?:\?|$)/);
    await expect(screen.getByRole("dialog", "Importer le classeur de chiffrage", { exact: true })).toBeHidden();
    const fileInput = importPage.getByRole("button", /^(Choisir un|Changer de) fichier Excel$/);

    // A workbook without the sheet is refused on the import page, before any request.
    await fileInput.setInputFiles(otherPath);
    await expect(importPage.getByText(
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
      proposed_articles: [
        { row: 3, without_supply_type: expectedType("tube") === null },
        { row: 4, without_supply_type: expectedType("raccord") === null },
        { row: 5, without_supply_type: expectedType("vanne") === null },
      ],
      // The catalogue holds this tube at 9,99 €, the workbook says 30 €: a gap to read, never written.
      catalogue_differences: [{ row: 6, product_id: existingId, unit_price_cents: 999, unit: "ml", is_active: true }],
    };
    // The company's supply types come with the preview; other journeys of the run may add theirs meanwhile.
    const readReport = async (response: { json<T>(): Promise<T> }) => {
      const { supply_types: offered, ...report } = (await response.json<Envelope<CostingWorkbookImportReport>>()).data;
      return { report, offeredCodes: (offered ?? []).map((type) => type.code) };
    };
    const firstPreview = await readReport(previewResponse);
    expect(firstPreview.report).toEqual(expectedPreview);
    expect(["tube", "raccord"].filter((code) => !firstPreview.offeredCodes.includes(code))).toEqual([]);
    expect(sent).toEqual([false]);
    expect(await cataloguePage(browser, prefix, "draft")).toEqual([]);

    const sentences = [
      "3 nouveaux articles en brouillon",
      "1 déjà au catalogue (inchangé)",
      "2 références fournisseur à traiter séparément.",
      ...(withoutSupplyType > 0 ? [`${withoutSupplyType} sans type de fourniture`] : []),
    ];
    for (const sentence of sentences) {
      await expect(importPage.getByText(sentence, { exact: true })).toBeVisible();
    }

    const draftTable = importPage.getByRole("table", "Articles proposés en brouillon", { exact: true });
    const draftSearch = importPage.getByRole("searchbox", "Rechercher un article proposé", { exact: true });
    await expect(draftTable.getByRole("row")).toHaveCount(4);
    await draftSearch.fill("van.r.15");
    await expect(draftTable.getByText(valveRef, { exact: true })).toBeVisible();
    await expect(draftTable.getByRole("row")).toHaveCount(2);
    await expect(draftTable.getByText("sans prix", { exact: true })).toBeVisible();

    // The valve has no price in the workbook: the office gives it in the screen. The preview is computed again
    // with the corrected cell; the Excel file keeps its value and the journal says what to copy back.
    const priceAddress = XLSX.utils.encode_cell({ r: 4, c: HEADERS.indexOf("PR. FO") });
    await draftTable.getByRole("button", `Corriger la cellule ${priceAddress}`, { exact: true }).tap();
    await importPage.getByRole("textbox", `Nouvelle valeur de la cellule ${priceAddress}`, { exact: true }).fill("45,10");
    const [correctedResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      importPage.getByRole("button", `Appliquer la correction de ${priceAddress}`, { exact: true }).tap(),
    ]);
    expect(correctedResponse.status).toBe(200);
    expect((await readReport(correctedResponse)).report).toEqual(expectedPreview);
    expect(sent).toEqual([false, false]);
    await expect(importPage.getByText("1 correction appliquée à l’aperçu.", { exact: true })).toBeVisible();
    await expect(draftTable.getByText("sans prix", { exact: true })).toBeHidden();
    expect(await cataloguePage(browser, prefix, "draft")).toEqual([]);

    await importPage.getByRole("button", "Écarts avec le catalogue", { exact: true }).tap();
    await expect(importPage.getByText("1 article du catalogue diffère du classeur", { exact: true })).toBeVisible();
    const gap = importPage.getByRole("row", new RegExp(existingRef.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await expect(gap).toContainText("30,00");
    await expect(gap).toContainText("9,99");
    await importPage.getByRole("button", "Remarques sur le classeur", { exact: true }).tap();
    await expect(importPage.getByText("1 remarque sur le classeur", { exact: true })).toBeVisible();
    await expect(importPage.getByText(`Ligne 5 · ${valveRef} : Unité absente : « u » retenue.`, { exact: true })).toBeVisible();

    // The import: one confirmed request, the drafts, then the catalogue on its drafts.
    const importButton = importPage.getByRole("button", "Importer 3 brouillons", { exact: true });
    await expect(importButton).toBeEnabled();
    const [importResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      importButton.tap(),
    ]);
    expect(importResponse.status).toBe(200);
    const expectedConfirmed = { ...expectedPreview, confirmed: true };
    delete expectedConfirmed.proposed_articles;
    delete expectedConfirmed.catalogue_differences;
    // The drafts belong to one import: what the office validates together or undoes.
    const { import_batch_id: importBatchId, ...confirmed } = (await importResponse.json<Envelope<CostingWorkbookImportReport>>()).data;
    expect(confirmed).toEqual(expectedConfirmed);
    expect(importBatchId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(importPage.getByText("Import terminé : 3 brouillons créés.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(sent).toEqual([false, false, true]);

    const drafts = await cataloguePage(browser, prefix, "draft");
    expect(drafts.map((item) => item.reference).sort()).toEqual([elbowRef, tubeRef, valveRef].sort());
    const draftOf = (reference: string) => drafts.find((item) => item.reference === reference)!;
    expect(draftOf(tubeRef)).toMatchObject({
      // The precision, absent from the wording, follows the size in parentheses.
      catalogue_status: "draft", designation: "Tube — Inox 304L soudé DN20 (21,3x1,6)", product_type: "Tube",
      material: "Inox 304L soudé", grade: "304L", dimensions: "DN20 — 21,3x1,6", category: "Tuyauterie",
      unit: "ml", unit_price_cents: 1250, reliability_score: 8, supply_type_id: expectedType("tube"),
    });
    expect(draftOf(elbowRef)).toMatchObject({
      catalogue_status: "draft", designation: "Coude 90° à souder — Inox 304L soudé DN20", product_type: "Coude 90° à souder",
      category: "Raccords", unit: "u", unit_price_cents: 544, reliability_score: 6, supply_type_id: expectedType("raccord"),
    });
    expect(draftOf(valveRef)).toMatchObject({
      // The price is the one corrected in the screen, not the workbook's empty cell.
      catalogue_status: "draft", designation: "Vanne à boisseau sphérique DN15", product_type: "Vanne à boisseau sphérique",
      category: "Robinetterie", unit: "u", unit_price_cents: 4510, reliability_score: null, supply_type_id: expectedType("vanne"),
    });

    // The article already in the catalogue is untouched.
    expect(await catalogueItem(browser, existingId)).toEqual(existingBefore);

    await importPage.getByRole("link", "Voir les brouillons", { exact: true }).tap();
    await expect(importPage).toBeHidden();
    await expect(browser).toHaveURL(/[?&]catalogue_status=draft(?:&|$)/);

    // The same workbook again: a preview that creates nothing, and nothing to confirm.
    const again = await openImport();
    const [againResponse] = await Promise.all([
      browser.waitForResponse("**/api/catalogue/workbook-import"),
      again.getByRole("button", "Choisir un fichier Excel", { exact: true }).setInputFiles(workbookPath),
    ]);
    expect(againResponse.status).toBe(200);
    expect((await readReport(againResponse)).report).toEqual({
      ...expectedPreview, new_articles: 0, already_in_catalogue: 4, without_supply_type: 0,
      supplier_references_not_imported: 0, proposed_articles: [],
    });
    await expect(again.getByText("Aucun nouvel article en brouillon", { exact: true })).toBeVisible();
    await expect(again.getByText("4 déjà au catalogue (inchangés)", { exact: true })).toBeVisible();
    await expect(again.getByRole("button", "Importer 0 brouillon", { exact: true })).toBeDisabled();
    expect(sent).toEqual([false, false, true, false]);
    expect((await cataloguePage(browser, prefix, "draft")).map((item) => item.id).sort()).toEqual(drafts.map((item) => item.id).sort());

    // The complete drafts of the import are validated together; one without a supply type stays a draft.
    const complete = [tubeRef, elbowRef, valveRef].filter((reference) => draftOf(reference).supply_type_id !== null);
    const imports = screen.getByRole("list", "Imports récents", { exact: true });
    const thisImport = imports.getByRole("listitem").filter({ hasText: "3 articles, dont 3 encore en brouillon" });
    await expect(thisImport).toContainText("bible-chiffrage.xlsm");
    await thisImport.getByRole("button", "Valider les brouillons complets", { exact: true }).tap();
    await expect(screen.getByText(new RegExp(`^${complete.length} brouillons? validés?\\.`))).toBeVisible({ timeout: 30_000 });
    expect((await cataloguePage(browser, prefix, "validated")).map((item) => item.reference).filter((reference) => reference !== existingRef).sort())
      .toEqual([...complete].sort());
    expect((await cataloguePage(browser, prefix, "draft")).map((item) => item.reference).sort())
      .toEqual([tubeRef, elbowRef, valveRef].filter((reference) => !complete.includes(reference)).sort());

    // Undoing the import removes what nobody touched: the validated articles stay.
    const remaining = screen.getByRole("list", "Imports récents", { exact: true }).getByRole("listitem").filter({ hasText: "bible-chiffrage.xlsm" });
    if (complete.length < 3) {
      await remaining.getByRole("button", "Annuler l’import", { exact: true }).tap();
      await screen.getByRole("alertdialog", "Annuler cet import d’articles ?", { exact: true })
        .getByRole("button", "Annuler l’import", { exact: true }).tap();
      await expect(screen.getByText(/^Import annulé : 1 brouillon supprimé\./)).toBeVisible({ timeout: 30_000 });
      expect(await cataloguePage(browser, prefix, "draft")).toEqual([]);
    } else {
      // Nothing left to undo once every draft is validated.
      await expect(remaining.getByRole("button", "Annuler l’import", { exact: true })).toBeHidden();
    }
    expect((await cataloguePage(browser, prefix, "validated")).map((item) => item.reference).filter((reference) => reference !== existingRef).sort())
      .toEqual([...complete].sort());

    await recordEvidence(army, "catalogue-workbook-import", {
      workbook: { file: path.basename(workbookPath), sha256: createHash("sha256").update(bytes).digest("hex"), rows: sheetRows.length },
      supplyTypes: Object.fromEntries(typeIdOf), existingId,
      draftIds: Object.fromEntries(drafts.map((item) => [item.reference, item.id])), requests: sent,
      correctedInScreen: { cell: priceAddress, unit_price_cents: 4510 }, catalogueDifferences: 1,
      importBatchId, validatedTogether: complete, undone: complete.length < 3,
    });
  },
);


armyTest(
  "CAT03 the costing workbook imports only matched supplier references for review, with an actionable report",
  { session: "army", tags: ["critical", "catalogue"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    await app.open("/dashboard/products?size=100");
    const prefix = army.runPrefix;
    const supplierName = prefix + " Comptoir Atlas";
    const existingSupplierName = prefix + " Dépôt Boréal";
    const supplier = async (name: string) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const supplierId = await supplier(supplierName);
    const existingSupplierId = await supplier(existingSupplierName);
    const competingSupplierName = prefix + " Quincaillerie Silex";
    await supplier(competingSupplierName);
    const productRef = prefix + "-ATLAS-T32";
    const designation = prefix + " Tube Atlas";
    const created = await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create", item: { reference: productRef, designation, unit: "ml", unit_price_cents: 2799 },
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.item.id;
    const itemPath = "/api/products/" + productId + "/supplier-items";
    const readItems = async () => {
      const result = await apiRequest<Envelope<{ items: Record<string, unknown>[] }>>(browser, "GET", itemPath);
      expect(result.status).toBe(200);
      return result.body.data.items;
    };
    const existing = await apiRequest(browser, "PUT", itemPath, {
      supplier_id: existingSupplierId, supplier_sku: "SKU-EN-SERVICE",
    });
    expect(existing.status).toBe(200);
    const before = await readItems();
    // An article the catalogue archived: the draft import skips its reference, so its supplier references are
    // cells to examine. « draftRef » is new: the draft import creates it, and its reference waits for that.
    const newRef = prefix + "-ARTICLE-ABSENT";
    const archived = await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create", item: { reference: newRef, designation: prefix + " Tube archivé", unit: "ml", unit_price_cents: 100 },
    });
    expect(archived.status).toBe(201);
    expect((await apiRequest(browser, "POST", "/api/products", {
      action: "update", id: archived.body.data.item.id, item: { is_active: false },
    })).status).toBe(200);
    const draftRef = prefix + "-ARTICLE-NOUVEAU";
    const unknownSupplier = prefix + " Fournisseur absent";
    const base = { "Type_ligne": "Art", "ID": productRef, "Caractéristique": "Tube", "Unité": "ml", "F1_prix": 17.99 };
    const book = XLSX.utils.book_new();
    const sheetRows = [
      HEADERS,
      row({ ...base, "F1_nom": supplierName, "F1_ref": 4205, "F2_nom": existingSupplierName, "F2_ref": "000928",
        "F3_nom": supplierName, "F3_ref": "Devis n° 70102" }),
      row({ ...base, "F1_nom": supplierName, "F1_ref": "004205", "F2_nom": unknownSupplier, "F2_ref": "NS-32",
        "F3_nom": competingSupplierName, "F3_ref": "SLX-320" }),
      row({ ...base, "ID": newRef, "Caractéristique": "Tube de démonstration", "Matériau": "Inox 304L", "Dimension": "DN32", "F1_nom": supplierName, "F1_ref": "NA-32",
        "F2_nom": supplierName, "F2_ref": "Doc n° 50210" }),
      row({ ...base, "F1_nom": competingSupplierName, "F1_ref": "Devis n° 90210",
        "F2_nom": competingSupplierName, "F2_ref": "SLX-321" }),
      ...Array.from({ length: 30 }, (_, index) => row({
        ...base, "ID": index === 29 ? newRef.toLowerCase() : newRef, "Matériau": "Inox 304L", "Dimension": "DN32",
        "Caractéristique": index === 29 ? "Clapet de démonstration" : "Tube de démonstration",
        "F1_nom": supplierName, "F1_ref": "NA-32",
      })),
      // Last, so that the rows above keep the numbers the report names.
      row({ ...base, "ID": draftRef, "Caractéristique": "Manchon de démonstration", "Matériau": "Inox 304L", "Dimension": "DN40",
        "F1_nom": supplierName, "F1_ref": "DR-40" }),
    ];
    const reorderedHeaders = [...HEADERS.filter((header) => header !== "F1_ref"), "F1_ref"];
    const sheet = XLSX.utils.aoa_to_sheet(sheetRows.map((cells) => reorderedHeaders.map((header) => cells[HEADERS.indexOf(header)])));
    const proposedAddress = XLSX.utils.encode_cell({ r: 1, c: reorderedHeaders.indexOf("F1_ref") });
    sheet[proposedAddress].z = "000000";
    XLSX.utils.book_append_sheet(book, sheet, COSTING_WORKBOOK_SHEET);
    const bytes = Buffer.from(XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer);
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
    await mkdir(directory, { recursive: true });
    const workbookPath = path.join(directory, "references-fournisseur.xlsx");
    const secondWorkbookPath = path.join(directory, "references-fournisseur-relues.xlsx");
    const uniqueWorkbookPath = path.join(directory, "reference-fournisseur-identifiant-unique.xlsx");
    await writeFile(workbookPath, bytes);
    await writeFile(secondWorkbookPath, bytes);
    const uniqueBook = XLSX.utils.book_new();
    const uniqueRows = [sheetRows[0], sheetRows[2]].map((cells) => reorderedHeaders.map((header) => cells[HEADERS.indexOf(header)]));
    XLSX.utils.book_append_sheet(uniqueBook, XLSX.utils.aoa_to_sheet(uniqueRows), COSTING_WORKBOOK_SHEET);
    await writeFile(uniqueWorkbookPath, XLSX.write(uniqueBook, { bookType: "xlsx", type: "buffer" }) as Buffer);
    const open = async () => {
      await screen.getByRole("button", "Ouvrir les actions du catalogue", { exact: true }).tap();
      await screen.getByRole("menuitem", "Importer le classeur de chiffrage", { exact: true }).tap();
      const importPage = screen.getByRole("region", "Importer le classeur de chiffrage", { exact: true });
      await importPage.getByRole("tab", "Références fournisseur", { exact: true }).tap();
      await importPage.getByRole("button", "Choisir un fichier Excel", { exact: true }).setInputFiles(workbookPath);
      return importPage;
    };

    const importPage = await open();
    await expect(importPage.getByRole("button", "Proposées à l’import", { exact: true })).toBeVisible({ timeout: 30_000 });
    const articlesMode = importPage.getByRole("tab", "Articles en brouillon", { exact: true });
    const referencesMode = importPage.getByRole("tab", "Références fournisseur", { exact: true });
    await articlesMode.tap();
    await expect(importPage.getByRole("tabpanel", "Articles en brouillon", { exact: true })
      .getByText("1 nouvel article en brouillon", { exact: true })).toBeVisible({ timeout: 30_000 });
    const selectedFile = await browser.evaluate(() =>
      document.querySelector<HTMLInputElement>('#costing-workbook-file')?.files?.[0]?.name ?? null,
    );
    expect(selectedFile).toBe(path.basename(workbookPath));
    await referencesMode.tap();
    const decisionSearch = importPage.getByRole("searchbox", "Rechercher par article, fournisseur ou code fournisseur", { exact: true });
    await importPage.getByRole("button", "Proposées à l’import", { exact: true }).tap();
    const proposals = importPage.getByRole("table", "Références proposées à l’import", { exact: true });
    await expect(proposals.getByRole("row")).toHaveCount(2);
    await expect(proposals.getByRole("cell", productRef, { exact: true })).toBeVisible();
    await expect(proposals.getByRole("cell", supplierName, { exact: true })).toBeVisible();
    await expect(proposals.getByRole("cell", "004205", { exact: true })).toBeVisible();
    const copyAddress = proposals.getByRole("button", `Copier la cellule Excel ${proposedAddress}`, { exact: true });
    await browser.evaluate(() => {
      const clipboard = navigator.clipboard;
      const writeText = clipboard.writeText.bind(clipboard);
      Object.defineProperty(clipboard, "writeText", {
        configurable: true,
        value: async (address: string) => {
          document.body.dataset.workbookCellCopy = address;
          try {
            await writeText(address);
            document.body.dataset.workbookCellCopyResult = "copied";
          } catch (error) {
            document.body.dataset.workbookCellCopyResult = "refused";
            throw error;
          }
        },
      });
      return null;
    });
    await copyAddress.tap();
    const readCopyResult = () => browser.evaluate(() => document.body.dataset.workbookCellCopyResult ?? "");
    await expect.poll(readCopyResult).toMatch(/^(copied|refused)$/);
    expect(await browser.evaluate(() => document.body.dataset.workbookCellCopy ?? "")).toBe(proposedAddress);
    const copyFeedback = await readCopyResult() === "copied" ? `${proposedAddress} copiée.` : "Sélectionnez l’adresse pour la copier.";
    await expect(proposals.getByText(copyFeedback, { exact: true })).toBeVisible();
    // The new article's reference is not a cell to fix: it waits for the draft import, and says so.
    await importPage.getByRole("button", "Articles à créer d’abord", { exact: true }).tap();
    await expect(importPage.getByText("1 référence attend 1 article à créer", { exact: true })).toBeVisible();
    await expect(importPage.getByRole("list", "Articles à créer d’abord", { exact: true })).toContainText(draftRef);
    const allDecisions = importPage.getByRole("button", "Toutes à examiner", { exact: true });
    await allDecisions.tap();
    const exportCorrections = importPage.getByRole("button", "Exporter les corrections", { exact: true });
    await expect(exportCorrections).toBeEnabled();
    const readCorrections = async (reason: string) => {
      const download = await browser.waitForDownload(() => exportCorrections.tap());
      expect(download.suggestedFilename).toBe(`corrections-${reason}.xlsx`);
      const exported = XLSX.read(await readFile(download.absolutePath), { type: "buffer", cellNF: true });
      expect(exported.SheetNames).toEqual(["Corrections"]);
      const sheet = exported.Sheets.Corrections;
      const exportedRows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
      return { sheet, rows: exportedRows };
    };
    await importPage.getByRole("button", "Sources de prix", { exact: true }).tap();
    await expect(importPage.getByText("3 sources de prix écartées", { exact: true })).toBeVisible();
    const values = importPage.getByRole("list", "Valeurs avec sources de prix", { exact: true });
    const mixed = values.getByRole("listitem", { name: productRef + " · " + supplierName, exact: true });
    await expect(mixed).toContainText("004205");
    await expect(mixed).toContainText("Ligne 2 · F1_ref");
    await expect(mixed).toContainText("Devis n° 70102");
    await expect(mixed).toContainText("Ligne 2 · F3_ref");
    await expect(mixed).toContainText("Source de prix · Devis");
    const unmatched = values.getByRole("listitem", { name: newRef + " · " + supplierName, exact: true });
    await expect(unmatched).toContainText("NA-32");
    await expect(unmatched).toContainText("Doc n° 50210");
    await importPage.getByRole("button", "Codes à départager", { exact: true }).tap();
    const conflicts = importPage.getByRole("list", "Références produit à départager", { exact: true });
    await expect(conflicts.getByRole("listitem")).toHaveCount(1);
    const competitors = conflicts.getByRole("listitem", { name: productRef + " · " + competingSupplierName, exact: true });
    await expect(competitors).toContainText("Devis n° 90210");
    await expect(competitors).toContainText("SLX-320");
    await expect(competitors).toContainText("Ligne 3 · F3_ref");
    await expect(competitors).toContainText("SLX-321");
    await expect(competitors).toContainText("Ligne 5 · F2_ref");
    await allDecisions.tap();
    const rejected = importPage.getByRole("table", "33 références à examiner", { exact: true });
    await expect(rejected.getByRole("columnheader", "Motif", { exact: true })).toBeVisible();
    await expect(rejected.getByText("000928", { exact: true })).toBeVisible();
    await expect(rejected.getByText("NS-32", { exact: true })).toBeVisible();
    // Every reason in one file: the office fills it in one pass.
    const everyCorrection = await readCorrections("a-examiner");
    expect(everyCorrection.rows).toHaveLength(33);
    // What the catalogue holds against the workbook's code is said with the reason.
    await expect(rejected.getByText("SKU-EN-SERVICE", { exact: true })).toBeVisible();
    await expect(rejected.getByText("Ligne 4 · ID", { exact: true })).toBeVisible();
    await expect(rejected.getByRole("row")).toHaveCount(31);
    await expect(importPage.getByText("1–30 sur 33", { exact: true })).toBeVisible();
    await importPage.getByRole("button", "Suivante", { exact: true }).tap();
    await expect(importPage.getByText("31–33 sur 33", { exact: true })).toBeVisible();
    await expect(rejected.getByRole("row")).toHaveCount(4);
    await expect(rejected.getByText("Ligne 35 · ID", { exact: true })).toBeVisible();
    await importPage.getByRole("button", "Article actif introuvable", { exact: true }).tap();
    const missingArticles = importPage.getByRole("table", "31 références à examiner", { exact: true });
    await expect(importPage.getByText("1 article distinct", { exact: true })).toBeVisible();
    await expect(missingArticles.getByRole("row")).toHaveCount(2);
    const catalogueLookup = missingArticles.getByRole("link", "Chercher dans le catalogue", { exact: true });
    await expect(catalogueLookup).toHaveAttribute("href", `/dashboard/products?${new URLSearchParams({ q: "Tube de démonstration" })}`);
    await expect(catalogueLookup).toHaveAttribute("target", "_blank");
    await expect(missingArticles.getByText("Tube de démonstration · Inox 304L · DN32", { exact: true })).toBeVisible();
    await missingArticles.getByText("31 occurrences", { exact: false }).tap();
    await expect(missingArticles.getByText("Ligne 35 · ID", { exact: true })).toBeVisible();
    await expect(missingArticles.getByRole("button", "Copier la cellule Excel B35", { exact: true })).toBeVisible();
    await expect(missingArticles.getByText("Clapet de démonstration · Inox 304L · DN32", { exact: true })).toBeVisible();
    await expect(missingArticles.getByText(newRef.toLowerCase(), { exact: true })).toBeVisible();
    await expect(missingArticles.getByText("NS-32", { exact: true })).toBeHidden();
    const articleCorrections = await readCorrections("article-not-found");
    expect(articleCorrections.rows).toHaveLength(31);
    expect(articleCorrections.rows[0]).toMatchObject({
      "Motif": "Article actif introuvable", "Onglet": COSTING_WORKBOOK_SHEET,
      "Cellule à vérifier": "B4", "Colonne": "ID", "Valeur d’origine": newRef,
      "Désignation": "Tube de démonstration", "Code fournisseur": "NA-32",
    });
    expect(articleCorrections.rows.at(-1)).toMatchObject({
      "Cellule à vérifier": "B35", "Valeur d’origine": newRef.toLowerCase(), "Identifiant unique à l’export": "Non",
    });
    await decisionSearch.fill(" atlas-t32 ");
    await expect(importPage.getByText("Aucune référence ne correspond à la recherche.", { exact: true })).toBeVisible();
    await expect(exportCorrections).toBeDisabled();
    await importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true }).tap();
    const missingSuppliers = importPage.getByRole("table", "1 référence à examiner", { exact: true });
    // One supplier name, one decision: associate it, create it, or open its cells.
    await expect(importPage.getByText("1 fournisseur distinct", { exact: true })).toBeVisible();
    await expect(missingSuppliers.getByRole("button", `Créer le fournisseur ${unknownSupplier}`, { exact: true })).toBeVisible();
    await missingSuppliers.getByText("Voir les cellules", { exact: true }).tap();
    await expect(missingSuppliers.getByText("NS-32", { exact: true })).toBeVisible();
    await expect(missingSuppliers.getByText("Ligne 3 · F2_nom", { exact: true })).toBeVisible();
    const supplierAddress = XLSX.utils.encode_cell({ r: 2, c: reorderedHeaders.indexOf("F2_nom") });
    await expect(missingSuppliers.getByRole("button", `Copier la cellule Excel ${supplierAddress}`, { exact: true })).toBeVisible();
    const supplierCorrections = await readCorrections("supplier-not-found");
    expect(supplierCorrections.rows).toHaveLength(1);
    expect(supplierCorrections.rows[0]).toMatchObject({
      "Cellule à vérifier": supplierAddress, "Colonne": "F2_nom", "Valeur d’origine": unknownSupplier, "Code fournisseur": "NS-32",
      "Identifiant unique à l’export": "Non",
    });
    await expect(importPage.getByRole("button", "Suivante", { exact: true })).toBeHidden();
    await decisionSearch.fill("DEPOT BOREAL");
    await expect(importPage.getByText("Aucune référence ne correspond à la recherche.", { exact: true })).toBeVisible();
    await allDecisions.tap();
    await expect(missingSuppliers.getByText("000928", { exact: true })).toBeVisible();
    const existingReference = importPage.getByRole("button", "Une autre référence ou liaison existe déjà", { exact: true });
    await existingReference.tap();
    await decisionSearch.fill("0009");
    await articlesMode.tap();
    await expect(importPage.getByText("1 nouvel article en brouillon", { exact: true })).toBeVisible();
    await referencesMode.tap();
    await expect(existingReference).toHaveAttribute("aria-pressed", "true");
    await expect(decisionSearch).toHaveValue("0009");
    await expect(missingSuppliers.getByText("000928", { exact: true })).toBeVisible();
    const existingCorrections = await readCorrections("different-existing-reference");
    expect(existingCorrections.rows).toHaveLength(1);
    expect(existingCorrections.rows[0]).toMatchObject({ "Code fournisseur": "000928", "Valeur d’origine": "000928" });
    const codeColumn = XLSX.utils.sheet_to_json<string[]>(existingCorrections.sheet, { header: 1 })[0].indexOf("Code fournisseur");
    expect(existingCorrections.sheet[XLSX.utils.encode_cell({ r: 1, c: codeColumn })]).toMatchObject({ t: "s", v: "000928" });
    const entryColumn = XLSX.utils.sheet_to_json<string[]>(existingCorrections.sheet, { header: 1 })[0].indexOf("Correction à renseigner");
    expect(existingCorrections.sheet[XLSX.utils.encode_cell({ r: 1, c: entryColumn })]).toMatchObject({ z: "@" });
    await allDecisions.tap();
    await decisionSearch.fill("NA-32");
    await importPage.getByRole("button", "Suivante", { exact: true }).tap();
    await articlesMode.tap();
    await expect(importPage.getByText("1 nouvel article en brouillon", { exact: true })).toBeVisible();
    await referencesMode.tap();
    await expect(decisionSearch).toHaveValue("NA-32");
    await expect(importPage.getByText("31–31 sur 31", { exact: true })).toBeVisible();
    const changeWorkbook = importPage.getByRole("button", "Changer de fichier Excel", { exact: true });
    await changeWorkbook.setInputFiles(uniqueWorkbookPath);
    await expect(importPage.getByText(path.basename(uniqueWorkbookPath), { exact: false })).toBeVisible();
    await importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true }).tap();
    const uniqueCorrection = await readCorrections("supplier-not-found");
    expect(uniqueCorrection.rows).toMatchObject([{
      "Cellule à vérifier": XLSX.utils.encode_cell({ r: 1, c: reorderedHeaders.indexOf("F2_nom") }),
      "Valeur d’origine": unknownSupplier, "Identifiant unique à l’export": "Oui",
    }]);
    await changeWorkbook.setInputFiles(secondWorkbookPath);
    await expect(decisionSearch).toHaveValue("");
    await expect(allDecisions).toHaveAttribute("aria-pressed", "true");
    await expect(importPage.getByText("1–30 sur 33", { exact: true })).toBeVisible();
    await expect(rejected.getByText("000928", { exact: true })).toBeVisible();
    expect(await readItems()).toEqual(before);
    expect(await cataloguePage(browser, newRef, "draft")).toEqual([]);

    await importPage.getByRole("button", "Importer 1 référence", { exact: true }).tap();
    await expect(importPage.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await articlesMode.tap();
    await expect(importPage.getByText("1 nouvel article en brouillon", { exact: true })).toBeVisible({ timeout: 30_000 });
    await referencesMode.tap();
    await expect(importPage.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible();
    await expect(rejected.getByRole("row")).toHaveCount(31);
    const imported = await readItems();
    expect(imported).toHaveLength(2);
    expect(imported.find((item) => item.supplier_id === existingSupplierId)).toEqual(before[0]);
    expect(imported.find((item) => item.supplier_id === supplierId)).toMatchObject({
      supplier_sku: "004205", reference_needs_review: true, is_active: false, has_price: false,
    });
    expect((await catalogueItem(browser, productId))?.unit_price_cents).toBe(2799);
    expect(await cataloguePage(browser, newRef, "draft")).toEqual([]);

    // The screen keeps what it imported: the office knows which references to verify, and where.
    await importPage.getByRole("button", "Importées, à vérifier", { exact: true }).tap();
    const importedList = importPage.getByRole("table", "Références importées", { exact: true });
    await expect(importedList.getByText("004205", { exact: true })).toBeVisible();
    await expect(importedList.getByRole("link", "Vérifier sur la fiche", { exact: true }))
      .toHaveAttribute("href", `/dashboard/products?${new URLSearchParams({ product_id: productId })}`);

    // The new article first, then its reference: the draft import leads back to the references it left.
    await articlesMode.tap();
    await importPage.getByRole("button", "Importer 1 brouillon", { exact: true }).tap();
    await expect(importPage.getByText("Import terminé : 1 brouillon créé.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const [draft] = await cataloguePage(browser, draftRef, "draft");
    expect(draft).toMatchObject({ reference: draftRef, catalogue_status: "draft" });
    await importPage.getByRole("button", "Reprendre leurs références fournisseur", { exact: true }).tap();
    await expect(importPage.getByRole("button", "Articles à créer d’abord", { exact: true })).toBeHidden({ timeout: 30_000 });
    await importPage.getByRole("button", "Importer 1 référence", { exact: true }).tap();
    await expect(importPage.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const draftItems = await apiRequest<Envelope<{ items: Record<string, unknown>[] }>>(browser, "GET", `/api/products/${draft.id}/supplier-items`);
    expect(draftItems.body.data.items).toMatchObject([{ supplier_id: supplierId, supplier_sku: "DR-40", reference_needs_review: true, is_active: false }]);

    // A supplier the catalogue lacks is created from the screen: its reference is then proposed, without Excel.
    await importPage.getByRole("button", "Actualiser l’aperçu", { exact: true }).tap();
    await importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true }).tap();
    await importPage.getByRole("button", `Créer le fournisseur ${unknownSupplier}`, { exact: true }).tap();
    const createdReference = importPage.getByRole("button", "Importer 1 référence", { exact: true });
    await expect(createdReference).toBeEnabled({ timeout: 30_000 });
    await expect(importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true })).toBeHidden();
    await createdReference.tap();
    await expect(importPage.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const afterCreation = await readItems();
    expect(afterCreation).toHaveLength(3);
    expect(afterCreation.find((item) => item.supplier_name === unknownSupplier)).toMatchObject({
      supplier_sku: "NS-32", reference_needs_review: true, is_active: false,
    });

    const productsBreadcrumb = importPage.getByRole("navigation", "Fil d'Ariane", { exact: true })
      .getByRole("link", "Produits", { exact: true });
    await expect(productsBreadcrumb).toHaveAttribute("href", "/dashboard/products?size=100");
    await productsBreadcrumb.tap();
    await expect(browser).toHaveURL(/\/dashboard\/products\?size=100$/);
    const again = await open();
    await expect(again.getByText("3 références déjà enregistrées", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(again.getByRole("button", "Importer 0 référence", { exact: true })).toBeDisabled();
    expect(await readItems()).toEqual(afterCreation);
    await productsBreadcrumb.tap();
    await browser.goto("/dashboard/products?product_id=" + productId, { waitUntil: "domcontentloaded" });
    // Two references of this article wait for a check: the one imported first and the created supplier's.
    await expect(screen.getByText("à vérifier", { exact: true })).toHaveCount(2, { timeout: 60_000 });
    await expect(screen.getByText("Réf. 004205", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Modifier " + supplierName, { exact: true }).tap();
    await screen.getByRole("button", "Valider la référence", { exact: true }).tap();
    await expect(screen.getByText("à vérifier", { exact: true })).toHaveCount(1);
    expect((await readItems()).find((item) => item.supplier_id === supplierId)).toMatchObject({
      supplier_sku: "004205", reference_needs_review: false, is_active: true, has_price: false,
    });

    await recordEvidence(army, "catalogue-workbook-supplier-references", {
      source: { sha256: createHash("sha256").update(bytes).digest("hex"), rows: sheetRows.length },
      productId, supplierId, existingSupplierId, previewWrites: 0, imported: 3, forDecision: 33,
      comparisonGroups: 3, priceSources: 3, retryWrites: 0, keptWorkbookOnModeChange: true,
      draftFirst: { draftId: draft.id, reference: "DR-40" }, supplierCreatedInScreen: unknownSupplier,
    });
  },
);


// TI-711. Failure modes, written before the journey was first run against the product:
// - a supplier the workbook abbreviates must be fixed in Excel, or the association is forgotten at the next preview;
// - the link the workbook gives with a reference is lost;
// - an imported reference can only be checked from its article's form, one by one;
// - undoing an import removes a reference the office already checked, or leaves the untouched ones.
armyTest(
  "CAT04 a workbook name is remembered for its supplier, references are checked together and an import is undone",
  { session: "army", tags: ["critical", "catalogue"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    await app.open("/dashboard/products");
    const prefix = army.runPrefix;
    const supplierName = prefix + " Négoce Lumen";
    const createdSupplier = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: supplierName, is_active: true },
    });
    expect(createdSupplier.status).toBe(201);
    const supplierId = createdSupplier.body.data.item.id;
    const productRef = prefix + "-LUMEN-T40";
    const created = await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create", item: { reference: productRef, designation: prefix + " Tube Lumen", unit: "ml", unit_price_cents: 1500 },
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.item.id;
    const draftRef = prefix + "-LUMEN-NOUVEAU";
    const itemsOf = async (id: string) => {
      const result = await apiRequest<Envelope<{ items: Record<string, unknown>[] }>>(browser, "GET", `/api/products/${id}/supplier-items`);
      expect(result.status).toBe(200);
      return result.body.data.items;
    };

    // The workbook abbreviates the supplier on the article the catalogue holds, and names it in full on a new one.
    const workbookName = prefix + " Nég. Lumen";
    const base = { "Type_ligne": "Art", "Unité": "ml", "Matériau": "Inox 304L" };
    const sheetRows = [
      HEADERS,
      row({ ...base, "ID": productRef, "Caractéristique": "Tube", "F1_nom": workbookName, "F1_ref": "NL-40", "F1_URL": "https://lumen.example/nl-40" }),
      row({ ...base, "ID": draftRef, "Caractéristique": "Manchon", "Dimension": "DN40", "F1_nom": supplierName, "F1_ref": "NL-41" }),
    ];
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(sheetRows), COSTING_WORKBOOK_SHEET);
    const bytes = Buffer.from(XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer);
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", prefix);
    await mkdir(directory, { recursive: true });
    const workbookPath = path.join(directory, "bible-lumen.xlsx");
    await writeFile(workbookPath, bytes);

    await screen.getByRole("button", "Ouvrir les actions du catalogue", { exact: true }).tap();
    await screen.getByRole("menuitem", "Importer le classeur de chiffrage", { exact: true }).tap();
    const importPage = screen.getByRole("region", "Importer le classeur de chiffrage", { exact: true });
    await importPage.getByRole("tab", "Références fournisseur", { exact: true }).tap();
    await importPage.getByRole("button", "Choisir un fichier Excel", { exact: true }).setInputFiles(workbookPath);

    // The abbreviated name is one decision: the catalogue supplier it looks like is proposed, and remembered.
    await importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true }).tap({ timeout: 30_000 });
    await importPage.getByRole("button", `Associer ${workbookName} à ${supplierName}`, { exact: true }).tap();
    const importReference = importPage.getByRole("button", "Importer 1 référence", { exact: true });
    await expect(importReference).toBeEnabled({ timeout: 30_000 });
    await expect(importPage.getByRole("button", "Fournisseur actif introuvable", { exact: true })).toBeHidden();
    await importPage.getByRole("button", "Noms associés", { exact: true }).tap();
    await expect(importPage.getByRole("list", "Noms associés", { exact: true })).toContainText(`« ${workbookName} » est ${supplierName}`);
    expect(await itemsOf(productId)).toEqual([]);

    await importReference.tap();
    await expect(importPage.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await itemsOf(productId)).toMatchObject([{
      supplier_id: supplierId, supplier_sku: "NL-40", product_url: "https://lumen.example/nl-40", reference_needs_review: true, is_active: false,
    }]);

    // The reference is checked with the others of its import, from one list, not from the article's form.
    await importPage.getByRole("link", "Les vérifier ensemble", { exact: true }).tap();
    await expect(browser).toHaveURL(/\/dashboard\/products\/supplier-references\?import_batch_id=/);
    const queue = screen.getByRole("table", "Références fournisseur à vérifier", { exact: true });
    await expect(queue.getByRole("row")).toHaveCount(2, { timeout: 30_000 });
    await expect(queue.getByRole("link", "Fiche fournisseur", { exact: false })).toHaveAttribute("href", "https://lumen.example/nl-40");
    await queue.getByRole("checkbox", "Sélectionner les références de cette page", { exact: true }).tap();
    await screen.getByRole("button", "Valider la sélection", { exact: true }).tap();
    await expect(screen.getByText("1 référence validée.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await itemsOf(productId)).toMatchObject([{
      supplier_id: supplierId, supplier_sku: "NL-40", product_url: "https://lumen.example/nl-40", reference_needs_review: false, is_active: true,
    }]);

    // The new article, then its reference; the remembered name still holds for a new preview of the same workbook.
    await browser.goto("/dashboard/products/import-workbook", { waitUntil: "domcontentloaded" });
    const again = screen.getByRole("region", "Importer le classeur de chiffrage", { exact: true });
    await again.getByRole("button", "Choisir un fichier Excel", { exact: true }).setInputFiles(workbookPath);
    await again.getByRole("button", "Importer 1 brouillon", { exact: true }).tap({ timeout: 30_000 });
    await expect(again.getByText("Import terminé : 1 brouillon créé.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const [draft] = await cataloguePage(browser, draftRef, "draft");
    expect(draft).toMatchObject({ reference: draftRef, catalogue_status: "draft" });
    await again.getByRole("button", "Reprendre leurs références fournisseur", { exact: true }).tap();
    await expect(again.getByText("1 référence déjà enregistrée", { exact: true })).toBeVisible({ timeout: 30_000 });
    await again.getByRole("button", "Importer 1 référence", { exact: true }).tap();
    await expect(again.getByText("1 référence importée, à vérifier.", { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await itemsOf(draft.id)).toMatchObject([{ supplier_id: supplierId, supplier_sku: "NL-41", reference_needs_review: true }]);

    // Undo: the pending reference of the second import goes, then the untouched draft; the checked reference stays.
    const imports = screen.getByRole("list", "Imports récents", { exact: true });
    const undo = async (kind: "articles" | "références", text: string, outcome: RegExp) => {
      const entry = imports.getByRole("listitem").filter({ hasText: "bible-lumen.xlsx" }).filter({ hasText: text });
      await entry.getByRole("button", "Annuler l’import", { exact: true }).tap();
      await screen.getByRole("alertdialog", kind === "articles" ? "Annuler cet import d’articles ?" : "Annuler cet import de références ?", { exact: true })
        .getByRole("button", "Annuler l’import", { exact: true }).tap();
      await expect(screen.getByText(outcome)).toBeVisible({ timeout: 30_000 });
    };
    await undo("références", "1 référence, dont 1 à vérifier", /^Import annulé : 1 référence supprimée\./);
    expect(await itemsOf(draft.id)).toEqual([]);
    await undo("articles", "1 article, dont 1 encore en brouillon", /^Import annulé : 1 brouillon supprimé\./);
    expect(await cataloguePage(browser, draftRef, "draft")).toEqual([]);
    expect(await itemsOf(productId)).toMatchObject([{ supplier_sku: "NL-40", reference_needs_review: false, is_active: true }]);

    await recordEvidence(army, "catalogue-workbook-review-together", {
      source: { sha256: createHash("sha256").update(bytes).digest("hex"), rows: sheetRows.length },
      productId, supplierId, rememberedName: workbookName, checkedTogether: 1, undone: { references: 1, drafts: 1 },
    });
  },
);
