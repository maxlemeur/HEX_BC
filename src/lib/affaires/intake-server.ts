import { randomUUID } from "node:crypto";

import * as XLSX from "xlsx";
import { z } from "zod";

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
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  affaireIntakeBriefBlockKeySchema,
  affaireIntakeBriefDraftSchema,
  affaireIntakeBriefStatusSchema,
  affaireIntakeClassificationResultSchema,
  affaireIntakeClassificationSourceSchema,
  affaireIntakeClassificationStatusSchema,
  affaireIntakeDocumentKindSchema,
  affaireIntakeDocumentPrioritySchema,
  affaireIntakeDocumentUploadStatusSchema,
  affaireIntakeUploadStatusSchema,
  buildAffaireIntakeReadinessSnapshot,
  buildAffaireIntakeMissingPieces,
  buildAffaireIntakeStoragePath,
  createEmptyAffaireIntakeExtractedMetadata,
  deriveAffaireIntakeClassificationStatus,
  deriveAffaireIntakeUploadStatusFromDocuments,
  getAffaireIntakeFileExtension,
  getHeuristicAffaireDocumentClassification,
  inferAffaireIntakeMimeType,
  isAffaireIntakePrimaryEligibleKind,
  isMimeTypeSupportedForAiClassification,
  mergeAffaireDocumentClassificationWithHeuristic,
  normalizeAffaireIntakeTextList,
  normalizeAffaireIntakeExtractedMetadata,
  type AffaireIntakeBriefBlockKey,
  type AffaireIntakeBriefDraft,
  type AffaireIntakeBriefStatus,
  type AffaireIntakeClassificationResult,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeClassificationStatus,
  type AffaireIntakeDocumentKind,
  type AffaireIntakeDocumentPriority,
  type AffaireIntakeDocumentUploadStatus,
  type AffaireIntakeExtractedMetadata,
  type AffaireIntakeReadinessSnapshot,
  type AffaireIntakeUploadStatus,
  type AffaireIntakeWorkspaceMissingPiece,
} from "@/lib/affaires/intake";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import {
  syncAffaireRegisterFromBrief,
  syncAffaireRegisterMissingPieces,
} from "@/lib/affaires/register-server";

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type AffaireProjectAccessRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  reference: string | null;
  client_name: string | null;
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
  document_priority: AffaireIntakeDocumentPriority;
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

type AffaireBriefRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  upload_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  confirmed_by: string | null;
  status: AffaireIntakeBriefStatus;
  summary: string;
  project_object: string;
  scope: string[];
  lots: string[];
  received_pieces: string[];
  assumptions: string[];
  vigilance_points: string[];
  missing_elements: string[];
  generation_metadata: Record<string, unknown>;
  last_generated_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
};

type AffaireBriefSourceRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  brief_id: string;
  source_document_id: string;
  created_by: string | null;
  block_key: AffaireIntakeBriefBlockKey;
  entry_index: number;
  source_file_name: string;
  rationale: string | null;
  created_at: string;
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
    classificationStatus?: AffaireIntakeClassificationStatus;
    classificationSource?: AffaireIntakeClassificationSource | null;
    documentPriority?: AffaireIntakeDocumentPriority | null;
    confidence: number;
    extractedMetadata: AffaireIntakeExtractedMetadata;
    issues: string[];
  }>;
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
  readiness?: AffaireIntakeReadinessSnapshot;
  briefDraft: AffaireIntakeBriefDraft | null;
};

const PROJECT_SELECT = "id, tenant_id, user_id, name, reference, client_name, is_archived";
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
  "document_priority",
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
const BRIEF_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "upload_id",
  "created_by",
  "updated_by",
  "confirmed_by",
  "status",
  "summary",
  "project_object",
  "scope",
  "lots",
  "received_pieces",
  "assumptions",
  "vigilance_points",
  "missing_elements",
  "generation_metadata",
  "last_generated_at",
  "confirmed_at",
  "created_at",
  "updated_at",
].join(", ");
const BRIEF_SOURCE_SELECT = [
  "id",
  "tenant_id",
  "project_id",
  "brief_id",
  "source_document_id",
  "created_by",
  "block_key",
  "entry_index",
  "source_file_name",
  "rationale",
  "created_at",
].join(", ");

const AFFAIRE_INTAKE_CLASSIFICATION_PROMPT_VERSION = "est371_affaire_intake_v1";
const AFFAIRE_INTAKE_CLASSIFICATION_MODEL = "gemini-3-flash-preview";
const AFFAIRE_INTAKE_CLASSIFICATION_THINKING_LEVEL = "low" as const;
const AFFAIRE_BRIEF_PROMPT_VERSION = "est372_affaire_brief_v1";
const AFFAIRE_BRIEF_MODEL = "gemini-3-flash-preview";
const AFFAIRE_BRIEF_THINKING_LEVEL = "low" as const;
const TEXT_SNIPPET_MAX_LENGTH = 12_000;

const affaireBriefEntrySchema = z
  .object({
    text: z.string().trim().min(1).max(320),
    sourceDocumentIds: z.array(z.string().uuid()).max(6).default([]),
  })
  .strict();

const affaireBriefGenerationSchema = z
  .object({
    summary: affaireBriefEntrySchema,
    projectObject: affaireBriefEntrySchema,
    scope: z.array(affaireBriefEntrySchema).max(12),
    lots: z.array(affaireBriefEntrySchema).max(20),
    receivedPieces: z.array(affaireBriefEntrySchema).max(20),
    assumptions: z.array(affaireBriefEntrySchema).max(12),
    vigilancePoints: z.array(affaireBriefEntrySchema).max(12),
    missingElements: z.array(affaireBriefEntrySchema).max(12),
  })
  .strict();

type AffaireBriefEntry = z.infer<typeof affaireBriefEntrySchema>;
type AffaireBriefGeneration = z.infer<typeof affaireBriefGenerationSchema>;

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

