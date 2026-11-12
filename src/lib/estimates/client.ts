import { type JsonRecord, isRecord, toNumber, toStringValue, toBooleanValue, hasOwnProperty, getRootPayload, extractEntity, pickRecord, pickArray } from "@/lib/estimates/client-json";
import { EstimateApiError, isEstimateApiError, toErrorMessage, extractErrorDetails, extractErrorCode } from "@/lib/estimates/client-errors";
import { type EstimateVersionToken, type BulkUpdateEstimateVersionPatch, parseVersionToken } from "@/lib/estimates/client-version";
import { readJson, requestJsonUncoordinated } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import { type EstimateItem, parseEstimateItems, fetchEstimateEditorData } from "@/lib/estimates/editor-read-client";
import { type EstimatePurchaseOrderDraftPreparation, type CreateEstimatePurchaseOrderDraftsInput, type EstimatePurchaseOrderDraftCreationResult } from "@/lib/estimates/purchase-order-draft-contracts";
import { parseSaveEstimateVersionResponse, parseEstimateItemWriteResponse, parseBulkUpdateEstimateItemsResponse, parseEstimateStatusResponse, parseCreateEstimateResponse, parseEstimateVersionIdResponse, parsePromoteEstimateVariantResponse, parseEstimateEventsResponse } from "@/lib/estimates/write-response-contracts";
import { parseEstimateItemDeleteResponse, parseEstimateItemsMoveResponse, parseEstimateItemsReorderResponse } from "@/lib/estimates/item-structure-contracts";
import { toEstimateImportSourceClient, toEstimateImportSectionClient, toImportEstimateSectionsClient, toDuplicateSectionClient, type EstimateImportSourceVersion, type EstimateImportSectionPreview, type DuplicateEstimateSectionResult } from "@/lib/estimates/section-copy-contracts";
import { toAffaireLinkedDpgfSourceClient, toImportLinkedDpgfSourceClient, type AffaireLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-contracts";
import { parseImportSourcesResponse, parseImportSectionsPreviewResponse, parseImportSectionsResponse, parseDuplicateSectionResponse, parseLinkedDpgfSourceResponse, parseImportLinkedDpgfResponse } from "@/lib/estimates/section-copy-response";
import { type EstimateEditorData, type VersionZeroDraftSummary } from "@/lib/estimates/editor-read-contracts";
import { priceReuseApplySchema, priceReuseArbitrationSchema, priceReusePreviewSchema, type PriceReuseApplyInput, type PriceReuseApplyResult, type PriceReuseArbitration, type PriceReuseArbitrationInput, type PriceReusePreview } from "@/lib/estimates/price-reuse-contracts";
import type { EstimateBatchOperationResult } from "@/lib/estimates/batch-contracts";
import { downloadBlob } from "@/lib/browser-download";
import { assertNoPendingEstimateBatch, type EstimateBatchAttempt, type EstimateBatchIdentity } from "@/lib/estimates/batch-intentions";
import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { normalizeEstimateCurrency } from "@/lib/money";
import { getEstimateEditorMutationIdentity, hasEstimateEditorMutationSession, runEstimateEditorMutation, isOlderEstimateVersionToken } from "@/lib/estimates/editor-mutations";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER } from "@/lib/estimates/lock-session";
import {
  estimateOfferChoiceReceiptSchema,
  type EstimateOfferChoiceInput,
  type EstimateOfferChoiceReceipt,
} from "@/lib/estimates/offer-choice";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";
import type { Database } from "@/types/database";
import { type EstimateApprovalDecisionFilter, type EstimateApprovalDecisionJournal } from "@/lib/estimates/approval-decision-journal";
import type { EstimateOutlierFlagKey, EstimateOutlierFlagsByItemId } from "@/lib/estimates/outlier-detection";
import type { EstimateVersionEvent, ImportEstimateSectionsResult, ImportLinkedDpgfSourceResult, MoveEstimateItemInput } from "@/lib/estimates/schemas";
import type { EstimatePdfLayoutConfiguration, EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import { isEstimateStatus, type EstimateStatus as CanonicalEstimateStatus } from "@/lib/estimates/status";

export type { EstimateImportSourceVersion, EstimateImportSectionPreview, DuplicateEstimateSectionResult } from "@/lib/estimates/section-copy-contracts";
export type { AffaireLinkedDpgfSource } from "@/lib/estimates/linked-dpgf-contracts";
export type { EstimateEditorData, VersionZeroDraftSummary } from "@/lib/estimates/editor-read-contracts";
export type { EstimateBatchOperationResult } from "@/lib/estimates/batch-contracts";

export { getEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";

export type {
  EstimateVersionEvent,
  ImportEstimateSectionsResult,
  ImportLinkedDpgfSourceResult,
};

type EstimateProjectRow =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateTemplateItem =
  Database["public"]["Tables"]["estimate_template_items"]["Row"];
type EstimateAssemblyItemRow =
  Database["public"]["Tables"]["estimate_assembly_items"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTier = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];

export type EstimateStatus = CanonicalEstimateStatus;
export type EstimateVersionEventType =
  | "sent"
  | "accepted"
  | "archived"
  | "rejected"
  | "seal_verified"
  | "approval_submitted"
  | "approval_rules_evaluated"
  | "approval_status_changed"
  | "approval_decided";
type VersionZeroDraftCounts = NonNullable<
  VersionZeroDraftSummary["activeDraft"]
>["counts"];

export type EstimateListItem = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionId: string;
  versionNumber: number;
  status: EstimateStatus;
  title: string | null;
  updatedAt: string;
  totalHtCents: number;
  currency: string;
  dateDevis: string | null;
  validiteJours: number | null;
};

export type EstimateDraftVersionTarget = {
  id: string;
  projectId: string;
  versionNumber: number;
  status: EstimateStatus;
  title: string | null;
  updatedAt: string;
};

export type ImportEstimateSectionsMode = "merge" | "append";

export type ImportEstimateSectionsPayload = {
  sourceVersionId: string;
  sectionIds: string[];
  mode: ImportEstimateSectionsMode;
};

export type EstimateStructureDraftSourceKind =
  | "linked_dpgf"
  | "primary_cctp"
  | "historical_versions"
  | "template_library"
  | "assembly_library"
  | "project_notes"
  | "confirmed_brief";

export type EstimateStructureDraftStrategy = "hybrid";
export type EstimateStructureDraftNodeAction = "create" | "merge" | "skip";
export type EstimateStructureDraftApplyMode =
  | "create_empty"
  | "merge_existing";

export type EstimateStructureDraftEvidenceEntry = {
  type: "dpgf" | "cctp" | "history" | "template" | "assembly" | "brief";
  label: string;
  excerpt: string | null;
};

export type EstimateStructureDraftNode = {
  id: string;
  parentId: string | null;
  orderIndex: number;
  hierarchyLevel: number;
  label: string;
  normalizedLabel: string;
  confidence: number;
  confidenceLabel: "elevee" | "moyenne" | "faible";
  defaultAction: EstimateStructureDraftNodeAction;
  duplicateMatchItemId: string | null;
  duplicateMatchPath: string | null;
  provenance: EstimateStructureDraftEvidenceEntry[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  children: EstimateStructureDraftNode[];
};

export type EstimateStructureDraftSourceSummary = {
  kind: EstimateStructureDraftSourceKind;
  label: string;
  available: boolean;
  used: boolean;
  detail: string | null;
};

export type EstimateStructureDraftSummary = {
  rootCount: number;
  newCount: number;
  mergeCount: number;
  duplicateCount: number;
  lowConfidenceCount: number;
};

export type EstimateStructureDraft = {
  draftId: string;
  versionId: string;
  strategy: EstimateStructureDraftStrategy;
  sources: EstimateStructureDraftSourceSummary[];
  summary: EstimateStructureDraftSummary;
  nodes: EstimateStructureDraftNode[];
  generatedAt: string;
};

export type GenerateEstimateStructureDraftPayload = {
  strategy?: EstimateStructureDraftStrategy;
};

export type ApplyEstimateStructureDraftPayload = {
  mode: EstimateStructureDraftApplyMode;
  selectedRootNodeIds: string[];
  overrides?: Array<{
    nodeId: string;
    action: EstimateStructureDraftNodeAction;
    renameTo?: string | null;
    mergeIntoItemId?: string | null;
  }>;
};

export type ApplyEstimateStructureDraftResult = {
  draftId: string;
  versionId: string;
  mode: EstimateStructureDraftApplyMode;
  createdCount: number;
  mergedCount: number;
  skippedCount: number;
  createdItemIds: string[];
  mergedItemIds: string[];
  versionToken: EstimateVersionToken | null;
};

export type ImportLinkedDpgfSourcePayload = {
  sectionTitle?: string | null;
};

export type EstimateTemplateSummary = {
  id: string;
  name: string;
  description: string | null;
  sourceVersionId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
};

export type EstimateTemplateDetail = EstimateTemplateSummary & {
  items: EstimateTemplateItem[];
};

export type EstimateAssemblyItem = EstimateAssemblyItemRow;
export type EstimateAssemblyLaborRole = LaborRole;
export type EstimateAssemblySupplyType = SupplyType;
export type EstimateAssemblyMember =
  Database["public"]["Tables"]["estimate_assembly_members"]["Row"] & {
    child_assembly: {
      id: string;
      name: string;
      reference_code: string | null;
      unit: string | null;
      ds_cents: number;
      avg_time_hours: number | null;
    } | null;
  };

export type EstimateAssemblySummary = {
  id: string;
  name: string;
  description: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  pricingSource?: string | null;
  directCostCents?: number;
  targetPriceCents?: number;
  averageOutputRate?: number | null;
  averageTimeHours?: number | null;
  sourceMetadata?: unknown;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  memberCount?: number;
};

export type EstimateAssemblyDetail = EstimateAssemblySummary & {
  items: EstimateAssemblyItem[];
  members?: EstimateAssemblyMember[];
};

export type CreateEstimateAssemblyPayload = {
  name: string;
  description?: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  items: Array<{
    title: string;
    unit?: string | null;
    kFo?: number;
    kMo?: number;
    laborRoleId?: string | null;
    supplyTypeId?: string | null;
    defaultQuantity?: number | null;
    laborHours?: number;
    position: number;
    costType?: EstimateAssemblyItem["cost_type"];
    unitCostHtCents?: number;
    lossCoeffBp?: number;
    yieldValue?: number | null;
    yieldUnit?: string | null;
    sourceMetadata?: unknown;
  }>;
  members?: Array<{
    childAssemblyId: string;
    quantity: number;
    position: number;
  }>;
};

export type UpdateEstimateAssemblyPayload = {
  name?: string;
  description?: string | null;
  referenceCode?: string | null;
  unit?: string | null;
  items?: Array<{
    title: string;
    unit?: string | null;
    kFo?: number;
    kMo?: number;
    laborRoleId?: string | null;
    supplyTypeId?: string | null;
    defaultQuantity?: number | null;
    laborHours?: number;
    position: number;
    costType?: EstimateAssemblyItem["cost_type"];
    unitCostHtCents?: number;
    lossCoeffBp?: number;
    yieldValue?: number | null;
    yieldUnit?: string | null;
    sourceMetadata?: unknown;
  }>;
  members?: Array<{
    childAssemblyId: string;
    quantity: number;
    position: number;
  }>;
};

export type CreateEstimateTemplatePayload = {
  sourceVersionId: string;
  name: string;
  description?: string | null;
};

export type UpdateEstimateTemplatePayload = {
  name?: string;
  description?: string | null;
};

export type InstantiateEstimateTemplatePayload = {
  projectName?: string;
  projectId?: string;
  versionTitle?: string | null;
  dateDevis?: string;
  validiteJours?: number;
  projectNotes?: string | null;
  /** Sous-lot 2.10a (D3) : moteur des nouvelles versions lu par la page. */
  expectedCalcEngineVersion?: 2 | 3;
};

/** Ligne v1/v2 dont les heures changent en entrant dans une v3 (P-12) : heures source → heures dérivées. */
export type V3ConvertedLine = { title: string; templateHours: number; convertedHours: number };

/** Sous-lot 2.10a (P-12, D-h) : modèle entré dans une v3, lignes converties et réglages non repris. */
export type InstantiateEstimateTemplateConversion = {
  convertedLines: Array<{ title: string; templateHours: number; convertedHours: number }>;
  droppedSettings: Array<{ setting: string; label: string }>;
};

export type InstantiateEstimateTemplateResult = {
  projectId: string;
  versionId: string;
  redirectTo: string;
  /** Absent hors moteur 3. */
  conversion?: InstantiateEstimateTemplateConversion;
};

export type EstimateVersionWithProject = EstimateVersionRow & {
  estimate_projects:
    | Pick<
        EstimateProjectRow,
        "id" | "name" | "reference" | "client_name" | "is_archived"
      >
    | Pick<
        EstimateProjectRow,
        "id" | "name" | "reference" | "client_name" | "is_archived"
      >[]
    | { name: string }
    | { name: string }[]
    | null;
};

export type VersionZeroLineReviewStatus =
  | "pending"
  | "accepted"
  | "edited"
  | "rejected";

export type VersionZeroDraftStatus =
  | "ia_a_revoir"
  | "ready_for_version"
  | "materialized"
  | "discarded"
  | "superseded";

export type VersionZeroReviewLine = {
  id: string;
  lotId: string;
  order: number;
  reviewStatus: VersionZeroLineReviewStatus;
  confidence: number;
  confidenceLabel: "elevee" | "moyenne" | "faible";
  proposed: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  edited: {
    title: string | null;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  effective: {
    title: string;
    description: string | null;
    quantity: number | null;
    unit: string | null;
  };
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  materializedEstimateItemId: string | null;
};

export type VersionZeroReviewLot = {
  id: string;
  key: string;
  label: string;
  order: number;
  status: "generated" | "partial" | "missing";
  confidence: number | null;
  provenance: string[];
  facts: string[];
  hypotheses: string[];
  inferences: string[];
  missingSignals: string[];
  riskSignals: string[];
  lines: VersionZeroReviewLine[];
};

export type VersionZeroReview = {
  draft: {
    id: string;
    versionId: string;
    projectId: string;
    briefId: string | null;
    status: VersionZeroDraftStatus;
    createdAt: string;
    updatedAt: string;
    materializedAt: string | null;
    selectedLots: string[];
    summaryText: string | null;
    generationMetadata: Record<string, unknown>;
    counts: VersionZeroDraftCounts;
  };
  lots: VersionZeroReviewLot[];
};

export type CreateEstimateCreationMode = "blank" | "linkedDpgfSource";

export type CreateEstimatePayload = {
  projectName?: string;
  projectId?: string;
  title: string | null;
  dateDevis: string;
  validiteJours: number;
  marginMultiplier?: number;
  clientName?: string | null;
  reference?: string | null;
  marginMode?: "fixed" | "tiered";
  marginBp?: number;
  taxRateBp?: number;
  roundingMode?: "none" | "nearest" | "up" | "down";
  roundingStepCents?: number;
  currency?: string;
  projectNotes?: string | null;
  creationMode?: CreateEstimateCreationMode;
  /** Sous-lot 2.10a (D3) : moteur des nouvelles versions lu par la page ; envoyé tel quel. */
  expectedCalcEngineVersion?: 2 | 3;
  /** Moteur 3 seulement (D5). */
  saleCoefficientFo?: number;
  saleCoefficientMo?: number;
};

type EstimateMutationVersionTokenOptions = {
  onVersionToken?: (versionToken: EstimateVersionToken) => void;
  /** The caller confirms the returned row and token together in its document. */
  documentOwnsReceipt?: boolean;
};

export type BulkUpdateEstimateItemsResult = {
  updatedCount: number;
  versionToken: EstimateVersionToken;
  totals?: BulkUpdateEstimateVersionPatch;
};

export type EstimateBatchOperation =
  | {
      op: "create";
      data: Database["public"]["Tables"]["estimate_items"]["Insert"];
    }
  | {
      op: "update";
      id: string;
      data: Database["public"]["Tables"]["estimate_items"]["Update"];
    }
  | {
      op: "delete";
      id: string;
    }
  | {
      op: "reorder";
      data: {
        parent_id?: string | null;
        ordered_ids: string[];
      };
    };

export type EstimateBatchResult = {
  committed: boolean;
  results: EstimateBatchOperationResult[];
  versionToken: EstimateVersionToken;
  totals?: BulkUpdateEstimateVersionPatch;
  currentVersionToken?: EstimateVersionToken;
  replayed?: boolean;
  receipt?: { operationKey: string; actorId: string; versionId: string; expectedUpdatedAt: string; committedAt: string };
};

export type EstimateExportResult = {
  filename: string;
  size: number;
};

export type EstimateExportMode = "standard" | "dpgf" | "bdc";

export type SuggestionRuleFeedback = "accept" | "reject";

export type SuggestionLearningFieldName =
  | "description"
  | "category_id"
  | "k_fo"
  | "k_mo"
  | "labor_role_id"
  | "supply_type_id";

export type SuggestionLearningReviewStatus = "approved" | "rejected";

export type SuggestionLearningProposal = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  corrected_value: string | null;
  correction_count: number;
  first_seen_at: string;
  last_seen_at: string;
  review_status: SuggestionLearningReviewStatus | null;
  decided_by: string | null;
  decided_at: string | null;
  is_active: boolean;
  sample_original_value: string | null;
  sample_item_title: string | null;
};

export type SuggestionLearningRuleOverrides = {
  description?: string | null;
  category_id?: string | null;
  k_fo?: number | null;
  k_mo?: number | null;
  labor_role_id?: string | null;
  supply_type_id?: string | null;
};

export type SuggestionLearningRuleBoost = {
  rule_id: string;
  learning_boost: number;
  overrides: SuggestionLearningRuleOverrides;
  fields: SuggestionLearningProposal[];
};

export type SuggestionLearningConfig = {
  enabled: boolean;
  threshold: number;
  retention_months: number;
};

export type SuggestionLearningState = {
  config: SuggestionLearningConfig;
  proposals: SuggestionLearningProposal[];
  by_rule_id: Record<string, SuggestionLearningRuleBoost>;
};

export type TrackEstimateSuggestionCorrection = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  original_value?: string | null;
  corrected_value?: string | null;
  item_title?: string | null;
};

export type TrackEstimateSuggestionCorrectionsPayload = {
  corrections: TrackEstimateSuggestionCorrection[];
};

export type TrackEstimateSuggestionCorrectionsResult = SuggestionLearningState & {
  tracked_count: number;
};

export type ReviewAdminSuggestionLearningProposalPayload = {
  rule_id: string;
  field_name: SuggestionLearningFieldName;
  corrected_value?: string | null;
  action: "approve" | "reject" | "reset";
};

export type PurgeAdminSuggestionLearningsPayload = {
  retention_months?: number;
};

export type PurgeAdminSuggestionLearningsResult = SuggestionLearningState & {
  deleted_count: number;
  retention_months: number;
};

export type EstimatePdfStatus = "missing" | "processing" | "failed" | "ready";

export type EstimatePdfStatusResponse = {
  status: EstimatePdfStatus;
  downloadUrl?: string;
  filePath?: string;
  sha256Hash?: string;
  generatedAt?: string;
  fileSizeBytes?: number;
  lastError?: string;
};

export type EstimatePdfLayoutConfigurationResponse =
  EstimatePdfLayoutConfiguration;

export type EstimateSendGatingFlag = {
  key: string;
  category?:
    | "documents"
    | "register"
    | "estimate_quality"
    | "pdf"
    | "approvals";
  severity: "blocking" | "warning";
  count: number;
  itemIds: string[];
  label: string;
  description: string;
  details?: Record<string, unknown>;
};

export type EstimateSendGatingResponse = {
  canSend: boolean;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  stalePriceDays: number;
  checkedAt: string;
};

export type ToggleEstimateOutlierDismissPayload = {
  itemId: string;
  flagKey: EstimateOutlierFlagKey;
  dismissed: boolean;
};

const SUGGESTION_LEARNING_FIELDS: SuggestionLearningFieldName[] = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
];

