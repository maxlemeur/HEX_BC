import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import {
  assertDraftStatus,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import {
  badRequest,
  conflict,
  mapSupabaseError,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { validateFileForUpload } from "@/lib/file-validation";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import type { Json } from "@/types/database";

const TAKEOFF_FILES_BUCKET = "takeoff-files";
const TAKEOFF_ALLOWED_EXTENSIONS = ["csv", "xlsx", "xls"];
const TAKEOFF_ALLOWED_MIME_TYPES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const TAKEOFF_LEVEL = "A";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const takeoffJobResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  level: z.string(),
  source_file_name: z.string().nullable(),
  estimate_version_id: z.string().uuid(),
  created_at: z.string(),
});

type TakeoffJobRow = z.infer<typeof takeoffJobResponseSchema> & {
  source_file_path?: string | null;
};

export type TakeoffJobCreateResponse = z.infer<typeof takeoffJobResponseSchema>;

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
    throw badRequest(
      "La valeur de l'en-tete Idempotency-Key est invalide.",
      undefined,
      "IDEMPOTENCY_KEY_INVALID"
    );
  }

  if (trimmed.length > 255) {
    throw unprocessableEntity(
      "La valeur de l'en-tete Idempotency-Key est trop longue.",
      undefined,
      "IDEMPOTENCY_KEY_INVALID"
    );
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
    throw payloadTooLarge(
      validation.error,
      undefined,
      "TAKEOFF_FILE_TOO_LARGE"
    );
  }

  if (
    validation.error.includes("Extension") ||
    validation.error.includes("MIME")
  ) {
    throw unprocessableEntity(
      validation.error,
      undefined,
      "TAKEOFF_FILE_TYPE_INVALID"
    );
  }

  throw badRequest(validation.error);
}

function parseEstimateVersionId(formData: FormData) {
  const value = formData.get("estimate_version_id");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Le champ estimate_version_id est requis.");
  }

  const estimateVersionId = value.trim();

  if (!isUuid(estimateVersionId)) {
    throw unprocessableEntity(
      "Le champ estimate_version_id doit etre un UUID valide.",
      undefined,
      "TAKEOFF_ESTIMATE_VERSION_ID_INVALID"
    );
  }

  return estimateVersionId;
}

function parseTakeoffLevel(formData: FormData) {
  const value = formData.get("level");

  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Le champ level est requis.");
  }

  const normalized = value.trim().toUpperCase();

  if (normalized !== TAKEOFF_LEVEL) {
    throw unprocessableEntity(
      "Le niveau Takeoff supporte pour cet endpoint est uniquement 'A'.",
      undefined,
      "TAKEOFF_LEVEL_UNSUPPORTED"
    );
  }

  return normalized;
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
    throw mapSupabaseError(error, "Impossible de verifier l'idempotence du job.");
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
    throw notFound("Version de chiffrage introuvable.");
  }

  const estimateProjects = data.estimate_projects as
    | { tenant_id: string; user_id: string }
    | Array<{ tenant_id: string; user_id: string }>
    | null;
  const project = Array.isArray(estimateProjects)
    ? estimateProjects[0]
    : estimateProjects;

  if (!project || project.tenant_id !== input.tenantId) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const canAccess =
    project.user_id === input.userId || input.tenantRole === "admin";
  if (!canAccess) {
    throw notFound("Version de chiffrage introuvable.");
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

async function logTakeoffJobCreatedAudit(input: {
  supabase: Awaited<ReturnType<typeof getAuthenticatedContext>>["supabase"];
  tenantId: string;
  userId: string;
  job: TakeoffJobRow;
  idempotencyKey: string | null;
}) {
  const afterData: Json = {
    job_id: input.job.id,
    tenant_id: input.tenantId,
    user_id: input.userId,
    level: input.job.level,
    estimate_version_id: input.job.estimate_version_id,
    source_file_name: input.job.source_file_name,
    idempotency_key: input.idempotencyKey,
  };

  const { error } = await input.supabase.from("audit_logs").insert({
    tenant_id: input.tenantId,
    user_id: input.userId,
    table_name: "takeoff_jobs",
    record_id: input.job.id,
    estimate_version_id: input.job.estimate_version_id,
    action: "takeoff.job.created",
    after_data: afterData,
  });

  if (error) {
    throw mapSupabaseError(error, "Impossible d'enregistrer l'audit takeoff.");
  }
}

export async function createTakeoffJobFromFormData(
  formData: FormData,
  input?: { idempotencyKey?: string | null }
): Promise<TakeoffJobCreateResponse> {
  const idempotencyKey = normalizeIdempotencyKey(input?.idempotencyKey);
  const fileEntry = formData.get("file");

  if (!(fileEntry instanceof File)) {
    throw badRequest("Le champ file est requis.");
  }

  const file = fileEntry;
  const estimateVersionId = parseEstimateVersionId(formData);
  const level = parseTakeoffLevel(formData);

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

  const { supabase, tenantId, userId, tenantRole } = await getAuthenticatedContext();

  const jobId = idempotencyKey
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

      throw conflict(
        "La cle d'idempotence est deja utilisee avec un payload different.",
        {
          job_id: existingJob.id,
        },
        "IDEMPOTENCY_KEY_REUSED"
      );
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
    throw badRequest("Impossible de televerser le fichier takeoff.", uploadError);
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
      }

      await removeUploadedFileIfPresent({
        supabase,
        storagePath: sourceFilePath,
      });

      throw conflict(
        "La cle d'idempotence est deja utilisee avec un payload different.",
        undefined,
        "IDEMPOTENCY_KEY_REUSED"
      );
    }

    await removeUploadedFileIfPresent({
      supabase,
      storagePath: sourceFilePath,
    });

    if (insertError) {
      throw mapSupabaseError(insertError, "Impossible de creer le job takeoff.");
    }

    throw badRequest("Impossible de creer le job takeoff.");
  }

  const createdJob = insertedJob as TakeoffJobRow;

  try {
    await logTakeoffJobCreatedAudit({
      supabase,
      tenantId,
      userId,
      job: createdJob,
      idempotencyKey,
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
}
