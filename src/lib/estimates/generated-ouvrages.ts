import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { normalizeGeneratedOuvrageParent } from "@/lib/estimates/generated-ouvrage-parent";
import {
  assertDraftStatus,
} from "@/lib/estimates/server";
import { prepareEstimateBatch, sameEstimateBatchTimestamp, EstimateBatchPreparationError } from "@/lib/estimates/batch-preparation";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import { generatedOuvrageAcceptedCandidateSchema, generatedOuvrageReviewTokenSchema,
  generatedOuvrageRpcError, generatedOuvrageOutcomeUnknown, generatedOuvrageReadUnavailable,
  parseGeneratedOuvrageOutcome, type GeneratedOuvrageCommitResult,
  type GeneratedOuvrageApplicationOutcome } from "@/lib/estimates/generated-ouvrage-atomic";
export type { GeneratedOuvrageApplicationOutcome } from "@/lib/estimates/generated-ouvrage-atomic";
import { parseGeneratedOuvrageReview } from "@/lib/estimates/generated-ouvrage-review";
import { assertDraftLockOwnedByCurrentUser as assertDraftLockSessionOwnedByCurrentUser } from "@/lib/estimates/server-context";
import { projectGeneratedOuvrageCosts } from "@/lib/estimates/generated-ouvrage-cost-projection";
import { deriveGeneratedOuvrageLaborHours } from "@/lib/estimates/generated-ouvrage-labor-hours";
import { normalizeGeneratedOuvrageComponentContent, generatedOuvrageComponentContentJson } from "@/lib/estimates/generated-ouvrage-component-content";
import { multiplyToStoredEstimateNumeric, toStoredEstimateNumeric } from "@/lib/estimates/stored-item-numeric";
import {
  badRequest,
  conflict,
  forbidden,
  internalError,
  mapSupabaseError,
  notFound,
} from "@/lib/estimates/errors";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import type { Database, Json } from "@/types/database";

type Supabase = SupabaseClient<Database>;
type JsonRecord = Record<string, unknown>;
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type AuthenticatedContext = Awaited<ReturnType<typeof getAuthenticatedContext>>;

type EmbeddedProjectAccess = {
  id: string;
  tenant_id: string;
  user_id: string;
  name: string;
  reference: string | null;
  client_name: string | null;
  notes: string | null;
  is_archived: boolean;
};

type VersionAccessRow = {
  id: string;
  project_id: string;
  status: EstimateStatus;
  updated_at: string;
  margin_multiplier: number | null;
  estimate_projects: EmbeddedProjectAccess | EmbeddedProjectAccess[] | null;
};

type GeneratedOuvrageDraftRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  created_by: string;
  source_kind: GeneratedOuvrageInputSourceKind;
  preferred_lot_id: string | null;
  status: GeneratedOuvrageDraftStatus;
  summary: Json;
  generation_metadata: Json;
  applied_at: string | null;
};

type GeneratedOuvrageSourceFragmentRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  draft_id: string;
  fragment_order: number;
  source_kind: GeneratedOuvrageFragmentKind;
  status: GeneratedOuvrageFragmentStatus;
  label: string;
  excerpt: string;
  normalized_excerpt: string;
  source_document_id: string | null;
  source_file_name: string | null;
  source_page_from: number | null;
  source_page_to: number | null;
  selection_label: string | null;
  cctp_section_ref: string | null;
  metadata: Json;
};

type GeneratedOuvrageCandidateRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  draft_id: string;
  candidate_order: number;
  suggested_lot_id: string | null;
  lot_label: string | null;
  designation: string;
  normalized_designation: string;
  unit: string | null;
  quantity: number | null;
  confidence: number;
  ai_status: GeneratedOuvrageCandidateAiStatus;
  resolution_status: GeneratedOuvrageCandidateResolutionStatus;
  reasoning: string | null;
  metadata: Json;
};

type GeneratedOuvrageCandidateSourceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  draft_id: string;
  candidate_id: string;
  source_fragment_id: string;
  source_rank: number;
  rationale: string | null;
  metadata: Json;
};

type GeneratedOuvrageApplicationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  draft_id: string;
  candidate_id: string;
  target_version_id: string;
  estimate_item_id: string;
  applied_by: string | null;
  applied_payload: Json;
};

type GeneratedOuvrageSubdetailDraftStatus =
  | "pending_review"
  | "reviewed"
  | "applied"
  | "discarded";
type GeneratedOuvrageSubdetailItemStatus = "suggested" | "manual" | "rejected";
type GeneratedOuvrageSubdetailCostType =
  | "material"
  | "labor"
  | "equipment"
  | "subcontract";
type GeneratedOuvrageEvidenceKind = "fact" | "hypothesis" | "inference";
type GeneratedOuvrageRiskSignalSeverity = "info" | "warning" | "critical";
type GeneratedOuvrageReviewedCandidateSnapshot = {
  designation: string;
  unit: string | null;
  quantity: number | null;
};

type GeneratedOuvrageSubdetailDraftRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  draft_id: string;
  parent_work_id: string;
  created_by: string;
  status: GeneratedOuvrageSubdetailDraftStatus;
  summary: Json;
  generation_metadata: Json;
  applied_at: string | null;
};

type GeneratedOuvrageSubdetailItemRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  draft_id: string;
  subdetail_id: string;
  parent_work_id: string;
  source_fragment_id: string | null;
  component_order: number;
  status: GeneratedOuvrageSubdetailItemStatus;
  cost_type: GeneratedOuvrageSubdetailCostType;
  designation: string;
  unit: string | null;
  quantity: number;
  unit_cost_ht_cents: number;
  loss_coeff_bp: number;
  yield_value: number | null;
  yield_unit: string | null;
  confidence: number;
  source_label: string | null;
  facts: Json;
  hypotheses: Json;
  inferences: Json;
  metadata: Json;
};

type GeneratedOuvrageSubdetailItemSourceRow = {
  id: string;
  created_at: string;
  tenant_id: string;
  draft_id: string;
  subdetail_id: string;
  parent_work_id: string;
  component_id: string;
  source_fragment_id: string;
  source_rank: number;
  evidence_kind: GeneratedOuvrageEvidenceKind;
  note: string | null;
  metadata: Json;
};

type AffaireBriefRow = {
  id: string;
  project_id: string;
  status: string;
  summary: string;
  project_object: string;
  scope: unknown;
  lots: unknown;
  assumptions: unknown;
  vigilance_points: unknown;
  missing_elements: unknown;
};

type EstimateTemplateSummaryRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type EstimateAssemblySummaryRow = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

type LaborRoleSummaryRow = {
  id: string;
  name: string;
  hourly_rate_cents: number;
  position: number;
};

type HistoricalLineRow = {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  quantity: number | null;
  created_at: string;
};

type DraftLoaded = {
  draft: GeneratedOuvrageDraftRow;
  fragments: GeneratedOuvrageSourceFragmentRow[];
  candidates: GeneratedOuvrageCandidateRow[];
  candidateSources: GeneratedOuvrageCandidateSourceRow[];
  applications: GeneratedOuvrageApplicationRow[];
};

const GENERATED_OUVRAGE_MODEL = "gemini-3-pro-preview";
const GENERATED_OUVRAGE_PROMPT_VERSION = "est381-generated-ouvrages-v1";
const GENERATED_OUVRAGE_PROMPT_THINKING_LEVEL = "medium" as const;
const GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE = "À classer";
const MAX_SOURCE_TEXT_LENGTH = 12_000;
const MAX_REASON_LENGTH = 320;
const MAX_SELECTION_LABEL_LENGTH = 180;
const MAX_SOURCE_FILE_NAME_LENGTH = 255;
const MAX_CANDIDATES = 12;
const HISTORY_FRAGMENT_LIMIT = 6;
const LIBRARY_FRAGMENT_LIMIT = 6;

export const generatedOuvrageInputSourceKindSchema = z.enum([
  "free_text",
  "cctp_excerpt",
  "internal_note",
]);
export const generatedOuvrageFragmentKindSchema = z.enum([
  "free_text",
  "cctp_excerpt",
  "internal_note",
  "history",
  "library",
]);
export const generatedOuvrageFragmentStatusSchema = z.enum(["active", "discarded"]);
export const generatedOuvrageDraftStatusSchema = z.enum([
  "pending",
  "partially_applied",
  "applied",
  "discarded",
]);
export const generatedOuvrageCandidateAiStatusSchema = z.enum([
  "certain",
  "plausible",
  "question",
]);
export const generatedOuvrageCandidateResolutionStatusSchema = z.enum([
  "pending",
  "inserted",
  "rejected",
]);
export const generatedOuvrageSubdetailDraftStatusSchema = z.enum([
  "pending_review",
  "reviewed",
  "applied",
  "discarded",
]);
export const generatedOuvrageSubdetailItemStatusSchema = z.enum([
  "suggested",
  "manual",
  "rejected",
]);
export const generatedOuvrageSubdetailCostTypeSchema = z.enum([
  "material",
  "labor",
  "equipment",
  "subcontract",
]);
export const generatedOuvrageEvidenceKindSchema = z.enum([
  "fact",
  "hypothesis",
  "inference",
]);
export const generatedOuvrageRiskSignalSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);

const generatedOuvrageGenerateInputSchema = z.object({
  projectId: z.string().uuid("projectId invalide."),
  versionId: z.string().uuid("versionId invalide."),
  draftLockSessionId: z.string().uuid("draftLockSessionId invalide."),
  sourceKind: generatedOuvrageInputSourceKindSchema,
  sourceText: z
    .string()
    .trim()
    .min(1, "Le texte source est requis.")
    .max(MAX_SOURCE_TEXT_LENGTH, `Le texte source depasse ${MAX_SOURCE_TEXT_LENGTH} caracteres.`),
  preferredLotId: z.string().uuid("preferredLotId invalide.").nullable().optional(),
  sourceDocumentId: z.string().uuid("sourceDocumentId invalide.").nullable().optional(),
  sourceFileName: z
    .string()
    .trim()
    .max(MAX_SOURCE_FILE_NAME_LENGTH, "sourceFileName trop long.")
    .nullable()
    .optional(),
  sourcePageFrom: z.number().int().min(1).nullable().optional(),
  sourcePageTo: z.number().int().min(1).nullable().optional(),
  selectionLabel: z
    .string()
    .trim()
    .max(MAX_SELECTION_LABEL_LENGTH, "selectionLabel trop long.")
    .nullable()
    .optional(),
});

const generatedOuvrageFetchInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
});

const RESUMABLE_DRAFT_PAGE_SIZE = 20;
const generatedOuvrageCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
}).strict();
const generatedOuvrageListInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  cursor: z.string().min(1).max(512).regex(/^[A-Za-z0-9_-]+$/).nullable().optional(),
}).strict();
const generatedOuvrageListRowsSchema = z.array(z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  source_kind: generatedOuvrageInputSourceKindSchema,
  status: z.enum(["pending", "partially_applied"]),
  candidates: z.array(z.object({
    ai_status: generatedOuvrageCandidateAiStatusSchema,
    resolution_status: generatedOuvrageCandidateResolutionStatusSchema,
  })).max(MAX_CANDIDATES),
})).max(RESUMABLE_DRAFT_PAGE_SIZE + 1);

type ListResumableGeneratedOuvrageDraftsInput = z.infer<
  typeof generatedOuvrageListInputSchema
>;

export type GeneratedOuvrageDraftPage = {
  versionId: string;
  items: {
    draftId: string;
    createdAt: string;
    sourceKind: GeneratedOuvrageInputSourceKind;
    status: "pending" | "partially_applied";
    summary: GeneratedOuvrageDraftSummary;
  }[];
  nextCursor: string | null;
};

const generatedOuvrageSubdetailFetchInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
  draftLockSessionId: z.string().uuid().optional(),
});

const generatedOuvrageInsertCandidateSchema = generatedOuvrageAcceptedCandidateSchema;

const generatedOuvrageInsertInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  draftLockSessionId: z.string().trim().uuid("Session de verrou invalide."),
  operationKey: z.string().uuid().transform((value) => value.toLowerCase()),
  expectedUpdatedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  acceptedCandidates: z
    .array(generatedOuvrageInsertCandidateSchema)
    .min(1, "Au moins un ouvrage doit être sélectionné.")
    .max(MAX_CANDIDATES, `Maximum ${MAX_CANDIDATES} ouvrages par insertion.`),
});

const generatedOuvrageRejectInputSchema = z.object({
  versionId: z.string().uuid(),
  draftLockSessionId: z.string().uuid(),
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
  reason: z.string().trim().max(MAX_REASON_LENGTH).nullable().optional(),
});

const generatedOuvrageSubdetailRiskSignalSchema = z.object({
  label: z.string().trim().min(1).max(220),
  severity: generatedOuvrageRiskSignalSeveritySchema,
  basis: generatedOuvrageEvidenceKindSchema,
});

const generatedOuvrageSubdetailSourceInputSchema = z.object({
  sourceFragmentId: z.string().uuid("sourceFragmentId invalide."),
  evidenceKind: generatedOuvrageEvidenceKindSchema,
  note: z.string().trim().max(320).nullable().optional(),
});

const generatedOuvrageSubdetailComponentInputSchema = z.object({
  componentId: z.string().uuid("componentId invalide.").nullable().optional(),
  status: generatedOuvrageSubdetailItemStatusSchema.default("suggested"),
  restore: z.boolean().optional(),
  restoreAsManual: z.boolean().optional(),
  costType: generatedOuvrageSubdetailCostTypeSchema,
  designation: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite("Quantité invalide.").min(0),
  unitCostHtCents: z.number().int("Coût unitaire invalide.").min(0),
  lossCoeffBp: z.number().int("Perte invalide.").min(0).max(100000).default(0),
  yieldValue: z.number().finite("Rendement invalide.").positive().nullable().optional(),
  yieldUnit: z.string().trim().max(64).nullable().optional(),
  confidence: z.number().finite("Confiance invalide.").min(0).max(1),
  sourceLabel: z.string().trim().max(220).nullable().optional(),
  facts: z.array(z.string().trim().min(1).max(320)).max(8).default([]),
  hypotheses: z.array(z.string().trim().min(1).max(320)).max(8).default([]),
  inferences: z.array(z.string().trim().min(1).max(320)).max(8).default([]),
  riskSignals: z.array(generatedOuvrageSubdetailRiskSignalSchema).max(8).default([]),
  sources: z.array(generatedOuvrageSubdetailSourceInputSchema).max(6).default([]),
});

const generatedOuvrageReviewedCandidateSchema = z.object({
  designation: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite("Quantité invalide.").min(0).nullable().optional(),
});

const generatedOuvrageSubdetailUpdateInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
  draftLockSessionId: z.string().uuid(),
  expectedReviewToken: generatedOuvrageReviewTokenSchema.nullable(),
  markReviewed: z.boolean().default(true),
  reviewedCandidate: generatedOuvrageReviewedCandidateSchema.optional(),
  components: z
    .array(generatedOuvrageSubdetailComponentInputSchema)
    .min(1, "Au moins un composant est requis.")
    .max(24, "Maximum 24 composants."),
});

const geminiGeneratedOuvrageCandidateSchema = z.object({
  lotLabel: z.string().trim().max(180).nullable().optional(),
  designation: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite().min(0).nullable().optional(),
  confidence: z.number().finite().min(0).max(1),
  status: generatedOuvrageCandidateAiStatusSchema,
  sourceFragmentIds: z.array(z.string().uuid()).max(6).default([]),
  reasoning: z.string().trim().max(320).nullable().optional(),
});

const geminiGeneratedOuvrageExchangeSchema = z.object({
  summary: z.string().trim().max(320).nullable().optional(),
  candidates: z.array(geminiGeneratedOuvrageCandidateSchema).max(MAX_CANDIDATES),
});

type GeneratedOuvrageInputSourceKind = z.infer<
  typeof generatedOuvrageInputSourceKindSchema
>;
type GeneratedOuvrageFragmentKind = z.infer<
  typeof generatedOuvrageFragmentKindSchema
>;
type GeneratedOuvrageFragmentStatus = z.infer<
  typeof generatedOuvrageFragmentStatusSchema
>;
type GeneratedOuvrageDraftStatus = z.infer<typeof generatedOuvrageDraftStatusSchema>;
type GeneratedOuvrageCandidateAiStatus = z.infer<
  typeof generatedOuvrageCandidateAiStatusSchema
>;
type GeneratedOuvrageCandidateResolutionStatus = z.infer<
  typeof generatedOuvrageCandidateResolutionStatusSchema
>;
type GenerateGeneratedOuvrageInput = z.infer<typeof generatedOuvrageGenerateInputSchema>;
type FetchGeneratedOuvrageDraftInput = z.infer<typeof generatedOuvrageFetchInputSchema>;
type FetchGeneratedOuvrageSubdetailInput = z.infer<
  typeof generatedOuvrageSubdetailFetchInputSchema
>;
type InsertGeneratedOuvragesInput = z.infer<typeof generatedOuvrageInsertInputSchema>;
type RejectGeneratedOuvrageDraftInput = z.infer<typeof generatedOuvrageRejectInputSchema>;
type UpdateGeneratedOuvrageSubdetailInput = z.infer<
  typeof generatedOuvrageSubdetailUpdateInputSchema
>;
type GeminiGeneratedOuvrageExchange = z.infer<
  typeof geminiGeneratedOuvrageExchangeSchema
>;

type GeneratedOuvragePromptCandidate = GeminiGeneratedOuvrageExchange["candidates"][number];

type GeneratedOuvrageDraftSummary = {
  totalCandidates: number;
  certainCount: number;
  plausibleCount: number;
  questionCount: number;
  pendingCount: number;
  insertedCount: number;
  rejectedCount: number;
};

export type GeneratedOuvrageRiskSignal = z.infer<
  typeof generatedOuvrageSubdetailRiskSignalSchema
>;

type SourceFragmentSeed = {
  sourceKind: GeneratedOuvrageFragmentKind;
  label: string;
  excerpt: string;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  sourcePageFrom?: number | null;
  sourcePageTo?: number | null;
  selectionLabel?: string | null;
  cctpSectionRef?: string | null;
  metadata?: JsonRecord;
};

export type GeneratedOuvrageCandidateSource = {
  sourceFragmentId: string;
  sourceDocumentId: string | null;
  type: "text" | "cctp" | "history" | "library";
  label: string;
  excerpt: string | null;
  sourceFileName: string | null;
  sourcePageFrom: number | null;
  sourcePageTo: number | null;
  selectionLabel: string | null;
};

export type GeneratedOuvrageCandidate = {
  candidateId: string;
  suggestedLotId: string | null;
  lotLabel: string | null;
  designation: string;
  unit: string | null;
  quantity: number | null;
  confidence: number;
  status: GeneratedOuvrageCandidateAiStatus;
  resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
  appliedValues?: {
    designation: string;
    unit: string | null;
    quantity: number | null;
    lotId: string | null;
  } | null;
  reasoning: string | null;
  sources: GeneratedOuvrageCandidateSource[];
};

export type GeneratedOuvrageDraftResult = {
  draftId: string;
  versionId: string;
  projectId: string;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotId: string | null;
  status: GeneratedOuvrageDraftStatus;
  summary: GeneratedOuvrageDraftSummary;
  generatedAt: string;
  candidates: GeneratedOuvrageCandidate[];
};

export type GeneratedOuvrageSubdetailSource = GeneratedOuvrageCandidateSource & {
  evidenceKind: GeneratedOuvrageEvidenceKind;
  note: string | null;
};

export type GeneratedOuvrageSubdetailComponent = {
  componentId: string;
  status: GeneratedOuvrageSubdetailItemStatus;
  rejectedFromStatus: "suggested" | "manual" | null;
  costType: GeneratedOuvrageSubdetailCostType;
  designation: string;
  unit: string | null;
  quantity: number;
  unitCostHtCents: number;
  lossCoeffBp: number;
  yieldValue: number | null;
  yieldUnit: string | null;
  confidence: number;
  sourceLabel: string | null;
  dsCents: number;
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  riskSignals: GeneratedOuvrageRiskSignal[];
  sources: GeneratedOuvrageSubdetailSource[];
};

export type GeneratedOuvrageSubdetailSummary = {
  componentCount: number;
  dsCents: number;
  indicativeTargetPriceCents: number;
  confidence: number;
  pricingSource: string | null;
  riskSignals: GeneratedOuvrageRiskSignal[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
};

type GeneratedOuvrageEstimateItemMappingMode =
  | "no_labor"
  | "legacy_labor_allocated"
  | "labor_hours_only"
  | "labor_hours_role_without_rate";

type GeneratedOuvrageEstimateItemCostBreakdown = {
  costType: GeneratedOuvrageSubdetailCostType;
  componentCount: number;
  quantity: number;
  dsCents: number;
};

type GeneratedOuvrageEstimateItemLaborTrace = {
  componentId: string;
  designation: string;
  unit: string | null;
  quantity: number;
  derivedHours: number;
  hoursSource: "quantity" | "yield";
  dsCents: number;
};

type GeneratedOuvrageEstimateItemMapping = {
  source: "generated_ouvrage_subdetail_review";
  mode: GeneratedOuvrageEstimateItemMappingMode;
  unitPriceHtCents: number;
  hMo: number;
  kFo: number;
  kMo: number;
  laborRoleId: string | null;
  laborRoleName: string | null;
  laborRoleHourlyRateCents: number | null;
  totalDsCents: number;
  nonLaborDsCents: number;
  laborDsCents: number;
  costBreakdown: GeneratedOuvrageEstimateItemCostBreakdown[];
  laborTrace: GeneratedOuvrageEstimateItemLaborTrace[];
};

export type GeneratedOuvrageSubdetailResult = {
  reviewToken: string;
  draftId: string;
  candidateId: string;
  versionId: string;
  projectId: string;
  status: GeneratedOuvrageSubdetailDraftStatus;
  humanValidationRequired: true;
  generatedAt: string;
  updatedAt: string;
  summary: GeneratedOuvrageSubdetailSummary;
  components: GeneratedOuvrageSubdetailComponent[];
  reviewedCandidate?: GeneratedOuvrageReviewedCandidateSnapshot | null;
};

export type InsertGeneratedOuvragesResult = GeneratedOuvrageCommitResult;

export type RejectGeneratedOuvrageDraftResult = {
  ok: true;
  draftStatus: GeneratedOuvrageDraftStatus;
  projectId: string;
  versionId: string;
};

function toNullableText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(value: string, maxLength?: number) {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (typeof maxLength === "number" && trimmed.length > maxLength) {
    return trimmed.slice(0, maxLength).trim();
  }
  return trimmed;
}

function normalizeReviewedCandidateSnapshot(input: {
  designation: string;
  unit: unknown;
  quantity: unknown;
}): GeneratedOuvrageReviewedCandidateSnapshot {
  return normalizeGeneratedOuvrageParent(input);
}

function readReviewedCandidateSnapshot(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const record = value as JsonRecord;
  const designation = toNullableText(record.designation);
  if (!designation) {
    return null;
  }

  return normalizeReviewedCandidateSnapshot({
    designation,
    unit: record.unit,
    quantity: record.quantity,
  });
}

function reviewedCandidateMatches(input: {
  acceptedCandidate: GeneratedOuvrageReviewedCandidateSnapshot;
  reviewedCandidate: GeneratedOuvrageReviewedCandidateSnapshot;
}) {
  return (
    input.acceptedCandidate.designation === input.reviewedCandidate.designation &&
    input.acceptedCandidate.unit === input.reviewedCandidate.unit &&
    input.acceptedCandidate.quantity === input.reviewedCandidate.quantity
  );
}

function normalizeMultilineText(value: string, maxLength?: number) {
  const compact = value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return typeof maxLength === "number" && compact.length > maxLength
    ? compact.slice(0, maxLength).trim()
    : compact;
}

function normalizeDesignation(value: string) {
  return normalizeText(value).toLowerCase();
}

function normalizeSectionTitle(value: string | null | undefined) {
  const normalized = toNullableText(value);
  if (!normalized) {
    return "section";
  }

  return normalized
    .normalize("NFD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, Number(value)));
}

function toJson(value: JsonRecord | JsonRecord[] | string[] | string | number | boolean | null) {
  return value as Json;
}

function pickStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toNullableText(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function mapFragmentKindToCandidateSourceType(
  kind: GeneratedOuvrageFragmentKind
): GeneratedOuvrageCandidateSource["type"] {
  if (kind === "cctp_excerpt") return "cctp";
  if (kind === "history") return "history";
  if (kind === "library") return "library";
  return "text";
}

function canAccessOwnerResource(input: {
  context: Pick<AuthenticatedContext, "userId" | "tenantRole">;
  resourceUserId: string;
}) {
  return (
    input.resourceUserId === input.context.userId ||
    input.context.tenantRole === "admin"
  );
}

function resolveEmbeddedOne<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

async function getVersionAccessOrThrow(
  supabase: Supabase,
  versionId: string,
  context: Pick<AuthenticatedContext, "tenantId" | "tenantRole" | "userId">
): Promise<{ version: VersionAccessRow; project: EmbeddedProjectAccess }> {
  const { data, error } = await supabase
    .from("estimate_versions")
    .select(
      "id, project_id, status, updated_at, margin_multiplier, estimate_projects!inner(id, tenant_id, user_id, name, reference, client_name, notes, is_archived)"
    )
    .eq("id", versionId)
    .eq("tenant_id", context.tenantId)
    .single();

  if (error || !data) {
    throw notFound("Version de chiffrage introuvable.");
  }

  const row = data as unknown as VersionAccessRow;
  const project = resolveEmbeddedOne(row.estimate_projects);

  if (
    !project ||
    project.tenant_id !== context.tenantId ||
    !canAccessOwnerResource({
      context,
      resourceUserId: project.user_id,
    })
  ) {
    throw notFound("Version de chiffrage introuvable.");
  }

  return {
    version: row,
    project,
  };
}

async function loadLotLabel(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  lotId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("id, title, item_type, version_id")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("id", input.lotId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger le lot sélectionné.");
  }

  if (!data) {
    throw notFound("Lot introuvable.", undefined, "EST381_LOT_NOT_FOUND");
  }

  if ((data as { item_type?: string }).item_type !== "section") {
    throw badRequest("Le lot sélectionné doit être un chapitre du devis.");
  }

  return normalizeText((data as { title: string }).title, 180);
}

async function loadConfirmedBriefFragments(input: {
  supabase: Supabase;
  projectId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const { data, error } = await input.supabase
      .from("affaire_briefs" as never)
      .select(
        "id, project_id, status, summary, project_object, scope, lots, assumptions, vigilance_points, missing_elements" as never
      )
      .eq("project_id", input.projectId)
      .eq("status", "confirme")
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data) || data.length === 0) {
      return [];
    }

    const brief = data[0] as AffaireBriefRow;
    const fragments: SourceFragmentSeed[] = [];

    const summary = toNullableText(brief.summary);
    if (summary) {
      fragments.push({
        sourceKind: "internal_note",
        label: "Brief confirme",
        excerpt: summary,
        metadata: { block: "summary" },
      });
    }

    const projectObject = toNullableText(brief.project_object);
    if (projectObject) {
      fragments.push({
        sourceKind: "internal_note",
        label: "Objet du chantier",
        excerpt: projectObject,
        metadata: { block: "project_object" },
      });
    }

    const bulletBlocks = [
      ["scope", "Perimetre"],
      ["lots", "Lots du brief"],
      ["assumptions", "Hypothèses confirmées"],
      ["vigilance_points", "Points de vigilance"],
      ["missing_elements", "Éléments manquants"],
    ] as const;

    for (const [key, label] of bulletBlocks) {
      const values = pickStringArray(brief[key]);
      if (values.length === 0) continue;
      fragments.push({
        sourceKind: "internal_note",
        label,
        excerpt: values.join("\n"),
        metadata: { block: key },
      });
    }

    return fragments;
  } catch {
    return [];
  }
}

async function loadHistoricalFragments(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  excludeVersionId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const { data: versionData, error: versionError } = await input.supabase
      .from("estimate_versions")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .neq("id", input.excludeVersionId)
      .order("updated_at", { ascending: false })
      .limit(3);

    if (versionError || !versionData || versionData.length === 0) {
      return [];
    }

    const versionIds = versionData.map((row) => row.id);
    const { data: itemData, error: itemError } = await input.supabase
      .from("estimate_items")
      .select("id, version_id, title, description, quantity, created_at")
      .eq("tenant_id", input.tenantId)
      .eq("item_type", "line")
      .in("version_id", versionIds)
      .order("created_at", { ascending: false })
      .limit(HISTORY_FRAGMENT_LIMIT);

    if (itemError || !itemData) {
      return [];
    }

    return (itemData as HistoricalLineRow[]).map((row) => {
      const parts = [normalizeText(row.title, 220)];
      const description = toNullableText(row.description);
      if (description) {
        parts.push(description);
      }
      if (typeof row.quantity === "number") {
        parts.push(`Quantité historique: ${row.quantity}`);
      }
      return {
        sourceKind: "history" as const,
        label: "Historique affaire",
        excerpt: parts.join(" | "),
        metadata: {
          versionId: row.version_id,
          estimateItemId: row.id,
        },
      };
    });
  } catch {
    return [];
  }
}