function parseOptionalNullableStringProperty(
  record: JsonRecord,
  keys: string[]
): string | null | undefined {
  for (const key of keys) {
    if (!hasOwnProperty(record, key)) continue;
    const value = record[key];
    if (value === null) return null;
    return toStringValue(value);
  }

  return undefined;
}

function parseOptionalNullableNumberProperty(
  record: JsonRecord,
  keys: string[]
): number | null | undefined {
  for (const key of keys) {
    if (!hasOwnProperty(record, key)) continue;
    const value = record[key];
    if (value === null) return null;
    return toNumber(value);
  }

  return undefined;
}

function isEstimateOutlierFlagKey(value: unknown): value is EstimateOutlierFlagKey {
  return value === "price_outlier" || value === "quantity_outlier";
}

function normalizeOutlierDismissedByItemId(
  payload: unknown
): EstimateOutlierFlagsByItemId {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return {};

  const mapCandidate = root.dismissed_by_item_id ?? root.dismissedByItemId;
  if (isRecord(mapCandidate)) {
    const parsedMap: EstimateOutlierFlagsByItemId = {};
    Object.entries(mapCandidate).forEach(([itemId, value]) => {
      if (!Array.isArray(value)) return;
      const flags = value.filter((entry): entry is EstimateOutlierFlagKey =>
        isEstimateOutlierFlagKey(entry)
      );
      if (flags.length === 0) return;
      parsedMap[itemId] = flags;
    });
    return parsedMap;
  }

  const dismissals = Array.isArray(root.dismissals) ? root.dismissals : [];
  const parsedMap: EstimateOutlierFlagsByItemId = {};

  dismissals.forEach((dismissal) => {
    if (!isRecord(dismissal)) return;
    const itemId =
      toStringValue(dismissal.item_id) ??
      toStringValue(dismissal.itemId);
    const flagKeyRaw =
      toStringValue(dismissal.flag_key) ??
      toStringValue(dismissal.flagKey);

    if (!itemId || !flagKeyRaw || !isEstimateOutlierFlagKey(flagKeyRaw)) {
      return;
    }

    const current = parsedMap[itemId] ?? [];
    if (current.includes(flagKeyRaw)) return;
    parsedMap[itemId] = [...current, flagKeyRaw];
  });

  return parsedMap;
}

function isSuggestionLearningFieldName(
  value: unknown
): value is SuggestionLearningFieldName {
  return (
    typeof value === "string" &&
    SUGGESTION_LEARNING_FIELDS.includes(value as SuggestionLearningFieldName)
  );
}

function parseSuggestionLearningProposal(
  value: unknown
): SuggestionLearningProposal | null {
  if (!isRecord(value)) return null;

  const ruleId = toStringValue(value.rule_id) ?? toStringValue(value.ruleId);
  const fieldNameRaw = toStringValue(value.field_name) ?? toStringValue(value.fieldName);
  const correctionCount =
    toNumber(value.correction_count) ?? toNumber(value.correctionCount);
  const firstSeenAt =
    toStringValue(value.first_seen_at) ?? toStringValue(value.firstSeenAt);
  const lastSeenAt =
    toStringValue(value.last_seen_at) ?? toStringValue(value.lastSeenAt);

  if (
    !ruleId ||
    !fieldNameRaw ||
    !isSuggestionLearningFieldName(fieldNameRaw) ||
    correctionCount === null ||
    !firstSeenAt ||
    !lastSeenAt
  ) {
    return null;
  }

  const correctedValueRaw =
    parseOptionalNullableStringProperty(value, [
      "corrected_value",
      "correctedValue",
    ]) ?? null;

  const reviewStatusRaw =
    toStringValue(value.review_status) ?? toStringValue(value.reviewStatus);
  const reviewStatus: SuggestionLearningReviewStatus | null =
    reviewStatusRaw === "approved" || reviewStatusRaw === "rejected"
      ? reviewStatusRaw
      : null;

  return {
    rule_id: ruleId,
    field_name: fieldNameRaw,
    corrected_value: correctedValueRaw,
    correction_count: Math.max(0, Math.trunc(correctionCount)),
    first_seen_at: firstSeenAt,
    last_seen_at: lastSeenAt,
    review_status: reviewStatus,
    decided_by: toStringValue(value.decided_by) ?? toStringValue(value.decidedBy) ?? null,
    decided_at: toStringValue(value.decided_at) ?? toStringValue(value.decidedAt) ?? null,
    is_active: toBooleanValue(value.is_active) ?? toBooleanValue(value.isActive) ?? false,
    sample_original_value:
      toStringValue(value.sample_original_value) ??
      toStringValue(value.sampleOriginalValue) ??
      null,
    sample_item_title:
      toStringValue(value.sample_item_title) ??
      toStringValue(value.sampleItemTitle) ??
      null,
  };
}

function parseSuggestionLearningRuleOverrides(
  value: unknown
): SuggestionLearningRuleOverrides {
  if (!isRecord(value)) return {};

  const overrides: SuggestionLearningRuleOverrides = {};

  const description = parseOptionalNullableStringProperty(value, ["description"]);
  if (description !== undefined) {
    overrides.description = description;
  }

  const categoryId = parseOptionalNullableStringProperty(value, [
    "category_id",
    "categoryId",
  ]);
  if (categoryId !== undefined) {
    overrides.category_id = categoryId;
  }

  const kFo = parseOptionalNullableNumberProperty(value, ["k_fo", "kFo"]);
  if (kFo !== undefined) {
    overrides.k_fo = kFo;
  }

  const kMo = parseOptionalNullableNumberProperty(value, ["k_mo", "kMo"]);
  if (kMo !== undefined) {
    overrides.k_mo = kMo;
  }

  const laborRoleId = parseOptionalNullableStringProperty(value, [
    "labor_role_id",
    "laborRoleId",
  ]);
  if (laborRoleId !== undefined) {
    overrides.labor_role_id = laborRoleId;
  }

  const supplyTypeId = parseOptionalNullableStringProperty(value, [
    "supply_type_id",
    "supplyTypeId",
  ]);
  if (supplyTypeId !== undefined) {
    overrides.supply_type_id = supplyTypeId;
  }

  return overrides;
}

