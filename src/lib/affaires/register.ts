import { z } from "zod";

export const affaireRegisterEntryKindSchema = z.enum([
  "assumption",
  "missing_piece",
]);
export const affaireRegisterEntrySeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);
export const affaireRegisterEntryStatusSchema = z.enum([
  "open",
  "validated",
  "rejected",
  "clarify_with_client",
]);
export const affaireRegisterEntryOriginKindSchema = z.enum([
  "ai",
  "manual",
  "system",
]);
export const affaireRegisterEventTypeSchema = z.enum([
  "created",
  "synced",
  "status_changed",
  "follow_up_updated",
  "clarify_with_client_requested",
  "continued_with_hypothesis",
  "revalidation_requested",
  "deactivated",
  "reactivated",
]);
export const affaireRegisterScopeTypeSchema = z.enum([
  "project",
  "lot",
  "line",
  "exception",
]);
export const affaireRegisterRevalidationCauseSchema = z.enum([
  "addendum_received",
  "late_critical_piece",
  "document_replaced",
  "manual_reopen",
]);
export const affaireRegisterRevalidationImpactedStageSchema = z.enum([
  "document_review",
  "brief_review",
  "plans_replay",
  "exceptions_review",
  "submission_readiness",
]);
export const affaireRegisterBusinessImpactSchema = z.enum([
  "affects_hub_readiness",
  "blocks_submission",
  "affects_structure_generation",
  "affects_takeoff",
  "requires_client_answer",
]);
export const affaireRegisterReviewExportSectionSchema = z.enum([
  "hypothesis",
  "exclusion",
  "missing_piece",
  "clarification",
  "revalidation",
]);

export type AffaireRegisterEntryKind = z.infer<
  typeof affaireRegisterEntryKindSchema
>;
export type AffaireRegisterEntrySeverity = z.infer<
  typeof affaireRegisterEntrySeveritySchema
>;
export type AffaireRegisterEntryStatus = z.infer<
  typeof affaireRegisterEntryStatusSchema
>;
export type AffaireRegisterEntryOriginKind = z.infer<
  typeof affaireRegisterEntryOriginKindSchema
>;
export type AffaireRegisterEventType = z.infer<
  typeof affaireRegisterEventTypeSchema
>;
export type AffaireRegisterScopeType = z.infer<
  typeof affaireRegisterScopeTypeSchema
>;
export type AffaireRegisterRevalidationCause = z.infer<
  typeof affaireRegisterRevalidationCauseSchema
>;
export type AffaireRegisterRevalidationImpactedStage = z.infer<
  typeof affaireRegisterRevalidationImpactedStageSchema
>;
export type AffaireRegisterBusinessImpact = z.infer<
  typeof affaireRegisterBusinessImpactSchema
>;
export type AffaireRegisterReviewExportSection = z.infer<
  typeof affaireRegisterReviewExportSectionSchema
>;

export const AFFAIRE_REGISTER_KIND_LABELS: Record<
  AffaireRegisterEntryKind,
  string
> = {
  assumption: "Hypothese",
  missing_piece: "Piece manquante",
};

export const AFFAIRE_REGISTER_SEVERITY_LABELS: Record<
  AffaireRegisterEntrySeverity,
  string
> = {
  info: "Information",
  warning: "Attention",
  critical: "Critique",
};

export const AFFAIRE_REGISTER_STATUS_LABELS: Record<
  AffaireRegisterEntryStatus,
  string
> = {
  open: "Ouverte",
  validated: "Validee",
  rejected: "Rejetee",
  clarify_with_client: "A clarifier avec client",
};

export const AFFAIRE_REGISTER_ORIGIN_LABELS: Record<
  AffaireRegisterEntryOriginKind,
  string
> = {
  ai: "IA",
  manual: "Manuelle",
  system: "Systeme",
};
export const AFFAIRE_REGISTER_EVENT_LABELS: Record<
  AffaireRegisterEventType,
  string
> = {
  created: "Entree creee",
  synced: "Resynchronisee",
  status_changed: "Statut modifie",
  follow_up_updated: "Pilotage metier mis a jour",
  clarify_with_client_requested: "Clarification client demandee",
  continued_with_hypothesis: "Continuation acceptee sous hypothese",
  revalidation_requested: "Revalidation demandee",
  deactivated: "Entree archivee",
  reactivated: "Entree reactivee",
};

export const AFFAIRE_REGISTER_SCOPE_LABELS: Record<
  AffaireRegisterScopeType,
  string
> = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  exception: "Exception",
};
export const AFFAIRE_REGISTER_REVALIDATION_CAUSE_LABELS: Record<
  AffaireRegisterRevalidationCause,
  string
> = {
  addendum_received: "Additif recu",
  late_critical_piece: "Piece critique recue tardivement",
  document_replaced: "Document remplace",
  manual_reopen: "Reouverture manuelle",
};
export const AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS: Record<
  AffaireRegisterRevalidationImpactedStage,
  string
> = {
  document_review: "Revue documentaire",
  brief_review: "Revue du brief",
  plans_replay: "Relance plans",
  exceptions_review: "Revue des exceptions",
  submission_readiness: "Readiness pre-remise",
};
export const AFFAIRE_REGISTER_BUSINESS_IMPACT_LABELS: Record<
  AffaireRegisterBusinessImpact,
  string
> = {
  affects_hub_readiness: "Impacte la readiness hub",
  blocks_submission: "Bloque la pre-remise",
  affects_structure_generation: "Impacte la structure du devis",
  affects_takeoff: "Impacte les plans et le metre",
  requires_client_answer: "Necessite une reponse client",
};
export const AFFAIRE_REGISTER_REVIEW_EXPORT_SECTION_LABELS: Record<
  AffaireRegisterReviewExportSection,
  string
> = {
  hypothesis: "Hypotheses",
  exclusion: "Exclusions",
  missing_piece: "Pieces manquantes",
  clarification: "Clarifications client",
  revalidation: "Revalidations",
};
export const AFFAIRE_REGISTER_REVIEW_EXPORT_SECTION_DESCRIPTIONS: Record<
  AffaireRegisterReviewExportSection,
  string
> = {
  hypothesis: "Hypotheses ouvertes ou acceptees sous reserve pour poursuivre l'etude.",
  exclusion:
    "Points explicitement ecartes du perimetre et a rendre visibles avant remise.",
  missing_piece: "Pieces manquantes encore ouvertes a rendre visibles avant remise.",
  clarification: "Points qui attendent explicitement un retour client.",
  revalidation: "Points deja resolus puis rouverts apres additif ou piece tardive.",
};

export const AFFAIRE_REGISTER_STATUS_QUERY_PARAM = "registerStatus";
export const AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM = "registerSeverity";
export const AFFAIRE_REGISTER_KIND_QUERY_PARAM = "registerKind";
export const AFFAIRE_REGISTER_CURSOR_QUERY_PARAM = "registerCursor";
export const AFFAIRE_REGISTER_FOCUS_QUERY_PARAM = "registerFocus";
export const AFFAIRE_REGISTER_REVALIDATION_QUERY_PARAM = "registerRevalidation";

const affaireRegisterCursorSchema = z.object({
  updatedAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
});

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

export type AffaireRegisterCursor = z.infer<typeof affaireRegisterCursorSchema>;

export type AffaireRegisterEntry = {
  id: string;
  kind: AffaireRegisterEntryKind;
  code: string | null;
  text: string;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  originKind: AffaireRegisterEntryOriginKind;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  updatedBy: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  businessImpact?: AffaireRegisterBusinessImpact[];
  location?: AffaireRegisterBusinessLocation;
  severityDecision?: AffaireRegisterSeverityDecision | null;
  followUp?: AffaireRegisterFollowUp | null;
  clientClarificationRequest?: AffaireRegisterClientClarificationRequest | null;
  continuationDecision?: AffaireRegisterContinuationDecision | null;
  revalidationRequest?: AffaireRegisterRevalidationRequest | null;
  history: AffaireRegisterTimelineEvent[];
};

export type AffaireRegisterBusinessLocation = {
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
};

const affaireRegisterBusinessLocationSchema = z
  .object({
    scopeType: affaireRegisterScopeTypeSchema,
    scopeId: z.string().uuid().nullable(),
    scopeRef: z.string().trim().max(120).nullable(),
    scopeLabel: z.string().trim().min(1).max(180),
    versionId: z.string().uuid().nullable(),
    sourceDocumentId: z.string().uuid().nullable(),
    sourceFileName: z.string().trim().min(1).max(255).nullable(),
  })
  .strict();

export type AffaireRegisterTimelineEvent = {
  id: string;
  entryId: string;
  eventType: AffaireRegisterEventType;
  entryKind: AffaireRegisterEntryKind;
  entryText: string;
  scopeLabel: string;
  actorUserId: string | null;
  actorUserName: string | null;
  comment: string | null;
  beforeStatus: AffaireRegisterEntryStatus | null;
  afterStatus: AffaireRegisterEntryStatus | null;
  createdAt: string;
};