function getAffaireIntakeDeleteTable(
  supabase: AffaireIntakeSupabaseClient,
  table: string
) {
  return supabase.from(table) as AffaireIntakeSupabaseDeleteTable;
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
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function pickPrimaryDocumentForKind(
  documents: AffaireIntakeDocumentRow[],
  kind: "dpgf" | "cctp"
) {
  const docsForKind = documents.filter((document) => document.document_kind === kind);

  if (docsForKind.length === 0) {
    return null;
  }

  const existingPrimary =
    docsForKind.find((document) => document.document_priority === "primary") ?? null;

  if (existingPrimary) {
    return existingPrimary;
  }

  return [...docsForKind].sort((left, right) => {
    if (left.created_at !== right.created_at) {
      return left.created_at.localeCompare(right.created_at);
    }

    return left.id.localeCompare(right.id);
  })[0] ?? null;
}

function buildDocumentPriorityMap(documents: AffaireIntakeDocumentRow[]) {
  const nextPriorityById = new Map<string, AffaireIntakeDocumentPriority>();
  const primaryDpgf = pickPrimaryDocumentForKind(documents, "dpgf");
  const primaryCctp = pickPrimaryDocumentForKind(documents, "cctp");

  for (const document of documents) {
    if (!isAffaireIntakePrimaryEligibleKind(document.document_kind)) {
      nextPriorityById.set(document.id, "secondary");
      continue;
    }

    const primaryDocument =
      document.document_kind === "dpgf" ? primaryDpgf : primaryCctp;

    nextPriorityById.set(
      document.id,
      primaryDocument?.id === document.id ? "primary" : "secondary"
    );
  }

  return nextPriorityById;
}

async function syncAffaireIntakeDocumentPriorities(input: {
  supabase: AffaireIntakeSupabaseClient;
  projectId: string;
}) {
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    getAffaireIntakeSelectTable(input.supabase, "affaire_intake_documents")
      .select(DOCUMENT_SELECT as never)
      .eq("project_id", input.projectId)
      .order("created_at", { ascending: true })
  );

  if (error) {
    throw internalError(
      "Impossible de recalculer les priorites documentaires intake.",
      error
    );
  }

  const documents = (data ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);
  const nextPriorityById = buildDocumentPriorityMap(documents);

  for (const document of documents) {
    const nextPriority =
      nextPriorityById.get(document.id) ?? "secondary";

    if (document.document_priority === nextPriority) {
      continue;
    }

    const { error: updateError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      getAffaireIntakeUpdateTable(input.supabase, "affaire_intake_documents")
        .update({
          document_priority: nextPriority,
        } as never)
        .eq("id", document.id)
    );

    if (updateError) {
      throw internalError(
        "Impossible de synchroniser les priorites documentaires intake.",
        updateError
      );
    }
  }
}

function normalizeJsonTextArray(
  value: unknown,
  maxItems: number,
  maxLength: number
) {
  const values = Array.isArray(value)
    ? value
    : Array.isArray((value as { values?: unknown[] } | null)?.values)
      ? ((value as { values?: unknown[] }).values ?? [])
      : [];

  return normalizeAffaireIntakeTextList(
    values.map((item) => (typeof item === "string" ? item : null)),
    {
      maxItems,
      maxLength,
    }
  );
}

function normalizeAffaireBriefRow(row: unknown): AffaireBriefRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const status = affaireIntakeBriefStatusSchema.safeParse(row.status);
  if (
    !status.success ||
    typeof row.id !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.project_object !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    upload_id: toStringOrNull(row.upload_id),
    created_by: toStringOrNull(row.created_by),
    updated_by: toStringOrNull(row.updated_by),
    confirmed_by: toStringOrNull(row.confirmed_by),
    status: status.data,
    summary: row.summary.trim(),
    project_object: row.project_object.trim(),
    scope: normalizeJsonTextArray(row.scope, 12, 280),
    lots: normalizeJsonTextArray(row.lots, 20, 160),
    received_pieces: normalizeJsonTextArray(row.received_pieces, 20, 255),
    assumptions: normalizeJsonTextArray(row.assumptions, 12, 280),
    vigilance_points: normalizeJsonTextArray(row.vigilance_points, 12, 280),
    missing_elements: normalizeJsonTextArray(row.missing_elements, 12, 280),
    generation_metadata: isRecord(row.generation_metadata)
      ? row.generation_metadata
      : {},
    last_generated_at: toStringOrNull(row.last_generated_at),
    confirmed_at: toStringOrNull(row.confirmed_at),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
    updated_at: toStringOrNull(row.updated_at) ?? new Date(0).toISOString(),
  };
}

function normalizeAffaireBriefSourceRow(row: unknown): AffaireBriefSourceRow | null {
  if (!isRecord(row)) {
    return null;
  }

  const blockKey = affaireIntakeBriefBlockKeySchema.safeParse(row.block_key);
  if (
    !blockKey.success ||
    typeof row.id !== "string" ||
    typeof row.brief_id !== "string" ||
    typeof row.source_document_id !== "string" ||
    typeof row.source_file_name !== "string"
  ) {
    return null;
  }

  return {
    id: row.id,
    tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : "",
    project_id: typeof row.project_id === "string" ? row.project_id : "",
    brief_id: row.brief_id,
    source_document_id: row.source_document_id,
    created_by: toStringOrNull(row.created_by),
    block_key: blockKey.data,
    entry_index: Math.max(0, Math.trunc(toNumberOrZero(row.entry_index))),
    source_file_name: row.source_file_name.trim(),
    rationale: toStringOrNull(row.rationale),
    created_at: toStringOrNull(row.created_at) ?? new Date(0).toISOString(),
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
}): Promise<{
  result: AffaireIntakeClassificationResult;
  source: AffaireIntakeClassificationSource;
}> {
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
      result: {
        ...heuristicResult,
        issues: addIssue(
          heuristicResult.issues,
          "Analyse IA indisponible pour ce format, classement heuristique applique."
        ),
      },
      source: "heuristic",
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

    const mergedResult = mergeAffaireDocumentClassificationWithHeuristic({
      aiResult: geminiResult.data,
      heuristicResult,
    });
    const source =
      mergedResult.documentKind === geminiResult.data.documentKind ? "ai" : "heuristic";

    return {
      result: mergedResult,
      source,
    };
  } catch (error) {
    console.error("Affaire intake AI classification failed", {
      fileName: input.fileName,
      error,
    });

    return {
      result: {
        ...heuristicResult,
        issues: addIssue(
          heuristicResult.issues,
          "Classification heuristique retenue car l'analyse IA a echoue."
        ),
      },
      source: "heuristic",
    };
  }
}

async function requireAffaireProjectOwnerOrAdmin(
  projectId: string
): Promise<{
  context: AuthenticatedContext;
  project: AffaireProjectAccessRow;
}> {
  return requireAffaireProjectAccess(projectId, "owner_or_admin");
}

async function requireAffaireProjectReadAccess(
  projectId: string
): Promise<{
  context: AuthenticatedContext;
  project: AffaireProjectAccessRow;
}> {
  return requireAffaireProjectAccess(projectId, "reader");
}

async function requireAffaireProjectBriefEditor(
  projectId: string
): Promise<{
  context: AuthenticatedContext;
  project: AffaireProjectAccessRow;
}> {
  return requireAffaireProjectAccess(projectId, "brief_editor");
}

