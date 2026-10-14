import { z } from "zod";

import {
  affaireRegisterEntryKindSchema,
  affaireRegisterEntryStatusSchema,
  affaireRegisterScopeTypeSchema,
} from "@/lib/affaires/register";

const uuid = z.string().uuid().regex(/^[0-9a-f-]{36}$/);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: true });
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const text = (max: number) => z.string().min(1).refine(
  (value) => value === value.trim() && [...value].length <= max,
  `Le texte doit être normalisé et contenir au plus ${max} caractères.`
).meta({ maxLength: max });
const reason = text(1000);
const componentId = text(200);

export const coverageTreatmentSchema = z.enum([
  "unresolved", "priced", "included", "excluded", "other_lot", "provisional",
]);
export const coverageCompletenessSchema = z.enum(["partial", "complete"]);
export const coverageValiditySchema = z.enum(["unreviewed", "current", "needs_review"]);
export const coverageScopeSchema = z.strictObject({
  mode: z.enum(["unspecified", "specified", "whole_project"]),
  zoneId: uuid.nullable(),
  networkId: uuid.nullable(),
  dpgfLotId: uuid.nullable(),
}).superRefine((scope, context) => {
  const hasDimension = scope.zoneId !== null || scope.networkId !== null;
  if ((scope.mode === "specified") !== hasDimension) {
    context.addIssue({ code: "custom", message: "Le mode de périmètre ne correspond pas aux zones et réseaux choisis." });
  }
});

export const coverageDimensionPayloadSchema = z.strictObject({
  kind: z.enum(["zone", "network"]), label: text(200), extentNote: text(2000).nullable(),
});
export const coverageDimensionSchema = coverageDimensionPayloadSchema.extend({
  id: uuid, revision: revision.min(1), extentRevision: revision, archived: z.boolean(),
});
export const coverageCitationInputSchema = z.strictObject({
  id: uuid, copyId: uuid, page: z.number().int().min(1).max(200),
  folio: text(100).nullable(), excerpt: text(4000),
});
export const coverageCitationSchema = coverageCitationInputSchema.extend({
  verification: z.strictObject({ actorId: uuid, occurredAt: timestamp, sha256 }).nullable(),
  canOpen: z.boolean(),
});

const linkBase = { id: uuid, justification: reason };
export const coverageLinkSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...linkBase, kind: z.literal("line"), itemId: uuid }),
  z.strictObject({ ...linkBase, kind: z.literal("component"), itemId: uuid,
    applicationId: uuid, snapshotId: uuid, componentId }),
  z.strictObject({ ...linkBase, kind: z.literal("register"), registerEntryId: uuid }),
]);

export const coverageRequirementPayloadSchema = z.strictObject({
  prescription: text(4000), expectedService: text(4000), scope: coverageScopeSchema,
  completeness: coverageCompletenessSchema, completenessReason: reason.nullable(),
  citations: z.array(coverageCitationInputSchema).max(20),
  links: z.array(coverageLinkSchema).max(100),
}).superRefine((value, context) => {
  if (value.completeness === "complete" && !value.completenessReason) {
    context.addIssue({ code: "custom", message: "Expliquez pourquoi toute la prestation est traitée." });
  }
  for (const [field, values] of [["citations", value.citations], ["links", value.links]] as const) {
    if (new Set(values.map((entry) => entry.id)).size !== values.length) {
      context.addIssue({ code: "custom", path: [field], message: "Les identités doivent être distinctes." });
    }
  }
});

