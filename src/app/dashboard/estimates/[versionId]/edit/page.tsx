"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EstimateEditorTable } from "@/components/estimates/EstimateEditorTable";
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
import {
  computeEstimateLineValues,
  computeEstimateTotals,
  type EstimateTotals,
} from "@/lib/estimate-calculations";
import {
  countEstimateQualityFlags,
  computeEstimateQualityFlagsByItemId,
  ESTIMATE_QUALITY_FLAG_META,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  exportToCSV,
  exportToExcelWithSheets,
  type ExportColumn,
} from "@/lib/export";
import {
  bulkUpdateEstimateItems,
  createEstimateCategory,
  createEstimateItem,
  createEstimateLaborRole,
  createEstimateSuggestionRule,
  deleteEstimateItem,
  fetchEstimateEditorData,
  fetchEstimateItemsForVersion,
  reorderEstimateItems,
  saveEstimateVersion,
  updateEstimateItem,
  updateEstimateLaborRole,
  updateEstimateStatus,
  updateEstimateSuggestionRule,
} from "@/lib/estimates/client";
import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];
type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateQualityFilter = "all_lines" | "with_anomalies" | EstimateQualityFlagKey;

type EstimateVersionView = EstimateVersionRow & {
  estimate_projects: { name: string } | { name: string }[] | null;
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
    | "k_mo"
    | "pu_ht_cents"
    | "labor_role_id"
    | "category_id"
  >
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
  category: string;
  k_fo: number | "";
  h_mo: number | "";
  labor_role: string;
  k_mo: number | "";
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

const AUDIT_LOG_LIMIT = 25;

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

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
  { key: "category", header: "Categorie" },
  { key: "k_fo", header: "K FO" },
  { key: "h_mo", header: "h MO" },
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

function computeInitialDiscountCents(
  version: EstimateVersionRow,
  items: EstimateItem[],
  laborRoles: LaborRole[]
) {
  const rateById = new Map<string, number>();
  laborRoles.forEach((role) => {
    rateById.set(role.id, role.hourly_rate_cents);
  });

  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? rateById.get(item.labor_role_id) ?? 0
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: version.tax_rate_bp,
      }
    );
    return sum + lineValues.saleLineCents;
  }, 0);

  if (!saleSubtotal) return 0;
  return Math.round((saleSubtotal * version.discount_bp) / 10000);
}

function computeStoredDiscountCents(
  version: EstimateVersionRow,
  items: EstimateItem[]
) {
  const saleSubtotal = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);

  if (Number.isFinite(version.total_ht_cents ?? NaN)) {
    return Math.max(saleSubtotal - (version.total_ht_cents ?? 0), 0);
  }

  if (!saleSubtotal) return 0;
  return Math.round((saleSubtotal * version.discount_bp) / 10000);
}

function normalizeDraftItems({
  items,
  version,
  rateById,
}: {
  items: EstimateItem[];
  version: EstimateVersionRow;
  rateById: Map<string, number>;
}) {
  return items.map((item) => {
    if (item.item_type !== "line") return item;
    const kFo = item.k_fo ?? 1;
    const hMo = item.h_mo ?? 0;
    const kMo = item.k_mo ?? 1;
    const hourlyRate = item.labor_role_id
      ? rateById.get(item.labor_role_id) ?? 0
      : 0;
    const taxRate = version.tax_rate_bp ?? item.tax_rate_bp ?? 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        k_fo: kFo,
        h_mo: hMo,
        k_mo: kMo,
        tax_rate_bp: taxRate,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: version.margin_multiplier,
        taxRateBp: taxRate,
      }
    );
    return {
      ...item,
      tax_rate_bp: taxRate,
      k_fo: kFo,
      h_mo: hMo,
      k_mo: kMo,
      pu_ht_cents: lineValues.puHtCents,
      line_total_ht_cents: lineValues.saleLineCents,
      line_tax_cents: lineValues.taxLineCents,
      line_total_ttc_cents: lineValues.ttcLineCents,
    };
  });
}

