import type { Database } from "@/types/database";
import {
  isEstimateApprovalDecisionFilter,
  type EstimateApprovalDecisionComment,
  type EstimateApprovalDecisionEvent,
  type EstimateApprovalDecisionFilter,
  type EstimateApprovalDecisionJournal,
  type EstimateApprovalDecisionRule,
  type EstimateApprovalDecisionScope,
} from "@/lib/estimates/approval-decision-journal";
import type {
  EstimateOutlierFlagKey,
  EstimateOutlierFlagsByItemId,
} from "@/lib/estimates/outlier-detection";
import type { MoveEstimateItemInput } from "@/lib/estimates/schemas";
import type { EstimateLineTruth } from "@/lib/estimates/line-truth";

type EstimateProjectRow =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"] & {
  source_provider?: string | null;
  source_job_id?: string | null;
  source_file_name?: string | null;
  source_page?: number | null;
  source_level?: string | null;
  source_version_number?: number | null;
  source_extracted_at?: string | null;
  source_metadata?: unknown;
  line_truth?: EstimateLineTruth | null;
};
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

export type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
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

const ESTIMATE_STATUS_VALUES: EstimateStatus[] = [
  "draft",
  "sent",
  "accepted",
  "archived",
];
const ESTIMATE_CURRENCY_VALUES = ["EUR", "USD", "GBP"] as const;

type JsonRecord = Record<string, unknown>;
type VersionZeroDraftCounts = NonNullable<
  VersionZeroDraftSummary["activeDraft"]
>["counts"];

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: {
    message?: string;
    code?: string;
    details?: unknown;
  };
};

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

export type DuplicateEstimateSectionResult = {
  duplicatedSectionId: string;
  sourceVersionId: string;
  targetVersionId: string;
  copiedItemCount: number;
  versionToken: EstimateVersionToken | null;
};

export type EstimateImportSourceVersion = {
  id: string;
  projectId: string;
  projectName: string;
  versionNumber: number;
  status: EstimateStatus;
  title: string | null;
  updatedAt: string;
  totalHtCents: number;
};

export type EstimateImportSectionPreview = {
  id: string;
  title: string;
  lineCount: number;
  totalHtCents: number;
  position: number;
};

export type ImportEstimateSectionsMode = "merge" | "append";

export type ImportEstimateSectionsPayload = {
  sourceVersionId: string;
  sectionIds: string[];
  mode: ImportEstimateSectionsMode;
};

export type ImportEstimateSectionsResult = {
  sourceVersionId: string;
  targetVersionId: string;
  mode: ImportEstimateSectionsMode;
  importedSectionsCount: number;
  importedLinesCount: number;
  createdSectionIds: string[];
  createdLineIds: string[];
  versionToken: EstimateVersionToken | null;
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

export type AffaireLinkedDpgfSource = {
  importId: string;
  filename: string;
  sourceFormat: string;
  importStatus: string;
  mappingStatus: string | null;
  importedAt: string;
  mappingUpdatedAt: string | null;
  parseMode: string;
  rowCount: number;
  mappedRowCount: number;
} | null;

export type ImportLinkedDpgfSourcePayload = {
  sectionTitle?: string | null;
};

export type ImportLinkedDpgfSourceResult = {
  sourceImportId: string;
  targetVersionId: string;
  createdSectionId: string;
  createdLineIds: string[];
  importedLinesCount: number;
  skippedLinesCount: number;
  totals: {
    totalHtCents: number;
    totalTaxCents: number;
    totalTtcCents: number;
  };
  versionToken: EstimateVersionToken | null;
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
};

export type EstimateAssemblyDetail = EstimateAssemblySummary & {
  items: EstimateAssemblyItem[];
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

export type VersionZeroDraftSummary = {
  versionId: string;
  projectId: string;
  hasConfirmedBrief: boolean;
  confirmedBriefId: string | null;
  isVersionEmpty: boolean;
  canGenerate: boolean;
  availableLots: string[];
  activeDraft: {
    id: string;
    status: VersionZeroDraftStatus;
    createdAt: string;
    materializedAt: string | null;
    selectedLots: string[];
    counts: {
      lots: number;
      lines: number;
      pending: number;
      accepted: number;
      edited: number;
      rejected: number;
      missingLots: number;
      partialLots: number;
      lowConfidenceLines: number;
    };
    summaryText: string | null;
    state: "active" | "terminal";
  } | null;
};

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

export type EstimateEditorData = {
  version: EstimateVersionWithProject;
  items: EstimateItem[];
  categories: EstimateCategory[];
  supplyTypes: SupplyType[];
  laborRoles: LaborRole[];
  marginTiers: MarginTier[];
  suggestionRules: SuggestionRule[];
  versionZeroSummary: VersionZeroDraftSummary | null;
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
};

export type EstimateVersionToken = Pick<EstimateVersionRow, "id" | "updated_at">;

export type BulkUpdateEstimateItemsResult = {
  updatedCount: number;
  versionToken: EstimateVersionToken;
};

export type BulkUpdateEstimateVersionPatch = Pick<
  EstimateVersionRow,
  "total_ht_cents" | "total_tax_cents" | "total_ttc_cents"
>;

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

export type EstimateBatchOperationResult =
  | {
      index: number;
      op: EstimateBatchOperation["op"];
      status: "ok";
      data?: unknown;
    }
  | {
      index: number;
      op: EstimateBatchOperation["op"];
      status: "error";
      code: string;
      message: string;
      details?: unknown;
    };

export type EstimateBatchResult = {
  committed: boolean;
  results: EstimateBatchOperationResult[];
  versionToken: EstimateVersionToken;
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

export type EstimatePurchaseOrderDraftBlockedReason =
  | "selection_missing"
  | "stale"
  | "ambiguous"
  | "no_price"
  | "missing_quantity"
  | "non_integer_quantity"
  | "missing_unit_price";

export type EstimatePurchaseOrderDraftAlternative = {
  supplierPriceId: string;
  supplierId: string | null;
  supplierName: string | null;
  adjustedUnitPriceCents: number | null;
  supplierReference: string | null;
  productDesignation: string | null;
  isStale: boolean | null;
  isSelected: boolean | null;
};

export type EstimatePurchaseOrderDraftLine = {
  itemId: string;
  itemTitle: string;
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
  selectedSupplierPriceId: string;
  supplierReference: string | null;
  productDesignation: string;
};

export type EstimatePurchaseOrderDraftGroup = {
  groupKey: string;
  supplierId: string;
  supplierName: string;
  lineCount: number;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
  lines: EstimatePurchaseOrderDraftLine[];
};

export type EstimatePurchaseOrderDraftBlockedLine = {
  itemId: string;
  itemTitle: string;
  quantity: number | null;
  unitPriceHtCents: number | null;
  taxRateBp: number | null;
  selectedSupplierPriceId: string | null;
  reason: EstimatePurchaseOrderDraftBlockedReason;
  coverageStatus: string | null;
  riskFlags: string[];
  selectedAlternative: EstimatePurchaseOrderDraftAlternative | null;
  alternatives: EstimatePurchaseOrderDraftAlternative[];
};

export type EstimatePurchaseOrderDraftPreparation = {
  versionId: string;
  stalePriceDays: number;
  summary: {
    totalSupplierLines: number;
    draftableLines: number;
    blockedLines: number;
    supplierGroups: number;
    selectionMissingLines: number;
    staleLines: number;
    ambiguousLines: number;
    noPriceLines: number;
    missingQuantityLines: number;
    nonIntegerQuantityLines: number;
    missingUnitPriceLines: number;
  };
  groups: EstimatePurchaseOrderDraftGroup[];
  blockedLines: EstimatePurchaseOrderDraftBlockedLine[];
};

export type CreateEstimatePurchaseOrderDraftGroupInput = {
  supplierId: string;
  deliverySiteId: string;
  itemIds: string[];
  expectedDeliveryDate?: string | null;
  notes?: string | null;
};

export type CreateEstimatePurchaseOrderDraftsInput = {
  groups: CreateEstimatePurchaseOrderDraftGroupInput[];
};

export type EstimatePurchaseOrderDraftCreationResult = {
  sourceVersionId: string;
  summary: {
    draftOrdersCreated: number;
    draftLinesCreated: number;
  };
  orders: Array<{
    purchaseOrderId: string;
    reference: string;
    supplierId: string;
    supplierName: string;
    deliverySiteId: string;
    itemCount: number;
    totalHtCents: number;
    totalTaxCents: number;
    totalTtcCents: number;
    orderedSourceItemIds: string[];
  }>;
};

export type EstimateDraftLock = {
  versionId: string;
  userId: string | null;
  holderName: string | null;
  lockedAt: string | null;
  expiresAt: string | null;
  isOwnedByCurrentUser: boolean | null;
};

export type EstimateVersionEvent = {
  id: string;
  estimateVersionId: string;
  eventType: EstimateVersionEventType | string;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  actorName: string | null;
  occurredAt: string;
  createdAt: string;
};

export type AcquireEstimateDraftLockResult = {
  acquired: boolean;
  lock: EstimateDraftLock | null;
};

export type RenewEstimateDraftLockResult = {
  renewed: boolean;
  lock: EstimateDraftLock | null;
};

export type ReleaseEstimateDraftLockOptions = {
  force?: boolean;
  keepalive?: boolean;
};

export type ReleaseEstimateDraftLockResult = {
  released: boolean;
};

export type ToggleEstimateOutlierDismissPayload = {
  itemId: string;
  flagKey: EstimateOutlierFlagKey;
  dismissed: boolean;
};

export class EstimateApiError extends Error {
  readonly status: number;
  readonly details: unknown;
  readonly code: string | null;

  constructor(
    message: string,
    status: number,
    details: unknown,
    code: string | null
  ) {
    super(message);
    this.name = "EstimateApiError";
    this.status = status;
    this.details = details;
    this.code = code;
  }
}

export function isEstimateApiError(error: unknown): error is EstimateApiError {
  return error instanceof EstimateApiError;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toStringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

const SUGGESTION_LEARNING_FIELDS: SuggestionLearningFieldName[] = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
  "labor_role_id",
  "supply_type_id",
];

function hasOwnProperty(record: JsonRecord, key: string) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

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

function isEstimateStatus(value: string): value is EstimateStatus {
  return ESTIMATE_STATUS_VALUES.includes(value as EstimateStatus);
}

function normalizeEstimateCurrency(value: unknown): string | null {
  const parsed = toStringValue(value);
  if (!parsed) return null;

  const normalized = parsed.toUpperCase();
  if ((ESTIMATE_CURRENCY_VALUES as readonly string[]).includes(normalized)) {
    return normalized;
  }

  return null;
}

function getRootPayload(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;
  if (payload.data !== undefined) return payload.data;
  return payload;
}

function extractEntity(payload: unknown, keys: string[]): JsonRecord | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }

  if (typeof root.id === "string") {
    return root;
  }

  return null;
}

function extractString(payload: unknown, keys: string[]): string | null {
  const root = getRootPayload(payload);

  if (typeof root === "string") {
    const trimmed = root.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    const parsed = toStringValue(value);
    if (parsed) return parsed;
  }

  return null;
}

function extractBoolean(payload: unknown, keys: string[]): boolean | null {
  const root = getRootPayload(payload);

  if (!isRecord(root)) return null;

  for (const key of keys) {
    const value = root[key];
    const parsed = toBooleanValue(value);
    if (parsed !== null) return parsed;
  }

  return null;
}

function pickRecord(root: JsonRecord, keys: string[]): JsonRecord | null {
  for (const key of keys) {
    const value = root[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
      return value[0] as JsonRecord;
    }
  }
  return null;
}

function toErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.length > 0) return trimmed;
  }

  if (!isRecord(payload)) return fallback;

  const envelope = payload as ApiEnvelope<unknown>;
  const candidates = [
    envelope.error?.message,
    envelope.error?.code,
    payload.message,
    payload.error,
    payload.details,
  ];

  for (const candidate of candidates) {
    const parsed = toStringValue(candidate);
    if (parsed) return parsed;
  }

  return fallback;
}

