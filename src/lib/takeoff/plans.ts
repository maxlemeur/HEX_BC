import { randomUUID } from "node:crypto";

import { cache } from "react";
import { z } from "zod";

import {
  conflict,
  internalError,
  mapSupabaseError,
  notFound,
  payloadTooLarge,
  unprocessableEntity,
} from "@/lib/estimates/errors";
import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

export const PLAN_FILES_BUCKET = "plan-files";
const PLAN_FILE_ALLOWED_MIME_TYPE = "application/pdf";
const PLAN_FILE_ALLOWED_EXTENSION = ".pdf";
const PLAN_FILE_MAX_SIZE_BYTES = 50 * 1024 * 1024;
const PLAN_FILE_MAX_SIZE_LABEL = "50 Mo";
const PLAN_FILE_UPLOAD_SIGNED_URL_TTL_SECONDS = 60 * 60 * 2;
const PLAN_FILE_DOWNLOAD_SIGNED_URL_TTL_SECONDS = 60 * 10;
const DEFAULT_PLAN_SETS_LIST_LIMIT = 50;
const MAX_PLAN_SETS_LIST_LIMIT = 100;

const PLAN_SET_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "project_id",
  "estimate_version_id",
  "name",
  "description",
  "metadata",
  "created_by",
].join(", ");

const PLAN_FILE_SELECT = [
  "id",
  "created_at",
  "updated_at",
  "tenant_id",
  "plan_set_id",
  "file_path",
  "file_name",
  "file_type",
  "file_size_bytes",
  "page_count",
  "file_hash",
  "metadata",
  "created_by",
].join(", ");

const requiredTextSchema = z
  .string()
  .trim()
  .min(1, "Champ obligatoire.");

const optionalNullableDescriptionSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(2000, "Description trop longue.").nullable()
);

const optionalNullableHashSchema = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  },
  z.string().max(256, "file_hash trop long.").nullable()
);

const optionalUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("estimate_version_id invalide.").optional()
);

const optionalProjectUuidSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  },
  z.string().uuid("project_id invalide.").optional()
);

const optionalLimitSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  },
  z
    .number()
    .int("limit doit etre un entier.")
    .min(1, "limit doit etre >= 1.")
    .max(MAX_PLAN_SETS_LIST_LIMIT, `limit doit etre <= ${MAX_PLAN_SETS_LIST_LIMIT}.`)
    .optional()
);

const optionalBooleanFlagSearchParamSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === "1" || normalized === "true") return true;
    if (normalized === "0" || normalized === "false") return false;
    return value;
  },
  z.boolean().optional()
);

const normalizedMimeTypeSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    return value.trim().toLowerCase();
  },
  z.string().min(1, "Champ obligatoire.")
);

const metadataSchema = z.record(z.string(), z.unknown());

export const planSetIdSchema = z.string().uuid("setId invalide.");
export const planFileIdSchema = z.string().uuid("fileId invalide.");

export const listPlanSetsQuerySchema = z
  .object({
    project_id: optionalProjectUuidSearchParamSchema,
    estimate_version_id: optionalUuidSearchParamSchema,
    limit: optionalLimitSearchParamSchema,
  })
  .strict();

export const listPlanFilesQuerySchema = z
  .object({
    include_download_url: optionalBooleanFlagSearchParamSchema,
  })
  .strict();

export const getPlanFileDetailQuerySchema = z
  .object({
    include_download_url: optionalBooleanFlagSearchParamSchema,
  })
  .strict();

export const createPlanSetSchema = z
  .object({
    project_id: z.string().uuid("project_id invalide.").optional(),
    estimate_version_id: z.string().uuid("estimate_version_id invalide.").optional(),
    name: requiredTextSchema.max(255, "Nom trop long."),
    description: optionalNullableDescriptionSchema,
    metadata: metadataSchema.optional().default({}),
  })
  .superRefine((input, ctx) => {
    if (!input.project_id && !input.estimate_version_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["project_id"],
        message: "project_id ou estimate_version_id est requis.",
      });
    }
  })
  .strict();

