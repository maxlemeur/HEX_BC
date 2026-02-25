import { z } from "zod";

import {
  TakeoffExchangeSchema,
  TakeoffItemSchema,
  TakeoffMappingRuleSchema,
  TakeoffMetadataSchema,
  TakeoffTableSchema,
  TakeoffWarningSchema,
  createTakeoffMappingRuleSchema,
  takeoffMappingRuleActionConfigSchema,
  takeoffMappingRuleActionSchema,
  takeoffMappingRuleMatchTypeSchema,
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
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  metrics: TakeoffJobMetrics;
};

export type TakeoffJobListResponse = {
  jobs: TakeoffJobSummary[];
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
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
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