function extractErrorDetails(payload: unknown): unknown {
  if (!isRecord(payload)) return payload;

  const envelope = payload as ApiEnvelope<unknown>;

  if (envelope.error?.details !== undefined) {
    return envelope.error.details;
  }

  if (payload.details !== undefined) {
    return payload.details;
  }

  return payload;
}

function extractErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;

  const envelope = payload as ApiEnvelope<unknown>;
  return (
    toStringValue(envelope.error?.code) ??
    toStringValue(payload.code) ??
    null
  );
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

function isEstimatePurchaseOrderDraftBlockedReason(
  value: string
): value is EstimatePurchaseOrderDraftBlockedReason {
  return (
    value === "selection_missing" ||
    value === "stale" ||
    value === "ambiguous" ||
    value === "no_price" ||
    value === "missing_quantity" ||
    value === "non_integer_quantity" ||
    value === "missing_unit_price"
  );
}

function parseEstimatePurchaseOrderDraftAlternative(
  value: unknown
): EstimatePurchaseOrderDraftAlternative | null {
  if (!isRecord(value)) return null;

  const supplierPriceId =
    toStringValue(value.supplier_price_id) ??
    toStringValue(value.supplierPriceId);
  if (!supplierPriceId) {
    return null;
  }

  return {
    supplierPriceId,
    supplierId:
      toStringValue(value.supplier_id) ??
      toStringValue(value.supplierId) ??
      null,
    supplierName:
      toStringValue(value.supplier_name) ??
      toStringValue(value.supplierName) ??
      null,
    adjustedUnitPriceCents:
      toNumber(value.adjusted_unit_price_cents) ??
      toNumber(value.adjustedUnitPriceCents) ??
      null,
    supplierReference:
      toStringValue(value.supplier_reference) ??
      toStringValue(value.supplierReference) ??
      null,
    productDesignation:
      toStringValue(value.product_designation) ??
      toStringValue(value.productDesignation) ??
      null,
    isStale: toBooleanValue(value.is_stale) ?? toBooleanValue(value.isStale) ?? null,
    isSelected:
      toBooleanValue(value.is_selected) ?? toBooleanValue(value.isSelected) ?? null,
  };
}

function parseEstimatePurchaseOrderDraftLine(
  value: unknown
): EstimatePurchaseOrderDraftLine | null {
  if (!isRecord(value)) return null;

  const itemId = toStringValue(value.item_id) ?? toStringValue(value.itemId);
  const itemTitle = toStringValue(value.item_title) ?? toStringValue(value.itemTitle);
  const quantity = toNumber(value.quantity);
  const unitPriceHtCents =
    toNumber(value.unit_price_ht_cents) ?? toNumber(value.unitPriceHtCents);
  const taxRateBp = toNumber(value.tax_rate_bp) ?? toNumber(value.taxRateBp);
  const lineTotalHtCents =
    toNumber(value.line_total_ht_cents) ?? toNumber(value.lineTotalHtCents);
  const lineTaxCents =
    toNumber(value.line_tax_cents) ?? toNumber(value.lineTaxCents);
  const lineTotalTtcCents =
    toNumber(value.line_total_ttc_cents) ?? toNumber(value.lineTotalTtcCents);
  const selectedSupplierPriceId =
    toStringValue(value.selected_supplier_price_id) ??
    toStringValue(value.selectedSupplierPriceId);
  const productDesignation =
    toStringValue(value.product_designation) ??
    toStringValue(value.productDesignation);

  if (
    !itemId ||
    !itemTitle ||
    quantity === null ||
    unitPriceHtCents === null ||
    taxRateBp === null ||
    lineTotalHtCents === null ||
    lineTaxCents === null ||
    lineTotalTtcCents === null ||
    !selectedSupplierPriceId ||
    !productDesignation
  ) {
    return null;
  }

  return {
    itemId,
    itemTitle,
    quantity,
    unitPriceHtCents,
    taxRateBp,
    lineTotalHtCents,
    lineTaxCents,
    lineTotalTtcCents,
    selectedSupplierPriceId,
    supplierReference:
      toStringValue(value.supplier_reference) ??
      toStringValue(value.supplierReference) ??
      null,
    productDesignation,
  };
}

