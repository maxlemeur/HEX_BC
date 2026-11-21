import { z } from "zod";

import { TAKEOFF_JOB_OPERATOR_STATES, TAKEOFF_PROVIDER_BATCH_STATES } from "@/lib/takeoff/types";
import { takeoffActivityResumeSchema } from "@/lib/takeoff/resume-contracts";
import {
  takeoffResponseCountSchema as count,
  takeoffResponseTimestampSchema as timestamp,
  takeoffResponseUuidSchema as uuid,
} from "@/lib/takeoff/response-contracts";

const outcome = z.enum(["success", "failure", "canceled"]);

/** A row of the affaire's activity, as GET /api/takeoff/activity-center returns it. */
export const takeoffActivityCenterJobRowSchema = z.object({
  jobId: uuid,
  launchRequestId: uuid.nullable().optional().describe("La demande de lancement dont cette analyse est une unité ; null sans demande."),
  analysisCompletion: z.object({ eventId: uuid.nullable(), outcome, finishedAt: timestamp }).nullable().optional(),
  estimateVersionId: uuid.nullable(),
  versionLabel: z.string(),
  lotLabel: z.string().nullable(),
  planSetLabel: z.string().nullable(),
  levelLabel: z.string(),
  processingStrategy: z.enum(["sync", "batch"]).nullable(),
  providerBatchState: z.enum(TAKEOFF_PROVIDER_BATCH_STATES).nullable(),
  providerBatchUpdatedAt: timestamp.nullable(),
  providerReconcileDueAt: timestamp.nullable().optional(),
  providerReconcileLeaseExpiresAt: timestamp.nullable().optional(),
  statusLabel: z.string(),
  statusRaw: z.string(),
  technicalStatusRaw: z.string(),
  operatorState: z.enum(TAKEOFF_JOB_OPERATOR_STATES).nullable().optional(),
  operatorStateLabel: z.string().nullable().optional(),
  canCancel: z.boolean().optional(),
  canResubmit: z.boolean().optional().describe("Vrai si et seulement si resume.action vaut retry_now."),
  resume: takeoffActivityResumeSchema,
  errorCode: z.string().nullable().describe("Code de diagnostic de l’analyse ; l’écran affiche son motif en français, jamais le code."),
  nextRetryAt: timestamp.nullable(),
  itemCount: count,
  coveragePercent: z.number().min(0).max(100).nullable(),
  exceptionCount: count,
  confidenceLabel: z.string(),
  appliedCount: count,
  createdAt: timestamp,
  carriedOverFrom: z.string().nullable(),
  neverApplied: z.boolean(),
  retryCount: count,
  dispatchStatus: z.enum(["started", "queued", "trigger_failed"]).nullable().optional(),
  dispatchOutcome: z.enum(["accepted", "configuration_missing", "http_error", "timeout", "network_error"]).nullable().optional(),
  dispatchCorrelationId: z.string().nullable().optional(),
  dispatchUpdatedAt: timestamp.nullable().optional(),
});

export const takeoffActivityCenterResponseSchema = z.object({
  counters: z.object({ technicalJobs: count, usableJobs: count, blockingExceptionsJobs: count }),
  jobs: z.array(takeoffActivityCenterJobRowSchema),
  analysisCompletions: z.array(z.object({ eventId: uuid, outcome, finishedAt: timestamp })),
  pagination: z.object({ limit: z.number().int().min(1), offset: count, total: count }),
});
