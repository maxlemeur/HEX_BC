import { describe, expect, it } from "vitest";

import { matchLine, prepareCatalogue, type MatchArticle, type MatchRequestLine } from "./matching";

/**
 * Failure modes, written before the code (TI-690, delivery 3). Every article is invented, in the shape of
 * a plumbing price base (type, material, size, unit, supplier references).
 *  1. a reference written by the technician (spaces, case, a supplier's reference rather than ours) does not
 *     find its article; or it is trusted although the line describes another piece, without a warning;
 *  2. a usual name the office has already taught (« goujon » for a threaded rod) is outranked by loose words;
 *  3. the same piece in another size, or another material, is proposed: DN 20 for DN 25, copper for
 *     stainless, 304L for 316L;
 *  4. « inox » alone excludes the stainless grades of the catalogue instead of keeping them all;
 *  5. a technician's abbreviation (« T » for té, « red » for réduction) finds nothing;
 *  6. a vague match is ranked above an exact one (same type, material and size);
 *  7. unrelated pieces are proposed just to fill the list, or the list grows without limit;
 *  8. a draft article is proposed without saying so, or ahead of an equal validated one;
 *  9. an article sold in another unit is proposed without saying so;
 * 10. (measured on a real price base) a 45° elbow is ranked level with a 90° one: the angle is a number
 *     and was dropped with the other numbers;
 * 11. a one-letter typo of the technician (« colier ») finds nothing;
 * 12. an article whose size sits in its designation (« Double écrou M10 x 35 mm », dimension « pour
 *     profil … ») is proposed for an M12 line.
 * 13. (review of delivery 3) a usual name proposes an article of a size or a material the line never gave,
 *     without a warning: the screen's bulk link takes it, and the line's missing-dimension alert vanishes;
 * 14. several articles behind one reference, or one usual name taught on several articles, come out as
 *     several unwarned first-tier proposals: the bulk link picks one of them blindly;
 * 15. a search by hand cannot reach another size, material or angle, so the office creates a duplicate
 *     article; or, when it can, that article is not flagged or is ranked above the matching ones.
 * 16. (Codex review of PR #263) the line's precision (« 316L ») is never read: an « Inox » article of grade
 *     304L comes out as the same material, unwarned through a usual name, and the bulk link writes 304L;
 * 17. a reference that names another material or another angle than the line's comes out without a
 *     warning (only another size was warned), so the bulk link takes it;
 * 18. a usual name proposes an article whose size cannot be compared with the line's, without a warning;
 * 19. (Codex review of PR #263) a unit outside the shared referential (« barres ») is never compared, so an
 *     article sold in « ml » comes out without a warning and the bulk link takes it;
 * 20. (Codex review of PR #263) a precision with a grade and a pressure class (« 316L PN16 ») agrees with a
 *     304L PN16 article because one word (PN16) is shared: the grade conflict is hidden.
 */

let next = 0;
function article(partial: Partial<MatchArticle>): MatchArticle {
  next += 1;
  return {
    id: partial.id ?? `article-${next}`,
    reference: null,
    designation: partial.product_type ?? "Article",
    product_type: null,
    material: null,
    grade: null,
    dimensions: null,
    standard: null,
    unit: "u",
    catalogue_status: "validated",
    supplier_skus: [],
    aliases: [],
    ...partial,
  };
}

function line(partial: Partial<MatchRequestLine>): MatchRequestLine {
  return { reference: null, product_type: null, material: null, material_precision: null, dimension: null, unit: "u", ...partial };
}