function parseEstimatePurchaseOrderDraftGroup(
  value: unknown
): EstimatePurchaseOrderDraftGroup | null {
  if (!isRecord(value)) return null;

  const groupKey = toStringValue(value.group_key) ?? toStringValue(value.groupKey);
  const supplierId =
    toStringValue(value.supplier_id) ?? toStringValue(value.supplierId);
  const supplierName =
    toStringValue(value.supplier_name) ?? toStringValue(value.supplierName);
  const lineCount = toNumber(value.line_count) ?? toNumber(value.lineCount);
  const totalHtCents =
    toNumber(value.total_ht_cents) ?? toNumber(value.totalHtCents);
  const totalTaxCents =
    toNumber(value.total_tax_cents) ?? toNumber(value.totalTaxCents);
  const totalTtcCents =
    toNumber(value.total_ttc_cents) ?? toNumber(value.totalTtcCents);

  if (
    !groupKey ||
    !supplierId ||
    !supplierName ||
    lineCount === null ||
    totalHtCents === null ||
    totalTaxCents === null ||
    totalTtcCents === null
  ) {
    return null;
  }

  return {
    groupKey,
    supplierId,
    supplierName,
    lineCount,
    totalHtCents,
    totalTaxCents,
    totalTtcCents,
    lines: pickArray(value, ["lines"])
      .map((entry) => parseEstimatePurchaseOrderDraftLine(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftLine => entry !== null),
  };
}

function parseEstimatePurchaseOrderDraftBlockedLine(
  value: unknown
): EstimatePurchaseOrderDraftBlockedLine | null {
  if (!isRecord(value)) return null;

  const itemId = toStringValue(value.item_id) ?? toStringValue(value.itemId);
  const itemTitle = toStringValue(value.item_title) ?? toStringValue(value.itemTitle);
  const reasonRaw = toStringValue(value.reason);

  if (!itemId || !itemTitle || !reasonRaw || !isEstimatePurchaseOrderDraftBlockedReason(reasonRaw)) {
    return null;
  }

  return {
    itemId,
    itemTitle,
    quantity: toNumber(value.quantity),
    unitPriceHtCents:
      toNumber(value.unit_price_ht_cents) ?? toNumber(value.unitPriceHtCents),
    taxRateBp: toNumber(value.tax_rate_bp) ?? toNumber(value.taxRateBp),
    selectedSupplierPriceId:
      toStringValue(value.selected_supplier_price_id) ??
      toStringValue(value.selectedSupplierPriceId) ??
      null,
    reason: reasonRaw,
    coverageStatus:
      toStringValue(value.coverage_status) ??
      toStringValue(value.coverageStatus) ??
      null,
    riskFlags: pickArray(value, ["risk_flags", "riskFlags"])
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null),
    selectedAlternative: parseEstimatePurchaseOrderDraftAlternative(
      value.selected_alternative ?? value.selectedAlternative
    ),
    alternatives: pickArray(value, ["alternatives"])
      .map((entry) => parseEstimatePurchaseOrderDraftAlternative(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftAlternative => entry !== null),
  };
}

function parseEstimatePurchaseOrderDraftPreparation(
  payload: unknown
): EstimatePurchaseOrderDraftPreparation | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const versionId = toStringValue(root.version_id) ?? toStringValue(root.versionId);
  const stalePriceDays =
    toNumber(root.stale_price_days) ?? toNumber(root.stalePriceDays);
  const summary = pickRecord(root, ["summary"]);

  if (!versionId || stalePriceDays === null || !summary) {
    return null;
  }

  const totalSupplierLines =
    toNumber(summary.total_supplier_lines) ?? toNumber(summary.totalSupplierLines);
  const draftableLines =
    toNumber(summary.draftable_lines) ?? toNumber(summary.draftableLines);
  const blockedLines =
    toNumber(summary.blocked_lines) ?? toNumber(summary.blockedLines);
  const supplierGroups =
    toNumber(summary.supplier_groups) ?? toNumber(summary.supplierGroups);
  const selectionMissingLines =
    toNumber(summary.selection_missing_lines) ??
    toNumber(summary.selectionMissingLines);
  const staleLines = toNumber(summary.stale_lines) ?? toNumber(summary.staleLines);
  const ambiguousLines =
    toNumber(summary.ambiguous_lines) ?? toNumber(summary.ambiguousLines);
  const noPriceLines =
    toNumber(summary.no_price_lines) ?? toNumber(summary.noPriceLines);
  const missingQuantityLines =
    toNumber(summary.missing_quantity_lines) ??
    toNumber(summary.missingQuantityLines);
  const nonIntegerQuantityLines =
    toNumber(summary.non_integer_quantity_lines) ??
    toNumber(summary.nonIntegerQuantityLines);
  const missingUnitPriceLines =
    toNumber(summary.missing_unit_price_lines) ??
    toNumber(summary.missingUnitPriceLines);

  if (
    totalSupplierLines === null ||
    draftableLines === null ||
    blockedLines === null ||
    supplierGroups === null ||
    selectionMissingLines === null ||
    staleLines === null ||
    ambiguousLines === null ||
    noPriceLines === null ||
    missingQuantityLines === null ||
    nonIntegerQuantityLines === null ||
    missingUnitPriceLines === null
  ) {
    return null;
  }

  return {
    versionId,
    stalePriceDays,
    summary: {
      totalSupplierLines,
      draftableLines,
      blockedLines,
      supplierGroups,
      selectionMissingLines,
      staleLines,
      ambiguousLines,
      noPriceLines,
      missingQuantityLines,
      nonIntegerQuantityLines,
      missingUnitPriceLines,
    },
    groups: pickArray(root, ["groups"])
      .map((entry) => parseEstimatePurchaseOrderDraftGroup(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftGroup => entry !== null),
    blockedLines: pickArray(root, ["blocked_lines", "blockedLines"])
      .map((entry) => parseEstimatePurchaseOrderDraftBlockedLine(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftBlockedLine => entry !== null),
  };
}

function parseEstimatePurchaseOrderDraftCreationResult(
  payload: unknown
): EstimatePurchaseOrderDraftCreationResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const sourceVersionId =
    toStringValue(root.source_version_id) ?? toStringValue(root.sourceVersionId);
  const summary = pickRecord(root, ["summary"]);

  if (!sourceVersionId || !summary) {
    return null;
  }

  const draftOrdersCreated =
    toNumber(summary.draft_orders_created) ??
    toNumber(summary.draftOrdersCreated);
  const draftLinesCreated =
    toNumber(summary.draft_lines_created) ??
    toNumber(summary.draftLinesCreated);

  if (draftOrdersCreated === null || draftLinesCreated === null) {
    return null;
  }

  const orders = pickArray(root, ["orders"])
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const purchaseOrderId =
        toStringValue(entry.purchase_order_id) ??
        toStringValue(entry.purchaseOrderId);
      const reference = toStringValue(entry.reference);
      const supplierId =
        toStringValue(entry.supplier_id) ?? toStringValue(entry.supplierId);
      const supplierName =
        toStringValue(entry.supplier_name) ?? toStringValue(entry.supplierName);
      const deliverySiteId =
        toStringValue(entry.delivery_site_id) ??
        toStringValue(entry.deliverySiteId);
      const itemCount = toNumber(entry.item_count) ?? toNumber(entry.itemCount);
      const totalHtCents =
        toNumber(entry.total_ht_cents) ?? toNumber(entry.totalHtCents);
      const totalTaxCents =
        toNumber(entry.total_tax_cents) ?? toNumber(entry.totalTaxCents);
      const totalTtcCents =
        toNumber(entry.total_ttc_cents) ?? toNumber(entry.totalTtcCents);

      if (
        !purchaseOrderId ||
        !reference ||
        !supplierId ||
        !supplierName ||
        !deliverySiteId ||
        itemCount === null ||
        totalHtCents === null ||
        totalTaxCents === null ||
        totalTtcCents === null
      ) {
        return null;
      }

      return {
        purchaseOrderId,
        reference,
        supplierId,
        supplierName,
        deliverySiteId,
        itemCount,
        totalHtCents,
        totalTaxCents,
        totalTtcCents,
        orderedSourceItemIds: pickArray(entry, [
          "ordered_source_item_ids",
          "orderedSourceItemIds",
        ])
          .map((itemId) => toStringValue(itemId))
          .filter((itemId): itemId is string => itemId !== null),
      };
    })
    .filter(
      (
        entry
      ): entry is EstimatePurchaseOrderDraftCreationResult["orders"][number] =>
        entry !== null
    );

  return {
    sourceVersionId,
    summary: {
      draftOrdersCreated,
      draftLinesCreated,
    },
    orders,
  };
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function unwrapSuccessfulEnvelopePayload(
  payload: unknown,
  fallbackMessage: string
): unknown {
  if (!isRecord(payload)) return payload;

  const hasOk = hasOwnProperty(payload, "ok");
  const isOk = toBooleanValue(payload.ok);
  if (hasOk && isOk === false) {
    throw new EstimateApiError(
      toErrorMessage(payload, fallbackMessage),
      200,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  if (hasOwnProperty(payload, "data")) {
    return payload.data;
  }

  return payload;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  fallbackMessage: string
): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw new EstimateApiError(
      toErrorMessage(payload, fallbackMessage),
      response.status,
      extractErrorDetails(payload),
      extractErrorCode(payload)
    );
  }

  const root = unwrapSuccessfulEnvelopePayload(payload, fallbackMessage);
  return root as T;
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

function triggerDownload(blob: Blob, filename: string) {
  if (typeof document === "undefined") {
    return;
  }

  const downloadUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(downloadUrl);
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
    normalizeEstimateCurrency(value.currency) ??
    normalizeEstimateCurrency(value.currency_code) ??
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

function pickArray(root: unknown, keys: string[]): unknown[] {
  if (Array.isArray(root)) return root;
  if (!isRecord(root)) return [];

  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }

  return [];
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

function isImportEstimateSectionsMode(
  value: unknown
): value is ImportEstimateSectionsMode {
  return value === "merge" || value === "append";
}

function parseEstimateImportSourceVersion(
  value: unknown
): EstimateImportSourceVersion | null {
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

  const id = toStringValue(value.id);
  const projectId =
    toStringValue(value.projectId) ??
    toStringValue(value.project_id) ??
    (projectNode ? toStringValue(projectNode.id) : null);
  const projectName =
    toStringValue(value.projectName) ??
    toStringValue(value.project_name) ??
    (projectNode ? toStringValue(projectNode.name) : null);
  const versionNumber =
    toNumber(value.versionNumber) ?? toNumber(value.version_number);
  const statusValue = toStringValue(value.status);
  const updatedAt =
    toStringValue(value.updatedAt) ?? toStringValue(value.updated_at);
  const totalHtCents =
    toNumber(value.totalHtCents) ?? toNumber(value.total_ht_cents);

  if (
    !id ||
    !projectId ||
    !projectName ||
    versionNumber === null ||
    !statusValue ||
    !isEstimateStatus(statusValue) ||
    !updatedAt ||
    totalHtCents === null
  ) {
    return null;
  }

  return {
    id,
    projectId,
    projectName,
    versionNumber,
    status: statusValue,
    title: toStringValue(value.title),
    updatedAt,
    totalHtCents,
  };
}

function parseEstimateImportSourceVersions(
  payload: unknown
): EstimateImportSourceVersion[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "versions", "sources"]);

  return rows
    .map((entry) => parseEstimateImportSourceVersion(entry))
    .filter((entry): entry is EstimateImportSourceVersion => entry !== null)
    .sort((left, right) => {
      const updatedDiff =
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      if (updatedDiff !== 0) return updatedDiff;
      return right.versionNumber - left.versionNumber;
    });
}