export type AffaireRegisterPageResult = {
  items: AffaireRegisterEntry[];
  nextCursor: string | null;
  summary: AffaireRegisterSummary;
  timeline: AffaireRegisterTimelineEvent[];
  filters: {
    status: AffaireRegisterEntryStatus | null;
    severity: AffaireRegisterEntrySeverity | null;
    kind: AffaireRegisterEntryKind | null;
    revalidationRequired: boolean;
    cursor: string | null;
    focusEntryId: string | null;
  };
};

export type AffaireRegisterScopeOption = {
  id: string;
  label: string;
};

export type AffaireRegisterScopeOptions = {
  lots: AffaireRegisterScopeOption[];
  lines: AffaireRegisterScopeOption[];
};

export type AffaireRegisterSummary = {
  openQuestionsCount: number;
  criticalOpenCount: number;
  nonCriticalOpenCount: number;
  clarifyWithClientCount: number;
  criticalClarifyWithClientCount?: number;
  clarifyWithClientFocusEntryId?: string | null;
  openAssumptionCount: number;
  openMissingPieceCount: number;
  continuedWithHypothesisCount?: number;
  continuedCriticalMissingPieceCount?: number;
  revalidationRequired?: boolean;
  revalidationRequiredCount?: number;
  criticalRevalidationRequiredCount?: number;
  revalidationBlocksSubmission?: boolean;
  revalidationBlocksEstimation?: boolean;
  revalidationImpactedStages?: AffaireRegisterRevalidationImpactedStage[];
};

export const affaireRegisterSeverityDecisionSchema = z
  .object({
    mode: z.enum(["canonical", "manual"]),
    canonicalSeverity: affaireRegisterEntrySeveritySchema,
    overriddenSeverity: affaireRegisterEntrySeveritySchema.nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    updatedByUserId: z.string().uuid().nullable(),
    comment: z.string().trim().min(1).max(320).nullable().optional(),
  })
  .strict();

export type AffaireRegisterSeverityDecision = z.infer<
  typeof affaireRegisterSeverityDecisionSchema
>;

export const affaireRegisterFollowUpSchema = z
  .object({
    ownerUserId: z.string().uuid().nullable(),
    ownerName: z.string().trim().min(1).max(180).nullable(),
    dueDate: z.string().date().nullable(),
    updatedAt: z.string().datetime({ offset: true }),
    updatedByUserId: z.string().uuid().nullable(),
    comment: z.string().trim().min(1).max(320).nullable().optional(),
  })
  .strict();

export type AffaireRegisterFollowUp = z.infer<
  typeof affaireRegisterFollowUpSchema
>;

export type AffaireRegisterOwnerOption = {
  userId: string;
  label: string;
  role: "admin" | "director" | "engineer";
};

export type AffaireRegisterReviewExportRow = {
  entryId: string;
  section: AffaireRegisterReviewExportSection;
  sectionLabel: string;
  kind: AffaireRegisterEntryKind;
  kindLabel: string;
  severity: AffaireRegisterEntrySeverity;
  severityLabel: string;
  status: AffaireRegisterEntryStatus;
  statusLabel: string;
  text: string;
  scopeLabel: string;
  sourceLabel: string | null;
  ownerName: string | null;
  dueDate: string | null;
  businessImpacts: AffaireRegisterBusinessImpact[];
  businessImpactLabels: string[];
  rationale: string | null;
  location: AffaireRegisterBusinessLocation | null;
};

export type AffaireRegisterReviewExportGroup = {
  key: AffaireRegisterReviewExportSection;
  title: string;
  description: string;
  count: number;
  rows: AffaireRegisterReviewExportRow[];
};

export type AffaireRegisterReviewExport = {
  generatedAt: string;
  projectId: string;
  projectLabel: string;
  projectReference: string | null;
  clientName: string | null;
  versionId: string | null;
  capabilities: {
    explicitExclusions: "not_supported" | "supported";
    supportedEntryKinds: AffaireRegisterEntryKind[];
  };
  summary: {
    rowCount: number;
    criticalCount: number;
    blockingCount: number;
    clarificationCount: number;
    revalidationCount: number;
    hypothesisCount: number;
    exclusionCount: number;
    missingPieceCount: number;
  };
  groups: AffaireRegisterReviewExportGroup[];
  reviewNote: string;
  csvFilename: string;
  csvContent: string;
};

export const affaireRegisterClientClarificationRequestSchema = z
  .object({
    status: z.literal("clarify_with_client"),
    requestedAt: z.string().datetime({ offset: true }),
    requestedByUserId: z.string().uuid().nullable(),
    previousStatus: affaireRegisterEntryStatusSchema,
    comment: z.string().trim().min(1).max(320).nullable().optional(),
  })
  .strict();

