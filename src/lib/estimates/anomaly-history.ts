import type { SupabaseClient } from "@supabase/supabase-js";

import { isPriceStale } from "@/lib/catalogue/stale-prices";
import {
  ESTIMATE_QUALITY_FLAG_META,
  computeEstimateQualityFlagsByItemId,
  type EstimateQualityFlagKey,
} from "@/lib/estimate-quality";
import {
  ESTIMATE_GATING_FLAG_KEYS,
  ESTIMATE_GATING_FLAG_META,
  type EstimateGatingFlagKey,
  type EstimateGatingSeverity,
} from "@/lib/estimates/gating";
import { detectEstimateOutliers } from "@/lib/estimates/outlier-detection";
import type { EstimateOutlierFlagKey } from "@/lib/estimates/outlier-detection";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import type { Database } from "@/types/database";

import { mapSupabaseError } from "./errors";

type Supabase = SupabaseClient<Database>;
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnomalyFilters = {
  flag_types?: string[];
  owner_user_id?: string;
  search?: string;
  version_id?: string;
};

export type TrendFilters = {
  date_from?: string;
  date_to?: string;
};

export type CurrentAnomalyRow = {
  versionId: string;
  versionLabel: string;
  projectName: string;
  ownerUserId: string;
  ownerName: string;
  flagKey: EstimateGatingFlagKey;
  flagLabel: string;
  severity: EstimateGatingSeverity;
  itemCount: number;
};

export type TrendPeriod = {
  period: string;
  opened: number;
  resolved: number;
};

export type AvgResolutionByType = {
  flagKey: string;
  flagLabel: string;
  avgDays: number;
};

export type AnomalyHistoryResult = {
  summary: {
    totalAnomalies: number;
    blockingCount: number;
    warningCount: number;
    estimatesAffected: number;
    estimatesTotal: number;
  };
  currentAnomalies: CurrentAnomalyRow[];
  trend: TrendPeriod[];
  avgResolution: AvgResolutionByType[];
};

// ---------------------------------------------------------------------------
// Severity resolution (mirrors gating.ts:135 pattern)
// ---------------------------------------------------------------------------

const GATING_BLOCKING_FLAGS_KEY = "ESTIMATE_GATING_BLOCKING_FLAGS";
const GATING_WARNING_FLAGS_KEY = "ESTIMATE_GATING_WARNING_FLAGS";

const DEFAULT_GATING_SEVERITY_BY_FLAG: Record<
  EstimateGatingFlagKey,
  EstimateGatingSeverity
> = {
  missing_price: "blocking",
  missing_quantity: "blocking",
  missing_labor_time: "warning",
  missing_labor_role: "warning",
  price_outlier: "warning",
  quantity_outlier: "warning",
  supplier_price_outdated: "warning",
  labor_split_incomplete: "warning",
  margin_not_configured: "blocking",
  total_exceeds_budget: "blocking",
  no_pdf_generated: "blocking",
};

function parseCsvFlagList(value: string | null): Set<EstimateGatingFlagKey> {
  if (!value) return new Set();
  const normalized = value
    .split(/[,\n;\s]+/g)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  const allowed = new Set<string>(ESTIMATE_GATING_FLAG_KEYS);
  const parsed = new Set<EstimateGatingFlagKey>();
  normalized.forEach((token) => {
    if (allowed.has(token)) {
      parsed.add(token as EstimateGatingFlagKey);
    }
  });
  return parsed;
}

function resolveSeverityByFlag(input: {
  blockingOverride: string | null;
  warningOverride: string | null;
}): Record<EstimateGatingFlagKey, EstimateGatingSeverity> {
  const blockingOverrideSet = parseCsvFlagList(input.blockingOverride);
  const warningOverrideSet = parseCsvFlagList(input.warningOverride);

  return ESTIMATE_GATING_FLAG_KEYS.reduce(
    (acc, key) => {
      if (blockingOverrideSet.has(key)) {
        acc[key] = "blocking";
        return acc;
      }
      if (warningOverrideSet.has(key)) {
        acc[key] = "warning";
        return acc;
      }
      acc[key] = DEFAULT_GATING_SEVERITY_BY_FLAG[key];
      return acc;
    },
    {} as Record<EstimateGatingFlagKey, EstimateGatingSeverity>
  );
}

function getFlagLabel(key: EstimateGatingFlagKey): string {
  return (
    (ESTIMATE_GATING_FLAG_META as Record<string, { label: string }>)[key]
      ?.label ?? key
  );
}