const CATALOGUE = [
  article({ id: "te-304se-32", product_type: "Té droit", material: "Inox 304L serti", dimensions: "DN32", reference: "ART-000101", supplier_skus: ["TEP 16L 35 C"] }),
  article({ id: "te-316se-32", product_type: "Té droit", material: "Inox 316L serti", dimensions: "DN32" }),
  article({ id: "te-304se-25", product_type: "Té droit", material: "Inox 304L serti", dimensions: "DN25" }),
  article({ id: "te-cu-32", product_type: "Té égal", material: "Cuivre", dimensions: "Ø35" }),
  article({ id: "ter-304se-32", product_type: "Té réduit", material: "Inox 304L serti", dimensions: "DN32>25" }),
  article({ id: "coude45-304se-20", product_type: "Coude 45°", material: "Inox 304L serti", dimensions: "DN20" }),
  article({ id: "coude90-304se-20", product_type: "Coude 90°", material: "Inox 304L serti", dimensions: "DN20" }),
  article({ id: "collier-20", product_type: "Collier isophonique", material: "Collier", dimensions: "DN20" }),
  article({ id: "double-ecrou-m10", product_type: "Double écrou M10 x 35 mm", material: "Supportage", dimensions: "pour profil 38/24" }),
  article({ id: "red-galva-32", product_type: "Réduction", material: "Acier galvanisé T10", dimensions: "DN32>25" }),
  article({ id: "tige-m10", product_type: "Tige filetée zinguée", material: "Supportage", dimensions: "M10", unit: "u", aliases: ["goujon"] }),
  article({ id: "cheville-m10", product_type: "Cheville mécanique", material: "Supportage", dimensions: "M10", supplier_skus: ["471205"] }),
  article({ id: "vanne-15", product_type: "Vanne d'arrêt", material: "Robinetterie", dimensions: "DN15" }),
  article({ id: "tube-304se-20", product_type: "Tube", material: "Inox 304L serti", dimensions: "DN20", unit: "ml" }),
];
const prepared = prepareCatalogue(CATALOGUE);
const ids = (candidates: ReturnType<typeof matchLine>) => candidates.map((candidate) => candidate.product_id);

