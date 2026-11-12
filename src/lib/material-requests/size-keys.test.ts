import { describe, expect, it } from "vitest";

import { compareSizes, readSize } from "./size-keys";

/**
 * Failure modes, written before the code (TI-690, delivery 3). A technician writes a size the way he
 * knows it; the catalogue holds it the way the supplier prints it. The matcher must see the same size
 * behind different notations, and never call two different sizes the same.
 *  1. « 15/21 », « 1/2" » and « DN 15 » are not recognised as one size, so the right article is missed;
 *  2. « Ø 35 » in press-fit stainless or copper is not read as DN 32, while « Ø 35 » in welded stainless
 *     (no such tube) must not invent one;
 *  3. « M10 » is read as a millimetre or a DN, so a threaded rod matches a pipe fitting;
 *  4. a reducing size « DN32>25 » or « 32-25 » loses its second size, or a « DN 32 » article is said to be a
 *     different size from a reducing « 32-25 » line;
 *  5. DN 20 and DN 25 are called the same, or an unreadable size is called different (it must stay unknown);
 *  6. a size with no unit (« coude 20 ») is read as DN for steel and as an outer diameter for copper or
 *     multilayer, as each trade writes it.
 *  7. (Codex review of PR #263) a bare size of a material whose tubes have no DN (PVC, PEHD, PP, PER) is
 *     dropped: « 32 » and « 40 » in PVC are both unreadable, so a size-40 article is not told apart from a
 *     size-32 line, single or reducing.
 */

const dnOf = (text: string, material: string | null = null) => readSize(text, material)?.dn ?? null;

describe("readSize", () => {
  it.each([
    ["DN 15", null, 15],
    ["dn15", null, 15],
    ["15/21", null, 15],
    ["1/2\"", null, 15],
    ["20/27", null, 20],
    ["66/76", null, 65],
    ["33/42", null, 32],
    ["Ø 35", "Inox 304L serti", 32],
    ["diamètre 35", "Cuivre", 32],
    ["Ø 22", "Inox 316L serti", 20],
    ["Ø 26", "Multicouche serti", 20],
    ["Ø 42,4", "Inox 304L soudé", 32],
  ])("reads %s (%s) as DN %s", (text, material, dn) => {
    expect(dnOf(text, material)).toBe(dn);
  });

  it("does not invent a DN for an outer diameter that no tube of that material has", () => {
    expect(readSize("Ø 35", "Inox 304L soudé")).toMatchObject({ dn: null, od: 35 });
    expect(readSize("Ø 125", null)).toMatchObject({ dn: null, od: 125 });
  });

  it.each([["M10", 10], ["m 12", 12], ["tige M8 x 1 m", 8]])("reads the metric thread of %s", (text, metric) => {
    expect(readSize(text, null)).toMatchObject({ metric, dn: null, od: null });
  });

  it("does not take a length in millimetres for a metric thread", () => {
    expect(readSize("125 mm", null)?.metric ?? null).toBeNull();
  });

  it.each([
    ["DN32>25", null, [32, 25]],
    ["DN 32 x DN 25", null, [32, 25]],
    ["32-25", "Acier galvanisé T10", [32, 25]],
    ["35-28", "Inox 304L serti", [32, 25]],
  ])("reads the reducing size %s (%s)", (text, material, [dn, reduce]) => {
    expect(readSize(text, material)).toMatchObject({ dn, reduce });
  });

  it("reads a bare number as a DN in steel and as an outer diameter in copper or multilayer", () => {
    expect(dnOf("20", "Acier noir T3")).toBe(20);
    expect(dnOf("20", null)).toBe(20);
    expect(dnOf("20", "Multicouche serti")).toBe(15);
    expect(dnOf("22", "Cuivre")).toBe(20);
  });

  it("keeps the outer diameter of a bare size when the material's tubes have no DN", () => {
    expect(readSize("32", "PVC")).toMatchObject({ od: 32 });
    expect(compareSizes(readSize("32", "PVC"), readSize("40", "PVC"))).toBe("different");
    expect(compareSizes(readSize("32", "PVC"), readSize("Ø 32", "PVC"))).toBe("same");
    expect(compareSizes(readSize("40-32", "PEHD"), readSize("40-25", "PEHD"))).toBe("different");
    expect(compareSizes(readSize("40-32", "PEHD"), readSize("40 x 32", "PEHD"))).toBe("same");
  });

  it("reads nothing in a text without a size", () => {
    expect(readSize("avec collerette", null)).toBeNull();
    expect(readSize("", null)).toBeNull();
  });
});

describe("compareSizes", () => {
  const read = (text: string, material: string | null = null) => readSize(text, material);

  it.each([
    ["15/21", null, "DN15", null],
    ["Ø 35", "Inox 304L serti", "DN32", "Inox 304L serti"],
    ["M10", null, "M10", null],
    ["32-25", "Acier galvanisé T10", "DN32>25", null],
    ["32-25", "Acier galvanisé T10", "DN32", null],
  ])("sees %s (%s) and %s (%s) as the same size", (left, leftMaterial, right, rightMaterial) => {
    expect(compareSizes(read(left, leftMaterial), read(right, rightMaterial))).toBe("same");
  });

  it.each([
    ["DN 20", "DN25"],
    ["M10", "M12"],
    ["DN32>25", "DN32>20"],
    ["Ø 125", "Ø 115"],
  ])("sees %s and %s as different sizes", (left, right) => {
    expect(compareSizes(read(left), read(right))).toBe("different");
  });

  it("does not compare what it cannot read, nor a thread with a pipe size", () => {
    expect(compareSizes(null, read("DN20"))).toBe("unknown");
    expect(compareSizes(read("M10"), read("DN20"))).toBe("unknown");
  });
});
