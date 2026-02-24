import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  assertDraftStatus,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import {
  TakeoffError,
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import { TakeoffMappingRuleSchema } from "@/lib/takeoff/schemas";
import {
  logTakeoffAuditEvent,
  takeoffAuditMetadataBuilders,
} from "@/lib/takeoff/audit";
import { validateFileForUpload } from "@/lib/file-validation";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import type {
  CreateTakeoffMappingRuleInput,
  TakeoffJobResponse,
  TakeoffLevel,
  TakeoffMappingRule,
  TakeoffMappingRuleDeleteResponse,
  TakeoffMappingRuleMutationResponse,
  TakeoffMappingRulesListResponse,
  UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const TAKEOFF_ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];
const TAKEOFF_ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const TAKEOFF_LEVEL: TakeoffLevel = "A";
const TAKEOFF_MAPPING_RULES_SELECT = [
  "id",
  "tenant_id",
  "created_at",
  "updated_at",
  "created_by",
  "name",
  "match_pattern",
  "match_type",
  "action",
  "action_params",
  "priority",
  "is_active",
].join(", ");
const TAKEOFF_TENANT_ADMIN_ROLE = "admin";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const takeoffJobResponseSchema: z.ZodType<TakeoffJobResponse> = z.object({
  id: z.string().uuid(),
  status: z.string(),
  level: z.string(),
  source_file_name: z.string().nullable(),
  estimate_version_id: z.string().uuid(),
  created_at: z.string(),
});

type TakeoffJobRow = TakeoffJobResponse & {
  source_file_path?: string | null;
};

type TakeoffMappingRuleRow = {
  id: string;
  tenant_id: string;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  name: string;
  match_pattern: string;
  match_type: string;
  action: string;
  action_params: unknown;
  priority: number;
  is_active: boolean;
};

export type TakeoffJobCreateResponse = TakeoffJobResponse;

function isUuid(value: string) {
  return UUID_REGEX.test(value);
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "upload";
}

function normalizeIdempotencyKey(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tete Idempotency-Key est invalide.",
      retryable: false,
    });
  }

  if (trimmed.length > 255) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.IDEMPOTENCY_KEY_INVALID,
      message: "La valeur de l'en-tete Idempotency-Key est trop longue.",
      retryable: false,
    });
  }

  return trimmed;
}

function toHexSha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

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

function extractPayloadFingerprint(path: string | null | undefined) {
  if (!path) return null;
  const match = path.match(/\/([a-f0-9]{64})-[^/]+$/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function normalizeTakeoffJobRow(row: TakeoffJobRow): TakeoffJobCreateResponse {
  return takeoffJobResponseSchema.parse({
    id: row.id,
    status: row.status,
    level: row.level,
    source_file_name: row.source_file_name,
    estimate_version_id: row.estimate_version_id,
    created_at: row.created_at,
  });
}

function assertTakeoffFileIsValid(file: File) {
  const validation = validateFileForUpload(file, {
    allowedExtensions: TAKEOFF_ALLOWED_EXTENSIONS,
    allowedMimeTypes: TAKEOFF_ALLOWED_MIME_TYPES,
    allowEmptyMimeType: false,
  });

  if (validation.valid) return;

  if (validation.error.includes("depasse")) {
    throw new TakeoffError({
      status: 413,
      code: TakeoffErrorCode.TAKEOFF_FILE_TOO_LARGE,
      message: validation.error,
      retryable: false,
    });
  }

  if (
    validation.error.includes("Extension") ||
    validation.error.includes("MIME")
  ) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_FILE_TYPE_INVALID,
      message: validation.error,
      retryable: false,
    });
  }

  throw new TakeoffError({
    status: 400,
    code: TakeoffErrorCode.BAD_REQUEST,
    message: validation.error,
    retryable: false,
  });
}

