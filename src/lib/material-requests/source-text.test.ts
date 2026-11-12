import { describe, expect, it } from "vitest";

import { materialRequestLineInputSchema, type MaterialRequestLineInput } from "./contracts";
import { splitSourceText } from "./source-text";

/**
 * Failure modes, written before the code (TI-690). The messages are fictional, in the shapes technicians
 * really write them:
 *  1. an article of the message is lost: a line is dropped, or two articles written on one line with
 *     " - " between them come out as one;
 *  2. the technician's words are rewritten: `original_text` is not the chunk as it was pasted;
 *  3. a size is read as a quantity ("15/21", "DN 20", "110 x 60") or a quantity as a size, so the office
 *     orders 15 valves instead of 80;
 *  4. a quantity written after the article ("x 200", "- 40 pièces", "36 ml") is missed, or its dash is taken
 *     for a second article;
 *  5. the pre-reading decides: it sets a material ("Tous les raccords en inox"), validates, or invents a
 *     type for a greeting or an instruction;
 *  6. a draft it returns is refused by the API contract (quantity out of bounds, over-long text);
 *  7. a pasted message freezes the screen: a pattern that backtracks on a long run of spaces, digits or
 *     dashes takes seconds on the 20,000 characters a message may hold (measured: 27 s on "ref" followed
 *     by 5,000 spaces, before the rewrite);
 *  8. "1.000 colliers" or "1 000 vis" is read as one piece, or as a thousand without anyone being told
 *     the figure needs a look;
 *  9. a tube, a hose, a duct or a cable asked without a unit is proposed in pieces, so the missing-unit
 *     alert never shows and 12 lengths are ordered where 12 metres were meant.
 *
 * What the function deliberately does not attempt: materials and their precision, suppliers, zones, angles,
 * bare numbers as sizes ("coude 20"), sizes in several figures ("110 x 60"), units other than pieces and
 * metres, telling a date from a fraction ("12/11"), and merging or deduplicating lines. The operator reads
 * every line against the original; this only saves typing.
 */

type Draft = MaterialRequestLineInput;