export type AffaireRegisterClientClarificationRequest = z.infer<
  typeof affaireRegisterClientClarificationRequestSchema
>;

export const affaireRegisterContinuationDecisionSchema = z
  .object({
    status: z.literal("accepted_with_hypothesis"),
    hypothesisEntryId: z.string().uuid().nullable(),
    hypothesisText: z.string().trim().min(1).max(320).nullable(),
    acceptedAt: z.string().datetime({ offset: true }),
    acceptedByUserId: z.string().uuid().nullable(),
    comment: z.string().trim().min(1).max(320).nullable().optional(),
  })
  .strict();

export type AffaireRegisterContinuationDecision = z.infer<
  typeof affaireRegisterContinuationDecisionSchema
>;

export const affaireRegisterRevalidationRequestSchema = z
  .object({
    status: z.literal("required"),
    requestedAt: z.string().datetime({ offset: true }),
    requestedByUserId: z.string().uuid().nullable(),
    previousStatus: affaireRegisterEntryStatusSchema,
    cause: affaireRegisterRevalidationCauseSchema,
    triggerDocumentId: z.string().uuid().nullable().optional(),
    triggerFileName: z.string().trim().min(1).max(255).nullable().optional(),
    impactedStages: z
      .array(affaireRegisterRevalidationImpactedStageSchema)
      .min(1)
      .max(5),
    comment: z.string().trim().min(1).max(320).nullable().optional(),
  })
  .strict();

export type AffaireRegisterRevalidationRequest = z.infer<
  typeof affaireRegisterRevalidationRequestSchema
>;

function encodeBase64(binary: string) {
  return btoa(binary);
}

function decodeBase64(value: string) {
  return atob(value);
}

function bytesToBinary(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return binary;
}