async function loadLibraryFragments(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}): Promise<SourceFragmentSeed[]> {
  try {
    const [templateResult, assemblyResult] = await Promise.all([
      input.supabase
        .from("estimate_templates")
        .select("id, name, description, updated_at")
        .eq("tenant_id", input.tenantId)
        .eq("created_by", input.ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(LIBRARY_FRAGMENT_LIMIT),
      input.supabase
        .from("estimate_assemblies")
        .select("id, name, description, updated_at")
        .eq("tenant_id", input.tenantId)
        .eq("created_by", input.ownerUserId)
        .order("updated_at", { ascending: false })
        .limit(LIBRARY_FRAGMENT_LIMIT),
    ]);

    const fragments: SourceFragmentSeed[] = [];

    if (!templateResult.error && templateResult.data) {
      for (const row of templateResult.data as EstimateTemplateSummaryRow[]) {
        fragments.push({
          sourceKind: "library",
          label: "Template de devis",
          excerpt: [normalizeText(row.name, 180), toNullableText(row.description)]
            .filter((value): value is string => Boolean(value))
            .join(" | "),
          metadata: { templateId: row.id },
        });
      }
    }

    if (!assemblyResult.error && assemblyResult.data) {
      for (const row of assemblyResult.data as EstimateAssemblySummaryRow[]) {
        fragments.push({
          sourceKind: "library",
          label: "Ouvrage",
          excerpt: [normalizeText(row.name, 180), toNullableText(row.description)]
            .filter((value): value is string => Boolean(value))
            .join(" | "),
          metadata: { assemblyId: row.id },
        });
      }
    }

    return fragments.slice(0, LIBRARY_FRAGMENT_LIMIT);
  } catch {
    return [];
  }
}

async function buildSourceFragmentSeeds(input: {
  supabase: Supabase;
  tenantId: string;
  project: EmbeddedProjectAccess;
  versionId: string;
  sourceKind: GeneratedOuvrageInputSourceKind;
  sourceText: string;
  sourceDocumentId?: string | null;
  sourceFileName?: string | null;
  sourcePageFrom?: number | null;
  sourcePageTo?: number | null;
  selectionLabel?: string | null;
}) {
  const primaryFragment: SourceFragmentSeed = {
    sourceKind: input.sourceKind,
    label:
      input.sourceKind === "cctp_excerpt"
        ? "Extrait CCTP selectionne"
        : input.sourceKind === "internal_note"
          ? "Note interne"
          : "Texte libre saisi",
    excerpt: normalizeMultilineText(input.sourceText, MAX_SOURCE_TEXT_LENGTH),
    sourceDocumentId: input.sourceDocumentId ?? null,
    sourceFileName: toNullableText(input.sourceFileName),
    sourcePageFrom: input.sourcePageFrom ?? null,
    sourcePageTo: input.sourcePageTo ?? null,
    selectionLabel: toNullableText(input.selectionLabel),
    metadata: {
      origin: "input",
    },
  };

  const [briefFragments, historyFragments, libraryFragments] = await Promise.all([
    loadConfirmedBriefFragments({
      supabase: input.supabase,
      projectId: input.project.id,
    }),
    loadHistoricalFragments({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.project.id,
      excludeVersionId: input.versionId,
    }),
    loadLibraryFragments({
      supabase: input.supabase,
      tenantId: input.tenantId,
      ownerUserId: input.project.user_id,
    }),
  ]);

  const noteFragment =
    toNullableText(input.project.notes) === null
      ? []
      : [
          {
            sourceKind: "internal_note" as const,
            label: "Notes affaire",
            excerpt: normalizeMultilineText(input.project.notes ?? "", 500),
            metadata: { origin: "project_notes" },
          } satisfies SourceFragmentSeed,
        ];

  const deduped = new Map<string, SourceFragmentSeed>();
  for (const seed of [
    primaryFragment,
    ...noteFragment,
    ...briefFragments,
    ...historyFragments,
    ...libraryFragments,
  ]) {
    if (!seed.excerpt) continue;
    const normalizedKey = `${seed.sourceKind}:${normalizeText(seed.label, 180)}:${seed.excerpt
      .trim()
      .toLowerCase()}`;
    if (!deduped.has(normalizedKey)) {
      deduped.set(normalizedKey, seed);
    }
  }

  return Array.from(deduped.values()).slice(0, 20);
}

async function closeGeneratedOuvrageGeneration(input: {
  supabase: Supabase;
  versionId: string;
  draftId: string;
  draftLockSessionId: string;
  mode: "complete" | "failed";
}) {
  let response;
  try {
    response = await input.supabase.rpc("close_generated_ouvrage_generation", {
      p_version_id: input.versionId, p_draft_id: input.draftId,
      p_draft_lock_session_id: input.draftLockSessionId, p_mode: input.mode,
    });
  } catch { throw generatedOuvrageOutcomeUnknown(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, true);
  const parsed = z.object({ ok: z.literal(true), versionId: z.string().uuid(),
    draftId: z.string().uuid(), status: z.enum(["pending", "discarded"]),
    discardedDraftIds: z.array(z.string().uuid()),
  }).strict().safeParse(response.data);
  if (!parsed.success || parsed.data.versionId !== input.versionId || parsed.data.draftId !== input.draftId ||
    new Set(parsed.data.discardedDraftIds).size !== parsed.data.discardedDraftIds.length ||
    (input.mode === "complete" ? parsed.data.status !== "pending" || parsed.data.discardedDraftIds.includes(input.draftId)
      : parsed.data.status !== "discarded" || parsed.data.discardedDraftIds.length !== 1 || parsed.data.discardedDraftIds[0] !== input.draftId)) {
    throw generatedOuvrageOutcomeUnknown();
  }
}

function parseSourceKindLabel(kind: GeneratedOuvrageInputSourceKind) {
  switch (kind) {
    case "cctp_excerpt":
      return "extrait CCTP";
    case "internal_note":
      return "note interne";
    default:
      return "texte libre";
  }
}

function buildGeneratedOuvragePrompt(input: {
  project: EmbeddedProjectAccess;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotLabel: string | null;
  fragments: GeneratedOuvrageSourceFragmentRow[];
}) {
  const fragmentLines = input.fragments
    .map((fragment) => {
      const metaParts = [
        `kind=${fragment.source_kind}`,
        `label=${fragment.label}`,
        fragment.source_file_name ? `file=${fragment.source_file_name}` : null,
        fragment.selection_label ? `selection=${fragment.selection_label}` : null,
      ].filter((value): value is string => Boolean(value));
      return [
        `- [${fragment.id}] ${metaParts.join(" | ")}`,
        fragment.excerpt,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "Tu aides un chiffreur BTP à proposer des ouvrages candidats à partir d'un texte source.",
    "Réponse strictement structuree selon le schema JSON fourni.",
    "Ne cree rien automatiquement, propose seulement des candidats revus par un humain.",
    `Contexte affaire: ${input.project.name}`,
    `Source principale: ${parseSourceKindLabel(input.sourceKind)}`,
    input.preferredLotLabel ? `Lot prefere: ${input.preferredLotLabel}` : "Lot prefere: aucun",
    "",
    "Regles:",
    "1. Chaque candidat doit contenir designation, unit si visible, quantity si deducible, confidence et status.",
    "2. Utilise status=certain si la source est explicite et exploitable, plausible si une interpretation reste raisonnable, question si l'information manque ou est ambigue.",
    "3. sourceFragmentIds doit contenir uniquement des ids presents ci-dessous.",
    "4. Si aucun lot clair n'apparait, laisse lotLabel a null.",
    "5. N'invente ni prix ni détails absents.",
    "",
    "Fragments sources:",
    fragmentLines,
  ].join("\n");
}

function splitFallbackLines(sourceText: string) {
  const normalized = sourceText.replace(/\r/g, "");
  const rawLines = normalized
    .split("\n")
    .flatMap((line) => line.split(/[;•]/))
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  if (rawLines.length > 1) {
    return rawLines;
  }

  return normalized
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 8);
}

function parseQuantityAndUnit(value: string) {
  const match = value.match(
    /(\d+(?:[.,]\d+)?)\s*(m2|m²|m3|m³|ml|m|u|unite|forfait|kg|t)\b/i
  );

  if (!match) {
    return {
      quantity: null,
      unit: null,
    };
  }

  const quantity = Number(match[1]?.replace(",", "."));
  const unit = match[2]?.toLowerCase() ?? null;

  return {
    quantity: Number.isFinite(quantity) ? quantity : null,
    unit:
      unit === "unite"
        ? "u"
        : unit === "m²"
          ? "m2"
          : unit === "m³"
            ? "m3"
            : unit,
  };
}

function buildFallbackCandidates(input: {
  sourceText: string;
  sourceFragmentId: string;
  preferredLotLabel: string | null;
}): GeminiGeneratedOuvrageExchange {
  const lines = splitFallbackLines(input.sourceText).slice(0, MAX_CANDIDATES);
  const deduped = new Set<string>();
  const candidates: GeneratedOuvragePromptCandidate[] = [];

  for (const line of lines) {
    const designation = normalizeText(
      line.replace(/\b\d+(?:[.,]\d+)?\s*(m2|m²|m3|m³|ml|m|u|unite|forfait|kg|t)\b/gi, ""),
      220
    );
    const normalizedDesignation = normalizeDesignation(designation || line);

    if (!normalizedDesignation || deduped.has(normalizedDesignation)) {
      continue;
    }

    deduped.add(normalizedDesignation);
    const parsed = parseQuantityAndUnit(line);
    const hasQuantity = typeof parsed.quantity === "number";
    const status: GeneratedOuvrageCandidateAiStatus = line.includes("?")
      ? "question"
      : hasQuantity
        ? "plausible"
        : "question";

    candidates.push({
      lotLabel: input.preferredLotLabel,
      designation: designation || normalizeText(line, 220),
      unit: parsed.unit,
      quantity: parsed.quantity,
      confidence: hasQuantity ? 0.62 : 0.38,
      status,
      sourceFragmentIds: [input.sourceFragmentId],
      reasoning: hasQuantity
        ? "Fallback heuristique base sur le texte source."
        : "Information incomplete à clarifier en revue humaine.",
    });
  }

  if (candidates.length === 0) {
    candidates.push({
      lotLabel: input.preferredLotLabel,
      designation: normalizeText(input.sourceText, 220),
      unit: null,
      quantity: null,
      confidence: 0.25,
      status: "question",
      sourceFragmentIds: [input.sourceFragmentId],
      reasoning: "Aucune structure exploitable détectée automatiquement.",
    });
  }

  return {
    summary: "Fallback heuristique utilise.",
    candidates,
  };
}

async function generatePromptCandidates(input: {
  project: EmbeddedProjectAccess;
  sourceKind: GeneratedOuvrageInputSourceKind;
  preferredLotLabel: string | null;
  fragments: GeneratedOuvrageSourceFragmentRow[];
}) {
  const prompt = buildGeneratedOuvragePrompt(input);

  try {
    const result = await callGeminiStructured<GeminiGeneratedOuvrageExchange>({
      prompt,
      schema: geminiGeneratedOuvrageExchangeSchema,
      thinkingLevel: GENERATED_OUVRAGE_PROMPT_THINKING_LEVEL,
      context: {
        model: GENERATED_OUVRAGE_MODEL,
        promptVersion: GENERATED_OUVRAGE_PROMPT_VERSION,
      },
    });

    return {
      exchange: result.data,
      metadata: {
        model: result.model,
        prompt_version: result.promptVersion,
        used_fallback: false,
        token_count: result.tokenCount,
        cost_cents: result.costCents,
        duration_ms: result.durationMs,
        summary: result.data.summary ?? null,
      } satisfies JsonRecord,
    };
  } catch (error) {
    const primaryFragment = input.fragments[0];
    return {
      exchange: buildFallbackCandidates({
        sourceText: primaryFragment?.excerpt ?? "",
        sourceFragmentId: primaryFragment?.id ?? "",
        preferredLotLabel: input.preferredLotLabel,
      }),
      metadata: {
        model: null,
        prompt_version: GENERATED_OUVRAGE_PROMPT_VERSION,
        used_fallback: true,
        token_count: null,
        cost_cents: null,
        duration_ms: null,
        summary: "Fallback heuristique utilise.",
        failure_message: error instanceof Error ? error.message : "Generation indisponible.",
      } satisfies JsonRecord,
    };
  }
}

function sanitizePromptCandidates(input: {
  promptCandidates: GeneratedOuvragePromptCandidate[];
  fragments: GeneratedOuvrageSourceFragmentRow[];
  preferredLotId: string | null;
  preferredLotLabel: string | null;
}) {
  const fragmentIdSet = new Set(input.fragments.map((fragment) => fragment.id));
  const primaryFragmentId = input.fragments[0]?.id ?? null;
  const seen = new Set<string>();

  return input.promptCandidates
    .map((candidate, index) => {
      const designation = normalizeText(candidate.designation, 500);
      if (!designation) return null;

      const normalizedDesignation = normalizeDesignation(designation);
      if (seen.has(normalizedDesignation)) {
        return null;
      }
      seen.add(normalizedDesignation);

      const sourceFragmentIds = candidate.sourceFragmentIds.filter((fragmentId) =>
        fragmentIdSet.has(fragmentId)
      );

      if (sourceFragmentIds.length === 0 && primaryFragmentId) {
        sourceFragmentIds.push(primaryFragmentId);
      }

      return {
        candidateOrder: index,
        designation,
        normalizedDesignation,
        lotLabel: toNullableText(candidate.lotLabel) ?? input.preferredLotLabel,
        suggestedLotId: input.preferredLotId,
        unit: toNullableText(candidate.unit)?.slice(0, 64) ?? null,
        quantity:
          typeof candidate.quantity === "number" && Number.isFinite(candidate.quantity)
            ? toStoredEstimateNumeric(candidate.quantity, 3)
            : null,
        confidence: clampConfidence(candidate.confidence),
        aiStatus: candidate.status,
        reasoning: toNullableText(candidate.reasoning)?.slice(0, 320) ?? null,
        sourceFragmentIds,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
    .slice(0, MAX_CANDIDATES);
}

function buildDraftSummary(
  candidates: Pick<GeneratedOuvrageCandidateRow, "ai_status" | "resolution_status">[]
) {
  return candidates.reduce<GeneratedOuvrageDraftSummary>(
    (summary, candidate) => {
      summary.totalCandidates += 1;
      if (candidate.ai_status === "certain") summary.certainCount += 1;
      if (candidate.ai_status === "plausible") summary.plausibleCount += 1;
      if (candidate.ai_status === "question") summary.questionCount += 1;
      if (candidate.resolution_status === "pending") summary.pendingCount += 1;
      if (candidate.resolution_status === "inserted") summary.insertedCount += 1;
      if (candidate.resolution_status === "rejected") summary.rejectedCount += 1;
      return summary;
    },
    {
      totalCandidates: 0,
      certainCount: 0,
      plausibleCount: 0,
      questionCount: 0,
      pendingCount: 0,
      insertedCount: 0,
      rejectedCount: 0,
    }
  );
}

function deriveDraftStatus(input: {
  candidates: GeneratedOuvrageCandidateRow[];
  applications: GeneratedOuvrageApplicationRow[];
}): GeneratedOuvrageDraftStatus {
  const pendingCount = input.candidates.filter(
    (candidate) => candidate.resolution_status === "pending"
  ).length;

  if (input.applications.length === 0) {
    return pendingCount === 0 ? "discarded" : "pending";
  }

  return pendingCount === 0 ? "applied" : "partially_applied";
}

async function updateDraftProjection(input: {
  supabase: Supabase;
  draft: GeneratedOuvrageDraftRow;
  candidates: GeneratedOuvrageCandidateRow[];
  applications: GeneratedOuvrageApplicationRow[];
  generationMetadata?: JsonRecord;
}) {
  const summary = buildDraftSummary(input.candidates);
  const nextStatus = deriveDraftStatus({
    candidates: input.candidates,
    applications: input.applications,
  });

  const payload: Record<string, unknown> = {
    status: nextStatus,
    summary: toJson(summary),
    applied_at:
      nextStatus === "applied" || nextStatus === "partially_applied"
        ? input.draft.applied_at ?? new Date().toISOString()
        : null,
  };

  if (input.generationMetadata) {
    payload.generation_metadata = toJson(input.generationMetadata);
  }

  const { data, error } = await input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update(payload as never)
    .eq("id", input.draft.id)
    .select("*" as never)
    .single();

  if (error || !data) {
    throw mapSupabaseError(error, "Impossible de mettre à jour le brouillon d'ouvrages.");
  }

  return data as GeneratedOuvrageDraftRow;
}

async function logEstimateVersionEventIfPossible(input: {
  versionId: string;
  eventType:
    | "generated_ouvrage_draft_created"
    | "generated_ouvrage_inserted"
    | "generated_ouvrage_discarded";
  actorUserId: string | null;
  metadata: JsonRecord;
}) {
  try {
    const rpcClient = createServiceRoleClient();
    const { error } = await rpcClient.rpc("log_estimate_version_event", {
      p_estimate_version_id: input.versionId,
      p_event_type: input.eventType,
      p_created_by: input.actorUserId,
      p_metadata: toJson(input.metadata),
      p_occurred_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Failed to log generated ouvrage event", {
        versionId: input.versionId,
        eventType: input.eventType,
        error,
      });
    }
  } catch (error) {
    console.error("Failed to initialize service-role event logging", {
      versionId: input.versionId,
      eventType: input.eventType,
      error,
    });
  }
}

function roundQuantity(value: number | null | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return 0;
  }

  return toStoredEstimateNumeric(Number(value), 3);
}

async function loadPreferredGeneratedOuvrageLaborRole(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}): Promise<{
  id: string;
  name: string;
  hourlyRateCents: number;
  position: number;
  isActive: true;
} | null> {
  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id, name, hourly_rate_cents, position, is_active")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.ownerUserId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true })
    .limit(1);

  if (error || !Array.isArray(data)) throw generatedOuvrageReadUnavailable();
  if (data.length === 0) {
    return null;
  }

  const role = data[0] as LaborRoleSummaryRow;
  return {
    id: role.id,
    name: role.name,
    hourlyRateCents: role.hourly_rate_cents,
    position: role.position,
    isActive: true,
  };
}

function buildGeneratedOuvrageEstimateItemMapping(input: {
  components: GeneratedOuvrageSubdetailComponent[];
  parentQuantity: number;
  laborRole: {
    id: string;
    name: string;
    hourlyRateCents: number;
  } | null;
}): GeneratedOuvrageEstimateItemMapping {
  const breakdownByType = new Map<
    GeneratedOuvrageSubdetailCostType,
    GeneratedOuvrageEstimateItemCostBreakdown
  >();
  const laborTrace: GeneratedOuvrageEstimateItemLaborTrace[] = [];

  for (const component of input.components) {
    if (component.status === "rejected") continue;
    const current = breakdownByType.get(component.costType);
    const nextEntry: GeneratedOuvrageEstimateItemCostBreakdown = {
      costType: component.costType,
      componentCount: (current?.componentCount ?? 0) + 1,
      quantity: roundQuantity((current?.quantity ?? 0) + Math.max(component.quantity, 0)),
      dsCents: (current?.dsCents ?? 0) + Math.max(component.dsCents, 0),
    };
    breakdownByType.set(component.costType, nextEntry);

    if (component.costType !== "labor") {
      continue;
    }

    const { derivedHours, hoursSource } = deriveGeneratedOuvrageLaborHours({
      component,
      parentQuantity: input.parentQuantity,
    });

    laborTrace.push({
      componentId: component.componentId,
      designation: component.designation,
      unit: component.unit,
      quantity: roundQuantity(component.quantity),
      derivedHours,
      hoursSource,
      dsCents: Math.max(component.dsCents, 0),
    });
  }

  const costBreakdown = Array.from(breakdownByType.values());
  const totalDsCents = costBreakdown.reduce((total, entry) => total + entry.dsCents, 0);
  const laborDsCents =
    costBreakdown.find((entry) => entry.costType === "labor")?.dsCents ?? 0;
  const nonLaborDsCents = Math.max(totalDsCents - laborDsCents, 0);
  const hMo = roundQuantity(
    laborTrace.reduce((total, entry) => total + entry.derivedHours, 0)
  );
  const unitPriceHtCents =
    input.parentQuantity > 0
      ? Math.round(totalDsCents / input.parentQuantity)
      : totalDsCents;

  if (laborTrace.length === 0) {
    return {
      source: "generated_ouvrage_subdetail_review",
      mode: "no_labor",
      unitPriceHtCents,
      hMo: 0,
      kFo: 1,
      kMo: 1,
      laborRoleId: null,
      laborRoleName: null,
      laborRoleHourlyRateCents: null,
      totalDsCents,
      nonLaborDsCents,
      laborDsCents,
      costBreakdown,
      laborTrace,
    };
  }

  if (input.laborRole) {
    const foBaseCents =
      input.parentQuantity > 0 ? input.parentQuantity * unitPriceHtCents : unitPriceHtCents;
    const moBaseCents = hMo * input.laborRole.hourlyRateCents;

    return {
      source: "generated_ouvrage_subdetail_review",
      mode: input.laborRole.hourlyRateCents > 0 ? "legacy_labor_allocated" : "labor_hours_role_without_rate",
      unitPriceHtCents,
      hMo,
      kFo: foBaseCents > 0 ? nonLaborDsCents / foBaseCents : 0,
      kMo: moBaseCents > 0 ? laborDsCents / moBaseCents : 0,
      laborRoleId: input.laborRole.id,
      laborRoleName: input.laborRole.name,
      laborRoleHourlyRateCents: input.laborRole.hourlyRateCents,
      totalDsCents,
      nonLaborDsCents,
      laborDsCents,
      costBreakdown,
      laborTrace,
    };
  }

  return {
    source: "generated_ouvrage_subdetail_review",
    mode: "labor_hours_only",
    unitPriceHtCents,
    hMo,
    kFo: 1,
    kMo: 0,
    laborRoleId: null,
    laborRoleName: null,
    laborRoleHourlyRateCents: null,
    totalDsCents,
    nonLaborDsCents,
    laborDsCents,
    costBreakdown,
    laborTrace,
  };
}

function readJsonStringArray(value: Json | unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toNullableText(entry))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);
}

function normalizeRiskSignals(value: unknown): GeneratedOuvrageRiskSignal[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return null;
      }

      const label = toNullableText(
        typeof entry.label === "string" ? entry.label : null
      );
      const severity =
        typeof entry.severity === "string" &&
        ["info", "warning", "critical"].includes(entry.severity)
          ? (entry.severity as GeneratedOuvrageRiskSignalSeverity)
          : null;
      const basis =
        typeof entry.basis === "string" &&
        ["fact", "hypothesis", "inference"].includes(entry.basis)
          ? (entry.basis as GeneratedOuvrageEvidenceKind)
          : null;

      if (!label || !severity || !basis) {
        return null;
      }

      return { label, severity, basis } satisfies GeneratedOuvrageRiskSignal;
    })
    .filter((entry): entry is GeneratedOuvrageRiskSignal => entry !== null)
    .slice(0, 8);
}