function parseSuggestionLearningRuleBoost(
  value: unknown,
  fallbackRuleId?: string
): SuggestionLearningRuleBoost | null {
  if (!isRecord(value)) return null;

  const ruleId =
    toStringValue(value.rule_id) ??
    toStringValue(value.ruleId) ??
    fallbackRuleId ??
    null;
  if (!ruleId) return null;

  const learningBoost =
    toNumber(value.learning_boost) ?? toNumber(value.learningBoost) ?? 0;

  const overrides = parseSuggestionLearningRuleOverrides(
    pickRecord(value, ["overrides"]) ?? {}
  );

  const fields = pickArray(value, ["fields", "proposals"])
    .map((entry) => parseSuggestionLearningProposal(entry))
    .filter((entry): entry is SuggestionLearningProposal => entry !== null);

  return {
    rule_id: ruleId,
    learning_boost: Math.max(0, learningBoost),
    overrides,
    fields,
  };
}

function parseSuggestionLearningConfig(value: unknown): SuggestionLearningConfig | null {
  const root = getRootPayload(value);
  if (!isRecord(root)) return null;

  const config = pickRecord(root, ["config", "learning_config", "learningConfig"]) ?? root;
  if (!isRecord(config)) return null;

  const enabled =
    toBooleanValue(config.enabled) ?? toBooleanValue(config.is_enabled);
  const threshold = toNumber(config.threshold);
  const retentionMonths =
    toNumber(config.retention_months) ?? toNumber(config.retentionMonths);

  if (enabled === null || threshold === null || retentionMonths === null) {
    return null;
  }

  return {
    enabled,
    threshold: Math.max(1, Math.trunc(threshold)),
    retention_months: Math.max(1, Math.trunc(retentionMonths)),
  };
}

function parseSuggestionLearningState(payload: unknown): SuggestionLearningState | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const config = parseSuggestionLearningConfig(root);
  if (!config) return null;

  const proposals = pickArray(root, ["proposals", "items"])
    .map((entry) => parseSuggestionLearningProposal(entry))
    .filter((entry): entry is SuggestionLearningProposal => entry !== null);

  const byRuleRoot = pickRecord(root, ["by_rule_id", "byRuleId"]);
  const byRuleId: Record<string, SuggestionLearningRuleBoost> = {};

  if (byRuleRoot) {
    Object.entries(byRuleRoot).forEach(([ruleId, value]) => {
      const parsed = parseSuggestionLearningRuleBoost(value, ruleId);
      if (!parsed) return;
      byRuleId[parsed.rule_id] = parsed;
    });
  }

  return {
    config,
    proposals,
    by_rule_id: byRuleId,
  };
}

function parseTrackEstimateSuggestionCorrectionsResult(
  payload: unknown
): TrackEstimateSuggestionCorrectionsResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const state = parseSuggestionLearningState(root);
  if (!state) return null;

  const trackedCount =
    toNumber(root.tracked_count) ?? toNumber(root.trackedCount);

  return {
    ...state,
    tracked_count:
      trackedCount !== null ? Math.max(0, Math.trunc(trackedCount)) : 0,
  };
}

function parsePurgeAdminSuggestionLearningsResult(
  payload: unknown
): PurgeAdminSuggestionLearningsResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const state = parseSuggestionLearningState(root);
  if (!state) return null;

  const deletedCount =
    toNumber(root.deleted_count) ?? toNumber(root.deletedCount);
  const retentionMonths =
    toNumber(root.retention_months) ??
    toNumber(root.retentionMonths) ??
    state.config.retention_months;

  return {
    ...state,
    deleted_count:
      deletedCount !== null ? Math.max(0, Math.trunc(deletedCount)) : 0,
    retention_months: Math.max(1, Math.trunc(retentionMonths)),
  };
}

function isEstimatePdfStatus(value: string): value is EstimatePdfStatus {
  return (
    value === "missing" ||
    value === "processing" ||
    value === "failed" ||
    value === "ready"
  );
}

function parseEstimatePdfStatus(payload: unknown): EstimatePdfStatusResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const rawStatus = toStringValue(root.status);
  if (!rawStatus || !isEstimatePdfStatus(rawStatus)) {
    return null;
  }

  return {
    status: rawStatus,
    downloadUrl:
      toStringValue(root.download_url) ?? toStringValue(root.downloadUrl) ?? undefined,
    filePath: toStringValue(root.file_path) ?? toStringValue(root.filePath) ?? undefined,
    sha256Hash:
      toStringValue(root.sha256_hash) ?? toStringValue(root.sha256Hash) ?? undefined,
    generatedAt:
      toStringValue(root.generated_at) ?? toStringValue(root.generatedAt) ?? undefined,
    fileSizeBytes:
      toNumber(root.file_size_bytes) ?? toNumber(root.fileSizeBytes) ?? undefined,
    lastError:
      toStringValue(root.last_error) ?? toStringValue(root.lastError) ?? undefined,
  };
}

function parseEstimatePdfLayoutConfiguration(
  payload: unknown
): EstimatePdfLayoutConfigurationResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root) || !isRecord(root.sectionCountsByLevel) || !isRecord(root.terms)) {
    return null;
  }
  const lineCount = toNumber(root.lineCount);
  const hasConditions = toBooleanValue(root.hasConditions);
  const policy = toStringValue(root.terms.policy);
  if (
    lineCount === null ||
    hasConditions === null ||
    (policy !== "optional" && policy !== "default" && policy !== "required")
  ) {
    return null;
  }

  return {
    lineCount: Math.max(0, Math.trunc(lineCount)),
    sectionCountsByLevel: {
      "1": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["1"]) ?? 0)),
      "2": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["2"]) ?? 0)),
      "3": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["3"]) ?? 0)),
      "4": Math.max(0, Math.trunc(toNumber(root.sectionCountsByLevel["4"]) ?? 0)),
    },
    hasConditions,
    terms: {
      available: toBooleanValue(root.terms.available) ?? false,
      policy,
      title: toStringValue(root.terms.title),
      version: toNumber(root.terms.version),
    },
  };
}

function parseEstimateSendGatingFlag(
  value: unknown
): EstimateSendGatingFlag | null {
  if (!isRecord(value)) return null;

  const key = toStringValue(value.key);
  const categoryRaw = toStringValue(value.category);
  const severityRaw = toStringValue(value.severity);
  const count = toNumber(value.count);
  const label = toStringValue(value.label);
  const description = toStringValue(value.description);
  const itemIdsRaw = pickArray(value, ["item_ids", "itemIds"]);
  const itemIds = itemIdsRaw
    .map((itemId) => toStringValue(itemId))
    .filter((itemId): itemId is string => Boolean(itemId));

  if (
    !key ||
    !severityRaw ||
    (severityRaw !== "blocking" && severityRaw !== "warning") ||
    count === null ||
    !label ||
    !description
  ) {
    return null;
  }

  return {
    key,
    category:
      categoryRaw === "documents" ||
      categoryRaw === "register" ||
      categoryRaw === "estimate_quality" ||
      categoryRaw === "pdf" ||
      categoryRaw === "approvals"
        ? categoryRaw
        : undefined,
    severity: severityRaw,
    count,
    itemIds,
    label,
    description,
    details: isRecord(value.details)
      ? (value.details as Record<string, unknown>)
      : undefined,
  };
}

function parseEstimateSendGatingResponse(
  payload: unknown
): EstimateSendGatingResponse | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const canSend = toBooleanValue(root.canSend) ?? toBooleanValue(root.can_send);
  const stalePriceDays =
    toNumber(root.stalePriceDays) ?? toNumber(root.stale_price_days);
  const checkedAt =
    toStringValue(root.checkedAt) ?? toStringValue(root.checked_at);
  const blockingRaw = pickArray(root, ["blockingFlags", "blocking_flags"]);
  const warningRaw = pickArray(root, ["warningFlags", "warning_flags"]);

  if (canSend === null || stalePriceDays === null || !checkedAt) {
    return null;
  }

  return {
    canSend,
    stalePriceDays,
    checkedAt,
    blockingFlags: blockingRaw
      .map((entry) => parseEstimateSendGatingFlag(entry))
      .filter((entry): entry is EstimateSendGatingFlag => entry !== null),
    warningFlags: warningRaw
      .map((entry) => parseEstimateSendGatingFlag(entry))
      .filter((entry): entry is EstimateSendGatingFlag => entry !== null),
  };
}

function extractFilenameFromContentDisposition(
  contentDisposition: string | null
): string | null {
  if (!contentDisposition) return null;

  const utf8Match = contentDisposition.match(/filename\\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      const decoded = decodeURIComponent(utf8Match[1]);
      return toStringValue(decoded);
    } catch {
      return toStringValue(utf8Match[1]);
    }
  }

  const asciiMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  if (!asciiMatch?.[1]) return null;
  return toStringValue(asciiMatch[1]);
}

function normalizeEstimateListItem(value: unknown): EstimateListItem | null {
  if (!isRecord(value)) return null;

  const projectNode = (() => {
    if (isRecord(value.estimate_projects)) {
      return value.estimate_projects;
    }
    if (Array.isArray(value.estimate_projects)) {
      const first = value.estimate_projects[0];
      if (isRecord(first)) return first;
    }
    return null;
  })();

  const projectId =
    toStringValue(value.projectId) ??
    toStringValue(value.project_id) ??
    (projectNode ? toStringValue(projectNode.id) : null);
  const projectName =
    toStringValue(value.projectName) ??
    toStringValue(value.project_name) ??
    (projectNode ? toStringValue(projectNode.name) : null);
  const versionId =
    toStringValue(value.versionId) ??
    toStringValue(value.version_id) ??
    toStringValue(value.id);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue =
    toStringValue(value.status) ??
    toStringValue(value.estimate_status) ??
    toStringValue(value.version_status);
  const updatedAt =
    toStringValue(value.updatedAt) ?? toStringValue(value.updated_at);
  const totalHtCents =
    toNumber(value.totalHtCents) ??
    toNumber(value.total_ht_cents) ??
    toNumber(value.total);
  const currency =
    normalizeEstimateCurrency(toStringValue(value.currency)) ??
    normalizeEstimateCurrency(toStringValue(value.currency_code)) ??
    "EUR";

  if (
    !projectId ||
    !projectName ||
    !versionId ||
    versionNumber === null ||
    !statusValue ||
    !updatedAt ||
    totalHtCents === null ||
    !isEstimateStatus(statusValue)
  ) {
    return null;
  }

  const title =
    toStringValue(value.title) ?? toStringValue(value.version_title) ?? null;

  const projectReference =
    toStringValue(value.projectReference) ??
    toStringValue(value.project_reference) ??
    (projectNode ? toStringValue(projectNode.reference) : null) ??
    null;

  const projectClient =
    toStringValue(value.projectClient) ??
    toStringValue(value.project_client_name) ??
    toStringValue(value.project_client) ??
    (projectNode ? toStringValue(projectNode.client_name) : null) ??
    null;

  const dateDevis =
    toStringValue(value.dateDevis) ??
    toStringValue(value.date_devis) ??
    null;

  const validiteJours =
    toNumber(value.validiteJours) ??
    toNumber(value.validite_jours) ??
    null;

  return {
    projectId,
    projectName,
    projectReference,
    projectClient,
    versionId,
    versionNumber,
    status: statusValue,
    title,
    updatedAt,
    totalHtCents,
    currency,
    dateDevis,
    validiteJours,
  };
}

