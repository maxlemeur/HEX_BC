import { z } from "zod";

import type { getAuthenticatedContext } from "@/lib/estimates/server";
import { mapSupabaseError } from "@/lib/estimates/errors";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { TAKEOFF_LEVELS, type TakeoffLevel } from "@/lib/takeoff/types";
import type { Database, Json } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
type AuditLogInsert = Database["public"]["Tables"]["audit_logs"]["Insert"];

export const TAKEOFF_AUDIT_ACTIONS = [
  "takeoff.job.created",
  "takeoff.job.processing",
  "takeoff.job.completed",
  "takeoff.job.failed",
  "takeoff.job.retried",
  "takeoff.job.canceled",
  "takeoff.item.excluded",
  "takeoff.item.modified",
  "takeoff.apply.started",
  "takeoff.apply.completed",
  "takeoff.apply.failed",
] as const;

export type TakeoffAuditAction = (typeof TAKEOFF_AUDIT_ACTIONS)[number];
export type TakeoffAuditResilienceMode = "fail-hard" | "non-blocking";

const nonNegativeIntSchema = z.number().int().nonnegative();
const positiveIntSchema = z.number().int().positive();
const nullableReasonSchema = z.string().trim().min(1).max(500).nullable();
const nullableCodeSchema = z.string().trim().min(1).max(120).nullable();
const nullableMessageSchema = z.string().trim().min(1).max(4000).nullable();
const nullableNameSchema = z.string().trim().min(1).max(255).nullable();

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(z.string(), jsonSchema),
  ])
);

const takeoffAuditMetadataSchemas = {
  "takeoff.job.created": z
    .object({
      level: z.enum(TAKEOFF_LEVELS),
      estimate_version_id: z.string().uuid(),
      source_file_name: nullableNameSchema,
      idempotency_key: z.string().trim().min(1).max(255).nullable(),
    })
    .strict(),
  "takeoff.job.processing": z
    .object({
      status: z.literal("processing").default("processing"),
      attempt: positiveIntSchema.default(1),
      reason: nullableReasonSchema.default(null),
    })
    .strict(),
  "takeoff.job.completed": z
    .object({
      status: z.literal("completed").default("completed"),
      result_id: z.string().uuid().nullable().default(null),
      items_total: nonNegativeIntSchema.nullable().default(null),
      warnings_total: nonNegativeIntSchema.nullable().default(null),
      duration_ms: nonNegativeIntSchema.nullable().default(null),
    })
    .strict(),
  "takeoff.job.failed": z
    .object({
      status: z.literal("failed").default("failed"),
      attempt: positiveIntSchema.default(1),
      error_code: nullableCodeSchema.default(null),
      error_message: nullableMessageSchema.default(null),
      retryable: z.boolean().default(false),
    })
    .strict(),
  "takeoff.job.retried": z
    .object({
      status: z.literal("retried").default("retried"),
      from_attempt: positiveIntSchema.default(1),
      to_attempt: positiveIntSchema.default(2),
      reason: nullableReasonSchema.default(null),
    })
    .strict(),
  "takeoff.job.canceled": z
    .object({
      status: z.literal("canceled").default("canceled"),
      reason: nullableReasonSchema.default(null),
      canceled_by: z.enum(["user", "system", "admin"]).default("user"),
    })
    .strict(),
  "takeoff.item.excluded": z
    .object({
      item_id: z.string().uuid(),
      is_excluded: z.literal(true).default(true),
      reason: nullableReasonSchema.default(null),
    })
    .strict(),
  "takeoff.item.modified": z
    .object({
      item_id: z.string().uuid(),
      field: z.string().trim().min(1).max(120),
      previous_value: jsonSchema.nullable().default(null),
      next_value: jsonSchema.nullable().default(null),
      reason: nullableReasonSchema.default(null),
    })
    .strict(),
  "takeoff.apply.started": z
    .object({
      estimate_version_id: z.string().uuid(),
      selected_items_count: nonNegativeIntSchema.default(0),
    })
    .strict(),
  "takeoff.apply.completed": z
    .object({
      estimate_version_id: z.string().uuid(),
      applied_items_count: nonNegativeIntSchema.default(0),
      excluded_items_count: nonNegativeIntSchema.default(0),
    })
    .strict(),
  "takeoff.apply.failed": z
    .object({
      estimate_version_id: z.string().uuid(),
      error_code: nullableCodeSchema.default(null),
      error_message: nullableMessageSchema.default(null),
      retryable: z.boolean().default(false),
    })
    .strict(),
} as const satisfies {
  [Action in TakeoffAuditAction]: z.ZodTypeAny;
};