function binaryToBytes(binary: string) {
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: string) {
  const base64 = encodeBase64(bytesToBinary(UTF8_ENCODER.encode(value)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return UTF8_DECODER.decode(binaryToBytes(decodeBase64(`${normalized}${padding}`)));
}

const affaireRegisterRevalidationSearchParamSchema = z.literal("required");

export function parseAffaireRegisterStatusSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntryStatusSchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterSeveritySearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntrySeveritySchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterKindSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterEntryKindSchema.safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterContinuationDecision(
  metadata: unknown
): AffaireRegisterContinuationDecision | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("continuationDecision" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterContinuationDecisionSchema.safeParse(
    (metadata as Record<string, unknown>).continuationDecision
  );
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterSeverityDecision(
  metadata: unknown
): AffaireRegisterSeverityDecision | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("severityDecision" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterSeverityDecisionSchema.safeParse(
    (metadata as Record<string, unknown>).severityDecision
  );
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterFollowUp(
  metadata: unknown
): AffaireRegisterFollowUp | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("followUp" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterFollowUpSchema.safeParse(
    (metadata as Record<string, unknown>).followUp
  );
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterClientClarificationRequest(
  metadata: unknown
): AffaireRegisterClientClarificationRequest | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("clientClarificationRequest" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterClientClarificationRequestSchema.safeParse(
    (metadata as Record<string, unknown>).clientClarificationRequest
  );
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterRevalidationRequest(
  metadata: unknown
): AffaireRegisterRevalidationRequest | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("revalidationRequest" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterRevalidationRequestSchema.safeParse(
    (metadata as Record<string, unknown>).revalidationRequest
  );
  return parsed.success ? parsed.data : null;
}

export function canAffaireRegisterEntryContinueWithHypothesis(
  entry: Pick<AffaireRegisterEntry, "kind" | "status" | "continuationDecision">
) {
  return (
    entry.kind === "missing_piece" &&
    entry.status === "open" &&
    !entry.continuationDecision
  );
}

export function canAffaireRegisterEntryClarifyWithClient(
  entry: Pick<AffaireRegisterEntry, "status" | "clientClarificationRequest">
) {
  return (
    entry.status === "open" &&
    !entry.clientClarificationRequest
  );
}

export function isAffaireRegisterEntryRevalidationRequired(
  entry: Pick<AffaireRegisterEntry, "status" | "revalidationRequest">
) {
  return (
    entry.revalidationRequest?.status === "required" &&
    (entry.status === "open" || entry.status === "clarify_with_client")
  );
}

export function canAffaireRegisterEntryRequestRevalidation(
  entry: Pick<AffaireRegisterEntry, "status" | "revalidationRequest">
) {
  return (
    isAffaireRegisterEntryResolved(entry.status) &&
    !isAffaireRegisterEntryRevalidationRequired(entry)
  );
}

export function buildAffaireRegisterContinuationHypothesisText(input: {
  entryText: string;
}) {
  const normalized = normalizeAffaireRegisterText(input.entryText, 320).toLowerCase();
  if (!normalized) {
    return "Continuation acceptee sous hypothese documentaire a confirmer avant remise.";
  }

  return `Continuation acceptee sans ${normalized}. Hypothese documentaire a confirmer avant remise.`;
}

export function buildAffaireRegisterBusinessLocation(input: {
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
}): AffaireRegisterBusinessLocation {
  return {
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    scopeRef: input.scopeRef,
    scopeLabel: input.scopeLabel,
    versionId: input.versionId,
    sourceDocumentId: input.sourceDocumentId,
    sourceFileName: input.sourceFileName,
  };
}

export function resolveAffaireRegisterBusinessLocation(input: {
  metadata: unknown;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
}) {
  const persistedLocation = extractAffaireRegisterBusinessLocation(input.metadata);
  const liveLocation = buildAffaireRegisterBusinessLocation({
    scopeType: input.scopeType,
    scopeId: input.scopeId,
    scopeRef: input.scopeRef,
    scopeLabel: input.scopeLabel,
    versionId: input.versionId,
    sourceDocumentId: input.sourceDocumentId,
    sourceFileName: input.sourceFileName,
  });

  return persistedLocation ? { ...persistedLocation, ...liveLocation } : liveLocation;
}

export function extractAffaireRegisterBusinessImpact(
  metadata: unknown
): AffaireRegisterBusinessImpact[] | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("businessImpact" in metadata)
  ) {
    return null;
  }

  const parsed = z
    .array(affaireRegisterBusinessImpactSchema)
    .max(8)
    .safeParse((metadata as Record<string, unknown>).businessImpact);
  return parsed.success ? parsed.data : null;
}

export function extractAffaireRegisterBusinessLocation(
  metadata: unknown
): AffaireRegisterBusinessLocation | null {
  if (
    typeof metadata !== "object" ||
    metadata === null ||
    Array.isArray(metadata) ||
    !("structuredLocation" in metadata)
  ) {
    return null;
  }

  const parsed = affaireRegisterBusinessLocationSchema.safeParse(
    (metadata as Record<string, unknown>).structuredLocation
  );
  return parsed.success ? parsed.data : null;
}

export function buildAffaireRegisterDerivedMetadata(input: {
  metadata: Record<string, unknown>;
  kind: AffaireRegisterEntryKind;
  code: string | null;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  scopeType: AffaireRegisterScopeType;
  scopeId: string | null;
  scopeRef: string | null;
  scopeLabel: string;
  versionId: string | null;
  sourceDocumentId: string | null;
  sourceFileName: string | null;
  clientClarificationRequest?: AffaireRegisterClientClarificationRequest | null;
  continuationDecision?: AffaireRegisterContinuationDecision | null;
  revalidationRequest?: AffaireRegisterRevalidationRequest | null;
}) {
  return {
    ...input.metadata,
    businessImpact: deriveAffaireRegisterBusinessImpact({
      kind: input.kind,
      code: input.code,
      severity: input.severity,
      status: input.status,
      clientClarificationRequest: input.clientClarificationRequest,
      continuationDecision: input.continuationDecision,
      revalidationRequest: input.revalidationRequest,
    }),
    structuredLocation: buildAffaireRegisterBusinessLocation({
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      scopeRef: input.scopeRef,
      scopeLabel: input.scopeLabel,
      versionId: input.versionId,
      sourceDocumentId: input.sourceDocumentId,
      sourceFileName: input.sourceFileName,
    }),
  } satisfies Record<string, unknown>;
}

export function deriveAffaireRegisterBusinessImpact(input: {
  kind: AffaireRegisterEntryKind;
  code: string | null;
  severity: AffaireRegisterEntrySeverity;
  status: AffaireRegisterEntryStatus;
  clientClarificationRequest?: AffaireRegisterClientClarificationRequest | null;
  continuationDecision?: AffaireRegisterContinuationDecision | null;
  revalidationRequest?: AffaireRegisterRevalidationRequest | null;
}) {
  const impacts = new Set<AffaireRegisterBusinessImpact>();
  const unresolved =
    input.status === "open" || input.status === "clarify_with_client";

  if (unresolved) {
    impacts.add("affects_hub_readiness");
  }

  if (input.severity === "critical" && unresolved) {
    impacts.add("blocks_submission");
  }

  if (
    input.kind === "missing_piece" &&
    (input.code === "missing_dpgf" || input.code === "missing_bpu_dqe")
  ) {
    impacts.add("affects_structure_generation");
  }

  if (input.kind === "missing_piece" && input.code === "missing_plans") {
    impacts.add("affects_takeoff");
  }

  if (
    input.status === "clarify_with_client" ||
    input.clientClarificationRequest?.status === "clarify_with_client"
  ) {
    impacts.add("requires_client_answer");
    impacts.add("affects_hub_readiness");
    if (input.severity === "critical") {
      impacts.add("blocks_submission");
    }
  }

  if (isAffaireRegisterEntryRevalidationRequired(input)) {
    impacts.add("affects_hub_readiness");
    impacts.add("blocks_submission");
  }

  if (input.continuationDecision?.status === "accepted_with_hypothesis") {
    impacts.add("affects_hub_readiness");
    if (input.severity === "critical") {
      impacts.add("blocks_submission");
    }
  }

  return [...impacts];
}

export function parseAffaireRegisterCursorSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) {
    return null;
  }

  try {
    const decoded = decodeBase64Url(normalized);
    const parsed = affaireRegisterCursorSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function parseAffaireRegisterFocusSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = z.string().uuid().safeParse(normalized?.trim());
  return parsed.success ? parsed.data : null;
}

export function parseAffaireRegisterRevalidationSearchParam(
  value: string | string[] | undefined
) {
  const normalized = Array.isArray(value) ? value[0] : value;
  const parsed = affaireRegisterRevalidationSearchParamSchema.safeParse(
    normalized?.trim()
  );
  return parsed.success;
}

export function encodeAffaireRegisterCursor(cursor: AffaireRegisterCursor) {
  return encodeBase64Url(JSON.stringify(cursor));
}

export function normalizeAffaireRegisterText(
  value: string,
  maxLength = 320
) {
  return value.trim().replace(/\s+/g, " ").slice(0, maxLength).trim();
}

export function isAffaireRegisterEntryResolved(status: AffaireRegisterEntryStatus) {
  return status === "validated" || status === "rejected";
}

export function buildAffaireRegisterSearchHref(input: {
  pathname: string;
  searchParams: URLSearchParams;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  revalidationRequired?: boolean;
  cursor?: string | null;
  focusEntryId?: string | null;
}) {
  const params = new URLSearchParams(input.searchParams.toString());

  if (input.status) {
    params.set(AFFAIRE_REGISTER_STATUS_QUERY_PARAM, input.status);
  } else {
    params.delete(AFFAIRE_REGISTER_STATUS_QUERY_PARAM);
  }

  if (input.severity) {
    params.set(AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM, input.severity);
  } else {
    params.delete(AFFAIRE_REGISTER_SEVERITY_QUERY_PARAM);
  }

  if (input.kind) {
    params.set(AFFAIRE_REGISTER_KIND_QUERY_PARAM, input.kind);
  } else {
    params.delete(AFFAIRE_REGISTER_KIND_QUERY_PARAM);
  }

  if (input.revalidationRequired) {
    params.set(AFFAIRE_REGISTER_REVALIDATION_QUERY_PARAM, "required");
  } else {
    params.delete(AFFAIRE_REGISTER_REVALIDATION_QUERY_PARAM);
  }

  if (input.cursor) {
    params.set(AFFAIRE_REGISTER_CURSOR_QUERY_PARAM, input.cursor);
  } else {
    params.delete(AFFAIRE_REGISTER_CURSOR_QUERY_PARAM);
  }

  if (input.focusEntryId) {
    params.set(AFFAIRE_REGISTER_FOCUS_QUERY_PARAM, input.focusEntryId);
  } else {
    params.delete(AFFAIRE_REGISTER_FOCUS_QUERY_PARAM);
  }

  const query = params.toString();
  return query ? `${input.pathname}?${query}` : input.pathname;
}

export function buildAffaireRegisterHubHref(input: {
  projectId: string;
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  revalidationRequired?: boolean;
  focusEntryId?: string | null;
}) {
  return buildAffaireRegisterSearchHref({
    pathname: `/dashboard/affaires/${input.projectId}`,
    searchParams: new URLSearchParams(),
    status: input.status ?? null,
    severity: input.severity ?? null,
    kind: input.kind ?? null,
    revalidationRequired: input.revalidationRequired ?? false,
    cursor: null,
    focusEntryId: input.focusEntryId ?? null,
  });
}

function escapeAffaireRegisterCsvCell(value: string) {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;

  if (!/[;"\n\r]/.test(safeValue)) {
    return safeValue;
  }

  return `"${safeValue.replace(/"/g, "\"\"")}"`;
}

function toAffaireRegisterCsvLine(values: string[]) {
  return values.map((value) => escapeAffaireRegisterCsvCell(value)).join(";");
}

function resolveAffaireRegisterReviewExportSection(
  entry: Pick<
    AffaireRegisterEntry,
    "kind" | "status" | "revalidationRequest"
  >
): AffaireRegisterReviewExportSection {
  if (entry.status === "rejected") {
    return "exclusion";
  }

  if (isAffaireRegisterEntryRevalidationRequired(entry)) {
    return "revalidation";
  }

  if (entry.status === "clarify_with_client") {
    return "clarification";
  }

  return entry.kind === "assumption" ? "hypothesis" : "missing_piece";
}

function resolveAffaireRegisterReviewExportRationale(
  entry: Pick<
    AffaireRegisterEntry,
    | "status"
    | "clientClarificationRequest"
    | "revalidationRequest"
    | "continuationDecision"
    | "severityDecision"
    | "followUp"
  >
) {
  if (isAffaireRegisterEntryRevalidationRequired(entry)) {
    const cause = entry.revalidationRequest?.cause
      ? AFFAIRE_REGISTER_REVALIDATION_CAUSE_LABELS[entry.revalidationRequest.cause]
      : null;
    const comment = entry.revalidationRequest?.comment?.trim() || null;
    return [cause, comment].filter(Boolean).join(" - ") || null;
  }

  if (entry.status === "clarify_with_client") {
    return entry.clientClarificationRequest?.comment?.trim() || "Retour client attendu";
  }

  if (entry.continuationDecision?.comment?.trim()) {
    return entry.continuationDecision.comment.trim();
  }

  if (entry.followUp?.comment?.trim()) {
    return entry.followUp.comment.trim();
  }

  if (entry.severityDecision?.comment?.trim()) {
    return entry.severityDecision.comment.trim();
  }

  return null;
}

function compareAffaireRegisterReviewExportRows(
  left: AffaireRegisterReviewExportRow,
  right: AffaireRegisterReviewExportRow
) {
  if (left.severity !== right.severity) {
    if (left.severity === "critical") return -1;
    if (right.severity === "critical") return 1;
    if (left.severity === "warning") return -1;
    if (right.severity === "warning") return 1;
  }

  const leftDue = left.dueDate ?? "9999-12-31";
  const rightDue = right.dueDate ?? "9999-12-31";
  if (leftDue !== rightDue) {
    return leftDue.localeCompare(rightDue);
  }

  return left.text.localeCompare(right.text, "fr-FR");
}

export function buildAffaireRegisterReviewExport(input: {
  generatedAt?: string;
  projectId: string;
  projectLabel: string;
  projectReference?: string | null;
  clientName?: string | null;
  versionId?: string | null;
  entries: AffaireRegisterEntry[];
}) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const includedEntries = input.entries.filter(
    (entry) =>
      entry.status === "open" ||
      entry.status === "rejected" ||
      entry.status === "clarify_with_client" ||
      isAffaireRegisterEntryRevalidationRequired(entry)
  );

  const rows = includedEntries
    .map((entry) => {
      const section = resolveAffaireRegisterReviewExportSection(entry);
      const sourceLabel =
        entry.sourceFileName?.trim() ||
        entry.location?.sourceFileName?.trim() ||
        null;

      return {
        entryId: entry.id,
        section,
        sectionLabel: AFFAIRE_REGISTER_REVIEW_EXPORT_SECTION_LABELS[section],
        kind: entry.kind,
        kindLabel: AFFAIRE_REGISTER_KIND_LABELS[entry.kind],
        severity: entry.severity,
        severityLabel: AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity],
        status: entry.status,
        statusLabel: AFFAIRE_REGISTER_STATUS_LABELS[entry.status],
        text: entry.text,
        scopeLabel: entry.scopeLabel,
        sourceLabel,
        ownerName: entry.followUp?.ownerName ?? null,
        dueDate: entry.followUp?.dueDate ?? null,
        businessImpacts: entry.businessImpact ?? [],
        businessImpactLabels: (entry.businessImpact ?? []).map(
          (impact) => AFFAIRE_REGISTER_BUSINESS_IMPACT_LABELS[impact]
        ),
        rationale: resolveAffaireRegisterReviewExportRationale(entry),
        location: entry.location ?? null,
      } satisfies AffaireRegisterReviewExportRow;
    })
    .sort(compareAffaireRegisterReviewExportRows);

  const sectionOrder = affaireRegisterReviewExportSectionSchema.options;
  const groups = sectionOrder
    .map((key) => {
      const groupRows = rows.filter((row) => row.section === key);
      return {
        key,
        title: AFFAIRE_REGISTER_REVIEW_EXPORT_SECTION_LABELS[key],
        description: AFFAIRE_REGISTER_REVIEW_EXPORT_SECTION_DESCRIPTIONS[key],
        count: groupRows.length,
        rows: groupRows,
      } satisfies AffaireRegisterReviewExportGroup;
    })
    .filter((group) => group.count > 0);

  const activeRows = rows.filter((row) => row.status !== "rejected");
  const exclusionRows = rows.filter((row) => row.section === "exclusion");
  const criticalRows = activeRows.filter((row) => row.severity === "critical");
  const blockingRows = activeRows.filter((row) =>
    row.businessImpacts.includes("blocks_submission")
  );
  const clarificationCount = activeRows.filter(
    (row) => row.section === "clarification"
  ).length;
  const revalidationCount = activeRows.filter(
    (row) => row.section === "revalidation"
  ).length;
  const hypothesisCount = activeRows.filter(
    (row) => row.section === "hypothesis"
  ).length;
  const exclusionCount = exclusionRows.length;
  const missingPieceCount = activeRows.filter(
    (row) => row.section === "missing_piece"
  ).length;
  const reviewNoteLines = [
    `Revue interne registre - ${input.projectLabel}`,
    [
      input.projectReference ? `Ref ${input.projectReference}` : null,
      input.clientName ? `Client ${input.clientName}` : null,
    ]
      .filter(Boolean)
      .join(" - "),
    `Points exportes: ${rows.length}`,
    `Critiques actives: ${criticalRows.length} - Bloquants pre-remise: ${blockingRows.length}`,
    `Hypotheses: ${hypothesisCount} - Pieces manquantes: ${missingPieceCount} - Clarifications: ${clarificationCount} - Revalidations: ${revalidationCount} - Exclusions: ${exclusionCount}`,
    ...criticalRows.slice(0, 5).map((row) => {
      const dueLabel = row.dueDate ? ` - echeance ${row.dueDate}` : "";
      const ownerLabel = row.ownerName ? ` - responsable ${row.ownerName}` : "";
      return `- ${row.sectionLabel} / ${row.scopeLabel}: ${row.text}${ownerLabel}${dueLabel}`;
    }),
    ...exclusionRows.slice(0, 5).map((row) => {
      const sourceLabel = row.sourceLabel ? ` - source ${row.sourceLabel}` : "";
      return `- Exclusion / ${row.scopeLabel}: ${row.text}${sourceLabel}`;
    }),
  ].filter((line) => line && line.trim().length > 0);

  const csvLines = [
    toAffaireRegisterCsvLine([
      "section",
      "type",
      "severite",
      "statut",
      "texte",
      "scope",
      "source",
      "responsable",
      "echeance",
      "impacts",
      "rationale",
    ]),
    ...rows.map((row) =>
      toAffaireRegisterCsvLine([
        row.sectionLabel,
        row.kindLabel,
        row.severityLabel,
        row.statusLabel,
        row.text,
        row.scopeLabel,
        row.sourceLabel ?? "",
        row.ownerName ?? "",
        row.dueDate ?? "",
        row.businessImpactLabels.join(" | "),
        row.rationale ?? "",
      ])
    ),
  ];
  const filenameSeed = normalizeAffaireRegisterText(
    [input.projectReference, input.projectLabel].filter(Boolean).join(" ") ||
      input.projectId,
    80
  )
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return {
    generatedAt,
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    projectReference: input.projectReference ?? null,
    clientName: input.clientName ?? null,
    versionId: input.versionId ?? null,
    capabilities: {
      explicitExclusions: "supported" as const,
      supportedEntryKinds: ["assumption", "missing_piece"] satisfies AffaireRegisterEntryKind[],
    },
    summary: {
      rowCount: rows.length,
      criticalCount: criticalRows.length,
      blockingCount: blockingRows.length,
      clarificationCount,
      revalidationCount,
      hypothesisCount,
      exclusionCount,
      missingPieceCount,
    },
    groups,
    reviewNote: `${reviewNoteLines.join("\n")}\n`,
    csvFilename: `registre-revue-${filenameSeed || input.projectId}.csv`,
    csvContent: `${csvLines.join("\n")}\n`,
  } satisfies AffaireRegisterReviewExport;
}
