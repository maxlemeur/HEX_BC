import { z } from "zod";

import {
  TakeoffExchangeSchema,
  TakeoffItemSchema,
  TakeoffMappingRuleSchema,
  TakeoffMetadataSchema,
  TakeoffTableSchema,
  TakeoffWarningSchema,
  takeoffApplyRequestSchema,
  takeoffMappingOverrideActionSchema,
  takeoffMappingOverrideSchema,
  takeoffMappingPreviewItemSchema,
  createTakeoffMappingRuleSchema,
  takeoffMappingRuleActionConfigSchema,
  takeoffMappingRuleActionSchema,
  takeoffMappingRuleMatchTypeSchema,
  takeoffPreviewConversionResponseSchema,
  updateTakeoffMappingRuleSchema,
} from "@/lib/takeoff/schemas";

export const TAKEOFF_LEVELS = ["A", "B", "C"] as const;
export type TakeoffLevel = (typeof TAKEOFF_LEVELS)[number];

export const TAKEOFF_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "canceled",
  "applied",
] as const;
export type TakeoffJobStatus = (typeof TAKEOFF_JOB_STATUSES)[number];
export const TAKEOFF_JOB_LIST_PERIODS = ["7d", "30d", "90d"] as const;
export type TakeoffJobListPeriod = (typeof TAKEOFF_JOB_LIST_PERIODS)[number];

export const TAKEOFF_APPLY_STRATEGIES = ["append", "replace", "merge"] as const;
export type TakeoffApplyStrategy = (typeof TAKEOFF_APPLY_STRATEGIES)[number];

export const TAKEOFF_APPLY_SCOPES = ["section", "version"] as const;
export type TakeoffApplyScope = (typeof TAKEOFF_APPLY_SCOPES)[number];

export type TakeoffApplyRequest = z.infer<typeof takeoffApplyRequestSchema>;

export type TakeoffJobCreateInput = {
  estimateVersionId: string;
  level: "A";
  file: File;
  idempotencyKey?: string;
  onUploadProgress?: (progressPercent: number) => void;
  signal?: AbortSignal;
};

export type TakeoffJobResponse = {
  id: string;
  status: TakeoffJobStatus | string;
  level: TakeoffLevel | string;
  source_file_name: string | null;
  estimate_version_id: string;
  created_at: string;
};

export type TakeoffJobMetrics = {
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
};

export type TakeoffJobSummary = {
  id: string;
  estimate_version_id: string;
  status: TakeoffJobStatus | string;
  level: TakeoffLevel | string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number;
  error_code: string | null;
  error_message: string | null;
  next_retry_at: string | null;
  last_error_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  items_count?: number | null;
  version_number?: number | null;
  metrics: TakeoffJobMetrics;
};

export type TakeoffLinkedJobSummary = {
  id: string;
  estimate_version_id: string;
  status: TakeoffJobStatus | string;
  level: TakeoffLevel | string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  created_at: string;
  updated_at: string;
  linked_from_version_id: string | null;
  linked_from_version_number: number | null;
  is_linked: boolean;
};

export type TakeoffJobStatusCounters = {
  total: number;
  processing: number;
  completed: number;
  failed: number;
  canceled: number;
};

export type TakeoffJobListQuery = {
  estimate_version_id?: string;
  project_id?: string;
  status?: TakeoffJobStatus;
  level?: TakeoffLevel;
  period?: TakeoffJobListPeriod;
  limit?: number;
  offset?: number;
};

export type TakeoffApplySummary = {
  scope: TakeoffApplyScope;
  created_count: number;
  updated_count: number;
  ignored_count: number;
  created_ids: string[];
};

export type TakeoffJobListResponse = {
  jobs: TakeoffJobSummary[];
  counters: TakeoffJobStatusCounters;
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
};

