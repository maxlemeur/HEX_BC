import { describe, expect, it } from "vitest";

import {
  buildTakeoffDpgfComparison,
  buildTakeoffDpgfComparisonSummary,
  hasBlockingTakeoffDpgfExceptions,
} from "@/lib/takeoff/dpgf-compare";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const DPGF_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const DPGF_ITEM_ID_2 = "44444444-4444-4444-8444-444444444444";
const TAKEOFF_ITEM_ID = "55555555-5555-4555-8555-555555555555";

describe("buildTakeoffDpgfComparison", () => {
  it("marks a significant gap when quantities diverge despite an auto match", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      threshold: 0.6,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Faux plafond acoustique",
          description: null,
          quantity: 100,
          unit: "m2",
          source_page: 12,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Faux plafond acoustique",
          quantity: 72,
          unit: "m2",
          source_page: 5,
          source_file_name: "plans.pdf",
          confidence: 0.92,
          evidence: "Zone plafonds",
          metadata: {},
        },
      ],
    });

    expect(response.summary).toMatchObject({
      significant_gaps: 1,
      total_lines: 1,
      unused_takeoff_items: 0,
    });
    expect(response.manual_link_candidates).toHaveLength(1);
    expect(response.rows[0]).toMatchObject({
      review_status: "significant_gap",
      matched_by: "auto",
      delta_absolute: 28,
      delta_percent: 28,
    });
    expect(response.rows[0]?.proofs.some((proof) => proof.kind === "fact")).toBe(true);
  });

  it("attribue l'item de metre a la ligne DPGF la mieux notee, pas a la premiere lue", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      threshold: 0.6,
      dpgfLines: [
        {
          // Ligne generique, lue en premier : capturait l'item avec l'ancien
          // rapprochement glouton.
          estimate_item_id: DPGF_ITEM_ID,
          title: "Cloison BA13",
          description: null,
          quantity: 10,
          unit: "m2",
          source_page: 1,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
        {
          // Correspondance exacte, lue ensuite : doit remporter l'item.
          estimate_item_id: DPGF_ITEM_ID_2,
          title: "Cloison BA13 ep.72mm",
          description: null,
          quantity: 10,
          unit: "m2",
          source_page: 1,
          source_file_name: "dpgf.xlsx",
          position: 2,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Cloison BA13 ep.72mm",
          quantity: 10,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.9,
          evidence: "Zone cloisons",
          metadata: {},
        },
      ],
    });

    const genericRow = response.rows.find((row) => row.line_id === DPGF_ITEM_ID);
    const exactRow = response.rows.find((row) => row.line_id === DPGF_ITEM_ID_2);

    expect(exactRow?.matched_by).toBe("auto");
    expect(exactRow?.linked_takeoff_items).toHaveLength(1);
    expect(genericRow?.linked_takeoff_items).toHaveLength(0);
    expect(response.summary.unused_takeoff_items).toBe(0);

    // Garde-fou du garde-fou : seule, la ligne generique capte bien l'item.
    // Cela prouve que son score depasse le seuil et qu'elle etait donc en
    // concurrence reelle — sans quoi le test ci-dessus ne prouverait rien de
    // l'ancien comportement glouton.
    const genericAlone = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      threshold: 0.6,
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Cloison BA13",
          description: null,
          quantity: 10,
          unit: "m2",
          source_page: 1,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Cloison BA13 ep.72mm",
          quantity: 10,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.9,
          evidence: "Zone cloisons",
          metadata: {},
        },
      ],
    });
    expect(genericAlone.rows[0]?.linked_takeoff_items).toHaveLength(1);
  });
});

describe("hasBlockingTakeoffDpgfExceptions", () => {
  const baseSummary = {
    reliable_matches: 0,
    to_confirm: 0,
    significant_gaps: 0,
    forced_manual: 0,
    lines_without_proof: 0,
    unused_takeoff_items: 0,
    total_lines: 0,
  };

  it("does not block orphan takeoff items when the target has no DPGF lines", () => {
    expect(
      hasBlockingTakeoffDpgfExceptions({
        ...baseSummary,
        unused_takeoff_items: 6,
      })
    ).toBe(false);
  });

  it("keeps orphan takeoff items blocking when DPGF target lines exist", () => {
    expect(
      hasBlockingTakeoffDpgfExceptions({
        ...baseSummary,
        total_lines: 3,
        unused_takeoff_items: 1,
      })
    ).toBe(true);
  });

  it("blocks unresolved confirmations and significant gaps", () => {
    expect(
      hasBlockingTakeoffDpgfExceptions({
        ...baseSummary,
        total_lines: 2,
        to_confirm: 1,
      })
    ).toBe(true);
    expect(
      hasBlockingTakeoffDpgfExceptions({
        ...baseSummary,
        total_lines: 2,
        significant_gaps: 1,
      })
    ).toBe(true);
  });

  it("does not count a recorded manual decision as unresolved", () => {
    const summary = buildTakeoffDpgfComparisonSummary({
      rows: [
        {
          review_status: "forced_manual",
          proofs: [{ type: "dpgf", label: "DPGF", value: "10 m2" }],
          applied_decision: {
            decision: "keep_dpgf",
            reason: "Quantité DPGF confirmee",
            source: "current",
            carried_over_from_version_id: null,
            carried_over_from_version_number: null,
          },
        } as never,
      ],
      unusedTakeoffItems: [],
    });

    expect(summary.forced_manual).toBe(0);
    expect(summary.lines_without_proof).toBe(0);
    expect(hasBlockingTakeoffDpgfExceptions(summary)).toBe(false);
  });
});
