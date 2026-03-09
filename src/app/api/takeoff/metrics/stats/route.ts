import type { PostgrestError } from "@supabase/supabase-js";

import {
  forbidden,
  mapSupabaseError,
  ok,
  toErrorResponse,
  unauthorized,
} from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  buildTakeoffMetricsStatsPayload,
  parseTakeoffMetricsQuery,
  type TakeoffMetricsAuditLogRow,
  type TakeoffMetricsItemRow,
  type TakeoffMetricsJobRow,
  type TakeoffMetricsResultRow,
  type TakeoffMetricsRunMetricRow,
} from "@/lib/takeoff/stats";
import type { Database } from "@/types/database";

type TenantRole = Database["public"]["Enums"]["tenant_role"];
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "role" | "is_default" | "created_at"
>;

const TENANT_ADMIN_ROLE: TenantRole = "admin";
const TAKEOFF_METRICS_JOB_BATCH_SIZE = 100;
type SupabaseQueryError = PostgrestError;

async function getActorContext() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, role, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw mapSupabaseError(membershipError, "Impossible de charger le tenant courant.");
  }

  const membership = memberships?.[0] as TenantMembershipRow | undefined;

  if (!membership?.tenant_id || !membership.role) {
    throw forbidden("Aucun tenant actif pour cet utilisateur.");
  }

  if (membership.role !== TENANT_ADMIN_ROLE) {
    throw forbidden("Acces reserve aux administrateurs.");
  }

  return {
    supabase,
    userId: user.id,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
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

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const { supabase, tenantId } = await getActorContext();
    await assertTakeoffEnabled(tenantId, { supabase });

    const url = new URL(request.url);
    const now = new Date();
    const { period, level, cutoff } = parseTakeoffMetricsQuery(
      url.searchParams,
      now
    );

    let jobsQuery = supabase
      .from("takeoff_jobs" as never)
      .select(
        "id, status, level, model, duration_ms, cost_cents, retry_count, error_code, created_at"
      )
      .eq("tenant_id" as never, tenantId as never)
      .gte("created_at" as never, cutoff as never);

    if (level) {
      jobsQuery = jobsQuery.eq("level" as never, level as never);
    }

    let runMetricsQuery = supabase
      .from("takeoff_run_metrics" as never)
      .select(
        "job_id, input_tokens, reasoning_tokens, output_tokens, timed_out, budget_exceeded"
      )
      .eq("tenant_id" as never, tenantId as never)
      .gte("created_at" as never, cutoff as never);

    if (level) {
      runMetricsQuery = runMetricsQuery.eq("level" as never, level as never);
    }

    const [jobsResult, runMetricsResult, resultsResult, itemsResult] =
      await Promise.all([
        jobsQuery,
        runMetricsQuery,
        supabase
          .from("takeoff_results" as never)
          .select("job_id, confidence")
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never)
          .not("confidence" as never, "is" as never, null as never),
        supabase
          .from("takeoff_items" as never)
          .select("job_id")
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never),
      ]);

    if (jobsResult.error) {
      throw mapSupabaseError(jobsResult.error, "Impossible de charger les jobs takeoff.");
    }
    if (runMetricsResult.error) {
      throw mapSupabaseError(runMetricsResult.error, "Impossible de charger les metriques de run.");
    }
    if (resultsResult.error) {
      throw mapSupabaseError(resultsResult.error, "Impossible de charger les resultats takeoff.");
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
      errorMessage: "Impossible de charger les evenements de correction takeoff.",
      fetchBatch: async (batch) =>
        (await supabase
          .from("audit_logs" as never)
          .select("record_id, action, created_at, after_data")
          .eq("tenant_id" as never, tenantId as never)
          .gte("created_at" as never, cutoff as never)
          .in("record_id" as never, batch as never)
          .in(
            "action" as never,
            [
              "takeoff.item.excluded",
              "takeoff.item.modified",
              "takeoff.dpgf.review_decision",
            ] as never
          )) as {
          data: TakeoffMetricsAuditLogRow[] | null;
          error: SupabaseQueryError | null;
        },
    });

    const payload = buildTakeoffMetricsStatsPayload({
      period,
      jobs,
      runMetrics,
      results,
      items,
      auditLogs,
      now,
    });

    return ok(payload);
  } catch (error) {
    return toErrorResponse(error);
  }
}
