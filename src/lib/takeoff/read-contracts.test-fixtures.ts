import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";
import type { TakeoffDpgfReviewDecisionRecord, TakeoffLineEvidencePanelResponse } from "@/lib/takeoff/types";

export const JOB_ID = "a1111111-1111-4111-8111-111111111111";
export const VERSION_ID = "b2222222-2222-4222-8222-222222222222";
export const LINE_ID = "c3333333-3333-4333-8333-333333333333";
export const OTHER_ID = "d4444444-4444-4444-8444-444444444444";
export const EVIDENCE_ID = "e5555555-5555-4555-8555-555555555555";
export const NOW = "2026-10-28T10:00:00.123456+00:00";
export const IDENTITY = { jobId: JOB_ID, versionId: VERSION_ID, lineId: LINE_ID };

export function comparisonFixture() {
  return buildTakeoffDpgfComparison({
    jobId: JOB_ID, versionId: VERSION_ID,
    dpgfLines: [{
      estimate_item_id: LINE_ID, title: "Tube cuivre", description: null, quantity: 12.5, unit: "m",
      source_page: null, source_file_name: "DPGF.xlsx", position: 0,
    }],
    takeoffLines: [{
      item_id: OTHER_ID, designation: "Tube cuivre", quantity: 12.5, unit: "m", source_page: 1,
      source_file_name: "plans.pdf", confidence: 0.9, evidence: "Tracé repéré en zone A",
      metadata: { source: { plan_zone: "A", calculation: [10, 2.5] } },
    }],
  });
}

export function decisionFixture(): TakeoffDpgfReviewDecisionRecord {
  return {
    id: EVIDENCE_ID, tenant_id: OTHER_ID, version_id: VERSION_ID, takeoff_job_id: JOB_ID, estimate_item_id: LINE_ID,
    decision: "keep_dpgf", reason: "Quantité contrôlée", review_reference: "dpgf.xlsx|0|tube cuivre|m",
    line_label: "Tube cuivre", line_position: 0, source_file_name: "DPGF.xlsx", source_page: null,
    decided_at: NOW, updated_at: NOW, decided_by: null, source: "current_version",
    carried_over_from_version_id: null, carried_over_from_version_number: null,
  };
}

export function evidencePanelFixture(): TakeoffLineEvidencePanelResponse {
  const oldEvidence = {
    evidence_id: OTHER_ID, type: "comment" as const, kind: "hypothesis" as const, label: "Commentaire de revue",
    source: "Revue DPGF", source_file_name: null, source_page: null, confidence_score: null,
    note: "Ancienne hypothèse", created_at: NOW, author_name: null, status: "replaced" as const,
    supersedes_evidence_id: null, replaced_by_evidence_id: EVIDENCE_ID,
  };
  return {
    job_id: JOB_ID, version_id: VERSION_ID, line_id: LINE_ID,
    evidences: [{
      ...oldEvidence, evidence_id: EVIDENCE_ID, status: "active", supersedes_evidence_id: OTHER_ID,
      replaced_by_evidence_id: null, note: "Hypothèse mise à jour", author_name: "Opérateur test",
    }],
    history: [oldEvidence],
  };
}