export type TakeoffAuditMetadataByAction = {
  [Action in TakeoffAuditAction]: z.infer<
    (typeof takeoffAuditMetadataSchemas)[Action]
  >;
};

export type BuildTakeoffAuditMetadataInputByAction = {
  "takeoff.job.created": {
    level: TakeoffLevel;
    estimate_version_id: string;
    source_file_name: string | null;
    idempotency_key?: string | null;
  };
  "takeoff.job.processing": {
    attempt?: number;
    reason?: string | null;
  };
  "takeoff.job.completed": {
    result_id?: string | null;
    items_total?: number | null;
    warnings_total?: number | null;
    duration_ms?: number | null;
  };
  "takeoff.job.failed": {
    attempt?: number;
    error_code?: string | null;
    error_message?: string | null;
    retryable?: boolean;
  };
  "takeoff.job.retried": {
    from_attempt?: number;
    to_attempt?: number;
    reason?: string | null;
  };
  "takeoff.job.canceled": {
    reason?: string | null;
    canceled_by?: "user" | "system" | "admin";
  };
  "takeoff.item.excluded": {
    item_id: string;
    reason?: string | null;
  };
  "takeoff.item.modified": {
    item_id: string;
    field: string;
    previous_value?: Json | null;
    next_value?: Json | null;
    reason?: string | null;
  };
  "takeoff.apply.started": {
    estimate_version_id: string;
    selected_items_count?: number;
  };
  "takeoff.apply.completed": {
    estimate_version_id: string;
    applied_items_count?: number;
    excluded_items_count?: number;
  };
  "takeoff.apply.failed": {
    estimate_version_id: string;
    error_code?: string | null;
    error_message?: string | null;
    retryable?: boolean;
  };
};

type TakeoffAuditMetadataBuilders = {
  [Action in TakeoffAuditAction]: (
    input: BuildTakeoffAuditMetadataInputByAction[Action]
  ) => TakeoffAuditMetadataByAction[Action];
};

function normalizeNullableString(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const takeoffAuditMetadataBuilders: TakeoffAuditMetadataBuilders = {
  "takeoff.job.created": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.created"].parse({
      level: input.level,
      estimate_version_id: input.estimate_version_id,
      source_file_name: normalizeNullableString(input.source_file_name),
      idempotency_key: normalizeNullableString(input.idempotency_key ?? null),
    }),
  "takeoff.job.processing": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.processing"].parse({
      status: "processing",
      attempt: input.attempt,
      reason: normalizeNullableString(input.reason),
    }),
  "takeoff.job.completed": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.completed"].parse({
      status: "completed",
      result_id: input.result_id ?? null,
      items_total: input.items_total ?? null,
      warnings_total: input.warnings_total ?? null,
      duration_ms: input.duration_ms ?? null,
    }),
  "takeoff.job.failed": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.failed"].parse({
      status: "failed",
      attempt: input.attempt,
      error_code: normalizeNullableString(input.error_code),
      error_message: normalizeNullableString(input.error_message),
      retryable: input.retryable,
    }),
  "takeoff.job.retried": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.retried"].parse({
      status: "retried",
      from_attempt: input.from_attempt,
      to_attempt: input.to_attempt,
      reason: normalizeNullableString(input.reason),
    }),
  "takeoff.job.canceled": (input) =>
    takeoffAuditMetadataSchemas["takeoff.job.canceled"].parse({
      status: "canceled",
      reason: normalizeNullableString(input.reason),
      canceled_by: input.canceled_by,
    }),
  "takeoff.item.excluded": (input) =>
    takeoffAuditMetadataSchemas["takeoff.item.excluded"].parse({
      item_id: input.item_id,
      is_excluded: true,
      reason: normalizeNullableString(input.reason),
    }),
  "takeoff.item.modified": (input) =>
    takeoffAuditMetadataSchemas["takeoff.item.modified"].parse({
      item_id: input.item_id,
      field: input.field,
      previous_value: input.previous_value ?? null,
      next_value: input.next_value ?? null,
      reason: normalizeNullableString(input.reason),
    }),
  "takeoff.apply.started": (input) =>
    takeoffAuditMetadataSchemas["takeoff.apply.started"].parse({
      estimate_version_id: input.estimate_version_id,
      selected_items_count: input.selected_items_count,
    }),
  "takeoff.apply.completed": (input) =>
    takeoffAuditMetadataSchemas["takeoff.apply.completed"].parse({
      estimate_version_id: input.estimate_version_id,
      applied_items_count: input.applied_items_count,
      excluded_items_count: input.excluded_items_count,
    }),
  "takeoff.apply.failed": (input) =>
    takeoffAuditMetadataSchemas["takeoff.apply.failed"].parse({
      estimate_version_id: input.estimate_version_id,
      error_code: normalizeNullableString(input.error_code),
      error_message: normalizeNullableString(input.error_message),
      retryable: input.retryable,
    }),
};

