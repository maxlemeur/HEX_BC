import { randomUUID } from "node:crypto";

import * as XLSX from "xlsx";

import { getAuthenticatedContext } from "@/lib/estimates/server";
import {
  badRequest,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { validateFileForUpload } from "@/lib/file-validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callGeminiStructured, type GeminiStructuredFile } from "@/lib/takeoff/gemini-client";

import {
  AFFAIRE_INTAKE_BUCKET,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
  AFFAIRE_INTAKE_ALLOWED_EXTENSIONS,
  AFFAIRE_INTAKE_ALLOWED_MIME_TYPES,
  affaireIntakeClassificationResultSchema,
  affaireIntakeClassificationSourceSchema,
  affaireIntakeClassificationStatusSchema,
  affaireIntakeDocumentKindSchema,
  affaireIntakeDocumentUploadStatusSchema,
  affaireIntakeUploadStatusSchema,
  buildAffaireIntakeMissingPieces,
  buildAffaireIntakeStoragePath,
  createEmptyAffaireIntakeExtractedMetadata,
  deriveAffaireIntakeClassificationStatus,
  deriveAffaireIntakeUploadStatusFromDocuments,
  getAffaireIntakeFileExtension,
  getHeuristicAffaireDocumentClassification,
  inferAffaireIntakeMimeType,
  isMimeTypeSupportedForAiClassification,
  mergeAffaireDocumentClassificationWithHeuristic,
  normalizeAffaireIntakeExtractedMetadata,
  type AffaireIntakeClassificationResult,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeClassificationStatus,
  type AffaireIntakeDocumentKind,
  type AffaireIntakeDocumentUploadStatus,
  type AffaireIntakeExtractedMetadata,
  type AffaireIntakeUploadStatus,
  type AffaireIntakeWorkspaceMissingPiece,
} from "@/lib/affaires/intake";

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type AffaireProjectAccessRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  is_archived: boolean;
};

type AffaireIntakeUploadRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  created_by: string | null;
  status: AffaireIntakeUploadStatus;
  attempt_count: number;
  next_retry_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireIntakeDocumentRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  upload_id: string;
  created_by: string | null;
  storage_path: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  upload_status: AffaireIntakeDocumentUploadStatus;
  rejection_reason: string | null;
  classification_status: AffaireIntakeClassificationStatus;
  document_kind: AffaireIntakeDocumentKind;
  confidence: number | null;
  issues: string[];
  extracted_metadata: AffaireIntakeExtractedMetadata;
  classification_source: AffaireIntakeClassificationSource | null;
  classified_by: string | null;
  classified_at: string | null;
  manually_overridden_at: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireIntakeSupabaseMutationQuery = {
  eq: (column: string, value: string) => PromiseLike<unknown>;
};

type AffaireIntakeSupabaseInsertTable = {
  insert: (values: unknown) => PromiseLike<unknown>;
};

type AffaireIntakeSupabaseSelectQuery = {
  eq: (
    column: string,
    value: string
  ) => {
    order: (
      column: string,
      options: { ascending: boolean }
    ) => PromiseLike<unknown>;
  };
};

type AffaireIntakeSupabaseSelectTable = {
  select: (columns: string) => AffaireIntakeSupabaseSelectQuery;
};

type AffaireIntakeSupabaseUpdateTable = {
  update: (values: unknown) => AffaireIntakeSupabaseMutationQuery;
};

type AffaireIntakeSupabaseClient = {
  from: (table: string) => unknown;
};

type UploadCreateResponseFile = {
  documentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploaded" | "rejected";
  rejectionReason: string | null;
};

export type CreateAffaireIntakeUploadResult = {
  uploadId: string;
  files: UploadCreateResponseFile[];
  shouldProcessAsync: boolean;
};

export type AffaireIntakeWorkspace = {
  projectId: string;
  uploadId: string | null;
  documents: Array<{
    documentId: string;
    fileName: string;
    detectedCategory: AffaireIntakeDocumentKind;
    confidence: number;
    extractedMetadata: AffaireIntakeExtractedMetadata;
    issues: string[];
  }>;
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
  briefDraft: null;
};

