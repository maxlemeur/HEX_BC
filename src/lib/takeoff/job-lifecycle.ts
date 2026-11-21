import { z } from "zod";

export const TAKEOFF_JOB_PROCESSING_SELECT = [
  "id",
  "tenant_id",
  "estimate_version_id",
  "project_id",
  "level",
  "status",
  "source_file_name",
  "source_file_path",
  "source_file_type",
  "plan_set_id",
  "prompt_version",
  "schema_version",
  "model",
  "processing_lease_token",
  "processing_lease_expires_at",
  "retry_count",
  "created_by",
  "launch_request_id",
  "execution_provider",
  "execution_host_id",
  "preparation_snapshot",
].join(", ");

const takeoffJobProcessingSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  estimate_version_id: z.string().uuid().nullable(),
  project_id: z.string().uuid().optional(),
  level: z.string(),
  status: z.string(),
  source_file_name: z.string().nullable(),
  source_file_path: z.string().nullable(),
  source_file_type: z.string().nullable(),
  plan_set_id: z.string().uuid().nullable().optional(),
  prompt_version: z.string().nullable(),
  schema_version: z.string().nullable(),
  model: z.string().nullable().optional(),
  processing_lease_token: z.string().uuid().nullable().optional(),
  processing_lease_expires_at: z.string().nullable().optional(),
  retry_count: z.number().int().nonnegative().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
  /** The launch request a job belongs to: its usage and budget are the request's. */
  launch_request_id: z.string().uuid().nullable().optional(),
  execution_provider: z.enum(["gemini", "chatgpt_local"]).optional(),
  execution_host_id: z.string().nullable().optional(),
  preparation_snapshot: z.unknown().nullable().optional(),
});

export type TakeoffJobProcessingRow =
  z.infer<typeof takeoffJobProcessingSchema> & {
    retry_count: number;
    created_by: string | null;
    processing_lease_token: string | null;
    processing_lease_expires_at: string | null;
  };

export type TakeoffLeaseRenewal = (input: {
  jobId: string;
  tenantId: string;
  leaseToken: string;
}) => Promise<void>;

export type TakeoffWorkerJobRow = {
  analysis_outcome?: string | null;
  id: string;
  tenant_id: string;
  level: string;
  status: string;
  execution_provider: string | null;
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
    execution_provider: text(record.execution_provider),
    analysis_outcome: text(record.analysis_outcome),
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
    processing_lease_token: parsed.processing_lease_token ?? null,
    processing_lease_expires_at: parsed.processing_lease_expires_at ?? null,
    retry_count: parsed.retry_count ?? 0,
    created_by: parsed.created_by ?? null,
  };
}
