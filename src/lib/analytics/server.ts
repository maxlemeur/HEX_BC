import { cache } from "react";

import { getSupabase, getUserContext } from "@/lib/auth/server";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type KpiRow =
  Database["public"]["Functions"]["get_chiffreur_analytics_kpis"]["Returns"][number];
type TrendRow =
  Database["public"]["Functions"]["list_chiffreur_analytics_trend"]["Returns"][number];
type OwnerRow =
  Database["public"]["Functions"]["list_chiffreur_analytics_owners"]["Returns"][number];
type TopAffaireRow =
  Database["public"]["Functions"]["list_affaires_page"]["Returns"][number];

type AnalyticsMode = "all" | "owner";

export type AnalyticsScope = {
  mode: AnalyticsMode;
  ownerUserId: string | null;
  isAdmin: boolean;
  viewerRole: TenantRole;
};

export type AnalyticsKpis = {
  activeAffaires: number;
  acceptedRevenueCents: number;
  acceptedVersions: number;
  sentVersions: number;
  acceptanceRate: number;
  avgDaysToFirstAcceptance: number | null;
};

export type AnalyticsTrendPoint = {
  key: string;
  label: string;
  createdCount: number;
  acceptedCount: number;
};

export type AnalyticsTopAffaire = {
  projectId: string;
  projectName: string;
  projectReference: string | null;
  projectClient: string | null;
  versionCount: number;
  hasCurrentVersion: boolean;
  currentVersionId: string | null;
  currentVersionNumber: number | null;
  currentStatus: Database["public"]["Enums"]["estimate_status"] | null;
  currentTotalHtCents: number | null;
  currentUpdatedAt: string;
  acceptedVersionId: string | null;
  acceptedVersionNumber: number | null;
};

export type AnalyticsOwnerOption = {
  ownerUserId: string;
  ownerName: string;
  ownerRole: Extract<TenantRole, "engineer" | "admin">;
  activeAffairesCount: number;
};

export type AnalyticsPayload = {
  generatedAt: string;
  scope: AnalyticsScope;
  kpis: AnalyticsKpis;
  trend: AnalyticsTrendPoint[];
  topAffaires: AnalyticsTopAffaire[];
  owners: AnalyticsOwnerOption[];
};

const OWNER_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeOwnerUserId(ownerUserId: string | null | undefined): string | null {
  if (ownerUserId == null) return null;

  const trimmed = ownerUserId.trim();
  if (trimmed.length === 0) return null;

  if (!OWNER_UUID_REGEX.test(trimmed)) {
    throw badRequest("ownerUserId invalide.");
  }

  return trimmed.toLowerCase();
}

function isAdminRole(role: TenantRole | null | undefined): role is "admin" {
  return role === "admin";
}

function toSafeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function roundOneDecimal(value: number): number {
  return Number(value.toFixed(1));
}

function formatMonthLabel(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    return monthKey;
  }

  return parsed.toLocaleDateString("fr-FR", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const fetchAnalyticsKpis = cache(
  async (tenantId: string, ownerUserId: string | null): Promise<AnalyticsKpis> => {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc("get_chiffreur_analytics_kpis", {
      p_tenant_id: tenantId,
      p_owner_user_id: ownerUserId,
    });

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger les KPI analytics.");
    }

    const row = ((data ?? [])[0] as KpiRow | undefined) ?? {
      active_affaires_count: 0,
      accepted_revenue_cents: 0,
      accepted_versions_count: 0,
      sent_versions_count: 0,
      acceptance_rate: 0,
      avg_days_to_first_acceptance: null,
    };

    const avgDaysRaw = row.avg_days_to_first_acceptance;

    return {
      activeAffaires: toSafeInteger(row.active_affaires_count),
      acceptedRevenueCents: toSafeInteger(row.accepted_revenue_cents),
      acceptedVersions: toSafeInteger(row.accepted_versions_count),
      sentVersions: toSafeInteger(row.sent_versions_count),
      acceptanceRate: roundOneDecimal(toSafeNumber(row.acceptance_rate)),
      avgDaysToFirstAcceptance:
        avgDaysRaw == null ? null : roundOneDecimal(toSafeNumber(avgDaysRaw)),
    };
  }
);