function parseEstimateVersionId(formData: FormData) {
  const value = formData.get("estimate_version_id");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ estimate_version_id est requis.",
      retryable: false,
    });
  }

  const estimateVersionId = value.trim();

  if (!isUuid(estimateVersionId)) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_ESTIMATE_VERSION_ID_INVALID,
      message: "Le champ estimate_version_id doit etre un UUID valide.",
      retryable: false,
    });
  }

  return estimateVersionId;
}

function parseTakeoffLevel(formData: FormData) {
  const value = formData.get("level");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TakeoffError({
      status: 400,
      code: TakeoffErrorCode.BAD_REQUEST,
      message: "Le champ level est requis.",
      retryable: false,
    });
  }

  const normalized = value.trim().toUpperCase();

  if (normalized !== TAKEOFF_LEVEL) {
    throw new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_LEVEL_UNSUPPORTED,
      message: "Le niveau Takeoff supporte pour cet endpoint est uniquement 'A'.",
      retryable: false,
    });
  }

  return normalized as TakeoffLevel;
}

function assertTakeoffMappingRulesAdminRole(tenantRole: string) {
  if (tenantRole === TAKEOFF_TENANT_ADMIN_ROLE) return;

  throw forbidden(
    "Seul un administrateur peut gerer les regles de mapping takeoff."
  );
}

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function normalizeTakeoffMappingRuleRow(row: TakeoffMappingRuleRow): TakeoffMappingRule {
  const parsed = TakeoffMappingRuleSchema.safeParse(row);

  if (!parsed.success) {
    throw unprocessableEntity(
      "Regle de mapping takeoff invalide.",
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

function assertRegexMatchPatternIsValid(matchType: string, matchPattern: string) {
  if (matchType !== "regex") return;

  try {
    new RegExp(matchPattern);
  } catch {
    throw unprocessableEntity(
      "Le champ match_pattern doit etre une regex valide.",
      {
        match_type: matchType,
        match_pattern: matchPattern,
      },
      "VALIDATION_ERROR"
    );
  }
}

function buildTakeoffMappingRuleInsertPayload(input: {
  tenantId: string;
  userId: string;
  rule: CreateTakeoffMappingRuleInput;
}) {
  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    created_by: input.userId,
    name: input.rule.name,
    match_pattern: input.rule.match_pattern,
    match_type: input.rule.match_type,
    action: input.rule.action,
    action_params: input.rule.action_params,
  };

  if ("priority" in input.rule) {
    payload.priority = input.rule.priority;
  }

  if ("is_active" in input.rule) {
    payload.is_active = input.rule.is_active;
  }

  return payload;
}

function buildTakeoffMappingRuleUpdatePayload(input: UpdateTakeoffMappingRuleInput) {
  const payload: Record<string, unknown> = {};

  if ("name" in input) payload.name = input.name;
  if ("match_pattern" in input) payload.match_pattern = input.match_pattern;
  if ("match_type" in input) payload.match_type = input.match_type;
  if ("action" in input) payload.action = input.action;
  if ("action_params" in input) payload.action_params = input.action_params;
  if ("priority" in input) payload.priority = input.priority;
  if ("is_active" in input) payload.is_active = input.is_active;

  return payload;
}

async function getTakeoffJobById(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { data, error } = await input.supabase
    .from("takeoff_jobs" as never)
    .select(
      "id, status, level, source_file_name, source_file_path, estimate_version_id, created_at" as never
    )
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never)
    .maybeSingle();

  if (error) {
    throw toTakeoffError(
      mapSupabaseError(error, "Impossible de verifier l'idempotence du job."),
      {
        fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
        retryable: false,
        jobId: input.jobId,
      }
    );
  }

  return (data ?? null) as TakeoffJobRow | null;
}

async function assertEstimateVersionAccessibleAsDraft(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  estimateVersionId: string;
  tenantId: string;
  userId: string;
  tenantRole: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_versions")
    .select("id, status, estimate_projects!inner(tenant_id, user_id)")
    .eq("id", input.estimateVersionId)
    .eq("tenant_id", input.tenantId)
    .single();

  if (error || !data) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const estimateProjects = data.estimate_projects as
    | { tenant_id: string; user_id: string }
    | Array<{ tenant_id: string; user_id: string }>
    | null;
  const project = Array.isArray(estimateProjects)
    ? estimateProjects[0]
    : estimateProjects;

  if (!project || project.tenant_id !== input.tenantId) {
    throw new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.NOT_FOUND,
      message: "Version de chiffrage introuvable.",
      retryable: false,
    });
  }

  const canAccess =
    project.user_id === input.userId || input.tenantRole === "admin";
  if (!canAccess) {
    throw new TakeoffError({
      status: 403,
      code: TakeoffErrorCode.TAKEOFF_TENANT_UNAUTHORIZED,
      message: "Acces interdit aux ressources de ce tenant.",
      retryable: false,
    });
  }

  assertDraftStatus(data.status);
}

