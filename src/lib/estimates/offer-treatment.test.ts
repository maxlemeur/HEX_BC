import { describe, expect, it } from "vitest";

import {
  buildOfferReserveSentence,
  effectiveOfferTreatment,
  expectsExclusionReason,
  isOfferReserveWritten,
  offerTreatmentKindForStatus,
  readOfferTreatment,
  reviewOfferTreatments,
  rewriteOfferLimitsText,
  type OfferTreatmentLine,
} from "@/lib/estimates/offer-treatment";

const USER = "11111111-1111-4111-8111-111111111111";
const AT = "2026-11-11T14:00:00.000Z";

function exclusion(overrides: Record<string, unknown> = {}) {
  return { offer_treatment: { version: 1, kind: "internal_exclusion", reason_code: "other_lot", note: null,
    decided_by: USER, decided_at: AT, ...overrides } };
}

function reserve(title: string, text: string, overrides: Record<string, unknown> = {}) {
  return { offer_treatment: { version: 1, kind: "offer_reserve", basis: "private_estimate", text,
    sentence: buildOfferReserveSentence(title, text), decided_by: USER, decided_at: AT, ...overrides } };
}

describe("readOfferTreatment", () => {
  it("reads nothing on a line without the key, and keeps the other provenance keys out of it", () => {
    expect(readOfferTreatment(null)).toEqual({ state: "none" });
    expect(readOfferTreatment({ takeoff_provision: { version: 1 } })).toEqual({ state: "none" });
    expect(readOfferTreatment({ offer_treatment: null })).toEqual({ state: "none" });
  });

  it("reads an internal exclusion and an offer reserve", () => {
    expect(readOfferTreatment(exclusion())).toMatchObject({ state: "read", treatment: { kind: "internal_exclusion" } });
    expect(readOfferTreatment(reserve("Réseau EU", "Quantité provisionnelle.")))
      .toMatchObject({ state: "read", treatment: { kind: "offer_reserve", basis: "private_estimate" } });
  });

  it.each([
    ["an unknown reason", exclusion({ reason_code: "because" })],
    ["« Autre motif » without its note", exclusion({ reason_code: "other", note: null })],
    ["an unknown basis", reserve("A", "B", { basis: "public_tender" })],
    ["a reserve without basis", { offer_treatment: { version: 1, kind: "offer_reserve", text: "B", sentence: "S",
      decided_by: USER, decided_at: AT } }],
    ["a multi-line text", reserve("A", "B", { text: "ligne 1\nligne 2" })],
    ["an extra key", exclusion({ approved: true })],
    ["another version", exclusion({ version: 2 })],
    ["a string", { offer_treatment: "offer_reserve" }],
  ])("refuses %s as unreadable, never as a decision", (_name, metadata) => {
    expect(readOfferTreatment(metadata)).toEqual({ state: "unreadable" });
    expect(effectiveOfferTreatment(metadata, "not_priced")).toBeNull();
  });
});

describe("effectiveOfferTreatment", () => {
  it("applies a reason to the four statuses left out of the price, and to no other", () => {
    for (const status of ["included", "for_memory", "out_of_scope", "not_applicable"]) {
      expect(effectiveOfferTreatment(exclusion(), status)?.kind).toBe("internal_exclusion");
      expect(offerTreatmentKindForStatus(status)).toBe("internal_exclusion");
    }
    for (const status of ["priced", "not_priced"]) {
      expect(effectiveOfferTreatment(exclusion(), status)).toBeNull();
      expect(offerTreatmentKindForStatus(status)).toBe("offer_reserve");
    }
  });

  it("applies a reserve to a priced or « Non chiffrée » line only", () => {
    const metadata = reserve("A", "B");
    expect(effectiveOfferTreatment(metadata, "not_priced")?.kind).toBe("offer_reserve");
    expect(effectiveOfferTreatment(metadata, "priced")?.kind).toBe("offer_reserve");
    expect(effectiveOfferTreatment(metadata, "out_of_scope")).toBeNull();
    expect(effectiveOfferTreatment(metadata, undefined)?.kind).toBe("offer_reserve");
  });

  it("asks a reason for « Hors lot » and « Sans objet » only", () => {
    expect(["out_of_scope", "not_applicable"].every(expectsExclusionReason)).toBe(true);
    expect(["priced", "not_priced", "included", "for_memory", undefined].some(expectsExclusionReason)).toBe(false);
  });
});