// ---------------------------------------------------------------------------
// Helpers for labor split detection
// ---------------------------------------------------------------------------

function hasLaborSplitPayload(item: EstimateItemRow) {
  return (
    (item.h_mo_atelier !== null && item.h_mo_atelier !== undefined) ||
    (item.labor_role_atelier_id !== null &&
      item.labor_role_atelier_id !== undefined) ||
    (item.h_mo_chantier !== null && item.h_mo_chantier !== undefined) ||
    (item.labor_role_chantier_id !== null &&
      item.labor_role_chantier_id !== undefined) ||
    (item.k_mo_atelier ?? 1) !== 1 ||
    (item.k_mo_chantier ?? 1) !== 1
  );
}

// ---------------------------------------------------------------------------
// getCurrentAnomalySummary
// ---------------------------------------------------------------------------

type VersionMeta = {
  versionId: string;
  versionLabel: string;
  projectName: string;
  ownerUserId: string;
  ownerName: string;
};

export async function getCurrentAnomalySummary(
  supabase: Supabase,
  tenantId: string,
  filters: AnomalyFilters
): Promise<{
  summary: AnomalyHistoryResult["summary"];
  currentAnomalies: CurrentAnomalyRow[];
}> {
  // 1. Fetch all line items across active versions with version/project/owner info
  let itemsQuery = supabase
    .from("estimate_items")
    .select(
      `
      *,
      estimate_versions!inner (
        id,
        label,
        tenant_id,
        estimate_projects!inner (
          id,
          name,
          is_archived,
          user_id,
          profiles!inner ( id, full_name )
        )
      )
    `
    )
    .eq("tenant_id", tenantId)
    .eq("item_type", "line");

  if (filters.version_id) {
    itemsQuery = itemsQuery.eq("version_id", filters.version_id);
  }

  const { data: rawItems, error: itemsError } = await itemsQuery;

  if (itemsError) {
    throw mapSupabaseError(
      itemsError,
      "Impossible de charger les lignes pour l'analyse d'anomalies."
    );
  }

  // Filter out archived projects client-side (is_archived applied via join)
  type ItemWithJoins = EstimateItemRow & {
    estimate_versions: {
      id: string;
      label: string;
      tenant_id: string;
      estimate_projects: {
        id: string;
        name: string;
        is_archived: boolean;
        user_id: string;
        profiles: { id: string; full_name: string } | { id: string; full_name: string }[];
      } | {
        id: string;
        name: string;
        is_archived: boolean;
        user_id: string;
        profiles: { id: string; full_name: string } | { id: string; full_name: string }[];
      }[];
    } | {
      id: string;
      label: string;
      tenant_id: string;
      estimate_projects: {
        id: string;
        name: string;
        is_archived: boolean;
        user_id: string;
        profiles: { id: string; full_name: string } | { id: string; full_name: string }[];
      } | {
        id: string;
        name: string;
        is_archived: boolean;
        user_id: string;
        profiles: { id: string; full_name: string } | { id: string; full_name: string }[];
      }[];
    }[];
  };

  const allItems = (rawItems ?? []) as unknown as ItemWithJoins[];

  // Build version metadata and group items
  const versionMetaMap = new Map<string, VersionMeta>();
  const itemsByVersionId = new Map<string, EstimateItemRow[]>();

  for (const item of allItems) {
    const version = Array.isArray(item.estimate_versions)
      ? item.estimate_versions[0]
      : item.estimate_versions;
    if (!version) continue;

    const project = Array.isArray(version.estimate_projects)
      ? version.estimate_projects[0]
      : version.estimate_projects;
    if (!project || project.is_archived) continue;

    // Apply owner filter
    if (filters.owner_user_id && project.user_id !== filters.owner_user_id) {
      continue;
    }

    // Apply search filter
    if (filters.search) {
      const lowerSearch = filters.search.toLowerCase();
      const matchesProject = project.name.toLowerCase().includes(lowerSearch);
      const matchesVersion = (version.label ?? "")
        .toLowerCase()
        .includes(lowerSearch);
      if (!matchesProject && !matchesVersion) continue;
    }

    const profile = Array.isArray(project.profiles)
      ? project.profiles[0]
      : project.profiles;

    if (!versionMetaMap.has(version.id)) {
      versionMetaMap.set(version.id, {
        versionId: version.id,
        versionLabel: version.label ?? version.id,
        projectName: project.name,
        ownerUserId: project.user_id,
        ownerName: profile?.full_name ?? "Inconnu",
      });
    }

    const versionItems = itemsByVersionId.get(version.id) ?? [];
    versionItems.push(item as unknown as EstimateItemRow);
    itemsByVersionId.set(version.id, versionItems);
  }

  // 2. Batch-load external data in parallel
  const allSelectedSupplierPriceIds = new Set<string>();
  const allVersionIds = Array.from(itemsByVersionId.keys());

  for (const items of itemsByVersionId.values()) {
    for (const item of items) {
      const priceId = item.selected_supplier_price_id;
      if (typeof priceId === "string" && priceId.length > 0) {
        allSelectedSupplierPriceIds.add(priceId);
      }
    }
  }

  const supplierPriceIdsArray = Array.from(allSelectedSupplierPriceIds);

  const [
    supplierPricesResult,
    dismissalsResult,
    stalePriceDays,
    blockingOverride,
    warningOverride,
  ] = await Promise.all([
    supplierPriceIdsArray.length > 0
      ? supabase
          .from("supplier_pricebook")
          .select("id, updated_at, created_at")
          .eq("tenant_id", tenantId)
          .in("id", supplierPriceIdsArray)
      : Promise.resolve({ data: [], error: null }),
    allVersionIds.length > 0
      ? supabase
          .from("estimate_item_outlier_dismissals" as never)
          .select("version_id, item_id, flag_key" as never)
          .eq("tenant_id" as never, tenantId as never)
          .in("version_id" as never, allVersionIds as never)
      : Promise.resolve({ data: [], error: null }),
    getStalePriceDaysForTenant(tenantId, { supabase }),
    getFeatureFlagValueForTenant(tenantId, GATING_BLOCKING_FLAGS_KEY, {
      supabase,
    }),
    getFeatureFlagValueForTenant(tenantId, GATING_WARNING_FLAGS_KEY, {
      supabase,
    }),
  ]);

  if (supplierPricesResult.error) {
    throw mapSupabaseError(
      supplierPricesResult.error,
      "Impossible de charger les prix fournisseurs."
    );
  }

  // Build stale supplier price set
  const stalePriceIds = new Set<string>();
  const supplierPrices = (supplierPricesResult.data ?? []) as {
    id: string;
    updated_at: string | null;
    created_at: string;
  }[];
  for (const price of supplierPrices) {
    if (
      isPriceStale(
        { updatedAt: price.updated_at, createdAt: price.created_at },
        stalePriceDays
      )
    ) {
      stalePriceIds.add(price.id);
    }
  }

  // Build dismissals map by version
  type DismissalRaw = { version_id: string; item_id: string; flag_key: string };
  const dismissedByVersion = new Map<
    string,
    Record<string, EstimateOutlierFlagKey[]>
  >();
  const dismissalRows = (dismissalsResult.data ?? []) as unknown as DismissalRaw[];
  for (const row of dismissalRows) {
    const vMap = dismissedByVersion.get(row.version_id) ?? {};
    const existing = vMap[row.item_id] ?? [];
    existing.push(row.flag_key as EstimateOutlierFlagKey);
    vMap[row.item_id] = existing;
    dismissedByVersion.set(row.version_id, vMap);
  }

  // Resolve severity
  const severityByFlag = resolveSeverityByFlag({
    blockingOverride,
    warningOverride,
  });

  // 3. Per-version: detect outliers and compute quality flags
  const currentAnomalies: CurrentAnomalyRow[] = [];
  const affectedVersions = new Set<string>();
  let totalAnomalies = 0;
  let blockingCount = 0;
  let warningCount = 0;

  for (const [versionId, items] of itemsByVersionId) {
    const meta = versionMetaMap.get(versionId);
    if (!meta) continue;

    // Detect outliers for this version
    const outlierFlagsByItemId = detectEstimateOutliers({ items });
    const dismissedOutlierFlagsByItemId =
      dismissedByVersion.get(versionId) ?? {};

    // Build stale supplier price item ids for this version
    const staleSupplierPriceItemIds = new Set<string>();
    for (const item of items) {
      const priceId = item.selected_supplier_price_id;
      if (typeof priceId === "string" && stalePriceIds.has(priceId)) {
        staleSupplierPriceItemIds.add(item.id);
      }
    }

    // Check if any line has labor split
    const hasAtLeastOneSplitLine = items.some(
      (item) => item.item_type === "line" && hasLaborSplitPayload(item)
    );

    // Compute quality flags
    const flagsByItemId = computeEstimateQualityFlagsByItemId(items, {
      outlierFlagsByItemId,
      dismissedOutlierFlagsByItemId,
      staleSupplierPriceItemIds,
      isLaborSplitEnabled: hasAtLeastOneSplitLine,
    });

    // Aggregate per flag key
    const countByFlag = new Map<EstimateQualityFlagKey, number>();
    for (const flags of Object.values(flagsByItemId)) {
      for (const flag of flags) {
        countByFlag.set(flag, (countByFlag.get(flag) ?? 0) + 1);
      }
    }

    for (const [flagKey, itemCount] of countByFlag) {
      // Apply flag_types filter
      if (
        filters.flag_types &&
        filters.flag_types.length > 0 &&
        !filters.flag_types.includes(flagKey)
      ) {
        continue;
      }

      const gatingKey = flagKey as EstimateGatingFlagKey;
      const severity = severityByFlag[gatingKey] ?? "warning";

      currentAnomalies.push({
        versionId: meta.versionId,
        versionLabel: meta.versionLabel,
        projectName: meta.projectName,
        ownerUserId: meta.ownerUserId,
        ownerName: meta.ownerName,
        flagKey: gatingKey,
        flagLabel: getFlagLabel(gatingKey),
        severity,
        itemCount,
      });

      affectedVersions.add(versionId);
      totalAnomalies += itemCount;
      if (severity === "blocking") {
        blockingCount += itemCount;
      } else {
        warningCount += itemCount;
      }
    }
  }

  return {
    summary: {
      totalAnomalies,
      blockingCount,
      warningCount,
      estimatesAffected: affectedVersions.size,
      estimatesTotal: versionMetaMap.size,
    },
    currentAnomalies,
  };
}