const PROJECT_SELECT = "id, tenant_id, user_id, is_archived";
const UPLOAD_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "created_by",
  "status",
  "attempt_count",
  "next_retry_at",
  "last_error",
  "completed_at",
  "created_at",
  "updated_at",
].join(", ");
const DOCUMENT_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "upload_id",
  "created_by",
  "storage_path",
  "file_name",
  "mime_type",
  "size_bytes",
  "upload_status",
  "rejection_reason",
  "classification_status",
  "document_kind",
  "confidence",
  "issues",
  "extracted_metadata",
  "classification_source",
  "classified_by",
  "classified_at",
  "manually_overridden_at",
  "created_at",
  "updated_at",
].join(", ");

const AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION = "est371_affaire_intake_v1";
const AFFAIRE_INTAKE_CLASSIFICATION_MODEL = "gemini-3-flash-preview";
const AFFAIRE_INTAKE_CLASSIFICATION_THINKING_LEVEL = "low" as const;
const TEXT_SNIPPET_MAX_LENGTH = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringOrNull(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toNumberOrZero(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toTextArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
}

async function resolveSupabaseQuery<T>(query: unknown): Promise<T> {
  return (await (query as PromiseLike<T>)) as T;
}

function getAffaireIntakeInsertTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseInsertTable;
}

function getAffaireIntakeSelectTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseSelectTable;
}

function getAffaireIntakeUpdateTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseUpdateTable;
}

function normalizeUploadRow(row: unknown): AffaireIntakeUploadRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const status = affaireIntakeUploadStatusSchema.safeParse(row.status);
  if (!status.success || typeof row.id !== "string") {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    created_by: toStringOrNull(row.created_by),
    status: status.data,
    attempt_count: Math.max(0, Math.trunc(toNumberOrZero(row.attempt_count))),
    next_retry_at: toStringOrNull(row.next_retry_at),
    last_error: toStringOrNull(row.last_error),
    completed_at: toStringOrNull(row.completed_at),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function normalizeDocumentRow(row: unknown): AffaireIntakeDocumentRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const uploadStatus = affaireIntakeDocumentUploadStatusSchema.safeParse(
    row.upload_status
  );
  const classificationStatus = affaireIntakeClassificationStatusSchema.safeParse(
    row.classification_status
  );
  const documentKind = affaireIntakeDocumentKindSchema.safeParse(row.document_kind);

  if (
    !uploadStatus.success ||
    !classificationStatus.success ||
    !documentKind.success ||
    typeof row.id !== "string"
  ) {
    return null;
  }

  const classificationSource = affaireIntakeClassificationSourceSchema.safeParse(
    row.classification_source
  );

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    upload_id: typeof row.upload_id === "string" ? row.upload_id : "",
    created_by: toStringOrNull(row.created_by),
    storage_path: toStringOrNull(row.storage_path),
    file_name: typeof row.file_name === "string" ? row.file_name : "",
    mime_type: toStringOrNull(row.mime_type),
    size_bytes: Math.max(0, Math.trunc(toNumberOrZero(row.size_bytes))),
    upload_status: uploadStatus.data,
    rejection_reason: toStringOrNull(row.rejection_reason),
    classification_status: classificationStatus.data,
    document_kind: documentKind.data,
    confidence:
      typeof row.confidence === "number" && Number.isFinite(row.confidence)
        ? row.confidence
        : null,
    issues: toTextArray(row.issues),
    extracted_metadata: normalizeAffaireIntakeExtractedMetadata(
      row.extracted_metadata
    ),
    classification_source: classificationSource.success
      ? classificationSource.data
      : null,
    classified_by: toStringOrNull(row.classified_by),
    classified_at: toStringOrNull(row.classified_at),
    manually_overridden_at: toStringOrNull(row.manually_overridden_at),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function toSafeMimeType(file: File) {
  return file.type.trim().toLowerCase() || inferAffaireIntakeMimeType(file.name) || "application/octet-stream";
}

function addIssue(issues: string[], issue: string) {
  const trimmed = issue.trim();
  if (!trimmed) {
    return issues;
  }

  if (issues.includes(trimmed)) {
    return issues;
  }

  return [...issues, trimmed].slice(0, 10);
}

function buildClassificationPrompt(input: { fileName: string; mimeType: string }) {
  return [
    "ROLE",
    "Tu classes des documents d'un dossier de chiffrage BTP.",
    "",
    "CONTEXTE",
    `- prompt_version: ${AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION}`,
    `- file_name: ${input.fileName}`,
    `- mime_type: ${input.mimeType}`,
    "",
    "CATEGORIES",
    "dpgf | plans | cctp | bpu_dqe | annexes | emails | a_classer",
    "",
    "OBJECTIF",
    "Retourner la categorie la plus probable, un score de confiance entre 0 et 1, les ambiguities, et les metadonnees utiles pour ouvrir l'affaire.",
    "",
    "METADONNEES",
    "- projectName: nom du projet si identifiable",
    "- clientName: maitre d'ouvrage / client si identifiable",
    "- deadlineAt: date limite ISO 8601 si explicite, sinon null",
    "- detectedLots: lots explicitement cites",
    "- detectedVariants: variantes explicitement citees",
    "",
    "REGLES",
    "1. Ne jamais inventer d'information non visible dans le document.",
    "2. Si le document est ambigu, reduire confidence et utiliser a_classer si aucune categorie n'est defensible.",
    "3. Les issues doivent etre courtes, orientees action et decrire le doute ou l'erreur de lecture.",
    "4. Retourner un JSON strict conforme au schema fourni, sans markdown.",
  ].join("\n");
}

async function buildSpreadsheetSnippet(fileName: string, bytes: ArrayBuffer) {
  const workbook = XLSX.read(Buffer.from(bytes), { type: "buffer" });
  const lines: string[] = [`Workbook: ${fileName}`];

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(
      worksheet,
      {
        header: 1,
        blankrows: false,
      }
    );

    lines.push(`Sheet: ${sheetName}`);

    for (const row of rows.slice(0, 12)) {
      const normalizedRow = row
        .map((cell) =>
          cell === null || cell === undefined ? "" : String(cell).trim()
        )
        .filter((cell) => cell.length > 0)
        .join(" | ");

      if (normalizedRow.length > 0) {
        lines.push(normalizedRow);
      }
    }
  }

  return lines.join("\n").slice(0, TEXT_SNIPPET_MAX_LENGTH);
}