export type TakeoffJobResult = {
  id: string;
  extracted_json: unknown;
  warnings: unknown[];
  tables: unknown[];
  provider_meta: Record<string, unknown>;
  raw_response: unknown;
  confidence: number | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  created_at: string;
  updated_at: string;
};

export type TakeoffRunMetric = {
  id: string;
  created_at: string;
  tenant_id: string;
  job_id: string;
  result_id: string | null;
  level: TakeoffLevel | string;
  provider: string;
  model: string;
  chunk_index: number;
  chunk_start_page: number;
  chunk_end_page: number;
  input_tokens: number;
  reasoning_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_cents: number;
  duration_ms: number;
  timed_out: boolean;
  budget_exceeded: boolean;
  metadata: Record<string, unknown>;
};

export type TakeoffJobItem = {
  id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
  is_excluded: boolean;
  exclusion_reason: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TakeoffItemPatchField = {
  designation?: string;
  quantity?: number;
  unit?: string;
  is_excluded?: boolean;
  exclusion_reason?: string | null;
  is_verified?: boolean;
  evidence?: string | null;
};

export type TakeoffItemPatchEntry = {
  item_id: string;
  updated_at: string;
  fields: TakeoffItemPatchField;
};

export type TakeoffItemBatchPatchRequest = {
  items: TakeoffItemPatchEntry[];
};

export type TakeoffItemPatchResult = {
  item_id: string;
  success: boolean;
  item?: TakeoffJobItem;
  error?: string;
};

export type TakeoffItemBatchPatchResponse = {
  results: TakeoffItemPatchResult[];
  succeeded: number;
  failed: number;
};

export type TakeoffJobDetailResponse = {
  job: TakeoffJobSummary;
  result: TakeoffJobResult | null;
  items: {
    data: TakeoffJobItem[];
    pagination: {
      limit: number;
      offset: number;
      total: number;
    };
  };
};

export type TakeoffJobActionResponse = {
  job: TakeoffJobSummary;
};

export type TakeoffApplyResponse = {
  job: TakeoffJobSummary;
  summary: TakeoffApplySummary;
};

export type TakeoffPreviewConversionRequest = TakeoffApplyRequest;
export type TakeoffMappingOverrideAction = z.infer<
  typeof takeoffMappingOverrideActionSchema
>;
export type TakeoffMappingOverride = z.infer<typeof takeoffMappingOverrideSchema>;
export type TakeoffMappingPreviewItem = z.infer<
  typeof takeoffMappingPreviewItemSchema
>;
export type TakeoffPreviewConversionSummary =
  z.infer<typeof takeoffPreviewConversionResponseSchema>["summary"];
export type TakeoffPreviewConversionResponse = z.infer<
  typeof takeoffPreviewConversionResponseSchema
>;

export const TAKEOFF_DIFF_MATCH_STRATEGIES = [
  "designation_fuzzy",
  "designation_plus_page_fuzzy",
] as const;
export type TakeoffDiffMatchStrategy =
  (typeof TAKEOFF_DIFF_MATCH_STRATEGIES)[number];

export type TakeoffDiffField = {
  field:
    | "designation"
    | "quantity"
    | "unit"
    | "source_page"
    | "confidence"
    | "evidence";
  label: string;
  kind: "text" | "number";
  before_value: string | number | null;
  after_value: string | number | null;
};

export type TakeoffDiffAddedEntry = {
  key: string;
  change_type: "added";
  other_item: TakeoffJobItem;
};

export type TakeoffDiffRemovedEntry = {
  key: string;
  change_type: "removed";
  base_item: TakeoffJobItem;
};

export type TakeoffDiffChangedEntry = {
  key: string;
  change_type: "changed";
  base_item: TakeoffJobItem;
  other_item: TakeoffJobItem;
  match_score: number;
  match_strategy: TakeoffDiffMatchStrategy;
  delta: TakeoffDiffField[];
};

export type TakeoffDiffUnchangedEntry = {
  key: string;
  change_type: "unchanged";
  base_item: TakeoffJobItem;
  other_item: TakeoffJobItem;
  match_score: number;
  match_strategy: TakeoffDiffMatchStrategy;
};

export type TakeoffDiffEntry =
  | TakeoffDiffAddedEntry
  | TakeoffDiffRemovedEntry
  | TakeoffDiffChangedEntry
  | TakeoffDiffUnchangedEntry;

export type TakeoffJobCompareSummary = {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
  total_base: number;
  total_other: number;
};

export type TakeoffJobCompareResponse = {
  base_job_id: string;
  other_job_id: string;
  threshold: number;
  summary: TakeoffJobCompareSummary;
  added: TakeoffDiffAddedEntry[];
  removed: TakeoffDiffRemovedEntry[];
  changed: TakeoffDiffChangedEntry[];
  unchanged: TakeoffDiffUnchangedEntry[];
};

export type TakeoffDpgfComparisonView = "all" | "exceptions_only";

export type TakeoffDpgfComparisonEvidenceKind =
  | "fact"
  | "hypothesis"
  | "inference";

export type TakeoffDpgfComparisonEvidenceType =
  | "dpgf"
  | "takeoff"
  | "plan_zone"
  | "formula"
  | "price_source"
  | "comment";

export type TakeoffDpgfReviewStatus =
  | "reliable_match"
  | "to_confirm"
  | "significant_gap"
  | "unlinked"
  | "forced_manual";

export type TakeoffDpgfReviewDecision =
  | "keep_dpgf"
  | "keep_takeoff"
  | "manual_fix"
  | "out_of_scope";

export type TakeoffDpgfComparisonDpgfLine = {
  estimate_item_id: string;
  title: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  source_page: number | null;
  source_file_name: string | null;
  position: number;
};

export type TakeoffDpgfComparisonTakeoffLine = {
  item_id: string;
  designation: string;
  quantity: number;
  unit: string;
  source_page: number | null;
  source_file_name: string | null;
  confidence: number | null;
  evidence: string | null;
  metadata: Record<string, unknown>;
};

export type TakeoffDpgfComparisonProof = {
  proof_id: string;
  type: TakeoffDpgfComparisonEvidenceType;
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  source: string;
  confidence_score: number | null;
  note: string | null;
};

export type TakeoffLineEvidenceStatus = "active" | "invalidated" | "replaced";

export type TakeoffLineEvidence = {
  evidence_id: string;
  type: TakeoffDpgfComparisonEvidenceType;
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  source: string;
  source_file_name: string | null;
  source_page: number | null;
  confidence_score: number | null;
  note: string | null;
  created_at: string;
  author_name: string | null;
  status: TakeoffLineEvidenceStatus;
  supersedes_evidence_id: string | null;
  replaced_by_evidence_id: string | null;
};

export type TakeoffLineEvidencePanelResponse = {
  line_id: string;
  version_id: string;
  job_id: string;
  evidences: TakeoffLineEvidence[];
  history: TakeoffLineEvidence[];
};

export type TakeoffDpgfReviewDecisionRecord = {
  id: string;
  tenant_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  decision: TakeoffDpgfReviewDecision;
  reason: string | null;
  review_reference: string;
  line_label: string;
  line_position: number;
  source_file_name: string | null;
  source_page: number | null;
  decided_at: string;
  updated_at: string;
  decided_by: string | null;
  source: "current_version" | "carried_over";
  carried_over_from_version_id: string | null;
  carried_over_from_version_number: number | null;
};

export type TakeoffDpgfComparisonUnusedTakeoffItem = {
  item_id: string;
  designation: string;
  quantity: number;
  unit: string;
  source_file_name: string | null;
  source_page: number | null;
  confidence_score: number | null;
  evidence: string | null;
};

export type TakeoffRiskSeverity = "info" | "warning" | "critical";
export type TakeoffRiskStatus = "to_process" | "assumed" | "false_positive";
export type TakeoffRiskScopeType = "project" | "lot" | "line";
export type TakeoffRiskMarginBucket =
  | "negative"
  | "thin"
  | "healthy"
  | "unknown";
export type TakeoffRiskCauseCode =
  | "missing_proof"
  | "dpgf_takeoff_gap"
  | "atypical_price"
  | "insufficient_margin"
  | "vat_inconsistency"
  | "missing_piece";

export type TakeoffRiskProvenanceEntry = {
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  source: string;
  confidence_score: number | null;
  note: string | null;
};

export type TakeoffDpgfLineRiskSummary = {
  score: number;
  severity: TakeoffRiskSeverity;
  causes: string[];
  status: TakeoffRiskStatus | null;
};

export type TakeoffRiskAlert = {
  alert_id: string;
  takeoff_job_id?: string | null;
  scope_type: TakeoffRiskScopeType;
  scope_id: string | null;
  scope_label: string;
  line_id: string | null;
  lot_id: string | null;
  cause_code: TakeoffRiskCauseCode;
  cause_label: string;
  severity: TakeoffRiskSeverity;
  risk_score: number;
  status: TakeoffRiskStatus;
  margin_bucket: TakeoffRiskMarginBucket;
  reason_labels: string[];
  provenance: TakeoffRiskProvenanceEntry[];
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

export type TakeoffRiskRadarScopeSummary = {
  scope_type: Exclude<TakeoffRiskScopeType, "line">;
  scope_id: string | null;
  scope_label: string;
  score: number;
  severity: TakeoffRiskSeverity;
  open_alerts_count: number;
  critical_alerts_count: number;
  top_causes: string[];
};

export type TakeoffRiskRadarSummary = {
  to_process_count: number;
  assumed_count: number;
  false_positive_count: number;
  critical_count: number;
  warning_count: number;
  info_count: number;
  top_causes: string[];
  project_score: number;
  project_severity: TakeoffRiskSeverity;
};

export type TakeoffDpgfComparisonRow = {
  line_id: string;
  line_label: string;
  dpgf: TakeoffDpgfComparisonDpgfLine;
  linked_takeoff_items: TakeoffDpgfComparisonTakeoffLine[];
  dpgf_quantity: number | null;
  takeoff_quantity: number | null;
  quantity_unit: string | null;
  matching_score: number;
  confidence_score: number;
  review_status: TakeoffDpgfReviewStatus;
  proofs: TakeoffDpgfComparisonProof[];
  suggested_decision: TakeoffDpgfReviewDecision | null;
  applied_decision: TakeoffDpgfReviewDecisionRecord | null;
  delta_absolute: number | null;
  delta_percent: number | null;
  is_exception: boolean;
  manual_link_count: number;
  matched_by: "auto" | "manual" | null;
  risk: TakeoffDpgfLineRiskSummary | null;
};

export type TakeoffDpgfComparisonSummary = {
  reliable_matches: number;
  to_confirm: number;
  significant_gaps: number;
  forced_manual: number;
  lines_without_proof: number;
  unused_takeoff_items: number;
  total_lines: number;
};

export type TakeoffDpgfComparisonResponse = {
  version_id: string;
  job_id: string;
  view: TakeoffDpgfComparisonView;
  threshold: number;
  summary: TakeoffDpgfComparisonSummary;
  rows: TakeoffDpgfComparisonRow[];
  manual_link_candidates: TakeoffDpgfComparisonUnusedTakeoffItem[];
  unused_takeoff_items: TakeoffDpgfComparisonUnusedTakeoffItem[];
  pagination: {
    page_size: number;
    next_cursor: string | null;
    total: number;
  };
};

export type TakeoffRiskRadarResponse = {
  version_id: string;
  job_id: string;
  summary: TakeoffRiskRadarSummary;
  project: TakeoffRiskRadarScopeSummary;
  lots: TakeoffRiskRadarScopeSummary[];
  items: TakeoffRiskAlert[];
};

export type TakeoffPriceSuggestionStatus =
  | "pending"
  | "applied"
  | "kept_current"
  | "rejected";

export type TakeoffPriceSuggestionAction =
  | "apply_low"
  | "apply_target"
  | "apply_high"
  | "keep_current"
  | "reject";

export type TakeoffPriceSuggestionSourceKind =
  | "history"
  | "pricebook"
  | "similar_item"
  | "external_reference";

export type TakeoffPriceSuggestionConfidenceLabel = "low" | "medium" | "high";

export type TakeoffPriceSuggestionFactor = {
  key: string;
  label: string;
  value: string;
  kind: TakeoffDpgfComparisonEvidenceKind;
};

export type TakeoffPriceSuggestionSource = {
  source_id: string;
  source_kind: TakeoffPriceSuggestionSourceKind;
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  source_ref: string;
  price_cents: number;
  freshness_label: string | null;
  confidence_score: number | null;
  rank: number;
  is_outlier: boolean;
  source_record_table: string | null;
  source_record_id: string | null;
  metadata: Record<string, unknown>;
};

export type TakeoffPriceSuggestionSnapshot = {
  suggestion_id: string;
  line_id: string;
  version_id: string;
  job_id: string;
  current_price_cents: number | null;
  low_cents: number;
  target_cents: number;
  high_cents: number;
  confidence_score: number | null;
  confidence_label: TakeoffPriceSuggestionConfidenceLabel;
  candidate_count: number;
  outlier_count: number;
  justification: string;
  factors: TakeoffPriceSuggestionFactor[];
  summary: Record<string, unknown>;
  status: TakeoffPriceSuggestionStatus;
  selected_action: TakeoffPriceSuggestionAction | null;
  selected_price_cents: number | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
  sources: TakeoffPriceSuggestionSource[];
};

export type GetTakeoffPriceSuggestionQuery = {
  version_id: string;
  estimate_item_id: string;
};

export type RequestTakeoffPriceSuggestionInput = {
  version_id: string;
  estimate_item_id: string;
  force_refresh?: boolean;
};

export type TakeoffPriceSuggestionResponse = {
  suggestion: TakeoffPriceSuggestionSnapshot;
};

export type ReviewTakeoffPriceSuggestionInput = {
  version_id: string;
  action: TakeoffPriceSuggestionAction;
  review_note: string;
};

export type ReviewTakeoffPriceSuggestionResponse = {
  suggestion: TakeoffPriceSuggestionSnapshot;
  applied_item: {
    id: string;
    unit_price_ht_cents: number | null;
    updated_at: string;
  } | null;
};

export type TakeoffRiskRadarQuery = {
  version_id: string;
  severity?: TakeoffRiskSeverity | null;
  status?: TakeoffRiskStatus | null;
  scope?: TakeoffRiskScopeType | null;
  lot_id?: string | null;
};

export type UpdateTakeoffRiskAlertStatusInput = {
  version_id: string;
  status: TakeoffRiskStatus;
  review_note?: string | null;
};

export type UpdateTakeoffRiskAlertStatusResponse = {
  alert: TakeoffRiskAlert;
};

export type TakeoffDpgfManualLinkRecord = {
  id: string;
  tenant_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  takeoff_item_id: string;
  created_at: string;
  updated_at: string;
  linked_by: string | null;
};

export type SaveTakeoffDpgfManualLinkInput = {
  version_id: string;
  estimate_item_id: string;
  takeoff_item_ids: string[];
};

export type SaveTakeoffDpgfManualLinkResponse = {
  links: TakeoffDpgfManualLinkRecord[];
};

export type SaveTakeoffReviewDecisionInput = {
  version_id: string;
  estimate_item_id: string;
  decision: TakeoffDpgfReviewDecision;
  reason?: string | null;
};

export type SaveTakeoffReviewDecisionResponse = {
  decision: TakeoffDpgfReviewDecisionRecord;
};

export type TakeoffApiError = {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  jobId?: string;
  level?: TakeoffLevel | string;
};

export type TakeoffExchange = z.infer<typeof TakeoffExchangeSchema>;
export type TakeoffItem = z.infer<typeof TakeoffItemSchema>;
export type TakeoffTable = z.infer<typeof TakeoffTableSchema>;
export type TakeoffWarning = z.infer<typeof TakeoffWarningSchema>;
export type TakeoffMetadata = z.infer<typeof TakeoffMetadataSchema>;

export type TakeoffMappingRuleMatchType = z.infer<
  typeof takeoffMappingRuleMatchTypeSchema
>;
export type TakeoffMappingRuleAction = z.infer<typeof takeoffMappingRuleActionSchema>;
export type TakeoffMappingRuleActionConfig = z.infer<
  typeof takeoffMappingRuleActionConfigSchema
>;
export type TakeoffMappingRule = z.infer<typeof TakeoffMappingRuleSchema>;
export type CreateTakeoffMappingRuleInput = z.infer<
  typeof createTakeoffMappingRuleSchema
>;
export type UpdateTakeoffMappingRuleInput = z.infer<
  typeof updateTakeoffMappingRuleSchema
>;

export type TakeoffMappingRulesListResponse = {
  mapping_rules: TakeoffMappingRule[];
};

export type TakeoffMappingRuleMutationResponse = {
  mapping_rule: TakeoffMappingRule;
};

export type TakeoffMappingRuleDeleteResponse = {
  deleted: true;
  rule_id: string;
};

export const TAKEOFF_JOB_MAX_RETRY_COUNT = 3;

export type TakeoffJobAttemptOutcomeStatus =
  | "completed"
  | "failed_retryable"
  | "failed_terminal"
  | "in_progress"
  | "noop_terminal"
  | "canceled";

export type TakeoffJobAttemptTrigger = "create" | "retry" | "manual";

export type TakeoffJobAttemptOutcome = {
  job_id: string;
  tenant_id: string | null;
  level: string | null;
  status: TakeoffJobAttemptOutcomeStatus;
  trigger: TakeoffJobAttemptTrigger;
  retry_count: number;
  attempt: number;
  retryable: boolean;
  should_retry: boolean;
  next_retry_in_seconds: number | null;
  next_retry_at: string | null;
  duration_ms: number;
  error_code: string | null;
  error_message: string | null;
  correlation_id: string;
};

export const TAKEOFF_JOB_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "canceled",
  "applied",
]);

