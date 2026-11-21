import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import type { TakeoffError } from "@/lib/takeoff/errors";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { Supabase } from "@/lib/takeoff/processing-context";

export async function logProcessingAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.processing",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.processing"]({
      attempt: input.job.retry_count + 1,
      reason: input.job.retry_count > 0 ? "retry" : null,
    }),
    mode: "non-blocking",
  });
}

export async function logCompletedAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  resultId: string;
  itemsCount: number;
  warningsCount: number;
  durationMs: number;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.completed",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.completed"]({
      result_id: input.resultId,
      items_total: input.itemsCount,
      warnings_total: input.warningsCount,
      duration_ms: input.durationMs,
    }),
    mode: "non-blocking",
  });
}

export async function logFailedAuditEvent(input: {
  supabase: Supabase;
  userId: string | null;
  job: TakeoffJobProcessingRow;
  error: TakeoffError;
}) {
  if (!input.userId) return;

  await logTakeoffAuditEvent({
    supabase: input.supabase,
    tenantId: input.job.tenant_id,
    userId: input.userId,
    jobId: input.job.id,
    estimateVersionId: input.job.estimate_version_id,
    action: "takeoff.job.failed",
    metadata: takeoffAuditMetadataBuilders["takeoff.job.failed"]({
      attempt: input.job.retry_count + 1,
      error_code: input.error.code,
      error_message: input.error.message,
      retryable: input.error.retryable,
    }),
    mode: "non-blocking",
  });
}
