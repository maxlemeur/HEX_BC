import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { readCostingWorkbookRows } from "./costing-workbook";
import {
  COSTING_WORKBOOK_MAX_BODY_BYTES,
  COSTING_WORKBOOK_MAX_ROWS,
  costingWorkbookImportSchema,
} from "./costing-workbook-contract";
import {
  COSTING_WORKBOOK_MAX_CELLS,
  COSTING_WORKBOOK_MAX_TEXT,
  CostingWorkbookFileError,
  costingWorkbookImportBody,
  readCostingWorkbookFile,
} from "./costing-workbook-file";

/**
 * Failure modes, written before the code (TI-690, lot 1: the browser reads the costing workbook's « All_data »
 * sheet and sends its rows, as SheetJS gives them, to POST /api/catalogue/workbook-import). Every row is
 * invented.
 *  1. The rows of another sheet are sent (the first sheet, or a summary sheet), or a workbook without
 *     « All_data » is sent anyway instead of refused in one sentence naming the sheet.
 *  2. The rows no longer match the spreadsheet's rows: a blank row in the middle is dropped, or a sheet whose
 *     used range does not start at A1 shifts every row, so the issues the office reads name the wrong row.
 *  3. A sheet formatted far beyond its data (used range up to row 1 048 576 or column XFD) makes the browser
 *     build millions of empty cells, or sends thousands of empty rows the server refuses.
 *  4. More rows than the import accepts are sent anyway (the server answers with a 400 the office cannot read)
 *     instead of refused in a sentence before any request.
 *  5. A cell is sent that the contract does not carry (a string over 4 000 characters, a cell past the 60th
 *     column), so the server refuses the whole sheet.
 *  6. A file that is not a workbook (a PDF renamed .xlsx) crashes the dialog instead of a sentence.
 *  7. Rows heavier than the body the route reads are posted anyway and answered with a 413 the office cannot
 *     read, instead of refused in a sentence before any request.
 *  8. (found by review, after the first version) An error cell (#N/A, #REF!) or a formula saved without its value
 *     is sent as an empty cell: a price « #N/A » becomes a silent 0 € draft instead of a remark the office reads.
 *     An empty cell must stay empty.
 */

const HEADERS = [
  "Fiabilité (/10)", "ID", "Matériau", "Dimension", "Caractéristique", "Précision", "norme", "Qté", "Unité",
  "PR. FO", "Type FO", "K FO", "h MO", "Type MO", "K MO", "Commentaire", "h / \"", "soudure (\")",
  "F1_nom", "F1_prix", "F1_ref", "F1_URL", "F2_nom", "F2_prix", "F2_ref", "F2_URL",
  "F3_nom", "F3_prix", "F3_ref", "F3_URL", "Type_ligne",
];

type Cell = string | number | null;
function row(values: Record<string, Cell>): Cell[] {
  return HEADERS.map((header) => (header in values ? values[header] : null));
}

function workbook(sheets: Record<string, XLSX.WorkSheet>, bookType: XLSX.BookType = "xlsx"): ArrayBuffer {
  const book = XLSX.utils.book_new();
  for (const [name, sheet] of Object.entries(sheets)) XLSX.utils.book_append_sheet(book, sheet, name);
  return XLSX.write(book, { bookType, type: "array" }) as ArrayBuffer;
}

// `origin` places the rows away from A1, as a sheet whose used range starts lower down.
const sheet = (rows: unknown[][], origin?: string) =>
  origin ? XLSX.utils.sheet_add_aoa({}, rows, { origin }) : XLSX.utils.aoa_to_sheet(rows);

const TUBE = row({ "Type_ligne": "Art", "ID": "Tub.X4so.20", "Matériau": "Inox 304L soudé", "Caractéristique": "Tube", "Unité": "ml", "PR. FO": 12.5 });

