import { describe, expect, it } from "vitest";

import { createSupplyTypeSchema, matchSupplyTypeByName, supplyTypeCodeFromName, supplyTypeNameKey } from "./supply-types";

/**
 * Failure modes, written before the code (TI-690):
 *  1. two names that differ only by case, accents, spacing or punctuation get two codes, so the
 *     tenant ends up with "Tube inox" and "tube  inox" as distinct supply types;
 *  2. a name made only of punctuation yields an empty code;
 *  3. a blank name, or one longer than the form allows, is accepted.
 * Duplicate names ("Tubes" beside "Tube") are refused by the database, under a lock: see the pgTAP file
 * product-catalogue-status.test.sql.
 */

describe("supplyTypeCodeFromName", () => {
  it.each([
    ["Tube inox", "tube_inox"],
    ["  tube   INOX ", "tube_inox"],
    ["Tubé-inox.", "tube_inox"],
    ["Calorifuge", "calorifuge"],
    ["Inox 304L serti", "inox_304l_serti"],
    ["Supportage / fixation", "supportage_fixation"],
    ["É.P.I.", "e_p_i"],
  ])("derives the code of %s", (name, code) => {
    expect(supplyTypeCodeFromName(name)).toBe(code);
  });

  it("yields no code for a name without a letter or a digit", () => {
    expect(supplyTypeCodeFromName(" -- / ")).toBeNull();
  });
});

// An import names the family of an article by its name. Failure modes:
//  a. « tubes », « TUBE » or « Tube » with a trailing space file the article under no family, or another one;
//  b. a name the company does not have is matched to the closest family instead of being reported;
//  c. two historical families sharing a key are picked at random.
describe("matchSupplyTypeByName", () => {
  const families = [
    { id: "tube", name: "Tube" },
    { id: "raccord", name: "Raccord à sertir" },
  ];

  it.each([
    ["Tube", "tube"],
    ["  TUBES ", "tube"],
    ["raccord-a-sertir", "raccord_a_sertir"],
    // Only the final « s » of the whole name is dropped.
    ["Raccords à sertir", "raccords_a_sertir"],
    ["Raccord à sertirs", "raccord_a_sertir"],
    ["s", "s"],
    // unaccent spells out the ligature: a file typed without it names the same family.
    ["Œillets", "oeillet"],
    ["Oeillets", "oeillet"],
  ])("gives « %s » the key %s, as the database does", (name, key) => {
    expect(supplyTypeNameKey(name)).toBe(key);
  });

  it("finds the family whatever its case, accents, punctuation or final « s »", () => {
    expect(matchSupplyTypeByName(families, " tubes ")).toEqual({ status: "found", id: "tube", name: "Tube" });
    expect(matchSupplyTypeByName(families, "RACCORD A SERTIR")).toEqual({ status: "found", id: "raccord", name: "Raccord à sertir" });
  });

  it("reports a name the company does not have, and a name with no letter or digit", () => {
    expect(matchSupplyTypeByName(families, "Tuyauterie")).toEqual({ status: "unknown" });
    expect(matchSupplyTypeByName(families, " -- ")).toEqual({ status: "unknown" });
  });

  it("reports a name two historical families share", () => {
    expect(matchSupplyTypeByName([...families, { id: "tubes", name: "Tubes" }], "tube")).toEqual({ status: "ambiguous" });
  });
});

describe("createSupplyTypeSchema", () => {
  it("trims the name", () => {
    expect(createSupplyTypeSchema.parse({ name: "  Supportage " })).toEqual({ name: "Supportage" });
  });

  it.each([[""], ["   "], ["x".repeat(81)], ["///"]])("refuses %j", (name) => {
    expect(createSupplyTypeSchema.safeParse({ name }).success).toBe(false);
  });
});