function parseEstimateImportSectionPreview(
  value: unknown
): EstimateImportSectionPreview | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const title = toStringValue(value.title) ?? "Section sans titre";
  const lineCount =
    toNumber(value.lineCount) ?? toNumber(value.line_count) ?? 0;
  const totalHtCents =
    toNumber(value.totalHtCents) ?? toNumber(value.total_ht_cents) ?? 0;
  const position = toNumber(value.position) ?? 0;

  if (!id) return null;

  return {
    id,
    title,
    lineCount: Math.max(0, Math.trunc(lineCount)),
    totalHtCents: Math.max(0, Math.trunc(totalHtCents)),
    position: Math.max(0, Math.trunc(position)),
  };
}

function parseEstimateImportSectionPreviews(
  payload: unknown
): EstimateImportSectionPreview[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "sections"]);

  return rows
    .map((entry) => parseEstimateImportSectionPreview(entry))
    .filter((entry): entry is EstimateImportSectionPreview => entry !== null)
    .sort((left, right) => left.position - right.position);
}

function parseImportEstimateSectionsResult(
  payload: unknown
): ImportEstimateSectionsResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const sourceVersionId =
    toStringValue(root.sourceVersionId) ?? toStringValue(root.source_version_id);
  const targetVersionId =
    toStringValue(root.targetVersionId) ?? toStringValue(root.target_version_id);
  const modeValue = toStringValue(root.mode);
  const importedSectionsCount =
    toNumber(root.importedSectionsCount) ?? toNumber(root.imported_sections_count);
  const importedLinesCount =
    toNumber(root.importedLinesCount) ?? toNumber(root.imported_lines_count);

  const createdSectionIdsRaw =
    (Array.isArray(root.createdSectionIds) ? root.createdSectionIds : null) ??
    (Array.isArray(root.created_section_ids) ? root.created_section_ids : null) ??
    [];
  const createdLineIdsRaw =
    (Array.isArray(root.createdLineIds) ? root.createdLineIds : null) ??
    (Array.isArray(root.created_line_ids) ? root.created_line_ids : null) ??
    [];

  const createdSectionIds = createdSectionIdsRaw
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);
  const createdLineIds = createdLineIdsRaw
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);

  if (
    !sourceVersionId ||
    !targetVersionId ||
    importedSectionsCount === null ||
    importedLinesCount === null ||
    !modeValue ||
    !isImportEstimateSectionsMode(modeValue)
  ) {
    return null;
  }

  return {
    sourceVersionId,
    targetVersionId,
    mode: modeValue,
    importedSectionsCount: Math.max(0, Math.trunc(importedSectionsCount)),
    importedLinesCount: Math.max(0, Math.trunc(importedLinesCount)),
    createdSectionIds,
    createdLineIds,
    versionToken: parseVersionToken(root),
  };
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

function parseAffaireLinkedDpgfSource(payload: unknown): AffaireLinkedDpgfSource {
  const root = getRootPayload(payload);
  if (root === null) {
    return null;
  }

  if (!isRecord(root)) {
    return null;
  }

  const importId =
    toStringValue(root.importId) ?? toStringValue(root.import_id);
  const filename = toStringValue(root.filename);
  const sourceFormat =
    toStringValue(root.sourceFormat) ?? toStringValue(root.source_format);
  const importStatus =
    toStringValue(root.importStatus) ?? toStringValue(root.import_status);
  const importedAt =
    toStringValue(root.importedAt) ?? toStringValue(root.imported_at);
  const parseMode =
    toStringValue(root.parseMode) ?? toStringValue(root.parse_mode);
  const rowCount = toNumber(root.rowCount) ?? toNumber(root.row_count);
  const mappedRowCount =
    toNumber(root.mappedRowCount) ?? toNumber(root.mapped_row_count);

  if (
    !importId ||
    !filename ||
    !sourceFormat ||
    !importStatus ||
    !importedAt ||
    !parseMode ||
    rowCount === null ||
    mappedRowCount === null
  ) {
    return null;
  }

  return {
    importId,
    filename,
    sourceFormat,
    importStatus,
    mappingStatus:
      toStringValue(root.mappingStatus) ??
      toStringValue(root.mapping_status) ??
      null,
    importedAt,
    mappingUpdatedAt:
      toStringValue(root.mappingUpdatedAt) ??
      toStringValue(root.mapping_updated_at) ??
      null,
    parseMode,
    rowCount: Math.max(0, Math.trunc(rowCount)),
    mappedRowCount: Math.max(0, Math.trunc(mappedRowCount)),
  };
}

function parseImportLinkedDpgfSourceResult(
  payload: unknown
): ImportLinkedDpgfSourceResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const sourceImportId =
    toStringValue(root.sourceImportId) ?? toStringValue(root.source_import_id);
  const targetVersionId =
    toStringValue(root.targetVersionId) ?? toStringValue(root.target_version_id);
  const createdSectionId =
    toStringValue(root.createdSectionId) ?? toStringValue(root.created_section_id);
  const importedLinesCount =
    toNumber(root.importedLinesCount) ?? toNumber(root.imported_lines_count);
  const skippedLinesCount =
    toNumber(root.skippedLinesCount) ?? toNumber(root.skipped_lines_count) ?? 0;

  const createdLineIdsRaw =
    (Array.isArray(root.createdLineIds) ? root.createdLineIds : null) ??
    (Array.isArray(root.created_line_ids) ? root.created_line_ids : null) ??
    [];
  const createdLineIds = createdLineIdsRaw
    .map((entry) => toStringValue(entry))
    .filter((entry): entry is string => entry !== null);

  const totalsRecord = pickRecord(root, ["totals"]);
  const totalHtCents =
    toNumber(totalsRecord?.total_ht_cents) ??
    toNumber(totalsRecord?.totalHtCents);
  const totalTaxCents =
    toNumber(totalsRecord?.total_tax_cents) ??
    toNumber(totalsRecord?.totalTaxCents);
  const totalTtcCents =
    toNumber(totalsRecord?.total_ttc_cents) ??
    toNumber(totalsRecord?.totalTtcCents);

  if (
    !sourceImportId ||
    !targetVersionId ||
    !createdSectionId ||
    importedLinesCount === null ||
    totalHtCents === null ||
    totalTaxCents === null ||
    totalTtcCents === null
  ) {
    return null;
  }

  return {
    sourceImportId,
    targetVersionId,
    createdSectionId,
    createdLineIds,
    importedLinesCount: Math.max(0, Math.trunc(importedLinesCount)),
    skippedLinesCount: Math.max(0, Math.trunc(skippedLinesCount)),
    totals: {
      totalHtCents: Math.max(0, Math.trunc(totalHtCents)),
      totalTaxCents: Math.max(0, Math.trunc(totalTaxCents)),
      totalTtcCents: Math.max(0, Math.trunc(totalTtcCents)),
    },
    versionToken: parseVersionToken(root),
  };
}