// ---------------------------------------------------------------------------
// getAnomalyTrend
// ---------------------------------------------------------------------------

// Simple flags derivable from audit_logs before/after JSONB
const SIMPLE_FLAG_CHECKS: {
  key: string;
  label: string;
  check: (data: Record<string, unknown>) => boolean;
}[] = [
  {
    key: "missing_price",
    label: ESTIMATE_QUALITY_FLAG_META.missing_price.label,
    check: (d) => {
      const v = d.unit_price_ht_cents;
      return typeof v !== "number" || !Number.isFinite(v) || v <= 0;
    },
  },
  {
    key: "missing_quantity",
    label: ESTIMATE_QUALITY_FLAG_META.missing_quantity.label,
    check: (d) => {
      const v = d.quantity;
      return typeof v !== "number" || !Number.isFinite(v) || v <= 0;
    },
  },
  {
    key: "missing_labor_time",
    label: ESTIMATE_QUALITY_FLAG_META.missing_labor_time.label,
    check: (d) => {
      const v = d.h_mo;
      return typeof v !== "number" || !Number.isFinite(v) || v <= 0;
    },
  },
  {
    key: "missing_labor_role",
    label: ESTIMATE_QUALITY_FLAG_META.missing_labor_role.label,
    check: (d) => {
      const hmo = d.h_mo;
      const hasHmo =
        typeof hmo === "number" && Number.isFinite(hmo) && hmo > 0;
      const roleId = d.labor_role_id;
      const hasRole =
        typeof roleId === "string" && roleId.length > 0;
      return hasHmo && !hasRole;
    },
  },
];

