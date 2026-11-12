import { describe, expect, it } from "vitest";

import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

import { dpgfRowRetainedQuantity } from "@/lib/takeoff/dpgf-quantity-policy";

import { buildRowsCsv, getDecisionImpactText, measuredQuantityLabel, retainedRoundingNote } from "./utils";

// TI-696 (Codex review of PR 288): a DPGF line other takeoffs feed holds their sum. Every figure the review states for
// it reads that sum, as the proposal and the application do: the quantity a person approves is the quantity written
// (the protective maximum on the total, a length rounded up once on it, as finalize_takeoff_lengths rounds it).
// Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const LENGTHS: Record<string, number> = { m: 1, ml: 1, cm: 0.01, mm: 0.001 };

function row(input: { unit: string; reference: number; measured: number | null; earlier?: number; earlierProtective?: number;
  deltaPercent: number; lengthFactor?: number | null; sourceUnit?: string | null; outOfScope?: boolean }): TakeoffDpgfComparisonRow {
  const total = Number(((input.measured ?? 0) + (input.earlier ?? 0)).toFixed(4));
  return {
    line_id: id(1), line_label: "Ligne fictive",
    // The estimate line's own unit gives the factor the application rounds with (`length_factor`); the DPGF source unit
    // may differ from it once the line's unit was set after the import.
    dpgf: { estimate_item_id: id(1), title: "Ligne fictive", description: null, quantity: input.reference,
      unit: input.sourceUnit === undefined ? input.unit : input.sourceUnit, source_page: 1, source_file_name: "dpgf.xlsx", position: 1,
      length_factor: input.lengthFactor === undefined ? LENGTHS[input.unit] ?? null : input.lengthFactor },
    linked_takeoff_items: input.measured === null ? [] : [{ item_id: id(2), designation: "Ligne fictive", quantity: input.measured,
      unit: input.unit, source_page: 2, source_file_name: "plan.pdf", confidence: 0.95, evidence: "Repère fictif", metadata: {} }],
    dpgf_quantity: input.reference, takeoff_quantity: input.measured, quantity_unit: input.unit, matching_score: 0.9, confidence_score: 0.9,
    review_status: "significant_gap", proofs: [], suggested_decision: null,
    applied_decision: input.outOfScope ? { id: id(5), tenant_id: id(6), version_id: id(7), takeoff_job_id: id(8), estimate_item_id: id(1),
      decision: "out_of_scope", reason: "Hors périmètre (fictif)", review_reference: "ref", line_label: "Ligne fictive", line_position: 1,
      source_file_name: "dpgf.xlsx", source_page: 1, decided_at: "2026-11-12T08:00:00Z", updated_at: "2026-11-12T08:00:00Z", decided_by: id(9),
      quantity_snapshot: {}, source: "current_version", carried_over_from_version_id: null, carried_over_from_version_number: null } : null,
    delta_absolute: Math.abs(total - input.reference), delta_percent: input.deltaPercent, is_exception: true, manual_link_count: 0,
    matched_by: "auto", risk: null,
    ...(input.earlier === undefined ? {} : { composition: {
      earlier: [{ job_id: id(9), job_created_at: "2026-11-10T09:00:00Z", job_level: "B", quantity: input.earlier, read_again: false,
        pages: [{ source_file_name: "plan.pdf", source_page: 1, quantity: input.earlier }] }],
      earlier_quantity: input.earlier, earlier_protective: input.earlierProtective ?? 0, earlier_printed_gap: 0, total_quantity: total,
      double_counted: [] } }),
  };
}