async function requireAffaireProjectAccess(
  projectId: string,
  mode: "owner_or_admin" | "reader" | "brief_editor"
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

  const isOwner = project.user_id === context.userId;
  const isAdmin = context.tenantRole === "admin";
  const isDirector = context.tenantRole === "director";

  const hasAccess =
    mode === "reader"
      ? isOwner || isAdmin || isDirector
      : mode === "brief_editor"
        ? isOwner || isAdmin || isDirector
        : isOwner || isAdmin;

  if (!hasAccess) {
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

type AffaireBriefGenerationDocument = Pick<
  AffaireIntakeDocumentRow,
  "id" | "file_name" | "document_kind" | "confidence" | "issues" | "extracted_metadata"
>;

function pickPrimaryMetadataValue(
  documents: AffaireBriefGenerationDocument[],
  selector: (document: AffaireBriefGenerationDocument) => string | null
) {
  const counts = new Map<string, number>();

  for (const document of documents) {
    const value = selector(document)?.trim();
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "fr"))
    .at(0)?.[0] ?? null;
}

function pickEarliestDeadline(documents: AffaireBriefGenerationDocument[]) {
  const deadlines = documents
    .map((document) => document.extracted_metadata.deadlineAt)
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  return deadlines[0]?.toISOString() ?? null;
}

function pickDocumentIdsForBrief(
  documents: AffaireBriefGenerationDocument[],
  predicate: (document: AffaireBriefGenerationDocument) => boolean,
  limit = 4
) {
  return documents
    .filter(predicate)
    .sort((left, right) => (right.confidence ?? 0) - (left.confidence ?? 0))
    .slice(0, limit)
    .map((document) => document.id);
}

function createBriefEntry(
  text: string,
  sourceDocumentIds: string[]
): AffaireBriefEntry {
  return affaireBriefEntrySchema.parse({
    text,
    sourceDocumentIds,
  });
}

function buildReceivedPiecesEntries(
  documents: AffaireBriefGenerationDocument[]
) {
  return documents.map((document) =>
    createBriefEntry(
      `${AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[document.document_kind]} · ${document.file_name}`,
      [document.id]
    )
  );
}

function buildFallbackAffaireBrief(input: {
  project: AffaireProjectAccessRow;
  uploadId: string;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}): AffaireBriefGeneration {
  const projectName =
    pickPrimaryMetadataValue(
      input.documents,
      (document) => document.extracted_metadata.projectName
    ) ?? input.project.name;
  const clientName = pickPrimaryMetadataValue(
    input.documents,
    (document) => document.extracted_metadata.clientName
  ) ?? input.project.client_name;
  const earliestDeadline = pickEarliestDeadline(input.documents);
  const lots = normalizeAffaireIntakeTextList(
    input.documents.flatMap((document) => document.extracted_metadata.detectedLots),
    {
      maxItems: 20,
      maxLength: 160,
    }
  );
  const reviewDocuments = input.documents.filter(
    (document) => document.document_kind === "a_classer" || (document.confidence ?? 0) < 0.65
  );
  const scopeEntries: AffaireBriefEntry[] = [];
  const assumptionEntries: AffaireBriefEntry[] = [];
  const vigilanceEntries: AffaireBriefEntry[] = [];
  const missingEntries: AffaireBriefEntry[] = [];

  if (lots.length > 0) {
    for (const lot of lots.slice(0, 8)) {
      scopeEntries.push(
        createBriefEntry(
          `Le dossier couvre le lot ${lot}.`,
          pickDocumentIdsForBrief(input.documents, (document) =>
            document.extracted_metadata.detectedLots.includes(lot)
          )
        )
      );
    }
  } else {
    scopeEntries.push(
      createBriefEntry(
        "Le perimetre detaille reste a confirmer a partir des pieces recues.",
        pickDocumentIdsForBrief(input.documents, () => true)
      )
    );
  }

  if (clientName) {
    scopeEntries.unshift(
      createBriefEntry(
        `Le projet semble porte pour ${clientName}.`,
        pickDocumentIdsForBrief(
          input.documents,
          (document) => document.extracted_metadata.clientName === clientName
        )
      )
    );
  }

  if (earliestDeadline) {
    vigilanceEntries.push(
      createBriefEntry(
        `Une echeance explicite a ete detectee pour le ${new Date(earliestDeadline).toLocaleDateString("fr-FR")}.`,
        pickDocumentIdsForBrief(
          input.documents,
          (document) => document.extracted_metadata.deadlineAt === earliestDeadline
        )
      )
    );
  }

  if (reviewDocuments.length > 0) {
    vigilanceEntries.push(
      createBriefEntry(
        `${reviewDocuments.length} piece(s) doivent encore etre confirmees ou reclassifiees avant cadrage final.`,
        reviewDocuments.map((document) => document.id).slice(0, 6)
      )
    );
  }

  if (!clientName) {
    assumptionEntries.push(
      createBriefEntry(
        "Le client ou maitre d'ouvrage reste a confirmer humainement.",
        pickDocumentIdsForBrief(input.documents, () => true)
      )
    );
  }

  if (lots.length === 0) {
    assumptionEntries.push(
      createBriefEntry(
        "Les lots concernes doivent etre verifies avant lancement du chiffrage detaille.",
        pickDocumentIdsForBrief(input.documents, () => true)
      )
    );
  }

  for (const piece of input.missingPieces) {
    missingEntries.push(
      createBriefEntry(
        piece.label,
        pickDocumentIdsForBrief(input.documents, () => true)
      )
    );
  }

  for (const document of reviewDocuments.slice(0, 6)) {
    const issue = document.issues[0] ?? "Classification a confirmer.";
    missingEntries.push(createBriefEntry(issue, [document.id]));
  }

  const receivedPieces = buildReceivedPiecesEntries(input.documents).slice(0, 20);
  const projectSourceIds = pickDocumentIdsForBrief(
    input.documents,
    (document) =>
      Boolean(document.extracted_metadata.projectName) ||
      Boolean(document.extracted_metadata.clientName) ||
      document.extracted_metadata.detectedLots.length > 0,
    6
  );
  const summaryParts = [
    `Brief provisoire du dossier ${projectName}.`,
    clientName ? `Client detecte: ${clientName}.` : "Client a confirmer.",
    `${input.documents.length} piece(s) ont ete retenues dans l'intake.`,
    lots.length > 0
      ? `${lots.length} lot(s) ont ete identifies.`
      : "Le lotissement reste a preciser.",
  ];

  return affaireBriefGenerationSchema.parse({
    summary: createBriefEntry(summaryParts.join(" "), projectSourceIds),
    projectObject: createBriefEntry(
      lots.length > 0
        ? `${projectName} · lots ${lots.slice(0, 4).join(", ")}`
        : `${projectName} · perimetre a confirmer`,
      projectSourceIds
    ),
    scope: scopeEntries.slice(0, 12),
    lots: lots
      .slice(0, 20)
      .map((lot) =>
        createBriefEntry(
          lot,
          pickDocumentIdsForBrief(input.documents, (document) =>
            document.extracted_metadata.detectedLots.includes(lot)
          )
        )
      ),
    receivedPieces,
    assumptions: assumptionEntries.slice(0, 12),
    vigilancePoints: vigilanceEntries.slice(0, 12),
    missingElements: missingEntries.slice(0, 12),
  });
}

function buildBriefGenerationPrompt(input: {
  project: AffaireProjectAccessRow;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}) {
  return [
    "ROLE",
    "Tu produis un brief affaire BTP a partir d'un workspace d'intake deja classe.",
    "",
    "CONTRAINTE",
    "Retourne uniquement un JSON strict conforme au schema fourni.",
    "Chaque entree doit reutiliser uniquement les sourceDocumentIds presents dans l'inventaire.",
    "N'invente ni document, ni lot, ni client, ni echeance.",
    "Le ton doit etre professionnel, concis et exploitable par un chiffreur ou une validatrice.",
    "",
    "PROMPT_VERSION",
    AFFAIRE_BRIEF_PROMPT_VERSION,
    "",
    "PROJET",
    JSON.stringify(
      {
        projectId: input.project.id,
        projectName: input.project.name,
        projectReference: input.project.reference,
        clientName: input.project.client_name,
        ownerUserId: input.project.user_id,
      },
      null,
      2
    ),
    "",
    "INVENTAIRE_DOCUMENTS",
    JSON.stringify(
      input.documents.map((document) => ({
        documentId: document.id,
        fileName: document.file_name,
        detectedCategory: document.document_kind,
        confidence: document.confidence,
        extractedMetadata: document.extracted_metadata,
        issues: document.issues,
      })),
      null,
      2
    ),
    "",
    "PIECES_MANQUANTES",
    JSON.stringify(input.missingPieces, null, 2),
    "",
    "REGLES_METIER",
    "1. summary et projectObject doivent etre une phrase courte et lisible.",
    "2. receivedPieces doit lister les pieces recues sans omettre une categorie importante.",
    "3. assumptions et vigilancePoints doivent mettre en evidence les zones grises, sans dramatiser.",
    "4. missingElements doit reprendre les vrais manques ou doutes encore ouverts.",
    "5. Quand aucune source documentaire directe n'est disponible pour une entree, reutilise les pieces les plus proches plutot que d'inventer.",
  ].join("\n");
}

function sanitizeEntrySourceDocumentIds(
  sourceDocumentIds: ReadonlyArray<string>,
  validDocumentIds: Set<string>,
  fallbackSourceDocumentIds: string[]
) {
  const sanitized = normalizeAffaireIntakeTextList(
    sourceDocumentIds.map((value) => (validDocumentIds.has(value) ? value : null)),
    {
      maxItems: 6,
      maxLength: 64,
    }
  );

  return sanitized.length > 0 ? sanitized : fallbackSourceDocumentIds.slice(0, 6);
}

function sanitizeBriefEntry(
  entry: AffaireBriefEntry | null | undefined,
  fallbackEntry: AffaireBriefEntry,
  validDocumentIds: Set<string>
) {
  if (!entry || typeof entry.text !== "string" || entry.text.trim().length === 0) {
    return fallbackEntry;
  }

  return createBriefEntry(
    entry.text,
    sanitizeEntrySourceDocumentIds(
      entry.sourceDocumentIds,
      validDocumentIds,
      fallbackEntry.sourceDocumentIds
    )
  );
}

function sanitizeBriefEntryArray(
  entries: ReadonlyArray<AffaireBriefEntry> | null | undefined,
  fallbackEntries: ReadonlyArray<AffaireBriefEntry>,
  validDocumentIds: Set<string>
) {
  if (!entries || entries.length === 0) {
    return [...fallbackEntries];
  }

  return Array.from({
    length:
      fallbackEntries.length > 0
        ? Math.max(entries.length, fallbackEntries.length)
        : entries.length,
  })
    .map((_, index) =>
      sanitizeBriefEntry(
        entries[index],
        fallbackEntries[index] ?? fallbackEntries[0] ?? createBriefEntry("Source a confirmer.", []),
        validDocumentIds
      )
    );
}

export function mergeGeneratedAffaireBriefWithFallback(input: {
  generated: AffaireBriefGeneration | null;
  fallback: AffaireBriefGeneration;
  documents: AffaireBriefGenerationDocument[];
}): AffaireBriefGeneration {
  const validDocumentIds = new Set(input.documents.map((document) => document.id));
  const generated = input.generated;

  return affaireBriefGenerationSchema.parse({
    summary: sanitizeBriefEntry(generated?.summary, input.fallback.summary, validDocumentIds),
    projectObject: sanitizeBriefEntry(
      generated?.projectObject,
      input.fallback.projectObject,
      validDocumentIds
    ),
    scope: sanitizeBriefEntryArray(
      generated?.scope,
      input.fallback.scope,
      validDocumentIds
    )
      .slice(0, 12),
    lots: sanitizeBriefEntryArray(
      generated?.lots,
      input.fallback.lots,
      validDocumentIds
    )
      .slice(0, 20),
    receivedPieces: input.fallback.receivedPieces,
    assumptions: sanitizeBriefEntryArray(
      generated?.assumptions,
      input.fallback.assumptions,
      validDocumentIds
    )
      .slice(0, 12),
    vigilancePoints: sanitizeBriefEntryArray(
      generated?.vigilancePoints,
      input.fallback.vigilancePoints,
      validDocumentIds
    )
      .slice(0, 12),
    missingElements: sanitizeBriefEntryArray(
      generated?.missingElements,
      input.fallback.missingElements,
      validDocumentIds
    )
      .slice(0, 12),
  });
}

function remapBriefSourcesForEditedDraft(input: {
  previous: AffaireIntakeBriefDraft;
  next: AffaireIntakeBriefDraft;
}) {
  const nextSources: AffaireIntakeBriefDraft["sources"] = [];
  const previousSourcesByKey = new Map<string, AffaireIntakeBriefDraft["sources"]>();

  for (const source of input.previous.sources) {
    const key = `${source.blockKey}:${source.entryIndex}`;
    previousSourcesByKey.set(key, [...(previousSourcesByKey.get(key) ?? []), source]);
  }

  const appendSources = (
    blockKey: AffaireIntakeBriefBlockKey,
    previousIndex: number,
    nextIndex: number
  ) => {
    for (const source of previousSourcesByKey.get(`${blockKey}:${previousIndex}`) ?? []) {
      nextSources.push({
        ...source,
        entryIndex: nextIndex,
      });
    }
  };

  if (input.previous.summary === input.next.summary) {
    appendSources("summary", 0, 0);
  }

  const remapListBlock = (
    blockKey: "scope" | "assumptions" | "vigilance_points",
    previousValues: ReadonlyArray<string>,
    nextValues: ReadonlyArray<string>
  ) => {
    const previousIndexByValue = new Map<string, number>();

    previousValues.forEach((value, index) => {
      previousIndexByValue.set(value, index);
    });

    nextValues.forEach((value, index) => {
      const previousIndex = previousIndexByValue.get(value);
      if (previousIndex !== undefined) {
        appendSources(blockKey, previousIndex, index);
      }
    });
  };

  remapListBlock("scope", input.previous.scope, input.next.scope);
  remapListBlock(
    "assumptions",
    input.previous.assumptions,
    input.next.assumptions
  );
  remapListBlock(
    "vigilance_points",
    input.previous.vigilancePoints,
    input.next.vigilancePoints
  );

  for (const source of input.previous.sources) {
    if (
      source.blockKey !== "summary" &&
      source.blockKey !== "scope" &&
      source.blockKey !== "assumptions" &&
      source.blockKey !== "vigilance_points"
    ) {
      nextSources.push(source);
    }
  }

  return nextSources;
}

async function replaceAffaireBriefSourceLinks(input: {
  supabase: AffaireIntakeSupabaseClient;
  briefId: string;
  sources: AffaireIntakeBriefDraft["sources"];
  actorUserId?: string | null;
}) {
  const { error: deleteError } = await resolveSupabaseQuery<{ error: unknown }>(
    getAffaireIntakeDeleteTable(input.supabase, "affaire_brief_source_links")
      .delete()
      .eq("brief_id", input.briefId)
  );

  if (deleteError) {
    throw internalError("Impossible de remplacer les sources du brief affaire.", deleteError);
  }

  if (input.sources.length === 0) {
    return;
  }

  const { error: insertSourceError } = await resolveSupabaseQuery<{
    error: unknown;
  }>(
    getAffaireIntakeInsertTable(input.supabase, "affaire_brief_source_links")
      .insert(
        input.sources.map((source) => ({
          brief_id: input.briefId,
          source_document_id: source.sourceDocumentId,
          created_by: input.actorUserId ?? null,
          block_key: source.blockKey,
          entry_index: source.entryIndex,
          source_file_name: source.sourceFileName,
          rationale: source.rationale,
        }))
      )
  );

  if (insertSourceError) {
    throw internalError(
      "Impossible de persister les sources du brief affaire.",
      insertSourceError
    );
  }
}

function buildBriefSourcesFromGeneration(
  generation: AffaireBriefGeneration,
  documents: AffaireBriefGenerationDocument[]
) {
  const documentsById = new Map(
    documents.map((document) => [document.id, document.file_name] as const)
  );
  const sources: AffaireIntakeBriefDraft["sources"] = [];
  const pushSources = (
    blockKey: AffaireIntakeBriefBlockKey,
    entryIndex: number,
    entry: AffaireBriefEntry
  ) => {
    for (const sourceDocumentId of entry.sourceDocumentIds) {
      const sourceFileName = documentsById.get(sourceDocumentId);
      if (!sourceFileName) {
        continue;
      }

      sources.push({
        blockKey,
        entryIndex,
        sourceDocumentId,
        sourceFileName,
        rationale: null,
      });
    }
  };

  pushSources("summary", 0, generation.summary);
  pushSources("project_object", 0, generation.projectObject);
  generation.scope.forEach((entry, index) => pushSources("scope", index, entry));
  generation.lots.forEach((entry, index) => pushSources("lots", index, entry));
  generation.receivedPieces.forEach((entry, index) =>
    pushSources("received_pieces", index, entry)
  );
  generation.assumptions.forEach((entry, index) =>
    pushSources("assumptions", index, entry)
  );
  generation.vigilancePoints.forEach((entry, index) =>
    pushSources("vigilance_points", index, entry)
  );
  generation.missingElements.forEach((entry, index) =>
    pushSources("missing_elements", index, entry)
  );

  return sources;
}

function toAffaireBriefDraft(input: {
  generation: AffaireBriefGeneration;
  uploadId: string;
  status: AffaireIntakeBriefStatus;
  lastGeneratedAt: string;
  confirmedAt: string | null;
  documents: AffaireBriefGenerationDocument[];
}): AffaireIntakeBriefDraft {
  return affaireIntakeBriefDraftSchema.parse({
    status: input.status,
    summary: input.generation.summary.text,
    projectObject: input.generation.projectObject.text,
    scope: input.generation.scope.map((entry) => entry.text),
    lots: input.generation.lots.map((entry) => entry.text),
    receivedPieces: input.generation.receivedPieces.map((entry) => entry.text),
    assumptions: input.generation.assumptions.map((entry) => entry.text),
    vigilancePoints: input.generation.vigilancePoints.map((entry) => entry.text),
    missingElements: input.generation.missingElements.map((entry) => entry.text),
    sources: buildBriefSourcesFromGeneration(input.generation, input.documents),
    uploadId: input.uploadId,
    lastGeneratedAt: input.lastGeneratedAt,
    confirmedAt: input.confirmedAt,
  });
}

function normalizeAffaireBriefDraftFromRows(input: {
  brief: AffaireBriefRow;
  sources: AffaireBriefSourceRow[];
}): AffaireIntakeBriefDraft {
  return affaireIntakeBriefDraftSchema.parse({
    status: input.brief.status,
    summary: input.brief.summary,
    projectObject: input.brief.project_object,
    scope: input.brief.scope,
    lots: input.brief.lots,
    receivedPieces: input.brief.received_pieces,
    assumptions: input.brief.assumptions,
    vigilancePoints: input.brief.vigilance_points,
    missingElements: input.brief.missing_elements,
    sources: input.sources.map((source) => ({
      blockKey: source.block_key,
      entryIndex: source.entry_index,
      sourceDocumentId: source.source_document_id,
      sourceFileName: source.source_file_name,
      rationale: source.rationale,
    })),
    uploadId: input.brief.upload_id,
    lastGeneratedAt: input.brief.last_generated_at,
    confirmedAt: input.brief.confirmed_at,
  });
}

function getComparableBriefPayload(brief: AffaireIntakeBriefDraft) {
  return JSON.stringify({
    summary: brief.summary,
    projectObject: brief.projectObject,
    scope: brief.scope,
    lots: brief.lots,
    receivedPieces: brief.receivedPieces,
    assumptions: brief.assumptions,
    vigilancePoints: brief.vigilancePoints,
    missingElements: brief.missingElements,
    sources: [...brief.sources].sort((left, right) =>
      `${left.blockKey}:${left.entryIndex}:${left.sourceDocumentId}`.localeCompare(
        `${right.blockKey}:${right.entryIndex}:${right.sourceDocumentId}`,
        "fr"
      )
    ),
  });
}

async function fetchAffaireBriefForProject(input: {
  supabase: AffaireIntakeSupabaseClient;
  projectId: string;
}) {
  const briefTable = input.supabase.from("affaire_briefs" as never) as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => {
          maybeSingle: () => PromiseLike<unknown>;
        };
      };
    };
  };
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    briefTable
      .select(BRIEF_SELECT)
      .eq("project_id", input.projectId)
      .order("updated_at", { ascending: false })
      .maybeSingle()
  );

  if (error) {
    throw internalError("Impossible de charger le brief affaire.", error);
  }

  const brief = normalizeAffaireBriefRow(data);
  if (!brief) {
    return null;
  }

  const sourceTable = input.supabase.from("affaire_brief_source_links" as never) as {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean }
        ) => PromiseLike<unknown>;
      };
    };
  };
  const { data: sourceData, error: sourceError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    sourceTable
      .select(BRIEF_SOURCE_SELECT)
      .eq("brief_id", brief.id)
      .order("block_key", { ascending: true })
  );

  if (sourceError) {
    throw internalError("Impossible de charger les sources du brief affaire.", sourceError);
  }

  const sources = (sourceData ?? [])
    .map(normalizeAffaireBriefSourceRow)
    .filter((row): row is AffaireBriefSourceRow => row !== null)
    .sort((left, right) =>
      `${left.block_key}:${left.entry_index}:${left.source_document_id}`.localeCompare(
        `${right.block_key}:${right.entry_index}:${right.source_document_id}`,
        "fr"
      )
    );

  return {
    brief,
    sources,
    draft: normalizeAffaireBriefDraftFromRows({
      brief,
      sources,
    }),
  };
}

