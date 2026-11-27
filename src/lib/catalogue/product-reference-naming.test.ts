import { describe, expect, it } from "vitest";

import { productReferenceConflicts } from "./product-reference-identity";
import {
  DEFAULT_PRODUCT_REFERENCE_PATTERNS, REFERENCE_ABBREVIATION_TERMS, REFERENCE_NAMING_EXAMPLES,
  UNSAVED_PRODUCT_REFERENCE_NAMING, compactReferenceAbbreviations, explainProductReference,
  productReferenceNamingSchema, proposeProductReference, storedProductReferenceNamingSchema,
  type ProductReferenceNaming,
} from "./product-reference-naming";

const ENABLED: ProductReferenceNaming = { enabled: true, patterns: DEFAULT_PRODUCT_REFERENCE_PATTERNS };
const withTube = (tube: string) => ({ ...ENABLED, patterns: { ...DEFAULT_PRODUCT_REFERENCE_PATTERNS, tube } });

// Failure modes: a reference shortened by a missing characteristic reads as another article; a company that
// saved nothing receives references it never asked for; two words share one code and two articles one reference;
// a format starts with digits a spreadsheet would strip.
describe("company product reference naming", () => {
  it("builds a readable reference per family from the article's characteristics", () => {
    expect(proposeProductReference(ENABLED, REFERENCE_NAMING_EXAMPLES.tube)).toBe("TUB-316L-DN50-SD-E2");
    expect(proposeProductReference(ENABLED, REFERENCE_NAMING_EXAMPLES.coude)).toBe("COU-90-316L-DN50-SD");
    expect(proposeProductReference(ENABLED, REFERENCE_NAMING_EXAMPLES.reduction)).toBe("RED-304L-DN50X40-SD");
    expect(proposeProductReference(ENABLED, REFERENCE_NAMING_EXAMPLES.vanne)).toBe("VAN-EQ-FF-DN50-PN25");
  });

  it("gives no reference to a company that saved no naming, nor when its naming is switched off", () => {
    expect(UNSAVED_PRODUCT_REFERENCE_NAMING.enabled).toBe(false);
    expect(proposeProductReference(UNSAVED_PRODUCT_REFERENCE_NAMING, REFERENCE_NAMING_EXAMPLES.tube)).toBeNull();
    expect(explainProductReference({ ...ENABLED, enabled: false }, REFERENCE_NAMING_EXAMPLES.tube))
      .toEqual({ family: "tube", reference: null, missing: [] });
  });

  it("follows the format the company chose", () => {
    const configured = productReferenceNamingSchema.parse(withTube("TUY-{dimension}-{matiere}"));
    expect(proposeProductReference(configured, REFERENCE_NAMING_EXAMPLES.tube)).toBe("TUY-DN50-316L");
  });

  it("names what a sheet lacks instead of shortening its reference", () => {
    // Without its thickness this tube would read TUB-316L-DN50-SD, the reference of every DN50 tube.
    expect(explainProductReference(ENABLED, { designation: "Tube Inox 316L soudé", material: "Inox 316L soudé", dimensions: "DN50" }))
      .toEqual({ family: "tube", reference: null, missing: ["epaisseur"] });
    expect(explainProductReference(ENABLED, { designation: "Tube" }))
      .toEqual({ family: "tube", reference: null, missing: ["matiere", "dimension", "epaisseur"] });
    expect(explainProductReference(ENABLED, { designation: "Coude inox 316L soudé", dimensions: "DN50" }).missing).toEqual(["angle"]);
    expect(explainProductReference(ENABLED, { designation: "Vanne papillon", dimensions: "DN50" }).missing).toEqual(["pression"]);
    // A reduction names both of its ends.
    expect(explainProductReference(ENABLED, { designation: "Réduction inox 304L soudée", dimensions: "DN50" }).missing).toEqual(["dimension"]);
  });

  it("does not read an angle in a temperature, nor a diameter in a length", () => {
    expect(explainProductReference(ENABLED, { designation: "Coude inox DN50 120°C" }))
      .toEqual({ family: "coude", reference: null, missing: ["angle"] });
    expect(explainProductReference(ENABLED, { designation: "Coude inox 316L soudé DN50 120 °C 90°" }).reference)
      .toBe("COU-90-316L-DN50-SD");
    expect(explainProductReference(withTube("TUB-{dimension}"), { designation: "Tube longueur 3000 mm" }))
      .toEqual({ family: "tube", reference: null, missing: ["dimension"] });
    // A size written as one in the designation is read, and the dimensions field is read as given.
    expect(proposeProductReference(withTube("TUB-{dimension}"), { designation: "Tube inox DN50 longueur 3000 mm" })).toBe("TUB-DN50");
    expect(proposeProductReference(withTube("TUB-{dimension}"), { designation: "Tube cuivre Ø28" })).toBe("TUB-D28");
    expect(proposeProductReference(withTube("TUB-{dimension}"), { designation: "Tube longueur 3000 mm", dimensions: "DN40" })).toBe("TUB-DN40");
  });

  it("keeps the decimal point of a measure and nothing else outside letters, digits and dashes", () => {
    expect(proposeProductReference(ENABLED, { designation: "Tube multicouche", material: "Multicouche", dimensions: "16x2,5" }))
      .toBe("TUB-MULTICOUCHE-D16-E2.5");
    expect(proposeProductReference(ENABLED, { designation: "Tube Inox 316L soudé", dimensions: "DN50 — 60,3x2,6" }))
      .toBe("TUB-316L-DN50-SD-E2.6");
    expect(proposeProductReference(ENABLED, { designation: "Vanne papillon PN 2,5", dimensions: "DN50" })).toBe("VAN-PAP-DN50-PN2.5");
    for (const article of [REFERENCE_NAMING_EXAMPLES.tube, REFERENCE_NAMING_EXAMPLES.coude, REFERENCE_NAMING_EXAMPLES.reduction, REFERENCE_NAMING_EXAMPLES.vanne]) {
      expect(proposeProductReference(ENABLED, article)).toMatch(/^[A-Z0-9]+(?:[.-][A-Z0-9]+)*$/);
    }
  });

  it("keeps applying a format saved before the prefix rule, which holds from the next save", () => {
    const legacy = withTube("{dimension}-TUB");
    expect(productReferenceNamingSchema.safeParse(legacy).success).toBe(false);
    const stored = storedProductReferenceNamingSchema.parse(legacy);
    expect(proposeProductReference(stored, { designation: "Tube inox", dimensions: "DN50" })).toBe("DN50-TUB");
    // Still not anything: a stored value no save could have written is refused.
    expect(storedProductReferenceNamingSchema.safeParse(withTube("TUB-{prix}-{dimension}")).success).toBe(false);
    expect(storedProductReferenceNamingSchema.safeParse(withTube("{dimension}")).success).toBe(false);
    expect(storedProductReferenceNamingSchema.safeParse({ ...legacy, abbreviations: { multicouche: "mec" } }).success).toBe(false);
  });

  it("asks only for what the company's format names", () => {
    expect(proposeProductReference(withTube("TUB-{matiere}-{dimension}"), { designation: "Tube Inox 316L", dimensions: "DN50" }))
      .toBe("TUB-316L-DN50");
  });

  it("keeps a reference for an article without a variant: a qualifier some articles do not have", () => {
    expect(proposeProductReference(ENABLED, { designation: "Tube multicouche", material: "Multicouche", dimensions: "16x2" }))
      .toBe("TUB-MULTICOUCHE-D16-E2");
  });

  it("keeps the automatic number for an article of no family with a format", () => {
    expect(explainProductReference(ENABLED, { designation: "Collier isophonique", dimensions: "DN50" }))
      .toEqual({ family: null, reference: null, missing: [] });
  });

  it("writes the abbreviations the company chose", () => {
    const shortened = productReferenceNamingSchema.parse({
      ...ENABLED, abbreviations: { multicouche: "MEC", soude: "S", equilibrage: "EQL", ff: "F" },
    });
    expect(proposeProductReference(shortened, { designation: "Tube multicouche", material: "Multicouche", dimensions: "16x2" }))
      .toBe("TUB-MEC-D16-E2");
    // A grade is a designation of its own: it is written as it is, whatever the material's abbreviation.
    expect(proposeProductReference({ ...shortened, abbreviations: { ...shortened.abbreviations, inox: "IX" } }, REFERENCE_NAMING_EXAMPLES.tube))
      .toBe("TUB-316L-DN50-S-E2");
    expect(proposeProductReference(shortened, REFERENCE_NAMING_EXAMPLES.vanne)).toBe("VAN-EQL-F-DN50-PN25");
    expect(proposeProductReference({ ...ENABLED, abbreviations: { inox: "IX" } }, { designation: "Tube inox soudé", dimensions: "DN50 — 60,3x2" }))
      .toBe("TUB-IX-DN50-SD-E2");
  });

  it("refuses an abbreviation that is not a short upper-case code, or a term it does not know", () => {
    for (const abbreviations of [{ multicouche: "mec" }, { multicouche: "ME-C" }, { multicouche: "" }, { multicouche: "A".repeat(17) }, { galva: "GAL" }]) {
      expect(productReferenceNamingSchema.safeParse({ ...ENABLED, abbreviations }).success).toBe(false);
    }
  });

  it("refuses two terms of one group under the same abbreviation, chosen or default", () => {
    const sameChosen = productReferenceNamingSchema.safeParse({ ...ENABLED, abbreviations: { per: "PE", pehd: "PE" } });
    expect(sameChosen.success).toBe(false);
    expect(sameChosen.error?.issues[0]?.message).toContain("même abréviation PE");
    // « PVC » is the default code of PVC.
    expect(productReferenceNamingSchema.safeParse({ ...ENABLED, abbreviations: { ppr: "PVC" } }).success).toBe(false);
    // The same code in two groups names a material and a connection: each has its own place in the reference.
    expect(productReferenceNamingSchema.safeParse({ ...ENABLED, abbreviations: { per: "X", soude: "X" } }).success).toBe(true);
  });

  it("stores only the abbreviations that differ from the default codes", () => {
    expect(compactReferenceAbbreviations({ multicouche: "MEC", soude: "SD" })).toEqual({ multicouche: "MEC" });
    expect(compactReferenceAbbreviations({ soude: "SD" })).toBeUndefined();
    expect(compactReferenceAbbreviations(undefined)).toBeUndefined();
  });

  it("gives every term a default code the database accepts, unique in its group", () => {
    for (const term of REFERENCE_ABBREVIATION_TERMS) {
      expect(term.key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
      expect(term.code).toMatch(/^[A-Z0-9]{1,16}$/);
    }
    expect(productReferenceNamingSchema.safeParse({ ...ENABLED, abbreviations: {} }).success).toBe(true);
  });

  it("requires a format to start with a prefix that begins with a letter, and to name the dimension", () => {
    for (const tube of ["{dimension}-TUB", "001-{dimension}", "1TUB-{dimension}", "tub-{dimension}", "TUB-{matiere}", "TUB-{prix}-{dimension}", "TUB {dimension}"]) {
      expect(productReferenceNamingSchema.safeParse(withTube(tube)).success, tube).toBe(false);
    }
    for (const tube of ["TUB-{dimension}", "T1-{dimension}-316", "TUB-{matiere}-{dimension}-{variante}-{epaisseur}"]) {
      expect(productReferenceNamingSchema.safeParse(withTube(tube)).success, tube).toBe(true);
    }
    expect(productReferenceNamingSchema.safeParse({ ...ENABLED, prefixes: {} }).success).toBe(false);
  });

  it("gives no reference longer than a reference field holds", () => {
    const long = withTube(`TUB-${Array.from({ length: 4 }, () => "ABCDEFGHIJKLMNOP").join("-")}-{dimension}-{matiere}`);
    expect(productReferenceNamingSchema.safeParse(long).success).toBe(true);
    expect(explainProductReference(long, REFERENCE_NAMING_EXAMPLES.tube)).toEqual({ family: "tube", reference: null, missing: [] });
  });

  it("reads equivalent DN spellings as one article and names what tells two articles apart", () => {
    const known = REFERENCE_NAMING_EXAMPLES.tube;
    expect(productReferenceConflicts(known, { ...known, dimensions: "DN 50" })).toEqual([]);
    expect(productReferenceConflicts(known, { ...known, material: "Inox 304L serti", dimensions: "DN65 — 76,1x3" }))
      .toEqual(expect.arrayContaining(["Dimensions", "Nuance", "Raccordement", "Épaisseur"]));
  });
});