describe("matchLine", () => {
  it.each([
    ["our reference", "art-000101"],
    ["a supplier reference written loosely", "tep16l35c"],
  ])("finds the article from %s first", (_label, reference) => {
    const [first] = matchLine(line({ reference }), prepared);
    expect(first).toMatchObject({ product_id: "te-304se-32", via: "reference", warnings: [] });
  });

  it("warns when the reference names another piece than the line describes, and keeps it first", () => {
    const [first] = matchLine(line({ reference: "471205", product_type: "cheville", dimension: "M12" }), prepared);
    expect(first.product_id).toBe("cheville-m10");
    expect(first.warnings).toEqual(["La référence désigne une autre dimension (M10) que la ligne (M12) : vérifiez."]);
  });

  it("puts a usual name the office has taught first", () => {
    const [first] = matchLine(line({ product_type: "goujon", dimension: "M10" }), prepared);
    expect(first).toMatchObject({ product_id: "tige-m10", via: "alias" });
  });

  it("never proposes the same piece in another size", () => {
    expect(ids(matchLine(line({ product_type: "té", material: "Inox 304L serti", dimension: "DN 25" }), prepared)))
      .not.toContain("te-304se-32");
  });

  it("reads the size the technician's way: Ø 35 in press-fit stainless is DN 32", () => {
    const candidates = matchLine(line({ product_type: "té", material: "Inox 304L serti", dimension: "Ø 35" }), prepared);
    expect(candidates[0].product_id).toBe("te-304se-32");
    expect(candidates[0].reasons).toContain("Même dimension (DN 32)");
  });

  it("never proposes another material, nor another stainless grade", () => {
    const stainless = ids(matchLine(line({ product_type: "té", material: "Inox 316L serti", dimension: "DN32" }), prepared));
    expect(stainless).toContain("te-316se-32");
    expect(stainless).not.toContain("te-304se-32");
    expect(stainless).not.toContain("te-cu-32");
  });

  it("keeps every stainless grade for « inox » alone, and drops copper", () => {
    const candidates = ids(matchLine(line({ product_type: "té", material: "inox", dimension: "DN32" }), prepared));
    expect(candidates).toEqual(expect.arrayContaining(["te-304se-32", "te-316se-32"]));
    expect(candidates).not.toContain("te-cu-32");
  });

  it("understands the technician's abbreviations", () => {
    expect(ids(matchLine(line({ product_type: "T", material: "Inox 304L serti", dimension: "DN32" }), prepared))[0])
      .toBe("te-304se-32");
    expect(ids(matchLine(line({ product_type: "red", material: "Acier galvanisé T10", dimension: "32-25" }), prepared))[0])
      .toBe("red-galva-32");
  });

  it("ranks the exact piece above a looser one", () => {
    const candidates = ids(matchLine(line({ product_type: "té droit", material: "Inox 304L serti", dimension: "DN32" }), prepared));
    expect(candidates[0]).toBe("te-304se-32");
    expect(candidates.indexOf("ter-304se-32")).toBeGreaterThan(0);
  });

  it("keeps the angle of an elbow: 45° never ranks a 90° first, nor level", () => {
    const candidates = matchLine(line({ product_type: "coude 45°", dimension: "20" }), prepared);
    expect(ids(candidates)).toContain("coude45-304se-20");
    expect(ids(candidates)).not.toContain("coude90-304se-20");
  });

  it("forgives a one-letter typo in a long word", () => {
    expect(ids(matchLine(line({ product_type: "colier", dimension: "DN 20" }), prepared))[0]).toBe("collier-20");
  });

  it("reads the size of an article in its designation when its size column holds none", () => {
    expect(ids(matchLine(line({ product_type: "double écrou", dimension: "M12" }), prepared))).not.toContain("double-ecrou-m10");
    expect(ids(matchLine(line({ product_type: "double écrou", dimension: "M10" }), prepared))[0]).toBe("double-ecrou-m10");
  });

  it("proposes nothing for a piece the catalogue does not hold", () => {
    expect(matchLine(line({ product_type: "disque à tronçonner", dimension: "Ø 125" }), prepared)).toEqual([]);
  });

  it("proposes at most five articles, or the limit a search by hand asks for", () => {
    const many = prepareCatalogue(
      Array.from({ length: 12 }, (_, index) => article({ product_type: "Collier", material: "Supportage", dimensions: `DN${15 + index}` })),
    );
    expect(matchLine(line({ product_type: "collier" }), many).length).toBe(5);
    expect(matchLine(line({ product_type: "collier" }), many, { limit: 10 }).length).toBe(10);
  });

  it("says when an article is a draft, and ranks it after an equal validated one", () => {
    const pair = prepareCatalogue([
      article({ id: "draft", product_type: "Manchon", material: "Cuivre", dimensions: "Ø22", catalogue_status: "draft" }),
      article({ id: "validated", product_type: "Manchon", material: "Cuivre", dimensions: "Ø22" }),
    ]);
    const candidates = matchLine(line({ product_type: "manchon", material: "cuivre", dimension: "22" }), pair);
    expect(ids(candidates)).toEqual(["validated", "draft"]);
    expect(candidates[1].warnings).toContain("Article en brouillon : à valider dans le catalogue.");
  });

  it("says when the article is sold in another unit", () => {
    const [first] = matchLine(line({ product_type: "tube", material: "Inox 304L serti", dimension: "DN 20", unit: "u" }), prepared);
    expect(first.product_id).toBe("tube-304se-20");
    expect(first.warnings).toContain("Unité de l’article : ml (ligne : u).");
  });

  it("warns when a usual name proposes a size or a material the line does not give", () => {
    const [bare] = matchLine(line({ product_type: "goujon" }), prepared);
    expect(bare).toMatchObject({ product_id: "tige-m10", via: "alias" });
    expect(bare.warnings).toEqual([
      "La ligne ne donne pas de dimension ; l’article est en M10 : vérifiez.",
      "La ligne ne donne pas de matière ; l’article est en Supportage : vérifiez.",
    ]);
    const [described] = matchLine(line({ product_type: "goujon", dimension: "M10", material: "supportage" }), prepared);
    expect(described).toMatchObject({ product_id: "tige-m10", via: "alias", warnings: [] });
  });

  it("warns every article behind one reference, and every article behind one usual name", () => {
    const shared = prepareCatalogue([
      article({ id: "vanne-a", product_type: "Vanne à boisseau", material: "Laiton", dimensions: "DN15", supplier_skus: ["VB-15"], aliases: ["quart de tour"] }),
      article({ id: "vanne-b", product_type: "Vanne à boisseau papillon", material: "Laiton", dimensions: "DN15", supplier_skus: ["VB 15"], aliases: ["quart de tour"] }),
      article({ id: "vanne-c", product_type: "Vanne à boisseau", material: "Laiton", dimensions: "DN20", supplier_skus: ["VB-20"] }),
    ]);
    const byReference = matchLine(line({ reference: "vb15", product_type: "vanne", material: "laiton", dimension: "DN15" }), shared);
    expect(ids(byReference).slice(0, 2).sort()).toEqual(["vanne-a", "vanne-b"]);
    for (const candidate of byReference.filter((entry) => entry.via === "reference")) {
      expect(candidate.warnings).toContain("Plusieurs articles portent cette référence : choisissez.");
    }
    const byAlias = matchLine(line({ product_type: "quart de tour", material: "laiton", dimension: "DN15" }), shared);
    expect(byAlias.filter((entry) => entry.via === "alias").map((entry) => entry.warnings)).toEqual([
      ["Plusieurs articles portent ce nom usuel : choisissez."],
      ["Plusieurs articles portent ce nom usuel : choisissez."],
    ]);
    const [alone] = matchLine(line({ reference: "VB-20", product_type: "vanne", material: "laiton", dimension: "DN20" }), shared);
    expect(alone).toMatchObject({ product_id: "vanne-c", via: "reference", warnings: [] });
  });

  it("a search by hand reaches another size, material or angle, flagged and ranked after the matching ones", () => {
    const search = line({ product_type: "té droit", material: "Inox 304L serti", dimension: "DN32" });
    expect(ids(matchLine(search, prepared))).not.toContain("te-304se-25");
    const byHand = matchLine(search, prepared, { byHand: true, limit: 10 });
    const matching = ids(byHand).indexOf("te-304se-32");
    const otherSize = byHand.find((candidate) => candidate.product_id === "te-304se-25");
    const otherMaterial = byHand.find((candidate) => candidate.product_id === "te-316se-32");
    expect(matching).toBe(0);
    expect(otherSize?.warnings).toContain("Autre dimension (DN 25) que la ligne (DN 32).");
    expect(otherMaterial?.warnings).toContain("Autre matière (Inox 316L serti) que la ligne (Inox 304L serti).");
    expect(ids(byHand).indexOf("te-304se-25")).toBeGreaterThan(matching);
    expect(ids(byHand).indexOf("te-316se-32")).toBeGreaterThan(matching);

    const elbow = matchLine(line({ product_type: "coude 45°", dimension: "DN20" }), prepared, { byHand: true });
    expect(ids(elbow)[0]).toBe("coude45-304se-20");
    expect(elbow.find((candidate) => candidate.product_id === "coude90-304se-20")?.warnings)
      .toContain("Autre angle (90°) que la ligne (45°).");
  });

  it("reads the line's precision against the article's grade and standard", () => {
    const grades = prepareCatalogue([
      article({ id: "te-304", product_type: "Té", material: "Inox", grade: "304L", dimensions: "DN32", aliases: ["t inox"] }),
      article({ id: "te-316", product_type: "Té", material: "Inox", grade: "316L", dimensions: "DN32" }),
      article({ id: "te-nograde", product_type: "Té", material: "Inox", dimensions: "DN32", aliases: ["te sans nuance"] }),
    ]);
    const ranked = matchLine(line({ product_type: "té", material: "Inox", material_precision: "316L", dimension: "DN32" }), grades);
    expect(ids(ranked)).toEqual(["te-316", "te-nograde"]);
    const byAlias = matchLine(line({ product_type: "t inox", material: "Inox", material_precision: "316L", dimension: "DN32" }), grades);
    expect(ids(byAlias)).not.toContain("te-304");
    const unknown = matchLine(line({ product_type: "te sans nuance", material: "Inox", material_precision: "316L", dimension: "DN32" }), grades);
    expect(unknown[0].via).toBe("alias");
    expect(unknown[0].warnings).toContain("La ligne précise « 316L » ; l’article n’en dit rien : vérifiez.");
    const byHand = matchLine(line({ product_type: "té", material: "Inox", material_precision: "316L", dimension: "DN32" }), grades, { byHand: true });
    expect(byHand.find((candidate) => candidate.product_id === "te-304")?.warnings).toContain("Autre nuance (304L) que la ligne (316L).");
  });

  it("warns when the reference names another material or another angle than the line's", () => {
    const refs = prepareCatalogue([
      article({ id: "coude90-inox", product_type: "Coude 90°", material: "Inox 304L serti", dimensions: "DN20", reference: "CD-90-20" }),
    ]);
    const [candidate] = matchLine(line({ product_type: "coude 45°", material: "Cuivre", dimension: "DN20", reference: "CD-90-20" }), refs);
    expect(candidate.via).toBe("reference");
    expect(candidate.warnings).toEqual([
      "La référence désigne une autre matière (Inox 304L serti) que la ligne (Cuivre) : vérifiez.",
      "La référence désigne un autre angle (90°) que la ligne (45°) : vérifiez.",
    ]);
  });

  it("warns when a usual name brings a size that cannot be compared with the line's", () => {
    const odOnly = prepareCatalogue([article({ id: "manchon-pvc", product_type: "Manchon", material: "PVC", dimensions: "DN32", aliases: ["manchon colle"] })]);
    const [candidate] = matchLine(line({ product_type: "manchon colle", material: "PVC", dimension: "32" }), odOnly);
    expect(candidate.via).toBe("alias");
    expect(candidate.warnings).toContain("Dimension de la ligne (Ø 32) et de l’article (DN 32) à rapprocher : vérifiez.");
  });

  it("compares written units when the referential does not know one of them", () => {
    const tubes = prepareCatalogue([article({ id: "tube-pvc-32", product_type: "Tube", material: "PVC", dimensions: "Ø32", unit: "ml", aliases: ["tube evac"] })]);
    const [candidate] = matchLine(line({ product_type: "tube evac", material: "PVC", dimension: "32", unit: "barres" }), tubes);
    expect(candidate.via).toBe("alias");
    expect(candidate.warnings).toContain("Unité de l’article : ml (ligne : barres).");
    const same = matchLine(line({ product_type: "tube evac", material: "PVC", dimension: "32", unit: "ML" }), tubes);
    expect(same[0].warnings).toEqual([]);
  });

  it("compares the grade and the pressure class or standard each on its own", () => {
    const grades = prepareCatalogue([
      article({ id: "vanne-304-pn16", product_type: "Vanne", material: "Inox", grade: "304L", standard: "PN16", dimensions: "DN32", aliases: ["vanne inox"] }),
      article({ id: "vanne-316-pn16", product_type: "Vanne", material: "Inox", grade: "316L", standard: "PN16", dimensions: "DN32" }),
      article({ id: "vanne-316-pn40", product_type: "Vanne", material: "Inox", grade: "316L", standard: "PN40", dimensions: "DN32" }),
      article({ id: "vanne-en", product_type: "Vanne", material: "Inox", standard: "EN 10217", dimensions: "DN32" }),
    ]);
    const asked = { material: "Inox", material_precision: "316L PN16", dimension: "DN32" };
    expect(ids(matchLine(line({ product_type: "vanne", ...asked }), grades))).toEqual(["vanne-316-pn16", "vanne-en"]);
    expect(ids(matchLine(line({ product_type: "vanne inox", ...asked }), grades))).not.toContain("vanne-304-pn16");
    const byHand = matchLine(line({ product_type: "vanne", ...asked }), grades, { byHand: true });
    expect(byHand.find((candidate) => candidate.product_id === "vanne-304-pn16")?.warnings).toContain("Autre nuance (304L PN16) que la ligne (316L PN16).");
  });
});
