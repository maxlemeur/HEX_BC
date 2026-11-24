import { readAllRows } from "@/lib/supabase/read-all";
import { badRequest, conflict, internalError, notFound } from "@/lib/http/api-response";
import {
  deriveAffaireIntakeClassificationStatus,
  isAffaireIntakePrimaryEligibleKind,
  isAffaireIntakeAnalysisStale,
  AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE,
  type AffaireIntakeDocumentKind,
} from "@/lib/affaires/intake";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import {
  type AffaireIntakeDocumentRow,
  DOCUMENT_SELECT,
  resolveSupabaseQuery,
  normalizeDocumentRow,
  addIssue,
  insertAffaireIntakeEvent,
} from "@/lib/affaires/intake-rows";
import { syncAffaireIntakeDocumentPriorities } from "@/lib/affaires/intake-document-priorities";
import { refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-derived-state-server";

export async function reclassifyAffaireDocument(input: {
  projectId: string;
  documentId: string;
  category: AffaireIntakeDocumentKind;
}) {
  const { context, project } = await requireAffaireAccess(input.projectId, "write");

  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents")
      .select(DOCUMENT_SELECT as never)
      .eq("id", input.documentId)
      .is("deleted_at", null).is("deletion_token", null)
      .eq("project_id", project.id)
      .maybeSingle()
  );

  if (error) {
    throw internalError(
      "Impossible de charger le document intake à reclasser.",
      error
    );
  }

  const document = normalizeDocumentRow(data);

  if (!document) {
    throw notFound("Document intake introuvable.");
  }

  const staleAnalysis = isAffaireIntakeAnalysisStale({ classificationStatus: document.classification_status, classificationUpdatedAt: document.updated_at });
  if (document.upload_status !== "uploaded" || document.classification_status === "queued" || (document.classification_status === "processing" && !staleAnalysis)) {
    throw conflict("Ce document n’est pas encore disponible pour le classement. Actualisez le dossier.");
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

  const previousIssues = document.issues.filter(issue => issue !== AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE);
  const confirmsExistingClassification =
    input.category === document.document_kind &&
    document.classification_status === "classified" &&
    classificationStatus === "classified" &&
    document.classified_at !== null &&
    previousIssues.length === document.issues.length;
  const manuallyOverriddenAt = new Date().toISOString();
  const nextIssues =
    input.category === "a_classer"
      ? addIssue(previousIssues, "Document remis manuellement dans la file à classer.")
      : previousIssues;

  const { data: updatedDocument, error: updateError } = await resolveSupabaseQuery<{
    data: { id: string } | null;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents")
      .update({
        document_kind: input.category,
        ...(input.category !== document.document_kind ? { document_priority: "secondary" } : {}),
        classification_status: classificationStatus,
        confidence: input.category === "a_classer" ? 0.4 : 1,
        issues: nextIssues,
        classification_source: "manual",
        classified_by: context.userId,
        // A human confirmation keeps the source generation used by plan copies.
        // Its own author and timestamp are recorded independently below and in the audit event.
        classified_at: confirmsExistingClassification ? document.classified_at : manuallyOverriddenAt,
        manually_overridden_at: manuallyOverriddenAt,
      } as never)
      .eq("id", document.id)
      .eq("tenant_id", context.tenantId)
      .eq("project_id", project.id)
      .eq("upload_status", "uploaded")
      .in("classification_status", ["awaiting_launch", "classified", "ambiguous", "failed", "processing"])
      .eq("updated_at", document.updated_at)
      .is("deleted_at", null).is("deletion_token", null)
      .select("id" as never).maybeSingle()
  );

  if (updateError) {
    throw internalError(
      "Impossible de reclasser le document intake.",
      updateError
    );
  }
  if (!updatedDocument) throw conflict("Le document a changé ou n’est plus disponible. Actualisez le dossier.");

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

  // A category entered before the launch is metadata. Refreshing the derived
  // dossier would download linked plans and send its inventory to the model.
  if (document.classification_status === "awaiting_launch") return { ok: true } as const;

  await refreshAffaireIntakeFromActiveDocuments({
    supabase: context.supabase,
    project,
    uploadId: document.upload_id,
    actorUserId: context.userId,
    reuseBriefForConfirmation: confirmsExistingClassification,
  });

  return { ok: true } as const;
}

export async function setAffaireDocumentAsPrimary(input: {
  projectId: string;
  documentId: string;
}) {
  const { context, project } = await requireAffaireAccess(input.projectId, "write");

  const { data, error } = await resolveSupabaseQuery<{
    data: unknown;
    error: unknown;
  }>(
    context.supabase
      .from("affaire_intake_documents")
      .select(DOCUMENT_SELECT as never)
      .eq("id", input.documentId)
      .is("deleted_at", null).is("deletion_token", null)
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
      "Seuls les documents DPGF et CCTP peuvent être définis comme principaux."
    );
  }

  const { data: kindDocumentsData, error: kindDocumentsError } =
    await resolveSupabaseQuery<{
      data: unknown[];
      error: unknown;
    }>(
      readAllRows(() => context.supabase
        .from("affaire_intake_documents")
        .select(DOCUMENT_SELECT as never, { count: "exact" })
        .eq("project_id", project.id)
        .eq("document_kind", document.document_kind)
        .order("created_at", { ascending: true }))
    );

  if (kindDocumentsError) {
    throw internalError(
      "Impossible de charger les documents intake de cette catégorie.",
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
        .from("affaire_intake_documents")
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
        .from("affaire_intake_documents")
        .update({
          document_priority: "primary",
        } as never)
        .eq("id", document.id)
    );

    if (promoteError) {
      throw internalError(
        "Impossible de définir ce document comme principal.",
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