async function generateAffaireBriefDraft(input: {
  project: AffaireProjectAccessRow;
  uploadId: string;
  documents: AffaireBriefGenerationDocument[];
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
}): Promise<AffaireIntakeBriefDraft> {
  const fallback = buildFallbackAffaireBrief({
    project: input.project,
    uploadId: input.uploadId,
    documents: input.documents,
    missingPieces: input.missingPieces,
  });

  let generated: AffaireBriefGeneration | null = null;

  try {
    const result = await callGeminiStructured({
      prompt: buildBriefGenerationPrompt({
        project: input.project,
        documents: input.documents,
        missingPieces: input.missingPieces,
      }),
      schema: affaireBriefGenerationSchema,
      thinkingLevel: AFFAIRE_BRIEF_THINKING_LEVEL,
      context: {
        model: AFFAIRE_BRIEF_MODEL,
        promptVersion: AFFAIRE_BRIEF_PROMPT_VERSION,
      },
    });

    generated = result.data;
  } catch (error) {
    console.error("Affaire brief AI generation failed", {
      projectId: input.project.id,
      uploadId: input.uploadId,
      error,
    });
  }

  const generation = mergeGeneratedAffaireBriefWithFallback({
    generated,
    fallback,
    documents: input.documents,
  });
  const lastGeneratedAt = new Date().toISOString();

  return toAffaireBriefDraft({
    generation,
    uploadId: input.uploadId,
    status: "a_confirmer",
    lastGeneratedAt,
    confirmedAt: null,
    documents: input.documents,
  });
}

