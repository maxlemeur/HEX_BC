import type { TakeoffRiskSeverity, TakeoffRiskStatus, TakeoffRiskScopeType } from "@/lib/takeoff/risk-response-contracts";
import type { TakeoffDiffAddedEntry, TakeoffDiffRemovedEntry, TakeoffDiffChangedEntry, TakeoffDiffUnchangedEntry } from "@/lib/takeoff/compare-response-contracts";
import { z } from "zod";

import type {
  TakeoffDpgfReviewDecision,
} from "@/lib/takeoff/dpgf-comparison-contracts";

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

export {
  TAKEOFF_JOB_LIST_PERIODS,
  TAKEOFF_JOB_STATUSES,
  TAKEOFF_LEVELS,
} from "@/lib/takeoff/enums";
export type {
  TakeoffJobListPeriod,
  TakeoffJobStatus,
  TakeoffLevel,
} from "@/lib/takeoff/enums";
import type {
  TakeoffJobListPeriod,
  TakeoffJobStatus,
  TakeoffLevel,
} from "@/lib/takeoff/enums";

export const TAKEOFF_PROCESSING_STRATEGIES = ["sync", "batch"] as const;
export type TakeoffProcessingStrategy =
  (typeof TAKEOFF_PROCESSING_STRATEGIES)[number];

export const TAKEOFF_PROVIDER_BATCH_STATES = [
  "submitted",
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "unknown",
] as const;
export type TakeoffProviderBatchState =
  (typeof TAKEOFF_PROVIDER_BATCH_STATES)[number];

export const TAKEOFF_JOB_OPERATOR_STATES = [
  "none",
  "submitted_to_provider",
  "awaiting_provider_result",
  "provider_failed",
  "orphan_to_reconcile",
] as const;
export type TakeoffJobOperatorState =
  (typeof TAKEOFF_JOB_OPERATOR_STATES)[number];

export const TAKEOFF_APPLY_STRATEGIES = ["append", "replace", "merge"] as const;
export type TakeoffApplyStrategy = (typeof TAKEOFF_APPLY_STRATEGIES)[number];

export const TAKEOFF_APPLY_SCOPES = ["section", "version"] as const;
export type TakeoffApplyScope = (typeof TAKEOFF_APPLY_SCOPES)[number];

export type TakeoffApplyRequest = z.infer<typeof takeoffApplyRequestSchema>;

export type TakeoffProvider = "auto" | "chatgpt" | "gemini";

export type TakeoffJobCreateInput = {
  provider?: TakeoffProvider;
  estimateVersionId: string;
  level: TakeoffLevel;
  file: File;
  idempotencyKey?: string;
  onUploadProgress?: (progressPercent: number) => void;
  signal?: AbortSignal;
};

export type { TakeoffJobCreateResponse as TakeoffJobResponse } from "@/lib/takeoff/job-response-contracts";

export type { TakeoffJobDispatch } from "@/lib/takeoff/job-response-contracts";

export type TakeoffDispatchStatus =
  | "started"
  | "queued"
  | "trigger_failed";

export type TakeoffDispatchOutcome =
  | "accepted"
  | "configuration_missing"
  | "http_error"
  | "timeout"
  | "network_error";

export type { TakeoffJobMetrics } from "@/lib/takeoff/apply-response-contracts";

export type { TakeoffJobSummary } from "@/lib/takeoff/apply-response-contracts";

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

export const TAKEOFF_CARRY_OVER_SUMMARY_STATES = [
  "not_applicable",
  "unavailable",
  "empty",
  "ready",
  "attention_required",
] as const;
export type TakeoffCarryOverSummaryState =
  (typeof TAKEOFF_CARRY_OVER_SUMMARY_STATES)[number];

export const TAKEOFF_CARRY_OVER_LINK_STATES = [
  "not_requested",
  "linked",
  "partial",
  "failed",
] as const;
export type TakeoffCarryOverLinkState =
  (typeof TAKEOFF_CARRY_OVER_LINK_STATES)[number];

export type TakeoffCarryOverSummary = {
  sourceVersionId: string | null;
  sourceVersionNumber: number | null;
  state: TakeoffCarryOverSummaryState;
  totalJobs: number;
  acquiredJobs: number;
  inProgressJobs: number;
  actionRequiredJobs: number;
};

export type TakeoffCarryOverStatus = {
  summary: TakeoffCarryOverSummary;
  linkState: TakeoffCarryOverLinkState;
  linkedJobs: number;
  unlinkedJobs: number;
};