describe("the quantity a review states for a DPGF line", () => {
  it("is the sum the line will hold, not this takeoff's measure alone", () => {
    // DPGF reference 5, another takeoff's 12 kept, this one's 10: the application writes 22.
    const fed = row({ unit: "u", reference: 5, measured: 10, earlier: 12, deltaPercent: 340 });
    expect([getDecisionImpactText("keep_takeoff", fed), getDecisionImpactText("keep_dpgf", fed)])
      .toEqual(["Quantité retenue : 22 u (+340.0%)", "Quantité retenue : 22 u"]);
  });

  it("is a length as written: rounded up once, on the sum", () => {
    const fed = row({ unit: "ml", reference: 20, measured: 10.2, earlier: 12.4, deltaPercent: 13 });
    expect([getDecisionImpactText("keep_dpgf", fed), measuredQuantityLabel(fed)])
      .toEqual(["Quantité retenue : 23 ml", "22,6 ml (ce métré : 10,2)"]);
  });

  it("is this takeoff's own for a line no other takeoff feeds", () => {
    const alone = row({ unit: "ml", reference: 20, measured: 22.4, deltaPercent: 12 });
    expect([getDecisionImpactText("keep_takeoff", alone), measuredQuantityLabel(alone)])
      .toEqual(["Quantité retenue : 23 ml (+12.0%)", "22,4 ml"]);
  });

  it("is in the review's export: the total the gap is judged on and the quantity retained", () => {
    const csv = buildRowsCsv([row({ unit: "ml", reference: 20, measured: 10.2, earlier: 12.4, deltaPercent: 13 })],
      { reliable_match: "", to_confirm: "", significant_gap: "Écart", unlinked: "", forced_manual: "" });
    const [header, line] = csv.split("\n").map((entry) => entry.split(","));
    const cell = (name: string) => line[header.indexOf(name)];
    expect([cell("quantite_takeoff"), cell("quantite_totale"), cell("quantite_retenue")]).toEqual(["\"10.2\"", "\"22.6\"", "\"23\""]);
  });

  it("is the reference a « keep DPGF » decision retains, a length rounded up once as written", () => {
    // Reference 22.5 ml above the total 20 (8 here, 12 kept): « Conserver DPGF » applies; the line is written 23.
    const above = row({ unit: "ml", reference: 22.5, measured: 8, earlier: 12, deltaPercent: -11.1 });
    expect([getDecisionImpactText("keep_dpgf", above), retainedRoundingNote(above)])
      .toEqual(["Quantité retenue : 23 ml", "Longueur arrondie une fois à l’unité supérieure (22,5 avant arrondi)."]);
  });

  it("rounds by the estimate line's own unit, as the application does: centimetres to the metre, and a unit set after the import", () => {
    expect(getDecisionImpactText("keep_takeoff", row({ unit: "cm", reference: 100, measured: 150.4, deltaPercent: 50.4 })))
      .toBe("Quantité retenue : 200 cm (+50.4%)");
    // The DPGF source gave no unit; the line's unit was set to ml since: the application rounds.
    expect(getDecisionImpactText("keep_takeoff", row({ unit: "ml", reference: 20, measured: 22.4, deltaPercent: 12, sourceUnit: null, lengthFactor: 1 })))
      .toBe("Quantité retenue : 23 ml (+12.0%)");
  });

  it("adds what the printed surfaces of the parts it keeps protect", () => {
    expect(getDecisionImpactText("keep_takeoff", row({ unit: "u", reference: 5, measured: 10, earlier: 12, earlierProtective: 3, deltaPercent: 340 })))
      .toBe("Quantité retenue : 25 u (+340.0%)");
  });

  it("is what the line keeps of the other takeoffs when this one does not feed it", () => {
    // Not linked (or not comparable): the line keeps the other takeoffs' 12 above its reference of 5.
    expect(getDecisionImpactText("keep_dpgf", row({ unit: "u", reference: 5, measured: null, earlier: 12, deltaPercent: 0 })))
      .toBe("Quantité retenue : 12 u");
    // Decided out of scope: this takeoff's 10 does not enter it (« Quantité proposée pour chiffrer »).
    expect(dpgfRowRetainedQuantity(row({ unit: "u", reference: 5, measured: 10, earlier: 12, deltaPercent: 340, outOfScope: true }))).toBe(12);
  });

  it("follows the decision being chosen, not the one saved", () => {
    // Saved out of scope; « Conserver métré » chosen now: once saved, the line is fed again and written 22.
    const outOfScope = row({ unit: "u", reference: 5, measured: 10, earlier: 12, deltaPercent: 340, outOfScope: true });
    expect(getDecisionImpactText("keep_takeoff", outOfScope)).toBe("Quantité retenue : 22 u (+340.0%)");
  });

  it("states the decimals the line is written with", () => {
    // 1.2004 km, rounded up once to the metre: 1.201 km.
    const kilometres = row({ unit: "km", reference: 1, measured: 1.2004, deltaPercent: 20, lengthFactor: 1000 });
    expect([getDecisionImpactText("keep_takeoff", kilometres), retainedRoundingNote(kilometres)])
      .toEqual(["Quantité retenue : 1,201 km (+20.0%)", "Longueur arrondie une fois à l’unité supérieure (1,2004 avant arrondi)."]);
  });

  it("exports the quantity retained as the database holds it, to four decimals", () => {
    const csv = buildRowsCsv([row({ unit: "u", reference: 5, measured: 0.2, earlier: 10.1, deltaPercent: 106 })],
      { reliable_match: "", to_confirm: "", significant_gap: "Écart", unlinked: "", forced_manual: "" });
    const [header, line] = csv.split("\n").map((entry) => entry.split(","));
    expect(line[header.indexOf("quantite_retenue")]).toBe("\"10.3\"");
  });
});
