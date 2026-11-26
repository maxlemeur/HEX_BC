"use server";

import { after } from "next/server";
import { createIntakeAiRunner, readIntakeAiBatch, readIntakeAiOptions, resolveIntakeAiSelection, IntakeAiBudgetStopped } from "@/lib/affaires/intake-ai-server";
import { intakeAiChoiceSchema, type IntakeAiChoice } from "@/lib/affaires/intake-ai-settings";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildIntakeAnalysisFeedback, type IntakeAnalysisAttempt } from "@/lib/affaires/intake-analysis-feedback";
import { ApiError, badRequest, internalError, notFound } from "@/lib/http/api-error";
import { isIntakeDecisionsSelected } from "@/lib/affaires/intake-decisions";
import { readAllRowsInChunks } from "@/lib/supabase/read-all";
import { revalidatePath } from "next/cache";
import { briefPlanSelectionSchema } from "@/lib/takeoff/brief-plan-choice";
import { z } from "zod";
import { deleteIntakeDocumentCopy } from "@/lib/affaires/intake-document-store";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-derived-state-server";
import { syncAffaireIntakeDocumentPriorities } from "@/lib/affaires/intake-document-priorities";

import {
  affaireIntakeDocumentKindSchema,
  normalizeAffaireIntakeTextList,
} from "@/lib/affaires/intake";
import {
  confirmAffaireBrief as confirmAffaireBriefServer,
  readAffaireBriefChoices as readAffaireBriefChoicesServer,
  updateAffaireBrief as updateAffaireBriefServer,
  resolveAffaireBriefPlanGap as resolveAffaireBriefPlanGapServer,
} from "@/lib/affaires/intake-brief-server";
import {
  reclassifyAffaireDocument as reclassifyAffaireDocumentServer,
  setAffaireDocumentAsPrimary as setAffaireDocumentAsPrimaryServer,
} from "@/lib/affaires/intake-document-edits-server";
import {
  processAffaireIntakeAnalysisLaunch,
  retryAffaireDocumentAnalysis as retryAffaireDocumentAnalysisServer,
} from "@/lib/affaires/intake-analysis-server";

const reclassifyAffaireDocumentInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  documentId: z.string().uuid("documentId invalide."),
  category: affaireIntakeDocumentKindSchema,
});
const setAffaireDocumentAsPrimaryInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  documentId: z.string().uuid("documentId invalide."),
});

export type ReclassifyAffaireDocumentInput = z.infer<
  typeof reclassifyAffaireDocumentInputSchema
>;
export type SetAffaireDocumentAsPrimaryInput = z.infer<
  typeof setAffaireDocumentAsPrimaryInputSchema
>;

const updateAffaireBriefInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  summary: z.string().trim().min(1, "Le résumé est requis.").max(900),
  scope: z.array(z.string()).max(12),
  vigilancePoints: z.array(z.string()).max(12),
  assumptions: z.array(z.string()).max(12),
});

export type UpdateAffaireBriefInput = z.infer<
  typeof updateAffaireBriefInputSchema
>;

const confirmAffaireBriefInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  plans: briefPlanSelectionSchema,
  /** The digest of the payer notice the confirmation dialog showed, if it showed one. */
  payerNotice: z.string().regex(/^[0-9a-f]{64}$/, "Mention du forfait invalide.").nullable(),
}).refine((input) => input.plans.length > 0 || input.payerNotice === null, "Aucun forfait pour une confirmation sans analyse.");

export type ConfirmAffaireBriefInput = z.infer<
  typeof confirmAffaireBriefInputSchema
>;

const readAffaireBriefChoicesInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
});

const launchOutcome = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("launched"), batch_id: z.string().uuid(), piece_count: z.number().int().positive() }),
  z.object({ outcome: z.literal("brief_only"), batch_id: z.string().uuid(), piece_count: z.literal(0) }),
  z.object({ outcome: z.literal("already_running"), batch_id: z.string().uuid() }),
  z.object({ outcome: z.literal("nothing_waiting"), batch_id: z.null() }),
]);

export async function readAffaireIntakeAiOptions(projectId: string) {
  const { context } = await requireAffaireAccess(z.uuid().parse(projectId), "write");
  return readIntakeAiOptions(context);
}

async function startIntakeAiBatch(
  service: ReturnType<typeof createServiceRoleClient>,
  owner: { userId: string; tenantId: string },
  projectId: string,
  choice: IntakeAiChoice,
  retry: boolean,
) {
  const requested = intakeAiChoiceSchema.parse(choice);
  if (retry && requested.source === "rules_only" && !isIntakeDecisionsSelected()) {
    throw badRequest("Choisissez une source IA disponible pour relancer l’analyse.");
  }
  const selection = await resolveIntakeAiSelection(owner, requested);
  const { data, error } = await service.rpc("start_affaire_intake_ai_batch", {
    p_project_id: projectId, p_tenant_id: owner.tenantId, p_payer_id: owner.userId,
    p_selection: selection, p_retry: retry,
  });
  if (error) throw internalError("Impossible de réserver les pièces pour l’analyse.", error);
  return data?.[0];
}

