import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { startConcurrentRead } from "@/lib/supabase/concurrent-read";
import { cache } from "react";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { internalError, mapSupabaseError } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getIntakeAnalysisAvailability } from "@/lib/affaires/intake-decisions";
import {
  buildAffaireIntakeReadinessSnapshot,
  type AffaireIntakeBriefDraft,
  type AffaireIntakeClassificationSource,
  type AffaireIntakeClassificationStatus,
  type AffaireIntakeDocumentKind,
  type AffaireIntakeDocumentPriority,
  type AffaireIntakeDocumentUploadStatus,
  type AffaireIntakeExtractedMetadata,
  type AffaireIntakeReadinessSnapshot,
  type AffaireIntakeWorkspaceMissingPiece,
} from "@/lib/affaires/intake";
import { AFFAIRE_ACCESS_PROJECT_COLUMNS, canAccessAffaire, requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { readStandalonePlanRowsByProject, type StandalonePlanRow } from "@/lib/affaires/plan-presence";
import type { DriveProvenance } from "@/lib/affaires/google-drive/contracts";
import { driveProvenance } from "@/lib/affaires/google-drive/store";
import { isRecord } from "@/lib/value-guards";
import {
  type AffaireIntakeDocumentRow,
  UPLOAD_SELECT,
  DOCUMENT_SELECT,
  resolveSupabaseQuery,
  normalizeUploadRow,
  normalizeDocumentRow,
} from "@/lib/affaires/intake-rows";
import {
  BRIEF_SELECT,
  normalizeAffaireBriefRow,
  normalizeAffaireBriefDraftFromRows,
  fetchAffaireBriefForProject,
} from "@/lib/affaires/intake-brief-store";
import { getMissingPiecesForProject } from "@/lib/affaires/intake-missing-pieces";

type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

export type AffaireIntakeWorkspace = {
  projectId: string;
  analysisAvailability?: { available: boolean; message: string; provider?: "decisions" | "chatgpt" };
  uploadId: string | null;
  /**
   * The affaire's batches whose analysis has not ended, oldest first: the server records a batch's end once its run
   * wrote the brief (intake-follow.ts). The page reads the dossier until none is left.
   */
  pendingUploadIds?: string[];
  canManageDocuments?: boolean;
  documents: Array<{
    documentId: string;
    fileName: string;
    uploadStatus?: AffaireIntakeDocumentUploadStatus;
    mimeType?: string | null;
    isBeingDeleted?: boolean;
    driveSource?: DriveProvenance;
    sizeBytes?: number;
    detectedCategory: AffaireIntakeDocumentKind;
    classificationStatus?: AffaireIntakeClassificationStatus;
    classificationSource?: AffaireIntakeClassificationSource | null;
    manuallyOverriddenAt?: string | null;
    classificationUpdatedAt?: string | null;
    documentPriority?: AffaireIntakeDocumentPriority | null;
    confidence: number;
    extractedMetadata: AffaireIntakeExtractedMetadata;
    issues: string[];
  }>;
  missingPieces: AffaireIntakeWorkspaceMissingPiece[];
  readiness?: AffaireIntakeReadinessSnapshot;
  briefDraft: AffaireIntakeBriefDraft | null;
};

export const fetchAffaireIntakeWorkspace = cache(async (
  projectId: string
): Promise<AffaireIntakeWorkspace> => {
  const { context, project } = await requireAffaireAccess(projectId, "read");
  // The brief is independent of the latest upload and its documents. Keep the
  // original error order by awaiting it later, with early rejections observed.
  const briefPromise = startConcurrentRead(fetchAffaireBriefForProject({
    supabase: context.supabase,
    projectId: project.id,
  }));

  const { data: uploadData, error: uploadError } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_uploads")
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
    const brief = await briefPromise;

    return {
      projectId: project.id,
      uploadId: null,
      pendingUploadIds: [],
      documents: [],
      missingPieces: [],
      readiness: buildAffaireIntakeReadinessSnapshot({
        documents: [],
        missingPieces: [],
      }),
      briefDraft: brief?.draft ?? null,
    };
  }

  const pendingUploadsPromise = startConcurrentRead(resolveSupabaseQuery<{ data: unknown[] | null; error: unknown }>(
    context.supabase
      .from("affaire_intake_uploads")
      .select("id, status" as never)
      .eq("project_id", project.id)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
  ));
  const canManageDocuments = canAccessAffaire(context, project.user_id, "write");
  const analysisAvailabilityPromise = canManageDocuments
    ? startConcurrentRead(getIntakeAnalysisAvailability(context))
    : undefined;

  const { data: docsData, error: docsError } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    readAllRows(() => context.supabase
      .from("affaire_intake_documents")
      .select(DOCUMENT_SELECT as never, { count: "exact" })
      .eq("project_id", project.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }))
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
  // Plan presence depends on the documents, but not on the brief.
  const missingPiecesPromise = startConcurrentRead(getMissingPiecesForProject({
    supabase: context.supabase, project, documents,
  }));
  const brief = await briefPromise;
  const workspaceDocuments = documents.map((document) => ({
    documentId: document.id,
    fileName: document.file_name,
    uploadStatus: document.upload_status,
    mimeType: document.mime_type,
    isBeingDeleted: Boolean(document.deletion_token),
    driveSource: document.drive_file_id ? driveProvenance({ ...document, drive_file_id: document.drive_file_id }) : undefined,
    sizeBytes: document.size_bytes,
    detectedCategory: document.document_kind,
    classificationStatus: document.classification_status,
    classificationSource: document.classification_source,
    manuallyOverriddenAt: document.manually_overridden_at,
    classificationUpdatedAt: document.updated_at,
    documentPriority: document.document_priority,
    confidence: document.confidence ?? 0,
    extractedMetadata: document.extracted_metadata,
    issues: [
      ...document.issues,
      ...(document.rejection_reason ? [document.rejection_reason] : []),
    ],
  }));
  const [missingPieces, analysisAvailability, pendingUploads] = await Promise.all([
    missingPiecesPromise,
    analysisAvailabilityPromise,
    pendingUploadsPromise,
  ]);
  if (pendingUploads.error) {
    throw internalError("Impossible de lire l’analyse en cours du dossier.", pendingUploads.error);
  }

  return {
    projectId: project.id,
    uploadId: upload.id,
    pendingUploadIds: (pendingUploads.data ?? []).flatMap((row) =>
      row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string" ? [(row as { id: string }).id] : []),
    analysisAvailability,
    canManageDocuments,
    documents: workspaceDocuments,
    missingPieces,
    readiness: buildStoredDocumentsReadiness(documents, missingPieces),
    briefDraft: brief?.draft ?? null,
  };
});