const fetchAnalyticsTrend = cache(
  async (
    tenantId: string,
    ownerUserId: string | null,
    months: number
  ): Promise<AnalyticsTrendPoint[]> => {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc("list_chiffreur_analytics_trend", {
      p_tenant_id: tenantId,
      p_owner_user_id: ownerUserId,
      p_months: months,
    });

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger la tendance analytics.");
    }

    return ((data ?? []) as TrendRow[]).map((row) => ({
      key: row.month_key,
      label: formatMonthLabel(row.month_key),
      createdCount: toSafeInteger(row.created_count),
      acceptedCount: toSafeInteger(row.accepted_count),
    }));
  }
);

const fetchTopAffaires = cache(
  async (
    tenantId: string,
    ownerUserId: string | null,
    limit: number
  ): Promise<AnalyticsTopAffaire[]> => {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc("list_affaires_page", {
      p_tenant_id: tenantId,
      p_owner_user_id: ownerUserId,
      p_limit: limit,
      p_search: null,
      p_statuses: null,
      p_cursor_updated_at: null,
      p_cursor_project_id: null,
      p_sort_dir: "desc",
    });

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger le top affaires analytics.");
    }

    return ((data ?? []) as TopAffaireRow[]).map((row) => ({
      projectId: row.project_id,
      projectName: row.project_name,
      projectReference: row.project_reference,
      projectClient: row.project_client,
      versionCount: toSafeInteger(row.version_count),
      hasCurrentVersion: row.has_current_version,
      currentVersionId: row.current_version_id,
      currentVersionNumber:
        row.current_version_number == null
          ? null
          : toSafeInteger(row.current_version_number),
      currentStatus: row.current_status,
      currentTotalHtCents:
        row.current_total_ht_cents == null
          ? null
          : toSafeInteger(row.current_total_ht_cents),
      currentUpdatedAt: row.current_updated_at,
      acceptedVersionId: row.accepted_version_id,
      acceptedVersionNumber:
        row.accepted_version_number == null
          ? null
          : toSafeInteger(row.accepted_version_number),
    }));
  }
);

const fetchAnalyticsOwners = cache(
  async (tenantId: string): Promise<AnalyticsOwnerOption[]> => {
    const supabase = await getSupabase();

    const { data, error } = await supabase.rpc("list_chiffreur_analytics_owners", {
      p_tenant_id: tenantId,
    });

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger la liste des chiffreurs analytics.");
    }

    return ((data ?? []) as OwnerRow[])
      .filter(
        (row): row is OwnerRow & { owner_role: "admin" | "engineer" } =>
          row.owner_role === "admin" || row.owner_role === "engineer"
      )
      .map((row) => ({
        ownerUserId: row.owner_user_id,
        ownerName: row.owner_name,
        ownerRole: row.owner_role,
        activeAffairesCount: toSafeInteger(row.active_affaires_count),
      }));
  }
);

export async function fetchChiffreurAnalytics(input?: {
  ownerUserId?: string | null;
}): Promise<AnalyticsPayload> {
  const context = await getUserContext();
  const profile = context.profile;

  if (!profile || !context.tenantId || !profile.tenant_role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  const requestedOwnerUserId = normalizeOwnerUserId(input?.ownerUserId ?? null);
  const isAdmin = isAdminRole(profile.tenant_role);

  if (!isAdmin && requestedOwnerUserId && requestedOwnerUserId !== profile.id) {
    throw forbidden("Le filtrage analytics par utilisateur est reserve aux administrateurs.");
  }

  const effectiveOwnerUserId = isAdmin
    ? requestedOwnerUserId
    : profile.id;

  const scope: AnalyticsScope = {
    mode: effectiveOwnerUserId ? "owner" : "all",
    ownerUserId: effectiveOwnerUserId,
    isAdmin,
    viewerRole: profile.tenant_role,
  };

  const tenantId = context.tenantId;

  const [kpis, trend, topAffaires, owners] = await Promise.all([
    fetchAnalyticsKpis(tenantId, effectiveOwnerUserId),
    fetchAnalyticsTrend(tenantId, effectiveOwnerUserId, 6),
    fetchTopAffaires(tenantId, effectiveOwnerUserId, 10),
    isAdmin ? fetchAnalyticsOwners(tenantId) : Promise.resolve([]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    scope,
    kpis,
    trend,
    topAffaires,
    owners,
  };
}
