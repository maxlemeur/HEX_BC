import { describe, expect, it } from "vitest";

import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";
import { dpgfQuantityPolicy } from "@/lib/takeoff/dpgf-quantity-policy";
import type { TakeoffDpgfComparisonRow } from "@/lib/takeoff/types";

const versionId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";

function comparison(measurements: number[], designation = "EF cuivre DN 22") {
  return buildTakeoffDpgfComparison({ versionId, jobId, threshold: 0.6,
    dpgfLines: [{ estimate_item_id: lineId, title: "EF cuivre DN 22", description: null, quantity: 3000,
      unit: "ml", source_page: 1, source_file_name: "dpgf-fictif.xlsx", position: 1 }],
    takeoffLines: measurements.map((quantity, index) => ({ item_id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
      designation, quantity, unit: "ml", confidence: 0.99, source_page: index + 1, source_file_name: "plan-fictif.pdf",
      evidence: "Mesure fictive", metadata: {} })),
  });
}

describe("TI-680 DPGF quantity comparison", () => {
  function surface(measured: number, printed: number, room = "Local sol net"): TakeoffDpgfComparisonRow["linked_takeoff_items"][number] {
    return { item_id: room, designation: "Revêtement de sol", unit: "m2", quantity: measured,
      source_file_name: "fictif.pdf", source_page: 1, confidence: 0.99, evidence: "Fictif",
      metadata: { rule_inputs: { version: 1, source: "vector", kind: "surface",
        model_quantity: measured, room, printed_m2: printed, network: null, material: null, dn: null, non_observable: null } } };
  }

  it("keeps a known protective printed quantity when the DPGF reference is empty", () => {
    expect(dpgfQuantityPolicy({ dpgf_quantity: null, takeoff_quantity: 19.85,
      linked_takeoff_items: [surface(19.85, 20)] })).toMatchObject({ reference: null,
      measured: 19.85, priced: 20, absoluteGap: null, percentGap: null });
  });

  it("retains known sub-pair gaps and maxima even when another source has no comparable printed basis", () => {
    expect(dpgfQuantityPolicy({ dpgf_quantity: 1000, takeoff_quantity: 1000,
      linked_takeoff_items: [surface(60, 50), surface(40, 50), surface(900, 900, "Local")] }))
      .toMatchObject({ priced: 1010, absoluteGap: 20, percentGap: 2, requiresReview: true });
  });

  it("suggests the higher reference when the takeoff is smaller", () => {
    expect(comparison([2980]).rows[0]).toMatchObject({ dpgf_quantity: 3000, takeoff_quantity: 2980,
      suggested_decision: "keep_dpgf", review_status: "reliable_match" });
  });
  it("aggregates several exact homogeneous matches before checking 1%", () => {
    expect(comparison([1500, 1520]).rows[0]).toMatchObject({ takeoff_quantity: 3020,
      suggested_decision: "keep_takeoff", review_status: "reliable_match" });
    expect(comparison([1500, 1560]).rows[0]).toMatchObject({ takeoff_quantity: 3060, review_status: "significant_gap" });
  });
  it("never auto-matches another diameter or material despite a similar designation", () => {
    expect(comparison([3000], "EF cuivre DN 28").rows[0].linked_takeoff_items).toHaveLength(0);
    expect(comparison([3000], "EF inox 316L DN 22").rows[0].linked_takeoff_items).toHaveLength(0);
  });
  it("respects a SHAB basis explicitly requested in the DPGF description", () => {
    const result = buildTakeoffDpgfComparison({ versionId, jobId,
      dpgfLines: [{ estimate_item_id: lineId, title: "Revêtement de sol", description: "Quantité calculée sur la SHAB",
        quantity: 20, unit: "m2", source_page: 1, source_file_name: "fictif.xlsx", position: 1 }],
      takeoffLines: [{ item_id: "44444444-4444-4444-8444-444444444444", designation: "Revêtement de sol", quantity: 20,
        unit: "m2", confidence: 0.99, source_page: 1, source_file_name: "fictif.pdf", evidence: "Fictif", metadata: {} }] });
    expect(result.rows[0].linked_takeoff_items).toHaveLength(0);
  });
  it("checks the strict boundary before display rounding", () => {
    expect(comparison([3030]).rows[0].review_status).toBe("reliable_match");
    expect(comparison([3030.001]).rows[0].review_status).toBe("significant_gap");
  });
  it("measures a documentary DPGF with an explicitly empty quantity without fabricating a reference or confirming it", () => {
    const input = { versionId, jobId, dpgfLines: [{ estimate_item_id: lineId, title: "EF cuivre DN 22", description: null,
      quantity: null, unit: "ml", source_page: 1, source_file_name: "fictif.xlsx", position: 1 }],
      takeoffLines: [{ item_id: "44444444-4444-4444-8444-444444444444", designation: "EF cuivre DN 22", quantity: 3000,
        unit: "ml", confidence: 0.99, evidence: "Fictif", source_page: 1, source_file_name: "fictif.pdf", metadata: {} }] };
    expect(buildTakeoffDpgfComparison(input).rows[0]).toMatchObject({ dpgf_quantity: null, takeoff_quantity: 3000,
      delta_percent: null, review_status: "to_confirm", is_exception: true, suggested_decision: null });
  });
});