async function persistAffaireBriefDraft(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireProjectAccessRow;
  uploadId: string;
  draft: AffaireIntakeBriefDraft;
  actorUserId?: string | null;
}) {
  const existing = await fetchAffaireBriefForProject({
    supabase: input.supabase,
    projectId: input.project.id,
  });

  const currentDraft = existing?.draft ?? null;
  const contentChanged =
    !currentDraft ||
    getComparableBriefPayload(currentDraft) !== getComparableBriefPayload(input.draft) ||
    currentDraft.uploadId !== input.draft.uploadId;

  const nextStatus: AffaireIntakeBriefStatus =
    contentChanged || !currentDraft
      ? "a_confirmer"
      : currentDraft.status;
  const nextConfirmedAt =
    nextStatus === "confirme" ? currentDraft?.confirmedAt ?? null : null;

  const payload = {
    project_id: input.project.id,
    upload_id: input.uploadId,
    created_by: existing?.brief.created_by ?? input.actorUserId ?? null,
    updated_by: input.actorUserId ?? null,
    confirmed_by:
      nextStatus === "confirme" ? existing?.brief.confirmed_by ?? null : null,
    status: nextStatus,
    summary: input.draft.summary,
    project_object: input.draft.projectObject,
    scope: input.draft.scope,
    lots: input.draft.lots,
    received_pieces: input.draft.receivedPieces,
    assumptions: input.draft.assumptions,
    vigilance_points: input.draft.vigilancePoints,
    missing_elements: input.draft.missingElements,
    generation_metadata: {
      prompt_version: AFFAIRE_BRIEF_PROMPT_VERSION,
      generated_from_upload_id: input.uploadId,
      regenerated_by: input.actorUserId ?? null,
    },
    last_generated_at: input.draft.lastGeneratedAt,
    confirmed_at: nextConfirmedAt,
  } as const;

  const briefMutationTable = input.supabase.from("affaire_briefs" as never) as {
    update: (values: unknown) => {
      eq: (column: string, value: string) => {
        select: (columns: string) => {
          single: () => PromiseLike<unknown>;
        };
      };
    };
    insert: (values: unknown) => {
      select: (columns: string) => {
        single: () => PromiseLike<unknown>;
      };
    };
  };
  const query = existing
    ? (briefMutationTable
        .update(payload as never)
        .eq("id", existing.brief.id)
        .select(BRIEF_SELECT)
        .single() as PromiseLike<{ data: unknown; error: unknown }>)
    : (briefMutationTable
        .insert(payload as never)
        .select(BRIEF_SELECT)
        .single() as PromiseLike<{ data: unknown; error: unknown }>);

  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(query);

  if (error) {
    throw internalError("Impossible de persister le brief affaire.", error);
  }

  const brief = normalizeAffaireBriefRow(data);
  if (!brief) {
    throw internalError("Le brief affaire retourne une reponse invalide.");
  }

  await replaceAffaireBriefSourceLinks({
    supabase: input.supabase,
    briefId: brief.id,
    sources: input.draft.sources,
    actorUserId: input.actorUserId ?? null,
  });

  if (contentChanged) {
    await insertAffaireIntakeEvent({
      supabase: input.supabase,
      uploadId: input.uploadId,
      actorUserId: input.actorUserId ?? null,
      eventType: "brief.generated",
      beforePayload: currentDraft
        ? {
            status: currentDraft.status,
            summary: currentDraft.summary,
          }
        : null,
      afterPayload: {
        status: nextStatus,
        summary: input.draft.summary,
        scope_count: input.draft.scope.length,
        assumption_count: input.draft.assumptions.length,
      },
    });
  }

  await syncAffaireRegisterFromBrief({
    supabase: input.supabase as never,
    project: input.project,
    assumptions: input.draft.assumptions,
    sources: input.draft.sources,
    actorUserId: input.actorUserId ?? null,
  });

  return affaireIntakeBriefDraftSchema.parse({
    ...input.draft,
    status: nextStatus,
    confirmedAt: nextConfirmedAt,
  });
}