function parseDuplicateEstimateSectionResult(
  payload: unknown
): DuplicateEstimateSectionResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const duplicatedSectionId =
    toStringValue(root.duplicated_section_id) ??
    toStringValue(root.duplicatedSectionId);
  const sourceVersionId =
    toStringValue(root.source_version_id) ?? toStringValue(root.sourceVersionId);
  const targetVersionId =
    toStringValue(root.target_version_id) ?? toStringValue(root.targetVersionId);
  const copiedItemCount =
    toNumber(root.copied_item_count) ?? toNumber(root.copiedItemCount);

  if (
    !duplicatedSectionId ||
    !sourceVersionId ||
    !targetVersionId ||
    copiedItemCount === null
  ) {
    return null;
  }

  const versionRecord = extractEntity(root, ["version", "version_token"]);
  const versionToken =
    versionRecord && toStringValue(versionRecord.id) && toStringValue(versionRecord.updated_at)
      ? {
          id: String(versionRecord.id),
          updated_at: String(versionRecord.updated_at),
        }
      : null;

  return {
    duplicatedSectionId,
    sourceVersionId,
    targetVersionId,
    copiedItemCount,
    versionToken,
  };
}

function parseEstimateEditorData(payload: unknown): EstimateEditorData {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger les donnees du chiffrage.");
  }

  const versionNode =
    (isRecord(root.version) ? root.version : null) ??
    (isRecord(root.estimateVersion) ? root.estimateVersion : null) ??
    (isRecord(root.estimate) ? root.estimate : null);

  if (!versionNode) {
    throw new Error("Version de chiffrage introuvable.");
  }

  const projectName =
    toStringValue(root.projectName) ??
    toStringValue(root.project_name) ??
    toStringValue(versionNode.projectName) ??
    toStringValue(versionNode.project_name);

  const estimateProjects =
    versionNode.estimate_projects ?? (projectName ? { name: projectName } : null);

  const version = {
    ...(versionNode as EstimateVersionRow),
    estimate_projects:
      (estimateProjects as EstimateVersionWithProject["estimate_projects"]) ?? null,
  } as EstimateVersionWithProject;

  const items = pickArray(root, ["items", "estimateItems", "estimate_items"]);
  const categories = pickArray(root, [
    "categories",
    "estimateCategories",
    "estimate_categories",
  ]);
  const supplyTypes = pickArray(root, [
    "supplyTypes",
    "supply_types",
    "supplyTypesList",
  ]);
  const laborRoles = pickArray(root, ["laborRoles", "labor_roles", "roles"]);
  const marginTiers = pickArray(root, ["marginTiers", "margin_tiers"]);
  const suggestionRules = pickArray(root, [
    "suggestionRules",
    "suggestion_rules",
    "rules",
  ]);
  const versionZeroSummary =
    (isRecord(root.version_zero_summary) ? root.version_zero_summary : null) ??
    (isRecord(root.versionZeroSummary) ? root.versionZeroSummary : null);

  return {
    version,
    items: items as EstimateItem[],
    categories: categories as EstimateCategory[],
    supplyTypes: supplyTypes as SupplyType[],
    laborRoles: laborRoles as LaborRole[],
    marginTiers: marginTiers as MarginTier[],
    suggestionRules: suggestionRules as SuggestionRule[],
    versionZeroSummary: (versionZeroSummary as VersionZeroDraftSummary | null) ?? null,
  };
}

function parseVersionZeroDraftSummary(payload: unknown): VersionZeroDraftSummary {
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    throw new Error("Impossible de charger le resume V0.");
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

function parseEstimateItems(payload: unknown): EstimateItem[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["items", "estimateItems", "estimate_items"]);
  return rows as EstimateItem[];
}

function normalizeEstimateVersionEvent(value: unknown): EstimateVersionEvent | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const estimateVersionId =
    toStringValue(value.estimateVersionId) ??
    toStringValue(value.estimate_version_id);
  const eventType =
    toStringValue(value.eventType) ??
    toStringValue(value.event_type);
  const occurredAt =
    toStringValue(value.occurredAt) ??
    toStringValue(value.occurred_at);
  const createdAt =
    toStringValue(value.createdAt) ??
    toStringValue(value.created_at);

  if (!id || !estimateVersionId || !eventType || !occurredAt || !createdAt) {
    return null;
  }

  return {
    id,
    estimateVersionId,
    eventType,
    metadata: isRecord(value.metadata) ? value.metadata : {},
    createdBy:
      toStringValue(value.createdBy) ??
      toStringValue(value.created_by) ??
      null,
    actorName:
      toStringValue(value.actorName) ??
      toStringValue(value.actor_name) ??
      null,
    occurredAt,
    createdAt,
  };
}

function parseEstimateVersionEvents(payload: unknown): EstimateVersionEvent[] {
  const root = getRootPayload(payload);
  const rows = pickArray(root, ["events", "items", "data"]);

  return rows
    .map((entry) => normalizeEstimateVersionEvent(entry))
    .filter((entry): entry is EstimateVersionEvent => entry !== null);
}

function normalizeApprovalDecisionScope(
  value: unknown
): EstimateApprovalDecisionScope | null {
  if (!isRecord(value)) return null;

  const scopeType = toStringValue(value.scopeType) ?? toStringValue(value.scope_type);
  const scopeLabel = toStringValue(value.scopeLabel) ?? toStringValue(value.scope_label);
  const scopeId = toStringValue(value.scopeId) ?? toStringValue(value.scope_id) ?? null;

  if (
    scopeType !== "project" &&
    scopeType !== "lot" &&
    scopeType !== "line" &&
    scopeType !== "exception" &&
    scopeType !== "hypothesis" &&
    scopeType !== "approval_rule"
  ) {
    return null;
  }

  if (!scopeLabel) {
    return null;
  }

  return {
    scopeType,
    scopeId,
    scopeLabel,
  };
}

function normalizeApprovalDecisionComment(
  value: unknown
): EstimateApprovalDecisionComment | null {
  if (!isRecord(value)) return null;

  const scope = normalizeApprovalDecisionScope(value);
  const comment = toStringValue(value.comment);
  if (!scope || !comment) {
    return null;
  }

  return {
    ...scope,
    comment,
  };
}

function normalizeApprovalDecisionRule(
  value: unknown
): EstimateApprovalDecisionRule | null {
  if (!isRecord(value)) return null;

  const ruleId = toStringValue(value.ruleId) ?? toStringValue(value.rule_id);
  const label = toStringValue(value.label);
  const signalKey = toStringValue(value.signalKey) ?? toStringValue(value.signal_key);
  const message = toStringValue(value.message);
  const thresholdValue = toNumber(value.thresholdValue) ?? toNumber(value.threshold_value);
  const actualValue = toNumber(value.actualValue) ?? toNumber(value.actual_value);
  const sourceState =
    toStringValue(value.sourceState) ?? toStringValue(value.source_state);
  const approvalStatus =
    toStringValue(value.approvalStatus) ?? toStringValue(value.approval_status);

  if (
    !ruleId ||
    !label ||
    !signalKey ||
    !message ||
    thresholdValue === null
  ) {
    return null;
  }

  return {
    ruleId,
    label,
    signalKey,
    message,
    thresholdValue,
    actualValue,
    sourceState: sourceState === "unavailable" ? "unavailable" : "ready",
    approvalStatus:
      approvalStatus === "missing" ||
      approvalStatus === "pending" ||
      approvalStatus === "approved" ||
      approvalStatus === "rejected"
        ? approvalStatus
        : null,
  };
}

function normalizeEstimateApprovalDecisionEvent(
  value: unknown
): EstimateApprovalDecisionEvent | null {
  if (!isRecord(value)) return null;

  const id = toStringValue(value.id);
  const estimateVersionId =
    toStringValue(value.estimateVersionId) ??
    toStringValue(value.estimate_version_id);
  const occurredAt =
    toStringValue(value.occurredAt) ??
    toStringValue(value.occurred_at);
  const createdAt =
    toStringValue(value.createdAt) ??
    toStringValue(value.created_at);
  const decisionRaw = toStringValue(value.decision);
  const approvalOutcome =
    toStringValue(value.approvalOutcome) ??
    toStringValue(value.approval_outcome);
  const commentCount = toNumber(value.commentCount) ?? toNumber(value.comment_count);
  const scopeCount = toNumber(value.scopeCount) ?? toNumber(value.scope_count);
  const perimeterLabel =
    toStringValue(value.perimeterLabel) ??
    toStringValue(value.perimeter_label);
  const scopes = pickArray(value, ["scopes"])
    .map((entry) => normalizeApprovalDecisionScope(entry))
    .filter((entry): entry is EstimateApprovalDecisionScope => entry !== null);
  const comments = pickArray(value, ["comments"])
    .map((entry) => normalizeApprovalDecisionComment(entry))
    .filter((entry): entry is EstimateApprovalDecisionComment => entry !== null);
  const rulesTriggered = pickArray(value, ["rulesTriggered", "rules_triggered"])
    .map((entry) => normalizeApprovalDecisionRule(entry))
    .filter((entry): entry is EstimateApprovalDecisionRule => entry !== null);

  if (
    !id ||
    !estimateVersionId ||
    !occurredAt ||
    !createdAt ||
    !decisionRaw ||
    !isEstimateApprovalDecisionFilter(decisionRaw) ||
    !perimeterLabel ||
    (approvalOutcome !== "approved" && approvalOutcome !== "rejected")
  ) {
    return null;
  }

  return {
    id,
    estimateVersionId,
    occurredAt,
    createdAt,
    actorUserId:
      toStringValue(value.actorUserId) ??
      toStringValue(value.actor_user_id) ??
      null,
    actorName:
      toStringValue(value.actorName) ??
      toStringValue(value.actor_name) ??
      null,
    decision: decisionRaw,
    approvalOutcome,
    cycleId:
      toStringValue(value.cycleId) ??
      toStringValue(value.cycle_id) ??
      null,
    cycleNumber:
      toNumber(value.cycleNumber) ?? toNumber(value.cycle_number) ?? null,
    commentCount: commentCount !== null ? Math.max(0, Math.trunc(commentCount)) : 0,
    scopeCount: scopeCount !== null ? Math.max(0, Math.trunc(scopeCount)) : 0,
    perimeterLabel,
    scopes,
    comments,
    rulesTriggered,
  };
}

