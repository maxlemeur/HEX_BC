import { describe, expect, it } from "vitest";

import { buildOfferReserveSentence } from "@/lib/estimates/offer-treatment";
import {
  planOfferTreatments,
  setOfferTreatmentsSchema,
  type OfferTreatmentPlanLine,
} from "@/lib/estimates/offer-treatment-plan";

const ID = (n: number) => `d6820000-0000-4000-8001-${String(n).padStart(12, "0")}`;

function line(n: number, title: string, pricing_status: string, treatment?: Record<string, unknown>): OfferTreatmentPlanLine {
  return {
    id: ID(n),
    item_type: "line",
    title,
    pricing_status,
    source_metadata: treatment
      ? { offer_treatment: { version: 1, decided_by: ID(900), decided_at: "2026-11-11T10:00:00.000Z", ...treatment } }
      : null,
  };
}

function reserve(title: string, text: string, basis = "private_estimate") {
  return { kind: "offer_reserve", basis, text, sentence: buildOfferReserveSentence(title, text) };
}

function decisions(entries: unknown[]) {
  return setOfferTreatmentsSchema.parse({ expected_content_revision: 4, decisions: entries }).decisions;
}

describe("setOfferTreatmentsSchema", () => {
  it("normalizes the texts and drops an empty note", () => {
    const parsed = decisions([
      { item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "  quantité\n à  confirmer " } },
      { item_id: ID(2), decision: { kind: "internal_exclusion", reason_code: "other_lot", note: "   " } },
    ]);
    expect(parsed[0].decision).toEqual({ kind: "offer_reserve", basis: "private_estimate", text: "quantité à confirmer" });
    expect(parsed[1].decision).toEqual({ kind: "internal_exclusion", reason_code: "other_lot", note: null });
  });

  it("refuses « Autre motif » without a note, an empty reserve, an author named by the caller and a line named twice", () => {
    const refused = (entries: unknown[]) => setOfferTreatmentsSchema
      .safeParse({ expected_content_revision: 4, decisions: entries }).success;
    expect(refused([{ item_id: ID(1), decision: { kind: "internal_exclusion", reason_code: "other" } }])).toBe(false);
    expect(refused([{ item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: " " } }])).toBe(false);
    expect(refused([{ item_id: ID(1), decision: { kind: "offer_reserve", basis: "public_tender", text: "x" } }])).toBe(false);
    expect(refused([{ item_id: ID(1), decision: { kind: "internal_exclusion", reason_code: "other_lot", decided_by: ID(900) } }]))
      .toBe(false);
    expect(refused([{ item_id: ID(1), decision: null }, { item_id: ID(1), decision: null }])).toBe(false);
    expect(refused([])).toBe(false);
  });
});