function computeReadOnlyTotals({
  items,
  version,
  discountCents,
  laborRateById,
}: {
  items: EstimateItem[];
  version: EstimateVersionRow;
  discountCents: number;
  laborRateById: Map<string, number>;
}): EstimateTotals {
  const costSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    const hourlyRate = item.labor_role_id
      ? laborRateById.get(item.labor_role_id) ?? 0
      : 0;
    const lineValues = computeEstimateLineValues(
      {
        ...item,
        labor_role_hourly_rate_cents: hourlyRate,
      },
      {
        marginMultiplier: 1,
        taxRateBp: 0,
      }
    );
    return sum + lineValues.costLineCents;
  }, 0);

  const saleSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);

  const saleTotalFallback = Math.max(saleSubtotalCents - discountCents, 0);
  const saleTotalCents = Number.isFinite(version.total_ht_cents ?? NaN)
    ? (version.total_ht_cents ?? saleTotalFallback)
    : saleTotalFallback;

  const taxStored = Number.isFinite(version.total_tax_cents ?? NaN)
    ? (version.total_tax_cents ?? 0)
    : null;

  const roundedTtcFallback = saleTotalCents + (taxStored ?? 0);
  const roundedTtcCents = Number.isFinite(version.total_ttc_cents ?? NaN)
    ? (version.total_ttc_cents ?? roundedTtcFallback)
    : roundedTtcFallback;

  const adjustedTaxCents = roundedTtcCents - saleTotalCents;
  const taxCents = taxStored ?? Math.max(adjustedTaxCents, 0);

  const ttcCents = saleTotalCents + taxCents;
  const roundingAdjustmentCents = roundedTtcCents - ttcCents;

  return {
    costSubtotalCents,
    saleSubtotalCents,
    discountCents,
    saleTotalCents,
    taxCents,
    ttcCents,
    roundedTtcCents,
    roundingAdjustmentCents,
    adjustedTaxCents,
  };
}

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

