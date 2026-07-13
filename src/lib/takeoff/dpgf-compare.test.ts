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
const TAKEOFF_ITEM_ID_2 = "66666666-6666-4666-8666-666666666666";
const TAKEOFF_ITEM_ID_3 = "77777777-7777-4777-8777-777777777777";
const LINK_ID = "88888888-8888-4888-8888-888888888888";

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

  it("prioritizes manual multi-links and computes an aggregated quantity proof", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
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
          designation: "Cloison BA13 - zone A",
          quantity: 4,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.9,
          evidence: "Zone A",
          metadata: {},
        },
        {
          item_id: TAKEOFF_ITEM_ID_2,
          designation: "Cloison BA13 - zone B",
          quantity: 6,
          unit: "m2",
          source_page: 4,
          source_file_name: "plans.pdf",
          confidence: 0.88,
          evidence: "Zone B",
          metadata: {},
        },
      ],
      manualLinks: [
        {
          id: LINK_ID,
          tenant_id: "99999999-9999-4999-8999-999999999999",
          version_id: VERSION_ID,
          takeoff_job_id: JOB_ID,
          estimate_item_id: DPGF_ITEM_ID,
          takeoff_item_id: TAKEOFF_ITEM_ID,
          created_at: "2026-03-06T10:00:00.000Z",
          updated_at: "2026-03-06T10:00:00.000Z",
          linked_by: null,
        },
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          tenant_id: "99999999-9999-4999-8999-999999999999",
          version_id: VERSION_ID,
          takeoff_job_id: JOB_ID,
          estimate_item_id: DPGF_ITEM_ID,
          takeoff_item_id: TAKEOFF_ITEM_ID_2,
          created_at: "2026-03-06T10:00:00.000Z",
          updated_at: "2026-03-06T10:00:00.000Z",
          linked_by: null,
        },
      ],
    });

    expect(response.summary.forced_manual).toBe(1);
    expect(response.rows[0]).toMatchObject({
      review_status: "forced_manual",
      matched_by: "manual",
      manual_link_count: 2,
      takeoff_quantity: 10,
    });
    expect(response.rows[0]?.proofs.some((proof) => proof.type === "formula")).toBe(true);
  });

  it("keeps carried-over decisions visible in exceptions-only mode", () => {
    const response = buildTakeoffDpgfComparison({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      view: "exceptions_only",
      dpgfLines: [
        {
          estimate_item_id: DPGF_ITEM_ID,
          title: "Moquette",
          description: null,
          quantity: 5,
          unit: "m2",
          source_page: 2,
          source_file_name: "dpgf.xlsx",
          position: 1,
        },
        {
          estimate_item_id: DPGF_ITEM_ID_2,
          title: "Peinture",
          description: null,
          quantity: 20,
          unit: "m2",
          source_page: 3,
          source_file_name: "dpgf.xlsx",
          position: 2,
        },
      ],
      takeoffLines: [
        {
          item_id: TAKEOFF_ITEM_ID,
          designation: "Moquette",
          quantity: 5,
          unit: "m2",
          source_page: 6,
          source_file_name: "plans.pdf",
          confidence: 0.91,
          evidence: "Zone moquette",
          metadata: {},
        },
        {
          item_id: TAKEOFF_ITEM_ID_2,
          designation: "Peinture reserve",
          quantity: 2,
          unit: "u",
          source_page: 8,
          source_file_name: "plans.pdf",
          confidence: 0.5,
          evidence: "Reserve",
          metadata: {},
        },
        {
          item_id: TAKEOFF_ITEM_ID_3,
          designation: "Plinthe non affectee",
          quantity: 12,
          unit: "ml",
          source_page: 9,
          source_file_name: "plans.pdf",
          confidence: 0.62,
          evidence: "Plinthe couloir",
          metadata: {},
        },
      ],
      carriedReviewDecisions: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          tenant_id: "99999999-9999-4999-8999-999999999999",
          version_id: VERSION_ID,
          takeoff_job_id: JOB_ID,
          estimate_item_id: DPGF_ITEM_ID_2,
          decision: "keep_dpgf",
          reason: "Conserver la quantite du DPGF tant que la reserve n'est pas verifiee.",
          review_reference: "dpgf xlsx row 3",
          line_label: "Peinture",
          line_position: 2,
          source_file_name: "dpgf.xlsx",
          source_page: 3,
          decided_at: "2026-03-06T10:10:00.000Z",
          updated_at: "2026-03-06T10:10:00.000Z",
          decided_by: null,
          source: "carried_over",
          carried_over_from_version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          carried_over_from_version_number: 2,
        },
      ],
    });

    expect(response.view).toBe("exceptions_only");
    expect(response.rows).toHaveLength(1);
    expect(response.manual_link_candidates).toHaveLength(3);
    expect(response.rows[0]?.applied_decision).toMatchObject({
      decision: "keep_dpgf",
      source: "carried_over",
      carried_over_from_version_number: 2,
    });
    expect(response.unused_takeoff_items).toHaveLength(2);
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
            reason: "Quantite DPGF confirmee",
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
