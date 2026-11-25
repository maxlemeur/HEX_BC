import { readEditableIntakeDocument } from "@/lib/affaires/intake-editable-document-server";
import { LocalChatGptConnectionWithdrawnError } from "@/lib/ai/chatgpt-sign-in-errors";
import type { IntakeAnalysisFailure } from "@/lib/affaires/intake-analysis-feedback";
import { hostCanReadIntakeScans, readLaunchConnection, IntakePayerAccessLost, requireIntakePayerRight } from "@/lib/affaires/intake-payer-server";
import { intakeCurrentBriefActive, readIntakeBriefState } from "@/lib/affaires/intake-current-brief-server";
import type { ChatGptConnection, ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { readAllRows } from "@/lib/supabase/read-all";
import { buildAffaireIntakeReanalysisUpdate } from "@/lib/affaires/intake-reanalysis";
import { createHash } from "node:crypto";
import { badRequest, conflict, internalError, notFound } from "@/lib/http/api-response";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getIntakeDecisionsCapability, getIntakeAnalysisAvailability } from "@/lib/affaires/intake-decisions";
import { isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { resolveChatGptIntakeOwner } from "@/lib/ai/chatgpt-workflow-owner";
import {
  canTranscribeIntakeDocument,
  scheduleIntakeTranscriptionAfterRetry,
  transcribeIntakeDocument,
} from "@/lib/affaires/intake-transcription-server";
import * as durableIntake from "@/lib/workflows/affaire-intake-lifecycle";
import {
  AFFAIRE_INTAKE_BUCKET,
  AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES,
  deriveAffaireIntakeClassificationStatus,
  deriveAffaireIntakeUploadStatusFromDocuments,
  inferAffaireIntakeMimeType,
  isAffaireIntakeAnalysisStale,
  isAffaireIntakeReanalysisPending,
  AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
} from "@/lib/affaires/intake";
import { AFFAIRE_ACCESS_PROJECT_COLUMNS, requireAffaireAccess, type AffaireAccessProject } from "@/lib/affaires/access-server";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { DriveError } from "@/lib/affaires/google-drive/errors";
import {
  type AffaireIntakeDocumentRow,
  DOCUMENT_SELECT,
  resolveSupabaseQuery,
  normalizeDocumentRow,
  addIssue,
  insertAffaireIntakeEvent,
  updateUploadStatusFromStoredDocuments,
} from "@/lib/affaires/intake-rows";
import { syncAffaireIntakeDocumentPriorities } from "@/lib/affaires/intake-document-priorities";
import { classifyAffaireIntakeDocument } from "@/lib/affaires/intake-classification";
import { refreshAffaireBriefFromDocuments } from "@/lib/affaires/intake-derived-state-server";

class IntakeConnectionUnavailable extends Error {}
class HistoricalIntakeNeedsLaunch extends Error {}

async function processClaimedAffaireIntakeUpload(input: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  lifecycleClient: durableIntake.DurableWorkflowRpcClient;
  claim: durableIntake.AffaireIntakeClaim;
  connection?: ChatGptConnection | null;
}) {
  const { supabase, lifecycleClient, claim } = input;
  const payer = claim.launch || isLocalChatGptEnabled() || getIntakeDecisionsCapability().status === "available"
    ? await resolveChatGptIntakeOwner(supabase, claim) : undefined;
  // Null is the explicit choice at an active press without a plan. Keep the
  // payer for Decisions and rights, while ChatGPT never acquires a later grant.
  const aiOwner = input.connection === null ? null : payer && input.connection ? { ...payer, connection: input.connection } : payer;
  const upload = {
    id: claim.uploadId,
    tenant_id: claim.tenantId,
    project_id: claim.projectId,
  };
  const nowIso = new Date().toISOString();
  const renewLease = () =>
    durableIntake.renewAffaireIntakeUploadLease({
      client: lifecycleClient,
      claim,
      now: new Date(),
    });

  const historicalGuard = !claim.launch && await intakeCurrentBriefActive(supabase);
  const checkPayer = async () => {
    try {
      await renewLease();
    } catch (error) {
      // Suspension also prevents renewal. A revoked payer can still stop this launch under its token.
      if (claim.launch) await requireIntakePayerRight(payer ?? null, claim.projectId, supabase);
      throw error;
    }
    if (historicalGuard && await readIntakeBriefState(claim.projectId, supabase) !== "legacy") {
      throw new HistoricalIntakeNeedsLaunch();
    }
    const connectionLost = claim.launch?.readScans && (input.connection === null || (aiOwner && !await hostCanReadIntakeScans(aiOwner)));
    if (claim.launch || aiOwner) await requireIntakePayerRight(payer ?? null, claim.projectId, supabase);
    if (connectionLost) {
      if (input.connection) throw new LocalChatGptConnectionWithdrawnError();
      throw new IntakeConnectionUnavailable();
    }
  };
  await checkPayer();

  const batchKey = claim.launch ? "analysis_launch_id" : "upload_id";
  const { data: docsData, error: docsError } = await readAllRows(() =>
    supabase.from("affaire_intake_documents").select(DOCUMENT_SELECT as never, { count: "exact" })
      .eq(batchKey, upload.id).eq("tenant_id", claim.tenantId).eq("project_id", claim.projectId)
      .is("deleted_at", null).is("deletion_token", null).order("created_at"));

  if (docsError) {
    throw internalError(
      "Impossible de charger les documents du workspace intake.",
      docsError
    );
  }

  const documents = (docsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);

  // A Drive piece is a link: its content is read from Drive for this analysis only.
  const readDocumentBytes = async (document: AffaireIntakeDocumentRow) => {
    const linked = document.storage_path ? null : await readLinkedDriveDocument(document);
    if (linked) return { linked, bytes: new Uint8Array(linked.bytes).buffer as ArrayBuffer };
    const { data: blob, error: downloadError } = await supabase.storage
      .from(AFFAIRE_INTAKE_BUCKET)
      .download(document.storage_path!);

    if (downloadError || !blob) {
      throw downloadError ?? new Error("Missing blob from storage.");
    }

    return { linked, bytes: await blob.arrayBuffer() };
  };
  // Only the source download is recoverable per piece. Losing the payer, the lease
  // or the write of the failure still interrupts the launch.
  const readLaunchSource = async (document: AffaireIntakeDocumentRow) => {
    try {
      return await readDocumentBytes(document);
    } catch (cause) {
      await checkPayer();
      const reason = cause instanceof DriveError ? `Lecture de la source Google Drive impossible : ${cause.message}`
        : "La source de cette pièce est illisible. Vérifiez son accès puis relancez l’analyse de la pièce.";
      const completedAt = new Date().toISOString();
      const { data, error } = await supabase.from("affaire_intake_documents")
        .update({ classification_status: "failed", issues: [reason], analysis_completed_at: completedAt })
        .eq("id", document.id).eq("analysis_launch_id", claim.uploadId).is("analysis_completed_at", null)
        .is("deleted_at", null).is("deletion_token", null).is("manually_overridden_at", null)
        .or("classification_source.is.null,classification_source.neq.manual")
        .select("id").maybeSingle();
      if (error) throw internalError("Impossible d’enregistrer l’échec de lecture de la pièce.", error);
      if (data) {
        document.analysis_completed_at = completedAt;
        await insertAffaireIntakeEvent({ supabase, uploadId: claim.uploadId, documentId: document.id,
          eventType: "document.classification_failed", reason });
      }
      return null;
    }
  };
  // A historical worker and an individual retry compete for the document version.
  // The losing worker also skips OCR for that piece, including in a multi-piece lot.
  const skipHistoricalReading = new Set<string>();
  for (const document of documents) {
    if (!claim.launch && isAffaireIntakeReanalysisPending(document)) {
      skipHistoricalReading.add(document.id);
      continue;
    }
    if (document.upload_status !== "uploaded") {
      continue;
    }

    if (
      document.classification_source === "manual" || document.manually_overridden_at
    ) {
      continue;
    }

    if (
      document.classification_status !== "queued" &&
      (claim.launch || document.classification_status !== "failed")
    ) {
      continue;
    }

    await renewLease();
    const processing = supabase.from("affaire_intake_documents").update({ classification_status: "processing" })
      .eq(batchKey, upload.id).eq("id", document.id).eq("classification_status", document.classification_status)
      .or("classification_source.is.null,classification_source.neq.manual").is("manually_overridden_at", null)
      .is("deleted_at", null).is("deletion_token", null);
    if (!claim.launch) {
      processing.eq("updated_at", document.updated_at).not("issues", "cs", `{"${AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE}"}`);
    }
    const { data: processingDocument, error: markProcessingError } = await processing.select("id").maybeSingle();
    if (!claim.launch && !processingDocument) skipHistoricalReading.add(document.id);

    if (markProcessingError) {
      console.error("Failed to mark intake document as processing", {
        documentId: document.id,
        error: markProcessingError,
      });
      continue;
    }
    if (!processingDocument) continue;

    if (!document.storage_path && !document.drive_file_id) {
      await renewLease();
      const { error: markFailedError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents")
          .update({
            classification_status: "failed",
            issues: ["Chemin storage manquant pour le document intake."],
          } as never)
          .eq(batchKey, upload.id)
          .eq("id", document.id).eq("classification_status", "processing")
          .is("deleted_at", null).is("deletion_token", null)
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

    const launchSource = claim.launch ? await readLaunchSource(document) : null;
    if (claim.launch && !launchSource) continue;
    try {
      const { linked, bytes } = launchSource ?? await readDocumentBytes(document);
      const mimeType =
        document.mime_type ??
        inferAffaireIntakeMimeType(document.file_name) ??
        "application/octet-stream";
      const classification = await classifyAffaireIntakeDocument({
        fileName: document.file_name,
        mimeType,
        bytes,
        beforeProviderCall: checkPayer,
        readScans: claim.launch?.readScans,
        aiOwner,
        existingMetadata: document.extracted_metadata,
        ...(payer ? { decisionsContext: { owner: payer,
          projectId: document.project_id, documentId: document.id,
          sourceVersion: createHash("sha256").update(Buffer.from(bytes)).digest("hex") } } : {}),
      });
      await checkPayer();
      const classificationStatus = deriveAffaireIntakeClassificationStatus({
        documentKind: classification.result.documentKind,
        confidence: classification.result.confidence,
      });

      const { error: updateDocumentError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents")
          .update({
            classification_status: classificationStatus,
            document_kind: classification.result.documentKind,
            confidence: classification.result.confidence,
            issues: classification.result.issues,
            extracted_metadata: classification.result.extractedMetadata,
            classification_source: classification.source,
            classified_at: nowIso,
            ...(claim.launch && (!claim.launch.readScans || !canTranscribeIntakeDocument(mimeType))
              ? { analysis_completed_at: nowIso } : {}),
            ...(linked ? {
              drive_revision: linked.file.version ?? null,
              drive_modified_time: linked.file.modifiedTime ?? null,
              size_bytes: bytes.byteLength,
            } : {}),
          } as never)
          .eq(batchKey, upload.id)
          .eq("id", document.id)
          .eq("classification_status", "processing")
          .is("deleted_at", null).is("deletion_token", null)
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
      if (error instanceof durableIntake.AffaireIntakeLeaseUnavailableError || error instanceof IntakePayerAccessLost || error instanceof IntakeConnectionUnavailable || error instanceof HistoricalIntakeNeedsLaunch ||
          (input.connection && error instanceof LocalChatGptConnectionWithdrawnError)) {
        throw error;
      }
      await renewLease();

      console.error("Affaire intake document processing failed", {
        uploadId: upload.id,
        documentId: document.id,
        error,
      });

      const { error: markFailedError } = await resolveSupabaseQuery<{
        error: unknown;
      }>(
        supabase
          .from("affaire_intake_documents")
          .update({
            classification_status: "failed",
            issues: [error instanceof DriveError
              ? `Lecture Google Drive impossible : ${error.message}`
              : "Impossible d'analyser le document dans le workspace intake."],
          } as never)
          .eq(batchKey, upload.id)
          .eq("id", document.id)
          .eq("classification_status", "processing")
          .is("deleted_at", null).is("deletion_token", null)
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

  // On recovery, terminal classifications stay in place. Readings deduplicate by content.
  const toTranscribe = aiOwner && (claim.launch?.readScans ?? true) && isLocalChatGptEnabled() ? documents.flatMap((document) => {
    const mimeType = document.mime_type ?? inferAffaireIntakeMimeType(document.file_name) ?? "";
    return !skipHistoricalReading.has(document.id) && document.upload_status === "uploaded" && !document.analysis_completed_at && !document.deletion_token && (document.storage_path || document.drive_file_id)
      && canTranscribeIntakeDocument(mimeType) ? [{ document, mimeType }] : [];
  }) : [];
  const markComplete = async (ids: string[]) => {
    if (!claim.launch || !ids.length) return;
    await checkPayer();
    const { error } = await supabase.from("affaire_intake_documents").update({ analysis_completed_at: new Date().toISOString() })
      .eq("analysis_launch_id", claim.uploadId).in("id", ids).is("analysis_completed_at", null)
      .is("deleted_at", null).is("deletion_token", null).in("classification_status", ["classified", "ambiguous", "failed"]);
    if (error) throw internalError("Impossible d’enregistrer la fin de la lecture.", error);
  };
  const readingIds = new Set(toTranscribe.map(({ document }) => document.id));
  const remaining = documents.filter(doc => !doc.analysis_completed_at && !readingIds.has(doc.id));
  // PostgREST encodes the ID filter in the URL. Bound each write even on a large dossier.
  for (let offset = 0; offset < remaining.length; offset += 100) {
    await markComplete(remaining.slice(offset, offset + 100).map(doc => doc.id));
  }
  for (const { document, mimeType } of toTranscribe) {
    const checkReading = async () => {
      if (!claim.launch) {
        const current = await supabase.from("affaire_intake_documents").select("issues")
          .eq("id", document.id).eq("upload_id", claim.uploadId).is("deleted_at", null).is("deletion_token", null).maybeSingle();
        if (current.error) throw current.error;
        if (!current.data || isAffaireIntakeReanalysisPending(current.data)) throw new Error("Lecture réservée à la relance individuelle.");
        return checkPayer();
      }
      const { data, error } = await supabase.from("affaire_intake_documents").select("id")
        .eq("id", document.id).eq("analysis_launch_id", claim.uploadId)
        .is("deleted_at", null).is("deletion_token", null).maybeSingle();
      if (error || !data) {
        throw new Error("La pièce du lancement n’est plus disponible.");
      }
      await checkPayer();
    };
    try {
      await checkReading();
      const source = claim.launch ? await readLaunchSource(document) : await readDocumentBytes(document);
      if (!source) continue;
      const { bytes } = source;
      await transcribeIntakeDocument({ supabase, owner: aiOwner!, mimeType, bytes, renewLease: checkReading,
        sourceSha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
        document: { id: document.id, tenantId: upload.tenant_id, fileName: document.file_name } });
      await markComplete([document.id]);
    } catch (transcriptionError) {
      if (claim.launch || transcriptionError instanceof HistoricalIntakeNeedsLaunch || transcriptionError instanceof durableIntake.AffaireIntakeLeaseUnavailableError) throw transcriptionError;
      console.error("Affaire intake transcription could not be recorded", { documentId: document.id });
    }
  }

  await renewLease();
  await syncAffaireIntakeDocumentPriorities({
    supabase,
    projectId: upload.project_id,
  });

  const [{ data: refreshedDocsData, error: refreshedDocsError }, { data: projectData, error: projectError }] =
    await Promise.all([
      readAllRows(() => supabase.from("affaire_intake_documents")
        .select(DOCUMENT_SELECT as never, { count: "exact" })
        .eq("project_id", upload.project_id).is("deleted_at", null).is("deletion_token", null)
        .order("created_at", { ascending: true }).order("id", { ascending: true })),
      resolveSupabaseQuery<{
        data: unknown;
        error: unknown;
      }>(
        supabase
          .from("estimate_projects")
          .select(AFFAIRE_ACCESS_PROJECT_COLUMNS)
          .eq("id", upload.project_id)
          .maybeSingle()
      ),
    ]);

  const refreshedDocuments = (refreshedDocsData ?? [])
    .map(normalizeDocumentRow)
    .filter((row): row is AffaireIntakeDocumentRow => row !== null);
  if (refreshedDocsError || projectError) {
    throw internalError("Impossible de préparer le brief du lancement.", refreshedDocsError ?? projectError);
  }
  const launchDocuments = refreshedDocuments.filter(doc => doc.analysis_launch_id === upload.id);
  const status = claim.launch && !launchDocuments.length ? "ready" : claim.launch
    ? deriveAffaireIntakeUploadStatusFromDocuments(launchDocuments
      .map((doc) => ({ uploadStatus: doc.upload_status, classificationStatus: doc.classification_status, documentKind: doc.document_kind })))
    : await updateUploadStatusFromStoredDocuments({ supabase, uploadId: upload.id });
  if (status === "processing") throw new Error("Des pièces du lancement restent à analyser.");

  const project = projectData as AffaireAccessProject | null;
  if (!project || project.is_archived) throw new Error("Cette affaire n’est plus disponible.");
  await refreshAffaireBriefFromDocuments({
    supabase, project, uploadId: upload.id, documents: refreshedDocuments,
    claim, renewLease: checkPayer, aiOwner, briefOnly: Boolean(claim.launch) && !documents.length,
  });
  await checkPayer();
  await durableIntake.finishAffaireIntakeUploadAttempt({
    client: lifecycleClient,
    claim,
    status,
    now: new Date(),
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

export async function processAffaireIntakeUpload(uploadId: string) {
  const supabase = createServiceRoleClient();
  const lifecycleClient = supabase as unknown as durableIntake.DurableWorkflowRpcClient;
  const claimResult = await durableIntake.claimAffaireIntakeUpload({ client: lifecycleClient, uploadId, now: new Date() });

  if (!claimResult.claimed) {
    if (claimResult.reason === "not_found") {
      throw notFound("Upload intake introuvable.");
    }
    return claimResult.status ?? "failed";
  }

  return runClaim(supabase, lifecycleClient, claimResult.claim);
}

export async function processAffaireIntakeAnalysisLaunch(uploadId: string, readingOwner: ChatGptOwner | null) {
  const supabase = createServiceRoleClient();
  const active = await intakeCurrentBriefActive(supabase);
  const recorded = readingOwner ? await readLaunchConnection(uploadId, supabase) : null;
  const connection = recorded ?? (active ? null : undefined);
  if (readingOwner && (connection === null || !await hostCanReadIntakeScans({ ...readingOwner, connection }))) {
    // Leave the launch available to another host with the authorized profile.
    // SQL only stops it after the recovery window and never takes a live lease.
    if (active || recorded) {
      const { error } = await supabase.rpc("stop_affaire_intake_analysis", { p_upload_id: uploadId, p_lease_token: null });
      if (error) throw internalError("Impossible de vérifier le délai de reprise du lancement.", error);
    }
    return null;
  }
  const client = supabase as unknown as durableIntake.DurableWorkflowRpcClient;
  const claim = await durableIntake.claimAffaireIntakeAnalysisLaunch(client, uploadId);
  if (!claim) return null;
  await runClaim(supabase, client, claim, connection);
  return claim.uploadId;
}

async function runClaim(supabase: ReturnType<typeof createServiceRoleClient>,
  lifecycleClient: durableIntake.DurableWorkflowRpcClient, claim: durableIntake.AffaireIntakeClaim, connection?: ChatGptConnection | null) {
  try {
    return await processClaimedAffaireIntakeUpload({ supabase, lifecycleClient, claim, connection });
  } catch (error) {
    // Leave the lease to expire. A capable host can resume; otherwise the
    // due-time sweep stops it without consuming another reading attempt.
    if (error instanceof IntakeConnectionUnavailable || (connection && error instanceof LocalChatGptConnectionWithdrawnError)) return null;
    if (error instanceof HistoricalIntakeNeedsLaunch) {
      await durableIntake.finishAffaireIntakeUploadAttempt({ client: lifecycleClient, claim, status: "failed",
        lastError: "Cette affaire attend un lancement explicite. Classez ou relancez les pièces interrompues.", now: new Date() });
      return "failed" as const;
    }
    if (claim.launch && error instanceof IntakePayerAccessLost) {
      const stopped = await supabase.rpc("stop_affaire_intake_analysis", { p_upload_id: claim.uploadId, p_lease_token: claim.leaseToken });
      if (stopped.error) throw new Error("Impossible de terminer le lancement interrompu.", { cause: stopped.error });
      if (stopped.data) return "failed" as const;
    }
    await durableIntake.releaseAffaireIntakeUploadAfterError({
      client: lifecycleClient,
      claim,
      now: new Date(),
      error,
    });
    throw error;
  }
}

class IntakeDocumentReadError extends Error {}

/** A manual retry owns one document, never rearms its shared import lot.
 * updated_at fences every outcome; an interrupted reservation can only be
 * reclaimed explicitly after ten minutes, using the new caller's own account.
 */
export async function retryAffaireDocumentAnalysis(input: { projectId: string; documentId: string }) {
  const { context, project } = await requireAffaireAccess(input.projectId, "write");
  const availability = await getIntakeAnalysisAvailability(context);
  if (!availability.available) throw badRequest(availability.message);
  const table = () => context.supabase.from("affaire_intake_documents");
  const document = await readEditableIntakeDocument(context, project.id, input.documentId);
  const preserveManualClassification = document.classification_source === "manual" || Boolean(document.manually_overridden_at);
  const stale = isAffaireIntakeAnalysisStale({ classificationStatus: document.classification_status, classificationUpdatedAt: document.updated_at, issues: document.issues });
  if (isAffaireIntakeReanalysisPending(document) && !stale) throw conflict("Une analyse de cette pièce est déjà en cours.");
  if (document.upload_status !== "uploaded" || (!["classified", "ambiguous", "failed"].includes(document.classification_status) && !stale)) {
    throw conflict("Cette pièce n’est plus disponible pour une nouvelle analyse. Actualisez le dossier.");
  }
  const readLot = () => context.supabase.from("affaire_intake_uploads")
    .select("id,status").eq("tenant_id", context.tenantId).eq("project_id", project.id)
    .eq("id", document.analysis_launch_id ?? document.upload_id).maybeSingle();
  const { data: lot, error: lotError } = await readLot();
  const allowsRetry = (status: string) => (status === "deposited" && preserveManualClassification) ||
    ["ready", "partial_failure", "failed"].includes(status);
  if (lotError || !lot) throw internalError("Impossible de préparer la relance de l’analyse.", lotError);
  if (!allowsRetry(lot.status)) {
    throw conflict("Une analyse de ce lot est déjà en cours. Réessayez après sa fin.");
  }
  // A lease marker leaves the validated classification and plan generation unchanged.
  const editable = () => table().update({ issues: [AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
    ...document.issues.filter(issue => issue !== AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE)].slice(0, 10) })
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", document.id)
    .eq("upload_status", "uploaded").eq("classification_status", document.classification_status)
    .eq("updated_at", document.updated_at).is("deleted_at", null).is("deletion_token", null);
  const { data: reserved, error: reserveError } = await editable().select("updated_at").maybeSingle();
  if (reserveError) throw internalError("Impossible de réserver cette pièce.", reserveError);
  if (!reserved) throw conflict("La pièce a changé. Actualisez le dossier.");
  const fence = (query: ReturnType<ReturnType<typeof table>["update"]>) => query
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", document.id)
    .eq("classification_status", document.classification_status).eq("updated_at", reserved.updated_at)
    .is("deleted_at", null).is("deletion_token", null);
  // Conversely, a historical worker may have claimed this lot before the document reservation.
  // Once both checks pass, any later worker sees the reservation before it can send a page.
  if (!document.analysis_launch_id) {
    const current = await readLot();
    if (current.error || !current.data || !allowsRetry(current.data.status)) {
      const released = await fence(table().update({ issues: document.issues.filter(issue => issue !== AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE) }));
      if (released.error || current.error) throw internalError("Impossible de préparer la relance de l’analyse.", released.error ?? current.error);
      throw conflict("Une analyse de ce lot est déjà en cours. Réessayez après sa fin.");
    }
  }
  let proposalSaved = false;
  try {
    let linked: Awaited<ReturnType<typeof readLinkedDriveDocument>> | null = null;
    let bytes: ArrayBuffer;
    try {
      linked = document.storage_path ? null : await readLinkedDriveDocument(document);
      if (linked) bytes = new Uint8Array(linked.bytes).buffer;
      else {
        const { data: blob, error: downloadError } = await context.supabase.storage.from(AFFAIRE_INTAKE_BUCKET).download(document.storage_path!);
        if (downloadError || !blob) throw new IntakeDocumentReadError("Le fichier ne peut pas être lu. Vérifiez sa disponibilité ou ajoutez-le à nouveau.");
        bytes = await blob.arrayBuffer();
      }
      if (!bytes.byteLength) throw new IntakeDocumentReadError("Le fichier est vide. Ajoutez une copie contenant les données du document.");
      if (bytes.byteLength > AFFAIRE_INTAKE_MAX_FILE_SIZE_BYTES) throw new IntakeDocumentReadError("Le fichier dépasse la limite de 50 Mo par pièce.");
    } catch (cause) {
      throw cause instanceof IntakeDocumentReadError ? cause : new IntakeDocumentReadError("Le fichier ne peut pas être lu depuis sa source. Vérifiez sa disponibilité et, pour Drive, sa connexion.");
    }
    const mimeType = document.mime_type ?? inferAffaireIntakeMimeType(document.file_name) ?? "application/octet-stream";
    const sourceSha256 = createHash("sha256").update(Buffer.from(bytes)).digest("hex");
    const classification = await classifyAffaireIntakeDocument({ fileName: document.file_name, mimeType, bytes, aiOwner: context,
      existingMetadata: document.extracted_metadata,
      beforeProviderCall: async () => {
        const { data: current, error: currentError } = await table().select("id").eq("id", document.id)
          .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("updated_at", reserved.updated_at)
          .eq("classification_status", document.classification_status).is("deleted_at", null).is("deletion_token", null).maybeSingle();
        if (currentError || !current) throw conflict("La pièce a changé avant l’analyse. Actualisez le dossier.");
        await requireIntakePayerRight(context, project.id);
      },
      decisionsContext: { owner: context, projectId: project.id, documentId: document.id, sourceVersion: sourceSha256 },
    });
    // A reanalysis updates a proposal. Confirmation and derived dossier/brief
    // updates stay in the existing explicit manual validation action.
    const { analysisSucceeded, values } = buildAffaireIntakeReanalysisUpdate({
      document, classification, preserveManualClassification, now: new Date().toISOString(),
    });
    const status = values.classification_status;
    const mayRead = isLocalChatGptEnabled() && canTranscribeIntakeDocument(mimeType);
    const { data: updated, error: updateError } = await fence(table().update({
      ...values,
      issues: mayRead ? [AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE, ...values.issues] : values.issues,
      size_bytes: bytes.byteLength,
      ...(linked ? { drive_revision: linked.file.version ?? null, drive_modified_time: linked.file.modifiedTime ?? null } : {}),
    })).select("updated_at").maybeSingle();
    if (updateError) throw internalError("Impossible d’enregistrer la nouvelle analyse.", updateError);
    if (!updated) throw conflict("La pièce a changé pendant l’analyse. Le nouveau résultat n’a pas remplacé son classement.");
    proposalSaved = true;
    // Read after the response (minutes per page), only once the proposal is saved: a refused retry spends nothing.
    if (mayRead) await scheduleIntakeTranscriptionAfterRetry({
      context, projectId: project.id, document: { id: document.id, fileName: document.file_name }, mimeType, bytes, sourceSha256,
      reservation: { updatedAt: updated.updated_at, finalIssues: values.issues },
    });
    await insertAffaireIntakeEvent({ supabase: context.supabase, uploadId: lot.id, documentId: document.id,
      actorUserId: context.userId, eventType: "document.classified", reason: "Analyse relancée manuellement.",
      beforePayload: { document_kind: document.document_kind, classification_status: document.classification_status },
      afterPayload: { document_kind: preserveManualClassification ? document.document_kind : classification.result.documentKind,
        classification_status: status, classification_source: preserveManualClassification ? document.classification_source : classification.source,
        confidence: preserveManualClassification ? document.confidence : classification.result.confidence,
        proposed_document_kind: classification.result.documentKind, analysis_source: analysisSucceeded ? "ai" : "heuristic",
        preserved_manual_classification: preserveManualClassification } });
    return { analyzed: true, usedFallback: !analysisSucceeded, preservedManualClassification: preserveManualClassification,
      failure: classification.analysisFailure,
      warning: classification.analysisFailure?.message ?? classification.result.issues.find((issue) => issue.startsWith("Analyse IA :")) ?? null };
  } catch (cause) {
    if (proposalSaved) throw internalError("La nouvelle proposition est enregistrée, mais son historique est incomplet. Vérifiez puis validez la catégorie pour poursuivre.", cause);
    // Does not release another request's reservation or overwrite a manual choice.
    const documentFailure: IntakeAnalysisFailure | undefined = cause instanceof IntakeDocumentReadError
      ? { code: "DOCUMENT_UNREADABLE", message: cause.message, scope: "document" } : undefined;
    const { data: released, error: releaseError } = await fence(table().update({ classification_status: preserveManualClassification
      ? (document.document_kind === "a_classer" ? "ambiguous" : "classified") : "failed",
      issues: addIssue(document.issues.filter(issue => issue !== AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE), documentFailure?.message ?? "Analyse interrompue. Vous pouvez relancer cette pièce.") })).select("id").maybeSingle();
    if (releaseError) throw internalError("Impossible d’enregistrer l’échec de l’analyse. Actualisez le dossier.", releaseError);
    if (!released) throw conflict("La pièce a changé pendant l’analyse. Actualisez le dossier.");
    if (documentFailure) return { analyzed: false, usedFallback: true, preservedManualClassification: preserveManualClassification,
      failure: documentFailure, warning: documentFailure.message };
    throw cause;
  }
}
