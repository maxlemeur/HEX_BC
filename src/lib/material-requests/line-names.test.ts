/**
 * How a line is named in a sentence, on screen and in what the server answers. Failure modes:
 *  1. a line is pointed at by a number, although the page shows none;
 *  2. a line without a type is not named at all, or by an empty string;
 *  3. a sentence naming the lines of a long request grows with every line.
 */
import { describe, expect, it } from "vitest";

import { lineNamesLabel, lineTitle } from "./line-names";

describe("lineTitle", () => {
  it("names a line by its type and size (1)", () => {
    expect(lineTitle({ product_type: " Coude 90° ", dimension: "DN 50", original_text: "10 coudes inox 50" })).toBe("Coude 90° DN 50");
    expect(lineTitle({ product_type: "Filasse", dimension: null, original_text: null })).toBe("Filasse");
  });

  it("falls back on the technician's words, then says there are none (2)", () => {
    expect(lineTitle({ product_type: " ", dimension: "DN 50", original_text: "réf NA-4471 x4" })).toBe("« réf NA-4471 x4 »");
    expect(lineTitle({ product_type: null, dimension: null, original_text: "  " })).toBe("Sans désignation");
  });
});

describe("lineNamesLabel", () => {
  it("joins up to three names as a sentence reads them", () => {
    expect(lineNamesLabel([])).toBe("");
    expect(lineNamesLabel(["Coude DN 50"])).toBe("Coude DN 50");
    expect(lineNamesLabel(["Coude DN 50", "Té DN 50"])).toBe("Coude DN 50 et Té DN 50");
    expect(lineNamesLabel(["Coude DN 50", "Té DN 50", "Bride DN 50"])).toBe("Coude DN 50, Té DN 50 et Bride DN 50");
  });

  it("counts the lines beyond three instead of naming them all (3)", () => {
    expect(lineNamesLabel(["A", "B", "C", "D"])).toBe("A, B, C et 1 autre");
    expect(lineNamesLabel(["A", "B", "C", "D", "E", "F"])).toBe("A, B, C et 3 autres");
  });
});