function formatConfidenceLabel(value: number) {
  const percent = Math.round(clampConfidence(value) * 100);
  if (percent >= 80) return "elevee";
  if (percent >= 55) return "moyenne";
  return "faible";
}

function computeComponentDsCents(input: {
  quantity: number;
  unitCostHtCents: number;
  lossCoeffBp: number;
}) {
  const effectiveQuantity = Math.max(input.quantity, 0);
  const effectiveUnitCost = Math.max(input.unitCostHtCents, 0);
  const lossMultiplier = 1 + Math.max(input.lossCoeffBp, 0) / 10_000;
  return Math.round(effectiveQuantity * effectiveUnitCost * lossMultiplier);
}

function mapSubdetailSource(
  fragment: GeneratedOuvrageSourceFragmentRow,
  evidenceKind: GeneratedOuvrageEvidenceKind,
  note: string | null
): GeneratedOuvrageSubdetailSource {
  return {
    sourceFragmentId: fragment.id,
    sourceDocumentId: fragment.source_document_id,
    type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
    label: fragment.label,
    excerpt: fragment.excerpt,
    sourceFileName: fragment.source_file_name,
    sourcePageFrom: fragment.source_page_from,
    sourcePageTo: fragment.source_page_to,
    selectionLabel: fragment.selection_label,
    evidenceKind,
    note,
  };
}

function mapCandidateSourceToSubdetailSource(
  source: GeneratedOuvrageCandidateSource,
  evidenceKind: GeneratedOuvrageEvidenceKind,
  note: string | null
): GeneratedOuvrageSubdetailSource {
  return {
    ...source,
    evidenceKind,
    note,
  };
}

function keywordCostProfile(designation: string) {
  const normalized = normalizeDesignation(designation);

  const profiles = [
    {
      pattern: /(beton|dalle|gros oeuvre|maconnerie|cloison|mur)/,
      material: 4200,
      labor: 1600,
      equipment: 450,
      lossCoeffBp: 600,
      yieldValue: 1.25,
      yieldUnit: "h/" + "u",
    },
    {
      pattern: /(faux plafond|plafond|isolation|placo|plaque)/,
      material: 2600,
      labor: 1350,
      equipment: 180,
      lossCoeffBp: 800,
      yieldValue: 0.45,
      yieldUnit: "h/m2",
    },
    {
      pattern: /(peinture|enduit|facade|revetement|sol)/,
      material: 1800,
      labor: 1100,
      equipment: 120,
      lossCoeffBp: 500,
      yieldValue: 0.22,
      yieldUnit: "h/m2",
    },
    {
      pattern: /(reseau|cable|canalisation|electrique|plomberie|ventilation)/,
      material: 3100,
      labor: 1700,
      equipment: 220,
      lossCoeffBp: 400,
      yieldValue: 0.8,
      yieldUnit: "h/ml",
    },
  ] as const;

  return (
    profiles.find((profile) => profile.pattern.test(normalized)) ?? {
      material: 2400,
      labor: 1400,
      equipment: 150,
      lossCoeffBp: 500,
      yieldValue: 0.5,
      yieldUnit: "h/u",
    }
  );
}

function buildGeneratedOuvrageRiskSignals(input: {
  candidate: GeneratedOuvrageCandidateRow;
  sources: GeneratedOuvrageCandidateSource[];
  profileSourceKinds: GeneratedOuvrageSourceFragmentRow["source_kind"][];
  quantity: number | null;
}) {
  const signals: GeneratedOuvrageRiskSignal[] = [];

  if (input.candidate.ai_status === "question") {
    signals.push({
      label: "L'ouvrage parent reste à clarifier avant chiffrage final.",
      severity: "critical",
      basis: "hypothesis",
    });
  } else if (input.candidate.ai_status === "plausible") {
    signals.push({
      label: "Le sous-detail repose sur une interpretation plausible à confirmer.",
      severity: "warning",
      basis: "hypothesis",
    });
  }

  if (input.quantity === null) {
    signals.push({
      label: "Quantité parent absente: le coût reste indicatif.",
      severity: "warning",
      basis: "hypothesis",
    });
  }

  if (!input.profileSourceKinds.includes("history")) {
    signals.push({
      label: "Aucun historique proche n'a été rattaché au sous-detail.",
      severity: "info",
      basis: "inference",
    });
  }

  if (!input.profileSourceKinds.includes("library")) {
    signals.push({
      label: "Aucune bibliotheque interne exploitable n'a été confirmée.",
      severity: "info",
      basis: "hypothesis",
    });
  }

  if (input.sources.length === 0) {
    signals.push({
      label: "Provenance faible: aucune source exploitable sur le candidat.",
      severity: "critical",
      basis: "fact",
    });
  }

  return signals.slice(0, 8);
}

function dedupeRiskSignals(signals: GeneratedOuvrageRiskSignal[]) {
  const deduped = new Map<string, GeneratedOuvrageRiskSignal>();
  for (const signal of signals) {
    deduped.set(`${signal.severity}:${signal.basis}:${signal.label}`, signal);
  }
  return Array.from(deduped.values());
}

function buildGeneratedOuvrageSubdetailSummary(input: {
  components: GeneratedOuvrageSubdetailComponent[];
  marginMultiplier: number | null;
}): GeneratedOuvrageSubdetailSummary {
  const retainedComponents = input.components.filter((component) => component.status !== "rejected");
  const dsCents = retainedComponents.reduce(
    (total, component) => total + component.dsCents,
    0
  );
  const confidence =
    retainedComponents.length === 0
      ? 0.5
      : retainedComponents.reduce((total, component) => total + component.confidence, 0) /
        retainedComponents.length;
  const marginMultiplier =
    typeof input.marginMultiplier === "number" && Number.isFinite(input.marginMultiplier)
      ? Math.max(input.marginMultiplier, 1)
      : 1;
  const facts = Array.from(
    new Set(retainedComponents.flatMap((component) => component.facts))
  ).slice(0, 8);
  const hypotheses = Array.from(
    new Set(retainedComponents.flatMap((component) => component.hypotheses))
  ).slice(0, 8);
  const inferences = Array.from(
    new Set(retainedComponents.flatMap((component) => component.inferences))
  ).slice(0, 8);
  const riskSignals = dedupeRiskSignals(
    retainedComponents.flatMap((component) => component.riskSignals)
  ).slice(0, 8);

  return {
    componentCount: retainedComponents.length,
    dsCents,
    indicativeTargetPriceCents: Math.round(dsCents * marginMultiplier),
    confidence: clampConfidence(confidence),
    pricingSource: "heuristic_review_draft",
    riskSignals,
    facts,
    hypotheses,
    inferences,
  };
}

