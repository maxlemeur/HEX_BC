import { describe, expect, it } from "vitest";

import {
  buildTakeoffRiskCandidates,
  buildTakeoffRiskRadarResponse,
  buildTakeoffRowRiskMap,
  normalizeRiskAlertRow,
} from "@/lib/takeoff/risk-radar";
import type { TakeoffDpgfComparisonRow, TakeoffRiskAlert } from "@/lib/takeoff/types";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const LOT_ID = "44444444-4444-4444-8444-444444444444";
const LINE_ID = "55555555-5555-4555-8555-555555555555";

function makeRow(overrides: Partial<TakeoffDpgfComparisonRow> = {}): TakeoffDpgfComparisonRow {
  return {
    line_id: LINE_ID,
    line_label: "Doublage acoustique",
    dpgf: {
      estimate_item_id: LINE_ID,
      title: "Doublage acoustique",
      description: "Cloison type 72/48",
      quantity: 100,
      unit: "m2",
      source_page: 12,
      source_file_name: "dpgf.xlsx",
      position: 10,
    },
    linked_takeoff_items: [
      {
        item_id: "66666666-6666-4666-8666-666666666666",
        designation: "Cloison doublage",
        quantity: 130,
        unit: "m2",
        source_page: 4,
        source_file_name: "plan-a.pdf",
        confidence: 0.81,
        evidence: "Zone A-12",
        metadata: {},
      },
    ],
    dpgf_quantity: 100,
    takeoff_quantity: 130,
    quantity_unit: "m2",
    matching_score: 0.91,
    confidence_score: 0.82,
    review_status: "significant_gap",
    proofs: [
      {
        proof_id: "dpgf:1",
        type: "dpgf",
        kind: "fact",
        label: "Doublage acoustique",
        source: "DPGF dpgf.xlsx",
        confidence_score: null,
        note: "Ligne source 12",
      },
      {
        proof_id: "takeoff:1",
        type: "takeoff",
        kind: "fact",
        label: "Cloison doublage",
        source: "plan-a.pdf p.4",
        confidence_score: 0.81,
        note: "Zone A-12",
      },
      {
        proof_id: "price:1",
        type: "price_source",
        kind: "fact",
        label: "Prix fournisseur",
        source: "Tarif 2026",
        confidence_score: 0.74,
        note: "Prix selectionne",
      },
    ],
    suggested_decision: "keep_dpgf",
    applied_decision: null,
    delta_absolute: 30,
    delta_percent: 30,
    is_exception: true,
    manual_link_count: 0,
    matched_by: "auto",
    risk: null,
    ...overrides,
  };
}