async function refreshAffaireBriefFromDocuments(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireProjectAccessRow;
  uploadId: string;
  documents: AffaireIntakeDocumentRow[];
  actorUserId?: string | null;
}) {
  const uploadedDocuments = input.documents.filter(
    (document) => document.upload_status === "uploaded"
  );
  const missingPieces = buildAffaireIntakeMissingPieces(
    input.documents.map((document) => ({
      uploadStatus: document.upload_status,
      classificationStatus: document.classification_status,
      documentKind: document.document_kind,
    }))
  );

  await syncAffaireRegisterMissingPieces({
    supabase: input.supabase as never,
    project: input.project,
    missingPieces,
    actorUserId: input.actorUserId ?? null,
  });

  try {
    await syncTakeoffPlanSetFromAffaireIntake({
      supabase: input.supabase as never,
      project: {
        id: input.project.id,
        tenant_id: input.project.tenant_id,
      },
      documents: input.documents,
    });
  } catch (error) {
    console.error("Affaire intake takeoff sync failed", {
      uploadId: input.uploadId,
      projectId: input.project.id,
      error,
    });
  }

  if (uploadedDocuments.length === 0) {
    return null;
  }

  const briefDraft = await generateAffaireBriefDraft({
    project: input.project,
    uploadId: input.uploadId,
    documents: uploadedDocuments.map((document) => ({
      id: document.id,
      file_name: document.file_name,
      document_kind: document.document_kind,
      confidence: document.confidence,
      issues: document.issues,
      extracted_metadata: document.extracted_metadata,
    })),
    missingPieces,
  });

  return persistAffaireBriefDraft({
    supabase: input.supabase,
    project: input.project,
    uploadId: input.uploadId,
    draft: briefDraft,
    actorUserId: input.actorUserId,
  });
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
        documentKind: classification.result.documentKind,
        confidence: classification.result.confidence,
      });

      const { error: updateDocumentError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents" as never)
          .update({
            classification_status: classificationStatus,
            document_kind: classification.result.documentKind,
            confidence: classification.result.confidence,
            issues: classification.result.issues,
            extracted_metadata: classification.result.extractedMetadata,
            classification_source: classification.source,
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
          document_kind: classification.result.documentKind,
          classification_status: classificationStatus,
          classification_source: classification.source,
          confidence: classification.result.confidence,
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

  await syncAffaireIntakeDocumentPriorities({
    supabase,
    projectId: upload.project_id,
  });

  const status = await updateUploadStatusFromStoredDocuments({
    supabase,
    uploadId: upload.id,
  });

  const [{ data: refreshedDocsData, error: refreshedDocsError }, { data: projectData, error: projectError }] =
    await Promise.all([
      resolveSupabaseQuery<{
        data: unknown[];
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents" as never)
          .select(DOCUMENT_SELECT as never)
          .eq("upload_id", upload.id)
          .order("created_at", { ascending: true })
      ),
      resolveSupabaseQuery<{
        data: unknown;
        error: unknown;
      }>(
        supabase
          .from("estimate_projects" as never)
          .select(PROJECT_SELECT as never)
          .eq("id", upload.project_id)
          .maybeSingle()
      ),
    ]);

  if (!refreshedDocsError && !projectError) {
    const refreshedDocuments = (refreshedDocsData ?? [])
      .map(normalizeDocumentRow)
      .filter((row): row is AffaireIntakeDocumentRow => row !== null);
    const project = projectData as AffaireProjectAccessRow | null;

    if (project && !project.is_archived) {
      await refreshAffaireBriefFromDocuments({
        supabase,
        project,
        uploadId: upload.id,
        documents: refreshedDocuments,
      }).catch((error) => {
        console.error("Affaire brief refresh failed after intake processing", {
          uploadId: upload.id,
          projectId: upload.project_id,
          error,
        });
      });
    }
  } else {
    console.error("Failed to load data for affaire brief refresh", {
      uploadId: upload.id,
      projectId: upload.project_id,
      refreshedDocsError,
      projectError,
    });
  }

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
  const { context, project } = await requireAffaireProjectReadAccess(projectId);

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
    const brief = await fetchAffaireBriefForProject({
      supabase: context.supabase,
      projectId: project.id,
    });

    return {
      projectId: project.id,
      uploadId: null,
      documents: [],
      missingPieces: [],
      readiness: buildAffaireIntakeReadinessSnapshot({
        documents: [],
        missingPieces: [],
      }),
      briefDraft: brief?.draft ?? null,
    };
  }

  const { data: docsData, error: docsError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents" as never)
      .select(DOCUMENT_SELECT as never)
      .eq("project_id", project.id)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
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
  const brief = await fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  });
  const workspaceDocuments = documents.map((document) => ({
    documentId: document.id,
    fileName: document.file_name,
    detectedCategory: document.document_kind,
    classificationStatus: document.classification_status,
    classificationSource: document.classification_source,
    documentPriority: document.document_priority,
    confidence: document.confidence ?? 0,
    extractedMetadata: document.extracted_metadata,
    issues: [
      ...document.issues,
      ...(document.rejection_reason ? [document.rejection_reason] : []),
    ],
  }));
  const missingPieces = buildAffaireIntakeMissingPieces(
    documents.map((document) => ({
      uploadStatus: document.upload_status,
      classificationStatus: document.classification_status,
      documentKind: document.document_kind,
    }))
  );

  return {
    projectId: project.id,
    uploadId: upload.id,
    documents: workspaceDocuments,
    missingPieces,
    readiness: buildAffaireIntakeReadinessSnapshot({
      documents: documents.map((document) => ({
        fileName: document.file_name,
        uploadStatus: document.upload_status,
        classificationStatus: document.classification_status,
        detectedCategory: document.document_kind,
        confidence: document.confidence,
        issues: [
          ...document.issues,
          ...(document.rejection_reason ? [document.rejection_reason] : []),
        ],
      })),
      missingPieces,
    }),
    briefDraft: brief?.draft ?? null,
  };
}

