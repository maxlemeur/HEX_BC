import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  assertDraftStatus,
  createEstimateItem,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import {
  badRequest,
  conflict,
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
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_metadata?: Json | null;
  source_extracted_at?: string | null;
};

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

type DraftLockRow = {
  id: string;
  version_id: string;
  user_id: string;
  locked_at: string;
  expires_at: string;
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

type GeneratedOuvrageWorkSnapshotRow = {
  id: string;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  project_id: string;
  target_version_id: string;
  draft_id: string;
  parent_work_id: string;
  assembly_id: string | null;
  estimate_item_id: string;
  applied_by: string | null;
  summary: Json;
  components: Json;
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
const GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE = "A classer";
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

const generatedOuvrageSubdetailFetchInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
});

const generatedOuvrageInsertCandidateSchema = z.object({
  candidateId: z.string().uuid("candidateId invalide."),
  designation: z.string().trim().min(1, "La designation est requise.").max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite("Quantite invalide.").min(0).nullable().optional(),
  lotId: z.string().uuid("lotId invalide.").nullable().optional(),
});

const generatedOuvrageInsertInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  acceptedCandidates: z
    .array(generatedOuvrageInsertCandidateSchema)
    .min(1, "Au moins un ouvrage doit etre selectionne.")
    .max(MAX_CANDIDATES, `Maximum ${MAX_CANDIDATES} ouvrages par insertion.`),
});

const generatedOuvrageRejectInputSchema = z.object({
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
  costType: generatedOuvrageSubdetailCostTypeSchema,
  designation: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(64).nullable().optional(),
  quantity: z.number().finite("Quantite invalide.").min(0),
  unitCostHtCents: z.number().int("Cout unitaire invalide.").min(0),
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
  quantity: z.number().finite("Quantite invalide.").min(0).nullable().optional(),
});

const generatedOuvrageSubdetailUpdateInputSchema = z.object({
  versionId: z.string().uuid("versionId invalide."),
  draftId: z.string().uuid("draftId invalide."),
  candidateId: z.string().uuid("candidateId invalide."),
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
};

export type InsertGeneratedOuvragesResult = {
  ok: true;
  insertedCount: number;
  draftStatus: GeneratedOuvrageDraftStatus;
  projectId: string;
  versionId: string;
};

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
  return {
    designation: normalizeText(input.designation, 500),
    unit: toNullableText(input.unit),
    quantity:
      typeof input.quantity === "number" && Number.isFinite(input.quantity)
        ? roundQuantity(input.quantity)
        : null,
  };
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

async function assertDraftLockOwnedByCurrentUser(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
}) {
  const { data, error } = await input.supabase
    .from("draft_locks")
    .select("id, version_id, user_id, locked_at, expires_at")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de vérifier le verrou de brouillon.");
  }

  const lock = (data ?? null) as DraftLockRow | null;

  if (!lock) {
    throw conflict(
      "Un verrou actif est requis pour modifier cette version brouillon.",
      { lock: null },
      "LOCK_REQUIRED"
    );
  }

  if (lock.user_id === input.userId) {
    return;
  }

  throw conflict(
    "Cette version brouillon est deja verrouillee par un autre utilisateur.",
    { lockedByUserId: lock.user_id, expiresAt: lock.expires_at },
    "LOCK_OWNED_BY_OTHER"
  );
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
    throw mapSupabaseError(error, "Impossible de charger le lot selectionne.");
  }

  if (!data) {
    throw notFound("Lot introuvable.", undefined, "EST381_LOT_NOT_FOUND");
  }

  if ((data as { item_type?: string }).item_type !== "section") {
    throw badRequest("Le lot selectionne doit etre un chapitre du devis.");
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
      ["assumptions", "Hypotheses confirmees"],
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
        parts.push(`Quantite historique: ${row.quantity}`);
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

async function discardPendingGeneratedOuvrageDrafts(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  userId: string;
  excludeDraftId?: string;
}) {
  let query = input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("tenant_id", input.tenantId)
    .eq("target_version_id", input.versionId)
    .eq("created_by", input.userId)
    .eq("status", "pending");

  if (input.excludeDraftId) {
    query = query.neq("id", input.excludeDraftId);
  }

  const { data, error } = await query.select("id" as never);

  if (error) {
    throw mapSupabaseError(error, "Impossible d'archiver les brouillons precedents.");
  }

  const discardedDraftIds = Array.isArray(data)
    ? data
        .map((row) => toNullableText((row as { id?: string }).id))
        .filter((id): id is string => Boolean(id))
    : [];

  if (discardedDraftIds.length === 0) {
    return;
  }

  const { error: fragmentError } = await input.supabase
    .from("estimate_generated_ouvrage_source_fragments" as never)
    .update({
      status: "discarded",
    } as never)
    .in("draft_id", discardedDraftIds);

  if (fragmentError) {
    throw mapSupabaseError(fragmentError, "Impossible d'archiver les fragments precedents.");
  }
}