async function removeUploadedFileIfPresent(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  storagePath: string;
}) {
  const { error } = await input.supabase.storage
    .from(TAKEOFF_FILES_BUCKET)
    .remove([input.storagePath]);

  if (error) {
    console.error("Failed to rollback takeoff storage upload", {
      storagePath: input.storagePath,
      error,
    });
  }
}

async function removeCreatedJobIfPresent(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  jobId: string;
}) {
  const { error } = await input.supabase
    .from("takeoff_jobs" as never)
    .delete()
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.jobId as never);

  if (error) {
    console.error("Failed to rollback takeoff job creation", {
      jobId: input.jobId,
      tenantId: input.tenantId,
      error,
    });
  }
}

export async function createTakeoffJobFromFormData(
  formData: FormData,
  input?: { idempotencyKey?: string | null }
): Promise<TakeoffJobCreateResponse> {
  let level: TakeoffLevel | undefined;
  let jobId: string | undefined;

  try {
    const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
    const fileEntry = formData.get("file");

    if (!(fileEntry instanceof File)) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.TAKEOFF_FILE_REQUIRED,
        message: "Le champ file est requis.",
        retryable: false,
      });
    }

    const file = fileEntry;
    const estimateVersionId = parseEstimateVersionId(formData);
    level = parseTakeoffLevel(formData);

    assertTakeoffFileIsValid(file);

    const fileContentHash = toHexSha256(Buffer.from(await file.arrayBuffer()));
    const payloadFingerprint = toHexSha256(
      JSON.stringify({
        estimate_version_id: estimateVersionId,
        level,
        file_name: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        file_content_hash: fileContentHash,
      })
    );

    const { supabase, tenantId, userId, tenantRole } =
      await getAuthenticatedContext();

    jobId = idempotencyKey
      ? deriveDeterministicJobId(tenantId, idempotencyKey)
      : randomUUID();

    if (idempotencyKey) {
      const existingJob = await getTakeoffJobById({
        supabase,
        tenantId,
        jobId,
      });

      if (existingJob) {
        const existingFingerprint = extractPayloadFingerprint(
          existingJob.source_file_path
        );

        if (existingFingerprint === payloadFingerprint) {
          return normalizeTakeoffJobRow(existingJob);
        }

        throw new TakeoffError({
          status: 409,
          code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
          message:
            "La cle d'idempotence est deja utilisee avec un payload different.",
          details: {
            job_id: existingJob.id,
          },
          retryable: false,
          jobId: existingJob.id,
          level,
        });
      }
    }

    await assertTakeoffEnabled(tenantId, { supabase });
    await assertEstimateVersionAccessibleAsDraft({
      supabase,
      tenantId,
      userId,
      tenantRole,
      estimateVersionId,
    });

    const sourceFileName = file.name.trim().length > 0 ? file.name : "upload";
    const sourceFilePath = `${tenantId}/${jobId}/${payloadFingerprint}-${sanitizeFilename(
      sourceFileName
    )}`;

    const { error: uploadError } = await supabase.storage
      .from(TAKEOFF_FILES_BUCKET)
      .upload(sourceFilePath, file, {
        contentType: file.type,
        upsert: Boolean(idempotencyKey),
      });

    if (uploadError) {
      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de televerser le fichier takeoff.",
        details: uploadError,
        retryable: false,
        jobId,
        level,
      });
    }

    const { data: insertedJob, error: insertError } = await supabase
      .from("takeoff_jobs" as never)
      .insert({
        id: jobId,
        tenant_id: tenantId,
        estimate_version_id: estimateVersionId,
        level: TAKEOFF_LEVEL,
        status: "pending",
        source_file_name: sourceFileName,
        source_file_path: sourceFilePath,
        source_file_type: file.type,
        source_file_size_bytes: file.size,
        prompt_version: getTakeoffPromptVersion(TAKEOFF_LEVEL),
        created_by: userId,
      } as never)
      .select(
        "id, status, level, source_file_name, source_file_path, estimate_version_id, created_at" as never
      )
      .single();

    if (insertError || !insertedJob) {
      if (idempotencyKey && insertError?.code === "23505") {
        const existingJob = await getTakeoffJobById({
          supabase,
          tenantId,
          jobId,
        });

        if (existingJob) {
          const existingFingerprint = extractPayloadFingerprint(
            existingJob.source_file_path
          );

          if (existingFingerprint === payloadFingerprint) {
            return normalizeTakeoffJobRow(existingJob);
          }

          await removeUploadedFileIfPresent({
            supabase,
            storagePath: sourceFilePath,
          });

          throw new TakeoffError({
            status: 409,
            code: TakeoffErrorCode.IDEMPOTENCY_KEY_REUSED,
            message:
              "La cle d'idempotence est deja utilisee avec un payload different.",
            details: {
              job_id: existingJob.id,
            },
            retryable: false,
            jobId: existingJob.id,
            level,
          });
        }

        await removeUploadedFileIfPresent({
          supabase,
          storagePath: sourceFilePath,
        });

        throw new TakeoffError({
          status: 404,
          code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
          message:
            "Le job Takeoff associe a la cle d'idempotence est introuvable.",
          details: {
            reason: "IDEMPOTENCY_KEY_CONFLICT_WITHOUT_JOB",
          },
          retryable: false,
          jobId,
          level,
        });
      }

      await removeUploadedFileIfPresent({
        supabase,
        storagePath: sourceFilePath,
      });

      if (insertError) {
        throw toTakeoffError(
          mapSupabaseError(insertError, "Impossible de creer le job takeoff."),
          {
            fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
            retryable: false,
            jobId,
            level,
          }
        );
      }

      throw new TakeoffError({
        status: 400,
        code: TakeoffErrorCode.BAD_REQUEST,
        message: "Impossible de creer le job takeoff.",
        retryable: false,
        jobId,
        level,
      });
    }

    const createdJob = insertedJob as TakeoffJobRow;

    try {
      const createdAuditMetadata =
        takeoffAuditMetadataBuilders["takeoff.job.created"]({
          level: TAKEOFF_LEVEL,
          estimate_version_id: createdJob.estimate_version_id,
          source_file_name: createdJob.source_file_name,
          idempotency_key: idempotencyKey,
        });

      await logTakeoffAuditEvent({
        supabase,
        tenantId,
        userId,
        jobId: createdJob.id,
        estimateVersionId: createdJob.estimate_version_id,
        action: "takeoff.job.created",
        metadata: createdAuditMetadata,
        mode: "fail-hard",
      });
    } catch (error) {
      await removeUploadedFileIfPresent({
        supabase,
        storagePath: sourceFilePath,
      });
      await removeCreatedJobIfPresent({
        supabase,
        tenantId,
        jobId: createdJob.id,
      });
      throw error;
    }

    return normalizeTakeoffJobRow(createdJob);
  } catch (error) {
    throw toTakeoffError(error, {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR,
      fallbackMessage: "Impossible de creer le job takeoff.",
      retryable: false,
      jobId,
      level,
    });
  }
}

