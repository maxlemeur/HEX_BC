import { describe, expect, it } from "vitest";

import {
  matchPriceReuseLines,
  type PriceReuseReferenceLine,
  type PriceReuseTargetLine,
} from "@/lib/estimates/price-reuse-matching";

/*
 * Ways the designation matcher can fail, written before the matcher (AGENTS.md, isolated test):
 * 1. Another diameter, insulation thickness, wall thickness, length or pressure class is proposed as the same
 *    article (DN32 for DN40, 54x30 for 54x40, PN10 for PN16): a wrong price that looks identical.
 * 2. The same article written differently (accents, apostrophes, « DN 32 »/« DN32 », « 22x1,2 »/« 22x1.2 »,
 *    « × », « Ø »/« diam. », « ép. 13 mm »/« epaisseur 13mm », word order, plural) is not recognised.
 * 3. A different grade, number of ways or material (304L/316L, 2/3 voies, Kooltherm/laine) is called identical.
 * 4. A price per m² is proposed for a line in ml.
 * 5. Two different reference prices for the same designation (GT and distribution) are silently collapsed.
 * 6. The same price repeated in several sections is reported as a conflict.
 * 7. A line that omits a dimension stated by the reference is called identical.
 * 8. An unpriced reference line (« compris », PM) becomes a price source.
 * 9. Unbounded or unstable candidate lists (ties resolved differently between calls).
 * 10. Empty designations crash or match everything.
 * 11. Words that change the article are dropped as noise: location (« sous »/« sur » dalle), single letters (M/F, classe
 *     A/B, courbe C/D, H07V-U/K, 304L), so a different article is called identical (independent review, 31/10/2026).
 * 12. Order-sensitive numbers are compared as a set: a fraction 3/4 for 1/2, a labelled H 600 L 1000 for H 1000 L 600.
 */

let sequence = 0;
const target = (title: string, unitCode: string | null = "u", sectionPath: string[] = ["PLOMBERIE"]): PriceReuseTargetLine => ({
  id: `t${++sequence}`, title, unitCode, sectionPath,
});
const reference = (id: string, title: string, options: { unit?: string | null; section?: string[]; priced?: boolean; priceKey?: string } = {}):
  PriceReuseReferenceLine => ({
  id, title, unitCode: options.unit === undefined ? "u" : options.unit, sectionPath: options.section ?? ["REFERENCE"],
  priced: options.priced ?? true, priceKey: options.priceKey ?? id,
});
const matchOne = (line: PriceReuseTargetLine, references: PriceReuseReferenceLine[]) =>
  matchPriceReuseLines({ targets: [line], references })[0];