function inferLaborQuantity(input: {
  unit: string | null;
  parentQuantity: number | null;
  yieldValue: number | null;
}) {
  const unit = toNullableText(input.unit)?.toLowerCase();
  if (input.yieldValue && input.parentQuantity !== null) {
    return multiplyToStoredEstimateNumeric(toStoredEstimateNumeric(input.parentQuantity, 3), toStoredEstimateNumeric(input.yieldValue, 3), 3);
  }

  if (unit === "m2" || unit === "m3" || unit === "ml" || unit === "m") {
    return 1;
  }

  return input.parentQuantity !== null
    ? Math.max(multiplyToStoredEstimateNumeric(toStoredEstimateNumeric(input.parentQuantity, 3), 0.25, 3), 1)
    : 1;
}

function generateInitialSubdetailComponents(input: {
  candidate: GeneratedOuvrageCandidateRow;
  candidateSources: GeneratedOuvrageCandidateSource[];
  draftFragments: GeneratedOuvrageSourceFragmentRow[];
  marginMultiplier: number | null;
}): {
  components: GeneratedOuvrageSubdetailComponent[];
  generationMetadata: JsonRecord;
} {
  const profile = keywordCostProfile(input.candidate.designation);
  const quantity = input.candidate.quantity ?? 1;
  const effectiveUnit = toNullableText(input.candidate.unit) ?? "u";
  const fragmentById = new Map(
    input.draftFragments.map((fragment) => [fragment.id, fragment] as const)
  );
  const extraReferenceFragments = input.draftFragments.filter(
    (fragment) =>
      fragment.source_kind === "history" || fragment.source_kind === "library"
  );
  const candidateSourceFragments = input.candidateSources
    .map((source) => fragmentById.get(source.sourceFragmentId))
    .filter((fragment): fragment is GeneratedOuvrageSourceFragmentRow => Boolean(fragment));
  const profileSourceKinds = Array.from(
    new Set(
      [...candidateSourceFragments, ...extraReferenceFragments].map(
        (fragment) => fragment.source_kind
      )
    )
  );
  const sharedRiskSignals = buildGeneratedOuvrageRiskSignals({
    candidate: input.candidate,
    sources: input.candidateSources,
    profileSourceKinds,
    quantity: input.candidate.quantity,
  });

  const materialSources = [
    ...input.candidateSources.map((source) =>
      mapCandidateSourceToSubdetailSource(
        source,
        "fact",
        "Source primaire du besoin parent"
      )
    ),
    ...extraReferenceFragments.slice(0, 1).map((fragment) =>
      mapSubdetailSource(
        fragment,
        fragment.source_kind === "history" ? "inference" : "hypothesis",
        fragment.source_kind === "history"
          ? "Historique interne de référence"
          : "Bibliotheque interne de référence"
      )
    ),
  ].slice(0, 6);

  const laborYieldValue = profile.yieldUnit.startsWith("h/") ? profile.yieldValue : 0.5;
  const laborQuantity = inferLaborQuantity({
    unit: effectiveUnit,
    parentQuantity: input.candidate.quantity,
    yieldValue: laborYieldValue,
  });

  const components: GeneratedOuvrageSubdetailComponent[] = [
    {
      componentId: randomUUID(),
      status: "suggested",
      rejectedFromStatus: null,
      costType: "material",
      designation: input.candidate.designation,
      unit: effectiveUnit,
      quantity: roundQuantity(quantity),
      unitCostHtCents: profile.material,
      lossCoeffBp: profile.lossCoeffBp,
      yieldValue: null,
      yieldUnit: null,
      confidence: clampConfidence(input.candidate.confidence),
      sourceLabel: materialSources[0]?.label ?? "Source parent",
      dsCents: computeComponentDsCents({
        quantity: roundQuantity(quantity),
        unitCostHtCents: profile.material,
        lossCoeffBp: profile.lossCoeffBp,
      }),
      facts: [
        `Ouvrage parent: ${input.candidate.designation}`,
        input.candidate.quantity !== null
          ? `Quantité parent: ${input.candidate.quantity} ${effectiveUnit}`
          : `Unité parent: ${effectiveUnit}`,
      ],
      hypotheses: [
        "Coût materiau indicatif estime par heuristique métier à confirmer.",
      ],
      inferences: [
        `Confiance parent ${formatConfidenceLabel(input.candidate.confidence)} (${Math.round(
          input.candidate.confidence * 100
        )}%).`,
      ],
      riskSignals: sharedRiskSignals,
      sources: materialSources,
    },
    {
      componentId: randomUUID(),
      status: "suggested",
      rejectedFromStatus: null,
      costType: "labor",
      designation: `Main d'oeuvre - ${input.candidate.designation}`,
      unit: "h",
      quantity: laborQuantity,
      unitCostHtCents: profile.labor,
      lossCoeffBp: 0,
      yieldValue: profile.yieldValue,
      yieldUnit: profile.yieldUnit,
      confidence: clampConfidence(input.candidate.confidence - 0.05),
      sourceLabel: candidateSourceFragments[0]?.label ?? "Inference métier",
      dsCents: computeComponentDsCents({
        quantity: laborQuantity,
        unitCostHtCents: profile.labor,
        lossCoeffBp: 0,
      }),
      facts: input.candidate.quantity !== null
        ? [`Quantité parent exploitee pour la MO: ${input.candidate.quantity} ${effectiveUnit}`]
        : [],
      hypotheses: [
        "Rendement MO estime à partir du type d'ouvrage et doit être validé.",
      ],
      inferences: [
        `Présence de "${input.candidate.designation}" interpretee comme besoin de pose / execution.`,
      ],
      riskSignals: sharedRiskSignals,
      sources: [
        ...input.candidateSources.slice(0, 1).map((source) =>
          mapCandidateSourceToSubdetailSource(
            source,
            "inference",
            "Rendement deduit du texte parent"
          )
        ),
        ...extraReferenceFragments.slice(0, 1).map((fragment) =>
          mapSubdetailSource(
            fragment,
            "hypothesis",
            "Référence interne utilisee pour le rendement"
          )
        ),
      ],
    },
  ];

  if (profile.equipment > 0) {
    components.push({
      componentId: randomUUID(),
      status: "suggested",
      rejectedFromStatus: null,
      costType: "equipment",
      designation: `Matériel de pose - ${input.candidate.designation}`,
      unit: effectiveUnit === "u" ? "u" : effectiveUnit,
      quantity: roundQuantity(Math.max(quantity * 0.05, 1)),
      unitCostHtCents: profile.equipment,
      lossCoeffBp: 0,
      yieldValue: null,
      yieldUnit: null,
      confidence: clampConfidence(input.candidate.confidence - 0.12),
      sourceLabel: extraReferenceFragments[0]?.label ?? "Hypothèse de pose",
      dsCents: computeComponentDsCents({
        quantity: roundQuantity(Math.max(quantity * 0.05, 1)),
        unitCostHtCents: profile.equipment,
        lossCoeffBp: 0,
      }),
      facts: [],
      hypotheses: [
        "Matériel de pose ajoute à titre indicatif pour couvrir les moyens d'execution.",
      ],
      inferences: [
        "Equipement deduit du type d'ouvrage, sans pricebook confirme.",
      ],
      riskSignals: sharedRiskSignals,
      sources: extraReferenceFragments.slice(0, 1).map((fragment) =>
        mapSubdetailSource(
          fragment,
          "hypothesis",
          "Référence interne indicative"
        )
      ),
    });
  }

  return {
    components,
    generationMetadata: {
      generator: "heuristic_est383_v1",
      based_on_candidate_confidence: input.candidate.confidence,
      source_fragment_kinds: profileSourceKinds,
      component_count: components.length,
      margin_multiplier: input.marginMultiplier ?? null,
    },
  };
}

function mapSubdetailRowsToResult(input: {
  reviewToken: string;
  draft: GeneratedOuvrageSubdetailDraftRow;
  items: GeneratedOuvrageSubdetailItemRow[];
  itemSources: GeneratedOuvrageSubdetailItemSourceRow[];
  fragments: GeneratedOuvrageSourceFragmentRow[];
}): GeneratedOuvrageSubdetailResult {
  const fragmentById = new Map(
    input.fragments.map((fragment) => [fragment.id, fragment] as const)
  );
  const sourcesByComponentId = new Map<string, GeneratedOuvrageSubdetailItemSourceRow[]>();

  for (const row of input.itemSources) {
    const current = sourcesByComponentId.get(row.component_id);
    if (current) {
      current.push(row);
    } else {
      sourcesByComponentId.set(row.component_id, [row]);
    }
  }

  const components = input.items
    .sort((left, right) => left.component_order - right.component_order)
    .map((item) => {
      const quantity = roundQuantity(item.quantity);
      const unitCostHtCents = Math.max(item.unit_cost_ht_cents, 0);
      const metadata = typeof item.metadata === "object" && item.metadata !== null
        ? item.metadata as JsonRecord : {};
      const rejectionOrigin = metadata.rejected_from_status;
      if (rejectionOrigin !== undefined && rejectionOrigin !== null &&
        rejectionOrigin !== "suggested" && rejectionOrigin !== "manual") {
        throw generatedOuvrageReadUnavailable();
      }
      return {
        componentId: item.id,
        status: item.status,
        rejectedFromStatus: item.status === "rejected" ? rejectionOrigin ?? null : null,
        costType: item.cost_type,
        designation: item.designation,
        unit: item.unit,
        quantity,
        unitCostHtCents,
        lossCoeffBp: item.loss_coeff_bp,
        yieldValue: item.yield_value,
        yieldUnit: item.yield_unit,
        confidence: clampConfidence(item.confidence),
        sourceLabel: item.source_label,
        dsCents: computeComponentDsCents({
          quantity,
          unitCostHtCents,
          lossCoeffBp: item.loss_coeff_bp,
        }),
        facts: readJsonStringArray(item.facts),
        hypotheses: readJsonStringArray(item.hypotheses),
        inferences: readJsonStringArray(item.inferences),
        riskSignals: normalizeRiskSignals(
          typeof item.metadata === "object" && item.metadata !== null
            ? (item.metadata as JsonRecord).risk_signals
            : null
        ),
        sources: (sourcesByComponentId.get(item.id) ?? [])
          .sort((left, right) => left.source_rank - right.source_rank)
          .map((row) => {
            const fragment = fragmentById.get(row.source_fragment_id);
            if (!fragment) {
              return null;
            }

            return mapSubdetailSource(
              fragment,
              row.evidence_kind,
              row.note
            );
          })
          .filter(
            (source): source is GeneratedOuvrageSubdetailSource => Boolean(source)
          ),
      } satisfies GeneratedOuvrageSubdetailComponent;
    });

  const summaryRecord =
    typeof input.draft.summary === "object" && input.draft.summary !== null
      ? (input.draft.summary as JsonRecord)
      : {};
  const computedSummary = buildGeneratedOuvrageSubdetailSummary({
    components,
    marginMultiplier:
      typeof summaryRecord.margin_multiplier === "number"
        ? summaryRecord.margin_multiplier
        : null,
  });

  return {
    reviewToken: input.reviewToken,
    draftId: input.draft.draft_id,
    candidateId: input.draft.parent_work_id,
    versionId: input.draft.target_version_id,
    projectId: input.draft.project_id,
    status: input.draft.status,
    humanValidationRequired: true,
    generatedAt: input.draft.created_at,
    updatedAt: input.draft.updated_at,
    summary: {
      ...computedSummary,
      pricingSource:
        toNullableText(
          typeof summaryRecord.pricing_source === "string"
            ? summaryRecord.pricing_source
            : null
        ) ?? computedSummary.pricingSource,
    },
    components,
  };
}