function computeSimpleFlags(data: Record<string, unknown> | null): Set<string> {
  if (!data) return new Set();
  const flags = new Set<string>();
  for (const check of SIMPLE_FLAG_CHECKS) {
    if (check.check(data)) {
      flags.add(check.key);
    }
  }
  return flags;
}

const MAX_AUDIT_ROWS = 50_000;
const TREND_MONTHS = 12;

export async function getAnomalyTrend(
  supabase: Supabase,
  tenantId: string,
  filters: TrendFilters
): Promise<{
  trend: TrendPeriod[];
  avgResolution: AvgResolutionByType[];
}> {
  const now = new Date();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - TREND_MONTHS);

  const { data: rawLogs, error: logsError } = await supabase
    .from("audit_logs")
    .select("id, created_at, record_id, action, before_data, after_data")
    .eq("tenant_id", tenantId)
    .eq("table_name", "estimate_items")
    .in("action", ["INSERT", "UPDATE", "DELETE"])
    .gte("created_at", twelveMonthsAgo.toISOString())
    .order("created_at", { ascending: true })
    .limit(MAX_AUDIT_ROWS);

  if (logsError) {
    throw mapSupabaseError(
      logsError,
      "Impossible de charger l'historique des audits."
    );
  }

  const logs = (rawLogs ?? []) as AuditLogRow[];

  // Running state: tracks which flags are currently "open" for each item
  // key = `${record_id}::${flag_key}`, value = opened_at timestamp
  const openFlags = new Map<string, string>();

  // Transitions
  type Transition = {
    date: string;
    type: "opened" | "resolved";
    flagKey: string;
    resolutionMs?: number;
  };
  const transitions: Transition[] = [];

  for (const log of logs) {
    const beforeData = (log.before_data ?? null) as Record<string, unknown> | null;
    const afterData = (log.after_data ?? null) as Record<string, unknown> | null;
    const recordId = log.record_id;
    const createdAt = log.created_at;

    let beforeFlags: Set<string>;
    let afterFlags: Set<string>;

    if (log.action === "INSERT") {
      beforeFlags = new Set();
      afterFlags = computeSimpleFlags(afterData);
    } else if (log.action === "DELETE") {
      beforeFlags = computeSimpleFlags(beforeData);
      afterFlags = new Set();
    } else {
      // UPDATE
      beforeFlags = computeSimpleFlags(beforeData);
      afterFlags = computeSimpleFlags(afterData);
    }

    // Find newly appeared flags
    for (const flag of afterFlags) {
      if (!beforeFlags.has(flag)) {
        const compositeKey = `${recordId}::${flag}`;
        if (!openFlags.has(compositeKey)) {
          openFlags.set(compositeKey, createdAt);
          transitions.push({
            date: createdAt,
            type: "opened",
            flagKey: flag,
          });
        }
      }
    }

    // Find resolved flags
    for (const flag of beforeFlags) {
      if (!afterFlags.has(flag)) {
        const compositeKey = `${recordId}::${flag}`;
        const openedAt = openFlags.get(compositeKey);
        let resolutionMs: number | undefined;
        if (openedAt) {
          resolutionMs =
            new Date(createdAt).getTime() - new Date(openedAt).getTime();
          openFlags.delete(compositeKey);
        }
        transitions.push({
          date: createdAt,
          type: "resolved",
          flagKey: flag,
          resolutionMs,
        });
      }
    }
  }

  // Group transitions by month
  const periodMap = new Map<string, { opened: number; resolved: number }>();

  for (const t of transitions) {
    const d = new Date(t.date);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const entry = periodMap.get(period) ?? { opened: 0, resolved: 0 };
    if (t.type === "opened") {
      entry.opened += 1;
    } else {
      entry.resolved += 1;
    }
    periodMap.set(period, entry);
  }

  // Build sorted trend array and apply date filter AFTER building running state
  let trend = Array.from(periodMap.entries())
    .map(([period, counts]) => ({
      period,
      opened: counts.opened,
      resolved: counts.resolved,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  if (filters.date_from || filters.date_to) {
    trend = trend.filter((t) => {
      if (filters.date_from && t.period < filters.date_from.slice(0, 7)) {
        return false;
      }
      if (filters.date_to && t.period > filters.date_to.slice(0, 7)) {
        return false;
      }
      return true;
    });
  }

  // Compute average resolution by flag type
  const resolutionsByFlag = new Map<string, number[]>();
  for (const t of transitions) {
    if (t.type === "resolved" && t.resolutionMs !== undefined) {
      const existing = resolutionsByFlag.get(t.flagKey) ?? [];
      existing.push(t.resolutionMs);
      resolutionsByFlag.set(t.flagKey, existing);
    }
  }

  const avgResolution: AvgResolutionByType[] = [];
  for (const [flagKey, durations] of resolutionsByFlag) {
    if (durations.length === 0) continue;
    const avgMs = durations.reduce((s, v) => s + v, 0) / durations.length;
    const avgDays = Math.round((avgMs / (1000 * 60 * 60 * 24)) * 10) / 10;

    const label =
      (ESTIMATE_QUALITY_FLAG_META as Record<string, { label: string }>)[flagKey]
        ?.label ?? flagKey;

    avgResolution.push({ flagKey, flagLabel: label, avgDays });
  }

  avgResolution.sort((a, b) => a.flagKey.localeCompare(b.flagKey));

  return { trend, avgResolution };
}