function parseEstimateList(payload: unknown): EstimateListItem[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "estimates", "rows", "versions"]);

  const mapped = rows
    .map((row) => normalizeEstimateListItem(row))
    .filter((row): row is EstimateListItem => row !== null);

  const sorted = [...mapped].sort((left, right) => {
    if (left.versionNumber !== right.versionNumber) {
      return right.versionNumber - left.versionNumber;
    }
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

  const latestByProject = new Map<string, EstimateListItem>();
  sorted.forEach((item) => {
    if (!latestByProject.has(item.projectId)) {
      latestByProject.set(item.projectId, item);
    }
  });

  return Array.from(latestByProject.values()).sort((left, right) => {
    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

function parseEstimateDraftVersionTarget(
  value: unknown
): EstimateDraftVersionTarget | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const projectId =
    toStringValue(value.projectId) ?? toStringValue(value.project_id);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue = toStringValue(value.status);
  const updatedAt =
    toStringValue(value.updatedAt) ?? toStringValue(value.updated_at);

  if (
    !id ||
    !projectId ||
    versionNumber === null ||
    !statusValue ||
    !isEstimateStatus(statusValue) ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    projectId,
    versionNumber,
    status: statusValue,
    title: toStringValue(value.title) ?? null,
    updatedAt,
  };
}

function parseEstimateDraftVersionTargets(
  payload: unknown
): EstimateDraftVersionTarget[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "versions", "rows"]);

  return rows
    .map((row) => parseEstimateDraftVersionTarget(row))
    .filter((row): row is EstimateDraftVersionTarget => row !== null)
    .sort((left, right) => {
      if (left.versionNumber !== right.versionNumber) {
        return right.versionNumber - left.versionNumber;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
}

function isEstimateStructureDraftSourceKind(
  value: string
): value is EstimateStructureDraftSourceKind {
  return (
    value === "linked_dpgf" ||
    value === "primary_cctp" ||
    value === "historical_versions" ||
    value === "template_library" ||
    value === "assembly_library" ||
    value === "project_notes" ||
    value === "confirmed_brief"
  );
}

function isEstimateStructureDraftNodeAction(
  value: string
): value is EstimateStructureDraftNodeAction {
  return value === "create" || value === "merge" || value === "skip";
}

function isEstimateStructureDraftApplyMode(
  value: string
): value is EstimateStructureDraftApplyMode {
  return value === "create_empty" || value === "merge_existing";
}

function parseEstimateStructureDraftEvidenceEntry(
  value: unknown
): EstimateStructureDraftEvidenceEntry | null {
  if (!isRecord(value)) return null;

  const type = toStringValue(value.type);
  const label = toStringValue(value.label);
  if (
    !type ||
    !label ||
    (type !== "dpgf" &&
      type !== "cctp" &&
      type !== "history" &&
      type !== "template" &&
      type !== "assembly" &&
      type !== "brief")
  ) {
    return null;
  }

  return {
    type,
    label,
    excerpt: toStringValue(value.excerpt),
  };
}

function parseEstimateStructureDraftNode(
  value: unknown
): EstimateStructureDraftNode | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const label = toStringValue(value.label);
  const normalizedLabel =
    toStringValue(value.normalizedLabel) ??
    toStringValue(value.normalized_label);
  const orderIndex =
    toNumber(value.orderIndex) ?? toNumber(value.order_index);
  const hierarchyLevel =
    toNumber(value.hierarchyLevel) ?? toNumber(value.hierarchy_level);
  const confidence = toNumber(value.confidence);
  const confidenceLabel =
    toStringValue(value.confidenceLabel) ??
    toStringValue(value.confidence_label);
  const defaultAction =
    toStringValue(value.defaultAction) ??
    toStringValue(value.default_action);

  if (
    !id ||
    !label ||
    !normalizedLabel ||
    orderIndex === null ||
    hierarchyLevel === null ||
    confidence === null ||
    !confidenceLabel ||
    (confidenceLabel !== "elevee" &&
      confidenceLabel !== "moyenne" &&
      confidenceLabel !== "faible") ||
    !defaultAction ||
    !isEstimateStructureDraftNodeAction(defaultAction)
  ) {
    return null;
  }

  const children = pickArray(value, ["children"])
    .map((entry) => parseEstimateStructureDraftNode(entry))
    .filter((entry): entry is EstimateStructureDraftNode => entry !== null);

  return {
    id,
    parentId:
      parseOptionalNullableStringProperty(value, ["parent_id", "parentId"]) ?? null,
    orderIndex: Math.max(0, Math.trunc(orderIndex)),
    hierarchyLevel: Math.max(1, Math.trunc(hierarchyLevel)),
    label,
    normalizedLabel,
    confidence: Math.max(0, Math.min(1, confidence)),
    confidenceLabel,
    defaultAction,
    duplicateMatchItemId:
      parseOptionalNullableStringProperty(value, [
        "duplicate_match_item_id",
        "duplicateMatchItemId",
      ]) ?? null,
    duplicateMatchPath:
      parseOptionalNullableStringProperty(value, [
        "duplicate_match_path",
        "duplicateMatchPath",
      ]) ?? null,
    provenance: pickArray(value, ["provenance"])
      .map((entry) => parseEstimateStructureDraftEvidenceEntry(entry))
      .filter(
        (entry): entry is EstimateStructureDraftEvidenceEntry => entry !== null
      ),
    facts: pickArray(value, ["facts"])
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null),
    hypotheses: pickArray(value, ["hypotheses"])
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null),
    inferences: pickArray(value, ["inferences"])
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null),
    children,
  };
}

function parseEstimateStructureDraftSourceSummary(
  value: unknown
): EstimateStructureDraftSourceSummary | null {
  if (!isRecord(value)) return null;

  const kind = toStringValue(value.kind);
  const label = toStringValue(value.label);
  if (!kind || !label || !isEstimateStructureDraftSourceKind(kind)) {
    return null;
  }

  return {
    kind,
    label,
    available: toBooleanValue(value.available) ?? false,
    used: toBooleanValue(value.used) ?? false,
    detail: toStringValue(value.detail),
  };
}

function parseEstimateStructureDraftSummary(
  value: unknown
): EstimateStructureDraftSummary | null {
  if (!isRecord(value)) return null;

  const rootCount = toNumber(value.rootCount) ?? toNumber(value.root_count);
  const newCount = toNumber(value.newCount) ?? toNumber(value.new_count);
  const mergeCount = toNumber(value.mergeCount) ?? toNumber(value.merge_count);
  const duplicateCount =
    toNumber(value.duplicateCount) ?? toNumber(value.duplicate_count);
  const lowConfidenceCount =
    toNumber(value.lowConfidenceCount) ?? toNumber(value.low_confidence_count);

  if (
    rootCount === null ||
    newCount === null ||
    mergeCount === null ||
    duplicateCount === null ||
    lowConfidenceCount === null
  ) {
    return null;
  }

  return {
    rootCount: Math.max(0, Math.trunc(rootCount)),
    newCount: Math.max(0, Math.trunc(newCount)),
    mergeCount: Math.max(0, Math.trunc(mergeCount)),
    duplicateCount: Math.max(0, Math.trunc(duplicateCount)),
    lowConfidenceCount: Math.max(0, Math.trunc(lowConfidenceCount)),
  };
}

function parseEstimateStructureDraft(
  payload: unknown
): EstimateStructureDraft | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const draftId = toStringValue(root.draftId) ?? toStringValue(root.draft_id);
  const versionId =
    toStringValue(root.versionId) ?? toStringValue(root.version_id);
  const strategy = toStringValue(root.strategy);
  const generatedAt =
    toStringValue(root.generatedAt) ?? toStringValue(root.generated_at);
  const summary = parseEstimateStructureDraftSummary(
    pickRecord(root, ["summary"]) ?? root.summary
  );

  if (!draftId || !versionId || strategy !== "hybrid" || !generatedAt || !summary) {
    return null;
  }

  return {
    draftId,
    versionId,
    strategy,
    sources: pickArray(root, ["sources"])
      .map((entry) => parseEstimateStructureDraftSourceSummary(entry))
      .filter(
        (entry): entry is EstimateStructureDraftSourceSummary => entry !== null
      ),
    summary,
    nodes: pickArray(root, ["nodes"])
      .map((entry) => parseEstimateStructureDraftNode(entry))
      .filter((entry): entry is EstimateStructureDraftNode => entry !== null),
    generatedAt,
  };
}

function parseApplyEstimateStructureDraftResult(
  payload: unknown
): ApplyEstimateStructureDraftResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const draftId = toStringValue(root.draftId) ?? toStringValue(root.draft_id);
  const versionId =
    toStringValue(root.versionId) ?? toStringValue(root.version_id);
  const mode = toStringValue(root.mode);
  const createdCount =
    toNumber(root.createdCount) ?? toNumber(root.created_count);
  const mergedCount =
    toNumber(root.mergedCount) ?? toNumber(root.merged_count);
  const skippedCount =
    toNumber(root.skippedCount) ?? toNumber(root.skipped_count);

  if (
    !draftId ||
    !versionId ||
    !mode ||
    !isEstimateStructureDraftApplyMode(mode) ||
    createdCount === null ||
    mergedCount === null ||
    skippedCount === null
  ) {
    return null;
  }

  const createdItemIds = pickArray(root, ["createdItemIds", "created_item_ids"])
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);
  const mergedItemIds = pickArray(root, ["mergedItemIds", "merged_item_ids"])
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);

  return {
    draftId,
    versionId,
    mode,
    createdCount: Math.max(0, Math.trunc(createdCount)),
    mergedCount: Math.max(0, Math.trunc(mergedCount)),
    skippedCount: Math.max(0, Math.trunc(skippedCount)),
    createdItemIds,
    mergedItemIds,
    versionToken: parseVersionToken(root),
  };
}

function parseVersionZeroDraftSummary(payload: unknown): VersionZeroDraftSummary {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger le résumé V0.");
  }

  return root as VersionZeroDraftSummary;
}

function parseVersionZeroReview(payload: unknown): VersionZeroReview {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger la revue V0.");
  }

  return root as VersionZeroReview;
}

function parseEstimateTemplateSummaryEntity(
  value: unknown
): EstimateTemplateSummary | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const name = toStringValue(value.name);
  const createdAt = toStringValue(value.created_at);
  const updatedAt = toStringValue(value.updated_at);
  if (!id || !name || !createdAt || !updatedAt) return null;

  return {
    id,
    name,
    description: toStringValue(value.description),
    sourceVersionId:
      toStringValue(value.source_version_id) ??
      toStringValue(value.sourceVersionId) ??
      null,
    createdBy:
      toStringValue(value.created_by) ?? toStringValue(value.createdBy) ?? null,
    createdAt,
    updatedAt,
    itemCount:
      toNumber(value.item_count) ??
      toNumber(value.itemCount) ??
      0,
  };
}

function parseEstimateTemplateItems(value: unknown): EstimateTemplateItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateTemplateItem[];
}

function parseEstimateTemplateSummaryList(payload: unknown): EstimateTemplateSummary[] {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return [];
  const rawItems = Array.isArray(root.templates)
    ? root.templates
    : Array.isArray(root.items)
      ? root.items
      : [];

  return rawItems
    .map((item) => parseEstimateTemplateSummaryEntity(item))
    .filter((item): item is EstimateTemplateSummary => Boolean(item));
}

function parseEstimateTemplateDetail(payload: unknown): EstimateTemplateDetail {
  const root = getRootPayload(payload);
  const templateEntity = extractEntity(root, ["template"]);
  const summary = parseEstimateTemplateSummaryEntity(templateEntity);
  if (!summary) {
    throw new Error("Impossible de récupérer le template.");
  }

  const items = parseEstimateTemplateItems(
    (templateEntity as JsonRecord | null)?.items ?? (isRecord(root) ? root.items : null)
  );

  return {
    ...summary,
    items,
  };
}

function parseEstimateAssemblySummaryEntity(
  value: unknown
): EstimateAssemblySummary | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const name = toStringValue(value.name);
  const createdAt = toStringValue(value.created_at);
  const updatedAt = toStringValue(value.updated_at);
  if (!id || !name || !createdAt || !updatedAt) return null;

  return {
    id,
    name,
    description: toStringValue(value.description),
    createdBy:
      toStringValue(value.created_by) ?? toStringValue(value.createdBy) ?? null,
    createdAt,
    updatedAt,
    itemCount: toNumber(value.item_count) ?? toNumber(value.itemCount) ?? 0,
    memberCount:
      toNumber(value.member_count) ?? toNumber(value.memberCount) ?? 0,
    referenceCode: toStringValue(value.reference_code),
    unit: toStringValue(value.unit),
    pricingSource: toStringValue(value.pricing_source),
    directCostCents: toNumber(value.ds_cents) ?? 0,
    targetPriceCents: toNumber(value.indicative_target_price_cents) ?? 0,
    averageOutputRate: toNumber(value.avg_output_rate),
    averageTimeHours: toNumber(value.avg_time_hours),
    sourceMetadata: value.source_metadata ?? null,
  };
}

function parseEstimateAssemblyItems(value: unknown): EstimateAssemblyItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateAssemblyItem[];
}

function parseEstimateAssemblyMembers(
  value: unknown
): EstimateAssemblyMember[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => isRecord(entry)) as EstimateAssemblyMember[];
}

function parseEstimateAssemblySummaryList(
  payload: unknown
): EstimateAssemblySummary[] {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return [];
  const rawItems = Array.isArray(root.assemblies)
    ? root.assemblies
    : Array.isArray(root.items)
      ? root.items
      : [];

  return rawItems
    .map((item) => parseEstimateAssemblySummaryEntity(item))
    .filter((item): item is EstimateAssemblySummary => Boolean(item));
}

function parseEstimateAssemblyDetail(payload: unknown): EstimateAssemblyDetail {
  const root = getRootPayload(payload);
  const assemblyEntity = extractEntity(root, ["assembly"]);
  const summary = parseEstimateAssemblySummaryEntity(assemblyEntity);
  if (!summary) {
    throw new Error("Impossible de récupérer l'ouvrage.");
  }

  const items = parseEstimateAssemblyItems(
    (assemblyEntity as JsonRecord | null)?.items ??
      (isRecord(root) ? root.items : null)
  );
  const members = parseEstimateAssemblyMembers(
    (assemblyEntity as JsonRecord | null)?.members ??
      (isRecord(root) ? root.members : null)
  );

  return {
    ...summary,
    items,
    members,
  };
}

function parseInstantiateTemplateResult(payload: unknown) {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible d'instancier le template.");
  }

  const versionId =
    toStringValue(root.version_id) ??
    toStringValue(root.versionId);
  const projectId =
    toStringValue(root.project_id) ??
    toStringValue(root.projectId);
  const redirectTo =
    toStringValue(root.redirect_to) ??
    toStringValue(root.redirectTo) ??
    (versionId ? `/dashboard/estimates/${versionId}/edit` : null);

  if (!versionId || !projectId || !redirectTo) {
    throw new Error("Impossible d'instancier le template.");
  }

  // Sous-lot 2.10a : rapport d'un modèle entré dans une v3 (les deux listes, ou aucune hors moteur 3).
  const conversion: InstantiateEstimateTemplateConversion | undefined =
    Array.isArray(root.converted_lines) && Array.isArray(root.dropped_settings)
      ? {
          convertedLines: root.converted_lines.flatMap((line) => {
            if (!isRecord(line)) return [];
            const title = toStringValue(line.title);
            const templateHours = toNumber(line.template_hours);
            const convertedHours = toNumber(line.converted_hours);
            return title !== null && templateHours !== null && convertedHours !== null
              ? [{ title, templateHours, convertedHours }]
              : [];
          }),
          droppedSettings: root.dropped_settings.flatMap((entry) => {
            if (!isRecord(entry)) return [];
            const setting = toStringValue(entry.setting);
            const label = toStringValue(entry.label);
            return setting !== null && label !== null ? [{ setting, label }] : [];
          }),
        }
      : undefined;

  return {
    projectId,
    versionId,
    redirectTo,
    ...(conversion ? { conversion } : {}),
  };
}

