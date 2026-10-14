import { z } from "zod";

import { sameEstimateBatchTimestamp } from "@/lib/estimates/batch-preparation";
import { ApiError, conflict } from "@/lib/estimates/errors";

const uuid = z.string().uuid().transform((value) => value.toLowerCase());
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const cents = z.number().int().nonnegative().refine(Number.isSafeInteger);
export const generatedOuvrageReviewTokenSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const generatedOuvrageAcceptedCandidateSchema = z.object({
  candidateId: uuid,
  designation: z.string().trim().min(1).max(500).transform((value) => value.replace(/\s+/g, " ")),
  unit: z.string().trim().max(64).nullable().optional().transform((value) => value || null),
  quantity: z.number().finite().nonnegative().nullable().optional().transform((value) => value ?? null),
  lotId: uuid.nullable().optional().transform((value) => value ?? null),
  reviewToken: generatedOuvrageReviewTokenSchema,
}).strict();
export type GeneratedOuvrageAcceptedCandidate = z.infer<typeof generatedOuvrageAcceptedCandidateSchema>;
const versionSchema = z.object({ id: uuid, updatedAt: timestamp }).strict();
export const generatedOuvrageCommitResultSchema = z.object({
  ok: z.literal(true), insertedCount: z.number().int().min(1).max(12),
  draftStatus: z.enum(["partially_applied", "applied"]), projectId: uuid, versionId: uuid,
  applications: z.array(z.object({ candidateId: uuid, subdetailId: uuid, assemblyId: uuid,
    estimateItemId: uuid, applicationId: uuid, snapshotId: uuid }).strict()).min(1).max(12),
  version: versionSchema,
  totals: z.object({ totalHtCents: cents, totalTaxCents: cents, totalTtcCents: cents }).strict()
    .refine((value) => value.totalHtCents + value.totalTaxCents === value.totalTtcCents),
  receipt: z.object({ operationKey: uuid, actorId: uuid, versionId: uuid, draftId: uuid,
    expectedUpdatedAt: timestamp, acceptedCandidates: z.array(generatedOuvrageAcceptedCandidateSchema).min(1).max(12),
    committedAt: timestamp }).strict(),
  replayed: z.boolean(),
  currentVersion: versionSchema.extend({ status: z.enum(["draft", "sending", "sent", "accepted", "archived"]) }).strict(),
}).strict();
export type GeneratedOuvrageCommitResult = z.infer<typeof generatedOuvrageCommitResultSchema>;
const abandonedResultSchema = z.object({
  ok: z.literal(true), outcome: z.literal("abandoned"),
  receipt: z.object({ operationKey: uuid, actorId: uuid, versionId: uuid, draftId: uuid,
    expectedUpdatedAt: timestamp, acceptedCandidates: z.array(generatedOuvrageAcceptedCandidateSchema).min(1).max(12),
    abandonedAt: timestamp }).strict(),
  currentVersion: versionSchema.extend({ status: z.enum(["draft", "sending", "sent", "accepted", "archived"]) }).strict(),
}).strict();
export type GeneratedOuvrageAbandonedResult = z.infer<typeof abandonedResultSchema>;
export type GeneratedOuvrageApplicationOutcome = GeneratedOuvrageCommitResult | GeneratedOuvrageAbandonedResult;

export function generatedOuvrageOutcomeUnknown() {
  return new ApiError({ status: 503, code: "GENERATED_OUVRAGE_OUTCOME_UNKNOWN",
    message: "Le résultat de cette opération doit être vérifié. Conservez la même demande avant de réessayer." });
}
export function generatedOuvrageReadUnavailable() {
  return new ApiError({ status: 503, code: "GENERATED_OUVRAGE_READ_UNAVAILABLE",
    message: "Impossible de vérifier le travail enregistré. Réessayez la lecture." });
}
const errors: Record<string, [ApiError["status"], string]> = {
  GENERATED_OUVRAGE_INVALID_INPUT: [400, "La demande d’ouvrage est invalide."],
  GENERATED_OUVRAGE_FORBIDDEN: [403, "Cette opération sur les ouvrages n’est pas autorisée."],
  GENERATED_OUVRAGE_NOT_FOUND: [404, "Le travail demandé est introuvable."],
  GENERATED_OUVRAGE_LOCK_REQUIRED: [409, "Un verrou actif de cette page est requis."],
  GENERATED_OUVRAGE_STALE: [409, "Le devis a changé. Rechargez avant de préparer une nouvelle demande."],
  GENERATED_OUVRAGE_REVIEW_CHANGED: [409, "La revue a changé. Rechargez le sous-détail avant de le valider."],
  GENERATED_OUVRAGE_WRITE_REQUIRED: [403, "Votre rôle ne permet pas de modifier les ouvrages."],
  GENERATED_OUVRAGE_CONTEXT_CHANGED: [409, "Les paramètres de calcul ont changé. Rechargez le devis."],
  GENERATED_OUVRAGE_IDEMPOTENCY_CONFLICT: [409, "Cette clé correspond à une autre demande."],
  GENERATED_OUVRAGE_APPLY_REJECTED: [409, "L’application de l’ouvrage a été refusée. Aucun ouvrage n’a été ajouté."],
  GENERATED_OUVRAGE_PROJECTION_MISMATCH: [400, "La projection de l’ouvrage ne correspond pas à sa revue."],
  EST381_DRAFT_DISCARDED: [409, "Ce brouillon a déjà été rejeté."],
  EST381_CANDIDATE_NOT_PENDING: [409, "Ce candidat n’est plus disponible pour modification."],
  EST383_SUBDETAIL_STALE: [409, "Le sous-détail ne correspond plus aux valeurs du candidat. Revalidez sa revue."],
};
export function generatedOuvrageRpcError(error: { code?: string; message?: string }, mutation: boolean) {
  const known = errors[error.message ?? ""];
  if (known && ["22023", "42501", "40001", "55000", "23514", "P0001", "P0002"].includes(error.code ?? "")) {
    return new ApiError({ status: known[0], code: error.message!, message: known[1] });
  }
  if (["40001", "40P01", "55P03"].includes(error.code ?? "")) {
    return conflict("Le travail est en cours de modification. Réessayez la même demande.", undefined, "GENERATED_OUVRAGE_STALE");
  }
  return mutation ? generatedOuvrageOutcomeUnknown() : generatedOuvrageReadUnavailable();
}

