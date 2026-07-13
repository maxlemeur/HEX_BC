import { getUserContext } from "@/lib/auth/server";
import {
  getCurrentAnomalySummary,
  getAnomalyTrend,
  type AnomalyFilters,
  type TrendFilters,
  type AnomalyHistoryResult,
  type CurrentAnomalyRow,
} from "@/lib/estimates/anomaly-history";
import {
  badRequest,
  forbidden,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import { getSupabase } from "@/lib/auth/server";

const ANOMALY_PAGE_SIZES = [25, 50, 100] as const;
type AnomalyPageSize = (typeof ANOMALY_PAGE_SIZES)[number];
type AnomalyHistoryView = "all" | "current" | "trend";

function parseCsvParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseView(value: string | null): AnomalyHistoryView {
  if (!value) return "all";
  if (value === "all" || value === "current" || value === "trend") {
    return value;
  }
  throw badRequest("Vue d'historique des anomalies invalide.");
}

function parsePage(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parsePageSize(value: string | null): AnomalyPageSize {
  const parsed = Number(value);
  if (ANOMALY_PAGE_SIZES.includes(parsed as AnomalyPageSize)) {
    return parsed as AnomalyPageSize;
  }
  if (Number.isFinite(parsed) && parsed > 100) return 100;
  return 25;
}

function escapeCsvField(value: string): string {
  if (!/[;"\r\n]/u.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function buildCsvContent(anomalies: CurrentAnomalyRow[]): string {
  const SEP = ";";
  const headers = [
    "Version ID",
    "Version",
    "Projet",
    "Chiffreur",
    "Anomalie",
    "Severite",
    "Nb lignes",
  ];

  const rows = anomalies.map((row) =>
    [
      row.versionId,
      row.versionLabel,
      row.projectName,
      row.ownerName,
      row.flagLabel,
      row.severity,
      String(row.itemCount),
    ].map(escapeCsvField).join(SEP)
  );

  return "\ufeff" + [headers.join(SEP), ...rows].join("\n");
}

export async function GET(request: Request) {
  try {
    const { profile, tenantId } = await getUserContext();

    if (!profile || !tenantId || profile.tenant_role !== "admin") {
      return toErrorResponse(
        forbidden("Acces reserve aux administrateurs.")
      );
    }

    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";
    const view = parseView(url.searchParams.get("view"));

    const anomalyFilters: AnomalyFilters = {
      flag_types: parseCsvParam(
        url.searchParams.getAll("flag_types").join(",")
      ),
      owner_user_id: url.searchParams.get("owner_user_id") ?? undefined,
      search: url.searchParams.get("search") ?? undefined,
      version_id: url.searchParams.get("version_id") ?? undefined,
    };

    const trendFilters: TrendFilters = {
      date_from: url.searchParams.get("date_from") ?? undefined,
      date_to: url.searchParams.get("date_to") ?? undefined,
    };

    const supabase = await getSupabase();

    if (format === "csv") {
      const currentResult = await getCurrentAnomalySummary(
        supabase,
        tenantId,
        anomalyFilters
      );
      const csv = buildCsvContent(currentResult.currentAnomalies);
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition":
            'attachment; filename="anomaly-history.csv"',
        },
      });
    }

    if (format !== "json") {
      throw badRequest("Format d'historique des anomalies invalide.");
    }

    if (view === "current") {
      const currentResult = await getCurrentAnomalySummary(
        supabase,
        tenantId,
        anomalyFilters
      );
      const size = parsePageSize(url.searchParams.get("size"));
      const requestedPage = parsePage(url.searchParams.get("page"));
      const totalItems = currentResult.currentAnomalies.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / size));
      const page = Math.min(requestedPage, totalPages);
      const start = (page - 1) * size;

      return ok({
        summary: currentResult.summary,
        currentAnomalies: currentResult.currentAnomalies.slice(
          start,
          start + size
        ),
        ownerOptions: currentResult.ownerOptions,
        pagination: {
          page,
          size,
          totalItems,
          totalPages,
        },
      });
    }

    if (view === "trend") {
      return ok(await getAnomalyTrend(supabase, tenantId, trendFilters));
    }

    const [currentResult, trendResult] = await Promise.all([
      getCurrentAnomalySummary(supabase, tenantId, anomalyFilters),
      getAnomalyTrend(supabase, tenantId, trendFilters),
    ]);

    const result: AnomalyHistoryResult = {
      summary: currentResult.summary,
      currentAnomalies: currentResult.currentAnomalies,
      trend: trendResult.trend,
      avgResolution: trendResult.avgResolution,
    };

    return ok(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
