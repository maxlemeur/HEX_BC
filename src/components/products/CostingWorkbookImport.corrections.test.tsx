import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CostingWorkbookImportReport,
  CostingWorkbookSupplierReferenceReport,
} from "@/lib/catalogue/costing-workbook-contract";

import { CostingWorkbookImport } from "./CostingWorkbookImport";

/**
 * Failure modes of correcting the costing workbook in the import screen (TI-711), written before the code. The
 * workbook rows, suppliers and articles are invented; the network is the only stub.
 *  1. After a correction in Excel or in the catalogue, the office cannot see its effect: the same file chosen
 *     again is not read (a browser stays silent on an unchanged path), and nothing computes the preview again.
 *  2. A cell corrected in the screen is not what the preview and the import read; the correction is lost, cannot
 *     be undone, or is not listed with the cell and the value the Excel file still holds.
 *  3. A sheet whose required header was renamed is refused with nothing to do but go back to Excel.
 *  4. A family of the workbook that has no supply type in the company leaves its drafts without one, with no way
 *     to choose it before the import; the choice is not sent with the confirmation.
 *  5. References of articles the draft import creates are listed as cells to fix in Excel.
 *  6. One misspelt supplier name is listed cell by cell; associating it to a catalogue supplier or creating it
 *     does not reach every cell, or does not compute the preview again.
 *  7. A corrections file filled in Excel cannot be read back.
 *  8. After the import of the references, the screen no longer says which ones to verify.
 *  9. A cell set aside stays in the list, or cannot be taken back.
 */

const HEADERS = ["ID", "Caractéristique", "Matériau", "Unité", "PR. FO", "Type FO", "F1_nom", "F1_ref", "Type_ligne"];
const SHEET_ROWS = [
  HEADERS,
  ["TUBE-20", "Tube", "Inox 304L soudé", "ml", 12.5, "I4L", "Pt.P", "P-20", "Art"],
  ["COQ-25", "Coquille porteuse", "Kooltherm", null, null, "CAL", "pt.p", "P-25", "Art"],
];
const TUBE_TYPE = "a0000000-0000-4000-8000-000000000001";
const SUPPORT_TYPE = "a0000000-0000-4000-8000-000000000002";

function articleReport(overrides: Partial<CostingWorkbookImportReport> = {}): CostingWorkbookImportReport {
  return {
    confirmed: false,
    articles: 2,
    new_articles: 2,
    proposed_articles: [{ row: 2, without_supply_type: false }, { row: 3, without_supply_type: true }],
    supply_types: [{ id: SUPPORT_TYPE, code: "support", name: "Support" }, { id: TUBE_TYPE, code: "tube", name: "Tube" }],
    catalogue_differences: [],
    already_in_catalogue: 0,
    without_supply_type: 1,
    supplier_references_not_imported: 2,
    issues: [{ row: 3, reference: "COQ-25", message: "Unité absente : « u » retenue." }],
    issue_count: 1,
    sections: 0,
    ...overrides,
  };
}

function supplierReport(overrides: Partial<CostingWorkbookSupplierReferenceReport> = {}): CostingWorkbookSupplierReferenceReport {
  return {
    confirmed: false,
    to_import: 0,
    imported: 0,
    already_registered: 0,
    duplicates: 0,
    preview_token: "a".repeat(64),
    proposed: [],
    for_decision: [
      { row: 2, slot: 1, reason: "supplier_not_found", product_id: "90000000-0000-4000-8000-000000000001" },
      { row: 3, slot: 1, reason: "supplier_not_found", product_id: "90000000-0000-4000-8000-000000000002" },
    ],
    ...overrides,
  };
}

function xlsxFile(name: string, sheets: Record<string, unknown[][]>) {
  const book = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const bytes = XLSX.write(book, { bookType: name.endsWith(".xlsm") ? "xlsm" : "xlsx", type: "array" }) as ArrayBuffer;
  const file = new File([bytes], name);
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(bytes) });
  return file;
}
const costingWorkbook = (rows: unknown[][] = SHEET_ROWS) => xlsxFile("bible-chiffrage.xlsm", { Sommaire: [["Bible"]], All_data: rows });

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

type Sent = { url: string; method: string; body: { rows?: unknown[][]; confirm?: boolean; [key: string]: unknown } | null };
const sent: Sent[] = [];
/** What each route answers; a test replaces an entry to change the next answers. */
const answers = {
  articles: () => respond(200, { ok: true, data: articleReport() }),
  suppliers: () => respond(200, { ok: true, data: supplierReport() }),
  directory: [
    { id: "s1", name: "Point P Matériaux" },
    { id: "s2", name: "Rexel" },
  ],
};
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Sent["body"] : null;
  sent.push({ url, method, body });
  if (url === "/api/suppliers") {
    return method === "GET"
      ? respond(200, { ok: true, data: { items: answers.directory } })
      : respond(201, { ok: true, data: { item: { id: "s9", name: (body as { item: { name: string } }).item.name } } });
  }
  return url.endsWith("/supplier-references") ? answers.suppliers() : answers.articles();
});