async function loadGeneratedOuvrageDraftOrThrow(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  draftId: string;
}): Promise<DraftLoaded> {
  const [draftResult, fragmentResult, candidateResult, candidateSourceResult, applicationResult] =
    (await Promise.all([
      input.supabase
        .from("estimate_generated_ouvrage_drafts" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("target_version_id", input.versionId)
        .eq("id", input.draftId)
        .single(),
      input.supabase
        .from("estimate_generated_ouvrage_source_fragments" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("fragment_order", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_candidates" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("candidate_order", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_candidate_sources" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("source_rank", { ascending: true }),
      input.supabase
        .from("estimate_generated_ouvrage_applications" as never)
        .select("*" as never)
        .eq("tenant_id", input.tenantId)
        .eq("draft_id", input.draftId)
        .order("created_at", { ascending: true }),
    ])) as [
      { data: unknown; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
      { data: unknown[] | null; error: { message?: string; code?: string } | null },
    ];

  if (draftResult.error || !draftResult.data) {
    if (draftResult.error) {
      throw mapSupabaseError(
        draftResult.error as never,
        "Impossible de charger le brouillon d'ouvrages."
      );
    }
    throw notFound("Brouillon d'ouvrages introuvable.");
  }

  if (fragmentResult.error) {
    throw mapSupabaseError(
      fragmentResult.error as never,
      "Impossible de charger les fragments sources du brouillon."
    );
  }

  if (candidateResult.error) {
    throw mapSupabaseError(
      candidateResult.error as never,
      "Impossible de charger les candidats d'ouvrages."
    );
  }

  if (candidateSourceResult.error) {
    throw mapSupabaseError(
      candidateSourceResult.error as never,
      "Impossible de charger les rattachements source des candidats."
    );
  }

  if (applicationResult.error) {
    throw mapSupabaseError(
      applicationResult.error as never,
      "Impossible de charger les applications du brouillon."
    );
  }

  return {
    draft: draftResult.data as GeneratedOuvrageDraftRow,
    fragments: (fragmentResult.data ?? []) as GeneratedOuvrageSourceFragmentRow[],
    candidates: (candidateResult.data ?? []) as GeneratedOuvrageCandidateRow[],
    candidateSources: (candidateSourceResult.data ?? []) as GeneratedOuvrageCandidateSourceRow[],
    applications: (applicationResult.data ?? []) as GeneratedOuvrageApplicationRow[],
  };
}

function normalizeDraftResult(loaded: DraftLoaded): GeneratedOuvrageDraftResult {
  const fragmentById = new Map(
    loaded.fragments.map((fragment) => [fragment.id, fragment] as const)
  );
  const sourceRowsByCandidateId = new Map<string, GeneratedOuvrageCandidateSourceRow[]>();

  for (const row of loaded.candidateSources) {
    const current = sourceRowsByCandidateId.get(row.candidate_id);
    if (current) {
      current.push(row);
    } else {
      sourceRowsByCandidateId.set(row.candidate_id, [row]);
    }
  }

  const summary = buildDraftSummary(loaded.candidates);
  const appliedValuesByCandidateId = new Map(
    loaded.applications.map((application) => {
      const reviewed = readReviewedCandidateSnapshot(application.applied_payload);
      const payload = application.applied_payload as JsonRecord | null;
      return [
        application.candidate_id,
        reviewed
          ? {
              ...reviewed,
              lotId: toNullableText(payload?.resolved_lot_id ?? payload?.lot_id),
            }
          : null,
      ] as const;
    })
  );

  return {
    draftId: loaded.draft.id,
    versionId: loaded.draft.target_version_id,
    projectId: loaded.draft.project_id,
    sourceKind: loaded.draft.source_kind,
    preferredLotId: loaded.draft.preferred_lot_id,
    status: loaded.draft.status,
    summary,
    generatedAt: loaded.draft.created_at,
    candidates: loaded.candidates.map((candidate) => ({
      candidateId: candidate.id,
      suggestedLotId: candidate.suggested_lot_id,
      lotLabel: candidate.lot_label,
      designation: candidate.designation,
      unit: candidate.unit,
      quantity: candidate.quantity,
      confidence: clampConfidence(candidate.confidence),
      status: candidate.ai_status,
      resolutionStatus: candidate.resolution_status,
      appliedValues:
        candidate.resolution_status === "inserted"
          ? appliedValuesByCandidateId.get(candidate.id) ?? null
          : null,
      reasoning: candidate.reasoning,
      sources: (sourceRowsByCandidateId.get(candidate.id) ?? [])
        .sort((left, right) => left.source_rank - right.source_rank)
        .map((row) => fragmentById.get(row.source_fragment_id))
        .filter(
          (fragment): fragment is GeneratedOuvrageSourceFragmentRow => Boolean(fragment)
        )
        .map((fragment) => ({
          sourceFragmentId: fragment.id,
          sourceDocumentId: fragment.source_document_id,
          type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
          label: fragment.label,
          excerpt: fragment.excerpt,
          sourceFileName: fragment.source_file_name,
          sourcePageFrom: fragment.source_page_from,
          sourcePageTo: fragment.source_page_to,
          selectionLabel: fragment.selection_label,
        })),
    })),
  };
}

type GeneratedOuvrageReviewSnapshot = {
  draft: GeneratedOuvrageDraftRow;
  candidate: GeneratedOuvrageCandidateRow;
  subdetailDraft: GeneratedOuvrageSubdetailDraftRow | null;
  items: GeneratedOuvrageSubdetailItemRow[];
  itemSources: GeneratedOuvrageSubdetailItemSourceRow[];
  candidateSources: GeneratedOuvrageCandidateSourceRow[];
  fragments: GeneratedOuvrageSourceFragmentRow[];
  reviewToken: string | null;
};

async function readGeneratedOuvrageReview(context: AuthenticatedContext, input: {
  versionId: string; draftId: string; candidateId: string;
}): Promise<GeneratedOuvrageReviewSnapshot> {
  let response;
  try {
    response = await context.supabase.rpc("read_generated_ouvrage_review", {
      p_version_id: input.versionId, p_draft_id: input.draftId, p_candidate_id: input.candidateId,
    });
  } catch { throw generatedOuvrageReadUnavailable(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, false);
  return parseGeneratedOuvrageReview(response.data, { ...input, tenantId: context.tenantId,
    actorId: context.userId }) as unknown as GeneratedOuvrageReviewSnapshot;
}

function reviewedResult(snapshot: GeneratedOuvrageReviewSnapshot) {
  if (!snapshot.subdetailDraft || !snapshot.reviewToken) throw generatedOuvrageReadUnavailable();
  return {
    ...mapSubdetailRowsToResult({ draft: snapshot.subdetailDraft, reviewToken: snapshot.reviewToken,
      items: snapshot.items, itemSources: snapshot.itemSources, fragments: snapshot.fragments }),
    reviewedCandidate: readReviewedCandidateSnapshot(
      (snapshot.subdetailDraft.generation_metadata as JsonRecord | null)?.reviewed_candidate
    ) ?? normalizeReviewedCandidateSnapshot(snapshot.candidate),
  };
}

async function persistGeneratedOuvrageSubdetail(input: {
  context: AuthenticatedContext; versionId: string; draftId: string; candidateId: string;
  draftLockSessionId: string; expectedReviewToken: string | null;
  status: "pending_review" | "reviewed"; summary: GeneratedOuvrageSubdetailSummary;
  generationMetadata: JsonRecord; components: UpdateGeneratedOuvrageSubdetailInput["components"];
}) {
  const summary = { component_count: input.summary.componentCount, ds_cents: input.summary.dsCents,
    indicative_target_price_cents: input.summary.indicativeTargetPriceCents, confidence: input.summary.confidence,
    pricing_source: input.summary.pricingSource, risk_signals: input.summary.riskSignals,
    facts: input.summary.facts, hypotheses: input.summary.hypotheses, inferences: input.summary.inferences,
    margin_multiplier: input.generationMetadata.margin_multiplier ?? null };
  let response;
  try {
    response = await input.context.supabase.rpc("persist_generated_ouvrage_review", {
      p_version_id: input.versionId, p_draft_id: input.draftId, p_candidate_id: input.candidateId,
      p_draft_lock_session_id: input.draftLockSessionId, p_expected_review_token: input.expectedReviewToken,
      p_review: { status: input.status, summary, generation_metadata: input.generationMetadata,
        components: input.components } as Json,
    });
  } catch { throw generatedOuvrageOutcomeUnknown(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, true);
  try {
    return parseGeneratedOuvrageReview(response.data, { versionId: input.versionId, draftId: input.draftId,
      candidateId: input.candidateId, tenantId: input.context.tenantId,
      actorId: input.context.userId }) as unknown as GeneratedOuvrageReviewSnapshot;
  } catch { throw generatedOuvrageOutcomeUnknown(); }
}

export async function generateOuvragesFromText(
  input: GenerateGeneratedOuvrageInput
): Promise<GeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageGenerateInputSchema.parse({
    ...input,
    sourceText: normalizeMultilineText(input.sourceText, MAX_SOURCE_TEXT_LENGTH),
    sourceFileName: input.sourceFileName
      ? normalizeText(input.sourceFileName, MAX_SOURCE_FILE_NAME_LENGTH)
      : null,
    selectionLabel: input.selectionLabel
      ? normalizeText(input.selectionLabel, MAX_SELECTION_LABEL_LENGTH)
      : null,
  });

  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  if (project.id !== parsed.projectId) {
    throw notFound("Affaire introuvable.");
  }

  assertDraftStatus(version.status);
  await assertDraftLockSessionOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
    draftLockSessionId: parsed.draftLockSessionId,
  });

  const preferredLotLabel = parsed.preferredLotId
    ? await loadLotLabel({
        supabase,
        tenantId,
        versionId: parsed.versionId,
        lotId: parsed.preferredLotId,
      })
    : null;

  const { data: draftData, error: draftError } = await supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .insert({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      target_version_id: parsed.versionId,
      created_by: userId,
      source_kind: parsed.sourceKind,
      preferred_lot_id: parsed.preferredLotId ?? null,
      status: "pending",
      summary: {},
      generation_metadata: {},
    } as never)
    .select("*" as never)
    .single();

  if (draftError || !draftData) {
    throw mapSupabaseError(draftError, "Impossible de créer le brouillon d'ouvrages.");
  }

  const draft = draftData as GeneratedOuvrageDraftRow;
  let fragments: GeneratedOuvrageSourceFragmentRow[] = [];
  let candidates: GeneratedOuvrageCandidateRow[] = [];
  let sourceLinkRows: Array<{
    tenant_id: string;
    draft_id: string;
    candidate_id: string;
    source_fragment_id: string;
    source_rank: number;
    rationale: string | null;
    metadata: JsonRecord;
  }> = [];
  let generation: Awaited<ReturnType<typeof generatePromptCandidates>> | null = null;
  let updatedDraft: GeneratedOuvrageDraftRow | null = null;

  try {
    const fragmentSeeds = await buildSourceFragmentSeeds({
      supabase,
      tenantId,
      project,
      versionId: parsed.versionId,
      sourceKind: parsed.sourceKind,
      sourceText: parsed.sourceText,
      sourceDocumentId: parsed.sourceDocumentId ?? null,
      sourceFileName: parsed.sourceFileName ?? null,
      sourcePageFrom: parsed.sourcePageFrom ?? null,
      sourcePageTo: parsed.sourcePageTo ?? null,
      selectionLabel: parsed.selectionLabel ?? null,
    });

    const fragmentInsertRows = fragmentSeeds.map((seed, index) => ({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      draft_id: draft.id,
      fragment_order: index,
      source_kind: seed.sourceKind,
      status: "active",
      label: normalizeText(seed.label, 180),
      excerpt: seed.excerpt,
      normalized_excerpt: seed.excerpt.toLowerCase(),
      source_document_id: seed.sourceDocumentId ?? null,
      source_file_name: toNullableText(seed.sourceFileName),
      source_page_from: seed.sourcePageFrom ?? null,
      source_page_to: seed.sourcePageTo ?? null,
      selection_label: toNullableText(seed.selectionLabel),
      cctp_section_ref: toNullableText(seed.cctpSectionRef),
      metadata: seed.metadata ?? {},
    }));

    const { data: fragmentData, error: fragmentError } = await supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .insert(fragmentInsertRows as never)
      .select("*" as never)
      .order("fragment_order", { ascending: true });

    if (fragmentError || !fragmentData) {
      throw mapSupabaseError(
        fragmentError,
        "Impossible de persister les fragments sources des ouvrages."
      );
    }

    fragments = fragmentData as GeneratedOuvrageSourceFragmentRow[];
    generation = await generatePromptCandidates({
      project,
      sourceKind: parsed.sourceKind,
      preferredLotLabel,
      fragments,
    });

    const sanitizedCandidates = sanitizePromptCandidates({
      promptCandidates: generation.exchange.candidates,
      fragments,
      preferredLotId: parsed.preferredLotId ?? null,
      preferredLotLabel,
    });

    const candidateInsertRows = sanitizedCandidates.map((candidate) => ({
      tenant_id: tenantId,
      project_id: parsed.projectId,
      target_version_id: parsed.versionId,
      draft_id: draft.id,
      candidate_order: candidate.candidateOrder,
      suggested_lot_id: candidate.suggestedLotId,
      lot_label: candidate.lotLabel,
      designation: candidate.designation,
      normalized_designation: candidate.normalizedDesignation,
      unit: candidate.unit,
      quantity: candidate.quantity,
      confidence: candidate.confidence,
      ai_status: candidate.aiStatus,
      resolution_status: "pending",
      reasoning: candidate.reasoning,
      metadata: {},
    }));

    const { data: candidateData, error: candidateError } = await supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .insert(candidateInsertRows as never)
      .select("*" as never)
      .order("candidate_order", { ascending: true });

    if (candidateError || !candidateData) {
      throw mapSupabaseError(
        candidateError,
        "Impossible de persister les candidats d'ouvrages."
      );
    }

    candidates = candidateData as GeneratedOuvrageCandidateRow[];
    sourceLinkRows = candidates.flatMap((candidate, index) => {
      const sourceFragmentIds = sanitizedCandidates[index]?.sourceFragmentIds ?? [];
      return sourceFragmentIds.map((sourceFragmentId, sourceRank) => ({
        tenant_id: tenantId,
        draft_id: draft.id,
        candidate_id: candidate.id,
        source_fragment_id: sourceFragmentId,
        source_rank: sourceRank,
        rationale: sanitizedCandidates[index]?.reasoning ?? null,
        metadata: {},
      }));
    });

    if (sourceLinkRows.length > 0) {
      const { error: sourceLinkError } = await supabase
        .from("estimate_generated_ouvrage_candidate_sources" as never)
        .insert(sourceLinkRows as never);

      if (sourceLinkError) {
        throw mapSupabaseError(
          sourceLinkError,
          "Impossible de persister la provenance des candidats."
        );
      }
    }

    updatedDraft = await updateDraftProjection({
      supabase,
      draft,
      candidates,
      applications: [],
      generationMetadata: {
        model: generation.metadata.model ?? null,
        prompt_version: generation.metadata.prompt_version,
        used_fallback: Boolean(generation.metadata.used_fallback),
        token_count: generation.metadata.token_count ?? null,
        cost_cents: generation.metadata.cost_cents ?? null,
        duration_ms: generation.metadata.duration_ms ?? null,
        summary: generation.metadata.summary ?? null,
        source_fragment_count: fragments.length,
        candidate_count: candidates.length,
        preferred_lot_label: preferredLotLabel,
        source_document_id: parsed.sourceDocumentId ?? null,
      },
    });
  } catch (error) {
    try {
      await closeGeneratedOuvrageGeneration({
        supabase,
        versionId: parsed.versionId,
        draftId: draft.id,
        draftLockSessionId: parsed.draftLockSessionId,
        mode: "failed",
      });
    } catch (cleanupError) {
      throw internalError(
        "La génération du brouillon a échoué et son archivage automatique a aussi échoué.",
        {
          draftId: draft.id,
          cause: error,
          cleanupError,
        },
        "EST381_DRAFT_GENERATION_CLEANUP_FAILED"
      );
    }

    throw error;
  }

  await closeGeneratedOuvrageGeneration({
    supabase,
    versionId: parsed.versionId,
    draftId: draft.id,
    draftLockSessionId: parsed.draftLockSessionId,
    mode: "complete",
  });

  if (!updatedDraft || !generation) {
    throw internalError(
      "Le brouillon d'ouvrages généré est incomplet après matérialisation.",
      { draftId: draft.id },
      "EST381_DRAFT_GENERATION_INCOMPLETE"
    );
  }

  await logEstimateVersionEventIfPossible({
    versionId: parsed.versionId,
    eventType: "generated_ouvrage_draft_created",
    actorUserId: userId,
    metadata: {
      draft_id: draft.id,
      source_kind: parsed.sourceKind,
      candidate_count: candidates.length,
      question_count: candidates.filter((candidate) => candidate.ai_status === "question")
        .length,
      used_fallback: Boolean(generation?.metadata.used_fallback),
    },
  });

  return normalizeDraftResult({
    draft: updatedDraft,
    fragments,
    candidates,
    candidateSources: sourceLinkRows.map((row, index) => ({
      id: `pending-link-${index}`,
      created_at: updatedDraft.created_at,
      tenant_id: tenantId,
      draft_id: row.draft_id,
      candidate_id: row.candidate_id,
      source_fragment_id: row.source_fragment_id,
      source_rank: row.source_rank,
      rationale: row.rationale,
      metadata: row.metadata as Json,
    })),
    applications: [],
  });
}

async function getGeneratedOuvrageResumeAccess(
  context: AuthenticatedContext,
  versionId: string
) {
  const access = await getVersionAccessOrThrow(context.supabase, versionId, context);
  if (context.tenantRole !== "admin" && context.tenantRole !== "engineer") {
    throw forbidden("Votre rôle ne permet pas de reprendre un brouillon d'ouvrages.");
  }
  assertDraftStatus(access.version.status);
  if (access.project.is_archived) {
    throw conflict("Cette affaire est archivée. La reprise est indisponible.");
  }
  return access;
}

function decodeGeneratedOuvrageCursor(cursor: string) {
  try {
    return generatedOuvrageCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
  } catch {
    throw badRequest("Le curseur de reprise est invalide. Actualisez la liste.");
  }
}

export async function listResumableGeneratedOuvrageDrafts(
  input: ListResumableGeneratedOuvrageDraftsInput
): Promise<GeneratedOuvrageDraftPage> {
  const parsed = generatedOuvrageListInputSchema.parse(input);
  const cursor = parsed.cursor ? decodeGeneratedOuvrageCursor(parsed.cursor) : null;
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { project } = await getGeneratedOuvrageResumeAccess(context, parsed.versionId);
  let query = supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .select(
      "id, created_at, source_kind, status, candidates:estimate_generated_ouvrage_candidates(ai_status, resolution_status)" as never
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", project.id)
    .eq("target_version_id", parsed.versionId)
    .eq("created_by", userId)
    .in("status", ["pending", "partially_applied"])
    .eq("candidates.tenant_id", tenantId)
    .eq("candidates.target_version_id", parsed.versionId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RESUMABLE_DRAFT_PAGE_SIZE + 1)
    .limit(MAX_CANDIDATES + 1, { referencedTable: "candidates" });

  if (cursor) {
    // Both interpolated values are strictly parsed; keep PostgreSQL timestamp precision.
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les brouillons à reprendre.");
  }
  const rows = generatedOuvrageListRowsSchema.safeParse(data);
  if (!rows.success) {
    throw internalError("La liste des brouillons est incomplète ou invalide.");
  }
  const page = rows.data.slice(0, RESUMABLE_DRAFT_PAGE_SIZE);
  const last = page.at(-1);
  return {
    versionId: parsed.versionId,
    items: page.map((row) => ({
      draftId: row.id,
      createdAt: row.created_at,
      sourceKind: row.source_kind,
      status: row.status,
      summary: buildDraftSummary(row.candidates),
    })),
    nextCursor:
      rows.data.length > RESUMABLE_DRAFT_PAGE_SIZE && last
        ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString(
            "base64url"
          )
        : null,
  };
}

export async function fetchResumableGeneratedOuvrageDraft(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageFetchInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { project } = await getGeneratedOuvrageResumeAccess(context, parsed.versionId);
  const { data, error } = await supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .select("id, status" as never)
    .eq("tenant_id", tenantId)
    .eq("project_id", project.id)
    .eq("target_version_id", parsed.versionId)
    .eq("created_by", userId)
    .eq("id", parsed.draftId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de reprendre ce brouillon d'ouvrages.");
  }
  if (!data) {
    throw notFound("Brouillon introuvable ou non reprenable.");
  }
  const draft = data as { id: string; status: GeneratedOuvrageDraftStatus };
  if (draft.status !== "pending" && draft.status !== "partially_applied") {
    throw conflict(
      "Ce brouillon n'est plus à reprendre. Actualisez la liste.",
      undefined,
      "GENERATED_OUVRAGE_NOT_RESUMABLE"
    );
  }
  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });
  if (loaded.draft.created_by !== userId || loaded.draft.project_id !== project.id) {
    throw notFound("Brouillon introuvable ou non reprenable.");
  }
  if (loaded.draft.status !== "pending" && loaded.draft.status !== "partially_applied") {
    throw conflict(
      "Ce brouillon n'est plus à reprendre. Actualisez la liste.",
      undefined,
      "GENERATED_OUVRAGE_NOT_RESUMABLE"
    );
  }
  const result = normalizeDraftResult(loaded);
  if (result.summary.pendingCount === 0) {
    throw conflict(
      "Ce brouillon n'a aucune proposition disponible. Actualisez la liste.",
      undefined,
      "GENERATED_OUVRAGE_NOT_RESUMABLE"
    );
  }
  return result;
}

export async function fetchGeneratedOuvrageDraft(
  input: FetchGeneratedOuvrageDraftInput
): Promise<GeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageFetchInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId } = context;

  await getVersionAccessOrThrow(supabase, parsed.versionId, context);

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });

  return normalizeDraftResult(loaded);
}