export async function updateAffaireBrief(input: {
  projectId: string;
  summary: string;
  scope: string[];
  vigilancePoints: string[];
  assumptions: string[];
}) {
  const { context, project } = await requireAffaireProjectBriefEditor(
    input.projectId
  );
  const existing = await fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  });

  if (!existing) {
    throw notFound("Brief affaire introuvable.");
  }

  const nextDraft = affaireIntakeBriefDraftSchema.parse({
    ...existing.draft,
    summary: input.summary.trim(),
    scope: normalizeAffaireIntakeTextList(input.scope, {
      maxItems: 12,
      maxLength: 280,
    }),
    vigilancePoints: normalizeAffaireIntakeTextList(input.vigilancePoints, {
      maxItems: 12,
      maxLength: 280,
    }),
    assumptions: normalizeAffaireIntakeTextList(input.assumptions, {
      maxItems: 12,
      maxLength: 280,
    }),
    status: "a_confirmer",
    confirmedAt: null,
  });

  const contentChanged =
    getComparableBriefPayload(existing.draft) !== getComparableBriefPayload(nextDraft);

  if (!contentChanged) {
    return {
      ok: true,
      status: existing.draft.status,
    } as const;
  }

  const nextSources = remapBriefSourcesForEditedDraft({
    previous: existing.draft,
    next: nextDraft,
  });

  const { error } = await resolveSupabaseQuery<{ error: unknown }>(
    context.supabase
      .from("affaire_briefs" as never)
      .update({
        summary: nextDraft.summary,
        scope: nextDraft.scope,
        vigilance_points: nextDraft.vigilancePoints,
        assumptions: nextDraft.assumptions,
        status: "a_confirmer",
        confirmed_at: null,
        confirmed_by: null,
        updated_by: context.userId,
      } as never)
      .eq("id", existing.brief.id)
  );

  if (error) {
    throw internalError("Impossible de mettre a jour le brief affaire.", error);
  }

  await replaceAffaireBriefSourceLinks({
    supabase: context.supabase,
    briefId: existing.brief.id,
    sources: nextSources,
    actorUserId: context.userId,
  });

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: existing.brief.upload_id,
    actorUserId: context.userId,
    eventType: "brief.updated",
    beforePayload: {
      status: existing.draft.status,
      summary: existing.draft.summary,
    },
    afterPayload: {
      status: "a_confirmer",
      summary: nextDraft.summary,
      scope_count: nextDraft.scope.length,
      assumption_count: nextDraft.assumptions.length,
    },
  });

  await syncAffaireRegisterFromBrief({
    supabase: context.supabase as never,
    project,
    assumptions: nextDraft.assumptions,
    sources: nextSources,
    actorUserId: context.userId,
  });

  return {
    ok: true,
    status: "a_confirmer",
  } as const;
}

