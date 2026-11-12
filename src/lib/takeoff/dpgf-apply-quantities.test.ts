import { describe, expect, it } from "vitest";
import { buildDpgfApplyQuantityPolicy, dpgfTargetsFedAgain } from "@/lib/takeoff/dpgf-apply-quantities";
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

// TI-682 lot D: « Pages déjà au devis » reads which DPGF lines this takeoff feeds again with the very rule the
// application authorizes them by. Written after TKD03 showed the gap: a line linked by hand to a DPGF line it cannot be
// compared with (another material or diameter) was read as feeding it, so the step offered « replace » as complete,
// and the database refused it (dpgf_not_replaced), the application having fed nothing.
describe("the DPGF lines a takeoff feeds again", () => {
  const dpgf = "33333333-3333-4333-8333-333333333333";
  const comparable = "44444444-4444-4444-8444-444444444444";
  const other = "55555555-5555-4555-8555-555555555555";
  const input = (linked: string, decisions: unknown[] = []) => ({ versionId: "11111111-1111-4111-8111-111111111111",
    jobId: "22222222-2222-4222-8222-222222222222",
    dpgfLines: [{ estimate_item_id: dpgf, title: "Réseau de distribution sanitaire EF en tube cuivre DN 22, y compris raccords, supports et essais",
      description: null, quantity: 30, unit: "ml", source_page: 1, source_file_name: "dpgf-fictif.xlsx", position: 1 }],
    takeoffLines: [
      { item_id: comparable, designation: "EF cuivre DN 22", quantity: 30, unit: "ml", confidence: 0.95, source_page: 1, source_file_name: "plan-fictif.pdf", evidence: "Fictif", metadata: {} },
      { item_id: other, designation: "Calorifuge", quantity: 30, unit: "ml", confidence: 0.95, source_page: 1, source_file_name: "plan-fictif.pdf", evidence: "Fictif", metadata: {} }],
    manualLinks: [{ id: "66666666-6666-4666-8666-666666666666", estimate_item_id: dpgf, takeoff_item_id: linked }],
    reviewDecisions: decisions,
  }) as unknown as Parameters<typeof buildTakeoffDpgfComparison>[0];
  const context = (comparisonInput: Parameters<typeof buildTakeoffDpgfComparison>[0]) => ({ comparisonInput,
    estimateItems: [{ id: dpgf, updated_at: "2026-11-12T08:00:00Z", source_provider: "dpgf", source_metadata: {} }],
    takeoffItems: [comparable, other].map((id) => ({ id, quantity: 30, updated_at: "2026-11-12T08:01:00Z" })) }) as unknown as TakeoffDpgfComparisonContext;
  const fedTargets = (comparisonInput: Parameters<typeof buildTakeoffDpgfComparison>[0]) =>
    [...dpgfTargetsFedAgain(buildTakeoffDpgfComparison(comparisonInput).rows)].sort();
  const authorized = (comparisonInput: Parameters<typeof buildTakeoffDpgfComparison>[0]) =>
    buildDpgfApplyQuantityPolicy(context(comparisonInput), buildTakeoffDpgfComparison(comparisonInput).rows)
      .flatMap((line) => line.takeoff_items.map((item) => [item.id, line.target_id]));

  it("feeds a DPGF line from a line of the same quantity identity, as the application authorizes it", () => {
    expect(fedTargets(input(comparable))).toEqual([[comparable, dpgf]]);
    expect(authorized(input(comparable))).toEqual([[comparable, dpgf]]);
  });

  it("feeds nothing from a line linked by hand that measures something else", () => {
    expect(buildTakeoffDpgfComparison(input(other)).rows[0].linked_takeoff_items.map((item) => item.item_id)).toEqual([other]);
    expect(fedTargets(input(other))).toEqual([]);
    expect(authorized(input(other))).toEqual([]);
  });
});