function buildTextFilePayload(text: string, mimeType = "text/plain"): GeminiStructuredFile | null {
  const snippet = text.trim().slice(0, TEXT_SNIPPET_MAX_LENGTH);
  if (snippet.length === 0) {
    return null;
  }

  return {
    data: Buffer.from(snippet, "utf8").toString("base64"),
    mimeType,
  };
}

async function buildClassificationFilePayload(input: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<GeminiStructuredFile | null> {
  const normalizedMimeType = input.mimeType.trim().toLowerCase();
  const extension = getAffaireIntakeFileExtension(input.fileName);

  if (
    normalizedMimeType === "application/vnd.ms-excel" ||
    normalizedMimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    extension === "xls" ||
    extension === "xlsx"
  ) {
    const snippet = await buildSpreadsheetSnippet(input.fileName, input.bytes);
    return buildTextFilePayload(snippet);
  }

  if (
    normalizedMimeType === "text/plain" ||
    normalizedMimeType === "text/csv" ||
    normalizedMimeType === "message/rfc822" ||
    extension === "txt" ||
    extension === "csv" ||
    extension === "eml"
  ) {
    const text = Buffer.from(input.bytes).toString("utf8");
    return buildTextFilePayload(
      text,
      normalizedMimeType === "text/csv" ? "text/csv" : "text/plain"
    );
  }

  if (isMimeTypeSupportedForAiClassification(normalizedMimeType)) {
    return {
      data: Buffer.from(input.bytes).toString("base64"),
      mimeType: normalizedMimeType,
    };
  }

  return null;
}

async function classifyAffaireIntakeDocument(input: {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer;
}): Promise<AffaireIntakeClassificationResult> {
  const heuristicResult = getHeuristicAffaireDocumentClassification({
    fileName: input.fileName,
    mimeType: input.mimeType,
  });

  let filePayload: GeminiStructuredFile | null = null;

  try {
    filePayload = await buildClassificationFilePayload(input);
  } catch (error) {
    console.error("Failed to build affaire intake classification payload", {
      fileName: input.fileName,
      error,
    });
  }

  if (!filePayload) {
    return {
      ...heuristicResult,
      issues: addIssue(
        heuristicResult.issues,
        "Analyse IA indisponible pour ce format, classement heuristique applique."
      ),
    };
  }

  try {
    const geminiResult = await callGeminiStructured({
      prompt: buildClassificationPrompt({
        fileName: input.fileName,
        mimeType: input.mimeType,
      }),
      schema: affaireIntakeClassificationResultSchema,
      files: [filePayload],
      thinkingLevel: AFFAIRE_INTAKE_CLASSIFICATION_THINKING_LEVEL,
      context: {
        model: AFFAIRE_INTAKE_CLASSIFICATION_MODEL,
        promptVersion: AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION,
      },
    });

    return mergeAffaireDocumentClassificationWithHeuristic({
      aiResult: geminiResult.data,
      heuristicResult,
    });
  } catch (error) {
    console.error("Affaire intake AI classification failed", {
      fileName: input.fileName,
      error,
    });

    return {
      ...heuristicResult,
      issues: addIssue(
        heuristicResult.issues,
        "Classification heuristique retenue car l'analyse IA a echoue."
      ),
    };
  }
}

async function requireAffaireProjectOwnerOrAdmin(
  projectId: string
): Promise<{
  context: AuthenticatedContext;
  project: AffaireProjectAccessRow;
}> {
  const context = await getAuthenticatedContext();
  const { data, error } = await context.supabase
    .from("estimate_projects")
    .select(PROJECT_SELECT)
    .eq("id", projectId)
    .eq("tenant_id", context.tenantId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger l'affaire.");
  }

  const project = data as AffaireProjectAccessRow | null;

  if (!project || project.is_archived) {
    throw notFound("Affaire introuvable.");
  }

  if (project.user_id !== context.userId && context.tenantRole !== "admin") {
    throw forbidden("Acces refuse a cette affaire.");
  }

  return {
    context,
    project,
  };
}

async function insertAffaireIntakeEvent(input: {
  supabase: AffaireIntakeSupabaseClient;
  uploadId?: string | null;
  documentId?: string | null;
  actorUserId?: string | null;
  eventType:
    | "upload.created"
    | "document.uploaded"
    | "document.rejected"
    | "document.classified"
    | "document.classification_failed"
    | "document.reclassified"
    | "upload.completed";
  reason?: string | null;
  beforePayload?: unknown;
  afterPayload?: unknown;
}) {
  const { error } = await resolveSupabaseQuery<{ error: unknown }>(
    getAffaireIntakeInsertTable(input.supabase, "affaire_intake_events")
      .insert({
        upload_id: input.uploadId ?? null,
        document_id: input.documentId ?? null,
        actor_user_id: input.actorUserId ?? null,
        event_type: input.eventType,
        reason: input.reason ?? null,
        before_payload: input.beforePayload ?? null,
        after_payload: input.afterPayload ?? null,
      } as never)
  );

  if (error) {
    console.error("Failed to persist affaire intake event", {
      uploadId: input.uploadId,
      documentId: input.documentId,
      eventType: input.eventType,
      error,
    });
  }
}

async function updateUploadStatusFromStoredDocuments(input: {
  supabase: AffaireIntakeSupabaseClient;
  uploadId: string;
}) {
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    getAffaireIntakeSelectTable(input.supabase, "affaire_intake_documents")
      .select("upload_status, classification_status, document_kind")
      .eq("upload_id", input.uploadId)
      .order("created_at", { ascending: true })
  );

  if (error) {
    throw internalError(
      "Impossible de recalculer le statut du workspace intake.",
      error
    );
  }

  const normalizedDocuments = (data ?? [])
    .map((row) => {
      if (!isRecord(row)) {
        return null;
      }

      const uploadStatus = affaireIntakeDocumentUploadStatusSchema.safeParse(
        row.upload_status
      );
      const classificationStatus =
        affaireIntakeClassificationStatusSchema.safeParse(
          row.classification_status
        );
      const documentKind = affaireIntakeDocumentKindSchema.safeParse(
        row.document_kind
      );

      if (
        !uploadStatus.success ||
        !classificationStatus.success ||
        !documentKind.success
      ) {
        return null;
      }

      return {
        uploadStatus: uploadStatus.data,
        classificationStatus: classificationStatus.data,
        documentKind: documentKind.data,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const status = deriveAffaireIntakeUploadStatusFromDocuments(normalizedDocuments);
  const nowIso = new Date().toISOString();

  const { error: updateError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    getAffaireIntakeUpdateTable(input.supabase, "affaire_intake_uploads")
      .update({
        status,
        completed_at:
          status === "ready" || status === "partial_failure" || status === "failed"
            ? nowIso
            : null,
        next_retry_at: null,
      } as never)
      .eq("id", input.uploadId)
  );

  if (updateError) {
    throw internalError(
      "Impossible de mettre a jour le statut de l'upload intake.",
      updateError
    );
  }

  return status;
}

function collectFilesFromFormData(formData: FormData) {
  const batchEntries = formData.getAll("files");
  const fallback = batchEntries.length === 0 ? formData.get("file") : null;

  return [...batchEntries, ...(fallback ? [fallback] : [])].filter(
    (entry): entry is File => entry instanceof File
  );
}

export async function createAffaireIntakeUpload(
  projectId: string,
  formData: FormData
): Promise<CreateAffaireIntakeUploadResult> {
  const { context, project } = await requireAffaireProjectOwnerOrAdmin(projectId);
  const files = collectFilesFromFormData(formData);

  if (files.length === 0) {
    throw badRequest("Aucun fichier fourni.");
  }

  const { data: uploadData, error: uploadError } = await context.supabase
    .from("affaire_intake_uploads" as never)
    .insert({
      project_id: project.id,
      created_by: context.userId,
      status: "queued",
    } as never)
    .select(UPLOAD_SELECT as never)
    .single();

  if (uploadError) {
    throw mapSupabaseError(
      uploadError,
      "Impossible d'initialiser l'upload intake."
    );
  }

  const upload = normalizeUploadRow(uploadData);

  if (!upload) {
    throw internalError("L'upload intake retourne une reponse invalide.");
  }

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: upload.id,
    actorUserId: context.userId,
    eventType: "upload.created",
    afterPayload: {
      status: upload.status,
      file_count: files.length,
    },
  });

  let uploadedCount = 0;
  const responses: UploadCreateResponseFile[] = [];

  for (const file of files) {
    const documentId = randomUUID();
    const mimeType = toSafeMimeType(file);
    const storagePath = buildAffaireIntakeStoragePath({
      tenantId: project.tenant_id,
      projectId: project.id,
      uploadId: upload.id,
      documentId,
      fileName: file.name,
    });

    const validation = validateFileForUpload(file, {
      maxFileSizeBytes: AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
      maxFileSizeLabel: AFFAIRE_INTAKE_MAX_FILE_SIZE_LABEL,
      allowedExtensions: [...AFFAIRE_INTAKE_ALLOWED_EXTENSIONS],
      allowedMimeTypes: [...AFFAIRE_INTAKE_ALLOWED_MIME_TYPES],
      allowEmptyMimeType: true,
    });

    const { error: insertError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .insert({
          id: documentId,
          upload_id: upload.id,
          created_by: context.userId,
          storage_path: validation.valid ? storagePath : null,
          file_name: file.name,
          mime_type: mimeType,
          size_bytes: file.size,
          upload_status: validation.valid ? "pending" : "rejected",
          rejection_reason: validation.valid ? null : validation.error,
          classification_status: validation.valid ? "queued" : "failed",
          document_kind: "a_classer",
          issues: validation.valid ? [] : [validation.error],
          extracted_metadata: createEmptyAffaireIntakeExtractedMetadata(),
        } as never)
    );

    if (insertError) {
      throw internalError(
        "Impossible d'enregistrer le document intake.",
        insertError
      );
    }

    if (!validation.valid) {
      await insertAffaireIntakeEvent({
        supabase: context.supabase,
        uploadId: upload.id,
        documentId,
        actorUserId: context.userId,
        eventType: "document.rejected",
        reason: validation.error,
      });

      responses.push({
        documentId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        status: "rejected",
        rejectionReason: validation.error,
      });
      continue;
    }

    const { error: storageError } = await context.supabase.storage
      .from(AFFAIRE_INTAKE_BUCKET)
      .upload(storagePath, file, {
        contentType: mimeType,
        upsert: false,
      });

    if (storageError) {
      const { error: rejectError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        context.supabase
          .from("affaire_intake_documents" as never)
          .update({
            upload_status: "rejected",
            rejection_reason: "Impossible de televerser le fichier dans le storage.",
            classification_status: "failed",
            issues: ["Impossible de televerser le fichier dans le storage."],
          } as never)
          .eq("id", documentId)
      );

      if (rejectError) {
        console.error("Failed to mark intake document as rejected after storage failure", {
          documentId,
          error: rejectError,
        });
      }

      await insertAffaireIntakeEvent({
        supabase: context.supabase,
        uploadId: upload.id,
        documentId,
        actorUserId: context.userId,
        eventType: "document.rejected",
        reason: "Impossible de televerser le fichier dans le storage.",
      });

      responses.push({
        documentId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        status: "rejected",
        rejectionReason: "Impossible de televerser le fichier dans le storage.",
      });
      continue;
    }

    const { error: uploadedError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .update({
          upload_status: "uploaded",
        } as never)
        .eq("id", documentId)
    );

    if (uploadedError) {
      throw internalError(
        "Impossible de finaliser le document intake televerse.",
        uploadedError
      );
    }

    uploadedCount += 1;

    await insertAffaireIntakeEvent({
      supabase: context.supabase,
      uploadId: upload.id,
      documentId,
      actorUserId: context.userId,
      eventType: "document.uploaded",
      afterPayload: {
        file_name: file.name,
        mime_type: mimeType,
        size_bytes: file.size,
      },
    });

    responses.push({
      documentId,
      fileName: file.name,
      mimeType,
      sizeBytes: file.size,
      status: "uploaded",
      rejectionReason: null,
    });
  }

  const finalUploadStatus: AffaireIntakeUploadStatus =
    uploadedCount > 0 ? "queued" : "failed";

  const { error: finalizeError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_uploads" as never)
      .update({
        status: finalUploadStatus,
        completed_at: uploadedCount > 0 ? null : new Date().toISOString(),
        last_error: uploadedCount > 0 ? null : "Aucun fichier n'a pu etre televerse.",
      } as never)
      .eq("id", upload.id)
  );

  if (finalizeError) {
    throw internalError(
      "Impossible de finaliser le statut de l'upload intake.",
      finalizeError
    );
  }

  return {
    uploadId: upload.id,
    files: responses,
    shouldProcessAsync: uploadedCount > 0,
  };
}

async function getUploadForProcessing(uploadId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    supabase
      .from("affaire_intake_uploads" as never)
      .select(UPLOAD_SELECT as never)
      .eq("id", uploadId)
      .maybeSingle()
  );

  if (error) {
    throw internalError("Impossible de charger l'upload intake.", error);
  }

  const upload = normalizeUploadRow(data);
  if (!upload) {
    throw notFound("Upload intake introuvable.");
  }

  return {
    supabase,
    upload,
  };
}