describe("the sentence a reserve writes in the offer", () => {
  it("names the line by its title on one line", () => {
    expect(buildOfferReserveSentence("  Réseau EU  PVC\nØ 100 ", " quantité  provisionnelle,\nà confirmer. "))
      .toBe("Réserve — « Réseau EU PVC Ø 100 » : quantité provisionnelle, à confirmer.");
  });

  it("keeps the quotation marks of the sentence its own, and names an untitled line", () => {
    expect(buildOfferReserveSentence("Vanne « DN 50 »", "à confirmer"))
      .toBe("Réserve — « Vanne DN 50 » : à confirmer");
    expect(buildOfferReserveSentence("   ", "à confirmer")).toBe("Réserve — « Sans titre » : à confirmer");
    expect(buildOfferReserveSentence(null, "à confirmer")).toBe("Réserve — « Sans titre » : à confirmer");
  });

  it("cuts a very long title so that the sentence always fits", () => {
    const sentence = buildOfferReserveSentence("T".repeat(900), "t".repeat(500));
    expect(sentence.length).toBeLessThanOrEqual(800);
    expect(sentence).toContain("… » : ");
  });
});

describe("rewriteOfferLimitsText", () => {
  const first = buildOfferReserveSentence("Réseau EU", "quantité provisionnelle.");
  const second = buildOfferReserveSentence("Calorifuge", "non chiffré, à définir sur relevé.");

  it("adds the first reserve after the estimator's text, separated by one empty line", () => {
    expect(rewriteOfferLimitsText("Hors percements.\nHors peinture.\n\n", { remove: [], add: [first] }))
      .toBe(`Hors percements.\nHors peinture.\n\n${first}`);
  });

  it("writes into an empty text, and lists the following reserves one per line", () => {
    const one = rewriteOfferLimitsText(null, { remove: [], add: [first] });
    expect(one).toBe(first);
    expect(rewriteOfferLimitsText(one, { remove: [], add: [second] })).toBe(`${first}\n${second}`);
  });

  it("never writes a sentence twice", () => {
    expect(rewriteOfferLimitsText(`Texte.\n\n${first}`, { remove: [], add: [first, first] })).toBe(`Texte.\n\n${first}`);
  });

  it("replaces the sentence of a reworded reserve and leaves the rest untouched", () => {
    const reworded = buildOfferReserveSentence("Réseau EU", "quantité à confirmer sur relevé.");
    expect(rewriteOfferLimitsText(`Texte libre.\n\n${first}\n${second}`, { remove: [first], add: [reworded] }))
      .toBe(`Texte libre.\n\n${second}\n${reworded}`);
  });

  it("takes out a withdrawn reserve, down to an empty text stored as null", () => {
    expect(rewriteOfferLimitsText(`Texte.\r\n\r\n${first}\r\n`, { remove: [first], add: [] })).toBe("Texte.");
    expect(rewriteOfferLimitsText(first, { remove: [first], add: [] })).toBeNull();
  });

  it("does not remove a sentence the estimator moved inside a paragraph", () => {
    const edited = `Nota : ${first} Voir CCTP.`;
    expect(rewriteOfferLimitsText(edited, { remove: [first], add: [] })).toBe(edited);
    expect(isOfferReserveWritten(edited, first)).toBe(false);
  });

  it("finds a sentence alone on its line whatever the surrounding spaces", () => {
    expect(isOfferReserveWritten(`Texte.\n   ${first}  \n`, first)).toBe(true);
    expect(isOfferReserveWritten(null, first)).toBe(false);
  });
});

