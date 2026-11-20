import { TAKEOFF_JOB_STATUSES, TAKEOFF_LEVELS as TAKEOFF_RESPONSE_LEVELS } from "@/lib/takeoff/enums";
import { parseTakeoffResponse } from "@/lib/takeoff/response-contracts";
import { z } from "zod";
import {
  type TakeoffJobResponse,
  type TakeoffLevel,
  type TakeoffProvider,
} from "@/lib/takeoff/types";
import { createHash } from "node:crypto";

export const TAKEOFF_PLAN_SET_LEVEL: TakeoffLevel = "C";
export const LEGACY_PLAN_SET_PROCESSING = { level: "B", provider: "auto" } as const;

const takeoffJobResponseSchema: z.ZodType<TakeoffJobResponse> = z.object({
  id: z.string().uuid(),
  status: z.enum(TAKEOFF_JOB_STATUSES),
  level: z.enum(TAKEOFF_RESPONSE_LEVELS),
  source_file_name: z.string().nullable(),
  estimate_version_id: z.string().uuid(),
  created_at: z.string(),
});

export type TakeoffJobRow = TakeoffJobResponse & {
  execution_provider?: "gemini" | "chatgpt_local";
  execution_host_id?: string | null;
  created_by?: string | null;
  source_file_path?: string | null;
  preparation_snapshot?: unknown;
};

export type TakeoffJobCreateResponse = TakeoffJobResponse;

function deriveDeterministicJobId(tenantId: string, idempotencyKey: string) {
  const seed = toHexSha256(`${tenantId}:${idempotencyKey}`);
  const bytes = Buffer.from(seed.slice(0, 32), "hex");

  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function derivePlanSetTakeoffJobId(input: {
  tenantId: string; projectId: string; planSetId: string; estimateVersionId: string;
  sourceVersionId?: string; preparationRevision?: number | null; level?: TakeoffLevel; provider?: TakeoffProvider;
}) {
  return deriveDeterministicJobId(input.tenantId, JSON.stringify({
    kind: "prepared-plan-set", project: input.projectId, set: input.planSetId,
    version: input.sourceVersionId ?? input.estimateVersionId,
    preparation: input.preparationRevision ?? null, level: input.level ?? LEGACY_PLAN_SET_PROCESSING.level,
    provider: input.provider ?? LEGACY_PLAN_SET_PROCESSING.provider,
  }));
}

export function normalizeTakeoffJobRow(row: TakeoffJobRow): TakeoffJobCreateResponse {
  return parseTakeoffResponse(takeoffJobResponseSchema, {
    id: row.id,
    status: row.status,
    level: row.level,
    source_file_name: row.source_file_name,
    estimate_version_id: row.estimate_version_id,
    created_at: row.created_at,
  });
}

function toHexSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
