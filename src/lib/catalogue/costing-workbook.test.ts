import { describe, expect, it } from "vitest";

import {
  CostingWorkbookFormatError,
  readCostingWorkbookRows,
  workbookReferenceKey,
} from "./costing-workbook";

/**
 * Failure modes, written before the code (TI-690, lot 1: the office's costing workbook becomes catalogue
 * drafts). Every row is invented, in the shape of the workbook's « All_data » sheet.
 *  1. A section row (« Rub ») or a row without reference or wording becomes an article.
 *  2. A sheet of another shape is read anyway (wrong columns become wrong fields) instead of refused in
 *     words; moved columns or an extra title row break the reading.
 *  3. The type of article keeps the details written after a dash (« Bouchon mâle – fonte malléable »), or a
 *     short wording loses its type.
 *  4. The designation, which becomes the text of a request line once linked, drops the material or the
 *     size, or repeats one already in the wording, or says « Divers ».
 *  5. The supply type, which sets the FO provision of an estimate line (1,03 for tubes and insulation), is
 *     guessed wrongly: a stainless tube read as a fitting, a valve as a fitting, a pipe collar as a fitting,
 *     insulation as anything but insulation; or an article the workbook does not classify gets a guess other
 *     than « divers ».
 *  6. A price in euros is read wrongly (5,44 € must be 544 cents), an empty price stops the row, or a
 *     negative or unreadable price is imported instead of reported.
 *  7. The reliability mark (0 to 10) is lost, invented when empty, or kept out of range.
 *  8. A unit written « U », « pc » or « pcs » is not the catalogue's « u »; an empty unit is not reported.
 *  9. Supplier references: a placeholder supplier (« 1 », « 2 ») or a reference without supplier is kept, a
 *     non-web address is kept as a link, the same reference is listed twice.
 * 10. The grade of a stainless material (« Inox 316L serti ») is not kept as the article's grade.
 * 11. The same reference twice in the workbook gives two articles.
 * 12. An article already in the catalogue under a prefixed reference (« DB_<sheet>__ID », from an earlier
 *     import) is not recognised as the same article.
 * 13. (measured on the real workbook) a placeholder « - » or « / » in the size columns is written into the
 *     article's dimensions.
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
function article(values: Record<string, Cell>): Cell[] {
  return row({ "Type_ligne": "Art", "Unité": "U", "Fiabilité (/10)": 1, ...values });
}
function read(...rows: Cell[][]) {
  return readCostingWorkbookRows([HEADERS, ...rows]);
}

describe("readCostingWorkbookRows", () => {
  it("reads articles only, and reports a row that cannot be one (1)", () => {
    const result = read(
      row({ "Type_ligne": "Rub", "Caractéristique": "Tuyauterie inox" }),
      article({ "ID": "Tub.X4so.20", "Matériau": "Inox 304L soudé", "Dimension": "DN20", "Caractéristique": "Tube" }),
      article({ "ID": "", "Caractéristique": "Coude sans référence" }),
      article({ "ID": "Cou.X.20", "Caractéristique": "" }),
    );
    expect(result.articles.map((entry) => entry.reference)).toEqual(["Tub.X4so.20"]);
    expect(result.sections).toBe(1);
    expect(result.issues).toEqual([
      { row: 4, reference: null, message: "Ligne sans référence (colonne ID) : ignorée." },
      { row: 5, reference: "Cou.X.20", message: "Ligne sans caractéristique : ignorée." },
    ]);
  });

  it("refuses in words a sheet that is not the costing workbook's, and finds moved columns (2)", () => {
    expect(() => readCostingWorkbookRows([["Référence", "Désignation", "Prix"], ["A", "B", 1]])).toThrow(CostingWorkbookFormatError);
    expect(() => readCostingWorkbookRows([["Référence", "Désignation", "Prix"]])).toThrow(
      "Ce fichier n’a pas les colonnes du classeur de chiffrage (onglet « All_data ») : ID, Caractéristique, Matériau, Type_ligne manquantes.",
    );
    const moved = [...HEADERS].reverse();
    const values = article({ "ID": "Tub.X4so.20", "Matériau": "Inox 304L soudé", "Dimension": "DN20", "Caractéristique": "Tube" });
    const result = readCostingWorkbookRows([["Bible de chiffrage"], moved, [...values].reverse()]);
    expect(result.articles.map((entry) => [entry.reference, entry.product_type])).toEqual([["Tub.X4so.20", "Tube"]]);
  });

  it("keeps the type of article before the details, and composes the designation without repeating itself (3, 4)", () => {
    const result = read(
      article({ "ID": "Bou.T3.15", "Matériau": "Acier noir T3", "Dimension": "DN15", "Caractéristique": "Bouchon mâle – fonte malléable à visser", "Précision": "1/2\"", "norme": "EN 10242" }),
      article({ "ID": "TéR.X4se.25x20", "Matériau": "Inox 304L serti", "Dimension": "DN25", "Caractéristique": "Té réduit", "Précision": "28x22x28" }),
      article({ "ID": "Cir.D.1", "Matériau": "Divers", "Caractéristique": "Circulateur double — Débit : 25 m3/h" }),
      article({ "ID": "Fil.X.50", "Matériau": "Robinetterie", "Dimension": "DN50", "Caractéristique": "Filtre à tamis DN50 – laiton" }),
    );
    expect(result.articles.map((entry) => [entry.product_type, entry.designation, entry.dimensions, entry.standard])).toEqual([
      ["Bouchon mâle", "Bouchon mâle – fonte malléable à visser — Acier noir T3 DN15", "DN15 — 1/2\"", "EN 10242"],
      ["Té réduit", "Té réduit — Inox 304L serti DN25", "DN25 — 28x22x28", null],
      ["Circulateur double", "Circulateur double — Débit : 25 m3/h", null, null],
      ["Filtre à tamis DN50", "Filtre à tamis DN50 – laiton", "DN50", null],
    ]);
    expect(result.articles.map((entry) => entry.material)).toEqual(["Acier noir T3", "Inox 304L serti", "Divers", "Robinetterie"]);
  });

  it.each([
    ["I4L", "Inox 304L soudé", "Tube", "tube", "Tuyauterie"],
    ["I6L", "Inox 316L serti", "Coude 90°", "raccord", "Raccords"],
    ["T10", "Acier galvanisé T10", "Bride plate à souder", "raccord", "Raccords"],
    ["SMU", "Fonte SMU", "Collier de raccordement", "support", "Autres"],
    ["ROB", "Robinetterie", "Vanne à boisseau sphérique", "vanne", "Robinetterie"],
    ["ROB", "Robinetterie", "Clapet anti-retour à brides", "robinetterie", "Robinetterie"],
    ["I4L", "Inox 304L soudé", "Vanne papillon", "vanne", "Robinetterie"],
    ["CAL", "Kooltherm", "Coquille porteuse", "calorifuge", "Autres"],
    ["SUP", "Supportage", "Rail de montage", "support", "Autres"],
    ["CONS", "Consommables", "Ruban téflon", "divers", "Consommables"],
    ["", "Divers", "Vase expansion à membrane", "divers", "Autres"],
    ["XYZ", "Divers", "Article inconnu", "divers", "Autres"],
  ])("reads the supply type of a %s « %s » article « %s » as %s (5)", (family, material, wording, kind, category) => {
    const [entry] = read(article({ "ID": "A.1", "Type FO": family, "Matériau": material, "Caractéristique": wording })).articles;
    expect([entry.supply_type_code, entry.category, entry.family_code]).toEqual([kind, category, family || null]);
  });

  it("reads prices in euros into cents, and reports one it cannot read (6)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Tube", "PR. FO": 5.44 }),
      article({ "ID": "A.2", "Caractéristique": "Tube", "PR. FO": "12,59" }),
      article({ "ID": "A.3", "Caractéristique": "Tube", "PR. FO": "" }),
      article({ "ID": "A.4", "Caractéristique": "Tube", "PR. FO": -3 }),
      article({ "ID": "A.5", "Caractéristique": "Tube", "PR. FO": "sur devis" }),
    );
    expect(result.articles.map((entry) => entry.unit_price_cents)).toEqual([544, 1259, 0, 0, 0]);
    expect(result.issues).toEqual([
      { row: 5, reference: "A.4", message: "Prix « -3 » illisible : article importé sans prix." },
      { row: 6, reference: "A.5", message: "Prix « sur devis » illisible : article importé sans prix." },
    ]);
  });

  it("keeps the reliability mark, never invents one (7)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Tube", "Fiabilité (/10)": 9 }),
      article({ "ID": "A.2", "Caractéristique": "Tube", "Fiabilité (/10)": "10" }),
      article({ "ID": "A.3", "Caractéristique": "Tube", "Fiabilité (/10)": null }),
      article({ "ID": "A.4", "Caractéristique": "Tube", "Fiabilité (/10)": 12 }),
    );
    expect(result.articles.map((entry) => entry.reliability_score)).toEqual([9, 10, null, null]);
    expect(result.issues).toEqual([{ row: 5, reference: "A.4", message: "Fiabilité « 12 » hors de 0 à 10 : ignorée." }]);
  });

  it("writes the catalogue's units, and reports an empty one (8)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Tube", "Unité": "U" }),
      article({ "ID": "A.2", "Caractéristique": "Tube", "Unité": "pc" }),
      article({ "ID": "A.3", "Caractéristique": "Tube", "Unité": "ml" }),
      article({ "ID": "A.4", "Caractéristique": "Tube", "Unité": "Rl." }),
      article({ "ID": "A.5", "Caractéristique": "Tube", "Unité": "" }),
    );
    expect(result.articles.map((entry) => entry.unit)).toEqual(["u", "u", "ml", "Rl.", "u"]);
    expect(result.issues).toEqual([{ row: 6, reference: "A.5", message: "Unité absente : « u » retenue." }]);
  });

  it("keeps real supplier references once, with a web link only (9)", () => {
    const [entry] = read(article({
      "ID": "A.1", "Caractéristique": "Tube",
      "F1_nom": "Fournisseur Alpha", "F1_ref": "015053", "F1_URL": "https://fournisseur.example/015053",
      "F2_nom": "1", "F2_ref": "XX-1",
      "F3_nom": "Fournisseur Alpha", "F3_ref": " 015053 ", "F3_URL": "\\\\serveur\\devis.pdf",
    }), article({ "ID": "A.2", "Caractéristique": "Tube", "F1_nom": "", "F1_ref": "ORPHAN" })).articles;
    expect(entry.supplier_references).toEqual([
      { supplier_name: "Fournisseur Alpha", supplier_sku: "015053", product_url: "https://fournisseur.example/015053" },
    ]);
  });

  it("keeps the grade of a stainless material (10)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Té", "Matériau": "Inox 316L serti" }),
      article({ "ID": "A.2", "Caractéristique": "Té", "Matériau": "Acier noir T3" }),
    );
    expect(result.articles.map((entry) => entry.grade)).toEqual(["316L", null]);
  });

  it("imports a reference once, and reports the repeat (11)", () => {
    const result = read(
      article({ "ID": "Tub.X.20", "Caractéristique": "Tube" }),
      article({ "ID": "tub.x.20", "Caractéristique": "Tube bis" }),
    );
    expect(result.articles.map((entry) => entry.designation)).toEqual(["Tube"]);
    expect(result.issues).toEqual([{ row: 3, reference: "tub.x.20", message: "Référence déjà lue ligne 2 : ignorée." }]);
  });

  it("recognises an article already in the catalogue under a prefixed reference (12)", () => {
    expect(workbookReferenceKey("DB_I4Lsoude__Tub.I4S.50")).toBe(workbookReferenceKey("Tub.I4S.50"));
    expect(workbookReferenceKey(" tub.i4s.50 ")).toBe("tub.i4s.50");
    expect(workbookReferenceKey("Tub.I4S.50")).not.toBe(workbookReferenceKey("Tub.I4S.65"));
  });

  it("drops the placeholders of the size columns (13)", () => {
    const [entry] = read(article({ "ID": "A.1", "Caractéristique": "Mise en place", "Dimension": "-", "Précision": "/" })).articles;
    expect(entry.dimensions).toBeNull();
    expect(entry.designation).toBe("Mise en place");
  });
});