function parseEstimateApprovalDecisionJournal(
  payload: unknown
): EstimateApprovalDecisionJournal | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const events = pickArray(root, ["events"])
    .map((entry) => normalizeEstimateApprovalDecisionEvent(entry))
    .filter((entry): entry is EstimateApprovalDecisionEvent => entry !== null);
  const availableAuthors = pickArray(root, ["availableAuthors", "available_authors"])
    .map((entry) => {
      if (!isRecord(entry)) return null;
      const userId = toStringValue(entry.userId) ?? toStringValue(entry.user_id);
      const actorName =
        toStringValue(entry.actorName) ?? toStringValue(entry.actor_name);
      if (!userId || !actorName) return null;
      return {
        userId,
        actorName,
      };
    })
    .filter(
      (entry): entry is EstimateApprovalDecisionJournal["availableAuthors"][number] =>
        entry !== null
    );
  const filtersNode = isRecord(root.filters) ? root.filters : {};
  const decisionRaw =
    toStringValue(filtersNode.decision) ?? toStringValue(filtersNode.status);
  const decision =
    decisionRaw && isEstimateApprovalDecisionFilter(decisionRaw)
      ? decisionRaw
      : null;

  return {
    events,
    availableAuthors,
    filters: {
      actorUserId:
        toStringValue(filtersNode.actorUserId) ??
        toStringValue(filtersNode.actor_user_id) ??
        null,
      decision,
    },
  };
}

function parseVersionToken(payload: unknown): EstimateVersionToken | null {
  const entity = extractEntity(payload, [
    "version",
    "estimateVersion",
    "version_token",
    "versionToken",
  ]);
  if (!entity) return null;

  const id = toStringValue(entity.id);
  const updatedAt =
    toStringValue(entity.updated_at) ?? toStringValue(entity.updatedAt);

  if (!id || !updatedAt) return null;

  return {
    id,
    updated_at: updatedAt,
  };
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
    throw new Error("Impossible de recuperer le template.");
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
    throw new Error("Impossible de recuperer l'ouvrage.");
  }

  const items = parseEstimateAssemblyItems(
    (assemblyEntity as JsonRecord | null)?.items ??
      (isRecord(root) ? root.items : null)
  );

  return {
    ...summary,
    items,
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

  return {
    projectId,
    versionId,
    redirectTo,
  };
}

function parseEstimateDraftLock(
  payload: unknown,
  fallbackVersionId?: string
): EstimateDraftLock | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const lockEntity =
    pickRecord(root, ["lock", "draft_lock", "draftLock"]) ??
    pickRecord(root, ["data"]) ??
    root;

  const holderEntity = pickRecord(lockEntity, [
    "holder",
    "owner",
    "profile",
    "profiles",
    "locked_by",
  ]);

  const versionId =
    toStringValue(lockEntity.version_id) ??
    toStringValue(lockEntity.versionId) ??
    toStringValue(root.version_id) ??
    toStringValue(root.versionId) ??
    fallbackVersionId ??
    null;

  if (!versionId) return null;

  const userId =
    toStringValue(lockEntity.user_id) ??
    toStringValue(lockEntity.userId) ??
    toStringValue(lockEntity.locked_by_user_id) ??
    (holderEntity
      ? toStringValue(holderEntity.user_id) ?? toStringValue(holderEntity.id)
      : null) ??
    null;

  const holderName =
    toStringValue(lockEntity.holder_name) ??
    toStringValue(lockEntity.holderName) ??
    toStringValue(lockEntity.locked_by_name) ??
    toStringValue(lockEntity.lockedByName) ??
    (holderEntity
      ? toStringValue(holderEntity.full_name) ??
        toStringValue(holderEntity.fullName) ??
        toStringValue(holderEntity.name)
      : null) ??
    null;

  const lockedAt =
    toStringValue(lockEntity.locked_at) ??
    toStringValue(lockEntity.lockedAt) ??
    null;

  const expiresAt =
    toStringValue(lockEntity.expires_at) ??
    toStringValue(lockEntity.expiresAt) ??
    null;

  const isOwnedByCurrentUser =
    toBooleanValue(lockEntity.is_current_user) ??
    toBooleanValue(lockEntity.isCurrentUser) ??
    toBooleanValue(lockEntity.is_owner) ??
    toBooleanValue(lockEntity.isOwnedByCurrentUser) ??
    toBooleanValue(lockEntity.owned_by_current_user) ??
    toBooleanValue(lockEntity.ownedByCurrentUser) ??
    toBooleanValue(root.is_owner) ??
    toBooleanValue(root.isOwnedByCurrentUser) ??
    toBooleanValue(root.owned_by_current_user) ??
    toBooleanValue(root.ownedByCurrentUser) ??
    null;

  return {
    versionId,
    userId,
    holderName,
    lockedAt,
    expiresAt,
    isOwnedByCurrentUser,
  };
}

function buildEstimateDraftLockPath(
  versionId: string,
  options?: { force?: boolean }
) {
  const query = new URLSearchParams();
  if (options?.force) {
    query.set("force", "1");
  }

  const basePath = `/api/estimates/${versionId}/lock`;
  const queryString = query.toString();
  if (!queryString) return basePath;
  return `${basePath}?${queryString}`;
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

  const payload = await requestJson<unknown>(
    path,
    {
      method: "GET",
    },
    "Impossible de charger les devis sources."
  );

  return parseEstimateImportSourceVersions(payload);
}

export async function fetchEstimateImportableSections(
  sourceVersionId: string
): Promise<EstimateImportSectionPreview[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${sourceVersionId}/sections`,
    {
      method: "GET",
    },
    "Impossible de charger les sections importables."
  );

  return parseEstimateImportSectionPreviews(payload);
}

export async function fetchAffaireLinkedDpgfSource(
  projectId: string
): Promise<AffaireLinkedDpgfSource> {
  const payload = await requestJson<unknown>(
    `/api/affaires/${projectId}/dpgf-source`,
    {
      method: "GET",
    },
    "Impossible de charger la source DPGF de l'affaire."
  );

  return parseAffaireLinkedDpgfSource(payload);
}

export async function importEstimateSections(
  targetVersionId: string,
  input: ImportEstimateSectionsPayload
): Promise<ImportEstimateSectionsResult> {
  const payload = await requestJson<unknown>(
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
    "Impossible d'importer les sections."
  );

  const parsed = parseImportEstimateSectionsResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le resultat de l'import.");
  }

  return parsed;
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
    "Impossible de generer la preview de structure."
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
    "Impossible d'appliquer la preview de structure."
  );

  const parsed = parseApplyEstimateStructureDraftResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le resultat d'application.");
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
    "Impossible de charger le resume de la V0."
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
    "Impossible de generer la V0."
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
    "Impossible de mettre a jour la ligne V0."
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
    "Impossible de materialiser la V0."
  );

  return parseVersionZeroReview(payload);
}

export async function importLinkedDpgfSource(
  targetVersionId: string,
  input: ImportLinkedDpgfSourcePayload = {}
): Promise<ImportLinkedDpgfSourceResult> {
  const payload = await requestJson<unknown>(
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
    "Impossible d'importer la source DPGF liee."
  );

  const parsed = parseImportLinkedDpgfSourceResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le resultat de l'import DPGF.");
  }

  return parsed;
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
      margin_multiplier: input.marginMultiplier ?? 1,
      ...(input.marginMode ? { margin_mode: input.marginMode } : {}),
      ...(input.marginBp != null ? { margin_bp: input.marginBp } : {}),
      ...(input.taxRateBp != null ? { tax_rate_bp: input.taxRateBp } : {}),
      ...(input.roundingMode ? { rounding_mode: input.roundingMode } : {}),
      ...(input.roundingStepCents != null
        ? { rounding_step_cents: input.roundingStepCents }
        : {}),
      ...(input.currency ? { currency: input.currency } : {}),
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

  const payload = await requestJson<unknown>(
    "/api/estimates",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    },
    "Impossible de creer le chiffrage."
  );

  const versionEntity = extractEntity(payload, ["version", "estimateVersion"]);
  if (versionEntity && typeof versionEntity.id === "string") {
    return versionEntity.id;
  }

  const versionId = extractString(payload, [
    "versionId",
    "version_id",
    "estimateVersionId",
    "id",
  ]);

  if (!versionId) {
    throw new Error("Impossible de creer le chiffrage.");
  }

  return versionId;
}

export async function duplicateEstimateVersion(
  versionId: string
): Promise<string> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/duplicate`,
    {
      method: "POST",
    },
    "Impossible de dupliquer le chiffrage."
  );

  const duplicatedVersionId = extractString(payload, [
    "versionId",
    "version_id",
    "duplicatedVersionId",
    "duplicated_version_id",
    "id",
  ]);

  if (!duplicatedVersionId) {
    throw new Error("Impossible de dupliquer le chiffrage.");
  }

  return duplicatedVersionId;
}