export const createPlanFileSchema = z
  .object({
    file_name: requiredTextSchema.max(255, "Nom de fichier trop long."),
    file_type: normalizedMimeTypeSchema,
    file_size_bytes: z.number().int("Entier attendu.").positive("Doit etre > 0."),
    page_count: z
      .number()
      .int("Entier attendu.")
      .min(1, "Doit etre >= 1.")
      .nullable()
      .optional(),
    file_hash: optionalNullableHashSchema,
    metadata: metadataSchema.optional().default({}),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.file_type !== PLAN_FILE_ALLOWED_MIME_TYPE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file_type"],
        message: "Seul le type MIME application/pdf est accepte.",
      });
    }

    if (!input.file_name.toLowerCase().endsWith(PLAN_FILE_ALLOWED_EXTENSION)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file_name"],
        message: "Le fichier doit avoir l'extension .pdf.",
      });
    }
  });

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;
type Supabase = AuthenticatedContext["supabase"];

const planSetRowSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.string(),
    updated_at: z.string(),
    tenant_id: z.string().uuid(),
    project_id: z.string().uuid(),
    estimate_version_id: z.string().uuid().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    metadata: metadataSchema,
    created_by: z.string().uuid().nullable(),
  })
  .strict();

const planFileRowSchema = z
  .object({
    id: z.string().uuid(),
    created_at: z.string(),
    updated_at: z.string(),
    tenant_id: z.string().uuid(),
    plan_set_id: z.string().uuid(),
    file_path: z.string(),
    file_name: z.string(),
    file_type: z.string(),
    file_size_bytes: z.number().int().nonnegative(),
    page_count: z.number().int().nullable(),
    file_hash: z.string().nullable(),
    metadata: metadataSchema,
    created_by: z.string().uuid().nullable(),
  })
  .strict();

export type ListPlanSetsQuery = z.infer<typeof listPlanSetsQuerySchema>;
export type ListPlanFilesQuery = z.infer<typeof listPlanFilesQuerySchema>;
export type GetPlanFileDetailQuery = z.infer<typeof getPlanFileDetailQuerySchema>;
export type CreatePlanSetInput = z.infer<typeof createPlanSetSchema>;
export type CreatePlanFileInput = z.infer<typeof createPlanFileSchema>;
export type PlanSet = z.infer<typeof planSetRowSchema>;
export type PlanFile = z.infer<typeof planFileRowSchema>;

type PlanCleanupIssue = {
  resource: "metadata" | "storage";
  file_id?: string;
  path?: string | null;
  message: string;
};

type PlanCleanupStatus = {
  metadata_deleted: boolean;
  storage_cleanup_attempted: boolean;
  storage_deleted_count: number;
  storage_failed_count: number;
  errors: PlanCleanupIssue[];
};

type CompensationFailure = {
  ok: false;
  stage: string;
  error: unknown;
};

type CompensationSuccess = {
  ok: true;
};

function toValidationIssues(error: z.ZodError) {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    code: issue.code,
    message: issue.message,
  }));
}

function parseWithSchema<T>(schema: z.ZodType<T>, payload: unknown, message: string): T {
  const parsed = schema.safeParse(payload);

  if (!parsed.success) {
    throw unprocessableEntity(
      message,
      {
        issues: toValidationIssues(parsed.error),
      },
      "VALIDATION_ERROR"
    );
  }

  return parsed.data;
}

function sanitizeFilename(filename: string) {
  const normalized = filename
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized.length > 0 ? normalized : "plan";
}

function sanitizePdfFilename(filename: string) {
  const sanitized = sanitizeFilename(filename);

  if (sanitized.toLowerCase().endsWith(PLAN_FILE_ALLOWED_EXTENSION)) {
    return sanitized;
  }

  return `${sanitized}${PLAN_FILE_ALLOWED_EXTENSION}`;
}

function buildPlanFileStoragePath(input: {
  tenantId: string;
  setId: string;
  fileId: string;
  fileName: string;
}) {
  return `${input.tenantId}/${input.setId}/${input.fileId}/${input.fileName}`;
}

function getStorageErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && Number.isFinite(status)) {
    return status;
  }

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === "string") {
    const parsed = Number.parseInt(statusCode, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function isMissingStorageObjectError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const status = getStorageErrorStatus(error);
  if (status !== 400 && status !== 404) {
    return false;
  }

  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") {
    const normalizedCode = code.toLowerCase();
    if (normalizedCode.includes("not_found") || normalizedCode.includes("nosuchkey")) {
      return true;
    }
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("does not exist") ||
    normalizedMessage.includes("no such")
  );
}

function normalizePlanSetRow(row: unknown): PlanSet {
  return parseWithSchema(
    planSetRowSchema,
    row,
    "Donnees plan_set invalides en base."
  );
}