export async function fetchEstimateList(): Promise<EstimateListItem[]> {
  const payload = await requestJson<unknown>(
    "/api/estimates",
    {
      method: "GET",
    },
    "Impossible de charger les chiffrages."
  );

  return parseEstimateList(payload);
}

export async function fetchEstimateDraftVersions(
  versionId: string
): Promise<EstimateDraftVersionTarget[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/draft-versions`,
    {
      method: "GET",
    },
    "Impossible de charger les versions brouillon."
  );

  return parseEstimateDraftVersionTargets(payload);
}

export async function fetchEstimateImportSources(options?: {
  excludeVersionId?: string;
}): Promise<EstimateImportSourceVersion[]> {
  const params = new URLSearchParams();
  if (options?.excludeVersionId?.trim()) {
    params.set("excludeVersionId", options.excludeVersionId.trim());
  }

  const query = params.toString();
  const path = query.length > 0
    ? `/api/estimates/import-sources?${query}`
    : "/api/estimates/import-sources";

  const payload = await requestJson(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les devis sources.",
    parseImportSourcesResponse
  );

  return payload.items.map(toEstimateImportSourceClient).sort((left, right) =>
    (isOlderEstimateVersionToken(left.updatedAt, right.updatedAt) ? 1
      : isOlderEstimateVersionToken(right.updatedAt, left.updatedAt) ? -1 : 0) || right.versionNumber - left.versionNumber);
}

export async function fetchEstimateImportableSections(
  sourceVersionId: string
): Promise<EstimateImportSectionPreview[]> {
  const payload = await requestJson(
    `/api/estimates/${sourceVersionId}/sections`,
    {
      method: "GET",
    },
    "Impossible de charger les sections importables.",
    value => parseImportSectionsPreviewResponse(value, sourceVersionId)
  );

  return payload.items.map(toEstimateImportSectionClient).sort((left, right) => left.position - right.position);
}

export async function fetchAffaireLinkedDpgfSource(
  projectId: string,
  options?: { signal?: AbortSignal }
): Promise<AffaireLinkedDpgfSource> {
  const payload = await requestJson(
    `/api/affaires/${encodeURIComponent(projectId)}/dpgf-source`,
    {
      method: "GET",
      signal: options?.signal,
    },
    "Impossible de charger la source DPGF de l'affaire.",
    parseLinkedDpgfSourceResponse
  );

  return toAffaireLinkedDpgfSourceClient(payload);
}

export async function importEstimateSections(
  targetVersionId: string,
  input: ImportEstimateSectionsPayload
): Promise<ImportEstimateSectionsResult> {
  const payload = await requestJson(
    `/api/estimates/${targetVersionId}/import-sections`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceVersionId: input.sourceVersionId,
        sectionIds: input.sectionIds,
        mode: input.mode,
      }),
    },
    "Impossible d'importer les sections.",
    value => parseImportSectionsResponse(value, { sourceVersionId: input.sourceVersionId, targetVersionId, mode: input.mode }),
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  return toImportEstimateSectionsClient(payload);
}

/** Reprise des prix : comparaison en lecture seule avec un devis de référence (docs/metier/reprise-des-prix.md). */
export async function previewEstimatePriceReuse(targetVersionId: string, referenceVersionId: string): Promise<PriceReusePreview> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse/preview`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference_version_id: referenceVersionId }) },
    "Impossible de comparer avec le devis de référence.",
    (value) => priceReusePreviewSchema.parse(value)
  );
}

/** Reprise des prix : proposition de Decisions ou du forfait ChatGPT pour des lignes à vérifier, sans écriture. */
export async function arbitrateEstimatePriceReuse(targetVersionId: string, input: PriceReuseArbitrationInput): Promise<PriceReuseArbitration> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse/arbitration`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
    "L’arbitrage n’a pas abouti. Choisissez les articles manuellement.",
    (value) => priceReuseArbitrationSchema.parse(value)
  );
}

/** Reprise des prix confirmée : une écriture atomique de l'éditeur, au jeton du brouillon. */
export async function applyEstimatePriceReuse(targetVersionId: string, input: PriceReuseApplyInput,
  updatedAt: string): Promise<PriceReuseApplyResult> {
  return requestJson(
    `/api/estimates/${targetVersionId}/price-reuse`,
    { method: "POST", headers: { "Content-Type": "application/json", "If-Match": updatedAt }, body: JSON.stringify(input) },
    "Impossible de reprendre les prix.",
    (value) => priceReuseApplySchema.parse(value),
    { mutation: { versionId: targetVersionId, structural: true } }
  );
}

export async function generateEstimateStructureDraft(
  targetVersionId: string,
  input: GenerateEstimateStructureDraftPayload = {}
): Promise<EstimateStructureDraft> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        strategy: input.strategy ?? "hybrid",
      }),
    },
    "Impossible de générer la prévisualisation de structure."
  );

  const parsed = parseEstimateStructureDraft(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la preview de structure.");
  }

  return parsed;
}

export async function fetchEstimateStructureDraft(
  targetVersionId: string,
  draftId: string
): Promise<EstimateStructureDraft> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts/${draftId}`,
    {
      method: "GET",
    },
    "Impossible de charger la preview de structure."
  );

  const parsed = parseEstimateStructureDraft(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la preview de structure.");
  }

  return parsed;
}

export async function applyEstimateStructureDraft(
  targetVersionId: string,
  draftId: string,
  input: ApplyEstimateStructureDraftPayload
): Promise<ApplyEstimateStructureDraftResult> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${targetVersionId}/structure-drafts/${draftId}/apply`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: input.mode,
        selectedRootNodeIds: input.selectedRootNodeIds,
        overrides: (input.overrides ?? []).map((override) => ({
          nodeId: override.nodeId,
          action: override.action,
          renameTo: override.renameTo ?? null,
          mergeIntoItemId: override.mergeIntoItemId ?? null,
        })),
      }),
    },
    "Impossible d'appliquer la preview de structure.",
    undefined,
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  const parsed = parseApplyEstimateStructureDraftResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat d'application.");
  }

  return parsed;
}

export async function fetchVersionZeroDraftSummary(
  versionId: string
): Promise<VersionZeroDraftSummary> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts`,
    {
      method: "GET",
    },
    "Impossible de charger le résumé de la V0."
  );

  return parseVersionZeroDraftSummary(payload);
}

export async function generateVersionZeroDraft(
  versionId: string,
  input: {
    briefId?: string | null;
    selectedLots?: string[];
  } = {}
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        briefId: input.briefId ?? null,
        selectedLots: input.selectedLots ?? [],
      }),
    },
    "Impossible de générer la V0."
  );

  return parseVersionZeroReview(payload);
}

export async function fetchVersionZeroReview(
  versionId: string,
  draftId: string
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}`,
    {
      method: "GET",
    },
    "Impossible de charger la revue V0."
  );

  return parseVersionZeroReview(payload);
}

export async function reviewVersionZeroLine(
  versionId: string,
  draftId: string,
  lineDraftId: string,
  input: {
    reviewStatus: Exclude<VersionZeroLineReviewStatus, "pending">;
    editedValues?: {
      title?: string | null;
      description?: string | null;
      quantity?: number | null;
      unit?: string | null;
    };
  }
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}/lines/${lineDraftId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reviewStatus: input.reviewStatus,
        editedValues: input.editedValues ?? null,
      }),
    },
    "Impossible de mettre à jour la ligne V0."
  );

  return parseVersionZeroReview(payload);
}

export async function materializeVersionZeroDraft(
  versionId: string,
  draftId: string
): Promise<VersionZeroReview> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/version-zero-drafts/${draftId}/materialize`,
    {
      method: "POST",
    },
    "Impossible de matérialiser la V0.",
    undefined,
    { mutation: { versionId: versionId, structural: true } }
  );

  return parseVersionZeroReview(payload);
}

export async function importLinkedDpgfSource(
  targetVersionId: string,
  input: ImportLinkedDpgfSourcePayload = {}
): Promise<ImportLinkedDpgfSourceResult> {
  const payload = await requestJson(
    `/api/estimates/${targetVersionId}/import-linked-dpgf`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sectionTitle: input.sectionTitle ?? null,
      }),
    },
    "Impossible d'importer la source DPGF liée.",
    value => parseImportLinkedDpgfResponse(value, targetVersionId),
    { mutation: { versionId: targetVersionId, structural: true } }
  );

  return toImportLinkedDpgfSourceClient(payload);
}

export async function createEstimate(
  input: CreateEstimatePayload
): Promise<string> {
  const projectName = input.projectName?.trim() ?? null;
  const projectId = input.projectId?.trim() ?? null;

  if (!projectId && !projectName) {
    throw new Error("projectName ou projectId est requis.");
  }

  const requestBody: Record<string, unknown> = {
    ...(input.creationMode
      ? {
          creation_mode:
            input.creationMode === "linkedDpgfSource"
              ? "linked_dpgf_source"
              : "blank",
        }
      : {}),
    version: {
      title: input.title,
      date_devis: input.dateDevis,
      validite_jours: input.validiteJours,
      // Ne pas forcer margin_multiplier: omettre la clé quand elle n'est pas
      // fournie laisse le serveur hériter de la marge de la dernière version
      // de l'affaire (sinon toute nouvelle version repart à 0 % de marge).
      ...(input.marginMultiplier != null
        ? { margin_multiplier: input.marginMultiplier }
        : {}),
      ...(input.marginMode ? { margin_mode: input.marginMode } : {}),
      ...(input.marginBp != null ? { margin_bp: input.marginBp } : {}),
      ...(input.taxRateBp != null ? { tax_rate_bp: input.taxRateBp } : {}),
      ...(input.roundingMode ? { rounding_mode: input.roundingMode } : {}),
      ...(input.roundingStepCents != null
        ? { rounding_step_cents: input.roundingStepCents }
        : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.saleCoefficientFo != null ? { sale_coefficient_fo: input.saleCoefficientFo } : {}),
      ...(input.saleCoefficientMo != null ? { sale_coefficient_mo: input.saleCoefficientMo } : {}),
      ...(input.expectedCalcEngineVersion != null
        ? { expected_calc_engine_version: input.expectedCalcEngineVersion }
        : {}),
    },
  };

  if (projectId) {
    requestBody.project_id = projectId;
  }

  if (projectName) {
    requestBody.project = {
      name: projectName,
      reference: input.reference ?? null,
      client_name: input.clientName ?? null,
      notes: input.projectNotes ?? null,
    };
  }

  const payload = await requestJson(
    "/api/estimates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    "Impossible de créer le chiffrage.",
    value => parseCreateEstimateResponse(value, projectId ?? undefined)
  );

  return payload.version.id;
}

export async function duplicateEstimateVersion(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/duplicate`,
    {
      method: "POST",
    },
    "Impossible de dupliquer le chiffrage.",
    value => parseEstimateVersionIdResponse(value, versionId)
  );

  return payload.version_id;
}

export async function duplicateEstimateSection(
  versionId: string,
  sectionId: string,
  options?: { targetVersionId?: string | null }
): Promise<DuplicateEstimateSectionResult> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/sections/${sectionId}/duplicate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        targetVersionId: options?.targetVersionId ?? null,
      }),
    },
    "Impossible de dupliquer la section.",
    value => parseDuplicateSectionResponse(value, { sourceVersionId: versionId, targetVersionId: options?.targetVersionId ?? versionId }),
    { mutation: { versionId: options?.targetVersionId ?? versionId, structural: true } }
  );

  return toDuplicateSectionClient(payload);
}

export async function createEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/variants`,
    {
      method: "POST",
    },
    "Impossible de créer la variante.",
    value => parseEstimateVersionIdResponse(value, versionId)
  );

  return payload.version_id;
}

export async function promoteEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/variants`,
    {
      method: "PATCH",
    },
    "Impossible de promouvoir la variante.",
    value => parsePromoteEstimateVariantResponse(value, versionId)
  );

  return payload.version.id;
}

export async function fetchEstimateVersionEvents(
  versionId: string,
  options: { signal?: AbortSignal } = {}
): Promise<EstimateVersionEvent[]> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/events`,
    {
      method: "GET",
      signal: options.signal,
    },
    "Impossible de charger les événements.",
    value => parseEstimateEventsResponse(value, versionId)
  );

  return payload.events;
}

function buildApprovalJournalQuery(input?: {
  authorUserId?: string | null;
  decision?: EstimateApprovalDecisionFilter | null;
  format?: "json" | "csv";
}) {
  const searchParams = new URLSearchParams();

  if (input?.authorUserId) {
    searchParams.set("author", input.authorUserId);
  }

  if (input?.decision) {
    searchParams.set("status", input.decision);
  }

  if (input?.format) {
    searchParams.set("format", input.format);
  }

  const query = searchParams.toString();
  return query.length > 0 ? `?${query}` : "";
}