export async function duplicateEstimateSection(
  versionId: string,
  sectionId: string,
  options?: { targetVersionId?: string | null }
): Promise<DuplicateEstimateSectionResult> {
  const payload = await requestJson<unknown>(
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
    "Impossible de dupliquer la section."
  );

  const parsed = parseDuplicateEstimateSectionResult(payload);
  if (!parsed) {
    throw new Error("Impossible de dupliquer la section.");
  }

  return parsed;
}

export async function createEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/variants`,
    {
      method: "POST",
    },
    "Impossible de creer la variante."
  );

  const variantVersionId = extractString(payload, [
    "versionId",
    "version_id",
    "variantVersionId",
    "variant_version_id",
    "id",
  ]);

  if (!variantVersionId) {
    throw new Error("Impossible de creer la variante.");
  }

  return variantVersionId;
}

export async function promoteEstimateVariant(
  versionId: string
): Promise<string> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/variants`,
    {
      method: "PATCH",
    },
    "Impossible de promouvoir la variante."
  );

  const promotedEntity = extractEntity(payload, ["version", "estimateVersion"]);
  if (promotedEntity && typeof promotedEntity.id === "string") {
    return promotedEntity.id;
  }

  const promotedVersionId = extractString(payload, [
    "versionId",
    "version_id",
    "promotedVersionId",
    "promoted_version_id",
    "id",
  ]);

  if (!promotedVersionId) {
    throw new Error("Impossible de promouvoir la variante.");
  }

  return promotedVersionId;
}

export async function fetchEstimateEditorData(
  versionId: string
): Promise<EstimateEditorData> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}`,
    {
      method: "GET",
    },
    "Impossible de charger le chiffrage."
  );

  return parseEstimateEditorData(payload);
}

export async function fetchEstimateVersionEvents(
  versionId: string
): Promise<EstimateVersionEvent[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/events`,
    {
      method: "GET",
    },
    "Impossible de charger les evenements."
  );

  return parseEstimateVersionEvents(payload);
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
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/approval-journal${buildApprovalJournalQuery(filters)}`,
    {
      method: "GET",
    },
    "Impossible de charger le journal de decision."
  );

  const parsed = parseEstimateApprovalDecisionJournal(payload);
  if (!parsed) {
    throw new Error("Reponse journal d'approbation invalide.");
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
      toErrorMessage(payload, "Impossible d'exporter le journal de decision."),
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

  triggerDownload(blob, filename);

  return {
    filename,
    size: blob.size,
  };
}

export async function fetchEstimateItemsForVersion(
  versionId: string
): Promise<EstimateItem[]> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "GET",
    },
    "Impossible de charger les lignes."
  );

  return parseEstimateItems(payload);
}

export async function fetchEstimateOutlierDismissedFlags(
  versionId: string
): Promise<EstimateOutlierFlagsByItemId> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/outliers`,
    {
      method: "GET",
    },
    "Impossible de charger les outliers acceptes."
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
    "Impossible de mettre a jour le statut d'acceptation de l'outlier."
  );

  return normalizeOutlierDismissedByItemId(payload);
}

export async function saveEstimateVersion(
  versionId: string,
  updates: Database["public"]["Tables"]["estimate_versions"]["Update"],
  updatedAtToken: string
): Promise<EstimateVersionRow> {
  const payload = await requestJson<unknown>(
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
      }),
    },
    "Impossible de sauvegarder le chiffrage."
  );

  const entity = extractEntity(payload, ["version", "estimateVersion"]);
  if (!entity || !toStringValue(entity.updated_at)) {
    throw new Error("Impossible de recuperer la version mise a jour.");
  }

  return entity as EstimateVersionRow;
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

  const payload = await requestJson<unknown>(
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
    "Impossible de mettre a jour les lignes."
  );

  const versionToken = parseVersionToken(payload);
  if (!versionToken) {
    throw new Error("Impossible de recuperer le jeton de version.");
  }

  const root = getRootPayload(payload);
  const updatedCount =
    (isRecord(root) ? toNumber(root.updated_count) : null) ?? updates.length;

  return {
    updatedCount,
    versionToken,
  };
}

function toCreateEstimateItemBody(
  item: Database["public"]["Tables"]["estimate_items"]["Insert"]
) {
  const itemWithSource = item as typeof item & {
    h_mo_majoration?: number | null;
    supply_type_id?: string | null;
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
        parent_id: item.parent_id ?? null,
        position: item.position,
        title: item.title,
        aid: item.aid ?? null,
        description: item.description ?? null,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: itemWithSource.h_mo_majoration ?? null,
        k_mo: item.k_mo,
        labor_role_id: item.labor_role_id ?? null,
        category_id: item.category_id ?? null,
        supply_type_id: itemWithSource.supply_type_id ?? null,
        selected_supplier_price_id: itemWithSource.selected_supplier_price_id ?? null,
        source_provider: itemWithSource.source_provider ?? null,
        source_job_id: itemWithSource.source_job_id ?? null,
        source_file_name: itemWithSource.source_file_name ?? null,
        source_page: itemWithSource.source_page ?? null,
      };
}