function normalizePlanSetRows(rows: unknown[]): PlanSet[] {
  return rows.map((row) => normalizePlanSetRow(row));
}

function normalizePlanFileRow(row: unknown): PlanFile {
  return parseWithSchema(
    planFileRowSchema,
    row,
    "Donnees plan_file invalides en base."
  );
}

function normalizePlanFileRows(rows: unknown[]): PlanFile[] {
  return rows.map((row) => normalizePlanFileRow(row));
}

async function getAuthenticatedTakeoffContext() {
  const context = await getAuthenticatedContext();
  await assertTakeoffEnabled(context.tenantId, { supabase: context.supabase });
  return context;
}

async function resolveProjectIdForEstimateVersion(input: {
  supabase: Supabase;
  tenantId: string;
  estimateVersionId: string;
}): Promise<string | null> {
  const { data, error } = await input.supabase
    .from("estimate_versions" as never)
    .select("id, project_id" as never)
    .eq("tenant_id" as never, input.tenantId as never)
    .eq("id" as never, input.estimateVersionId as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de resoudre la version de devis.");
  }

  if (!data || typeof (data as { project_id?: unknown }).project_id !== "string") {
    return null;
  }

  return (data as { project_id: string }).project_id;
}

async function getPlanSetByIdOrThrow(input: {
  supabase: Supabase;
  setId: string;
}): Promise<PlanSet> {
  const { data, error } = await input.supabase
    .from("plan_sets" as never)
    .select(PLAN_SET_SELECT as never)
    .eq("id" as never, input.setId as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le jeu de plans.");
  }

  if (!data) {
    throw notFound(
      "Jeu de plans introuvable.",
      {
        set_id: input.setId,
      }
    );
  }

  return normalizePlanSetRow(data);
}

async function getPlanFileByIdOrThrow(input: {
  supabase: Supabase;
  setId: string;
  fileId: string;
}): Promise<PlanFile> {
  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select(PLAN_FILE_SELECT as never)
    .eq("plan_set_id" as never, input.setId as never)
    .eq("id" as never, input.fileId as never)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le fichier de plan.");
  }

  if (!data) {
    throw notFound(
      "Fichier de plan introuvable.",
      {
        set_id: input.setId,
        file_id: input.fileId,
      }
    );
  }

  return normalizePlanFileRow(data);
}

async function listPlanFilesBySetId(input: {
  supabase: Supabase;
  setId: string;
}): Promise<PlanFile[]> {
  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select(PLAN_FILE_SELECT as never)
    .eq("plan_set_id" as never, input.setId as never)
    .order("created_at" as never, { ascending: false });

  if (error) {
    throw mapSupabaseError(error, "Impossible de lister les fichiers de plan.");
  }

  return normalizePlanFileRows((data ?? []) as unknown[]);
}

async function getPlanFileStatsBySetIds(input: {
  supabase: Supabase;
  setIds: string[];
}) {
  if (input.setIds.length === 0) {
    return new Map<string, { fileCount: number; totalSizeBytes: number }>();
  }

  const { data, error } = await input.supabase
    .from("plan_files" as never)
    .select("id, plan_set_id, file_size_bytes" as never)
    .in("plan_set_id" as never, input.setIds as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible de compter les fichiers de plan.");
  }

  const stats = new Map<string, { fileCount: number; totalSizeBytes: number }>();
  for (const row of (data ?? []) as Array<{ id?: string; plan_set_id?: string; file_size_bytes?: number }>) {
    if (typeof row.plan_set_id !== "string") continue;
    const existing = stats.get(row.plan_set_id) ?? { fileCount: 0, totalSizeBytes: 0 };
    existing.fileCount += 1;
    existing.totalSizeBytes += (typeof row.file_size_bytes === "number" ? row.file_size_bytes : 0);
    stats.set(row.plan_set_id, existing);
  }

  return stats;
}

async function deletePlanFileMetadataById(input: {
  supabase: Supabase;
  setId: string;
  fileId: string;
}) {
  const { error } = await input.supabase
    .from("plan_files" as never)
    .delete()
    .eq("plan_set_id" as never, input.setId as never)
    .eq("id" as never, input.fileId as never);

  if (error) {
    return {
      ok: false as const,
      error,
    };
  }

  return {
    ok: true as const,
  };
}