describe("splitSourceText", () => {
  it.each<[string, string, Draft[]]>([
    [
      "leading quantity and a fraction size, m/f left in the type",
      "60 robinet d'arrêt m/f chromé 20/27",
      [{ original_text: "60 robinet d'arrêt m/f chromé 20/27", quantity: 60, unit: "u", dimension: "20/27", product_type: "robinet d'arrêt m/f chromé" }],
    ],
    [
      "quantity after a dash is not a second article; a bare number is not a size",
      "té 32 90° - 25 pièces",
      [{ original_text: "té 32 90° - 25 pièces", quantity: 25, unit: "u", product_type: "té 32 90°" }],
    ],
    [
      "metres written after a dash",
      "Tuyau DN 32 - 48 ml",
      [{ original_text: "Tuyau DN 32 - 48 ml", quantity: 48, unit: "ml", dimension: "DN 32", product_type: "Tuyau" }],
    ],
    [
      "reference and trailing multiplier",
      "tige filetée M8 ref = 700123 x 150",
      [{ original_text: "tige filetée M8 ref = 700123 x 150", quantity: 150, unit: "u", dimension: "M8", reference: "700123", product_type: "tige filetée" }],
    ],
    [
      "several articles on one line, after an instruction that is kept unread",
      "À prendre au comptoir Y - 12 manchons Dn 80 - 6 réductions Dn 40",
      [
        { original_text: "À prendre au comptoir Y" },
        { original_text: "12 manchons Dn 80", quantity: 12, unit: "u", dimension: "DN 80", product_type: "manchons" },
        { original_text: "6 réductions Dn 40", quantity: 6, unit: "u", dimension: "DN 40", product_type: "réductions" },
      ],
    ],
    [
      "a sentence about the whole sheet sets no material and no type",
      "Toute la visserie en laiton",
      [{ original_text: "Toute la visserie en laiton" }],
    ],
    [
      "a greeting is kept as it is",
      "Bonjour, voici ce qu'il me faut pour jeudi :",
      [{ original_text: "Bonjour, voici ce qu'il me faut pour jeudi :" }],
    ],
    [
      "a diameter in words becomes Ø",
      "12 colliers diamètre 35",
      [{ original_text: "12 colliers diamètre 35", quantity: 12, unit: "u", dimension: "Ø 35", product_type: "colliers" }],
    ],
    [
      "Ø sign, compact DN and a decimal length without a dash",
      "gaine Ø125 2,5 ml",
      [{ original_text: "gaine Ø125 2,5 ml", quantity: 2.5, unit: "ml", dimension: "Ø 125", product_type: "gaine" }],
    ],
    [
      "a size without quantity still proposes the size and the type",
      "manchon DN32",
      [{ original_text: "manchon DN32", dimension: "DN 32", product_type: "manchon" }],
    ],
    [
      "a size in two figures is neither a quantity nor a size",
      "goulotte 110 x 60",
      [{ original_text: "goulotte 110 x 60" }],
    ],
    [
      "a fraction at the start is a size, never the quantity",
      "15/21 mamelon laiton x 6",
      [{ original_text: "15/21 mamelon laiton x 6", quantity: 6, unit: "u", dimension: "15/21", product_type: "mamelon laiton" }],
    ],
    [
      "a leading multiplier",
      "3 x té égal DN 40",
      [{ original_text: "3 x té égal DN 40", quantity: 3, unit: "u", dimension: "DN 40", product_type: "té égal" }],
    ],
    [
      "a bullet is not a separator",
      "- 6 purgeurs 15/21",
      [{ original_text: "- 6 purgeurs 15/21", quantity: 6, unit: "u", dimension: "15/21", product_type: "purgeurs" }],
    ],
    [
      "a dot as thousands separator is a thousand, to be checked",
      "1.000 colliers",
      [{ original_text: "1.000 colliers", quantity: 1000, quantity_doubtful: true, unit: "u", product_type: "colliers" }],
    ],
    [
      "a space as thousands separator is a thousand, to be checked",
      "1 000 vis",
      [{ original_text: "1 000 vis", quantity: 1000, quantity_doubtful: true, unit: "u", product_type: "vis" }],
    ],
    [
      "thousands after a multiplier and after a dash",
      "rondelles M8 x 2 000",
      [{ original_text: "rondelles M8 x 2 000", quantity: 2000, quantity_doubtful: true, unit: "u", dimension: "M8", product_type: "rondelles" }],
    ],
    [
      "a decimal comma stays a decimal",
      "1,5 ml gaine Ø 20",
      [{ original_text: "1,5 ml gaine Ø 20", quantity: 1.5, unit: "ml", dimension: "Ø 20", product_type: "gaine" }],
    ],
    [
      "tubes asked without a unit get none: pieces or metres is for the operator to say",
      "12 tubes cuivre 14/16",
      [{ original_text: "12 tubes cuivre 14/16", quantity: 12, dimension: "14/16", product_type: "tubes cuivre" }],
    ],
    [
      "a duct without a unit gets none, whatever the form of the quantity",
      "gaine annelée Ø 20 x 50",
      [{ original_text: "gaine annelée Ø 20 x 50", quantity: 50, dimension: "Ø 20", product_type: "gaine annelée" }],
    ],
    [
      "a cable without a unit gets none",
      "100 câble souple",
      [{ original_text: "100 câble souple", quantity: 100, product_type: "câble souple" }],
    ],
    [
      "a hose counted in pieces keeps its pieces",
      "tuyau flexible DN 16 - 25 pièces",
      [{ original_text: "tuyau flexible DN 16 - 25 pièces", quantity: 25, unit: "u", dimension: "DN 16", product_type: "tuyau flexible" }],
    ],
    [
      "a word that only starts like tube is counted in pieces",
      "8 tubulures DN 50",
      [{ original_text: "8 tubulures DN 50", quantity: 8, unit: "u", dimension: "DN 50", product_type: "tubulures" }],
    ],
    [
      "an unusable quantity is left to the operator",
      "0 bouchon DN 15",
      [{ original_text: "0 bouchon DN 15", dimension: "DN 15", product_type: "0 bouchon" }],
    ],
  ])("%s", (_label, text, expected) => {
    expect(splitSourceText(text)).toStrictEqual(expected);
  });

  it("returns one draft per non-empty line, in order, across blank lines and Windows line ends", () => {
    const drafts = splitSourceText("Bonjour\r\n\r\n   \n60 robinet 20/27\n\n  Tuyau DN 32 - 48 ml  \n");
    expect(drafts.map((draft) => draft.original_text)).toStrictEqual(["Bonjour", "60 robinet 20/27", "Tuyau DN 32 - 48 ml"]);
  });

  it("returns nothing for an empty or blank message", () => {
    expect(splitSourceText("")).toStrictEqual([]);
    expect(splitSourceText(" \n\t\n")).toStrictEqual([]);
  });

  it("never proposes a material, a status or a confirmation, whatever the text says", () => {
    const drafts = splitSourceText("Tout en inox 316L\n10 coudes inox DN 20\n4 brides acier galva Dn 50 - validé");
    const proposed = new Set(["original_text", "quantity", "quantity_doubtful", "unit", "dimension", "product_type", "reference"]);
    for (const draft of drafts) {
      expect(Object.keys(draft).filter((key) => !proposed.has(key))).toStrictEqual([]);
    }
    // The material written on a line stays in its words: the operator moves it to the material column.
    expect(drafts[1]).toMatchObject({ quantity: 10, dimension: "DN 20", product_type: "coudes inox" });
  });

  it("only returns drafts the API accepts", () => {
    const long = `25 ${"raccord ".repeat(90)}DN 20`;
    const drafts = splitSourceText(["60 robinet 20/27", "2000000 rondelles M8", "1,23456 ml tube DN 20", long, "9 999 999 vis"].join("\n"));
    for (const draft of drafts) {
      expect(materialRequestLineInputSchema.safeParse(draft).success).toBe(true);
    }
    expect(drafts[1].quantity).toBeUndefined();
    expect(drafts[2].quantity).toBeUndefined();
    expect(drafts[3].original_text).toHaveLength(500);
    expect(drafts[3].quantity).toBe(25);
    expect(drafts[4]).toStrictEqual({ original_text: "9 999 999 vis" });
  });

  // A linear pass over 20,000 characters takes a few milliseconds. The bound is one second: far above
  // that even on a loaded runner, and far below the 27 s a backtracking pattern took on a quarter of it.
  it.each<[string, string]>([
    ["ref and a run of spaces", `ref${" ".repeat(19_990)}!`],
    ["many refs, each before a run of spaces", `ref${" ".repeat(196)}!`.repeat(100)],
    ["a run of spaces between two words", `vanne${" ".repeat(19_980)}laiton`],
    ["spaces before a dash that separates nothing", `${" ".repeat(9_990)}x-${" ".repeat(9_990)}y`],
    ["repeated dash separators", " - ".repeat(6_666)],
    ["a run of dashes", `coude ${"-".repeat(19_980)} 4`],
    ["a run of digits", "9".repeat(20_000)],
    ["a run of digits after a multiplier", `vis x ${"9".repeat(19_990)}!`],
    ["groups of three digits", `${"123 ".repeat(4_999)}vis`],
    ["dotted groups of three digits", `${"123.".repeat(4_999)}vis`],
    ["DN and a run of spaces", `DN${" ".repeat(19_990)}x`],
    ["a diameter and a run of spaces", `diamètre${" ".repeat(19_980)}x`],
    ["commas and colons", `${",;:=".repeat(4_990)} coude DN 20`],
    ["twenty thousand one-character lines", "1\n".repeat(10_000)],
  ])("stays fast on %s", (_label, text) => {
    expect(text.length).toBeLessThanOrEqual(20_000);
    const started = performance.now();
    const drafts = splitSourceText(text);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(Array.isArray(drafts)).toBe(true);
  });
});