describe("takeoff risk radar", () => {
  it("builds explicit line and project candidates from current signals", () => {
    const { candidates, lotLabelById } = buildTakeoffRiskCandidates({
      comparisonRows: [
        makeRow(),
        makeRow({
          line_id: "77777777-7777-4777-8777-777777777777",
          dpgf: {
            estimate_item_id: "77777777-7777-4777-8777-777777777777",
            title: "Peinture satin",
            description: null,
            quantity: 20,
            unit: "m2",
            source_page: 18,
            source_file_name: "dpgf.xlsx",
            position: 20,
          },
          line_label: "Peinture satin",
          proofs: [
            {
              proof_id: "dpgf:2",
              type: "dpgf",
              kind: "fact",
              label: "Peinture satin",
              source: "DPGF dpgf.xlsx",
              confidence_score: null,
              note: null,
            },
          ],
          linked_takeoff_items: [],
          dpgf_quantity: 20,
          takeoff_quantity: null,
          delta_absolute: null,
          delta_percent: null,
          review_status: "unlinked",
          quantity_unit: "m2",
        }),
      ],
      estimateItems: [
        {
          id: LOT_ID,
          parent_id: null,
          item_type: "section",
          title: "Lot Cloisons",
          tax_rate_bp: null,
        },
        {
          id: LINE_ID,
          parent_id: LOT_ID,
          item_type: "line",
          title: "Doublage acoustique",
          tax_rate_bp: 550,
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          parent_id: LOT_ID,
          item_type: "line",
          title: "Peinture satin",
          tax_rate_bp: 2000,
        },
      ],
      projectId: PROJECT_ID,
      projectLabel: "College Jules Ferry",
      qualityFlagsByItemId: {
        [LINE_ID]: ["price_outlier", "supplier_price_outdated"],
      },
      versionTaxRateBp: 2000,
      marginThresholdBp: 1000,
      versionMarginBp: 650,
      missingPieces: [
        {
          code: "missing_plans",
          label: "Plans manquants",
          severity: "critical",
        },
      ],
    });

    expect(lotLabelById.get(LOT_ID)).toBe("Lot Cloisons");
    expect(candidates.map((candidate) => candidate.cause_code)).toEqual(
      expect.arrayContaining([
        "dpgf_takeoff_gap",
        "atypical_price",
        "vat_inconsistency",
        "missing_proof",
        "insufficient_margin",
        "missing_piece",
      ])
    );
    expect(
      candidates.find((candidate) => candidate.cause_code === "atypical_price")
        ?.reason_labels
    ).toEqual(["Prix atypique", "Prix fournisseur obsolète"]);
    expect(
      candidates.find((candidate) => candidate.cause_code === "missing_piece")
        ?.provenance[0]?.kind
    ).toBe("inference");
  });

  it("aggregates open alerts into line, lot and project scores", () => {
    const alerts: TakeoffRiskAlert[] = [
      {
        alert_id: "a1",
        scope_type: "line",
        scope_id: LINE_ID,
        scope_label: "Doublage acoustique",
        line_id: LINE_ID,
        lot_id: LOT_ID,
        cause_code: "missing_proof",
        cause_label: "Preuve absente",
        severity: "warning",
        risk_score: 40,
        status: "to_process",
        margin_bucket: "thin",
        reason_labels: ["Aucune preuve active hors DPGF sur la ligne."],
        provenance: [],
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        created_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        metadata: {},
      },
      {
        alert_id: "a2",
        scope_type: "line",
        scope_id: LINE_ID,
        scope_label: "Doublage acoustique",
        line_id: LINE_ID,
        lot_id: LOT_ID,
        cause_code: "dpgf_takeoff_gap",
        cause_label: "Ecart DPGF / metre",
        severity: "warning",
        risk_score: 35,
        status: "to_process",
        margin_bucket: "thin",
        reason_labels: ["Ecart de 30.0% entre la quantite DPGF et le metre."],
        provenance: [],
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        created_at: "2026-03-06T10:01:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        metadata: {},
      },
      {
        alert_id: "a3",
        scope_type: "project",
        scope_id: PROJECT_ID,
        scope_label: "College Jules Ferry",
        line_id: null,
        lot_id: null,
        cause_code: "missing_piece",
        cause_label: "Piece manquante",
        severity: "warning",
        risk_score: 30,
        status: "assumed",
        margin_bucket: "thin",
        reason_labels: ["Plans manquants"],
        provenance: [],
        review_note: "Le lot ne depend pas des plans manquants.",
        reviewed_at: "2026-03-06T10:05:00.000Z",
        reviewed_by: "99999999-9999-4999-8999-999999999999",
        created_at: "2026-03-06T10:02:00.000Z",
        updated_at: "2026-03-06T10:05:00.000Z",
        metadata: {},
      },
    ];

    const lineRiskByLineId = buildTakeoffRowRiskMap(alerts);
    expect(lineRiskByLineId.get(LINE_ID)).toEqual({
      score: 75,
      severity: "critical",
      causes: [
        "Aucune preuve active hors DPGF sur la ligne.",
        "Ecart de 30.0% entre la quantite DPGF et le metre.",
      ],
      status: "to_process",
    });

    const response = buildTakeoffRiskRadarResponse({
      versionId: VERSION_ID,
      jobId: JOB_ID,
      alerts,
      projectId: PROJECT_ID,
      projectLabel: "College Jules Ferry",
      lotLabelById: new Map([
        [null, "Sans lot"],
        [LOT_ID, "Lot Cloisons"],
      ]),
    });

    expect(response.summary.project_score).toBe(75);
    expect(response.summary.project_severity).toBe("critical");
    expect(response.project.score).toBe(75);
    expect(response.lots).toEqual([
      expect.objectContaining({
        scope_id: LOT_ID,
        scope_label: "Lot Cloisons",
        score: 75,
        severity: "critical",
      }),
    ]);
    expect(response.items[0]?.status).toBe("to_process");
  });

  it("preserves the database takeoff job id on normalized alerts", () => {
    const alert = normalizeRiskAlertRow({
      id: "a1",
      takeoff_job_id: JOB_ID,
      scope_type: "line",
      scope_id: LINE_ID,
      scope_label: "Doublage acoustique",
      line_id: LINE_ID,
      lot_id: LOT_ID,
      cause_code: "missing_proof",
      severity: "warning",
      status: "to_process",
      risk_score: 40,
      margin_bucket: "thin",
      reason_labels: [],
      provenance: [],
      review_note: null,
      reviewed_at: null,
      reviewed_by: null,
      created_at: "2026-03-06T10:00:00.000Z",
      updated_at: "2026-03-06T10:00:00.000Z",
      metadata: {},
    });

    expect(alert?.takeoff_job_id).toBe(JOB_ID);
  });
});