export const coverageDimensionMutationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("create"), dimensionId: uuid, expectedRevision: z.literal(0), operationKey: uuid, payload: coverageDimensionPayloadSchema }),
  z.strictObject({ operation: z.literal("update"), dimensionId: uuid, expectedRevision: revision.min(1), operationKey: uuid, payload: coverageDimensionPayloadSchema }),
  z.strictObject({ operation: z.literal("archive"), dimensionId: uuid, expectedRevision: revision.min(1), operationKey: uuid, reason }),
]);
const requirementMutationBase = {
  requirementId: uuid, expectedReferenceRevision: revision.min(1), operationKey: uuid,
};
export const coverageRequirementMutationSchema = z.discriminatedUnion("operation", [
  z.strictObject({ ...requirementMutationBase, operation: z.literal("create"), expectedRevision: z.literal(0), payload: coverageRequirementPayloadSchema }),
  z.strictObject({ ...requirementMutationBase, operation: z.literal("update"), expectedRevision: revision.min(1), payload: coverageRequirementPayloadSchema }),
  z.strictObject({ ...requirementMutationBase, operation: z.literal("archive"), expectedRevision: revision.min(1), reason }),
  z.strictObject({ ...requirementMutationBase, operation: z.literal("reopen"), expectedRevision: revision.min(1), reason }),
]);
export const coverageCitationVerificationSchema = z.strictObject({
  requirementId: uuid, citationId: uuid, expectedRequirementRevision: revision.min(1),
  expectedReferenceRevision: revision.min(1), reviewedSha256: sha256, operationKey: uuid,
});
export const coverageDecisionInputSchema = z.strictObject({
  treatment: coverageTreatmentSchema, reason, otherLot: text(200).nullable(),
  uncertainty: reason.nullable(), completeness: coverageCompletenessSchema,
});
export const coverageDecisionMutationSchema = z.strictObject({
  requirementId: uuid, expectedRequirementRevision: revision.min(1),
  expectedReferenceRevision: revision.min(1), expectedContentRevision: revision,
  reviewedFingerprint: sha256, operationKey: uuid, decision: coverageDecisionInputSchema,
});

const canonicalBase = { versionId: uuid, actorId: uuid };
export const coverageCanonicalRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...canonicalBase, kind: z.literal("dimension"), request: coverageDimensionMutationSchema }),
  z.strictObject({ ...canonicalBase, kind: z.literal("requirement"), request: coverageRequirementMutationSchema }),
  z.strictObject({ ...canonicalBase, kind: z.literal("citation"), request: coverageCitationVerificationSchema }),
  z.strictObject({ ...canonicalBase, kind: z.literal("decision"), request: coverageDecisionMutationSchema }),
]);
export const coverageReceiptSchema = z.strictObject({
  eventId: uuid, entityId: uuid, entityRevision: revision.min(1), canonicalRequest: coverageCanonicalRequestSchema,
});
export const coverageMutationResultSchema = z.strictObject({
  receipt: coverageReceiptSchema, currentRevision: revision.min(1), replayed: z.boolean(),
});

