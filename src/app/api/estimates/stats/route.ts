import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  mapSupabaseError,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type EstimateStatus = Database["public"]["Enums"]["estimate_status"];
type EstimateStatsVersionRow = Pick<
  Database["public"]["Tables"]["estimate_versions"]["Row"],
  "id" | "status" | "created_at" | "updated_at" | "total_ht_cents"
>;

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const TREND_MONTHS = 6;

function isTenantAdmin(role: TenantRole) {
  return role === TENANT_ADMIN_ROLE;
}

function toMonthKey(dateValue: string): string | null {
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return null;
  const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
  return `${parsed.getUTCFullYear()}-${month}`;
}

function buildRecentMonths(now: Date, count: number) {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  return Array.from({ length: count }, (_, index) => {
    const shift = count - index - 1;
    const monthDate = new Date(
      Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - shift, 1)
    );
    const month = String(monthDate.getUTCMonth() + 1).padStart(2, "0");
    const key = `${monthDate.getUTCFullYear()}-${month}`;

    return {
      key,
      label: monthDate.toLocaleDateString("fr-FR", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
      createdCount: 0,
      acceptedCount: 0,
    };
  });
}

async function getActorContext() {
  const { supabase, userId, tenantId, tenantRole } =
    await getAuthenticatedTenantContext();

  return {
    supabase,
    userId,
    tenantId,
    tenantRole,
  };
}

export async function GET() {
  try {
    const { supabase, userId, tenantId, tenantRole } = await getActorContext();

    let versionsQuery = supabase
      .from("estimate_versions")
      .select(
        "id, status, created_at, updated_at, total_ht_cents, estimate_projects!inner(user_id, tenant_id, is_archived)"
      )
      .eq("tenant_id", tenantId)
      .eq("estimate_projects.tenant_id", tenantId)
      .eq("estimate_projects.is_archived", false);

    if (!isTenantAdmin(tenantRole)) {
      versionsQuery = versionsQuery.eq("estimate_projects.user_id", userId);
    }

    const { data, error } = await versionsQuery;

    if (error) {
      throw mapSupabaseError(error, "Impossible de charger les statistiques des chiffrages.");
    }

    const versions = (data ?? []) as unknown as EstimateStatsVersionRow[];
    const byStatus: Record<EstimateStatus, number> = {
      draft: 0,
      sent: 0,
      accepted: 0,
      archived: 0,
    };

    let acceptedRevenueCents = 0;
    let sentRevenueCents = 0;
    let draftRevenueCents = 0;

    versions.forEach((version) => {
      byStatus[version.status] += 1;
      const totalHtCents = Number.isFinite(version.total_ht_cents)
        ? version.total_ht_cents
        : 0;

      if (version.status === "accepted") {
        acceptedRevenueCents += totalHtCents;
      } else if (version.status === "sent") {
        sentRevenueCents += totalHtCents;
      } else if (version.status === "draft") {
        draftRevenueCents += totalHtCents;
      }
    });

    const sentCount = byStatus.sent;
    const acceptedCount = byStatus.accepted;
    const sentOrAcceptedCount = sentCount + acceptedCount;
    const acceptanceRate = sentOrAcceptedCount > 0
      ? Number(((acceptedCount / sentOrAcceptedCount) * 100).toFixed(1))
      : 0;

    const trend = buildRecentMonths(new Date(), TREND_MONTHS);
    const trendByMonth = new Map(trend.map((bucket) => [bucket.key, bucket]));

    versions.forEach((version) => {
      const createdKey = toMonthKey(version.created_at);
      if (createdKey && trendByMonth.has(createdKey)) {
        trendByMonth.get(createdKey)!.createdCount += 1;
      }

      if (version.status === "accepted") {
        const acceptedKey = toMonthKey(version.updated_at);
        if (acceptedKey && trendByMonth.has(acceptedKey)) {
          trendByMonth.get(acceptedKey)!.acceptedCount += 1;
        }
      }
    });

    return ok({
      generatedAt: new Date().toISOString(),
      kpis: {
        totalEstimates: versions.length,
        byStatus,
        acceptanceRate,
        acceptanceRateBase: {
          accepted: acceptedCount,
          sent: sentCount,
        },
        revenues: {
          acceptedCents: acceptedRevenueCents,
          sentCents: sentRevenueCents,
          draftCents: draftRevenueCents,
        },
      },
      trend,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
