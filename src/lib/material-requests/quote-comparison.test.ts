import { describe, expect, it } from "vitest";

import { compareMaterialRequestQuote, type QuoteComparisonAnswer } from "./quote-comparison";

const message = "Bonjour,\n- 100 u Rondelle M8\n- 3 ml Tube DN 75\n- 1 u Coude 45° DN 75\nMerci";
const washer = { text: "100 u Rondelle M8", quantity: 100, unit: "u" };
const offer = {
  text: "BTE 50 RONDELLES M8 · 1 UN", page: 1, row: 1, quantity: 1, unit: "UN",
  pack_quantity: 50, pack_unit: "u", requested_group: 1, technical: "compatible" as const,
  observation: null, price: "4,20 € HT / boîte", delay: null,
};

function answer(partial: Partial<QuoteComparisonAnswer> = {}): QuoteComparisonAnswer {
  return {
    reference: "DEMO", date: null, revision: null, total_ht: null, commercial_notes: null,
    request_complete: true, document_complete: true, pages_read: [1],
    requested: [[washer], [{ text: "3 ml Tube DN 75", quantity: 3, unit: "ml" }],
      [{ text: "1 u Coude 45° DN 75", quantity: 1, unit: "u" }]],
    offered: [offer],
    ...partial,
  };
}

describe("compareMaterialRequestQuote", () => {
  it("checks the pieces in an explicit pack and preserves missing items", () => {
    const result = compareMaterialRequestQuote(answer(), message, 1);
    expect(result.lines[0]).toMatchObject({ status: "short", requested_quantity: 100, offered_quantity: 50, difference: -50 });
    expect(result.lines.slice(1).map((line) => line.status)).toEqual(["missing", "missing"]);
  });

  it("keeps an unknown pack or technical substitution from being counted as covered", () => {
    const unknown = compareMaterialRequestQuote(answer({ offered: [{ ...offer, unit: "boîtes", quantity: 100, pack_quantity: null, pack_unit: null }] }), message, 1);
    expect(unknown.lines[0]).toMatchObject({ status: "review", offered_quantity: null });
    const alternate = compareMaterialRequestQuote(answer({ offered: [{ ...offer, quantity: 2, technical: "different", observation: "Rondelle M10." }] }), message, 1);
    expect(alternate.lines[0]).toMatchObject({ status: "mismatch", offered_quantity: null });
  });

  it("does not count one quoted line twice or treat an incomplete reading as an absence", () => {
    const result = compareMaterialRequestQuote(answer({ offered: [offer, offer] }), message, 2);
    expect(result.complete).toBe(false);
    expect(result.lines.map((line) => line.status)).toEqual(["review", "review", "review"]);
    expect(result.lines[0].offered).toHaveLength(1);
  });

  it("groups repeated requested items only when both source occurrences exist", () => {
    const repeated = answer({ requested: [[washer, washer]], offered: [{ ...offer, quantity: 4 }] });
    expect(compareMaterialRequestQuote(repeated, "- 100 u Rondelle M8\n- 100 u Rondelle M8", 1).lines[0])
      .toMatchObject({ status: "covered", requested_quantity: 200 });
    expect(compareMaterialRequestQuote(repeated, message, 1)).toMatchObject({ complete: false, lines: [] });
  });

  it("reports an omitted line from the sent list and inventory items outside the request", () => {
    const result = compareMaterialRequestQuote(answer({
      requested: [[washer]],
      offered: [offer, { ...offer, text: "Gants · 2 UN", row: 2, requested_group: null, technical: "not_specified" }],
    }), message, 1);
    expect(result.complete).toBe(false);
    expect(result.lines[0].status).toBe("review");
    expect(result.unmatched_request).toEqual(["3 ml Tube DN 75", "1 u Coude 45° DN 75"]);
    expect(result.unmatched_offers).toMatchObject([{ text: "Gants · 2 UN", page: 1 }]);
  });

  it("catches omitted items without bullets and without certifying free text", () => {
    const washersOnly = answer({ requested: [[washer]], offered: [{ ...offer, quantity: 2 }] });
    const result = compareMaterialRequestQuote(washersOnly, "Bonjour\n1. 100 u Rondelle M8\n3 ml Tube DN75", 1);
    expect(result).toMatchObject({ complete: false, lines: [{ status: "review" }], unmatched_request: ["3 ml Tube DN75"] });
    const freeText = { ...washersOnly, requested: [[{ ...washer, text: "Rondelle M8, 100 pièces" }]] };
    expect(compareMaterialRequestQuote(freeText, "Rondelle M8, 100 pièces", 1).complete).toBe(false);
    const mixed = compareMaterialRequestQuote(washersOnly, "Bonjour, pouvez-vous me faire un prix pour l’affaire Démo :\n- 100 u Rondelle M8\nTube DN75, trois mètres\nMerci !", 1);
    expect(mixed).toMatchObject({ complete: false, lines: [{ status: "review" }], unmatched_request: ["Tube DN75, trois mètres"] });
  });

  it("recognizes the standard greeting without an affaire and collection at the counter", () => {
    const washersOnly = answer({ requested: [[washer]], offered: [{ ...offer, quantity: 2 }] });
    const sent = "Bonjour, pouvez-vous me faire un prix :\n- 100 u Rondelle M8\nRetrait au comptoir\nMerci !";
    expect(compareMaterialRequestQuote(washersOnly, sent, 1))
      .toMatchObject({ complete: true, lines: [{ status: "covered" }], unmatched_request: [] });
  });

  it("converts explicit lengths deterministically", () => {
    const result = compareMaterialRequestQuote(answer({ offered: [{
      ...offer, requested_group: 2, text: "TUBE DN75 · 1 BARRE DE 300 CM", quantity: 1,
      unit: "barre", pack_quantity: 300, pack_unit: "cm",
    }] }), message, 1);
    expect(result.lines[1]).toMatchObject({ status: "covered", requested_quantity: 3, offered_quantity: 3, difference: 0 });
  });
});
