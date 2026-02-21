"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";
import {
  EstimateSettingsPanel,
  type EstimateSettingsState,
} from "@/components/estimates/EstimateSettingsPanel";
import { LaborRolesManager } from "@/components/estimates/LaborRolesManager";
import {
  EstimateSuggestionRulesManager,
  type SuggestionRuleCreatePayload,
} from "@/components/estimates/EstimateSuggestionRulesManager";
import { ExportDropdown } from "@/components/ExportDropdown";
import { useUserContext } from "@/components/UserContext";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
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
  serializeBufferedUpdates,
  shouldFlushBufferedUpdates,
  upsertBufferedUpdate,
} from "@/lib/estimates/bulk-buffer";
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
  resolveEstimateEditorVirtualizationConfig,
  type EstimateEditorVirtualizationRuntimeConfig,
} from "@/lib/estimate-editor-virtualization";
import {
  exportToCSV,
  exportToExcelWithSheets,
  type ExportColumn,
} from "@/lib/export";
import {
  bulkUpdateEstimateItems,
  createEstimateItem,
  createEstimateLaborRole,
  createEstimateSuggestionRule,
  deleteEstimateItem,
  fetchEstimateEditorData,
  fetchEstimateItemsForVersion,
  fetchEstimateOutlierDismissedFlags,
  isEstimateApiError,
  reorderEstimateItems,
  saveEstimateVersion,
  toggleEstimateOutlierDismissedFlag,
  updateEstimateLaborRole,
  updateEstimateStatus,
  updateEstimateSuggestionRule,
} from "@/lib/estimates/client";
import { useDraftLock } from "@/hooks/useDraftLock";
import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type SupplyType = Database["public"]["Tables"]["supply_types"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
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
type EstimateEditorTableProps = ComponentProps<typeof EstimateEditorTable>;
type EstimateEditorVirtualizationConfig = NonNullable<
  EstimateEditorTableProps["virtualization"]
>;

const AUDIT_LOG_LIMIT = 25;
const CONFLICT_DRAFT_STORAGE_PREFIX = "estimate:edit:conflict-draft:";
const AUTOSAVE_BUFFER_STORAGE_PREFIX = "estimate:edit:autosave-buffer:";
const BULK_AUTOSAVE_DEBOUNCE_MS = 2000;
const BULK_AUTOSAVE_IMMEDIATE_FLUSH_UPDATES = 100;
const LABOR_SPLIT_FLAG_KEY = "EST_031_LABOR_SPLIT";
const LABOR_SPLIT_FIELD_KEYS = [
  "h_mo_atelier",
  "k_mo_atelier",
  "labor_role_atelier_id",
  "h_mo_chantier",
  "k_mo_chantier",
  "labor_role_chantier_id",
] as const;
type LaborSplitFieldKey = (typeof LABOR_SPLIT_FIELD_KEYS)[number];
const ESTIMATE_EDITOR_VIRTUALIZATION_CONFIG: EstimateEditorVirtualizationRuntimeConfig =
  resolveEstimateEditorVirtualizationConfig({
    enabled: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ENABLED,
    rowEstimate: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_ROW_ESTIMATE,
    overscan: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_OVERSCAN,
    maxHeight: process.env.NEXT_PUBLIC_ESTIMATE_EDITOR_VIRTUALIZATION_CONTAINER_HEIGHT,
  });

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

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
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

const RECAP_EXPORT_COLUMNS: ExportColumn<EstimateRecapExportRow>[] = [
  { key: "project_name", header: "Projet" },
  { key: "version_id", header: "Version ID" },
  { key: "version_number", header: "Version" },
  { key: "status", header: "Statut" },
  { key: "date_devis", header: "Date devis" },
  { key: "validite_jours", header: "Validite (jours)" },
  { key: "margin_multiplier", header: "Marge (x)" },
  {
    key: "discount_cents",
    header: "Remise (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  { key: "discount_bp", header: "Remise (bp)" },
  {
    key: "tax_rate_bp",
    header: "TVA (%)",
    formatter: (value) => (value as number) / 100,
  },
  { key: "rounding_mode", header: "Mode arrondi" },
  {
    key: "rounding_step_cents",
    header: "Pas arrondi (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  {
    key: "sale_subtotal_cents",
    header: "Sous-total HT (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  {
    key: "sale_total_cents",
    header: "Total HT (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  {
    key: "tax_cents",
    header: "TVA (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  {
    key: "ttc_cents",
    header: "Total TTC (EUR)",
    formatter: (value) => (value as number) / 100,
  },
  { key: "quality_lines_count", header: "Lignes avec anomalies" },
  { key: "quality_flags_count", header: "Nombre total de flags" },
];

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

function estimateStatusLabel(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyee";
    case "accepted":
      return "Acceptee";
    case "archived":
      return "Archivee";
    default:
      return status;
  }
}

function estimateStatusClass(status: EstimateStatus) {
  switch (status) {
    case "draft":
      return "status-badge status-draft";
    case "sent":
      return "status-badge status-sent";
    case "accepted":
      return "status-badge status-accepted";
    case "archived":
      return "status-badge status-archived";
    default:
      return "status-badge status-draft";
  }
}

function resolveEstimateActionError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("row-level security") || normalized.includes("read-only")) {
    return "Cette version est en lecture seule.";
  }
  return message;
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
  };
}