export async function fetchEstimateApprovalDecisionJournal(
  versionId: string,
  filters?: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }
): Promise<EstimateApprovalDecisionJournal> {
  const { parseEstimateApprovalDecisionJournal } = await import("@/lib/estimates/approval-journal-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/approval-journal${buildApprovalJournalQuery(filters)}`,
    {
      method: "GET",
    },
    "Impossible de charger le journal de décision."
  );

  const parsed = parseEstimateApprovalDecisionJournal(payload);
  if (!parsed) {
    throw new Error("Réponse journal d'approbation invalide.");
  }

  return parsed;
}

export async function downloadEstimateApprovalDecisionJournalCsv(
  versionId: string,
  filters?: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }
): Promise<EstimateExportResult> {
  const response = await fetch(
    `/api/estimates/${versionId}/approval-journal${buildApprovalJournalQuery({
      ...filters,
      format: "csv",
    })}`,
    {
      method: "GET",
      credentials: "same-origin",
    }
  );

  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible d'exporter le journal de décision."),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromContentDisposition(
      response.headers.get("Content-Disposition")
    ) ?? `approval-journal-${versionId}.csv`;

  downloadBlob(blob, filename);

  return {
    filename,
    size: blob.size,
  };
}

export async function fetchEstimateOutlierDismissedFlags(
  versionId: string
): Promise<EstimateOutlierFlagsByItemId> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/outliers`,
    {
      method: "GET",
    },
    "Impossible de charger les valeurs atypiques acceptées."
  );

  return normalizeOutlierDismissedByItemId(payload);
}

export async function toggleEstimateOutlierDismissedFlag(
  versionId: string,
  input: ToggleEstimateOutlierDismissPayload
): Promise<EstimateOutlierFlagsByItemId> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/outliers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item_id: input.itemId,
        flag_key: input.flagKey,
        dismissed: input.dismissed,
      }),
    },
    "Impossible de mettre à jour le statut d'acceptation de l'outlier."
  );

  return normalizeOutlierDismissedByItemId(payload);
}

export async function saveEstimateVersion(
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string,
  expectedContentRevision: number
): Promise<{ version: EstimateVersionRow; items: EstimateItem[] }> {
  const payload = await requestJson(
    `/api/estimates/${versionId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        ...updates,
        updated_at: updatedAtToken,
        expected_content_revision: expectedContentRevision,
      }),
    },
    "Impossible de sauvegarder le chiffrage.",
    value => parseSaveEstimateVersionResponse(value, versionId),
    { mutation: { versionId: versionId, structural: false } }
  );

  return payload;
}

export async function bulkUpdateEstimateItems(
  versionId: string,
  updatedAtToken: string,
  updates: Array<{
    id: string;
    updates: Database["public"]["Tables"]["estimate_items"]["Update"];
  }>,
  versionPatch?: BulkUpdateEstimateVersionPatch
): Promise<BulkUpdateEstimateItemsResult> {
  if (updates.length === 0 && !versionPatch) {
    return {
      updatedCount: 0,
      versionToken: {
        id: versionId,
        updated_at: updatedAtToken,
      },
    };
  }

  const payload = await requestJson(
    `/api/estimates/${versionId}/items/bulk`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        updated_at: updatedAtToken,
        updates: updates.map((entry) => ({
          id: entry.id,
          ...entry.updates,
        })),
        ...(versionPatch ? { version_patch: versionPatch } : {}),
      }),
    },
    "Impossible de mettre à jour les lignes.",
    value => parseBulkUpdateEstimateItemsResponse(value, versionId),
    { mutation: { versionId: versionId, structural: false } }
  );

  return { updatedCount: payload.updated_count, versionToken: payload.version, ...(payload.totals ? { totals: payload.totals } : {}) };
}

// Lot 2, sous-lot 2.6 (revue) : colonnes de saisie d'une ligne v3 (D4, D9), transmises à la création.
const V3_CREATE_INPUT_KEYS = ["unit_code", "pricing_status", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit"] as const;

function toCreateEstimateItemBody(
  item: Database["public"]["Tables"]["estimate_items"]["Insert"]
) {
  const itemWithSource = item as typeof item & {
    h_mo_majoration?: number | null;
    supply_type_id?: string | null;
    product_id?: string | null;
    selected_supplier_price_id?: string | null;
    source_provider?: string | null;
    source_job_id?: string | null;
    source_file_name?: string | null;
    source_page?: number | null;
  };

  return item.item_type === "section"
    ? {
        item_type: "section" as const,
        parent_id: item.parent_id ?? null,
        position: item.position,
        title: item.title,
        aid: item.aid ?? null,
        source_provider: itemWithSource.source_provider ?? null,
        source_job_id: itemWithSource.source_job_id ?? null,
        source_file_name: itemWithSource.source_file_name ?? null,
        source_page: itemWithSource.source_page ?? null,
      }
    : {
        item_type: "line" as const,
        line_nature: item.line_nature ?? undefined,
        parent_id: item.parent_id ?? null,
        position: item.position,
        title: item.title,
        aid: item.aid ?? null,
        description: item.description ?? null,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        ...(typeof item.k_fo_manual === "boolean" ? { k_fo_manual: item.k_fo_manual } : {}),
        ...(item.fo_price_origin !== undefined ? { fo_price_origin: item.fo_price_origin } : {}),
        h_mo: item.h_mo,
        h_mo_majoration: itemWithSource.h_mo_majoration ?? undefined,
        h_mo_atelier: item.h_mo_atelier,
        k_mo_atelier: item.k_mo_atelier,
        labor_role_atelier_id: item.labor_role_atelier_id,
        h_mo_chantier: item.h_mo_chantier,
        k_mo_chantier: item.k_mo_chantier,
        labor_role_chantier_id: item.labor_role_chantier_id,
        k_mo: item.k_mo,
        labor_role_id: item.labor_role_id ?? null,
        category_id: item.category_id ?? null,
        supply_type_id: itemWithSource.supply_type_id ?? null,
        ...(itemWithSource.product_id
          ? { product_id: itemWithSource.product_id }
          : {}),
        selected_supplier_price_id: itemWithSource.selected_supplier_price_id ?? null,
        source_provider: itemWithSource.source_provider ?? null,
        source_job_id: itemWithSource.source_job_id ?? null,
        source_file_name: itemWithSource.source_file_name ?? null,
        source_page: itemWithSource.source_page ?? null,
        // Lot 2, sous-lot 2.6 (revue) : saisies d'une ligne v3, seulement quand la charge les porte (recréation
        // d'une ligne v3) ; une charge v1/v2 n'en porte aucune et reste identique.
        ...Object.fromEntries(V3_CREATE_INPUT_KEYS.flatMap((key) => (item[key] === undefined ? [] : [[key, item[key]]]))),
      };
}

export async function createEstimateItem(
  versionId: string,
  item: Database["public"]["Tables"]["estimate_items"]["Insert"],
  options: EstimateMutationVersionTokenOptions = {}
): Promise<EstimateItem> {
  const body = toCreateEstimateItemBody(item);
  let acknowledgedVersion: EstimateVersionToken | undefined;
  const documentOwnsReceipt = options.documentOwnsReceipt === true && Boolean(options.onVersionToken);

  const payload = await requestJson(
    `/api/estimates/${versionId}/items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible d'ajouter la ligne.",
    value => parseEstimateItemWriteResponse(value, versionId),
    { mutation: { versionId: versionId, structural: true },
      ...(documentOwnsReceipt ? {
      deferVersionPublication: true,
      onAcknowledgedVersion: (version) => { acknowledgedVersion = version; },
    } : undefined)
    }
  );

  if (options.onVersionToken) {
    const versionToken = acknowledgedVersion ?? payload.version;
    options.onVersionToken(versionToken);
  }

  return payload.item;
}

/**
 * TI-682, lot C, PR 4: an administrator declares (or withdraws, null) the written reserve of a « Non chiffrée » line.
 * Queued with the editor's writes (version token, draft lock); the answer carries the line's choice and the new token.
 */
export async function setEstimateLineOfferChoice(
  versionId: string,
  itemId: string,
  choice: EstimateOfferChoiceInput | null,
  versionToken: string,
): Promise<EstimateOfferChoiceReceipt> {
  return requestJson(
    `/api/estimates/${versionId}/items/${itemId}/offer-choice`,
    {
      method: choice ? "PUT" : "DELETE",
      headers: { "Content-Type": "application/json", "If-Match": versionToken },
      ...(choice ? { body: JSON.stringify(choice) } : {}),
    },
    "Impossible d'enregistrer la réserve.",
    (value) => {
      const receipt = estimateOfferChoiceReceiptSchema.parse(value);
      if (receipt.item.id.toLowerCase() !== itemId.toLowerCase() || receipt.version.id.toLowerCase() !== versionId.toLowerCase()) {
        throw new Error("La confirmation appartient à une autre ligne.");
      }
      return receipt;
    },
    { mutation: { versionId, structural: false } }
  );
}

export async function updateEstimateItem(
  versionId: string,
  itemId: string,
  updates: Database["public"]["Tables"]["estimate_items"]["Update"]
): Promise<void> {
  await requestJson(
    `/api/estimates/${versionId}/items`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: itemId,
        ...updates,
      }),
    },
    "Impossible de mettre à jour la ligne.",
    value => parseEstimateItemWriteResponse(value, versionId, itemId),
    { mutation: { versionId: versionId, structural: true } }
  );
}

export async function deleteEstimateItem(
  versionId: string,
  itemId: string
): Promise<{ versionToken: EstimateVersionToken; deletedIds: string[] }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: itemId,
      }),
    },
    "Impossible de supprimer la ligne.",
    (data) => parseEstimateItemDeleteResponse(data, versionId, itemId),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version, deletedIds: receipt.deleted_ids };
}

export async function reorderEstimateItems(
  versionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<{ versionToken: EstimateVersionToken }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items/reorder`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parent_id: parentId,
        ordered_ids: orderedIds,
      }),
    },
    "Impossible de reordonner les lignes.",
    (data) => parseEstimateItemsReorderResponse(data, { versionId, parentId, orderedIds }),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version };
}

export async function moveEstimateItem(
  versionId: string,
  payload: MoveEstimateItemInput
): Promise<{ versionToken: EstimateVersionToken }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items/move`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible de déplacer l'élément.",
    (data) => parseEstimateItemsMoveResponse(data, versionId, payload),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version };
}

export async function batchEstimateOperations(
  versionId: string,
  updatedAtToken: string,
  operations: EstimateBatchOperation[],
  options: { dryRun?: boolean; attempt?: EstimateBatchAttempt } = {}
): Promise<EstimateBatchResult> {
  // Load the receipt/parser only for batch work; the editor's initial bundle
  // does not need the recovery implementation to display a quote.
  const publicOperations = operations.map((operation) => operation.op === "create"
    ? { op: "create" as const, data: toCreateEstimateItemBody(operation.data) }
    : operation);
  const operationsSnapshot = JSON.parse(JSON.stringify(publicOperations)) as BatchOperationInput[];
  return runEstimateEditorMutation(versionId, updatedAtToken, async (token, scope) => {
    const { executeClientEstimateBatch } = await import("@/lib/estimates/batch-client");
    const result = await executeClientEstimateBatch({
      transport: (path, init, message) => requestJsonUncoordinated(path, init, message, true),
      versionId, updatedAtToken: token ?? updatedAtToken,
      operations: operationsSnapshot, ...options,
    });
    if (result.value.committed && result.version.content_revision === undefined) {
      const readVersion = async () => {
        const read = parseVersionToken(await requestJsonUncoordinated<unknown>(
          `/api/estimates/${versionId}`, { method: "GET" }, "Impossible de confirmer la révision des lignes."
        ));
        if (!read || read.id !== versionId || read.content_revision === undefined) throw new Error("La révision du devis est manquante.");
        return read;
      };
      try {
        const read = await readVersion();
        if (isOlderEstimateVersionToken(read.updated_at, result.version.updated_at) ||
          isOlderEstimateVersionToken(result.version.updated_at, read.updated_at)) throw new Error("Le devis a changé après la sauvegarde des lignes.");
        result.version = { ...result.version, content_revision: read.content_revision };
      } catch {
        scope.requireRead(async () => ({ version: await readVersion(), structural: false, needsReload: true }),
          "Les lignes ont été sauvegardées, mais leur révision n'a pas pu être confirmée. Relisez le devis avant de reprendre ; vos saisies sont conservées.");
      }
    }
    return result;
  });
}

export async function inspectEstimateBatchReceipt(identity: EstimateBatchIdentity) {
  const { inspectClientEstimateBatch } = await import("@/lib/estimates/batch-client");
  return inspectClientEstimateBatch((path, init, message) => requestJsonUncoordinated(path, init, message, true), identity);
}

export async function resumeEstimateBatchOperation(identity: EstimateBatchIdentity) {
  const { resumeClientEstimateBatch } = await import("@/lib/estimates/batch-client");
  return resumeClientEstimateBatch((path, init, message) => requestJsonUncoordinated(path, init, message, true), identity);
}

export async function exportEstimate(
  versionId: string,
  /** csv : CSV d'une v3 écrit par le serveur (sous-lot 2.7b) ; celui d'une v1/v2 reste construit par l'éditeur. */
  format: "xlsx" | "csv" = "xlsx",
  options: {
    mode?: EstimateExportMode;
  } = {}
): Promise<EstimateExportResult> {
  const queryParams = new URLSearchParams({
    format,
  });
  if (typeof options.mode === "string") {
    queryParams.set("mode", options.mode);
  }

  const response = await fetch(`/api/estimates/${versionId}/export?${queryParams.toString()}`, {
    method: "GET",
    credentials: "same-origin",
  });

  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible d'exporter le devis."),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const blob = await response.blob();
  const filename =
    extractFilenameFromContentDisposition(
      response.headers.get("content-disposition")
    ) ?? `devis-${versionId}.${format}`;

  downloadBlob(blob, filename);

  return {
    filename,
    size: blob.size,
  };
}

export async function updateEstimateStatus(
  versionId: string,
  status: EstimateStatus,
  updatedAtToken: string,
  options: { force?: boolean } = {}
): Promise<EstimateVersionRow> {
  const payload = await requestJson(
    `/api/estimates/${versionId}/status`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        status,
        updated_at: updatedAtToken,
        force: options.force === true ? true : undefined,
      }),
    },
    "Impossible de mettre à jour le statut.",
    value => parseEstimateStatusResponse(value, versionId, status),
    { mutation: { versionId: versionId, structural: false } }
  );

  return payload.version;
}

export async function fetchEstimateSendGating(
  versionId: string
): Promise<EstimateSendGatingResponse> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/gating`,
    {
      method: "GET",
    },
    "Impossible de vérifier les préconditions d'envoi."
  );

  const root = getRootPayload(payload);
  const parsed = parseEstimateSendGatingResponse(
    isRecord(root) && root.gating !== undefined ? root.gating : root
  );

  if (!parsed) {
    throw new Error("Impossible de lire les préconditions d'envoi.");
  }

  return parsed;
}