describe("planOfferTreatments", () => {
  it("writes the sentence of a reserve under the offer text and hands the choice to the writer", () => {
    const plan = planOfferTreatments({
      decisions: decisions([
        { item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "quantité à confirmer sur plans d’exécution" } },
        { item_id: ID(2), decision: { kind: "internal_exclusion", reason_code: "other_lot", note: "Lot gros œuvre" } },
      ]),
      lines: [line(1, "Calorifuge", "not_priced"), line(2, "Percements", "out_of_scope")],
      exclusions: "Hors peinture.",
    });
    expect(plan).toEqual({
      ok: true,
      treatments: [
        { item_id: ID(1), treatment: { kind: "offer_reserve", basis: "private_estimate",
          text: "quantité à confirmer sur plans d’exécution",
          sentence: "Réserve — « Calorifuge » : quantité à confirmer sur plans d’exécution" } },
        { item_id: ID(2), treatment: { kind: "internal_exclusion", reason_code: "other_lot", note: "Lot gros œuvre" } },
      ],
      exclusions: "Hors peinture.\n\nRéserve — « Calorifuge » : quantité à confirmer sur plans d’exécution",
    });
  });

  it("replaces the sentence of a reworded reserve and removes the sentence of a withdrawn one", () => {
    const stored = reserve("Calorifuge", "quantité à confirmer");
    const text = `Hors peinture.\n\n${stored.sentence}`;
    const reworded = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "épaisseur à confirmer" } }]),
      lines: [line(1, "Calorifuge", "not_priced", stored)],
      exclusions: text,
    });
    expect(reworded.ok && reworded.exclusions).toBe("Hors peinture.\n\nRéserve — « Calorifuge » : épaisseur à confirmer");

    const withdrawn = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: null }]),
      lines: [line(1, "Calorifuge", "not_priced", stored)],
      exclusions: text,
    });
    expect(withdrawn).toEqual({ ok: true, treatments: [{ item_id: ID(1), treatment: null }], exclusions: "Hors peinture." });
  });

  it("keeps a sentence another reserve of the same title and text still uses", () => {
    const stored = reserve("Calorifuge", "quantité à confirmer");
    const plan = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: null }]),
      lines: [line(1, "Calorifuge", "not_priced", stored), line(2, "Calorifuge", "priced", stored)],
      exclusions: stored.sentence,
    });
    expect(plan.ok && plan.exclusions).toBe(stored.sentence);
  });

  it("does not keep the sentence of a stored reserve its line no longer carries (status changed since)", () => {
    const stored = reserve("Calorifuge", "quantité à confirmer");
    const plan = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: null }]),
      lines: [line(1, "Calorifuge", "not_priced", stored), line(2, "Calorifuge", "out_of_scope", stored)],
      exclusions: stored.sentence,
    });
    expect(plan.ok && plan.exclusions).toBeNull();
  });

  it("refuses a line that is not of this estimate, a section, and a decision that does not fit the status", () => {
    const missing = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: null }, { item_id: ID(2), decision: null }]),
      lines: [{ ...line(2, "Lot", "priced"), item_type: "section" }],
      exclusions: null,
    });
    expect(missing).toEqual({ ok: false, refusal: { code: "OFFER_TREATMENT_LINE_NOT_FOUND", item_ids: [ID(1), ID(2)] } });

    const mismatched = planOfferTreatments({
      decisions: decisions([
        { item_id: ID(1), decision: { kind: "internal_exclusion", reason_code: "other_lot" } },
        { item_id: ID(2), decision: { kind: "offer_reserve", basis: "private_estimate", text: "à confirmer" } },
        { item_id: ID(3), decision: null },
      ]),
      lines: [line(1, "Calorifuge", "not_priced"), line(2, "Percements", "out_of_scope"), line(3, "Réseau EU", "priced")],
      exclusions: null,
    });
    expect(mismatched).toEqual({ ok: false, refusal: { code: "OFFER_TREATMENT_STATUS_MISMATCH", item_ids: [ID(1), ID(2)] } });
  });

  it("refuses reserves on two bases, counting the reserves this save leaves in place", () => {
    const kept = reserve("Réseau EU", "tracé à confirmer", "private_estimate");
    const input = (ids: number[]) => ({
      decisions: decisions(ids.map((n) => ({ item_id: ID(n),
        decision: { kind: "offer_reserve", basis: "indicative_quantities", text: "quantité indicative" } }))),
      lines: [line(1, "Calorifuge", "not_priced"), line(2, "Réseau EU", "priced", kept)],
      exclusions: kept.sentence,
    });
    expect(planOfferTreatments(input([1]))).toEqual({ ok: false,
      refusal: { code: "OFFER_RESERVE_BASIS_CONFLICT", bases: ["indicative_quantities", "private_estimate"] } });
    // Moving every reserve to the other basis in one save holds.
    expect(planOfferTreatments(input([1, 2])).ok).toBe(true);
  });

  it("refuses an offer text the reserves would push past 5 000 characters", () => {
    const plan = planOfferTreatments({
      decisions: decisions([{ item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "à confirmer" } }]),
      lines: [line(1, "Calorifuge", "not_priced")],
      exclusions: "x".repeat(4990),
    });
    expect(plan).toMatchObject({ ok: false, refusal: { code: "OFFER_LIMITS_TEXT_TOO_LONG" } });
  });
});