export default function EditEstimatePage() {
  const params = useParams();
  const rawVersionId = params?.["versionId"];
  const versionId = Array.isArray(rawVersionId) ? rawVersionId[0] : rawVersionId;
  const resolvedVersionId = typeof versionId === "string" ? versionId : "";
  const { profile } = useUserContext();
  const { enabled: isLaborSplitEnabled } = useFeatureFlag(LABOR_SPLIT_FLAG_KEY);

  const [version, setVersion] = useState<EstimateVersionView | null>(null);
  const [settings, setSettings] = useState<EstimateSettingsState | null>(null);
  const [savedSettings, setSavedSettings] =
    useState<EstimateSettingsState | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [categories, setCategories] = useState<EstimateCategory[]>([]);
  const [supplyTypes, setSupplyTypes] = useState<SupplyType[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [suggestionRules, setSuggestionRules] = useState<SuggestionRule[]>([]);
  const [dismissedOutlierFlagsByItemId, setDismissedOutlierFlagsByItemId] =
    useState<EstimateOutlierFlagsByItemId>({});
  const [outlierActionPendingByItemId, setOutlierActionPendingByItemId] =
    useState<Record<string, boolean>>({});
  const [outlierConfig, setOutlierConfig] = useState<EstimateOutlierDetectionConfig>(
    DEFAULT_ESTIMATE_OUTLIER_CONFIG
  );
  const [qualityFilter, setQualityFilter] =
    useState<EstimateQualityFilter>("all_lines");
  const [activeTab, setActiveTab] = useState<"settings" | "editor">("settings");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isSavingRules, setIsSavingRules] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [isAuditLoading, setIsAuditLoading] = useState(false);
  const [totalsOutOfSync, setTotalsOutOfSync] = useState(false);
  const [hasPendingBufferedUpdates, setHasPendingBufferedUpdates] = useState(false);
  const [conflictState, setConflictState] = useState<EstimateConflictState | null>(
    null
  );
  const [restorableDraft, setRestorableDraft] =
    useState<EstimateConflictDraft | null>(null);
  const [isReloadingVersion, setIsReloadingVersion] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const itemsRef = useRef<EstimateItem[]>([]);
  const versionRef = useRef<EstimateVersionView | null>(null);
  const persistedTotalsRef = useRef<EstimateTotals | null>(null);
  const isSaveBlockedRef = useRef(false);
  const pendingItemUpdatesRef = useRef<Map<string, EstimateItemUpdatePayload>>(
    new Map()
  );
  const pendingBufferedUpdateCountRef = useRef(0);
  const isFlushingBufferedUpdatesRef = useRef(false);

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
    if (!resolvedVersionId) return;

    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await fetchEstimateEditorData(resolvedVersionId);
        if (!active) return;

        let versionRow = data.version as EstimateVersionView;
        const itemsRows = data.items ?? [];
        const rolesData = data.laborRoles ?? [];

        const rateById = new Map<string, number>();
        rolesData.forEach((role) => {
          rateById.set(role.id, role.hourly_rate_cents);
        });

        const discountCents =
          versionRow.status === "draft"
            ? computeInitialDiscountCents(versionRow, itemsRows, rateById)
            : computeStoredDiscountCents(versionRow, itemsRows);

        const normalizedItems =
          versionRow.status === "draft"
            ? normalizeDraftItems({
                items: itemsRows,
                version: versionRow,
                rateById,
              })
            : itemsRows;

        const initialSettings = {
          title: versionRow.title ?? "",
          date_devis: versionRow.date_devis,
          validite_jours: versionRow.validite_jours,
          margin_multiplier: versionRow.margin_multiplier,
          margin_mode: versionRow.margin_mode ?? "fixed",
          margin_tiers: data.marginTiers ?? [],
          discount_cents: discountCents,
          tax_rate_bp: versionRow.tax_rate_bp,
          rounding_mode: versionRow.rounding_mode,
          rounding_step_cents: versionRow.rounding_step_cents,
        };

        setVersion(versionRow);
        setItems(normalizedItems);
        setCategories(data.categories ?? []);
        setSupplyTypes(data.supplyTypes ?? []);
        setLaborRoles(rolesData);
        setSuggestionRules(data.suggestionRules ?? []);
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
  }, [isLaborSplitEnabled, registerVersionConflict, reloadNonce, resolvedVersionId]);

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
  const lockHolderLabel = draftLockHolderName ?? "un autre utilisateur";
  const isStatusReadOnly = version ? version.status !== "draft" : false;
  const isDraftLockPending =
    version?.status === "draft" &&
    !isDraftLockedByOther &&
    !isDraftLockOwnedByCurrentUser;
  const isReadOnly = isStatusReadOnly || isDraftLockedByOther || isDraftLockPending;
  const isConflictLocked = conflictState !== null;
  const isSaveBlocked = isReadOnly || isConflictLocked;
  const readOnlyActionErrorMessage =
    isDraftLockPending && !isDraftLockedByOther
      ? "Acquisition du verrou de brouillon en cours."
      : isDraftLockedByOther
        ? `Verrouille par ${lockHolderLabel}.`
        : "Cette version est en lecture seule.";
  const canSend = version?.status === "draft";
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
  const editorTableVirtualization: EstimateEditorVirtualizationConfig =
    ESTIMATE_EDITOR_VIRTUALIZATION_CONFIG;
  const handleQualityFilterChange = useCallback(
    (nextFilter: EstimateQualityFilter) => {
      setQualityFilter(nextFilter);
    },
    []
  );
  const handleOutlierMethodChange = useCallback((nextMethod: EstimateOutlierMethod) => {
    setOutlierConfig((previous) => ({
      ...previous,
      method: nextMethod,
    }));
  }, []);
  const handleOutlierThresholdChange = useCallback((nextThreshold: number) => {
    if (!Number.isFinite(nextThreshold) || nextThreshold <= 0) return;
    setOutlierConfig((previous) => ({
      ...previous,
      threshold: nextThreshold,
    }));
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

    draft.buffered_updates.forEach((entry) => {
      upsertBufferedUpdate(pendingItemUpdatesRef.current, entry.id, entry.updates);
    });

    pendingBufferedUpdateCountRef.current = pendingItemUpdatesRef.current.size;
    const hasPendingUpdates = pendingItemUpdatesRef.current.size > 0;
    setHasPendingBufferedUpdates(hasPendingUpdates);

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
      setSettings(restorableDraft.settings);
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

  const laborRoleById = useMemo(() => {
    const map = new Map<string, LaborRole>();
    laborRoles.forEach((role) => {
      map.set(role.id, role);
    });
    return map;
  }, [laborRoles]);

  const detectedOutlierFlagsByItemId = useMemo(
    () =>
      detectEstimateOutliers({
        items,
        categories,
        config: outlierConfig,
      }),
    [categories, items, outlierConfig]
  );

  const qualityFlagsByItemId = useMemo(
    () =>
      computeEstimateQualityFlagsByItemId(items, {
        outlierFlagsByItemId: detectedOutlierFlagsByItemId,
        dismissedOutlierFlagsByItemId,
      }),
    [detectedOutlierFlagsByItemId, dismissedOutlierFlagsByItemId, items]
  );

  const qualityCounts = useMemo(
    () => countEstimateQualityFlags(qualityFlagsByItemId),
    [qualityFlagsByItemId]
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
      const readOnlyTotalsInput = {
        items,
        version,
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
        ? Math.round((settings.discount_cents / discountBase) * 10000)
        : 0;

    return {
      project_name: projectName || "Chiffrage",
      version_id: version.id,
      version_number: version.version_number,
      status: version.status,
      date_devis: settings.date_devis,
      validite_jours: settings.validite_jours,
      margin_multiplier: totals.appliedMarginMultiplier,
      discount_cents: settings.discount_cents,
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

  const buildLineRows = useCallback((): EstimateLineExportRow[] => {
    const resolveSectionPath = buildSectionPathResolver(items);
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

        return {
          section_path: resolveSectionPath(item),
          designation: resolveItemTitle(item.title, "Sans titre"),
          quality_flags: qualityFlagsLabel,
          unit: item.description?.trim() ?? "",
          quantity: item.quantity ?? "",
          unit_price_ht_cents: item.unit_price_ht_cents ?? "",
          supply_type: supplyTypeLabel,
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
  }, [items, laborRoleById, qualityFlagsByItemId, supplyTypeById]);

  const lineExportColumns = useMemo(
    () =>
      isLaborSplitEnabled
        ? LINE_EXPORT_COLUMNS_WITH_LABOR_SPLIT
        : LINE_EXPORT_COLUMNS,
    [isLaborSplitEnabled]
  );

  const handleExportExcel = useCallback(() => {
    if (isExporting) return;
    const recapRow = buildRecapRow();
    if (!recapRow) return;

    setIsExporting(true);
    try {
      const lines = buildLineRows();
      const filename = buildExportFilename();
      exportToExcelWithSheets(
        [
          {
            name: "Recap",
            data: [recapRow],
            columns: RECAP_EXPORT_COLUMNS,
          },
          {
            name: "Lignes",
            data: lines,
            columns: lineExportColumns,
          },
        ],
        { filename }
      );
    } catch (error) {
      console.error("Erreur lors de l'export Excel.", error);
    } finally {
      setIsExporting(false);
    }
  }, [
    buildExportFilename,
    buildLineRows,
    buildRecapRow,
    isExporting,
    lineExportColumns,
  ]);

  const handleExportCSV = useCallback(() => {
    if (isExporting) return;
    const recapRow = buildRecapRow();
    if (!recapRow) return;

    setIsExporting(true);
    try {
      const lines = buildLineRows();
      const filename = buildExportFilename();
      exportToCSV(lines, lineExportColumns, { filename });
    } catch (error) {
      console.error("Erreur lors de l'export CSV.", error);
    } finally {
      setIsExporting(false);
    }
  }, [
    buildExportFilename,
    buildLineRows,
    buildRecapRow,
    isExporting,
    lineExportColumns,
  ]);

  const isExportDisabled = isExporting || !version || !settings || !totals;

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

    try {
      const bulkResult = await bulkUpdateEstimateItems(
        versionSnapshot.id,
        versionSnapshot.updated_at,
        bufferedEntries,
        versionTotalsPatch
      );

      setTotalsOutOfSync(false);
      setVersion((prev) =>
        prev
          ? {
              ...prev,
              ...(versionTotalsPatch ?? {}),
              updated_at: bulkResult.versionToken.updated_at,
            }
          : prev
      );
      const nextVersionSnapshot = versionRef.current
        ? {
            ...versionRef.current,
            ...(versionTotalsPatch ?? {}),
            updated_at: bulkResult.versionToken.updated_at,
          }
        : null;
      if (nextVersionSnapshot) {
        versionRef.current = nextVersionSnapshot;
      }
      if (resolvedVersionId) {
        clearAutoSaveDraftFromLocal(resolvedVersionId);
      }
      setHasPendingBufferedUpdates(pendingItemUpdatesRef.current.size > 0);
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
  }, [handleVersionConflict, persistBufferedItemUpdatesToLocal, resolvedVersionId]);

  const {
    status: autoSaveStatus,
    statusLabel: autoSaveStatusLabel,
    flushNow: flushAutoSaveNow,
    scheduleSave: scheduleAutoSave,
  } = useAutoSave({
    enabled: Boolean(resolvedVersionId && !isSaveBlocked),
    hasPendingChanges: hasPendingBufferedUpdates,
    debounceMs: BULK_AUTOSAVE_DEBOUNCE_MS,
    onSave: flushBufferedItemUpdates,
  });

  const autoSaveStatusClassName = useMemo(() => {
    if (autoSaveStatus === "saving") return "status-badge status-sent";
    if (autoSaveStatus === "error") return "status-badge status-canceled";
    return "status-badge status-confirmed";
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
        setItems(itemsRows);
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

      setItems(normalizedItems);
    } catch (error) {
      const message =
        error instanceof Error
          ? resolveEstimateActionError(error.message)
          : "Impossible de charger les lignes.";
      setActionError(message);
    }
  }, [laborRateById, resolvedVersionId, version]);

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
        ? Math.round((settings.discount_cents / discountBase) * 10000)
        : 0;

    const payload: Database["public"]["Tables"]["estimate_versions"]["Update"] = {
      title: settings.title.trim() || null,
      date_devis: settings.date_devis,
      validite_jours: settings.validite_jours,
      margin_multiplier: totals.appliedMarginMultiplier,
      margin_mode: settings.margin_mode ?? "fixed",
      discount_bp: discountBp,
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
    };
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

  const handleAddSection = useCallback(
    async (parentId: string | null) => {
      if (!version) return;
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);

      let data: EstimateItem;
      try {
        data = await createEstimateItem(version.id, {
          version_id: version.id,
          parent_id: parentId,
          item_type: "section",
          position,
          title: parentId ? "Nouveau sous-chapitre" : "Nouveau chapitre",
        });
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de creer le chapitre."
          )
        );
        return;
      }

      setItems((prev) => [...prev, data]);
    },
    [getNextPosition, isReadOnly, readOnlyActionErrorMessage, version]
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

      let data: EstimateItem;
      try {
        const createPayload: Database["public"]["Tables"]["estimate_items"]["Insert"] &
          LaborSplitItemFields = {
          version_id: version.id,
          parent_id: parentId,
          item_type: "line",
          position,
          title: "Nouvelle ligne",
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
        data = await createEstimateItem(version.id, createPayload);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible d'ajouter la ligne."
          )
        );
        return;
      }

      setItems((prev) => [...prev, data]);
    },
    [
      getNextPosition,
      isLaborSplitEnabled,
      isReadOnly,
      readOnlyActionErrorMessage,
      settings,
      version,
    ]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (isReadOnly) {
        setActionError(readOnlyActionErrorMessage);
        return;
      }
      if (!window.confirm("Supprimer cet element et son contenu ?")) return;
      setActionError(null);

      const snapshot = itemsRef.current;
      const idsToRemove = new Set<string>();

      function collect(id: string) {
        idsToRemove.add(id);
        snapshot
          .filter((item) => item.parent_id === id)
          .forEach((child) => collect(child.id));
      }

      collect(itemId);
      setItems((prev) => prev.filter((item) => !idsToRemove.has(item.id)));

      if (!version?.id) {
        setActionError("Version introuvable.");
        await reloadItems();
        return;
      }

      try {
        await deleteEstimateItem(version.id, itemId);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de supprimer la ligne."
          )
        );
        await reloadItems();
      }
    },
    [isReadOnly, readOnlyActionErrorMessage, reloadItems, version?.id]
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

      let updated: EstimateItem = { ...current, ...patch };

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

      setItems((prev) =>
        prev.map((item) => (item.id === itemId ? updated : item))
      );

      if (!persist) return;

      if (!version?.id) {
        setActionError("Version introuvable.");
        setItems(snapshot);
        return;
      }

      enqueueBufferedItemUpdate(itemId, buildEstimateItemUpdatePayload(updated));
      setTotalsOutOfSync(false);
    },
    [
      enqueueBufferedItemUpdate,
      computeLineValuesWithLaborContext,
      isLaborSplitEnabled,
      isReadOnly,
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

      const updatedById = new Map(updatedLines.map((item) => [item.id, item]));
      setItems((prev) => prev.map((item) => updatedById.get(item.id) ?? item));

      try {
        const bulkResult = await bulkUpdateEstimateItems(
          versionSnapshot.id,
          versionSnapshot.updated_at,
          updatedLines.map((item) => ({
            id: item.id,
            updates: buildEstimateItemUpdatePayload(item),
          }))
        );

        setVersion((prev) =>
          prev
            ? {
                ...prev,
                updated_at: bulkResult.versionToken.updated_at,
              }
            : prev
        );
        setTotalsOutOfSync(false);
      } catch (error) {
        setItems(snapshot);
        if (!handleVersionConflict(error, { persistDraft: true })) {
          setActionError(
            resolveEstimateActionError(
              error instanceof Error
                ? error.message
                : "Impossible d'appliquer la majoration en lot."
            )
          );
        }
      }
    },
    [
      computeLineValuesWithLaborContext,
      handleVersionConflict,
      isLaborSplitEnabled,
      isReadOnly,
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
      } catch {
        setActionError("Impossible de reordonner les lignes.");
        setItems(snapshot);
      }
    },
    [isReadOnly, readOnlyActionErrorMessage, version?.id]
  );

  async function handleStatusChange(nextStatus: EstimateStatus) {
    if (!version || isUpdatingStatus) return;
    if (isDraftLockPending) {
      setStatusError("Acquisition du verrou de brouillon en cours.");
      return;
    }
    if (isDraftLockedByOther) {
      setStatusError(`Verrouille par ${lockHolderLabel}.`);
      return;
    }
    setStatusError(null);
    setIsUpdatingStatus(true);

    if (isFlushingBufferedUpdatesRef.current) {
      setStatusError(
        "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
      );
      setIsUpdatingStatus(false);
      return;
    }

    const flushResult = await flushBufferedItemUpdates();
    if (flushResult === "blocked" || flushResult === "error") {
      setStatusError(
        flushResult === "blocked"
          ? "Impossible de changer le statut tant que les modifications locales ne sont pas synchronisees."
          : "Impossible de synchroniser les modifications avant changement de statut."
      );
      setIsUpdatingStatus(false);
      return;
    }
    if (flushResult === "noop" && pendingItemUpdatesRef.current.size > 0) {
      setStatusError(
        "Synchronisation des modifications en cours. Reessayez dans quelques secondes."
      );
      setIsUpdatingStatus(false);
      return;
    }

    const versionSnapshot = versionRef.current;
    if (!versionSnapshot) {
      setStatusError("Version introuvable.");
      setIsUpdatingStatus(false);
      return;
    }

    let updatedVersion: EstimateVersionRow;

    try {
      updatedVersion = await updateEstimateStatus(
        versionSnapshot.id,
        nextStatus,
        versionSnapshot.updated_at
      );
    } catch (error) {
      setStatusError(
        resolveEstimateActionError(
          error instanceof Error ? error.message : "Impossible de mettre a jour le statut."
        )
      );
      setIsUpdatingStatus(false);
      return;
    }

    setIsUpdatingStatus(false);
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
  }

  const editorTableProps = useMemo<EstimateEditorTableProps>(
    () => ({
      versionId: version?.id ?? resolvedVersionId,
      items,
      categories,
      supplyTypes,
      laborRoles,
      suggestionRules,
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
      laborRateById,
      isLaborSplitEnabled,
      isReadOnly: editorTableBaseConfig.isReadOnly,
      onQualityFilterChange: handleQualityFilterChange,
      onOutlierDetectionMethodChange: handleOutlierMethodChange,
      onOutlierThresholdChange: handleOutlierThresholdChange,
      onToggleOutlierDismiss: handleToggleOutlierDismiss,
      onAddSection: handleAddSection,
      onAddLine: handleAddLine,
      onDeleteItem: handleDeleteItem,
      onPatchItem: handlePatchItem,
      onApplyBulkMajoration: handleApplyBulkMajoration,
      onReorder: handleReorder,
      virtualization: editorTableVirtualization,
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
      handleApplyBulkMajoration,
      handleDeleteItem,
      handleOutlierMethodChange,
      handlePatchItem,
      handleOutlierThresholdChange,
      handleQualityFilterChange,
      handleReorder,
      handleToggleOutlierDismiss,
      items,
      isLaborSplitEnabled,
      laborRateById,
      laborRoles,
      outlierActionPendingByItemId,
      outlierConfig.method,
      outlierConfig.threshold,
      qualityCounts,
      qualityFilter,
      qualityFlagsByItemId,
      supplyTypes,
      suggestionRules,
      totals?.appliedMarginMultiplier,
      version?.id,
      resolvedVersionId,
    ]
  );

  if (!versionId) {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          Version introuvable.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="animate-fade-in flex min-h-[300px] items-center justify-center">
        <div className="flex items-center gap-3 text-[var(--slate-500)]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--slate-200)] border-t-[var(--brand-blue)]"></div>
          Chargement du chiffrage...
        </div>
      </div>
    );
  }

  if (loadError || !version || !settings) {
    return (
      <div className="animate-fade-in">
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {loadError ?? "Impossible de charger le chiffrage."}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Editer le chiffrage</h1>
          <p className="page-description">
            Version{" "}
            <span className="font-mono text-[var(--slate-600)]">
              {versionId}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={estimateStatusClass(version.status)}>
            {estimateStatusLabel(version.status)}
          </span>
          {version.status === "draft" ? (
            <span className={autoSaveStatusClassName}>{autoSaveStatusLabel}</span>
          ) : null}
          <ExportDropdown
            onExportExcel={handleExportExcel}
            onExportCSV={handleExportCSV}
            disabled={isExportDisabled}
          />
          <SaveAsTemplateButton versionId={versionId} />
          {canSend ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => handleStatusChange("sent")}
              disabled={
                isUpdatingStatus ||
                isDraftLockedByOther ||
                isDraftLockAcquiring ||
                isForcingDraftUnlock
              }
            >
              Envoyer
            </button>
          ) : null}
          {canAccept ? (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => handleStatusChange("accepted")}
              disabled={
                isUpdatingStatus ||
                isDraftLockedByOther ||
                isDraftLockAcquiring ||
                isForcingDraftUnlock
              }
            >
              Accepter
            </button>
          ) : null}
          {canArchive ? (
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => handleStatusChange("archived")}
              disabled={
                isUpdatingStatus ||
                isDraftLockedByOther ||
                isDraftLockAcquiring ||
                isForcingDraftUnlock
              }
            >
              Archiver
            </button>
          ) : null}
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId ?? ""}`}
          >
            Retour
          </Link>
        </div>
      </div>

      {statusError && (
        <div className="alert alert-error mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {statusError}
        </div>
      )}

      {isDraftLockedByOther && (
        <div className="alert alert-warning mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Verrouille par {lockHolderLabel}.</span>
          </div>
          {isAdmin ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void handleForceUnlockDraftLock()}
              disabled={isForcingDraftUnlock || isDraftLockAcquiring}
            >
              {isForcingDraftUnlock
                ? "Deverrouillage..."
                : "Forcer le deverrouillage"}
            </button>
          ) : null}
        </div>
      )}

      {draftLockError && !isDraftLockedByOther && (
        <div className="alert alert-warning mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {draftLockError}
        </div>
      )}

      {conflictState && (
        <div className="alert alert-warning mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              {conflictState.message}. Rechargez la version pour recuperer les
              donnees serveur.
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={handleReloadAfterConflict}
            disabled={isReloadingVersion}
          >
            {isReloadingVersion ? "Rechargement..." : "Recharger"}
          </button>
        </div>
      )}

      {restorableDraft && !conflictState && (
        <div className="alert alert-info mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4" />
              <path d="M12 16h.01" />
            </svg>
            <span>
              Des modifications locales ont ete conservees en memoire de session.
            </span>
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={handleRestoreConflictDraft}
          >
            Restaurer mes changements
          </button>
        </div>
      )}

      {totalsOutOfSync && !isSaveBlocked && (
        <div className="alert alert-warning mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Les totaux n&apos;ont pas pu etre sauvegardes. Vos modifications locales sont conservees.
          </div>
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            onClick={() => void retryTotalsSave()}
          >
            Reessayer
          </button>
        </div>
      )}

      {isStatusReadOnly && (
        <div className="alert alert-info mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" />
            <path d="M12 16h.01" />
          </svg>
          Cette version est en lecture seule car son statut n&apos;est plus brouillon.
        </div>
      )}

      <div className="estimate-tabs mt-6">
        <button
          className={`estimate-tab ${
            activeTab === "settings" ? "estimate-tab--active" : ""
          }`}
          type="button"
          onClick={() => setActiveTab("settings")}
        >
          Parametrage
        </button>
        <button
          className={`estimate-tab ${
            activeTab === "editor" ? "estimate-tab--active" : ""
          }`}
          type="button"
          onClick={() => setActiveTab("editor")}
        >
          Editeur
        </button>
      </div>

      {activeTab === "settings" ? (
        <div className="space-y-6 mt-6">
          {actionError && (
            <div className="alert alert-error">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="m15 9-6 6" />
                <path d="m9 9 6 6" />
              </svg>
              {actionError}
            </div>
          )}
          <EstimateSettingsPanel
            projectName={projectName}
            versionNumber={version.version_number}
            settings={settings}
            totals={totals}
            isSaving={isSavingSettings}
            isReadOnly={isSaveBlocked}
            error={null}
            onChange={updateSettings}
            onSave={handleSaveSettings}
          />
          <LaborRolesManager
            roles={laborRoles}
            isSaving={isSavingSettings || isSaveBlocked}
            error={null}
            onCreate={handleCreateRole}
            onUpdate={handleUpdateRole}
          />
          <EstimateSuggestionRulesManager
            rules={suggestionRules}
            categories={categories}
            laborRoles={laborRoles}
            isSaving={isSavingRules || isSaveBlocked}
            error={rulesError}
            onCreate={handleCreateSuggestionRule}
            onUpdate={handleUpdateSuggestionRule}
          />
          {isAdmin ? (
            <div className="dashboard-card p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--slate-800)]">
                    Audit admin
                  </h2>
                  <p className="text-xs text-[var(--slate-500)]">
                    Dernieres operations journalisees sur cette version.
                  </p>
                </div>
                <button
                  className="btn btn-secondary btn-sm"
                  type="button"
                  onClick={() => void loadAuditLogs()}
                  disabled={isAuditLoading}
                >
                  {isAuditLoading ? "Chargement..." : "Actualiser"}
                </button>
              </div>

              {auditError ? (
                <div className="alert alert-error mt-6">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <path d="m15 9-6 6" />
                    <path d="m9 9 6 6" />
                  </svg>
                  {auditError}
                </div>
              ) : null}

              <div className="table-scroll mt-6">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Table</th>
                      <th>Record ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={4}>
                          <div className="text-sm text-[var(--slate-500)]">
                            {isAuditLoading
                              ? "Chargement des logs d'audit..."
                              : "Aucun log d'audit recent pour cette version."}
                          </div>
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id}>
                          <td>{formatAuditTimestamp(log.created_at)}</td>
                          <td className="font-medium uppercase">{log.action}</td>
                          <td>
                            <span className="font-mono text-xs text-[var(--slate-600)]">
                              {log.table_name}
                            </span>
                          </td>
                          <td>
                            <span className="font-mono text-xs text-[var(--slate-600)]">
                              {log.record_id}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {isAuditLoading && auditLogs.length > 0 ? (
                <p className="mt-3 text-sm text-[var(--slate-500)]">
                  Actualisation des logs en cours...
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-6">
          <EstimateEditorTable {...editorTableProps} />
        </div>
      )}
    </div>
  );
}