export async function listTakeoffMappingRules(): Promise<TakeoffMappingRulesListResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .order("priority" as never, { ascending: true })
    .order("created_at" as never, { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de charger les regles de mapping takeoff."
    );
  }

  return {
    mapping_rules: ((data ?? []) as TakeoffMappingRuleRow[]).map((row) =>
      normalizeTakeoffMappingRuleRow(row)
    ),
  };
}

export async function createTakeoffMappingRule(
  input: CreateTakeoffMappingRuleInput
): Promise<TakeoffMappingRuleMutationResponse> {
  const { supabase, tenantId, tenantRole, userId } =
    await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  assertRegexMatchPatternIsValid(input.match_type, input.match_pattern);

  const insertPayload = buildTakeoffMappingRuleInsertPayload({
    tenantId,
    userId,
    rule: input,
  });

  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .insert(insertPayload as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de creer la regle de mapping takeoff."
      );
    }

    throw badRequest("Impossible de creer la regle de mapping takeoff.");
  }

  return {
    mapping_rule: normalizeTakeoffMappingRuleRow(data as TakeoffMappingRuleRow),
  };
}

export async function updateTakeoffMappingRule(
  ruleId: string,
  input: UpdateTakeoffMappingRuleInput
): Promise<TakeoffMappingRuleMutationResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data: existingRule, error: existingRuleError } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .maybeSingle();

  if (existingRuleError) {
    throw mapSupabaseError(
      existingRuleError,
      "Impossible de charger la regle de mapping takeoff."
    );
  }

  if (!existingRule) {
    throw notFound("Regle de mapping takeoff introuvable.");
  }

  const existing = normalizeTakeoffMappingRuleRow(existingRule as TakeoffMappingRuleRow);

  const nextMatchType = input.match_type ?? existing.match_type;
  const nextMatchPattern = input.match_pattern ?? existing.match_pattern;
  assertRegexMatchPatternIsValid(nextMatchType, nextMatchPattern);

  const payload = buildTakeoffMappingRuleUpdatePayload(input);
  const { data, error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .update(payload as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .select(TAKEOFF_MAPPING_RULES_SELECT as never)
    .single();

  if (error || !data) {
    if (error) {
      throw mapSupabaseError(
        error,
        "Impossible de mettre a jour la regle de mapping takeoff."
      );
    }

    throw badRequest("Impossible de mettre a jour la regle de mapping takeoff.");
  }

  return {
    mapping_rule: normalizeTakeoffMappingRuleRow(data as TakeoffMappingRuleRow),
  };
}

export async function deleteTakeoffMappingRule(
  ruleId: string
): Promise<TakeoffMappingRuleDeleteResponse> {
  const { supabase, tenantId, tenantRole } = await getAuthenticatedContext();
  assertTakeoffMappingRulesAdminRole(tenantRole);

  const { data: existingRule, error: existingRuleError } = await supabase
    .from("takeoff_mapping_rules" as never)
    .select("id" as never)
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never)
    .maybeSingle();

  if (existingRuleError) {
    throw mapSupabaseError(
      existingRuleError,
      "Impossible de charger la regle de mapping takeoff."
    );
  }

  if (!existingRule) {
    throw notFound("Regle de mapping takeoff introuvable.");
  }

  const { error } = await supabase
    .from("takeoff_mapping_rules" as never)
    .delete()
    .eq("tenant_id" as never, tenantId as never)
    .eq("id" as never, ruleId as never);

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de supprimer la regle de mapping takeoff."
    );
  }

  return {
    deleted: true,
    rule_id: ruleId,
  };
}
