import { mapSupabaseError } from "@/lib/http/api-response";
import {
  TakeoffErrorCode,
  toTakeoffError,
} from "@/lib/takeoff/errors";
import type { NormalizedTakeoffItemForInsert } from "@/lib/takeoff/exchange-normalization";
import type { TakeoffJobProcessingRow } from "@/lib/takeoff/job-lifecycle";
import type { buildLevelCRunMetricRows } from "@/lib/takeoff/level-c-chunk-metrics";
import { publicTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { TAKEOFF_LEVEL_A, type ProcessableTakeoffLevel, type Supabase } from "@/lib/takeoff/processing-context";
import {
  annotateAtomicPersistenceRollbackError,
  buildProcessingStatusConflictError,
  fetchCurrentTakeoffJobStatus,
} from "@/lib/takeoff/processing-job-state";
import type { TakeoffExchange } from "@/lib/takeoff/types";
import { buildTakeoffVectorPersistence } from "@/lib/takeoff/vectors/worker-persistence-server";
import { writableRuleInputs } from "@/lib/takeoff/rules/contracts";
import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import { hypothesisPreselection } from "@/lib/takeoff/hypothesis";
import { isTakeoffRulesEnabled, recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import type { VectorPageOutcome } from "@/lib/takeoff/vectors/worker-server";

export async function finalizeTakeoffResult(input: {
  supabase: Supabase;
  job: TakeoffJobProcessingRow;
  exchange: TakeoffExchange;
  itemsForInsert: NormalizedTakeoffItemForInsert[];
  tokenCount: number;
  costCents: number;
  durationMs: number;
  totalDurationMs: number;
  completedAt: Date;
  model: string;
  promptVersion: string;
  providerMeta: Record<string, unknown>;
  level: ProcessableTakeoffLevel;
  vector?: readonly VectorPageOutcome[];
  runMetrics?: ReturnType<typeof buildLevelCRunMetricRows>;
}) {
  const withRules = isTakeoffRulesEnabled() && input.level !== TAKEOFF_LEVEL_A;
  const items = input.itemsForInsert.map((item) => {
    const ruleInputs = withRules ? writableRuleInputs(ruleInputsFromDesignation({
      designation: item.designation, unit: item.unit, quantity: item.quantity, evidence: item.evidence,
      category: typeof item.metadata.category === "string" ? item.metadata.category : null,
    })) : null;
    const metadata = ruleInputs ? { ...item.metadata, rule_inputs: ruleInputs } : item.metadata;
    const preselection = hypothesisPreselection({ metadata });
    return {
      ...item,
      id: crypto.randomUUID(),
      metadata,
      is_excluded: preselection?.is_excluded ?? false,
      exclusion_reason: preselection?.exclusion_reason ?? null,
      rules_stale: ruleInputs !== null,
    };
  });
  const { data, error } = await input.supabase.rpc("finalize_local_takeoff_result" as never, {
    p_job_id: input.job.id,
    p_tenant_id: input.job.tenant_id,
    p_lease_token: input.job.processing_lease_token,
    p_completed_at: input.completedAt.toISOString(),
    p_model: input.model,
    p_prompt_version: input.promptVersion,
    p_result: {
      extracted_json: input.exchange,
      warnings: input.exchange.warnings,
      tables: input.exchange.tables ?? [],
      provider_meta: {
        ...input.providerMeta,
        ...(input.job.preparation_snapshot ? { preparation_snapshot: publicTakeoffPreparationSnapshot(input.job.preparation_snapshot) } : {}),
      },
      confidence: input.exchange.confidence ?? null,
      token_count: input.tokenCount,
      cost_cents: input.costCents,
      duration_ms: input.durationMs,
      job_duration_ms: input.totalDurationMs,
      run_metrics: input.runMetrics,
    },
    p_items: items,
    ...(input.vector?.length ? { p_vector: buildTakeoffVectorPersistence(input.vector, items) } : {}),
  } as never);
  if (error) {
    const failure = toTakeoffError(mapSupabaseError(error, "Impossible de finaliser le résultat takeoff."), {
      fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: input.job.id, level: input.level,
    });
    throw input.level === TAKEOFF_LEVEL_A ? annotateAtomicPersistenceRollbackError(failure) : failure;
  }
  if (typeof data !== "string") {
    const currentStatus = await fetchCurrentTakeoffJobStatus(input);
    throw buildProcessingStatusConflictError({
      jobId: input.job.id, currentStatus, operation: "complete_job", level: input.level,
    });
  }

  // The result and its notice have committed. Rule refresh is best effort; a
  // job without a version refreshes the rules of its own affaire's job.
  if (input.level !== TAKEOFF_LEVEL_A) {
    const { estimate_version_id, project_id, id } = input.job;
    const scope = estimate_version_id !== null
      ? { estimateVersionId: estimate_version_id }
      : project_id ? { projectId: project_id, jobId: id } : null;
    if (scope) await recomputeTakeoffRulesQuietly({
      tenantId: input.job.tenant_id, ...scope, context: "worker", supabase: input.supabase,
    });
  }
  return { resultId: data, itemsCount: input.itemsForInsert.length, warningsCount: input.exchange.warnings.length };
}