/* ─── Plan Center types ─── */

export type PlanSetListItem = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  estimate_version_id: string | null;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  file_count: number;
  total_size_bytes: number;
};

export type PlanFileListItem = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  plan_set_id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  page_count: number | null;
  file_hash: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  download_url?: string | null;
};

export type PlanSetsListResponse = {
  plan_sets: PlanSetListItem[];
};

export type PlanFilesListResponse = {
  plan_files: PlanFileListItem[];
};

export type PlanSetMutationResponse = {
  plan_set: PlanSetListItem;
};

export type PlanSetDeleteResponse = {
  deleted: true;
  plan_set_id: string;
};

export type PlanFileCreateResponse = {
  plan_file: PlanFileListItem;
  signed_upload: {
    url: string;
    method: "PUT";
    path: string;
    token: string;
    expires_in_seconds: number;
  };
};

export type PlanFileDeleteResponse = {
  deleted: true;
  plan_set_id: string;
  file_id: string;
};

export type CreatePlanSetInput = {
  project_id?: string;
  estimate_version_id?: string;
  name: string;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

export type RegisterPlanFileInput = {
  file_name: string;
  file_type: string;
  file_size_bytes: number;
};

/* ─── Metrics Dashboard types (TKF-028) ─── */

export const TAKEOFF_METRICS_PERIODS = ["7d", "30d", "90d"] as const;
export type TakeoffMetricsPeriod = (typeof TAKEOFF_METRICS_PERIODS)[number];

export type TakeoffMetricsKpis = {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  canceledJobs: number;
  appliedJobs: number;
  successRate: number;
  avgDurationMs: number;
  totalCostCents: number;
  avgCostCentsPerJob: number;
  avgConfidence: number;
  avgItemsPerJob: number;
};

export type TakeoffMetricsTrendPoint = {
  key: string;
  label: string;
  createdCount: number;
  failedCount: number;
};

export type TakeoffMetricsCostByLevel = {
  level: string;
  totalCostCents: number;
  totalTokens: number;
  jobCount: number;
  failedCount: number;
  avgDurationMs: number;
  failureRate: number;
  avgItemsPerJob: number;
};

export type TakeoffMetricsTokenBreakdown = {
  inputTokens: number;
  reasoningTokens: number;
  outputTokens: number;
};

export type TakeoffMetricsErrorEntry = {
  errorCode: string;
  count: number;
  lastOccurrence: string;
};

export type TakeoffMetricsReliability = {
  timedOutCount: number;
  budgetExceededCount: number;
  totalRunMetrics: number;
  retriedJobs: number;
  retriedThenCompleted: number;
  retrySuccessRate: number;
};

export type TakeoffMetricsRecentJob = {
  id: string;
  status: string;
  level: string;
  model: string | null;
  durationMs: number | null;
  costCents: number | null;
  confidence: number | null;
  errorCode: string | null;
  createdAt: string;
};

export type TakeoffMetricsStatsPayload = {
  generatedAt: string;
  period: TakeoffMetricsPeriod;
  kpis: TakeoffMetricsKpis;
  trend: TakeoffMetricsTrendPoint[];
  costByLevel: TakeoffMetricsCostByLevel[];
  tokenBreakdown: TakeoffMetricsTokenBreakdown;
  topErrors: TakeoffMetricsErrorEntry[];
  reliability: TakeoffMetricsReliability;
  recentJobs: TakeoffMetricsRecentJob[];
};

/* --- Activity Center types (V3-007) --- */

export type TakeoffActivityCenterConfidenceLabel =
  | "Elevee"
  | "Moyenne"
  | "Faible";
export type TakeoffActivityCenterLevelLabel =
  | "Rapide"
  | "Standard"
  | "Detaille";

export type TakeoffActivityCenterCounters = {
  technicalJobs: number;
  usableJobs: number;
  blockingExceptionsJobs: number;
};

export type TakeoffActivityCenterJobRow = {
  jobId: string;
  estimateVersionId: string;
  versionLabel: string;
  lotLabel: string | null;
  planSetLabel: string | null;
  levelLabel: TakeoffActivityCenterLevelLabel;
  statusLabel: string;
  statusRaw: TakeoffJobStatus | string;
  itemCount: number;
  coveragePercent: number;
  exceptionCount: number;
  confidenceLabel: TakeoffActivityCenterConfidenceLabel;
  appliedCount: number;
  createdAt: string;
  carriedOverFrom: string | null;
  neverApplied: boolean;
  retryCount: number;
};

export type TakeoffActivityCenterFilters = {
  versionId?: string | null;
  lot?: string | null;
  planSetId?: string | null;
  status?: TakeoffJobStatus | null;
  level?: TakeoffLevel | null;
  period?: TakeoffJobListPeriod | null;
};

export type TakeoffActivityCenterResponse = {
  counters: TakeoffActivityCenterCounters;
  jobs: TakeoffActivityCenterJobRow[];
  pagination: { limit: number; offset: number; total: number };
};

export type TakeoffApplicationHistoryEntry = {
  jobId: string;
  versionLabel: string;
  appliedAt: string;
  appliedBy: string | null;
  strategy: string;
  createdCount: number;
  updatedCount: number;
  ignoredCount: number;
};

export type TakeoffApplicationHistoryResponse = {
  entries: TakeoffApplicationHistoryEntry[];
};