export async function fetchGeneratedOuvrageSubdetailDraft(
  input: FetchGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult> {
  const parsed = generatedOuvrageSubdetailFetchInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const snapshot = await readGeneratedOuvrageReview(context, parsed);
  if (snapshot.subdetailDraft) return reviewedResult(snapshot);
  assertCanWriteEstimateWorkflows(context.tenantRole);
  if (!parsed.draftLockSessionId) throw conflict("Un verrou actif de cette page est requis.", undefined, "LOCK_REQUIRED");
  const { version } = await getVersionAccessOrThrow(context.supabase, parsed.versionId, context);
  assertDraftStatus(version.status);
  const candidate = snapshot.candidate;
  const candidateSources = normalizeDraftResult({ draft: snapshot.draft, candidates: [candidate],
    candidateSources: snapshot.candidateSources, fragments: snapshot.fragments, applications: [] }).candidates[0].sources;
  const generated = generateInitialSubdetailComponents({ candidate, candidateSources,
    draftFragments: snapshot.fragments, marginMultiplier: version.margin_multiplier });
  const summary = buildGeneratedOuvrageSubdetailSummary({ components: generated.components,
    marginMultiplier: version.margin_multiplier });
  const persisted = await persistGeneratedOuvrageSubdetail({ context, versionId: parsed.versionId,
    draftId: parsed.draftId, candidateId: parsed.candidateId, draftLockSessionId: parsed.draftLockSessionId,
    expectedReviewToken: null, status: "pending_review", summary,
    generationMetadata: { ...generated.generationMetadata, margin_multiplier: version.margin_multiplier ?? null,
      reviewed_candidate: normalizeReviewedCandidateSnapshot(candidate) },
    components: generated.components.map((component) => generatedOuvrageSubdetailComponentInputSchema.parse({ ...component,
      // Initial heuristic identifiers are not persisted component identities.
      componentId: null,
      sources: component.sources.map((source) => ({ sourceFragmentId: source.sourceFragmentId,
        evidenceKind: source.evidenceKind, note: source.note })),
    })),
  });
  return reviewedResult(persisted);
}

type GeneratedOuvrageReviewComponentInput = UpdateGeneratedOuvrageSubdetailInput["components"][number];

function normalizeGeneratedOuvrageReviewComponents(
  components: GeneratedOuvrageReviewComponentInput[],
  snapshot: GeneratedOuvrageReviewSnapshot
): GeneratedOuvrageReviewComponentInput[] {
  const previousById = new Map(snapshot.items.map((item) => [item.id, item]));
  return components.map((component) => {
    const content = normalizeGeneratedOuvrageComponentContent(component);
    if (content.yieldValue !== null && content.yieldValue <= 0) {
      throw badRequest("Le rendement doit rester positif après enregistrement à trois décimales.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
    }
    const restore = component.restore ?? false;
    const restoreAsManual = component.restoreAsManual ?? false;
    const previous = component.componentId ? previousById.get(component.componentId) : null;
    if (component.componentId && !previous) {
      throw badRequest("Ce composant n'appartient pas à la revue enregistrée.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
    }
    if (!previous) {
      if (restore || restoreAsManual) {
        throw badRequest("Un nouveau composant ne nécessite pas de restitution d'une décision enregistrée.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
      }
      return { ...component, ...content, status: component.status === "rejected" ? "rejected" : "manual", restore, restoreAsManual };
    }
    const metadata = typeof previous.metadata === "object" && previous.metadata !== null
      ? previous.metadata as JsonRecord : {};
    const oldContent = normalizeGeneratedOuvrageComponentContent({
      costType: previous.cost_type,
      designation: previous.designation, unit: previous.unit, quantity: previous.quantity,
      unitCostHtCents: previous.unit_cost_ht_cents, lossCoeffBp: previous.loss_coeff_bp,
      yieldValue: previous.yield_value, yieldUnit: previous.yield_unit, confidence: previous.confidence,
      sourceLabel: previous.source_label, facts: previous.facts as string[],
      hypotheses: previous.hypotheses as string[], inferences: previous.inferences as string[],
      riskSignals: Array.isArray(metadata.risk_signals) ? metadata.risk_signals as GeneratedOuvrageRiskSignal[] : [],
      sources: snapshot.itemSources.filter((source) => source.component_id === previous.id)
        .sort((left, right) => left.source_rank - right.source_rank || left.id.localeCompare(right.id))
        .map((source) => ({ sourceFragmentId: source.source_fragment_id, evidenceKind: source.evidence_kind, note: source.note })),
    });
    const changed = generatedOuvrageComponentContentJson(content) !== generatedOuvrageComponentContentJson(oldContent);
    let status: GeneratedOuvrageSubdetailItemStatus = component.status;
    if (previous.status === "rejected") {
      const origin = metadata.rejected_from_status;
      const knownOrigin = origin === "suggested" || origin === "manual" ? origin : null;
      if ((restore && restoreAsManual) || (restore && knownOrigin === null) || (restoreAsManual && knownOrigin !== null)) {
        throw badRequest("La restitution demandée ne correspond pas à l'origine de ce composant écarté.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
      }
      if (!restore && !restoreAsManual) {
        if (changed || component.status !== "rejected") {
          throw badRequest("Rétablissez explicitement ce composant écarté avant de le modifier.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
        }
      } else if (component.status !== "rejected") {
        if (changed || restoreAsManual) status = "manual";
        else if (knownOrigin) status = knownOrigin;
        else throw badRequest("L'origine de ce composant écarté doit être explicitement revue.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
      }
    } else {
      if (restore || restoreAsManual) {
        throw badRequest("Ce composant retenu n'a pas de décision d'exclusion à rétablir.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
      }
      if (component.status !== "rejected") status = changed ? "manual" : previous.status;
    }
    return { ...component, ...content, status, restore, restoreAsManual };
  });
}

export async function updateGeneratedOuvrageSubdetailDraft(
  input: UpdateGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult> {
  const parsed = generatedOuvrageSubdetailUpdateInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version } = await getVersionAccessOrThrow(context.supabase, parsed.versionId, context);
  assertDraftStatus(version.status);
  const snapshot = await readGeneratedOuvrageReview(context, parsed);
  const candidate = snapshot.candidate;
  if (snapshot.reviewToken !== parsed.expectedReviewToken) {
    throw conflict("La revue a changé. Rechargez le sous-détail avant de le valider.", undefined, "GENERATED_OUVRAGE_REVIEW_CHANGED");
  }
  if (candidate.resolution_status !== "pending") {
    throw conflict("Le sous-détail n'est éditable que tant que l'ouvrage parent est en attente.", undefined, "EST383_CANDIDATE_NOT_PENDING");
  }
  const existing = { draft: snapshot.subdetailDraft };
  const normalizedComponents = normalizeGeneratedOuvrageReviewComponents(parsed.components, snapshot);
  if (parsed.markReviewed && normalizedComponents.every((component) => component.status === "rejected")) {
    throw conflict("Aucun composant n'est retenu. Enregistrez les décisions ou rétablissez un composant avant de valider cet ouvrage.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
  }

  const summary = buildGeneratedOuvrageSubdetailSummary({
    components: normalizedComponents.map((component, index) => ({
      componentId: component.componentId ?? `component-${index}`,
      status: component.status,
      rejectedFromStatus: null,
      costType: component.costType,
      designation: component.designation,
      unit: component.unit ?? null,
      quantity: component.quantity,
      unitCostHtCents: component.unitCostHtCents,
      lossCoeffBp: component.lossCoeffBp,
      yieldValue: component.yieldValue ?? null,
      yieldUnit: component.yieldUnit ?? null,
      confidence: component.confidence,
      sourceLabel: component.sourceLabel ?? null,
      dsCents: computeComponentDsCents({
        quantity: component.quantity,
        unitCostHtCents: component.unitCostHtCents,
        lossCoeffBp: component.lossCoeffBp,
      }),
      facts: component.facts,
      hypotheses: component.hypotheses,
      inferences: component.inferences,
      riskSignals: component.riskSignals,
      sources: component.sources.map((source) => ({
        sourceFragmentId: source.sourceFragmentId,
        sourceDocumentId: null,
        type: "text",
        label: source.sourceFragmentId,
        excerpt: null,
        sourceFileName: null,
        sourcePageFrom: null,
        sourcePageTo: null,
        selectionLabel: null,
        evidenceKind: source.evidenceKind,
        note: source.note ?? null,
      })),
    })),
    marginMultiplier: version.margin_multiplier,
  });

  const generationMetadata =
    existing.draft?.generation_metadata && typeof existing.draft.generation_metadata === "object"
      ? {
          ...(existing.draft.generation_metadata as JsonRecord),
          margin_multiplier: version.margin_multiplier ?? null,
          last_reviewed_at: new Date().toISOString(),
          reviewed_candidate: normalizeReviewedCandidateSnapshot({
            designation:
              parsed.reviewedCandidate?.designation ?? candidate.designation,
            unit: parsed.reviewedCandidate?.unit ?? candidate.unit,
            quantity:
              parsed.reviewedCandidate?.quantity ?? candidate.quantity,
          }),
        }
      : {
          generator: "review_update",
          margin_multiplier: version.margin_multiplier ?? null,
          last_reviewed_at: new Date().toISOString(),
          reviewed_candidate: normalizeReviewedCandidateSnapshot({
            designation:
              parsed.reviewedCandidate?.designation ?? candidate.designation,
            unit: parsed.reviewedCandidate?.unit ?? candidate.unit,
            quantity:
              parsed.reviewedCandidate?.quantity ?? candidate.quantity,
          }),
        };

  const persisted = await persistGeneratedOuvrageSubdetail({
    context, versionId: parsed.versionId, draftId: parsed.draftId, candidateId: parsed.candidateId,
    draftLockSessionId: parsed.draftLockSessionId, expectedReviewToken: parsed.expectedReviewToken,
    status: parsed.markReviewed ? "reviewed" : "pending_review", summary,
    generationMetadata, components: normalizedComponents,
  });
  return reviewedResult(persisted);
}

async function lookupGeneratedOuvrageReceipt(context: AuthenticatedContext, versionId: string, operationKey: string) {
  let response;
  try {
    response = await context.supabase.rpc("get_generated_ouvrage_application_receipt", {
      p_version_id: versionId, p_operation_key: operationKey,
    });
  } catch { throw generatedOuvrageReadUnavailable(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, false);
  if (response.data === null) return null;
  try {
    return parseGeneratedOuvrageOutcome(response.data, { versionId, operationKey, actorId: context.userId });
  } catch { throw generatedOuvrageReadUnavailable(); }
}

export async function getGeneratedOuvrageApplicationReceipt(input: { versionId: string; operationKey: string }) {
  const parsed = z.object({ versionId: z.string().uuid(), operationKey: z.string().uuid() }).strict().parse(input);
  const context = await getAuthenticatedContext();
  return lookupGeneratedOuvrageReceipt(context, parsed.versionId.toLowerCase(), parsed.operationKey.toLowerCase());
}

export async function abandonGeneratedOuvrageApplication(
  input: Omit<InsertGeneratedOuvragesInput, "draftLockSessionId">
): Promise<GeneratedOuvrageApplicationOutcome> {
  const parsed = generatedOuvrageInsertInputSchema.omit({ draftLockSessionId: true }).strict().parse(input);
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  let response;
  try {
    response = await context.supabase.rpc("abandon_generated_ouvrage_application", {
      p_version_id: parsed.versionId, p_draft_id: parsed.draftId, p_operation_key: parsed.operationKey,
      p_expected_updated_at: parsed.expectedUpdatedAt, p_accepted_candidates: parsed.acceptedCandidates as Json,
    });
  } catch { throw generatedOuvrageOutcomeUnknown(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, true);
  return parseGeneratedOuvrageOutcome(response.data, { ...parsed, actorId: context.userId });
}

export async function insertGeneratedOuvrages(input: InsertGeneratedOuvragesInput): Promise<GeneratedOuvrageApplicationOutcome> {
  const parsed = generatedOuvrageInsertInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { supabase, tenantId, userId } = context;
  const scope = { versionId: parsed.versionId, operationKey: parsed.operationKey, actorId: userId,
    draftId: parsed.draftId, expectedUpdatedAt: parsed.expectedUpdatedAt, acceptedCandidates: parsed.acceptedCandidates };
  const saved = await lookupGeneratedOuvrageReceipt(context, parsed.versionId, parsed.operationKey);
  const baseArgs = { p_version_id: parsed.versionId, p_draft_id: parsed.draftId, p_operation_key: parsed.operationKey,
    p_expected_updated_at: parsed.expectedUpdatedAt, p_accepted_candidates: parsed.acceptedCandidates as Json };
  if (saved) {
    if (saved.receipt.draftId !== parsed.draftId ||
      !sameEstimateBatchTimestamp(saved.receipt.expectedUpdatedAt, parsed.expectedUpdatedAt) ||
      JSON.stringify(saved.receipt.acceptedCandidates) !== JSON.stringify(parsed.acceptedCandidates)) {
      throw conflict("Cette clé correspond à une autre demande.", undefined, "GENERATED_OUVRAGE_IDEMPOTENCY_CONFLICT");
    }
    let response;
    try {
      response = await supabase.rpc("commit_generated_ouvrages", { ...baseArgs,
        p_draft_lock_session_id: null, p_prepared_candidates: [], p_fallback_section: null,
        p_item_updates: [], p_version_patch: {}, p_calculation_context: {}, p_expected_preferred_role: null,
      });
    } catch { throw generatedOuvrageOutcomeUnknown(); }
    if (response.error) throw generatedOuvrageRpcError(response.error, true);
    const replay = parseGeneratedOuvrageOutcome(response.data, scope);
    if ("outcome" in saved) {
      if (!("outcome" in replay) || JSON.stringify(replay.receipt) !== JSON.stringify(saved.receipt)) throw generatedOuvrageOutcomeUnknown();
      return replay;
    }
    if ("outcome" in replay) throw generatedOuvrageOutcomeUnknown();
    if (!replay.replayed || JSON.stringify(replay.receipt) !== JSON.stringify(saved.receipt) ||
      JSON.stringify(replay.applications) !== JSON.stringify(saved.applications) ||
      JSON.stringify(replay.totals) !== JSON.stringify(saved.totals) || replay.projectId !== saved.projectId ||
      replay.draftStatus !== saved.draftStatus || !sameEstimateBatchTimestamp(replay.version.updatedAt, saved.version.updatedAt)) {
      throw generatedOuvrageOutcomeUnknown();
    }
    return replay;
  }
  const { version, project } = await getVersionAccessOrThrow(supabase, parsed.versionId, context);
  assertDraftStatus(version.status);
  if (project.is_archived) throw conflict("Cette affaire est archivée.");
  if (!sameEstimateBatchTimestamp(version.updated_at, parsed.expectedUpdatedAt)) {
    throw conflict("Le devis a changé. Rechargez avant de préparer une nouvelle demande.", undefined, "VERSION_CONFLICT");
  }
  await assertDraftLockSessionOwnedByCurrentUser({ supabase, tenantId, versionId: parsed.versionId,
    userId, draftLockSessionId: parsed.draftLockSessionId });
  if (new Set(parsed.acceptedCandidates.map((entry) => entry.candidateId)).size !== parsed.acceptedCandidates.length) {
    throw conflict("Ce candidat figure plusieurs fois dans la demande.", undefined, "EST381_DUPLICATE_ACCEPTED_CANDIDATE");
  }
  const reviews = await Promise.all(parsed.acceptedCandidates.map(async (accepted) => {
    if (accepted.quantity === null) throw badRequest("La quantité doit être renseignée avant l'insertion du candidat.", undefined, "EST381_CANDIDATE_QUANTITY_REQUIRED");
    const review = await readGeneratedOuvrageReview(context, { ...parsed, candidateId: accepted.candidateId });
    if (review.draft.project_id !== project.id) throw generatedOuvrageReadUnavailable();
    if (review.draft.status === "discarded") throw conflict("Ce brouillon a déjà été rejeté.", undefined, "EST381_DRAFT_DISCARDED");
    if (review.candidate.resolution_status !== "pending") throw conflict("Ce candidat n'est plus disponible pour insertion.", undefined, "EST381_CANDIDATE_NOT_PENDING");
    if (!review.subdetailDraft || !review.reviewToken || review.items.length === 0) throw conflict("Le sous-détail doit être généré puis revu avant insertion.", undefined, "EST383_SUBDETAIL_REQUIRED");
    if (review.subdetailDraft.status !== "reviewed") throw conflict("Le sous-détail doit être explicitement validé avant insertion.", undefined, "EST383_SUBDETAIL_NOT_REVIEWED");
    if (review.reviewToken !== accepted.reviewToken) throw conflict("La revue a changé. Rechargez le sous-détail.", undefined, "GENERATED_OUVRAGE_REVIEW_CHANGED");
    const metadata = review.subdetailDraft.generation_metadata as JsonRecord;
    const reviewed = readReviewedCandidateSnapshot(metadata.reviewed_candidate) ?? normalizeReviewedCandidateSnapshot(review.candidate);
    if (!reviewedCandidateMatches({ acceptedCandidate: normalizeReviewedCandidateSnapshot(accepted), reviewedCandidate: reviewed })) {
      throw conflict("Le sous-détail validé ne correspond plus aux valeurs actuelles du candidat. Merci de revalider le sous-détail.", undefined, "EST383_SUBDETAIL_STALE");
    }
    return { accepted, review, subdetail: reviewedResult(review) };
  }));
  const preferredRole = await loadPreferredGeneratedOuvrageLaborRole({ supabase, tenantId, ownerUserId: project.user_id });
  const projected = reviews.map(({ accepted, review, subdetail }) => {
    const retainedComponents = subdetail.components.filter((component) => component.status !== "rejected");
    if (retainedComponents.length === 0) {
      throw conflict("Aucun composant n'est retenu dans cet ouvrage. Rétablissez un composant puis validez à nouveau le sous-détail.", undefined, "GENERATED_OUVRAGE_INVALID_INPUT");
    }
    const mapping = buildGeneratedOuvrageEstimateItemMapping({ components: retainedComponents,
      parentQuantity: accepted.quantity!, laborRole: preferredRole });
    const hours = new Map(mapping.laborTrace.map((entry) => [entry.componentId, entry.derivedHours]));
    const projection = projectGeneratedOuvrageCosts({ components: retainedComponents.map((component) => ({
      componentId: component.componentId, costType: component.costType, quantity: component.quantity,
      unitCostHtCents: component.unitCostHtCents, lossCoeffBp: component.lossCoeffBp,
      reviewedDsCents: component.dsCents, derivedHours: hours.get(component.componentId) ?? 0,
    })), parent: { quantity: accepted.quantity!, unitPriceHtCents: mapping.unitPriceHtCents,
      hMo: mapping.hMo, kFo: mapping.kFo, kMo: mapping.kMo, laborRateCents: mapping.laborRoleHourlyRateCents } });
    if (!projection.ok || projection.totals.dsCents !== subdetail.summary.dsCents) {
      throw conflict(`Le format actuel ne permet pas de conserver exactement le coût et les heures revus de « ${accepted.designation} ». Aucun ouvrage n'a été ajouté. Le brouillon reste disponible.`, undefined, "EST383_COST_PROJECTION_INEXACT");
    }
    return { accepted, review, projection,
      mapping: { ...mapping, kFo: projection.parent.kFo, kMo: projection.parent.kMo } };
  });
  let fallback: { id: string; created: boolean } | null = null;
  if (parsed.acceptedCandidates.some((entry) => entry.lotId === null)) {
    const { data, error } = await supabase.from("estimate_items").select("id, title, position")
      .eq("tenant_id", tenantId).eq("version_id", parsed.versionId).eq("item_type", "section")
      .is("parent_id", null).order("position", { ascending: true }).order("id", { ascending: true });
    if (error || !data) throw generatedOuvrageReadUnavailable();
    const existing = data.find((entry) => normalizeSectionTitle(entry.title) === normalizeSectionTitle(GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE));
    fallback = { id: existing?.id ?? randomUUID(), created: !existing };
  }
  const operations: BatchOperationInput[] = [];
  const createdIds: Array<{ index: number; id: string }> = [];
  if (fallback?.created) {
    createdIds.push({ index: 0, id: fallback.id });
    operations.push({ op: "create", data: { item_type: "section", parent_id: null,
      title: GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE, source_provider: "generated_ouvrage" } });
  }
  const candidates = projected.map(({ accepted, review, projection, mapping }) => {
    const lotId = accepted.lotId ?? fallback!.id;
    const primary = normalizeDraftResult({ draft: review.draft, candidates: [review.candidate],
      candidateSources: review.candidateSources, fragments: review.fragments, applications: [] }).candidates[0].sources[0];
    const estimateItemId = randomUUID();
    const item = { item_type: "line" as const, parent_id: lotId, title: accepted.designation,
      description: accepted.unit, quantity: accepted.quantity!, unit_price_ht_cents: mapping.unitPriceHtCents,
      h_mo: mapping.hMo, k_fo: mapping.kFo, k_mo: mapping.kMo, labor_role_id: mapping.laborRoleId,
      source_provider: "generated_ouvrage", source_file_name: primary?.sourceFileName ?? null,
      source_page: primary?.sourcePageFrom ?? null };
    createdIds.push({ index: operations.length, id: estimateItemId });
    operations.push({ op: "create", data: item });
    return { candidateId: accepted.candidateId, subdetailId: review.subdetailDraft!.id,
      estimateItemId, assemblyId: randomUUID(), applicationId: randomUUID(), snapshotId: randomUUID(),
      resolvedLotId: lotId, placementMode: accepted.lotId ? "explicit" : "fallback_unclassified",
      estimateItemMapping: mapping, componentProjections: projection.components.map((component) => ({
        componentId: component.componentId, kFo: component.kFo, kMo: component.kMo,
        hMo: component.hMo, dsCents: component.dsCents,
      })), item };
  });
  let financial;
  try {
    financial = await prepareEstimateBatch({ context, versionId: parsed.versionId, projectUserId: project.user_id,
      expectedUpdatedAt: parsed.expectedUpdatedAt, operations, createdIds });
  } catch (error) {
    if (error instanceof EstimateBatchPreparationError) throw error.failure;
    throw error;
  }
  let response;
  try {
    response = await supabase.rpc("commit_generated_ouvrages", { ...baseArgs,
      p_draft_lock_session_id: parsed.draftLockSessionId, p_prepared_candidates: candidates as Json,
      p_fallback_section: fallback, p_item_updates: financial.itemUpdates, p_version_patch: financial.versionPatch,
      p_calculation_context: financial.calculationContext as Json,
      p_expected_preferred_role: preferredRole ? { id: preferredRole.id, name: preferredRole.name,
        hourly_rate_cents: preferredRole.hourlyRateCents, position: preferredRole.position, is_active: true } : null,
    });
  } catch { throw generatedOuvrageOutcomeUnknown(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, true);
  const result = parseGeneratedOuvrageOutcome(response.data, scope);
  if ("outcome" in result) return result;
  if (!result.replayed && (result.projectId !== project.id || result.applications.some((entry, index) => {
    const candidate = candidates[index];
    return entry.estimateItemId !== candidate.estimateItemId || entry.assemblyId !== candidate.assemblyId ||
      entry.subdetailId !== candidate.subdetailId || entry.applicationId !== candidate.applicationId || entry.snapshotId !== candidate.snapshotId;
  }))) throw generatedOuvrageOutcomeUnknown();
  return result;
}

export async function rejectGeneratedOuvrageDraft(input: RejectGeneratedOuvrageDraftInput): Promise<RejectGeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageRejectInputSchema.parse({ ...input,
    reason: input.reason ? normalizeText(input.reason, MAX_REASON_LENGTH) : null });
  const context = await getAuthenticatedContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  let response;
  try {
    response = await context.supabase.rpc("reject_generated_ouvrage_candidate", { p_version_id: parsed.versionId,
      p_draft_id: parsed.draftId, p_candidate_id: parsed.candidateId,
      p_draft_lock_session_id: parsed.draftLockSessionId, p_reason: parsed.reason ?? null });
  } catch { throw generatedOuvrageOutcomeUnknown(); }
  if (response.error) throw generatedOuvrageRpcError(response.error, true);
  const result = z.object({ ok: z.literal(true), draftStatus: generatedOuvrageDraftStatusSchema,
    projectId: z.string().uuid(), versionId: z.string().uuid() }).strict().safeParse(response.data);
  if (!result.success || result.data.versionId !== parsed.versionId) throw generatedOuvrageOutcomeUnknown();
  return result.data;
}