export async function processAffaireIntakeUpload(uploadId: string) {
  const { supabase, upload } = await getUploadForProcessing(uploadId);

  if (upload.status !== "queued") {
    return upload.status;
  }

  const nowIso = new Date().toISOString();
  const { error: processingError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    supabase
      .from("affaire_intake_uploads" as never)
      .update({
        status: "processing",
        attempt_count: upload.attempt_count + 1,
        next_retry_at: null,
        last_error: null,
        completed_at: null,
      } as never)
      .eq("id", upload.id)
  );

  if (processingError) {
    throw internalError(
      "Impossible de marquer l'upload intake comme en cours de traitement.",
      processingError
    );
  }

  const { data: docsData, error: docsError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    supabase
      .from("affaire_intake_documents" as never)
      .select(DOCUMENT_SELECT as never)
      .eq("upload_id", upload.id)
      .order("created_at", { ascending: true })
  );

  if (docsError) {
    throw internalError(
      "Impossible de charger les documents du workspace intake.",
      docsError
    );
  }

  const documents = (docsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);

  for (const document of documents) {
    if (document.upload_status !== "uploaded") {
      continue;
    }

    if (
      document.classification_source === "manual" &&
      document.classification_status !== "queued"
    ) {
      continue;
    }

    if (
      document.classification_status !== "queued" &&
      document.classification_status !== "failed"
    ) {
      continue;
    }

    const { error: markProcessingError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      supabase
        .from("affaire_intake_documents" as never)
        .update({
          classification_status: "processing",
        } as never)
        .eq("id", document.id)
    );

    if (markProcessingError) {
      console.error("Failed to mark intake document as processing", {
        documentId: document.id,
        error: markProcessingError,
      });
      continue;
    }

    if (!document.storage_path) {
      const { error: markFailedError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents" as never)
          .update({
            classification_status: "failed",
            issues: ["Chemin storage manquant pour le document intake."],
          } as never)
          .eq("id", document.id)
      );

      if (markFailedError) {
        console.error("Failed to mark intake document missing storage path", {
          documentId: document.id,
          error: markFailedError,
        });
      }

      await insertAffaireIntakeEvent({
        supabase,
        uploadId: upload.id,
        documentId: document.id,
        eventType: "document.classification_failed",
        reason: "Chemin storage manquant pour le document intake.",
      });
      continue;
    }

    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(AFFAIRE_INTAKE_BUCKET)
        .download(document.storage_path);

      if (downloadError || !blob) {
        throw downloadError ?? new Error("Missing blob from storage.");
      }

      const bytes = await blob.arrayBuffer();
      const mimeType =
        document.mime_type ??
        inferAffaireIntakeMimeType(document.file_name) ??
        "application/octet-stream";
      const classification = await classifyAffaireIntakeDocument({
        fileName: document.file_name,
        mimeType,
        bytes,
      });
      const classificationStatus = deriveAffaireIntakeClassificationStatus({
        documentKind: classification.documentKind,
        confidence: classification.confidence,
      });

      const { error: updateDocumentError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents" as never)
          .update({
            classification_status: classificationStatus,
            document_kind: classification.documentKind,
            confidence: classification.confidence,
            issues: classification.issues,
            extracted_metadata: classification.extractedMetadata,
            classification_source: "ai",
            classified_at: nowIso,
          } as never)
          .eq("id", document.id)
      );

      if (updateDocumentError) {
        throw updateDocumentError;
      }

      await insertAffaireIntakeEvent({
        supabase,
        uploadId: upload.id,
        documentId: document.id,
        eventType: "document.classified",
        afterPayload: {
          document_kind: classification.documentKind,
          classification_status: classificationStatus,
          confidence: classification.confidence,
        },
      });
    } catch (error) {
      console.error("Affaire intake document processing failed", {
        uploadId: upload.id,
        documentId: document.id,
        error,
      });

      const { error: markFailedError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents" as never)
          .update({
            classification_status: "failed",
            issues: ["Impossible d'analyser le document dans le workspace intake."],
          } as never)
          .eq("id", document.id)
      );

      if (markFailedError) {
        console.error("Failed to persist intake classification failure", {
          documentId: document.id,
          error: markFailedError,
        });
      }

      await insertAffaireIntakeEvent({
        supabase,
        uploadId: upload.id,
        documentId: document.id,
        eventType: "document.classification_failed",
        reason: "Impossible d'analyser le document dans le workspace intake.",
      });
    }
  }

  const status = await updateUploadStatusFromStoredDocuments({
    supabase,
    uploadId: upload.id,
  });

  await insertAffaireIntakeEvent({
    supabase,
    uploadId: upload.id,
    eventType: "upload.completed",
    afterPayload: {
      status,
    },
  });

  return status;
}