async function discardGeneratedOuvrageDraftOnFailure(input: {
  supabase: Supabase;
  draftId: string;
}) {
  const { data, error } = await input.supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("id", input.draftId)
    .select("id" as never)
    .single();

  if (error || !data) {
    throw mapSupabaseError(
      error,
      "Impossible d'archiver le brouillon d'ouvrages incomplet."
    );
  }

  const { error: fragmentError } = await input.supabase
    .from("estimate_generated_ouvrage_source_fragments" as never)
    .update({
      status: "discarded",
    } as never)
    .eq("draft_id", input.draftId);

  if (fragmentError) {
    throw mapSupabaseError(
      fragmentError,
      "Impossible d'archiver les fragments du brouillon d'ouvrages incomplet."
    );
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
    "Tu aides un chiffreur BTP a proposer des ouvrages candidats a partir d'un texte source.",
    "Reponse strictement structuree selon le schema JSON fourni.",
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
    "5. N'invente ni prix ni details absents.",
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
        : "Information incomplete a clarifier en revue humaine.",
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
      reasoning: "Aucune structure exploitable detectee automatiquement.",
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
            ? Number(candidate.quantity.toFixed(3))
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

function buildDraftSummary(candidates: GeneratedOuvrageCandidateRow[]) {
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
    throw mapSupabaseError(error, "Impossible de mettre a jour le brouillon d'ouvrages.");
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

  return Number(Number(value).toFixed(3));
}

async function loadPreferredGeneratedOuvrageLaborRole(input: {
  supabase: Supabase;
  tenantId: string;
  ownerUserId: string;
}): Promise<{
  id: string;
  name: string;
  hourlyRateCents: number;
} | null> {
  const { data, error } = await input.supabase
    .from("labor_roles")
    .select("id, name, hourly_rate_cents, position")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.ownerUserId)
    .eq("is_active", true)
    .order("position", { ascending: true })
    .limit(1);

  if (error || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const role = data[0] as LaborRoleSummaryRow;
  return {
    id: role.id,
    name: role.name,
    hourlyRateCents: role.hourly_rate_cents,
  };
}

function deriveGeneratedOuvrageLaborHours(input: {
  component: GeneratedOuvrageSubdetailComponent;
  parentQuantity: number;
}): {
  derivedHours: number;
  hoursSource: "quantity" | "yield";
} {
  const normalizedUnit = toNullableText(input.component.unit)?.toLowerCase();
  const normalizedYieldUnit = toNullableText(input.component.yieldUnit)?.toLowerCase();
  const prefersExplicitQuantity =
    input.component.status === "manual" &&
    (!normalizedUnit || normalizedUnit === "h" || normalizedUnit.startsWith("h/"));

  if (prefersExplicitQuantity) {
    return {
      derivedHours: roundQuantity(input.component.quantity),
      hoursSource: "quantity",
    };
  }

  if (
    typeof input.component.yieldValue === "number" &&
    input.component.yieldValue > 0 &&
    normalizedYieldUnit?.startsWith("h/")
  ) {
    return {
      derivedHours: roundQuantity(input.parentQuantity * input.component.yieldValue),
      hoursSource: "yield",
    };
  }

  if (!normalizedUnit || normalizedUnit === "h" || normalizedUnit.startsWith("h/")) {
    return {
      derivedHours: roundQuantity(input.component.quantity),
      hoursSource: "quantity",
    };
  }

  return {
    derivedHours: roundQuantity(input.component.quantity),
    hoursSource: "quantity",
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

  if (laborDsCents <= 0 || hMo <= 0) {
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

  if (input.laborRole && input.laborRole.hourlyRateCents > 0) {
    const foBaseCents =
      input.parentQuantity > 0 ? input.parentQuantity * unitPriceHtCents : unitPriceHtCents;
    const moBaseCents = hMo * input.laborRole.hourlyRateCents;

    return {
      source: "generated_ouvrage_subdetail_review",
      mode: "legacy_labor_allocated",
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
    mode: input.laborRole ? "labor_hours_role_without_rate" : "labor_hours_only",
    unitPriceHtCents,
    hMo,
    kFo: 1,
    kMo: 0,
    laborRoleId: input.laborRole?.id ?? null,
    laborRoleName: input.laborRole?.name ?? null,
    laborRoleHourlyRateCents: input.laborRole?.hourlyRateCents ?? null,
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
      label: "L'ouvrage parent reste a clarifier avant chiffrage final.",
      severity: "critical",
      basis: "hypothesis",
    });
  } else if (input.candidate.ai_status === "plausible") {
    signals.push({
      label: "Le sous-detail repose sur une interpretation plausible a confirmer.",
      severity: "warning",
      basis: "hypothesis",
    });
  }

  if (input.quantity === null) {
    signals.push({
      label: "Quantite parent absente: le cout reste indicatif.",
      severity: "warning",
      basis: "hypothesis",
    });
  }

  if (!input.profileSourceKinds.includes("history")) {
    signals.push({
      label: "Aucun historique proche n'a ete rattache au sous-detail.",
      severity: "info",
      basis: "inference",
    });
  }

  if (!input.profileSourceKinds.includes("library")) {
    signals.push({
      label: "Aucune bibliotheque interne exploitable n'a ete confirmee.",
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
  const dsCents = input.components.reduce(
    (total, component) => total + component.dsCents,
    0
  );
  const confidence =
    input.components.length === 0
      ? 0.5
      : input.components.reduce((total, component) => total + component.confidence, 0) /
        input.components.length;
  const marginMultiplier =
    typeof input.marginMultiplier === "number" && Number.isFinite(input.marginMultiplier)
      ? Math.max(input.marginMultiplier, 1)
      : 1;
  const facts = Array.from(
    new Set(input.components.flatMap((component) => component.facts))
  ).slice(0, 8);
  const hypotheses = Array.from(
    new Set(input.components.flatMap((component) => component.hypotheses))
  ).slice(0, 8);
  const inferences = Array.from(
    new Set(input.components.flatMap((component) => component.inferences))
  ).slice(0, 8);
  const riskSignals = dedupeRiskSignals(
    input.components.flatMap((component) => component.riskSignals)
  ).slice(0, 8);

  return {
    componentCount: input.components.length,
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
    return roundQuantity(input.parentQuantity * input.yieldValue);
  }

  if (unit === "m2" || unit === "m3" || unit === "ml" || unit === "m") {
    return 1;
  }

  return input.parentQuantity !== null ? roundQuantity(Math.max(input.parentQuantity * 0.25, 1)) : 1;
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
          ? "Historique interne de reference"
          : "Bibliotheque interne de reference"
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
          ? `Quantite parent: ${input.candidate.quantity} ${effectiveUnit}`
          : `Unite parent: ${effectiveUnit}`,
      ],
      hypotheses: [
        "Cout materiau indicatif estime par heuristique metier a confirmer.",
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
      costType: "labor",
      designation: `Main d'oeuvre - ${input.candidate.designation}`,
      unit: "h",
      quantity: laborQuantity,
      unitCostHtCents: profile.labor,
      lossCoeffBp: 0,
      yieldValue: profile.yieldValue,
      yieldUnit: profile.yieldUnit,
      confidence: clampConfidence(input.candidate.confidence - 0.05),
      sourceLabel: candidateSourceFragments[0]?.label ?? "Inference metier",
      dsCents: computeComponentDsCents({
        quantity: laborQuantity,
        unitCostHtCents: profile.labor,
        lossCoeffBp: 0,
      }),
      facts: input.candidate.quantity !== null
        ? [`Quantite parent exploitee pour la MO: ${input.candidate.quantity} ${effectiveUnit}`]
        : [],
      hypotheses: [
        "Rendement MO estime a partir du type d'ouvrage et doit etre valide.",
      ],
      inferences: [
        `Presence de "${input.candidate.designation}" interpretee comme besoin de pose / execution.`,
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
            "Reference interne utilisee pour le rendement"
          )
        ),
      ],
    },
  ];

  if (profile.equipment > 0) {
    components.push({
      componentId: randomUUID(),
      status: "suggested",
      costType: "equipment",
      designation: `Materiel de pose - ${input.candidate.designation}`,
      unit: effectiveUnit === "u" ? "u" : effectiveUnit,
      quantity: roundQuantity(Math.max(quantity * 0.05, 1)),
      unitCostHtCents: profile.equipment,
      lossCoeffBp: 0,
      yieldValue: null,
      yieldUnit: null,
      confidence: clampConfidence(input.candidate.confidence - 0.12),
      sourceLabel: extraReferenceFragments[0]?.label ?? "Hypothese de pose",
      dsCents: computeComponentDsCents({
        quantity: roundQuantity(Math.max(quantity * 0.05, 1)),
        unitCostHtCents: profile.equipment,
        lossCoeffBp: 0,
      }),
      facts: [],
      hypotheses: [
        "Materiel de pose ajoute a titre indicatif pour couvrir les moyens d'execution.",
      ],
      inferences: [
        "Equipement deduit du type d'ouvrage, sans pricebook confirme.",
      ],
      riskSignals: sharedRiskSignals,
      sources: extraReferenceFragments.slice(0, 1).map((fragment) =>
        mapSubdetailSource(
          fragment,
          "hypothesis",
          "Reference interne indicative"
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
      return {
        componentId: item.id,
        status: item.status,
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
      dsCents:
        typeof summaryRecord.ds_cents === "number"
          ? summaryRecord.ds_cents
          : computedSummary.dsCents,
      indicativeTargetPriceCents:
        typeof summaryRecord.indicative_target_price_cents === "number"
          ? summaryRecord.indicative_target_price_cents
          : computedSummary.indicativeTargetPriceCents,
      confidence:
        typeof summaryRecord.confidence === "number"
          ? clampConfidence(summaryRecord.confidence)
          : computedSummary.confidence,
      pricingSource:
        toNullableText(
          typeof summaryRecord.pricing_source === "string"
            ? summaryRecord.pricing_source
            : null
        ) ?? computedSummary.pricingSource,
      riskSignals:
        normalizeRiskSignals(summaryRecord.risk_signals).length > 0
          ? normalizeRiskSignals(summaryRecord.risk_signals)
          : computedSummary.riskSignals,
      facts:
        readJsonStringArray(summaryRecord.facts).length > 0
          ? readJsonStringArray(summaryRecord.facts)
          : computedSummary.facts,
      hypotheses:
        readJsonStringArray(summaryRecord.hypotheses).length > 0
          ? readJsonStringArray(summaryRecord.hypotheses)
          : computedSummary.hypotheses,
      inferences:
        readJsonStringArray(summaryRecord.inferences).length > 0
          ? readJsonStringArray(summaryRecord.inferences)
          : computedSummary.inferences,
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

async function loadGeneratedOuvrageSubdetail(input: {
  supabase: Supabase;
  tenantId: string;
  draftId: string;
  candidateId: string;
}) {
  const [draftResult, itemResult, itemSourceResult] = await Promise.all([
    input.supabase
      .from("estimate_generated_ouvrage_subdetail_drafts" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .eq("draft_id", input.draftId)
      .eq("parent_work_id", input.candidateId)
      .maybeSingle(),
    input.supabase
      .from("estimate_generated_ouvrage_subdetail_items" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .eq("draft_id", input.draftId)
      .eq("parent_work_id", input.candidateId)
      .order("component_order", { ascending: true }),
    input.supabase
      .from("estimate_generated_ouvrage_subdetail_item_sources" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .eq("draft_id", input.draftId)
      .eq("parent_work_id", input.candidateId)
      .order("source_rank", { ascending: true }),
  ]);

  if (draftResult.error) {
    throw mapSupabaseError(
      draftResult.error as never,
      "Impossible de charger le sous-detail persiste."
    );
  }

  if (itemResult.error) {
    throw mapSupabaseError(
      itemResult.error as never,
      "Impossible de charger les composants du sous-detail."
    );
  }

  if (itemSourceResult.error) {
    throw mapSupabaseError(
      itemSourceResult.error as never,
      "Impossible de charger la provenance du sous-detail."
    );
  }

  return {
    draft:
      (draftResult.data as GeneratedOuvrageSubdetailDraftRow | null | undefined) ??
      null,
    items: (itemResult.data ?? []) as GeneratedOuvrageSubdetailItemRow[],
    itemSources:
      (itemSourceResult.data ?? []) as GeneratedOuvrageSubdetailItemSourceRow[],
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

function pickPrimaryFragment(
  fragmentSources: GeneratedOuvrageCandidateSource[]
): GeneratedOuvrageCandidateSource | null {
  return fragmentSources[0] ?? null;
}

async function persistGeneratedOuvrageSubdetail(input: {
  supabase: Supabase;
  tenantId: string;
  projectId: string;
  versionId: string;
  draftId: string;
  candidateId: string;
  userId: string;
  existing: GeneratedOuvrageSubdetailDraftRow | null;
  status: GeneratedOuvrageSubdetailDraftStatus;
  summary: GeneratedOuvrageSubdetailSummary;
  generationMetadata: JsonRecord;
  components: UpdateGeneratedOuvrageSubdetailInput["components"];
}) {
  const summaryPayload = {
    component_count: input.summary.componentCount,
    ds_cents: input.summary.dsCents,
    indicative_target_price_cents: input.summary.indicativeTargetPriceCents,
    confidence: input.summary.confidence,
    pricing_source: input.summary.pricingSource,
    risk_signals: input.summary.riskSignals,
    facts: input.summary.facts,
    hypotheses: input.summary.hypotheses,
    inferences: input.summary.inferences,
    margin_multiplier: input.generationMetadata.margin_multiplier ?? null,
  } satisfies JsonRecord;

  const persistedDraftResponse = (input.existing === null
    ? await input.supabase
        .from("estimate_generated_ouvrage_subdetail_drafts" as never)
        .insert({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          target_version_id: input.versionId,
          draft_id: input.draftId,
          parent_work_id: input.candidateId,
          created_by: input.userId,
          status: input.status,
          summary: summaryPayload,
          generation_metadata: input.generationMetadata,
        } as never)
        .select("*" as never)
        .single()
    : await input.supabase
        .from("estimate_generated_ouvrage_subdetail_drafts" as never)
        .update({
          status: input.status,
          summary: summaryPayload,
          generation_metadata: input.generationMetadata,
          applied_at: input.status === "applied" ? new Date().toISOString() : null,
        } as never)
        .eq("id", input.existing.id)
        .select("*" as never)
        .single()) as {
    data: unknown;
    error: { message?: string; code?: string } | null;
  };

  if (persistedDraftResponse.error || !persistedDraftResponse.data) {
    throw mapSupabaseError(
      persistedDraftResponse.error as never,
      "Impossible de persister le brouillon de sous-detail."
    );
  }

  const subdetailDraft = persistedDraftResponse.data as GeneratedOuvrageSubdetailDraftRow;

  const { error: deleteItemsError } = await input.supabase
    .from("estimate_generated_ouvrage_subdetail_items" as never)
    .delete()
    .eq("subdetail_id", subdetailDraft.id);

  if (deleteItemsError) {
    throw mapSupabaseError(
      deleteItemsError,
      "Impossible de remplacer les composants du sous-detail."
    );
  }

  const componentRows = input.components.map((component, index) => ({
    tenant_id: input.tenantId,
    project_id: input.projectId,
    draft_id: input.draftId,
    subdetail_id: subdetailDraft.id,
    parent_work_id: input.candidateId,
    source_fragment_id: component.sources[0]?.sourceFragmentId ?? null,
    component_order: index,
    status: component.status,
    cost_type: component.costType,
    designation: normalizeText(component.designation, 500),
    unit: toNullableText(component.unit),
    quantity: roundQuantity(component.quantity),
    unit_cost_ht_cents: component.unitCostHtCents,
    loss_coeff_bp: component.lossCoeffBp,
    yield_value: component.yieldValue ?? null,
    yield_unit: toNullableText(component.yieldUnit),
    confidence: clampConfidence(component.confidence),
    source_label: toNullableText(component.sourceLabel),
    facts: component.facts,
    hypotheses: component.hypotheses,
    inferences: component.inferences,
    metadata: {
      risk_signals: component.riskSignals,
    },
  }));

  const { data: insertedItems, error: insertItemsError } = await input.supabase
    .from("estimate_generated_ouvrage_subdetail_items" as never)
    .insert(componentRows as never)
    .select("*" as never)
    .order("component_order", { ascending: true });

  if (insertItemsError || !insertedItems) {
    throw mapSupabaseError(
      insertItemsError,
      "Impossible de persister les composants du sous-detail."
    );
  }

  const subdetailItems = insertedItems as GeneratedOuvrageSubdetailItemRow[];
  const sourceRows = subdetailItems.flatMap((item, index) => {
    const component = input.components[index];
    return component.sources.map((source, sourceRank) => ({
      tenant_id: input.tenantId,
      draft_id: input.draftId,
      subdetail_id: subdetailDraft.id,
      parent_work_id: input.candidateId,
      component_id: item.id,
      source_fragment_id: source.sourceFragmentId,
      source_rank: sourceRank,
      evidence_kind: source.evidenceKind,
      note: toNullableText(source.note),
      metadata: {},
    }));
  });

  if (sourceRows.length > 0) {
    const { error: insertSourcesError } = await input.supabase
      .from("estimate_generated_ouvrage_subdetail_item_sources" as never)
      .insert(sourceRows as never);

    if (insertSourcesError) {
      throw mapSupabaseError(
        insertSourcesError,
        "Impossible de persister les preuves du sous-detail."
      );
    }
  }

  return {
    draft: subdetailDraft,
    items: subdetailItems,
  };
}

async function resolveGeneratedOuvrageTargetSection(input: {
  supabase: Supabase;
  tenantId: string;
  versionId: string;
  draftId: string;
  requestedLotId: string | null;
}) {
  if (input.requestedLotId) {
    return {
      parentId: input.requestedLotId,
      placementMode: "explicit" as const,
      lotLabel: null,
      createdFallbackSection: false,
    };
  }

  const { data, error } = await input.supabase
    .from("estimate_items")
    .select("id, title")
    .eq("tenant_id", input.tenantId)
    .eq("version_id", input.versionId)
    .eq("item_type", "section")
    .is("parent_id", null)
    .order("position", { ascending: true });

  if (error) {
    throw mapSupabaseError(
      error,
      "Impossible de rechercher la section de classement des ouvrages generes."
    );
  }

  const fallbackSection =
    ((data ?? []) as Array<Pick<EstimateItemRow, "id" | "title">>).find(
      (item) =>
        normalizeSectionTitle(item.title) ===
        normalizeSectionTitle(GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE)
    ) ?? null;

  if (fallbackSection) {
    return {
      parentId: fallbackSection.id,
      placementMode: "fallback_unclassified" as const,
      lotLabel: fallbackSection.title ?? GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE,
      createdFallbackSection: false,
    };
  }

  const createdSection = await createEstimateItem(input.versionId, {
    item_type: "section",
    parent_id: null,
    title: GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE,
    source_provider: "generated_ouvrage",
  });

  return {
    parentId: createdSection.item.id,
    placementMode: "fallback_unclassified" as const,
    lotLabel: GENERATED_OUVRAGE_FALLBACK_SECTION_TITLE,
    createdFallbackSection: true,
  };
}

async function rollbackInsertedGeneratedOuvrages(input: {
  supabase: Supabase;
  versionId: string;
  createdEstimateItemIds: string[];
  createdAssemblyIds: string[];
  candidateReverts: Array<{
    candidateId: string;
    resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
    metadata: Json;
  }>;
}) {
  if (input.createdEstimateItemIds.length > 0) {
    const { error: deleteItemsError } = await input.supabase
      .from("estimate_items" as never)
      .delete()
      .eq("version_id", input.versionId)
      .in("id", input.createdEstimateItemIds);

    if (deleteItemsError) {
      throw mapSupabaseError(
        deleteItemsError,
        "Impossible de restaurer les lignes d'estimation apres un echec d'insertion."
      );
    }
  }

  if (input.createdAssemblyIds.length > 0) {
    const { error: deleteAssembliesError } = await input.supabase
      .from("estimate_assemblies" as never)
      .delete()
      .in("id", input.createdAssemblyIds);

    if (deleteAssembliesError) {
      throw mapSupabaseError(
        deleteAssembliesError,
        "Impossible de restaurer les ouvrages composes apres un echec d'insertion."
      );
    }
  }

  for (const revert of input.candidateReverts) {
    const { error: revertCandidateError } = await input.supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .update({
        resolution_status: revert.resolutionStatus,
        metadata: revert.metadata,
      } as never)
      .eq("id", revert.candidateId);

    if (revertCandidateError) {
      throw mapSupabaseError(
        revertCandidateError,
        "Impossible de restaurer le statut d'un candidat d'ouvrage apres un echec d'insertion."
      );
    }
  }
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
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  if (project.id !== parsed.projectId) {
    throw notFound("Affaire introuvable.");
  }

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
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
    throw mapSupabaseError(draftError, "Impossible de creer le brouillon d'ouvrages.");
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
      await discardGeneratedOuvrageDraftOnFailure({
        supabase,
        draftId: draft.id,
      });
    } catch (cleanupError) {
      throw internalError(
        "La generation du brouillon a echoue et son archivage automatique a aussi echoue.",
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

  await discardPendingGeneratedOuvrageDrafts({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
    excludeDraftId: draft.id,
  });

  if (!updatedDraft || !generation) {
    throw internalError(
      "Le brouillon d'ouvrages genere est incomplet apres materialisation.",
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
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });
  const candidate = loaded.candidates.find((entry) => entry.id === parsed.candidateId);

  if (!candidate) {
    throw notFound("Ouvrage parent introuvable.");
  }

  const existing = await loadGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
  });

  const fragments = loaded.fragments;
  if (existing.draft && existing.items.length > 0) {
    return mapSubdetailRowsToResult({
      draft: existing.draft,
      items: existing.items,
      itemSources: existing.itemSources,
      fragments,
    });
  }

  const normalizedDraft = normalizeDraftResult(loaded);
  const candidateSources =
    normalizedDraft.candidates.find((entry) => entry.candidateId === parsed.candidateId)
      ?.sources ?? [];
  const generated = generateInitialSubdetailComponents({
    candidate,
    candidateSources,
    draftFragments: fragments,
    marginMultiplier: version.margin_multiplier,
  });
  const summary = buildGeneratedOuvrageSubdetailSummary({
    components: generated.components,
    marginMultiplier: version.margin_multiplier,
  });
  const persisted = await persistGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    projectId: project.id,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
    userId,
    existing: existing.draft,
    status: "pending_review",
    summary,
    generationMetadata: {
      ...generated.generationMetadata,
      margin_multiplier: version.margin_multiplier ?? null,
      reviewed_candidate: normalizeReviewedCandidateSnapshot({
        designation: candidate.designation,
        unit: candidate.unit,
        quantity: candidate.quantity,
      }),
    },
    components: generated.components.map((component) => ({
      componentId: component.componentId,
      status: component.status,
      costType: component.costType,
      designation: component.designation,
      unit: component.unit,
      quantity: component.quantity,
      unitCostHtCents: component.unitCostHtCents,
      lossCoeffBp: component.lossCoeffBp,
      yieldValue: component.yieldValue,
      yieldUnit: component.yieldUnit,
      confidence: component.confidence,
      sourceLabel: component.sourceLabel,
      facts: component.facts,
      hypotheses: component.hypotheses,
      inferences: component.inferences,
      riskSignals: component.riskSignals,
      sources: component.sources.map((source) => ({
        sourceFragmentId: source.sourceFragmentId,
        evidenceKind: source.evidenceKind,
        note: source.note,
      })),
    })),
  });

  const reloaded = await loadGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
  });

  return mapSubdetailRowsToResult({
    draft: reloaded.draft ?? persisted.draft,
    items: reloaded.items.length > 0 ? reloaded.items : persisted.items,
    itemSources: reloaded.itemSources,
    fragments,
  });
}

export async function updateGeneratedOuvrageSubdetailDraft(
  input: UpdateGeneratedOuvrageSubdetailInput
): Promise<GeneratedOuvrageSubdetailResult> {
  const parsed = generatedOuvrageSubdetailUpdateInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });
  const candidate = loaded.candidates.find((entry) => entry.id === parsed.candidateId);

  if (!candidate) {
    throw notFound("Ouvrage parent introuvable.");
  }

  if (candidate.resolution_status !== "pending") {
    throw conflict(
      "Le sous-detail n'est editable que tant que l'ouvrage parent est en attente.",
      { candidateId: candidate.id, status: candidate.resolution_status },
      "EST383_CANDIDATE_NOT_PENDING"
    );
  }

  const existing = await loadGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
  });
  const normalizedComponents = parsed.components.map((component) => ({
    ...component,
    designation: normalizeText(component.designation, 500),
    unit: toNullableText(component.unit),
    yieldUnit: toNullableText(component.yieldUnit),
    sourceLabel: toNullableText(component.sourceLabel),
    facts: component.facts.map((entry) => normalizeText(entry, 320)),
    hypotheses: component.hypotheses.map((entry) => normalizeText(entry, 320)),
    inferences: component.inferences.map((entry) => normalizeText(entry, 320)),
  }));

  const summary = buildGeneratedOuvrageSubdetailSummary({
    components: normalizedComponents.map((component, index) => ({
      componentId: component.componentId ?? `component-${index}`,
      status: component.status,
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

  await persistGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    projectId: project.id,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
    userId,
    existing: existing.draft,
    status: parsed.markReviewed ? "reviewed" : "pending_review",
    summary,
    generationMetadata,
    components: normalizedComponents,
  });

  const reloaded = await loadGeneratedOuvrageSubdetail({
    supabase,
    tenantId,
    draftId: parsed.draftId,
    candidateId: parsed.candidateId,
  });

  if (!reloaded.draft) {
    throw internalError(
      "Le sous-detail n'a pas pu etre recharge apres sauvegarde.",
      { draftId: parsed.draftId, candidateId: parsed.candidateId },
      "EST383_SUBDETAIL_RELOAD_MISSING"
    );
  }

  return mapSubdetailRowsToResult({
    draft: reloaded.draft,
    items: reloaded.items,
    itemSources: reloaded.itemSources,
    fragments: loaded.fragments,
  });
}

export async function insertGeneratedOuvrages(
  input: InsertGeneratedOuvragesInput
): Promise<InsertGeneratedOuvragesResult> {
  const parsed = generatedOuvrageInsertInputSchema.parse(input);
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  const { version, project } = await getVersionAccessOrThrow(
    supabase,
    parsed.versionId,
    context
  );

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: parsed.versionId,
    draftId: parsed.draftId,
  });

  if (loaded.draft.status === "discarded") {
    throw conflict("Ce brouillon a deja ete rejete.", undefined, "EST381_DRAFT_DISCARDED");
  }

  const candidateById = new Map(
    loaded.candidates.map((candidate) => [candidate.id, candidate] as const)
  );
  const existingApplicationsByCandidateId = new Map(
    loaded.applications.map((application) => [application.candidate_id, application] as const)
  );
  const candidateSourcesByCandidateId = new Map<string, GeneratedOuvrageCandidateSource[]>();

  const normalizedDraft = normalizeDraftResult(loaded);
  for (const candidate of normalizedDraft.candidates) {
    candidateSourcesByCandidateId.set(candidate.candidateId, candidate.sources);
  }

  const seenAcceptedCandidateIds = new Set<string>();
  const preparedAcceptedCandidates = parsed.acceptedCandidates.map((acceptedCandidate) => {
    const candidate = candidateById.get(acceptedCandidate.candidateId);
    if (!candidate) {
      throw notFound("Candidat d'ouvrage introuvable.");
    }

    if (seenAcceptedCandidateIds.has(candidate.id)) {
      throw conflict(
        "Ce candidat d'ouvrage est present plusieurs fois dans le lot d'insertion.",
        { candidateId: candidate.id },
        "EST381_DUPLICATE_ACCEPTED_CANDIDATE"
      );
    }
    seenAcceptedCandidateIds.add(candidate.id);

    if (candidate.resolution_status !== "pending") {
      throw conflict(
        "Ce candidat n'est plus disponible pour insertion.",
        { candidateId: candidate.id, status: candidate.resolution_status },
        "EST381_CANDIDATE_NOT_PENDING"
      );
    }

    if (existingApplicationsByCandidateId.has(candidate.id)) {
      throw conflict(
        "Ce candidat a deja ete applique.",
        { candidateId: candidate.id },
        "EST381_CANDIDATE_ALREADY_APPLIED"
      );
    }

    if (typeof acceptedCandidate.quantity !== "number") {
      throw badRequest(
        "La quantite doit etre renseignee avant l'insertion du candidat.",
        { candidateId: candidate.id },
        "EST381_CANDIDATE_QUANTITY_REQUIRED"
      );
    }

    const fragmentSources = candidateSourcesByCandidateId.get(candidate.id) ?? [];
    const primaryFragment = pickPrimaryFragment(fragmentSources);
    const designation = normalizeText(acceptedCandidate.designation, 500);
    const appliedPayload = {
      designation,
      unit: toNullableText(acceptedCandidate.unit),
      quantity: acceptedCandidate.quantity,
      lot_id: acceptedCandidate.lotId ?? null,
      suggested_lot_id: candidate.suggested_lot_id,
      ai_status: candidate.ai_status,
      confidence: clampConfidence(candidate.confidence),
      source_fragment_ids: fragmentSources.map((source) => source.sourceFragmentId),
    } satisfies JsonRecord;

    return {
      acceptedCandidate,
      appliedPayload,
      candidate,
      designation,
      primaryFragment,
      quantity: acceptedCandidate.quantity,
    };
  });

  const preparedAcceptedSubdetails = await Promise.all(
    preparedAcceptedCandidates.map(async (preparedCandidate) => {
      const subdetail = await loadGeneratedOuvrageSubdetail({
        supabase,
        tenantId,
        draftId: parsed.draftId,
        candidateId: preparedCandidate.candidate.id,
      });

      if (!subdetail.draft || subdetail.items.length === 0) {
        throw conflict(
          "Le sous-detail doit etre genere puis revu avant insertion.",
          { candidateId: preparedCandidate.candidate.id },
          "EST383_SUBDETAIL_REQUIRED"
        );
      }

      if (subdetail.draft.status !== "reviewed") {
        throw conflict(
          "Le sous-detail doit etre explicitement valide avant insertion.",
          {
            candidateId: preparedCandidate.candidate.id,
            subdetailStatus: subdetail.draft.status,
          },
          "EST383_SUBDETAIL_NOT_REVIEWED"
        );
      }

      const reviewedMetadata =
        subdetail.draft.generation_metadata && typeof subdetail.draft.generation_metadata === "object"
          ? (subdetail.draft.generation_metadata as JsonRecord)
          : {};
      const reviewedCandidate =
        readReviewedCandidateSnapshot(reviewedMetadata.reviewed_candidate) ??
        normalizeReviewedCandidateSnapshot({
          designation: preparedCandidate.candidate.designation,
          unit: preparedCandidate.candidate.unit,
          quantity: preparedCandidate.candidate.quantity,
        });
      const acceptedReviewSnapshot = normalizeReviewedCandidateSnapshot({
        designation: preparedCandidate.designation,
        unit: preparedCandidate.acceptedCandidate.unit,
        quantity: preparedCandidate.quantity,
      });

      if (
        !reviewedCandidateMatches({
          acceptedCandidate: acceptedReviewSnapshot,
          reviewedCandidate,
        })
      ) {
        throw conflict(
          "Le sous-detail valide ne correspond plus aux valeurs actuelles du candidat. Merci de revalider le sous-detail.",
          {
            candidateId: preparedCandidate.candidate.id,
            reviewedCandidate,
            acceptedCandidate: acceptedReviewSnapshot,
          },
          "EST383_SUBDETAIL_STALE"
        );
      }

      return {
        ...preparedCandidate,
        subdetailDraft: subdetail.draft,
        subdetailItems: subdetail.items,
        subdetailItemSources: subdetail.itemSources,
      };
    })
  );

  let insertedCount = 0;
  const refreshedApplications = [...loaded.applications];
  const refreshedCandidates = [...loaded.candidates];
  const createdEstimateItemIds: string[] = [];
  const createdAssemblyIds: string[] = [];
  const candidateReverts: Array<{
    candidateId: string;
    resolutionStatus: GeneratedOuvrageCandidateResolutionStatus;
    metadata: Json;
  }> = [];
  const appliedSubdetailIds: string[] = [];
  let updatedDraft: GeneratedOuvrageDraftRow | null = null;
  let fallbackTargetSection:
    | {
        parentId: string;
        placementMode: "fallback_unclassified";
        lotLabel: string | null;
        createdFallbackSection: boolean;
      }
    | null = null;
  const preferredLaborRole = await loadPreferredGeneratedOuvrageLaborRole({
    supabase,
    tenantId,
    ownerUserId: project.user_id,
  });

  try {
    for (const preparedCandidate of preparedAcceptedSubdetails) {
      const {
        acceptedCandidate,
        appliedPayload,
        candidate,
        designation,
        primaryFragment,
        quantity,
        subdetailDraft,
        subdetailItems,
        subdetailItemSources,
      } = preparedCandidate;

      const resolvedTargetSection: {
        parentId: string;
        placementMode: "explicit" | "fallback_unclassified";
        lotLabel: string | null;
        createdFallbackSection: boolean;
      } =
        acceptedCandidate.lotId
          ? {
              parentId: acceptedCandidate.lotId,
              placementMode: "explicit" as const,
              lotLabel: candidate.lot_label ?? null,
              createdFallbackSection: false,
            }
          : fallbackTargetSection ??
            (await resolveGeneratedOuvrageTargetSection({
              supabase,
              tenantId,
              versionId: parsed.versionId,
              draftId: loaded.draft.id,
              requestedLotId: null,
            }));

      if (!acceptedCandidate.lotId) {
        fallbackTargetSection = {
          parentId: resolvedTargetSection.parentId,
          placementMode: "fallback_unclassified",
          lotLabel: resolvedTargetSection.lotLabel,
          createdFallbackSection: resolvedTargetSection.createdFallbackSection,
        };
      }

      const subdetailResult = mapSubdetailRowsToResult({
        draft: subdetailDraft,
        items: subdetailItems,
        itemSources: subdetailItemSources,
        fragments: loaded.fragments,
      });
      const estimateItemMapping = buildGeneratedOuvrageEstimateItemMapping({
        components: subdetailResult.components,
        parentQuantity: quantity,
        laborRole: preferredLaborRole,
      });

      const nextAppliedPayload = {
        ...appliedPayload,
        lot_id: resolvedTargetSection.parentId,
        requested_lot_id: acceptedCandidate.lotId ?? null,
        resolved_lot_id: resolvedTargetSection.parentId,
        resolved_lot_label: resolvedTargetSection.lotLabel,
        placement_mode: resolvedTargetSection.placementMode,
        fallback_section_created: resolvedTargetSection.createdFallbackSection,
        estimate_item_mapping: estimateItemMapping,
      } satisfies JsonRecord;

      const assemblyName = `${designation} · ${candidate.id.slice(0, 8)}`;
      const assemblySourceMetadata = {
        kind: "generated_ouvrage",
        draft_id: loaded.draft.id,
        candidate_id: candidate.id,
        source_fragment_ids: appliedPayload.source_fragment_ids,
        summary: subdetailResult.summary,
        estimate_item_mapping: estimateItemMapping,
      } satisfies JsonRecord;

      const { data: assemblyData, error: assemblyError } = await supabase
        .from("estimate_assemblies" as never)
        .insert({
          tenant_id: tenantId,
          created_by: userId,
          name: assemblyName,
          description: `Ouvrage compose genere depuis ${designation}`,
          reference_code: `EST383-${candidate.id.slice(0, 8).toUpperCase()}`,
          unit: toNullableText(acceptedCandidate.unit) ?? candidate.unit ?? null,
          pricing_source: "generated_ouvrage_review",
          ds_cents: subdetailResult.summary.dsCents,
          indicative_target_price_cents:
            subdetailResult.summary.indicativeTargetPriceCents,
          avg_output_rate: null,
          avg_time_hours: null,
          source_metadata: assemblySourceMetadata,
        } as never)
        .select("*" as never)
        .single();

      if (assemblyError || !assemblyData) {
        throw mapSupabaseError(
          assemblyError,
          "Impossible de creer l'ouvrage compose canonique."
        );
      }

      const assembly = assemblyData as {
        id: string;
        name: string;
        reference_code: string | null;
      };
      createdAssemblyIds.push(assembly.id);

      const assemblyItemRows = subdetailResult.components.map((component, index) => ({
        tenant_id: tenantId,
        assembly_id: assembly.id,
        title: component.designation,
        unit: component.unit,
        k_fo: component.costType === "labor" ? 0 : 1,
        k_mo: component.costType === "labor" ? 1 : 0,
        labor_role_id: null,
        default_quantity: component.quantity,
        position: index + 1,
        cost_type: component.costType,
        unit_cost_ht_cents: component.unitCostHtCents,
        loss_coeff_bp: component.lossCoeffBp,
        yield_value: component.yieldValue,
        yield_unit: component.yieldUnit,
        source_metadata: {
          source_label: component.sourceLabel,
          confidence: component.confidence,
          facts: component.facts,
          hypotheses: component.hypotheses,
          inferences: component.inferences,
          risk_signals: component.riskSignals,
          sources: component.sources,
        },
      }));

      const { error: assemblyItemsError } = await supabase
        .from("estimate_assembly_items" as never)
        .insert(assemblyItemRows as never);

      if (assemblyItemsError) {
        throw mapSupabaseError(
          assemblyItemsError,
          "Impossible de persister les composants de l'ouvrage compose."
        );
      }

      const createResult = await createEstimateItem(parsed.versionId, {
        item_type: "line",
        parent_id: resolvedTargetSection.parentId,
        title: designation,
        quantity,
        unit_price_ht_cents: estimateItemMapping.unitPriceHtCents,
        h_mo: estimateItemMapping.hMo,
        k_fo: estimateItemMapping.kFo,
        k_mo: estimateItemMapping.kMo,
        labor_role_id: estimateItemMapping.laborRoleId,
        source_provider: "generated_ouvrage",
        source_file_name: primaryFragment?.sourceFileName ?? null,
        source_page: primaryFragment?.sourcePageFrom ?? null,
      });

      createdEstimateItemIds.push(createResult.item.id);

      const { data: applicationData, error: applicationError } = await supabase
        .from("estimate_generated_ouvrage_applications" as never)
        .insert({
          tenant_id: tenantId,
          draft_id: loaded.draft.id,
          candidate_id: candidate.id,
          target_version_id: parsed.versionId,
          estimate_item_id: createResult.item.id,
          applied_by: userId,
          applied_payload: nextAppliedPayload,
        } as never)
        .select("*" as never)
        .single();

      if (applicationError || !applicationData) {
        throw mapSupabaseError(
          applicationError,
          "Impossible de tracer l'application du candidat d'ouvrage."
        );
      }

      const { error: snapshotError } = await supabase
        .from("estimate_generated_ouvrage_work_snapshots" as never)
        .insert({
          tenant_id: tenantId,
          project_id: loaded.draft.project_id,
          target_version_id: parsed.versionId,
          draft_id: loaded.draft.id,
          parent_work_id: candidate.id,
          assembly_id: assembly.id,
          estimate_item_id: createResult.item.id,
          applied_by: userId,
          summary: {
            ...subdetailResult.summary,
            assembly_name: assembly.name,
            assembly_reference_code: assembly.reference_code,
          },
          components: subdetailResult.components,
          metadata: {
            applied_values: nextAppliedPayload,
            estimate_item_mapping: estimateItemMapping,
            ai_status: candidate.ai_status,
            confidence: clampConfidence(candidate.confidence),
          },
        } as never);

      if (snapshotError) {
        throw mapSupabaseError(
          snapshotError,
          "Impossible de figer le snapshot du sous-detail applique."
        );
      }

      const nextCandidateMetadata = {
        ...(candidate.metadata && typeof candidate.metadata === "object"
          ? (candidate.metadata as JsonRecord)
          : {}),
        applied_at: new Date().toISOString(),
        applied_by: userId,
        assembly_id: assembly.id,
        subdetail_id: subdetailDraft.id,
        ds_cents: subdetailResult.summary.dsCents,
        indicative_target_price_cents:
          subdetailResult.summary.indicativeTargetPriceCents,
      };

      const { data: updatedCandidateData, error: updatedCandidateError } = await supabase
        .from("estimate_generated_ouvrage_candidates" as never)
        .update({
          resolution_status: "inserted",
          metadata: nextCandidateMetadata,
        } as never)
        .eq("id", candidate.id)
        .select("*" as never)
        .single();

      if (updatedCandidateError || !updatedCandidateData) {
        throw mapSupabaseError(
          updatedCandidateError,
          "Impossible de mettre a jour le statut du candidat d'ouvrage."
        );
      }

      candidateReverts.push({
        candidateId: candidate.id,
        resolutionStatus: candidate.resolution_status,
        metadata: candidate.metadata,
      });
      existingApplicationsByCandidateId.set(
        candidate.id,
        applicationData as GeneratedOuvrageApplicationRow
      );
      refreshedApplications.push(applicationData as GeneratedOuvrageApplicationRow);
      appliedSubdetailIds.push(subdetailDraft.id);

      const candidateIndex = refreshedCandidates.findIndex((entry) => entry.id === candidate.id);
      if (candidateIndex >= 0) {
        refreshedCandidates[candidateIndex] = updatedCandidateData as GeneratedOuvrageCandidateRow;
      }

      insertedCount += 1;
    }

    updatedDraft = await updateDraftProjection({
      supabase,
      draft: loaded.draft,
      candidates: refreshedCandidates,
      applications: refreshedApplications,
    });

    if (appliedSubdetailIds.length > 0) {
      const { error: appliedSubdetailsError } = await supabase
        .from("estimate_generated_ouvrage_subdetail_drafts" as never)
        .update({
          status: "applied",
          applied_at: new Date().toISOString(),
        } as never)
        .in("id", Array.from(new Set(appliedSubdetailIds)));

      if (appliedSubdetailsError) {
        throw mapSupabaseError(
          appliedSubdetailsError,
          "Impossible de finaliser le statut applique du sous-detail."
        );
      }
    }
  } catch (error) {
    try {
      await rollbackInsertedGeneratedOuvrages({
        supabase,
        versionId: parsed.versionId,
        createdEstimateItemIds,
        createdAssemblyIds,
        candidateReverts,
      });
    } catch (rollbackError) {
      throw internalError(
        "L'insertion des ouvrages a echoue et la restauration automatique est incomplete.",
        {
          draftId: loaded.draft.id,
          cause: error,
          rollbackError,
        },
        "EST381_INSERT_ROLLBACK_FAILED"
      );
    }

    throw error;
  }

  if (!updatedDraft) {
    throw internalError(
      "Le brouillon d'ouvrages n'a pas pu etre actualise apres insertion.",
      { draftId: loaded.draft.id },
      "EST381_INSERT_DRAFT_UPDATE_MISSING"
    );
  }

  if (insertedCount > 0) {
    await logEstimateVersionEventIfPossible({
      versionId: parsed.versionId,
      eventType: "generated_ouvrage_inserted",
      actorUserId: userId,
      metadata: {
        draft_id: loaded.draft.id,
        inserted_count: insertedCount,
        candidate_ids: parsed.acceptedCandidates.map((candidate) => candidate.candidateId),
      },
    });
  }

  return {
    ok: true,
    insertedCount,
    draftStatus: updatedDraft?.status ?? loaded.draft.status,
    projectId: loaded.draft.project_id,
    versionId: parsed.versionId,
  };
}

export async function rejectGeneratedOuvrageDraft(
  input: RejectGeneratedOuvrageDraftInput
): Promise<RejectGeneratedOuvrageDraftResult> {
  const parsed = generatedOuvrageRejectInputSchema.parse({
    ...input,
    reason: input.reason ? normalizeText(input.reason, MAX_REASON_LENGTH) : null,
  });

  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;

  const { data: draftData, error: draftLookupError } = await supabase
    .from("estimate_generated_ouvrage_drafts" as never)
    .select("*" as never)
    .eq("tenant_id", tenantId)
    .eq("id", parsed.draftId)
    .single();

  if (draftLookupError || !draftData) {
    throw mapSupabaseError(draftLookupError, "Impossible de charger le brouillon d'ouvrages.");
  }

  const draft = draftData as GeneratedOuvrageDraftRow;
  const { version } = await getVersionAccessOrThrow(supabase, draft.target_version_id, context);

  assertDraftStatus(version.status);
  await assertDraftLockOwnedByCurrentUser({
    supabase,
    tenantId,
    versionId: draft.target_version_id,
    userId,
  });

  const loaded = await loadGeneratedOuvrageDraftOrThrow({
    supabase,
    tenantId,
    versionId: draft.target_version_id,
    draftId: draft.id,
  });

  if (loaded.draft.status === "discarded") {
    throw conflict("Ce brouillon a deja ete rejete.", undefined, "EST381_DRAFT_DISCARDED");
  }

  const candidate = loaded.candidates.find((entry) => entry.id === parsed.candidateId);
  if (!candidate) {
    throw notFound("Candidat d'ouvrage introuvable.");
  }

  if (candidate.resolution_status !== "pending") {
    throw conflict(
      "Ce candidat n'est plus disponible pour rejet.",
      { candidateId: candidate.id, status: candidate.resolution_status },
      "EST381_CANDIDATE_NOT_PENDING"
    );
  }

  const nextMetadata = {
    ...(candidate.metadata && typeof candidate.metadata === "object"
      ? (candidate.metadata as JsonRecord)
      : {}),
    rejection_reason: parsed.reason ?? null,
    rejected_at: new Date().toISOString(),
    rejected_by: userId,
  } satisfies JsonRecord;

  const { data: updatedCandidateData, error: updatedCandidateError } = await supabase
    .from("estimate_generated_ouvrage_candidates" as never)
    .update({
      resolution_status: "rejected",
      metadata: nextMetadata,
    } as never)
    .eq("id", candidate.id)
    .select("*" as never)
    .single();

  if (updatedCandidateError || !updatedCandidateData) {
    throw mapSupabaseError(
      updatedCandidateError,
      "Impossible de mettre a jour le statut du candidat d'ouvrage."
    );
  }

  const refreshedCandidates = loaded.candidates.map((entry) =>
    entry.id === candidate.id
      ? (updatedCandidateData as GeneratedOuvrageCandidateRow)
      : entry
  );

  const updatedDraft = await updateDraftProjection({
    supabase,
    draft: loaded.draft,
    candidates: refreshedCandidates,
    applications: loaded.applications,
  });

  if (updatedDraft.status === "discarded") {
    const { error: fragmentError } = await supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .update({
        status: "discarded",
      } as never)
      .eq("draft_id", updatedDraft.id);

    if (fragmentError) {
      throw mapSupabaseError(
        fragmentError,
        "Impossible d'archiver les fragments du brouillon rejete."
      );
    }

    await logEstimateVersionEventIfPossible({
      versionId: updatedDraft.target_version_id,
      eventType: "generated_ouvrage_discarded",
      actorUserId: userId,
      metadata: {
        draft_id: updatedDraft.id,
        reason: parsed.reason ?? null,
      },
    });
  }

  return {
    ok: true,
    draftStatus: updatedDraft.status,
    projectId: updatedDraft.project_id,
    versionId: updatedDraft.target_version_id,
  };
}

export async function enrichEstimateItemsWithGeneratedOuvrageProvenance(input: {
  supabase: Supabase;
  tenantId: string;
  items: EstimateItemRow[];
}) {
  const itemIds = input.items.map((item) => item.id);

  if (itemIds.length === 0) {
    return input.items;
  }

  const { data: applicationData, error: applicationError } = await input.supabase
    .from("estimate_generated_ouvrage_applications" as never)
    .select("*" as never)
    .eq("tenant_id", input.tenantId)
    .in("estimate_item_id", itemIds);

  if (applicationError || !applicationData || applicationData.length === 0) {
    return input.items;
  }

  const applications = applicationData as GeneratedOuvrageApplicationRow[];
  const candidateIds = Array.from(new Set(applications.map((row) => row.candidate_id)));
  const draftIds = Array.from(new Set(applications.map((row) => row.draft_id)));

  const [
    candidateResult,
    draftResult,
    candidateSourceResult,
    fragmentResult,
    snapshotResult,
  ] = await Promise.all([
    input.supabase
      .from("estimate_generated_ouvrage_candidates" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_drafts" as never)
      .select("id, created_at, generation_metadata" as never)
      .eq("tenant_id", input.tenantId)
      .in("id", draftIds),
    input.supabase
      .from("estimate_generated_ouvrage_candidate_sources" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("candidate_id", candidateIds),
    input.supabase
      .from("estimate_generated_ouvrage_source_fragments" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("draft_id", draftIds),
    input.supabase
      .from("estimate_generated_ouvrage_work_snapshots" as never)
      .select("*" as never)
      .eq("tenant_id", input.tenantId)
      .in("estimate_item_id", itemIds),
  ]);

  if (
    candidateResult.error ||
    draftResult.error ||
    candidateSourceResult.error ||
    fragmentResult.error ||
    snapshotResult.error
  ) {
    return input.items;
  }

  const candidateById = new Map(
    ((candidateResult.data ?? []) as GeneratedOuvrageCandidateRow[]).map((row) => [
      row.id,
      row,
    ] as const)
  );
  const draftById = new Map(
    ((draftResult.data ?? []) as Array<{
      id: string;
      created_at: string;
      generation_metadata: Json;
    }>).map((row) => [row.id, row] as const)
  );
  const fragmentById = new Map(
    ((fragmentResult.data ?? []) as GeneratedOuvrageSourceFragmentRow[]).map((row) => [
      row.id,
      row,
    ] as const)
  );

  const sourceRowsByCandidateId = new Map<string, GeneratedOuvrageCandidateSourceRow[]>();
  for (const row of (candidateSourceResult.data ?? []) as GeneratedOuvrageCandidateSourceRow[]) {
    const current = sourceRowsByCandidateId.get(row.candidate_id);
    if (current) {
      current.push(row);
    } else {
      sourceRowsByCandidateId.set(row.candidate_id, [row]);
    }
  }

  const applicationByItemId = new Map(
    applications.map((row) => [row.estimate_item_id, row] as const)
  );
  const snapshotByItemId = new Map(
    ((snapshotResult.data ?? []) as GeneratedOuvrageWorkSnapshotRow[]).map((row) => [
      row.estimate_item_id,
      row,
    ] as const)
  );

  return input.items.map((item) => {
    const application = applicationByItemId.get(item.id);
    if (!application) {
      return item;
    }

    const candidate = candidateById.get(application.candidate_id);
    const draft = draftById.get(application.draft_id);
    const sources = (sourceRowsByCandidateId.get(application.candidate_id) ?? [])
      .sort((left, right) => left.source_rank - right.source_rank)
      .map((row) => fragmentById.get(row.source_fragment_id))
      .filter(
        (fragment): fragment is GeneratedOuvrageSourceFragmentRow => Boolean(fragment)
      )
      .map((fragment) => ({
        source_fragment_id: fragment.id,
        source_document_id: fragment.source_document_id,
        type: mapFragmentKindToCandidateSourceType(fragment.source_kind),
        label: fragment.label,
        excerpt: fragment.excerpt,
        source_file_name: fragment.source_file_name,
        source_page_from: fragment.source_page_from,
        source_page_to: fragment.source_page_to,
        selection_label: fragment.selection_label,
      }));

    const generationMetadata =
      draft?.generation_metadata && typeof draft.generation_metadata === "object"
        ? (draft.generation_metadata as JsonRecord)
        : {};

    const appliedPayload =
      application.applied_payload && typeof application.applied_payload === "object"
        ? (application.applied_payload as JsonRecord)
        : {};
    const snapshot = snapshotByItemId.get(item.id);
    const snapshotMetadata =
      snapshot?.metadata && typeof snapshot.metadata === "object"
        ? (snapshot.metadata as JsonRecord)
        : {};
    const snapshotSummary =
      snapshot?.summary && typeof snapshot.summary === "object"
        ? (snapshot.summary as JsonRecord)
        : {};
    const snapshotComponents = Array.isArray(snapshot?.components)
      ? (snapshot?.components as unknown[])
      : [];
    const estimateItemMapping =
      (typeof snapshotMetadata.estimate_item_mapping === "object" &&
      snapshotMetadata.estimate_item_mapping !== null
        ? (snapshotMetadata.estimate_item_mapping as JsonRecord)
        : null) ??
      (typeof appliedPayload.estimate_item_mapping === "object" &&
      appliedPayload.estimate_item_mapping !== null
        ? (appliedPayload.estimate_item_mapping as JsonRecord)
        : null);
    const facts = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.facts),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).facts)
            ? readJsonStringArray((component as Record<string, unknown>).facts as Json)
            : []
        ),
      ])
    ).slice(0, 8);
    const hypotheses = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.hypotheses),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).hypotheses)
            ? readJsonStringArray(
                (component as Record<string, unknown>).hypotheses as Json
              )
            : []
        ),
      ])
    ).slice(0, 8);
    const inferences = Array.from(
      new Set([
        ...readJsonStringArray(snapshotSummary.inferences),
        ...snapshotComponents.flatMap((component) =>
          typeof component === "object" &&
          component !== null &&
          Array.isArray((component as Record<string, unknown>).inferences)
            ? readJsonStringArray(
                (component as Record<string, unknown>).inferences as Json
              )
            : []
        ),
      ])
    ).slice(0, 8);

    return {
      ...item,
      source_provider: "generated_ouvrage",
      source_job_id: application.draft_id,
      source_file_name:
        toNullableText(item.source_file_name) ??
        toNullableText(sources[0]?.source_file_name) ??
        "Ouvrage genere",
      source_page: item.source_page ?? sources[0]?.source_page_from ?? null,
      source_extracted_at: draft?.created_at ?? item.source_extracted_at ?? null,
      source_metadata: toJson({
        kind: "generated_ouvrage",
        draft_id: application.draft_id,
        candidate_id: application.candidate_id,
        application_id: application.id,
        snapshot_id: snapshot?.id ?? null,
        assembly_id: snapshot?.assembly_id ?? null,
        ai_status: candidate?.ai_status ?? null,
        resolution_status: candidate?.resolution_status ?? null,
        confidence: candidate ? clampConfidence(candidate.confidence) : null,
        applied_values: {
          designation: appliedPayload.designation ?? candidate?.designation ?? item.title,
          unit: appliedPayload.unit ?? candidate?.unit ?? null,
          quantity: appliedPayload.quantity ?? candidate?.quantity ?? null,
          lot_id: appliedPayload.resolved_lot_id ?? appliedPayload.lot_id ?? null,
          requested_lot_id: appliedPayload.requested_lot_id ?? null,
          lot_label: appliedPayload.resolved_lot_label ?? null,
          placement_mode: appliedPayload.placement_mode ?? null,
        },
        prompt_version: toNullableText(generationMetadata.prompt_version),
        used_fallback: Boolean(generationMetadata.used_fallback),
        subdetail_summary: snapshotSummary,
        estimate_item_mapping: estimateItemMapping,
        components: snapshotComponents,
        facts,
        hypotheses,
        inferences,
        risk_signals: normalizeRiskSignals(snapshotSummary.risk_signals),
        sources,
      }),
    };
  });
}