describe("readCostingWorkbookFile", () => {
  it("reads the All_data sheet by its name from an .xlsm, never another sheet (1)", async () => {
    const rows = await readCostingWorkbookFile(workbook({
      Sommaire: sheet([["Bible de chiffrage", "ne pas envoyer"]]),
      All_data: sheet([HEADERS, TUBE]),
    }, "xlsm"));
    expect(rows).toEqual([HEADERS, TUBE.slice(0, HEADERS.length)]);
    expect(rows.flat()).not.toContain("ne pas envoyer");

    const renamed = await readCostingWorkbookFile(workbook({ Autre: sheet([["x"]]), ALL_DATA: sheet([HEADERS]) }));
    expect(renamed).toEqual([HEADERS]);
  });

  it("refuses in one sentence naming the sheet a workbook without it (1)", async () => {
    const read = readCostingWorkbookFile(workbook({ Feuil1: sheet([HEADERS, TUBE]) }));
    await expect(read).rejects.toBeInstanceOf(CostingWorkbookFileError);
    await expect(readCostingWorkbookFile(workbook({ Feuil1: sheet([HEADERS]) }))).rejects.toThrow(
      "Ce classeur n’a pas d’onglet « All_data ». Choisissez le classeur de chiffrage.",
    );
  });

  it("keeps the spreadsheet's row numbers: blank rows kept, a used range away from A1 counted from A1 (2)", async () => {
    // Header on sheet row 3 (column B onwards), a blank sheet row 5, an article without unit on sheet row 6.
    const noUnit = row({ "Type_ligne": "Art", "ID": "Rob.V.15", "Matériau": "Robinetterie", "Caractéristique": "Vanne", "Unité": "" });
    const rows = await readCostingWorkbookFile(workbook({
      All_data: sheet([HEADERS, TUBE, [], noUnit], "B3"),
    }));
    expect(rows.length).toBe(6);
    const result = readCostingWorkbookRows(rows);
    expect(result.articles.map((article) => [article.row, article.reference])).toEqual([[4, "Tub.X4so.20"], [6, "Rob.V.15"]]);
    expect(result.issues).toEqual([{ row: 6, reference: "Rob.V.15", message: "Unité absente : « u » retenue." }]);
  });

  it("reads only the cells that hold something in a sheet formatted far beyond its data (3)", async () => {
    // Excel keeps formatted empty cells in the sheet's dimension; SheetJS cannot write a whole-sheet range in a
    // test, so the dimension reaches column CZ and row 20 000, three times the rows the import accepts.
    const formatted = sheet([HEADERS, TUBE]);
    formatted.CZ20000 = { t: "z" };
    formatted["!ref"] = "A1:CZ20000";
    const rows = await readCostingWorkbookFile(workbook({ All_data: formatted }));
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual(HEADERS);
    expect(rows[1]).toEqual(TUBE.slice(0, TUBE.findLastIndex((value) => value !== null) + 1));
  });

  it("refuses more rows than the import accepts, in a sentence, and accepts the limit itself (4)", async () => {
    const articles = (count: number) => Array.from({ length: count }, (_, index) => [`A.${index}`, "Art"]);
    await expect(readCostingWorkbookFile(workbook({
      All_data: sheet([["ID", "Type_ligne"], ...articles(COSTING_WORKBOOK_MAX_ROWS)]),
    }))).rejects.toThrow(/^L’onglet « All_data » compte 6\s001 lignes : l’import en accepte 6\s000 au plus\.$/);
    const rows = await readCostingWorkbookFile(workbook({
      All_data: sheet([["ID", "Type_ligne"], ...articles(COSTING_WORKBOOK_MAX_ROWS - 1)]),
    }));
    expect(rows.length).toBe(COSTING_WORKBOOK_MAX_ROWS);
  });

  it("sends only what the contract carries: no over-long text, nothing past the 60th column (5)", async () => {
    const long = "x".repeat(COSTING_WORKBOOK_MAX_TEXT + 1000);
    const cells = sheet([["ID", "Caractéristique", "Actif", "Prix"], ["A.1", long, true, 5.44]]);
    cells[XLSX.utils.encode_cell({ r: 0, c: COSTING_WORKBOOK_MAX_CELLS + 9 })] = { t: "s", v: "colonne lointaine" };
    cells["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 1, c: COSTING_WORKBOOK_MAX_CELLS + 9 } });
    const rows = await readCostingWorkbookFile(workbook({ All_data: cells }));
    expect(rows).toEqual([["ID", "Caractéristique", "Actif", "Prix"], ["A.1", "x".repeat(COSTING_WORKBOOK_MAX_TEXT), true, 5.44]]);
    expect(costingWorkbookImportSchema.safeParse({ rows, confirm: false }).success).toBe(true);
    // The limits applied here are the contract's own: one cell or one character more is refused by the route.
    expect(costingWorkbookImportSchema.safeParse({ rows: [Array(COSTING_WORKBOOK_MAX_CELLS + 1).fill(null)], confirm: false }).success).toBe(false);
    expect(costingWorkbookImportSchema.safeParse({ rows: [["x".repeat(COSTING_WORKBOOK_MAX_TEXT + 1)]], confirm: false }).success).toBe(false);
    expect(costingWorkbookImportSchema.safeParse({ rows: [Array(COSTING_WORKBOOK_MAX_CELLS).fill("x".repeat(COSTING_WORKBOOK_MAX_TEXT))], confirm: false }).success).toBe(true);
  });

  it("sends an error cell or a formula without its value as text the reader reports, and an empty cell as empty (8)", async () => {
    const cells = sheet([
      ["ID", "Vide", "Erreur", "Référence", "Sans valeur", "Formule vide"],
      ["A.1", null, null, null, null, null],
    ]);
    cells.C2 = { t: "e", v: 0x2a }; // #N/A, its displayed text kept by the file
    cells.D2 = { t: "e", v: 0x17 }; // #REF!
    cells.E2 = { t: "z", f: "SUM(Z1:Z9)" }; // a formula saved without its value (Excel writes <c><f>…</f></c>)
    cells.F2 = { t: "s", v: "", f: "\"\"" }; // a formula whose value is an empty text: empty, not an error
    cells["!ref"] = "A1:F2";
    const rows = await readCostingWorkbookFile(workbook({ All_data: cells }));
    expect(rows).toEqual([
      ["ID", "Vide", "Erreur", "Référence", "Sans valeur", "Formule vide"],
      ["A.1", null, "#N/A", "#REF!", "#ERREUR", ""],
    ]);

    // Through the reader: the price « #N/A » is a remark, never a silent 0 €; an empty price stays « to fill ».
    const tube = (id: string) => row({ "Type_ligne": "Art", "ID": id, "Matériau": "Inox 304L soudé", "Caractéristique": "Tube", "Unité": "ml" });
    const tubes = sheet([HEADERS, tube("Tub.X4so.20"), tube("Tub.X4so.25")]);
    tubes[XLSX.utils.encode_cell({ r: 1, c: HEADERS.indexOf("PR. FO") })] = { t: "e", v: 0x2a };
    const priced = await readCostingWorkbookFile(workbook({ All_data: tubes }));
    const result = readCostingWorkbookRows(priced);
    expect(result.articles.map((article) => [article.reference, article.unit_price_cents])).toEqual([
      ["Tub.X4so.20", 0], ["Tub.X4so.25", 0],
    ]);
    expect(result.issues).toEqual([
      { row: 2, reference: "Tub.X4so.20", message: "Prix « #N/A » illisible : article importé sans prix." },
    ]);
  });

  it("builds the request body, and refuses in a sentence rows heavier than the route reads (7)", () => {
    const rows = [HEADERS, TUBE];
    expect(JSON.parse(costingWorkbookImportBody(rows, false))).toEqual({ rows, confirm: false });
    expect(JSON.parse(costingWorkbookImportBody(rows, true))).toEqual({ rows, confirm: true });
    const heavy = Array.from({ length: 20 }, () => Array(COSTING_WORKBOOK_MAX_CELLS).fill("é".repeat(COSTING_WORKBOOK_MAX_TEXT / 2)));
    expect(new TextEncoder().encode(JSON.stringify({ rows: heavy })).length).toBeGreaterThan(COSTING_WORKBOOK_MAX_BODY_BYTES);
    expect(() => costingWorkbookImportBody(heavy, false)).toThrow(CostingWorkbookFileError);
    expect(() => costingWorkbookImportBody(heavy, false)).toThrow(
      /^L’onglet « All_data » est trop lourd pour être envoyé \(4,6 Mo, 4 Mo au plus\)\.$/,
    );
  });

  it("says in a sentence that a file is not the workbook rather than failing (6)", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n");
    await expect(readCostingWorkbookFile(pdf.buffer as ArrayBuffer)).rejects.toBeInstanceOf(CostingWorkbookFileError);
    const empty = sheet([]);
    await expect(readCostingWorkbookFile(workbook({ All_data: empty }))).rejects.toThrow(
      "L’onglet « All_data » de ce classeur est vide.",
    );
  });
});