async function restoreDeletedPlanFile(input: {
  supabase: Supabase;
  planFile: PlanFile;
}): Promise<CompensationSuccess | CompensationFailure> {
  const { error } = await input.supabase
    .from("plan_files" as never)
    .insert(
      {
        id: input.planFile.id,
        created_at: input.planFile.created_at,
        updated_at: input.planFile.updated_at,
        tenant_id: input.planFile.tenant_id,
        plan_set_id: input.planFile.plan_set_id,
        file_path: input.planFile.file_path,
        file_name: input.planFile.file_name,
        file_type: input.planFile.file_type,
        file_size_bytes: input.planFile.file_size_bytes,
        page_count: input.planFile.page_count,
        file_hash: input.planFile.file_hash,
        metadata: input.planFile.metadata,
        created_by: input.planFile.created_by,
      } as never
    );

  if (error) {
    return {
      ok: false,
      stage: "restore_plan_file",
      error,
    };
  }

  return {
    ok: true,
  };
}

async function restoreDeletedPlanSet(input: {
  supabase: Supabase;
  planSet: PlanSet;
  planFiles: PlanFile[];
}): Promise<CompensationSuccess | CompensationFailure> {
  const { error: restoreSetError } = await input.supabase
    .from("plan_sets" as never)
    .insert(
      {
        id: input.planSet.id,
        created_at: input.planSet.created_at,
        updated_at: input.planSet.updated_at,
        tenant_id: input.planSet.tenant_id,
        project_id: input.planSet.project_id,
        estimate_version_id: input.planSet.estimate_version_id,
        name: input.planSet.name,
        description: input.planSet.description,
        metadata: input.planSet.metadata,
        created_by: input.planSet.created_by,
      } as never
    );

  if (restoreSetError) {
    return {
      ok: false,
      stage: "restore_plan_set",
      error: restoreSetError,
    };
  }

  if (input.planFiles.length === 0) {
    return {
      ok: true,
    };
  }

  const { error: restoreFilesError } = await input.supabase
    .from("plan_files" as never)
    .insert(
      input.planFiles.map((file) => ({
        id: file.id,
        created_at: file.created_at,
        updated_at: file.updated_at,
        tenant_id: file.tenant_id,
        plan_set_id: file.plan_set_id,
        file_path: file.file_path,
        file_name: file.file_name,
        file_type: file.file_type,
        file_size_bytes: file.file_size_bytes,
        page_count: file.page_count,
        file_hash: file.file_hash,
        metadata: file.metadata,
        created_by: file.created_by,
      })) as never
    );

  if (restoreFilesError) {
    return {
      ok: false,
      stage: "restore_plan_files",
      error: restoreFilesError,
    };
  }

  return {
    ok: true,
  };
}

