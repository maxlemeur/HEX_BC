import { describe, expect, it } from "vitest";

import { createSupplyTypeSchema, supplyTypeCodeFromName } from "./supply-types";

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

describe("createSupplyTypeSchema", () => {
  it("trims the name", () => {
    expect(createSupplyTypeSchema.parse({ name: "  Supportage " })).toEqual({ name: "Supportage" });
  });

  it.each([[""], ["   "], ["x".repeat(81)], ["///"]])("refuses %j", (name) => {
    expect(createSupplyTypeSchema.safeParse({ name }).success).toBe(false);
  });
});
