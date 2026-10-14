import { z } from "zod";

export const sourceReferenceUuidSchema = z.string().uuid().regex(/^[0-9a-f-]{36}$/);
const inputUuidSchema = z.string().uuid().transform((value) => value.toLowerCase());
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const eventRevisionSchema = revisionSchema.min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const reasonSchema = z.string().min(1).refine(
  (value) => value === value.trim() && [...value].length <= 1000,
  "Le motif doit être normalisé et contenir au plus 1000 caractères."
).meta({ maxLength: 1000 });

export const sourceReferenceReviewInputSchema = z.strictObject({
  versionId: inputUuidSchema,
  copyId: inputUuidSchema.optional(),
  cursor: eventRevisionSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  confirmationKey: inputUuidSchema.optional(),
});

const copyIdentity = {
  copyId: sourceReferenceUuidSchema,
  fileName: z.string().refine((value) => value.trim().length > 0),
  createdAt: timestampSchema,
};

export const sourceReferencePendingCopySchema = z.strictObject({
  ...copyIdentity,
  state: z.literal("pending"),
  sha256: z.null(),
  byteSize: z.null(),
  pageCount: z.null(),
  verifiedAt: z.null(),
});

export const sourceReferenceVerifiedCopySchema = z.strictObject({
  ...copyIdentity,
  state: z.literal("verified"),
  sha256: sha256Schema,
  byteSize: z.number().int().min(1).max(52428800),
  pageCount: z.number().int().min(1).max(200),
  verifiedAt: timestampSchema,
});

export const sourceReferenceCopySchema = z.discriminatedUnion("state", [
  sourceReferencePendingCopySchema,
  sourceReferenceVerifiedCopySchema,
]);

export const sourceReferenceActivationSchema = z.strictObject({
  id: sourceReferenceUuidSchema,
  copyId: sourceReferenceUuidSchema,
  revision: eventRevisionSchema,
});

export const sourceReferenceConfirmationRequestSchema = z.strictObject({
  copyId: sourceReferenceUuidSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: sourceReferenceUuidSchema,
  reviewedSha256: sha256Schema,
  reason: reasonSchema,
});

export const sourceReferenceHistoryEntrySchema = z.strictObject({
  id: sourceReferenceUuidSchema,
  copyId: sourceReferenceUuidSchema,
  previousCopyId: sourceReferenceUuidSchema.nullable(),
  revision: eventRevisionSchema,
  reason: reasonSchema,
  actorId: sourceReferenceUuidSchema,
  actorName: z.string().nullable(),
  occurredAt: timestampSchema,
});

export const sourceReferenceConfirmationReceiptSchema = z.strictObject({
  canonicalRequest: sourceReferenceConfirmationRequestSchema.extend({
    actorId: sourceReferenceUuidSchema,
    versionId: sourceReferenceUuidSchema,
  }),
  activation: sourceReferenceActivationSchema,
});

export const sourceReferenceReviewSchema = z.strictObject({
  versionId: sourceReferenceUuidSchema,
  projectId: sourceReferenceUuidSchema,
  revision: revisionSchema,
  activeReference: sourceReferenceVerifiedCopySchema.nullable(),
  selectedCopy: sourceReferenceCopySchema.nullable(),
  history: z.array(sourceReferenceHistoryEntrySchema).max(100),
  nextBeforeRevision: eventRevisionSchema.nullable(),
  confirmationReceipt: sourceReferenceConfirmationReceiptSchema.nullable(),
}).superRefine((review, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (review.revision === 0) {
    if (review.activeReference || review.history.length || review.nextBeforeRevision || review.confirmationReceipt) {
      fail("Une revue initiale ne peut contenir de confirmation.");
    }
  } else if (!review.activeReference) {
    fail("Une revue confirmée doit conserver sa référence active.");
  }
  const eventIds = new Set<string>();
  for (const [index, event] of review.history.entries()) {
    if (eventIds.has(event.id) || event.revision > review.revision || (index > 0 && event.revision >= review.history[index - 1].revision)) {
      fail("L'historique doit être unique et ordonné par révision décroissante.");
    }
    eventIds.add(event.id);
    if ((event.revision === 1) !== (event.previousCopyId === null) || event.previousCopyId === event.copyId) {
      fail("La transition de référence est incohérente.");
    }
  }
  const receipt = review.confirmationReceipt;
  if (receipt && (
    receipt.canonicalRequest.versionId !== review.versionId ||
    receipt.activation.copyId !== receipt.canonicalRequest.copyId ||
    receipt.activation.revision !== receipt.canonicalRequest.expectedRevision + 1 ||
    receipt.activation.revision > review.revision
  )) {
    fail("Le reçu ne correspond pas à cette revue et à sa demande canonique.");
  }
});