export async function confirmAffaireBrief(input: { projectId: string }) {
  const { context, project } = await requireAffaireProjectBriefEditor(
    input.projectId
  );
  const existing = await fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  });

  if (!existing) {
    throw notFound("Brief affaire introuvable.");
  }

  if (existing.draft.status === "confirme") {
    return {
      ok: true,
      status: "confirme",
    } as const;
  }

  const confirmedAt = new Date().toISOString();
  const { error } = await resolveSupabaseQuery<{ error: unknown }>(
    context.supabase
      .from("affaire_briefs" as never)
      .update({
        status: "confirme",
        confirmed_at: confirmedAt,
        confirmed_by: context.userId,
        updated_by: context.userId,
      } as never)
      .eq("id", existing.brief.id)
  );

  if (error) {
    throw internalError("Impossible de confirmer le brief affaire.", error);
  }

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: existing.brief.upload_id,
    actorUserId: context.userId,
    eventType: "brief.confirmed",
    beforePayload: {
      status: existing.draft.status,
    },
    afterPayload: {
      status: "confirme",
      confirmed_at: confirmedAt,
    },
  });

  return {
    ok: true,
    status: "confirme",
  } as const;
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

  await syncAffaireIntakeDocumentPriorities({
    supabase: context.supabase,
    projectId: project.id,
  });

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
      classification_source: "manual",
      confidence: input.category === "a_classer" ? 0.4 : 1,
    },
  });

  await updateUploadStatusFromStoredDocuments({
    supabase: context.supabase,
    uploadId: document.upload_id,
  });

  const { data: refreshedDocsData, error: refreshedDocsError } =
    await resolveSupabaseQuery<{
      data: unknown[];
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .select(DOCUMENT_SELECT as never)
        .eq("upload_id", document.upload_id)
        .order("created_at", { ascending: true })
    );

  if (refreshedDocsError) {
    throw internalError(
      "Impossible de recharger les documents intake apres reclassification.",
      refreshedDocsError
    );
  }

  const refreshedDocuments = (refreshedDocsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);

  await refreshAffaireBriefFromDocuments({
    supabase: context.supabase,
    project,
    uploadId: document.upload_id,
    documents: refreshedDocuments,
    actorUserId: context.userId,
  });

  return { ok: true } as const;
}

export async function setAffaireDocumentAsPrimary(input: {
  projectId: string;
  documentId: string;
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
      "Impossible de charger le document intake principal.",
      error
    );
  }

  const document = normalizeDocumentRow(data);

  if (!document) {
    throw notFound("Document intake introuvable.");
  }

  if (!isAffaireIntakePrimaryEligibleKind(document.document_kind)) {
    throw badRequest(
      "Seuls les documents DPGF et CCTP peuvent etre definis comme principaux."
    );
  }

  const { data: kindDocumentsData, error: kindDocumentsError } =
    await resolveSupabaseQuery<{
      data: unknown[];
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .select(DOCUMENT_SELECT as never)
        .eq("project_id", project.id)
        .eq("document_kind", document.document_kind)
        .order("created_at", { ascending: true })
    );

  if (kindDocumentsError) {
    throw internalError(
      "Impossible de charger les documents intake de cette categorie.",
      kindDocumentsError
    );
  }

  const kindDocuments = (kindDocumentsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);
  const previousPrimary =
    kindDocuments.find((row) => row.document_priority === "primary") ?? null;

  if (previousPrimary?.id !== document.id) {
    const { error: demoteError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .update({
          document_priority: "secondary",
        } as never)
        .eq("project_id", project.id)
        .eq("document_kind", document.document_kind)
        .eq("document_priority", "primary")
    );

    if (demoteError) {
      throw internalError(
        "Impossible de retirer le document principal actuel.",
        demoteError
      );
    }

    const { error: promoteError } = await resolveSupabaseQuery<{
      error: unknown;
    }>(
      context.supabase
        .from("affaire_intake_documents" as never)
        .update({
          document_priority: "primary",
        } as never)
        .eq("id", document.id)
    );

    if (promoteError) {
      throw internalError(
        "Impossible de definir ce document comme principal.",
        promoteError
      );
    }
  }

  await syncAffaireIntakeDocumentPriorities({
    supabase: context.supabase,
    projectId: project.id,
  });

  await insertAffaireIntakeEvent({
    supabase: context.supabase,
    uploadId: document.upload_id,
    documentId: document.id,
    actorUserId: context.userId,
    eventType: "document.priority_changed",
    beforePayload: {
      previous_primary_document_id: previousPrimary?.id ?? null,
      previous_primary_file_name: previousPrimary?.file_name ?? null,
      document_priority: document.document_priority,
    },
    afterPayload: {
      document_kind: document.document_kind,
      document_priority: "primary",
    },
  });

  return {
    ok: true,
    documentPriority: "primary" as const,
  };
}