export async function fetchAffaireIntakeWorkspace(
  projectId: string
): Promise<AffaireIntakeWorkspace> {
  const { context, project } = await requireAffaireProjectOwnerOrAdmin(projectId);

  const { data: uploadData, error: uploadError } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_uploads" as never)
      .select(UPLOAD_SELECT as never)
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle()
  );

  if (uploadError) {
    throw internalError(
      "Impossible de charger le dernier upload intake.",
      uploadError
    );
  }

  const upload = normalizeUploadRow(uploadData);

  if (!upload) {
    return {
      projectId: project.id,
      uploadId: null,
      documents: [],
      missingPieces: [],
      briefDraft: null,
    };
  }

  const { data: docsData, error: docsError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents" as never)
      .select(DOCUMENT_SELECT as never)
      .eq("upload_id", upload.id)
      .order("created_at", { ascending: true })
  );

  if (docsError) {
    throw internalError(
      "Impossible de charger les documents intake.",
      docsError
    );
  }

  const documents = (docsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);

  return {
    projectId: project.id,
    uploadId: upload.id,
    documents: documents.map((document) => ({
      documentId: document.id,
      fileName: document.file_name,
      detectedCategory: document.document_kind,
      confidence: document.confidence ?? 0,
      extractedMetadata: document.extracted_metadata,
      issues: [
        ...document.issues,
        ...(document.rejection_reason ? [document.rejection_reason] : []),
      ],
    })),
    missingPieces: buildAffaireIntakeMissingPieces(
      documents.map((document) => ({
        uploadStatus: document.upload_status,
        classificationStatus: document.classification_status,
        documentKind: document.document_kind,
      }))
    ),
    briefDraft: null,
  };
}

