import type { TakeoffJobItem, TakeoffJobSummary, TakeoffRiskAlert } from "@/lib/takeoff/types";
export { JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, EVIDENCE_ID, NOW } from "@/lib/takeoff/read-contracts.test-fixtures";
import { JOB_ID, VERSION_ID, LINE_ID, OTHER_ID, EVIDENCE_ID, NOW } from "@/lib/takeoff/read-contracts.test-fixtures";

export const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
export const LOT_ID = "22222222-2222-4222-8222-222222222222";
export const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

export function takeoffItemFixture(patch: Partial<TakeoffJobItem> = {}): TakeoffJobItem {
  return {
    id: OTHER_ID, designation: "Tube cuivre", quantity: 12.5, unit: "m", confidence: 0.9,
    evidence: "Zone A", source_file_name: "plans.pdf", source_page: 1, metadata: { zone: "A" },
    is_excluded: false, exclusion_reason: null, is_verified: false, verified_at: null, verified_by: null,
    created_at: NOW, updated_at: NOW, ...patch,
  };
}

export function appliedJobFixture(): TakeoffJobSummary {
  return {
    id: JOB_ID, estimate_version_id: VERSION_ID, status: "applied", level: "A", processing_strategy: null,
    provider_batch_id: null, provider_batch_state: null, provider_batch_updated_at: null,
    source_file_name: "plans.pdf", source_file_type: "application/pdf", source_file_size_bytes: 1200,
    plan_set_id: null, prompt_version: "v1", schema_version: "v1", model: "provider", thinking_level: null,
    media_resolution: null, retry_count: 0, error_code: null, error_message: null, next_retry_at: null, last_error_at: null,
    started_at: NOW, completed_at: NOW, created_at: NOW, updated_at: NOW, items_count: 1,
    metrics: { token_count: 100, cost_cents: 2, duration_ms: 1000 },
  };
}

export function riskAlertFixture(patch: Partial<TakeoffRiskAlert> = {}): TakeoffRiskAlert {
  return {
    alert_id: EVIDENCE_ID, takeoff_job_id: JOB_ID, scope_type: "line", scope_id: LINE_ID,
    scope_label: "Tube cuivre", line_id: LINE_ID, lot_id: LOT_ID, cause_code: "missing_proof", cause_label: "Preuve manquante",
    severity: "warning", risk_score: 40, status: "to_process", margin_bucket: "unknown", reason_labels: ["Plan incomplet"],
    provenance: [{ kind: "fact", label: "Plan", source: "plans.pdf", confidence_score: 0.8, note: null }],
    review_note: null, reviewed_at: null, reviewed_by: null, created_at: NOW, updated_at: NOW, metadata: { zone: "A" }, ...patch,
  };
}