const previews = (path = "/api/catalogue/workbook-import") => sent.filter((call) => call.url === path && call.method === "POST");
const supplierPreviews = () => previews("/api/catalogue/workbook-import/supplier-references");

function renderImport() {
  return render(
    <CostingWorkbookImport
      catalogueHref="/dashboard/products"
      draftsHref="/dashboard/products?catalogue_status=draft"
      onImported={vi.fn()}
    />,
  );
}

const fileInput = () => screen.getByLabelText("Fichier Excel") as HTMLInputElement;
const view = (name: string) => screen.getByRole("button", { name, pressed: false });

async function openSupplierReferences(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(fileInput(), costingWorkbook());
  await screen.findByRole("table", { name: "Articles proposés en brouillon" });
  await user.click(screen.getByRole("tab", { name: "Références fournisseur" }));
  await waitFor(() => expect(supplierPreviews()).toHaveLength(1));
}

describe("CostingWorkbookImport, corrections in the screen", () => {
  beforeEach(() => {
    sent.length = 0;
    answers.articles = () => respond(200, { ok: true, data: articleReport() });
    answers.suppliers = () => respond(200, { ok: true, data: supplierReport() });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the same file again, and computes the preview again without choosing it (1)", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(fileInput(), costingWorkbook());
    await screen.findByRole("table", { name: "Articles proposés en brouillon" });
    expect(fileInput().files).toHaveLength(1);
    expect(screen.getByText("bible-chiffrage.xlsm · 3 lignes lues dans l’onglet « All_data »")).toBeVisible();

    // Opening the file dialog empties the field: the same path chosen again is a new choice for the browser.
    await user.click(screen.getByRole("button", { name: "Changer de fichier Excel" }));
    expect(fileInput().files).toHaveLength(0);
    // A dialog closed without a choice keeps the workbook in hand.
    expect(screen.getByRole("table", { name: "Articles proposés en brouillon" })).toBeVisible();
    await user.upload(fileInput(), costingWorkbook());
    await waitFor(() => expect(previews()).toHaveLength(2));

    await user.click(screen.getByRole("button", { name: "Actualiser l’aperçu" }));
    await waitFor(() => expect(previews()).toHaveLength(3));
    expect(previews().map((call) => call.body?.confirm)).toEqual([false, false, false]);
    expect(previews()[2].body?.rows).toEqual(previews()[0].body?.rows);
  });

  it("previews and imports the corrected cell, lists it with the file's value, and undoes it (2)", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(fileInput(), costingWorkbook());
    const table = await screen.findByRole("table", { name: "Articles proposés en brouillon" });
    expect(within(table).getByText("sans prix")).toBeVisible();

    await user.click(within(table).getByRole("button", { name: "Corriger la cellule E3" }));
    await user.type(screen.getByLabelText("Nouvelle valeur de la cellule E3"), "9,90{Enter}");
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[2]?.[4]).toBe("9,90");
    // The sheet read from the file is untouched: another cell of the same row keeps its value.
    expect(previews()[1].body?.rows?.[2]?.[0]).toBe("COQ-25");

    const journal = await screen.findByRole("region", { name: "Corrections appliquées à l’aperçu" });
    expect(within(journal).getByText("1 correction appliquée à l’aperçu.")).toBeVisible();
    await user.click(within(journal).getByRole("button", { name: "Voir" }));
    expect(within(journal).getByRole("listitem")).toHaveTextContent("E3 · PR. FO : vide → 9,90");

    await user.click(await screen.findByRole("button", { name: "Importer 2 brouillons" }));
    await waitFor(() => expect(previews()).toHaveLength(3));
    expect(previews()[2].body).toMatchObject({ confirm: true });
    expect(previews()[2].body?.rows?.[2]?.[4]).toBe("9,90");
  });

  it("undoes a correction from the journal (2)", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(fileInput(), costingWorkbook());
    const table = await screen.findByRole("table", { name: "Articles proposés en brouillon" });
    await user.click(within(table).getByRole("button", { name: "Corriger la cellule D3" }));
    await user.type(screen.getByLabelText("Nouvelle valeur de la cellule D3"), "ml{Enter}");
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[2]?.[3]).toBe("ml");

    const journal = await screen.findByRole("region", { name: "Corrections appliquées à l’aperçu" });
    await user.click(within(journal).getByRole("button", { name: "Tout annuler" }));
    await waitFor(() => expect(previews()).toHaveLength(3));
    expect(previews()[2].body?.rows).toEqual(previews()[0].body?.rows);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Corrections appliquées à l’aperçu" })).not.toBeInTheDocument());
  });

  it("lets the office point a renamed required column to its header (3)", async () => {
    const user = userEvent.setup();
    const renamed = [["Réf", ...HEADERS.slice(1)], ...SHEET_ROWS.slice(1)];
    answers.articles = () => (previews().length === 1
      ? respond(422, { ok: false, error: { code: "COSTING_WORKBOOK_FORMAT", message: "Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « All_data ») : ID manquantes." } })
      : respond(200, { ok: true, data: articleReport() }));
    renderImport();
    await user.upload(fileInput(), costingWorkbook(renamed));

    expect(await screen.findByText(/ID manquantes\./)).toBeVisible();
    const missing = within(screen.getByRole("list", { name: "Colonnes absentes du classeur" }));
    expect(missing.getByText("obligatoire")).toBeVisible();
    await user.selectOptions(missing.getByLabelText("En-tête du classeur à lire comme ID"), "A · Réf");

    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[0]?.[0]).toBe("ID");
    expect(await screen.findByRole("table", { name: "Articles proposés en brouillon" })).toBeVisible();
    await user.click(within(screen.getByRole("region", { name: "Corrections appliquées à l’aperçu" })).getByRole("button", { name: "Voir" }));
    expect(screen.getByRole("list", { name: "Corrections" })).toHaveTextContent("A1 : Réf → ID");
  });

  it("gives a family the supply type chosen in the screen, in the preview and in the import (4)", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(fileInput(), costingWorkbook());
    await screen.findByRole("table", { name: "Articles proposés en brouillon" });
    expect(screen.getByText("À choisir")).toBeVisible();

    await user.click(view("Types de fourniture"));
    const types = within(screen.getByRole("table", { name: "Types de fourniture proposés" }));
    expect(types.getByLabelText("Tube")).toHaveDisplayValue("Tube (même code)");
    await user.selectOptions(types.getByLabelText("Calorifuge"), "Support");
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body).toMatchObject({ confirm: false, supply_types: { calorifuge: SUPPORT_TYPE } });
    expect(previews()[0].body).not.toHaveProperty("supply_types");

    await user.click(await screen.findByRole("button", { name: "Importer 2 brouillons" }));
    await waitFor(() => expect(previews()).toHaveLength(3));
    expect(previews()[2].body).toMatchObject({ confirm: true, supply_types: { calorifuge: SUPPORT_TYPE } });
  });

  it("sends the references of articles to create to the draft import, not to Excel (5)", async () => {
    const user = userEvent.setup();
    answers.suppliers = () => respond(200, { ok: true, data: supplierReport({
      for_decision: [{ row: 2, slot: 1, reason: "article_to_create" }, { row: 3, slot: 1, reason: "article_to_create" }],
    }) });
    renderImport();
    await openSupplierReferences(user);

    expect(await screen.findByRole("heading", { name: "2 références attendent 2 articles à créer" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Toutes à examiner" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Articles à créer d’abord" })).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Voir les articles à importer" }));
    expect(await screen.findByRole("table", { name: "Articles proposés en brouillon" })).toBeVisible();
    // The draft preview was already there: no new request for it.
    expect(previews()).toHaveLength(1);
  });

  it("resolves one supplier name for all its cells, by association or by creating the supplier (6)", async () => {
    const user = userEvent.setup();
    renderImport();
    await openSupplierReferences(user);

    await user.click(await screen.findByRole("button", { name: "Fournisseur actif introuvable" }));
    expect(screen.getByText("1 fournisseur distinct")).toBeVisible();
    await user.click(await screen.findByRole("button", { name: "Associer Pt.P à Point P Matériaux" }));
    await waitFor(() => expect(supplierPreviews()).toHaveLength(2));
    const corrected = supplierPreviews()[1].body?.rows;
    expect([corrected?.[1]?.[6], corrected?.[2]?.[6]]).toEqual(["Point P Matériaux", "Point P Matériaux"]);
    expect(await screen.findByText("2 corrections appliquées à l’aperçu.")).toBeVisible();

    await user.click(await screen.findByRole("button", { name: "Créer le fournisseur Point P Matériaux" }));
    await waitFor(() => expect(supplierPreviews()).toHaveLength(3));
    expect(sent.find((call) => call.url === "/api/suppliers" && call.method === "POST")?.body)
      .toEqual({ action: "create", item: { name: "Point P Matériaux", is_active: true } });
    expect(supplierPreviews()[2].body?.rows).toEqual(corrected);
  });

  it("reads a filled corrections file back, and says what it left out (7)", async () => {
    const user = userEvent.setup();
    renderImport();
    await user.upload(fileInput(), costingWorkbook());
    await screen.findByRole("table", { name: "Articles proposés en brouillon" });

    const corrections = xlsxFile("corrections.xlsx", { Corrections: [
      ["Motif", "Cellule à vérifier", "Valeur d’origine", "Correction à renseigner"],
      ["Fournisseur actif introuvable", "G2", "Pt.P", "Point P Matériaux"],
      ["Fournisseur actif introuvable", "G3", "Autre nom", "Point P Matériaux"],
      ["Article actif introuvable", "A2", "TUBE-20", ""],
    ] });
    await user.upload(screen.getByLabelText("Fichier de corrections"), corrections);

    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[1]?.[6]).toBe("Point P Matériaux");
    expect(previews()[1].body?.rows?.[2]?.[6]).toBe("pt.p");
    expect(await screen.findByText(
      "1 correction lue dans corrections.xlsx ; 1 écartée : sa cellule ne contient plus la valeur d’origine.",
    )).toBeVisible();
  });

  it("keeps the list of the references it imported, to verify them (8)", async () => {
    const user = userEvent.setup();
    const proposed = [{ row: 2, slot: 1, article_reference: "TUBE-20", supplier_name: "Point P Matériaux", product_id: "90000000-0000-4000-8000-000000000001" }];
    answers.suppliers = () => respond(200, { ok: true, data: supplierPreviews().at(-1)?.body?.confirm
      ? supplierReport({ confirmed: true, imported: 1, preview_token: null, proposed, for_decision: [] })
      : supplierReport({ to_import: 1, proposed, for_decision: [] }) });
    renderImport();
    await openSupplierReferences(user);

    await user.click(await screen.findByRole("button", { name: "Importer 1 référence" }));
    expect(await screen.findByText("1 référence importée, à vérifier.")).toBeVisible();
    expect(supplierPreviews()[1].body).toMatchObject({ confirm: true, preview_token: "a".repeat(64) });
    const imported = within(await screen.findByRole("table", { name: "Références importées" }));
    expect(imported.getByText("TUBE-20")).toBeVisible();
    expect(imported.getByRole("link", { name: "Vérifier sur la fiche" }))
      .toHaveAttribute("href", "/dashboard/products?product_id=90000000-0000-4000-8000-000000000001");
  });

  it("computes the references again after the drafts they waited for are imported (5)", async () => {
    const user = userEvent.setup();
    const waiting = supplierReport({ for_decision: [{ row: 2, slot: 1, reason: "article_to_create" }] });
    const proposed = [{ row: 2, slot: 1, article_reference: "TUBE-20", supplier_name: "Pt.P", product_id: "90000000-0000-4000-8000-000000000001" }];
    answers.suppliers = () => respond(200, { ok: true, data: supplierPreviews().length === 1
      ? waiting : supplierReport({ to_import: 1, proposed, for_decision: [] }) });
    answers.articles = () => respond(200, { ok: true, data: previews().at(-1)?.body?.confirm
      ? articleReport({ confirmed: true, proposed_articles: undefined, supply_types: undefined, catalogue_differences: undefined })
      : articleReport() });
    renderImport();
    await openSupplierReferences(user);
    await user.click(await screen.findByRole("button", { name: "Voir les articles à importer" }));

    await user.click(await screen.findByRole("button", { name: "Importer 2 brouillons" }));
    expect(await screen.findByText("Import terminé : 2 brouillons créés.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Reprendre leurs références fournisseur" }));

    await waitFor(() => expect(supplierPreviews()).toHaveLength(2));
    expect(supplierPreviews()[1].body).toMatchObject({ confirm: false });
    expect(await screen.findByRole("button", { name: "Importer 1 référence" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Articles à créer d’abord" })).not.toBeInTheDocument();
  });

  it("sets a cell aside and takes it back (9)", async () => {
    const user = userEvent.setup();
    renderImport();
    await openSupplierReferences(user);

    const decisions = await screen.findByRole("table", { name: "2 références à examiner" });
    await user.click(within(decisions).getByRole("button", { name: "Ignorer la référence de la ligne 2, fournisseur 1" }));
    expect(await screen.findByRole("table", { name: "1 référence à examiner" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Afficher 1 référence ignorée" }));
    const all = await screen.findByRole("table", { name: "2 références à examiner" });
    await user.click(within(all).getByRole("button", { name: "Reprendre la référence de la ligne 2, fournisseur 1" }));
    expect(screen.queryByRole("button", { name: /référence ignorée/ })).not.toBeInTheDocument();
    // Nothing was asked of the server: setting aside changes neither the sheet nor the import.
    expect(supplierPreviews()).toHaveLength(1);
  });
});