export function parseListPlanSetsQuery(payload: unknown): ListPlanSetsQuery {
  return parseWithSchema(
    listPlanSetsQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseListPlanFilesQuery(payload: unknown): ListPlanFilesQuery {
  return parseWithSchema(
    listPlanFilesQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseGetPlanFileDetailQuery(
  payload: unknown
): GetPlanFileDetailQuery {
  return parseWithSchema(
    getPlanFileDetailQuerySchema,
    payload,
    "Parametres de requete invalides."
  );
}

export function parseCreatePlanSetInput(payload: unknown): CreatePlanSetInput {
  return parseWithSchema(createPlanSetSchema, payload, "Payload invalide.");
}

export function parseCreatePlanFileInput(payload: unknown): CreatePlanFileInput {
  return parseWithSchema(createPlanFileSchema, payload, "Payload invalide.");
}

export async function listPlanSets(input: ListPlanSetsQuery) {
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();
  let targetProjectId = input.project_id ?? null;

  if (input.estimate_version_id) {
    const resolvedProjectId = await resolveProjectIdForEstimateVersion({
      supabase,
      tenantId,
      estimateVersionId: input.estimate_version_id,
    });

    if (!resolvedProjectId) {
      return {
        plan_sets: [],
      };
    }

    if (targetProjectId && targetProjectId !== resolvedProjectId) {
      throw unprocessableEntity(
        "project_id et estimate_version_id ne pointent pas vers la meme affaire.",
        {
          project_id: targetProjectId,
          estimate_version_id: input.estimate_version_id,
          resolved_project_id: resolvedProjectId,
        },
        "PLAN_SETS_SCOPE_MISMATCH"
      );
    }

    targetProjectId = resolvedProjectId;
  }

  let query = supabase
    .from("plan_sets" as never)
    .select(PLAN_SET_SELECT as never)
    .eq("tenant_id" as never, tenantId as never)
    .order("created_at" as never, { ascending: false });

  if (targetProjectId) {
    query = query.eq(
      "project_id" as never,
      targetProjectId as never
    );
  }

  query = query.limit(input.limit ?? DEFAULT_PLAN_SETS_LIST_LIMIT);

  const { data, error } = await query;

  if (error) {
    throw mapSupabaseError(error, "Impossible de lister les jeux de plans.");
  }

  const planSets = normalizePlanSetRows((data ?? []) as unknown[]);
  const fileStats = await getPlanFileStatsBySetIds({
    supabase,
    setIds: planSets.map((item) => item.id),
  });

  return {
    plan_sets: planSets.map((item) => {
      const stats = fileStats.get(item.id);
      return {
        ...item,
        file_count: stats?.fileCount ?? 0,
        total_size_bytes: stats?.totalSizeBytes ?? 0,
      };
    }),
  };
}

const projectIdParamSchema = z.string().uuid("project_id invalide.");
const versionIdParamSchema = z.string().uuid("versionId invalide.");

export const fetchPlanSetsForProject = cache(async (projectId: string) => {
  const parsedProjectId = parseWithSchema(
    projectIdParamSchema,
    projectId,
    "project_id invalide."
  );

  const response = await listPlanSets({
    project_id: parsedProjectId,
  });

  return response.plan_sets;
});

export const fetchLinkedTakeoffJobs = cache(async (versionId: string) => {
  const parsedVersionId = parseWithSchema(
    versionIdParamSchema,
    versionId,
    "versionId invalide."
  );
  const { supabase, tenantId } = await getAuthenticatedTakeoffContext();

  return listAccessibleTakeoffJobsForVersion({
    supabase,
    tenantId,
    versionId: parsedVersionId,
  });
});

export async function getPlanSet(setId: string) {
  const { supabase } = await getAuthenticatedTakeoffContext();

  const planSet = await getPlanSetByIdOrThrow({
    supabase,
    setId,
  });

  const planFiles = await listPlanFilesBySetId({
    supabase,
    setId,
  });

  const totalSizeBytes = planFiles.reduce(
    (acc, f) => acc + (typeof f.file_size_bytes === "number" ? f.file_size_bytes : 0),
    0
  );

  return {
    plan_set: {
      ...planSet,
      file_count: planFiles.length,
      total_size_bytes: totalSizeBytes,
    },
  };
}

export async function createPlanSet(input: CreatePlanSetInput) {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  let targetProjectId = input.project_id ?? null;
  const estimateVersionId = input.estimate_version_id ?? null;

  if (estimateVersionId) {
    const resolvedProjectId = await resolveProjectIdForEstimateVersion({
      supabase,
      tenantId,
      estimateVersionId,
    });

    if (!resolvedProjectId) {
      throw notFound(
        "Version de devis introuvable.",
        {
          estimate_version_id: estimateVersionId,
        }
      );
    }

    if (targetProjectId && targetProjectId !== resolvedProjectId) {
      throw unprocessableEntity(
        "project_id et estimate_version_id ne pointent pas vers la meme affaire.",
        {
          project_id: targetProjectId,
          estimate_version_id: estimateVersionId,
          resolved_project_id: resolvedProjectId,
        },
        "PLAN_SETS_SCOPE_MISMATCH"
      );
    }

    targetProjectId = resolvedProjectId;
  }

  if (!targetProjectId) {
    throw unprocessableEntity(
      "project_id ou estimate_version_id est requis.",
      {
        project_id: input.project_id ?? null,
        estimate_version_id: estimateVersionId,
      },
      "VALIDATION_ERROR"
    );
  }

  const { data, error } = await supabase
    .from("plan_sets" as never)
    .insert(
      {
        tenant_id: tenantId,
        project_id: targetProjectId,
        estimate_version_id: estimateVersionId,
        name: input.name,
        description: input.description,
        metadata: input.metadata,
        created_by: userId,
      } as never
    )
    .select(PLAN_SET_SELECT as never)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer le jeu de plans.");
  }

  if (!data) {
    throw internalError("Impossible de creer le jeu de plans.");
  }

  return {
    plan_set: normalizePlanSetRow(data),
  };
}

export async function deletePlanSet(setId: string) {
  const { supabase } = await getAuthenticatedTakeoffContext();

  const planSet = await getPlanSetByIdOrThrow({
    supabase,
    setId,
  });

  const planFiles = await listPlanFilesBySetId({
    supabase,
    setId,
  });

  const { error: deleteError } = await supabase
    .from("plan_sets" as never)
    .delete()
    .eq("id" as never, setId as never);

  if (deleteError) {
    throw mapSupabaseError(deleteError, "Impossible de supprimer le jeu de plans.");
  }

  const storagePaths = planFiles.map((file) => file.file_path);
  if (storagePaths.length > 0) {
    const { error: cleanupError } = await supabase.storage
      .from(PLAN_FILES_BUCKET)
      .remove(storagePaths);

    if (cleanupError) {
      const compensation = await restoreDeletedPlanSet({
        supabase,
        planSet,
        planFiles,
      });

      if (!compensation.ok) {
        throw internalError(
          "Suppression du jeu de plans incomplete: echec cleanup storage et echec compensation.",
          {
            set_id: setId,
            storage_error: cleanupError,
            compensation: {
              restored: false,
              stage: compensation.stage,
              error: compensation.error,
            },
          }
        );
      }

      throw conflict(
        "Suppression du jeu de plans annulee car le cleanup storage a echoue.",
        {
          set_id: setId,
          storage_error: cleanupError,
          compensation: {
            restored: true,
          },
        }
      );
    }
  }

  return {
    deleted: true as const,
    plan_set_id: setId,
    cleanup: {
      metadata_deleted: true,
      storage_cleanup_attempted: storagePaths.length > 0,
      storage_deleted_count: storagePaths.length,
      storage_failed_count: 0,
      errors: [],
    } satisfies PlanCleanupStatus,
  };
}

export async function listPlanFiles(input: {
  setId: string;
  includeDownloadUrl?: boolean;
}) {
  const { supabase } = await getAuthenticatedTakeoffContext();

  await getPlanSetByIdOrThrow({
    supabase,
    setId: input.setId,
  });

  const planFiles = await listPlanFilesBySetId({
    supabase,
    setId: input.setId,
  });

  if (!input.includeDownloadUrl) {
    return {
      plan_files: planFiles,
    };
  }

  const signedResults = await Promise.all(
    planFiles.map((planFile) =>
      supabase.storage
        .from(PLAN_FILES_BUCKET)
        .createSignedUrl(planFile.file_path, PLAN_FILE_DOWNLOAD_SIGNED_URL_TTL_SECONDS, {
          download: planFile.file_name,
        })
    )
  );

  return {
    plan_files: planFiles.map((planFile, index) => ({
      ...planFile,
      download_url: signedResults[index]?.data?.signedUrl ?? null,
    })),
  };
}

export async function createPlanFile(setId: string, input: CreatePlanFileInput) {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();

  await getPlanSetByIdOrThrow({
    supabase,
    setId,
  });

  if (input.file_size_bytes > PLAN_FILE_MAX_SIZE_BYTES) {
    throw payloadTooLarge(
      `Le fichier depasse ${PLAN_FILE_MAX_SIZE_LABEL}.`,
      {
        max_file_size_bytes: PLAN_FILE_MAX_SIZE_BYTES,
      },
      "TAKEOFF_FILE_TOO_LARGE"
    );
  }

  const fileId = randomUUID();
  const normalizedFileName = sanitizePdfFilename(input.file_name);
  const storagePath = buildPlanFileStoragePath({
    tenantId,
    setId,
    fileId,
    fileName: normalizedFileName,
  });

  const { data, error } = await supabase
    .from("plan_files" as never)
    .insert(
      {
        id: fileId,
        tenant_id: tenantId,
        plan_set_id: setId,
        file_path: storagePath,
        file_name: normalizedFileName,
        file_type: PLAN_FILE_ALLOWED_MIME_TYPE,
        file_size_bytes: input.file_size_bytes,
        page_count: input.page_count ?? null,
        file_hash: input.file_hash,
        metadata: input.metadata,
        created_by: userId,
      } as never
    )
    .select(PLAN_FILE_SELECT as never)
    .single();

  if (error) {
    throw mapSupabaseError(error, "Impossible d'enregistrer le fichier de plan.");
  }

  if (!data) {
    throw internalError(
      "Impossible d'enregistrer le fichier de plan.",
      {
        set_id: setId,
      }
    );
  }

  const planFile = normalizePlanFileRow(data);

  const { data: signedData, error: signedError } = await supabase.storage
    .from(PLAN_FILES_BUCKET)
    .createSignedUploadUrl(storagePath, {
      upsert: false,
    });

  if (signedError || !signedData?.signedUrl || !signedData.token) {
    const rollbackResult = await deletePlanFileMetadataById({
      supabase,
      setId,
      fileId,
    });

    if (!rollbackResult.ok) {
      throw internalError(
        "Impossible de generer l'URL d'upload signee et echec du rollback metadata.",
        {
          set_id: setId,
          file_id: fileId,
          storage_error: signedError,
          rollback_error: rollbackResult.error,
        }
      );
    }

    throw internalError(
      "Impossible de generer l'URL d'upload signee.",
      {
        set_id: setId,
        file_id: fileId,
        storage_error: signedError,
        compensation: {
          metadata_deleted: true,
        },
      }
    );
  }

  return {
    plan_file: planFile,
    signed_upload: {
      url: signedData.signedUrl,
      method: "PUT" as const,
      path: signedData.path,
      token: signedData.token,
      expires_in_seconds: PLAN_FILE_UPLOAD_SIGNED_URL_TTL_SECONDS,
    },
  };
}

export async function getPlanFileDetail(input: {
  setId: string;
  fileId: string;
  includeDownloadUrl?: boolean;
}) {
  const { supabase } = await getAuthenticatedTakeoffContext();

  await getPlanSetByIdOrThrow({
    supabase,
    setId: input.setId,
  });

  const planFile = await getPlanFileByIdOrThrow({
    supabase,
    setId: input.setId,
    fileId: input.fileId,
  });

  if (!input.includeDownloadUrl) {
    return {
      plan_file: planFile,
    };
  }

  const { data: signedData, error: signedError } = await supabase.storage
    .from(PLAN_FILES_BUCKET)
    .createSignedUrl(planFile.file_path, PLAN_FILE_DOWNLOAD_SIGNED_URL_TTL_SECONDS, {
      download: planFile.file_name,
    });

  if (signedError && isMissingStorageObjectError(signedError)) {
    return {
      plan_file: {
        ...planFile,
        download_url: null,
      },
    };
  }

  if (signedError || !signedData?.signedUrl) {
    throw internalError(
      "Impossible de generer l'URL de telechargement signee.",
      {
        set_id: input.setId,
        file_id: input.fileId,
        storage_error: signedError,
      }
    );
  }

  return {
    plan_file: {
      ...planFile,
      download_url: signedData.signedUrl,
    },
  };
}

export async function deletePlanFile(setId: string, fileId: string) {
  const { supabase } = await getAuthenticatedTakeoffContext();

  await getPlanSetByIdOrThrow({
    supabase,
    setId,
  });

  const planFile = await getPlanFileByIdOrThrow({
    supabase,
    setId,
    fileId,
  });

  const { error: deleteError } = await supabase
    .from("plan_files" as never)
    .delete()
    .eq("plan_set_id" as never, setId as never)
    .eq("id" as never, fileId as never);

  if (deleteError) {
    throw mapSupabaseError(deleteError, "Impossible de supprimer le fichier de plan.");
  }

  const { error: cleanupError } = await supabase.storage
    .from(PLAN_FILES_BUCKET)
    .remove([planFile.file_path]);

  if (cleanupError) {
    const compensation = await restoreDeletedPlanFile({
      supabase,
      planFile,
    });

    if (!compensation.ok) {
      throw internalError(
        "Suppression du fichier incomplete: echec cleanup storage et echec compensation.",
        {
          set_id: setId,
          file_id: fileId,
          storage_error: cleanupError,
          compensation: {
            restored: false,
            stage: compensation.stage,
            error: compensation.error,
          },
        }
      );
    }

    throw conflict(
      "Suppression du fichier annulee car le cleanup storage a echoue.",
      {
        set_id: setId,
        file_id: fileId,
        storage_error: cleanupError,
        compensation: {
          restored: true,
        },
      }
    );
  }

  return {
    deleted: true as const,
    plan_set_id: setId,
    file_id: fileId,
    cleanup: {
      metadata_deleted: true,
      storage_cleanup_attempted: true,
      storage_deleted_count: 1,
      storage_failed_count: 0,
      errors: [],
    } satisfies PlanCleanupStatus,
  };
}
