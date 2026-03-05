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
