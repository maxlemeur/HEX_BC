import { describe, expect, it } from "vitest";

import { materialRequestLineInputSchema, MATERIAL_REQUEST_MAX_LINES } from "./contracts";
import {
  buildMaterialRequestPhotoPrompt,
  draftsFromPhotoAnswer,
  materialRequestPhotoAnswerSchema,
} from "./photo-analysis";

/**
 * Failure modes, written before the code. The answers are fictional, in the shapes a vision model really
 * gives them:
 *  1. one loose value refuses the whole photo: a size or a quantity given as a number where text was asked
 *     (or the reverse), a key left out, a key the schema does not know;
 *  2. a draft is refused by the API contract when the lines are added (a text over its length, a quantity of
 *     zero, negative, with more than three decimals or out of bounds), so nothing of the photo is created;
 *  3. a quantity the model could not use is silently replaced by another one, or a rounded one is not flagged
 *     for a look at the original;
 *  4. the technician's words are lost: `original_text` is not what the model read for the article;
 *  5. « [illisible] » or « ? » is written into a column as if it were a size or a material;
 *  6. an entry that names nothing becomes an empty line, or an article the model read without its words is
 *     dropped;
 *  7. the pre-reading decides: it validates, sets a supplier, an imputation or « sans dimension »;
 *  8. a photo turned on screen is read lying down: the prompt does not say how it is turned;
 *  9. a character the database refuses (a control character, half of an emoji left by a cut) reaches a line: the
 *     insert fails and the whole batch is lost;
 * 10. « 0.500 » kg is read as five hundred.
 */

function drafts(lignes: unknown[]) {
  return draftsFromPhotoAnswer(materialRequestPhotoAnswerSchema.parse({ lignes }));
}

const FULL = {
  texte: "12 coudes 90° cuivre Ø22 à sertir réf DEMO-CU22",
  quantite: 12,
  quantite_douteuse: false,
  unite: "pièces",
  dimension: "Ø 22",
  type: "coude 90°",
  matiere: "cuivre",
  precision: "à sertir",
  reference: "DEMO-CU22",
  zone: "R+3",
};

