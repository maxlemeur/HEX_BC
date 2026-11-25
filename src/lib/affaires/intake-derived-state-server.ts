import { intakeCurrentBriefActive, readIntakeBriefState } from "@/lib/affaires/intake-current-brief-server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { IntakePayerAccessLost, requireIntakePayerRight } from "@/lib/affaires/intake-payer-server";
import { readAllRows } from "@/lib/supabase/read-all";
import { internalError, mapSupabaseError } from "@/lib/http/api-response";
import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import * as durableIntake from "@/lib/workflows/affaire-intake-lifecycle";
import { affaireIntakeDocumentKindSchema, buildAffaireIntakeMissingPieces, normalizeAffaireIntakeExtractedMetadata, isAffaireIntakeReanalysisPending } from "@/lib/affaires/intake";
import { requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { syncAffaireRegisterMissingPieces, syncAffairePlanGap, syncAffaireRegisterFromBrief } from "@/lib/affaires/register-sync-server";
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
// An effective deposit can enroll a historical affaire while its edit prepares a prompt.
class IntakeBriefNeedsLaunch extends Error {}

const briefInputsSchema = z.object({
  revision: z.string().min(1),
  brief_updated_at: z.string().nullable(),
  project: z.object({ id: z.string(), name: z.string(), reference: z.string().nullable(), client_name: z.string().nullable(), user_id: z.string() }),
  missing_piece_codes: z.array(z.string()),
  documents: z.array(z.object({
    id: z.string(), file_name: z.string(), document_kind: affaireIntakeDocumentKindSchema, confidence: z.number().nullable(),
    issues: z.array(z.string()), extracted_metadata: z.unknown().transform(normalizeAffaireIntakeExtractedMetadata),
  })),
});

export async function refreshAffaireBriefFromDocuments(input: {
  supabase: AffaireIntakeSupabaseClient;
  project: AffaireAccessProject;
  uploadId: string;
  documents: AffaireIntakeDocumentRow[];
  actorUserId?: string | null;
  claim?: durableIntake.AffaireIntakeClaim;
  briefOnly?: boolean;
  renewLease?: () => Promise<void>;
  aiOwner?: ChatGptOwner | null;
  /** False when the caller must not wait on Drive (a deletion only retires copies). */
  readDrive?: boolean;
  /** A provenance-only confirmation can keep an up-to-date brief after reconciliation. */
  reuseBriefForConfirmation?: boolean;
}) {
  const service = createServiceRoleClient();
  const actor = input.actorUserId ? { userId: input.actorUserId, tenantId: input.project.tenant_id } : null;
  const checkRight = input.renewLease ?? (() => requireIntakePayerRight(actor, input.project.id, service));
  const uploadedDocuments = input.documents.filter(
    (document) => document.upload_status === "uploaded" && document.classification_status !== "awaiting_launch"
  );

  // Before the missing pieces: a Drive plan counts once its métré working copy exists.
  let planSync: Awaited<ReturnType<typeof syncTakeoffPlanSetFromAffaireIntake>> | null = null;
  try {
    if (!input.briefOnly) planSync = await syncTakeoffPlanSetFromAffaireIntake({
      supabase: input.supabase as never,
      project: {
        id: input.project.id,
        tenant_id: input.project.tenant_id,
      },
      documents: input.documents,
      readDriveDocument: input.readDrive === false ? undefined : readLinkedDriveDocument,
      beforeDriveRead: checkRight,
    });
  } catch (error) {
    if (error instanceof durableIntake.AffaireIntakeLeaseUnavailableError || error instanceof IntakePayerAccessLost) throw error;
    console.error("Affaire intake takeoff sync failed", {
      uploadId: input.uploadId,
      projectId: input.project.id,
      error,
    });
  }

  // This single statement is the snapshot for the prompt, the fallback and the CAS.
  const { data, error } = await service.rpc("read_affaire_intake_brief_inputs", { p_project_id: input.project.id });
  if (error) throw internalError("Impossible de lire les entrées du brief.", error);
  const snapshot = briefInputsSchema.parse(data);
  const project = { ...input.project, ...snapshot.project };
  const missingPieces = buildAffaireIntakeMissingPieces([]).filter(piece => snapshot.missing_piece_codes.includes(piece.code));

  // Document edits and historical workers still reconcile the free plan copies
  // and register. On an enrolled affaire only an explicit launch publishes.
  const guardedEdit = !input.claim?.launch && await intakeCurrentBriefActive(service);
  const needsLaunch = async () => guardedEdit && await readIntakeBriefState(project.id, service) !== "legacy";
  const syncGaps = async () => {
    await syncAffaireRegisterMissingPieces({ supabase: input.supabase as never, project, missingPieces, actorUserId: input.actorUserId });
    await syncAffairePlanGap({ projectId: project.id, actorUserId: input.actorUserId });
  };
  if (await needsLaunch()) return syncGaps();

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
      await syncGaps();
      return existing.draft;
    }
  }

  const existing = await fetchAffaireBriefForProject({ supabase: input.supabase, projectId: project.id });
  // Another lot may have published while a historical worker was interrupted.
  // A current receipt lets that worker finish without replacing the newer publication.
  let published = existing?.draft ?? null;
  const current = existing?.brief.generation_metadata.input_revision === snapshot.revision;
  let resume = current && Boolean(input.claim) && !input.claim?.launch;
  if (input.claim?.launch && input.claim.attemptCount > 1 && current && existing?.brief.upload_id === input.uploadId) {
    const receipt = await service.from("affaire_intake_uploads").select("brief_published_revision").eq("id", input.uploadId).single();
    if (receipt.error) throw internalError("Impossible de lire le reçu de publication.", receipt.error);
    resume = receipt.data.brief_published_revision === snapshot.revision;
  }
  if (!resume) {
    // Check at the transport boundary and again before saving a historical edit.
    const mayGenerate = guardedEdit ? async () => {
      await checkRight();
      if (await needsLaunch()) throw new IntakeBriefNeedsLaunch();
    } : checkRight;
    let draft;
    try {
      draft = snapshot.documents.length ? await generateAffaireBriefDraft({
        project, uploadId: input.uploadId, documents: snapshot.documents, missingPieces,
        renewLease: mayGenerate, aiOwner: input.claim ? input.aiOwner : actor,
      }) : null;
      await mayGenerate();
    } catch (error) {
      if (error instanceof IntakeBriefNeedsLaunch) return syncGaps();
      throw error;
    }
    published = await persistAffaireBriefDraft({
      ...input, service, project, draft, existing, expectedRevision: snapshot.revision,
      expectedBriefUpdatedAt: snapshot.brief_updated_at, leaseToken: input.claim?.leaseToken ?? null,
    });
  }
  await syncAffaireRegisterMissingPieces({ supabase: input.supabase as never, project, missingPieces, actorUserId: input.actorUserId });
  if (published) await syncAffaireRegisterFromBrief({ supabase: input.supabase as never, project,
    assumptions: published.assumptions, sources: published.sources, actorUserId: input.actorUserId });
  await syncAffairePlanGap({ projectId: project.id, actorUserId: input.actorUserId });
  return published;
}

