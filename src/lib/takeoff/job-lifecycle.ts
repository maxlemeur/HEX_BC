import { z } from "zod";

import {
  normalizeGeminiProviderBatchState,
  normalizeTakeoffProcessingStrategy,
} from "@/lib/takeoff/provider-batch";
import type {
  TakeoffProcessingStrategy,
  TakeoffProviderBatchState,
} from "@/lib/takeoff/types";

export const TAKEOFF_JOB_PROCESSING_SELECT = [
  "id",
  "tenant_id",
  "estimate_version_id",
  "level",
  "status",
  "source_file_name",
  "source_file_path",
  "source_file_type",
  "plan_set_id",
  "prompt_version",
  "schema_version",
  "model",
  "thinking_level",
  "processing_strategy",
  "provider_batch_id",
  "provider_batch_state",
  "provider_batch_updated_at",
  "provider_reconcile_due_at",
  "provider_reconcile_attempt_count",
  "provider_reconcile_lease_token",
  "provider_reconcile_lease_expires_at",
  "processing_lease_token",
  "processing_lease_expires_at",
  "retry_count",
  "created_by",
].join(", ");

const takeoffJobProcessingSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  estimate_version_id: z.string().uuid(),
  level: z.string(),
  status: z.string(),
  source_file_name: z.string().nullable(),
  source_file_path: z.string().nullable(),
  source_file_type: z.string().nullable(),
  plan_set_id: z.string().uuid().nullable().optional(),
  prompt_version: z.string().nullable(),
  schema_version: z.string().nullable(),
  model: z.string().nullable().optional(),
  thinking_level: z.string().nullable().optional(),
  processing_strategy: z.string().nullable().optional(),
  provider_batch_id: z.string().nullable().optional(),
  provider_batch_state: z.string().nullable().optional(),
  provider_batch_updated_at: z.string().nullable().optional(),
  provider_reconcile_due_at: z.string().nullable().optional(),
  provider_reconcile_attempt_count: z.number().int().nonnegative().nullable().optional(),
  provider_reconcile_lease_token: z.string().uuid().nullable().optional(),
  provider_reconcile_lease_expires_at: z.string().nullable().optional(),
  processing_lease_token: z.string().uuid().nullable().optional(),
  processing_lease_expires_at: z.string().nullable().optional(),
  retry_count: z.number().int().nonnegative().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
});

export type TakeoffJobProcessingRow =
  z.infer<typeof takeoffJobProcessingSchema> & {
    retry_count: number;
    created_by: string | null;
    processing_strategy: TakeoffProcessingStrategy | null;
    provider_batch_id: string | null;
    provider_batch_state: TakeoffProviderBatchState | null;
    provider_batch_updated_at: string | null;
    provider_reconcile_due_at: string | null;
    provider_reconcile_attempt_count: number;
    provider_reconcile_lease_token: string | null;
    provider_reconcile_lease_expires_at: string | null;
    processing_lease_token: string | null;
    processing_lease_expires_at: string | null;
  };

export type TakeoffLeaseRenewal = (input: {
  jobId: string;
  tenantId: string;
  leaseToken: string;
}) => Promise<void>;

export type TakeoffWorkerJobRow = {
  id: string;
  tenant_id: string;
  level: string;
  status: string;
  processing_strategy: string | null;
  provider_batch_id: string | null;
  provider_batch_state: string | null;
  provider_reconcile_due_at: string | null;
  provider_reconcile_attempt_count: number | null;
  provider_reconcile_lease_token: string | null;
  provider_reconcile_lease_expires_at: string | null;
  retry_count: number | null;
  error_code: string | null;
  error_message: string | null;
  created_by: string | null;
  next_retry_at: string | null;
  last_error_at: string | null;
};

export function normalizeTakeoffWorkerJobRow(row: unknown): TakeoffWorkerJobRow | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.tenant_id !== "string") return null;
  const text = (value: unknown) => typeof value === "string" ? value : null;
  return {
    id: record.id,
    tenant_id: record.tenant_id,
    level: text(record.level) ?? "",
    status: text(record.status) ?? "",
    processing_strategy: text(record.processing_strategy),
    provider_batch_id: text(record.provider_batch_id),
    provider_batch_state: text(record.provider_batch_state),
    provider_reconcile_due_at: text(record.provider_reconcile_due_at),
    provider_reconcile_attempt_count: typeof record.provider_reconcile_attempt_count === "number" ? record.provider_reconcile_attempt_count : null,
    provider_reconcile_lease_token: text(record.provider_reconcile_lease_token),
    provider_reconcile_lease_expires_at: text(record.provider_reconcile_lease_expires_at),
    retry_count: typeof record.retry_count === "number" ? record.retry_count : null,
    error_code: text(record.error_code),
    error_message: text(record.error_message),
    created_by: text(record.created_by),
    next_retry_at: text(record.next_retry_at),
    last_error_at: text(record.last_error_at),
  };
}

export async function runWithTakeoffLeaseRenewal<T>(
  renew: () => Promise<void>,
  effect: () => Promise<T>
) {
  await renew();
  try {
    return await effect();
  } finally {
    await renew();
  }
}

export function parseTakeoffJobRow(data: unknown): TakeoffJobProcessingRow {
  const parsed = takeoffJobProcessingSchema.parse(data);

  return {
    ...parsed,
    processing_strategy: normalizeTakeoffProcessingStrategy(
      parsed.processing_strategy
    ),
    provider_batch_id: parsed.provider_batch_id ?? null,
    provider_batch_state:
      parsed.provider_batch_state === null ||
      parsed.provider_batch_state === undefined
        ? null
        : normalizeGeminiProviderBatchState(parsed.provider_batch_state),
    provider_batch_updated_at: parsed.provider_batch_updated_at ?? null,
    provider_reconcile_due_at: parsed.provider_reconcile_due_at ?? null,
    provider_reconcile_attempt_count: parsed.provider_reconcile_attempt_count ?? 0,
    provider_reconcile_lease_token: parsed.provider_reconcile_lease_token ?? null,
    provider_reconcile_lease_expires_at:
      parsed.provider_reconcile_lease_expires_at ?? null,
    processing_lease_token: parsed.processing_lease_token ?? null,
    processing_lease_expires_at: parsed.processing_lease_expires_at ?? null,
    retry_count: parsed.retry_count ?? 0,
    created_by: parsed.created_by ?? null,
  };
}