describe("draftsFromPhotoAnswer", () => {
  it("rewrites an article into the columns of a line, with the technician's words beside them", () => {
    expect(drafts([FULL])).toEqual([
      {
        original_text: "12 coudes 90° cuivre Ø22 à sertir réf DEMO-CU22",
        quantity: 12,
        unit: "u",
        dimension: "Ø 22",
        product_type: "coude 90°",
        material: "cuivre",
        material_precision: "à sertir",
        reference: "DEMO-CU22",
        zone: "R+3",
      },
    ]);
  });

  it("accepts loose values: numbers for text, text for numbers, keys left out or unknown", () => {
    expect(
      drafts([
        { texte: "tube 32 x 48 ml", quantite: "48", unite: "ML", dimension: 32, type: "tube", commentaire: "ignoré" },
        { texte: "2,5 m de gaine", quantite: "2,5", unite: "m", type: "gaine" },
      ]),
    ).toEqual([
      { original_text: "tube 32 x 48 ml", quantity: 48, unit: "ml", dimension: "32", product_type: "tube" },
      { original_text: "2,5 m de gaine", quantity: 2.5, unit: "ml", product_type: "gaine" },
    ]);
  });

  it("keeps an unknown unit as written and leaves a missing one empty", () => {
    expect(drafts([
      { texte: "3 rouleaux de filasse", quantite: 3, unite: " Rouleaux ", type: "filasse" },
      { texte: "tube cuivre 22", quantite: 6, unite: null, type: "tube" },
    ])).toEqual([
      { original_text: "3 rouleaux de filasse", quantity: 3, unit: "rouleaux", product_type: "filasse" },
      { original_text: "tube cuivre 22", quantity: 6, product_type: "tube" },
    ]);
  });

  it.each<[string, unknown]>([
    ["zero", 0],
    ["negative", -4],
    ["out of bounds", 2_000_000],
    ["not a number", "une dizaine"],
    ["not finite", "1e999"],
  ])("leaves a %s quantity unread instead of inventing one", (_label, quantite) => {
    expect(drafts([{ texte: "colliers", quantite, type: "collier" }])).toEqual([
      { original_text: "colliers", product_type: "collier" },
    ]);
  });

  it("flags a doubtful quantity, and one it had to round to three decimals", () => {
    expect(drafts([
      { texte: "7 vannes", quantite: 7, quantite_douteuse: true, type: "vanne" },
      { texte: "1,23456 kg", quantite: 1.23456, unite: "kg", type: "pâte à joint" },
      { texte: "1 000 vis", quantite: "1 000", type: "vis" },
    ])).toEqual([
      { original_text: "7 vannes", quantity: 7, quantity_doubtful: true, product_type: "vanne" },
      { original_text: "1,23456 kg", quantity: 1.235, quantity_doubtful: true, unit: "kg", product_type: "pâte à joint" },
      { original_text: "1 000 vis", quantity: 1000, quantity_doubtful: true, product_type: "vis" },
    ]);
  });

  it("does not write what the model could not read into a column", () => {
    expect(drafts([
      { texte: "5 [illisible] DN ?", quantite: 5, dimension: "?", type: "[illisible]", matiere: "Illisible", reference: " " },
    ])).toEqual([{ original_text: "5 [illisible] DN ?", quantity: 5 }]);
  });

  it("drops an entry that names nothing and keeps an article read without its words", () => {
    expect(drafts([
      { texte: "  ", quantite: null, type: null },
      { texte: null, quantite: 4, type: "bride", dimension: "DN 50" },
    ])).toEqual([{ quantity: 4, dimension: "DN 50", product_type: "bride" }]);
  });

  it("returns only drafts the API contract accepts, whatever the lengths", () => {
    const long = "x".repeat(900);
    const read = drafts([
      { texte: long, quantite: 3, unite: long, dimension: long, type: long, matiere: long, precision: long, reference: long, zone: long },
    ]);
    expect(read).toHaveLength(1);
    expect(materialRequestLineInputSchema.safeParse(read[0]).success).toBe(true);
    expect(read[0].original_text).toHaveLength(500);
    expect(read[0].product_type).toHaveLength(200);
  });

  it("writes no character the database refuses, and never cuts inside one", () => {
    const [draft] = drafts([
      { texte: `collier\u0000 inox\u0007\n2e ligne. ${"😀".repeat(300)}`, type: `collier \ud83d`, matiere: "inox\u0000 316L" },
    ]);
    // 23 characters, then emoji of two code units each: the bound of 500 falls inside one, which is left out whole.
    expect(draft.original_text).toMatch(/^collier inox 2e ligne\. (?:😀)+$/u);
    expect(draft.original_text).toHaveLength(499);
    expect(draft).toMatchObject({ product_type: "collier", material: "inox 316L" });
    expect(JSON.stringify(draft)).not.toMatch(/\\u0000|\\ud83d(?!\\ude00)/);
  });

  it("reads « 0.500 » as half a unit, not as five hundred", () => {
    expect(drafts([{ texte: "0.500 kg de pâte", quantite: "0.500", unite: "kg", type: "pâte à joint" }])).toEqual([
      { original_text: "0.500 kg de pâte", quantity: 0.5, unit: "kg", product_type: "pâte à joint" },
    ]);
  });

  it("decides nothing: no status, supplier, imputation or « sans dimension »", () => {
    const [draft] = drafts([{ ...FULL, statut: "validated", fournisseur: "Négoce fictif", no_dimension: true, imputation: "overhead" }]);
    expect(Object.keys(draft).sort()).toEqual(
      ["dimension", "material", "material_precision", "original_text", "product_type", "quantity", "reference", "unit", "zone"],
    );
  });

  it("stops at the line cap of a request", () => {
    const many = Array.from({ length: MATERIAL_REQUEST_MAX_LINES + 20 }, (_, index) => ({ texte: `article ${index}`, type: "article" }));
    expect(drafts(many)).toHaveLength(MATERIAL_REQUEST_MAX_LINES);
  });

  it("refuses an answer that is not a list of articles", () => {
    expect(materialRequestPhotoAnswerSchema.safeParse({ lignes: "aucune" }).success).toBe(false);
    expect(materialRequestPhotoAnswerSchema.safeParse({}).success).toBe(false);
  });
});

describe("buildMaterialRequestPhotoPrompt", () => {
  it("says how a photo turned on screen is read upright, and nothing for one that is not", () => {
    expect(buildMaterialRequestPhotoPrompt({ rotation: 0 })).not.toMatch(/tourne/i);
    expect(buildMaterialRequestPhotoPrompt({ rotation: 90 })).toMatch(/quart de tour dans le sens des aiguilles/);
    expect(buildMaterialRequestPhotoPrompt({ rotation: 180 })).toMatch(/demi-tour/);
    expect(buildMaterialRequestPhotoPrompt({ rotation: 270 })).toMatch(/quart de tour dans le sens inverse/);
  });
});