export async function requestEstimatePdfGeneration(
  versionId: string,
  options: {
    force?: boolean;
    layout?: EstimatePdfLayoutOptions;
    onPrepared?: (data: EstimateEditorData) => void;
  } = {}
): Promise<EstimatePdfStatusResponse> {
  const query = new URLSearchParams();
  if (options.force) {
    query.set("force", "1");
  }

  const path = query.size > 0
    ? `/api/estimates/${versionId}/pdf?${query.toString()}`
    : `/api/estimates/${versionId}/pdf`;

  const request = async () => {
    const payload = await requestJsonUncoordinated<unknown>(
      path,
      {
        method: "POST",
        headers: {
          [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: getEstimateDraftLockSessionId(versionId),
          ...(options.layout ? { "Content-Type": "application/json" } : {}),
        },
        body: options.layout
          ? JSON.stringify({ layout: options.layout })
          : undefined,
      },
      "Impossible de lancer la generation du PDF."
    );

    const parsed = parseEstimatePdfStatus(payload);
    if (!parsed) {
      throw new Error("Impossible de lire le statut de generation du PDF.");
    }
    return parsed;
  };
  if (!hasEstimateEditorMutationSession(versionId)) return request();
  return runEstimateEditorMutation(versionId, undefined, async (_token, scope) => {
    const identity = getEstimateEditorMutationIdentity(versionId);
    if (identity) assertNoPendingEstimateBatch(identity);
    const value = await request();
    // The first document freeze changes the CAS token and line snapshots.
    // Reconcile both under the same queue before another editor save starts.
    const read = async () => {
      const currentIdentity = getEstimateEditorMutationIdentity(versionId);
      if (JSON.stringify(currentIdentity) !== JSON.stringify(identity)) throw new Error("Le compte ou le devis a changé. La lecture est annulée.");
      const refreshed = await fetchEstimateEditorData(versionId);
      if (!scope.isActive() || JSON.stringify(getEstimateEditorMutationIdentity(versionId)) !== JSON.stringify(identity)) {
        throw new Error("L'éditeur a changé. La lecture est annulée.");
      }
      if (refreshed.version.id !== versionId) throw new Error("La préparation reçue appartient à un autre devis.");
      options.onPrepared?.(refreshed);
      return { version: { id: refreshed.version.id, updated_at: refreshed.version.updated_at }, structural: false };
    };
    try { return { value, ...await read() }; }
    catch { throw scope.requireRead(read); }
  });
}

export async function fetchEstimatePdfLayoutConfiguration(
  versionId: string
): Promise<EstimatePdfLayoutConfigurationResponse> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/pdf/layout`,
    { method: "GET" },
    "Impossible de charger les options de mise en page du devis."
  );
  const parsed = parseEstimatePdfLayoutConfiguration(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les options de mise en page du devis.");
  }
  return parsed;
}

/** Fetch the authorized binary before announcing success. Opening a popup after
 * asynchronous generation can be blocked even though the server job is ready. */
export async function downloadEstimatePdf(versionId: string): Promise<void> {
  const response = await fetch(`/api/estimates/${versionId}/pdf`, { credentials: "same-origin" });
  if (!response.ok) {
    const payload = await readJson(response);
    throw new EstimateApiError(
      toErrorMessage(payload, "Impossible de télécharger le PDF."), response.status,
      extractErrorDetails(payload), extractErrorCode(payload),
    );
  }
  const blob = await response.blob();
  if (await blob.slice(0, 5).text() !== "%PDF-") {
    throw new Error("Le fichier reçu n'est pas un PDF valide.");
  }
  downloadBlob(blob, extractFilenameFromContentDisposition(response.headers.get("content-disposition")) ?? `devis-${versionId}.pdf`);
}

export async function fetchEstimatePdfStatus(
  versionId: string
): Promise<EstimatePdfStatusResponse> {
  try {
    const payload = await requestJson<unknown>(
      `/api/estimates/${versionId}/pdf?format=json`,
      {
        method: "GET",
      },
      "Impossible de récupérer le statut du PDF."
    );

    const parsed = parseEstimatePdfStatus(payload);
    if (!parsed) {
      throw new Error("Impossible de lire le statut du PDF.");
    }

    return parsed;
  } catch (error) {
    if (
      isEstimateApiError(error) &&
      (error.code === "PDF_NOT_READY" || error.code === "PDF_GENERATION_FAILED")
    ) {
      const parsed = parseEstimatePdfStatus(error.details);
      if (parsed) {
        return parsed;
      }

      if (error.code === "PDF_GENERATION_FAILED") {
        return {
          status: "failed",
          lastError: error.message,
        };
      }

      return {
        status: "missing",
      };
    }

    throw error;
  }
}

export async function fetchEstimatePurchaseOrderDraftPreparation(
  versionId: string
): Promise<EstimatePurchaseOrderDraftPreparation> {
  const { parseEstimatePurchaseOrderDraftPreparation } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    {
      method: "GET",
    },
    "Impossible de préparer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftPreparation(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la préparation des brouillons de commandes.");
  }

  return parsed;
}

export async function createEstimatePurchaseOrderDrafts(
  versionId: string,
  input: CreateEstimatePurchaseOrderDraftsInput
): Promise<EstimatePurchaseOrderDraftCreationResult> {
  const { parseEstimatePurchaseOrderDraftCreationResult } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        idempotency_key: input.idempotencyKey,
        reviewed_lines: input.reviewedLines.map((line) => ({
          item_id: line.itemId,
          review_fingerprint: line.reviewFingerprint,
        })),
        groups: input.groups.map((group) => ({
          supplier_id: group.supplierId,
          delivery_site_id: group.deliverySiteId,
          delivery_site_updated_at: group.deliverySiteUpdatedAt,
          item_ids: group.itemIds,
          expected_delivery_date: group.expectedDeliveryDate ?? null,
          notes: group.notes ?? null,
        })),
      }),
    },
    "Impossible de créer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftCreationResult(payload);
  if (!parsed || parsed.sourceVersionId !== versionId || parsed.idempotencyKey !== input.idempotencyKey) {
    throw new Error("Impossible de lire le résultat de création des brouillons.");
  }

  return parsed;
}

export async function fetchEstimatePurchaseOrderDraftReceipt(
  versionId: string,
  idempotencyKey: string
): Promise<EstimatePurchaseOrderDraftCreationResult | null> {
  const { parseEstimatePurchaseOrderDraftCreationResult } = await import("@/lib/estimates/purchase-order-draft-contracts");
  const query = new URLSearchParams({ idempotency_key: idempotencyKey });
  const response = await fetch(
    `/api/estimates/${versionId}/purchase-order-drafts?${query.toString()}`,
    { method: "GET", cache: "no-store", credentials: "same-origin" }
  );
  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch {
    throw new Error("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.");
  }
  if (!response.ok) {
    throw new EstimateApiError(
      toErrorMessage(envelope, "Impossible de vérifier le résultat de la préparation."),
      response.status,
      extractErrorDetails(envelope),
      extractErrorCode(envelope)
    );
  }
  if (!isRecord(envelope) || envelope.ok !== true || !hasOwnProperty(envelope, "data")) {
    throw new Error("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.");
  }
  const payload = envelope.data;
  if (payload === null) return null;
  const parsed = parseEstimatePurchaseOrderDraftCreationResult(payload);
  if (!parsed || parsed.sourceVersionId !== versionId || parsed.idempotencyKey !== idempotencyKey) {
    throw new Error("Impossible de lire le reçu de la préparation.");
  }
  return parsed;
}

export async function createEstimateCategory(
  versionId: string,
  category: Pick<
    Database["public"]["Tables"]["estimate_categories"]["Insert"],
    "name" | "color" | "position"
  >
): Promise<EstimateCategory> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/categories`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(category),
    },
    "Impossible de créer la catégorie."
  );

  const entity = extractEntity(payload, ["category", "item"]);
  if (!entity) {
    throw new Error("Impossible de créer la catégorie.");
  }

  return entity as EstimateCategory;
}

export async function createEstimateLaborRole(
  versionId: string,
  role: Pick<
    Database["public"]["Tables"]["labor_roles"]["Insert"],
    "name" | "hourly_rate_cents" | "is_active" | "position"
  >
): Promise<LaborRole> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(role),
    },
    "Impossible de créer le rôle."
  );

  const entity = extractEntity(payload, ["labor_role", "laborRole", "role"]);
  if (!entity) {
    throw new Error("Impossible de créer le rôle.");
  }

  return entity as LaborRole;
}

export async function updateEstimateLaborRole(
  versionId: string,
  roleId: string,
  updates: Database["public"]["Tables"]["labor_roles"]["Update"]
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/labor-roles/${roleId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre à jour le rôle."
  );
}

export async function createMarginTier(
  tier: Pick<
    Database["public"]["Tables"]["margin_tiers"]["Insert"],
    "threshold_cents" | "multiplier"
  >
): Promise<MarginTier> {
  const payload = await requestJson<unknown>(
    `/api/margin-tiers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(tier),
    },
    "Impossible de créer la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de créer la tranche de marge.");
  }

  return entity as MarginTier;
}

export async function updateMarginTier(
  tierId: string,
  updates: Database["public"]["Tables"]["margin_tiers"]["Update"]
): Promise<MarginTier> {
  const payload = await requestJson<unknown>(
    `/api/margin-tiers/${tierId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre à jour la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de mettre à jour la tranche de marge.");
  }

  return entity as MarginTier;
}

export async function deleteMarginTier(tierId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/margin-tiers/${tierId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer la tranche de marge."
  );
}

export async function createEstimateSuggestionRule(
  versionId: string,
  rule: Pick<
    Database["public"]["Tables"]["estimate_suggestion_rules"]["Insert"],
    | "name"
    | "match_type"
    | "match_value"
    | "unit"
    | "category_id"
    | "k_fo"
    | "k_mo"
    | "labor_role_id"
    | "position"
    | "is_active"
  >
): Promise<SuggestionRule> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rule),
    },
    "Impossible de créer la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  if (!entity) {
    throw new Error("Impossible de créer la règle.");
  }

  return entity as SuggestionRule;
}

export async function updateEstimateSuggestionRule(
  versionId: string,
  ruleId: string,
  updates: Database["public"]["Tables"]["estimate_suggestion_rules"]["Update"]
): Promise<SuggestionRule | null> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre à jour la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function sendEstimateSuggestionRuleFeedback(
  versionId: string,
  ruleId: string,
  feedback: SuggestionRuleFeedback,
  count?: number
): Promise<SuggestionRule | null> {
  const feedbackPayload: {
    feedback: SuggestionRuleFeedback;
    count?: number;
  } = {
    feedback,
  };
  if (typeof count === "number") {
    feedbackPayload.count = count;
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-rules/${ruleId}/feedback`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(feedbackPayload),
    },
    "Impossible d'enregistrer le feedback de la règle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function fetchEstimateSuggestionLearnings(
  versionId: string,
  options: { signal?: AbortSignal } = {}
): Promise<SuggestionLearningState> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-learning`,
    {
      method: "GET",
      signal: options.signal,
    },
    "Impossible de charger les apprentissages de suggestion."
  );

  const parsed = parseSuggestionLearningState(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les apprentissages de suggestion.");
  }

  return parsed;
}

