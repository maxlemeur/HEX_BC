import { describe, expect, it } from "vitest";
import { buildDpgfApplyQuantityPolicy } from "@/lib/takeoff/dpgf-apply-quantities";
import type { TakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";

describe("TI-680 immutable apply snapshot", () => {
  it("binds the maximum to the original target and every measured source revision", () => {
    const comparisonInput = { versionId: "11111111-1111-4111-8111-111111111111", jobId: "22222222-2222-4222-8222-222222222222",
      dpgfLines: [{ estimate_item_id: "33333333-3333-4333-8333-333333333333", title: "EF cuivre DN 22", description: null,
        quantity: 3000, unit: "ml", source_page: 1, source_file_name: "dpgf-fictif.xlsx", position: 1 }],
      takeoffLines: [{ item_id: "44444444-4444-4444-8444-444444444444", designation: "EF cuivre DN 22", quantity: 2980,
        unit: "ml", confidence: 0.99, source_page: 1, source_file_name: "plan-fictif.pdf", evidence: "Fictif", metadata: {} }] };
    const context = { comparisonInput, estimateItems: [{ id: comparisonInput.dpgfLines[0].estimate_item_id,
      updated_at: "2026-11-08T12:00:00Z", source_provider: "dpgf", source_metadata: { dpgf_source_quantity: 3000, dpgf_source_unit: "ml" } }],
      takeoffItems: [{ id: comparisonInput.takeoffLines[0].item_id, quantity: 2980, updated_at: "2026-11-08T12:01:00Z" }] } as unknown as TakeoffDpgfComparisonContext;
    const rows = buildTakeoffDpgfComparison(comparisonInput).rows;
    expect(buildDpgfApplyQuantityPolicy(context, rows)).toEqual([expect.objectContaining({
      target_id: comparisonInput.dpgfLines[0].estimate_item_id, expected_updated_at: "2026-11-08T12:00:00Z",
      reference_quantity: 3000, measured_quantity: 2980, priced_quantity: 3000,
      takeoff_items: [{ id: comparisonInput.takeoffLines[0].item_id, quantity: 2980, updated_at: "2026-11-08T12:01:00Z" }],
    })]);
    const wrongDiameter = { ...rows[0], linked_takeoff_items: rows[0].linked_takeoff_items.map(item => ({ ...item, designation: "EF cuivre DN 28" })) };
    expect(() => buildDpgfApplyQuantityPolicy(context, [wrongDiameter])).toThrow(/comparables/);
  });
});