describe("reviewOfferTreatments", () => {
  const written = buildOfferReserveSentence("Calorifuge", "non chiffré, à définir sur relevé.");
  const line = (id: string, status: string, metadata: unknown = {}, title = "Calorifuge"): OfferTreatmentLine =>
    ({ id, item_type: "line", title, pricing_status: status, source_metadata: metadata });

  it("classifies a « Non chiffrée » line whose reserve the offer text holds", () => {
    const review = reviewOfferTreatments(
      [line("a", "not_priced", reserve("Calorifuge", "non chiffré, à définir sur relevé.")), line("b", "not_priced")],
      `Hors percements.\n\n${written}`);
    expect(review).toEqual({ reservedNotPricedIds: ["a"], exclusionWithoutReasonIds: [], reserveToRewriteIds: [],
      reserveBasisConflictIds: [] });
  });

  it("does not classify it once the sentence has left the offer text", () => {
    const review = reviewOfferTreatments(
      [line("a", "not_priced", reserve("Calorifuge", "non chiffré, à définir sur relevé."))], "Hors percements.");
    expect(review.reservedNotPricedIds).toEqual([]);
    expect(review.reserveToRewriteIds).toEqual(["a"]);
  });

  it("names a priced line whose provisional quantity is no longer written", () => {
    const review = reviewOfferTreatments([line("p", "priced", reserve("Réseau EU", "quantité provisionnelle."))], null);
    expect(review.reserveToRewriteIds).toEqual(["p"]);
    expect(review.reservedNotPricedIds).toEqual([]);
  });

  it("refuses reserves resting on two bases in one estimate, and classifies none of them", () => {
    const other = buildOfferReserveSentence("Réseau EU", "quantité provisionnelle.");
    const review = reviewOfferTreatments([
      line("a", "not_priced", reserve("Calorifuge", "non chiffré, à définir sur relevé.")),
      line("p", "priced", reserve("Réseau EU", "quantité provisionnelle.", { basis: "indicative_quantities" })),
    ], `${written}\n${other}`);
    expect(review.reserveBasisConflictIds).toEqual(["a", "p"]);
    expect(review.reservedNotPricedIds).toEqual([]);
    expect(review.reserveToRewriteIds).toEqual([]);
  });

  it("lists « Hors lot » and « Sans objet » lines without a reason, and no other status", () => {
    const review = reviewOfferTreatments([
      line("h", "out_of_scope"), line("s", "not_applicable"), line("i", "included"), line("m", "for_memory"),
      line("h2", "out_of_scope", exclusion()), line("s2", "not_applicable", exclusion({ reason_code: "other", note: "Voir CCTP 3.2" })),
      // A reserve kept from the time the line was « Non chiffrée » is not a reason.
      line("h3", "out_of_scope", reserve("Calorifuge", "non chiffré.")),
    ], null);
    expect(review.exclusionWithoutReasonIds).toEqual(["h", "s", "h3"]);
    expect(review.reserveToRewriteIds).toEqual([]);
  });

  it("names a line whose status changed while the offer text still holds the sentence of its reserve", () => {
    const stale = reserve("Calorifuge", "non chiffré, à définir sur relevé.");
    expect(reviewOfferTreatments([line("h", "out_of_scope", stale)], `Texte.\n${written}`).reserveToRewriteIds)
      .toEqual(["h"]);
    expect(reviewOfferTreatments([line("i", "included", stale)], written).reserveToRewriteIds).toEqual(["i"]);
    // Once the sentence has left the text, nothing is left for the client to read.
    expect(reviewOfferTreatments([line("h", "out_of_scope", stale)], "Texte.").reserveToRewriteIds).toEqual([]);
  });

  it("leaves that line alone when another line still reserves the same sentence", () => {
    const same = reserve("Calorifuge", "non chiffré, à définir sur relevé.");
    const review = reviewOfferTreatments([line("h", "out_of_scope", same), line("a", "not_priced", same)], written);
    expect(review.reserveToRewriteIds).toEqual([]);
    expect(review.reservedNotPricedIds).toEqual(["a"]);
  });

  it("counts an unreadable decision as no decision, and names it on a line a reserve could classify", () => {
    const review = reviewOfferTreatments([
      line("a", "not_priced", { offer_treatment: { kind: "offer_reserve" } }),
      line("h", "out_of_scope", { offer_treatment: "internal_exclusion" }),
    ], written);
    expect(review.reservedNotPricedIds).toEqual([]);
    expect(review.reserveToRewriteIds).toEqual(["a"]);
    expect(review.exclusionWithoutReasonIds).toEqual(["h"]);
  });

  it("ignores sections", () => {
    const review = reviewOfferTreatments([{ id: "s", item_type: "section", pricing_status: "out_of_scope" }], null);
    expect(review.exclusionWithoutReasonIds).toEqual([]);
  });
});