/** Readiness of a dossier from its stored documents; a document whose deletion is reserved no longer counts. */
function buildStoredDocumentsReadiness(
  documents: AffaireIntakeDocumentRow[],
  missingPieces: AffaireIntakeWorkspaceMissingPiece[]
) {
  return buildAffaireIntakeReadinessSnapshot({
    documents: documents.filter((document) => !document.deletion_token).map((document) => ({
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
  });
}

export type AffaireIntakeManagerSignal = {
  briefStatus: AffaireIntakeBriefDraft["status"] | null;
  readiness: Pick<
    AffaireIntakeReadinessSnapshot,
    "reviewDocumentsCount" | "confirmedMissingPiecesCount" | "confirmedCriticalMissingPiecesCount"
  >;
};

const MANAGER_SIGNAL_PLAN_CHECK_CONCURRENCY = 8;

/**
 * What a portfolio screen needs from each affaire's dossier (the brief's status and the readiness counts of
 * fetchAffaireIntakeWorkspace), read for all the affaires at once: one request per table and per chunk of affaires,
 * where calling the workspace reader per affaire costs about eight requests each. Only the bytes behind a plan are
 * still checked affaire by affaire, as the workspace does, and no longer once `deadlineAt` has passed.
 *
 * An affaire the caller may not read, an archived or unknown one, or one whose signals could not be established
 * (in time), is absent from the result: the caller must count it as unqualified, never as ready.
 */
export async function fetchAffaireIntakeManagerSignals(input: {
  context: AuthenticatedContext;
  projectIds: readonly string[];
  deadlineAt?: number;
}): Promise<Map<string, AffaireIntakeManagerSignal>> {
  const { context } = input;
  const { data: projectData, error: projectError } = await readAllRowsInChunks(input.projectIds, (ids) =>
    context.supabase
      .from("estimate_projects")
      .select(AFFAIRE_ACCESS_PROJECT_COLUMNS, { count: "exact" })
      .eq("tenant_id", context.tenantId)
      .in("id", ids));
  if (projectError) throw mapSupabaseError(projectError, "Impossible de charger les affaires.");

  const projects = ((projectData ?? []) as AffaireAccessProject[]).filter((project) =>
    !project.is_archived && canAccessAffaire(context, project.user_id, "read"));
  const readByProject = async (table: string, columns: string, live = false) => {
    const { data, error } = await readAllRowsInChunks(projects.map((project) => project.id), (ids) => {
      const query = context.supabase.from(table as never).select(columns as never, { count: "exact" })
        .in("project_id", ids as never);
      return (live ? query.is("deleted_at", null) : query) as never;
    }, { order: table === "affaire_intake_uploads"
      ? [{ column: "created_at", ascending: false }, { column: "id", ascending: false }]
      : [{ column: "created_at", ascending: true }] });
    if (error) throw internalError("Impossible de charger les dossiers des affaires.", error);
    const rowsByProjectId = new Map<string, unknown[]>();
    for (const row of (data ?? []) as unknown[]) {
      const projectId = isRecord(row) && typeof row.project_id === "string" ? row.project_id : "";
      rowsByProjectId.set(projectId, [...(rowsByProjectId.get(projectId) ?? []), row]);
    }
    return rowsByProjectId;
  };
  const [briefRows, uploadRows, documentRows] = await Promise.all([
    readByProject("affaire_briefs", BRIEF_SELECT),
    // Only the latest upload opens the dossier, as in the workspace: its identity and status are enough.
    readByProject("affaire_intake_uploads", "id, project_id, status, created_at"),
    readByProject("affaire_intake_documents", DOCUMENT_SELECT, true),
  ]);
  const opened = projects.filter((project) => normalizeUploadRow(uploadRows.get(project.id)?.[0]));
  // Access is established above: the server client gives a director the owner's presence boolean. Affaires
  // without a dossier have no missing piece to lift, so their plan files are not read.
  const planRows = opened.length === 0 ? new Map<string, StandalonePlanRow[]>() : await readStandalonePlanRowsByProject({
    supabase: createServiceRoleClient() as never, tenantId: context.tenantId, projectIds: opened.map((project) => project.id),
  });

  const signals = new Map<string, AffaireIntakeManagerSignal>();
  const readSignal = async (project: AffaireAccessProject) => {
    const briefs = briefRows.get(project.id) ?? [];
    // The workspace reader refuses an affaire with several briefs or one whose draft does not parse.
    if (briefs.length > 1) return;
    const brief = normalizeAffaireBriefRow(briefs[0]);
    const briefStatus = brief ? normalizeAffaireBriefDraftFromRows({ brief, sources: [] }).status : null;
    const documents = !opened.includes(project) ? [] : (documentRows.get(project.id) ?? [])
      .map(normalizeDocumentRow)
      .filter((row): row is AffaireIntakeDocumentRow => row !== null);
    const { reviewDocumentsCount, confirmedMissingPiecesCount, confirmedCriticalMissingPiecesCount } =
      buildStoredDocumentsReadiness(documents, !opened.includes(project) ? [] : await getMissingPiecesForProject({
        supabase: context.supabase, project, documents, standalonePlanRows: planRows.get(project.id) ?? [],
      }));
    signals.set(project.id, { briefStatus,
      readiness: { reviewDocumentsCount, confirmedMissingPiecesCount, confirmedCriticalMissingPiecesCount } });
  };

  // Affaires without a dossier cost no request: qualify them first, then spend the remaining time on the others.
  const queue = [...projects].sort((left, right) => Number(opened.includes(left)) - Number(opened.includes(right)));
  await Promise.all(Array.from({ length: MANAGER_SIGNAL_PLAN_CHECK_CONCURRENCY }, async () => {
    for (let project = queue.shift(); project; project = queue.shift()) {
      if (opened.includes(project) && input.deadlineAt !== undefined && Date.now() > input.deadlineAt) return;
      // One affaire's failure leaves it unqualified without hiding the others.
      await readSignal(project).catch(() => undefined);
    }
  }));
  return signals;
}
