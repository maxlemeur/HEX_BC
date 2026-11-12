import { describe, expect, it } from "vitest";

import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

import { buildRowsCsv, getDecisionImpactText, measuredQuantityLabel } from "./utils";

// TI-696 (Codex review of PR 288): a DPGF line other takeoffs feed holds their sum. Every figure the review states for
// it reads that sum, as the proposal and the application do: the quantity a person approves is the quantity written
// (the protective maximum on the total, a length rounded up once on it, as finalize_takeoff_lengths rounds it).
// Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function row(input: { unit: string; reference: number; measured: number; earlier?: number; deltaPercent: number }): TakeoffDpgfComparisonRow {
  const total = Number((input.measured + (input.earlier ?? 0)).toFixed(4));
  return {
    line_id: id(1), line_label: "Ligne fictive",
    dpgf: { estimate_item_id: id(1), title: "Ligne fictive", description: null, quantity: input.reference, unit: input.unit,
      source_page: 1, source_file_name: "dpgf.xlsx", position: 1 },
    linked_takeoff_items: [{ item_id: id(2), designation: "Ligne fictive", quantity: input.measured, unit: input.unit, source_page: 2,
      source_file_name: "plan.pdf", confidence: 0.95, evidence: "Repère fictif", metadata: {} }],
    dpgf_quantity: input.reference, takeoff_quantity: input.measured, quantity_unit: input.unit, matching_score: 0.9, confidence_score: 0.9,
    review_status: "significant_gap", proofs: [], suggested_decision: null, applied_decision: null,
    delta_absolute: Math.abs(total - input.reference), delta_percent: input.deltaPercent, is_exception: true, manual_link_count: 0,
    matched_by: "auto", risk: null,
    ...(input.earlier === undefined ? {} : { composition: {
      earlier: [{ job_id: id(9), job_created_at: "2026-11-10T09:00:00Z", job_level: "B", quantity: input.earlier, read_again: false,
        pages: [{ source_file_name: "plan.pdf", source_page: 1, quantity: input.earlier }] }],
      earlier_quantity: input.earlier, earlier_protective: 0, earlier_printed_gap: 0, total_quantity: total, double_counted: [] } }),
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
});
