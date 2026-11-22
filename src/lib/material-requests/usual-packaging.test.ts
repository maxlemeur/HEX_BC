import { describe, expect, it } from "vitest";

import {
  applicableUsualPackaging,
  exactPackagingCount,
  packagingCountText,
  packagingRounding,
  pluralPackagingLabel,
  usualPackagingConditionnement,
  type MaterialRequestUsualPackaging,
} from "./usual-packaging";

/**
 * Failure modes, written before the code (TI-690/TI-691, the owner's request of 2026-11-22: the usual packaging of
 * an article proposes to round a request line up to whole packagings, and writes « 3 barres de 6 ml » in the
 * supplier message). Every value is invented.
 *  1. Floating point: 0,75 × 3 is not 2,25, 14 / 6 is rounded the wrong way, or 18 / 6 is offered a rounding.
 *  2. A rounding is offered for a quantity that is unknown, zero or negative, or already a whole number of packagings.
 *  3. A line in another unit than the packaging's (« u » against « ml ») is offered the article's packaging; or « m.l. »,
 *     « ML » or « m » are not read as the packaging's « ml ».
 *  4. The text of a count is not « N <label in lowercase, plural> de <quantity> <unit> », or says something when the
 *     quantity is not an exact multiple.
 *  5. A rounding past the largest quantity a line accepts is offered.
 */

const BARRE: MaterialRequestUsualPackaging = { label: "Barre", quantity: 6, unit: "ml" };
const COURONNE: MaterialRequestUsualPackaging = { label: "Couronne", quantity: 0.75, unit: "ml" };

describe("usual packaging of a request line", () => {
  it("rounds up to whole packagings in exact thousandths (1)", () => {
    expect(packagingRounding(14, BARRE)).toEqual({ count: 3, quantity: 18 });
    expect(packagingRounding(2.5, COURONNE)).toEqual({ count: 4, quantity: 3 });
    expect(packagingRounding(2.2, COURONNE)).toEqual({ count: 3, quantity: 2.25 });
    expect(packagingRounding(0.001, BARRE)).toEqual({ count: 1, quantity: 6 });
    expect(packagingRounding(100.3, { label: "Touret", quantity: 0.1, unit: "ml" })).toBeNull();
    expect(packagingRounding(0.3, { label: "Lot", quantity: 0.1, unit: "u" })).toBeNull();
  });

  it("offers nothing for an exact multiple, an unknown, zero or negative quantity (1, 2)", () => {
    expect(packagingRounding(18, BARRE)).toBeNull();
    expect(packagingRounding(2.25, COURONNE)).toBeNull();
    expect(packagingRounding(null, BARRE)).toBeNull();
    expect(packagingRounding(0, BARRE)).toBeNull();
    expect(packagingRounding(-4, BARRE)).toBeNull();
    expect(packagingRounding(4, { ...BARRE, quantity: 0 })).toBeNull();
  });

  it("offers nothing past the largest quantity a line accepts (5)", () => {
    expect(packagingRounding(999_999, { label: "Touret", quantity: 3000, unit: "ml" })).toBeNull();
    expect(packagingRounding(999_999, { label: "Touret", quantity: 400, unit: "ml" })).toEqual({ count: 2500, quantity: 1_000_000 });
  });

  it("counts the packagings of an exact multiple only (4)", () => {
    expect(exactPackagingCount(18, BARRE)).toBe(3);
    expect(exactPackagingCount(6, BARRE)).toBe(1);
    expect(exactPackagingCount(2.25, COURONNE)).toBe(3);
    expect(exactPackagingCount(14, BARRE)).toBeNull();
    expect(exactPackagingCount(null, BARRE)).toBeNull();
    expect(exactPackagingCount(0, BARRE)).toBeNull();
  });

  it("applies to a line in the packaging's unit only, compared through the shared unit referential (3)", () => {
    for (const unit of ["ml", "ML", "m.l.", "mL", " ml ", "m", "mètres linéaires"]) {
      expect([unit, applicableUsualPackaging({ unit }, BARRE)]).toEqual([unit, BARRE]);
    }
    for (const unit of ["u", "pcs", "", null, "barre"]) {
      expect([unit, applicableUsualPackaging({ unit }, BARRE)]).toEqual([unit, null]);
    }
    expect(applicableUsualPackaging({ unit: "ml" }, null)).toBeNull();
    expect(applicableUsualPackaging({ unit: "ml" }, undefined)).toBeNull();
    // A unit outside the referential compares by its spelling.
    expect(applicableUsualPackaging({ unit: "Rlx" }, { label: "Carton", quantity: 12, unit: "rlx" })).toEqual({ label: "Carton", quantity: 12, unit: "rlx" });
  });

  it("writes the count in lowercase with a simple French plural (4)", () => {
    expect(pluralPackagingLabel("Barre", 3)).toBe("barres");
    expect(pluralPackagingLabel("Barre", 1)).toBe("barre");
    expect(pluralPackagingLabel("Touret", 2)).toBe("tourets");
    expect(pluralPackagingLabel("Lot de 10", 2)).toBe("lot de 10s");
    for (const label of ["Bobines", "Caisse à outils", "Faisceau", "Gaz"]) {
      expect(pluralPackagingLabel(label, 1)).toBe(label.toLowerCase());
    }
    expect(pluralPackagingLabel("Faisceaux", 4)).toBe("faisceaux");
    expect(pluralPackagingLabel("Gaz", 4)).toBe("gaz");
    expect(pluralPackagingLabel("Colis", 4)).toBe("colis");
    expect(packagingCountText(3, BARRE)).toBe("3 barres de 6 ml");
    expect(packagingCountText(1, { label: "Touret", quantity: 100, unit: "ml" })).toBe("1 touret de 100 ml");
    expect(packagingCountText(4, COURONNE)).toBe("4 couronnes de 0,75 ml");
    expect(packagingCountText(2, { label: "Palette", quantity: 12.5, unit: "m2" })).toBe("2 palettes de 12,5 m²");
  });

  it("gives the {conditionnement} of a line: an exact multiple in the packaging's unit, empty otherwise (3, 4)", () => {
    expect(usualPackagingConditionnement({ quantity: 18, unit: "m.l." }, BARRE)).toBe("3 barres de 6 ml");
    expect(usualPackagingConditionnement({ quantity: 6, unit: "ml" }, BARRE)).toBe("1 barre de 6 ml");
    expect(usualPackagingConditionnement({ quantity: 14, unit: "ml" }, BARRE)).toBeNull();
    expect(usualPackagingConditionnement({ quantity: 18, unit: "u" }, BARRE)).toBeNull();
    expect(usualPackagingConditionnement({ quantity: null, unit: "ml" }, BARRE)).toBeNull();
    expect(usualPackagingConditionnement({ quantity: 18, unit: "ml" }, null)).toBeNull();
  });
});