export async function reclassifyAffaireDocument(input: {
  projectId: string;
  documentId: string;
  category: AffaireIntakeDocumentKind;
}) {
  const { context, project } = await requireAffaireProjectOwnerOrAdmin(
    input.projectId
  );

  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents" as never)
      .select(DOCUMENT_SELECT as never)
      .eq("id", input.documentId)
      .eq("project_id", project.id)
      .maybeSingle()
  );

  if (error) {
    throw internalError(
      "Impossible de charger le document intake a reclasser.",
      error
    );
  }

  const document = normalizeDocumentRow(data);

  if (!document) {
    throw notFound("Document intake introuvable.");
  }

  const classificationStatus = deriveAffaireIntakeClassificationStatus({
    documentKind: input.category,
    confidence: input.category === "a_classer" ? 0.4 : 1,
  });

  const beforePayload = {
    document_kind: document.document_kind,
    classification_status: document.classification_status,
    confidence: document.confidence,
  };

  const nextIssues =
    input.category === "a_classer"
      ? addIssue(document.issues, "Document remis manuellement dans la file a classer.")
      : document.issues;

  const { error: updateError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents" as never)
      .update({
        document_kind: input.category,
        classification_status: classificationStatus,
        confidence: input.category === "a_classer" ? 0.4 : 1,
        issues: nextIssues,
        classification_source: "manual",
        classified_by: context.userId,
        classified_at: new Date().toISOString(),
        manually_overridden_at: new Date().toISOString(),
      } as never)
      .eq("id", document.id)
  );

  if (updateError) {
    throw internalError(
      "Impossible de reclasser le document intake.",
      updateError
    );
  }

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: document.upload_id,
    documentId: document.id,
    actorUserId: context.userId,
    eventType: "document.reclassified",
    beforePayload,
    afterPayload: {
      document_kind: input.category,
      classification_status: classificationStatus,
      confidence: input.category === "a_classer" ? 0.4 : 1,
    },
  });

  await updateUploadStatusFromStoredDocuments({
    supabase: context.supabase,
    uploadId: document.upload_id,
  });

  return { ok: true } as const;
}
