import { internalError } from "@/lib/http/api-response";
import {
  affaireIntakeClassificationSourceSchema,
  affaireIntakeClassificationStatusSchema,
  affaireIntakeDocumentKindSchema,
  affaireIntakeDocumentPrioritySchema,
  affaireIntakeDocumentUploadStatusSchema,
  affaireIntakeUploadStatusSchema,
  deriveAffaireIntakeUploadStatusFromDocuments,
  normalizeAffaireIntakeExtractedMetadata,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeClassificationStatus,
  type AffaireIntakeDocumentKind,
  type AffaireIntakeDocumentPriority,
  type AffaireIntakeDocumentUploadStatus,
  type AffaireIntakeExtractedMetadata,
  type AffaireIntakeUploadStatus,
} from "@/lib/affaires/intake";
import { isRecord, toStringOrNull } from "@/lib/value-guards";

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

export type AffaireIntakeDocumentRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  upload_id: string;
  analysis_launch_id?: string | null;
  created_by: string | null;
  storage_path: string | null;
  deletion_token: string | null;
  plan_copy_generation: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  upload_status: AffaireIntakeDocumentUploadStatus;
  rejection_reason: string | null;
  classification_status: AffaireIntakeClassificationStatus;
  document_kind: AffaireIntakeDocumentKind;
  document_priority: AffaireIntakeDocumentPriority;
  confidence: number | null;
  issues: string[];
  extracted_metadata: AffaireIntakeExtractedMetadata;
  classification_source: AffaireIntakeClassificationSource | null;
  classified_by: string | null;
  classified_at: string | null;
  manually_overridden_at: string | null;
  source_provider: "google_drive" | null;
  drive_connection_id: string | null;
  drive_file_id: string | null;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  drive_revision: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireIntakeSupabaseMutationQuery = {
  eq: (column: string, value: string) => PromiseLike<unknown>;
};

type AffaireIntakeSupabaseInsertTable = {
  insert: (values: unknown) => PromiseLike<unknown>;
};

type AffaireIntakeSupabaseDeleteTable = {
  delete: () => AffaireIntakeSupabaseMutationQuery;
};

type AffaireIntakeSupabaseSelectQuery = PromiseLike<{ data: unknown[] | null; error: unknown; count?: number | null }> & {
  order(column: string, options?: { ascending?: boolean }): AffaireIntakeSupabaseSelectQuery;
  range(from: number, to: number): AffaireIntakeSupabaseSelectQuery;
  eq: (column: string, value: string) => AffaireIntakeSupabaseSelectQuery;
  is: (column: string, value: null) => AffaireIntakeSupabaseSelectQuery;
};

type AffaireIntakeSupabaseSelectTable = {
  select: (columns: string, options?: { count: "exact" }) => AffaireIntakeSupabaseSelectQuery;
};

type AffaireIntakeSupabaseUpdateTable = {
  update: (values: unknown) => AffaireIntakeSupabaseMutationQuery;
};

export type AffaireIntakeSupabaseClient = {
  from: (table: string) => unknown;
};

export const UPLOAD_SELECT = [
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
export const DOCUMENT_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "upload_id",
  "analysis_launch_id",
  "created_by",
  "storage_path",
  "deletion_token",
  "plan_copy_generation",
  "file_name",
  "mime_type",
  "size_bytes",
  "upload_status",
  "rejection_reason",
  "classification_status",
  "document_kind",
  "document_priority",
  "confidence",
  "issues",
  "extracted_metadata",
  "classification_source",
  "classified_by",
  "classified_at",
  "manually_overridden_at",
  "source_provider",
  "drive_connection_id",
  "drive_file_id",
  "drive_folder_id",
  "drive_folder_name",
  "drive_revision",
  "created_at",
  "updated_at",
].join(", ");

export function toNumberOrZero(value: unknown) {
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

export async function resolveSupabaseQuery<T>(query: unknown): Promise<T> {
  return (await (query as PromiseLike<T>)) as T;
}

export function getAffaireIntakeInsertTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseInsertTable;
}

export function getAffaireIntakeSelectTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseSelectTable;
}

export function getAffaireIntakeDeleteTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseDeleteTable;
}

export function getAffaireIntakeUpdateTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseUpdateTable;
}

export function normalizeUploadRow(row: unknown): AffaireIntakeUploadRow | null {
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

export function normalizeDocumentRow(row: unknown): AffaireIntakeDocumentRow | null {
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
  const documentPriority = affaireIntakeDocumentPrioritySchema.safeParse(
    row.document_priority
  );

  if (
    !uploadStatus.success ||
    !classificationStatus.success ||
    !documentKind.success ||
    !documentPriority.success ||
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
    analysis_launch_id: typeof row.analysis_launch_id === "string" ? row.analysis_launch_id : null,
    upload_id: typeof row.upload_id === "string" ? row.upload_id : "",
    created_by: toStringOrNull(row.created_by),
    storage_path: toStringOrNull(row.storage_path),
    deletion_token: toStringOrNull(row.deletion_token),
    plan_copy_generation: toStringOrNull(row.plan_copy_generation),
    file_name: typeof row.file_name === "string" ? row.file_name : "",
    mime_type: toStringOrNull(row.mime_type),
    size_bytes: Math.max(0, Math.trunc(toNumberOrZero(row.size_bytes))),
    upload_status: uploadStatus.data,
    rejection_reason: toStringOrNull(row.rejection_reason),
    classification_status: classificationStatus.data,
    document_kind: documentKind.data,
    document_priority: documentPriority.data,
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
    source_provider: row.source_provider === "google_drive" ? "google_drive" : null,
    drive_connection_id: toStringOrNull(row.drive_connection_id),
    drive_file_id: toStringOrNull(row.drive_file_id),
    drive_folder_id: toStringOrNull(row.drive_folder_id),
    drive_folder_name: toStringOrNull(row.drive_folder_name),
    drive_revision: toStringOrNull(row.drive_revision),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

export function addIssue(issues: string[], issue: string) {
  const trimmed = issue.trim();
  if (!trimmed) {
    return issues;
  }

  if (issues.includes(trimmed)) {
    return issues;
  }

  return [...issues, trimmed].slice(0, 10);
}

export async function insertAffaireIntakeEvent(input: {
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
    | "document.priority_changed"
    | "upload.completed"
    | "brief.generated"
    | "brief.updated"
    | "brief.confirmed";
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

export async function updateUploadStatusFromStoredDocuments(input: {
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

  if (status === "processing") {
    throw internalError(
      "Le traitement intake ne peut pas être finalise avec des documents en attente."
    );
  }

  return status;
}
