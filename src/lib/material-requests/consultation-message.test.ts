import { describe, expect, it } from "vitest";

import { buildConsultationMessage, consultationLineOf, type ConsultationLine } from "./consultation-message";
import type { MaterialRequest, MaterialRequestLine } from "./contracts";

/**
 * Failure modes, written before the code (TI-691, lot 2 « l'achat », delivery 2 « consultation »). The office
 * copies this message into WhatsApp; MergeOne sends nothing. Every example is invented:
 *  1. the message is long or stiff, or carries an empty field (« - 4 u , , ») or « null »;
 *  2. the usual supplier's message misses its reference for a line whose reference is known, or writes a
 *     bare « réf. » without the article when it is unknown;
 *  3. a competition message leaks a reference: the usual supplier's, the article's internal one, or the one the
 *     technician wrote on the sheet (a competitor would know who supplies us, or what we pay);
 *  4. a quantity is written with a dot (« 2.5 ») instead of the French comma, or a missing quantity reads « 0 »;
 *  5. a line without an article loses its words, or repeats what its type already says (« Coude inox, Inox »);
 *  6. the delivery place is missing when known, or invented when unknown;
 *  7. lines come out in another order than the request's, or the material presumed for the sheet is used before
 *     the office confirmed it, or for overhead.
 */

function item(partial: Partial<ConsultationLine> = {}): ConsultationLine {
  return {
    quantity: 10,
    unit: "u",
    designation: "Coude 90°",
    dimension: "DN 50",
    material: "Inox 316L",
    precision: null,
    originalText: "10 coudes inox 50",
    supplierSku: null,
    ...partial,
  };
}

function line(partial: Partial<MaterialRequestLine> = {}): MaterialRequestLine {
  return {
    id: "line-1",
    request_id: "request-1",
    position: 1,
    original_text: "10 coudes inox 50",
    quantity: 10,
    quantity_doubtful: false,
    unit: "u",
    dimension: "DN 50",
    no_dimension: false,
    product_type: "Coude 90°",
    material: "Inox 316L",
    material_precision: null,
    reference: "CD-I316-50",
    supplier_id: "supplier-1",
    zone: null,
    imputation: "project",
    overhead_category: null,
    duplicate_acknowledged: false,
    status: "draft",
    validated_at: null,
    product_id: "article-1",
    product_match: "reference",
    unit_price_ht_cents: null,
    price_quote_id: null,
    ...partial,
  };
}

type Presumptions = Pick<MaterialRequest, "presumed_material" | "material_confirmed">;
const NO_PRESUMPTION: Presumptions = { presumed_material: null, material_confirmed: false };