export type { TakeoffJobStatusCounters } from "@/lib/takeoff/job-response-contracts";

export type TakeoffJobListQuery = {
  estimate_version_id?: string;
  project_id?: string;
  status?: TakeoffJobStatus;
  level?: TakeoffLevel;
  period?: TakeoffJobListPeriod;
  limit?: number;
  offset?: number;
};

export type { TakeoffApplySummary } from "@/lib/takeoff/apply-response-contracts";

export type { TakeoffJobListResponse } from "@/lib/takeoff/job-response-contracts";

export type { TakeoffJobResult } from "@/lib/takeoff/job-response-contracts";

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

export type { TakeoffJobItem } from "@/lib/takeoff/item-response-contracts";

export type TakeoffItemPatchField = {
  designation?: string;
  quantity?: number;
  unit?: string;
  source_page?: number | null;
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

export type { TakeoffItemPatchResult } from "@/lib/takeoff/item-response-contracts";

export type { TakeoffItemBatchPatchResponse } from "@/lib/takeoff/item-response-contracts";

export type { TakeoffJobDetailResponse } from "@/lib/takeoff/job-response-contracts";

export type { TakeoffJobActionResponse } from "@/lib/takeoff/job-response-contracts";

export type { TakeoffApplyResponse } from "@/lib/takeoff/apply-response-contracts";

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

export type { TakeoffDiffField } from "@/lib/takeoff/compare-response-contracts";

export type { TakeoffDiffAddedEntry } from "@/lib/takeoff/compare-response-contracts";

export type { TakeoffDiffRemovedEntry } from "@/lib/takeoff/compare-response-contracts";

export type { TakeoffDiffChangedEntry } from "@/lib/takeoff/compare-response-contracts";

export type { TakeoffDiffUnchangedEntry } from "@/lib/takeoff/compare-response-contracts";

export type TakeoffDiffEntry =
  | TakeoffDiffAddedEntry
  | TakeoffDiffRemovedEntry
  | TakeoffDiffChangedEntry
  | TakeoffDiffUnchangedEntry;

export type { TakeoffJobCompareSummary } from "@/lib/takeoff/compare-response-contracts";

export type { TakeoffJobCompareResponse } from "@/lib/takeoff/compare-response-contracts";

export type {
  TakeoffDpgfComparisonView,
  TakeoffDpgfComparisonEvidenceKind,
  TakeoffDpgfComparisonEvidenceType,
  TakeoffDpgfReviewStatus,
  TakeoffDpgfReviewDecision,
  TakeoffDpgfComparisonDpgfLine,
  TakeoffDpgfComparisonTakeoffLine,
  TakeoffDpgfComparisonProof,
  TakeoffDpgfReviewDecisionRecord,
  TakeoffDpgfComparisonUnusedTakeoffItem,
  TakeoffDpgfLineRiskSummary,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonSummary,
  TakeoffDpgfComparisonResponse,
} from "@/lib/takeoff/dpgf-comparison-contracts";

export type {
  TakeoffLineEvidenceStatus,
  TakeoffLineEvidence,
  TakeoffLineEvidencePanelResponse,
} from "@/lib/takeoff/line-evidence-contracts";

export type {
  TakeoffRiskSeverity,
  TakeoffRiskStatus,
  TakeoffRiskScopeType,
  TakeoffRiskMarginBucket,
  TakeoffRiskCauseCode,
  TakeoffRiskProvenanceEntry,
  TakeoffRiskAlert,
  TakeoffRiskRadarScopeSummary,
  TakeoffRiskRadarSummary,
  TakeoffRiskRadarResponse,
} from "@/lib/takeoff/risk-response-contracts";

export type {
  TakeoffPriceSuggestionStatus,
  TakeoffPriceSuggestionAction,
  TakeoffPriceSuggestionSourceKind,
  TakeoffPriceSuggestionConfidenceLabel,
  TakeoffPriceSuggestionFactor,
  TakeoffPriceSuggestionSource,
  TakeoffPriceSuggestionSnapshot,
  GetTakeoffPriceSuggestionQuery,
  RequestTakeoffPriceSuggestionInput,
  TakeoffPriceSuggestionResponse,
  ReviewTakeoffPriceSuggestionInput,
  ReviewTakeoffPriceSuggestionResponse,
} from "@/lib/takeoff/price-suggestion-contracts";

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

export type { UpdateTakeoffRiskAlertStatusResponse } from "@/lib/takeoff/risk-response-contracts";

export type { TakeoffDpgfManualLinkRecord } from "@/lib/takeoff/review-response-contracts";

export type SaveTakeoffDpgfManualLinkInput = {
  version_id: string;
  estimate_item_id: string;
  takeoff_item_ids: string[];
};

export type { SaveTakeoffDpgfManualLinkResponse } from "@/lib/takeoff/review-response-contracts";

export type SaveTakeoffReviewDecisionInput = {
  version_id: string;
  estimate_item_id: string;
  decision: TakeoffDpgfReviewDecision;
  reason?: string | null;
};

export type { SaveTakeoffReviewDecisionResponse } from "@/lib/takeoff/review-response-contracts";

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
  | "submitted_to_provider"
  | "awaiting_provider_result"
  | "failed_retryable"
  | "failed_terminal"
  | "in_progress"
  | "noop_terminal"
  | "canceled";

export type TakeoffJobAttemptTrigger = "create" | "retry" | "manual" | "reconcile";

export type TakeoffJobAttemptRequeueReason = "retry" | "reconcile";

export type TakeoffJobAttemptOutcome = {
  job_id: string;
  tenant_id: string | null;
  level: string | null;
  status: TakeoffJobAttemptOutcomeStatus;
  trigger: TakeoffJobAttemptTrigger;
  retry_count: number;
  attempt: number;
  retryable: boolean;
  should_requeue: boolean;
  requeue_reason: TakeoffJobAttemptRequeueReason | null;
  next_run_in_seconds: number | null;
  next_run_at: string | null;
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
  dossier_synchronized?: boolean;
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
  dossier_synchronized?: boolean;
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

export {
  TAKEOFF_METRICS_PERIODS,
} from "@/lib/takeoff/metrics-types";
export type {
  TakeoffAppliedScoreCalibration,
  TakeoffAppliedScoreCalibrationStatus,
  TakeoffCorrectionMetrics,
  TakeoffCorrectionMetricsByLevel,
  TakeoffCorrectionMetricsEventCount,
  TakeoffCorrectionMetricsEventType,
  TakeoffCorrectionMetricsKpis,
  TakeoffMetricsCostByLevel,
  TakeoffMetricsErrorEntry,
  TakeoffMetricsKpis,
  TakeoffMetricsPeriod,
  TakeoffMetricsRecentJob,
  TakeoffMetricsReliability,
  TakeoffMetricsStatsPayload,
  TakeoffMetricsTokenBreakdown,
  TakeoffMetricsTrendPoint,
} from "@/lib/takeoff/metrics-types";

/* --- Activity Center types (V3-007) --- */

export type TakeoffActivityCenterConfidenceLabel =
  | "Élevée"
  | "Moyenne"
  | "Faible";
export type TakeoffActivityCenterLevelLabel =
  | "Rapide"
  | "Standard"
  | "Détaillé";

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
  processingStrategy: TakeoffProcessingStrategy | null;
  providerBatchState: TakeoffProviderBatchState | null;
  providerBatchUpdatedAt: string | null;
  providerReconcileDueAt?: string | null;
  providerReconcileLeaseExpiresAt?: string | null;
  statusLabel: string;
  statusRaw:
    | "queued"
    | "processing"
    | "provider_pending"
    | "review_required"
    | "action_required"
    | "completed"
    | string;
  technicalStatusRaw: TakeoffJobStatus | string;
  operatorState?: TakeoffJobOperatorState | null;
  operatorStateLabel?: string | null;
  canReconcile?: boolean;
  canCancel?: boolean;
  canResubmit?: boolean;
  itemCount: number;
  coveragePercent: number | null;
  exceptionCount: number;
  confidenceLabel: TakeoffActivityCenterConfidenceLabel;
  appliedCount: number;
  createdAt: string;
  carriedOverFrom: string | null;
  neverApplied: boolean;
  retryCount: number;
  dispatchStatus?: TakeoffDispatchStatus | null;
  dispatchOutcome?: TakeoffDispatchOutcome | null;
  dispatchCorrelationId?: string | null;
  dispatchUpdatedAt?: string | null;
};

export type TakeoffActivityCenterFilters = {
  versionId?: string | null;
  lot?: string | null;
  planSetId?: string | null;
  status?: string | null;
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