export default function EditEstimatePage() {
  const params = useParams();
  const rawVersionId = params?.["versionId"];
  const versionId = Array.isArray(rawVersionId) ? rawVersionId[0] : rawVersionId;
  const resolvedVersionId = typeof versionId === "string" ? versionId : "";
  const { profile } = useUserContext();

  const [version, setVersion] = useState<EstimateVersionView | null>(null);
  const [settings, setSettings] = useState<EstimateSettingsState | null>(null);
  const [savedSettings, setSavedSettings] =
    useState<EstimateSettingsState | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [categories, setCategories] = useState<EstimateCategory[]>([]);
  const [laborRoles, setLaborRoles] = useState<LaborRole[]>([]);
  const [suggestionRules, setSuggestionRules] = useState<SuggestionRule[]>([]);
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

  const itemsRef = useRef<EstimateItem[]>([]);
  const lastTotalsKey = useRef<string | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    if (!resolvedVersionId) return;

    let active = true;

    async function load() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const data = await fetchEstimateEditorData(resolvedVersionId);
        if (!active) return;

        const versionRow = data.version as EstimateVersionView;
        const itemsRows = data.items ?? [];
        const rolesData = data.laborRoles ?? [];
        const discountCents =
          versionRow.status === "draft"
            ? computeInitialDiscountCents(versionRow, itemsRows, rolesData)
            : computeStoredDiscountCents(versionRow, itemsRows);

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

        const initialSettings = {
          title: versionRow.title ?? "",
          date_devis: versionRow.date_devis,
          validite_jours: versionRow.validite_jours,
          margin_multiplier: versionRow.margin_multiplier,
          discount_cents: discountCents,
          tax_rate_bp: versionRow.tax_rate_bp,
          rounding_mode: versionRow.rounding_mode,
          rounding_step_cents: versionRow.rounding_step_cents,
        };

        setVersion(versionRow);
        setItems(normalizedItems);
        setCategories(data.categories ?? []);
        setLaborRoles(rolesData);
        setSuggestionRules(data.suggestionRules ?? []);
        setSettings(initialSettings);
        setSavedSettings(initialSettings);

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
              original.k_mo !== item.k_mo ||
              original.pu_ht_cents !== item.pu_ht_cents ||
              original.line_total_ht_cents !== item.line_total_ht_cents ||
              original.line_tax_cents !== item.line_tax_cents ||
              original.line_total_ttc_cents !== item.line_total_ttc_cents
            );
          });

          if (updates.length > 0) {
            try {
              await bulkUpdateEstimateItems(
                resolvedVersionId,
                updates.map((item) => ({
                  id: item.id,
                  updates: {
                    tax_rate_bp: item.tax_rate_bp,
                    k_fo: item.k_fo,
                    h_mo: item.h_mo,
                    k_mo: item.k_mo,
                    pu_ht_cents: item.pu_ht_cents,
                    line_total_ht_cents: item.line_total_ht_cents,
                    line_tax_cents: item.line_tax_cents,
                    line_total_ttc_cents: item.line_total_ttc_cents,
                  },
                }))
              );
            } catch {
              if (active) {
                setActionError("Impossible de mettre a jour les lignes.");
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
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [resolvedVersionId]);

  const projectName = getProjectName(version?.estimate_projects ?? null);
  const isAdmin = profile?.role === "admin";
  const isReadOnly = version ? version.status !== "draft" : false;
  const canSend = version?.status === "draft";
  const canAccept = version?.status === "sent";
  const canArchive = version?.status !== "archived";

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
      map.set(role.id, role.hourly_rate_cents);
    });
    return map;
  }, [laborRoles]);

  const categoryById = useMemo(() => {
    const map = new Map<string, EstimateCategory>();
    categories.forEach((category) => {
      map.set(category.id, category);
    });
    return map;
  }, [categories]);

  const laborRoleById = useMemo(() => {
    const map = new Map<string, LaborRole>();
    laborRoles.forEach((role) => {
      map.set(role.id, role);
    });
    return map;
  }, [laborRoles]);

  const qualityFlagsByItemId = useMemo(
    () => computeEstimateQualityFlagsByItemId(items),
    [items]
  );

  const qualityCounts = useMemo(
    () => countEstimateQualityFlags(qualityFlagsByItemId),
    [qualityFlagsByItemId]
  );

  const totals: EstimateTotals | null = useMemo(() => {
    if (!settings) return null;
    if (isReadOnly && version) {
      return computeReadOnlyTotals({
        items,
        version,
        discountCents: settings.discount_cents,
        laborRateById,
      });
    }
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        ...item,
        labor_role_hourly_rate_cents: item.labor_role_id
          ? laborRateById.get(item.labor_role_id) ?? 0
          : 0,
      }));
    return computeEstimateTotals({
      lineItems,
      marginMultiplier: settings.margin_multiplier,
      discountCents: settings.discount_cents,
      taxRateBp: settings.tax_rate_bp,
      roundingMode: settings.rounding_mode,
      roundingStepCents: settings.rounding_step_cents,
    });
  }, [isReadOnly, items, laborRateById, settings, version]);

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
      margin_multiplier: settings.margin_multiplier,
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
        const categoryLabel = item.category_id
          ? categoryById.get(item.category_id)?.name ?? ""
          : "";
        const laborLabel = item.labor_role_id
          ? laborRoleById.get(item.labor_role_id)?.name ?? ""
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
          category: categoryLabel,
          k_fo: item.k_fo ?? "",
          h_mo: item.h_mo ?? "",
          labor_role: laborLabel,
          k_mo: item.k_mo ?? "",
          pu_ht_cents: item.pu_ht_cents ?? "",
          line_total_ht_cents: item.line_total_ht_cents ?? "",
          tax_rate_bp: item.tax_rate_bp ?? "",
          line_total_ttc_cents: item.line_total_ttc_cents ?? "",
        };
      });
  }, [categoryById, items, laborRoleById, qualityFlagsByItemId]);

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
            columns: LINE_EXPORT_COLUMNS,
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
  ]);

  const handleExportCSV = useCallback(() => {
    if (isExporting) return;
    const recapRow = buildRecapRow();
    if (!recapRow) return;

    setIsExporting(true);
    try {
      const lines = buildLineRows();
      const filename = buildExportFilename();
      exportToCSV(lines, LINE_EXPORT_COLUMNS, { filename });
    } catch (error) {
      console.error("Erreur lors de l'export CSV.", error);
    } finally {
      setIsExporting(false);
    }
  }, [buildExportFilename, buildLineRows, buildRecapRow, isExporting]);

  const isExportDisabled = isExporting || !version || !settings || !totals;

  const persistedTotals: EstimateTotals | null = useMemo(() => {
    if (!savedSettings) return null;
    const lineItems = items
      .filter((item) => item.item_type === "line")
      .map((item) => ({
        ...item,
        labor_role_hourly_rate_cents: item.labor_role_id
          ? laborRateById.get(item.labor_role_id) ?? 0
          : 0,
      }));
    return computeEstimateTotals({
      lineItems,
      marginMultiplier: savedSettings.margin_multiplier,
      discountCents: savedSettings.discount_cents,
      taxRateBp: savedSettings.tax_rate_bp,
      roundingMode: savedSettings.rounding_mode,
      roundingStepCents: savedSettings.rounding_step_cents,
    });
  }, [items, laborRateById, savedSettings]);

  useEffect(() => {
    if (!persistedTotals || !version || isReadOnly) return;
    const totalsKey = `${persistedTotals.saleTotalCents}-${persistedTotals.adjustedTaxCents}-${persistedTotals.roundedTtcCents}`;
    if (totalsKey === lastTotalsKey.current) return;

    const timeout = setTimeout(async () => {
      try {
        await saveEstimateVersion(version.id, {
          total_ht_cents: persistedTotals.saleTotalCents,
          total_tax_cents: persistedTotals.adjustedTaxCents,
          total_ttc_cents: persistedTotals.roundedTtcCents,
        });
        lastTotalsKey.current = totalsKey;
      } catch {
        // Keep UI responsive: errors are surfaced on explicit save.
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [isReadOnly, persistedTotals, version]);

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
      setActionError("Cette version est en lecture seule.");
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
      margin_multiplier: settings.margin_multiplier,
      discount_bp: discountBp,
      tax_rate_bp: settings.tax_rate_bp,
      rounding_mode: settings.rounding_mode,
      rounding_step_cents: settings.rounding_step_cents,
      total_ht_cents: totals.saleTotalCents,
      total_tax_cents: totals.adjustedTaxCents,
      total_ttc_cents: totals.roundedTtcCents,
    };

    try {
      await saveEstimateVersion(version.id, payload);
    } catch (error) {
      setActionError(
        resolveEstimateActionError(
          error instanceof Error ? error.message : "Impossible de sauvegarder le chiffrage."
        )
      );
      setIsSavingSettings(false);
      return;
    }

    setSavedSettings({ ...settings });
    lastTotalsKey.current = `${totals.saleTotalCents}-${totals.adjustedTaxCents}-${totals.roundedTtcCents}`;

    const shouldUpdateLines =
      settings.tax_rate_bp !== version.tax_rate_bp ||
      settings.margin_multiplier !== version.margin_multiplier;

    if (shouldUpdateLines) {
      const lineItems = itemsRef.current.filter(
        (item) => item.item_type === "line"
      );
      const updatedLines = lineItems.map((item) => {
        const kFo = item.k_fo ?? 1;
        const hMo = item.h_mo ?? 0;
        const kMo = item.k_mo ?? 1;
        const hourlyRate = item.labor_role_id
          ? laborRateById.get(item.labor_role_id) ?? 0
          : 0;
        const lineValues = computeEstimateLineValues(
          {
            ...item,
            tax_rate_bp: settings.tax_rate_bp,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            labor_role_hourly_rate_cents: hourlyRate,
          },
          {
            marginMultiplier: settings.margin_multiplier,
            taxRateBp: settings.tax_rate_bp,
          }
        );
        return {
          ...item,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
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
        await bulkUpdateEstimateItems(
          version.id,
          updatedLines.map((item) => ({
            id: item.id,
            updates: {
              tax_rate_bp: item.tax_rate_bp,
              k_fo: item.k_fo,
              h_mo: item.h_mo,
              k_mo: item.k_mo,
              pu_ht_cents: item.pu_ht_cents,
              line_total_ht_cents: item.line_total_ht_cents,
              line_tax_cents: item.line_tax_cents,
              line_total_ttc_cents: item.line_total_ttc_cents,
            },
          }))
        );
      } catch {
        setActionError("Impossible de mettre a jour les lignes.");
      }
    }

    setVersion((prev) => (prev ? { ...prev, ...payload } : prev));
    setIsSavingSettings(false);
  }

  const handleEnsureCategory = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const existing = categories.find(
        (category) => category.name.toLowerCase() === trimmed.toLowerCase()
      );
      if (existing) return existing;

      if (!profile?.id) {
        setActionError("Impossible de charger votre profil.");
        return null;
      }

      const nextPosition =
        categories.reduce((max, category) => Math.max(max, category.position), 0) +
        1;

      if (!version?.id) {
        setActionError("Version introuvable.");
        return null;
      }

      let data: EstimateCategory;
      try {
        data = await createEstimateCategory(version.id, {
          name: trimmed,
          color: null,
          position: nextPosition,
        });
      } catch (error) {
        setActionError(
          error instanceof Error ? error.message : "Impossible de creer la categorie."
        );
        return null;
      }

      setCategories((prev) =>
        [...prev, data].sort((a, b) => a.position - b.position)
      );
      return data;
    },
    [categories, profile, version?.id]
  );

  const handleCreateRole = useCallback(
    async (payload: { name: string; hourly_rate_cents: number }) => {
      setActionError(null);
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
    [laborRoles, profile, version?.id]
  );

  const handleUpdateRole = useCallback(
    async (id: string, updates: Partial<LaborRole>) => {
      setActionError(null);
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
        (item) => item.item_type === "line" && item.labor_role_id === id
      );

      if (affectedLines.length === 0) return;

      const updatedLines = affectedLines.map((item) => {
        const kFo = item.k_fo ?? 1;
        const hMo = item.h_mo ?? 0;
        const kMo = item.k_mo ?? 1;
        const taxRate = settings.tax_rate_bp ?? item.tax_rate_bp ?? 0;
        const lineValues = computeEstimateLineValues(
          {
            ...item,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            tax_rate_bp: taxRate,
            labor_role_hourly_rate_cents: nextHourlyRate,
          },
          {
            marginMultiplier: settings.margin_multiplier,
            taxRateBp: taxRate,
          }
        );
        return {
          ...item,
          tax_rate_bp: taxRate,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
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

      if (isReadOnly) return;

      try {
        await bulkUpdateEstimateItems(
          version.id,
          updatedLines.map((item) => ({
            id: item.id,
            updates: {
              tax_rate_bp: item.tax_rate_bp,
              k_fo: item.k_fo,
              h_mo: item.h_mo,
              k_mo: item.k_mo,
              pu_ht_cents: item.pu_ht_cents,
              line_total_ht_cents: item.line_total_ht_cents,
              line_tax_cents: item.line_tax_cents,
              line_total_ttc_cents: item.line_total_ttc_cents,
            },
          }))
        );
      } catch {
        setActionError("Impossible de mettre a jour les lignes.");
      }
    },
    [isReadOnly, settings, version?.id]
  );

  const handleCreateSuggestionRule = useCallback(
    async (payload: SuggestionRuleCreatePayload) => {
      setRulesError(null);
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
    [profile, suggestionRules, version?.id]
  );

  const handleUpdateSuggestionRule = useCallback(
    async (id: string, updates: Partial<SuggestionRule>) => {
      setRulesError(null);
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
    [version?.id]
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
        setActionError("Cette version est en lecture seule.");
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
    [getNextPosition, isReadOnly, version]
  );

  const handleAddLine = useCallback(
    async (parentId: string | null) => {
      if (!version || !settings) return;
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
        return;
      }
      setActionError(null);
      const position = getNextPosition(parentId);
      const lineValues = computeEstimateLineValues(
        {
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: settings.tax_rate_bp,
          k_fo: 1,
          h_mo: 0,
          k_mo: 1,
          pu_ht_cents: 0,
          labor_role_hourly_rate_cents: 0,
        },
        {
          marginMultiplier: settings.margin_multiplier,
          taxRateBp: settings.tax_rate_bp,
        }
      );

      let data: EstimateItem;
      try {
        data = await createEstimateItem(version.id, {
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
          k_mo: 1,
          pu_ht_cents: lineValues.puHtCents,
          labor_role_id: null,
          category_id: null,
          line_total_ht_cents: lineValues.saleLineCents,
          line_tax_cents: lineValues.taxLineCents,
          line_total_ttc_cents: lineValues.ttcLineCents,
        });
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
    [getNextPosition, isReadOnly, settings, version]
  );

  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
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
    [isReadOnly, reloadItems, version?.id]
  );

  const handlePatchItem = useCallback(
    async (
      itemId: string,
      patch: ItemPatch,
      options?: { persist?: boolean }
    ) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
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
        const kFo = updated.k_fo ?? 1;
        const hMo = updated.h_mo ?? 0;
        const kMo = updated.k_mo ?? 1;
        const hourlyRate = updated.labor_role_id
          ? laborRateById.get(updated.labor_role_id) ?? 0
          : 0;
        const lineValues = computeEstimateLineValues(
          {
            ...updated,
            tax_rate_bp: taxRate,
            k_fo: kFo,
            h_mo: hMo,
            k_mo: kMo,
            labor_role_hourly_rate_cents: hourlyRate,
          },
          {
            marginMultiplier,
            taxRateBp: taxRate,
          }
        );
        updated = {
          ...updated,
          tax_rate_bp: taxRate,
          k_fo: kFo,
          h_mo: hMo,
          k_mo: kMo,
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

      const payload: Database["public"]["Tables"]["estimate_items"]["Update"] =
        updated.item_type === "line"
          ? {
              title: updated.title,
              description: updated.description ?? null,
              quantity: updated.quantity,
              unit_price_ht_cents: updated.unit_price_ht_cents,
              tax_rate_bp: updated.tax_rate_bp,
              k_fo: updated.k_fo,
              h_mo: updated.h_mo,
              k_mo: updated.k_mo,
              pu_ht_cents: updated.pu_ht_cents,
              labor_role_id: updated.labor_role_id,
              category_id: updated.category_id,
              line_total_ht_cents: updated.line_total_ht_cents,
              line_tax_cents: updated.line_tax_cents,
              line_total_ttc_cents: updated.line_total_ttc_cents,
            }
          : {
              title: updated.title,
            };

      try {
        await updateEstimateItem(version.id, itemId, payload);
      } catch (error) {
        setActionError(
          resolveEstimateActionError(
            error instanceof Error ? error.message : "Impossible de mettre a jour la ligne."
          )
        );
        setItems(snapshot);
      }
    },
    [
      isReadOnly,
      laborRateById,
      settings?.margin_multiplier,
      settings?.tax_rate_bp,
      version?.id,
    ]
  );

  const handleReorder = useCallback(
    async (parentId: string | null, orderedIds: string[]) => {
      if (isReadOnly) {
        setActionError("Cette version est en lecture seule.");
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
    [isReadOnly, version?.id]
  );

  async function handleStatusChange(nextStatus: EstimateStatus) {
    if (!version || isUpdatingStatus) return;
    setStatusError(null);
    setIsUpdatingStatus(true);

    try {
      await updateEstimateStatus(version.id, nextStatus);
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
    setVersion((prev) => (prev ? { ...prev, status: nextStatus } : prev));
  }

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
          <ExportDropdown
            onExportExcel={handleExportExcel}
            onExportCSV={handleExportCSV}
            disabled={isExportDisabled}
          />
          {canSend ? (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => handleStatusChange("sent")}
              disabled={isUpdatingStatus}
            >
              Envoyer
            </button>
          ) : null}
          {canAccept ? (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => handleStatusChange("accepted")}
              disabled={isUpdatingStatus}
            >
              Accepter
            </button>
          ) : null}
          {canArchive ? (
            <button
              className="btn btn-danger btn-sm"
              type="button"
              onClick={() => handleStatusChange("archived")}
              disabled={isUpdatingStatus}
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

      {isReadOnly && (
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
            isReadOnly={isReadOnly}
            error={null}
            onChange={updateSettings}
            onSave={handleSaveSettings}
          />
          <LaborRolesManager
            roles={laborRoles}
            isSaving={isSavingSettings}
            error={null}
            onCreate={handleCreateRole}
            onUpdate={handleUpdateRole}
          />
          <EstimateSuggestionRulesManager
            rules={suggestionRules}
            categories={categories}
            laborRoles={laborRoles}
            isSaving={isSavingRules}
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
          <EstimateEditorTable
            items={items}
            categories={categories}
            laborRoles={laborRoles}
            suggestionRules={suggestionRules}
            qualityFlagsByItemId={qualityFlagsByItemId}
            qualityCounts={qualityCounts}
            qualityFilter={qualityFilter}
            actionError={actionError}
            isReadOnly={isReadOnly}
            onQualityFilterChange={setQualityFilter}
            onAddSection={handleAddSection}
            onAddLine={handleAddLine}
            onDeleteItem={handleDeleteItem}
            onPatchItem={handlePatchItem}
            onReorder={handleReorder}
            onEnsureCategory={handleEnsureCategory}
          />
        </div>
      )}
    </div>
  );
}