async function hasStartedAffaireIntake(supabase: Awaited<ReturnType<typeof requireAffaireAccess>>["context"]["supabase"], projectId: string) {
  const { data, error } = await supabase.from("affaire_intake_uploads").select("id")
    .eq("project_id", projectId).neq("status", "deposited").limit(1);
  if (error) throw mapSupabaseError(error, "Impossible de vérifier les analyses du dossier.");
  return data.length > 0;
}

/** Reconcile system gaps after a plan file has been uploaded or removed. */
export async function reconcileAffairePlanPresence(projectId: string) {
  const { context, project } = await requireAffaireAccess(projectId, "write");
  // Opening the dossier also calls this route. A hand-classified first deposit
  // must not fetch its Drive working copy in the background before the press.
  if (!await hasStartedAffaireIntake(context.supabase, project.id)) return { changed: false };

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
  supabase: Awaited<ReturnType<typeof requireAffaireAccess>>["context"]["supabase"];
  project: AffaireAccessProject;
  uploadId: string;
  actorUserId: string;
  readDrive?: boolean;
  reuseBriefForConfirmation?: boolean;
}) {
  // Further edits to a hand-classified first deposit also stay metadata-only
  // until a member presses. A legacy upload already carries its analysis request.
  if (!await hasStartedAffaireIntake(input.supabase, input.project.id)) return;
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
