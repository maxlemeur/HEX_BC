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
 * 14. (review) A price cell holding a number with more than two decimals, as a formula leaves it (12.345,
 *     3491.8000000000002), is reported unreadable and imported at 0 € instead of rounded to the cent as the
 *     application's other spreadsheet imports read a native number.
 * 15. (review) A price beyond what the catalogue's integer cents hold (2 147 483 647) is imported: the database
 *     refuses it, and with it the whole chunk of drafts at every run.
 * 16. (review) A reference longer than 255 characters is cut: two such references sharing their first 255
 *     characters then collide in the catalogue at every run.
 * 17. (review) The supply type, which sets the estimate's FO provision once the draft is validated (1,03 for
 *     tubes and insulation, 1,01 otherwise), is « divers » for a tube outside the material families or for an
 *     unclassified article whose material says insulation, support or valves; a tube of the insulation,
 *     support or valve families leaves its family; a fitting of a material family, or a consumable (a tube
 *     of sealant), is taken for a tube.
 * 18. (review) Two articles that differ only by their precision (two reduced tees 28x22x28 and 28x18x28)
 *     read the same designation, so the office cannot tell them apart in a request.
 * 19. (review) The type of article keeps the details written after a spaced hyphen (« Mise en place -
 *     élément »), or a hyphen inside a word (« T-Rex ») cuts it.
 * 20. (the browser sends an error cell as its displayed text) A spreadsheet error value (« #N/A », « #REF! »,
 *     « #VALEUR! »…) becomes a reference, a designation, a material, a size, a unit or a family; an error in a
 *     secondary column is dropped without a word; a reference or a precision that merely starts with « # » is
 *     taken for an error.
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
      // The precision closes the designation (18).
      ["Bouchon mâle", "Bouchon mâle – fonte malléable à visser — Acier noir T3 DN15 (1/2\")", "DN15 — 1/2\"", "EN 10242"],
      ["Té réduit", "Té réduit — Inox 304L serti DN25 (28x22x28)", "DN25 — 28x22x28", null],
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

  it("rounds a native price to the cent as the other spreadsheet imports do, and still refuses text with three decimals (14)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Tube", "PR. FO": 12.345 }),
      article({ "ID": "A.2", "Caractéristique": "Tube", "PR. FO": 3491.8000000000002 }),
      article({ "ID": "A.3", "Caractéristique": "Tube", "PR. FO": 5.43984 }),
      article({ "ID": "A.4", "Caractéristique": "Tube", "PR. FO": 5.44 }),
      article({ "ID": "A.5", "Caractéristique": "Tube", "PR. FO": 12.344999 }),
      article({ "ID": "A.6", "Caractéristique": "Tube", "PR. FO": "12,345" }),
    );
    expect(result.articles.map((entry) => entry.unit_price_cents)).toEqual([1235, 349180, 544, 544, 1234, 0]);
    expect(result.issues).toEqual([{ row: 7, reference: "A.6", message: "Prix « 12,345 » illisible : article importé sans prix." }]);
  });

  it("reports a price beyond the catalogue's integer cents as unreadable (15)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Tube", "PR. FO": 21474836.47 }),
      article({ "ID": "A.2", "Caractéristique": "Tube", "PR. FO": 21474836.48 }),
      article({ "ID": "A.3", "Caractéristique": "Tube", "PR. FO": "30 000 000,00" }),
    );
    expect(result.articles.map((entry) => entry.unit_price_cents)).toEqual([2147483647, 0, 0]);
    expect(result.issues).toEqual([
      { row: 3, reference: "A.2", message: "Prix « 21474836.48 » illisible : article importé sans prix." },
      { row: 4, reference: "A.3", message: "Prix « 30 000 000,00 » illisible : article importé sans prix." },
    ]);
  });

  it("refuses a reference longer than 255 characters instead of cutting it (16)", () => {
    const longest = `R${"x".repeat(254)}`;
    const result = read(
      article({ "ID": longest, "Caractéristique": "Tube" }),
      article({ "ID": `${longest}1`, "Caractéristique": "Tube" }),
      article({ "ID": `${longest}2`, "Caractéristique": "Tube" }),
    );
    expect(result.articles.map((entry) => entry.reference)).toEqual([longest]);
    expect(result.issues).toEqual([
      { row: 3, reference: `${longest}1`, message: "Référence de plus de 255 caractères : ignorée." },
      { row: 4, reference: `${longest}2`, message: "Référence de plus de 255 caractères : ignorée." },
    ]);
  });

  it.each([
    // A tube is a tube whatever its family, but for the insulation, support and valve families.
    ["XYZ", "Inox 304L", "Tube", "tube", "Tuyauterie"],
    ["", "PVC", "Tuyaux d'évacuation", "tube", "Tuyauterie"],
    ["", "Acier noir", "Tubes", "tube", "Tuyauterie"],
    ["XYZ", "Cuivre", "Tuyau recuit", "tube", "Tuyauterie"],
    ["CAL", "Kooltherm", "Tube isolant", "calorifuge", "Autres"],
    ["SUP", "Supportage", "Tube de suspension", "support", "Autres"],
    ["ROB", "Robinetterie", "Tuyau flexible", "robinetterie", "Robinetterie"],
    // No family the reader knows: the material says it.
    ["", "Calorifuge", "Coquille", "calorifuge", "Autres"],
    ["", "Isolant", "Plaque", "calorifuge", "Autres"],
    ["XYZ", "Armaflex AF", "Manchon", "calorifuge", "Autres"],
    ["", "Laine de roche Rockwool", "Matelas", "calorifuge", "Autres"],
    ["", "Kooltherm", "Coquille porteuse", "calorifuge", "Autres"],
    ["", "Supportage", "Rail de montage", "support", "Autres"],
    ["XYZ", "Collier isophonique", "Collier", "support", "Autres"],
    ["", "Robinetterie", "Vanne à boisseau sphérique", "vanne", "Robinetterie"],
    ["", "Robinetterie", "Clapet anti-retour", "robinetterie", "Robinetterie"],
    // Counterexamples: a fitting of a material family stays a fitting; an unclassified fitting stays « divers »;
    // a tube of sealant is a consumable, not piping.
    ["I4L", "Inox 304L soudé", "Coude 90°", "raccord", "Raccords"],
    ["", "Inox 304L soudé", "Coude 90°", "divers", "Autres"],
    ["CONS", "Consommables", "Tube de silicone", "divers", "Consommables"],
  ])("reads the supply type of a %s « %s » article « %s » as %s (17)", (family, material, wording, kind, category) => {
    const [entry] = read(article({ "ID": "A.1", "Type FO": family, "Matériau": material, "Caractéristique": wording })).articles;
    expect([entry.supply_type_code, entry.category]).toEqual([kind, category]);
  });

  it("closes the designation with the precision when it does not already say it, within 500 characters (18)", () => {
    const result = read(
      article({ "ID": "TéR.1", "Matériau": "Inox 304L serti", "Dimension": "DN25", "Caractéristique": "Té réduit", "Précision": "28x22x28" }),
      article({ "ID": "TéR.2", "Matériau": "Inox 304L serti", "Dimension": "DN25", "Caractéristique": "Té réduit", "Précision": "28x18x28" }),
      article({ "ID": "Mam.1", "Matériau": "Laiton", "Caractéristique": "Mamelon 1/2\"", "Précision": "1/2\"" }),
      article({ "ID": "Long.1", "Matériau": "Divers", "Caractéristique": "L".repeat(495), "Précision": "28x22x28" }),
    );
    expect(result.articles.slice(0, 3).map((entry) => entry.designation)).toEqual([
      "Té réduit — Inox 304L serti DN25 (28x22x28)",
      "Té réduit — Inox 304L serti DN25 (28x18x28)",
      "Mamelon 1/2\" — Laiton",
    ]);
    expect(result.articles[3].designation).toHaveLength(500);
  });

  it("cuts the type of article at a spaced hyphen, never inside a word (19)", () => {
    const result = read(
      article({ "ID": "A.1", "Caractéristique": "Mise en place - élément de support" }),
      article({ "ID": "A.2", "Caractéristique": "T-Rex fictif" }),
      article({ "ID": "A.3", "Caractéristique": "Coude 90° – fonte" }),
    );
    expect(result.articles.map((entry) => entry.product_type)).toEqual(["Mise en place", "T-Rex fictif", "Coude 90°"]);
  });

  it("refuses a row whose reference or wording is a spreadsheet error, and ignores an error in the other columns (20)", () => {
    const result = read(
      article({ "ID": "#N/A", "Caractéristique": "Tube" }),
      article({ "ID": "#REF!", "Caractéristique": "Tube" }),
      article({ "ID": "A.3", "Caractéristique": "#VALEUR!" }),
      article({
        "ID": "A.4", "Caractéristique": "Coude 90°", "Matériau": "#N/A", "Dimension": "#DIV/0!", "Précision": "#nom?",
        "norme": "#NUL!", "Unité": "#REF!", "Type FO": "#ERREUR",
      }),
      // Counterexamples: text that merely starts with « # » is no error.
      article({ "ID": "#12", "Caractéristique": "Té #3", "Matériau": "N/A", "Précision": "#3", "Unité": "ml" }),
    );
    expect(result.articles.map((entry) => entry.reference)).toEqual(["A.4", "#12"]);
    const [cleaned, kept] = result.articles;
    expect(cleaned).toMatchObject({
      designation: "Coude 90°", material: null, dimensions: null, standard: null, unit: "u", family_code: null,
      supply_type_code: "divers",
    });
    // « #3 » is already in the wording: the precision is not repeated (18).
    expect(kept).toMatchObject({ designation: "Té #3 — N/A", material: "N/A", dimensions: "#3", unit: "ml" });
    expect(result.issues).toEqual([
      { row: 2, reference: null, message: "Référence en erreur dans le classeur (#N/A) : ignorée." },
      { row: 3, reference: null, message: "Référence en erreur dans le classeur (#REF!) : ignorée." },
      { row: 4, reference: "A.3", message: "Caractéristique en erreur dans le classeur (#VALEUR!) : ignorée." },
      {
        row: 5, reference: "A.4",
        message: "Cellule en erreur dans le classeur (Matériau : #N/A, Dimension : #DIV/0!, Précision : #nom?, norme : #NUL!, Unité : #REF!, Type FO : #ERREUR) : ignorée.",
      },
      { row: 5, reference: "A.4", message: "Unité absente : « u » retenue." },
    ]);
  });
});