export async function createEstimateItem(
  versionId: string,
  item: Database["public"]["Tables"]["estimate_items"]["Insert"]
): Promise<EstimateItem> {
  const body = toCreateEstimateItemBody(item);

  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/items`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible d'ajouter la ligne."
  );

  const entity = extractEntity(payload, ["item", "estimateItem"]);
  if (!entity) {
    throw new Error("Impossible d'ajouter la ligne.");
  }

  return entity as EstimateItem;
}

export async function updateEstimateItem(
  versionId: string,
  itemId: string,
  updates: Database["public"]["Tables"]["estimate_items"]["Update"]
): Promise<void> {
  await requestJson<unknown>(
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
    "Impossible de mettre a jour la ligne."
  );
}

export async function deleteEstimateItem(
  versionId: string,
  itemId: string
): Promise<void> {
  await requestJson<unknown>(
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
    "Impossible de supprimer la ligne."
  );
}

export async function reorderEstimateItems(
  versionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<void> {
  await requestJson<unknown>(
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
    "Impossible de reordonner les lignes."
  );
}

export async function moveEstimateItem(
  versionId: string,
  payload: MoveEstimateItemInput
): Promise<void> {
  await requestJson<unknown>(
    `/api/estimates/${versionId}/items/move`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Impossible de deplacer l'element."
  );
}

function isEstimateBatchOp(value: string): value is EstimateBatchOperation["op"] {
  return (
    value === "create" ||
    value === "update" ||
    value === "delete" ||
    value === "reorder"
  );
}

function parseEstimateBatchOperationResult(
  value: unknown
): EstimateBatchOperationResult | null {
  if (!isRecord(value)) return null;

  const index = toNumber(value.index);
  const opValue = toStringValue(value.op);
  const statusValue = toStringValue(value.status);

  if (
    index === null ||
    !opValue ||
    !statusValue ||
    !isEstimateBatchOp(opValue) ||
    (statusValue !== "ok" && statusValue !== "error")
  ) {
    return null;
  }

  if (statusValue === "ok") {
    return {
      index,
      op: opValue,
      status: "ok",
      data: value.data,
    };
  }

  return {
    index,
    op: opValue,
    status: "error",
    code: toStringValue(value.code) ?? "INTERNAL_ERROR",
    message: toStringValue(value.message) ?? "Une operation batch a echoue.",
    details: value.details,
  };
}

function parseEstimateBatchResult(payload: unknown): {
  committed: boolean;
  results: EstimateBatchOperationResult[];
  versionToken: EstimateVersionToken | null;
} | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const committed = toBooleanValue(root.committed);
  if (committed === null) return null;

  const results = pickArray(root, ["results"])
    .map((entry) => parseEstimateBatchOperationResult(entry))
    .filter(
      (entry): entry is EstimateBatchOperationResult => entry !== null
    );

  return {
    committed,
    results,
    versionToken: parseVersionToken(root),
  };
}

export async function batchEstimateOperations(
  versionId: string,
  updatedAtToken: string,
  operations: EstimateBatchOperation[],
  options: {
    dryRun?: boolean;
  } = {}
): Promise<EstimateBatchResult> {
  const queryParams = new URLSearchParams();
  if (typeof options.dryRun === "boolean") {
    queryParams.set("dry_run", options.dryRun ? "true" : "false");
  }
  const query = queryParams.toString();
  const path = `/api/estimates/${versionId}/batch${query.length > 0 ? `?${query}` : ""}`;

  const payload = await requestJson<unknown>(
    path,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        concurrency_token: updatedAtToken,
        dry_run: options.dryRun,
        operations: operations.map((operation) => {
          if (operation.op === "create") {
            return {
              op: "create",
              data: toCreateEstimateItemBody(operation.data),
            };
          }

          if (operation.op === "update") {
            return {
              op: "update",
              id: operation.id,
              data: operation.data,
            };
          }

          if (operation.op === "delete") {
            return {
              op: "delete",
              id: operation.id,
            };
          }

          return {
            op: "reorder",
            data: {
              parent_id: operation.data.parent_id ?? null,
              ordered_ids: operation.data.ordered_ids,
            },
          };
        }),
      }),
    },
    "Impossible d'executer les operations groupees."
  );

  const parsed = parseEstimateBatchResult(payload);
  if (!parsed) {
    throw new Error("Impossible de recuperer le resultat des operations groupees.");
  }

  return {
    committed: parsed.committed,
    results: parsed.results,
    versionToken: parsed.versionToken ?? {
      id: versionId,
      updated_at: updatedAtToken,
    },
  };
}

export async function exportEstimate(
  versionId: string,
  format: "xlsx" = "xlsx",
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

  triggerDownload(blob, filename);

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
  const payload = await requestJson<unknown>(
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
    "Impossible de mettre a jour le statut."
  );

  const entity = extractEntity(payload, ["version", "estimateVersion"]);
  if (!entity || !toStringValue(entity.updated_at)) {
    throw new Error("Impossible de recuperer la version mise a jour.");
  }

  return entity as EstimateVersionRow;
}

export async function fetchEstimateSendGating(
  versionId: string
): Promise<EstimateSendGatingResponse> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/gating`,
    {
      method: "GET",
    },
    "Impossible de verifier les preconditions d'envoi."
  );

  const root = getRootPayload(payload);
  const parsed = parseEstimateSendGatingResponse(
    isRecord(root) && root.gating !== undefined ? root.gating : root
  );

  if (!parsed) {
    throw new Error("Impossible de lire les preconditions d'envoi.");
  }

  return parsed;
}

export async function requestEstimatePdfGeneration(
  versionId: string,
  options: { force?: boolean } = {}
): Promise<EstimatePdfStatusResponse> {
  const query = new URLSearchParams();
  if (options.force) {
    query.set("force", "1");
  }

  const path = query.size > 0
    ? `/api/estimates/${versionId}/pdf?${query.toString()}`
    : `/api/estimates/${versionId}/pdf`;

  const payload = await requestJson<unknown>(
    path,
    {
      method: "POST",
    },
    "Impossible de lancer la generation du PDF."
  );

  const parsed = parseEstimatePdfStatus(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le statut de generation du PDF.");
  }

  return parsed;
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
      "Impossible de recuperer le statut du PDF."
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
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    {
      method: "GET",
    },
    "Impossible de preparer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftPreparation(payload);
  if (!parsed) {
    throw new Error("Impossible de lire la preparation des brouillons de commandes.");
  }

  return parsed;
}

export async function createEstimatePurchaseOrderDrafts(
  versionId: string,
  input: CreateEstimatePurchaseOrderDraftsInput
): Promise<EstimatePurchaseOrderDraftCreationResult> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/purchase-order-drafts`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        groups: input.groups.map((group) => ({
          supplier_id: group.supplierId,
          delivery_site_id: group.deliverySiteId,
          item_ids: group.itemIds,
          expected_delivery_date: group.expectedDeliveryDate ?? null,
          notes: group.notes ?? null,
        })),
      }),
    },
    "Impossible de creer les brouillons de commandes."
  );

  const parsed = parseEstimatePurchaseOrderDraftCreationResult(payload);
  if (!parsed) {
    throw new Error("Impossible de lire le resultat de creation des brouillons.");
  }

  return parsed;
}

export async function acquireEstimateDraftLock(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "POST",
      },
      "Impossible d'acquerir le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const acquired =
      extractBoolean(payload, ["acquired", "is_acquired"]) ??
      lock?.isOwnedByCurrentUser ??
      true;

    return {
      acquired,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        acquired: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function renewEstimateDraftLock(
  versionId: string
): Promise<RenewEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "PATCH",
      },
      "Impossible de renouveler le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const renewed =
      extractBoolean(payload, ["renewed", "is_renewed"]) ??
      lock?.isOwnedByCurrentUser ??
      true;

    return {
      renewed,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        renewed: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function releaseEstimateDraftLock(
  versionId: string,
  options: ReleaseEstimateDraftLockOptions = {}
): Promise<ReleaseEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId, { force: options.force }),
      {
        method: "DELETE",
        keepalive: options.keepalive,
      },
      options.force
        ? "Impossible de forcer le deverrouillage."
        : "Impossible de liberer le verrou de brouillon."
    );

    const released =
      extractBoolean(payload, ["released", "ok", "success"]) ?? true;

    return {
      released,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 404) {
      return {
        released: true,
      };
    }
    throw error;
  }
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
    "Impossible de creer la categorie."
  );

  const entity = extractEntity(payload, ["category", "item"]);
  if (!entity) {
    throw new Error("Impossible de creer la categorie.");
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
    "Impossible de creer le role."
  );

  const entity = extractEntity(payload, ["labor_role", "laborRole", "role"]);
  if (!entity) {
    throw new Error("Impossible de creer le role.");
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
    "Impossible de mettre a jour le role."
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
    "Impossible de creer la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de creer la tranche de marge.");
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
    "Impossible de mettre a jour la tranche de marge."
  );

  const entity = extractEntity(payload, ["margin_tier", "marginTier"]);
  if (!entity) {
    throw new Error("Impossible de mettre a jour la tranche de marge.");
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
    "Impossible de creer la regle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  if (!entity) {
    throw new Error("Impossible de creer la regle.");
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
    "Impossible de mettre a jour la regle."
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
    "Impossible d'enregistrer le feedback de la regle."
  );

  const entity = extractEntity(payload, ["suggestion_rule", "suggestionRule", "rule"]);
  return entity ? (entity as SuggestionRule) : null;
}

export async function fetchEstimateSuggestionLearnings(
  versionId: string
): Promise<SuggestionLearningState> {
  const payload = await requestJson<unknown>(
    `/api/estimates/${versionId}/suggestion-learning`,
    {
      method: "GET",
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
    throw new Error("Impossible de lire le resultat de suivi des corrections.");
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
    throw new Error("Impossible de lire le resultat de revue.");
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
    throw new Error("Impossible de lire le resultat de purge.");
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
    "Impossible de creer le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de creer le template.");
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
    "Impossible de mettre a jour le template."
  );

  const entity = extractEntity(payload, ["template"]);
  const parsed = parseEstimateTemplateSummaryEntity(entity);
  if (!parsed) {
    throw new Error("Impossible de mettre a jour le template.");
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
): Promise<{ projectId: string; versionId: string; redirectTo: string }> {
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
    "Impossible d'inserer le template."
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
}> {
  const payload = await requestJson<unknown>(
    "/api/estimates/assemblies?limit=1",
    {
      method: "GET",
    },
    "Impossible de charger les options des ouvrages."
  );
  const root = getRootPayload(payload);
  if (!isRecord(root)) {
    return { laborRoles: [], supplyTypes: [] };
  }

  return {
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
      }),
    },
    "Impossible de creer l'ouvrage."
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

  const payload = await requestJson<unknown>(
    `/api/estimates/assemblies/${assemblyId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    "Impossible de mettre a jour l'ouvrage."
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
    "Impossible d'inserer l'ouvrage."
  );

  return parseEstimateItems(payload);
}