// Facts contain technical evidence only. Financial fields never enter this DTO.
export const coverageLineFactSchema = z.strictObject({
  itemId: uuid, title: z.string(), unit: z.string().nullable(), quantity: z.number().finite().nullable(),
  hours: z.number().finite().nullable(), nature: z.string().nullable(),
  productId: uuid.nullable(), parentId: uuid.nullable(),
});
export const coverageTargetFactSchema = z.discriminatedUnion("kind", [
  coverageLineFactSchema.extend({ kind: z.literal("line") }),
  z.strictObject({ kind: z.literal("component"), itemId: uuid, applicationId: uuid,
    snapshotId: uuid, componentId, title: z.string(), unit: z.string().nullable(),
    quantity: z.number().finite().nullable(), componentType: z.string(), parent: coverageLineFactSchema }),
  z.strictObject({ kind: z.literal("register"), registerEntryId: uuid,
    entryKind: affaireRegisterEntryKindSchema, text: z.string(),
    status: affaireRegisterEntryStatusSchema, scopeType: affaireRegisterScopeTypeSchema,
    scopeId: uuid.nullable(), scopeRef: z.string().nullable(), scopeLabel: z.string().nullable(),
    active: z.boolean(), updatedAt: timestamp }),
]);
export const coverageTargetStateSchema = z.strictObject({
  linkId: uuid, state: z.enum(["available", "missing", "forbidden", "incompatible"]),
  fact: coverageTargetFactSchema.nullable(), reason: z.string().nullable(),
});
export const coverageDecisionFactsSchema = z.strictObject({
  prescription: z.string(), expectedService: z.string(), scope: coverageScopeSchema,
  completeness: coverageCompletenessSchema, completenessReason: z.string().nullable(),
  dimensions: z.array(coverageDimensionSchema).max(2),
  citations: z.array(coverageCitationSchema).max(20),
  links: z.array(coverageLinkSchema).max(100),
  targets: z.array(coverageTargetStateSchema).max(100),
});
export const coverageDecisionSchema = coverageDecisionInputSchema.extend({
  eventId: uuid, requirementRevision: revision.min(1), technicalRevision: revision,
  referenceRevision: revision.min(1), copyId: uuid, sha256,
  actorId: uuid, occurredAt: timestamp, facts: coverageDecisionFactsSchema,
});
export const coverageRequirementSummarySchema = z.strictObject({
  id: uuid, revision: revision.min(1), technicalRevision: revision,
  prescription: z.string(), expectedService: z.string(), scope: coverageScopeSchema,
  completeness: coverageCompletenessSchema, completenessReason: z.string().nullable(),
  archived: z.boolean(), treatment: coverageTreatmentSchema, validity: coverageValiditySchema,
  reasons: z.array(z.string()), lastDecision: coverageDecisionSchema.omit({ facts: true }).nullable(),
});
export const coverageRequirementSchema = coverageRequirementSummarySchema.extend({
  lastDecision: coverageDecisionSchema.nullable(),
  citations: z.array(coverageCitationSchema).max(20), links: z.array(coverageLinkSchema).max(100),
  targets: z.array(coverageTargetStateSchema).max(100),
});
export const coverageEventSchema = z.strictObject({
  id: uuid, sequence: revision.min(1), operation: z.enum([
    "requirement.create", "requirement.update", "requirement.archive", "requirement.reopen",
    "citation.verify", "decision",
  ]), actorId: uuid, occurredAt: timestamp, entityRevision: revision.min(1),
  reason: z.string().nullable(), decision: coverageDecisionSchema.nullable(),
});
export const coverageCountsSchema = z.strictObject({
  total: revision,
  treatments: z.strictObject({ unresolved: revision, priced: revision, included: revision, excluded: revision, other_lot: revision, provisional: revision }),
  validities: z.strictObject({ unreviewed: revision, current: revision, needs_review: revision }),
});
export const coverageWorkspaceSchema = z.strictObject({
  versionId: uuid, projectId: uuid, referenceRevision: revision, activeCopyId: uuid.nullable(),
  canWrite: z.boolean(), readOnlyReason: z.enum(["role", "version", "archived"]).nullable(),
  counts: coverageCountsSchema, dimensions: z.array(coverageDimensionSchema),
  requirements: z.array(coverageRequirementSummarySchema).max(100), nextAfterId: uuid.nullable(),
  selectedRequirement: coverageRequirementSchema.nullable(),
  history: z.array(coverageEventSchema).max(100), nextBeforeEvent: revision.min(1).nullable(),
  receipt: coverageReceiptSchema.nullable(),
}).superRefine((value, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (Object.values(value.counts.treatments).reduce((sum, count) => sum + count, 0) !== value.counts.total ||
      Object.values(value.counts.validities).reduce((sum, count) => sum + count, 0) !== value.counts.total) {
    fail("Les compteurs de traitement et de validité doivent décrire les mêmes exigences actives.");
  }
  if (value.requirements.length > value.counts.total || value.requirements.some((item) => item.archived) ||
      new Set(value.requirements.map((item) => item.id)).size !== value.requirements.length) fail("La page d'exigences actives est incohérente.");
  if ((value.referenceRevision === 0) !== (value.activeCopyId === null)) fail("La référence active ne correspond pas à sa révision.");
  if (value.canWrite !== (value.readOnlyReason === null)) fail("Les droits d'écriture sont incohérents.");
  if (new Set(value.dimensions.map((item) => item.id)).size !== value.dimensions.length) fail("Les dimensions doivent avoir des identités distinctes.");
  for (const item of [...value.requirements, ...(value.selectedRequirement ? [value.selectedRequirement] : [])]) {
    if ((item.validity === "unreviewed") !== (item.lastDecision === null) ||
        (item.lastDecision && item.treatment !== item.lastDecision.treatment) ||
        (!item.lastDecision && item.treatment !== "unresolved")) fail("Le traitement ou la validité ne correspond pas à la décision conservée.");
  }
  if (new Set(value.history.map((event) => event.id)).size !== value.history.length ||
      value.history.some((event, index) => index > 0 && event.sequence >= value.history[index - 1].sequence)) fail("L'historique doit être unique et ordonné.");
});
export const coveragePreviewSchema = z.strictObject({
  requirementId: uuid, requirementRevision: revision.min(1), referenceRevision: revision.min(1),
  contentRevision: revision, technicalRevision: revision, reviewedFingerprint: sha256,
  facts: coverageDecisionFactsSchema, blockingReasons: z.array(z.string()),
  treatmentBlockingReasons: z.strictObject({
    unresolved: z.array(z.string()), priced: z.array(z.string()),
    included: z.array(z.string()), excluded: z.array(z.string()),
    other_lot: z.array(z.string()), provisional: z.array(z.string()),
  }),
});
export const coverageTargetOptionSchema = z.strictObject({
  id: uuid, title: z.string(), kind: z.enum(["line", "component", "register", "section"]),
  fact: coverageTargetFactSchema.nullable(),
  components: z.array(coverageTargetFactSchema).max(100),
});
export const coverageTargetsSchema = z.strictObject({
  items: z.array(coverageTargetOptionSchema).max(100), nextAfterId: uuid.nullable(),
});
export const coverageQuerySchema = z.strictObject({
  requirementId: uuid.optional(), afterId: uuid.optional(), limit: z.number().int().min(1).max(100).default(50),
  beforeEvent: revision.min(1).optional(), operationKey: uuid.optional(),
});
export const coverageTargetsQuerySchema = z.strictObject({
  kind: z.enum(["line", "component", "register", "section"]), search: z.string().max(200).default(""),
  afterId: uuid.optional(), limit: z.number().int().min(1).max(100).default(50),
});