export async function trackEstimateSuggestionCorrections(
  versionId: string,
  payload: TrackEstimateSuggestionCorrectionsPayload
): Promise<TrackEstimateSuggestionCorrectionsResult> {
  const result = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-learning`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible d'enregistrer les corrections d'apprentissage."
  );

  const parsed = parseTrackEstimateSuggestionCorrectionsResult(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de suivi des corrections.");
  }

  return parsed;
}

export async function fetchAdminSuggestionLearningProposals(): Promise<SuggestionLearningState> {
  const payload = await requestJson<unknown>(
    "/api/admin/suggestion-learning",
    {
      method: "GET",
    },
    "Impossible de charger les propositions d'apprentissage."
  );

  const parsed = parseSuggestionLearningState(payload);
  if (!parsed) {
    throw new Error("Impossible de lire les propositions d'apprentissage.");
  }

  return parsed;
}

export async function reviewAdminSuggestionLearningProposal(
  payload: ReviewAdminSuggestionLearningProposalPayload
): Promise<SuggestionLearningState> {
  const result = await requestJson<unknown>(
    "/api/admin/suggestion-learning",
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible de valider la proposition d'apprentissage."
  );

  const parsed = parseSuggestionLearningState(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de revue.");
  }

  return parsed;
}

export async function purgeAdminSuggestionLearnings(
  payload?: PurgeAdminSuggestionLearningsPayload
): Promise<PurgeAdminSuggestionLearningsResult> {
  const result = await requestJson<unknown>(
    "/api/admin/suggestion-learning/purge",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload ?? {}),
    },
    "Impossible de purger l'historique d'apprentissage."
  );

  const parsed = parsePurgeAdminSuggestionLearningsResult(result);
  if (!parsed) {
    throw new Error("Impossible de lire le résultat de purge.");
  }

  return parsed;
}

export async function fetchEstimateTemplates(options?: {
  search?: string;
  limit?: number;
  order?: "recent" | "oldest";
}): Promise<EstimateTemplateSummary[]> {
  const params = new URLSearchParams();
  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.floor(options.limit)));
  }
  if (options?.order) {
    params.set("order", options.order);
  }

  const query = params.toString();
  const path = query.length > 0
    ? `/api/estimates/templates?${query}`
    : "/api/estimates/templates";

  const payload = await requestJson<unknown>(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les templates."
  );

  return parseEstimateTemplateSummaryList(payload);
}

export async function fetchEstimateTemplate(
  templateId: string
): Promise<EstimateTemplateDetail> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "GET",
    },
    "Impossible de charger le template."
  );

  return parseEstimateTemplateDetail(payload);
}

export async function createEstimateTemplate(
  input: CreateEstimateTemplatePayload
): Promise<EstimateTemplateSummary> {
  const payload = await requestJson<unknown>(
    "/api/estimates/templates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceVersionId: input.sourceVersionId,
        name: input.name,
        description: input.description ?? null,
      }),
    },
    "Impossible de créer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de créer le template.");
  }

  return parsed;
}

export async function updateEstimateTemplate(
  templateId: string,
  updates: UpdateEstimateTemplatePayload
): Promise<EstimateTemplateSummary> {
  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    },
    "Impossible de mettre à jour le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de mettre à jour le template.");
  }

  return parsed;
}

export async function deleteEstimateTemplate(templateId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/templates/${templateId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer le template."
  );
}

export async function duplicateEstimateTemplate(
  templateId: string,
  options?: { name?: string | null }
): Promise<EstimateTemplateSummary> {
  const body: Record<string, unknown> = {};
  if (options?.name && options.name.trim().length > 0) {
    body.name = options.name.trim();
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/duplicate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible de dupliquer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de dupliquer le template.");
  }

  return parsed;
}

export async function instantiateEstimateFromTemplate(
  templateId: string,
  input: InstantiateEstimateTemplatePayload
): Promise<InstantiateEstimateTemplateResult> {
  const projectName = input.projectName?.trim() ?? null;
  const projectId = input.projectId?.trim() ?? null;

  if (!projectId && !projectName) {
    throw new Error("projectName ou projectId est requis.");
  }

  const requestBody: Record<string, unknown> = {
    versionTitle: input.versionTitle ?? null,
    dateDevis: input.dateDevis,
    validiteJours: input.validiteJours,
    projectNotes: input.projectNotes ?? null,
    ...(input.expectedCalcEngineVersion != null
      ? { expectedCalcEngineVersion: input.expectedCalcEngineVersion }
      : {}),
  };

  if (projectId) {
    requestBody.projectId = projectId;
  }

  if (projectName) {
    requestBody.projectName = projectName;
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/instantiate`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    "Impossible d'instancier le template."
  );

  return parseInstantiateTemplateResult(payload);
}

export async function insertTemplateIntoVersion(
  templateId: string,
  input: {
    versionId: string;
    afterItemId?: string | null;
  }
): Promise<EstimateItem[]> {
  const params = new URLSearchParams();
  params.set("versionId", input.versionId);

  const payload = await requestJson<unknown>(
    `/api/estimates/templates/${templateId}/insert?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        afterItemId: input.afterItemId ?? null,
      }),
    },
    "Impossible d'insérer le template.",
    undefined,
    { mutation: { versionId: input.versionId, structural: true } }
  );

  return parseEstimateItems(payload);
}

function toAssemblyItemRequestPayload(
  item: CreateEstimateAssemblyPayload["items"][number]
) {
  return {
    title: item.title,
    unit: item.unit ?? null,
    k_fo: item.kFo ?? 1,
    k_mo: item.kMo ?? 1,
    labor_role_id: item.laborRoleId ?? null,
    supply_type_id: item.supplyTypeId ?? null,
    default_quantity: item.defaultQuantity ?? null,
    h_mo: item.laborHours ?? 0,
    position: item.position,
    cost_type: item.costType ?? "material",
    unit_cost_ht_cents: item.unitCostHtCents ?? 0,
    loss_coeff_bp: item.lossCoeffBp ?? 0,
    yield_value: item.yieldValue ?? null,
    yield_unit: item.yieldUnit ?? null,
    source_metadata: item.sourceMetadata ?? {},
  };
}

function toAssemblyMemberRequestPayload(
  member: NonNullable<CreateEstimateAssemblyPayload["members"]>[number]
) {
  return {
    child_assembly_id: member.childAssemblyId,
    quantity: member.quantity,
    position: member.position,
  };
}

export async function fetchEstimateAssemblies(options?: {
  search?: string;
  limit?: number;
  order?: "recent" | "oldest";
}): Promise<EstimateAssemblySummary[]> {
  const params = new URLSearchParams();
  if (options?.search?.trim()) {
    params.set("search", options.search.trim());
  }
  if (options?.limit && Number.isFinite(options.limit) && options.limit > 0) {
    params.set("limit", String(Math.floor(options.limit)));
  }
  if (options?.order) {
    params.set("order", options.order);
  }

  const query = params.toString();
  const path = query.length > 0
    ? `/api/estimates/assemblies?${query}`
    : "/api/estimates/assemblies";

  const payload = await requestJson<unknown>(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les ouvrages."
  );

  return parseEstimateAssemblySummaryList(payload);
}

export async function fetchEstimateAssemblyOptions(): Promise<{
  laborRoles: EstimateAssemblyLaborRole[];
  supplyTypes: EstimateAssemblySupplyType[];
  assemblies: EstimateAssemblySummary[];
}> {
  const payload = await requestJson<unknown>(
    "/api/estimates/assemblies?limit=100",
    {
      method: "GET",
    },
    "Impossible de charger les options des ouvrages."
  );
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    return { laborRoles: [], supplyTypes: [], assemblies: [] };
  }

  return {
    assemblies: parseEstimateAssemblySummaryList(payload),
    laborRoles: Array.isArray(root.labor_roles)
      ? (root.labor_roles.filter((entry) => isRecord(entry)) as EstimateAssemblyLaborRole[])
      : [],
    supplyTypes: Array.isArray(root.supply_types)
      ? (root.supply_types.filter((entry) => isRecord(entry)) as EstimateAssemblySupplyType[])
      : [],
  };
}
export async function fetchEstimateAssembly(
  assemblyId: string
): Promise<EstimateAssemblyDetail> {
  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "GET",
    },
    "Impossible de charger l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function createEstimateAssembly(
  input: CreateEstimateAssemblyPayload
): Promise<EstimateAssemblyDetail> {
  const payload = await requestJson<unknown>(
    "/api/estimates/assemblies",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: input.name,
        description: input.description ?? null,
        reference_code: input.referenceCode ?? null,
        unit: input.unit ?? null,
        items: input.items.map((item) => toAssemblyItemRequestPayload(item)),
        members: (input.members ?? []).map((member) =>
          toAssemblyMemberRequestPayload(member)),
      }),
    },
    "Impossible de créer l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function updateEstimateAssembly(
  assemblyId: string,
  updates: UpdateEstimateAssemblyPayload
): Promise<EstimateAssemblyDetail> {
  const body: Record<string, unknown> = {};

  if ("name" in updates) {
    body.name = updates.name;
  }
  if ("description" in updates) {
    body.description = updates.description ?? null;
  }
  if ("referenceCode" in updates) {
    body.reference_code = updates.referenceCode ?? null;
  }
  if ("unit" in updates) {
    body.unit = updates.unit ?? null;
  }
  if ("items" in updates && updates.items) {
    body.items = updates.items.map((item) => toAssemblyItemRequestPayload(item));
  }
  if ("members" in updates && updates.members) {
    body.members = updates.members.map((member) =>
      toAssemblyMemberRequestPayload(member)
    );
  }

  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible de mettre à jour l'ouvrage."
  );

  return parseEstimateAssemblyDetail(payload);
}

export async function deleteEstimateAssembly(assemblyId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "DELETE",
    },
    "Impossible de supprimer l'ouvrage."
  );
}

export async function duplicateEstimateAssembly(
  assemblyId: string,
  options?: { name?: string | null }
): Promise<EstimateAssemblyDetail> {
  const source = await fetchEstimateAssembly(assemblyId);

  return createEstimateAssembly({
    name: options?.name?.trim() || `${source.name} (copie)`,
    description: source.description,
    unit: source.unit,
    items: source.items.map((item) => ({
      title: item.title,
      unit: item.unit,
      kFo: item.k_fo,
      kMo: item.k_mo,
      laborRoleId: item.labor_role_id,
      supplyTypeId: item.supply_type_id,
      defaultQuantity: item.default_quantity,
      laborHours: item.h_mo,
      costType: item.cost_type,
      unitCostHtCents: item.unit_cost_ht_cents,
      lossCoeffBp: item.loss_coeff_bp,
      yieldValue: item.yield_value,
      yieldUnit: item.yield_unit,
      sourceMetadata: item.source_metadata,
      position: item.position,
    })),
    members: (source.members ?? []).map((member) => ({
      childAssemblyId: member.child_assembly_id,
      quantity: member.quantity,
      position: member.position,
    })),
  });
}

export async function insertAssemblyIntoVersion(
  assemblyId: string,
  input: {
    versionId: string;
    afterItemId?: string | null;
  }
): Promise<EstimateItem[]> {
  const params = new URLSearchParams();
  params.set("versionId", input.versionId);

  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}/insert?${params.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        afterItemId: input.afterItemId ?? null,
      }),
    },
    "Impossible d'insérer l'ouvrage.",
    undefined,
    { mutation: { versionId: input.versionId, structural: true, requireAssemblyTotals: true } }
  );

  return parseEstimateItems(payload);
}

export { EstimateApiError } from "@/lib/estimates/client-errors";
export { isEstimateApiError } from "@/lib/estimates/client-errors";
export { runEstimateEditorExternalMutation } from "@/lib/estimates/client-requests";
export { acquireEstimateDraftLock } from "@/lib/estimates/client-locks";
export { takeoverEstimateDraftLock } from "@/lib/estimates/client-locks";
export { renewEstimateDraftLock } from "@/lib/estimates/client-locks";
export { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
export { fetchEstimateItemsForVersion } from "@/lib/estimates/editor-read-client";
export { fetchEstimateEditorData } from "@/lib/estimates/editor-read-client";
export type { EstimateVersionToken } from "@/lib/estimates/client-version";
export type { BulkUpdateEstimateVersionPatch } from "@/lib/estimates/client-version";
export type { EstimateDraftLock } from "@/lib/estimates/client-locks";
export type { AcquireEstimateDraftLockResult } from "@/lib/estimates/client-locks";
export type { RenewEstimateDraftLockResult } from "@/lib/estimates/client-locks";
export type { ReleaseEstimateDraftLockOptions } from "@/lib/estimates/client-locks";
export type { ReleaseEstimateDraftLockResult } from "@/lib/estimates/client-locks";
export type { EstimatePurchaseOrderDraftBlockedReason } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftAlternative } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftLine } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftGroup } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftBlockedLine } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftPreparation } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderStatus } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderTransferredLine } from "@/lib/estimates/purchase-order-draft-contracts";
export type { CreateEstimatePurchaseOrderDraftGroupInput } from "@/lib/estimates/purchase-order-draft-contracts";
export type { CreateEstimatePurchaseOrderDraftsInput } from "@/lib/estimates/purchase-order-draft-contracts";
export type { EstimatePurchaseOrderDraftCreationResult } from "@/lib/estimates/purchase-order-draft-contracts";