export const sourceReferenceReadErrorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "SOURCE_REVIEW_ACCESS_DENIED",
  "SOURCE_REVIEW_INVALID_INPUT",
  "SOURCE_REVIEW_TEMPORARILY_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

export const sourceReferenceReadErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: sourceReferenceReadErrorCodeSchema,
    message: z.string(),
  }),
});

export type SourceReferenceReviewInput = z.input<typeof sourceReferenceReviewInputSchema>;
export type SourceReferenceReview = z.infer<typeof sourceReferenceReviewSchema>;
export type SourceReferenceCopy = z.infer<typeof sourceReferenceCopySchema>;

export const sourceReferencePreparationInputSchema = z.strictObject({
  documentId: inputUuidSchema,
  expectedRevision: revisionSchema,
  preparationKey: inputUuidSchema,
});
export const sourceReferencePreparationResultSchema = z.strictObject({
  versionId: sourceReferenceUuidSchema,
  reviewRevision: revisionSchema,
  copy: sourceReferenceVerifiedCopySchema,
  replayed: z.boolean(),
});
export const sourceReferenceConfirmationInputSchema = z.strictObject({
  copyId: inputUuidSchema,
  expectedRevision: revisionSchema,
  idempotencyKey: inputUuidSchema,
  reviewedSha256: z.string().transform((value) => value.toLowerCase()).pipe(sha256Schema),
  reason: z.string().max(8000).transform((value) => value.trim()).pipe(reasonSchema),
});
export const sourceReferenceConfirmationResultSchema = z.strictObject({
  activation: sourceReferenceActivationSchema,
  currentRevision: eventRevisionSchema,
  currentCopyId: sourceReferenceUuidSchema,
  replayed: z.boolean(),
}).superRefine((value, context) => {
  if (value.activation.revision > value.currentRevision || (!value.replayed && (
    value.activation.revision !== value.currentRevision || value.activation.copyId !== value.currentCopyId
  ))) context.addIssue({ code: "custom", message: "Le résultat de confirmation est incohérent." });
});

export const sourceReferenceErrorCodeSchema = z.enum([
  ...sourceReferenceReadErrorCodeSchema.options,
  "SOURCE_REVIEW_WRITE_FORBIDDEN", "SOURCE_REVIEW_PAYLOAD_TOO_LARGE",
  "SOURCE_REVIEW_INVALID_SOURCE", "SOURCE_REVIEW_PDF_LIMIT_EXCEEDED",
  "SOURCE_REVIEW_STALE", "SOURCE_REVIEW_BUSY", "SOURCE_REVIEW_COPY_NOT_VERIFIED",
  "SOURCE_REVIEW_REFERENCE_UNCHANGED", "SOURCE_REVIEW_IDEMPOTENCY_CONFLICT",
  "SOURCE_REVIEW_SOURCE_UNAVAILABLE", "SOURCE_REVIEW_REVISION_OVERFLOW",
]);
export const sourceReferenceErrorResponseSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({ code: sourceReferenceErrorCodeSchema, message: z.string() }),
});

export const sourceReferenceReservationSchema = z.strictObject({
  copy_id: sourceReferenceUuidSchema,
  version_id: sourceReferenceUuidSchema,
  review_revision: revisionSchema,
  state: z.enum(["pending", "verified"]),
  replayed: z.boolean(),
  source_locator: z.strictObject({ bucket: z.literal("affaire-intake"), path: z.string().min(1).max(2048) }),
  destination_locator: z.strictObject({ bucket: z.literal("estimate-source-references"), path: z.string().min(1).max(2048) }),
});
export const sourceReferenceAttestationSchema = z.strictObject({
  copy_id: sourceReferenceUuidSchema, state: z.literal("verified"), sha256: sha256Schema,
  byte_size: z.number().int().min(1).max(52428800), page_count: z.number().int().min(1).max(200),
  verified_at: timestampSchema, replayed: z.boolean(),
});

export type SourceReferencePreparationInput = z.input<typeof sourceReferencePreparationInputSchema>;
export type SourceReferencePreparationResult = z.infer<typeof sourceReferencePreparationResultSchema>;
export type SourceReferenceConfirmationInput = z.input<typeof sourceReferenceConfirmationInputSchema>;
export type SourceReferenceConfirmationResult = z.infer<typeof sourceReferenceConfirmationResultSchema>;