export const coverageErrorCodeSchema = z.enum([
  "UNAUTHORIZED", "SOURCE_COVERAGE_ACCESS_DENIED", "SOURCE_COVERAGE_WRITE_FORBIDDEN",
  "SOURCE_COVERAGE_INVALID_INPUT", "SOURCE_COVERAGE_PAYLOAD_TOO_LARGE", "SOURCE_COVERAGE_STALE",
  "SOURCE_COVERAGE_BUSY", "SOURCE_COVERAGE_IDEMPOTENCY_CONFLICT", "SOURCE_COVERAGE_INCOMPLETE",
  "SOURCE_COVERAGE_INVALID_TARGET", "SOURCE_COVERAGE_CITATION_NOT_VERIFIED",
  "SOURCE_COVERAGE_SOURCE_UNAVAILABLE", "SOURCE_COVERAGE_REVISION_OVERFLOW",
  "SOURCE_COVERAGE_TEMPORARILY_UNAVAILABLE", "INTERNAL_ERROR",
]);
export const coverageErrorResponseSchema = z.strictObject({
  ok: z.literal(false), error: z.strictObject({ code: coverageErrorCodeSchema, message: z.string() }),
});

export type CoverageScope = z.infer<typeof coverageScopeSchema>;
export type CoverageDimension = z.infer<typeof coverageDimensionSchema>;
export type CoverageCitation = z.infer<typeof coverageCitationSchema>;
export type CoverageLink = z.infer<typeof coverageLinkSchema>;
export type CoverageTargetFact = z.infer<typeof coverageTargetFactSchema>;
export type CoverageTargetState = z.infer<typeof coverageTargetStateSchema>;
export type CoverageRequirementPayload = z.infer<typeof coverageRequirementPayloadSchema>;
export type CoverageRequirementSummary = z.infer<typeof coverageRequirementSummarySchema>;
export type CoverageRequirement = z.infer<typeof coverageRequirementSchema>;
export type CoverageWorkspace = z.infer<typeof coverageWorkspaceSchema>;
export type CoveragePreview = z.infer<typeof coveragePreviewSchema>;
export type CoverageTargets = z.infer<typeof coverageTargetsSchema>;
export type CoverageEvent = z.infer<typeof coverageEventSchema>;
export type CoverageReceipt = z.infer<typeof coverageReceiptSchema>;
export type CoverageMutationResult = z.infer<typeof coverageMutationResultSchema>;
export type CoverageDimensionMutation = z.infer<typeof coverageDimensionMutationSchema>;
export type CoverageRequirementMutation = z.infer<typeof coverageRequirementMutationSchema>;
export type CoverageCitationVerification = z.infer<typeof coverageCitationVerificationSchema>;
export type CoverageDecisionMutation = z.infer<typeof coverageDecisionMutationSchema>;
