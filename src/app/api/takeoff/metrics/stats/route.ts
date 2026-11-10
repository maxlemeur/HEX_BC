import { readAllRows } from "@/lib/supabase/read-all";
import type { PostgrestError } from "@supabase/supabase-js";

import { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import {
  forbidden,
  mapSupabaseError,
  ok,
  toErrorResponse,
} from "@/lib/estimates/errors";
import { isTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  buildTakeoffMetricsStatsPayload,
  parseTakeoffMetricsQuery,
  type TakeoffMetricsAuditLogRow,
  type TakeoffMetricsItemRow,
  type TakeoffMetricsJobRow,
  type TakeoffMetricsOverrideConsumptionRow,
  type TakeoffMetricsResultRow,
  type TakeoffMetricsRuleForcingItemRow,
  type TakeoffMetricsRunMetricRow,
} from "@/lib/takeoff/stats";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const TAKEOFF_METRICS_JOB_BATCH_SIZE = 100;
type SupabaseQueryError = PostgrestError;

async function getActorContext() {
  const { supabase, userId, tenantId, tenantRole } =
    await getAuthenticatedTenantContext();

  if (tenantRole !== TENANT_ADMIN_ROLE) {
    throw forbidden("Accès reserve aux administrateurs.");
  }

  return {
    supabase,
    userId,
    tenantId,
    tenantRole,
  };
}

async function fetchRowsByJobIdBatch<T>(input: {
  jobIds: string[];
  batchSize?: number;
  fetchBatch: (jobIds: string[]) => Promise<{ data: T[] | null; error: SupabaseQueryError | null }>;
  errorMessage: string;
}) {
  if (input.jobIds.length === 0) {
    return [] as T[];
  }

  const batchSize = input.batchSize ?? TAKEOFF_METRICS_JOB_BATCH_SIZE;
  const rows: T[] = [];

  for (let index = 0; index < input.jobIds.length; index += batchSize) {
    const batch = input.jobIds.slice(index, index + batchSize);
    const result = await input.fetchBatch(batch);
    if (result.error) {
      throw mapSupabaseError(result.error, input.errorMessage);
    }
    rows.push(...(result.data ?? []));
  }

  return rows;
}

/**
 * The overrides consumed by a batch of applied jobs. The table has no id column for readAllRows; a job is applied once
 * and consumes one override, so a batch holds at most one row per job, and a read that the exact count shows cut is an
 * error rather than a lower rate.
 */
async function readOverrideConsumptions(
  supabase: Awaited<ReturnType<typeof getActorContext>>["supabase"],
  tenantId: string,
  jobIds: string[]
): Promise<{ data: TakeoffMetricsOverrideConsumptionRow[] | null; error: SupabaseQueryError | null }> {
  const { data, error, count } = await supabase
    .from("takeoff_apply_override_consumptions" as never)
    .select("audit_log_id, job_id", { count: "exact" })
    .eq("tenant_id" as never, tenantId as never)
    .in("job_id" as never, jobIds as never)
    .order("audit_log_id" as never, { ascending: true });
  if (error) return { data: null, error };
  const rows = (data ?? []) as unknown as TakeoffMetricsOverrideConsumptionRow[];
  if (count !== rows.length) {
    throw new Error("Lecture incomplète ou modifiée : compte des forçages consommés incohérent.");
  }
  return { data: rows, error: null };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const { supabase, tenantId } = await getActorContext();
    const killSwitchEnabled = await isTakeoffEnabled(tenantId, { supabase });

    const url = new URL(request.url);
    const now = new Date();
    const { period, level, cutoff } = parseTakeoffMetricsQuery(
      url.searchParams,
      now
    );

    let jobsQuery = supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, status, level, model, duration_ms, cost_cents, retry_count, error_code, created_at",
        { count: "exact" }
      )
      .eq("tenant_id" as never, tenantId as never)
      .gte("created_at" as never, cutoff as never);

    if (level) {
      jobsQuery = jobsQuery.eq("level" as never, level as never);
    }

    let runMetricsQuery = supabase
      .from("takeoff_run_metrics" as never)
      .select(
        "job_id, input_tokens, reasoning_tokens, output_tokens, timed_out, budget_exceeded, id",
        { count: "exact" }
      )
      .eq("tenant_id" as never, tenantId as never)
      .gte("created_at" as never, cutoff as never);

    if (level) {
      runMetricsQuery = runMetricsQuery.eq("level" as never, level as never);
    }

    const [jobsResult, runMetricsResult, resultsResult, itemsResult] =
      await Promise.all([
        readAllRows(() => jobsQuery),
        readAllRows(() => runMetricsQuery),
        readAllRows(() => supabase
          .from("takeoff_results" as never)
          .select("job_id, confidence, id", { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never)
          .not("confidence" as never, "is" as never, null as never)),
        readAllRows(() => supabase
          .from("takeoff_items" as never)
          .select("id, job_id, confidence, evidence, source_page, is_excluded", { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never)),
      ]);

    if (jobsResult.error) {
      throw mapSupabaseError(jobsResult.error, "Impossible de charger les jobs takeoff.");
    }
    if (runMetricsResult.error) {
      throw mapSupabaseError(runMetricsResult.error, "Impossible de charger les metriques de run.");
    }
    if (resultsResult.error) {
      throw mapSupabaseError(resultsResult.error, "Impossible de charger les résultats takeoff.");
    }
    if (itemsResult.error) {
      throw mapSupabaseError(itemsResult.error, "Impossible de charger les items takeoff.");
    }

    const jobs = (jobsResult.data ?? []) as unknown as TakeoffMetricsJobRow[];
    const runMetrics = (runMetricsResult.data ?? []) as unknown as TakeoffMetricsRunMetricRow[];
    const results = (resultsResult.data ?? []) as unknown as TakeoffMetricsResultRow[];
    const items = (itemsResult.data ?? []) as unknown as TakeoffMetricsItemRow[];
    const jobIds = jobs.map((job) => job.id);

    const auditLogs = await fetchRowsByJobIdBatch<TakeoffMetricsAuditLogRow>({
      jobIds,
      errorMessage: "Impossible de charger les événements de correction takeoff.",
      fetchBatch: async (batch) =>
        (await readAllRows(() => supabase
          .from("audit_logs" as never)
          .select("record_id, action, created_at, after_data, id", { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never)
          .in("record_id" as never, batch as never)
          .in(
            "action" as never,
            [
              "takeoff.item.excluded",
              "takeoff.item.modified",
              "takeoff.dpgf.review_decision",
              // TI-686 D10: the overrides, counted only once consumed (below).
              "takeoff.apply.override",
            ] as never
          ))) as {
          data: TakeoffMetricsAuditLogRow[] | null;
          error: SupabaseQueryError | null;
        },
    });

    // TI-686 D10 (H19): the false positives declared at forcing per rule read the applied jobs only: their lines with
    // the rule results they were applied with (frozen), and the overrides their applications consumed, which an
    // administrator reads through « Admins can view override consumptions » (H11).
    const appliedJobIds = jobs.filter((job) => job.status === "applied").map((job) => job.id);
    const ruleForcingItems = await fetchRowsByJobIdBatch<TakeoffMetricsRuleForcingItemRow>({
      jobIds: appliedJobIds,
      errorMessage: "Impossible de charger les lignes appliquées takeoff.",
      fetchBatch: async (batch) =>
        (await readAllRows(() => supabase
          .from("takeoff_items" as never)
          .select("id, job_id, is_excluded, is_verified, rule_results", { count: "exact" })
          .eq("tenant_id" as never, tenantId as never)
          .in("job_id" as never, batch as never))) as {
          data: TakeoffMetricsRuleForcingItemRow[] | null;
          error: SupabaseQueryError | null;
        },
    });
    const overrideConsumptions = await fetchRowsByJobIdBatch<TakeoffMetricsOverrideConsumptionRow>({
      jobIds: appliedJobIds,
      errorMessage: "Impossible de charger les forçages takeoff consommés.",
      fetchBatch: (batch) => readOverrideConsumptions(supabase, tenantId, batch),
    });

    const payload = buildTakeoffMetricsStatsPayload({
      tenantId,
      killSwitchEnabled,
      period,
      jobs,
      runMetrics,
      results,
      items,
      auditLogs,
      ruleForcingItems,
      overrideConsumptions,
      now,
    });

    return ok(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}