export async function launchAffaireIntakeAnalysis(projectId: string, choice: IntakeAiChoice) {
  const { context, project } = await requireAffaireAccess(z.uuid().parse(projectId), "write");
  try {
    const result = launchOutcome.parse(await startIntakeAiBatch(createServiceRoleClient(), context, project.id, choice, false));
    if (result.outcome === "nothing_waiting") return { message: "Aucune pièce n’attend son lancement." };
    if (result.outcome === "already_running") return { message: "Une analyse du dossier est déjà en cours." };
    after(async () => {
      try { await processAffaireIntakeAnalysisLaunch(result.batch_id, null); }
      catch { console.error("La reprise du lancement intake est nécessaire.", { launchId: result.batch_id }); }
    });
    revalidatePath(`/dashboard/affaires/${project.id}`);
    return { message: result.outcome === "brief_only"
      ? "Préparation du brief lancée. Les pièces déjà classées gardent leur classement."
      : "Analyse du dossier lancée." };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { message: error.message };
    throw error;
  }
}

export async function reclassifyAffaireDocument(
  input: ReclassifyAffaireDocumentInput
) {
  const parsed = reclassifyAffaireDocumentInputSchema.parse(input);
  const result = await reclassifyAffaireDocumentServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

export async function readAffaireIntakeRetryStatus(projectId: string, batchId: string) {
  const { context, project } = await requireAffaireAccess(z.uuid().parse(projectId), "write");
  const batch = await readIntakeAiBatch(createServiceRoleClient(), z.uuid().parse(batchId));
  if (!batch || batch.launch_id || batch.project_id !== project.id || batch.payer_id !== context.userId || batch.tenant_id !== context.tenantId) {
    return { finished: true, message: null };
  }
  return { finished: Boolean(batch.finished_at), message: batch.budget_stop_message };
}

export async function retryAffaireDocumentAnalysis(input: {
  projectId: string; documentIds: string[]; choice: IntakeAiChoice;
}) {
  const projectId = z.uuid().parse(input.projectId);
  const documentIds = [...new Set(z.array(z.uuid()).min(1).parse(input.documentIds).map(id => id.toLowerCase()))];
  const { context, project } = await requireAffaireAccess(projectId, "write");
  const service = createServiceRoleClient();
  const { data: matching, error: documentsError } = await readAllRowsInChunks(documentIds, (chunk) =>
    context.supabase.from("affaire_intake_documents").select("id,file_name", { count: "exact" })
      .eq("tenant_id", context.tenantId).eq("project_id", project.id).in("id", chunk)
      .is("deleted_at", null).is("deletion_token", null));
  if (documentsError) throw internalError("Impossible de lire la sélection à relancer.", documentsError);
  const byId = new Map(matching?.map(document => [document.id, document]));
  const documents = documentIds.map(id => {
    const document = byId.get(id);
    if (!document) throw notFound("Une pièce de la sélection n’est plus disponible. Actualisez le dossier.");
    return document;
  });
  let batchId: string;
  try {
    const reservation = await startIntakeAiBatch(service, context, project.id, input.choice, true);
    batchId = z.uuid().parse(reservation?.batch_id);
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { message: error.message, failures: [], analyzedDocumentIds: [], batchId: null };
    throw error;
  }

  const readBatch = async () => {
    const batch = await readIntakeAiBatch(service, batchId);
    if (!batch || batch.launch_id || batch.payer_id !== context.userId || batch.tenant_id !== context.tenantId || batch.project_id !== project.id) {
      throw internalError("Impossible de vérifier le lot de relance.");
    }
    if (batch.budget_stop_message) throw new IntakeAiBudgetStopped(batch.budget_stop_message);
    return createIntakeAiRunner(service, batch, null);
  };
  const ai = await readBatch();
  const deferred: (() => Promise<void>)[] = [];
  const attempts: IntakeAnalysisAttempt[] = [];
  const analyzedDocumentIds: string[] = [];
  let uploadId: string | undefined;
  let remaining: string[] = [];
  let stopped = false;
  let budgetMessage: string | undefined;
  for (const [index, document] of documents.entries()) {
    try {
      const result = await retryAffaireDocumentAnalysisServer({
        projectId, documentId: document.id, ai, readAi: readBatch, defer: (effect) => deferred.push(effect),
      });
      if (result.analyzed) uploadId = result.uploadId;
      analyzedDocumentIds.push(document.id);
      attempts.push({ fileName: document.file_name, succeeded: !result.usedFallback,
        manualPreserved: result.preservedManualClassification,
        ...(result.usedFallback ? { reason: result.failure?.message ?? result.warning ?? "L’analyse IA n’a pas abouti." } : {}),
      });
      stopped = result.usedFallback && result.failure?.scope !== "document";
    } catch (error) {
      if (error instanceof IntakeAiBudgetStopped) budgetMessage = error.message;
      attempts.push({ fileName: document.file_name, succeeded: false, manualPreserved: false,
        reason: error instanceof IntakeAiBudgetStopped || (error instanceof ApiError && error.status < 500)
          ? error.message : "Analyse interrompue. Vous pouvez relancer cette pièce." });
      stopped = true;
    }
    if (stopped) {
      remaining = documents.slice(index + 1).map(item => item.file_name);
      break;
    }
  }
  const hasDeferred = Boolean(deferred.length || (!stopped && uploadId));
  const finish = async () => {
    const { error } = await service.rpc("finish_affaire_intake_ai_retry", { p_batch_id: batchId });
    if (error) console.error("Impossible de clôturer le lot de relance.", { batchId });
  };
  if (hasDeferred) {
    after(async () => {
      // Keep each scheduled reservation's cleanup even when a preceding page
      // exhausts the budget. The recorded stop prevents further dispatch.
      for (const effect of deferred) {
        try { await effect(); }
        catch { console.error("Impossible de clôturer une transcription de la relance.", { batchId }); }
      }
      if (!stopped && uploadId) {
        try {
          await refreshAffaireIntakeFromActiveDocuments({ supabase: service, project, uploadId, actorUserId: context.userId,
            ai: await readBatch(), retry: true });
        } catch (error) {
          if (!(error instanceof IntakeAiBudgetStopped)) console.error("Impossible d’actualiser le brief après la relance.", { batchId });
        }
      }
      await finish();
    });
  } else await finish();
  revalidatePath(`/dashboard/affaires/${project.id}`);
  const report = buildIntakeAnalysisFeedback(attempts, remaining);
  return { ...report, message: budgetMessage ? `${report.message} ${budgetMessage}` : report.message,
    batchId: hasDeferred && !budgetMessage ? batchId : null,
    analyzedDocumentIds };
}

export async function setAffaireDocumentAsPrimary(
  input: SetAffaireDocumentAsPrimaryInput
) {
  const parsed = setAffaireDocumentAsPrimaryInputSchema.parse(input);
  const result = await setAffaireDocumentAsPrimaryServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

export async function deleteAffaireIntakeDocument(input: { projectId: string; documentId: string }) {
  const parsed = setAffaireDocumentAsPrimaryInputSchema.parse(input);
  const access = await requireAffaireAccess(parsed.projectId, "write");
  const syncPriorities = () => syncAffaireIntakeDocumentPriorities({ supabase: access.context.supabase, projectId: parsed.projectId });
  let result: Awaited<ReturnType<typeof deleteIntakeDocumentCopy>>;
  try {
    // Runs before the tombstone, so a retry completes an interrupted refresh and a replay on an
    // existing tombstone changes nothing, keeping later brief edits and confirmation.
    result = await deleteIntakeDocumentCopy(access, parsed.documentId, async ({ uploadId, wasUploaded }) => {
      await syncPriorities();
      // Only an uploaded piece fed the register, the synced plans and the brief. A deletion
      // retires copies without waiting on Drive for the working copies of other linked plans.
      if (wasUploaded) {
        await refreshAffaireIntakeFromActiveDocuments({ supabase: access.context.supabase, project: access.project,
          uploadId, actorUserId: access.context.userId, readDrive: false });
      }
    });
  } catch (error) {
    // The reservation demoted the piece: a released one must not leave its kind without a principal.
    try {
      await syncPriorities();
    } catch (cause) {
      console.error("Intake priority resync after an interrupted deletion failed", { projectId: parsed.projectId, cause });
    }
    throw error;
  }
  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`, "layout");
  return result;
}

export async function resolveAffaireBriefPlanGap(input: { projectId: string; entryIndex: number; expectedUpdatedAt: string }) {
  const parsed = z.object({
    projectId: z.string().uuid(), entryIndex: z.number().int().min(0).max(11),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }).strict().parse(input);
  const result = await resolveAffaireBriefPlanGapServer(parsed);
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);
  return result;
}

export async function updateAffaireBrief(input: UpdateAffaireBriefInput) {
  const parsed = updateAffaireBriefInputSchema.parse({
    ...input,
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
  });
  const result = await updateAffaireBriefServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}

/** The payer notice the brief's confirmation dialog shows, read when it opens; it changes nothing. */
export async function readAffaireBriefChoices(input: { projectId: string }) {
  const parsed = readAffaireBriefChoicesInputSchema.parse(input);
  return readAffaireBriefChoicesServer(parsed);
}

export async function confirmAffaireBrief(input: ConfirmAffaireBriefInput) {
  const parsed = confirmAffaireBriefInputSchema.parse(input);
  const result = await confirmAffaireBriefServer(parsed);

  revalidatePath("/dashboard/affaires");
  revalidatePath(`/dashboard/affaires/${parsed.projectId}`);

  return result;
}