describe("price reuse designation matching", () => {
  it.each([
    ["Vanne d'arret RBS DN 32", "Vanne d'arrêt RBS DN32"],
    ["DN20 - Tube inox 304L serti 22x1,2", "Tube inox 304L serti DN20 22x1.2"],
    ["Tube cuivre diam. 22 x 1 calorifugé epaisseur 13mm", "Tube cuivre Ø22x1 calorifugé ép. 13 mm"],
    ["Calorifuge INSUL-TUBE Ø22x19mm - DN20", "calorifuge insul tube Ø 22 × 19 mm DN 20"],
    ["Vannes d'arrêt DN40", "Vanne d'arrêt DN40"],
    ["Tuyaux PVC DN100 EU", "Tuyau PVC DN 100 EU"],
  ])("recognises « %s » as the reference article « %s »", (line, referenceTitle) => {
    const match = matchOne(target(line), [reference("r1", referenceTitle)]);
    expect([match.status, match.proposedReferenceId]).toEqual(["identical", "r1"]);
  });

  it.each([
    ["Vanne d'arrêt RBS DN40", "Vanne d'arrêt RBS DN32"],
    ["Calorifuge laine nu 54x40mm - DN50", "Calorifuge laine nu 54x30mm - DN50"],
    ["DN25 - Tube inox 304L serti 28x1,2", "DN25 - Tube inox 304L serti 28x1,5"],
    ["Flexible nu DN20 lg500 mm", "Flexible nu DN20 lg300 mm"],
    ["Robinet à soupape PN16 DN50", "Robinet à soupape PN10 DN50"],
    ["Calorifuge laine ép. 30 mm DN50", "Calorifuge laine ép. 40 mm DN50"],
    ["Raccord laiton mâle 1/2", "Raccord laiton mâle 3/4"],
    ["Trappe de visite H 600 L 1000", "Trappe de visite H 1000 L 600"],
  ])("never proposes « %s » the price of « %s »", (line, referenceTitle) => {
    const match = matchOne(target(line), [reference("r1", referenceTitle)]);
    expect([match.status, match.candidates]).toEqual(["new", []]);
  });

  it.each([
    ["Tube inox 316L serti DN20", "Tube inox 304L serti DN20"],
    ["Vanne 3 voies DN20", "Vanne 2 voies DN20"],
    ["Calorifuge Kooltherm Ø54x30mm - DN50", "Calorifuge laine nu 54x30mm - DN50"],
    ["Pose sous dalle tube PER 16", "Pose sur dalle tube PER 16"],
    ["Raccord M/F laiton 15x21", "Raccord F/F laiton 15x21"],
    ["Tube PVC classe A DN100", "Tube PVC classe B DN100"],
    ["Câble H07V-U 1,5 mm", "Câble H07V-K 1,5 mm"],
    ["Disjoncteur courbe C 16A", "Disjoncteur courbe D 16A"],
    ["Tube inox 304L serti DN20", "Tube inox 304 serti DN20"],
  ])("does not call « %s » identical to « %s »", (line, referenceTitle) => {
    expect(matchOne(target(line), [reference("r1", referenceTitle)]).status).not.toBe("identical");
  });

  it("keeps a different material apart instead of proposing it", () => {
    const match = matchOne(target("Calorifuge Kooltherm Ø54x30mm - DN50"), [reference("r1", "Calorifuge laine nu 54x30mm - DN50")]);
    expect(match.status).toBe("new");
  });

  it("requires the same unit and names the reference unit otherwise", () => {
    const match = matchOne(target("Calorifuge laine nu 54x30mm - DN50", "ml"),
      [reference("r1", "Calorifuge laine nu 54x30mm - DN50", { unit: "m2" })]);
    expect([match.status, match.candidates]).toEqual(["new", []]);
    expect(match.notes.join(" ")).toContain("m2");
  });

  it("does not reuse a price for a line without unit", () => {
    expect(matchOne(target("Vanne d'arrêt RBS DN32", null), [reference("r1", "Vanne d'arrêt RBS DN32")]).status).toBe("new");
  });

  it("asks for review when the reference prices the same article twice, proposing the closest section", () => {
    const match = matchOne(target("Purgeur + vanne", "u", ["PLOMBERIE", "Gaine technique"]), [
      reference("distribution", "Purgeur + vanne", { section: ["EAU CHAUDE - Distribution"], priceKey: "a" }),
      reference("gaine", "Purgeur + vanne", { section: ["EAU CHAUDE - Gaine technique (GT)"], priceKey: "b" }),
    ]);
    expect([match.status, match.proposedReferenceId]).toEqual(["to_review", "gaine"]);
    expect(match.candidates.map((candidate) => candidate.referenceId)).toEqual(["gaine", "distribution"]);
    expect(match.notes.join(" ")).toContain("Plusieurs prix");
  });

  it("treats the same price repeated in several sections as one article", () => {
    const match = matchOne(target("Purgeur + vanne"), [
      reference("first", "Purgeur + vanne", { section: ["EAU GLACEE - Distribution"], priceKey: "same" }),
      reference("second", "Purgeur + vanne", { section: ["EAU CHAUDE - Distribution"], priceKey: "same" }),
    ]);
    expect([match.status, match.proposedReferenceId]).toEqual(["identical", "first"]);
  });

  it("asks for review when the line omits a dimension stated by the reference", () => {
    const match = matchOne(target("Tube inox 304L serti DN20", "ml"),
      [reference("r1", "DN20 - Tube inox 304L serti 22x1,2", { unit: "ml" })]);
    expect([match.status, match.proposedReferenceId]).toEqual(["to_review", "r1"]);
    expect(match.candidates[0].differences.join(" ")).toMatch(/dimension/i);
  });

  it("names the extra words of a similar reference article", () => {
    const match = matchOne(target("Vanne d'arrêt DN40"), [reference("r1", "Vanne d'arrêt RBS DN40")]);
    expect([match.status, match.proposedReferenceId]).toEqual(["to_review", "r1"]);
    expect(match.candidates[0].differences.join(" ")).toContain("rbs");
  });

  it("never uses an unpriced reference line", () => {
    expect(matchOne(target("Pompe de relevage"), [reference("r1", "Pompe de relevage", { priced: false })]).status).toBe("new");
  });

  it("returns at most five candidates, best first, in a stable order", () => {
    const references = ["RBS", "papillon", "bouchonnée", "boisseau", "laiton", "inox", "sphérique"]
      .map((word, index) => reference(`r${index + 1}`, `Vanne d'arrêt ${word} DN20`));
    const line = target("Vanne d'arrêt DN20");
    const first = matchOne(line, references);
    expect(first.status).toBe("to_review");
    expect(first.candidates.map((candidate) => candidate.referenceId)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    expect(matchOne(line, [...references])).toEqual(first);
  });

  it("matches nothing for an empty designation and ignores empty reference designations", () => {
    expect(matchOne(target("   "), [reference("r1", "Vanne DN20")])).toMatchObject({ status: "new", candidates: [] });
    expect(matchOne(target("Vanne DN20"), [reference("r1", "  ")])).toMatchObject({ status: "new", candidates: [] });
  });

  it("returns one result per line in the line order", () => {
    const lines = [target("Vanne d'arrêt RBS DN32"), target("Pompe de relevage"), target("Vanne d'arrêt RBS DN40")];
    const results = matchPriceReuseLines({ targets: lines, references: [reference("r1", "Vanne d'arrêt RBS DN32")] });
    expect(results.map((result) => [result.lineId, result.status])).toEqual([
      [lines[0].id, "identical"], [lines[1].id, "new"], [lines[2].id, "new"],
    ]);
  });
});
