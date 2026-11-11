import { describe, expect, it } from "vitest";

import {
  appendOfferReserveParagraph,
  applyOfferChoiceRules,
  buildOfferReserveParagraph,
  estimateOfferChoiceInputSchema,
  formatOfferChoice,
  hasOfferLimitsText,
  offerChoiceError,
  readEstimateOfferChoice,
  readOfferReserve,
} from "@/lib/estimates/offer-choice";

// TI-682, lot C, PR 4 (D10, D28): the written reserve. These rules mirror the database's (public.estimate_offer_choice_valid,
// private.clear_estimate_item_offer_choice), tested in supabase/tests/database/estimate-line-offer-choice.test.sql.

const STORED = { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: null,
  decided_by: "11111111-1111-4111-8111-111111111111", decided_at: "2026-11-11T18:02:23.123456+00:00" };

describe("the written reserve in the offer (TI-682)", () => {
  it("accepts a basis and a code, with a note of 10 to 500 code points required for « other » and indicative quantities", () => {
    expect(offerChoiceError({ basis: "private_estimate", code: "pending_survey", note: null })).toBeNull();
    expect(offerChoiceError({ basis: "private_estimate", code: "pending_survey", note: "123456789" })).toMatch(/10 à 500/);
    expect(offerChoiceError({ basis: "private_estimate", code: "other", note: "  " })).toMatch(/Autre/);
    expect(offerChoiceError({ basis: "indicative_quantities", code: "pending_survey", note: null }))
      .toMatch(/règlement de la consultation/);
    expect(offerChoiceError({ basis: "indicative_quantities", code: "pending_survey", note: "RC article 5.2" })).toBeNull();
    expect(offerChoiceError({ basis: "private_estimate", code: "other", note: "é".repeat(501) })).toMatch(/Autre/);
  });

  it("parses a request as stored, and refuses anything the server sets or the database refuses", () => {
    expect(estimateOfferChoiceInputSchema.parse({ kind: "reserve", basis: "private_estimate", code: "pending_survey",
      note: "  Relevé prévu sur site \n" })).toEqual({ kind: "reserve", basis: "private_estimate", code: "pending_survey",
      note: "Relevé prévu sur site" });
    expect(estimateOfferChoiceInputSchema.parse({ kind: "reserve", basis: "private_estimate", code: "pending_survey" }))
      .toMatchObject({ note: null });
    for (const body of [
      { kind: "reserve", basis: "public_lump_sum", code: "pending_survey" },
      { kind: "reserve", basis: "private_estimate", code: "unknown" },
      { kind: "provisional_quantity", basis: "private_estimate", code: "pending_survey" },
      { kind: "reserve", basis: "private_estimate", code: "pending_survey", decided_by: STORED.decided_by },
      { kind: "reserve", basis: "indicative_quantities", code: "pending_survey" },
      "reserve",
    ]) {
      expect(estimateOfferChoiceInputSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it("reads a reserve only on a « Non chiffrée » line, of the stored shape", () => {
    expect(readOfferReserve({ item_type: "line", pricing_status: "not_priced", offer_choice: STORED })).toEqual(STORED);
    expect(readOfferReserve({ item_type: "line", pricing_status: "priced", offer_choice: STORED })).toBeNull();
    expect(readOfferReserve({ item_type: "section", pricing_status: "not_priced", offer_choice: STORED })).toBeNull();
    for (const value of [null, "reserve", { ...STORED, code: "other" }, { ...STORED, extra: 1 }, { ...STORED, decided_by: "x" }]) {
      expect(readEstimateOfferChoice(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("clears the reserve when the status leaves « Non chiffrée », keeps it otherwise", () => {
    const reserved = { pricing_status: "not_priced", offer_choice: STORED };
    expect(applyOfferChoiceRules(reserved, { ...reserved, pricing_status: "priced" }).offer_choice).toBeNull();
    expect(applyOfferChoiceRules(reserved, { ...reserved, pricing_status: "out_of_scope" }).offer_choice).toBeNull();
    const renamed = { ...reserved, title: "Renommée" };
    expect(applyOfferChoiceRules(reserved, renamed)).toBe(renamed);
  });

  it("says whether the limits text says anything: blanks and invisible characters say nothing", () => {
    for (const text of [null, undefined, "", "  \n\t", "  ", "​‍﻿"]) {
      expect(hasOfferLimitsText(text), JSON.stringify(text)).toBe(false);
    }
    expect(hasOfferLimitsText("Néant.")).toBe(true);
  });

  it("builds an editable paragraph listing the reserved lines, appended after the text already written", () => {
    expect(buildOfferReserveParagraph(["Réseau enterré", "  ", " Calorifuge "])).toBe(
      "Les prestations suivantes ne sont pas chiffrées dans la présente offre :\n- Réseau enterré\n- Calorifuge");
    expect(appendOfferReserveParagraph("Nettoyage exclu.\n\n", ["Réseau enterré"])).toBe(
      "Nettoyage exclu.\n\nLes prestations suivantes ne sont pas chiffrées dans la présente offre :\n- Réseau enterré");
    expect(appendOfferReserveParagraph("   ", ["Réseau enterré"])).toBe(
      "Les prestations suivantes ne sont pas chiffrées dans la présente offre :\n- Réseau enterré");
  });

  it("formats the reserve for the internal CSV, empty on any other line", () => {
    expect(formatOfferChoice({ item_type: "line", pricing_status: "not_priced", offer_choice: { ...STORED, note: "Accès en toiture" } }))
      .toBe("Réserve — Devis privé (hors marché public) — À chiffrer après relevé : Accès en toiture");
    expect(formatOfferChoice({ item_type: "line", pricing_status: "not_priced", offer_choice: null })).toBe("");
  });
});
