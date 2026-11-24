import type { IntakeAnalysisFailure } from "@/lib/affaires/intake-analysis-feedback";
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

async function processClaimedAffaireIntakeUpload(input: {
  supabase: ReturnType<typeof createServiceRoleClient>;
  lifecycleClient: durableIntake.DurableWorkflowRpcClient;
  claim: durableIntake.AffaireIntakeClaim;
}) {
  const { supabase, lifecycleClient, claim } = input;
  const aiOwner = claim.launch || isLocalChatGptEnabled() || getIntakeDecisionsCapability().status === "available"
    ? await resolveChatGptIntakeOwner(supabase, claim) : undefined;
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
  for (const document of documents) {
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
    const { data: processingDocument, error: markProcessingError } = await resolveSupabaseQuery<{
      data: { id: string } | null;
      error: unknown;
    }>(
      supabase
        .from("affaire_intake_documents")
        .update({
          classification_status: "processing",
        } as never)
        .eq(batchKey, upload.id)
        .eq("id", document.id)
        .eq("classification_status", document.classification_status)
        .or("classification_source.is.null,classification_source.neq.manual")
        .is("manually_overridden_at", null)
        .is("deleted_at", null).is("deletion_token", null)
        .select("id" as never).maybeSingle()
    );

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

    try {
      const { linked, bytes } = await readDocumentBytes(document);
      const mimeType =
        document.mime_type ??
        inferAffaireIntakeMimeType(document.file_name) ??
        "application/octet-stream";
      const classification = await classifyAffaireIntakeDocument({
        fileName: document.file_name,
        mimeType,
        bytes,
        beforeProviderCall: renewLease,
        aiOwner,
        existingMetadata: document.extracted_metadata,
        ...(aiOwner ? { decisionsContext: { owner: aiOwner,
          projectId: document.project_id, documentId: document.id,
          sourceVersion: createHash("sha256").update(Buffer.from(bytes)).digest("hex") } } : {}),
      });
      await renewLease();
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
      if (error instanceof durableIntake.AffaireIntakeLeaseUnavailableError) {
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
    return document.upload_status === "uploaded" && !document.deletion_token && (document.storage_path || document.drive_file_id)
      && canTranscribeIntakeDocument(mimeType) ? [{ document, mimeType }] : [];
  }) : [];
  for (const { document, mimeType } of toTranscribe) {
    const checkReading = async () => {
      await renewLease();
      if (!claim.launch) return;
      const { data, error } = await supabase.from("affaire_intake_documents").select("id")
        .eq("id", document.id).eq("analysis_launch_id", claim.uploadId)
        .is("deleted_at", null).is("deletion_token", null).maybeSingle();
      if (error || !data || !(await resolveChatGptIntakeOwner(supabase, claim))) {
        throw new Error("La pièce ou le compte du lancement n’est plus disponible.");
      }
    };
    try {
      await checkReading();
      const { bytes } = await readDocumentBytes(document);
      await transcribeIntakeDocument({ supabase, owner: aiOwner!, mimeType, bytes, renewLease: checkReading,
        sourceSha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
        document: { id: document.id, tenantId: upload.tenant_id, fileName: document.file_name } });
    } catch (transcriptionError) {
      if (transcriptionError instanceof durableIntake.AffaireIntakeLeaseUnavailableError) throw transcriptionError;
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
  if (claim.launch && (refreshedDocsError || projectError)) {
    throw internalError("Impossible de préparer le brief du lancement.", refreshedDocsError ?? projectError);
  }
  const status = claim.launch
    ? deriveAffaireIntakeUploadStatusFromDocuments(refreshedDocuments.filter((doc) => doc.analysis_launch_id === upload.id)
      .map((doc) => ({ uploadStatus: doc.upload_status, classificationStatus: doc.classification_status, documentKind: doc.document_kind })))
    : await updateUploadStatusFromStoredDocuments({ supabase, uploadId: upload.id });
  if (status === "processing") throw new Error("Des pièces du lancement restent à analyser.");

  if (!refreshedDocsError && !projectError) {
    const project = projectData as AffaireAccessProject | null;

    if (project && !project.is_archived) {
      await refreshAffaireBriefFromDocuments({
        supabase,
        project,
        uploadId: upload.id,
        documents: refreshedDocuments,
        launchAttempt: claim.launch ? claim.attemptCount : undefined,
        renewLease,
        aiOwner,
      }).catch((error) => {
        if (claim.launch || error instanceof durableIntake.AffaireIntakeLeaseUnavailableError) throw error;
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

export async function processAffaireIntakeAnalysisLaunch(uploadId: string) {
  const supabase = createServiceRoleClient();
  const client = supabase as unknown as durableIntake.DurableWorkflowRpcClient;
  const claim = await durableIntake.claimAffaireIntakeAnalysisLaunch(client, uploadId);
  if (!claim) return null;
  await runClaim(supabase, client, claim);
  return claim.uploadId;
}

async function runClaim(supabase: ReturnType<typeof createServiceRoleClient>,
  lifecycleClient: durableIntake.DurableWorkflowRpcClient, claim: durableIntake.AffaireIntakeClaim) {
  try {
    return await processClaimedAffaireIntakeUpload({ supabase, lifecycleClient, claim });
  } catch (error) {
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
  const { data, error } = await table().select(DOCUMENT_SELECT)
    .eq("tenant_id", context.tenantId).eq("project_id", project.id).eq("id", input.documentId)
    .is("deleted_at", null).is("deletion_token", null).maybeSingle();
  if (error) throw internalError("Impossible de lire le document à réanalyser.", error);
  const document = normalizeDocumentRow(data);
  if (!document) throw notFound("Document introuvable.");
  const preserveManualClassification = document.classification_source === "manual" || Boolean(document.manually_overridden_at);
  const stale = isAffaireIntakeAnalysisStale({ classificationStatus: document.classification_status, classificationUpdatedAt: document.updated_at, issues: document.issues });
  if (isAffaireIntakeReanalysisPending(document) && !stale) throw conflict("Une analyse de cette pièce est déjà en cours.");
  if (document.upload_status !== "uploaded" || (!["classified", "ambiguous", "failed"].includes(document.classification_status) && !stale)) {
    throw conflict("Cette pièce n’est plus disponible pour une nouvelle analyse. Actualisez le dossier.");
  }
  const { data: lot, error: lotError } = await context.supabase.from("affaire_intake_uploads")
    .select("id,status").eq("tenant_id", context.tenantId).eq("project_id", project.id)
    .eq("id", document.analysis_launch_id ?? document.upload_id).maybeSingle();
  if (lotError || !lot) throw internalError("Impossible de préparer la relance de l’analyse.", lotError);
  if (!(lot.status === "deposited" && preserveManualClassification) && !["ready", "partial_failure", "failed"].includes(lot.status)) {
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
      },
      decisionsContext: { owner: context, projectId: project.id, documentId: document.id, sourceVersion: sourceSha256 },
    });
    // A reanalysis updates a proposal. Confirmation and derived dossier/brief
    // updates stay in the existing explicit manual validation action.
    const { analysisSucceeded, values } = buildAffaireIntakeReanalysisUpdate({
      document, classification, preserveManualClassification, now: new Date().toISOString(),
    });
    const status = values.classification_status;
    const { data: updated, error: updateError } = await fence(table().update({
      ...values,
      size_bytes: bytes.byteLength,
      ...(linked ? { drive_revision: linked.file.version ?? null, drive_modified_time: linked.file.modifiedTime ?? null } : {}),
    })).select("id").maybeSingle();
    if (updateError) throw internalError("Impossible d’enregistrer la nouvelle analyse.", updateError);
    if (!updated) throw conflict("La pièce a changé pendant l’analyse. Le nouveau résultat n’a pas remplacé son classement.");
    proposalSaved = true;
    // Read after the response (minutes per page), only once the proposal is saved: a refused retry spends nothing.
    await scheduleIntakeTranscriptionAfterRetry({ context, document: { id: document.id, fileName: document.file_name }, mimeType, bytes, sourceSha256 });
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