export function parseGeneratedOuvrageCommit(value: unknown, scope: {
  versionId: string; operationKey: string; actorId: string;
  draftId?: string; expectedUpdatedAt?: string; acceptedCandidates?: GeneratedOuvrageAcceptedCandidate[];
}) {
  if (Buffer.byteLength(JSON.stringify(value) ?? "", "utf8") > 2 * 1024 * 1024) throw generatedOuvrageOutcomeUnknown();
  const parsed = generatedOuvrageCommitResultSchema.safeParse(value);
  if (!parsed.success) throw generatedOuvrageOutcomeUnknown();
  const result = parsed.data;
  if (result.versionId !== scope.versionId || result.version.id !== scope.versionId ||
    result.currentVersion.id !== scope.versionId || result.receipt.versionId !== scope.versionId ||
    result.receipt.actorId !== scope.actorId || result.receipt.operationKey !== scope.operationKey ||
    (scope.draftId !== undefined && result.receipt.draftId !== scope.draftId) ||
    (scope.expectedUpdatedAt !== undefined && !sameEstimateBatchTimestamp(result.receipt.expectedUpdatedAt, scope.expectedUpdatedAt)) ||
    (scope.acceptedCandidates !== undefined && JSON.stringify(result.receipt.acceptedCandidates) !== JSON.stringify(scope.acceptedCandidates)) ||
    result.insertedCount !== result.applications.length || result.applications.length !== result.receipt.acceptedCandidates.length ||
    result.applications.some((entry, index) => entry.candidateId !== result.receipt.acceptedCandidates[index].candidateId) ||
    result.receipt.acceptedCandidates.some((entry) => entry.quantity === null)) throw generatedOuvrageOutcomeUnknown();
  for (const key of ["candidateId", "subdetailId", "assemblyId", "estimateItemId", "applicationId", "snapshotId"] as const) {
    if (new Set(result.applications.map((entry) => entry[key])).size !== result.applications.length) throw generatedOuvrageOutcomeUnknown();
  }
  return result;
}

export function parseGeneratedOuvrageOutcome(value: unknown, scope: Parameters<typeof parseGeneratedOuvrageCommit>[1]): GeneratedOuvrageApplicationOutcome {
  if (typeof value !== "object" || value === null || !("outcome" in value)) return parseGeneratedOuvrageCommit(value, scope);
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 2 * 1024 * 1024) throw generatedOuvrageOutcomeUnknown();
  const parsed = abandonedResultSchema.safeParse(value);
  if (!parsed.success) throw generatedOuvrageOutcomeUnknown();
  const result = parsed.data;
  if (result.currentVersion.id !== scope.versionId || result.receipt.versionId !== scope.versionId ||
    result.receipt.actorId !== scope.actorId || result.receipt.operationKey !== scope.operationKey ||
    (scope.draftId !== undefined && result.receipt.draftId !== scope.draftId) ||
    (scope.expectedUpdatedAt !== undefined && !sameEstimateBatchTimestamp(result.receipt.expectedUpdatedAt, scope.expectedUpdatedAt)) ||
    (scope.acceptedCandidates !== undefined && JSON.stringify(result.receipt.acceptedCandidates) !== JSON.stringify(scope.acceptedCandidates)) ||
    result.receipt.acceptedCandidates.some((entry) => entry.quantity === null) ||
    new Set(result.receipt.acceptedCandidates.map((entry) => entry.candidateId)).size !== result.receipt.acceptedCandidates.length) {
    throw generatedOuvrageOutcomeUnknown();
  }
  return result;
}
