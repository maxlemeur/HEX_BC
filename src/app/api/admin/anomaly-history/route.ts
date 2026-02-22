import { getUserContext } from "@/lib/auth/server";
import {
  getCurrentAnomalySummary,
  getAnomalyTrend,
  type AnomalyFilters,
  type TrendFilters,
  type AnomalyHistoryResult,
  type CurrentAnomalyRow,
} from "@/lib/estimates/anomaly-history";
import { forbidden, ok, toErrorResponse } from "@/lib/estimates/errors";
import { getSupabase } from "@/lib/auth/server";

function parseCsvParam(value: string | null): string[] | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
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
    ].join(SEP)
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

    const anomalyFilters: AnomalyFilters = {
      flag_types: parseCsvParam(url.searchParams.get("flag_types")),
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