type TakeoffAuditAfterData<Action extends TakeoffAuditAction> = {
  schema_version: 1;
  action: Action;
  job_id: string;
  tenant_id: string;
  user_id: string;
  metadata: TakeoffAuditMetadataByAction[Action];
};

export type LogTakeoffAuditEventInput<Action extends TakeoffAuditAction> = {
  supabase: Supabase;
  tenantId: string;
  userId: string;
  jobId: string;
  action: Action;
  metadata: TakeoffAuditMetadataByAction[Action];
  estimateVersionId?: string | null;
  tableName?: string;
  mode?: TakeoffAuditResilienceMode;
};

function normalizeTakeoffAuditMetadata<Action extends TakeoffAuditAction>(
  action: Action,
  metadata: TakeoffAuditMetadataByAction[Action]
) {
  const parsed = (takeoffAuditMetadataSchemas[action] as z.ZodTypeAny).safeParse(
    metadata
  );

  if (!parsed.success) {
    throw parsed.error;
  }

  return parsed.data as TakeoffAuditMetadataByAction[Action];
}

function handleTakeoffAuditFailure(input: {
  mode: TakeoffAuditResilienceMode;
  action: TakeoffAuditAction;
  tenantId: string;
  jobId: string;
  error: unknown;
}) {
  const normalizedError = toTakeoffError(input.error, {
    fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
    fallbackMessage: "Impossible d'enregistrer l'audit takeoff.",
    retryable: false,
    jobId: input.jobId,
    logUnexpected: false,
  });

  if (input.mode === "non-blocking") {
    console.error("Takeoff audit logging failed (non-blocking)", {
      action: input.action,
      tenantId: input.tenantId,
      jobId: input.jobId,
      error: normalizedError,
    });
    return;
  }

  throw normalizedError;
}

export async function logTakeoffAuditEvent<Action extends TakeoffAuditAction>(
  input: LogTakeoffAuditEventInput<Action>
) {
  const mode = input.mode ?? "fail-hard";

  try {
    const metadata = normalizeTakeoffAuditMetadata(input.action, input.metadata);
    const afterData: TakeoffAuditAfterData<Action> = {
      schema_version: 1,
      action: input.action,
      job_id: input.jobId,
      tenant_id: input.tenantId,
      user_id: input.userId,
      metadata,
    };

    const payload: AuditLogInsert = {
      tenant_id: input.tenantId,
      user_id: input.userId,
      table_name: input.tableName ?? "takeoff_jobs",
      record_id: input.jobId,
      estimate_version_id: input.estimateVersionId ?? null,
      action: input.action,
      after_data: afterData as Json,
    };

    const { error } = await input.supabase.from("audit_logs").insert(payload);

    if (!error) {
      return;
    }

    throw toTakeoffError(
      mapSupabaseError(error, "Impossible d'enregistrer l'audit takeoff."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  } catch (error) {
    handleTakeoffAuditFailure({
      mode,
      action: input.action,
      tenantId: input.tenantId,
      jobId: input.jobId,
      error,
    });
  }
}
