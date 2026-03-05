"use client";

import { useRouter } from "next/navigation";
import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { BulkSuggestDialog } from "@/components/estimates/BulkSuggestDialog";
import { EstimateChecklist } from "@/components/estimates/EstimateChecklist";
import { EstimateEditorAlerts } from "@/components/estimates/editor/EstimateEditorAlerts";
import { EstimateEditorDrawer } from "@/components/estimates/editor/EstimateEditorDrawer";
import { EstimateEditorToolbar } from "@/components/estimates/editor/EstimateEditorToolbar";
import {
  EstimateEditorTable,
  type EstimateSectionDuplicateTarget,
  type SuggestionCorrectionPayload,
  type SuggestionLearningState,
} from "@/components/estimates/EstimateEditorTable";
import { ImportFromEstimateDialog } from "@/components/estimates/ImportFromEstimateDialog";
import { EstimateSendGatingDialog } from "@/components/estimates/EstimateSendGatingDialog";
import type { DiscountMode, EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import {
  EstimateSettingsSummaryBar,
  type SettingsSection,
} from "@/components/estimates/EstimateSettingsSummaryBar";
import {
  type SuggestionRuleCreatePayload,
} from "@/components/estimates/EstimateSuggestionRulesManager";
import { useUserContext } from "@/components/UserContext";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useUiMode } from "@/hooks/useUiMode";
import { useAutoSaveNavigationGuard } from "@/hooks/useAutoSaveNavigationGuard";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { useUndoRedo, type UndoRedoCommand } from "@/hooks/useUndoRedo";
import {
  computeEstimateLineValues,
  computeEstimateTotals,
  computeInitialDiscountCents,
  computeStoredDiscountCents,
  normalizeDraftItems,
  computeReadOnlyTotals,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import {
  applyBufferedUpdatesToItems,
  rehydrateBufferedUpdates,
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";
import {
  buildBulkSuggestPreview,
  type BulkSuggestPreviewItem,
} from "@/lib/estimates/bulk-suggest";
import {
  computeEstimateChecklist,
  type EstimateChecklistCriterion,
} from "@/lib/estimates/checklist";
import {
  countEstimateQualityFlags,
  computeEstimateQualityFlagsByItemId,
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  DEFAULT_ESTIMATE_OUTLIER_CONFIG,
  detectEstimateOutliers,
  type EstimateOutlierDetectionConfig,
  type EstimateOutlierFlagKey,
  type EstimateOutlierFlagsByItemId,
  type EstimateOutlierMethod,
} from "@/lib/estimates/outlier-detection";
import {
  ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY,
  ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY,
  isEstimateEditorVirtualizationEnabled,
  resolveEstimateEditorVirtualizationConfig,
  resolveEstimateEditorVirtualizationRuntimeConfig,
  type EstimateEditorVirtualizationRuntimeConfig,
} from "@/lib/estimate-editor-virtualization";
import {
  exportToCSV,
  type ExportColumn,
} from "@/lib/export";
import {
  formatCurrency,
  normalizeEstimateCurrency,
  type SupportedEstimateCurrency,
} from "@/lib/money";
import {
  batchEstimateOperations,
  acquireEstimateDraftLock,
  bulkUpdateEstimateItems,
  createEstimateItem,
  createEstimateLaborRole,
  createEstimateSuggestionRule,
  createMarginTier as createMarginTierClient,
  updateMarginTier as updateMarginTierClient,
  deleteMarginTier as deleteMarginTierClient,
  deleteEstimateItem,
  duplicateEstimateSection,
  fetchEstimateSendGating,
  fetchEstimateDraftVersions,
  fetchEstimateEditorData,
  fetchEstimateItemsForVersion,
  fetchAffaireLinkedDpgfSource,
  fetchEstimateOutlierDismissedFlags,
  fetchEstimateVersionEvents,
  exportEstimate,
  importLinkedDpgfSource,
  importEstimateSections,
  insertAssemblyIntoVersion,
  insertTemplateIntoVersion,
  isEstimateApiError,
  moveEstimateItem,
  reorderEstimateItems,
  releaseEstimateDraftLock,
  saveEstimateVersion,
  sendEstimateSuggestionRuleFeedback,
  toggleEstimateOutlierDismissedFlag,
  updateEstimateLaborRole,
  type EstimateExportMode,
  type AffaireLinkedDpgfSource,
  type ImportLinkedDpgfSourceResult,
  type ImportEstimateSectionsPayload,
  type EstimateVersionEvent,
  type EstimateSendGatingResponse,
  updateEstimateStatus,
  updateEstimateSuggestionRule,
} from "@/lib/estimates/client";
import {
  markTempItemsRemoved,
  reconcileCreatedItemWithLocalDraft,
  rollbackRemovedTempItems,
} from "@/lib/estimates/editor-optimistic";
import { getDefaultSectionTitleForLevel } from "@/lib/estimates/hierarchy";
import { refreshVersionTokenAfterAssemblyInsert } from "@/lib/estimates/editor-version-refresh";
import { useDraftLock } from "@/hooks/useDraftLock";
import type { Database } from "@/types/database";
import {
  applyOptimisticTemplateInsertion,
  buildSiblingOrderByParent,
  collectSubtreeItemIds,
  createTopLevelItemIdsTracker,
  resolveTopLevelItemIds,
  sortItemsForTreeRecreation,
} from "@/app/dashboard/estimates/[versionId]/edit/utils/item-tree";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EditorEstimateItem = EstimateItem & {
  _optimistic?: boolean;
  _pendingCreate?: boolean;
  _tempId?: string;
};
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type MarginTierRow = Database["public"]["Tables"]["margin_tiers"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateQualityFilter = "all_lines" | "with_anomalies" | EstimateQualityFlagKey;

type EstimateVersionView = EstimateVersionRow & {
  estimate_projects: { name: string } | { name: string }[] | null;
};

type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

type ItemPatch = Partial<
  Pick<
    EstimateItem,
    | "title"
    | "aid"
    | "description"
    | "quantity"
    | "unit_price_ht_cents"
    | "tax_rate_bp"
    | "k_fo"
    | "h_mo"
    | "h_mo_majoration"
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
    | "supply_type_id"
    | "selected_supplier_price_id"
  >
> &
  LaborSplitItemFields;

type EstimateItemUpdatePayload =
  Database["public"]["Tables"]["estimate_items"]["Update"] &
    LaborSplitItemFields;
type EstimateItemInsertPayload =
  Database["public"]["Tables"]["estimate_items"]["Insert"] &
    LaborSplitItemFields;
type EstimateVersionTotalsPatch = Pick<
  EstimateVersionRow,
  "total_ht_cents" | "total_tax_cents" | "total_ttc_cents"
>;

type EstimateRecapExportRow = {
  project_name: string;
  version_id: string;
  version_number: number;
  status: EstimateStatus;
  date_devis: string;
  validite_jours: number;
  margin_multiplier: number;
  discount_cents: number;
  discount_bp: number;
  tax_rate_bp: number;
  rounding_mode: EstimateVersionRow["rounding_mode"];
  rounding_step_cents: number;
  sale_subtotal_cents: number;
  sale_total_cents: number;
  tax_cents: number;
  ttc_cents: number;
  quality_lines_count: number;
  quality_flags_count: number;
};

type EstimateLineExportRow = {
  section_path: string;
  designation: string;
  quality_flags: string;
  unit: string;
  quantity: number | "";
  unit_price_ht_cents: number | "";
  supply_type: string;
  supplier_1: string;
  supplier_2: string;
  supplier_3: string;
  k_fo: number | "";
  h_mo: number | "";
  h_mo_majoration_pct: number | "";
  labor_role: string;
  k_mo: number | "";
  h_mo_atelier: number | "";
  labor_role_atelier: string;
  k_mo_atelier: number | "";
  h_mo_chantier: number | "";
  labor_role_chantier: string;
  k_mo_chantier: number | "";
  pu_ht_cents: number | "";
  line_total_ht_cents: number | "";
  tax_rate_bp: number | "";
  line_total_ttc_cents: number | "";
};

type SupplierComparisonAlternative = {
  supplier_name: string;
  adjusted_unit_price_cents: number | null;
  unit_price_cents: number | null;
  currency: string | null;
  supplier_reference: string | null;
  catalogue_url: string | null;
  updated_at: string | null;
};

type SupplierComparisonsByItemId = Map<string, SupplierComparisonAlternative[]>;

type AuditLogEntry = Pick<
  Database["public"]["Tables"]["audit_logs"]["Row"],
  "id" | "created_at" | "action" | "table_name" | "record_id"
>;

type JsonRecord = Record<string, unknown>;
type EstimateConflictState = {
  message: string;
  details: unknown;
};
type EstimateConflictDraft = {
  settings: EstimateSettingsState | null;
  items: EstimateItem[];
  saved_at: string;
};
type EstimateAutoSaveDraft = {
  buffered_updates: {
    id: string;
    updates: EstimateItemUpdatePayload;
  }[];
  saved_at: string;
};
type BulkSuggestProgressState = {
  processed: number;
  total: number;
  percentage: number;
};
type BulkSuggestUndoState = {
  previousItems: EstimateItem[];
  appliedItemIds: string[];
};
type EstimateUndoRedoCommand = UndoRedoCommand & {
  label?: string;
};
type EstimateItemMovePayload = {
  itemId: string;
  fromParentId: string | null;
  toParentId: string | null;
  orderedSourceIds: string[];
  orderedTargetIds: string[];
};
type EstimateEditorTableProps = ComponentProps<typeof EstimateEditorTable>;
type EstimateEditorVirtualizationConfig = NonNullable<
  EstimateEditorTableProps["virtualization"]
>;
type SuggestionLearningOverrides =
  SuggestionLearningState["by_rule_id"][string]["overrides"];
type SuggestionLearningTrackResult = SuggestionLearningState & {
  tracked_count: number;
};

const AUDIT_LOG_LIMIT = 25;
const CONFLICT_DRAFT_STORAGE_PREFIX = "estimate:edit:conflict-draft:";
const AUTOSAVE_BUFFER_STORAGE_PREFIX = "estimate:edit:autosave-buffer:";
const BULK_AUTOSAVE_DEBOUNCE_MS = 2000;
const BULK_AUTOSAVE_IMMEDIATE_FLUSH_UPDATES = 100;
const BULK_SUGGEST_PROGRESS_THRESHOLD = 50;
const PASTE_CREATE_BATCH_MAX_OPERATIONS = 100;
const LABOR_SPLIT_FLAG_KEY = "EST_031_LABOR_SPLIT";
const MAX_CASCADE_DISCOUNT_STEPS = 4;
const DEFAULT_ESTIMATE_CURRENCY: SupportedEstimateCurrency = "EUR";
const LABOR_SPLIT_FIELD_KEYS = [
  "h_mo_atelier",
  "k_mo_atelier",
  "labor_role_atelier_id",
  "h_mo_chantier",
  "k_mo_chantier",
  "labor_role_chantier_id",
] as const;
type LaborSplitFieldKey = (typeof LABOR_SPLIT_FIELD_KEYS)[number];
const ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG: EstimateEditorVirtualizationRuntimeConfig =
  resolveEstimateEditorVirtualizationConfig({
    enabled: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ENABLED,
    mode: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_MODE,
    autoThreshold: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD,
    rowEstimate: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ROW_ESTIMATE,
    overscan: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_OVERSCAN,
    maxHeight: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_CONTAINER_HEIGHT,
  });
const EMPTY_SUGGESTION_LEARNING_STATE: SuggestionLearningState = {
  enabled: false,
  by_rule_id: {},
};

function getProjectName(
  value: EstimateVersionView["estimate_projects"]
) {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.name ?? "";
  return value.name ?? "";
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function resolveItemTitle(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function clampCascadeDiscountStepBp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), 10000);
}

function normalizeCascadeDiscountSteps(steps: number[] | undefined): number[] {
  return (steps ?? [])
    .map((step) => clampCascadeDiscountStepBp(step))
    .slice(0, MAX_CASCADE_DISCOUNT_STEPS);
}

function resolveEstimateCurrency(value: string | null | undefined) {
  return normalizeEstimateCurrency(value) ?? DEFAULT_ESTIMATE_CURRENCY;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildConflictDraftStorageKey(versionId: string) {
  return `${CONFLICT_DRAFT_STORAGE_PREFIX}${versionId}`;
}

function buildAutoSaveDraftStorageKey(versionId: string) {
  return `${AUTOSAVE_BUFFER_STORAGE_PREFIX}${versionId}`;
}

function readConflictDraftFromSession(versionId: string): EstimateConflictDraft | null {
  if (!versionId || typeof window === "undefined") return null;

  const raw = window.sessionStorage.getItem(buildConflictDraftStorageKey(versionId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;

    const settingsValue = parsed.settings;
    if (settingsValue !== null && settingsValue !== undefined && !isRecord(settingsValue)) {
      return null;
    }

    if (!Array.isArray(parsed.items)) return null;

    return {
      settings:
        settingsValue === null || settingsValue === undefined
          ? null
          : (settingsValue as EstimateSettingsState),
      items: parsed.items as EstimateItem[],
      saved_at: toNonEmptyString(parsed.saved_at) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeConflictDraftToSession(
  versionId: string,
  draft: EstimateConflictDraft
) {
  if (!versionId || typeof window === "undefined") return;

  window.sessionStorage.setItem(
    buildConflictDraftStorageKey(versionId),
    JSON.stringify(draft)
  );
}

function clearConflictDraftFromSession(versionId: string) {
  if (!versionId || typeof window === "undefined") return;
  window.sessionStorage.removeItem(buildConflictDraftStorageKey(versionId));
}

function readAutoSaveDraftFromLocal(versionId: string): EstimateAutoSaveDraft | null {
  if (!versionId || typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(buildAutoSaveDraftStorageKey(versionId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.buffered_updates)) {
      return null;
    }

    const bufferedUpdates = parsed.buffered_updates
      .map((entry) => {
        if (!isRecord(entry)) return null;
        if (typeof entry.id !== "string" || !entry.id) return null;
        if (!isRecord(entry.updates)) return null;
        return {
          id: entry.id,
          updates: entry.updates as EstimateItemUpdatePayload,
        };
      })
      .filter((value): value is EstimateAutoSaveDraft["buffered_updates"][number] =>
        value !== null
      );

    if (bufferedUpdates.length === 0) return null;

    return {
      buffered_updates: bufferedUpdates,
      saved_at: toNonEmptyString(parsed.saved_at) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function writeAutoSaveDraftToLocal(
  versionId: string,
  bufferedUpdates: EstimateAutoSaveDraft["buffered_updates"]
) {
  if (!versionId || typeof window === "undefined") return;

  if (bufferedUpdates.length === 0) {
    clearAutoSaveDraftFromLocal(versionId);
    return;
  }

  const payload: EstimateAutoSaveDraft = {
    buffered_updates: bufferedUpdates,
    saved_at: new Date().toISOString(),
  };

  window.localStorage.setItem(
    buildAutoSaveDraftStorageKey(versionId),
    JSON.stringify(payload)
  );
}

function clearAutoSaveDraftFromLocal(versionId: string) {
  if (!versionId || typeof window === "undefined") return;
  window.localStorage.removeItem(buildAutoSaveDraftStorageKey(versionId));
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function createTempEstimateItemId() {
  return `tmp:${crypto.randomUUID()}`;
}

function isTempEstimateItemId(itemId: string) {
  return itemId.startsWith("tmp:");
}

function isPendingCreateEstimateItem(
  item: EstimateItem | (EstimateItem & { _pendingCreate?: boolean })
) {
  return (item as EstimateItem & { _pendingCreate?: boolean })._pendingCreate === true;
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toApiDataRecord(payload: unknown): JsonRecord | null {
  if (!isRecord(payload)) return null;
  if (isRecord(payload.data)) return payload.data;
  return payload;
}

function resolveSuggestionLearningErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const nestedError = isRecord(payload.error) ? payload.error : null;
  return (
    toNonEmptyString(nestedError?.message) ??
    toNonEmptyString(payload.message) ??
    fallback
  );
}

function parseNullableNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSuggestionLearningOverrides(value: unknown): SuggestionLearningOverrides {
  if (!isRecord(value)) return {};

  const overrides: SuggestionLearningOverrides = {};

  if ("description" in value) {
    overrides.description = toNonEmptyString(value.description);
  }
  if ("category_id" in value) {
    overrides.category_id = toNonEmptyString(value.category_id);
  }
  if ("k_fo" in value) {
    overrides.k_fo = parseNullableNumericValue(value.k_fo);
  }
  if ("k_mo" in value) {
    overrides.k_mo = parseNullableNumericValue(value.k_mo);
  }
  if ("labor_role_id" in value) {
    overrides.labor_role_id = toNonEmptyString(value.labor_role_id);
  }
  if ("supply_type_id" in value) {
    overrides.supply_type_id = toNonEmptyString(value.supply_type_id);
  }

  return overrides;
}

function normalizeSuggestionLearningState(payload: unknown): SuggestionLearningState {
  const data = toApiDataRecord(payload);
  if (!data) return EMPTY_SUGGESTION_LEARNING_STATE;

  const byRuleSource = isRecord(data.by_rule_id) ? data.by_rule_id : {};
  const byRuleId: SuggestionLearningState["by_rule_id"] = {};

  Object.entries(byRuleSource).forEach(([ruleIdFromKey, value]) => {
    if (!isRecord(value)) return;

    const ruleId = toNonEmptyString(value.rule_id) ?? ruleIdFromKey;
    if (!ruleId) return;

    byRuleId[ruleId] = {
      rule_id: ruleId,
      learning_boost: Math.max(toFiniteNumber(value.learning_boost, 0), 0),
      overrides: normalizeSuggestionLearningOverrides(value.overrides),
    };
  });

  const configRecord = isRecord(data.config) ? data.config : null;
  return {
    enabled: configRecord?.enabled === true,
    by_rule_id: byRuleId,
  };
}

async function fetchSuggestionLearningState(
  versionId: string
): Promise<SuggestionLearningState> {
  if (!versionId) return EMPTY_SUGGESTION_LEARNING_STATE;

  const response = await fetch(`/api/estimates/${versionId}/suggestion-learning`, {
    method: "GET",
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveSuggestionLearningErrorMessage(
        payload,
        "Impossible de charger les apprentissages de suggestions."
      )
    );
  }

  return normalizeSuggestionLearningState(payload);
}

async function trackSuggestionCorrectionsForVersion(input: {
  versionId: string;
  corrections: SuggestionCorrectionPayload[];
}): Promise<SuggestionLearningTrackResult> {
  if (!input.versionId || input.corrections.length === 0) {
    return {
      ...EMPTY_SUGGESTION_LEARNING_STATE,
      tracked_count: 0,
    };
  }

  const response = await fetch(`/api/estimates/${input.versionId}/suggestion-learning`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      corrections: input.corrections,
    }),
  });

  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    throw new Error(
      resolveSuggestionLearningErrorMessage(
        payload,
        "Impossible d'enregistrer les corrections de suggestion."
      )
    );
  }

  const data = toApiDataRecord(payload);
  return {
    ...normalizeSuggestionLearningState(payload),
    tracked_count: Math.max(0, Math.trunc(toFiniteNumber(data?.tracked_count, 0))),
  };
}

function formatSupplierComparisonDate(value: string | null) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeSupplierComparisonAlternative(
  value: unknown
): SupplierComparisonAlternative | null {
  if (!isRecord(value)) return null;

  return {
    supplier_name:
      toNonEmptyString(value.supplier_name) ??
      toNonEmptyString(value.name) ??
      "Fournisseur",
    adjusted_unit_price_cents: toNullableFiniteNumber(value.adjusted_unit_price_cents),
    unit_price_cents: toNullableFiniteNumber(value.unit_price_cents),
    currency: toNonEmptyString(value.currency),
    supplier_reference:
      toNonEmptyString(value.supplier_reference) ??
      toNonEmptyString(value.reference),
    catalogue_url: toNonEmptyString(value.catalogue_url) ?? toNonEmptyString(value.url),
    updated_at: toNonEmptyString(value.updated_at) ?? toNonEmptyString(value.date),
  };
}

function normalizeSupplierComparisonAlternatives(
  value: unknown
): SupplierComparisonAlternative[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeSupplierComparisonAlternative(entry))
    .filter((entry): entry is SupplierComparisonAlternative => entry !== null)
    .slice(0, 3);
}

function readSupplierComparisonEntry(
  entry: unknown,
  fallbackItemId?: string
): { itemId: string; alternatives: SupplierComparisonAlternative[] } | null {
  if (!isRecord(entry)) return null;

  const itemId =
    toNonEmptyString(entry.item_id) ??
    toNonEmptyString(entry.itemId) ??
    toNonEmptyString(entry.estimate_item_id) ??
    fallbackItemId ??
    null;

  if (!itemId) return null;

  const alternatives =
    [
      normalizeSupplierComparisonAlternatives(entry.alternatives),
      normalizeSupplierComparisonAlternatives(entry.suppliers),
      normalizeSupplierComparisonAlternatives(entry.options),
    ].find((candidate) => candidate.length > 0) ?? [];

  if (alternatives.length === 0) return null;

  return { itemId, alternatives };
}

function normalizeSupplierComparisonsByItemId(
  payload: unknown
): SupplierComparisonsByItemId {
  const map: SupplierComparisonsByItemId = new Map();

  const pushEntry = (entry: unknown, fallbackItemId?: string) => {
    const parsed = readSupplierComparisonEntry(entry, fallbackItemId);
    if (!parsed) return;
    map.set(parsed.itemId, parsed.alternatives);
  };

  const readContainer = (container: unknown) => {
    if (Array.isArray(container)) {
      container.forEach((entry) => pushEntry(entry));
      return;
    }

    if (!isRecord(container)) return;

    if (
      toNonEmptyString(container.item_id) ||
      toNonEmptyString(container.itemId) ||
      toNonEmptyString(container.estimate_item_id)
    ) {
      pushEntry(container);
    }

    const arrayKeys = ["comparisons", "items", "lines", "results", "data"];
    arrayKeys.forEach((key) => {
      if (Array.isArray(container[key])) {
        (container[key] as unknown[]).forEach((entry) => pushEntry(entry));
      }
    });

    Object.entries(container).forEach(([itemId, value]) => {
      pushEntry(value, itemId);
    });
  };

  readContainer(payload);
  if (isRecord(payload)) {
    readContainer(payload.data);
  }

  return map;
}

function formatSupplierAlternativeCompact(
  alternative: SupplierComparisonAlternative | undefined,
  estimateCurrency: SupportedEstimateCurrency
) {
  if (!alternative) return "";

  const unitPriceCents =
    alternative.adjusted_unit_price_cents ?? alternative.unit_price_cents;
  const currency = resolveEstimateCurrency(alternative.currency ?? estimateCurrency);
  const priceLabel =
    unitPriceCents === null ? "-" : formatCurrency(unitPriceCents, currency);
  const supplierReference = toNonEmptyString(alternative.supplier_reference) ?? "-";
  const catalogueUrl = toNonEmptyString(alternative.catalogue_url) ?? "-";
  const updatedAt = formatSupplierComparisonDate(alternative.updated_at);

  return `${alternative.supplier_name} | ${priceLabel} | ${supplierReference} | ${catalogueUrl} | ${updatedAt}`;
}

function readLaborSplitFields(
  source: EstimateItem | Record<string, unknown>
): Required<LaborSplitItemFields> {
  const record = source as Record<string, unknown>;
  return {
    h_mo_atelier: toFiniteNumber(record.h_mo_atelier, 0),
    k_mo_atelier: toFiniteNumber(record.k_mo_atelier, 1),
    labor_role_atelier_id: toNonEmptyString(record.labor_role_atelier_id),
    h_mo_chantier: toFiniteNumber(record.h_mo_chantier, 0),
    k_mo_chantier: toFiniteNumber(record.k_mo_chantier, 1),
    labor_role_chantier_id: toNonEmptyString(record.labor_role_chantier_id),
  };
}

function hasLaborSplitFields(source: EstimateItem | Record<string, unknown>) {
  const record = source as Record<string, unknown>;
  return LABOR_SPLIT_FIELD_KEYS.some((key) => key in record);
}

function appendLaborSplitFields(
  source: EstimateItem | Record<string, unknown>,
  target: EstimateItemUpdatePayload | Record<string, unknown>
) {
  const sourceRecord = source as Record<string, unknown>;
  const targetRecord = target as Record<string, unknown>;

  LABOR_SPLIT_FIELD_KEYS.forEach((key) => {
    if (!(key in sourceRecord)) return;
    targetRecord[key] = sourceRecord[key as LaborSplitFieldKey] ?? null;
  });
}

function resolveLaborRoleHourlyRate(
  role: LaborRole | Record<string, unknown>,
  scope: "default" | "atelier" | "chantier"
) {
  const record = role as Record<string, unknown>;
  const fallbackRate = toFiniteNumber(record.hourly_rate_cents, 0);
  if (scope === "atelier") {
    return toFiniteNumber(record.hourly_rate_atelier_cents, fallbackRate);
  }
  if (scope === "chantier") {
    return toFiniteNumber(record.hourly_rate_chantier_cents, fallbackRate);
  }
  return fallbackRate;
}

function resolveAuditErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  return (
    toNonEmptyString(payload.error) ??
    toNonEmptyString(payload.message) ??
    fallback
  );
}

function normalizeAuditLogs(payload: unknown): AuditLogEntry[] {
  if (!isRecord(payload)) return [];
  if (!Array.isArray(payload.data)) return [];

  return payload.data
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const id = toNonEmptyString(entry.id);
      const createdAt = toNonEmptyString(entry.created_at);
      const action = toNonEmptyString(entry.action);
      const tableName = toNonEmptyString(entry.table_name);
      const recordId = toNonEmptyString(entry.record_id);

      if (!id || !createdAt || !action || !tableName || !recordId) {
        return null;
      }

      return {
        id,
        created_at: createdAt,
        action,
        table_name: tableName,
        record_id: recordId,
      };
    })
    .filter((entry): entry is AuditLogEntry => entry !== null);
}

function formatAuditTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function buildSectionPathResolver(items: EstimateItem[]) {
  const byId = new Map<string, EstimateItem>();
  items.forEach((item) => {
    byId.set(item.id, item);
  });

  const cache = new Map<string, string>();

  return (item: EstimateItem) => {
    if (item.item_type !== "line") return "";
    const cached = cache.get(item.id);
    if (cached !== undefined) return cached;

    const parts: string[] = [];
    let currentParentId = item.parent_id;
    while (currentParentId) {
      const parent = byId.get(currentParentId);
      if (!parent) break;
      if (parent.item_type === "section") {
        parts.push(resolveItemTitle(parent.title, "Sans titre"));
      }
      currentParentId = parent.parent_id;
    }

    const path = parts.reverse().join(" > ");
    cache.set(item.id, path);
    return path;
  };
}

const LINE_EXPORT_COLUMNS: ExportColumn<EstimateLineExportRow>[] = [
  { key: "section_path", header: "Chemin chapitre" },
  { key: "designation", header: "Designation" },
  { key: "quality_flags", header: "Flags qualite" },
  { key: "unit", header: "Unite" },
  { key: "quantity", header: "Quantite" },
  {
    key: "unit_price_ht_cents",
    header: "Prix unitaire HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  { key: "supply_type", header: "Type FO" },
  { key: "supplier_1", header: "Fournisseur 1" },
  { key: "supplier_2", header: "Fournisseur 2" },
  { key: "supplier_3", header: "Fournisseur 3" },
  { key: "k_fo", header: "K FO" },
  { key: "h_mo", header: "h MO" },
  { key: "h_mo_majoration_pct", header: "Majoration MO (%)" },
  { key: "labor_role", header: "Role MO" },
  { key: "k_mo", header: "K MO" },
  {
    key: "pu_ht_cents",
    header: "PU HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "line_total_ht_cents",
    header: "Total HT (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "tax_rate_bp",
    header: "TVA (%)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
  {
    key: "line_total_ttc_cents",
    header: "Total TTC (EUR)",
    formatter: (value) => (typeof value === "number" ? value / 100 : ""),
  },
];

const LINE_EXPORT_COLUMNS_WITH_LABOR_SPLIT: ExportColumn<EstimateLineExportRow>[] = [
  ...LINE_EXPORT_COLUMNS,
  { key: "h_mo_atelier", header: "h MO atelier" },
  { key: "labor_role_atelier", header: "Role MO atelier" },
  { key: "k_mo_atelier", header: "K MO atelier" },
  { key: "h_mo_chantier", header: "h MO chantier" },
  { key: "labor_role_chantier", header: "Role MO chantier" },
  { key: "k_mo_chantier", header: "K MO chantier" },
];

function formatSectionDuplicateTargetLabel(input: {
  versionNumber: number;
  title: string | null;
}) {
  const title = input.title?.trim();
  if (title && title.length > 0) {
    return `V${input.versionNumber} - ${title}`;
  }
  return `V${input.versionNumber} - Sans titre`;
}

function resolveEstimateActionError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("read-only")) {
    return "Cette version est en lecture seule.";
  }
  return message;
}

function hasImportableLinkedDpgfSource(
  source: AffaireLinkedDpgfSource
): source is NonNullable<AffaireLinkedDpgfSource> {
  return Boolean(
    source &&
      source.importStatus === "completed" &&
      source.mappedRowCount > 0
  );
}

function isVersionConflictError(error: unknown): boolean {
  return isEstimateApiError(error) && error.status === 409;
}

function buildVersionTotalsPatch(
  totals: EstimateTotals | null
): EstimateVersionTotalsPatch | undefined {
  if (!totals) return undefined;
  return {
    total_ht_cents: totals.saleTotalCents,
    total_tax_cents: totals.adjustedTaxCents,
    total_ttc_cents: totals.roundedTtcCents,
  };
}

function buildEstimateItemUpdatePayload(item: EstimateItem): EstimateItemUpdatePayload {
  if (item.item_type === "line") {
    const payload: EstimateItemUpdatePayload = {
      title: item.title,
      aid: item.aid ?? null,
      description: item.description ?? null,
      quantity: item.quantity,
      unit_price_ht_cents: item.unit_price_ht_cents,
      tax_rate_bp: item.tax_rate_bp,
      k_fo: item.k_fo,
      h_mo: item.h_mo,
      h_mo_majoration: item.h_mo_majoration,
      k_mo: item.k_mo,
      pu_ht_cents: item.pu_ht_cents,
      labor_role_id: item.labor_role_id,
      category_id: item.category_id,
      supply_type_id: item.supply_type_id,
      selected_supplier_price_id: item.selected_supplier_price_id,
      line_total_ht_cents: item.line_total_ht_cents,
      line_tax_cents: item.line_tax_cents,
      line_total_ttc_cents: item.line_total_ttc_cents,
    };

    appendLaborSplitFields(item, payload);
    return payload;
  }

  return {
    title: item.title,
    aid: item.aid ?? null,
  };
}

function buildEstimateItemInsertPayload(
  versionId: string,
  item: EstimateItem,
  overrides?: {
    parentId?: string | null;
    position?: number;
    title?: string;
  }
): EstimateItemInsertPayload {
  const parentId =
    overrides?.parentId !== undefined
      ? overrides.parentId
      : (item.parent_id ?? null);
  const position = overrides?.position ?? item.position;
  const title = overrides?.title ?? item.title;

  if (item.item_type === "section") {
    return {
      version_id: versionId,
      parent_id: parentId,
      item_type: "section",
      position,
      title,
      aid: item.aid ?? null,
    };
  }

  const payload: EstimateItemInsertPayload = {
    version_id: versionId,
    parent_id: parentId,
    item_type: "line",
    position,
    title,
    aid: item.aid ?? null,
    description: item.description ?? null,
    quantity: item.quantity,
    unit_price_ht_cents: item.unit_price_ht_cents,
    tax_rate_bp: item.tax_rate_bp,
    k_fo: item.k_fo,
    h_mo: item.h_mo,
    h_mo_majoration: item.h_mo_majoration,
    k_mo: item.k_mo,
    pu_ht_cents: item.pu_ht_cents,
    labor_role_id: item.labor_role_id,
    category_id: item.category_id,
    supply_type_id: item.supply_type_id,
    selected_supplier_price_id: item.selected_supplier_price_id,
    line_total_ht_cents: item.line_total_ht_cents,
    line_tax_cents: item.line_tax_cents,
    line_total_ttc_cents: item.line_total_ttc_cents,
  };

  appendLaborSplitFields(item, payload);
  return payload;
}

function createOptimisticSectionItem(input: {
  tempId: string;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  position: number;
  title: string;
}): EditorEstimateItem {
  const timestamp = new Date().toISOString();
  return {
    id: input.tempId,
    created_at: timestamp,
    updated_at: timestamp,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: input.parentId,
    item_type: "section",
    position: input.position,
    title: input.title,
    aid: null,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    h_mo_majoration: 1,
    k_mo: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    _optimistic: true,
    _pendingCreate: true,
    _tempId: input.tempId,
  };
}

function createOptimisticLineItem(input: {
  tempId: string;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  position: number;
  title: string;
  quantity: number;
  taxRateBp: number;
  puHtCents: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
  isLaborSplitEnabled: boolean;
}): EditorEstimateItem {
  const timestamp = new Date().toISOString();
  return {
    id: input.tempId,
    created_at: timestamp,
    updated_at: timestamp,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: input.parentId,
    item_type: "line",
    position: input.position,
    title: input.title,
    aid: null,
    description: null,
    quantity: input.quantity,
    unit_price_ht_cents: 0,
    tax_rate_bp: input.taxRateBp,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: input.isLaborSplitEnabled ? 0 : null,
    k_mo_atelier: input.isLaborSplitEnabled ? 1 : null,
    labor_role_atelier_id: null,
    h_mo_chantier: input.isLaborSplitEnabled ? 0 : null,
    k_mo_chantier: input.isLaborSplitEnabled ? 1 : null,
    labor_role_chantier_id: null,
    pu_ht_cents: input.puHtCents,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: input.lineTotalHtCents,
    line_tax_cents: input.lineTaxCents,
    line_total_ttc_cents: input.lineTotalTtcCents,
    _optimistic: true,
    _pendingCreate: true,
    _tempId: input.tempId,
  };
}

function applyInterParentMoveOptimistically(
  sourceItems: EstimateItem[],
  move: EstimateItemMovePayload
) {
  const sourcePositionById = new Map(
    move.orderedSourceIds.map((itemId, index) => [itemId, index + 1])
  );
  const targetPositionById = new Map(
    move.orderedTargetIds.map((itemId, index) => [itemId, index + 1])
  );

  return sourceItems.map((item) => {
    if (item.id === move.itemId) {
      const nextPosition = targetPositionById.get(item.id);
      if (nextPosition === undefined) return item;
      return {
        ...item,
        parent_id: move.toParentId,
        position: nextPosition,
      };
    }

    if ((item.parent_id ?? null) === move.fromParentId) {
      const nextPosition = sourcePositionById.get(item.id);
      if (nextPosition !== undefined) {
        return {
          ...item,
          position: nextPosition,
        };
      }
    }

    if ((item.parent_id ?? null) === move.toParentId) {
      const nextPosition = targetPositionById.get(item.id);
      if (nextPosition !== undefined) {
        return {
          ...item,
          position: nextPosition,
        };
      }
    }

    return item;
  });
}

export type EstimateEditorStateModel = {
  state: {
    versionId: string;
    resolvedVersionId: string;
    isLoading: boolean;
    loadError: string | null;
    version: EstimateVersionView | null;
    settings: EstimateSettingsState | null;
    isSettingsDrawerOpen: boolean;
    isBulkSuggestDialogOpen: boolean;
    isImportFromEstimateDialogOpen: boolean;
    isSendGatingDialogOpen: boolean;
  };
  actions: {
    openSettingsDrawer: (section?: SettingsSection) => void;
    closeSettingsDrawer: () => void;
  };
  meta:
    | {
        kind: "missing-version";
      }
    | {
        kind: "loading";
      }
    | {
        kind: "error";
        message: string;
      }
    | {
        kind: "ready";
        projectId: string | null;
        toolbarProps: ComponentProps<typeof EstimateEditorToolbar>;
        alertsProps: ComponentProps<typeof EstimateEditorAlerts>;
        summaryBarProps: ComponentProps<typeof EstimateSettingsSummaryBar>;
        editorTableProps: EstimateEditorTableProps;
        drawerProps: ComponentProps<typeof EstimateEditorDrawer>;
        bulkSuggestDialogProps: ComponentProps<typeof BulkSuggestDialog>;
        importFromEstimateDialogProps:
          | ComponentProps<typeof ImportFromEstimateDialog>
          | null;
        sendGatingDialogProps: ComponentProps<typeof EstimateSendGatingDialog>;
      };
};

export function useEstimateEditorState({
  versionId,
}: {
  versionId: string;
}): EstimateEditorStateModel {
  const router = useRouter();
  const resolvedVersionId = versionId;
  const { profile } = useUserContext();
  const { isExpert } = useUiMode();
  const { enabled: isLaborSplitEnabled } = useFeatureFlag(LABOR_SPLIT_FLAG_KEY);
  const {
    enabled: isVirtualizationModeFlagEnabled,
    value: virtualizationModeFlagValue,
  } = useFeatureFlag(ESTIMATE_EDITOR_VIRTUALIZATION_MODE_FLAG_KEY);
  const { value: virtualizationAutoThresholdFlagValue } = useFeatureFlag(
    ESTIMATE_EDITOR_VIRTUALIZATION_AUTO_THRESHOLD_FLAG_KEY
  );

  const [version, setVersion] = useState<EstimateVersionView | null>(null);
  const [settings, setSettings] = useState<EstimateSettingsState | null>(null);
  const [savedSettings, setSavedSettings] =
    useState<EstimateSettingsState | null>(null);
  const [items, setItems] = useState<EditorEstimateItem[]>([]);
  const [categories, setCategories] = useState<EstimateCategory[]>([]);
  const [supplyTypes, setSupplyTypes] = useState<SupplyType[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [suggestionRules, setSuggestionRules] = useState<SuggestionRule[]>([]);
  const [suggestionLearningState, setSuggestionLearningState] =
    useState<SuggestionLearningState>(EMPTY_SUGGESTION_LEARNING_STATE);
  const [dismissedOutlierFlagsByItemId, setDismissedOutlierFlagsByItemId] =
    useState<EstimateOutlierFlagsByItemId>({});
  const [outlierActionPendingByItemId, setOutlierActionPendingByItemId] =
    useState<Record<string, boolean>>({});
  const [outlierConfig, setOutlierConfig] = useState<EstimateOutlierDetectionConfig>(
    DEFAULT_ESTIMATE_OUTLIER_CONFIG
  );
  const [qualityFilter, setQualityFilter] =
    useState<EstimateQualityFilter>("all_lines");
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [drawerScrollTarget, setDrawerScrollTarget] = useState<SettingsSection | null>(null);
  const [isChecklistCollapsed, setIsChecklistCollapsed] = useState(true);
  const [checklistScrollTargetItemId, setChecklistScrollTargetItemId] =
    useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [activeExportMode, setActiveExportMode] = useState<
    EstimateExportMode | "csv" | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [isSavingMarginTiers, setIsSavingMarginTiers] = useState(false);
  const [marginTiersError, setMarginTiersError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [sendGating, setSendGating] =
    useState<EstimateSendGatingResponse | null>(null);
  const [isSendGatingDialogOpen, setIsSendGatingDialogOpen] = useState(false);
  const [sendWorkflowPhase, setSendWorkflowPhase] = useState<
    "verification" | "pdf" | "sealing" | null
  >(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<EstimateVersionEvent[]>([]);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [isTimelineLoading, setIsTimelineLoading] = useState(false);
  const [totalsOutOfSync, setTotalsOutOfSync] = useState(false);
  const [hasPendingBufferedUpdates, setHasPendingBufferedUpdates] = useState(false);
  const [conflictState, setConflictState] = useState<EstimateConflictState | null>(
    null
  );
  const [restorableDraft, setRestorableDraft] =
    useState<EstimateConflictDraft | null>(null);
  const [isBulkSuggestDialogOpen, setIsBulkSuggestDialogOpen] = useState(false);
  const [selectedBulkSuggestItemIds, setSelectedBulkSuggestItemIds] = useState<
    string[]
  >([]);
  const [bulkSuggestDialogError, setBulkSuggestDialogError] =
    useState<string | null>(null);
  const [isApplyingBulkSuggest, setIsApplyingBulkSuggest] = useState(false);
  const [bulkSuggestProgress, setBulkSuggestProgress] =
    useState<BulkSuggestProgressState | null>(null);
  const [bulkSuggestUndoState, setBulkSuggestUndoState] =
    useState<BulkSuggestUndoState | null>(null);
  const [isUndoingBulkSuggest, setIsUndoingBulkSuggest] = useState(false);
  const [isReloadingVersion, setIsReloadingVersion] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [sectionDuplicateTargets, setSectionDuplicateTargets] = useState<
    EstimateSectionDuplicateTarget[]
  >([]);
  const [isImportFromEstimateDialogOpen, setIsImportFromEstimateDialogOpen] =
    useState(false);
  const [importSummaryMessage, setImportSummaryMessage] =
    useState<string | null>(null);
  const [linkedDpgfSource, setLinkedDpgfSource] =
    useState<AffaireLinkedDpgfSource>(null);
  const [isLoadingLinkedDpgfSource, setIsLoadingLinkedDpgfSource] =
    useState(false);
  const [isImportingDpgfSource, setIsImportingDpgfSource] = useState(false);
  const {
    push: pushHistoryCommand,
    undo: executeUndo,
    redo: executeRedo,
    clear: clearUndoRedoHistory,
    canUndo,
    canRedo,
    isExecuting: isUndoRedoBusy,
  } = useUndoRedo<EstimateUndoRedoCommand>({
    maxStackSize: 50,
  });

  const itemsRef = useRef<EditorEstimateItem[]>([]);
  const versionRef = useRef<EstimateVersionView | null>(null);
  const persistedTotalsRef = useRef<EstimateTotals | null>(null);
  const isSaveBlockedRef = useRef(false);
  const isUndoRedoBusyRef = useRef(false);
  const pendingItemUpdatesRef = useRef<Map<string, EstimateItemUpdatePayload>>(
    new Map()
  );
  const queuedPatchesByTempIdRef = useRef<Map<string, EstimateItemUpdatePayload>>(
    new Map()
  );
  const removedTempItemIdsRef = useRef<Set<string>>(new Set());
  const pendingBufferedUpdateCountRef = useRef(0);
  const isFlushingBufferedUpdatesRef = useRef(false);
  const applyPendingBufferedUpdatesToItems = useCallback(
    (sourceItems: EditorEstimateItem[]) =>
      applyBufferedUpdatesToItems(
        sourceItems,
        serializeBufferedUpdates(pendingItemUpdatesRef.current)
      ),
    []
  );

  useEffect(() => {
    isUndoRedoBusyRef.current = isUndoRedoBusy;
  }, [isUndoRedoBusy]);

  const registerVersionConflict = useCallback((error: unknown) => {
    if (!isVersionConflictError(error) || !isEstimateApiError(error)) {
      return false;
    }

    const message = resolveEstimateActionError(error.message);
    setConflictState({
      message,
      details: error.details,
    });
    setActionError(message);
    return true;
  }, []);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    const lineIds = new Set(
      items.filter((item) => item.item_type === "line").map((item) => item.id)
    );

    setDismissedOutlierFlagsByItemId((prev) => {
      let changed = false;
      const next: EstimateOutlierFlagsByItemId = {};

      Object.entries(prev).forEach(([itemId, flags]) => {
        if (!lineIds.has(itemId)) {
          changed = true;
          return;
        }

        const deduped = flags.filter((flag, index) => flags.indexOf(flag) === index);
        if (deduped.length !== flags.length) {
          changed = true;
        }
        if (deduped.length === 0) {
          changed = true;
          return;
        }
        next[itemId] = deduped;
      });

      return changed ? next : prev;
    });

    setOutlierActionPendingByItemId((prev) => {
      let changed = false;
      const next: Record<string, boolean> = {};

      Object.entries(prev).forEach(([itemId, isPending]) => {
        if (!isPending) return;
        if (!lineIds.has(itemId)) {
          changed = true;
          return;
        }
        next[itemId] = true;
      });

      return changed ? next : prev;
    });
  }, [items]);

  useEffect(() => {
    if (!resolvedVersionId) {
      setRestorableDraft(null);
      return;
    }

    setRestorableDraft(readConflictDraftFromSession(resolvedVersionId));
  }, [resolvedVersionId]);

  useEffect(() => {
    if (!resolvedVersionId) {
      setSuggestionLearningState(EMPTY_SUGGESTION_LEARNING_STATE);
      return;
    }

    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      setSuggestionLearningState(EMPTY_SUGGESTION_LEARNING_STATE);

      try {
        const [data, learning] = await Promise.all([
          fetchEstimateEditorData(resolvedVersionId),
          fetchSuggestionLearningState(resolvedVersionId).catch((error) => {
            console.error(
              "Impossible de charger les apprentissages de suggestions.",
              error
            );
            return EMPTY_SUGGESTION_LEARNING_STATE;
          }),
        ]);
        if (!active) return;

        let versionRow = data.version as EstimateVersionView;
        const itemsRows = data.items ?? [];
        const rolesData = data.laborRoles ?? [];

        const rateById = new Map<string, number>();
        rolesData.forEach((role) => {
          rateById.set(role.id, role.hourly_rate_cents);
        });

        const normalizedItems =
          versionRow.status === "draft"
            ? normalizeDraftItems({
                items: itemsRows,
                version: versionRow,
                rateById,
              })
            : itemsRows;

        const discountMode: DiscountMode =
          versionRow.discount_mode === "cascade" ? "cascade" : "simple";
        const cascadeDiscountSteps =
          discountMode === "cascade"
            ? normalizeCascadeDiscountSteps(versionRow.discount_steps)
            : [];
        const globalCoefficient = Number.isFinite(
          versionRow.global_coefficient ?? NaN
        )
          ? Math.max(versionRow.global_coefficient ?? 1, 0)
          : 1;
        const discountCents =
          versionRow.status === "draft"
            ? computeInitialDiscountCents(versionRow, itemsRows, rateById)
            : computeStoredDiscountCents(versionRow, itemsRows);

        const initialSettings = {
          title: versionRow.title ?? "",
          date_devis: versionRow.date_devis,
          validite_jours: versionRow.validite_jours,
          currency: resolveEstimateCurrency(versionRow.currency),
          margin_multiplier: versionRow.margin_multiplier,
          margin_mode: versionRow.margin_mode ?? "fixed",
          margin_tiers: data.marginTiers ?? [],
          discount_cents: discountCents,
          discount_mode: discountMode,
          discount_steps: cascadeDiscountSteps,
          global_coefficient: globalCoefficient,
          tax_rate_bp: versionRow.tax_rate_bp,
          rounding_mode: versionRow.rounding_mode,
          rounding_step_cents: versionRow.rounding_step_cents,
        };

        setVersion(versionRow);
        setItems(applyPendingBufferedUpdatesToItems(normalizedItems));
        setCategories(data.categories ?? []);
        setSupplyTypes(data.supplyTypes ?? []);
        setLaborRoles(rolesData);
        setSuggestionRules(data.suggestionRules ?? []);
        setSuggestionLearningState(learning);
        setSettings(initialSettings);
        setSavedSettings(initialSettings);
        setConflictState(null);

        if (versionRow.status === "draft") {
          const originalById = new Map(
            itemsRows.map((item) => [item.id, item])
          );
          const updates = normalizedItems.filter((item) => {
            if (item.item_type !== "line") return false;
            const original = originalById.get(item.id);
            if (!original) return false;
            return (
              original.tax_rate_bp !== item.tax_rate_bp ||
              original.k_fo !== item.k_fo ||
              original.h_mo !== item.h_mo ||
              original.h_mo_majoration !== item.h_mo_majoration ||
              original.k_mo !== item.k_mo ||
              original.supply_type_id !== item.supply_type_id ||
              LABOR_SPLIT_FIELD_KEYS.some(
                (key) =>
                  (original as unknown as Record<string, unknown>)[key] !==
                  (item as unknown as Record<string, unknown>)[key]
              ) ||
              original.pu_ht_cents !== item.pu_ht_cents ||
              original.line_total_ht_cents !== item.line_total_ht_cents ||
              original.line_tax_cents !== item.line_tax_cents ||
              original.line_total_ttc_cents !== item.line_total_ttc_cents
            );
          });

          if (updates.length > 0) {
            try {
              const bulkResult = await bulkUpdateEstimateItems(
                resolvedVersionId,
                versionRow.updated_at,
                updates.map((item) => ({
                  id: item.id,
                updates: {
                  tax_rate_bp: item.tax_rate_bp,
                  k_fo: item.k_fo,
                  h_mo: item.h_mo,
                  h_mo_majoration: item.h_mo_majoration,
                  k_mo: item.k_mo,
                  supply_type_id: item.supply_type_id,
                  ...(isLaborSplitEnabled || hasLaborSplitFields(item)
                    ? (readLaborSplitFields(item) as LaborSplitItemFields)
                    : {}),
                  pu_ht_cents: item.pu_ht_cents,
                  line_total_ht_cents: item.line_total_ht_cents,
                  line_tax_cents: item.line_tax_cents,
                  line_total_ttc_cents: item.line_total_ttc_cents,
                },
                }))
              );

              versionRow = {
                ...versionRow,
                updated_at: bulkResult.versionToken.updated_at,
              };
              if (active) {
                setVersion((prev) =>
                  prev
                    ? {
                        ...prev,
                        updated_at: bulkResult.versionToken.updated_at,
                      }
                    : prev
                );
              }
            } catch (error) {
              if (active) {
                if (!registerVersionConflict(error)) {
                  setActionError("Impossible de mettre a jour les lignes.");
                } else {
                  setIsReloadingVersion(true);
                  setReloadNonce((prev) => prev + 1);
                }
              }
            }
          }
        }
      } catch (error) {
        if (!active) return;
        const message =
          error instanceof Error
            ? resolveEstimateActionError(error.message)
            : "Impossible de charger le chiffrage.";
        setLoadError(message);
      } finally {
        if (active) {
          setIsLoading(false);
          setIsReloadingVersion(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [
    applyPendingBufferedUpdatesToItems,
    isLaborSplitEnabled,
    registerVersionConflict,
    reloadNonce,
    resolvedVersionId,
  ]);

  useEffect(() => {
    const projectId = version?.project_id ?? null;
    if (!projectId) {
      setLinkedDpgfSource(null);
      setIsLoadingLinkedDpgfSource(false);
      return;
    }
    const targetProjectId = projectId;

    let active = true;
    setIsLoadingLinkedDpgfSource(true);

    async function loadLinkedDpgfSource() {
      try {
        const source = await fetchAffaireLinkedDpgfSource(targetProjectId);
        if (!active) return;
        setLinkedDpgfSource(source);
      } catch (error) {
        if (!active) return;
        console.error("Impossible de charger la source DPGF liee.", error);
        setLinkedDpgfSource(null);
      } finally {
        if (active) {
          setIsLoadingLinkedDpgfSource(false);
        }
      }
    }

    void loadLinkedDpgfSource();

    return () => {
      active = false;
    };
  }, [version?.project_id]);

  useEffect(() => {
    if (!resolvedVersionId) {
      setDismissedOutlierFlagsByItemId({});
      setOutlierActionPendingByItemId({});
      return;
    }

    let active = true;

    async function loadDismissedOutliers() {
      try {
        const dismissed = await fetchEstimateOutlierDismissedFlags(resolvedVersionId);
        if (!active) return;
        setDismissedOutlierFlagsByItemId(dismissed);
      } catch {
        if (!active) return;
        setDismissedOutlierFlagsByItemId({});
      }
    }

    void loadDismissedOutliers();

    return () => {
      active = false;
    };
  }, [reloadNonce, resolvedVersionId]);

  useEffect(() => {
    if (!version || version.status !== "draft") {
      setSendGating(null);
      return;
    }
    const currentVersionId = version.id;

    let active = true;

    async function loadSendGating() {
      try {
        const gating = await fetchEstimateSendGating(currentVersionId);
        if (!active) return;
        setSendGating(gating);
      } catch {
        if (!active) return;
        setSendGating(null);
      }
    }

    void loadSendGating();

    return () => {
      active = false;
    };
  }, [reloadNonce, version]);

  useEffect(() => {
    if (!resolvedVersionId) {
      setSectionDuplicateTargets([]);
      return;
    }

    let active = true;

    async function loadSectionDuplicateTargets() {
      try {
        const targets = await fetchEstimateDraftVersions(resolvedVersionId);
        if (!active) return;

        setSectionDuplicateTargets(
          targets.map((target) => ({
            versionId: target.id,
            label: formatSectionDuplicateTargetLabel({
              versionNumber: target.versionNumber,
              title: target.title,
            }),
          }))
        );
      } catch {
        if (!active) return;
        setSectionDuplicateTargets([]);
      }
    }

    void loadSectionDuplicateTargets();

    return () => {
      active = false;
    };
  }, [reloadNonce, resolvedVersionId]);

  const {
    holderName: draftLockHolderName,
    isOwnedByCurrentUser: isDraftLockOwnedByCurrentUser,
    isLockedByOther: isDraftLockedByOther,
    isAcquiring: isDraftLockAcquiring,
    isForcingUnlock: isForcingDraftUnlock,
    error: draftLockError,
    release: releaseDraftLock,
    forceUnlockAndAcquire: forceUnlockAndAcquireDraftLock,
  } = useDraftLock({
    versionId: resolvedVersionId,
    enabled: Boolean(resolvedVersionId && version?.status === "draft"),
    currentUserId: profile?.id ?? null,
  });

  const projectName = getProjectName(version?.estimate_projects ?? null);
  const isAdmin = profile?.role === "admin";
  const isViewerReadOnly = profile?.tenant_role === "viewer";
  const lockHolderLabel = draftLockHolderName ?? "un autre utilisateur";
  const isStatusReadOnly = version ? version.status !== "draft" : false;
  const isDraftLockPending =
    version?.status === "draft" &&
    !isDraftLockedByOther &&
    !isDraftLockOwnedByCurrentUser;
  const isReadOnly =
    isStatusReadOnly || isDraftLockedByOther || isDraftLockPending || isViewerReadOnly;
  const isConflictLocked = conflictState !== null;
  const isSaveBlocked = isReadOnly || isConflictLocked;
  const readOnlyActionErrorMessage =
    isViewerReadOnly
      ? "Mode consultation active."
      : isDraftLockPending && !isDraftLockedByOther
      ? "Acquisition du verrou de brouillon en cours."
      : isDraftLockedByOther
        ? `Verrouille par ${lockHolderLabel}.`
        : "Cette version est en lecture seule.";
  const canSend = version?.status === "draft" && !isViewerReadOnly;
  const hasKnownBlockingSendFlags = (sendGating?.blockingFlags.length ?? 0) > 0;
  const isSendBlockedForCurrentUser =
    sendGating !== null && !sendGating.canSend && hasKnownBlockingSendFlags && !isAdmin;
  const sendWorkflowPhaseLabel =
    sendWorkflowPhase === "verification"
      ? "Verification..."
      : sendWorkflowPhase === "pdf"
        ? "Generation PDF..."
        : sendWorkflowPhase === "sealing"
          ? "Scellement..."
          : null;
  const canAccept = version?.status === "sent";
  const canArchive = version?.status !== "archived";

  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  useEffect(() => {
    isSaveBlockedRef.current = isSaveBlocked;
  }, [isSaveBlocked]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingBufferedUpdates) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasPendingBufferedUpdates]);
  const editorTableBaseConfig = useMemo(
    () => ({
      marginMultiplier: settings?.margin_multiplier ?? 1,
      discountCents: settings?.discount_cents ?? 0,
      taxRateBp: settings?.tax_rate_bp ?? 0,
      isReadOnly: isReadOnly || isConflictLocked,
    }),
    [
      isConflictLocked,
      isReadOnly,
      settings?.discount_cents,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );
  const editorTableVirtualization = useMemo<EstimateEditorVirtualizationConfig>(() => {
    const runtimeConfig = resolveEstimateEditorVirtualizationRuntimeConfig({
      baseConfig: ESTIMATE_EDITOR_VIRTUALIZATION_ENV_CONFIG,
      modeFlag: {
        enabled: isVirtualizationModeFlagEnabled,
        value: virtualizationModeFlagValue,
      },
      autoThresholdFlag: {
        value: virtualizationAutoThresholdFlagValue,
      },
    });
    const enabled = isEstimateEditorVirtualizationEnabled(runtimeConfig, items.length);

    return {
      enabled,
      rowEstimate: runtimeConfig.rowEstimate,
      overscan: runtimeConfig.overscan,
      ...(runtimeConfig.maxHeight !== undefined
        ? { maxHeight: runtimeConfig.maxHeight }
        : {}),
    };
  }, [
    isVirtualizationModeFlagEnabled,
    items.length,
    virtualizationAutoThresholdFlagValue,
    virtualizationModeFlagValue,
  ]);
  const handleQualityFilterChange = useCallback(
    (nextFilter: EstimateQualityFilter) => {
      startTransition(() => {
        setQualityFilter(nextFilter);
      });
    },
    []
  );
  const handleOutlierMethodChange = useCallback((nextMethod: EstimateOutlierMethod) => {
    startTransition(() => {
      setOutlierConfig((previous) => ({
        ...previous,
        method: nextMethod,
      }));
    });
  }, []);
  const handleOutlierThresholdChange = useCallback((nextThreshold: number) => {
    if (!Number.isFinite(nextThreshold) || nextThreshold <= 0) return;
    startTransition(() => {
      setOutlierConfig((previous) => ({
        ...previous,
        threshold: nextThreshold,
      }));
    });
  }, []);
  const handleOpenSettingsDrawer = useCallback((section?: SettingsSection) => {
    setIsSettingsDrawerOpen(true);
    setDrawerScrollTarget(section ?? null);
  }, []);
  const drawerScrollTargetRef = useRef<SettingsSection | null>(null);
  useEffect(() => {
    drawerScrollTargetRef.current = drawerScrollTarget;
  }, [drawerScrollTarget]);
  useEffect(() => {
    if (!isSettingsDrawerOpen) return;
    const target = drawerScrollTargetRef.current;
    if (!target) return;
    drawerScrollTargetRef.current = null;
    setDrawerScrollTarget(null);
    const sectionIdMap: Record<SettingsSection, string> = {
      margin: "estimate-margin",
      discount: "estimate-discount",
      tax: "estimate-tax",
      rounding: "estimate-rounding",
      general: "estimate-project-name",
    };
    const targetId = sectionIdMap[target];
    const scrollToTarget = () => {
      const el = document.getElementById(targetId);
      if (!el) return;
      let scrollable: HTMLElement | null = el.parentElement;
      while (scrollable) {
        const ov = getComputedStyle(scrollable).overflowY;
        if (ov === "auto" || ov === "scroll") break;
        scrollable = scrollable.parentElement;
      }
      if (scrollable) {
        const containerRect = scrollable.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + scrollable.scrollTop - containerRect.height / 2;
        scrollable.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      }
    };
    // Retry at increasing delays to handle drawer animation and async renders
    const delays = [50, 150, 350];
    const timers = delays.map((delay) => setTimeout(scrollToTarget, delay));
    return () => timers.forEach(clearTimeout);
  }, [isSettingsDrawerOpen]);
  const handleChecklistCriterionClick = useCallback(
    (criterion: EstimateChecklistCriterion) => {
      if (!criterion.targetItemId) {
        handleOpenSettingsDrawer();
        return;
      }
      const qualityFlag = criterion.qualityFlag;
      if (qualityFlag) {
        // Keep this update urgent so checklist navigation scrolls on the same
        // render where filtered rows include the target item.
        setQualityFilter(qualityFlag);
      }
      setChecklistScrollTargetItemId(criterion.targetItemId);
    },
    [handleOpenSettingsDrawer]
  );
  const handleChecklistScrollHandled = useCallback(() => {
    setChecklistScrollTargetItemId(null);
  }, []);
  const persistConflictDraft = useCallback(() => {
    if (!resolvedVersionId) return;

    const draft: EstimateConflictDraft = {
      settings,
      items,
      saved_at: new Date().toISOString(),
    };

    writeConflictDraftToSession(resolvedVersionId, draft);
    setRestorableDraft(draft);
  }, [items, resolvedVersionId, settings]);

  const clearBufferedItemUpdates = useCallback((options?: { clearPersisted?: boolean }) => {
    pendingItemUpdatesRef.current.clear();
    pendingBufferedUpdateCountRef.current = 0;
    setHasPendingBufferedUpdates(false);
    if (options?.clearPersisted && resolvedVersionId) {
      clearAutoSaveDraftFromLocal(resolvedVersionId);
    }
  }, [resolvedVersionId]);

  const persistBufferedItemUpdatesToLocal = useCallback(() => {
    if (!resolvedVersionId) return;

    const bufferedEntries = serializeBufferedUpdates(pendingItemUpdatesRef.current);
    writeAutoSaveDraftToLocal(
      resolvedVersionId,
      bufferedEntries.map((entry) => ({
        id: entry.id,
        updates: entry.updates,
      }))
    );
  }, [resolvedVersionId]);

  useEffect(() => {
    if (!resolvedVersionId) return;

    const draft = readAutoSaveDraftFromLocal(resolvedVersionId);
    if (!draft) return;

    const rehydration = rehydrateBufferedUpdates(
      itemsRef.current,
      draft.buffered_updates,
      pendingItemUpdatesRef.current
    );
    pendingBufferedUpdateCountRef.current = rehydration.pendingUpdateCount;
    const hasPendingUpdates = rehydration.hasPendingUpdates;
    setHasPendingBufferedUpdates(hasPendingUpdates);
    setItems(rehydration.mergedItems);

    if (hasPendingUpdates) {
      setTotalsOutOfSync(true);
      setActionError(
        "Des modifications locales ont ete recuperees et seront re-sauvegardees automatiquement."
      );
    }
  }, [resolvedVersionId]);

  const triggerVersionReload = useCallback(() => {
    if (!resolvedVersionId) return;
    setIsReloadingVersion(true);
    setReloadNonce((prev) => prev + 1);
  }, [resolvedVersionId]);

  const handleVersionConflict = useCallback(
    (error: unknown, options?: { persistDraft?: boolean }) => {
      if (!registerVersionConflict(error)) return false;
      if (options?.persistDraft) {
        persistConflictDraft();
      }
      clearBufferedItemUpdates({ clearPersisted: true });
      triggerVersionReload();
      return true;
    },
    [
      clearBufferedItemUpdates,
      persistConflictDraft,
      registerVersionConflict,
      triggerVersionReload,
    ]
  );

  const handleReloadAfterConflict = useCallback(() => {
    if (!resolvedVersionId) return;

    persistConflictDraft();
    setConflictState(null);
    setActionError(null);
    triggerVersionReload();
  }, [persistConflictDraft, resolvedVersionId, triggerVersionReload]);

  const handleForceUnlockDraftLock = useCallback(async () => {
    setActionError(null);

    const acquired = await forceUnlockAndAcquireDraftLock();
    if (!acquired) {
      setActionError(
        draftLockError ??
          "Impossible de forcer le deverrouillage de cette version."
      );
      return;
    }

    setConflictState(null);
    triggerVersionReload();
  }, [draftLockError, forceUnlockAndAcquireDraftLock, triggerVersionReload]);

  const handleRestoreConflictDraft = useCallback(() => {
    if (!restorableDraft) return;

    if (restorableDraft.settings) {
      setSettings({
        ...restorableDraft.settings,
        currency: resolveEstimateCurrency(
          (restorableDraft.settings as { currency?: string | null }).currency
        ),
      });
    }
    setItems(restorableDraft.items);
    clearConflictDraftFromSession(resolvedVersionId);
    setRestorableDraft(null);
    setActionError(
      "Modifications locales restaurees. Pensez a enregistrer le parametrage."
    );
  }, [resolvedVersionId, restorableDraft]);

  const loadAuditLogs = useCallback(
    async (signal?: AbortSignal) => {
      if (!resolvedVersionId || !isAdmin) return;

      setIsAuditLoading(true);
      setAuditError(null);

      try {
        const response = await fetch(
          `/api/audit?estimate_version_id=${encodeURIComponent(
            resolvedVersionId
          )}&limit=${AUDIT_LOG_LIMIT}`,
          {
            credentials: "same-origin",
            signal,
          }
        );

        const payload = (await response.json().catch(() => null)) as unknown;

        if (!response.ok) {
          throw new Error(
            resolveAuditErrorMessage(
              payload,
              "Impossible de charger les logs d'audit."
            )
          );
        }

        setAuditLogs(normalizeAuditLogs(payload));
      } catch (error) {
        if (signal?.aborted) return;
        setAuditError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les logs d'audit."
        );
        setAuditLogs([]);
      } finally {
        if (!signal?.aborted) {
          setIsAuditLoading(false);
        }
      }
    },
    [isAdmin, resolvedVersionId]
  );

  const loadTimelineEvents = useCallback(
    async (signal?: AbortSignal) => {
      if (!resolvedVersionId || !isAdmin) return;

      setIsTimelineLoading(true);
      setTimelineError(null);

      try {
        const events = await fetchEstimateVersionEvents(resolvedVersionId);
        if (signal?.aborted) return;
        setTimelineEvents(events);
      } catch (error) {
        if (signal?.aborted) return;
        setTimelineError(
          error instanceof Error
            ? error.message
            : "Impossible de charger la timeline des evenements."
        );
        setTimelineEvents([]);
      } finally {
        if (!signal?.aborted) {
          setIsTimelineLoading(false);
        }
      }
    },
    [isAdmin, resolvedVersionId]
  );

  useEffect(() => {
    if (!isAdmin || !resolvedVersionId) {
      setAuditLogs([]);
      setAuditError(null);
      setIsAuditLoading(false);
      return;
    }

    const abortController = new AbortController();
    void loadAuditLogs(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [isAdmin, loadAuditLogs, resolvedVersionId]);

  useEffect(() => {
    if (!isAdmin || !resolvedVersionId) {
      setTimelineEvents([]);
      setTimelineError(null);
      setIsTimelineLoading(false);
      return;
    }

    const abortController = new AbortController();
    void loadTimelineEvents(abortController.signal);

    return () => {
      abortController.abort();
    };
  }, [isAdmin, loadTimelineEvents, resolvedVersionId]);

  const laborRateById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "default"));
    });
    return map;
  }, [laborRoles]);

  const laborRateAtelierById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "atelier"));
    });
    return map;
  }, [laborRoles]);

  const laborRateChantierById = useMemo(() => {
    const map = new Map<string, number>();
    laborRoles.forEach((role) => {
      map.set(role.id, resolveLaborRoleHourlyRate(role, "chantier"));
    });
    return map;
  }, [laborRoles]);

  const supplyTypeById = useMemo(() => {
    const map = new Map<string, SupplyType>();
    supplyTypes.forEach((supplyType) => {
      map.set(supplyType.id, supplyType);
    });
    return map;
  }, [supplyTypes]);

  const supplyTypeIdByLowerName = useMemo(() => {
    const map = new Map<string, string>();
    supplyTypes.forEach((supplyType) => {
      const normalizedName = supplyType.name.trim().toLowerCase();
      if (!normalizedName) return;
      if (!map.has(normalizedName)) {
        map.set(normalizedName, supplyType.id);
      }
    });
    return map;
  }, [supplyTypes]);

  const laborRoleById = useMemo(() => {
    const map = new Map<string, LaborRole>();
    laborRoles.forEach((role) => {
      map.set(role.id, role);
    });
    return map;
  }, [laborRoles]);

  const deferredItems = useDeferredValue(items);

  const bulkSuggestPreview = useMemo(
    () =>
      buildBulkSuggestPreview({
        items: deferredItems,
        suggestionRules,
        categories,
      }),
    [categories, deferredItems, suggestionRules]
  );

  const bulkSuggestionEligibleCount = bulkSuggestPreview.length;

  const detectedOutlierFlagsByItemId = useMemo(
    () =>
      detectEstimateOutliers({
        items: deferredItems,
        categories,
        config: outlierConfig,
      }),
    [categories, deferredItems, outlierConfig]
  );

  const qualityFlagsByItemId = useMemo(
    () =>
      computeEstimateQualityFlagsByItemId(deferredItems, {
        outlierFlagsByItemId: detectedOutlierFlagsByItemId,
        dismissedOutlierFlagsByItemId,
      }),
    [deferredItems, detectedOutlierFlagsByItemId, dismissedOutlierFlagsByItemId]
  );

  const qualityCounts = useMemo(
    () => countEstimateQualityFlags(qualityFlagsByItemId),
    [qualityFlagsByItemId]
  );

  const checklist = useMemo(
    () =>
      computeEstimateChecklist({
        items: deferredItems,
        qualityFlagsByItemId,
        settings,
      }),
    [deferredItems, qualityFlagsByItemId, settings]
  );

  const buildLineCalculationInput = useCallback(
    (
      item: EstimateItem,
      options?: {
        taxRateBp?: number;
        rateOverrideByRoleId?: string;
        hourlyRateCents?: number;
        hourlyRateAtelierCents?: number;
        hourlyRateChantierCents?: number;
      }
    ) => {
      const splitFields = readLaborSplitFields(item);
      const taxRate = options?.taxRateBp ?? item.tax_rate_bp ?? 0;
      const kFo = item.k_fo ?? 1;
      const hMo = item.h_mo ?? 0;
      const hMoMajoration = item.h_mo_majoration ?? 1;
      const kMo = item.k_mo ?? 1;
      const overrideRoleId = options?.rateOverrideByRoleId;

      const resolveRate = (
        roleId: string | null | undefined,
        map: Map<string, number>,
        overrideRate: number | undefined
      ) => {
        if (!roleId) return 0;
        if (overrideRoleId && roleId === overrideRoleId) {
          return Math.max(toFiniteNumber(overrideRate, 0), 0);
        }
        return map.get(roleId) ?? 0;
      };

      const hourlyRate = resolveRate(
        item.labor_role_id,
        laborRateById,
        options?.hourlyRateCents
      );
      const hourlyRateAtelier = resolveRate(
        splitFields.labor_role_atelier_id,
        laborRateAtelierById,
        options?.hourlyRateAtelierCents ?? options?.hourlyRateCents
      );
      const hourlyRateChantier = resolveRate(
        splitFields.labor_role_chantier_id,
        laborRateChantierById,
        options?.hourlyRateChantierCents ?? options?.hourlyRateCents
      );

      return {
        ...item,
        tax_rate_bp: taxRate,
        k_fo: kFo,
        h_mo: hMo,
        h_mo_majoration: hMoMajoration,
        k_mo: kMo,
        ...splitFields,
        labor_role_hourly_rate_cents: hourlyRate,
        labor_role_atelier_hourly_rate_cents: hourlyRateAtelier,
        labor_role_chantier_hourly_rate_cents: hourlyRateChantier,
      };
    },
    [laborRateAtelierById, laborRateById, laborRateChantierById]
  );

  const computeLineValuesWithLaborContext = useCallback(
    (
      item: EstimateItem,
      options: {
        marginMultiplier: number;
        taxRateBp: number;
        rateOverrideByRoleId?: string;
        hourlyRateCents?: number;
        hourlyRateAtelierCents?: number;
        hourlyRateChantierCents?: number;
      }
    ) => {
      const lineInput = buildLineCalculationInput(item, {
        taxRateBp: options.taxRateBp,
        rateOverrideByRoleId: options.rateOverrideByRoleId,
        hourlyRateCents: options.hourlyRateCents,
        hourlyRateAtelierCents: options.hourlyRateAtelierCents,
        hourlyRateChantierCents: options.hourlyRateChantierCents,
      });
      const lineComputationOptions = {
        marginMultiplier: options.marginMultiplier,
        taxRateBp: options.taxRateBp,
        isLaborSplitEnabled,
      };
      return {
        lineInput,
        lineValues: computeEstimateLineValues(lineInput, lineComputationOptions),
      };
    },
    [buildLineCalculationInput, isLaborSplitEnabled]
  );

  const totals: EstimateTotals | null = useMemo(() => {
    if (!settings) return null;
    if (isReadOnly && version) {
      const readOnlyVersion = {
        ...version,
        discount_mode: settings.discount_mode ?? version.discount_mode,
        discount_steps: settings.discount_steps ?? version.discount_steps,
        global_coefficient:
          settings.global_coefficient ?? version.global_coefficient,
      };
      const readOnlyTotalsInput = {
        items,
        version: readOnlyVersion,
        discountCents: settings.discount_cents,
        laborRateById,
        isLaborSplitEnabled,
        laborRateAtelierById,
        laborRateChantierById,
      };
      return computeReadOnlyTotals(readOnlyTotalsInput);
    }
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => buildLineCalculationInput(item));
    const totalsInput = {
      lineItems,
      marginMultiplier: settings.margin_multiplier,
      marginMode: settings.margin_mode,
      marginTiers: settings.margin_tiers,
      discountCents: settings.discount_cents,
      discountMode: settings.discount_mode,
      discountStepsBp: settings.discount_steps,
      globalCoefficient: settings.global_coefficient,
      taxRateBp: settings.tax_rate_bp,
      roundingMode: settings.rounding_mode,
      roundingStepCents: settings.rounding_step_cents,
      isLaborSplitEnabled,
    };
    return computeEstimateTotals(totalsInput);
  }, [
    buildLineCalculationInput,
    isLaborSplitEnabled,
    isReadOnly,
    items,
    laborRateAtelierById,
    laborRateById,
    laborRateChantierById,
    settings,
    version,
  ]);

  const buildExportFilename = useCallback(() => {
    const dateLabel = new Date().toISOString().split("T")[0];
    const namePart = projectName.trim() || "chiffrage";
    const versionLabel = version ? `V${version.version_number}` : "";
    const raw = [namePart, versionLabel, dateLabel].filter(Boolean).join("_");
    const sanitized = sanitizeFilename(raw);
    return sanitized || `chiffrage_${dateLabel}`;
  }, [projectName, version]);

  const buildRecapRow = useCallback((): EstimateRecapExportRow | null => {
    if (!version || !settings || !totals) return null;
    const discountBase = totals.saleSubtotalCents;
    const discountBp =
      discountBase > 0
        ? Math.round((totals.discountCents / discountBase) * 10000)
        : 0;

    return {
      project_name: projectName || "Chiffrage",
      version_id: version.id,
      version_number: version.version_number,
      status: version.status,
      date_devis: settings.date_devis,
      validite_jours: settings.validite_jours,
      margin_multiplier: totals.appliedMarginMultiplier,
      discount_cents: totals.discountCents,
      discount_bp: discountBp,
      tax_rate_bp: settings.tax_rate_bp,
      rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents,
      sale_subtotal_cents: totals.saleSubtotalCents,
      sale_total_cents: totals.saleTotalCents,
      tax_cents: totals.adjustedTaxCents,
      ttc_cents: totals.roundedTtcCents,
      quality_lines_count: qualityCounts.linesWithAnomaliesCount,
      quality_flags_count: qualityCounts.totalFlagsCount,
    };
  }, [projectName, qualityCounts, settings, totals, version]);

  const fetchSupplierComparisonsByItemId = useCallback(async () => {
    const lineItemIds = Array.from(
      new Set(
        items
      .filter((item) => item.item_type === "line")
          .map((item) => item.id)
      )
    );

    if (!resolvedVersionId || lineItemIds.length === 0) {
      return new Map<string, SupplierComparisonAlternative[]>();
    }

    const requestChunkSize = 200;
    const resultMap: SupplierComparisonsByItemId = new Map();
    let hadRequestError = false;

    for (
      let startIndex = 0;
      startIndex < lineItemIds.length;
      startIndex += requestChunkSize
    ) {
      const chunk = lineItemIds.slice(startIndex, startIndex + requestChunkSize);

      try {
        const response = await fetch(
          `/api/estimates/${resolvedVersionId}/supplier-comparisons`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              item_ids: chunk,
            }),
          }
        );

        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          hadRequestError = true;
          console.error(
            "Erreur lors du chargement des comparaisons fournisseur pour l'export.",
            {
              status: response.status,
              payload,
              chunk_size: chunk.length,
            }
          );
          continue;
        }

        const chunkMap = normalizeSupplierComparisonsByItemId(payload);
        chunkMap.forEach((alternatives, itemId) => {
          resultMap.set(itemId, alternatives);
        });
      } catch (error) {
        hadRequestError = true;
        console.error(
          "Erreur lors du chargement des comparaisons fournisseur pour l'export.",
          error
        );
      }
    }

    if (hadRequestError) {
      setActionError(
        "Certaines comparaisons fournisseurs n'ont pas pu etre chargees pour l'export."
      );
    }

    return resultMap;
  }, [items, resolvedVersionId]);

  const buildLineRows = useCallback(
    (
      supplierComparisonsByItemId?: SupplierComparisonsByItemId
    ): EstimateLineExportRow[] => {
      const estimateCurrency = settings?.currency ?? DEFAULT_ESTIMATE_CURRENCY;
      const resolveSectionPath = buildSectionPathResolver(items);
      const comparisonsByItemId =
        supplierComparisonsByItemId ?? new Map<string, SupplierComparisonAlternative[]>();

      return items
        .filter((item) => item.item_type === "line")
        .map((item) => {
          const splitFields = readLaborSplitFields(item);
          const supplyTypeLabel = item.supply_type_id
            ? supplyTypeById.get(item.supply_type_id)?.name ?? ""
            : "";
          const laborLabel = item.labor_role_id
            ? laborRoleById.get(item.labor_role_id)?.name ?? ""
            : "";
          const laborAtelierLabel = splitFields.labor_role_atelier_id
            ? laborRoleById.get(splitFields.labor_role_atelier_id)?.name ?? ""
            : "";
          const laborChantierLabel = splitFields.labor_role_chantier_id
            ? laborRoleById.get(splitFields.labor_role_chantier_id)?.name ?? ""
            : "";
          const qualityFlagsLabel = (qualityFlagsByItemId[item.id] ?? [])
            .map((flag) => ESTIMATE_QUALITY_FLAG_META[flag].label)
            .join(" | ");
          const supplierAlternatives = comparisonsByItemId.get(item.id) ?? [];

          return {
            section_path: resolveSectionPath(item),
            designation: resolveItemTitle(item.title, "Sans titre"),
            quality_flags: qualityFlagsLabel,
            unit: item.description?.trim() ?? "",
            quantity: item.quantity ?? "",
            unit_price_ht_cents: item.unit_price_ht_cents ?? "",
            supply_type: supplyTypeLabel,
            supplier_1: formatSupplierAlternativeCompact(
              supplierAlternatives[0],
              estimateCurrency
            ),
            supplier_2: formatSupplierAlternativeCompact(
              supplierAlternatives[1],
              estimateCurrency
            ),
            supplier_3: formatSupplierAlternativeCompact(
              supplierAlternatives[2],
              estimateCurrency
            ),
            k_fo: item.k_fo ?? "",
            h_mo: item.h_mo ?? "",
            h_mo_majoration_pct:
              item.h_mo_majoration === null || item.h_mo_majoration === undefined
                ? ""
                : Math.round(item.h_mo_majoration * 10000) / 100,
            labor_role: laborLabel,
            k_mo: item.k_mo ?? "",
            h_mo_atelier: splitFields.h_mo_atelier ?? "",
            labor_role_atelier: laborAtelierLabel,
            k_mo_atelier: splitFields.k_mo_atelier ?? "",
            h_mo_chantier: splitFields.h_mo_chantier ?? "",
            labor_role_chantier: laborChantierLabel,
            k_mo_chantier: splitFields.k_mo_chantier ?? "",
            pu_ht_cents: item.pu_ht_cents ?? "",
            line_total_ht_cents: item.line_total_ht_cents ?? "",
            tax_rate_bp: item.tax_rate_bp ?? "",
            line_total_ttc_cents: item.line_total_ttc_cents ?? "",
          };
        });
    },
    [items, laborRoleById, qualityFlagsByItemId, settings?.currency, supplyTypeById]
  );

  const lineExportColumns = useMemo(
    () =>
      isLaborSplitEnabled
        ? LINE_EXPORT_COLUMNS_WITH_LABOR_SPLIT
        : LINE_EXPORT_COLUMNS,
    [isLaborSplitEnabled]
  );

  let exportLoadingLabel = "Export XLSX...";
  if (activeExportMode === "dpgf") {
    exportLoadingLabel = "Export DPGF...";
  } else if (activeExportMode === "bdc") {
    exportLoadingLabel = "Export BDC V1.1...";
  } else if (activeExportMode === "csv") {
    exportLoadingLabel = "Export CSV...";
  }

  const runStreamingExport = useCallback(
    async (options: {
      mode: EstimateExportMode;
      includeModeQueryParam: boolean;
      logMessage: string;
      fallbackMessage: string;
    }) => {
      if (isExporting || !resolvedVersionId) return;

      setIsExporting(true);
      setActiveExportMode(options.mode);
      try {
        if (options.includeModeQueryParam) {
          await exportEstimate(resolvedVersionId, "xlsx", {
            mode: options.mode,
          });
        } else {
          await exportEstimate(resolvedVersionId, "xlsx");
        }
      } catch (error) {
        console.error(options.logMessage, error);
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : options.fallbackMessage
          )
        );
      } finally {
        setIsExporting(false);
        setActiveExportMode(null);
      }
    },
    [isExporting, resolvedVersionId]
  );

  const handleExportExcel = useCallback(async () => {
    await runStreamingExport({
      mode: "standard",
      includeModeQueryParam: false,
      logMessage: "Erreur lors de l'export Excel streaming.",
      fallbackMessage: "Impossible d'exporter le devis en Excel.",
    });
  }, [runStreamingExport]);

  const handleExportDpgf = useCallback(async () => {
    await runStreamingExport({
      mode: "dpgf",
      includeModeQueryParam: true,
      logMessage: "Erreur lors de l'export DPGF streaming.",
      fallbackMessage: "Impossible d'exporter le DPGF.",
    });
  }, [runStreamingExport]);

  const handleExportBdc = useCallback(async () => {
    await runStreamingExport({
      mode: "bdc",
      includeModeQueryParam: true,
      logMessage: "Erreur lors de l'export BDC V1.1 streaming.",
      fallbackMessage: "Impossible d'exporter le BDC V1.1.",
    });
  }, [runStreamingExport]);

  const handleExportCSV = useCallback(async () => {
    if (isExporting) return;
    const recapRow = buildRecapRow();
    if (!recapRow) return;

    setIsExporting(true);
    setActiveExportMode("csv");
    try {
      const supplierComparisonsByItemId =
        await fetchSupplierComparisonsByItemId();
      const lines = buildLineRows(supplierComparisonsByItemId);
      const filename = buildExportFilename();
      exportToCSV(lines, lineExportColumns, { filename });
    } catch (error) {
      console.error("Erreur lors de l'export CSV.", error);
    } finally {
      setIsExporting(false);
      setActiveExportMode(null);
    }
  }, [
    buildExportFilename,
    buildLineRows,
    buildRecapRow,
    fetchSupplierComparisonsByItemId,
    isExporting,
    lineExportColumns,
  ]);

  const isExportDisabled = isExporting || !version || !settings || !totals;
  const hasLinkedDpgfSource = hasImportableLinkedDpgfSource(linkedDpgfSource);
  const isImportDpgfSourceDisabled =
    !hasLinkedDpgfSource ||
    isLoadingLinkedDpgfSource ||
    isImportingDpgfSource ||
    isSaveBlocked ||
    isExporting;

  const persistedTotals: EstimateTotals | null = useMemo(() => {
    if (!savedSettings) return null;
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => buildLineCalculationInput(item));
    const totalsInput = {
      lineItems,
      marginMultiplier: savedSettings.margin_multiplier,
      marginMode: savedSettings.margin_mode,
      marginTiers: savedSettings.margin_tiers,
      discountCents: savedSettings.discount_cents,
      discountMode: savedSettings.discount_mode,
      discountStepsBp: savedSettings.discount_steps,
      globalCoefficient: savedSettings.global_coefficient,
      taxRateBp: savedSettings.tax_rate_bp,
      roundingMode: savedSettings.rounding_mode,
      roundingStepCents: savedSettings.rounding_step_cents,
      isLaborSplitEnabled,
    };
    return computeEstimateTotals(totalsInput);
  }, [buildLineCalculationInput, isLaborSplitEnabled, items, savedSettings]);

  useEffect(() => {
    persistedTotalsRef.current = persistedTotals;
  }, [persistedTotals]);

  const selectedBulkSuggestPreview = useMemo(() => {
    if (selectedBulkSuggestItemIds.length === 0) {
      return [] as BulkSuggestPreviewItem[];
    }

    const selectedIdSet = new Set(selectedBulkSuggestItemIds);
    return bulkSuggestPreview.filter((previewItem) =>
      selectedIdSet.has(previewItem.itemId)
    );
  }, [bulkSuggestPreview, selectedBulkSuggestItemIds]);

  const showBulkSuggestProgress = useMemo(() => {
    const progressTotal = bulkSuggestProgress?.total ?? selectedBulkSuggestPreview.length;
    return progressTotal > BULK_SUGGEST_PROGRESS_THRESHOLD;
  }, [bulkSuggestProgress, selectedBulkSuggestPreview.length]);

  useEffect(() => {
    setSelectedBulkSuggestItemIds((previous) => {
      if (previous.length === 0) return previous;

      const eligibleItemIds = new Set(
        bulkSuggestPreview.map((previewItem) => previewItem.itemId)
      );
      const next = previous.filter((itemId) => eligibleItemIds.has(itemId));
      return next.length === previous.length ? previous : next;
    });
  }, [bulkSuggestPreview]);

  useEffect(() => {
    setBulkSuggestUndoState((previous) => {
      if (!previous) return previous;

      const lineItemIds = new Set(
        items
          .filter((item) => item.item_type === "line")
          .map((item) => item.id)
      );
      const stillValid = previous.previousItems.filter((item) =>
        lineItemIds.has(item.id)
      );
      if (stillValid.length === previous.previousItems.length) {
        return previous;
      }
      if (stillValid.length === 0) {
        return null;
      }
      return {
        previousItems: stillValid,
        appliedItemIds: stillValid.map((item) => item.id),
      };
    });
  }, [items]);

  const handleOpenBulkSuggestDialog = useCallback(() => {
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }

    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }

    if (bulkSuggestPreview.length === 0) return;

    setActionError(null);
    setBulkSuggestDialogError(null);
    setBulkSuggestProgress(null);
    setSelectedBulkSuggestItemIds(
      bulkSuggestPreview.map((previewItem) => previewItem.itemId)
    );
    setIsBulkSuggestDialogOpen(true);
  }, [
    bulkSuggestPreview,
    conflictState?.message,
    isConflictLocked,
    isReadOnly,
    readOnlyActionErrorMessage,
  ]);

  const handleCloseBulkSuggestDialog = useCallback(() => {
    if (isApplyingBulkSuggest) return;
    setIsBulkSuggestDialogOpen(false);
    setBulkSuggestDialogError(null);
    setBulkSuggestProgress(null);
  }, [isApplyingBulkSuggest]);

  const handleToggleBulkSuggestItem = useCallback(
    (itemId: string, checked: boolean) => {
      setSelectedBulkSuggestItemIds((previous) => {
        if (checked) {
          if (previous.includes(itemId)) return previous;
          return [...previous, itemId];
        }
        if (!previous.includes(itemId)) return previous;
        return previous.filter((id) => id !== itemId);
      });
    },
    []
  );

  const handleToggleAllBulkSuggestItems = useCallback(
    (checked: boolean) => {
      if (!checked) {
        setSelectedBulkSuggestItemIds([]);
        return;
      }

      setSelectedBulkSuggestItemIds(
        bulkSuggestPreview.map((previewItem) => previewItem.itemId)
      );
    },
    [bulkSuggestPreview]
  );

  const handleApplyBulkSuggest = useCallback(async () => {
    if (isApplyingBulkSuggest) return;

    if (isReadOnly) {
      setBulkSuggestDialogError(readOnlyActionErrorMessage);
      return;
    }

    if (isConflictLocked) {
      setBulkSuggestDialogError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot) {
      setBulkSuggestDialogError("Version introuvable.");
      return;
    }

    const selectedPreviewByItemId = new Map(
      selectedBulkSuggestPreview.map((previewItem) => [previewItem.itemId, previewItem])
    );

    if (selectedPreviewByItemId.size === 0) {
      setBulkSuggestDialogError("Selectionnez au moins une suggestion.");
      return;
    }

    const snapshot = itemsRef.current;
    const selectedLines = snapshot.filter(
      (item): item is EstimateItem =>
        item.item_type === "line" && selectedPreviewByItemId.has(item.id)
    );

    if (selectedLines.length === 0) {
      setBulkSuggestDialogError("Aucune ligne eligible selectionnee.");
      return;
    }

    const marginMultiplier = settings?.margin_multiplier ?? 1;
    const fallbackTaxRateBp = settings?.tax_rate_bp ?? versionSnapshot.tax_rate_bp ?? 0;

    const updatedLines = selectedLines.map((item) => {
      const previewItem = selectedPreviewByItemId.get(item.id);
      if (!previewItem) return item;

      const nextItem: EstimateItem = {
        ...item,
        ...previewItem.patch,
      };
      const taxRate = nextItem.tax_rate_bp ?? fallbackTaxRateBp;
      const { lineInput, lineValues } = computeLineValuesWithLaborContext(nextItem, {
        marginMultiplier,
        taxRateBp: taxRate,
      });

      return {
        ...nextItem,
        tax_rate_bp: lineInput.tax_rate_bp,
        k_fo: lineInput.k_fo,
        h_mo: lineInput.h_mo,
        h_mo_majoration: lineInput.h_mo_majoration,
        k_mo: lineInput.k_mo,
        ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
          ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
          : {}),
        pu_ht_cents: lineValues.puHtCents,
        line_total_ht_cents: lineValues.saleLineCents,
        line_tax_cents: lineValues.taxLineCents,
        line_total_ttc_cents: lineValues.ttcLineCents,
      };
    });

    const updatesPayload = updatedLines.map((item) => ({
      id: item.id,
      updates: buildEstimateItemUpdatePayload(item),
    }));

    if (updatesPayload.length === 0) {
      setBulkSuggestDialogError("Aucune mise a jour a appliquer.");
      return;
    }

    const updatedById = new Map(updatedLines.map((item) => [item.id, item]));
    const previousItems = selectedLines.map((item) => ({ ...item }));
    const shouldTrackProgress =
      updatesPayload.length > BULK_SUGGEST_PROGRESS_THRESHOLD;

    setBulkSuggestDialogError(null);
    setIsApplyingBulkSuggest(true);
    setBulkSuggestProgress(
      shouldTrackProgress
        ? {
            processed: 0,
            total: updatesPayload.length,
            percentage: 0,
          }
        : null
    );
    setItems((previous) =>
      previous.map((item) => updatedById.get(item.id) ?? item)
    );

    try {
      const bulkResult = await bulkUpdateEstimateItems(
        versionSnapshot.id,
        versionSnapshot.updated_at,
        updatesPayload
      );
      const nextVersionToken = bulkResult.versionToken.updated_at;

      if (shouldTrackProgress) {
        setBulkSuggestProgress({
          processed: updatesPayload.length,
          total: updatesPayload.length,
          percentage: 100,
        });
      }

      const suggestionUsageByRuleId = selectedBulkSuggestPreview.reduce<
        Record<string, number>
      >((accumulator, previewItem) => {
        accumulator[previewItem.ruleId] =
          (accumulator[previewItem.ruleId] ?? 0) + 1;
        return accumulator;
      }, {});

      const suggestionUsageEntries = Object.entries(suggestionUsageByRuleId);
      if (suggestionUsageEntries.length > 0) {
        const feedbackResults = await Promise.allSettled(
          suggestionUsageEntries.map(([ruleId, count]) =>
            sendEstimateSuggestionRuleFeedback(
              versionSnapshot.id,
              ruleId,
              "accept",
              count
            )
          )
        );

        const failedFeedbackCount = feedbackResults.filter(
          (result) => result.status === "rejected"
        ).length;

        if (failedFeedbackCount > 0) {
          setActionError(
            `${failedFeedbackCount} compteur(s) de suggestions n'ont pas pu etre mis a jour.`
          );
        }
      }

      setVersion((previous) =>
        previous
          ? {
              ...previous,
              updated_at: nextVersionToken,
            }
          : previous
      );
      if (versionRef.current) {
        versionRef.current = {
          ...versionRef.current,
          updated_at: nextVersionToken,
        };
      }

      setBulkSuggestUndoState({
        previousItems,
        appliedItemIds: previousItems.map((item) => item.id),
      });
      setTotalsOutOfSync(false);
      setIsBulkSuggestDialogOpen(false);
      setSelectedBulkSuggestItemIds([]);
      setBulkSuggestDialogError(null);
    } catch (error) {
      setItems(snapshot);
      if (!handleVersionConflict(error, { persistDraft: true })) {
        setBulkSuggestDialogError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible d'appliquer les suggestions en lot."
          )
        );
      } else {
        setIsBulkSuggestDialogOpen(false);
      }
    } finally {
      setIsApplyingBulkSuggest(false);
      setBulkSuggestProgress(null);
    }
  }, [
    computeLineValuesWithLaborContext,
    conflictState?.message,
    handleVersionConflict,
    isApplyingBulkSuggest,
    isConflictLocked,
    isLaborSplitEnabled,
    isReadOnly,
    readOnlyActionErrorMessage,
    selectedBulkSuggestPreview,
    settings?.margin_multiplier,
    settings?.tax_rate_bp,
  ]);

  const handleUndoBulkSuggest = useCallback(async () => {
    if (!bulkSuggestUndoState || isUndoingBulkSuggest) return;

    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }

    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot) {
      setActionError("Version introuvable.");
      return;
    }

    const currentItemsSnapshot = itemsRef.current;
    const previousById = new Map(
      bulkSuggestUndoState.previousItems.map((item) => [item.id, item])
    );
    const updatesPayload = bulkSuggestUndoState.previousItems.map((item) => ({
      id: item.id,
      updates: buildEstimateItemUpdatePayload(item),
    }));

    setActionError(null);
    setIsUndoingBulkSuggest(true);
    setItems((previous) =>
      previous.map((item) => previousById.get(item.id) ?? item)
    );

    try {
      const bulkResult = await bulkUpdateEstimateItems(
        versionSnapshot.id,
        versionSnapshot.updated_at,
        updatesPayload
      );
      const nextVersionToken = bulkResult.versionToken.updated_at;

      setVersion((previous) =>
        previous
          ? {
              ...previous,
              updated_at: nextVersionToken,
            }
          : previous
      );
      if (versionRef.current) {
        versionRef.current = {
          ...versionRef.current,
          updated_at: nextVersionToken,
        };
      }

      setBulkSuggestUndoState(null);
      setTotalsOutOfSync(false);
    } catch (error) {
      setItems(currentItemsSnapshot);
      if (!handleVersionConflict(error, { persistDraft: true })) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible d'annuler les suggestions."
          )
        );
      } else {
        setBulkSuggestUndoState(null);
      }
    } finally {
      setIsUndoingBulkSuggest(false);
    }
  }, [
    bulkSuggestUndoState,
    conflictState?.message,
    handleVersionConflict,
    isConflictLocked,
    isReadOnly,
    isUndoingBulkSuggest,
    readOnlyActionErrorMessage,
  ]);

  const flushBufferedItemUpdates = useCallback(async () => {
    if (isFlushingBufferedUpdatesRef.current) return "noop" as const;
    if (isSaveBlockedRef.current) {
      return pendingItemUpdatesRef.current.size > 0
        ? ("blocked" as const)
        : ("noop" as const);
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot) {
      return pendingItemUpdatesRef.current.size > 0
        ? ("blocked" as const)
        : ("noop" as const);
    }

    const bufferedEntries = serializeBufferedUpdates(pendingItemUpdatesRef.current);
    if (bufferedEntries.length === 0) {
      setHasPendingBufferedUpdates(false);
      return "noop" as const;
    }

    pendingItemUpdatesRef.current.clear();
    pendingBufferedUpdateCountRef.current = 0;

    isFlushingBufferedUpdatesRef.current = true;

    const versionTotalsPatch = buildVersionTotalsPatch(persistedTotalsRef.current);
    const batchOperations = bufferedEntries.map((entry) => ({
      op: "update" as const,
      id: entry.id,
      data: entry.updates,
    }));

    try {
      const batchResult = await batchEstimateOperations(
        versionSnapshot.id,
        versionSnapshot.updated_at,
        batchOperations
      );

      if (!batchResult.committed) {
        const failedResult = batchResult.results.find(
          (result) => result.status === "error"
        );
        throw new Error(
          failedResult?.message ??
            "Une operation de sauvegarde groupee a echoue."
        );
      }

      let nextVersionToken = versionSnapshot.updated_at;
      if (versionTotalsPatch) {
        const bulkResult = await bulkUpdateEstimateItems(
          versionSnapshot.id,
          batchResult.versionToken.updated_at,
          [],
          versionTotalsPatch
        );
        nextVersionToken = bulkResult.versionToken.updated_at;
      } else {
        nextVersionToken = batchResult.versionToken.updated_at;
      }

      setTotalsOutOfSync(false);
      setVersion((prev) =>
        prev
          ? {
              ...prev,
              ...(versionTotalsPatch ?? {}),
              updated_at: nextVersionToken,
            }
          : prev
      );
      const nextVersionSnapshot = versionRef.current
        ? {
            ...versionRef.current,
            ...(versionTotalsPatch ?? {}),
            updated_at: nextVersionToken,
          }
        : null;
      if (nextVersionSnapshot) {
        versionRef.current = nextVersionSnapshot;
      }
      persistBufferedItemUpdatesToLocal();
      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
      clearUndoRedoHistory();
      return "saved" as const;
    } catch (error) {
      bufferedEntries.forEach((entry) => {
        const existing = pendingItemUpdatesRef.current.get(entry.id) ?? {};
        pendingItemUpdatesRef.current.set(entry.id, {
          ...entry.updates,
          ...existing,
        });
      });
      pendingBufferedUpdateCountRef.current += bufferedEntries.length;
      setHasPendingBufferedUpdates(true);
      persistBufferedItemUpdatesToLocal();

      const hasConflict = handleVersionConflict(error, { persistDraft: true });
      if (hasConflict) {
        setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
        return "blocked" as const;
      }

      setTotalsOutOfSync(true);
      setActionError(
        resolveEstimateActionError(
          error instanceof Error
            ? error.message
            : "Impossible de mettre a jour les lignes."
        )
      );
      return "error" as const;
    } finally {
      isFlushingBufferedUpdatesRef.current = false;
    }
  }, [clearUndoRedoHistory, handleVersionConflict, persistBufferedItemUpdatesToLocal]);

  const ensureGroupedActionCanProceed = useCallback(
    async (actionLabel: string) => {
      const flushResult = await flushBufferedItemUpdates();

      if (flushResult === "blocked") {
        setActionError(
          `Impossible de ${actionLabel} tant que les modifications locales ne sont pas synchronisees. Rechargez la version puis reessayez.`
        );
        return false;
      }

      if (flushResult === "error") {
        setActionError(
          `Impossible de synchroniser les modifications locales avant de ${actionLabel}. Corrigez les erreurs puis reessayez.`
        );
        return false;
      }

      if (flushResult === "noop" && pendingItemUpdatesRef.current.size > 0) {
        setActionError(
          "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
        );
        return false;
      }

      return true;
    },
    [flushBufferedItemUpdates]
  );

  const {
    status: autoSaveStatus,
    statusLabel: autoSaveStatusLabel,
    isSaving: isAutoSaveSaving,
    flushNow: flushAutoSaveNow,
    scheduleSave: scheduleAutoSave,
  } = useAutoSave({
    enabled: Boolean(resolvedVersionId && !isSaveBlocked),
    hasPendingChanges: hasPendingBufferedUpdates,
    debounceMs: BULK_AUTOSAVE_DEBOUNCE_MS,
    onSave: flushBufferedItemUpdates,
  });

  const handleBlockedNavigation = useCallback(() => {
    setActionError(
      "Des modifications locales sont en attente de sauvegarde automatique. Patientez la fin de la synchronisation avant de quitter cette page."
    );
  }, []);

  useAutoSaveNavigationGuard({
    enabled: Boolean(resolvedVersionId),
    hasPendingChanges: hasPendingBufferedUpdates,
    isSaving: isAutoSaveSaving,
    onBlockedNavigation: handleBlockedNavigation,
  });

  const autoSaveStatusClassName = useMemo(() => {
    if (autoSaveStatus === "saving") return "status-badge status-sent";
    if (autoSaveStatus === "error") return "status-badge status-canceled";
    if (autoSaveStatus === "saved") return "status-badge status-accepted";
    return "status-badge status-draft";
  }, [autoSaveStatus]);

  const enqueueBufferedItemUpdate = useCallback(
    (itemId: string, payload: EstimateItemUpdatePayload) => {
      upsertBufferedUpdate(pendingItemUpdatesRef.current, itemId, payload);
      setHasPendingBufferedUpdates(true);
      persistBufferedItemUpdatesToLocal();

      pendingBufferedUpdateCountRef.current += 1;
      if (
        shouldFlushBufferedUpdates(
          pendingBufferedUpdateCountRef.current,
          BULK_AUTOSAVE_IMMEDIATE_FLUSH_UPDATES
        )
      ) {
        void flushAutoSaveNow();
        return;
      }

      scheduleAutoSave();
    },
    [flushAutoSaveNow, persistBufferedItemUpdatesToLocal, scheduleAutoSave]
  );

  const retryTotalsSave = useCallback(async () => {
    await flushAutoSaveNow();
  }, [flushAutoSaveNow]);

  useEffect(() => {
    return () => {
      persistBufferedItemUpdatesToLocal();
      clearBufferedItemUpdates();
    };
  }, [clearBufferedItemUpdates, persistBufferedItemUpdatesToLocal]);

  const updateSettings = useCallback(
    (patch: Partial<EstimateSettingsState>) => {
      setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    },
    []
  );

  const reloadItems = useCallback(async () => {
    if (!resolvedVersionId) return;
    try {
      const itemsRows = await fetchEstimateItemsForVersion(resolvedVersionId);
      if (!version) {
        setItems(applyPendingBufferedUpdatesToItems(itemsRows));
        return;
      }

      const normalizedItems =
        version.status === "draft"
          ? normalizeDraftItems({
              items: itemsRows,
              version,
              rateById: laborRateById,
            })
          : itemsRows;

      setItems(applyPendingBufferedUpdatesToItems(normalizedItems));
    } catch (error) {
      const message =
        error instanceof Error
          ? resolveEstimateActionError(error.message)
          : "Impossible de charger les lignes.";
      setActionError(message);
    }
  }, [applyPendingBufferedUpdatesToItems, laborRateById, resolvedVersionId, version]);

  async function handleSaveSettings() {
    if (!settings || !version || !totals) return;
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }
    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }
    setIsSavingSettings(true);
    setActionError(null);

    const discountBase = totals.saleSubtotalCents;
    const discountBp =
      discountBase > 0
        ? Math.round((totals.discountCents / discountBase) * 10000)
        : 0;
    const discountMode: DiscountMode =
      settings.discount_mode === "cascade" ? "cascade" : "simple";
    const normalizedCascadeDiscountSteps = normalizeCascadeDiscountSteps(
      settings.discount_steps
    );
    const cascadeDiscountSteps =
      discountMode === "cascade"
        ? normalizedCascadeDiscountSteps
        : [];
    const globalCoefficient = Math.max(settings.global_coefficient ?? 1, 0);

    const payload: Database["public"]["Tables"]["estimate_versions"]["Update"] = {
      title: settings.title.trim() || null,
      date_devis: settings.date_devis,
      validite_jours: settings.validite_jours,
      currency: settings.currency,
      margin_multiplier: totals.appliedMarginMultiplier,
      margin_mode: settings.margin_mode ?? "fixed",
      discount_bp: discountBp,
      discount_mode: discountMode,
      discount_steps: cascadeDiscountSteps,
      global_coefficient: discountMode === "cascade" ? globalCoefficient : 1,
      tax_rate_bp: settings.tax_rate_bp,
      rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents,
      total_ht_cents: totals.saleTotalCents,
      total_tax_cents: totals.adjustedTaxCents,
      total_ttc_cents: totals.roundedTtcCents,
    };

    let updatedVersion: EstimateVersionRow;
    try {
      updatedVersion = await saveEstimateVersion(
        version.id,
        payload,
        version.updated_at
      );
    } catch (error) {
      if (!handleVersionConflict(error, { persistDraft: true })) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de sauvegarder le chiffrage."
          )
        );
      }
      setIsSavingSettings(false);
      return;
    }

    setVersion((prev) =>
      prev
        ? {
            ...prev,
            ...payload,
            ...updatedVersion,
          }
        : prev
    );

    const nextSavedSettings = {
      ...settings,
      margin_multiplier: totals.appliedMarginMultiplier,
      margin_mode: settings.margin_mode ?? "fixed",
      discount_cents: totals.discountCents,
      discount_mode: discountMode as DiscountMode,
      discount_steps: cascadeDiscountSteps,
      global_coefficient: discountMode === "cascade" ? globalCoefficient : 1,
    } as EstimateSettingsState;
    setSavedSettings(nextSavedSettings);
    setSettings(nextSavedSettings);
    let latestVersionToken = updatedVersion.updated_at;

    const shouldUpdateLines =
      settings.tax_rate_bp !== version.tax_rate_bp ||
      totals.appliedMarginMultiplier !== version.margin_multiplier;

    if (shouldUpdateLines) {
      const lineItems = itemsRef.current.filter(
        (item) => item.item_type === "line"
      );
      const updatedLines = lineItems.map((item) => {
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
          marginMultiplier: totals.appliedMarginMultiplier,
          taxRateBp: settings.tax_rate_bp,
        });
        return {
          ...item,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          k_mo: lineInput.k_mo,
          ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
            ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
            : {}),
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setItems((prev) =>
        prev.map((item) => {
          if (item.item_type !== "line") return item;
          const updated = updatedLines.find((line) => line.id === item.id);
          return updated ?? item;
        })
      );

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          version.id,
          latestVersionToken,
          updatedLines.map((item) => ({
            id: item.id,
            updates: buildEstimateItemUpdatePayload(item),
          }))
        );

        latestVersionToken = bulkResult.versionToken.updated_at;
        setVersion((prev) =>
          prev
            ? {
                ...prev,
                updated_at: latestVersionToken,
              }
            : prev
        );
      } catch (error) {
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError("Impossible de mettre a jour les lignes.");
        }
        setIsSavingSettings(false);
        return;
      }
    }

    clearConflictDraftFromSession(resolvedVersionId);
    setRestorableDraft(null);
    setIsSavingSettings(false);
  }

  const handleCreateRole = useCallback(
    async (payload: { name: string; hourly_rate_cents: number }) => {
      setActionError(null);
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return;
      }

      const nextPosition =
        laborRoles.reduce((max, role) => Math.max(max, role.position), 0) + 1;

      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      let data: LaborRole;
      try {
        data = await createEstimateLaborRole(version.id, {
          name: payload.name,
          hourly_rate_cents: payload.hourly_rate_cents,
          is_active: true,
          position: nextPosition,
        });
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de creer le role."
        );
        return;
      }

      setLaborRoles((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
    },
    [
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      laborRoles,
      profile,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const handleUpdateRole = useCallback(
    async (id: string, updates: Partial<LaborRole>) => {
      setActionError(null);
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      try {
        await updateEstimateLaborRole(version.id, id, updates);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Impossible de mettre a jour le role.");
        return;
      }

      setLaborRoles((prev) =>
        prev.map((role) => (role.id === id ? { ...role, ...updates } : role))
      );

      if (updates.hourly_rate_cents === undefined || !settings) return;

      const nextHourlyRate = updates.hourly_rate_cents ?? 0;
      const snapshot = itemsRef.current;
      const affectedLines = snapshot.filter(
        (item) => {
          if (item.item_type !== "line") return false;
          if (item.labor_role_id === id) return true;
          const splitFields = readLaborSplitFields(item);
          return (
            splitFields.labor_role_atelier_id === id ||
            splitFields.labor_role_chantier_id === id
          );
        }
      );

      if (affectedLines.length === 0) return;

      const updatedLines = affectedLines.map((item) => {
        const taxRate = settings.tax_rate_bp ?? item.tax_rate_bp ?? 0;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(item, {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: taxRate,
          rateOverrideByRoleId: id,
          hourlyRateCents: nextHourlyRate,
        });
        return {
          ...item,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          k_mo: lineInput.k_mo,
          ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
            ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
            : {}),
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      setItems((prev) =>
        prev.map((item) => {
          if (item.item_type !== "line") return item;
          const updated = updatedLines.find((line) => line.id === item.id);
          return updated ?? item;
        })
      );

      if (isSaveBlocked) return;

      updatedLines.forEach((item) => {
        enqueueBufferedItemUpdate(item.id, buildEstimateItemUpdatePayload(item));
      });
    },
    [
      enqueueBufferedItemUpdate,
      isSaveBlocked,
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      settings,
      version?.id,
      computeLineValuesWithLaborContext,
      isLaborSplitEnabled,
    ]
  );

  const canEditMarginTiers = isAdmin && !isSaveBlocked;

  const handleCreateTier = useCallback(
    async (payload: { threshold_cents: number; multiplier: number }) => {
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await createMarginTierClient(payload);
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                margin_tiers: [...(prev.margin_tiers ?? []), data].sort(
                  (a, b) =>
                    (a as MarginTierRow).threshold_cents -
                    (b as MarginTierRow).threshold_cents
                ),
              }
            : prev
        );
      } catch (error) {
        setMarginTiersError(
          error instanceof Error ? error.message : "Erreur creation tranche."
        );
      } finally {
        setIsSavingMarginTiers(false);
      }
    },
    []
  );

  const handleUpdateTier = useCallback(
    async (
      id: string,
      updates: { threshold_cents?: number; multiplier?: number }
    ) => {
      setMarginTiersError(null);
      setIsSavingMarginTiers(true);
      try {
        const data = await updateMarginTierClient(id, updates);
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                margin_tiers: (prev.margin_tiers ?? [])
                  .map((t) => ((t as MarginTierRow).id === id ? data : t))
                  .sort(
                    (a, b) =>
                      (a as MarginTierRow).threshold_cents -
                      (b as MarginTierRow).threshold_cents
                  ),
              }
            : prev
        );
      } catch (error) {
        setMarginTiersError(
          error instanceof Error
            ? error.message
            : "Erreur mise a jour tranche."
        );
      } finally {
        setIsSavingMarginTiers(false);
      }
    },
    []
  );

  const handleDeleteTier = useCallback(async (id: string) => {
    setMarginTiersError(null);
    setIsSavingMarginTiers(true);
    try {
      await deleteMarginTierClient(id);
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              margin_tiers: (prev.margin_tiers ?? []).filter(
                (t) => (t as MarginTierRow).id !== id
              ),
            }
          : prev
      );
    } catch (error) {
      setMarginTiersError(
        error instanceof Error
          ? error.message
          : "Erreur suppression tranche."
      );
    } finally {
      setIsSavingMarginTiers(false);
    }
  }, []);

  const handleCreateSuggestionRule = useCallback(
    async (payload: SuggestionRuleCreatePayload) => {
      setRulesError(null);
      if (isReadOnly) {
        setRulesError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setRulesError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!profile?.id) {
        setRulesError("Impossible de charger votre profil.");
        return;
      }

      setIsSavingRules(true);
      const nextPosition =
        suggestionRules.reduce((max, rule) => Math.max(max, rule.position), 0) +
        1;
      const position =
        payload.position && payload.position > 0 ? payload.position : nextPosition;

      if (!version?.id) {
        setIsSavingRules(false);
        setRulesError("Version introuvable.");
        return;
      }

      let data: SuggestionRule;
      try {
        data = await createEstimateSuggestionRule(version.id, {
          name: payload.name,
          match_type: "keyword",
          match_value: payload.match_value,
          unit: payload.unit,
          category_id: payload.category_id,
          k_fo: payload.k_fo,
          k_mo: payload.k_mo,
          labor_role_id: payload.labor_role_id,
          position,
          is_active: payload.is_active,
        });
      } catch (error) {
        setIsSavingRules(false);
        setRulesError(
          error instanceof Error ? error.message : "Impossible de creer la regle."
        );
        return;
      }

      setIsSavingRules(false);

      setSuggestionRules((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
    },
    [
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      profile,
      readOnlyActionErrorMessage,
      suggestionRules,
      version?.id,
    ]
  );

  const handleUpdateSuggestionRule = useCallback(
    async (id: string, updates: Partial<SuggestionRule>) => {
      setRulesError(null);
      if (isReadOnly) {
        setRulesError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setRulesError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!version?.id) {
        setRulesError("Version introuvable.");
        return;
      }

      let data: SuggestionRule | null = null;
      try {
        data = await updateEstimateSuggestionRule(version.id, id, updates);
      } catch (error) {
        setRulesError(
          error instanceof Error
            ? error.message
            : "Impossible de mettre a jour la regle."
        );
        return;
      }

      setSuggestionRules((prev) =>
        prev
          .map((rule) => (rule.id === id ? (data ?? { ...rule, ...updates }) : rule))
          .sort((a, b) => a.position - b.position)
      );
    },
    [
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const getNextPosition = useCallback((parentId: string | null) => {
    const siblings = itemsRef.current.filter(
      (item) => item.parent_id === parentId
    );
    const maxPosition = siblings.reduce(
      (max, item) => Math.max(max, item.position),
      0
    );
    return maxPosition + 1;
  }, []);

  const resolveParentSectionLevel = useCallback((parentId: string | null) => {
    if (!parentId) return 0;

    const itemById = new Map(itemsRef.current.map((item) => [item.id, item]));
    let level = 0;
    let cursorId: string | null = parentId;
    let guard = 0;

    while (cursorId && guard < 200) {
      guard += 1;
      const parent = itemById.get(cursorId);
      if (!parent || parent.item_type !== "section") {
        break;
      }

      level += 1;
      cursorId = parent.parent_id;
    }

    return level;
  }, []);

  const applyVersionToken = useCallback((updatedAt: string) => {
    setVersion((previous) =>
      previous
        ? {
            ...previous,
            updated_at: updatedAt,
          }
        : previous
    );
    if (versionRef.current) {
      versionRef.current = {
        ...versionRef.current,
        updated_at: updatedAt,
      };
    }
  }, []);

  const applyBulkLineState = useCallback(
    async (
      targetLines: EstimateItem[],
      failureMessage: string
    ) => {
      const snapshot = itemsRef.current;
      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        throw new Error("Version introuvable.");
      }

      const updatedById = new Map(targetLines.map((line) => [line.id, line]));
      setItems((previous) =>
        previous.map((item) => updatedById.get(item.id) ?? item)
      );

      const updatesPayload = targetLines.map((line) => ({
        id: line.id,
        updates: buildEstimateItemUpdatePayload(line),
      }));

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          versionSnapshot.id,
          versionSnapshot.updated_at,
          updatesPayload
        );
        applyVersionToken(bulkResult.versionToken.updated_at);
        setTotalsOutOfSync(false);
      } catch (error) {
        setItems(snapshot);
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error ? error.message : failureMessage
            )
          );
        }
        throw error;
      }
    },
    [applyVersionToken, handleVersionConflict]
  );

  const recreateItemsFromSnapshots = useCallback(
    async (versionId: string, snapshots: EstimateItem[]) => {
      const idMap = new Map<string, string>();
      const createdItems: EstimateItem[] = [];
      const sortedSnapshots = sortItemsForTreeRecreation(snapshots);

      for (const snapshotItem of sortedSnapshots) {
        const mappedParentId = snapshotItem.parent_id
          ? (idMap.get(snapshotItem.parent_id) ?? snapshotItem.parent_id)
          : null;
        const createPayload = buildEstimateItemInsertPayload(versionId, snapshotItem, {
          parentId: mappedParentId,
          position: snapshotItem.position,
          title: snapshotItem.title,
        });
        const created = await createEstimateItem(versionId, createPayload);
        idMap.set(snapshotItem.id, created.id);
        createdItems.push(created);
      }

      return {
        idMap,
        createdItems,
      };
    },
    []
  );

  const applySiblingOrder = useCallback(
    async (
      versionId: string,
      siblingOrderByParent: Map<string | null, string[]>,
      idMap: Map<string, string> = new Map()
    ) => {
      if (siblingOrderByParent.size === 0) return;

      const currentItemIds = new Set(itemsRef.current.map((item) => item.id));
      const nextPositionById = new Map<string, number>();

      for (const [parentId, orderedIds] of siblingOrderByParent.entries()) {
        const mappedOrderedIds = orderedIds
          .map((itemId) => idMap.get(itemId) ?? itemId)
          .filter((itemId) => currentItemIds.has(itemId));

        if (mappedOrderedIds.length === 0) continue;
        await reorderEstimateItems(versionId, parentId, mappedOrderedIds);
        mappedOrderedIds.forEach((itemId, index) => {
          nextPositionById.set(itemId, index + 1);
        });
      }

      if (nextPositionById.size === 0) return;
      setItems((previous) =>
        previous.map((item) =>
          nextPositionById.has(item.id)
            ? { ...item, position: nextPositionById.get(item.id) ?? item.position }
            : item
        )
      );
    },
    []
  );

  const persistMoveItem = useCallback(
    async (versionId: string, move: EstimateItemMovePayload) => {
      await moveEstimateItem(versionId, {
        item_id: move.itemId,
        from_parent_id: move.fromParentId,
        to_parent_id: move.toParentId,
        ordered_source_ids: move.orderedSourceIds,
        ordered_target_ids: move.orderedTargetIds,
      });
    },
    []
  );

  const handleAddSection = useCallback(
    async (parentId: string | null) => {
      if (!version) return;
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);
      const nextSectionLevel = resolveParentSectionLevel(parentId) + 1;
      const tempId = createTempEstimateItemId();
      const optimisticSection = createOptimisticSectionItem({
        tempId,
        tenantId: version.tenant_id,
        versionId: version.id,
        parentId,
        position,
        title: getDefaultSectionTitleForLevel(nextSectionLevel),
      });

      setItems((prev) => [...prev, optimisticSection]);

      try {
        const created = await createEstimateItem(version.id, {
          version_id: version.id,
          parent_id: parentId,
          item_type: "section",
          position,
          title: optimisticSection.title,
        });

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          try {
            await deleteEstimateItem(version.id, created.id);
          } catch {
            // Best effort cleanup only.
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);

        setItems((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? (reconcileCreatedItemWithLocalDraft(
                  created,
                  buildEstimateItemUpdatePayload(item),
                  queuedPatch
                ) as EditorEstimateItem)
              : item
          )
        );

        if (queuedPatch) {
          enqueueBufferedItemUpdate(created.id, queuedPatch);
        }

        let currentSectionId = created.id;
        pushHistoryCommand({
          label: "add-section",
          undo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const snapshot = itemsRef.current;
            const idsToRemove = collectSubtreeItemIds(snapshot, currentSectionId);
            setItems((previous) =>
              previous.filter((item) => !idsToRemove.has(item.id))
            );

            try {
              await deleteEstimateItem(versionSnapshot.id, currentSectionId);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(snapshot);
              throw error;
            }
          },
          redo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const payload = buildEstimateItemInsertPayload(versionSnapshot.id, created, {
              parentId,
              position: created.position,
              title: created.title,
            });
            const recreated = await createEstimateItem(versionSnapshot.id, payload);
            currentSectionId = recreated.id;
            setItems((previous) => [...previous, recreated]);
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        setItems((previous) => previous.filter((item) => item.id !== tempId));
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de creer le chapitre."
          )
        );
      }
    },
    [
      enqueueBufferedItemUpdate,
      getNextPosition,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      resolveParentSectionLevel,
      version,
    ]
  );

  const handleAddLine = useCallback(
    async (parentId: string | null) => {
      if (!version || !settings) return;
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);
      const newLineInput = {
        quantity: 1,
        unit_price_ht_cents: 0,
        tax_rate_bp: settings.tax_rate_bp,
        k_fo: 1,
        h_mo: 0,
        h_mo_majoration: 1,
        k_mo: 1,
        pu_ht_cents: 0,
        labor_role_hourly_rate_cents: 0,
        h_mo_atelier: 0,
        k_mo_atelier: 1,
        labor_role_atelier_id: null,
        labor_role_atelier_hourly_rate_cents: 0,
        h_mo_chantier: 0,
        k_mo_chantier: 1,
        labor_role_chantier_id: null,
        labor_role_chantier_hourly_rate_cents: 0,
      };
      const lineComputationOptions = {
        marginMultiplier: settings.margin_multiplier,
        taxRateBp: settings.tax_rate_bp,
        isLaborSplitEnabled,
      };
      const lineValues = computeEstimateLineValues(
        newLineInput,
        lineComputationOptions
      );
      const tempId = createTempEstimateItemId();
      const optimisticLine = createOptimisticLineItem({
        tempId,
        tenantId: version.tenant_id,
        versionId: version.id,
        parentId,
        position,
        title: "Nouvelle ligne",
        quantity: 1,
        taxRateBp: settings.tax_rate_bp,
        puHtCents: lineValues.puHtCents,
        lineTotalHtCents: lineValues.saleLineCents,
        lineTaxCents: lineValues.taxLineCents,
        lineTotalTtcCents: lineValues.ttcLineCents,
        isLaborSplitEnabled,
      });

      setItems((prev) => [...prev, optimisticLine]);

      try {
        const createPayload: Database["public"]["Tables"]["estimate_items"]["Insert"] &
          LaborSplitItemFields = {
          version_id: version.id,
          parent_id: parentId,
          item_type: "line",
          position,
          title: optimisticLine.title,
          description: null,
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          pu_ht_cents: lineValues.puHtCents,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          selected_supplier_price_id: null,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
        if (isLaborSplitEnabled) {
          createPayload.h_mo_atelier = 0;
          createPayload.k_mo_atelier = 1;
          createPayload.labor_role_atelier_id = null;
          createPayload.h_mo_chantier = 0;
          createPayload.k_mo_chantier = 1;
          createPayload.labor_role_chantier_id = null;
        }

        const created = await createEstimateItem(version.id, createPayload);

        if (removedTempItemIdsRef.current.has(tempId)) {
          removedTempItemIdsRef.current.delete(tempId);
          queuedPatchesByTempIdRef.current.delete(tempId);
          try {
            await deleteEstimateItem(version.id, created.id);
          } catch {
            // Best effort cleanup only.
          }
          return;
        }

        const queuedPatch = queuedPatchesByTempIdRef.current.get(tempId);
        queuedPatchesByTempIdRef.current.delete(tempId);

        setItems((previous) =>
          previous.map((item) =>
            item.id === tempId
              ? (reconcileCreatedItemWithLocalDraft(
                  created,
                  buildEstimateItemUpdatePayload(item),
                  queuedPatch
                ) as EditorEstimateItem)
              : item
          )
        );

        if (queuedPatch) {
          enqueueBufferedItemUpdate(created.id, queuedPatch);
        }

        let currentLineId = created.id;
        pushHistoryCommand({
          label: "add-line",
          undo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const snapshot = itemsRef.current;
            setItems((previous) =>
              previous.filter((item) => item.id !== currentLineId)
            );
            try {
              await deleteEstimateItem(versionSnapshot.id, currentLineId);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(snapshot);
              throw error;
            }
          },
          redo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const payload = buildEstimateItemInsertPayload(versionSnapshot.id, created, {
              parentId,
              position: created.position,
              title: created.title,
            });
            const recreated = await createEstimateItem(versionSnapshot.id, payload);
            currentLineId = recreated.id;
            setItems((previous) => [...previous, recreated]);
            setTotalsOutOfSync(false);
          },
        });
      } catch (error) {
        queuedPatchesByTempIdRef.current.delete(tempId);
        setItems((previous) => previous.filter((item) => item.id !== tempId));
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible d'ajouter la ligne."
          )
        );
      }
    },
    [
      enqueueBufferedItemUpdate,
      getNextPosition,
      isLaborSplitEnabled,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      settings,
      version,
    ]
  );

  const handleInsertAssembly = useCallback(
    async (assemblyId: string, afterItemId: string | null) => {
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }

      setActionError(null);
      const snapshot = itemsRef.current;
      let insertedItems: EstimateItem[] = [];

      try {
        insertedItems = await insertAssemblyIntoVersion(assemblyId, {
          versionId: version.id,
          afterItemId,
        });

        if (insertedItems.length === 0) {
          return;
        }

        const insertedIds = new Set(insertedItems.map((item) => item.id));
        const insertedSection =
          insertedItems.find((item) => item.item_type === "section") ??
          insertedItems[0];

        const targetParentId = insertedSection.parent_id ?? null;
        const targetPosition = insertedSection.position;

        const shiftedExistingItems = snapshot.map((item) => {
          if (insertedIds.has(item.id)) return item;
          if ((item.parent_id ?? null) !== targetParentId) return item;
          if (item.position < targetPosition) return item;
          return {
            ...item,
            position: item.position + 1,
          };
        });

        setItems([...shiftedExistingItems, ...insertedItems]);
        setTotalsOutOfSync(false);
      } catch (error) {
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible d'inserer l'assemblage."
            )
          );
        }
        return;
      }

      await refreshVersionTokenAfterAssemblyInsert(version.id, {
        fetchEstimateEditorData,
        onVersionToken: (updatedAt) => {
          applyVersionToken(updatedAt);
        },
        onError: (error) => {
          console.error(
            "Impossible de rafraichir le jeton de version apres insertion d'assemblage.",
            error
          );
        },
      });

      if (insertedItems.length === 0) return;

      let latestInsertedRoots = resolveTopLevelItemIds(insertedItems);
      pushHistoryCommand({
        label: "insert-assembly",
        undo: async () => {
          const versionSnapshot = versionRef.current;
          if (!versionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const undoSnapshot = itemsRef.current;
          const idsToRemove = new Set<string>();
          latestInsertedRoots.forEach((rootId) => {
            collectSubtreeItemIds(undoSnapshot, rootId).forEach((id) => {
              idsToRemove.add(id);
            });
          });
          setItems((previous) =>
            previous.filter((item) => !idsToRemove.has(item.id))
          );

          try {
            for (const rootId of latestInsertedRoots) {
              await deleteEstimateItem(versionSnapshot.id, rootId);
            }
            setTotalsOutOfSync(false);
          } catch (error) {
            setItems(undoSnapshot);
            throw error;
          }
        },
        redo: async () => {
          const versionSnapshot = versionRef.current;
          if (!versionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const redoSnapshot = itemsRef.current;
          const recreated = await insertAssemblyIntoVersion(assemblyId, {
            versionId: versionSnapshot.id,
            afterItemId,
          });
          if (recreated.length === 0) return;

          latestInsertedRoots = resolveTopLevelItemIds(recreated);
          const recreatedIds = new Set(recreated.map((item) => item.id));
          const insertedSection =
            recreated.find((item) => item.item_type === "section") ?? recreated[0];
          const targetParentId = insertedSection?.parent_id ?? null;
          const targetPosition = insertedSection?.position ?? 1;

          const shiftedExistingItems = redoSnapshot.map((item) => {
            if (recreatedIds.has(item.id)) return item;
            if ((item.parent_id ?? null) !== targetParentId) return item;
            if (item.position < targetPosition) return item;
            return {
              ...item,
              position: item.position + 1,
            };
          });

          setItems([...shiftedExistingItems, ...recreated]);
          setTotalsOutOfSync(false);

          await refreshVersionTokenAfterAssemblyInsert(versionSnapshot.id, {
            fetchEstimateEditorData,
            onVersionToken: (updatedAt) => {
              applyVersionToken(updatedAt);
            },
            onError: (error) => {
              console.error(
                "Impossible de rafraichir le jeton de version apres reinsertion d'assemblage.",
                error
              );
            },
          });
        },
      });
    },
    [
      applyVersionToken,
      conflictState?.message,
      handleVersionConflict,
      isConflictLocked,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const handleInsertTemplate = useCallback(
    async (templateId: string, afterItemId: string | null) => {
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }

      setActionError(null);
      const snapshot = itemsRef.current;
      let insertedItems: EstimateItem[] = [];
      let insertedRootsTracker = createTopLevelItemIdsTracker([]);

      try {
        insertedItems = await insertTemplateIntoVersion(templateId, {
          versionId: version.id,
          afterItemId,
        });

        if (insertedItems.length === 0) {
          return;
        }

        insertedRootsTracker = createTopLevelItemIdsTracker(insertedItems);
        setItems(applyOptimisticTemplateInsertion(snapshot, insertedItems));
        setTotalsOutOfSync(false);
      } catch (error) {
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible d'inserer le template."
            )
          );
        }
        return;
      }

      await refreshVersionTokenAfterAssemblyInsert(version.id, {
        fetchEstimateEditorData,
        onVersionToken: (updatedAt) => {
          applyVersionToken(updatedAt);
        },
        onError: (error) => {
          console.error(
            "Impossible de rafraichir le jeton de version apres insertion de template.",
            error
          );
        },
      });

      if (insertedItems.length === 0) return;

      pushHistoryCommand({
        label: "insert-template",
        undo: async () => {
          const versionSnapshot = versionRef.current;
          if (!versionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const undoSnapshot = itemsRef.current;
          const idsToRemove = new Set<string>();
          const latestInsertedRoots = insertedRootsTracker.getCurrent();
          latestInsertedRoots.forEach((rootId) => {
            collectSubtreeItemIds(undoSnapshot, rootId).forEach((id) => {
              idsToRemove.add(id);
            });
          });
          setItems((previous) =>
            previous.filter((item) => !idsToRemove.has(item.id))
          );

          try {
            for (const rootId of latestInsertedRoots) {
              await deleteEstimateItem(versionSnapshot.id, rootId);
            }
            setTotalsOutOfSync(false);
          } catch (error) {
            setItems(undoSnapshot);
            throw error;
          }
        },
        redo: async () => {
          const versionSnapshot = versionRef.current;
          if (!versionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const redoSnapshot = itemsRef.current;
          const recreated = await insertTemplateIntoVersion(templateId, {
            versionId: versionSnapshot.id,
            afterItemId,
          });
          if (recreated.length === 0) return;

          insertedRootsTracker.replace(recreated);
          setItems(applyOptimisticTemplateInsertion(redoSnapshot, recreated));
          setTotalsOutOfSync(false);

          await refreshVersionTokenAfterAssemblyInsert(versionSnapshot.id, {
            fetchEstimateEditorData,
            onVersionToken: (updatedAt) => {
              applyVersionToken(updatedAt);
            },
            onError: (error) => {
              console.error(
                "Impossible de rafraichir le jeton de version apres reinsertion de template.",
                error
              );
            },
          });
        },
      });
    },
    [
      applyVersionToken,
      conflictState?.message,
      handleVersionConflict,
      isConflictLocked,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const handleDuplicateSection = useCallback<
    NonNullable<EstimateEditorTableProps["onDuplicateSection"]>
  >(
    async (sectionId) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      setActionError(null);

      try {
        const result = await duplicateEstimateSection(versionSnapshot.id, sectionId);
        await reloadItems();
        setTotalsOutOfSync(false);

        if (result.versionToken?.updated_at) {
          applyVersionToken(result.versionToken.updated_at);
          return;
        }

        await refreshVersionTokenAfterAssemblyInsert(versionSnapshot.id, {
          fetchEstimateEditorData,
          onVersionToken: (updatedAt) => {
            applyVersionToken(updatedAt);
          },
          onError: (error) => {
            console.error(
              "Impossible de rafraichir le jeton de version apres duplication de section.",
              error
            );
          },
        });
      } catch (error) {
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible de dupliquer la section."
            )
          );
        }
      }
    },
    [
      applyVersionToken,
      conflictState?.message,
      handleVersionConflict,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      reloadItems,
    ]
  );

  const handleDuplicateSectionToVersion = useCallback<
    NonNullable<EstimateEditorTableProps["onDuplicateSectionToVersion"]>
  >(
    async ({ sectionId, targetVersionId }) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      if (targetVersionId === versionSnapshot.id) {
        await handleDuplicateSection(sectionId);
        return;
      }

      setActionError(null);
      let targetLockAcquired = false;
      let redirected = false;

      try {
        const lockResult = await acquireEstimateDraftLock(targetVersionId);
        const isOwnedByCurrentUser =
          lockResult.lock?.isOwnedByCurrentUser !== false;

        if (!lockResult.acquired || !isOwnedByCurrentUser) {
          const holderName = lockResult.lock?.holderName?.trim() ?? "";
          const holder = holderName.length > 0 ? holderName : "un autre utilisateur";
          setActionError(`La version cible est verrouillee par ${holder}.`);
          return;
        }

        targetLockAcquired = true;
        await duplicateEstimateSection(versionSnapshot.id, sectionId, {
          targetVersionId,
        });

        redirected = true;
        router.push(`/dashboard/estimates/${targetVersionId}/edit`);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de dupliquer la section vers cette version."
          )
        );
      } finally {
        if (targetLockAcquired && !redirected) {
          try {
            await releaseEstimateDraftLock(targetVersionId);
          } catch {
            // Best-effort cleanup of a lock acquired for a failed cross-version duplication.
          }
        }
      }
    },
    [
      conflictState?.message,
      handleDuplicateSection,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      router,
    ]
  );

  const handleOpenImportFromEstimateDialog = useCallback(() => {
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }
    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }

    if (!versionRef.current?.id) {
      setActionError("Version introuvable.");
      return;
    }

    setActionError(null);
    setImportSummaryMessage(null);
    setIsImportFromEstimateDialogOpen(true);
  }, [
    conflictState?.message,
    isConflictLocked,
    isReadOnly,
    readOnlyActionErrorMessage,
  ]);

  const handleConfirmImportFromEstimateDialog = useCallback(
    async (input: ImportEstimateSectionsPayload) => {
      if (isReadOnly) {
        throw new Error(readOnlyActionErrorMessage);
      }
      if (isConflictLocked) {
        throw new Error(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot?.id) {
        throw new Error("Version introuvable.");
      }

      setActionError(null);
      setImportSummaryMessage(null);

      const result = await importEstimateSections(versionSnapshot.id, input);
      await reloadItems();
      setTotalsOutOfSync(false);

      setImportSummaryMessage(
        `${result.importedSectionsCount} section(s) et ${result.importedLinesCount} ligne(s) importees.`
      );

      if (result.versionToken?.updated_at) {
        applyVersionToken(result.versionToken.updated_at);
        return;
      }

      await refreshVersionTokenAfterAssemblyInsert(versionSnapshot.id, {
        fetchEstimateEditorData,
        onVersionToken: (updatedAt) => {
          applyVersionToken(updatedAt);
        },
        onError: (error) => {
          console.error(
            "Impossible de rafraichir le jeton de version apres import de sections.",
            error
          );
        },
      });
    },
    [
      applyVersionToken,
      conflictState?.message,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      reloadItems,
    ]
  );

  const handleImportDpgfSource = useCallback(async () => {
    if (isReadOnly) {
      setActionError(readOnlyActionErrorMessage);
      return;
    }
    if (isConflictLocked) {
      setActionError(
        conflictState?.message ?? "Version modifiee par un autre utilisateur"
      );
      return;
    }
    if (isImportingDpgfSource) {
      return;
    }
    if (!hasLinkedDpgfSource) {
      setActionError("Aucune source DPGF importable n'est liee a cette affaire.");
      return;
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot?.id) {
      setActionError("Version introuvable.");
      return;
    }

    setActionError(null);
    setImportSummaryMessage(null);
    setIsImportingDpgfSource(true);

    try {
      const result: ImportLinkedDpgfSourceResult =
        await importLinkedDpgfSource(versionSnapshot.id);

      await reloadItems();
      setTotalsOutOfSync(false);

      if (result.importedLinesCount >= 0) {
        const suffix = result.importedLinesCount > 1 ? "s" : "";
        setImportSummaryMessage(
          `${result.importedLinesCount} ligne${suffix} importee${suffix} depuis le DPGF source.`
        );
      } else {
        setImportSummaryMessage("Import du DPGF source termine.");
      }

      if (result.versionToken?.updated_at) {
        applyVersionToken(result.versionToken.updated_at);
        return;
      }

      await refreshVersionTokenAfterAssemblyInsert(versionSnapshot.id, {
        fetchEstimateEditorData,
        onVersionToken: (updatedAt) => {
          applyVersionToken(updatedAt);
        },
        onError: (error) => {
          console.error(
            "Impossible de rafraichir le jeton de version apres import du DPGF source.",
            error
          );
        },
      });
    } catch (error) {
      console.error("Erreur lors de l'import du DPGF source lie.", error);
      setActionError(
        resolveEstimateActionError(
          error instanceof Error
            ? error.message
            : "Impossible d'importer le DPGF source lie."
        )
      );
    } finally {
      setIsImportingDpgfSource(false);
    }
  }, [
    applyVersionToken,
    conflictState?.message,
    hasLinkedDpgfSource,
    isConflictLocked,
    isImportingDpgfSource,
    isReadOnly,
    readOnlyActionErrorMessage,
    reloadItems,
  ]);

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      const snapshot = itemsRef.current;
      const idsToRemove = collectSubtreeItemIds(snapshot, itemId);
      const impactedCount = idsToRemove.size;
      const impactedLabel =
        impactedCount > 1
          ? `${impactedCount} elements (cet element + ${impactedCount - 1} enfant${
              impactedCount - 1 > 1 ? "s" : ""
            })`
          : "cet element";
      if (!window.confirm(`Supprimer ${impactedLabel} ?`)) return;
      setActionError(null);

      const deletedSnapshots = snapshot.filter((item) => idsToRemove.has(item.id));
      const allSiblingOrders = buildSiblingOrderByParent(snapshot);
      const siblingOrderByParent = new Map<string | null, string[]>();
      const affectedParentIds = new Set<string | null>();
      deletedSnapshots.forEach((item) => {
        affectedParentIds.add(item.parent_id ?? null);
      });
      affectedParentIds.forEach((parentId) => {
        const order = allSiblingOrders.get(parentId);
        if (order) {
          siblingOrderByParent.set(parentId, order);
        }
      });
      setItems((prev) => prev.filter((item) => !idsToRemove.has(item.id)));

      const removedTempIds = Array.from(idsToRemove).filter((id) =>
        isTempEstimateItemId(id)
      );
      const removedTempQueuedPatches = markTempItemsRemoved(
        removedTempIds,
        removedTempItemIdsRef.current,
        queuedPatchesByTempIdRef.current
      );
      const rollbackRemovedTempIds = () => {
        rollbackRemovedTempItems(
          removedTempIds,
          removedTempQueuedPatches,
          removedTempItemIdsRef.current,
          queuedPatchesByTempIdRef.current
        );
      };

      if (isTempEstimateItemId(itemId)) {
        setTotalsOutOfSync(false);
        return;
      }

      if (!version?.id) {
        rollbackRemovedTempIds();
        setActionError("Version introuvable.");
        await reloadItems();
        return;
      }

      try {
        await deleteEstimateItem(version.id, itemId);
        let currentDeletedRootId = itemId;
        pushHistoryCommand({
          label: "delete-item",
          undo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const undoSnapshot = itemsRef.current;
            try {
              const recreated = await recreateItemsFromSnapshots(
                versionSnapshot.id,
                deletedSnapshots
              );

              setItems([...undoSnapshot, ...recreated.createdItems]);
              try {
                await applySiblingOrder(
                  versionSnapshot.id,
                  siblingOrderByParent,
                  recreated.idMap
                );
              } catch (error) {
                console.error(
                  "Impossible de restaurer l'ordre exact apres annulation de suppression.",
                  error
                );
              }
              currentDeletedRootId =
                recreated.idMap.get(itemId) ?? currentDeletedRootId;
              setTotalsOutOfSync(false);
            } catch (error) {
              await reloadItems();
              throw error;
            }
          },
          redo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const redoSnapshot = itemsRef.current;
            const redoIdsToRemove = collectSubtreeItemIds(
              redoSnapshot,
              currentDeletedRootId
            );
            setItems((previous) =>
              previous.filter((item) => !redoIdsToRemove.has(item.id))
            );
            try {
              await deleteEstimateItem(versionSnapshot.id, currentDeletedRootId);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch (error) {
        rollbackRemovedTempIds();
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de supprimer la ligne."
          )
        );
        await reloadItems();
      }
    },
    [
      applySiblingOrder,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      recreateItemsFromSnapshots,
      reloadItems,
      version?.id,
    ]
  );

  const handlePatchItem = useCallback(
    async (
      itemId: string,
      patch: ItemPatch,
      options?: { persist?: boolean }
    ) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      const persist = options?.persist ?? false;
      const snapshot = itemsRef.current;
      const current = snapshot.find((item) => item.id === itemId);
      if (!current) return;
      const previousItem = current;

      let updated: EditorEstimateItem = { ...current, ...patch };

      if (updated.item_type === "line") {
        const taxRate =
          updated.tax_rate_bp ??
          settings?.tax_rate_bp ??
          current.tax_rate_bp ??
          0;
        const marginMultiplier = settings?.margin_multiplier ?? 1;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(updated, {
          marginMultiplier,
          taxRateBp: taxRate,
        });
        updated = {
          ...updated,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          k_mo: lineInput.k_mo,
          ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
            ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
            : {}),
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      }

      const applyLocalItemPatch = () => {
        setItems((prev) =>
          prev.map((item) => (item.id === itemId ? updated : item))
        );
      };

      if (!persist) {
        startTransition(() => {
          applyLocalItemPatch();
        });
        return;
      }

      applyLocalItemPatch();

      if (isTempEstimateItemId(itemId) || isPendingCreateEstimateItem(current)) {
        const queuedPayload = buildEstimateItemUpdatePayload(updated);
        const existingPayload = queuedPatchesByTempIdRef.current.get(itemId) ?? {};
        queuedPatchesByTempIdRef.current.set(itemId, {
          ...existingPayload,
          ...queuedPayload,
        });
        setTotalsOutOfSync(false);
        return;
      }

      if (!version?.id) {
        setActionError("Version introuvable.");
        setItems(snapshot);
        return;
      }

      enqueueBufferedItemUpdate(itemId, buildEstimateItemUpdatePayload(updated));
      setTotalsOutOfSync(false);
      pushHistoryCommand({
        label: "patch-item",
        undo: async () => {
          setItems((previous) =>
            previous.map((item) => (item.id === itemId ? previousItem : item))
          );
          enqueueBufferedItemUpdate(
            itemId,
            buildEstimateItemUpdatePayload(previousItem)
          );
          setTotalsOutOfSync(false);
        },
        redo: async () => {
          setItems((previous) =>
            previous.map((item) => (item.id === itemId ? updated : item))
          );
          enqueueBufferedItemUpdate(
            itemId,
            buildEstimateItemUpdatePayload(updated)
          );
          setTotalsOutOfSync(false);
        },
      });
    },
    [
      enqueueBufferedItemUpdate,
      computeLineValuesWithLaborContext,
      isLaborSplitEnabled,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
      version?.id,
    ]
  );

  const handleApplyBulkMajoration = useCallback(
    async (itemIds: string[], coefficient: number) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const canProceed = await ensureGroupedActionCanProceed(
        "appliquer la majoration en lot"
      );
      if (!canProceed) {
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      const normalizedCoefficient = Math.max(toFiniteNumber(coefficient, 1), 0);
      const selectedIds = new Set(itemIds);
      const snapshot = itemsRef.current;

      const selectedLines = snapshot.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIds.has(item.id)
      );

      if (selectedLines.length === 0) {
        return;
      }

      setActionError(null);

      const marginMultiplier = settings?.margin_multiplier ?? 1;
      const fallbackTaxRateBp = settings?.tax_rate_bp ?? versionSnapshot.tax_rate_bp ?? 0;

      const updatedLines = selectedLines.map((item) => {
        const nextItem: EstimateItem = {
          ...item,
          h_mo_majoration: normalizedCoefficient,
        };

        const taxRate = nextItem.tax_rate_bp ?? fallbackTaxRateBp;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(nextItem, {
          marginMultiplier,
          taxRateBp: taxRate,
        });

        return {
          ...nextItem,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          h_mo_majoration: lineInput.h_mo_majoration,
          k_mo: lineInput.k_mo,
          ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
            ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
            : {}),
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      try {
        await applyBulkLineState(
          updatedLines,
          "Impossible d'appliquer la majoration en lot."
        );
        pushHistoryCommand({
          label: "bulk-majoration",
          undo: async () => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler la majoration en lot."
            );
          },
          redo: async () => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer la majoration en lot."
            );
          },
        });
      } catch (error) {
        void error;
      }
    },
    [
      applyBulkLineState,
      computeLineValuesWithLaborContext,
      ensureGroupedActionCanProceed,
      isLaborSplitEnabled,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );

  const handleBulkDeleteLines = useCallback(
    async (itemIds: string[]) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const canProceed = await ensureGroupedActionCanProceed(
        "supprimer les lignes selectionnees"
      );
      if (!canProceed) {
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      const selectedIdSet = new Set(itemIds);
      const snapshot = itemsRef.current;
      const selectedLines = snapshot.filter(
        (item) => item.item_type === "line" && selectedIdSet.has(item.id)
      );

      if (selectedLines.length === 0) return;
      const siblingOrderByParent = new Map<string | null, string[]>();
      const allSiblingOrders = buildSiblingOrderByParent(snapshot);
      selectedLines.forEach((line) => {
        const parentId = line.parent_id ?? null;
        const orderedIds = allSiblingOrders.get(parentId);
        if (!orderedIds) return;
        siblingOrderByParent.set(parentId, orderedIds);
      });

      setActionError(null);
      setItems((previous) =>
        previous.filter((item) => !selectedIdSet.has(item.id))
      );

      let deletedCount = 0;
      try {
        for (const line of selectedLines) {
          await deleteEstimateItem(versionSnapshot.id, line.id);
          deletedCount += 1;
        }
        setTotalsOutOfSync(false);
        let currentDeletedLineIds = selectedLines.map((line) => line.id);
        pushHistoryCommand({
          label: "bulk-delete-lines",
          undo: async () => {
            const currentVersionSnapshot = versionRef.current;
            if (!currentVersionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const undoSnapshot = itemsRef.current;
            try {
              const recreated = await recreateItemsFromSnapshots(
                currentVersionSnapshot.id,
                selectedLines
              );
              setItems([...undoSnapshot, ...recreated.createdItems]);
              await applySiblingOrder(
                currentVersionSnapshot.id,
                siblingOrderByParent,
                recreated.idMap
              );
              currentDeletedLineIds = selectedLines.map(
                (line) => recreated.idMap.get(line.id) ?? line.id
              );
              setTotalsOutOfSync(false);
            } catch (error) {
              await reloadItems();
              throw error;
            }
          },
          redo: async () => {
            const currentVersionSnapshot = versionRef.current;
            if (!currentVersionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const redoSnapshot = itemsRef.current;
            const toDelete = new Set(currentDeletedLineIds);
            setItems((previous) =>
              previous.filter((item) => !toDelete.has(item.id))
            );

            try {
              for (const lineId of currentDeletedLineIds) {
                await deleteEstimateItem(currentVersionSnapshot.id, lineId);
              }
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch (error) {
        setItems(snapshot);
        if (deletedCount > 0) {
          const hasConflict = handleVersionConflict(error, { persistDraft: true });
          if (!hasConflict) {
            triggerVersionReload();
          }

          const baseMessage = resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible de supprimer toutes les lignes selectionnees."
          );
          setActionError(
            `Suppression partielle detectee (${deletedCount}/${selectedLines.length}) : ${baseMessage}. La version a ete rechargee; verifiez les lignes puis reessayez.`
          );
          return;
        }

        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible de supprimer les lignes selectionnees."
            )
          );
        }
      }
    },
    [
      ensureGroupedActionCanProceed,
      handleVersionConflict,
      isReadOnly,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      applySiblingOrder,
      readOnlyActionErrorMessage,
      reloadItems,
      triggerVersionReload,
    ]
  );

  const handleBulkMoveLines = useCallback(
    async (itemIds: string[], targetParentId: string | null) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const canProceed = await ensureGroupedActionCanProceed(
        "deplacer les lignes selectionnees"
      );
      if (!canProceed) {
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      const selectedIdSet = new Set(itemIds);
      const snapshot = itemsRef.current;
      const lineById = new Map(
        snapshot
          .filter((item): item is EstimateItem => item.item_type === "line")
          .map((item) => [item.id, item])
      );
      const selectedLines = itemIds
        .map((itemId) => lineById.get(itemId) ?? null)
        .filter((item): item is EstimateItem => item !== null);

      if (selectedLines.length === 0) return;

      setActionError(null);
      let nextPosition =
        snapshot
          .filter(
            (item) =>
              item.parent_id === targetParentId && !selectedIdSet.has(item.id)
          )
          .reduce((max, item) => Math.max(max, item.position), 0) + 1;

      const movedLines = selectedLines.map((line) => {
        const moved = {
          ...line,
          parent_id: targetParentId,
          position: nextPosition,
        };
        nextPosition += 1;
        return moved;
      });

      try {
        await applyBulkLineState(
          movedLines,
          "Impossible de deplacer les lignes selectionnees."
        );
        pushHistoryCommand({
          label: "bulk-move-lines",
          undo: async () => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le deplacement des lignes."
            );
          },
          redo: async () => {
            await applyBulkLineState(
              movedLines,
              "Impossible de reappliquer le deplacement des lignes."
            );
          },
        });
      } catch (error) {
        void error;
      }
    },
    [
      applyBulkLineState,
      ensureGroupedActionCanProceed,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
    ]
  );

  const handleBulkSetCategory = useCallback(
    async (itemIds: string[], categoryId: string | null) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const canProceed = await ensureGroupedActionCanProceed(
        "appliquer la categorie en lot"
      );
      if (!canProceed) {
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      const selectedIdSet = new Set(itemIds);
      const snapshot = itemsRef.current;
      const selectedLines = snapshot.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIdSet.has(item.id)
      );

      if (selectedLines.length === 0) return;

      const updatedLines = selectedLines.map((line) => ({
        ...line,
        category_id: categoryId,
      }));

      setActionError(null);
      try {
        await applyBulkLineState(
          updatedLines,
          "Impossible d'appliquer la categorie en lot."
        );
        pushHistoryCommand({
          label: "bulk-set-category",
          undo: async () => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler la categorie en lot."
            );
          },
          redo: async () => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer la categorie en lot."
            );
          },
        });
      } catch (error) {
        void error;
      }
    },
    [
      applyBulkLineState,
      ensureGroupedActionCanProceed,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
    ]
  );

  const handleBulkSetLaborRole = useCallback(
    async (itemIds: string[], laborRoleId: string | null) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const canProceed = await ensureGroupedActionCanProceed(
        "appliquer le role MO en lot"
      );
      if (!canProceed) {
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        return;
      }

      const selectedIdSet = new Set(itemIds);
      const snapshot = itemsRef.current;
      const selectedLines = snapshot.filter(
        (item): item is EstimateItem =>
          item.item_type === "line" && selectedIdSet.has(item.id)
      );

      if (selectedLines.length === 0) return;

      setActionError(null);
      const marginMultiplier = settings?.margin_multiplier ?? 1;
      const fallbackTaxRateBp = settings?.tax_rate_bp ?? versionSnapshot.tax_rate_bp ?? 0;

      const updatedLines = selectedLines.map((line) => {
        const nextLine: EstimateItem = {
          ...line,
          labor_role_id: laborRoleId,
          ...(isLaborSplitEnabled
            ? {
                labor_role_atelier_id: laborRoleId,
                labor_role_chantier_id: laborRoleId,
              }
            : {}),
        };
        const taxRate = nextLine.tax_rate_bp ?? fallbackTaxRateBp;
        const { lineInput, lineValues } = computeLineValuesWithLaborContext(nextLine, {
          marginMultiplier,
          taxRateBp: taxRate,
        });

        return {
          ...nextLine,
          tax_rate_bp: lineInput.tax_rate_bp,
          k_fo: lineInput.k_fo,
          h_mo: lineInput.h_mo,
          h_mo_majoration: lineInput.h_mo_majoration,
          k_mo: lineInput.k_mo,
          ...(isLaborSplitEnabled || hasLaborSplitFields(lineInput)
            ? (readLaborSplitFields(lineInput) as LaborSplitItemFields)
            : {}),
          pu_ht_cents: lineValues.puHtCents,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        };
      });

      try {
        await applyBulkLineState(
          updatedLines,
          "Impossible d'appliquer le role MO en lot."
        );
        pushHistoryCommand({
          label: "bulk-set-labor-role",
          undo: async () => {
            await applyBulkLineState(
              selectedLines,
              "Impossible d'annuler le role MO en lot."
            );
          },
          redo: async () => {
            await applyBulkLineState(
              updatedLines,
              "Impossible de reappliquer le role MO en lot."
            );
          },
        });
      } catch (error) {
        void error;
      }
    },
    [
      applyBulkLineState,
      computeLineValuesWithLaborContext,
      ensureGroupedActionCanProceed,
      isLaborSplitEnabled,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
    ]
  );

  const handleToggleOutlierDismiss = useCallback(
    async (
      itemId: string,
      flagKey: EstimateOutlierFlagKey,
      dismissed: boolean
    ) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (isConflictLocked) {
        setActionError(
          conflictState?.message ?? "Version modifiee par un autre utilisateur"
        );
        return;
      }
      if (!version?.id) {
        setActionError("Version introuvable.");
        return;
      }

      setActionError(null);
      setOutlierActionPendingByItemId((prev) => ({
        ...prev,
        [itemId]: true,
      }));

      try {
        const nextDismissed = await toggleEstimateOutlierDismissedFlag(version.id, {
          itemId,
          flagKey,
          dismissed,
        });
        setDismissedOutlierFlagsByItemId(nextDismissed);
      } catch (error) {
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible de mettre a jour l'acceptation de l'outlier."
            )
          );
        }
      } finally {
        setOutlierActionPendingByItemId((prev) => {
          if (!prev[itemId]) return prev;
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
      }
    },
    [
      conflictState?.message,
      handleVersionConflict,
      isConflictLocked,
      isReadOnly,
      readOnlyActionErrorMessage,
      version?.id,
    ]
  );

  const handleReorder = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      const snapshot = itemsRef.current;
      const hasPendingCreation = orderedIds.some((id) => {
        const item = snapshot.find((candidate) => candidate.id === id);
        if (!item) return false;
        return isPendingCreateEstimateItem(item) || isTempEstimateItemId(item.id);
      });
      if (hasPendingCreation) {
        setActionError(
          "Impossible de reordonner tant que des elements en creation ne sont pas synchronises."
        );
        return;
      }
      const previousOrderedIds = snapshot
        .filter((item) => item.parent_id === parentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      if (previousOrderedIds.join("|") === orderedIds.join("|")) {
        return;
      }
      const updated = snapshot.map((item) => {
        if (item.parent_id !== parentId) return item;
        const index = orderedIds.indexOf(item.id);
        if (index === -1) return item;
        return { ...item, position: index + 1 };
      });

      setItems(updated);

      if (!version?.id) {
        setActionError("Version introuvable.");
        setItems(snapshot);
        return;
      }

      try {
        await reorderEstimateItems(version.id, parentId, orderedIds);
        pushHistoryCommand({
          label: "reorder",
          undo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const undoSnapshot = itemsRef.current;
            const undoItems = undoSnapshot.map((item) => {
              if (item.parent_id !== parentId) return item;
              const index = previousOrderedIds.indexOf(item.id);
              if (index === -1) return item;
              return { ...item, position: index + 1 };
            });
            setItems(undoItems);
            try {
              await reorderEstimateItems(
                versionSnapshot.id,
                parentId,
                previousOrderedIds
              );
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(undoSnapshot);
              throw error;
            }
          },
          redo: async () => {
            const versionSnapshot = versionRef.current;
            if (!versionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const redoSnapshot = itemsRef.current;
            const redoItems = redoSnapshot.map((item) => {
              if (item.parent_id !== parentId) return item;
              const index = orderedIds.indexOf(item.id);
              if (index === -1) return item;
              return { ...item, position: index + 1 };
            });
            setItems(redoItems);
            try {
              await reorderEstimateItems(versionSnapshot.id, parentId, orderedIds);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch {
        setActionError("Impossible de reordonner les lignes.");
        setItems(snapshot);
      }
    },
    [isReadOnly, pushHistoryCommand, readOnlyActionErrorMessage, version?.id]
  );

  const handleMoveItem = useCallback<EstimateEditorTableProps["onMoveItem"]>(
    async (
      itemId,
      fromParentId,
      toParentId,
      orderedSourceIds,
      orderedTargetIds
    ) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (fromParentId === toParentId) {
        await handleReorder(fromParentId, orderedTargetIds);
        return;
      }

      const snapshot = itemsRef.current;
      const hasPendingCreation = [itemId, ...orderedSourceIds, ...orderedTargetIds].some(
        (id) => {
          const item = snapshot.find((candidate) => candidate.id === id);
          if (!item) return false;
          return isPendingCreateEstimateItem(item) || isTempEstimateItemId(item.id);
        }
      );
      if (hasPendingCreation) {
        setActionError(
          "Impossible de deplacer tant que des elements en creation ne sont pas synchronises."
        );
        return;
      }
      const movedItem = snapshot.find((item) => item.id === itemId);
      if (!movedItem) return;

      const previousSourceOrderedIds = snapshot
        .filter((item) => item.parent_id === fromParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);
      const previousTargetOrderedIds = snapshot
        .filter((item) => item.parent_id === toParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);

      const movePayload: EstimateItemMovePayload = {
        itemId,
        fromParentId,
        toParentId,
        orderedSourceIds: [...orderedSourceIds],
        orderedTargetIds: [...orderedTargetIds],
      };
      const undoSourceOrderedIds = movePayload.orderedTargetIds.filter(
        (targetItemId) => targetItemId !== itemId
      );
      const undoTargetOrderedIds = movePayload.orderedSourceIds.filter(
        (sourceItemId) => sourceItemId !== itemId
      );
      const previousSourceIndex = previousSourceOrderedIds.indexOf(itemId);
      const undoTargetInsertIndex =
        previousSourceIndex === -1
          ? undoTargetOrderedIds.length
          : Math.min(previousSourceIndex, undoTargetOrderedIds.length);
      undoTargetOrderedIds.splice(undoTargetInsertIndex, 0, itemId);
      const undoMovePayload: EstimateItemMovePayload = {
        itemId,
        fromParentId: toParentId,
        toParentId: fromParentId,
        orderedSourceIds: undoSourceOrderedIds,
        orderedTargetIds: undoTargetOrderedIds,
      };
      const parentUnchanged = (movedItem.parent_id ?? null) === toParentId;
      const sourceOrderUnchanged =
        previousSourceOrderedIds.join("|") === orderedSourceIds.join("|");
      const targetOrderUnchanged =
        previousTargetOrderedIds.join("|") === orderedTargetIds.join("|");
      if (parentUnchanged && sourceOrderUnchanged && targetOrderUnchanged) {
        return;
      }

      const optimisticItems = applyInterParentMoveOptimistically(snapshot, movePayload);
      setActionError(null);
      setItems(optimisticItems);

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot) {
        setActionError("Version introuvable.");
        setItems(snapshot);
        return;
      }

      try {
        await persistMoveItem(versionSnapshot.id, movePayload);
        setTotalsOutOfSync(false);
        pushHistoryCommand({
          label: "move-item",
          undo: async () => {
            const undoVersionSnapshot = versionRef.current;
            if (!undoVersionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const undoSnapshot = itemsRef.current;
            setItems(applyInterParentMoveOptimistically(undoSnapshot, undoMovePayload));

            try {
              await persistMoveItem(undoVersionSnapshot.id, undoMovePayload);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(undoSnapshot);
              throw error;
            }
          },
          redo: async () => {
            const redoVersionSnapshot = versionRef.current;
            if (!redoVersionSnapshot) {
              throw new Error("Version introuvable.");
            }

            const redoSnapshot = itemsRef.current;
            setItems(applyInterParentMoveOptimistically(redoSnapshot, movePayload));

            try {
              await persistMoveItem(redoVersionSnapshot.id, movePayload);
              setTotalsOutOfSync(false);
            } catch (error) {
              setItems(redoSnapshot);
              throw error;
            }
          },
        });
      } catch (error) {
        setItems(snapshot);
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de deplacer l'element."
          )
        );
      }
    },
    [
      handleReorder,
      isReadOnly,
      persistMoveItem,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
    ]
  );

  const handlePasteRows = useCallback<EstimateEditorTableProps["onPasteRows"]>(
    async ({ anchorRowId, rows }) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }

      const versionSnapshot = versionRef.current;
      if (!versionSnapshot || !settings) {
        setActionError("Version introuvable.");
        return;
      }

      const validRows = rows.filter(
        (row) =>
          typeof row.designation === "string" && row.designation.trim().length > 0
      );
      if (validRows.length === 0) {
        setActionError("Aucune ligne valide a inserer.");
        return;
      }

      setActionError(null);
      const snapshot = itemsRef.current;
      const anchorItem = anchorRowId
        ? snapshot.find((item) => item.id === anchorRowId) ?? null
        : null;
      const targetParentId = anchorItem
        ? anchorItem.item_type === "section"
          ? anchorItem.id
          : (anchorItem.parent_id ?? null)
        : null;
      const insertAfterId =
        anchorItem && anchorItem.item_type === "line" ? anchorItem.id : null;
      const beforeOrderedIds = snapshot
        .filter((item) => item.parent_id === targetParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);

      let nextPosition =
        snapshot
          .filter((item) => item.parent_id === targetParentId)
          .reduce((max, item) => Math.max(max, item.position), 0) + 1;

      const createdItems: EstimateItem[] = [];
      const createPayloads: EstimateItemInsertPayload[] = [];
      let nextVersionToken = versionSnapshot.updated_at;
      try {
        for (const row of validRows) {
          const designation = row.designation?.trim() || "Nouvelle ligne";
          const quantity = Math.max(toFiniteNumber(row.quantity, 1), 0);
          const unitPriceHt = Math.max(toFiniteNumber(row.unit_price_ht, 0), 0);
          const unitPriceHtCents = Math.round(unitPriceHt * 100);
          const kFo = Math.max(toFiniteNumber(row.k_fo, 1), 0);
          const hMo = Math.max(toFiniteNumber(row.h_mo, 0), 0);
          const kMo = Math.max(toFiniteNumber(row.k_mo, 1), 0);
          const hMoMajoration = Math.max(
            toFiniteNumber(row.h_mo_majoration, 1),
            0
          );
          const supplyTypeId =
            row.supply_type && row.supply_type.trim().length > 0
              ? (supplyTypeIdByLowerName.get(row.supply_type.trim().toLowerCase()) ??
                null)
              : null;

          const lineInput = {
            quantity,
            unit_price_ht_cents: unitPriceHtCents,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo: hMo,
            h_mo_majoration: hMoMajoration,
            k_mo: kMo,
            pu_ht_cents: 0,
            labor_role_hourly_rate_cents: 0,
            h_mo_atelier: 0,
            k_mo_atelier: 1,
            labor_role_atelier_id: null,
            labor_role_atelier_hourly_rate_cents: 0,
            h_mo_chantier: 0,
            k_mo_chantier: 1,
            labor_role_chantier_id: null,
            labor_role_chantier_hourly_rate_cents: 0,
          };
          const lineValues = computeEstimateLineValues(lineInput, {
            marginMultiplier: settings.margin_multiplier,
            taxRateBp: settings.tax_rate_bp,
            isLaborSplitEnabled,
          });

          const createPayload: EstimateItemInsertPayload = {
            version_id: versionSnapshot.id,
            parent_id: targetParentId,
            item_type: "line",
            position: nextPosition,
            title: designation,
            description: row.unit?.trim() || null,
            quantity,
            unit_price_ht_cents: unitPriceHtCents,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo: hMo,
            h_mo_majoration: hMoMajoration,
            k_mo: kMo,
            pu_ht_cents: lineValues.puHtCents,
            labor_role_id: null,
            category_id: null,
            supply_type_id: supplyTypeId,
            selected_supplier_price_id: null,
            line_total_ht_cents: lineValues.saleLineCents,
            line_tax_cents: lineValues.taxLineCents,
            line_total_ttc_cents: lineValues.ttcLineCents,
          };

          if (isLaborSplitEnabled) {
            createPayload.h_mo_atelier = 0;
            createPayload.k_mo_atelier = 1;
            createPayload.labor_role_atelier_id = null;
            createPayload.h_mo_chantier = 0;
            createPayload.k_mo_chantier = 1;
            createPayload.labor_role_chantier_id = null;
          }

          createPayloads.push(createPayload);
          nextPosition += 1;
        }

        for (
          let startIndex = 0;
          startIndex < createPayloads.length;
          startIndex += PASTE_CREATE_BATCH_MAX_OPERATIONS
        ) {
          const payloadChunk = createPayloads.slice(
            startIndex,
            startIndex + PASTE_CREATE_BATCH_MAX_OPERATIONS
          );
          const batchResult = await batchEstimateOperations(
            versionSnapshot.id,
            nextVersionToken,
            payloadChunk.map((payload) => ({
              op: "create" as const,
              data: payload,
            }))
          );

          if (!batchResult.committed) {
            const failedResult = batchResult.results.find(
              (result) => result.status === "error"
            );
            throw new Error(
              failedResult?.message ??
                "Une operation de creation groupee a echoue."
            );
          }
          nextVersionToken = batchResult.versionToken.updated_at;

          const createdItemsByChunkIndex = new Map<number, EstimateItem>();
          batchResult.results.forEach((result) => {
            if (result.status !== "ok" || result.op !== "create") {
              return;
            }
            if (!isRecord(result.data) || !isRecord(result.data.item)) {
              return;
            }
            createdItemsByChunkIndex.set(
              result.index,
              result.data.item as EstimateItem
            );
          });

          for (let chunkIndex = 0; chunkIndex < payloadChunk.length; chunkIndex += 1) {
            const createdItem = createdItemsByChunkIndex.get(chunkIndex);
            if (!createdItem) {
              throw new Error("Impossible de recuperer les lignes collees.");
            }
            createdItems.push(createdItem);
          }
        }
      } catch (error) {
        if (createdItems.length > 0) {
          await Promise.allSettled(
            createdItems.map((item) => deleteEstimateItem(versionSnapshot.id, item.id))
          );
        }
        throw new Error(
          resolveEstimateActionError(
            error instanceof Error
              ? error.message
              : "Impossible d'inserer les lignes collees."
          )
        );
      }

      if (nextVersionToken !== versionSnapshot.updated_at) {
        setVersion((previous) =>
          previous
            ? {
                ...previous,
                updated_at: nextVersionToken,
              }
            : previous
        );
        if (versionRef.current) {
          versionRef.current = {
            ...versionRef.current,
            updated_at: nextVersionToken,
          };
        }
      }

      const insertedIds = createdItems.map((item) => item.id);
      const mergedItems = [...snapshot, ...createdItems];
      setItems(mergedItems);

      const currentOrderedIds = mergedItems
        .filter((item) => item.parent_id === targetParentId)
        .sort((left, right) => left.position - right.position)
        .map((item) => item.id);

      let afterOrderedIds = currentOrderedIds;
      if (insertAfterId) {
        const withoutInserted = currentOrderedIds.filter(
          (itemId) => !insertedIds.includes(itemId)
        );
        const anchorIndex = withoutInserted.indexOf(insertAfterId);
        if (anchorIndex >= 0) {
          afterOrderedIds = [
            ...withoutInserted.slice(0, anchorIndex + 1),
            ...insertedIds,
            ...withoutInserted.slice(anchorIndex + 1),
          ];
        } else {
          afterOrderedIds = [...withoutInserted, ...insertedIds];
        }
      }

      if (afterOrderedIds.join("|") !== currentOrderedIds.join("|")) {
        try {
          await reorderEstimateItems(
            versionSnapshot.id,
            targetParentId,
            afterOrderedIds
          );
          const nextPositionById = new Map<string, number>();
          afterOrderedIds.forEach((itemId, index) => {
            nextPositionById.set(itemId, index + 1);
          });
          setItems((previous) =>
            previous.map((item) =>
              nextPositionById.has(item.id)
                ? {
                    ...item,
                    position: nextPositionById.get(item.id) ?? item.position,
                  }
                : item
            )
          );
        } catch (error) {
          await reloadItems();
          throw new Error(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible de repositionner les lignes collees."
            )
          );
        }
      }
      setTotalsOutOfSync(false);

      let currentInsertedIds = [...insertedIds];
      pushHistoryCommand({
        label: "paste-insert",
        undo: async () => {
          const undoVersionSnapshot = versionRef.current;
          if (!undoVersionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const undoSnapshot = itemsRef.current;
          const idsToDelete = new Set(currentInsertedIds);
          setItems((previous) =>
            previous.filter((item) => !idsToDelete.has(item.id))
          );

          try {
            for (const itemId of currentInsertedIds) {
              await deleteEstimateItem(undoVersionSnapshot.id, itemId);
            }

            const survivingIds = new Set(
              undoSnapshot
                .filter((item) => !idsToDelete.has(item.id))
                .map((item) => item.id)
            );
            const restoredBeforeOrder = beforeOrderedIds.filter((itemId) =>
              survivingIds.has(itemId)
            );
            if (restoredBeforeOrder.length > 0) {
              await reorderEstimateItems(
                undoVersionSnapshot.id,
                targetParentId,
                restoredBeforeOrder
              );
              const nextPositionById = new Map<string, number>();
              restoredBeforeOrder.forEach((itemId, index) => {
                nextPositionById.set(itemId, index + 1);
              });
              setItems((previous) =>
                previous.map((item) =>
                  nextPositionById.has(item.id)
                    ? {
                        ...item,
                        position: nextPositionById.get(item.id) ?? item.position,
                      }
                    : item
                )
              );
            }
            setTotalsOutOfSync(false);
          } catch (error) {
            setItems(undoSnapshot);
            throw error;
          }
        },
        redo: async () => {
          const redoVersionSnapshot = versionRef.current;
          if (!redoVersionSnapshot) {
            throw new Error("Version introuvable.");
          }

          const redoSnapshot = itemsRef.current;
          const recreated = await recreateItemsFromSnapshots(
            redoVersionSnapshot.id,
            createdItems
          );
          const remappedAfterOrder = afterOrderedIds.map(
            (itemId) => recreated.idMap.get(itemId) ?? itemId
          );

          setItems([...redoSnapshot, ...recreated.createdItems]);
          currentInsertedIds = createdItems.map(
            (item) => recreated.idMap.get(item.id) ?? item.id
          );

          try {
            await reorderEstimateItems(
              redoVersionSnapshot.id,
              targetParentId,
              remappedAfterOrder
            );
            const nextPositionById = new Map<string, number>();
            remappedAfterOrder.forEach((itemId, index) => {
              nextPositionById.set(itemId, index + 1);
            });
            setItems((previous) =>
              previous.map((item) =>
                nextPositionById.has(item.id)
                  ? {
                      ...item,
                      position: nextPositionById.get(item.id) ?? item.position,
                    }
                  : item
              )
            );
            setTotalsOutOfSync(false);
          } catch (error) {
            setItems(redoSnapshot);
            throw error;
          }
        },
      });
    },
    [
      isLaborSplitEnabled,
      isReadOnly,
      pushHistoryCommand,
      readOnlyActionErrorMessage,
      recreateItemsFromSnapshots,
      reloadItems,
      settings,
      supplyTypeIdByLowerName,
    ]
  );

  const handleUndo = useCallback<EstimateEditorTableProps["onUndo"]>(async () => {
    if (isUndoRedoBusyRef.current || !canUndo) return;
    const didUndo = await executeUndo();
    if (!didUndo) {
      setActionError("Impossible d'annuler la derniere action.");
    }
  }, [canUndo, executeUndo]);

  const handleRedo = useCallback<EstimateEditorTableProps["onRedo"]>(async () => {
    if (isUndoRedoBusyRef.current || !canRedo) return;
    const didRedo = await executeRedo();
    if (!didRedo) {
      setActionError("Impossible de retablir la derniere action.");
    }
  }, [canRedo, executeRedo]);

  async function prepareStatusTransition() {
    if (!version || isUpdatingStatus) return null;
    if (isDraftLockPending) {
      setStatusError("Acquisition du verrou de brouillon en cours.");
      return null;
    }
    if (isDraftLockedByOther) {
      setStatusError(`Verrouille par ${lockHolderLabel}.`);
      return null;
    }
    setStatusError(null);

    if (isFlushingBufferedUpdatesRef.current) {
      setStatusError(
        "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
      );
      return null;
    }

    const flushResult = await flushBufferedItemUpdates();
    if (flushResult === "blocked" || flushResult === "error") {
      setStatusError(
        flushResult === "blocked"
          ? "Impossible de changer le statut tant que les modifications locales ne sont pas synchronisees."
          : "Impossible de synchroniser les modifications avant changement de statut."
      );
      return null;
    }
    if (flushResult === "noop" && pendingItemUpdatesRef.current.size > 0) {
      setStatusError(
        "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
      );
      return null;
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot) {
      setStatusError("Version introuvable.");
      return null;
    }

    return versionSnapshot;
  }

  async function applyUpdatedVersion(updatedVersion: EstimateVersionRow) {
    setVersion((prev) =>
      prev
        ? {
            ...prev,
            status: updatedVersion.status,
            updated_at: updatedVersion.updated_at,
            seal_hash: updatedVersion.seal_hash ?? prev.seal_hash,
          }
        : prev
    );

    if (updatedVersion.status !== "draft") {
      try {
        await releaseDraftLock({
          keepalive: true,
        });
      } catch {
        // Non bloquant: le lock expirera via timeout si la release echoue.
      }
    }

    if (isAdmin) {
      void loadTimelineEvents();
    }
  }

  async function handlePrepareSend() {
    const versionSnapshot = await prepareStatusTransition();
    if (!versionSnapshot) return;

    setIsUpdatingStatus(true);
    setSendWorkflowPhase("verification");

    try {
      const gatingResult = await fetchEstimateSendGating(versionSnapshot.id);
      setSendGating(gatingResult);
      setIsSendGatingDialogOpen(true);
    } catch (error) {
      setStatusError(
        resolveEstimateActionError(
          error instanceof Error
            ? error.message
            : "Impossible de verifier les preconditions d'envoi."
        )
      );
    } finally {
      setSendWorkflowPhase(null);
      setIsUpdatingStatus(false);
    }
  }

  async function handleConfirmSend(force: boolean) {
    const versionSnapshot = versionRef.current;
    if (!versionSnapshot || versionSnapshot.status !== "draft") {
      setStatusError("Version introuvable.");
      return;
    }

    setStatusError(null);
    setIsUpdatingStatus(true);
    setSendWorkflowPhase("pdf");

    let sealingTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      const updatePromise = updateEstimateStatus(
        versionSnapshot.id,
        "sent",
        versionSnapshot.updated_at,
        { force }
      );
      sealingTimer = setTimeout(() => {
        setSendWorkflowPhase("sealing");
      }, 250);
      const updatedVersion = await updatePromise;
      setSendGating(null);
      setIsSendGatingDialogOpen(false);
      await applyUpdatedVersion(updatedVersion);
    } catch (error) {
      if (
        isEstimateApiError(error) &&
        error.code === "ESTIMATE_GATING_BLOCKED"
      ) {
        try {
          const gatingResult = await fetchEstimateSendGating(versionSnapshot.id);
          setSendGating(gatingResult);
          setIsSendGatingDialogOpen(true);
        } catch {
          setSendGating(null);
        }
      }
      setStatusError(
        resolveEstimateActionError(
          error instanceof Error ? error.message : "Impossible de mettre a jour le statut."
        )
      );
    } finally {
      if (sealingTimer !== null) {
        clearTimeout(sealingTimer);
      }
      setSendWorkflowPhase(null);
      setIsUpdatingStatus(false);
    }
  }

  async function handleStatusChange(nextStatus: EstimateStatus) {
    if (nextStatus === "sent") {
      await handlePrepareSend();
      return;
    }

    const versionSnapshot = await prepareStatusTransition();
    if (!versionSnapshot) return;

    setIsUpdatingStatus(true);
    try {
      const updatedVersion = await updateEstimateStatus(
        versionSnapshot.id,
        nextStatus,
        versionSnapshot.updated_at
      );
      await applyUpdatedVersion(updatedVersion);
    } catch (error) {
      setStatusError(
        resolveEstimateActionError(
          error instanceof Error ? error.message : "Impossible de mettre a jour le statut."
        )
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  const handleTrackSuggestionCorrections = useCallback<
    NonNullable<EstimateEditorTableProps["onTrackSuggestionCorrections"]>
  >(
    async (corrections) => {
      if (corrections.length === 0) return;

      const currentVersionId = versionRef.current?.id ?? resolvedVersionId;
      if (!currentVersionId) return;

      const trackingResult = await trackSuggestionCorrectionsForVersion({
        versionId: currentVersionId,
        corrections,
      });

      setSuggestionLearningState({
        enabled: trackingResult.enabled,
        by_rule_id: trackingResult.by_rule_id,
      });
    },
    [resolvedVersionId]
  );

  const editorTableProps = useMemo<EstimateEditorTableProps>(
    () => ({
      versionId: version?.id ?? resolvedVersionId,
      items,
      categories,
      supplyTypes,
      laborRoles,
      suggestionRules,
      learningState: suggestionLearningState,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      outlierActionPendingByItemId,
      outlierDetectionMethod: outlierConfig.method,
      outlierThreshold: outlierConfig.threshold,
      qualityFlagsByItemId,
      qualityCounts,
      qualityFilter,
      actionError,
      marginMultiplier:
        totals?.appliedMarginMultiplier ?? editorTableBaseConfig.marginMultiplier,
      discountCents: editorTableBaseConfig.discountCents,
      taxRateBp: editorTableBaseConfig.taxRateBp,
      currency: settings?.currency ?? DEFAULT_ESTIMATE_CURRENCY,
      laborRateById,
      isLaborSplitEnabled,
      isReadOnly: editorTableBaseConfig.isReadOnly,
      isViewerMode: isViewerReadOnly,
      maxSectionDepth: version?.max_section_depth ?? undefined,
      onQualityFilterChange: handleQualityFilterChange,
      onOutlierDetectionMethodChange: handleOutlierMethodChange,
      onOutlierThresholdChange: handleOutlierThresholdChange,
      onToggleOutlierDismiss: handleToggleOutlierDismiss,
      onAddSection: handleAddSection,
      onAddLine: handleAddLine,
      onInsertAssembly: handleInsertAssembly,
      onInsertTemplate: handleInsertTemplate,
      sectionDuplicateTargets,
      onDuplicateSection: handleDuplicateSection,
      onDuplicateSectionToVersion: handleDuplicateSectionToVersion,
      onOpenImportFromEstimateDialog: handleOpenImportFromEstimateDialog,
      onDeleteItem: handleDeleteItem,
      onPatchItem: handlePatchItem,
      onTrackSuggestionCorrections: handleTrackSuggestionCorrections,
      onApplyBulkMajoration: handleApplyBulkMajoration,
      onBulkDeleteLines: handleBulkDeleteLines,
      onBulkMoveLines: handleBulkMoveLines,
      onBulkSetCategory: handleBulkSetCategory,
      onBulkSetLaborRole: handleBulkSetLaborRole,
      onPasteRows: handlePasteRows,
      onUndo: handleUndo,
      onRedo: handleRedo,
      canUndo,
      canRedo,
      isUndoRedoBusy,
      bulkSuggestionEligibleCount,
      onOpenBulkSuggestDialog: handleOpenBulkSuggestDialog,
      onReorder: handleReorder,
      onMoveItem: handleMoveItem,
      scrollToItemId: checklistScrollTargetItemId,
      onScrollToItemHandled: handleChecklistScrollHandled,
      virtualization: editorTableVirtualization,
      onOpenSettings: () => handleOpenSettingsDrawer(),
      headerRight: (
        <EstimateChecklist
          checklist={checklist}
          isCollapsed={isChecklistCollapsed}
          onToggleCollapsed={() =>
            setIsChecklistCollapsed((previous) => !previous)
          }
          onCriterionClick={handleChecklistCriterionClick}
        />
      ),
    }),
    [
      actionError,
      categories,
      detectedOutlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      editorTableBaseConfig,
      editorTableVirtualization,
      handleAddLine,
      handleAddSection,
      handleInsertAssembly,
      handleInsertTemplate,
      handleDuplicateSection,
      handleDuplicateSectionToVersion,
      handleOpenImportFromEstimateDialog,
      handleApplyBulkMajoration,
      handleBulkDeleteLines,
      handleBulkMoveLines,
      handleBulkSetCategory,
      handleBulkSetLaborRole,
      handlePasteRows,
      handleUndo,
      handleRedo,
      handleDeleteItem,
      handleOutlierMethodChange,
      handlePatchItem,
      handleOutlierThresholdChange,
      handleQualityFilterChange,
      handleChecklistScrollHandled,
      handleOpenSettingsDrawer,
      handleReorder,
      handleMoveItem,
      handleOpenBulkSuggestDialog,
      handleToggleOutlierDismiss,
      canUndo,
      canRedo,
      isUndoRedoBusy,
      items,
      isLaborSplitEnabled,
      isViewerReadOnly,
      laborRateById,
      laborRoles,
      outlierActionPendingByItemId,
      sectionDuplicateTargets,
      outlierConfig.method,
      outlierConfig.threshold,
      qualityCounts,
      qualityFilter,
      qualityFlagsByItemId,
      handleTrackSuggestionCorrections,
      supplyTypes,
      suggestionRules,
      suggestionLearningState,
      bulkSuggestionEligibleCount,
      checklistScrollTargetItemId,
      checklist,
      isChecklistCollapsed,
      handleChecklistCriterionClick,
      settings?.currency,
      totals?.appliedMarginMultiplier,
      version?.id,
      version?.max_section_depth,
      resolvedVersionId,
    ]
  );

  const closeSettingsDrawer = useCallback(() => {
    setIsSettingsDrawerOpen(false);
  }, []);
  const closeImportFromEstimateDialog = useCallback(() => {
    setIsImportFromEstimateDialogOpen(false);
  }, []);
  const closeSendGatingDialog = useCallback(() => {
    if (isUpdatingStatus) return;
    setIsSendGatingDialogOpen(false);
  }, [isUpdatingStatus]);

  const toolbarProps: ComponentProps<typeof EstimateEditorToolbar> | null = version
    ? {
        projectName,
        versionNumber: version.version_number,
        status: version.status,
        autoSaveStatus,
        autoSaveStatusLabel,
        autoSaveStatusClassName,
        showAutoSaveStatus: version.status === "draft",
        canSend,
        canAccept,
        canArchive,
        isStatusActionsDisabled:
          isUpdatingStatus ||
          isDraftLockedByOther ||
          isDraftLockAcquiring ||
          isForcingDraftUnlock,
        isUpdatingStatus,
        isDraftLockedByOther,
        isDraftLockAcquiring,
        isForcingDraftUnlock,
        onSend: () => void handleStatusChange("sent"),
        onAccept: () => void handleStatusChange("accepted"),
        onArchive: () => void handleStatusChange("archived"),
        onExportExcel: () => void handleExportExcel(),
        onExportCSV: () => void handleExportCSV(),
        onExportDpgf: () => void handleExportDpgf(),
        onExportBdc: () => void handleExportBdc(),
        onImportDpgfSource: () => void handleImportDpgfSource(),
        showImportDpgfSource: hasLinkedDpgfSource || isLoadingLinkedDpgfSource,
        isExportDisabled,
        isExporting,
        exportLoadingLabel,
        activeExportMode,
        isImportingDpgfSource,
        isImportDpgfSourceDisabled,
        versionId,
      }
    : null;

  const alertsProps = useMemo<ComponentProps<typeof EstimateEditorAlerts>>(
    () => ({
      statusError,
      isViewerReadOnly,
      canSend,
      isSendBlockedForCurrentUser,
      isDraftLockedByOther,
      lockHolderLabel,
      isAdmin,
      isForcingDraftUnlock,
      isDraftLockAcquiring,
      onForceUnlockDraftLock: handleForceUnlockDraftLock,
      draftLockError,
      conflictMessage: conflictState?.message ?? null,
      isReloadingVersion,
      onReloadAfterConflict: handleReloadAfterConflict,
      hasRestorableDraft: Boolean(restorableDraft),
      onRestoreConflictDraft: handleRestoreConflictDraft,
      totalsOutOfSync,
      isSaveBlocked,
      onRetryTotalsSave: retryTotalsSave,
      isStatusReadOnly,
      bulkSuggestAppliedCount: bulkSuggestUndoState?.appliedItemIds.length ?? null,
      onUndoBulkSuggest: handleUndoBulkSuggest,
      isUndoingBulkSuggest,
      isUndoBulkSuggestDisabled: isSaveBlocked,
      importSummaryMessage,
      actionError,
    }),
    [
      actionError,
      bulkSuggestUndoState?.appliedItemIds.length,
      canSend,
      conflictState?.message,
      draftLockError,
      handleForceUnlockDraftLock,
      handleReloadAfterConflict,
      handleRestoreConflictDraft,
      handleUndoBulkSuggest,
      importSummaryMessage,
      isAdmin,
      isDraftLockAcquiring,
      isDraftLockedByOther,
      isForcingDraftUnlock,
      isReloadingVersion,
      isSaveBlocked,
      isSendBlockedForCurrentUser,
      isStatusReadOnly,
      isUndoingBulkSuggest,
      isViewerReadOnly,
      lockHolderLabel,
      restorableDraft,
      retryTotalsSave,
      statusError,
      totalsOutOfSync,
    ]
  );

  const summaryBarProps = useMemo<
    ComponentProps<typeof EstimateSettingsSummaryBar> | null
  >(
    () =>
      settings
        ? {
            totals,
            currency: settings.currency ?? DEFAULT_ESTIMATE_CURRENCY,
            taxRateBp: settings.tax_rate_bp ?? 2000,
            isExpert,
            onOpenSettings: handleOpenSettingsDrawer,
          }
        : null,
    [handleOpenSettingsDrawer, isExpert, settings, totals]
  );

  const drawerProps: ComponentProps<typeof EstimateEditorDrawer> | null =
    version && settings
      ? {
          isOpen: isSettingsDrawerOpen,
          onClose: closeSettingsDrawer,
          actionError,
          projectName,
          versionNumber: version.version_number,
          settings,
          totals,
          isSavingSettings,
          isSaveBlocked,
          onChangeSettings: updateSettings,
          onSaveSettings: handleSaveSettings,
          laborRoles,
          onCreateRole: handleCreateRole,
          onUpdateRole: handleUpdateRole,
          isSavingMarginTiers,
          marginTiersError,
          canEditMarginTiers,
          onCreateTier: handleCreateTier,
          onUpdateTier: handleUpdateTier,
          onDeleteTier: handleDeleteTier,
          suggestionRules,
          categories,
          isSavingRules,
          rulesError,
          onCreateSuggestionRule: handleCreateSuggestionRule,
          onUpdateSuggestionRule: handleUpdateSuggestionRule,
          isAdmin,
          timelineEvents,
          isTimelineLoading,
          timelineError,
          onRefreshTimeline: () => {
            void loadTimelineEvents();
          },
          isAuditLoading,
          auditError,
          auditLogs,
          onRefreshAuditLogs: () => {
            void loadAuditLogs();
          },
          formatAuditTimestamp,
        }
      : null;

  const bulkSuggestDialogProps = useMemo<ComponentProps<typeof BulkSuggestDialog>>(
    () => ({
      isOpen: isBulkSuggestDialogOpen,
      rows: bulkSuggestPreview,
      selectedItemIds: selectedBulkSuggestItemIds,
      isApplying: isApplyingBulkSuggest,
      progress: bulkSuggestProgress,
      showProgress: showBulkSuggestProgress,
      error: bulkSuggestDialogError,
      onClose: handleCloseBulkSuggestDialog,
      onConfirm: () => void handleApplyBulkSuggest(),
      onToggleItem: handleToggleBulkSuggestItem,
      onToggleAll: handleToggleAllBulkSuggestItems,
    }),
    [
      bulkSuggestDialogError,
      bulkSuggestPreview,
      bulkSuggestProgress,
      handleApplyBulkSuggest,
      handleCloseBulkSuggestDialog,
      handleToggleAllBulkSuggestItems,
      handleToggleBulkSuggestItem,
      isApplyingBulkSuggest,
      isBulkSuggestDialogOpen,
      selectedBulkSuggestItemIds,
      showBulkSuggestProgress,
    ]
  );

  const importFromEstimateDialogProps = useMemo<
    ComponentProps<typeof ImportFromEstimateDialog> | null
  >(
    () =>
      isImportFromEstimateDialogOpen && version
        ? {
            isOpen: true,
            targetVersionId: version.id,
            onClose: closeImportFromEstimateDialog,
            onConfirm: handleConfirmImportFromEstimateDialog,
          }
        : null,
    [
      closeImportFromEstimateDialog,
      handleConfirmImportFromEstimateDialog,
      isImportFromEstimateDialogOpen,
      version,
    ]
  );

  const sendGatingDialogProps: ComponentProps<typeof EstimateSendGatingDialog> = {
    isOpen: isSendGatingDialogOpen,
    isSubmitting: isUpdatingStatus,
    phaseLabel: sendWorkflowPhaseLabel,
    blockingFlags: sendGating?.blockingFlags ?? [],
    warningFlags: sendGating?.warningFlags ?? [],
    canForce: isAdmin,
    onClose: closeSendGatingDialog,
    onConfirm: () => void handleConfirmSend(false),
    onForceConfirm: () => void handleConfirmSend(true),
  };

  const stateModel: EstimateEditorStateModel["state"] = {
    versionId,
    resolvedVersionId,
    isLoading,
    loadError,
    version,
    settings,
    isSettingsDrawerOpen,
    isBulkSuggestDialogOpen,
    isImportFromEstimateDialogOpen,
    isSendGatingDialogOpen,
  };

  const actionsModel: EstimateEditorStateModel["actions"] = {
    openSettingsDrawer: handleOpenSettingsDrawer,
    closeSettingsDrawer,
  };

  if (!versionId) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "missing-version",
      },
    };
  }

  if (isLoading) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "loading",
      },
    };
  }

  if (loadError || !version || !settings || !toolbarProps || !summaryBarProps || !drawerProps) {
    return {
      state: stateModel,
      actions: actionsModel,
      meta: {
        kind: "error",
        message: loadError ?? "Impossible de charger le chiffrage.",
      },
    };
  }

  return {
    state: stateModel,
    actions: actionsModel,
    meta: {
      kind: "ready",
      projectId: version.project_id ?? null,
      toolbarProps,
      alertsProps,
      summaryBarProps,
      editorTableProps,
      drawerProps,
      bulkSuggestDialogProps,
      importFromEstimateDialogProps,
      sendGatingDialogProps,
    },
  };
}
