import { describe, expect, it } from "vitest";

import { normalizeDpgfComparisonEstimateItems, type TakeoffDpgfEstimateItem } from "@/lib/takeoff/dpgf-comparison-preparation";

// TI-696 (re-check of the Codex fix on PR 288): the application rounds a DPGF line's length with the line's own unit
// (finalize_takeoff_lengths, private.takeoff_compose_dpgf_targets: unit_code, else description), which may differ from the
// DPGF source unit once the line's unit is set after the import. The reconciliation carries that factor so that the
// quantity it states is the one written. Fictional identifiers.

const line = (n: number, extra: Partial<TakeoffDpgfEstimateItem>): TakeoffDpgfEstimateItem => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, version_id: "00000000-0000-4000-8000-000000000099", position: n,
  title: `Ligne ${n}`, description: null, quantity: 20, source_file_name: "dpgf.xlsx", source_page: n, source_provider: "dpgf",
  item_type: "line", updated_at: "2026-11-12T10:00:00Z", source_metadata: { dpgf_source_quantity: 20, dpgf_source_unit: null }, ...extra,
});

describe("the length factor of a DPGF line", () => {
  it("is read from the line's own unit, not the DPGF source unit", () => {
    const [setAfter, count, byDescription, centimetres] = normalizeDpgfComparisonEstimateItems({
      rows: [line(1, { unit_code: "ml" }), line(2, { unit_code: "u", source_metadata: { dpgf_source_quantity: 20, dpgf_source_unit: "ml" } }),
        line(3, { unit_code: null, description: "ml" }), line(4, { unit_code: "cm" })],
      legacyUnits: new Map(), mappedFacts: new Map() });
    expect([setAfter.unit, setAfter.length_factor, count.unit, count.length_factor, byDescription.length_factor, centimetres.length_factor])
      .toEqual([null, 1, "ml", null, 1, 0.01]);
  });
});
