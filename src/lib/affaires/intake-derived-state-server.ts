import { readAllRows } from "@/lib/supabase/read-all";
import { internalError, mapSupabaseError } from "@/lib/http/api-response";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import * as durableIntake from "@/lib/workflows/affaire-intake-lifecycle";
import { isAffaireIntakeReanalysisPending } from "@/lib/affaires/intake";
import { requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { syncAffaireRegisterMissingPieces, syncAffairePlanGap } from "@/lib/affaires/register-sync-server";
import {
  type AffaireIntakeDocumentRow,
  type AffaireIntakeSupabaseClient,
  DOCUMENT_SELECT,
  resolveSupabaseQuery,
  getAffaireIntakeSelectTable,
  normalizeDocumentRow,
} from "@/lib/affaires/intake-rows";
import { generateAffaireBriefDraft } from "@/lib/affaires/intake-brief-generation";
import { fetchAffaireBriefForProject, persistAffaireBriefDraft } from "@/lib/affaires/intake-brief-store";
import { getMissingPiecesForProject } from "@/lib/affaires/intake-missing-pieces";

export async function refreshAffaireBriefFromDocuments(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireAccessProject;
  uploadId: string;
  documents: AffaireIntakeDocumentRow[];
  actorUserId?: string | null;
  renewLease?: () => Promise<void>;
  aiOwner?: ChatGptOwner | null;
  /** False when the caller must not wait on Drive (a deletion only retires copies). */
  readDrive?: boolean;
  /** A provenance-only confirmation can keep an up-to-date brief after reconciliation. */
  reuseBriefForConfirmation?: boolean;
}) {
  const uploadedDocuments = input.documents.filter(
    (document) => document.upload_status === "uploaded"
  );

  // Before the missing pieces: a Drive plan counts once its métré working copy exists.
  let planSync: Awaited<ReturnType<typeof syncTakeoffPlanSetFromAffaireIntake>> | null = null;
  try {
    planSync = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: input.supabase as never,
      project: {
        id: input.project.id,
        tenant_id: input.project.tenant_id,
      },
      documents: input.documents,
      readDriveDocument: input.readDrive === false ? undefined : readLinkedDriveDocument,
      beforeDriveRead: input.renewLease,
    });
  } catch (error) {
    if (error instanceof durableIntake.AffaireIntakeLeaseUnavailableError) throw error;
    console.error("Affaire intake takeoff sync failed", {
      uploadId: input.uploadId,
      projectId: input.project.id,
      error,
    });
  }

  const missingPieces = await getMissingPiecesForProject(input);

  await syncAffaireRegisterMissingPieces({
    supabase: input.supabase as never,
    project: input.project,
    missingPieces,
    actorUserId: input.actorUserId ?? null,
  });

  if (uploadedDocuments.length === 0) {
    return null;
  }

  if (input.reuseBriefForConfirmation && planSync?.syncedDocumentCount === 0 && planSync.removedDocumentCount === 0 &&
      !missingPieces.some((piece) => piece.code === "missing_plans")) {
    const existing = await fetchAffaireBriefForProject({ supabase: input.supabase, projectId: input.project.id });
    const generatedAt = Date.parse(existing?.draft.lastGeneratedAt ?? "");
    const current = Number.isFinite(generatedAt) && uploadedDocuments.every((document) => {
      const classifiedAt = Date.parse(document.classified_at ?? document.updated_at);
      return !["queued", "processing"].includes(document.classification_status) &&
        !isAffaireIntakeReanalysisPending(document) && Number.isFinite(classifiedAt) && classifiedAt <= generatedAt;
    });
    if (existing && current) {
      await syncAffairePlanGap({ projectId: input.project.id, actorUserId: input.actorUserId });
      return existing.draft;
    }
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
    renewLease: input.renewLease,
    aiOwner: input.aiOwner,
  });

  const draft = await persistAffaireBriefDraft({
    supabase: input.supabase,
    project: input.project,
    uploadId: input.uploadId,
    draft: briefDraft,
    actorUserId: input.actorUserId,
  });
  await syncAffairePlanGap({ projectId: input.project.id, actorUserId: input.actorUserId });
  return draft;
}

/** Reconcile system gaps after a plan file has been uploaded or removed. */
export async function reconcileAffairePlanPresence(projectId: string) {
  const { context, project } = await requireAffaireAccess(projectId, "write");
  const { data: upload, error: uploadError } = await context.supabase
    .from("affaire_intake_uploads")
    .select("id" as never)
    .eq("project_id", project.id)
    .eq("tenant_id", context.tenantId)
    .limit(1)
    .maybeSingle();
  if (uploadError) throw mapSupabaseError(uploadError, "Impossible de charger le dossier de l'affaire.");
  if (!upload) return { changed: false };

  // Revisit unfinished intake-to-plan copies before reconciling the plan gap.
  // Other document categories are deliberately outside this operation.
  const { data, error } = await readAllRows(() => getAffaireIntakeSelectTable(context.supabase, "affaire_intake_documents")
    .select(DOCUMENT_SELECT as never, { count: "exact" })
    .eq("project_id", project.id).eq("tenant_id", context.tenantId)
    .is("deleted_at", null).is("deletion_token", null));
  if (error) throw internalError("Impossible de charger les pièces du dossier.", error);
  const documents = (data ?? []).map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);
  let planCopiesChanged = false;
  try {
    const planSync = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: context.supabase as never,
      project: { id: project.id, tenant_id: project.tenant_id },
      documents,
      readDriveDocument: readLinkedDriveDocument,
    });
    planCopiesChanged = planSync.syncedDocumentCount > 0 || planSync.removedDocumentCount > 0;
  } catch (error) {
    await syncAffairePlanGap({ projectId: project.id, actorUserId: context.userId });
    throw error;
  }
  const changed = await syncAffairePlanGap({ projectId: project.id, actorUserId: context.userId });
  return { changed: changed || planCopiesChanged };
}

// After a reclassification or a deletion, the register's missing pieces, the synced
// plans and the current brief follow the remaining active pieces.
export async function refreshAffaireIntakeFromActiveDocuments(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireAccessProject;
  uploadId: string;
  actorUserId: string;
  readDrive?: boolean;
  reuseBriefForConfirmation?: boolean;
}) {
  const { data, error } = await resolveSupabaseQuery<{
    data: unknown[];
    error: unknown;
  }>(
    readAllRows(() => getAffaireIntakeSelectTable(input.supabase, "affaire_intake_documents")
      .select(DOCUMENT_SELECT as never, { count: "exact" })
      .eq("project_id", input.project.id).is("deleted_at", null).is("deletion_token", null)
      .order("created_at", { ascending: true }).order("id", { ascending: true }))
  );

  if (error) {
    throw internalError("Impossible de recharger les documents intake.", error);
  }

  const documents = (data ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);

  await refreshAffaireBriefFromDocuments({
    supabase: input.supabase,
    project: input.project,
    uploadId: input.uploadId,
    documents,
    actorUserId: input.actorUserId,
    readDrive: input.readDrive,
    reuseBriefForConfirmation: input.reuseBriefForConfirmation,
  });
}
