import { z } from "zod";

import {
  TakeoffExchangeSchema,
  TakeoffItemSchema,
  TakeoffMetadataSchema,
  TakeoffTableSchema,
  TakeoffWarningSchema,
} from "@/lib/takeoff/schemas";

export const TAKEOFF_LEVELS = ["A", "B", "C"] as const;
export type TakeoffLevel = (typeof TAKEOFF_LEVELS)[number];

export const TAKEOFF_JOB_STATUSES = [
  "pending",
  "parsing",
  "completed",
  "failed",
] as const;
export type TakeoffJobStatus = (typeof TAKEOFF_JOB_STATUSES)[number];

export type TakeoffJobCreateInput = {
  estimateVersionId: string;
  level: TakeoffLevel;
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