describe("consultation message", () => {
  it("asks the usual supplier with its references, short, and the full designation when one is unknown (1, 2)", () => {
    const message = buildConsultationMessage({
      affaireName: "Résidence des Tilleuls",
      withReferences: true,
      deliveryPlace: "site",
      lines: [
        item({ supplierSku: "NA-4471" }),
        item({ quantity: 4, designation: "Té égal", supplierSku: null, originalText: "4 tés inox 50" }),
      ],
    });

    expect(message).toBe(
      [
        "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :",
        "- 10 u Coude 90° — réf. NA-4471",
        "- 4 u Té égal, DN 50, Inox 316L",
        "Livraison : chantier",
        "Merci !",
      ].join("\n"),
    );
  });

  it("never writes a reference in a competition message, only the full designation (3)", () => {
    const message = buildConsultationMessage({
      affaireName: "Résidence des Tilleuls",
      withReferences: false,
      deliveryPlace: "office",
      lines: [
        item({ supplierSku: "NA-4471", precision: "PN16" }),
        item({ quantity: 4, designation: "Té égal", supplierSku: "NA-5520" }),
      ],
    });

    expect(message).toBe(
      [
        "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :",
        "- 10 u Coude 90°, DN 50, Inox 316L, PN16",
        "- 4 u Té égal, DN 50, Inox 316L",
        "Livraison : bureau",
        "Merci !",
      ].join("\n"),
    );
    expect(message).not.toMatch(/réf|NA-/i);
  });

  it("leaves out of a competition the article's internal reference and the technician's (3, 7)", () => {
    const lines = [
      consultationLineOf(line({ reference: "471205" }), { request: NO_PRESUMPTION, supplierSku: "NA-4471" }),
      consultationLineOf(line({ id: "line-2", position: 2, reference: null }), { request: NO_PRESUMPTION, supplierSku: null }),
    ];
    const competition = buildConsultationMessage({
      affaireName: "Résidence des Tilleuls",
      withReferences: false,
      deliveryPlace: null,
      lines,
    });

    expect(competition).not.toMatch(/471205|NA-4471|CD-I316|réf/i);
    expect(competition.split("\n")).toEqual([
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Résidence des Tilleuls :",
      "- 10 u Coude 90°, DN 50, Inox 316L",
      "- 10 u Coude 90°, DN 50, Inox 316L",
      "Merci !",
    ]);
  });

  it("writes quantities with a French comma and leaves out what is unknown (1, 4, 6)", () => {
    const message = buildConsultationMessage({
      affaireName: "Atelier Nord",
      withReferences: false,
      deliveryPlace: null,
      lines: [
        item({ quantity: 2.5, unit: "ml", designation: "Tube cuivre", dimension: "Ø 22", material: null }),
        item({ quantity: null, unit: null, designation: "Collier isophonique", dimension: null, material: null }),
        item({ quantity: 6, unit: null, designation: "Vanne d’arrêt", dimension: "", material: "  ", precision: null }),
      ],
    });

    expect(message.split("\n")).toEqual([
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Atelier Nord :",
      "- 2,5 ml Tube cuivre, Ø 22",
      "- Collier isophonique",
      "- 6 Vanne d’arrêt",
      "Merci !",
    ]);
    expect(message).not.toMatch(/null|undefined|, ,|,\n| 0 /);
  });

  it("says counter pickup in plain words (6)", () => {
    const message = buildConsultationMessage({
      affaireName: "Atelier Nord",
      withReferences: true,
      deliveryPlace: "counter",
      lines: [item({ supplierSku: "NA-4471" })],
    });

    expect(message.split("\n").slice(-2)).toEqual(["Retrait au comptoir", "Merci !"]);
  });

  it("uses the technician's words for a line without type words, and repeats nothing (5)", () => {
    const message = buildConsultationMessage({
      affaireName: "Atelier Nord",
      withReferences: true,
      deliveryPlace: null,
      lines: [
        item({ designation: null, dimension: null, material: null, originalText: "goujons M12 galva", quantity: 150 }),
        item({ designation: "Coude inox 316L DN 50", dimension: "DN 50", material: "Inox 316L" }),
        item({ designation: null, dimension: null, material: null, originalText: null, quantity: 3 }),
      ],
    });

    expect(message.split("\n")).toEqual([
      "Bonjour, pouvez-vous me faire un prix pour l’affaire Atelier Nord :",
      "- 150 u goujons M12 galva",
      "- 10 u Coude inox 316L DN 50",
      "- 3 u Sans désignation",
      "Merci !",
    ]);
  });

  it("takes the sheet's material only once confirmed, and never for overhead (7)", () => {
    const confirmed: Presumptions = { presumed_material: "Cuivre", material_confirmed: true };
    const unconfirmed: Presumptions = { presumed_material: "Cuivre", material_confirmed: false };
    const bare = line({ material: null, product_type: "Té égal", dimension: "Ø 22" });

    expect(consultationLineOf(bare, { request: confirmed, supplierSku: null }).material).toBe("Cuivre");
    expect(consultationLineOf(bare, { request: unconfirmed, supplierSku: null }).material).toBeNull();
    expect(
      consultationLineOf({ ...bare, imputation: "overhead" }, { request: confirmed, supplierSku: null }).material,
    ).toBeNull();
    expect(consultationLineOf(line({ material_precision: "PN16" }), { request: confirmed, supplierSku: "X" })).toEqual({
      quantity: 10,
      unit: "u",
      designation: "Coude 90°",
      dimension: "DN 50",
      material: "Inox 316L",
      precision: "PN16",
      originalText: "10 coudes inox 50",
      supplierSku: "X",
    });
  });

  it("keeps the lines in the order it is given (7)", () => {
    const message = buildConsultationMessage({
      affaireName: "Atelier Nord",
      withReferences: false,
      deliveryPlace: null,
      lines: [item({ designation: "Bride" }), item({ designation: "Joint" }), item({ designation: "Boulon" })],
    });

    expect(message.split("\n").slice(1, 4).map((entry) => entry.split(" ")[3].replace(",", ""))).toEqual([
      "Bride",
      "Joint",
      "Boulon",
    ]);
  });
});
